// Broadcast HUD: an original webcast-style telemetry strip (T+ clock, speed, altitude,
// propellant, an engine ring that lights per engine, the stop-height predictor, wind),
// the GO/NO-GO health board (folded into the strip), captions, the picture-in-picture
// frame and the action buttons (CATCH with its countdown ring, LIGHT, step-down, DIVERT).
// Every in/out-of-tolerance cue has a glyph or a shape as well as a colour.
import type { EngineState, GoNoGoState, HealthBoard, Phase } from '../sim/types';
import type { TierId } from '../sim/tiers';
import { engineLayout } from '../render/scene';
import type { InputDevices } from '../input/devices';
import { el, setText, show, svgEl } from './dom';
import type { Tone } from './tolerance';

const TONE_GLYPH: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✕' };
/** A glyph for a tone, or nothing for a neutral (null) tone. */
const glyph = (t: Tone | null): string => (t ? ` ${TONE_GLYPH[t]}` : '');

export interface HudData {
  tier: TierId;
  phase: Phase;
  tau: number | null;
  altitude: number; // m, engine plane above the sea
  speed: number; // m/s
  vs: number; // m/s vertical (+ up)
  lat: number; // m/s lateral
  propellantT: number;
  propFrac: number;
  engines: readonly EngineState[];
  stopMargin: number | null; // m: where the booster would stop vs. the arms (+ = above)
  igniteIn: number | null; // s until the ideal ignition point (coast)
  gonogo: GoNoGoState;
  /** False in replays (the board is a live decision tool). */
  showBoard: boolean;
  fdDecide: boolean;
  catchVisible: boolean;
  /** Seconds to predicted pin contact while CATCH shows (drives the countdown ring). */
  catchTgo: number | null;
  /** 0..1 of the 0.3 s hold-to-confirm. */
  catchHold: number;
  armsClosing: boolean;
  stepVisible: boolean;
  lightVisible: boolean;
  /** 0..1 of the 1 s divert hold. */
  divertHold: number;
  /** Wind at the booster: speed (m/s), direction (rad, atan2(z, x)), gust (m/s), shear on. */
  wind: { speed: number; dir: number; gust: number; shear: boolean } | null;
  sensorFault: boolean;
  slowMo: boolean;
  camera: string;
  fps: number | null;
  paused: boolean;
  /**
   * Pins vs the arm centreline (Cadet: the aim error): distance (m), the screen direction to
   * steer (unit, x right, z down the screen) and the tone (null = neutral). Null hides the chip.
   */
  pin: { dist: number; sx: number; sz: number; tone: Tone | null } | null;
  /** Tilt from vertical (deg) and its tone (null = neutral, see src/ui/tolerance.ts). */
  tilt: { deg: number; tone: Tone | null } | null;
  /** V/S tone against the 2 m/s contact limit near the arms; null far from them (neutral). */
  vsTone: Tone | null;
  /** Seconds to the ideal ignition while the 3-2-1 cue shows (every tier); null hides it. */
  cue: number | null;
  /** Cadet tapped LIGHT early: the engines light on the mark. */
  lightArmed: boolean;
  /** Cadet: the big "steer onto the ring" arrow. */
  steerCue: boolean;
  /** Cadet: the stick is pushed but the aim does not move: pulse the arrow, "Other way". */
  wrongWay: boolean;
  /** Pilot / FD: propellant 0..1 for the short PROP chip (compact phone strip); null hides it. */
  propChip: number | null;
  /** Cadet: the board folds into one GO chip. */
  foldBoard: boolean;
}

const BOARD_LABELS: [keyof HealthBoard, string][] = [
  ['engines', 'ENG'],
  ['propellant', 'PROP'],
  ['track', 'TRACK'],
  ['towerSensors', 'TWR SENS'],
  ['arms', 'ARMS'],
  ['comms', 'COMMS'],
];

/** m: the Cadet aim error under which the steer cue says "On the ring". */
export const CADET_ON_RING = 0.15;

const PHASE_LABEL: Record<Phase, string> = {
  coast: 'FINAL APPROACH',
  burn13: 'LANDING BURN',
  burn3: 'LANDING BURN',
  settling: 'SETTLING',
  caught: 'CAUGHT',
  splashdown: 'SOFT SPLASHDOWN',
};

const TIER_LABEL: Record<TierId, string> = { cadet: 'CADET', pilot: 'PILOT', fd: 'FLIGHT DIRECTOR' };

