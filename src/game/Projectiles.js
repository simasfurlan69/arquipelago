/**
 * Projectiles.js
 * Flechas e balas de canhão com balística simples (gravidade + arrasto leve).
 * Testa colisão por segmento (posição anterior → atual) contra os alvos do
 * Combat, o terreno e a água. Inclui um sistema de efeitos leve (splash, fumaça,
 * poeira) com pool de partículas.
 */
import * as THREE from 'three/webgpu';
import { LAYERS } from '../render/GameRenderer.js';

const G = 9.81;

/** Textura de "fumacinha" macia (gradiente radial com manchas de ruído), gerada em memória. */
function softPuffTexture() {
  const N = 64, data = new Uint8Array(N * N * 4);
  const blobs = Array.from({ length: 14 }, () => [Math.random() * N, Math.random() * N, 5 + Math.random() * 10, 0.25 + Math.random() * 0.3]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
    const r = Math.sqrt(dx * dx + dy * dy);
    let a = Math.max(0, 1 - r); a = a * a * (3 - 2 * a);
    for (const [bx, by, br, bs] of blobs) { const d = Math.hypot(x - bx, y - by) / br; if (d < 1) a *= 1 - bs * (1 - d); }
    const i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// =============================================================================
// Efeitos (partículas simples em pool)
// =============================================================================
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    this.geo = new THREE.IcosahedronGeometry(1, 0);
    this.mats = {
      splash: new THREE.MeshStandardNodeMaterial({ color: 0xeaf4f8, roughness: 0.6, transparent: true }),
      smoke: new THREE.MeshStandardNodeMaterial({ color: 0x9a9a9a, roughness: 1, transparent: true }),
      dust: new THREE.MeshStandardNodeMaterial({ color: 0x8a7a5a, roughness: 1, transparent: true }),
      fire: new THREE.MeshStandardNodeMaterial({ color: 0xff8a2a, emissive: 0xff5a10, emissiveIntensity: 2, transparent: true }),
      blood: new THREE.MeshStandardNodeMaterial({ color: 0x8a1010, roughness: 0.8, transparent: true }),
      wood: new THREE.MeshStandardNodeMaterial({ color: 0x6b4428, roughness: 1, transparent: true }),
      ice: new THREE.MeshStandardNodeMaterial({ color: 0xd8f0ff, emissive: 0x5ab8ff, emissiveIntensity: 1.5, roughness: 0.2, transparent: true }),
      rune: new THREE.MeshStandardNodeMaterial({ color: 0x103018, emissive: 0x50ff90, emissiveIntensity: 3, transparent: true }),
      mist: new THREE.MeshStandardNodeMaterial({ color: 0x201030, emissive: 0xa070ff, emissiveIntensity: 2.5, transparent: true }),
      spark: new THREE.MeshStandardNodeMaterial({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 4, transparent: true }),
      leaf: new THREE.MeshStandardNodeMaterial({ color: 0x4f7a2c, roughness: 0.9, transparent: true, side: THREE.DoubleSide }),
    };
    // Nuvem de pó: sprites macios (gradiente radial), cada um com opacidade própria
    this.dustTex = softPuffTexture();
    this.cloudPool = [];
    this.cloudActive = [];
    this.camera = null;      // main.js define (os planos de pó olham para a câmera)
    this.light = 1;          // 1 = dia claro … ~0.15 noite (main.js atualiza)
  }

  /**
   * Nuvem de pó/serragem que sobe, se espalha e some devagar.
   * @param {THREE.Vector3} pos centro
   * @param {number} n quantidade de sprites
   */
  dustCloud(pos, n = 10, { spread = 1.2, size = 1.4, life = 2.6, rise = 0.5, speed = 1.6, tint = 0x9a8466, height = 0.4 } = {}) {
    const base = new THREE.Color(tint);
    for (let i = 0; i < n; i++) {
      let p = this.cloudPool.pop();
      if (!p) {
        // plano virado para a câmera; a cor acompanha a luz do dia (effects.light)
        const mat = new THREE.MeshBasicNodeMaterial({ map: this.dustTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        p = { sprite: new THREE.Mesh(this.puffGeo || (this.puffGeo = new THREE.PlaneGeometry(1, 1)), mat), vel: new THREE.Vector3(), col: new THREE.Color(), rot: 0 };
        p.sprite.frustumCulled = false;
        p.sprite.layers.set(LAYERS.TRANSPARENT);   // passe dos transparentes (depois da água)
        p.sprite.renderOrder = 5;
      }
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      p.sprite.position.set(pos.x + Math.cos(a) * r, pos.y + Math.random() * height, pos.z + Math.sin(a) * r);
      p.vel.set(Math.cos(a) * speed * (0.4 + Math.random()), Math.random() * speed * 0.6, Math.sin(a) * speed * (0.4 + Math.random()));
      p.size = size * (0.6 + Math.random() * 0.8);
      p.life = p.maxLife = life * (0.7 + Math.random() * 0.6);
      p.rise = rise;
      p.spin = (Math.random() - 0.5) * 0.6;
      p.rot = Math.random() * Math.PI * 2;
      const v = 0.85 + Math.random() * 0.3;
      p.col.copy(base).multiplyScalar(v);
      p.sprite.material.opacity = 0;
      p.sprite.scale.setScalar(p.size);
      this.scene.add(p.sprite);
      this.cloudActive.push(p);
    }
  }

  _get(type) {
    let p = this.pool.pop();
    if (!p) {
      p = { mesh: new THREE.Mesh(this.geo, this.mats.splash), vel: new THREE.Vector3() };
      p.mesh.frustumCulled = false;
      p.mesh.layers.set(LAYERS.TRANSPARENT);
    }
    p.mesh.material = this.mats[type];
    this.scene.add(p.mesh);
    this.active.push(p);
    return p;
  }

  /** Emite `n` partículas de um tipo. */
  burst(type, pos, n = 8, { speed = 4, up = 4, size = 0.25, life = 0.9, grow = 1.5, gravity = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const p = this._get(type);
      p.mesh.position.copy(pos);
      p.vel.set((Math.random() - 0.5) * speed, Math.random() * up, (Math.random() - 0.5) * speed);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.life = p.maxLife = life * (0.7 + Math.random() * 0.6);
      p.grow = grow;
      p.gravity = gravity;
      p.mesh.scale.setScalar(p.size);
    }
  }

  splash(pos, big = false) { this.onSplash?.(pos, big); this.burst('splash', pos, big ? 22 : 8, { speed: big ? 6 : 2.5, up: big ? 9 : 4, size: big ? 0.45 : 0.15, life: 1.0 }); }
  smoke(pos, n = 10) { this.burst('smoke', pos, n, { speed: 2, up: 2, size: 0.6, life: 1.8, grow: 3, gravity: -0.2 }); }
  dust(pos) { this.burst('dust', pos, 8, { speed: 3, up: 3, size: 0.2, life: 0.7 }); }
  chips(pos) { this.burst('wood', pos, 6, { speed: 3, up: 3, size: 0.08, life: 0.6 }); }
  blood(pos) { this.burst('blood', pos, 6, { speed: 2, up: 2, size: 0.07, life: 0.6 }); }
  fire(pos, n = 6) { this.burst('fire', pos, n, { speed: 1, up: 2.5, size: 0.25, life: 0.8, grow: 0.3, gravity: -0.5 }); }

  update(dt) {
    for (let i = this.cloudActive.length - 1; i >= 0; i--) {
      const p = this.cloudActive[i];
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.sprite); this.cloudActive.splice(i, 1); this.cloudPool.push(p); continue; }
      p.vel.multiplyScalar(Math.exp(-1.8 * dt));                 // arrasto do ar
      p.vel.y += p.rise * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = 1 - p.life / p.maxLife;
      p.sprite.scale.setScalar(p.size * (1 + k * 2.2));
      const m = p.sprite.material;
      p.rot += p.spin * dt;
      if (this.camera) { p.sprite.quaternion.copy(this.camera.quaternion); p.sprite.rotateZ(p.rot); }
      m.opacity = Math.min(1, k * 6) * Math.pow(1 - k, 1.4) * 0.85;
      m.color.copy(p.col).multiplyScalar(this.light);
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.active.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.vel.y -= G * p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = 1 - p.life / p.maxLife;
      p.mesh.scale.setScalar(p.size * (1 + k * p.grow) * (1 - k * 0.6));
    }
  }
}

