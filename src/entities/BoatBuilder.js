/**
 * BoatBuilder.js
 * Estaleiro na margem da baía: o jogador entra no anel de construção, aperta E e
 * o navio vai sendo montado na água do canal (quilha → casco → mastros → velas).
 * A construção pausa se o jogador sair da área.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';

const STAGES = [
  [0.0, 'Assentando a quilha…'],
  [0.25, 'Fechando o casco e o convés…'],
  [0.55, 'Erguendo mastros e timão…'],
  [0.85, 'Içando as velas…'],
];

export class BoatBuilder {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./Boat.js').Boat} boat
   * @param {THREE.Vector3} zonePos posição do anel de construção (em terra)
   * @param {{x:number,z:number,heading:number}} spawn onde o navio nasce no canal
   */
  constructor(scene, boat, hud, zonePos, spawn) {
    this.boat = boat;
    this.hud = hud;
    this.zonePos = zonePos.clone();
    this.spawn = spawn;
    this.state = 'idle';       // idle | building | built
    this.progress = 0;
    this.radius = 6;

    // Anel brilhante + placa
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius * 0.6, 0.12, 8, 48),
      new THREE.MeshStandardNodeMaterial({ color: 0xffc860, emissive: 0xffa020, emissiveIntensity: 1.5 })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.copy(zonePos).add(new THREE.Vector3(0, 0.15, 0));
    scene.add(this.ring);

    const sign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), new THREE.MeshStandardNodeMaterial({ color: 0x5a3d26 }));
    post.position.y = 1.1;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.08), new THREE.MeshStandardNodeMaterial({ color: 0x8a6a42 }));
    board.position.y = 2.0;
    const anchorIcon = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 16, Math.PI), new THREE.MeshStandardNodeMaterial({ color: 0x222222 }));
    anchorIcon.rotation.z = Math.PI; anchorIcon.position.set(0, 1.95, 0.06);
    sign.add(post, board, anchorIcon);
    sign.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    sign.position.copy(zonePos).add(new THREE.Vector3(this.radius * 0.6 + 0.8, 0, 0));
    scene.add(sign);

    // Pilha de toras (cenografia do estaleiro)
    const logMat = new THREE.MeshStandardNodeMaterial({ color: 0x7a5232, roughness: 1 });
    for (let i = 0; i < 6; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4, 8), logMat);
      log.rotation.z = Math.PI / 2;
      log.position.copy(zonePos).add(new THREE.Vector3(-this.radius * 0.6 - 1.5, 0.25 + Math.floor(i / 3) * 0.45, (i % 3) * 0.55 - 0.5));
      log.castShadow = true;
      scene.add(log);
    }
  }

  /**
   * Item para o sistema de Interaction. Construir exige madeira do inventário.
   * @param {import('../game/Inventory.js').Inventory} inventory
   */
  interactable(inventory) {
    const cost = CONFIG.shipCombat.buildWood;
    return {
      getPosition: (out) => out.copy(this.zonePos),
      radius: this.radius,
      label: () => `E — Construir navio (madeira ${Math.min(inventory.count('wood'), cost)}/${cost})`,
      enabled: (ctx) => this.state === 'idle' && ctx.player.state === 'foot',
      interact: () => {
        if (!inventory.has('wood', cost)) {
          this.hud.toast(`Você precisa de ${cost} madeiras. Corte árvores com o machado!`, 3);
          return;
        }
        inventory.remove('wood', cost);
        this.start();
      },
    };
  }

  /** Libera o estaleiro para construir de novo (navio afundou). */
  reset() {
    this.state = 'idle';
    this.progress = 0;
    this.ring.visible = true;
    this.boat.reset();
  }

  start() {
    this.state = 'building';
    this.progress = 0;
    this.boat.placeAt(this.spawn.x, this.spawn.z, this.spawn.heading);
    this.boat.setBuildProgress(0);
  }

  update(dt, t, playerPos) {
    // Pulso do anel
    if (this.ring.visible) {
      const s = 1 + Math.sin(t * 3) * 0.05;
      this.ring.scale.set(s, s, 1);
    }

    if (this.state !== 'building') return;

    const inside = playerPos.distanceTo(this.zonePos) < this.radius * 1.8;
    if (inside) this.progress = Math.min(1, this.progress + dt / CONFIG.boat.buildTime);

    let label = STAGES[0][1];
    for (const [th, txt] of STAGES) if (this.progress >= th) label = txt;
    this.hud.setProgress(this.progress, inside ? label : 'Construção pausada — volte ao estaleiro');
    this.boat.setBuildProgress(this.progress);

    if (this.progress >= 1) {
      this.state = 'built';
      this.ring.visible = false;
      this.hud.setProgress(null);
      this.hud.toast('Navio pronto! Suba pela prancha do cais e aperte E para embarcar.', 4);
    }
  }
}
