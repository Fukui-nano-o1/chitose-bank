// 訪問者のアクションでログインが発火したときの「戻り先」と「書きかけの入力」の預かり所（2026-07-30たきと指示）。
// ・戻り先（cb_loginReturn）＝発火したページのURL。ログイン成功後、Appがここへ戻す
// ・書きかけ（cb_loginDraft）＝入力途中の中身。戻った先のページ自身が拾って復元する
// 応募の戻り先（applyReturn）はこれより具体的な導線なので従来どおり優先する。
// 期限つき（2時間）＝古い記録で思わぬ場所へ飛ばさない。個人情報は入れない（本人が今書いた文だけ）。
const RETURN_KEY = "cb_loginReturn";
const DRAFT_KEY  = "cb_loginDraft";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

const fresh = (v) => !!(v && v.at && Date.now() - v.at <= MAX_AGE_MS);

// ログインへ送り出す直前に呼ぶ。hashを省略すると「今いるページ」を覚える
export const armLoginReturn = (hash) => {
  try {
    const h = (hash != null ? String(hash) : window.location.hash).replace(/^#\/?/, "");
    if (!h || h === "login") return;                       // ログイン画面そのものは覚えない
    localStorage.setItem(RETURN_KEY, JSON.stringify({ hash: h, at: Date.now() }));
  } catch {}
};
// ログイン成功後に1回だけ読む（読んだら消す）。戻り先が無ければ null
export const takeLoginReturn = () => {
  try {
    const raw = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return fresh(v) ? v.hash : null;
  } catch { return null; }
};

// 書きかけの入力を預ける。kind＝拾う側の目印（例 "jobQuestion"）
export const stashLoginDraft = (kind, data) => {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, data, at: Date.now() })); } catch {}
};
// 自分あて（kindが一致）の書きかけだけ受け取る。受け取ったら消す＝二度は戻らない
export const takeLoginDraft = (kind) => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!fresh(v) || v.kind !== kind) return null;
    localStorage.removeItem(DRAFT_KEY);
    return v.data;
  } catch { return null; }
};
