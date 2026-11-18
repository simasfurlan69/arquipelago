/**
 * Boss.js
 * Base dos chefes. Cada chefe é definido por dados (Bosses.js): visual, vida,
 * velocidade e lista de ataques. Esta classe cuida de:
 *  - despertar quando o jogador entra na arena (rugido, barra de vida, música de chefe);
 *  - máquina de estados: perseguir → preparar ataque (aviso vermelho no chão) →
 *    executar → recuperar; atordoado quando o golpe acerta um obstáculo ou o machado;
 *  - fases por vida (66 % e 33 %): mais rápido e ataques extras;
 *  - armadura (Korrak): só a picareta quebra;
 *  - arena: se o jogador fugir, o chefe volta ao altar e recupera a vida;
 *  - morte: saque, selo e aviso para a história.
 *  - DIFICULDADE: vida ×1,6; POSTURA (acertos enchem; cheia = atordoado 3 s e dano ×1,5);
 *    golpes em sequência sem pausa causam −15% (o chefe se defende); lentidão (Machado
 *    de Gelo) e atordoamentos curtos (o chefe resiste a 70%); avisos no chão pulsam.
 */
import * as THREE from 'three/webgpu';
import { LAYERS } from '../../render/GameRenderer.js';
import { HitFlash } from '../../game/Combat.js';
import { damp, dampAngle, clamp } from '../../utils/Noise.js';

