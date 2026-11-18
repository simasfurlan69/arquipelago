/**
 * Zombie.js
 * Morto-vivo terrestre: surge à noite, persegue o jogador e ataca corpo a corpo.
 * Visual: rig humanoide com pele SSS pálida e esverdeada (pouco sangue), roupas
 * rasgadas e sujas, olhos brilhando. Queima e se desfaz ao amanhecer.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { BlendSpace } from '../utils/AnimUtils.js';
import { damp, dampAngle } from '../utils/Noise.js';
import { HitFlash } from '../game/Combat.js';
import { events } from '../game/Events.js';
import { buildHumanoid, createZombieClips, createActionClips } from '../entities/HumanoidRig.js';
import { createSkinMaterial, createClothMaterial } from '../entities/CharacterMaterials.js';
// import { loadGLB } from '../core/AssetLoader.js';

const E = CONFIG.enemies;

export class Zombie {
  constructor(scene, ctx, pos, rand = Math.random) {
    this.scene = scene;
    this.ctx = ctx;
    this.faction = 'undead';
    this.alive = true;
    this.removed = false;
    this.hp = E.zombieHealth;
    this.heading = rand() * Math.PI * 2;
    this.attackCd = 0;
    this.burning = 0;
    this.knock = new THREE.Vector3();
    this.wanderT = 0;

    const tones = [0x8a9a78, 0x7d8f72, 0x96a084];
    const mats = {
      skin: createSkinMaterial({ tone: tones[Math.floor(rand() * 3)], blood: [0.35, 0.45, 0.25], scale: 2, soot: 0.5 }),
      shirt: createClothMaterial([0x4a4a3a, 0x3a3f4a, 0x5a3a30][Math.floor(rand() * 3)], { soot: 0.8 }),
      pants: createClothMaterial(0x2f3340, { soot: 0.7 }),
      boots: createClothMaterial(0x1c1712),
    };
    const { root, nodes } = buildHumanoid(mats, { bulk: 1.05, hair: 0x2a2a22 });
    this.root = root;
    this.nodes = nodes;
    // Olhos vermelhos brilhantes
    const eyeMat = new THREE.MeshStandardNodeMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 3 });
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), eyeMat);
      e.position.set(sx * 0.04, 0.13, 0.11);
      nodes.head.add(e);
    }
    root.position.copy(pos);
    root.scale.setScalar(0.95 + rand() * 0.15);
    scene.add(root);
    this.flash = new HitFlash(root);

    const clips = createZombieClips();
    this.attackClip = clips.attack;
    this.hurtClip = createActionClips().hurt;
    this.mixer = new THREE.AnimationMixer(root);
    this.blend = new BlendSpace(this.mixer, [clips.walk, clips.idle]);
    this.blend.setTargets({ zidle: 1 });
    this._sph = [{ x: 0, y: 0, z: 0, r: 0.5 }, { x: 0, y: 0, z: 0, r: 0.4 }];
    ctx.combat.register(this);
    // this.loadGLB('./assets/models/zombie.glb');
  }

  getHitSpheres() {
    const p = this.root.position;
    this._sph[0].x = p.x; this._sph[0].y = p.y + 1.25; this._sph[0].z = p.z;
    this._sph[1].x = p.x; this._sph[1].y = p.y + 0.5; this._sph[1].z = p.z;
    return this._sph;
  }

  takeDamage(amount, dir) {
    if (!this.alive) return;
    this.hp -= amount;
    this.flash.trigger();
    this.blend.playOneShot(this.hurtClip, { weight: 2 });
    if (dir) this.knock.set(dir.x, 0, dir.z).normalize().multiplyScalar(7);
    const p = this.root.position;
    this.ctx.effects.blood(new THREE.Vector3(p.x, p.y + 1.2, p.z));
    if (this.hp <= 0) this.die();
  }

  die() {
    if (!this._burnedOut) events.emit('kill', { target: 'zombie', hostile: true });
    this.alive = false;
    this.deathT = 0;
    this.ctx.combat.unregister(this);
    const p = this.root.position.clone().setY(this.root.position.y + 0.6);
    const bones = Math.floor(Math.random() * 3);
    if (bones) this.ctx.drops.spawn('bone', bones, p);
    if (Math.random() < 0.12) this.ctx.drops.spawn('iron_ore', 1, p);
    if (Math.random() < 0.08) this.ctx.drops.spawn('gold_coin', 1, p);
  }

  /** Amanhecer: pega fogo e se desfaz. */
  burn() { if (this.alive) this.burning = 2.2; }

  update(dt, player) {
    if (!this.alive) {
      // Tomba e afunda no chão
      this.deathT += dt;
      this.root.rotation.x = Math.min(Math.PI / 2, this.deathT * 4) * -1;
      if (this.deathT > 1) this.root.position.y -= dt * 0.8;
      if (this.deathT > 2.5) this.remove();
      this.flash.update(dt);
      this.mixer.update(dt * 0.3);
      return;
    }

    const p = this.root.position;
    const t = this.ctx.terrain;
    this.attackCd = Math.max(0, this.attackCd - dt);

    // ---- Queimando ao sol ----
    if (this.burning > 0) {
      this.burning -= dt;
      if (Math.random() < 0.5) this.ctx.effects.fire(new THREE.Vector3(p.x, p.y + 1 + Math.random(), p.z), 1);
      if (this.burning <= 0) { this.hp = 0; this._burnedOut = true; this.die(); }
    }

    // ---- IA: persegue o jogador a pé ----
    let moving = false;
    const pp = player.position;
    const dx = pp.x - p.x, dz = pp.z - p.z;
    const dist = Math.hypot(dx, dz);
    const canChase = player.state === 'foot' && !player.stats?.dead && dist < E.zombieSight;

    let targetHeading = this.heading, speed = 0;
    if (canChase) {
      targetHeading = Math.atan2(dx, dz);
      if (dist > 1.3) { speed = E.zombieSpeed; moving = true; }
      if (dist < 1.8 && this.attackCd <= 0) {
        this.attackCd = 1.5;
        this.blend.playOneShot(this.attackClip, { weight: 3 });
        player.takeDamage(E.zombieDamage, new THREE.Vector3(dx, 0, dz).normalize(), 'zumbi');
      }
    } else {
      // Vaga sem rumo
      this.wanderT -= dt;
      if (this.wanderT <= 0) { this.wanderT = 3 + Math.random() * 4; this.wanderHeading = this.heading + (Math.random() - 0.5) * 2; this.wanderMove = Math.random() < 0.6; }
      targetHeading = this.wanderHeading ?? this.heading;
      if (this.wanderMove) { speed = E.zombieSpeed * 0.4; moving = true; }
    }
    this.heading = dampAngle(this.heading, targetHeading, 3.5, dt);
    // acelera e freia com suavidade (sem arrancar/parar de uma vez)
    this.curSpeed = damp(this.curSpeed || 0, speed, speed > (this.curSpeed || 0) ? 3 : 6, dt);

    const ox = p.x, oz = p.z;
    p.x += Math.sin(this.heading) * this.curSpeed * dt + this.knock.x * dt;
    p.z += Math.cos(this.heading) * this.curSpeed * dt + this.knock.z * dt;
    this.knock.multiplyScalar(Math.exp(-7 * dt));
    this.ctx.colliders.resolve(p, 0.4);
    // Não entra na água funda nem sobe paredões
    if (t.getHeight(p.x, p.z) < -0.6 || t.getSlope(p.x, p.z) > 1.4) { p.x = ox; p.z = oz; this.wanderHeading = this.heading + Math.PI; }
    const ground = Math.max(t.getHeight(p.x, p.z), this.ctx.colliders.platformHeight(p.x, p.z));
    p.y = damp(p.y, ground, 15, dt);
    this.root.rotation.y = this.heading;

    this.blend.setTargets(moving ? { zwalk: 1 } : { zidle: 1 });
    this.blend.setTimeScale('zwalk', Math.max(0.5, this.curSpeed / 1.8));
    this.flash.update(dt);
    this.blend.update(dt, 4);
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.alive = false;
    this.ctx.combat.unregister(this);
    this.root.removeFromParent();
  }
}
