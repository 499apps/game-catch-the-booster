# Handoff: C1a tuning pass 2 (flight physics)

## What the pass 1 diag trace showed (Cadet seed 1)

- **The gimbal sign is correct.** After step-down the tilt rate fell by about 15°/s each second (0.26 rad/s²) with the gimbal at -14°. That is exactly the 3-engine authority at full gimbal, in the braking direction.
- **The real cause starts in the 13-engine burn.**
  - The lean overshot to 38° at τ=2 s, and the lateral speed overshot from -10.5 m/s to +1 m/s.
  - The lateral feedback then swung the lean command from +28° to -7° in about 1 s.
  - At step-down the booster was rotating at about -23°/s. 3 engines need about 1.5 s and about 17° to stop that rate, so the lean ran to -28°.
- **Why the burn overshot:** the old aero model had a broadside force that was linear in the angle of attack, with 500 m². At 250 m/s that gives about 52 m/s² per radian, against about 70 m/s² per radian from the thrust. So the side force cancelled about 75% of the lean's effect, and the lateral loop over-drove it.
- **The later failures came from the same lateral swing:**
  - The 18° lean lowered the pins 1.9 m, so contact came early, before the arms finished closing ("late").
  - The ±19° oscillation on 3 engines caused "missLateral" and the late "tilt".
- **The "-25.2 s arm close" and "lean 0" results** came from failed flights (the `armsClosed` or divert events were missing). They are not separate bugs.

## Changes this pass (root causes; no test targets changed)

1. **`atmosphere.ts`**: a physical normal force.
   - It is a slender-body slope (`CNA_BASE` = 127 m²/rad, 2 × base area) plus crossflow drag (`CDA_SIDE` × sin²(AoA)).
   - Broadside wind still gets the full 500 m². The force still always opposes the airspeed.
2. **`reference.ts`**:
   - The lateral braking now ramps out from 2.2 s to 3.5 s, and is zero from 3.5 s to 4.0 s (`LA_END`).
   - The hold point `X_HOLD` went from 40 m to 30 m. The divert lean is about 10° and its peak rate about 10°/s, inside the 3-engine authority.
3. **`world.ts`**: the start is planned from the new shape: -115 m/s, about 0.4 km offshore, ending near `X_STEPDOWN` (57 m).
4. **`autopilot.ts`** (attitude has priority over position):
   - On 13 engines, the lean limit fades from 35° to 3° between 3.0 s and 3.5 s. The booster is upright and still at step-down.
   - On 3 engines, the lean command is clamped to 12° and slew-limited to 0.2 rad/s.
   - On 3 engines, the lateral gains are lower (`KP_LAT3` 0.25, `KD_LAT3` 0.9: ω 0.5, ζ 0.9).
   - `PRESS_LEAD` went from 0.7 s to 1.2 s, so the arms finish about 1 s before contact.
5. **`dynamics.ts`**: a saturation-aware attitude PD. The closing rate is capped at √(1.2 α_max e), so it never builds a rate it cannot brake. Inside the cap it is the same PD as before.
6. **`diag.test.ts`**: the trace also prints the tilt command and the tilt rate (deg, deg/s).
7. **`docs/design.md`**: the Implementation notes are updated.

## Commands for the operator (in order)

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm exec vitest run --reporter=verbose > .operator/vitest.txt 2>&1`. This includes the DIAG traces.
4. If typecheck and lint pass, commit and push (the work is in progress).

## Suggested commit message

`sim: tuning pass 2 - physical normal force, upright step-down, attitude-priority lean limits, saturation-aware attitude PD`

## Known open issues

- The tuning is still analytical. Next, check the DIAG trace for these items:
  - The tilt and tilt rate at step-down: target under 3° and 3°/s.
  - The 3-engine lateral swing: the target is no gimbal saturation after τ = 6 s.
  - The hover event at about τ = 23 s.
- If the lateral error at step-down is still more than 10 m, make the lateral gains in the 13-engine phase stiffer before τ = 3 s.
- Delete `tests/unit/diag.test.ts` when the golden suite is green.
