# Handoff: C3 game feel, UX, audio, debrief and replay

I could not run any tools this turn. All code is unverified until the operator runs the steps below.

## Operator notes from C2: what I fixed

| Note | Fix | Files |
| --- | --- | --- |
| iPhone 15: the chip row covers ALTITUDE, PROP and STOP | The Go/No-Go board is now a child of the telemetry strip. On touch screens it is a wrapped row inside the strip, under the readouts. On desktop it sits just above the strip. | `src/ui/hud.ts`, `src/ui/styles.css` |
| Tower-top camera: a dark box fills the right half | The camera moved to a boom at (-14, 155, -24), 16 m clear of the tower steel. The deck, crane housing and mast are on their own render layer (`TOWER_TOP_LAYER`). Every camera sees that layer except the tower-top lens. | `src/render/cameras.ts`, `src/render/scene.ts` |
| A light vertical line down the hull | The cause was the bright chine and raceway boxes (metal 0.9, light grey). They are now low, rounded strakes in a darker, rougher material close to the hull tone. | `src/render/scene.ts` |
| After the catch the director stays on the tower top | The director ignored the end of the flight because the sim clock stops when the run is done. Now `settling` and `caught` always cut to the beach long lens. The debrief backdrop uses the same shot. | `src/render/cameras.ts` |
| Spectators read as coloured capsules | They are now small, dark person silhouettes (body, shoulders, head) with varied sizes: adults, kids and people who sit. | `src/render/scene.ts` |
| Main menu: booster and tower are small | A new hero shot: low on the beach, about 330 m from the Catcher. It frames the booster right of centre, clear of the left rail. | `src/render/cameras.ts` (`HERO_CAM`, `ShotInput.hero`) |

I kept the operator's test infrastructure (`?scale=`, timeouts, `test.slow()` and the perf floor).

## What changed (C3)

### 1. Controls and feel

- **Remappable keys** (`src/input/mapping.ts`): a `KeyMap` per action, a Standard preset (design section 5, plus arrow keys) and a One-handed (left hand) preset. `rebind()` removes a key from other actions. GO and ignite can share a key. Menu, camera, mute and throttle-digit keys are reserved.
- **Settings → Remap keys**: pick an action, then press a key. Esc cancels. The map is saved.
- **Touch**:
  - CATCH has an outer countdown ring (time to predicted contact) and an inner hold ring (0.3 s hold to confirm). It shows the seconds left.
  - Step-down chip "R · 13 → 3".
  - DIVERT is a slide-and-hold control: slide the knob to the end, then hold for 1 s.
  - Cadet hides the throttle slider (Cadet flies the throttle for you).
  - One-handed touch layout (Settings): the stick and CATCH move to the right side.
- **Keyboard focus**: keys typed in the left menu go to the menu, not to the flight.
- **M** toggles the sound. Gamepad rumble scales with thrust (as before).

### 2. Tiers and tutorial

- **Cadet**: gentle coaching captions after GO and at the hover (yellow "coach" captions), a SLOW-MO tag in the last 20 m, and the 3-2-1 LIGHT cue.
- **Pilot / Flight Director**: a WIND cell in the strip. It has a direction arrow, the speed, 4 gust bars and a SHEAR tag.
- **Flight Director**:
  - The health board chips show ✓ / ✕ / … as well as colours.
  - A tower sensor fault shows a dashed amber banner, and the STOP readout gets a "?".
- **First-run tutorial** (`src/app/tutorial.ts`, `src/ui/tutorialView.ts`):
  - It teaches 3 ideas, one at a time: steer, light, catch. Each step waits for the player, says "Nice!", then moves on.
  - A step that the player does not do moves on after 5 s. The whole tutorial takes 19 s or less, and Skip ends it.
  - It runs on top of a frozen Cadet run, then the run flies.
  - It shows on the first Cadet start. "Practice: 20-second tutorial" in the menu runs it again.
  - URL hooks skip it. Use `?tutorial=1` to force it.

### 3. Callouts

