# Handoff: C2 striking visuals and the broadcast presentation (pass 1)

I could not run any tools this turn. All code is unverified until the operator runs the steps below.

## What changed

### Scene (`src/render/scene.ts`, `materials.ts`, new `terrain.ts`)

- **Dusk sky.** An analytic sky shader with a warm horizon toward the sun, a deep blue zenith, a Mie glow, an HDR sun disc and low stratus plus cirrus. The sun is about 6 deg up over the sea.
- **Sea.** A custom shader with summed waves, Fresnel sky reflection, a sun glint path, an orange plume glint and light pool, shore foam, a splash ring and horizon haze.
- **Land.** A height field with a beach, dunes, grass colours and a graded launch site. The site has a pad, a tank farm, a pipe rack and hangars (one merged mesh).
- **Crowd.** 300 instanced spectators: on the beach in front of the wide cam and down the coast.
- **Light.** `FogExp2` haze, a low warm sun with shadows, a cool fill light, and a hemisphere light. The PMREM environment comes from the sky shader (no HDR files).
- **Heron-class booster.**
  - Hull: `MeshPhysicalMaterial` with a 512x2048 procedural texture set. The set has colour, roughness/metal and normal maps.
  - Details on the hull: welded ring sheets, one staggered vertical seam per ring, vent slots, soot and two frost bands.
  - Livery: the heron glyph and a stencil "HB-07", drawn in metres so the text is not stretched.
  - The texture tiles around the u seam, so the stray vertical white line is gone.
  - Anisotropic brushing on High only.
  - Other parts: 4 instanced lattice grid fins that twitch, catch pins, chines, a raceway, 13 + 20 instanced bells and 13 glowing bell discs.
- **Plume.**
  - A turbulent additive envelope: wide and chaotic for 13 engines, a tight pillar for 3.
  - 13 instanced core cones with pulsing shock diamonds.
  - A nozzle glow sprite. The plume widens with altitude.
  - An ignition flash. It drives the exposure pump.
  - The plume light lights the tower and ground. An emissive mask tints the lower hull orange. The plume also lights the sea and the steam.
- **Steam, spray and dust.** Up to 1400 instanced soft billboards. Steam and spray form over water and dust over land, and the cloud lingers after cutoff. A splashdown makes mist and a recovery boat.
- **The Catcher.**
  - Tower: instanced lattice, a top deck, a mast, red aviation lights, guide rails and the carriage.
  - Arms: two box-truss arms outboard of the rail, so they clear the hull. The rails drop with rail compression.
  - Other moving parts: the bumpers flex at full close, and the hydraulic cylinders follow each arm.

### Post (`src/render/post.ts`, `view.ts`)

- Medium and High run this chain: bloom (half resolution on Medium) → `OutputPass` → `FinishPass`.
- `FinishPass` adds heat shimmer (beach 1.0, wide 0.5), an engine glare with a streak and ghosts, a light vignette and film grain.
- All tiers get a CSS vignette overlay. Low has no GPU post.
- Exposure pump: the flash blows out, then the exposure adapts. Reduced motion turns it off.
- Low uses stratus clouds only and no sea micro-noise.

### Cameras and director (`src/render/cameras.ts`)

- **Tower top (operator note).** I moved the camera to a boom at (-20, 154, -14). It looks out to sea over the arms, with the pitch clamped so the horizon stays in frame. At +20 s the booster is only about 26 m away and spans about 100 deg, so no lens can hold all of it. The frame now shows the arms, the plume, the lower hull and the horizon. Unit tests check this for 16:9 and phone portrait.
- **Beach.** A long lens that frames the booster, plus the tower when low. It has a lag and a focus-pull "breath" on each cut.
- **Drone chase.** A slow orbit that stays above the ground.
- **Onboard.** Looks down the hull at the plume and the arms.
- **Wide bay.** Stands on the beach behind the crowd and looks into the sunset glow.
- **Shake.** Angular shake scales with thrust and distance.
- **Director.** Beach (ignition), then chase (step-down), wide (divert), beach, then tower top (≥ +20 s or arms closing), then wide after the catch.
- **Picture-in-picture.** A second view in a framed inset at the top right. It shows on Medium and High only, which keeps Low under the draw-call budget.
- **Keys.** Numpad 1–5 pick a camera. The digit row already sets the throttle (design section 5), so I did not reuse it.

### HUD and UI (operator notes)

- An original webcast strip: HB-07, tier and phase, a 33-dot engine ring with the lit count, speed in km/h, altitude, V/S and LAT, a propellant bar, the STOP gauge and a `+mm:ss.s` clock. The strip is at the bottom on desktop and at the top on touch screens.
- The touch stick and throttle show only while flying (`.touch.flying`).
- The `THR 70%` label is now a bold, high-contrast pill.
- The debrief tip depends on the medal (`CATCH_TIPS`), so a Bullseye no longer hears "Try for a Bullseye".

### Tests

- New `tests/unit/render.test.ts` (12 tests). It covers result-aware tips, the director and PiP rules, `fovToFit`, tower-top framing at +20 s (landscape and portrait) and after the catch, the camera ground clearance, and the terrain.
- `tests/e2e/perf.spec.ts`: a new Low draw-call test (< 150, Chromium, still frame at +12 s).
- `__catch.drawCalls` gives the draw-call count. `renderer.info.autoReset` is now false, so the count covers every pass of the frame.

## Commands for the operator (in order)

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. Run the e2e suite without the visual tests and save the output:

   ```sh
   pnpm exec playwright test --grep-invert visual > .operator/e2e.txt 2>&1
   ```

   Send me the summary and any failures. Look for shader compile errors in the console-error tests first.
6. Make the review screenshots and send them to me. They are for review only, so do not commit them.
   - Desktop chromium, `iPhone 15` and `Pixel 7`.
   - Queries (all with `still=1&seed=1&tier=cadet`): main menu, `at=2`, `at=8`, `at=12`, `at=20`, `at=28`, and `debrief=1`.
   - Also one desktop frame at `quality=high` for `at=20`. Still mode forces Low unless a `quality=` hook is set.
7. Do the visual-baseline step only when step 5 is green and I approve the images:

   ```sh
   pnpm exec playwright test visual --update-snapshots
   ```

   CAUTION: this step overwrites the committed baselines. Look at every new image before you commit.
8. `pnpm ci:local`
9. Commit and push.

## Suggested commit message

`feat(render): dusk Gulf coast scene, PBR Heron booster with livery, volumetric plumes with shock diamonds, steam/dust, Catcher tower and arms, post (bloom/glare/shimmer/grain), cinematic cameras + PiP director, webcast HUD; fix tower-top framing, touch controls only in flight, readable throttle label, result-aware debrief tips`

## Known open issues and risks

- **GLSL is unverified.** I made sure the reversed `smoothstep` edges are safe. A shader error shows as a console error in the smoke tests.
- **Performance on SwiftShader at Low is unknown.** If the autopilot flights miss the 25 s debrief timeout, tell me the fps (`__catch.fps`). Things I can cut: the cloud fbm at Low, the ground resolution, and the hull texture size.
- **Iteration.** The task asks for at least two art-direction passes. I cannot do them without the screenshots from step 6.
- **Lens flare occlusion.** The glare does not check occlusion, so it can show through the tower for a moment.
- **Arm truss.** The truss sits outboard of the rail. If the pins look like they miss the rails in the screenshots, I will tune `ARM_Z` visuals (not the sim).
