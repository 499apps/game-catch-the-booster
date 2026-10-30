# Handoff: C5 gate-review fix pass

I could not run any tools this turn. All code is unverified until the operator runs the steps below.

I could not read the gate report (`C:\Users\a\claude-tasks\catch\gate1.result.md`): the session had no read permission for that folder. I worked from the 10-item list in the brief.

## What I changed

| # | Item | Fix | Files |
| --- | --- | --- | --- |
| 1 | Camera-relative steering | The game turns the raw stick by the yaw of the active camera, before the shaper. Screen right is right on screen. Screen up is into the scene, away from the lens. On the tower-top lens, "down" moves toward the tower. The recorder logs the turned (world) values, so a replay is still seed + input log. Across a cut, the yaw blends over 0.5 s. The director holds its shot from +13 s to +23 s while the player steers (stick used in the last 1.2 s). | `src/render/cameras.ts` (`stickYawFrom`, `stickYawOf`, `AutoDirector.STEER_HOLD`), `src/input/mapping.ts` (`rotateStick`, `worldToScreen`, `lerpAngle`), `src/input/devices.ts` (`sample(dt, stickYaw)`), `src/app/game.ts` |
| 2 | Cadet divert flies itself | The Cadet stick is now a trim of up to 3.5 m/s on top of the reference divert velocity. It does not replace it. The hands-off divert aims at a small seeded offset (1.0 to 2.2 m), so the booster lands inside the 3 m window, and the stick earns the Bullseye. At the divert start, the coach says "Steer onto the ring!", and a large screen-space arrow points to the ring. The old coach line came 3.4 s after GO, before the stick had any effect. I removed it. | `src/sim/autopilot.ts` (`trim`, `cadetAimOffset`), `src/sim/control.ts`, `src/app/game.ts`, `src/ui/hud.ts` |
| 3 | Visible target ring | The ring radius is the hull radius plus the pin window (7.5 m in Cadet, 6 m in Pilot and FD). It has no depth test and render order 20, so it always shows around the hull. It shows in every tier while the engines burn. Its colour follows the pin tolerance. The HUD has a new PIN chip: the distance in m, an arrow that shows the way to push the stick, and a colour and a glyph (✓ ! ✕). | `src/render/scene.ts`, `src/app/game.ts`, `src/ui/hud.ts` |
| 4 | Ignition pre-roll | Every run starts 3 s earlier on the same coast (`PREROLL`), about 2.6 km up. The start state comes from a backward integration of the old start state, so the booster passes the old start point and lights in the same state as before. A large "3… 2… 1… LIGHT" cue shows in every tier. A Cadet tap before the mark shows "ARMED ✓", and the auto ignition lights on the mark. The ignition score now falls to 0 at 600 m (it was 160 m). 1 s early or late (about 300 m) still gives about 50 of 100. | `src/sim/world.ts` (`PREROLL`, `coastBackward`), `src/sim/scoring.ts`, `src/sim/control.ts`, `src/ui/hud.ts`, `src/app/game.ts` |
| 5 | Phone HUD | On phones the strip is a grid of 2 rows, plus 1 row for the board. Row 1: engines, altitude, V/S, STOP and clock. Row 2: PIN and TILT chips and wind. I estimate the height at 12 to 15% of a 393x852 screen. The V/S chip is coloured against the 2 m/s contact limit near the arms. Cadet folds the board into one GO chip. The PIN, TILT and V/S chips show in all tiers, with glyphs. | `src/ui/hud.ts`, `src/ui/styles.css` |
| 6 | Lens streak and flare | The streak and the ghosts come only from the ignition flash. The streak is 4× narrower. The ghosts are masked out around the tower top. The wide and beach lenses flare only at the ignition moment. | `src/render/post.ts`, `src/render/view.ts` |
| 7 | Plume and hull look | 13 engines: a dimmer core, a saturated yellow-orange edge, 40% less bloom and a stronger exposure pump. 3 engines: a dimmer shell, and the shock diamonds are about 1.8× stronger. After cutoff, the vent vapour is dim grey with a low alpha (it was near-white). The tower steel is now a cool, neutral grey with no rust tint. | `src/render/scene.ts`, `src/render/view.ts`, `src/render/materials.ts` |
| 8 | Pilot fairness | In the burn, the Pilot stick sets the lean angle: full stick is 10°. A damping lean opposes the sideways speed (time constant 1.6 s on 13 engines, 2.5 s on 3 engines). A hands-off booster stops sliding. Full stick on 3 engines settles at about 4.5 m/s. While coasting, the stick still nudges the attitude rate. New test: a "simple human" bot. It reads the visible pin offset, V/S and cues 250 ms late, with hand noise. It must catch on at least 3 of 5 seeds. | `src/sim/control.ts` (`pilotLean`), `tests/unit/assist.test.ts` |
| 9 | Tutorial | Steps wait for the player. After 6 s the card shows a hint and "Skip step". "Skip tutorial" is always there. In the steer step, a practice ("ghost") booster flies with the real Cadet sim, starting just after the divert. The stick moves it, and it loops back before it reaches the arms. The frozen run behind it does not step. Cards and Cadet coach lines are spoken through `speechSynthesis`, with local voices only (`localService`). New setting: "Voice coach (Cadet)", on by default. The voice is off when muted and under the test hooks. | `src/app/tutorial.ts`, `src/ui/tutorialView.ts`, `src/audio/voice.ts` (new), `src/app/storage.ts`, `src/ui/menu.ts`, `src/app/game.ts` |
| 10 | Small fixes | The touch layout uses only `(pointer: coarse)`. I removed `maximum-scale` and `user-scalable=no`; the canvas and `#app` keep `touch-action: none`. The smallest label is now 12 px, including the graph text and the engine count. The bottom split-screen labels sit above the replay bar. Cadet pin alignment scales to the tier window (3 m), so a Cadet catch inside the window always scores. | `index.html`, `src/ui/touch.ts`, `src/ui/styles.css`, `src/ui/graphs.ts`, `src/sim/scoring.ts`, `src/sim/world.ts` |

