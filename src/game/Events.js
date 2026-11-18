/**
 * Events.js
 * Barramento de eventos do mundo (missões escutam): kill, sink, craft, visit, boss.
 */
const handlers = [];
export const events = {
  on(fn) { handlers.push(fn); },
  emit(type, data) { for (const h of handlers) h(type, data); },
};
