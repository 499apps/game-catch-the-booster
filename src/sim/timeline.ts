// Replay timeline: re-flies a run from seed + tier + input log (deterministic) and keeps
// a frame every few steps. The replay player scrubs it, the debrief draws its graphs.
import { COM_ABOVE_BASE, DT } from './constants';
import { countLit } from './engines';
import { runSim, type RunOptions } from './replay';
import type { ScoreBreakdown } from './scoring';
import type { EngineState, Phase, SimEvent, World } from './types';
import type { Vec2, Vec3 } from './vec';
import { tauOf } from './world';

export interface TimelineFrame {
  t: number;
  tau: number | null;
  phase: Phase;
  pos: Vec3;
  vel: Vec3;
  tilt: Vec2;
  roll: number;
  engines: EngineState[];
  thrust: number;
  propellant: number;
  armProgress: number;
  armsClosing: boolean;
  armsClosed: boolean;
  rail: number;
  lit: number;
}

export interface Timeline {
  frames: TimelineFrame[];
  /** Sim seconds between frames. */
  frameDt: number;
  duration: number;
  ignitionT: number | null;
  contactT: number | null;
  events: SimEvent[];
  world: World;
  score: ScoreBreakdown;
}

/** Steps between frames: 4 steps at 120 Hz = 30 frames per sim second. */
export const TIMELINE_STRIDE = 4;

function snapshot(w: World): TimelineFrame {
  return {
    t: w.t,
    tau: tauOf(w),
    phase: w.phase,
    pos: { ...w.pos },
    vel: { ...w.vel },
    tilt: { ...w.tilt },
    roll: w.roll,
    engines: w.engines.map((e) => ({ ...e })),
    thrust: w.thrust,
    propellant: w.propellant,
    armProgress: w.arms.progress,
    armsClosing: w.arms.closing,
    armsClosed: w.arms.closed,
    rail: w.rails.compression,
    lit: countLit(w.engines),
  };
}

export function buildTimeline(o: RunOptions, stride = TIMELINE_STRIDE): Timeline {
  const frames: TimelineFrame[] = [];
  const res = runSim({
    ...o,
    onStep: (w) => {
      if (frames.length === 0) frames.push({ ...snapshot(w), t: 0 });
      if (w.step % stride === 0 || w.done) frames.push(snapshot(w));
      o.onStep?.(w);
    },
  });
  const w = res.world;
  if (frames.length === 0) frames.push(snapshot(w));
  return {
    frames,
    frameDt: stride * DT,
    duration: w.t,
    ignitionT: w.ignition ? w.ignition.t : null,
    contactT: w.contact ? w.contact.t : null,
    events: w.events,
    world: w,
    score: res.score,
  };
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });

/** Index of the last frame at or before sim time t (binary search). */
export function frameIndexAt(tl: Timeline, t: number): number {
  const f = tl.frames;
  if (f.length === 0 || t <= (f[0]?.t ?? 0)) return 0;
  let lo = 0;
  let hi = f.length - 1;
  if (t >= (f[hi]?.t ?? 0)) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((f[mid]?.t ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The frame at sim time t: positions, attitude, rails and arms interpolated, the rest held. */
export function frameAt(tl: Timeline, tIn: number): TimelineFrame {
  const first = tl.frames[0];
  const last = tl.frames[tl.frames.length - 1];
  if (!first || !last) throw new Error('empty timeline');
  const t = Math.min(Math.max(tIn, first.t), last.t);
  const i = frameIndexAt(tl, t);
  const a = tl.frames[i];
  if (!a) throw new Error('empty timeline');
  const b = tl.frames[i + 1];
  if (!b || b.t <= a.t) return a;
  const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  return {
    ...a,
    t,
    tau: a.tau === null ? null : a.tau + (t - a.t),
    pos: lerp3(a.pos, b.pos, k),
    vel: lerp3(a.vel, b.vel, k),
    tilt: { x: lerp(a.tilt.x, b.tilt.x, k), z: lerp(a.tilt.z, b.tilt.z, k) },
    roll: lerp(a.roll, b.roll, k),
    thrust: lerp(a.thrust, b.thrust, k),
    armProgress: lerp(a.armProgress, b.armProgress, k),
    rail: lerp(a.rail, b.rail, k),
  };
}

export interface FlightSeries {
  t: number[];
  /** Engine plane above the sea (m). */
  altitude: number[];
  /** m/s. */
  speed: number[];
  /** Engines lit. */
  lit: number[];
}

/** Post-flight graph data, decimated to at most `maxPoints` samples. */
export function flightSeries(tl: Timeline, maxPoints = 240): FlightSeries {
  const out: FlightSeries = { t: [], altitude: [], speed: [], lit: [] };
  const push = (f: TimelineFrame | undefined): void => {
    if (!f) return;
    out.t.push(f.t);
    out.altitude.push(Math.max(0, f.pos.y - COM_ABOVE_BASE));
    out.speed.push(Math.hypot(f.vel.x, f.vel.y, f.vel.z));
    out.lit.push(f.lit);
  };
  const n = tl.frames.length;
  const step = Math.max(1, Math.ceil(n / maxPoints));
  for (let i = 0; i < n; i += step) push(tl.frames[i]);
  const last = tl.frames[n - 1];
  if (last && out.t[out.t.length - 1] !== last.t) push(last);
  return out;
}
