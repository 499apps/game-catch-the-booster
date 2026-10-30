// The LEFT rail (desktop / tablet) that is also the left slide-out drawer on phones.
// Every menu lives here: Play + tier select, Pause, Cameras, Settings and the debrief.
import type { QualitySetting, Settings } from '../app/storage';
import { CAMERA_IDS, CAMERA_LABELS, type CameraId } from '../render/cameras';
import type { ScoreBreakdown } from '../sim/scoring';
import { TIER_CONFIG, TIERS, type TierId } from '../sim/tiers';
import { el, setText, show } from './dom';

export type MenuMode = 'main' | 'paused' | 'debrief' | 'playing';

export interface MenuHandlers {
  onStart: (tier: TierId) => void;
  onResume: () => void;
  onPause: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onReplay: () => void;
  onCamera: (id: CameraId | 'auto') => void;
  onSettings: (s: Settings) => void;
  onClearData: () => void;
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

export class Menu {
  readonly rail: HTMLElement;
  readonly button: HTMLButtonElement;
  mode: MenuMode = 'main';
  private tier: TierId;
  private readonly tierBtns = new Map<TierId, HTMLButtonElement>();
  private readonly camBtns = new Map<CameraId | 'auto', HTMLButtonElement>();
  private readonly play: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly debrief: HTMLElement;
  private readonly debriefBody = el('div');
  private readonly cams: HTMLElement;
  private readonly quality: HTMLSelectElement;
  private readonly mute: HTMLButtonElement;
  private readonly reduced: HTMLButtonElement;
  private readonly cleared = el('div', { class: 'sub', 'data-testid': 'cleared' });

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private readonly h: MenuHandlers,
  ) {
    this.tier = settings.tier;
    this.button = el('button', {
      id: 'menu-btn',
      class: 'ui',
      'aria-label': 'Menu',
      'aria-controls': 'rail',
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
    this.play = el('section', { 'data-testid': 'play-section' }, [
      el('h2', { text: 'Play: Final Approach' }),
      tierList,
      start,
    ]);

    // Pause
    const resume = el('button', { class: 'btn primary', 'data-testid': 'resume-btn', text: 'Resume' });
    resume.addEventListener('click', () => this.h.onResume());
    const restart = el('button', { class: 'btn', 'data-testid': 'restart-btn', text: 'Restart run' });
    restart.addEventListener('click', () => this.h.onRestart());
    const toMain = el('button', { class: 'btn', 'data-testid': 'main-btn', text: 'Main menu' });
    toMain.addEventListener('click', () => this.h.onMainMenu());
    this.pause = el('section', { 'data-testid': 'pause-section' }, [el('h2', { text: 'Paused' }), resume, restart, toMain]);

    // Debrief
    const replay = el('button', { class: 'btn primary', 'data-testid': 'replay-btn', text: 'Watch replay' });
    replay.addEventListener('click', () => this.h.onReplay());
    const again = el('button', { class: 'btn', 'data-testid': 'again-btn', text: 'Fly again' });
    again.addEventListener('click', () => this.h.onRestart());
    const main2 = el('button', { class: 'btn', text: 'Main menu' });
    main2.addEventListener('click', () => this.h.onMainMenu());
    this.debrief = el('section', { id: 'debrief', 'data-testid': 'debrief' }, [
      el('h2', { text: 'Debrief' }),
      this.debriefBody,
      replay,
      again,
      main2,
    ]);

    // Cameras
    const camList = el('div');
    for (const id of ['auto', ...CAMERA_IDS] as const) {
      const label = id === 'auto' ? 'Auto director' : CAMERA_LABELS[id];
      const b = el('button', { class: 'btn', 'data-testid': `cam-${id}`, text: label });
      b.addEventListener('click', () => this.h.onCamera(id));
      this.camBtns.set(id, b);
      camList.append(b);
    }
    this.cams = el('section', { 'data-testid': 'cameras-section' }, [el('h2', { text: 'Cameras' }), camList]);

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
    this.mute = el('button', { class: 'toggle', 'data-testid': 'mute', 'aria-label': 'Mute' });
    this.mute.addEventListener('click', () => this.update({ muted: !this.settings.muted }));
    this.reduced = el('button', { class: 'toggle', 'data-testid': 'reduced-motion', 'aria-label': 'Reduced motion' });
    this.reduced.addEventListener('click', () => this.update({ reducedMotion: !this.settings.reducedMotion }));
    const clear = el('button', { class: 'btn', 'data-testid': 'clear-data', text: 'Clear my data' });
    clear.addEventListener('click', () => {
      this.h.onClearData();
      setText(this.cleared, 'Done. Settings and best scores are cleared from this device.');
    });
    const settingsSec = el('section', { 'data-testid': 'settings-section' }, [
      el('h2', { text: 'Settings' }),
      el('label', { class: 'row' }, ['Quality', this.quality]),
      el('div', { class: 'row' }, ['Sound', this.mute]),
      el('div', { class: 'row' }, ['Reduced motion', this.reduced]),
      clear,
      this.cleared,
      el('div', { class: 'sub', text: 'No accounts, no tracking. Data stays on this device.' }),
    ]);

    this.rail = el('nav', { id: 'rail', class: 'ui', 'aria-label': 'Game menu', 'data-testid': 'rail' }, [
      el('h1', { text: 'Catch the Booster' }),
      el('p', { class: 'sub', text: 'Heron-class booster · the Catcher' }),
      this.play,
      this.pause,
      this.debrief,
      this.cams,
      settingsSec,
    ]);
    parent.append(this.rail, this.button);
    this.selectTier(this.tier);
    this.syncSettings();
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
    this.quality.value = this.settings.quality;
    this.mute.setAttribute('aria-pressed', String(this.settings.muted));
    this.mute.textContent = this.settings.muted ? 'Muted' : 'On';
    this.reduced.setAttribute('aria-pressed', String(this.settings.reducedMotion));
    this.reduced.textContent = this.settings.reducedMotion ? 'On' : 'Off';
  }

  selectTier(id: TierId): void {
    this.tier = id;
    for (const [t, b] of this.tierBtns) {
      b.classList.toggle('sel', t === id);
      b.setAttribute('aria-checked', String(t === id));
    }
    if (this.settings.tier !== id) this.update({ tier: id });
  }

  setCamera(current: CameraId, auto: boolean): void {
    for (const [id, b] of this.camBtns) b.classList.toggle('sel', auto ? id === 'auto' : id === current);
  }

  setMode(m: MenuMode): void {
    this.mode = m;
    show(this.play, m === 'main');
    show(this.pause, m === 'paused');
    show(this.debrief, m === 'debrief');
    show(this.cams, m !== 'main');
    if (m === 'playing') this.close();
    else this.open();
  }

  open(): void {
    this.rail.classList.add('open');
    this.button.setAttribute('aria-expanded', 'true');
  }

  close(): void {
    this.rail.classList.remove('open');
    this.button.setAttribute('aria-expanded', 'false');
  }

  toggle(): void {
    if (this.rail.classList.contains('open')) this.close();
    else this.open();
  }

  get isOpen(): boolean {
    return this.rail.classList.contains('open');
  }

  showDebrief(d: DebriefData): void {
    const s = d.score;
    const rows: [string, string][] = d.caught
      ? [
          ['Pin alignment', `${s.alignment} / 300`],
          ['Contact speed', `${s.contactSpeed} / 250`],
          ['Arm and rail load', `${s.load} / 150`],
          ['Fuel margin', `${s.fuel} / 150`],
          ['Ignition accuracy', `${s.ignition} / 100`],
          ['Stability', `${s.stability} / 50`],
        ]
      : [];
    for (const b of s.bonuses) {
      const name = b.id === 'goodCall' ? 'Good Call bonus' : b.id === 'engineOut' ? 'Engine-out recovery' : 'Wind master';
      rows.push([name, `+${b.points}`]);
    }
    const table = el('table');
    for (const [k, v] of rows) table.append(el('tr', {}, [el('td', { text: k }), el('td', { text: v })]));
    table.append(
      el('tr', { class: 'total' }, [
        el('td', { text: 'Score' }),
        el('td', { 'data-testid': 'debrief-score', text: String(s.total) }),
      ]),
    );
    const medal = MEDAL_LABEL[s.medal];
    this.debriefBody.replaceChildren(
      el('div', { class: 'outcome', 'data-testid': 'debrief-outcome', text: d.title }),
      el('div', { class: 'medal', text: medal }),
      el('div', { class: 'sub', text: `${TIER_CONFIG[d.tier].name}${d.isReplay ? ' · replay' : ''}` }),
      table,
      el('div', { class: 'sub', text: d.newBest ? `New best: ${d.best}` : `Best: ${d.best}` }),
      el('div', { class: 'tip', 'data-testid': 'debrief-tip', text: d.tip }),
    );
    this.setMode('debrief');
  }
}
