import { expect, test } from '@playwright/test';
import { openGame, skipWithoutWebGL } from './helpers';

// Deterministic still frames (?still=1): seed 1, Low quality (no bloom or shadow
// variance), render clock frozen at 0, autopilot-flown state, no rAF loop running.
// CSS animations are disabled and the HUD clock / fps readouts are masked.
// Baselines are per project (browser + device): make them with --update-snapshots.
const SHOTS = [
  { name: 'main-menu', query: 'still=1&seed=1' },
  { name: 'in-flight', query: 'still=1&tier=cadet&seed=1&at=20' },
  { name: 'debrief', query: 'still=1&tier=cadet&seed=1&debrief=1' },
] as const;

for (const shot of SHOTS) {
  test(`visual: ${shot.name}`, async ({ page, browserName }) => {
    const s = await openGame(page, shot.query);
    skipWithoutWebGL(s, browserName);
    if (shot.name === 'debrief') await expect(page.getByTestId('debrief')).toBeVisible();
    await expect(page).toHaveScreenshot(`${shot.name}.png`, {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
      mask: [page.getByTestId('hud-t'), page.getByTestId('fps')],
    });
  });
}
