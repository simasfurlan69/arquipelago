/**
 * Inventory.js
 * Inventário em slots: 0–8 = hotbar, 9–35 = mochila.
 * Slot = { id, count, durability? } ou null.
 * Itens empilháveis se juntam até o limite de pilha; ferramentas ocupam 1 slot
 * cada e têm durabilidade.
 */
import { ITEMS } from './Items.js';

export const HOTBAR = 9;

export class Inventory {
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
    this.selected = 0;
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }
  changed() { for (const fn of this.listeners) fn(this); }

  /** Cria um slot novo para o item (com durabilidade cheia se for ferramenta). */
  static makeStack(id, count) {
    const def = ITEMS[id];
    const s = { id, count };
    if (def.durability) s.durability = def.durability;
    if (def.mag) s.mag = 0;              // armas de fogo começam com o pente vazio
    return s;
  }

  /**
   * Adiciona itens: primeiro completa pilhas existentes, depois ocupa slots
   * vazios (hotbar primeiro). Retorna quantos sobraram (inventário cheio).
   */
  add(id, count = 1) {
    const def = ITEMS[id];
    if (!def) return count;
    // relíquias: só uma de cada
    if (def.unique) { if (this.has(id)) { this.onReject?.(`Você já possui ${def.name}.`); return count; } count = 1; }
    let left = count;
    if (def.stack > 1) {
      for (const s of this.slots) {
        if (left <= 0) break;
        if (s && s.id === id && s.count < def.stack) {
          const n = Math.min(left, def.stack - s.count);
          s.count += n; left -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, def.stack);
        this.slots[i] = Inventory.makeStack(id, n);
        left -= n;
      }
    }
    if (left !== count) this.changed();
    return left;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  has(id, n = 1) { return this.count(id) >= n; }

  /** Remove `n` unidades (de qualquer slot). Retorna false se não houver o suficiente. */
  remove(id, n = 1) {
    if (!this.has(id, n)) return false;
    let left = n;
    // Remove dos slots da mochila primeiro, preservando a hotbar
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(left, s.count);
        s.count -= k; left -= k;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  get selectedSlot() { return this.slots[this.selected]; }
  get selectedId() { return this.slots[this.selected]?.id || null; }

  select(i) {
    const n = ((i % HOTBAR) + HOTBAR) % HOTBAR;
    if (n !== this.selected) { this.selected = n; this.changed(); }
  }

  /** Consome 1 item do slot selecionado (comida). */
  consumeSelected() {
    const s = this.selectedSlot;
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  /**
   * Gasta durabilidade da ferramenta selecionada.
   * @returns {boolean} true se a ferramenta quebrou
   */
  wearSelected(amount = 1) {
    const s = this.selectedSlot;
    if (!s || s.durability == null) return false;
    s.durability -= amount;
    if (s.durability <= 0) {
      this.slots[this.selected] = null;
      this.changed();
      return true;
    }
    this.changed();
    return false;
  }

  /** Repara todas as ferramentas de um tipo (usado na forja). */
  repairAll(id) {
    let any = false;
    for (const s of this.slots) {
      if (s && s.id === id && s.durability < ITEMS[id].durability) { s.durability = ITEMS[id].durability; any = true; }
    }
    if (any) this.changed();
    return any;
  }
}
