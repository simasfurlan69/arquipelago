/**
 * HeldItems.js
 * Modelos 3D dos itens segurados na mão (procedurais, em metros).
 *
 * Convenção do socket (RightHandSocket / LeftHandSocket, criados em Player.js):
 *   origem = centro da palma fechada
 *   +Y     = sai pelo lado do polegar (lâmina da espada, cabeça do machado)
 *   +Z     = direção dos dedos/nós (frente do punho: gume, cano da arma)
 * Assim todo item é modelado "em pé", com o cabo na origem.
 *
 * Modelo real opcional: se existir assets/models/items/<id>.glb, ele substitui o
 * procedural (mesma convenção de eixos; ajuste fino em ITEMS[id].grip).
 */
import * as THREE from 'three/webgpu';
import { ITEMS, TIER } from '../game/Items.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildLegendary } from './LegendaryModels.js';

const mats = new Map();
function M(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardNodeMaterial({ color, roughness: 0.7, metalness: 0, ...o }));
  return mats.get(k);
}
const WOOD = () => M(0x6b4428, { roughness: 0.85 });
const DARK = () => M(0x2a2a2e, { metalness: 0.6, roughness: 0.4 });
const LEATHER = () => M(0x4a2c18, { roughness: 0.9 });
const tierMat = (t) => M(TIER[t].mat.color, { metalness: TIER[t].mat.metalness, roughness: TIER[t].mat.roughness, ...(t === 2 ? { emissive: 0x2a1c00 } : {}) });

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}
const cyl = (r0, r1, h, s = 8) => new THREE.CylinderGeometry(r0, r1, h, s);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

// =============================================================================
// Ferramentas e armas brancas (por tier)
// =============================================================================
function sword(t, len = 0.85) {
  const g = new THREE.Group(), blade = tierMat(t);
  g.add(mesh(cyl(0.022, 0.024, 0.2), LEATHER()));                       // cabo
  g.add(mesh(new THREE.SphereGeometry(0.034, 10, 8), blade, 0, -0.11, 0)); // pomo
  g.add(mesh(box(0.06, 0.035, 0.24), blade, 0, 0.12, 0));                 // guarda (cruza o gume)
  const b = mesh(box(0.016, len, 0.07), blade, 0, 0.14 + len / 2, 0);     // lâmina (gume em ±Z)
  g.add(b);
  const tip = mesh(new THREE.ConeGeometry(0.035, 0.12, 4), blade, 0, 0.14 + len + 0.05, 0, 0, Math.PI / 4);
  tip.scale.set(0.25, 1, 1);
  g.add(tip);
  if (t === 1) b.scale.set(1.6, 1, 1.2);                                  // pedra: lâmina grossa e lascada
  return g;
}
function dagger(t) { const g = sword(t, 0.3); g.scale.setScalar(0.95); return g; }
function axe(t) {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.02, 0.025, 0.8), WOOD(), 0, 0.25, 0));
  const head = mesh(box(0.035, 0.16, 0.2), tierMat(t), 0, 0.58, 0.09);
  const edge = mesh(box(0.02, 0.22, 0.05), tierMat(t), 0, 0.58, 0.2);
  g.add(head, edge);
  if (t === 1) { head.scale.set(1.5, 1.1, 1); g.add(mesh(cyl(0.03, 0.03, 0.05), LEATHER(), 0, 0.58, 0)); }
  return g;
}
function pickaxe(t) {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.02, 0.025, 0.8), WOOD(), 0, 0.25, 0));
  const bar = mesh(cyl(0.025, 0.03, 0.55), tierMat(t), 0, 0.62, 0, Math.PI / 2);   // ao longo de Z
  g.add(bar);
  g.add(mesh(new THREE.ConeGeometry(0.03, 0.14, 6), tierMat(t), 0, 0.62, 0.33, Math.PI / 2));
  g.add(mesh(new THREE.ConeGeometry(0.03, 0.14, 6), tierMat(t), 0, 0.62, -0.33, -Math.PI / 2));
  if (t === 1) bar.scale.set(1.5, 1, 1.5);
  return g;
}