## Test expectations that changed, and why

- `scoring.test.ts`:
  - Ignition: 100 at 0 m, about 93 at 40 m, 50 at 300 m, 0 at 600 m. The old expectation (75 at 40 m, 0 at 160 m) gave 0 for a 0.5 s error.
  - New alignment test for the tier window.
- `tutorial.test.ts`:
  - "A step moves on by itself" became "a step waits for the player".
  - The "never more than 20 s" property became "a player who does each step finishes quickly".
  - New tests for "Skip step" and for the spoken lines.
- `input.test.ts`: in the burn, the Pilot command is now `tilt` (lean). While coasting it is still `rate`. New tests for the stick rotation.
- `golden.test.ts`: the timeline is not changed (all times are after ignition). New test: every tier starts 2.4 to 3.1 km up, and lights more than `PREROLL` seconds into the run.
- `render.test.ts`: new tests for camera-relative steering on all 5 cameras, the tower-top "toward the tower" rule, and the director hold from 13 s to 23 s.
- `storage.test.ts`: the settings round-trip includes `voice`, and the default is on.
- New `assist.test.ts`:
  - Cadet hands-off is inside the window on at least 4 of 6 seeds.
  - Steering on the pin offset raises the alignment points.
  - Pilot lean command.
  - The Pilot human bot catches on at least 3 of 5 seeds.

## C5b: fixes after the first test run (2 failures in `assist.test.ts`)

- **Pilot bot: NO-GO on every seed.** Most likely cause: the Go/No-Go "track" check. It measured the pins from the autopilot's hold point, 30 m offshore, with a 50 m limit. A hand-flown booster more than 20 m past the tower, or more than 80 m out, was called NO-GO, although the arms were still in reach. A human hits this too. The check now measures reach from the arms (`TRACK_REACH` = 80 m), so the autopilot hold point still passes. New unit test for it. The bot report now prints the board at the poll: the red items, reach, pin position, descent speed, height, propellant (have and need), engines and phase. If a seed still fails, that line names the cause.
- **Cadet seed 4: a steered run failed.** The test bot held stick toward the ring from the divert start. The trim had about 12 m of authority, so the booster overshot. This is also a game issue: the arrow invites that input. Fix in the sim (`cadetTrimLimit`):
  - The trim fades out as the booster gets 2.5 m ahead of the hands-off path in the stick direction. The aim error is at most 2.2 m, so steering toward the ring reaches the centre but cannot leave the 3 m window.
  - The trim fades out over the last 8 m of pin height, so a held stick cannot cause a sideways slide at contact.
  - New test: full stick along the arrow from divert to contact catches on 8 of 8 seeds.
  - The score test now uses a calm bot: it waits until the pins are within 6 m, nudges with a 0.3 m dead band, in 0.1 steps.

## C5c: second fix pass (3 failures in `assist.test.ts`)

- **Cadet: the stick no longer adds velocity.** It moves the divert aim point (`World.aim`). The autopilot always flies the booster.
  - The aim moves at up to 1 m/s and stays within 2.2 m of the centre (window - 0.8 m). It freezes below 8 m of pin height, so the booster settles before contact.
  - No stick input can make a Cadet slide or miss. The ghost path ends at the aim point, so the player steers that end onto the ring.
  - Hands-off is not changed: the aim starts at the seeded offset.
  - Tests:
    - Steering the aim to the centre scores at least the hands-off score on every seed.
    - Full stick toward the ring catches on 8 of 8 seeds. Full stick away from it also catches on 8 of 8.
- **Pilot: the booster passed the tower (pin x = -44 to -84 m at the poll).**
  - Cause: on 13 engines, the damping law (time constant 1.6 s) stopped braking hard at about 80 m/s. Then the speed decayed slowly. When the player stepped down on time (about +3 s), the booster still slid toward the tower. 3 engines (12° lean limit) could not stop it before it passed the arms.
  - Fix: on 13 engines the flight computer now flies the guidance braking lean, and the stick adds only a 3° bias. On 3 engines, the lean-angle stick with damping stays as before.
  - The bot now presses CATCH when the button shows, as the tip says. Its old trigger came too late for its own V/S profile, so the arms were still closing at contact ("late").
  - The report now also prints the step-down, the state at +13 s and the CATCH press.

## C5d: Pilot fairness (0 of 5): game fixes first, then the bot

