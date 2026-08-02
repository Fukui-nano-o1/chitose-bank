// 画面のデータキャッシュ（2026-07-27たきと指示「遷移のたびに数十秒待たされる」）。
//
// タブを切り替えるとコンポーネントがアンマウントされ、戻るたびに全部取り直していた。
// ここに前回の結果を置いておき、次に開いた時は「まず前回の内容を出す→裏で最新に差し替える」
// （stale-while-revalidate）。待ち時間の体感を消すのが目的で、正しさは常に再取得で担保する。
//
// 2026-08-02(続)：localStorageへ移行（たきと指示「サイトを落としてから入ると遅い」「全ページに適用」）。
// アプリを完全に終了しても、次の起動で前回内容を即描画→裏で最新化（大企業アプリの冷間起動と同じ型）。
// viewCacheを使う全ページ（さがす/お仕事タブ各面/今日/応募状況/プロフィール入口/いいね/委託/管理見守り）
// が自動でこの復元に乗る。チャットは意図的に対象外（メッセージ本文は端末に永続させない）。
//
// ■安全設計（たきと指示「悪意あるユーザーに悪意ある利用をされても問題ないように」）
// 1. キャッシュは表示専用。権限判定・DBへの書き込み値には決して使わない（実権限は常にサーバーの
//    RLS/app_admins。端末内で改ざんしても自分の画面表示が乱れるだけで、他人のデータにも書き込みにも届かない）
// 2. 保存キーは本人のauth idでスコープ（cb_viewCache_v2_<uid先頭8桁>・未ログインは anon）。
//    同じ端末で別アカウントがログインしても前の人のキャッシュは読まれない。起動時に他スコープの残骸は削除
// 3. ログアウトで全消去（clearSnapshots→clearCache()。スコープ違いも含め全キーを消す）
// 4. 壊れたJSON・object以外は黙って捨てる（規則はsnapshot.jsと同じ）。2MB超は書かない（quota保護）
// 5. 表示はReactの標準エスケープのみ（dangerouslySetInnerHTML不使用を2026-08-02にgrep確認済み）
//    ＝キャッシュに文字列を仕込まれてもスクリプトとしては実行されない
const PREFIX = "cb_viewCache_v2_";
const LEGACY_SS_KEY = "cb_viewCache_v1"; // 旧世代（sessionStorage）。初回移行後に削除

// 本人スコープのキー。ログイン状態はsnapshotのme（localStorage）から読む
//（snapshot.jsをimportすると循環参照になるため直接読む）
const scopeKey = () => {
  let uid = "";
  try { uid = (JSON.parse(localStorage.getItem("cb_snap_me") || "null") || {}).id || ""; } catch {}
  return PREFIX + (uid ? String(uid).slice(0, 8) : "anon");
};

const loadStore = () => {
  try {
    const cur = scopeKey();
    // 他スコープ（前のアカウント・ログイン前のanon）の残骸を起動時に掃除
    try { Object.keys(localStorage).filter(k => k.startsWith(PREFIX) && k !== cur).forEach(k => localStorage.removeItem(k)); } catch {}
    let s = localStorage.getItem(cur);
    // 旧世代(sessionStorage v1)からの一度きり移行：新形式が空の時だけ引き継ぐ
    if (!s) { try { s = sessionStorage.getItem(LEGACY_SS_KEY); } catch {} }
    try { sessionStorage.removeItem(LEGACY_SS_KEY); } catch {}
    if (s) {
      const o = JSON.parse(s);
      if (o && typeof o === "object" && !Array.isArray(o)) return new Map(Object.entries(o));
    }
  } catch {}
  return new Map();
};
const store = loadStore();

// 書き込みは300msまとめて1回（setCacheは起動時に連発されるため、毎回stringifyしない）。
// スコープは書き込み時にも解決する＝ログイン直後から本人スコープに載る
let flushTimer = null;
const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      const json = JSON.stringify(Object.fromEntries(store));
      if (json.length > 2 * 1024 * 1024) return; // quota保護：異常肥大時は書かない（メモリ側の表示は生きる）
      localStorage.setItem(scopeKey(), json);
    } catch {}
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
    try { Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k)); } catch {}
    try { sessionStorage.removeItem(LEGACY_SS_KEY); } catch {}
  } else {
    store.delete(key);
    scheduleFlush();
  }
}
