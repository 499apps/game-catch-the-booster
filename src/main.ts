// Minimal entry point for C1a: mounts a placeholder canvas so the build works.
// The greybox game (render/ui/audio/input) arrives in C1b.
import { registerServiceWorker } from './sw-register';

function mount(): void {
  const app = document.getElementById('app');
  if (!app) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  app.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const draw = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    if (!ctx) return;
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#16324f');
    g.addColorStop(1, '#0d1b2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8eef4';
    ctx.font = `${Math.round(24 * dpr)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('Catch the Booster', canvas.width / 2, canvas.height / 2);
  };
  draw();
  window.addEventListener('resize', draw);
}

mount();
registerServiceWorker();
