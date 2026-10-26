import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    fs: {
      // Serve repo fixtures (video + fit) via ?url imports in dev.
      allow: ['..'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