// =============================================================================
// À distância
// =============================================================================
function bow() {
  // empunhado na mão esquerda: arco ao longo de Y, curvado para a frente (+Z)
  const pts = [];
  for (let i = 0; i <= 14; i++) { const y = -0.62 + (i / 14) * 1.24; pts.push(new THREE.Vector3(0, y, 0.16 * (1 - (y / 0.62) ** 2))); }
  const g = new THREE.Group();
  g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.018, 6), WOOD()));
  g.add(mesh(cyl(0.003, 0.003, 1.24, 3), M(0xeeeeee), 0, 0, 0));
  g.add(mesh(cyl(0.026, 0.026, 0.14), LEATHER(), 0, 0, 0.16));
  return g;
}
function pistol() {
  const g = new THREE.Group();
  g.add(mesh(box(0.035, 0.12, 0.05), DARK(), 0, -0.01, -0.01, -0.25));     // coronha
  g.add(mesh(box(0.034, 0.045, 0.22), DARK(), 0, 0.075, 0.06));            // ferrolho
  g.add(mesh(cyl(0.01, 0.01, 0.04), DARK(), 0, 0.075, 0.18, Math.PI / 2));
  g.add(mesh(box(0.012, 0.03, 0.04), DARK(), 0, 0.025, 0.03));            // gatilho
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.075, 0.2); muzzle.name = 'muzzle'; g.add(muzzle);
  return g;
}
function rifle() {
  const g = new THREE.Group();
  g.add(mesh(box(0.04, 0.1, 0.06), DARK(), 0, -0.02, 0, -0.3));             // empunhadura
  g.add(mesh(box(0.05, 0.08, 0.4), WOOD(), 0, 0.06, -0.24));                // coronha (para trás)
  g.add(mesh(box(0.045, 0.07, 0.42), DARK(), 0, 0.07, 0.18));               // corpo
  g.add(mesh(cyl(0.012, 0.014, 0.5), DARK(), 0, 0.08, 0.62, Math.PI / 2));  // cano
  g.add(mesh(cyl(0.02, 0.02, 0.16), DARK(), 0, 0.13, 0.15, Math.PI / 2));   // luneta
  g.add(mesh(box(0.035, 0.1, 0.03), DARK(), 0, 0.0, 0.16));                 // pente
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.08, 0.88); muzzle.name = 'muzzle'; g.add(muzzle);
  return g;
}

