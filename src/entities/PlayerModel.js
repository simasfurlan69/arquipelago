/**
 * PlayerModel.js
 * Corpo do personagem principal: Soldier.glb (exemplos oficiais do three.js,
 * esqueleto Mixamo) animado pelos 5 clipes Mixamo do usuário, sem alteração nos
 * arquivos (assets/animations/*.fbx):
 *   Idle → parado · Holding Walk → andando · Running → correndo
 *   Jump → pulo (one-shot) · Great Sword Slash → golpes (one-shot)
 *
 * Os FBX são "Without Skin" (só esqueleto + animação). Como os ossos têm o mesmo
 * nome (mixamorig*), as trilhas tocam direto no esqueleto do Soldier.
 * O deslocamento X/Z do quadril (root motion) é removido em memória para que
 * a física do jogo controle a posição.
 *
 * Ações sem clipe (leme, mirar o arco, comer, levar dano) usam uma camada de
 * pose procedural aplicada nos ossos depois do mixer (applyPoseLayer).
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { uniform, vec3 } from 'three/tsl';

// Locomoção: Female Locomotion Pack (Mixamo, "in place"); golpe: Great Sword Slash.
const ANIMS = {
  idle: 'locomotion/idle.fbx',
  walk: 'locomotion/walking.fbx',
  run: 'locomotion/running.fbx',
  jump: 'locomotion/jump.fbx',
  strafeL: 'locomotion/left strafe.fbx',
  strafeR: 'locomotion/right strafe.fbx',
  strafeWalkL: 'locomotion/left strafe walk.fbx',
  strafeWalkR: 'locomotion/right strafe walk.fbx',
  turnL: 'locomotion/left turn.fbx',
  turnR: 'locomotion/right turn.fbx',
  slash: 'Great Sword Slash.fbx',
};

/**
 * Animações de combate OPCIONAIS (Mixamo, "Without Skin", baixadas pelo jogador).
 * Se o arquivo existir em assets/animations/combat/, substitui a pose procedural.
 * Veja assets/animations/combat/LEIA.txt.
 */
const OPTIONAL_ANIMS = {
  roll: 'combat/roll.fbx',
  dodgeL: 'combat/dodge_left.fbx',
  dodgeR: 'combat/dodge_right.fbx',
  heavy: 'combat/heavy_attack.fbx',
  special: 'combat/special_attack.fbx',
};

/** Remove o deslocamento horizontal do quadril (mantém a animação no lugar). */
function stripRootMotion(clip, keepY = true) {
  for (const t of clip.tracks) {
    if (!/Hips\.position$/.test(t.name)) continue;
    const v = t.values;
    const x0 = v[0], y0 = v[1], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
      if (!keepY) v[i + 1] = y0;
    }
  }
  return clip;
}

/**
 * Carrega o personagem principal e os clipes.
 * Ordem: assets/models/escanor.fbx (rigado no Mixamo, "With Skin") → soldier.glb.
 * @returns {Promise<{model, clips, bones, facing: number, name: string}>}
 */
export async function loadPlayerModel(base = './assets') {
  let model = null, name = 'Soldier';
  try {
    const head = await fetch(`${base}/models/escanor.fbx`, { method: 'HEAD' });
    if (head.ok) {
      model = await new FBXLoader().loadAsync(`${base}/models/escanor.fbx`);
      name = 'Escanor';
      setupEscanorMaterials(model);
    }
  } catch (e) {
    console.warn('escanor.fbx não carregou; usando o Soldier.', e);
    model = null;
  }
  if (!model) model = (await new GLTFLoader().loadAsync(`${base}/models/soldier.glb`)).scene;

  model.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  });

  // ---- Escala automática: personagem com ~2,1 m (Escanor) ou ~1,8 m (Soldier) ----
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const h = box.max.y - box.min.y;
  const wantH = name === 'Escanor' ? 2.1 : 1.8;
  if (h > 0 && Math.abs(h - wantH) / wantH > 0.15) model.scale.multiplyScalar(wantH / h);
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model, true);
  model.position.y -= box2.min.y;            // pés no chão (y = 0 do root)
  model.updateMatrixWorld(true);

  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o; });
  if (!bones.Hips) throw new Error(`${name}: esqueleto Mixamo (mixamorig*) não encontrado`);

  // ---- Frente automática: com o personagem olhando para +Z, o braço esquerdo fica em +X ----
  const la = bones.LeftArm.getWorldPosition(new THREE.Vector3());
  const ra = bones.RightArm.getWorldPosition(new THREE.Vector3());
  const facing = la.x - ra.x >= 0 ? 0 : Math.PI;

  const fbx = new FBXLoader();
  const clips = {};
  await Promise.all(Object.entries(ANIMS).map(async ([key, file]) => {
    const obj = await fbx.loadAsync(`${base}/animations/${file.split('/').map(encodeURIComponent).join('/')}`);
    const clip = obj.animations[0];
    clip.name = key;
    // Retarget em espaço de mundo, em memória (o arquivo .fbx não é alterado).
    // Locomoção: remove o giro do corpo embutido no clipe (o Running.fbx gira 360° no ciclo).
    clip.tracks = retargetWorld(model, obj, clip, 30, { removeYaw: spinsInPlace(obj, clip) }).tracks;
    clips[key] = clip;
  }));
  // opcionais: HEAD primeiro (sem erro 404 no console do jogo se não existir)
  await Promise.all(Object.entries(OPTIONAL_ANIMS).map(async ([key, file]) => {
    try {
      const url = `${base}/animations/${file}`;
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) return;
      const obj = await fbx.loadAsync(url);
      const clip = obj.animations[0];
      clip.name = key;
      clip.tracks = retargetWorld(model, obj, clip, 30, {}).tracks;
      stripRootMotion(clip);              // o deslocamento é do jogo, não do clipe
      clips[key] = clip;
      console.info('[anim] combate opcional carregado:', key);
    } catch (e) { console.warn('[anim] falhou', file, e); }
  }));
  return { model, clips, bones, facing, name };
}

