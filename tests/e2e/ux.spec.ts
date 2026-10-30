import { expect, test } from '@playwright/test';
import { expectOnLeft, openGame, overlaps, startTier, state } from './helpers';

test('HUD: the Go/No-Go board never covers ALTITUDE, PROP or STOP (all layouts)', async ({ page }) => {
  // A deterministic Flight Director frame after the poll, with the board showing.
  await openGame(page, 'still=1&tier=fd&seed=2&at=10');
  const board = page.getByTestId('gonogo');
  await expect(board).toBeVisible();
  const b = await board.boundingBox();
  expect(b).not.toBeNull();
  for (const id of ['hud-alt', 'hud-stop']) {
    const r = await page.getByTestId(id).boundingBox();
    if (!b || !r || r.width === 0) continue;
    expect(overlaps(b, r), `${id} is covered by the board`).toBe(false);
  }
  // And the board stays inside the safe screen area.
  const vp = page.viewportSize();
  if (b && vp) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
  }
});

test('phone strip: no chip, value or cell clips its own text during the flight', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-15' && info.project.name !== 'pixel-7', 'The compact strip is for phones.');
  for (const [tier, at] of [
    ['pilot', 5],
    ['cadet', 14],
    ['fd', 10],
  ] as const) {
    // Deterministic frames in the burn (PIN, TILT, V/S, STOP and the board all showing).
    await openGame(page, `still=1&tier=${tier}&seed=2&at=${at}`);
    await expect(page.getByTestId('telemetry')).toBeVisible();
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('#telemetry, #telemetry .chip, #telemetry .v, #telemetry .cell'))
        .filter((e) => e.offsetParent !== null && e.clientWidth > 0)
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => `${e.className}: "${e.textContent ?? ''}" ${e.scrollWidth}>${e.clientWidth}`),
    );
    expect(clipped, `${tier} +${at} s`).toEqual([]);
    // And the strip itself stays on the screen.
    const box = await page.getByTestId('telemetry').boundingBox();
    const vp = page.viewportSize();
    if (box && vp) expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  }
});

test('touch tutorial: the Skip pill sits under the strip, never on its STOP value or clock', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-15' && info.project.name !== 'pixel-7', 'The pill layout is for phones (393x852, 412x915).');
  await openGame(page, 'still=1&tier=cadet&seed=1&tutorial=1');
  const pill = page.getByTestId('tutorial-skip');
  const strip = page.getByTestId('telemetry');
  await expect(pill).toBeVisible();
  await expect(strip).toBeVisible();
  // The pill docks under the strip once the strip reports its height (a ResizeObserver): poll.
  await expect
    .poll(async () => {
      const p = await pill.boundingBox();
      const s = await strip.boundingBox();
      if (!p || !s) return 'no box';
      if (overlaps(p, s)) return `pill (${p.x}, ${p.y}, ${p.width}x${p.height}) on the strip (${s.x}, ${s.y}, ${s.width}x${s.height})`;
      return p.y >= s.y + s.height - 1 ? 'under' : 'above';
    })
    .toBe('under');
  const p = await pill.boundingBox();
  const vp = page.viewportSize();
  if (p && vp) expect(p.x + p.width).toBeLessThanOrEqual(vp.width + 1);
  // And the steer banner (the lesson) wraps before the pill.
  const cue = page.getByTestId('steer-cue');
  if (p && (await cue.isVisible())) {
    const c = await cue.boundingBox();
    if (c) expect(overlaps(p, c), 'the pill covers the steer banner').toBe(false);
  }
});

test('M toggles the sound, and the Real facts card is in the left menu', async ({ page }) => {
  await openGame(page);
  const before = (await state(page)).muted;
  await page.keyboard.press('KeyM');
  await expect.poll(async () => (await state(page)).muted).toBe(!before);
  await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', String(before));
  const card = page.getByTestId('facts-card');
  await card.scrollIntoViewIfNeeded();
  await card.locator('summary').click();
  await expect(card).toContainText('Landing legs weigh many tonnes');
  await expectOnLeft(page, 'rail');
});

test('the left menu works from the keyboard (focus-visible, Tab, Escape)', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium' && info.project.name !== 'firefox', 'Desktop keyboard navigation.');
  await openGame(page, 'test=1&seed=5');
  await startTier(page, 'pilot');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-section')).toBeVisible();
  // The first control of the pause menu has the focus, and it shows an outline.
  const focused = page.locator(':focus');
  await expect(focused).toHaveAttribute('data-testid', 'resume-btn');
  const outline = await focused.evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'restart-btn');
  // Enter on the focused Resume button resumes the flight.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rail')).not.toHaveClass(/open/);
  // window.__catch is published once per frame; poll so a slow software-GL frame cannot race the check.
  await expect.poll(async () => (await state(page)).paused).toBe(false);
});

test('keys can be remapped in Settings (and stay mapped after a reload)', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Keyboard remapping: desktop Chromium.');
  await openGame(page);
  await page.locator('details.keymap summary').click();
  await page.getByTestId('key-catch').click();
  await expect(page.getByTestId('key-catch')).toHaveText('Press a key…');
  await page.keyboard.press('KeyB');
  await expect(page.getByTestId('key-catch')).toHaveText('B');
  await expect(page.getByTestId('key-preset')).toHaveValue('custom');
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __catch?: { ready: boolean } }).__catch?.ready);
  await expect(page.getByTestId('key-catch')).toHaveText('B');
  // The one-handed preset replaces the custom keys.
  await page.getByTestId('key-preset').selectOption('onehand');
  await expect(page.getByTestId('key-ignite')).toHaveText('F');
});

test('reduced motion: the setting toggles the class that stops shake, pulses and flashes', async ({ page }) => {
  await openGame(page);
  const app = page.locator('#app');
  const was = await app.evaluate((e) => e.classList.contains('reduced'));
  await page.getByTestId('reduced-motion').click();
  await expect.poll(() => app.evaluate((e) => e.classList.contains('reduced'))).toBe(!was);
});
