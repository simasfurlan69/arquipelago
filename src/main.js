/**
 * main.js
 * Bootstrap do jogo: cria o renderer WebGPU, gera o mundo, instancia entidades e
 * sistemas de sobrevivência, liga tudo e inicia o loop.
 *
 * Ordem de atualização por frame:
 *   UI/hotbar → navio (comandos, canhões) → jogador + ferramenta → câmera →
 *   projéteis/efeitos → coleta/drops → fauna → inimigos → status (vida/fome) →
 *   dia/noite + céu → oceano/nuvens/vila/NPCs → construção/interação → HUD → render
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { CONFIG } from './config.js';
import { createRenderer, backendName, GameRenderer, LAYERS, useStaticVelocity } from './render/GameRenderer.js';
import { TidewaterOcean } from './water/TidewaterOcean.js';
import { buildTerrainData } from './water/TerrainDataAdapter.js';
import { Terrain as TwTerrain } from './vendor/tidewater/world/Terrain.js';
import { Input } from './core/Input.js';
import { Loop } from './core/Loop.js';
import { HUD } from './core/HUD.js';
import { Interaction } from './core/Interaction.js';
import { Perlin, clamp } from './utils/Noise.js';

import { Terrain } from './world/Terrain.js';
import { Sky } from './world/Sky.js';
import { Vegetation } from './world/Vegetation.js';
import { Village } from './world/Village.js';
import { Colliders } from './world/Colliders.js';

import { Player } from './entities/Player.js';
import { Boat } from './entities/Boat.js';
import { Cannons } from './entities/Cannons.js';
import { BoatBuilder } from './entities/BoatBuilder.js';
import { NPC } from './entities/NPC.js';
import { FaunaManager } from './fauna/FaunaManager.js';
import { ThirdPersonCamera } from './camera/ThirdPersonCamera.js';

import { Inventory } from './game/Inventory.js';
import { PlayerStats } from './game/PlayerStats.js';
import { DayNight } from './game/DayNight.js';
import { Combat } from './game/Combat.js';
import { Projectiles, Effects } from './game/Projectiles.js';
import { Drops } from './game/Drops.js';
import { Harvest } from './game/Harvest.js';
import { ToolController } from './game/ToolController.js';
import { CombatFX, WeaponTrail } from './game/CombatFX.js';
import { Legendary } from './game/Legendary.js';
import { markRainIsland, Weather } from './world/RainBiome.js';
import { SharkManager } from './fauna/SharkManager.js';
import { loadSharkModel } from './fauna/Shark.js';
import { EnemyManager } from './enemies/EnemyManager.js';
import { NavalBots } from './enemies/NavalBots.js';
import { Story } from './story/Story.js';
import { Spotify } from './integrations/Spotify.js';
import { preloadIcons } from './ui/IconTint.js';
import { Merchant } from './entities/Merchant.js';
import { ShopUI } from './ui/ShopUI.js';
import { Quests, REP_LEVELS, repLevel } from './game/Quests.js';
import { events } from './game/Events.js';
import { DialogueUI } from './ui/DialogueUI.js';
import { QuestLog } from './ui/QuestLog.js';
import { BRUNO, HELENA, FACES } from './story/Dialogues.js';
import { Zombie } from './enemies/Zombie.js';
import { GhostShip } from './enemies/GhostShip.js';
import { InventoryUI } from './ui/InventoryUI.js';
import { GraphicsMenu } from './ui/GraphicsMenu.js';
import { SettingsMenu } from './ui/SettingsMenu.js';
import { SaveGame } from './game/SaveGame.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Sfx } from './audio/Sfx.js';
import { Music } from './audio/Music.js';
import { FloatingText } from './ui/FloatingText.js';
import { ShoreDistance } from './world/ShoreDistance.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const SC = CONFIG.shipCombat;

async function main() {
  const hud = new HUD();
  hud.setLoading(3, 'Inicializando WebGPU…');

  // ---------------- Renderer / cena / câmera ----------------
  const renderer = await createRenderer(document.body);
  hud.setBackend(backendName(renderer));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, CONFIG.camera.near, CONFIG.camera.far);
  const input = new Input(renderer.domElement);
  const perlin = new Perlin(CONFIG.seed);
  const colliders = new Colliders();

  // ---------------- Mundo ----------------
  hud.setLoading(8, 'Esculpindo ilhas com Perlin Noise…');
  await nextFrame();
  const terrain = new Terrain(scene, perlin);
  await terrain.build((f) => hud.setLoading(8 + f * 40, `Esculpindo ilhas… (${Math.round(f * 100)}%)`));

  // ---------------- Céu, render e oceano (Tidewater) ----------------
  hud.setLoading(50, 'Construindo a atmosfera…');
  await nextFrame();
  const sky = new Sky(scene, renderer);
  const gfx = new GameRenderer(renderer, scene, camera);
  hud.setLoading(54, 'Propagando as ondas até a praia…');
  await nextFrame();
  const terrainData = buildTerrainData(terrain);
  const ocean = new TidewaterOcean({
    renderer, scene, terrainData, sky, sceneRenderer: gfx.sceneRenderer,
    shoreCenter: { x: 0, z: 0 },
  });
  gfx.finish({ ocean, sky });
  // Terreno realista do Tidewater (areia molhada, rocha, solo, grama, fundo do mar),
  // desenhado a partir das alturas do nosso arquipélago. O nosso Terrain continua
  // como fonte de altura para a física, mas não é mais desenhado.
  hud.setLoading(58, 'Sombreando o terreno…');
  await nextFrame();
  const shoreDist = new ShoreDistance(terrainData);
  const twTerrain = new TwTerrain({ scene, terrainData, terrainGPU: ocean.terrainGPU, renderer });
  twTerrain.wetness = ocean.wetness;
  twTerrain.finalizeMaterial();
  useStaticVelocity(twTerrain.mesh);
  for (const m of terrain.meshes) m.visible = false;
  terrain.seabed.visible = false;

  hud.setLoading(58, 'Plantando florestas e veios de minério…');
  await nextFrame();
  // a Ilha das Chuvas Eternas é marcada antes da vegetação (floresta densa e molhada)
  const rainIsland = markRainIsland(terrain);
  const vegetation = new Vegetation(scene, terrain, colliders);
  vegetation.build();

  hud.setLoading(68, 'Erguendo a vila e o estaleiro…');
  await nextFrame();
  const village = new Village(scene, terrain, colliders);
  village.build();

  // ---------------- Sistemas de sobrevivência ----------------
  const inventory = new Inventory();
  // Kit inicial: ferramentas de pedra, comida e água (armas à distância só no Mercador)
  await preloadIcons();
  for (const [id, n] of [['sword_stone', 1], ['axe_stone', 1], ['pickaxe_stone', 1], ['bread', 3], ['water', 2], ['gold_coin', 25], ['lantern', 1]]) inventory.add(id, n);
  inventory.onReject = (msg) => hud.toast(msg, 1.5);
  const stats = new PlayerStats();
  const dayNight = new DayNight();
  const combat = new Combat();
  const effects = new Effects(scene);
  effects.camera = camera;
  // ---------------- Som (sintetizado, sem arquivos) ----------------
  const audio = new AudioEngine();
  const sfx = new Sfx(audio);
  const music = new Music(audio);
  const projectiles = new Projectiles(scene, { terrain, ocean, combat, effects });
  const ui = new InventoryUI({ inventory, stats, input, hud });
  hud.pickup = (id, n) => { ui.pickup(id, n); sfx.pickup(); };
  const drops = new Drops(scene, { terrain, ocean, colliders, inventory, hud });
  const harvest = new Harvest(vegetation, { colliders, drops, effects, hud });
  // árvore batendo no chão: baque + tremor perto do jogador
  harvest.onImpact = (p, s) => {
    sfx.treeThud(p);
    const d = p.distanceTo(player.root.position);
    if (d < 25) tpc.addShake(0.25 * s * (1 - d / 25));
  };

  // ---------------- Entidades ----------------
  hud.setLoading(78, 'Despertando os habitantes…');
  await nextFrame();
  const spawnPoint = village.spots.playerSpawn;
  const player = new Player(scene, terrain, colliders, input);
  player.stats = stats;
  hud.setLoading(80, 'Carregando o personagem e as animações Mixamo…');
  try { await player.useMixamoModel(); }
  catch (e) { console.warn('Soldier/animações não carregaram; usando o boneco procedural.', e); }
  player.spawnAt(spawnPoint.x, spawnPoint.z);
  player.facing = Math.atan2(village.spots.buildZone.x - player.position.x, village.spots.buildZone.z - player.position.z);
  combat.register(player);

  const boat = new Boat(scene, terrain, ocean);
  ocean.attachBoat(boat);
  // a água não aparece por dentro do casco
  gfx.sceneRenderer.addHullMask(boat.createHullVolumeGeometry(), boat.root);
  // boat.loadShipGLB('./assets/models/ship.glb');   // ← modelo do Sketchfab (ver Boat.js)
  combat.register(boat);
  new Cannons(boat, { projectiles, effects, ammo: () => inventory.remove('cannonball', 1) });
  const builder = new BoatBuilder(scene, boat, hud, village.spots.buildZone, village.spots.boatSpawn);

  const npcs = [
    new NPC(scene, {
      kind: 'blacksmith', name: 'Bruno, o Ferreiro', spot: village.spots.blacksmith,
      dialog: [
        'Hah! Mais um aventureiro. A forja não descansa, e eu também não.',
        'Perto da minha forja você pode fundir minério de ferro com carvão, fazer balas de canhão e assar carne. Abra o inventário (Tab).',
        'Os veios escuros nas encostas são carvão; os alaranjados, ferro; e lá no alto da montanha brilha o ouro. Só a picareta os quebra.',
        'Ferramenta gasta? Traga um lingote de ferro que eu deixo nova em folha.',
      ],
    }),
    new NPC(scene, {
      kind: 'guild', name: 'Mestre Heitor da Guilda', spot: village.spots.guild,
      dialog: [
        'Bem-vindo ao Salão da Guilda dos Navegantes. Todo contrato passa por este livro.',
        `Para construir um navio, junte ${SC.buildWood} madeiras e vá ao estaleiro na margem da baía.`,
        'Quando a noite cai, os mortos se levantam da terra… e navios fantasmas surgem na névoa do mar.',
        'Afunde os navios fantasmas com seus canhões: eles carregam ouro e ferro. Balas de canhão se fazem na forja.',
      ],
    }),
  ];

  hud.setLoading(86, 'Soltando a fauna…');
  await nextFrame();
  const worldCtx = { shoreDist, sfx, terrain, ocean, colliders, combat, drops, effects, projectiles, hud, player };
  const fauna = new FaunaManager(scene, worldCtx);
  fauna.build();
  const enemies = new EnemyManager(scene, worldCtx);
  const naval = new NavalBots(scene, worldCtx, { count: 3 });
  worldCtx.naval = naval;

  // ---------------- História e chefes ----------------
  const storyPlayerPos = new THREE.Vector3();
  const storyCtx = Object.assign(worldCtx, {
    scene, enemies, boat, inventory, playerPos: storyPlayerPos,
    groundAt: (x, z) => Math.max(terrain.getHeight(x, z), colliders.platformHeight(x, z)),
    difficulty: () => CONFIG.difficulty || 1,
    shake: (a) => tpc.addShake(a),
    helenaPos: village.spots.guild.position, shipyardPos: village.spots.buildZone,
    applyReward: (id) => {
      const B = tools.bonus;
      if (id === 'grakk') B.sword = 1.35;
      if (id === 'vesna') B.bow = 1.3;
      if (id === 'korrak') B.pickaxe = 1.5;
      if (id === 'ignar') B.axe = 1.45;
      if (id === 'morrigan') { boat.cannons.damage = SC.cannonDamage * 1.4; boat.cannons.reloadTime = SC.reload * 0.75; }
      if (id === 'ysolde') { boat.hullMax = SC.hullMax + 100; boat.hull = boat.hullMax; }
      if (id === 'nimbra') stats.staminaRegenMult = 1.3;
    },
  });
  // ---------------- Tubarões ----------------
  const sharks = new SharkManager(scene, storyCtx, { rainIsland, sfx });
  const story = new Story(storyCtx);
  story.setupWorld();


  // ---------------- Câmera e ferramentas ----------------
  const tpc = new ThirdPersonCamera(camera, input, terrain, ocean);
  tpc.yaw = player.facing + Math.PI;
  tpc.colliders = colliders;        // câmera não entra em paredes/troncos
  tpc.vegetation = vegetation;      // nem em copas de árvore
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enabled = false;
  let debugCam = false;
  const floating = new FloatingText(camera);
  // HUD de combate: fôlego, carga do arco e marcador de mira travada
  const hudEl = document.getElementById('hud');
  hudEl.insertAdjacentHTML('beforeend', '<div id="stamina"><div></div></div><div id="charge" class="hidden"></div><div id="lockmark" class="hidden"></div>');
  const staminaBar = document.querySelector('#stamina > div'), chargeEl = document.getElementById('charge'), lockEl = document.getElementById('lockmark');
  hud.setCharge = (k) => {
    chargeEl.classList.toggle('hidden', k == null);
    if (k != null) { chargeEl.style.transform = `scale(${1.6 - k * 0.9})`; chargeEl.style.borderColor = k >= 0.98 ? '#ffd23a' : 'rgba(255,255,255,.85)'; }
  };
  const _lv = new THREE.Vector3();
  const updateCombatHud = () => {
    staminaBar.style.width = `${stats.stamina}%`;
    staminaBar.parentElement.style.opacity = stats.stamina < 99 ? 1 : 0;
    const lt = player.lockTarget;
    lockEl.classList.toggle('hidden', !lt);
    if (lt) {
      const sp = lt.getHitSpheres()[0];
      _lv.set(sp.x, sp.y, sp.z).project(camera);
      lockEl.style.transform = `translate(${(_lv.x * 0.5 + 0.5) * innerWidth}px, ${(-_lv.y * 0.5 + 0.5) * innerHeight}px)`;
    }
  };
  player.audio = sfx;
  const tools = new ToolController({ player, inventory, combat, harvest, projectiles, tpc, input, hud, stats, effects, sfx, floating, scene });
  // ---------------- Efeitos de combate, rastro da arma e poderes lendários ----------------
  const groundAt = (x, z) => Math.max(terrain.getHeight(x, z), colliders.platformHeight(x, z), 0);
  const cfx = new CombatFX(scene, { effects, groundAt, sfx });
  const trail = new WeaponTrail(scene);
  const legendary = new Legendary({ combat, effects, cfx, player, stats, projectiles, scene, sfx, hud, groundAt, shake: (a) => tpc.addShake(a) });
  tools.attachFX({ cfx, trail, legendary });
  storyCtx.cfx = cfx; storyCtx.sharks = sharks;
  hudEl.insertAdjacentHTML('beforeend', '<div id="fury"><div class="fill"></div><span>F</span></div>');
  const furyEl = document.getElementById('fury'), furyFill = furyEl.firstElementChild;
  let _furyK = -1;
  hud.setFury = (k, counter) => {
    if (Math.abs(k - _furyK) > 0.004 || counter !== furyEl._c) {
      _furyK = k; furyEl._c = counter;
      furyFill.style.width = `${(k * 100).toFixed(1)}%`;
      furyEl.classList.toggle('full', k >= 1);
      furyEl.classList.toggle('counter', !!counter);
      furyEl.classList.toggle('hidden', k <= 0 && !counter);
    }
  };
  // esquiva perfeita: o MUNDO fica lento (o jogador não), vinheta azul e contra-ataque
  let slowMo = 0;
  player.onPerfectDodge = () => {
    slowMo = 0.7;
    cfx.screen('perfect', 0.8);
    tools.onPerfectDodge();
    sfx.perfectDodge?.();
    hud.toast('✨ ESQUIVA PERFEITA — contra-ataque!', 1.1);
  };
  player.onDodge = () => { const p = player.position; effects.dust(new THREE.Vector3(p.x, p.y + 0.1, p.z)); };
  // contador de munição (armas de fogo e arco) e efeito ativo (café/adrenalina)
  document.getElementById('hud').insertAdjacentHTML('beforeend', '<div id="ammo" class="hidden"></div><div id="buff" class="hidden"></div>');
  const ammoEl = document.getElementById('ammo'), buffEl = document.getElementById('buff');
  hud.setAmmo = (txt) => { ammoEl.classList.toggle('hidden', !txt); if (txt && ammoEl.textContent !== txt) ammoEl.textContent = txt; };
  stats.onBuff = (b) => { buffEl.classList.toggle('hidden', !b); if (b) buffEl.textContent = b.label; };
  // Feedback de todo acerto: número flutuante, som e tremor
  combat.onHit = (target, amount, point, o) => {
    if (!point) return;
    if (target === player) return;
    if (o.fromPlayer) floating.spawn(point, o.crit ? `${Math.round(amount)}!` : amount, o.crit ? 'crit' : 'dmg');
    if (target.faction?.startsWith('ship')) sfx.shipHit(point);
    else if (o.source === 'pickaxe' && target.armored) sfx.hitMetal(point);
    else sfx.hitFlesh(point, o.crit);
    if (o.fromPlayer && o.stop) tpc.addShake(o.stop * 2);
  };
  window.__lastCombat = combat;

  // Linha de prévia da trajetória dos canhões
  const aimGeo = new THREE.BufferGeometry();
  aimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
  const aimLine = new THREE.Line(aimGeo, new THREE.LineBasicNodeMaterial({ color: 0xffb040, transparent: true, opacity: 0.8 }));
  aimLine.frustumCulled = false;
  aimLine.visible = false;
  aimLine.layers.set(LAYERS.TRANSPARENT);
  scene.add(aimLine);
  const aimPts = [];

  // ---------------- Feedback de dano ----------------
  stats.onDamage = () => { ui.flashDamage(); tpc.addShake(0.4); };
  boat.onDamage = () => { if (player.state === 'boat') { ui.flashDamage(); tpc.addShake(0.6); } };
  boat.cannons.onShot = (p) => { tpc.addShake(0.15); sfx.cannon(p); };
  worldCtx.onCannon = (p) => { sfx.cannon(p); if (p.distanceTo(camera.position) < 60) tpc.addShake(0.1); };
  effects.onSplash = (p, big) => sfx.splash(p, big);

  // ---------------- Interação ----------------
  const interaction = new Interaction(hud, input);
  interaction.register(builder.interactable(inventory));
  for (const n of npcs) interaction.register(n.interactable(hud));

  // ---------------- Comércio ----------------
  const shop = new ShopUI({ inventory, input, hud, sfx });
  const V3 = (x, z) => new THREE.Vector3(x, terrain.getHeight(x, z), z);
  const vc = CONFIG.world.village;
  const bz = village.spots.buildZone;
  const merchants = [
    new Merchant(scene, { id: 'tomas', position: V3(vc.x + 10, vc.z - 14), facing: Math.PI * 0.25, colliders }),
    new Merchant(scene, { id: 'silas', position: V3(bz.x + 4, bz.z + 3), facing: Math.atan2(vc.x - bz.x, vc.z - bz.z), night: true, colliders }),
  ];
  for (const m of merchants) interaction.register(m.interactable((mm) => shop.openFor(mm)));

  // ---------------- Missões, reputação e conversas ----------------
  const quests = new Quests({ inventory, hud, sfx });
  quests.onDrop = (id, n) => drops.spawn(id, n, playerPos.clone());
  events.on((type, data) => quests.emit(type, data));
  inventory.onChange(() => quests.emit('inventory'));
  const questLog = new QuestLog({ quests, input });
  const talk = new DialogueUI({ input, sfx });
  for (const n of npcs) n.attach({ effects, sfx, colliders, talkUI: talk, groundAt: (x, z) => Math.max(terrain.getHeight(x, z), colliders.platformHeight(x, z)) });
  const memo = {};           // memória das conversas ("já falou sobre…")
  // Vitrine do Bruno: equipamentos liberados pela reputação (último número = reputação mínima)
  const brunoShop = {
    id: 'bruno', root: npcs[0].root,
    shop: {
      name: 'Bruno, o Ferreiro', greeting: 'Tudo saiu desta bigorna. Quanto mais confiança, melhor o aço que eu te vendo.',
      sells: [
        ['pickaxe_stone', 1, 6, 0], ['axe_stone', 1, 6, 0], ['dagger_stone', 1, 4, 0], ['sword_stone', 1, 6, 0],
        ['pickaxe_gold', 1, 60, 35], ['axe_gold', 1, 60, 35], ['dagger_gold', 1, 45, 35], ['sword_gold', 1, 70, 35],
        ['pickaxe_metal', 1, 140, 75], ['axe_metal', 1, 140, 75], ['dagger_metal', 1, 110, 75], ['sword_metal', 1, 170, 75],
        ['runic_sword', 1, 320, 140], ['metal_bar', 1, 10, 10], ['gold_bar', 1, 16, 35], ['cannonball', 4, 6, 10],
      ],
      repOf: () => quests.rep.bruno,
      lockLabel: (r) => REP_LEVELS[repLevel(r)].name,
      discount: () => [1, 0.95, 0.9, 0.85, 0.8][repLevel(quests.rep.bruno)],
      buysContraband: false,
    },
  };
  brunoShop.name = brunoShop.shop.name;
  const dctx = {
    q: quests, story, memo, inv: inventory,
    get night() { return dayNight.isNight; },
    openBrunoShop: () => setTimeout(() => shop.openFor(brunoShop), 50),
  };
  const repLabel = (k) => () => `Reputação: ${REP_LEVELS[repLevel(quests.rep[k])].name}`;
  npcs[0].onInteract = () => talk.start(BRUNO, dctx, { name: npcs[0].name, ...FACES.bruno, rep: repLabel('bruno') });
  npcs[1].onInteract = () => talk.start(HELENA, dctx, { name: npcs[1].name, ...FACES.helena, rep: repLabel('helena') });
  dayNight.on('dawn', () => quests.newDay(dayNight.day));
  // Embarque: perto de qualquer ponto do costado (não só do leme)
  interaction.register({
    getPosition: (out) => boat.closestHullPoint(playerPos.x, playerPos.z, out).setY(playerPos.y),
    radius: 8,
    label: () => 'E — Embarcar e assumir o leme',
    enabled: (ctx) => boat.built && boat.alive && !boat.sinking && ctx.player.state === 'foot',
    interact: () => board(),
  });

  function board() {
    if (stats.dead) return;
    player.boardBoat(boat);
    boat.driven = true;
    hud.setMode('Pilotando o navio');
    hud.toast('W/S: velas · A/D: leme · Clique: canhões · Espaço: âncora', 3.5);
  }
  function disembark(force = false) {
    const spot = force ? spawnPoint : boat.findDisembarkPoint((x, z) => player.groundHeight(x, z));
    if (!spot) { hud.toast('Aproxime-se da costa para desembarcar.'); return; }
    player.leaveBoat(spot.x, spot.z);
    boat.driven = false;
    hud.setMode('A pé');
  }

  // Navio do jogador afundou: volta à vila e libera o estaleiro
  boat.onSunk = () => {
    if (player.state === 'boat') disembark(true);
    hud.toast('Seu navio afundou! Reconstrua no estaleiro.', 4);
    builder.reset();
  };

  // Morte e renascimento
  let deathTimer = 0;
  stats.onDeath = () => {
    ui.showDeath(true);
    deathTimer = 3;
    if (player.state === 'boat') disembark(true);
    player.alive = false;
  };

  // Dia e noite
  dayNight.on('dusk', () => {
    hud.toast('🌙 A noite caiu… os mortos-vivos despertam!', 4);
    if (player.lantern && inventory.has('lantern') && !player.lantern.on) { player.lantern.setOn(true); setTimeout(() => hud.toast('🏮 Lanterna acesa (L apaga)', 2), 4200); }
  });
  dayNight.on('dawn', () => { enemies.onDawn(); hud.toast('☀️ Amanheceu. Os mortos-vivos queimam ao sol!', 3); });

  // ---------------- Pós-processamento ----------------
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  // Objetos transparentes vão para o passe tardio (depois da água)
  scene.traverse((o) => { if (o.isMesh && o.material?.transparent && o !== ocean.mesh) o.layers.set(LAYERS.TRANSPARENT); });
  const gfxMenu = new GraphicsMenu({ gfx, sky, input, hud });
  let paused = false, playing = false, autosaveOn = true;
  const saveGame = new SaveGame(null);
  let weatherRef = null;
  const settings = new SettingsMenu({
    input,
    hooks: {
      isPlaying: () => playing,
      pause: (on) => { paused = on; },
      apply: (cfg) => {
        gfxMenu.apply(cfg.preset, true);
        CONFIG.camera.onFoot.fov = cfg.fov; CONFIG.camera.onBoat.fov = cfg.fov + 8;
        vegetation.viewDistance = cfg.vegDistance;
        if (sky.sun.castShadow !== cfg.shadows) sky.sun.castShadow = cfg.shadows;
        if (gfx.post?.motionBlur) gfx.post.motionBlur.shutter.value = cfg.motionBlur ? 0.2 : 0;
        for (const k of ['master', 'music', 'sfx', 'ambient']) audio.setVolume(k, cfg[k]);
        music.enabled = cfg.musicOn;
        input.sensitivity = cfg.sensitivity; input.invertY = cfg.invertY;
        Object.assign(input.binds, cfg.keys);
        stats.difficulty = { facil: 0.6, normal: 1, dificil: 1.6 }[cfg.difficulty];
        CONFIG.difficulty = stats.difficulty;
        floating.enabled = cfg.damageNumbers;
        autosaveOn = cfg.autosave;
        weatherRef?.setMode(cfg.rain || 'on');
      },
      save: () => { saveGame.save(); hud.toast('💾 Jogo salvo.', 1.5); },
      load: () => { const ok = saveGame.load(); if (ok && !localStorage.getItem('lanternGiven')) { inventory.add('lantern', 1); localStorage.setItem('lanternGiven', '1'); } hud.toast(ok ? '📂 Progresso carregado.' : 'Nenhum salvamento.', 1.5); return ok; },
      clear: () => { saveGame.clear(); hud.toast('Progresso apagado.', 1.5); },
    },
  });
  // ---------------- Spotify (aba nas Configurações) ----------------
  const spotify = new Spotify({ panel: document.getElementById('spotify-panel'), audio, hud });
  spotify.handleRedirect().then((ok) => { if (ok) { settings.toggle(true); settings.tab(4); } spotify.start(); });

  // ---------------- Clima / Ilha das Chuvas Eternas ----------------
  const weather = new Weather({ scene, sky, gfx, twTerrain, ocean, terrain, island: rainIsland, audio, cfx, hud });
  weather.setMode(settings.cfg?.rain || 'on');
  weatherRef = weather;
  storyCtx.weather = weather;
  if (story.seals.includes('nimbra')) weather.islandClear = true;

  hud.setLoading(94, 'Compilando shaders (a primeira vez pode levar um minuto)…');
  // Pré-aquecimento: cria uma vez (escondido do jogo) tudo que só aparece depois, para os
  // shaders compilarem agora e não travarem na primeira aparição.
  const sp = village.spots.playerSpawn;
  const warm = {
    zombie: new Zombie(scene, worldCtx, new THREE.Vector3(sp.x, terrain.getHeight(sp.x, sp.z), sp.z)),
    ghost: new GhostShip(scene, worldCtx, 3000, 3000, 0),
  };
  drops.spawn('wood', 1, new THREE.Vector3(sp.x, 5, sp.z));
  projectiles.arrow(new THREE.Vector3(sp.x, 5, sp.z), new THREE.Vector3(0, 1, 0), 0, 'player');
  projectiles.cannonball(new THREE.Vector3(sp.x, 5, sp.z), new THREE.Vector3(0, 1, 0), 0, 'player');
  for (const k of ['splash', 'smoke', 'dust', 'chips', 'blood', 'fire']) effects[k](new THREE.Vector3(sp.x, 5, sp.z));
  for (const k of ['ice', 'rune', 'mist', 'spark']) effects.burst(k, new THREE.Vector3(sp.x, 5, sp.z), 1);
  // efeitos de combate e chuva entram na compilação
  const fxWarm = [...cfx.warmList(), trail.mesh, weather.drops, weather.splash];
  // tubarão de aquecimento (o modelo é baixado antes da compilação)
  await loadSharkModel().catch(() => null);
  const warmShark = sharks.spawn('tiger', sp.x, sp.z);
  warmShark.root.position.set(sp.x, 3, sp.z);
  for (const o of fxWarm) { o.visible = true; if (o.position && o !== weather.drops && o !== weather.splash && o !== trail.mesh) o.position.set(sp.x, 5, sp.z); }
  scene.traverse((o) => { if (o.isMesh && o.material?.transparent && o !== ocean.mesh) o.layers.set(LAYERS.TRANSPARENT); });
  // todos os blocos de vegetação entram na compilação e no primeiro upload de buffers
  for (const c of vegetation.chunks || []) { c.visible = true; c.frustumCulled = false; }
  const bossVis = story.bosses.map((b) => b.root.visible);
  for (const b of story.bosses) { b.root.visible = true; b.root.traverse((o) => { o.frustumCulled = false; }); }
  await gfx.precompile();
  for (let i = 0; i < 3; i++) { gfx.render(1 / 60); await renderer.backend.device.queue.onSubmittedWorkDone(); }
  for (const c of vegetation.chunks || []) c.frustumCulled = true;
  for (const o of fxWarm) o.visible = false;
  sharks.remove(warmShark);
  story.bosses.forEach((b, i) => { b.root.visible = bossVis[i]; });
  warm.zombie.remove();
  warm.ghost.remove();
  for (const d of drops.list) scene.remove(d.mesh);
  drops.list.length = 0;
  for (const p of projectiles.list) scene.remove(p.mesh);
  projectiles.list.length = 0;
  effects.update(10);

  // ---------------- Loop ----------------
  const playerPos = storyPlayerPos;
  const forgePos = village.spots.blacksmith.position;
  const ctx = { player, playerPos };
  let frameDt = 1 / 60;
  const loop = new Loop(renderer, () => gfx.render(frameDt));
  const tmpDir = new THREE.Vector3();

  let stepAcc = 0, saveTimer = 0;
  loop.add({
    update(rawDt, t, frame) {
      // hit-stop: o mundo "congela" por alguns ms no impacto (a câmera e o HUD seguem)
      let dt = rawDt;
      if (combat.hitStop > 0) { combat.hitStop -= rawDt; dt = rawDt * 0.08; }
      // câmera lenta da esquiva perfeita: inimigos/projéteis a 30%, o jogador normal
      let wdt = dt;
      if (slowMo > 0) { slowMo -= rawDt; wdt = dt * 0.3; }
      // --- Inventário e hotbar ---
      if ((input.justPressed('Escape') || input.justPressed('KeyP')) && !ui.open && !hud.dialogOpen && !shop.open && !talk.open && !questLog.open && performance.now() - (talk.closedAt || 0) > 250 && performance.now() - (questLog.closedAt || 0) > 250) settings.toggle();
      if (questLog.open && input.justPressed('Escape')) questLog.toggle(false);
      if (input.justPressed('KeyG') && !ui.open) { settings.toggle(true); settings.tab(0); }
      if (paused) { input.endFrame(); return; }
      playing = true;
      // salvamento automático a cada 2 min
      if (autosaveOn && (saveTimer += rawDt) > 120) { saveTimer = 0; saveGame.save(); }
      if (input.justPressed('KeyJ') && !talk.open && !shop.open) questLog.toggle();
      if (input.justPressed('KeyL') && !talk.open && !shop.open && player.lantern) {
        if (!inventory.has('lantern')) hud.toast('Você não tem uma lanterna (Tomas vende uma).', 1.5);
        else { const on = player.lantern.toggle(); sfx.click?.(); hud.toast(on ? '🏮 Lanterna acesa' : 'Lanterna apagada', 1); }
      }
      if (input.justPressed(input.binds.inventory) || input.justPressed('KeyI')) ui.toggle();
      else if (ui.open && input.justPressed('Escape')) ui.toggle(false);
      if (!ui.open) {
        for (let d = 1; d <= 9; d++) if (input.justPressed(`Digit${d}`)) inventory.select(d - 1);
        if (input.wheel) inventory.select(inventory.selected + input.wheel);
      }
      if (input.justPressed('KeyC') && !ui.open) {
        debugCam = !debugCam;
        orbit.enabled = debugCam;
        if (debugCam) orbit.target.copy(playerPos);
      }

      // --- Morte / renascimento ---
      if (stats.dead) {
        deathTimer -= dt;
        if (deathTimer <= 0) {
          stats.respawn();
          player.alive = true;
          if (player.state === 'boat') disembark(true);
          player.spawnAt(spawnPoint.x, spawnPoint.z);
          ui.showDeath(false);
        }
      }

      // --- Navio do jogador ---
      const onBoat = player.state === 'boat';
      let steer = 0;
      if (onBoat && !ui.open && !stats.dead && !boat.sinking) {
        steer = -input.axes().x;
        if (input.justPressed('KeyW')) boat.setSail(boat.sailLevel + 1);
        if (input.justPressed('KeyS')) boat.setSail(boat.sailLevel - 1);
        if (input.justPressed('KeyX')) { boat.rudderLocked = !boat.rudderLocked; hud.toast(boat.rudderLocked ? 'Leme travado' : 'Leme destravado', 1.2); }
        if (input.justPressed(input.binds.jump)) { boat.anchored = !boat.anchored; hud.toast(boat.anchored ? '⚓ Âncora lançada' : '⚓ Âncora recolhida', 1.2); }
        if (input.justPressed('KeyR')) {
          if (boat.hull >= boat.hullMax) hud.toast('O casco está intacto.', 1.2);
          else if (inventory.remove('wood', SC.repairWood)) { boat.repair(SC.repairAmount); hud.toast(`Casco reparado (+${SC.repairAmount})`, 1.2); }
          else hud.toast(`Precisa de ${SC.repairWood} madeiras para reparar.`, 1.5);
        }
        if (input.mouseJustPressed(0)) {
          tpc.getAimDirection(tmpDir);
          const side = boat.cannons.sideFacing(tmpDir.clone().setY(0).normalize());
          const elev = clamp(Math.asin(tmpDir.y) + 0.12, 0, 0.45);
          if (!boat.cannons.ready(side)) hud.toast('Canhões recarregando…', 0.8);
          else if (!inventory.has('cannonball')) hud.toast('Sem balas de canhão! Faça na forja (lingote + carvão).', 2);
          else {
            boat.cannons.fire(side, elev);
            // Shift: bordada dupla (os dois bordos de uma vez)
            if (input.down('ShiftLeft')) { const other = side === 'port' ? 'star' : 'port'; if (boat.cannons.ready(other)) boat.cannons.fire(other, elev); }
          }
        }
        if (input.justPressed(input.binds.interact)) disembark();
      }
      boat.update(dt, onBoat ? { steer } : null);

      // Prévia de mira dos canhões
      aimLine.visible = player.state === 'boat' && input.locked && !boat.sinking;
      if (aimLine.visible) {
        tpc.getAimDirection(tmpDir);
        const side = boat.cannons.sideFacing(tmpDir.clone().setY(0).normalize());
        boat.cannons.trajectory(side, clamp(Math.asin(tmpDir.y) + 0.12, 0, 0.45), 60, aimPts);
        const arr = aimGeo.attributes.position.array;
        aimPts.forEach((p, i) => { if (i < 64) { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; } });
        aimGeo.setDrawRange(0, Math.min(64, aimPts.length));
        aimGeo.attributes.position.needsUpdate = true;
        // mira assistida: a linha fica vermelha quando a trajetória cruza um navio inimigo
        let onTarget = false;
        for (const t of combat.targets) {
          if (!t.alive || t.faction !== 'ship-ghost') continue;
          for (const sp of t.getHitSpheres()) for (let i = 0; i < aimPts.length && !onTarget; i += 2) {
            const q = aimPts[i]; if ((q.x - sp.x) ** 2 + (q.y - sp.y) ** 2 + (q.z - sp.z) ** 2 < (sp.r + 2) ** 2) onTarget = true;
          }
        }
        aimLine.material.color.setHex(!boat.cannons.ready(side) ? 0x806040 : onTarget ? 0xff3020 : 0xffb040);
      }

      // --- Jogador e ferramenta ---
      if (!stats.dead) {
        if (player.lantern) {
          const has = inventory.has('lantern');
          if (!has && player.lantern.on) player.lantern.setOn(false);
          player.lantern.hook.visible = has;
          player.night = dayNight.isNight;
        }
        player.update(dt, tpc.yaw);
        if (!ui.open) tools.update(dt);
      }
      player.getWorldPosition(playerPos);

      // --- Câmera ---
      if (debugCam) orbit.update();
      else tpc.update(dt, player.state === 'boat' ? boat.root.position : playerPos, player.state === 'boat', boat.heading);

      // --- Combate, coleta, vida ---
      projectiles.update(wdt);
      cfx.update(dt);
      legendary.update(dt);
      cfx.lowHp = stats.health <= 6 && !stats.dead ? (1 - stats.health / 6) * 0.8 : 0;
      floating.update(rawDt);
      updateCombatHud();
      // ---- som: ouvinte, passos, ambiente e música ----
      audio.setListener(camera);
      if (player.state === 'foot' && player.speed > 0.8) {
        stepAcc += dt * player.speed / (player.speed > 5 ? 2.6 : 1.7);
        if (stepAcc >= 1) {
          stepAcc = 0;
          const gx = playerPos.x, gz = playerPos.z, h = terrain.getHeight(gx, gz);
          const surf = colliders.platformHeight(gx, gz) > -Infinity ? 'wood' : h < 0.2 ? 'water' : h < 2.3 ? 'sand' : 'grass';
          sfx.footstep(surf, null, player.speed > 5);
        }
      }
      music.update(dt, {
        shoreDist: Math.abs(shoreDist.at(camera.position.x, camera.position.z) - 4),
        altitude: Math.max(0, camera.position.y), wind: 7, night: dayNight.isNight ? 1 : 0,
        combat: story.inBossFight ? 'boss' : (naval.inBattle || enemies.ghosts.some((g) => g.alive) || enemies.zombies.some((z) => z.alive && z.root.position.distanceTo(playerPos) < 25) ? 'battle' : 'explore'),
      });
      effects.light = 0.15 + 0.85 * Math.min(1, Math.max(0, dayNight.dayFactor));
      effects.update(dt);
      harvest.update(dt);
      drops.update(dt, playerPos, player.state === 'boat' ? 12 : CONFIG.survival.pickupRadius);
      fauna.update(dt, t, frame, playerPos);
      if (boat.built) story.onBoatBuilt();
      if (frame % 30 === 0) spotify.setBattle(story.inBossFight);
      story.update(wdt, camera);
      enemies.update(wdt, dayNight.isNight, player, playerPos, boat);
      naval.update(wdt, player, boat, playerPos);
      sharks.update(wdt, { player, boat, onBoat: player.state === 'boat', focus: player.state === 'boat' ? boat.root.position : playerPos, rain: weather.rain, night: dayNight.isNight });
      // abalroamento: bater o casco em um navio inimigo causa dano nos dois
      if (player.state === 'boat' && Math.abs(boat.speed) > 3) {
        for (const s of naval.ships.concat(enemies.ghosts)) {
          const b = s.boat; if (!b.alive || b.sinking) continue;
          const d = b.root.position.distanceTo(boat.root.position);
          if (d < 12 && (s._ramCd || 0) < t) {
            s._ramCd = t + 1.5;
            const dmg = Math.abs(boat.speed) * 2.5;
            combat.hit(b, dmg, boat.velocity.clone().normalize(), b.root.position.clone(), { source: 'ram', fromPlayer: true, stop: 0.06 });
            boat.takeDamage(dmg * 0.4);
            boat.speed *= 0.4;
          }
        }
      }
      if (!stats.dead) stats.update(dt, player.running);

      // --- Dia e noite ---
      dayNight.update(dt);
      sky.setSun(dayNight.sunElevation, dayNight.sunAzimuth, dayNight.dayFactor);

      // --- Ambiente (céu, oceano FFT, arrebentação, rastro) ---
      frameDt = dt;
      weather.update(dt, player.state === 'boat' ? boat.root.position : playerPos, camera, rawDt);
      sky.update(dt, t, playerPos, camera);
      ocean.update(dt, playerPos, camera);
      twTerrain.update(camera);
      vegetation.update(camera.position, frame);
      village.update(dt, t);
      for (const n of npcs) n.update(dt, playerPos);
      for (const m of merchants) m.update(dt, playerPos, dayNight.isNight);
      if (shop.open && (input.justPressed('Escape') || input.justPressed(input.binds.interact) || input.justPressed(input.binds.inventory))) {
        shop.close();
        for (const k of ['Escape', input.binds.interact, input.binds.inventory]) input.pressed.delete(k);   // não reabre no mesmo frame
      }
      builder.update(dt, t, playerPos);
      // prancha só com o navio pronto e ainda atracado perto do cais
      village.setPlank(boat.built && boat.alive && !boat.sinking &&
        Math.hypot(boat.root.position.x - village.spots.boatSpawn.x, boat.root.position.z - village.spots.boatSpawn.z) < 3);

      // --- Interação e HUD ---
      ui.setStation(player.state === 'foot' && playerPos.distanceTo(forgePos) < 9);
      if (player.state === 'foot' && !ui.open && !shop.open && !talk.open && !questLog.open && !stats.dead) interaction.update(dt, ctx);
      else if (player.state === 'boat') hud.setPrompt('E — Desembarcar');
      else hud.setPrompt(null);
      hud.setSpeed(player.state === 'boat'
        ? `Velocidade: ${(Math.abs(boat.speed) * 1.944).toFixed(1)} nós`
        : `${loop.fps} FPS`);
      ui.update(dt, {
        clock: dayNight.clock, day: dayNight.day, isNight: dayNight.isNight,
        locked: input.locked, boat: player.state === 'boat' || (boat.built && boat.alive && playerPos.distanceTo(boat.root.position) < 30) ? boat : null,
      });
      hud.update(dt);
      input.endFrame();
    },
  });

  hud.setLoading(100, 'Pronto!');
  hud.setMode('A pé');
  loop.start();
  setTimeout(() => hud.hideLoading(), 300);
  hud.toast(`Corte ${SC.buildWood} madeiras com o machado (tecla 2) e construa o navio no anel dourado.`, 6);

  // ---------------- Depuração (console): window.game ----------------
  window.game = {
    THREE, scene, camera, renderer, gfx, terrain, twTerrain, ocean, sky, player, boat, builder, npcs, fauna, tpc, loop, village, orbit,
    naval, story, spotify, shop, merchants, quests, talk, questLog, dctx, inventory, stats, dayNight, combat, harvest, drops, enemies, tools, input, ui, vegetation, settings, audio, sfx, music, saveGame, shoreDist, worldCtx,
    give(id, n = 1) { return inventory.add(id, n); },
    cfx, trail, legendary, weather, rainIsland,
    /** Chuva forçada para testes (null = automática). */
    setRain(x) { weather.forced = x; },
    sharks,
    /** Cria um tubarão ('reef' | 'tiger' | 'white' | 'king') na água funda perto do jogador/navio. */
    spawnShark(kind = 'tiger', dist = 25) { return sharks.spawnNear(kind, player.state === 'boat' ? boat.root.position : playerPos, dist); },
    setFury(n) { tools.fury = n; },
    goRainIsland() { const i = rainIsland; player.spawnAt(i.cx + i.radius * 0.3, i.cz); },
    /** Teleporta para a arena do chefe da missão atual (testes). */
    goBoss() { const b = story.currentBoss; if (!b) return null; if (b.def.aquatic) { this.quickBoat?.(); boat.placeAt(b.home.x + 60, b.home.z, 0); } else player.spawnAt(b.home.x + 12, b.home.z + 12); return b.name; },
    debugKillBoss() { const b = story.currentBoss; if (b) { b.wake(); combat.hit(b, b.hp + 1, null, b.pos.clone(), { breaksArmor: true }); } },
    skipTo(ch) { story.step = 'hunt'; story.chapter = ch; story._refresh(); },
    setTime(x) { dayNight.setTime(x); },
    spawnZombie() { return enemies.spawnZombie(playerPos, 6, 10); },
    spawnGhostShip() { return enemies.spawnGhostShip(boat.root.position, 120, 160); },
    attack() { return tools.primary(); },
    /** Constrói o navio instantaneamente e embarca. */
    quickBoat() { builder.start(); builder.progress = 0.999; builder.update(0.1, 0, builder.zonePos); board(); },
    board, disembark,
  };
  saveGame.g = window.game;
}

main().catch((err) => {
  console.error(err);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = `Erro ao iniciar: ${err.message}`;
});
