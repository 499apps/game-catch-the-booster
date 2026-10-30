import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CATCH_HOLD,
  DIVERT_HOLD,
  InputShaper,
  STICK_RATE,
  THROTTLE_LEVER_RATE,
  deadzone,
  emptyIntent,
  lerpAngle,
  mapGamepad,
  mapKeyboard,
  mapTouch,
  mergeIntents,
  presetKeys,
  rateLimit,
  rotateStick,
  worldToScreen,
  type PadState,
  type RawIntent,
} from '../../src/input/mapping';
import { InputDevices } from '../../src/input/devices';
import { NEUTRAL_INPUT, TIER_CONFIG, commandFor, createWorld, leverToThrottle } from '../../src/sim';

/** A stand-in for `window`: it keeps the listeners so a test can fire key events. */
class FakeWindow {
  readonly navigator = { getGamepads: (): (Gamepad | null)[] => [] };
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  key(type: 'keydown' | 'keyup', code: string): void {
    const e = { code, repeat: false, target: null, preventDefault: (): void => undefined };
    for (const fn of this.handlers.get(type) ?? []) fn(e);
  }
  fire(type: string): void {
    for (const fn of this.handlers.get(type) ?? []) fn({ target: null });
  }
}

const pad = (axes: number[], pressed: number[] = [], values: Record<number, number> = {}): PadState => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
});

describe('keyboard mapping', () => {
  it('WASD, Q/E, R, Space, Enter', () => {
    const i = mapKeyboard(new Set(['KeyD', 'KeyW', 'KeyE', 'KeyR', 'Space', 'Enter']));
    expect(i.stickX).toBe(1);
    expect(i.stickZ).toBe(-1);
    expect(i.yaw).toBe(1);
    expect(i.stepDown).toBe(true);
    expect(i.closeArms).toBe(true);
    expect(i.go).toBe(true);
    expect(i.ignite).toBe(true);
  });
  it('opposite keys cancel', () => {
    expect(mapKeyboard(new Set(['KeyA', 'KeyD'])).stickX).toBe(0);
  });
  it('digits 1-9 set the throttle lever 0..1', () => {
    expect(mapKeyboard(new Set(['Digit1'])).throttleSet).toBe(0);
    expect(mapKeyboard(new Set(['Digit5'])).throttleSet).toBe(0.5);
    expect(mapKeyboard(new Set(['Digit9'])).throttleSet).toBe(1);
  });
  it('Shift raises and Ctrl lowers the lever', () => {
    expect(mapKeyboard(new Set(['ShiftLeft'])).throttleRate).toBeGreaterThan(0);
    expect(mapKeyboard(new Set(['ControlLeft'])).throttleRate).toBeLessThan(0);
  });
  it('X must be held 1 s for a No-Go', () => {
    expect(mapKeyboard(new Set(['KeyX']), 0.5).noGo).toBe(false);
    expect(mapKeyboard(new Set(['KeyX']), DIVERT_HOLD).noGo).toBe(true);
  });
});

describe('gamepad mapping', () => {
  it('applies a radial deadzone', () => {
    expect(mapGamepad(pad([0.05, 0.05, 0, 0])).stickX).toBe(0);
    expect(mapGamepad(pad([1, 0, 0, 0])).stickX).toBeCloseTo(1, 9);
  });
  it('A closes the arms, RB steps down, RT/LT move the throttle, B held = No-Go', () => {
    const i = mapGamepad(pad([0, 0, 0, 0], [0, 5], { 7: 1 }));
    expect(i.closeArms).toBe(true);
    expect(i.stepDown).toBe(true);
    expect(i.throttleRate).toBeGreaterThan(0);
    expect(mapGamepad(pad([0, 0, 0, 0], [1]), 1.2).noGo).toBe(true);
    expect(mapGamepad(pad([0, 0, 0, 0], [1]), 0.2).noGo).toBe(false);
  });
  it('deadzone output never exceeds unit length (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -2, max: 2, noNaN: true }), fc.double({ min: -2, max: 2, noNaN: true }), (x, y) => {
        const [a, b] = deadzone(x, y);
        expect(Math.hypot(a, b)).toBeLessThanOrEqual(1 + 1e-9);
      }),
    );
  });
});

