// The game shell: owns the run (world + input log), the fixed-step loop, the view,
// HUD, LEFT rail menu, audio and the test hooks. The sim itself stays pure in src/sim.
import { AudioEngine, type Sfx } from '../audio/audio';
import { InputDevices } from '../input/devices';
import { AutoDirector, BEACH_CAM, CAMERA_IDS, CAMERA_LABELS, TOWER_CAM, WIDE_CAM, type CameraId, type ShotInput } from '../render/cameras';
import { AdaptiveQuality, autoStartTier } from '../render/quality';
import type { FrameState } from '../render/scene';
import { View, hasWebGL2 } from '../render/view';
import { ghostPath } from '../sim/autopilot';
import { CONTACT_COM_Y, COM_ABOVE_BASE, DT, ENGINE_COUNT, ENGINE_THRUST, RAIL_Y, SHORELINE_X, SOUND_SPEED } from '../sim/constants';
import { commandFor } from '../sim/control';
import { countRunning } from '../sim/engines';
import { pinPosition, stopHeight, timeToContact } from '../sim/predictor';
import { idealIgnitionHeight } from '../sim/reference';
import { InputPlayer, InputRecorder, type InputLog } from '../sim/replay';
import type { ScoreBreakdown } from '../sim/scoring';
import { TIER_CONFIG, type TierId } from '../sim/tiers';
import { tipFor } from '../sim/tips';
import { makeArms } from '../sim/tower';
import { NEUTRAL_INPUT, type EngineState, type PilotInput, type SimEvent, type World } from '../sim/types';
import { axisFromTilt, type Vec3 } from '../sim/vec';
import { createWorld, scoreWorld, slowMoActive, stepWorld, tauOf } from '../sim/world';
import { clearMyData } from '../sw-register';
import { el } from '../ui/dom';
import { Hud, type HudData } from '../ui/hud';
import { Menu } from '../ui/menu';
import { TouchControls, isTouchDevice } from '../ui/touch';
import type { Hooks } from './params';
import { defaultSettings, loadBest, loadSettings, saveBest, saveSettings, type Settings } from './storage';

const MAX_STEPS_PER_FRAME = 2400; // 20 s of sim: keeps timescale 16 smooth on slow devices
const SLOW_MO = 0.35;
const SPLASH_SECONDS = 4;
const DEBRIEF_DELAY_CAUGHT = 2.5;
const DEBRIEF_DELAY_SPLASH = SPLASH_SECONDS + 0.5;

interface Run {
  world: World;
  tier: TierId;
  seed: number;
  autopilot: boolean;
  recorder: InputRecorder;
  player: InputPlayer | null;
  log: InputLog | null; // the log this run replays
  acc: number;
  /** Button taps not yet seen by a sim step. */
  pending: PilotInput | null;
  eventIndex: number;
  doneAtReal: number | null; // real seconds (scaled by timescale) when the sim finished
  contactT: number | null;
  splashFrom: Vec3 | null;
  score: ScoreBreakdown | null;
  debriefShown: boolean;
}

export interface CatchTestState {
  ready: boolean;
  webgl: boolean;
  mode: string;
  tier: TierId | null;
  seed: number | null;
  phase: string;
  t: number;
  tau: number | null;
  outcome: { caught: boolean; reason: string | null } | null;
  score: number | null;
  quality: string;
  qualitySetting: string;
  qualityDrops: number;
  fps: number;
  frames: number;
  camera: CameraId;
  paused: boolean;
  replay: boolean;
}

declare global {
  interface Window {
    __catch?: CatchTestState;
  }
}

const BUTTONS = ['ignite', 'stepDown', 'closeArms', 'go', 'noGo'] as const;

const NUM_WORDS: Record<number, string> = { 11: 'eleven', 12: 'twelve', 13: 'thirteen' };

function randomSeed(): number {
  return Math.floor(Math.random() * 2147483646) + 1;
}

function engineFrac(engines: readonly EngineState[]): number {
  let n = 0;
  for (const e of engines) if (e.mode === 'lit' || e.mode === 'spooling') n += e.throttle * (e.mode === 'lit' ? 1 : 0.5);
  return n / ENGINE_COUNT;
}

