// 絞り込み条件の保存（第2次構造改革2026-08-18で JobSearchMapView.jsx から分離）。
// 読み書きの中身は移設前と同一。localStorage のキー "cb_searchFilters" を持つのはここだけ
// ＝キー名と入れ物の形（{w,r,m} の3配列）を1箇所で見られるようにするための層。
// ★保存できなくても絞り込み自体は動く（読めなければ空、書けなければ黙って諦める）＝
//   表示専用のキャッシュと同じ扱い。ここを「条件の正」にはしない（正は画面のstate）。
const KEY = "cb_searchFilters";

export const readStoredSearch = (key) => {
  try { const v = (JSON.parse(localStorage.getItem(KEY) || "null") || {})[key]; return Array.isArray(v) ? v : []; } catch { return []; }
};

export const writeStoredSearch = (whats, regions, months) => {
  try { localStorage.setItem(KEY, JSON.stringify({ w: whats, r: regions, m: months })); } catch { /* 保存不可でも絞り込み自体は動く */ }
};
