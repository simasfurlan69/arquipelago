/**
 * Vegetation.js
 * Vegetação densa e recursos minerais com InstancedMesh (uma draw call por tipo):
 *  - pinheiros (tronco alto com casca PBR + 6 camadas de galhos franjados);
 *  - árvores folhosas (tronco com raízes e galhos + copa de 7 massas de folhas);
 *  - vento em TSL igual no tronco e na copa: o tronco inteiro verga, a copa
 *    balança junto e as folhas tremulam; as rajadas atravessam a floresta em onda
 *    (fase pela posição no mundo) e ficam mais fortes com G.windSpeed (tempestade);
 *  - arbustos (decorativos), pedras e veios de minério (carvão, ferro, ouro).
 *
 * Cada árvore, pedra e veio vira um registro em `this.resources`, com as
 * instâncias que o compõem. O sistema Harvest usa esses registros para dar
 * dano, derrubar, esconder e fazer rebrotar cada recurso.
 */
import * as THREE from 'three/webgpu';
import { color, mix, smoothstep, mx_noise_float, positionLocal, positionWorld, vec2, vec3, float, sin, cos, Fn, attribute, texture, uv, normalMap, length, mx_noise_vec3, normalView, transformNormalToView } from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from '../vendor/tidewater/core/Globals.js';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../utils/Noise.js';

const W = CONFIG.world;
const RC = CONFIG.resources;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qt = new THREE.Quaternion();
const _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _axis = new THREE.Vector3();

export class Vegetation {
  constructor(scene, terrain, colliders) {
    this.scene = scene;
    this.terrain = terrain;
    this.colliders = colliders;
    this.rand = mulberry32(CONFIG.seed + 42);
    this.resources = [];
  }

