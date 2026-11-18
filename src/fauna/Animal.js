/**
 * Animal.js
 * Classe base da fauna: root, AnimationMixer + BlendSpace, wander por steering
 * com validação de terreno e helpers de construção de placeholders.
 * As subclasses definem isValid(x,z), o visual, os clips e a lógica de estados.
 */
import * as THREE from 'three/webgpu';
import { BlendSpace } from '../utils/AnimUtils.js';
import { dampAngle } from '../utils/Noise.js';
import { HitFlash } from '../game/Combat.js';
import { events } from '../game/Events.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const glbCache = new Map();

const RESPAWN = 180;   // s até o animal reaparecer em casa

export class Animal {
  constructor(ctx, rand) {
    this.ctx = ctx;
    this.terrain = ctx.terrain;
    this.ocean = ctx.ocean;
    this.colliders = ctx.colliders;
    this.rand = rand;
    this.root = new THREE.Group();
    this.heading = rand() * Math.PI * 2;
    this.speed = 0;
    this.target = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.state = 'idle';
    this.stateTimer = 0;
    this.nodes = {};
  }

  // ---------------------------------------------------------------------------
  // Combate (vida, dano, morte, drops, respawn)
  // ---------------------------------------------------------------------------
  /**
   * @param {number} maxHp
   * @param {number} radius raio da esfera de acerto
   * @param {number} height altura do centro da esfera (antes da escala do root)
   */
  initCombat(maxHp, radius, height) {
    this.maxHp = this.hp = maxHp;
    this.alive = true;
    this.dying = false;
    this.faction = 'animal';
    this.hitHeight = height;
    this._sph = [{ x: 0, y: 0, z: 0, r: radius * this.root.scale.x }];
    this.flash = new HitFlash(this.root);
    this.ctx.combat?.register(this);
  }

  getHitSpheres() {
    const p = this.root.position, s = this._sph[0];
    s.x = p.x; s.y = p.y + this.hitHeight * this.root.scale.y; s.z = p.z;
    return this._sph;
  }

  takeDamage(amount, dir, source) {
    if (!this.alive) return;
    this.hp -= amount;
    this.flash.trigger();
    this.ctx.effects?.blood(new THREE.Vector3(this.root.position.x, this.root.position.y + this.hitHeight, this.root.position.z));
    if (this.hp <= 0) this.die(dir);
    else this.onHit(dir, source);
  }

  /** Reação ao golpe (fugir, atacar…). Sobrescrito pelas subclasses. */
  onHit() {}

  /** Tabela de drops: [[id, n], ...]. Sobrescrito pelas subclasses. */
  dropTable() { return [['raw_meat', 1 + Math.floor(Math.random() * 3)]]; }

  die(dir) {
    events.emit('kill', { target: this.species || (this.constructor.name === 'Alligator' ? 'alligator' : 'animal'), hostile: this.constructor.name === 'Alligator' });
    this.alive = false;
    this.dying = true;
    this.deathT = 0;
    this.respawnT = RESPAWN;
    this.deathDir = dir ? Math.sign(dir.x || 1) : 1;
    const p = this.root.position;
    for (const [id, n] of this.dropTable()) this.ctx.drops?.spawn(id, n, new THREE.Vector3(p.x, p.y + 0.5, p.z));
  }

  /** Anima a morte e cuida do respawn. Retorna true enquanto morto. */
  updateDeath(dt) {
    if (this.alive) return false;
    this.deathT += dt;
    if (this.root.visible) {
      this.root.rotation.z = Math.min(Math.PI / 2, this.deathT * 5) * this.deathDir;
      if (this.deathT > 2.5) this.root.visible = false;
      this.flash.update(dt);
      this.mixer?.update(dt * 0.3);
    }
    this.respawnT -= dt;
    if (this.respawnT <= 0) this.respawn();
    return true;
  }

  respawn() {
    this.root.visible = true;
    this.root.rotation.set(0, this.heading, 0);
    this.root.position.set(this.home.x, this.terrain.getHeight(this.home.x, this.home.z), this.home.z);
    this.hp = this.maxHp;
    this.alive = true;
    this.dying = false;
    this.state = 'idle';
    this.stateTimer = 2;
  }

