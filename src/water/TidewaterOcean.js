/**
 * TidewaterOcean.js (adaptador)
 * Monta o oceano completo do Tidewater (src/vendor/tidewater, MIT, código sem
 * alteração) na mesma ordem do App.js original:
 *   OceanFFT (4 cascatas FFT em compute) → espuma → CDLOD → WaterSurface
 *   → SeaDetail (rajadas/manchas) → ShoreWaves (ondas quebrando na praia)
 *   → Caustics → ShoreSim + SurfFoam (simulação da zona de arrebentação)
 *   → luz subaquática → WaterMaterial (reflexo, refração, absorção) → WaterQuery
 *   → WakeSim (rastro do navio).
 *
 * Expõe a mesma API do antigo Ocean.js para o resto do jogo:
 *   getWaveHeight(x, z), getWaveNormal(x, z, out), update(dt, focus), time
 * A altura vem do WaterQuery (GPU → CPU, 1–3 frames de atraso), em pontos pedidos
 * pelos sistemas do jogo (navio, jacarés, drops, projéteis, câmera).
 */
import * as THREE from 'three/webgpu';
import { vec2, float, max, smoothstep } from 'three/tsl';
import { G } from '../vendor/tidewater/core/Globals.js';
import { LAYERS } from '../vendor/tidewater/core/SceneRenderer.js';
import { CDLOD } from '../vendor/tidewater/core/CDLOD.js';
import { OceanFFT } from '../vendor/tidewater/ocean/OceanFFT.js';
import { WaterSurface } from '../vendor/tidewater/ocean/WaterSurface.js';
import { WaterMaterial } from '../vendor/tidewater/ocean/WaterMaterial.js';
import { createFoamTexture } from '../vendor/tidewater/ocean/FoamTexture.js';
import { ShoreWaves } from '../vendor/tidewater/ocean/ShoreWaves.js';
import { ShoreSim } from '../vendor/tidewater/ocean/ShoreSim.js';
import { SurfFoam } from '../vendor/tidewater/ocean/SurfFoam.js';
import { Caustics } from '../vendor/tidewater/ocean/Caustics.js';
import { SeaDetail } from '../vendor/tidewater/ocean/SeaDetail.js';
import { WaterQuery, MAX_QUERIES } from '../vendor/tidewater/ocean/WaterQuery.js';
import { WakeSim } from '../vendor/tidewater/ocean/WakeSim.js';
import { installUnderwaterLighting } from '../vendor/tidewater/ocean/UnderwaterLighting.js';
import { TerrainGPU } from '../vendor/tidewater/world/TerrainGPU.js';
import { computeShoreField } from '../vendor/tidewater/world/ShoreField.js';
import { BoatWakeAdapter } from './BoatWakeAdapter.js';

const GRID = 3;   // m: resolução da grade de pedidos de altura (pontos próximos compartilham slot)