/**
 * O clipe gira o corpo inteiro ao longo do ciclo (como o Running.fbx antigo, 360°)?
 * Mede o yaw do quadril em 12 quadros; amplitude > 150° → remover o giro no retarget.
 */
function spinsInPlace(obj, clip) {
  const bones = {}; obj.traverse((b) => { if (b.isBone) bones[b.name] = b; });
  const L = bones.mixamorigLeftUpLeg, R = bones.mixamorigRightUpLeg;
  if (!L || !R) return false;
  const mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clip).play();
  let prev = null, total = 0;
  for (let i = 0; i <= 12; i++) {
    mixer.setTime(clip.duration * i / 12); obj.updateMatrixWorld(true);
    const v = L.getWorldPosition(new THREE.Vector3()).sub(R.getWorldPosition(new THREE.Vector3()));
    const y = Math.atan2(v.x, v.z);
    if (prev !== null) { let d = y - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); total = Math.max(total, Math.abs(d)) + 0 * d; }
    prev = y;
  }
  mixer.stopAllAction(); mixer.uncacheRoot(obj);
  return total > 0.9;   // salto > ~50° entre quadros vizinhos = giro do corpo inteiro
}

/** Materiais do Escanor (o FBX só traz cores): pele com SSS, roupas e cabelo PBR. */
function setupEscanorMaterials(model) {
  const conv = (src) => {
    const n = (src.name || '').toLowerCase();
    const col = src.color ? src.color.clone() : new THREE.Color(0xcccccc);
    if (/body|skin/.test(n)) {
      const m = new THREE.MeshSSSNodeMaterial();
      m.color.copy(col); m.roughness = 0.5; m.metalness = 0;
      m.map = src.map || null;
      m.thicknessColorNode = vec3(0.85, 0.3, 0.18);
      m.thicknessDistortionNode = uniform(0.12);
      m.thicknessAmbientNode = uniform(0.25);
      m.thicknessAttenuationNode = uniform(0.7);
      m.thicknessPowerNode = uniform(2.6);
      m.thicknessScaleNode = uniform(4.0);
      return m;
    }
    const m = new THREE.MeshStandardNodeMaterial({ color: col, map: src.map || null, metalness: 0,
      roughness: /hair/.test(n) ? 0.55 : 0.85 });
    return m;
  };
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    // olhos e língua: brilhantes
    if (/eye/i.test(o.name)) { o.material.roughness = 0.08; }
    if (/tongue/i.test(o.name)) { o.material.roughness = 0.3; }
  });
}

// =============================================================================
// Retarget em espaço de mundo
// =============================================================================
/**
 * Converte um clipe tocado no esqueleto do FBX (source) para o esqueleto do
 * Soldier (target), mesmo quando os ossos têm orientações de repouso diferentes:
 *   Wt = Ws · Ws0⁻¹ · Wt0   (rotação de mundo do alvo = delta da fonte aplicado ao repouso do alvo)
 * O quadril recebe só o deslocamento vertical (em escala), sem root motion X/Z.
 */
