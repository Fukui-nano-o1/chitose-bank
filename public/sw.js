// chitose-bank Service Worker（2026-07-19）：チャットのプッシュ通知のみを担う最小構成。
// キャッシュ等のオフライン機能は持たない（アプリはネット前提）。
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  const title = data.title || 'chitose-bank';
  const body = data.body || '新しいメッセージが届きました';
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      tag: 'cb-chat', // 同種は上書き＝通知が溜まりすぎない
      data: { url: '/#/chats' },
    });
    // アプリアイコンのバッジ（赤い数字）＝未読数。payloadのbadgeを反映（アプリを閉じていても更新される）
    if (typeof data.badge === 'number' && 'setAppBadge' in self.navigator) {
      try { if (data.badge > 0) await self.navigator.setAppBadge(data.badge); else await self.navigator.clearAppBadge(); } catch (_) {}
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/#/chats';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { c.navigate(url); } catch (_) {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
