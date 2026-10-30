import { defineConfig, type Plugin } from 'vite';

// dist/ is the deployable output for 499apps.com/games/catch-the-booster/
// VITE_ASSEMBLED=1 (set by the games hub's `pnpm assemble`) points the page at the hub manifest
// and the single /games/ service worker; scripts/build-sw.mjs then skips this game's own sw.js.
const assembled = process.env['VITE_ASSEMBLED'] === '1';

function hubManifest(): Plugin {
  return {
    name: 'catch-hub-manifest',
    transformIndexHtml(html) {
      return html.replace('href="./manifest.webmanifest"', 'href="/games/manifest.webmanifest"');
    },
  };
}

export default defineConfig({
  base: '/games/catch-the-booster/',
  plugins: assembled ? [hubManifest()] : [],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
  preview: { port: 4173, strictPort: true },
});
