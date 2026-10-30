import { expect, test } from '@playwright/test';
import { canvasColourCount, expectOnLeft, openGame, skipWithoutWebGL, startTier, state, trackErrors } from './helpers';

test('loads with no console errors and a non-blank WebGL canvas', async ({ page, browserName }) => {
  const errors = trackErrors(page);
  const s = await openGame(page);
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  expect(errors).toEqual([]);
  skipWithoutWebGL(s, browserName);
  await expect.poll(() => canvasColourCount(page)).toBeGreaterThan(12);
  expect(errors).toEqual([]);
});

test('main menu opens in the LEFT rail', async ({ page }) => {
  await openGame(page);
  await expect(page.getByTestId('rail')).toHaveClass(/open/);
  await expect(page.getByTestId('play-section')).toBeVisible();
  await expectOnLeft(page, 'rail');
  await expectOnLeft(page, 'menu-btn');
});

test('pause opens the LEFT rail and resume closes it', async ({ page }) => {
  await openGame(page, 'test=1&seed=5');
  await startTier(page, 'cadet');
  await expect(page.getByTestId('rail')).not.toHaveClass(/open/);
  await page.getByTestId('menu-btn').click();
  await expect(page.getByTestId('pause-section')).toBeVisible();
  await expectOnLeft(page, 'rail');
  expect((await state(page)).paused).toBe(true);
  const t0 = (await state(page)).t;
  await page.waitForTimeout(400);
  expect((await state(page)).t).toBe(t0);
  await page.getByTestId('resume-btn').click();
  await expect(page.getByTestId('rail')).not.toHaveClass(/open/);
  await expect.poll(async () => (await state(page)).t).toBeGreaterThan(t0);
});

test('Escape pauses and the cameras list is in the rail', async ({ page }) => {
  await openGame(page, 'test=1&seed=5');
  await startTier(page, 'pilot');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-section')).toBeVisible();
  await expect(page.getByTestId('cameras-section')).toBeVisible();
  await expectOnLeft(page, 'rail');
  await page.getByTestId('cam-towerTop').click();
  await expect.poll(async () => (await state(page)).camera).toBe('towerTop');
});

test('manifest is linked and valid', async ({ page }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(new URL(href ?? '', page.url()).toString());
  expect(res.ok()).toBe(true);
  const json = (await res.json()) as {
    name: string;
    scope: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(json.name).toBe('Catch the Booster');
  expect(json.scope).toBe('/games/catch-the-booster/');
  expect(json.start_url).toBe('/games/catch-the-booster/');
  expect(json.display).toBe('standalone');
  const sizes = json.icons.map((i) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(json.icons.some((i) => (i.purpose ?? '').includes('maskable'))).toBe(true);
  for (const icon of json.icons) {
    const r = await page.request.get(new URL(icon.src, res.url()).toString());
    expect(r.ok(), icon.src).toBe(true);
  }
});

test('privacy: same-origin requests only, no cookies, prefixed storage', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (new URL(u).origin !== origin) foreign.push(u);
  });
  await openGame(page, 'test=1&seed=9&timescale=4');
  await startTier(page, 'cadet');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.getByTestId('mute').click();
  expect(foreign).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe('');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) expect(k.startsWith('g499:catch:')).toBe(true);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer');
});

test('Clear my data wipes this game\'s keys', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('mute').click();
  expect(await page.evaluate(() => localStorage.getItem('g499:catch:settings'))).not.toBeNull();
  await page.getByTestId('clear-data').click();
  await expect(page.getByTestId('cleared')).not.toBeEmpty();
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('g499:catch:')));
  expect(keys).toEqual([]);
});
