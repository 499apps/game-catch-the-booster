// The assist ladder from the player's side: Cadet flies itself and the stick moves its aim;
// Pilot is fair to a plain human strategy (no oracle, a reaction delay, a shaky hand).
import { describe, expect, it } from 'vitest';
import {
  CADET_AIM_MAX,
  CADET_AIM_RATE,
  DT,
  TIER_CONFIG,
  cadetAimLimit,
  ENGINE_THRUST,
  G0,
  NEUTRAL_INPUT,
  PILOT_LEAN_LIMIT_3,
  THROTTLE_MIN,
  TRACK_REACH,
  cadetAimOffset,
  commandFor,
  countRunning,
  createWorld,
  failedChecks,
  healthChecks,
  gauss,
  idealIgnitionHeight,
  makeRng,
  massOf,
  pilotLean,
  pinHeightAboveRails,
  pinPosition,
  propellantNeeded,
  scoreWorld,
  stepWorld,
  timeToContact,
  uprightPinOffset,
  type PilotInput,
  type World,
} from '../../src/sim';

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

type CadetHands = 'off' | 'aim' | 'slam' | 'away';

/**
 * A Cadet run, stick in world axes.
 *  off:  hands off.
 *  aim:  steers the end of the ghost path (the aim point, drawn on screen) onto the ring
 *        centre, in proportion to its distance, with a 0.1 m dead band.
 *  slam: a kid who holds full stick along the HUD arrow (pins -> ring) from the moment it shows.
 *  away: full stick away from the ring the whole time (the worst a player can do).
 */
function flyCadet(seed: number, hands: CadetHands): World {
  const w = createWorld(seed, 'cadet');
  while (!w.done && w.step < 120 * 90) {
    const input: PilotInput = { ...NEUTRAL_INPUT };
    const p = pinPosition(w.pos, w.tilt);
    const d = Math.hypot(p.x, p.z);
    if (w.flags.divert && hands === 'slam' && d > 1e-6) {
      input.stickX = -p.x / d;
      input.stickZ = -p.z / d;
    } else if (w.flags.divert && hands === 'away' && d > 1e-6) {
      input.stickX = p.x / d;
      input.stickZ = p.z / d;
    } else if (w.flags.divert && hands === 'aim' && Math.hypot(w.aim.x, w.aim.z) > 0.1) {
      input.stickX = clamp1(-w.aim.x);
      input.stickZ = clamp1(-w.aim.z);
    }
    // Press CATCH on the cue (as the HUD ring asks).
    const tgo = timeToContact(pinHeightAboveRails(w.pos, w.tilt), w.vel.y);
    input.closeArms = w.flags.catchPrompt && tgo <= w.arms.closeTime + 0.7;
    stepWorld(w, commandFor(w, input, false));
  }
  return w;
}

