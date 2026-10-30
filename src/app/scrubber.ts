// Replay transport math (no DOM): play / pause, 0.5x / 1x / 2x, scrubbing, and the
// "last 15 s" window of the split-screen synced cams.

export const REPLAY_SPEEDS: readonly number[] = [0.5, 1, 2];
/** Seconds at the end of the flight that the 2x2 split view replays. */
export const SPLIT_WINDOW = 15;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class ReplayClock {
  t = 0;
  playing = true;
  speed = 1;
  /** Earliest time the clock may show (the split window start, or 0). */
  min = 0;
  /** True once the clock has reached the end at least once. */
  ended = false;

  constructor(readonly duration: number) {}

  /** Start of the split-screen window: the last 15 s. */
  get splitStart(): number {
    return Math.max(0, this.duration - SPLIT_WINDOW);
  }

  /** 0..1 position over the whole flight. */
  get frac(): number {
    return this.duration > 0 ? this.t / this.duration : 0;
  }

  /** Advances by `dt` real seconds. Returns true on the frame the end is first reached. */
  update(dt: number): boolean {
    if (!this.playing) return false;
    this.t = clamp(this.t + dt * this.speed, this.min, this.duration);
    if (this.t >= this.duration) {
      this.playing = false;
      if (!this.ended) {
        this.ended = true;
        return true;
      }
    }
    return false;
  }

  seek(t: number): void {
    this.t = clamp(t, this.min, this.duration);
  }

  seekFrac(f: number): void {
    this.seek(clamp(f, 0, 1) * this.duration);
  }

  /** Play / pause. Playing again from the end restarts at the window start. */
  toggle(): void {
    if (!this.playing && this.t >= this.duration) this.t = this.min;
    this.playing = !this.playing;
  }

  setSpeed(s: number): void {
    this.speed = REPLAY_SPEEDS.includes(s) ? s : 1;
  }

  /** 0.5 -> 1 -> 2 -> 0.5 ... */
  cycleSpeed(): number {
    const i = REPLAY_SPEEDS.indexOf(this.speed);
    this.speed = REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length] ?? 1;
    return this.speed;
  }

  /** Enters or leaves the split window; entering jumps to its start and plays. */
  setSplit(on: boolean): void {
    this.min = on ? this.splitStart : 0;
    if (on) {
      this.t = this.min;
      this.playing = true;
    } else this.t = clamp(this.t, 0, this.duration);
  }
}

/** Pointer x on a scrub bar -> 0..1. */
export function fracFromPointer(x: number, left: number, width: number): number {
  if (width <= 0) return 0;
  return clamp((x - left) / width, 0, 1);
}

/** "00:12.3". */
export function formatReplayTime(t: number): string {
  const a = Math.round(Math.max(0, t) * 10) / 10;
  const m = Math.floor(a / 60);
  const s = Math.round((a - m * 60) * 10) / 10;
  return `${String(m).padStart(2, '0')}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
