// Reference trajectory for the landing burn (shared by the autopilot, Cadet assist and the ghost path).
// Time tau is measured from ignition. See docs/design.md "Implementation notes" for the derivation.
//
//  A  0 .. 4 s     13 engines. Upward accel ramps over 1 s (spool), then constant, to -45 m/s at 4 s.
//  B  4 .. 31.5 s  3 engines. Descent speed v(s) = VC + b s + c s^2, s = time to contact.
//  Lateral: Hermite to the hold point by 13 s, then (after GO) a minimum-jerk divert 13 .. 23 s.
import { CONTACT_COM_Y } from './constants';
import type { Vec3 } from './vec';

export const T_STEPDOWN = 4.0;
export const T_DIVERT = 13.0;
export const T_DIVERT_END = 23.0;
export const T_CONTACT = 31.5;
export const T_POLL = 8.0; // Go/No-Go poll
export const T_DECIDE_BY = 12.5; // last moment for the Flight Director call
export const V_STEPDOWN = 45; // m/s descent at step-down
export const V_CONTACT = 1.0; // m/s descent at pin contact
// m/s^2 decel at contact. Keeps the throttle above minimum: 3 engines at 40% give only
// +0.62 m/s^2 of upward acceleration even at 260 t, so the plan never asks for less.
export const B_END = 1.0;
export const RAMP = 1.0; // s, thrust ramp assumed during spool-up
// m offshore of the arm centreline: the safe default hold point. 30 m keeps the divert
// lean at ~10 deg and its peak tilt rate (~10 deg/s) inside 3-engine attitude authority.
export const X_HOLD = 30;
export const VX_STEPDOWN = -6; // m/s lateral at step-down
export const X_STEPDOWN = X_HOLD - (VX_STEPDOWN * (T_DIVERT - T_STEPDOWN)) / 2; // 67 m

const S_B = T_CONTACT - T_STEPDOWN; // 27.5 s
const C_B = (V_STEPDOWN - V_CONTACT - B_END * S_B) / (S_B * S_B);

/** Integral of the ramp function r(tau) (velocity shape of segment A). */
function rampInt(tau: number): number {
  return tau < RAMP ? (tau * tau) / (2 * RAMP) : tau - RAMP / 2;
}
function rampInt2(tau: number): number {
  return tau < RAMP ? (tau * tau * tau) / (6 * RAMP) : (RAMP * RAMP) / 6 + (tau * tau) / 2 - (RAMP * tau) / 2;
}

/** Height of the CoM above the contact height along segment B, s = time to contact. */
function bHeight(s: number): number {
  return V_CONTACT * s + (B_END * s * s) / 2 + (C_B * s * s * s) / 3;
}
export const B_DISTANCE = bHeight(S_B);

/** Upward acceleration in segment A for a descent speed vDown (>0) at ignition. */
export function segmentAAccel(vDown: number): number {
  return (vDown - V_STEPDOWN) / rampInt(T_STEPDOWN);
}

/** Ideal ignition CoM height for the current descent speed (m). */
export function idealIgnitionHeight(vDown: number): number {
  const aA = segmentAAccel(vDown);
  return CONTACT_COM_Y + B_DISTANCE + vDown * T_STEPDOWN - aA * rampInt2(T_STEPDOWN);
}

export interface RefPoint {
  pos: Vec3;
  vel: Vec3;
  acc: Vec3;
}

interface Axis {
  p: number;
  v: number;
  a: number;
}

/** Cubic Hermite from (p0,v0) to (p1,v1) over duration T, evaluated at u in [0,T]. */
function hermite(p0: number, v0: number, p1: number, v1: number, T: number, u: number): Axis {
  const s = Math.min(Math.max(u / T, 0), 1);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const d00 = (6 * s2 - 6 * s) / T;
  const d10 = (3 * s2 - 4 * s + 1);
  const d01 = (-6 * s2 + 6 * s) / T;
  const d11 = 3 * s2 - 2 * s;
  const dd00 = (12 * s - 6) / (T * T);
  const dd10 = (6 * s - 4) / T;
  const dd01 = (-12 * s + 6) / (T * T);
  const dd11 = (6 * s - 2) / T;
  return {
    p: h00 * p0 + h10 * T * v0 + h01 * p1 + h11 * T * v1,
    v: d00 * p0 + d10 * v0 + d01 * p1 + d11 * v1,
    a: dd00 * p0 + dd10 * v0 + dd01 * p1 + dd11 * v1,
  };
}

/** Minimum-jerk move from p0 to p1 (rest to rest) over T. */
function minJerk(p0: number, p1: number, T: number, u: number): Axis {
  const s = Math.min(Math.max(u / T, 0), 1);
  const d = p1 - p0;
  const s3 = s * s * s;
  return {
    p: p0 + d * s3 * (10 - 15 * s + 6 * s * s),
    v: (d * 30 * s * s * (1 - s) * (1 - s)) / T,
    a: (d * 60 * s * (1 - s) * (1 - 2 * s)) / (T * T),
  };
}