export class TidewaterOcean {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene
   * @param {object} o.terrainData resultado de buildTerrainData()
   * @param {import('../world/Sky.js').Sky} o.sky
   * @param {import('../vendor/tidewater/core/SceneRenderer.js').SceneRenderer} o.sceneRenderer
   * @param {{x:number,z:number}} o.shoreCenter centro da simulação de arrebentação
   */
  constructor({ renderer, scene, terrainData, sky, sceneRenderer, shoreCenter, swellDir = [0.35, 0.94] }) {
    this.renderer = renderer;
    this.time = 0;

    // ---- Terreno na GPU + campo de propagação das ondas até a praia ----
    this.shoreField = computeShoreField(terrainData, { res: 512, swellDir });
    this.terrainGPU = new TerrainGPU(terrainData, this.shoreField);

    // ---- Oceano FFT ----
    this.fft = new OceanFFT(renderer);
    this.foamTexture = createFoamTexture(renderer);
    this.lod = new CDLOD({ gridSize: 32, leafSize: 8, levels: 12, minY: -25, maxY: 25 });
    this.surface = new WaterSurface({ fft: this.fft, cdlod: this.lod, foamTexture: this.foamTexture });
    this.surface.terrain = this.terrainGPU;
    this.seaDetail = new SeaDetail();
    this.surface.detail = this.seaDetail;
    this.shore = new ShoreWaves(this.terrainGPU);
    this.surface.shore = this.shore;
    this.caustics = new Caustics(renderer, this.fft);
    this.caustics.detail = this.seaDetail;

    // ---- Zona de arrebentação simulada (espuma, refluxo) ----
    this.shoreSim = new ShoreSim(renderer, {
      terrainGPU: this.terrainGPU, shore: this.shore,
      center: new THREE.Vector2(shoreCenter.x, shoreCenter.z), size: 900, res: 768,
    });
    this.surface.shoreSim = this.shoreSim;
    this.surfFoam = new SurfFoam({ shoreSim: this.shoreSim });
    this.surface.foamShading = (args) => this.surfFoam.shading(args);

    // Areia molhada / espuma deixada na praia, para o material do terreno (TerrainMaterial)
    this.wetness = (xz, h) => {
      const s = this.shoreSim.sample(xz);
      const inside = this.shoreSim.inside(this.shoreSim.uvOf(xz));
      const band = smoothstep(0.45, 0.0, h);
      return vec2(max(s.y, band.mul(float(1).sub(inside))), this.shoreSim.sandFoam(xz, s, h));
    };

    installUnderwaterLighting({
      fft: this.fft, caustics: this.caustics, clouds: sky.clouds, terrain: this.terrainGPU,
      shore: this.shore, surface: this.surface, shoreSim: this.shoreSim,
    });

    // ---- Material da água + malha CDLOD ----
    this.material = new WaterMaterial({
      surface: this.surface, sky: sky.sky, sceneCopy: sceneRenderer.opaqueCopy,
      hullMask: sceneRenderer.hullMaskRT.texture, hullMaskActive: sceneRenderer.hullMaskActive,
    });
    this.material.clouds = sky.clouds;
    this.mesh = new THREE.Mesh(this.lod.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.layers.set(LAYERS.WATER);
    scene.add(this.mesh);

    // ---- Consultas de altura (GPU → CPU) ----
    this.query = new WaterQuery(renderer, this.surface);
    this.material.cameraWaterHeightNode = this.query.cameraState().x;
    this.slotStart = this.query.allocate('game', MAX_QUERIES - 1);
    this.slotCount = MAX_QUERIES - 1;
    this._want = new Map();      // chave da grade → {x,z}
    this._cache = new Map();     // chave da grade → {h, nx, nz}
    this.cameraWaterHeight = 0;

    this.wake = null;
  }

  /** Liga o rastro (WakeSim) ao navio do jogador. Chamar antes do primeiro render. */
  attachBoat(boat) {
    this.boatAdapter = new BoatWakeAdapter(boat);
    this.wake = new WakeSim(this.renderer, { terrainGPU: this.terrainGPU, boat: this.boatAdapter, colliders: null });
    this.surface.wake = this.wake;
  }

  /** Chave numérica da célula da grade (sem criar strings). */
  _key(x, z) { return (Math.round(x / GRID) + 32768) * 65536 + (Math.round(z / GRID) + 32768); }

  /** Altura da água em (x,z): última leitura da GPU para esse ponto (ou o nível do mar). */
  getWaveHeight(x, z) {
    const k = this._key(x, z);
    if (!this._want.has(k)) this._want.set(k, k);
    const c = this._cache.get(k);
    return c ? c.h : G.seaLevel.value;
  }

  getWaveNormal(x, z, out = new THREE.Vector3()) {
    const c = this._cache.get(this._key(x, z));
    if (!c) return out.set(0, 1, 0);
    return out.set(c.nx, 1, c.nz).normalize();
  }

  /** Simulação + consultas. Chamado antes do render. */
  update(dt, focus, camera) {
    this.time += dt;
    G.dt.value = dt;
    G.time.value += dt;

    if (this.wake) { this.boatAdapter.update(dt); this.wake.update(dt); }
    this.fft.update(dt);
    this.seaDetail.update(dt);

    // Lê os resultados da última consulta para o cache
    if (this.query.cpuValid && this.query.version !== this._seenVersion) {
      this._seenVersion = this.query.version;
      // usa os pontos da época em que a consulta foi emitida (resultInputs), não os atuais
      const inp = this.query.resultInputs, r = {};
      for (let i = this.slotStart; i < this.slotStart + this.slotCount; i++) {
        const x = inp[i * 4], z = inp[i * 4 + 1];
        if (Math.abs(x) > 1e6) continue;
        this.query.get(i, r);
        if (!Number.isFinite(r.height)) continue;
        const key = this._key(x, z);
        const c = this._cache.get(key);
        if (c) { c.h = r.height; c.nx = r.nx; c.nz = r.nz; }
        else this._cache.set(key, { h: r.height, nx: r.nx, nz: r.nz });
      }
      const h0 = this.query.cpu[0];
      if (Number.isFinite(h0)) {
        this.cameraWaterHeight = h0;
        G.cameraWaterHeight.value = h0;
        G.cameraUnderwater.value = camera.position.y < h0 - 0.35 ? 1 : 0;
      }
    }

    // Pedidos deste frame → slots (os mais próximos do foco primeiro)
    // decodifica as chaves em pontos (arrays reaproveitados) e ordena pela distância ao foco
    const wants = this._wantList || (this._wantList = []);
    wants.length = 0;
    for (const k of this._want.keys()) {
      const px = (Math.floor(k / 65536) - 32768) * GRID, pz = ((k % 65536) - 32768) * GRID;
      wants.push({ x: px, z: pz, d: (px - focus.x) ** 2 + (pz - focus.z) ** 2 });
    }
    if (wants.length > this.slotCount) wants.sort((a, b) => a.d - b.d);
    for (let n = 0; n < this.slotCount; n++) {
      const i = this.slotStart + n;
      if (n < wants.length) this.query.setPoint(i, wants[n].x, wants[n].z);
      else this.query.setPoint(i, 1e7, 1e7);          // slot livre
    }
    this._want.clear();
    // limita o cache a pontos recentes
    if (this._cache.size > 600) this._cache.clear();

    this.query.setCamera(camera.position.x, camera.position.z);
    this.query.update();
    this.caustics.update();
    this.shoreSim.update();
    this.lod.update(camera);
  }
}
