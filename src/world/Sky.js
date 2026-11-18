/**
 * Sky.js (adaptador)
 * Céu, atmosfera, nuvens volumétricas, ambiente (IBL) e sol com sombras em
 * cascata vêm do Tidewater (src/vendor/tidewater, MIT, código sem alteração).
 * Este arquivo só faz a montagem e liga o relógio do jogo (DayNight) a eles,
 * seguindo a mesma lógica de App.updateSun / applyAtmosphereReadback do Tidewater:
 *  - atmosphere.sunDir = direção real do sol (o céu espalha luz mesmo no crepúsculo);
 *  - abaixo do horizonte a lua assume como luz principal (G.sunDir);
 *  - cor e intensidade do sol vêm da transmitância lida da atmosfera.
 */
import * as THREE from 'three/webgpu';
import { G } from '../vendor/tidewater/core/Globals.js';
import { LAYERS } from '../vendor/tidewater/core/SceneRenderer.js';
import { Atmosphere, SUN_ILLUMINANCE } from '../vendor/tidewater/sky/Atmosphere.js';
import { Sky as TwSky } from '../vendor/tidewater/sky/Sky.js';
import { Clouds as TwClouds } from '../vendor/tidewater/sky/Clouds.js';
import { Environment } from '../vendor/tidewater/sky/Environment.js';
import { SoftCSMShadowNode, configureCascades, shadowSplits } from '../vendor/tidewater/materials/SunShadowFilter.js';

const _dir = new THREE.Vector3();
const _moon = new THREE.Vector3();

export class Sky {
  constructor(scene, renderer, { clouds = true } = {}) {
    this.scene = scene;
    this.renderer = renderer;

    // ---- Atmosfera + domo do céu (fundo da cena) ----
    this.atmosphere = new Atmosphere(renderer);
    this.sky = new TwSky(this.atmosphere);
    if (clouds) {
      this.clouds = new TwClouds(renderer, this.atmosphere);
      this.sky.clouds = this.clouds;
    }
    scene.backgroundNode = this.sky.backgroundNode();

    // ---- Sol: DirectionalLight com sombras suaves em 3 cascatas (0–10, 10–60, 60–400 m) ----
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1400;
    this.sun.shadow.bias = -0.00002;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.camera.layers.enable(LAYERS.TRANSPARENT);
    this.csm = new SoftCSMShadowNode(this.sun, { cascades: 3, maxFar: 400, mode: 'custom', customSplitsCallback: shadowSplits, lightMargin: 200 });
    configureCascades(this.csm);
    this.csm.fade = true;
    this.sun.shadow.shadowNode = this.csm;
    this.sun.layers.enableAll();
    scene.add(this.sun, this.sun.target);

    // ---- Iluminação ambiente baseada no céu (PMREM atualizado com o sol) ----
    this.environment = new Environment(renderer, scene, this.sky);

    this.elevation = 30;
    this.azimuth = 135;
    this.dayFactor = 1;
    this._lastSun = new THREE.Vector3();
    this._shadowFrame = 0;
  }

  /** Recebe o relógio do jogo (DayNight). */
  setSun(elevation, azimuth, dayFactor) {
    this.elevation = elevation;
    this.azimuth = azimuth;
    this.dayFactor = dayFactor;
  }

  _updateSun(camera) {
    const phi = THREE.MathUtils.degToRad(90 - this.elevation);
    const theta = THREE.MathUtils.degToRad(this.azimuth);
    _dir.setFromSphericalCoords(1, phi, theta);
    this.atmosphere.sunDir.value.copy(_dir);
    const night = THREE.MathUtils.smoothstep(-_dir.y, 0.02, 0.18);
    G.night.value = night;
    this.sky.starIntensity.value = night;
    _moon.set(-_dir.x, Math.abs(_dir.y) * 0.8 + 0.25, -_dir.z).normalize();
    this.sky.moonDir.value.copy(_moon);
    const light = _dir.y > -0.07 ? _dir : _moon;
    G.sunDir.value.copy(light);
    this.sun.target.position.copy(camera.position);
    this.sun.position.copy(camera.position).addScaledVector(light, 400);
  }

  _applyAtmosphereReadback() {
    const a = this.atmosphere;
    if (!a.sunTransmittance) return;
    const sunTrue = a.sunDir.value;
    const T = a.sunTransmittance;
    const horizonFade = THREE.MathUtils.smoothstep(sunTrue.y, -0.03, 0.02);
    let c;
    if (sunTrue.y > -0.07) c = new THREE.Color(T[0], T[1], T[2]).multiplyScalar(SUN_ILLUMINANCE * horizonFade);
    else c = new THREE.Color(0.6, 0.7, 1.0).multiplyScalar(0.12 * G.night.value);
    const oc = this.overcast || 0;
    c.multiplyScalar(1 - 0.82 * oc);
    G.sunColor.value.copy(c);
    this.sun.color.copy(c);
    this.sun.intensity = 1;
    const irr = a.skyIrradiance;
    const nightAmb = 0.012 * G.night.value;
    const ok = 1 - 0.5 * oc, hk = 1 - 0.45 * oc;
    G.skyIrradiance.value.setRGB((irr[0] + nightAmb * 0.6) * ok, (irr[1] + nightAmb * 0.7) * ok, (irr[2] + nightAmb) * ok);
    G.horizonColor.value.setRGB(a.horizon[0] * hk, a.horizon[1] * hk, a.horizon[2] * (hk + 0.05 * oc));
  }

  /** Cascata próxima todo frame, a do meio a cada 2 e a distante a cada 4. */
  _updateShadowCascades() {
    const lights = this.csm.lights;
    if (!lights || lights.length === 0) return;
    const f = ++this._shadowFrame;
    const moved = this._lastSun.angleTo(G.sunDir.value) > 1e-4;
    this._lastSun.copy(G.sunDir.value);
    for (let i = 0; i < lights.length; i++) {
      const period = i === 0 ? 1 : i === 1 ? 2 : 4;
      const sh = lights[i].shadow;
      sh.autoUpdate = false;
      if (moved || (f + i) % period === 0) sh.needsUpdate = true;
    }
  }

  update(dt, t, focus, camera) {
    this._updateSun(camera);
    this._updateShadowCascades();
    this.atmosphere.update(dt, camera.position.y);
    this._applyAtmosphereReadback();
    if (this.clouds) this.clouds.update(dt, camera);
    this.environment.update(dt);
  }
}
