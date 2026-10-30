// Procedural Web Audio only (no sound files). The engine roar and the booster sounds
// reach the active camera after distance / 343 m/s, so the ground cams see ignition in silence.
import { SOUND_SPEED } from '../sim/constants';

export type Sfx =
  | 'relight'
  | 'hiss'
  | 'clunk'
  | 'thud'
  | 'creak'
  | 'crowd'
  | 'blip'
  | 'boom'
  | 'splash';

interface Sample {
  t: number;
  level: number;
  three: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private roarGain13: GainNode | null = null;
  private roarGain3: GainNode | null = null;
  private roarFilter: BiquadFilterNode | null = null;
  private history: Sample[] = [];
  private muted = false;
  /** Sim seconds per real second; delays are in sim time. */
  timescale = 1;

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** Must run inside a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 1;
    for (let i = 0; i < len; i++) {
      s = (s * 16807) % 2147483647;
      d[i] = (s / 2147483647) * 2 - 1;
    }
    // Roar: one noise source, two filtered layers (wide 13-engine rumble, tight 3-engine pillar).
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'lowpass';
    this.roarFilter.frequency.value = 600;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 180;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.7;
    this.roarGain13 = ctx.createGain();
    this.roarGain3 = ctx.createGain();
    this.roarGain13.gain.value = 0;
    this.roarGain3.gain.value = 0;
    src.connect(this.roarFilter);
    this.roarFilter.connect(low).connect(this.roarGain13).connect(this.master);
    this.roarFilter.connect(band).connect(this.roarGain3).connect(this.master);
    src.start();
  }

  pause(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  resetRun(): void {
    this.history = [];
  }

  /**
   * Feeds the current engine level (0..1) at sim time t, and applies the level the
   * camera hears now: the one emitted distance / 343 m/s ago.
   */
  updateRoar(t: number, level: number, three: boolean, distance: number): void {
    this.history.push({ t, level, three });
    const heardAt = t - distance / SOUND_SPEED;
    while (this.history.length > 2 && (this.history[1]?.t ?? Infinity) <= heardAt) this.history.shift();
    const ctx = this.ctx;
    if (!ctx || !this.roarGain13 || !this.roarGain3 || !this.roarFilter) return;
    const h = this.history[0];
    const heard = h && h.t <= heardAt ? h : null;
    const att = 1 / (1 + distance / 600);
    const lvl = heard ? heard.level * att : 0;
    const now = ctx.currentTime;
    this.roarGain13.gain.setTargetAtTime(heard && !heard.three ? lvl * 1.4 : 0, now, 0.08);
    this.roarGain3.gain.setTargetAtTime(heard && heard.three ? lvl * 0.9 : 0, now, 0.08);
    // Distance low-pass: far cams hear only the rumble.
    this.roarFilter.frequency.setTargetAtTime(300 + 2600 * att, now, 0.2);
  }

  /** Plays a sound after `delaySim` seconds of sim time (speed-of-sound delay). */
  play(sfx: Sfx, delaySim = 0, gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime + Math.max(0, delaySim) / Math.max(this.timescale, 0.1);
    switch (sfx) {
      case 'relight':
        this.burst(t0, 0.09, 'bandpass', 900, 0.5 * gain);
        break;
      case 'hiss':
        this.burst(t0, 1.4, 'highpass', 3500, 0.18 * gain, 0.3);
        break;
      case 'clunk':
        this.tone(t0, 70, 0.25, 0.5 * gain, 40);
        break;
      case 'thud':
        this.tone(t0, 48, 0.9, 0.9 * gain, 28);
        this.burst(t0, 0.35, 'lowpass', 220, 0.6 * gain);
        break;
      case 'creak':
        this.tone(t0, 140, 1.2, 0.08 * gain, 90, 'sawtooth');
        break;
      case 'crowd':
        this.burst(t0, 4.5, 'bandpass', 1100, 0.22 * gain, 1.2);
        break;
      case 'blip':
        this.tone(t0, 1250, 0.07, 0.12 * gain);
        this.tone(t0 + 0.1, 1650, 0.07, 0.12 * gain);
        break;
      case 'boom':
        this.burst(t0, 0.18, 'lowpass', 900, 0.9 * gain);
        this.burst(t0 + 0.28, 0.18, 'lowpass', 900, 0.8 * gain);
        break;
      case 'splash':
        this.burst(t0, 1.8, 'lowpass', 700, 0.35 * gain, 0.15);
        break;
    }
  }

  private burst(t0: number, dur: number, type: BiquadFilterType, freq: number, gain: number, attack = 0.005): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + attack + dur + 0.05);
  }

  private tone(
    t0: number,
    freq: number,
    dur: number,
    gain: number,
    endFreq = freq,
    type: OscillatorType = 'sine',
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}
