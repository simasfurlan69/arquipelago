/**
 * Input.js
 * Teclado e mouse:
 *  - teclas pressionadas e "acabou de pressionar" (edge) por frame;
 *  - botões do mouse (down / justPressed / justReleased);
 *  - pointer lock: clique no jogo trava o cursor e o mouse gira a câmera.
 *    Sem trava, arrastar também orbita (modo legado);
 *  - roda do mouse (troca o slot da hotbar);
 *  - flag uiOpen: com o inventário aberto, o gameplay ignora os comandos.
 */
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = new Set();
    this.mousePressed = new Set();
    this.mouseReleased = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.dragging = false;
    this.locked = false;
    this.uiOpen = false;
    this.lastMouseMove = -Infinity;
    /** Em testes automatizados: aceita cliques sem pointer lock. */
    this.allowUnlockedActions = false;
    /** Teclas configuráveis (aba Controles). */
    this.binds = { dodge: 'ControlLeft', lock: 'KeyQ', interact: 'KeyE', inventory: 'Tab', jump: 'Space' };
    this.sensitivity = 1;
    this.invertY = false;

    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.clear(); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
    });

    dom.addEventListener('mousedown', (e) => {
      if (this.uiOpen) return;
      if (!this.locked && !this.allowUnlockedActions) {
        // Primeiro clique só trava o cursor (não ataca)
        dom.requestPointerLock?.();
        this.dragging = true;
        return;
      }
      this.mouse.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.dragging = false;
      if (this.mouse.has(e.button)) this.mouseReleased.add(e.button);
      this.mouse.delete(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.uiOpen) return;
      if (!this.locked && !this.dragging) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
      this.lastMouseMove = performance.now();
    });
    dom.addEventListener('wheel', (e) => { if (!this.uiOpen) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(code) { return !this.uiOpen && this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }

  mouseDown(b = 0) { return !this.uiOpen && this.mouse.has(b); }
  mouseJustPressed(b = 0) { return !this.uiOpen && this.mousePressed.has(b); }
  mouseJustReleased(b = 0) { return this.mouseReleased.has(b); }

  releasePointer() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Eixos WASD/setas: {x: direita(+)/esquerda(-), y: frente(+)/trás(-)}. */
  axes() {
    const x = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    const y = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    return { x, y };
  }

  /** Deve ser chamado no fim de cada frame. */
  endFrame() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
  }
}
