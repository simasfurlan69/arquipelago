/**
 * Music.js
 * Trilha procedural + ambiente contínuo (Web Audio, sem arquivos).
 *   Música: 3 temas (explorar, batalha, chefe) gerados por um sequenciador simples
 *   em escala modal; crossfade ao mudar de estado.
 *   Ambiente: ondas (volume pela proximidade do mar), vento (altitude/velocidade),
 *   pássaros de dia e grilos à noite.
 */
const THEMES = {
  explore: { bpm: 72, root: 50, scale: [0, 2, 3, 5, 7, 9, 10], wave: 'triangle', pad: true, drums: 0, lead: 0.07 },
  battle: { bpm: 128, root: 45, scale: [0, 1, 3, 5, 7, 8, 10], wave: 'sawtooth', pad: true, drums: 1, lead: 0.06 },
  boss: { bpm: 140, root: 41, scale: [0, 1, 3, 4, 7, 8, 10], wave: 'sawtooth', pad: true, drums: 2, lead: 0.07 },
};
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(engine) {
    this.a = engine;
    this.state = 'explore';
    this.enabled = true;
    this.step = 0;
    this.nextT = 0;
    this.chord = 0;

    // ---- ambiente contínuo (fontes em loop com ganho controlado) ----
    const c = engine.ctx;
    const loop = (filterType, freq, q) => {
      const src = c.createBufferSource(); src.buffer = engine.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(engine.bus.ambient);
      src.start();
      return { f, g };
    };
    this.waves = loop('lowpass', 500, 0.5);
    this.wind = loop('bandpass', 400, 0.6);
    this._waveLfo = 0;
  }

  setState(s) { if (THEMES[s]) this.state = s; }

  /**
   * @param {number} dt
   * @param {object} o { shoreDist (m), altitude (m), wind (m/s), night (0..1), combat ('explore'|'battle'|'boss') }
   */
  update(dt, o) {
    const a = this.a;
    if (!a.running) return;
    const t = a.now;
    // ---- ambiente ----
    this._waveLfo += dt;
    const near = Math.max(0, 1 - o.shoreDist / 120);
    const swell = 0.55 + 0.45 * Math.sin(this._waveLfo * 0.9) * Math.sin(this._waveLfo * 0.37);
    this.waves.g.gain.setTargetAtTime((0.12 + 0.5 * near) * swell, t, 0.3);
    this.waves.f.frequency.setTargetAtTime(350 + 500 * swell, t, 0.3);
    const windAmt = Math.min(1, 0.15 + o.altitude / 90 + o.wind / 25);
    this.wind.g.gain.setTargetAtTime(windAmt * 0.12, t, 0.5);
    this.wind.f.frequency.setTargetAtTime(300 + 500 * Math.sin(this._waveLfo * 0.21) ** 2, t, 0.5);
    // pássaros (dia) e grilos (noite) esporádicos
    if (Math.random() < dt * (o.night > 0.5 ? 2.5 : 0.6)) {
      if (o.night > 0.5) for (let i = 0; i < 3; i++) a.tone({ freq: 4200 + Math.random() * 300, dur: 0.04, type: 'sine', gain: 0.02, bus: 'ambient', delay: i * 0.06 });
      else { const f = 2200 + Math.random() * 1600; a.tone({ freq: f, freqEnd: f * 1.4, dur: 0.12, type: 'sine', gain: 0.03, bus: 'ambient' }); a.tone({ freq: f * 1.2, freqEnd: f, dur: 0.1, type: 'sine', gain: 0.025, bus: 'ambient', delay: 0.15 }); }
    }

    // ---- música (sequenciador com agendamento à frente) ----
    if (!this.enabled) return;
    this.setState(o.combat || 'explore');
    const th = THEMES[this.state];
    const stepDur = 60 / th.bpm / 2;              // colcheias
    if (this.nextT < t) this.nextT = t + 0.05;
    while (this.nextT < t + 0.2) {
      this._playStep(th, this.step, this.nextT, stepDur);
      this.nextT += stepDur;
      this.step++;
    }
  }

  _playStep(th, step, t, dur) {
    const a = this.a, c = a.ctx;
    const bar = Math.floor(step / 8);
    if (step % 8 === 0) this.chord = [0, 5, 3, 4][bar % 4];
    const deg = (i) => th.root + th.scale[(this.chord + i) % 7] + 12 * Math.floor((this.chord + i) / 7);
    const delay = Math.max(0, t - a.now);
    // pad (acorde) no início do compasso
    if (th.pad && step % 8 === 0) for (const i of [0, 2, 4]) a.tone({ freq: mtof(deg(i) + 12), dur: dur * 8, type: 'sine', gain: 0.045, attack: 0.6, bus: 'music', delay });
    // baixo
    if (step % 4 === 0 || (th.drums && step % 2 === 0)) a.tone({ freq: mtof(deg(0) - 12), dur: dur * 1.8, type: 'triangle', gain: 0.09, bus: 'music', delay });
    // melodia esparsa
    if (Math.random() < (th.drums ? 0.55 : 0.3)) a.tone({ freq: mtof(deg([0, 2, 4, 5, 7][Math.floor(Math.random() * 5)]) + 24), dur: dur * 1.6, type: th.wave, gain: th.lead * 0.6, bus: 'music', delay });
    // percussão
    if (th.drums) {
      if (step % 4 === 0) a.tone({ freq: 110, freqEnd: 40, dur: 0.25, type: 'sine', gain: 0.25, bus: 'music', delay });
      if (step % 4 === 2) a.noiseBurst({ dur: 0.12, freq: 1800, q: 0.7, gain: 0.12, bus: 'music', delay });
      if (th.drums > 1 && step % 2 === 1) a.noiseBurst({ dur: 0.04, type: 'highpass', freq: 6000, gain: 0.05, bus: 'music', delay });
    }
    void c;
  }
}
