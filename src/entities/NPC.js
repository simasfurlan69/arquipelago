/**
 * NPC.js
 * NPCs principais com visual detalhado e animação procedural por estados:
 *
 *   work  → trabalhando (Heitor escreve no caderno andando de um lado para o outro;
 *           Bruno martela uma faca em brasa na bigorna, com faíscas e som)
 *   wait  → o jogador chegou perto: para, vira e ENCARA o jogador, esperando a conversa
 *   talk  → conversa aberta: mandíbula acompanha o texto, cabeça acena, mão gesticula
 *   (o jogador se afasta por 1,5 s → volta a "work")
 *
 *  - Mestre Heitor (Guilda): casaco longo verde-acinzentado com bordados dourados, gola
 *    alta, pingente azul, cinto com pergaminhos e bolsa, caderno na mão esquerda e pena azul.
 *  - Bruno (Ferreiro): anão robusto, barba longa trançada, cicatriz, camisa cinza de mangas
 *    dobradas, avental de couro com fivela, braçadeiras com rebites, martelo e tenaz.
 */
import * as THREE from 'three/webgpu';
import { dampAngle } from '../utils/Noise.js';
import { createSkinMaterial } from './CharacterMaterials.js';
import { buildBody, lathe, mesh, fabric, embroidered, hairMaterial, metal } from './NPCBody.js';
import { color, mix, smoothstep, mx_noise_float, positionLocal, vec3 } from 'three/tsl';

const ease = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));
const put = (parent, child) => { parent.add(child); return child; };

export class NPC {
  /**
   * @param {object} o { kind: 'blacksmith'|'guild', name, spot: {position, facing}, dialog }
   */
  constructor(scene, { kind, name, spot, dialog }) {
    this.kind = kind;
    this.name = name;
    this.dialog = dialog;
    this.line = 0;
    this.baseFacing = spot.facing;
    this.facing = spot.facing;
    this.home = spot.position.clone();
    this.state = 'work';
    this.t = Math.random() * 10;
    this.awayT = 0;
    this.talking = false;
    this.pose = {};

    this.spawnPoint = new THREE.Object3D();
    this.spawnPoint.name = `spawn_${kind}`;
    this.spawnPoint.position.copy(spot.position);
    scene.add(this.spawnPoint);

    const built = kind === 'blacksmith' ? this._buildBlacksmith() : this._buildGuildMaster();
    this.root = built.root;
    this.nodes = built.nodes;
    this.root.position.copy(spot.position);
    this.root.rotation.y = this.facing;
    scene.add(this.root);
    // vaivém do Heitor: ao longo do eixo lateral do ponto (±2,2 m)
    this.side = new THREE.Vector3(Math.cos(spot.facing), 0, -Math.sin(spot.facing));
    this.pace = 0; this.paceDir = 1; this.paceWait = 0;
  }

  /** Liga efeitos/sons/colisores/diálogo (chamado pelo main depois de criar tudo). */
  attach({ effects, sfx, colliders, talkUI, groundAt }) { Object.assign(this, { effects, sfx, colliders, talkUI, groundAt }); }

