/**
 * LegendaryModels.js
 * Modelos das 8 armas lendárias.
 *
 *  - Adaga Derretida, Espada Rúnica e Machado de Gelo: .glb originais da demo de
 *    armas do Babylon.js (CC BY 4.0 — assets/models/CREDITS.md). Os efeitos da
 *    demo eram Node Materials do Babylon; aqui foram RECRIADOS em TSL:
 *      adaga  → metal em brasa: emissivo laranja pulsando + "calor" escorrendo na lâmina
 *      espada → runas verdes que acendem numa varredura ao longo da lâmina + gemas
 *      machado→ lâmina de gelo (morph targets "congelar") translúcida + brilho azul
 *  - As outras 5 são procedurais (martelo, arco, manopla, sabre, tridente).
 *
 * Convenção de "segurar" igual a HeldItems.js: cabo na origem, lâmina para +Y,
 * gume para ±Z. `power` (0..1) intensifica o efeito (golpe especial).
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { texture, uv, time, sin, vec3, float, uniform, mix, smoothstep, fract, abs } from 'three/tsl';

const BASE = './assets/models/legendary';
const texCache = new Map();
function tex(name, srgb = true) {
  if (!texCache.has(name)) {
    const t = new THREE.TextureLoader().load(`${BASE}/textures/${name}.png`);
    t.flipY = false;                                   // UV no padrão glTF
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    texCache.set(name, t);
  }
  return texCache.get(name);
}

const glbCache = new Map();
function loadGLB(name) {
  if (!glbCache.has(name)) glbCache.set(name, new GLTFLoader().loadAsync(`${BASE}/${name}.glb`).catch((e) => { console.warn('lendário', name, e); return null; }));
  return glbCache.get(name);
}

/**
 * Configuração de cada .glb: comprimento final (m), qual extremidade é o cabo e
 * onde a mão segura (fração do comprimento a partir do cabo).
 */
const GLB = {
  moltenDagger: { len: 0.5, grip: 0.12, hiltAtMin: true },
  runeSword: { len: 1.15, grip: 0.08, hiltAtMin: false },
  frostAxe: { len: 0.95, grip: 0.12, hiltAtMin: true },
};

// ---------------------------------------------------------------------------
// Materiais TSL (um por arma, compartilhados entre instâncias)
// ---------------------------------------------------------------------------
const MATS = {};
function daggerMats() {
  if (MATS.dagger) return MATS.dagger;
  const power = uniform(0);
  const glossToRough = (t) => float(1).sub(texture(t).r).mul(0.8).add(0.1);
  const blade = new THREE.MeshStandardNodeMaterial({ metalness: 0.7 });
  blade.colorNode = texture(tex('moltenDagger_diffuse')).rgb;
  blade.roughnessNode = glossToRough(tex('moltenDagger_gloss', false));
  // calor: a máscara do emissivo pulsa e "escorre" (ondas ao longo de V) — brasa viva
  const e = texture(tex('moltenDagger_emissive')).rgb;
  const flow = sin(uv().y.mul(26).sub(time.mul(5))).mul(0.25).add(0.75);
  const flicker = sin(time.mul(17)).mul(0.08).add(sin(time.mul(29.7)).mul(0.06)).add(0.9);
  blade.emissiveNode = e.mul(vec3(1.0, 0.38, 0.08)).mul(flow).mul(flicker).mul(power.mul(4).add(2.2));
  const handle = new THREE.MeshStandardNodeMaterial({ metalness: 0.5 });
  handle.colorNode = texture(tex('moltenDagger_diffuse')).rgb;
  handle.roughnessNode = glossToRough(tex('moltenDagger_gloss', false));
  const gem = new THREE.MeshStandardNodeMaterial({ color: 0x3a0800, roughness: 0.15 });
  gem.emissiveNode = vec3(1.0, 0.3, 0.05).mul(sin(time.mul(3)).mul(0.5).add(1.5)).mul(power.add(1));
  return (MATS.dagger = { blade, handle, gem, power, color: 0xff6a20 });
}
function swordMats() {
  if (MATS.sword) return MATS.sword;
  const power = uniform(0);
  const diff = tex('runeSword_diffuse'), gl = tex('runeSword_gloss', false), em = tex('runeSword_emissive');
  const body = new THREE.MeshStandardNodeMaterial({ metalness: 0.85 });
  body.colorNode = texture(diff).rgb;
  body.roughnessNode = float(1).sub(texture(gl).r).mul(0.7).add(0.08);
  const blade = body.clone();
  // runas: varredura que sobe a lâmina em loop + respiração; especial = tudo aceso
  const sweep = fract(time.mul(0.45));
  const band = smoothstep(0.18, 0.0, abs(uv().y.sub(sweep))).mul(1.6);
  const breathe = sin(time.mul(2.2)).mul(0.25).add(0.75);
  blade.emissiveNode = texture(em).rgb.mul(vec3(0.25, 1.0, 0.45)).mul(band.add(breathe).mul(power.mul(2.5).add(1.4)));
  const gem = new THREE.MeshStandardNodeMaterial({ color: 0x0a3a1a, roughness: 0.1, metalness: 0.2 });
  gem.emissiveNode = vec3(0.2, 1.0, 0.4).mul(sin(time.mul(2.8)).mul(0.6).add(1.6)).mul(power.add(1));
  return (MATS.sword = { body, blade, gem, power, color: 0x50ff90 });
}
function axeMats() {
  if (MATS.axe) return MATS.axe;
  const power = uniform(0);
  const body = new THREE.MeshStandardNodeMaterial({ metalness: 0.6 });
  body.colorNode = texture(tex('frostAxe_diffuse')).rgb;
  body.roughnessNode = float(1).sub(texture(tex('frostAxe_gloss', false)).r).mul(0.8).add(0.1);
  const frost = sin(time.mul(1.7)).mul(0.2).add(0.8);
  body.emissiveNode = texture(tex('frostAxe_emissive')).rgb.mul(vec3(0.35, 0.75, 1.0)).mul(frost).mul(power.mul(3).add(1.5));
  const ice = new THREE.MeshStandardNodeMaterial({ color: 0xcdeeff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
  ice.colorNode = texture(tex('frostAxe_diffuse')).rgb.mul(0.35).add(vec3(0.65, 0.85, 1.0).mul(0.65));
  ice.emissiveNode = vec3(0.3, 0.6, 1.0).mul(mix(float(0.15), float(0.9), power));
  return (MATS.axe = { body, ice, power, color: 0x8ad8ff });
}

/** Aplica os materiais TSL nas malhas do .glb. */
function dressGLB(name, root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const n = o.name;
    if (name === 'moltenDagger') { const M = daggerMats(); o.material = /Gem/i.test(n) ? M.gem : /Blade/i.test(n) ? M.blade : M.handle; }
    if (name === 'runeSword') { const M = swordMats(); o.material = /Gem/i.test(n) ? M.gem : /Blade/i.test(n) ? M.blade : M.body; }
    if (name === 'frostAxe') {
      const M = axeMats();
      if (/Ice/i.test(n)) { o.material = M.ice; o.castShadow = false; o.userData.ice = true; } else o.material = M.body;
    }
  });
}
export const legendaryPower = (model) => ({ moltenDagger: daggerMats, runeSword: swordMats, frostAxe: axeMats }[model]?.().power);

