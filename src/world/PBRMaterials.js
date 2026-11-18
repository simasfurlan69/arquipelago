/**
 * PBRMaterials.js
 * Materiais PBR com texturas dos exemplos do three.js (assets/textures):
 *   hardwood2_*  → madeira (navio, cais, casas, forja)
 *   brick_*      → alvenaria / pedra (fundações, fornalha, salão)
 * Poly Haven (CC0): wood_planks, clay_roof_tiles_02, plastered_wall_04, castle_brick_07,
 *   cobblestone_floor_08 → 'planks' | 'roof' | 'plaster' | 'castle' | 'cobble'
 * As texturas são carregadas uma vez e compartilhadas; cada material só muda
 * a cor (tinta) e a repetição. Mapeamento triplanar em TSL: funciona em qualquer
 * geometria procedural, sem depender de UVs.
 */
import * as THREE from 'three/webgpu';
import { texture, triplanarTexture, positionLocal, normalLocal, float, color } from 'three/tsl';

const loader = new THREE.TextureLoader();
const cache = {};
function tex(name, srgb) {
  if (!cache[name]) {
    const t = loader.load(`./assets/textures/${name}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    cache[name] = t;
  }
  return cache[name];
}

/**
 * @param {'wood'|'stone'} kind
 * @param {number} tint cor multiplicada sobre a textura
 * @param {number} scale metros por repetição da textura
 */
const PH = { planks: 'wood_planks', roof: 'clay_roof_tiles_02', plaster: 'plastered_wall_04', castle: 'castle_brick_07', cobble: 'cobblestone_floor_08' };

export function pbr(kind, tint = 0xffffff, scale = 1.5, opts = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 1, ...opts });
  const s = float(1 / scale);
  const tri = (t) => triplanarTexture(texture(t), null, null, s, positionLocal, normalLocal);
  if (PH[kind]) {
    const n = PH[kind];
    m.colorNode = tri(tex(`${n}_diff_1k.jpg`, true)).rgb.mul(color(tint));
    m.roughnessNode = tri(tex(`${n}_rough_1k.jpg`, false)).r;
    return m;
  }
  const base = kind === 'wood' ? 'hardwood2' : 'brick';
  m.colorNode = tri(tex(`${base}_diffuse.jpg`, true)).rgb.mul(color(tint));
  m.roughnessNode = tri(tex(`${base}_roughness.jpg`, false)).r.mul(kind === 'wood' ? 0.9 : 1).add(0.05);
  return m;
}
