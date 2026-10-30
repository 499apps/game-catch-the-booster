import { describe, expect, it } from 'vitest';
import {
  B_END,
  CONTACT_COM_Y,
  DRY_MASS,
  ENGINE_THRUST,
  G0,
  T_CONTACT,
  T_DIVERT,
  T_DIVERT_END,
  T_STEPDOWN,
  THROTTLE_MIN,
  V_CONTACT,
  V_STEPDOWN,
  X_HOLD,
  idealIgnitionHeight,
  ignitionError,
  impactPoint,
  predictedPinPath,
  referenceAt,
  stopHeight,
  timeToContact,
} from '../../src/sim';

const ign = (vDown = 292, h?: number) => ({
  pos: { x: 360, y: h ?? idealIgnitionHeight(vDown), z: 5 },
  vel: { x: -148, y: -vDown, z: 1 },
});

describe('reference trajectory', () => {
  it('ideal ignition is 1.2-1.6 km up for 280-310 m/s', () => {
    for (const v of [280, 292, 300, 310]) {
      expect(idealIgnitionHeight(v)).toBeGreaterThan(1200);
      expect(idealIgnitionHeight(v)).toBeLessThan(1600);
    }
  });

  it('is continuous across the segment joins', () => {
    const i = ign();
    for (const t of [T_STEPDOWN, T_DIVERT, T_DIVERT_END]) {
      const a = referenceAt(i, t - 1e-6, true);
      const b = referenceAt(i, t + 1e-6, true);
      expect(Math.abs(a.pos.x - b.pos.x)).toBeLessThan(1e-3);
      expect(Math.abs(a.pos.y - b.pos.y)).toBeLessThan(1e-3);
      expect(Math.abs(a.vel.x - b.vel.x)).toBeLessThan(1e-3);
      expect(Math.abs(a.vel.y - b.vel.y)).toBeLessThan(1e-3);
    }
  });

  it('hits the waypoints: -45 m/s at step-down, hold point, catch point, contact', () => {
    const i = ign();
    expect(referenceAt(i, T_STEPDOWN, true).vel.y).toBeCloseTo(-V_STEPDOWN, 6);
    expect(referenceAt(i, T_DIVERT, true).pos.x).toBeCloseTo(X_HOLD, 6);
    expect(referenceAt(i, T_DIVERT_END, true).pos.x).toBeCloseTo(0, 6);
    expect(referenceAt(i, T_DIVERT_END, false).pos.x).toBeCloseTo(X_HOLD, 6);
    const c = referenceAt(i, T_CONTACT, true);
    expect(c.pos.y).toBeCloseTo(CONTACT_COM_Y, 6);
    expect(c.vel.y).toBeCloseTo(-V_CONTACT, 6);
  });

  it('blends out an off-ideal ignition height by step-down', () => {
    const i = ign(292, idealIgnitionHeight(292) + 30);
    const r = referenceAt(i, T_STEPDOWN, true);
    expect(r.pos.y).toBeCloseTo(referenceAt(ign(), T_STEPDOWN, true).pos.y, 6);
  });

  it('3-engine segment always needs more than minimum thrust (no forced climb)', () => {
    const i = ign();
    for (let t = T_STEPDOWN; t <= T_CONTACT; t += 0.25) {
      const r = referenceAt(i, t, true);
      expect(r.acc.y).toBeGreaterThanOrEqual(B_END - 1e-9);
      // at 265 t (light end of a good run) minimum thrust still fits under the required force
      const m = DRY_MASS + 15_000;
      const lateral = Math.hypot(r.acc.x, r.acc.z);
      const need = m * Math.hypot(lateral, r.acc.y + G0);
      expect(need).toBeGreaterThan(3 * THROTTLE_MIN * ENGINE_THRUST);
      expect(need).toBeLessThan(3 * ENGINE_THRUST * 0.8);
    }
  });

  it('divert lean stays under ~15 deg', () => {
    const i = ign();
    for (let t = T_DIVERT; t <= T_DIVERT_END; t += 0.1) {
      const r = referenceAt(i, t, true);
      const lean = Math.atan2(Math.abs(r.acc.x), r.acc.y + G0);
      expect(lean).toBeLessThan((15 * Math.PI) / 180);
    }
  });
});

describe('predictor', () => {
  it('time to contact follows the linear-deceleration model', () => {
    expect(timeToContact(10, -4)).toBeCloseTo(4, 9);
    expect(timeToContact(0, -1)).toBe(0);
    expect(timeToContact(10, 1)).toBe(Infinity);
  });
  it('stop height drops as descent speed rises, and with fewer engines', () => {
    expect(stopHeight(1300, -250, 68_000)).toBeGreaterThan(stopHeight(1300, -300, 68_000));
    expect(stopHeight(1300, -300, 68_000, 13)).toBeGreaterThan(stopHeight(1300, -300, 68_000, 11));
  });
  it('ignition error is zero at the ideal height', () => {
    expect(ignitionError(idealIgnitionHeight(295), -295)).toBeCloseTo(0, 9);
    expect(ignitionError(idealIgnitionHeight(295) + 40, -295)).toBeCloseTo(40, 9);
  });
  it('impact point of a simple ballistic arc', () => {
    const p = impactPoint({ x: 0, y: 4.903325, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.y).toBe(0);
  });
  it('predicted pin path starts at the pins and follows the velocity', () => {
    const path = predictedPinPath({ x: 0, y: 100, z: 0 }, { x: 1, y: -2, z: 0 }, { x: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 2, 4);
    expect(path).toHaveLength(5);
    expect(path[0]?.y).toBeCloseTo(139, 9);
    expect(path[4]?.y).toBeCloseTo(135, 9);
    expect(path[4]?.x).toBeCloseTo(2, 9);
  });
});
