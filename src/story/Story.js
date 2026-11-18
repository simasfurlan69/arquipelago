/**
 * Story.js
 * Campanha "A Maré dos Sete Selos".
 *
 * Há gerações, sete guardiões protegiam o arquipélago com os Selos da Maré.
 * O Rei Morto Varkhul corrompeu seis deles com a Maré Negra — desde então os mortos
 * se levantam à noite e navios fantasmas cruzam o mar. O Mestre Heitor, da Guilda dos
 * Navegantes, procura alguém capaz de libertar os guardiões, recuperar os selos e
 * enfrentar Varkhul na Ilha da Coroa.
 *
 * Fluxo: falar com Heitor → construir o navio → para cada chefe: navegar até a ilha
 * → derrotá-lo (ganha o selo + melhoria) → … → com 6 selos a Ilha da Coroa se abre
 * → derrotar Varkhul → final e créditos.
 * Capítulo 7 (novo): Ilha das Chuvas Eternas — Nimbra, a Abominação da Tempestade.
 * Cada chefe deixa uma ARMA LENDÁRIA girando num feixe dourado (pegue andando até ela);
 * cada ilha conta sua história ao chegar.
 * Também cuida da interface: missão atual, bússola, barra de vida do chefe,
 * nome da ilha ao chegar, diálogos do Heitor e créditos.
 */
import * as THREE from 'three/webgpu';
import { BOSSES, serpentSpheres } from '../enemies/bosses/Bosses.js';
import { Boss } from '../enemies/bosses/Boss.js';
import { events } from '../game/Events.js';
import { ITEMS } from '../game/Items.js';
import { buildLegendary } from '../entities/LegendaryModels.js';
import { LAYERS } from '../render/GameRenderer.js';

const $ = (id) => document.getElementById(id);

export class Story {
  constructor(ctx) {
    this.ctx = ctx;              // { scene, terrain, shoreDist, player, playerPos, boat, hud, sfx, inventory, applyReward, ... }
    this.step = 'talk';          // talk → boat → hunt → done
    this.chapter = 0;            // índice do próximo chefe (0..6)
    this.seals = [];
    this.bosses = [];
    this.islandNames = new Map();
    this.legendsGiven = [];       // ids de chefes cuja arma lendária já foi entregue
    this.loreSeen = new Set();
    this.pickups = [];
    this._buildUI();
  }

