// Adaptive quality: Low / Medium / High, and Auto. Auto picks a start tier from the
// device, then drops one tier when the mean frame time stays above 18 ms for 2 s.
import type { QualitySetting } from '../app/storage';

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  tier: QualityTier;
  pixelRatioCap: number;
  particles: number;
  bloom: 'off' | 'half' | 'full';
  shadowMapSize: number; // 0 = shadows off
}

export const PROFILES: Record<QualityTier, QualityProfile> = {
  low: { tier: 'low', pixelRatioCap: 1.25, particles: 160, bloom: 'off', shadowMapSize: 0 },
  medium: { tier: 'medium', pixelRatioCap: 1.5, particles: 480, bloom: 'half', shadowMapSize: 1024 },
  high: { tier: 'high', pixelRatioCap: 2, particles: 1200, bloom: 'full', shadowMapSize: 2048 },
};

export const FRAME_BUDGET_MS = 18;
export const DROP_WINDOW_S = 2;

const ORDER: readonly QualityTier[] = ['low', 'medium', 'high'];

/** First guess for Auto, from what the browser tells us about the device. */
export function autoStartTier(nav: Navigator, screenW: number, screenH: number): QualityTier {
  const cores = nav.hardwareConcurrency || 4;
  const touch = (nav.maxTouchPoints || 0) > 0;
  const small = Math.min(screenW, screenH) < 600;
  if (cores <= 4 && touch) return 'low';
  if (touch || small) return 'medium';
  return 'high';
}

export class AdaptiveQuality {
  tier: QualityTier;
  drops = 0;
  private slowFor = 0;
  private emaMs = 16.7;

  constructor(
    public setting: QualitySetting,
    private readonly autoStart: QualityTier,
  ) {
    this.tier = setting === 'auto' ? autoStart : setting;
  }

  get profile(): QualityProfile {
    return PROFILES[this.tier];
  }

  set(setting: QualitySetting): void {
    this.setting = setting;
    this.tier = setting === 'auto' ? this.autoStart : setting;
    this.slowFor = 0;
  }

  /**
   * Feeds one frame time (ms). Returns true when Auto dropped a tier this frame.
   * Frames longer than 5 s (tab switches, resumes) are ignored; others are capped at 250 ms.
   * A software rasteriser can take over 1 s per frame, and that must still count as slow.
   */
  sample(frameMs: number): boolean {
    if (this.setting !== 'auto' || frameMs > 5000) return false;
    const ms = Math.min(frameMs, 250);
    this.emaMs += (ms - this.emaMs) * 0.1;
    if (this.emaMs > FRAME_BUDGET_MS) this.slowFor += ms / 1000;
    else this.slowFor = 0;
    if (this.slowFor < DROP_WINDOW_S) return false;
    this.slowFor = 0;
    const i = ORDER.indexOf(this.tier);
    if (i <= 0) return false;
    this.tier = ORDER[i - 1] ?? 'low';
    this.drops++;
    this.emaMs = 16.7;
    return true;
  }
}