describe('touch mapping', () => {
  const base = {
    stickX: 0,
    stickY: 0,
    slider: null,
    catchHeldFor: 0,
    ignitePressed: false,
    stepDownPressed: false,
    goPressed: false,
    divertHeldFor: 0,
  };
  it('CATCH needs a 0.3 s hold', () => {
    expect(mapTouch({ ...base, catchHeldFor: 0.1 }).closeArms).toBe(false);
    expect(mapTouch({ ...base, catchHeldFor: CATCH_HOLD }).closeArms).toBe(true);
  });
  it('the slider sets the lever absolutely', () => {
    expect(mapTouch({ ...base, slider: 0.75 }).throttleSet).toBe(0.75);
    expect(mapTouch({ ...base, slider: 1.4 }).throttleSet).toBe(1);
  });
  it('merging devices ORs buttons and clamps sticks', () => {
    const a: RawIntent = { ...emptyIntent(), stickX: 0.8, closeArms: true };
    const b: RawIntent = { ...emptyIntent(), stickX: 0.8, throttleSet: 0.3 };
    const m = mergeIntents([a, b]);
    expect(m.stickX).toBe(1);
    expect(m.closeArms).toBe(true);
    expect(m.throttleSet).toBe(0.3);
  });
});

describe('smoothing and rate limits', () => {
  it('rateLimit moves at most rate*dt', () => {
    expect(rateLimit(0, 1, 2, 0.1)).toBeCloseTo(0.2, 12);
    expect(rateLimit(0, 0.05, 2, 0.1)).toBe(0.05);
  });
  it('shaped stick and lever never jump faster than their limits (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            sx: fc.double({ min: -1, max: 1, noNaN: true }),
            set: fc.option(fc.double({ min: 0, max: 1, noNaN: true })),
          }),
          { minLength: 1, maxLength: 60 },
        ),
        (frames) => {
          const s = new InputShaper();
          const dt = 1 / 60;
          let prev = s.state;
          for (const f of frames) {
            const next = s.update({ ...emptyIntent(), stickX: f.sx, throttleSet: f.set }, dt);
            expect(Math.abs(next.stickX - prev.stickX)).toBeLessThanOrEqual(STICK_RATE * dt + 1e-9);
            expect(Math.abs(next.throttle - prev.throttle)).toBeLessThanOrEqual(THROTTLE_LEVER_RATE * dt + 1e-9);
            expect(next.throttle).toBeGreaterThanOrEqual(0);
            expect(next.throttle).toBeLessThanOrEqual(1);
            prev = next;
          }
        },
      ),
    );
  });
});

describe('raw intent (the HUD input indicator)', () => {
  it('reflects held keys at once, before any smoothing, and tells listeners', () => {
    const win = new FakeWindow();
    const dev = new InputDevices(win as unknown as Window);
    let calls = 0;
    dev.onRawChange(() => calls++);
    expect(dev.rawIntent()).toEqual({ x: 0, z: 0, throttle: 0 });
    win.key('keydown', 'KeyD');
    expect(calls).toBe(1);
    expect(dev.rawIntent()).toEqual({ x: 1, z: 0, throttle: 0 });
    // The shaped stick ramps (rate limit + smoothing); the raw intent does not.
    expect(dev.sample(1 / 60).stickX).toBeLessThan(0.1);
    expect(dev.rawIntent().x).toBe(1);
    win.key('keydown', 'KeyW');
    win.key('keydown', 'ShiftLeft');
    expect(dev.rawIntent()).toEqual({ x: 1, z: -1, throttle: 1 });
    win.key('keyup', 'KeyD');
    win.key('keyup', 'KeyW');
    win.key('keyup', 'ShiftLeft');
    dev.sample(1 / 60);
    expect(dev.rawIntent()).toEqual({ x: 0, z: 0, throttle: 0 });
    expect(calls).toBe(6);
    // Ctrl lowers the throttle; the arrows steer too.
    win.key('keydown', 'ControlLeft');
    win.key('keydown', 'ArrowLeft');
    expect(dev.rawIntent()).toEqual({ x: -1, z: 0, throttle: -1 });
  });

  it('a tap shorter than a frame still shows until the next sample, without being used up', () => {
    const win = new FakeWindow();
    const dev = new InputDevices(win as unknown as Window);
    win.key('keydown', 'KeyS');
    win.key('keyup', 'KeyS');
    expect(dev.rawIntent().z).toBe(1);
    expect(dev.rawIntent().z).toBe(1); // reading it does not consume the tap
    dev.sample(1 / 60);
    expect(dev.rawIntent().z).toBe(0);
  });

  it('prompts follow the last-used device: pad use shows pad prompts, a key brings the keys back', () => {
    const win = new FakeWindow();
    const dev = new InputDevices(win as unknown as Window);
    let gp = { index: 0, connected: true, ...pad([0, 0, 0, 0]) };
    win.navigator.getGamepads = (): (Gamepad | null)[] => [gp as unknown as Gamepad];
    dev.sample(1 / 60);
    expect(dev.promptKind(false)).toBe('keys'); // a connected, idle pad does not win
    gp = { ...gp, ...pad([0.8, 0, 0, 0]) };
    dev.sample(1 / 60);
    expect(dev.padActive).toBe(true);
    expect(dev.promptKind(false)).toBe('pad');
    win.key('keydown', 'KeyD');
    expect(dev.promptKind(false)).toBe('keys');
    // The stick still held past the threshold does not take it back; a new pad press does.
    dev.sample(1 / 60);
    expect(dev.promptKind(false)).toBe('keys');
    gp = { ...gp, ...pad([0.8, 0, 0, 0], [0]) };
    dev.sample(1 / 60);
    expect(dev.promptKind(true)).toBe('pad');
    // A pointer / touch down: touch prompts on a touch screen.
    win.fire('pointerdown');
    expect(dev.promptKind(true)).toBe('touch');
  });

  it('follows a remapped key map', () => {
    const win = new FakeWindow();
    const dev = new InputDevices(win as unknown as Window);
    dev.setKeyMap({ ...presetKeys('standard'), tiltRight: ['KeyL'] });
    win.key('keydown', 'KeyL');
    expect(dev.rawIntent().x).toBe(1);
  });
});