export class Game {
  private settings: Settings;
  private readonly quality: AdaptiveQuality;
  private view: View | null = null;
  private readonly devices: InputDevices;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly touch: TouchControls;
  private readonly audio = new AudioEngine();
  private readonly director = new AutoDirector();
  private manualCam: CameraId | null = null;
  private camera: CameraId = 'wide';
  private run: Run | null = null;
  private lastLog: { log: InputLog; seed: number; tier: TierId; autopilot: boolean } | null = null;
  private paused = false;
  private lastNow = 0;
  private fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private frames = 0;
  private realTime = 0; // seconds of (timescaled) play time, for UI animation timing
  private rafId: number | null = null;
  private disposed = false;
  private readonly test: CatchTestState | null;
  private readonly menuBackdrop: World;

  constructor(
    private readonly app: HTMLElement,
    private readonly hooks: Hooks,
  ) {
    this.settings = loadSettings();
    const start = autoStartTier(navigator, screen.width, screen.height);
    // Still frames use Low: cheapest on software rasterisers, and no bloom/shadow variance.
    this.quality = new AdaptiveQuality(hooks.quality ?? (hooks.still ? 'low' : this.settings.quality), start);
    app.classList.toggle('touch', isTouchDevice());
    app.classList.toggle('reduced', this.settings.reducedMotion);

    const canvas = el('canvas', { id: 'game-canvas', 'data-testid': 'game-canvas' });
    app.append(canvas);
    try {
      if (hasWebGL2()) this.view = new View(canvas, this.quality.profile, { preserveDrawingBuffer: hooks.active });
    } catch {
      this.view = null;
    }
    if (!this.view) {
      app.append(
        el('div', { id: 'notice', 'data-testid': 'no-webgl', text: '3D view unavailable on this device. The flight still runs.' }),
      );
    }

    this.devices = new InputDevices(window);
    this.touch = new TouchControls(app, this.devices);
    this.hud = new Hud(app, this.devices);
    this.menu = new Menu(app, this.settings, {
      onStart: (tier) => this.startRun(tier, { seed: hooks.seed ?? randomSeed(), autopilot: hooks.autopilot }),
      onResume: () => this.setPaused(false),
      onPause: () => this.setPaused(true),
      onRestart: () => this.restart(),
      onMainMenu: () => this.toMainMenu(),
      onReplay: () => this.startReplay(),
      onCamera: (id) => this.pickCamera(id),
      onSettings: (s) => this.applySettings(s),
      onClearData: () => this.clearData(),
    });
    this.audio.setMuted(this.settings.muted);
    this.audio.timescale = hooks.timescale;

    this.devices.onUiKey((k) => {
      if (k === 'pause') {
        if (this.run && !this.run.world.done) this.setPaused(!this.paused);
      } else if (k === 'camera') {
        const i = CAMERA_IDS.indexOf(this.camera);
        this.pickCamera(CAMERA_IDS[(i + 1) % CAMERA_IDS.length] ?? 'wide');
      } else if (k === 'cameraAuto') this.pickCamera('auto');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.run && !this.run.world.done && !this.paused && !hooks.still) this.setPaused(true);
    });
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());

    // Menu backdrop: a booster resting in the closed arms.
    this.menuBackdrop = createWorld(1, 'cadet');
    const b = this.menuBackdrop;
    b.pos = { x: 0, y: CONTACT_COM_Y - 0.3, z: 0 };
    b.tilt = { x: 0, z: 0 };
    b.arms = makeArms();
    b.arms.progress = 1;
    b.arms.closed = true;
    b.phase = 'caught';

    this.test = hooks.active ? this.makeTestState() : null;
    if (this.test) window.__catch = this.test;
    this.menu.setCamera(this.camera, this.manualCam === null);
    this.resize();

    // Release the GL context and stop the loop when the page goes away (bfcache, reload,
    // tab close): software-GL browsers run out of framebuffers if contexts linger.
    window.addEventListener('pagehide', () => this.dispose());
    window.addEventListener('pageshow', (e) => {
      if (e.persisted && this.disposed) window.location.reload(); // back from bfcache: start clean
    });

    if (hooks.still) this.setupStill();
    else {
      if (hooks.tier) this.menu.selectTier(hooks.tier);
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.audio.pause();
    this.view?.dispose();
    this.view = null;
  }

  private makeTestState(): CatchTestState {
    return {
      ready: false,
      webgl: this.view !== null,
      mode: 'main',
      tier: null,
      seed: null,
      phase: 'menu',
      t: 0,
      tau: null,
      outcome: null,
      score: null,
      quality: this.quality.tier,
      qualitySetting: this.quality.setting,
      qualityDrops: 0,
      fps: 0,
      frames: 0,
      camera: this.camera,
      paused: false,
      replay: false,
    };
  }

  // ---------------------------------------------------------------- runs

  private startRun(tier: TierId, o: { seed: number; autopilot: boolean; log?: InputLog }): void {
    if (!this.hooks.still) this.audio.unlock(); // still frames have no user gesture
    this.audio.resetRun();
    this.devices.reset();
    this.touch.reset();
    this.hud.clearCaption();
    this.director.reset();
    this.view?.resetCameras();
    const world = createWorld(o.seed, tier);
    this.run = {
      world,
      tier,
      seed: o.seed,
      autopilot: o.autopilot,
      recorder: new InputRecorder(),
      player: o.log ? new InputPlayer(o.log) : null,
      log: o.log ?? null,
      acc: 0,
      pending: null,
      eventIndex: 0,
      doneAtReal: null,
      contactT: null,
      splashFrom: null,
      score: null,
      debriefShown: false,
    };
    this.paused = false;
    this.menu.setMode('playing');
    this.hud.setVisible(true);
    this.releaseFocus();
    this.processEvents(this.run);
  }

  /** Enter / Space are flight keys: never let them re-click the menu button that has focus. */
  private releaseFocus(): void {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== document.body) a.blur();
  }

  private restart(): void {
    const tier = this.run?.tier ?? this.settings.tier;
    this.startRun(tier, { seed: this.hooks.seed ?? randomSeed(), autopilot: this.hooks.autopilot });
  }

  private startReplay(): void {
    const l = this.lastLog;
    if (!l) return;
    this.startRun(l.tier, { seed: l.seed, autopilot: l.autopilot, log: l.log });
  }

  private toMainMenu(): void {
    this.run = null;
    this.paused = false;
    this.audio.resetRun();
    this.audio.updateRoar(0, 0, false, 1000);
    this.hud.setVisible(false);
    this.hud.clearCaption();
    this.menu.setMode('main');
  }

  private setPaused(p: boolean): void {
    if (!this.run) return;
    if (this.run.world.done && p) return;
    this.paused = p;
    this.devices.reset();
    if (p) {
      this.audio.pause();
      this.menu.setMode('paused');
    } else {
      this.audio.unlock();
      this.audio.resume();
      this.menu.setMode('playing');
      this.releaseFocus();
    }
  }

  private pickCamera(id: CameraId | 'auto'): void {
    this.manualCam = id === 'auto' ? null : id;
    if (id !== 'auto') this.camera = id;
    this.menu.setCamera(this.camera, this.manualCam === null);
  }

  private applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    saveSettings(s);
    this.audio.setMuted(s.muted);
    this.app.classList.toggle('reduced', s.reducedMotion);
    if (qualityChanged && !this.hooks.still && !this.hooks.quality) {
      this.quality.set(s.quality);
      this.view?.applyQuality(this.quality.profile);
    }
  }

  private clearData(): void {
    void clearMyData();
    this.settings = defaultSettings();
    this.menu.setSettings(this.settings);
    this.audio.setMuted(this.settings.muted);
    this.app.classList.toggle('reduced', this.settings.reducedMotion);
  }

  // ---------------------------------------------------------------- sim stepping

  private stepRun(r: Run, input: PilotInput, simSeconds: number): void {
    const w = r.world;
    r.acc += simSeconds;
    // A button tap in a frame that runs no sim step (slow-mo, very high fps) waits for the next step.
    if (BUTTONS.some((b) => input[b])) {
      const p = r.pending ?? { ...input };
      for (const b of BUTTONS) p[b] = p[b] || input[b];
      r.pending = p;
    }
    let steps = 0;
    while (r.acc >= DT && steps < MAX_STEPS_PER_FRAME && !w.done) {
      let inp = r.player ? r.player.at(w.step) : input;
      if (!r.player && r.pending) {
        inp = { ...input };
        for (const b of BUTTONS) inp[b] = inp[b] || r.pending[b];
        r.pending = null;
      }
      if (!r.player) r.recorder.record(w.step, inp);
      stepWorld(w, commandFor(w, inp, r.autopilot));
      r.acc -= DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) r.acc = 0;
    if (w.done) r.acc = 0;
    this.processEvents(r);
  }

  private camPos(id: CameraId, w: World): Vec3 {
    const c = this.view?.rigs[id].camera.position;
    if (c) return { x: c.x, y: c.y, z: c.z };
    if (id === 'beach') return BEACH_CAM;
    if (id === 'wide') return WIDE_CAM;
    if (id === 'towerTop') return TOWER_CAM;
    return { x: w.pos.x + 80, y: w.pos.y, z: w.pos.z - 120 };
  }

  private delayFrom(src: Vec3, w: World): number {
    const c = this.camPos(this.camera, w);
    return Math.hypot(src.x - c.x, src.y - c.y, src.z - c.z) / SOUND_SPEED;
  }

  private callout(text: string, sfx: Sfx | null = 'blip'): void {
    this.hud.caption(text, this.realTime, 3.2);
    if (sfx) this.audio.play(sfx);
  }

  private processEvents(r: Run): void {
    const w = r.world;
    const tower: Vec3 = { x: 0, y: RAIL_Y, z: 0 };
    while (r.eventIndex < w.events.length) {
      const e: SimEvent | undefined = w.events[r.eventIndex++];
      if (!e) continue;
      const fd = w.cfg.id === 'fd';
      switch (e.type) {
        case 'runStart':
          this.callout('Heron booster on final approach. Stand by for the landing burn.');
          // It went supersonic higher up: the double crack reaches each camera later.
          this.audio.play('boom', this.delayFrom(w.pos, w) + 2, this.camera === 'beach' ? 1 : 0.5);
          break;
        case 'ignition': {
          const n = Number(e.data?.['engines'] ?? 13);
          this.callout(`Landing burn, we have ${NUM_WORDS[n] ?? String(n)}.`);
          break;
        }
        case 'engineLit':
          this.audio.play('relight', this.delayFrom(w.pos, w), 0.6);
          break;
        case 'engineFail':
          this.callout(`Engine ${Number(e.data?.['engine'] ?? 0) + 1} did not relight. Still flying.`);
          break;
        case 'stepDown':
          this.callout('Down to three.');
          break;
        case 'goNoGoPoll':
          if (fd) this.callout('Flight Director, poll for catch. GO or NO-GO?');
          break;
        case 'go':
          this.callout('Flight Director, we are GO for catch.');
          break;
        case 'noGo':
          this.callout('No-go, divert.');
          break;
        case 'divertStart':
          this.callout('Divert. Swinging in toward the tower.', null);
          break;
        case 'hover':
          this.callout('Vertical. Settling beside the arms.', null);
          break;
        case 'catchPrompt':
          this.callout(w.cfg.id === 'cadet' && !r.autopilot ? 'Press and hold CATCH now!' : 'Stand by to catch.');
          break;
        case 'armsCloseStart':
          this.callout('Arms closing.');
          this.audio.play('hiss', this.delayFrom(tower, w));
          break;
        case 'armsClosed':
          this.audio.play('clunk', this.delayFrom(tower, w));
          break;
        case 'contact':
          r.contactT = w.t;
          this.audio.play('thud', this.delayFrom(tower, w));
          this.devices.thud();
          break;
        case 'caught':
          this.callout('CATCH!', null);
          this.audio.play('creak', this.delayFrom(tower, w));
          this.audio.play('crowd', 0.3);
          break;
        case 'bounce':
          this.callout('Bounced off the rails. Diverting to the sea.');
          break;
        case 'flameout':
          this.callout('Out of propellant. Gliding to a soft splashdown.');
          break;
        case 'splashdown':
          this.callout('Soft splashdown. The recovery boat is on the way.', 'splash');
          break;
        default:
          break;
      }
    }
  }

  private finishRun(r: Run): void {
    const w = r.world;
    if (r.doneAtReal === null) {
      r.doneAtReal = this.realTime;
      r.score = scoreWorld(w);
      if (w.phase === 'splashdown') r.splashFrom = { ...w.pos };
      if (!r.player) {
        this.lastLog = { log: r.recorder.log, seed: r.seed, tier: r.tier, autopilot: r.autopilot };
      }
    }
    const delay = (w.outcome?.caught ? DEBRIEF_DELAY_CAUGHT : DEBRIEF_DELAY_SPLASH) / this.hooks.timescale;
    if (!r.debriefShown && this.realTime - r.doneAtReal >= delay) this.showDebrief(r);
  }

  private showDebrief(r: Run): void {
    r.debriefShown = true;
    const w = r.world;
    const score = r.score ?? scoreWorld(w);
    const caught = !!w.outcome?.caught;
    const isReplay = !!r.player;
    const newBest = !isReplay && caught ? saveBest(r.tier, score.total) : false;
    const goodCall = !!w.outcome?.goodCall;
    this.menu.showDebrief({
      tier: r.tier,
      caught,
      title: caught ? 'Caught by the arms!' : goodCall ? 'Good Call: safe splashdown' : 'Soft splashdown',
      tip: tipFor(w.outcome?.reason ?? null),
      score,
      best: loadBest(r.tier),
      newBest,
      isReplay,
    });
  }

  // ---------------------------------------------------------------- frame

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const frameMs = this.lastNow ? now - this.lastNow : 16.7;
    this.lastNow = now;
    const dt = Math.min(frameMs / 1000, 0.25);
    this.frames++;
    this.fpsAcc += frameMs;
    this.fpsFrames++;
    if (this.fpsAcc >= 500) {
      this.fps = (this.fpsFrames * 1000) / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (this.quality.sample(frameMs)) this.view?.applyQuality(this.quality.profile);

    const r = this.run;
    if (r && !this.paused) {
      const scale = this.hooks.timescale * (slowMoActive(r.world) ? SLOW_MO : 1);
      this.realTime += dt * this.hooks.timescale;
      const input = this.devices.sample(dt);
      if (!r.world.done) this.stepRun(r, input, dt * scale);
      if (r.world.done) this.finishRun(r);
      this.devices.rumble(engineFrac(r.world.engines), now);
    }
    this.draw(dt, false);
    if (this.test && !this.test.ready && this.frames >= 2) this.test.ready = true;
  };

  private buildFrame(w: World, t: number, active: boolean): { frame: FrameState; shot: ShotInput } {
    const r = this.run;
    let pos = w.pos;
    let splash: FrameState['splash'] = null;
    if (active && r && r.splashFrom && r.doneAtReal !== null) {
      const from = r.splashFrom;
      const at = { x: Math.max(from.x, SHORELINE_X + 220), y: 0, z: from.z };
      const progress = Math.min(1, ((this.realTime - r.doneAtReal) * 1) / SPLASH_SECONDS);
      const k = progress * progress * (3 - 2 * progress);
      pos = { x: from.x + (at.x - from.x) * k, y: from.y + (8 - from.y) * k, z: from.z + (at.z - from.z) * k };
      splash = { active: true, progress, at };
    }
    const thrustFrac = w.thrust / (ENGINE_COUNT * ENGINE_THRUST);
    const showAids = active && w.cfg.id === 'cadet' && !w.done && w.phase !== 'coast';
    let pinGhost: Vec3 | null = null;
    if (showAids) {
      const pin = pinPosition(w.pos, w.tilt);
      const tgo = Math.min(timeToContact(pin.y - RAIL_Y, w.vel.y), 8);
      pinGhost = { x: pin.x + w.vel.x * tgo, y: RAIL_Y + 0.6, z: pin.z + w.vel.z * tgo };
    }
    const frame: FrameState = {
      t,
      pos,
      tilt: w.tilt,
      roll: w.roll,
      engines: w.engines,
      thrustFrac,
      armProgress: w.arms.progress,
      aids: { show: showAids, ghost: showAids ? ghostPath(w, 24) : [], pinGhost, ringRadius: w.cfg.pinWindow },
      splash,
      reducedMotion: this.settings.reducedMotion,
    };
    const shot: ShotInput = {
      com: pos,
      axis: axisFromTilt(w.tilt),
      thrustFrac,
      t,
      reducedMotion: this.settings.reducedMotion,
    };
    return { frame, shot };
  }

  private draw(dt: number, snap: boolean): void {
    const r = this.run;
    const w = r ? r.world : this.menuBackdrop;
    if (r) {
      const tau = tauOf(w);
      const auto = this.director.update(w.phase, tau, w.arms.closing, r.contactT ?? r.world.outcome?.t ?? null, w.t);
      this.camera = this.manualCam ?? auto;
    } else if (!this.manualCam) this.camera = 'wide';
    this.menu.setCamera(this.camera, this.manualCam === null);

    const t = this.hooks.still ? 0 : r ? w.t : this.realTime;
    const { frame, shot } = this.buildFrame(w, t, !!r);
    if (this.view) {
      this.view.render(frame, this.camera, shot, dt, snap);
      if (!snap) this.view.trackAll(shot, dt, this.camera);
    }
    if (r) {
      const camPos = this.camPos(this.camera, w);
      const dist = Math.hypot(w.pos.x - camPos.x, w.pos.y - camPos.y, w.pos.z - camPos.z);
      this.audio.updateRoar(w.t, Math.min(1, engineFrac(w.engines) * 2.2), w.phase === 'burn3', dist);
      this.hud.update(this.hudData(r), this.realTime);
    }
    this.updateTestState();
  }

  private hudData(r: Run): HudData {
    const w = r.world;
    const tau = tauOf(w);
    const down = Math.max(-w.vel.y, 0);
    const prop0 = w.cfg.propellant[1];
    let stop: number | null = null;
    if (w.phase === 'coast' || w.phase === 'burn13' || w.phase === 'burn3') {
      const n = w.phase === 'coast' ? ENGINE_COUNT : Math.max(1, countRunning(w.engines));
      stop = stopHeight(w.pos.y, w.vel.y, w.propellant, n) - CONTACT_COM_Y;
    }
    const igniteIn = w.phase === 'coast' && down > 1 ? (w.pos.y - idealIgnitionHeight(down)) / down : null;
    const manual = !r.autopilot && !r.player;
    const cfg = TIER_CONFIG[r.tier];
    const flying = w.phase === 'burn13' || w.phase === 'burn3';
    return {
      tier: r.tier,
      phase: w.phase,
      tau,
      altitude: Math.max(0, w.pos.y - COM_ABOVE_BASE),
      speed: Math.hypot(w.vel.x, w.vel.y, w.vel.z),
      vs: w.vel.y,
      lat: Math.hypot(w.vel.x, w.vel.z),
      propellantT: w.propellant / 1000,
      propFrac: Math.min(1, w.propellant / prop0),
      engines: w.engines,
      stopMargin: stop,
      igniteIn,
      gonogo: w.gonogo,
      fdDecide: manual && !cfg.autoGoNoGo,
      catchVisible: flying && (w.flags.catchPrompt || w.arms.closing) && !w.arms.closed,
      armsClosing: w.arms.closing,
      stepVisible: manual && !cfg.autoStepDown && w.phase === 'burn13',
      lightVisible: manual && w.phase === 'coast' && (cfg.id !== 'cadet' || (igniteIn !== null && igniteIn <= 3.5)),
      camera: `${CAMERA_LABELS[this.camera]}${this.manualCam ? '' : ' · auto'}${r.player ? ' · REPLAY' : ''}`,
      fps: this.hooks.fps && !this.hooks.still ? this.fps : null,
      paused: this.paused,
    };
  }

  private updateTestState(): void {
    const s = this.test;
    if (!s) return;
    const r = this.run;
    const w = r?.world;
    s.webgl = this.view !== null;
    s.mode = this.menu.mode;
    s.tier = r?.tier ?? null;
    s.seed = r?.seed ?? null;
    s.phase = w ? w.phase : 'menu';
    s.t = w ? w.t : 0;
    s.tau = w ? tauOf(w) : null;
    s.outcome = w?.outcome ? { caught: w.outcome.caught, reason: w.outcome.reason } : null;
    s.score = r?.score ? r.score.total : null;
    s.quality = this.quality.tier;
    s.qualitySetting = this.quality.setting;
    s.qualityDrops = this.quality.drops;
    s.fps = this.fps;
    s.frames = this.frames;
    s.camera = this.camera;
    s.paused = this.paused;
    s.replay = !!r?.player;
  }

  private resize(): void {
    const w = this.app.clientWidth || window.innerWidth;
    const h = this.app.clientHeight || window.innerHeight;
    this.view?.resize(w, h);
    if (this.hooks.still) this.draw(0, true);
  }

  // ---------------------------------------------------------------- still frames (visual tests)

  private setupStill(): void {
    const h = this.hooks;
    const tier = h.tier ?? 'cadet';
    const seed = h.seed ?? 1;
    if (h.debrief || h.at !== null) {
      this.startRun(tier, { seed, autopilot: true });
      const r = this.run;
      if (!r) return;
      const w = r.world;
      const limit = h.debrief ? 120 : h.at ?? 0;
      while (!w.done && w.step < 120 / DT) {
        const tau = tauOf(w);
        if (!h.debrief && tau !== null && tau >= limit) break;
        stepWorld(w, commandFor(w, NEUTRAL_INPUT, true));
      }
      r.eventIndex = w.events.length;
      this.hud.clearCaption();
      if (h.debrief) {
        r.doneAtReal = 0;
        r.score = scoreWorld(w);
        r.splashFrom = w.phase === 'splashdown' ? { ...w.pos } : null;
        this.realTime = SPLASH_SECONDS;
        this.showDebrief(r);
      }
    }
    this.draw(0, true);
    // A second pass so every rig and the HUD settle on the same deterministic frame.
    this.draw(0, true);
    if (this.test) this.test.ready = true;
  }
}
