import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  PRAISE_TIME,
  READY_TIME,
  STEER_TIME,
  STEP_TIMEOUT,
  TUTORIAL_MAX_SECONDS,
  Tutorial,
  type TutorialInput,
} from '../../src/app/tutorial';

const idle: TutorialInput = { stick: 0, ignite: false, closeArms: false };
const DT = 1 / 60;

function run(t: Tutorial, seconds: number, inp: TutorialInput = idle): void {
  for (let s = 0; s < seconds; s += DT) t.update(DT, inp);
}

describe('Cadet tutorial', () => {
  it('teaches one idea at a time: steer, light, catch, ready', () => {
    const t = new Tutorial();
    expect(t.step).toBe('steer');
    run(t, STEER_TIME + 0.05, { ...idle, stick: 0.8 });
    expect(t.praise).toBeGreaterThan(0);
    expect(t.step).toBe('steer'); // praise first
    run(t, PRAISE_TIME + 0.05);
    expect(t.step).toBe('light');
    t.update(DT, { ...idle, ignite: true });
    run(t, PRAISE_TIME + 0.05);
    expect(t.step).toBe('catch');
    t.update(DT, { ...idle, closeArms: true });
    run(t, PRAISE_TIME + 0.05);
    expect(t.step).toBe('ready');
    run(t, READY_TIME + 0.05);
    expect(t.finished).toBe(true);
    expect([...t.done]).toEqual(['steer', 'light', 'catch']);
  });

  it('a tiny stick wobble does not count as steering', () => {
    const t = new Tutorial();
    run(t, 1, { ...idle, stick: 0.2 });
    expect(t.step).toBe('steer');
    expect(t.praise).toBe(0);
  });

  it('the steer step needs a held deflection, not a flick', () => {
    const t = new Tutorial();
    for (let i = 0; i < 40; i++) t.update(DT, { ...idle, stick: i % 2 ? 0.9 : 0 });
    expect(t.praise).toBe(0);
  });

  it('a step the player does not do moves on by itself', () => {
    const t = new Tutorial();
    run(t, STEP_TIMEOUT + 0.05);
    expect(t.step).toBe('light');
    expect(t.done.size).toBe(0);
  });

  it('only the current step listens (pressing CATCH early does nothing)', () => {
    const t = new Tutorial();
    t.update(DT, { ...idle, closeArms: true, ignite: true });
    expect(t.step).toBe('steer');
    expect(t.praise).toBe(0);
  });

  it('can be skipped at any time', () => {
    const t = new Tutorial();
    run(t, 2);
    t.skip();
    expect(t.finished).toBe(true);
    expect(t.skipped).toBe(true);
    expect(t.update(DT, { ...idle, stick: 1 })).toBe(false);
  });

  it('never takes more than about 20 s, whatever the player does (property)', () => {
    expect(TUTORIAL_MAX_SECONDS).toBeLessThanOrEqual(20);
    fc.assert(
      fc.property(
        fc.array(fc.record({ stick: fc.double({ min: 0, max: 1, noNaN: true }), ignite: fc.boolean(), closeArms: fc.boolean() }), {
          minLength: 1,
          maxLength: 50,
        }),
        (inputs) => {
          const t = new Tutorial();
          let i = 0;
          while (!t.finished && t.total < 60) t.update(DT, inputs[i++ % inputs.length] ?? idle);
          expect(t.finished).toBe(true);
          expect(t.total).toBeLessThanOrEqual(TUTORIAL_MAX_SECONDS + 0.05);
        },
      ),
    );
  });

  it('timeout progress runs 0..1 within a step', () => {
    const t = new Tutorial();
    expect(t.timeout).toBe(0);
    run(t, STEP_TIMEOUT / 2);
    expect(t.timeout).toBeGreaterThan(0.4);
    expect(t.timeout).toBeLessThan(0.6);
  });
});
