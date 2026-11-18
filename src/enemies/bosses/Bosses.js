/**
 * Bosses.js
 * Os 7 guardiões corrompidos + o Rei Morto, da campanha "A Maré dos Sete Selos".
 * Cada chefe solta uma ARMA LENDÁRIA (def.legendary) e tem um GOLPE FINAL na fase 3
 * (aviso enorme no chão — só a esquiva no tempo certo salva). def.lore = história da ilha.
 * Cada definição: visual (build), vida, velocidade, alcance da arena e ataques.
 * Todo ataque perigoso é avisado antes com uma marca vermelha no chão (windup).
 */
import * as THREE from 'three/webgpu';
import { buildHumanoid, createHumanoidClips, createZombieClips, createActionClips } from '../../entities/HumanoidRig.js';
import { createSkinMaterial, createClothMaterial, createGoldMaterial, createScaleMaterial, createHideMaterial } from '../../entities/CharacterMaterials.js';
import { BlendSpace } from '../../utils/AnimUtils.js';
import { makeWarning } from './Boss.js';
import { buildScorpion, buildAlien, buildFireBeast } from './CreatureBosses.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const std = (color, o = {}) => new THREE.MeshStandardNodeMaterial({ color, roughness: 0.8, ...o });

// =============================================================================
// Visuais
// =============================================================================
/** Humanoide gigante (rig procedural) com mixer: walk/idle em blend + golpe one-shot. */
function humanoidBoss({ skin, shirt, pants, boots, scale, bulk = 1.4, coat = 0, hair = 0x222222, extra }) {
  return (ctx) => {
    const mats = { skin, shirt, pants, boots };
    const { root, nodes } = buildHumanoid(mats, { bulk, coatLength: coat, hair });
    root.scale.setScalar(scale);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    extra?.(root, nodes);
    const group = new THREE.Group();
    group.add(root);
    const hc = createHumanoidClips(), zc = createZombieClips(), ac = createActionClips();
    const mixer = new THREE.AnimationMixer(root);
    const blend = new BlendSpace(mixer, [hc.idle, hc.walk, hc.run]);
    blend.setTargets({ idle: 1 });
    return { root: group, body: root, nodes, mixer: { update: (dt) => blend.update(dt, 6) }, blend, anims: { swing: ac.swing, chop: ac.chop, slam: zc.attack, hurt: ac.hurt } };
  };
}

/** Javali gigante de ferro (Grakk). */
function buildBoar() {
  const g = new THREE.Group();
  const hide = createHideMaterial(0x4a3426, 0.6), iron = std(0x3a3d44, { metalness: 0.7, roughness: 0.4 }), tusk = std(0xe8e0c8, { roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 3.2, 6, 14), hide); body.rotation.x = Math.PI / 2; body.position.y = 2.6;
  const plate = new THREE.Mesh(new THREE.CapsuleGeometry(1.7, 2.2, 4, 12, 1), iron); plate.rotation.x = Math.PI / 2; plate.position.set(0, 3.1, 0.3); plate.scale.set(1, 0.6, 1);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 2.2), hide); head.position.set(0, 2.4, 3.0);
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.9, 12), hide); snout.rotation.x = Math.PI / 2; snout.position.set(0, 2.1, 4.3);
  g.add(body, plate, head, snout);
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.6, 8), tusk); t.position.set(s * 0.7, 2.0, 4.4); t.rotation.set(-1.0, 0, s * 0.5); g.add(t);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), std(0xff3010, { emissive: 0xff2000, emissiveIntensity: 3 })); eye.position.set(s * 0.6, 2.8, 4.05); g.add(eye);
    for (const z of [-1.6, 1.6]) {
      const leg = new THREE.Group(); leg.position.set(s * 1.1, 2.1, z);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 2.1, 8), hide); m.position.y = -1.05; leg.add(m);
      g.add(leg); (g.userData.legs ||= []).push(leg);
    }
  }
  for (let i = 0; i < 7; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 6), iron); sp.position.set(0, 4.0, -1.8 + i * 0.6); g.add(sp); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root: g };
}

/** Serpente marinha (Ysolde): corpo em segmentos que ondulam. */
function buildSerpent() {
  const g = new THREE.Group();
  const scales = createScaleMaterial(0x1d4a52), belly = std(0xc8b888);
  const segs = [];
  for (let i = 0; i < 16; i++) {
    const r = 1.6 - i * 0.07;
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), i % 2 ? scales : scales);
    s.scale.set(1, 0.9, 1.3);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 4), belly); fin.position.y = r * 0.9; s.add(fin);
    g.add(s); segs.push(s);
  }
  const head = segs[0];
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.4), scales); jaw.position.set(0, -0.3, 1.4); head.add(jaw);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), std(0xffe040, { emissive: 0xffc000, emissiveIntensity: 3 })); e.position.set(sx * 0.8, 0.6, 1.0); head.add(e);
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.6, 6), belly); h.position.set(sx * 0.6, 1.2, -0.3); h.rotation.x = -0.8; head.add(h);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root: g, segs };
}

