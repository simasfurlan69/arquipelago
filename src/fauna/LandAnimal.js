/**
 * LandAnimal.js
 * Quadrúpedes terrestres (cervo e cavalo). Vagam proceduralmente pela ilha
 * principal alternando entre "walk" e "idle" (pastando):
 *  - destinos só em terra firme (h > 1.5 m) e com declive suave;
 *  - um look-ahead evita encostas íngremes e a borda da água no caminho;
 *  - crossfade suave entre as animações pelo BlendSpace.
 */
import * as THREE from 'three/webgpu';
import { Animal } from './Animal.js';
import { oscRotTrack, oscPosTrack, makeClip } from '../utils/AnimUtils.js';
import { createHideMaterial } from '../entities/CharacterMaterials.js';
import { damp } from '../utils/Noise.js';
// import { loadGLB } from '../core/AssetLoader.js';

const SPECIES = {
  deer: { color: 0x9a6a3e, belly: 0xd9c3a0, scale: 1.0, legLen: 0.75, bodyLen: 1.2, speed: 1.7, antlers: true, mane: false },
  horse: { color: 0x4a2e1c, belly: 0x3a2416, scale: 1.35, legLen: 0.85, bodyLen: 1.5, speed: 2.1, antlers: false, mane: true,
    model: { url: './assets/models/fauna/Horse.glb', size: 2.3, axis: 'z' } },
  fox: { color: 0xc06a2a, belly: 0xf0e0c8, scale: 0.55, legLen: 0.6, bodyLen: 1.0, speed: 2.6, antlers: false, mane: false,
    model: { url: './assets/models/fauna/Fox.glb', size: 1.0, axis: 'z' } },
};

export class LandAnimal extends Animal {
  constructor(ctx, rand, species, home) {
    super(ctx, rand);
    this.sp = SPECIES[species];
    this.species = species;
    this.home.copy(home);
    this.root.position.set(home.x, ctx.terrain.getHeight(home.x, home.z), home.z);
    this._build();
    this.setupAnimation(this._clips(), 'idle');
    this.stateTimer = 1 + rand() * 4;
    this.initCombat(species === 'horse' ? 15 : species === 'fox' ? 6 : 10, 0.75, this.sp.legLen + 0.15);
    if (this.sp.model) this.attachModel(this.sp.model.url, this.sp.model);
  }

