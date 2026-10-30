// Exponential atmosphere and aerodynamic forces.
import { CDA_AXIAL, CDA_SIDE, CNA_BASE, FIN_Q_FULL, FIN_Q_MIN, RHO0, SCALE_HEIGHT, SOUND_SPEED } from './constants';
import { clamp01, type Vec3 } from './vec';

export function density(h: number): number {
  return RHO0 * Math.exp(-Math.max(h, 0) / SCALE_HEIGHT);
}

export function dynamicPressure(h: number, airspeed: number): number {
  return 0.5 * density(h) * airspeed * airspeed;
}

/** Transonic drag rise: 1 at low Mach, peaks ~1.6 near Mach 1.05. */
export function machDragFactor(mach: number): number {
  const m = Math.abs(mach);
  const bump = Math.exp(-((m - 1.05) * (m - 1.05)) / (2 * 0.12 * 0.12));
  return 1 + 0.6 * bump + (m > 1.05 ? 0.25 * clamp01((m - 1.05) / 0.5) : 0);
}

/**
 * Aerodynamic force on the body from the air-relative velocity `va` (vehicle velocity minus wind).
 * - Axial drag: 1/2 rho V |Va_axial| Cd A along the axis.
 * - Normal force (slender-body + crossflow, Allen-Perkins style):
 *   1/2 rho (CNA_BASE V^2 sin a cos a + CDA_SIDE V^2 sin^2 a), opposite the crossflow.
 *   Small angles of attack give a small, linear side force; broadside wind gives full crossflow drag.
 * Every term opposes `va`, so the force always opposes the airspeed.
 */
export function aeroForce(h: number, va: Vec3, axis: Vec3, out: Vec3): Vec3 {
  const speed = Math.hypot(va.x, va.y, va.z);
  if (speed < 1e-9) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  const half = 0.5 * density(h) * machDragFactor(speed / SOUND_SPEED);
  const along = va.x * axis.x + va.y * axis.y + va.z * axis.z;
  const ax = axis.x * along;
  const ay = axis.y * along;
  const az = axis.z * along;
  const nx = va.x - ax;
  const ny = va.y - ay;
  const nz = va.z - az;
  const vn = Math.hypot(nx, ny, nz); // V sin(a)
  const kAx = half * speed * CDA_AXIAL;
  // normal force / vn: 1/2 rho (CNA |V cos a| + CDA_SIDE V sin a)
  const kN = half * (CNA_BASE * Math.abs(along) + CDA_SIDE * vn);
  out.x = -kAx * ax - kN * nx;
  out.y = -kAx * ay - kN * ny;
  out.z = -kAx * az - kN * nz;
  return out;
}

/** Grid fin effectiveness 0..1: zero below FIN_Q_MIN, full from FIN_Q_FULL. */
export function finGate(q: number): number {
  if (q <= FIN_Q_MIN) return 0;
  return clamp01((q - FIN_Q_MIN) / (FIN_Q_FULL - FIN_Q_MIN));
}
