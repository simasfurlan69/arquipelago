/**
 * HumanoidRig.js
 * Placeholder humanoide: hierarquia de Object3D nomeados que funciona como um
 * esqueleto (hips → torso → head/arms, hips → legs). Os AnimationClips são
 * gerados por código e tocados por um AnimationMixer real. Ao trocar por um .glb
 * com esqueleto, só os clips mudam; o BlendSpace continua igual.
 *
 * Convenções: o personagem olha para +Z, o lado esquerdo é +X e a altura total
 * é ~1.8 m.
 */
import * as THREE from 'three/webgpu';
import { oscRotTrack, oscPosTrack, keyRotTrack, makeClip } from '../utils/AnimUtils.js';

const HIP_Y = 0.95;

function part(geo, mat, name) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  return m;
}

/**
 * Constrói o rig.
 * @param {object} mats { skin, shirt, pants, boots, extra? }
 * @param {object} opt  { bulk: largura do tronco, coatLength: casaco longo (m) }
 * @returns {{ root: THREE.Group, nodes: Record<string, THREE.Object3D> }}
 */
export function buildHumanoid(mats, { bulk = 1, coatLength = 0, hair = 0x2b1d14 } = {}) {
  const root = new THREE.Group();
  root.name = 'humanoid';
  const nodes = {};
  const g = (name, parent, x = 0, y = 0, z = 0) => {
    const o = new THREE.Group(); o.name = name; o.position.set(x, y, z);
    parent.add(o); nodes[name] = o; return o;
  };

  // --- Quadril e tronco ---
  const hips = g('hips', root, 0, HIP_Y, 0);
  hips.add(part(new THREE.BoxGeometry(0.34 * bulk, 0.2, 0.22), mats.pants));

  const torso = g('torso', hips, 0, 0.1, 0);
  const chest = part(new THREE.CapsuleGeometry(0.19 * bulk, 0.3, 4, 10), mats.shirt);
  chest.scale.set(1, 1, 0.7); chest.position.y = 0.3;
  torso.add(chest);

  if (coatLength > 0) {
    // Casaco longo: cone truncado que se abre até os joelhos
    const coat = part(new THREE.CylinderGeometry(0.21 * bulk, 0.33 * bulk, coatLength, 12, 1, true), mats.shirt);
    coat.position.y = 0.4 - coatLength / 2;
    coat.material.side = THREE.DoubleSide;
    torso.add(coat);
  }

  // --- Cabeça ---
  const neck = g('neck', torso, 0, 0.6, 0);
  neck.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), mats.skin));
  const head = g('head', neck, 0, 0.08, 0);
  const skull = part(new THREE.SphereGeometry(0.115, 18, 14), mats.skin);
  skull.scale.set(0.92, 1.1, 1); skull.position.y = 0.11;
  head.add(skull);
  const nose = part(new THREE.ConeGeometry(0.022, 0.06, 6), mats.skin);
  nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.1, 0.115);
  head.add(nose);
  for (const sx of [-1, 1]) {   // orelhas: onde o SSS mais aparece com contraluz
    const ear = part(new THREE.SphereGeometry(0.03, 8, 6), mats.skin);
    ear.scale.set(0.4, 1, 0.8); ear.position.set(sx * 0.105, 0.11, 0);
    head.add(ear);
    const eye = part(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.2 }));
    eye.position.set(sx * 0.04, 0.13, 0.1);
    head.add(eye);
  }
  const hairMesh = part(new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardNodeMaterial({ color: hair, roughness: 0.9 }));
  hairMesh.position.y = 0.13; hairMesh.rotation.x = -0.25;
  head.add(hairMesh);

  // --- Braços (pivô no ombro) ---
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const arm = g(`arm${side}`, torso, sx * 0.25 * bulk, 0.5, 0);
    const upper = part(new THREE.CapsuleGeometry(0.055 * bulk, 0.22, 4, 8), mats.shirt);
    upper.position.y = -0.15; arm.add(upper);
    const fore = g(`fore${side}`, arm, 0, -0.3, 0);
    const foreMesh = part(new THREE.CapsuleGeometry(0.048 * bulk, 0.2, 4, 8), mats.skin);
    foreMesh.position.y = -0.13; fore.add(foreMesh);
    const hand = g(`hand${side}`, fore, 0, -0.28, 0);
    hand.add(part(new THREE.SphereGeometry(0.05, 8, 6), mats.skin));
  }

  // --- Pernas (pivô no quadril) ---
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const leg = g(`leg${side}`, hips, sx * 0.1, -0.05, 0);
    const thigh = part(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), mats.pants);
    thigh.position.y = -0.2; leg.add(thigh);
    const shin = g(`shin${side}`, leg, 0, -0.44, 0);
    const shinMesh = part(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8), mats.boots);
    shinMesh.position.y = -0.2; shin.add(shinMesh);
    const foot = part(new THREE.BoxGeometry(0.1, 0.07, 0.24), mats.boots);
    foot.position.set(0, -0.43, 0.05); shin.add(foot);
  }

  return { root, nodes };
}