/** CATCH ring: the countdown covers the last this many seconds before contact. */
const RING_SECONDS = 6.5;
const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

function fmt(n: number, digits = 0): string {
  return n.toFixed(digits);
}

/** "+00:12.3" style mission clock. */
function clock(s: number, sign: '+' | '-'): string {
  const a = Math.max(0, s);
  const m = Math.floor(a / 60);
  const sec = a - m * 60;
  return `${sign}${String(m).padStart(2, '0')}:${sec < 10 ? '0' : ''}${fmt(sec, 1)}`;
}

export class Hud {
  readonly root: HTMLDivElement;
  private readonly tPlus = el('span', { class: 'clock', 'data-testid': 'hud-t' });
  private readonly mission = el('span', { class: 'mission' });
  private readonly alt = el('span', { class: 'v', 'data-testid': 'hud-alt' });
  private readonly altU = el('span', { class: 'u' });
  private readonly spd = el('span', { class: 'v' });
  private readonly vs = el('span', { 'data-testid': 'hud-vs' });
  private readonly lat = el('span', { class: 'v sm' });
  private readonly prop = el('span', { class: 'v sm' });
  private readonly propFill = el('i');
  private readonly stopLabel = el('span', { class: 'v sm', 'data-testid': 'hud-stop' });
  private readonly stopMark = el('i');
  private readonly ringDots: SVGCircleElement[] = [];
  private readonly ringCount = svgEl('text', { x: 0, y: 0.95, 'text-anchor': 'middle', class: 'count' });
  private readonly windCell = el('span', { class: 'cell wind', 'data-testid': 'hud-wind' });
  private readonly windArrow = svgEl('g', {});
  private readonly windText = el('span', { class: 'v sm' });
  private readonly gustBars: HTMLElement[] = [];
  private readonly shearTag = el('span', { class: 'shear', text: 'SHEAR' });
  private readonly gonogo = el('div', { id: 'gonogo', 'data-testid': 'gonogo', role: 'group', 'aria-label': 'Go/No-Go health board' });
  private readonly chips: Record<string, HTMLSpanElement> = {};
  private readonly decision = el('span', { class: 'decision', 'data-testid': 'gonogo-decision' });
  private readonly goBtn = el('button', { class: 'go', 'data-testid': 'go-btn', text: '✓ GO', 'aria-label': 'GO for catch' });
  private readonly divert = el('div', { class: 'divert', 'data-testid': 'nogo-btn', role: 'slider', 'aria-label': 'Slide and hold to divert (No-Go)' });
  private readonly divertKnob = el('span', { class: 'knob', text: '⇢' });
  private readonly divertFill = el('i');
  private readonly fault = el('div', { id: 'fault', 'data-testid': 'sensor-fault', role: 'alert', text: '⚠ TOWER SENSOR FAULT · stop gauge unreliable' });
  private readonly captions = el('div', { id: 'captions', role: 'status', 'aria-live': 'polite' });
  private readonly captionText = el('span');
  private readonly cameraTag = el('div', { id: 'camera-tag' });
  private readonly slowMo = el('div', { id: 'slowmo', text: '◷ SLOW-MO' });
  private readonly pip = el('div', { id: 'pip', 'data-testid': 'pip' });
  private readonly pipLabel = el('span');
  private readonly fps = el('div', { id: 'fps', 'data-testid': 'fps' });
  private readonly paused = el('div', { id: 'paused-tag', text: 'PAUSED' });
  readonly catchBtn = el('button', { id: 'catch-btn', class: 'action ui', 'data-testid': 'catch-btn', 'aria-label': 'CATCH: press and hold to close the arms' });
  private readonly catchLabel = el('span', { class: 'label', text: 'CATCH' });
  private readonly catchSub = el('span', { class: 'sub' });
  private readonly ringCount2 = svgEl('circle', { cx: 50, cy: 50, r: RING_R, class: 'count' });
  private readonly ringHold = svgEl('circle', { cx: 50, cy: 50, r: RING_R - 7, class: 'hold' });
  readonly lightBtn = el('button', { id: 'light-btn', class: 'action ui', 'data-testid': 'light-btn', text: 'LIGHT' });
  readonly stepBtn = el('button', { id: 'step-btn', class: 'action ui', 'data-testid': 'step-btn', 'aria-label': 'Step down from 13 to 3 engines (R)' });
  // Tolerance chips (all tiers): pin offset with a steer arrow, tilt, and V/S vs the contact limit.
  private readonly pinChip = el('span', { class: 'chip tol', 'data-testid': 'hud-pin' });
  private readonly pinArrow = svgEl('g', {});
  private readonly pinText = el('span');
  private readonly tiltChip = el('span', { class: 'chip tol', 'data-testid': 'hud-tilt' });
  private readonly propChip = el('span', { class: 'chip tol prop-chip', 'data-testid': 'hud-prop-chip' });
  private readonly vsChip = el('span', { class: 'chip tol vs' }, [this.vs]);
  private readonly vsGlyph = el('span', { class: 'g' });
  // The 3-2-1 ignition cue (every tier) and the Cadet steer arrow.
  private readonly cue = el('div', { id: 'ign-cue', 'data-testid': 'ign-cue', 'aria-hidden': 'true' });
  private readonly steer = el('div', { id: 'steer-cue', 'data-testid': 'steer-cue' });
  private readonly steerArrow = svgEl('g', {});
  private readonly steerText = el('span');
  private captionUntil = 0;
  private divertActive = false;

