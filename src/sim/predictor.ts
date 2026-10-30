// Predictors for the HUD and the CATCH prompt: stop height, impact point, pin path, contact time.
import { CONTACT_COM_Y, DRY_MASS, ENGINE_COUNT, ENGINE_THRUST, G0, PIN_ABOVE_COM, RAIL_Y } from './constants';
import { idealIgnitionHeight } from './reference';
import { axisFromTilt, type Vec2, type Vec3 } from './vec';

/** Assumed descent speed at contact used by the contact-time model (m/s). */
export const PRED_CONTACT_SPEED = 1.0;

export function pinPosition(pos: Vec3, tilt: Vec2): Vec3 {
  const a = axisFromTilt(tilt);
  return { x: pos.x + PIN_ABOVE_COM * a.x, y: pos.y + PIN_ABOVE_COM * a.y, z: pos.z + PIN_ABOVE_COM * a.z };
}

export function pinHeightAboveRails(pos: Vec3, tilt: Vec2): number {
  return pinPosition(pos, tilt).y - RAIL_Y;
}

/**
 * Where the pins will be, sideways, once the booster stands upright: the CoM's horizontal
 * position (m from the arm centreline). The HUD shows this, not the raw pins. A lean of a
 * few degrees swings the raw pins (39 m above the CoM) by metres, and a player who chases
 * that swing makes it worse (pilot-induced oscillation). At contact the booster is within
 * 2 deg of upright, so the two agree to about a metre.
 */
export function uprightPinOffset(pos: Vec3): { x: number; z: number } {
  return { x: pos.x, z: pos.z };
}

/** Horizontal distance of the pins from the arm centreline (m). */
export function pinLateralError(pos: Vec3, tilt: Vec2): number {
  const p = pinPosition(pos, tilt);
  return Math.hypot(p.x, p.z);
}

/**
 * Predicted time until the pins reach the rails, assuming the descent speed falls
 * linearly from the current value to PRED_CONTACT_SPEED (the shape of a good final approach).
 * Infinity when climbing or hovering.
 */
export function timeToContact(pinHeight: number, vy: number): number {
  const down = -vy;
  if (pinHeight <= 0) return 0;
  if (down <= 0.05) return Infinity;
  return (2 * pinHeight) / (down + PRED_CONTACT_SPEED);
}

/**
 * CoM height at which the booster would stop if all running engines lit now at full
 * throttle (accounting ~0.9 s of spool at half thrust). Negative values mean "too late".
 */
export function stopHeight(
  y: number,
  vy: number,
  propellant: number,
  engines = ENGINE_COUNT,
  throttle = 1,
  dragAccel = 0,
): number {
  const m = DRY_MASS + propellant;
  const down = Math.max(-vy, 0);
  const spool = 0.9;
  const aFull = (engines * ENGINE_THRUST * throttle) / m - G0 + dragAccel;
  if (aFull <= 0) return -Infinity;
  // During spool: average half thrust.
  const aSpool = aFull / 2 - G0 / 2 + dragAccel / 2;
  const v1 = Math.max(down - aSpool * spool, 0);
  const d1 = ((down + v1) / 2) * spool;
  return y - d1 - (v1 * v1) / (2 * aFull);
}

/** Stop height expressed relative to the CoM contact height (0 = stop exactly at the rails). */
export function stopMargin(y: number, vy: number, propellant: number, engines = ENGINE_COUNT): number {
  return stopHeight(y, vy, propellant, engines) - CONTACT_COM_Y;
}

/** How far (m) the current height is from the ideal ignition height for this speed. + = early. */
export function ignitionError(y: number, vy: number): number {
  return y - idealIgnitionHeight(Math.max(-vy, 0));
}

/** Ballistic impact point on the ground (y = 0) with constant acceleration. */
export function impactPoint(pos: Vec3, vel: Vec3, acc: Vec3 = { x: 0, y: -G0, z: 0 }): Vec3 {
  const a = 0.5 * acc.y;
  const b = vel.y;
  const c = pos.y;
  let t: number;
  if (Math.abs(a) < 1e-9) t = b < 0 ? -c / b : Infinity;
  else {
    const disc = b * b - 4 * a * c;
    t = disc < 0 ? Infinity : (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) t = (-b + Math.sqrt(Math.max(disc, 0))) / (2 * a);
  }
  if (!Number.isFinite(t) || t < 0) return { x: pos.x, y: 0, z: pos.z };
  return { x: pos.x + vel.x * t + 0.5 * acc.x * t * t, y: 0, z: pos.z + vel.z * t + 0.5 * acc.z * t * t };
}

/** Predicted pin path under constant acceleration (for the ghost marker). */
export function predictedPinPath(
  pos: Vec3,
  vel: Vec3,
  tilt: Vec2,
  acc: Vec3,
  horizon: number,
  n: number,
): Vec3[] {
  const pin0 = pinPosition(pos, tilt);
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (horizon * i) / n;
    out.push({
      x: pin0.x + vel.x * t + 0.5 * acc.x * t * t,
      y: pin0.y + vel.y * t + 0.5 * acc.y * t * t,
      z: pin0.z + vel.z * t + 0.5 * acc.z * t * t,
    });
  }
  return out;
}
