/**
 * Quests.js
 * Motor de missões e reputação.
 *
 * Objetivos:
 *   { type: 'deliver', item, n }       entregar itens ao NPC (sai do inventário)
 *   { type: 'show', item }             mostrar um item (não é removido)
 *   { type: 'kill', target, n }        target: zombie | deer | horse | alligator | bird | pirate | ghost | any
 *   { type: 'sink', target, n }        target: pirate | ghost
 *   { type: 'craft', item, n }
 *   { type: 'visit', n }               chegar a n ilhas diferentes
 *   { type: 'boss', id }               derrotar um chefe
 * Estados: available → active → ready → done (repetíveis voltam a available após 1 dia de jogo).
 * Recompensas: { coins, items: [[id, n]], rep }.
 * Reputação por NPC: 0..∞ → níveis Desconhecido, Conhecido, Amigo, Parceiro, Lenda.
 */
import { ITEMS } from './Items.js';

export const REP_LEVELS = [
  { name: 'Desconhecido', at: 0 }, { name: 'Conhecido', at: 10 }, { name: 'Amigo', at: 35 },
  { name: 'Parceiro', at: 75 }, { name: 'Lenda', at: 140 },
];
export const repLevel = (pts) => { let i = 0; REP_LEVELS.forEach((l, k) => { if (pts >= l.at) i = k; }); return i; };

