/**
 * Harvest.js
 * Coleta de recursos do mundo:
 *  - árvores: qualquer golpe causa dano (o machado é bem mais eficiente). Ao cair,
 *    tombam com gravidade só até encostar no terreno (nunca atravessam o chão),
 *    quicam, levantam uma nuvem de pó e se desfazem em pó. Dropam madeira
 *    (folhosas podem dropar maçã) e rebrotam depois de alguns minutos.
 *  - pedras e veios de minério: só a picareta quebra. Dropam pedra, carvão,
 *    minério de ferro ou ouro.
 * Usa um spatial hash para achar o recurso à frente do jogador.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';

const RC = CONFIG.resources;
const W = CONFIG.weapons;

const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const DROPS = {
  pine: () => [['wood', R(3, 5)], ['stick', R(1, 3)]],
  broad: () => [['wood', R(3, 4)], ['stick', R(1, 3)], ...(Math.random() < 0.3 ? [[Math.random() < 0.5 ? 'apple' : 'banana', R(1, 2)]] : [])],
  bush: () => [[['grape', 'tomato', 'carrot', 'corn'][R(0, 3)], R(1, 3)], ...(Math.random() < 0.3 ? [['stick', 1]] : [])],
  stone: () => [['stone', R(2, 3)]],
  coal: () => [['coal', R(1, 3)], ['stone', 1]],
  iron: () => [['iron_ore', R(1, 2)], ['stone', 1]],
  gold: () => [['gold_ore', R(1, 2)]],
};
// força de mineração necessária (picareta: pedra 1 · ouro 2 · metal 3)
const MINE_REQ = { stone: 1, coal: 1, iron: 2, gold: 3 };

export class Harvest {
  constructor(vegetation, { colliders, drops, effects, hud }) {
    this.veg = vegetation;
    this.colliders = colliders;
    this.drops = drops;
    this.fx = effects;
    this.hud = hud;
    this.cell = 10;
    this.grid = new Map();
    for (const r of vegetation.resources) {
      const k = this._key(Math.floor(r.x / this.cell), Math.floor(r.z / this.cell));
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(r);
    }
    this.animating = new Set();
    this.regrowing = [];
    this._v = new THREE.Vector3();
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  /** Recurso vivo mais próximo à frente (cone de ~110°) dentro do alcance. */
  findTarget(origin, forward, range) {
    const ix = Math.floor(origin.x / this.cell), iz = Math.floor(origin.z / this.cell);
    let best = null, bestD = Infinity;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = this.grid.get(this._key(ix + ox, iz + oz));
        if (!list) continue;
        for (const r of list) {
          if (r.state !== 'alive') continue;
          const dx = r.x - origin.x, dz = r.z - origin.z;
          const d = Math.hypot(dx, dz) - r.radius;
          if (d > range) continue;
          if (d > 0.3 && (dx * forward.x + dz * forward.z) / Math.hypot(dx, dz) < 0.55) continue;
          if (d < bestD) { bestD = d; best = r; }
        }
      }
    }
    return best;
  }

  /**
   * Aplica um golpe com a ferramenta.
   * @param {string} tool 'hand' | 'axe' | 'sword' | 'pickaxe'
   * @returns {'hit'|'broken'|'wrongTool'}
   */
  /**
   * @param {object|null} def item na mão (Items.js): usa chop / mine / tier
   */
  hit(res, tool, fromDir, def = null) {
    const at = new THREE.Vector3(res.x, res.y + (res.type === 'bush' ? 0.6 : 1.2), res.z);
    let dmg;
    if (res.type === 'bush') {
      dmg = 99;                                   // arbusto: qualquer golpe colhe
      this.fx.chips(at);
    } else if (res.type === 'tree') {
      dmg = tool === 'axe' ? def.chop : 1;
      this.fx.chips(at);
    } else {
      if (tool !== 'pickaxe') { this.hud.toast('Você precisa de uma picareta para minerar.', 1.5); return 'wrongTool'; }
      const need = MINE_REQ[res.kind] || 1, power = def?.mine || 1;
      // ouro com picareta de ouro: funciona, mas devagar (menor eficiência em minério duro)
      if (power < need && !(res.kind === 'gold' && power === 2)) { this.hud.toast('Precisa de uma picareta melhor para este minério.', 1.5); return 'wrongTool'; }
      dmg = [2, 3.5, 6][power - 1] * (power < need ? 0.6 : 1);
      this.fx.dust(at);
    }
    res.hp -= dmg;
    res.shake = 0.25;
    this.animating.add(res);

    if (res.hp <= 0) {
      res.state = 'falling';
      res.anim = 0;
      res.fallDir = Math.atan2(fromDir.x, fromDir.z);
      if (res.type === 'tree') {
        res.maxTilt = this._fallLimit(res);
        res.tilt = 0.015; res.omega = 0; res.impactT = -1; res.bounces = 0;
        this.fx.dustCloud?.(new THREE.Vector3(res.x, res.y + 0.3, res.z), 4, { spread: 0.5, size: 0.8, life: 1.6, tint: 0x8a6e4e });
      }
      this.colliders.removeCircle(res.collider);
      for (const [id, n] of DROPS[res.kind]()) this.drops.spawn(id, n, at);
      return 'broken';
    }
    return 'hit';
  }

  update(dt) {
    for (const r of this.animating) {
      r.anim += dt;
      if (r.state === 'alive') {
        // Tremida após o golpe
        r.shake = Math.max(0, r.shake - dt);
        this.veg.writeResource(r, 1, 0, 0, r.shake * 0.15);
        if (r.shake <= 0) this.animating.delete(r);
      } else if (r.state === 'falling') {
        if (r.type === 'tree') this._updateFall(r, dt);
        else {
          const shrink = Math.max(0, 1 - r.anim / 0.3);
          this.veg.writeResource(r, shrink);
          if (r.anim > 0.3) this._hide(r, RC.rockRegrow);
        }
      } else if (r.state === 'growing') {
        const k = Math.min(1, r.anim / 2);
        this.veg.writeResource(r, k);
        if (k >= 1) {
          r.state = 'alive'; r.hp = r.maxHp;
          r.collider = this.colliders.addCircle(r.x, r.z, r.radius);
          this.animating.delete(r);
        }
      }
    }

    // Rebrota
    for (let i = this.regrowing.length - 1; i >= 0; i--) {
      const r = this.regrowing[i];
      r.timer -= dt;
      if (r.timer <= 0) {
        this.regrowing.splice(i, 1);
        r.state = 'growing'; r.anim = 0;
        this.animating.add(r);
      }
    }
  }

  /** Pontos do eixo da árvore [distância da base, folga até o chão] (escala 1). */
  _axisPoints(r) {
    return r.kind === 'pine'
      ? [[1, 0.25], [2.5, 0.3], [3.8, 0.35], [4.6, 1.3], [6.2, 1.1], [7.6, 1.0], [9.2, 0.8], [10.6, 0.6], [12.4, 0.25]]
      : [[1, 0.25], [2.5, 0.3], [3.8, 0.35], [4.8, 1.2], [5.8, 1.5], [7.0, 1.2], [8.2, 0.6]];
  }

  /**
   * Maior ângulo de queda antes de qualquer parte da árvore encostar no terreno
   * (amostra o chão ao longo da direção de queda, então funciona em ladeira).
   */
  _fallLimit(r) {
    const t = this.veg.terrain, s = r.s, base = r.y - 0.2;
    const dx = Math.sin(r.fallDir), dz = Math.cos(r.fallDir);
    const pts = this._axisPoints(r);
    let ok = 0;
    for (let a = 0.02; a <= 1.9; a += 0.02) {
      const sa = Math.sin(a), ca = Math.cos(a);
      let hit = false;
      for (const [L0, c0] of pts) {
        const L = L0 * s, c = c0 * s;
        const x = r.x + dx * L * sa, z = r.z + dz * L * sa;
        if (base + L * ca < t.getHeight(x, z) + c) { hit = true; break; }
      }
      if (hit) break;
      ok = a;
    }
    return Math.max(0.05, ok);
  }

  /** Ponto do eixo da árvore a uma distância L (m) da base, na inclinação atual. */
  _axisAt(r, L, out = this._v) {
    const sa = Math.sin(r.tilt), ca = Math.cos(r.tilt);
    return out.set(r.x + Math.sin(r.fallDir) * L * sa, r.y - 0.2 + L * ca, r.z + Math.cos(r.fallDir) * L * sa);
  }

  /** Queda com gravidade → impacto (quique + pó) → se desfaz em pó. */
  _updateFall(r, dt) {
    const s = r.s, len = (r.kind === 'pine' ? 12 : 8) * s;
    if (r.impactT < 0 || r.bounces < 3) {
      // pêndulo invertido: acelera conforme inclina
      r.omega += (2.4 / Math.max(0.6, s)) * Math.sin(r.tilt + 0.04) * dt;
      r.tilt += r.omega * dt;
      if (r.tilt >= r.maxTilt) {
        r.tilt = r.maxTilt;
        if (r.impactT < 0) {
          r.impactT = 0;
          // impacto: pó ao longo do tronco e da copa, folhas soltas
          for (let L = 1.5; L <= len; L += 1.4) {
            this._axisAt(r, L);
            this.fx.dustCloud?.(this._v, 3, { spread: 1.1 * s, size: 1.5 * s, life: 3.0, tint: 0xb3a183, speed: 2.2 });
          }
          this._axisAt(r, len * 0.7);
          this.fx.burst('leaf', this._v, 14, { speed: 4, up: 3, size: 0.09, life: 1.6, grow: 0, gravity: 0.25 });
          this.fx.chips(this._axisAt(r, 0.6));
          this.onImpact?.(this._axisAt(r, len * 0.5).clone(), s);
        }
        r.omega = Math.abs(r.omega) > 0.25 ? -r.omega * 0.22 : 0;   // quique pequeno
        r.bounces++;
        if (r.omega === 0) r.bounces = 3;
      }
      if (r.impactT >= 0) r.impactT += dt;
      this.veg.writeResource(r, 1, r.tilt, r.fallDir);
      return;
    }
    // deitada: depois de um instante, vira pó (encolhe soltando poeira)
    r.impactT += dt;
    const DUST_START = 0.9, DUST_DUR = 1.4;
    const k = Math.max(0, (r.impactT - DUST_START) / DUST_DUR);
    if (k > 0) {
      r.dustAcc = (r.dustAcc || 0) + dt;
      while (r.dustAcc > 0.07) {
        r.dustAcc -= 0.07;
        const L = Math.random() * len * (1 - k * 0.8);
        this._axisAt(r, L);
        this.fx.dustCloud?.(this._v, 1, { spread: 0.9 * s, size: 1.1 * s, life: 2.2, tint: 0xa8977a, speed: 0.8, rise: 0.7 });
      }
    }
    const shrink = 1 - Math.min(1, k) ** 1.5;
    this.veg.writeResource(r, Math.max(0.001, shrink), r.tilt, r.fallDir);
    if (k >= 1) this._hide(r, RC.treeRegrow);
  }

  _hide(r, regrow) {
    this.veg.writeResource(r, 0);
    r.state = 'gone';
    r.timer = regrow;
    this.animating.delete(r);
    this.regrowing.push(r);
  }
}
