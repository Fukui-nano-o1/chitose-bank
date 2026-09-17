import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { restoreLastRoute } from './lib/lastRoute'
import { installRoutePreloading } from './app/routes'

// Service Workerの登録はここでは行わない（2026-08-18 Speed-1A）。
// vite-plugin-pwa が index.html に入れる registerSW.js が唯一の登録経路＝経路を1本に保つ。
// SWの中身（precache・ページ本体のNetworkFirst・プッシュ通知）は src/sw.js が正。

// 古いindex.htmlの後片付け（2026-08-08・真っ黒画面の最後の経路）：
// ページ本体は pages-cache（NetworkFirst・3秒で見切り）に入るため、回線が遅いと
// 【修正前の古いHTML】が返り続ける。その古いHTMLはダーク時に背景が黒くなる版なので、
// 直したはずの端末で黒が再発する。1度だけこのキャッシュを捨てて確実に新しいHTMLへ移す。
// 以後は通常どおりNetworkFirstで運用される（設計は変えない）。
// ★もう一度全端末に捨てさせたい時は、この版キー(v1)の数字を上げるだけでよい
try {
  const KEY = 'cb_pagesCachePurge_v1'
  if (window.caches && !localStorage.getItem(KEY)) {
    caches.delete('pages-cache').finally(() => { try { localStorage.setItem(KEY, '1') } catch { /* 保存できなくても実害なし */ } })
  }
} catch { /* CacheStorage非対応・プライベートモード等では何もしない */ }

// 前回見ていた画面へ戻す（2026-08-26 Speed-4A）。PWAの start_url は '/'＝ハッシュ無しなので、
// iOSが前回のWebViewを捨てて起動すると、以前はどの画面に居ても既定（さがす）へ着地していた。
// ここで【Reactが描く前に】同期でURLを前回のrouteへ戻す＝最初の描画からその画面になる
//（一瞬さがすが出てから移る、を作らない）。URLに行き先の指定がある時は何もしない＝
// 共有リンク・メールのリンク・緊急連絡のリンクを奪わない。中身は lib/lastRoute.js。
restoreLastRoute()
const stopPreloading = installRoutePreloading()
if (import.meta.hot) import.meta.hot.dispose(stopPreloading)

// #cb-bootは最初のReact commitが置き換える。render()の前に消すと、
// 非同期の初回描画まで空白が生まれるので、実際に本体が描けるまで残す。

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
