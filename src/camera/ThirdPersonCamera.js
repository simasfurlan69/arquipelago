/**
 * ThirdPersonCamera.js
 * Câmera em 3ª pessoa com:
 *  - olhar pelo mouse (pointer lock) ou arrastando;
 *  - dois perfis (a pé / no barco) com transição suave de distância, altura,
 *    ponto de mira e FOV ao embarcar ou desembarcar;
 *  - modo MIRA (arco): aproxima e desloca para o ombro direito;
 *  - no barco, alinha sozinha atrás da popa se o mouse ficar parado;
 *  - amortecimento exponencial (independente de FPS);
 *  - nunca atravessa o terreno nem desce abaixo da água;
 *  - não entra em paredes, troncos, construções nem copas de árvore: aproxima
 *    na hora ao bater e volta devagar à distância normal.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { damp, dampAngle, clamp, lerp } from '../utils/Noise.js';

const C = CONFIG.camera;

export class ThirdPersonCamera {
  constructor(camera, input, terrain, ocean) {
    this.camera = camera;
    this.input = input;
    this.terrain = terrain;
    this.ocean = ocean;
    this.yaw = Math.PI;              // câmera atrás do jogador (que olha para +Z)
    this.pitch = 0.32;
    this.blend = 0;                  // 0 = a pé, 1 = barco
    this.aim = 0;                    // 0..1 modo mira
    this.aiming = false;
    this.shake = 0;
    this.target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._initialized = false;
    this.colliders = null;           // Colliders (paredes, troncos)
    this.vegetation = null;          // Vegetation (copas)
    this._free = Infinity;           // distância livre atual (com retorno suave)
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._dir2 = new THREE.Vector3();
  }

  /** Distância livre de obstáculos do ponto de mira até `dist` na direção `dir`. */
  _freeDistance(look, dir, dist) {
    const PAD = 0.35;
    let t = 1;
    const end = this._tmp.copy(look).addScaledVector(dir, dist);
    if (this.colliders) t = Math.min(t, this.colliders.segmentHit(look, end, PAD, (x, z) => this.terrain.getHeight(x, z)));
    if (this.vegetation?.crownHit) t = Math.min(t, this.vegetation.crownHit(look, dir, dist, PAD) / dist);
    // terreno ao longo do caminho (morros entre o jogador e a câmera)
    for (let i = 1; i <= 8; i++) {
      const k = i / 8;
      if (k >= t) break;
      const x = look.x + dir.x * dist * k, z = look.z + dir.z * dist * k, y = look.y + dir.y * dist * k;
      if (y < this.terrain.getHeight(x, z) + 0.3) { t = Math.max(0, (i - 1) / 8); break; }
    }
    return Math.max(0.6, t * dist - 0.15);
  }

  /** Direção para onde a câmera olha (mundo). */
  getAimDirection(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }

  /** Frente horizontal da câmera (para mover o jogador). */
  getFlatForward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  addShake(a) { this.shake = Math.min(1, this.shake + a); }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} focus posição de mundo do jogador
   * @param {boolean} onBoat
   * @param {number} boatHeading
   */
  update(dt, focus, onBoat, boatHeading = 0) {
    const inp = this.input;
    const sens = this.aiming ? 0.0028 : 0.004;

    // ---- Olhar ----
    this.yaw -= inp.mouseDX * sens * (inp.sensitivity || 1);
    this.pitch = clamp(this.pitch + inp.mouseDY * sens * 0.9 * (inp.sensitivity || 1) * (inp.invertY ? -1 : 1), -0.55, 1.25);

    // ---- Perfis ----
    this.blend = damp(this.blend, onBoat ? 1 : 0, C.profileBlend, dt);
    this.aim = damp(this.aim, this.aiming && !onBoat ? 1 : 0, 10, dt);
    const b = this.blend, a = this.aim;
    const dist = lerp(lerp(C.onFoot.distance, C.onBoat.distance, b), 2.6, a);
    const lookH = lerp(C.onFoot.lookHeight, C.onBoat.lookHeight, b) + a * 0.1;
    const basePitch = Math.atan2(lerp(C.onFoot.height, C.onBoat.height, b), lerp(C.onFoot.distance, C.onBoat.distance, b));
    const fov = lerp(lerp(C.onFoot.fov, C.onBoat.fov, b), 48, a);

    // No barco: volta para trás da popa após 2.5 s sem mexer o mouse
    if (onBoat && performance.now() - inp.lastMouseMove > 2500) {
      this.yaw = dampAngle(this.yaw, boatHeading + Math.PI, 0.8, dt);
    }

    // ---- Posição desejada ----
    // Ombro direito no modo mira: deslocamento lateral perpendicular ao yaw
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const shoulder = a * 0.75;
    this._look.set(focus.x + rx * shoulder, focus.y + lookH, focus.z + rz * shoulder);
    const pitch = basePitch + (this.pitch - 0.32);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this._desired.set(
      this._look.x + Math.sin(this.yaw) * cp * dist,
      this._look.y + sp * dist,
      this._look.z + Math.cos(this.yaw) * cp * dist
    );

    // ---- Colisão com terreno e água ----
    const ground = this.terrain.getHeight(this._desired.x, this._desired.z);
    const water = this.ocean.getWaveHeight(this._desired.x, this._desired.z);
    this._desired.y = Math.max(this._desired.y, ground + 1.0, water + 0.8);

    // ---- Colisão com paredes, troncos e copas ----
    const dDist = this._dir.subVectors(this._desired, this._look).length();
    this._dir.divideScalar(Math.max(dDist, 1e-4));
    const free = this._freeDistance(this._look, this._dir, dDist);
    this._free = free < this._free ? free : damp(this._free, free, 3, dt);   // aproxima na hora, afasta suave
    if (this._free < dDist) this._desired.copy(this._look).addScaledVector(this._dir, this._free);

    // ---- Amortecimento ----
    if (!this._initialized) {
      this.camera.position.copy(this._desired);
      this.target.copy(this._look);
      this._initialized = true;
    }
    const k = 1 - Math.exp(-(C.damping + a * 14) * dt);
    this.camera.position.lerp(this._desired, k);
    this.target.lerp(this._look, 1 - Math.exp(-(C.damping * 1.6 + a * 14) * dt));
    // nunca fica atrás do obstáculo, mesmo durante o amortecimento
    {
      const v = this._dir2.subVectors(this.camera.position, this._look), l = v.length();
      if (l > this._free + 0.05) {
        v.normalize();
        const f = this._freeDistance(this._look, v, l);
        if (f < l) this.camera.position.copy(this._look).addScaledVector(v, f);
      }
    }
    this.camera.lookAt(this.target);

    // Tremor (dano, tiros de canhão)
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
