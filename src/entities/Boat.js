/**
 * Boat.js
 * Navio pilotável.
 *
 * VISUAL: placeholder procedural de um veleiro de dois mastros (casco em V com
 * proa afilada e tosado, convés, amurada, castelo de popa, timão, mastros,
 * vergas, velas enfunadas, bujarrona e bandeira). A estrutura segue a referência
 * do Sketchfab (ID ad5990a0a0764743bf84dd397e78f3e3, Arthur Araújo). O modelo real
 * pode ser carregado com loadShipGLB() (comentado no fim deste arquivo).
 *
 * As peças são agrupadas em ESTÁGIOS de construção (quilha → casco → mastros →
 * velas), revelados pelo BoatBuilder.
 *
 * FÍSICA (arcade-realista):
 *  - throttle com resposta suave → empuxo; arrasto linear + quadrático;
 *  - leme com taxa de giro proporcional à velocidade (sem velocidade não vira);
 *  - flutuação por 4 pontos (proa, popa, bombordo, boreste) amostrando as mesmas
 *    ondas de Gerstner do shader → heave, pitch e roll com mola amortecida;
 *  - adernamento (heel) nas curvas;
 *  - encalhe: terreno raso na proa/popa bloqueia e faz o casco ricochetear.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { damp, clamp } from '../utils/Noise.js';
import { pbr } from '../world/PBRMaterials.js';
import { G } from '../vendor/tidewater/core/Globals.js';
import { positionLocal, normalLocal, uv, color, mix, smoothstep, fract, abs, sin, time, mx_noise_float, float, vec3 } from 'three/tsl';
// import { loadGLB, fitModel } from '../core/AssetLoader.js';

const B = CONFIG.boat;
const LENGTH = 20, BEAM = 5.6, DEPTH = 3;
const DECK_Y = 1.9;      // altura do convés relativa ao root

/** Fator de afinamento do casco ao longo do comprimento (t = -1 popa .. 1 proa). */
function hullTaper(t) {
  let k = 1;
  if (t > 0.25) k *= 1 - Math.pow((t - 0.25) / 0.75, 1.7) * 0.97;
  if (t < -0.7) k *= 1 - ((-t - 0.7) / 0.3) * 0.25;
  return k;
}

export class Boat {
  /**
   * @param {object} [opts]
   * @param {'player'|'ghost'} [opts.variant] visual e facção
   */
  constructor(scene, terrain, ocean, { variant = 'player' } = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.ocean = ocean;
    this.variant = variant;
    this.faction = variant === 'player' ? 'ship-player' : 'ship-ghost';   // fantasmas e piratas = inimigos

    // ---- Controle completo ----
    this.sailLevel = 0;          // -1 ré, 0 recolhida, 1 meia, 2 cheia
    this.anchored = false;
    this.rudderLocked = false;

    // ---- Casco ----
    this.hullMax = CONFIG.shipCombat.hullMax;
    this.hull = this.hullMax;
    this.alive = false;          // vira true quando construído (alvo de combate)
    this.sinking = false;
    this.sinkT = 0;
    this.onSunk = () => {};
    this._spheres = [-8, -4, 0, 4, 8].map((z) => ({ lz: z, x: 0, y: 0, z: 0, r: 3.0 }));
    this._flashT = 0;

    // ---- Estado físico ----
    this.heading = 0;
    this.speed = 0;
    this.throttle = 0;
    this.rudder = 0;
    this.y = 0; this.vy = 0;
    this.pitch = 0; this.vPitch = 0;
    this.roll = 0; this.vRoll = 0;
    this.driven = false;
    this.built = false;

    this.root = new THREE.Group();
    this.root.name = 'ship';
    this.root.rotation.order = 'YXZ';
    this.model = new THREE.Group();
    this.root.add(this.model);
    this.stages = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()];
    this.stages.forEach((s) => this.model.add(s));

    this._buildModel();

    // Âncora do timoneiro (o Player vira filho deste nó)
    this.helmAnchor = new THREE.Group();
    this.helmAnchor.position.set(0, DECK_Y + 0.08, -5.6);
    this.model.add(this.helmAnchor);

    this.root.visible = false;
    scene.add(this.root);

