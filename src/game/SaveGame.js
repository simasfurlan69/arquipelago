/**
 * SaveGame.js
 * Salva e carrega o progresso no navegador (localStorage):
 * inventário, vida/fome/fôlego, hora do dia, navio, história (selos, missão) e posição.
 */
import { ITEMS, LEGACY } from './Items.js';

const KEY = 'arquipelago.save.v1';

export class SaveGame {
  constructor(game) { this.g = game; }

  get exists() { return !!localStorage.getItem(KEY); }

  save() {
    const g = this.g;
    const p = g.player.position;
    const data = {
      t: Date.now(), v2: true,
      inventory: g.inventory.slots,
      selected: g.inventory.selected,
      stats: { health: g.stats.health, hunger: g.stats.hunger, stamina: g.stats.stamina },
      day: { t: g.dayNight.t, day: g.dayNight.day },
      boat: { built: g.boat.built, hull: g.boat.hull, x: g.boat.root.position.x, z: g.boat.root.position.z, heading: g.boat.heading },
      player: { x: p.x, z: p.z, onBoat: g.player.state === 'boat' },
      story: g.story?.serialize(),
      quests: g.quests?.serialize(), memo: g.dctx?.memo,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return data;
  }

  load() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const d = JSON.parse(raw), g = this.g;
    // migra ids de versões antigas (espada → espada de pedra, lingote → barra de metal…)
    g.inventory.slots = d.inventory.map((s) => {
      if (!s) return null;
      const id = LEGACY[s.id] || s.id;
      if (!ITEMS[id]) return null;
      const n = { ...s, id };
      if (ITEMS[id].durability) n.durability = Math.min(n.durability ?? ITEMS[id].durability, ITEMS[id].durability);
      return n;
    });
    if (d.stats && d.stats.hunger <= 20 && !d.v2) d.stats.hunger *= 5;     // fome antiga (0–20) → 0–100
    g.inventory.selected = d.selected || 0;
    g.inventory.changed();
    Object.assign(g.stats, d.stats);
    g.dayNight.t = d.day.t; g.dayNight.day = d.day.day;
    if (d.boat?.built) {
      g.builder.start(); g.builder.progress = 0.999; g.builder.update(0.1, 0, g.builder.zonePos);
      g.boat.placeAt(d.boat.x, d.boat.z, d.boat.heading);
      g.boat.hull = d.boat.hull;
    }
    if (d.story) g.story?.restore(d.story);
    if (d.quests) g.quests?.restore(d.quests);
    if (d.memo && g.dctx) Object.assign(g.dctx.memo, d.memo);
    if (d.player.onBoat && g.boat.built) g.board();
    else g.player.spawnAt(d.player.x, d.player.z);
    return true;
  }

  clear() { localStorage.removeItem(KEY); }
}
