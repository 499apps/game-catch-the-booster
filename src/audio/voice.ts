// Spoken coach lines through the browser's speechSynthesis, offline only: the game uses a
// voice only if the device says it runs locally (`localService`). Network voices are never
// used, so no text leaves the device. With no local voice the game stays silent.

export class Voice {
  private voice: SpeechSynthesisVoice | null = null;
  private readonly synth: SpeechSynthesis | null;
  enabled = true;

  constructor() {
    let s: SpeechSynthesis | null = null;
    try {
      s = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    } catch {
      s = null;
    }
    this.synth = s;
    if (!s) return;
    this.pick();
    // Some browsers fill the voice list later.
    s.addEventListener?.('voiceschanged', () => this.pick());
  }

  private pick(): void {
    const s = this.synth;
    if (!s) return;
    let list: SpeechSynthesisVoice[] = [];
    try {
      list = s.getVoices().filter((v) => v.localService);
    } catch {
      list = [];
    }
    const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
    const en = list.filter((v) => v.lang.toLowerCase().startsWith('en'));
    this.voice =
      en.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? en.find((v) => v.default) ?? en[0] ?? null;
  }

  /** True when a local (offline) voice exists on this device. */
  get available(): boolean {
    return this.voice !== null;
  }

  /** Speaks `text` now, replacing any line still being spoken. */
  say(text: string): void {
    const s = this.synth;
    const v = this.voice;
    if (!this.enabled || !s || !v || !text) return;
    try {
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v;
      u.lang = v.lang;
      u.rate = 1.0;
      u.pitch = 1.05;
      s.speak(u);
    } catch {
      // Speech is a bonus: ignore any failure.
    }
  }

  stop(): void {
    try {
      this.synth?.cancel();
    } catch {
      // ignore
    }
  }
}
