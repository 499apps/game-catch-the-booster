# Handoff: C4 art-director and game-feel polish pass

I could not run any tools this turn (hybrid mode). All code is unverified until the operator runs the steps below. I studied the C3 snapshots in `.operator/snaps-c3/` and the reference stills.

## What I changed (the 10 operator notes, most visible first)

| # | Note | Fix | Files |
| --- | --- | --- | --- |
| 1 | The telemetry strip shows behind the debrief | `showDebrief()` and the replay exit hide the whole HUD (strip, captions, camera tag, buttons). The touch sticks were already hidden outside a flight. New e2e assertion: the HUD is hidden on the debrief. | `src/app/game.ts`, `tests/e2e/play.spec.ts` |
| 2 | FD +10 s: the booster is a dot under the HUD | New `frameInSafe()`: it picks the lens and the aim so that every subject point sits in the band below the HUD (top 22% desktop, 30% portrait) and above a bottom margin. The beach, wide and chase rigs use it. Portrait phones get a wider maximum lens and a chase drone 185 m out. New unit tests fly the autopilot (cadet, pilot, fd x2) on 1280x720 and 393x852 and check the CoM and the nose of every auto shot against the safe rect. | `src/render/cameras.ts`, `tests/unit/render.test.ts` |
| 3 | The crowd reads as dark pegs | About 200 people in 20 loose clusters with open sand between them. Each person has legs with a gap, a torso wider at the shoulders, arms and a head. Adults are about 1.7 m, kids about 1.1 m, and 18% sit. The clothes have muted colours and a slight sky lift on the shaded side. About a third raise their arms after the catch. The beach-cam group moved inland and farther away. | `src/render/scene.ts` (`buildCrowd`) |
| 4 | The ground and beach are flat beige | Pale wind patches, darker dune faces, a broken wrack line, sage grass, and a low-frequency brightness swell. A new wet-sand band at the waterline mirrors the sky (Fresnel), has a sun glint, and has two swash foam lines that run up and back. The ocean is not changed. | `src/render/scene.ts` (`buildGround`), `src/render/materials.ts` (`makeWetSandMaterial`) |
| 5 | Hero menu: the booster floats, with no context | A new three-quarter hero camera at (-90, 200). From there the line to the booster passes 15 m clear of the tower, and the arms are seen about 25 deg off their side. It frames the tower top and the caught booster large, right of the rail. Cold vapour vents from the top and sinks from the engine bay. The sun is warmer and stronger in the hero shot, which gives a rim light. | `src/render/cameras.ts`, `src/render/scene.ts`, `src/app/game.ts` |
| 6 | Tower-top +20 s: a white bloom blob and a lens streak | `tuneForCamera()` trims the nozzle sprite (-80%), the outer shell (-45%), bloom strength (-60%) and the streak (-75%) when the engine end is near the lens. The 3-engine plume has a white-gold core with an orange falloff, and stronger shock diamonds. A downwash ring and a churned disc on the water show under the plume, and they start at 160 m. The hull glow is stronger near the ground. | `src/render/scene.ts`, `src/render/view.ts`, `src/render/materials.ts` |
| 7 | The CLOSING ring is clipped and covers the tower | The text is shorter ("✓ arms") and stays inside the inner disc. The button is never closer than 16 px to the right edge, and its size is capped at 30vw. | `src/ui/hud.ts`, `src/ui/styles.css` |
| 8 | The tower is a uniform black truss | The steel is lighter and weathered grey, with more sky reflection, which gives the dusk rim. Each bay and face has its own tone, and the braces are lighter than the diagonals. The red warning lights blink about 40 times a minute (slower and softer with reduced motion). Each light has a fixed-pixel halo, so it shows on the long lenses. | `src/render/scene.ts` (`buildTower`) |
| 9 | A dark raceway line down the hull | The chines and the raceway are now flat raised strips (0.9 m wide, about 0.12 m proud). They use the hull's own stainless tone (metal 1, roughness 0.34) and receive shadows. | `src/render/scene.ts` |
| 10 | Game feel | Thrust-scaled micro-shake: two frequencies plus a small roll. It scales with lens and distance, and it is off with reduced motion. A settle bounce on pin contact: the frame dips and rings out over 1.6 s. CATCH press: the 3D target ring flashes white and swells, and the CATCH button flashes. Debrief: the medal waits small while the score counts up, then pops with a shine ring. | `src/render/cameras.ts`, `src/render/scene.ts`, `src/ui/hud.ts`, `src/ui/menu.ts`, `src/ui/styles.css` |

