import { defineConfig } from 'vite';

const signalingTarget = process.env.SIGNALING_TARGET ?? 'http://localhost:8787';

// The client always talks to /ws on its own origin; in dev that is proxied to the
// signaling process, in production the signaling process serves these files itself.
const proxy = {
  '/ws': { target: signalingTarget, ws: true, changeOrigin: true },
};

export default defineConfig({
  // 'spa' makes the dev server serve index.html for /join/:gameId.
  appType: 'spa',
  server: {
    host: true,
    port: 5173,
    proxy,
  },
  preview: {
    host: true,
    port: 4173,
    proxy,
  },
  build: {
    target: 'es2022',
    // Phaser is deliberately its own chunk, loaded only once a game starts.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
