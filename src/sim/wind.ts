// Wind: mean + filtered gusts (Dryden-lite: first-order Gauss-Markov) + shear above 100 m.
import { gauss, range, type Rng } from './rng';
import type { TierConfig } from './tiers';
import type { WindState } from './types';
import { clamp01, type Vec3 } from './vec';

export const GUST_TAU = 2.0; // s, gust correlation time

export function makeWind(cfg: TierConfig, rng: Rng): WindState {
  const speed = range(rng, cfg.windMean[0], cfg.windMean[1]);
  const dir = range(rng, 0, Math.PI * 2);
  return {
    meanX: speed * Math.cos(dir),
    meanZ: speed * Math.sin(dir),
    shear: cfg.shear,
    gustSigma: cfg.gustSigma,
    gustX: 0,
    gustZ: 0,
  };
}

/** Advances the gust process by dt (exact discretisation of the OU process). */
export function updateWind(w: WindState, rng: Rng, dt: number): void {
  if (w.gustSigma <= 0) {
    w.gustX = 0;
    w.gustZ = 0;
    return;
  }
  const a = Math.exp(-dt / GUST_TAU);
  const b = w.gustSigma * Math.sqrt(1 - a * a);
  w.gustX = a * w.gustX + b * gauss(rng);
  w.gustZ = a * w.gustZ + b * gauss(rng);
}

/** Shear multiplier on the mean wind: 1 below 100 m, up to 1 + shear at 400 m and above. */
export function shearFactor(w: WindState, h: number): number {
  return 1 + w.shear * clamp01((h - 100) / 300);
}

export function windAt(w: WindState, h: number, out: Vec3): Vec3 {
  const s = shearFactor(w, h);
  out.x = w.meanX * s + w.gustX;
  out.y = 0;
  out.z = w.meanZ * s + w.gustZ;
  return out;
}

export function meanWindSpeed(w: WindState): number {
  return Math.hypot(w.meanX, w.meanZ);
}
