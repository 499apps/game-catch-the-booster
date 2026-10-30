import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BONUS_GOOD_CALL,
  IGNITION_ZERO,
  MAX,
  TIER_CONFIG,
  alignmentScore,
  contactSpeedScore,
  fuelError,
  fuelScore,
  ignitionScore,
  loadScore,
  medalFor,
  scoreRun,
  stabilityScore,
  type ScoreInput,
} from '../../src/sim';

const perfect: ScoreInput = {
  caught: true,
  pinError: 0,
  contactSpeed: 0.3,
  peakLoadG: 1.2,
  propellantKg: 10_000,
  ignitionError: 0,
  tiltDeg: 0,
  lateralSpeed: 0,
  goodCall: false,
  enginesLitAtIgnition: 13,
  meanWind: 0,
};

const nonNeg = fc.double({ min: 0, max: 50, noNaN: true });

function monotoneDecreasing(f: (x: number) => number): void {
  fc.assert(
    fc.property(nonNeg, nonNeg, (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(f(lo)).toBeGreaterThanOrEqual(f(hi));
    }),
  );
}

describe('score components', () => {
  it('alignment: 300 at 0 m, 0 at 1.5 m, monotonic', () => {
    expect(alignmentScore(0)).toBe(300);
    expect(alignmentScore(1.5)).toBe(0);
    expect(alignmentScore(3)).toBe(0);
    monotoneDecreasing(alignmentScore);
  });
  it('alignment scales to the tier window: a Cadet catch inside its 3 m window always scores', () => {
    const cadet = TIER_CONFIG.cadet.pinWindow;
    expect(alignmentScore(0, cadet)).toBe(300);
    expect(alignmentScore(1.5, cadet)).toBeCloseTo(150, 9);
    expect(alignmentScore(2.9, cadet)).toBeGreaterThan(0);
    expect(alignmentScore(cadet, cadet)).toBe(0);
    expect(scoreRun({ ...perfect, pinError: 2, pinWindow: cadet }).alignment).toBe(100);
    monotoneDecreasing((x) => alignmentScore(x, cadet));
  });
  it('contact speed: full below 0.5, half at 2, zero at 4, monotonic', () => {
    expect(contactSpeedScore(0.5)).toBe(250);
    expect(contactSpeedScore(2)).toBeCloseTo(125, 9);
    expect(contactSpeedScore(4)).toBe(0);
    monotoneDecreasing(contactSpeedScore);
  });
  it('load: full at <= 1.5 g, zero at 4 g, monotonic', () => {
    expect(loadScore(1.5)).toBe(150);
    expect(loadScore(4)).toBe(0);
    monotoneDecreasing(loadScore);
  });
  it('fuel: full inside 5-15 t, fewer points outside, monotonic in band error', () => {
    expect(fuelScore(5)).toBe(150);
    expect(fuelScore(15)).toBe(150);
    expect(fuelScore(0)).toBe(30);
    expect(fuelScore(2)).toBeLessThan(150);
    expect(fuelScore(45)).toBe(0);
    fc.assert(
      fc.property(nonNeg, nonNeg, (a, b) => {
        if (fuelError(a) < fuelError(b) && (a < 5) === (b < 5)) {
          expect(fuelScore(a)).toBeGreaterThanOrEqual(fuelScore(b));
        }
      }),
    );
  });
  it('ignition: 100 at 0 m, ~93 at 40 m ("pro"), still ~50 a whole second (~300 m) off, 0 at 600 m', () => {
    expect(ignitionScore(0)).toBe(100);
    expect(ignitionScore(40)).toBeCloseTo(93.33, 1);
    expect(ignitionScore(-40)).toBeCloseTo(93.33, 1);
    expect(ignitionScore(300)).toBeCloseTo(50, 9);
    expect(ignitionScore(-300)).toBeCloseTo(50, 9);
    expect(ignitionScore(IGNITION_ZERO)).toBe(0);
    expect(ignitionScore(900)).toBe(0);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), fc.double({ min: 0, max: 1000, noNaN: true }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(ignitionScore(lo)).toBeGreaterThanOrEqual(ignitionScore(hi));
      }),
    );
  });
  it('stability: 50 when upright and still, 0 at 2 deg and 1 m/s', () => {
    expect(stabilityScore(0, 0)).toBe(50);
    expect(stabilityScore(2, 1)).toBe(0);
    monotoneDecreasing((x) => stabilityScore(x, 0));
    monotoneDecreasing((x) => stabilityScore(0, x));
  });
});

describe('totals, bonuses and medals', () => {
  it('a perfect run scores 1000 and a bullseye', () => {
    const s = scoreRun(perfect);
    expect(s.base).toBe(1000);
    expect(s.total).toBe(1000);
    expect(s.medal).toBe('bullseye');
    expect(s.badges).toContain('pro');
  });
  it('base never exceeds the component maxima', () => {
    const maxSum = Object.values(MAX).reduce((a, b) => a + b, 0);
    expect(maxSum).toBe(1000);
  });
  it('medal thresholds', () => {
    expect(medalFor(500, 1, true)).toBe('bronze');
    expect(medalFor(700, 1, true)).toBe('silver');
    expect(medalFor(850, 1, true)).toBe('gold');
    expect(medalFor(900, 0.29, true)).toBe('bullseye');
    expect(medalFor(499, 0, true)).toBe('none');
    expect(medalFor(1000, 0, false)).toBe('none');
  });
  it('a correct No-Go earns the Good Call bonus even without a catch', () => {
    const s = scoreRun({ ...perfect, caught: false, goodCall: true });
    expect(s.base).toBe(0);
    expect(s.total).toBe(BONUS_GOOD_CALL);
  });
  it('engine-out and wind master bonuses', () => {
    const s = scoreRun({ ...perfect, enginesLitAtIgnition: 11, meanWind: 8 });
    expect(s.bonuses.map((b) => b.id).sort()).toEqual(['engineOut', 'windMaster']);
    expect(s.total).toBe(1200);
  });
  it('fumes badge below 2 t', () => {
    expect(scoreRun({ ...perfect, propellantKg: 1500 }).badges).toContain('fumes');
  });
  it('total score is monotonic in pin error (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 3, noNaN: true }), fc.double({ min: 0, max: 3, noNaN: true }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(scoreRun({ ...perfect, pinError: lo }).base).toBeGreaterThanOrEqual(
          scoreRun({ ...perfect, pinError: hi }).base,
        );
      }),
    );
  });
});
