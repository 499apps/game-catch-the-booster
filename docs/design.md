# Catch the Booster: Game Design (games.499apps.com)

This is an original game inspired by the real tower catches of super-heavy rocket boosters. **It uses no company logos, names or trade dress.** The vehicle is our own "Heron-class booster" and the tower is "the Catcher".
Status: design draft, 2026-10-29. Research clips are in `research/videos/` and are for internal study only. They must never be shipped.

## 1. How it actually happens (research)

### 1.1 Timeline of a real catch (Flight 5, Oct 13 2024, plus Flights 7, 8, 12–14)
| T+ (mm:ss) | Event | Real numbers | Source |
|---|---|---|---|
| 02:32–02:40 | Most engines cut off (MECO), then hot-staging | ~67 km altitude, ~1.24 km/s downrange | SpaceX F7 timeline; dogum F5 reconstruction |
| 02:46–03:29/03:38 | Boostback burn on 13 engines (10 middle-ring + 3 center) | ~45–53 s, Δv ≈ 1.75 km/s; F8 lit 11/13, F14 lit 31/33 (V3 burn-to-depletion test) | SpaceX F7, F8, F14 pages; dogum |
| before boostback ends | **Go/No-Go for catch**: automated vehicle + tower health checks, then a manual Flight Director command | if any check fails the booster stays on the default offshore trajectory | SpaceX X posts 1845437508320170081, 1845542074609004971 |
| ~03:40–06:26 | Ballistic coast and fall; grid fins steer; no entry burn | apogee 90–96 km, 60–88 km downrange; peak ~4,400 km/h; ~5.7 g of drag below 20 km; ~130 kPa at Mach 2.9 | SpaceX X 1882925462218997805; dogum |
| ~06:26 | Transonic; double-crack sonic boom heard on the ground ~19 s after visible landing-burn ignition (footage est.) | — | SpaceX F7 timeline; clip 02 |
| 06:30–06:35 | Landing burn ignition on 13 engines | ~1–1.8 km altitude, ~1,230 km/h; ~0.8 km offshore moving toward the tower at ~150 m/s, descending at ~317 m/s; F7 ignited < 40 m from target | dogum; SpaceX X 1882925462218997805 |
| +~7 s | Engines step down 13 → 3 (V3: 13 → 5 → 3) | ~250 km/h | dogum; SpaceX F14 page |
| ~06:38–06:55 | Divert to the tower as a pendulum (lean, swing in, counter-burn, snap vertical), hover; the arms close over ~4.5–6 s | last 20 m in ~7 s, from 37 km/h to 0 | dogum; clips 03 and 04 |
| ~06:54–06:59 | Catch: the pins land on the rail beams, the rails compress, engines shut down | landing burn total ~25 s (F12 timeline: 06:34 to 06:59) | spacevoyaging; SpaceX F12/F14 tables |

### What the footage shows (times estimated from clips 02, 03, 04)
A frame-by-frame study of clips 02 (ground view), 03 (Flights 5/7/8 in sync) and 04 (tower-top). **All times are estimates from the footage.**

| From landing-burn ignition (est.) | What happens | Clip |
|---|---|---|
| +0 s | Landing burn lights 13 engines. The ground camera sees it in silence. | 03, 02 |
| ~+4 s | Down to 3 center engines | 03 |
| ~+13 s | Sideways move toward the tower begins (pendulum divert) | 03 |
| ~+19 s | Double-crack sonic boom reaches the ground camera, then the deep engine roar | 02 |
| ~+23 s | Hover and vertical settle beside the arms | 03, 04 |
| ~+27 s | Arms start closing while the booster is still dropping | 03, 04 |
| ~+31–32 s | Arms fully closed: **close time ~4.5–6 s, not 2 s** | 03, 04 |
| ~+33 s | Engines cut at contact, a short drop onto the rails, a heavy settling thud | 03 |

The tower-top clip (04) broadly agrees: about 25 s from visible ignition to cutoff, and an arm close of about 5–6 s. The gap from the sync clip's ~33 s is probably down to where each clip's first visible ignition frame falls.

- **Attitude is a pendulum, not a level slide.** The engines gimbal to kick the tail out, so the nose tilts away from the tower. The booster swings in, counter-burns to brake, then snaps vertical for the final drop.
- **Visuals:**
  - 13 engines make a wide, chaotic yellow-orange plume that lifts ground dust and steam.
  - 3 engines make a tight white-orange pillar with pulsing shock diamonds.
  - The stainless hull reflects the orange plume on its lower half.
  - Steam and dust wash over the tower base.
  - The grid fins twitch constantly at high frequency.
