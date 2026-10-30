// Control laws per tier: PilotInput -> FlightCommand (the assist ladder).
//  Cadet: autopilot flies vertical and the approach; after GO the stick commands lateral
//         velocity (attitude hold). Auto ignition and step-down. The player presses CATCH.
//  Pilot: throttle lever + rate-damped stick; the player ignites and steps down. Auto Go/No-Go.
//  Flight Director: direct gimbal and throttle; the player makes the Go/No-Go call.
import { autopilotCommand } from './autopilot';
import { THROTTLE_MAX, THROTTLE_MIN } from './constants';
import type { FlightCommand, PilotInput, World } from './types';
import { clamp } from './vec';

export const CADET_MAX_LATERAL_SPEED = 6; // m/s at full stick
export const PILOT_MAX_TILT_RATE = 0.105; // rad/s (6 deg/s) at full stick

export const leverToThrottle = (lever: number): number =>
  THROTTLE_MIN + (THROTTLE_MAX - THROTTLE_MIN) * clamp(lever, 0, 1);

export function commandFor(w: World, input: PilotInput, autopilot: boolean): FlightCommand {
  if (autopilot) return autopilotCommand(w);
  switch (w.cfg.control) {
    case 'cadet': {
      const cmd = autopilotCommand(w, {
        lateralVelocity: {
          x: clamp(input.stickX, -1, 1) * CADET_MAX_LATERAL_SPEED,
          z: clamp(input.stickZ, -1, 1) * CADET_MAX_LATERAL_SPEED,
        },
        pressCatch: false,
        decide: false,
      });
      // A tap on the "3-2-1 LIGHT" cue lights the engines; auto ignition never lets it be late.
      cmd.ignite = cmd.ignite || (input.ignite && w.phase === 'coast');
      cmd.closeArms = input.closeArms;
      return cmd;
    }
    case 'pilot':
      return {
        attitude: 'rate',
        target: {
          x: clamp(input.stickX, -1, 1) * PILOT_MAX_TILT_RATE,
          z: clamp(input.stickZ, -1, 1) * PILOT_MAX_TILT_RATE,
        },
        throttle: leverToThrottle(input.throttle),
        roll: 0,
        ignite: input.ignite,
        stepDown: input.stepDown,
        closeArms: input.closeArms,
        go: false,
        noGo: false,
      };
    case 'fd':
      return {
        attitude: 'direct',
        // Positive gimbal pushes the tail +x and tips the nose -x, so invert the stick.
        target: { x: -clamp(input.stickX, -1, 1), z: -clamp(input.stickZ, -1, 1) },
        throttle: leverToThrottle(input.throttle),
        roll: clamp(input.yaw, -1, 1),
        ignite: input.ignite,
        stepDown: input.stepDown,
        closeArms: input.closeArms,
        go: input.go,
        noGo: input.noGo,
      };
  }
}
