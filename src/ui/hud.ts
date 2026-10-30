// Broadcast HUD: an original webcast-style telemetry strip (T+ clock, speed, altitude,
// propellant, an engine ring that lights per engine, the stop-height predictor), the
// GO/NO-GO strip, captions, the picture-in-picture frame and the action buttons.
import type { EngineState, GoNoGoState, HealthBoard, Phase } from '../sim/types';
import type { TierId } from '../sim/tiers';
import { engineLayout } from '../render/scene';
import type { InputDevices } from '../input/devices';
import { el, setText, show, svgEl } from './dom';

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
  fdDecide: boolean;
  catchVisible: boolean;
  armsClosing: boolean;
  stepVisible: boolean;
  lightVisible: boolean;
  camera: string;
  fps: number | null;
  paused: boolean;
}

const BOARD_LABELS: [keyof HealthBoard, string][] = [
  ['engines', 'ENG'],
  ['propellant', 'PROP'],
  ['track', 'TRACK'],
  ['towerSensors', 'TWR SENS'],
  ['arms', 'ARMS'],
  ['comms', 'COMMS'],
];

const PHASE_LABEL: Record<Phase, string> = {
  coast: 'FINAL APPROACH',
  burn13: 'LANDING BURN',
  burn3: 'LANDING BURN',
  settling: 'SETTLING',
  caught: 'CAUGHT',
  splashdown: 'SOFT SPLASHDOWN',
};

