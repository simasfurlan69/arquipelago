/**
 * CombatFX.js
 * Efeitos visuais de combate (tudo aditivo e com pool — nenhum material é criado
 * durante o jogo, então não há recompilação de pipeline no meio da luta):
 *
 *  - WeaponTrail  fita de 24 amostras entre a base e a ponta da arma (rastro do golpe)
 *  - ring()       anel de choque no chão que expande e some
 *  - flash()      esfera de luz rápida no ponto do impacto
 *  - telegraph()  marca de aviso no chão (círculo/cone/linha) que "enche" até o golpe
 *  - bolt()       raio zigue-zague do céu até o chão + clarão
 *  - spikes()     estacas (gelo / raízes / pedra) brotando do chão
 *  - screen       vinheta (esquiva perfeita, pouca vida) via CSS — custo zero na GPU
 */
import * as THREE from 'three/webgpu';
import { LAYERS } from '../render/GameRenderer.js';

const add = (o) => { o.layers.set(LAYERS.TRANSPARENT); o.frustumCulled = false; o.renderOrder = 5; return o; };
const addMat = (color, opacity = 1, side = THREE.FrontSide) => new THREE.MeshBasicNodeMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side, fog: false,
});

// =============================================================================
// Rastro da arma
// =============================================================================
export class WeaponTrail {
  constructor(scene, n = 24) {
    this.n = n;
    this.base = Array.from({ length: n }, () => new THREE.Vector3());
    this.tip = Array.from({ length: n }, () => new THREE.Vector3());
    this.count = 0;
    this.intensity = 0;
    this.color = new THREE.Color(1, 1, 1);
    const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.mesh = add(new THREE.Mesh(this.geo, mat));
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setColor(hex) { this.color.set(hex); }
  /** Liga o rastro por `t` segundos (o golpe). */
  burst(t = 0.3, strength = 1) { this.on = Math.max(this.on || 0, t); this.strength = strength; }

  /** @param a base da lâmina (mundo) @param b ponta da lâmina (mundo) */
  update(dt, a, b) {
    this.on = Math.max(0, (this.on || 0) - dt);
    this.intensity = this.on > 0 ? Math.min(1, this.intensity + dt * 20) : Math.max(0, this.intensity - dt * 7);
    if (this.intensity <= 0.001 || !a) { this.mesh.visible = false; this.count = 0; return; }
    // desliza o histórico
    for (let i = this.n - 1; i > 0; i--) { this.base[i].copy(this.base[i - 1]); this.tip[i].copy(this.tip[i - 1]); }
    this.base[0].copy(a); this.tip[0].copy(b);
    if (this.count === 0) for (let i = 1; i < this.n; i++) { this.base[i].copy(a); this.tip[i].copy(b); }
    this.count = Math.min(this.n, this.count + 1);
    const P = this.geo.attributes.position.array, C = this.geo.attributes.color.array;
    const s = this.intensity * (this.strength || 1);
    for (let i = 0; i < this.n; i++) {
      const f = (1 - i / (this.n - 1)) ** 1.6 * s;
      const j = i * 6;
      // base mais fraca, ponta mais forte (o rastro "abre" na ponta)
      P[j] = this.base[i].x; P[j + 1] = this.base[i].y; P[j + 2] = this.base[i].z;
      P[j + 3] = this.tip[i].x; P[j + 4] = this.tip[i].y; P[j + 5] = this.tip[i].z;
      C[j] = this.color.r * f * 0.25; C[j + 1] = this.color.g * f * 0.25; C[j + 2] = this.color.b * f * 0.25;
      C[j + 3] = this.color.r * f; C[j + 4] = this.color.g * f; C[j + 5] = this.color.b * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.mesh.visible = true;
  }
}

// =============================================================================
// Efeitos pontuais
// =============================================================================
export class CombatFX {
  /**
   * @param {THREE.Scene} scene
   * @param {{ effects, groundAt:(x,z)=>number, camera, sfx }} o
   */
  constructor(scene, { effects, groundAt, sfx = null }) {
    this.scene = scene; this.effects = effects; this.groundAt = groundAt; this.sfx = sfx;
    this.items = [];
    const mk = (geo, n) => Array.from({ length: n }, () => {
      const m = add(new THREE.Mesh(geo, addMat(0xffffff, 1, THREE.DoubleSide)));
      m.visible = false; scene.add(m); return m;
    });
    // anel: borda grossa, centro aberto
    const ringGeo = new THREE.RingGeometry(0.72, 1, 48, 1); ringGeo.rotateX(-Math.PI / 2);
    this.rings = mk(ringGeo, 10);
    this.flashes = mk(new THREE.IcosahedronGeometry(1, 2), 8);
    // telegraph: disco cheio + borda; cone (setor) e retângulo
    const disc = new THREE.CircleGeometry(1, 48); disc.rotateX(-Math.PI / 2);
    const sector = new THREE.CircleGeometry(1, 32, -Math.PI / 4, Math.PI / 2); sector.rotateX(-Math.PI / 2); sector.rotateY(-Math.PI / 2);  // abre para +Z
    const rect = new THREE.PlaneGeometry(1, 1); rect.rotateX(-Math.PI / 2); rect.translate(0, 0, 0.5);                                        // de 0 a +Z
    this.tele = { circle: mk(disc, 12), cone: mk(sector, 6), line: mk(rect, 8) };
    this.teleEdge = mk(ringGeo, 12);
    // estacas (gelo/raízes/pedra): cones instanciados num pool simples
    this.spikeMats = {
      ice: new THREE.MeshStandardNodeMaterial({ color: 0xbfe8ff, emissive: 0x4aa8ff, emissiveIntensity: 0.6, roughness: 0.15, transparent: true, opacity: 0.85 }),
      root: new THREE.MeshStandardNodeMaterial({ color: 0x4a3420, roughness: 0.9 }),
      rock: new THREE.MeshStandardNodeMaterial({ color: 0x77706a, roughness: 0.95 }),
      fire: new THREE.MeshStandardNodeMaterial({ color: 0x2a1408, emissive: 0xff5010, emissiveIntensity: 2.5, roughness: 0.8 }),
    };
    const spikeGeo = new THREE.ConeGeometry(0.35, 1, 5); spikeGeo.translate(0, 0.5, 0);
    this.spikePool = Array.from({ length: 40 }, () => { const m = new THREE.Mesh(spikeGeo, this.spikeMats.ice); m.visible = false; m.castShadow = true; scene.add(m); return m; });
    // raio: linhas
    this.boltMat = new THREE.LineBasicNodeMaterial({ color: 0xd8e8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.bolts = Array.from({ length: 4 }, () => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(26 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const l = add(new THREE.Line(g, this.boltMat.clone())); l.visible = false; scene.add(l); return l;
    });
    this.boltLight = new THREE.PointLight(0xcfe0ff, 0, 120, 1.2); scene.add(this.boltLight);
    // tela
    this.vignette = document.createElement('div');
    this.vignette.id = 'fx-vignette';
    document.getElementById('hud')?.appendChild(this.vignette);
    this.vigT = 0; this.lowHp = 0;
  }

  /** Lista de tudo que precisa ser pré-compilado (main faz renderer.compile com eles visíveis). */
  warmList() { return [...this.rings, ...this.flashes, ...this.tele.circle, ...this.tele.cone, ...this.tele.line, ...this.spikePool.slice(0, 1), this.bolts[0]]; }

  _take(pool) { const m = pool.find((o) => !o.visible); return m || null; }

  /** Anel de choque no chão. */
  ring(pos, { radius = 4, color = 0xffd9a0, life = 0.45, y = null } = {}) {
    const m = this._take(this.rings); if (!m) return;
    m.position.set(pos.x, (y ?? this.groundAt(pos.x, pos.z)) + 0.12, pos.z);
    m.material.color.set(color);
    m.visible = true;
    this.items.push({ m, t: 0, life, kind: 'ring', radius });
  }

  /** Clarão esférico rápido (impacto). */
  flash(pos, { size = 0.6, color = 0xfff0d0, life = 0.12 } = {}) {
    const m = this._take(this.flashes); if (!m) return;
    m.position.copy(pos); m.material.color.set(color); m.visible = true;
    this.items.push({ m, t: 0, life, kind: 'flash', radius: size });
  }

  /** Impacto completo de golpe: clarão + faíscas (+ anel se pesado). */
  impact(pos, { heavy = false, crit = false, color = 0xfff0d0 } = {}) {
    this.flash(pos, { size: heavy ? 0.9 : crit ? 0.7 : 0.45, color: crit ? 0xffe070 : color });
    this.effects?.burst('fire', pos, heavy ? 12 : crit ? 9 : 5, { speed: heavy ? 7 : 5, up: 3, size: 0.05, life: 0.3, gravity: 1.5 });
  }

  /**
   * Marca de aviso no chão durante o windup de um ataque inimigo.
   * @param {'circle'|'cone'|'line'} shape
   * @param {number} time duração do aviso (enche até o fim)
   * @param {number} yaw direção (cone/linha), rad, 0 = +Z
   * @param {number} size raio (círculo/cone) ou comprimento (linha)
   * @param {number} width largura (linha)
   */
  telegraph(shape, pos, { time = 0.8, yaw = 0, size = 4, width = 3, color = 0xff2a10, follow = null } = {}) {
    const m = this._take(this.tele[shape]); if (!m) return null;
    const e = this._take(this.teleEdge);
    const y = this.groundAt(pos.x, pos.z) + 0.15;
    m.position.set(pos.x, y, pos.z); m.rotation.set(0, yaw, 0);
    m.material.color.set(color); m.visible = true;
    if (shape === 'line') m.scale.set(width, 1, size);
    if (e && shape === 'circle') { e.position.copy(m.position); e.scale.setScalar(size); e.material.color.set(color); e.visible = true; }
    const it = { m, e: shape === 'circle' ? e : null, t: 0, life: time, kind: 'tele', shape, size, follow };
    this.items.push(it);
    return it;
  }

  /** Raio do céu até `pos` (com dano a cargo de quem chamou). */
  bolt(pos, { color = 0xd8e8ff } = {}) {
    const l = this._take(this.bolts); if (!l) return;
    const g = this.groundAt(pos.x, pos.z);
    const P = l.geometry.attributes.position.array, N = 26;
    let x = pos.x + (Math.random() - 0.5) * 6, z = pos.z + (Math.random() - 0.5) * 6;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      x += (Math.random() - 0.5) * 3.2; z += (Math.random() - 0.5) * 3.2;
      const px = THREE.MathUtils.lerp(x, pos.x, k ** 2), pz = THREE.MathUtils.lerp(z, pos.z, k ** 2);
      P[i * 3] = px; P[i * 3 + 1] = g + 90 * (1 - k); P[i * 3 + 2] = pz;
    }
    l.geometry.attributes.position.needsUpdate = true;
    l.material.color.set(color);
    l.visible = true;
    this.items.push({ m: l, t: 0, life: 0.25, kind: 'bolt' });
    this.boltLight.position.set(pos.x, g + 6, pos.z);
    this.boltLight.intensity = 400;
    this._boltT = 0.18;
    this.ring(pos, { radius: 3.5, color: 0xbcd8ff, life: 0.35 });
    this.flash(new THREE.Vector3(pos.x, g + 0.5, pos.z), { size: 1.6, color: 0xcfe0ff, life: 0.2 });
    this.effects?.burst('fire', new THREE.Vector3(pos.x, g + 0.3, pos.z), 10, { speed: 6, up: 5, size: 0.06, life: 0.4 });
  }

  /** Estacas brotando do chão em `points` (gelo, raízes, pedra, fogo). */
  spikes(points, { kind = 'ice', height = 2.2, life = 1.6 } = {}) {
    for (const p of points) {
      const m = this._take(this.spikePool); if (!m) return;
      m.material = this.spikeMats[kind] || this.spikeMats.ice;
      m.position.set(p.x, this.groundAt(p.x, p.z) - 0.2, p.z);
      m.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 6.28, (Math.random() - 0.5) * 0.5);
      m.visible = true;
      this.items.push({ m, t: 0, life, kind: 'spike', h: height * (0.7 + Math.random() * 0.6) });
    }
  }

  /** Vinheta de tela: 'perfect' (azul, esquiva perfeita) | 'hit' (vermelha). */
  screen(kind, t = 0.6) { this.vignette.className = kind; this.vigT = t; this.vigMax = t; }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.life);
      const m = it.m;
      if (it.kind === 'ring') { m.scale.setScalar(0.3 + it.radius * (1 - (1 - k) ** 3)); m.material.opacity = (1 - k) ** 1.5; }
      else if (it.kind === 'flash') { m.scale.setScalar(it.radius * (0.5 + k)); m.material.opacity = (1 - k) ** 2; }
      else if (it.kind === 'tele') {
        if (it.follow) { m.position.x = it.follow.x; m.position.z = it.follow.z; if (it.e) { it.e.position.x = it.follow.x; it.e.position.z = it.follow.z; } }
        const pulse = 0.25 + 0.1 * Math.sin(it.t * 30);
        if (it.shape === 'line') { m.scale.z = it.size * k; m.material.opacity = pulse + 0.25 * k; }
        else { m.scale.setScalar(it.size * k); m.material.opacity = pulse + 0.2 * k; }
        if (it.e) it.e.material.opacity = 0.7;
      }
      else if (it.kind === 'bolt') m.material.opacity = Math.random() > 0.3 ? 1 - k : 0.15;
      else if (it.kind === 'spike') {
        const up = Math.min(1, it.t / 0.12), down = it.t > it.life - 0.4 ? (it.life - it.t) / 0.4 : 1;
        m.scale.set(1, Math.max(0.01, it.h * up * down), 1);
      }
      if (k >= 1) { m.visible = false; if (it.e) it.e.visible = false; this.items.splice(i, 1); }
    }
    if (this._boltT > 0) { this._boltT -= dt; this.boltLight.intensity = this._boltT > 0 ? 400 * (Math.random() * 0.6 + 0.4) : 0; }
    // vinheta
    if (this.vigT > 0) { this.vigT -= dt; this.vignette.style.opacity = Math.max(0, this.vigT / this.vigMax).toFixed(3); }
    else if (this.lowHp > 0) { this.vignette.className = 'hit'; this.vignette.style.opacity = (this.lowHp * (0.55 + 0.25 * Math.sin(performance.now() / 180))).toFixed(3); }
    else this.vignette.style.opacity = '0';
  }

  /** Remove um telegraph antes do fim (ataque cancelado). */
  cancel(it) { if (!it) return; it.t = it.life; }
}
