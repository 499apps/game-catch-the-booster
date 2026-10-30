import { test, expect } from '@playwright/test';

// C1a placeholder smoke test. C1b adds the full e2e suite (tiers, autopilot catch,
// left rail, offline, privacy, fps budget, visual regression).
test('loads with a canvas and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#game-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).toBe('');
  expect(errors).toEqual([]);
});

test('manifest is linked', async ({ page }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(new URL(href ?? '', page.url()).toString());
  expect(res.ok()).toBe(true);
  const json = (await res.json()) as { name: string; scope: string };
  expect(json.name).toBe('Catch the Booster');
  expect(json.scope).toBe('/games/catch-the-booster/');
});
