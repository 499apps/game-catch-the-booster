// localStorage only, every key prefixed `g499:catch:`. All access is guarded:
// private modes and embedded webviews can throw on storage access.
import type { TierId } from '../sim/tiers';

export const PREFIX = 'g499:catch:';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';

export interface Settings {
  quality: QualitySetting;
  muted: boolean;
  reducedMotion: boolean;
  tier: TierId;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultSettings(): Settings {
  return { quality: 'auto', muted: false, reducedMotion: prefersReducedMotion(), tier: 'cadet' };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage full or blocked: settings simply do not persist.
  }
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  const raw = read('settings');
  if (!raw) return d;
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : 'auto',
      muted: typeof s.muted === 'boolean' ? s.muted : d.muted,
      reducedMotion: typeof s.reducedMotion === 'boolean' ? s.reducedMotion : d.reducedMotion,
      tier: s.tier === 'pilot' || s.tier === 'fd' ? s.tier : 'cadet',
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  write('settings', JSON.stringify(s));
}

export function loadBest(tier: TierId): number {
  const n = Number(read(`best:${tier}`));
  return Number.isFinite(n) ? n : 0;
}

/** Stores the score if it beats the best. Returns true on a new best. */
export function saveBest(tier: TierId, score: number): boolean {
  if (score <= loadBest(tier)) return false;
  write(`best:${tier}`, String(Math.round(score)));
  return true;
}