- **Pilot-induced oscillation.** The HUD PIN chip and the ring colour showed the raw pins, 39 m above the CoM. A few degrees of lean swing them by metres, so a player who steers on them amplifies the swing. Seed 3's 30° tilt abort at +5 s and the sign swings on the other seeds match this. The HUD now shows the upright pin offset (`uprightPinOffset`: the CoM's horizontal position, where the pins line up when the booster is upright). Scoring still uses the real pins.
- **Lean safety (`pilotLean`):**
  - On 13 engines, the lean allowed fades from 35° (descent ≥ 110 m/s) to 5° (≤ 70 m/s), so a step-down on the cue starts upright.
  - Step-down interlock: the flight computer refuses a step-down while the tilt is more than 15°.
  - On 3 engines, the lean target never exceeds 12° (the abort is 30°). Above 20° of tilt the stick is locked out until the booster is upright.
- **Final approach hold.** Below 30 m of pin height, the velocity hold tightens (time constant 2.5 s → 1.8 s), and full stick falls from 10° to 5°. A centred stick nulls the sideways speed.
- **Bot.**
  - It steers on the HUD value (the upright offset) plus a lead (the sideways speed × 1.5 s), with gain 0.1, 250 ms late, with noise.
  - It presses CATCH when the button shows.
- **New tests:**
  - The lean target stays at or below 12°.
  - A large tilt locks out the stick.
  - Step-down is refused while leaning hard.
  - A held stick on 3 engines settles with no more than 10% overshoot.

## C5e: Pilot on 3 engines (from the operator's probe)

1. **Stick authority.** The 3-engine limit is now 15°. The stick owns half of it (7.5°). The velocity damping gets the rest, at least half. The sum never exceeds the limit, the damping can always out-pull a held stick, and the stick always changes the lean. Full stick settles at about 4 m/s (damping time constant 3 s).
2. **Step-down kick.**
   - Cause: the 13-engine lean limit faded quickly with the descent speed. The strong 13-engine attitude loop then built a rotation of about 0.5 rad/s. After the step, 3 engines could not stop it.
   - Fix: STEP now arms an interlock (`World.stepArmed`). The 13 engines go to minimum throttle and the lean goes upright. The step happens when tilt < 8° and rate < 0.05 rad/s. If the descent falls under 15 m/s, it steps at once, so the booster never climbs.
   - The speed fade is gone. The autopilot and FD still step at once through `cmd.stepDown`, so the golden and FD timelines do not change.
3. **Attitude overshoot.** The Pilot lean command on 3 engines moves at 0.1 rad/s, not 0.2. With feed-forward, the faster command left a rotation that 0.3 to 0.5 rad/s² of authority could not stop.
4. **Position at step-down.** The autopilot is not at the 30 m hold point at the step-down. It is at about 67 m (`X_STEPDOWN`), and it reaches the hold point at +13 s on 3 engines. The probe was at 90 m because it stepped at +3.2 s, 0.8 s before the plan. The 13-engine lean is the autopilot's reference lean, so I did not move the start point. That would change the golden tests.
- **Regression tests** (from the probe, Pilot seed 5):
  - Stick +1 vs 0 vs -1: at least 15 m apart after 8 s.
  - |tilt| < 0.2 in the 2 s after the step-down.
  - No tilt above 110% of the command.
  - The speed settles with no more than 10% overshoot.
  - The interlock arms, waits and steps.
- **Operator:** delete `tests/unit/zz-probe.test.ts`. I had no permission to delete files this turn.

## C5f: quick interlock, Pilot window, symmetric stick

- **Interlock** (`World.stepArmedAt`):
  - After STEP, the 13 engines hold the rotation rate at zero (rate mode), not the lean. The player's throttle stays.
  - The step happens when tilt < 10° and rate < 0.1 rad/s, or after 1.0 s, or at once if the descent falls under 35 m/s.
  - Before this fix, every seed stepped only at the 15 m/s floor. The 3-engine descent then took about 45 s and nearly used up the propellant.
- **Pilot pin window: 2.5 m** (the rail guides). Flight Director stays at 1.5 m and Cadet at 3 m. Alignment points scale to the window, so precision still pays, and a steady 2 m approach is a catch.
- **Final approach:** the hold time constant is 2.2 s and the fine stick is 6°. Full stick still moves the booster about 2.4 m/s, so the last 2 m close in a few seconds. Before, it was about 1.2 m/s, too slow for a player who was 2 m off at 28 m.
- **Fixed shares on 3 engines:** the stick gets 45% of the 15° limit and the damping 55%. The stick's effect does not depend on how hard the damping brakes, so +1 and -1 are near-symmetric about hands-off. The damping can still out-pull a held stick, so the slide settles.
- **Tests:**
  - Spread from +1 to -1 is at least 25 m, each side more than 8 m, and roughly symmetric.
  - A held stick reaches more than 2 m/s with no overshoot.
  - The interlock steps at once when settled and after 1 s at most when not.
  - The envelope boundary test now covers FD 1.5 m, Pilot 2.5 m and Cadet 3 m.
  - The Pilot bot (V/S braking profile at 1.2 m/s²) checks ignition to contact at 26 to 38 s on caught runs. Its report shows the real pins, the CoM and the sideways speed at the end of the run.

