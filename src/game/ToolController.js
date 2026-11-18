/**
 * ToolController.js
 * Uso do item na mão (a pé). Os números vêm do banco de itens (Items.js).
 *
 *  ESPADA    combo de 3 golpes (×1,0 / ×1,1 / ×1,6 do dano); segurar 0,6 s = giro em área
 *  ADAGA     combo rápido de 2 golpes, cooldown curto, chance de crítico
 *  MACHADO   golpe pesado (atordoa); corta árvores pela força de corte do tier
 *  PICARETA  minera pela força do tier; quebra armadura de pedra
 *  ARCO      segurar carrega; dano 12 + 3 da flecha; cabeça = crítico ×2
 *  PISTOLA / RIFLE  disparo instantâneo pela mira, pente (16 / 20), R recarrega
 *  CONSUMÍVEIS  clique (esq. ou dir.): comida, água (fôlego), café/drogas (efeito)
 *  Comum: Ctrl esquiva · Q trava a mira · hit-stop · números de dano · sons
 *
 *  GOLPE PESADO   segurar o clique 0,6 s (espada/adaga/lendárias corpo a corpo):
 *                 ergue a arma (brilha) e desce com onda de choque em área + atordoa
 *  FÚRIA          enche com acertos (+7) e esquiva perfeita (+35)
 *  GOLPE ESPECIAL F com Fúria cheia: poder da arma lendária (Legendary.js) ou giro 360°
 *  CONTRA-ATAQUE  após esquiva perfeita, o próximo golpe é crítico garantido (×2)
 */
import * as THREE from 'three/webgpu';
import { ITEMS } from './Items.js';
import { LAYERS } from '../render/GameRenderer.js';

const SWORD_MULT = [1, 1.1, 1.6], SWORD_DUR = [0.42, 0.42, 0.55], SWORD_PUSH = [2, 2, 9];
const DAGGER_MULT = [1, 1.15], DAGGER_DUR = [0.26, 0.3];
const HAND = { damage: 1, range: 2.0, cooldown: 0.4 };

export class ToolController {
  constructor({ player, inventory, combat, harvest, projectiles, tpc, input, hud, stats, effects, sfx = null, floating = null, scene = null }) {
    Object.assign(this, { player, inventory, combat, harvest, projectiles, tpc, input, hud, stats, fx: effects, sfx, floating, scene });
    this.cooldown = 0;
    this.draw = 0;
    this.hold = 0;
    this.comboStep = 0;
    this.comboWindow = 0;
    this.reloadT = 0;
    /** Multiplicadores de dano das melhorias da história (selos). */
    this.bonus = { sword: 1, axe: 1, pickaxe: 1, bow: 1, dagger: 1, pistol: 1, rifle: 1, hand: 1 };
    this._fwd = new THREE.Vector3();
    this._org = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._tgt = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.tracers = [];
    this.fury = 0;               // 0..100
    this.counterT = 0;           // janela de contra-ataque (esquiva perfeita)
    this.specialT = 0;
    this._ba = new THREE.Vector3(); this._bb = new THREE.Vector3();
  }

  /** Liga efeitos visuais e poderes (montado no main depois do construtor). */
  attachFX({ cfx, trail, legendary }) { this.cfx = cfx; this.trail = trail; this.legendary = legendary; }

  addFury(n) { this.fury = Math.min(100, this.fury + n); }

  /** Esquiva perfeita: câmera lenta é tratada no main; aqui, fúria e contra-ataque. */
  onPerfectDodge() { this.addFury(35); this.counterT = 1.6; }

  _trailColor(def) { return def?.trail ?? (def?.tier === 3 ? 0xd8e8ff : def?.tier === 2 ? 0xffe08a : 0xfff4e0); }