  constructor(parent: HTMLElement, devices: InputDevices) {
    // Engine ring: 13 landing engines (lit per engine) inside a ring of 20 fixed outer bells.
    const ring = svgEl('svg', { id: 'engine-ring', viewBox: '-5 -5 10 10', role: 'img', 'aria-label': 'engines lit' });
    ring.append(svgEl('circle', { cx: 0, cy: 0, r: 4.8, class: 'rim' }));
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + 0.16;
      ring.append(svgEl('circle', { cx: (Math.cos(a) * 4.05).toFixed(2), cy: (Math.sin(a) * 4.05).toFixed(2), r: 0.42, class: 'outer' }));
    }
    for (const [x, z] of engineLayout()) {
      const c = svgEl('circle', { cx: x.toFixed(2), cy: z.toFixed(2), r: 0.6 });
      ring.append(c);
      this.ringDots.push(c);
    }
    ring.append(this.ringCount);
    const gauge = el('span', { id: 'stop-gauge' }, [el('b'), this.stopMark]);
    const propBar = el('span', { class: 'bar' }, [this.propFill]);
    // A cell with its label; a long label also gets a short form for the compact phone strip.
    const SHORT: Record<string, string> = { ALTITUDE: 'ALT' };
    const label = (k: string): HTMLSpanElement => {
      const s = SHORT[k];
      return s
        ? el('span', { class: 'k' }, [el('span', { class: 'long', text: k }), el('span', { class: 'short', text: s })])
        : el('span', { class: 'k', text: k });
    };
    const cell = (k: string, ...v: (HTMLElement | string)[]): HTMLSpanElement =>
      el('span', { class: `cell c-${k.toLowerCase()}` }, [label(k), el('span', { class: 'row' }, v)]);

    // Wind: an arrow (top-down, sea to the right), the speed, gust bars and a shear tag.
    const windSvg = svgEl('svg', { viewBox: '-10 -10 20 20', class: 'wind-dial', 'aria-hidden': 'true' });
    windSvg.append(svgEl('circle', { cx: 0, cy: 0, r: 9, class: 'dial' }));
    this.windArrow.append(svgEl('path', { d: 'M-6 0 H4 M1 -3.5 L5 0 L1 3.5', class: 'arrow' }));
    windSvg.append(this.windArrow);
    const gust = el('span', { class: 'gust', 'aria-hidden': 'true' });
    for (let i = 0; i < 4; i++) {
      const b = el('i');
      this.gustBars.push(b);
      gust.append(b);
    }
    this.windCell.append(el('span', { class: 'k', text: 'WIND' }), el('span', { class: 'row' }, [windSvg, this.windText, gust, this.shearTag]));

    for (const [key, label] of BOARD_LABELS) {
      const c = el('span', { class: 'chip', text: `… ${label}` });
      this.chips[key] = c;
      this.gonogo.append(c);
    }
    this.divert.append(this.divertFill, el('span', { class: 'track', text: 'slide · hold to DIVERT' }), this.divertKnob);
    this.gonogo.append(this.decision, this.goBtn, this.divert);

