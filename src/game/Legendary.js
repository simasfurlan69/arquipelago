/**
 * Legendary.js
 * Poderes das armas lendárias e do Golpe Especial (tecla F, barra de Fúria).
 *
 *  Passivos (a cada acerto):
 *    fire  → queimadura (dano por segundo por 3 s)
 *    frost → congela: inimigo fica lento por 2,5 s
 *    rune  → cura 3 de vida
 *    quake → (minera qualquer pedra — tratado no ToolController)
 *    tide  → (tubarões fogem — tratado no SharkManager)
 *    mist  → (flechas teleguiadas — tratado no ToolController)
 *
 *  Especiais (F):
 *    roots  linha de raízes que brotam e atordoam       quake  terremoto em anel com estacas de pedra
 *    wave   onda d'água que avança em linha             tide   arremesso do tridente (vai e volta)
 *    fire   leque de fogo à frente                       frost  anel de estacas de gelo que congela
 *    rune   onda de runas verdes em linha                mist   rajada de 6 flechas teleguiadas
 *    (arma comum) giro de 360° com onda de choque
 */
import * as THREE from 'three/webgpu';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const enemy = (t, p) => t.alive && t !== p && t.faction !== 'player' && t.faction !== 'ship-player';

export class Legendary {
  constructor({ combat, effects, cfx, player, stats, projectiles, scene, sfx, hud, groundAt, shake }) {
    Object.assign(this, { combat, effects, cfx, player, stats, projectiles, scene, sfx, hud, groundAt, shake });
    this.dots = [];          // queimaduras
    this.movers = [];        // ondas / tridente que viajam
    // tridente arremessado (um só)
    const g = new THREE.Group();
    const m = new THREE.MeshStandardNodeMaterial({ color: 0x30a0b0, metalness: 0.9, roughness: 0.25, emissive: 0x40e0ff, emissiveIntensity: 0.6 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), m); shaft.rotation.x = Math.PI / 2; g.add(shaft);
    for (const x of [-0.15, 0, 0.15]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.35, 6), m); c.rotation.x = Math.PI / 2; c.position.set(x, 0, 1.0); g.add(c); }
    g.visible = false;
    scene.add(g);
    this.tridentMesh = g;
  }

  // ---------------------------------------------------------------------------
  // Utilitários de área
  // ---------------------------------------------------------------------------
  /** Acerta todos os inimigos dentro de `radius` de `c` (uma vez cada). */
  area(c, radius, dmg, o = {}, hitSet = null) {
    let n = 0;
    for (const t of this.combat.targets) {
      if (!enemy(t, this.player) || hitSet?.has(t)) continue;
      const s = t.getHitSpheres()[0];
      const d = Math.hypot(s.x - c.x, s.z - c.z) - s.r;
      if (d > radius || Math.abs(s.y - c.y) > 4 + s.r) continue;
      _v.set(s.x - c.x, 0, s.z - c.z).normalize();
      this.combat.hit(t, dmg, _v.clone(), new THREE.Vector3(s.x, s.y, s.z), { source: 'special', stop: 0.05, push: o.push ?? 6, stun: o.stun || 0, breaksArmor: true, fromPlayer: true, crit: o.crit });
      if (o.slow) t.slowT = Math.max(t.slowT || 0, o.slow);
      if (o.burn) this.burn(t, o.burn);
      hitSet?.add(t);
      n++;
    }
    return n;
  }

  burn(t, dps, time = 3) {
    const d = this.dots.find((x) => x.t === t);
    if (d) { d.time = time; d.dps = Math.max(d.dps, dps); return; }
    this.dots.push({ t, dps, time, tick: 0 });
  }

  // ---------------------------------------------------------------------------
  // Passivos
  // ---------------------------------------------------------------------------
  onHit(def, target, dmg, point) {
    switch (def?.legendary) {
      case 'fire': this.burn(target, 4); this.effects.burst('fire', point, 6, { speed: 3, up: 3, size: 0.08, life: 0.5, gravity: -0.5 }); break;
      case 'frost': target.slowT = Math.max(target.slowT || 0, 2.5); this.effects.burst('ice', point, 6, { speed: 3, up: 2, size: 0.07, life: 0.6 }); break;
      case 'rune': this.stats?.heal?.(1); this.effects.burst('rune', point, 5, { speed: 2, up: 3, size: 0.06, life: 0.6, gravity: -0.3 }); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------------------
  // Especiais
  // ---------------------------------------------------------------------------
  /**
   * @param {object|null} def item na mão (lendário ou comum)
   * @param {THREE.Vector3} o origem (pés do jogador)
   * @param {THREE.Vector3} dir direção plana normalizada
   * @returns {number} duração da animação
   */
  special(def, o, dir) {
    const base = (def?.damage || 8);
    const kind = def?.legendary || 'spin';
    const yaw = Math.atan2(dir.x, dir.z);
    this.shake(0.6);
    this.sfx?.special?.(kind, o);
    switch (kind) {
      case 'roots': this._line(o, dir, { len: 12, speed: 26, width: 2.4, dmg: base * 2.2, stun: 2.2, spike: 'root', color: 0x9be05a }); break;
      case 'quake': {
        this.cfx.ring(o, { radius: 9, color: 0xd8c8a0, life: 0.6 });
        this.cfx.ring(o, { radius: 5, color: 0xffe0b0, life: 0.4 });
        const pts = []; for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r = 2.5 + (i % 3) * 2; pts.push({ x: o.x + Math.cos(a) * r, z: o.z + Math.sin(a) * r }); }
        this.cfx.spikes(pts, { kind: 'rock', height: 1.8, life: 1.8 });
        for (let i = 0; i < 8; i++) this.effects.dust(_v.set(o.x + (Math.random() - 0.5) * 10, o.y + 0.2, o.z + (Math.random() - 0.5) * 10).clone());
        this.area(o, 8, base * 2.4, { stun: 1.5, push: 10 });
        this.shake(1.2);
        break;
      }
      case 'wave': this._line(o, dir, { len: 16, speed: 20, width: 3, dmg: base * 2.3, push: 14, splash: true, color: 0x40d8ff }); break;
      case 'rune': this._line(o, dir, { len: 20, speed: 30, width: 2.6, dmg: base * 2.6, rune: true, color: 0x50ff90 }); break;
      case 'tide': this._throwTrident(o, dir, base * 2.2); break;
      case 'fire': {
        const pts = [];
        for (let r = 2; r <= 9; r += 1.4) for (let a = -0.5; a <= 0.5; a += 0.25) {
          const ang = yaw + a; pts.push({ x: o.x + Math.sin(ang) * r, z: o.z + Math.cos(ang) * r });
        }
        this.cfx.spikes(pts, { kind: 'fire', height: 1.2, life: 1.0 });
        for (let i = 0; i < 6; i++) this.effects.burst('fire', _v.set(o.x + dir.x * (2 + i * 1.3), o.y + 0.6, o.z + dir.z * (2 + i * 1.3)).clone(), 8, { speed: 3, up: 4, size: 0.2, life: 0.8, gravity: -0.6 });
        this.cfx.telegraph('cone', o, { time: 0.25, yaw, size: 9, color: 0xff6010 });
        // cone de dano
        for (const t of this.combat.targets) {
          if (!enemy(t, this.player)) continue;
          const s = t.getHitSpheres()[0], dx = s.x - o.x, dz = s.z - o.z, d = Math.hypot(dx, dz);
          if (d > 9.5 + s.r || (dx * dir.x + dz * dir.z) / Math.max(d, 1e-3) < 0.82) continue;
          this.combat.hit(t, base * 2.2, _w.set(dx, 0, dz).normalize().clone(), new THREE.Vector3(s.x, s.y, s.z), { source: 'special', stop: 0.05, push: 6, breaksArmor: true, fromPlayer: true });
          this.burn(t, 8, 4);
        }
        break;
      }
      case 'frost': {
        const pts = []; for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; for (const r of [3, 5.5]) pts.push({ x: o.x + Math.cos(a + r) * r, z: o.z + Math.sin(a + r) * r }); }
        this.cfx.spikes(pts.slice(0, 40), { kind: 'ice', height: 2.4, life: 2.4 });
        this.cfx.ring(o, { radius: 7, color: 0x8ad8ff, life: 0.5 });
        this.effects.burst('ice', _v.set(o.x, o.y + 1, o.z).clone(), 30, { speed: 9, up: 5, size: 0.08, life: 1.2 });
        this.area(o, 7, base * 2.2, { stun: 2.5, slow: 5, push: 2 });
        break;
      }
      case 'mist': {
        const tgts = [...this.combat.targets].filter((t) => enemy(t, this.player)).map((t) => [t, t.getHitSpheres()[0]])
          .filter(([, s]) => Math.hypot(s.x - o.x, s.z - o.z) < 45).sort((a, b) => Math.hypot(a[1].x - o.x, a[1].z - o.z) - Math.hypot(b[1].x - o.x, b[1].z - o.z));
        for (let i = 0; i < 6; i++) {
          const t = tgts.length ? tgts[i % tgts.length][0] : null;
          const a = yaw + (i - 2.5) * 0.18;
          const p = new THREE.Vector3(o.x, o.y + 1.5, o.z);
          setTimeout(() => this.projectiles.arrow(p, new THREE.Vector3(Math.sin(a) * 30, 6, Math.cos(a) * 30), Math.round(base * 1.4), 'player', { homing: t, trail: 'mist' }), i * 70);
        }
        this.effects.burst('mist', _v.set(o.x, o.y + 1.4, o.z).clone(), 16, { speed: 4, up: 2, size: 0.15, life: 0.8, gravity: -0.2 });
        break;
      }
      default: {  // giro com arma comum
        this.cfx.ring(o, { radius: 5, color: 0xfff0d0, life: 0.45 });
        this.area(o, 4.2, base * 2.5, { push: 9, stun: 0.6 });
        break;
      }
    }
    return 0.55;
  }

  /** Efeito que avança em linha reta, acertando cada inimigo uma vez. */
  _line(o, dir, cfg) {
    this.movers.push({ kind: 'line', p: new THREE.Vector3(o.x, o.y, o.z), dir: dir.clone(), d: 0, step: 0, hit: new Set(), ...cfg });
  }

  _throwTrident(o, dir, dmg) {
    const m = this.tridentMesh;
    m.visible = true;
    m.position.set(o.x, o.y + 1.4, o.z);
    m.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    this.movers.push({ kind: 'trident', p: m.position, dir: dir.clone(), d: 0, back: false, dmg, hit: new Set() });
  }

  update(dt) {
    // queimaduras
    for (let i = this.dots.length - 1; i >= 0; i--) {
      const d = this.dots[i];
      d.time -= dt; d.tick += dt;
      if (!d.t.alive || d.time <= 0) { this.dots.splice(i, 1); continue; }
      if (d.tick >= 0.5) {
        d.tick = 0;
        const s = d.t.getHitSpheres()[0];
        const p = new THREE.Vector3(s.x, s.y, s.z);
        this.combat.hit(d.t, d.dps * 0.5, new THREE.Vector3(0, 0, 1), p, { source: 'burn', fromPlayer: true, dot: true });
        this.effects.burst('fire', p, 3, { speed: 1, up: 2, size: 0.12, life: 0.5, gravity: -0.8 });
      }
    }
    // ondas e tridente
    for (let i = this.movers.length - 1; i >= 0; i--) {
      const m = this.movers[i];
      if (m.kind === 'line') {
        const adv = m.speed * dt;
        m.d += adv; m.step += adv;
        m.p.addScaledVector(m.dir, adv);
        m.p.y = this.groundAt(m.p.x, m.p.z);
        if (m.step >= 1.3) {
          m.step = 0;
          if (m.spike) this.cfx.spikes([{ x: m.p.x + (Math.random() - 0.5), z: m.p.z + (Math.random() - 0.5) }, { x: m.p.x - m.dir.z * 0.8, z: m.p.z + m.dir.x * 0.8 }, { x: m.p.x + m.dir.z * 0.8, z: m.p.z - m.dir.x * 0.8 }], { kind: m.spike, height: 1.7, life: 1.4 });
          if (m.splash) this.effects.splash(m.p.clone().setY(m.p.y + 0.3), true);
          if (m.rune) { this.cfx.flash(m.p.clone().setY(m.p.y + 1), { size: 1.2, color: m.color, life: 0.25 }); this.effects.burst('rune', m.p.clone().setY(m.p.y + 0.5), 6, { speed: 2, up: 5, size: 0.08, life: 0.7, gravity: -0.3 }); }
          this.cfx.ring(m.p, { radius: m.width, color: m.color, life: 0.35 });
        }
        this.area(m.p, m.width, m.dmg, { stun: m.stun || 0, push: m.push || 6 }, m.hit);
        if (m.d >= m.len) this.movers.splice(i, 1);
      } else if (m.kind === 'trident') {
        const sp = 34 * dt;
        if (!m.back) { m.p.addScaledVector(m.dir, sp); m.d += sp; if (m.d >= 26) { m.back = true; m.hit.clear(); } }
        else {
          const pp = this.player.position;
          _v.set(pp.x - m.p.x, pp.y + 1.4 - m.p.y, pp.z - m.p.z);
          const dist = _v.length();
          if (dist < 1.2) { this.tridentMesh.visible = false; this.movers.splice(i, 1); continue; }
          m.p.addScaledVector(_v.normalize(), Math.min(dist, sp));
          this.tridentMesh.rotation.y = Math.atan2(_v.x, _v.z);
        }
        this.tridentMesh.rotation.z += dt * 2;
        if (Math.random() < 0.6) this.effects.burst('splash', m.p, 1, { speed: 0.5, up: 0.5, size: 0.1, life: 0.4 });
        this.area(m.p, 1.6, m.dmg, { push: 5 }, m.hit);
      }
    }
  }
}
