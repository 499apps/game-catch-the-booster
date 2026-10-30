// Deterministic autopilot: powered-descent guidance that tracks the reference trajectory
// (src/sim/reference.ts) with feed-forward + PD, including the pendulum divert.
// Pure: reads the world, returns a FlightCommand. Used by Cadet assist, the ghost path,
// the golden tests and the ?autopilot=1 hook.
import { COP_ABOVE_COM, DT, ENGINE_THRUST, G0, PIN_ABOVE_COM, RAD } from './constants';
import { aeroNow, massOf } from './dynamics';
import { availableEngines } from './engines';
import { boardHealthy } from './gonogo';
import { pinHeightAboveRails, timeToContact } from './predictor';
import { LA_END, T_CONTACT, T_DIVERT, T_STEPDOWN, idealIgnitionHeight, referenceAt } from './reference';
import type { FlightCommand, World } from './types';
import { axisFromTilt, clampLen2, type Vec2, type Vec3 } from './vec';

// Lateral gains. 13 engines: omega_n 0.6 rad/s. 3 engines: omega_n 0.5 rad/s, zeta 0.9,
// well below the attitude loop (1.8 rad/s) so the lean the loop asks for is one it can fly.
export const KP_LAT = 0.36;
export const KD_LAT = 1.1;
export const KP_LAT3 = 0.25;
export const KD_LAT3 = 0.9;
export const KP_VERT = 1.0;
export const KD_VERT = 1.8;
export const CADET_LAT_GAIN = 0.8; // 1/s, lateral velocity hold
// s: press CATCH when predicted contact <= close time + this. The arms then finish
// ~1 s before contact with the pins ~2-3 m above the rails (window 0-20 m).
export const PRESS_LEAD = 1.2;
const TILT_LIMIT_13 = Math.sin(35 * RAD);
const TILT_LIMIT_UPRIGHT = Math.sin(3 * RAD); // last 0.5 s before step-down
// 3 engines: full gimbal gives only ~0.26 rad/s^2. Attitude has priority over position:
// the lean command is clamped and slew-limited to what the attitude loop can follow.
export const TILT_LIMIT_3 = Math.sin(12 * RAD);
export const TILT_SLEW_3 = 0.2; // rad/s

/** Lean limit on 13 engines: wide for braking, then upright before step-down. */
function tiltLimit13(tau: number): number {
  const fadeStart = LA_END - 0.5;
  if (tau <= fadeStart) return TILT_LIMIT_13;
  if (tau >= LA_END) return TILT_LIMIT_UPRIGHT;
  const s = (tau - fadeStart) / 0.5;
  return TILT_LIMIT_13 + (TILT_LIMIT_UPRIGHT - TILT_LIMIT_13) * s;
}

export interface AutopilotOptions {
  /** Cadet: the player's stick commands lateral velocity after the divert starts. */
  lateralVelocity?: Vec2 | null;
  /** Let the autopilot press CATCH (false in Cadet: the player presses it). */
  pressCatch?: boolean;
  /** Let the autopilot make the Flight Director call. */
  decide?: boolean;
}

const tmpAero: Vec3 = { x: 0, y: 0, z: 0 };
const tmpAeroG: Vec3 = { x: 0, y: 0, z: 0 };

export function emptyCommand(): FlightCommand {
  return {
    attitude: 'tilt',
    target: { x: 0, z: 0 },
    throttle: 0.4,
    roll: 0,
    ignite: false,
    stepDown: false,
    closeArms: false,
    go: false,
    noGo: false,
  };
}

