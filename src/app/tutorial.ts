// Cadet first-run tutorial: a pure state machine (no DOM), so it is unit-testable.
// Teach by doing, one idea at a time: steer, light, catch. Each step waits for the
// player to do it, praises it briefly, then moves on. A step that the player does not
// do moves on by itself, so the whole tutorial never takes more than ~20 s.

export type TutorialStep = 'steer' | 'light' | 'catch' | 'ready' | 'done';

export const TUTORIAL_STEPS: readonly TutorialStep[] = ['steer', 'light', 'catch', 'ready', 'done'];

/** Seconds before an unanswered step moves on by itself. */
export const STEP_TIMEOUT = 5;
/** Seconds of "Nice!" after the player does the step. */
export const PRAISE_TIME = 0.8;
/** Seconds the closing "Ready" card shows. */
export const READY_TIME = 1.6;
/** Stick deflection that counts as steering, and for how long. */
export const STEER_MIN = 0.45;
export const STEER_TIME = 0.35;
/** Upper bound of the whole tutorial. */
export const TUTORIAL_MAX_SECONDS = 3 * (STEP_TIMEOUT + PRAISE_TIME) + READY_TIME;

export interface TutorialInput {
  /** Stick deflection 0..1. */
  stick: number;
  ignite: boolean;
  closeArms: boolean;
}

export class Tutorial {
  step: TutorialStep = 'steer';
  /** Seconds in the current step. */
  t = 0;
  /** Seconds since the tutorial started. */
  total = 0;
  /** > 0 while the step shows its praise. */
  praise = 0;
  /** Steps the player did (not timed out). */
  readonly done = new Set<TutorialStep>();
  skipped = false;
  private steerAcc = 0;

  get finished(): boolean {
    return this.step === 'done';
  }

  /** 0..1 progress of the auto-advance timer for the current step. */
  get timeout(): number {
    const limit = this.step === 'ready' ? READY_TIME : STEP_TIMEOUT;
    return Math.min(1, this.t / limit);
  }

  skip(): void {
    this.skipped = true;
    this.go('done');
  }

  private go(s: TutorialStep): void {
    this.step = s;
    this.t = 0;
    this.praise = 0;
    this.steerAcc = 0;
  }

  private next(): void {
    const i = TUTORIAL_STEPS.indexOf(this.step);
    this.go(TUTORIAL_STEPS[Math.min(i + 1, TUTORIAL_STEPS.length - 1)] ?? 'done');
  }

  /** Advances by dt seconds. Returns true when the step changed. */
  update(dt: number, inp: TutorialInput): boolean {
    if (this.finished) return false;
    const before = this.step;
    this.t += dt;
    this.total += dt;
    if (this.praise > 0) {
      this.praise -= dt;
      if (this.praise <= 0) this.next();
      return this.step !== before;
    }
    let did = false;
    switch (this.step) {
      case 'steer':
        this.steerAcc = inp.stick >= STEER_MIN ? this.steerAcc + dt : 0;
        did = this.steerAcc >= STEER_TIME;
        break;
      case 'light':
        did = inp.ignite;
        break;
      case 'catch':
        did = inp.closeArms;
        break;
      case 'ready':
        if (this.t >= READY_TIME) this.next();
        return this.step !== before;
      case 'done':
        return false;
    }
    if (did) {
      this.done.add(this.step);
      this.praise = PRAISE_TIME;
    } else if (this.t >= STEP_TIMEOUT) {
      this.next();
    }
    return this.step !== before;
  }
}
