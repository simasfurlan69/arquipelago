/**
 * Village.js
 * Vila no platô da ilha principal, com:
 *  - forja (galpão aberto, fornalha com brasas e luz pulsante, bigorna, barril);
 *  - salão da guilda (fundação de pedra, colunas, estandartes dourados, púlpito
 *    com o livro de missões);
 *  - casas, poço;
 *  - cais/estaleiro gerado automaticamente na margem do canal mais próxima.
 * Expõe os spawn points dos NPCs, do jogador, do estaleiro e do navio.
 */
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { pbr } from './PBRMaterials.js';
import { G } from '../vendor/tidewater/core/Globals.js';
import { color } from 'three/tsl';

/** Vidro de janela: escuro de dia, luz quente de lamparina à noite. */
function windowMat() {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x1a2228, roughness: 0.15, metalness: 0.1 });
  m.emissiveNode = color(0xffa850).mul(G.night.mul(2.6).add(0.04));
  return m;
}

const W = CONFIG.world;

const mat = (color, o = {}) => new THREE.MeshStandardNodeMaterial({ color, roughness: 0.9, ...o });

export class Village {
  constructor(scene, terrain, colliders) {
    this.scene = scene;
    this.terrain = terrain;
    this.colliders = colliders;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.spots = {};

    this.M = {
      wall: pbr('plaster', 0xf2e8d4, 2.4), wood: pbr('planks', 0xd8b090, 1.6), darkWood: pbr('planks', 0x6a4a34, 1.3),
      roof: pbr('roof', 0xffffff, 2.2), roofBlue: pbr('roof', 0x7a96c0, 2.2), stone: pbr('castle', 0xd0c8b8, 2.0),
      beam: pbr('wood', 0x4a3020, 0.9), glass: windowMat(), cobble: pbr('cobble', 0xe0d8c8, 3),
      ember: mat(0xff6a1a, { emissive: 0xff5a10, emissiveIntensity: 3 }),
      iron: mat(0x2b2b2e, { metalness: 0.7, roughness: 0.45 }),
      gold: mat(0xd9a63a, { metalness: 0.6, roughness: 0.3, emissive: 0x3b2706 }),
      banner: mat(0x6a1f2b, { side: THREE.DoubleSide }),
      water: mat(0x2c6e8a, { roughness: 0.1 }),
    };
  }

  build() {
    this._buildDock();
    const v = W.village;
    this._buildForge(v.x - 30, v.z + 15, 0.35);
    this._buildGuildHall(v.x + 32, v.z + 25, -0.25);
    this._house(v.x, v.z + 45, 7, 6, 4, 0.1, this.M.roof);
    this._house(v.x - 25, v.z + 43, 6, 5, 3.6, 0.5, this.M.roofBlue);
    this._house(v.x + 48, v.z - 15, 6, 6, 3.8, -0.6, this.M.roof);
    this._well(v.x + 2, v.z + 8);
    this._plaza(v.x + 2, v.z + 8, 16);
    this._props(v);
  }

