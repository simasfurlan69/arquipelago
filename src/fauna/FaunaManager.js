/**
 * FaunaManager.js
 * Cria e atualiza toda a fauna. Faz LOD de atualização: animais além de
 * CONFIG.fauna.lodDistance do jogador só são atualizados a cada 4 frames (com
 * delta acumulado), o que reduz o custo de IA e de mixers sem perda visível.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../utils/Noise.js';
import { Bird } from './Bird.js';
import { LandAnimal } from './LandAnimal.js';
import { Alligator } from './Alligator.js';

const F = CONFIG.fauna;

export class FaunaManager {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.animals = [];
    this.rand = mulberry32(CONFIG.seed + 777);
  }

  build() {
    const { terrain } = this.ctx;
    const R = this.rand;
    const main = terrain.islands[0];
    const V = CONFIG.world.village;

    // Pássaros: bandos sobre a ilha principal, a vila e o mar
    const centers = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(V.x, 0, V.z), new THREE.Vector3(420, 0, 0), new THREE.Vector3(-200, 0, 150)];
    for (let i = 0; i < F.birds; i++) this._add(new Bird(this.ctx, R, centers[i % centers.length]));

    // Terra firme da ilha principal, longe da vila
    const landSpot = () => {
      for (let i = 0; i < 200; i++) {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * main.radius * 0.85;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (terrain.getHeight(x, z) > 2.5 && terrain.getHeight(x, z) < 30 && terrain.getSlope(x, z) < 0.3
          && Math.hypot(x - V.x, z - V.z) > V.radius * 0.8) return new THREE.Vector3(x, 0, z);
      }
      return new THREE.Vector3(100, 0, 150);
    };
    for (let i = 0; i < F.deer; i++) this._add(new LandAnimal(this.ctx, R, 'deer', landSpot()));
    for (let i = 0; i < F.horses; i++) this._add(new LandAnimal(this.ctx, R, 'horse', landSpot()));
    for (let i = 0; i < (F.foxes ?? 5); i++) this._add(new LandAnimal(this.ctx, R, 'fox', landSpot()));

    // Jacarés: margens do interior do canal e do lago
    const P = terrain.canalPoints;
    for (let i = 0; i < F.alligators; i++) {
      for (let t = 0; t < 200; t++) {
        const idx = Math.floor(P.length * (0.45 + R() * 0.55));
        const p = P[Math.min(idx, P.length - 1)];
        const a = R() * Math.PI * 2, d = 14 + R() * 30;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        const h = terrain.getHeight(x, z);
        if (h > -1.5 && h < 0.6) { this._add(new Alligator(this.ctx, R, new THREE.Vector3(x, 0, z))); break; }
      }
    }
  }

  _add(a) {
    a._acc = 0;
    this.animals.push(a);
    this.scene.add(a.root);
  }

  update(dt, t, frame, playerPos) {
    const lod2 = F.lodDistance * F.lodDistance;
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      a._acc += dt;
      const p = a.root.position;
      const d2 = (p.x - playerPos.x) ** 2 + (p.z - playerPos.z) ** 2;
      // Longe: atualiza 1 a cada 4 frames, com fase escalonada por índice
      if (d2 > lod2 && (frame + i) % 4 !== 0) continue;
      a.update(a._acc, t);
      a._acc = 0;
    }
  }
}
