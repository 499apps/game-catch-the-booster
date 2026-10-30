// Difficulty tiers (design doc section 6).
import { LATERAL_SPEED_LIMIT, PIN_HEIGHT_AT_CLOSE_MAX, PIN_WINDOW, TILT_LIMIT_DEG } from './constants';

export type TierId = 'cadet' | 'pilot' | 'fd';
export const TIERS: readonly TierId[] = ['cadet', 'pilot', 'fd'];

export interface TierConfig {
  id: TierId;
  name: string;
  /** Who flies what. */
  control: 'cadet' | 'pilot' | 'fd';
  autoIgnition: boolean;
  autoStepDown: boolean;
  autoGoNoGo: boolean;
  pinWindow: number;
  pinHeightAtCloseMax: number;
  tiltLimitDeg: number;
  lateralSpeedLimit: number;
  windMean: [number, number]; // m/s range of the mean wind
  gustSigma: number; // m/s
  shear: number; // fractional increase of the mean wind from 100 m to 400 m
  /** Probabilities of 0, 1, 2 engines failing to light at ignition. */
  ignitionFailures: [number, number, number];
  towerSensorFaultProb: number;
  armCloseTime: [number, number]; // s
  propellant: [number, number]; // kg at ignition
  slowMoLast20m: boolean;
}

export const TIER_CONFIG: Record<TierId, TierConfig> = {
  cadet: {
    id: 'cadet',
    name: 'Cadet',
    control: 'cadet',
    autoIgnition: true,
    autoStepDown: true,
    autoGoNoGo: true,
    pinWindow: 3,
    pinHeightAtCloseMax: 25,
    tiltLimitDeg: 3,
    lateralSpeedLimit: 1.5,
    windMean: [0, 0],
    gustSigma: 0,
    shear: 0,
    ignitionFailures: [1, 0, 0],
    towerSensorFaultProb: 0,
    armCloseTime: [5.0, 5.0],
    propellant: [68_000, 68_000],
    slowMoLast20m: true,
  },
  pilot: {
    id: 'pilot',
    name: 'Pilot',
    control: 'pilot',
    autoIgnition: false,
    autoStepDown: false,
    autoGoNoGo: true,
    pinWindow: PIN_WINDOW,
    pinHeightAtCloseMax: PIN_HEIGHT_AT_CLOSE_MAX,
    tiltLimitDeg: TILT_LIMIT_DEG,
    lateralSpeedLimit: LATERAL_SPEED_LIMIT,
    windMean: [2, 4],
    gustSigma: 0.5,
    shear: 0.1,
    ignitionFailures: [0.8, 0.2, 0],
    towerSensorFaultProb: 0,
    armCloseTime: [4.8, 5.2],
    propellant: [66_000, 70_000],
    slowMoLast20m: false,
  },
  fd: {
    id: 'fd',
    name: 'Flight Director',
    control: 'fd',
    autoIgnition: false,
    autoStepDown: false,
    autoGoNoGo: false,
    pinWindow: PIN_WINDOW,
    pinHeightAtCloseMax: PIN_HEIGHT_AT_CLOSE_MAX,
    tiltLimitDeg: TILT_LIMIT_DEG,
    lateralSpeedLimit: LATERAL_SPEED_LIMIT,
    windMean: [4, 10],
    gustSigma: 2.0,
    shear: 0.5,
    ignitionFailures: [0.3, 0.5, 0.2],
    towerSensorFaultProb: 0.12,
    armCloseTime: [4.5, 6.0],
    propellant: [64_000, 72_000],
    slowMoLast20m: false,
  },
};

export function tierConfig(id: TierId): TierConfig {
  return TIER_CONFIG[id];
}
