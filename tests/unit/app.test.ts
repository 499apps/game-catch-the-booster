import { describe, expect, it } from 'vitest';
import { parseHooks } from '../../src/app/params';
import { AdaptiveQuality, PROFILES } from '../../src/render/quality';

describe('URL test hooks', () => {
  it('are inactive on a plain URL', () => {
    const h = parseHooks('');
    expect(h.active).toBe(false);
    expect(h.autopilot).toBe(false);
    expect(h.timescale).toBe(1);
    expect(h.still).toBe(false);
    expect(h.seed).toBeNull();
  });

  it('parse autopilot, timescale, still, seed and tier', () => {
    const h = parseHooks('?autopilot=1&timescale=4&still=1&seed=42&tier=fd&at=12');
    expect(h).toMatchObject({ active: true, autopilot: true, timescale: 4, still: true, seed: 42, tier: 'fd', at: 12 });
  });

  it('clamp the timescale and reject unknown tiers', () => {
    expect(parseHooks('?timescale=1000').timescale).toBe(16);
    expect(parseHooks('?timescale=abc').timescale).toBe(1);
    expect(parseHooks('?tier=boss').tier).toBeNull();
  });
});

describe('adaptive quality', () => {
  it('profiles follow the spec (pixel ratio caps, bloom, shadows)', () => {
    expect(PROFILES.low.pixelRatioCap).toBe(1.25);
    expect(PROFILES.medium.pixelRatioCap).toBe(1.5);
    expect(PROFILES.high.pixelRatioCap).toBe(2);
    expect(PROFILES.low.bloom).toBe('off');
    expect(PROFILES.medium.bloom).toBe('half');
    expect(PROFILES.high.bloom).toBe('full');
    expect(PROFILES.low.particles).toBeLessThan(PROFILES.medium.particles);
    expect(PROFILES.medium.particles).toBeLessThan(PROFILES.high.particles);
  });

  it('Auto drops one tier after ~2 s above 18 ms, and never below Low', () => {
    const q = new AdaptiveQuality('auto', 'high');
    let drops = 0;
    for (let i = 0; i < 100; i++) if (q.sample(25)) drops++; // 2.5 s of 25 ms frames
    expect(drops).toBe(1);
    expect(q.tier).toBe('medium');
    for (let i = 0; i < 1000; i++) q.sample(40);
    expect(q.tier).toBe('low');
    expect(q.drops).toBe(2);
  });

  it('fast frames never drop, and fixed settings never adapt', () => {
    const a = new AdaptiveQuality('auto', 'high');
    for (let i = 0; i < 1000; i++) a.sample(16.7);
    expect(a.tier).toBe('high');
    const f = new AdaptiveQuality('medium', 'high');
    for (let i = 0; i < 1000; i++) f.sample(50);
    expect(f.tier).toBe('medium');
  });

  it('very slow software-rendered frames still count toward a drop', () => {
    const q = new AdaptiveQuality('auto', 'high');
    let dropped = false;
    for (let i = 0; i < 20; i++) dropped = q.sample(400) || dropped;
    expect(dropped).toBe(true);
    const slow = new AdaptiveQuality('auto', 'high');
    let droppedSlow = false;
    for (let i = 0; i < 20; i++) droppedSlow = slow.sample(1800) || droppedSlow;
    expect(droppedSlow).toBe(true);
  });

  it('parses the quality hook', () => {
    expect(parseHooks('?quality=low').quality).toBe('low');
    expect(parseHooks('?quality=ultra').quality).toBeNull();
  });
});
