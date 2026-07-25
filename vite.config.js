import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // registerType: 'autoUpdate' は必須。pushしたら本番へ即反映する運用のため、
    // SWキャッシュが古いビルドを握ったままにならないよう新デプロイを自動で取りに行かせる。
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'chitose-bank',
        short_name: 'chitose',
        display: 'standalone',
        theme_color: '#00A86B',
        background_color: '#FFFFFF',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // heic2anyは写真選択時にだけ動的読込される1.35MBのチャンク。precacheに入れると
        // デプロイのたび全員が裏で再取得してしまうため除外（必要時にネットワークから読む・2026-07-25）
        globIgnores: ['**/heic2any-*.js'],
        // 新デプロイのSWをすぐ有効化・即座にページを掌握（autoUpdateの実体）
        clientsClaim: true,
        skipWaiting: true,
        // SPAのため未一致パスはindex.htmlへ。ただしページ本体はnetwork-first思想で
        // 常に最新を取りに行き、オフライン時のみキャッシュへフォールバックする
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
    }),
  ],
})
