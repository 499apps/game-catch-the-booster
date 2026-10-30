// Entry point: styles, the game shell and the service worker.
import './ui/styles.css';
import { Game } from './app/game';
import { parseHooks } from './app/params';
import { registerServiceWorker } from './sw-register';

function boot(): void {
  const app = document.getElementById('app');
  if (!app) return;
  // Block pinch-zoom and double-tap zoom gestures on iOS (the viewport meta is not enough there).
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  new Game(app, parseHooks(window.location.search));
}

boot();
registerServiceWorker();