function retargetWorld(target, source, clip, fps = 30, { removeYaw = false } = {}) {
  target.updateMatrixWorld(true);
  source.updateMatrixWorld(true);
  const srcBones = {};
  source.traverse((o) => { if (o.isBone || o.type === 'Bone') srcBones[o.name] = o; });
  const tgtBones = [];
  target.traverse((o) => { if (o.isBone) tgtBones.push(o); });   // ordem pai → filho

  const q = () => new THREE.Quaternion();
  const restT = new Map(), restS = new Map();
  for (const b of tgtBones) restT.set(b, b.getWorldQuaternion(q()));
  for (const n in srcBones) restS.set(n, srcBones[n].getWorldQuaternion(q()));
  const tHips = tgtBones.find((b) => /Hips$/.test(b.name));
  const sHips = srcBones[tHips.name];
  const tHip0 = tHips.getWorldPosition(new THREE.Vector3());
  const sHip0 = sHips ? sHips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  const tRootY = target.getWorldPosition(new THREE.Vector3()).y, sRootY = source.getWorldPosition(new THREE.Vector3()).y;
  const ratio = (tHip0.y - tRootY) / Math.max(1e-6, sHip0.y - sRootY);
  const parentRest = new Map(tgtBones.map((b) => [b, b.parent.getWorldQuaternion(q())]));

  // Os dois esqueletos podem estar girados em Y um em relação ao outro (o Soldier vem
  // virado 180°). R leva o referencial de mundo da fonte para o do alvo, medido pela
  // direção do braço esquerdo (ombro → cotovelo) no plano XZ.
  const armDir = (bone) => {
    const c = bone && bone.children.find((x) => x.isBone || x.type === 'Bone');
    return c ? c.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())) : null;
  };
  const armName = tHips.name.replace('Hips', 'LeftArm');
  const dT = armDir(tgtBones.find((b) => b.name === armName)), dS = armDir(srcBones[armName]);
  const yaw = dT && dS ? Math.atan2(dT.x, dT.z) - Math.atan2(dS.x, dS.z) : 0;
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const Rinv = R.clone().invert();

  const sUpL = srcBones[tHips.name.replace('Hips', 'LeftUpLeg')], sUpR = srcBones[tHips.name.replace('Hips', 'RightUpLeg')];
  const legYaw0 = sUpL && sUpR ? (() => { const v = sUpL.getWorldPosition(new THREE.Vector3()).sub(sUpR.getWorldPosition(new THREE.Vector3())); return Math.atan2(v.x, v.z); })() : 0;

  const mixer = new THREE.AnimationMixer(source);
  mixer.clipAction(clip).play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const quat = new Map(tgtBones.map((b) => [b, new Float32Array(frames * 4)]));
  const hipPos = new Float32Array(frames * 3);
  const world = new Map();
  const tmp = q(), inv = q(), v = new THREE.Vector3();

  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, (f / (frames - 1)) * clip.duration);
    times[f] = t;
    mixer.setTime(t);
    source.updateMatrixWorld(true);
    world.clear();
    // giro do quadril neste quadro (pela linha entre as coxas), relativo ao repouso
    let fix = null;
    if (removeYaw && sUpL && sUpR) {
      const lv = sUpL.getWorldPosition(new THREE.Vector3()).sub(sUpR.getWorldPosition(new THREE.Vector3()));
      const yawNow = Math.atan2(lv.x, lv.z);
      fix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), legYaw0 - yawNow);
    }
    for (const b of tgtBones) {
      const s = srcBones[b.name];
      const pW = world.get(b.parent) || parentRest.get(b);
      let W;
      if (s) {
        // delta da fonte levado ao referencial do alvo: R · (Ws · Ws0⁻¹) · R⁻¹ · Wt0
        const delta = s.getWorldQuaternion(q()).multiply(inv.copy(restS.get(b.name)).invert());
        if (fix) delta.premultiply(fix);
        W = R.clone().multiply(delta).multiply(Rinv).multiply(restT.get(b));
      } else {
        W = pW.clone().multiply(b.quaternion);
      }
      world.set(b, W);
      tmp.copy(pW).invert().multiply(W);
      tmp.toArray(quat.get(b), f * 4);
    }
    // quadril: só o sobe-e-desce, em escala, no espaço do pai
    if (sHips) {
      const dy = (sHips.getWorldPosition(v).y - sHip0.y) * ratio;
      v.copy(tHip0); v.y += dy;
      tHips.parent.worldToLocal(v);
      v.toArray(hipPos, f * 3);
    }
  }
  mixer.stopAllAction();
  const tracks = tgtBones.map((b) => new THREE.QuaternionKeyframeTrack(b.name + ".quaternion", times, quat.get(b)));
  if (sHips) tracks.push(new THREE.VectorKeyframeTrack(tHips.name + ".position", times, hipPos));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// =============================================================================
// Camada de pose procedural (rotações em espaço do personagem)
// =============================================================================
const _qW = new THREE.Quaternion(), _qP = new THREE.Quaternion(), _qR = new THREE.Quaternion();
const _axis = new THREE.Vector3();

/**
 * Gira um osso em torno de um eixo expresso no espaço do personagem (root).
 * Convenção: personagem olha para +Z, +X é a esquerda. Ângulo negativo em X
 * leva um membro pendurado para frente.
 */
export function rotateBoneInRootSpace(bone, root, axisLocal, angle) {
  if (!bone || !angle) return;
  root.getWorldQuaternion(_qR);
  _axis.copy(axisLocal).applyQuaternion(_qR).normalize();
  bone.getWorldQuaternion(_qW);
  bone.parent.getWorldQuaternion(_qP);
  const rot = new THREE.Quaternion().setFromAxisAngle(_axis, angle);
  _qW.premultiply(rot);
  bone.quaternion.copy(_qP.invert().multiply(_qW));
  bone.updateMatrixWorld(true);
}

export const AX = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