    // Pontos de amostragem da flutuação (local XZ)
    this._probes = { bow: [0, 8.5], stern: [0, -8.5], port: [2.6, 0], star: [-2.6, 0] };
  }

  // ===========================================================================
  // Modelo procedural
  // ===========================================================================
  _buildModel() {
    const ghost = this.variant === 'ghost';
    // Navio fantasma: madeira apodrecida, velas rasgadas e esverdeadas, brilho espectral
    // Madeira PBR (hardwood2 dos exemplos do three.js); o navio fantasma usa a mesma textura, escurecida
    const wood = pbr('wood', ghost ? 0x4a4438 : 0xb07a50, 1.4);
    const darkWood = pbr('wood', ghost ? 0x2a2620 : 0x5a3c28, 1.2);
    const deckWood = pbr('wood', ghost ? 0x5a5446 : 0xe0c098, 1.0);
    const pirate = this.variant === 'pirate';
    const hullPaint = new THREE.MeshStandardNodeMaterial({ color: ghost ? 0x141a16 : pirate ? 0x3a1210 : 0x1f2e3a, roughness: 0.6, emissive: ghost ? 0x03140a : 0x000000 });
    {
      // tábuas horizontais (frestas escuras), veios e desgaste; abaixo da linha d'água, chapas de cobre esverdeado
      const p = positionLocal;
      const plank = fract(p.y.mul(3.2));
      const seam = smoothstep(0.0, 0.06, plank).mul(smoothstep(1.0, 0.94, plank));
      const butt = smoothstep(0.0, 0.03, fract(p.z.mul(0.28).add(fract(p.y.mul(3.2).floor().mul(0.37)))));
      const grain = mx_noise_float(vec3(p.x.mul(0.6), p.y.mul(8), p.z.mul(0.5))).mul(0.12).add(0.94);
      const paint = color(ghost ? 0x141a16 : pirate ? 0x3a1210 : 0x1f2e3a).mul(seam.mul(butt).mul(0.45).add(0.55)).mul(grain);
      const copper = mix(color(0x7a4a2a), color(0x3a7a5a), smoothstep(-0.3, 0.6, mx_noise_float(p.mul(1.7))));
      const band = smoothstep(-0.55, -0.75, p.y);
      hullPaint.colorNode = mix(paint, copper.mul(seam.mul(0.3).add(0.7)), ghost ? float(0) : band);
      hullPaint.metalnessNode = band.mul(ghost ? 0 : 0.6);
      hullPaint.roughnessNode = mix(float(0.65), float(0.35), band);
    }
    const sailMat = new THREE.MeshStandardNodeMaterial({
      color: ghost ? 0x8fa294 : pirate ? 0x1e1c1c : 0xefe6cf, roughness: 1, side: THREE.DoubleSide,
      transparent: ghost, opacity: ghost ? 0.72 : 1, emissive: ghost ? 0x0a2a14 : 0x000000,
    });
    {
      const u = uv();
      const panel = smoothstep(0.0, 0.025, abs(fract(u.x.mul(7)).sub(0.5)).mul(2).oneMinus().oneMinus());   // costuras verticais
      const stain = mx_noise_float(vec3(u.x.mul(5), u.y.mul(4), 0.3)).mul(0.08);
      const reef = smoothstep(0.012, 0.0, abs(fract(u.y.mul(4)).sub(0.5).mul(2).sub(0.85)));                      // linhas de rizes
      sailMat.colorNode = color(ghost ? 0x8fa294 : pirate ? 0x1e1c1c : 0xefe6cf).mul(float(1).sub(stain)).mul(panel.mul(0.12).add(0.88)).mul(float(1).sub(reef.mul(0.15)));
      // ondulação: o pano tremula com o vento (mais forte nas bordas livres)
      const edge = u.y.oneMinus().mul(u.x.sub(0.5).abs().mul(2).add(0.3));
      const ripple = sin(time.mul(4.2).add(u.x.mul(9)).add(u.y.mul(5))).mul(0.06).add(sin(time.mul(7.3).add(u.y.mul(13))).mul(0.025));
      sailMat.positionNode = positionLocal.add(normalLocal.mul(ripple.mul(edge).mul(G.windSpeed.div(8))));
    }
    const ropeMat = new THREE.MeshStandardNodeMaterial({ color: 0x8a7a5a, roughness: 1 });
    const brass = new THREE.MeshStandardNodeMaterial({ color: 0xc9a14a, metalness: 0.6, roughness: 0.35, emissive: 0x2a1c05 });
    const flagMat = new THREE.MeshStandardNodeMaterial({ color: ghost || pirate ? 0x0c0c0c : 0xa8322a, roughness: 0.9, side: THREE.DoubleSide });
    this.hullMaterials = [hullPaint, wood, deckWood];

    const add = (stage, mesh) => {
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.stages[stage].add(mesh);
      return mesh;
    };

    // ---------------- Estágio 0: quilha ----------------
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, LENGTH * 0.9), darkWood);
    keel.position.set(0, -1.05, -0.4);
    add(0, keel);
    // Cavernas (costelas) visíveis durante a construção
    this.ribs = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const z = -8 + i * 2;
      const w = BEAM * hullTaper(z / (LENGTH / 2));
      const rib = new THREE.Mesh(new THREE.TorusGeometry(w / 2, 0.08, 4, 12, Math.PI), darkWood);
      rib.rotation.z = Math.PI;
      rib.position.set(0, 1.3, z);
      rib.castShadow = true;
      this.ribs.add(rib);
    }
    this.stages[0].add(this.ribs);

    // ---------------- Estágio 1: casco + convés ----------------
    const hullGeo = new THREE.BoxGeometry(BEAM, DEPTH, LENGTH, 8, 5, 30);
    const p = hullGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const t = z / (LENGTH / 2);
      const yN = (y + DEPTH / 2) / DEPTH;                // 0 fundo .. 1 borda
      const vShape = 0.3 + 0.7 * Math.pow(yN, 0.55);     // fundo em V
      x *= hullTaper(t) * vShape;
      y += yN * t * t * 1.1;                             // tosado: proa e popa sobem
      if (yN < 0.5) y += Math.pow(Math.max(t, 0), 3) * 1.3; // proa sai da água
      p.setXYZ(i, x, y, z);
    }
    hullGeo.computeVertexNormals();
    const hull = new THREE.Mesh(hullGeo, hullPaint);
    hull.position.y = 0.4;
    add(1, hull);

    // Faixa de madeira (cinta) acima da linha d'água
    const wale = new THREE.Mesh(hullGeo.clone(), wood);
    wale.scale.set(1.015, 0.25, 1.005);
    wale.position.y = 1.55;
    add(1, wale);

    // Convés: contorno seguindo o afinamento do casco
    const shape = new THREE.Shape();
    const N = 24, half = LENGTH / 2 - 0.4;
    for (let i = 0; i <= N; i++) {
      const z = -half + (i / N) * half * 2;
      const w = (BEAM / 2) * hullTaper(z / (LENGTH / 2)) * 0.96;
      i === 0 ? shape.moveTo(w, -z) : shape.lineTo(w, -z);
    }
    for (let i = N; i >= 0; i--) {
      const z = -half + (i / N) * half * 2;
      shape.lineTo(-(BEAM / 2) * hullTaper(z / (LENGTH / 2)) * 0.96, -z);
    }
    const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false });
    deckGeo.rotateX(-Math.PI / 2);
    const deck = new THREE.Mesh(deckGeo, deckWood);
    deck.position.y = DECK_Y - 0.15;
    add(1, deck);

    // Amurada (corrimão) com balaústres
    for (const sx of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const z = -half + (i / 16) * half * 2;
        pts.push(new THREE.Vector3(sx * (BEAM / 2) * hullTaper(z / (LENGTH / 2)) * 0.93, DECK_Y + 0.85, z));
      }
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.06, 5), wood);
      add(1, rail);
      for (let i = 0; i < pts.length; i += 1) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.85, 5), wood);
        post.position.set(pts[i].x, DECK_Y + 0.42, pts[i].z);
        add(1, post);
      }
    }

    // Castelo de popa (cabine)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.9, 3.4), wood);
    cabin.position.set(0, DECK_Y + 0.95, -7.6);
    add(1, cabin);
    const cabinRoof = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.15, 3.7), darkWood);
    cabinRoof.position.set(0, DECK_Y + 1.95, -7.6);
    add(1, cabinRoof);
    for (const sx of [-1, 1]) {   // janelas
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.7), new THREE.MeshStandardNodeMaterial({ color: 0xffd27a, emissive: 0x6b4a10 }));
      win.position.set(sx * 2.01, DECK_Y + 1.1, -7.6);
      add(1, win);
    }

    // Leme (fica sob a água e gira com o timão)
    this.rudderMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 1.2), darkWood);
    this.rudderMesh.geometry.translate(0, 0, -0.6);
    this.rudderMesh.position.set(0, -0.2, -LENGTH / 2 + 0.2);
    add(1, this.rudderMesh);

    // ---------------- Estágio 2: mastros, vergas, timão, gurupés ----------------
    const mast = (z, h) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, h, 8), wood);
      m.position.set(0, DECK_Y + h / 2, z);
      add(2, m);
      return m;
    };
    mast(1.2, 14);
    mast(5.6, 10.5);
    const yard = (z, y, w) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, w, 6), wood);
      m.rotation.z = Math.PI / 2;
      m.position.set(0, DECK_Y + y, z);
      add(2, m);
    };
    yard(1.2, 12.6, 7.5); yard(1.2, 7.4, 8.5);
    yard(5.6, 9.4, 6); yard(5.6, 5.4, 6.8);

    // Gurupés (bowsprit)
    const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 6, 6), wood);
    sprit.rotation.x = Math.PI / 2 - 0.25;
    sprit.position.set(0, DECK_Y + 0.9, LENGTH / 2 + 1.6);
    add(2, sprit);

    // Cordame (estais) simples: linhas da ponta dos mastros até a amurada
    const ropeLine = (a, b) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 3), ropeMat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      add(2, m);
    };
    for (const sx of [-1, 1]) {
      ropeLine(new THREE.Vector3(0, DECK_Y + 13.5, 1.2), new THREE.Vector3(sx * 2.6, DECK_Y + 0.8, -1));
      ropeLine(new THREE.Vector3(0, DECK_Y + 10, 5.6), new THREE.Vector3(sx * 2.3, DECK_Y + 0.8, 4));
    }
    ropeLine(new THREE.Vector3(0, DECK_Y + 13.5, 1.2), new THREE.Vector3(0, DECK_Y + 2.1, LENGTH / 2 + 4.2));

    // Timão: roda com 8 raios + pedestal; gira conforme o leme
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), darkWood);
    stand.position.set(0, DECK_Y + 0.55, -4.75);
    add(2, stand);
    this.wheel = new THREE.Group();
    this.wheel.position.set(0, DECK_Y + 1.25, -4.6);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 20), brass);
    ring.castShadow = true;
    this.wheel.add(ring);
    for (let i = 0; i < 8; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.45, 4), darkWood);
      spoke.rotation.z = (i / 8) * Math.PI;
      spoke.castShadow = true;
      this.wheel.add(spoke);
    }
    this.stages[2].add(this.wheel);

    // ---------------- Estágio 3: velas e bandeira ----------------
    this.sails = [];
    const sail = (z, y, w, h) => {
      const geo = new THREE.PlaneGeometry(w, h, 10, 8);
      const sp = geo.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const u = sp.getX(i) / w + 0.5, v = sp.getY(i) / h + 0.5;
        sp.setZ(i, Math.sin(u * Math.PI) * Math.sin(v * Math.PI * 0.9 + 0.15) * 0.9);   // vela enfunada para frente
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, sailMat);
      m.position.set(0, DECK_Y + y, z + 0.25);
      add(3, m);
      this.sails.push(m);
    };
    sail(1.2, 10, 7.2, 5); sail(1.2, 4.9, 8.2, 4.8);
    sail(5.6, 7.4, 5.8, 3.8); sail(5.6, 3.6, 6.5, 3.4);

    // Bujarrona (vela triangular) do gurupés ao mastro de proa
    const jibGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, DECK_Y + 2.1, LENGTH / 2 + 4.0),
      new THREE.Vector3(0, DECK_Y + 9.8, 5.8),
      new THREE.Vector3(0, DECK_Y + 1.2, 6.2),
    ]);
    jibGeo.computeVertexNormals();
    jibGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 0, 0.5, 1, 0, 0], 2));
    add(3, new THREE.Mesh(jibGeo, sailMat));

    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9, 8, 1), flagMat);
    this.flag.geometry.translate(0.8, 0, 0);
    this.flag.position.set(0, DECK_Y + 14.6, 1.2);
    add(3, this.flag);
    this._flagBase = Float32Array.from(this.flag.geometry.attributes.position.array);

    this._buildDetails(add, { wood, darkWood, ropeMat, brass, ghost, pirate });
    if (ghost) this._buildGhostExtras(add);
  }

  /** Detalhes: portinholas, enfrechates, cesto da gávea, lanternas de popa, carga no convés. */
  _buildDetails(add, { wood, darkWood, ropeMat, brass, ghost, pirate }) {
    const half = LENGTH / 2 - 0.4;
    // portinholas dos canhões (com tampas abertas)
    const portMat = new THREE.MeshStandardNodeMaterial({ color: 0x0a0806, roughness: 1 });
    for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
      const z = -5 + i * 2.4, w = (BEAM / 2) * hullTaper(z / (LENGTH / 2)) * 1.0;
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.6), portMat); port.position.set(sx * w, DECK_Y - 0.35, z); add(1, port);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.66), darkWood); lid.position.set(sx * (w + 0.18), DECK_Y - 0.02, z); lid.rotation.z = sx * -0.6; add(1, lid);
    }
    // enfrechates (escadas de corda) entre os ovéns: degraus horizontais
    const rope = (a, b, r = 0.015) => {
      const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 3), ropeMat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m.castShadow = false;
      add(2, m);
    };
    for (const [mz, top, base, bz] of [[1.2, 13.5, 2.6, -1], [5.6, 10, 2.3, 4]]) for (const sx of [-1, 1]) {
      const A = new THREE.Vector3(0, DECK_Y + top, mz), B = new THREE.Vector3(sx * base, DECK_Y + 0.8, bz);
      const A2 = A.clone().add(new THREE.Vector3(0, 0, 0.9)), B2 = B.clone().add(new THREE.Vector3(0, 0, 1.2));
      rope(A2, B2);
      for (let k = 1; k < 14; k++) { const t = k / 14; rope(A.clone().lerp(B, t), A2.clone().lerp(B2, t), 0.01); }
    }
    // estais de popa e cabos das vergas
    rope(new THREE.Vector3(0, DECK_Y + 13.5, 1.2), new THREE.Vector3(0, DECK_Y + 2.2, -half + 0.4), 0.02);
    rope(new THREE.Vector3(0, DECK_Y + 10, 5.6), new THREE.Vector3(0, DECK_Y + 13, 1.2), 0.02);
    for (const sx of [-1, 1]) { rope(new THREE.Vector3(sx * 3.7, DECK_Y + 12.6, 1.2), new THREE.Vector3(0, DECK_Y + 14, 1.2), 0.012); rope(new THREE.Vector3(sx * 4.2, DECK_Y + 7.4, 1.2), new THREE.Vector3(sx * 2.4, DECK_Y + 0.9, 0), 0.012); }
    // cesto da gávea
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.7, 0.5, 12, 1, true), wood); top.position.set(0, DECK_Y + 11.4, 1.2); add(2, top);
    const topFloor = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 12), darkWood); topFloor.position.set(0, DECK_Y + 11.15, 1.2); add(2, topFloor);
    // lanternas de popa (acendem à noite)
    const lampMat = new THREE.MeshStandardNodeMaterial({ color: 0x332211, emissive: ghost ? 0x30ff90 : 0xffb050, emissiveIntensity: 0, roughness: 0.3 });
    this._lampMat = lampMat;
    this._lamps = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sx * 1.6, DECK_Y + 2.6, -half - 0.1);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.42, 6), lampMat));
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.2, 6), brass); cap.position.y = 0.3; g.add(cap);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), darkWood); arm.position.set(0, 0.42, 0.25); g.add(arm);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.stages[3].add(g);
    }
    this._sternLight = new THREE.PointLight(ghost ? 0x30ff90 : 0xffb060, 0, 22, 1.6);
    this._sternLight.position.set(0, DECK_Y + 2.8, -half);
    this.stages[3].add(this._sternLight);
    // carga no convés: barris, caixotes e cordas enroladas
    const barrel = new THREE.LatheGeometry([0, 0.36, 0.42, 0.44, 0.42, 0.36, 0].map((r, i, a) => new THREE.Vector2(Math.max(0.001, r), i / (a.length - 1) * 0.95)), 12);
    const hoop = new THREE.MeshStandardNodeMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.5 });
    for (const [x, z] of [[1.6, -2.6], [1.2, -3.2], [-1.7, 2.8], [1.7, 7.2]]) {
      const b = new THREE.Mesh(barrel, wood); b.position.set(x, DECK_Y, z); add(1, b);
      for (const y of [0.18, 0.75]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.02, 4, 16), hoop); h.rotation.x = Math.PI / 2; h.position.set(x, DECK_Y + y, z); add(1, h); }
    }
    for (const [x, z, sz] of [[-1.5, -2.5, 0.7], [-1.4, -3.3, 0.55], [1.5, 3.4, 0.6]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), darkWood); c.position.set(x, DECK_Y + sz / 2, z); c.rotation.y = x; add(1, c); }
    for (const [x, z] of [[0.9, -1.8], [-0.9, 6.4], [0, -5.8]]) for (let k = 0; k < 4; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.32 - k * 0.04, 0.035, 4, 14), ropeMat); r.rotation.x = Math.PI / 2; r.position.set(x, DECK_Y + 0.04 + k * 0.06, z); add(1, r); }
    // carranca de proa
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), brass); head.scale.set(0.7, 0.9, 1.3); head.position.set(0, DECK_Y + 0.6, LENGTH / 2 + 0.6); add(1, head);
  }

  /** Lanterna espectral e tripulação esquelética (decorativa) do navio fantasma. */
  _buildGhostExtras(add) {
    const glow = new THREE.MeshStandardNodeMaterial({ color: 0x60ff90, emissive: 0x30ff70, emissiveIntensity: 3 });
    const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), glow);
    lantern.position.set(0, DECK_Y + 2.6, -9.2);
    add(1, lantern);
    const light = new THREE.PointLight(0x50ff80, 25, 30, 2);
    light.position.copy(lantern.position);
    this.stages[1].add(light);

    const bone = new THREE.MeshStandardNodeMaterial({ color: 0xd8d2bc, roughness: 0.8 });
    const eye = new THREE.MeshStandardNodeMaterial({ color: 0x60ff90, emissive: 0x40ff80, emissiveIntensity: 2 });
    this.crew = [];
    for (const [x, z] of [[1.5, -2], [-1.5, 0.5], [1.2, 3.5], [-1.2, -5.5], [0.5, 6.5]]) {
      const s = new THREE.Group();
      const ribs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.55, 6, 1, true), bone);
      ribs.position.y = 1.2;
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), bone);
      skull.position.y = 1.62;
      const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 3), eye); e1.position.set(0.05, 1.64, 0.11);
      const e2 = e1.clone(); e2.position.x = -0.05;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.08), bone); legs.position.y = 0.48;
      const arms = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), bone); arms.position.y = 1.35;
      s.add(ribs, skull, e1, e2, legs, arms);
      s.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      s.position.set(x, DECK_Y, z);
      s.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.stages[1].add(s);
      this.crew.push(s);
    }
  }

  /**
   * Volume fechado do interior do casco (no referencial do root), usado pelo
   * "hull mask" do Tidewater: a água não é desenhada dentro do navio, mesmo
   * quando as ondas sobem acima da linha d'água.
   */
  createHullVolumeGeometry() {
    const geo = new THREE.BoxGeometry(BEAM * 0.94, DECK_Y + 1.1, LENGTH - 0.6, 6, 2, 24);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      p.setX(i, p.getX(i) * hullTaper(z / (LENGTH / 2)));
    }
    geo.translate(0, (DECK_Y - 1.1) / 2 - 0.15, 0);
    return geo;
  }

  /** Ponto da linha central (popa↔proa) mais próximo de (x,z), em mundo. */
  closestHullPoint(x, z, out = new THREE.Vector3()) {
    const p = this.root.position, h = this.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const t = clamp((x - p.x) * fx + (z - p.z) * fz, -LENGTH / 2 + 1, LENGTH / 2 - 2);
    return out.set(p.x + fx * t, p.y + DECK_Y, p.z + fz * t);
  }

  // ===========================================================================
  // Combate: casco
  // ===========================================================================
  getHitSpheres() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading), p = this.root.position;
    for (const sp of this._spheres) {
      sp.x = p.x + sp.lz * s; sp.z = p.z + sp.lz * c; sp.y = p.y + 1.2;
    }
    return this._spheres;
  }

  takeDamage(amount, dir) {
    if (!this.alive || this.sinking) return;
    this.hull = Math.max(0, this.hull - amount);
    this._flashT = 0.2;
    this.vRoll += (Math.random() - 0.5) * 0.3;
    this.vPitch += (Math.random() - 0.5) * 0.15;
    this.onDamage?.(amount);
    if (this.hull <= 0) this.startSinking();
  }

  repair(amount) { this.hull = Math.min(this.hullMax, this.hull + amount); }

  startSinking() {
    if (this.sinking) return;
    this.sinking = true;
    this.sinkT = 0;
    this.sailLevel = 0;
  }

  /** Volta ao estado "não construído" (para reconstruir no estaleiro). */
  reset() {
    this.root.visible = false;
    this.built = false;
    this.alive = false;
    this.sinking = false;
    this.hull = this.hullMax;
    this.speed = 0; this.sailLevel = 0; this.anchored = false;
    this.root.position.y = 0;
  }

  // ===========================================================================
  // Construção
  // ===========================================================================
  /** Revela os estágios conforme o progresso (0..1). */
  setBuildProgress(p) {
    this.root.visible = true;
    const thresholds = [0.0, 0.25, 0.55, 0.85];
    this.stages.forEach((s, i) => { s.visible = p >= thresholds[i]; });
    this.ribs.visible = p < 0.45;             // as cavernas somem quando o casco fecha
    if (p >= 1) { this.built = true; this.alive = true; this.hull = this.hullMax; }
  }

  /** Posiciona o navio parado no canal. */
  placeAt(x, z, heading) {
    this.root.position.set(x, 0, z);
    this.heading = heading;
    this.y = this.ocean.getWaveHeight(x, z) + B.draft;
    this.root.position.y = this.y;
  }

  // ===========================================================================
  // Física
  // ===========================================================================
  _localToWorld(lx, lz, out) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    out.x = this.root.position.x + lx * c + lz * s;
    out.z = this.root.position.z - lx * s + lz * c;
    return out;
  }

  /** O casco toca o fundo neste ponto? */
  _grounded(x, z) {
    return this.terrain.getHeight(x, z) > B.groundClearance;
  }

  /** Muda o nível da vela (-1 ré … 2 cheia). */
  setSail(level) { this.sailLevel = clamp(level, -1, 2); }

  get sailName() {
    return { '-1': 'Remando de ré', 0: 'Recolhida', 1: 'Meia vela', 2: 'Vela cheia' }[this.sailLevel];
  }

  /**
   * @param {number} dt
   * @param {{steer:number}|null} controls  null = ninguém no leme
   * O nível de vela, a âncora e a trava do leme são estados do próprio navio
   * (setSail / anchored / rudderLocked), alterados pelo jogador ou pela IA.
   */
  update(dt, controls) {
    if (!this.root.visible) return;
    const pos = this.root.position;

    // ---------------- Comandos ----------------
    const steerIn = controls ? controls.steer : 0;
    const thrIn = this.anchored || this.sinking ? 0 : (B.sailThrottle[this.sailLevel] ?? 0);
    this.throttle = damp(this.throttle, thrIn, B.throttleResponse, dt);
    if (this.rudderLocked) this.rudder = clamp(this.rudder + steerIn * 0.8 * dt, -1, 1);   // trava: mantém o ângulo
    else this.rudder = damp(this.rudder, steerIn, 3, dt);

    // ---------------- Dinâmica longitudinal ----------------
    if (this.built) {
      const thrust = this.throttle * B.thrust * (this.throttle < 0 ? 0.5 : 1);
      let drag = B.linearDrag * this.speed + B.quadDrag * this.speed * Math.abs(this.speed);
      if (this.anchored) drag += this.speed * B.anchorDrag;          // âncora segura o navio
      if (this.sinking) drag += this.speed * 1.5;
      this.speed += (thrust - drag) * dt;
      this.speed = clamp(this.speed, B.maxReverseSpeed, B.maxForwardSpeed);

      // Leme: precisa de fluxo d'água para virar
      const flow = clamp(this.speed / 6, -1, 1);
      this.heading += this.rudder * B.turnRate * flow * dt;

      // Avanço + checagem de encalhe na proa/popa e nas laterais
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      const nx = pos.x + fx * this.speed * dt, nz = pos.z + fz * this.speed * dt;
      const probeZ = this.speed >= 0 ? 9.5 : -9.5;
      const tip = { x: nx + fx * probeZ, z: nz + fz * probeZ };
      const sideA = { x: nx + Math.cos(this.heading) * 2.4, z: nz - Math.sin(this.heading) * 2.4 };
      const sideB = { x: nx - Math.cos(this.heading) * 2.4, z: nz + Math.sin(this.heading) * 2.4 };
      if (this._grounded(tip.x, tip.z) || this._grounded(sideA.x, sideA.z) || this._grounded(sideB.x, sideB.z)) {
        this.speed *= -0.25;            // ricochete
        this.vPitch -= 0.4;             // tranco
        this.groundedFlag = 0.6;
      } else {
        pos.x = nx; pos.z = nz;
      }
      if (this.groundedFlag > 0) this.groundedFlag -= dt;
    }

    // ---------------- Flutuação (4 sondas) ----------------
    const o = this.ocean, tmp = { x: 0, z: 0 };
    const h = {};
    for (const k in this._probes) {
      const [lx, lz] = this._probes[k];
      this._localToWorld(lx, lz, tmp);
      h[k] = o.getWaveHeight(tmp.x, tmp.z);
    }
    const avg = (h.bow + h.stern + h.port + h.star) / 4;
    let targetY = avg + B.draft - Math.abs(this.speed) * 0.01;
    let targetPitch = Math.atan2(h.stern - h.bow, 17) - this.speed * 0.004;      // proa sobe com velocidade

    // ---------------- Afundamento ----------------
    if (this.sinking) {
      this.sinkT += dt;
      targetY -= this.sinkT * this.sinkT * 0.12;
      targetPitch += Math.min(0.5, this.sinkT * 0.06);
      if (this.sinkT > 10) {
        this.root.visible = false;
        this.alive = false;
        this.onSunk();
        return;
      }
    }
    const heel = -this.rudder * clamp(this.speed / B.maxForwardSpeed, -1, 1) * 0.12;
    const targetRoll = Math.atan2(h.port - h.star, 5.2) + heel;

    const k = B.buoyancyStiffness, c = B.buoyancyDamping;
    this.vy += ((targetY - this.y) * k - this.vy * c) * dt;
    this.y += this.vy * dt;
    this.vPitch += ((targetPitch - this.pitch) * k - this.vPitch * c) * dt;
    this.pitch += this.vPitch * dt;
    this.vRoll += ((targetRoll - this.roll) * k * 0.7 - this.vRoll * c * 0.8) * dt;
    this.roll += this.vRoll * dt;

    pos.y = this.y;
    this.root.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');

    // ---------------- Animações do aparelho ----------------
    if (this.wheel) this.wheel.rotation.z = -this.rudder * 2.4;
    if (this.rudderMesh) this.rudderMesh.rotation.y = -this.rudder * 0.6;
    // Velas: recolhidas encolhem verticalmente; enfunam com o vento (throttle)
    const furl = { '-1': 0.12, 0: 0.12, 1: 0.6, 2: 1 }[this.sailLevel];
    const fill = 0.35 + Math.abs(this.throttle) * 0.75;
    for (const s of this.sails) {
      s.scale.z = damp(s.scale.z, fill, 2, dt);
      s.scale.y = damp(s.scale.y, furl, 3, dt);
    }
    this._waveFlag(o.time);
    if (this._lampMat) { const n = G.night.value; this._lampMat.emissiveIntensity = 0.2 + n * 3; this._sternLight.intensity = n * 35; }
    this.cannons?.update(dt);
    this.mixer?.update(dt);          // animações embutidas de um .glb (se houver)

    // Flash vermelho no casco ao levar dano
    if (this._flashT > 0) {
      this._flashT -= dt;
      const on = this._flashT > 0;
      const base = this.variant === 'ghost' ? 0x03140a : 0x000000;
      for (const m of this.hullMaterials) m.emissive.setHex(on ? 0x801010 : (m === this.hullMaterials[0] ? base : 0x000000));
    }
    // Tripulação fantasma balança
    if (this.crew) this.crew.forEach((c, i) => { c.rotation.z = Math.sin(o.time * 2 + i) * 0.15; });
  }

  get velocity() {
    return new THREE.Vector3(Math.sin(this.heading) * this.speed, 0, Math.cos(this.heading) * this.speed);
  }

  _waveFlag(t) {
    const pos = this.flag.geometry.attributes.position;
    const base = this._flagBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      pos.setZ(i, Math.sin(x * 3 - t * 7) * 0.15 * x);
    }
    pos.needsUpdate = true;
  }

  /**
   * Procura um ponto de terra firme perto do navio para desembarcar.
   * @param {(x:number,z:number)=>number} groundHeight altura caminhável
   * @returns {{x:number,z:number}|null}
   */
  findDisembarkPoint(groundHeight) {
    const pos = this.root.position;
    for (let r = 5; r <= 42; r += 2.5) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const x = pos.x + Math.cos(ang) * r, z = pos.z + Math.sin(ang) * r;
        const g = groundHeight(x, z);
        if (g > 0.4 && this.terrain.getSlope(x, z) < 0.7) return { x, z };
      }
    }
    return null;
  }

  /*
   * ---------------------------------------------------------------------------
   * Carregamento do modelo real (.glb)
   * ---------------------------------------------------------------------------
   * 1) Baixe o modelo do Sketchfab (ID ad5990a0a0764743bf84dd397e78f3e3, de
   *    Arthur Araújo), respeitando a licença indicada pelo autor, e exporte/salve
   *    como assets/models/ship.glb.
   * 2) Descomente o import de loadGLB/fitModel no topo e o método abaixo.
   * 3) Chame `boat.loadShipGLB('./assets/models/ship.glb')` no main.js.
   *
   * async loadShipGLB(url) {
   *   const gltf = await loadGLB(url);
   *   const ship = gltf.scene;
   *   fitModel(ship, LENGTH);               // comprimento igual ao placeholder (20 m)
   *   ship.position.y += -1.6;              // base do casco abaixo da linha d'água
   *   // Se o modelo vier com a proa em -Z, gire: ship.rotation.y = Math.PI;
   *
   *   // Troca o visual mantendo a física, o helmAnchor e os estágios
   *   this.stages.forEach((s) => s.clear());
   *   this.stages[1].add(ship);
   *   this.wheel = null;                    // ou localize: ship.getObjectByName('Wheel')
   *   this.rudderMesh = null;
   *   this.sails = [];
   *   // Animações embutidas (ex.: velas tremulando):
   *   if (gltf.animations.length) {
   *     this.mixer = new THREE.AnimationMixer(ship);
   *     gltf.animations.forEach((clip) => this.mixer.clipAction(clip).play());
   *   }
   * }
   */
}
