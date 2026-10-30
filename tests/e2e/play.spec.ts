import { expect, test } from '@playwright/test';
import { onlyLongProjects, openGame, startTier, state, trackErrors } from './helpers';

for (const tier of ['cadet', 'pilot', 'fd'] as const) {
  test(`starts a ${tier} run and the flight advances`, async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page, 'test=1&seed=11');
    await startTier(page, tier);
    const s0 = await state(page);
    expect(s0.tier).toBe(tier);
    await expect(page.getByTestId('hud')).not.toHaveClass(/hidden/);
    await expect(page.getByTestId('telemetry')).toBeVisible();
    // Pilot / FD light the engines themselves, so LIGHT is offered during the coast
    // (about 4 s at timescale 1). Cadet lights automatically and shows LIGHT only near the cue.
    if (tier !== 'cadet') await expect(page.getByTestId('light-btn')).toBeVisible({ timeout: 3_000 });
    await expect.poll(async () => (await state(page)).t, { timeout: 10_000 }).toBeGreaterThan(s0.t + 0.5);
    expect(errors).toEqual([]);
  });
}

test('Pilot: the player lights the engines with a tap of Enter', async ({ page }) => {
  await openGame(page, 'test=1&seed=4');
  await startTier(page, 'pilot');
  await expect(page.getByTestId('light-btn')).toBeVisible({ timeout: 3_000 });
  // press() is a key-down/up within one frame: the tap latch must still deliver it.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).tau, { timeout: 5_000 }).not.toBeNull();
  const s = await state(page);
  expect(s.outcome?.reason ?? null).not.toBe('lateIgnition');
  expect(s.phase).toBe('burn13'); // no step-down pressed yet
  await expect(page.getByTestId('hud-t')).toHaveText(/^\+/);
});

test('autopilot completes a catch, shows a scored debrief, and the replay matches', async ({ page }, info) => {
  onlyLongProjects(info.project.name);
  const errors = trackErrors(page);
  await openGame(page, 'autopilot=1&timescale=8&seed=3');
  await startTier(page, 'cadet');
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 25_000 });
  const s = await state(page);
  expect(s.outcome?.caught).toBe(true);
  const score = s.score ?? 0;
  expect(score).toBeGreaterThan(0);
  // The counters count up, then land on the final score.
  await expect(page.getByTestId('debrief-score')).toHaveText(String(score), { timeout: 5_000 });
  await expect(page.getByTestId('debrief-tip')).not.toBeEmpty();
  await expect(page.getByTestId('debrief-graphs')).toBeVisible();
  await expect(page.getByTestId('debrief-best')).toContainText(String(score));
  // After the catch the director shows the booster in the arms (beach long lens).
  expect(s.camera).toBe('beach');

  // Replay = seed + tier + input log: the same flight and the same score.
  await page.getByTestId('replay-btn').click();
  await expect.poll(async () => (await state(page)).replay).toBe(true);
  await expect(page.getByTestId('replay-bar')).toBeVisible();
  expect((await state(page)).score).toBe(score);
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('debrief-score')).toHaveText(String(score));
  expect(errors).toEqual([]);
});

test('replay controls: pause, scrub, speed and the split-screen last 15 s', async ({ page }, info) => {
  onlyLongProjects(info.project.name);
  await openGame(page, 'autopilot=1&timescale=8&seed=3');
  await startTier(page, 'cadet');
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('replay-btn').click();
  await expect(page.getByTestId('replay-bar')).toBeVisible();
  // Pause holds the clock.
  await page.getByTestId('replay-play').click();
  // window.__catch is published per frame: let the pause land before sampling.
  await page.waitForTimeout(300);
  const t0 = (await state(page)).replayT ?? -1;
  await page.waitForTimeout(400);
  expect((await state(page)).replayT).toBe(t0);
  // Scrub to the middle.
  await page.getByTestId('replay-scrub').fill('500');
  await expect.poll(async () => (await state(page)).replayT ?? 0).toBeGreaterThan(10);
  // 1x -> 2x -> 0.5x (slow, so the split window lasts long enough to observe).
  await page.getByTestId('replay-speed').click();
  await expect(page.getByTestId('replay-speed')).toHaveText('2×');
  await page.getByTestId('replay-speed').click();
  await expect(page.getByTestId('replay-speed')).toHaveText('0.5×');
  // Split view jumps to the last 15 s and plays.
  await page.getByTestId('replay-split').click();
  await expect.poll(async () => (await state(page)).split).toBe(true);
  await expect(page.getByTestId('replay-split')).toHaveAttribute('aria-pressed', 'true');
  // It ends back on the debrief.
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 25_000 });
  await expect.poll(async () => (await state(page)).replay).toBe(false);
});

test('Cadet first-run tutorial teaches by doing and hands over to the flight', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Keyboard tutorial path: desktop Chromium (touch paths share the same state machine).');
  await openGame(page, 'tutorial=1&seed=6');
  await startTier(page, 'cadet');
  await expect(page.getByTestId('tutorial')).toBeVisible();
  await expect.poll(async () => (await state(page)).tutorial).toBe('steer');
  const t0 = (await state(page)).t;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyD');
  await expect.poll(async () => (await state(page)).tutorial).toBe('light');
  // The sim is frozen while the tutorial teaches.
  expect((await state(page)).t).toBe(t0);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).tutorial).toBe('catch');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).tutorial, { timeout: 8_000 }).toBeNull();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect.poll(async () => (await state(page)).t).toBeGreaterThan(t0);
});

test('the tutorial can be skipped', async ({ page }) => {
  await openGame(page, 'tutorial=1&seed=6');
  await startTier(page, 'cadet');
  await expect(page.getByTestId('tutorial-skip')).toBeVisible();
  await page.getByTestId('tutorial-skip').click();
  await expect.poll(async () => (await state(page)).tutorial).toBeNull();
  await expect(page.getByTestId('tutorial')).toBeHidden();
});

test('Flight Director autopilot run reaches a debrief', async ({ page }, info) => {
  onlyLongProjects(info.project.name);
  await openGame(page, 'autopilot=1&timescale=8&seed=2');
  await startTier(page, 'fd');
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('debrief-score')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('debrief-outcome')).not.toBeEmpty();
});
