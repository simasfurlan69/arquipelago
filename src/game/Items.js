/**
 * Items.js
 * Banco de dados de itens.
 *
 * Campos:
 *   name, category  tool | weapon | ranged | ammo | material | food | drink | special | relic | currency
 *   icon            PNG base em assets/icons (silhueta branca) · tint = cor aplicada no ícone
 *   tool            tipo usado pela mecânica: pickaxe | axe | dagger | sword | bow | pistol | rifle
 *   tier            1 pedra · 2 ouro · 3 metal
 *   damage, durability, cooldown, range, mine (força de mineração), chop, crit (chance extra)
 *   mag, ammo, fireRate, reload, maxRange   (armas de fogo)
 *   food (fome 0–100), stamina, buff { speed, time, infiniteStamina, hungerAfter }
 *   stack, craftable, buyPrice, sellPrice, unique (só 1 por inventário), biome (relíquias)
 *   grip            pega na mão: { hand, pos[x,y,z], rot[x,y,z], scale } no RightHandSocket
 */

// ---- cores dos tiers (ícone e modelo 3D) ----
export const TIER = {
  1: { key: 'stone', name: 'Pedra', tint: '#8A8A8A', durability: 50, mat: { color: 0x7d7a74, metalness: 0, roughness: 0.95 } },
  2: { key: 'gold', name: 'Ouro', tint: '#FFD700', durability: 120, mat: { color: 0xffd23a, metalness: 0.9, roughness: 0.25 } },
  3: { key: 'metal', name: 'Metal', tint: '#B0C4DE', durability: 300, mat: { color: 0xb0c4de, metalness: 0.85, roughness: 0.3 } },
};

// Dano por tier (tabela do balanceamento)
const DMG = {
  pickaxe: [4, 8, 15], axe: [6, 12, 20], dagger: [8, 16, 25], sword: [10, 20, 30],
};
const USE = {
  pickaxe: 'Mineração', axe: 'Corte de madeira', dagger: 'Ataque corpo a corpo rápido', sword: 'Combate corpo a corpo',
};
const ICON = { pickaxe: 'picareta', axe: 'machado', dagger: 'adaga', sword: 'espada' };
const NAME = { pickaxe: 'Picareta', axe: 'Machado', dagger: 'Adaga', sword: 'Espada' };
const NOTES = {
  pickaxe: ['Mineração básica (pedra e minérios fracos)', 'Mineração rápida (menor eficiência em minérios duros)', 'Mineração pesada (todos os minérios)'],
  axe: ['Corte de madeira básica', 'Corte de madeira rápido', 'Corte de madeira pesada'],
  dagger: ['Ataque corpo a corpo rápido', 'Ataque rápido com bônus de crítico', 'Ataque corpo a corpo letal e rápido'],
  sword: ['Combate corpo a corpo padrão', 'Combate corpo a corpo intermediário', 'Combate corpo a corpo avançado'],
};
// ritmo e alcance por tipo
const BASE = {
  pickaxe: { cooldown: 0.7, range: 2.4 },
  axe: { cooldown: 0.75, range: 2.4 },
  dagger: { cooldown: 0.28, range: 2.0 },
  sword: { cooldown: 0.45, range: 2.9 },
};
// pega na mão (no RightHandSocket: +Y = sai pelo topo do punho, +Z = para frente)
// rot.x negativo inclina a lâmina para cima (afasta dos dedos): postura de prontidão
const GRIP = {
  pickaxe: { pos: [0, -0.1, 0], rot: [-0.35, 0, 0], scale: 1 },
  axe: { pos: [0, -0.1, 0], rot: [-0.35, 0, 0], scale: 1 },
  dagger: { pos: [0, 0, 0], rot: [-0.2, 0, 0], scale: 1 },
  sword: { pos: [0, -0.03, 0], rot: [-0.45, 0, 0], scale: 1 },
};

export const ITEMS = {};

