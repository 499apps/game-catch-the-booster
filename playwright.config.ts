import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE = `http://localhost:${PORT}/games/catch-the-booster/`;

// Headless Chromium needs SwiftShader allowed explicitly for WebGL (no GPU in CI-like runs).
const chromiumGL = {
  launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
};

// Headless Firefox on a GPU-less Windows host composites with software WebRender (SWGL).
// Many parallel software-GL windows exhaust it ("RenderCompositorSWGL failed mapping
// default framebuffer"), so Firefox gets fewer workers and WebGL without the
// performance-caveat refusal.
const firefoxGL = {
  launchOptions: {
    firefoxUserPrefs: {
      'webgl.force-enabled': true,
      'webgl.disable-fail-if-major-performance-caveat': true,
      'gfx.canvas.accelerated': false,
      'media.autoplay.block-webaudio': false,
    },
  },
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Software WebGL (SwiftShader/SWGL) is CPU-bound: more than ~4 concurrent pages starve each other.
  workers: Number(process.env.PW_WORKERS ?? 4),
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },
  use: {
    baseURL: BASE,
    trace: 'off',
    serviceWorkers: 'allow',
    // Software WebGL under parallel load can stall a page for seconds per frame (C2 shaders):
    // generous action/navigation timeouts avoid false failures without hiding real hangs.
    navigationTimeout: 40_000,
    actionTimeout: 20_000,
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: BASE,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromiumGL } },
    { name: 'firefox', workers: 2, use: { ...devices['Desktop Firefox'], ...firefoxGL } },
    { name: 'webkit', workers: 3, use: { ...devices['Desktop Safari'] } },
    { name: 'iphone-15', workers: 3, use: { ...devices['iPhone 15'] } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'], ...chromiumGL } },
  ],
});
