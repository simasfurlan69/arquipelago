/**
 * NPCBody.js
 * Corpo esculpido para os NPCs principais (Heitor e Bruno), feito só com
 * geometria procedural suave — sem blocos:
 *  - tronco, membros, botas e casaco por LatheGeometry (seção elíptica);
 *  - cabeça a partir de uma esfera deformada (órbitas, sobrancelha, maçãs do
 *    rosto, mandíbula, queixo), nariz, orelhas, olhos com íris/pupila e pálpebras,
 *    lábios e boca (o lábio inferior fica no grupo 'jaw', que a fala anima);
 *  - mãos com palma, quatro dedos e polegar;
 *  - materiais com relevo por ruído (trama do tecido, couro gasto, fios de cabelo).
 *
 * Mantém a MESMA hierarquia de nós do HumanoidRig (hips, torso, neck, head,
 * armL/R, foreL/R, handL/R, legL/R, shinL/R) para a animação procedural do NPC.js.
 * Convenções: frente = +Z, esquerda = +X.
 */
import * as THREE from 'three/webgpu';
import { color, mix, smoothstep, mx_noise_float, mx_noise_vec3, positionLocal, normalView, transformNormalToView, vec3, float } from 'three/tsl';
import { createSkinMaterial } from './CharacterMaterials.js';

export const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
};

/** Sólido de revolução com seção elíptica. Perfil [[raio, y], ...] de baixo para cima. */
export function lathe(profile, { segs = 24, sx = 1, sz = 1, phiStart = 0, phiLength = Math.PI * 2 } = {}) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), segs, phiStart, phiLength);
  g.scale(sx, 1, sz);
  g.computeVertexNormals();
  return g;
}

// -----------------------------------------------------------------------------
// Materiais
// -----------------------------------------------------------------------------
/** Normal perturbada por ruído (relevo fino sem textura). */
const bumpNormal = (scale, amount, stretch = null) => {
  const p = stretch ? positionLocal.mul(stretch) : positionLocal.mul(scale);
  // perturbação direto no espaço de visão (não depende da escala da malha)
  return normalView.add(mx_noise_vec3(p).mul(amount)).normalize();
};

/** Tecido/couro com variação de cor, desgaste, fuligem e relevo. */
export function fabric(hex, { rough = 0.85, metal = 0, bump = 0.07, scale = 60, wear = 0.3, soot = 0, dark = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: metal });
  const big = mx_noise_float(positionLocal.mul(6)).mul(0.5).add(0.5);
  const fine = mx_noise_float(positionLocal.mul(scale)).mul(0.5).add(0.5);
  let c = mix(color(dark ?? hex).mul(1 - wear), color(hex).mul(1 + wear * 0.35), big.mul(0.75).add(fine.mul(0.25)));
  if (soot) c = mix(c, color(0x14110e), smoothstep(0.42, 0.85, mx_noise_float(positionLocal.mul(4.5)).mul(0.5).add(0.5)).mul(soot));
  m.colorNode = c;
  m.roughnessNode = float(rough).add(fine.mul(0.12)).sub(0.06);
  m.normalNode = bumpNormal(scale, Math.min(bump, 0.1));
  return m;
}

/** Couro com bordado em arabescos dourados (painéis do casaco do Heitor). */
export function embroidered(base, thread = 0xc9ac6e, amount = 1) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.05 });
  const p = positionLocal.mul(34);
  const wear = mx_noise_float(positionLocal.mul(8)).mul(0.5).add(0.5);
  const leather = mix(color(base).mul(0.72), color(base).mul(1.08), smoothstep(0.15, 0.85, wear));
  const line = smoothstep(0.07, 0.0, mx_noise_float(p).abs());
  const line2 = smoothstep(0.05, 0.0, mx_noise_float(p.mul(1.9).add(3.1)).abs());
  const mask = smoothstep(-0.15, 0.35, mx_noise_float(p.mul(0.28))).mul(amount);
  const swirl = line.max(line2.mul(0.8)).mul(mask);
  m.colorNode = mix(leather, color(thread), swirl);
  m.metalnessNode = swirl.mul(0.55);
  m.roughnessNode = mix(float(0.62), float(0.38), swirl);
  m.normalNode = normalView.add(mx_noise_vec3(p).mul(swirl.mul(0.18).add(0.04))).normalize();
  return m;
}

