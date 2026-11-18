/**
 * ShoreDistance.js
 * Mapa de distância até a terra firme mais próxima (transformada de distância
 * "chamfer" em grade de 8 m sobre o domínio do terreno). Usado por:
 *  - combate naval (bots só atacam longe das ilhas),
 *  - som das ondas (mais alto perto da costa).
 */
export class ShoreDistance {
  constructor(terrainData, cell = 8) {
    const { size, origin } = terrainData;
    const n = Math.ceil(size / cell);
    this.n = n; this.cell = cell; this.origin = origin;
    const INF = 1e9;
    const d = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = origin + (j + 0.5) * cell;
      for (let i = 0; i < n; i++) {
        const x = origin + (i + 0.5) * cell;
        d[j * n + i] = terrainData.heightAt(x, z) > 0.3 ? 0 : INF;
      }
    }
    // duas varreduras (8 vizinhos): distância aproximada em células
    const a = 1, b = Math.SQRT2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[k - n] + a);
        if (i > 0) v = Math.min(v, d[k - n - 1] + b);
        if (i < n - 1) v = Math.min(v, d[k - n + 1] + b);
      }
      d[k] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i; let v = d[k];
      if (i < n - 1) v = Math.min(v, d[k + 1] + a);
      if (j < n - 1) {
        v = Math.min(v, d[k + n] + a);
        if (i < n - 1) v = Math.min(v, d[k + n + 1] + b);
        if (i > 0) v = Math.min(v, d[k + n - 1] + b);
      }
      d[k] = v;
    }
    this.d = d;
  }

  /** Distância (m) de (x,z) até a terra firme mais próxima (0 em terra). */
  at(x, z) {
    const i = Math.floor((x - this.origin) / this.cell), j = Math.floor((z - this.origin) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) {
      // fora do domínio: mar aberto, distância até a borda + o valor da borda
      const ci = Math.max(0, Math.min(this.n - 1, i)), cj = Math.max(0, Math.min(this.n - 1, j));
      return this.d[cj * this.n + ci] * this.cell + Math.hypot(i - ci, j - cj) * this.cell;
    }
    return this.d[j * this.n + i] * this.cell;
  }
}