function vertical(ign: { pos: Vec3; vel: Vec3 }, tau: number): Axis {
  if (tau >= T_STEPDOWN) {
    const s = Math.max(T_CONTACT - tau, 0);
    const overrun = Math.max(tau - T_CONTACT, 0);
    return {
      p: CONTACT_COM_Y + bHeight(s) - V_CONTACT * overrun,
      v: -(V_CONTACT + B_END * s + C_B * s * s),
      a: tau > T_CONTACT ? 0 : B_END + 2 * C_B * s,
    };
  }
  const t = Math.max(tau, 0);
  const vDown = Math.max(-ign.vel.y, V_STEPDOWN + 1);
  const aA = segmentAAccel(vDown);
  const raw = ign.pos.y - vDown * t + aA * rampInt2(t);
  const end = ign.pos.y - vDown * T_STEPDOWN + aA * rampInt2(T_STEPDOWN);
  // Blend out the small mismatch between the actual ignition height and the ideal one.
  const delta = CONTACT_COM_Y + B_DISTANCE - end;
  const sg = t / T_STEPDOWN;
  return {
    p: raw + delta * sg * sg * (3 - 2 * sg),
    v: -vDown + aA * rampInt(t) + (delta * 6 * sg * (1 - sg)) / T_STEPDOWN,
    a: aA * (t < RAMP ? t / RAMP : 1) + (delta * (6 - 12 * sg)) / (T_STEPDOWN * T_STEPDOWN),
  };
}

// Lateral braking in segment A: the acceleration ramps in with the spool (0..1 s), holds,
// ramps out (2.2..3.5 s) and is zero for the last 0.5 s. The booster is upright and not
// rotating at the step-down to 3 engines, where attitude authority is ~5x lower.
// Only the end velocity is constrained; the end position follows, and the 9 s Hermite
// to the hold point absorbs any offset.
const LA_IN = 1.0;
const LA_OUT = 2.2;
export const LA_END = 3.5; // lateral braking done; the autopilot holds the booster upright after this
const LA_W = LA_END - LA_OUT; // 1.3 s
const LA_S2_OUT = 1 / 6 + 0.5 * (LA_OUT - LA_IN) + ((LA_OUT - LA_IN) * (LA_OUT - LA_IN)) / 2;
const LA_S1_OUT = 0.5 + (LA_OUT - LA_IN);
const LA_S1_TOTAL = LA_S1_OUT + LA_W / 2;
const LA_S2_END = LA_S2_OUT + LA_S1_TOTAL * LA_W - (LA_W * LA_W) / 6;
/** Shape s, its integral S1 and double integral S2 on [0, T_STEPDOWN]. */
function lateralShape(tau: number): { s: number; s1: number; s2: number } {
  const t = Math.min(Math.max(tau, 0), T_STEPDOWN);
  if (t < LA_IN) return { s: t, s1: (t * t) / 2, s2: (t * t * t) / 6 };
  if (t < LA_OUT) {
    const u = t - LA_IN;
    return { s: 1, s1: 0.5 + u, s2: 1 / 6 + 0.5 * u + (u * u) / 2 };
  }
  if (t < LA_END) {
    const w = LA_END - t; // ramp time left
    return {
      s: w / LA_W,
      s1: LA_S1_TOTAL - (w * w) / (2 * LA_W),
      s2: LA_S2_OUT + LA_S1_TOTAL * (t - LA_OUT) - (LA_W * LA_W * LA_W - w * w * w) / (6 * LA_W),
    };
  }
  return { s: 0, s1: LA_S1_TOTAL, s2: LA_S2_END + LA_S1_TOTAL * (t - LA_END) };
}
const LA_S1_END = lateralShape(T_STEPDOWN).s1; // 2.75

/** Segment A lateral state: velocity goes from v0 to vEnd with the braking shape. */
function lateralA(p0: number, v0: number, vEnd: number, tau: number): Axis {
  const a0 = (vEnd - v0) / LA_S1_END;
  const sh = lateralShape(tau);
  const t = Math.min(Math.max(tau, 0), T_STEPDOWN);
  return { p: p0 + v0 * t + a0 * sh.s2, v: v0 + a0 * sh.s1, a: a0 * sh.s };
}

/** Where segment A ends laterally for an ignition state (used to plan the start offset). */
export function lateralAEnd(p0: number, v0: number, vEnd: number): number {
  return lateralA(p0, v0, vEnd, T_STEPDOWN).p;
}

function lateral(p0: number, v0: number, hold: number, vStep: number, go: boolean, divertTo: number, tau: number): Axis {
  if (tau < T_STEPDOWN) return lateralA(p0, v0, vStep, tau);
  const end = lateralA(p0, v0, vStep, T_STEPDOWN);
  if (tau < T_DIVERT) return hermite(end.p, vStep, hold, 0, T_DIVERT - T_STEPDOWN, tau - T_STEPDOWN);
  if (!go) return { p: hold, v: 0, a: 0 };
  return minJerk(hold, divertTo, T_DIVERT_END - T_DIVERT, tau - T_DIVERT);
}

/** Reference state at tau seconds after ignition. `go` unlocks the divert to the tower. */
export function referenceAt(ign: { pos: Vec3; vel: Vec3 }, tau: number, go: boolean): RefPoint {
  const y = vertical(ign, tau);
  const x = lateral(ign.pos.x, ign.vel.x, X_HOLD, VX_STEPDOWN, go, 0, tau);
  const z = lateral(ign.pos.z, ign.vel.z, 0, 0, go, 0, tau);
  return {
    pos: { x: x.p, y: y.p, z: z.p },
    vel: { x: x.v, y: y.v, z: z.v },
    acc: { x: x.a, y: y.a, z: z.a },
  };
}
