// 画面スナップショット（2026-07-25・リロード即表示の本命）：前回の状態をlocalStorageに保存し、
// リロード直後はネットワーク0本で骨格を描く→裏で本物を取得して差分適用（stale-while-revalidate）。
// チャット一覧のchatCache（メモリ・リロードで消える）の永続版。
// 規則：①保存するのは本人の自分用データのみ ②ログアウトで全消去（clearSnapshots）③壊れたJSONは黙って捨てる
import { clearCache } from "./viewCache";
import { clearLastRoute } from "./lastRoute";
import { clearChatBodies } from "./chatBodyCache";
const PREFIX = "cb_snap_";

export const snapGet = (key) => {
  try { const s = localStorage.getItem(PREFIX + key); return s ? JSON.parse(s) : null; } catch { return null; }
};
export const snapSet = (key, value) => {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch {}
};
export const clearSnapshots = () => {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
  } catch {}
  // 画面キャッシュ（viewCache・2026-08-02からsessionStorage永続）も同時に消す。
  // ログアウト後に別人がログインしても前の人のデータが残らない（規則②の適用範囲を揃える）
  clearCache();
  // 前回見ていた画面（cb_lastRoute）も消す（2026-08-26 Speed-4A）＝別の人がログインした時に
  // 前の人の画面へ戻らない。復元側も本人の照合をするので二重の壁
  clearLastRoute();
  // チャット本文の端末キャッシュ（暗号化・IndexedDB）も消す（2026-08-26 Speed-4B）。
  // 鍵ごと消すので、記録が残っていても復号できない＝別の人が前の人の会話を見ることはない
  clearChatBodies();
};
