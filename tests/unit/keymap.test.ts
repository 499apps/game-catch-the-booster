import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DIVERT_HOLD,
  KEY_ACTIONS,
  ONEHAND_KEYS,
  STANDARD_KEYS,
  divertHeld,
  isReservedKey,
  keyLabel,
  mapKeyboard,
  presetKeys,
  rebind,
  sanitizeKeyMap,
  type KeyMap,
} from '../../src/input/mapping';

describe('key presets', () => {
  it('standard keys follow design section 5', () => {
    const i = mapKeyboard(new Set(['KeyD', 'KeyW', 'KeyE', 'KeyR', 'Space', 'Enter']), 0, STANDARD_KEYS);
    expect(i.stickX).toBe(1);
    expect(i.stickZ).toBe(-1);
    expect(i.yaw).toBe(1);
    expect(i.stepDown).toBe(true);
    expect(i.closeArms).toBe(true);
    expect(i.go).toBe(true);
    expect(i.ignite).toBe(true);
  });
  it('arrow keys also tilt in the standard preset', () => {
    expect(mapKeyboard(new Set(['ArrowLeft'])).stickX).toBe(-1);
    expect(mapKeyboard(new Set(['ArrowDown'])).stickZ).toBe(1);
  });
  it('the one-handed preset keeps every action within reach of WASD', () => {
    const km = presetKeys('onehand');
    const i = mapKeyboard(new Set(['KeyE', 'KeyF', 'Space']), 0, km);
    expect(i.throttleRate).toBeGreaterThan(0);
    expect(i.ignite).toBe(true);
    expect(i.go).toBe(true);
    expect(i.closeArms).toBe(true);
    expect(mapKeyboard(new Set(['KeyQ']), 0, km).throttleRate).toBeLessThan(0);
    const leftHand = new Set(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'Space']);
    for (const a of KEY_ACTIONS) for (const c of ONEHAND_KEYS[a]) expect(leftHand.has(c), `${a}: ${c}`).toBe(true);
  });
  it('presets return fresh copies', () => {
    const a = presetKeys('standard');
    a.catch.push('KeyB');
    expect(STANDARD_KEYS.catch).toEqual(['Space']);
  });
  it('digits always set the throttle, whatever the map', () => {
    expect(mapKeyboard(new Set(['Digit9']), 0, presetKeys('onehand')).throttleSet).toBe(1);
  });
  it('divert needs a 1 s hold on the mapped key', () => {
    const km = rebind(presetKeys('standard'), 'divert', 'KeyB');
    expect(divertHeld(new Set(['KeyB']), km)).toBe(true);
    expect(mapKeyboard(new Set(['KeyB']), 0.5, km).noGo).toBe(false);
    expect(mapKeyboard(new Set(['KeyB']), DIVERT_HOLD, km).noGo).toBe(true);
    expect(mapKeyboard(new Set(['KeyX']), DIVERT_HOLD, km).noGo).toBe(false);
  });
});

describe('rebinding', () => {
  it('moves a key to the new action and removes it from the old one', () => {
    const km = rebind(presetKeys('standard'), 'catch', 'KeyR');
    expect(km.catch).toEqual(['KeyR']);
    expect(km.stepDown).toEqual([]);
    expect(mapKeyboard(new Set(['KeyR']), 0, km).closeArms).toBe(true);
    expect(mapKeyboard(new Set(['KeyR']), 0, km).stepDown).toBe(false);
  });
  it('GO and ignite may share a key', () => {
    const km = rebind(presetKeys('standard'), 'go', 'KeyI');
    expect(km.go).toEqual(['KeyI']);
    expect(km.ignite).toContain('KeyI');
  });
  it('reserved keys (menu, cameras, mute, throttle digits) cannot be bound', () => {
    const km = presetKeys('standard');
    for (const c of ['Escape', 'KeyP', 'KeyC', 'KeyV', 'KeyM', 'Digit5', 'Numpad1', 'Tab']) {
      expect(isReservedKey(c)).toBe(true);
      expect(rebind(km, 'catch', c)).toBe(km);
    }
  });
  it('never leaves a key on two actions (property)', () => {
    const codes = ['KeyA', 'KeyB', 'KeyD', 'KeyR', 'KeyX', 'Space', 'Enter', 'KeyJ', 'ShiftLeft'];
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom(...KEY_ACTIONS), fc.constantFrom(...codes)), { maxLength: 30 }), (ops) => {
        let km: KeyMap = presetKeys('standard');
        for (const [a, c] of ops) km = rebind(km, a, c);
        const owner = new Map<string, string>();
        for (const a of KEY_ACTIONS) {
          for (const c of km[a]) {
            const prev = owner.get(c);
            const shared = prev !== undefined && new Set([prev, a]).size === 2 && [prev, a].every((x) => x === 'go' || x === 'ignite');
            if (prev !== undefined && prev !== a) expect(shared, `${c} on ${prev} and ${a}`).toBe(true);
            owner.set(c, a);
          }
        }
      }),
    );
  });
});

describe('stored key maps', () => {
  it('fall back to the standard keys when broken', () => {
    expect(sanitizeKeyMap(null)).toEqual(presetKeys('standard'));
    expect(sanitizeKeyMap('x')).toEqual(presetKeys('standard'));
    const s = sanitizeKeyMap({ catch: ['KeyB'], tiltLeft: 'oops', go: ['Escape'], ignite: [42, '<script>'] });
    expect(s.catch).toEqual(['KeyB']);
    expect(s.tiltLeft).toEqual(STANDARD_KEYS.tiltLeft);
    expect(s.go).toEqual(STANDARD_KEYS.go);
    expect(s.ignite).toEqual(STANDARD_KEYS.ignite);
  });
  it('labels keys for people', () => {
    expect(keyLabel('KeyA')).toBe('A');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(keyLabel('Space')).toBe('Space');
  });
});
