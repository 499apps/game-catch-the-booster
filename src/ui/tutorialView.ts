// The Cadet first-run tutorial card: one idea at a time, step dots, a hint with "Skip step"
// when the player waits, and a Skip button. The logic lives in src/app/tutorial.ts.
import type { Tutorial, TutorialStep } from '../app/tutorial';
import { STANDARD_KEYS, keyLabel, type KeyAction, type KeyMap } from '../input/mapping';
import { el, setText, show } from './dom';

export type InputKind = 'touch' | 'keys' | 'pad';

type CardStep = Exclude<TutorialStep, 'done'>;

/** The keyboard words for the lessons, from the player's current key map. */
export interface KeyWords {
  /** "A, D, W or S (or the arrows)". */
  steer: string;
  light: string;
  catch: string;
}

const STEER_ACTIONS: readonly KeyAction[] = ['tiltLeft', 'tiltRight', 'tiltFwd', 'tiltBack'];

/** "A", "A or D", "A, D, W or S". */
function orList(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1] ?? ''}`;
}

export function keyWords(km: Readonly<KeyMap> = STANDARD_KEYS): KeyWords {
  const first = STEER_ACTIONS.map((a) => km[a][0]).filter((c): c is string => !!c);
  const second = STEER_ACTIONS.map((a) => km[a][1]);
  let steer = first.length ? orList(first.map(keyLabel)) : 'the steer keys';
  if (second.every((c) => !!c && c.startsWith('Arrow'))) steer += ' (or the arrows)';
  else if (second.every((c) => !!c)) steer += ` (or ${orList(second.map((c) => keyLabel(c ?? '')))})`;
  const one = (a: KeyAction, fallback: string): string => {
    const c = km[a][0];
    return c ? keyLabel(c) : fallback;
  };
  return { steer, light: one('ignite', 'the LIGHT key'), catch: one('catch', 'the CATCH key') };
}

/** Puts the player's keys into a keyboard lesson ({steer}, {light}, {catch}). */
function fill(s: string, w: KeyWords): string {
  return s.replace('{steer}', w.steer).replace('{light}', w.light).replace('{catch}', w.catch);
}

const TEXT: Record<CardStep, { title: string; how: Record<InputKind, string>; hint: string }> = {
  steer: {
    title: '1 · Steer',
    how: {
      touch: 'Drag the round pad the way the yellow arrow points. The end of the glowing path moves onto the ring.',
      keys: 'Hold {steer} the way the yellow arrow points. The end of the glowing path moves onto the ring.',
      pad: 'Push the left stick the way the yellow arrow points. The end of the glowing path moves onto the ring.',
    },
    hint: 'Hold the stick the way the arrow points until it says "On the ring".',
  },
  light: {
    title: '2 · Light the engines',
    how: {
      touch: 'When the cue counts 3-2-1, tap LIGHT.',
      keys: 'When the cue counts 3-2-1, press {light}.',
      pad: 'When the cue counts 3-2-1, press X or Start.',
    },
    hint: 'Try it now: the LIGHT button is below.',
  },
  catch: {
    title: '3 · Catch',
    how: {
      touch: 'Press and hold CATCH until the inner ring fills.',
      keys: 'Press {catch} to close the arms.',
      pad: 'Press A to close the arms.',
    },
    hint: 'Try it now: CATCH is the big round button.',
  },
  ready: {
    title: 'Ready!',
    how: {
      touch: 'Steer onto the glowing ring. Press CATCH when it glows. Fly!',
      keys: 'Steer onto the glowing ring. Press CATCH when it glows. Fly!',
      pad: 'Steer onto the glowing ring. Press CATCH when it glows. Fly!',
    },
    hint: '',
  },
};

/** The words for a step (the game can also speak them). */
export function tutorialLine(step: TutorialStep, input: InputKind, keys: KeyWords = keyWords()): string | null {
  if (step === 'done') return null;
  const t = TEXT[step];
  return `${t.title.replace(/^\d · /, '')}. ${fill(t.how[input], keys)}`;
}

export class TutorialView {
  readonly root: HTMLDivElement;
  private readonly title = el('div', { class: 'title' });
  private readonly how = el('div', { class: 'how', 'data-testid': 'tutorial-text' });
  private readonly hintText = el('div', { class: 'hint' });
  private readonly praise = el('div', { class: 'praise', text: '✓ Nice!' });
  private readonly bar = el('i');
  private readonly timer = el('div', { class: 'timer' }, [this.bar]);
  private readonly dots: HTMLElement[] = [];
  readonly skipStepBtn = el('button', { class: 'skip', 'data-testid': 'tutorial-skip-step', text: 'Skip step ⏭' });
  readonly skipBtn = el('button', { class: 'skip', 'data-testid': 'tutorial-skip', text: 'Skip tutorial' });

  constructor(parent: HTMLElement, onSkip: () => void, onSkipStep: () => void) {
    const dotRow = el('div', { class: 'dots', 'aria-hidden': 'true' });
    for (let i = 0; i < 4; i++) {
      const d = el('span');
      this.dots.push(d);
      dotRow.append(d);
    }
    this.root = el('div', { id: 'tutorial', class: 'ui', 'data-testid': 'tutorial', role: 'dialog', 'aria-label': 'Tutorial', 'aria-live': 'polite' }, [
      dotRow,
      this.title,
      this.how,
      this.praise,
      this.hintText,
      this.timer,
      el('div', { class: 'buttons' }, [this.skipStepBtn, this.skipBtn]),
    ]);
    this.root.hidden = true;
    this.skipBtn.addEventListener('click', onSkip);
    this.skipStepBtn.addEventListener('click', onSkipStep);
    parent.append(this.root);
  }

  hide(): void {
    show(this.root, false);
  }

  update(t: Tutorial, input: InputKind, keys: KeyWords = keyWords()): void {
    show(this.root, !t.finished);
    if (t.finished) return;
    const step = t.step as CardStep;
    const txt = TEXT[step];
    setText(this.title, txt.title);
    setText(this.how, fill(txt.how[input], keys));
    this.root.dataset['step'] = step;
    show(this.praise, t.praise > 0);
    show(this.hintText, t.hint);
    setText(this.hintText, t.hint ? txt.hint : '');
    show(this.skipStepBtn, t.hint);
    show(this.timer, step === 'ready');
    this.bar.style.width = `${((1 - t.timeout) * 100).toFixed(1)}%`;
    const idx = ['steer', 'light', 'catch', 'ready'].indexOf(step);
    this.dots.forEach((d, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'now' : '';
      if (d.className !== cls) d.className = cls;
    });
  }
}
