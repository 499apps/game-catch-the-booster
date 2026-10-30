// World creation and the fixed-step update (phases, events, catch logic).
import {
  CONTACT_COM_Y,
  DT,
  G0,
  RAD,
  RUN_TIMEOUT,
  SHORELINE_X,
} from './constants';
import { integrate, massOf } from './dynamics';
import { countRunning, ignite, makeEngines, pickFailures, shutdownAll, stepDown, updateEngines } from './engines';
import { classifyArmClose, classifyContact } from './envelope';
import { boardHealthy, healthChecks, makeGoNoGo, noGoWasCorrect } from './gonogo';
import { pinHeightAboveRails, pinLateralError, timeToContact } from './predictor';
import {
  T_DECIDE_BY,
  T_DIVERT,
  T_DIVERT_END,
  T_POLL,
  VX_STEPDOWN,
  X_STEPDOWN,
  idealIgnitionHeight,
  lateralAEnd,
} from './reference';
import { makeRng, next, range } from './rng';
import { scoreRun, type ScoreBreakdown } from './scoring';
import { tierConfig, type TierId } from './tiers';
import { makeArms, makeRails, staticCompression, startClose, updateArms, updateRails } from './tower';
import type { FailReason, FlightCommand, HealthBoard, Phase, SimEvent, World } from './types';
import { makeWind, meanWindSpeed, updateWind } from './wind';
import { len2, tiltAngle } from './vec';

export interface WorldOptions {
  noAero?: boolean;
}

export const PROMPT_LEAD = 1.5; // s: the CATCH prompt shows at predicted contact <= arm close time + this

export function createWorld(seed: number, tier: TierId, opts: WorldOptions = {}): World {
  const cfg = tierConfig(tier);
  const init = makeRng(seed, 0);
  const vy = -(300 + range(init, -4, 4));
  const vx = -(115 + range(init, -5, 5));
  const vz = range(init, -2, 2);
  const speed = Math.hypot(vx, vy, vz);
  // Plan the start offset so the 13-engine burn ends near X_STEPDOWN: ~1.1 s of coast
  // before ignition, with drag taking ~6% off the horizontal speed.
  const vxIgn = 0.94 * vx;
  const xIgn = X_STEPDOWN - lateralAEnd(0, vxIgn, VX_STEPDOWN);
  const xStart = xIgn - 1.1 * 0.97 * vx + range(init, -8, 8);
  const w: World = {
    seed,
    tier,
    cfg,
    step: 0,
    t: 0,
    phase: 'coast',
    pos: { x: xStart, y: 1640 + range(init, -20, 20), z: range(init, -12, 12) },
    vel: { x: vx, y: vy, z: vz },
    // Flying engines-first: the nose points back along the trajectory (retrograde).
    tilt: { x: -vx / speed, z: -vz / speed },
    tiltRate: { x: 0, z: 0 },
    tiltCmd: { x: -vx / speed, z: -vz / speed },
    tiltCmdRate: { x: 0, z: 0 },
    roll: 0,
    rollRate: 0,
    propellant: range(init, cfg.propellant[0], cfg.propellant[1]),
    engines: makeEngines(),
    gimbal: { x: 0, z: 0 },
    fin: { x: 0, z: 0 },
    finTwitch: { x: 0, z: 0 },
    wind: { meanX: 0, meanZ: 0, shear: 0, gustSigma: 0, gustX: 0, gustZ: 0 },
    arms: makeArms(range(init, cfg.armCloseTime[0], cfg.armCloseTime[1])),
    rails: makeRails(),
    gonogo: makeGoNoGo(),
    faults: { towerSensor: false },
    ignition: null,
    tStepDown: null,
    flags: { divert: false, counterBurn: false, hover: false, catchPrompt: false },
    contact: null,
    outcome: null,
    events: [],
    rngWind: makeRng(seed, 1),
    rngTwitch: makeRng(seed, 2),
    rngEvents: makeRng(seed, 3),
    thrust: 0,
    massFlow: 0,
    accel: { x: 0, y: 0, z: 0 },
    peakG: 0,
    noAero: !!opts.noAero,
    done: false,
  };
  w.wind = makeWind(cfg, w.rngWind);
  w.faults.towerSensor = next(w.rngEvents) < cfg.towerSensorFaultProb;
  emit(w, 'runStart', { tier, seed });
  return w;
}

export function emit(w: World, type: SimEvent['type'], data?: SimEvent['data']): void {
  w.events.push(data ? { t: w.t, type, data } : { t: w.t, type });
}

export const tauOf = (w: World): number | null => (w.ignition ? w.t - w.ignition.t : null);

function finish(w: World, caught: boolean, reason: FailReason | null, goodCall = false): void {
  if (w.done) return;
  shutdownAll(w.engines);
  w.done = true;
  w.phase = caught ? 'caught' : 'splashdown';
  w.outcome = { caught, reason, goodCall, t: w.t };
  if (caught) emit(w, 'caught');
  else emit(w, 'splashdown', { reason: reason ?? 'unknown', goodCall, offshore: w.pos.x > SHORELINE_X });
}