## C5g: Pilot final approach and step-down

- **Final approach (pins < 30 m, blended over 30-40 m): station-keeping.**
  - The stick commands a lateral velocity: at most 1.5 m/s, fading to 0.6 m/s at the rails (the contact limit is 1 m/s).
  - A firm hold tracks it (time constant 1.1 s).
  - The hold lean is at most 6°, fading to 1.5° at the rails (the contact limit is 2°).
  - So a hand-flown approach cannot arrive sliding or tilted. In c5f, the stronger stick and softer hold did the opposite and oscillated.
- **Damping uses the centre of percussion** (CoM velocity + 11.7 m × tilt rate), as the autopilot does. The gimbal side force first moves the CoM the wrong way. A firm hold on the CoM velocity chases that (a right-half-plane zero near 1 rad/s) and oscillates.
- **The 13-to-3 kick.**
  - Cause: when the step came early (about +3.2 s), the 13-engine guidance lean (about ±0.1 to 0.3) carried over. 3-engine thrust is high at that moment, and the slow 0.1 rad/s slew took about 3 s to take the lean back. Meanwhile the booster flew sideways on it, at -8 to -16 m/s.
  - Fix:
    - On 13 engines, the allowed lean fades from 35° to 2° as the fall slows from 120 to 60 m/s.
    - The 13-engine command moves at most 0.3 rad/s, so no rotation remains.
    - The 3-engine slew is back to the autopilot's 0.2 rad/s.
- **Kept:** the c5f interlock (≤ 1 s, 35 m/s floor, player throttle), the 2.5 m Pilot window, the 45/55 stick and damping shares, and the timeline.
- **Thresholds, and why:**
  - Step-down: |tilt| ≤ the 3-engine lean limit + 0.02 (0.28). Full stick plus full damping may reach 15° (0.259) by design, so 0.2 tested the wrong thing.
  - Authority: the spread from +1 to -1 is at least 25 m, and each side is more than 6 m from hands-off. The response is not exactly symmetric: while the damping is at its clamp braking a drift, steering against the drift desaturates it sooner.
  - A held stick reaches more than 2 m/s in 8 s with no overshoot (about 3.5 m/s expected).

## c6: gate-2 fixes

I could not run any tools. All of c6 is unverified until the operator runs the checks.

| # | Item | Fix | Files |
| --- | --- | --- | --- |
| 1 | Cadet steer cue | The PIN chip and the big arrow come from the aim error (`w.aim`), so they answer the stick at once. The tone is neutral until `w.flags.hover`. The arrow says "On the ring ✓" under 0.15 m. Sim rule: the Cadet stick can only bring the aim closer to the ring centre, so a stick held the same way stops at the closest point. No input can score worse than hands-off. The tutorial text now says: push the way the yellow arrow points. | `src/app/game.ts`, `src/ui/hud.ts`, `src/sim/world.ts`, `src/ui/tutorialView.ts` |
| 2 | Camera in the divert | `wide` only from +10 to +13 s. At `T_DIVERT` the director cuts to `beach`, and `STEER_HOLD` holds only a steering lens (`beach`, `towerTop`), so the cut at +13 s still happens. | `src/render/cameras.ts` |
| 3 | No red while nominal | New pure module `src/ui/tolerance.ts`. TILT on 13 engines: neutral (the braking lean reaches ~35° by design). TILT on 3 engines above 30 m: neutral, then warn or bad against the 30° abort. PIN: neutral above 30 m. Final approach (≤ 30 m): contact limits. The ring stays teal above 30 m. | `src/ui/tolerance.ts`, `src/app/game.ts`, `src/ui/hud.ts` |
| 4 | Phone strip clipping | Grid columns sized by their content (`repeat(5, auto)`, space-between), row 2 `'tol tol tol tol wind'`, cells `min-width: max-content`, no `overflow: hidden`. Short label "ALT" in the compact strip. V/S unit and engine count hidden on phones. Ring 32 px, clock 13 px. New e2e check on iphone-15 and pixel-7: no element in the strip has scrollWidth > clientWidth + 1. | `src/ui/styles.css`, `src/ui/hud.ts`, `tests/e2e/ux.spec.ts` |
| 5 | Desktop tower-top framing | New `safeBand(aspect)`: on landscape the HUD band is at the BOTTOM (22%), on portrait at the top (30%). The safe-frame test now uses the bottom band on desktop. On landscape the tower-top lens is 120° wide and pitched down to 3° under the horizon. The ring and the pins at contact sit at about one third of the frame height (ndc ≈ -0.33), above the strip. The 40% target is not reachable with the horizon in frame. New test. | `src/render/cameras.ts`, `tests/unit/render.test.ts` |
| 6 | Flash on seeks | No ignition flash when the sim time jumps by more than 0.5 s (stills, replay seeks, capture jumps). A jump also cancels a flash still fading. The streak sideways falloff is now 9, was 2.6. | `src/render/scene.ts`, `src/render/post.ts` |
| 7 | White hull after cutoff | Hull anisotropy 0.5 → 0.2 and env reflection 1.1 → 0.95. Bloom threshold ≥ 0.97 on the beach lens (only plume and lamps bloom there). The base steam starts at 0.8 after the cutoff and fades over 6 s. On a seek the steam is set to the faded value. | `src/render/scene.ts`, `src/render/view.ts`, `src/app/game.ts` |
| 8 | Pilot bot honesty | The throttle uses only the V/S and ALT readouts: profile height = ALT - 36 m (the rails). The lever is PI (trim 0.1, Kp 0.06 per m/s, Ki 0.02), with lever noise. There is no mass or thrust table. 250 ms delay. Requires 4 of 5 seeds. I made no sim change for it. | `tests/unit/assist.test.ts` |
| 9 | Capture | New hooks `manual=1`, `stick=` and a negative `at`, and `tutorial=1` in still mode. New stills on desktop and iPhone: `cadet-cue` (-2 s), `cadet-steer` (+13.5 s, stick held), `tutorial-steer`. | `src/app/params.ts`, `src/app/game.ts`, `scripts/capture.mjs` |
| 10 | Small defects | The replay camera tag sits above the replay bar (clear of the brand). The split labels are above the bar (z 31; phones +150 px). The beach split panel aims at the booster. SLOW-MO on phones moved to the top left. The Bullseye tip names the next tier. The debrief best includes this run ("★ New best" also in still mode). | `src/ui/styles.css`, `src/render/view.ts`, `src/sim/tips.ts`, `src/app/game.ts` |

