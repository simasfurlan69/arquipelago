/**
 * QuestLog.js
 * Diário de missões (tecla J) e lista curta de missões ativas no painel da história.
 */
import { QUESTS, REP_LEVELS, repLevel } from '../game/Quests.js';

export class QuestLog {
  constructor({ quests, input }) {
    this.q = quests; this.input = input;
    this.el = document.createElement('div');
    this.el.id = 'journal';
    this.el.className = 'hidden';
    document.getElementById('hud').appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) this.toggle(false); });
    // lista curta no painel de missão
    document.getElementById('quest')?.insertAdjacentHTML('beforeend', '<div id="quest-side"></div>');
    this.side = document.getElementById('quest-side');
    quests.onChange(() => this.refresh());
    this.refresh();
  }

  refresh() {
    const act = this.q.active().filter((q) => !q.auto).slice(0, 3);
    if (this.side) this.side.innerHTML = act.map((q) => `<div class="qs ${this.q.isReady(q) ? 'ok' : ''}">${this.q.isReady(q) ? '✔' : '•'} ${q.title}<small>${this.q.objText(q)}</small></div>`).join('');
    if (this.open) this.render();
  }

  toggle(force) {
    this.open = force ?? !this.open;
    if (!this.open) this.closedAt = performance.now();
    this.el.classList.toggle('hidden', !this.open);
    this.input.uiOpen = this.open;
    if (this.open) { this.input.releasePointer(); this.render(); }
  }

  render() {
    const who = { bruno: '⚒ Bruno, o Ferreiro', helena: '📜 Guilda dos Navegantes' };
    const sec = (title, list, done = false) => `<h3>${title}</h3>` + (list.length ? list.map((q) => `
      <div class="jq ${done ? 'done' : this.q.isReady(q) ? 'ok' : ''}"><b>${q.title}</b> <span class="giver">${who[q.giver]}</span>
      <p>${q.desc}</p>${done ? '' : `<div class="obj">${this.q.objText(q)}</div>`}<div class="rw">Recompensa: ${this.q.rewardText(q)}</div></div>`).join('') : '<p class="tip">Nenhuma.</p>');
    const active = this.q.active().filter((q) => !q.auto);
    const done = QUESTS.filter((q) => this.q.st(q.id).status === 'done');
    const rep = (k) => { const lv = repLevel(this.q.rep[k]); return `${REP_LEVELS[lv].name} (${this.q.rep[k]})`; };
    this.el.innerHTML = `<div class="j-panel"><div class="j-head"><h2>📖 Diário</h2><button data-close="1">✕</button></div>
      <div class="j-rep">Reputação — Bruno: <b>${rep('bruno')}</b> · Guilda: <b>${rep('helena')}</b>${this.q.titles.length ? ` · Títulos: ${this.q.titles.join(', ')}` : ''}</div>
      ${sec('Em andamento', active)}${sec('Concluídas', done, true)}
      <p class="tip">Fale com Bruno (forja) e com o Mestre Heitor (Salão da Guilda) para novos trabalhos. J fecha.</p></div>`;
  }
}
