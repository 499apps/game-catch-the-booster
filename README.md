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

The first e2e run has no screenshot baselines. Make them once with `pnpm exec playwright test visual --update-snapshots`, then commit `tests/e2e/visual.spec.ts-snapshots/`.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Tilt / translate | W A S D or arrows | Left stick | Left stick pad |
| Throttle | Shift / Ctrl (hold), or 1-9 | RT / LT | Right slider (not in Cadet) |
| Roll (Flight Director) | Q / E | Right stick X | - |
| Light the engines | Enter or I | X or Start | LIGHT button (3-2-1 cue in Cadet) |
| Step down 13 to 3 | R | RB | R · 13 → 3 chip |
| Close the arms | Space | A | CATCH button: hold 0.3 s until the inner ring fills. The outer ring counts down to contact. |
| GO / NO-GO (Flight Director) | Enter / hold X for 1 s | Start / hold B | GO / slide and hold DIVERT |
| Camera | C (next), V (auto), Numpad 1–5 (pick; the digit row sets the throttle) | Y or D-pad | Cameras list in the menu |
| Sound on / off | M | - | Settings in the menu |
| Pause and menu | Esc or P | View / Back | ☰ button (left edge) |
| Replay | Space or K play / pause, ← → seek 2 s, S split view, , . speed | - | Replay bar |

Settings (left menu) has a one-handed key preset, key remapping, a one-handed touch layout, master volume, music, reduced motion and "Clear my data". Gamepad rumble follows the engine thrust. The first Cadet run starts with a 20-second tutorial (skippable; "Practice" in the menu runs it again).

## Test hooks

These URL parameters are for tests. They do no harm in production. `window.__catch` exists only when one of them is present.

| Parameter | Effect |
| --- | --- |
| `?autopilot=1` | The deterministic autopilot flies the run. |
| `?timescale=4` | Run the sim 4 times faster (0.1 to 16). |
| `?seed=N` | Use seed N for every run. |
| `?tier=cadet\|pilot\|fd` | Preselect a tier. |
| `?still=1` | Draw one deterministic, paused frame (main menu). Add `&at=20` for an in-flight frame 20 s after ignition, or `&debrief=1` for the debrief. |
| `?test=1` | Expose `window.__catch` only. |
| `?tutorial=1` | Show the Cadet tutorial even with other hooks (hooks skip it by default). |
| `?quality=low\|medium\|high\|auto`, `?scale=0.5` | Force a quality tier; render at a lower scale (tests on software GL). |

## Layout

- `src/sim/`: pure TypeScript simulation (fixed 120 Hz, seeded, deterministic). No three.js or DOM.
- `src/sim/autopilot.ts`: deterministic guidance. It is used by Cadet assist, the ghost path, the tests and `?autopilot=1`.
- `src/sim/predictor.ts`: stop height, impact point and predicted pin contact.
- `src/render/`, `src/audio/`, `src/input/`, `src/ui/`: game client.
- `tests/unit/`: Vitest. `tests/e2e/`: Playwright.
- `scripts/`: cross-platform node helpers (icons, service worker, local CI).

## Licence

MIT. See `LICENSE` and `LICENSES.md`.
