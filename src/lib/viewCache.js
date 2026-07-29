// 画面のデータキャッシュ（2026-07-27たきと指示「遷移のたびに数十秒待たされる」）。
//
// タブを切り替えるとコンポーネントがアンマウントされ、戻るたびに全部取り直していた。
// ここに前回の結果を置いておき、次に開いた時は「まず前回の内容を出す→裏で最新に差し替える」
// （stale-while-revalidate）。待ち時間の体感を消すのが目的で、正しさは常に再取得で担保する。
//
// ・保持はページの寿命だけ（モジュール変数）。リロードで消える＝古いデータを抱え込まない
// ・チャット一覧の未読キャッシュ(lib/chatCache.js)と同じ思想。あちらは専用、こちらは汎用
const store = new Map();

export function getCache(key) {
  return store.has(key) ? store.get(key) : undefined;
}
export function setCache(key, value) {
  store.set(key, value);
}
export function clearCache(key) {
  if (key === undefined) store.clear(); else store.delete(key);
}
