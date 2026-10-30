// Tolerance tones for the HUD chips and the ring (pure: no DOM, unit-tested).
// A tone appears only when it can mean "act now": nominal flight stays neutral (null).

/** In / near / out of tolerance. Every tone also has its own glyph in the HUD. */
export type Tone = 'ok' | 'warn' | 'bad';

/** m of pin height above the rails: below this is the final approach, where contact limits apply. */
export const FINAL_APPROACH_HEIGHT = 30;
/** deg: the tilt abort (3 engines). During the burn TILT is graded against it, not the contact limit. */
export const TILT_ABORT_DEG = 30;

/** Tone for a value against a limit: ok below half of it, warn below it, bad at or above. */
export function toneFor(value: number, limit: number): Tone {
  const v = Math.abs(value);
  return v < 0.5 * limit ? 'ok' : v < limit ? 'warn' : 'bad';
}

/**
 * TILT tone. Final approach: against the contact limit. Higher up on 3 engines: neutral,
 * unless the lean nears the 30 deg abort (warn from half of it). On 13 engines (no abort; the
 * braking lean reaches ~35 deg by design): neutral. So a nominal flight never shows red.
 */
export function tiltTone(deg: number, pinHeight: number, contactLimitDeg: number, threeEngines = true): Tone | null {
  if (pinHeight <= FINAL_APPROACH_HEIGHT) return toneFor(deg, contactLimitDeg);
  if (!threeEngines) return null;
  const t = toneFor(deg, TILT_ABORT_DEG);
  return t === 'ok' ? null : t;
}

/** PIN tone (Pilot / Flight Director): neutral above the final approach, then the pin window. */
export function pinTone(dist: number, pinHeight: number, window: number): Tone | null {
  return pinHeight <= FINAL_APPROACH_HEIGHT ? toneFor(dist, window) : null;
}

/** Cadet PIN tone (from the aim error): neutral until the booster hovers beside the arms. */
export function cadetPinTone(aimError: number, hover: boolean, window: number): Tone | null {
  return hover ? toneFor(aimError, window) : null;
}
