// Minimal HUD: telemetry bar, engine ring, stop-height predictor, GO/NO-GO strip,
// captions and the action buttons (LIGHT, STEP DOWN, CATCH).
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

function fmt(n: number, digits = 0): string {
  return n.toFixed(digits);
}

export class Hud {
  readonly root: HTMLDivElement;
  private readonly tPlus = el('span', { class: 'v', 'data-testid': 'hud-t' });
  private readonly alt = el('span', { class: 'v', 'data-testid': 'hud-alt' });
  private readonly spd = el('span', { class: 'v' });
  private readonly vs = el('span', { class: 'v', 'data-testid': 'hud-vs' });
  private readonly lat = el('span', { class: 'v' });
  private readonly prop = el('span', { class: 'v' });
  private readonly stopLabel = el('span', { class: 'v', 'data-testid': 'hud-stop' });
  private readonly stopMark = el('i');
  private readonly ringDots: SVGCircleElement[] = [];
  private readonly gonogo = el('div', { id: 'gonogo', 'data-testid': 'gonogo' });
  private readonly chips: Record<string, HTMLSpanElement> = {};
  private readonly decision = el('span', { class: 'decision', 'data-testid': 'gonogo-decision' });
  private readonly goBtn = el('button', { class: 'go', 'data-testid': 'go-btn', text: 'GO' });
  private readonly noGoBtn = el('button', { class: 'nogo', 'data-testid': 'nogo-btn', text: 'NO-GO (hold)' });
  private readonly captions = el('div', { id: 'captions', role: 'status', 'aria-live': 'polite' });
  private readonly cameraTag = el('div', { id: 'camera-tag' });
  private readonly fps = el('div', { id: 'fps', 'data-testid': 'fps' });
  private readonly paused = el('div', { id: 'paused-tag', text: 'PAUSED' });
  readonly catchBtn = el('button', { id: 'catch-btn', class: 'action ui', 'data-testid': 'catch-btn', text: 'CATCH' });
  readonly lightBtn = el('button', { id: 'light-btn', class: 'action ui', 'data-testid': 'light-btn', text: 'LIGHT' });
  readonly stepBtn = el('button', { id: 'step-btn', class: 'action ui', 'data-testid': 'step-btn', text: '13 → 3' });
  private captionUntil = 0;

  constructor(parent: HTMLElement, devices: InputDevices) {
    const ring = svgEl('svg', { id: 'engine-ring', viewBox: '-4 -4 8 8', 'aria-label': 'engines lit' });
    ring.append(svgEl('circle', { cx: 0, cy: 0, r: 3.9, fill: 'none', stroke: '#556677', 'stroke-width': 0.3 }));
    for (const [x, z] of engineLayout()) {
      const c = svgEl('circle', { cx: x.toFixed(2), cy: z.toFixed(2), r: 0.62 });
      ring.append(c);
      this.ringDots.push(c);
    }
    const gauge = el('span', { id: 'stop-gauge' }, [el('b'), this.stopMark]);
    const item = (k: string, v: HTMLElement): HTMLSpanElement => el('span', {}, [el('span', { class: 'k', text: k }), v]);
    const telemetry = el('div', { id: 'telemetry', 'data-testid': 'telemetry' }, [
      item('T', this.tPlus),
      item('ALT', this.alt),
      item('SPD', this.spd),
      item('V/S', this.vs),
      item('LAT', this.lat),
      item('PROP', this.prop),
      ring,
      el('span', {}, [el('span', { class: 'k', text: 'STOP' }), gauge, ' ', this.stopLabel]),
    ]);
    for (const [key, label] of BOARD_LABELS) {
      const c = el('span', { class: 'chip', text: label });
      this.chips[key] = c;
      this.gonogo.append(c);
    }
    this.gonogo.append(this.decision, this.goBtn, this.noGoBtn);

    this.root = el('div', { id: 'hud', class: 'ui hidden', 'data-testid': 'hud' }, [
      telemetry,
      this.gonogo,
      this.captions,
      this.cameraTag,
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
    if (d.tau !== null) setText(this.tPlus, `+${fmt(d.tau, 1)} s`);
    else setText(this.tPlus, d.igniteIn !== null ? `-${fmt(Math.max(0, d.igniteIn), 1)} s` : '--');
    setText(this.alt, d.altitude >= 1000 ? `${fmt(d.altitude / 1000, 2)} km` : `${fmt(d.altitude)} m`);
    setText(this.spd, `${fmt(d.speed * 3.6)} km/h`);
    setText(this.vs, `${fmt(d.vs, 1)} m/s`);
    setText(this.lat, `${fmt(d.lat, 1)} m/s`);
    setText(this.prop, `${fmt(d.propellantT, 1)} t (${fmt(d.propFrac * 100)}%)`);

    for (let i = 0; i < this.ringDots.length; i++) {
      const e = d.engines[i];
      const dot = this.ringDots[i];
      if (!dot || !e) continue;
      const on = e.mode === 'lit' || (e.mode === 'spooling' && !e.willFail && e.spool > e.spoolTime * 0.5);
      dot.setAttribute('class', on ? 'on' : e.mode === 'failed' ? 'fail' : '');
    }

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
      c.className = v === null ? 'chip' : v ? 'chip ok' : 'chip bad';
    }
    const dec = g.decision === 'go' ? 'GO' : g.decision === 'noGo' ? 'NO-GO' : g.polled ? 'POLL' : 'STANDBY';
    setText(this.decision, dec);
    this.decision.className = `decision ${g.decision === 'go' ? 'go' : g.decision === 'noGo' ? 'nogo' : ''}`;
    const deciding = d.fdDecide && g.polled && g.decision === 'pending';
    show(this.goBtn, deciding);
    show(this.noGoBtn, deciding);

    show(this.catchBtn, d.catchVisible);
    setText(this.catchBtn, d.armsClosing ? 'CLOSING' : 'CATCH');
    show(this.lightBtn, d.lightVisible);
    if (d.lightVisible && d.igniteIn !== null && d.tier === 'cadet') {
      const n = Math.ceil(d.igniteIn);
      setText(this.lightBtn, n >= 1 && n <= 3 ? `${n}… LIGHT` : 'LIGHT');
    } else setText(this.lightBtn, 'LIGHT');
    show(this.stepBtn, d.stepVisible);
    setText(this.cameraTag, d.camera);
    setText(this.fps, d.fps === null ? '' : `${fmt(d.fps)} fps`);
    show(this.paused, d.paused);
  }
}
