// The LEFT rail (desktop / tablet) that is also the left slide-out drawer on phones.
// Every menu lives here: Play + tier select, Pause, Replay, Cameras, Settings, the
// debrief and the "Real facts" card.
import type { QualitySetting, Settings } from '../app/storage';
import {
  KEY_ACTIONS,
  KEY_ACTION_LABELS,
  keyLabel,
  presetKeys,
  rebind,
  type KeyAction,
  type KeyPreset,
} from '../input/mapping';
import { CAMERA_IDS, CAMERA_LABELS, type CameraId } from '../render/cameras';
import type { ScoreBreakdown } from '../sim/scoring';
import type { FlightSeries } from '../sim/timeline';
import { TIER_CONFIG, TIERS, type TierId } from '../sim/tiers';
import { el, setText, show, svgEl } from './dom';
import { drawFlightGraphs, type GraphMarks } from './graphs';

export type MenuMode = 'main' | 'paused' | 'debrief' | 'playing' | 'replay' | 'tutorial';

export interface MenuHandlers {
  onStart: (tier: TierId) => void;
  onTutorial: () => void;
  onResume: () => void;
  onPause: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onReplay: () => void;
  onExitReplay: () => void;
  onCamera: (id: CameraId | 'auto') => void;
  onSettings: (s: Settings) => void;
  onClearData: () => void;
  /** Key remapping started / ended (the game ignores keys meanwhile). */
  onCapture: (active: boolean) => void;
}

export interface DebriefData {
  tier: TierId;
  caught: boolean;
  title: string;
  tip: string;
  score: ScoreBreakdown;
  best: number;
  newBest: boolean;
  isReplay: boolean;
  goodCall: boolean;
  series: FlightSeries | null;
  marks: GraphMarks;
  /** Seconds for the counters to count up (0 = show the final numbers at once). */
  countSeconds: number;
}

const TIER_BLURB: Record<TierId, string> = {
  cadet: 'Autopilot flies. You steer and press CATCH.',
  pilot: 'You light the engines, step down and fly the throttle.',
  fd: 'Full manual. You make the Go/No-Go call.',
};

const MEDAL_LABEL: Record<ScoreBreakdown['medal'], string> = {
  none: '',
  bronze: 'Bronze Catcher',
  silver: 'Silver Catcher',
  gold: 'Gold Catcher',
  bullseye: 'Bullseye!',
};

/** A shape per medal, so the medal does not depend on colour alone. */
const MEDAL_GLYPH: Record<ScoreBreakdown['medal'], string> = {
  none: '',
  bronze: '●',
  silver: '◆',
  gold: '★',
  bullseye: '◎',
};

const FACTS: [string, string[]][] = [
  [
    'Why catch instead of legs?',
    [
      'Landing legs weigh many tonnes. Without legs, the booster can carry more to space.',
      'The tower arms do the heavy work, and the arms stay on the ground.',
      'A caught booster is already at the launch site, so the team can fly it again sooner.',
    ],
  ],
  [
    'Why 13 engines, then 3?',
    [
      '13 engines stop the fast fall in a few seconds.',
      '3 engines give fine control near the tower. Even 3 engines at low throttle push a little more than the booster weighs, so it cannot hover for long.',
    ],
  ],
  [
    'Why is the boom late?',
    [
      'Sound moves at about 343 m/s. The beach camera is more than 2 km away.',
      'You see the engines light first. The roar and the double crack of the sonic boom come seconds later.',
    ],
  ],
];

