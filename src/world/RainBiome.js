/**
 * RainBiome.js
 * Bioma "Ilha das Chuvas Eternas" (inspirado em mundos chuvosos, tipo Rainy Worlds)
 * + sistema de clima do arquipélago.
 *
 *  - markRainIsland(terrain): escolhe a ilha (8ª mais próxima, livre de chefes)
 *    e marca `wet = true` ANTES da vegetação (floresta densa de pinheiros).
 *  - Weather: intensidade de chuva 0..1
 *      · perto da ilha: tempestade permanente (até Nimbra ser derrotada → garoa)
 *      · no resto do mundo: chuvas aleatórias de 2–6 min a cada 1–3 dias de jogo
 *    Efeitos: gotas (8000 traços animados 100% no vertex shader TSL, presos à câmera,
 *    inclinados pelo vento), respingos no chão/água (InstancedMesh), céu fechado
 *    (nuvens Tidewater: cobertura/densidade), menos sol e mais neblina (adaptador
 *    Sky + AirHaze), chão molhado (gancho `wetness` do terreno Tidewater), gotas na
 *    lente da câmera, raios com clarão + trovão atrasado pela distância, som de chuva.
 *    Nenhum arquivo do vendor Tidewater é alterado — só uniforms públicos.
 */
import * as THREE from 'three/webgpu';
import {
  attribute, vec3, vec2, float, uniform, time, cameraPosition, mod, normalize, cross, step, mix, max, smoothstep, length, sub,
} from 'three/tsl';
import { G } from '../vendor/tidewater/core/Globals.js';
import { LAYERS } from '../render/GameRenderer.js';

/** Índice (entre as ilhas secundárias ordenadas pela distância) da ilha da chuva. */
export const RAIN_ISLAND_INDEX = 7;

export function markRainIsland(terrain) {
  const others = terrain.islands.slice(1).sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz));
  const isl = others[Math.min(RAIN_ISLAND_INDEX, others.length - 1)];
  isl.wet = true;
  return isl;
}

const N_DROPS = 8000, BOX = new THREE.Vector3(70, 36, 70);

export class Weather {
  /**
   * @param {object} o { scene, sky, gfx, twTerrain, ocean, terrain, island, audio, cfx, hud }
   */
  constructor(o) {
    Object.assign(this, o);
    this.rain = 0;              // intensidade atual (suavizada)
    this.forced = null;         // setRain(x) para testes
    this.islandClear = false;   // Nimbra derrotada → só garoa na ilha
    this.event = 0;             // chuva global atual (0..0.7)
    this._eventLeft = 0;
    this._nextEvent = 600 + Math.random() * 900;  // s de jogo real até a próxima chuva
    this.mode = 'on';           // 'on' | 'light' | 'off' (Configurações)
    this.uRain = uniform(0);
    this.uIsle = uniform(new THREE.Vector3(o.island.cx, o.island.cz, o.island.radius));
    this.uIsleWet = uniform(1);
    this._buildDrops();
    this._buildSplashes();
    this._hookTerrain();
    this._buildAudio();
    // clarão do relâmpago (luz hemisférica fria, 0 fora do raio)
    this.flashLight = new THREE.HemisphereLight(0xc8d8ff, 0x303848, 0);
    this.scene.add(this.flashLight);
    this._boltT = 3 + Math.random() * 6;
    this.base = {
      coverage: this.sky.clouds?.coverage.value ?? 0.45,
      density: this.sky.clouds?.densityScale.value ?? 0.07,
      haze: this.gfx.haze?.density.value ?? 1.6,
      wind: G.windSpeed.value,
    };
  }

