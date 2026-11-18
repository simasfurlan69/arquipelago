/**
 * CharacterMaterials.js
 * Materiais de personagens em TSL / WebGPU.
 *
 * PELE: MeshSSSNodeMaterial (exemplo oficial `webgpu_materials_sss`).
 * Ele aproxima o Subsurface Scattering pelo modelo de "translucency" de
 * Barré-Brisebois/Bouchard: parte da luz atravessa o tecido e sai do lado oposto,
 * tingida pela cor do tecido interno (sangue e derme → avermelhado).
 *   thicknessColorNode       cor da luz transmitida
 *   thicknessDistortionNode  quanto a normal desvia a luz transmitida
 *   thicknessAmbientNode     termo ambiente da transmissão
 *   thicknessAttenuationNode atenuação
 *   thicknessPowerNode       concentração do lóbulo de transmissão
 *   thicknessScaleNode       intensidade final
 * O efeito aparece com contraluz (sol atrás de orelhas, mãos e nariz).
 *
 * Materiais biológicos de animais (pele de jacaré, couro de cervo) usam a mesma
 * técnica com parâmetros mais fracos.
 */
import * as THREE from 'three/webgpu';
import { uniform, vec3, color, mix, smoothstep, mx_noise_float, positionLocal, float } from 'three/tsl';

/**
 * Cria um material de pele com SSS.
 * @param {object} o
 * @param {number} o.tone   cor base da pele
 * @param {number[]} o.blood cor RGB do espalhamento interno
 * @param {number} o.scale  intensidade do SSS
 * @param {number} o.soot   0..1, fuligem misturada à pele (ferreiro)
 */
export function createSkinMaterial({ tone = 0xd9a07f, blood = [0.9, 0.28, 0.14], scale = 5.5, soot = 0, roughness = 0.55 } = {}) {
  const mat = new THREE.MeshSSSNodeMaterial();
  mat.color = new THREE.Color(tone);
  mat.roughness = roughness;
  mat.metalness = 0;

  mat.thicknessColorNode = vec3(...blood);
  mat.thicknessDistortionNode = uniform(0.12);
  mat.thicknessAmbientNode = uniform(0.3);
  mat.thicknessAttenuationNode = uniform(0.8);
  mat.thicknessPowerNode = uniform(2.4);
  mat.thicknessScaleNode = uniform(scale);

  if (soot > 0) {
    // Manchas de fuligem com ruído 3D em espaço local
    const n = mx_noise_float(positionLocal.mul(9)).mul(0.5).add(0.5);
    mat.colorNode = mix(color(tone), color(0x2a2420), smoothstep(0.45, 0.8, n).mul(soot));
  }
  return mat;
}

/** Tecido/couro padrão, com fuligem procedural opcional. */
export function createClothMaterial(hex, { roughness = 0.85, metalness = 0, soot = 0, emissive = 0x000000 } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness, emissive });
  if (soot > 0) {
    const n = mx_noise_float(positionLocal.mul(6)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionLocal.mul(23)).mul(0.5).add(0.5);
    mat.colorNode = mix(color(hex), color(0x161311), smoothstep(0.4, 0.85, n.mul(0.7).add(n2.mul(0.3))).mul(soot));
  }
  return mat;
}

/** Bordado dourado: metálico com leve brilho próprio (fica legível sem env map). */
export function createGoldMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: 0xd9a63a, metalness: 0.65, roughness: 0.28, emissive: 0x3b2706,
  });
  // Variação sutil do brilho, imitando fios de bordado
  const n = mx_noise_float(positionLocal.mul(40)).mul(0.5).add(0.5);
  mat.colorNode = mix(color(0xb8862b), color(0xf3cf6b), n);
  return mat;
}

/** Couro de animal com SSS fraco (orelhas de cervo e cavalo ficam translúcidas). */
export function createHideMaterial(hex, sssScale = 1.5) {
  const mat = new THREE.MeshSSSNodeMaterial();
  mat.color = new THREE.Color(hex);
  mat.roughness = 0.9;
  mat.thicknessColorNode = vec3(0.7, 0.25, 0.12);
  mat.thicknessDistortionNode = uniform(0.2);
  mat.thicknessAmbientNode = uniform(0.1);
  mat.thicknessAttenuationNode = uniform(0.6);
  mat.thicknessPowerNode = uniform(3.0);
  mat.thicknessScaleNode = uniform(sssScale);
  return mat;
}

/** Pele escamosa de réptil (padrão de escamas via ruído). */
export function createScaleMaterial(hex = 0x3d4a2a) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.05 });
  const n = mx_noise_float(positionLocal.mul(14)).mul(0.5).add(0.5);
  mat.colorNode = mix(color(hex), color(0x1c2414), smoothstep(0.35, 0.7, n)).mul(float(1));
  return mat;
}
