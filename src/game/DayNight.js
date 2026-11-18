/**
 * DayNight.js
 * Relógio do mundo. t ∈ [0,1): 0 = meia-noite, 0.25 = 06h, 0.5 = meio-dia, 0.75 = 18h.
 * O dia (06h–18h) e a noite (18h–06h) têm durações reais diferentes (config).
 * Emite 'dusk' (anoitecer) e 'dawn' (amanhecer).
 */
import { CONFIG } from '../config.js';

const D = CONFIG.dayNight;

export class DayNight {
  constructor() {
    this.t = D.startTime;
    this.day = 1;
    this.listeners = { dusk: [], dawn: [] };
    this._wasNight = this.isNight;
  }

  on(evt, fn) { this.listeners[evt].push(fn); }

  /** Elevação do sol em graus (-70 à meia-noite, +70 ao meio-dia). */
  get sunElevation() { return Math.sin((this.t - 0.25) * Math.PI * 2) * 70; }

  /** Azimute do sol: nasce a leste e se põe a oeste. */
  get sunAzimuth() { return 90 + this.t * 360; }

  get isNight() { return this.sunElevation < -3; }

  /** 0 = noite plena, 1 = dia pleno (transição no crepúsculo). */
  get dayFactor() {
    const e = this.sunElevation;
    const x = Math.min(1, Math.max(0, (e + 8) / 18));
    return x * x * (3 - 2 * x);
  }

  get clock() {
    const mins = Math.floor(this.t * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  setTime(t) {
    this.t = ((t % 1) + 1) % 1;
  }

  update(dt) {
    const isDayPhase = this.t >= 0.25 && this.t < 0.75;
    const dur = isDayPhase ? D.dayDuration : D.nightDuration;
    this.t += (dt / dur) * 0.5;
    if (this.t >= 1) { this.t -= 1; this.day++; }

    const night = this.isNight;
    if (night !== this._wasNight) {
      this._wasNight = night;
      for (const fn of this.listeners[night ? 'dusk' : 'dawn']) fn();
    }
  }
}
