// chitose-bank Service Worker（唯一のSW・2026-08-18 Speed-1A）
//
// ■なぜ1本にしたか
// 以前は vite-plugin-pwa のgenerateSW（Workbox生成）と public/sw.js（自作・プッシュ通知担当）が
// どちらも /sw.js を名乗り、ビルドで後から書かれるgenerateSW側が自作を上書きしていた。
// その結果、本番の成果物からプッシュ通知の処理（push / notificationclick）が丸ごと消えていた
// （2026-08-18 Speed-0監査で dist/sw.js を実測して確認）。
// injectManifest＝「自作SWにprecacheの一覧だけ注入する」方式に変え、このファイル1本を正とする。
// 登録経路も1本：vite-plugin-pwa が index.html に入れる registerSW.js だけ（main.jsx の手動登録は廃止）。
//
// ■担当（この順に定義してある）
//   precache（起動に要る資産）／navigation（ページ本体＝NetworkFirst）／フォント／
//   push（プッシュ通知）／notificationclick（通知タップ）／skipWaiting・clientsClaim
import { clientsClaim } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

// 新しいSWを待たせずに有効化し、開いているページをすぐ掌握する（registerType:'autoUpdate' の実体）
self.skipWaiting()
clientsClaim()

// ── precache（vite-plugin-pwa が注入する一覧）
// ★index.html は意図的に含めない（vite.config の globIgnores）。含めると precache が
// ナビゲーションを先取りし、古いapp shellを握り続ける（＝新デプロイがリロード2回でないと出ない）。
// ページ本体は下の NetworkFirst 一本に任せる。chitose-bank はネット前提のアプリなので、
// 完全オフラインのSPAを守るためにここで古いHTMLを抱える必要はない。
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ── ページ本体（ナビゲーション）＝NetworkFirst
// 常に最新のindex.htmlを取りに行き、3秒で見切って直近の成功分（pages-cache）に落ちる。
// precacheにindex.htmlが無いので、この経路を先取りするものは他に無い。
// ★NavigationRouteで包むのは「ナビゲーションだけを確実に捕まえる」ため（request.mode判定と同義だが、
//   Workboxの正規の入口なので将来の実装差で取りこぼさない）
// ★/j/{番号}（共有カードのつなぎページ・2026-08-25）は除外＝サーバーthat求人ごとのOGタグを付けて
//   返す使い捨てのHTMLso、キャッシュに溜めない（古い求人の姿を返さない）
registerRoute(
  new NavigationRoute(
    new NetworkFirst({ cacheName: 'pages-cache', networkTimeoutSeconds: 3 }),
    { denylist: [/^\/j\//] }
  )
)

// ── フォント（2026-08-14 セルフホスト化＝プラポリv3.7・外部送信の削減）
// 挙動は従来のまま：CSSはキャッシュ即返し＋裏で更新、woff2実体は内容不変so1年保持。
// woff2はprecacheに入れない（全部で約6MBあるため、必要な字体だけ読む）
registerRoute(
  /\/fonts\/fonts\.css$/,
  new StaleWhileRevalidate({ cacheName: 'local-fonts-css' })
)
registerRoute(
  /\/fonts\/.*\.woff2$/,
  new CacheFirst({
    cacheName: 'local-fonts-woff',
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
)

// ── プッシュ通知（2026-07-19に public/sw.js で書いたものを移設／2026-08-18 内容つきに変更）
// ★題名・本文・遷移先・まとめ方は、送られてきた payload をそのまま使う。
//   文言はDBの push_payload(kind, id) が唯一のソース＝ここでは組み立てない。
//   payloadに無ければ従来の固定文・チャット一覧へ落ちる（古い送信元とも噛み合う）。
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = data.title || 'chitose-bank'
  const body = data.body || '新しいメッセージが届きました'
  const url = data.url || '/#/chats'
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      // まとめ方はスレッドごと（cb-chat-<応募ID>）＝別のチャットの通知が互いに上書きしない。
      // 同じスレッドの連投だけがまとめられる（溜まりすぎない狙いは維持）
      tag: data.tag || 'cb-chat',
      data: { url },
    })
    // アプリアイコンのバッジ（赤い数字）＝未読数。payloadのbadgeを反映（アプリを閉じていても更新される）
    if (typeof data.badge === 'number' && 'setAppBadge' in self.navigator) {
      try {
        if (data.badge > 0) await self.navigator.setAppBadge(data.badge)
        else await self.navigator.clearAppBadge()
      } catch { /* 非対応環境では何もしない */ }
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/#/chats'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if ('focus' in c) {
        try { c.navigate(url) } catch { /* 遷移できなくても前面に出す */ }
        return c.focus()
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  })())
})
