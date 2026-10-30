import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { REPLAY_SPEEDS, ReplayClock, SPLIT_WINDOW, fracFromPointer, formatReplayTime } from '../../src/app/scrubber';
import {
  InputRecorder,
  NEUTRAL_INPUT,
  buildTimeline,
  commandFor,
  createWorld,
  flightSeries,
  frameAt,
  frameIndexAt,
  runSim,
  stepWorld,
  worldFingerprint,
  type PilotInput,
} from '../../src/sim';

describe('replay clock (scrubber math)', () => {
  it('plays at 0.5x / 1x / 2x and stops at the end once', () => {
    const c = new ReplayClock(10);
    expect(c.update(1)).toBe(false);
    expect(c.t).toBeCloseTo(1, 9);
    c.setSpeed(2);
    c.update(1);
    expect(c.t).toBeCloseTo(3, 9);
    c.setSpeed(0.5);
    c.update(2);
    expect(c.t).toBeCloseTo(4, 9);
    expect(c.update(100)).toBe(true);
    expect(c.t).toBe(10);
    expect(c.playing).toBe(false);
    c.toggle(); // play again from the end restarts
    expect(c.t).toBe(0);
    expect(c.playing).toBe(true);
    c.seek(10);
    expect(c.update(1)).toBe(false); // the end fires only once
  });
  it('cycles the speeds and rejects others', () => {
    const c = new ReplayClock(5);
    const seen = [c.speed];
    for (let i = 0; i < 3; i++) seen.push(c.cycleSpeed());
    expect(seen).toEqual([1, 2, 0.5, 1]);
    c.setSpeed(3);
    expect(c.speed).toBe(1);
    expect(REPLAY_SPEEDS).toEqual([0.5, 1, 2]);
  });
  it('pauses and seeks while paused', () => {
    const c = new ReplayClock(8);
    c.toggle();
    c.update(3);
    expect(c.t).toBe(0);
    c.seekFrac(0.5);
    expect(c.t).toBe(4);
    expect(c.frac).toBe(0.5);
  });
  it('the split view replays the last 15 s and cannot scrub before them', () => {
    const c = new ReplayClock(40);
    c.seek(5);
    c.setSplit(true);
    expect(c.splitStart).toBe(40 - SPLIT_WINDOW);
    expect(c.t).toBe(25);
    c.seekFrac(0);
    expect(c.t).toBe(25);
    c.setSplit(false);
    c.seekFrac(0);
    expect(c.t).toBe(0);
    expect(new ReplayClock(9).splitStart).toBe(0); // short flights: the whole flight
  });
  it('seeking always stays inside the flight (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 120, noNaN: true }), fc.double({ min: -5, max: 5, noNaN: true }), fc.boolean(), (d, f, split) => {
        const c = new ReplayClock(d);
        c.setSplit(split);
        c.seekFrac(f);
        expect(c.t).toBeGreaterThanOrEqual(c.min);
        expect(c.t).toBeLessThanOrEqual(d);
      }),
    );
  });
  it('maps a pointer on the bar to 0..1 and formats the time', () => {
    expect(fracFromPointer(150, 100, 200)).toBe(0.25);
    expect(fracFromPointer(0, 100, 200)).toBe(0);
    expect(fracFromPointer(900, 100, 200)).toBe(1);
    expect(fracFromPointer(10, 0, 0)).toBe(0);
    expect(formatReplayTime(12.34)).toBe('00:12.3');
    expect(formatReplayTime(59.97)).toBe('01:00.0');
    expect(formatReplayTime(-3)).toBe('00:00.0');
  });
});

describe('replay timeline (seed + tier + input log)', () => {
  it('re-flies an autopilot run to the same score and outcome', () => {
    const ref = runSim({ seed: 3, tier: 'cadet', autopilot: true });
    const tl = buildTimeline({ seed: 3, tier: 'cadet', autopilot: true });
    expect(tl.score).toEqual(ref.score);
    expect(worldFingerprint(tl.world)).toBe(worldFingerprint(ref.world));
    expect(tl.duration).toBeCloseTo(ref.world.t, 9);
    expect(tl.ignitionT).not.toBeNull();
  });

  it('a recorded hand-flown run replays bit-identically from its input log', () => {
    // A scripted "player" on Pilot: light at the cue, step down, small stick moves.
    const w = createWorld(17, 'pilot');
    const rec = new InputRecorder();
    while (!w.done && w.step < 90 * 120) {
      const k = w.step;
      const inp: PilotInput = {
        ...NEUTRAL_INPUT,
        stickX: Math.round(Math.sin(k / 90) * 20) / 100,
        throttle: 0.55 + Math.round(Math.sin(k / 300) * 10) / 100,
        ignite: k === 140,
        stepDown: k === 140 + 4 * 120,
      };
      rec.record(w.step, inp);
      stepWorld(w, commandFor(w, inp, false));
    }
    const tl = buildTimeline({ seed: 17, tier: 'pilot', log: rec.log });
    expect(worldFingerprint(tl.world)).toBe(worldFingerprint(w));
  });

  it('frames are in time order and interpolate between neighbours', () => {
    const tl = buildTimeline({ seed: 5, tier: 'cadet', autopilot: true });
    const f = tl.frames;
    expect(f.length).toBeGreaterThan(100);
    for (let i = 1; i < f.length; i++) expect(f[i]!.t).toBeGreaterThan(f[i - 1]!.t - 1e-12);
    const i = Math.floor(f.length / 2);
    const a = f[i]!;
    const b = f[i + 1]!;
    const mid = frameAt(tl, (a.t + b.t) / 2);
    expect(mid.pos.y).toBeCloseTo((a.pos.y + b.pos.y) / 2, 6);
    expect(frameIndexAt(tl, a.t)).toBe(i);
    expect(frameAt(tl, -1).t).toBe(f[0]!.t);
    expect(frameAt(tl, 1e9).t).toBe(f[f.length - 1]!.t);
  });

  it('post-flight graph series: decimated, altitude >= 0, engines 0..13', () => {
    const tl = buildTimeline({ seed: 2, tier: 'pilot', autopilot: true });
    const s = flightSeries(tl, 120);
    expect(s.t.length).toBeLessThanOrEqual(122);
    expect(s.t.length).toBe(s.altitude.length);
    expect(s.t[s.t.length - 1]).toBeCloseTo(tl.frames[tl.frames.length - 1]!.t, 9);
    for (const a of s.altitude) expect(a).toBeGreaterThanOrEqual(0);
    expect(Math.max(...s.lit)).toBeLessThanOrEqual(13);
    expect(Math.max(...s.lit)).toBeGreaterThanOrEqual(3);
  });
});
