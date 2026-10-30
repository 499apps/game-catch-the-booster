// Rigid-body flight dynamics: flight computer (attitude), forces, integration, mass flow.
import { aeroForce, dynamicPressure, finGate } from './atmosphere';
import {
  BOOSTER_LENGTH,
  DRY_MASS,
  FIN_ALPHA_PER_PA,
  G0,
  GIMBAL_BELOW_COM,
  GIMBAL_MAX,
  INERTIA_FACTOR,
  MAX_TILT,
} from './constants';
import { massFlowFor, shutdownAll, totalThrust } from './engines';
import { gauss, type Rng } from './rng';
import type { FlightCommand, World } from './types';
import { windAt } from './wind';
import { axisFromTilt, clamp, clampLen2, type Vec2, type Vec3 } from './vec';

export const ATT_KP = 3.24; // (rad/s^2) per unit tilt error: omega_n = 1.8 rad/s
export const ATT_KD = 3.06; // zeta = 0.85
export const RATE_K = 2.5; // Pilot rate-damping mode gain
export const CMD_RATE_TAU = 0.15; // s, filter on the tilt-target rate
export const CMD_RATE_MAX = 0.5; // rad/s, cap on the rate feed-forward
export const TWITCH_TAU = 0.08; // s
export const TWITCH_TORQUE = 0.002; // rad/s^2 at unit twitch

export const massOf = (w: World): number => DRY_MASS + w.propellant;
export const inertiaOf = (m: number): number => INERTIA_FACTOR * m * BOOSTER_LENGTH * BOOSTER_LENGTH;

const tmpWind: Vec3 = { x: 0, y: 0, z: 0 };
const tmpAir: Vec3 = { x: 0, y: 0, z: 0 };
const tmpAero: Vec3 = { x: 0, y: 0, z: 0 };

/** Air-relative velocity of the vehicle (velocity minus wind). */
export function airVelocity(w: World, out: Vec3): Vec3 {
  if (w.noAero) {
    out.x = w.vel.x;
    out.y = w.vel.y;
    out.z = w.vel.z;
    return out;
  }
  windAt(w.wind, w.pos.y, tmpWind);
  out.x = w.vel.x - tmpWind.x;
  out.y = w.vel.y - tmpWind.y;
  out.z = w.vel.z - tmpWind.z;
  return out;
}

/** Aerodynamic force on the vehicle now (N). Zero when aero is disabled. */
export function aeroNow(w: World, out: Vec3): Vec3 {
  if (w.noAero) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  airVelocity(w, tmpAir);
  return aeroForce(w.pos.y, tmpAir, axisFromTilt(w.tilt), out);
}

export function dynamicPressureNow(w: World): number {
  if (w.noAero) return 0;
  airVelocity(w, tmpAir);
  return dynamicPressure(w.pos.y, Math.hypot(tmpAir.x, tmpAir.y, tmpAir.z));
}

/** Largest angular acceleration the grid fins can give now (rad/s^2). */
export function finAuthority(w: World): number {
  const q = dynamicPressureNow(w);
  return FIN_ALPHA_PER_PA * q * finGate(q);
}

/** Converts the attitude command into gimbal + fin deflection; returns the commanded angular accel. */
function flightComputer(
  w: World,
  cmd: FlightCommand,
  thrust: number,
  inertia: number,
  finMax: number,
  dt: number,
): Vec2 {
  const leverGain = (thrust * GIMBAL_BELOW_COM) / inertia; // rad/s^2 per rad of gimbal
  if (cmd.attitude !== 'tilt') {
    w.tiltCmd = { x: w.tilt.x, z: w.tilt.z };
    w.tiltCmdRate = { x: 0, z: 0 };
  }
  if (cmd.attitude === 'direct') {
    const g = clampLen2(cmd.target, 1);
    w.gimbal = { x: g.x * GIMBAL_MAX, z: g.z * GIMBAL_MAX };
    w.fin = { x: -g.x, z: -g.z };
    return { x: -leverGain * w.gimbal.x - finMax * g.x, z: -leverGain * w.gimbal.z - finMax * g.z };
  }
  let alpha: Vec2;
  if (cmd.attitude === 'tilt') {
    const t = clampLen2(cmd.target, MAX_TILT);
    // Rate feed-forward: the filtered rate of the target removes most of the PD lag.
    const k = 1 - Math.exp(-dt / CMD_RATE_TAU);
    const raw = { x: (t.x - w.tiltCmd.x) / dt, z: (t.z - w.tiltCmd.z) / dt };
    w.tiltCmdRate = clampLen2(
      { x: w.tiltCmdRate.x + (raw.x - w.tiltCmdRate.x) * k, z: w.tiltCmdRate.z + (raw.z - w.tiltCmdRate.z) * k },
      CMD_RATE_MAX,
    );
    w.tiltCmd = { x: t.x, z: t.z };
    // Saturation-aware PD: the closing rate is capped at what the available angular
    // acceleration can still stop (v^2 = 2 a d, with 40% margin), so a weak 3-engine
    // bank never builds a rate it cannot brake. Inside the cap this is the plain PD.
    const aMax = Math.max(leverGain * GIMBAL_MAX + finMax, 1e-3);
    const ex = t.x - w.tilt.x;
    const ez = t.z - w.tilt.z;
    const el = Math.hypot(ex, ez);
    const closing = Math.min((ATT_KP / ATT_KD) * el, Math.sqrt(2 * 0.6 * aMax * el));
    const kc = el > 1e-12 ? closing / el : 0;
    alpha = {
      x: ATT_KD * (ex * kc + w.tiltCmdRate.x - w.tiltRate.x),
      z: ATT_KD * (ez * kc + w.tiltCmdRate.z - w.tiltRate.z),
    };
  } else {
    alpha = { x: RATE_K * (cmd.target.x - w.tiltRate.x), z: RATE_K * (cmd.target.z - w.tiltRate.z) };
  }
  const finPart = clampLen2(alpha, finMax);
  const rem = { x: alpha.x - finPart.x, z: alpha.z - finPart.z };
  w.fin = finMax > 1e-9 ? { x: finPart.x / finMax, z: finPart.z / finMax } : { x: 0, z: 0 };
  if (leverGain > 1e-6) {
    // Tail force +x tips the nose toward -x, so gimbal = -alpha / leverGain.
    w.gimbal = clampLen2({ x: -rem.x / leverGain, z: -rem.z / leverGain }, GIMBAL_MAX);
  } else {
    w.gimbal = { x: 0, z: 0 };
  }
  return {
    x: finPart.x - leverGain * w.gimbal.x,
    z: finPart.z - leverGain * w.gimbal.z,
  };
}

