/**
 * Crafting.js
 * Receitas. `station: 'forge'` exige estar perto da forja do ferreiro.
 * NÃO têm receita (só compra ou exploração): arco, pistola, rifle, flechas,
 * munições e relíquias.
 */
import { ITEMS } from './Items.js';
import { events } from './Events.js';

// Quantidade de material de cabeça por ferramenta (+ gravetos de cabo)
const TOOL_COST = { pickaxe: [3, 2], axe: [3, 2], dagger: [1, 1], sword: [2, 1] };
const TIERS = [
  { key: 'stone', mat: 'stone', station: null },
  { key: 'gold', mat: 'gold_bar', station: 'forge' },
  { key: 'metal', mat: 'metal_bar', station: 'forge' },
];

export const RECIPES = [
  // ---- Básico (qualquer lugar) ----
  { key: 'stick', out: ['stick', 4], in: { wood: 1 }, station: null, group: 'Materiais' },
];

for (const t of TIERS) {
  for (const tool of ['pickaxe', 'axe', 'dagger', 'sword']) {
    const [head, sticks] = TOOL_COST[tool];
    RECIPES.push({ key: `${tool}_${t.key}`, out: [`${tool}_${t.key}`, 1], in: { [t.mat]: head, stick: sticks }, station: t.station, group: `Ferramentas · ${ITEMS[`${tool}_${t.key}`].name.split(' de ')[1]}` });
  }
}

RECIPES.push(
  // ---- Forja: refino ----
  { key: 'gold_bar', out: ['gold_bar', 1], in: { gold_ore: 1, coal: 1 }, station: 'forge', group: 'Refino' },
  { key: 'metal_bar', out: ['metal_bar', 1], in: { iron_ore: 1, coal: 1 }, station: 'forge', group: 'Refino' },
  { key: 'cannonball', out: ['cannonball', 4], in: { metal_bar: 1, coal: 1 }, station: 'forge', group: 'Refino' },
  // ---- Forja: cozinha ----
  { key: 'cook', out: ['cooked_meat', 1], in: { raw_meat: 1, wood: 1 }, station: 'forge', group: 'Cozinha' },
  { key: 'bread', out: ['bread', 1], in: { corn: 2 }, station: 'forge', group: 'Cozinha' },
  { key: 'burger', out: ['hamburger', 1], in: { bread: 1, cooked_meat: 1, tomato: 1 }, station: 'forge', group: 'Cozinha' },
  // ---- Forja: reparo (1 barra/pedra do material restaura a durabilidade) ----
  ...TIERS.map((t) => ({ key: `fix_${t.key}`, out: [null, 0], in: { [t.mat]: 1 }, station: 'forge', repairTier: t.key, group: 'Reparo', label: `Reparar ferramentas de ${t.key === 'stone' ? 'Pedra' : t.key === 'gold' ? 'Ouro' : 'Metal'}` })),
);

export function recipeLabel(r) {
  if (r.label) return r.label;
  const [id, n] = r.out;
  return `${ITEMS[id].name}${n > 1 ? ` ×${n}` : ''}`;
}

const repairable = (inv, tierKey) => inv.slots.some((s) => s && ITEMS[s.id].durability && s.id.endsWith('_' + tierKey) && s.durability < ITEMS[s.id].durability);

export function canCraft(r, inv, atForge) {
  if (r.station === 'forge' && !atForge) return false;
  for (const id in r.in) if (!inv.has(id, r.in[id])) return false;
  if (r.repairTier) return repairable(inv, r.repairTier);
  return true;
}

/** Executa a receita. Retorna true, 'full' (sem espaço) ou false. */
export function craft(r, inv, atForge) {
  if (!canCraft(r, inv, atForge)) return false;
  for (const id in r.in) inv.remove(id, r.in[id]);
  if (r.repairTier) {
    for (const s of inv.slots) if (s && s.id.endsWith('_' + r.repairTier) && ITEMS[s.id].durability) s.durability = ITEMS[s.id].durability;
    inv.changed();
    return true;
  }
  events.emit('craft', { item: r.out[0] });
  return inv.add(r.out[0], r.out[1]) > 0 ? 'full' : true;
}
