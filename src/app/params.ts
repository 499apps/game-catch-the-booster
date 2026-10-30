// URL test hooks. All are harmless in production: they only change pacing, seeding
// and what is drawn. `window.__catch` is exposed only when one of them is present.
import type { TierId } from '../sim/tiers';
import type { QualitySetting } from './storage';

export interface Hooks {
  /** Any hook present: expose window.__catch. */
  active: boolean;
  autopilot: boolean;
  timescale: number;
  still: boolean;
  seed: number | null;
  tier: TierId | null;
  /** Still mode: freeze an in-flight frame this many seconds after ignition. */
  at: number | null;
  /** Still mode: show the debrief of a finished autopilot run. */
  debrief: boolean;
  /** Show the fps counter (`fps=1` only; the test state still reports the fps). */
  fps: boolean;
  /** Force a quality setting (tests use Low on software-rendered browsers). */
  quality: QualitySetting | null;
  /** Test-only render scale (0.25 to 1) on top of the quality pixel ratio; keeps software-GL e2e responsive. */
  scale: number;
  /** Force the Cadet first-run tutorial (other hooks skip it so tests start at once). */
  tutorial: boolean;
  /**
   * Still mode: fly the frame by hand instead of the autopilot (the player's HUD: the 3-2-1
   * cue, the steer arrow). A negative `at` freezes that many seconds BEFORE the ideal ignition.
   */
  manual: boolean;
  /** Still mode with `manual`: the stick (world x, -1..1) held from the divert start. */
  stick: number;
  /** Still mode with `manual`: `stick=arrow` holds full stick along the HUD steer arrow. */
  stickArrow: boolean;
  /** Still mode with `manual`: `stick=away` holds full stick against the arrow ("Away from the ring"). */
  stickAway: boolean;
}

const QUALITY_IDS: readonly string[] = ['auto', 'low', 'medium', 'high'];

const TIER_IDS: readonly string[] = ['cadet', 'pilot', 'fd'];

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseHooks(search: string): Hooks {
  const p = new URLSearchParams(search);
  const keys = ['autopilot', 'timescale', 'still', 'seed', 'tier', 'at', 'debrief', 'fps', 'test', 'quality', 'scale', 'tutorial', 'manual', 'stick'];
  const q = p.get('quality');
  const active = keys.some((k) => p.has(k));
  const tierRaw = p.get('tier');
  const ts = num(p.get('timescale'));
  return {
    active,
    autopilot: p.get('autopilot') === '1',
    timescale: ts !== null ? Math.min(Math.max(ts, 0.1), 16) : 1,
    still: p.get('still') === '1',
    seed: num(p.get('seed')),
    tier: tierRaw && TIER_IDS.includes(tierRaw) ? (tierRaw as TierId) : null,
    at: num(p.get('at')),
    debrief: p.get('debrief') === '1',
    // Only on request: test runs and captures must look like what a player sees.
    fps: p.get('fps') === '1',
    quality: q && QUALITY_IDS.includes(q) ? (q as QualitySetting) : null,
    scale: Math.min(Math.max(num(p.get('scale')) ?? 1, 0.25), 1),
    tutorial: p.get('tutorial') === '1',
    manual: p.get('manual') === '1',
    stick: Math.min(Math.max(num(p.get('stick')) ?? 0, -1), 1),
    stickArrow: p.get('stick') === 'arrow',
    stickAway: p.get('stick') === 'away',
  };
}
