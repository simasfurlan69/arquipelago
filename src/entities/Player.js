/**
 * Player.js
 * Personagem principal:
 *  - visual: rig humanoide procedural com pele SSS (WebGPU, MeshSSSNodeMaterial);
 *  - animação: AnimationMixer + BlendSpace 1D por velocidade (idle → walk → run),
 *    crossfade para "steer" ao assumir o leme, pose de mira do arco e ações
 *    one-shot por cima da locomoção (golpes, comer, dano);
 *  - controle: WASD relativo à câmera, Shift corre, colisão com terreno e colisores,
 *    sem entrar em água funda;
 *  - combate: alvo registrável (hit spheres, takeDamage, knockback).
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { BlendSpace } from '../utils/AnimUtils.js';
import { damp, dampAngle, clamp } from '../utils/Noise.js';
import { buildHumanoid, createHumanoidClips, createActionClips } from './HumanoidRig.js';
import { createSkinMaterial, createClothMaterial } from './CharacterMaterials.js';
import { buildHeldItem } from './HeldItems.js';
import { HitFlash } from '../game/Combat.js';
import { loadPlayerModel, rotateBoneInRootSpace, AX } from './PlayerModel.js';
import { BeltLantern } from './BeltLantern.js';
// import { loadGLB, findClip } from '../core/AssetLoader.js';

const P = CONFIG.player;

export class Player {
  constructor(scene, terrain, colliders, input) {
    this.scene = scene;
    this.terrain = terrain;
    this.colliders = colliders;
    this.input = input;

    this.state = 'foot';              // 'foot' | 'boat'
    this.speed = 0;
    this.facing = 0;
    this.boat = null;
    this.knock = new THREE.Vector3();
    this.running = false;
    this.aimingBow = false;
    this.lockFacing = 0;              // s em que o personagem encara a mira
    this.faction = 'player';
    this.alive = true;
    this.stats = null;                // PlayerStats (ligado no main)
    this.onHurt = () => {};

    // ---- Materiais (pele com Subsurface Scattering) ----
    const mats = {
      skin: createSkinMaterial({ tone: 0xd8a07c, scale: 6 }),
      shirt: createClothMaterial(0x2d5a7b),
      pants: createClothMaterial(0x4a3b2a),
      boots: createClothMaterial(0x2a1d14, { roughness: 0.7 }),
    };
    const { root, nodes } = buildHumanoid(mats, { bulk: 1 });
    this.root = root;
    this.nodes = nodes;
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 16), createClothMaterial(0xa8322a));
    sash.rotation.x = Math.PI / 2; sash.position.y = 0.06; sash.castShadow = true;
    nodes.hips.add(sash);
    scene.add(root);
    this.flash = new HitFlash(root);

    // ---- Animação ----
    this.mixer = new THREE.AnimationMixer(root);
    const clips = createHumanoidClips();
    this.actions = createActionClips();
    this.blend = new BlendSpace(this.mixer, [clips.idle, clips.walk, clips.run, clips.steer, this.actions.bowHold]);
    this.blend.setTargets({ idle: 1 });

    this.heldId = null;
    this.held = null;
    this._sph = [{ x: 0, y: 0, z: 0, r: 0.45 }, { x: 0, y: 0, z: 0, r: 0.35 }];
    this._wp = new THREE.Vector3();
  }

  get position() { return this.root.position; }
  getWorldPosition(out) { return this.root.getWorldPosition(out); }

  spawnAt(x, z) {
    this.root.position.set(x, this.groundHeight(x, z), z);
    this.knock.set(0, 0, 0);
    this.vel?.set(0, 0);
    this.speed = 0;
  }

  groundHeight(x, z) {
    return Math.max(this.terrain.getHeight(x, z), this.colliders.platformHeight(x, z));
  }

  // ---------------------------------------------------------------------------
  // Item na mão
  // ---------------------------------------------------------------------------
  /** Posição de mundo do cano da arma na mão (ou do peito, se não houver). */
  muzzleWorld(out) {
    if (this.held?.muzzle) return this.held.muzzle.getWorldPosition(out);
    return this.getWorldPosition(out).add(new THREE.Vector3(0, 1.45, 0));
  }

  setHeldItem(id) {
    if (id === this.heldId) return;
    this.heldId = id;
    if (this.held) this.held.object.removeFromParent();
    this.held = buildHeldItem(id);
    if (this.held) this.nodes[`hand${this.held.hand}`].add(this.held.object);
    this.blade = null;
  }

  /**
   * Base e ponta da lâmina do item na mão (mundo) para o rastro do golpe.
   * O eixo mais comprido da caixa do item define a lâmina; a ponta é a extremidade
   * mais longe da palma. Calculado sob demanda (modelos .glb chegam assíncronos).
   */
  bladeWorld(a, b) {
    const h = this.held;
    if (!h) return false;
    const o = h.object;
    if (!this.blade || this.blade.n !== o.children.length) {
      o.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), m4 = new THREE.Matrix4();
      const box = new THREE.Box3(), tmp = new THREE.Box3();
      o.traverse((m) => {
        if (!m.isMesh || !m.geometry || !m.visible) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(tmp.copy(m.geometry.boundingBox).applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld)));
      });
      if (box.isEmpty()) return false;
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const ax = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
      const e1 = c.clone(), e2 = c.clone(); e1[ax] = box.min[ax]; e2[ax] = box.max[ax];
      const tip = e1.lengthSq() > e2.lengthSq() ? e1 : e2, hilt = tip === e1 ? e2 : e1;
      this.blade = { n: o.children.length, base: hilt.clone().lerp(tip, 0.3), tip };
    }
    a.copy(this.blade.base); o.localToWorld(a);
    b.copy(this.blade.tip); o.localToWorld(b);
    return true;
  }

  /** Toca uma ação one-shot ('swing' | 'chop' | 'mine' | 'eat' | 'hurt' | 'jump'). */
  playAction(name, speed = 1) {
    if (this.mixamo) {
      // Sem clipe Mixamo para comer/dano: camada de pose procedural
      if (name === 'eat') { this._eatT = 0.9; return; }
      if (name === 'hurt') { this._hurtT = 0.3; return; }
      // andando/correndo: golpe só da cintura para cima (as pernas seguem o passo)
      let clip = this.actions[name];
      if (name !== 'jump' && this.speed > 0.6) clip = this.actions.slashUpper;
      if (!clip) return;
      // Great Sword Slash comprimido para ~0.75 s; pulo um pouco acelerado
      const s = name === 'jump' ? 1.15 : clip.duration / 0.75;
      this.blend.playOneShot(clip, { speed: s, weight: 4, fadeIn: 0.12, fadeOut: 0.2 });
      return;
    }
    const clip = this.actions[name];
    if (clip) this.blend.playOneShot(clip, { speed, weight: name === 'hurt' ? 2 : 4 });
  }

  /**
   * Golpe do combo (0, 1, 2) ou carregado ('spin'). Andando: só o tronco anima.
   * @param {number} dur duração desejada do golpe (s)
   */
  attackAnim(step, dur = 0.5) {
    if (!this.mixamo) { this.playAction(['swing', 'chop', 'mine'][step % 3] || 'swing'); return; }
    if (step === 'spin') {
      this.spinT = 0.55;                                        // giro de 360° do corpo (no update)
      this.blend.playOneShot(this.speed > 0.6 ? this.comboU[2] : this.combo[2], { speed: this.combo[2].duration / 0.55, weight: 4, fadeIn: 0.06, fadeOut: 0.15 });
      return;
    }
    const c = (this.speed > 0.6 ? this.comboU : this.combo)[step];
    this.blend.playOneShot(c, { speed: c.duration / dur, weight: 4, fadeIn: 0.06, fadeOut: 0.14 });
  }

  /**
   * Esquiva:
   *  - em movimento → ROLAMENTO de 360° na direção do movimento (0,55 s, ~4 m);
   *  - com alvo travado e indo para o lado → PASSO LATERAL rápido (0,32 s);
   *  - parado → SALTO PARA TRÁS (0,4 s).
   * Invulnerável nos primeiros 75%. Um golpe evitado logo no início (≤ 0,3 s) é
   * uma ESQUIVA PERFEITA → onPerfectDodge() (câmera lenta + contra-ataque).
   */
  dodge() {
    if (this.state !== 'foot' || this.dodgeT > 0 || (this.dodgeCd || 0) > 0) return false;
    if (this.stats && !this.stats.useStamina(28)) return false;
    let dx = this.vel?.x || 0, dz = this.vel?.y || 0;
    const moving = Math.hypot(dx, dz) >= 0.5;
    if (!moving) { dx = -Math.sin(this.facing); dz = -Math.cos(this.facing); }
    const l = Math.hypot(dx, dz);
    this.dodgeDir = { x: dx / l, z: dz / l };
    // lado em relação ao rosto: +1 esquerda (+X local), −1 direita
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const fwd = this.dodgeDir.x * fx + this.dodgeDir.z * fz;
    this.dodgeSide = Math.sign(this.dodgeDir.x * fz - this.dodgeDir.z * fx) || 1;
    this.dodgeKind = !moving ? 'back' : (this.lockTarget && Math.abs(fwd) < 0.5) ? 'step' : 'roll';
    this.dodgeDur = { roll: 0.55, step: 0.32, back: 0.4 }[this.dodgeKind];
    if (this.dodgeKind === 'roll') this.dodgeYaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    this.dodgeT = this.dodgeDur;
    this.dodgeStart = performance.now();
    this.dodgeCd = this.dodgeDur + 0.25;
    this._perfectUsed = false;
    const clip = this.clips && (this.dodgeKind === 'roll' ? this.clips.roll : this.dodgeKind === 'step' ? (this.dodgeSide > 0 ? this.clips.dodgeL : this.clips.dodgeR) : null);
    this._dodgeClip = !!clip;
    if (clip) this.blend.playOneShot(clip, { speed: clip.duration / this.dodgeDur, weight: 5, fadeIn: 0.05, fadeOut: 0.12 });
    this.audio?.dodge(this.root.position);
    this.onDodge?.(this.dodgeKind);
    return true;
  }

  /** Visual do rolamento/passo/salto: gira o grupo do corpo em torno do quadril. */
  _updateRoll() {
    const g = this.rollGroup; if (!g) return;
    if (!(this.dodgeT > 0) || this._dodgeClip) {
      g.rotation.set(0, 0, 0); g.position.set(0, 0, 0);
      if (this.dodgeT > 0) this._keepAboveGround();   // clipe Mixamo de rolamento também não afunda
      return;
    }
    const p = 1 - this.dodgeT / this.dodgeDur, bell = Math.sin(p * Math.PI);
    if (this.dodgeKind === 'roll') {
      // 360° concentrados entre 8% e 88% do tempo, com aceleração e frenagem
      const q = THREE.MathUtils.clamp((p - 0.08) / 0.8, 0, 1), e = q * q * (3 - 2 * q);
      const a = e * Math.PI * 2, h = 0.55;
      g.rotation.set(a, 0, 0);
      g.position.set(0, h - h * Math.cos(a) - 0.35 * bell, -h * Math.sin(a));
    } else if (this.dodgeKind === 'step') {
      g.rotation.set(0, 0, -this.dodgeSide * 0.32 * bell);
      g.position.set(0, -0.18 * bell, 0);
    } else {
      g.rotation.set(-0.22 * bell, 0, 0);
      g.position.set(0, 0.28 * bell, 0);
    }
    this._keepAboveGround();
  }

  /**
   * Nada atravessa o chão: mede as juntas do corpo (cabeça, mãos, pés, quadril…)
   * já giradas e, se alguma ficar abaixo do terreno + espessura da pele, ergue o
   * grupo do corpo. Funciona em ladeira porque amostra o chão sob cada junta.
   */
  _keepAboveGround() {
    const g = this.rollGroup, B = this.bones; if (!g || !B) return;
    if (!this._groundJoints) {
      const names = { Head: 0.14, HeadTop_End: 0.04, Hips: 0.14, Spine2: 0.16, LeftShoulder: 0.1, RightShoulder: 0.1,
        LeftForeArm: 0.07, RightForeArm: 0.07, LeftHand: 0.06, RightHand: 0.06, LeftLeg: 0.08, RightLeg: 0.08,
        LeftFoot: 0.06, RightFoot: 0.06, LeftToe_End: 0.02, RightToe_End: 0.02 };
      this._groundJoints = Object.entries(names).filter(([n]) => B[n]).map(([n, r]) => [B[n], r]);
      this._gv = new THREE.Vector3();
    }
    this.root.updateMatrixWorld(true);
    let lift = 0;
    for (const [bone, r] of this._groundJoints) {
      bone.getWorldPosition(this._gv);
      const under = this.groundHeight(this._gv.x, this._gv.z) + r - this._gv.y;
      if (under > lift) lift = under;
    }
    if (lift > 0) { g.position.y += lift; this.root.updateMatrixWorld(true); }
  }

  // ---------------------------------------------------------------------------
  // Corpo Mixamo (Soldier + animações do usuário)
  // ---------------------------------------------------------------------------
  async useMixamoModel() {
    const { model, clips, bones, facing, name } = await loadPlayerModel();
    this.modelName = name;
    this.proceduralParts = [...this.root.children];
    for (const c of this.proceduralParts) c.visible = false;
    // O jogo usa "frente = +Z". A frente do modelo é detectada no carregamento
    // (Soldier olha para −Z → 180°; um FBX do Mixamo normalmente já olha para +Z → 0°).
    const facingFix = new THREE.Group();
    facingFix.name = 'facingFix';
    facingFix.rotation.y = facing;
    facingFix.add(model);
    // grupo intermediário: o rolamento gira o corpo em torno do quadril sem mexer na física
    this.rollGroup = new THREE.Group();
    this.rollGroup.name = 'rollGroup';
    this.rollGroup.add(facingFix);
    this.root.add(this.rollGroup);
    this.model = model;
    this.bones = bones;
    this.clips = clips;

    this.mixer = new THREE.AnimationMixer(model);
    const steer = clips.idle.clone(); steer.name = 'steer';
    const bow = clips.idle.clone(); bow.name = 'bowHold';
    this.blend = new BlendSpace(this.mixer, [clips.idle, clips.walk, clips.run, clips.strafeL, clips.strafeR,
      clips.strafeWalkL, clips.strafeWalkR, clips.turnL, clips.turnR, steer, bow]);
    this.blend.setTargets({ idle: 1 });
    // passada sincronizada entre andar, correr e andar de lado (sem troca de pé no blend)
    this.blend.syncGroup(['walk', 'run', 'strafeL', 'strafeR', 'strafeWalkL', 'strafeWalkR']);
    // Combo de espada: o Great Sword Slash tem 3 golpes; cada trecho vira um ataque
    const AU = THREE.AnimationUtils, fps = 30, nF = Math.round(clips.slash.duration * fps);
    const cut = (n, a, b) => { const c = AU.subclip(clips.slash, n, Math.round(a * nF), Math.round(b * nF), fps); return c; };
    const upperOf = (c) => { const u = c.clone(); u.name = c.name + 'U'; u.tracks = u.tracks.filter((t) => !/(Hips|UpLeg|Leg|Foot|Toe)/.test(t.name)); return u; };
    this.combo = [cut('combo1', 0.02, 0.36), cut('combo2', 0.33, 0.66), cut('combo3', 0.62, 0.98)];
    this.comboU = this.combo.map(upperOf);
    const upper = clips.slash.clone();
    upper.name = 'slashUpper';
    upper.tracks = upper.tracks.filter((t) => !/(Hips|UpLeg|Leg|Foot|ToeBase|Toe_End)./.test(t.name));
    this.actions = { swing: clips.slash, chop: clips.slash, mine: clips.slash, jump: clips.jump, slashUpper: upper };
    this.mixamo = true;
    this.pose = { steer: 0, bow: 0, eat: 0 };
    this._eatT = 0; this._hurtT = 0; this.jumpT = 0;

    // ---- Sockets das mãos (RightHandSocket / LeftHandSocket) ----
    // Orientados pela anatomia da mão no repouso, e não pelo eixo cru do osso:
    //   +Y = lado do polegar (indicador ← mínimo), +Z = direção dos dedos, origem no centro da palma.
    // Escala compensada (o rig Mixamo está em centímetros) → o socket mede 1 m = 1 unidade.
    this.root.updateMatrixWorld(true);
    const rootScale = this.root.getWorldScale(new THREE.Vector3()).x;
    const socket = (side) => {
      const hand = bones[`${side}Hand`];
      const P = (n) => bones[`${side}Hand${n}`]?.getWorldPosition(new THREE.Vector3());
      const h = new THREE.Group();
      h.name = `${side}HandSocket`;
      const hp = hand.getWorldPosition(new THREE.Vector3());
      const mid = P('Middle1'), idx = P('Index1'), pinky = P('Pinky1');
      if (mid && idx && pinky) {
        const zAxis = mid.clone().sub(hp).normalize();                         // dedos
        const yAxis = idx.clone().sub(pinky); yAxis.addScaledVector(zAxis, -yAxis.dot(zAxis)).normalize();  // polegar
        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
        const qWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
        const qHand = hand.getWorldQuaternion(new THREE.Quaternion());
        h.quaternion.copy(qHand.invert().multiply(qWorld));
        // centro da palma: entre o punho e a base dos dedos, levemente para dentro
        const palm = hp.clone().lerp(mid, 0.55);
        h.position.copy(hand.worldToLocal(palm));
      } else h.rotation.set(Math.PI, 0, 0);                                     // rig sem dedos: aproximação
      h.scale.setScalar(rootScale / hand.getWorldScale(new THREE.Vector3()).x);
      hand.add(h);
      return h;
    };
    this.nodes = { ...this.nodes, handR: socket('Right'), handL: socket('Left') };
    this.rightHandSocket = this.nodes.handR;
    const id = this.heldId;
    this.heldId = undefined;
    this.setHeldItem(id);
    this.flash = new HitFlash(this.root);
    // ---- Lanterna de cinto (lado esquerdo do quadril, pêndulo físico) ----
    if (bones.Hips) { this.lantern = new BeltLantern(bones.Hips, this.root); this.lantern.hook.visible = false; }
  }

  /** Camada de pose procedural sobre o mixer: leme, arco, comer, dano. */
  _applyPose(dt) {
    const p = this.pose, B = this.bones, R = this.root;
    const k = 1 - Math.exp(-10 * dt);
    this._eatT = Math.max(0, this._eatT - dt);
    this._hurtT = Math.max(0, this._hurtT - dt);
    p.steer += ((this.state === 'boat' ? 1 : 0) - p.steer) * k;
    p.bow += ((this.aimingBow ? 1 : 0) - p.bow) * k;
    p.eat += ((this._eatT > 0 ? 1 : 0) - p.eat) * k * 1.5;
    this._t = (this._t || 0) + dt;
    if (p.steer < 0.01 && p.bow < 0.01 && p.eat < 0.01 && this._hurtT <= 0 && !this.aimingGun && (p.gun || 0) < 0.01 && !this.holdCategory && (p.carry || 0) < 0.01 && !(this.dodgeT > 0) && !(this.heavyCharge > 0) && !(this.heavyT > 0)) return;   // nada a aplicar
    R.updateMatrixWorld(true);

    if (p.steer > 0.01) {
      // mãos no timão, girando conforme o leme
      const r = this.boat ? this.boat.rudder : 0;
      rotateBoneInRootSpace(B.LeftArm, R, AX.X, (-0.95 + r * 0.25) * p.steer);
      rotateBoneInRootSpace(B.RightArm, R, AX.X, (-0.95 - r * 0.25) * p.steer);
      rotateBoneInRootSpace(B.LeftForeArm, R, AX.X, -0.55 * p.steer);
      rotateBoneInRootSpace(B.RightForeArm, R, AX.X, -0.55 * p.steer);
    }
    // ---- pose de empunhadura por categoria ----
    const cat = this.holdCategory, gun = this.aimingGun && this.state === 'foot';
    // arma de fogo: pose completa ao mirar/atirar; senão, "pronta" baixa (cano para o chão)
    const ready = gun && (this.input.mouseDown(2) || this.lockFacing > 0) ? 1 : gun ? (this.speed > 4 ? 0.15 : 0.4) : 0;
    p.gun = (p.gun || 0) + (ready - (p.gun || 0)) * k;
    p.carry = (p.carry || 0) + ((cat === 'weapon' || cat === 'tool' ? 1 : 0) - (p.carry || 0)) * k;
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 6);
    if (p.gun > 0.01) {
      // braço direito estendido para frente, cotovelo levemente dobrado; rifle apoia com a esquerda
      const two = this.held?.twoHanded ? 1 : 0;
      rotateBoneInRootSpace(B.RightArm, R, AX.X, (-1.25 - this.recoil * 0.25) * p.gun);
      rotateBoneInRootSpace(B.RightForeArm, R, AX.X, (-0.25 - this.recoil * 0.15) * p.gun);
      rotateBoneInRootSpace(B.Spine1, R, AX.Y, -0.15 * p.gun);
      if (two) { rotateBoneInRootSpace(B.LeftArm, R, AX.X, -1.15 * p.gun); rotateBoneInRootSpace(B.LeftArm, R, AX.Y, -0.6 * p.gun); rotateBoneInRootSpace(B.LeftForeArm, R, AX.X, -0.9 * p.gun); }
    } else if (p.carry > 0.01 && this.speed < 5.5) {
      // arma/ferramenta: antebraço levemente erguido para a lâmina não arrastar no chão
      rotateBoneInRootSpace(B.RightForeArm, R, AX.X, -0.35 * p.carry);
    }
    if (p.bow > 0.01) {
      // corpo de lado, braço esquerdo esticado, direito puxando a corda
      rotateBoneInRootSpace(B.Spine1, R, AX.Y, 0.3 * p.bow);
      rotateBoneInRootSpace(B.LeftArm, R, AX.X, -1.45 * p.bow);
      rotateBoneInRootSpace(B.RightArm, R, AX.X, -1.35 * p.bow);
      rotateBoneInRootSpace(B.RightForeArm, R, AX.Y, 2.1 * p.bow);
    }
    if (p.eat > 0.01) {
      const chew = Math.sin(this._t * 14) * 0.08;
      rotateBoneInRootSpace(B.RightArm, R, AX.X, (-1.25 + chew) * p.eat);
      rotateBoneInRootSpace(B.RightForeArm, R, AX.X, -1.7 * p.eat);
    }
    if (this._hurtT > 0) rotateBoneInRootSpace(B.Spine, R, AX.X, -0.3 * (this._hurtT / 0.3));

    // ---- rolamento: corpo encolhido (bola) ----
    if (this.dodgeT > 0 && !this._dodgeClip) {
      const ph = 1 - this.dodgeT / this.dodgeDur;
      const u = this.dodgeKind === 'roll' ? Math.min(1, Math.sin(ph * Math.PI) * 1.6) : this.dodgeKind === 'step' ? Math.sin(ph * Math.PI) * 0.45 : Math.sin(ph * Math.PI) * 0.3;
      rotateBoneInRootSpace(B.Spine, R, AX.X, 0.45 * u);
      rotateBoneInRootSpace(B.Spine1, R, AX.X, 0.35 * u);
      rotateBoneInRootSpace(B.Spine2, R, AX.X, 0.3 * u);
      rotateBoneInRootSpace(B.Neck, R, AX.X, 0.45 * u);
      rotateBoneInRootSpace(B.LeftUpLeg, R, AX.X, -1.5 * u);
      rotateBoneInRootSpace(B.RightUpLeg, R, AX.X, -1.5 * u);
      rotateBoneInRootSpace(B.LeftLeg, R, AX.X, 2.0 * u);
      rotateBoneInRootSpace(B.RightLeg, R, AX.X, 2.0 * u);
      rotateBoneInRootSpace(B.LeftArm, R, AX.X, -0.9 * u);
      rotateBoneInRootSpace(B.RightArm, R, AX.X, -0.9 * u);
      rotateBoneInRootSpace(B.LeftForeArm, R, AX.X, -1.3 * u);
      rotateBoneInRootSpace(B.RightForeArm, R, AX.X, -1.3 * u);
    }

    // ---- golpe pesado: carregar (arma acima da cabeça) → descer com tudo ----
    let up = this.heavyCharge > 0 ? Math.min(1, this.heavyCharge * 1.6) : 0, down = 0;
    if (this.heavyT > 0) {
      const ph = 1 - this.heavyT / 0.5;                      // 0..1
      const strike = Math.min(1, ph / 0.22);                 // desce em 0,11 s
      up = 1 - strike;
      down = ph < 0.22 ? strike : 1 - Math.max(0, (ph - 0.6) / 0.4);
    }
    if (up > 0.001 || down > 0.001) {
      const shake = this.heavyCharge >= 1 ? Math.sin(this._t * 60) * 0.03 : 0;
      rotateBoneInRootSpace(B.Spine, R, AX.X, -0.28 * up + 0.4 * down);
      rotateBoneInRootSpace(B.Spine1, R, AX.X, -0.15 * up + 0.3 * down);
      rotateBoneInRootSpace(B.RightArm, R, AX.X, (-2.7 + shake) * up - 1.0 * down);
      rotateBoneInRootSpace(B.LeftArm, R, AX.X, -2.5 * up - 0.9 * down);
      rotateBoneInRootSpace(B.RightForeArm, R, AX.X, -0.5 * up - 0.2 * down);
      rotateBoneInRootSpace(B.LeftForeArm, R, AX.X, -0.7 * up - 0.3 * down);
      rotateBoneInRootSpace(B.LeftUpLeg, R, AX.X, -0.35 * down);
      rotateBoneInRootSpace(B.LeftLeg, R, AX.X, 0.5 * down);
    }
  }

  /** Golpe pesado: dispara a descida (a pose de carga vem de heavyCharge). */
  heavyAttack() {
    this.heavyT = 0.5;
    this.heavyCharge = 0;
    if (this.clips?.heavy) this.blend.playOneShot(this.clips.heavy, { speed: this.clips.heavy.duration / 0.7, weight: 5, fadeIn: 0.05, fadeOut: 0.15 });
  }

  /** Golpe especial (F): clipe Mixamo se existir, senão o giro de 360°. */
  specialAnim() {
    if (this.clips?.special) { this.spinT = 0; this.blend.playOneShot(this.clips.special, { speed: this.clips.special.duration / 0.8, weight: 5, fadeIn: 0.05, fadeOut: 0.15 }); return 0.8; }
    this.attackAnim('spin');
    return 0.55;
  }

  // ---------------------------------------------------------------------------
  // Combate
  // ---------------------------------------------------------------------------
  getHitSpheres() {
    this.getWorldPosition(this._wp);
    this._sph[0].x = this._wp.x; this._sph[0].y = this._wp.y + 1.2; this._sph[0].z = this._wp.z;
    this._sph[1].x = this._wp.x; this._sph[1].y = this._wp.y + 0.5; this._sph[1].z = this._wp.z;
    return this._sph;
  }

  takeDamage(amount, dir, source) {
    if (!this.alive || this.stats?.dead) return;
    if (this.dodgeT > (this.dodgeDur || 0.38) * 0.25) {         // esquiva: invulnerável
      if (!this._perfectUsed && performance.now() - this.dodgeStart < 300) { this._perfectUsed = true; this.onPerfectDodge?.(source); }
      return;
    }
    this.audio?.hurt();
    if (this.state === 'boat' && source === 'ball') return;   // no leme, o casco absorve as balas
    this.stats?.damage(amount, source);
    this.flash.trigger();
    this.playAction('hurt');
    if (dir && this.state === 'foot') this.knock.set(dir.x, 0, dir.z).normalize().multiplyScalar(6);
    this.onHurt(amount);
  }

  // ---------------------------------------------------------------------------
  // Embarque / desembarque
  // ---------------------------------------------------------------------------
  boardBoat(boat) {
    this.state = 'boat';
    this.boat = boat;
    boat.helmAnchor.add(this.root);
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.speed = 0;
  }

  leaveBoat(x, z) {
    this.state = 'foot';
    this.scene.add(this.root);
    this.root.rotation.set(0, 0, 0);
    this.facing = this.boat ? this.boat.heading : this.facing;
    this.boat = null;
    this.spawnAt(x, z);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {number} cameraYaw
   */
  update(dt, cameraYaw) {
    // Física em sub-passos de no máx. 1/60 s: queda de FPS não faz o personagem "pular"
    if (this.state === 'foot') {
      const n = Math.min(4, Math.ceil(dt / (1 / 60)));
      for (let i = 0; i < n; i++) this._updateOnFoot(dt / n, cameraYaw, i === 0);
    }
    else this._updateOnBoat(dt);
    this.flash.update(dt);
    this.blend.update(dt, 7);     // fades de ~0,15 s entre parado/andando/correndo (fase sincronizada)
    if (this.mixamo) { this._applyPose(dt); this._updateRoll(); }
    if (this.lantern?.hook.visible) this.lantern.update(dt, this.night);
  }

  /** Vira o personagem para a direção da mira por um instante (ataques). */
  faceAim(cameraYaw, seconds = 0.5) {
    this.lockFacing = seconds;
    this.facing = Math.atan2(-Math.sin(cameraYaw), -Math.cos(cameraYaw));
  }

  _updateOnFoot(dt, cameraYaw, firstStep = true) {
    const { x: ax, y: ay } = this.input.axes();
    const running = (this.input.down('ShiftLeft') || this.input.down('ShiftRight')) && !this.aimingBow && (!this.stats || this.stats.stamina > 1);
    const hasInput = ax !== 0 || ay !== 0;
    this.running = running && hasInput;

    const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw);
    let mx = fx * ay + rx * ax, mz = fz * ay + rz * ax;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;

    const aimSlow = this.aimingBow || (this.aimingGun && this.input.mouseDown(2));
    const maxSpeed = (aimSlow ? P.walkSpeed * 0.55 : running ? P.runSpeed : P.walkSpeed) * (this.stats?.speedMult || 1);
    const targetSpeed = hasInput ? maxSpeed : 0;

    // Velocidade como vetor suavizado: acelera e freia com curva, e as curvas
    // viram arcos naturais (sem "estalo" ao inverter a direção).
    if (!this.vel) this.vel = new THREE.Vector2();
    // arranque forte (sem atraso ao apertar), cruzeiro suave e freada firme
    const accel = hasInput ? (this.speed < 1 ? 14 : 9) : 14;
    this.vel.x = damp(this.vel.x, mx * targetSpeed * (hasInput ? 1 : 0), accel, dt);
    this.vel.y = damp(this.vel.y, mz * targetSpeed * (hasInput ? 1 : 0), accel, dt);
    this.speed = this.vel.length();

    const pos = this.root.position;
    const ox = pos.x, oz = pos.z;

    // Mirando/atacando: encara a câmera (strafe). Normal: gira para onde está indo,
    // com velocidade angular limitada (no máx. ~600°/s) e suavizada.
    this.lockFacing = Math.max(0, this.lockFacing - dt);
    let targetFacing = this.facing;
    if (this.lockTarget && this.lockTarget.alive) {
      const tp = this.lockTarget.getHitSpheres()[0];
      targetFacing = Math.atan2(tp.x - this.root.position.x, tp.z - this.root.position.z);
    } else if (this.aimingBow || this.lockFacing > 0) targetFacing = Math.atan2(fx, fz);
    else if (this.speed > 0.25) targetFacing = Math.atan2(this.vel.x, this.vel.y);
    const prevFacing = this.facing;
    let d = targetFacing - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    // até 720°/s; meia-volta (>135°) ainda mais rápida, para não "correr de costas" ao inverter
    const maxTurn = (Math.abs(d) > 2.35 ? 20 : 12.5) * dt;
    this.facing += clamp(d * (1 - Math.exp(-16 * dt)), -maxTurn, maxTurn);
    const turnRate = Math.atan2(Math.sin(this.facing - prevFacing), Math.cos(this.facing - prevFacing)) / Math.max(dt, 1e-4);

    pos.x += this.vel.x * dt + this.knock.x * dt;
    pos.z += this.vel.y * dt + this.knock.z * dt;
    this.knock.multiplyScalar(Math.exp(-8 * dt));
    // esquiva: impulso que decai + corpo agachado/inclinado
    if (this.dodgeT > 0) {
      const k = this.dodgeT / this.dodgeDur;
      const v = { roll: 10, step: 11, back: 8 }[this.dodgeKind] * Math.min(1, k * 2.5);
      pos.x += this.dodgeDir.x * v * dt;
      pos.z += this.dodgeDir.z * v * dt;
      if (this.dodgeKind === 'roll') this.facing = this.dodgeYaw;
      this.dodgeT -= dt;
    }
    this.dodgeCd = Math.max(0, (this.dodgeCd || 0) - dt);
    // golpe pesado: avanço curto no impacto
    if (this.heavyT > 0) this.heavyT -= dt;
    // giro do golpe carregado
    if (this.spinT > 0) { this.spinT -= dt; this.spinAngle = (1 - Math.max(0, this.spinT) / 0.55) * Math.PI * 2; } else this.spinAngle = 0;

    // Inclinação leve do corpo nas curvas (proporcional à velocidade e ao giro)
    this.lean = damp(this.lean || 0, clamp(-turnRate * this.speed * 0.012, -0.18, 0.18), 6, dt);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.z = this.lean;
    this.root.rotation.x = this.rollGroup ? 0 : (this.dodgeT > 0 ? Math.sin((1 - this.dodgeT / (this.dodgeDur || 0.38)) * Math.PI) * 0.55 : 0);

    this.colliders.resolve(pos, P.radius);

    const g = this.groundHeight(pos.x, pos.z);
    const onPlatform = this.colliders.platformHeight(pos.x, pos.z) > -Infinity;
    const tooSteep = !onPlatform && this.terrain.getSlope(pos.x, pos.z, 0.8) > 1.6 &&
      this.terrain.getHeight(pos.x, pos.z) > this.terrain.getHeight(ox, oz);
    if (g < -0.9 || tooSteep) {
      pos.x = ox; pos.z = oz;
      this.vel.multiplyScalar(0.4);
      this.knock.set(0, 0, 0);
    }
    // segue o chão: sobe e desce suave (degraus pequenos sem tranco)
    const gy = this.groundHeight(pos.x, pos.z);
    pos.y = damp(pos.y, gy, gy > pos.y ? 14 : 20, dt);
    this.root.rotation.y = this.facing + (this.spinAngle || 0);

    // ---- Blend Space 2D: velocidade local (frente × lado) → pesos ----
    const s = this.speed;
    const fwdX = Math.sin(this.facing), fwdZ = Math.cos(this.facing);
    const vf = this.vel.x * fwdX + this.vel.y * fwdZ;            // + frente / − trás
    const vl = this.vel.x * fwdZ - this.vel.y * fwdX;            // + esquerda / − direita
    const speedK = s <= P.walkSpeed ? s / P.walkSpeed : 1 + clamp((s - P.walkSpeed) / (P.runSpeed - P.walkSpeed), 0, 1);
    const moving = Math.min(1, speedK);                           // 0 parado … 1 andando
    const runK = Math.max(0, speedK - 1);                         // 0 andando … 1 correndo
    const lat = s > 0.05 ? Math.abs(vl) / (Math.abs(vf) + Math.abs(vl)) : 0;   // fração lateral
    const T = { idle: 1 - moving, steer: 0, bowHold: this.aimingBow && !this.mixamo ? 4 : 0 };
    if (this.mixamo) {
      const front = moving * (1 - lat), side = moving * lat, left = vl >= 0;
      T.walk = front * (1 - runK); T.run = front * runK;
      T[left ? 'strafeWalkL' : 'strafeWalkR'] = side * (1 - runK);
      T[left ? 'strafeL' : 'strafeR'] = side * runK;
      // girar parado: animação de virar no lugar
      if (s < 0.4 && Math.abs(turnRate) > 2) { T.idle = 0.2; T[turnRate > 0 ? 'turnL' : 'turnR'] = 0.8; }
      // andar de costas (mirando): mesmo ciclo, tocado ao contrário
      const back = vf < -0.3 ? -1 : 1;
      const rate = clamp(s / (runK > 0.5 ? P.runSpeed : P.walkSpeed), 0.6, 1.4) * back;
      for (const n of ['walk', 'run']) this.blend.setTimeScale(n, rate);
      for (const n of ['strafeL', 'strafeR', 'strafeWalkL', 'strafeWalkR']) this.blend.setTimeScale(n, Math.abs(rate));
    } else {
      T.walk = moving * (1 - runK); T.run = moving * runK;
      this.blend.setTimeScale('walk', clamp(s / P.walkSpeed, 0.6, 1.5));
      this.blend.setTimeScale('run', clamp(s / P.runSpeed, 0.75, 1.25));
    }
    // Pulo (Espaço): clipe Jump do Mixamo
    this.jumpT = Math.max(0, (this.jumpT || 0) - dt);
    if (firstStep && this.mixamo && this.input.justPressed(this.input.binds.jump) && !this.input.uiOpen && this.jumpT <= 0 && !this.aimingBow) {
      this.playAction('jump');
      this.jumpT = this.clips.jump.duration / 1.15;
    }
    this.blend.setTargets(T);
  }

  _updateOnBoat() {
    const rudder = this.boat ? Math.abs(this.boat.rudder) : 0;
    this.blend.setTargets({ steer: 1 });
    this.blend.setTimeScale('steer', 0.4 + rudder * 1.4);
  }
}
