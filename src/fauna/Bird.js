/**
 * Bird.js
 * Pássaros com voo circular: cada um orbita um centro com raio, altura e
 * velocidade próprios, mais um ruído suave de altitude e raio. Inclina (bank)
 * nas curvas e alterna entre bater asas (subindo) e planar (descendo).
 */
import * as THREE from 'three/webgpu';
import { Animal } from './Animal.js';
import { events } from '../game/Events.js';
import { oscRotTrack, makeClip } from '../utils/AnimUtils.js';
// import { loadGLB } from '../core/AssetLoader.js';

export class Bird extends Animal {
  constructor(ctx, rand, center) {
    super(ctx, rand);
    this.center = center.clone();
    this.radius = 30 + rand() * 70;
    this.altitude = 45 + rand() * 80;
    this.angSpeed = (8 + rand() * 6) / this.radius * (rand() < 0.5 ? 1 : -1);
    this.angle = rand() * Math.PI * 2;
    this.phase = rand() * 100;
    this._prev = new THREE.Vector3();
    this._next = new THREE.Vector3();

    this._build(rand() < 0.5 ? 0xf2f2f2 : 0x3a3a40);
    this.setupAnimation(this._clips(), 'flap');
    this.initCombat(3, 0.7, 0);
    const kind = rand();
    const M = kind < 0.4 ? ['Parrot', 0.9] : kind < 0.7 ? ['Flamingo', 1.5] : ['Stork', 1.7];
    this.attachModel(`./assets/models/fauna/${M[0]}.glb`, { size: M[1], axis: 'x', center: true });
  }

  _build(colorHex) {
    const m = new THREE.MeshStandardNodeMaterial({ color: colorHex, roughness: 0.8 });
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x222222, roughness: 0.8 });
    const body = this.mesh(new THREE.SphereGeometry(0.25, 10, 8), m, this.root);
    body.scale.set(0.8, 0.7, 1.6);
    this.mesh(new THREE.SphereGeometry(0.15, 8, 6), m, this.root, 0, 0.08, 0.38);
    const beak = this.mesh(new THREE.ConeGeometry(0.05, 0.18, 6), new THREE.MeshStandardNodeMaterial({ color: 0xe8a13a }), this.root, 0, 0.07, 0.56);
    beak.rotation.x = Math.PI / 2;
    const tail = this.mesh(new THREE.BoxGeometry(0.3, 0.03, 0.3), dark, this.root, 0, 0, -0.45);
    tail.rotation.y = Math.PI / 4;
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const wing = this.pivot(`wing${side}`, this.root, sx * 0.15, 0.05, 0);
      const w1 = this.mesh(new THREE.BoxGeometry(0.6, 0.03, 0.4), m, wing, sx * 0.3, 0, 0);
      const tip = this.pivot(`tip${side}`, wing, sx * 0.6, 0, 0);
      this.mesh(new THREE.BoxGeometry(0.5, 0.025, 0.3), dark, tip, sx * 0.25, 0, -0.05);
      w1.castShadow = true;
    }
    this.root.scale.setScalar(1.6);
  }

  _clips() {
    const flap = makeClip('flap', 0.45, [
      oscRotTrack('wingL', { z: [0.1, 0.75] }, 0.45),
      oscRotTrack('wingR', { z: [-0.1, 0.75, 0.5] }, 0.45),
      oscRotTrack('tipL', { z: [0, 0.35, 0.15] }, 0.45),
      oscRotTrack('tipR', { z: [0, 0.35, 0.65] }, 0.45),
    ]);
    const glide = makeClip('glide', 2.5, [
      oscRotTrack('wingL', { z: [0.05, 0.05] }, 2.5),
      oscRotTrack('wingR', { z: [-0.05, 0.05, 0.5] }, 2.5),
    ]);
    return [flap, glide];
  }

  dropTable() { return [['feather', 1 + Math.floor(Math.random() * 2)], ['raw_meat', 1]]; }

  /** Morte do pássaro: cai em parafuso até o chão ou a água e então dropa. */
  die() {
    events.emit('kill', { target: 'bird' });
    this.alive = false;
    this.dying = true;
    this.fallV = 0;
    this.respawnT = 120;
    this.landed = false;
  }

  update(dt, t) {
    if (!this.alive) {
      const p = this.root.position;
      if (!this.landed) {
        this.fallV += 9.81 * dt;
        p.y -= this.fallV * dt;
        this.root.rotation.z += dt * 8;
        const floor = Math.max(this.terrain.getHeight(p.x, p.z), this.ocean.getWaveHeight(p.x, p.z));
        if (p.y <= floor + 0.2) {
          p.y = floor + 0.2;
          this.landed = true;
          for (const [id, n] of this.dropTable()) this.ctx.drops?.spawn(id, n, p.clone());
          this.root.visible = false;
        }
      }
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.alive = true; this.hp = this.maxHp; this.root.visible = true; this.root.rotation.set(0, 0, 0); }
      return;
    }
    this.flash.update(dt);
    this.angle += this.angSpeed * dt;
    const r = this.radius + Math.sin(t * 0.2 + this.phase) * 15;
    const y = this.altitude + Math.sin(t * 0.35 + this.phase) * 10;
    this._prev.copy(this.root.position);
    this.root.position.set(this.center.x + Math.cos(this.angle) * r, y, this.center.z + Math.sin(this.angle) * r);

    // Orienta pela tangente da trajetória e inclina para dentro da curva
    this._next.copy(this.root.position).multiplyScalar(2).sub(this._prev);
    this.root.lookAt(this._next);
    this.root.rotateZ(Math.sign(this.angSpeed) * -0.35);

    // Subindo: bate asas. Descendo: plana.
    const climbing = Math.cos(t * 0.35 + this.phase) > -0.2;
    if (this.model) { this.model.mixer.update(dt * (climbing ? 1 : 0.35)); return; }
    this.blend.setTargets(climbing ? { flap: 1 } : { glide: 1 });
    this.blend.update(dt, 3);
  }
}
