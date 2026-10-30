// localStorage only, every key prefixed `g499:catch:`. All access is guarded:
// private modes and embedded webviews can throw on storage access. Tests swap the
// backend for an in-memory one with setStorageBackend().
import { presetKeys, sanitizeKeyMap, type KeyMap, type KeyPreset } from '../input/mapping';
import type { Medal } from '../sim/scoring';
import type { TierId } from '../sim/tiers';

export const PREFIX = 'g499:catch:';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';

export interface Settings {
  quality: QualitySetting;
  muted: boolean;
  /** Master volume 0..1. */
  volume: number;
  /** The calm music bed (the effects stay on). */
  music: boolean;
  reducedMotion: boolean;
  tier: TierId;
  keyPreset: KeyPreset | 'custom';
  keys: KeyMap;
  /** Touch: stick and CATCH on the right, for one thumb. */
  oneHanded: boolean;
  /** The Cadet first-run tutorial has been finished or skipped. */
  tutorialDone: boolean;
  /** Speak the Cadet tutorial and coach lines (offline device voices only). */
  voice: boolean;
}

/** The parts of the Web Storage API the game uses. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let backend: StorageBackend | null = null;

/** Tests inject an in-memory store; null returns to window.localStorage. */
export function setStorageBackend(b: StorageBackend | null): void {
  backend = b;
}

function store(): StorageBackend | null {
  if (backend) return backend;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultSettings(): Settings {
  return {
    quality: 'auto',
    muted: false,
    volume: 0.8,
    music: true,
    reducedMotion: prefersReducedMotion(),
    tier: 'cadet',
    keyPreset: 'standard',
    keys: presetKeys('standard'),
    oneHanded: false,
    tutorialDone: false,
    voice: true,
  };
}

function read(key: string): string | null {
  try {
    return store()?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    store()?.setItem(PREFIX + key, value);
  } catch {
    // Storage full or blocked: settings simply do not persist.
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function loadSettings(): Settings {
  const d = defaultSettings();
  const raw = read('settings');
  if (!raw) return d;
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    const preset = s.keyPreset === 'onehand' || s.keyPreset === 'custom' ? s.keyPreset : 'standard';
    return {
      quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : 'auto',
      muted: typeof s.muted === 'boolean' ? s.muted : d.muted,
      volume: typeof s.volume === 'number' && Number.isFinite(s.volume) ? clamp01(s.volume) : d.volume,
      music: typeof s.music === 'boolean' ? s.music : d.music,
      reducedMotion: typeof s.reducedMotion === 'boolean' ? s.reducedMotion : d.reducedMotion,
      tier: s.tier === 'pilot' || s.tier === 'fd' ? s.tier : 'cadet',
      keyPreset: preset,
      keys: preset === 'custom' ? sanitizeKeyMap(s.keys) : presetKeys(preset),
      oneHanded: typeof s.oneHanded === 'boolean' ? s.oneHanded : d.oneHanded,
      tutorialDone: typeof s.tutorialDone === 'boolean' ? s.tutorialDone : d.tutorialDone,
      voice: typeof s.voice === 'boolean' ? s.voice : d.voice,
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  write('settings', JSON.stringify(s));
}

export interface BestRecord {
  score: number;
  medal: Medal;
}

const MEDALS: readonly Medal[] = ['none', 'bronze', 'silver', 'gold', 'bullseye'];

export function loadBestRecord(tier: TierId): BestRecord {
  const raw = read(`best:${tier}`);
  if (!raw) return { score: 0, medal: 'none' };
  // Older builds stored a bare number.
  const n = Number(raw);
  if (Number.isFinite(n)) return { score: Math.max(0, Math.round(n)), medal: 'none' };
  try {
    const r = JSON.parse(raw) as Partial<BestRecord>;
    const score = typeof r.score === 'number' && Number.isFinite(r.score) ? Math.max(0, Math.round(r.score)) : 0;
    const medal = MEDALS.includes(r.medal as Medal) ? (r.medal as Medal) : 'none';
    return { score, medal };
  } catch {
    return { score: 0, medal: 'none' };
  }
}

export function loadBest(tier: TierId): number {
  return loadBestRecord(tier).score;
}

/** Stores the score if it beats the best for this tier. Returns true on a new best. */
export function saveBest(tier: TierId, score: number, medal: Medal = 'none'): boolean {
  const s = Math.round(score);
  if (!Number.isFinite(s) || s <= loadBest(tier)) return false;
  write(`best:${tier}`, JSON.stringify({ score: s, medal }));
  return true;
}