/**
 * Clips de locomoção e pilotagem. Durações em segundos, uma passada por ciclo.
 * Os sinais seguem a convenção: rotation.x negativo leva o membro para frente (+Z).
 */
export function createHumanoidClips() {
  const idle = makeClip('idle', 3, [
    oscRotTrack('torso', { x: [0.02, 0.015] }, 3),
    oscRotTrack('head', { y: [0, 0.18] , x: [0, 0.03, 0.25] }, 3),
    oscRotTrack('armL', { z: [0.08, 0.02], x: [0, 0.03] }, 3),
    oscRotTrack('armR', { z: [-0.08, 0.02], x: [0, 0.03, 0.5] }, 3),
    oscRotTrack('foreL', { x: [-0.1, 0.02] }, 3),
    oscRotTrack('foreR', { x: [-0.1, 0.02] }, 3),
    oscPosTrack('hips', [0, HIP_Y, 0], [0, 0.008, 0], 3, 16, 1),
  ]);

  const walk = makeClip('walk', 1.0, [
    oscRotTrack('legL', { x: [0, 0.5] }, 1.0),
    oscRotTrack('legR', { x: [0, 0.5, 0.5] }, 1.0),
    oscRotTrack('shinL', { x: [0.35, 0.35, 0.25] }, 1.0),
    oscRotTrack('shinR', { x: [0.35, 0.35, 0.75] }, 1.0),
    oscRotTrack('armL', { x: [0, 0.4, 0.5], z: [0.06, 0] }, 1.0),
    oscRotTrack('armR', { x: [0, 0.4], z: [-0.06, 0] }, 1.0),
    oscRotTrack('foreL', { x: [-0.25, 0.1, 0.5] }, 1.0),
    oscRotTrack('foreR', { x: [-0.25, 0.1] }, 1.0),
    oscRotTrack('torso', { y: [0, 0.06], x: [0.04, 0] }, 1.0),
    oscPosTrack('hips', [0, HIP_Y - 0.02, 0], [0, 0.045, 0], 1.0, 16, 2),
  ]);

  const run = makeClip('run', 0.62, [
    oscRotTrack('legL', { x: [-0.1, 0.95] }, 0.62),
    oscRotTrack('legR', { x: [-0.1, 0.95, 0.5] }, 0.62),
    oscRotTrack('shinL', { x: [0.9, 0.75, 0.25] }, 0.62),
    oscRotTrack('shinR', { x: [0.9, 0.75, 0.75] }, 0.62),
    oscRotTrack('armL', { x: [0, 0.85, 0.5], z: [0.1, 0] }, 0.62),
    oscRotTrack('armR', { x: [0, 0.85], z: [-0.1, 0] }, 0.62),
    oscRotTrack('foreL', { x: [-1.2, 0.15] }, 0.62),
    oscRotTrack('foreR', { x: [-1.2, 0.15] }, 0.62),
    oscRotTrack('torso', { x: [0.22, 0.02], y: [0, 0.1] }, 0.62),
    oscRotTrack('head', { x: [-0.12, 0.02] }, 0.62),
    oscPosTrack('hips', [0, HIP_Y - 0.05, 0], [0, 0.09, 0], 0.62, 16, 2),
  ]);

  // Pilotando: mãos no timão, girando alternadamente, base larga para equilíbrio
  const steer = makeClip('steer', 2.0, [
    oscRotTrack('armL', { x: [-1.15, 0.18], z: [0.15, 0.05] }, 2.0),
    oscRotTrack('armR', { x: [-1.15, 0.18, 0.5], z: [-0.15, 0.05, 0.5] }, 2.0),
    oscRotTrack('foreL', { x: [-0.55, 0.12, 0.25] }, 2.0),
    oscRotTrack('foreR', { x: [-0.55, 0.12, 0.75] }, 2.0),
    oscRotTrack('legL', { z: [0.12, 0], x: [-0.05, 0] }, 2.0),
    oscRotTrack('legR', { z: [-0.12, 0], x: [0.05, 0] }, 2.0),
    oscRotTrack('shinL', { x: [0.12, 0.03] }, 2.0),
    oscRotTrack('shinR', { x: [0.12, 0.03, 0.5] }, 2.0),
    oscRotTrack('torso', { x: [0.08, 0.02], z: [0, 0.05] }, 2.0),
    oscRotTrack('head', { y: [0, 0.12, 0.3] }, 2.0),
    oscPosTrack('hips', [0, HIP_Y - 0.04, 0], [0, 0.01, 0], 2.0, 16, 1),
  ]);

  return { idle, walk, run, steer };
}