for (const tool of ['pickaxe', 'axe', 'dagger', 'sword']) {
  for (const t of [1, 2, 3]) {
    const T = TIER[t];
    ITEMS[`${tool}_${T.key}`] = {
      name: `${NAME[tool]} de ${T.name}`, category: tool === 'pickaxe' || tool === 'axe' ? 'tool' : 'weapon',
      icon: ICON[tool], tint: T.tint, tool, tier: t, stack: 1,
      damage: DMG[tool][t - 1], durability: T.durability, ...BASE[tool],
      mine: tool === 'pickaxe' ? t : 0,
      chop: tool === 'axe' ? [2.5, 4, 6][t - 1] : 1,
      crit: tool === 'dagger' ? [0.1, 0.25, 0.2][t - 1] : 0,
      note: NOTES[tool][t - 1], use: USE[tool], craftable: true,
      sellPrice: [2, 15, 30][t - 1], grip: GRIP[tool],
    };
  }
}

Object.assign(ITEMS, {
  // ---------------- À distância (só compra) ----------------
  bow: { name: 'Arco', category: 'ranged', icon: 'arco', tint: '#C89A64', tool: 'bow', stack: 1, damage: 12, durability: 100, ammo: 'arrow', craftable: false, buyPrice: 40, sellPrice: 15, note: 'Segure para puxar; tiro na cabeça = crítico', grip: { hand: 'L', pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 } },
  pistol: { name: 'Pistola', category: 'ranged', icon: 'pistola', tint: '#9AA4AE', tool: 'pistol', stack: 1, damage: 22, durability: 250, mag: 16, ammo: 'ammo_pistol', fireRate: 0.22, reload: 1.4, maxRange: 120, craftable: false, buyPrice: 150, sellPrice: 60, note: 'Pente de 16 balas · R recarrega', grip: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 } },
  rifle: { name: 'Rifle', category: 'ranged', icon: 'rifle', tint: '#8E9AA6', tool: 'rifle', stack: 1, damage: 45, durability: 400, mag: 20, ammo: 'ammo_rifle', fireRate: 0.9, reload: 2.2, maxRange: 250, craftable: false, buyPrice: 350, sellPrice: 140, note: 'Pente de 20 balas · mira com zoom · R recarrega', grip: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 } },

  // ---------------- Munição ----------------
  arrow: { name: 'Flecha', category: 'ammo', icon: 'flecha', tint: '#E8D2A8', stack: 64, bonusDamage: 3, craftable: false, buyPrice: 0.5, sellPrice: 0.2 },
  ammo_pistol: { name: 'Munição da pistola', category: 'ammo', icon: 'municao_pistola', tint: '#D8B060', stack: 64, craftable: false, buyPrice: 1.25, sellPrice: 0.4 },
  ammo_rifle: { name: 'Munição do rifle', category: 'ammo', icon: 'municao_rifle', tint: '#D8A040', stack: 60, craftable: false, buyPrice: 2.25, sellPrice: 0.8 },
  cannonball: { name: 'Bala de canhão', category: 'ammo', emoji: '💣', color: 0x222226, stack: 64 },

  // ---------------- Materiais ----------------
  stick: { name: 'Graveto', category: 'material', icon: 'graveto', tint: '#B88A5A', stack: 64, sellPrice: 0.2, note: 'Cabos de ferramentas e flechas' },
  stone: { name: 'Pedra', category: 'material', icon: 'pedra', tint: '#9A968E', stack: 64, sellPrice: 0.2, note: 'Ferramentas de Pedra e construções' },
  gold_bar: { name: 'Barra de Ouro', category: 'material', icon: 'barra_de_ouro', tint: '#FFD700', stack: 64, sellPrice: 12, note: 'Ferramentas de Ouro e comércio' },
  metal_bar: { name: 'Barra de Metal', category: 'material', icon: 'barra_de_metal', tint: '#B0C4DE', stack: 64, sellPrice: 8, note: 'Ferramentas de Metal' },
  wood: { name: 'Madeira', category: 'material', emoji: '🪵', color: 0x7a5232, stack: 64, sellPrice: 0.3 },
  coal: { name: 'Carvão', category: 'material', emoji: '⬛', color: 0x1c1c1e, stack: 64, sellPrice: 0.5 },
  iron_ore: { name: 'Minério de ferro', category: 'material', emoji: '🔶', color: 0xb5754a, stack: 64, sellPrice: 2 },
  gold_ore: { name: 'Minério de ouro', category: 'material', emoji: '🟡', color: 0xf2c23a, stack: 64, sellPrice: 4 },
  leather: { name: 'Couro', category: 'material', emoji: '🟤', color: 0x8a5a32, stack: 64, sellPrice: 1.5 },
  feather: { name: 'Pena', category: 'material', emoji: '🪶', color: 0xf2f2f2, stack: 64, sellPrice: 0.3 },
  bone: { name: 'Osso', category: 'material', emoji: '🦴', color: 0xe8e2cc, stack: 64, sellPrice: 0.5 },
  gold_coin: { name: 'Moeda de ouro', category: 'currency', emoji: '🪙', color: 0xffd23a, stack: 999 },

  // ---------------- Comidas (fome 0–100) ----------------
  grape: { name: 'Uva', category: 'food', icon: 'uva', tint: '#9B59D0', stack: 64, food: 5, sellPrice: 0.5, note: 'Alimento leve e rápido' },
  tomato: { name: 'Tomate', category: 'food', icon: 'tomate', tint: '#E8432E', stack: 64, food: 8, sellPrice: 0.6, note: 'Alimento leve, usado em receitas' },
  cookie: { name: 'Biscoito', category: 'food', icon: 'biscoito', tint: '#D8A060', stack: 64, food: 10, buyPrice: 2, sellPrice: 0.8, note: 'Lanche rápido' },
  banana: { name: 'Banana', category: 'food', icon: 'banana', tint: '#F5D547', stack: 64, food: 15, sellPrice: 1, note: 'Alimento médio nutritivo' },
  apple: { name: 'Maçã', category: 'food', icon: 'maca', tint: '#E03A3A', stack: 64, food: 15, sellPrice: 1, note: 'Alimento médio nutritivo' },
  carrot: { name: 'Cenoura', category: 'food', icon: 'cenoura', tint: '#F08A24', stack: 64, food: 18, sellPrice: 1, note: 'Alimento médio' },
  corn: { name: 'Milho', category: 'food', icon: 'milho', tint: '#F2C94C', stack: 64, food: 20, sellPrice: 1.2, note: 'Alimento médio' },
  bread: { name: 'Pão', category: 'food', icon: 'pao', tint: '#D4A26A', stack: 64, food: 30, buyPrice: 4, sellPrice: 2, note: 'Alimento substancial' },
  cheese: { name: 'Queijo', category: 'food', icon: 'queijo', tint: '#F7C548', stack: 64, food: 35, buyPrice: 6, sellPrice: 3, note: 'Alimento denso e duradouro' },
  hamburger: { name: 'Hambúrguer', category: 'food', icon: 'hamburger', tint: '#C87A3C', stack: 32, food: 60, buyPrice: 12, sellPrice: 6, note: 'Refeição completa' },
  raw_meat: { name: 'Carne crua', category: 'food', emoji: '🥩', color: 0xc0504a, stack: 64, food: 8, sellPrice: 0.8, note: 'Asse na forja' },
  cooked_meat: { name: 'Carne assada', category: 'food', emoji: '🍖', color: 0x8a4a22, stack: 64, food: 25, sellPrice: 2 },

  // ---------------- Bebidas e especiais ----------------
  water: { name: 'Garrafa de água', category: 'drink', icon: 'garrafa_de_agua', tint: '#6EC6F0', stack: 16, food: 0, stamina: 50, buyPrice: 2, sellPrice: 0.5, note: 'Restaura +50 de fôlego' },
  coffee: { name: 'Café', category: 'drink', icon: 'cafe', tint: '#8B5A3C', stack: 16, food: 5, buff: { speed: 0.25, time: 10, label: '☕ Velocidade +25%' }, buyPrice: 5, sellPrice: 1.5, note: '+25% de velocidade por 10 s' },
  drugs: { name: 'Drogas', category: 'special', icon: 'drogas', tint: '#7FE07A', stack: 16, food: 0, buff: { speed: 0.15, time: 8, infiniteStamina: true, hungerAfter: 20, label: '⚡ Adrenalina' }, sellPrice: 60, contraband: true, note: 'Contrabando: vale muito no mercado negro' },

  // ---------------- Equipamento passivo ----------------
  lantern: { name: 'Lanterna de cinto', category: 'equip', emoji: '🏮', color: 0xffa040, stack: 1, buyPrice: 15, sellPrice: 5, note: 'Fica presa na cintura. L acende/apaga.' },

  // ---------------- Itens de missão ----------------
  ignar_ember: { name: 'Brasa de Ignar', category: 'special', emoji: '🔥', color: 0xff5010, stack: 1, note: 'O coração ainda quente do Ferreiro Caído. Bruno vai querer ver isto.' },
  runic_sword: { name: 'Espada Rúnica de Metal', category: 'weapon', icon: 'espada', tint: '#7FD8FF', tool: 'sword', tier: 3, stack: 1, damage: 36, durability: 360, cooldown: 0.45, range: 3.0, crit: 0.1, mine: 0, chop: 1, craftable: false, sellPrice: 50, note: 'Forjada por Bruno com runas: +20% de dano', grip: { pos: [0, -0.03, 0], rot: [-0.45, 0, 0], scale: 1.05 } },

  // ---------------- Armas LENDÁRIAS (1 por chefe, únicas, sem desgaste) ----------------
  // legendary: id do poder em Legendary.js · trail: cor do rastro · F = Golpe Lendário (barra de Fúria)
  legend_hammer: { name: 'Martelo das Raízes', category: 'legendary', emoji: '🔨', color: 0x6b8a3a, tool: 'sword', tier: 4, stack: 1, unique: true, damage: 40, cooldown: 0.62, range: 3.0, crit: 0.08, mine: 2, chop: 3, sellPrice: 0, legendary: 'roots', trail: 0x9be05a, boss: 'grakk', note: 'Lendário de Grakk. F: onda de raízes que atordoa. Golpe pesado gigante.' },
  legend_mistbow: { name: 'Arco da Névoa', category: 'legendary', emoji: '🏹', color: 0x9a60ff, tool: 'bow', tier: 4, stack: 1, unique: true, damage: 22, sellPrice: 0, legendary: 'mist', trail: 0xb080ff, boss: 'vesna', grip: { hand: 'L', pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }, note: 'Lendário de Vesna. Flechas teleguiadas. F: rajada de 6 flechas de névoa (sem gastar flechas).' },
  legend_gauntlet: { name: 'Manopla do Golem', category: 'legendary', emoji: '🥊', color: 0x8a8070, tool: 'sword', tier: 4, stack: 1, unique: true, damage: 34, cooldown: 0.4, range: 2.4, crit: 0.1, mine: 4, chop: 2, sellPrice: 0, legendary: 'quake', trail: 0xd8c8a0, boss: 'korrak', note: 'Lendário de Korrak. Minera qualquer pedra. F: terremoto com estacas de pedra.' },
  legend_saber: { name: 'Sabre da Afogada', category: 'legendary', emoji: '🗡️', color: 0x2a9ab0, tool: 'sword', tier: 4, stack: 1, unique: true, damage: 38, cooldown: 0.42, range: 3.0, crit: 0.15, mine: 0, chop: 1, sellPrice: 0, legendary: 'wave', trail: 0x40d8ff, boss: 'morrigan', note: 'Lendário de Morrigan. F: corte que dispara uma onda d\'água em linha.' },
  legend_trident: { name: 'Tridente das Marés', category: 'legendary', emoji: '🔱', color: 0x30c0d0, tool: 'sword', tier: 4, stack: 1, unique: true, damage: 42, cooldown: 0.5, range: 3.6, crit: 0.1, mine: 0, chop: 1, sellPrice: 0, legendary: 'tide', trail: 0x60f0ff, boss: 'ysolde', note: 'Lendário de Ysolde. Tubarões fogem de você. F: arremessa o tridente (atravessa tudo e volta).' },
  legend_dagger: { name: 'Adaga Derretida', category: 'legendary', emoji: '🔥', color: 0xff6a20, tool: 'dagger', tier: 4, stack: 1, unique: true, damage: 30, cooldown: 0.28, range: 2.4, crit: 0.25, mine: 0, chop: 1, sellPrice: 0, legendary: 'fire', trail: 0xff7a20, model: 'moltenDagger', boss: 'ignar', note: 'Lendário de Ignar. Golpes QUEIMAM. F: leque de fogo à frente.' },
  legend_frostaxe: { name: 'Machado de Gelo', category: 'legendary', emoji: '❄️', color: 0x8ad8ff, tool: 'sword', tier: 4, stack: 1, unique: true, damage: 44, cooldown: 0.58, range: 3.0, crit: 0.1, mine: 0, chop: 5, sellPrice: 0, legendary: 'frost', trail: 0x8ad8ff, model: 'frostAxe', boss: 'nimbra', note: 'Lendário de Nimbra. Golpes CONGELAM (inimigo lento). F: anel de estacas de gelo.' },
  legend_runesword: { name: 'Espada Rúnica', category: 'legendary', emoji: '⚔️', color: 0x50ff90, tool: 'sword', tier: 4, stack: 1, unique: true, damage: 50, cooldown: 0.45, range: 3.2, crit: 0.15, mine: 0, chop: 1, sellPrice: 0, legendary: 'rune', trail: 0x50ff90, model: 'runeSword', boss: 'varkhul', note: 'Lendário de Varkhul. Cada acerto cura meio coração. F: onda de runas em linha.' },

  // ---------------- Tubarões ----------------
  shark_meat: { name: 'Carne de tubarão', category: 'food', emoji: '🐟', color: 0xc8a0a0, stack: 32, food: 35, sellPrice: 3, note: 'Alimento substancial' },
  shark_tooth: { name: 'Dente de tubarão', category: 'material', emoji: '🦷', color: 0xf0ead8, stack: 64, sellPrice: 4, note: 'Afiado. Vale moedas com o Tomas.' },
  shark_fin: { name: 'Barbatana de tubarão', category: 'material', emoji: '🦈', color: 0x6a7a88, stack: 16, sellPrice: 15, note: 'Rara e valiosa no mercado.' },
  rain_journal: { name: 'Diário encharcado', category: 'special', emoji: '📓', color: 0x5a6a7a, stack: 1, note: 'Páginas sobre a Abominação da Tempestade. Leia no Diário (J).' },

  // ---------------- Relíquias (1 de cada no mundo) ----------------
  relic_cape: { name: 'Artefato Capa', category: 'relic', icon: 'artefato_capa', tint: '#7FB8E8', stack: 1, unique: true, biome: 'Ventanias / Montanhas' },
  relic_crown: { name: 'Artefato Coroa', category: 'relic', icon: 'artefato_coroa', tint: '#FFD700', stack: 1, unique: true, biome: 'Real / Ruínas Antigas' },
  relic_rib: { name: 'Artefato Costela', category: 'relic', icon: 'artefato_costela', tint: '#E8DCC0', stack: 1, unique: true, biome: 'Árido / Deserto' },
  relic_skull: { name: 'Artefato Crânio', category: 'relic', icon: 'artefato_cranio', tint: '#9AD07A', stack: 1, unique: true, biome: 'Pântano / Sombrio' },
  relic_tooth: { name: 'Artefato Dente', category: 'relic', icon: 'artefato_dente', tint: '#F0E6C8', stack: 1, unique: true, biome: 'Selva / Tribal' },
  relic_shield: { name: 'Artefato Escudo', category: 'relic', icon: 'artefato_escudo', tint: '#A8E0F0', stack: 1, unique: true, biome: 'Tundra / Gelo', grip: { hand: 'L' } },
  relic_sword: { name: 'Artefato Espada', category: 'relic', icon: 'artefato_espada', tint: '#C050FF', stack: 1, unique: true, biome: 'Vulcânico / Obsidiana' },
});

// valores padrão
for (const [id, d] of Object.entries(ITEMS)) {
  d.id = id;
  d.color ??= d.tint ? parseInt(d.tint.slice(1), 16) : 0xcccccc;
  if (d.category === 'relic') d.note = `Relíquia única · bioma: ${d.biome}`;
}

/** Ids antigos (saves anteriores) → ids novos. */
export const LEGACY = { sword: 'sword_stone', axe: 'axe_stone', pickaxe: 'pickaxe_stone', iron_ingot: 'metal_bar', gold: 'gold_ore', plank: 'stick' };

export const itemDef = (id) => ITEMS[id];