  /** Praça de pedra que segue o relevo (malha amostrada da altura do terreno). */
  _plaza(cx, cz, r) {
    const geo = new THREE.CircleGeometry(r, 48, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    // subdivide em anéis para seguir o terreno
    const rings = 10, seg = 48, verts = [], idx = [];
    for (let i = 0; i <= rings; i++) for (let j = 0; j <= seg; j++) {
      const rr = (i / rings) * r, a = (j / seg) * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      verts.push(x, this._y(cx + x, cz + z) + 0.06, z);
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    void p;
    const m = new THREE.Mesh(g, this.M.cobble);
    m.position.set(cx, 0, cz);
    m.receiveShadow = true;
    this.group.add(m);
  }

  /** Barris, caixotes, lanternas em postes e bancos espalhados pela vila. */
  _props(v) {
    const barrelGeo = new THREE.LatheGeometry([0, 0.36, 0.42, 0.44, 0.42, 0.36, 0].map((r, i, a) => new THREE.Vector2(Math.max(0.001, r), i / (a.length - 1) * 0.95)), 12);
    const lampMat = new THREE.MeshStandardNodeMaterial({ color: 0x221a10, roughness: 0.4 });
    lampMat.emissiveNode = color(0xffb050).mul(G.night.mul(3).add(0.1));
    const spots = [[8, 2], [10, 3], [-6, 18], [-8, 20], [20, 10], [-14, -4], [26, 38], [-20, 36]];
    spots.forEach(([dx, dz], i) => {
      const x = v.x + dx, z = v.z + dz, y = this._y(x, z);
      if (i % 2 === 0) { this._add(new THREE.Mesh(barrelGeo, this.M.wood), x, y, z); this._add(new THREE.Mesh(barrelGeo, this.M.wood), x + 0.9, y, z + 0.3); }
      else { const c = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), this.M.darkWood); this._add(c, x, y + 0.4, z, i); }
    });
    // postes com lanterna ao redor da praça
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, x = v.x + 2 + Math.cos(a) * 17, z = v.z + 8 + Math.sin(a) * 17, y = this._y(x, z);
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6), this.M.beam), x, y + 1.6, z);
      this._add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.6), this.M.beam), x, y + 3.1, z + 0.25);
      this._add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.36, 6), lampMat), x, y + 2.85, z + 0.5);
      this.colliders.addCircle(x, z, 0.3, 3.3);
    }
  }

  _y(x, z) { return this.terrain.getHeight(x, z); }

  _add(mesh, x, y, z, ry = 0) {
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Telhado de duas águas (prisma triangular extrudado). */
  _gableRoof(w, d, rh, material) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 - 0.5, 0); s.lineTo(w / 2 + 0.5, 0); s.lineTo(0, rh); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: d + 1, bevelEnabled: false });
    geo.translate(0, 0, -(d + 1) / 2);
    return new THREE.Mesh(geo, material);
  }

  _house(x, z, w, d, h, ry, roofMat) {
    const y = this._y(x, z);
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.M.wall);
    walls.position.y = h / 2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.6, d + 0.4), this.M.stone);
    base.position.y = 0.0;
    const roof = this._gableRoof(w, d, h * 0.6, roofMat);
    roof.position.y = h;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.1), this.M.darkWood);
    door.position.set(0, 1.05, d / 2 + 0.03);
    const B = this.M.beam;
    const beam = (bw, bh, bd, px, py, pz, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), B); m.position.set(px, py, pz); m.rotation.z = rz; g.add(m); };
    // enxaimel: pilares nos cantos, frechal e travessas diagonais (frente e fundos)
    for (const sz of [-1, 1]) {
      const zf = sz * (d / 2 + 0.06);
      for (const sx of [-1, 1]) beam(0.22, h, 0.12, sx * (w / 2 - 0.05), h / 2, zf);
      beam(w, 0.2, 0.12, 0, h - 0.1, zf); beam(w, 0.18, 0.12, 0, h * 0.42, zf);
      for (const sx of [-1, 1]) beam(0.14, Math.hypot(w * 0.25, h * 0.42) , 0.1, sx * w * 0.36, h * 0.21, zf, sx * Math.atan2(w * 0.25, h * 0.42));
    }
    for (const sx of [-1, 1]) { const zf = 0; void zf; beam(0.12, h, 0.22, sx * (w / 2 + 0.06), h / 2, d / 2 - 0.05); beam(0.12, h, 0.22, sx * (w / 2 + 0.06), h / 2, -d / 2 + 0.05); }
    // janelas com vidro (acende à noite), moldura, peitoril e venezianas
    for (const sx of [-1, 1]) {
      const wx = sx * w * 0.3, wy = h * 0.62;
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.85, 0.06), this.M.glass); win.position.set(wx, wy, d / 2 + 0.04); g.add(win);
      beam(0.95, 0.09, 0.14, wx, wy + 0.47, d / 2 + 0.08); beam(1.0, 0.09, 0.22, wx, wy - 0.47, d / 2 + 0.1);
      beam(0.07, 0.85, 0.12, wx, wy, d / 2 + 0.08);
      for (const k of [-1, 1]) { const sh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 0.05), roofMat === this.M.roofBlue ? mat(0x2f5a3a) : mat(0x3a5a7a)); sh.position.set(wx + k * 0.66, wy, d / 2 + 0.12); sh.rotation.y = k * 0.5; g.add(sh); }
    }
    // chaminé de pedra
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.8, h * 0.9, 0.8), this.M.stone); chim.position.set(w * 0.28, h + h * 0.3, -d * 0.2); g.add(chim);
    const chimTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.15, 1.0), this.M.stone); chimTop.position.set(w * 0.28, h + h * 0.75, -d * 0.2); g.add(chimTop);
    // varanda: degraus e alpendre sobre a porta
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 0.7), this.M.stone); step.position.set(0, 0.2, d / 2 + 0.45); g.add(step);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.2), roofMat); awning.position.set(0, 2.55, d / 2 + 0.6); awning.rotation.x = 0.25; g.add(awning);
    for (const sx of [-1, 1]) beam(0.1, 2.5, 0.1, sx * 1.0, 1.25, d / 2 + 1.1);
    g.add(walls, base, roof, door);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    g.position.set(x, y - 0.1, z);
    g.rotation.y = ry;
    this.group.add(g);
    this.colliders.addBox(x, z, w, d, ry);
    return g;
  }

  _well(x, z) {
    const y = this._y(x, z);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 14, 1, true), this.M.stone);
    ring.material.side = THREE.DoubleSide;
    this._add(ring, x, y + 0.45, z);
    this._add(new THREE.Mesh(new THREE.CircleGeometry(1.0, 14).rotateX(-Math.PI / 2), this.M.water), x, y + 0.3, z);
    for (const sx of [-1, 1]) this._add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 0.15), this.M.wood), x + sx * 1.05, y + 1.1, z);
    const roof = this._gableRoof(2.2, 1.6, 0.8, this.M.roof);
    this._add(roof, x, y + 2.2, z, Math.PI / 2);
    this.colliders.addCircle(x, z, 1.3, 3.2);
  }

  // ---------------------------------------------------------------------------
  // Forja
  // ---------------------------------------------------------------------------
  _buildForge(x, z, ry) {
    const y = this._y(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = ry;
    const M = this.M;
    const put = (mesh, px, py, pz) => { mesh.position.set(px, py, pz); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };

    // Galpão aberto: 4 postes e telhado
    for (const [px, pz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) put(new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.6, 0.3), M.wood), px, 1.8, pz);
    const roof = this._gableRoof(8.6, 6.6, 2.2, M.roof);
    roof.rotation.y = Math.PI / 2; put(roof, 0, 3.6, 0);
    put(new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 7), M.stone), 0, 0.05, 0);

    // Fornalha de pedra com chaminé e boca incandescente
    put(new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.2), M.stone), 0, 1.1, -2.2);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 5, 8), M.stone), 0, 4.2, -2.4);
    put(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.1), M.ember), 0, 1.0, -1.08);
    put(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 1.6), M.ember), 0, 2.25, -2.2);

    // Bigorna
    put(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), M.darkWood), 0.8, 0.3, 0.8);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.9), M.iron), 0.8, 0.75, 0.8);
    const horn = put(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 8), M.iron), 0.8, 0.8, 1.45);
    horn.rotation.x = Math.PI / 2;

    // Barril de têmpera e ferramentas penduradas
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.45, 0.9, 12), M.wood), -2.6, 0.45, 1.6);
    put(new THREE.Mesh(new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2), M.water), -2.6, 0.88, 1.6);
    for (let i = 0; i < 4; i++) put(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), M.iron), -3.85, 2.2, -1.5 + i * 0.5);

    // Luz da forja (pisca no update)
    this.forgeLight = new THREE.PointLight(0xff7a2a, 40, 16, 2);
    this.forgeLight.position.set(0, 1.6, -0.6);
    g.add(this.forgeLight);

    this.group.add(g);
    g.updateMatrixWorld(true);

    // Colisores: fornalha, bigorna, barril
    const w = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
    const f = w(0, -2.2), a = w(0.8, 0.8), b = w(-2.6, 1.6);
    this.colliders.addCircle(f.x, f.z, 1.7);
    this.colliders.addCircle(a.x, a.z, 0.5, 1.1);
    this.colliders.addCircle(b.x, b.z, 0.55, 1.3);

    // Spawn do ferreiro: atrás da bigorna, de frente para fora
    const npc = w(0.8, -0.1);
    this.spots.blacksmith = { position: new THREE.Vector3(npc.x, this._y(npc.x, npc.z), npc.z), facing: ry };
  }

  // ---------------------------------------------------------------------------
  // Salão da Guilda
  // ---------------------------------------------------------------------------
  _buildGuildHall(x, z, ry) {
    const y = this._y(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = ry;
    const M = this.M;
    const put = (mesh, px, py, pz) => { mesh.position.set(px, py, pz); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };

    const Wd = 16, D = 12, H = 6.5;
    put(new THREE.Mesh(new THREE.BoxGeometry(Wd + 1, 1.0, D + 5), M.stone), 0, 0.2, 2);       // fundação + varanda
    put(new THREE.Mesh(new THREE.BoxGeometry(Wd, H, D), M.wall), 0, 0.7 + H / 2, -0.5);
    const roof = this._gableRoof(Wd, D + 4, 4, M.roofBlue);
    roof.position.z = 1.5; put(roof, 0, 0.7 + H, 1.5);

    // Colunas da varanda
    for (let i = 0; i < 5; i++) put(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, H, 10), M.wall), -6 + i * 3, 0.7 + H / 2, 7.3);
    // Portal duplo
    put(new THREE.Mesh(new THREE.BoxGeometry(3, 3.6, 0.15), M.darkWood), 0, 0.7 + 1.8, 5.55);
    put(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 0.2), M.gold), 0, 0.7 + 3.7, 5.6);

    // Estandartes com emblema dourado
    for (const sx of [-1, 1]) {
      put(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.2), M.banner), sx * 4.5, 0.7 + 3.6, 5.6);
      const emblem = put(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.08, 6, 16), M.gold), sx * 4.5, 0.7 + 4.1, 5.63);
      emblem.rotation.y = 0;
      put(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.05), M.gold), sx * 4.5, 0.7 + 2.05, 5.62);
    }

    // Placa "GUILDA" (barra dourada sobre o portal)
    put(new THREE.Mesh(new THREE.BoxGeometry(5, 0.9, 0.2), M.darkWood), 0, 0.7 + 5.4, 5.6);
    put(new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.5, 0.05), M.gold), 0, 0.7 + 5.4, 5.72);

    // Púlpito com livro de missões e pergaminhos
    const lec = new THREE.Vector3(2.6, 0.7, 6.4);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.7), M.darkWood), lec.x, lec.y + 0.55, lec.z);
    const top = put(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.8), M.wood), lec.x, lec.y + 1.15, lec.z);
    top.rotation.x = -0.3;
    for (let i = 0; i < 3; i++) {
      const scroll = put(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), mat(0xe8dcb5)), lec.x - 0.25 + i * 0.25, lec.y + 1.25, lec.z + 0.1);
      scroll.rotation.z = Math.PI / 2; scroll.rotation.y = i * 0.3;
    }

    this.group.add(g);
    g.updateMatrixWorld(true);
    this.colliders.addBox(x, z, Wd, D, ry);
    const w = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
    const fc = w(0, 2);   // fundação/varanda é caminhável
    this.colliders.addPlatform(fc.x, fc.z, (Wd + 1) / 2, (D + 5) / 2, ry, y + 0.7);
    const l = w(lec.x, lec.z);
    this.colliders.addCircle(l.x, l.z, 0.6, 2.2);
    for (let i = 0; i < 5; i++) { const c = w(-6 + i * 3, 7.3); this.colliders.addCircle(c.x, c.z, 0.4); }

    const npc = w(1.4, 6.6);
    this.spots.guild = { position: new THREE.Vector3(npc.x, this._y(npc.x, npc.z) + 0.7, npc.z), facing: ry };
  }

  // ---------------------------------------------------------------------------
  // Cais na margem do canal (posição calculada a partir do terreno)
  // ---------------------------------------------------------------------------
  _buildDock() {
    const t = this.terrain;
    const v = W.village;
    const { point: cp, tangent } = t.nearestCanalPoint(v.x, v.z);

    // Normal da margem apontando para a vila
    let n = new THREE.Vector3(-tangent.z, 0, tangent.x);
    if (n.dot(new THREE.Vector3(v.x - cp.x, 0, v.z - cp.z)) < 0) n.negate();

    // Marcha do centro do canal até a terra firme
    let s = 0;
    while (s < 80 && t.getHeight(cp.x + n.x * s, cp.z + n.z * s) < 0.6) s += 0.5;
    const bank = cp.clone().addScaledVector(n, s);

    const L = Math.max(8, Math.min(14, s - 10));
    const ang = Math.atan2(n.x, n.z);                   // eixo local +Z → n
    const center = bank.clone().addScaledVector(n, -(L / 2) + 3);
    const top = 1.25;

    const dock = new THREE.Group();
    dock.position.set(center.x, 0, center.z);
    dock.rotation.y = ang;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, L + 3), this.M.wood);
    deck.position.y = top - 0.12;
    deck.castShadow = deck.receiveShadow = true;
    dock.add(deck);
    for (let zz = -(L + 3) / 2 + 0.5; zz <= (L + 3) / 2; zz += 2.5) {
      for (const sx of [-1.45, 1.45]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8, 6), this.M.darkWood);
        post.position.set(sx, top - 4, zz);
        post.castShadow = true;
        dock.add(post);
      }
    }
    this.group.add(dock);
    this.colliders.addPlatform(center.x, center.z, 1.6, (L + 3) / 2, ang, top);

    // Estaleiro em terra, navio no canal ao lado do cais
    const zone = bank.clone().addScaledVector(n, 8);
    zone.y = t.getHeight(zone.x, zone.z);
    // Navio nasce encostado na ponta do cais (costado a ~1 m), sem sair da parte funda do canal
    const tipOff = s - L + 1.5;                          // ponta do cais, medida a partir do centro do canal
    const boatOff = Math.max(0, Math.min(8, tipOff - 3.8));
    const boatPos = cp.clone().addScaledVector(n, boatOff);

    // Prancha cais → convés (aparece quando o navio fica pronto) e é caminhável
    const plankLen = Math.max(1.5, tipOff - (boatOff + 2.6) + 0.6);
    const plankMid = cp.clone().addScaledVector(n, tipOff - plankLen / 2 + 0.3);
    const plank = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, plankLen), this.M.wood);
    board.castShadow = board.receiveShadow = true;
    plank.add(board);
    for (const sx of [-0.62, 0.62]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, plankLen), this.M.darkWood);
      rail.position.set(sx, 0.55, 0);
      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 5), this.M.darkWood);
      p1.position.set(sx, 0.27, -plankLen / 2 + 0.2);
      plank.add(rail, p1);
    }
    plank.position.set(plankMid.x, top + 0.02, plankMid.z);
    plank.rotation.y = ang;
    plank.visible = false;
    this.group.add(plank);
    this.plank = plank;
    this._plankPlatform = { cx: plankMid.x, cz: plankMid.z, halfW: 0.7, halfL: plankLen / 2, ang, top: top + 0.08 };
    this.spots.buildZone = zone;
    this.spots.boatSpawn = { x: boatPos.x, z: boatPos.z, heading: Math.atan2(-tangent.x, -tangent.z) };   // proa para o mar
    const ps = bank.clone().addScaledVector(n, 14).addScaledVector(tangent, 5);
    this.spots.playerSpawn = { x: ps.x, z: ps.z };
  }

  /** Mostra/esconde a prancha de embarque (navio pronto e atracado). */
  setPlank(on) {
    if (!this.plank || this.plank.visible === on) return;
    this.plank.visible = on;
    const p = this._plankPlatform;
    if (on) this.colliders.addPlatform(p.cx, p.cz, p.halfW, p.halfL, p.ang, p.top);
    else this.colliders.platforms = this.colliders.platforms.filter((q) => !(q.cx === p.cx && q.cz === p.cz));
  }

  update(dt, t) {
    if (this.forgeLight) {
      this.forgeLight.intensity = 34 + Math.sin(t * 13) * 5 + Math.sin(t * 7.3) * 4 + Math.random() * 4;
    }
  }
}
