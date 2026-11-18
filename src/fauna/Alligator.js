/**
 * Alligator.js
 * Jacaré restrito às margens do canal e do lago e às águas rasas
 * (altura do terreno entre -2.2 e +0.8 m).
 *  - Na água (fundo < -0.4 m): nada na superfície da onda, pernas recolhidas, cauda forte.
 *  - Na margem: rasteja com passada de lagarto.
 *  - Descansa (tomando sol) entre deslocamentos.
 */
import * as THREE from 'three/webgpu';
import { Animal } from './Animal.js';
import { oscRotTrack, makeClip } from '../utils/AnimUtils.js';
import { createScaleMaterial } from '../entities/CharacterMaterials.js';
import { damp, dampAngle } from '../utils/Noise.js';
// import { loadGLB } from '../core/AssetLoader.js';

export class Alligator extends Animal {
  constructor(ctx, rand, home) {
    super(ctx, rand);
    this.home.copy(home);
    this.root.position.set(home.x, 0, home.z);
    this._build();
    this.setupAnimation(this._clips(), 'rest');
    this.stateTimer = 2 + rand() * 5;
    this.initCombat(20, 0.9, 0.3);
    this.biteCd = 0;
    this.aggro = 0;
    // this.loadGLB('./assets/models/alligator.glb');
  }

  isValid(x, z) {
    const h = this.terrain.getHeight(x, z);
    return h > -2.2 && h < 0.8;
  }

  _build() {
    const skin = createScaleMaterial(0x3d4a2a);
    const belly = new THREE.MeshStandardNodeMaterial({ color: 0xb8b088, roughness: 0.8 });
    const body = this.pivot('body', this.root, 0, 0.22, 0);
    const torso = this.mesh(new THREE.BoxGeometry(0.75, 0.32, 1.7), skin, body);
    this.mesh(new THREE.BoxGeometry(0.65, 0.08, 1.6), belly, body, 0, -0.16, 0);
    // Placas dorsais
    for (let i = 0; i < 6; i++) this.mesh(new THREE.BoxGeometry(0.1, 0.08, 0.15), skin, body, (i % 2 ? 0.12 : -0.12), 0.18, -0.6 + i * 0.24);
    torso.castShadow = true;

    const head = this.pivot('head', body, 0, 0.02, 0.85);
    this.mesh(new THREE.BoxGeometry(0.5, 0.25, 0.45), skin, head, 0, 0, 0.2);
    this.mesh(new THREE.BoxGeometry(0.32, 0.14, 0.7), skin, head, 0, -0.04, 0.7);
    for (const sx of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardNodeMaterial({ color: 0xc8b030, emissive: 0x302800 }), head, sx * 0.15, 0.14, 0.3);

    // Cauda segmentada (3 pivôs encadeados)
    let parent = body, z = -0.85;
    for (let i = 1; i <= 3; i++) {
      const seg = this.pivot(`tail${i}`, parent, 0, 0, z);
      const w = 0.55 - i * 0.14, len = 0.7;
      this.mesh(new THREE.BoxGeometry(w, 0.22 - i * 0.04, len), skin, seg, 0, 0, -len / 2);
      parent = seg; z = -len;
    }

    for (const [n, x, zz] of [['FL', 0.38, 0.55], ['FR', -0.38, 0.55], ['BL', 0.38, -0.55], ['BR', -0.38, -0.55]]) {
      const leg = this.pivot(`leg${n}`, body, x, -0.05, zz);
      this.mesh(new THREE.BoxGeometry(0.12, 0.25, 0.14), skin, leg, Math.sign(x) * 0.08, -0.12, 0);
    }
    this.root.scale.setScalar(1.3);
  }