  /** Cria um grupo-pivô nomeado (alvo das trilhas de animação). */
  pivot(name, parent, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.name = name; g.position.set(x, y, z);
    parent.add(g); this.nodes[name] = g;
    return g;
  }

  mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /**
   * Troca o visual procedural por um modelo animado (.glb aberto, ver CREDITS.md).
   * Normaliza o tamanho pelo eixo do corpo, põe os pés em y = 0 e cria um mixer próprio.
   * @param {object} o { size (m), axis: 'x'|'y'|'z', yaw (rad), center: bool }
   */
  async attachModel(url, { size = 1.5, axis = 'z', yaw = 0, center = false } = {}) {
    if (!glbCache.has(url)) glbCache.set(url, new GLTFLoader().loadAsync(url).catch((e) => { console.warn('fauna', url, e); return null; }));
    const gltf = await glbCache.get(url);
    if (!gltf) return;
    const model = SkeletonUtils.clone(gltf.scene);
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.frustumCulled = false; } });
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const wrap = new THREE.Group();
    const inner = new THREE.Group(); inner.add(model); wrap.add(inner);
    model.position.set(-c.x, center ? -c.y : -box.min.y, -c.z);
    inner.scale.setScalar(size / sz[axis] / this.root.scale.x);
    wrap.rotation.y = yaw;
    for (const ch of this.root.children) ch.visible = false;
    this.root.add(wrap);
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const clip of gltf.animations) { const a = mixer.clipAction(clip); a.play(); a.time = this.rand() * clip.duration; actions[clip.name] = a; }
    this.model = { mixer, actions, wrap, list: Object.values(actions) };
    this.flash = new HitFlash(this.root);
  }

  /** Pesos das animações do modelo por nome parcial (ex.: { Walk: 1 }). */
  modelWeights(w, dt, rate = 6) {
    for (const [name, a] of Object.entries(this.model.actions)) {
      const key = Object.keys(w).find((k) => name.includes(k));
      const target = key ? w[key] : 0;
      a.weight += (target - a.weight) * Math.min(1, dt * rate);
    }
  }

  setupAnimation(clips, initial) {
    this.mixer = new THREE.AnimationMixer(this.root);
    this.blend = new BlendSpace(this.mixer, clips);
    this.blend.setTargets({ [initial]: 1 });
    // Fase aleatória: animais iguais não ficam sincronizados
    for (const a of Object.values(this.blend.actions)) a.time = this.rand() * a.getClip().duration;
  }

  /** Sorteia um destino válido perto de `center`. */
  pickTarget(center, radius, tries = 14) {
    for (let i = 0; i < tries; i++) {
      const a = this.rand() * Math.PI * 2, r = radius * (0.3 + this.rand() * 0.7);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (this.isValid(x, z)) { this.target.set(x, 0, z); return true; }
    }
    return false;
  }

  /** Por padrão: terra firme e não íngreme. As subclasses sobrescrevem. */
  isValid(x, z) {
    return this.terrain.getHeight(x, z) > 1.5 && this.terrain.getSlope(x, z) < 0.45;
  }

  /**
   * Passo de steering: vira na direção do alvo e avança, checando o ponto à
   * frente (look-ahead). Retorna 'arrived' | 'blocked' | 'moving'.
   */
  steer(dt, speed, turnRate = 2.5, lookAhead = 3) {
    const p = this.root.position;
    const dx = this.target.x - p.x, dz = this.target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.5) return 'arrived';
    this.heading = dampAngle(this.heading, Math.atan2(dx, dz), turnRate, dt);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    if (!this.isValid(p.x + fx * lookAhead, p.z + fz * lookAhead)) return 'blocked';
    p.x += fx * speed * dt;
    p.z += fz * speed * dt;
    if (this.colliders && !this.colliders.isFree(p.x, p.z, 0.5)) {
      p.x -= fx * speed * dt; p.z -= fz * speed * dt;
      return 'blocked';
    }
    return 'moving';
  }

  update() {}
}
