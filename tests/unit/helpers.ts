import { autopilotCommand, createWorld, scoreWorld, stepWorld, type TierId, type World } from '../../src/sim';

export interface Timeline {
  ignition: number | null;
  stepDown: number | null;
  divertStart: number | null;
  hover: number | null;
  catchPrompt: number | null;
  armsCloseStart: number | null;
  armsClosed: number | null;
  contact: number | null;
  cutoff: number | null;
}

/** Event times relative to ignition (s). */
export function timeline(w: World): Timeline {
  const at = (type: string): number | null => w.events.find((e) => e.type === type)?.t ?? null;
  const ign = at('ignition');
  const rel = (type: string): number | null => {
    const t = at(type);
    return t === null || ign === null ? null : t - ign;
  };
  return {
    ignition: ign,
    stepDown: rel('stepDown'),
    divertStart: rel('divertStart'),
    hover: rel('hover'),
    catchPrompt: rel('catchPrompt'),
    armsCloseStart: rel('armsCloseStart'),
    armsClosed: rel('armsClosed'),
    contact: rel('contact'),
    cutoff: rel('cutoff'),
  };
}

/** Runs the autopilot to the end, calling `check` before and after every step. */
export function flyAutopilot(
  seed: number,
  tier: TierId,
  check?: (before: World, after: World) => void,
): { world: World; score: ReturnType<typeof scoreWorld> } {
  const w = createWorld(seed, tier);
  let guard = 0;
  while (!w.done && guard++ < 120 * 90) {
    const before = check ? structuredClone(w) : w;
    stepWorld(w, autopilotCommand(w));
    if (check) check(before, w);
  }
  return { world: w, score: scoreWorld(w) };
}
