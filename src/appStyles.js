// アプリ全体のCSS（分割・段階1・2026-07-24）：App.jsxの<style>{CSS}</style>で注入される単一文字列。
// 純粋な静的CSS（テンプレート補間なし）。編集ルールは従来どおり＝クラスを足す/直すだけ。
export const CSS = `
/* Webフォントの読み込みは index.html の <link> へ移設（2026-07-27）。
   ここに@importを置くと、JSの読み込み→CSS注入まで font の取得が始まらず、初回表示が遅れる。
   併せて使っていない太さ（Noto 300 / Inter 300,500 / DM Mono italic）を削り、取得量を減らした */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; background: #fff; overflow-x: clip; }
body { background: #fff; overflow-x: clip; }

::-webkit-scrollbar { width: 2px; height: 2px; }
::-webkit-scrollbar-thumb { background: #EBEBEB; border-radius: 1px; }
::-webkit-scrollbar-track { background: transparent; }

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

/* fillは backwards（2026-07-27修理・bothにしない）：bothだとアニメ終了後も transform が残り、
   この要素が「画面固定(position:fixed)の基準」になる。すると中で開いたボックスが要素の箱に
   閉じ込められ、スクロールに追従しない・外タップの当たり判定がずれる。見え方は同じ */
.appear      { animation: appear .5s cubic-bezier(.22,.8,.36,1) backwards; }
.fade-in     { animation: fadeIn .35s ease both; }
/* 求人フローのstep遷移（2026-07-14）：次へ=左へフェードアウト→右からフェードイン／戻る=その逆。
   transformはfixedな子(モーダル等)の基準を壊すため、入場完了後にonAnimationEndでクラスを外す */
@keyframes stepOutLeft  { from { opacity:1; transform:translateX(0); }      to { opacity:0; transform:translateX(-120px); } }
@keyframes stepInRight  { from { opacity:0; transform:translateX(120px); }  to { opacity:1; transform:translateX(0); } }
@keyframes stepOutRight { from { opacity:1; transform:translateX(0); }      to { opacity:0; transform:translateX(120px); } }
@keyframes stepInLeft   { from { opacity:0; transform:translateX(-120px); } to { opacity:1; transform:translateX(0); } }
/* 求人プレビューのポップアップ（縮小→等倍・軽いオーバーシュートで弾む）。フェード(opacity)なし。
   fill無し=終了後にtransformが外れ、内部のfixed要素(ライトボックス等)の基準を壊さない */
/* ── カレンダーの展開（2026-07-27たきと指示）：順番は【①横 →（伸び切ってから）② 縦】。
   ① 〈○○年○○月〉の帯が中央から左右へ伸びる（scaleX 0→1・0.34秒）。この間、盤面は畳まれているので
      画面には月の見出しの箱だけが横に開いて見える。
   ② 伸び切った後（0.34秒後）に、その月のカレンダーが下へ伸びる（grid-template-rows 0fr→1fr）。
   高さは中身の実寸を測らずにautoへ animate できる技法。効かない環境でもフェードは効くso「出ない」事故はなし ── */
@keyframes cbCalSweep { from { transform: scaleX(.08); opacity: 0; } 60% { opacity: 1; } to { transform: scaleX(1); opacity: 1; } }
/* fillは backwards（2026-07-27修理・both禁止）：bothだと終わった後もtransformが残り、
   この要素が「画面固定(fixed)の基準」になってしまう。すると中で開くボックス
   （下書きを進めませんか？等）がカレンダーの箱の中に閉じ込められ、求人カードの下へ潜る。
   backwardsなら見え方は同じまま、終了後にtransformが外れて基準が画面に戻る */
.cb-cal-reveal { animation: cbCalSweep .34s cubic-bezier(.22, .8, .36, 1) backwards; transform-origin: center center; }
/* ②縦に開く部分（見出しより下の中身）。①が終わる0.34秒後から動き出す */
@keyframes cbCalUnfold { from { grid-template-rows: 0fr; opacity: 0; } to { grid-template-rows: 1fr; opacity: 1; } }
.cb-cal-body-wrap { display: grid; grid-template-rows: 1fr; animation: cbCalUnfold .42s cubic-bezier(.22, .8, .36, 1) .34s backwards; }
.cb-cal-body-wrap > * { min-height: 0; overflow: hidden; }
/* 見出しの文字は帯が伸びる間に薄く入る（帯だけが先に見える） */
@keyframes cbCalHead { from { opacity: 0; } to { opacity: 1; } }
.cb-cal-head { animation: cbCalHead .3s ease .1s both; }
/* ── 閉じる時は開く時の逆順（2026-07-29たきと指示）：【①縦に畳む →（畳み切ってから）②横に縮む】。
   .cb-cal-closing が付いている間だけ有効。付け外しは各ページ（応募者・ステータス）が
   「畳むアニメが終わってから要素を外す」形で面倒を見る（外すのが早いとアニメが見えない） ── */
@keyframes cbCalFoldUp { from { grid-template-rows: 1fr; opacity: 1; } to { grid-template-rows: 0fr; opacity: 0; } }
@keyframes cbCalShrink { from { transform: scaleX(1); opacity: 1; } to { transform: scaleX(.08); opacity: 0; } }
/* ①中身（見出しより下）が上へ畳まれる。指定の勝負に勝つため .cb-cal-reveal 側から辿って書く */
.cb-cal-reveal.cb-cal-closing .cb-cal-body-wrap { animation: cbCalFoldUp .34s cubic-bezier(.4, 0, .7, .2) both; }
/* ②畳み切った0.34秒後に、残った〈○○年○○月〉の帯が中央へ縮む */
.cb-cal-reveal.cb-cal-closing { animation: cbCalShrink .3s cubic-bezier(.4, 0, .7, .2) .34s both; }
@media (prefers-reduced-motion: reduce) {
  .cb-cal-reveal, .cb-cal-head, .cb-cal-body-wrap,
  .cb-cal-reveal.cb-cal-closing, .cb-cal-reveal.cb-cal-closing .cb-cal-body-wrap { animation: none; }
}
@keyframes cbPop { from { transform: scale(.85); } to { transform: scale(1); } }
/* 出現アニメ中はタップを受け付けない（2026-07-27・日程チップの誤タップ修理）。
   0.85→1へ弾みながら拡大する間は中身が動いているため、狙った位置と実際に当たる要素がずれる。
   step-endのgateで終了の瞬間にauto（既定値）へ戻す＝アニメ後は通常どおり押せる */
@keyframes cbPopGate { from { pointer-events: none; } to { pointer-events: auto; } }
.cb-sheet-up { animation: cbPop .8s cubic-bezier(.2, 1.3, .3, 1), cbPopGate .8s step-end; transform-origin: center center; }
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
/* 読み込み中の「…」を1つずつ跳ねさせる（2026-07-30たきと指示・遊び心）。
   待ち時間そのものは変わらないが、止まっていないことが目で分かる。
   3つの点に0.16秒ずつ遅れを付けて左から順に跳ねる（波の走破後に少し休んでループ） */
@keyframes cbDotJump {
  0%, 44%, 100% { transform: translateY(0); }
  22%           { transform: translateY(-0.32em); }
}
.cb-dots > span {
  display: inline-block;
  animation: cbDotJump 1.4s ease-in-out infinite;
}
.cb-dots > span:nth-child(2) { animation-delay: .16s; }
.cb-dots > span:nth-child(3) { animation-delay: .32s; }
@media (prefers-reduced-motion: reduce) {
  .cb-dots > span { animation: none; }
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
.step-in-right  { animation: stepInRight  .4s ease backwards; } /* 入場は終了後にtransformを残さない（上記と同じ理由） */
.step-out-right { animation: stepOutRight .4s ease both; }
.step-in-left   { animation: stepInLeft   .4s ease backwards; }
/* プロフィール両面(働き手⇄農家プロ)の切替フェード（2026-07-14・opacityのみ=fixed子要素に安全） */
@keyframes fadeOut { from { opacity:1; } to { opacity:0; } }
/* 農家⇄働き手プロフィール切替の反転（カードフリップ・合計0.8秒）。
   outはforwardsで90度に固定→面切替→inで-90度から戻る。transformはfixed子の基準を壊すため
   入場完了後にonAnimationEndでクラスを外す（step同様） */
@keyframes pflipOut { from { transform: perspective(1200px) rotateY(0deg); opacity:1; } to { transform: perspective(1200px) rotateY(90deg); opacity:.6; } }
@keyframes pflipIn  { from { transform: perspective(1200px) rotateY(-90deg); opacity:.6; } to { transform: perspective(1200px) rotateY(0deg); opacity:1; } }
.pflip-out { animation: pflipOut .4s ease-in both; }
.pflip-in  { animation: pflipIn .4s ease-out; }
.pulse-slow  { animation: pulse 2s ease infinite; }
/* いま これだけ（今日ページの最優先カード・2026-08-06）：呼吸のような脈動＝
   動くものだけが見える、の原則。opacity点滅(pulse)は情報が消えて見えるso使わない */
@keyframes cbNowPulse {
  0%,100% { transform: scale(1);     box-shadow: 0 2px 10px rgba(0,0,0,.08); }
  50%     { transform: scale(1.015); box-shadow: 0 8px 24px rgba(0,0,0,.16); }
}
.cb-now-pulse { animation: cbNowPulse 2.2s ease-in-out infinite; }
.shake       { animation: shake .4s ease; }


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
  /* 上余白に safe-area を足す（2026-07-31・ステータスバーblack-translucent化に伴い、時計の下に文字が潜らないように） */
  main { padding: calc(10px + env(safe-area-inset-top, 0px)) 12px calc(90px + env(safe-area-inset-bottom, 0px)) !important; }
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
  /* ログイン画面だけは例外＝下部バーを常に出す（2026-07-27たきと指示）。
     メール欄のautoFocusでキーボードが出た瞬間にcb-typingが付き、訪問者の
     「さがす・入れ方・登録ログイン」バーが消えて戻り道を失っていた */
  body:has(.cb-login-page).cb-typing .app-header-mobile { display: block !important; }
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
/* 応募者ページの絞り込み：浮遊バーはモバイル専用（PCは本文中の並びを使う・2026-07-27） */
.cb-applicant-filter-bar { display: none; }

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
  /* 運営チャットの浮遊ボックス（2026-07-25）：☰浮遊ボタンと同じ作法でスクロール中は下へ格納 */
  .cb-admin-chat-fab { transform: translate3d(0, 0, 0); will-change: transform; transition: transform .25s ease; }
  body.cb-scroll-hide .cb-admin-chat-fab { transform: translate3d(0, calc(100% + 64px + 12px + env(safe-area-inset-bottom, 0px)), 0); }
  /* 求人詳細（応募フッターあり）では下部バーと同様に非表示（既存ガードと整合） */
  body:has(.mobile-apply-bar) .app-header-mobile-float { display: none; }
  /* 応募者ページの絞り込みバー（2026-07-27たきと指示）：下部バーの真上に浮かせ、
     スクロール格納・入力中の退避・オーバーレイ中の非表示を☰浮遊ボタンと完全に同じ作法で揃える */
  .cb-applicant-filter-bar {
    position: fixed;
    /* さがすの検索バー(.cb-search-fab)と同じ形式に統一（2026-07-27たきと指示）：
       ☰(left:12px・幅44px)と同じ高さで、その右隣から始める */
    bottom: calc(64px + 12px + env(safe-area-inset-bottom, 0px));
    left: calc(12px + 44px + 10px); right: 12px;
    z-index: 60;
    display: flex; gap: 6px; align-items: center;
    /* 高さは検索バー(.cb-search-fab)と同値にする（2026-07-27たきと指示）。
       検索バー＝上下padding11px＋2行(14px+2+11px)＋枠1px×2 ≒ 56px。
       絞り込みは1行so自然高さが低い＝min-heightで合わせる。下端(bottom)は変えないため上へ伸びる */
    min-height: 56px;
    padding: 6px 10px;
    background: #fff;
    border: 1px solid #DDD; border-radius: 32px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.18);
    overflow-x: auto; -webkit-overflow-scrolling: touch;
    transform: translate3d(0, 0, 0);
    will-change: transform;
    transition: transform .25s ease;
  }
  .cb-applicant-filter-bar::-webkit-scrollbar { display: none; }
  /* 管理画面の共通ナビ（AdminNav）：チップ列のスクロールバーは隠す（横スワイプは生きる） */
  .admin-nav { scrollbar-width: none; }
  .admin-nav::-webkit-scrollbar { display: none; }
  /* モバイルは浮遊バーだけを見せる（本文中の並びは重複so隠す） */
  .cb-applicant-filter-inline { display: none !important; }
  body.cb-scroll-hide .cb-applicant-filter-bar { transform: translate3d(0, calc(100% + 64px + 12px + env(safe-area-inset-bottom, 0px)), 0); }
  body.cb-typing .cb-applicant-filter-bar { display: none !important; }
  /* 応募者ページのスワイプ追従（2026-07-27たきと指示）：指の動きに合わせて求人カードだけが
     同じ方向へズレる（カレンダー・タブ・凡例は動かさない＝動かす対象を絞ると意図が伝わる）。
     ズレ幅は親グリッドの--cb-swipe-dxをJSが直書き。指を離す/発火時は0に戻り、.cb-swipingが
     外れてtransitionで滑らかに戻る */
  /* ズレ自体はJSがカードのインラインstyleへ直接書く（CSS変数方式はカード側のインライン指定に
     負けて効かなかった）。ここは案内文の点灯だけを担う */
  /* 指を動かしている間は案内文（横スワイプでカレンダーを開く）を緑の太字にして、
     いま何が起きようとしているかを目で分からせる */
  .cb-cal-hint { transition: color .15s ease; }
  .cb-swiping .cb-cal-hint { color: #00A86B !important; font-weight: 700; }
  body:has(.mobile-apply-bar) .cb-applicant-filter-bar { display: none; }
  body:has(.chat-full) .cb-applicant-filter-bar,
  body:has(.cb-preview-overlay) .cb-applicant-filter-bar,
  body:has(.cb-lock-scroll) .cb-applicant-filter-bar { display: none !important; }
}
/* さがすの検索ピル（2026-07-27）：下部バー直上の浮遊配置（上は遠い・たきと指示）。
   スクロール格納は他のFABと同じcb-scroll-hide 1本 */
.cb-search-fab {
  position: fixed;
  left: 16px; right: 16px;
  bottom: calc(64px + 12px + env(safe-area-inset-bottom, 0px));
  z-index: 60;
  margin: 0 auto;
  max-width: 420px;
  transform: translate3d(0, 0, 0);
  will-change: transform;
  transition: transform .25s ease;
}
body.cb-scroll-hide .cb-search-fab { transform: translate3d(0, calc(100% + 64px + 12px + env(safe-area-inset-bottom, 0px)), 0); }
/* モバイルは左下の☰（left:12px・幅44px）と同じ高さso、☰の右隣から始めて重複を避ける（2026-07-27） */
@media (max-width: 768px) {
  .cb-search-fab { left: calc(12px + 44px + 10px); right: 12px; margin: 0; max-width: none; }
}
/* PCは下部バーも☰も無いので画面下端の中央寄せ */
@media (min-width: 769px) { .cb-search-fab { bottom: 24px; } }
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
  /* 2026-07-27: 8px→32px。☰(44px)より背の高い検索ピル(.cb-search-fab・約62px)が同じ高さに並ぶため、
     8pxではメニューの右下と重なっていた（たきと報告）。ピルの上端を越える位置まで持ち上げる */
  margin-bottom: 32px; margin-top: 0;
  left: 0; right: auto;
  min-width: 220px;
  max-height: calc(100vh - 204px);
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
     旧150%では下がりきらず画面内に残りフッターを覆っていた。
     2026-07-27: トリガーをcb-dir-down→cb-scroll-hideに統一（バー・☰・運営チャットFABと同じ）。
     方向のみのcb-dir-downは最下部の強制格納とバウンス吸収帯が無く、フッターでトグルだけ復活して被さる・
     ☰と出入りがズレる不整合の原因だった */
  body.cb-scroll-hide .profile-employer-fab { transform: translateY(calc(100% + 64px + 12px + env(safe-area-inset-bottom, 0px))); }
  /* フッタードック機構は廃止（2026-07-16）：トグルは下部バーと同じスクロール格納のみ。
     表示中の高さは常に☰と同じ（バー64px+12px+セーフエリア） */
}

/* ── Job search layout ── */
.job-search-layout {
  display: block;
}

/* ── Job detail main info card ── */
@media (max-width: 759px) {
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

/* ── 求人詳細（スマホ専用）：下部応募フッター。スクロール中は常時表示（cb-scroll-hide対象外）。
   ただし最下部から50px以内（body.cb-at-bottom・App.jsxのスクロールハンドラが付与）では
   下へ格納し、フッター（サポート等）が読めるようにする（2026-07-25たきと指示） ── */
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
    transition: transform 0.25s ease;
  }
  body.cb-at-bottom .mobile-apply-bar { transform: translateY(105%); }
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
  /* プレビューボックス展開中も下部バー・浮遊☰を隠す（2026-07-26たきと指示）＝ボックスに集中。
     オーバーレイ(z-index 9000〜)の下に残る低z-index要素が暗幕越しに透けるのを止める。
     対象＝働き手/雇い手プレビュー(.cb-preview-overlay)とスクロール固定ボックス(.cb-lock-scroll) */
  /* 役割切替の浮遊トグル（.profile-employer-fab）も一緒に隠す（2026-07-29たきと指示）：
     また呼びたいリストの詳細など、プロフィール入口の上でボックスを開くとトグルが暗幕の上に残り、
     ボックスのボタンと重なって見えていた。ボックス表示中は操作を1つに絞る */
  body:has(.cb-preview-overlay) .app-header-mobile,
  body:has(.cb-preview-overlay) .app-header-mobile-float,
  body:has(.cb-preview-overlay) .profile-employer-fab,
  body:has(.cb-lock-scroll) .app-header-mobile,
  body:has(.cb-lock-scroll) .app-header-mobile-float,
  body:has(.cb-lock-scroll) .profile-employer-fab,
  body:has(.cb-box-overlay) .profile-employer-fab { display: none !important; }
  /* 訪問者の玄関（#/visit）では浮遊☰も下部バーも出さない（2026-07-27たきと指示）。
     ☰の中身は会員向けの操作＝同意前の訪問者には要らない。下部バーの「入れ方」も、
     同意ゲート（未同意は玄関へ戻る）に弾かれて読めないため、案内は玄関の最下部に直接置いた */
  body:has(.cb-visit-page) .app-header-mobile,
  body:has(.cb-visit-page) .app-header-mobile-float { display: none !important; }
  /* 経験・資格ページ（#/experience）：下部バー・浮遊☰を出さない（2026-08-03たきと指示・入力に集中） */
  body:has(.cb-exp-page) .app-header-mobile,
  body:has(.cb-exp-page) .app-header-mobile-float { display: none !important; }
  /* 保険の準備ページ（#/insurance）：浮遊☰・下部バーを出さない（2026-08-03たきと指示。サイトフッターも既存ルールで非表示） */
  body:has(.ins-prep-page) .app-header-mobile,
  body:has(.ins-prep-page) .app-header-mobile-float { display: none !important; }
  /* 管理画面で操作するページ（#/admin・/admin/working・/admin/upcoming・/admin/evaluation・#/boxes）
     で隠すのは【サイトフッターだけ】（2026-08-05たきと指示・下記のメディアクエリ外に1行）。
     下部バー（.app-header-mobile）と浮遊☰（.app-header-mobile-float）は出す＝管理画面から出る道を残す。
     目印 .cb-admin-page は各管理ページのルートに付ける＝ページを増やしたらクラスを1つ足すだけ。
     委託ページ（.cb-consign-page）は別世界観so従来どおり下部バー・☰・フッターを全部隠す（下記） */
  /* 委託ページ（#/admin/consignment）は別世界観（2026-07-31たきと指示）：
     下部バー・浮遊☰を出さない。B2B委託レーンは運営の内部道具であって、
     さがす/しごと/プロフィールの3タブ世界とは別物＝その案内を持ち込まない */
  body:has(.cb-consign-page) .app-header-mobile,
  body:has(.cb-consign-page) .app-header-mobile-float { display: none !important; }
  /* 下部バーが消えたぶんの余白（バー高ぶん）を詰める */
  body:has(.cb-consign-page) main { padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px)) !important; }
}
/* 委託ページ：ヘッダー（PC上部）とフッターも隠す＝画面には委託の道具だけを残す。
   ヘッダーぶんの上余白（main の padding-top 68/72px）も一緒に詰める */
body:has(.cb-consign-page) .app-header-desktop,
body:has(.cb-consign-page) .site-footer-fixed { display: none !important; }
body:has(.cb-consign-page) main { padding-top: 0 !important; }
/* ── 委託ページの入場演出（2026-07-31たきと指示・ポケモンバトル風）──
   黒幕の中央に白い線が走り→草の群れが右→左→右の順に下から上へ現れ→幕が上下に割れて
   フィールド（ページ）が展開する。モノクロ厳守（草も白のシルエット）。
   全要素 pointer-events:none＝演出中も操作を妨げない。
   構造：.consign-entrance（固定・全画面）＝上幕＋下幕。線は下幕の上辺（＝継ぎ目）、
   草の群れは各幕の中に取り付けてあるため、幕が開くと群れごと滑って退場する（片付け不要） */
.consign-entrance { position: fixed; inset: 0; z-index: 9600; pointer-events: none; overflow: hidden; }
.consign-entrance-top, .consign-entrance-bottom { position: absolute; left: 0; right: 0; height: 50%; background: #111; }
.consign-entrance-top { top: 0; animation: consignOpenTop .5s cubic-bezier(.75,0,.25,1) 1.75s forwards; }
.consign-entrance-bottom { bottom: 0; animation: consignOpenBottom .5s cubic-bezier(.75,0,.25,1) 1.75s forwards; }
@keyframes consignOpenTop { to { transform: translateY(-102%); } }
@keyframes consignOpenBottom { to { transform: translateY(102%); } }
/* 白い線：中央から左右へ走る（バトル開始の合図） */
.consign-entrance-line { position: absolute; top: -1px; left: 0; right: 0; height: 2px; background: #fff;
  transform: scaleX(0); animation: consignLine .22s ease-out forwards; }
@keyframes consignLine { to { transform: scaleX(1); } }
/* 草の群れ：枝葉のシルエット（SVG・白）。形はJSX側（CONSIGN_SPRIGS）、位置と時間差もJSXのインラインstyle。
   帯は横いっぱい（left:0 right:0）＋株は帯の中に絶対配置＝根元を右端/左端の側に限定して右左を分ける */
.consign-entrance-cluster { position: absolute; left: 0; right: 0; height: 0; }
.consign-entrance-cluster svg { display: block; overflow: visible;
  transform: scaleY(0); transform-origin: bottom;
  animation: consignGrass .34s cubic-bezier(.2,.9,.3,1.3) forwards; }
@keyframes consignGrass { to { transform: scaleY(1); } }
/* 白い太陽が爛々と輝く（2026-07-31たきと指示・2026-08-03から花火とランダムで交互に出る）。
   円盤＋光条＋光輪(glow)。上幕(consign-entrance-top)の中に絶対配置＝幕が開くと太陽ごと退場。
   base=scale(0)＋forwards＝草と同じく animation-delay の間は縮んだまま待つ（delayはインライン）。
   爛々の実体：光輪が脈打ち(1.4s)・光条がゆっくり回り(18s)・円盤が微かに脈動する重ね合わせ */
.consign-sun { position: absolute; transform: scale(0); transform-origin: center;
  animation: consignSunRise .55s cubic-bezier(.2,.9,.3,1.4) forwards; }
@keyframes consignSunRise { to { transform: scale(1); } }
.consign-sun > * { position: absolute; inset: 0; }
.consign-sun svg { overflow: visible; }
.consign-sun-glow { border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,255,255,.5) 34%, rgba(255,255,255,0) 70%);
  animation: consignSunGlow 1.4s ease-in-out infinite; }
@keyframes consignSunGlow { 0%,100% { transform: scale(.9); opacity: .7; } 50% { transform: scale(1.14); opacity: 1; } }
.consign-sun-rays { animation: consignSunSpin 18s linear infinite; }
@keyframes consignSunSpin { to { transform: rotate(360deg); } }
.consign-sun-disc { animation: consignSunPulse 1.4s ease-in-out infinite; }
@keyframes consignSunPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.07); } }
/* 花火（2026-08-03たきと指示「太陽の代わりに花火を打ち上げる・5〜7発」。旧＝白い太陽を差し替え）。
   1発＝尾が昇る→閃光→光条と粒が開いて消える。上幕(consign-entrance-top)の中に絶対配置＝
   幕が開くと花火ごと退場する（草と同じ片付け不要の仕組み）。位置・大きさ・玉数・間合いはJSXのインライン。
   基準点(.consign-fw)は炸裂点＝大きさ0の点。子は translate(-50%,-50%) でその点に中心を合わせる */
.consign-fw { position: absolute; width: 0; height: 0; }
/* 打ち上げの尾：炸裂点の下 --rise px から昇り、着いた瞬間に消える */
.consign-fw-trail { position: absolute; left: -1.6px; bottom: 0; width: 3.2px; height: 30px; border-radius: 2px;
  background: linear-gradient(to top, rgba(255,255,255,0), #fff);
  transform: translateY(var(--rise, 180px)); opacity: 0;
  animation: consignFwRise var(--rise-dur, .45s) cubic-bezier(.15,.6,.4,1) forwards; }
@keyframes consignFwRise {
  0%   { transform: translateY(var(--rise, 180px)); opacity: 0; }
  14%  { opacity: 1; }
  86%  { opacity: 1; }
  100% { transform: translateY(0); opacity: 0; }
}
/* 芯の閃光：炸裂の瞬間だけ強く光る */
.consign-fw-flash { position: absolute; border-radius: 50%; opacity: 0;
  transform: translate(-50%, -50%) scale(.1);
  background: radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,255,255,.4) 38%, rgba(255,255,255,0) 70%);
  animation: consignFwFlash .5s ease-out forwards; }
@keyframes consignFwFlash {
  0%   { transform: translate(-50%,-50%) scale(.1); opacity: 1; }
  100% { transform: translate(-50%,-50%) scale(1.7); opacity: 0; }
}
/* 炸裂：光条と粒が開ききって消える（開くほど減速＝火薬が失速する感じ） */
.consign-fw-burst { position: absolute; opacity: 0; transform: translate(-50%, -50%) scale(0);
  animation: consignFwBurst .9s cubic-bezier(.12,.75,.3,1) forwards; }
.consign-fw-burst svg { display: block; overflow: visible; }
@keyframes consignFwBurst {
  0%   { transform: translate(-50%,-50%) scale(0);   opacity: 0; }
  10%  { opacity: 1; }
  55%  { opacity: .95; }
  100% { transform: translate(-50%,-50%) scale(1.08); opacity: 0; }
}
/* ── 委託ページの背景環境（2026-07-31たきと指示）：上端から垂れ下がる黒い草の蔓 ──
   z-index:-1＝ページ内容・白いカードの下に敷かれ、余白にだけ見える。操作は一切妨げない。
   揺れは上端（吊り元）を軸にゆっくり・周期は1本ずつJSXで変える（風のばらつき） */
/* 背景の空（2026-07-31たきと指示）：朝昼夜の色帯＋太陽/月。蔓(-1)より奥の -2 に敷く＝内容の下・余白と上端に見える */
.consign-sky { position: fixed; inset: 0; z-index: -2; pointer-events: none; overflow: hidden; }
.consign-sky-orb { position: absolute; width: 60px; height: 60px; border-radius: 50%; transform: translate(-50%, -50%);
  transition: left 2s linear, top 2s linear; /* 毎分の再計算を滑らかに繋ぐ＝時間経過で動いて見える */ }
/* 夜の月（2026-07-31たきと指示「月を煌びやかに」）：多層の光輪＋ゆっくり脈動。transformは位置決めに
   使用中sofilterで輝度を揺らす */
.consign-sky-orb--moon { animation: consignMoonGlow 2.8s ease-in-out infinite; }
@keyframes consignMoonGlow { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.4); } }
/* 夜空の星：小さな白点が瞬く（配置・周期はJSXで抽選） */
.consign-star { position: absolute; background: #fff; border-radius: 50%;
  box-shadow: 0 0 6px 1px rgba(255,255,255,0.8); animation: consignTwinkle ease-in-out infinite; }
@keyframes consignTwinkle { 0%, 100% { opacity: 0.15; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1.15); } }
/* 揺れは実際の風で可変（2026-07-31たきと指示「風速や風向きで靡く向き・激しさを変える」）：
   --sway-center=風向きの傾き（右+/左-）、--sway-amp=風速の揺れ幅。JSX側でインライン上書き。
   既定（風データ未取得/取得失敗時）は中央0・振幅2.5＝従来のゆるやかな揺れ */
.consign-vines { position: fixed; top: 0; left: 0; right: 0; z-index: -1; pointer-events: none; --sway-center: 0; --sway-amp: 2.5; }
.consign-vines svg { position: absolute; top: 0; overflow: visible;
  transform-origin: top center; animation: consignSway ease-in-out infinite alternate; }
@keyframes consignSway {
  from { transform: rotate(calc((var(--sway-center) - var(--sway-amp)) * 1deg)); }
  to   { transform: rotate(calc((var(--sway-center) + var(--sway-amp)) * 1deg)); }
}
/* 四隅の蔓：角を抱く飾り（額縁）。揺らさない・操作を妨げない・内容の下に敷く */
.consign-corners svg { position: fixed; z-index: -1; pointer-events: none; overflow: visible; }
/* 委託ページの入力（2026-07-31たきと指示）：文字も入力ボックスの縁もブラック。
   .field の既定（縁#EBEBEB・文字#222・ラベルはグレー）をこのページだけ黒に上書き */
.cb-consign-page .field, .cb-consign-page textarea.field, .cb-consign-page select.field {
  border-color: #111 !important; color: #111 !important; font-size: 15.4px; }
.cb-consign-page .field:focus { border-color: #111 !important; box-shadow: 0 0 0 3px rgba(17,17,17,0.12) !important; }
/* 委託ページの文字は全体の1.1倍で統一（2026-08-02たきと指示）。インラインfontSizeは
   ConsignmentRoom.jsx側で一括1.1倍済み＝ここはクラス既定値（.lbl 10px→11px／.field 14px→15.4px）の追従。
   インライン指定がある要素はインラインが勝つ（!importantを付けない理由） */
.cb-consign-page .lbl { color: #111 !important; font-size: 11px; }
/* 委託ページ内の主ボタン（保存する等）も黒に（2026-07-31たきと指示「すべて、ブラックで統一」）。
   編集モーダルはDOM上 .cb-consign-page の子孫なのでこの継承で拾える */
.cb-consign-page .btn-primary { background: #111111 !important; }
/* ── 委託／受託の切替トグル（2026-08-05たきと指示「求人求職の切り替えトグルと同じ構造」）──
   .profile-employer-fab と同じ構造：右下固定・切替先を予告するラベル・スクロール連動の自動格納・
   反転は pflip 0.4s×2（両面で共用の @keyframes を使う＝アニメを二重に定義しない）。
   違いは2点だけ：①委託ページは下部バーが無いので浮遊位置は画面下から20px
   ②色相を持ち込まない（委託・受託はブラックの世界＝求人の緑／求職の橙とは分ける・2026-07-31）。
   切替先の予告は色相でなく濃淡の階段で行う＝委託主は黒ベタ／受託者は白地に黒枠。
   モバイル限定にしない（委託ページは下部バーが無く、デスクトップでも右下が空いているため） */
.consign-role-fab {
  position: fixed;
  right: 12px;
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  z-index: 60;
  border-radius: 24px;
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 700;
  font-family: 'Noto Sans JP', sans-serif;
  box-shadow: 0 4px 12px rgba(0,0,0,.18);
  cursor: pointer;
  white-space: nowrap;
  transition: transform .25s ease;
}
/* 下へスクロール中は沈める（.profile-employer-fab と同じ cb-scroll-hide 連動）。
   沈む量＝浮遊位置(20px+セーフエリア)＋自身の高さ(100%) */
body.cb-scroll-hide .consign-role-fab { transform: translateY(calc(100% + 20px + env(safe-area-inset-bottom, 0px))); }
/* オーバーレイ表示中は隠す（求人求職側のトグルと同じ作法・オーバーレイ描画の鉄則） */
body:has(.cb-lock-scroll) .consign-role-fab,
body:has(.cb-box-overlay) .consign-role-fab { display: none !important; }
/* 退場演出（2026-07-31たきと指示・新しく委託を出す→ウィザードへ）：
   蔓(0〜0.5s)→太陽と空(0.4〜0.9s)→名刺・ボックス・文言(0.8〜1.2s)の順に画面外へ。
   蔓は各svgでなく容器ごと持ち上げる（svg個々のsway用インラインduration/delayに勝てないため。
   容器は高さ0soパーセントでなくvhで動かす）。四隅は額縁soその場でフェード */
.consign-leaving .consign-vines { animation: consignVinesExit .5s ease-in forwards; }
@keyframes consignVinesExit { to { transform: translateY(-110vh); } }
.consign-leaving .consign-corners { opacity: 0; transition: opacity .45s ease-in; }
.consign-leaving .consign-sky { animation: consignSkyExit .5s ease-in .4s forwards; }
@keyframes consignSkyExit { to { transform: translateY(-105%); opacity: 0; } }
.consign-leaving .consign-list-content { animation: consignContentExit .4s ease-in .8s forwards; }
@keyframes consignContentExit { to { transform: translateY(24px); opacity: 0; } }
/* 帰還演出（2026-07-31たきと指示・ウィザード→一覧へ戻るとき）＝退場の逆再生：
   中身(0〜0.4s)→太陽と空が降りてくる(0.35〜0.85s)→蔓が垂れてくる(0.75〜1.25s)。
   backwards＝遅延中は開始姿勢（画面外）で待たせる */
.consign-returning .consign-list-content { animation: consignContentReturn .4s ease-out backwards; }
@keyframes consignContentReturn { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.consign-returning .consign-sky { animation: consignSkyReturn .5s ease-out .35s backwards; }
@keyframes consignSkyReturn { from { transform: translateY(-105%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.consign-returning .consign-vines { animation: consignVinesReturn .5s ease-out .75s backwards; }
@keyframes consignVinesReturn { from { transform: translateY(-110vh); } to { transform: translateY(0); } }
.consign-returning .consign-corners { animation: consignCornersReturn .45s ease-out .75s backwards; }
@keyframes consignCornersReturn { from { opacity: 0; } to { opacity: 1; } }
/* 動きを減らす設定の端末では、入場演出は出さず・蔓は揺らさず静止で置く（退場演出はJS側で即遷移に分岐） */
@media (prefers-reduced-motion: reduce) {
  .consign-entrance { display: none; }
  .consign-vines svg { animation: none; }
  .consign-sky-orb--moon, .consign-star { animation: none; }
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
/* ボックス表示中は役割切替トグルを隠す（2026-07-29たきと指示）。メディアクエリの外にも置く＝
   画面幅に関係なく必ず効く（760〜768pxの隙間で漏れていた） */
body:has(.cb-lock-scroll) .profile-employer-fab,
body:has(.cb-preview-overlay) .profile-employer-fab,
body:has(.cb-box-overlay) .profile-employer-fab { display: none !important; }
/* 浮遊ボックス（運営チャット／プロフィールのプレビュー）も同じ扱い（2026-08-03）：
   ボックス・プレビュー展開中は暗幕の下に透けるので隠す */
body:has(.cb-lock-scroll) .cb-admin-chat-fab,
body:has(.cb-preview-overlay) .cb-admin-chat-fab,
body:has(.cb-box-overlay) .cb-admin-chat-fab,
body:has(.qset-full) .cb-admin-chat-fab { display: none !important; }
body:has(.qset-full) .profile-employer-fab,
body:has(.qset-full) .nav-coach { display: none !important; }
body:has(.qset-full) .site-footer-fixed { display: none !important; }
/* 保険の準備ページ（#/insurance）はフッター（サポート等）を出さない（2026-07-29たきと指示）。
   保存ボタンの下にリンクの列が続くと、申告の締めが見えにくいため */
body:has(.ins-prep-page) .site-footer-fixed { display: none !important; }
/* 経験・資格ページ（#/experience）もフッター（サポート等）を出さない（2026-08-03たきと指示） */
body:has(.cb-exp-page) .site-footer-fixed { display: none !important; }
/* 管理画面で操作するページはサイトフッター（サポート等）を出さない（2026-08-05たきと指示）。
   メディアクエリの外に置く＝画面幅に関係なく効く（PCでも管理画面にはフッターを出さない）。
   下部バー・浮遊☰は出したままso、管理画面から他のページへ抜ける道は残る */
body:has(.cb-admin-page) .site-footer-fixed { display: none !important; }
html:has(.qset-full), body:has(.qset-full) { overflow: hidden; height: 100%; overscroll-behavior: none; }

/* 働き手／雇い手プレビュー表示中：ページ側スクロールを止め、スクロールをプレビュー内に統一（2026-07-23）。
   .cb-lock-scroll＝同じ効果の汎用クラス（2026-07-26たきと指示）。ボックス/シートを全画面で被せる
   オーバーレイに付けると、背後のページが動かずボックス内だけがスクロールする */
html:has(.cb-preview-overlay), body:has(.cb-preview-overlay),
html:has(.cb-lock-scroll), body:has(.cb-lock-scroll) { overflow: hidden; height: 100%; overscroll-behavior: none; }

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

/* ── 求人詳細（スマホ専用）：末尾（この求人を報告する）とフッターの間を20pxに（2026-07-25たきと指示）。
   従来は main90px＋本文110px＋フッターmargin40pxが積み重なり約240pxの空白になっていた。
   詳細表示中だけ :has で main・フッター側の余白を打ち消し、間隔を20pxに一本化 ── */
@media (max-width: 759px) {
  .job-detail-body-mobile { padding-bottom: 0; }
  body:has(.job-detail-body-mobile) main { padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)) !important; }
  body:has(.job-detail-body-mobile) .site-footer-fixed { margin-top: 0; }
  /* 応募者ページの上空白を15px丁度に（2026-07-26たきと指示）：main側の上余白10pxを打ち消し、
     コンテナ自身の padding-top:15px だけを残す（求人詳細と同じ body:has() 方式）。
     下も同様：「帯（ステータス）の意味」の下〜フッターの間を20pxに一本化する
     （コンテナ側の下80pxは0にしてあるso、ここのpadding-bottomがそのまま間隔になる） */
  body:has(.emp-applicants-page) main { padding-top: 0 !important; padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)) !important; }
  body:has(.emp-applicants-page) .site-footer-fixed { margin-top: 0; }
  /* main の上余白を0にした分、コンテナ自身の15pxに safe-area を足す（black-translucent対応・2026-07-31） */
  .emp-applicants-page { padding-top: calc(15px + env(safe-area-inset-top, 0px)) !important; }
}

/* ── プロフィール面（働き手・雇い手とも）：最下段のボックスの下の空きを15px丁度に（2026-08-03たきと指示）。
   従来は main の下90px＋コンテナ自身の下32px＝約122pxの空白だった。求人詳細（.job-detail-body-mobile）と
   同じ作法で、コンテナ側の下余白は0（ProfileHub のインライン padding "32px 4px 0"）＋フッターの上マージンも
   0にして、この値に一本化する。
   ★メディアクエリは main の既定（下記300行付近・max-width:768px）と同じ範囲に合わせる。
     759pxにすると760〜768px（iPad縦など）で main 側の90pxが残り、詰めたはずの余白が戻ってしまう ── */
@media (max-width: 768px) {
  body:has(.profile-employer-edge) main { padding-bottom: calc(15px + env(safe-area-inset-bottom, 0px)) !important; }
  body:has(.profile-employer-edge) .site-footer-fixed { margin-top: 0; }
  /* コンテナ側の下余白はインラインで0にしてあるが、CSSでも固定して取りこぼしを無くす */
  .profile-employer-edge { padding-bottom: 0 !important; }
}

/* ── Profile 2カラム（PC）／横タブ（モバイル・従来どおり） ── */
.profile-content { grid-area: content; min-width: 0; }
@media (max-width: 768px) {
}

/* ── LandingFlow Step6 grid ── */
@media (max-width: 800px) {
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
.site-footer-fixed .footer-copy {
  font-size: 11px;
  color: #B0B0B0;
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
  .site-footer-fixed .footer-copy {
    font-size: 10px;
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
}

/* ── Buttons ── */
.btn-primary{
  background: var(--mode-accent, #00A86B);
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 13px 24px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .02em;
}
.btn-primary:hover{ filter: brightness(0.92); }
.btn-primary:active{ filter: brightness(0.85); }
.btn-primary:disabled{ opacity: .35; cursor: not-allowed; transform: none; }

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
/* いいねハートのぷるんぷるん（2026-08-07たきと指示）：縦スクロール中（body.cb-scrolling＝App.jsxの
   スクロール監視が立てる）だけ、ゼリーの伸び縮みで震える。transformはグリフのspan（.cb-like-heart）
   にだけ掛ける＝ボタン円・カード・fixed要素のtransformには波及しない。振幅は小さめ＝スクロールが
   止まってクラスが外れ、アニメが途中で切れてもスナップが目立たない */
@keyframes cbHeartJelly {
  0%   { transform: scale(1, 1); }
  30%  { transform: scale(1.22, 0.78) rotate(-5deg); }
  55%  { transform: scale(0.86, 1.14) rotate(4deg); }
  78%  { transform: scale(1.1, 0.92) rotate(-2deg); }
  100% { transform: scale(1, 1); }
}
body.cb-scrolling .cb-like-heart { animation: cbHeartJelly .55s ease-in-out infinite; }

/* 訪問者の玄関（#/visit）：いま募集中の求人が横に流れる帯（2026-07-27たきと指示・ロゴの差し替え）。
   同じ並びを2回描いて -50% まで流す＝継ぎ目なしで無限ループ。指を置いている間は停止。
   高さはカード側の clamp が持つ（同意ボタンを画面外へ押し出さないための伸縮） */
.cb-visit-marquee { overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
/* gapではなくカード側のmargin-rightで間隔を作る＝1枚が必ず「幅＋間隔」so、-50%が1周とぴったり一致する
   （gapだと末尾の1つ分だけ足りず、1周ごとに数pxずれて継ぎ目が見える） */
.cb-visit-strip { display: flex; width: max-content; padding: 2px 0; animation: cbVisitMarquee 30s linear infinite; }
.cb-visit-strip > * { margin-right: 10px; }
/* 指を置いたら止める仕掛けは撤去（2026-07-27たきと報告）。スマホは1タップでhover状態が残り、
   :activeも触るたび発火するsо、訪問者が何か操作するたびに帯が止まって見えていた。
   カードはタップ不可＝止める理由が無いので、常に流し続ける */
@keyframes cbVisitMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .cb-visit-strip { animation: none; } .cb-visit-marquee { overflow-x: auto; } }
`;
