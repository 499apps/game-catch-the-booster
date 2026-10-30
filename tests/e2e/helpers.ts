import { expect, test, type Page } from '@playwright/test';

export interface CatchState {
  ready: boolean;
  webgl: boolean;
  mode: string;
  tier: string | null;
  seed: number | null;
  phase: string;
  t: number;
  tau: number | null;
  outcome: { caught: boolean; reason: string | null } | null;
  score: number | null;
  quality: string;
  qualitySetting: string;
  qualityDrops: number;
  fps: number;
  frames: number;
  camera: string;
  paused: boolean;
  replay: boolean;
  replayT: number | null;
  split: boolean;
  tutorial: string | null;
  muted: boolean;
  drawCalls: number;
}

/** True when two boxes overlap (by more than 1 px on both axes). */
export function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x + 1 < b.x + b.width && b.x + 1 < a.x + a.width && a.y + 1 < b.y + b.height && b.y + 1 < a.y + a.height;
}

/** Collects console errors and uncaught page errors. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function state(page: Page): Promise<CatchState> {
  return page.evaluate(() => {
    const s = (window as unknown as { __catch?: unknown }).__catch;
    if (!s) throw new Error('window.__catch missing (no test hook in the URL?)');
    return JSON.parse(JSON.stringify(s)) as never;
  });
}

/**
 * Opens the game with test hooks and waits for the first frames.
 * Unless the query sets `quality=` (or is a still frame), tests run at Low quality:
 * every browser here rasterises WebGL in software, and these tests check behaviour,
 * not the frame budget (perf.spec.ts measures Auto on its own).
 */
export async function openGame(page: Page, query = 'test=1'): Promise<CatchState> {
  const q = /(^|&)(quality|still)=/.test(query) ? query : `${query}&quality=low&scale=0.5`;
  await page.goto(`./?${q}`);
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __catch?: { ready: boolean } }).__catch;
      return !!s && s.ready;
    },
    undefined,
    { timeout: 40_000 },
  );
  return state(page);
}

/**
 * Long flights (autopilot catch + replay, Flight Director run) run on desktop Chromium
 * and one phone project. The other projects still cover load, tier start, the left
 * menu, privacy and offline; the flight logic is the same deterministic sim everywhere
 * and the golden unit tests cover it per tier and seed.
 */
export const LONG_PROJECTS: readonly string[] = ['chromium', 'pixel-7'];

export function onlyLongProjects(projectName: string): void {
  test.skip(!LONG_PROJECTS.includes(projectName), 'Long autopilot flights run on chromium and pixel-7 only (speed budget).');
}

/** Skips the current test, with the reason, when this browser has no WebGL2 here. */
export function skipWithoutWebGL(s: CatchState, browserName: string): void {
  test.skip(!s.webgl, `WebGL2 is not available in headless ${browserName} on this host; the 3D view cannot render.`);
}

/** Picks a tier in the LEFT rail and starts a Final Approach run. */
export async function startTier(page: Page, tier: 'cadet' | 'pilot' | 'fd'): Promise<void> {
  await expect(page.getByTestId('rail')).toHaveClass(/open/);
  await page.getByTestId(`tier-${tier}`).click();
  await page.getByTestId('start-btn').click();
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __catch?: { phase: string } }).__catch;
      return !!s && s.phase !== 'menu';
    },
    undefined,
    { timeout: 10_000 },
  );
}

/** Counts distinct colours in a downscaled copy of the WebGL canvas (needs preserveDrawingBuffer). */
export async function canvasColourCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const src = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    if (!src) return 0;
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(src, 0, 0, 48, 48);
    const d = ctx.getImageData(0, 0, 48, 48).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] ?? 0;
      const g = d[i + 1] ?? 0;
      const b = d[i + 2] ?? 0;
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
    return seen.size;
  });
}

/** Asserts an element sits in the left part of the viewport. */
export async function expectOnLeft(page: Page, testId: string): Promise<void> {
  const loc = page.getByTestId(testId);
  await expect(loc).toBeVisible();
  // Let the slide-in transition finish.
  await expect.poll(async () => (await loc.boundingBox())?.x ?? -999).toBeGreaterThanOrEqual(-1);
  const box = await loc.boundingBox();
  const vp = page.viewportSize();
  expect(box, `${testId} should be visible`).not.toBeNull();
  expect(vp).not.toBeNull();
  if (!box || !vp) return;
  // The rail starts at x = 0; the menu button is inset 10 px (plus the safe area) by design.
  expect(box.x).toBeLessThanOrEqual(16);
  // The rail/drawer is at most ~86% wide on phones; its centre must be in the left half.
  expect(box.x + box.width / 2).toBeLessThan(vp.width / 2);
}
