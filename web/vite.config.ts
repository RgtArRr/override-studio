import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    fs: {
      // '..' keeps the project root served: an explicit allow list replaces Vite's default.
      allow: ['..', '../fixtures'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  build: {
    rollupOptions: {
      // Multi-page: locale gateway at / plus the editor at /app/.
      input: {
        main: 'index.html',
        app: 'app/index.html',
      },
    },
  },
});
