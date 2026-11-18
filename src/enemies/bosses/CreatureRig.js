/**
 * CreatureRig.js
 * Base para chefes-criatura procedurais (escorpião, alien, fera de fogo):
 *  - materiais TSL: carapaça com relevo por ruído + VEIAS emissivas pulsando;
 *  - segmentos (cápsulas afinando), cadeias articuladas (cauda/tentáculo/braço),
 *    espinhos e garras;
 *  - pernas de 2 ossos com IK (o pé procura o chão) e ciclo de passada;
 *  - utilitário `ease` para poses-chave dos ataques.
 * Convenção: a criatura olha para +Z; +Y é para cima.
 */
import * as THREE from 'three/webgpu';
import { color, mix, smoothstep, mx_noise_float, positionLocal, time, sin, float, uniform, abs } from 'three/tsl';

// ---------------------------------------------------------------------------
// Materiais
// ---------------------------------------------------------------------------
/**
 * Carapaça com veias brilhantes.
 * @param {object} o { base, dark, glow, glowK, veinScale, rough, metal, pulse }
 */
export function veinMaterial({ base = 0x2a2a30, dark = 0x101014, glow = 0xa040ff, glowK = 2.5, veinScale = 2.2, rough = 0.45, metal = 0.25, pulse = 1.6, flat = false } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: metal, flatShading: flat });
  const p = positionLocal.mul(veinScale);
  const n1 = mx_noise_float(p), n2 = mx_noise_float(p.mul(3.1).add(7.3));
  // manchas da carapaça
  m.colorNode = mix(color(dark), color(base), smoothstep(-0.4, 0.5, n1.add(n2.mul(0.35))));
  // veias: linhas finas onde o ruído cruza zero
  const vein = smoothstep(0.09, 0.0, abs(n1)).mul(smoothstep(-0.2, 0.3, n2));
  const k = uniform(1);
  m.emissiveNode = color(glow).mul(vein).mul(sin(time.mul(pulse)).mul(0.3).add(0.85)).mul(glowK).mul(k);
  m.userData.glowK = k;
  return m;
}

/** Brasa: pele vermelho-escura rachada com fendas amarelo-laranja (fera de fogo / lava). */
export function emberMaterial({ crust = 0x2a0a04, hot = 0xff5a10, core = 0xffd060, scale = 1.6, k = 3 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0.05 });
  const p = positionLocal.mul(scale);
  const n = mx_noise_float(p.add(time.mul(0.05))), n2 = mx_noise_float(p.mul(2.7).sub(time.mul(0.12)));
  const crack = smoothstep(0.14, 0.0, abs(n)).add(smoothstep(0.07, 0.0, abs(n2)).mul(0.6));
  m.colorNode = mix(color(crust), color(0x5a1606), smoothstep(-0.3, 0.6, n2));
  const heat = sin(time.mul(2.2).add(n2.mul(6))).mul(0.25).add(0.9);
  const kk = uniform(1);
  m.emissiveNode = mix(color(hot), color(core), crack.mul(crack)).mul(crack).mul(heat).mul(k).mul(kk);
  m.userData.glowK = kk;
  return m;
}

export const glowMat = (c, k = 3) => new THREE.MeshStandardNodeMaterial({ color: 0x111111, emissive: c, emissiveIntensity: k, roughness: 0.3 });
export const boneMat = (c = 0x3a3638) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.55, metalness: 0.2 });

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------
const _segCache = new Map();
/** Segmento afinando de comprimento 1 ao longo de +Z (0→1), raio r0→r1, com anéis (nervuras). */
export function segGeo(r0, r1, ribs = 0, sides = 10) {
  const key = `${r0}|${r1}|${ribs}|${sides}`;
  if (_segCache.has(key)) return _segCache.get(key);
  const pts = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let r = THREE.MathUtils.lerp(r0, r1, t) * Math.sin(Math.min(1, t * 6, (1 - t) * 6 + 0.35) * Math.PI / 2 * 0.98 + 0.02);
    if (ribs) r *= 1 + 0.08 * Math.max(0, Math.sin(t * Math.PI * 2 * ribs));
    pts.push(new THREE.Vector2(Math.max(0.001, r), t));
  }
  const g = new THREE.LatheGeometry(pts, sides);
  g.rotateX(Math.PI / 2);          // eixo da lathe (+Y) → +Z
  g.computeVertexNormals();
  _segCache.set(key, g);
  return g;
}

export function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; }