- **Audio:** the ground camera sees ignition in silence. The double-crack sonic boom arrives ~19 s after visible ignition, around the hover, followed by the deep roar. Each camera applies its own speed-of-sound delay (distance ÷ 343 m/s).
- **Design change:** the player starts the arm close while the booster is still dropping, about 5 s before contact. The CATCH cue appears early, and Cadet shows a predicted-pin ghost.

### 1.2 Hardware
- **Tower:** ~146 m tall with two ~36 m arms ("chopsticks"). The arms ride a carriage on a winch, swing on hydraulic actuators, and have compressible bumpers. Rail beams on top act as shock absorbers. Tower radar measures the booster's position (sensors added and upgraded after Flight 6).
- **Booster:** ~71 m tall × 9 m wide; dry mass ~250 t (estimate). Two catch pins near the top, between the grid fins. V3 has 3 larger grid fins that carry the catch points.
- **Engines:** 33 total. The landing burn uses the 13 inner ones (3 center + 10 middle ring) and the final hover uses the 3 center engines. Raptor 2 is about 2.26 MN (230 tf) at sea level and Raptor 3 about 2.45 MN (250 tf). Minimum throttle is ~40% (estimate).
- **Grid fins:** ~3 t each on V2. They are the main steering during the coast and fall.
- **Why catch at all:** it removes the mass of landing legs, and the same arms can put the booster straight back on the launch mount (Musk, X 1845829120959156376).

### 1.3 Abort and divert logic (key mechanic)
- The default trajectory is safe: the booster aims for a point a little offshore. Only after the Go command does the landing-burn divert bring it to the tower.
- **Flight 6:** tower health checks failed because tower sensors were damaged at liftoff. The booster performed a pre-planned divert to a soft Gulf splashdown.
- **Flights 9, 12, 13:** engine and boostback anomalies, with no catch attempted.
- **Flights 10, 11, 14:** planned Gulf splashdowns used to test new procedures (13 → 5 → 3).
- **Record:** 3 catches (F5, F7, F8) from 4 attempts (F6 aborted).

### 1.4 Failure modes to simulate
1. An engine fails to relight (F7 boostback 12/13, F8 11/13 and 12/13, F14 31/33 and 11/13). The game needs engine-out margin and must redistribute throttle.
2. A partial boostback (F12, F13) leaves the booster short, so it must divert to the ocean.
3. A tower fault such as sensor damage or lost comms (F6) means No-Go and a divert.
4. A late landing-burn ignition: ~2 s late means it cannot stop in time.
5. Lateral overshoot or high wind (F7 flew through "the highest wind speeds yet").
6. Structural or propellant issues: a chine cover tore off (F5), and a spin-gas abort check came within ~1 s of tripping (F5).
7. A loss shortly after landing-burn ignition (F9). **Kid version:** this becomes a soft splashdown, never an explosion.

### 1.5 Wind
No public catch wind limit was found. The booster comes home ~7 min after launch, so in practice the launch weather limits govern the catch. Flight 7 caught in the highest winds to date. In the game, wind is a tier-scaled hazard: a mean wind, plus gusts, plus shear near the tower top.

## 2. Gameplay lessons from classics
- **Lunar Lander (1979):** one scarce resource (fuel), a single tension (throttle against gravity), readable speed numbers, and a score for gentleness plus fuel left. We copy that clarity.
- **Kerbal Space Program:** a predicted-trajectory line and impact marker, time warp through boring coasts, SAS assist layers, and funny, learnable failure. We copy the predictor, the warp and the assist ladder.
- **ISS docking simulator (iss-sim.spacex.com):** a minimal HUD showing range, rate and alignment; values turn green inside tolerance; small discrete inputs. We copy the tolerance colouring and the rate-based readouts.
- **Flight sims (MSFS assists, DCS):** stackable assists, checklists and radio callouts, replay cameras. We copy the callouts, the replay and per-assist toggles.

## 3. Game structure
- **Missions:**
  - Mission = a full return from staging to catch (~4.5 min real time, with ×4 to ×10 time warp in the coast).
  - Quick Play = "Final Approach", starting at landing-burn ignition (~25–40 s). This is the core loop and the first thing we build.