// =============================================================================
// Projéteis
// =============================================================================
export class Projectiles {
  constructor(scene, { terrain, ocean, combat, effects }) {
    this.scene = scene;
    this.terrain = terrain;
    this.ocean = ocean;
    this.combat = combat;
    this.fx = effects;
    this.list = [];
    this.stuck = [];

    // Flecha: haste + ponta + penas, apontando para +Z
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.75, 4), new THREE.MeshStandardNodeMaterial({ color: 0xc8a878 }));
    shaft.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), new THREE.MeshStandardNodeMaterial({ color: 0x555555, metalness: 0.6 }));
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.42;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.005, 0.12), new THREE.MeshStandardNodeMaterial({ color: 0xeeeeee }));
    fl.position.z = -0.32;
    const fl2 = fl.clone(); fl2.rotation.z = Math.PI / 2;
    arrow.add(shaft, tip, fl, fl2);
    this.arrowProto = arrow;

    this.ballGeo = new THREE.SphereGeometry(0.22, 10, 8);
    this.ballMat = new THREE.MeshStandardNodeMaterial({ color: 0x1e1e22, metalness: 0.7, roughness: 0.4 });
    this.ghostBallMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a3a2a, emissive: 0x30ff60, emissiveIntensity: 1.5 });
    this._p0 = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  /** Dispara uma flecha. */
  /** @param {object} o { homing: alvo (teleguiada), gravity } */
  arrow(pos, vel, damage, faction, o = {}) {
    const mesh = this.arrowProto.clone();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.list.push({ type: 'arrow', mesh, vel: vel.clone(), damage, faction, life: 8, drag: 0.02, gravity: o.homing ? 0.1 : 0.75, homing: o.homing || null, trail: o.trail || null });
  }

  /** Dispara uma bala de canhão. */
  cannonball(pos, vel, damage, faction) {
    const mesh = new THREE.Mesh(this.ballGeo, faction === 'ship-ghost' ? this.ghostBallMat : this.ballMat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.list.push({ type: 'ball', mesh, vel: vel.clone(), damage, faction, life: 10, drag: 0.003, gravity: 1 });
  }

  _remove(i) {
    const p = this.list[i];
    this.scene.remove(p.mesh);
    this.list.splice(i, 1);
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this._remove(i); continue; }

      this._p0.copy(p.mesh.position);
      if (p.homing?.alive) {
        // curva suave em direção ao alvo, sem perder velocidade
        const s = p.homing.getHitSpheres()[0], sp = p.vel.length();
        this._dir.set(s.x - p.mesh.position.x, s.y - p.mesh.position.y, s.z - p.mesh.position.z).normalize().multiplyScalar(sp);
        p.vel.lerp(this._dir, 1 - Math.exp(-dt * 5)).setLength(sp);
        if (p.trail && Math.random() < 0.5) this.fx.burst(p.trail, p.mesh.position, 1, { speed: 0.3, up: 0.3, size: 0.07, life: 0.35, gravity: 0 });
      }
      p.vel.y -= G * p.gravity * dt;
      p.vel.multiplyScalar(1 - p.drag * dt);
      p.mesh.position.addScaledVector(p.vel, dt);
      const pos = p.mesh.position;

      if (p.type === 'arrow') {
        this._dir.copy(p.vel).normalize();
        p.mesh.lookAt(pos.x + this._dir.x, pos.y + this._dir.y, pos.z + this._dir.z);
      }

      // ---- Alvos ----
      const hit = this.combat.segmentHit(this._p0, pos, p.faction);
      if (hit) {
        this._dir.copy(p.vel).normalize();
        const dmg = hit.crit && p.type === 'arrow' ? p.damage * 2 : p.damage;
        this.combat.hit(hit.target, dmg, this._dir, hit.point, { source: p.type, crit: hit.crit && p.type === 'arrow', fromPlayer: p.faction === 'player' || p.faction === 'ship-player' });
        if (p.type === 'ball') { this.fx.chips(hit.point); this.fx.smoke(hit.point, 6); }
        else this.fx.blood(hit.point);
        this._remove(i);
        continue;
      }

      // ---- Água ----
      const water = this.ocean.getWaveHeight(pos.x, pos.z);
      const ground = this.terrain.getHeight(pos.x, pos.z);
      if (pos.y < water && ground < water) {
        this.fx.splash(new THREE.Vector3(pos.x, water, pos.z), p.type === 'ball');
        this._remove(i);
        continue;
      }
      // ---- Terreno ----
      if (pos.y < ground) {
        pos.y = ground + 0.05;
        this.fx.dust(pos);
        if (p.type === 'arrow') {
          // flecha fica cravada no chão por um tempo
          this.stuck.push({ mesh: p.mesh, life: 12 });
          this.list.splice(i, 1);
        } else this._remove(i);
      }
    }

    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i];
      s.life -= dt;
      if (s.life <= 0) { this.scene.remove(s.mesh); this.stuck.splice(i, 1); }
    }
  }
}