  // ---------------------------------------------------------------------------
  // Mundo: ilhas e altares
  // ---------------------------------------------------------------------------
  setupWorld() {
    const { terrain, shoreDist } = this.ctx;
    const main = terrain.islands[0];
    const others = terrain.islands.slice(1).sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz));
    this.islandNames.set(main, 'Porto Âncora');
    BOSSES.forEach((def, i) => {
      const isl = others[Math.min(def.islandIndex ?? i, others.length - 1)];
      this.islandNames.set(isl, def.island);
      const home = def.aquatic ? this._seaSpot(isl, shoreDist) : this._landSpot(isl);
      if (def.aquatic) def.spheres = serpentSpheres;
      const boss = new Boss(def, this.ctx, home);
      if (def.aquatic) boss.getHitSpheres = () => serpentSpheres(boss);
      boss.island = isl;
      boss.root.visible = false;
      boss.onDefeated = () => this._defeated(boss);
      this.bosses.push(boss);
      if (!def.aquatic) this._altar(home);
    });
    others.filter((isl) => !this.islandNames.has(isl)).forEach((isl, i) => this.islandNames.set(isl, ['Ilhota do Farol', 'Ilha dos Coqueiros'][i] || 'Ilhota'));
    this._refresh();
  }

  _landSpot(isl) {
    const t = this.ctx.terrain;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 400; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * isl.radius * 0.7;
      const x = isl.cx + Math.cos(a) * r, z = isl.cz + Math.sin(a) * r;
      const h = t.getHeight(x, z), s = t.getSlope(x, z, 6);
      if (h < 2.5) continue;
      const score = -s * 40 - Math.abs(h - 8) * 0.3 - r * 0.02;
      if (score > bestScore) { bestScore = score; best = new THREE.Vector3(x, h, z); }
    }
    return best || new THREE.Vector3(isl.cx, t.getHeight(isl.cx, isl.cz), isl.cz);
  }

  _seaSpot(isl, sd) {
    for (let i = 0; i < 200; i++) {
      const a = Math.random() * Math.PI * 2, r = isl.radius + 120 + Math.random() * 80;
      const x = isl.cx + Math.cos(a) * r, z = isl.cz + Math.sin(a) * r;
      if (sd.at(x, z) > 100) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(isl.cx + isl.radius + 200, 0, isl.cz);
  }

  /** Altar de pedra com pilares e chama: marca a arena do chefe. */
  _altar(p) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardNodeMaterial({ color: 0x5a5650, roughness: 0.95 });
    const fire = new THREE.MeshStandardNodeMaterial({ color: 0x40ff90, emissive: 0x30ff80, emissiveIntensity: 2.5 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.6, 0.5, 24), stone); base.position.y = 0.1; g.add(base);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4 + (i % 2), 0.8), stone);
      pil.position.set(Math.cos(a) * 8, 2, Math.sin(a) * 8); pil.rotation.y = a; g.add(pil);
      const f = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), fire); f.position.set(Math.cos(a) * 8, 4.6 + (i % 2), Math.sin(a) * 8); g.add(f);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.copy(p);
    this.ctx.scene.add(g);
  }

  // ---------------------------------------------------------------------------
  // Progresso
  // ---------------------------------------------------------------------------
  get currentBoss() { return this.step === 'hunt' ? this.bosses[this.chapter] : null; }

  /** Conversa com o Mestre Heitor (avança o início da campanha). */
  talkHelena() {
    if (this.step === 'talk') {
      this.step = this.ctx.boat.built ? 'hunt' : 'boat';
      this._refresh(true);
      return 'Os mortos andam à noite e navios fantasmas rondam nossas águas. Tudo começou quando o Rei Morto Varkhul corrompeu os Sete Guardiões e roubou os Selos da Maré. Cada guardião caído deixa para trás uma arma lendária. Construa um navio no estaleiro e liberte os guardiões, um por ilha. Eu marcarei o caminho na sua bússola.';
    }
    if (this.step === 'boat') return 'O estaleiro fica na margem da baía. Você vai precisar de 24 madeiras — o machado corta rápido.';
    if (this.step === 'done') return 'Você libertou o arquipélago. A Guilda dos Navegantes jamais esquecerá seu nome, herói.';
    const b = this.currentBoss;
    const lines = [
      `Seu próximo destino: ${b.def.island}. Lá vive ${b.name}. ${b.def.intro.split('!').slice(-1)[0].trim()}`,
      `Selos recuperados: ${this.seals.length}/7. ${this.seals.length ? 'O ferreiro Bruno já aplicou as melhorias nas suas armas.' : ''}`,
      b.def.id === 'nimbra' ? 'Na Ilha das Chuvas Eternas chove há cem anos. Os Tubarões-Rei rondam a costa: vá de navio e desembarque rápido. Os raios de Nimbra caem onde os círculos azuis se fecham.' : 'Os guardiões ficaram mais fortes. Observe os avisos no chão, quebre a postura deles e guarde a Fúria (F) para o momento certo.',
    ];
    if (b.def.final) lines[0] = 'Com os sete selos, a névoa sobre a Ilha da Coroa se dissipou. Varkhul o espera em seu trono de ossos. Que a maré esteja a seu favor.';
    return lines[(this._hl = ((this._hl || 0) + 1) % lines.length)];
  }

  onBoatBuilt() { if (this.step === 'boat') { this.step = 'hunt'; this._refresh(true); } }

  _defeated(boss) {
    const def = boss.def;
    events.emit('boss', { id: def.id });
    events.emit('kill', { target: 'boss', hostile: true });
    this.seals.push(def.id);
    this.ctx.applyReward(def.id);
    this.ctx.hud.toast(`⚜ ${def.seal} recuperado! Recompensa: ${def.reward}`, 6);
    if (def.legendary) this._spawnLegend(boss);
    if (def.id === 'nimbra' && this.ctx.weather) { this.ctx.weather.islandClear = true; this.ctx.weather.forcedStorm = false; this.ctx.hud.toast('☀ A chuva eterna cessou. O sol volta à ilha!', 5); }
    this.ctx.sfx.quest();
    if (def.final) { this.step = 'done'; setTimeout(() => this._credits(), 4000); }
    else this.chapter++;
    this._refresh(true);
    this.ctx.onStoryChanged?.();
  }

  /** Só o chefe da missão atual fica no mapa (os já derrotados somem). */
  _refresh(announce = false) {
    this.bosses.forEach((b, i) => {
      const active = this.step === 'hunt' && i === this.chapter && b.alive;
      b.root.visible = active || (b.state === 'dead');
      b.locked = !active;
      // só o chefe ativo pode ser alvo (trava de mira, projéteis)
      if (active) this.ctx.combat.register(b); else this.ctx.combat.unregister(b);
    });
    this._updateQuestUI();
    if (announce) this.ctx.sfx.quest();
  }

  // ---------------------------------------------------------------------------
  // Armas lendárias
  // ---------------------------------------------------------------------------
  /** A arma do chefe aparece girando num feixe dourado; o navio (Ysolde) recebe direto. */
  _spawnLegend(boss) {
    const id = boss.def.legendary, def = ITEMS[id];
    if (!def || this.legendsGiven.includes(boss.def.id)) return;
    if (boss.def.aquatic) { setTimeout(() => this._giveLegend(boss.def.id), 2500); return; }
    const g = new THREE.Group();
    const item = buildLegendary(def);
    item.scale.setScalar(1.4);
    g.add(item);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 30, 16, 1, true),
      new THREE.MeshBasicNodeMaterial({ color: 0xffc040, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 14; beam.layers.set(LAYERS.TRANSPARENT);
    g.add(beam);
    const light = new THREE.PointLight(def.trail || 0xffc040, 40, 14, 2); light.position.y = 1.4; g.add(light);
    const p = boss.home.clone();
    p.y = this.ctx.groundAt(p.x, p.z);
    g.position.copy(p);
    this.ctx.scene.add(g);
    this.pickups.push({ g, item, bossId: boss.def.id, t: 0 });
    this.ctx.hud.toast(`✨ ${boss.name} deixou cair: ${def.name}! Pegue no altar.`, 4);
  }

  _giveLegend(bossId) {
    const b = BOSSES.find((d) => d.id === bossId); if (!b?.legendary || this.legendsGiven.includes(bossId)) return;
    const def = ITEMS[b.legendary];
    this.legendsGiven.push(bossId);
    this.ctx.inventory.add(b.legendary, 1);
    this.ctx.sfx.quest();
    this._legendCard(def);
    this.ctx.onStoryChanged?.();
  }

  _legendCard(def) {
    let el = $('legend-card');
    if (!el) { $('hud').insertAdjacentHTML('beforeend', '<div id="legend-card"></div>'); el = $('legend-card'); }
    el.innerHTML = `<div class="t">LENDÁRIO OBTIDO</div><div class="e">${def.emoji}</div><div class="n">${def.name}</div><div class="d">${def.note}</div>`;
    el.classList.add('show');
    clearTimeout(this._lc);
    this._lc = setTimeout(() => el.classList.remove('show'), 5500);
  }

  serialize() { return { step: this.step, chapter: this.chapter, seals: this.seals, legends: this.legendsGiven, lore: [...this.loreSeen] }; }
  restore(d) {
    this.step = d.step; this.chapter = d.chapter; this.seals = d.seals || [];
    this.loreSeen = new Set(d.lore || []);
    // saves antigos (antes das lendárias): quem já venceu o chefe recebe a arma agora
    this.legendsGiven = d.legends || [];
    for (const id of this.seals) if (!this.legendsGiven.includes(id)) setTimeout(() => this._giveLegend(id), 1500);
    // saves antigos do capítulo 7 (Varkhul) → agora o 7 é Nimbra; o 8 é Varkhul
    if (this.step === 'hunt' && !this.seals.includes('nimbra') && this.seals.length >= 6 && this.bosses[this.chapter]?.def.final) {
      this.chapter = this.bosses.findIndex((b) => b.def.id === 'nimbra');
    }
    if (this.seals.includes('nimbra') && this.ctx.weather) this.ctx.weather.islandClear = true;
    for (const id of this.seals) {
      const b = this.bosses.find((x) => x.id === id);
      if (b && b.alive) { b.alive = false; b.state = 'gone'; b.root.removeFromParent(); this.ctx.combat.unregister(b); }
      this.ctx.applyReward(id);
    }
    this._refresh();
  }

  // ---------------------------------------------------------------------------
  // Atualização
  // ---------------------------------------------------------------------------
  update(dt, camera) {
    for (const b of this.bosses) if (!b.locked || b.state === 'dead') b.update(dt);
    const pp = this.ctx.playerPos;

    // nome da ilha ao chegar
    let here = null;
    for (const [isl, name] of this.islandNames) if (Math.hypot(pp.x - isl.cx, pp.z - isl.cz) < isl.radius * 1.05) here = name;
    if (here !== this._island) {
      this._island = here;
      if (here) {
        this._banner(here); events.emit('visit', { island: here });
        const bd = BOSSES.find((d) => d.island === here);
        if (bd?.lore && !this.loreSeen.has(bd.id)) {
          this.loreSeen.add(bd.id);
          setTimeout(() => { this.ctx.hud.openDialog(`📜 ${here}`, bd.lore.join(' ')); setTimeout(() => this.ctx.hud.closeDialog?.(), 11000); }, 2500);
        }
      }
    }
    // armas lendárias esperando no altar
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      pk.item.rotation.y += dt * 1.6;
      pk.item.position.y = 1.4 + Math.sin(pk.t * 2) * 0.15;
      pk.item.userData.update?.(dt, 0.6);
      const pl = this.ctx.player;
      if (pl.state === 'foot' && Math.hypot(pp.x - pk.g.position.x, pp.z - pk.g.position.z) < 2.6) {
        pk.g.removeFromParent();
        this.pickups.splice(i, 1);
        this._giveLegend(pk.bossId);
      }
    }

    // missão + bússola
    const target = this._target();
    if (target) {
      const dx = target.x - pp.x, dz = target.z - pp.z;
      const dist = Math.hypot(dx, dz);
      const camYaw = Math.atan2(camera.matrixWorld.elements[8], camera.matrixWorld.elements[10]);
      const ang = Math.atan2(-dx, -dz) - camYaw;
      this.el.arrow.style.transform = `rotate(${-ang}rad)`;
      this.el.dist.textContent = `${Math.round(dist)} m`;
      this.el.compass.classList.remove('hidden');
    } else this.el.compass.classList.add('hidden');

    // barra do chefe
    const b = this.bosses.find((x) => x.awake && x.alive);
    this.el.bossbar.classList.toggle('hidden', !b);
    if (b) {
      this.el.bossName.textContent = b.name + (b.armor > 0 ? ' 🛡' : '');
      this.el.bossHp.style.width = `${(b.hp / b.maxHp) * 100}%`;
      this.el.posture.style.width = `${b.broken > 0 ? 100 : b.posture}%`;
      this.el.bossbar.classList.toggle('stunned', b.broken > 0);
      if (b !== this._announced) { this._announced = b; this.ctx.hud.openDialog(b.name, b.def.intro); setTimeout(() => this.ctx.hud.closeDialog?.(), 6000); }
    }
  }

  get inBossFight() { return this.bosses.some((b) => b.awake && b.alive); }

  _target() {
    if (this.step === 'talk') return this.ctx.helenaPos;
    if (this.step === 'boat') return this.ctx.shipyardPos;
    const b = this.currentBoss;
    return b ? b.home : null;
  }

  _questText() {
    if (this.step === 'talk') return ['Fale com o Mestre Heitor', 'Ele está no Salão da Guilda, na vila.'];
    if (this.step === 'boat') return ['Construa o navio', 'Junte 24 madeiras e vá ao anel dourado do estaleiro.'];
    if (this.step === 'done') return ['O arquipélago está livre!', 'Explore à vontade. Obrigado por jogar.'];
    const b = this.currentBoss;
    if (b.def.final) return [`Derrote ${b.name}`, `Ilha da Coroa · selos ${this.seals.length}/7`];
    return [`Derrote ${b.name}`, `${b.def.island}${b.def.aquatic ? ' (no mar, a bordo do navio)' : ''} · selos ${this.seals.length}/7`];
  }

  // ---------------------------------------------------------------------------
  // Interface
  // ---------------------------------------------------------------------------
  _buildUI() {
    const hud = $('hud');
    hud.insertAdjacentHTML('beforeend', `
      <div id="quest"><div class="qt">📜 Missão</div><div id="quest-title"></div><div id="quest-sub"></div><div id="seals"></div></div>
      <div id="compass" class="hidden"><div id="compass-arrow">➤</div><div id="compass-dist"></div></div>
      <div id="bossbar" class="hidden"><div id="boss-name"></div><div class="bar"><div id="boss-hp"></div></div><div class="posture"><div id="boss-posture"></div></div></div>
      <div id="banner" class="hidden"></div>
      <div id="credits" class="hidden"></div>`);
    this.el = { title: $('quest-title'), sub: $('quest-sub'), seals: $('seals'), compass: $('compass'), arrow: $('compass-arrow'), dist: $('compass-dist'),
      bossbar: $('bossbar'), bossName: $('boss-name'), bossHp: $('boss-hp'), posture: $('boss-posture'), banner: $('banner'), credits: $('credits') };
  }

  _updateQuestUI() {
    const [t, s] = this._questText();
    this.el.title.textContent = t;
    this.el.sub.textContent = s;
    this.el.seals.textContent = BOSSES.filter((d) => !d.final).map((d) => (this.seals.includes(d.id) ? '⚜' : '·')).join(' ');
  }

  _banner(name) {
    this.el.banner.textContent = name;
    this.el.banner.classList.remove('hidden', 'show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.el.banner.classList.add('hidden'), 3800);
  }

  _credits() {
    this.el.credits.innerHTML = `<h1>A Maré dos Sete Selos</h1><p>O Rei Morto caiu e a Maré Negra recuou.<br>Os mortos voltaram ao descanso e os navios fantasmas afundaram na névoa.</p>
      <p>Obrigado por jogar!</p><p class="small">Oceano e céu: Tidewater (dgreenheck, MIT) · Three.js · Personagem: Soldier (exemplos do three.js) · Animações: Mixamo · Tubarão e armas Adaga Derretida, Espada Rúnica e Machado de Gelo: Babylon.js Assets (CC BY 4.0)</p><button id="credits-close">Continuar explorando</button>`;
    this.el.credits.classList.remove('hidden');
    $('credits-close').onclick = () => this.el.credits.classList.add('hidden');
    this.ctx.sfx.victory();
  }
}
