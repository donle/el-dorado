import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Proxy the WebSocket server in dev so the client can use a relative URL.
    proxy: {
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        rewrite: (p) => p.replace(/^\/ws/, ''),
      },
    },
  },
});