function handleCommands(w: World, cmd: FlightCommand): void {
  if (cmd.ignite && w.phase === 'coast') {
    const failed = pickFailures(w.rngEvents, w.cfg.ignitionFailures);
    ignite(w.engines, w.rngEvents, failed, cmd.throttle);
    w.phase = 'burn13';
    w.ignition = {
      t: w.t,
      pos: { ...w.pos },
      vel: { ...w.vel },
      idealHeight: idealIgnitionHeight(Math.max(-w.vel.y, 0)),
    };
    emit(w, 'ignition', { engines: 13 - failed.length });
  }
  if (cmd.stepDown && w.phase === 'burn13') {
    const kept = stepDown(w.engines);
    w.phase = 'burn3';
    w.tStepDown = w.t;
    emit(w, 'stepDown', { engines: kept.length });
  }
  const g = w.gonogo;
  if (g.polled && g.decision === 'pending' && !w.cfg.autoGoNoGo && (cmd.go || cmd.noGo)) {
    const d = cmd.go ? 'go' : 'noGo';
    g.decision = d;
    g.decidedBy = 'player';
    g.tDecision = w.t;
    emit(w, d);
  }
  if (cmd.closeArms && (w.phase === 'burn3' || w.phase === 'burn13') && startClose(w.arms, w.t)) {
    emit(w, 'armsCloseStart', { pinHeight: pinHeightAboveRails(w.pos, w.tilt) });
  }
}

function boardData(b: HealthBoard): Record<string, boolean> {
  return { ...b };
}

function updateGoNoGo(w: World, tau: number): void {
  const g = w.gonogo;
  if (!g.polled && tau >= T_POLL) {
    g.polled = true;
    g.board = healthChecks(w, tau);
    emit(w, 'goNoGoPoll', { healthy: boardHealthy(g.board), ...boardData(g.board) });
    if (w.cfg.autoGoNoGo) {
      const d = boardHealthy(g.board) ? 'go' : 'noGo';
      g.decision = d;
      g.decidedBy = 'auto';
      g.tDecision = w.t;
      emit(w, d);
    }
  }
  if (g.polled && g.decision === 'pending' && tau >= T_DECIDE_BY) {
    g.decision = 'noGo';
    g.decidedBy = 'timeout';
    g.tDecision = w.t;
    emit(w, 'noGo', { timeout: true });
  }
  if (!w.flags.divert && tau >= T_DIVERT) {
    if (g.decision === 'go') {
      w.flags.divert = true;
      emit(w, 'divertStart');
    } else {
      const good = w.cfg.id === 'fd' && g.decidedBy === 'player' && noGoWasCorrect(g);
      finish(w, false, 'noGo', good);
    }
  }
}

function updateFlags(w: World, tau: number): void {
  if (w.flags.divert && !w.flags.counterBurn && tau >= (T_DIVERT + T_DIVERT_END) / 2) {
    w.flags.counterBurn = true;
    emit(w, 'counterBurn');
  }
  if (w.flags.divert && !w.flags.hover) {
    const lat = Math.hypot(w.vel.x, w.vel.z);
    if (pinLateralError(w.pos, w.tilt) < 2 && lat < 1 && tiltAngle(w.tilt) < 2 * RAD) {
      w.flags.hover = true;
      emit(w, 'hover');
    }
  }
  if (!w.flags.catchPrompt && w.phase === 'burn3' && !w.arms.closing && !w.arms.closed) {
    const hp = pinHeightAboveRails(w.pos, w.tilt);
    const tgo = timeToContact(hp, w.vel.y);
    if (tgo <= w.arms.closeTime + PROMPT_LEAD) {
      w.flags.catchPrompt = true;
      emit(w, 'catchPrompt', { tgo, pinHeight: hp });
    }
  }
}

function checkContact(w: World): void {
  const hp = pinHeightAboveRails(w.pos, w.tilt);
  if (hp > 0) return;
  if (!w.arms.closed) {
    finish(w, false, w.arms.closing ? 'late' : w.ignition ? 'noCatch' : 'lateIgnition');
    return;
  }
  const lateralError = pinLateralError(w.pos, w.tilt);
  const tiltDeg = tiltAngle(w.tilt) / RAD;
  const lateralSpeed = Math.hypot(w.vel.x, w.vel.z);
  const speed = Math.max(-w.vel.y, 0);
  const cls = classifyContact({ lateralError, tiltDeg, lateralSpeed, contactSpeed: speed }, w.cfg);
  if (cls === 'missLateral') {
    finish(w, false, 'missLateral');
    return;
  }
  if (cls === 'unstable' || cls === 'overload') {
    emit(w, 'bounce', { speed });
    finish(w, false, cls);
    return;
  }
  w.contact = { t: w.t, speed, lateralError, tiltDeg, lateralSpeed, propellant: w.propellant, cls };
  emit(w, 'contact', { speed, lateralError, cls });
  shutdownAll(w.engines);
  w.thrust = 0;
  w.massFlow = 0;
  emit(w, 'cutoff');
  w.phase = 'settling';
  w.rails.compression = -hp;
  w.rails.rate = speed;
}

