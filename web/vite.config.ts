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
});