**Tests added or changed:**

- `assist.test.ts`:
  - Full stick along the HUD arrow, followed or held the first way, scores ≥ hands-off on 8 seeds.
  - The stick never moves the aim away from the centre.
  - The slam bot follows the new aim arrow.
  - The honest Pilot bot must catch on 4 of 5 seeds.
- `render.test.ts`:
  - Tolerance tones.
  - The director cut at +13 s and the hold (the hold is now on `beach`).
  - Desktop tower-top ring position.
  - `safeBand`, with the bottom band on desktop in the safe-frame test.
  - Bullseye next-tier tips.
- `ux.spec.ts`: the phone strip clipping check.

**Visual baselines change** (the HUD tones, the tower-top framing and no flash in stills). Regenerate them after the e2e run passes.

**If the Pilot 4-of-5 test fails:** the bot is now strictly HUD-only. Send me the report line. If needed, I will tune the bot gains first. If it still cannot reach 4 of 5 honestly, I will set the test back to 3 of 5 and explain why.

## c6b: tower-top framing for a high booster

On landscape, the tower-top pitch now blends with the CoM height:

- Below 170 m: the pitch is the c6 one, down until the horizon is 3° inside the top edge.
- Above 230 m: the lens looks up at the booster, which sits a third of the half-height above the frame centre.
- Between 170 m and 230 m: a smoothstep blend of the two.

So a player who picks Tower Top mid-divert still sees the booster.

## c7: gate-3 fixes

I could not run any tools. Nothing in c7 is verified.

| # | Finding | Fix | Files |
| --- | --- | --- | --- |
| 1 | Tutorial hides the steer | On touch, `#tutorial` docks under the strip and under the steer arrow (top +172 px). In the steer step it is a small card (no dots, 14-15 px text). `#captions` is hidden (`display: none`) while `.tutorial` is set. The practice camera is `beach` with the tight divert framing. | `src/ui/styles.css`, `src/app/game.ts` |
| 2 | Divert lens too far | `ShotInput.divert` (tau ≥ T_DIVERT, flying, arms not closing). The `beach` rig then frames only the booster top, the plume end and the tower top + 12 m, with a tighter margin (1.05). The booster fills about 30-35% of the frame, against about 13% before. `STEER_HOLD` is now [13, 20], so the +20 s cut to the tower top always happens. The ring is at least 24 px across on any lens (`fitRingToCamera`, main view only). | `src/render/cameras.ts`, `src/render/scene.ts`, `src/render/view.ts`, `src/app/game.ts` |
| 3 | Wrong-way push is silent | `updateCadetAim` keeps only the radial component of the stick toward the centre, capped at the centre. One key of a diagonal arrow helps, and a wrong-way push does nothing. No input can score worse than hands-off. If the stick is pushed for 0.4 s and the aim does not move, the arrow pulses and says "Other way ↺ · push along the arrow" (a glow with reduced motion). In capture, `cadet-steer` uses the new hook `stick=arrow` at +13.4 s. | `src/sim/world.ts`, `src/app/game.ts`, `src/ui/hud.ts`, `src/ui/styles.css`, `src/app/params.ts`, `scripts/capture.mjs` |
| 4 | Banner over the tower | `#steer-cue` is now a child of `#telemetry`. It sits just above the strip on desktop and just under it on touch. On phones it may wrap, and it stays within the strip width. | `src/ui/hud.ts`, `src/ui/styles.css` |
| 5 | White hull | New `HULL_TONE`: albedo 152 (was 192), roughness 0.42-0.54 (was 0.25-0.34). The brushing streaks are darker. The env reflection is 0.6 once the booster is held (was 0.95). The land steam is grey-white, not beige. A unit test checks the constants. I could not take a bloom-off frame. | `src/render/materials.ts`, `src/render/scene.ts` |
| 6 | Phones hide PROP and STOP | Pilot and FD get a "PROP 47%" chip in the wrapping tolerance group: row 2 is not changed, and the chips wrap instead of widening the grid. It is amber below 15%. The late-ignition tip now reads "before STOP reaches 0 m". | `src/ui/hud.ts`, `src/ui/styles.css`, `src/app/game.ts`, `src/sim/tips.ts` |
| 9 | Autopilot HUD mismatch | Autopilot runs set `w.aim = {0, 0}`, which is HUD-only: the autopilot ignores the aim. | `src/app/game.ts` |
| 10 | Polish | Touch camera tag: one line with an ellipsis, between the joystick and the throttle. Touch LIGHT and the 3-2-1 cue sit above the joystick. Replay tag: right side on desktop (clear of DRONE CHASE), under the strip at the top on phones (clear of the replay bar). The fps counter shows only with `fps=1`. | `src/ui/styles.css`, `src/app/params.ts` |

