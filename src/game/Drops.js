/**
 * Drops.js
 * Itens largados no mundo: um cubinho colorido girando e flutuando. Caem com
 * gravidade, boiam na água, são atraídos pelo jogador por perto e entram
 * sozinhos no inventário. Somem depois de alguns minutos.
 */
import * as THREE from 'three/webgpu';
import { ITEMS } from './Items.js';
import { CONFIG } from '../config.js';

const S = CONFIG.survival;

export class Drops {
  constructor(scene, { terrain, ocean, colliders, inventory, hud }) {
    this.scene = scene;
    this.terrain = terrain;
    this.ocean = ocean;
    this.colliders = colliders;
    this.inventory = inventory;
    this.hud = hud;
    this.list = [];
    this.geo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
    this.mats = {};
    this._tmp = new THREE.Vector3();
  }

  _mat(id) {
    if (!this.mats[id]) {
      const c = ITEMS[id].color;
      this.mats[id] = new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.6, emissive: c, emissiveIntensity: 0.25 });
    }
    return this.mats[id];
  }

  /** Larga `count` unidades do item em `pos`, divididas em até 4 cubinhos. */
  spawn(id, count, pos) {
    if (!count) return;
    const pieces = Math.min(count, 4);
    let left = count;
    for (let i = 0; i < pieces; i++) {
      const n = i === pieces - 1 ? left : Math.ceil(count / pieces);
      left -= n;
      const mesh = new THREE.Mesh(this.geo, this._mat(id));
      mesh.castShadow = true;
      mesh.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
      this.scene.add(mesh);
      this.list.push({
        id, count: n, mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3),
        age: 0, phase: Math.random() * 6,
      });
    }
  }

  /**
   * @param {THREE.Vector3} playerPos
   * @param {number} reach raio de coleta (maior quando no navio)
   */
  update(dt, playerPos, reach = S.pickupRadius) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt;
      if (d.age > S.dropLifetime) { this.scene.remove(d.mesh); this.list.splice(i, 1); continue; }
      const p = d.mesh.position;

      // Ímã: puxa para o jogador
      const dist = p.distanceTo(playerPos);
      if (d.age > 0.6 && dist < Math.max(S.magnetRadius, reach + 1.5)) {
        this._tmp.subVectors(playerPos, p).setY(playerPos.y + 0.8 - p.y).normalize();
        d.vel.lerp(this._tmp.multiplyScalar(10), 1 - Math.exp(-8 * dt));
        p.addScaledVector(d.vel, dt);
        if (dist < reach || dist < 0.9) {
          const left = this.inventory.add(d.id, d.count);
          if (left < d.count) this.hud.pickup?.(d.id, d.count - left);
          if (left <= 0) { this.scene.remove(d.mesh); this.list.splice(i, 1); continue; }
          d.count = left;
        }
      } else {
        // Física: gravidade, chão, água
        d.vel.y -= 9.81 * dt;
        p.addScaledVector(d.vel, dt);
        const ground = Math.max(this.terrain.getHeight(p.x, p.z), this.colliders.platformHeight(p.x, p.z));
        const water = this.ocean.getWaveHeight(p.x, p.z);
        if (water > ground && p.y < water + 0.15) {           // boiando
          p.y = water + 0.15; d.vel.set(d.vel.x * 0.9, 0, d.vel.z * 0.9);
        } else if (p.y < ground + 0.25) {
          p.y = ground + 0.25; d.vel.set(0, 0, 0);
        }
      }
      d.mesh.rotation.y += dt * 1.8;
      d.mesh.position.y += Math.sin(d.age * 3 + d.phase) * 0.004;
    }
  }
}
