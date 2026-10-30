// On-screen touch controls: a virtual stick (left-bottom) and a vertical throttle
// slider (right). They write into InputDevices.touch; mapping.ts does the rest.
import type { InputDevices } from '../input/devices';
import { el } from './dom';

export function isTouchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0;
  } catch {
    return false;
  }
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly knob = el('i');
  private readonly lever = el('i');
  private readonly leverLabel = el('span', { text: 'THR' });
  private stickId: number | null = null;
  private sliderId: number | null = null;

  constructor(
    parent: HTMLElement,
    private readonly devices: InputDevices,
  ) {
    const stick = el('div', { id: 'stick', 'aria-label': 'tilt stick', 'data-testid': 'stick' }, [this.knob]);
    const throttle = el('div', { id: 'throttle', 'aria-label': 'throttle', 'data-testid': 'throttle' }, [
      this.lever,
      this.leverLabel,
    ]);
    this.root = el('div', { id: 'touch', class: 'ui' }, [stick, throttle]);
    parent.append(this.root);
    this.reset();

    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickId = e.pointerId;
      stick.setPointerCapture?.(e.pointerId);
      this.moveStick(stick, e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(stick, e);
    });
    const endStick = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.devices.touch.stickX = 0;
      this.devices.touch.stickY = 0;
      this.knob.style.transform = '';
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);

    throttle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.sliderId = e.pointerId;
      throttle.setPointerCapture?.(e.pointerId);
      this.moveLever(throttle, e);
    });
    throttle.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.sliderId) this.moveLever(throttle, e);
    });
    const endLever = (e: PointerEvent): void => {
      if (e.pointerId === this.sliderId) this.sliderId = null;
    };
    throttle.addEventListener('pointerup', endLever);
    throttle.addEventListener('pointercancel', endLever);
  }

  private moveStick(stick: HTMLElement, e: PointerEvent): void {
    const r = stick.getBoundingClientRect();
    const rad = r.width / 2;
    let x = (e.clientX - (r.left + rad)) / rad;
    let y = (e.clientY - (r.top + rad)) / rad;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.devices.touch.stickX = x;
    this.devices.touch.stickY = y;
    this.knob.style.transform = `translate(${(x * rad * 0.7).toFixed(1)}px, ${(y * rad * 0.7).toFixed(1)}px)`;
  }

  private moveLever(track: HTMLElement, e: PointerEvent): void {
    const r = track.getBoundingClientRect();
    const v = 1 - (e.clientY - r.top) / r.height;
    this.setLever(Math.max(0, Math.min(1, v)));
  }

  setLever(v: number): void {
    this.devices.touch.slider = v;
    this.lever.style.bottom = `calc(${(v * 100).toFixed(1)}% - ${(v * 26).toFixed(1)}px)`;
    this.leverLabel.textContent = `THR ${Math.round(40 + 60 * v)}%`;
  }

  /** New run: the lever returns to 50% and the slider stops overriding other devices. */
  reset(): void {
    this.setLever(0.5);
    this.devices.touch.slider = null;
  }
}
