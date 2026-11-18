/**
 * Shark.js
 * Tubarão animado (assets/models/shark.glb — Babylon.js Assets, CC BY 4.0;
 * clipes "swimming", "circling", "bite") em 4 tamanhos.
 *
 * Máquina de estados:
 *   patrol  → nada em curvas suaves, fundo (só a sombra aparece)
 *   stalk   → sentiu a presa: aproxima-se em zigue-zague
 *   circle  → dá voltas em torno da presa com a barbatana fora d'água
 *   charge  → investida (mordida "bite"); acerta o jogador na água ou o casco do navio
 *   retreat → afasta-se e mergulha; depois volta a rondar
 *   flee    → foge (pouca vida, ou jogador com o Tridente das Marés)
 *   dead    → vira de barriga para cima e afunda
 * Nunca entra em água mais rasa que a sua profundidade mínima.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { events } from '../game/Events.js';

export const SHARK_KINDS = {
  reef:  { name: 'Tubarão-de-recife', len: 1.6, hp: 20, dmg: 6, hull: 0, speed: 4.5, burst: 8.5, minDepth: 0.75, aggro: 16, swimDepth: 0.9, drops: [['shark_meat', 1]] },
  tiger: { name: 'Tubarão-tigre', len: 3.5, hp: 60, dmg: 14, hull: 4, speed: 5, burst: 10, minDepth: 1.3, aggro: 24, swimDepth: 1.8, drops: [['shark_meat', 2], ['shark_tooth', 2]] },
  white: { name: 'Tubarão-branco', len: 6, hp: 150, dmg: 25, hull: 10, speed: 6, burst: 13, minDepth: 2.4, aggro: 45, swimDepth: 3, drops: [['shark_meat', 4], ['shark_tooth', 4], ['shark_fin', 1]] },
  king:  { name: 'Tubarão-Rei', len: 12, hp: 500, dmg: 40, hull: 30, speed: 7, burst: 15, minDepth: 5, aggro: 75, swimDepth: 6, drops: [['shark_meat', 8], ['shark_tooth', 10], ['shark_fin', 3], ['gold_coin', 60]] },
};

// ---------------------------------------------------------------------------
// Modelo (carregado uma vez; cada tubarão é um clone com esqueleto próprio)
// ---------------------------------------------------------------------------
let proto = null;
export function loadSharkModel() {
  proto ??= new GLTFLoader().loadAsync('./assets/models/shark.glb').then((gltf) => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    // eixo do corpo = maior dimensão horizontal; a cabeça diz qual ponta é a frente
    const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const alongX = size.x > size.z;
    let head = null; scene.traverse((o) => { if (/^Head/.test(o.name)) head = o; });
    const hp = head ? head.getWorldPosition(new THREE.Vector3()) : c.clone();
    const sign = Math.sign(alongX ? hp.x - c.x : hp.z - c.z) || 1;
    // gira para a frente ficar em +Z, centraliza e normaliza para 1 m de comprimento
    const yaw = alongX ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : (sign > 0 ? 0 : Math.PI);
    const len = alongX ? size.x : size.z;
    scene.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material) { o.material.side = THREE.FrontSide; o.material.roughness = 0.5; } }
    });
    return { scene, clips: gltf.animations, yaw, len, center: c, height: size.y };
  });
  return proto;
}

const _v = new THREE.Vector3();

export class Shark {
  constructor(mgr, kind, x, z) {
    this.mgr = mgr; this.ctx = mgr.ctx;
    this.kind = kind; this.def = SHARK_KINDS[kind];
    this.faction = 'shark';
    this.alive = true;
    this.hp = this.maxHp = Math.round(this.def.hp * (this.ctx.difficulty?.() ?? 1));
    this.pos = new THREE.Vector3(x, -2, z);
    this.waterY = 0;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = this.def.speed;
    this.state = 'patrol';
    this.t = 0; this.stateT = 0;
    this.depth = this.def.swimDepth;
    this.turn = 0;
    this.root = new THREE.Group();
    this.root.name = `shark_${kind}`;
    this.ready = false;
    this._sph = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0, r: this.def.len * 0.13 }));
    this.slowT = 0; this.stunT = 0;
    loadSharkModel().then((m) => this._build(m));
    mgr.scene.add(this.root);
    this.ctx.combat.register(this);
  }

  _build(m) {
    if (!this.alive && this.state === 'removed') return;
    const model = SkeletonUtils.clone(m.scene);
    const inner = new THREE.Group();
    inner.rotation.y = m.yaw;
    inner.add(model);
    model.position.set(-m.center.x, -m.center.y, -m.center.z);
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.scale.setScalar(this.def.len / m.len);
    this.root.add(wrap);
    this.body = wrap;
    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n) => m.clips.find((c) => c.name === n) || m.clips[0];
    this.act = { swim: this.mixer.clipAction(clip('swimming')), circle: this.mixer.clipAction(clip('circling')), bite: this.mixer.clipAction(clip('bite')) };
    this.act.swim.play();
    this.act.circle.play(); this.act.circle.weight = 0;
    this.act.bite.setLoop(THREE.LoopOnce, 1); this.act.bite.clampWhenFinished = false;
    this.mixer.update(Math.random() * 3);
    this.ready = true;
  }

  getHitSpheres() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), L = this.def.len;
    [-0.3, 0, 0.3].forEach((k, i) => { const s = this._sph[i]; s.x = this.pos.x + fx * L * k; s.z = this.pos.z + fz * L * k; s.y = this.pos.y; });
    return this._sph;
  }

  takeDamage(amount, dir, source, o = {}) {
    if (!this.alive) return;
    this.hp -= amount;
    this.ctx.effects?.burst('blood', this.pos.clone().setY(this.waterY + 0.2), 8, { speed: 2, up: 1.5, size: 0.18, life: 1.2, gravity: 0.3 });
    if (o.stun) this.stunT = Math.max(this.stunT, o.stun);
    if (this.hp <= 0) { this.die(); return; }
    // reação: pequenos fogem com pouca vida; os outros partem para cima
    if (this.kind === 'reef' && this.hp < this.maxHp * 0.5) this._set('flee');
    else if (this.state === 'patrol' || this.state === 'retreat') this._set('stalk');
  }

  die() {
    this.alive = false;
    this._set('dead');
    this.ctx.combat.unregister(this);
    events.emit('kill', { target: 'shark', size: this.kind, hostile: true });
    this.mgr.onKilled?.(this);
  }

  _set(s) { this.state = s; this.stateT = 0; }

  /** Água funda o bastante aqui? */
  _swimmable(x, z) {
    const g = this.ctx.terrain.getHeight(x, z);
    return g < -this.def.minDepth;
  }

  /** @param {object} s { player, boat, onBoat, trident, playerInWater } */
  update(dt, s) {
    this.t += dt; this.stateT += dt;
    if (!this.ready) return;
    const ocean = this.ctx.ocean;
    this.waterY = ocean.getWaveHeight(this.pos.x, this.pos.z);
    const k = this.def;

    if (this.state === 'dead') {
      this.root.rotation.z = Math.min(Math.PI, this.root.rotation.z + dt * 1.5);
      this.pos.y -= dt * (this.stateT > 2 ? 0.8 : 0);
      this.pos.y = Math.min(this.pos.y, this.waterY - 0.2);
      this.root.position.copy(this.pos);
      this.mixer.timeScale = 0.1;
      this.mixer.update(dt);
      if (this.stateT > 8) this.mgr.remove(this);
      return;
    }
    if (this.stunT > 0) { this.stunT -= dt; this.mixer.update(dt * 0.2); this.root.position.copy(this.pos); return; }
    const slow = this.slowT > 0 ? 0.45 : 1; this.slowT = Math.max(0, this.slowT - dt);

    // ---- presa ----
    const p = s.pp;
    let prey = null, preyPos = null;
    if (s.onBoat && k.hull > 0) { prey = 'boat'; preyPos = s.boat.root.position; }
    else if (!s.onBoat && s.playerInWater && !s.player.stats?.dead) { prey = 'player'; preyPos = p; }
    const dPrey = preyPos ? Math.hypot(preyPos.x - this.pos.x, preyPos.z - this.pos.z) : Infinity;
    if (s.trident && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 30 && this.state !== 'flee') this._set('flee');

    let desired = this.heading, spd = k.speed, wantDepth = k.swimDepth + 1.5, circleW = 0;
    switch (this.state) {
      case 'patrol':
        this.turn += (Math.random() - 0.5) * dt * 0.8;
        this.turn *= 0.98;
        desired = this.heading + this.turn;
        if (prey && dPrey < k.aggro) this._set('stalk');
        break;
      case 'stalk':
        if (!prey || dPrey > k.aggro * 1.8) { this._set('patrol'); break; }
        desired = Math.atan2(preyPos.x - this.pos.x, preyPos.z - this.pos.z) + Math.sin(this.t * 1.3) * 0.5;
        spd = k.speed * 1.2; wantDepth = k.swimDepth;
        if (dPrey < Math.max(6, k.len * 1.6)) { this._set('circle'); this.circleDir = Math.random() < 0.5 ? 1 : -1; this.circleTime = 2 + Math.random() * 3; }
        break;
      case 'circle': {
        if (!prey) { this._set('patrol'); break; }
        const R = Math.max(5, k.len * 1.4) + (prey === 'boat' ? 8 : 0);
        const ang = Math.atan2(this.pos.x - preyPos.x, this.pos.z - preyPos.z);
        // ponto à frente no círculo
        const ta = ang + this.circleDir * 0.5;
        desired = Math.atan2(preyPos.x + Math.sin(ta) * R - this.pos.x, preyPos.z + Math.cos(ta) * R - this.pos.z);
        spd = k.speed * 1.1; wantDepth = 0; circleW = 1;   // barbatana fora d'água
        if (this.stateT > this.circleTime) this._set('charge');
        if (dPrey > k.aggro * 1.8) this._set('patrol');
        break;
      }
      case 'charge':
        if (!prey) { this._set('retreat'); break; }
        desired = Math.atan2(preyPos.x - this.pos.x, preyPos.z - this.pos.z);
        spd = k.burst; wantDepth = 0.3;
        if (!this._bit && dPrey < k.len * 0.45 + (prey === 'boat' ? 4 : 1.1)) {
          this._bit = true;
          this.act.bite.reset().play();
          const dir = _v.set(preyPos.x - this.pos.x, 0, preyPos.z - this.pos.z).normalize().clone();
          if (prey === 'player') s.player.takeDamage(k.dmg * (this.ctx.difficulty?.() ?? 1), dir, 'tubarão');
          else { s.boat.takeDamage(k.hull, dir); this.ctx.shake?.(k.len > 8 ? 1 : 0.5); }
          this.ctx.effects?.splash(new THREE.Vector3(this.pos.x, this.waterY, this.pos.z), true);
          this.mgr.sfx?.sharkBite?.(this.pos);
          this._set('retreat');
        }
        if (this.stateT > 4) this._set('retreat');
        break;
      case 'retreat':
        this._bit = false;
        desired = preyPos ? Math.atan2(this.pos.x - preyPos.x, this.pos.z - preyPos.z) : this.heading;
        spd = k.speed * 1.3; wantDepth = k.swimDepth + 1;
        if (this.stateT > 3 + Math.random()) this._set(prey && dPrey < k.aggro ? 'stalk' : 'patrol');
        break;
      case 'flee':
        desired = Math.atan2(this.pos.x - p.x, this.pos.z - p.z);
        spd = k.burst; wantDepth = k.swimDepth + 2;
        if (this.stateT > 6) this._set('patrol');
        break;
    }

    // ---- água rasa à frente: desvia para o lado mais fundo ----
    const look = Math.max(4, k.len * 1.2);
    const ahead = (h) => this._swimmable(this.pos.x + Math.sin(h) * look, this.pos.z + Math.cos(h) * look);
    if (!ahead(desired)) {
      let found = false;
      for (const off of [0.6, -0.6, 1.2, -1.2, 2, -2, Math.PI]) if (ahead(desired + off)) { desired += off; found = true; break; }
      if (!found) desired = this.heading + Math.PI;
      if (this.state === 'charge' && prey === 'player') this._set('retreat');
    }

    // ---- movimento ----
    let dh = Math.atan2(Math.sin(desired - this.heading), Math.cos(desired - this.heading));
    const turnRate = (this.state === 'charge' ? 2.2 : 1.4) * (6 / (k.len + 2)) + 0.6;
    dh = THREE.MathUtils.clamp(dh, -turnRate * dt, turnRate * dt);
    this.heading += dh;
    this.speed += (spd * slow - this.speed) * Math.min(1, dt * 2);
    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt, nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
    if (this._swimmable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    else this.heading += Math.PI * dt;
    // profundidade: limitada pelo fundo
    const floor = this.ctx.terrain.getHeight(this.pos.x, this.pos.z) + k.len * 0.12 + 0.2;
    const finTop = k.len * 0.16;                                     // altura da barbatana acima do centro
    const targetY = Math.max(floor, this.waterY - (wantDepth > 0 ? wantDepth : finTop * 0.55));
    this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 1.5);
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.heading, -dh / Math.max(dt, 1e-3) * 0.08);
    // ---- animação ----
    this.act.circle.weight += (circleW - this.act.circle.weight) * Math.min(1, dt * 2);
    this.act.swim.weight = 1 - this.act.circle.weight;
    this.mixer.timeScale = THREE.MathUtils.clamp(this.speed / k.speed, 0.6, 2.2) * slow;
    if (s.near) this.mixer.update(dt);
    // esteira na superfície quando a barbatana corta a água
    if (s.near && wantDepth <= 0.3 && Math.random() < dt * 8) this.ctx.effects?.burst('splash', new THREE.Vector3(this.pos.x, this.waterY, this.pos.z), 1, { speed: 0.6, up: 0.6, size: 0.12, life: 0.6 });
  }

  dispose() {
    this.state = 'removed';
    this.alive = false;
    this.ctx.combat.unregister(this);
    this.root.removeFromParent();
  }
}
