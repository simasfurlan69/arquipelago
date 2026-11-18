/**
 * Combat.js
 * Registro central de tudo que pode levar dano. Um alvo implementa:
 *   alive: boolean
 *   faction: 'player' | 'animal' | 'undead' | 'ship-player' | 'ship-ghost'
 *   getHitSpheres(): Array<{x,y,z,r}>   (em coordenadas de mundo)
 *   takeDamage(amount, dir: Vector3, source: string)
 *
 * Oferece consulta de golpe corpo a corpo (cone à frente) e teste de segmento
 * contra esferas (projéteis).
 */
import * as THREE from 'three/webgpu';

const _d = new THREE.Vector3();

export class Combat {
  constructor() { this.targets = new Set(); }

  register(t) { this.targets.add(t); return t; }

  /**
   * Aplica dano e avisa os sistemas de feedback (números flutuantes, som, hit-stop).
   * @param {object} o { crit, source, stop } stop = segundos de hit-stop
   */
  hit(target, amount, dir, point, o = {}) {
    target.takeDamage(amount, dir, o.source || '', o);
    this.onHit?.(target, amount, point, o);
    if (o.stop) this.hitStop = Math.max(this.hitStop || 0, o.stop);
  }
  unregister(t) { this.targets.delete(t); }

  /**
   * Golpe corpo a corpo: retorna o alvo vivo mais próximo dentro do alcance e de
   * um cone de ~100° à frente (plano XZ), ignorando a facção do atacante.
   */
  meleeTarget(origin, forward, range, attackerFaction) {
    let best = null, bestD = Infinity;
    for (const t of this.targets) {
      if (!t.alive || t.faction === attackerFaction) continue;
      for (const s of t.getHitSpheres()) {
        _d.set(s.x - origin.x, 0, s.z - origin.z);
        const dist = _d.length() - s.r;
        if (dist > range || Math.abs(s.y - origin.y) > 2.5) continue;
        _d.normalize();
        if (dist > 0.4 && _d.dot(forward) < 0.6) continue;
        if (dist < bestD) { bestD = dist; best = t; }
      }
    }
    return best;
  }

  /**
   * Primeiro alvo atingido pelo segmento p0 → p1.
   * @returns {{target, point: THREE.Vector3}|null}
   */
  segmentHit(p0, p1, ignoreFaction) {
    const seg = _d.subVectors(p1, p0);
    const len2 = seg.lengthSq();
    let best = null, bestT = Infinity, bestS = null;
    for (const t of this.targets) {
      if (!t.alive || t.faction === ignoreFaction) continue;
      for (const s of t.getHitSpheres()) {
        // Ponto do segmento mais próximo do centro da esfera
        const k = Math.max(0, Math.min(1, ((s.x - p0.x) * seg.x + (s.y - p0.y) * seg.y + (s.z - p0.z) * seg.z) / len2));
        const cx = p0.x + seg.x * k - s.x, cy = p0.y + seg.y * k - s.y, cz = p0.z + seg.z * k - s.z;
        if (cx * cx + cy * cy + cz * cz <= s.r * s.r && k < bestT) { bestT = k; best = t; bestS = s; }
      }
    }
    if (!best) return null;
    const point = new THREE.Vector3().copy(p0).addScaledVector(seg, bestT);
    // acerto crítico: parte de cima da esfera mais alta do alvo (cabeça)
    const top = Math.max(...best.getHitSpheres().map((q) => q.y));
    const crit = bestS.y >= top - 1e-3 && point.y > bestS.y + bestS.r * 0.35;
    return { target: best, point, crit };
  }
}

/** Faz uma lista de materiais "piscar" em vermelho ao levar dano. */
export class HitFlash {
  constructor(root) {
    this.mats = new Set();
    root.traverse((o) => {
      if (o.isMesh && o.material && 'emissive' in o.material) this.mats.add(o.material);
    });
    this.base = new Map([...this.mats].map((m) => [m, m.emissive.clone()]));
    this.t = 0;
  }
  trigger() { this.t = 0.18; }
  update(dt) {
    if (this.t <= 0) return;
    this.t -= dt;
    const on = this.t > 0;
    for (const m of this.mats) {
      if (on) m.emissive.setRGB(0.9, 0.05, 0.02);
      else m.emissive.copy(this.base.get(m));
    }
  }
}