describe('Cadet: the divert swings in by itself; the stick moves its aim point', () => {
  it('the hands-off aim point is small, seeded and inside the aim limit', () => {
    const limit = cadetAimLimit(TIER_CONFIG.cadet.pinWindow);
    expect(limit).toBeCloseTo(2.2, 9);
    for (let seed = 1; seed <= 50; seed++) {
      const a = cadetAimOffset(seed);
      expect(Math.hypot(a.x, a.z)).toBeLessThanOrEqual(CADET_AIM_MAX + 1e-9);
      expect(Math.hypot(a.x, a.z)).toBeLessThanOrEqual(limit + 1e-9);
      expect(cadetAimOffset(seed)).toEqual(a);
      expect(createWorld(seed, 'cadet').aim).toEqual(a);
    }
    expect(CADET_AIM_RATE).toBeCloseTo(1, 9);
  });

  it('the aim point moves at most 1 m/s, stays inside the limit, and freezes near the rails', () => {
    const w = flyCadet(3, 'away');
    expect(w.outcome?.caught).toBe(true);
    expect(Math.hypot(w.aim.x, w.aim.z)).toBeLessThanOrEqual(cadetAimLimit(w.cfg.pinWindow) + 1e-9);
    // Before the divert the stick does nothing.
    const v = createWorld(3, 'cadet');
    const a0 = { ...v.aim };
    for (let i = 0; i < 240; i++) stepWorld(v, commandFor(v, { ...NEUTRAL_INPUT, stickX: 1 }, false));
    expect(v.aim).toEqual(a0);
  });

  it('flown hands-off, it reaches the arms inside the window on most seeds', () => {
    const report: string[] = [];
    let inside = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const w = flyCadet(seed, 'off');
      const c = w.contact;
      report.push(`${seed}:${w.outcome?.reason ?? 'caught'} err=${c?.lateralError.toFixed(2) ?? '-'}`);
      if (w.outcome?.caught && c && c.lateralError <= 3) inside++;
    }
    expect(inside, report.join(' | ')).toBeGreaterThanOrEqual(4);
  });

  it('steering the aim toward the ring centre scores at least as well as hands-off, on every seed', () => {
    let alone = 0;
    let steered = 0;
    const report: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const a = flyCadet(seed, 'off');
      const b = flyCadet(seed, 'aim');
      const sa = scoreWorld(a);
      const sb = scoreWorld(b);
      alone += sa.alignment;
      steered += sb.alignment;
      report.push(`${seed}: ${sa.alignment} -> ${sb.alignment} (${b.outcome?.reason ?? 'caught'}, err ${b.contact?.lateralError.toFixed(2) ?? '-'})`);
      expect(b.outcome?.caught, report.join(' | ')).toBe(true);
      expect(sb.alignment, report.join(' | ')).toBeGreaterThanOrEqual(sa.alignment);
    }
    expect(steered, report.join(' | ')).toBeGreaterThan(alone);
  });

  it('no stick input can make a Cadet fail: full stick toward or away from the ring still catches', () => {
    const report: string[] = [];
    let caught = 0;
    for (const hands of ['slam', 'away'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const w = flyCadet(seed, hands);
        const c = w.contact;
        report.push(`${hands} ${seed}:${w.outcome?.reason ?? 'caught'} err=${c?.lateralError.toFixed(2) ?? '-'} lat=${c?.lateralSpeed.toFixed(2) ?? '-'}`);
        if (w.outcome?.caught) caught++;
      }
    }
    expect(caught, report.join(' | ')).toBe(16);
  });
});