// =============================================================================
// Comidas, bebidas, materiais
// =============================================================================
function food(id) {
  const d = ITEMS[id], c = d.color, g = new THREE.Group();
  const add = (geo, color, x = 0, y = 0, z = 0, s = [1, 1, 1]) => { const m = mesh(geo, M(color, { roughness: 0.6 }), x, y, z); m.scale.set(...s); g.add(m); };
  switch (id) {
    case 'grape': for (let i = 0; i < 7; i++) add(new THREE.SphereGeometry(0.022, 8, 6), c, (i % 3 - 1) * 0.03, 0.02 - Math.floor(i / 3) * 0.03, 0.04); break;
    case 'banana': { const curve = new THREE.CatmullRomCurve3([V(0, -0.08, 0.03), V(0, 0, 0.06), V(0, 0.09, 0.03)]); g.add(mesh(new THREE.TubeGeometry(curve, 10, 0.022, 8), M(c))); break; }
    case 'carrot': add(new THREE.ConeGeometry(0.025, 0.16, 10), c, 0, 0.02, 0.04, [1, 1, 1]); add(cyl(0.004, 0.004, 0.06, 4), 0x3a8a2a, 0, 0.13, 0.04); break;
    case 'corn': add(new THREE.CapsuleGeometry(0.028, 0.1, 4, 10), c, 0, 0.02, 0.04); add(new THREE.ConeGeometry(0.035, 0.12, 8), 0x6aa040, 0, -0.06, 0.04); break;
    case 'bread': add(new THREE.CapsuleGeometry(0.04, 0.09, 4, 12), c, 0, 0, 0.05, [1.2, 1, 0.8]); break;
    case 'cheese': add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 3, 1, false, 0, 1.4), c, 0, 0, 0.04); break;
    case 'hamburger': add(new THREE.SphereGeometry(0.06, 12, 8, 0, 6.3, 0, 1.6), 0xd49a5a, 0, 0.02, 0.05); add(cyl(0.062, 0.062, 0.02, 14), 0x5a3018, 0, 0.0, 0.05); add(cyl(0.064, 0.064, 0.008, 14), 0x6ab040, 0, 0.013, 0.05); add(cyl(0.058, 0.058, 0.02, 14), 0xd49a5a, 0, -0.02, 0.05); break;
    case 'water': add(cyl(0.028, 0.028, 0.16, 12), 0x8fd0f0, 0, 0.02, 0.04); add(cyl(0.012, 0.012, 0.03, 8), 0x3a7ad0, 0, 0.115, 0.04); break;
    case 'coffee': add(cyl(0.035, 0.03, 0.08, 12), 0xf0e8e0, 0, 0, 0.05); add(cyl(0.032, 0.032, 0.004, 12), 0x3a2010, 0, 0.038, 0.05); break;
    case 'drugs': add(box(0.07, 0.05, 0.03), 0xf0f0f0, 0, 0, 0.04); add(box(0.071, 0.012, 0.031), c, 0, 0, 0.04); break;
    case 'cookie': add(cyl(0.04, 0.04, 0.012, 14), c, 0, 0, 0.04, [1, 1, 1]); break;
    default: add(new THREE.SphereGeometry(0.045, 12, 10), c, 0, 0, 0.04);   // maçã, tomate, carne…
  }
  return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function material(id) {
  const g = new THREE.Group();
  if (id === 'stick') g.add(mesh(cyl(0.012, 0.016, 0.45, 6), WOOD(), 0, 0.1, 0, 0, 0, 0.1));
  else if (id === 'gold_bar' || id === 'metal_bar') g.add(mesh(box(0.06, 0.04, 0.13), tierMat(id === 'gold_bar' ? 2 : 3), 0, 0, 0.05));
  else if (id === 'stone') g.add(mesh(new THREE.DodecahedronGeometry(0.06), M(0x8c867b, { flatShading: true }), 0, 0, 0.05));
  else g.add(mesh(box(0.1, 0.1, 0.1), M(ITEMS[id].color), 0, 0, 0.05));
  return g;
}

// =============================================================================
// Relíquias (exibidas na mão)
// =============================================================================
function relic(id) {
  const g = new THREE.Group();
  const gold = M(0xffd23a, { metalness: 0.9, roughness: 0.2, emissive: 0x3a2800 });
  const bone = M(0xe8dcc0, { roughness: 0.6 });
  const glow = (c) => M(c, { emissive: c, emissiveIntensity: 1.5 });
  switch (id) {
    case 'relic_cape': { const geo = new THREE.PlaneGeometry(0.4, 0.55, 6, 8); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getY(i) * 9) * 0.03); geo.computeVertexNormals(); const m = mesh(geo, M(0x3a6ab0, { side: THREE.DoubleSide, roughness: 0.9 }), 0, -0.22, 0.05); g.add(m, mesh(box(0.42, 0.03, 0.03), gold, 0, 0.05, 0.05)); break; }
    case 'relic_crown': { g.add(mesh(cyl(0.1, 0.09, 0.07, 16, 1), gold, 0, 0.06, 0.08)); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.add(mesh(new THREE.ConeGeometry(0.022, 0.07, 4), gold, Math.cos(a) * 0.095, 0.13, 0.08 + Math.sin(a) * 0.095)); g.add(mesh(new THREE.OctahedronGeometry(0.014), glow(0xff3040), Math.cos(a) * 0.1, 0.06, 0.08 + Math.sin(a) * 0.1)); } break; }
    case 'relic_rib': for (let i = 0; i < 4; i++) { const t = new THREE.TorusGeometry(0.12 - i * 0.015, 0.012, 6, 14, Math.PI); g.add(mesh(t, bone, 0, 0.04 + i * 0.05, 0.04, 0, Math.PI / 2, 0)); } g.add(mesh(cyl(0.015, 0.015, 0.22, 6), bone, 0, 0.12, -0.04)); break;
    case 'relic_skull': { const s = mesh(new THREE.SphereGeometry(0.08, 14, 12), bone, 0, 0.08, 0.05); s.scale.set(0.9, 1, 1.1); g.add(s, mesh(box(0.1, 0.04, 0.08), bone, 0, 0.02, 0.09)); for (const x of [-0.03, 0.03]) g.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), glow(0x60ff80), x, 0.09, 0.13)); break; }
    case 'relic_tooth': g.add(mesh(new THREE.ConeGeometry(0.045, 0.26, 10), bone, 0, 0.12, 0.04, 0.2)); g.add(mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), LEATHER(), 0, 0.0, 0.04, Math.PI / 2)); break;
    case 'relic_shield': g.add(mesh(cyl(0.3, 0.3, 0.04, 24), M(0xa8e0f0, { metalness: 0.4, roughness: 0.15, transparent: true, opacity: 0.85 }), 0, 0, 0.1, Math.PI / 2)); g.add(mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 32), M(0xe0f6ff, { metalness: 0.8, roughness: 0.2 }), 0, 0, 0.12)); g.add(mesh(new THREE.OctahedronGeometry(0.06), glow(0x80e0ff), 0, 0, 0.14)); break;
    case 'relic_sword': { const ob = M(0x150818, { metalness: 0.3, roughness: 0.1, emissive: 0x30003a }); g.add(mesh(cyl(0.022, 0.024, 0.2), LEATHER()), mesh(box(0.05, 0.04, 0.26), gold, 0, 0.12, 0), mesh(box(0.02, 0.95, 0.09), ob, 0, 0.62, 0), mesh(box(0.004, 0.9, 0.095), glow(0xc050ff), 0, 0.62, 0)); break; }
  }
  return g;
}