**Tests:**

- `assist.test.ts`: one key of a diagonal brings the aim in, and the opposite key leaves it unchanged (5 seeds). The never-worse-than-hands-off test with slam and hold still runs on the projection rule.
- `render.test.ts`:
  - The beach divert framing: the booster takes more than 28% of the height, and at least 1.8× the old framing.
  - The steer hold ends at +20 s with a cut to the tower top.
  - The hull tone constants.

**Not done:**

- The 5-person playtest (finding 7).
- A bloom-off diagnostic frame for the hull (finding 5). I fixed it from the material values. Please check `*-catch.png`.
- The clock offset between the HUD (T+ from ignition) and the replay (from the run start). I left it: it is the pre-roll by design.
- Regenerate the visual baselines only after the e2e run passes. The beach divert framing, the steer cue position, the hull tone and the phone layout all change them.

## c8: gate-4 fixes

I could not run any tools. Nothing in c8 is verified.

| # | Finding | Fix | Files |
| --- | --- | --- | --- |
| 1 | Ring off screen in the steer | The beach divert framing is now booster top, plume end and (0, RAIL_Y - 8, 0), the point just under the catch ring, in place of the tower top. The practice uses the same lens. Early in the divert (CoM 260 m) the booster is about 22% of the frame (it was about 13% with the tower base), and it grows as it comes down. New tests at 16:9 and 393x852: from +13 s to +20 s of a Cadet flight, the ring centre projects inside `safeBand` (clear of the HUD bands). | `src/render/cameras.ts`, `tests/unit/render.test.ts` |
| 2 | Tutorial card hides the booster | Steer step on touch: the lesson text ("Drag the pad the way the arrow points · 1.0 m") is in `#steer-cue`. The card shrinks to one "Skip tutorial" pill in the top-right corner. Steer step on desktop: a 300 px card docked top right. The strip readouts are dimmed in the tutorial, but the steer banner is not. | `src/app/game.ts`, `src/ui/hud.ts`, `src/ui/styles.css` |
| 5 | Tall Cadet strip on phones | Under 400 px, Cadet uses row 2 `'tol tol tol tol board'`. PIN and TILT do not wrap, and the GO chip takes the clock column, so the strip has 2 rows. | `src/ui/styles.css` |
| 6 | Camera tag on phones | Touch shows one short word: BEACH, TOWER, DRONE, ONBOARD, WIDE, PRACTICE, "X · REPLAY", SPLIT. No "· auto" and no ellipsis. | `src/app/game.ts`, `src/ui/styles.css` |
| 8 | Replay polish | On phones in split view, the tag is in `#replay-bar` ("SPLIT · SYNCED") and the camera tag is hidden. The replay time reads T-/T+ from ignition (`formatSigned`), the same clock as the HUD. | `src/ui/replaybar.ts`, `src/app/game.ts`, `src/ui/styles.css` |
| 9 | Proof stills | New hook `stick=away`. The still mode now runs the "Other way" timer. New stills on desktop and iPhone: `cadet-wrongway` (+14 s, 1 s against the arrow) and `pilot-flight` (Pilot +10 s, which shows the PROP chip). | `src/app/params.ts`, `src/app/game.ts`, `scripts/capture.mjs` |
| nice | Plumes | The 3-engine core is 2× longer (88 + 28·throttle m). The shell is 110 + 20·heat m long, with a warmer pink-orange core and edge. The 13-engine core is more orange. | `src/render/scene.ts` |

**Not done:**

- The softer stratus streaks in the sky. I did not change the sky shader.
- The land colour variation and the fin texture (findings 7 and 10).
- The playtest (finding 3).
- A catch-frame luminance test: it needs a GPU render, so it cannot run as a unit test.

**Baselines:** the beach divert framing, the tutorial layout, the plumes and the Cadet strip all change the visual baselines. Regenerate them only after the e2e run passes.

## c9: gate-5 polish (findings 2, 3, 5, 6 and 7)

I could not run node, pnpm or git (the brief did not allow it). Nothing in c9 is verified.

