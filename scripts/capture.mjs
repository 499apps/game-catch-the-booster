// Gameplay capture for review: a desktop video of an autopilot Cadet flight and a set of
// screenshots (desktop, iPhone 15 and Pixel 7 viewports) of every distinct screen and the
// key in-flight moments. Output goes to shots/ (gitignored). Needs a build first:
//
//   pnpm build && node scripts/capture.mjs
//
// It starts its own `vite preview` on port 4199 at the game's base path and stops it at
// the end (by process id, never by name). Chromium with SwiftShader, like the e2e suite.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from '@playwright/test';

const PORT = 4199;
const BASE = `http://localhost:${PORT}/games/catch-the-booster/`;
const OUT = 'shots';
const VIDEO_TMP = join(OUT, '.video-tmp');
/** Upper bound for the gameplay video; it stops earlier, a little after the debrief shows. */
const VIDEO_MAX_SECONDS = Number(process.env.CAPTURE_SECONDS ?? 40);

const GL_ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];

/** A device descriptor as browser.newContext() options (it has no browser-type field). */
function contextOptions(d) {
  const o = { ...d };
  delete o.defaultBrowserType;
  return o;
}

const PROFILES = [
  { name: 'desktop', use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
  { name: 'iphone', use: contextOptions(devices['iPhone 15']) },
  { name: 'pixel', use: contextOptions(devices['Pixel 7']) },
];

/** Still frames from the deterministic `still=1` hooks (seed 1 Cadet flight, autopilot). */
const STILLS = [
  ['menu', 'still=1&seed=1&quality=medium'],
  ['ignition-13', 'still=1&tier=cadet&seed=1&at=1.5&quality=medium'],
  ['stepdown-3', 'still=1&tier=cadet&seed=1&at=6&quality=medium'],
  ['divert', 'still=1&tier=cadet&seed=1&at=14&quality=medium'],
  ['hover', 'still=1&tier=cadet&seed=1&at=23&quality=medium'],
  ['arms-closing', 'still=1&tier=cadet&seed=1&at=28&quality=high'],
  ['catch', 'still=1&tier=cadet&seed=1&at=32.5&quality=high'],
  ['debrief', 'still=1&tier=cadet&seed=1&debrief=1&quality=medium'],
];

function log(msg) {
  console.log(`[capture] ${msg}`);
}

function startPreview() {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(d));
  return child;
}

function stopPreview(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // The shell wraps vite: end that process tree by its id.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

async function waitForServer(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`preview did not start at ${url}`);
}

// Page-side checks read the game's test state from globalThis.__catch.
async function waitReady(page) {
  await page.waitForFunction(() => globalThis.__catch?.ready === true, undefined, { timeout: 60_000 });
}

async function waitPhase(page, test, ms) {
  await page.waitForFunction(test, undefined, { timeout: ms, polling: 250 });
}

async function startTier(page, tier) {
  await page.getByTestId(`tier-${tier}`).click();
  await page.getByTestId('start-btn').click();
  await waitPhase(page, () => !!globalThis.__catch && globalThis.__catch.phase !== 'menu', 15_000);
}

async function shot(page, profile, name) {
  const file = join(OUT, `${profile}-${name}.png`);
  await page.screenshot({ path: file });
  log(`saved ${file}`);
}

async function captureStills(browser, profile) {
  const ctx = await browser.newContext({ ...profile.use, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  for (const [name, q] of STILLS) {
    await page.goto(`${BASE}?${q}`);
    await waitReady(page);
    await page.waitForTimeout(400);
    await shot(page, profile.name, name);
  }

  // Splashdown: a Pilot run where nobody lights the engines ends in a soft splashdown.
  try {
    await page.goto(`${BASE}?test=1&seed=4&timescale=4&quality=medium`);
    await waitReady(page);
    await startTier(page, 'pilot');
    await waitPhase(page, () => globalThis.__catch?.phase === 'splashdown', 90_000);
    await page.waitForTimeout(700);
    await shot(page, profile.name, 'splashdown');
  } catch (e) {
    log(`${profile.name}: splashdown shot skipped (${e instanceof Error ? e.message.split('\n')[0] : e})`);
  }

  // Replay split screen: fly a fast autopilot catch, open the replay, press Split.
  try {
    await page.goto(`${BASE}?autopilot=1&timescale=8&seed=3&quality=medium`);
    await waitReady(page);
    await startTier(page, 'cadet');
    await page.getByTestId('debrief').waitFor({ state: 'visible', timeout: 90_000 });
    await page.getByTestId('replay-btn').click();
    await page.getByTestId('replay-split').click();
    await waitPhase(page, () => globalThis.__catch?.split === true, 15_000);
    await page.waitForTimeout(1500);
    await shot(page, profile.name, 'replay-split');
  } catch (e) {
    log(`${profile.name}: replay split shot skipped (${e instanceof Error ? e.message.split('\n')[0] : e})`);
  }
  await ctx.close();
}

async function captureVideo(browser) {
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  const size = { width: 1280, height: 720 };
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, serviceWorkers: 'block', recordVideo: { dir: VIDEO_TMP, size } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?autopilot=1&tier=cadet&seed=1&quality=medium`);
  await waitReady(page);
  await page.waitForTimeout(1200); // a beat on the hero menu
  await startTier(page, 'cadet');
  const t0 = Date.now();
  try {
    await page.getByTestId('debrief').waitFor({ state: 'visible', timeout: VIDEO_MAX_SECONDS * 1000 });
    await page.waitForTimeout(2500); // the score counts up and the medal lands
  } catch {
    log(`no debrief within ${VIDEO_MAX_SECONDS} s (slow software GL); keeping what was recorded`);
  }
  log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)} s of gameplay`);
  const video = page.video();
  await ctx.close();
  if (video) {
    const file = join(OUT, 'gameplay.webm');
    await video.saveAs(file);
    log(`saved ${file}`);
  }
  rmSync(VIDEO_TMP, { recursive: true, force: true });
}

async function main() {
  if (!existsSync('dist/index.html')) throw new Error('dist/ is missing: run `pnpm build` first');
  mkdirSync(OUT, { recursive: true });
  const server = startPreview();
  const t0 = Date.now();
  try {
    await waitForServer(BASE, 60_000);
    const browser = await chromium.launch({ args: GL_ARGS });
    try {
      await captureVideo(browser);
      for (const p of PROFILES) await captureStills(browser, p);
    } finally {
      await browser.close();
    }
  } finally {
    stopPreview(server);
  }
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
