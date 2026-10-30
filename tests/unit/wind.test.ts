import { describe, expect, it } from 'vitest';
import { DT, GUST_TAU, TIER_CONFIG, makeRng, makeWind, meanWindSpeed, shearFactor, updateWind, windAt } from '../../src/sim';

describe('wind model', () => {
  it('Cadet has no wind at all', () => {
    const w = makeWind(TIER_CONFIG.cadet, makeRng(1, 1));
    const rng = makeRng(1, 2);
    for (let i = 0; i < 1000; i++) updateWind(w, rng, DT);
    const v = windAt(w, 300, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(v.x, v.y, v.z)).toBe(0);
  });

  it('mean wind speed lies inside the tier range', () => {
    for (let s = 1; s < 40; s++) {
      for (const t of ['pilot', 'fd'] as const) {
        const w = makeWind(TIER_CONFIG[t], makeRng(s, 1));
        expect(meanWindSpeed(w)).toBeGreaterThanOrEqual(TIER_CONFIG[t].windMean[0] - 1e-9);
        expect(meanWindSpeed(w)).toBeLessThanOrEqual(TIER_CONFIG[t].windMean[1] + 1e-9);
      }
    }
  });

  it('gusts have zero mean, the tier sigma and a ~2 s correlation time', () => {
    const cfg = TIER_CONFIG.fd;
    const w = makeWind(cfg, makeRng(42, 1));
    const rng = makeRng(42, 9);
    const n = 200_000;
    const xs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      updateWind(w, rng, DT);
      xs[i] = w.gustX;
    }
    let mean = 0;
    for (const x of xs) mean += x;
    mean /= n;
    let v = 0;
    for (const x of xs) v += (x - mean) ** 2;
    v /= n;
    const sd = Math.sqrt(v);
    expect(Math.abs(mean)).toBeLessThan(0.2 * cfg.gustSigma);
    expect(sd).toBeGreaterThan(0.85 * cfg.gustSigma);
    expect(sd).toBeLessThan(1.15 * cfg.gustSigma);
    const lag = Math.round(GUST_TAU / DT);
    let c = 0;
    for (let i = 0; i + lag < n; i++) c += (xs[i]! - mean) * (xs[i + lag]! - mean);
    c /= (n - lag) * v;
    expect(c).toBeGreaterThan(Math.exp(-1) - 0.12);
    expect(c).toBeLessThan(Math.exp(-1) + 0.12);
  });

  it('shear raises the mean wind above 100 m', () => {
    const w = makeWind(TIER_CONFIG.fd, makeRng(3, 1));
    expect(shearFactor(w, 50)).toBe(1);
    expect(shearFactor(w, 100)).toBe(1);
    expect(shearFactor(w, 400)).toBeCloseTo(1 + TIER_CONFIG.fd.shear, 12);
    expect(shearFactor(w, 250)).toBeGreaterThan(1);
  });
});