/** Cabelo/barba: fios ao longo de um eixo (stretch), brilho anisotrópico simulado. */
export function hairMaterial(hex, light, { along = 'y', rough = 0.6 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 0 });
  const st = along === 'y' ? vec3(90, 7, 90) : vec3(90, 90, 7);
  const strands = mx_noise_float(positionLocal.mul(st)).mul(0.5).add(0.5);
  const clumps = mx_noise_float(positionLocal.mul(st.mul(0.25))).mul(0.5).add(0.5);
  m.colorNode = mix(color(hex), color(light), smoothstep(0.35, 0.95, strands.mul(0.6).add(clumps.mul(0.4))));
  m.normalNode = bumpNormal(0, 0.16, st);
  return m;
}

export const metal = (hex, rough = 0.35, extra = {}) => new THREE.MeshStandardNodeMaterial({ color: hex, metalness: 0.9, roughness: rough, ...extra });

// -----------------------------------------------------------------------------
// Cabeça esculpida
// -----------------------------------------------------------------------------
const gauss = (dx, dy, dz, s) => Math.exp(-(dx * dx + dy * dy + dz * dz) / (s * s));

/**
 * @returns {{ group: THREE.Group, jaw: THREE.Group, yc: number }}
 * Cabeça com origem no pivô do pescoço; centro do crânio em y = yc.
 */
