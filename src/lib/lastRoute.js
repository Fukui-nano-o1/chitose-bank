// 前回見ていた画面（route）の預かり所（2026-08-26 Speed-4A）。
//
// ■なぜ要るのか（実コードで確定した原因）
// PWAの start_url は '/'（vite.config.js）＝ハッシュ無し。画面の決め手は window.location.hash だけで、
// 前回のrouteを端末に残す仕組みはどこにも無かった（既存の cb_loginReturn・applyReturnJob・
// cb_emergencyLink は目的別の1回きりの戻り先、cb_jobBackTo は sessionStorage＝アプリ終了で消える）。
// そのため iOSが前回のWebViewを捨てて '/' から起動すると、前回どの画面に居ても既定（さがす）へ着地していた。
//
// ■設計の一線
// ・新しいルーターは作らない。いまのハッシュルーティングをそのまま正とし、その文字列だけを預かる
// ・画面のデータは既存の viewCache / snapshot が持つ。ここはrouteの文字列1つしか持たない
// ・復元は同期のlocalStorage読みだけ。ネットワークもSupabaseも待たない
// ・URLに行き先の指定がある時は絶対に奪わない（ディープリンク・メールのリンク・共有リンクが最優先）
const KEY = "cb_lastRoute";

// 既定の着地先。ここに居る時は「特に何も見ていない」と同じなので記録を消す
//（記録しないことで、起動時の着地判定＝新着の応募・まもなく開始 を今までどおり働かせる）
const DEFAULT_HASH = "search";

// 冷間起動で勝手に戻すべきでない一時画面。
// ・login / account＝認証と登録の途中
// ・apply/*＝応募の完了演出・チェックリスト（一度きりの状態）
// ・emergency/*＝メールから来た時だけ意味がある当事者チェック付きのリンク
// ・work/new* / work/edit/*＝求人の作成・編集の途中
// ★通常の閲覧ページ（求人詳細・チャット・カレンダー・マイページの奥）は除外しない＝復元の対象
const DENY = [
  /^login$/,
  /^account$/,
  /^apply(\/|$)/,
  /^emergency(\/|$)/,
  /^work\/new(\/|$)/,
  /^work\/edit(\/|$)/,
  /^visit$/, // QRの玄関＝入口であって画面ではない（中身は さがす へ素通りする）
];

export const isRestorableRoute = (h) =>
  typeof h === "string" && !!h && h !== DEFAULT_HASH && !DENY.some(re => re.test(h));

// いまログインしている本人（snapshotのme）。snapshot.js を import すると
// clearSnapshots→clearLastRoute で循環するので、viewCache.js と同じく直接読む
const currentUid = () => {
  try { return String((JSON.parse(localStorage.getItem("cb_snap_me") || "null") || {}).id || ""); }
  catch { return ""; }
};

// 画面が変わるたびに呼ぶ。ログインしている時だけ記録する（訪問者は記録しない）
export function saveLastRoute(hash) {
  try {
    const h = String(hash == null ? "" : hash).replace(/^#\/?/, "");
    const uid = currentUid();
    if (!uid) return;
    if (!isRestorableRoute(h)) { localStorage.removeItem(KEY); return; } // 既定・一時画面＝記録を消す
    localStorage.setItem(KEY, JSON.stringify({ uid, hash: h, at: Date.now() }));
  } catch { /* プライベートモード等では何もしない */ }
}

export function clearLastRoute() {
  try { localStorage.removeItem(KEY); } catch { /* 消せなくても実害なし */ }
}

// 記録した前回のroute。本人が一致し、いま復元してよい画面の時だけ返す
export function readLastRoute() {
  try {
    const uid = currentUid();
    if (!uid) return null;
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!v || v.uid !== uid || !isRestorableRoute(v.hash)) return null;
    return v.hash;
  } catch { return null; }
}

// 起動時に1回だけ呼ぶ（main.jsx・Reactが描く前）。復元したら そのroute、しなければ null。
// ★history.replaceState を使う＝履歴を増やさない・hashchange を出さない・
//   Reactの最初の描画がこのURLを読む（「一瞬さがすが出てから移る」を作らない）
export function restoreLastRoute() {
  try {
    if (window.location.hash.replace(/^#\/?/, "")) return null; // URLに行き先の指定がある＝奪わない
    const h = readLastRoute();
    if (!h) return null;
    window.history.replaceState(null, "", "#/" + h);
    return h;
  } catch { return null; }
}
