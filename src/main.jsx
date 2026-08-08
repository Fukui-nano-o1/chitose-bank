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

// 起動スケルトン（index.htmlの#cb-boot）の引き継ぎ（2026-08-03）：Reactが描く直前に外す。
// createRootは初回renderでコンテナの中身を消すが、その挙動に頼らず明示的に外す（消し忘れ＝
// 骨が本体の上に残り続ける事故を、実装の都合ではなくコードで断つ）
document.getElementById('cb-boot')?.remove()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
