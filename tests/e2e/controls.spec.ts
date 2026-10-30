// c10: the keyboard must feel immediate and obvious. Real key events (page.keyboard), no
// input hooks: the URL only sets the seed, the quality / scale and the test state.
import { expect, test, type Page } from '@playwright/test';
import { openGame, startTier, state } from './helpers';

test.skip(({ isMobile }) => isMobile, 'Keyboard controls: desktop projects only (touch has its own stick).');

/** Holds a key until the sim has run `seconds` more (software GL can be slower than real time). */
async function holdFor(page: Page, code: string, seconds: number): Promise<void> {
  const t0 = (await state(page)).t;
  await page.keyboard.down(code);
  await expect.poll(async () => (await state(page)).t, { timeout: 20_000, intervals: [50] }).toBeGreaterThanOrEqual(t0 + seconds);
}

test('a held key lights the input indicator within 150 ms, and it clears on release', async ({ page }) => {
  await openGame(page, 'test=1&seed=4');
  await startTier(page, 'pilot');
  const ind = page.getByTestId('input-indicator');
  await expect(ind).toBeVisible({ timeout: 5_000 });
  await expect(ind).not.toHaveClass(/active/);
  // Time the key down and the indicator's change in the page itself (no round-trip delay).
  await page.evaluate(() => {
    const w = window as unknown as { __kd: number; __lit: number };
    w.__kd = 0;
    w.__lit = 0;
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyD' && !w.__kd) w.__kd = performance.now();
      },
      { capture: true },
    );
    const el = document.querySelector('[data-testid="input-indicator"]');
    if (!el) throw new Error('no input indicator');
    new MutationObserver(() => {
      if (!w.__lit && el.classList.contains('active')) w.__lit = performance.now();
    }).observe(el, { attributes: true });
  });
  await page.keyboard.down('KeyD');
  const lit = (): Promise<{ kd: number; lit: number }> =>
    page.evaluate(() => {
      const w = window as unknown as { __kd: number; __lit: number };
      return { kd: w.__kd, lit: w.__lit };
    });
  await expect.poll(async () => (await lit()).lit, { timeout: 5_000 }).toBeGreaterThan(0);
  const t = await lit();
  expect(t.kd).toBeGreaterThan(0);
  expect(t.lit - t.kd).toBeLessThan(150);
  await expect(ind).toHaveClass(/active/);
  expect(Number(await ind.getAttribute('data-x'))).toBeGreaterThan(0.5);
  await page.keyboard.up('KeyD');
  await expect(ind).not.toHaveClass(/active/, { timeout: 2_000 });
  await expect(ind).toHaveAttribute('data-x', '0.00');
});

test('Pilot: a held key tilts the booster during the coast', async ({ page }) => {
  await openGame(page, 'test=1&seed=4');
  await startTier(page, 'pilot');
  await expect(page.getByTestId('light-btn')).toBeVisible({ timeout: 5_000 });
  const s0 = await state(page);
  expect(s0.phase).toBe('coast');
  await holdFor(page, 'KeyD', 1.5);
  const s1 = await state(page);
  await page.keyboard.up('KeyD');
  // Light the engines so the run does not end in a late-ignition splashdown.
  await page.keyboard.press('Enter');
  expect(s1.phase).toBe('coast');
  // D is "right" on screen; the camera turns it into world axes. Measure the tilt change along
  // the shaped stick the sim used, and its x part in the sign of inputX.
  const m = Math.hypot(s1.inputX, s1.inputZ);
  expect(m).toBeGreaterThan(0.5);
  const dx = s1.tiltX - s0.tiltX;
  const dz = s1.tiltZ - s0.tiltZ;
  const along = (dx * s1.inputX + dz * s1.inputZ) / m;
  const sin2 = Math.sin((2 * Math.PI) / 180);
  expect(along, `tilt change ${dx.toFixed(4)}, ${dz.toFixed(4)} vs stick ${s1.inputX.toFixed(2)}, ${s1.inputZ.toFixed(2)}`).toBeGreaterThan(sin2);
  if (Math.abs(s1.inputX) > 0.5) {
    expect(Math.abs(dx)).toBeGreaterThan(sin2 * 0.5);
    expect(Math.sign(dx)).toBe(Math.sign(s1.inputX));
  }
  await expect.poll(async () => (await state(page)).tau, { timeout: 5_000 }).not.toBeNull();
});

test('Cadet: the arrow key moves the aim, and a sideways key moves it too', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'A 20 s flight to the divert: desktop Chromium only (speed budget).');
  test.setTimeout(180_000);
  // Test hooks skip the first-run tutorial, so the Cadet run flies at once.
  await openGame(page, 'test=1&seed=11');
  await startTier(page, 'cadet');
  const cue = page.getByTestId('steer-cue');
  await expect(cue).toBeVisible({ timeout: 120_000 });
  const sx = Number(await cue.getAttribute('data-sx'));
  const sz = Number(await cue.getAttribute('data-sz'));
  const horizontal = Math.abs(sx) >= Math.abs(sz);
  // The key nearest the HUD arrow (screen axes: x right, z down), then one across it.
  const along = horizontal ? (sx > 0 ? 'KeyD' : 'KeyA') : sz > 0 ? 'KeyS' : 'KeyW';
  const across = horizontal ? 'KeyW' : 'KeyD';

  const a0 = await state(page);
  await holdFor(page, along, 1.0);
  await page.keyboard.up(along);
  const a1 = await state(page);
  const moved1 = Math.hypot(a1.aimX - a0.aimX, a1.aimZ - a0.aimZ);
  expect(moved1, `${along}: aim ${a0.aimX.toFixed(2)},${a0.aimZ.toFixed(2)} -> ${a1.aimX.toFixed(2)},${a1.aimZ.toFixed(2)}`).toBeGreaterThan(1);

  await holdFor(page, across, 1.0);
  await page.keyboard.up(across);
  const a2 = await state(page);
  const moved2 = Math.hypot(a2.aimX - a1.aimX, a2.aimZ - a1.aimZ);
  expect(moved2, `${across}: aim ${a1.aimX.toFixed(2)},${a1.aimZ.toFixed(2)} -> ${a2.aimX.toFixed(2)},${a2.aimZ.toFixed(2)}`).toBeGreaterThan(0.5);
});
