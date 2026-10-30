import { expect, test } from '@playwright/test';
import { openGame, skipWithoutWebGL, startTier, state } from './helpers';

/**
 * Frame budget at Auto quality (desktop Chromium only).
 * - With a real GPU: at least FPS_TARGET frames per second over ~3 s.
 * - Headless Chromium renders WebGL with SwiftShader (a CPU rasteriser), which cannot
 *   hold 60 fps. There the lenient budget is FPS_HEADLESS_MIN, and Auto must react:
 *   it drops at least one quality tier after 2 s above the 18 ms frame budget.
 */
const FPS_TARGET = 50;
// SwiftShader at High (bloom + 2048 shadows) measured ~2 fps on this host before Auto
// stepped down, so the floor only proves the loop is alive; the real check is the tier drop.
const FPS_HEADLESS_MIN = 1;

test('fps budget and adaptive quality at Auto', async ({ page, browserName }, info) => {
  test.skip(info.project.name !== 'chromium', 'The frame budget is measured on desktop Chromium only.');
  const s0 = await openGame(page, 'test=1&seed=8&quality=auto');
  skipWithoutWebGL(s0, browserName);
  expect(s0.qualitySetting).toBe('auto');
  await startTier(page, 'cadet');

  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = (now: number): void => {
          n++;
          if (now - t0 >= 3000) resolve((n * 1000) / (now - t0));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  info.annotations.push({ type: 'fps', description: `${fps.toFixed(1)} fps at start tier ${s0.quality}` });
  expect(fps).toBeGreaterThan(FPS_HEADLESS_MIN);
  if (fps < FPS_TARGET) {
    // Too slow for the target: Auto must have stepped down (or already be at Low).
    await expect
      .poll(async () => {
        const s = await state(page);
        return s.qualityDrops > 0 || s.quality === 'low';
      }, { timeout: 20_000 })
      .toBe(true);
  }
});
