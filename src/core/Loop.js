/**
 * Loop.js
 * Loop principal baseado em renderer.setAnimationLoop (equivale a
 * requestAnimationFrame, mas também funciona em WebXR e espera o backend WebGPU).
 *
 * Otimizações:
 *  - delta limitado (evita "saltos" de física ao voltar de outra aba);
 *  - lista ordenada de sistemas com update(dt, t), sem alocações por frame;
 *  - contador de frame exposto para LOD de atualização (fauna distante etc.).
 */
export class Loop {
  constructor(renderer, renderFn) {
    this.renderer = renderer;
    this.renderFn = renderFn;
    this.systems = [];
    this.elapsed = 0;
    this.frame = 0;
    this.maxDelta = 0.05;
    this._last = performance.now();
    this.fps = 0;
    this._fpsAcc = 0; this._fpsFrames = 0;
  }

  /** Adiciona um sistema com método update(dt, elapsed, frame). */
  add(system) { this.systems.push(system); return system; }

  start() {
    this._last = performance.now();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  stop() { this.renderer.setAnimationLoop(null); }

  _tick() {
    const now = performance.now();
    const dt = Math.min((now - this._last) / 1000, this.maxDelta);
    this._last = now;
    this.elapsed += dt;
    this.frame++;

    // FPS (média por segundo)
    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc >= 1) { this.fps = Math.round(this._fpsFrames / this._fpsAcc); this._fpsAcc = 0; this._fpsFrames = 0; }

    const systems = this.systems;
    for (let i = 0; i < systems.length; i++) systems[i].update(dt, this.elapsed, this.frame);

    this.renderFn();
  }
}
