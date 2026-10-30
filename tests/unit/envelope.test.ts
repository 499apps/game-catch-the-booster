import { describe, expect, it } from 'vitest';
import { TIER_CONFIG, classifyArmClose, classifyContact, classifyContactSpeed } from '../../src/sim';

const pilot = TIER_CONFIG.pilot;
const cadet = TIER_CONFIG.cadet;
const ok = { lateralError: 0.2, tiltDeg: 0.5, lateralSpeed: 0.2, contactSpeed: 1 };

describe('catch envelope', () => {
  it('pin window boundary: 1.5 m in, just over is a miss (Cadet 3 m)', () => {
    expect(classifyContact({ ...ok, lateralError: 1.5 }, pilot)).toBe('clean');
    expect(classifyContact({ ...ok, lateralError: 1.5001 }, pilot)).toBe('missLateral');
    expect(classifyContact({ ...ok, lateralError: 3 }, cadet)).toBe('clean');
    expect(classifyContact({ ...ok, lateralError: 3.0001 }, cadet)).toBe('missLateral');
  });

  it('tilt must be under 2 deg and lateral speed under 1 m/s', () => {
    expect(classifyContact({ ...ok, tiltDeg: 1.999 }, pilot)).toBe('clean');
    expect(classifyContact({ ...ok, tiltDeg: 2 }, pilot)).toBe('unstable');
    expect(classifyContact({ ...ok, lateralSpeed: 0.999 }, pilot)).toBe('clean');
    expect(classifyContact({ ...ok, lateralSpeed: 1 }, pilot)).toBe('unstable');
  });

  it('contact speed: < 2 clean, 2..4 hard, > 4 overload', () => {
    expect(classifyContactSpeed(0)).toBe('clean');
    expect(classifyContactSpeed(1.999)).toBe('clean');
    expect(classifyContactSpeed(2)).toBe('hard');
    expect(classifyContactSpeed(4)).toBe('hard');
    expect(classifyContactSpeed(4.0001)).toBe('overload');
    expect(classifyContact({ ...ok, contactSpeed: 3 }, pilot)).toBe('hard');
    expect(classifyContact({ ...ok, contactSpeed: 5 }, pilot)).toBe('overload');
  });

  it('pins must be 0..20 m above the rails when the arms finish closing', () => {
    expect(classifyArmClose(0, pilot)).toBe('ok');
    expect(classifyArmClose(20, pilot)).toBe('ok');
    expect(classifyArmClose(20.01, pilot)).toBe('early');
  });

  it('alignment is checked before attitude and load', () => {
    expect(classifyContact({ lateralError: 9, tiltDeg: 9, lateralSpeed: 9, contactSpeed: 9 }, pilot)).toBe(
      'missLateral',
    );
    expect(classifyContact({ lateralError: 0, tiltDeg: 9, lateralSpeed: 0, contactSpeed: 9 }, pilot)).toBe(
      'unstable',
    );
  });
});