  build() {
    const pines = [], broad = [], bushes = [], rocks = [];
    const ores = { coal: [], iron: [], gold: [] };
    const R = this.rand;
    const t = this.terrain;

    for (const isl of t.islands) {
      const area = isl.radius * isl.radius;
      const nTrees = Math.round(area * (isl.main ? 0.014 : isl.wet ? 0.013 : 0.008));
      const scaleOre = isl.main ? 1 : 0.25 * (isl.radius / 150);

      const sample = (count, accept, out) => {
        let made = 0, tries = 0;
        while (made < count && tries++ < count * 8) {
          const a = R() * Math.PI * 2, r = Math.sqrt(R()) * isl.radius * 1.1;
          const x = isl.cx + Math.cos(a) * r, z = isl.cz + Math.sin(a) * r;
          const h = t.getHeight(x, z);
          const s = t.getSlope(x, z);
          if (!accept(h, s, x, z)) continue;
          if (isl.main && Math.hypot(x - W.village.x, z - W.village.z) < W.village.radius * 0.75) continue;
          out.push({ x, y: h, z, s: 0.7 + R() * 0.7, rot: R() * Math.PI * 2 });
          made++;
        }
      };

      if (isl.wet) {
        // Ilha das Chuvas: mata fechada de coníferas escuras até perto da praia
        sample(nTrees * 0.8, (h, s) => h > 2.6 && h < 90 && s < 0.75, pines);
        sample(nTrees * 0.2, (h, s) => h > 2.4 && h < 30 && s < 0.45, broad);
      } else {
        sample(nTrees * 0.45, (h, s) => h > 18 && h < 75 && s < 0.65, pines);
        sample(nTrees * 0.55, (h, s) => h > 2.4 && h < 30 && s < 0.45, broad);
      }
      sample(Math.round(nTrees * 0.8), (h, s) => h > 1.8 && h < 50 && s < 0.6, bushes);
      sample(Math.round(nTrees * 0.25), (h, s) => h > 0.5 && s < 1.2, rocks);
      // Minérios: encostas e montanhas (ouro só no alto)
      sample(Math.round(RC.ores.coal * scaleOre), (h, s) => h > 6 && h < 70 && s < 1.3, ores.coal);
      sample(Math.round(RC.ores.iron * scaleOre), (h, s) => h > 14 && h < 80 && s < 1.3, ores.iron);
      sample(Math.round(RC.ores.gold * scaleOre), (h, s) => h > 30 && s < 1.4, ores.gold);
    }

    // ---- Geometrias e materiais (procedurais, com vento em TSL) ----
    const broadBark = barkMaterial('bark_brown_02', 0xb8a890, 5.2);
    const pineBark = barkMaterial('pine_bark', 0xa89a88, 12.5);
    const pineMat = foliageMaterial(0x1c3a22, 0x3f6b36, 0.55, 1.0, [3, 12.5, 3.0]);
    const leafMat = foliageMaterial(0x2c5420, 0x7aa443, 1.0, 1.0, [3.2, 8.4, 3.0]);
    const bushMat = foliageMaterial(0x2a4f20, 0x5d8a36, 0.5, 0.7, [0, 1.6, 1.0]);
    const rockMat = rockMaterial(0x7a746a);

    const broadTrunkGeo = broadTrunk(R);
    const pineTrunkGeo = pineTrunk(R);
    const pineGeo = pineCrown(R, 0);
    const pineGeo2 = pineCrown(R, 1);
    const leafGeo = leafyCrown(R, 5.6, 2.9, 7);
    const bushGeo = leafyCrown(R, 0.6, 1.0, 3);
    const rockGeo = lumpyRock(R);

    const trees = [...pines, ...broad];
    // tronco e copa da mesma árvore têm o mesmo atributo de vento → balançam juntos, nada se descola
    const pineTrunkMesh = this._instanced(pineTrunkGeo, pineBark, pines, true);
    const broadTrunkMesh = this._instanced(broadTrunkGeo, broadBark, broad, true);
    const pineMesh1 = this._instanced(pineGeo, pineMat, pines, true, 0.14);
    const pineMesh2 = this._instanced(pineGeo2, pineMat, pines, true, 0.14);
    const leafMesh = this._instanced(leafGeo, leafMat, broad, true, 0.2);
    const bushMesh = this._instanced(bushGeo, bushMat, bushes, false, 0.2);   // arbustos sem sombra projetada (custo alto, pouco ganho visual)
    const rockMesh = this._instanced(rockGeo, rockMat, rocks, true, 0.1);

    // Minérios: pedra com pontos coloridos (ruído TSL)
    const oreMat = (hex, emissive = 0x000000) => {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0.2, flatShading: true, emissive });
      const n = mx_noise_float(positionLocal.mul(3.2)).mul(0.5).add(0.5);
      m.colorNode = mix(color(0x6e685f), color(hex), smoothstep(0.58, 0.68, n));
      return m;
    };
    const oreMeshes = {
      coal: this._instanced(rockGeo, oreMat(0x101012), ores.coal, false),
      iron: this._instanced(rockGeo, oreMat(0xc0703a), ores.iron, false),
      gold: this._instanced(rockGeo, oreMat(0xffd040, 0x221800), ores.gold, false),
    };

    // ---- Registros de recursos ----
    const reg = (type, kind, it, parts, hp, colR) => {
      const res = {
        type, kind, x: it.x, y: it.y, z: it.z, s: it.s, rot: it.rot, parts,
        hp, maxHp: hp, state: 'alive', timer: 0, anim: 0, shake: 0,
        radius: colR,
        collider: this.colliders.addCircle(it.x, it.z, colR),
      };
      this.resources.push(res);
    };
    pines.forEach((it, i) => reg('tree', 'pine', it,
      [pineTrunkMesh.ref(i), pineMesh1.ref(i), pineMesh2.ref(i)], RC.treeHealth, 0.45 * it.s));
    broad.forEach((it, i) => reg('tree', 'broad', it,
      [broadTrunkMesh.ref(i), leafMesh.ref(i)], RC.treeHealth, 0.45 * it.s));
    rocks.forEach((it, i) => reg('rock', 'stone', it, [rockMesh.ref(i)], RC.rockHealth, 1.1 * it.s));
    // arbustos colhíveis: uva, tomate, cenoura, milho (rebrotam)
    bushes.forEach((it, i) => reg('bush', 'bush', it, [bushMesh.ref(i)], 1, 0.5 * it.s));
    for (const k of ['coal', 'iron', 'gold']) {
      ores[k].forEach((it, i) => reg('ore', k, it, [oreMeshes[k].ref(i)], RC.oreHealth, 1.1 * it.s));
    }

    this._buildCrownGrid();
    this.counts = { trees: trees.length, bushes: bushes.length, rocks: rocks.length, ores: ores.coal.length + ores.iron.length + ores.gold.length };
  }

  /** Grade espacial das copas (esferas aproximadas) para a câmera. */
  _buildCrownGrid() {
    this._crownCell = 16;
    this._crowns = new Map();
    for (const r of this.resources) {
      if (r.type !== 'tree') continue;
      const s = r.s, b = r.y - 0.2;
      r.crowns = r.kind === 'pine'
        ? [[b + 4.6 * s, 2.7 * s], [b + 7.6 * s, 2.1 * s], [b + 10.6 * s, 1.4 * s]]
        : [[b + 5.8 * s, 3.0 * s], [b + 7.4 * s, 2.0 * s]];
      const k = `${Math.floor(r.x / this._crownCell)},${Math.floor(r.z / this._crownCell)}`;
      if (!this._crowns.has(k)) this._crowns.set(k, []);
      this._crowns.get(k).push(r);
    }
  }

  /**
   * Distância até a primeira copa no raio que sai de `o` na direção `dir` (normalizada).
   * @returns {number} distância (ou `max` se não bater)
   */
  crownHit(o, dir, max, pad = 0.3) {
    if (!this._crowns) return max;
    const C = this._crownCell;
    const ex = o.x + dir.x * max, ez = o.z + dir.z * max;
    const x0 = Math.floor((Math.min(o.x, ex) - 5) / C), x1 = Math.floor((Math.max(o.x, ex) + 5) / C);
    const z0 = Math.floor((Math.min(o.z, ez) - 5) / C), z1 = Math.floor((Math.max(o.z, ez) + 5) / C);
    let best = max;
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const list = this._crowns.get(`${ix},${iz}`);
      if (!list) continue;
      for (const r of list) {
        if (r.state !== 'alive') continue;
        for (const [cy, rad] of r.crowns) {
          const R = rad * 0.85 + pad;
          const fx = o.x - r.x, fy = o.y - cy, fz = o.z - r.z;
          const c = fx * fx + fy * fy + fz * fz - R * R;
          if (c < 0) continue;                       // o jogador já está dentro (ex.: subindo o morro)
          const b = fx * dir.x + fy * dir.y + fz * dir.z;
          const disc = b * b - c;
          if (disc < 0) continue;
          const t = -b - Math.sqrt(disc);
          if (t > 0 && t < best) best = t;
        }
      }
    }
    return best;
  }

  /**
   * Reescreve as matrizes de um recurso.
   * @param {object} res registro
   * @param {number} scale fator de escala (0 = escondido)
   * @param {number} tilt ângulo de tombamento (rad)
   * @param {number} tiltDir direção da queda (rad em Y)
   * @param {number} shake deslocamento lateral de "tremida" (m)
   */
  writeResource(res, scale = 1, tilt = 0, tiltDir = 0, shake = 0) {
    _q.setFromAxisAngle(_up, res.rot);
    if (tilt) {
      _axis.set(Math.cos(tiltDir), 0, -Math.sin(tiltDir));      // perpendicular à direção da queda
      _qt.setFromAxisAngle(_axis, tilt);
      _q.premultiply(_qt);
    }
    _p.set(res.x + shake * Math.cos(res.anim * 60), res.y - 0.2, res.z);
    _s.setScalar(res.s * scale);
    _m.compose(_p, _q, _s);
    for (const part of res.parts) {
      part.mesh.setMatrixAt(part.i, _m);
      part.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Cria um InstancedMesh a partir de uma lista de transformações. */
  /**
   * Cria InstancedMeshes divididos em blocos de CHUNK metros (um por região).
   * Cada bloco tem sua bounding sphere, então a câmera e as cascatas de sombra
   * descartam o que está fora de vista, e update() esconde os blocos distantes.
   * Retorna { ref(i) → {mesh, i} } para o sistema de coleta (Harvest).
   */
  _instanced(geo, mat, list, shadows, colorJitter = 0) {
    const CHUNK = 400;
    const cells = new Map();
    list.forEach((it, idx) => {
      const k = `${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(idx);
    });
    const refs = new Array(list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    for (const idxs of cells.values()) {
      // geometria rasa por bloco (compartilha os buffers) + atributo por instância do vento:
      // (cos rot, sin rot, fase) → o vento sopra na mesma direção do mundo em todas as árvores
      const g = new THREE.BufferGeometry();
      g.setIndex(geo.index);
      for (const [k, v] of Object.entries(geo.attributes)) g.setAttribute(k, v);
      const aw = new Float32Array(idxs.length * 3);
      idxs.forEach((idx, i) => {
        const it = list[idx];
        aw[i * 3] = Math.cos(it.rot); aw[i * 3 + 1] = Math.sin(it.rot);
        aw[i * 3 + 2] = it.x * 0.045 + it.z * 0.06 + Math.sin(it.x * 12.9898 + it.z * 78.233) * 0.5;
      });
      g.setAttribute('aWind', new THREE.InstancedBufferAttribute(aw, 3));
      const mesh = new THREE.InstancedMesh(g, mat, idxs.length);
      idxs.forEach((idx, i) => {
        const it = list[idx];
        q.setFromAxisAngle(_up, it.rot);
        p.set(it.x, it.y - 0.2, it.z);
        s.setScalar(it.s);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        if (colorJitter) {
          const j = 1 + (this.rand() - 0.5) * 2 * colorJitter;
          c.setRGB(j, j * (1 + (this.rand() - 0.5) * colorJitter), j);
          mesh.setColorAt(i, c);
        }
        refs[idx] = { mesh, i };
      });
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 15;      // folga para o balanço e as copas
      mesh.frustumCulled = true;
      mesh.userData.casts = shadows;
      this.scene.add(mesh);
      (this.chunks || (this.chunks = [])).push(mesh);
    }
    return { ref: (i) => refs[i] };
  }

  /**
   * LOD por distância: esconde os blocos além de VIEW m só com `visible`.
   * (Trocar castShadow em tempo de execução recompila pipelines no WebGPU e
   * causava picos; a sombra fica fixa por tipo de objeto.)
   */
  update(camPos, frame = 0) {
    if (!this.chunks || frame % 15) return;
    const VIEW = this.viewDistance || 1000;
    for (const mesh of this.chunks) {
      const v = mesh.boundingSphere.center.distanceTo(camPos) - mesh.boundingSphere.radius < VIEW;
      if (mesh.visible !== v) mesh.visible = v;
    }
  }
}

// =============================================================================
// Geometrias e materiais procedurais
// =============================================================================
/** Desloca os vértices de uma geometria por ruído (formas orgânicas, sem facetas regulares). */
function jitter(geo, R, amount) {
  // solda os vértices repetidos: o ruído desloca a malha inteira e as normais ficam suaves
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-3);
  const p = geo.attributes.position;
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = cache.get(k);
    if (!d) { d = [(R() - 0.5) * amount, (R() - 0.5) * amount, (R() - 0.5) * amount]; cache.set(k, d); }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

function taperedTrunk(h, r0, r1, R, radial = 8, segs = 6) {
  const g = new THREE.CylinderGeometry(r0, r1, h, radial, segs);
  const p = g.attributes.position;
  const ph = R() * 6;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h + 0.5;
    const bend = Math.sin(y * 2.4 + ph) * 0.1 * y;               // leve curvatura (base reta)
    p.setX(i, p.getX(i) + bend);
    p.setZ(i, p.getZ(i) + Math.cos(y * 1.7 + ph) * 0.06 * y);
    if (y < 0.1) { const k = 1 + (0.1 - y) * 5; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }   // colo alargado
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

/** Galho/raiz: cilindro afinando, inclinado `tilt` para fora na direção `yaw`. */
function limb(len, r0, r1, x, y, z, yaw, tilt) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1);
  g.translate(0, len / 2, 0);
  g.rotateZ(-tilt);
  g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/** Folhosa: tronco + 5 galhos que entram na copa + 4 raízes expostas. */
function broadTrunk(R) {
  const parts = [taperedTrunk(5.2, 0.15, 0.36, R)];
  const nB = 5;
  for (let i = 0; i < nB; i++) {
    const yaw = (i / nB) * Math.PI * 2 + R() * 0.6;
    parts.push(limb(2.2 + R() * 0.8, 0.11, 0.04, 0, 3.2 + R() * 1.4, 0, yaw, 0.7 + R() * 0.35));
  }
  for (let i = 0; i < 4; i++) {
    const yaw = (i / 4) * Math.PI * 2 + R() * 0.8;
    parts.push(limb(1.3, 0.16, 0.03, 0, 0.35, 0, yaw, 1.32));   // raiz quase deitada, nasce acima do chão
  }
  return mergeGeometries(parts);
}

/** Pinheiro: tronco alto e reto até o topo + raízes. */
function pineTrunk(R) {
  const parts = [taperedTrunk(12.5, 0.06, 0.34, R, 8, 8)];
  for (let i = 0; i < 3; i++) parts.push(limb(1.1, 0.14, 0.03, 0, 0.3, 0, (i / 3) * Math.PI * 2 + R(), 1.35));
  return mergeGeometries(parts);
}

/** Copa de árvore folhosa: aglomerado de massas de folhas irregulares e achatadas. */
function leafyCrown(R, y, radius, blobs, detail = 1) {
  const parts = [];
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + R() * 0.8;
    const top = i === 0;
    const r = radius * (top ? 0.62 : 0.4 + R() * 0.25);
    const blob = new THREE.IcosahedronGeometry(r, detail);
    blob.scale(1, 0.78 + R() * 0.2, 1);
    const ring = radius * (0.55 + R() * 0.25);
    const off = top ? [0, radius * 0.45, 0] : [Math.cos(a) * ring, (R() - 0.45) * radius * 0.7, Math.sin(a) * ring];
    blob.translate(off[0], y + off[1], off[2]);
    parts.push(jitter(blob, R, r * 0.38));
  }
  return mergeGeometries(parts);
}

/** Pinheiro: 3 camadas de galhos em cone, com borda franjada caída. */
function pineCrown(R, half) {
  const parts = [];
  const layers = half === 0 ? [[3.1, 3.2, 4.4], [2.7, 3.0, 6.0], [2.25, 2.8, 7.5]] : [[1.8, 2.6, 9.0], [1.3, 2.3, 10.4], [0.8, 2.0, 11.8]];
  for (const [r, h, y] of layers) {
    const c = new THREE.ConeGeometry(r, h, 14, 3);
    const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vy = p.getY(i);
      if (vy < -h / 2 + 1e-3) {                                   // borda: pontas de galho alternadas, caídas
        const ang = Math.atan2(p.getZ(i), p.getX(i));
        const tip = 0.5 + 0.5 * Math.cos(ang * 7);
        const k = 0.78 + tip * 0.3;
        p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
        p.setY(i, vy - tip * 0.35 - 0.1);
      }
    }
    c.translate(0, y, 0);
    parts.push(jitter(c, R, 0.22));
  }
  return mergeGeometries(parts);
}

function lumpyRock(R) {
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), R, 0.3);
  g.scale(1.4, 0.75, 1.1);
  return g;
}

/**
 * Vento compartilhado (tronco e copa usam a MESMA curva, então nunca se separam):
 *  - flexão quadrática pela altura (o tronco inteiro verga, o topo mais);
 *  - rajadas com fase pela posição no mundo (a onda atravessa a floresta);
 *  - `flutter`: tremor rápido das folhas (só na folhagem).
 */
function windPosition(sway, flutter) {
  return Fn(() => {
    const p = positionLocal;
    const w = attribute('aWind', 'vec3');
    const t = G.time;
    const ph = w.z;
    const gust = sin(t.mul(0.55).add(ph)).mul(0.45).add(sin(t.mul(1.63).add(ph.mul(1.7))).mul(0.2)).add(0.8);
    // direção do vento do mundo → espaço local da instância (desfaz a rotação em Y)
    const dx = G.windDir.x.mul(w.x).sub(G.windDir.y.mul(w.y));
    const dz = G.windDir.x.mul(w.y).add(G.windDir.y.mul(w.x));
    const h = p.y.max(0);
    const amt = h.mul(h).mul(0.008 * sway).mul(G.windSpeed.mul(0.05)).mul(gust);
    let out = p.add(vec3(dx.mul(amt), amt.mul(amt).mul(-0.15), dz.mul(amt)));
    if (flutter > 0) {
      const k = G.windSpeed.mul(0.12).min(1.6).mul(0.045 * flutter);
      const f = vec3(
        sin(t.mul(7.1).add(p.y.mul(3.1)).add(ph.mul(5.0))),
        sin(t.mul(5.3).add(p.x.mul(2.7)).add(p.z.mul(1.3))).mul(0.6),
        cos(t.mul(6.4).add(p.z.mul(3.3)).add(ph.mul(3.0))));
      out = out.add(f.mul(k).mul(h.mul(0.25).min(1)));
    }
    return out;
  })();
}

/**
 * Folhagem: cor variando por ruído, auto-sombreamento (interior e base da copa
 * mais escuros, bordas mais claras) e vento.
 * @param {[number, number, number]} crown [base, topo, raio] da copa em metros
 */
function foliageMaterial(dark, light, sway, flutter, crown) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0 });
  const [y0, y1, rad] = crown;
  const n = mx_noise_float(positionWorld.mul(0.35)).mul(0.5).add(0.5);
  const fine = mx_noise_float(positionWorld.mul(2.6)).mul(0.5).add(0.5);
  const leaf = mx_noise_float(positionWorld.mul(9.0)).mul(0.5).add(0.5);     // "folhas" individuais
  const base = mix(color(dark), color(light), smoothstep(0.2, 0.9, n.mul(0.55).add(fine.mul(0.3)).add(leaf.mul(0.15))));
  const p = positionLocal;
  const hK = smoothstep(float(y0), float(y1), p.y);
  const rK = smoothstep(float(rad * 0.15), float(rad), length(vec2(p.x, p.z)));
  const ao = hK.mul(0.45).add(rK.mul(0.4)).add(0.3).min(1.1);
  m.colorNode = base.mul(ao);
  m.roughnessNode = float(0.7).add(leaf.mul(0.25));
  // relevo de tufos de folhas: perturba a normal com ruído em duas escalas (luz e sombra recortadas)
  const bump = mx_noise_vec3(positionLocal.mul(2.2)).mul(0.55).add(mx_noise_vec3(positionLocal.mul(7.0)).mul(0.35));
  m.normalNode = normalView.add(transformNormalToView(bump)).normalize();
  m.positionNode = windPosition(sway, flutter);
  return m;
}

/** Casca PBR (Poly Haven CC0) com relevo por normal map, mapeada pelos UVs do cilindro. */
const _texLoader = new THREE.TextureLoader();
function barkMaterial(name, tint, height) {
  const load = (f, srgb) => {
    const t = _texLoader.load(`./assets/textures/${name}_${f}_1k.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const st = uv().mul(vec2(2, height / 1.6));
  const moss = smoothstep(0.55, 0.8, mx_noise_float(positionLocal.mul(vec3(2.5, 0.6, 2.5))).mul(0.5).add(0.5))
    .mul(smoothstep(2.5, 0.2, positionLocal.y));                                 // musgo perto da base
  m.colorNode = mix(texture(load('diff', true), st).rgb.mul(color(tint)), color(0x4a5a2a), moss.mul(0.55));
  m.normalNode = normalMap(texture(load('nor_gl', false), st), vec2(1.4, 1.4));
  m.roughnessNode = texture(load('rough', false), st).r.mul(0.9).add(0.1);
  m.positionNode = windPosition(1.0, 0);
  return m;
}

function rockMaterial(hex) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const n = mx_noise_float(positionWorld.mul(0.8)).mul(0.5).add(0.5);
  const lichen = smoothstep(0.62, 0.8, mx_noise_float(positionWorld.mul(1.7)).mul(0.5).add(0.5));
  m.colorNode = mix(mix(color(hex).mul(0.75), color(hex), n), color(0x6f7a4a), lichen.mul(0.5));
  return m;
}
