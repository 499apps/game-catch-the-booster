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
  const score = Number(await page.getByTestId('debrief-score').textContent());
  expect(score).toBeGreaterThan(0);
  expect(s.score).toBe(score);
  await expect(page.getByTestId('debrief-tip')).not.toBeEmpty();

  // Replay = seed + tier + input log: the same flight and the same score.
  await page.getByTestId('replay-btn').click();
  await expect.poll(async () => (await state(page)).replay).toBe(true);
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('debrief-score')).toHaveText(String(score));
  expect(errors).toEqual([]);
});

test('Flight Director autopilot run reaches a debrief', async ({ page }, info) => {
  onlyLongProjects(info.project.name);
  await openGame(page, 'autopilot=1&timescale=8&seed=2');
  await startTier(page, 'fd');
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('debrief-score')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('debrief-outcome')).not.toBeEmpty();
});
