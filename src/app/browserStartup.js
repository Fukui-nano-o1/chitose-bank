// 古いHTMLキャッシュの整理は補助処理。呼び出し元は完了を待たず画面を起動する。
// 失敗時に済みの印を付けない。消すのは旧来のpages-cacheだけで、認証・入力は触らない。
export async function clearLegacyPageCache(browser = window) {
  const key = 'cb_pagesCachePurge_v1';
  try {
    if (!browser.caches || browser.localStorage.getItem(key)) return;
    await browser.caches.delete('pages-cache');
    try { browser.localStorage.setItem(key, '1'); } catch { /* 保存不可でも画面は続ける */ }
  } catch (error) {
    // 補助処理の拒否を未処理Promiseにしない。診断の失敗も起動へ伝えない。
    try { browser.console.warn('[chitose-bank] Cache cleanup unavailable; continuing online.', error); } catch {}
  }
}