  /** Rastro e brilho da arma na mão (todo frame). */
  _updateVisuals(dt) {
    const p = this.player, def = this.def;
    this.counterT = Math.max(0, this.counterT - dt);
    this.specialT = Math.max(0, this.specialT - dt);
    const power = this.specialT > 0 ? 1 : Math.max(p.heavyCharge || 0, this.counterT > 0 ? 0.5 : 0);
    p.held?.object.userData.update?.(dt, power);
    if (this.trail) {
      this.trail.setColor(this.counterT > 0 ? 0x80c8ff : this._trailColor(def));
      const ok = p.state === 'foot' && p.bladeWorld?.(this._ba, this._bb);
      this.trail.update(dt, ok ? this._ba : null, this._bb);
    }
    this.hud.setFury?.(this.fury / 100, this.counterT > 0);
  }

  get def() { const id = this.inventory.selectedId; return id ? ITEMS[id] : null; }
  get tool() { return this.def?.tool || 'hand'; }
  get slot() { return this.inventory.selectedSlot; }

  update(dt) {
    const inv = this.inventory, p = this.player, inp = this.input;
    p.setHeldItem(p.state === 'foot' ? inv.selectedId : null);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    if (this.comboWindow <= 0 && this.cooldown <= 0) this.comboStep = 0;
    this._updateTracers(dt);
    this._updateVisuals(dt);

    if (p.state !== 'foot' || this.stats.dead) {
      this.draw = 0; p.aimingBow = false; p.aimingGun = false; this.tpc.aiming = false; p.lockTarget = null; this.reloadT = 0; p.heavyCharge = 0; this.hold = 0;
      this.hud.setAmmo?.(null);
      return;
    }

    // ---------------- Esquiva e trava de mira ----------------
    if (inp.justPressed(inp.binds.dodge) || (inp.binds.dodge === 'ControlLeft' && inp.justPressed('ControlRight'))) {
      if (!p.dodge()) this.hud.toast('Sem fôlego!', 0.8);
    }
    if (inp.justPressed(inp.binds.lock)) this.toggleLock();
    if (p.lockTarget && (!p.lockTarget.alive || this._dist(p.lockTarget) > 30)) p.lockTarget = null;

    const def = this.def, tool = this.tool;
    if (tool !== 'sword' && tool !== 'dagger') p.heavyCharge = 0;
    p.holdCategory = def?.category || null;
    this.hud.setAmmo?.(def?.mag ? `${this.slot.mag} / ${inv.count(def.ammo)}` : tool === 'bow' ? `${inv.count('arrow')} flechas` : null);
    if (tool !== 'pistol' && tool !== 'rifle') { p.aimingGun = false; this.reloadT = 0; }

    // ---------------- Golpe especial (F) ----------------
    if (inp.justPressed('KeyF') && def?.category !== 'food' && def?.category !== 'drink') {
      if (this.fury < 100) this.hud.toast(`Fúria ${Math.floor(this.fury)}% — acerte inimigos e esquive no tempo certo`, 1.2);
      else if (this.cooldown <= 0) this.special(def);
    }

    // ---------------- Consumíveis ----------------
    if (def && (def.category === 'food' || def.category === 'drink' || def.category === 'special')) {
      this.hud.setCharge?.(null); p.aimingBow = false; this.tpc.aiming = false;
      if ((inp.mouseJustPressed(2) || inp.mouseJustPressed(0)) && this.cooldown <= 0) {
        if (this.stats.consume(def)) {
          inv.consumeSelected();
          p.playAction('eat');
          this.sfx?.eat();
          this.cooldown = 0.9;
          if (def.buff) this.hud.toast(`${def.buff.label} por ${def.buff.time} s`, 1.5);
          else if (def.stamina) this.hud.toast(`💨 Fôlego +${def.stamina}`, 1);
        } else this.hud.toast('Você está saciado.', 1.2);
      }
      return;
    }

    // ---------------- Armas de fogo ----------------
    if (tool === 'pistol' || tool === 'rifle') { this._gun(dt, def); return; }

    // ---------------- Arco ----------------
    if (tool === 'bow') {
      const holding = inp.mouseDown(0);
      if (holding && inv.has('arrow')) {
        if (this.draw === 0) this.sfx?.bowDraw();
        this.draw = Math.min(1, this.draw + dt);
        p.aimingBow = true;
        this.tpc.aiming = true;
      } else if (holding && inp.mouseJustPressed(0)) this.hud.toast('Sem flechas! Compre com o Mercador.', 1.5);
      this.hud.setCharge?.(p.aimingBow ? this.draw : null);
      if (!holding && this.draw > 0) {
        if (this.draw > 0.15) this.shootArrow(this.draw);
        this.draw = 0;
      }
      if (!holding) { p.aimingBow = false; this.tpc.aiming = false; }
      return;
    }
    this.hud.setCharge?.(null);
    this.draw = 0; p.aimingBow = false; this.tpc.aiming = false;

    // ---------------- Espada / adaga (combo + golpe pesado) ----------------
    if (tool === 'sword' || tool === 'dagger') {
      if (inp.mouseDown(0) && this.hold >= 0) this.hold += dt;
      // carga visível a partir de 0,18 s (cliques rápidos continuam sendo combo)
      p.heavyCharge = this.hold > 0.18 && inp.mouseDown(0) && this.cooldown <= 0 ? Math.min(1, (this.hold - 0.18) / 0.42) : 0;
      if (inp.mouseJustReleased(0)) {
        if (this.hold >= 0.6 && this.cooldown <= 0) {
          if (this.stats.useStamina(25)) this.heavyAttack(def); else this.hud.toast('Sem fôlego!', 0.8);
        } else if (this.hold >= 0 && this.hold < 0.6) { if (this.cooldown <= 0) this.combo(def); else this.queued = 0.45; }
        this.hold = 0;
        p.heavyCharge = 0;
      }
      if (!inp.mouseDown(0) && this.hold < 0) this.hold = 0;
      if (this.queued > 0) { this.queued -= dt; if (this.cooldown <= 0) { this.queued = 0; this.combo(def); } }
      return;
    }
    if (inp.mouseDown(0) && this.cooldown <= 0) this.primary(tool);
  }