describe('Pilot: the stick commands a lean angle, with lateral damping', () => {
  it('neutral stick leans against the slide; full stick leans the way it points', () => {
    const w = createWorld(3, 'pilot');
    w.phase = 'burn3';
    w.tilt = { x: 0, z: 0 };
    w.thrust = massOf(w) * (G0 + 1);
    w.vel = { x: 3, y: -5, z: 0 };
    const hands = pilotLean(w, { x: 0, z: 0 });
    expect(hands.x).toBeLessThan(0); // leans back against +x drift
    w.vel = { x: 0, y: -5, z: 0 };
    const push = pilotLean(w, { x: 1, z: 0 });
    expect(push.x).toBeGreaterThan(0.1); // ~10 deg
    expect(push.z).toBeCloseTo(0, 9);
    const cmd = commandFor(w, { ...NEUTRAL_INPUT, stickX: 1 }, false);
    expect(cmd.attitude).toBe('tilt');
  });

  it('the commanded lean stays at or under 15 deg (abort 30); a big tilt locks the stick out; the stick always has authority', () => {
    const w = createWorld(4, 'pilot');
    w.thrust = massOf(w) * (G0 + 1);
    w.phase = 'burn3';
    w.vel = { x: 20, y: -5, z: -20 };
    for (const tilt of [0, 0.2, 0.45]) {
      w.tilt = { x: tilt, z: 0 };
      const l = pilotLean(w, { x: 1, z: 1 });
      expect(Math.hypot(l.x, l.z)).toBeLessThanOrEqual(PILOT_LEAN_LIMIT_3 + 1e-9);
    }
    // Sliding fast (the damping is braking hard): the stick still changes the lean.
    w.tilt = { x: 0, z: 0 };
    w.vel = { x: -16, y: -5, z: 0 };
    const plus = pilotLean(w, { x: 1, z: 0 }).x;
    const zero = pilotLean(w, { x: 0, z: 0 }).x;
    const minus = pilotLean(w, { x: -1, z: 0 }).x;
    expect(plus - zero).toBeGreaterThan(0.1);
    expect(zero - minus).toBeGreaterThan(0.1);
    // Tilted past 20 deg: the stick is ignored (attitude first).
    w.vel = { x: 0, y: -5, z: 0 };
    w.tilt = { x: 0.45, z: 0 };
    expect(Math.hypot(pilotLean(w, { x: 1, z: 0 }).x)).toBeCloseTo(0, 9);
  });

  it('STEP arms a quick interlock: rotation arrested, step when upright and still, or after 1 s at most', () => {
    const w = createWorld(4, 'pilot');
    stepWorld(w, commandFor(w, { ...NEUTRAL_INPUT, ignite: true, throttle: 1 }, false));
    expect(w.phase).toBe('burn13');
    w.tilt = { x: Math.sin(25 * (Math.PI / 180)), z: 0 };
    w.tiltRate = { x: 0, z: 0 };
    stepWorld(w, commandFor(w, { ...NEUTRAL_INPUT, stepDown: true, throttle: 1 }, false));
    expect(w.phase).toBe('burn13');
    expect(w.stepArmedAt).not.toBeNull();
    const armed = commandFor(w, { ...NEUTRAL_INPUT, throttle: 1 }, false);
    expect(armed.attitude).toBe('rate'); // stop any rotation
    expect(armed.target).toEqual({ x: 0, z: 0 });
    expect(armed.throttle).toBe(1); // the player's throttle stays
    w.tilt = { x: 0.02, z: 0 };
    w.tiltRate = { x: 0, z: 0 };
    stepWorld(w, commandFor(w, NEUTRAL_INPUT, false));
    expect(w.phase).toBe('burn3');
    expect(w.stepArmedAt).toBeNull();

    // Still leaning 25 deg: the step happens anyway after at most 1 s.
    const v = createWorld(4, 'pilot');
    stepWorld(v, commandFor(v, { ...NEUTRAL_INPUT, ignite: true, throttle: 1 }, false));
    v.tilt = { x: Math.sin(25 * (Math.PI / 180)), z: 0 };
    v.tiltRate = { x: 0, z: 0 };
    stepWorld(v, commandFor(v, { ...NEUTRAL_INPUT, stepDown: true, throttle: 1 }, false));
    let steps = 0;
    while (v.phase === 'burn13' && steps < 240) {
      stepWorld(v, commandFor(v, { ...NEUTRAL_INPUT, throttle: 1 }, false));
      steps++;
    }
    expect(v.phase).toBe('burn3');
    expect(steps * DT).toBeLessThanOrEqual(1.0 + 2 * DT);
  });
});

/**
 * Regression (from the operator's probe, Pilot seed 5): fly to 3 engines the way a player
 * would (light on the ideal height, STEP when the fall is under 50 m/s), then hold the stick
 * for 8 s with a gentle V/S throttle.
 */
