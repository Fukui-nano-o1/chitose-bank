import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Service Worker 登録（2026-07-19・チャットのプッシュ通知用）。対応環境のみ・失敗しても無視
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

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

// 起動スケルトン（index.htmlの#cb-boot）の引き継ぎ（2026-08-03）：Reactが描く直前に外す。
// createRootは初回renderでコンテナの中身を消すが、その挙動に頼らず明示的に外す（消し忘れ＝
// 骨が本体の上に残り続ける事故を、実装の都合ではなくコードで断つ）
document.getElementById('cb-boot')?.remove()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
