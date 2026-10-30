import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DRY_MASS,
  DT,
  ENGINE_THRUST,
  FIN_Q_MIN,
  G0,
  ISP,
  THROTTLE_MAX,
  THROTTLE_MIN,
  aeroForce,
  createWorld,
  density,
  dynamicPressure,
  emptyCommand,
  finGate,
  massFlowFor,
  stepWorld,
  thrustOf,
  type TierId,
  type World,
} from '../../src/sim';
import { flyAutopilot } from './helpers';

const tierArb = fc.constantFrom<TierId>('cadet', 'pilot', 'fd');

describe('atmosphere', () => {
  it('density falls exponentially with an 8.5 km scale height', () => {
    expect(density(0)).toBeCloseTo(1.225, 6);
    expect(density(8500)).toBeCloseTo(1.225 / Math.E, 6);
    expect(density(1000)).toBeLessThan(density(500));
  });
  it('dynamic pressure is half rho v squared', () => {
    expect(dynamicPressure(0, 100)).toBeCloseTo(0.5 * 1.225 * 10000, 6);
  });
});

describe('engines and mass flow', () => {
  it('mass flow = F / (Isp g0), ~705 kg/s per engine at full throttle', () => {
    expect(massFlowFor(ENGINE_THRUST)).toBeCloseTo(ENGINE_THRUST / (ISP * G0), 9);
    expect(massFlowFor(ENGINE_THRUST)).toBeGreaterThan(690);
    expect(massFlowFor(ENGINE_THRUST)).toBeLessThan(720);
  });

  it('invariants hold every step of autopilot flights (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), tierArb, (seed, tier) => {
        flyAutopilot(seed, tier, (before, after) => {
          const mBefore = DRY_MASS + before.propellant;
          const mAfter = DRY_MASS + after.propellant;
          // mass never increases; propellant never negative
          expect(mAfter).toBeLessThanOrEqual(mBefore);
          expect(after.propellant).toBeGreaterThanOrEqual(0);
          // every lit engine makes 40%..100% of 2.26 MN
          for (const e of after.engines) {
            if (e.mode === 'lit') {
              const f = thrustOf(e) / ENGINE_THRUST;
              expect(f).toBeGreaterThanOrEqual(THROTTLE_MIN - 1e-12);
              expect(f).toBeLessThanOrEqual(THROTTLE_MAX + 1e-12);
            }
          }
          // mass flow matches thrust, and propellant drops by mdot * dt
          if (after.phase !== 'settling' && after.phase !== 'caught') {
            expect(after.massFlow).toBeCloseTo(after.thrust / (ISP * G0), 6);
            const used = before.propellant - after.propellant;
            if (after.propellant > 0) expect(used).toBeCloseTo(after.massFlow * DT, 6);
          }
        });
      }),
      { numRuns: 4 },
    );
  });

  it('flameout at zero propellant: engines cut, propellant stays at 0', () => {
    const w = createWorld(7, 'cadet');
    const cmd = emptyCommand();
    cmd.ignite = true;
    cmd.throttle = 1;
    stepWorld(w, cmd);
    w.propellant = 300; // a fraction of one second of burn
    cmd.ignite = false;
    let guard = 0;
    while (!w.done && guard++ < 2000) stepWorld(w, cmd);
    expect(w.outcome?.reason).toBe('flameout');
    expect(w.propellant).toBe(0);
    expect(w.events.some((e) => e.type === 'flameout')).toBe(true);
    expect(w.engines.every((e) => e.mode !== 'lit' && e.mode !== 'spooling')).toBe(true);
  });
});

describe('energy bookkeeping', () => {
  it('with engines off and no drag, kinetic + potential energy is conserved', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const w: World = createWorld(seed, 'fd', { noAero: true });
        const energy = (): number =>
          0.5 * (w.vel.x ** 2 + w.vel.y ** 2 + w.vel.z ** 2) + G0 * w.pos.y;
        const e0 = energy();
        const cmd = emptyCommand();
        for (let i = 0; i < 60; i++) stepWorld(w, cmd);
        expect(w.thrust).toBe(0);
        expect(Math.abs(energy() - e0) / e0).toBeLessThan(1e-9);
      }),
      { numRuns: 20 },
    );
  });
});

describe('aerodynamics', () => {
  const vec = fc.record({
    x: fc.double({ min: -400, max: 400, noNaN: true }),
    y: fc.double({ min: -400, max: 400, noNaN: true }),
    z: fc.double({ min: -400, max: 400, noNaN: true }),
  });
  it('drag always opposes the airspeed (property)', () => {
    fc.assert(
      fc.property(vec, vec, fc.double({ min: 0, max: 3000, noNaN: true }), (va, ax, h) => {
        const l = Math.hypot(ax.x, ax.y, ax.z);
        fc.pre(l > 1e-3 && Math.hypot(va.x, va.y, va.z) > 0.1);
        const axis = { x: ax.x / l, y: ax.y / l, z: ax.z / l };
        const f = aeroForce(h, va, axis, { x: 0, y: 0, z: 0 });
        expect(f.x * va.x + f.y * va.y + f.z * va.z).toBeLessThan(0);
      }),
    );
  });

  it('grid fins only work above ~5 kPa of dynamic pressure', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: FIN_Q_MIN, noNaN: true }), (q) => {
        expect(finGate(q)).toBe(0);
      }),
    );
    fc.assert(
      fc.property(fc.double({ min: FIN_Q_MIN + 1, max: 200_000, noNaN: true }), (q) => {
        expect(finGate(q)).toBeGreaterThan(0);
        expect(finGate(q)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('ballistic coefficient is about 2500 kg/m^2 at ignition mass', () => {
    const w = createWorld(1, 'cadet');
    const m = DRY_MASS + w.propellant;
    expect(m / 128).toBeGreaterThan(2300);
    expect(m / 128).toBeLessThan(2700);
  });
});

describe('thrust-to-weight', () => {
  it('3 engines at minimum throttle on 260 t gives T/W ~1.06 (cannot hover forever)', () => {
    const tw = (3 * THROTTLE_MIN * ENGINE_THRUST) / (260_000 * G0);
    expect(tw).toBeGreaterThan(1.04);
    expect(tw).toBeLessThan(1.08);
  });
  it('13 engines at full throttle on 315 t gives ~9.5 g of thrust', () => {
    const g = (13 * ENGINE_THRUST) / (315_000 * G0);
    expect(g).toBeGreaterThan(9);
    expect(g).toBeLessThan(10);
  });
});
