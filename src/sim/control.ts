// Control laws per tier: PilotInput -> FlightCommand (the assist ladder).
//  Cadet: autopilot flies the whole profile, including the divert to the tower. After the
//         divert starts the stick moves the divert's aim point (World.aim), never the
//         booster itself, so it cannot destabilise it. Auto ignition and step-down. The
//         player presses CATCH.
//  Pilot: throttle lever + stick; the player ignites and steps down. Auto Go/No-Go.
//         13 engines: the flight computer flies the braking lean (it cancels the ~100 m/s
//         approach speed, as the real vehicle's guidance does); the stick adds a small bias.
//         STEP arms the step-down; world.ts makes it once the booster is upright and still.
//         3 engines: attitude command (the stick sets the lean angle) with lateral damping.
//  Flight Director: direct gimbal and throttle; the player makes the Go/No-Go call.
// The stick is already in world axes here: the game rotates it by the camera yaw first.
import { CADET_AIM_RATE, autopilotCommand, guidanceAccel } from './autopilot';
import { COP_ABOVE_COM, DT, G0, RAD, THROTTLE_MAX, THROTTLE_MIN } from './constants';
import { massOf } from './dynamics';
import { pinHeightAboveRails } from './predictor';
import { idealIgnitionHeight } from './reference';
import type { FlightCommand, PilotInput, World } from './types';
import { clamp, clampLen2, tiltAngle, type Vec2 } from './vec';
/**
 * s: a Cadet LIGHT tap lights the engines only this close to the ideal ignition. An earlier
 * tap just arms the cue (the game shows it); the auto ignition lights on the mark.
 */
export const CADET_TAP_WINDOW = 0.3;
/** Pilot lean limit on 13 engines (braking). */
export const PILOT_LEAN_LIMIT_13 = Math.sin(35 * RAD);
/** sin of the lean bias the stick adds on 13 engines (3 deg): a nudge, it cannot overshoot. */
export const PILOT_STICK_LEAN_13 = Math.sin(3 * RAD);
/**
 * 13 engines: the lean allowed fades gently to near upright (2 deg) as the fall slows from
 * 120 to 60 m/s, and the lean command moves no faster than PILOT_SLEW_13. So the booster
 * reaches the step-down speed upright and not rotating: 3 engines never inherit a lean that
 * they then fly sideways on (the 13 -> 3 kick seen in the probe), and the gentle rate (vs.
 * the fast c5d fade) leaves no rotation for 3 engines to stop.
 */
export const PILOT_FULL_LEAN_SPEED = 120;
export const PILOT_UPRIGHT_SPEED = 60;
export const PILOT_LEAN_UPRIGHT = Math.sin(2 * RAD);
export const PILOT_SLEW_13 = 0.3; // rad/s
/**
 * Pilot lean limit on 3 engines (15 deg; the tilt abort is 30 deg). Fixed shares: the stick
 * owns 45% (PILOT_MAX_LEAN), the velocity damping 55% (PILOT_DAMP_LEAN). The two never
 * exceed the limit together; the stick's effect is the same whatever the damping is doing
 * (+1 and -1 are symmetric about hands-off); and the damping can out-pull a held stick, so
 * the slide always settles.
 */
export const PILOT_LEAN_LIMIT_3 = Math.sin(15 * RAD);
export const PILOT_MAX_LEAN = 0.45 * PILOT_LEAN_LIMIT_3;
export const PILOT_DAMP_LEAN = 0.55 * PILOT_LEAN_LIMIT_3;
/**
 * s: lateral damping time constant on 3 engines. Full stick settles at about
 * PILOT_MAX_LEAN * tau * (thrust / m) = 0.117 * 3 * 10.8 = 3.8 m/s, with no overshoot.
 */
export const PILOT_DAMP_TAU_3 = 3.0;
/**
 * rad/s: the Pilot lean command on 3 engines moves no faster than this (the autopilot's
 * 3-engine slew). 0.1 rad/s was too slow: a lean carried over from 13 engines took ~3 s to
 * take back, and at high 3-engine thrust the booster flew sideways on it meanwhile.
 */
export const PILOT_SLEW_3 = 0.2;
/**
 * Final approach: station-keeping. Below PILOT_FINE_HEIGHT (blended over the PILOT_FINE_BLEND m
 * above it) the flight computer holds a lateral VELOCITY, as the real vehicle does: the stick
 * commands at most PILOT_HOLD_SPEED (fading to PILOT_HOLD_SPEED_MIN at the rails, under the
 * 1 m/s contact limit), the hold tracks it with time constant PILOT_HOLD_TAU, and its lean is
 * capped at PILOT_HOLD_LEAN (fading to PILOT_HOLD_LEAN_MIN at the rails, under the 2 deg
 * contact limit). So a hand-flown final approach cannot arrive sliding or tilted.
 * The c5f "more authority, softer 2.2 s hold" did the opposite and oscillated.
 */
