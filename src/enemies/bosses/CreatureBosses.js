/**
 * CreatureBosses.js
 * Corpos e animações procedurais dos 3 chefes-criatura (inspirados nas referências do jogador):
 *
 *  buildScorpion()  Ignar, o Escorpião da Forja Negra — bípede, carapaça negra com fendas de
 *                   lava, pinças serrilhadas, crista de espinhos, cauda de escorpião sobre a cabeça.
 *  buildAlien()     Nimbra, a Abominação da Tempestade — biomecânica cinza-grafite com veias e olhos
 *                   roxos, anda curvada em 4 patas, chifres nas costas, cauda longa com espinhos.
 *  buildFireBeast() Varkhul, a Fera da Coroa em Chamas — corcunda gigante de pele em brasa, chifres
 *                   retorcidos, juba, braços com garras, cauda-tentáculo com bulbo, espada nas costas.
 *
 * Cada build devolve { root, ..., animate(b, dt) }. `animate` lê o estado do Boss
 * (b.state, b.attack?.name, b.timer, b.speed) e monta a pose: passada com IK, cauda em onda,
 * e uma pose-chave própria para cada ataque (preparar → golpear → recuperar).
 */
import * as THREE from 'three/webgpu';
import { veinMaterial, emberMaterial, glowMat, boneMat, segment, segGeo, spike, claw, chain, leg, walkLegs, solveLeg, ease, mesh } from './CreatureRig.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Fração do ataque atual: 0..1 no windup (preparo) e 0..1 no golpe. */
function phaseOf(b) {
  const a = b.attack;
  if (!a) return { wind: 0, hit: 0, name: null };
  if (b.state === 'windup') return { wind: 1 - Math.max(0, b.timer) / Math.max(0.01, a.windup), hit: 0, name: a.name };
  if (b.state === 'attack') return { wind: 1, hit: 1 - Math.max(0, b.timer) / Math.max(0.01, a.duration || 0.4), name: a.name };
  return { wind: 0, hit: 0, name: null };
}

