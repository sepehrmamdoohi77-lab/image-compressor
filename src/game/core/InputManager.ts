// Centralized input: keyboard + mouse with edge detection.
// A single instance is owned by Game; attach/detach are idempotent.

export class InputManager {
  keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseLeft = false;
  mouseRight = false;
  /** Set on mousedown, cleared by Game after each frame is consumed. */
  mouseLeftPressed = false;
  mouseRightPressed = false;
  wheelDelta = 0;
  /** Queued key presses (edge) consumed once per frame. */
  private pressedQueue = new Set<string>();
  private attached = false;
  private target: HTMLElement | null = null;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const code = e.code;
    this.keys.add(code);
    this.pressedQueue.add(code);
    if (code === 'Space' || code === 'Tab') e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseLeft = true;
      this.mouseLeftPressed = true;
    } else if (e.button === 2) {
      this.mouseRight = true;
      this.mouseRightPressed = true;
    }
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseLeft = false;
    else if (e.button === 2) this.mouseRight = false;
  };
  private onWheel = (e: WheelEvent): void => {
    this.wheelDelta += e.deltaY;
  };
  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };
  private onBlur = (): void => {
    this.keys.clear();
    this.pressedQueue.clear();
    this.mouseLeft = false;
    this.mouseRight = false;
  };

  attach(target: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('wheel', this.onWheel, { passive: true });
    target.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.target?.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.target?.removeEventListener('wheel', this.onWheel);
    this.target?.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
    this.target = null;
    this.keys.clear();
    this.pressedQueue.clear();
    this.mouseLeft = this.mouseRight = false;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Edge-triggered: true only on the frame the key was pressed. */
  wasPressed(code: string): boolean {
    return this.pressedQueue.has(code);
  }

  /** Movement axes in screen space: x right+, y down+ (W = y -1). */
  moveAxes(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  consumeWheel(): number {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }

  /** Called at the end of each game frame. */
  endFrame(): void {
    this.pressedQueue.clear();
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
  }

  /** Clear all state (used on pause / state transitions). */
  reset(): void {
    this.keys.clear();
    this.pressedQueue.clear();
    this.mouseLeft = this.mouseRight = false;
    this.mouseLeftPressed = this.mouseRightPressed = false;
    this.wheelDelta = 0;
  }
}
