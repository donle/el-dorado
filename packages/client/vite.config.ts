import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png',
      ],
      manifest: {
        name: '冲向黄金城',
        short_name: '黄金城',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#0b0d08',
        theme_color: '#1b1f16',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 全量预缓存：打包产物 + public 下全部图片
        globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // 导航回退到 index.html，但排除 /ws（WebSocket 走网络）
        navigateFallbackDenylist: [/^\/ws/],
      },
    }),
  ],
  server: {
    host: true, // 监听 0.0.0.0,允许局域网设备访问
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
