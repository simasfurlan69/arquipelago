/**
 * config.js
 * Constantes centrais do jogo. Ajuste aqui para mudar o tamanho do mundo,
 * a física, a câmera e as flags de qualidade, sem mexer na lógica.
 */
export const CONFIG = {
  seed: 1337,

  // ---------------- Mundo ----------------
  world: {
    seaLevel: 0,
    oceanFloor: -55,
    mainIsland: { x: 0, z: 0, radius: 380, size: 1200, segments: 340 },
    secondaryIslands: 9,          // quantidade de ilhas extras
    islandRingMin: 750,           // distância mínima ao centro
    islandRingMax: 1900,          // distância máxima ao centro
    // Canal navegável: pontos de controle (x, z) do mar aberto até o interior
    canal: [
      [640, 40], [470, -10], [340, 30], [230, -5], [130, 25], [55, 15],
    ],
    canalHalfWidth: 16,           // largura de fundo plano (m)
    canalDepth: -6,
    lagoon: { x: 40, z: 20, radius: 48 },   // lago no fim do canal
    village: { x: 190, z: 105, radius: 85, height: 3.5 },
  },

  // ---------------- Oceano ----------------
  ocean: {
    size: 2600,
    segments: 260,
    // Ondas de Gerstner: direção (x,z), comprimento de onda (m), amplitude (m), steepness
    waves: [
      { dir: [1.0, 0.3],  length: 62, amp: 0.55, steep: 0.35 },
      { dir: [0.6, 1.0],  length: 37, amp: 0.30, steep: 0.30 },
      { dir: [-0.4, 0.9], length: 21, amp: 0.16, steep: 0.25 },
      { dir: [0.9, -0.6], length: 13, amp: 0.08, steep: 0.20 },
    ],
  },

  // ---------------- Jogador ----------------
  player: {
    walkSpeed: 3.2,
    runSpeed: 7.5,
    turnSmoothing: 12,
    radius: 0.45,
  },

  // ---------------- Barco ----------------
  boat: {
    maxForwardSpeed: 16,       // m/s (~31 nós)
    maxReverseSpeed: -4,
    thrust: 5.0,               // aceleração do motor/vela
    linearDrag: 0.18,
    quadDrag: 0.012,
    turnRate: 0.55,            // rad/s na velocidade de referência
    throttleResponse: 1.2,
    draft: -0.55,              // quanto o casco afunda abaixo da linha d'água
    buoyancyStiffness: 7,
    buoyancyDamping: 3.2,
    groundClearance: -1.4,     // altura de terreno a partir da qual encalha
    buildTime: 5,              // segundos de construção
    // Níveis de vela (-1 = remar de ré, 0 = recolhida, 1 = meia, 2 = cheia) → fração do empuxo
    sailThrottle: { '-1': -0.35, 0: 0, 1: 0.55, 2: 1 },
    anchorDrag: 2.5,
  },

  // ---------------- Sobrevivência ----------------
  survival: {
    maxHealth: 20,             // 10 corações
    maxHunger: 100,            // escala 0–100 (comidas: uva +5 … hambúrguer +60)
    hungerPerSecond: 100 / 720, // ~12 min para esvaziar parado
    runHungerMult: 2.5,
    starveInterval: 4,         // s entre danos por fome
    regenThreshold: 80,
    regenInterval: 3,          // s por meio coração
    pickupRadius: 1.9,
    magnetRadius: 3.5,
    dropLifetime: 300,
  },

  // ---------------- Armas e ferramentas ----------------
  weapons: {
    hand:    { damage: 1, range: 2.0, cooldown: 0.4, treeDamage: 1 },
    axe:     { damage: 4, range: 2.4, cooldown: 0.6, treeDamage: 2.5, durability: 150 },
    sword:   { damage: 7, range: 2.8, cooldown: 0.45, treeDamage: 1, durability: 200 },
    pickaxe: { damage: 2, range: 2.4, cooldown: 0.7, treeDamage: 1, mineDamage: 2.5, durability: 150 },
    bow:     { minDamage: 4, maxDamage: 9, drawTime: 1.0, minSpeed: 22, maxSpeed: 58, durability: 200 },
  },

  // ---------------- Recursos ----------------
  resources: {
    treeHealth: 10, rockHealth: 6, oreHealth: 8,
    treeRegrow: 300, rockRegrow: 420,
    ores: { coal: 70, iron: 50, gold: 16 },
  },

  // ---------------- Dia e noite ----------------
  dayNight: {
    dayDuration: 480,          // s de dia (06h → 18h)
    nightDuration: 240,        // s de noite (18h → 06h)
    startTime: 0.32,           // 0 = meia-noite, 0.25 = 06h, 0.5 = meio-dia
  },

  // ---------------- Inimigos ----------------
  enemies: {
    maxZombies: 8,
    zombieSpawnInterval: 7,
    zombieHealth: 20,
    zombieDamage: 2,
    zombieSpeed: 2.3,
    zombieSight: 32,
    ghostShips: 2,
    ghostShipHealth: 150,
    ghostSpawnInterval: 45,
  },

  // ---------------- Combate naval ----------------
  shipCombat: {
    hullMax: 200,
    cannonDamage: 25,
    reload: 4,
    muzzleSpeed: 55,
    buildWood: 24,
    repairWood: 3,
    repairAmount: 20,
  },

  // ---------------- Câmera ----------------
  camera: {
    fov: 60,
    near: 0.1,
    far: 9000,
    onFoot: { distance: 6.5, height: 2.4, fov: 60, lookHeight: 1.5 },
    onBoat: { distance: 24, height: 9, fov: 68, lookHeight: 3.5 },
    damping: 6,
    profileBlend: 2.5,
  },

  // ---------------- Render / Qualidade ----------------
  render: {
    shadowMapSize: 2048,
    shadowExtent: 120,           // meia-largura do frustum de sombra (m)
    screenSpaceShadows: true,    // pass sss() (Screen-Space Shadows)
    pixelRatioMax: 1.75,
    fogNear: 350,
    fogFar: 2300,
  },

  // ---------------- Fauna ----------------
  fauna: {
    birds: 14,
    deer: 6,
    horses: 4,
    alligators: 4,
    lodDistance: 260,            // além disso, atualiza com menor frequência
  },

  sun: { elevation: 32, azimuth: 135 },
};
