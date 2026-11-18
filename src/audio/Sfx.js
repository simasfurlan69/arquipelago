/**
 * Sfx.js
 * Biblioteca de efeitos sonoros sintetizados (AudioEngine). Cada efeito é uma
 * combinação de ruído filtrado + tons com envelope, com pequena variação aleatória
 * para não soar repetitivo.
 */
const rnd = (a, b) => a + Math.random() * (b - a);

export class Sfx {
  constructor(engine) { this.a = engine; this._step = 0; }

  // ---------------- Personagem ----------------
  footstep(surface = 'grass', pos = null, run = false) {
    const a = this.a, g = run ? 0.32 : 0.22;
    if (surface === 'wood') {
      a.tone({ freq: rnd(140, 170), freqEnd: 90, dur: 0.09, type: 'triangle', gain: g * 0.8, pos });
      a.noiseBurst({ dur: 0.06, freq: 900, q: 2, gain: g * 0.5, pos });
    } else if (surface === 'sand') a.noiseBurst({ dur: 0.14, type: 'lowpass', freq: rnd(1200, 1700), gain: g, pos });
    else if (surface === 'water') a.noiseBurst({ dur: 0.22, freq: rnd(500, 800), freqEnd: 300, q: 0.8, gain: g * 1.2, pos });
    else a.noiseBurst({ dur: 0.1, freq: rnd(1800, 2600), q: 0.7, gain: g * 0.8, pos });
  }
  jump(pos) { this.a.noiseBurst({ dur: 0.15, type: 'lowpass', freq: 700, gain: 0.25, pos }); }
  land(pos) { this.a.noiseBurst({ dur: 0.18, type: 'lowpass', freq: 400, gain: 0.45, pos }); }
  dodge(pos) { this.a.noiseBurst({ dur: 0.3, freq: 800, freqEnd: 300, q: 0.6, gain: 0.35, pos }); }
  hurt() {
    this.a.tone({ freq: 180, freqEnd: 90, dur: 0.25, type: 'sawtooth', gain: 0.18, bus: 'sfx' });
    this.a.noiseBurst({ dur: 0.12, type: 'lowpass', freq: 600, gain: 0.4 });
  }
  eat() { for (let i = 0; i < 3; i++) this.a.noiseBurst({ dur: 0.06, freq: 2500, q: 3, gain: 0.15, attack: 0.002 }); }

  // ---------------- Armas ----------------
  swing(heavy = false, pos = null) {
    this.a.noiseBurst({ dur: heavy ? 0.32 : 0.22, freq: heavy ? 700 : 1400, freqEnd: heavy ? 250 : 500, q: 1.4, gain: heavy ? 0.4 : 0.3, pos });
  }
  hitFlesh(pos, crit = false) {
    this.a.noiseBurst({ dur: 0.14, type: 'lowpass', freq: 900, gain: 0.55, pos });
    this.a.tone({ freq: crit ? 220 : 120, freqEnd: 60, dur: 0.16, type: 'sine', gain: 0.4, pos });
    if (crit) this.a.tone({ freq: 1800, freqEnd: 900, dur: 0.18, type: 'triangle', gain: 0.15, pos });
  }
  hitMetal(pos) {
    for (const f of [rnd(1900, 2300), rnd(3100, 3500), rnd(4800, 5200)]) this.a.tone({ freq: f, dur: rnd(0.25, 0.45), type: 'sine', gain: 0.08, pos });
    this.a.noiseBurst({ dur: 0.05, freq: 4000, q: 2, gain: 0.3, pos });
  }
  chop(pos) {
    this.a.tone({ freq: rnd(180, 220), freqEnd: 110, dur: 0.12, type: 'triangle', gain: 0.45, pos });
    this.a.noiseBurst({ dur: 0.09, freq: 1300, q: 1.5, gain: 0.35, pos });
  }
  treeFall(pos) {
    this.a.noiseBurst({ dur: 1.2, freq: 900, freqEnd: 200, q: 0.6, gain: 0.3, pos, refDist: 10 });
    this.a.noiseBurst({ dur: 0.6, type: 'lowpass', freq: 250, gain: 0.7, pos, refDist: 12, attack: 0.02 });
  }
  /** Tronco batendo no chão (baque grave + folhagem). */
  treeThud(pos) {
    this.a.noiseBurst({ dur: 0.8, type: 'lowpass', freq: 220, freqEnd: 80, gain: 0.9, pos, refDist: 14, attack: 0.005 });
    this.a.tone({ freq: 60, freqEnd: 35, dur: 0.5, type: 'sine', gain: 0.5, pos, refDist: 14 });
    this.a.noiseBurst({ dur: 0.9, freq: 2600, freqEnd: 900, q: 0.5, gain: 0.18, pos, delay: 0.04 });
  }
  pick(pos) {
    this.a.tone({ freq: rnd(2400, 2900), dur: 0.12, type: 'square', gain: 0.07, pos });
    this.a.noiseBurst({ dur: 0.08, freq: 3500, q: 2, gain: 0.35, pos });
  }
  rockBreak(pos) { this.a.noiseBurst({ dur: 0.5, type: 'lowpass', freq: 1600, freqEnd: 300, gain: 0.6, pos }); }
  bowDraw() { this.a.tone({ freq: 90, freqEnd: 160, dur: 0.6, type: 'sawtooth', gain: 0.04 }); }
  bowRelease(pos) {
    this.a.tone({ freq: rnd(110, 130), freqEnd: 70, dur: 0.25, type: 'triangle', gain: 0.35, pos });
    this.a.noiseBurst({ dur: 0.25, freq: 2500, freqEnd: 1200, q: 2, gain: 0.15, pos });
  }
  gunshot(rifle = false, pos = null) {
    const a = this.a;
    a.noiseBurst({ dur: rifle ? 0.5 : 0.22, type: 'lowpass', freq: rifle ? 2400 : 4200, freqEnd: 300, gain: rifle ? 0.95 : 0.75, attack: 0.001, pos, refDist: 15 });
    a.tone({ freq: rifle ? 90 : 160, freqEnd: 40, dur: rifle ? 0.35 : 0.15, type: 'sine', gain: 0.5, pos, refDist: 15 });
    a.noiseBurst({ dur: rifle ? 0.9 : 0.4, freq: 900, freqEnd: 200, q: 0.4, gain: 0.15, delay: 0.03, pos, refDist: 40 });   // eco
  }
  reload() {
    this.a.tone({ freq: 900, dur: 0.05, type: 'square', gain: 0.06, bus: 'sfx' });
    this.a.noiseBurst({ dur: 0.12, freq: 2200, q: 3, gain: 0.25, delay: 0.25 });
  }
  reloadEnd() {
    this.a.noiseBurst({ dur: 0.06, freq: 3000, q: 4, gain: 0.3 });
    this.a.tone({ freq: 1200, freqEnd: 700, dur: 0.07, type: 'square', gain: 0.06, delay: 0.08 });
  }
  dryFire() { this.a.tone({ freq: 1800, dur: 0.03, type: 'square', gain: 0.07 }); }
  arrowHit(pos) { this.a.noiseBurst({ dur: 0.07, freq: 1800, q: 2, gain: 0.35, pos }); }