/** Clip do ferreiro: martelando na bigorna. */
export function createHammerClip() {
  const d = 1.1;
  return makeClip('hammer', d, [
    oscRotTrack('armR', { x: [-1.25, 0.75], z: [-0.1, 0] }, d),
    oscRotTrack('foreR', { x: [-0.9, 0.5, 0.15] }, d),
    oscRotTrack('armL', { x: [-0.7, 0.05], z: [0.25, 0] }, d),
    oscRotTrack('foreL', { x: [-0.9, 0.05] }, d),
    oscRotTrack('torso', { x: [0.2, 0.06] }, d),
    oscRotTrack('head', { x: [0.35, 0.03] }, d),
  ]);
}

/** Clip do mestre da guilda: lendo o livro de missões. */
export function createReadClip() {
  const d = 4;
  return makeClip('read', d, [
    oscRotTrack('armL', { x: [-0.85, 0.03], z: [0.2, 0] }, d),
    oscRotTrack('armR', { x: [-0.85, 0.08, 0.5], z: [-0.2, 0.04] }, d),
    oscRotTrack('foreL', { x: [-0.75, 0.03] }, d),
    oscRotTrack('foreR', { x: [-0.7, 0.1, 0.5] }, d),
    oscRotTrack('head', { x: [0.35, 0.05], y: [0, 0.12, 0.25] }, d),
    oscRotTrack('torso', { x: [0.05, 0.02] }, d),
  ]);
}

// =============================================================================
// Clips de ação (tocados como one-shot por cima da locomoção)
// Só animam braços, tronco e cabeça; as pernas seguem o blend de locomoção.
// =============================================================================
export function createActionClips() {
  // Espada: ergue e corta na diagonal
  const swing = makeClip('swing', 0.42, [
    keyRotTrack('armR', [0, 0.1, 0.22, 0.42], [[-0.5, 0, -0.2], [-2.5, 0.3, -0.5], [-0.4, -0.2, 0.5], [-0.3, 0, -0.1]]),
    keyRotTrack('foreR', [0, 0.1, 0.22, 0.42], [[-0.4, 0, 0], [-0.9, 0, 0], [-0.1, 0, 0], [-0.3, 0, 0]]),
    keyRotTrack('torso', [0, 0.1, 0.22, 0.42], [[0, 0, 0], [-0.05, 0.4, 0], [0.15, -0.45, 0], [0.02, 0, 0]]),
  ]);
  // Machado: golpe de cima para baixo com as duas mãos
  const chop = makeClip('chop', 0.55, [
    keyRotTrack('armR', [0, 0.18, 0.32, 0.55], [[-0.5, 0, 0], [-2.7, 0, -0.2], [-0.7, 0, 0.1], [-0.4, 0, 0]]),
    keyRotTrack('armL', [0, 0.18, 0.32, 0.55], [[-0.5, 0, 0], [-2.5, 0, 0.3], [-0.8, 0, -0.1], [-0.3, 0, 0]]),
    keyRotTrack('foreR', [0, 0.18, 0.32, 0.55], [[-0.3, 0, 0], [-0.6, 0, 0], [-0.1, 0, 0], [-0.3, 0, 0]]),
    keyRotTrack('foreL', [0, 0.18, 0.32, 0.55], [[-0.3, 0, 0], [-0.6, 0, 0], [-0.2, 0, 0], [-0.3, 0, 0]]),
    keyRotTrack('torso', [0, 0.18, 0.32, 0.55], [[0, 0.2, 0], [-0.2, 0.3, 0], [0.35, -0.1, 0], [0.05, 0, 0]]),
  ]);
  // Picareta: arco mais curto, tronco curvado
  const mine = makeClip('mine', 0.65, [
    keyRotTrack('armR', [0, 0.22, 0.38, 0.65], [[-0.6, 0, 0], [-2.6, 0, -0.15], [-0.4, 0, 0], [-0.5, 0, 0]]),
    keyRotTrack('armL', [0, 0.22, 0.38, 0.65], [[-0.6, 0, 0], [-2.3, 0, 0.25], [-0.5, 0, 0], [-0.4, 0, 0]]),
    keyRotTrack('foreR', [0, 0.22, 0.38, 0.65], [[-0.5, 0, 0], [-0.7, 0, 0], [-0.2, 0, 0], [-0.4, 0, 0]]),
    keyRotTrack('torso', [0, 0.22, 0.38, 0.65], [[0.1, 0, 0], [-0.15, 0, 0], [0.5, 0, 0], [0.15, 0, 0]]),
  ]);
  // Comer: leva a mão à boca duas vezes
  const eat = makeClip('eat', 0.9, [
    keyRotTrack('armR', [0, 0.2, 0.45, 0.7, 0.9], [[0, 0, 0], [-1.9, 0, 0.4], [-1.7, 0, 0.4], [-1.9, 0, 0.4], [0, 0, 0]]),
    keyRotTrack('foreR', [0, 0.2, 0.45, 0.7, 0.9], [[0, 0, 0], [-1.7, 0, 0], [-1.5, 0, 0], [-1.7, 0, 0], [0, 0, 0]]),
    keyRotTrack('head', [0, 0.2, 0.45, 0.7, 0.9], [[0, 0, 0], [0.15, 0, 0], [0.05, 0, 0], [0.15, 0, 0], [0, 0, 0]]),
  ]);
  // Dano: tranco para trás
  const hurt = makeClip('hurt', 0.3, [
    keyRotTrack('torso', [0, 0.08, 0.3], [[0, 0, 0], [-0.3, 0, 0.1], [0, 0, 0]]),
    keyRotTrack('head', [0, 0.08, 0.3], [[0, 0, 0], [-0.3, 0, 0], [0, 0, 0]]),
  ]);
  // Arco: pose de mira (loop), braço esquerdo esticado e direito puxando a corda
  const bowHold = makeClip('bowHold', 1.2, [
    oscRotTrack('armL', { x: [-1.55, 0.02], z: [0.05, 0] }, 1.2),
    oscRotTrack('foreL', { x: [-0.05, 0] }, 1.2),
    oscRotTrack('armR', { x: [-1.45, 0.02], z: [0.35, 0] }, 1.2),
    oscRotTrack('foreR', { x: [-1.6, 0.03] }, 1.2),
    oscRotTrack('torso', { y: [0.35, 0.01] }, 1.2),
    oscRotTrack('head', { y: [-0.3, 0] }, 1.2),
  ]);
  return { swing, chop, mine, eat, hurt, bowHold };
}

