import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
        // 旧generateSW時代と同じ範囲に保つ（JS・CSS・HTML＋includeAssets／manifestのアイコン）。
        // 画像まで広げるとiOSのスプラッシュ32枚が入り、デプロイのたび全員が再取得する（実測+184KiB）
        globPatterns: ['**/*.{js,css,html}'],
        // 動的読込のチャンクはprecacheに入れない（2026-07-25 heic2any／2026-07-27 拡大）。
        // precacheはデプロイのたび全員が裏で丸ごと再取得するため、起動に要らないものを入れるほど
        // リロードが重くなる。ここに挙げたものは「使う画面を開いた時にネットワークから読む」
        //   heic2any(1.35MB)=写真選択時／leaflet(149KB)=地図表示時／
        //   LandingFlow(115KB)=求人作成／AdminTab・ConsignmentRoom・AdminBoxRegistryPage=管理者のみ
        globIgnores: [
          '**/heic2any-*.js',
          '**/html2canvas-*.js', // PDF保存を押した時だけ読む（2026-08-19）

          '**/leaflet-src-*.js',
          '**/LandingFlow-*.js',
          '**/AdminTab-*.js',
          '**/ConsignmentRoom-*.js',
          '**/AdminBoxRegistryPage-*.js',
          // ★index.html はprecacheしない（2026-08-18 Speed-1A）。
          // precacheに入れるとナビゲーションをprecacheが先取りし、古いapp shellを握り続ける
          // （新デプロイがリロード2回でないと出ない）。ページ本体は src/sw.js の
          // NetworkFirst 一本に任せる＝常に最新を取りに行き、3秒で見切って直近の成功分に落ちる。
          '**/index.html',
        ],
      },
    }),
  ],
})
