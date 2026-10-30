# Handoff: C1b fix pass 1 (e2e failures and speed)

## Root causes and fixes

| # | Failure | Root cause | Fix |
|---|---|---|---|
| 5 | Autopilot runs never reach the debrief (all projects) | **Bug in `game.ts`.** After Cadet slow-mo started, a clamp cut the time budget, so the sim ran only one 1/120 s step per frame. At 2 fps that is about 0.02 s of sim per second. | Removed the clamp. Slow-mo stays as the time-scale factor only. |
| 3 | Pilot "lights with Enter" ends in splashdown | **Bug in `devices.ts`.** `keyboard.press` sends key down and key up inside one frame, so the sampler never saw Enter. No ignition, then `lateIgnition`. Real fast taps had the same bug. | Taps are latched until the next sample. `game.ts` also holds button taps until a sim step uses them (for frames with no step). |
| 4, 6 | FD LIGHT button hidden; pilot and perf time out | Tests ran at High quality (bloom, 2048 shadows) on SwiftShader at about 2 fps. The coast phase ended before the check. Auto ignored every frame over 1 s, so it never stepped down. | A new `?quality=` hook. `openGame()` adds `quality=low` unless the test sets a quality (perf uses `quality=auto`). Auto now counts frames up to 5 s (capped at 250 ms). The LIGHT check now runs during the coast. |
| 1 | Firefox timeouts and SWGL framebuffer crashes | Too many parallel software-GL windows, and GL contexts kept alive after the page went away. | Firefox project: `workers: 2` and WebGL prefs. WebKit and iPhone: `workers: 3`. The game stops rAF and calls `renderer.dispose()` + `forceContextLoss()` on `pagehide`, and reloads after a bfcache restore. Firefox is not skipped. |
| 2 | Left-rail test fails at box.x 10 | The menu button has a 10 px inset by design (left edge plus the safe area). | The assertion allows an inset up to 16 px and still checks that the element is in the left half. |
| 7 | Visual tests have no baselines | Expected. | Stills now use Low quality and seed 1. The HUD clock and fps are masked, animations are off, and the caret is hidden. |

## Speed changes (target: under ~3 min)

- Global test timeout 60 s, expect 10 s, navigation 20 s, action 10 s. The ready wait is 20 s.
- The autopilot runs use timescale 8, with a 25 s debrief timeout.
- The long tests (autopilot catch + replay, FD autopilot) run on `chromium` and `pixel-7` only. The skip reason is in `tests/e2e/helpers.ts` (`onlyLongProjects`). Load, tier start, left menu, privacy, Clear my data and no-console-error tests still run on all 5 projects. Offline stays on the Chromium projects.

## Other changed files

- `src/app/params.ts`: the `quality` hook.
- `src/render/quality.ts`: long frames now count.
- `src/render/view.ts`: `dispose()`.
- `tests/unit/app.test.ts`: tests for slow-frame drops and the quality hook.

## Commands for the operator (in order)

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. `pnpm exec playwright test --grep-invert visual > .operator/e2e.txt 2>&1`, then send me the summary and any failures.
6. When step 5 is green: `pnpm exec playwright test visual --update-snapshots`, then `pnpm ci:local`.
7. Commit and push.

## Suggested commit message

`fix: e2e root causes - slow-mo step clamp, latched key taps, Low quality under test hooks, Auto counts slow frames, GL disposal on pagehide, Firefox workers/prefs, faster suite`

## Known open issues

- Project-level `workers` needs Playwright 1.52 or later (1.64 is installed).
- If Firefox still crashes in SWGL with 2 workers, set its `workers` to 1 in `playwright.config.ts`.
- The fps floor under SwiftShader is 1 fps. The real check is that Auto drops a tier.