// =============================================================================
// API
// =============================================================================
/**
 * Constrói o modelo do item.
 * @returns {{ object: THREE.Object3D, hand: 'L'|'R', muzzle: THREE.Object3D|null, twoHanded: boolean } | null}
 */
export function buildHeldItem(id) {
  const d = id && ITEMS[id];
  if (!d || d.category === 'equip') return null;   // equipamento passivo: fica no corpo, não na mão
  let obj;
  if (d.category === 'legendary') obj = buildLegendary(d);
  else if (d.tool === 'sword') obj = sword(d.tier);
  else if (d.tool === 'dagger') obj = dagger(d.tier);
  else if (d.tool === 'axe') obj = axe(d.tier);
  else if (d.tool === 'pickaxe') obj = pickaxe(d.tier);
  else if (d.tool === 'bow') obj = bow();
  else if (d.tool === 'pistol') obj = pistol();
  else if (d.tool === 'rifle') obj = rifle();
  else if (d.category === 'relic') obj = relic(id);
  else if (d.category === 'food' || d.category === 'drink' || d.category === 'special') obj = food(id);
  else obj = material(id);
  const grip = d.grip || {};
  if (grip.pos) obj.position.set(...grip.pos);
  if (grip.rot) obj.rotation.set(...grip.rot);
  if (grip.scale) obj.scale.multiplyScalar(grip.scale);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const holder = new THREE.Group();
  holder.name = `held_${id}`;
  holder.add(obj);
  if (d.category !== 'legendary') tryLoadModel(id, holder, obj);
  else holder.userData.update = obj.userData.update;
  return { object: holder, hand: grip.hand || 'R', muzzle: obj.getObjectByName('muzzle') || null, twoHanded: d.tool === 'rifle' };
}

// ---- modelo .glb opcional em assets/models/items/<id>.glb ----
const glbCache = new Map();
function tryLoadModel(id, holder, placeholder) {
  if (!glbCache.has(id)) {
    glbCache.set(id, fetch(`./assets/models/items/${id}.glb`, { method: 'HEAD' })
      .then((r) => (r.ok ? new GLTFLoader().loadAsync(`./assets/models/items/${id}.glb`) : null))
      .catch(() => null));
  }
  glbCache.get(id).then((gltf) => {
    if (!gltf || !holder.parent) return;
    const m = gltf.scene.clone(true);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const muzzle = placeholder.getObjectByName('muzzle');
    placeholder.visible = false;
    if (muzzle) m.add(muzzle);
    holder.add(m);
  });
}