export const PILOT_FINE_HEIGHT = 30;
export const PILOT_FINE_BLEND = 10;
export const PILOT_HOLD_TAU = 1.1;
export const PILOT_HOLD_SPEED = 1.5;
export const PILOT_HOLD_SPEED_MIN = 0.6;
export const PILOT_HOLD_LEAN = Math.sin(6 * RAD);
export const PILOT_HOLD_LEAN_MIN = Math.sin(1.5 * RAD);
/** m of pin height over which the hold's speed and lean caps fade to their minimum. */
export const PILOT_HOLD_FADE = 15;
/** rad: above this tilt on 3 engines, attitude has priority: the stick is ignored until upright. */
export const PILOT_RIGHTING_TILT = 20 * RAD;
/** rad/s of tilt rate at full stick while coasting (no thrust: the fins hold the attitude). */
export const PILOT_COAST_TILT_RATE = 0.18; // c10: was 0.105 (6 deg/s), too weak to feel; ~10 deg/s reads at once

export const leverToThrottle = (lever: number): number =>
  THROTTLE_MIN + (THROTTLE_MAX - THROTTLE_MIN) * clamp(lever, 0, 1);

/**
 * Pilot lean target.
 *  13 engines: the guidance braking lean (lateral accel of the reference, flown with the
 *  actual thrust) plus a small stick bias. Before this, a damping law with a long time
 *  constant braked too little: a booster that stepped down on time still slid ~20 m/s
 *  toward the tower, and 3 engines could not stop it before it passed the arms.
 *  The allowed lean fades to near upright as the fall slows toward step-down speed.
 *  (Once the player asks for the step-down, commandFor arrests the rotation instead.)
 *  3 engines, cruise: the stick sets a lean (attitude command, its fixed share of the limit)
 *  and a damping lean (the other share) opposes the slide, so a hands-off booster stops.
 *  3 engines, final approach: station-keeping on a stick-commanded lateral velocity (see
 *  PILOT_HOLD_*). A large tilt locks the stick out until upright. The lean never exceeds
 *  15 deg (the abort is 30 deg); near the rails it stays under the 2 deg contact limit.
 */
export function pilotLean(w: World, stick: Vec2): Vec2 {
  // Lean -> lateral accel is (thrust / m) * lean; never below g, so a spooling engine set
  // does not ask for a huge lean.
  const aT = Math.max(w.thrust / massOf(w), G0);
  let s = clampLen2(stick, 1);
  if (w.phase !== 'burn3') {
    const g = guidanceAccel(w);
    const target = {
      x: (g ? g.x / aT : 0) + s.x * PILOT_STICK_LEAN_13,
      z: (g ? g.z / aT : 0) + s.z * PILOT_STICK_LEAN_13,
    };
    const k = clamp((-w.vel.y - PILOT_UPRIGHT_SPEED) / (PILOT_FULL_LEAN_SPEED - PILOT_UPRIGHT_SPEED), 0, 1);
    return clampLen2(target, PILOT_LEAN_UPRIGHT + (PILOT_LEAN_LIMIT_13 - PILOT_LEAN_UPRIGHT) * k);
  }
  if (tiltAngle(w.tilt) > PILOT_RIGHTING_TILT) s = { x: 0, z: 0 };
  // Damp the centre of percussion's velocity, not the CoM's (as the autopilot does): the
  // gimbal side force moves the CoM the wrong way first, and a velocity hold on the CoM
  // chases that (a right-half-plane zero near 1 rad/s), which makes a firm hold oscillate.
  const vx = w.vel.x + COP_ABOVE_COM * w.tiltRate.x;
  const vz = w.vel.z + COP_ABOVE_COM * w.tiltRate.z;
  const hp = pinHeightAboveRails(w.pos, w.tilt);

  // Cruise: the stick sets a lean (its fixed share); the damping lean (the rest) slows the slide.
  const damp = clampLen2({ x: -vx / (PILOT_DAMP_TAU_3 * aT), z: -vz / (PILOT_DAMP_TAU_3 * aT) }, PILOT_DAMP_LEAN);
  const cruise = { x: s.x * PILOT_MAX_LEAN + damp.x, z: s.z * PILOT_MAX_LEAN + damp.z };

  // Final approach: station-keeping on a stick-commanded lateral velocity.
  const near = clamp(hp / PILOT_HOLD_FADE, 0, 1);
  const vMax = PILOT_HOLD_SPEED_MIN + (PILOT_HOLD_SPEED - PILOT_HOLD_SPEED_MIN) * near;
  const holdLean = PILOT_HOLD_LEAN_MIN + (PILOT_HOLD_LEAN - PILOT_HOLD_LEAN_MIN) * near;
  const hold = clampLen2(
    { x: (s.x * vMax - vx) / (PILOT_HOLD_TAU * aT), z: (s.z * vMax - vz) / (PILOT_HOLD_TAU * aT) },
    holdLean,
  );

  const b = clamp((hp - PILOT_FINE_HEIGHT) / PILOT_FINE_BLEND, 0, 1); // 1 = cruise, 0 = hold
  return { x: b * cruise.x + (1 - b) * hold.x, z: b * cruise.z + (1 - b) * hold.z };
}

