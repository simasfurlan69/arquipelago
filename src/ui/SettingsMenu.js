/**
 * SettingsMenu.js
 * Menu de pausa e configurações (Esc / P / engrenagem no HUD). Abas:
 *   Gráficos · Áudio · Controles · Jogo · Spotify · Salvar
 * Tudo é aplicado na hora e guardado no navegador (localStorage).
 */
const KEY = 'arquipelago.config.v1';

export const DEFAULTS = {
  preset: 'alto', fov: 60, vegDistance: 1000, shadows: true, motionBlur: false, rain: 'on',
  master: 0.8, music: 0.45, sfx: 0.8, ambient: 0.6, musicOn: true,
  sensitivity: 1, invertY: false,
  difficulty: 'normal', damageNumbers: true, autosave: true,
  keys: { dodge: 'ControlLeft', lock: 'KeyQ', interact: 'KeyE', inventory: 'Tab', jump: 'Space' },
};

export class SettingsMenu {
  /**
   * @param {object} o { hooks: { apply(cfg), save(), load(), clear(), hasSave() }, spotifyPanel: HTMLElement|null }
   */
  constructor({ input, hooks }) {
    this.input = input;
    this.hooks = hooks;
    this.cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    this.cfg.keys = { ...DEFAULTS.keys, ...(this.cfg.keys || {}) };
    // v2: desfoque de movimento passa a vir desligado (deixava o personagem "pixelado/borrado" ao andar)
    if ((this.cfg.v || 1) < 2) { this.cfg.motionBlur = false; this.cfg.v = 2; }
    this.open = false;

    const el = this.el = document.createElement('div');
    el.id = 'settings';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="set-panel">
        <div class="set-head"><h2>⏸ Pausado</h2><button class="close" data-act="resume">Voltar ao jogo ✕</button></div>
        <div class="tabs">
          ${['Gráficos', 'Áudio', 'Controles', 'Jogo', 'Spotify', 'Salvar'].map((t, i) => `<button class="tab${i ? '' : ' on'}" data-tab="${i}">${t}</button>`).join('')}
        </div>
        <div class="pages">
          <div class="page" data-page="0">
            ${this._select('preset', 'Qualidade', [['baixo', 'Baixo'], ['alto', 'Alto'], ['ultra', 'Ultra']])}
            ${this._range('fov', 'Campo de visão', 50, 90, 1, '°')}
            ${this._range('vegDistance', 'Distância da vegetação', 400, 1600, 50, ' m')}
            ${this._check('shadows', 'Sombras')}
            ${this._check('motionBlur', 'Desfoque de movimento (motion blur)')}
            ${this._select('rain', 'Chuva e tempestades', [['on', 'Ligada'], ['light', 'Leve'], ['off', 'Desligada']])}
            <p class="tip">Dica: Chrome/Edge com aceleração de hardware ligada; no Windows, Configurações › Vídeo › Gráficos › navegador = Alto desempenho.</p>
          </div>
          <div class="page hidden" data-page="1">
            ${this._range('master', 'Volume geral', 0, 1, 0.05, '%')}
            ${this._range('music', 'Música', 0, 1, 0.05, '%')}
            ${this._range('sfx', 'Efeitos', 0, 1, 0.05, '%')}
            ${this._range('ambient', 'Ambiente (mar, vento)', 0, 1, 0.05, '%')}
            ${this._check('musicOn', 'Trilha do jogo (desligue para ouvir só o Spotify)')}
          </div>
          <div class="page hidden" data-page="2">
            ${this._range('sensitivity', 'Sensibilidade do mouse', 0.3, 2.5, 0.05, '×')}
            ${this._check('invertY', 'Inverter eixo Y')}
            <h3>Teclas (clique e aperte a nova tecla)</h3>
            ${Object.entries({ dodge: 'Esquivar', lock: 'Travar mira', interact: 'Interagir', inventory: 'Inventário', jump: 'Pular / âncora' })
              .map(([k, label]) => `<div class="row"><label>${label}</label><button class="key" data-key="${k}">${this.cfg.keys[k]}</button></div>`).join('')}
            <p class="tip">Fixas: WASD mover · Shift correr · 1–9 hotbar · clique atacar · G gráficos · Esc pausa.</p>
          </div>
          <div class="page hidden" data-page="3">
            ${this._select('difficulty', 'Dificuldade', [['facil', 'Fácil'], ['normal', 'Normal'], ['dificil', 'Difícil']])}
            ${this._check('damageNumbers', 'Mostrar números de dano')}
            ${this._check('autosave', 'Salvar automaticamente a cada 2 minutos')}
          </div>
          <div class="page hidden" data-page="4"><div id="spotify-panel"></div></div>
          <div class="page hidden" data-page="5">
            <div class="row"><button data-act="save">💾 Salvar agora</button><button data-act="load">📂 Carregar</button></div>
            <div class="row"><button data-act="clear" class="danger">🗑 Apagar progresso</button></div>
            <p class="tip" id="save-info"></p>
          </div>
        </div>
      </div>`;
    document.getElementById('hud').appendChild(el);

    // Engrenagem no HUD
    const gear = document.createElement('button');
    gear.id = 'gear'; gear.textContent = '⚙'; gear.title = 'Configurações (Esc)';
    gear.addEventListener('click', () => this.toggle(true));
    document.getElementById('hud').appendChild(gear);

    el.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => this.tab(+b.dataset.tab)));
    el.querySelectorAll('[data-cfg]').forEach((inp) => {
      const k = inp.dataset.cfg;
      inp.addEventListener('input', () => {
        this.cfg[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
        this._label(inp);
        this.commit();
      });
    });
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this._action(b.dataset.act)));
    el.querySelectorAll('.key').forEach((b) => b.addEventListener('click', () => {
      b.textContent = '…'; b.classList.add('wait');
      const h = (e) => { e.preventDefault(); this.cfg.keys[b.dataset.key] = e.code; b.textContent = e.code; b.classList.remove('wait'); window.removeEventListener('keydown', h, true); this.commit(); };
      window.addEventListener('keydown', h, true);
    }));
    el.querySelectorAll('[data-cfg]').forEach((i) => this._label(i));
    // perder a trava do mouse sem UI aberta = Esc do jogador → pausa
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && !input.uiOpen && !this.open && this.hooks.isPlaying?.()) this.toggle(true);
    });
    this.commit(true);
  }

  _range(k, label, min, max, step, unit) {
    return `<div class="row"><label>${label}</label><input type="range" data-cfg="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${this.cfg[k]}"><span class="val"></span></div>`;
  }
  _check(k, label) { return `<div class="row"><label><input type="checkbox" data-cfg="${k}" ${this.cfg[k] ? 'checked' : ''}> ${label}</label></div>`; }
  _select(k, label, opts) {
    return `<div class="row"><label>${label}</label><select data-cfg="${k}">${opts.map(([v, t]) => `<option value="${v}" ${this.cfg[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  }
  _label(inp) {
    const v = inp.parentElement.querySelector('.val');
    if (!v) return;
    const u = inp.dataset.unit;
    v.textContent = u === '%' ? `${Math.round(inp.value * 100)}%` : `${inp.value}${u}`;
  }

  tab(i) {
    this.el.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', +b.dataset.tab === i));
    this.el.querySelectorAll('.page').forEach((p) => p.classList.toggle('hidden', +p.dataset.page !== i));
    if (i === 5) this._saveInfo();
  }

  _saveInfo() {
    const raw = localStorage.getItem('arquipelago.save.v1');
    this.el.querySelector('#save-info').textContent = raw ? `Último salvamento: ${new Date(JSON.parse(raw).t).toLocaleString('pt-BR')}` : 'Nenhum progresso salvo.';
  }

  _action(a) {
    if (a === 'resume') this.toggle(false);
    if (a === 'save') { this.hooks.save(); this._saveInfo(); }
    if (a === 'load') { if (this.hooks.load()) this.toggle(false); }
    if (a === 'clear' && confirm('Apagar todo o progresso salvo?')) { this.hooks.clear(); this._saveInfo(); }
  }

  commit(initial = false) {
    localStorage.setItem(KEY, JSON.stringify(this.cfg));
    this.hooks.apply(this.cfg, initial);
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    this.input.uiOpen = this.open;
    this.el.style.pointerEvents = this.open ? 'auto' : 'none';
    if (this.open) this.input.releasePointer();
    this.hooks.pause?.(this.open);
  }
}