  // ---------------------------------------------------------------------------
  // Gotas: cada traço é um quad; posição calculada na GPU (sem custo de CPU)
  // ---------------------------------------------------------------------------
  _buildDrops() {
    const seeds = new Float32Array(N_DROPS * 4 * 4), corner = new Float32Array(N_DROPS * 4 * 2), idx = new Uint32Array(N_DROPS * 6);
    for (let i = 0; i < N_DROPS; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let v = 0; v < 4; v++) {
        seeds.set(s, (i * 4 + v) * 4);
        corner.set([v & 1 ? 1 : -1, v >> 1], (i * 4 + v) * 2);
      }
      const b = i * 4;
      idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_DROPS * 4 * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const seed = attribute('aSeed', 'vec4'), cor = attribute('aCorner', 'vec2');
    const box = vec3(BOX.x, BOX.y, BOX.z);
    const speed = seed.w.mul(4).add(13);                                   // 13–17 m/s
    const p0 = vec3(seed.x, seed.y, seed.z).mul(box).sub(vec3(0, time.mul(speed), 0));
    const rel = mod(p0.sub(cameraPosition).add(box.mul(0.5)), box).sub(box.mul(0.5));
    const wp = cameraPosition.add(rel);
    const wind = G.windDir.mul(G.windSpeed).mul(0.55);
    const dir = normalize(vec3(wind.x, speed.negate(), wind.y));
    const on = step(seed.w, this.uRain);                                   // menos gotas com chuva fraca
    const len = float(0.95).mul(on), wid = float(0.018).mul(on).mul(length(rel).mul(0.045).add(1));
    const side = normalize(cross(dir, cameraPosition.sub(wp)));
    const pos = wp.sub(dir.mul(len.mul(cor.y))).add(side.mul(wid.mul(cor.x)));
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    mat.positionNode = pos;
    // mais visível perto da câmera e com luz; à noite quase some (só no clarão)
    const fade = smoothstep(34, 4, length(rel));
    const lum = mix(float(0.9), float(0.18), G.night).add(this._uFlash = uniform(0));
    mat.colorNode = vec3(0.78, 0.84, 0.95).mul(lum);
    mat.opacityNode = cor.y.mul(0.7).add(0.3).mul(fade).mul(0.5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.layers.set(LAYERS.TRANSPARENT);
    mesh.renderOrder = 8;
    mesh.visible = false;
    this.scene.add(mesh);
    this.drops = mesh;
  }

  _buildSplashes() {
    const geo = new THREE.RingGeometry(0.05, 0.065, 12); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicNodeMaterial({ color: 0x9fb0c0, transparent: true, opacity: 0.22, depthWrite: false, fog: false });
    this.splash = new THREE.InstancedMesh(geo, mat, 120);
    this.splash.layers.set(LAYERS.TRANSPARENT);
    this.splash.frustumCulled = false;
    this.splash.visible = false;
    this.scene.add(this.splash);
    this._sp = Array.from({ length: 120 }, () => ({ x: 0, y: -999, z: 0, t: Math.random() }));
    this._m = new THREE.Matrix4();
  }

  /** Chão molhado: amplia a umidade da costa (Tidewater) com a chuva. */
  _hookTerrain() {
    const t = this.twTerrain;
    if (!t || !t.wetness) return;
    const shore = t.wetness, isle = this.uIsle, isleWet = this.uIsleWet, rain = this.uRain;
    t.wetness = (xz, h) => {
      const w = shore(xz, h);
      const d = length(sub(xz, vec2(isle.x, isle.y)));
      const onIsle = smoothstep(isle.z.mul(1.35), isle.z.mul(0.9), d).mul(isleWet);
      const k = max(onIsle.mul(0.2), rain.mul(0.18));
      return vec2(max(w.x, k), w.y);
    };
    t.finalizeMaterial();
  }

  _buildAudio() {
    const a = this.audio; if (!a?.ctx) return;
    const c = a.ctx;
    const src = c.createBufferSource(); src.buffer = a.noise; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(hp).connect(lp).connect(g).connect(a.bus.ambient);
    src.start();
    // camada grave (chuva pesada nas folhas / no mar)
    const src2 = c.createBufferSource(); src2.buffer = a.noise; src2.loop = true; src2.playbackRate.value = 0.7;
    const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 600;
    const g2 = c.createGain(); g2.gain.value = 0;
    src2.connect(lp2).connect(g2).connect(a.bus.ambient);
    src2.start();
    this._snd = { g, g2 };
  }

  thunder(dist) {
    const a = this.audio; if (!a?.ctx) return;
    const delay = Math.min(6, dist / 343);
    const near = dist < 300;
    a.noiseBurst({ dur: near ? 2.2 : 3.2, type: 'lowpass', freq: near ? 900 : 300, freqEnd: 80, gain: near ? 1.0 : 0.6, attack: near ? 0.005 : 0.2, bus: 'ambient', delay, rate: 0.5 });
    a.noiseBurst({ dur: 1.6, type: 'lowpass', freq: 180, gain: 0.7, attack: 0.3, bus: 'ambient', delay: delay + 0.25, rate: 0.35 });
    if (near) a.noiseBurst({ dur: 0.25, freq: 3000, q: 0.4, gain: 0.5, bus: 'ambient', delay });
  }

  /** Distância horizontal até a ilha da chuva. */
  distToIsland(x, z) { return Math.hypot(x - this.island.cx, z - this.island.cz) - this.island.radius; }

  setMode(m) { this.mode = m; }

  update(dt, focus, camera, rawDt = dt) {
    // ---- alvo da intensidade ----
    const d = this.distToIsland(focus.x, focus.z);
    const isle = (this.islandClear ? 0.12 : 1) * THREE.MathUtils.smoothstep(-d, -320, 0);
    this._nextEvent -= rawDt;
    if (this._nextEvent <= 0 && this._eventLeft <= 0) { this._eventLeft = 120 + Math.random() * 240; this._eventPeak = 0.3 + Math.random() * 0.4; }
    if (this._eventLeft > 0) {
      this._eventLeft -= rawDt;
      this.event = Math.min(this._eventPeak, this.event + rawDt * 0.02);
      if (this._eventLeft <= 0) this._nextEvent = 1200 + Math.random() * 2400;
    } else this.event = Math.max(0, this.event - rawDt * 0.02);
    let target = this.forced ?? (this.forcedStorm && d < 400 ? 1 : Math.max(isle, this.event));
    if (this.mode === 'off') target = 0;
    if (this.mode === 'light') target *= 0.45;
    this.rain += (target - this.rain) * (1 - Math.exp(-rawDt * 0.6));
    const r = this.rain;
    this.uRain.value = r;
    this.uIsleWet.value = this.islandClear ? 0.25 : 1;

    // ---- céu, luz, neblina, vento ----
    const cl = this.sky.clouds;
    if (cl) { cl.coverage.value = THREE.MathUtils.lerp(this.base.coverage, 0.95, r); cl.densityScale.value = THREE.MathUtils.lerp(this.base.density, 0.14, r); }
    this.sky.overcast = r;
    if (this.gfx.haze) this.gfx.haze.density.value = THREE.MathUtils.lerp(this.base.haze, 6.5, r);
    G.windSpeed.value = this.base.wind + 9 * r;
    const rr = this.gfx.renderer; if (rr) { this.base.exposure ??= rr.toneMappingExposure; rr.toneMappingExposure = this.base.exposure * (1 - 0.38 * r); }
    if (this.gfx.post?.lens && r > 0.25 && camera.position.y > 0.5) this.gfx.post.lens.wet.value = Math.max(this.gfx.post.lens.wet.value, (r - 0.25) * 0.45);

    // ---- gotas e respingos ----
    this.drops.visible = r > 0.02;
    this.splash.visible = r > 0.1;
    if (this.splash.visible) {
      const n = Math.round(120 * r);
      for (let i = 0; i < 120; i++) {
        const s = this._sp[i];
        s.t += rawDt * 2.2;
        if (s.t >= 1 && i < n) {
          s.t = 0;
          const a = Math.random() * Math.PI * 2, rr = 1 + Math.sqrt(Math.random()) * 14;
          s.x = focus.x + Math.cos(a) * rr; s.z = focus.z + Math.sin(a) * rr;
          s.y = Math.max(this.terrain.getHeight(s.x, s.z), this.ocean?.getWaveHeight ? this.ocean.getWaveHeight(s.x, s.z) : 0) + 0.04;
        }
        const k = i < n ? Math.min(1, s.t) : 1;
        const sc = k >= 1 ? 0 : 0.5 + k * 1.6;
        this._m.makeScale(sc, 1, sc).setPosition(s.x, s.y, s.z);
        this.splash.setMatrixAt(i, this._m);
      }
      this.splash.instanceMatrix.needsUpdate = true;
    }

    // ---- raios ----
    this._uFlash.value = Math.max(0, this._uFlash.value - rawDt * 5);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - rawDt * 22);
    if (r > 0.65 && this.mode !== 'off') {
      this._boltT -= rawDt;
      if (this._boltT <= 0) {
        this._boltT = 5 + Math.random() * 12;
        const a = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 500;
        this.strike(new THREE.Vector3(focus.x + Math.cos(a) * dist, 0, focus.z + Math.sin(a) * dist), dist);
      }
    }

    // ---- som ----
    if (this._snd) {
      const t = this.audio.ctx.currentTime;
      this._snd.g.gain.setTargetAtTime(0.32 * r, t, 0.4);
      this._snd.g2.gain.setTargetAtTime(0.25 * r * r, t, 0.6);
    }
  }

  /** Raio visual + clarão + trovão (o dano, se houver, é de quem chamou). */
  strike(pos, dist = 100) {
    if (dist < 220) this.cfx?.bolt(pos);
    this.flashLight.intensity = dist < 220 ? 7 : 3.5;
    this._uFlash.value = 0.9;
    this.thunder(dist);
  }
}
