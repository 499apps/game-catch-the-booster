// Scoring (design doc section 7): 1000 points + bonuses, medals.
import { clamp01 } from './vec';

export const MAX = {
  alignment: 300,
  contactSpeed: 250,
  load: 150,
  fuel: 150,
  ignition: 100,
  stability: 50,
} as const;

export const BONUS_GOOD_CALL = 200;
export const BONUS_ENGINE_OUT = 100;
export const BONUS_WIND_MASTER = 100;
export const WIND_MASTER_MIN = 6; // m/s mean wind

/** 300 at 0 m, 0 at 1.5 m and beyond. */
export function alignmentScore(err: number): number {
  return MAX.alignment * clamp01(1 - Math.abs(err) / 1.5);
}

/** 250 below 0.5 m/s, 125 at 2 m/s, 0 at 4 m/s and beyond (piecewise linear). */
export function contactSpeedScore(v: number): number {
  const s = Math.abs(v);
  if (s <= 0.5) return MAX.contactSpeed;
  if (s <= 2) return MAX.contactSpeed * (1 - (0.5 * (s - 0.5)) / 1.5);
  return MAX.contactSpeed * 0.5 * clamp01(1 - (s - 2) / 2);
}

/** 150 at peak rail load <= 1.5 g, 0 at >= 4 g. */
export function loadScore(peakG: number): number {
  return MAX.load * clamp01(1 - (peakG - 1.5) / 2.5);
}

/** Distance of the propellant left (t) from the 5-15 t band. */
export function fuelError(tonnes: number): number {
  if (tonnes < 5) return 5 - tonnes;
  if (tonnes > 15) return tonnes - 15;
  return 0;
}
/** 150 inside 5-15 t; below 5 t falls to 30 at 0 t; above 15 t loses 5 points per tonne. */
export function fuelScore(tonnes: number): number {
  const t = Math.max(0, tonnes);
  if (t < 5) return 30 + (120 * t) / 5;
  if (t <= 15) return MAX.fuel;
  return Math.max(0, MAX.fuel - 5 * (t - 15));
}

/** 100 at 0 m from the ideal ignition point, 75 at 40 m ("pro"), 0 at 160 m. */
export function ignitionScore(err: number): number {
  return MAX.ignition * clamp01(1 - Math.abs(err) / 160);
}

/** 25 for tilt (0 at 2 deg) + 25 for lateral speed (0 at 1 m/s). */
export function stabilityScore(tiltDeg: number, lateralSpeed: number): number {
  return 25 * clamp01(1 - Math.abs(tiltDeg) / 2) + 25 * clamp01(1 - Math.abs(lateralSpeed) / 1);
}

export type Medal = 'none' | 'bronze' | 'silver' | 'gold' | 'bullseye';

export function medalFor(base: number, pinError: number, caught: boolean): Medal {
  if (!caught) return 'none';
  if (pinError < 0.3 && base >= 850) return 'bullseye';
  if (base >= 850) return 'gold';
  if (base >= 700) return 'silver';
  if (base >= 500) return 'bronze';
  return 'none';
}

export interface ScoreInput {
  caught: boolean;
  pinError: number;
  contactSpeed: number;
  peakLoadG: number;
  propellantKg: number;
  ignitionError: number;
  tiltDeg: number;
  lateralSpeed: number;
  goodCall: boolean;
  enginesLitAtIgnition: number;
  meanWind: number;
}

export interface ScoreBreakdown {
  alignment: number;
  contactSpeed: number;
  load: number;
  fuel: number;
  ignition: number;
  stability: number;
  base: number;
  bonuses: { id: 'goodCall' | 'engineOut' | 'windMaster'; points: number }[];
  total: number;
  medal: Medal;
  badges: ('pro' | 'fumes' | 'bullseye')[];
}

export function scoreRun(s: ScoreInput): ScoreBreakdown {
  const bonuses: ScoreBreakdown['bonuses'] = [];
  if (s.goodCall) bonuses.push({ id: 'goodCall', points: BONUS_GOOD_CALL });
  if (!s.caught) {
    const total = bonuses.reduce((a, b) => a + b.points, 0);
    return {
      alignment: 0, contactSpeed: 0, load: 0, fuel: 0, ignition: 0, stability: 0,
      base: 0, bonuses, total, medal: 'none', badges: [],
    };
  }
  const parts = {
    alignment: alignmentScore(s.pinError),
    contactSpeed: contactSpeedScore(s.contactSpeed),
    load: loadScore(s.peakLoadG),
    fuel: fuelScore(s.propellantKg / 1000),
    ignition: ignitionScore(s.ignitionError),
    stability: stabilityScore(s.tiltDeg, s.lateralSpeed),
  };
  const r = (v: number): number => Math.round(v);
  const base =
    r(parts.alignment) + r(parts.contactSpeed) + r(parts.load) + r(parts.fuel) + r(parts.ignition) + r(parts.stability);
  if (s.enginesLitAtIgnition < 13) bonuses.push({ id: 'engineOut', points: BONUS_ENGINE_OUT });
  if (s.meanWind >= WIND_MASTER_MIN) bonuses.push({ id: 'windMaster', points: BONUS_WIND_MASTER });
  const badges: ScoreBreakdown['badges'] = [];
  if (Math.abs(s.ignitionError) <= 40) badges.push('pro');
  if (s.propellantKg < 2000) badges.push('fumes');
  const medal = medalFor(base, s.pinError, true);
  if (medal === 'bullseye') badges.push('bullseye');
  return {
    alignment: r(parts.alignment),
    contactSpeed: r(parts.contactSpeed),
    load: r(parts.load),
    fuel: r(parts.fuel),
    ignition: r(parts.ignition),
    stability: r(parts.stability),
    base,
    bonuses,
    total: base + bonuses.reduce((a, b) => a + b.points, 0),
    medal,
    badges,
  };
}