function updateTwitch(w: World, rng: Rng, dt: number): void {
  const a = Math.exp(-dt / TWITCH_TAU);
  const b = Math.sqrt(1 - a * a);
  w.finTwitch = { x: a * w.finTwitch.x + b * gauss(rng), z: a * w.finTwitch.z + b * gauss(rng) };
}

/** Advances translation, attitude and propellant by dt. Returns true if a flameout happened. */
export function integrate(w: World, cmd: FlightCommand, dt: number): boolean {
  const m = massOf(w);
  const inertia = inertiaOf(m);
  let thrust = totalThrust(w.engines);
  let flameout = false;

  // Propellant: mdot = F / (Isp g0). Running dry scales the last step's thrust and cuts the engines.
  let mdot = massFlowFor(thrust);
  if (mdot * dt > w.propellant) {
    const frac = mdot > 0 ? w.propellant / (mdot * dt) : 0;
    thrust *= frac;
    mdot *= frac;
    flameout = thrust > 0 || w.propellant <= 0;
  }

  const finMax = w.noAero ? 0 : finAuthority(w);
  const alpha = flightComputer(w, cmd, thrust, inertia, finMax, dt);
  updateTwitch(w, w.rngTwitch, dt);
  const twitchGate = finMax > 0 ? 1 : 0;
  alpha.x += TWITCH_TORQUE * w.finTwitch.x * twitchGate;
  alpha.z += TWITCH_TORQUE * w.finTwitch.z * twitchGate;

  // Forces: thrust along the body axis plus the gimbal side force at the tail, aero, gravity.
  const axis = axisFromTilt(w.tilt);
  aeroNow(w, tmpAero);
  const fx = thrust * (axis.x + w.gimbal.x) + tmpAero.x;
  const fy = thrust * axis.y + tmpAero.y;
  const fz = thrust * (axis.z + w.gimbal.z) + tmpAero.z;
  const ax = fx / m;
  const ay = fy / m - G0;
  const az = fz / m;

  // Velocity Verlet with forces frozen over the step (exact for constant acceleration).
  w.pos.x += w.vel.x * dt + 0.5 * ax * dt * dt;
  w.pos.y += w.vel.y * dt + 0.5 * ay * dt * dt;
  w.pos.z += w.vel.z * dt + 0.5 * az * dt * dt;
  w.vel.x += ax * dt;
  w.vel.y += ay * dt;
  w.vel.z += az * dt;

  // Attitude (semi-implicit Euler), clamped to the model's tilt range.
  w.tiltRate.x += alpha.x * dt;
  w.tiltRate.z += alpha.z * dt;
  let tx = w.tilt.x + w.tiltRate.x * dt;
  let tz = w.tilt.z + w.tiltRate.z * dt;
  const tl = Math.hypot(tx, tz);
  if (tl > MAX_TILT) {
    tx *= MAX_TILT / tl;
    tz *= MAX_TILT / tl;
    w.tiltRate.x *= 0.5;
    w.tiltRate.z *= 0.5;
  }
  w.tilt.x = tx;
  w.tilt.z = tz;

  // Roll: small reaction control with damping (cosmetic; FD can spin it slowly).
  w.rollRate += (0.3 * clamp(cmd.roll, -1, 1) - 1.2 * w.rollRate) * dt;
  w.roll += w.rollRate * dt;

  w.propellant = Math.max(0, w.propellant - mdot * dt);
  if (flameout) shutdownAll(w.engines);
  w.thrust = thrust;
  w.massFlow = mdot;
  w.accel = { x: fx / m, y: fy / m, z: fz / m };
  const g = Math.hypot(w.accel.x, w.accel.y, w.accel.z) / G0;
  if (g > w.peakG) w.peakG = g;
  return flameout;
}
