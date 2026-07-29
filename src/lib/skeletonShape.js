// スケルトンの型（2026-07-27たきと指示「各ページの構造に自動依存させて」）。
//
// ページごとに手で形を決めるのをやめ、"前回そのページが実際に描いた形" を覚えて次回の仮配置にする。
// 覚えるのは見た目の骨だけ＝並べ方（display / gridTemplateColumns / gap）と、子の高さの並び。
// 中身（文字・写真・件数）は一切保存しない＝個人情報は入らない。
//
// 保存先はlocalStorage。リロード後の初回描画でも正しい形で出したいため（viewCacheはページ寿命）。
const PREFIX = "cb_skel:";
const MAX_ITEMS = 6; // 仮配置は6個まで（画面を埋めれば十分・実件数は関係ない）

export function readShape(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.heights) || s.heights.length === 0) return null;
    return s;
  } catch { return null; }
}

export function writeShape(key, shape) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(shape)); } catch { /* 容量超過等は無視 */ }
}

// 実際に描かれたコンテナから骨を測る。子が無い（＝空状態や読み込み中）ときは測らない
export function measureShape(el) {
  if (!el || !el.children || el.children.length === 0) return null;
  // 仮配置そのものを測らない（測ると前回の骨を焼き直すだけで、構造の変化に追従しなくなる）
  if (el.querySelector && el.querySelector("[aria-busy]")) return null;
  let cs;
  try { cs = window.getComputedStyle(el); } catch { return null; }
  const heights = [];
  for (let i = 0; i < el.children.length && heights.length < MAX_ITEMS; i++) {
    const h = Math.round(el.children[i].getBoundingClientRect().height);
    if (h > 8 && h < 600) heights.push(h); // 極端な値は骨にしない
  }
  if (heights.length === 0) return null;
  return {
    display: cs.display === "grid" ? "grid" : "flex",
    columns: cs.display === "grid" ? cs.gridTemplateColumns : "",
    gap: cs.gap && cs.gap !== "normal" ? cs.gap : "10px",
    heights,
  };
}