export function sculptHead({ r = 0.115, skin, lip = 0x9a5a4a, iris = 0x4a3524, irisGlow = 0, brow = 1, jaw = 1, nose = 1, hairBrow = 0x3a3430 }) {
  const group = new THREE.Group();
  const yc = r * 0.95;
  const g = new THREE.SphereGeometry(1, 56, 42);
  const p = g.attributes.position;
  const orig = p.array.slice();   // coordenadas da esfera unitária (para cabelo/barba moldados)
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let d = 0;
    for (const s of [-1, 1]) {
      d -= 0.075 * gauss(x - s * 0.36, y - 0.1, z - 0.86, 0.2);              // órbitas
      d += 0.05 * brow * gauss(x - s * 0.34, y - 0.3, z - 0.88, 0.2);       // arco da sobrancelha
      d += 0.04 * gauss(x - s * 0.55, y + 0.08, z - 0.76, 0.22);            // maçãs do rosto
      d -= 0.03 * gauss(x - s * 0.85, y - 0.25, z - 0.3, 0.3);              // têmporas
    }
    d += 0.03 * gauss(x, y + 0.48, z - 0.9, 0.25);                          // focinho/boca
    d += 0.03 * gauss(x, y - 0.55, z - 0.6, 0.45);                          // testa
    x *= 1 + d; y *= 1 + d; z *= 1 + d;
    // mandíbula: estreita embaixo e projeta o queixo
    if (y < 0) {
      const k = smooth01((-y - 0.05) / 0.85);
      x *= 1 - k * 0.22 / jaw;
      if (z > 0) z += k * 0.07 * jaw;
      y *= 1 + k * 0.05;
    }
    if (z < 0) z *= 1.07;                                                   // nuca
    p.setXYZ(i, x * 0.88 * r, y * 1.03 * r + yc, z * 0.98 * r);
  }
  g.computeVertexNormals();
  group.add(mesh(g, skin));
  const U = (x, y, z) => new THREE.Vector3(x * 0.88 * r, y * 1.03 * r + yc, z * 0.98 * r);

  /**
   * Casca moldada na cabeça (cabelo, barba): density(x,y,z) na esfera unitária
   * → 0 (sem) … 1 (cheio). A espessura acompanha a densidade, então o cabelo
   * afina até a pele na linha do cabelo, sem borda de papel.
   */
  const shell = (density, thick, mat) => {
    const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
    const P = new Float32Array(n * 3), D = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = Math.max(0, Math.min(1, density(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2])));
      D[i] = d;
      const o = thick * d * (2 - d) + 0.0012;   // afina até rente à pele na borda
      P[i * 3] = pos.getX(i) + nor.getX(i) * o; P[i * 3 + 1] = pos.getY(i) + nor.getY(i) * o; P[i * 3 + 2] = pos.getZ(i) + nor.getZ(i) * o;
    }
    const idx = g.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) if (D[idx[t]] > 0 && D[idx[t + 1]] > 0 && D[idx[t + 2]] > 0) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(P, 3));
    sg.setIndex(keep);
    sg.computeVertexNormals();
    const m = mesh(sg, mat); group.add(m); return m;
  };

  // nariz: esfera deformada (ponte estreita, ponta e asas mais largas)
  const ng = new THREE.SphereGeometry(1, 16, 12);
  const np = ng.attributes.position;
  for (let i = 0; i < np.count; i++) {
    const x = np.getX(i), y = np.getY(i), z = np.getZ(i);
    const t = (1 - y) / 2;                                                  // 0 topo … 1 base
    np.setXYZ(i, x * (0.45 + t * 0.75), y, z * (0.55 + t * 0.6) + (z < 0 ? 0 : t * 0.25));
  }
  ng.scale(0.0145 * nose, 0.029 * nose, 0.018 * nose);
  ng.computeVertexNormals();
  const noseM = mesh(ng, skin); noseM.position.copy(U(0, -0.16, 0.92)); noseM.rotation.x = -0.18; group.add(noseM);

  // orelhas
  for (const s of [-1, 1]) {
    const eg = new THREE.SphereGeometry(1, 12, 10, 0, Math.PI);
    eg.scale(0.012, 0.034, 0.022);
    const ear = mesh(eg, skin); ear.position.copy(U(s * 0.98, -0.02, -0.05)); ear.rotation.y = s > 0 ? -Math.PI / 2 + 0.35 : Math.PI / 2 - 0.35; group.add(ear);
  }

  // olhos: esclera, íris, pupila, pálpebras e sobrancelhas
  const sclera = new THREE.MeshStandardNodeMaterial({ color: 0xece4dc, roughness: 0.15 });
  const irisM = new THREE.MeshStandardNodeMaterial({ color: iris, roughness: 0.2, emissive: irisGlow ? iris : 0x000000, emissiveIntensity: irisGlow });
  const pupil = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.1 });
  const browM = hairMaterial(hairBrow, 0x6a6058, { along: 'z', rough: 0.9 });
  const eR = r * 0.105;
  for (const s of [-1, 1]) {
    const c = U(s * 0.35, 0.1, 0.8);
    const eye = new THREE.Group(); eye.position.copy(c); group.add(eye);
    eye.add(mesh(new THREE.SphereGeometry(eR, 14, 10), sclera));
    const ir = mesh(new THREE.CircleGeometry(eR * 0.55, 16), irisM, 0, 0, eR * 0.985); eye.add(ir);
    eye.add(mesh(new THREE.CircleGeometry(eR * 0.25, 12), pupil, 0, 0, eR * 0.99));
    // pálpebra superior (cobre o topo do olho) e inferior
    const up = mesh(new THREE.SphereGeometry(eR * 1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.36), skin); up.rotation.x = 0.12; eye.add(up);
    const lo = mesh(new THREE.SphereGeometry(eR * 1.06, 14, 6, 0, Math.PI * 2, Math.PI * 0.76, Math.PI * 0.24), skin); lo.rotation.x = -0.1; eye.add(lo);
    // sobrancelha: tubo curvo
    const curve = new THREE.CatmullRomCurve3([U(s * 0.16, 0.27, 0.95), U(s * 0.36, 0.33, 0.92), U(s * 0.56, 0.27, 0.8)]);
    group.add(mesh(new THREE.TubeGeometry(curve, 10, r * 0.034 * brow, 6), browM));
  }

  // boca: lábio superior fixo, interior escuro e lábio inferior na mandíbula
  const lipM = new THREE.MeshStandardNodeMaterial({ color: lip, roughness: 0.45 });
  const lipGeo = new THREE.CapsuleGeometry(0.0055, 0.03, 4, 10); lipGeo.rotateZ(Math.PI / 2);
  const ul = mesh(lipGeo, lipM); ul.position.copy(U(0, -0.47, 0.93)); ul.scale.set(1, 1, 0.8); group.add(ul);
  const inner = mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardNodeMaterial({ color: 0x2a0d0a, roughness: 0.8 }));
  inner.scale.set(0.02, 0.008, 0.01); inner.position.copy(U(0, -0.53, 0.86)); group.add(inner);
  const jawG = new THREE.Group(); jawG.name = 'jaw'; jawG.position.copy(U(0, -0.2, 0.05)); group.add(jawG);
  const ll = mesh(lipGeo, lipM); ll.position.copy(U(0, -0.58, 0.9).sub(jawG.position)); ll.scale.set(0.95, 1.15, 0.9); jawG.add(ll);
  return { group, jaw: jawG, yc, U, shell };
}
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// -----------------------------------------------------------------------------
// Mão com dedos
// -----------------------------------------------------------------------------
export function buildHand(mat, side, size = 1, curl = 0.35) {
  const h = new THREE.Group();
  const palm = mesh(new THREE.SphereGeometry(1, 14, 10), mat, 0, -0.045 * size, 0);
  palm.scale.set(0.02 * size, 0.048 * size, 0.042 * size); h.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group(); f.position.set(-side * 0.004 * size, -0.085 * size, (-0.027 + i * 0.018) * size); h.add(f);
    const len = (0.042 - Math.abs(i - 1.3) * 0.005) * size;
    const g1 = new THREE.CapsuleGeometry(0.0085 * size, len * 0.5, 3, 8); g1.translate(0, -len * 0.35, 0);
    f.add(mesh(g1, mat));
    const f2 = new THREE.Group(); f2.position.y = -len * 0.62; f.add(f2);
    const g2 = new THREE.CapsuleGeometry(0.0078 * size, len * 0.42, 3, 8); g2.translate(0, -len * 0.3, 0);
    f2.add(mesh(g2, mat));
    f.rotation.z = -side * curl * 0.9; f2.rotation.z = -side * curl * 1.2;     // dobra para dentro (palma)
  }
  const th = new THREE.Group(); th.position.set(-side * 0.006 * size, -0.03 * size, 0.035 * size); h.add(th);
  const tg = new THREE.CapsuleGeometry(0.01 * size, 0.03 * size, 3, 8); tg.translate(0, -0.022 * size, 0);
  th.add(mesh(tg, mat)); th.rotation.set(-0.4, 0, -side * 0.45);
  return h;
}

