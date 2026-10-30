# Catch the Booster

A privacy-first, offline-capable three.js game. Guide the returning Heron-class booster into the two arms of the Catcher tower.

**dist/ is the deployable output for 499apps.com/games/catch-the-booster/**

## Privacy

- No analytics, cookies, accounts, ads, external links or third-party requests.
- Storage is `localStorage` only, with keys that start with `g499:catch:`. Settings has a "Clear my data" button.
- A service worker precaches the game files so the game runs offline.

## Requirements

- Node 24 and pnpm 10.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install the dependencies. |
| `pnpm dev` | Start the dev server. |
| `pnpm build` | Make the icons, build to `dist/`, then write `dist/sw.js` with the precache list. |
| `pnpm preview` | Serve `dist/` at `http://localhost:4173/games/catch-the-booster/`. |
| `pnpm typecheck` | Run the TypeScript compiler in strict mode. |
| `pnpm lint` | Run ESLint. |
| `pnpm test` | Run the Vitest unit, property and golden-trajectory tests. |
| `pnpm test:e2e` | Run the Playwright tests against `vite preview`. |
| `pnpm ci:local` | Run typecheck, lint and unit tests in parallel, then build, then e2e. Prints a time summary. |

Install the Playwright browsers once:

```sh
pnpm exec playwright install chromium firefox webkit
```

## Layout

- `src/sim/`: pure TypeScript simulation (fixed 120 Hz, seeded, deterministic). No three.js or DOM.
- `src/sim/autopilot.ts`: deterministic guidance. It is used by Cadet assist, the ghost path, the tests and `?autopilot=1`.
- `src/sim/predictor.ts`: stop height, impact point and predicted pin contact.
- `src/render/`, `src/audio/`, `src/input/`, `src/ui/`: game client.
- `tests/unit/`: Vitest. `tests/e2e/`: Playwright.
- `scripts/`: cross-platform node helpers (icons, service worker, local CI).

## Licence

MIT. See `LICENSE` and `LICENSES.md`.
