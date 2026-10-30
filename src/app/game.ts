// The game shell: owns the run (world + input log), the fixed-step loop, the Cadet
// tutorial, the replay player, the view, HUD, LEFT rail menu, audio and the test hooks.
// The sim itself stays pure in src/sim.
import { AudioEngine, type Sfx } from '../audio/audio';
import { Voice } from '../audio/voice';
import { InputDevices } from '../input/devices';
import { CATCH_HOLD, DIVERT_HOLD, keyLabel, lerpAngle, worldToScreen } from '../input/mapping';
import {
  AutoDirector,
  BEACH_CAM,
  CAMERA_IDS,
  CAMERA_LABELS,
  TOWER_CAM,
  WIDE_CAM,
  stickYawFrom,
  stickYawOf,
  type CameraId,
  type ShotInput,
} from '../render/cameras';
import { AdaptiveQuality, autoStartTier } from '../render/quality';
import type { FrameState } from '../render/scene';
import { View, hasWebGL2 } from '../render/view';
import { CADET_AIM_FREEZE, ghostPath } from '../sim/autopilot';
import {
  BOOSTER_DIAMETER,
  CONTACT_CLEAN,
  CONTACT_COM_Y,
  COM_ABOVE_BASE,
  DT,
  ENGINE_COUNT,
  ENGINE_THRUST,
  RAD,
  RAIL_Y,
  SHORELINE_X,
  SOUND_SPEED,
} from '../sim/constants';
import { commandFor } from '../sim/control';
import { countRunning } from '../sim/engines';
import { makeGoNoGo } from '../sim/gonogo';
import { pinHeightAboveRails, pinPosition, stopHeight, timeToContact, uprightPinOffset } from '../sim/predictor';
import { T_DIVERT, T_DIVERT_END, idealIgnitionHeight } from '../sim/reference';
import { InputRecorder, inputAt } from '../sim/replay';
import type { ScoreBreakdown } from '../sim/scoring';
import { buildTimeline, flightSeries, frameAt, type Timeline, type TimelineFrame } from '../sim/timeline';
import { TIER_CONFIG, type TierId } from '../sim/tiers';
import { tipFor } from '../sim/tips';
import { makeArms } from '../sim/tower';
import { NEUTRAL_INPUT, type EngineState, type PilotInput, type SimEvent, type World } from '../sim/types';
import { axisFromTilt, tiltAngle, type Vec2, type Vec3 } from '../sim/vec';
import { windAt } from '../sim/wind';
import { createWorld, scoreWorld, slowMoActive, stepWorld, tauOf } from '../sim/world';
import { clearMyData } from '../sw-register';
import { el } from '../ui/dom';
import { CADET_ON_RING, Hud, type HudData } from '../ui/hud';
import { cadetPinTone, pinTone, tiltTone, type Tone } from '../ui/tolerance';
import { Menu, type DebriefData } from '../ui/menu';
import { ReplayBar } from '../ui/replaybar';
import { TouchControls, isTouchDevice } from '../ui/touch';
import { TutorialView, keyWords, tutorialLine, type InputKind, type KeyWords } from '../ui/tutorialView';
import type { Hooks } from './params';
import { ReplayClock } from './scrubber';
import { defaultSettings, loadBest, loadSettings, saveBest, saveSettings, type Settings } from './storage';
import { Tutorial } from './tutorial';

const MAX_STEPS_PER_FRAME = 2400; // 20 s of sim: keeps timescale 16 smooth on slow devices
const SLOW_MO = 0.35;
const SPLASH_SECONDS = 4;
const DEBRIEF_DELAY_CAUGHT = 2.5;
const DEBRIEF_DELAY_SPLASH = SPLASH_SECONDS + 0.5;
/** The sonic boom (made high up, while supersonic) reaches the beach ~19 s after ignition. */
const BOOM_AFTER_IGNITION: Record<CameraId, number> = { beach: 19, wide: 19.6, towerTop: 15.5, chase: 14, onboard: 13 };
const COUNT_UP_SECONDS = 1.4;
const SPLIT_CAMS: readonly CameraId[] = ['beach', 'towerTop', 'chase', 'wide'];
/** s: across a camera cut the stick frame turns smoothly to the new camera's yaw. */
const YAW_BLEND = 0.5;
/** s: the player counts as steering for this long after the last stick deflection. */
const STEER_MEMORY = 1.2;
/** s: Cadet, steering closed: the "Steering opens…" / "Locked…" hint stays this long after release. */
const STEER_HINT_HOLD = 1.0;
/** One-word camera names for the touch camera tag. */
const CAMERA_SHORT: Record<CameraId, string> = { towerTop: 'TOWER', beach: 'BEACH', chase: 'DRONE', onboard: 'ONBOARD', wide: 'WIDE' };
/** The tutorial steer lesson, as shown in the steer banner next to the arrow (keys from the key map). */
function steerLesson(kind: InputKind, keys: KeyWords): string {
  if (kind === 'touch') return 'Drag the pad the way the arrow points';
  if (kind === 'pad') return 'Push the stick the way the arrow points';
  return `Hold ${keys.steer} the way the arrow points`;
}
/** s: a stick that moves the Cadet aim away from the ring for this long shows "Away from the ring". */
const WRONG_WAY_DELAY = 0.4;
/** A push counts as "away from the ring" when its cosine with the aim offset is above this (sideways is fine). */
const AWAY_COS = 0.3;
const NO_STICK: Readonly<Vec2> = Object.freeze({ x: 0, z: 0 });
/** The 3-2-1 ignition cue shows from this many seconds before the ideal ignition. */
const CUE_SECONDS = 3.5;
/** m/s^2: the gentle braking the V/S tone allows for (reach 2 m/s at the rails from here). */
const VS_BRAKE = 1.5;

/** V/S tone near the arms: against the speed from which gentle braking still gives a clean contact. */
function vsToneFor(down: number, pinHeight: number): Tone | null {
  if (pinHeight > 120) return null;
  const limit = CONTACT_CLEAN + Math.sqrt(2 * VS_BRAKE * Math.max(0, pinHeight));
  return down < 0.8 * limit ? 'ok' : down < limit ? 'warn' : 'bad';
}

/** Tutorial practice: a Cadet run flown up to the divert (the "ghost" booster the stick moves). */
interface Practice {
  world: World;
  /** The state at the start of the practice, to loop back to. */
  start: World;
  /** The shaped stick (world axes) the practice flew with this frame. */
  stick: Vec2;
}

interface Run {
  world: World;
  tier: TierId;
  seed: number;
  autopilot: boolean;
  recorder: InputRecorder;
  acc: number;
  /** Button taps not yet seen by a sim step. */
  pending: PilotInput | null;
  eventIndex: number;
  doneAtReal: number | null; // real seconds (scaled by timescale) when the sim finished
  contactT: number | null;
  /** Play time (realTime) of the pin contact (camera settle bounce) and of the CATCH press. */
  contactReal: number | null;
  catchReal: number | null;
  splashFrom: Vec3 | null;
  score: ScoreBreakdown | null;
  debriefShown: boolean;
  /** True while the tutorial runs on top of this run: the sim does not step. */
  frozen: boolean;
  /** Cadet tapped LIGHT before the mark: the HUD shows "armed"; the auto ignition lights on time. */
  lightArmed: boolean;
  /** The shaped stick (world axes) of the last sim step (the booster's bells and fins show it). */
  stick: Vec2;
}

interface ReplayState {
  tl: Timeline;
  clock: ReplayClock;
  split: boolean;
  tier: TierId;
  caught: boolean;
  eventIndex: number;
  lastT: number;
}

/** What a rendered frame needs, from a live world or a replay frame. */
interface FrameSrc {
  t: number;
  pos: Vec3;
  tilt: Vec2;
  roll: number;
  engines: readonly EngineState[];
  thrust: number;
  armProgress: number;
  rail: number;
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
  replayT: number | null;
  split: boolean;
  tutorial: string | null;
  muted: boolean;
  drawCalls: number;
  /** Booster tilt (sin components, world x/z). */
  tiltX: number;
  tiltZ: number;
  /** Cadet aim point (m, world x/z); 0 in the other tiers. */
  aimX: number;
  aimZ: number;
  /** The shaped stick the sim used this frame (world axes). */
  inputX: number;
  inputZ: number;
  /** The largest grid-fin deflection drawn now (deg, from the stick; 0 without WebGL). */
  visFinDeg: number;
}

