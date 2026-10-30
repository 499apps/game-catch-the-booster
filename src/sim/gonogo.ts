// Go/No-Go: automated vehicle + tower health checks, then a decision (auto or Flight Director).
import { DRY_MASS, G0, ISP, PIN_ABOVE_COM, STEP_DOWN_KEEP } from './constants';
import { countRunning } from './engines';
import { T_CONTACT, X_HOLD } from './reference';
import type { GoNoGoState, HealthBoard, World } from './types';

export function makeGoNoGo(): GoNoGoState {
  return { polled: false, board: null, decision: 'pending', decidedBy: null, tDecision: null };
}

export function boardHealthy(b: HealthBoard): boolean {
  return b.engines && b.propellant && b.track && b.towerSensors && b.arms && b.comms;
}

/** Propellant needed to fly from now to contact on 3 engines, plus a 10% reserve. */
export function propellantNeeded(world: World, tau: number): number {
  const m = DRY_MASS + world.propellant;
  const remaining = Math.max(T_CONTACT - tau, 0);
  return (1.1 * remaining * m * G0) / (ISP * G0);
}

export function healthChecks(world: World, tau: number): HealthBoard {
  const pinX = world.pos.x + PIN_ABOVE_COM * world.tilt.x;
  const pinZ = world.pos.z + PIN_ABOVE_COM * world.tilt.z;
  const offTrack = Math.hypot(pinX - X_HOLD, pinZ);
  return {
    engines: countRunning(world.engines) >= STEP_DOWN_KEEP,
    propellant: world.propellant >= propellantNeeded(world, tau),
    // Within reach of the divert: the 10 s pendulum can absorb ~50 m of extra offset.
    track: offTrack < 50 && -world.vel.y < 60 && world.pos.y > 150,
    towerSensors: !world.faults.towerSensor,
    arms: true,
    comms: true,
  };
}

/** True when a No-Go was the right call (something on the board was red). */
export function noGoWasCorrect(g: GoNoGoState): boolean {
  return g.board !== null && !boardHealthy(g.board);
}