  _dist(t) { const s = t.getHitSpheres()[0]; return Math.hypot(s.x - this.player.position.x, s.z - this.player.position.z); }

  /** Q: trava a mira no inimigo vivo mais próximo à frente (ou solta). */
  toggleLock() {
    const p = this.player;
    if (p.lockTarget) { p.lockTarget = null; return; }
    p.getWorldPosition(this._org);
    this.tpc.getFlatForward(this._fwd);
    let best = null, bestS = Infinity;
    for (const t of this.combat.targets) {
      if (!t.alive || t === p || t.faction === 'player' || t.faction === 'ship-player') continue;
      const s = t.getHitSpheres()[0];
      const dx = s.x - this._org.x, dz = s.z - this._org.z, d = Math.hypot(dx, dz);
      if (d > 28) continue;
      const score = d * (1.6 - (dx * this._fwd.x + dz * this._fwd.z) / Math.max(d, 1e-3));
      if (score < bestS) { bestS = score; best = t; }
    }
    p.lockTarget = best;
    if (!best) this.hud.toast('Nenhum inimigo por perto.', 0.8);
  }

  _attackDir() {
    const p = this.player;
    if (p.lockTarget) {
      const s = p.lockTarget.getHitSpheres()[0];
      return this._fwd.set(s.x - p.position.x, 0, s.z - p.position.z).normalize();
    }
    return this.tpc.getFlatForward(this._fwd);
  }

