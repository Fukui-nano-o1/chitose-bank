// 画面スナップショット（2026-07-25・リロード即表示の本命）：前回の状態をlocalStorageに保存し、
// リロード直後はネットワーク0本で骨格を描く→裏で本物を取得して差分適用（stale-while-revalidate）。
// チャット一覧のchatCache（メモリ・リロードで消える）の永続版。
// 規則：①保存するのは本人の自分用データのみ ②ログアウトで全消去（clearSnapshots）③壊れたJSONは黙って捨てる
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
};
