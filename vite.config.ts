import { defineConfig } from 'vite';

// dist/ is the deployable output for 499apps.com/games/catch-the-booster/
export default defineConfig({
  base: '/games/catch-the-booster/',
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