// =============================================================================
// IGNAR — Escorpião da Forja Negra
// =============================================================================
export function buildScorpion() {
  const shell = veinMaterial({ base: 0x2a2624, dark: 0x0a0807, glow: 0xff5a10, glowK: 3.2, veinScale: 1.6, rough: 0.35, metal: 0.3 });
  const plate = veinMaterial({ base: 0x3a3532, dark: 0x141110, glow: 0xff7a20, glowK: 1.6, veinScale: 2.4, rough: 0.3, metal: 0.35 });
  const horn = boneMat(0x2a2220);
  const lava = glowMat(0xff6a10, 4);
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 2.3; root.add(body);

  // pélvis e abdômen
  const pelvis = mesh(new THREE.SphereGeometry(0.75, 18, 14), shell); pelvis.scale.set(1.2, 0.8, 1); body.add(pelvis);
  // tronco inclinado para a frente
  const chest = new THREE.Group(); chest.position.set(0, 0.4, 0.15); chest.rotation.x = 0.35; body.add(chest);
  const torso = mesh(new THREE.SphereGeometry(1, 20, 16), shell); torso.scale.set(1.15, 1.25, 0.95); torso.position.y = 1.0; chest.add(torso);
  for (let i = 0; i < 5; i++) {   // placas do peito
    const p = mesh(new THREE.BoxGeometry(1.4 - i * 0.12, 0.22, 0.5), plate); p.position.set(0, 0.35 + i * 0.32, 0.72 - Math.abs(i - 2) * 0.05); p.rotation.x = -0.15; chest.add(p);
  }
  // ombreiras de espinhos
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) spike(chest, V(s * (0.9 + i * 0.08), 1.75 - i * 0.12, -0.1 + i * 0.1), V(s * 0.9, 0.8, -0.3 + i * 0.2), 0.7 - i * 0.1, 0.12, horn);

  // cabeça com crista, olhos de brasa, mandíbulas e língua
  const neck = new THREE.Group(); neck.position.set(0, 2.05, 0.35); chest.add(neck);
  const head = new THREE.Group(); neck.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.5, 16, 12), shell); skull.scale.set(0.85, 0.75, 1.5); skull.position.z = 0.35; head.add(skull);
  for (let i = 0; i < 7; i++) spike(head, V(0, 0.3, -0.25 + i * 0.13), V(0, 1, -0.6 + i * 0.12), 0.75 - Math.abs(i - 3) * 0.08, 0.08, horn);   // crista
  for (const s of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), lava, s * 0.22, 0.12, 0.8));
    spike(head, V(s * 0.3, 0.05, 0.1), V(s * 1, 0.4, -0.5), 0.6, 0.07, horn);
  }
  const jaw = new THREE.Group(); jaw.position.set(0, -0.15, 0.4); head.add(jaw);
  const jm = mesh(new THREE.BoxGeometry(0.55, 0.14, 0.75), shell); jm.position.z = 0.35; jaw.add(jm);
  for (const s of [-1, 1]) spike(jaw, V(s * 0.22, 0.05, 0.7), V(0, 1, 0.3), 0.18, 0.04, horn);
  const tongue = chain(jaw, { n: 4, len: 0.22, r0: 0.05, r1: 0.02, mat: glowMat(0xc83a20, 1.2), ribs: 0 }); tongue[0].position.set(0, 0.05, 0.5);

  // braços com PINÇAS serrilhadas
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group(); sh.position.set(s * 1.15, 1.45, 0.1); chest.add(sh);
    const up = new THREE.Group(); sh.add(up);
    segment(up, 1.0, 0.28, 0.22, shell, 2).rotation.x = Math.PI / 2;
    const el = new THREE.Group(); el.position.y = -1.0; up.add(el);
    segment(el, 0.9, 0.24, 0.3, shell, 2);
    // pinça: mão (base) + garra fixa + garra móvel
    const hand = new THREE.Group(); hand.position.z = 0.9; el.add(hand);
    const palm = mesh(new THREE.SphereGeometry(0.45, 14, 10), plate); palm.scale.set(0.8, 0.7, 1.3); palm.position.z = 0.35; hand.add(palm);
    const fixed = new THREE.Group(); fixed.position.set(0, -0.12, 0.8); hand.add(fixed);
    const fm = mesh(segGeo(0.22, 0.03, 0, 8), shell); fm.scale.set(0.9, 0.6, 1.3); fixed.add(fm);
    const moving = new THREE.Group(); moving.position.set(0, 0.15, 0.75); hand.add(moving);
    const mm = mesh(segGeo(0.2, 0.03, 0, 8), shell); mm.scale.set(0.9, 0.6, 1.25); moving.add(mm);
    for (let i = 0; i < 5; i++) {
      spike(fixed, V(0, 0.08, 0.15 + i * 0.22), V(0, 1, 0.3), 0.18, 0.04, horn);
      spike(moving, V(0, -0.06, 0.15 + i * 0.2), V(0, -1, 0.3), 0.16, 0.035, horn);
      spike(hand, V(s * 0.3, 0.2, 0.1 + i * 0.15), V(s, 0.6, 0), 0.25, 0.05, horn);
    }
    return { sh, up, el, hand, moving, s };
  });

  // pernas (2) digitígradas
  const legs = [-1, 1].map((s, i) => {
    const L = leg(body, V(s * 0.65, -0.1, 0), { L1: 1.2, L2: 1.25, r: 0.32, mat: shell, knee: V(0, 0, 1),
      foot: (end) => { const f = mesh(new THREE.BoxGeometry(0.5, 0.18, 0.9), shell); f.position.set(0, -0.05, 0.25); end.add(f); for (const x of [-0.18, 0, 0.18]) spike(end, V(x, -0.08, 0.7), V(0, -0.2, 1), 0.3, 0.06, horn); } });
    L.phase = i * Math.PI; L.rest.z = 0.1; L.rest.x = s * 0.75;
    return L;
  });

  // cauda de escorpião: sai da pélvis para trás e arqueia sobre a cabeça
  const tailBase = new THREE.Group(); tailBase.position.set(0, 0.25, -0.6); tailBase.rotation.x = -(Math.PI - 0.75); body.add(tailBase);   // para trás e para CIMA
  const tail = chain(tailBase, { n: 9, len: 0.62, r0: 0.42, r1: 0.2, mat: shell, ribs: 1, spikeMat: horn, spikeLen: 0.35 });
  const sting = new THREE.Group(); sting.position.z = 0.62; tail[tail.length - 1].add(sting);
  const bulb = mesh(new THREE.SphereGeometry(0.32, 12, 10), plate); bulb.scale.set(0.9, 0.9, 1.3); bulb.position.z = 0.25; sting.add(bulb);
  const stingG = new THREE.ConeGeometry(0.13, 1.0, 8); stingG.rotateX(Math.PI / 2); stingG.translate(0, 0, 0.5);
  const st = mesh(stingG, lava); st.position.z = 0.55; st.rotation.x = 0.9; sting.add(st);
  const glow = new THREE.PointLight(0xff5a10, 30, 14, 2); glow.position.set(0, 3.5, 0); root.add(glow);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const pose = { open: 0.2, guard: 1, tailK: 0, lean: 0, armRaise: 0, jaw: 0, armFwd: 0 };
  const animate = (b, dt) => {
    const t = (b._at = (b._at || 0) + dt);
    const { wind, hit, name } = phaseOf(b);
    // alvos da pose
    let open = 0.25 + Math.sin(t * 3) * 0.1, guard = b.state === 'chase' ? 1 : 0.3, tailK = 0, lean = 0, armRaise = 0, jawT = 0.1, armFwd = 0;
    if (name === 'scissor') { open = wind < 1 ? 1 : 0; armFwd = wind < 1 ? -0.4 : 1; guard = 0; lean = hit * 0.3; }
    else if (name === 'sting') { tailK = wind < 1 ? -0.6 * wind : 1.2; lean = wind < 1 ? -0.1 : 0.25; }
    else if (name === 'grab') { open = 1; armFwd = wind < 1 ? 0.3 : 1.2; guard = 0; lean = 0.3; }
    else if (name === 'embers') { tailK = -0.3; jawT = 0.8; lean = -0.15; }
    else if (name === 'clawCharge') { armFwd = 1; open = 0.8; lean = 0.45; guard = 0; }
    else if (name === 'ultimate') { armRaise = wind < 1 ? wind : 1 - hit; tailK = wind < 1 ? -0.4 : 1.3; jawT = 0.7; guard = 0; lean = wind < 1 ? -0.2 : 0.4; }
    if (b.grabbing > 0) { open = 0.05; armFwd = 1.1; guard = 0; }
    if (b.state === 'stunned') { guard = 0; lean = -0.2; open = 0.9; }
    const r = 8;
    for (const k of ['open', 'guard', 'tailK', 'lean', 'armRaise', 'jaw', 'armFwd']) pose[k] = ease(pose[k], { open, guard, tailK, lean, armRaise, jaw: jawT, armFwd }[k], r, dt);
    // corpo
    body.position.y = 2.3 + Math.sin(t * Math.max(2, b.speed * 1.6)) * 0.06 * Math.min(1, b.speed);
    chest.rotation.x = 0.35 + pose.lean + Math.sin(t * 1.2) * 0.03;
    jaw.rotation.x = pose.jaw * 0.6 + Math.sin(t * 5) * 0.03;
    tongue.forEach((j, i) => { j.rotation.x = Math.sin(t * 6 - i) * 0.3 + 0.2; });
    // braços: guarda (pinças na frente do rosto) / abrir / avançar / erguer
    for (const A of arms) {
      A.up.rotation.set(-0.9 * pose.guard - 1.2 * pose.armFwd - 2.6 * pose.armRaise, 0, A.s * (0.25 - 0.15 * pose.guard));
      A.el.rotation.set(-1.0 * pose.guard + 0.6 * pose.armFwd, A.s * -0.4 * pose.guard, 0);
      A.moving.rotation.x = -0.7 * pose.open;
    }
    // cauda: arco sobre a cabeça + balanço; ferroada estica para a frente
    tail.forEach((j, i) => {
      const k = i / tail.length;
      j.rotation.x = 0.27 + 0.1 * k + pose.tailK * 0.14 + Math.sin(t * 2 - i * 0.6) * 0.04;   // arqueia por cima da cabeça
      j.rotation.y = Math.sin(t * 1.3 - i * 0.5) * 0.06 * (1 - pose.tailK * 0.5);
    });
    walkLegs({ legs, body, groundAt: b.ctx.groundAt, t, speed: b.speed, stride: 1.6, lift: 0.5 });
  };
  return { root, body, tail, sting, arms, animate };
}