  // ---------------------------------------------------------------------------
  // Corpo a corpo
  // ---------------------------------------------------------------------------
  combo(def) {
    const dagger = def.tool === 'dagger';
    const n = dagger ? 2 : 3;
    const step = this.comboWindow > 0 ? (this.comboStep + 1) % n : 0;
    const dur = dagger ? DAGGER_DUR[step] : SWORD_DUR[step];
    const mult = dagger ? DAGGER_MULT[step] : SWORD_MULT[step];
    this.comboStep = step;
    this.cooldown = dur * (dagger ? 0.9 : 0.8);
    this.comboWindow = dur + 0.6;
    const p = this.player, dir = this._attackDir();
    p.facing = Math.atan2(dir.x, dir.z); p.lockFacing = dur;
    p.attackAnim(step, dur);
    this.sfx?.swing(!dagger && step === 2, p.position);
    p.knock.set(dir.x, 0, dir.z).multiplyScalar(!dagger && step === 2 ? 5 : 3);
    this.trail?.burst(dur * 0.85, step === 2 ? 1.3 : 1);
    const counter = this.counterT > 0;
    if (counter) { this.counterT = 0; this.hud.toast('⚡ CONTRA-ATAQUE!', 0.8); }
    setTimeout(() => {
      const n = this._meleeArc(def.tool, def.damage * mult * (counter ? 2 : 1), def.range, 0.55, dagger ? 1.5 : SWORD_PUSH[step], counter ? 0.12 : dagger ? 0.035 : step === 2 ? 0.08 : 0.05, counter ? 1 : def.crit);
      if (!n && (def.mine >= 2 || def.chop >= 3)) this._harvestWith(def);
    }, dur * 450);
    this._wear();
  }

  /** Armas lendárias que também mineram/cortam (manopla, martelo, machado de gelo). */
  _harvestWith(def) {
    const p = this.player, dir = this._attackDir();
    p.getWorldPosition(this._org); this._org.y += 1.1;
    const res = this.harvest.findTarget(this._org, dir, def.range + 0.6);
    if (!res || res.type === 'bush') return;
    const tool = res.type === 'tree' ? 'axe' : 'pickaxe';
    const r = this.harvest.hit(res, tool, dir, def);
    const at = new THREE.Vector3(res.x, res.y + 1.2, res.z);
    if (r === 'wrongTool') return;
    if (res.type === 'tree') this.sfx?.chop(at); else this.sfx?.pick(at);
    if (r === 'broken') { if (res.type === 'tree') this.sfx?.treeFall(at); else this.sfx?.rockBreak(at); }
    else this.floating?.spawn(at, `${Math.max(0, Math.ceil(res.hp))}/${res.maxHp}`, 'info');
  }

