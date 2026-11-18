/**
 * PlayerStats.js
 * Vida e fome no estilo survival:
 *  - a fome cai com o tempo, mais rápido correndo;
 *  - com fome zerada, o jogador perde vida periodicamente;
 *  - com fome alta, regenera vida;
 *  - comer recupera fome.
 */
import { CONFIG } from '../config.js';

const S = CONFIG.survival;

export class PlayerStats {
  constructor() {
    this.health = S.maxHealth;
    this.hunger = S.maxHunger;
    this.dead = false;
    this.stamina = 100;           // fôlego: esquiva, golpe carregado, corrida
    this._staminaWait = 0;
    this.difficulty = 1;          // multiplicador de dano recebido (Configurações)
    this._starve = 0;
    this._regen = 0;
    this.onDamage = () => {};
    this.onDeath = () => {};
  }

  /** Gasta fôlego; retorna false se não houver o bastante. */
  useStamina(n) {
    if (this.stamina < n) return false;
    this.stamina -= n;
    this._staminaWait = 0.8;      // espera antes de começar a recuperar
    return true;
  }

  /** Efeito temporário (café, adrenalina). */
  heal(n) { if (!this.dead) this.health = Math.min(S.maxHealth, this.health + n); }
  addBuff(b) { this.buff = { ...b, left: b.time }; this.onBuff?.(this.buff); }
  get speedMult() { return this.buff ? 1 + (this.buff.speed || 0) : 1; }

  update(dt, running) {
    if (this.dead) return;
    if (this.buff) {
      this.buff.left -= dt;
      if (this.buff.infiniteStamina) this.stamina = 100;
      if (this.buff.left <= 0) {
        if (this.buff.hungerAfter) this.hunger = Math.max(0, this.hunger - this.buff.hungerAfter);
        this.buff = null; this.onBuff?.(null);
      }
    }
    if (running && this.stamina > 0 && !this.buff?.infiniteStamina) { this.stamina = Math.max(0, this.stamina - 6 * dt); this._staminaWait = 0.4; }
    this._staminaWait -= dt;
    if (this._staminaWait <= 0) this.stamina = Math.min(100, this.stamina + 28 * (this.staminaRegenMult || 1) * dt);
    this.hunger = Math.max(0, this.hunger - S.hungerPerSecond * (running ? S.runHungerMult : 1) * dt);

    if (this.hunger <= 0) {
      this._starve += dt;
      if (this._starve >= S.starveInterval) { this._starve = 0; this.damage(1, 'fome'); }
    } else this._starve = 0;

    if (this.hunger >= S.regenThreshold && this.health < S.maxHealth) {
      this._regen += dt;
      if (this._regen >= S.regenInterval) {
        this._regen = 0;
        this.health = Math.min(S.maxHealth, this.health + 1);
        this.hunger = Math.max(0, this.hunger - 2);        // regenerar custa comida
      }
    } else this._regen = 0;
  }

  damage(amount, source = '') {
    if (this.dead) return;
    if (source !== 'fome') amount *= this.difficulty;
    this.health = Math.max(0, this.health - amount);
    this.onDamage(amount, source);
    if (this.health <= 0) { this.dead = true; this.onDeath(source); }
  }

  /** @returns {boolean} se conseguiu comer (não estava cheio) */
  /** Consome um item: fome, fôlego e efeito. Retorna false se não fizer nada. */
  consume(def) {
    const useful = (def.food && this.hunger < S.maxHunger) || (def.stamina && this.stamina < 100) || def.buff;
    if (!useful) return false;
    if (def.food) this.hunger = Math.min(S.maxHunger, this.hunger + def.food);
    if (def.stamina) this.stamina = Math.min(100, this.stamina + def.stamina);
    if (def.buff) this.addBuff(def.buff);
    return true;
  }

  eat(value) { return this.consume({ food: value }); }

  respawn() {
    this.health = S.maxHealth;
    this.hunger = Math.max(this.hunger, 70);
    this.dead = false;
  }
}
