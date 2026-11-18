/**
 * GhostShip.js
 * Navio fantasma tripulado por mortos-vivos. Aparece no mar à noite e caça o
 * navio do jogador:
 *  - longe (> 120 m): navega direto para o alvo com vela cheia;
 *  - perto demais (< 45 m): abre distância;
 *  - na faixa de combate: manobra para ficar de lado (bordo apontado para o
 *    alvo) e dispara quando alinhado, com elevação balística calculada;
 *  - evita águas rasas com uma sonda à frente;
 *  - ao afundar, deixa saque boiando (ouro, lingotes, balas).
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { Boat } from '../entities/Boat.js';
import { events } from '../game/Events.js';
import { Cannons } from '../entities/Cannons.js';
import { angleDelta, clamp } from '../utils/Noise.js';

const E = CONFIG.enemies;
const SC = CONFIG.shipCombat;

export class GhostShip {
  constructor(scene, ctx, x, z, heading, variant = 'ghost') {
    this.ctx = ctx;
    this.removed = false;
    this.variant = variant;
    this.boat = new Boat(scene, ctx.terrain, ctx.ocean, { variant });
    this.boat.setBuildProgress(1);
    this.boat.placeAt(x, z, heading);
    this.boat.hullMax = this.boat.hull = E.ghostShipHealth;
    this.boat.setSail(2);
    this.cannons = new Cannons(this.boat, {
      projectiles: ctx.projectiles, effects: ctx.effects, perSide: 3,
      damage: SC.cannonDamage * 0.8, reload: SC.reload * 1.6,
    });
    this.cannons.onShot = (p) => ctx.onCannon?.(p);
    ctx.combat.register(this.boat);
    this.boat.onSunk = () => this._sunk();
    this.thinkT = 0;
    this.desired = heading;
    this._toTarget = new THREE.Vector3();
  }

  get alive() { return this.boat.alive && !this.boat.sinking; }

  /** Some ao amanhecer (afunda devagar, sem saque). */
  dissolve() { this.noLoot = true; this.boat.startSinking(); }

  _sunk() {
    if (!this.noLoot) events.emit('sink', { target: this.variant === 'pirate' ? 'pirate' : 'ghost' });
    const p = this.boat.root.position.clone();
    p.y = 0.5;
    if (!this.noLoot) {
      this.ctx.drops.spawn('gold_coin', 2 + Math.floor(Math.random() * 3), p);
      this.ctx.drops.spawn('metal_bar', 2 + Math.floor(Math.random() * 2), p);
      this.ctx.drops.spawn('cannonball', 4 + Math.floor(Math.random() * 5), p);
      this.ctx.hud?.toast(this.variant === 'pirate' ? 'Navio pirata afundado! Recolha o saque.' : 'Navio fantasma afundado! Recolha o saque boiando.', 3);
      this.ctx.onShipSunk?.(this);
    }
    this.remove();
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.ctx.combat.unregister(this.boat);
    this.boat.root.removeFromParent();
  }

  /**
   * @param {number} dt
   * @param {import('../entities/Boat.js').Boat|null} prey navio do jogador
   */
  update(dt, prey) {
    const b = this.boat;
    if (this.removed) return;
    if (b.sinking || !prey || !prey.alive) {
      b.update(dt, null);
      return;
    }

    const p = b.root.position;
    this._toTarget.subVectors(prey.root.position, p).setY(0);
    const dist = this._toTarget.length();
    const bearing = Math.atan2(this._toTarget.x, this._toTarget.z);

    // ---- Decide o rumo (a cada 0.5 s) ----
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.5;
      if (dist > 120) { this.desired = bearing; b.setSail(2); }
      else if (dist < 45) { this.desired = bearing + Math.PI; b.setSail(2); }
      else {
        // Fica de lado: escolhe o perpendicular mais próximo do rumo atual
        const a1 = bearing + Math.PI / 2, a2 = bearing - Math.PI / 2;
        this.desired = Math.abs(angleDelta(b.heading, a1)) < Math.abs(angleDelta(b.heading, a2)) ? a1 : a2;
        b.setSail(1);
      }
      // Evita águas rasas: sonda 35 m à frente
      const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
      if (this.ctx.terrain.getHeight(p.x + fx * 35, p.z + fz * 35) > -4) {
        this.desired = b.heading + Math.PI * 0.6;
      }
    }
    const steer = clamp(angleDelta(b.heading, this.desired) * 1.5, -1, 1);
    b.update(dt, { steer });

    // ---- Disparo ----
    if (dist < 140) {
      const dir = this._toTarget.normalize();
      const side = this.cannons.sideFacing(dir);
      const sv = this.cannons.sideVector(side);
      if (sv.dot(dir) > 0.9 && this.cannons.ready(side)) {
        const v = SC.muzzleSpeed;
        const elev = clamp(0.5 * Math.asin(Math.min(1, (9.81 * dist) / (v * v))), 0, 0.5);
        this.cannons.fire(side, elev);
      }
    }
  }
}
