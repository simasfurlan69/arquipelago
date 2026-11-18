/**
 * FloatingText.js
 * Números de dano e textos que sobem e somem sobre o mundo 3D (DOM com pool,
 * projetado pela câmera a cada frame).
 */
import * as THREE from 'three/webgpu';

const _v = new THREE.Vector3();

export class FloatingText {
  constructor(camera) {
    this.camera = camera;
    this.enabled = true;
    this.root = document.createElement('div');
    this.root.id = 'floattext';
    document.getElementById('hud').appendChild(this.root);
    this.items = [];
    this.pool = [];
  }

  /**
   * @param {THREE.Vector3} pos posição no mundo
   * @param {string|number} text
   * @param {'dmg'|'crit'|'heal'|'info'|'player'} kind
   */
  spawn(pos, text, kind = 'dmg') {
    if (!this.enabled && kind !== 'info') return;
    const el = this.pool.pop() || document.createElement('div');
    el.className = `ft ${kind}`;
    el.textContent = typeof text === 'number' ? Math.round(text) : text;
    this.root.appendChild(el);
    this.items.push({ el, p: pos.clone().add(_v.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), t: 0, life: kind === 'crit' ? 1.2 : 0.9 });
  }

  update(dt) {
    const w = innerWidth, h = innerHeight;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (it.t >= it.life) { it.el.remove(); this.pool.push(it.el); this.items.splice(i, 1); continue; }
      _v.copy(it.p); _v.y += it.t * 1.3;
      _v.project(this.camera);
      if (_v.z > 1) { it.el.style.opacity = 0; continue; }
      const k = it.t / it.life;
      it.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%) scale(${1 + (1 - k) * 0.3})`;
      it.el.style.opacity = 1 - k * k;
    }
  }
}
