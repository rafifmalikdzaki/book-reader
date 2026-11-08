import react from '@vitejs/plugin-react';
import { createLogger } from 'vite';
import { defineConfig } from 'vitest/config';

const BACKEND = 'http://127.0.0.1:8000';

// Fonts live in FastAPI's /static/fonts (see styles/fonts.css), not in the bundle.
// Vite warns that these absolute URLs are left for runtime; that is intended.
const logger = createLogger();
for (const level of ['warn', 'warnOnce'] as const) {
  const log = logger[level].bind(logger);
  logger[level] = (message, options) => {
    if (message.includes('/static/fonts/')) return;
    log(message, options);
  };
}

// `vite build` emits index.html + hashed assets/ into the package static dir
// (gitignored) and FastAPI serves them under /static/app/. The dev server uses
// base '/' so client routes like /ask and /book/x.pdf work on :5173; API,
// raw files, thumbnails, vendored viewers, and fonts are proxied to the backend.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/app/' : '/',
  customLogger: logger,
  plugins: [react()],
  build: {
    outDir: '../src/book_reader/static/app',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': BACKEND,
      '/raw': BACKEND,
      '/thumb.jpg': BACKEND,
      '/static/vendor': BACKEND,
      '/static/fonts': BACKEND,
      '/healthz': BACKEND,
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
}));