/** Desired acceleration (m/s^2, without gravity) from guidance. Null before ignition. */
export function guidanceAccel(w: World, opts: AutopilotOptions = {}): Vec3 | null {
  if (!w.ignition) return null;
  const tau = w.t - w.ignition.t;
  const go = w.gonogo.decision === 'go';
  const ref = referenceAt(w.ignition, tau, go);
  if (tau >= T_DIVERT) {
    // Aim the pins, not the CoM: in a steady side wind the booster leans into it by about
    // -aero/(m g), which moves the pins 39 m * lean. Offset the CoM target to cancel that.
    aeroNow(w, tmpAeroG);
    const k = PIN_ABOVE_COM / (massOf(w) * G0);
    ref.pos.x += k * tmpAeroG.x;
    ref.pos.z += k * tmpAeroG.z;
  }
  // Lateral feedback point. On 3 engines the gimbal side force is as large as the lean
  // itself (right-half-plane zero near 1 rad/s), so steer the centre of percussion, which
  // the side force does not move. On 13 engines that zero is far above the loop bandwidth.
  const three = w.phase === 'burn3';
  const cop = three ? COP_ABOVE_COM : 0;
  const kp = three ? KP_LAT3 : KP_LAT;
  const kd = three ? KD_LAT3 : KD_LAT;
  const leanRefX = ref.acc.x / (ref.acc.y + G0);
  const leanRefZ = ref.acc.z / (ref.acc.y + G0);
  const px = w.pos.x + cop * w.tilt.x;
  const pz = w.pos.z + cop * w.tilt.z;
  const vx = w.vel.x + cop * w.tiltRate.x;
  const vz = w.vel.z + cop * w.tiltRate.z;
  const a: Vec3 = {
    x: ref.acc.x + kp * (ref.pos.x + cop * leanRefX - px) + kd * (ref.vel.x - vx),
    y: ref.acc.y + KP_VERT * (ref.pos.y - w.pos.y) + KD_VERT * (ref.vel.y - w.vel.y),
    z: ref.acc.z + kp * (ref.pos.z + cop * leanRefZ - pz) + kd * (ref.vel.z - vz),
  };
  const lv = opts.lateralVelocity;
  if (lv && w.flags.divert) {
    a.x = CADET_LAT_GAIN * (lv.x - vx);
    a.z = CADET_LAT_GAIN * (lv.z - vz);
  }
  return a;
}

export function autopilotCommand(w: World, opts: AutopilotOptions = {}): FlightCommand {
  const cmd = emptyCommand();
  const pressCatch = opts.pressCatch ?? true;
  const decide = opts.decide ?? true;
  const m = massOf(w);
  aeroNow(w, tmpAero);

  if (w.phase === 'coast') {
    // Hold retrograde attitude; light the engines at the ideal height for this speed.
    const sp = Math.hypot(w.vel.x, w.vel.y, w.vel.z) || 1;
    cmd.target = { x: -w.vel.x / sp, z: -w.vel.z / sp };
    cmd.throttle = 0.7;
    cmd.ignite = w.pos.y <= idealIgnitionHeight(Math.max(-w.vel.y, 0));
    return cmd;
  }
  if (w.phase !== 'burn13' && w.phase !== 'burn3') return cmd;

  const tau = w.t - (w.ignition?.t ?? w.t);
  const a = guidanceAccel(w, opts) ?? { x: 0, y: 0, z: 0 };
  // Required force from the engines: m (a + g) minus the known aerodynamic force.
  const fx = m * a.x - tmpAero.x;
  const fy = m * (a.y + G0) - tmpAero.y;
  const fz = m * a.z - tmpAero.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const limit = w.phase === 'burn13' ? tiltLimit13(tau) : TILT_LIMIT_3;
  let target: Vec2 = fy > 0 ? clampLen2({ x: fx / fl, z: fz / fl }, limit) : { x: 0, z: 0 };
  if (w.phase === 'burn3') {
    // Slew-limit the lean command from the last one the flight computer accepted.
    const step = clampLen2({ x: target.x - w.tiltCmd.x, z: target.z - w.tiltCmd.z }, TILT_SLEW_3 * DT);
    target = { x: w.tiltCmd.x + step.x, z: w.tiltCmd.z + step.z };
  }
  cmd.target = target;

  const axis = axisFromTilt(w.tilt);
  const along = Math.max(fx * axis.x + fy * axis.y + fz * axis.z, 0);
  const avail = availableEngines(w.engines);
  cmd.throttle = avail > 0.05 ? along / (avail * ENGINE_THRUST) : 1;

  if (w.phase === 'burn13' && tau >= T_STEPDOWN) cmd.stepDown = true;

  const g = w.gonogo;
  if (decide && g.polled && g.decision === 'pending' && g.board) {
    if (boardHealthy(g.board)) cmd.go = true;
    else cmd.noGo = true;
  }

  if (pressCatch && w.phase === 'burn3' && w.flags.divert && !w.arms.closing && !w.arms.closed) {
    const tgo = timeToContact(pinHeightAboveRails(w.pos, w.tilt), w.vel.y);
    if (tgo <= w.arms.closeTime + PRESS_LEAD) cmd.closeArms = true;
  }
  return cmd;
}

/** Ghost path: reference CoM positions from now to contact (for Cadet's ghost and the HUD). */
export function ghostPath(w: World, n = 24): Vec3[] {
  if (!w.ignition) return [];
  const tau0 = w.t - w.ignition.t;
  const go = w.gonogo.decision !== 'noGo';
  const out: Vec3[] = [];
  const end = Math.max(tau0, T_CONTACT);
  for (let i = 0; i <= n; i++) {
    const tau = tau0 + ((end - tau0) * i) / n;
    out.push(referenceAt(w.ignition, tau, go).pos);
  }
  return out;
}
