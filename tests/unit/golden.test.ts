// Golden-trajectory tests: the deterministic autopilot must reproduce the real catch timeline
// (docs/design.md "What the footage shows"). Times are seconds after landing-burn ignition.
import { describe, expect, it } from 'vitest';
import { RAD, TIER_CONFIG, type TierId } from '../../src/sim';
import { flyAutopilot, timeline } from './helpers';

const SEEDS = [1, 2, 3, 4, 5, 6];

function expectGoldenTimeline(seed: number, tier: TierId): void {
  const { world: w, score } = flyAutopilot(seed, tier);
  const tl = timeline(w);
  const ctx = `${tier} seed ${seed}: ${JSON.stringify({ outcome: w.outcome, tl })}`;

  expect(w.outcome?.caught, ctx).toBe(true);
  expect(tl.ignition, ctx).not.toBeNull();
  const ign = w.ignition!;
  // ignition 1.2-1.6 km up, descending ~300 m/s
  expect(ign.pos.y, ctx).toBeGreaterThan(1150);
  expect(ign.pos.y, ctx).toBeLessThan(1650);
  expect(-ign.vel.y, ctx).toBeGreaterThan(270);
  expect(-ign.vel.y, ctx).toBeLessThan(320);
  // ignition -> cutoff ~30 s (hard limits 25-33)
  expect(tl.cutoff!, ctx).toBeGreaterThanOrEqual(27);
  expect(tl.cutoff!, ctx).toBeLessThanOrEqual(33);
  // step-down 13 -> 3 at ~+4 s
  expect(tl.stepDown!, ctx).toBeGreaterThan(3.5);
  expect(tl.stepDown!, ctx).toBeLessThan(5);
  // pendulum divert starts ~+13 s
  expect(tl.divertStart!, ctx).toBeGreaterThan(12);
  expect(tl.divertStart!, ctx).toBeLessThan(14);
  // hover / vertical settle beside the arms ~+23 s
  expect(tl.hover!, ctx).toBeGreaterThan(20);
  expect(tl.hover!, ctx).toBeLessThan(26.5);
  // arms start closing ~+27 s while still dropping, closed ~+31-32 s
  expect(tl.armsCloseStart!, ctx).toBeGreaterThan(24);
  expect(tl.armsCloseStart!, ctx).toBeLessThan(30);
  expect(tl.armsClosed! - tl.armsCloseStart!, ctx).toBeCloseTo(w.arms.closeTime, 1);
  expect(tl.armsClosed!, ctx).toBeLessThanOrEqual(tl.contact! + 1e-9);
  expect(w.arms.pinHeightAtClose!, ctx).toBeGreaterThanOrEqual(0);
  expect(w.arms.pinHeightAtClose!, ctx).toBeLessThanOrEqual(20);
  // CATCH prompt about 5 s ahead of contact (we allow 4-8 s)
  const lead = tl.contact! - tl.catchPrompt!;
  expect(lead, ctx).toBeGreaterThan(4);
  expect(lead, ctx).toBeLessThan(8);
  // the contact itself
  const c = w.contact!;
  expect(c.speed, ctx).toBeLessThan(2);
  expect(c.lateralError, ctx).toBeLessThan(1.5);
  expect(c.tiltDeg, ctx).toBeLessThan(2);
  expect(c.lateralSpeed, ctx).toBeLessThan(1);
  expect(c.propellant / 1000, ctx).toBeGreaterThan(5);
  expect(c.propellant / 1000, ctx).toBeLessThan(35);
  // peak sensed acceleration stays sane
  expect(w.peakG, ctx).toBeGreaterThan(3);
  expect(w.peakG, ctx).toBeLessThan(12);
  expect(score.base, ctx).toBeGreaterThan(600);
}

describe('golden timeline (autopilot)', () => {
  for (const tier of ['cadet', 'pilot'] as TierId[]) {
    for (const seed of SEEDS) {
      it(`${TIER_CONFIG[tier].name}, seed ${seed}`, () => expectGoldenTimeline(seed, tier));
    }
  }

  it('Cadet default arm close is 5.0 s', () => {
    const { world: w } = flyAutopilot(1, 'cadet');
    const tl = timeline(w);
    expect(tl.armsClosed! - tl.armsCloseStart!).toBeCloseTo(5.0, 1);
  });

  it('the pendulum divert leans toward the tower, then counter-burns', () => {
    let minTilt = 0;
    let maxTiltAfter = 0;
    let tIgn = 0;
    flyAutopilot(3, 'cadet', (_b, w) => {
      if (!w.ignition) return;
      tIgn = w.ignition.t;
      const tau = w.t - tIgn;
      if (tau > 13 && tau < 18) minTilt = Math.min(minTilt, w.tilt.x);
      if (tau > 18 && tau < 24) maxTiltAfter = Math.max(maxTiltAfter, w.tilt.x);
    });
    expect(minTilt).toBeLessThan(-3 * RAD); // nose toward the tower (-x)
    expect(maxTiltAfter).toBeGreaterThan(2 * RAD); // counter-burn lean away
  });
});

describe('Flight Director robustness', () => {
  it('the autopilot catches (or makes the correct No-Go call) on >= 80% of 20 seeds', () => {
    let ok = 0;
    const report: string[] = [];
    for (let seed = 101; seed <= 120; seed++) {
      const { world: w } = flyAutopilot(seed, 'fd');
      const caught = !!w.outcome?.caught;
      const goodCall = !!w.outcome?.goodCall;
      if (caught || goodCall) ok++;
      const tl = timeline(w);
      report.push(`${seed}:${w.outcome?.reason ?? 'caught'}${goodCall ? '(good call)' : ''} cutoff=${tl.cutoff?.toFixed(1)}`);
      if (caught) {
        expect(tl.cutoff!).toBeGreaterThanOrEqual(25);
        expect(tl.cutoff!).toBeLessThanOrEqual(33);
      }
    }
    expect(ok, report.join(' | ')).toBeGreaterThanOrEqual(16);
  });

  it('FD faults appear: some seeds have engine-outs and tower sensor faults', () => {
    let outs = 0;
    let faults = 0;
    for (let seed = 101; seed <= 140; seed++) {
      const { world: w } = flyAutopilot(seed, 'fd');
      const ev = w.events.find((e) => e.type === 'ignition');
      if ((ev?.data?.['engines'] as number) < 13) outs++;
      if (w.faults.towerSensor) {
        faults++;
        expect(w.outcome?.reason).toBe('noGo');
        expect(w.outcome?.goodCall).toBe(true);
      }
    }
    expect(outs).toBeGreaterThan(10);
    expect(faults).toBeGreaterThan(0);
  });
});
