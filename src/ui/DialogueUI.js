/**
 * DialogueUI.js
 * Janela de conversa ramificada: retrato, nome, texto com efeito de digitação
 * (clique ou Espaço completa) e opções (clique ou teclas 1–9).
 *
 * Uma árvore é um objeto { start, nodes: { id: { text, options } } } onde:
 *   text     string | string[] (várias falas em sequência) | (ctx) => string
 *   options  [{ label, next?, action?(ctx) → nextId|undefined, if?(ctx) }] | (ctx) => options
 * next '__end' fecha a conversa.
 */
export class DialogueUI {
  constructor({ input, sfx }) {
    this.input = input;
    this.sfx = sfx;
    this.el = document.createElement('div');
    this.el.id = 'talk';
    this.el.className = 'hidden';
    this.el.innerHTML = `<div class="talk-box"><div class="talk-face"></div><div class="talk-body">
      <div class="talk-head"><span class="talk-name"></span><span class="talk-rep"></span></div>
      <div class="talk-text"></div><div class="talk-opts"></div></div></div>`;
    document.getElementById('hud').appendChild(this.el);
    this.$ = (s) => this.el.querySelector(s);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) this.choose(+b.dataset.i);
      else if (this.typing) this._finishTyping();
      else if (this.pages && this.page < this.pages.length - 1) this._nextPage();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (/^Digit[1-9]$/.test(e.code)) { const i = +e.code.slice(5) - 1; if (!this.typing && this.opts[i]) { e.preventDefault(); this.choose(i); } }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (this.typing) this._finishTyping(); else if (this.page < this.pages.length - 1) this._nextPage(); }
      if (e.code === 'Escape') this.close();
    });
  }

  /**
   * @param {object} tree   árvore de diálogo
   * @param {object} ctx    contexto passado às funções (jogo, missões…)
   * @param {object} who    { name, face, color, rep() }
   */
  start(tree, ctx, who) {
    this.tree = tree; this.ctx = ctx; this.who = who;
    this.open = true;
    this.input.uiOpen = true;
    this.input.releasePointer();
    this.el.classList.remove('hidden');
    this.$('.talk-name').textContent = who.name;
    this.$('.talk-face').textContent = who.face;
    this.$('.talk-face').style.background = who.color;
    this.go(typeof tree.start === 'function' ? tree.start(ctx) : tree.start);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.closedAt = performance.now();
    this.el.classList.add('hidden');
    this.input.uiOpen = false;
    clearInterval(this._ti);
    this.onClose?.();
  }

  go(id) {
    if (!id || id === '__end') { this.close(); return; }
    const n = this.tree.nodes[id];
    if (!n) { console.warn('nó de diálogo inexistente', id); this.close(); return; }
    this.node = n; this.nodeId = id;
    const t = typeof n.text === 'function' ? n.text(this.ctx) : n.text;
    this.pages = Array.isArray(t) ? t : [t];
    this.page = 0;
    this.$('.talk-rep').textContent = this.who.rep ? this.who.rep() : '';
    this._type(this.pages[0]);
  }

  _nextPage() { this.page++; this._type(this.pages[this.page]); this.sfx?.click(); }

  _type(text) {
    clearInterval(this._ti);
    const el = this.$('.talk-text');
    this.full = text; el.textContent = '';
    this.typing = true;
    this._renderOpts(true);
    let i = 0;
    this._ti = setInterval(() => {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) this._finishTyping();
    }, 16);
  }

  _finishTyping() {
    clearInterval(this._ti);
    this.typing = false;
    this.$('.talk-text').textContent = this.full;
    this._renderOpts(false);
  }

  _renderOpts(hide) {
    const box = this.$('.talk-opts');
    if (hide) { box.innerHTML = ''; return; }
    if (this.page < this.pages.length - 1) { box.innerHTML = '<div class="talk-more">▼ continuar (clique / Espaço)</div>'; this.opts = []; return; }
    const raw = typeof this.node.options === 'function' ? this.node.options(this.ctx) : this.node.options || [];
    this.opts = raw.filter((o) => !o.if || o.if(this.ctx));
    if (!this.opts.length) this.opts = [{ label: 'Até logo.', next: '__end' }];
    box.innerHTML = this.opts.map((o, i) => `<button data-i="${i}" class="${o.style || ''}"><span class="k">${i + 1}</span> ${o.label}</button>`).join('');
  }

  choose(i) {
    const o = this.opts[i]; if (!o) return;
    this.sfx?.click();
    let next = o.next;
    if (o.action) { const r = o.action(this.ctx); if (r) next = r; }
    if (!this.open) return;
    this.go(next || this.nodeId);
  }
}