// =============================================================================
// Projéteis mágicos e poças (usados por vários chefes)
// =============================================================================
const orbMat = (c) => std(c, { emissive: c, emissiveIntensity: 3 });
function spawnOrb(boss, { color = 0x8a40ff, speed = 9, homing = 1.6, dmg = 4, life = 7, from = null, dir = null, size = 0.55 }) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), orbMat(color));
  m.position.copy(from || boss.pos.clone().add(V(0, boss.height * 0.8, 0)));
  boss.ctx.scene.add(m);
  const v = dir ? dir.clone().multiplyScalar(speed) : boss.ctx.player.position.clone().add(V(0, 1.2, 0)).sub(m.position).normalize().multiplyScalar(speed);
  (boss.orbs ||= []).push({ m, v, homing, dmg, life, speed });
  boss.ctx.sfx.magic(m.position);
}
function updateOrbs(boss, dt) {
  if (!boss.orbs) return;
  const pl = boss.ctx.player, target = pl.position.clone().add(V(0, 1.2, 0));
  for (let i = boss.orbs.length - 1; i >= 0; i--) {
    const o = boss.orbs[i];
    o.life -= dt;
    if (o.homing) o.v.lerp(target.clone().sub(o.m.position).normalize().multiplyScalar(o.speed), 1 - Math.exp(-o.homing * dt));
    o.m.position.addScaledVector(o.v, dt);
    const hitP = o.m.position.distanceTo(target) < 1.1 && pl.state === 'foot';
    const g = boss.ctx.groundAt(o.m.position.x, o.m.position.z);
    if (hitP || o.life <= 0 || o.m.position.y < g) {
      if (hitP) pl.takeDamage(o.dmg, o.v.clone().normalize(), boss.name);
      boss.ctx.effects.burst('fire', o.m.position, 8, { speed: 3, up: 3, size: 0.25, life: 0.6 });
      o.m.removeFromParent(); boss.orbs.splice(i, 1);
    }
  }
}
function spawnLava(boss, at, r = 3.5, life = 6) {
  const m = makeWarning(boss.ctx.scene, 'circle', r);
  m.material.color.setHex(0xff6010); m.material.opacity = 0.75;
  m.position.set(at.x, boss.ctx.groundAt(at.x, at.z) + 0.1, at.z);
  (boss.pools ||= []).push({ m, r, life, tick: 0 });
  boss.ctx.sfx.fire(at);
}
function updatePools(boss, dt) {
  if (!boss.pools) return;
  for (let i = boss.pools.length - 1; i >= 0; i--) {
    const p = boss.pools[i];
    p.life -= dt; p.tick -= dt;
    p.m.material.opacity = 0.5 + Math.sin(p.life * 8) * 0.2;
    if (Math.random() < dt * 6) boss.ctx.effects.fire(p.m.position.clone().add(V((Math.random() - 0.5) * p.r, 0.2, (Math.random() - 0.5) * p.r)), 1);
    if (p.tick <= 0 && boss.ctx.player.state === 'foot' && boss.ctx.player.position.distanceTo(p.m.position) < p.r) { p.tick = 0.6; boss.ctx.player.takeDamage(2, null, 'lava'); }
    if (p.life <= 0) { p.m.removeFromParent(); boss.pools.splice(i, 1); }
  }
}
/** Chuva de balas/meteoros: círculos de aviso que explodem depois de 1,2 s. */
function barrage(boss, n, radius, dmg, color = 0xff8030) {
  const pp = boss.ctx.player.position;
  for (let i = 0; i < n; i++) {
    const at = pp.clone().add(V((Math.random() - 0.5) * radius * 2, 0, (Math.random() - 0.5) * radius * 2));
    const w = boss.warn('circle', 3, at);
    setTimeout(() => {
      w.removeFromParent();
      boss.ctx.effects.burst('fire', at.clone().setY(boss.ctx.groundAt(at.x, at.z) + 0.5), 14, { speed: 6, up: 6, size: 0.35, life: 0.8 });
      boss.ctx.sfx.cannon(at);
      if (boss.alive) boss.hitCircle(at, 3, dmg, 9);
    }, 1200 + i * 120);
  }
  void color;
}
function playAnim(boss, name, speed = 1) {
  const p = boss.parts;
  if (p.blend && p.anims?.[name]) p.blend.playOneShot(p.anims[name], { speed, weight: 4, fadeIn: 0.08, fadeOut: 0.2 });
}
/** Mantém o blend de locomoção do humanoide pela velocidade. */
function locomotion(boss) {
  const b = boss.parts.blend; if (!b) return;
  const k = Math.min(1, boss.speed / (boss.def.speed || 1));
  b.setTargets({ idle: 1 - k, walk: k * (boss.speed > 4 ? 0 : 1), run: k * (boss.speed > 4 ? 1 : 0) });
}

// =============================================================================
// Ataques reutilizáveis
// =============================================================================
const slam = (r, dmg, windup = 1.0, extra = null) => ({
  name: 'slam', range: r * 0.9, windup, duration: 0.5, cooldown: 2.2,
  start: (b) => { b.warn('circle', r, b.pos); playAnim(b, 'slam', 0.6); },
  exec: (b) => { b.ctx.sfx.slam(b.pos); b.ctx.effects.dust(b.pos.clone().setY(b.pos.y + 0.3)); b.hitCircle(b.pos, r, dmg, 12); b.ctx.shake?.(0.5); extra?.(b); },
});
const cone = (r, dmg, windup = 0.6, cooldown = 1.2) => ({
  name: 'cone', range: r * 0.85, windup, duration: 0.3, cooldown,
  start: (b) => { b._coneH = b.heading; b.warn('cone', { r, a: 1.6 }, b.pos, b.heading); playAnim(b, 'swing', 1.4); },
  exec: (b) => {
    b.ctx.sfx.swing(true, b.pos);
    const pp = b.ctx.player.position, d = Math.hypot(pp.x - b.pos.x, pp.z - b.pos.z);
    const ang = Math.atan2(pp.x - b.pos.x, pp.z - b.pos.z) - b._coneH;
    if (d < r && Math.cos(ang) > Math.cos(0.8)) b.hitCircle(pp, 0.1 + d, dmg, 9);
  },
});
const orbs = (n, opt = {}) => ({
  name: 'orbs', range: 40, minRange: 5, windup: 0.8, duration: 0.2 + n * 0.25, cooldown: 3,
  start: (b) => playAnim(b, 'swing', 0.8),
  exec: (b) => { for (let i = 0; i < n; i++) setTimeout(() => b.alive && spawnOrb(b, opt), i * 250); },
});
const summon = (n) => ({
  name: 'summon', range: 50, windup: 1.2, duration: 0.5, cooldown: 9, phase: 2,
  start: (b) => { b.ctx.sfx.magic(b.pos); b.ctx.hud.toast(`${b.name} invoca os mortos!`, 1.5); },
  exec: (b) => { for (let i = 0; i < n; i++) b.ctx.enemies.spawnZombie(b.pos, 4, 9); },
});
/** GOLPE FINAL (fase 3): área enorme, aviso longo — role (Ctrl) no último instante. */
const ultimate = (r, dmg, label, color = 0xff2a10) => ({
  name: 'ultimate', range: r * 0.8, windup: 1.8, duration: 0.6, cooldown: 12, phase: 3,
  start: (b) => {
    const w = b.warn('circle', r, b.pos); w.material.color.setHex(color);
    b.ctx.hud.toast(`⚠ ${label}`, 1.6); b.ctx.sfx.bossRoar(b.pos); playAnim(b, 'slam', 0.45);
  },
  windupUpdate: (b) => { b.ctx.shake?.(0.08); },
  exec: (b) => {
    b.ctx.sfx.slam(b.pos); b.ctx.shake?.(1.3);
    b.ctx.cfx?.ring(b.pos, { radius: r * 1.1, color, life: 0.6 });
    b.ctx.cfx?.ring(b.pos, { radius: r * 0.6, color: 0xffffff, life: 0.4 });
    for (let i = 0; i < 6; i++) b.ctx.effects.dust(b.pos.clone().add(V((Math.random() - 0.5) * r, 0.3, (Math.random() - 0.5) * r)));
    b.hitCircle(b.pos, r, dmg, 18);
  },
});
/** Raio no jogador (aviso azul que cresce; o golpe sai quando enche). */
function lightningAt(b, at, dmg = 7, r = 3.2, delay = 900) {
  const tele = b.ctx.cfx?.telegraph('circle', at, { time: delay / 1000, size: r, color: 0x6aa8ff });
  setTimeout(() => {
    if (!b.alive) return;
    if (b.ctx.weather) b.ctx.weather.strike(at, 10); else b.ctx.cfx?.bolt(at);
    b.hitCircle(at, r, dmg, 7);
  }, delay);
  return tele;
}

