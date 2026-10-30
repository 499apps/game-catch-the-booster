// Seeded RNG (mulberry32). State is a plain uint32 so the world stays copyable.

export interface Rng {
  s: number;
}

export function hashSeed(seed: number, stream: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function makeRng(seed: number, stream = 0): Rng {
  return { s: hashSeed(seed, stream) };
}

/** Uniform in [0, 1). */
export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(r: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * next(r);
}

export function int(r: Rng, lo: number, hiInclusive: number): number {
  return lo + Math.floor(next(r) * (hiInclusive - lo + 1));
}

/** Standard normal (Box-Muller, one sample per call). */
export function gauss(r: Rng): number {
  const u = Math.max(next(r), 1e-12);
  const v = next(r);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
