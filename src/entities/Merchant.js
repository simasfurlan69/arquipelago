/**
 * Merchant.js
 * Comerciantes (E para abrir a loja):
 *  - Tomas, o Mercador: barraca na vila, aberto sempre. Vende armas à distância,
 *    munição e comida; compra itens comuns.
 *  - Silas, o Contrabandista: aparece só à noite no cais. Compra contrabando
 *    (drogas) por preço alto e vende café e munição mais cara.
 */
import * as THREE from 'three/webgpu';
import { buildHumanoid, createHumanoidClips } from './HumanoidRig.js';
import { createSkinMaterial, createClothMaterial, createGoldMaterial } from './CharacterMaterials.js';
import { BlendSpace } from '../utils/AnimUtils.js';
import { dampAngle } from '../utils/Noise.js';

export const SHOPS = {
  tomas: {
    name: 'Tomas, o Mercador',
    greeting: 'Bem-vindo! Armas à distância só aqui comigo — ninguém fabrica isso na ilha.',
    sells: [['lantern', 1], ['bow', 1], ['arrow', 16], ['pistol', 1], ['ammo_pistol', 16], ['rifle', 1], ['ammo_rifle', 20],
      ['bread', 1], ['cheese', 1], ['hamburger', 1], ['cookie', 1], ['coffee', 1], ['water', 1]],
    buysContraband: false,
  },
  silas: {
    name: 'Silas, o Contrabandista',
    greeting: '...psst. Tem algo "especial" para vender? Eu pago bem. Ninguém precisa saber.',
    sells: [['coffee', 1], ['ammo_pistol', 16], ['ammo_rifle', 20], ['water', 1]],
    priceMult: 1.3,
    buysContraband: true,
  },
};

export class Merchant {
  constructor(scene, { id, position, facing, night = false, colliders }) {
    this.id = id;
    this.shop = SHOPS[id];
    this.name = this.shop.name;
    this.night = night;
    this.facing = this.baseFacing = facing;
    const mats = id === 'tomas'
      ? { skin: createSkinMaterial({ tone: 0xc89070 }), shirt: createClothMaterial(0x2e6a3a), pants: createClothMaterial(0x3a2e22), boots: createClothMaterial(0x1e1510) }
      : { skin: createSkinMaterial({ tone: 0xa87a5a }), shirt: createClothMaterial(0x18181e), pants: createClothMaterial(0x101014), boots: createClothMaterial(0x0a0a0a) };
    const { root, nodes } = buildHumanoid(mats, { bulk: id === 'tomas' ? 1.2 : 0.95, coatLength: id === 'silas' ? 0.9 : 0, hair: id === 'tomas' ? 0x5a3a1a : 0x0a0a0a });
    if (id === 'tomas') {
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 14), createClothMaterial(0x8a6a3a)); hat.position.y = 0.2; nodes.head.add(hat);
      const purse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), createGoldMaterial()); purse.position.set(0.18, -0.1, 0.1); nodes.hips.add(purse);
    } else {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10, 0, 6.3, 0, 1.9), createClothMaterial(0x101014)); hood.position.y = 0.1; nodes.head.add(hood);
      const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), new THREE.MeshStandardNodeMaterial({ color: 0xffb040, emissive: 0xff9020, emissiveIntensity: 3 })); lantern.position.set(0, -0.3, 0.1); nodes.handL.add(lantern);
    }
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    root.position.copy(position);
    root.rotation.y = facing;
    scene.add(root);
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    const c = createHumanoidClips();
    this.blend = new BlendSpace(this.mixer, [c.idle]);
    this.blend.setTargets({ idle: 1 });
    if (id === 'tomas') this._stall(scene, position, facing, colliders);
  }

  /** Barraca de feira com toldo listrado e caixotes. */
  _stall(scene, p, facing, colliders) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardNodeMaterial({ color: 0x6b4428, roughness: 0.9 });
    const cloth = new THREE.MeshStandardNodeMaterial({ color: 0xc8342a, roughness: 0.9, side: THREE.DoubleSide });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1, 0.8), wood); counter.position.set(0, 0.5, 1.1); g.add(counter);
    for (const x of [-1.6, 1.6]) for (const z of [0.7, -0.6]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), wood); post.position.set(x, 1.3, z); g.add(post); }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8, 6, 1), cloth); roof.rotation.x = -Math.PI / 2 + 0.25; roof.position.set(0, 2.6, 0.1); g.add(roof);
    for (let i = 0; i < 3; i++) { const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), wood); crate.position.set(-1 + i * 0.9, 1.25, 1.1); crate.rotation.y = i * 0.4; g.add(crate); }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.copy(p); g.rotation.y = facing;
    scene.add(g);
    g.updateMatrixWorld(true);
    const c = new THREE.Vector3(0, 0, 1.1).applyMatrix4(g.matrixWorld);
    colliders?.addBox(c.x, c.z, 3.2, 0.8, facing, 2.8);
  }

  get visible() { return this.root.visible; }

  interactable(openShop) {
    return {
      getPosition: (out) => out.copy(this.root.position),
      radius: 4.5,
      label: () => `E — Negociar com ${this.name}`,
      enabled: (ctx) => this.root.visible && ctx.player.state === 'foot',
      interact: () => openShop(this),
    };
  }

  update(dt, playerPos, isNight) {
    if (this.night) this.root.visible = isNight;
    if (!this.root.visible) return;
    const dx = playerPos.x - this.root.position.x, dz = playerPos.z - this.root.position.z;
    const near = dx * dx + dz * dz < 64;
    this.facing = dampAngle(this.facing, near ? Math.atan2(dx, dz) : this.baseFacing, 4, dt);
    this.root.rotation.y = this.facing;
    this.blend.update(dt, 4);
  }
}
