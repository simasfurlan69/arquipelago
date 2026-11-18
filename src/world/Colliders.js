/**
 * Colliders.js
 * Colisão 2D simplificada (plano XZ), suficiente para um jogo de exploração:
 *  - círculos estáticos (troncos, paredes, bigorna) num spatial hash;
 *  - plataformas caminháveis retangulares orientadas (cais, decks), que
 *    sobrescrevem a altura do chão.
 */
export class Colliders {
  constructor(cellSize = 12) {
    this.cell = cellSize;
    this.grid = new Map();
    this.platforms = [];
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  /** Adiciona um círculo de colisão. */
  addCircle(x, z, r, h = Infinity) {
    const c = { x, z, r, h };   // h = altura acima do chão (a câmera passa por cima de objetos baixos)
    const minX = Math.floor((x - r) / this.cell), maxX = Math.floor((x + r) / this.cell);
    const minZ = Math.floor((z - r) / this.cell), maxZ = Math.floor((z + r) / this.cell);
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const k = this._key(ix, iz);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(c);
      }
    }
    return c;
  }

  /** Remove um círculo criado por addCircle (ex.: árvore cortada). */
  removeCircle(c) {
    const minX = Math.floor((c.x - c.r) / this.cell), maxX = Math.floor((c.x + c.r) / this.cell);
    const minZ = Math.floor((c.z - c.r) / this.cell), maxZ = Math.floor((c.z + c.r) / this.cell);
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const list = this.grid.get(this._key(ix, iz));
        if (!list) continue;
        const i = list.indexOf(c);
        if (i >= 0) list.splice(i, 1);
      }
    }
  }

  /** Retângulo (parede de construção) aproximado por uma fileira de círculos. */
  addBox(cx, cz, w, d, angle = 0, h = Infinity) {
    const r = Math.min(w, d) / 2;
    const long = Math.max(w, d);
    const n = Math.max(1, Math.ceil(long / (r * 1.5)));
    const along = w >= d ? 0 : Math.PI / 2;
    const ax = Math.cos(angle + along), az = -Math.sin(angle + along);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      this.addCircle(cx + ax * t * long, cz + az * t * long, r, h);
    }
  }

  /**
   * Plataforma caminhável (cais). Orientação por `angle` em torno de Y.
   * @param {number} top altura da superfície
   */
  addPlatform(cx, cz, halfW, halfL, angle, top) {
    this.platforms.push({ cx, cz, halfW, halfL, cos: Math.cos(angle), sin: Math.sin(angle), top });
  }

  /** Altura de plataforma em (x,z), ou -Infinity. */
  platformHeight(x, z) {
    let h = -Infinity;
    for (const p of this.platforms) {
      const dx = x - p.cx, dz = z - p.cz;
      // rotação inversa para o espaço local
      const lx = dx * p.cos - dz * p.sin;
      const lz = dx * p.sin + dz * p.cos;
      if (Math.abs(lx) <= p.halfW && Math.abs(lz) <= p.halfL) h = Math.max(h, p.top);
    }
    return h;
  }

  /**
   * Resolve a colisão de um círculo móvel (raio r) e altera `pos` (Vector3) in-place.
   * @returns {boolean} true se houve contato
   */
  resolve(pos, r) {
    const ix = Math.floor(pos.x / this.cell), iz = Math.floor(pos.z / this.cell);
    let hit = false;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = this.grid.get(this._key(ix + ox, iz + oz));
        if (!list) continue;
        for (const c of list) {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const min = c.r + r;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            pos.x = c.x + (dx / d) * min;
            pos.z = c.z + (dz / d) * min;
            hit = true;
          }
        }
      }
    }
    return hit;
  }

  /** Consulta rápida: o ponto está livre de colisores? */
  isFree(x, z, r) {
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = this.grid.get(this._key(ix + ox, iz + oz));
        if (!list) continue;
        for (const c of list) {
          const dx = x - c.x, dz = z - c.z;
          if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return false;
        }
      }
    }
    return true;
  }

  /**
   * Primeiro contato de um segmento 3D a→b com os círculos (cilindros verticais
   * de altura c.h acima do chão). A câmera usa isto para não entrar em paredes,
   * troncos e construções.
   * @param {(x:number,z:number)=>number} groundAt altura do chão
   * @returns {number} fração 0..1 do segmento que está livre
   */
  segmentHit(a, b, pad, groundAt) {
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    const A = dx * dx + dz * dz;
    let best = 1;
    if (A < 1e-8) return best;
    const minX = Math.floor((Math.min(a.x, b.x) - 4) / this.cell), maxX = Math.floor((Math.max(a.x, b.x) + 4) / this.cell);
    const minZ = Math.floor((Math.min(a.z, b.z) - 4) / this.cell), maxZ = Math.floor((Math.max(a.z, b.z) + 4) / this.cell);
    const seen = new Set();
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const list = this.grid.get(this._key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (seen.has(c)) continue; seen.add(c);
          const R = c.r + pad;
          const fx = a.x - c.x, fz = a.z - c.z;
          const C = fx * fx + fz * fz - R * R;
          if (C < 0) continue;                                  // jogador encostado no objeto: ignora
          const B = 2 * (fx * dx + fz * dz);
          const disc = B * B - 4 * A * C;
          if (disc < 0) continue;
          const t = (-B - Math.sqrt(disc)) / (2 * A);
          if (t < 0 || t >= best) continue;
          if (c.h !== Infinity) {
            const top = (groundAt ? groundAt(c.x, c.z) : 0) + c.h;
            if (a.y + dy * t > top + pad) continue;           // passa por cima
          }
          best = t;
        }
      }
    }
    return best;
  }
}
