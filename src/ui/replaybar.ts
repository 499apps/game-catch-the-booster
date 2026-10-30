// Replay transport: play / pause, a scrubber, the time, 0.5x / 1x / 2x, the 2x2
// split-screen synced cams (last 15 s) and the camera. The math is src/app/scrubber.ts.
import { formatReplayTime, type ReplayClock } from '../app/scrubber';
import { el, setText, show } from './dom';

/** "+00:12.3" / "-00:02.0": a signed replay time (from ignition). */
export function formatSigned(t: number): string {
  return `${t < 0 ? '-' : '+'}${formatReplayTime(Math.abs(t))}`;
}

export interface ReplayBarHandlers {
  onToggle: () => void;
  onSeek: (frac: number) => void;
  onSpeed: () => void;
  onSplit: () => void;
  onCamera: () => void;
  onExit: () => void;
}

export class ReplayBar {
  readonly root: HTMLDivElement;
  private readonly playBtn = el('button', { class: 'rb play', 'data-testid': 'replay-play', 'aria-label': 'Pause' });
  private readonly scrub = el('input', {
    type: 'range',
    min: '0',
    max: '1000',
    step: '1',
    value: '0',
    class: 'scrub',
    'data-testid': 'replay-scrub',
    'aria-label': 'Replay position',
  });
  private readonly time = el('span', { class: 'time', 'data-testid': 'replay-time' });
  private readonly speedBtn = el('button', { class: 'rb', 'data-testid': 'replay-speed', 'aria-label': 'Replay speed' });
  private readonly splitBtn = el('button', { class: 'rb', 'data-testid': 'replay-split', 'aria-pressed': 'false', text: '⊞ Split 15 s' });
  private readonly camBtn = el('button', { class: 'rb', 'data-testid': 'replay-cam', text: 'Cam ⟳' });
  private readonly window = el('i', { class: 'window' });
  /** Phones: the split-view tag lives in the bar (it would sit on a panel otherwise). */
  private readonly splitTag = el('span', { class: 'split-tag', 'data-testid': 'replay-split-tag', text: 'SPLIT · SYNCED' });
  private dragging = false;

  constructor(parent: HTMLElement, h: ReplayBarHandlers) {
    const exit = el('button', { class: 'rb', 'data-testid': 'replay-bar-exit', 'aria-label': 'Exit replay', text: '✕' });
    const track = el('div', { class: 'scrub-wrap' }, [this.window, this.scrub]);
    this.root = el('div', { id: 'replay-bar', class: 'ui', 'data-testid': 'replay-bar', role: 'toolbar', 'aria-label': 'Replay controls' }, [
      el('span', { class: 'tag', text: '● REPLAY' }),
      this.splitTag,
      this.playBtn,
      track,
      this.time,
      this.speedBtn,
      this.splitBtn,
      this.camBtn,
      exit,
    ]);
    this.root.hidden = true;
    parent.append(this.root);
    this.playBtn.addEventListener('click', h.onToggle);
    this.speedBtn.addEventListener('click', h.onSpeed);
    this.splitBtn.addEventListener('click', h.onSplit);
    this.camBtn.addEventListener('click', h.onCamera);
    exit.addEventListener('click', h.onExit);
    this.scrub.addEventListener('pointerdown', () => (this.dragging = true));
    const release = (): void => {
      this.dragging = false;
    };
    this.scrub.addEventListener('pointerup', release);
    this.scrub.addEventListener('pointercancel', release);
    this.scrub.addEventListener('change', release);
    this.scrub.addEventListener('input', () => h.onSeek(Number(this.scrub.value) / 1000));
  }

  setVisible(on: boolean): void {
    show(this.root, on);
  }

  /**
   * `ignitionT`: sim time of the ignition. When known, the time reads T- / T+ from ignition,
   * the same clock as the flight HUD (the run starts with the 3 s pre-roll before it).
   */
  update(c: ReplayClock, split: boolean, ignitionT: number | null = null): void {
    setText(this.playBtn, c.playing ? '❚❚' : '▶');
    this.playBtn.setAttribute('aria-label', c.playing ? 'Pause' : 'Play');
    if (!this.dragging) {
      const v = String(Math.round(c.frac * 1000));
      if (this.scrub.value !== v) this.scrub.value = v;
    }
    show(this.splitTag, split);
    if (ignitionT !== null) setText(this.time, `T${formatSigned(c.t - ignitionT)} / T${formatSigned(c.duration - ignitionT)}`);
    else setText(this.time, `${formatReplayTime(c.t)} / ${formatReplayTime(c.duration)}`);
    setText(this.speedBtn, `${c.speed}×`);
    this.splitBtn.setAttribute('aria-pressed', String(split));
    this.splitBtn.classList.toggle('sel', split);
    // Shade the split window on the track.
    const start = c.duration > 0 ? (c.splitStart / c.duration) * 100 : 0;
    this.window.style.left = `${start.toFixed(1)}%`;
    this.window.classList.toggle('on', split);
  }
}