/** Segmento de comprimento `len` ao longo de +Z dentro de `parent`. */
export function segment(parent, len, r0, r1, mat, ribs = 0) {
  const m = new THREE.Mesh(segGeo(r0, r1, ribs), mat);
  m.scale.set(1, 1, len);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Espinho cônico apontando para `dir` (local). */
export function spike(parent, pos, dir, len, r, mat) {
  const g = new THREE.ConeGeometry(r, len, 6); g.translate(0, len / 2, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = true;
  m.position.copy(pos);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  parent.add(m);
  return m;
}

/** Garra curva (cone dobrado em 3 pedaços). */
export function claw(parent, len, r, mat, curl = 0.5) {
  const g = new THREE.Group(); parent.add(g);
  let p = g;
  for (let i = 0; i < 3; i++) {
    const j = new THREE.Group(); j.position.z = i ? len / 3 : 0; j.rotation.x = i ? curl : 0; p.add(j);
    const c = new THREE.ConeGeometry(r * (1 - i * 0.3), len / 3 + 0.02, 6); c.rotateX(Math.PI / 2); c.translate(0, 0, len / 6);
    const m = new THREE.Mesh(c, mat); m.castShadow = true; j.add(m);
    p = j;
  }
  return g;
}

/**
 * Cadeia articulada (cauda, tentáculo, pescoço). Cada junta é um Group filho da anterior,
 * deslocada `len` em +Z. Retorna a lista de juntas (anime rotation.x / rotation.y).
 */
export function chain(parent, { n, len, r0, r1, mat, ribs = 1, spikeMat = null, spikeLen = 0 }) {
  const joints = [];
  let p = parent;
  for (let i = 0; i < n; i++) {
    const j = new THREE.Group();
    if (i) j.position.z = len;
    p.add(j);
    const t0 = i / n, t1 = (i + 1) / n;
    segment(j, len * 1.08, THREE.MathUtils.lerp(r0, r1, t0), THREE.MathUtils.lerp(r0, r1, t1), mat, ribs);
    if (spikeMat && spikeLen) spike(j, new THREE.Vector3(0, THREE.MathUtils.lerp(r0, r1, t0) * 0.85, len * 0.5), new THREE.Vector3(0, 1, -0.4), spikeLen * (1 - t0 * 0.6), 0.06 + r0 * 0.08, spikeMat);
    joints.push(j);
    p = j;
  }
  return joints;
}

// ---------------------------------------------------------------------------
// Pernas com IK de 2 ossos
// ---------------------------------------------------------------------------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Perna: quadril (Group) → coxa (L1, ao longo de −Y) → canela (L2) → pé.
 * @param {THREE.Object3D} body parente (o corpo)
 * @param {THREE.Vector3} hip posição do quadril no corpo
 * @param {object} o { L1, L2, r, mat, knee: Vector3 direção do joelho no corpo, foot: fn(endGroup) }
 */
export function leg(body, hip, { L1, L2, r = 0.2, mat, knee = new THREE.Vector3(0, 0, 1), foot = null }) {
  const h = new THREE.Group(); h.position.copy(hip); body.add(h);
  const upper = new THREE.Group(); h.add(upper);
  const s1 = segment(upper, L1, r, r * 0.75, mat, 1); s1.rotation.x = Math.PI / 2;   // +Z → −Y
  const kneeJ = new THREE.Group(); kneeJ.position.y = -L1; upper.add(kneeJ);
  const s2 = segment(kneeJ, L2, r * 0.75, r * 0.45, mat, 2); s2.rotation.x = Math.PI / 2;
  const end = new THREE.Group(); end.position.y = -L2; kneeJ.add(end);
  foot?.(end);
  return { hip: h, upper, knee: kneeJ, end, L1, L2, kneeHint: knee.clone().normalize(), rest: hip.clone().add(new THREE.Vector3(0, -(L1 + L2) * 0.85, 0)), phase: 0 };
}

/**
 * Resolve a IK: `targetBody` (posição do pé no espaço do corpo).
 * O joelho dobra na direção `kneeHint`.
 */
export function solveLeg(L, targetBody) {
  const hipP = L.hip.position;
  const d = _a.subVectors(targetBody, hipP);
  let D = d.length();
  const maxD = (L.L1 + L.L2) * 0.999;
  if (D > maxD) { d.multiplyScalar(maxD / D); D = maxD; }
  D = Math.max(D, Math.abs(L.L1 - L.L2) + 0.01);
  const dn = d.clone().normalize();
  // plano do joelho
  const perp = _b.copy(L.kneeHint).addScaledVector(dn, -L.kneeHint.dot(dn));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
  perp.normalize();
  const cosA = THREE.MathUtils.clamp((L.L1 * L.L1 + D * D - L.L2 * L.L2) / (2 * L.L1 * D), -1, 1);
  const a = Math.acos(cosA);
  const kneeP = _c.copy(dn).multiplyScalar(L.L1 * Math.cos(a)).addScaledVector(perp, L.L1 * Math.sin(a));   // relativo ao quadril
  const u = kneeP.clone().normalize();
  const l = d.clone().sub(kneeP).normalize();
  L.upper.quaternion.setFromUnitVectors(DOWN, u);
  _qi.copy(L.upper.quaternion).invert();
  L.knee.quaternion.copy(_qi).multiply(_q.setFromUnitVectors(DOWN, l));
}

/**
 * Passada: move cada pé num ciclo (fase própria). O pé fica no chão (altura real
 * do terreno) e levanta na volta. `speed` em m/s, `stride` em m.
 * @param {object} c { legs, body (Object3D), groundAt, t, speed, stride, lift }
 */
export function walkLegs({ legs, body, groundAt, t, speed, stride = 1.4, lift = 0.5, freq = null }) {
  const f = freq ?? Math.max(0.6, speed / Math.max(0.5, stride) * 0.5);
  const moving = Math.min(1, speed / 1.2);
  body.updateWorldMatrix(true, false);
  for (const L of legs) {
    const ph = t * f * Math.PI * 2 + L.phase;
    const sw = Math.sin(ph);
    const target = _c.copy(L.rest);
    target.z += Math.cos(ph) * stride * 0.5 * moving;
    // pé no chão de verdade (mundo → corpo)
    const w = body.localToWorld(target.clone());
    w.y = groundAt(w.x, w.z) + Math.max(0, sw) * lift * moving + 0.05;
    const tb = body.worldToLocal(w);
    solveLeg(L, tb);
  }
}

/** Interpolação exponencial (poses-chave suaves). */
export const ease = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
