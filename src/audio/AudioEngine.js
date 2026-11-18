/**
 * AudioEngine.js
 * Motor de áudio em Web Audio, sem arquivos de som: tudo é sintetizado.
 *   master → compressor → saída
 *   barramentos: music, sfx, ambient, ui (volume configurável em cada um)
 * O navegador só libera o áudio após um gesto do jogador: resume() no 1º clique/tecla.
 * Sons posicionais: panner HRTF seguindo a câmera (listener).
 */
export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master = c.createGain();
    this.master.connect(this.comp).connect(c.destination);
    this.bus = {};
    for (const b of ['music', 'sfx', 'ambient', 'ui']) {
      this.bus[b] = c.createGain();
      this.bus[b].connect(this.master);
    }
    this.volumes = { master: 0.8, music: 0.45, sfx: 0.8, ambient: 0.6, ui: 0.6 };
    this.applyVolumes();
    // ruído branco reutilizável (2 s)
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const unlock = () => { if (c.state !== 'running') c.resume(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get running() { return this.ctx.state === 'running'; }
  get now() { return this.ctx.currentTime; }

  setVolume(name, v) { this.volumes[name] = v; this.applyVolumes(); }
  applyVolumes() {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    for (const b in this.bus) this.bus[b].gain.setTargetAtTime(this.volumes[b], t, 0.05);
  }

  /** Abaixa a música (ex.: Spotify tocando). */
  duckMusic(on) {
    this.bus.music.gain.setTargetAtTime(on ? this.volumes.music * 0.12 : this.volumes.music, this.ctx.currentTime, 0.4);
  }

  /** Atualiza o "ouvido" na posição/orientação da câmera. */
  setListener(camera) {
    const l = this.ctx.listener, p = camera.position, t = this.ctx.currentTime;
    const f = this._f || (this._f = { x: 0, y: 0, z: -1 });
    const e = camera.matrixWorld.elements;
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10];
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6];
    } else {
      l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, e[4], e[5], e[6]);
    }
  }

  /** Saída de um som: barramento, com panner 3D opcional. */
  out(bus = 'sfx', pos = null, refDist = 6) {
    const g = this.ctx.createGain();
    if (pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = refDist; p.maxDistance = 600; p.rolloffFactor = 1.1;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p).connect(this.bus[bus]);
    } else g.connect(this.bus[bus]);
    return g;
  }

  /** Fonte de ruído filtrado com envelope (golpes, explosões, ondas, passos). */
  noiseBurst({ dur = 0.2, type = 'bandpass', freq = 1000, q = 1, freqEnd = null, gain = 0.5, attack = 0.005, bus = 'sfx', pos = null, refDist, rate = 1, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(bus, pos, refDist));
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  /** Tom com envelope (impactos metálicos, cordas, UI). */
  tone({ freq = 440, freqEnd = null, dur = 0.2, type = 'sine', gain = 0.3, attack = 0.004, bus = 'sfx', pos = null, refDist, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(bus, pos, refDist));
    o.start(t); o.stop(t + dur + 0.05);
  }
}