function holdStick(sx: number): { w: World; x0: number; maxStepTilt: number; worstOvershoot: number; peakVx: number } {
  const w = createWorld(5, 'pilot');
  let g = 0;
  let maxStepTilt = 0;
  let afterStep = -1;
  let peakVx = -Infinity;
  while (w.phase !== 'burn3' && g++ < 120 * 30) {
    const tau = w.ignition ? w.t - w.ignition.t : null;
    const ignite = w.phase === 'coast' && w.pos.y <= idealIgnitionHeight(-w.vel.y);
    stepWorld(w, commandFor(w, { ...NEUTRAL_INPUT, throttle: 1, ignite, stepDown: tau !== null && -w.vel.y < 50 }, false));
  }
  const x0 = w.pos.x;
  const cmds: number[] = [];
  let worstOvershoot = 0;
  for (let i = 0; i < 120 * 8 && !w.done; i++) {
    const frac = (massOf(w) * (G0 + 1 + 0.8 * (-w.vel.y - 25))) / (3 * ENGINE_THRUST);
    const lever = Math.max(0, Math.min(1, (frac - THROTTLE_MIN) / (1 - THROTTLE_MIN)));
    stepWorld(w, commandFor(w, { ...NEUTRAL_INPUT, throttle: lever, stickX: sx }, false));
    afterStep++;
    const tilt = Math.hypot(w.tilt.x, w.tilt.z);
    peakVx = Math.max(peakVx, sx * w.vel.x);
    cmds.push(Math.hypot(w.tiltCmd.x, w.tiltCmd.z));
    if (cmds.length > 360) cmds.shift();
    // The first 2 s: the step-down itself (the tilt carried over must stay small).
    if (afterStep < 240) {
      maxStepTilt = Math.max(maxStepTilt, tilt);
      continue;
    }
    // Then: no tilt beyond the largest command of the last 3 s (+10%).
    worstOvershoot = Math.max(worstOvershoot, tilt - (1.1 * Math.max(...cmds) + 0.01));
  }
  return { w, x0, maxStepTilt, worstOvershoot, peakVx };
}

describe('Pilot on 3 engines: authority, a clean step-down, no attitude overshoot', () => {
  it('the stick moves the booster, symmetrically: +1 vs -1 spread at least 25 m after 8 s, hands-off between', () => {
    const plus = holdStick(1);
    const zero = holdStick(0);
    const minus = holdStick(-1);
    const report = [plus, zero, minus].map((r) => `x0=${r.x0.toFixed(1)} x=${r.w.pos.x.toFixed(1)} vx=${r.w.vel.x.toFixed(2)} ${r.w.outcome?.reason ?? ''}`).join(' | ');
    for (const r of [plus, zero, minus]) expect(r.w.phase, report).toBe('burn3');
    expect(plus.w.pos.x - minus.w.pos.x, report).toBeGreaterThanOrEqual(25);
    const up = plus.w.pos.x - zero.w.pos.x;
    const down = zero.w.pos.x - minus.w.pos.x;
    expect(up, report).toBeGreaterThan(8);
    expect(down, report).toBeGreaterThan(8);
    // Roughly symmetric about hands-off: the stick's share does not depend on the damping (the
    // damping's own clamp can still differ between the runs while the step-down drift brakes).
    expect(Math.abs(up - down), report).toBeLessThan(0.4 * Math.max(up, down));
  });

  it('|tilt| stays under 0.2 through the step-down, and never overshoots the command by more than 10%', () => {
    for (const sx of [1, 0, -1]) {
      const r = holdStick(sx);
      expect(r.maxStepTilt, `sx=${sx}`).toBeLessThan(0.2);
      expect(r.worstOvershoot, `sx=${sx}`).toBeLessThanOrEqual(0);
    }
  });

  it('a held stick settles to a steady slide with no overshoot', () => {
    const r = holdStick(1);
    expect(r.w.done).toBe(false);
    // Full stick heads for ~3.8 m/s (time constant 3 s, starting from the step-down drift).
    expect(r.w.vel.x).toBeGreaterThan(2);
    // The speed approaches its steady value without overshooting it.
    expect(r.peakVx).toBeLessThanOrEqual(Math.max(r.w.vel.x * 1.1, r.w.vel.x + 0.1));
  });
});

