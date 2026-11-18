/**
 * NavalBots.js
 * Navios piratas que patrulham o mar ao redor do arquipélago a qualquer hora.
 *
 * Regra de combate pedida: eles SÓ atacam quando o jogador está no navio E longe
 * das ilhas (distância da costa > CONFIG.naval.safeShore). Perto da costa eles
 * desistem, viram e voltam a patrulhar.
 *
 * O comportamento de batalha (ficar de lado, disparar com elevação balística)
 * é o mesmo do navio fantasma (GhostShip.update).
 */
import * as THREE from 'three/webgpu';
import { GhostShip } from './GhostShip.js';
import { angleDelta, clamp } from '../utils/Noise.js';

const SAFE_SHORE = 150;      // m: abaixo disso ninguém ataca o jogador
const SIGHT = 320;           // m: alcance de visão dos piratas
const PATROL_MIN_SHORE = 220;

export class NavalBots {
  constructor(scene, ctx, { count = 3 } = {}) {
    this.scene = scene;
    this.ctx = ctx;
    this.count = count;
    this.ships = [];
    this.respawnT = 5;
    this.safeShore = SAFE_SHORE;
  }

  /** O jogador está em "mar aberto"? (no navio e longe de qualquer ilha) */
  playerExposed(player, boat) {
    if (player.state !== 'boat' || !boat?.alive) return false;
    const p = boat.root.position;
    return this.ctx.shoreDist.at(p.x, p.z) > this.safeShore;
  }

  _spawn(near) {
    const sd = this.ctx.shoreDist;
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, r = 350 + Math.random() * 450;
      const x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r;
      if (sd.at(x, z) < PATROL_MIN_SHORE) continue;
      const s = new GhostShip(this.scene, this.ctx, x, z, Math.random() * Math.PI * 2, 'pirate');
      s.waypoint = this._waypoint(x, z);
      s.boat.setSail(1);
      this.ships.push(s);
      return s;
    }
    return null;
  }

  _waypoint(x, z) {
    const sd = this.ctx.shoreDist;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = 250 + Math.random() * 400;
      const wx = x + Math.cos(a) * r, wz = z + Math.sin(a) * r;
      if (sd.at(wx, wz) > PATROL_MIN_SHORE) return new THREE.Vector2(wx, wz);
    }
    return new THREE.Vector2(x * 1.2, z * 1.2);
  }

  update(dt, player, playerBoat, focus) {
    // mantém a frota (só cria quando o jogador está no mar, longe da vista)
    this.ships = this.ships.filter((s) => !s.removed);
    this.respawnT -= dt;
    if (this.respawnT <= 0 && this.ships.length < this.count && player.state === 'boat') {
      this.respawnT = 25;
      this._spawn(focus);
    }
    const exposed = this.playerExposed(player, playerBoat);
    for (const s of this.ships) {
      const b = s.boat, p = b.root.position;
      const dist = playerBoat ? p.distanceTo(playerBoat.root.position) : Infinity;
      s.aggressive = exposed && dist < SIGHT;
      if (s.aggressive || b.sinking) { s.update(dt, playerBoat); continue; }
      // ---- patrulha ----
      if (!s.waypoint || Math.hypot(s.waypoint.x - p.x, s.waypoint.y - p.z) < 40) s.waypoint = this._waypoint(p.x, p.z);
      let desired = Math.atan2(s.waypoint.x - p.x, s.waypoint.y - p.z);
      // longe da costa: sonda à frente
      const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
      if (this.ctx.shoreDist.at(p.x + fx * 60, p.z + fz * 60) < 120) { desired = b.heading + Math.PI * 0.7; s.waypoint = null; }
      b.setSail(1);
      b.update(dt, { steer: clamp(angleDelta(b.heading, desired) * 1.2, -1, 1) });
      // muito longe do jogador: some (economiza)
      if (focus && Math.hypot(p.x - focus.x, p.z - focus.z) > 1600) s.remove();
    }
  }

  /** Algum pirata está atacando agora? (música de batalha) */
  get inBattle() { return this.ships.some((s) => s.aggressive && !s.boat.sinking); }
}
