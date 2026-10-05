import type { InputIntent } from '../multiplayer/protocol';
import type { Settings } from '../services/Settings';
interface Stick {
  pointerId: number | null;
  x: number;
  y: number;
  originX: number;
  originY: number;
}
const stick = (): Stick => ({ pointerId: null, x: 0, y: 0, originX: 0, originY: 0 });

/** Local intent only. Keyboard, pointer, touch and standard gamepad share one contract. */
export class InputController {
  private keys = new Set<string>();
  private controller = new AbortController();
  private moveStick = stick();
  private faceStick = stick();
  private touchSprint = false;
  private crouched = false;
  private touchAds = false;
  private mouseAds = false;
  private mouseFire = false;
  private touchFire = false;
  private aim = 0;
  private pitch = 0;
  private gamepadButtons = new Set<number>();
  pointer = { x: 0, y: 0, active: false };
  enabled = false;
  modality: 'keyboard' | 'touch' | 'gamepad' = 'keyboard';
  constructor(
    private root: HTMLElement,
    private getSettings: () => Settings,
    private menu: () => void,
    private roster: (visible: boolean) => void,
    private zoom: (delta: number) => void,
    private action: (action: string) => void = () => {},
    private changed: () => void = () => {},
  ) {
    const signal = this.controller.signal;
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Escape') {
          e.preventDefault();
          this.menu();
          return;
        }
        if (
          !this.enabled ||
          (e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))
        )
          return;
        const commands: Record<string, string> = {
          KeyR: 'reload',
          Digit1: 'weapon-1',
          Digit2: 'weapon-2',
          Digit3: 'grenade',
          KeyG: 'grenade',
        };
        if (commands[e.code]) {
          e.preventDefault();
          if (!e.repeat) this.action(commands[e.code]!);
          return;
        }
        if (e.code === 'KeyC') {
          e.preventDefault();
          if (!e.repeat) {
            this.crouched = !this.crouched;
            this.changed();
          }
          return;
        }
        if (
          [
            'KeyW',
            'KeyA',
            'KeyS',
            'KeyD',
            'KeyQ',
            'KeyE',
            'ShiftLeft',
            'ShiftRight',
            'Tab',
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
          ].includes(e.code)
        ) {
          e.preventDefault();
          this.keys.add(e.code);
          this.modality = 'keyboard';
          if (e.code === 'Tab') this.roster(true);
          this.changed();
        }
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e) => {
        this.keys.delete(e.code);
        if (e.code === 'Tab') this.roster(false);
        this.changed();
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        this.reset();
        this.changed();
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.reset();
          this.changed();
        }
      },
      { signal },
    );
    const pointer = (e: MouseEvent | PointerEvent) => {
      if ('pointerType' in e && e.pointerType === 'touch') return;
      const rect = root.getBoundingClientRect();
      this.pointer = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        active: true,
      };
    };
    root.addEventListener('pointermove', pointer, { signal });
    // Mouse down/up, rather than pointer down/up, are required for simultaneous
    // RMB ADS + LMB fire: pointerdown fires only for the FIRST pressed button.
    root.addEventListener(
      'mousedown',
      (e) => {
        if (!this.enabled || !(e.target instanceof HTMLCanvasElement)) return;
        pointer(e);
        if (e.button === 0) this.mouseFire = true;
        if (e.button === 2) this.mouseAds = true;
        this.changed();
      },
      { signal },
    );
    window.addEventListener(
      'mouseup',
      (e) => {
        if (e.button === 0) this.mouseFire = false;
        if (e.button === 2) this.mouseAds = false;
        this.changed();
      },
      { signal },
    );
    root.addEventListener(
      'wheel',
      (e) => {
        if (this.enabled) {
          e.preventDefault();
          this.zoom(e.deltaY > 0 ? 0.8 : -0.8);
        }
      },
      { signal, passive: false },
    );
    root.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    for (const kind of ['move', 'face'] as const) {
      const el = root.querySelector<HTMLElement>(`[data-stick="${kind}"]`);
      if (!el) continue;
      const state = kind === 'move' ? this.moveStick : this.faceStick;
      const update = (e: PointerEvent) => {
        if (e.pointerId !== state.pointerId) return;
        const radius = el.clientWidth * 0.34,
          dx = e.clientX - state.originX,
          dy = e.clientY - state.originY,
          length = Math.max(radius, Math.hypot(dx, dy));
        state.x = dx / length;
        state.y = dy / length;
        el.style.setProperty('--stick-x', `${state.x * radius}px`);
        el.style.setProperty('--stick-y', `${state.y * radius}px`);
        this.changed();
      };
      el.addEventListener(
        'pointerdown',
        (e) => {
          if (!this.enabled || state.pointerId !== null) return;
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          this.modality = 'touch';
          this.pointer.active = false;
          const rect = el.getBoundingClientRect();
          state.pointerId = e.pointerId;
          state.originX = rect.left + rect.width / 2;
          state.originY = rect.top + rect.height / 2;
          update(e);
        },
        { signal },
      );
      el.addEventListener('pointermove', update, { signal });
      const end = (e: PointerEvent) => {
        if (e.pointerId !== state.pointerId) return;
        state.pointerId = null;
        state.x = state.y = 0;
        el.style.setProperty('--stick-x', '0px');
        el.style.setProperty('--stick-y', '0px');
        this.changed();
      };
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
        el.addEventListener(event, end, { signal });
    }
    root.querySelector<HTMLElement>('[data-touch-fire]')?.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        this.touchFire = true;
        this.changed();
      },
      { signal },
    );
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      root.querySelector('[data-touch-fire]')?.addEventListener(
        event,
        () => {
          this.touchFire = false;
          this.changed();
        },
        { signal },
      );
    for (const key of ['sprint', 'ads', 'crouch'] as const)
      root.querySelector(`[data-touch-${key}]`)?.addEventListener(
        'click',
        (e) => {
          if (!this.enabled) return;
          if (key === 'sprint') this.touchSprint = !this.touchSprint;
          if (key === 'ads') this.touchAds = !this.touchAds;
          if (key === 'crouch') this.crouched = !this.crouched;
          const active =
            key === 'sprint' ? this.touchSprint : key === 'ads' ? this.touchAds : this.crouched;
          (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(active));
          this.changed();
        },
        { signal },
      );
  }
  faceMouse(x: number, z: number, ownX: number, ownZ: number, y?: number, originY = 1.21) {
    const range = Math.hypot(x - ownX, z - ownZ);
    if (this.pointer.active && range > 0.05) {
      this.aim = Math.atan2(x - ownX, z - ownZ);
      this.pitch =
        y === undefined ? 0 : Math.max(-0.5, Math.min(0.5, Math.atan2(y - originY, range)));
    }
  }
  rotation(dt: number) {
    return this.enabled
      ? ((this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0)) *
          dt *
          this.getSettings().rotationSpeed
      : 0;
  }
  sample(cameraYaw: number): InputIntent {
    let x = 0,
      y = 0,
      fx = 0,
      fy = 0,
      sprint = false,
      fire = false,
      ads = false;
    if (this.enabled) {
      x =
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      y =
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
        (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
      if (this.moveStick.pointerId !== null) {
        x = this.moveStick.x;
        y = this.moveStick.y;
      }
      if (this.faceStick.pointerId !== null) {
        fx = this.faceStick.x;
        fy = this.faceStick.y;
      }
      sprint = this.touchSprint || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      fire = this.mouseFire || this.touchFire;
      ads = this.mouseAds || this.touchAds;
      const pad = navigator.getGamepads?.().find((p) => p?.connected);
      if (pad) {
        const dz = this.getSettings().gamepadDeadzone;
        const axis = (i: number) => (Math.abs(pad.axes[i] ?? 0) < dz ? 0 : (pad.axes[i] ?? 0));
        const gx = axis(0),
          gy = axis(1),
          ax = axis(2),
          ay = axis(3);
        if (Math.hypot(gx, gy, ax, ay) > 0.01) {
          this.modality = 'gamepad';
          this.pointer.active = false;
        }
        if (gx || gy) {
          x = gx;
          y = gy;
        }
        if (ax || ay) {
          fx = ax;
          fy = ay;
        }
        fire ||= Boolean(pad.buttons[7]?.pressed);
        ads ||= Boolean(pad.buttons[6]?.pressed);
        sprint ||= Boolean(pad.buttons[5]?.pressed);
        const buttons = new Set(
          pad.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0),
        );
        for (const [index, cmd] of [
          [2, 'reload'],
          [3, 'weapon-toggle'],
          [4, 'grenade'],
        ] as const)
          if (buttons.has(index) && !this.gamepadButtons.has(index)) this.action(cmd);
        if (buttons.has(11) && !this.gamepadButtons.has(11)) this.crouched = !this.crouched;
        this.gamepadButtons = buttons;
      }
    }
    const length = Math.max(1, Math.hypot(x, y));
    x /= length;
    y /= length;
    const rx = Math.cos(cameraYaw),
      rz = -Math.sin(cameraYaw),
      dx = Math.sin(cameraYaw),
      dz = Math.cos(cameraYaw);
    if (Math.hypot(fx, fy) > 0.12) {
      const target = Math.atan2(rx * fx + dx * fy, rz * fx + dz * fy);
      const delta = Math.atan2(Math.sin(target - this.aim), Math.cos(target - this.aim));
      this.aim += delta * Math.min(1, 0.35 * this.getSettings().aimSensitivity);
      this.pitch = 0;
      if (this.modality === 'touch' && this.getSettings().touchAutoFire) fire = true;
    }
    this.aim = Math.atan2(Math.sin(this.aim), Math.cos(this.aim));
    return {
      moveX: rx * x + dx * y,
      moveZ: rz * x + dz * y,
      aim: this.aim,
      pitch: this.pitch,
      sprint: this.enabled && sprint,
      trigger: this.enabled && fire,
      ads: this.enabled && ads,
      crouch: this.enabled && this.crouched,
    };
  }
  reset() {
    this.keys.clear();
    this.mouseFire =
      this.mouseAds =
      this.touchFire =
      this.touchSprint =
      this.touchAds =
      this.crouched =
        false;
    for (const s of [this.moveStick, this.faceStick]) {
      s.x = s.y = 0;
      s.pointerId = null;
    }
    this.gamepadButtons.clear();
    this.root.querySelectorAll<HTMLElement>('[data-stick]').forEach((e) => {
      e.style.setProperty('--stick-x', '0px');
      e.style.setProperty('--stick-y', '0px');
    });
    this.root
      .querySelectorAll('[data-touch-sprint],[data-touch-ads],[data-touch-crouch]')
      .forEach((e) => e.setAttribute('aria-pressed', 'false'));
  }
  dispose() {
    this.reset();
    this.controller.abort();
  }
}
