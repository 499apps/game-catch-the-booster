// Tiny vector helpers on plain objects (copyable, deterministic).
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Vec2 {
  x: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const v2 = (x = 0, z = 0): Vec2 => ({ x, z });
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const len2 = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => {
  const s = clamp01(t);
  return s * s * (3 - 2 * s);
};

/** Clamps the length of a 2D vector, returns a new vector. */
export function clampLen2(a: Vec2, max: number): Vec2 {
  const l = len2(a);
  if (l <= max || l === 0) return { x: a.x, z: a.z };
  return { x: (a.x * max) / l, z: (a.z * max) / l };
}

/** Body axis (engines -> nose) from the tilt vector (horizontal components of the axis). */
export function axisFromTilt(t: Vec2): Vec3 {
  const h2 = t.x * t.x + t.z * t.z;
  return { x: t.x, y: Math.sqrt(Math.max(0, 1 - h2)), z: t.z };
}

/** Tilt angle from vertical (rad). */
export function tiltAngle(t: Vec2): number {
  return Math.asin(Math.min(1, len2(t)));
}