/** Nimbra, a Senhora da Tempestade: flutua, manto de névoa, olhos azuis. */
function buildNimbra() {
  const make = humanoidBoss({ skin: createSkinMaterial({ tone: 0xb8c8d8, blood: [0.4, 0.5, 0.7], scale: 2 }), shirt: createClothMaterial(0x24364a, { soot: 0.2 }), pants: createClothMaterial(0x1a2636), boots: createClothMaterial(0x101820), scale: 2.1, bulk: 1.0, coat: 1.0, hair: 0xe8f0ff,
    extra: (root, n) => {
      for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), orbMat(0x6ab8ff)); e.position.set(sx * 0.045, 0.13, 0.11); n.head.add(e); }
      const crown = new THREE.Group();
      for (let i = 0; i < 7; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.16, 4), orbMat(0x9fd8ff)); const a = (i / 7) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.12, 0.28, Math.sin(a) * 0.12); crown.add(sp); }
      n.head.add(crown);
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.6, 6), std(0x2a3a4a, { metalness: 0.6 })); staff.rotation.x = Math.PI / 2; staff.position.z = 0.4; n.handR.add(staff);
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), orbMat(0x8ac8ff)); orb.position.z = 1.2; n.handR.add(orb);
      // manto de névoa translúcido
      const veil = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 16, 1, true), new THREE.MeshStandardNodeMaterial({ color: 0x2a3a58, emissive: 0x1a3060, emissiveIntensity: 0.6, transparent: true, opacity: 0.45, roughness: 1, side: THREE.DoubleSide, depthWrite: false }));
      veil.position.y = -0.2; n.hips.add(veil);
      const glow = new THREE.PointLight(0x7ab0ff, 25, 16, 2); glow.position.y = 1.4; root.add(glow);
    } });
  return (ctx) => { const r = make(ctx); r.float = r.body; return r; };
}

const charge = (len, dmg, speed = 22) => ({
  name: 'charge', range: len, minRange: 6, windup: 1.1, duration: len / speed + 0.2, cooldown: 3,
  start: (b) => { b._chH = b.heading; b.warn('line', { w: b.radius * 2, l: len }, b.pos, b.heading); b.ctx.sfx.bossRoar(b.pos); },
  exec: (b) => { b._chHit = false; b.speed = speed; b.heading = b._chH; },
  attackUpdate: (b) => {
    b.speed = speed; b.heading = b._chH;
    if (!b._chHit && b.hitLine(b.pos, b.heading, b.radius * 2.2, b.radius * 1.5, dmg, 16)) b._chHit = true;
    // bater em árvore/pedra: atordoa (ponto fraco do Grakk)
    const p = b.pos;
    if (!b.ctx.colliders.isFree(p.x + Math.sin(b.heading) * b.radius, p.z + Math.cos(b.heading) * b.radius, 0.6)) {
      b.ctx.sfx.slam(p); b.ctx.effects.dust(p.clone().setY(p.y + 1)); b.ctx.shake?.(0.6);
      b.ctx.hud.toast(`${b.name} bateu e ficou atordoado!`, 1.5);
      b.speed = 0; b.stunFor(3.5);
    }
  },
  end: (b) => { b.speed = 0; },
});

