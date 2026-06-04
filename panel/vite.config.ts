import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The panel server's default loopback port (DEFAULT_PANEL_PORT). The dev server
// proxies /api here so HMR runs against a live backend.
const PANEL_BACKEND = 'http://127.0.0.1:7733'

export default defineConfig({
  // Relative asset URLs so the built bundle is position-independent and loads
  // from dist/panel/ served by the backend's static routes (GET / + GET /<asset>).
  base: './',
  build: {
    // MUST stay false: the backend tsc step compiles src/panel/*.ts into this
    // same dist/panel/ (server.js lives beside index.html so its './' asset-dir
    // resolution works). emptyOutDir would wipe those compiled modules after
    // tsc emitted them, breaking the published CLI's `panel` command. Vite
    // overlays index.html + assets/ onto the tsc output instead.
    emptyOutDir: false,
    // Emit into the repo-root dist/panel/ — what the server serves and npm publishes.
    outDir: '../dist/panel',
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        changeOrigin: true,
        target: PANEL_BACKEND,
      },
    },
  },
})