All callouts are captions with a radio glyph and a synthesized radio blip:

- "Landing burn, we have thirteen" (or the actual count)
- "Down to three"
- "Flight Director, we are GO for catch" / "No-go, divert"
- "Arms closing"
- "CATCH!"

The captions are bold white on 78% black with an accent bar. On desktop they sit above the strip; on touch screens they sit above the thumbs. They never cover the middle of the frame.

### 4. Audio (`src/audio/audio.ts`, procedural only)

- **Roar.** 13 engines: a deep rumble plus crackle. 3 engines: a tighter band plus a low hum.
- **Distance.** A distance low-pass, and the speed-of-sound delay per camera.
- **Sonic boom.** The double crack plays about 19 s after ignition on the beach camera, and earlier on cameras nearer the booster.
- **Effects.** Grid-fin chatter, relight pops, hydraulic hiss and clunk, the settle thud, rail creak and the crowd swell.
- **Music.** A calm D major 9 pad, with a soft pulse that grows as the pins near the rails. A bright arpeggio stinger plays on the catch, and a gentle one on a splashdown.
- **Mix.** A limiter on the master output. Master volume, music on/off and mute (M) are all saved.
- **Determinism.** No `Math.random` in the mix. All noise is seeded.

### 5. Debrief (`src/ui/menu.ts`, `src/ui/graphs.ts`)

- Animated counters: 1.4 s, scaled by `timescale`. They are instant with reduced motion or in still frames.
- The medal shows as a shape and a word: ● Bronze, ◆ Silver, ★ Gold, ◎ Bullseye.
- The best score per tier is saved with its medal in `g499:catch:best:<tier>`. The main menu shows the bests.
- One specific tip.
- Graphs on a canvas: altitude (solid line), speed (dashed line) and an engines-lit band, with LIGHT and CATCH marks.
- A splashdown shows an illustration of the floating booster and the recovery boat.

### 6. Replay

- **Timeline** (`src/sim/timeline.ts`, pure): the debrief re-flies seed + tier + the recorded input log and keeps 30 frames per sim second. The graphs use the same data.
- **Clock** (`src/app/scrubber.ts`): play/pause, 0.5x / 1x / 2x and seek. The split window covers the last 15 s.
- **Replay bar** (`src/ui/replaybar.ts`): play, scrubber, time, speed, "⊞ Split 15 s", camera and exit.
- **Split view**: a 2x2 view of four synced cameras (beach, tower top, chase, wide) through `View.renderSplit`.
- **Captions and sounds**: they play again as the clock passes each event.
- **End**: at the end of the replay, the debrief opens again.

### 7. Accessibility

- Reduced motion: the setting OR the media query. A live change of the media query applies at once.
- Colour-independent cues: chip glyphs, STOP ▲/◆/▼, a striped low-propellant bar, a thick outline on failed engines, and medal shapes.
- Phone text: 16 px or more in the menu, captions, tutorial and debrief.
- Focus: `:focus-visible` outlines. Esc moves the focus into the pause menu. The closed drawer is `inert`.
- ARIA labels on the controls. Pause on `visibilitychange` (the replay pauses too).
- A "Real facts" card in the left menu with 3 questions. The first is "Why catch instead of legs?".

### 8. Polish

- Loader: static markup and CSS in `index.html`, painted before any script runs. It fades after the first frame. There is no inline script.
- A short dip to black between the menu, the flight and the replay. Reduced motion turns it off.
- Rail sections rise in. The medal pops.

### Tests added

