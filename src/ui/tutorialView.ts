// The Cadet first-run tutorial card: one idea at a time, a timer bar, step dots and
// a Skip button. The logic lives in src/app/tutorial.ts.
import type { Tutorial, TutorialStep } from '../app/tutorial';
import { el, setText, show } from './dom';

export type InputKind = 'touch' | 'keys' | 'pad';

const TEXT: Record<Exclude<TutorialStep, 'done'>, { title: string; how: Record<InputKind, string> }> = {
  steer: {
    title: '1 · Steer',
    how: {
      touch: 'Drag the round pad at the bottom left. The booster slides that way.',
      keys: 'Hold A or D (or ← →). The booster slides that way.',
      pad: 'Push the left stick. The booster slides that way.',
    },
  },
  light: {
    title: '2 · Light the engines',
    how: {
      touch: 'When the cue counts 3-2-1, tap LIGHT.',
      keys: 'When the cue counts 3-2-1, press Enter.',
      pad: 'When the cue counts 3-2-1, press X or Start.',
    },
  },
  catch: {
    title: '3 · Catch',
    how: {
      touch: 'Press and hold CATCH until the inner ring fills.',
      keys: 'Press Space to close the arms.',
      pad: 'Press A to close the arms.',
    },
  },
  ready: {
    title: 'Ready!',
    how: {
      touch: 'Line up with the glowing ring. Press CATCH when it glows. Fly!',
      keys: 'Line up with the glowing ring. Press CATCH when it glows. Fly!',
      pad: 'Line up with the glowing ring. Press CATCH when it glows. Fly!',
    },
  },
};

export class TutorialView {
  readonly root: HTMLDivElement;
  private readonly title = el('div', { class: 'title' });
  private readonly how = el('div', { class: 'how', 'data-testid': 'tutorial-text' });
  private readonly praise = el('div', { class: 'praise', text: '✓ Nice!' });
  private readonly bar = el('i');
  private readonly dots: HTMLElement[] = [];
  readonly skipBtn = el('button', { class: 'skip', 'data-testid': 'tutorial-skip', text: 'Skip tutorial' });

  constructor(parent: HTMLElement, onSkip: () => void) {
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
      el('div', { class: 'timer' }, [this.bar]),
      this.skipBtn,
    ]);
    this.root.hidden = true;
    this.skipBtn.addEventListener('click', onSkip);
    parent.append(this.root);
  }

  hide(): void {
    show(this.root, false);
  }

  update(t: Tutorial, input: InputKind): void {
    show(this.root, !t.finished);
    if (t.finished) return;
    const step = t.step as Exclude<TutorialStep, 'done'>;
    const txt = TEXT[step];
    setText(this.title, txt.title);
    setText(this.how, txt.how[input]);
    this.root.dataset['step'] = step;
    show(this.praise, t.praise > 0);
    this.bar.style.width = `${((1 - t.timeout) * 100).toFixed(1)}%`;
    const idx = ['steer', 'light', 'catch', 'ready'].indexOf(step);
    this.dots.forEach((d, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'now' : '';
      if (d.className !== cls) d.className = cls;
    });
  }
}