| # | Finding | Fix | Files |
| --- | --- | --- | --- |
| 3 | Plume renders as white dots | New pure function `plumeTone(many, heat, flash)`. Every plume colour (envelope core, edge and tail, core core and edge, nozzle glow, nozzle discs) is 1.0 or less per channel. The colours have low green and blue, so ACES keeps the hue. The shaders clamp the opacity to 1 and add `col × a` (it was `col × a²`, with `a` up to about 7 at a diamond). A diamond now moves the colour toward `uCore` and adds a little opacity. It never adds light past the uniform. The core shell between the diamonds is more opaque (`0.6 + 0.4·core`, slower fade), so the 3-engine plume is one salmon pillar. The 13-engine plume is an orange flame with a cream smoke tail. | `src/render/materials.ts`, `src/render/scene.ts` |
| 2 | Ring is an edge-on sliver on the beach lens | New pure function `ringPoseFor`. When the lens is less than 30° over the ring plane, the ring tilts toward the lens until it looks 30° open. The centre does not move. Split panels and the inset see the flat ring. | `src/render/scene.ts` |
| 5 | Sky streaks and flat land | The stratus noise has a lower frequency, wider band edges and half the contrast. A band is never darker than the sky behind it (`max(lowCol, c)`). The dry land has a gentle hue drift (rosier and greyer patches), made once at start-up. | `src/render/materials.ts`, `src/render/scene.ts` |
| 6 | Phone split replay | On touch, `#captions` is hidden in split view. The game measures how much of the bottom panels the replay bar covers. `renderSplit` shifts the frustum of the 2 bottom panels (`setViewOffset`) so the picture moves up by that height (40% of the panel at most). | `src/render/view.ts`, `src/app/game.ts`, `src/ui/styles.css` |
| 7 | Skip pill on the strip; banner on the GO chip | A `ResizeObserver` writes the strip's lower edge to `--strip-bottom`. The touch pill sits 8 px under the strip, at its right edge. In the touch tutorial, the steer banner wraps 132 px before the strip's right edge, so it does not go under the pill. On desktop, the steer banner ends 72 px before the strip centre, before the GO chip. The keyboard lesson now reads "Hold A, D, W or S the way the arrow points". | `src/app/game.ts`, `src/ui/styles.css` |

**New tests:**

- `render.test.ts`, "plume colours keep their hue": every plume colour and strength is in 0..1 for every throttle, heat and flash value. A second test checks the hues (salmon for 3 engines, orange and cream for 13).
- `render.test.ts`, "beach lens: the catch ring reads as a ring": the projected minor axis is 10 px or more at 1280x720 and at 393x852, from +13 s to +20 s of a Cadet flight. A lens high over the ring sees it flat.
- `ux.spec.ts`, "touch tutorial: the Skip pill sits under the strip": on `iphone-15` (393x852) and `pixel-7` (412x915), the pill box does not intersect the strip box, and it does not cover the steer banner.

**Not done:**

- The hue check on the plume pixels in `capture.mjs` (finding 3, optional). Look at `*-divert.png` and `*-cadet-steer.png` by eye.
- The playtest (finding 1) and the clean e2e rerun with `--workers=1` (finding 4).
- The Pixel 3-row strip (finding 9).

**Risks:**

- The plume is now dimmer per layer. If it reads too dim, raise `envIntensity` or `coreIntensity` in `plumeTone`. Keep them at 1.0 or less (the unit test checks this).
- The tilted ring no longer lies in the plane of the arms on the beach lens. It is an aid, not a part of the tower.

**Baselines:** the plume, the sky, the land, the ring and the tutorial pill change the visual baselines. Regenerate them only after the e2e run passes.

## c10: keyboard controls feel immediate and obvious

I could not run node, pnpm or git (the brief did not allow it). Nothing in c10 is verified.

**Root cause.** The keys worked, but the player could not see a result:

- Cadet: the stick moved an invisible aim point, only toward the ring centre, at 1 m/s, and only after the divert. Any other key did nothing.
- Pilot: in the coast, full stick asks for a tilt rate of only 0.105 rad/s. On 13 engines it adds only a 3° bias.
- The booster model did not move when a key went down, and the HUD did not show the held keys.

| # | Change | Files |
| --- | --- | --- |
| 1 | Input indicator in the strip (`data-testid="input-indicator"`): a dial with a stick dot, four arrow wedges and throttle ▲/▼ marks. A key down or up redraws it in the key handler, not on the next frame. It reads the raw held input (`InputDevices.rawIntent()`, screen axes) and sets `data-x`, `data-z` and the `active` class. It shows in flight only. Touch and the compact phone strip do not show it (touch has its own stick). No animation. | `src/input/devices.ts`, `src/ui/hud.ts`, `src/ui/styles.css` |
| 2 | Render only: the 13 gimballed bells (up to 8°), their nozzle glows, the four grid fins (up to 20°) and the plume (up to 4°) follow the shaped stick through a 0.04 s filter. The bells and the plume swing opposite to the stick. The stick comes in `FrameState.stick`: from the last sim step live, from the input log in replays (`inputAt`, `Timeline.log`), and 0 in stills and menus. | `src/render/scene.ts`, `src/app/game.ts`, `src/sim/replay.ts`, `src/sim/timeline.ts` |
| 3 | Cadet: from the divert start, the stick moves the aim point in any direction at up to 2.5 m/s (`CADET_AIM_RATE`). The aim stays inside `cadetAimLimit` (2.2 m) and freezes below 8 m of pin height. New: between 40 m and 8 m the rate fades to 40% (`cadetAimRate`), so a late push cannot leave the booster sliding at contact. Hands-off runs do not change. A push away from the ring now scores worse: the input matters. The HUD says "Away from the ring ↺ · push along the arrow" only when the push points away (cosine with the aim offset above 0.3). A sideways push says nothing. | `src/sim/autopilot.ts`, `src/sim/world.ts`, `src/app/game.ts`, `src/ui/hud.ts` |
| 4 | Key prompts from the real key map: the tutorial card, the spoken lines and the steer banner (`keyWords`). Keyboard play: LIGHT reads "LIGHT · ↵", STEP has the mapped key and "STEP 13 → 3", and the CATCH ring reads "Space · 3.2 s". While LIGHT shows, the 3-2-1 cue adds "Press Enter to LIGHT" (every tier). | `src/ui/tutorialView.ts`, `src/app/game.ts`, `src/ui/hud.ts`, `src/ui/styles.css` |
| 5 | Test state: `tiltX`, `tiltZ`, `aimX`, `aimZ`, `inputX`, `inputZ`. The steer cue also has `data-sx` and `data-sz` (the arrow in screen axes). | `src/app/game.ts`, `tests/e2e/helpers.ts`, `src/ui/hud.ts` |