function updateSettling(w: World, dt: number): void {
  const m = massOf(w);
  updateRails(w.rails, m, G0, dt);
  // The arms hold the booster: lateral motion and tilt die out quickly.
  const k = Math.exp(-dt / 0.25);
  w.vel.x *= k;
  w.vel.z *= k;
  w.tilt.x *= k;
  w.tilt.z *= k;
  w.tiltRate.x = 0;
  w.tiltRate.z = 0;
  w.pos.x += w.vel.x * dt;
  w.pos.z += w.vel.z * dt;
  w.pos.y = CONTACT_COM_Y - w.rails.compression;
  w.vel.y = -w.rails.rate;
  const c = w.contact;
  if (
    c &&
    w.t - c.t > 1.0 &&
    Math.abs(w.rails.rate) < 0.05 &&
    Math.abs(w.rails.compression - staticCompression(m, G0)) < 0.05
  ) {
    finish(w, true, null);
  }
}

/** Advances the world by one fixed step (DT). */
export function stepWorld(w: World, cmd: FlightCommand): void {
  if (w.done) return;
  const dt = DT;
  handleCommands(w, cmd);

  if (w.phase === 'settling') {
    updateSettling(w, dt);
  } else {
    const changes = updateEngines(w.engines, cmd.throttle, dt);
    for (const c of changes) emit(w, c.mode === 'lit' ? 'engineLit' : 'engineFail', { engine: c.index });
    const flameout = integrate(w, cmd, dt);
    if (flameout) {
      emit(w, 'flameout');
      w.step++;
      w.t = w.step * dt;
      finish(w, false, 'flameout');
      return;
    }
  }
  if (!w.noAero) updateWind(w.wind, w.rngWind, dt);

  w.step++;
  w.t = w.step * dt;

  if (updateArms(w.arms, w.t)) {
    const hp = pinHeightAboveRails(w.pos, w.tilt);
    w.arms.pinHeightAtClose = hp;
    emit(w, 'armsClosed', { pinHeight: hp });
    if (w.phase !== 'settling' && classifyArmClose(hp, w.cfg) === 'early') {
      finish(w, false, 'early');
      return;
    }
  }

  if (w.phase === 'settling') return;
  const tau = tauOf(w);
  if (tau !== null) {
    updateGoNoGo(w, tau);
    if (w.done) return;
    updateFlags(w, tau);
  } else if (w.pos.y < 450) {
    finish(w, false, 'lateIgnition');
    return;
  }
  checkContact(w);
  // checkContact may move the phase on; read it fresh (TS keeps the earlier narrowing).
  const phase: Phase = w.phase as Phase;
  if (w.done || phase === 'settling') return;
  if (phase === 'burn3') {
    if (w.vel.y > 3) finish(w, false, 'climb');
    else if (tiltAngle(w.tilt) > 30 * RAD) finish(w, false, 'tilt');
  }
  if (!w.done && w.t > RUN_TIMEOUT) finish(w, false, 'timeout');
}

export function enginesAtIgnition(w: World): number {
  const ev = w.events.find((e) => e.type === 'ignition');
  const n = ev?.data?.['engines'];
  return typeof n === 'number' ? n : countRunning(w.engines);
}

/** Final score for a finished world. */
export function scoreWorld(w: World): ScoreBreakdown {
  const c = w.contact;
  const m = massOf(w);
  return scoreRun({
    caught: !!w.outcome?.caught,
    pinError: c?.lateralError ?? 99,
    contactSpeed: c?.speed ?? 99,
    peakLoadG: w.rails.peakForce / (m * G0),
    propellantKg: c?.propellant ?? w.propellant,
    ignitionError: w.ignition ? w.ignition.pos.y - w.ignition.idealHeight : 999,
    tiltDeg: c?.tiltDeg ?? 90,
    lateralSpeed: c?.lateralSpeed ?? 99,
    goodCall: !!w.outcome?.goodCall,
    enginesLitAtIgnition: enginesAtIgnition(w),
    meanWind: meanWindSpeed(w.wind),
  });
}

/** Cadet slow-mo: pins within 20 m of the rails. */
export function slowMoActive(w: World): boolean {
  return w.cfg.slowMoLast20m && w.phase === 'burn3' && pinHeightAboveRails(w.pos, w.tilt) < 20;
}

export const lateralSpeedOf = (w: World): number => len2({ x: w.vel.x, z: w.vel.z });