// =============================================================================
// Mortos-vivos
// =============================================================================
export function createZombieClips() {
  const d = 1.4;
  const walk = makeClip('zwalk', d, [
    oscRotTrack('legL', { x: [0, 0.35] }, d),
    oscRotTrack('legR', { x: [0, 0.35, 0.5] }, d),
    oscRotTrack('shinL', { x: [0.2, 0.2, 0.25] }, d),
    oscRotTrack('shinR', { x: [0.2, 0.2, 0.75] }, d),
    oscRotTrack('armL', { x: [-1.45, 0.12], z: [0.1, 0.05] }, d),
    oscRotTrack('armR', { x: [-1.4, 0.12, 0.5], z: [-0.1, 0.05] }, d),
    oscRotTrack('torso', { x: [0.15, 0.03], z: [0, 0.08] }, d),
    oscRotTrack('head', { z: [0.25, 0.08], x: [0.1, 0.05] }, d),
    oscPosTrack('hips', [0, HIP_Y - 0.03, 0], [0, 0.03, 0], d, 16, 2),
  ]);
  const idle = makeClip('zidle', 3, [
    oscRotTrack('armL', { x: [-0.2, 0.05] }, 3),
    oscRotTrack('armR', { x: [-0.2, 0.05, 0.5] }, 3),
    oscRotTrack('torso', { x: [0.25, 0.05], z: [0, 0.1] }, 3),
    oscRotTrack('head', { z: [0.35, 0.1] }, 3),
  ]);
  const attack = makeClip('zattack', 0.6, [
    keyRotTrack('armL', [0, 0.25, 0.4, 0.6], [[-1.4, 0, 0], [-2.3, 0, 0.3], [-0.9, 0, -0.2], [-1.4, 0, 0]]),
    keyRotTrack('armR', [0, 0.25, 0.4, 0.6], [[-1.4, 0, 0], [-2.3, 0, -0.3], [-0.9, 0, 0.2], [-1.4, 0, 0]]),
    keyRotTrack('torso', [0, 0.25, 0.4, 0.6], [[0.15, 0, 0], [-0.1, 0, 0], [0.4, 0, 0], [0.15, 0, 0]]),
  ]);
  return { walk, idle, attack };
}
