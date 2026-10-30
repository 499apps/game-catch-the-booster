import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PRAISE_TIME, READY_TIME, STEER_TIME, STEP_HINT, Tutorial, type TutorialInput } from '../../src/app/tutorial';
import { keyWords, tutorialLine } from '../../src/ui/tutorialView';
import { presetKeys, rebind } from '../../src/input/mapping';

const idle: TutorialInput = { stick: 0, ignite: false, closeArms: false };
const DT = 1 / 60;

function run(t: Tutorial, seconds: number, inp: TutorialInput = idle): void {
  for (let s = 0; s < seconds; s += DT) t.update(DT, inp);
}

describe('keyboard lessons name the real keys', () => {
  it('standard and one-hand presets', () => {
    expect(keyWords(presetKeys('standard'))).toEqual({ steer: 'A, D, W or S (or the arrows)', light: 'Enter', catch: 'Space' });
    expect(keyWords(presetKeys('onehand'))).toEqual({ steer: 'A, D, W or S', light: 'F', catch: 'Space' });
  });
  it('remapped keys show in the lesson text', () => {
    let km = rebind(presetKeys('standard'), 'tiltRight', 'KeyL');
    km = rebind(km, 'ignite', 'KeyF');
    km = rebind(km, 'catch', 'KeyB');
    const w = keyWords(km);
    expect(w.steer).toBe('A, L, W or S');
    expect(tutorialLine('steer', 'keys', w)).toContain('Hold A, L, W or S');
    expect(tutorialLine('light', 'keys', w)).toContain('press F');
    expect(tutorialLine('catch', 'keys', w)).toContain('Press B');
  });
});

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

  it('a step waits for the player: it never moves on by itself', () => {
    const t = new Tutorial();
    run(t, 30);
    expect(t.step).toBe('steer');
    expect(t.done.size).toBe(0);
  });

  it('after a while it offers a hint and "Skip step", which moves on without counting the step', () => {
    const t = new Tutorial();
    run(t, STEP_HINT - 0.1);
    expect(t.hint).toBe(false);
    run(t, 0.2);
    expect(t.hint).toBe(true);
    t.skipStep();
    expect(t.step).toBe('light');
    expect(t.hint).toBe(false);
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

  it('a player who does each step finishes quickly, whatever else they press (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }), (noise) => {
        const t = new Tutorial();
        let i = 0;
        // Each step is answered within a second; between answers, random presses.
        while (!t.finished && t.total < 30) {
          const step = t.step;
          const n = noise[i++ % noise.length];
          const inp: TutorialInput = {
            stick: step === 'steer' ? 0.9 : n ? 0.3 : 0,
            ignite: step === 'light' || (!!n && step === 'steer'),
            closeArms: step === 'catch',
          };
          t.update(DT, inp);
        }
        expect(t.finished).toBe(true);
        expect(t.total).toBeLessThan(3 * (STEER_TIME + PRAISE_TIME + 0.1) + READY_TIME + 0.5);
      }),
    );
  });

  it('every card has words to speak', () => {
    for (const step of ['steer', 'light', 'catch', 'ready'] as const) {
      for (const kind of ['touch', 'keys', 'pad'] as const) expect(tutorialLine(step, kind)?.length ?? 0).toBeGreaterThan(10);
    }
    expect(tutorialLine('done', 'keys')).toBeNull();
  });
});