describe('camera-relative stick math', () => {
  it('yaw 0 is the identity; rotation keeps the length; worldToScreen undoes it (property)', () => {
    expect(rotateStick(0.3, -0.7, 0)).toEqual([0.3, -0.7]);
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -7, max: 7, noNaN: true }),
        (x, z, yaw) => {
          const [wx, wz] = rotateStick(x, z, yaw);
          expect(Math.hypot(wx, wz)).toBeCloseTo(Math.hypot(x, z), 9);
          const [sx, sz] = worldToScreen(wx, wz, yaw);
          expect(sx).toBeCloseTo(x, 9);
          expect(sz).toBeCloseTo(z, 9);
        },
      ),
    );
  });
  it('a camera turned half round (looking +z) mirrors both axes', () => {
    const [x, z] = rotateStick(1, 0, Math.PI);
    expect(x).toBeCloseTo(-1, 9);
    expect(z).toBeCloseTo(0, 9);
  });
  it('lerpAngle takes the short way round', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(3 + (2 * Math.PI - 6) / 2, 9);
    expect(lerpAngle(0.2, 0.6, 0.5)).toBeCloseTo(0.4, 9);
    expect(lerpAngle(1, 2, 1)).toBeCloseTo(2, 9);
  });
});

describe('input -> flight command', () => {
  it('lever maps to 40%..100% throttle', () => {
    expect(leverToThrottle(0)).toBe(0.4);
    expect(leverToThrottle(1)).toBe(1);
  });
  it('Pilot: rate nudge while coasting, lean command in the burn; Flight Director direct gimbal; Cadet attitude hold', () => {
    expect(TIER_CONFIG.pilot.control).toBe('pilot');
    const pw = createWorld(1, 'pilot');
    const pilot = commandFor(pw, { ...NEUTRAL_INPUT, stickX: 1 }, false);
    expect(pilot.attitude).toBe('rate');
    expect(pilot.target.x).toBeGreaterThan(0);
    pw.phase = 'burn13';
    pw.vel = { x: 0, y: -100, z: 0 };
    const lean = commandFor(pw, { ...NEUTRAL_INPUT, stickX: 1 }, false);
    expect(lean.attitude).toBe('tilt');
    expect(lean.target.x).toBeGreaterThan(0);
    const fd = commandFor(createWorld(1, 'fd'), { ...NEUTRAL_INPUT, stickX: 1 }, false);
    expect(fd.attitude).toBe('direct');
    const cadet = commandFor(createWorld(1, 'cadet'), NEUTRAL_INPUT, false);
    expect(cadet.attitude).toBe('tilt');
  });
});