  _build() {
    const s = this.sp;
    const hide = createHideMaterial(s.color, 1.2);
    const belly = createHideMaterial(s.belly, 0.8);
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1a1410, roughness: 0.8 });
    const L = s.legLen, BL = s.bodyLen;

    const body = this.pivot('body', this.root, 0, L + 0.1, 0);
    const torso = this.mesh(new THREE.CapsuleGeometry(0.28, BL, 4, 10), hide, body);
    torso.rotation.x = Math.PI / 2;
    const under = this.mesh(new THREE.CapsuleGeometry(0.22, BL * 0.8, 4, 8), belly, body, 0, -0.1, 0);
    under.rotation.x = Math.PI / 2;

    // Pescoço e cabeça
    const neck = this.pivot('neck', body, 0, 0.15, BL / 2 + 0.1);
    const nm = this.mesh(new THREE.CylinderGeometry(0.11, 0.17, 0.7, 8), hide, neck, 0, 0.3, 0.1);
    nm.rotation.x = 0.5;
    const head = this.pivot('head', neck, 0, 0.62, 0.3);
    const hm = this.mesh(new THREE.BoxGeometry(0.18, 0.2, 0.45), hide, head, 0, 0, 0.15);
    hm.rotation.x = 0.3;
    for (const sx of [-1, 1]) {
      const ear = this.mesh(new THREE.ConeGeometry(0.05, 0.16, 5), hide, head, sx * 0.08, 0.15, -0.02);
      ear.rotation.z = -sx * 0.4;
      this.mesh(new THREE.SphereGeometry(0.025, 6, 4), dark, head, sx * 0.09, 0.05, 0.12);
      if (s.antlers) {
        const ant = this.mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.4, 4), new THREE.MeshStandardNodeMaterial({ color: 0xcdb48a }), head, sx * 0.06, 0.3, 0);
        ant.rotation.z = -sx * 0.35;
        for (let k = 0; k < 3; k++) {
          const tine = this.mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.16 - k * 0.02, 4), ant.material, head, sx * (0.09 + k * 0.035), 0.25 + k * 0.08, 0.04 - k * 0.03);
          tine.rotation.set(0.6 - k * 0.2, 0, -sx * (0.2 + k * 0.25));
        }
      }
    }
    if (s.mane) {
      const mane = this.mesh(new THREE.BoxGeometry(0.05, 0.6, 0.15), dark, neck, 0, 0.4, -0.02);
      mane.rotation.x = 0.5;
    }

    // Pernas (pivô no ombro/quadril)
    const legs = [['FL', 0.16, BL / 2], ['FR', -0.16, BL / 2], ['BL', 0.16, -BL / 2], ['BR', -0.16, -BL / 2]];
    for (const [n, x, z] of legs) {
      const leg = this.pivot(`leg${n}`, body, x, -0.1, z);
      this.mesh(new THREE.CylinderGeometry(0.05, 0.04, L, 6), hide, leg, 0, -L / 2, 0);
      this.mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 6), dark, leg, 0, -L + 0.04, 0);
    }
    const tail = this.pivot('tail', body, 0, 0.1, -BL / 2 - 0.2);
    const tm = this.mesh(new THREE.CylinderGeometry(0.03, s.mane ? 0.08 : 0.05, s.mane ? 0.6 : 0.2, 6), s.mane ? dark : belly, tail, 0, -0.2, -0.05);
    tm.rotation.x = 0.3;

    this.root.scale.setScalar(s.scale);
  }

  _clips() {
    const BY = this.sp.legLen + 0.1;
    const walk = makeClip('walk', 1.0, [
      oscRotTrack('legFL', { x: [0, 0.45] }, 1),
      oscRotTrack('legBR', { x: [0, 0.45, 0.1] }, 1),
      oscRotTrack('legFR', { x: [0, 0.45, 0.5] }, 1),
      oscRotTrack('legBL', { x: [0, 0.45, 0.6] }, 1),
      oscRotTrack('neck', { x: [0, 0.06] }, 1, 16, 2),
      oscRotTrack('tail', { y: [0, 0.2] }, 1),
      oscPosTrack('body', [0, BY, 0], [0, 0.03, 0], 1, 16, 2),
    ]);
    // Pastando: pescoço abaixa até o chão, cauda balança
    const idle = makeClip('idle', 4, [
      oscRotTrack('neck', { x: [0.95, 0.12] }, 4),
      oscRotTrack('head', { x: [0.3, 0.1, 0.3] }, 4, 16, 3),
      oscRotTrack('tail', { y: [0, 0.4] }, 4, 16, 3),
      oscRotTrack('legFL', { x: [0, 0] }, 4),
      oscRotTrack('legFR', { x: [0, 0] }, 4),
      oscRotTrack('legBL', { x: [0, 0] }, 4),
      oscRotTrack('legBR', { x: [0, 0] }, 4),
      oscPosTrack('body', [0, BY, 0], [0, 0.01, 0], 4, 16, 1),
    ]);
    return [walk, idle];
  }

  dropTable() {
    if (this.species === 'fox') return [['raw_meat', 1], ['leather', 1]];
    const meat = this.species === 'horse' ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 3);
    return [['raw_meat', meat], ['leather', 1 + Math.floor(Math.random() * 2)]];
  }

  /** Ao ser atingido: foge correndo na direção do golpe. */
  onHit(dir) {
    const p = this.root.position;
    const d = dir ? Math.atan2(dir.x, dir.z) : this.rand() * Math.PI * 2;
    for (let i = 0; i < 8; i++) {
      const a = d + (this.rand() - 0.5) * 1.2;
      const x = p.x + Math.sin(a) * 40, z = p.z + Math.cos(a) * 40;
      if (this.isValid(x, z)) { this.target.set(x, 0, z); break; }
    }
    this.heading = d;
    this.state = 'flee';
    this.stateTimer = 6;
  }

  update(dt) {
    if (this.updateDeath(dt)) return;
    this.flash.update(dt);
    this.stateTimer -= dt;
    let moving = false;

    if (this.state === 'flee') {
      const r = this.steer(dt, this.sp.speed * 2.6, 5, 3.5);
      moving = r === 'moving';
      if (r === 'blocked') this.onHit(null);
      if (r === 'arrived' || this.stateTimer <= 0) { this.state = 'idle'; this.stateTimer = 2; }
      this.blend.setTimeScale('walk', 2.4);
    } else if (this.state === 'walk') {
      this.blend.setTimeScale('walk', 1);
      const r = this.steer(dt, this.sp.speed, 2, 3.5);
      moving = r === 'moving';
      if (r !== 'moving' || this.stateTimer <= 0) {
        this.state = 'idle';
        this.stateTimer = 3 + this.rand() * 7;
        if (r === 'blocked') this.heading += Math.PI * (0.6 + this.rand() * 0.8);   // dá meia-volta
      }
    } else if (this.stateTimer <= 0) {
      if (this.pickTarget(this.home, 70)) {
        this.state = 'walk';
        this.stateTimer = 8 + this.rand() * 10;
      } else this.stateTimer = 2;
    }

    const p = this.root.position;
    p.y = damp(p.y, this.terrain.getHeight(p.x, p.z), 10, dt);
    this.root.rotation.y = this.heading;

    if (this.model) {
      // modelo animado: velocidade da animação acompanha o passo
      const fleeing = this.state === 'flee';
      if (this.species === 'fox') {
        this.modelWeights(moving ? (fleeing ? { Run: 1 } : { Walk: 1 }) : { Survey: 1 }, dt);
        this.model.mixer.update(dt);
      } else this.model.mixer.update(dt * (moving ? (fleeing ? 1.3 : 0.55) : 0));
      return;
    }
    this.blend.setTargets(moving ? { walk: 1 } : { idle: 1 });
    this.blend.update(dt, 3);
  }
}