export const QUESTS = [
  // ===================== Bruno, o Ferreiro =====================
  { id: 'b_wood', giver: 'bruno', title: 'Lenha para a forja', minRep: 0,
    desc: 'A fornalha come lenha como um dragão faminto. Traga 20 madeiras.',
    obj: { type: 'deliver', item: 'wood', n: 20 }, reward: { coins: 15, items: [['pickaxe_stone', 1]], rep: 8 } },
  { id: 'b_apprentice', giver: 'bruno', title: 'Prova de aprendiz', minRep: 0,
    desc: 'Todo ferreiro começa na pedra. Fabrique uma Espada de Pedra e me mostre.',
    obj: { type: 'show', item: 'sword_stone' }, needCraft: 'sword_stone', reward: { coins: 10, rep: 10 } },
  { id: 'b_coal', giver: 'bruno', title: 'Carvão negro', minRep: 5,
    desc: 'Sem carvão não há metal. Dez pedaços dos veios escuros das encostas.',
    obj: { type: 'deliver', item: 'coal', n: 10 }, reward: { coins: 20, items: [['metal_bar', 2]], rep: 10 } },
  { id: 'b_leather', giver: 'bruno', title: 'Couro para os foles', minRep: 10,
    desc: 'Meus foles estão rasgados. Cinco couros de cervo, cavalo ou jacaré.',
    obj: { type: 'deliver', item: 'leather', n: 5 }, reward: { coins: 25, items: [['dagger_gold', 1]], rep: 12 } },
  { id: 'b_iron', giver: 'bruno', title: 'O minério certo', minRep: 20,
    desc: 'Seis minérios de ferro — os veios alaranjados. Picareta de pedra não dá conta.',
    obj: { type: 'deliver', item: 'iron_ore', n: 6 }, reward: { coins: 15, items: [['pickaxe_gold', 1]], rep: 15 } },
  { id: 'b_gold', giver: 'bruno', title: 'Ouro das montanhas', minRep: 35,
    desc: 'Lá no alto brilha o ouro. Quatro minérios e eu te pago em barras.',
    obj: { type: 'deliver', item: 'gold_ore', n: 4 }, reward: { coins: 40, items: [['gold_bar', 2]], rep: 18 } },
  { id: 'b_ember', giver: 'bruno', title: 'A forja de Ignar', minRep: 0, needBoss: 'ignar',
    desc: 'Ignar foi meu mestre antes da Maré Negra. Traga a brasa do coração dele — quero forjar algo digno de sua memória.',
    obj: { type: 'deliver', item: 'ignar_ember', n: 1 }, reward: { coins: 60, items: [['axe_metal', 1]], rep: 30, title: 'Portador da Brasa' } },
  { id: 'b_daily', giver: 'bruno', title: 'Encomenda do dia', minRep: 10, repeat: true,
    desc: 'Pedido de um cliente: preciso de material para hoje.', daily: [['stone', 15], ['metal_bar', 2], ['leather', 3], ['coal', 6], ['stick', 20]],
    obj: { type: 'deliver', item: 'stone', n: 15 }, reward: { coins: 18, rep: 4 } },

  // ===================== Mestre Heitor, Guilda =====================
  { id: 'g_zombies', giver: 'helena', title: 'Limpeza noturna', minRep: 0,
    desc: 'Os mortos rondam a vila toda noite. Derrube cinco deles.',
    obj: { type: 'kill', target: 'zombie', n: 5 }, reward: { coins: 30, items: [['hamburger', 3]], rep: 10 } },
  { id: 'g_deer', giver: 'helena', title: 'Caça para a vila', minRep: 0,
    desc: 'A despensa está vazia. Cace três cervos na ilha.',
    obj: { type: 'kill', target: 'deer', n: 3 }, reward: { coins: 20, items: [['bow', 1], ['arrow', 16]], rep: 8 } },
  { id: 'g_supplies', giver: 'helena', title: 'Provisões da Guilda', minRep: 5,
    desc: 'Nossos navegantes partem amanhã. Cinco pães e três queijos.',
    obj: { type: 'deliver', item: 'bread', n: 5, also: [['cheese', 3]] }, reward: { coins: 25, rep: 12 } },
  { id: 'g_gators', giver: 'helena', title: 'Ameaça no canal', minRep: 10,
    desc: 'Jacarés atacaram pescadores no canal. Elimine dois.',
    obj: { type: 'kill', target: 'alligator', n: 2 }, reward: { coins: 35, items: [['coffee', 2]], rep: 12 } },
  { id: 'g_sharks', giver: 'helena', title: 'Caçador de tubarões', minRep: 10,
    desc: 'Tubarões estão atacando os barcos de pesca. Abata três — do navio, com canhões, ou da beira da praia. Cuidado com o Tubarão-Rei.',
    obj: { type: 'kill', target: 'shark', n: 3 }, reward: { coins: 45, items: [['arrow', 24], ['hamburger', 2]], rep: 14 } },
  { id: 'g_map', giver: 'helena', title: 'Cartógrafo', minRep: 10,
    desc: 'O mapa da Guilda está velho. Pise em três ilhas diferentes.',
    obj: { type: 'visit', n: 3 }, reward: { coins: 40, items: [['arrow', 32]], rep: 15 } },
  { id: 'g_pirates', giver: 'helena', title: 'Piratas à vista', minRep: 20,
    desc: 'Piratas saqueiam quem se afasta da costa. Afunde dois navios.',
    obj: { type: 'sink', target: 'pirate', n: 2 }, reward: { coins: 80, items: [['cannonball', 20]], rep: 20 } },
  { id: 'g_ghost', giver: 'helena', title: 'Navios do além', minRep: 35,
    desc: 'À noite, navios fantasmas surgem na névoa. Afunde um e prove que o mar ainda é nosso.',
    obj: { type: 'sink', target: 'ghost', n: 1 }, reward: { coins: 60, items: [['pistol', 1], ['ammo_pistol', 32]], rep: 25 } },
  { id: 'g_patrol', giver: 'helena', title: 'Patrulha diária', minRep: 10, repeat: true,
    desc: 'Mantenha a ilha segura: derrote três inimigos quaisquer.',
    obj: { type: 'kill', target: 'hostile', n: 3 }, reward: { coins: 15, rep: 4 } },
  // contratos de chefe (entregues automaticamente ao derrotar o chefe; recompensa ao falar com Heitor)
  ...[['grakk', 50, [['cooked_meat', 5]]], ['vesna', 70, [['arrow', 40]]], ['korrak', 90, [['metal_bar', 4]]], ['morrigan', 120, [['cannonball', 30]]],
    ['ysolde', 150, [['rifle', 1], ['ammo_rifle', 40]]], ['ignar', 170, [['gold_bar', 4]]], ['varkhul', 300, [['gold_coin', 0]]]]
    .map(([id, coins, items]) => ({ id: `g_boss_${id}`, giver: 'helena', bounty: true, title: `Contrato: ${id[0].toUpperCase() + id.slice(1)}`, minRep: 0,
      desc: 'Recompensa da Guilda pela cabeça de um guardião corrompido.', obj: { type: 'boss', id }, reward: { coins, items, rep: 20 }, auto: true })),
];

