// Pure input mapping: keyboard / gamepad / touch -> PilotInput, with smoothing and rate limits.
// No DOM access here, so it is unit-testable; src/input/* device code feeds it raw state.
import type { PilotInput } from '../sim/types';

export const STICK_RATE = 3.0; // stick units per second (full deflection in ~0.33 s)
export const THROTTLE_LEVER_RATE = 1.5; // lever units per second
export const KEY_THROTTLE_RATE = 0.6; // lever units per second while Shift / Ctrl is held
export const STICK_SMOOTH_TAU = 0.06; // s
export const DEADZONE = 0.12;
export const DIVERT_HOLD = 1.0; // s to hold X / B for a No-Go
export const CATCH_HOLD = 0.3; // s to hold the touch CATCH button

export const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Moves `prev` toward `target` by at most rate*dt. */
export function rateLimit(prev: number, target: number, rate: number, dt: number): number {
  const d = clampN(target - prev, -rate * dt, rate * dt);
  return prev + d;
}

/** First-order low-pass toward `target`. */
export function smooth(prev: number, target: number, tau: number, dt: number): number {
  if (tau <= 0) return target;
  const a = 1 - Math.exp(-dt / tau);
  return prev + (target - prev) * a;
}

/** Radial deadzone with rescale, returns a vector of length <= 1. */
export function deadzone(x: number, y: number, dz = DEADZONE): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

/** Raw intent from one device for one frame (before smoothing). */
export interface RawIntent {
  stickX: number;
  stickZ: number;
  yaw: number;
  /** Absolute lever target (0..1), or null to keep the current lever. */
  throttleSet: number | null;
  /** Lever change per second (from held keys / triggers). */
  throttleRate: number;
  ignite: boolean;
  stepDown: boolean;
  closeArms: boolean;
  go: boolean;
  noGo: boolean;
}

export const emptyIntent = (): RawIntent => ({
  stickX: 0,
  stickZ: 0,
  yaw: 0,
  throttleSet: null,
  throttleRate: 0,
  ignite: false,
  stepDown: false,
  closeArms: false,
  go: false,
  noGo: false,
});

/**
 * Keyboard (design section 5): WASD tilt, Shift/Ctrl throttle, 1-9 throttle set,
 * Q/E roll, R step down, Space close arms, Enter GO / ignite, X held 1 s = No-Go.
 * `held` is the set of KeyboardEvent.code values down now; `xHeldFor` is seconds X has been held.
 */
export function mapKeyboard(held: ReadonlySet<string>, xHeldFor = 0): RawIntent {
  const i = emptyIntent();
  const k = (c: string): number => (held.has(c) ? 1 : 0);
  i.stickX = k('KeyD') - k('KeyA');
  i.stickZ = k('KeyS') - k('KeyW');
  i.yaw = k('KeyE') - k('KeyQ');
  const up = held.has('ShiftLeft') || held.has('ShiftRight');
  const down = held.has('ControlLeft') || held.has('ControlRight');
  i.throttleRate = (up ? KEY_THROTTLE_RATE : 0) - (down ? KEY_THROTTLE_RATE : 0);
  for (let d = 1; d <= 9; d++) if (held.has(`Digit${d}`)) i.throttleSet = (d - 1) / 8;
  i.stepDown = held.has('KeyR');
  i.closeArms = held.has('Space');
  i.go = held.has('Enter');
  i.ignite = held.has('Enter') || held.has('KeyI');
  i.noGo = held.has('KeyX') && xHeldFor >= DIVERT_HOLD;
  return i;
}