  // ---------------- Navio ----------------
  cannon(pos) {
    const a = this.a;
    a.noiseBurst({ dur: 1.4, type: 'lowpass', freq: 600, freqEnd: 60, gain: 0.9, attack: 0.002, pos, refDist: 25 });
    a.tone({ freq: 70, freqEnd: 30, dur: 0.6, type: 'sine', gain: 0.6, pos, refDist: 25 });
    a.noiseBurst({ dur: 0.25, freq: 2500, q: 0.8, gain: 0.3, pos, refDist: 25 });
  }
  shipHit(pos) {
    this.a.noiseBurst({ dur: 0.5, type: 'lowpass', freq: 1200, freqEnd: 200, gain: 0.8, pos, refDist: 20 });
    this.a.tone({ freq: rnd(90, 130), freqEnd: 50, dur: 0.4, type: 'triangle', gain: 0.4, pos, refDist: 20 });
  }
  splash(pos, big = false) {
    this.a.noiseBurst({ dur: big ? 1.1 : 0.4, freq: big ? 700 : 1200, freqEnd: 250, q: 0.5, gain: big ? 0.7 : 0.35, pos, refDist: big ? 20 : 6 });
  }
  sailUp() { this.a.noiseBurst({ dur: 0.7, freq: 600, freqEnd: 1200, q: 0.4, gain: 0.2 }); }
  anchor() {
    for (let i = 0; i < 8; i++) this.a.tone({ freq: rnd(900, 1300), dur: 0.08, type: 'square', gain: 0.05, delay: i * 0.07 });
    this.splash(null, true);
  }

