import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE = `http://localhost:${PORT}/games/catch-the-booster/`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  workers: '50%',
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },
  use: {
    baseURL: BASE,
    trace: 'off',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: BASE,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone-15', use: { ...devices['iPhone 15'] } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
  ],
});
