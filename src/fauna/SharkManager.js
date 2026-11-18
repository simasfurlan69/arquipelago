/**
 * SharkManager.js
 * Cria e remove tubarões em volta do jogador (no máx. 14 vivos):
 *   - perto da costa (≤ 120 m da praia): cardumes de tubarões-de-recife e tigres
 *   - mar aberto: tubarões-brancos
 *   - águas da Ilha das Chuvas Eternas, à noite ou com chuva forte: 1 Tubarão-Rei
 * Acima de 250 m a animação para; acima de 420 m o tubarão é removido.
 * Drops: entram direto no inventário se o jogador estiver a até 40 m (senão, perdidos).
 */
import * as THREE from 'three/webgpu';
import { Shark, SHARK_KINDS, loadSharkModel } from './Shark.js';
import { ITEMS } from '../game/Items.js';

const MAX = 14;

export class SharkManager {
  /**
   * @param {THREE.Scene} scene
   * @param {object} ctx worldCtx (terrain, ocean, combat, effects, shoreDist, hud, inventory, difficulty, shake)
   */
  constructor(scene, ctx, { rainIsland, sfx } = {}) {
    this.scene = scene; this.ctx = ctx; this.rainIsland = rainIsland; this.sfx = sfx;
    this.list = [];
    this.spawnT = 2;
    this.enabled = true;
    loadSharkModel();   // começa a baixar já
  }

  get alive() { return this.list.filter((s) => s.alive).length; }

  spawn(kind, x, z) {
    const s = new Shark(this, kind, x, z);
    this.list.push(s);
    return s;
  }

  /** Para testes: cria um tubarão na água funda mais próxima, a `dist` m. */
  spawnNear(kind, center, dist = 25) {
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2, r = dist * (0.8 + Math.random() * 0.4);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (this.ctx.terrain.getHeight(x, z) < -SHARK_KINDS[kind].minDepth - 0.5) return this.spawn(kind, x, z);
    }
    return null;
  }

  remove(s) {
    s.dispose();
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
  }

  onKilled(s) {
    const inv = this.ctx.inventory, p = this.ctx.player.getWorldPosition(new THREE.Vector3());
    const d = Math.hypot(p.x - s.pos.x, p.z - s.pos.z);
    this.ctx.hud?.toast(`🦈 ${s.def.name} abatido!`, 1.5);
    if (d < 40 && inv) {
      const got = [];
      for (const [id, n] of s.def.drops) { inv.add(id, n); got.push(`${n} ${ITEMS[id]?.name || id}`); }
      this.ctx.hud?.toast(`+ ${got.join(', ')}`, 2.2);
    }
  }

  _pickKind(x, z, rain, night) {
    const sd = this.ctx.shoreDist.at(x, z);
    const ri = this.rainIsland;
    const nearRain = ri && Math.hypot(x - ri.cx, z - ri.cz) < ri.radius + 400;
    if (nearRain && (night || rain > 0.5) && !this.list.some((s) => s.alive && s.kind === 'king') && Math.random() < 0.35) return 'king';
    if (sd > 160) return Math.random() < 0.7 ? 'white' : 'tiger';
    return Math.random() < 0.6 ? 'reef' : 'tiger';
  }

  /**
   * @param {object} o { player, boat, onBoat, focus (Vector3), rain, night }
   */
  update(dt, o) {
    const focus = o.focus;
    const inv = this.ctx.inventory;
    const pp = o.player.getWorldPosition(this._pp ??= new THREE.Vector3());
    // jogador na água: profundidade acima do joelho
    const water = this.ctx.ocean.getWaveHeight(pp.x, pp.z);
    const playerInWater = !o.onBoat && water - this.ctx.terrain.getHeight(pp.x, pp.z) > 0.45 && pp.y < water + 0.3;
    const s = { player: o.player, boat: o.boat, onBoat: o.onBoat, trident: inv?.has('legend_trident'), playerInWater, near: true, pp };

    for (let i = this.list.length - 1; i >= 0; i--) {
      const sh = this.list[i];
      const d = Math.hypot(sh.pos.x - focus.x, sh.pos.z - focus.z);
      if (d > 420 && sh.state !== 'dead') { this.remove(sh); continue; }
      s.near = d < 250;
      sh.update(dt, s);
    }

    // ---- novos tubarões ----
    if (!this.enabled) return;
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.alive >= MAX) return;
    this.spawnT = 4 + Math.random() * 6;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 130;
      const x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
      const kind = this._pickKind(x, z, o.rain || 0, o.night);
      if (this.ctx.terrain.getHeight(x, z) > -SHARK_KINDS[kind].minDepth - 1) continue;
      // tubarões só aparecem em água que o jogador pode alcançar (perto de alguma costa ou do navio)
      if (kind === 'reef') { const n = 2 + Math.floor(Math.random() * 3); for (let k = 0; k < n && this.alive < MAX; k++) this.spawn('reef', x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6); }
      else this.spawn(kind, x, z);
      break;
    }
  }
}