/**
 * Coloca o .glb no `holder` alinhado à convenção (cabo na origem, lâmina +Y).
 * Enquanto carrega, `placeholder` (procedural) fica visível.
 */
function attachGLB(name, holder, placeholder) {
  loadGLB(name).then((gltf) => {
    if (!gltf || !holder.parent) return;
    const cfg = GLB[name];
    const m = gltf.scene.clone(true);
    m.traverse((o) => { if (o.isLight) o.visible = false; });
    dressGLB(name, m);
    // eixo mais comprido → +Y; escala para cfg.len
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
    const ax = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    const pivot = new THREE.Group();
    pivot.add(m);
    const c = box.getCenter(new THREE.Vector3());
    m.position.sub(c);                                    // centraliza
    if (ax === 'x') pivot.rotation.z = Math.PI / 2;
    if (ax === 'z') pivot.rotation.x = -Math.PI / 2;
    if (!cfg.hiltAtMin) pivot.rotation.z += Math.PI;
    const k = cfg.len / size[ax];
    const g = new THREE.Group();
    g.add(pivot);
    pivot.scale.setScalar(k);
    // cabo (extremidade "min" após o giro) desce até a mão: origem em grip
    g.position.y = cfg.len / 2 - cfg.len * cfg.grip;
    placeholder.visible = false;
    holder.add(g);
    // gelo do machado: morph targets "congelar" (0 → 1 ao empunhar)
    if (name === 'frostAxe') {
      m.traverse((o) => { if (o.userData.ice && o.morphTargetInfluences) { holder.userData.ice = o; o.morphTargetInfluences.fill(0); } });
    }
    holder.userData.glb = g;
  });
}

// ---------------------------------------------------------------------------
// Procedurais
// ---------------------------------------------------------------------------
const std = (color, o = {}) => new THREE.MeshStandardNodeMaterial({ color, roughness: 0.5, metalness: 0.3, ...o });
const glow = (color, k = 2) => new THREE.MeshStandardNodeMaterial({ color: 0x111111, emissive: color, emissiveIntensity: k, roughness: 0.4 });
const mesh = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; return m; };