const TIER_LABEL: Record<TierId, string> = { cadet: 'CADET', pilot: 'PILOT', fd: 'FLIGHT DIRECTOR' };

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
  private readonly vs = el('span', { class: 'v sm', 'data-testid': 'hud-vs' });
  private readonly lat = el('span', { class: 'v sm' });
  private readonly prop = el('span', { class: 'v sm' });
  private readonly propFill = el('i');
  private readonly stopLabel = el('span', { class: 'v sm', 'data-testid': 'hud-stop' });
  private readonly stopMark = el('i');
  private readonly ringDots: SVGCircleElement[] = [];
  private readonly ringCount = svgEl('text', { x: 0, y: 0.55, 'text-anchor': 'middle', class: 'count' });
  private readonly gonogo = el('div', { id: 'gonogo', 'data-testid': 'gonogo' });
  private readonly chips: Record<string, HTMLSpanElement> = {};
  private readonly decision = el('span', { class: 'decision', 'data-testid': 'gonogo-decision' });
  private readonly goBtn = el('button', { class: 'go', 'data-testid': 'go-btn', text: 'GO' });
  private readonly noGoBtn = el('button', { class: 'nogo', 'data-testid': 'nogo-btn', text: 'NO-GO (hold)' });
  private readonly captions = el('div', { id: 'captions', role: 'status', 'aria-live': 'polite' });
  private readonly cameraTag = el('div', { id: 'camera-tag' });
  private readonly pip = el('div', { id: 'pip', 'data-testid': 'pip' });
  private readonly pipLabel = el('span');
  private readonly fps = el('div', { id: 'fps', 'data-testid': 'fps' });
  private readonly paused = el('div', { id: 'paused-tag', text: 'PAUSED' });
  readonly catchBtn = el('button', { id: 'catch-btn', class: 'action ui', 'data-testid': 'catch-btn', text: 'CATCH' });
  readonly lightBtn = el('button', { id: 'light-btn', class: 'action ui', 'data-testid': 'light-btn', text: 'LIGHT' });
  readonly stepBtn = el('button', { id: 'step-btn', class: 'action ui', 'data-testid': 'step-btn', text: '13 → 3' });
  private captionUntil = 0;

  constructor(parent: HTMLElement, devices: InputDevices) {
    // Engine ring: 13 landing engines (lit per engine) inside a ring of 20 fixed outer bells.
    const ring = svgEl('svg', { id: 'engine-ring', viewBox: '-5 -5 10 10', 'aria-label': 'engines lit' });
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
    const cell = (k: string, ...v: (HTMLElement | string)[]): HTMLSpanElement =>
      el('span', { class: 'cell' }, [el('span', { class: 'k', text: k }), el('span', { class: 'row' }, v)]);
    const telemetry = el('div', { id: 'telemetry', 'data-testid': 'telemetry' }, [
      el('span', { class: 'brand' }, [el('b', { text: 'HB-07' }), this.mission]),
      ring,
      cell('SPEED', this.spd, el('span', { class: 'u', text: 'KM/H' })),
      cell('ALTITUDE', this.alt, this.altU),
      el('span', { class: 'cell small' }, [
        el('span', { class: 'k', text: 'V/S' }),
        this.vs,
        el('span', { class: 'k', text: 'LAT' }),
        this.lat,
      ]),
      cell('PROP', propBar, this.prop),
      cell('STOP', gauge, this.stopLabel),
      el('span', { class: 'cell time' }, [el('span', { class: 'k', text: 'T' }), this.tPlus]),
    ]);
    for (const [key, label] of BOARD_LABELS) {
      const c = el('span', { class: 'chip', text: label });
      this.chips[key] = c;
      this.gonogo.append(c);
    }
    this.gonogo.append(this.decision, this.goBtn, this.noGoBtn);
    this.pip.append(this.pipLabel);
    this.pip.hidden = true;

    this.root = el('div', { id: 'hud', class: 'ui hidden', 'data-testid': 'hud' }, [
      telemetry,
      this.gonogo,
      this.captions,
      this.cameraTag,
      this.pip,
      this.fps,
      this.paused,
      this.catchBtn,
      this.lightBtn,
      this.stepBtn,
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
    hold(this.noGoBtn, (d) => (devices.touchDivertDown = d));
    const tap = (b: HTMLElement, fn: () => void): void => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fn();
      });
    };
    tap(this.lightBtn, () => (devices.touch.ignitePressed = true));
    tap(this.stepBtn, () => (devices.touch.stepDownPressed = true));
    tap(this.goBtn, () => (devices.touch.goPressed = true));
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

  caption(text: string, now: number, seconds = 3): void {
    setText(this.captions, text);
    this.captions.classList.add('show');
    this.captionUntil = now + seconds;
  }

  clearCaption(): void {
    this.captions.classList.remove('show');
    this.captionUntil = 0;
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
    setText(this.vs, `${fmt(d.vs, 1)} m/s`);
    setText(this.lat, `${fmt(d.lat, 1)} m/s`);
    setText(this.prop, `${fmt(d.propFrac * 100)}% · ${fmt(d.propellantT, 1)} t`);
    this.propFill.style.width = `${fmt(d.propFrac * 100, 1)}%`;
    this.propFill.className = d.propFrac < 0.15 ? 'low' : '';

    for (let i = 0; i < this.ringDots.length; i++) {
      const e = d.engines[i];
      const dot = this.ringDots[i];
      if (!dot || !e) continue;
      const on = e.mode === 'lit' || (e.mode === 'spooling' && !e.willFail && e.spool > e.spoolTime * 0.5);
      dot.setAttribute('class', on ? 'on' : e.mode === 'spooling' ? 'spool' : e.mode === 'failed' ? 'fail' : '');
    }
    const cnt = n > 0 ? String(n) : '';
    if (this.ringCount.textContent !== cnt) this.ringCount.textContent = cnt;

    if (d.stopMargin === null || !Number.isFinite(d.stopMargin)) {
      setText(this.stopLabel, '--');
      this.stopMark.style.left = '0%';
    } else {
      const m = d.stopMargin;
      setText(this.stopLabel, `${m >= 0 ? '+' : ''}${fmt(m)} m`);
      const pct = Math.max(0, Math.min(100, 50 + (m / 600) * 100));
      this.stopMark.style.left = `calc(${pct.toFixed(1)}% - 2px)`;
      this.stopMark.style.background = m < -20 ? 'var(--bad)' : m < 40 ? 'var(--warn)' : 'var(--accent)';
    }

    const g = d.gonogo;
    show(this.gonogo, d.tau !== null && d.phase !== 'caught' && d.phase !== 'settling');
    for (const [key] of BOARD_LABELS) {
      const c = this.chips[key];
      if (!c) continue;
      const v = g.board ? g.board[key] : null;
      const cls = v === null ? 'chip' : v ? 'chip ok' : 'chip bad';
      if (c.className !== cls) c.className = cls;
    }
    const dec = g.decision === 'go' ? 'GO' : g.decision === 'noGo' ? 'NO-GO' : g.polled ? 'POLL' : 'STANDBY';
    setText(this.decision, dec);
    const dcls = `decision ${g.decision === 'go' ? 'go' : g.decision === 'noGo' ? 'nogo' : ''}`;
    if (this.decision.className !== dcls) this.decision.className = dcls;
    const deciding = d.fdDecide && g.polled && g.decision === 'pending';
    show(this.goBtn, deciding);
    show(this.noGoBtn, deciding);

    show(this.catchBtn, d.catchVisible);
    setText(this.catchBtn, d.armsClosing ? 'CLOSING' : 'CATCH');
    show(this.lightBtn, d.lightVisible);
    if (d.lightVisible && d.igniteIn !== null && d.tier === 'cadet') {
      const k = Math.ceil(d.igniteIn);
      setText(this.lightBtn, k >= 1 && k <= 3 ? `${k}… LIGHT` : 'LIGHT');
    } else setText(this.lightBtn, 'LIGHT');
    show(this.stepBtn, d.stepVisible);
    setText(this.cameraTag, d.camera);
    setText(this.fps, d.fps === null ? '' : `${fmt(d.fps)} fps`);
    show(this.paused, d.paused);
  }
}
