import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { startupPrecache } from './startupPrecache'

const startup = startupPrecache()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    startup.plugin,
    // Service Worker（2026-08-18 Speed-1A・injectManifest へ一本化）：
    // generateSW（プラグインがSWを生成する方式）は public/sw.js を同じ /sw.js で上書きし、
    // プッシュ通知の処理を成果物から消していた。SWの中身は src/sw.js を正とし、
    // ここではprecacheの一覧を注入するだけにする。
    // registerType: 'autoUpdate' は必須。pushしたら本番へ即反映する運用のため、
    // SWキャッシュが古いビルドを握ったままにならないよう新デプロイを自動で取りに行かせる。
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'script-defer', // SW登録用JSの取得でHTML解析を止めない
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
      injectManifest: {
        // 起動に必須の依存グラフだけをprecache。動的画面はsrc/sw.jsで利用時に保持する。
        // 全画面約2MBの一括取得をSW有効化の条件にしない（2026-09-17）。
        globPatterns: ['assets/*.{js,css}', 'registerSW.js'],
        globIgnores: ['**/index.html'],
        manifestTransforms: [startup.transform],
      },
    }),
  ],
})
