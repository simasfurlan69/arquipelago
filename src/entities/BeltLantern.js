/**
 * BeltLantern.js
 * Lanterna de óleo pendurada na cintura do personagem (lado esquerdo do quadril).
 *
 * Movimento realista: é um pêndulo esférico de verdade, preso a um gancho no
 * cinto. A cada frame mede-se a aceleração do gancho em espaço de mundo
 * (andar, correr, virar, pular, o navio balançando) e ela empurra a lanterna,
 * que oscila sob a gravidade com amortecimento e trava no limite do gancho.
 * A alça gira junto, a chama tremula e a luz acompanha a lanterna.
 *
 * Tecla L acende/apaga. Liga sozinha ao anoitecer (se o jogador quiser).
 */
import * as THREE from 'three/webgpu';

const G = 9.81;
const LEN = 0.17;          // m: do gancho ao centro da lanterna
const DAMP = 4.2;          // amortecimento (ar + atrito do gancho + contato com a coxa)
const MAX_SWING = 0.8;     // rad: limite (a lanterna bate na perna)

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0), _dir = new THREE.Vector3();

export class BeltLantern {
  /**
   * @param {THREE.Object3D} hips  osso do quadril (mixamorigHips)
   * @param {THREE.Object3D} root  raiz do personagem
   */
  constructor(hips, root) {
    this.root = root;
    root.updateMatrixWorld(true);

    // ---- Gancho no cinto (filho do quadril, escala compensada do rig em cm) ----
    this.hook = new THREE.Group();
    this.hook.name = 'BeltLanternHook';
    const rootScale = root.getWorldScale(new THREE.Vector3()).x;
    this.hook.scale.setScalar(rootScale / hips.getWorldScale(new THREE.Vector3()).x);
    // posição: lado esquerdo do quadril, um pouco à frente (definida em espaço do corpo)
    const hipW = hips.getWorldPosition(new THREE.Vector3());
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    const local = new THREE.Vector3(0.2, -0.04, 0.06).applyQuaternion(rq).add(hipW);
    this.hook.position.copy(hips.worldToLocal(local));
    hips.add(this.hook);

    // ---- Pivô que balança (orientado em espaço de mundo a cada frame) ----
    this.pivot = new THREE.Group();
    this.hook.add(this.pivot);
    this._build();

    // estado do pêndulo: vetor de inclinação (x,z) em mundo e sua velocidade
    this.swing = new THREE.Vector2();
    this.swingVel = new THREE.Vector2();
    this.spin = 0; this.spinVel = 0;
    this._prevPos = null; this._prevVel = new THREE.Vector3(); this._vel = new THREE.Vector3();
    this.on = false;
    this.flicker = 0;
    this.setOn(false);
  }