  /** Golpe pesado: desce a arma com tudo → dano em arco largo + onda de choque em área. */
  heavyAttack(def) {
    const p = this.player, dir = this._attackDir();
    this.cooldown = 0.85;
    this.comboWindow = 0;
    p.facing = Math.atan2(dir.x, dir.z); p.lockFacing = 0.7;
    p.heavyAttack();
    this.trail?.burst(0.35, 1.6);
    this.sfx?.swing(true, p.position);
    const counter = this.counterT > 0; if (counter) this.counterT = 0;
    const legend = def.legendary;
    setTimeout(() => {
      if (p.state !== 'foot') return;
      p.knock.set(dir.x, 0, dir.z).multiplyScalar(4);
      const big = legend === 'roots' || legend === 'quake';
      const dmg = def.damage * 2.2 * (counter ? 1.6 : 1);
      this._meleeArc(def.tool, dmg, def.range + 0.8, -0.2, 10, 0.12, counter ? 1 : def.crit, 1.2);
      // onda de choque no ponto de impacto (à frente)
      const c = p.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 1.6);
      c.y = this.harvest.veg.terrain.getHeight(c.x, c.z);
      this.cfx?.ring(c, { radius: big ? 7 : 4.5, color: this._trailColor(def), life: 0.45 });
      this.cfx?.impact(c.clone().setY(c.y + 0.3), { heavy: true, color: this._trailColor(def) });
      this.fx.dust(c.clone().setY(c.y + 0.2)); this.fx.dust(c.clone().setY(c.y + 0.4));
      this.legendary?.area(c, big ? 6 : 3.8, def.damage * 1.1, { stun: 1, push: 7 });
      if (legend === 'frost') this.cfx?.spikes([0, 1, 2, 3, 4].map((i) => ({ x: c.x + Math.cos(i * 1.26) * 1.6, z: c.z + Math.sin(i * 1.26) * 1.6 })), { kind: 'ice', height: 1.4, life: 1.2 });
      if (legend === 'fire') this.fx.burst('fire', c.clone().setY(c.y + 0.4), 14, { speed: 6, up: 4, size: 0.12, life: 0.6, gravity: -0.4 });
      if (legend === 'roots') this.cfx?.spikes([0, 1, 2, 3, 4, 5].map((i) => ({ x: c.x + Math.cos(i) * 2.5, z: c.z + Math.sin(i) * 2.5 })), { kind: 'root', height: 1.6, life: 1.4 });
      this.tpc.addShake(big ? 0.9 : 0.6);
      this.sfx?.heavyImpact?.(c);
    }, 140);
    this._wear();
  }

  /** Golpe especial (F): consome a Fúria. */
  special(def) {
    const p = this.player, dir = this._attackDir().clone();
    this.fury = 0;
    p.facing = Math.atan2(dir.x, dir.z); p.lockFacing = 0.8;
    const dur = p.specialAnim();
    this.cooldown = dur + 0.15;
    this.specialT = 1.2;
    this.trail?.burst(dur, 1.8);
    this.hud.toast(def?.legendary ? `✨ ${def.name}: GOLPE LENDÁRIO!` : '🌀 GOLPE ESPECIAL!', 1.2);
    const o = p.getWorldPosition(new THREE.Vector3());
    setTimeout(() => this.legendary?.special(def, p.getWorldPosition(o), dir), def?.legendary === 'mist' ? 0 : 200);
  }

  spinAttack(def) {
    const p = this.player;
    this.cooldown = 0.75;
    this.comboWindow = 0;
    p.attackAnim('spin');
    this.sfx?.swing(true, p.position);
    setTimeout(() => this._meleeArc('sword', def.damage * 1.1, def.range + 0.5, -1, 7, 0.09), 260);
    this._wear();
  }

  /** Golpe em arco: acerta todos os alvos no alcance/ângulo. arc = cosseno mínimo (−1 = 360°). */
  _meleeArc(tool, dmg, range, arc, push, stop, crit = 0, stun = null) {
    const p = this.player;
    if (p.state !== 'foot') return 0;
    p.getWorldPosition(this._org);
    this._org.y += 1.1;
    const dir = this._attackDir();
    let hits = 0;
    for (const t of this.combat.targets) {
      if (!t.alive || t === p || t.faction === 'player' || t.faction === 'ship-player') continue;
      for (const s of t.getHitSpheres()) {
        const dx = s.x - this._org.x, dz = s.z - this._org.z;
        const d = Math.hypot(dx, dz) - s.r;
        if (d > range || Math.abs(s.y - this._org.y) > 3 + s.r) continue;
        if (d > 0.3 && (dx * dir.x + dz * dir.z) / Math.hypot(dx, dz) < arc) continue;
        this._p.set(s.x, s.y, s.z);
        const isCrit = Math.random() < crit;
        const kb = this._dir.set(dx, 0, dz).normalize();
        const def = this.def, total = dmg * (isCrit ? 1.8 : 1) * (this.bonus[tool] || 1);
        this.combat.hit(t, total, kb, this._p, { source: tool, crit: isCrit, stop, push, stun: stun ?? (tool === 'axe' ? 0.8 : 0), breaksArmor: tool === 'pickaxe' || def?.legendary === 'quake', fromPlayer: true });
        this.cfx?.impact(this._p, { crit: isCrit, heavy: stop >= 0.1, color: this._trailColor(def) });
        this.tpc.addShake(isCrit || stop >= 0.1 ? 0.35 : 0.15);
        if (def?.legendary) this.legendary?.onHit(def, t, total, this._p.clone());
        this.addFury(isCrit ? 10 : 7);
        hits++;
        break;
      }
    }
    return hits;
  }

  /** Machado, picareta e mão: criaturas em arco, ou recurso à frente. */
  primary(tool = this.tool) {
    const def = this.def;
    const cfg = def?.damage ? def : HAND;
    const heavy = tool === 'axe';
    this.cooldown = cfg.cooldown * (heavy ? 1.15 : 1);
    const p = this.player, dir = this._attackDir();
    p.facing = Math.atan2(dir.x, dir.z); p.lockFacing = 0.6;
    p.attackAnim(tool === 'pickaxe' ? 2 : tool === 'axe' ? 0 : 1, heavy ? 0.6 : 0.48);
    this.sfx?.swing(heavy, p.position);
    p.getWorldPosition(this._org);
    this._org.y += 1.1;

    const n = this._meleeArc(tool, cfg.damage, cfg.range, 0.6, heavy ? 4 : 2, heavy ? 0.08 : 0.05);
    if (n) { if (def?.durability) this._wear(); return 'creature'; }
    const res = this.harvest.findTarget(this._org, dir, cfg.range + 0.6);
    if (res) {
      const r = this.harvest.hit(res, tool, dir, def);
      const at = new THREE.Vector3(res.x, res.y + 1.2, res.z);
      if (r !== 'wrongTool') {
        if (res.type === 'tree') this.sfx?.chop(at); else if (res.type === 'bush') this.sfx?.pickup(); else this.sfx?.pick(at);
        if (r === 'broken') { if (res.type === 'tree') this.sfx?.treeFall(at); else if (res.type !== 'bush') this.sfx?.rockBreak(at); }
        else this.floating?.spawn(at, `${Math.max(0, Math.ceil(res.hp))}/${res.maxHp}`, 'info');
        if (def?.durability && res.type !== 'bush') this._wear();
      }
      return r;
    }
    return 'miss';
  }

  // ---------------------------------------------------------------------------
  // À distância
  // ---------------------------------------------------------------------------
  _aimPoint(range) {
    const p = this.player;
    if (p.lockTarget) { const s = p.lockTarget.getHitSpheres()[0]; return this._tgt.set(s.x, s.y + s.r * 0.5, s.z); }
    this.tpc.getAimDirection(this._dir);
    return this._tgt.copy(this.tpc.camera.position).addScaledVector(this._dir, range);
  }

  /** Alvo mais perto da mira (flechas teleguiadas do Arco da Névoa). */
  _homingTarget() {
    const p = this.player;
    if (p.lockTarget?.alive) return p.lockTarget;
    this.tpc.getAimDirection(this._dir);
    let best = null, bestS = Infinity;
    const c = this.tpc.camera.position;
    for (const t of this.combat.targets) {
      if (!t.alive || t === p || t.faction === 'player' || t.faction === 'ship-player') continue;
      const s = t.getHitSpheres()[0], dx = s.x - c.x, dy = s.y - c.y, dz = s.z - c.z, d = Math.hypot(dx, dy, dz);
      if (d > 70) continue;
      const cos = (dx * this._dir.x + dy * this._dir.y + dz * this._dir.z) / d;
      if (cos < 0.93) continue;
      const score = (1 - cos) * 100 + d * 0.05;
      if (score < bestS) { bestS = score; best = t; }
    }
    return best;
  }

  shootArrow(charge) {
    const inv = this.inventory, p = this.player, def = this.def?.tool === 'bow' ? this.def : ITEMS.bow;
    if (!inv.remove('arrow', 1)) return;
    p.getWorldPosition(this._org);
    this._org.y += 1.45;
    this._aimPoint(70);
    this._dir.subVectors(this._tgt, this._org).normalize();
    this._org.addScaledVector(this._dir, 0.6);
    const full = charge >= 0.98;
    const speed = (22 + 36 * charge) * (this.bonus.bow > 1 ? 1.25 : 1);
    const dmg = Math.round(((def.damage + ITEMS.arrow.bonusDamage) * (0.4 + 0.6 * charge) + (full ? 2 : 0)) * this.bonus.bow);
    const mist = this.def?.legendary === 'mist';
    this.projectiles.arrow(this._org, this._dir.multiplyScalar(speed), mist ? Math.round(dmg * 1.6) : dmg, 'player', mist ? { homing: this._homingTarget(), trail: 'mist' } : {});
    this.sfx?.bowRelease(p.position);
    this._wear();
    this.cooldown = 0.25;
  }

  /** Pistola e rifle: pente, recarga (R), disparo instantâneo com traçante. */
  _gun(dt, def) {
    const inp = this.input, p = this.player, slot = this.slot, inv = this.inventory;
    const rifle = def.tool === 'rifle';
    const aiming = inp.mouseDown(2);
    this.tpc.aiming = aiming;
    p.aimingBow = false;
    p.aimingGun = true;
    if (aiming || this.cooldown > 0) p.lockFacing = Math.max(p.lockFacing, 0.15);
    this.hud.setCharge?.(aiming ? 1 : null);
    // recarga
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = def.mag - slot.mag, got = Math.min(need, inv.count(def.ammo));
        inv.remove(def.ammo, got); slot.mag += got; inv.changed();
        this.sfx?.reloadEnd?.();
      }
      return;
    }
    if (inp.justPressed('KeyR') && slot.mag < def.mag) {
      if (!inv.has(def.ammo)) { this.hud.toast(`Sem ${ITEMS[def.ammo].name}. Compre com o Mercador.`, 1.5); return; }
      this.reloadT = def.reload;
      this.sfx?.reload?.();
      this.hud.toast('Recarregando…', def.reload);
      return;
    }
    if (!inp.mouseJustPressed(0) || this.cooldown > 0) return;
    if (slot.mag <= 0) { this.sfx?.dryFire?.(); this.hud.toast('Pente vazio — R para recarregar', 1.2); this.cooldown = 0.3; return; }
    slot.mag--; inv.changed();
    this.cooldown = def.fireRate;
    this.tpc.getFlatForward(this._fwd);
    p.facing = Math.atan2(this._fwd.x, this._fwd.z);
    p.lockFacing = 0.4;
    // origem no cano (socket da mão) e mira
    const muzzle = p.muzzleWorld ? p.muzzleWorld(new THREE.Vector3()) : p.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.45, 0));
    this._aimPoint(def.maxRange);
    const dir = this._tgt.clone().sub(muzzle).normalize();
    const end = muzzle.clone().addScaledVector(dir, def.maxRange);
    const hit = this.combat.segmentHit(muzzle, end, 'player');
    let stop = end;
    if (hit && hit.target !== p) {
      stop = hit.point;
      const dmg = def.damage * (hit.crit ? 2 : 1) * (this.bonus[def.tool] || 1);
      this.combat.hit(hit.target, dmg, dir.clone(), hit.point, { source: def.tool, crit: hit.crit, stop: 0.04, push: rifle ? 6 : 3, fromPlayer: true });
    } else {
      const terrain = this.harvest.veg.terrain;
      for (let t = 2; t < def.maxRange; t += 2) {
        const q = muzzle.clone().addScaledVector(dir, t);
        if (q.y < terrain.getHeight(q.x, q.z)) { stop = q; this.fx.dust(q); break; }
      }
    }
    this._tracer(muzzle, stop, rifle);
    this.sfx?.gunshot?.(rifle, p.position);
    this.tpc.addShake(rifle ? 0.35 : 0.15);
    p.recoil = rifle ? 1 : 0.6;
    this._wear();
  }

  _tracer(a, b, heavy) {
    if (!this.scene) return;
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const m = new THREE.Line(g, new THREE.LineBasicNodeMaterial({ color: heavy ? 0xffe0a0 : 0xfff0c0, transparent: true, opacity: 0.9 }));
    m.layers.set(LAYERS.TRANSPARENT);
    m.frustumCulled = false;
    this.scene.add(m);
    this.tracers.push({ m, t: 0.08 });
    this.fx.burst?.('fire', a, 4, { speed: 1.5, up: 0.5, size: 0.08, life: 0.08, gravity: 0 });
  }

  _updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      t.m.material.opacity = Math.max(0, t.t / 0.08);
      if (t.t <= 0) { t.m.removeFromParent(); t.m.geometry.dispose(); this.tracers.splice(i, 1); }
    }
  }

  _wear() {
    const name = ITEMS[this.inventory.selectedId]?.name;
    if (this.inventory.wearSelected(1)) this.hud.toast(`${name} quebrou!`, 2);
  }
}