  // ---------------- Interface / mundo ----------------
  pickup() { this.a.tone({ freq: 880, freqEnd: 1320, dur: 0.12, type: 'triangle', gain: 0.12, bus: 'ui' }); }
  click() { this.a.tone({ freq: 660, dur: 0.05, type: 'square', gain: 0.05, bus: 'ui' }); }
  craft() {
    for (const [f, d] of [[523, 0], [659, 0.07], [784, 0.14]]) this.a.tone({ freq: f, dur: 0.18, type: 'triangle', gain: 0.1, bus: 'ui', delay: d });
  }
  build() { for (let i = 0; i < 4; i++) this.a.tone({ freq: 200, freqEnd: 120, dur: 0.1, type: 'triangle', gain: 0.3, delay: i * 0.18 }); }
  quest() {
    for (const [f, d] of [[392, 0], [523, 0.12], [659, 0.24], [784, 0.36]]) this.a.tone({ freq: f, dur: 0.5, type: 'sine', gain: 0.12, bus: 'ui', delay: d });
  }
  bossRoar(pos) {
    this.a.tone({ freq: 90, freqEnd: 45, dur: 1.6, type: 'sawtooth', gain: 0.35, pos, refDist: 30 });
    this.a.noiseBurst({ dur: 1.5, type: 'lowpass', freq: 500, freqEnd: 120, gain: 0.6, pos, refDist: 30, attack: 0.1 });
  }
  slam(pos) {
    this.a.noiseBurst({ dur: 0.9, type: 'lowpass', freq: 300, freqEnd: 40, gain: 1, attack: 0.003, pos, refDist: 25 });
    this.a.tone({ freq: 55, freqEnd: 30, dur: 0.7, gain: 0.7, pos, refDist: 25 });
  }
  magic(pos) { this.a.tone({ freq: 600, freqEnd: 1600, dur: 0.6, type: 'sine', gain: 0.15, pos }); this.a.tone({ freq: 900, freqEnd: 2400, dur: 0.6, type: 'triangle', gain: 0.06, pos }); }
  fire(pos) { this.a.noiseBurst({ dur: 0.8, type: 'lowpass', freq: 1500, freqEnd: 400, gain: 0.4, pos, refDist: 10 }); }
  victory() {
    for (const [f, d] of [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.7], [1047, 0.85]]) this.a.tone({ freq: f, dur: 0.6, type: 'triangle', gain: 0.14, bus: 'ui', delay: d });
  }

  /** Martelo na bigorna: tinido metálico agudo + baque. */
  hammer(pos) {
    this.a.tone({ freq: rnd(1800, 2100), freqEnd: 1700, dur: 0.35, type: 'triangle', gain: 0.18, pos, refDist: 4 });
    this.a.tone({ freq: rnd(3300, 3700), dur: 0.2, type: 'sine', gain: 0.08, pos, refDist: 4 });
    this.a.noiseBurst({ dur: 0.06, freq: 2500, q: 1.2, gain: 0.3, pos, refDist: 4 });
  }

  // ---------------- Combate novo ----------------
  /** Golpe pesado batendo no chão: baque grave + estalo. */
  heavyImpact(pos) {
    this.a.noiseBurst({ dur: 0.45, type: 'lowpass', freq: 500, freqEnd: 60, gain: 0.8, pos });
    this.a.tone({ freq: 90, freqEnd: 35, dur: 0.5, type: 'sine', gain: 0.5, pos });
    this.a.noiseBurst({ dur: 0.08, freq: 3200, q: 0.6, gain: 0.25, pos });
  }
  /** Esquiva perfeita: "whoosh" invertido + sino cristalino. */
  perfectDodge() {
    this.a.noiseBurst({ dur: 0.35, freq: 400, freqEnd: 2400, q: 1.2, gain: 0.3, bus: 'ui' });
    this.a.tone({ freq: 1568, dur: 0.6, type: 'sine', gain: 0.12, bus: 'ui', delay: 0.05 });
    this.a.tone({ freq: 2093, dur: 0.5, type: 'sine', gain: 0.08, bus: 'ui', delay: 0.12 });
  }
  /** Golpe lendário (F) com timbre por elemento. */
  special(kind, pos = null) {
    const a = this.a;
    a.noiseBurst({ dur: 0.6, freq: 900, freqEnd: 200, q: 0.8, gain: 0.5, pos });
    if (kind === 'fire') a.noiseBurst({ dur: 1.0, type: 'lowpass', freq: 2200, freqEnd: 500, gain: 0.5, pos });
    else if (kind === 'frost') { for (let i = 0; i < 5; i++) a.tone({ freq: rnd(2600, 4200), dur: 0.25, type: 'triangle', gain: 0.06, pos, delay: i * 0.05 }); }
    else if (kind === 'rune') { a.tone({ freq: 220, freqEnd: 880, dur: 0.8, type: 'sawtooth', gain: 0.08, pos }); a.tone({ freq: 330, freqEnd: 1320, dur: 0.8, type: 'sine', gain: 0.1, pos }); }
    else if (kind === 'wave' || kind === 'tide') a.noiseBurst({ dur: 1.2, freq: 600, freqEnd: 250, q: 0.6, gain: 0.5, pos, rate: 0.6 });
    else if (kind === 'quake' || kind === 'roots') { a.noiseBurst({ dur: 1.0, type: 'lowpass', freq: 300, freqEnd: 50, gain: 0.9, pos }); a.tone({ freq: 60, freqEnd: 30, dur: 0.9, type: 'sine', gain: 0.5, pos }); }
    else if (kind === 'mist') a.tone({ freq: 500, freqEnd: 1500, dur: 0.7, type: 'sine', gain: 0.12, pos });
    else a.tone({ freq: 140, freqEnd: 70, dur: 0.4, type: 'sawtooth', gain: 0.12, pos });
  }
  /** Mordida de tubarão: estalo + espirro d'água. */
  sharkBite(pos) {
    this.a.noiseBurst({ dur: 0.12, freq: 1800, q: 1.5, gain: 0.5, pos });
    this.a.noiseBurst({ dur: 0.5, freq: 700, freqEnd: 300, q: 0.7, gain: 0.5, pos });
  }
}