- **Phases:**
  1. Boostback: aim the impact marker.
  2. Go/No-Go poll.
  3. Coast and fall: steer with grid fins and watch the heating glow.
  4. Landing burn: ignition timing and engine step-down.
  5. Divert and hover: a pendulum lean, not a level slide.
  6. Close the arms: start ~5 s before contact, while the booster is still dropping (the close takes ~4.5–6 s).
  7. Settle: engines cut at contact, a short drop onto the rails, a heavy thud.
- **Safe-by-default rule:** the impact marker starts offshore. The player earns "GO FOR CATCH" by meeting the criteria, and only then does the divert-to-tower guidance unlock.

## 4. Physics model (fixed step 120 Hz, deterministic, seeded)
- **State:** position r, velocity v, attitude q, angular rate ω, and propellant mass. Simulation is 6-DOF, with a 3-DOF + tilt option for Cadet.
- **Thrust:** F = Σᵢ throttleᵢ · Tᵢ, with Tᵢ = 2.26 MN (Mk2) or 2.45 MN (Mk3) and throttle between 0.4 and 1.0. Engine gimbal is about ±15° (game value). Relighting an engine has a 0.6–1.2 s spool time and a per-tier failure chance.
- **Mass flow:** ṁ = F / (Isp · g₀) with Isp ≈ 327 s, which is ~700 kg/s per engine at full throttle.
- **Mass:** at landing ignition, 250 t dry + 45–95 t propellant. At the catch, 5–35 t is left. Running out = flameout = splashdown.
- **Drag:** D = ½ ρ(h) v² C_d A. Use ρ = 1.225 · e^(−h/8,500), a ballistic coefficient of ~2,500 kg/m², and transonic drag rise. Peak deceleration should come out around 5–6 g.
- **Grid fins:** control moment M ∝ q · S_fin · δ. Effective only when dynamic pressure q > ~5 kPa, and weak in the final hover.
- **T/W check:** 13 engines at 100% on 315 t gives ~9.5 g of thrust. 3 engines at minimum throttle on ~260 t gives ~1.06 g, so the hover is touchy, and a light booster can't truly hover. This is a real design tension: "you can't hang there forever".
- **Wind:** mean wind + gusts (Dryden-lite filtered noise) + shear above 100 m. The wind exerts sideways force on the 71 m body.
- **Catch envelope:**
  - Pins within ±1.5 m of the arm centreline (Cadet ±3 m).
  - Pins 0–20 m above the rails when the arms finish their ~4.5–6 s close (footage est.). The player must commit ~5 s ahead, so show a predicted-pin marker.
  - Divert attitude: model the lean. Gimbal kicks the tail out, the nose tilts away from the tower, the booster swings in, counter-burns, then snaps vertical.
  - Grid fins: constant high-frequency twitch during the burn (visual plus a tiny torque).
  - Cutoff at contact, then a short free drop onto the rails.
  - Tilt < 2°, sideways speed < 1 m/s.
  - Contact speed: < 2 m/s clean, 2–4 m/s hard, > 4 m/s overloads (arm load meter red, then a "bounce" and divert).
- **Rails:** spring-damper with ~1.5 m of stroke. Score the peak load.

## 5. Controls
| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Tilt / translate | WASD | Left stick | Left virtual stick |
| Throttle | Shift / Ctrl (hold) or 1–9 | RT / LT | Right vertical slider |
| Roll / yaw (FD tier) | Q / E | Right stick X | Two-finger twist (optional) |
| Engine mode 13/5/3 | R (step down) | RB | Button chip |
| Close arms | Space | A | Big CATCH button, appears ~5 s before predicted contact (hold 0.3 s) |
| Call divert / abort | X (hold 1 s) | B (hold) | Swipe-hold "DIVERT" |
| Camera | C / 1–5 | Y / D-pad | Swipe on the video bar |
| Time warp (coast) | T | View button | ⏩ |

Gamepad rumble scales with thrust. Controls are remappable. A one-handed preset exists. Inputs are smoothed with rate limits so kids can't twitch the booster into a spin.

## 6. Difficulty tiers
- **Cadet:**
  - Autopilot flies boostback and the coast. A ghost path and a glowing ring show where to be.
  - Auto ignition, with a "3-2-1 LIGHT" cue the player can tap.
  - Attitude hold; the stick commands sideways speed directly.
  - ±3 m pin window, no wind, slow-mo in the last 20 m.
  - A failure always ends in a gentle splashdown, with a tip.
