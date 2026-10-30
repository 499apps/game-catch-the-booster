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
// stepped down (under 1 fps with the C2 dusk shaders and parallel workers), so the floor only
// proves the loop is alive; the real check is the tier drop.
const FPS_HEADLESS_MIN = 0.25;

/** Low tier: the whole frame (every pass) stays under this many draw calls. */
const LOW_DRAW_CALLS_MAX = 150;

test('Low quality stays under the draw-call budget in flight', async ({ page, browserName }, info) => {
  test.skip(info.project.name !== 'chromium', 'Draw calls are counted on desktop Chromium only.');
  const s = await openGame(page, 'still=1&tier=cadet&seed=1&at=12');
  skipWithoutWebGL(s, browserName);
  expect(s.quality).toBe('low');
  info.annotations.push({ type: 'drawCalls', description: String(s.drawCalls) });
  expect(s.drawCalls).toBeGreaterThan(5);
  expect(s.drawCalls).toBeLessThan(LOW_DRAW_CALLS_MAX);
});

test('fps budget and adaptive quality at Auto', async ({ page, browserName }, info) => {
  test.skip(info.project.name !== 'chromium', 'The frame budget is measured on desktop Chromium only.');
  // Starts at Auto (High on a desktop), which SwiftShader renders at ~2 fps until Auto steps down.
  test.slow();
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