// =============================================================================
// Definições
// =============================================================================
export const BOSSES = [
  {
    id: 'grakk', order: 1, name: 'Grakk, o Javali de Ferro', island: 'Ilha das Raízes',
    seal: 'Selo da Terra', reward: 'Espada de aço (+dano)',
    hp: 160, speed: 3.2, radius: 2.4, height: 4.2, wakeRange: 30, leash: 70, heavy: true,
    intro: 'Um rugido sacode as árvores. Grakk, o Javali de Ferro, desperta! Dica: faça-o investir contra árvores ou pedras para atordoá-lo.',
    build: () => buildBoar(),
    legendary: 'legend_hammer',
    lore: ['As Raízes guardavam a terra fértil do arquipélago. Grakk era o protetor das florestas — até Varkhul cravar uma coroa de ferro em seu crânio.', 'Agora ele derruba as árvores que jurou proteger. Dizem que, ao cair, deixa para trás o Martelo das Raízes.'],
    attacks: [charge(26, 6), cone(5, 4, 0.5, 1.4), slam(6, 5, 1.0), ultimate(10, 12, 'GRAKK VAI ESMAGAR TUDO — ROLE!', 0xff6a10)],
    update: (b, dt) => {
      const legs = b.root.userData.legs || [];
      const t = (b._t = (b._t || 0) + dt * (1 + b.speed));
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 2.2 + (i % 2) * Math.PI) * Math.min(0.6, b.speed * 0.08); });
    },
    loot: [['metal_bar', 4], ['raw_meat', 6], ['leather', 5], ['gold_coin', 3]],
  },
  {
    id: 'vesna', order: 2, name: 'Vesna, a Bruxa do Pântano', island: 'Ilha da Névoa',
    seal: 'Selo da Névoa', reward: 'Arco longo (+alcance)',
    hp: 170, speed: 2.2, radius: 1.2, height: 3.4, wakeRange: 32, leash: 70, keepDistance: 12,
    intro: 'Risos ecoam na névoa... Vesna, a Bruxa do Pântano! Ela é frágil de perto — e fica vulnerável enquanto conjura.',
    build: humanoidBoss({ skin: createSkinMaterial({ tone: 0x9aa884, blood: [0.4, 0.5, 0.3], scale: 2 }), shirt: createClothMaterial(0x2a1a38, { soot: 0.3 }), pants: createClothMaterial(0x1a1222), boots: createClothMaterial(0x111111), scale: 1.8, bulk: 0.9, coat: 0.9, hair: 0xd8d8d0,
      extra: (root, n) => { const hat = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 10), std(0x1a1222)); hat.position.y = 0.35; n.head.add(hat); const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.4, 6), std(0x3a2a1a)); staff.rotation.x = Math.PI / 2; staff.position.z = 0.4; n.handR.add(staff); const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), orbMat(0x8a40ff)); gem.position.z = 1.1; n.handR.add(gem); } }),
    legendary: 'legend_mistbow',
    lore: ['A Ilha da Névoa era o lar das curandeiras. Vesna era a mais sábia delas, e a primeira a ouvir os sussurros do Rei Morto.', 'Seu Arco da Névoa nunca errava um alvo. Se ela cair, a névoa vai obedecer a você.'],
    attacks: [orbs(3, { color: 0x8a40ff, speed: 8, homing: 1.4, dmg: 4 }), cone(3.5, 3, 0.4, 1.0), summon(3),
      { ...orbs(6, { color: 0x40ff80, speed: 11, homing: 0.6, dmg: 3 }), phase: 3 }, ultimate(9, 11, '"A NÉVOA DEVORA TUDO!"', 0x9a40ff)],
    update: (b, dt) => { locomotion(b); updateOrbs(b, dt); },
    loot: [['feather', 8], ['arrow', 30], ['gold_coin', 4], ['cooked_meat', 4]],
  },
  {
    id: 'korrak', order: 3, name: 'Korrak, o Golem de Pedra', island: 'Ilha das Pedras',
    seal: 'Selo da Pedra', reward: 'Picareta de aço',
    hp: 260, speed: 2.0, radius: 2.2, height: 6, wakeRange: 30, leash: 70, armored: true, heavy: true,
    intro: 'O chão treme. Korrak, o Golem de Pedra, se ergue! A espada não fere sua armadura: rache-a com a PICARETA.',
    build: humanoidBoss({ skin: std(0x6e685f, { flatShading: true }), shirt: std(0x5a554c, { flatShading: true }), pants: std(0x4a453e, { flatShading: true }), boots: std(0x3a362f), scale: 3.2, bulk: 1.8, hair: 0x3a362f,
      extra: (root, n) => { for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.1), std(0x7a746a, { flatShading: true })); r.position.set((Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.5, 0.12); n.torso.add(r); } const core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), orbMat(0x40c0ff)); core.position.set(0, 0.35, 0.16); n.torso.add(core); } }),
    attacks: [slam(8, 6, 1.2), cone(5, 5, 0.8, 1.8),
      { ...orbs(1, { color: 0x8a8070, speed: 18, homing: 0, dmg: 6, size: 1.0 }), name: 'rock' },
      { ...slam(12, 7, 1.5), phase: 2 }, ultimate(13, 14, 'KORRAK ARRANCA O CHÃO — ROLE!', 0xc8b088)],
    legendary: 'legend_gauntlet',
    lore: ['Korrak foi esculpido pelos primeiros mineiros para guardar os veios de ouro. Seu coração é um cristal azul.', 'A Maré Negra transformou a pedra em ódio. Só a picareta racha a armadura — e de suas mãos sai a Manopla do Golem.'],
    update: (b, dt) => { locomotion(b); updateOrbs(b, dt); },
    loot: [['iron_ore', 10], ['coal', 10], ['gold_coin', 5], ['stone', 20]],
  },
  {
    id: 'morrigan', order: 4, name: 'Capitã Morrigan, a Afogada', island: 'Baía Quebrada',
    seal: 'Selo do Mar', reward: 'Canhões reforçados (+dano, recarga menor)',
    hp: 240, speed: 4.2, radius: 1.1, height: 3.2, wakeRange: 28, leash: 70,
    intro: '"Mais um rato de porão para minha tripulação!" — Capitã Morrigan desembainha a espada. Esquive (Ctrl) dos combos!',
    build: humanoidBoss({ skin: createSkinMaterial({ tone: 0x8ab0a8, blood: [0.3, 0.5, 0.5], scale: 2 }), shirt: createClothMaterial(0x3a1a1a, { soot: 0.4 }), pants: createClothMaterial(0x1a1a22), boots: createClothMaterial(0x0c0a08), scale: 1.7, bulk: 1.0, coat: 0.8, hair: 0x101418,
      extra: (root, n) => { const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.12, 3), std(0x111111)); hat.position.y = 0.26; n.head.add(hat); const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.9), std(0xb8c4cc, { metalness: 0.8, roughness: 0.25 })); blade.position.z = 0.5; n.handR.add(blade); n.torso.children[0].material = createGoldMaterial(); } }),
    attacks: [cone(3.6, 4, 0.35, 0.7), cone(3.6, 4, 0.3, 0.5), charge(12, 4, 16),
      { name: 'barrage', range: 60, windup: 1.0, duration: 0.6, cooldown: 7, phase: 2,
        start: (b) => b.ctx.hud.toast('"FOGO!" — o navio fantasma da Capitã abre fogo!', 1.5),
        exec: (b) => barrage(b, 6, 10, 5) }, ultimate(9, 12, '"AFUNDE COMIGO!"', 0x2ab0d0)],
    legendary: 'legend_saber',
    lore: ['A Capitã Morrigan comandava a frota da Guilda. Na noite da Maré Negra, seu navio afundou com toda a tripulação.', 'Ela voltou do fundo do mar com o Sabre da Afogada — uma lâmina que ainda carrega a força das ondas.'],
    onPhase: (b, ph) => { if (ph === 2) { const p = b.pos; b.ctx.enemies.spawnGhostShip(p, 90, 140); } },
    update: (b, dt) => locomotion(b),
    loot: [['cannonball', 30], ['gold_coin', 8], ['metal_bar', 3]],
  },
  {
    id: 'ysolde', order: 5, name: 'Ysolde, a Serpente das Marés', island: 'Recife Vermelho', aquatic: true,
    seal: 'Selo das Marés', reward: 'Casco reforçado (+100 de casco)',
    hp: 320, speed: 6, radius: 2.4, height: 3, wakeRange: 120, leash: 400, keepDistance: 35,
    intro: 'O mar ferve e uma sombra imensa circula o navio... Ysolde, a Serpente das Marés! Use os CANHÕES quando ela emergir.',
    build: () => buildSerpent(),
    attacks: [
      { name: 'tail', range: 60, windup: 1.4, duration: 0.6, cooldown: 3.5,
        start: (b) => { b._tgt = b.ctx.player.boat?.root.position.clone(); if (b._tgt) b.warn('circle', 14, b._tgt); },
        exec: (b) => { const boat = b.ctx.player.boat; if (!b._tgt) return; b.ctx.sfx.splash(b._tgt, true); b.ctx.effects.splash(b._tgt.clone().setY(0.5), true);
          if (boat && boat.root.position.distanceTo(b._tgt) < 15) { boat.takeDamage(22); b.ctx.shake?.(0.7); } } },
      { name: 'dive', range: 200, windup: 0.5, duration: 4, cooldown: 4,
        start: (b) => { b.submerged = true; b.ctx.hud.toast('Ysolde mergulhou...', 1.2); },
        exec: (b) => { const t = b.ctx.player.boat?.root.position; if (t) { const a = Math.random() * 6.28; b.pos.set(t.x + Math.cos(a) * 45, b.pos.y, t.z + Math.sin(a) * 45); } },
        end: (b) => { b.submerged = false; b.ctx.sfx.bossRoar(b.pos); b.ctx.effects.splash(b.pos.clone().setY(0.5), true); } },
      { ...orbs(4, { color: 0x30d0ff, speed: 14, homing: 0.4, dmg: 0 }), name: 'spit', range: 90, phase: 2,
        exec: (b) => { const boat = b.ctx.player.boat; if (boat) { for (let i = 0; i < 3; i++) setTimeout(() => { if (b.alive) { boat.takeDamage(8); b.ctx.sfx.shipHit(boat.root.position); } }, 600 + i * 300); } } },
      { name: 'tsunami', range: 90, windup: 2.2, duration: 0.8, cooldown: 12, phase: 3,
        start: (b) => { b.ctx.hud.toast('⚠ Ysolde ergue um TSUNAMI — afaste o navio!', 2); b._tgt = b.ctx.player.boat?.root.position.clone(); if (b._tgt) b.warn('circle', 26, b._tgt); },
        exec: (b) => { const boat = b.ctx.player.boat; if (!b._tgt) return; b.ctx.effects.splash(b._tgt.clone().setY(0.5), true); b.ctx.shake?.(1.2);
          if (boat && boat.root.position.distanceTo(b._tgt) < 26) boat.takeDamage(45); } },
    ],
    legendary: 'legend_trident',
    lore: ['Ysolde guiava os navios pelos recifes. Os marinheiros deixavam oferendas de coral para a serpente das marés.', 'Hoje ela afunda qualquer casco. Seu Tridente das Marés faz até os tubarões fugirem.'],
    update: (b, dt) => {
      // ondulação: os segmentos seguem a cabeça em espiral
      const t = (b._t = (b._t || 0) + dt);
      b.parts.segs.forEach((s, i) => { s.position.set(Math.sin(t * 2 - i * 0.5) * 1.5, Math.sin(t * 2.6 - i * 0.6) * 0.8 + (b.submerged ? -6 : 0) - i * 0.05, -i * 1.9); });
      // circula o navio quando não ataca
      if (b.state === 'chase' && b.ctx.player.boat) {
        const bp = b.ctx.player.boat.root.position; const a = Math.atan2(b.pos.x - bp.x, b.pos.z - bp.z) + 0.4;
        const target = V(bp.x + Math.sin(a) * 35, 0, bp.z + Math.cos(a) * 35); b.faceTo(target, 2, dt);
      }
    },
    getHitSpheres: true,
    loot: [['gold_coin', 12], ['metal_bar', 6], ['cannonball', 20]],
  },
  {
    id: 'ignar', order: 6, name: 'Ignar, o Escorpião da Forja Negra', island: 'Ilha da Forja Negra',
    seal: 'Selo do Fogo', reward: 'Machado rúnico (+dano)',
    hp: 360, speed: 3.2, radius: 1.7, height: 4.6, wakeRange: 30, leash: 70, heavy: true,
    intro: 'O chão racha e a lava sobe. Ignar, fundido à própria forja, virou um ESCORPIÃO de brasa! As pinças protegem a frente — ataque pelas COSTAS. Se ele te agarrar, ESQUIVE (Ctrl).',
    build: () => buildScorpion(),
    // pinças em guarda: −50% de dano pela frente (pelas costas, dano cheio)
    damageMult: (b) => {
      if (b.state !== 'chase' || b.broken > 0) return 1;
      const pp = b.ctx.player.position, dx = pp.x - b.pos.x, dz = pp.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
      const front = (dx * Math.sin(b.heading) + dz * Math.cos(b.heading)) / d > 0.35;
      if (front && !b._guardTip) { b._guardTip = true; b.ctx.hud.toast('As pinças bloqueiam! Role para as COSTAS dele.', 1.8); }
      if (front) b.ctx.sfx.hitMetal(b.pos);
      return front ? 0.5 : 1;
    },
    attacks: [
      { ...cone(4.8, 6, 0.6, 1.2), name: 'scissor' },
      { name: 'sting', range: 10, minRange: 2, windup: 0.9, duration: 0.45, cooldown: 2.6,
        start: (b) => { b._sh = b.heading; b.warn('line', { w: 1.8, l: 10 }, b.pos, b.heading); },
        exec: (b) => {
          b.hitLine(b.pos, b._sh, 1.8, 10, 7, 10);
          const end = b.pos.clone().add(V(Math.sin(b._sh) * 8, 0, Math.cos(b._sh) * 8));
          spawnLava(b, end, 2.5, 4); b.ctx.sfx.slam(end); b.ctx.effects.burst('fire', end.clone().setY(b.ctx.groundAt(end.x, end.z) + 0.4), 12, { speed: 5, up: 4, size: 0.2, life: 0.6 });
        } },
      { name: 'grab', range: 5, windup: 0.75, duration: 0.4, cooldown: 6,
        start: (b) => { b.warn('cone', { r: 4.5, a: 1.2 }, b.pos, b.heading); },
        exec: (b) => {
          const pl = b.ctx.player, pp = pl.position, dx = pp.x - b.pos.x, dz = pp.z - b.pos.z, d = Math.hypot(dx, dz);
          if (pl.state === 'foot' && d < 4.8 && (dx * Math.sin(b.heading) + dz * Math.cos(b.heading)) / (d || 1) > 0.4 && !(pl.dodgeT > 0)) {
            b.grabbing = 2.2; b._gtick = 0;
            b.ctx.hud.toast('🦂 IGNAR TE AGARROU! Aperte ESQUIVA (Ctrl) para escapar!', 2);
          }
        } },
      { ...orbs(5, { color: 0xff6a10, speed: 12, homing: 0.5, dmg: 4, size: 0.4 }), name: 'embers', phase: 2 },
      { ...charge(16, 6, 18), name: 'clawCharge', phase: 2 },
      { name: 'rain', range: 50, windup: 1, duration: 0.5, cooldown: 8, phase: 3, start: (b) => b.ctx.hud.toast('A cauda cospe uma chuva de brasas!', 1.2), exec: (b) => barrage(b, 8, 12, 5) },
      ultimate(10, 13, 'ERUPÇÃO! — ROLE PARA FORA!', 0xff4010)],
    legendary: 'legend_dagger',
    lore: ['Ignar foi o maior ferreiro do arquipélago — mestre de Bruno. Foi ele quem forjou os Selos da Maré.', 'Varkhul o atirou na própria forja. A lava fundiu carne e ferro: o que saiu de lá foi um escorpião de brasa. Só a Adaga Derretida ainda brilha como no primeiro dia.'],
    update: (b, dt) => {
      b.parts.animate(b, dt); updateOrbs(b, dt); updatePools(b, dt);
      // agarrão: segura o jogador na pinça até ele esquivar
      if (b.grabbing > 0) {
        const pl = b.ctx.player;
        b.grabbing -= dt;
        if (pl.dodgeT > 0 || pl.stats?.dead || pl.state !== 'foot') { b.grabbing = 0; b.ctx.hud.toast('Escapou da pinça!', 1); b.stunFor(0.8); return; }
        const gx = b.pos.x + Math.sin(b.heading) * 2.6, gz = b.pos.z + Math.cos(b.heading) * 2.6;
        pl.position.x = gx; pl.position.z = gz; pl.knock.set(0, 0, 0);
        b._gtick -= dt;
        if (b._gtick <= 0) { b._gtick = 0.45; pl.takeDamage(1.5, V(Math.sin(b.heading), 0, Math.cos(b.heading)), b.name); b.ctx.shake?.(0.25); }
        if (b.grabbing <= 0) { pl.knock.set(Math.sin(b.heading) * 14, 0, Math.cos(b.heading) * 14); b.ctx.hud.toast('Ignar te arremessou!', 1); }
      }
    },
    loot: [['metal_bar', 8], ['coal', 15], ['gold_coin', 8], ['ignar_ember', 1]],
  },
  {
    id: 'nimbra', order: 7, name: 'Nimbra, a Abominação da Tempestade', island: 'Ilha das Chuvas Eternas', islandIndex: 7,
    seal: 'Selo da Tempestade', reward: 'O céu se abre e seu fôlego recupera 30% mais rápido',
    hp: 420, speed: 5.2, radius: 1.9, height: 3.2, wakeRange: 34, leash: 80, keepDistance: 6,
    intro: 'Um trovão rasga o céu e algo RASTEJA entre as árvores... Nimbra, a Abominação da Tempestade! Ela salta — fuja do círculo onde vai cair. Os raios caem nos círculos AZUIS.',
    build: () => buildAlien(),
    legendary: 'legend_frostaxe',
    lore: ['Há gerações, Nimbra trazia as chuvas que enchiam os rios do arquipélago. Os mundos da chuva eram o seu jardim.', 'Varkhul a fundiu à tempestade: o que restou é uma abominação de carapaça e relâmpago, de olhos roxos, que rasteja entre os pinheiros. Os Tubarões-Rei rondam a costa como cães de guarda.', 'Derrote-a e o sol voltará. De seu peito sai o Machado de Gelo, nascido da primeira geada.'],
    attacks: [
      { name: 'pounce', range: 24, minRange: 5, windup: 0.8, duration: 0.75, cooldown: 3.2,
        start: (b) => { b._pt = b.ctx.player.position.clone(); b.warn('circle', 4, b._pt); b.ctx.sfx.bossRoar(b.pos); },
        exec: (b) => { b._pf = b.pos.clone(); b._pk = 0; },
        attackUpdate: (b, dt) => {
          b._pk = Math.min(1, b._pk + dt / 0.75); b.speed = 0;
          b.pos.x = THREE.MathUtils.lerp(b._pf.x, b._pt.x, b._pk); b.pos.z = THREE.MathUtils.lerp(b._pf.z, b._pt.z, b._pk);
          b.heading = Math.atan2(b._pt.x - b._pf.x, b._pt.z - b._pf.z);
        },
        end: (b) => { b.ctx.sfx.slam(b.pos); b.ctx.shake?.(0.6); b.ctx.cfx?.ring(b.pos, { radius: 5, color: 0xb040ff, life: 0.45 }); b.ctx.effects.dust(b.pos.clone().setY(b.pos.y + 0.3)); b.hitCircle(b.pos, 4, 8, 12); } },
      { ...cone(5, 7, 0.6, 1.0), name: 'clawX' },
      { name: 'tailWhip', range: 7, windup: 0.7, duration: 0.5, cooldown: 3.5,
        start: (b) => { b.warn('circle', 7.5, b.pos).material.color.setHex(0xb040ff); },
        exec: (b) => { b._wh = false; },
        attackUpdate: (b, dt) => { b.heading += dt * 11; if (!b._wh) { b._wh = true; b.ctx.sfx.swing(true, b.pos); b.hitCircle(b.pos, 7.5, 6, 13); } } },
      { name: 'lightning', range: 40, windup: 0.5, duration: 0.3, cooldown: 2.2,
        start: (b) => { b._la = b.ctx.player.position.clone(); },
        exec: (b) => { lightningAt(b, b._la, 7, 3.2, 900); } },
      { name: 'storm', range: 60, windup: 1.0, duration: 2.4, cooldown: 7, phase: 2,
        start: (b) => { b.ctx.hud.toast('⛈ TEMPESTADE! Fuja dos círculos azuis!', 1.5); b.ctx.sfx.bossRoar(b.pos); },
        exec: (b) => { const pp = b.ctx.player.position; for (let i = 0; i < 8; i++) setTimeout(() => { if (b.alive) lightningAt(b, pp.clone().add(V((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16)), 6, 3, 800); }, i * 260); } },
      { name: 'sharks', range: 60, windup: 1.2, duration: 0.5, cooldown: 14, phase: 2,
        start: (b) => b.ctx.hud.toast('Nimbra chama os tubarões das profundezas!', 1.5),
        exec: (b) => { for (let i = 0; i < 2; i++) b.ctx.sharks?.spawnNear('tiger', b.pos, 30); } },
      { name: 'eye', range: 40, windup: 1.2, duration: 4, cooldown: 14, phase: 3,
        start: (b) => { b.ctx.hud.toast('🌀 OLHO DO FURACÃO — resista ao vento e role na hora certa!', 2); b.warn('circle', 5, b.pos).material.color.setHex(0x6aa8ff); },
        exec: (b) => { b._eyeT = 0; },
        attackUpdate: (b, dt) => {
          const pl = b.ctx.player, pp = pl.position;
          b._eyeT += dt;
          const dx = b.pos.x - pp.x, dz = b.pos.z - pp.z, d = Math.hypot(dx, dz) || 1;
          if (pl.state === 'foot') pl.knock.set(dx / d * 3.2, 0, dz / d * 3.2);
          if (Math.random() < dt * 2.2) lightningAt(b, pp.clone().add(V((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8)), 6, 3, 700);
          if (b._eyeT > 3.5 && !b._eyeHit) { b._eyeHit = true; b.ctx.cfx?.ring(b.pos, { radius: 6, color: 0xb040ff, life: 0.5 }); b.hitCircle(b.pos, 5, 13, 16); }
        },
        end: (b) => { b._eyeHit = false; } },
      ultimate(11, 13, '"A TEMPESTADE TE ENGOLE!" — ROLE!', 0xb040ff)],
    onPhase: (b, ph) => { if (ph === 3 && b.ctx.weather) b.ctx.weather.forcedStorm = true; },
    update: (b, dt) => {
      b.parts.animate(b, dt); updateOrbs(b, dt);
      if (Math.random() < dt * 4) b.ctx.effects.burst('mist', b.pos.clone().add(V((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3)), 1, { speed: 0.4, up: 0.6, size: 0.06, life: 0.9, gravity: -0.2 });
    },
    loot: [['gold_coin', 30], ['metal_bar', 6], ['rain_journal', 1], ['shark_fin', 2]],
  },
  {
    id: 'varkhul', order: 8, name: 'Rei Morto Varkhul', island: 'Ilha da Coroa', final: true, islandIndex: 6,
    seal: 'Coroa da Maré', reward: 'O arquipélago está livre!',
    hp: 600, speed: 3.4, radius: 1.8, height: 5.5, wakeRange: 34, leash: 90, heavy: true,
    intro: '"Sete selos... trazidos até mim. Que tolice." — O Rei Morto Varkhul se ergue do trono de ossos. Esta é a batalha final!',
    build: (ctx) => {
      const h = humanoidBoss({ skin: std(0xd8d0b8, { roughness: 0.7 }), shirt: createClothMaterial(0x281828, { soot: 0.5 }), pants: createClothMaterial(0x181018), boots: createClothMaterial(0x0c080c), scale: 2.8, bulk: 1.3, coat: 0.9, hair: 0x0c0c0c,
        extra: (root, n) => { const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.12, 8, 1, true), createGoldMaterial()); crown.position.y = 0.26; n.head.add(crown); for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), orbMat(0xff6020)); e.position.set(sx * 0.04, 0.13, 0.11); n.head.add(e); } const sword = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 1.4), orbMat(0x30ff90)); sword.position.z = 0.75; n.handR.add(sword); } })(ctx);
      const beast = buildFireBeast();
      beast.root.visible = false;
      h.root.add(beast.root);
      h.beast = beast;
      return h;
    },
    // fera: a espada cravada nas costas é o ponto fraco (×1,5 por trás)
    damageMult: (b) => {
      if (b.form !== 'beast') return 1;
      const pp = b.ctx.player.position, dx = pp.x - b.pos.x, dz = pp.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
      const behind = (dx * Math.sin(b.heading) + dz * Math.cos(b.heading)) / d < -0.3;
      if (behind && !b._backTip) { b._backTip = true; b.ctx.hud.toast('A espada nas costas é o PONTO FRACO! (+50% de dano)', 2); }
      return behind ? 1.5 : 1;
    },
    attacks: [
      { ...cone(5, 6, 0.5, 1.0), maxPhase: 1 }, { ...slam(8, 7, 1.0), maxPhase: 1 }, { ...charge(20, 6, 18), maxPhase: 1 },
      { ...orbs(4, { color: 0xff6020, speed: 10, homing: 1.2, dmg: 4 }), maxPhase: 1 },
      // ---- forma de FERA (fase 2+) ----
      { ...cone(6.5, 8, 0.65, 1.2), name: 'paws', phase: 2 },
      { name: 'bulb', range: 13, windup: 1.1, duration: 0.5, cooldown: 3, phase: 2,
        start: (b) => { b._bp = b.pos.clone().add(V(Math.sin(b.heading) * 7, 0, Math.cos(b.heading) * 7)); b.warn('circle', 4.5, b._bp); },
        exec: (b) => { const p = b._bp; b.ctx.sfx.slam(p); b.ctx.shake?.(0.8); b.ctx.cfx?.ring(p, { radius: 6, color: 0xff6010, life: 0.5 }); b.hitCircle(p, 4.5, 9, 14); spawnLava(b, p, 4, 6); } },
      { name: 'breath', range: 14, windup: 0.8, duration: 2.2, cooldown: 6, phase: 2,
        start: (b) => { b._bh = b.heading; b.warn('cone', { r: 13, a: 2.1 }, b.pos, b.heading); b.ctx.sfx.bossRoar(b.pos); },
        exec: (b) => { b._btick = 0; b.ctx.sfx.fire(b.pos); },
        attackUpdate: (b, dt) => {
          b._btick -= dt;
          const yaw = b._bh + Math.sin((b.timer || 0) * 2.2) * 1.0;
          for (let i = 0; i < 2; i++) { const r = 2 + Math.random() * 11, a = yaw + (Math.random() - 0.5) * 0.4; b.ctx.effects.burst('fire', b.pos.clone().add(V(Math.sin(a) * r, 1 + Math.random() * 2, Math.cos(a) * r)), 2, { speed: 2, up: 2, size: 0.4, life: 0.6, gravity: -0.6 }); }
          if (b._btick <= 0) {
            b._btick = 0.3;
            const pp = b.ctx.player.position, dx = pp.x - b.pos.x, dz = pp.z - b.pos.z, d = Math.hypot(dx, dz);
            if (d < 13 && (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / (d || 1) > 0.75) b.hitCircle(pp, 0.1 + 0.01, 2.5, 3);
          }
        } },
      { name: 'leap', range: 30, minRange: 8, windup: 0.9, duration: 0.9, cooldown: 5, phase: 2,
        start: (b) => { b._lt = b.ctx.player.position.clone(); b.warn('circle', 6, b._lt); b.ctx.sfx.bossRoar(b.pos); },
        exec: (b) => { b._lf = b.pos.clone(); b._lk = 0; },
        attackUpdate: (b, dt) => {
          b._lk = Math.min(1, b._lk + dt / 0.9); b.speed = 0;
          b.pos.x = THREE.MathUtils.lerp(b._lf.x, b._lt.x, b._lk); b.pos.z = THREE.MathUtils.lerp(b._lf.z, b._lt.z, b._lk);
          b.leapY = Math.sin(b._lk * Math.PI) * 6;
        },
        end: (b) => { b.leapY = 0; b.ctx.sfx.slam(b.pos); b.ctx.shake?.(1.1); b.ctx.cfx?.ring(b.pos, { radius: 8, color: 0xff6010, life: 0.55 }); b.ctx.cfx?.spikes([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: b.pos.x + Math.cos(i * 0.785) * 3.5, z: b.pos.z + Math.sin(i * 0.785) * 3.5 })), { kind: 'fire', height: 1.6, life: 1.4 }); b.hitCircle(b.pos, 6, 10, 16); } },
      { name: 'crown', range: 60, windup: 1.2, duration: 0.5, cooldown: 7, phase: 3, start: (b) => b.ctx.hud.toast('"COROA DE CHAMAS!" — meteoros!', 1.3), exec: (b) => barrage(b, 12, 13, 6) },
      ultimate(14, 15, '"FIM DA MARÉ!" — ROLE NO ÚLTIMO INSTANTE!', 0xff4010)],
    onPhase: (b, ph) => {
      if (ph !== 2 || b.form === 'beast') return;
      // TRANSFORMAÇÃO: o rei se rasga e vira a fera de fogo
      b._transformT = 2.6;
      b.stunFor(2.6);
      b.ctx.hud.toast('🔥 "ESTA CARNE ME LIMITAVA!" — Varkhul se transforma!', 3);
      b.ctx.sfx.bossRoar(b.pos); b.ctx.shake?.(1);
      b.ctx.cfx?.ring(b.pos, { radius: 9, color: 0xff5010, life: 0.8 });
      for (let i = 0; i < 4; i++) setTimeout(() => b.alive && b.ctx.effects.burst('fire', b.pos.clone().setY(b.pos.y + 2 + i), 25, { speed: 7, up: 6, size: 0.35, life: 1.0, gravity: -0.4 }), i * 250);
    },
    update: (b, dt) => {
      const P = b.parts;
      if (b._transformT > 0) {
        b._transformT -= dt;
        const k = 1 - Math.max(0, b._transformT) / 2.6;
        P.body.scale.setScalar(2.8 * (1 + k * 0.5)); P.body.visible = k < 0.6;
        P.beast.root.visible = k >= 0.6; P.beast.root.scale.setScalar(Math.min(1, 0.4 + (k - 0.6) * 1.5));
        if (b._transformT <= 0) {
          b.form = 'beast'; P.body.visible = false; P.beast.root.visible = true; P.beast.root.scale.setScalar(1);
          b.name = 'Varkhul, a Fera da Coroa em Chamas'; b.radius = 2.6; b.height = 7.2; b._sph[0].r = 2.6; b._sph[1].r = 1.8;
          b.def.speed = 4.4;
        }
      }
      if (b.form === 'beast') P.beast.animate(b, dt);
      else { locomotion(b); }
      updateOrbs(b, dt); updatePools(b, dt);
      if (b.form === 'beast' && Math.random() < dt * 6) b.ctx.effects.burst('fire', b.pos.clone().add(V((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4)), 1, { speed: 0.6, up: 1.5, size: 0.15, life: 0.8, gravity: -0.6 });
    },
    legendary: 'legend_runesword',
    lore: ['A Ilha da Coroa era a sede dos reis do mar. Varkhul foi o último deles — e o primeiro a trocar a vida pela Maré Negra.', 'Dizem que, ferido, ele rasga a própria carne e vira uma fera de fogo — com a Espada Rúnica, que bebeu a luz dos sete guardiões, cravada nas costas.'],
    loot: [['gold_coin', 40], ['metal_bar', 10]],
  },
];

/** Ysolde: esferas de acerto ao longo do corpo (os canhões acertam qualquer parte). */
export function serpentSpheres(b) {
  b._sph = b.parts.segs.slice(0, 10).map((s) => { const p = s.getWorldPosition(V()); return { x: p.x, y: p.y, z: p.z, r: 2.2 }; });
  return b._sph;
}