/**
 * A plain human strategy for Pilot, from what the HUD shows: light on the 3-2-1 cue, step
 * down when the descent is slow enough, fly the V/S down a gentle profile, steer the stick
 * in proportion to the visible pin offset, press CATCH on the cue. Every reading reaches
 * the hands 250 ms late, and the hand shakes a little. No oracle (no reference trajectory).
 */
function flyHuman(seed: number): { world: World; poll: string } {
  const w = createWorld(seed, 'pilot');
  let poll = 'no poll';
  const trace: string[] = [];
  const rng = makeRng(seed, 99);
  const delay = Math.round(0.25 / DT);
  const seen: { px: number; pz: number; vx: number; vz: number; down: number; hp: number; ignite: boolean; prompt: boolean }[] = [];
  // Gain on the visible offset, and the lead: a human steers on where it is heading (~1.5 s).
  const K = 0.1;
  const LEAD = 1.5;
  let noiseX = 0;
  let noiseZ = 0;
  let lit = false;
  let pressed = false;
  while (!w.done && w.step < 120 * 90) {
    const p = uprightPinOffset(w.pos); // the HUD PIN chip
    const down = Math.max(-w.vel.y, 0);
    const hp = pinHeightAboveRails(w.pos, w.tilt);
    seen.push({
      px: p.x,
      pz: p.z,
      vx: w.vel.x,
      vz: w.vel.z,
      down,
      hp,
      ignite: w.pos.y <= idealIgnitionHeight(down),
      prompt: w.flags.catchPrompt,
    });
    if (seen.length > delay + 1) seen.shift();
    const v = seen[0]!; // what the player reacts to now
    if (w.step % 12 === 0) {
      noiseX = 0.06 * gauss(rng);
      noiseZ = 0.06 * gauss(rng);
    }
    const input: PilotInput = { ...NEUTRAL_INPUT, throttle: 1 };
    if (w.phase === 'coast') {
      if (v.ignite && !lit) {
        input.ignite = true;
        lit = true;
      }
    } else if (w.phase === 'burn13') {
      // Hold toward the tower (gently) while braking; step down once the fall is slow.
      input.stickX = 0.5 * clamp1(-K * v.px) + noiseX;
      input.stickZ = 0.5 * clamp1(-K * v.pz) + noiseZ;
      // Press STEP once the fall is slow; press again if the flight computer refused it.
      if (v.down < 60) input.stepDown = true;
    } else if (w.phase === 'burn3') {
      input.stickX = clamp1(-K * (v.px + LEAD * v.vx) + noiseX);
      input.stickZ = clamp1(-K * (v.pz + LEAD * v.vz) + noiseZ);
      // V/S profile: come down at 0.6 + sqrt(2 a h) m/s, braking at a = 1.2 m/s^2.
      const a = 1.2;
      const want = 0.6 + Math.sqrt(2 * a * Math.max(0, v.hp));
      const up = a + 0.8 * (v.down - want);
      const frac = (massOf(w) * (G0 + up)) / (3 * ENGINE_THRUST);
      input.throttle = Math.max(0, Math.min(1, (frac - THROTTLE_MIN) / (1 - THROTTLE_MIN)));
      // Press and hold CATCH when the button shows (as the tip says), a reaction late.
      if (!pressed && v.prompt) {
        pressed = true;
        trace.push(`press tau=${(w.t - (w.ignition?.t ?? 0)).toFixed(1)} hp=${hp.toFixed(0)} pin=(${p.x.toFixed(1)},${p.z.toFixed(1)})`);
      }
      input.closeArms = pressed;
    }
    const tau = w.ignition ? w.t - w.ignition.t : null;
    if (tau !== null && Math.abs(tau - 13) < DT / 2) trace.push(`tau13 pin=(${p.x.toFixed(0)},${p.z.toFixed(0)}) vx=${w.vel.x.toFixed(1)}`);
    const phase = w.phase;
    const polled = w.gonogo.polled;
    stepWorld(w, commandFor(w, input, false));
    if (phase === 'burn13' && w.phase === 'burn3') {
      trace.push(`step tau=${((tau ?? 0) + DT).toFixed(1)} x=${w.pos.x.toFixed(0)} vx=${w.vel.x.toFixed(1)} down=${(-w.vel.y).toFixed(0)}`);
    }
    if (!polled && w.gonogo.polled && w.gonogo.board) {
      // What the board saw, so a NO-GO names its criterion.
      const red = failedChecks(w.gonogo.board);
      const pp = pinPosition(w.pos, w.tilt);
      poll =
        `poll[${red.length ? `red=${red.join('+')}` : 'all green'} reach=${Math.hypot(pp.x, pp.z).toFixed(0)}/${TRACK_REACH}m` +
        ` pin=(${pp.x.toFixed(0)},${pp.z.toFixed(0)}) down=${(-w.vel.y).toFixed(0)}/60 y=${w.pos.y.toFixed(0)}/150` +
        ` prop=${(w.propellant / 1000).toFixed(1)}t need=${(propellantNeeded(w, w.t - (w.ignition?.t ?? 0)) / 1000).toFixed(1)}t` +
        ` engines=${countRunning(w.engines)} phase=${w.phase}]`;
    }
  }
  return { world: w, poll: `${poll} ${trace.join(' ')}` };
}

