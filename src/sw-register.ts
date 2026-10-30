// Registers the hand-written service worker (built by scripts/build-sw.mjs).
// Production only: the dev server has no precache list.
// Assembled builds (VITE_ASSEMBLED=1, made by the 499apps games hub) register the single hub
// worker at /games/sw.js (scope /games/) and drop any stale game-scoped worker.
export const HUB_BASE = '/games/';

export function isAssembledBuild(
  env: Record<string, unknown> = import.meta.env as Record<string, unknown>,
): boolean {
  const v = env['VITE_ASSEMBLED'];
  return v === '1' || v === 1 || v === true;
}

export function swTargets(base: string, assembled: boolean): { scriptUrl: string; scope: string } {
  const b = base.endsWith('/') ? base : `${base}/`;
  if (assembled) return { scriptUrl: `${HUB_BASE}sw.js`, scope: HUB_BASE };
  return { scriptUrl: `${b}sw.js`, scope: b };
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const assembled = isAssembledBuild();
  const { scriptUrl, scope } = swTargets(base, assembled);
  window.addEventListener('load', () => {
    void (async () => {
      try {
        if (assembled && base !== HUB_BASE) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            if (new URL(reg.scope).pathname === base) await reg.unregister();
          }
        }
        await navigator.serviceWorker.register(scriptUrl, { scope });
      } catch {
        // Offline support is optional; the game still runs without it.
      }
    })();
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
