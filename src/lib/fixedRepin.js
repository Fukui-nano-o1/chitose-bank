// iOS（WebKit）の fixed 置き去りバグの自己修復（2026-08-22）
// 症状：PWAでオーバーレイの開閉・背面化・キーボードを繰り返すうちに、position:fixed の
// 下部要素（下部バー・☰・切替FAB・検索ピル）が文書の途中に貼り付き、スクロールに
// 追従しなくなる（Apple Developer Forums thread/744327 と同一・実機スクショで確認 2026-08-22）。
// このアプリはボックスのスクロール固定で html/body の height:100% を頻繁に切り替えるため
// （appStyles の html:has(.cb-lock-scroll) 系）、引き金を引きやすい。
//
// 対処：節目（アプリ復帰・pageshow・キーボード閉じ・visualViewportの変化）＋保険の低頻度
// インターバルで、fixed要素を「display:none → 強制リフロー → 戻す」して WebKit に
// 貼り直させる。同一フレーム内で完結する＝間に描画が入らないのでちらつきは出ない。
// ★fixed のボトム系要素を新設したら SELECTORS に足すこと。
const SELECTORS = [
  ".app-header-mobile",       // 下部バー
  ".app-header-mobile-float", // ☰浮遊ボタン
  ".cb-search-fab",           // さがすの検索ピル
  ".profile-employer-fab",    // 役割切替FAB
  ".consign-role-fab",        // 委託⇄受託トグル
  ".cb-float-box",            // 浮遊ボックス（プレビュー等）
  ".cb-applicant-filter-bar", // 応募者ページの絞り込みバー
  ".cb-job-action-fabs",      // 求人一覧の操作FAB
].join(", ");

export function repinFixedChrome() {
  try {
    document.querySelectorAll(SELECTORS).forEach((el) => {
      const prev = el.style.display;
      el.style.display = "none";
      void el.offsetHeight; // 強制リフロー＝WebKitがレイヤーを作り直す
      el.style.display = prev || "";
    });
  } catch { /* 診断用の仕掛けで本体を落とさない */ }
}

// App.jsx から1回だけ呼ぶ。戻り値は解除関数（アンマウントで外す）
export function installFixedRepin() {
  let timer = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(repinFixedChrome, 300);
  };
  const onVisible = () => { if (!document.hidden) debounced(); };
  window.addEventListener("pageshow", debounced);
  document.addEventListener("visibilitychange", onVisible);
  // キーボードが閉じた時（入力欄から離れた時）＝cb-typing で隠していたバーの再表示の節目
  document.addEventListener("focusout", debounced);
  // visualViewport の変化（キーボード・iOSツールバーの伸縮・ズーム）＝置き去りの主な引き金
  const vv = window.visualViewport;
  if (vv) vv.addEventListener("resize", debounced);
  // 保険：どのイベントにも掛からず壊れた場合も20秒以内に自然回復させる
  const interval = setInterval(repinFixedChrome, 20000);
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener("pageshow", debounced);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("focusout", debounced);
    if (vv) vv.removeEventListener("resize", debounced);
    clearInterval(interval);
  };
}
