import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PREFIX,
  defaultSettings,
  loadBest,
  loadBestRecord,
  loadSettings,
  saveBest,
  saveSettings,
  setStorageBackend,
  type StorageBackend,
} from '../../src/app/storage';
import { presetKeys, rebind } from '../../src/input/mapping';

class MemoryStore implements StorageBackend {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

let mem: MemoryStore;
beforeEach(() => {
  mem = new MemoryStore();
  setStorageBackend(mem);
});
afterEach(() => setStorageBackend(null));

describe('best scores per tier', () => {
  it('start at 0 and keep only improvements', () => {
    expect(loadBest('pilot')).toBe(0);
    expect(saveBest('pilot', 640, 'bronze')).toBe(true);
    expect(saveBest('pilot', 600, 'bronze')).toBe(false);
    expect(saveBest('pilot', 640, 'bronze')).toBe(false);
    expect(saveBest('pilot', 912.4, 'gold')).toBe(true);
    expect(loadBestRecord('pilot')).toEqual({ score: 912, medal: 'gold' });
  });
  it('are separate per tier', () => {
    saveBest('cadet', 800);
    saveBest('fd', 300);
    expect(loadBest('cadet')).toBe(800);
    expect(loadBest('fd')).toBe(300);
    expect(loadBest('pilot')).toBe(0);
  });
  it('use prefixed keys only', () => {
    saveBest('cadet', 500, 'bronze');
    saveSettings(defaultSettings());
    for (const k of mem.data.keys()) expect(k.startsWith(PREFIX)).toBe(true);
  });
  it('read old bare-number records and survive junk', () => {
    mem.setItem(`${PREFIX}best:cadet`, '733');
    expect(loadBestRecord('cadet')).toEqual({ score: 733, medal: 'none' });
    mem.setItem(`${PREFIX}best:pilot`, '{oops');
    expect(loadBest('pilot')).toBe(0);
    mem.setItem(`${PREFIX}best:fd`, JSON.stringify({ score: 'x', medal: 'platinum' }));
    expect(loadBestRecord('fd')).toEqual({ score: 0, medal: 'none' });
  });
  it('a throwing store never breaks the game', () => {
    setStorageBackend({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    });
    expect(loadBest('cadet')).toBe(0);
    expect(() => saveBest('cadet', 900)).not.toThrow();
    expect(loadSettings()).toEqual(defaultSettings());
  });
});

describe('settings', () => {
  it('round-trip, including volume, music, one-handed and custom keys', () => {
    const keys = rebind(presetKeys('standard'), 'catch', 'KeyB');
    const s = { ...defaultSettings(), volume: 0.35, music: false, oneHanded: true, keyPreset: 'custom' as const, keys, tutorialDone: true, voice: false };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });
  it('the voice coach is on by default, and older saves without it turn it on', () => {
    expect(defaultSettings().voice).toBe(true);
    mem.setItem(`${PREFIX}settings`, JSON.stringify({ volume: 0.5 }));
    expect(loadSettings().voice).toBe(true);
  });
  it('clamp and repair bad values', () => {
    mem.setItem(`${PREFIX}settings`, JSON.stringify({ volume: 7, quality: 'ultra', tier: 'boss', keyPreset: 'weird', muted: 'yes' }));
    const s = loadSettings();
    expect(s.volume).toBe(1);
    expect(s.quality).toBe('auto');
    expect(s.tier).toBe('cadet');
    expect(s.keyPreset).toBe('standard');
    expect(s.muted).toBe(false);
  });
  it('a named preset always loads its own keys', () => {
    mem.setItem(`${PREFIX}settings`, JSON.stringify({ keyPreset: 'onehand', keys: { catch: ['KeyB'] } }));
    expect(loadSettings().keys).toEqual(presetKeys('onehand'));
  });
});
