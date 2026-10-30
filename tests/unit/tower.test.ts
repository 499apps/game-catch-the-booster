import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_ARM_CLOSE_TIME,
  DT,
  G0,
  RAIL_STROKE,
  TIERS,
  TIER_CONFIG,
  armAngle,
  armProgressAt,
  createWorld,
  makeArms,
  makeRails,
  startClose,
  staticCompression,
  updateArms,
  updateRails,
} from '../../src/sim';

describe('arm kinematics', () => {
  it('default close time is 5.0 s and every tier is within 4.5..6 s', () => {
    expect(DEFAULT_ARM_CLOSE_TIME).toBe(5.0);
    for (const t of TIERS) {
      const [lo, hi] = TIER_CONFIG[t].armCloseTime;
      expect(lo).toBeGreaterThanOrEqual(4.5);
      expect(hi).toBeLessThanOrEqual(6);
    }
    for (let seed = 1; seed < 50; seed++) {
      const w = createWorld(seed, 'fd');
      expect(w.arms.closeTime).toBeGreaterThanOrEqual(4.5);
      expect(w.arms.closeTime).toBeLessThanOrEqual(6);
    }
  });

  it('progress goes 0 -> 1 monotonically and the angle closes to 0', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const p = armProgressAt((i / 100) * 5, 5);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(armProgressAt(0, 5)).toBe(0);
    expect(armProgressAt(5, 5)).toBe(1);
    expect(armAngle(1)).toBe(0);
    expect(armAngle(0)).toBeGreaterThan(0);
  });

  it('a close started at t finishes after exactly the close time (to one step)', () => {
    fc.assert(
      fc.property(fc.double({ min: 4.5, max: 6, noNaN: true }), (closeTime) => {
        const arms = makeArms(closeTime);
        const t0 = 10;
        expect(startClose(arms, t0)).toBe(true);
        expect(startClose(arms, t0)).toBe(false);
        let t = t0;
        let done = false;
        while (!done) {
          t += DT;
          done = updateArms(arms, t);
        }
        expect(t - t0).toBeGreaterThanOrEqual(closeTime - 1e-9);
        expect(t - t0).toBeLessThan(closeTime + DT + 1e-9);
        expect(arms.closed).toBe(true);
        expect(arms.progress).toBe(1);
      }),
      { numRuns: 30 },
    );
  });
});

describe('rail spring-damper', () => {
  it('stroke stays within 1.5 m and the rails settle for contacts up to 4 m/s (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 4, noNaN: true }),
        fc.double({ min: 255_000, max: 290_000, noNaN: true }),
        (v, m) => {
          const r = makeRails();
          r.rate = v;
          let maxC = 0;
          for (let i = 0; i < 120 * 4; i++) {
            updateRails(r, m, G0, DT);
            maxC = Math.max(maxC, r.compression);
          }
          expect(maxC).toBeLessThanOrEqual(RAIL_STROKE);
          expect(Math.abs(r.compression - staticCompression(m, G0))).toBeLessThan(0.01);
          expect(Math.abs(r.rate)).toBeLessThan(0.02);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('peak force grows with contact speed', () => {
    const peak = (v: number): number => {
      const r = makeRails();
      r.rate = v;
      for (let i = 0; i < 240; i++) updateRails(r, 270_000, G0, DT);
      return r.peakForce;
    };
    expect(peak(1)).toBeLessThan(peak(2));
    expect(peak(2)).toBeLessThan(peak(4));
  });
});