// =============================================================================
// NIMBRA — Abominação da Tempestade (alien biomecânico roxo)
// =============================================================================
export function buildAlien() {
  const skin = veinMaterial({ base: 0x3a3838, dark: 0x111112, glow: 0xb040ff, glowK: 3.5, veinScale: 2.0, rough: 0.35, metal: 0.4 });
  const plate = veinMaterial({ base: 0x4a4646, dark: 0x1a1818, glow: 0x9a30ff, glowK: 1.4, veinScale: 3.2, rough: 0.3, metal: 0.45 });
  const purple = glowMat(0xb040ff, 4.5);
  const bone = boneMat(0x35302f);
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 1.8; root.add(body);
  // tórax e abdômen (horizontal, curvado)
  const thorax = mesh(new THREE.SphereGeometry(1, 20, 16), skin); thorax.scale.set(1.0, 0.85, 1.4); thorax.position.z = 0.6; body.add(thorax);
  const abdomen = mesh(new THREE.SphereGeometry(0.8, 18, 14), skin); abdomen.scale.set(0.9, 0.75, 1.3); abdomen.position.set(0, -0.05, -1.1); body.add(abdomen);
  for (let i = 0; i < 7; i++) {   // costelas / placas dorsais
    const r = mesh(new THREE.TorusGeometry(0.85 - Math.abs(i - 3) * 0.06, 0.07, 6, 16, Math.PI), plate);
    r.rotation.set(0, Math.PI / 2, 0); r.position.set(0, 0.15, 1.3 - i * 0.38); r.scale.set(1, 1.1, 1); body.add(r);
    body.add(mesh(new THREE.SphereGeometry(0.06, 6, 5), purple, 0, 0.8 - Math.abs(i - 3) * 0.04, 1.3 - i * 0.38));
  }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const tube = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), purple); tube.rotation.x = Math.PI / 2; tube.position.set(s * (0.55 + i * 0.12), -0.2 + i * 0.15, 0.1); tube.material = i === 1 ? purple : plate; body.add(tube); }
  // chifres curvos nas costas
  const horns = [-1, 1].map((s) => {
    const base = new THREE.Group(); base.position.set(s * 0.5, 0.7, 0.4); base.rotation.set(-1.0, s * 0.35, 0); body.add(base);
    return chain(base, { n: 5, len: 0.45, r0: 0.2, r1: 0.05, mat: bone, ribs: 2 });
  });
  // cabeça baixa com mandíbula e olhos roxos
  const neck = new THREE.Group(); neck.position.set(0, 0.2, 1.8); body.add(neck);
  const head = new THREE.Group(); neck.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.45, 16, 12), plate); skull.scale.set(0.95, 0.85, 1.35); skull.position.z = 0.3; head.add(skull);
  for (const s of [-1, 1]) for (const y of [0.05, 0.2]) head.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), purple, s * 0.2, y, 0.68));
  const jaw = new THREE.Group(); jaw.position.set(0, -0.2, 0.35); head.add(jaw);
  const jm = mesh(new THREE.BoxGeometry(0.5, 0.12, 0.55), skin); jm.position.z = 0.25; jaw.add(jm);
  for (let i = 0; i < 6; i++) { spike(jaw, V(-0.18 + i * 0.07, 0.06, 0.5), V(0, 1, 0.2), 0.16, 0.025, bone); spike(head, V(-0.18 + i * 0.07, -0.18, 0.75), V(0, -1, 0.2), 0.14, 0.025, bone); }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const tusk = chain(head, { n: 3, len: 0.18, r0: 0.04, r1: 0.015, mat: bone, ribs: 0 }); tusk[0].position.set(s * 0.18, -0.25, 0.55 - i * 0.12); tusk[0].rotation.set(0.9, s * 0.3, 0); }
  const mouthLight = new THREE.PointLight(0xa040ff, 18, 10, 2); mouthLight.position.set(0, 0, 0.9); head.add(mouthLight);
  // 2 braços-garra (frente) + 2 patas traseiras
  const legs = [];
  for (const s of [-1, 1]) {
    const F = leg(body, V(s * 0.85, 0.1, 1.2), { L1: 1.5, L2: 1.45, r: 0.2, mat: skin, knee: V(s * 0.6, 0.6, -0.5),
      foot: (end) => { for (let k = -1; k <= 1; k++) { const c = claw(end, 0.8, 0.07, bone, 0.45); c.rotation.set(0.5, k * 0.35, 0); } } });
    F.rest.set(s * 1.6, -1.75, 2.1); F.phase = s > 0 ? 0 : Math.PI; legs.push(F);
    const H = leg(body, V(s * 0.7, -0.1, -1.1), { L1: 1.3, L2: 1.4, r: 0.26, mat: skin, knee: V(s * 0.5, 0.2, 1),
      foot: (end) => { for (let k = -1; k <= 1; k++) { const c = claw(end, 0.5, 0.06, bone, 0.6); c.rotation.set(0.3, k * 0.4, 0); } } });
    H.rest.set(s * 1.25, -1.75, -1.3); H.phase = s > 0 ? Math.PI : 0; legs.push(H);
  }
  // cauda longa com espinhos e pontos roxos
  const tailBase = new THREE.Group(); tailBase.position.set(0, 0.05, -1.95); tailBase.rotation.x = Math.PI + 0.25; body.add(tailBase);
  const tail = chain(tailBase, { n: 14, len: 0.5, r0: 0.32, r1: 0.06, mat: skin, ribs: 1, spikeMat: bone, spikeLen: 0.28 });
  tail.forEach((j, i) => { if (i % 2 === 0) j.add(mesh(new THREE.SphereGeometry(0.05 + 0.04 * (1 - i / 14), 6, 5), purple, 0.2, 0, 0.25)); });
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const pose = { crouch: 0, rear: 0, jaw: 0, claw: 0, whip: 0, lift: 0 };
  const animate = (b, dt) => {
    const t = (b._at = (b._at || 0) + dt);
    const { wind, hit, name } = phaseOf(b);
    let crouch = 0, rear = 0, jawT = 0.15 + Math.max(0, Math.sin(t * 0.7)) * 0.2, clawT = 0, whip = 0, lift = 0;
    if (name === 'pounce') { crouch = wind < 1 ? wind : 0; lift = wind < 1 ? 0 : Math.sin(hit * Math.PI) * 4; jawT = 0.9; }
    else if (name === 'clawX') { rear = wind < 1 ? 0.8 * wind : 0.2; clawT = wind < 1 ? -1 : 1; jawT = 0.7; }
    else if (name === 'tailWhip') { crouch = 0.3; whip = wind < 1 ? -0.6 * wind : 1; }
    else if (name === 'lightning' || name === 'storm') { rear = 0.6; jawT = 1; }
    else if (name === 'eye') { rear = 1; lift = 2.5; jawT = 1; }
    else if (name === 'ultimate') { rear = wind < 1 ? wind : 0; crouch = wind < 1 ? 0 : 0.6; jawT = 1; }
    if (b.state === 'stunned') { crouch = 0.6; jawT = 0.6; }
    for (const k of Object.keys(pose)) pose[k] = ease(pose[k], { crouch, rear, jaw: jawT, claw: clawT, whip, lift }[k], 9, dt);
    // corpo curvado; empina (rear) apoiado nas patas de trás; flutua (lift) no salto/olho do furacão
    body.position.y = 1.8 - pose.crouch * 0.6 + pose.lift + Math.sin(t * Math.max(3, b.speed * 2.5)) * 0.08 * Math.min(1, b.speed / 2);
    body.rotation.x = -pose.rear * 0.7 + Math.sin(t * 0.9) * 0.03;
    body.rotation.z = Math.sin(t * 1.7) * 0.03;
    neck.rotation.x = pose.rear * 0.5 + Math.sin(t * 2.3) * 0.08;
    neck.rotation.y = Math.sin(t * 0.8) * 0.25;
    jaw.rotation.x = pose.jaw * 0.9;
    horns.forEach((h) => h.forEach((j, i) => { j.rotation.x = -0.25 - i * 0.05 + Math.sin(t * 1.5 + i) * 0.02; }));
    // cauda: onda serpenteante; chicote = varre para o lado
    tail.forEach((j, i) => {
      j.rotation.y = Math.sin(t * 2.4 - i * 0.45) * 0.12 + pose.whip * 0.22 * Math.sin(Math.min(1, i / 6) * Math.PI / 2);
      j.rotation.x = -0.04 - (i > 8 ? 0.06 : 0) + Math.sin(t * 1.6 - i * 0.4) * 0.04;
    });
    // pernas: passada (no ar elas pendem); garras X: patas da frente erguem e cortam
    if (pose.lift > 0.5) {
      for (const L of legs) solveLeg(L, L.rest.clone().add(V(0, 0.9, 0)));
    } else {
      walkLegs({ legs, body, groundAt: b.ctx.groundAt, t, speed: b.speed, stride: 1.8, lift: 0.6 });
      if (Math.abs(pose.claw) > 0.05 || pose.rear > 0.3) {
        for (const L of legs.filter((_, i) => i % 2 === 0)) {
          const sx = Math.sign(L.hip.position.x);
          const tgt = L.rest.clone().add(V(-sx * 0.8 * Math.max(0, pose.claw), 1.6 * pose.rear + 1.2 * Math.abs(pose.claw), 0.6 * pose.claw));
          solveLeg(L, tgt);
        }
      }
    }
  };
  return { root, body, tail, animate };
}