declare global {
  interface Window {
    __catch?: CatchTestState;
  }
}

const BUTTONS = ['ignite', 'stepDown', 'closeArms', 'go', 'noGo'] as const;

const NUM_WORDS: Record<number, string> = { 10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen' };

function randomSeed(): number {
  return Math.floor(Math.random() * 2147483646) + 1;
}

function engineFrac(engines: readonly EngineState[]): number {
  let n = 0;
  for (const e of engines) if (e.mode === 'lit' || e.mode === 'spooling') n += e.throttle * (e.mode === 'lit' ? 1 : 0.5);
  return n / ENGINE_COUNT;
}

function srcFromWorld(w: World): FrameSrc {
  return { t: w.t, pos: w.pos, tilt: w.tilt, roll: w.roll, engines: w.engines, thrust: w.thrust, armProgress: w.arms.progress, rail: w.rails.compression };
}

function srcFromFrame(f: TimelineFrame): FrameSrc {
  return { t: f.t, pos: f.pos, tilt: f.tilt, roll: f.roll, engines: f.engines, thrust: f.thrust, armProgress: f.armProgress, rail: f.rail };
}

/** The booster drifting down to a gentle splashdown offshore (progress 0..1). */
function splashPose(from: Vec3, progress: number): { pos: Vec3; splash: NonNullable<FrameState['splash']> } {
  const at = { x: Math.max(from.x, SHORELINE_X + 220), y: 0, z: from.z };
  const p = Math.min(1, Math.max(0, progress));
  const k = p * p * (3 - 2 * p);
  return {
    pos: { x: from.x + (at.x - from.x) * k, y: from.y + (8 - from.y) * k, z: from.z + (at.z - from.z) * k },
    splash: { active: true, progress: p, at },
  };
}

export class Game {
  private settings: Settings;
  private readonly quality: AdaptiveQuality;
  private view: View | null = null;
  private readonly devices: InputDevices;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly touch: TouchControls;
  private readonly tutorialView: TutorialView;
  private readonly replayBar: ReplayBar;
  private readonly splitLabels: HTMLDivElement;
  private readonly fadeEl: HTMLDivElement;
  private readonly audio = new AudioEngine();
  private readonly voice = new Voice();
  private readonly director = new AutoDirector();
  /** Camera-relative steering: the stick yaw now, and the blend across a cut. */
  private stickYaw = 0;
  private yawFrom = 0;
  private yawBlend = 1;
  private yawCam: CameraId | null = null;
  private lastSteerReal = -1e9;
  /** Cadet "Away from the ring": seconds the stick has pushed the aim away from the ring centre. */
  private wrongFor = 0;
  private practice: Practice | null = null;
  private manualCam: CameraId | null = null;
  private camera: CameraId = 'wide';
  private lastCamera: CameraId = 'wide';
  private run: Run | null = null;
  private tutorial: Tutorial | null = null;
  private replay: ReplayState | null = null;
  private lastTimeline: Timeline | null = null;
  private lastDebrief: DebriefData | null = null;
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
  private readonly motionQuery: MediaQueryList | null;
  private loaderGone = false;
  /** CSS px of the bottom split panels under the replay bar (-1: measure again). */
  private splitInset = -1;
  /** Keeps --strip-bottom (the strip's lower edge) current for the touch Skip pill. */
  private stripObserver: ResizeObserver | null = null;

  constructor(
    private readonly app: HTMLElement,
    private readonly hooks: Hooks,
  ) {
    this.settings = loadSettings();
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      mq = null;
    }
    this.motionQuery = mq;
    const start = autoStartTier(navigator, screen.width, screen.height);
    // Still frames use Low: cheapest on software rasterisers, and no bloom/shadow variance.
    this.quality = new AdaptiveQuality(hooks.quality ?? (hooks.still ? 'low' : this.settings.quality), start);
    app.classList.toggle('touch', isTouchDevice());
    app.classList.toggle('still', hooks.still);

    const canvas = el('canvas', { id: 'game-canvas', 'data-testid': 'game-canvas', 'aria-label': 'Catch the Booster 3D view' });
    app.append(canvas);
    try {
      if (hasWebGL2()) this.view = new View(canvas, this.quality.profile, { preserveDrawingBuffer: hooks.active, scale: hooks.scale });
    } catch {
      this.view = null;
    }
    if (!this.view) {
      app.append(
        el('div', { id: 'notice', 'data-testid': 'no-webgl', text: '3D view unavailable on this device. The flight still runs.' }),
      );
    }

    this.devices = new InputDevices(window);
    this.devices.setKeyMap(this.settings.keys);
    this.touch = new TouchControls(app, this.devices);
    this.hud = new Hud(app, this.devices);
    this.splitLabels = el('div', { id: 'split-labels', 'aria-hidden': 'true' }, SPLIT_CAMS.map((c) => el('span', { text: CAMERA_LABELS[c] })));
    this.splitLabels.hidden = true;
    app.append(this.splitLabels);
    this.tutorialView = new TutorialView(
      app,
      () => this.tutorial?.skip(),
      () => this.tutorial?.skipStep(),
    );
    // Touch: the "Skip tutorial" pill docks under the strip, whose height changes with the
    // tier and the screen width (2 rows on an iPhone, 3 on a Pixel).
    const strip = app.querySelector<HTMLElement>('#telemetry');
    if (strip && typeof ResizeObserver !== 'undefined') {
      this.stripObserver = new ResizeObserver(() => {
        if (strip.offsetHeight > 0) app.style.setProperty('--strip-bottom', `${strip.offsetTop + strip.offsetHeight}px`);
      });
      this.stripObserver.observe(strip);
    }
    this.replayBar = new ReplayBar(app, {
      onToggle: () => this.replay?.clock.toggle(),
      onSeek: (f) => this.seekReplay(f),
      onSpeed: () => this.replay?.clock.cycleSpeed(),
      onSplit: () => this.toggleSplit(),
      onCamera: () => this.cycleCamera(),
      onExit: () => this.exitReplay(),
    });
    this.menu = new Menu(
      app,
      this.settings,
      {
        onStart: (tier) => this.onStart(tier),
        onTutorial: () => this.startTutorial(),
        onResume: () => this.setPaused(false),
        onPause: () => this.setPaused(true, true),
        onRestart: () => this.restart(),
        onMainMenu: () => this.toMainMenu(),
        onReplay: () => this.startReplay(),
        onExitReplay: () => this.exitReplay(),
        onCamera: (id) => this.pickCamera(id),
        onSettings: (s) => this.applySettings(s),
        onClearData: () => this.clearData(),
        onCapture: (on) => (this.devices.capturing = on),
      },
      loadBest,
    );
    this.fadeEl = el('div', { id: 'fade', 'aria-hidden': 'true' });
    app.append(this.fadeEl);
    this.audio.setMuted(this.settings.muted);
    this.audio.setVolume(this.settings.volume);
    this.audio.setMusicOn(this.settings.music);
    this.audio.timescale = hooks.timescale;
    this.voice.enabled = this.settings.voice && !this.settings.muted && !hooks.active;
    this.applyClasses();

    this.devices.onUiKey((k) => this.onUiKey(k));
    window.addEventListener('keydown', this.onReplayKey);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || hooks.still) return;
      if (this.run && !this.run.world.done && !this.paused && !this.run.frozen) this.setPaused(true);
      if (this.replay) this.replay.clock.playing = false;
      this.audio.pause();
    });
    this.motionQuery?.addEventListener?.('change', () => this.applyClasses());
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

  private get reducedMotion(): boolean {
    return this.settings.reducedMotion || !!this.motionQuery?.matches;
  }

  private applyClasses(): void {
    this.app.classList.toggle('reduced', this.reducedMotion);
    this.app.classList.toggle('onehand', this.settings.oneHanded);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.audio.pause();
    this.stripObserver?.disconnect();
    this.stripObserver = null;
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
      replayT: null,
      split: false,
      tutorial: null,
      muted: this.settings.muted,
      drawCalls: 0,
      tiltX: 0,
      tiltZ: 0,
      aimX: 0,
      aimZ: 0,
      inputX: 0,
      inputZ: 0,
      visFinDeg: 0,
    };
  }

  /** The loader fades out after the first rendered frame (no flash of unstyled content). */
  private hideLoader(): void {
    if (this.loaderGone) return;
    this.loaderGone = true;
    const l = document.getElementById('loader');
    if (!l) return;
    if (this.hooks.still) {
      l.remove();
      return;
    }
    l.classList.add('done');
    window.setTimeout(() => l.remove(), 700);
  }

  /** A short dip to black between menu, flight and debrief. */
  private fade(): void {
    if (this.hooks.still || this.reducedMotion) return;
    const f = this.fadeEl;
    f.classList.remove('on');
    void f.offsetWidth; // restart the CSS animation
    f.classList.add('on');
  }

  /** The prompts follow the last-used device (see InputDevices.padActive). */
  private inputKind(): InputKind {
    return this.devices.promptKind(this.app.classList.contains('touch'));
  }

  /** The lesson words for the player's current key map. */
  private keyWords(): KeyWords {
    return keyWords(this.settings.keys);
  }

  /** Keyboard play: the key labels for the LIGHT, STEP and CATCH buttons (null on touch / pad). */
  private buttonKeys(): HudData['keys'] {
    if (this.inputKind() !== 'keys') return null;
    const k = this.settings.keys;
    const label = (codes: readonly string[], fallback: string): string => {
      const c = codes[0];
      if (!c) return fallback;
      return c === 'Enter' ? '↵' : keyLabel(c);
    };
    return { light: label(k.ignite, '?'), step: label(k.stepDown, '?'), catch: label(k.catch, '?') };
  }

  // ---------------------------------------------------------------- UI keys

  private onUiKey(k: string): void {
    if (k === 'pause') {
      if (this.tutorial) this.tutorial.skip();
      else if (this.replay) {
        if (this.menu.isOpen) this.menu.close();
        else this.menu.open(true);
      } else if (this.run && !this.run.world.done) this.setPaused(!this.paused, true);
    } else if (k === 'camera') this.cycleCamera();
    else if (k === 'cameraAuto') this.pickCamera('auto');
    else if (k === 'mute') {
      this.settings = { ...this.settings, muted: !this.settings.muted };
      this.menu.setSettings(this.settings);
      this.applySettings(this.settings);
      this.hud.caption(this.settings.muted ? 'Sound off (M)' : 'Sound on (M)', this.realTime, 1.4, 'coach');
    } else {
      const id = CAMERA_IDS[Number(k.slice(3)) - 1];
      if (id) this.pickCamera(id);
    }
  }

  /** Replay keys: Space / K play-pause, ← → seek 2 s, S split, 0.5x/1x/2x with < >. */
  private onReplayKey = (e: KeyboardEvent): void => {
    const r = this.replay;
    if (!r || this.devices.capturing) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.closest('#rail') !== null)) return;
    if (e.code === 'Space' || e.code === 'KeyK') r.clock.toggle();
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      r.clock.seek(r.clock.t + (e.code === 'ArrowLeft' ? -2 : 2));
      this.afterSeek();
    } else if (e.code === 'KeyS') this.toggleSplit();
    else if (e.code === 'Comma' || e.code === 'Period') r.clock.cycleSpeed();
    else return;
    e.preventDefault();
  };

  private cycleCamera(): void {
    const i = CAMERA_IDS.indexOf(this.camera);
    this.pickCamera(CAMERA_IDS[(i + 1) % CAMERA_IDS.length] ?? 'wide');
  }

  // ---------------------------------------------------------------- runs

  private onStart(tier: TierId): void {
    const wantTutorial = tier === 'cadet' && !this.settings.tutorialDone && (!this.hooks.active || this.hooks.tutorial);
    if (wantTutorial || (this.hooks.tutorial && tier === 'cadet')) this.startTutorial();
    else this.startRun(tier, { seed: this.hooks.seed ?? randomSeed(), autopilot: this.hooks.autopilot });
  }

  /** The Cadet tutorial runs on top of a frozen Cadet run; when it ends, the run flies. */
  private startTutorial(): void {
    this.startRun('cadet', { seed: this.hooks.seed ?? randomSeed(), autopilot: false });
    const r = this.run;
    if (!r) return;
    r.frozen = true;
    this.tutorial = new Tutorial();
    this.practice = this.makePractice(r.seed);
    this.menu.setMode('tutorial');
    this.app.classList.add('tutorial');
    this.hud.clearCaption();
    this.director.reset();
    this.view?.resetCameras();
    this.speak(tutorialLine('steer', this.inputKind(), this.keyWords()));
  }

  /**
   * The steer-step practice: the real Cadet sim, flown hands-off to just after the divert
   * starts. The player's stick moves its aim point; it loops back before it reaches the arms.
   */
  private makePractice(seed: number): Practice | null {
    const w = createWorld(seed, 'cadet');
    let guard = 0;
    while (!w.done && guard++ < 120 * 60) {
      const tau = tauOf(w);
      if (tau !== null && w.flags.divert && tau >= T_DIVERT + 0.5) return { world: w, start: structuredClone(w), stick: { x: 0, z: 0 } };
      stepWorld(w, commandFor(w, NEUTRAL_INPUT, false));
    }
    return null;
  }

  /** Steps the practice booster in real time with the player's (world-axis) stick. */
  private stepPractice(p: Practice, input: PilotInput, seconds: number): void {
    const n = Math.min(240, Math.round(seconds / DT));
    const inp = { ...NEUTRAL_INPUT, stickX: input.stickX, stickZ: input.stickZ };
    p.stick = { x: input.stickX, z: input.stickZ };
    for (let i = 0; i < n; i++) {
      const tau = tauOf(p.world);
      if (p.world.done || (tau !== null && tau > T_DIVERT_END)) p.world = structuredClone(p.start);
      stepWorld(p.world, commandFor(p.world, inp, false));
    }
  }

  /** Speaks a coach line (Cadet only, offline voices only, when the setting is on). */
  private speak(text: string | null): void {
    if (text) this.voice.say(text);
  }

  private endTutorial(): void {
    const t = this.tutorial;
    if (!t) return;
    this.tutorial = null;
    this.practice = null;
    this.tutorialView.hide();
    this.app.classList.remove('tutorial');
    this.director.reset();
    this.view?.resetCameras();
    this.settings = { ...this.settings, tutorialDone: true };
    saveSettings(this.settings);
    this.menu.setSettings(this.settings);
    this.devices.reset();
    this.touch.reset();
    const r = this.run;
    if (r) {
      r.frozen = false;
      r.pending = null;
      this.menu.setMode('playing');
      const line = t.skipped ? 'Tutorial skipped. Have fun!' : 'Great! Now fly it for real.';
      this.callout(line, 'blip', 'coach');
      this.speak(line);
    }
  }

  private startRun(tier: TierId, o: { seed: number; autopilot: boolean }): void {
    if (!this.hooks.still) this.audio.unlock(); // still frames have no user gesture
    this.exitReplayState();
    this.tutorial = null;
    this.practice = null;
    this.tutorialView.hide();
    this.app.classList.remove('tutorial');
    this.audio.resetRun();
    this.voice.stop();
    this.devices.reset();
    this.touch.reset();
    this.hud.clearCaption();
    this.director.reset();
    this.view?.resetCameras();
    const world = createWorld(o.seed, tier);
    // The autopilot flies to the centre and ignores the Cadet aim point: show that on the HUD.
    if (o.autopilot) world.aim = { x: 0, z: 0 };
    this.run = {
      world,
      tier,
      seed: o.seed,
      autopilot: o.autopilot,
      recorder: new InputRecorder(),
      acc: 0,
      pending: null,
      eventIndex: 0,
      doneAtReal: null,
      contactT: null,
      contactReal: null,
      catchReal: null,
      splashFrom: null,
      score: null,
      debriefShown: false,
      frozen: false,
      lightArmed: false,
      stick: { x: 0, z: 0 },
    };
    this.paused = false;
    this.menu.setMode('playing');
    this.hud.setVisible(true);
    this.app.classList.toggle('tier-cadet', tier === 'cadet');
    this.releaseFocus();
    this.fade();
    this.processEvents(this.run);
  }

  /** Enter / Space are flight keys: never let them re-click the menu button that has focus. */
  private releaseFocus(): void {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== document.body) a.blur();
  }

  private restart(): void {
    const tier = this.run?.tier ?? this.replay?.tier ?? this.settings.tier;
    this.startRun(tier, { seed: this.hooks.seed ?? randomSeed(), autopilot: this.hooks.autopilot });
  }

  private toMainMenu(): void {
    this.exitReplayState();
    this.tutorial = null;
    this.practice = null;
    this.voice.stop();
    this.tutorialView.hide();
    this.app.classList.remove('tutorial');
    this.run = null;
    this.paused = false;
    this.audio.resetRun();
    this.audio.resume();
    this.audio.updateRoar(0, 0, false, 1000);
    this.hud.setVisible(false);
    this.hud.clearCaption();
    this.menu.setMode('main');
    this.fade();
  }

  private setPaused(p: boolean, focus = false): void {
    if (!this.run || this.run.frozen) return;
    if (this.run.world.done && p) return;
    this.paused = p;
    this.devices.reset();
    if (p) {
      this.audio.pause();
      this.menu.setMode('paused', focus);
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

  private applySettings(s: Settings, persist = true): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    if (persist) saveSettings(s);
    this.audio.setMuted(s.muted);
    this.audio.setVolume(s.volume);
    this.audio.setMusicOn(s.music);
    this.voice.enabled = s.voice && !s.muted && !this.hooks.active;
    if (!this.voice.enabled) this.voice.stop();
    this.devices.setKeyMap(s.keys);
    this.applyClasses();
    if (qualityChanged && !this.hooks.still && !this.hooks.quality) {
      this.quality.set(s.quality);
      this.view?.applyQuality(this.quality.profile);
    }
  }

  private clearData(): void {
    void clearMyData();
    const d = defaultSettings();
    this.menu.setSettings(d);
    this.applySettings(d, false);
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
      let inp = input;
      if (r.pending) {
        inp = { ...input };
        for (const b of BUTTONS) inp[b] = inp[b] || r.pending[b];
        r.pending = null;
      }
      r.recorder.record(w.step, inp);
      stepWorld(w, commandFor(w, inp, r.autopilot));
      r.stick.x = inp.stickX;
      r.stick.z = inp.stickZ;
      r.acc -= DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) r.acc = 0;
    if (w.done) {
      r.acc = 0;
      r.stick.x = 0;
      r.stick.z = 0;
    }
    this.processEvents(r);
  }

  /**
   * Camera-relative steering: follows the active camera's yaw, and turns smoothly over
   * YAW_BLEND seconds after a cut, so the stick never flips under the thumb.
   */
  private updateStickYaw(dt: number): void {
    const id = this.camera;
    const w = this.practice?.world ?? this.run?.world;
    let target = this.stickYaw;
    const cam = this.view?.rigs[id].camera;
    if (cam) target = stickYawOf(cam);
    else if (w) {
      const c = this.camPos(id, w.pos);
      target = stickYawFrom({ x: w.pos.x - c.x, y: w.pos.y - c.y, z: w.pos.z - c.z }, { x: 0, y: 1, z: 0 });
    }
    if (this.yawCam === null) {
      this.yawCam = id;
      this.yawBlend = 1;
      this.stickYaw = target;
      return;
    }
    if (id !== this.yawCam) {
      this.yawCam = id;
      this.yawFrom = this.stickYaw;
      this.yawBlend = 0;
    }
    this.yawBlend = Math.min(1, this.yawBlend + dt / YAW_BLEND);
    const k = this.yawBlend * this.yawBlend * (3 - 2 * this.yawBlend);
    this.stickYaw = k >= 1 ? target : lerpAngle(this.yawFrom, target, k);
  }

  /**
   * Cadet: the stick (world axes) pushes the aim point away from the ring centre, measured each
   * frame. A sideways push is fine and says nothing. After WRONG_WAY_DELAY the HUD pulses the
   * arrow: "Away from the ring".
   */
  private updateWrongWay(w: World, dt: number, stick: Readonly<Vec2>): void {
    const a = Math.hypot(w.aim.x, w.aim.z);
    const s = Math.hypot(stick.x, stick.z);
    const canMove =
      w.cfg.control === 'cadet' &&
      w.flags.divert &&
      !w.done &&
      a >= CADET_ON_RING &&
      pinHeightAboveRails(w.pos, w.tilt) > CADET_AIM_FREEZE;
    // The aim offset points away from the centre: a push along it moves the aim away.
    const away = s > 0.3 && (stick.x * w.aim.x + stick.z * w.aim.z) / (s * a || 1) > AWAY_COS;
    this.wrongFor = canMove && away ? this.wrongFor + dt : 0;
  }

  /**
   * The camera tag. Touch screens get one short word (BEACH, TOWER, DRONE, PRACTICE...) so it
   * fits on one line between the thumbs; wide screens the full name and "· auto".
   */
  private cameraTag(mode: 'live' | 'practice' | 'replay' | 'split'): string {
    const touch = this.app.classList.contains('touch');
    if (mode === 'split') return touch ? 'SPLIT' : 'Split · synced cams';
    if (touch) {
      if (mode === 'practice') return 'PRACTICE';
      const short = CAMERA_SHORT[this.camera];
      return mode === 'replay' ? `${short} · REPLAY` : short;
    }
    const name = `${CAMERA_LABELS[this.camera]}${this.manualCam ? '' : ' · auto'}`;
    return mode === 'practice' ? `Practice · ${name}` : mode === 'replay' ? `${name} · REPLAY` : name;
  }

  /** True while the player has been on the stick recently. */
  private get steering(): boolean {
    return this.realTime - this.lastSteerReal < STEER_MEMORY;
  }

  private camPos(id: CameraId, boosterPos: Vec3): Vec3 {
    const c = this.view?.rigs[id].camera.position;
    if (c) return { x: c.x, y: c.y, z: c.z };
    if (id === 'beach') return BEACH_CAM;
    if (id === 'wide') return WIDE_CAM;
    if (id === 'towerTop') return TOWER_CAM;
    return { x: boosterPos.x + 80, y: boosterPos.y, z: boosterPos.z - 120 };
  }

  private delayFrom(src: Vec3, boosterPos: Vec3): number {
    const c = this.camPos(this.camera, boosterPos);
    return Math.hypot(src.x - c.x, src.y - c.y, src.z - c.z) / SOUND_SPEED;
  }

  private callout(text: string, sfx: Sfx | null = 'blip', kind: 'radio' | 'coach' = 'radio'): void {
    this.hud.caption(text, this.realTime, 3.2, kind);
    if (sfx) this.audio.play(sfx);
  }

  private processEvents(r: Run): void {
    const w = r.world;
    while (r.eventIndex < w.events.length) {
      const e = w.events[r.eventIndex++];
      if (!e) continue;
      if (e.type === 'contact') {
        r.contactT = w.t;
        r.contactReal = this.realTime;
        this.devices.thud();
      }
      if (e.type === 'armsCloseStart') r.catchReal = this.realTime;
      this.onEvent(e, { tier: r.tier, pos: w.pos, coach: r.tier === 'cadet' && !r.autopilot });
    }
  }

  /** Captions, radio callouts and sounds for one sim event (live runs and replays). */
  private onEvent(e: SimEvent, c: { tier: TierId; pos: Vec3; coach: boolean }): void {
    const tower: Vec3 = { x: 0, y: RAIL_Y, z: 0 };
    const fd = c.tier === 'fd';
    switch (e.type) {
      case 'runStart':
        this.callout('Heron booster on final approach. Stand by for the landing burn.');
        break;
      case 'ignition': {
        const n = Number(e.data?.['engines'] ?? 13);
        this.callout(`Landing burn, we have ${NUM_WORDS[n] ?? String(n)}.`);
        // The double crack of the sonic boom arrives long after the light.
        this.audio.play('boom', BOOM_AFTER_IGNITION[this.camera], this.camera === 'beach' || this.camera === 'wide' ? 1 : 0.55);
        break;
      }
      case 'engineLit':
        this.audio.play('relight', this.delayFrom(c.pos, c.pos), 0.6);
        break;
      case 'engineFail':
        this.callout(`Engine ${Number(e.data?.['engine'] ?? 0) + 1} did not relight. Still flying.`);
        break;
      case 'stepDown':
        this.callout('Down to three.');
        break;
      case 'goNoGoPoll':
        if (fd) this.callout('Flight Director, poll for catch. Read the board: GO or NO-GO?');
        break;
      case 'go':
        this.callout('Flight Director, we are GO for catch.');
        break;
      case 'noGo':
        this.callout('No-go, divert.');
        break;
      case 'divertStart':
        // The stick starts to act now: the coach line is an instruction, with the arrow.
        if (c.coach) this.coach('Steer onto the ring! Push the stick the way the arrow points.', 'tick');
        else this.callout('Divert. Swinging in toward the tower.', null);
        break;
      case 'hover':
        if (c.coach) this.coach('Good! Keep the pins inside the ring.');
        else this.callout('Vertical. Settling beside the arms.', null);
        break;
      case 'catchPrompt':
        if (c.coach) this.coach('Press and hold CATCH now!', 'tick');
        else this.callout('Stand by to catch.', 'tick');
        break;
      case 'armsCloseStart':
        this.callout('Arms closing.');
        this.hud.flashCatch();
        this.audio.play('hiss', this.delayFrom(tower, c.pos));
        break;
      case 'armsClosed':
        this.audio.play('clunk', this.delayFrom(tower, c.pos));
        break;
      case 'contact':
        this.audio.play('thud', this.delayFrom(tower, c.pos));
        break;
      case 'caught':
        this.callout('CATCH!');
        this.audio.play('creak', this.delayFrom(tower, c.pos));
        this.audio.play('crowd', 0.3);
        this.audio.play('stingerCatch', 0.4);
        break;
      case 'bounce':
        this.callout('Bounced off the rails. Diverting to the sea.');
        break;
      case 'flameout':
        this.callout('Out of propellant. Gliding to a soft splashdown.');
        break;
      case 'splashdown':
        this.callout('Soft splashdown. The recovery boat is on the way.', 'splash');
        this.audio.play('stingerSplash', 1.2);
        break;
      default:
        break;
    }
  }

  /** A Cadet coach line: a coach caption, and spoken when the voice coach is on. */
  private coach(text: string, sfx: Sfx | null = null): void {
    this.callout(text, sfx, 'coach');
    this.speak(text);
  }

  private finishRun(r: Run): void {
    const w = r.world;
    if (r.doneAtReal === null) {
      r.doneAtReal = this.realTime;
      r.score = scoreWorld(w);
      if (w.phase === 'splashdown') r.splashFrom = { ...w.pos };
    }
    const delay = (w.outcome?.caught ? DEBRIEF_DELAY_CAUGHT : DEBRIEF_DELAY_SPLASH) / this.hooks.timescale;
    if (!r.debriefShown && this.realTime - r.doneAtReal >= delay) this.showDebrief(r);
  }

  private showDebrief(r: Run): void {
    r.debriefShown = true;
    const w = r.world;
    const score = r.score ?? scoreWorld(w);
    const caught = !!w.outcome?.caught;
    // The best before this run, then this run's result, so the debrief never shows a stale best.
    const before = loadBest(r.tier);
    const beats = caught && score.total > before;
    const saved = caught && !this.hooks.still ? saveBest(r.tier, score.total, score.medal) : false;
    const newBest = saved || beats;
    const best = beats ? score.total : before;
    const goodCall = !!w.outcome?.goodCall;
    // Deterministic replay: re-fly seed + tier + input log. The graphs come from it too.
    let tl: Timeline | null = null;
    try {
      tl = buildTimeline({ seed: r.seed, tier: r.tier, log: r.recorder.log, autopilot: r.autopilot });
    } catch {
      tl = null;
    }
    this.lastTimeline = tl;
    const d: DebriefData = {
      tier: r.tier,
      caught,
      title: caught ? 'Caught by the arms!' : goodCall ? 'Good Call: safe splashdown' : 'Soft splashdown',
      tip: tipFor(w.outcome?.reason ?? null, score.medal, r.tier),
      score,
      best,
      newBest,
      isReplay: false,
      goodCall,
      series: tl ? flightSeries(tl) : null,
      marks: { ignitionT: tl?.ignitionT ?? null, contactT: tl?.contactT ?? null },
      countSeconds: this.hooks.still || this.reducedMotion ? 0 : COUNT_UP_SECONDS / this.hooks.timescale,
    };
    this.lastDebrief = d;
    // The debrief owns the screen: no telemetry strip, sticks, captions or camera tag.
    this.hud.setVisible(false);
    this.hud.clearCaption();
    this.menu.showDebrief(d);
    this.audio.setMusic(0, false);
  }

  // ---------------------------------------------------------------- replay

  private startReplay(): void {
    const tl = this.lastTimeline;
    const d = this.lastDebrief;
    if (!tl || !d) return;
    const caught = !!tl.world.outcome?.caught;
    const tail = caught ? DEBRIEF_DELAY_CAUGHT : SPLASH_SECONDS;
    const clock = new ReplayClock(tl.duration + tail);
    this.replay = { tl, clock, split: false, tier: d.tier, caught, eventIndex: 0, lastT: 0 };
    this.director.reset();
    this.view?.resetCameras();
    this.audio.unlock();
    this.audio.resume();
    this.audio.resetRun();
    this.hud.clearCaption();
    this.hud.setVisible(true);
    this.replayBar.setVisible(true);
    this.app.classList.add('replaying');
    this.menu.setMode('replay');
    this.releaseFocus();
    this.fade();
  }

  private exitReplayState(): void {
    if (!this.replay) return;
    this.replay = null;
    this.replayBar.setVisible(false);
    this.splitLabels.hidden = true;
    this.app.classList.remove('replaying', 'split-view');
    this.audio.resetRun();
  }

  private exitReplay(): void {
    if (!this.replay) return;
    this.exitReplayState();
    const d = this.lastDebrief;
    if (d) {
      this.hud.setVisible(false);
      this.hud.clearCaption();
      this.menu.showDebrief({ ...d, isReplay: true, newBest: false, countSeconds: 0 });
    } else this.toMainMenu();
  }

  private seekReplay(frac: number): void {
    const r = this.replay;
    if (!r) return;
    r.clock.seekFrac(frac);
    this.afterSeek();
  }

  /** After a jump: skip the events in between and let the director pick afresh. */
  private afterSeek(): void {
    const r = this.replay;
    if (!r) return;
    const ev = r.tl.events;
    let i = 0;
    while (i < ev.length && (ev[i]?.t ?? Infinity) <= r.clock.t) i++;
    r.eventIndex = i;
    r.lastT = r.clock.t;
    this.director.reset();
    this.audio.resetRun();
    this.hud.clearCaption();
  }

  private toggleSplit(): void {
    const r = this.replay;
    if (!r) return;
    r.split = !r.split;
    r.clock.setSplit(r.split);
    this.splitInset = -1;
    this.splitLabels.hidden = !r.split;
    this.afterSeek();
  }

  private stepReplay(dt: number): void {
    const r = this.replay;
    if (!r) return;
    const ended = r.clock.update(dt * this.hooks.timescale);
    // Events between the last frame and now (forward play only).
    const t = Math.min(r.clock.t, r.tl.duration);
    if (t >= r.lastT) {
      const ev = r.tl.events;
      while (r.eventIndex < ev.length && (ev[r.eventIndex]?.t ?? Infinity) <= t) {
        const e = ev[r.eventIndex++];
        if (e) this.onEvent(e, { tier: r.tier, pos: frameAt(r.tl, e.t).pos, coach: false });
      }
    }
    r.lastT = t;
    if (ended) this.exitReplay();
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
    if (this.replay) {
      this.realTime += dt * this.hooks.timescale;
      this.stepReplay(dt);
    } else if (r && !this.paused) {
      this.realTime += dt * this.hooks.timescale;
      this.updateStickYaw(dt);
      const input = this.devices.sample(dt, this.stickYaw);
      if (this.devices.rawStick > 0.25) this.lastSteerReal = this.realTime;
      if (r.frozen && this.tutorial) {
        const t = this.tutorial;
        const before = t.step;
        t.update(dt, {
          stick: Math.hypot(input.stickX, input.stickZ),
          ignite: input.ignite,
          closeArms: input.closeArms,
        });
        if (t.step === 'steer' && this.practice) {
          this.stepPractice(this.practice, input, dt * this.hooks.timescale);
          this.updateWrongWay(this.practice.world, dt, this.practice.stick);
        }
        if (t.step !== before) {
          if (before === 'steer') {
            // Back to the frozen run: the cameras jump to it.
            this.practice = null;
            this.director.reset();
            this.view?.resetCameras();
          }
          this.speak(tutorialLine(t.step, this.inputKind(), this.keyWords()));
        }
        this.tutorialView.update(t, this.inputKind(), this.keyWords());
        if (t.finished) this.endTutorial();
      } else {
        if (r.tier === 'cadet' && !r.autopilot && input.ignite && r.world.phase === 'coast') r.lightArmed = true;
        const scale = this.hooks.timescale * (slowMoActive(r.world) ? SLOW_MO : 1);
        if (!r.world.done) this.stepRun(r, input, dt * scale);
        this.updateWrongWay(r.world, dt, r.stick);
        if (r.world.done) this.finishRun(r);
        this.devices.rumble(r.world.done ? 0 : engineFrac(r.world.engines), now);
      }
    } else if (!r) this.realTime += dt;
    this.draw(dt, false);
    if (!this.loaderGone && this.frames >= 1) this.hideLoader();
    if (this.test && !this.test.ready && this.frames >= 2) this.test.ready = true;
  };

  private makeFrame(
    src: FrameSrc,
    renderT: number,
    pos: Vec3,
    splash: FrameState['splash'],
    aids: FrameState['aids'],
    hero: boolean,
    after: { impact: number | null; vent: number; sinceCutoff?: number | null; divert?: boolean; stick?: Readonly<Vec2> },
  ): { frame: FrameState; shot: ShotInput } {
    const thrustFrac = src.thrust / (ENGINE_COUNT * ENGINE_THRUST);
    const reduced = this.reducedMotion;
    const frame: FrameState = {
      t: renderT,
      simT: src.t,
      railCompression: src.rail,
      pos,
      tilt: src.tilt,
      roll: src.roll,
      engines: src.engines,
      thrustFrac,
      armProgress: src.armProgress,
      aids,
      splash,
      reducedMotion: reduced,
      vent: after.vent,
      sinceCutoff: after.sinceCutoff ?? null,
      hero,
      stick: after.stick ?? NO_STICK,
    };
    const shot: ShotInput = {
      com: pos,
      axis: axisFromTilt(src.tilt),
      thrustFrac,
      t: renderT,
      reducedMotion: reduced,
      hero,
      impact: after.impact,
      divert: after.divert ?? false,
    };
    return { frame, shot };
  }

  private noAids(pinWindow: number): FrameState['aids'] {
    return { show: false, ring: false, ghost: [], pinGhost: null, ringRadius: BOOSTER_DIAMETER / 2 + pinWindow, flash: 0, tone: 'bad' };
  }

  /** The frame for the live run (or the menu backdrop). */
  private liveFrame(w: World, t: number, active: boolean): { frame: FrameState; shot: ShotInput } {
    const r = this.run;
    let pos = w.pos;
    let splash: FrameState['splash'] = null;
    if (active && r && r.splashFrom && r.doneAtReal !== null) {
      const p = splashPose(r.splashFrom, (this.realTime - r.doneAtReal) / SPLASH_SECONDS);
      pos = p.pos;
      splash = p.splash;
    }
    const flying = active && !w.done && (w.phase === 'burn13' || w.phase === 'burn3');
    let aids = this.noAids(w.cfg.pinWindow);
    if (flying) {
      const pin = pinPosition(w.pos, w.tilt);
      // The target ring (every tier): the hull fits inside it when the pins are in the window.
      const ringRadius = BOOSTER_DIAMETER / 2 + w.cfg.pinWindow;
      // Ring tone: Cadet from the aim error; the others from the upright pins. Teal (ok) while
      // nominal and higher than the final approach (the ring is a target, not an alarm).
      const up = w.cfg.id === 'cadet' ? w.aim : uprightPinOffset(w.pos);
      const tone = pinTone(Math.hypot(up.x, up.z), pin.y - RAIL_Y, w.cfg.pinWindow) ?? 'ok';
      // The target ring flashes when CATCH is pressed.
      const pressed = r ? r.catchReal : null;
      const flash = pressed !== null ? Math.max(0, 1 - (this.realTime - pressed) / 0.7) : 0;
      aids = { show: false, ring: true, ghost: [], pinGhost: null, ringRadius, flash, tone };
      if (w.cfg.id === 'cadet') {
        // Cadet extras: the ghost path and where the pins will cross the rails.
        const tgo = Math.min(timeToContact(pin.y - RAIL_Y, w.vel.y), 8);
        aids.show = true;
        aids.ghost = ghostPath(w, 24);
        aids.pinGhost = { x: pin.x + w.vel.x * tgo, y: RAIL_Y + 0.6, z: pin.z + w.vel.z * tgo };
      }
    }
    const hero = !active && this.camera === 'wide';
    // Held in the arms: cold vapour vents gently from the booster (menu hero, catch, debrief).
    const vent = w.phase === 'caught' || w.phase === 'settling' ? 1 : 0;
    const impact = active && r && r.contactReal !== null && !this.hooks.still ? this.realTime - r.contactReal : null;
    // Seconds since the cutoff at the catch: sim time while settling, then play time once done.
    let sinceCutoff: number | null = null;
    if (active && r && r.contactT !== null && w.contact) {
      sinceCutoff = w.t - r.contactT + (r.doneAtReal !== null && !this.hooks.still ? this.realTime - r.doneAtReal : 0);
    }
    const tauNow = tauOf(w);
    const divert = flying && tauNow !== null && tauNow >= T_DIVERT && !w.arms.closing;
    // The stick the sim flew with: the practice booster's in the tutorial, else the run's.
    let stick: Readonly<Vec2> = NO_STICK;
    if (active && r && !w.done) stick = this.practice && w === this.practice.world ? this.practice.stick : r.stick;
    return this.makeFrame(srcFromWorld(w), t, pos, splash, aids, hero, { impact, vent, sinceCutoff, divert, stick });
  }

  /** The frame for the replay player at its clock time. */
  private replayFrame(rp: ReplayState): { frame: FrameState; shot: ShotInput; f: TimelineFrame } {
    const tl = rp.tl;
    const f = frameAt(tl, rp.clock.t);
    let pos = f.pos;
    let splash: FrameState['splash'] = null;
    if (!rp.caught && rp.clock.t > tl.duration) {
      const p = splashPose(f.pos, (rp.clock.t - tl.duration) / SPLASH_SECONDS);
      pos = p.pos;
      splash = p.splash;
    }
    const src = srcFromFrame(f);
    const contact = tl.contactT;
    const impact = contact !== null && rp.clock.t >= contact ? rp.clock.t - contact : null;
    const vent = f.phase === 'caught' || f.phase === 'settling' ? 1 : 0;
    const sinceCutoff = contact !== null && rp.clock.t >= contact ? rp.clock.t - contact : null;
    const divert = (f.phase === 'burn13' || f.phase === 'burn3') && f.tau !== null && f.tau >= T_DIVERT && !f.armsClosing;
    // The stick from the input log, so the bells and fins move as they did live.
    let stick: Readonly<Vec2> = NO_STICK;
    if (rp.clock.t < tl.duration) {
      const inp = inputAt(tl.log, Math.floor(rp.clock.t / DT + 1e-9));
      stick = { x: inp.stickX, z: inp.stickZ };
    }
    const { frame, shot } = this.makeFrame(src, rp.clock.t, pos, splash, this.noAids(TIER_CONFIG[rp.tier].pinWindow), false, {
      impact,
      vent,
      sinceCutoff,
      divert,
      stick,
    });
    return { frame, shot, f };
  }

  private draw(dt: number, snap: boolean): void {
    const rp = this.replay;
    if (rp) {
      this.drawReplay(rp, dt, snap);
      return;
    }
    this.splitLabels.hidden = true;
    const r = this.run;
    // Tutorial steer step: show the practice booster instead of the frozen run.
    const practice = r && this.tutorial?.step === 'steer' ? this.practice : null;
    const w = practice ? practice.world : r ? r.world : this.menuBackdrop;
    if (practice) {
      // The tight divert framing of the beach lens: the practice booster is large.
      this.camera = this.manualCam ?? 'beach';
    } else if (r) {
      const tau = tauOf(w);
      const auto = this.director.update(w.phase, tau, w.arms.closing, r.contactT ?? r.world.outcome?.t ?? null, w.t, this.steering);
      this.camera = this.manualCam ?? auto;
    } else if (!this.manualCam) this.camera = 'wide';
    this.menu.setCamera(this.camera, this.manualCam === null);
    const flying = !!r && !r.world.done;
    if (flying !== this.app.classList.contains('flying')) this.app.classList.toggle('flying', flying);

    const t = this.hooks.still ? 0 : r ? w.t : this.realTime;
    const { frame, shot } = this.liveFrame(w, t, !!r);
    if (this.view) {
      // A cut restarts the beach lens focus pull.
      if (this.camera !== this.lastCamera && !snap) this.view.rigs[this.camera].cut();
      this.lastCamera = this.camera;
      // Picture-in-picture: only with post-processing tiers (keeps Low under its draw-call budget).
      const pipCam = r && flying && !r.frozen && this.view.hasPost && !this.hooks.still ? AutoDirector.pip(this.camera, w.phase, tauOf(w)) : null;
      this.hud.setPip(pipCam ? CAMERA_LABELS[pipCam] : null);
      const rect = pipCam ? this.hud.pipRect(this.app) : null;
      this.view.render(frame, this.camera, shot, dt, snap, pipCam && rect ? { cam: pipCam, rect } : null);
      if (!snap) this.view.trackAll(shot, dt, pipCam ? [this.camera, pipCam] : [this.camera]);
    }
    if (r) {
      const camPos = this.camPos(this.camera, w.pos);
      const dist = Math.hypot(w.pos.x - camPos.x, w.pos.y - camPos.y, w.pos.z - camPos.z);
      const speed = Math.hypot(w.vel.x, w.vel.y, w.vel.z);
      const fins = w.phase === 'coast' || w.phase === 'burn13' ? Math.min(1, Math.max(0, (speed - 60) / 220)) : 0;
      this.audio.updateRoar(w.t, Math.min(1, engineFrac(w.engines) * 2.2), w.phase === 'burn3', dist, fins);
      this.audio.setMusic(this.musicIntensity(w), !w.done);
      this.hud.update(this.hudData(r, w, !!practice), this.realTime);
    } else this.audio.setMusic(0, true);
    this.updateTestState();
  }

  private drawReplay(rp: ReplayState, dt: number, snap: boolean): void {
    const { frame, shot, f } = this.replayFrame(rp);
    const auto = this.director.update(f.phase, f.tau, f.armsClosing, rp.tl.contactT, f.t);
    this.camera = this.manualCam ?? auto;
    this.menu.setCamera(this.camera, this.manualCam === null);
    if (this.app.classList.contains('flying')) this.app.classList.remove('flying');
    this.splitLabels.hidden = !rp.split;
    if (this.view) {
      if (rp.split) this.view.renderSplit(frame, SPLIT_CAMS, shot, dt, snap, Math.max(0, this.splitInset));
      else {
        if (this.camera !== this.lastCamera && !snap) this.view.rigs[this.camera].cut();
        this.lastCamera = this.camera;
        this.hud.setPip(null);
        this.view.render(frame, this.camera, shot, dt, snap, null);
        if (!snap) this.view.trackAll(shot, dt, [this.camera]);
      }
    }
    const camPos = this.camPos(rp.split ? 'beach' : this.camera, f.pos);
    const dist = Math.hypot(f.pos.x - camPos.x, f.pos.y - camPos.y, f.pos.z - camPos.z);
    const level = rp.clock.playing ? Math.min(1, engineFrac(f.engines) * 2.2) : 0;
    this.audio.updateRoar(f.t, level, f.phase === 'burn3', dist, 0);
    this.audio.setMusic(0.3, rp.clock.playing);
    this.hud.update(this.replayHud(rp, f), this.realTime);
    this.replayBar.update(rp.clock, rp.split, rp.tl.ignitionT);
    if (this.app.classList.contains('split-view') !== rp.split) this.app.classList.toggle('split-view', rp.split);
    if (rp.split && this.splitInset < 0) {
      // How much of the bottom split panels the replay bar covers (measured once per layout).
      const bar = this.replayBar.root.getBoundingClientRect();
      this.splitInset = bar.height > 0 ? Math.max(0, this.app.getBoundingClientRect().bottom - bar.top) : 0;
    }
    this.updateTestState();
  }

  /** 0 calm (coast) .. 1 full tension (pins about to reach the rails). */
  private musicIntensity(w: World): number {
    switch (w.phase) {
      case 'coast':
        return 0.12;
      case 'burn13':
        return 0.4;
      case 'burn3': {
        const hp = pinHeightAboveRails(w.pos, w.tilt);
        return 0.5 + 0.5 * (1 - Math.min(1, Math.max(0, hp / 250)));
      }
      default:
        return 0.2;
    }
  }

  private hudData(r: Run, w: World, practice: boolean): HudData {
    const tau = tauOf(w);
    const down = Math.max(-w.vel.y, 0);
    const prop0 = w.cfg.propellant[1];
    let stop: number | null = null;
    if (w.phase === 'coast' || w.phase === 'burn13' || w.phase === 'burn3') {
      const n = w.phase === 'coast' ? ENGINE_COUNT : Math.max(1, countRunning(w.engines));
      stop = stopHeight(w.pos.y, w.vel.y, w.propellant, n) - CONTACT_COM_Y;
    }
    const igniteIn = w.phase === 'coast' && down > 1 ? (w.pos.y - idealIgnitionHeight(down)) / down : null;
    const manual = !r.autopilot;
    const cfg = TIER_CONFIG[r.tier];
    const flying = w.phase === 'burn13' || w.phase === 'burn3';
    const hp = pinHeightAboveRails(w.pos, w.tilt);
    const tgo = flying ? timeToContact(hp, w.vel.y) : null;
    let wind: HudData['wind'] = null;
    if (cfg.id !== 'cadet') {
      const v = windAt(w.wind, w.pos.y, { x: 0, y: 0, z: 0 });
      wind = { speed: Math.hypot(v.x, v.z), dir: Math.atan2(v.z, v.x), gust: Math.hypot(w.wind.gustX, w.wind.gustZ), shear: w.wind.shear > 0.05 };
    }
    const tut = r.frozen ? this.tutorial : null;
    const cadet = cfg.id === 'cadet';
    // Pins vs the arm centreline, and the way to steer in screen axes.
    let pin: HudData['pin'] = null;
    if (flying && (!cadet || w.flags.divert)) {
      // Cadet: the aim error (where the divert will put the pins), which is what the stick
      // moves, so the number and the arrow answer the stick at once. Pilot / FD: the upright
      // pin offset (the lean's swing of the raw pins would invite over-steering).
      const p = cadet ? w.aim : uprightPinOffset(w.pos);
      const dist = Math.hypot(p.x, p.z);
      const [sx, sz] = worldToScreen(-p.x, -p.z, this.stickYaw);
      const l = Math.hypot(sx, sz) || 1;
      const tone = cadet ? cadetPinTone(dist, w.flags.hover, cfg.pinWindow) : pinTone(dist, hp, cfg.pinWindow);
      pin = { dist, sx: sx / l, sz: sz / l, tone };
    }
    // Cadet: the stick cannot move the aim before the divert or once it is locked for the catch
    // (the sim holds it). A held key says why (STEER_HINT_HOLD after release) and the dot dims.
    const steerShut =
      cadet && !r.autopilot && !tut && !w.done && (w.phase === 'coast' || flying) && (!w.flags.divert || hp <= CADET_AIM_FREEZE);
    const steerHeld = this.realTime - this.lastSteerReal < STEER_HINT_HOLD;
    const tiltDeg = tiltAngle(w.tilt) / RAD;
    const cue = w.phase === 'coast' && igniteIn !== null && igniteIn <= CUE_SECONDS ? Math.max(0, igniteIn) : null;
    const keys = this.buttonKeys();
    const d: HudData = {
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
      showBoard: true,
      fdDecide: manual && !cfg.autoGoNoGo,
      catchVisible: flying && (w.flags.catchPrompt || w.arms.closing) && !w.arms.closed,
      catchTgo: tgo !== null && Number.isFinite(tgo) ? tgo : null,
      catchHold: this.devices.touch.catchHeldFor / CATCH_HOLD,
      armsClosing: w.arms.closing,
      stepVisible: manual && !cfg.autoStepDown && w.phase === 'burn13',
      lightVisible: manual && w.phase === 'coast' && (!cadet || cue !== null),
      divertHold: this.devices.divertHold / DIVERT_HOLD,
      wind,
      sensorFault: cfg.id === 'fd' && w.faults.towerSensor,
      slowMo: slowMoActive(w),
      camera: this.cameraTag(practice ? 'practice' : 'live'),
      fps: this.hooks.fps && !this.hooks.still ? this.fps : null,
      paused: this.paused,
      pin,
      tilt: flying ? { deg: tiltDeg, tone: tiltTone(tiltDeg, hp, cfg.tiltLimitDeg, w.phase === 'burn3') } : null,
      vsTone: flying ? vsToneFor(down, hp) : null,
      cue,
      lightArmed: cadet && r.lightArmed && w.phase === 'coast',
      // From the divert until contact (it reads "On the ring" once the aim is centred).
      steerCue: cadet && !r.autopilot && pin !== null,
      wrongWay: cadet && !r.autopilot && this.wrongFor >= WRONG_WAY_DELAY,
      steerLock: steerShut && steerHeld ? (w.flags.divert ? 'frozen' : 'early') : null,
      inputLocked: steerShut,
      // Pilot / FD manage the fuel: a short PROP chip for the compact phone strip.
      propChip: cadet ? null : Math.min(1, w.propellant / prop0),
      foldBoard: cadet,
      // The held keys / stick, raw (it lights the same frame a key goes down).
      input: !this.paused && !w.done ? this.devices.rawIntent() : null,
      keys,
      cueKey: null,
    };
    // Keyboard play: while LIGHT is offered, the 3-2-1 cue names the key that lights the engines.
    const ignite = this.settings.keys.ignite[0];
    if (keys && d.lightVisible && ignite) d.cueKey = keyLabel(ignite);
    if (tut) {
      // Practice: show only the control this step teaches.
      d.lightVisible = tut.step === 'light';
      d.catchVisible = tut.step === 'catch';
      d.catchTgo = null;
      d.armsClosing = false;
      d.igniteIn = null;
      d.cue = null;
      d.steerCue = practice;
      // The steer lesson's words live in the banner by the arrow (the card shrinks to a pill
      // on touch and docks top right on desktop, off the practice booster).
      if (practice) d.steerText = steerLesson(this.inputKind(), this.keyWords());
      d.cueKey = null;
    }
    return d;
  }

  private replayHud(rp: ReplayState, f: TimelineFrame): HudData {
    const cfg = TIER_CONFIG[rp.tier];
    return {
      tier: rp.tier,
      phase: f.phase,
      tau: f.tau,
      altitude: Math.max(0, f.pos.y - COM_ABOVE_BASE),
      speed: Math.hypot(f.vel.x, f.vel.y, f.vel.z),
      vs: f.vel.y,
      lat: Math.hypot(f.vel.x, f.vel.z),
      propellantT: f.propellant / 1000,
      propFrac: Math.min(1, f.propellant / cfg.propellant[1]),
      engines: f.engines,
      stopMargin: null,
      igniteIn: null,
      gonogo: makeGoNoGo(),
      showBoard: false,
      fdDecide: false,
      catchVisible: false,
      catchTgo: null,
      catchHold: 0,
      armsClosing: f.armsClosing,
      stepVisible: false,
      lightVisible: false,
      divertHold: 0,
      wind: null,
      sensorFault: false,
      slowMo: false,
      camera: this.cameraTag(rp.split ? 'split' : 'replay'),
      fps: this.hooks.fps && !this.hooks.still ? this.fps : null,
      paused: false,
      pin: null,
      tilt: null,
      vsTone: null,
      cue: null,
      lightArmed: false,
      steerCue: false,
      wrongWay: false,
      propChip: null,
      foldBoard: rp.tier === 'cadet',
      input: null,
      keys: null,
      cueKey: null,
    };
  }

  private updateTestState(): void {
    const s = this.test;
    if (!s) return;
    const rp = this.replay;
    const r = this.run;
    const w = r?.world;
    s.webgl = this.view !== null;
    s.mode = this.menu.mode;
    s.tier = rp ? rp.tier : r?.tier ?? null;
    s.seed = r?.seed ?? null;
    s.phase = w ? w.phase : 'menu';
    s.t = w ? w.t : 0;
    s.tau = w ? tauOf(w) : null;
    s.outcome = w?.outcome ? { caught: w.outcome.caught, reason: w.outcome.reason } : null;
    s.score = rp ? rp.tl.score.total : r?.score ? r.score.total : null;
    s.quality = this.quality.tier;
    s.qualitySetting = this.quality.setting;
    s.qualityDrops = this.quality.drops;
    s.fps = this.fps;
    s.frames = this.frames;
    s.camera = this.camera;
    s.paused = this.paused;
    s.replay = !!rp;
    s.replayT = rp ? rp.clock.t : null;
    s.split = !!rp?.split;
    s.tutorial = this.tutorial ? this.tutorial.step : null;
    s.muted = this.settings.muted;
    s.drawCalls = this.view?.drawCalls ?? 0;
    s.tiltX = w ? w.tilt.x : 0;
    s.tiltZ = w ? w.tilt.z : 0;
    s.aimX = w && w.cfg.control === 'cadet' ? w.aim.x : 0;
    s.aimZ = w && w.cfg.control === 'cadet' ? w.aim.z : 0;
    s.inputX = r ? r.stick.x : 0;
    s.inputZ = r ? r.stick.z : 0;
    s.visFinDeg = this.view?.world.visFinDeg ?? 0;
  }

  private resize(): void {
    const w = this.app.clientWidth || window.innerWidth;
    const h = this.app.clientHeight || window.innerHeight;
    this.view?.resize(w, h);
    this.splitInset = -1;
    if (this.hooks.still) this.draw(0, true);
  }

  // ---------------------------------------------------------------- still frames (visual tests)

  private setupStill(): void {
    const h = this.hooks;
    const tier = h.tier ?? 'cadet';
    const seed = h.seed ?? 1;
    if (h.tutorial && tier === 'cadet' && !h.debrief) {
      // The tutorial's steer step: the card and the practice (ghost) booster.
      this.startTutorial();
      if (this.tutorial) this.tutorialView.update(this.tutorial, this.inputKind(), this.keyWords());
    } else if (h.debrief || h.at !== null) {
      // `manual`: the player's view (no autopilot), with the stick held from the divert.
      const manual = h.manual && !h.debrief;
      this.startRun(tier, { seed, autopilot: !manual });
      const r = this.run;
      if (!r) return;
      const w = r.world;
      const limit = h.debrief ? 120 : h.at ?? 0;
      while (!w.done && w.step < 120 / DT) {
        const tau = tauOf(w);
        if (!h.debrief && tau !== null && tau >= limit) break;
        // A negative `at`: that many seconds before the ideal ignition (the 3-2-1 cue).
        if (!h.debrief && limit < 0 && w.phase === 'coast') {
          const down = Math.max(-w.vel.y, 1);
          if ((w.pos.y - idealIgnitionHeight(down)) / down <= -limit) break;
        }
        let input = NEUTRAL_INPUT;
        if (manual && w.flags.divert) {
          // `stick=arrow` / `stick=away`: full stick along / against the HUD arrow (aim -> ring
          // centre), in world axes; otherwise world x.
          const a = Math.hypot(w.aim.x, w.aim.z);
          const k = h.stickArrow ? -1 : h.stickAway ? 1 : 0;
          input =
            k !== 0 && a > 1e-6
              ? { ...NEUTRAL_INPUT, stickX: (k * w.aim.x) / a, stickZ: (k * w.aim.z) / a }
              : { ...NEUTRAL_INPUT, stickX: h.stick };
        }
        stepWorld(w, commandFor(w, input, !manual));
        r.stick.x = input.stickX;
        r.stick.z = input.stickZ;
        // The "Away from the ring" timer, as the frame loop would run it.
        if (manual) this.updateWrongWay(w, DT, r.stick);
      }
      r.eventIndex = w.events.length;
      r.contactT = w.contact?.t ?? null;
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
    this.hideLoader();
    if (this.test) this.test.ready = true;
  }
}
