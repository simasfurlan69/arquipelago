/**
 * GraphicsMenu.js
 * Menu de qualidade gráfica (tecla G). Três presets, salvos no navegador:
 *   Baixo  → resolução interna 60 %, nuvens em meia resolução, sombras 1024
 *   Alto   → resolução dinâmica 75–100 % (padrão)
 *   Ultra  → resolução 100 % fixa na densidade de pixels do monitor, sombras 4096
 */
const PRESETS = {
  baixo: { label: 'Baixo', minScale: 0.75, maxScale: 0.75, dynamic: false, pixelRatio: 1, clouds: 0.5, shadow: 1024 },
  alto: { label: 'Alto', minScale: 0.9, maxScale: 1, dynamic: true, pixelRatio: 1, clouds: 1, shadow: 2048 },
  ultra: { label: 'Ultra', minScale: 1, maxScale: 1, dynamic: false, pixelRatio: Math.min(2, window.devicePixelRatio || 1), clouds: 1, shadow: 4096 },
};
const KEY = 'arquipelago.graficos';

export class GraphicsMenu {
  constructor({ gfx, sky, input, hud }) {
    this.gfx = gfx; this.sky = sky; this.input = input; this.hud = hud;
    this.el = document.createElement('div');
    this.el.id = 'gfxmenu';
    this.el.className = 'hidden';
    this.el.innerHTML = `<h2>Gráficos</h2>
      <div class="opts">${Object.entries(PRESETS).map(([k, p]) => `<button data-k="${k}">${p.label}</button>`).join('')}</div>
      <p>Dicas: use Chrome/Edge com <b>aceleração de hardware</b> ligada e, no Windows,
      Configurações › Vídeo › Gráficos › navegador = <b>Alto desempenho</b> (placa de vídeo dedicada).</p>
      <p class="hint">G fecha</p>`;
    document.getElementById('hud').appendChild(this.el);
    this.el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.apply(b.dataset.k)));
    this.apply(localStorage.getItem(KEY) || 'alto', true);
  }

  apply(key, silent = false) {
    const p = PRESETS[key] || PRESETS.alto;
    this.current = key;
    localStorage.setItem(KEY, key);
    this.gfx.setQuality(p);
    if (this.sky.clouds) this.sky.clouds.resolutionScale = p.clouds;
    this.sky.sun.shadow.mapSize.set(p.shadow, p.shadow);
    for (const l of this.sky.csm.lights || []) { l.shadow.mapSize.set(p.shadow, p.shadow); l.shadow.map?.dispose(); l.shadow.map = null; }
    this.el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === key));
    if (!silent) this.hud.toast(`Gráficos: ${p.label}`, 1.5);
  }

  toggle() {
    const open = this.el.classList.toggle('hidden') === false;
    this.input.uiOpen = open;
    this.el.style.pointerEvents = open ? 'auto' : 'none';
    if (open) this.input.releasePointer();
  }
}
