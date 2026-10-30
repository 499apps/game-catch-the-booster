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

/**
 * Camera-relative steering: turns a screen stick (x right, z down the screen) into world
 * x/z for a camera with stick yaw `yaw` (see stickYawFrom in src/render/cameras.ts).
 * Yaw 0 is a camera looking along world -z, where screen and world axes agree.
 */
export function rotateStick(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * x + s * z, -s * x + c * z];
}

/** The inverse of rotateStick: a world x/z vector in screen axes (x right, z down). */
export function worldToScreen(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * x - s * z, s * x + c * z];
}

/** Angle interpolation along the short way round (k = 0..1). */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
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

// ---------------------------------------------------------------- remappable keys

export type KeyAction =
  | 'tiltLeft'
  | 'tiltRight'
  | 'tiltFwd'
  | 'tiltBack'
  | 'rollLeft'
  | 'rollRight'
  | 'throttleUp'
  | 'throttleDown'
  | 'ignite'
  | 'stepDown'
  | 'catch'
  | 'go'
  | 'divert';

export const KEY_ACTIONS: readonly KeyAction[] = [
  'tiltLeft',
  'tiltRight',
  'tiltFwd',
  'tiltBack',
  'rollLeft',
  'rollRight',
  'throttleUp',
  'throttleDown',
  'ignite',
  'stepDown',
  'catch',
  'go',
  'divert',
];

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  tiltLeft: 'Tilt left',
  tiltRight: 'Tilt right',
  tiltFwd: 'Tilt forward',
  tiltBack: 'Tilt back',
  rollLeft: 'Roll left (FD)',
  rollRight: 'Roll right (FD)',
  throttleUp: 'Throttle up',
  throttleDown: 'Throttle down',
  ignite: 'Light engines',
  stepDown: 'Step down 13 → 3',
  catch: 'CATCH (close arms)',
  go: 'GO for catch',
  divert: 'Divert (hold 1 s)',
};

/** Each action has one or more KeyboardEvent.code values. */
export type KeyMap = Record<KeyAction, string[]>;

export type KeyPreset = 'standard' | 'onehand';

/** Design section 5: WASD tilt, Shift/Ctrl throttle, Q/E roll, R step down, Space arms, Enter GO, X divert. */
export const STANDARD_KEYS: Readonly<KeyMap> = Object.freeze({
  tiltLeft: ['KeyA', 'ArrowLeft'],
  tiltRight: ['KeyD', 'ArrowRight'],
  tiltFwd: ['KeyW', 'ArrowUp'],
  tiltBack: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['ControlLeft', 'ControlRight'],
  ignite: ['Enter', 'KeyI'],
  stepDown: ['KeyR'],
  catch: ['Space'],
  go: ['Enter'],
  divert: ['KeyX'],
});

/** One hand on the left of the keyboard: everything within reach of WASD. */
export const ONEHAND_KEYS: Readonly<KeyMap> = Object.freeze({
  tiltLeft: ['KeyA'],
  tiltRight: ['KeyD'],
  tiltFwd: ['KeyW'],
  tiltBack: ['KeyS'],
  rollLeft: ['KeyZ'],
  rollRight: ['KeyG'],
  throttleUp: ['KeyE'],
  throttleDown: ['KeyQ'],
  ignite: ['KeyF'],
  stepDown: ['KeyR'],
  catch: ['Space'],
  go: ['KeyF'],
  divert: ['KeyX'],
});

export function presetKeys(p: KeyPreset): KeyMap {
  const src = p === 'onehand' ? ONEHAND_KEYS : STANDARD_KEYS;
  const out = {} as KeyMap;
  for (const a of KEY_ACTIONS) out[a] = [...src[a]];
  return out;
}

/** Keys with a fixed meaning (menus, cameras, mute, throttle digits): never rebindable. */
export function isReservedKey(code: string): boolean {
  return (
    code === 'Escape' ||
    code === 'KeyP' ||
    code === 'KeyC' ||
    code === 'KeyV' ||
    code === 'KeyM' ||
    code === 'Tab' ||
    /^Digit[0-9]$/.test(code) ||
    /^Numpad/.test(code) ||
    /^(Meta|OS|Alt)/.test(code)
  );
}

const CODE_RE = /^[A-Za-z0-9]{1,24}$/;

/** Validates a stored key map; unknown or broken entries fall back to the standard keys. */
export function sanitizeKeyMap(raw: unknown): KeyMap {
  const out = presetKeys('standard');
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const a of KEY_ACTIONS) {
    const v = r[a];
    if (!Array.isArray(v)) continue;
    const codes = v.filter((c): c is string => typeof c === 'string' && CODE_RE.test(c) && !isReservedKey(c)).slice(0, 3);
    if (codes.length) out[a] = codes;
  }
  return out;
}

/**
 * Binds `code` as the only key of `action`. Other actions lose that key (no conflicts),
 * except GO / ignite, which may share a key. Reserved keys return the map unchanged.
 */
export function rebind(km: KeyMap, action: KeyAction, code: string): KeyMap {
  if (isReservedKey(code) || !CODE_RE.test(code)) return km;
  const shareable = (a: KeyAction): boolean =>
    (action === 'go' && a === 'ignite') || (action === 'ignite' && a === 'go');
  const out = {} as KeyMap;
  for (const a of KEY_ACTIONS) {
    if (a === action) out[a] = [code];
    else out[a] = shareable(a) ? [...km[a]] : km[a].filter((c) => c !== code);
  }
  return out;
}

/** "KeyA" -> "A", "ArrowLeft" -> "←", "ShiftLeft" -> "Shift". */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const arrows: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  const arrow = arrows[code];
  if (arrow) return arrow;
  return code.replace(/(Left|Right)$/, '');
}

const anyHeld = (held: ReadonlySet<string>, codes: readonly string[]): boolean => codes.some((c) => held.has(c));

/**
 * Keyboard (design section 5), through a remappable key map. Digits 1-9 always set
 * the throttle lever. `held` is the set of KeyboardEvent.code values down now;
 * `divertHeldFor` is how long a divert key has been held.
 */
export function mapKeyboard(held: ReadonlySet<string>, divertHeldFor = 0, km: Readonly<KeyMap> = STANDARD_KEYS): RawIntent {
  const i = emptyIntent();
  const k = (a: KeyAction): number => (anyHeld(held, km[a]) ? 1 : 0);
  i.stickX = k('tiltRight') - k('tiltLeft');
  i.stickZ = k('tiltBack') - k('tiltFwd');
  i.yaw = k('rollRight') - k('rollLeft');
  i.throttleRate = (k('throttleUp') - k('throttleDown')) * KEY_THROTTLE_RATE;
  for (let d = 1; d <= 9; d++) if (held.has(`Digit${d}`)) i.throttleSet = (d - 1) / 8;
  i.stepDown = k('stepDown') === 1;
  i.closeArms = k('catch') === 1;
  i.go = k('go') === 1;
  i.ignite = k('ignite') === 1;
  i.noGo = k('divert') === 1 && divertHeldFor >= DIVERT_HOLD;
  return i;
}

/** True when any divert key is held (devices time the hold). */
export function divertHeld(held: ReadonlySet<string>, km: Readonly<KeyMap> = STANDARD_KEYS): boolean {
  return anyHeld(held, km.divert);
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
