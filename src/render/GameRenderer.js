/**
 * GameRenderer.js
 * Renderer WebGPU e pipeline de imagem do Tidewater (src/vendor/tidewater, MIT,
 * sem alteração), montados como no Engine.js / App.js originais:
 *   1. SceneRenderer: camada opaca → cópia de cor/profundidade → água → transparentes
 *   2. PostFX: GTAO, TAAU (upscale temporal), motion blur, bloom, lens flare,
 *      gotas na lente, visão subaquática e AirHaze (perspectiva aérea + raios de sol).
 * Exige WebGPU (o oceano usa compute shaders).
 */
import * as THREE from 'three/webgpu';
import '../vendor/tidewater/core/TSLPatches.js';
import { SceneRenderer, LAYERS } from '../vendor/tidewater/core/SceneRenderer.js';
import { PostFX } from '../vendor/tidewater/post/PostFX.js';
import { Underwater } from '../vendor/tidewater/post/Underwater.js';
import { AirHaze } from '../vendor/tidewater/post/AirHaze.js';
import { updateCameraVelocity, useStaticVelocity } from '../vendor/tidewater/post/CameraVelocity.js';
import { installContactShadows } from '../vendor/tidewater/materials/ContactShadows.js';

export { LAYERS, useStaticVelocity };

/** Cria o WebGPURenderer com os limites e o depth reverso que o Tidewater usa. */
export async function createRenderer(container) {
  if (!navigator.gpu) throw new Error('Este jogo precisa de WebGPU. Use o Chrome ou o Edge atualizados.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('Nenhum adaptador WebGPU encontrado.');
  const L = adapter.limits;
  const want = (name, v) => Math.min(v, L[name] ?? v);
  const requiredLimits = {
    maxSampledTexturesPerShaderStage: want('maxSampledTexturesPerShaderStage', 32),
    maxStorageBuffersPerShaderStage: want('maxStorageBuffersPerShaderStage', 10),
    maxComputeWorkgroupStorageSize: want('maxComputeWorkgroupStorageSize', 32768),
    maxStorageTexturesPerShaderStage: want('maxStorageTexturesPerShaderStage', 8),
    maxColorAttachmentBytesPerSample: want('maxColorAttachmentBytesPerSample', 64),
    maxStorageBuffersInVertexStage: want('maxStorageBuffersInVertexStage', 4),
    maxStorageBuffersInFragmentStage: want('maxStorageBuffersInFragmentStage', 4),
  };
  for (const k of Object.keys(requiredLimits)) if (L[k] === undefined) delete requiredLimits[k];

  const renderer = new THREE.WebGPURenderer({
    antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true, requiredLimits,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  await renderer.init();
  return renderer;
}

export function backendName(renderer) {
  return renderer.backend?.isWebGPUBackend ? 'WebGPU · Tidewater ocean' : 'WebGL2';
}

export class GameRenderer {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sceneRenderer = new SceneRenderer(renderer, scene, camera);
    // sombras de contato a partir da profundidade opaca do frame anterior
    installContactShadows({ depthTexture: this.sceneRenderer.opaqueCopy.depthTexture });
    this.ready = false;
  }

  /** Completa o pós-processamento (depois de criar o oceano e o céu). */
  finish({ ocean, sky }) {
    this.ocean = ocean;
    this.underwater = new Underwater({
      depthTexture: this.sceneRenderer.sceneRT.depthTexture, maskTexture: this.sceneRenderer.waterMaskTexture,
      query: ocean.query, caustics: ocean.caustics, fft: ocean.fft,
    });
    this.haze = new AirHaze({
      depthTexture: this.sceneRenderer.sceneRT.depthTexture, underwater: this.underwater, atmosphere: sky.atmosphere,
      sky: sky.sky, clouds: sky.clouds, terrain: ocean.terrainGPU, csm: sky.csm,
    });
    this.post = new PostFX(this.renderer, {
      sceneRenderer: this.sceneRenderer, camera: this.camera, underwater: this.underwater,
      clouds: sky.clouds, sunDir: sky.atmosphere.sunDir, haze: this.haze,
    });
    this._dyn = { ema: 1 / 60, t: 0, n: 0 };
    this.ready = true;
  }

  /** Compila os pipelines antes do primeiro frame (sem engasgos depois). */
  async precompile() {
    const { renderer, scene, camera } = this;
    const sr = this.sceneRenderer;
    renderer.getDrawingBufferSize(sr._size);
    sr.setSize(sr._size.x, sr._size.y);
    const mask = camera.layers.mask;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(sr.sceneRT);
    renderer.setMRT(sr.mrt);
    try {
      camera.layers.set(LAYERS.OPAQUE);
      await renderer.compileAsync(scene, camera);
      camera.layers.set(LAYERS.WATER);
      camera.layers.enable(LAYERS.TRANSPARENT);
      renderer.setMRT(sr.mrtLate);
      await renderer.compileAsync(scene, camera);
    } catch (e) {
      console.warn('precompile falhou', e);
    }
    camera.layers.mask = mask;
    renderer.setMRT(null);
    renderer.setRenderTarget(prev);
  }

  render(dt) {
    const cam = this.camera;
    const waterH = this.ocean ? this.ocean.cameraWaterHeight : 0;
    updateCameraVelocity(cam);
    this.post.lens.update(dt, cam.position.y < waterH);
    if (this.post.flare) {
      this.post.flare.setDepthHeight(this.sceneRenderer.sceneRT.height);
      this.post.flare.update(cam, dt, { aboveWater: cam.position.y > waterH - 0.02 });
    }
    this.post.beginFrame();
    this.underwater.updateCamera(cam);
    this.sceneRenderer.render();
    if (this.post.flare) this.renderer.compute(this.post.flare.kernel);
    this.post.render();
    this.post.endFrame();
    this._dynamicResolution(dt);
  }

  /**
   * Preset de qualidade (GraphicsMenu): limites da resolução interna e se ela é dinâmica.
   * @param {{minScale:number, maxScale:number, dynamic:boolean, pixelRatio:number}} q
   */
  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(q.pixelRatio || 1);
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.post) this.post.setScale(q.dynamic ? q.maxScale : q.maxScale);
  }

  /**
   * Mantém ~60 fps baixando a resolução interna (o TAAU reconstrói a saída).
   * Média longa + histerese larga + no mínimo 3 s entre trocas: a imagem não "pulsa".
   */
  _dynamicResolution(dt) {
    const q = this.quality || { minScale: 0.75, maxScale: 1, dynamic: true };
    if (!q.dynamic || dt > 0.1) return;
    const d = this._dyn;
    d.total = (d.total || 0) + dt;
    d.ema += (dt - d.ema) * 0.03;
    d.t += dt;
    // nada nos primeiros 10 s (carregamento do mapa ao redor) e no máx. 1 troca a cada 5 s:
    // cada troca recria os render targets e custa um frame longo
    if (d.total < 10 || d.t < 5) return;
    let s = this.post.scale;
    if (d.ema > (1 / 60) * 1.25) d.bad = (d.bad || 0) + 1;    // abaixo de ~48 fps
    else d.bad = 0;
    if (d.bad >= 3) { s -= 0.05; d.bad = 0; }                 // só se a lentidão persistir
    else if (d.ema < (1 / 60) * 0.8 && s < (this.quality?.maxScale ?? 1)) s += 0.05;
    else return;
    s = THREE.MathUtils.clamp(Math.round(s * 20) / 20, q.minScale, q.maxScale);
    if (s !== this.post.scale) {
      this.post.setScale(s);
      d.t = 0;
    }
  }
}
