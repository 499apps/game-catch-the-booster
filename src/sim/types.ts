// Shared simulation types. The World is plain data: copyable and hashable.
import type { Rng } from './rng';
import type { TierConfig, TierId } from './tiers';
import type { Vec2, Vec3 } from './vec';

/** Player input per step, already smoothed and rate-limited by src/input. Logged for replays. */
export interface PilotInput {
  stickX: number; // -1..1 (world +x = offshore)
  stickZ: number; // -1..1
  throttle: number; // 0..1 lever -> 40%..100%
  yaw: number; // -1..1 (roll, FD)
  ignite: boolean;
  stepDown: boolean;
  closeArms: boolean;
  go: boolean;
  noGo: boolean;
}

export const NEUTRAL_INPUT: PilotInput = Object.freeze({
  stickX: 0,
  stickZ: 0,
  throttle: 0.5,
  yaw: 0,
  ignite: false,
  stepDown: false,
  closeArms: false,
  go: false,
  noGo: false,
});

/** Actuator-level command produced by the control laws or the autopilot. */
export interface FlightCommand {
  attitude: 'tilt' | 'rate' | 'direct';
  target: Vec2; // tilt target (sin components), tilt-rate target (rad/s), or gimbal fraction -1..1
  throttle: number; // throttle fraction, clamped to 0.4..1 by the engines
  roll: number; // -1..1
  ignite: boolean;
  stepDown: boolean;
  closeArms: boolean;
  go: boolean;
  noGo: boolean;
}

export type EngineMode = 'off' | 'spooling' | 'lit' | 'failed';
export interface EngineState {
  mode: EngineMode;
  spoolTime: number;
  spool: number; // seconds spent spooling
  willFail: boolean;
  throttle: number; // actual throttle 0.4..1
}

export interface WindState {
  meanX: number;
  meanZ: number;
  shear: number;
  gustSigma: number;
  gustX: number;
  gustZ: number;
}

export interface ArmState {
  closeTime: number; // s for a full close
  closing: boolean;
  tStart: number | null; // sim time the close began
  progress: number; // 0 open .. 1 closed
  closed: boolean;
  pinHeightAtClose: number | null;
}

export interface RailState {
  compression: number;
  rate: number;
  peakForce: number;
}

export type Decision = 'pending' | 'go' | 'noGo';
export interface HealthBoard {
  engines: boolean;
  propellant: boolean;
  track: boolean;
  towerSensors: boolean;
  arms: boolean;
  comms: boolean;
}
export interface GoNoGoState {
  polled: boolean;
  board: HealthBoard | null;
  decision: Decision;
  decidedBy: 'auto' | 'player' | 'timeout' | null;
  tDecision: number | null;
}

export type Phase = 'coast' | 'burn13' | 'burn3' | 'settling' | 'caught' | 'splashdown';

export type EventType =
  | 'runStart'
  | 'ignition'
  | 'engineLit'
  | 'engineFail'
  | 'stepDown'
  | 'goNoGoPoll'
  | 'go'
  | 'noGo'
  | 'divertStart'
  | 'counterBurn'
  | 'hover'
  | 'catchPrompt'
  | 'armsCloseStart'
  | 'armsClosed'
  | 'contact'
  | 'cutoff'
  | 'caught'
  | 'bounce'
  | 'flameout'
  | 'splashdown';

export interface SimEvent {
  t: number;
  type: EventType;
  data?: Record<string, number | string | boolean>;
}

export type FailReason =
  | 'noGo'
  | 'lateIgnition'
  | 'flameout'
  | 'late'
  | 'early'
  | 'missLateral'
  | 'unstable'
  | 'overload'
  | 'noCatch'
  | 'climb'
  | 'tilt'
  | 'timeout';

export type ContactClass = 'clean' | 'hard';

export interface ContactInfo {
  t: number;
  speed: number;
  lateralError: number;
  tiltDeg: number;
  lateralSpeed: number;
  propellant: number;
  cls: ContactClass;
}

export interface Outcome {
  caught: boolean;
  reason: FailReason | null;
  goodCall: boolean;
  t: number;
}

export interface IgnitionSnapshot {
  t: number;
  pos: Vec3;
  vel: Vec3;
  idealHeight: number; // CoM height the ideal ignition would have used for this speed
}

export interface World {
  seed: number;
  tier: TierId;
  cfg: TierConfig;
  step: number;
  t: number;
  phase: Phase;
  pos: Vec3; // centre of mass
  vel: Vec3;
  tilt: Vec2; // horizontal components of the body axis
  tiltRate: Vec2;
  tiltCmd: Vec2; // last tilt target (for rate feed-forward)
  tiltCmdRate: Vec2; // filtered rate of the tilt target
  roll: number;
  rollRate: number;
  propellant: number;
  engines: EngineState[];
  gimbal: Vec2; // rad, applied this step
  fin: Vec2; // grid fin command -1..1
  finTwitch: Vec2;
  wind: WindState;
  arms: ArmState;
  rails: RailState;
  gonogo: GoNoGoState;
  faults: { towerSensor: boolean };
  ignition: IgnitionSnapshot | null;
  tStepDown: number | null;
  flags: { divert: boolean; counterBurn: boolean; hover: boolean; catchPrompt: boolean };
  contact: ContactInfo | null;
  outcome: Outcome | null;
  events: SimEvent[];
  rngWind: Rng;
  rngTwitch: Rng;
  rngEvents: Rng;
  // telemetry from the last step
  thrust: number; // N total
  massFlow: number; // kg/s
  accel: Vec3; // non-gravitational acceleration (what an accelerometer reads), m/s^2
  peakG: number;
  noAero: boolean; // test hook: disable aerodynamics and wind
  done: boolean;
}