const _v = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Avisos de ataque no chão (círculo, cone, linha)
// ---------------------------------------------------------------------------
const warnMat = new THREE.MeshBasicNodeMaterial({ color: 0xff2a10, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
export function makeWarning(scene, shape, size) {
  let geo;
  if (shape === 'circle') geo = new THREE.RingGeometry(size * 0.05, size, 48);
  else if (shape === 'line') { geo = new THREE.PlaneGeometry(size.w, size.l); geo.translate(0, size.l / 2, 0); }
  else geo = new THREE.CircleGeometry(size.r, 32, -size.a / 2 + Math.PI / 2, size.a);   // cone
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, warnMat.clone());
  m.layers.set(LAYERS.TRANSPARENT);
  m.renderOrder = 5;
  scene.add(m);
  return m;
}

export class Boss {
  /**
   * @param {object} def definição (Bosses.js)
   * @param {object} ctx { scene, terrain, ocean, combat, effects, drops, sfx, enemies, player, hud, colliders }
   * @param {THREE.Vector3} home posição do altar
   */
  constructor(def, ctx, home) {
    this.def = def;
    this.ctx = ctx;
    this.name = def.name;
    this.id = def.id;
    this.faction = 'boss';
    this.home = home.clone();
    this.maxHp = Math.round(def.hp * 1.6 * (ctx.difficulty?.() ?? 1));
    this.posture = 0;           // 0..100
    this.postureT = 0;          // s desde o último acerto
    this.broken = 0;            // s restantes de postura quebrada (dano ×1,5)
    this._hits = [];            // instantes dos últimos acertos (defesa contra sequência)
    this.slowT = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.awake = false;
    this.state = 'dormant';
    this.timer = 0;
    this.attackCd = 2;
    this.stun = 0;
    this.armor = def.armored ? 1 : 0;
    this.armored = !!def.armored;
    this.phase = 1;
    this.heading = 0;
    this.speed = 0;
    this.knock = new THREE.Vector3();
    this.warnings = [];

    const built = def.build(ctx);
    this.root = built.root;
    this.parts = built;
    this.radius = def.radius;
    this.height = def.height;
    this.root.position.copy(home);
    ctx.scene.add(this.root);
    this.flash = new HitFlash(this.root);
    if (built.mixer) { this.mixer = built.mixer; this.anims = built.anims; }
    this._sph = [{ x: 0, y: 0, z: 0, r: def.radius }, { x: 0, y: 0, z: 0, r: def.radius * 0.6 }];
    ctx.combat.register(this);
    this.onDefeated = () => {};
  }

  get pos() { return this.root.position; }

  getHitSpheres() {
    const p = this.root.position;
    this._sph[0].x = p.x; this._sph[0].y = p.y + this.height * 0.45; this._sph[0].z = p.z;
    this._sph[1].x = p.x + Math.sin(this.heading) * this.radius * 0.6; this._sph[1].y = p.y + this.height * 0.85; this._sph[1].z = p.z + Math.cos(this.heading) * this.radius * 0.6;
    return this._sph;
  }

  takeDamage(amount, dir, source, o = {}) {
    if (!this.alive) return;
    if (!this.awake) this.wake();
    if (this.armor > 0) {
      if (o.breaksArmor) {
        this.armor = 0; this.armorT = 7;
        this.ctx.hud.toast(`A armadura de ${this.name} rachou! Ataque agora!`, 2);
        this.ctx.sfx.rockBreak(this.pos);
        this.def.onArmorBreak?.(this);
      } else { amount *= 0.12; this.ctx.sfx.hitMetal(this.pos); }
    }
    if (this.def.onlyHeadVulnerable && !this.def.onlyHeadVulnerable(this, source)) amount *= 0.2;
    if (this.def.damageMult && !o.dot) amount *= this.def.damageMult(this, o);
    // ---- defesa contra sequência (mais de 5 acertos em 2,5 s) ----
    const now = performance.now();
    this._hits = this._hits.filter((t) => now - t < 2500); this._hits.push(now);
    if (this._hits.length > 5 && !o.dot) amount *= 0.85;
    // ---- postura ----
    if (this.broken > 0) amount *= 1.5;
    else if (!o.dot) {
      const k = source === 'special' ? 2.5 : (o.stop || 0) >= 0.1 ? 2 : 1;
      this.posture = Math.min(100, this.posture + amount * 0.9 * k / Math.max(1, this.maxHp / 400));
      this.postureT = 0;
      if (this.posture >= 100) this.breakPosture();
    }
    this.hp = Math.max(0, this.hp - amount);
    this.flash.trigger();
    // atordoamentos curtos: o chefe resiste (30% da duração); só a postura quebrada derruba de verdade
    if (o.stun && this.state !== 'attack' && this.broken <= 0) this.stunFor(o.stun * 0.3);
    if (dir && o.push && !this.def.heavy) this.knock.set(dir.x, 0, dir.z).multiplyScalar(o.push * 0.3);
    const k = this.hp / this.maxHp;
    if (this.phase === 1 && k < 0.66) this.nextPhase();
    else if (this.phase === 2 && k < 0.33) this.nextPhase();
    if (this.hp <= 0) this.die();
  }

  /** Postura quebrada: atordoado 3 s, recebe dano ×1,5. */
  breakPosture() {
    this.posture = 0;
    this.broken = 3;
    this.stunFor(3);
    this.ctx.hud.toast(`💥 POSTURA QUEBRADA! ${this.name} está vulnerável!`, 1.8);
    this.ctx.sfx.rockBreak?.(this.pos);
    this.ctx.cfx?.ring(this.pos, { radius: 5, color: 0xfff0a0, life: 0.5 });
    this.ctx.shake?.(0.6);
  }

  nextPhase() {
    this.phase++;
    this.ctx.hud.toast(`${this.name} se enfurece! (fase ${this.phase})`, 2);
    this.ctx.sfx.bossRoar(this.pos);
    this.def.onPhase?.(this, this.phase);
  }

  stunFor(t) {
    this.stun = Math.max(this.stun, t);
    this.state = 'stunned';
    this._clearWarnings();
  }

  wake() {
    if (this.awake || !this.alive) return;
    this.awake = true;
    this.state = 'chase';
    this.ctx.sfx.bossRoar(this.pos);
    this.ctx.onBossAwake?.(this);
  }

  die() {
    this.alive = false;
    this.state = 'dead';
    this.deathT = 0;
    this._clearWarnings();
    this.ctx.combat.unregister(this);
    const p = this.pos.clone().setY(this.pos.y + 1);
    for (const [id, n] of this.def.loot) this.ctx.drops.spawn(id, n, p);
    this.ctx.effects.smoke(p, 20);
    this.ctx.sfx.victory();
    this.onDefeated(this);
  }

  /** Volta ao altar e recupera a vida (o jogador fugiu da arena). */
  reset() {
    this.awake = false;
    this.state = 'dormant';
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.3);     // recupera 30% (não tudo)
    this.posture = 0; this.broken = 0;
    const k = this.hp / this.maxHp;
    this.phase = k < 0.33 ? 3 : k < 0.66 ? 2 : 1;
    this.armor = this.def.armored ? 1 : 0;
    this._clearWarnings();
    this.root.position.copy(this.home);
    this.ctx.onBossReset?.(this);
  }

  // -------------------------------------------------------------------------
  // Avisos e utilitários para os ataques
  // -------------------------------------------------------------------------
  warn(shape, size, at, heading = 0) {
    const m = makeWarning(this.ctx.scene, shape, size);
    m.position.set(at.x, this.ctx.groundAt(at.x, at.z) + 0.12, at.z);
    m.rotation.y = heading;
    this.warnings.push(m);
    return m;
  }
  _clearWarnings() { for (const w of this.warnings) w.removeFromParent(); this.warnings.length = 0; }

  /** Dano no jogador se ele estiver dentro do círculo (e não esquivando). */
  hitCircle(center, r, dmg, push = 8) {
    const pl = this.ctx.player, pp = pl.position;
    if (pl.state !== 'foot') return false;
    const d = Math.hypot(pp.x - center.x, pp.z - center.z);
    if (d > r) return false;
    _v.set(pp.x - center.x, 0, pp.z - center.z).normalize();
    pl.takeDamage(dmg, _v, this.name);
    pl.knock.copy(_v).multiplyScalar(push);
    return true;
  }

  /** Dano em retângulo à frente (investidas, golpes em linha). */
  hitLine(origin, heading, w, l, dmg, push = 10) {
    const pl = this.ctx.player, pp = pl.position;
    if (pl.state !== 'foot') return false;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const dx = pp.x - origin.x, dz = pp.z - origin.z;
    const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
    if (along < 0 || along > l || side > w / 2) return false;
    _v.set(fx, 0, fz);
    pl.takeDamage(dmg, _v, this.name);
    pl.knock.copy(_v).multiplyScalar(push);
    return true;
  }

  faceTo(p, rate, dt) {
    const t = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.heading = dampAngle(this.heading, t, rate, dt);
  }

  distToPlayer() {
    // posição de mundo (no navio, o jogador é filho do leme)
    const pp = this.def.aquatic && this.ctx.player.boat ? this.ctx.player.boat.root.position : this.ctx.playerPos;
    return Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
  }

  // -------------------------------------------------------------------------
  // Atualização
  // -------------------------------------------------------------------------
  update(dt) {
    const ctx = this.ctx;
    this.flash.update(dt);
    if (this.mixer) this.mixer.update(dt);
    if (this.state === 'dead') {
      this.deathT += dt;
      this.root.rotation.z = Math.min(Math.PI / 2, this.deathT * 1.5);
      if (this.deathT > 2.5) this.root.position.y -= dt * 0.6;
      if (this.deathT > 6) { this.root.removeFromParent(); this.state = 'gone'; }
      return;
    }
    if (this.state === 'gone') return;

    const pl = ctx.player;
    const d = this.distToPlayer();
    // despertar / arena
    if (!this.awake) {
      this.def.idle?.(this, dt);
      if (d < this.def.wakeRange && pl.state === (this.def.aquatic ? 'boat' : 'foot')) this.wake();
      this._place(dt);
      return;
    }
    if (d > this.def.leash || (pl.stats?.dead)) { this.reset(); return; }
    if (this.armorT > 0 && (this.armorT -= dt) <= 0 && this.def.armored) { this.armor = 1; ctx.hud.toast(`${this.name} recompôs a armadura de pedra.`, 1.5); }

    // postura volta ao normal se o jogador parar de bater; lentidão do gelo
    this.postureT += dt;
    if (this.postureT > 2) this.posture = Math.max(0, this.posture - dt * 10);
    this.broken = Math.max(0, this.broken - dt);
    if (this.slowT > 0) { this.slowT -= dt; dt *= 0.55; }
    // avisos no chão pulsam (mais rápido perto do golpe)
    if (this.state === 'windup' && this.warnings.length) {
      const k = 1 - Math.max(0, this.timer) / Math.max(0.01, this.attack?.windup || 1);
      for (const w of this.warnings) w.material.opacity = 0.22 + 0.3 * k + 0.12 * Math.sin(performance.now() / (60 - 40 * k));
    }
    const fast = 1 + (this.phase - 1) * 0.25;
    this.timer -= dt;
    this.attackCd -= dt * fast;

    switch (this.state) {
      case 'stunned':
        this.stun -= dt;
        this.speed = damp(this.speed, 0, 8, dt);
        this.root.rotation.z = Math.sin(this.stun * 12) * 0.05;
        if (this.stun <= 0) { this.state = 'chase'; this.root.rotation.z = 0; }
        break;
      case 'chase': {
        const target = this.def.aquatic ? (pl.boat?.root.position || pl.position) : pl.position;
        this.faceTo(target, 3.5 * fast, dt);
        // escolhe um ataque disponível para a distância atual
        if (this.attackCd <= 0) {
          const options = this.def.attacks.filter((a) => (a.phase || 1) <= this.phase && (a.maxPhase || 9) >= this.phase && d <= a.range && d >= (a.minRange || 0));
          if (options.length) {
            this.attack = options[Math.floor(Math.random() * options.length)];
            this.state = 'windup';
            this.timer = this.attack.windup / fast;
            this.attack.start?.(this);
            break;
          }
        }
        const want = d > (this.def.keepDistance || this.radius + 1.5) ? this.def.speed * fast : 0;
        this.speed = damp(this.speed, want, 4, dt);
        break;
      }
      case 'windup':
        this.speed = damp(this.speed, 0, 10, dt);
        this.attack.windupUpdate?.(this, dt);
        if (this.timer <= 0) {
          this._clearWarnings();
          this.state = 'attack';
          this.timer = this.attack.duration || 0.4;
          this.attack.exec(this);
        }
        break;
      case 'attack':
        this.attack.attackUpdate?.(this, dt);
        if (this.timer <= 0) { this.state = 'chase'; this.attackCd = this.attack.cooldown; this.attack.end?.(this); }
        break;
    }
    this.def.update?.(this, dt);
    this._place(dt);
  }

  /** Move pelo heading/velocidade, segue o chão (ou a água) e evita sair da ilha. */
  _place(dt) {
    const p = this.pos, ctx = this.ctx;
    const ox = p.x, oz = p.z;
    p.x += Math.sin(this.heading) * this.speed * dt + this.knock.x * dt;
    p.z += Math.cos(this.heading) * this.speed * dt + this.knock.z * dt;
    this.knock.multiplyScalar(Math.exp(-6 * dt));
    if (this.def.aquatic) {
      p.y = damp(p.y, ctx.ocean.getWaveHeight(p.x, p.z) + (this.submerged ? -6 : 0), 3, dt);
    } else {
      const g = ctx.groundAt(p.x, p.z);
      if (g < 0.2 || Math.hypot(p.x - this.home.x, p.z - this.home.z) > this.def.leash) { p.x = ox; p.z = oz; this.speed = 0; this.def.onBlocked?.(this); }
      else p.y = damp(p.y, g, 12, dt);
    }
    this.root.rotation.y = this.heading;
  }
}