  // ---------------------------------------------------------------------------
  // Visual
  // ---------------------------------------------------------------------------
  _buildGuildMaster() {
    // Mestre Heitor — referência: casaco longo de couro cinza-esverdeado com bordados
    // claros, gola alta verde, fecho de presilhas prateadas, pingente azul, cinto com
    // pergaminhos e bolsa, luvas, botas altas de couro marrom, cabelo curto grisalho.
    const face = createSkinMaterial({ tone: 0xc48e70, scale: 0.35, blood: [0.6, 0.3, 0.2], roughness: 0.5 });
    {
      // barba por fazer (queixo, buço e mandíbula)
      const pl = positionLocal;
      const stub = smoothstep(0.062, 0.045, pl.y).mul(smoothstep(-0.01, 0.05, pl.z)).mul(mx_noise_float(pl.mul(260)).mul(0.5).add(0.6));
      face.colorNode = mix(color(0xc48e70), color(0x7a6a60), stub.mul(0.35));
    }
    const coat = embroidered(0x6b7262, 0xc8b080, 0.45);
    const coatSleeve = embroidered(0x737a68, 0xd0b888, 0.7);
    const panel = embroidered(0x8a8670, 0xe0c890, 1.5);
    const glove = fabric(0x3e2a20, { rough: 0.5, bump: 0.15, scale: 120, wear: 0.25 });
    const brownLeather = fabric(0x6a4630, { rough: 0.55, bump: 0.2, scale: 70, wear: 0.35 });
    const B = buildBody({
      dims: { thigh: 0.47, shin: 0.44, foot: 0.07, torsoH: 0.57, shoulder: 0.205, upper: 0.29, fore: 0.26, W: 1.0, D: 1.0 },
      neckW: 1, armW: 1.0, legW: 1.0, footL: 1.0, handSize: 1.0, curl: 0.45, bootTop: 0.44,
      mats: { skin: face, face, torso: coat, sleeve: coatSleeve, forearm: coat, hand: glove, pants: brownLeather, boots: fabric(0x5a3a26, { rough: 0.45, bump: 0.25, scale: 50, wear: 0.4 }), sole: fabric(0x241a14, { rough: 0.9 }) },
      head: { r: 0.112, iris: 0x5a4a32, lip: 0xa0675a, brow: 1.0, jaw: 1.05, nose: 1.05, hairBrow: 0x4a4440 },
    });
    const n = B.nodes, U = B.head.U;
    this.hipY = B.hipY;
    const silver = metal(0xc0c4c8, 0.3);
    const darkGreen = fabric(0x2c4434, { rough: 0.7, bump: 0.18, scale: 90 });
    const parchment = fabric(0xe6d6aa, { rough: 0.9, bump: 0.1, scale: 40, wear: 0.15 });

    // saia do casaco (aberta na frente) até o meio da canela
    const skirt = mesh(lathe([[0.29, -0.66], [0.25, -0.42], [0.205, -0.16], [0.172, 0.0], [0.158, 0.12]], { sz: 0.74, phiStart: 0.32, phiLength: Math.PI * 2 - 0.64, segs: 32 }), coat);
    skirt.material.side = THREE.DoubleSide; n.hips.add(skirt);
    // barra interna do casaco (forro escuro aparece na abertura)
    const lining = mesh(lathe([[0.282, -0.655], [0.245, -0.42], [0.2, -0.16]], { sz: 0.72, phiStart: 0.3, phiLength: 0.5, segs: 6 }), darkGreen); lining.material.side = THREE.DoubleSide; n.hips.add(lining);
    // painel bordado do peito
    n.torso.add(mesh(lathe([[0.142, 0.02], [0.158, 0.18], [0.183, 0.32], [0.198, 0.43], [0.18, 0.5]].map(([r, y]) => [r + 0.006, y]), { sz: 0.68, phiStart: -0.75, phiLength: 1.5, segs: 12 }), panel));
    // presilhas prateadas (frog clasps)
    for (let i = 0; i < 4; i++) {
      const y = 0.43 - i * 0.085, z = 0.135 + (i === 0 ? 0.004 : 0);
      for (const sx of [-1, 1]) { const loop = mesh(new THREE.TorusGeometry(0.014, 0.0035, 6, 12), silver, sx * 0.022, y, z); n.torso.add(loop); }
      put(n.torso, mesh(new THREE.CapsuleGeometry(0.006, 0.03, 3, 8), silver, 0, y, z + 0.004)).rotation.z = Math.PI / 2;
    }
    // gola alta verde por dentro, couro por fora
    const collarIn = mesh(lathe([[0.072, 0.0], [0.076, 0.06], [0.084, 0.14]], { sz: 0.9, phiStart: 0.55, phiLength: Math.PI * 2 - 1.1 }), darkGreen); collarIn.material.side = THREE.DoubleSide;
    collarIn.position.y = 0.54; collarIn.scale.y = 0.75; n.torso.add(collarIn);
    const collarOut = mesh(lathe([[0.1, -0.02], [0.092, 0.06], [0.094, 0.15]], { sz: 0.9, phiStart: 0.45, phiLength: Math.PI * 2 - 0.9 }), coat); collarOut.material.side = THREE.DoubleSide;
    collarOut.position.y = 0.53; collarOut.scale.y = 0.75; n.torso.add(collarOut);
    // pingente azul num cordão
    const chain = mesh(new THREE.TorusGeometry(0.075, 0.0025, 4, 24, Math.PI), silver, 0, 0.53, 0.06); chain.rotation.set(-0.45, 0, Math.PI); n.torso.add(chain);
    put(n.torso, mesh(new THREE.OctahedronGeometry(0.018), new THREE.MeshStandardNodeMaterial({ color: 0x2a5aa0, emissive: 0x4a9aff, emissiveIntensity: 1.4, roughness: 0.05, metalness: 0.2 }), 0, 0.455, 0.13)).scale.set(0.8, 1.3, 0.6);
    // emblema bordado no ombro
    for (const s of ['L', 'R']) { const em = mesh(new THREE.CircleGeometry(0.034, 6), panel, (s === 'L' ? 1 : -1) * 0.066, -0.08, 0.0); em.rotation.y = (s === 'L' ? 1 : -1) * Math.PI / 2; n[`arm${s}`].add(em); }
    // punhos claros bordados
    for (const s of ['L', 'R']) n[`fore${s}`].add(mesh(lathe([[0.046, -0.25], [0.05, -0.2], [0.052, -0.15]], { sz: 0.92 }), panel));
    // cinto, fivela, bolsa (esquerda) e pergaminhos (direita)
    n.hips.add(mesh(lathe([[0.168, 0.07], [0.172, 0.11], [0.168, 0.14]], { sz: 0.74, segs: 32 }), brownLeather));
    put(n.hips, mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 4), silver, 0, 0.105, 0.128)).rotation.z = Math.PI / 4;
    const pouch = mesh(lathe([[0.0, -0.06], [0.04, -0.05], [0.045, 0.02], [0.04, 0.05]], { sz: 0.55 }), brownLeather, 0.16, 0.0, -0.05); pouch.rotation.y = 1.2; n.hips.add(pouch);
    for (let i = 0; i < 3; i++) {
      const sc = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 12), parchment, -0.17, 0.04 + i * 0.012, 0.03 + i * 0.045);
      sc.rotation.set(Math.PI / 2 - 0.15, 0.15, 0); n.hips.add(sc);
      for (const e of [-1, 1]) { const cap = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 12), brownLeather); cap.position.set(0, e * 0.1, 0); sc.add(cap); }
    }
    const strap = mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16), brownLeather, -0.17, 0.05, 0.075); strap.rotation.y = Math.PI / 2; n.hips.add(strap);
    // botas: dobra no cano e fivela no tornozelo
    for (const s of ['L', 'R']) {
      n[`shin${s}`].add(mesh(lathe([[0.072, -0.05], [0.075, 0.0], [0.072, 0.02]], { sz: 0.98 }), fabric(0x6a4630, { rough: 0.5 })));
      const bs = mesh(lathe([[0.056, -0.36], [0.058, -0.33]], { sz: 0.98 }), brownLeather); n[`shin${s}`].add(bs);
      n[`shin${s}`].add(mesh(new THREE.BoxGeometry(0.02, 0.022, 0.006), silver, (s === 'L' ? 1 : -1) * 0.05, -0.345, 0.03));
    }
    // cabelo curto grisalho penteado para trás
    const hairM = hairMaterial(0x8a847c, 0xc4beb6, { along: 'z', rough: 0.7 });
    const hairLine = (x, y, z, front = 0.58, side = 0.12, back = -0.5) => { const h = z > 0.3 ? side + (front - side) * Math.min(1, (z - 0.3) / 0.55) : back + (side - back) * Math.max(0, (z + 1) / 1.3); return (y - h) / 0.2; };
    B.head.shell((x, y, z) => hairLine(x, y, z, 0.6, 0.3, -0.3), 0.011, hairM);   // curto, penteado para trás (fios ao longo de z)
    // caderno aberto (mão esquerda) e pena azul (mão direita)
    const book = new THREE.Group();
    const cover = fabric(0x6e3a1e, { rough: 0.5, bump: 0.2, scale: 60 });
    const pageMat = fabric(0xefe3c2, { rough: 0.9, bump: 0.05, scale: 30, wear: 0.08 });
    const ink = new THREE.MeshStandardNodeMaterial({ color: 0x2a2a3a, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const half = new THREE.Group(); half.rotation.z = sx * 0.16; book.add(half);
      half.add(mesh(new THREE.BoxGeometry(0.15, 0.01, 0.21), cover, sx * 0.075, 0, 0));
      half.add(mesh(new THREE.BoxGeometry(0.14, 0.022, 0.2), pageMat, sx * 0.072, 0.015, 0));
      for (let i = 0; i < 7; i++) half.add(mesh(new THREE.BoxGeometry(0.09 - (i % 3) * 0.015, 0.001, 0.003), ink, sx * 0.075, 0.027, -0.075 + i * 0.022));
    }
    book.position.set(0.02, -0.07, 0.08); book.rotation.set(-0.9, 0, 0.1);
    n.handL.add(book);
    const quill = new THREE.Group();
    const featherM = new THREE.MeshStandardNodeMaterial({ color: 0x6a9ad8, roughness: 0.45, emissive: 0x10284a, emissiveIntensity: 0.3, side: THREE.DoubleSide });
    const fg = new THREE.SphereGeometry(1, 12, 8); fg.scale(0.014, 0.085, 0.003);
    quill.add(mesh(fg, featherM, 0, 0.14, 0));
    quill.add(mesh(new THREE.CylinderGeometry(0.0025, 0.0015, 0.26, 5), new THREE.MeshStandardNodeMaterial({ color: 0xe8eef8, roughness: 0.3 }), 0, 0.1, 0));
    put(quill, mesh(new THREE.ConeGeometry(0.004, 0.025, 5), silver, 0, -0.04, 0)).rotation.x = Math.PI;
    quill.position.set(-0.01, -0.07, 0.03); quill.rotation.set(0.6, 0, 0.3);
    n.handR.add(quill);
    this.quill = quill;
    B.root.scale.setScalar(1.03);
    B.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return B;
  }

  _buildBlacksmith() {
    // Bruno — referência: anão muito largo, barba castanha longa com duas tranças,
    // cabelo puxado para trás, cicatriz na testa, olhos âmbar, camisa cinza de manga
    // dobrada, antebraços peludos, avental de couro com fivela e bolso, braçadeiras
    // com rebites e cravos, martelo ornamentado e tenaz no cinto, botas com biqueira.
    const skinBase = 0xb07a5c;
    const skin = createSkinMaterial({ tone: skinBase, scale: 0.35, blood: [0.6, 0.3, 0.2], roughness: 0.55 });
    {
      const pl = positionLocal;
      const hairy = mx_noise_float(pl.mul(vec3(300, 40, 300))).mul(0.5).add(0.5);
      const grime = smoothstep(0.45, 0.85, mx_noise_float(pl.mul(7)).mul(0.5).add(0.5));
      skin.colorNode = mix(mix(color(skinBase), color(0x4a2e20), smoothstep(0.55, 0.9, hairy).mul(0.45)), color(0x2a221c), grime.mul(0.3));
    }
    const face = createSkinMaterial({ tone: 0xbc8366, scale: 0.35, blood: [0.6, 0.3, 0.2], roughness: 0.5 });
    const shirt = fabric(0x64625e, { rough: 0.9, bump: 0.3, scale: 110, wear: 0.3, soot: 0.2 });
    const apron = fabric(0x7e5436, { rough: 0.6, bump: 0.35, scale: 45, wear: 0.45, soot: 0.22, dark: 0x5a3a24 });
    const darkLeather = fabric(0x4e3a2c, { rough: 0.55, bump: 0.3, scale: 60, wear: 0.4, soot: 0.15 });
    const iron = metal(0x5c5c62, 0.42);
    const B = buildBody({
      dims: { thigh: 0.27, shin: 0.25, foot: 0.085, torsoH: 0.5, shoulder: 0.3, upper: 0.27, fore: 0.25, W: 1.6, D: 1.35 },
      neckW: 1.7, armW: 1.55, legW: 1.5, footL: 1.25, handSize: 1.3, curl: 0.55, bootTop: 0.17,
      torsoProfile: [[0.13, -0.12], [0.145, 0.02], [0.16, 0.16], [0.18, 0.3], [0.19, 0.42], [0.185, 0.48], [0.13, 0.535], [0.06, 0.56], [0.0, 0.565]],
      mats: { skin, face, torso: shirt, sleeve: skin, foreUpper: skin, forearm: skin, hand: skin, pants: fabric(0x3c3632, { rough: 0.85, bump: 0.25, scale: 80, soot: 0.3 }), boots: darkLeather, sole: iron },
      head: { r: 0.126, iris: 0xd8a030, irisGlow: 0.5, lip: 0x8a4a3a, brow: 1.6, jaw: 1.35, nose: 1.45, hairBrow: 0x3a2416 },
    });
    const n = B.nodes, U = B.head.U;
    this.hipY = B.hipY;
    // mangas curtas dobradas por cima do braço
    for (const s of ['L', 'R']) {
      n[`arm${s}`].add(mesh(lathe([[0.1, -0.15], [0.104, -0.1], [0.1, -0.04], [0.085, 0.03]], { sz: 0.95 }), shirt));
      put(n[`arm${s}`], mesh(new THREE.TorusGeometry(0.098, 0.016, 8, 20), shirt, 0, -0.15, 0)).rotation.x = Math.PI / 2;
    }
    // avental: peito + saia até abaixo do joelho, bolso, alças e cinto com fivela
    const bib = mesh(lathe([[0.262, 0.0], [0.285, 0.143], [0.318, 0.268], [0.335, 0.375]], { sz: 0.92, phiStart: -0.85, phiLength: 1.7, segs: 14 }), apron); bib.material.side = THREE.DoubleSide; n.torso.add(bib);
    const skirt = mesh(lathe([[0.33, -0.5], [0.315, -0.3], [0.29, -0.1], [0.27, 0.06]], { sz: 0.96, phiStart: -1.0, phiLength: 2.0, segs: 16 }), apron);
    skirt.material.side = THREE.DoubleSide; n.hips.add(skirt);
    put(n.hips, mesh(new THREE.BoxGeometry(0.12, 0.13, 0.015), apron, -0.08, -0.2, 0.255)).rotation.x = -0.12;
    for (const sx of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 0.15, 0.37, 0.28), new THREE.Vector3(sx * 0.17, 0.455, 0.13), new THREE.Vector3(sx * 0.17, 0.455, -0.1), new THREE.Vector3(sx * 0.15, 0.28, -0.27)]);
      n.torso.add(mesh(new THREE.TubeGeometry(curve, 16, 0.016, 5), apron));
      n.torso.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), iron, sx * 0.15, 0.37, 0.285));
    }
    n.hips.add(mesh(lathe([[0.262, 0.04], [0.268, 0.08], [0.262, 0.12]], { sz: 0.92, segs: 32 }), darkLeather));
    const buckle = mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 4), iron, 0, 0.08, 0.245); buckle.rotation.z = Math.PI / 4; buckle.scale.set(1.3, 1, 1); n.hips.add(buckle);
    // martelo ornamentado (direita) e tenaz (esquerda) pendurados
    const war = new THREE.Group(); war.position.set(-0.26, -0.02, 0.17); war.rotation.set(0.1, 0, 0.12); n.hips.add(war);
    war.add(mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.36, 8), fabric(0x2a1e2a, { rough: 0.5 }), 0, -0.14, 0));
    const wh = mesh(new THREE.BoxGeometry(0.09, 0.1, 0.18), new THREE.MeshStandardNodeMaterial({ color: 0x4a3e4a, metalness: 0.75, roughness: 0.35, emissive: 0x3a2400, emissiveIntensity: 0.25 }), 0, 0.06, 0); war.add(wh);
    for (const sz of [-1, 1]) war.add(mesh(new THREE.BoxGeometry(0.096, 0.016, 0.01), metal(0xd0a040, 0.3), 0, 0.06, sz * 0.091));
    const tong = new THREE.Group(); tong.position.set(0.27, -0.05, 0.14); tong.rotation.z = -0.06; n.hips.add(tong);
    for (const dx of [-0.012, 0.012]) tong.add(mesh(new THREE.BoxGeometry(0.012, 0.42, 0.014), iron, dx, -0.17, 0));
    // braçadeiras com rebites e cravos
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      n[`fore${s}`].add(mesh(lathe([[0.066, -0.25], [0.074, -0.2], [0.08, -0.12], [0.078, -0.09]], { sz: 0.92 }), darkLeather));
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; n[`fore${s}`].add(mesh(new THREE.SphereGeometry(0.008, 6, 4), iron, Math.sin(a) * 0.079, -0.1, Math.cos(a) * 0.073)); }
      for (let i = 0; i < 3; i++) { const sp = mesh(new THREE.ConeGeometry(0.011, 0.03, 6), iron, sx * 0.08, -0.13 - i * 0.04, 0.0); sp.rotation.z = -sx * Math.PI / 2; n[`fore${s}`].add(sp); }
      // costas da mão: luva sem dedos
      const back = mesh(new THREE.SphereGeometry(1, 12, 8), darkLeather, sx * 0.004, -0.055, 0); back.scale.set(0.03, 0.05, 0.058); n[`hand${s}`].add(back);
    }
    // botas com dobra e biqueira de ferro
    for (const s of ['L', 'R']) {
      n[`shin${s}`].add(mesh(lathe([[0.11, -0.1], [0.115, -0.06], [0.108, -0.05]], { sz: 0.98 }), darkLeather));
      const cap = mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), iron, 0, -0.25 - 0.085 * 0.5, 0.16);
      cap.scale.set(0.09, 0.055, 0.075); n[`shin${s}`].add(cap);
    }
    // cabeça: cabelo puxado para trás + rabo, cicatriz, barba cheia com bigode e 2 tranças
    const hairM = hairMaterial(0x4a2e1c, 0x7e5838, { along: 'z', rough: 0.55 });
    const hairLine = (x, y, z, front = 0.58, side = 0.12, back = -0.5) => { const h = z > 0.3 ? side + (front - side) * Math.min(1, (z - 0.3) / 0.55) : back + (side - back) * Math.max(0, (z + 1) / 1.3); return (y - h) / 0.2; };
    B.head.shell((x, y, z) => hairLine(x, y, z, 0.55), 0.014, hairM);
    const tail = mesh(lathe([[0.005, -0.16], [0.03, -0.1], [0.038, -0.03], [0.03, 0.02]], { sz: 0.8 }), hairM); tail.position.copy(U(0, 0.15, -0.95)); tail.rotation.x = 0.35; n.head.add(tail);
    const scar = new THREE.CatmullRomCurve3([U(0.12, 0.62, 0.8), U(0.2, 0.42, 0.9), U(0.26, 0.24, 0.9)]);
    n.head.add(mesh(new THREE.TubeGeometry(scar, 8, 0.0025, 4), new THREE.MeshStandardNodeMaterial({ color: 0x8a4038, roughness: 0.7 })));
    const beardM = hairMaterial(0x7a5234, 0xb08860, { along: 'y', rough: 0.65 });
    const jaw = B.head.jaw;
    const jp = jaw.position;
    // costeletas + barba cobrindo o queixo (presas na mandíbula)
    // barba cheia moldada no rosto: bochechas, mandíbula e costeletas (deixa os lábios livres)
    B.head.shell((x, y, z) => {
      if (z < -0.35) return 0;
      const top = z > 0.55 ? -0.1 - Math.max(0, 0.3 - Math.abs(x)) * 0.6 : 0.15;
      if (Math.abs(x) < 0.3 && y > -0.75 && y < -0.36 && z > 0.6) return 0;   // boca
      return (top - y) / 0.18;
    }, 0.022, beardM);
    const long = mesh(lathe([[0.012, -0.36], [0.05, -0.3], [0.085, -0.2], [0.105, -0.1], [0.11, -0.02], [0.095, 0.04]], { sz: 0.55, segs: 20 }), beardM);
    long.position.copy(U(0, -0.75, 0.55).sub(jp)); long.rotation.x = 0.18; jaw.add(long);
    // bigode caído sobre os cantos da boca
    for (const sx of [-1, 1]) {
      const c = new THREE.CatmullRomCurve3([U(0, -0.36, 1.0), U(sx * 0.22, -0.42, 0.95), U(sx * 0.32, -0.62, 0.85), U(sx * 0.3, -0.85, 0.75)]);
      n.head.add(mesh(new THREE.TubeGeometry(c, 12, 0.012, 6), beardM));
    }
    // duas tranças (cadeias de gomos) que balançam com a fala e o martelo
    this.braids = [];
    for (const sx of [-1, 1]) {
      const chainArr = [];
      let parent = long;
      const start = new THREE.Group(); start.position.set(sx * 0.035, -0.33, 0.02); parent.add(start);
      parent = start;
      for (let i = 0; i < 6; i++) {
        const j = new THREE.Group(); j.position.y = i ? -0.05 : 0; parent.add(j);
        const seg = mesh(new THREE.SphereGeometry(0.024 - i * 0.002, 10, 8), beardM, 0, -0.025, 0); seg.scale.set(1, 1.35, 0.85); seg.rotation.z = (i % 2 ? 1 : -1) * 0.35; j.add(seg);
        chainArr.push(j); parent = j;
      }
      put(parent, mesh(new THREE.TorusGeometry(0.014, 0.005, 6, 12), metal(0xb08a40, 0.3), 0, -0.06, 0)).rotation.x = Math.PI / 2;
      this.braids.push(chainArr);
    }
    this.braid = this.braids[0];
    // martelo de forja (mão direita)
    const hammer = new THREE.Group();
    const handle = mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 8), fabric(0x5a3d26, { rough: 0.6, scale: 80 }), 0, -0.07, 0.12); handle.rotation.x = Math.PI / 2; hammer.add(handle);
    const hh = mesh(new THREE.BoxGeometry(0.085, 0.085, 0.17), iron, 0, -0.07, 0.33); hh.rotation.y = Math.PI / 2; hammer.add(hh);
    n.handR.add(hammer);
    this.hammerHead = hh;
    // faca em brasa sobre a bigorna
    this.knifeMat = new THREE.MeshStandardNodeMaterial({ color: 0x3a2a24, metalness: 0.7, roughness: 0.4, emissive: 0xff5a10, emissiveIntensity: 2 });
    const knife = new THREE.Group();
    const blade = new THREE.Shape(); blade.moveTo(0, 0); blade.lineTo(0.26, 0.0); blade.quadraticCurveTo(0.2, 0.035, 0.0, 0.035); blade.lineTo(0, 0);
    const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.006, bevelEnabled: false }); bg.rotateX(-Math.PI / 2); bg.rotateY(Math.PI / 2); bg.translate(0, 0, 0.14);
    knife.add(mesh(bg, this.knifeMat));
    knife.add(mesh(new THREE.BoxGeometry(0.03, 0.022, 0.1), fabric(0x4a2a18, { rough: 0.6 }), 0, 0.005, -0.17));
    knife.position.set(0.08, 0.92, 0.9); knife.rotation.y = 0.5;
    B.root.add(knife);
    this.knife = knife;
    B.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return B;
  }

  // ---------------------------------------------------------------------------
  // Interação
  // ---------------------------------------------------------------------------
  interactable(hud) {
    return {
      getPosition: (out) => out.copy(this.root.position),
      radius: 4,
      label: () => `E — Falar com ${this.name}`,
      enabled: (ctx) => ctx.player.state === 'foot',
      interact: () => this.onInteract(hud),
    };
  }

  onInteract(hud) {
    hud.openDialog(this.name, this.dialog[this.line % this.dialog.length]);
    this.line++;
  }

  // ---------------------------------------------------------------------------
  // Atualização: estados + pose procedural
  // ---------------------------------------------------------------------------
  update(dt, playerPos) {
    this.t += dt;
    const p = this.root.position;
    const dx = playerPos.x - p.x, dz = playerPos.z - p.z, d2 = dx * dx + dz * dz;
    const talking = !!(this.talkUI?.open && this.talkUI.who?.name === this.name);
    const near = d2 < 36;
    // ---- estados ----
    if (talking) this.state = 'talk';
    else if (near) { this.state = 'wait'; this.awayT = 0; }
    else if (this.state !== 'work') { this.awayT += dt; if (this.awayT > 1.5) this.state = 'work'; }

    // ---- vaivém do Heitor (só trabalhando) ----
    let walking = false;
    if (this.kind === 'guild' && this.state === 'work') {
      if (this.paceWait > 0) this.paceWait -= dt;
      else {
        const next = this.pace + this.paceDir * 0.55 * dt;
        const nx = this.home.x + this.side.x * next, nz = this.home.z + this.side.z * next;
        if (Math.abs(next) > 2.2 || (this.colliders && !this.colliders.isFree(nx, nz, 0.3))) { this.paceDir *= -1; this.paceWait = 1.5 + Math.random() * 2.5; }
        else { this.pace = next; walking = true; }
      }
      p.x = this.home.x + this.side.x * this.pace; p.z = this.home.z + this.side.z * this.pace;
      if (this.groundAt) p.y = ease(p.y, this.groundAt(p.x, p.z), 10, dt);
    }
    // ---- para onde olhar ----
    let target = this.baseFacing;
    if (this.state !== 'work') target = Math.atan2(dx, dz);
    else if (walking) target = Math.atan2(this.side.x * this.paceDir, this.side.z * this.paceDir);
    this.facing = dampAngle(this.facing, target, this.state === 'work' ? 3 : 6, dt);
    this.root.rotation.y = this.facing;

    if (this.kind === 'guild') this._animGuild(dt, walking, talking); else this._animSmith(dt, talking);
  }

  /** Mandíbula + cabeça ao falar (ritmo do texto sendo digitado). */
  _talkHead(dt, talking) {
    const n = this.nodes, P = this.pose;
    const typing = talking && this.talkUI?.typing;
    const jawT = typing ? Math.max(0, Math.sin(this.t * 17) * 0.5 + Math.sin(this.t * 9.3) * 0.35) * 0.32 : 0.02;
    P.jaw = ease(P.jaw || 0, jawT, 25, dt);
    const jaw = n.head.getObjectByName('jaw'); if (jaw) jaw.rotation.x = P.jaw;
    return { nod: talking ? Math.sin(this.t * 2.3) * 0.08 + (typing ? Math.sin(this.t * 6) * 0.04 : 0) : 0, typing };
  }

  _animGuild(dt, walking, talking) {
    const n = this.nodes, P = this.pose, t = this.t;
    const work = this.state === 'work';
    const { nod, typing } = this._talkHead(dt, talking);
    // escrevendo: cabeça baixa no caderno; às vezes olha para cima pensando
    const think = work && Math.sin(t * 0.37) > 0.85;
    const write = work && !think ? 1 : 0;
    P.write = ease(P.write || 0, write, 5, dt);
    P.walk = ease(P.walk || 0, walking ? 1 : 0, 5, dt);
    P.gest = ease(P.gest || 0, talking ? 1 : 0, 4, dt);
    // passos
    const ph = t * 4.2, sw = Math.sin(ph) * 0.24 * P.walk;   // passo curto: as pernas não furam o casaco
    n.legL.rotation.x = sw; n.legR.rotation.x = -sw;
    n.shinL.rotation.x = Math.max(0, -Math.sin(ph)) * 0.45 * P.walk; n.shinR.rotation.x = Math.max(0, Math.sin(ph)) * 0.45 * P.walk;
    n.hips.position.y = this.hipY + Math.abs(Math.cos(ph)) * 0.02 * P.walk + Math.sin(t * 1.6) * 0.004;
    // tronco e cabeça
    n.torso.rotation.x = 0.06 * P.write + Math.sin(t * 1.6) * 0.008;
    n.torso.rotation.y = talking ? Math.sin(t * 0.9) * 0.05 : 0;
    n.neck.rotation.x = 0.42 * P.write - (think ? 0.25 : 0) + nod;
    n.neck.rotation.y = think ? 0.3 : 0;
    // braço esquerdo: segura o caderno à frente (baixa um pouco conversando)
    n.armL.rotation.set(-0.55 - 0.15 * P.write + 0.2 * P.gest, 0, 0.12);
    n.foreL.rotation.set(-1.25 + 0.3 * P.gest, 0, 0);
    // braço direito: escreve (zigue-zague da pena) ou gesticula ao falar
    const scribble = P.write * (Math.sin(t * 11) * 0.06);
    const gest = P.gest * (typing ? Math.sin(t * 3.1) * 0.35 : 0.05);
    n.armR.rotation.set(-0.7 * P.write - 0.5 * P.gest + gest * 0.5, scribble, -0.25 * P.write - 0.25 * P.gest);
    n.foreR.rotation.set(-1.25 * P.write - 0.9 * P.gest + gest, 0, Math.cos(t * 7) * 0.05 * P.write);
    n.armL.rotation.z += 0; // (clareza)
    if (!walking) { n.legL.rotation.x = ease(n.legL.rotation.x, 0, 8, dt); n.legR.rotation.x = ease(n.legR.rotation.x, 0, 8, dt); }
  }

  _animSmith(dt, talking) {
    const n = this.nodes, P = this.pose, t = this.t;
    const work = this.state === 'work';
    const { nod, typing } = this._talkHead(dt, talking);
    P.work = ease(P.work || 0, work ? 1 : 0, 5, dt);
    P.gest = ease(P.gest || 0, talking ? 1 : 0, 4, dt);
    // ciclo do martelo: 1,1 s — sobe devagar, desce rápido, impacto
    const CYC = 1.1, c = (t % CYC) / CYC;
    const lift = c < 0.7 ? Math.sin((c / 0.7) * Math.PI / 2) : 1 - Math.min(1, (c - 0.7) / 0.12);
    const hit = c >= 0.82 && c < 0.86;
    if (work && hit && !this._hitDone) {
      this._hitDone = true;
      this._heat = 1;
      const tip = this.knife.getWorldPosition(new THREE.Vector3());
      this.effects?.burst('spark', tip, 10, { speed: 4, up: 2.5, size: 0.025, life: 0.35, gravity: 1.6 });
      this.sfx?.hammer?.(tip);
      this._strikes = (this._strikes || 0) + 1;
    }
    if (!hit) this._hitDone = false;
    this._heat = Math.max(0.35, (this._heat || 1) - dt * 0.25);
    this.knifeMat.emissiveIntensity = 1.2 + this._heat * 2.2;
    const L = lift * P.work;
    n.torso.rotation.x = 0.18 * P.work + (c > 0.7 ? 0.08 * P.work : 0) + Math.sin(t * 1.5) * 0.01;
    n.torso.rotation.y = -0.1 * P.work + (talking ? Math.sin(t * 0.8) * 0.06 : 0);
    n.neck.rotation.x = 0.35 * P.work + nod;
    // braço direito: martelo sobe acima do ombro e desce na faca
    n.armR.rotation.set(-0.7 * P.work - 1.9 * L - 0.45 * P.gest + (typing ? Math.sin(t * 2.7) * 0.25 : 0), 0, -0.25);
    n.foreR.rotation.set(-0.5 * P.work - 0.6 * L - 0.8 * P.gest, 0, 0);
    // braço esquerdo: segura a faca com a tenaz sobre a bigorna
    n.armL.rotation.set(-0.85 * P.work - 0.1 * P.gest, 0, 0.15 + 0.1 * P.work);
    n.foreL.rotation.set(-0.6 * P.work - 0.2 * P.gest, 0, 0);
    // pernas afastadas, firme
    n.legL.rotation.set(0, 0, 0.12); n.legR.rotation.set(0, 0, -0.12);
    // trança da barba balança (inércia dos golpes e da fala)
    const kick = (c > 0.82 && c < 0.95 && work ? 0.12 : 0) + (typing ? Math.sin(t * 9) * 0.05 : 0);
    this.braids.forEach((chain, k) => chain.forEach((j, i) => { j.rotation.x = 0.04 + Math.sin(t * 3 - i * 0.6 + k) * 0.05 + kick * (i + 1) / 6; j.rotation.z = Math.sin(t * 2.1 - i + k * 1.7) * 0.05; }));
    this.knife.visible = true;
  }
}