export function commandFor(w: World, input: PilotInput, autopilot: boolean): FlightCommand {
  if (autopilot) return autopilotCommand(w);
  switch (w.cfg.control) {
    case 'cadet': {
      const cmd = autopilotCommand(w, { cadet: true, pressCatch: false, decide: false });
      // The stick moves the aim point (world.ts limits, rate-limits and freezes it).
      cmd.aimRate = {
        x: clamp(input.stickX, -1, 1) * CADET_AIM_RATE,
        z: clamp(input.stickZ, -1, 1) * CADET_AIM_RATE,
      };
      // A tap on the "3-2-1 LIGHT" cue lights the engines; auto ignition never lets it be
      // late, and a tap counts only in the last moment, so an early tap cannot waste the burn.
      if (input.ignite && w.phase === 'coast') {
        const down = Math.max(-w.vel.y, 0);
        if (w.pos.y <= idealIgnitionHeight(down) + CADET_TAP_WINDOW * down) cmd.ignite = true;
      }
      cmd.closeArms = input.closeArms;
      return cmd;
    }
    case 'pilot': {
      const stick = { x: clamp(input.stickX, -1, 1), z: clamp(input.stickZ, -1, 1) };
      const common = {
        throttle: leverToThrottle(input.throttle),
        roll: 0,
        ignite: input.ignite,
        // The interlock in world.ts decides when the step-down happens.
        stepDown: false,
        stepArm: input.stepDown,
        closeArms: input.closeArms,
        go: false,
        noGo: false,
      };
      if (w.phase !== 'burn13' && w.phase !== 'burn3') {
        // Coasting: no thrust to lean with. The stick nudges the attitude; hands off holds it.
        return { attitude: 'rate', target: { x: stick.x * PILOT_COAST_TILT_RATE, z: stick.z * PILOT_COAST_TILT_RATE }, ...common };
      }
      if (w.phase === 'burn13' && w.stepArmedAt !== null) {
        // Step-down asked: the strong 13-engine set stops any rotation first (rate hold), so
        // 3 engines take over a still booster. The interlock in world.ts then steps.
        return { attitude: 'rate', target: { x: 0, z: 0 }, ...common };
      }
      let target = pilotLean(w, stick);
      if (w.phase === 'burn13') {
        // A gentle lean command on 13 engines too: no rotation is left at the step-down.
        const step = clampLen2({ x: target.x - w.tiltCmd.x, z: target.z - w.tiltCmd.z }, PILOT_SLEW_13 * DT);
        target = { x: w.tiltCmd.x + step.x, z: w.tiltCmd.z + step.z };
      }
      if (w.phase === 'burn3') {
        // 3 engines have little attitude authority: a slow lean command, so it never overshoots.
        const step = clampLen2({ x: target.x - w.tiltCmd.x, z: target.z - w.tiltCmd.z }, PILOT_SLEW_3 * DT);
        target = { x: w.tiltCmd.x + step.x, z: w.tiltCmd.z + step.z };
      }
      return { attitude: 'tilt', target, ...common };
    }
    case 'fd':
      return {
        attitude: 'direct',
        // Positive gimbal pushes the tail +x and tips the nose -x, so invert the stick.
        target: { x: -clamp(input.stickX, -1, 1), z: -clamp(input.stickZ, -1, 1) },
        throttle: leverToThrottle(input.throttle),
        roll: clamp(input.yaw, -1, 1),
        ignite: input.ignite,
        stepDown: input.stepDown,
        closeArms: input.closeArms,
        go: input.go,
        noGo: input.noGo,
      };
  }
}