    // Pin chip: a small arrow that points the way to push the stick (screen space).
    const pinSvg = svgEl('svg', { viewBox: '-10 -10 20 20', class: 'pin-dial', 'aria-hidden': 'true' });
    pinSvg.append(svgEl('circle', { cx: 0, cy: 0, r: 8.5, class: 'dial' }));
    this.pinArrow.append(svgEl('path', { d: 'M-5 0 H4 M0.5 -3.5 L4.5 0 L0.5 3.5', class: 'arrow' }));
    pinSvg.append(this.pinArrow);
    this.pinChip.append(el('span', { class: 'k', text: 'PIN' }), pinSvg, this.pinText);
    this.vsChip.append(el('span', { class: 'vs-unit', text: 'm/s' }), this.vsGlyph);
    const tol = el('span', { class: 'cell tolerances' }, [this.pinChip, this.tiltChip, this.propChip]);

    const telemetry = el('div', { id: 'telemetry', 'data-testid': 'telemetry' }, [
      el('span', { class: 'brand' }, [el('b', { text: 'HB-07' }), this.mission]),
      ring,
      cell('SPEED', this.spd, el('span', { class: 'u', text: 'KM/H' })),
      cell('ALTITUDE', this.alt, this.altU),
      el('span', { class: 'cell vs-cell' }, [el('span', { class: 'k', text: 'V/S' }), this.vsChip]),
      el('span', { class: 'cell small' }, [el('span', { class: 'k', text: 'LAT' }), this.lat]),
      cell('PROP', propBar, this.prop),
      cell('STOP', gauge, this.stopLabel),
      this.windCell,
      tol,
      el('span', { class: 'cell time' }, [el('span', { class: 'k', text: 'T' }), this.tPlus]),
      // Folded in: above the strip on desktop, a wrapped row inside it on phones.
      this.gonogo,
    ]);

    const steerSvg = svgEl('svg', { viewBox: '-20 -20 40 40', class: 'steer-dial', 'aria-hidden': 'true' });
    steerSvg.append(svgEl('circle', { cx: 0, cy: 0, r: 17, class: 'dial' }));
    this.steerArrow.append(svgEl('path', { d: 'M-11 0 H9 M2 -7 L10 0 L2 7', class: 'arrow' }));
    steerSvg.append(this.steerArrow);
    this.steer.append(steerSvg, this.steerText);
    // Docked to the strip (above it on desktop, under it on phones): never over the tower top.
    telemetry.append(this.steer);
    this.pip.append(this.pipLabel);
    this.pip.hidden = true;
    this.captions.append(el('span', { class: 'radio', 'aria-hidden': 'true', text: '◉' }), this.captionText);

    // CATCH: a countdown ring (time to contact) around a hold-to-confirm fill.
    const ringSvg = svgEl('svg', { viewBox: '0 0 100 100', class: 'ring', 'aria-hidden': 'true' });
    ringSvg.append(svgEl('circle', { cx: 50, cy: 50, r: RING_R, class: 'track' }), this.ringCount2, this.ringHold);
    this.ringCount2.setAttribute('stroke-dasharray', `${RING_C.toFixed(1)}`);
    this.ringHold.setAttribute('stroke-dasharray', `${(2 * Math.PI * (RING_R - 7)).toFixed(1)}`);
    this.catchBtn.append(ringSvg, this.catchLabel, this.catchSub);
    this.stepBtn.append(el('span', { class: 'key', text: 'R' }), el('span', { text: '13 → 3' }));

    this.root = el('div', { id: 'hud', class: 'ui hidden', 'data-testid': 'hud' }, [
      telemetry,
      this.fault,
      this.captions,
      this.cameraTag,
      this.slowMo,
      this.pip,
      this.fps,
      this.paused,
      this.catchBtn,
      this.lightBtn,
      this.stepBtn,
      this.cue,
    ]);
    parent.append(this.root);

