// Catch envelope classification (design doc section 4).
import { CONTACT_CLEAN, CONTACT_OVERLOAD } from './constants';
import type { TierConfig } from './tiers';

export type CloseCheck = 'ok' | 'early';

/** Checks the pin height above the rails when the arms finish closing. */
export function classifyArmClose(pinHeight: number, cfg: Pick<TierConfig, 'pinHeightAtCloseMax'>): CloseCheck {
  return pinHeight > cfg.pinHeightAtCloseMax ? 'early' : 'ok';
}

export interface ContactSample {
  lateralError: number; // m, pins from the arm centreline
  tiltDeg: number;
  lateralSpeed: number; // m/s
  contactSpeed: number; // m/s, downward
}

export type ContactCheck = 'clean' | 'hard' | 'overload' | 'missLateral' | 'unstable';

export function classifyContactSpeed(speed: number): 'clean' | 'hard' | 'overload' {
  if (speed < CONTACT_CLEAN) return 'clean';
  if (speed <= CONTACT_OVERLOAD) return 'hard';
  return 'overload';
}

/** Order: alignment first (pins must land on the rails), then attitude, then load. */
export function classifyContact(
  s: ContactSample,
  cfg: Pick<TierConfig, 'pinWindow' | 'tiltLimitDeg' | 'lateralSpeedLimit'>,
): ContactCheck {
  if (s.lateralError > cfg.pinWindow) return 'missLateral';
  if (s.tiltDeg >= cfg.tiltLimitDeg || s.lateralSpeed >= cfg.lateralSpeedLimit) return 'unstable';
  return classifyContactSpeed(s.contactSpeed);
}
