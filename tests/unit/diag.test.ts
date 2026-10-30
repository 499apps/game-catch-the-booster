// TEMPORARY diagnostics for the tuning pass (no assertions beyond "it ran").
// Prints a 1 Hz trace of autopilot flights so the operator report carries real numbers.
// Delete this file once the golden tests are green.
import { describe, expect, it } from 'vitest';
import {
  COP_ABOVE_COM,
  countLit,
  pinHeightAboveRails,
  pinPosition,
  referenceAt,
  type TierId,
  type World,
} from '../../src/sim';
import { flyAutopilot } from './helpers';

const f = (v: number, d = 1): string => v.toFixed(d);
const deg = (v: number): number => (v * 180) / Math.PI;

function row(w: World): string {
  const pin = pinPosition(w.pos, w.tilt);
  const lit = w.engines.filter((e) => e.mode === 'lit' || e.mode === 'spooling');
  const thr = lit.length ? lit.reduce((a, e) => a + e.throttle, 0) / lit.length : 0;
  const tiltX = (Math.asin(Math.max(-1, Math.min(1, w.tilt.x))) * 180) / Math.PI;
  const tiltZ = (Math.asin(Math.max(-1, Math.min(1, w.tilt.z))) * 180) / Math.PI;
  const tau = w.ignition ? w.t - w.ignition.t : NaN;
  const ref = w.ignition ? referenceAt(w.ignition, tau, w.gonogo.decision === 'go') : null;
  const arm = w.arms.closed ? 'closed' : w.arms.closing ? `cl${f(w.arms.progress, 2)}` : 'open';
  return [
    `t=${f(w.t, 2)}`,
    `tau=${f(tau, 2)}`,
    w.phase,
    `y=${f(w.pos.y)}`,
    ref ? `yRef=${f(ref.pos.y)}` : '',
    `vy=${f(w.vel.y)}`,
    ref ? `vyRef=${f(ref.vel.y)}` : '',
    `x=${f(w.pos.x)}`,
    ref ? `xRef=${f(ref.pos.x)}` : '',
    `vx=${f(w.vel.x, 2)}`,
    `pinX=${f(pin.x, 2)}`,
    `pinZ=${f(pin.z, 2)}`,
    `vz=${f(w.vel.z, 2)}`,
    `tilt=(${f(tiltX, 2)},${f(tiltZ, 2)})deg`,
    `cmd=(${f(deg(w.tiltCmd.x), 1)},${f(deg(w.tiltCmd.z), 1)})`,
    `rate=(${f(deg(w.tiltRate.x), 1)},${f(deg(w.tiltRate.z), 1)})d/s`,
    `gimb=(${f((w.gimbal.x * 180) / Math.PI, 1)},${f((w.gimbal.z * 180) / Math.PI, 1)})`,
    `lit=${countLit(w.engines)}/${lit.length}`,
    `thr=${f(thr, 2)}`,
    `T=${f(w.thrust / 1e6, 2)}MN`,
    `prop=${f(w.propellant / 1000)}t`,
    `pinH=${f(pinHeightAboveRails(w.pos, w.tilt))}`,
    `arm=${arm}`,
    `go=${w.gonogo.decision}`,
  ]
    .filter(Boolean)
    .join(' ');
}

function trace(seed: number, tier: TierId): void {
  const lines: string[] = [`=== DIAG ${tier} seed ${seed} (COP ${f(COP_ABOVE_COM, 2)} m) ===`];
  let nextT = 0;
  const { world, score } = flyAutopilot(seed, tier, (_b, w) => {
    const tau = w.ignition ? w.t - w.ignition.t : -1;
    // 1 Hz, plus 4 Hz around step-down and the last 8 s
    const fine = (tau > 3 && tau < 7) || tau > 25;
    if (w.t >= nextT || w.done) {
      lines.push(row(w));
      nextT = w.t + (fine ? 0.25 : 1);
    }
  });
  lines.push(`outcome=${JSON.stringify(world.outcome)} contact=${JSON.stringify(world.contact)}`);
  lines.push(`score base=${score.base} total=${score.total} medal=${score.medal}`);
  lines.push(
    'events: ' +
      world.events
        .filter((e) => e.type !== 'engineLit')
        .map((e) => `${e.type}@${f(e.t, 2)}${e.data ? JSON.stringify(e.data) : ''}`)
        .join(' | '),
  );
  console.log(lines.join('\n'));
  expect(world.done).toBe(true);
}

describe('DIAG (temporary)', () => {
  it('trace Cadet seed 1', () => trace(1, 'cadet'));
  it('trace Pilot seed 5', () => trace(5, 'pilot'));
  it('trace FD seed 101', () => trace(101, 'fd'));
});