    // Buttons feed the touch intent, so mouse and touch take the same path as the keyboard.
    const hold = (b: HTMLElement, on: (down: boolean) => void): void => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        b.classList.add('held');
        on(true);
      });
      const up = (): void => {
        b.classList.remove('held');
        on(false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold(this.catchBtn, (d) => (devices.touchCatchDown = d));
    const tap = (b: HTMLElement, fn: () => void): void => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fn();
      });
    };
    tap(this.lightBtn, () => (devices.touch.ignitePressed = true));
    tap(this.stepBtn, () => (devices.touch.stepDownPressed = true));
    tap(this.goBtn, () => (devices.touch.goPressed = true));

    // DIVERT: slide the knob to the end, then keep holding for 1 s.
    let startX = 0;
    let pid: number | null = null;
    const setKnob = (px: number): void => {
      this.divertKnob.style.transform = px > 0 ? `translateX(${px.toFixed(0)}px)` : '';
    };
    this.divert.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      startX = e.clientX;
      this.divert.setPointerCapture?.(e.pointerId);
    });
    this.divert.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const w = Math.max(40, this.divert.clientWidth - this.divertKnob.clientWidth);
      const k = Math.max(0, Math.min(1, (e.clientX - startX) / w));
      setKnob(k * w);
      const on = k >= 0.85;
      if (on !== this.divertActive) {
        this.divertActive = on;
        devices.touchDivertDown = on;
        this.divert.classList.toggle('armed', on);
      }
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.divertActive = false;
      devices.touchDivertDown = false;
      this.divert.classList.remove('armed');
      setKnob(0);
    };
    this.divert.addEventListener('pointerup', end);
    this.divert.addEventListener('pointercancel', end);
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  /** Shows the picture-in-picture frame with a camera label (null hides it). */
  setPip(label: string | null): void {
    show(this.pip, label !== null);
    if (label !== null) setText(this.pipLabel, label);
  }

  /** The PiP frame rectangle (inside its border) in CSS px relative to `container`; null if hidden. */
  pipRect(container: HTMLElement): { x: number; y: number; w: number; h: number } | null {
    if (this.pip.hidden) return null;
    const r = this.pip.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    return { x: r.left - c.left + 2, y: r.top - c.top + 2, w: r.width - 4, h: r.height - 4 };
  }

  caption(text: string, now: number, seconds = 3, kind: 'radio' | 'coach' = 'radio'): void {
    setText(this.captionText, text);
    this.captions.className = `show ${kind}`;
    this.captionUntil = now + seconds;
  }

  clearCaption(): void {
    this.captions.className = '';
    this.captionUntil = 0;
  }

  /** A short bright flash on the CATCH button when the arms start to close. */
  flashCatch(): void {
    const b = this.catchBtn;
    if (typeof b.animate !== 'function') return;
    const reduced = this.root.closest('.reduced') !== null;
    const glow = 'drop-shadow(0 0 30px rgba(255, 255, 255, 0.95)) brightness(1.7)';
    const rest = 'drop-shadow(0 0 0 rgba(95, 255, 208, 0))';
    b.animate(
      [
        { filter: rest, transform: 'scale(1)' },
        { filter: glow, transform: reduced ? 'scale(1)' : 'scale(1.12)', offset: 0.22 },
        { filter: rest, transform: 'scale(1)' },
      ],
      { duration: reduced ? 380 : 650, easing: 'ease-out' },
    );
  }

  update(d: HudData, now: number): void {
    if (this.captionUntil && now > this.captionUntil) this.clearCaption();
    if (d.tau !== null) setText(this.tPlus, clock(d.tau, '+'));
    else setText(this.tPlus, d.igniteIn !== null ? clock(d.igniteIn, '-') : '--:--.-');
    const n = d.engines.reduce((a, e) => a + (e.mode === 'lit' ? 1 : 0), 0);
    const ph = d.phase === 'burn13' || d.phase === 'burn3' ? `${PHASE_LABEL[d.phase]} · ${n}` : PHASE_LABEL[d.phase];
    setText(this.mission, `${TIER_LABEL[d.tier]} · ${ph}`);
    if (d.altitude >= 1000) {
      setText(this.alt, fmt(d.altitude / 1000, 2));
      setText(this.altU, 'KM');
    } else {
      setText(this.alt, fmt(d.altitude));
      setText(this.altU, 'M');
    }
    setText(this.spd, fmt(d.speed * 3.6));
    setText(this.vs, fmt(d.vs, 1));
    // V/S against the 2 m/s contact limit (coloured near the arms, with a glyph).
    const vsCls = `chip tol vs${d.vsTone ? ` ${d.vsTone}` : ''}`;
    if (this.vsChip.className !== vsCls) this.vsChip.className = vsCls;
    setText(this.vsGlyph, d.vsTone ? TONE_GLYPH[d.vsTone] : '');
    this.vsGlyph.hidden = !d.vsTone;

    // Pin offset: distance, a screen-space arrow the way to steer, tone vs the pin window.
    show(this.pinChip, d.pin !== null);
    if (d.pin) {
      const p = d.pin;
      const ang = (Math.atan2(p.sz, p.sx) * 180) / Math.PI;
      this.pinArrow.setAttribute('transform', `rotate(${ang.toFixed(0)})`);
      this.pinArrow.style.opacity = p.tone === 'ok' ? '0.35' : '1';
      setText(this.pinText, `${fmt(p.dist, p.dist < 10 ? 1 : 0)} m${glyph(p.tone)}`);
      const cls = `chip tol${p.tone ? ` ${p.tone}` : ''}`;
      if (this.pinChip.className !== cls) this.pinChip.className = cls;
    }
    show(this.tiltChip, d.tilt !== null);
    if (d.tilt) {
      setText(this.tiltChip, `TILT ${fmt(d.tilt.deg, 1)}°${glyph(d.tilt.tone)}`);
      const cls = `chip tol${d.tilt.tone ? ` ${d.tilt.tone}` : ''}`;
      if (this.tiltChip.className !== cls) this.tiltChip.className = cls;
    }

    // Cadet steer cue: a big arrow from the aim point toward the ring centre, in screen space.
    show(this.steer, d.steerCue && d.pin !== null);
    if (d.steerCue && d.pin) {
      const on = d.pin.dist < CADET_ON_RING;
      const ang = (Math.atan2(d.pin.sz, d.pin.sx) * 180) / Math.PI;
      this.steerArrow.setAttribute('transform', `rotate(${ang.toFixed(0)})`);
      this.steerArrow.style.opacity = on ? '0' : '1';
      // A push that does not move the aim (it points away from the ring): say so.
      const wrong = d.wrongWay && !on;
      setText(
        this.steerText,
        on ? 'On the ring ✓' : wrong ? `Other way ↺ · push along the arrow · ${fmt(d.pin.dist, 1)} m` : `Steer onto the ring · ${fmt(d.pin.dist, 1)} m`,
      );
      const cls = on ? 'ok' : wrong ? 'wrong' : '';
      if (this.steer.className !== cls) this.steer.className = cls;
    }
    // Compact phone strip: a short PROP chip in Pilot and Flight Director.
    show(this.propChip, d.propChip !== null);
    if (d.propChip !== null) {
      setText(this.propChip, `PROP ${fmt(d.propChip * 100)}%`);
      const low = d.propChip < 0.15;
      if (this.propChip.classList.contains('warn') !== low) this.propChip.classList.toggle('warn', low);
    }

    // The 3-2-1 ignition cue, every tier.
    show(this.cue, d.cue !== null);
    if (d.cue !== null) {
      const k = Math.min(3, Math.ceil(d.cue));
      const txt = d.lightArmed ? 'ARMED ✓' : k >= 1 && k <= 3 ? `${k}…` : 'LIGHT';
      setText(this.cue, txt);
      const cls = k >= 1 && k <= 3 && !d.lightArmed ? 'count' : 'go';
      if (this.cue.className !== cls) this.cue.className = cls;
    }
    setText(this.lat, `${fmt(d.lat, 1)} m/s`);
    setText(this.prop, `${fmt(d.propFrac * 100)}% · ${fmt(d.propellantT, 1)} t`);
    this.propFill.style.width = `${fmt(d.propFrac * 100, 1)}%`;
    this.propFill.className = d.propFrac < 0.15 ? 'low' : '';

    for (let i = 0; i < this.ringDots.length; i++) {
      const e = d.engines[i];
      const dot = this.ringDots[i];
      if (!dot || !e) continue;
      const on = e.mode === 'lit' || (e.mode === 'spooling' && !e.willFail && e.spool > e.spoolTime * 0.5);
      const cls = on ? 'on' : e.mode === 'spooling' ? 'spool' : e.mode === 'failed' ? 'fail' : '';
      if (dot.getAttribute('class') !== cls) dot.setAttribute('class', cls);
    }
    const cnt = n > 0 ? String(n) : '';
    if (this.ringCount.textContent !== cnt) this.ringCount.textContent = cnt;

    if (d.stopMargin === null || !Number.isFinite(d.stopMargin)) {
      setText(this.stopLabel, '--');
      this.stopMark.style.left = '0%';
      this.stopMark.className = '';
    } else {
      const m = d.stopMargin;
      // A glyph as well as a colour: ▲ stops above the arms, ▼ would pass below them.
      const glyph = m < -20 ? '▼' : m < 40 ? '◆' : '▲';
      setText(this.stopLabel, `${glyph} ${m >= 0 ? '+' : ''}${fmt(m)} m${d.sensorFault ? ' ?' : ''}`);
      const pct = Math.max(0, Math.min(100, 50 + (m / 600) * 100));
      this.stopMark.style.left = `calc(${pct.toFixed(1)}% - 2px)`;
      const cls = m < -20 ? 'bad' : m < 40 ? 'warn' : 'ok';
      if (this.stopMark.className !== cls) this.stopMark.className = cls;
    }

    // Wind / gusts / shear (Pilot and Flight Director).
    show(this.windCell, d.wind !== null);
    if (d.wind) {
      const w = d.wind;
      this.windArrow.setAttribute('transform', `rotate(${((w.dir * 180) / Math.PI).toFixed(0)})`);
      setText(this.windText, `${fmt(w.speed)} m/s`);
      const bars = Math.min(4, Math.round(w.gust / 1.0));
      this.gustBars.forEach((b, i) => {
        const on = i < bars;
        if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
      });
      show(this.shearTag, w.shear);
    }
    show(this.fault, d.sensorFault && d.tau !== null && (d.phase === 'burn13' || d.phase === 'burn3'));

    const g = d.gonogo;
    show(this.gonogo, d.showBoard && d.tau !== null && d.phase !== 'caught' && d.phase !== 'settling' && d.phase !== 'splashdown');
    // Cadet: one GO chip (the decision), not the six-line board.
    this.gonogo.classList.toggle('folded', d.foldBoard);
    for (const [key, label] of BOARD_LABELS) {
      const c = this.chips[key];
      if (!c) continue;
      const v = g.board ? g.board[key] : null;
      const cls = v === null ? 'chip' : v ? 'chip ok' : 'chip bad';
      if (c.className !== cls) c.className = cls;
      setText(c, `${v === null ? '…' : v ? '✓' : '✕'} ${label}`);
    }
    const dec = g.decision === 'go' ? '✓ GO' : g.decision === 'noGo' ? '✕ NO-GO' : g.polled ? '? POLL' : 'STANDBY';
    setText(this.decision, dec);
    const dcls = `decision ${g.decision === 'go' ? 'go' : g.decision === 'noGo' ? 'nogo' : g.polled ? 'poll' : ''}`;
    if (this.decision.className !== dcls) this.decision.className = dcls;
    const deciding = d.fdDecide && g.polled && g.decision === 'pending';
    show(this.goBtn, deciding);
    show(this.divert, deciding);
    this.divertFill.style.width = `${fmt(Math.min(1, d.divertHold) * 100)}%`;

    // CATCH with the countdown ring and the hold-to-confirm fill.
    show(this.catchBtn, d.catchVisible);
    if (d.catchVisible) {
      const left = d.catchTgo === null ? 1 : Math.max(0, Math.min(1, d.catchTgo / RING_SECONDS));
      this.ringCount2.setAttribute('stroke-dashoffset', (RING_C * (1 - left)).toFixed(1));
      const hc = 2 * Math.PI * (RING_R - 7);
      const hold = d.armsClosing ? 1 : Math.max(0, Math.min(1, d.catchHold));
      this.ringHold.setAttribute('stroke-dashoffset', (hc * (1 - hold)).toFixed(1));
      setText(this.catchLabel, d.armsClosing ? 'CLOSING' : 'CATCH');
      // Short text: it must fit inside the ring on the smallest phone button.
      setText(this.catchSub, d.armsClosing ? '✓ arms' : d.catchTgo !== null ? `${fmt(Math.max(0, d.catchTgo), 1)} s` : 'hold');
      this.catchBtn.classList.toggle('closing', d.armsClosing);
      this.catchBtn.classList.toggle('urgent', !d.armsClosing && d.catchTgo !== null && d.catchTgo < 4.5);
    }
    show(this.lightBtn, d.lightVisible);
    setText(this.lightBtn, d.lightArmed ? 'LIGHT ✓' : 'LIGHT');
    show(this.stepBtn, d.stepVisible);
    show(this.slowMo, d.slowMo);
    setText(this.cameraTag, d.camera);
    setText(this.fps, d.fps === null ? '' : `${fmt(d.fps)} fps`);
    show(this.paused, d.paused);
  }
}