/** Standard-mapping gamepad: axes [lx, ly, rx, ry]; buttons A0 B1 X2 Y3 LB4 RB5 LT6 RT7 ... */
export interface PadState {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export function mapGamepad(p: PadState, bHeldFor = 0): RawIntent {
  const i = emptyIntent();
  const [lx, ly] = deadzone(p.axes[0] ?? 0, p.axes[1] ?? 0);
  i.stickX = lx;
  i.stickZ = ly;
  const [rx] = deadzone(p.axes[2] ?? 0, 0);
  i.yaw = rx;
  const btn = (n: number): { pressed: boolean; value: number } => p.buttons[n] ?? { pressed: false, value: 0 };
  i.throttleRate = (btn(7).value - btn(6).value) * THROTTLE_LEVER_RATE;
  i.closeArms = btn(0).pressed;
  i.noGo = btn(1).pressed && bHeldFor >= DIVERT_HOLD;
  i.stepDown = btn(5).pressed;
  i.go = btn(9).pressed; // Start / Menu
  i.ignite = btn(2).pressed || btn(9).pressed;
  return i;
}

/** Touch: left virtual stick (-1..1), right throttle slider (0..1), CATCH hold time. */
export interface TouchState {
  stickX: number;
  stickY: number;
  slider: number | null;
  catchHeldFor: number;
  ignitePressed: boolean;
  stepDownPressed: boolean;
  goPressed: boolean;
  divertHeldFor: number;
}

export function mapTouch(t: TouchState): RawIntent {
  const i = emptyIntent();
  const [x, y] = deadzone(t.stickX, t.stickY, 0.08);
  i.stickX = x;
  i.stickZ = y;
  i.throttleSet = t.slider === null ? null : clampN(t.slider, 0, 1);
  i.closeArms = t.catchHeldFor >= CATCH_HOLD;
  i.ignite = t.ignitePressed;
  i.stepDown = t.stepDownPressed;
  i.go = t.goPressed;
  i.noGo = t.divertHeldFor >= DIVERT_HOLD;
  return i;
}

/** Merges several devices: sticks add (clamped), buttons OR, last absolute throttle wins. */
export function mergeIntents(list: readonly RawIntent[]): RawIntent {
  const out = emptyIntent();
  for (const i of list) {
    out.stickX += i.stickX;
    out.stickZ += i.stickZ;
    out.yaw += i.yaw;
    out.throttleRate += i.throttleRate;
    if (i.throttleSet !== null) out.throttleSet = i.throttleSet;
    out.ignite ||= i.ignite;
    out.stepDown ||= i.stepDown;
    out.closeArms ||= i.closeArms;
    out.go ||= i.go;
    out.noGo ||= i.noGo;
  }
  out.stickX = clampN(out.stickX, -1, 1);
  out.stickZ = clampN(out.stickZ, -1, 1);
  out.yaw = clampN(out.yaw, -1, 1);
  return out;
}

/** Turns raw intents into the smoothed, rate-limited PilotInput the sim consumes. */
export class InputShaper {
  private s: PilotInput = {
    stickX: 0,
    stickZ: 0,
    throttle: 0.5,
    yaw: 0,
    ignite: false,
    stepDown: false,
    closeArms: false,
    go: false,
    noGo: false,
  };
  private lever = 0.5;

  get state(): PilotInput {
    return { ...this.s };
  }

  update(raw: RawIntent, dt: number): PilotInput {
    // Lever: absolute sets are rate-limited too, so a "9" keypress ramps instead of jumping.
    let target = this.lever + raw.throttleRate * dt;
    if (raw.throttleSet !== null) target = raw.throttleSet;
    this.lever = rateLimit(this.lever, clampN(target, 0, 1), THROTTLE_LEVER_RATE, dt);
    const sx = rateLimit(this.s.stickX, clampN(raw.stickX, -1, 1), STICK_RATE, dt);
    const sz = rateLimit(this.s.stickZ, clampN(raw.stickZ, -1, 1), STICK_RATE, dt);
    this.s = {
      stickX: smooth(this.s.stickX, sx, STICK_SMOOTH_TAU, dt),
      stickZ: smooth(this.s.stickZ, sz, STICK_SMOOTH_TAU, dt),
      throttle: this.lever,
      yaw: rateLimit(this.s.yaw, clampN(raw.yaw, -1, 1), STICK_RATE, dt),
      ignite: raw.ignite,
      stepDown: raw.stepDown,
      closeArms: raw.closeArms,
      go: raw.go,
      noGo: raw.noGo,
    };
    return this.state;
  }
}
