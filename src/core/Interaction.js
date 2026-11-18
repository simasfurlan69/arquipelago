/**
 * Interaction.js
 * Sistema genérico de interação por proximidade. Cada interagível registra:
 *   {
 *     getPosition(): THREE.Vector3,
 *     radius: number,
 *     label(): string,            // texto do prompt
 *     enabled(ctx): boolean,      // pode interagir agora?
 *     interact(ctx): void
 *   }
 * A cada frame, o mais próximo e válido aparece no HUD; a tecla E dispara a ação.
 */
import * as THREE from 'three/webgpu';

const _p = new THREE.Vector3();

export class Interaction {
  constructor(hud, input) {
    this.hud = hud;
    this.input = input;
    this.items = [];
    this.current = null;
  }

  register(item) { this.items.push(item); return item; }

  update(dt, ctx) {
    // Diálogo aberto: E fecha, e afastar-se também fecha
    if (this.hud.dialogOpen) {
      this.hud.setPrompt(null);
      if (this.input.justPressed(this.input.binds.interact)) { this.hud.closeDialog(); return; }
      if (this.current && ctx.playerPos.distanceTo(this.current.getPosition(_p)) > this.current.radius * 1.5) {
        this.hud.closeDialog();
      }
      return;
    }

    let best = null, bestD = Infinity;
    for (const it of this.items) {
      if (!it.enabled(ctx)) continue;
      const d = ctx.playerPos.distanceTo(it.getPosition(_p));
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
    }
    this.current = best;
    this.hud.setPrompt(best ? best.label(ctx) : null);

    if (best && this.input.justPressed(this.input.binds.interact)) best.interact(ctx);
  }
}
