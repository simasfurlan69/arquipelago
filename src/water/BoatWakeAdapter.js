/**
 * BoatWakeAdapter.js
 * Apresenta o nosso navio (src/entities/Boat.js) com a interface que o WakeSim
 * do Tidewater espera do BoatController dele:
 *   position, velocity, driven, throttle, rpm, forward(out)
 *   model.lines = { zAft, wlEnd, bottomAt(x, z) }  (casco no referencial do barco:
 *                 x = distância ao centro, z = para a proa, y < 0 = imerso)
 */
import * as THREE from 'three/webgpu';

const LENGTH = 20, BEAM = 5.6, DRAFT = 1.7;

/** Mesma curva de afinamento do casco procedural (Boat.js). */
function taper(t) {
  let k = 1;
  if (t > 0.25) k *= 1 - Math.pow((t - 0.25) / 0.75, 1.7) * 0.97;
  if (t < -0.7) k *= 1 - ((-t - 0.7) / 0.3) * 0.25;
  return k;
}

export class BoatWakeAdapter {
  constructor(boat) {
    this.boat = boat;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.driven = false;
    this.throttle = 0;
    this.rpm = 1;
    this.model = {
      lines: {
        zAft: -LENGTH / 2 + 0.3,
        wlEnd: LENGTH / 2 - 0.8,
        bottomAt(x, z) {
          const t = z / (LENGTH / 2);
          if (t < -1 || t > 1) return NaN;
          const hw = (BEAM / 2) * taper(t) * 0.9;
          if (Math.abs(x) > hw) return NaN;
          const u = Math.abs(x) / hw;
          return -DRAFT * (1 - u * u) * (1 - Math.max(0, t - 0.6) * 1.5);
        },
      },
    };
  }

  forward(out = new THREE.Vector3()) {
    const h = this.boat.heading;
    return out.set(Math.sin(h), 0, Math.cos(h));
  }

  update() {
    const b = this.boat;
    const active = b.root.visible && b.alive && !b.sinking;
    this.position.copy(b.root.position);
    if (active) this.velocity.copy(b.velocity);
    else this.velocity.set(0, 0, 0);
    this.driven = active && b.driven;
    this.throttle = active ? b.throttle : 0;
  }
}
