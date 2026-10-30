// Input log + deterministic replay: replay = seed + tier + input log (+ autopilot flag).
import { commandFor } from './control';
import { DT } from './constants';
import type { TierId } from './tiers';
import { NEUTRAL_INPUT, type PilotInput, type World } from './types';
import { createWorld, scoreWorld, stepWorld, type WorldOptions } from './world';
import type { ScoreBreakdown } from './scoring';

/** Sparse log: an entry is written only on steps where the input changed. */
export interface InputLog {
  version: 1;
  entries: { step: number; input: PilotInput }[];
}

export const emptyLog = (): InputLog => ({ version: 1, entries: [] });

function sameInput(a: PilotInput, b: PilotInput): boolean {
  return (
    a.stickX === b.stickX &&
    a.stickZ === b.stickZ &&
    a.throttle === b.throttle &&
    a.yaw === b.yaw &&
    a.ignite === b.ignite &&
    a.stepDown === b.stepDown &&
    a.closeArms === b.closeArms &&
    a.go === b.go &&
    a.noGo === b.noGo
  );
}

export class InputRecorder {
  readonly log: InputLog = emptyLog();
  private last: PilotInput = NEUTRAL_INPUT;
  record(step: number, input: PilotInput): void {
    if (sameInput(input, this.last)) return;
    this.last = { ...input };
    this.log.entries.push({ step, input: { ...input } });
  }
}

/** Reads a log in step order. */
export class InputPlayer {
  private i = 0;
  private current: PilotInput = NEUTRAL_INPUT;
  constructor(private readonly log: InputLog) {}
  at(step: number): PilotInput {
    const e = this.log.entries;
    while (this.i < e.length && (e[this.i]?.step ?? Infinity) <= step) {
      this.current = e[this.i]?.input ?? this.current;
      this.i++;
    }
    return this.current;
  }
}

export interface RunOptions extends WorldOptions {
  seed: number;
  tier: TierId;
  log?: InputLog;
  autopilot?: boolean;
  maxTime?: number;
  /** Optional per-step hook (tests, ghost recording). */
  onStep?: (w: World) => void;
}

export interface RunResult {
  world: World;
  score: ScoreBreakdown;
}

/** Runs a whole flight headless and deterministically. */
export function runSim(o: RunOptions): RunResult {
  const w = createWorld(o.seed, o.tier, o);
  const player = new InputPlayer(o.log ?? emptyLog());
  const maxSteps = Math.ceil((o.maxTime ?? 90) / DT);
  while (!w.done && w.step < maxSteps) {
    const input = player.at(w.step);
    stepWorld(w, commandFor(w, input, !!o.autopilot));
    o.onStep?.(w);
  }
  return { world: w, score: scoreWorld(w) };
}

/** Stable fingerprint of the full world state (bit-exact numbers via their string form). */
export function worldFingerprint(w: World): string {
  return JSON.stringify(w, (_k, v: unknown) => (typeof v === 'number' ? Object.is(v, -0) ? '-0' : v.toString() : v));
}
