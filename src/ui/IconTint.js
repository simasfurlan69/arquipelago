/**
 * IconTint.js
 * Gera os ícones coloridos a partir dos PNGs base (silhueta branca em fundo
 * transparente): pinta a silhueta com a cor do item/tier, adiciona um leve
 * degradê e contorno escuro para leitura, e guarda o resultado (dataURL) em cache.
 *   Pedra  → cinza-fosco (dessaturado)   Ouro → #FFD700   Metal → #B0C4DE
 */
import { ITEMS } from '../game/Items.js';

const cache = new Map();
const imgs = new Map();
const SIZE = 96;

function loadImg(name) {
  if (!imgs.has(name)) {
    imgs.set(name, new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = `./assets/icons/${name}.png`;
    }));
  }
  return imgs.get(name);
}

/**
 * Os PNGs são silhueta branca em fundo PRETO opaco: converte o brilho em
 * transparência (máscara), para a cor do tier pintar só o desenho.
 */
async function maskOf(name) {
  const im = await loadImg(name);
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const lum = Math.max(p[i], p[i + 1], p[i + 2]);
    p[i + 3] = Math.round((p[i + 3] / 255) * lum);   // preto → transparente
    p[i] = p[i + 1] = p[i + 2] = 255;
  }
  g.putImageData(d, 0, 0);
  return c;
}
const masks = new Map();

async function render(def) {
  if (!masks.has(def.icon)) masks.set(def.icon, maskOf(def.icon));
  const im = await masks.get(def.icon);
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  const pad = 8, s = SIZE - pad * 2;
  // contorno escuro (silhueta deslocada em 8 direções)
  const sil = document.createElement('canvas'); sil.width = sil.height = SIZE;
  const sg = sil.getContext('2d');
  sg.drawImage(im, pad, pad, s, s);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#000'; sg.fillRect(0, 0, SIZE, SIZE);
  g.globalAlpha = 0.75;
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1.5, -1.5], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5]]) g.drawImage(sil, dx, dy);
  g.globalAlpha = 1;
  // silhueta colorida com degradê (luz em cima, sombra embaixo)
  const col = document.createElement('canvas'); col.width = col.height = SIZE;
  const cg = col.getContext('2d');
  cg.drawImage(im, pad, pad, s, s);
  cg.globalCompositeOperation = 'source-in';
  const grad = cg.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, shade(def.tint, 1.35));
  grad.addColorStop(0.5, def.tint);
  grad.addColorStop(1, shade(def.tint, def.tier === 1 ? 0.6 : 0.7));
  cg.fillStyle = grad; cg.fillRect(0, 0, SIZE, SIZE);
  g.drawImage(col, 0, 0);
  return c.toDataURL();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** Pré-gera todos os ícones (chamado no carregamento). */
export async function preloadIcons() {
  await Promise.all(Object.values(ITEMS).filter((d) => d.icon).map(async (d) => {
    try { cache.set(d.id, await render(d)); } catch { /* sem PNG: usa emoji */ }
  }));
}

/**
 * Preenche um elemento com o ícone do item (img colorida ou emoji de reserva).
 * @param {HTMLElement} el
 */
export function setIcon(el, id) {
  const url = id && cache.get(id);
  if (!id) { el.innerHTML = ''; el.dataset.id = ''; return; }
  if (el.dataset.id === id) return;
  el.dataset.id = id;
  el.innerHTML = url ? `<img src="${url}" draggable="false" alt="">` : (ITEMS[id]?.emoji || '❔');
}

export const iconURL = (id) => cache.get(id) || null;