| File | What it covers | Tests |
| --- | --- | --- |
| `tests/unit/keymap.test.ts` | presets, one-handed, rebind (property: no key on two actions), reserved keys, sanitize, labels | 12 |
| `tests/unit/tutorial.test.ts` | step order, held steer, timeouts, skip, ≤ 20 s (property) | 8 |
| `tests/unit/replayer.test.ts` | clock speeds, end once, pause, split window, seek bounds (property), pointer math, time format; timeline determinism (autopilot, and a hand-flown Pilot run replays bit-identically), interpolation, graph series | 10 |
| `tests/unit/storage.test.ts` | best per tier, medals, old records, junk, a throwing store, settings round-trip and repair | 8 |
| `tests/unit/render.test.ts` (+4) | caught → beach, tower-top clearance, layer visibility, hero framing | +4 |
| `tests/e2e/play.spec.ts` (+3) | debrief counters, graphs, best, beach shot after the catch; replay controls (pause, scrub, speed, split); tutorial by keyboard; skip | +3 |
| `tests/e2e/ux.spec.ts` (new) | board vs ALTITUDE / STOP on every project; M mute + facts card; keyboard menu navigation; key remap persists; reduced-motion toggle | 5 |

## Commands for the operator (in order)

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. Run the e2e suite without the visual tests and save the output:

   ```sh
   pnpm exec playwright test --grep-invert visual > .operator/e2e.txt 2>&1
   ```

   Send me the summary and any failures.
6. Make review screenshots and send them to me. They are for review only, so do not commit them.
   - Projects: desktop chromium, `iPhone 15` and `Pixel 7`.
   - Queries: `still=1&seed=1` (hero menu), `still=1&tier=fd&seed=2&at=10` (board and wind), `still=1&tier=cadet&seed=1&at=20&quality=medium` (tower-top area), and `still=1&tier=cadet&seed=1&debrief=1` (graphs, medal, beach shot).
   - Also one desktop frame on the tower-top camera: open `test=1&seed=1&tier=cadet&quality=high`, start Cadet, pause at about +22 s and pick "Tower top".
7. Regenerate the visual baselines. All three change (hero menu, HUD, debrief). Do this only when step 5 is green and I approve the step 6 images:

   ```sh
   pnpm exec playwright test visual --update-snapshots
   ```

   CAUTION: this step overwrites the committed baselines. Look at every new image before you commit.
8. `pnpm ci:local`
9. Commit and push.

## Suggested commit messages

1. `fix(render): tower-top lens clear of the tower (boom + hidden top layer), toned-down hull strakes, caught shot on the beach long lens, silhouette crowd, low hero shot for the menu`
2. `feat(ux): remappable keys + one-handed presets, CATCH countdown/hold ring, DIVERT slide-hold, wind/shear and sensor-fault HUD, board folded into the strip, Cadet tutorial, coaching captions`
3. `feat(audio): layered 13/3 roar with crackle, fin chatter, timed sonic boom, adaptive music bed and stingers, volume and music settings`
4. `feat(debrief,replay): animated score, medals, per-tier bests, flight graphs, splashdown art; deterministic replay timeline with scrubber, speeds and 2x2 synced cams`
5. `test: keymap, tutorial, replay clock/timeline, storage, director/camera units; replay, tutorial and UX e2e`

One commit with all of them is also fine.

## Known open issues and risks

- **Unverified compile.** I read every changed file again for strict-TS problems. The most likely failures:
  - Optional DOM APIs (`MediaQueryList.addEventListener`).
  - Playwright `fill()` on `input[type=range]`.
- **Replay timing in software GL.** The replay test needs about 1 s of real time at 0.5x × timescale 8 in the split window. If it is flaky, tell me the fps.
- **Firefox Tab order.** The keyboard-menu test runs on chromium and firefox. Firefox on Windows tabs to buttons by default. If it fails, I will limit the test to chromium.
- **Tower top.** One lattice column of the tower can still show at the right edge, about 20 m away. I need a screenshot to judge it.
- **Hull line.** If the line is still visible, send a close tower-top frame. The next suspect is the normal-map seam at u = 0.
- **Draw calls.** The Low tier gets 2 more meshes (the strakes and the tower top). The draw-call budget in `perf.spec.ts` is < 150.
- **Not done.** Gamepad navigation of the left menu, a two-finger twist for roll, and a swipe on the video bar for cameras.
- **Speech.** `speechSynthesis` stays unused (OFF), so no cloud voices.
