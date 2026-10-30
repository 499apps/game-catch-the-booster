// Coast height field: a gentle beach, low dunes inland and a flat launch site.
// Shared by the ground mesh, the crowd placement and the camera rigs.
import { SHORELINE_X, TOWER_X } from '../sim/constants';

/** Visual waterline (x where the beach meets the sea surface). */
export const WATERLINE_X = SHORELINE_X - 8;

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm2(x: number, z: number): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    s += a * noise2(x * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Ground height (m) at (x, z). Below 0 is under the sea surface. */
export function terrainHeight(x: number, z: number): number {
  const d = WATERLINE_X - x; // metres inland of the waterline
  if (d < 0) return Math.max(-3, d * 0.06);
  const beach = d * 0.045;
  const duneAmt = smooth(55, 150, d) * (1 - 0.6 * smooth(900, 1800, d));
  const dunes = (fbm2(x / 70, z / 110) - 0.35) * 9 * duneAmt;
  let h = Math.min(beach, 3.2) + Math.max(dunes, -1.5);
  // Flat, graded launch site around the tower and the tank farm.
  const site = smooth(260, 180, Math.abs(z)) * smooth(-620, -540, x) * smooth(40, -20, x - TOWER_X - 30);
  h = h + (0.35 - h) * site;
  return h;
}

/** 0 = wet sand .. 1 = grass, used for ground colours. */
export function grassAmount(x: number, z: number): number {
  const d = WATERLINE_X - x;
  return smooth(70, 140, d) * smooth(0.35, 0.6, fbm2(x / 45 + 7, z / 60));
}
