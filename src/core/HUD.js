/**
 * HUD.js
 * Interface 2D em DOM: status, prompt de interação, barra de progresso,
 * caixa de diálogo dos NPCs e tela de carregamento.
 */
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      loading: $('loading'), loadingText: $('loading-text'), loadingBar: $('loading-bar'),
      backend: $('backend'), mode: $('mode'), speed: $('speed'),
      prompt: $('prompt'),
      progress: $('progress'), progressLabel: $('progress-label'), progressBar: $('progress-bar'),
      dialog: $('dialog'), dialogName: $('dialog-name'), dialogText: $('dialog-text'),
    };
    this._toastTimer = 0;
    this._promptText = '';
  }

  setLoading(pct, text) {
    this.el.loadingBar.style.width = `${pct}%`;
    if (text) this.el.loadingText.textContent = text;
  }
  hideLoading() { this.el.loading.classList.add('done'); }

  setBackend(name) { this.el.backend.textContent = `Renderer: ${name}`; }
  setMode(text) { this.el.mode.textContent = text; }
  setSpeed(text) { this.el.speed.textContent = text; }

  /** Prompt contextual ("E – Falar"). Passe null para esconder. */
  setPrompt(text) {
    if (this._toastTimer > 0) return;           // toasts têm prioridade
    if (text === this._promptText) return;
    this._promptText = text;
    this.el.prompt.classList.toggle('hidden', !text);
    if (text) this.el.prompt.textContent = text;
  }

  /** Mensagem temporária no lugar do prompt. */
  toast(text, seconds = 2.5) {
    this._toastTimer = seconds;
    this._promptText = text;
    this.el.prompt.textContent = text;
    this.el.prompt.classList.remove('hidden');
  }

  setProgress(fraction, label) {
    if (fraction == null) { this.el.progress.classList.add('hidden'); return; }
    this.el.progress.classList.remove('hidden');
    this.el.progressBar.style.width = `${Math.round(fraction * 100)}%`;
    if (label) this.el.progressLabel.textContent = label;
  }

  openDialog(name, text) {
    this.el.dialogName.textContent = name;
    this.el.dialogText.textContent = text;
    this.el.dialog.classList.remove('hidden');
    this.dialogOpen = true;
  }
  closeDialog() {
    this.el.dialog.classList.add('hidden');
    this.dialogOpen = false;
  }

  update(dt) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) { this._promptText = null; this.el.prompt.classList.add('hidden'); }
    }
  }
}
