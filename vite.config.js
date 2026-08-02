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
        short_name: 'chitose-bank', // 表記は全面 chitose-bank に統一（2026-07-27たきと指示）
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
        // 動的読込のチャンクはprecacheに入れない（2026-07-25 heic2any／2026-07-27 拡大）。
        // precacheはデプロイのたび全員が裏で丸ごと再取得するため、起動に要らないものを入れるほど
        // リロードが重くなる。ここに挙げたものは「使う画面を開いた時にネットワークから読む」
        //   heic2any(1.35MB)=写真選択時／leaflet(149KB)=地図表示時／
        //   LandingFlow(115KB)=求人作成／AdminTab・ConsignmentRoom・AdminBoxRegistryPage=管理者のみ
        globIgnores: [
          '**/heic2any-*.js',
          '**/leaflet-src-*.js',
          '**/LandingFlow-*.js',
          '**/AdminTab-*.js',
          '**/ConsignmentRoom-*.js',
          '**/AdminBoxRegistryPage-*.js',
        ],
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
          // Google Fonts（2026-08-02・更新時間の短縮）：index.htmlの<link rel="stylesheet">は
          // 描画ブロッキングで、SWキャッシュが無いとリロードのたびネット往復を待ってから
          // 初回描画になっていた。CSSはキャッシュ即返し＋裏で更新（StaleWhileRevalidate）、
          // フォント実体(woff2)は内容不変なのでCacheFirstで1年保持
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-woff',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
