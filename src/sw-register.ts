// Registers the hand-written service worker (built by scripts/build-sw.mjs).
// Production only: the dev server has no precache list.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Offline support is optional; the game still runs without it.
    });
  });
}

/** Wipes this game's storage keys and service worker caches ("Clear my data"). */
export async function clearMyData(): Promise<void> {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('g499:catch:')) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('g499-catch-')).map((n) => caches.delete(n)));
  }
}
