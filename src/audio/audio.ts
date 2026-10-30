// Procedural Web Audio only (no sound files). The engine roar and the booster sounds
// reach the active camera after distance / 343 m/s, so the ground cams see ignition in
// silence. Buses: effects (roar + one-shots) and a calm adaptive music bed.
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
  | 'splash'
  | 'tick'
  | 'stingerCatch'
  | 'stingerSplash';

interface Sample {
  t: number;
  level: number;
  three: boolean;
  fins: number;
}

/** Deterministic noise so every run sounds the same (and no Math.random in the mix). */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// D major 9 pad: calm and kid-friendly. Tension adds a soft pulse on A.
const PAD_NOTES = [146.83, 220.0, 293.66, 369.99, 659.25];
const TENSION_NOTE = 110.0;
const CATCH_ARP = [587.33, 739.99, 880.0, 1174.66, 1479.98];
const SPLASH_ARP = [659.25, 587.33, 739.99];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crackle: AudioBuffer | null = null;
  private clicks: AudioBuffer | null = null;
  private rumble13: GainNode | null = null;
  private crackle13: GainNode | null = null;
  private pillar3: GainNode | null = null;
  private hum3: GainNode | null = null;
  private finGain: GainNode | null = null;
  private roarFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private tensionGain: GainNode | null = null;
  private tensionFilter: BiquadFilterNode | null = null;
  private history: Sample[] = [];
  private scheduled: AudioScheduledSourceNode[] = [];
  private muted = false;
  private volume = 0.8;
  private musicOn = true;
  private rnd = lcg(7);
  /** Sim seconds per real second; delays are in sim time. */
  timescale = 1;

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  private masterLevel(): number {
    return this.muted ? 0 : this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.05);
  }

  /** Master volume 0..1. */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.05);
  }

  setMusicOn(on: boolean): void {
    this.musicOn = on;
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.3);
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
    this.master.gain.value = this.masterLevel();
    // A gentle limiter so the thud + roar + crowd never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 1 : 0;
    this.musicBus.connect(this.master);

    this.noise = this.makeNoise(2);
    this.crackle = this.makeCrackle(1.5);
    this.clicks = this.makeClicks(1);
    this.buildRoar();
    this.buildMusic();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = lcg(1);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    return b;
  }

  /** Sparse decaying impulses: the crackle of 13 engines. */
  private makeCrackle(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = lcg(3);
    let env = 0;
    let sign = 1;
    for (let i = 0; i < len; i++) {
      if (r() < 0.0035) {
        env = 0.4 + r() * 0.6;
        sign = r() < 0.5 ? -1 : 1;
      }
      d[i] = env * sign * (0.6 + 0.4 * r());
      env *= 0.93;
      if (r() < 0.3) sign = -sign;
    }
    return b;
  }

  /** Fast irregular ticks: grid fins chattering in the airflow. */
  private makeClicks(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = lcg(5);
    let env = 0;
    const gap = ctx.sampleRate / 38;
    let nextAt = 0;
    for (let i = 0; i < len; i++) {
      if (i >= nextAt) {
        env = 0.5 + r() * 0.5;
        nextAt = i + gap * (0.5 + r());
      }
      d[i] = env * (r() * 2 - 1);
      env *= 0.985;
    }
    return b;
  }

  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const ctx = this.ctx as AudioContext;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }

  private gainNode(v = 0): GainNode {
    const g = (this.ctx as AudioContext).createGain();
    g.gain.value = v;
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = (this.ctx as AudioContext).createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private buildRoar(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise || !this.crackle || !this.clicks) return;
    // Distance low-pass on the whole roar: far cams hear only the rumble.
    this.roarFilter = this.filter('lowpass', 900);
    this.roarFilter.connect(this.sfxBus);
    const noise = this.loop(this.noise);
    // 13 engines: a wide, deep rumble plus crackle.
    this.rumble13 = this.gainNode();
    noise.connect(this.filter('lowpass', 150)).connect(this.rumble13).connect(this.roarFilter);
    this.crackle13 = this.gainNode();
    this.loop(this.crackle).connect(this.filter('bandpass', 1400, 0.6)).connect(this.crackle13).connect(this.roarFilter);
    // 3 engines: a tighter, brighter pillar and a low hum.
    this.pillar3 = this.gainNode();
    noise.connect(this.filter('bandpass', 480, 1.1)).connect(this.pillar3).connect(this.roarFilter);
    this.hum3 = this.gainNode();
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 41;
    hum.connect(this.filter('lowpass', 120)).connect(this.hum3).connect(this.roarFilter);
    hum.start();
    // Grid-fin chatter (not through the distance filter: it is a near-field sound).
    this.finGain = this.gainNode();
    this.loop(this.clicks).connect(this.filter('bandpass', 2600, 1.4)).connect(this.finGain).connect(this.sfxBus);
  }

  private buildMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    this.padGain = this.gainNode(0);
    const padFilter = this.filter('lowpass', 1400);
    this.padGain.connect(padFilter).connect(this.musicBus);
    PAD_NOTES.forEach((f, i) => {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = i === PAD_NOTES.length - 1 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = detune;
        const g = this.gainNode(i === PAD_NOTES.length - 1 ? 0.12 : 0.22);
        o.connect(g).connect(this.padGain as GainNode);
        o.start();
      }
    });
    // Tension: a soft pulsing low note whose filter opens as the burn goes on.
    this.tensionGain = this.gainNode(0);
    this.tensionFilter = this.filter('lowpass', 300, 2);
    const t = ctx.createOscillator();
    t.type = 'sawtooth';
    t.frequency.value = TENSION_NOTE;
    const pulse = this.gainNode(0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 2;
    const lfoDepth = this.gainNode(0.5);
    lfo.connect(lfoDepth).connect(pulse.gain);
    t.connect(this.tensionFilter).connect(pulse).connect(this.tensionGain).connect(this.musicBus);
    t.start();
    lfo.start();
  }

  /**
   * Music bed: 0 = calm (menu, coast), 1 = full tension (the last seconds before the catch).
   * `active` false fades the bed out (debrief silence before the stinger).
   */
  setMusic(intensity: number, active = true): void {
    const ctx = this.ctx;
    if (!ctx || !this.padGain || !this.tensionGain || !this.tensionFilter) return;
    const k = Math.min(1, Math.max(0, intensity));
    const now = ctx.currentTime;
    this.padGain.gain.setTargetAtTime(active ? 0.05 * (1 - 0.4 * k) : 0, now, 0.8);
    this.tensionGain.gain.setTargetAtTime(active ? 0.06 * k : 0, now, 0.6);
    this.tensionFilter.frequency.setTargetAtTime(250 + 1100 * k, now, 0.6);
  }

  pause(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** New run (or back to the menu): forget the roar history and cancel delayed sounds. */
  resetRun(): void {
    this.history = [];
    for (const s of this.scheduled) {
      try {
        s.stop();
      } catch {
        // Already stopped.
      }
    }
    this.scheduled = [];
    const ctx = this.ctx;
    if (!ctx) return;
    for (const g of [this.rumble13, this.crackle13, this.pillar3, this.hum3, this.finGain]) g?.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  /**
   * Feeds the engine level (0..1) and grid-fin chatter (0..1) at sim time t, and applies
   * what the camera hears now: the sound emitted distance / 343 m/s ago.
   */
  updateRoar(t: number, level: number, three: boolean, distance: number, fins = 0): void {
    this.history.push({ t, level, three, fins });
    const heardAt = t - distance / SOUND_SPEED;
    while (this.history.length > 2 && (this.history[1]?.t ?? Infinity) <= heardAt) this.history.shift();
    const ctx = this.ctx;
    if (!ctx || !this.rumble13 || !this.crackle13 || !this.pillar3 || !this.hum3 || !this.finGain || !this.roarFilter) return;
    const h = this.history[0];
    const heard = h && h.t <= heardAt ? h : null;
    const att = 1 / (1 + distance / 600);
    const lvl = heard ? heard.level * att : 0;
    const now = ctx.currentTime;
    const k = 0.08;
    const thirteen = heard && !heard.three ? lvl : 0;
    const three3 = heard && heard.three ? lvl : 0;
    this.rumble13.gain.setTargetAtTime(thirteen * 1.5, now, k);
    this.crackle13.gain.setTargetAtTime(thirteen * 0.9 * (0.4 + 0.6 * att), now, k);
    this.pillar3.gain.setTargetAtTime(three3 * 1.0, now, k);
    this.hum3.gain.setTargetAtTime(three3 * 0.35, now, k);
    this.finGain.gain.setTargetAtTime((heard ? heard.fins : 0) * 0.12 * att, now, 0.1);
    this.roarFilter.frequency.setTargetAtTime(260 + 3200 * att, now, 0.2);
  }

  /** Plays a sound after `delaySim` seconds of sim time (speed-of-sound delay). */
  play(sfx: Sfx, delaySim = 0, gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise) return;
    const t0 = ctx.currentTime + Math.max(0, delaySim) / Math.max(this.timescale, 0.1);
    const bus = this.sfxBus;
    switch (sfx) {
      case 'relight':
        this.burst(t0, 0.07, 'bandpass', 700, 0.55 * gain, bus);
        this.tone(t0, 160, 0.12, 0.25 * gain, 60, 'square', bus);
        break;
      case 'hiss':
        this.burst(t0, 1.6, 'highpass', 3800, 0.16 * gain, bus, 0.25);
        this.burst(t0 + 0.2, 2.8, 'bandpass', 1800, 0.06 * gain, bus, 0.4);
        break;
      case 'clunk':
        this.tone(t0, 82, 0.3, 0.55 * gain, 46, 'sine', bus);
        this.burst(t0, 0.06, 'bandpass', 1200, 0.3 * gain, bus);
        break;
      case 'thud':
        this.tone(t0, 52, 1.1, 1.0 * gain, 26, 'sine', bus);
        this.tone(t0, 104, 0.4, 0.3 * gain, 50, 'triangle', bus);
        this.burst(t0, 0.45, 'lowpass', 240, 0.7 * gain, bus);
        break;
      case 'creak':
        this.tone(t0 + 0.2, 150, 1.5, 0.06 * gain, 92, 'sawtooth', bus);
        this.tone(t0 + 0.6, 118, 1.2, 0.05 * gain, 84, 'sawtooth', bus);
        break;
      case 'crowd':
        this.burst(t0, 5, 'bandpass', 1000, 0.2 * gain, bus, 1.4);
        this.burst(t0 + 0.4, 4, 'bandpass', 2200, 0.08 * gain, bus, 1.2);
        break;
      case 'blip':
        this.tone(t0, 1250, 0.07, 0.11 * gain, 1250, 'sine', bus);
        this.tone(t0 + 0.1, 1650, 0.07, 0.11 * gain, 1650, 'sine', bus);
        this.burst(t0 + 0.18, 0.12, 'bandpass', 2400, 0.03 * gain, bus);
        break;
      case 'tick':
        this.tone(t0, 1800, 0.04, 0.08 * gain, 1800, 'sine', bus);
        break;
      case 'boom':
        // The double crack: two sharp N-waves, then a low rumble tail.
        this.burst(t0, 0.16, 'lowpass', 1100, 1.0 * gain, bus);
        this.tone(t0, 60, 0.5, 0.5 * gain, 30, 'sine', bus);
        this.burst(t0 + 0.32, 0.16, 'lowpass', 1100, 0.9 * gain, bus);
        this.tone(t0 + 0.32, 55, 0.7, 0.45 * gain, 28, 'sine', bus);
        break;
      case 'splash':
        this.burst(t0, 2.0, 'lowpass', 700, 0.35 * gain, bus, 0.15);
        this.burst(t0 + 0.1, 1.4, 'highpass', 2500, 0.06 * gain, bus, 0.2);
        break;
      case 'stingerCatch':
        if (!this.musicBus) break;
        CATCH_ARP.forEach((f, i) => {
          this.tone(t0 + i * 0.09, f, 1.6, 0.07 * gain, f, 'triangle', this.musicBus as GainNode);
          this.tone(t0 + i * 0.09, f * 2, 0.8, 0.02 * gain, f * 2, 'sine', this.musicBus as GainNode);
        });
        break;
      case 'stingerSplash':
        if (!this.musicBus) break;
        SPLASH_ARP.forEach((f, i) => this.tone(t0 + i * 0.22, f, 1.2, 0.06 * gain, f, 'triangle', this.musicBus as GainNode));
        break;
    }
  }

  private keep(n: AudioScheduledSourceNode): void {
    this.scheduled.push(n);
    n.onended = () => {
      const i = this.scheduled.indexOf(n);
      if (i >= 0) this.scheduled.splice(i, 1);
    };
  }

  private burst(t0: number, dur: number, type: BiquadFilterType, freq: number, gain: number, bus: AudioNode, attack = 0.005): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t0, this.rnd() * 1.5);
    src.stop(t0 + attack + dur + 0.05);
    this.keep(src);
  }

  private tone(t0: number, freq: number, dur: number, gain: number, endFreq: number, type: OscillatorType, bus: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    this.keep(o);
  }
}