export class Menu {
  readonly rail: HTMLElement;
  readonly button: HTMLButtonElement;
  mode: MenuMode = 'main';
  private tier: TierId;
  private readonly tierBtns = new Map<TierId, HTMLButtonElement>();
  private readonly camBtns = new Map<CameraId | 'auto', HTMLButtonElement>();
  private readonly play: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly replay: HTMLElement;
  private readonly debrief: HTMLElement;
  private readonly debriefBody = el('div');
  private readonly cams: HTMLElement;
  private readonly bestLine = el('div', { class: 'sub best', 'data-testid': 'best-scores' });
  private readonly quality: HTMLSelectElement;
  private readonly mute: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly music: HTMLButtonElement;
  private readonly reduced: HTMLButtonElement;
  private readonly oneHand: HTMLButtonElement;
  private readonly preset: HTMLSelectElement;
  private readonly keyBtns = new Map<KeyAction, HTMLButtonElement>();
  private readonly cleared = el('div', { class: 'sub', 'data-testid': 'cleared' });
  private capture: { action: KeyAction; stop: () => void } | null = null;
  private countRaf: number | null = null;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private readonly h: MenuHandlers,
    private readonly bestFor: (tier: TierId) => number,
  ) {
    this.tier = settings.tier;
    this.button = el('button', {
      id: 'menu-btn',
      class: 'ui',
      'aria-label': 'Menu',
      'aria-controls': 'rail',
      'aria-expanded': 'true',
      'data-testid': 'menu-btn',
      text: '☰',
    });
    this.button.addEventListener('click', () => {
      if (this.mode === 'playing') this.h.onPause();
      else this.toggle();
    });

    // Play
    const tierList = el('div', { role: 'radiogroup', 'aria-label': 'Tier' });
    for (const id of TIERS) {
      const b = el('button', { class: 'btn', role: 'radio', 'data-testid': `tier-${id}` }, [
        TIER_CONFIG[id].name,
        el('small', { text: TIER_BLURB[id] }),
      ]);
      b.addEventListener('click', () => this.selectTier(id));
      this.tierBtns.set(id, b);
      tierList.append(b);
    }
    const start = el('button', { class: 'btn primary', 'data-testid': 'start-btn', text: 'Start: Final Approach' });
    start.addEventListener('click', () => this.h.onStart(this.tier));
    const tut = el('button', { class: 'btn', 'data-testid': 'tutorial-btn', text: 'Practice: 20-second tutorial' });
    tut.addEventListener('click', () => this.h.onTutorial());
    this.play = el('section', { 'data-testid': 'play-section' }, [
      el('h2', { text: 'Play: Final Approach' }),
      tierList,
      start,
      tut,
      this.bestLine,
    ]);

    // Pause
    const resume = el('button', { class: 'btn primary', 'data-testid': 'resume-btn', text: 'Resume' });
    resume.addEventListener('click', () => this.h.onResume());
    const restart = el('button', { class: 'btn', 'data-testid': 'restart-btn', text: 'Restart run' });
    restart.addEventListener('click', () => this.h.onRestart());
    const toMain = el('button', { class: 'btn', 'data-testid': 'main-btn', text: 'Main menu' });
    toMain.addEventListener('click', () => this.h.onMainMenu());
    this.pause = el('section', { 'data-testid': 'pause-section' }, [el('h2', { text: 'Paused' }), resume, restart, toMain]);

    // Replay
    const exitReplay = el('button', { class: 'btn primary', 'data-testid': 'replay-exit', text: 'Back to the debrief' });
    exitReplay.addEventListener('click', () => this.h.onExitReplay());
    const again0 = el('button', { class: 'btn', text: 'Fly again' });
    again0.addEventListener('click', () => this.h.onRestart());
    this.replay = el('section', { 'data-testid': 'replay-section' }, [
      el('h2', { text: 'Replay' }),
      el('p', { class: 'sub', text: 'Use the bar at the bottom to play, pause, scrub and change speed. Pick a camera below.' }),
      exitReplay,
      again0,
    ]);

    // Debrief
    const replay = el('button', { class: 'btn primary', 'data-testid': 'replay-btn', text: 'Watch replay' });
    replay.addEventListener('click', () => this.h.onReplay());
    const again = el('button', { class: 'btn', 'data-testid': 'again-btn', text: 'Fly again' });
    again.addEventListener('click', () => this.h.onRestart());
    const main2 = el('button', { class: 'btn', text: 'Main menu' });
    main2.addEventListener('click', () => this.h.onMainMenu());
    this.debrief = el('section', { id: 'debrief', 'data-testid': 'debrief', 'aria-live': 'polite' }, [
      el('h2', { text: 'Debrief' }),
      this.debriefBody,
      replay,
      again,
      main2,
    ]);

    // Cameras
    const camList = el('div', { class: 'cams' });
    for (const id of ['auto', ...CAMERA_IDS] as const) {
      const label = id === 'auto' ? 'Auto director' : CAMERA_LABELS[id];
      const b = el('button', { class: 'btn', 'data-testid': `cam-${id}`, text: label });
      b.addEventListener('click', () => this.h.onCamera(id));
      this.camBtns.set(id, b);
      camList.append(b);
    }
    this.cams = el('section', { 'data-testid': 'cameras-section' }, [el('h2', { text: 'Cameras (C)' }), camList]);

    // Settings
    this.quality = el('select', { 'data-testid': 'quality', 'aria-label': 'Quality' });
    const qualityLabels: [QualitySetting, string][] = [
      ['auto', 'Auto'],
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ];
    for (const [q, label] of qualityLabels) this.quality.append(el('option', { value: q, text: label }));
    this.quality.addEventListener('change', () => {
      this.update({ quality: this.quality.value as QualitySetting });
    });
    this.mute = el('button', { class: 'toggle', 'data-testid': 'mute', 'aria-label': 'Sound (M)' });
    this.mute.addEventListener('click', () => this.update({ muted: !this.settings.muted }));
    this.volume = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '5',
      'aria-label': 'Master volume',
      'data-testid': 'volume',
    });
    this.volume.addEventListener('input', () => this.update({ volume: Number(this.volume.value) / 100 }));
    this.music = el('button', { class: 'toggle', 'data-testid': 'music', 'aria-label': 'Music' });
    this.music.addEventListener('click', () => this.update({ music: !this.settings.music }));
    this.reduced = el('button', { class: 'toggle', 'data-testid': 'reduced-motion', 'aria-label': 'Reduced motion' });
    this.reduced.addEventListener('click', () => this.update({ reducedMotion: !this.settings.reducedMotion }));
    this.oneHand = el('button', { class: 'toggle', 'data-testid': 'one-handed', 'aria-label': 'One-handed touch controls' });
    this.oneHand.addEventListener('click', () => this.update({ oneHanded: !this.settings.oneHanded }));
    this.preset = el('select', { 'data-testid': 'key-preset', 'aria-label': 'Key layout' });
    for (const [v, label] of [
      ['standard', 'Standard'],
      ['onehand', 'One-handed (left)'],
      ['custom', 'Custom'],
    ] as const) {
      this.preset.append(el('option', { value: v, text: label }));
    }
    this.preset.addEventListener('change', () => {
      const v = this.preset.value;
      if (v === 'standard' || v === 'onehand') this.update({ keyPreset: v, keys: presetKeys(v as KeyPreset) });
      else this.update({ keyPreset: 'custom' });
    });
    const keyList = el('div', { class: 'keys' });
    for (const a of KEY_ACTIONS) {
      const b = el('button', { class: 'keycap', 'data-testid': `key-${a}`, 'aria-label': `${KEY_ACTION_LABELS[a]}: change key` });
      b.addEventListener('click', () => this.startCapture(a));
      this.keyBtns.set(a, b);
      keyList.append(el('div', { class: 'row' }, [KEY_ACTION_LABELS[a], b]));
    }
    const keysBox = el('details', { class: 'keymap' }, [
      el('summary', { text: 'Remap keys' }),
      el('p', { class: 'sub', text: 'Pick an action, then press the new key. Esc cancels. Digits 1-9 always set the throttle.' }),
      keyList,
    ]);
    const clear = el('button', { class: 'btn', 'data-testid': 'clear-data', text: 'Clear my data' });
    clear.addEventListener('click', () => {
      this.h.onClearData();
      setText(this.cleared, 'Done. Settings and best scores are cleared from this device.');
      this.refreshBest();
    });
    const settingsSec = el('section', { 'data-testid': 'settings-section' }, [
      el('h2', { text: 'Settings' }),
      el('label', { class: 'row' }, ['Quality', this.quality]),
      el('div', { class: 'row' }, ['Sound (M)', this.mute]),
      el('label', { class: 'row' }, ['Volume', this.volume]),
      el('div', { class: 'row' }, ['Music', this.music]),
      el('div', { class: 'row' }, ['Reduced motion', this.reduced]),
      el('div', { class: 'row' }, ['One-handed touch', this.oneHand]),
      el('label', { class: 'row' }, ['Keys', this.preset]),
      keysBox,
      clear,
      this.cleared,
      el('div', { class: 'sub', text: 'No accounts, no tracking. Data stays on this device.' }),
    ]);

    // Real facts
    const facts = el('section', { 'data-testid': 'facts-section' }, [el('h2', { text: 'Real facts' })]);
    FACTS.forEach(([q, lines], i) => {
      const d = el('details', { class: 'fact', 'data-testid': i === 0 ? 'facts-card' : `fact-${i}` }, [
        el('summary', { text: q }),
        ...lines.map((l) => el('p', { text: l })),
      ]);
      facts.append(d);
    });

    this.rail = el('nav', { id: 'rail', class: 'ui', 'aria-label': 'Game menu', 'data-testid': 'rail' }, [
      el('h1', { text: 'Catch the Booster' }),
      el('p', { class: 'sub', text: 'Heron-class booster · the Catcher' }),
      this.play,
      this.pause,
      this.replay,
      this.debrief,
      this.cams,
      settingsSec,
      facts,
    ]);
    parent.append(this.rail, this.button);
    this.selectTier(this.tier);
    this.syncSettings();
    this.refreshBest();
    this.setMode('main');
  }

  private update(p: Partial<Settings>): void {
    this.settings = { ...this.settings, ...p };
    this.syncSettings();
    this.h.onSettings(this.settings);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.syncSettings();
  }

  private syncSettings(): void {
    const s = this.settings;
    this.quality.value = s.quality;
    this.mute.setAttribute('aria-pressed', String(!s.muted));
    this.mute.textContent = s.muted ? '✕ Muted' : '♪ On';
    this.volume.value = String(Math.round(s.volume * 100));
    this.music.setAttribute('aria-pressed', String(s.music));
    this.music.textContent = s.music ? 'On' : 'Off';
    this.reduced.setAttribute('aria-pressed', String(s.reducedMotion));
    this.reduced.textContent = s.reducedMotion ? 'On' : 'Off';
    this.oneHand.setAttribute('aria-pressed', String(s.oneHanded));
    this.oneHand.textContent = s.oneHanded ? 'On' : 'Off';
    this.preset.value = s.keyPreset;
    for (const [a, b] of this.keyBtns) {
      if (this.capture?.action === a) continue;
      b.textContent = s.keys[a].map(keyLabel).join(' / ') || '—';
    }
  }

  /** Waits for the next key and binds it to `action` (Esc cancels). */
  private startCapture(action: KeyAction): void {
    this.capture?.stop();
    const b = this.keyBtns.get(action);
    if (!b) return;
    b.textContent = 'Press a key…';
    b.classList.add('capturing');
    this.h.onCapture(true);
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      stop();
      if (e.code === 'Escape') return;
      const next = rebind(this.settings.keys, action, e.code);
      if (next !== this.settings.keys) this.update({ keys: next, keyPreset: 'custom' });
    };
    const stop = (): void => {
      window.removeEventListener('keydown', onKey, true);
      b.classList.remove('capturing');
      this.capture = null;
      this.h.onCapture(false);
      this.syncSettings();
    };
    window.addEventListener('keydown', onKey, true);
    this.capture = { action, stop };
  }

  selectTier(id: TierId): void {
    this.tier = id;
    for (const [t, b] of this.tierBtns) {
      b.classList.toggle('sel', t === id);
      b.setAttribute('aria-checked', String(t === id));
    }
    if (this.settings.tier !== id) this.update({ tier: id });
  }

  refreshBest(): void {
    const parts = TIERS.map((t) => `${TIER_CONFIG[t].name} ${this.bestFor(t) || '—'}`);
    setText(this.bestLine, `Best: ${parts.join(' · ')}`);
  }

  setCamera(current: CameraId, auto: boolean): void {
    for (const [id, b] of this.camBtns) {
      const on = auto ? id === 'auto' : id === current;
      if (b.classList.contains('sel') !== on) {
        b.classList.toggle('sel', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
  }

  setMode(m: MenuMode, focus = false): void {
    this.mode = m;
    this.capture?.stop();
    show(this.play, m === 'main');
    show(this.pause, m === 'paused');
    show(this.replay, m === 'replay');
    show(this.debrief, m === 'debrief');
    show(this.cams, m !== 'main' && m !== 'tutorial');
    if (m === 'main') this.refreshBest();
    if (m === 'playing' || m === 'replay' || m === 'tutorial') this.close();
    else this.open(focus);
  }

  open(focus = false): void {
    this.rail.classList.add('open');
    this.button.setAttribute('aria-expanded', 'true');
    this.rail.removeAttribute('inert');
    if (focus) {
      const first = this.rail.querySelector<HTMLElement>('section:not([hidden]) button');
      // focusVisible: Firefox otherwise hides the ring on a programmatic focus after Esc.
      first?.focus({ focusVisible: true } as FocusOptions);
    }
  }

  close(): void {
    this.rail.classList.remove('open');
    this.button.setAttribute('aria-expanded', 'false');
    // Closed drawer: out of the tab order and hidden from screen readers.
    this.rail.setAttribute('inert', '');
  }

  toggle(): void {
    if (this.rail.classList.contains('open')) this.close();
    else this.open();
  }

  get isOpen(): boolean {
    return this.rail.classList.contains('open');
  }

  showDebrief(d: DebriefData): void {
    if (this.countRaf !== null) cancelAnimationFrame(this.countRaf);
    this.countRaf = null;
    const s = d.score;
    const rows: [string, number, string][] = d.caught
      ? [
          ['Pin alignment', s.alignment, '/ 300'],
          ['Contact speed', s.contactSpeed, '/ 250'],
          ['Arm and rail load', s.load, '/ 150'],
          ['Fuel margin', s.fuel, '/ 150'],
          ['Ignition accuracy', s.ignition, '/ 100'],
          ['Stability', s.stability, '/ 50'],
        ]
      : [];
    for (const b of s.bonuses) {
      const name = b.id === 'goodCall' ? 'Good Call bonus' : b.id === 'engineOut' ? 'Engine-out recovery' : 'Wind master';
      rows.push([name, b.points, 'bonus']);
    }
    const counters: { node: HTMLElement; value: number; prefix: string }[] = [];
    const table = el('table');
    for (const [k, v, unit] of rows) {
      const num = el('span', { class: 'num', text: '0' });
      counters.push({ node: num, value: v, prefix: unit === 'bonus' ? '+' : '' });
      table.append(el('tr', {}, [el('td', { text: k }), el('td', {}, [num, el('span', { class: 'of', text: unit === 'bonus' ? '' : ` ${unit}` })])]));
    }
    const total = el('td', { 'data-testid': 'debrief-score', text: '0' });
    counters.push({ node: total, value: s.total, prefix: '' });
    table.append(el('tr', { class: 'total' }, [el('td', { text: 'Score' }), total]));

    const head: Element[] = [];
    if (s.medal !== 'none') {
      head.push(
        el('div', { class: `medal ${s.medal}`, 'data-testid': 'debrief-medal' }, [
          el('span', { class: 'glyph', 'aria-hidden': 'true', text: MEDAL_GLYPH[s.medal] }),
          el('span', { text: MEDAL_LABEL[s.medal] }),
        ]),
      );
    }
    if (!d.caught) head.push(splashArt(d.goodCall));
    const graphs = el('canvas', { class: 'graphs', 'data-testid': 'debrief-graphs', role: 'img' });
    graphs.setAttribute('aria-label', 'Altitude and speed against time, and the engines lit');
    const legend = el('div', { class: 'legend' }, [
      el('span', { class: 'alt', text: '━ altitude' }),
      el('span', { class: 'spd', text: '╍ speed' }),
      el('span', { class: 'eng', text: '▮ engines lit' }),
    ]);
    const bestText = d.isReplay ? `Best: ${d.best}` : d.newBest ? `★ New best: ${d.best}` : `Best: ${d.best}`;
    this.debriefBody.replaceChildren(
      el('div', { class: `outcome ${d.caught ? 'ok' : 'soft'}`, 'data-testid': 'debrief-outcome', text: d.title }),
      ...head,
      el('div', { class: 'sub', text: `${TIER_CONFIG[d.tier].name}${d.isReplay ? ' · replay' : ''}` }),
      el('div', { class: 'tip', 'data-testid': 'debrief-tip', text: d.tip }),
      table,
      el('div', { class: 'sub', 'data-testid': 'debrief-best', text: bestText }),
      ...(d.series ? [graphs, legend] : []),
    );
    this.setMode('debrief');
    if (d.series) {
      const series = d.series;
      // After layout, so the canvas has its CSS size.
      requestAnimationFrame(() => drawFlightGraphs(graphs, series, d.marks));
    }
    this.countUp(counters, d.countSeconds);
  }

  /** Animated counters (ease-out); instant when `seconds` is 0. */
  private countUp(items: { node: HTMLElement; value: number; prefix: string }[], seconds: number): void {
    const final = (): void => {
      for (const c of items) c.node.textContent = `${c.prefix}${c.value}`;
      this.countRaf = null;
    };
    if (seconds <= 0) {
      final();
      return;
    }
    const t0 = performance.now();
    const tick = (now: number): void => {
      const k = Math.min(1, (now - t0) / (seconds * 1000));
      if (k >= 1) {
        final();
        return;
      }
      const e = 1 - Math.pow(1 - k, 3);
      for (const c of items) c.node.textContent = `${c.prefix}${Math.round(c.value * e)}`;
      this.countRaf = requestAnimationFrame(tick);
    };
    this.countRaf = requestAnimationFrame(tick);
  }
}

/** A friendly splashdown card: the booster floating on calm sea, the recovery boat beside it. */
function splashArt(goodCall: boolean): SVGSVGElement {
  const s = svgEl('svg', { class: 'splash-art', viewBox: '0 0 240 90', role: 'img', 'data-testid': 'splash-art' });
  s.setAttribute('aria-label', 'The booster floats on calm water. The recovery boat is on its way.');
  s.append(
    svgEl('rect', { x: 0, y: 0, width: 240, height: 90, rx: 8, fill: '#1b2f45' }),
    svgEl('circle', { cx: 200, cy: 26, r: 12, fill: '#ffcf86', opacity: 0.85 }),
    svgEl('rect', { x: 0, y: 56, width: 240, height: 34, fill: '#1f5a7a' }),
    // The booster, lying on the water.
    svgEl('rect', { x: 30, y: 47, width: 92, height: 12, rx: 6, fill: '#c9ced4' }),
    svgEl('rect', { x: 30, y: 47, width: 10, height: 12, rx: 3, fill: '#5d6066' }),
    svgEl('path', { d: 'M100 47 l6 -6 l4 0 l-4 6 z', fill: '#8e9196' }),
    // The recovery boat with a flag.
    svgEl('path', { d: 'M150 54 h62 l-8 12 h-48 z', fill: '#f2f4f6' }),
    svgEl('rect', { x: 166, y: 42, width: 24, height: 12, rx: 2, fill: '#ff8a5c' }),
    svgEl('rect', { x: 170, y: 45, width: 6, height: 5, fill: '#1b2f45' }),
    svgEl('rect', { x: 180, y: 45, width: 6, height: 5, fill: '#1b2f45' }),
    svgEl('line', { x1: 196, y1: 54, x2: 196, y2: 32, stroke: '#f2f4f6', 'stroke-width': 1.5 }),
    svgEl('path', { d: 'M196 32 l12 4 l-12 4 z', fill: goodCall ? '#4fe08a' : '#5fffd0' }),
    // Calm waves.
    svgEl('path', { d: 'M0 64 q10 -4 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0', fill: 'none', stroke: '#8fd3f0', 'stroke-width': 1.5, opacity: 0.7 }),
    svgEl('path', { d: 'M0 76 q10 -4 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0', fill: 'none', stroke: '#8fd3f0', 'stroke-width': 1.2, opacity: 0.45 }),
  );
  return s;
}
