// Device readers: keyboard, Gamepad API and the touch-control state. Each frame they
// produce RawIntents; src/input/mapping.ts merges, smooths and rate-limits them.
import {
  InputShaper,
  mapGamepad,
  mapKeyboard,
  mapTouch,
  mergeIntents,
  type PadState,
  type RawIntent,
  type TouchState,
} from './mapping';
import type { PilotInput } from '../sim/types';

/** Keys the game uses, so the browser does not scroll or tab on them. */
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** 'cam1'..'cam5' pick a camera directly (Numpad 1-5: the digit row sets the throttle). */
export type UiKey = 'pause' | 'camera' | 'cameraAuto' | 'cam1' | 'cam2' | 'cam3' | 'cam4' | 'cam5';
const CAM_KEYS: Record<string, UiKey> = { Numpad1: 'cam1', Numpad2: 'cam2', Numpad3: 'cam3', Numpad4: 'cam4', Numpad5: 'cam5' };

interface Haptics {
  playEffect?: (
    type: 'dual-rumble',
    params: { duration: number; strongMagnitude: number; weakMagnitude: number },
  ) => Promise<unknown>;
}

export class InputDevices {
  readonly touch: TouchState = {
    stickX: 0,
    stickY: 0,
    slider: null,
    catchHeldFor: 0,
    ignitePressed: false,
    stepDownPressed: false,
    goPressed: false,
    divertHeldFor: 0,
  };
  /** True while the touch CATCH / DIVERT controls are held (the UI sets these). */
  touchCatchDown = false;
  touchDivertDown = false;

  private held = new Set<string>();
  /** Keys pressed since the last sample: a tap shorter than one frame still counts once. */
  private tapped = new Set<string>();
  private xHeld = 0;
  private bHeld = 0;
  private shaper = new InputShaper();
  private padIndex: number | null = null;
  private lastRumble = 0;
  private uiListeners: ((k: UiKey) => void)[] = [];
  private prevPadButtons: boolean[] = [];

  constructor(private readonly target: Window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('gamepadconnected', (e: GamepadEvent) => {
      this.padIndex = e.gamepad.index;
    });
    target.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
      if (this.padIndex === e.gamepad.index) this.padIndex = null;
    });
  }

  onUiKey(fn: (k: UiKey) => void): void {
    this.uiListeners.push(fn);
  }

  private emitUi(k: UiKey): void {
    for (const fn of this.uiListeners) fn(k);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT')) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'Escape' || e.code === 'KeyP') this.emitUi('pause');
      if (e.code === 'KeyC') this.emitUi('camera');
      if (e.code === 'KeyV') this.emitUi('cameraAuto');
      const cam = CAM_KEYS[e.code];
      if (cam) this.emitUi(cam);
    }
    this.held.add(e.code);
    this.tapped.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private onBlur = (): void => {
    this.held.clear();
    this.tapped.clear();
  };

  /** Clears held keys and touch state (on pause / new run). */
  reset(): void {
    this.held.clear();
    this.tapped.clear();
    this.xHeld = 0;
    this.bHeld = 0;
    this.touchCatchDown = false;
    this.touchDivertDown = false;
    Object.assign(this.touch, {
      stickX: 0,
      stickY: 0,
      slider: null,
      catchHeldFor: 0,
      ignitePressed: false,
      stepDownPressed: false,
      goPressed: false,
      divertHeldFor: 0,
    });
    this.shaper = new InputShaper();
  }

  private pad(): Gamepad | null {
    let pads: (Gamepad | null)[] = [];
    try {
      pads = this.target.navigator.getGamepads ? Array.from(this.target.navigator.getGamepads()) : [];
    } catch {
      return null;
    }
    if (this.padIndex !== null) return pads[this.padIndex] ?? null;
    return pads.find((p): p is Gamepad => !!p && p.connected) ?? null;
  }

  /** Reads every device and returns the shaped pilot input for this frame. */
  sample(dt: number): PilotInput {
    this.xHeld = this.held.has('KeyX') ? this.xHeld + dt : 0;
    const keys = this.tapped.size ? new Set([...this.held, ...this.tapped]) : this.held;
    this.tapped.clear();
    const list: RawIntent[] = [mapKeyboard(keys, this.xHeld)];

    const gp = this.pad();
    if (gp) {
      const state: PadState = {
        axes: gp.axes,
        buttons: gp.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
      };
      this.bHeld = gp.buttons[1]?.pressed ? this.bHeld + dt : 0;
      list.push(mapGamepad(state, this.bHeld));
      const pressed = gp.buttons.map((b) => b.pressed);
      const edge = (i: number): boolean => !!pressed[i] && !this.prevPadButtons[i];
      if (edge(3) || edge(12) || edge(13)) this.emitUi('camera');
      if (edge(8)) this.emitUi('pause');
      this.prevPadButtons = pressed;
    }

    this.touch.catchHeldFor = this.touchCatchDown ? this.touch.catchHeldFor + dt : 0;
    this.touch.divertHeldFor = this.touchDivertDown ? this.touch.divertHeldFor + dt : 0;
    list.push(mapTouch(this.touch));
    // One-shot touch buttons fire for one frame.
    this.touch.ignitePressed = false;
    this.touch.stepDownPressed = false;
    this.touch.goPressed = false;

    return this.shaper.update(mergeIntents(list), dt);
  }

  /** Gamepad rumble scaled by thrust (0..1). Throttled to ~8 Hz. */
  rumble(level: number, nowMs: number): void {
    if (level <= 0.02 || nowMs - this.lastRumble < 120) return;
    const gp = this.pad();
    const act = (gp as unknown as { vibrationActuator?: Haptics } | null)?.vibrationActuator;
    if (!act?.playEffect) return;
    this.lastRumble = nowMs;
    act
      .playEffect('dual-rumble', {
        duration: 140,
        strongMagnitude: Math.min(1, level),
        weakMagnitude: Math.min(1, level * 0.6),
      })
      .catch(() => undefined);
  }

  /** A single strong pulse (catch thud). */
  thud(): void {
    const gp = this.pad();
    const act = (gp as unknown as { vibrationActuator?: Haptics } | null)?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { duration: 260, strongMagnitude: 1, weakMagnitude: 0.8 }).catch(() => undefined);
  }
}
