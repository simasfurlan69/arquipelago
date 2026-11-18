/**
 * ShopUI.js
 * Janela de compra e venda. Moeda: Moeda de ouro (gold_coin).
 * Preços de compra vêm de ITEMS[id].buyPrice × quantidade do lote (× multiplicador
 * do mercador). Venda: ITEMS[id].sellPrice por unidade (contrabando só com o
 * Contrabandista).
 */
import { ITEMS } from '../game/Items.js';
import { iconURL } from './IconTint.js';

export class ShopUI {
  constructor({ inventory, input, hud, sfx }) {
    Object.assign(this, { inv: inventory, input, hud, sfx });
    this.el = document.createElement('div');
    this.el.id = 'shop';
    this.el.className = 'hidden';
    document.getElementById('hud').appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.buy) this.buy(+b.dataset.buy);
      if (b.dataset.sell) this.sell(b.dataset.sell, e.shiftKey);
      if (b.dataset.tab) { this.tab = b.dataset.tab; this.render(); }
      if (b.dataset.close) this.close();
    });
    inventory.onChange(() => this.open && this.render());
    this.tab = 'buy';
  }

  get coins() { return this.inv.count('gold_coin'); }
  price(id, n, i) {
    const e = this.m.shop.sells[i];
    const base = e && e[2] != null ? e[2] : ITEMS[id].buyPrice * n;
    return Math.max(1, Math.round(base * (this.m.shop.priceMult || 1) * (this.m.shop.discount?.() || 1)));
  }
  _locked(i) { const e = this.m.shop.sells[i]; return e && e[3] != null && this.m.shop.repOf && this.m.shop.repOf() < e[3]; }

  openFor(merchant) {
    this.m = merchant;
    this.open = true;
    this.tab = 'buy';
    this.el.classList.remove('hidden');
    this.input.uiOpen = true;
    this.input.releasePointer();
    this.render();
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
    this.input.uiOpen = false;
  }

  buy(i) {
    const [id, n] = this.m.shop.sells[i];
    if (this._locked(i)) { this.hud.toast('Precisa de mais reputação para este item.', 1.5); return; }
    const cost = this.price(id, n, i);
    if (this.coins < cost) { this.hud.toast('Moedas insuficientes.', 1.2); return; }
    if (ITEMS[id].stack === 1 && !this.inv.slots.some((s) => !s)) { this.hud.toast('Inventário cheio!', 1.2); return; }
    this.inv.remove('gold_coin', cost);
    const left = this.inv.add(id, n);
    if (left) this.inv.add('gold_coin', Math.round(cost * left / n));
    this.sfx?.craft();
  }

  sell(id, all) {
    const d = ITEMS[id];
    const n = all ? this.inv.count(id) : 1;
    if (!n) return;
    let unit = d.sellPrice;
    if (d.contraband && !this.m.shop.buysContraband) { this.hud.toast(`${this.m.name}: "Não mexo com isso. Procure alguém no cais à noite..."`, 2.5); return; }
    const value = unit * n;
    if (value < 1 && !all) { this.hud.toast('Vale menos de 1 moeda — venda em lote (Shift+clique).', 1.8); return; }
    this.inv.remove(id, n);
    this.inv.add('gold_coin', Math.max(1, Math.floor(value)));
    this.sfx?.pickup();
  }

  render() {
    const ic = (id) => (iconURL(id) ? `<img src="${iconURL(id)}">` : `<span class="em">${ITEMS[id].emoji || ''}</span>`);
    const s = this.m.shop;
    let body;
    if (this.tab === 'buy') {
      body = s.sells.map(([id, n], i) => {
        const p = this.price(id, n, i), d = ITEMS[id], lk = this._locked(i);
        const stat = d.damage ? `dano ${d.damage}${d.durability ? ` · durab. ${d.durability}` : ''}${d.mag ? ` · pente ${d.mag}` : ''}` : d.food ? `fome +${d.food}` : d.stamina ? `fôlego +${d.stamina}` : d.buff ? d.buff.label : '';
        return `<div class="shop-row">${ic(id)}<div class="sn"><b>${d.name}${n > 1 ? ` ×${n}` : ''}</b><small>${stat}</small></div>${lk ? `<button disabled>🔒 ${s.lockLabel(s.sells[i][3])}</button>` : `<button data-buy="${i}" ${this.coins < p ? 'disabled' : ''}>🪙 ${p}</button>`}</div>`;
      }).join('');
    } else {
      const ids = [...new Set(this.inv.slots.filter((x) => x && ITEMS[x.id].sellPrice).map((x) => x.id))];
      body = ids.length ? ids.map((id) => {
        const d = ITEMS[id], c = this.inv.count(id), blocked = d.contraband && !s.buysContraband;
        return `<div class="shop-row ${blocked ? 'blocked' : ''}">${ic(id)}<div class="sn"><b>${d.name} ×${c}</b><small>${blocked ? 'só no mercado negro' : `🪙 ${d.sellPrice} cada`}</small></div><button data-sell="${id}">Vender</button></div>`;
      }).join('') + '<p class="tip">Shift+clique em "Vender" vende o lote inteiro.</p>' : '<p class="tip">Nada para vender.</p>';
    }
    this.el.innerHTML = `
      <div class="shop-panel">
        <div class="shop-head"><h2>${this.m.name}</h2><span class="coins">🪙 ${this.coins}</span><button data-close="1">✕</button></div>
        <p class="greet">"${s.greeting}"</p>
        <div class="tabs"><button class="tab ${this.tab === 'buy' ? 'on' : ''}" data-tab="buy">Comprar</button><button class="tab ${this.tab === 'sell' ? 'on' : ''}" data-tab="sell">Vender</button></div>
        <div class="shop-list">${body}</div>
      </div>`;
  }
}
