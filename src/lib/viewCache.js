// 画面のデータキャッシュ（2026-07-27たきと指示「遷移のたびに数十秒待たされる」）。
//
// タブを切り替えるとコンポーネントがアンマウントされ、戻るたびに全部取り直していた。
// ここに前回の結果を置いておき、次に開いた時は「まず前回の内容を出す→裏で最新に差し替える」
// （stale-while-revalidate）。待ち時間の体感を消すのが目的で、正しさは常に再取得で担保する。
//
// ・2026-08-02 更新時間の短縮：sessionStorageへ永続化。引き下げ更新（window.location.reload）で
//   メモリキャッシュが全消去され、全ページがスケルトンに戻って十数秒待たされていた。
//   永続化により、リロード直後も前回の内容で即描画→裏で最新に差し替える（snapshot.jsのmeと同じ思想）。
// ・sessionStorage＝アプリ（タブ）を完全に終了すれば消える。「古いデータを長期に抱え込まない」性質は維持
// ・規則はsnapshot.jsと同じ：本人の自分用データのみ／ログアウトで全消去（clearSnapshots経由）／
//   壊れたJSONは黙って捨てる
// ・チャット一覧の未読キャッシュ(lib/chatCache.js)と同じ思想。あちらは専用、こちらは汎用
const SS_KEY = "cb_viewCache_v1";

const loadStore = () => {
  try {
    const s = sessionStorage.getItem(SS_KEY);
    if (s) return new Map(Object.entries(JSON.parse(s)));
  } catch {}
  return new Map();
};
const store = loadStore();

// 書き込みは300msまとめて1回（setCacheは起動時に連発されるため、毎回stringifyしない）
let flushTimer = null;
const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(Object.fromEntries(store))); } catch {}
  }, 300);
};

export function getCache(key) {
  return store.has(key) ? store.get(key) : undefined;
}
export function setCache(key, value) {
  store.set(key, value);
  scheduleFlush();
}
export function clearCache(key) {
  if (key === undefined) {
    store.clear();
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    try { sessionStorage.removeItem(SS_KEY); } catch {}
  } else {
    store.delete(key);
    scheduleFlush();
  }
}
