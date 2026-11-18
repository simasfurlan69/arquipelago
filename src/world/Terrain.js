/**
 * Terrain.js
 * Gera o arquipélago:
 *  - ilha principal (spawn) com montanhas (ridged noise), colinas (fBm), praias,
 *    um platô plano para a vila, um canal de navegação que vem do mar aberto e
 *    rasga a ilha até um lago interno;
 *  - N ilhas secundárias com seed, espalhadas em anel ao redor.
 *
 * Cada ilha guarda um heightfield (Float32Array) igual aos vértices da malha.
 * getHeight(x,z) faz amostragem bilinear nesse cache: é O(1), não chama ruído,
 * e por isso a física, a fauna e a vegetação seguem exatamente o relevo visível.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { mulberry32, smoothstep, lerp, clamp } from '../utils/Noise.js';

const W = CONFIG.world;

export class Terrain {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../utils/Noise.js').Perlin} perlin
   */
  constructor(scene, perlin) {
    this.scene = scene;
    this.perlin = perlin;
    this.islands = [];
    this.meshes = [];

    // ---- Canal: spline Catmull-Rom amostrada em pontos uniformes ----
    const curve = new THREE.CatmullRomCurve3(W.canal.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    this.canalCurve = curve;
    this.canalPoints = curve.getSpacedPoints(220);           // do mar → interior
    this._canalBox = new THREE.Box2(
      new THREE.Vector2(Math.min(...W.canal.map((p) => p[0])) - 80, Math.min(...W.canal.map((p) => p[1])) - 80),
      new THREE.Vector2(Math.max(...W.canal.map((p) => p[0])) + 80, Math.max(...W.canal.map((p) => p[1])) + 80)
    );

    this.material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });

    this._defineIslands();
  }

  // ---------------------------------------------------------------------------
  // Definição das ilhas
  // ---------------------------------------------------------------------------
  _defineIslands() {
    const m = W.mainIsland;
    this.islands.push({
      main: true, cx: m.x, cz: m.z, radius: m.radius, size: m.size, segments: m.segments,
      seed: 0, mountain: 1, hills: 1,
    });

    const rand = mulberry32(CONFIG.seed * 7 + 3);
    let tries = 0;
    while (this.islands.length < W.secondaryIslands + 1 && tries++ < 500) {
      const ang = rand() * Math.PI * 2;
      const dist = lerp(W.islandRingMin, W.islandRingMax, rand());
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
      const radius = lerp(70, 210, rand());
      // Distância mínima entre ilhas e longe da boca do canal
      const ok = this.islands.every((o) => Math.hypot(o.cx - cx, o.cz - cz) > o.radius + radius + 220)
        && Math.hypot(cx - W.canal[0][0], cz - W.canal[0][1]) > radius + 300;
      if (!ok) continue;
      this.islands.push({
        main: false, cx, cz, radius,
        size: radius * 2.9, segments: Math.round(lerp(70, 130, radius / 210)),
        seed: this.islands.length * 101.7,
        mountain: rand() < 0.5 ? lerp(0.3, 0.9, rand()) : 0.05,   // algumas são atóis baixos
        hills: lerp(0.4, 1, rand()),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Função de altura analítica (só usada na geração)
  // ---------------------------------------------------------------------------
  _distToCanal(x, z) {
    if (!this._canalBox.containsPoint({ x, y: z })) return Infinity;
    const P = this.canalPoints;
    let best = Infinity;
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i].x, az = P[i].z, bx = P[i + 1].x, bz = P[i + 1].z;
      const vx = bx - ax, vz = bz - az;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      const dx = x - (ax + vx * t), dz = z - (az + vz * t);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  _islandHeight(isl, x, z) {
    const p = this.perlin;
    const dx = x - isl.cx, dz = z - isl.cz;
    const d = Math.hypot(dx, dz);

    // Linha costeira irregular: o raio é deformado por ruído
    const warp = p.fbm(x * 0.0045 + isl.seed, z * 0.0045 - isl.seed, 3) * 0.32;
    const nd = d / (isl.radius * (1 + warp));

    // Plataforma de praia: do fundo do mar até +1.5 m
    const beach = lerp(W.oceanFloor, 1.5, smoothstep(1.12, 0.8, nd));
    const landBlend = smoothstep(0.86, 0.56, nd);

    // Relevo interno
    let land = 2.5 + (p.fbm(x * 0.008 + isl.seed, z * 0.008, 5) * 0.5 + 0.5) * 9 * isl.hills;

    if (isl.main) {
      // Cordilheira a sudoeste da ilha principal
      const mDist = Math.hypot(x + 140, z + 115);
      const mMask = smoothstep(260, 60, mDist);
      land += mMask * (18 + p.ridged(x * 0.0055, z * 0.0055, 5) * 95);

      // Platô da vila (achatado)
      const vd = Math.hypot(x - W.village.x, z - W.village.z);
      const vMask = smoothstep(W.village.radius, W.village.radius * 0.6, vd);
      land = lerp(land, W.village.height + p.noise2D(x * 0.05, z * 0.05) * 0.25, vMask);
    } else {
      const mMask = smoothstep(0.75, 0.1, nd);
      land += mMask * isl.mountain * (10 + p.ridged(x * 0.009 + isl.seed, z * 0.009, 4) * 55);
    }

    let h = lerp(beach, Math.max(land, 1.5), landBlend);

    if (isl.main) {
      // ---- Canal: rebaixa o terreno ao longo da spline ----
      const dc = this._distToCanal(x, z);
      if (dc < Infinity) {
        const hw = W.canalHalfWidth;
        const carve = 1 - smoothstep(hw, hw * 2.7, dc);
        h = Math.min(h, lerp(h, W.canalDepth, carve));
      }
      // ---- Lago interno no fim do canal ----
      const L = W.lagoon;
      const dl = Math.hypot(x - L.x, z - L.z);
      const lagoonCarve = 1 - smoothstep(L.radius * 0.6, L.radius * 1.35, dl);
      h = Math.min(h, lerp(h, W.canalDepth + 1.5, lagoonCarve));
    }
    return h;
  }

  // ---------------------------------------------------------------------------
  // Construção das malhas (assíncrona para atualizar a barra de loading)
  // ---------------------------------------------------------------------------
  async build(onProgress = () => {}) {
    for (let i = 0; i < this.islands.length; i++) {
      this._buildIsland(this.islands[i]);
      onProgress((i + 1) / this.islands.length);
      await new Promise((r) => setTimeout(r, 0));
    }

    // Fundo do oceano: plano escuro que dá profundidade à água semitransparente
    const floorGeo = new THREE.PlaneGeometry(CONFIG.ocean.size * 1.2, CONFIG.ocean.size * 1.2);
    floorGeo.rotateX(-Math.PI / 2);
    this.seabed = new THREE.Mesh(floorGeo, new THREE.MeshStandardNodeMaterial({ color: 0x1b3a3f, roughness: 1 }));
    this.seabed.position.y = W.oceanFloor + 0.5;
    this.scene.add(this.seabed);
  }

  _buildIsland(isl) {
    const n = isl.segments;
    const size = isl.size;
    const step = size / n;
    const geo = new THREE.PlaneGeometry(size, size, n, n);
    geo.rotateX(-Math.PI / 2);     // linha i ↔ z crescente, coluna j ↔ x crescente

    const pos = geo.attributes.position;
    const heights = new Float32Array((n + 1) * (n + 1));
    const minX = isl.cx - size / 2, minZ = isl.cz - size / 2;

    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const idx = i * (n + 1) + j;
        const x = minX + j * step, z = minZ + i * step;
        const h = this._islandHeight(isl, x, z);
        heights[idx] = h;
        pos.setY(idx, h);
      }
    }
    geo.computeVertexNormals();

    // Cores por vértice: areia, grama, rocha, neve (altura + declive + ruído)
    const colors = new Float32Array(pos.count * 3);
    const nrm = geo.attributes.normal;
    const c = new THREE.Color();
    const sand = new THREE.Color(0xd8c48e), wetSand = new THREE.Color(0x9c8a5c);
    const grass = new THREE.Color(0x4f7a33), grass2 = new THREE.Color(0x6b8f3a), forest = new THREE.Color(0x2f5a26);
    const rock = new THREE.Color(0x6e665c), snow = new THREE.Color(0xf2f4f6), dirt = new THREE.Color(0x8a7350);
    for (let k = 0; k < pos.count; k++) {
      const h = pos.getY(k);
      const slope = 1 - nrm.getY(k);
      const x = pos.getX(k) + isl.cx, z = pos.getZ(k) + isl.cz;
      const nz = this.perlin.noise2D(x * 0.03, z * 0.03) * 0.5 + 0.5;

      if (h < -0.5) c.copy(wetSand).lerp(sand, clamp((h + 6) / 6, 0, 1) * 0.5);
      else if (h < 2.2) c.copy(sand);
      else {
        c.copy(grass).lerp(grass2, nz).lerp(forest, smoothstep(0.5, 0.9, this.perlin.noise2D(x * 0.008, z * 0.008) * 0.5 + 0.5));
        if (isl.main && Math.hypot(x - W.village.x, z - W.village.z) < W.village.radius * 0.7) c.lerp(dirt, 0.45 * nz);
      }
      if (h > 2 && slope > 0.28) c.lerp(rock, smoothstep(0.28, 0.5, slope));
      if (h > 55) c.lerp(rock, smoothstep(55, 70, h));
      if (h > 82) c.lerp(snow, smoothstep(82, 95, h) * (1 - smoothstep(0.35, 0.6, slope)));

      colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(isl.cx, 0, isl.cz);
    mesh.receiveShadow = true;
    mesh.castShadow = isl.main;     // montanhas da ilha principal projetam sombra
    mesh.matrixAutoUpdate = false;  // estático: matriz calculada uma única vez
    mesh.updateMatrix();
    this.scene.add(mesh);
    this.meshes.push(mesh);

    Object.assign(isl, { heights, minX, minZ, step, n });
  }

  // ---------------------------------------------------------------------------
  // Consultas em tempo de jogo
  // ---------------------------------------------------------------------------
  /** Altura do terreno (ou do fundo do mar) em (x,z): bilinear no cache. */
  getHeight(x, z) {
    for (let k = 0; k < this.islands.length; k++) {
      const isl = this.islands[k];
      const fx = (x - isl.minX) / isl.step, fz = (z - isl.minZ) / isl.step;
      if (fx < 0 || fz < 0 || fx >= isl.n || fz >= isl.n) continue;
      const j = Math.floor(fx), i = Math.floor(fz);
      const tx = fx - j, tz = fz - i;
      const r = isl.n + 1, H = isl.heights;
      const h00 = H[i * r + j], h10 = H[i * r + j + 1], h01 = H[(i + 1) * r + j], h11 = H[(i + 1) * r + j + 1];
      return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
    }
    return W.oceanFloor;
  }

  /** Declive aproximado (0 = plano, ~1 = 45°). */
  getSlope(x, z, e = 1.5) {
    const dx = this.getHeight(x + e, z) - this.getHeight(x - e, z);
    const dz = this.getHeight(x, z + e) - this.getHeight(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  /** Ponto do canal mais próximo de (x,z): { point, index, tangent }. */
  nearestCanalPoint(x, z) {
    let best = 0, bd = Infinity;
    this.canalPoints.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    const P = this.canalPoints;
    const a = P[Math.max(0, best - 1)], b = P[Math.min(P.length - 1, best + 1)];
    const tangent = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    return { point: P[best].clone(), index: best, tangent };
  }
}
