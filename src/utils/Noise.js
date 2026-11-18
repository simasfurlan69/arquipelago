/**
 * Noise.js
 * Perlin Noise 2D clássico (Ken Perlin, versão "improved") com seed,
 * além de fBm (fractal Brownian motion) e ruído "ridged" para cristas de montanha.
 * Tudo é determinístico: a mesma seed sempre gera o mesmo mundo.
 */

/** PRNG pequeno e rápido (mulberry32). Retorna uma função () => [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Perlin {
  constructor(seed = 1) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates com o PRNG
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  static lerp(a, b, t) { return a + t * (b - a); }
  static grad(hash, x, y) {
    // 8 direções de gradiente
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  /** Ruído 2D no intervalo aproximado [-1, 1]. */
  noise2D(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = Perlin.fade(x), v = Perlin.fade(y);
    const P = this.perm;
    const aa = P[P[X] + Y], ab = P[P[X] + Y + 1];
    const ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
    return Perlin.lerp(
      Perlin.lerp(Perlin.grad(aa, x, y), Perlin.grad(ba, x - 1, y), u),
      Perlin.lerp(Perlin.grad(ab, x, y - 1), Perlin.grad(bb, x - 1, y - 1), u),
      v
    );
  }

  /** fBm: soma de oitavas. Retorna aproximadamente [-1, 1]. */
  fbm(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2D(x * freq, y * freq);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ruído ridged [0, 1]: cristas agudas para cordilheiras. */
  ridged(x, y, octaves = 5) {
    let sum = 0, amp = 0.5, freq = 1, prev = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise2D(x * freq, y * freq));
      n *= n;
      sum += n * amp * prev;
      prev = n; amp *= 0.5; freq *= 2.0;
    }
    return Math.min(1, sum);
  }
}

// Helpers matemáticos usados em vários módulos
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
/** Amortecimento exponencial independente de framerate. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
/** Diferença angular mínima (-PI..PI). */
export const angleDelta = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const dampAngle = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