### Performance

- The Low tier gets 4 more draw calls: 2 crowd meshes, the wet sand band and the light halos. The Low budget is < 150.
- New e2e tests measure the frame rate at Low and at Medium in flight (desktop Chromium).
  - With a real GPU, the minimum is 55 fps.
  - On SwiftShader, the tests record the value as an annotation and only check that the loop runs.
- The adaptive Auto test is not changed.

### Captures

`scripts/capture.mjs` (`pnpm capture`) starts its own `vite preview` on port 4199 at the base path. It stops that server by process id, never by name. It uses Chromium with the SwiftShader flags. It writes these files to `shots/` (gitignored):

- `gameplay.webm`: a 1280x720 recording of `?autopilot=1&tier=cadet&seed=1&quality=medium` at timescale 1. It starts with a beat on the hero menu and runs until about 2.5 s after the debrief shows. The cap is 40 s (`CAPTURE_SECONDS`).
  - Note: a full flight from the menu to the catch is about 36 s, so the video is longer than 20 s. The catch is the best part, so I kept it.
- `desktop-*.png`, `iphone-*.png` and `pixel-*.png`, one set per device:
  - menu, ignition-13, stepdown-3, divert, hover, arms-closing, catch and debrief (from the `still=1` hooks)
  - splashdown (a Pilot run with no ignition, timescale 4)
  - replay-split (an autopilot catch, then Replay, then Split)
- If the splashdown or replay-split shot fails, the script logs it and continues.

## Commands for the operator (in order)

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`. The new safe-frame tests fly 8 autopilot runs (4 runs x 2 screens).
4. `pnpm build`
5. Run the e2e suite without the visual tests and save the output:

   ```sh
   pnpm exec playwright test --grep-invert visual > .operator/e2e.txt 2>&1
   ```

6. `pnpm capture`. Send me the `shots/*.png` files and tell me the video length.
7. Regenerate the visual baselines. ALL THREE change on every project:
   - `main-menu`: the new hero camera, ground, lights and vapour
   - `in-flight`: the tower top at +20 s, with the plume trim, tower tone, wet sand and raceway
   - `debrief`: no HUD strip, the new crowd and vapour

   Do this only when step 5 is green and the step 6 images look right:

   ```sh
   pnpm exec playwright test visual --update-snapshots
   ```

   CAUTION: this step overwrites the committed baselines. Look at every new image before you commit.
8. `pnpm ci:local`
9. Commit and push.

## Suggested commit message

`polish: art and feel pass`

Body (optional): safe-frame auto-director below the HUD (+ unit test), HUD hidden on debrief, human crowd clusters, wet sand + ground tone, 3/4 hero shot with venting, near-lens plume trim + downwash ring, lighter tower with blinking lights, flush raceway, micro-shake, settle bounce, CATCH ring flash, medal pop, capture script, Low/Medium fps checks.

## Known open issues and risks

- **Unverified compile.** The most likely problems:
  - The new `frameInSafe` test thresholds on portrait phones (the chase lens is fixed at 44 deg). If a safe-frame test fails, send me the failure line (shot, t, tau).
  - The `UnrealBloomPass.strength` assignment.
- **Tower-top safe check.** This check runs only when the booster is within 120 m of the tower. A no-go booster stays offshore, out of that lens.
- **Wet sand.** The band uses polygon offset over the ground. If it flickers at grazing angles on some GPUs, tell me and I will raise it 5 cm more.
- **Crowd count.** About 200 people in 4 instanced meshes (3 drawn at a time). If the Low draw-call test is close to 150, I can merge the sitters into the calm mesh.
- **Hero shot.** I computed the tower clearance on paper (15 m). Please check `shots/desktop-menu.png`: the booster must be clear of the tower and right of the rail.
- **Not done.** Gamepad navigation of the left menu, and a two-finger twist for roll.