export class Quests {
  constructor({ inventory, hud, sfx }) {
    Object.assign(this, { inv: inventory, hud, sfx });
    this.state = {};        // id → { status, progress, day }
    this.rep = { bruno: 0, helena: 0 };
    this.visited = new Set();
    this.crafted = new Set();
    this.bossesDown = new Set();
    this.titles = [];
    this.day = 1;
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }
  _changed() { for (const f of this.listeners) f(); }

  def(id) { return QUESTS.find((q) => q.id === id); }
  st(id) { return this.state[id] || (this.state[id] = { status: 'available', progress: 0 }); }

  /** Missões que o NPC pode oferecer agora. */
  offers(giver) {
    return QUESTS.filter((q) => q.giver === giver && !q.auto && this.st(q.id).status === 'available'
      && this.rep[giver] >= q.minRep && (!q.needBoss || this.bossesDown.has(q.needBoss))
      && (!q.repeat || this.st(q.id).day !== this.day));
  }
  active(giver = null) { return QUESTS.filter((q) => ['active', 'ready'].includes(this.st(q.id).status) && (!giver || q.giver === giver)); }
  ready(giver) { return this.active(giver).filter((q) => this.isReady(q)); }
  bounties() { return QUESTS.filter((q) => q.bounty && this.st(q.id).status === 'ready'); }
  locked(giver) { return QUESTS.filter((q) => q.giver === giver && !q.auto && this.st(q.id).status === 'available' && this.rep[giver] < q.minRep); }

  accept(id) {
    const q = this.def(id), s = this.st(id);
    if (q.daily) { const [item, n] = q.daily[Math.floor(Math.random() * q.daily.length)]; s.obj = { type: 'deliver', item, n }; }
    s.status = 'active'; s.progress = 0;
    this.hud.toast(`📜 Nova missão: ${q.title}`, 2.5);
    this.sfx?.quest();
    this._changed();
  }

  obj(q) { return this.st(q.id).obj || q.obj; }

  /** Progresso atual e alvo (para HUD e diálogo). */
  progress(q) {
    const o = this.obj(q), s = this.st(q.id);
    if (o.type === 'deliver') return [Math.min(this.inv.count(o.item), o.n), o.n];
    if (o.type === 'show') return [this.inv.has(o.item) && (!q.needCraft || this.crafted.has(q.needCraft)) ? 1 : 0, 1];
    if (o.type === 'visit') return [Math.min(s.progress, o.n), o.n];
    if (o.type === 'boss') return [this.bossesDown.has(o.id) ? 1 : 0, 1];
    return [Math.min(s.progress, o.n), o.n];
  }

  isReady(q) {
    const [a, b] = this.progress(q);
    if (a < b) return false;
    const o = this.obj(q);
    if (o.also) return o.also.every(([id, n]) => this.inv.count(id) >= n);
    return true;
  }

  objText(q) {
    const o = this.obj(q), [a, b] = this.progress(q);
    const names = { zombie: 'zumbis', deer: 'cervos', horse: 'cavalos', alligator: 'jacarés', bird: 'pássaros', pirate: 'navios piratas', ghost: 'navios fantasmas', hostile: 'inimigos', shark: 'tubarões' };
    let t;
    if (o.type === 'deliver') t = `${ITEMS[o.item].name} ${a}/${b}` + (o.also ? o.also.map(([id, n]) => ` · ${ITEMS[id].name} ${Math.min(this.inv.count(id), n)}/${n}`).join('') : '');
    else if (o.type === 'show') t = `Fabricar e mostrar: ${ITEMS[o.item].name}`;
    else if (o.type === 'kill') t = `Derrotar ${names[o.target]} ${a}/${b}`;
    else if (o.type === 'sink') t = `Afundar ${names[o.target]} ${a}/${b}`;
    else if (o.type === 'visit') t = `Ilhas visitadas ${a}/${b}`;
    else t = 'Derrotar o guardião';
    return t;
  }

