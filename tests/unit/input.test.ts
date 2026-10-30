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
  mapGamepad,
  mapKeyboard,
  mapTouch,
  mergeIntents,
  rateLimit,
  type PadState,
  type RawIntent,
} from '../../src/input/mapping';
import { NEUTRAL_INPUT, TIER_CONFIG, commandFor, createWorld, leverToThrottle } from '../../src/sim';

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

describe('input -> flight command', () => {
  it('lever maps to 40%..100% throttle', () => {
    expect(leverToThrottle(0)).toBe(0.4);
    expect(leverToThrottle(1)).toBe(1);
  });
  it('Pilot uses rate damping, Flight Director direct gimbal, Cadet attitude hold', () => {
    expect(TIER_CONFIG.pilot.control).toBe('pilot');
    const pilot = commandFor(createWorld(1, 'pilot'), { ...NEUTRAL_INPUT, stickX: 1 }, false);
    expect(pilot.attitude).toBe('rate');
    expect(pilot.target.x).toBeGreaterThan(0);
    const fd = commandFor(createWorld(1, 'fd'), { ...NEUTRAL_INPUT, stickX: 1 }, false);
    expect(fd.attitude).toBe('direct');
    const cadet = commandFor(createWorld(1, 'cadet'), NEUTRAL_INPUT, false);
    expect(cadet.attitude).toBe('tilt');
  });
});
