// The Catcher: arm close kinematics and the rail spring-damper.
import {
  ARM_OPEN_ANGLE,
  RAIL_BUMP_STIFFNESS,
  RAIL_DAMPING,
  RAIL_STIFFNESS,
  RAIL_STROKE,
} from './constants';
import type { ArmState, RailState } from './types';
import { clamp01 } from './vec';

export const DEFAULT_ARM_CLOSE_TIME = 5.0;

export function makeArms(closeTime = DEFAULT_ARM_CLOSE_TIME): ArmState {
  return { closeTime, closing: false, tStart: null, progress: 0, closed: false, pinHeightAtClose: null };
}

/** Eased close profile: slow start (hydraulics), fast middle, gentle finish against the bumpers. */
export function armProgressAt(elapsed: number, closeTime: number): number {
  const s = clamp01(elapsed / closeTime);
  return s * s * s * (s * (s * 6 - 15) + 10); // quintic smoothstep
}

/** Arm swing angle from the closed position (rad): ARM_OPEN_ANGLE when open, 0 when closed. */
export function armAngle(progress: number): number {
  return ARM_OPEN_ANGLE * (1 - clamp01(progress));
}

export function startClose(arms: ArmState, t: number): boolean {
  if (arms.closing || arms.closed) return false;
  arms.closing = true;
  arms.tStart = t;
  return true;
}

/** Advances the arms. Returns true on the step the arms finish closing. */
export function updateArms(arms: ArmState, t: number): boolean {
  if (!arms.closing || arms.tStart === null) return false;
  const elapsed = t - arms.tStart;
  arms.progress = armProgressAt(elapsed, arms.closeTime);
  if (elapsed >= arms.closeTime) {
    arms.progress = 1;
    arms.closing = false;
    arms.closed = true;
    return true;
  }
  return false;
}

export function makeRails(): RailState {
  return { compression: 0, rate: 0, peakForce: 0 };
}

/** Rail force for a compression and compression rate (N, >= 0). */
export function railForce(compression: number, rate: number): number {
  if (compression <= 0) return 0;
  let f = RAIL_STIFFNESS * compression + RAIL_DAMPING * rate;
  if (compression > RAIL_STROKE) f += RAIL_BUMP_STIFFNESS * (compression - RAIL_STROKE);
  return Math.max(0, f);
}

/**
 * Advances the rail spring-damper carrying a mass `m` (kg) under gravity g.
 * Compression grows downward. Semi-implicit Euler, stable at 120 Hz.
 */
export function updateRails(r: RailState, m: number, g: number, dt: number): number {
  const f = railForce(r.compression, r.rate);
  const acc = g - f / m; // d(rate)/dt, positive = compressing faster
  r.rate += acc * dt;
  r.compression += r.rate * dt;
  if (r.compression < 0) {
    r.compression = 0;
    if (r.rate < 0) r.rate = 0;
  }
  if (f > r.peakForce) r.peakForce = f;
  return f;
}

export function staticCompression(m: number, g: number): number {
  return (m * g) / RAIL_STIFFNESS;
}
