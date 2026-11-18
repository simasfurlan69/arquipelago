/**
 * EnemyManager.js
 * Controla os mortos-vivos noturnos:
 *  - à noite, com o jogador em terra: zumbis surgem a 25–50 m dele (em terra
 *    firme, fora da água), até o limite configurado;
 *  - à noite, com o jogador no navio: navios fantasmas surgem a 180–260 m, em
 *    águas profundas;
 *  - ao amanhecer, zumbis pegam fogo e navios fantasmas se dissolvem.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { Zombie } from './Zombie.js';
import { GhostShip } from './GhostShip.js';

const E = CONFIG.enemies;

export class EnemyManager {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.zombies = [];
    this.ghosts = [];
    this.zTimer = 2;
    this.gTimer = 8;
  }

  /** Tenta criar um zumbi perto de (x,z). */
  spawnZombie(center, minR = 25, maxR = 50) {
    const t = this.ctx.terrain;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const h = t.getHeight(x, z);
      if (h > 1 && t.getSlope(x, z) < 0.6 && this.ctx.colliders.isFree(x, z, 0.6)) {
        const zb = new Zombie(this.scene, this.ctx, new THREE.Vector3(x, h, z));
        this.zombies.push(zb);
        this.ctx.effects.dust(new THREE.Vector3(x, h + 0.2, z));
        return zb;
      }
    }
    return null;
  }

  /** Tenta criar um navio fantasma no mar ao redor de `center`. */
  spawnGhostShip(center, minR = 180, maxR = 260) {
    const t = this.ctx.terrain;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      // Água profunda num raio razoável (cabe o casco e dá para manobrar)
      if ([[0, 0], [25, 0], [-25, 0], [0, 25], [0, -25]].every(([ox, oz]) => t.getHeight(x + ox, z + oz) < -8)) {
        const heading = Math.atan2(center.x - x, center.z - z);
        const g = new GhostShip(this.scene, this.ctx, x, z, heading);
        this.ghosts.push(g);
        this.ctx.hud?.toast('☠ Um navio fantasma surgiu na névoa!', 3);
        return g;
      }
    }
    return null;
  }

  onDawn() {
    for (const z of this.zombies) z.burn();
    for (const g of this.ghosts) g.dissolve();
  }

  /**
   * @param {boolean} isNight
   * @param {import('../entities/Player.js').Player} player
   * @param {THREE.Vector3} playerPos posição de mundo
   * @param {import('../entities/Boat.js').Boat} playerBoat
   */
  update(dt, isNight, player, playerPos, playerBoat) {
    if (isNight) {
      if (player.state === 'foot') {
        this.zTimer -= dt;
        const alive = this.zombies.filter((z) => z.alive).length;
        if (this.zTimer <= 0 && alive < E.maxZombies) {
          this.zTimer = E.zombieSpawnInterval * (0.6 + Math.random() * 0.8);
          this.spawnZombie(playerPos);
        }
      } else if (playerBoat?.alive) {
        this.gTimer -= dt;
        const alive = this.ghosts.filter((g) => g.alive).length;
        if (this.gTimer <= 0 && alive < E.ghostShips) {
          this.gTimer = E.ghostSpawnInterval;
          this.spawnGhostShip(playerBoat.root.position);
        }
      }
    }

    for (const z of this.zombies) z.update(dt, player);
    // navios inimigos só caçam o jogador em mar aberto (longe das ilhas)
    const exposed = this.ctx.naval ? this.ctx.naval.playerExposed(player, playerBoat) : true;
    for (const g of this.ghosts) g.update(dt, exposed ? playerBoat : null);
    // Zumbis muito longe somem (o jogador zarpou)
    for (const z of this.zombies) if (z.alive && z.root.position.distanceTo(playerPos) > 160) z.remove();
    this.zombies = this.zombies.filter((z) => !z.removed);
    this.ghosts = this.ghosts.filter((g) => !g.removed);
  }
}
