/**
 * Cannons.js
 * Baterias de canhões montadas no convés (N por bordo).
 *  - Bombordo (esquerda) = +X local do navio; boreste (direita) = -X local.
 *  - fire(side, elevation) dispara a bateria do bordo, com tiros escalonados,
 *    fumaça, recuo do cano e herança da velocidade do navio.
 *  - Recarga independente por bordo.
 *  - trajectory() gera pontos para a linha de prévia de mira.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';

const SC = CONFIG.shipCombat;
const DECK_Y = 1.9;

export class Cannons {
  /**
   * @param {import('./Boat.js').Boat} boat
   * @param {object} o { projectiles, effects, perSide, ammo: () => boolean (consome 1 bala) }
   */
  constructor(boat, { projectiles, effects, perSide = 4, ammo = () => true, damage = SC.cannonDamage, reload = SC.reload }) {
    this.boat = boat;
    this.projectiles = projectiles;
    this.fx = effects;
    this.ammo = ammo;
    this.damage = damage;
    this.reloadTime = reload;
    this.reload = { port: 0, star: 0 };
    this.queue = [];
    this.guns = { port: [], star: [] };

    const iron = new THREE.MeshStandardNodeMaterial({ color: 0x24252a, metalness: 0.7, roughness: 0.4 });
    const wood = new THREE.MeshStandardNodeMaterial({ color: 0x4a2f1c, roughness: 0.9 });
    const zs = perSide === 4 ? [-2.8, -0.6, 2.6, 4.6] : [-2, 2.2, 4.4];
    for (const [side, sx] of [['port', 1], ['star', -1]]) {
      for (const z of zs) {
        const g = new THREE.Group();
        g.position.set(sx * 2.05, DECK_Y + 0.3, z);
        g.rotation.y = sx * Math.PI / 2;            // +Z local do canhão aponta para fora do bordo
        const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.9), wood);
        carriage.position.y = -0.1;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 1.4, 10), iron);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.15, 0.35);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 12), iron);
        ring.position.set(0, 0.15, 1.02);
        const bar = new THREE.Group();
        bar.add(barrel, ring);
        g.add(carriage, bar);
        g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        boat.stages[2].add(g);
        this.guns[side].push({ group: g, barrel: bar, recoil: 0 });
      }
    }
    boat.cannons = this;
    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  /** Vetor unitário (mundo, horizontal) apontando para fora do bordo. */
  sideVector(side, out = new THREE.Vector3()) {
    const h = this.boat.heading, sx = side === 'port' ? 1 : -1;
    return out.set(Math.cos(h) * sx, 0, -Math.sin(h) * sx);
  }

  /** Qual bordo está mais alinhado com a direção dada? */
  sideFacing(dir) {
    return this.sideVector('port', this._v).dot(dir) >= 0 ? 'port' : 'star';
  }

  /** Direção de disparo (mundo) para o bordo e a elevação dados. */
  shotDirection(side, elevation, out = new THREE.Vector3()) {
    this.sideVector(side, out);
    out.multiplyScalar(Math.cos(elevation));
    out.y = Math.sin(elevation);
    return out;
  }

  /** Posição de mundo da boca do canhão central do bordo. */
  muzzle(side, i, out = new THREE.Vector3()) {
    const gun = this.guns[side][i];
    return gun.group.localToWorld(out.set(0, 0.15, 1.15));
  }

  ready(side) { return this.reload[side] <= 0; }

  /**
   * Dispara a bateria.
   * @returns {number} quantidade de canhões disparados
   */
  fire(side, elevation) {
    if (!this.ready(side) || !this.boat.alive) return 0;
    let shots = 0;
    this.guns[side].forEach((gun, i) => {
      if (!this.ammo()) return;
      shots++;
      this.queue.push({ side, i, t: i * 0.14 + Math.random() * 0.05, elevation });
    });
    if (shots) this.reload[side] = this.reloadTime;
    return shots;
  }

  _shoot(side, i, elevation) {
    const gun = this.guns[side][i];
    const pos = this.muzzle(side, i, new THREE.Vector3());
    const dir = this.shotDirection(side, elevation + (Math.random() - 0.5) * 0.03, this._d);
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.05);
    const vel = dir.clone().multiplyScalar(SC.muzzleSpeed).add(this.boat.velocity);
    this.projectiles.cannonball(pos, vel, this.damage, this.boat.faction);
    this.fx.smoke(pos, 12);
    this.fx.fire(pos, 5);
    gun.recoil = 1;
    this.onShot?.(pos);
  }

  /** Pontos da trajetória (para a linha de mira). */
  trajectory(side, elevation, n = 40, out = []) {
    const p = this.muzzle(side, 1, new THREE.Vector3());
    const v = this.shotDirection(side, elevation, new THREE.Vector3()).multiplyScalar(SC.muzzleSpeed).add(this.boat.velocity);
    out.length = 0;
    const dt = 0.12;
    for (let k = 0; k < n; k++) {
      out.push(p.clone());
      v.y -= 9.81 * dt;
      p.addScaledVector(v, dt);
      if (p.y < -1) { out.push(p.clone()); break; }
    }
    return out;
  }

  update(dt) {
    this.reload.port = Math.max(0, this.reload.port - dt);
    this.reload.star = Math.max(0, this.reload.star - dt);
    for (let k = this.queue.length - 1; k >= 0; k--) {
      const q = this.queue[k];
      q.t -= dt;
      if (q.t <= 0) { this._shoot(q.side, q.i, q.elevation); this.queue.splice(k, 1); }
    }
    for (const side of ['port', 'star']) {
      for (const g of this.guns[side]) {
        if (g.recoil > 0) {
          g.recoil = Math.max(0, g.recoil - dt * 2);
          g.barrel.position.z = -g.recoil * 0.45;
        }
      }
    }
  }
}