- **Pilot:**
  - The player picks ignition timing using the impact and stop-height predictor, and runs the throttle and engine step-down.
  - Rate damping only, light steady wind, ±1.5 m window, occasional single engine-out on relight.
- **Flight Director:**
  - Full manual: gimbal, grid fins, throttle.
  - Runs the Go/No-Go poll: read the health board and decide. A correct no-go earns a "Good Call" bonus.
  - Random engine-outs (boostback 11–12/13, landing 11–12/13), partial boostback, tower sensor faults, and gusts plus shear. Mk3 adds the 13 → 5 → 3 sequence.
  - Leaderboard is local only.

## 7. Scoring (out of 1000, with medals)
- Pin alignment: 300 points, for lateral error at contact (0 m = full, 1.5 m = 0).
- Contact speed: 250 points (< 0.5 m/s = full, 2 m/s = half, > 4 m/s = 0 and a hard catch).
- Arm and rail load: 150 points (peak load relative to rated).
- Fuel margin: 150 points (land with 5–15 t = full; < 2 t = "fumes" badge but fewer points).
- Ignition accuracy: 100 points (distance from the target point at ignition; 40 m = "pro" reference).
- Stability: 50 points (tilt and rate at contact).
- **Bonuses:**
  - Correct divert decision (FD): +200.
  - Engine-out recovery.
  - Wind master.
- **Medals:** Bronze Catcher, Silver, Gold, "Bullseye" (< 0.3 m).
- **Fail:** a soft splashdown screen with telemetry graphs and one specific tip.

## 8. Webcast-style multi-cam
1. Long-lens tracking cam from the beach: heat shimmer, auto focus pulls, slight lag (clip 02).
2. Tower-top cam looking down on the booster and arms (clip 04).
3. Engine-bay cam: an original 13-engine ring diagram plus a dramatic plume view.
4. Drone chase cam.
5. Wide bay cam with the crowd: ignition seen in silence, sound arrives later.

- **Auto director:** switches cameras by phase, with picture-in-picture.
- **Telemetry bar (original design):** T+ clock, speed (km/h), altitude (km), propellant %, an engine ring that lights per engine, and a Go/No-Go strip.
- **Instant replay:** split-screen synced cams, the same layout as clip 03.

## 9. Audio
- **Procedural Raptor-like roar:** filtered noise + low-frequency crackle, distance-low-passed. Speed-of-sound delay per camera (distance ÷ 343 m/s, ~2.9 s/km).
- **Sonic boom:** a double crack that reaches the ground cam ~19 s after visible ignition, around the hover, then the deep roar (clip 02).
- **Settle:** a heavy thud as the booster drops onto the rails.
- **Hardware sounds:** relight pops, engines spooling 13 → 3, hydraulic hiss and clunk as the arms close, rail compression creak, metal thunk on the pins.
- **Original callouts (TTS or voice actor, never real webcast audio):**
  - "Boostback startup"
  - "Flight director, we are GO for catch" / "No-go, divert"
  - "Transonic"
  - "Landing burn, we have thirteen"
  - "Down to three"
  - "Arms closing"
  - "CATCH!", followed by crowd swell
- **Adaptive music:** quiet during the coast, rising tension during the burn, a stinger on the catch.

## 10. Polish list
- Shading: hot-staging glow, re-entry heating sheen on the grid fins, a transonic condensation collar, plume expansion with altitude, Mach diamonds at sea level, ground dust, and steam from the deluge.
- Two plume looks:
  - 13 engines: a wide, chaotic yellow-orange plume that raises dust and steam.
  - 3 engines: a tight white-orange pillar with pulsing shock diamonds.
- The stainless hull reflects orange on its lower half. Steam and dust wash over the tower base. The grid fins twitch at high frequency.
- Golden-hour and blue-hour lighting presets (the real flights caught at sunrise and dusk).
- Arm animation: the arms start wide and move early (an F7 upgrade). Bumpers flex. The booster slides down the bumpers and settles. Jackscrews nudge it after the catch.
- Camera shake scaled by distance and thrust. Lens flare and exposure pump when the engines light.
- Ghost replay of your best run, a photo mode, and post-flight graphs (altitude and speed against time, 13-engine timeline).
- Haptics, 60 fps on mid phones, and a reduced-motion setting.

