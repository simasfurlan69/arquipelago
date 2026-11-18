/**
 * InventoryUI.js
 * Interface de sobrevivência em DOM:
 *  - mira, hotbar (9 slots, contagem e durabilidade), corações e fome;
 *  - relógio do mundo, vinheta vermelha de dano, aviso de coleta;
 *  - painel do navio (casco, vela, âncora, leme, recarga dos bordos, balas);
 *  - tela de inventário (Tab/I): 36 slots com "pilha no cursor" (clique esquerdo
 *    pega e solta tudo, clique direito pega metade ou solta 1) e lista de receitas.
 */
import { ITEMS, TIER } from '../game/Items.js';
import { setIcon, iconURL } from './IconTint.js';
import { HOTBAR } from '../game/Inventory.js';
import { RECIPES, canCraft, craft, recipeLabel } from '../game/Crafting.js';
import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);

export class InventoryUI {
  constructor({ inventory, stats, input, hud }) {
    this.inv = inventory;
    this.stats = stats;
    this.input = input;
    this.hud = hud;
    this.open = false;
    this.cursor = null;          // pilha "segurada" pelo mouse
    this.atForge = false;

    this.el = {
      hotbar: $('hotbar'), hearts: $('hearts'), hunger: $('hunger'), clock: $('clock'),
      vignette: $('vignette'), crosshair: $('crosshair'), lockhint: $('lockhint'),
      screen: $('invscreen'), grid: $('inv-grid'), gridHot: $('inv-hotbar'), recipes: $('recipes'),
      station: $('station'), cursor: $('cursor-stack'), itemName: $('item-name'),
      ship: $('shiphud'), hull: $('ship-hull'), hullText: $('ship-hull-text'), sail: $('ship-sail'),
      anchor: $('ship-anchor'), rudder: $('ship-rudder'), port: $('reload-port'), star: $('reload-star'),
      balls: $('ship-balls'), pickup: $('pickup'), death: $('death'),
    };

    // ---- Hotbar ----
    this.hotSlots = [];
    for (let i = 0; i < HOTBAR; i++) {
      const s = this._slotEl(i, false);
      this.el.hotbar.appendChild(s);
      this.hotSlots.push(s);
    }
    // ---- Corações e fome ----
    for (let i = 0; i < 10; i++) {
      this.el.hearts.insertAdjacentHTML('beforeend', '<span class="heart">❤</span>');
      this.el.hunger.insertAdjacentHTML('beforeend', '<span class="food">🍗</span>');
    }
    // ---- Tela de inventário ----
    this.invSlots = [];
    for (let i = HOTBAR; i < 36; i++) {
      const s = this._slotEl(i, true);
      this.el.grid.appendChild(s);
      this.invSlots[i] = s;
    }
    for (let i = 0; i < HOTBAR; i++) {
      const s = this._slotEl(i, true);
      this.el.gridHot.appendChild(s);
      this.invSlots[i] = s;
    }
    this.el.screen.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      this.el.cursor.style.left = `${e.clientX + 6}px`;
      this.el.cursor.style.top = `${e.clientY + 6}px`;
    });

    inventory.onChange(() => this.render());
    this._nameT = 0;
    this._lastSel = -1;
    this._pickTimer = 0;
    this.render();
  }

  _slotEl(index, clickable) {
    const d = document.createElement('div');
    d.className = 'slot';
    d.innerHTML = '<span class="icon"></span><span class="count"></span><div class="dur"><div></div></div><span class="key"></span>';
    if (index < HOTBAR && !clickable) d.querySelector('.key').textContent = index + 1;
    if (clickable) {
      d.addEventListener('mousedown', (e) => { e.preventDefault(); this._clickSlot(index, e.button); });
      d.addEventListener('mouseenter', () => this._tip(this.inv.slots[index], d));
      d.addEventListener('mouseleave', () => this._tip(null));
    }
    return d;
  }

  /** Tooltip com os atributos do item. */
  _tip(s, anchor) {
    let t = this._tipEl;
    if (!t) { t = this._tipEl = document.createElement('div'); t.id = 'itemtip'; document.body.appendChild(t); }
    if (!s) { t.style.display = 'none'; return; }
    const d = ITEMS[s.id], rows = [];
    if (d.tier) rows.push(`Tier ${d.tier} · ${TIER[d.tier].name}`);
    if (d.damage) rows.push(`⚔ Dano ${d.damage}${d.crit ? ` · crítico +${Math.round(d.crit * 100)}%` : ''}`);
    if (d.durability) rows.push(`🔧 Durabilidade ${s.durability ?? d.durability}/${d.durability}`);
    if (d.mag) rows.push(`🔫 Pente ${s.mag}/${d.mag} · munição: ${ITEMS[d.ammo].name}`);
    if (d.bonusDamage) rows.push(`+${d.bonusDamage} de dano no arco`);
    if (d.food) rows.push(`🍗 Fome +${d.food}`);
    if (d.stamina) rows.push(`💨 Fôlego +${d.stamina}`);
    if (d.buff) rows.push(`✨ ${d.buff.label} por ${d.buff.time} s`);
    if (d.craftable === false && d.buyPrice) rows.push('🛒 Só compra (Mercador)');
    if (d.category === 'relic') rows.push('🏛 Não pode ser fabricada nem comprada');
    if (d.category === 'legendary') rows.push('✨ LENDÁRIA · sem desgaste · F = golpe lendário');
    if (d.sellPrice) rows.push(`🪙 Vende por ${d.sellPrice}${d.contraband ? ' (mercado negro)' : ''}`);
    t.innerHTML = `<b>${d.name}</b>${d.note ? `<i>${d.note}</i>` : ''}${rows.map((r) => `<div>${r}</div>`).join('')}`;
    const r = anchor.getBoundingClientRect();
    t.style.display = 'block';
    t.style.left = `${Math.min(innerWidth - 260, r.right + 8)}px`;
    t.style.top = `${Math.max(8, r.top - 10)}px`;
  }

  _fillSlot(el, s) {
    const icon = el.querySelector('.icon'), count = el.querySelector('.count'), dur = el.querySelector('.dur');
    if (!s) { setIcon(icon, null); count.textContent = ''; dur.style.display = 'none'; el.classList.remove('t1', 't2', 't3', 'relic', 'legendary'); return; }
    const def = ITEMS[s.id];
    setIcon(icon, s.id);
    count.textContent = def.mag ? `${s.mag}/${def.mag}` : s.count > 1 ? s.count : '';
    el.classList.toggle('t1', def.tier === 1); el.classList.toggle('t2', def.tier === 2); el.classList.toggle('t3', def.tier === 3);
    el.classList.toggle('relic', def.category === 'relic');
    el.classList.toggle('legendary', def.category === 'legendary');
    if (def.durability && s.durability < def.durability) {
      dur.style.display = 'block';
      const k = s.durability / def.durability;
      dur.firstChild.style.width = `${k * 100}%`;
      dur.firstChild.style.background = k > 0.5 ? '#5fd35f' : k > 0.2 ? '#e8c03a' : '#e04a3a';
    } else dur.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Pilha no cursor (estilo jogos de sobrevivência)
  // ---------------------------------------------------------------------------
  _clickSlot(i, button) {
    const slots = this.inv.slots;
    const s = slots[i];
    const c = this.cursor;
    if (button === 0) {
      if (!c) { this.cursor = s; slots[i] = null; }
      else if (!s) { slots[i] = c; this.cursor = null; }
      else if (s.id === c.id && ITEMS[s.id].stack > 1) {
        const n = Math.min(c.count, ITEMS[s.id].stack - s.count);
        s.count += n; c.count -= n;
        if (c.count <= 0) this.cursor = null;
      } else { slots[i] = c; this.cursor = s; }
    } else if (button === 2) {
      if (!c && s) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { ...s, count: half };
        s.count -= half;
        if (s.count <= 0) slots[i] = null;
      } else if (c) {
        if (!s) { slots[i] = { ...c, count: 1 }; c.count--; }
        else if (s.id === c.id && s.count < ITEMS[s.id].stack) { s.count++; c.count--; }
        if (c.count <= 0) this.cursor = null;
      }
    }
    this.inv.changed();
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.input.uiOpen = this.open;
    this.el.screen.classList.toggle('hidden', !this.open);
    if (this.open) this.input.releasePointer();
    else if (this.cursor) {
      // devolve a pilha do cursor para o inventário
      const left = this.inv.add(this.cursor.id, this.cursor.count);
      this.cursor = null;
      if (left) this.hud.toast('Inventário cheio!');
    }
    this.render();
  }

  setStation(atForge) {
    if (atForge === this.atForge) return;
    this.atForge = atForge;
    if (this.open) this._renderRecipes();
  }

  _renderRecipes() {
    this.el.station.textContent = this.atForge ? '🔥 Forja próxima: receitas de metal liberadas' : 'Vá até a forja do ferreiro para receitas de metal';
    this.el.station.className = this.atForge ? 'on' : '';
    const box = this.el.recipes;
    box.innerHTML = '';
    let lastGroup = null;
    for (const r of RECIPES) {
      const ok = canCraft(r, this.inv, this.atForge);
      const b = document.createElement('button');
      b.className = `recipe${ok ? ' ok' : ''}${r.station === 'forge' ? ' forge' : ''}`;
      const ic = (id) => (iconURL(id) ? `<img src="${iconURL(id)}">` : ITEMS[id].emoji || '');
      const ins = Object.entries(r.in).map(([id, n]) => `<span class="${this.inv.has(id, n) ? 'have' : 'miss'}" title="${ITEMS[id].name}">${ic(id)}${n}</span>`).join(' ');
      if (r.group !== lastGroup) { lastGroup = r.group; box.insertAdjacentHTML('beforeend', `<div class="rgroup">${r.group}</div>`); }
      b.innerHTML = `<span class="out">${r.out[0] ? ic(r.out[0]) : '🔧'}</span><span class="rname">${recipeLabel(r)}</span><span class="ins">${ins}${r.station === 'forge' ? ' 🔥' : ''}</span>`;
      b.disabled = !ok;
      b.addEventListener('click', () => {
        const res = craft(r, this.inv, this.atForge);
        if (res === 'full') this.hud.toast('Inventário cheio! Parte do item ficou de fora.');
      });
      box.appendChild(b);
    }
  }

  render() {
    const slots = this.inv.slots;
    this.hotSlots.forEach((el, i) => {
      this._fillSlot(el, slots[i]);
      el.classList.toggle('sel', i === this.inv.selected);
    });
    if (this.open) {
      this.invSlots.forEach((el, i) => this._fillSlot(el, slots[i]));
      this._renderRecipes();
      const c = this.cursor;
      this.el.cursor.innerHTML = c ? `${iconURL(c.id) ? `<img src="${iconURL(c.id)}">` : ITEMS[c.id].emoji || ''}${c.count > 1 ? `<span>${c.count}</span>` : ''}` : '';
    } else this.el.cursor.innerHTML = '';

    if (this.inv.selected !== this._lastSel) {
      this._lastSel = this.inv.selected;
      const s = slots[this.inv.selected];
      this.el.itemName.textContent = s ? `${ITEMS[s.id].name}${ITEMS[s.id].damage ? ` · dano ${ITEMS[s.id].damage}` : ''}` : '';
      this._nameT = 1.6;
    }
  }

  pickup(id, n) {
    this.el.pickup.innerHTML = `+${n} ${iconURL(id) ? `<img src="${iconURL(id)}">` : ITEMS[id].emoji || ''} ${ITEMS[id].name}`;
    this.el.pickup.classList.remove('hidden');
    this._pickTimer = 1.6;
  }

  flashDamage() {
    this.el.vignette.classList.remove('hit');
    void this.el.vignette.offsetWidth;          // reinicia a animação CSS
    this.el.vignette.classList.add('hit');
  }

  showDeath(on) { this.el.death.classList.toggle('hidden', !on); }

  /**
   * Atualiza o HUD por frame (valores que mudam continuamente).
   * @param {object} o { clock, day, isNight, locked, boat }
   */
  update(dt, { clock, day, isNight, locked, boat }) {
    const st = this.stats, S = CONFIG.survival;
    // Corações (meio coração = 1 de vida)
    const hearts = this.el.hearts.children, food = this.el.hunger.children;
    for (let i = 0; i < 10; i++) {
      const hv = st.health - i * 2;
      hearts[i].className = `heart ${hv >= 2 ? 'full' : hv >= 1 ? 'half' : 'empty'}`;
      const fv = st.hunger / 5 - i * 2;          // fome 0–100 → 10 ícones
      food[i].className = `food ${fv >= 1.5 ? 'full' : fv >= 0.5 ? 'half' : 'empty'}`;
    }
    this.el.hearts.classList.toggle('low', st.health <= 6);
    this.el.clock.textContent = `${isNight ? '🌙' : '☀️'} Dia ${day} · ${clock}`;
    this.el.crosshair.classList.toggle('hidden', !locked || this.open);
    this.el.lockhint.classList.toggle('hidden', locked || this.open);

    if (this._nameT > 0) {
      this._nameT -= dt;
      this.el.itemName.style.opacity = Math.min(1, this._nameT * 2);
    }
    if (this._pickTimer > 0) {
      this._pickTimer -= dt;
      if (this._pickTimer <= 0) this.el.pickup.classList.add('hidden');
    }

    // ---- Painel do navio ----
    const showShip = !!boat;
    this.el.ship.classList.toggle('hidden', !showShip);
    if (showShip) {
      const k = boat.hull / boat.hullMax;
      this.el.hull.style.width = `${k * 100}%`;
      this.el.hull.style.background = k > 0.5 ? '#5fd35f' : k > 0.25 ? '#e8c03a' : '#e04a3a';
      this.el.hullText.textContent = `${Math.ceil(boat.hull)}/${boat.hullMax}`;
      this.el.sail.textContent = boat.sailName;
      this.el.anchor.textContent = boat.anchored ? '⚓ Ancorado' : '⚓ Livre';
      this.el.anchor.className = boat.anchored ? 'on' : '';
      this.el.rudder.textContent = boat.rudderLocked ? '🔒 Leme travado' : 'Leme livre';
      const c = boat.cannons;
      if (c) {
        this.el.port.style.width = `${(1 - c.reload.port / c.reloadTime) * 100}%`;
        this.el.star.style.width = `${(1 - c.reload.star / c.reloadTime) * 100}%`;
      }
      this.el.balls.textContent = `💣 ${this.inv.count('cannonball')}`;
    }
  }
}
