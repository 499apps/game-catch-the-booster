import { expect, test } from '@playwright/test';
import { canvasColourCount, openGame, startTier, state } from './helpers';

// Playwright's network emulation only intercepts service-worker traffic reliably in
// Chromium, so the offline round-trip runs on the Chromium-based projects.
test('service worker controls the page and the game runs offline', async ({ page, context, browserName }) => {
  test.skip(
    browserName !== 'chromium',
    'Playwright offline emulation with service workers is only reliable in Chromium-based projects.',
  );
  await openGame(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // clients.claim() hands control to the new worker; reload if this page loaded before that.
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 15_000 });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe('/games/catch-the-booster/');

  await context.setOffline(true);
  try {
    // Same URL shape as the first load (quality=low is added): the SW serves the
    // navigation from its cached shell whatever the query string is.
    const s = await openGame(page, 'test=1&seed=21&timescale=2');
    await expect(page.getByTestId('rail')).toBeVisible();
    if (s.webgl) await expect.poll(() => canvasColourCount(page)).toBeGreaterThan(12);
    await startTier(page, 'cadet');
    const t0 = (await state(page)).t;
    await expect.poll(async () => (await state(page)).t).toBeGreaterThan(t0 + 0.5);
  } finally {
    await context.setOffline(false);
  }
});