function hammer() {
  const g = new THREE.Group(), wood = std(0x4a3420, { roughness: 0.9, metalness: 0 });
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.95, 8), wood, 0, 0.3, 0));
  const head = mesh(new THREE.BoxGeometry(0.22, 0.2, 0.36), std(0x5a6a3a, { roughness: 0.8 }), 0, 0.82, 0);
  g.add(head);
  for (let i = 0; i < 5; i++) g.add(mesh(new THREE.TorusGeometry(0.11 + i * 0.012, 0.012, 5, 12, Math.PI * 1.2), wood, 0, 0.75 + i * 0.03, 0, Math.PI / 2, 0, i));
  g.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), glow(0x9be05a, 3), 0, 0.82, 0.19));
  g.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), glow(0x9be05a, 3), 0, 0.82, -0.19));
  return g;
}
function mistBow() {
  const g = new THREE.Group(), wood = std(0x2a1a3a, { roughness: 0.6 });
  const arc = new THREE.TorusGeometry(0.6, 0.022, 6, 32, Math.PI * 0.9);
  const a = mesh(arc, wood, 0, 0, -0.1, 0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.05); g.add(a);
  g.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 1.15, 4), glow(0xb080ff, 3), 0, 0, -0.02));
  for (const y of [0.45, -0.45]) g.add(mesh(new THREE.OctahedronGeometry(0.05), glow(0xb080ff, 4), 0, y, -0.55));
  g.rotation.x = 0;
  return g;
}
function gauntlet() {
  const g = new THREE.Group(), stone = std(0x77706a, { roughness: 0.95, metalness: 0 });
  g.add(mesh(new THREE.BoxGeometry(0.13, 0.18, 0.15), stone, 0, 0.02, 0.02));
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), stone, -0.045 + i * 0.03, 0.13, 0.05));
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.16, 8), stone, 0, -0.12, 0));
  g.add(mesh(new THREE.OctahedronGeometry(0.035), glow(0xffc070, 3), 0, 0.03, 0.1));
  return g;
}
function saber() {
  const g = new THREE.Group(), steel = std(0xb8d8e0, { metalness: 0.9, roughness: 0.25 });
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.18, 8), std(0x1a3a40), 0, 0, 0));
  g.add(mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 16, Math.PI), std(0xc8a040, { metalness: 0.9 }), 0, 0.02, 0.04, 0, Math.PI / 2, 0));
  // lâmina curva: vários segmentos
  for (let i = 0; i < 10; i++) {
    const y = 0.12 + i * 0.085, z = (i / 10) ** 2 * 0.09;
    g.add(mesh(new THREE.BoxGeometry(0.012, 0.09, 0.055 - i * 0.003), steel, 0, y, z, -0.02 * i));
  }
  g.add(mesh(new THREE.BoxGeometry(0.004, 0.8, 0.012), glow(0x40d8ff, 1.5), 0, 0.5, 0.045));
  return g;
}
function trident() {
  const g = new THREE.Group(), gold = std(0x30a0b0, { metalness: 0.9, roughness: 0.25 });
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.022, 1.5, 8), std(0x2a5a60, { metalness: 0.6 }), 0, 0.35, 0));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.04, 0.3), gold, 0, 1.1, 0));
  for (const z of [-0.13, 0, 0.13]) g.add(mesh(new THREE.ConeGeometry(0.025, z ? 0.28 : 0.36, 6), gold, 0, z ? 1.26 : 1.3, z));
  g.add(mesh(new THREE.SphereGeometry(0.04, 10, 8), glow(0x60f0ff, 3), 0, 1.06, 0));
  return g;
}
// placeholders enquanto o .glb carrega
function daggerPh() { const g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(0.012, 0.32, 0.05), glow(0xff6a20, 1.5), 0, 0.24, 0)); g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), std(0x2a1a10), 0, 0, 0)); return g; }
function swordPh() { const g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(0.015, 0.95, 0.07), glow(0x50ff90, 1), 0, 0.6, 0)); g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6), std(0x2a1a10), 0, 0, 0)); return g; }
function axePh() { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.85, 8), std(0x3a3a4a), 0, 0.28, 0)); g.add(mesh(new THREE.BoxGeometry(0.03, 0.22, 0.24), glow(0x8ad8ff, 1), 0, 0.6, 0.1)); return g; }

const BUILD = {
  roots: hammer, mist: mistBow, quake: gauntlet, wave: saber, tide: trident,
  fire: daggerPh, frost: axePh, rune: swordPh,
};

/**
 * Constrói o modelo de um item lendário (para a mão ou para o drop no altar).
 * @returns {THREE.Group} holder; holder.userData.update(dt, power) anima os efeitos
 */
export function buildLegendary(def) {
  const holder = new THREE.Group();
  holder.name = `legend_${def.legendary}`;
  const ph = BUILD[def.legendary]();
  holder.add(ph);
  if (def.model) attachGLB(def.model, holder, ph);
  let iceT = 0;
  holder.userData.update = (dt, power = 0) => {
    const u = def.model && legendaryPower(def.model);
    if (u) u.value += (power - u.value) * Math.min(1, dt * 8);
    const ice = holder.userData.ice;
    if (ice) { iceT = Math.min(1, iceT + dt * 0.8); const k = iceT * iceT * (3 - 2 * iceT); ice.morphTargetInfluences.fill(Math.max(0.001, k)); }
  };
  return holder;
}
