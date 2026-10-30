// Physical constants, vehicle and tower geometry. Pure data, SI units.
// World frame: x = offshore (sea is +x), y = up, z = along the coast. The arm
// centreline (catch point) is at x = 0, z = 0. The tower column stands inland at x < 0.

export const DT = 1 / 120; // fixed simulation step (s)
export const G0 = 9.80665; // standard gravity (m/s^2)

// ---- HE-2 engines ----
export const ENGINE_COUNT = 13; // inner engines used for the landing burn
export const CENTER_ENGINES: readonly number[] = [0, 1, 2]; // engines kept after step-down
export const ENGINE_THRUST = 2.26e6; // N per engine at 100% (sea level)
export const THROTTLE_MIN = 0.4;
export const THROTTLE_MAX = 1.0;
export const THROTTLE_RATE = 2.0; // throttle fraction per second
export const ISP = 327; // s
export const SPOOL_MIN = 0.6; // s, relight spool time range
export const SPOOL_MAX = 1.2;
export const GIMBAL_MAX = (15 * Math.PI) / 180; // rad
export const STEP_DOWN_KEEP = 3;

// ---- Heron-class booster ----
export const DRY_MASS = 250_000; // kg
export const BOOSTER_LENGTH = 71; // m
export const BOOSTER_DIAMETER = 9; // m
export const COM_ABOVE_BASE = 25; // m, centre of mass above the engine plane (empty tanks, heavy engines)
export const PIN_ABOVE_BASE = 64; // m, catch pins near the top
export const PIN_ABOVE_COM = PIN_ABOVE_BASE - COM_ABOVE_BASE; // 39 m
export const GIMBAL_BELOW_COM = 24; // m, lever arm of the gimbal force
export const INERTIA_FACTOR = 1 / 18; // I = k m L^2 (mass concentrated low; slender cylinder is 1/12)
export const FIN_ALPHA_PER_PA = 6.7e-6; // rad/s^2 per Pa of dynamic pressure at full fin deflection
export const FIN_Q_MIN = 5000; // Pa: grid fins are only effective above this
export const FIN_Q_FULL = 8000; // Pa: full fin authority from here
export const MAX_TILT = 0.85; // sin of the largest tilt the model allows (~58 deg)

// ---- Aerodynamics ----
export const RHO0 = 1.225; // kg/m^3
export const SCALE_HEIGHT = 8500; // m
export const SOUND_SPEED = 343; // m/s (game value, also used for audio delay)
export const CDA_AXIAL = 128; // m^2 -> ballistic coefficient ~2500 kg/m^2 at 320 t
export const CDA_SIDE = 500; // m^2, broadside (71 m x 9 m x Cd ~0.8)

// ---- The Catcher (tower) ----
export const TOWER_HEIGHT = 146;
export const TOWER_X = -16; // tower column centre
export const ARM_LENGTH = 36;
export const RAIL_Y = 100; // top of the rail beams on the arms (m)
export const CONTACT_COM_Y = RAIL_Y - PIN_ABOVE_COM; // CoM height when the pins touch the rails (61 m)
export const SHORELINE_X = 30; // sea starts here
export const ARM_OPEN_ANGLE = (52 * Math.PI) / 180; // each arm swings this far open

// ---- Rails (spring-damper) ----
export const RAIL_STIFFNESS = 9.0e6; // N/m -> ~0.3 m static compression at 270 t
export const RAIL_DAMPING = 1.9e6; // N s/m -> damping ratio ~0.6
export const RAIL_STROKE = 1.5; // m
export const RAIL_BUMP_STIFFNESS = 2.0e8; // N/m hard stop past the stroke

// ---- Catch envelope (Pilot / Flight Director; Cadet widens some) ----
export const PIN_WINDOW = 1.5; // m
export const PIN_HEIGHT_AT_CLOSE_MAX = 20; // m
export const TILT_LIMIT_DEG = 2;
export const LATERAL_SPEED_LIMIT = 1; // m/s
export const CONTACT_CLEAN = 2; // m/s
export const CONTACT_OVERLOAD = 4; // m/s

// ---- Misc ----
export const RUN_TIMEOUT = 75; // s after start, failsafe
export const RAD = Math.PI / 180;
