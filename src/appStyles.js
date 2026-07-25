// アプリ全体のCSS（分割・段階1・2026-07-24）：App.jsxの<style>{CSS}</style>で注入される単一文字列。
// 純粋な静的CSS（テンプレート補間なし）。編集ルールは従来どおり＝クラスを足す/直すだけ。
export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Inter:wght@300;400;500;600;700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; background: #fff; overflow-x: clip; }
body { background: #fff; overflow-x: clip; }

::-webkit-scrollbar { width: 2px; height: 2px; }
::-webkit-scrollbar-thumb { background: #EBEBEB; border-radius: 1px; }
::-webkit-scrollbar-track { background: transparent; }

.filter-scroll::-webkit-scrollbar { display: none; }

.carousel-scroll::-webkit-scrollbar { height: 6px; }
.carousel-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 3px; }
.carousel-scroll::-webkit-scrollbar-track { background: transparent; }

/* ── Print ── */
@media print {
  header, footer, .bottom-tab-bar, .no-print { display: none !important; }
  main { padding: 0 !important; max-width: 100% !important; }
  body, html { background: #fff !important; }
  .ledger-card { box-shadow: none !important; border: 1px solid #EBEBEB !important; }
  #data-definition-print, #data-definition-print * { visibility: visible !important; }
  #data-definition-print { position: absolute; left: 0; top: 0; width: 100%; }
}

.f-serif { font-family: 'Noto Sans JP', 'Inter', sans-serif; font-weight: 700; }
.f-sans  { font-family: 'Noto Sans JP', 'Inter', sans-serif; }
.f-mono  { font-family: 'DM Mono', 'Courier New', monospace; }

button, input, select { font-family: 'Noto Sans JP', 'Inter', sans-serif; }
button { cursor: pointer; transition: all .2s ease; }
button:active { transform: scale(.97); }
input:focus { outline: none; }

/* ── Entrance animations ── */
@keyframes appear {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
@keyframes pulse {
  0%,100% { opacity: 1; }
  50%      { opacity: .35; }
}
@keyframes shake {
  0%,100% { transform: translateX(0); }
  25%      { transform: translateX(-7px); }
  75%      { transform: translateX(7px); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
/* 「はじめての方はこちら」を跳ねさせて誘目（2026-07-22） */
@keyframes cbHop {
  0%,100%  { transform: translateY(0); }
  30%      { transform: translateY(-6px); }
  45%      { transform: translateY(0); }
  60%      { transform: translateY(-3px); }
  75%      { transform: translateY(0); }
}
.cb-hop { animation: cbHop 1.6s ease-in-out infinite; }

.appear      { animation: appear .5s cubic-bezier(.22,.8,.36,1) both; }
.fade-in     { animation: fadeIn .35s ease both; }
/* 求人フローのstep遷移（2026-07-14）：次へ=左へフェードアウト→右からフェードイン／戻る=その逆。
   transformはfixedな子(モーダル等)の基準を壊すため、入場完了後にonAnimationEndでクラスを外す */
@keyframes stepOutLeft  { from { opacity:1; transform:translateX(0); }      to { opacity:0; transform:translateX(-120px); } }
@keyframes stepInRight  { from { opacity:0; transform:translateX(120px); }  to { opacity:1; transform:translateX(0); } }
@keyframes stepOutRight { from { opacity:1; transform:translateX(0); }      to { opacity:0; transform:translateX(120px); } }
@keyframes stepInLeft   { from { opacity:0; transform:translateX(-120px); } to { opacity:1; transform:translateX(0); } }
/* 求人プレビューのポップアップ（縮小→等倍・軽いオーバーシュートで弾む）。フェード(opacity)なし。
   fill無し=終了後にtransformが外れ、内部のfixed要素(ライトボックス等)の基準を壊さない */
@keyframes cbPop { from { transform: scale(.85); } to { transform: scale(1); } }
.cb-sheet-up { animation: cbPop .8s cubic-bezier(.2, 1.3, .3, 1); transform-origin: center center; }
/* ── ボックス規格（2026-07-21 全ボックス統一）：画面中央にボックスの中央を合わせる。
   親オーバーレイ(.cb-box-overlay)がflexで上下左右中央寄せ、ボックス(.cb-notice-sheet)は
   意匠（緑太縁3px・角丸・影・左詰め）と最大サイズ・スクロールを担う。
   高さ上限＝実表示高さ(100dvh)からセーフエリア＋余白32pxを引いた値so、長文でも画面内に収まり中央を保つ */
.cb-box-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,0.5); animation: fadeIn .2s ease; }
.cb-notice-sheet {
  width: 100%; max-width: 480px;
  max-height: calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px);
  overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  background: #fff; border: 3px solid #00A86B; border-radius: 20px;
  padding: 28px 24px 24px; box-shadow: 0 12px 48px rgba(0,0,0,0.25); text-align: left;
}
@supports (height: 100dvh) {
  .cb-notice-sheet { max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px); }
}
/* お知らせ規定（2026-07-17追加）：タイトル・リンクの文字が頭から順に上へジャンプする波。
   1文字の山は周期の先頭8%（周期はNoticeJumpTextが文字数から算出＝波の走破後に約2秒の休止を挟んでループ） */
@keyframes cbCharJump {
  0% { transform: translateY(0); }
  4% { transform: translateY(-0.4em); }
  8% { transform: translateY(0); }
  100% { transform: translateY(0); }
}
/* 未完了カードの注意アニメ（働き手・承認済みタブ）：赤い影＋最初の0.5秒で2度浮遊→3秒かけて沈む（計3.5秒・無限ループ） */
@keyframes cbUrgent {
  0%    { transform: translateY(0);    box-shadow: 0 2px 6px rgba(226,75,74,.45); }
  3.6%  { transform: translateY(-5px); box-shadow: 0 8px 16px rgba(226,75,74,.55); }
  7.1%  { transform: translateY(0);    box-shadow: 0 3px 8px rgba(226,75,74,.5); }
  10.7% { transform: translateY(-5px); box-shadow: 0 8px 16px rgba(226,75,74,.55); }
  14.3% { transform: translateY(-2px); box-shadow: 0 7px 14px rgba(226,75,74,.5); }
  100%  { transform: translateY(0);    box-shadow: 0 1px 4px rgba(226,75,74,.4); }
}
.cb-urgent-card { animation: cbUrgent 3.5s ease-in-out infinite; }
/* 赤影なしの飛ぶ動作（2026-07-18）：チャット未読の下部バーアイコン用。跳ねのリズムはcbUrgentと同じ */
@keyframes cbJump {
  0%    { transform: translateY(0); }
  3.6%  { transform: translateY(-5px); }
  7.1%  { transform: translateY(0); }
  10.7% { transform: translateY(-5px); }
  14.3% { transform: translateY(-2px); }
  100%  { transform: translateY(0); }
}
/* 新着メッセージのアプリ内トースト（2026-07-19）：画面上から滑り込む */
@keyframes cbToastIn {
  from { transform: translateY(-140%); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
.cb-jump { animation: cbJump 3.5s ease-in-out infinite; will-change: transform; }
/* お気に入り登録ボックス（2026-07-19）：アイコンに❤️が付くポップ動作（ボックス展開の0.3s後に出現） */
@keyframes cbHeartPop {
  0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
  60%  { transform: scale(1.35) rotate(8deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
.cb-heart-pop { animation: cbHeartPop .6s cubic-bezier(.2, 1.4, .4, 1) .3s both; }
/* 採用おめでとうの花びら（2026-07-19）：採用ボックス展開中、画面全体を舞い落ちる🌸 */
@keyframes cbPetalFall {
  0% { transform: translate3d(0, -60px, 0) rotate(0deg); opacity: 0; }
  8% { opacity: 1; }
  100% { transform: translate3d(46px, 105vh, 0) rotate(340deg); opacity: 0.85; }
}
.cb-petal { position: absolute; top: 0; pointer-events: none; animation: cbPetalFall linear infinite; will-change: transform; }
/* 委託準備室の印刷（2026-07-19）：印刷時は仕様書(.consign-print)だけを紙に出す */
@media print {
  body * { visibility: hidden; }
  .consign-print, .consign-print * { visibility: visible; }
  .consign-print { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}
/* 任意項目の未入力：赤影のみ（浮遊アニメなし・2026-07-16） */
.cb-urgent-still { box-shadow: 0 2px 6px rgba(226,75,74,.45) !important; }
/* 体感0.8秒（退場0.4s＋入場0.4s）・スワイプ風の横滑り（2026-07-16） */
.step-out-left  { animation: stepOutLeft  .4s ease both; }
.step-in-right  { animation: stepInRight  .4s ease both; }
.step-out-right { animation: stepOutRight .4s ease both; }
.step-in-left   { animation: stepInLeft   .4s ease both; }
/* プロフィール両面(働き手⇄農家プロ)の切替フェード（2026-07-14・opacityのみ=fixed子要素に安全） */
@keyframes fadeOut { from { opacity:1; } to { opacity:0; } }
.pfade-out { animation: fadeOut .16s ease both; }
.pfade-in  { animation: fadeIn  .22s ease both; }
/* 農家⇄働き手プロフィール切替の反転（カードフリップ・合計0.8秒）。
   outはforwardsで90度に固定→面切替→inで-90度から戻る。transformはfixed子の基準を壊すため
   入場完了後にonAnimationEndでクラスを外す（step同様） */
@keyframes pflipOut { from { transform: perspective(1200px) rotateY(0deg); opacity:1; } to { transform: perspective(1200px) rotateY(90deg); opacity:.6; } }
@keyframes pflipIn  { from { transform: perspective(1200px) rotateY(-90deg); opacity:.6; } to { transform: perspective(1200px) rotateY(0deg); opacity:1; } }
.pflip-out { animation: pflipOut .4s ease-in both; }
.pflip-in  { animation: pflipIn .4s ease-out; }
.pulse-slow  { animation: pulse 2s ease infinite; }
.shake       { animation: shake .4s ease; }

/* staggered children */
.stagger > *:nth-child(1) { animation-delay: 0s; }
.stagger > *:nth-child(2) { animation-delay: .08s; }
.stagger > *:nth-child(3) { animation-delay: .16s; }
.stagger > *:nth-child(4) { animation-delay: .24s; }
.stagger > *:nth-child(5) { animation-delay: .32s; }

/* ── Ledger card ── */
.ledger-card {
  background: #FFFFFF;
  border: 1px solid #EBEBEB;
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05);
  position: relative;
  overflow: hidden;
}
.ledger-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, #00A86B44, transparent);
  opacity: 0;
  transition: opacity .3s;
}
.ledger-card:hover::before { opacity: 1; }

/* ── Ghost / skeleton ── */
.ghost-line {
  background: linear-gradient(90deg, #F7F7F7 25%, #EBEBEB 50%, #F7F7F7 75%);
  background-size: 200% 100%;
  animation: shimmer 2s ease infinite;
  border-radius: 4px;
}

/* ── Bottom tab bar (mobile) ──
   2026-07-14: top:0→bottom:0 に変更。day5-6時代は上部ヘッダー不在でこのバー自身が
   上部ナビを兼ねていたが、.app-headerをモバイルにも表示する今回の変更で前提が変わったため、
   本来の名前・見た目（画面下部のタブバー）に戻す。 */
.bottom-tab-bar {
  display: flex;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: #FFFFFF;
  border-top: 1px solid #EBEBEB;
  z-index: 49;
  padding: 6px 0 calc(6px + env(safe-area-inset-bottom, 0px));
  justify-content: center;
  gap: 24px;
}
@media (max-width: 640px) {
  .bottom-tab-bar {
    display: flex;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: #FFFFFF;
    border-top: 1px solid #EBEBEB;
    z-index: 49;
    padding: 6px 0 calc(6px + env(safe-area-inset-bottom, 0px));
  }
  .bottom-tab-bar button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4px 4px 2px;
    border: none;
    background: transparent;
    font-size: 10px;
    font-family: 'Noto Sans JP', sans-serif;
    gap: 3px;
    cursor: pointer;
    color: #717171;
  }
  .bottom-tab-bar button:hover { color: #008F5B; }
  .bottom-tab-bar button.active { color: #00A86B; font-weight: 600; }
  .bottom-tab-bar button span.icon { font-size: 20px; line-height: 1; }
  header { padding: 0 16px !important; }
  main { padding: 10px 12px calc(90px + env(safe-area-inset-bottom, 0px)) !important; }
  .ledger-card { padding: 16px !important; }
}

.app-header {
  position: sticky; top: 0; z-index: 20;
  width: 100%;
  background: #fff; border-bottom: 1px solid #EBEBEB;
}
.app-header-inner {
  max-width: 1200px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; height: 64px;
}
@media (max-width: 768px) {
  /* 2026-07-14: モバイルにも.app-headerを表示（旧: display:none）。
     下部タブバーをbottom:0へ移設したため、上下で衝突しなくなった */
  .app-header-inner { padding: 0 16px; }
}
@media (min-width: 769px) {
  .bottom-tab-bar { display: none !important; }
}

/* ── モバイルナビの下部バー統合（2026-07-14）：.app-headerをPC用(.app-header-desktop・
   上部sticky・無変更)とモバイル用(.app-header-mobile・下部fixed)に出し分ける。
   旧.bottom-tab-barはモバイルでも非表示にする（削除ではなく非表示化。PCは元々
   min-width:769pxで非表示済みなので上のルールは無変更） ── */
.app-header-mobile { display: none; }
@media (max-width: 768px) {
  .app-header-desktop { display: none; }
  .app-header-mobile {
    display: block;
    position: fixed;
    top: auto; bottom: 0;
    border-bottom: none;
    border-top: 1px solid #EBEBEB;
    z-index: 49;
    /* 左右4px：5タブを画面端ギリギリまで広げる（headerの0 16px !importantをクラス詳細度で上書き） */
    padding: 0 4px env(safe-area-inset-bottom, 0px) !important;
    transition: transform .25s ease;
    /* 2026-07-19: バー内の常時アニメ（チャット未読のcb-jump）でiOS WebKitがfixedのバーを
       置き去りにする事象（☰で既出のバグと同種）への対処。☰と同じく自前の合成レイヤーに昇格 */
    transform: translateZ(0);
    will-change: transform;
  }
  /* スクロール連動の自動格納（Part C）。求人詳細では上のdisplay:noneガードが優先される */
  body.cb-scroll-hide .app-header-mobile { transform: translateY(calc(100% + env(safe-area-inset-bottom, 0px))); }
  .bottom-tab-bar { display: none !important; }
  /* 入力中（キーボード表示中）は下部バー・浮遊☰を隠す（2026-07-19）。入力欄と被らせない */
  body.cb-typing .app-header-mobile,
  body.cb-typing .app-header-mobile-float { display: none !important; }
}

/* ── 下部ナビの初回コーチマーク（第12弾・2026-07-23）：下部バー直上に薄い1行。タップで消える ── */
.nav-coach { display: none; }
@media (max-width: 768px) {
  .nav-coach {
    display: block;
    position: fixed;
    left: 0; right: 0; width: 100%;
    bottom: calc(64px + env(safe-area-inset-bottom, 0px));
    z-index: 50;
    background: rgba(34,34,34,0.92);
    color: #fff;
    font-size: 12px;
    text-align: center;
    padding: 8px 12px;
    border: none;
    cursor: pointer;
    font-family: 'Noto Sans JP', sans-serif;
    box-shadow: 0 -2px 8px rgba(0,0,0,0.14);
    animation: cbToastIn .3s ease both;
  }
  body:has(.mobile-apply-bar) .nav-coach,
  body:has(.chat-full) .nav-coach,
  body.cb-typing .nav-coach { display: none !important; }
}

/* ── チャット縦最大化（2026-07-19）：mainの上余白を打ち消し、下部バー直上まで拡大。
   PCは従来の70vh。モバイルはsafe-area(ノッチ)+8pxを上端、下部バー64px+safe-bottomを下端に。
   100vhはiOSでURLバー分を含み過大なため、対応環境では100dvhで上書き ── */
/* チャットは画面いっぱいの高さで、メッセージ欄だけがスクロール（単一スクロール・LINE式・2026-07-22）。
   大画面（PC）でも縦をしっかり使う。ページ側のスクロールは body:has(.chat-full) で止める（下記） */
.chat-full { height: calc(100vh - 140px); }
@supports (height: 100dvh) { .chat-full { height: calc(100dvh - 140px); } }
@media (max-width: 768px) {
  /* チャット表示中はmainを全面に使い、チャットを画面いっぱいに＝＋/入力/送信が最下部（空白なし・2026-07-22）。
     メッセージ欄(flex:1 minHeight:0)が中で伸縮スクロールし、入力バーは常に一番下 */
  body:has(.chat-full) main { padding: 0 !important; }
  .chat-full {
    margin: 0;
    height: 100vh;
    padding: calc(env(safe-area-inset-top, 0px) + 6px) 12px calc(env(safe-area-inset-bottom, 0px) + 6px);
    box-sizing: border-box;
  }
  @supports (height: 100dvh) { .chat-full { height: 100dvh; } }
}

/* ── モバイル下部バー最終形：☰（アイコンのみ・コンパクト）＋5機能タブ（さがす／いいね／カレンダー／チャット／プロフィール） ── */
.app-header-mobile-tabs {
  display: flex;
  height: 64px;
}
.app-header-mobile-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background: none;
  border: none;
  cursor: pointer;
  color: #717171;
  font-family: 'Noto Sans JP', sans-serif;
  padding: 0;
}
.app-header-mobile-tab .icon { font-size: 26px; line-height: 1; padding: 2px 14px; border-radius: 13px; background: transparent; transition: background .15s; } /* 2026-07-14: 20px→26px(1.3倍)。バー高さ64pxは不変 / 2026-07-24: 常時同サイズの角丸背景枠（非アクティブは透明）でレイアウト不変のままアクティブ時に役割色で塗る */
.app-header-mobile-tab .label { font-size: 10px; line-height: 1; }
.app-header-mobile-tab.active { color: var(--role-accent, #00A86B); font-weight: 600; }
.app-header-mobile-tab.active .icon { background: var(--role-accent-soft, rgba(0,168,107,0.13)); } /* 2026-07-24: アクティブのアイコン背景を役割色（働き手=橙／農家=緑）に統一 */
/* ── モバイル☰の上部浮遊ボタン（2026-07-13 下部バーから移設。fixed＝スクロール追従。
   2026-07-24: 下部フッター・切替FABと同じくスクロール（cb-scroll-hide）で下へ格納する） ── */
.app-header-mobile-float { display: none; }
@media (max-width: 768px) {
  .app-header-mobile-float {
    display: block;
    position: fixed;
    /* 2026-07-14: 左上→左下へ移動。下限=下部バー(64px)+12pxで重ならない */
    bottom: calc(64px + 12px + env(safe-area-inset-bottom, 0px));
    left: 12px;
    z-index: 60;
    /* 2026-07-16: iOS WebKitでスクロール中(下部バーのtransform格納中)に☰の再描画が
       置き去りになり画面に固定されない事象への対処。自前の合成レイヤーに昇格させる。
       transformは自要素なのでfixedの基準は壊れない（壊すのは祖先のtransform） */
    transform: translate3d(0, 0, 0);
    will-change: transform;
    transition: transform .25s ease;
  }
  /* スクロール連動の自動格納（2026-07-24）：下部バー(cb-scroll-hide)と同じタイミングで下へ隠す */
  body.cb-scroll-hide .app-header-mobile-float { transform: translate3d(0, calc(100% + 64px + 12px + env(safe-area-inset-bottom, 0px)), 0); }
  /* 求人詳細（応募フッターあり）では下部バーと同様に非表示（既存ガードと整合） */
  body:has(.mobile-apply-bar) .app-header-mobile-float { display: none; }
}
.app-header-mobile-float-btn {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  background: #fff;
  border: 1px solid #EBEBEB;
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0,0,0,.12);
  cursor: pointer;
  color: #222;
  padding: 0;
}
.app-header-mobile-float-btn .icon { font-size: 19px; line-height: 1; }
.app-header-mobile-float-btn.active { color: var(--role-accent, #00A86B); }
/* 浮遊☰から開くメニューはボタンの真上に開く（2026-07-14: ボタンが左下配置になったため上開きに戻した）。
   下限=ボタンの直上で固定（bottom:100%）なので下部バーとは構造上重ならない。
   低い画面用にmax-heightで上方向のはみ出しも防止 */
.app-header-mobile-float .app-header-mobile-menu {
  bottom: 100%; top: auto;
  margin-bottom: 8px; margin-top: 0;
  left: 0; right: auto;
  min-width: 220px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  box-shadow: 0 4px 16px rgba(0,0,0,.12);
}
/* ☰の中身（求人を出す・管理・運営憲章・利用規約・プライバシー・ログアウト）。バーの真上に開く */
.app-header-mobile-menu {
  position: absolute;
  bottom: 100%;
  left: 12px;
  right: 12px;
  margin-bottom: 8px;
  background: #fff;
  border: 1px solid #EBEBEB;
  border-radius: 12px;
  box-shadow: 0 -4px 16px rgba(0,0,0,.08);
  padding: 8px 0;
  z-index: 30;
}
.app-header-mobile-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  color: #222;
  padding: 12px 16px;
}
.app-header-post-btn .post-label-short { display: none; }
@media (max-width: 380px) {
  .app-header-post-btn .post-label-full { display: none; }
  .app-header-post-btn .post-label-short { display: inline; }
}

/* ── 農家プロ(雇い手空間)：モバイルで画面端から10pxに詰める
   （main左右12px − 負マージン6px ＋ ラッパーpadding4px ＝ 10px。
   inlineのmargin:0 autoに勝つため!important。PCは中央寄せ維持のため対象外） ── */
@media (max-width: 640px) {
  .profile-employer-edge { margin-left: -6px !important; margin-right: -6px !important; }
}

/* ── 使い方ガイド・利用規約・プライバシー・運営憲章：モバイルで画面端から4pxに詰める
   （main左右12px − 負マージン12px ＋ ラッパーpadding4px ＝ 4px。作法は上と同じ） ── */
@media (max-width: 640px) {
  .help-edge { margin-left: -12px !important; margin-right: -12px !important; }
}

/* 働き手プロフィールも農家プロと同じ.profile-employer-edge(画面端から10px)に統一（2026-07-14） */

/* ── プロフィール画面：雇い手空間への浮遊ボタン（モバイル専用・下部バーの真上に固定） ── */
.profile-employer-fab { display: none; }
@media (max-width: 768px) {
  .profile-employer-fab {
    display: block;
    position: fixed;
    /* 2026-07-14: 中央寄せ→右寄せ。左下の浮遊☰と同列（左=☰／右=トグル・同じ高さ） */
    right: 12px;
    bottom: calc(64px + 12px + env(safe-area-inset-bottom, 0px));
    z-index: 60;
    background: #00A86B;
    color: #fff;
    border: none;
    border-radius: 24px;
    padding: 12px 28px;
    font-size: 15px;
    font-weight: 700;
    font-family: 'Noto Sans JP', sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,.15);
    cursor: pointer;
    white-space: nowrap;
    transition: transform .25s ease;
  }
  /* スクロール連動の自動格納（Part C）。下部バーと同時に沈む。
     沈む量=浮遊位置(バー64px+隙間12px+セーフエリア)+自身の高さ(100%)。
     旧150%では下がりきらず画面内に残りフッターを覆っていた */
  body.cb-dir-down .profile-employer-fab { transform: translateY(calc(100% + 64px + 12px + env(safe-area-inset-bottom, 0px))); }
  /* フッタードック機構は廃止（2026-07-16）：トグルは下部バーと同じスクロール格納のみ。
     表示中の高さは常に☰と同じ（バー64px+12px+セーフエリア） */
}

/* ── Job search layout ── */
.job-search-layout {
  display: block;
}

/* ── Job detail main info card ── */
.job-detail-main-card {
  width: 50%;
  max-width: 440px;
}
@media (max-width: 759px) {
  .job-detail-main-card {
    width: 100%;
    max-width: none;
  }
}

/* ── Job detail key info: 3x2 grid (Airbnb-style label/value cells) ── */
.job-detail-info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
@media (max-width: 759px) {
  .job-detail-info-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 作物選択カード（Airbnb型・ホバーで枠濃く＋浮く） */
.crop-card {
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.crop-card:hover {
  border-color: #B0B0B0;
  box-shadow: 0 6px 16px rgba(0,0,0,0.10);
  transform: translateY(-2px);
}
/* ── Step0 説明ページ: 左右5:5、狭い画面で縦積み ── */
.step0-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  align-items: center;
}
@media (max-width: 759px) {
  .step0-grid {
    grid-template-columns: 1fr;
  }
}

/* ── Review header: profile (subtle) left / rating (hero) center ── */
.review-header-row {
  display: flex;
  align-items: center;
}
.review-header-profile { flex: 1; }
.review-header-stars { flex: 1; text-align: center; }
.review-header-spacer { flex: 1; }
@media (max-width: 759px) {
  .review-header-row {
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .review-header-stars { order: 1; }
  .review-header-profile { order: 2; justify-content: center; }
  .review-header-spacer { display: none; }
}

/* ── Job detail: 2-column layout (left info / right apply panel) ── */
.job-detail-2col {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(300px, 0.8fr);
  gap: 24px;
}
@media (max-width: 759px) {
  .job-detail-2col {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* 応募パネルのsticky追従位置。固定タブバーの直下に16pxの余白を確保 */
.job-apply-panel {
  top: 52px; /* PC: タブバー高さ36px + 余白16px */
}
@media (max-width: 640px) {
  .job-apply-panel {
    top: 73px; /* モバイル: タブバー高さ57px + 余白16px */
  }
}
/* スマホは応募パネル全体を非表示（給与・応募は下部フッターに集約済み） */
@media (max-width: 759px) {
  .job-apply-panel {
    display: none;
  }
}

/* ── 応募パネルが画面外に出た時のPC専用下固定バー（スマホは既存の縦積み導線のため非表示） ── */
.pc-apply-bar {
  display: flex;
}
@media (max-width: 759px) {
  .pc-apply-bar {
    display: none;
  }
}

/* ── 開催期間カレンダー（地図の下）：全デバイスで表示（2026-07-16・スマホ非表示を解除） ── */
.calendar-below-map {
  display: block;
}

/* ── 求人詳細（スマホ専用）：下部応募フッター。応募ボタンは常時見せる（格納対象外） ── */
.mobile-apply-bar {
  display: none;
}
@media (max-width: 759px) {
  .mobile-apply-bar {
    display: flex;
    flex-direction: column;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    z-index: 500;
    background: #fff;
    border-top: 1px solid #EBEBEB;
    padding: 14px 16px 18px;
    align-items: stretch;
    justify-content: flex-start;
    gap: 4px;
  }
  /* 求人詳細ページでは下部タブバーを完全非表示にし、下部応募フッターと二重に重ならないようにする
     （両方ともbottom:0のため。2026-07-14: タブバーのtop→bottom移設で新たに必要になったガード） */
  body:has(.mobile-apply-bar) .bottom-tab-bar { display: none; }
  /* 統合後の下部バー(.app-header-mobile)も同様に、求人詳細ページでは応募フッターと
     二重にbottom:0で重ならないよう非表示にする（旧.bottom-tab-bar用ガードと同じ作法）。
     このdisplay:noneはスクロール連動の格納機構(下記cb-scroll-hide)より優先される。 */
  body:has(.mobile-apply-bar) .app-header-mobile { display: none; }
  /* チャット表示中は下部バー・浮遊☰を隠す（2026-07-22・LINE式＝チャットに集中）。
     ChatViewのルート .chat-full を目印に、詳細ページと同じ body:has() 方式で非表示にする */
  body:has(.chat-full) .app-header-mobile,
  body:has(.chat-full) .app-header-mobile-float { display: none !important; }
}
/* チャット表示中：フッター（サポート等）も隠し、ページ側のスクロールを止めて
   チャットのスクロールと画面のスクロールを1本に統一する（2026-07-22） */
body:has(.chat-full) .site-footer-fixed { display: none !important; }
/* ページ側（html/body/main）を動かさない＝スクロールはチャットのメッセージ欄だけに統一。
   スクロールはhtml(documentElement)で起きるため、bodyだけでなくhtmlも止める（2026-07-22 再修正） */
html:has(.chat-full), body:has(.chat-full) { overflow: hidden; height: 100%; overscroll-behavior: none; }
body:has(.chat-full) main { overflow: hidden !important; }

/* 面接の質問集：フルページ表示（下部ナビ・浮遊☰・フッターを隠す＝チャットと同方式・2026-07-23） */
.qset-full { position: fixed; inset: 0; z-index: 9000; background: #fff; display: flex; flex-direction: column; }
body:has(.qset-full) .app-header-mobile,
body:has(.qset-full) .app-header-mobile-float,
body:has(.qset-full) .profile-employer-fab,
body:has(.qset-full) .nav-coach { display: none !important; }
body:has(.qset-full) .site-footer-fixed { display: none !important; }
html:has(.qset-full), body:has(.qset-full) { overflow: hidden; height: 100%; overscroll-behavior: none; }

/* 働き手／雇い手プレビュー表示中：ページ側スクロールを止め、スクロールをプレビュー内に統一（2026-07-23） */
html:has(.cb-preview-overlay), body:has(.cb-preview-overlay) { overflow: hidden; height: 100%; overscroll-behavior: none; }

/* QRコード印刷（#/qr・2026-07-24）：印刷時はQRエリアだけをA4中央に。サイト名・ひとことは印刷時のみ表示 */
.qr-print-only { display: none; }
@media print {
  body * { visibility: hidden; }
  .qr-print-area, .qr-print-area * { visibility: visible; }
  .qr-print-area { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 0; }
  .qr-noprint { display: none !important; }
  .qr-print-only { display: block !important; }
}

/* 開催期間カレンダー📅の浮遊ボタン（.calendar-fab*）は削除（2026-07-24・誰も展開しないため） */

/* ── 求人詳細：←戻る／♡いいねの浮遊固定（同じ高さ・スクロール追従・2026-07-16） ── */
.job-float-back, .job-float-like {
  position: fixed;
  top: calc(12px + env(safe-area-inset-top, 0px));
  z-index: 550;
}
.job-float-back { left: 12px; }
.job-float-like { right: 12px; }
@media (min-width: 769px) {
  .job-float-back, .job-float-like { top: 76px; } /* PCは上部ヘッダーの下 */
}

/* ── 求人詳細（スマホ専用）：上部タブバー直下・末尾の余白を詰める ── */
@media (max-width: 759px) {
  .job-detail-back-btn { margin-bottom: 8px !important; }
  .job-detail-more-jobs { margin-bottom: 4px !important; }
}

/* ── 求人詳細（スマホ専用）：本文末尾に下部応募フッター分の余白を確保（隠れ防止） ── */
@media (max-width: 759px) {
  /* 2026-07-16: 末尾（この求人を報告する）と下部応募フッターの間を約20pxに（応募フッター約90px+20px） */
  .job-detail-body-mobile { padding-bottom: calc(110px + env(safe-area-inset-bottom, 0px)); }
}

/* ── Profile 2カラム（PC）／横タブ（モバイル・従来どおり） ── */
.profile-grid {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-areas: "tabs content" "card content";
  gap: 32px;
  align-items: start;
}
.profile-tabs {
  grid-area: tabs;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.profile-tab-btn {
  text-align: left;
  padding: 10px 16px;
  border-radius: 20px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 400;
  color: #717171;
}
.profile-tab-btn.active {
  background: #F7F7F7;
  color: #222;
  font-weight: 700;
}
.profile-sidecard { grid-area: card; }
.profile-content { grid-area: content; min-width: 0; }
@media (max-width: 768px) {
  .profile-grid { display: block !important; }
  .profile-tabs {
    flex-direction: row;
    gap: 8px;
    margin-bottom: 16px;
    border-bottom: 1px solid #EEE;
    flex-wrap: wrap;
  }
  .profile-tab-btn {
    padding: 8px 4px;
    margin-bottom: -1px;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    font-size: 13px;
  }
  .profile-tab-btn.active {
    background: none;
    border-bottom: 2px solid #00A86B;
  }
  .profile-sidecard { margin-top: 24px; }
}

/* ── LandingFlow Step6 grid ── */
.lf-map-hero { height: 360px; }
.lf-preview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(300px, 0.8fr);
  gap: 24px;
  align-items: start;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
}
@media (max-width: 800px) {
  .lf-map-hero { height: 240px; }
  .lf-preview-grid { grid-template-columns: 1fr; }
}

/* ── Fixed footer ── */
.site-footer-fixed {
  position: static;
  background: #FFFFFF;
  border-top: 1px solid #EBEBEB;
  padding: 20px 24px;
  text-align: center;
  margin-top: 40px;
}
.site-footer-fixed .footer-inner {
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.site-footer-fixed .footer-copy {
  font-size: 11px;
  color: #B0B0B0;
}
.site-footer-fixed .footer-links {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.site-footer-fixed .footer-note {
  width: 100%;
  font-size: 10px;
  color: #B0B0B0;
  line-height: 1.6;
}
/* ── Airbnb型3列フッター ── */
.footer-columns {
  max-width: 1120px;
  margin: 0 auto 20px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  text-align: left;
  padding-bottom: 24px;
  border-bottom: 1px solid #EBEBEB;
}
.footer-col-title {
  font-size: 12px;
  font-weight: 700;
  color: #222;
  margin: 0 0 12px;
  letter-spacing: .04em;
}
.footer-col-link {
  display: block;
  width: 100%;
  font-size: 12px;
  color: #717171;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px 0;
  text-align: left;
  text-decoration: none;
  font-family: inherit;
}
.footer-col-link:hover {
  color: #222;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.footer-bottom {
  max-width: 1120px;
  margin: 0 auto;
  text-align: center;
}
@media (max-width: 640px) {
  /* 2026-07-14: 縦1列(1行1リンク)は長すぎるため、各セクション内のリンクを横並び(中央寄せ・折り返し)に */
  .footer-columns {
    grid-template-columns: 1fr;
    gap: 18px;
    text-align: center;
  }
  .footer-col-title {
    margin-bottom: 6px;
  }
  .footer-col-link {
    display: inline-block;
    width: auto;
    padding: 4px 9px;
    text-align: center;
  }
}
@media (min-width: 641px) {
  main {
    padding-top: 72px !important;
    padding-bottom: 24px !important;
  }
}
@media (max-width: 640px) {
  .site-footer-fixed {
    padding: 14px 10px;
  }
  .site-footer-fixed .footer-inner {
    justify-content: center;
    gap: 4px 10px;
  }
  .site-footer-fixed .footer-copy {
    font-size: 10px;
  }
  .site-footer-fixed .footer-links {
    gap: 12px;
  }
  .site-footer-fixed .footer-links button {
    font-size: 9px;
  }
  .site-footer-fixed .footer-note {
    font-size: 9px;
    margin: 2px 0 0;
    line-height: 1.4;
  }
  main {
    padding-top: 68px !important;
    padding-bottom: 24px !important;
  }
}

/* ── Input ── */
/* iOS自動ズーム防止（2026-07-16・第1段）：フォント16px未満の入力欄にフォーカスすると
   Safariが勝手にズームするため、モバイルでは全入力を16pxへ底上げ（inlineの13〜14px指定を!importantで上書き） */
@media (max-width: 768px) {
  input, textarea, select { font-size: 16px !important; }
}

.field {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid #EBEBEB;
  border-radius: 12px;
  font-size: 14px;
  color: #222222;
  background: #FFFFFF;
  transition: border-color .2s, box-shadow .2s;
}
.field:focus {
  border-color: #00A86B;
  box-shadow: 0 0 0 3px #00A86B18;
}
.field::placeholder { color: #B0B0B0; }

/* ── Mobile responsive ── */
@media (max-width: 640px) {
  .hero-row { flex-direction: column !important; }
  .hero-cta { flex-direction: column !important; }
  .hero-cta button { width: 100% !important; }
  .how-to-grid { flex-direction: column !important; }
  .farmer-3cols { grid-template-columns: 1fr !important; }
}

/* ── Buttons ── */
.btn-primary, .btn-dark {
  background: var(--mode-accent, #00A86B);
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 13px 24px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .02em;
}
.btn-primary:hover, .btn-dark:hover { filter: brightness(0.92); }
.btn-primary:active, .btn-dark:active { filter: brightness(0.85); }
.btn-primary:disabled, .btn-dark:disabled { opacity: .35; cursor: not-allowed; transform: none; }

.btn-outline {
  background: transparent;
  color: #222222;
  border: 1px solid #222222;
  border-radius: 12px;
  padding: 12px 20px;
  font-size: 13px;
  font-weight: 500;
}
.btn-outline:hover { background: #F7F7F7; }

.btn-gold {
  background: #F5A623;
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 13px 24px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .02em;
}
.btn-gold:hover { background: #F7B84B; }
.btn-gold:disabled { background: #EBEBEB; color: #B0B0B0; cursor: not-allowed; transform: none; }

/* ── Label ── */
.lbl {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: #717171;
  margin-bottom: 7px;
}

/* ── Rule with text ── */
.rule-text {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #B0B0B0;
  font-size: 10px;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.rule-text::before, .rule-text::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #EBEBEB;
}

/* ── Tag ── */
.tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
}

/* 今日ページ：役割スワイプ切替のスライドイン（2026-07-25）。右から=cbSlideInR／左から=cbSlideInL */
@keyframes cbSlideInR { from { transform: translateX(64px); opacity: .35; } to { transform: none; opacity: 1; } }
@keyframes cbSlideInL { from { transform: translateX(-64px); opacity: .35; } to { transform: none; opacity: 1; } }
`;
