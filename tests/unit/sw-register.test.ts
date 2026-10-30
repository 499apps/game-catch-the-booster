import { describe, expect, it } from 'vitest';
import { isAssembledBuild, swTargets } from '../../src/sw-register';

describe('service worker targets', () => {
  it('standalone builds register their own worker scoped to the game base', () => {
    expect(swTargets('/games/catch-the-booster/', false)).toEqual({
      scriptUrl: '/games/catch-the-booster/sw.js',
      scope: '/games/catch-the-booster/',
    });
  });

  it('assembled builds register the single hub worker at /games/', () => {
    expect(swTargets('/games/catch-the-booster/', true)).toEqual({
      scriptUrl: '/games/sw.js',
      scope: '/games/',
    });
  });

  it('reads VITE_ASSEMBLED=1 only', () => {
    expect(isAssembledBuild({ VITE_ASSEMBLED: '1' })).toBe(true);
    expect(isAssembledBuild({ VITE_ASSEMBLED: 'true' })).toBe(false);
    expect(isAssembledBuild({})).toBe(false);
  });
});