  _clips() {
    const crawl = makeClip('crawl', 1.1, [
      oscRotTrack('legFL', { y: [0, 0.6], z: [0.3, 0] }, 1.1),
      oscRotTrack('legBR', { y: [0, 0.6, 0.05], z: [-0.3, 0] }, 1.1),
      oscRotTrack('legFR', { y: [0, 0.6, 0.5], z: [-0.3, 0] }, 1.1),
      oscRotTrack('legBL', { y: [0, 0.6, 0.55], z: [0.3, 0] }, 1.1),
      oscRotTrack('body', { y: [0, 0.1] }, 1.1),
      oscRotTrack('tail1', { y: [0, 0.2, 0.2] }, 1.1),
      oscRotTrack('tail2', { y: [0, 0.25, 0.35] }, 1.1),
      oscRotTrack('tail3', { y: [0, 0.3, 0.5] }, 1.1),
    ]);
    const swim = makeClip('swim', 1.4, [
      oscRotTrack('legFL', { y: [-1.2, 0] }, 1.4), oscRotTrack('legFR', { y: [1.2, 0] }, 1.4),
      oscRotTrack('legBL', { y: [-1.3, 0] }, 1.4), oscRotTrack('legBR', { y: [1.3, 0] }, 1.4),
      oscRotTrack('tail1', { y: [0, 0.35] }, 1.4),
      oscRotTrack('tail2', { y: [0, 0.45, 0.15] }, 1.4),
      oscRotTrack('tail3', { y: [0, 0.55, 0.3] }, 1.4),
      oscRotTrack('body', { y: [0, 0.06, 0.5] }, 1.4),
    ]);
    const rest = makeClip('rest', 5, [
      oscRotTrack('head', { x: [-0.15, 0.08] }, 5),   // boca/cabeça erguida tomando sol
      oscRotTrack('tail3', { y: [0, 0.1] }, 5),
    ]);
    // Bote: cabeça avança e sobe
    this._bite = makeClip('bite', 0.5, [
      oscRotTrack('head', { x: [-0.3, 0.3] }, 0.5),
      oscRotTrack('body', { x: [-0.1, 0.1] }, 0.5),
    ]);
    return [crawl, swim, rest];
  }

  dropTable() {
    return [['raw_meat', 2 + Math.floor(Math.random() * 2)], ['leather', 1 + Math.floor(Math.random() * 3)]];
  }

  /** Atingido: fica agressivo por um tempo e persegue o jogador. */
  onHit() { this.aggro = 10; }

  /** Valid relaxado durante a perseguição: aceita também terra firme baixa. */
  _chaseValid(x, z) { const h = this.terrain.getHeight(x, z); return h > -2.5 && h < 3; }

  update(dt) {
    if (this.updateDeath(dt)) return;
    this.flash.update(dt);
    this.stateTimer -= dt;
    this.biteCd = Math.max(0, this.biteCd - dt);
    this.aggro = Math.max(0, this.aggro - dt);
    let moving = false;

    // ---- Mordida: o jogador a pé chegou perto demais ----
    const player = this.ctx.player;
    if (player && player.state === 'foot' && !player.stats?.dead) {
      const pp = player.position, p = this.root.position;
      const dx = pp.x - p.x, dz = pp.z - p.z, dist = Math.hypot(dx, dz);
      if (this.aggro > 0 && dist < 18) {
        // Persegue
        this.target.set(pp.x, 0, pp.z);
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 4, dt);
        if (dist > 1.6 && this._chaseValid(p.x + Math.sin(this.heading) * 1.5, p.z + Math.cos(this.heading) * 1.5)) {
          p.x += Math.sin(this.heading) * 3.2 * dt;
          p.z += Math.cos(this.heading) * 3.2 * dt;
          moving = true;
        }
        this.state = 'rest';
      }
      if (dist < 2.2 && this.biteCd <= 0) {
        this.biteCd = 1.4;
        this.blend.playOneShot(this._bite, { weight: 3 });
        player.takeDamage(2, new THREE.Vector3(dx, 0, dz).normalize(), 'jacaré');
      }
    }

    if (this.aggro > 0) {
      // já tratado acima
    } else if (this.state === 'move') {
      const r = this.steer(dt, this.inWater ? 1.8 : 1.1, 1.5, 2);
      moving = r === 'moving';
      if (r !== 'moving' || this.stateTimer <= 0) { this.state = 'rest'; this.stateTimer = 4 + this.rand() * 10; }
    } else if (this.stateTimer <= 0) {
      if (this.pickTarget(this.home, 40)) { this.state = 'move'; this.stateTimer = 15; }
      else this.stateTimer = 2;
    }

    const p = this.root.position;
    const ground = this.terrain.getHeight(p.x, p.z);
    this.inWater = ground < -0.4;
    // Na água flutua com a onda (só olhos e dorso de fora); em terra segue o chão
    const targetY = this.inWater ? this.ocean.getWaveHeight(p.x, p.z) - 0.32 : ground;
    p.y = damp(p.y, targetY, 6, dt);
    this.root.rotation.y = this.heading;

    if (this.inWater) this.blend.setTargets({ swim: 1 });
    else this.blend.setTargets(moving ? { crawl: 1 } : { rest: 1 });
    this.blend.setTimeScale('swim', moving ? 1 : 0.35);
    this.blend.update(dt, 2.5);
  }
}
