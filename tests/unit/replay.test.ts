import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  InputPlayer,
  InputRecorder,
  NEUTRAL_INPUT,
  commandFor,
  createWorld,
  makeRng,
  next,
  pinHeightAboveRails,
  runSim,
  scoreWorld,
  stepWorld,
  timeToContact,
  worldFingerprint,
  type PilotInput,
  type TierId,
  type World,
} from '../../src/sim';

/** A scripted "player" for Cadet: steers toward the ring and presses CATCH on cue. */
function cadetPlayer(w: World): PilotInput {
  const q = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 10) / 10;
  const input: PilotInput = { ...NEUTRAL_INPUT };
  if (w.flags.divert) {
    input.stickX = q((-0.35 * w.pos.x) / 6);
    input.stickZ = q((-0.35 * w.pos.z) / 6);
  }
  const tgo = timeToContact(pinHeightAboveRails(w.pos, w.tilt), w.vel.y);
  input.closeArms = w.flags.catchPrompt && tgo <= w.arms.closeTime + 0.7;
  return input;
}

function recordCadet(seed: number) {
  const w = createWorld(seed, 'cadet');
  const rec = new InputRecorder();
  while (!w.done && w.step < 120 * 90) {
    const input = cadetPlayer(w);
    rec.record(w.step, input);
    stepWorld(w, commandFor(w, input, false));
  }
  return { world: w, log: rec.log };
}

describe('input log', () => {
  it('player returns exactly what was recorded, step by step (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 200 }), (xs) => {
        const rec = new InputRecorder();
        xs.forEach((x, i) => rec.record(i, { ...NEUTRAL_INPUT, stickX: x }));
        const p = new InputPlayer(rec.log);
        // -0 and +0 are the same stick position; the sparse recorder treats them as unchanged.
        xs.forEach((x, i) => expect(p.at(i).stickX + 0).toBe(x + 0));
      }),
    );
  });
  it('is sparse: unchanged inputs are not stored', () => {
    const rec = new InputRecorder();
    for (let i = 0; i < 100; i++) rec.record(i, NEUTRAL_INPUT);
    expect(rec.log.entries).toHaveLength(0);
  });
});

describe('deterministic replay', () => {
  it('rng is deterministic per seed and stream', () => {
    const a = makeRng(5, 1);
    const b = makeRng(5, 1);
    const c = makeRng(5, 2);
    const sa = [next(a), next(a), next(a)];
    expect([next(b), next(b), next(b)]).toEqual(sa);
    expect(next(c)).not.toBe(sa[0]);
  });

  it('a recorded Cadet flight replays bit-identically from seed + tier + input log', () => {
    const live = recordCadet(1234);
    const replay = runSim({ seed: 1234, tier: 'cadet', log: live.log });
    expect(worldFingerprint(replay.world)).toBe(worldFingerprint(live.world));
    expect(replay.score).toEqual(scoreWorld(live.world));
  });

  it('autopilot runs are bit-identical for the same seed and tier (all tiers)', () => {
    for (const tier of ['cadet', 'pilot', 'fd'] as TierId[]) {
      const a = runSim({ seed: 77, tier, autopilot: true });
      const b = runSim({ seed: 77, tier, autopilot: true });
      expect(worldFingerprint(a.world)).toBe(worldFingerprint(b.world));
      expect(a.score).toEqual(b.score);
    }
  });

  it('different seeds give different flights', () => {
    const a = runSim({ seed: 1, tier: 'fd', autopilot: true });
    const b = runSim({ seed: 2, tier: 'fd', autopilot: true });
    expect(worldFingerprint(a.world)).not.toBe(worldFingerprint(b.world));
  });

  it('a Pilot flight driven by a random input log is still deterministic (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.array(
          fc.record({
            step: fc.integer({ min: 0, max: 4000 }),
            stickX: fc.double({ min: -1, max: 1, noNaN: true }),
            throttle: fc.double({ min: 0, max: 1, noNaN: true }),
            ignite: fc.boolean(),
            stepDown: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        (seed, raw) => {
          const entries = [...raw]
            .sort((a, b) => a.step - b.step)
            .map((e) => ({ step: e.step, input: { ...NEUTRAL_INPUT, ...e } as PilotInput }));
          const log = { version: 1 as const, entries };
          const a = runSim({ seed, tier: 'pilot', log, maxTime: 40 });
          const b = runSim({ seed, tier: 'pilot', log, maxTime: 40 });
          expect(worldFingerprint(a.world)).toBe(worldFingerprint(b.world));
        },
      ),
      { numRuns: 8 },
    );
  });
});
