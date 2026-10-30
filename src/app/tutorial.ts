// Cadet first-run tutorial: a pure state machine (no DOM), so it is unit-testable.
// Teach by doing, one idea at a time: steer, light, catch. Each step waits for the
// player to do it, praises it briefly, then moves on. Nothing moves on by itself: after
// STEP_HINT seconds the card offers "Skip step", and "Skip tutorial" is always there.
// During the steer step the game flies a practice (ghost) booster with the real sim.

export type TutorialStep = 'steer' | 'light' | 'catch' | 'ready' | 'done';

export const TUTORIAL_STEPS: readonly TutorialStep[] = ['steer', 'light', 'catch', 'ready', 'done'];

/** Seconds in a step before the card offers "Skip step" and a hint. */
export const STEP_HINT = 6;
/** Seconds of "Nice!" after the player does the step. */
export const PRAISE_TIME = 0.8;
/** Seconds the closing "Ready" card shows. */
export const READY_TIME = 1.6;
/** Stick deflection that counts as steering, and for how long. */
export const STEER_MIN = 0.45;
export const STEER_TIME = 0.35;

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
  /** Steps the player did (not skipped). */
  readonly done = new Set<TutorialStep>();
  skipped = false;
  private steerAcc = 0;

  get finished(): boolean {
    return this.step === 'done';
  }

  /** True once the step has waited long enough to offer a skip and a hint. */
  get hint(): boolean {
    return this.step !== 'ready' && this.praise <= 0 && this.t >= STEP_HINT;
  }

  /** 0..1 of the closing card's timer (the other steps wait for the player). */
  get timeout(): number {
    return this.step === 'ready' ? Math.min(1, this.t / READY_TIME) : 0;
  }

  /** Ends the whole tutorial. */
  skip(): void {
    this.skipped = true;
    this.go('done');
  }

  /** Moves on from the current step without doing it. */
  skipStep(): void {
    if (this.finished) return;
    this.next();
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
    }
    return this.step !== before;
  }
}