// -----------------------------------------------------------------------------
// Corpo completo
// -----------------------------------------------------------------------------
/**
 * @param {object} s especificação: proporções, materiais e roupas
 * @returns {{ root: THREE.Group, nodes: object, head: object, hipY: number }}
 */
export function buildBody(s) {
  const root = new THREE.Group(); root.name = 'npcBody';
  const nodes = {};
  const node = (name, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Group(); o.name = name; o.position.set(x, y, z); parent.add(o); nodes[name] = o; return o; };
  const { thigh, shin, foot, torsoH, shoulder, upper, fore, W = 1, D = 1 } = s.dims;
  const hipY = thigh + shin + foot;
  const hips = node('hips', root, 0, hipY, 0);
  const torso = node('torso', hips, 0, 0.1, 0);

  // pelve + calça
  hips.add(mesh(lathe([[0.12 * W, -0.16], [0.15 * W, -0.06], [0.155 * W, 0.04], [0.145 * W, 0.12]], { sz: 0.7 * D }), s.mats.pants));
  // tronco (camisa/casaco)
  const tp = s.torsoProfile || [[0.135, -0.12], [0.14, 0.02], [0.155, 0.18], [0.18, 0.32], [0.195, 0.42], [0.19, 0.48], [0.14, 0.53], [0.06, 0.56], [0.0, 0.565]];
  torso.add(mesh(lathe(tp.map(([r, y]) => [r * W, y * torsoH / 0.56]), { sz: 0.66 * D }), s.mats.torso));

  // pescoço e cabeça
  const neck = node('neck', torso, 0, torsoH + 0.02, 0);
  neck.add(mesh(lathe([[0.052 * s.neckW, -0.06], [0.05 * s.neckW, 0.02], [0.047 * s.neckW, 0.09]], { sz: 0.95 }), s.mats.skin));
  const head = node('head', neck, 0, 0.07, 0.01);
  const H = sculptHead({ skin: s.mats.face || s.mats.skin, ...s.head });
  head.add(H.group);

  // braços
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const arm = node(`arm${side}`, torso, sx * shoulder, torsoH * 0.84, -0.01);
    const delt = mesh(new THREE.SphereGeometry(0.075 * s.armW, 14, 10), s.mats.sleeve); delt.scale.set(1.05, 0.95, 1.1); delt.position.y = -0.02; arm.add(delt);
    arm.add(mesh(lathe([[0.048 * s.armW, -upper], [0.056 * s.armW, -upper * 0.75], [0.062 * s.armW, -upper * 0.4], [0.064 * s.armW, -0.05], [0.05 * s.armW, 0.02]], { sz: 0.95 }), s.mats.sleeve));
    const foreN = node(`fore${side}`, arm, 0, -upper, 0);
    foreN.add(mesh(new THREE.SphereGeometry(0.05 * s.armW, 10, 8), s.mats.foreUpper || s.mats.sleeve));   // cotovelo
    foreN.add(mesh(lathe([[0.034 * s.armW, -fore], [0.038 * s.armW, -fore * 0.85], [0.05 * s.armW, -fore * 0.35], [0.052 * s.armW, -0.04], [0.046 * s.armW, 0.02]], { sz: 0.9 }), s.mats.forearm));
    const hand = node(`hand${side}`, foreN, 0, -fore - 0.005, 0);
    hand.add(buildHand(s.mats.hand, sx, s.handSize || 1, s.curl ?? 0.35));
  }

  // pernas
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const leg = node(`leg${side}`, hips, sx * 0.085 * W, -0.04, 0);
    leg.add(mesh(lathe([[0.058 * s.legW, -thigh + 0.02], [0.068 * s.legW, -thigh * 0.7], [0.082 * s.legW, -thigh * 0.3], [0.086 * s.legW, -0.02], [0.07 * s.legW, 0.06]], { sz: 0.95 }), s.mats.pants));
    const shinN = node(`shin${side}`, leg, 0, -thigh + 0.04, 0);
    shinN.add(mesh(new THREE.SphereGeometry(0.06 * s.legW, 10, 8), s.mats.pants));   // joelho
    // bota: cano + pé + sola
    const bt = s.bootTop ?? shin;   // altura do cano
    shinN.add(mesh(lathe([[0.05 * s.legW, -shin - 0.0], [0.052 * s.legW, -shin * 0.8], [0.064 * s.legW, -shin * 0.45], [0.066 * s.legW, -shin + bt - 0.02], [0.07 * s.legW, -shin + bt]], { sz: 0.98 }), s.mats.boots));
    const fz = 0.05 * s.footL;
    const ft = mesh(new THREE.SphereGeometry(1, 16, 10), s.mats.boots, 0, -shin - foot * 0.45, fz);
    ft.scale.set(0.058 * s.legW, foot * 0.62, 0.13 * s.footL); shinN.add(ft);
    const sole = mesh(new THREE.CylinderGeometry(1, 1, 1, 16), s.mats.sole || s.mats.boots, 0, -shin - foot + 0.012, fz);
    sole.scale.set(0.062 * s.legW, 0.024, 0.135 * s.footL); shinN.add(sole);
    nodes[`foot${side}`] = ft;
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, nodes, head: H, hipY };
}
