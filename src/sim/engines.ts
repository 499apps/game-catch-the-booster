// HE-2 engine bank: 13 inner engines, relight spool, failures, throttle rate limit, step-down.
import {
  CENTER_ENGINES,
  ENGINE_COUNT,
  ENGINE_THRUST,
  G0,
  ISP,
  SPOOL_MAX,
  SPOOL_MIN,
  STEP_DOWN_KEEP,
  THROTTLE_MAX,
  THROTTLE_MIN,
  THROTTLE_RATE,
} from './constants';
import { next, range, type Rng } from './rng';
import type { EngineState } from './types';
import { clamp } from './vec';

export function makeEngines(): EngineState[] {
  const out: EngineState[] = [];
  for (let i = 0; i < ENGINE_COUNT; i++) {
    out.push({ mode: 'off', spoolTime: 1, spool: 0, willFail: false, throttle: THROTTLE_MIN });
  }
  return out;
}

export const clampThrottle = (t: number): number => clamp(t, THROTTLE_MIN, THROTTLE_MAX);

/** Mass flow for a thrust (kg/s): mdot = F / (Isp g0). */
export const massFlowFor = (thrustN: number): number => thrustN / (ISP * G0);

/** Picks which engines fail to relight, from the tier's failure distribution. */
export function pickFailures(rng: Rng, probs: readonly [number, number, number]): number[] {
  const u = next(rng);
  const n = u < probs[0] ? 0 : u < probs[0] + probs[1] ? 1 : 2;
  const failed: number[] = [];
  while (failed.length < n) {
    const i = Math.floor(next(rng) * ENGINE_COUNT);
    if (!failed.includes(i)) failed.push(i);
  }
  return failed;
}

/** Starts the relight of all 13 engines. */
export function ignite(engines: EngineState[], rng: Rng, failed: readonly number[], throttle: number): void {
  for (let i = 0; i < engines.length; i++) {
    const e = engines[i];
    if (!e) continue;
    e.mode = 'spooling';
    e.spool = 0;
    e.spoolTime = range(rng, SPOOL_MIN, SPOOL_MAX);
    e.willFail = failed.includes(i);
    e.throttle = clampThrottle(throttle);
  }
}

/** Fraction of full thrust an engine is producing per unit throttle (0..1). */
export function spoolFraction(e: EngineState): number {
  if (e.mode === 'lit') return 1;
  if (e.mode === 'spooling' && !e.willFail) return Math.min(1, e.spool / e.spoolTime);
  return 0;
}

export function thrustOf(e: EngineState): number {
  return spoolFraction(e) * e.throttle * ENGINE_THRUST;
}

export function totalThrust(engines: readonly EngineState[]): number {
  let t = 0;
  for (const e of engines) t += thrustOf(e);
  return t;
}

/** Sum of available spool fractions (engine-equivalents able to make thrust now). */
export function availableEngines(engines: readonly EngineState[]): number {
  let n = 0;
  for (const e of engines) n += spoolFraction(e);
  return n;
}

export function countLit(engines: readonly EngineState[]): number {
  let n = 0;
  for (const e of engines) if (e.mode === 'lit') n++;
  return n;
}

/** Engines lit or still spooling healthily. */
export function countRunning(engines: readonly EngineState[]): number {
  let n = 0;
  for (const e of engines) if (e.mode === 'lit' || (e.mode === 'spooling' && !e.willFail)) n++;
  return n;
}

export type EngineChange = { index: number; mode: 'lit' | 'failed' };

/** Advances spool and throttle. Returns engines that changed state this step. */
export function updateEngines(engines: EngineState[], throttleCmd: number, dt: number): EngineChange[] {
  const changes: EngineChange[] = [];
  const target = clampThrottle(throttleCmd);
  for (let i = 0; i < engines.length; i++) {
    const e = engines[i];
    if (!e) continue;
    if (e.mode === 'spooling') {
      e.spool += dt;
      if (e.spool >= e.spoolTime) {
        e.mode = e.willFail ? 'failed' : 'lit';
        changes.push({ index: i, mode: e.mode });
      }
    }
    if (e.mode === 'lit' || e.mode === 'spooling') {
      const d = clamp(target - e.throttle, -THROTTLE_RATE * dt, THROTTLE_RATE * dt);
      e.throttle = clampThrottle(e.throttle + d);
    }
  }
  return changes;
}

/**
 * Steps down to 3 engines: keeps the centre engines that run, substituting
 * ring engines for any centre engine that failed. Returns the kept indices.
 */
export function stepDown(engines: EngineState[]): number[] {
  const running = (i: number): boolean => {
    const e = engines[i];
    return !!e && (e.mode === 'lit' || (e.mode === 'spooling' && !e.willFail));
  };
  const keep: number[] = CENTER_ENGINES.filter(running);
  for (let i = 0; i < engines.length && keep.length < STEP_DOWN_KEEP; i++) {
    if (!keep.includes(i) && running(i)) keep.push(i);
  }
  for (let i = 0; i < engines.length; i++) {
    const e = engines[i];
    if (!e) continue;
    if (!keep.includes(i) && (e.mode === 'lit' || e.mode === 'spooling')) e.mode = 'off';
  }
  return keep;
}

export function shutdownAll(engines: EngineState[]): void {
  for (const e of engines) if (e.mode === 'lit' || e.mode === 'spooling') e.mode = 'off';
}
