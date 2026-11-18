/**
 * TerrainDataAdapter.js
 * Converte o nosso arquipélago (src/world/Terrain.js) para o formato `TerrainData`
 * que os sistemas copiados do Tidewater esperam (TerrainGPU, computeShoreField,
 * ShoreWaves, ShoreSim, WakeSim).
 *
 * Formato (igual ao TerrainData.js do Tidewater @ fd6cae6):
 *   size     lado do domínio quadrado (m)
 *   res      amostras por lado
 *   texel    size / res
 *   origin   canto mínimo (x e z), escalar
 *   heights  Float32Array res², linha j = z, coluna i = x, amostra no centro do texel
 *   rock     Float32Array res² (0 areia/solo .. 1 rocha exposta)
 *   sand, path, gully, seagrass, rubble  Uint8Array res² (0..255)
 *   pads     plataformas achatadas (vila)
 *   heightAt(x, z) bilinear em CPU
 */
import { CONFIG } from '../config.js';

export function buildTerrainData(terrain, { size = 4608, res = 2048 } = {}) {
  const n = res * res;
  const texel = size / res;
  const origin = -size / 2;
  const heights = new Float32Array(n);
  const rock = new Float32Array(n);
  const sand = new Uint8Array(n);
  const path = new Uint8Array(n);
  const gully = new Uint8Array(n);
  const seagrass = new Uint8Array(n);
  const rubble = new Uint8Array(n);

  for (let j = 0; j < res; j++) {
    const z = origin + (j + 0.5) * texel;
    for (let i = 0; i < res; i++) {
      const x = origin + (i + 0.5) * texel;
      heights[j * res + i] = terrain.getHeight(x, z);
    }
  }

  // Máscaras derivadas da altura e do declive
  for (let j = 1; j < res - 1; j++) {
    for (let i = 1; i < res - 1; i++) {
      const k = j * res + i;
      const h = heights[k];
      const dx = (heights[k + 1] - heights[k - 1]) / (2 * texel);
      const dz = (heights[k + res] - heights[k - res]) / (2 * texel);
      const slope = Math.hypot(dx, dz);
      rock[k] = Math.min(1, Math.max(0, (slope - 0.45) / 0.5)) + (h > 55 ? Math.min(1, (h - 55) / 20) : 0);
      if (rock[k] > 1) rock[k] = 1;
      // praia e fundo arenoso raso
      if (h > -8 && h < 2.6 && slope < 0.4) sand[k] = 255 * Math.min(1, (2.6 - h) / 1.5) | 0;
      // pradarias marinhas e cascalho no fundo raso
      if (h < -1.5 && h > -12) seagrass[k] = ((Math.sin(i * 0.13) * Math.cos(j * 0.11) + 1) * 60) | 0;
      if (h < -10 && slope > 0.25) rubble[k] = 160;
    }
  }

  const V = CONFIG.world.village;
  const pads = [{ x: V.x, z: V.z, radius: V.radius * 0.55 }];

  // Pirâmide min/max por blocos de 16 texels (CDLOD do terreno usa para os volumes de culling)
  const tile = 16;
  let n0 = res / tile;
  const mn0 = new Float32Array(n0 * n0).fill(Infinity), mx0 = new Float32Array(n0 * n0).fill(-Infinity);
  for (let j = 0; j < res; j++) {
    const tj = (j / tile) | 0;
    for (let i = 0; i < res; i++) {
      const k = tj * n0 + ((i / tile) | 0), h = heights[j * res + i];
      if (h < mn0[k]) mn0[k] = h;
      if (h > mx0[k]) mx0[k] = h;
    }
  }
  const mmLevels = [{ n: n0, min: mn0, max: mx0 }];
  while (mmLevels[mmLevels.length - 1].n > 1) {
    const c = mmLevels[mmLevels.length - 1], n = c.n >> 1;
    const mn = new Float32Array(n * n), mx = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = (2 * j) * c.n + 2 * i, b = a + c.n;
      mn[j * n + i] = Math.min(c.min[a], c.min[a + 1], c.min[b], c.min[b + 1]);
      mx[j * n + i] = Math.max(c.max[a], c.max[a + 1], c.max[b], c.max[b + 1]);
    }
    mmLevels.push({ n, min: mn, max: mx });
  }

  return {
    size, res, texel, origin, heights, rock, sand, path, gully, seagrass, rubble, pads, mmTile: tile, mmLevels,
    /** [minY, maxY] do terreno dentro da caixa (mesma lógica do TerrainData do Tidewater). */
    boundsFor(x0, z0, x1, z1) {
      const span = Math.max(x1 - x0, z1 - z0) / (texel * tile);
      const l = Math.max(0, Math.min(mmLevels.length - 1, Math.ceil(Math.log2(Math.max(1, span / 2)))));
      const L = mmLevels[l];
      const ts = texel * tile * (1 << l);
      const i0 = Math.floor((x0 - origin) / ts), i1 = Math.floor((x1 - origin) / ts);
      const j0 = Math.floor((z0 - origin) / ts), j1 = Math.floor((z1 - origin) / ts);
      let mn = Infinity, mx = -Infinity, outside = false;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (i < 0 || j < 0 || i >= L.n || j >= L.n) { outside = true; continue; }
        const k = j * L.n + i;
        if (L.min[k] < mn) mn = L.min[k];
        if (L.max[k] > mx) mx = L.max[k];
      }
      if (outside) { mn = Math.min(mn, CONFIG.world.oceanFloor); mx = Math.max(mx, CONFIG.world.oceanFloor); }
      return [mn - 1, mx + 2];
    },
    heightAt(x, z) {
      const fx = (x - origin) / texel - 0.5, fz = (z - origin) / texel - 0.5;
      if (fx < 0 || fz < 0 || fx >= res - 1 || fz >= res - 1) return CONFIG.world.oceanFloor;
      const i = Math.floor(fx), j = Math.floor(fz);
      const tx = fx - i, tz = fz - j;
      const k = j * res + i;
      const a = heights[k], b = heights[k + 1], c = heights[k + res], d = heights[k + res + 1];
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    },
  };
}
