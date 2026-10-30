// Device readers: keyboard, Gamepad API and the touch-control state. Each frame they
// produce RawIntents; src/input/mapping.ts merges, smooths and rate-limits them.
import {
  InputShaper,
  STANDARD_KEYS,
  divertHeld,
  mapGamepad,
  mapKeyboard,
  mapTouch,
  mergeIntents,
  rotateStick,
  type KeyMap,
  type PadState,
  type RawIntent,
  type TouchState,
} from './mapping';
import type { PilotInput } from '../sim/types';

/** Keys the game uses, so the browser does not scroll on them. */
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** 'cam1'..'cam5' pick a camera directly (Numpad 1-5: the digit row sets the throttle). */
export type UiKey = 'pause' | 'camera' | 'cameraAuto' | 'mute' | 'cam1' | 'cam2' | 'cam3' | 'cam4' | 'cam5';
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
  private keymap: KeyMap = { ...STANDARD_KEYS };
  /** While true (key remapping in Settings), keys do not reach the game. */
  capturing = false;
  /** True while a gamepad is connected and has been used. */
  padActive = false;
  /** Stick deflection (0..~1.4) in the last sample, before smoothing. */
  rawStick = 0;

  setKeyMap(km: KeyMap): void {
    this.keymap = km;
  }

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
    if (this.capturing) return;
    if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT')) return;
    // Keyboard navigation of the left menu: Space / Enter / arrows act on the focused control.
    const inMenu = !!t && t !== document.body && typeof t.closest === 'function' && t.closest('#rail') !== null;
    if (inMenu && e.code !== 'Escape') return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'Escape' || e.code === 'KeyP') this.emitUi('pause');
      if (e.code === 'KeyC') this.emitUi('camera');
      if (e.code === 'KeyV') this.emitUi('cameraAuto');
      if (e.code === 'KeyM') this.emitUi('mute');
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

  /** Seconds the divert control has been held on any device (keyboard, pad, touch). */
  get divertHold(): number {
    return Math.max(this.xHeld, this.bHeld, this.touch.divertHeldFor);
  }

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

  /**
   * Reads every device and returns the shaped pilot input for this frame. `stickYaw`
   * rotates the merged stick from screen axes into world axes before the shaper, so the
   * smoothed values (and the replay log) are world values.
   */
  sample(dt: number, stickYaw = 0): PilotInput {
    this.xHeld = divertHeld(this.held, this.keymap) ? this.xHeld + dt : 0;
    const keys = this.tapped.size ? new Set([...this.held, ...this.tapped]) : this.held;
    this.tapped.clear();
    const list: RawIntent[] = [mapKeyboard(keys, this.xHeld, this.keymap)];

    const gp = this.pad();
    if (gp) {
      const state: PadState = {
        axes: gp.axes,
        buttons: gp.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
      };
      this.bHeld = gp.buttons[1]?.pressed ? this.bHeld + dt : 0;
      list.push(mapGamepad(state, this.bHeld));
      const pressed = gp.buttons.map((b) => b.pressed);
      if (pressed.some(Boolean) || gp.axes.some((a) => Math.abs(a) > 0.3)) this.padActive = true;
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

    const raw = mergeIntents(list);
    this.rawStick = Math.hypot(raw.stickX, raw.stickZ);
    if (stickYaw !== 0) [raw.stickX, raw.stickZ] = rotateStick(raw.stickX, raw.stickZ, stickYaw);
    return this.shaper.update(raw, dt);
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
