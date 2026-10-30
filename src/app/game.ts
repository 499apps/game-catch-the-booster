// The game shell: owns the run (world + input log), the fixed-step loop, the Cadet
// tutorial, the replay player, the view, HUD, LEFT rail menu, audio and the test hooks.
// The sim itself stays pure in src/sim.
import { AudioEngine, type Sfx } from '../audio/audio';
import { InputDevices } from '../input/devices';
import { CATCH_HOLD, DIVERT_HOLD } from '../input/mapping';
import { AutoDirector, BEACH_CAM, CAMERA_IDS, CAMERA_LABELS, TOWER_CAM, WIDE_CAM, type CameraId, type ShotInput } from '../render/cameras';
import { AdaptiveQuality, autoStartTier } from '../render/quality';
import type { FrameState } from '../render/scene';
import { View, hasWebGL2 } from '../render/view';
import { ghostPath } from '../sim/autopilot';
import { CONTACT_COM_Y, COM_ABOVE_BASE, DT, ENGINE_COUNT, ENGINE_THRUST, RAIL_Y, SHORELINE_X, SOUND_SPEED } from '../sim/constants';
import { commandFor } from '../sim/control';
import { countRunning } from '../sim/engines';
import { makeGoNoGo } from '../sim/gonogo';
import { pinHeightAboveRails, pinPosition, stopHeight, timeToContact } from '../sim/predictor';
import { idealIgnitionHeight } from '../sim/reference';
import { InputRecorder } from '../sim/replay';
import type { ScoreBreakdown } from '../sim/scoring';
import { buildTimeline, flightSeries, frameAt, type Timeline, type TimelineFrame } from '../sim/timeline';
import { TIER_CONFIG, type TierId } from '../sim/tiers';
import { tipFor } from '../sim/tips';
import { makeArms } from '../sim/tower';
import { NEUTRAL_INPUT, type EngineState, type PilotInput, type SimEvent, type World } from '../sim/types';
import { axisFromTilt, type Vec2, type Vec3 } from '../sim/vec';
import { windAt } from '../sim/wind';
import { createWorld, scoreWorld, slowMoActive, stepWorld, tauOf } from '../sim/world';
import { clearMyData } from '../sw-register';
import { el } from '../ui/dom';
import { Hud, type HudData } from '../ui/hud';
import { Menu, type DebriefData } from '../ui/menu';
import { ReplayBar } from '../ui/replaybar';
import { TouchControls, isTouchDevice } from '../ui/touch';
import { TutorialView, type InputKind } from '../ui/tutorialView';
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
  private readonly director = new AutoDirector();
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
    this.tutorialView = new TutorialView(app, () => this.tutorial?.skip());
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

  private inputKind(): InputKind {
    if (this.devices.padActive) return 'pad';
    return this.app.classList.contains('touch') ? 'touch' : 'keys';
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
    this.menu.setMode('tutorial');
    this.app.classList.add('tutorial');
    this.hud.clearCaption();
  }

  private endTutorial(): void {
    const t = this.tutorial;
    if (!t) return;
    this.tutorial = null;
    this.tutorialView.hide();
    this.app.classList.remove('tutorial');
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
      this.callout(t.skipped ? 'Tutorial skipped. Have fun!' : 'Great! Now fly it for real.', 'blip', 'coach');
    }
  }

  private startRun(tier: TierId, o: { seed: number; autopilot: boolean }): void {
    if (!this.hooks.still) this.audio.unlock(); // still frames have no user gesture
    this.exitReplayState();
    this.tutorial = null;
    this.tutorialView.hide();
    this.app.classList.remove('tutorial');
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
      r.acc -= DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) r.acc = 0;
    if (w.done) r.acc = 0;
    this.processEvents(r);
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
        if (c.coach) this.later(3.4, 'Nice and steady. Nudge the stick to line up with the glowing ring.');
        break;
      case 'noGo':
        this.callout('No-go, divert.');
        break;
      case 'divertStart':
        this.callout('Divert. Swinging in toward the tower.', null);
        break;
      case 'hover':
        this.callout(c.coach ? 'Good! Keep the pin ghost inside the ring.' : 'Vertical. Settling beside the arms.', null, c.coach ? 'coach' : 'radio');
        break;
      case 'catchPrompt':
        this.callout(c.coach ? 'Press and hold CATCH now!' : 'Stand by to catch.', 'tick');
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

  /** A coaching caption after `seconds` of play time (dropped if a newer run started). */
  private later(seconds: number, text: string): void {
    const run = this.run;
    const at = this.realTime + seconds;
    const check = (): void => {
      if (this.run !== run || this.disposed) return;
      if (this.paused || this.realTime < at) {
        window.setTimeout(check, 200);
        return;
      }
      this.hud.caption(text, this.realTime, 3.4, 'coach');
    };
    window.setTimeout(check, 200);
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
    const newBest = caught && !this.hooks.still ? saveBest(r.tier, score.total, score.medal) : false;
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
      tip: tipFor(w.outcome?.reason ?? null, score.medal),
      score,
      best: loadBest(r.tier),
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
    this.app.classList.remove('replaying');
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
      const input = this.devices.sample(dt);
      if (r.frozen && this.tutorial) {
        this.tutorial.update(dt, {
          stick: Math.hypot(input.stickX, input.stickZ),
          ignite: input.ignite,
          closeArms: input.closeArms,
        });
        this.tutorialView.update(this.tutorial, this.inputKind());
        if (this.tutorial.finished) this.endTutorial();
      } else {
        const scale = this.hooks.timescale * (slowMoActive(r.world) ? SLOW_MO : 1);
        if (!r.world.done) this.stepRun(r, input, dt * scale);
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
    after: { impact: number | null; vent: number },
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
      hero,
    };
    const shot: ShotInput = {
      com: pos,
      axis: axisFromTilt(src.tilt),
      thrustFrac,
      t: renderT,
      reducedMotion: reduced,
      hero,
      impact: after.impact,
    };
    return { frame, shot };
  }

  private noAids(ringRadius: number): FrameState['aids'] {
    return { show: false, ghost: [], pinGhost: null, ringRadius, flash: 0 };
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
    const showAids = active && w.cfg.id === 'cadet' && !w.done && w.phase !== 'coast';
    let aids = this.noAids(w.cfg.pinWindow);
    if (showAids) {
      const pin = pinPosition(w.pos, w.tilt);
      const tgo = Math.min(timeToContact(pin.y - RAIL_Y, w.vel.y), 8);
      const pinGhost = { x: pin.x + w.vel.x * tgo, y: RAIL_Y + 0.6, z: pin.z + w.vel.z * tgo };
      // The target ring flashes when CATCH is pressed.
      const pressed = r ? r.catchReal : null;
      const flash = pressed !== null ? Math.max(0, 1 - (this.realTime - pressed) / 0.7) : 0;
      aids = { show: true, ghost: ghostPath(w, 24), pinGhost, ringRadius: w.cfg.pinWindow, flash };
    }
    const hero = !active && this.camera === 'wide';
    // Held in the arms: cold vapour vents gently from the booster (menu hero, catch, debrief).
    const vent = w.phase === 'caught' || w.phase === 'settling' ? 1 : 0;
    const impact = active && r && r.contactReal !== null && !this.hooks.still ? this.realTime - r.contactReal : null;
    return this.makeFrame(srcFromWorld(w), t, pos, splash, aids, hero, { impact, vent });
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
    const { frame, shot } = this.makeFrame(src, rp.clock.t, pos, splash, this.noAids(TIER_CONFIG[rp.tier].pinWindow), false, { impact, vent });
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
    const w = r ? r.world : this.menuBackdrop;
    if (r) {
      const tau = tauOf(w);
      const auto = this.director.update(w.phase, tau, w.arms.closing, r.contactT ?? r.world.outcome?.t ?? null, w.t);
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
      this.hud.update(this.hudData(r), this.realTime);
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
      if (rp.split) this.view.renderSplit(frame, SPLIT_CAMS, shot, dt, snap);
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
    this.replayBar.update(rp.clock, rp.split);
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
      lightVisible: manual && w.phase === 'coast' && (cfg.id !== 'cadet' || (igniteIn !== null && igniteIn <= 3.5)),
      divertHold: this.devices.divertHold / DIVERT_HOLD,
      wind,
      sensorFault: cfg.id === 'fd' && w.faults.towerSensor,
      slowMo: slowMoActive(w),
      camera: `${CAMERA_LABELS[this.camera]}${this.manualCam ? '' : ' · auto'}`,
      fps: this.hooks.fps && !this.hooks.still ? this.fps : null,
      paused: this.paused,
    };
    if (tut) {
      // Practice: show only the control this step teaches.
      d.lightVisible = tut.step === 'light';
      d.catchVisible = tut.step === 'catch';
      d.catchTgo = null;
      d.armsClosing = false;
      d.igniteIn = null;
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
      camera: rp.split ? 'Split · synced cams' : `${CAMERA_LABELS[this.camera]}${this.manualCam ? '' : ' · auto'} · REPLAY`,
      fps: this.hooks.fps && !this.hooks.still ? this.fps : null,
      paused: false,
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
