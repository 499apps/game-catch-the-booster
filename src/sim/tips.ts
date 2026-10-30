// One positive, specific tip per outcome (kid-safe wording).
import type { FailReason } from './types';

export const TIPS: Record<FailReason, string> = {
  noGo: 'Good thinking! The booster splashed down safely. Check the health board: all green means GO.',
  lateIgnition: 'Light the engines when the stop-height marker reaches the arms. A little early is safer than late.',
  flameout: 'Save some fuel: light the engines a little later and step down to 3 engines on time.',
  late: 'Press CATCH as soon as the button glows. The arms need about 5 seconds to close.',
  early: 'Wait a moment longer before CATCH. The pins should be less than 20 m above the arms when they close.',
  missLateral: 'Line the booster up with the glowing ring before the arms close. Small stick moves work best.',
  unstable: 'Stand the booster up straight and stop sliding sideways before the pins touch.',
  overload: 'Come down slower at the end. Add a little throttle in the last 20 m.',
  noCatch: 'Watch for the CATCH button. It appears about 5 seconds before the pins reach the arms.',
  climb: 'Easy on the throttle! With 3 engines the booster can float up. Lower the throttle to keep dropping.',
  tilt: 'Gentle stick moves keep the booster upright. Let it settle before you steer again.',
  timeout: 'Keep the booster moving down toward the arms. You cannot hover forever!',
};

export function tipFor(reason: FailReason | null): string {
  return reason ? TIPS[reason] : 'Beautiful catch! Try for a Bullseye: pins within 0.3 m.';
}