## 11. Kid-friendliness and safety
- No explosions, fire deaths or gore. Every failure is a soft ocean splashdown and a friendly recovery boat.
- Positive coaching tips. Real-world facts cards ("Why catch instead of legs?").
- No chat, no user content, no ads, no external links in-game.

## 12. Privacy
- No accounts, cookies, analytics, or third-party SDKs.
- Progress and best scores live in localStorage only, with a "Reset my progress" button.
- All assets are static from our own domain. No network calls during play. COPPA/GDPR-K friendly.

## 13. three.js build plan
- **Modules:**
  - `sim/`: pure TS, fixed 120 Hz, seeded RNG, replay = seed + input log.
  - `vehicle/`: thrust, mass, aero, fins, engine state machine.
  - `guidance/`: polynomial or G-FOLD-lite powered-descent guidance for the ghost path and the Cadet autopilot.
  - `tower/`: arm kinematics, contact springs.
  - `render/`: three.js r17x WebGLRenderer (WebGPU optional), Sky + Water shaders, GPU-instanced plume particles, bloom.
  - `audio/`: WebAudio procedural.
  - `input/`: Pointer Events, Gamepad API, keyboard.
  - `ui/`: HTML/CSS overlay.
- **Milestones:**
  1. M0: greybox Final Approach, HUD numbers only, physics tuned against the timeline table.
  2. M1: catch envelope, arms and scoring. Playtest.
  3. M2: full return (boostback, coast, time warp, Go/No-Go).
  4. M3: cameras, telemetry bar, replay.
  5. M4: audio and callouts.
  6. M5: tiers, failures, wind.
  7. M6: art polish, mobile performance (< 6 MB initial, < 150 draw calls), accessibility.
  8. M7: kid playtests and tuning.
- **Validation:** an automated test asserts the autopilot reproduces real timings (ignition ~T+6:31, catch ~T+6:55 ± 5 s).

## 14. Title ideas (avoid trademarked names)
"Tower Catch!", "Catch the Booster", "Chopstick Catch", "Rocket Catcher", "Big Catch: Booster Rescue".

## 15. Top 5 mechanics to build first
1. A safe-by-default trajectory and Go/No-Go call: the booster aims offshore until GO is given before boostback ends, and health faults force a divert.
2. Landing-burn ignition timing with a stop-height predictor and engine-relight uncertainty (ask for 13, get 11–13).
3. Engine step-down (13 → 3, Mk3: 13 → 5 → 3) followed by a pendulum divert (lean, swing in, counter-burn, snap vertical), with T/W ≈ 1 at minimum throttle.
4. The arm catch window: start the ~4.5–6 s arm close while the booster is still dropping (anticipate ~5 s ahead), with the pins ±1.5 m and 0–20 m above the rails at < 2 m/s, and the rails compress.
5. Webcast multi-cam with per-camera speed-of-sound delay, a double-crack boom, callouts, telemetry bar and synced replays.

## Sources
- SpaceX Flight 5–14 pages: https://www.spacex.com/launches/starship-flight-5 … flight-14 (7, 8, 12, 14 used directly)
- SpaceX on X (catch criteria, Flight Director command): https://x.com/SpaceX/status/1845437508320170081, https://x.com/SpaceX/status/1845542074609004971
- SpaceX on X (F7 precision, winds, arm upgrades): https://x.com/SpaceX/status/1882925462218997805
- SpaceX on X (13 → 3 engines): https://x.com/SpaceX/status/1880655580823773354
- SpaceX onboard catch-fitting video: https://x.com/SpaceX/status/1845966756579627167; tower view: https://x.com/SpaceX/status/1845922924315938922
- Musk on why the tower catches instead of using legs: https://x.com/i/status/1845829120959156376
- Flight 5 telemetry reconstruction: https://dogum.github.io/artifact-shelf/a/catching-booster-12/catching-booster-12.html
- Flight 6 abort: https://spaceflightnow.com/2024/11/20/super-heavy-starship-launches-on-sixth-test-flight/
- Catch tally: https://spacenexus.us/starship/catches
- V3 changes: https://www.spacex.com/updates
- Wind and weather discussion: https://news.ycombinator.com/item?id=41837882
- Open-source 6-DOF catch sim: https://github.com/DionisMuzenitov/starship-catch-sim
- ISS docking sim: https://iss-sim.spacex.com/
- KSP as an educational game: https://link.springer.com/chapter/10.1007/978-3-030-22602-2_24
