/**
 * AnimUtils.js
 * Gera AnimationClips procedurais (KeyframeTracks) para rigs hierárquicos de Object3D.
 * O AnimationMixer anima qualquer nó pelo nome ("bracoE.quaternion"), por isso os
 * placeholders geométricos têm animações reais com blending e crossfade, iguais às
 * de um .glb importado.
 */
import * as THREE from 'three/webgpu';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Cria uma trilha de quaternion oscilante.
 * @param {string} node   nome do Object3D alvo
 * @param {object} o      { x:[base, amp, phase], y:[...], z:[...] } em radianos; phase em ciclos (0..1)
 * @param {number} duration
 * @param {number} samples quantidade de keyframes (o loop fecha no último)
 * @param {number} freq    ciclos por clip (padrão 1)
 */
export function oscRotTrack(node, o, duration, samples = 16, freq = 1) {
  const times = [], values = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * duration;
    const ph = (i / samples) * Math.PI * 2 * freq;
    const ax = o.x ? o.x[0] + o.x[1] * Math.sin(ph + (o.x[2] || 0) * Math.PI * 2) : 0;
    const ay = o.y ? o.y[0] + o.y[1] * Math.sin(ph + (o.y[2] || 0) * Math.PI * 2) : 0;
    const az = o.z ? o.z[0] + o.z[1] * Math.sin(ph + (o.z[2] || 0) * Math.PI * 2) : 0;
    _q.setFromEuler(_e.set(ax, ay, az));
    times.push(t);
    values.push(_q.x, _q.y, _q.z, _q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, values);
}

/**
 * Trilha de posição oscilante (bob vertical dos quadris, por exemplo).
 * @param {number[]} base  posição base [x,y,z]
 * @param {number[]} amp   amplitude por eixo
 * @param {number} freq    ciclos por clip
 */
export function oscPosTrack(node, base, amp, duration, samples = 16, freq = 2, phase = 0) {
  const times = [], values = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * duration;
    const s = Math.sin((i / samples) * Math.PI * 2 * freq + phase * Math.PI * 2);
    times.push(t);
    values.push(base[0] + amp[0] * s, base[1] + amp[1] * Math.abs(s), base[2] + amp[2] * s);
  }
  return new THREE.VectorKeyframeTrack(`${node}.position`, times, values);
}

/**
 * Trilha de rotação por keyframes explícitos (golpes, gestos).
 * @param {number[]} times tempos (s)
 * @param {number[][]} eulers [[x,y,z], ...] em radianos
 */
export function keyRotTrack(node, times, eulers) {
  const values = [];
  for (const [x, y, z] of eulers) {
    _q.setFromEuler(_e.set(x, y, z));
    values.push(_q.x, _q.y, _q.z, _q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, values);
}

/** Cria um AnimationClip a partir de um array de tracks. */
export function makeClip(name, duration, tracks) {
  return new THREE.AnimationClip(name, duration, tracks);
}

/**
 * Blend Space 1D/ND simples: mantém pesos alvo por ação e os aproxima
 * suavemente a cada frame (crossfade contínuo e independente de framerate).
 */
export class BlendSpace {
  constructor(mixer, clips) {
    this.mixer = mixer;
    this.actions = {};
    this.weights = {};
    this.targets = {};
    for (const clip of clips) {
      const a = mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveTimeScale(1);
      a.setEffectiveWeight(0);
      a.play();
      this.actions[clip.name] = a;
      this.weights[clip.name] = 0;
      this.targets[clip.name] = 0;
    }
  }

  /** Define os pesos alvo; nomes ausentes vão para 0. */
  setTargets(obj) {
    for (const k in this.targets) this.targets[k] = obj[k] || 0;
  }

  setTimeScale(name, s) {
    if (this.sync && this.sync.has(name)) { this.syncScale[name] = s; return; }
    this.actions[name]?.setEffectiveTimeScale(s);
  }

  /**
   * Grupo sincronizado (ex.: walk + run): os clipes avançam pela MESMA fase
   * normalizada (0..1), ponderada pelos pesos. Na troca andar↔correr os pés
   * continuam no mesmo ponto da passada: sem tranco.
   */
  syncGroup(names) {
    this.sync = new Set(names);
    this.syncScale = {};
    this.phase = 0;
    for (const n of names) { this.actions[n].setEffectiveTimeScale(0); this.syncScale[n] = 1; }
  }

  /**
   * Toca um clip uma única vez POR CIMA da locomoção (golpe, comer, dano).
   * Usa peso > 1 para dominar as trilhas que o clip anima (braços e tronco),
   * enquanto as pernas continuam vindo do blend de locomoção.
   */
  playOneShot(clip, { weight = 4, speed = 1, fadeIn = 0.1, fadeOut = 0.18 } = {}) {
    if (!this.oneShots) this.oneShots = [];
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset();
    action.setEffectiveTimeScale(speed);
    action.setEffectiveWeight(0);
    action.play();
    this.oneShots = this.oneShots.filter((o) => o.action !== action);
    this.oneShots.push({ action, t: 0, dur: clip.duration / speed, weight, fadeIn, fadeOut });
  }

  /** Interpola os pesos (lambda ≈ 1/tempo de fade) e atualiza o mixer. */
  update(dt, lambda = 8) {
    const k = 1 - Math.exp(-lambda * dt);
    for (const name in this.actions) {
      this.weights[name] += (this.targets[name] - this.weights[name]) * k;
      this.actions[name].setEffectiveWeight(this.weights[name]);
    }
    if (this.sync) {
      let wsum = 0, rate = 0;
      for (const n of this.sync) {
        const w = this.weights[n], d = this.actions[n].getClip().duration;
        wsum += w; rate += w * this.syncScale[n] / d;
      }
      if (wsum > 1e-3) this.phase = (((this.phase + (rate / wsum) * dt) % 1) + 1) % 1;   // aceita ciclo ao contrário
      for (const n of this.sync) this.actions[n].time = this.phase * this.actions[n].getClip().duration;
    }
    // Envelope dos one-shots (entrada/saída configuráveis)
    if (this.oneShots) {
      for (let i = this.oneShots.length - 1; i >= 0; i--) {
        const o = this.oneShots[i];
        o.t += dt;
        // envelope suave (smoothstep) de entrada e saída
        const a = Math.min(1, o.t / o.fadeIn), b = Math.min(1, Math.max(0, (o.dur - o.t) / o.fadeOut));
        const env = a * a * (3 - 2 * a) * b * b * (3 - 2 * b);
        o.action.setEffectiveWeight(o.weight * env);
        if (o.t >= o.dur) { o.action.stop(); this.oneShots.splice(i, 1); }
      }
    }
    this.mixer.update(dt);
  }
}