**Tests:**

- `assist.test.ts`: the aim moves in 5 directions at 2.5 m/s and stops at the limit; a sideways push moves it; it freezes below `CADET_AIM_FREEZE`. Changed on purpose: the "hold the first way" kid now goes past the centre, so the test asks only for a catch (no score check). The "opposite key does nothing" and "only ever closer" tests are replaced: the opposite key now moves the aim away.
- `input.test.ts`: `rawIntent` shows held keys at once (the shaped stick is still near 0), keeps a short tap until the next sample, and follows a remapped key.
- `replay.test.ts`: `inputAt` agrees with `InputPlayer` at every step.
- `tutorial.test.ts`: the lessons name the standard, one-hand and remapped keys.
- New `tests/e2e/controls.spec.ts` (desktop projects; real `page.keyboard`): the indicator lights less than 150 ms after the key down and clears on release; in the Pilot coast, 1 s of D tilts the booster more than sin 2° along the shaped stick; in Cadet (Chromium only), the arrow key moves the aim more than 1 m and a key across it moves the aim more than 0.5 m.
- Golden tests: no change. They fly the autopilot, which ignores the stick.

**Risks:**

- The Cadet "away" and "hold" runs move the aim to the 2.2 m edge on every seed. If one of them misses or slides, send me the report line. Then lower `CADET_AIM_SLOW_K` or raise `CADET_AIM_SLOW`.
- The Pilot coast tilt e2e needs about 0.035 rad in 1 s of sim time. The command is 0.105 rad/s. If the coast attitude loop is slow, the margin is small.
- The plume and bells swing opposite to the stick, as the brief asks. A real gimbal swings the nozzle exit toward the stick side. To change it, flip the sign of `ux` and `uz` in `WorldScene.update`.
- On the desktop strip the indicator adds about 90 px, so the strip can wrap to a second row sooner.

**Baselines:** the input indicator is in the desktop strip, so `in-flight.png` changes on `chromium`, `firefox` and `webkit`. The phone baselines and `main-menu` / `debrief` do not change. Regenerate only after the e2e run passes.

## Commands for the operator (in order)

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. Run the e2e suite without the visual tests, and save the output:

   ```sh
   pnpm exec playwright test --grep-invert visual > .operator/e2e.txt 2>&1
   ```

6. `pnpm capture`. Send me the `shots/*.png` files and the video length. The video is about 3 s longer (the pre-roll).
7. Regenerate the visual baselines. All three change: the new HUD chips, the ring in every tier, the grey tower and the plume colour. Do this step only when step 5 passes and the step 6 images look right:

   ```sh
   pnpm exec playwright test visual --update-snapshots
   ```

   CAUTION: This step overwrites the committed baselines. Look at each new image before you commit.
8. `pnpm ci:local`
9. Commit and push.

## Suggested commit message

`fix: gate-1 review (camera-relative steering, Cadet trim, target ring, ignition pre-roll, phone HUD, Pilot lean command, tutorial)`

## Known risks (most likely failures first)

- **Pilot human bot (`assist.test.ts`).** I tuned it on paper. The main risks:
  - The booster is still 10 to 20 m off the arms when the V/S profile reaches the rails.
  - The propellant runs low (the profile takes about 27 s on 3 engines).

  If it fails, send me the report line. It shows the reason, time, error, speed, tilt and propellant for each seed.
- **Flight Director robustness (≥ 16 of 20).** The extra 3 s of coast uses more of the wind random stream, so each seed gets new gusts. The rate should stay the same, but single seeds change.
- **Cadet "stick improves the score".** The test needs a gain of at least 40 alignment points per seed on average. I expect about 100.
- **Desktop strip width.** With the new chips the desktop strip can wrap to 2 rows on 1280 px in Pilot and FD. Check `shots/desktop-*.png`.
- **Touch emulation.** Playwright phone projects must report `(pointer: coarse)` to get the touch layout. Chromium does this with `hasTouch`. If WebKit does not, the iPhone shots show the keyboard layout.
- **Voice.** Some browsers fill the voice list late. If no local English voice exists, the game stays silent, by design.