describe('Go/No-Go track check measures reach from the arms', () => {
  it('a hand-flown booster over, or a little past, the arms is still GO on track', () => {
    const w = createWorld(2, 'pilot');
    w.vel = { x: 0, y: -30, z: 0 };
    w.tilt = { x: 0, z: 0 };
    w.pos = { x: 0, y: 400, z: 0 };
    expect(healthChecks(w, 8).track).toBe(true); // over the arms (the old check: 30 m off the hold point)
    w.pos.x = -25;
    expect(healthChecks(w, 8).track).toBe(true); // a little past the tower
    w.pos.x = 30;
    expect(healthChecks(w, 8).track).toBe(true); // the autopilot hold point
    w.pos.x = TRACK_REACH + 5;
    expect(healthChecks(w, 8).track).toBe(false); // out of reach
    expect(failedChecks(healthChecks(w, 8))).toContain('track');
  });
});

describe('Pilot fairness: a simple human strategy catches', () => {
  it('catches on at least 3 of 5 seeds, with the ~30 s burn the design wants', () => {
    let caught = 0;
    const report: string[] = [];
    const burns: number[] = [];
    for (let seed = 1; seed <= 5; seed++) {
      const { world: w, poll } = flyHuman(seed);
      const c = w.contact;
      // Where it ended: the real pins, tilt and sideways speed at the end (for a miss).
      const pe = pinPosition(w.pos, w.tilt);
      const burn = w.ignition ? (c?.t ?? w.t) - w.ignition.t : NaN;
      if (w.outcome?.caught) {
        caught++;
        burns.push(burn);
      }
      report.push(
        `${seed}:${w.outcome?.reason ?? 'caught'} burn=${burn.toFixed(1)}s err=${c?.lateralError.toFixed(2) ?? '-'} v=${c?.speed.toFixed(2) ?? '-'} tilt=${c?.tiltDeg.toFixed(2) ?? '-'}` +
          ` end[pin=(${pe.x.toFixed(2)},${pe.z.toFixed(2)}) com=(${w.pos.x.toFixed(2)},${w.pos.z.toFixed(2)}) lat=${Math.hypot(w.vel.x, w.vel.z).toFixed(2)}]` +
          ` prop=${(w.propellant / 1000).toFixed(1)}t ${poll}`,
      );
    }
    expect(caught, report.join(' | ')).toBeGreaterThanOrEqual(3);
    for (const b of burns) {
      expect(b, report.join(' | ')).toBeGreaterThan(26);
      expect(b, report.join(' | ')).toBeLessThan(38);
    }
  });
});