// =============================================================================
// VARKHUL — Fera da Coroa em Chamas
// =============================================================================
export function buildFireBeast() {
  const skin = emberMaterial({ crust: 0x2a0804, hot: 0xff4a08, core: 0xffd060, scale: 1.2, k: 3.2 });
  const skin2 = emberMaterial({ crust: 0x3a0e06, hot: 0xff6a10, core: 0xffe080, scale: 2.2, k: 2 });
  const horn = boneMat(0x1a0c08);
  const fire = glowMat(0xffa030, 5);
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 3.6; root.add(body);
  // corcunda: tronco enorme inclinado para a frente
  const torso = mesh(new THREE.SphereGeometry(1.8, 24, 18), skin); torso.scale.set(1.15, 1.0, 1.25); torso.position.set(0, 0.8, 0.3); body.add(torso);
  const hump = mesh(new THREE.SphereGeometry(1.4, 20, 16), skin2); hump.position.set(0, 2.0, -0.4); body.add(hump);
  const belly = mesh(new THREE.SphereGeometry(1.3, 20, 16), skin2); belly.scale.set(1.1, 1, 1); belly.position.set(0, -0.3, 0.6); body.add(belly);
  // juba de tiras queimadas
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 1.6 - 0.8;
    const strip = mesh(new THREE.BoxGeometry(0.12, 1.6 + Math.random() * 1.2, 0.04), skin2);
    strip.position.set(Math.sin(a) * 1.3, 2.4, 1.0 + Math.cos(a) * 0.6);
    strip.rotation.set(-0.5 - Math.random() * 0.4, a, Math.sin(a) * 0.3);
    body.add(strip);
  }
  // cabeça: caveira com chifres retorcidos
  const neck = new THREE.Group(); neck.position.set(0, 2.1, 1.6); body.add(neck);
  const head = new THREE.Group(); neck.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.8, 18, 14), skin); skull.scale.set(1, 0.95, 1.1); skull.position.z = 0.4; head.add(skull);
  for (const s of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), fire, s * 0.32, 0.15, 1.1));
    const hb = new THREE.Group(); hb.position.set(s * 0.5, 0.5, 0.2); hb.rotation.set(-1.2, s * 0.6, s * 0.3); head.add(hb);
    const h = chain(hb, { n: 6, len: 0.45, r0: 0.22, r1: 0.04, mat: horn, ribs: 3 });
    h.forEach((j, i) => { j.rotation.x = -0.3; j.rotation.z = s * 0.25 * (i % 2 ? 1 : -0.5); });
  }
  const jaw = new THREE.Group(); jaw.position.set(0, -0.35, 0.5); head.add(jaw);
  const jm = mesh(new THREE.BoxGeometry(0.9, 0.25, 0.9), skin); jm.position.z = 0.35; jaw.add(jm);
  for (let i = 0; i < 6; i++) { spike(jaw, V(-0.32 + i * 0.13, 0.12, 0.75), V(0, 1, 0.1), 0.25, 0.05, horn); spike(head, V(-0.32 + i * 0.13, -0.3, 1.05), V(0, -1, 0.1), 0.22, 0.05, horn); }
  const breath = new THREE.PointLight(0xff7020, 0, 18, 2); breath.position.set(0, -0.1, 1.4); head.add(breath);
  // braços longos com garras (quase arrastam no chão)
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group(); sh.position.set(s * 1.9, 1.5, 0.7); body.add(sh);
    const up = new THREE.Group(); sh.add(up);
    segment(up, 2.2, 0.55, 0.42, skin, 2).rotation.x = Math.PI / 2;
    const el = new THREE.Group(); el.position.y = -2.2; up.add(el);
    segment(el, 2.0, 0.42, 0.35, skin, 2).rotation.x = Math.PI / 2;
    const hand = new THREE.Group(); hand.position.y = -2.0; el.add(hand);
    hand.add(mesh(new THREE.SphereGeometry(0.45, 12, 10), skin2));
    for (let k = -2; k <= 2; k++) { const c = claw(hand, 1.0, 0.1, horn, 0.5); c.position.set(k * 0.17, -0.2, 0.2); c.rotation.set(1.2, k * 0.15, 0); }
    return { sh, up, el, hand, s };
  });
  // pernas grossas e curtas
  const legs = [-1, 1].map((s, i) => {
    const L = leg(body, V(s * 1.1, -0.9, -0.3), { L1: 1.5, L2: 1.5, r: 0.6, mat: skin, knee: V(0, 0, 1),
      foot: (end) => { const f = mesh(new THREE.SphereGeometry(0.55, 12, 10), skin2); f.scale.set(1, 0.5, 1.4); f.position.z = 0.3; end.add(f); for (let k = -1; k <= 1; k++) spike(end, V(k * 0.25, -0.1, 0.95), V(0, -0.3, 1), 0.4, 0.08, horn); } });
    L.phase = i * Math.PI; L.rest.set(s * 1.3, -3.45, 0); return L;
  });
  // cauda-tentáculo com bulbo pulsante
  const tailBase = new THREE.Group(); tailBase.position.set(0, 0.3, -1.6); tailBase.rotation.x = Math.PI - 0.5; body.add(tailBase);
  const tail = chain(tailBase, { n: 11, len: 0.65, r0: 0.6, r1: 0.3, mat: skin, ribs: 1 });
  const bulbG = new THREE.Group(); bulbG.position.z = 0.7; tail[tail.length - 1].add(bulbG);
  const bulb = mesh(new THREE.SphereGeometry(1.0, 18, 14), skin2); bulb.scale.set(1, 1, 1.35); bulb.position.z = 0.8; bulbG.add(bulb);
  const bulbCore = mesh(new THREE.SphereGeometry(0.45, 12, 10), fire); bulbCore.position.z = 0.8; bulbG.add(bulbCore);
  // espada rúnica cravada nas costas (ponto fraco)
  const swordG = new THREE.Group(); swordG.position.set(0.3, 2.6, -1.2); swordG.rotation.set(-0.9, 0.2, 0.3); body.add(swordG);
  swordG.add(mesh(new THREE.BoxGeometry(0.1, 2.6, 0.3), new THREE.MeshStandardNodeMaterial({ color: 0x9aa8a0, metalness: 0.9, roughness: 0.25, emissive: 0x30ff90, emissiveIntensity: 0.6 }), 0, 1.0, 0));
  swordG.add(mesh(new THREE.BoxGeometry(0.7, 0.1, 0.14), boneMat(0x6a5a30), 0, 2.35, 0));
  swordG.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), boneMat(0x2a1a10), 0, 2.7, 0));
  const glow = new THREE.PointLight(0xff5010, 60, 26, 2); glow.position.set(0, 5, 0.5); root.add(glow);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const pose = { swipe: 0, raise: 0, breath: 0, slam: 0, crouch: 0, roar: 0 };
  const animate = (b, dt) => {
    const t = (b._at = (b._at || 0) + dt);
    const { wind, hit, name } = phaseOf(b);
    let swipe = 0, raise = 0, br = 0, slam = 0, crouch = 0, roar = 0;
    if (name === 'paws') { raise = wind < 1 ? wind : 0; swipe = wind < 1 ? 0 : 1; }
    else if (name === 'bulb') { slam = wind < 1 ? -wind : 1; }
    else if (name === 'breath') { br = wind < 1 ? 0.3 : 1; roar = 0.5; }
    else if (name === 'leap') { crouch = wind < 1 ? wind : 0; raise = wind < 1 ? 0 : 1 - hit; }
    else if (name === 'crown' || name === 'ultimate' || name === 'doom') { roar = 1; raise = wind < 1 ? wind : 0; crouch = wind < 1 ? 0 : 0.5; }
    if (b.state === 'stunned') { crouch = 0.6; roar = 0.3; }
    if (b._transformT > 0) { roar = 1; raise = 1; }
    for (const k of Object.keys(pose)) pose[k] = ease(pose[k], { swipe, raise, breath: br, slam, crouch, roar }[k], 8, dt);
    const breathe = Math.sin(t * 1.4);
    body.position.y = 3.6 - pose.crouch * 0.9 + breathe * 0.05 + (b.leapY || 0);
    body.rotation.x = 0.15 + pose.crouch * 0.25 - pose.roar * 0.2;
    torso.scale.y = 1.0 + breathe * 0.02;
    neck.rotation.x = -pose.roar * 0.5 + pose.breath * 0.25 + Math.sin(t * 0.9) * 0.05;
    neck.rotation.y = pose.breath > 0.5 ? Math.sin(t * 2.2) * 1.0 : Math.sin(t * 0.5) * 0.15;   // varre o sopro
    jaw.rotation.x = Math.max(pose.roar, pose.breath) * 0.8 + 0.05;
    breath.intensity = pose.breath * 140;
    for (const A of arms) {
      A.up.rotation.set(-2.3 * pose.raise - 0.9 * pose.swipe - 0.25 + Math.sin(t * 1.4 + A.s) * 0.05, 0, A.s * (0.2 + 0.4 * pose.raise));
      A.el.rotation.set(-0.6 * pose.raise - 0.4 + 0.3 * pose.swipe, 0, 0);
    }
    // cauda: curva sobre o corpo; no "bulbo-martelo" chicoteia para a frente
    tail.forEach((j, i) => {
      j.rotation.x = (i < 4 ? -0.05 : 0.16) - pose.slam * 0.14 + Math.sin(t * 1.5 - i * 0.5) * 0.06;
      j.rotation.y = Math.sin(t * 1.1 - i * 0.4) * 0.08;
    });
    const pulse = 1 + Math.sin(t * 4) * 0.08;
    bulb.scale.set(pulse, pulse, 1.35 * pulse);
    walkLegs({ legs, body, groundAt: b.ctx.groundAt, t, speed: b.speed, stride: 2.2, lift: 0.7 });
  };
  return { root, body, tail, bulb: bulbG, sword: swordG, arms, animate };
}