  _build() {
    const brass = new THREE.MeshStandardNodeMaterial({ color: 0xb8893a, metalness: 0.85, roughness: 0.35 });
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x2a2420, metalness: 0.6, roughness: 0.5 });
    this.glassMat = new THREE.MeshStandardNodeMaterial({ color: 0xfff1c8, emissive: 0xffa040, emissiveIntensity: 0, transparent: true, opacity: 0.55, roughness: 0.1 });
    this.flameMat = new THREE.MeshBasicNodeMaterial({ color: 0xffb040 });
    const add = (geo, mat, y, parent = this.pivot) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; parent.add(m); return m; };

    // alça (aro) presa ao gancho
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 16, Math.PI), dark);
    handle.position.y = -0.03; handle.rotation.z = Math.PI;
    this.pivot.add(handle);
    // corpo: tampa, vidro, grades, base (centro em -LEN)
    const c = -LEN;
    add(new THREE.ConeGeometry(0.045, 0.04, 8), brass, c + 0.075);
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 8), brass, c + 0.052);
    this.glass = add(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 12, 1, true), this.glassMat, c);
    for (let i = 0; i < 4; i++) {
      const bar = add(new THREE.BoxGeometry(0.005, 0.095, 0.005), dark, c);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      bar.position.x = Math.cos(a) * 0.037; bar.position.z = Math.sin(a) * 0.037;
    }
    add(new THREE.CylinderGeometry(0.042, 0.038, 0.02, 10), brass, c - 0.055);
    // chama
    this.flame = add(new THREE.ConeGeometry(0.012, 0.035, 8), this.flameMat, c - 0.005);
    // luz quente (sem sombra: barata e sem custo de shadow map)
    this.light = new THREE.PointLight(0xffa850, 0, 16, 1.6);
    this.light.position.y = c;
    this.light.castShadow = false;
    this.pivot.add(this.light);
  }

  setOn(on) {
    this.on = on;
    this.flame.visible = on;
    this.glassMat.emissiveIntensity = on ? 1.6 : 0;
  }
  toggle() { this.setOn(!this.on); return this.on; }

  /**
   * @param {number} dt
   * @param {boolean} night para ajustar a intensidade (de dia a luz quase não aparece)
   */
  update(dt, night) {
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 30);
    this.hook.updateWorldMatrix(true, false);
    this.hook.getWorldPosition(_p);

    // ---- aceleração do gancho (diferença finita, suavizada) ----
    if (!this._prevPos) { this._prevPos = _p.clone(); }
    this._vel.subVectors(_p, this._prevPos).divideScalar(dt);
    if (this._vel.lengthSq() > 400) this._vel.set(0, 0, 0);          // teletransporte: ignora
    // filtro passa-baixa: o osso do quadril treme a cada passo; o gancho de couro absorve parte disso
    this._acc ??= new THREE.Vector3();
    this._acc.lerp(_dir.subVectors(this._vel, this._prevVel).divideScalar(dt).clampLength(0, 40), 1 - Math.exp(-dt * 14));
    const acc = this._acc;
    this._prevVel.lerp(this._vel, 0.6);
    this._prevPos.copy(_p);

    // ---- pêndulo esférico (aproximação de pequenos ângulos com limite) ----
    // a inércia empurra a lanterna para o lado oposto da aceleração horizontal;
    // aceleração vertical (passos, pulo) muda a "gravidade aparente"
    const gEff = Math.max(2, G + acc.y);
    const k = gEff / LEN;
    for (const [ax, a] of [['x', acc.x], ['y', acc.z]]) {
      const th = this.swing[ax];
      const angAcc = -k * Math.sin(th) - (a / LEN) * Math.cos(th) - DAMP * this.swingVel[ax];
      this.swingVel[ax] += angAcc * dt;
      this.swing[ax] += this.swingVel[ax] * dt;
      if (Math.abs(this.swing[ax]) > MAX_SWING) { this.swing[ax] = Math.sign(this.swing[ax]) * MAX_SWING; this.swingVel[ax] *= -0.3; }
    }
    // pequeno giro em torno do fio (torção), alimentado pela velocidade lateral
    this.spinVel += (-this.spin * 6 - this.spinVel * 1.2 + (this.swingVel.x - this.swingVel.y) * 0.4) * dt;
    this.spin += this.spinVel * dt;

    // ---- orientação de mundo: "baixo" inclinado pelos ângulos do pêndulo ----
    _dir.set(Math.sin(this.swing.x), -Math.cos(this.swing.x) * Math.cos(this.swing.y), Math.sin(this.swing.y)).normalize();
    _q.setFromUnitVectors(_down, _dir);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(_down, this.spin));
    this.hook.getWorldQuaternion(_qp);
    this.pivot.quaternion.copy(_qp.invert().multiply(_q));

    // ---- chama e luz ----
    if (this.on) {
      this.flicker += dt;
      const f = 0.85 + Math.sin(this.flicker * 23) * 0.06 + Math.sin(this.flicker * 37.3) * 0.05 + (Math.random() - 0.5) * 0.08;
      this.light.intensity = (night ? 9 : 2.5) * f;
      this.flame.scale.set(1, f * 1.1, 1);
      // a chama tende a ficar em pé: inclina contra o balanço
      this.flame.rotation.set(-this.swing.y * 0.4, 0, this.swing.x * 0.4);
    } else this.light.intensity = 0;
  }
}