  rewardText(q) {
    const r = q.reward;
    return [r.coins ? `🪙 ${r.coins}` : null, ...(r.items || []).filter(([, n]) => n).map(([id, n]) => `${ITEMS[id].name}${n > 1 ? ` ×${n}` : ''}`), r.rep ? `+${r.rep} reputação` : null, r.title ? `título "${r.title}"` : null].filter(Boolean).join(' · ');
  }

  /** Entrega: remove itens se necessário, dá a recompensa e sobe a reputação. */
  turnIn(id) {
    const q = this.def(id), s = this.st(id);
    if (!this.isReady(q)) return false;
    const o = this.obj(q);
    if (o.type === 'deliver') { this.inv.remove(o.item, o.n); for (const [i, n] of o.also || []) this.inv.remove(i, n); }
    const r = q.reward;
    if (r.coins) this.inv.add('gold_coin', r.coins);
    for (const [i, n] of r.items || []) if (n) { const left = this.inv.add(i, n); if (left) this.onDrop?.(i, left); }
    const before = repLevel(this.rep[q.giver]);
    this.rep[q.giver] += r.rep || 0;
    if (r.title) this.titles.push(r.title);
    s.status = q.repeat ? 'available' : 'done';
    s.day = this.day; s.progress = 0; delete s.obj;
    this.hud.toast(`✔ ${q.title} concluída! ${this.rewardText(q)}`, 4);
    this.sfx?.victory();
    const after = repLevel(this.rep[q.giver]);
    if (after > before) setTimeout(() => this.hud.toast(`⭐ Reputação com ${q.giver === 'bruno' ? 'Bruno' : 'a Guilda'}: ${REP_LEVELS[after].name}!`, 3), 1500);
    this._changed();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Eventos do mundo
  // ---------------------------------------------------------------------------
  emit(type, data = {}) {
    let touched = false;
    if (type === 'craft') this.crafted.add(data.item);
    if (type === 'visit') { if (this.visited.has(data.island)) return; this.visited.add(data.island); }
    if (type === 'boss') {
      this.bossesDown.add(data.id);
      const b = this.st(`g_boss_${data.id}`);
      if (b.status !== 'done') { b.status = 'ready'; touched = true; this.hud.toast('📜 A Guilda tem uma recompensa para você — fale com o Mestre Heitor.', 3); }
    }
    for (const q of this.active()) {
      const o = this.obj(q), s = this.st(q.id);
      const was = this.isReady(q);
      if (type === 'kill' && o.type === 'kill' && (o.target === data.target || (o.target === 'hostile' && data.hostile))) { s.progress++; touched = true; }
      if (type === 'sink' && o.type === 'sink' && o.target === data.target) { s.progress++; touched = true; }
      if (type === 'visit' && o.type === 'visit') { s.progress++; touched = true; }
      if (!was && this.isReady(q)) { this.hud.toast(`📜 ${q.title}: pronto! Volte para entregar.`, 2.5); this.sfx?.quest(); }
    }
    if (touched || type === 'inventory') this._changed();
  }

  newDay(day) { this.day = day; }

  serialize() { return { state: this.state, rep: this.rep, visited: [...this.visited], crafted: [...this.crafted], bosses: [...this.bossesDown], titles: this.titles, day: this.day }; }
  restore(d) {
    if (!d) return;
    this.state = d.state || {}; this.rep = { bruno: 0, helena: 0, ...d.rep };
    this.visited = new Set(d.visited); this.crafted = new Set(d.crafted); this.bossesDown = new Set(d.bosses);
    this.titles = d.titles || []; this.day = d.day || 1;
    this._changed();
  }
}
