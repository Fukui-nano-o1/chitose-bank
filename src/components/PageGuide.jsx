// この画面の説明（ページガイド・2026-09-01たきと指示「訪問者にページの説明をすべき」）。
//
// 【型＝Airbnbの写し（コードは流用していない・振る舞いと構成だけ）】Airbnbはページに説明文を常設しない。
//   ①はじめて開いた面に一度だけ教育カードを出す ②あとは (i)/？ の入口から同じ説明を開ける
//   ③空状態が「この画面は何か」を語る——の3点で教える。ここは①②を担う
//   （③＝空状態の説明は各ページが従来どおり持つ）。
//
// 【中身の構成＝Airbnbの教育モーダル（How Airbnb works 型）の解剖をそのまま（2026-09-01たきと指示
//  「Airbnbの説明の構成を全てパクれ」）】
//   ・左上に素の✕（丸枠なし・40pxのタップ領域）＝2026-08-19「✕全廃」の明示的な例外
//     （Airbnbの構成の写し＝FinalReviewSheet・図の大画面と同じ判断。外タップ・下スワイプでも閉じる）
//   ・上部のビジュアル（2026-09-01たきと採択③）＝うすい灰色の帯に線画のひとこま（GUIDE_ART）。
//     Airbnbの機能紹介モーダルの絵の領域の写し。絵はこのファイルの GUIDE_ART が唯一のソース
//     （NavIconと同じ言語＝stroke 2.5・round・中立の#222。ダミー写真は使わない）
//   ・大きな太字の題名（26px・左寄せ）＋その下に灰色の1文（この画面は何か）
//   ・行リスト＝左にアイコン（線画32px）・右に【太字の見出し＋灰色の説明】の2段。区切り線は引かない
//     （Airbnbと同じく余白が区切る）
//   ・下部＝細い罫線の上に黒い全幅ボタン（#222・角丸8）＝FinalReviewSheetのAirbnb化と同じ言語。
//     役割色・ブランド緑はこの画面には使わない（アイコンも中立の#222）
//   ・出入りのアニメ＝Airbnbのモーダルの写し（2026-09-01たきと指示「あるのならパクれ」）：
//     入り＝幕フェード＋パネルがフェードしながら下からわずかに上がる（.cb-guide-in・0.4s・弾まない
//     ＝家の cbPop はこの箱では使わない）。閉じ＝速いフェードで下へ（.cb-guide-out・0.18s）＝
//     ✕・わかった・外タップで掛かる。★ドラッグで引き下げて閉じた時は掛けない＝
//     useSheetDragClose 自身が0.22sかけて下へ滑らせてから onClose を呼ぶので、そこで close(false)
//     ＝二重の出口アニメにしない。CSSは appStyles の cbGuide* が正
//
// 【スポットライト（2026-09-01たきと採択④）＝実物のボタンを照らす吹き出し（Airbnbのコーチマークの写し）】
//   ・「わかった」を押した後にだけ始まる（＝説明を読み終えた人に「画面のどこにあるか」を指す。
//     ✕・外タップ・ドラッグで閉じた時は始めない＝急いで閉じた人を引き止めない）
//   ・幕に穴（的の周りだけ明るい）＋白い吹き出し（一言＋つぎへ/わかった）。どこをタップしても進む
//   ・的は台帳の spots（CSSセレクタ＋一言）。無い的・見えない的は黙って飛ばす＝空のページでは何も出ない
//   ・的の目印は各部品の data-guide 属性（job-card / apply-btn / calendar / chat-row / decide-btn /
//     biz-card）と既存クラス .cb-app-jobcard。★的を足す時は部品に data-guide を付け、ここに1行足す
//   ・幕は body へ createPortal（祖先の transform で fixed が狂う家の既知の罠を避ける）＋
//     cb-lock-scroll（的の位置がスクロールでずれないよう固定。的は先に scrollIntoView で中央へ）
//
// 【仕組み】
//   ・PAGE_GUIDES＝主要ページの説明の台帳（このファイルが唯一のソース）。
//     ページを足す・文言を変える時はこの配列だけを直す。match は先頭一致・並び順で先勝ち
//     （例：profile/employer/applicants は profile/employer より上に置く）。
//     rows＝1行 { icon（NavIconの名前）, t（太字の見出し）, d（灰色の説明） }
//   ・はじめてそのページを開いた時に一度だけ、画面中央のボックスで自動表示（端末ごと・localStorage既読）。
//     ★他のボックス（お知らせ等）が開いている間は出さない＝次にそのページを開いた時に出る
//   ・二度目からは ☰メニューの「この画面の説明」（cb:openPageGuide）からいつでも開ける。
//     ☰側は guideForHash(curHash) が真の時だけ項目を出す（説明の無いページに死んだ項目を置かない）
//   ・ボックスの作法＝cb-box-overlay + cb-lock-scroll 併用・外タップと下スワイプで閉じる（家の規約）。
//     配置は【画面中央】＝overlayに padding:"40px 16px"／シートは maxHeight:"100%"（上下に40pxの余白を取り、
//     ボックスの中央と画面の中央を一致させる・2026-09-01たきと指示。労働条件通知書・編集モーダルと同じ規格）
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDragClose } from "../lib/sheetDrag";
import { ROUTE_CHANGED } from "../lib/pushRoute";
import { NavIcon } from "./NavIcons";

// ── 上部のビジュアル（ひとこまの線画）──────────────────────────
// NavIconと同じ言語（stroke 2.5・round・currentColor）で、ページの場面をひとこまに。
// viewBox 120x80。絵を直したら実ブラウザのスクショで確認する（家の作法）
const ART_PROPS = { viewBox: "0 0 120 80", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" };
const GUIDE_ART = {
  // さがす＝求人カード＋虫めがね
  search: (
    <svg {...ART_PROPS}>
      <rect x="20" y="12" width="42" height="56" rx="6" />
      <rect x="26" y="18" width="30" height="22" rx="3" />
      <path d="M26 48h30" /><path d="M26 56h20" />
      <circle cx="81" cy="40" r="14" /><path d="M91 50l11 11" />
    </svg>
  ),
  // 求人のくわしい内容＝写真つきの書面
  jobDetail: (
    <svg {...ART_PROPS}>
      <rect x="38" y="8" width="44" height="64" rx="6" />
      <rect x="44" y="14" width="32" height="20" rx="3" />
      <path d="M44 44h32" /><path d="M44 52h32" /><path d="M44 60h22" />
    </svg>
  ),
  // 自分の求人の詳細＝同じ書面に「自分のもの」の印（右上のレ点つきの丸）
  jobDetailOwn: (
    <svg {...ART_PROPS}>
      <rect x="30" y="12" width="44" height="60" rx="6" />
      <rect x="36" y="18" width="32" height="18" rx="3" />
      <path d="M36 44h32" /><path d="M36 52h32" /><path d="M36 60h22" />
      <circle cx="86" cy="18" r="11" fill="#fff" />
      <path d="M80.5 18.5l3.5 3.5 7-7.5" />
    </svg>
  ),
  // 相手とのチャット＝相手の吹き出し・自分の吹き出し・下の入力欄
  chatThread: (
    <svg {...ART_PROPS}>
      <rect x="14" y="8" width="52" height="22" rx="9" />
      <path d="M24 30l-3 8 10-8" />
      <rect x="54" y="34" width="52" height="22" rx="9" fill="currentColor" stroke="none" opacity="0.18" />
      <rect x="54" y="34" width="52" height="22" rx="9" />
      <rect x="14" y="62" width="70" height="13" rx="6.5" />
      <circle cx="97" cy="68.5" r="7" fill="currentColor" stroke="none" />
    </svg>
  ),
  // ログイン＝メールと、届いた6桁のコード
  login: (
    <svg {...ART_PROPS}>
      <rect x="14" y="18" width="52" height="36" rx="6" />
      <path d="M14 24l26 18 26-18" />
      <rect x="62" y="40" width="44" height="28" rx="6" fill="#fff" />
      <path d="M70 54h4" /><path d="M78 54h4" /><path d="M86 54h4" /><path d="M94 54h4" />
    </svg>
  ),
  // 本人情報の登録＝書面と、ほかの人には見えない錠前
  account: (
    <svg {...ART_PROPS}>
      <rect x="22" y="8" width="54" height="64" rx="6" />
      <path d="M30 22h38" /><path d="M30 32h38" /><path d="M30 42h24" /><path d="M30 52h30" />
      <rect x="78" y="46" width="26" height="22" rx="5" fill="#fff" />
      <path d="M84 46v-6a7 7 0 0 1 14 0v6" fill="none" />
      <circle cx="91" cy="57" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  // 仕事の当日＝時計（開始も終わりも自動）
  workday: (
    <svg {...ART_PROPS}>
      <circle cx="60" cy="42" r="30" />
      <path d="M60 22v20l13 8" />
      <path d="M22 70h76" />
    </svg>
  ),
  // カレンダー（働き手・農家で共用）＝盤面と決まった日
  calendar: (
    <svg {...ART_PROPS}>
      <rect x="26" y="16" width="68" height="52" rx="6" />
      <path d="M26 30h68" /><path d="M42 9v9" /><path d="M78 9v9" />
      <circle cx="42" cy="42" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="60" cy="42" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="78" cy="42" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="42" cy="56" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="60" cy="56" r="6" fill="currentColor" stroke="none" />
      <circle cx="78" cy="56" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  // チャット＝ふたつの吹き出し
  chats: (
    <svg {...ART_PROPS}>
      <rect x="18" y="10" width="50" height="26" rx="9" />
      <path d="M30 36l-4 9 12-9" />
      <rect x="52" y="40" width="50" height="26" rx="9" />
      <path d="M90 66l4 9-12-9" />
      <circle cx="67" cy="53" r="2" fill="currentColor" stroke="none" />
      <circle cx="77" cy="53" r="2" fill="currentColor" stroke="none" />
      <circle cx="87" cy="53" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  // 応募者一覧＝ふたりの応募者カード
  applicants: (
    <svg {...ART_PROPS}>
      <rect x="22" y="14" width="34" height="52" rx="6" />
      <circle cx="39" cy="33" r="7" />
      <path d="M30 58c2-9 16-9 18 0" />
      <rect x="64" y="14" width="34" height="52" rx="6" />
      <circle cx="81" cy="33" r="7" />
      <path d="M72 58c2-9 16-9 18 0" />
    </svg>
  ),
  // 新着の応募＝受信トレイへ届く紙
  newApplicants: (
    <svg {...ART_PROPS}>
      <rect x="48" y="4" width="24" height="24" rx="3" />
      <path d="M53 12h14" /><path d="M53 18h10" />
      <path d="M60 32v7" /><path d="M56 35l4 4 4-4" />
      <path d="M22 46h20l6 8h24l6-8h20v20a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4z" />
    </svg>
  ),
  // あなたの応募＝出した紙と砂時計（返事待ち）
  applying: (
    <svg {...ART_PROPS}>
      <rect x="24" y="12" width="38" height="54" rx="5" />
      <path d="M32 26h22" /><path d="M32 34h22" /><path d="M32 42h16" />
      <path d="M76 14h20" /><path d="M76 66h20" />
      <path d="M78 14v4c0 10 16 12 16 22s-16 12-16 22v4" />
      <path d="M94 14v4c0 10-16 12-16 22s16 12 16 22v4" />
    </svg>
  ),
  // マイページ（働き手）＝名刺カード（人と情報の行）
  profileWorker: (
    <svg {...ART_PROPS}>
      <rect x="12" y="18" width="96" height="44" rx="8" />
      <circle cx="34" cy="36" r="8" />
      <path d="M24 54c2.5-9 17.5-9 20 0" />
      <path d="M56 32h40" /><path d="M56 42h40" /><path d="M56 52h28" />
    </svg>
  ),
  // マイページ（農家）＝名刺カード（葉の人＝farmerアイコンと同じ目印）
  profileEmployer: (
    <svg {...ART_PROPS}>
      <rect x="12" y="18" width="96" height="44" rx="8" />
      <circle cx="34" cy="37" r="8" />
      <path d="M24 55c2.5-9 17.5-9 20 0" />
      <path d="M40 26c6-6 12-4 13 1-5 3-10 2-13-1z" />
      <path d="M56 32h40" /><path d="M56 42h40" /><path d="M56 52h28" />
    </svg>
  ),
  // 保険の報告＝盾のカード2枚（どれを準備したかを選ぶ）
  insurance: (
    <svg {...ART_PROPS}>
      <rect x="14" y="16" width="42" height="50" rx="6" /><path d="M35 26l9 4v8c0 7-4 11-9 13-5-2-9-6-9-13v-8z" />
      <rect x="64" y="16" width="42" height="50" rx="6" /><path d="M85 26l9 4v8c0 7-4 11-9 13-5-2-9-6-9-13v-8z" /><path d="M80 40l4 4 7-8" />
    </svg>
  ),
  // 採用する＝人とレ点（この人に決める）
  hire: (
    <svg {...ART_PROPS}>
      <circle cx="46" cy="30" r="12" /><path d="M24 66c3-13 41-13 44 0" />
      <circle cx="88" cy="52" r="14" /><path d="M81 52l5 5 10-11" />
    </svg>
  ),
  // 仕事の評価＝3つの問いのカードと星
  finalReview: (
    <svg {...ART_PROPS}>
      <rect x="18" y="12" width="60" height="56" rx="6" />
      <rect x="26" y="22" width="44" height="10" rx="3" /><rect x="26" y="36" width="44" height="10" rx="3" /><rect x="26" y="50" width="44" height="10" rx="3" />
      <path d="M96 20l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" />
    </svg>
  ),
  // 緊急連絡＝受話器と吹き出し（相手に届く）
  emergency: (
    <svg {...ART_PROPS}>
      <path d="M22 22c0 22 18 38 38 38l8-8-10-8-6 4c-8-4-14-10-18-18l4-6-8-10z" />
      <path d="M76 18h30v22H90l-8 7v-7h-6z" /><path d="M85 26h12" /><path d="M85 32h8" />
    </svg>
  ),
  // 求人の質問＝吹き出しの？
  question: (
    <svg {...ART_PROPS}>
      <path d="M26 14h68a8 8 0 0 1 8 8v30a8 8 0 0 1-8 8H56l-14 12v-12H26a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" />
      <path d="M52 32c0-6 5-9 9-9s8 3 8 7c0 5-8 6-8 12" /><circle cx="61" cy="49" r="1.6" fill="currentColor" />
    </svg>
  ),
  // 修正のお願い＝書面と鉛筆
  revision: (
    <svg {...ART_PROPS}>
      <rect x="24" y="10" width="48" height="60" rx="6" /><path d="M32 24h32" /><path d="M32 34h32" /><path d="M32 44h20" />
      <path d="M84 52l16-16 8 8-16 16h-8z" /><path d="M96 40l8 8" />
    </svg>
  ),
  // プロフィール編集＝行が並ぶ書面と、右に「見える相手」の人と目
  profileEdit: (
    <svg {...ART_PROPS}>
      <rect x="14" y="12" width="56" height="56" rx="6" /><path d="M22 26h40" /><path d="M22 38h40" /><path d="M22 50h28" />
      <circle cx="94" cy="32" r="9" /><path d="M78 60c2-11 30-11 32 0" />
      <path d="M86 20c4-5 12-5 16 0-4 5-12 5-16 0z" /><circle cx="94" cy="20" r="1.6" fill="currentColor" />
    </svg>
  ),
};

// 台帳。lead＝この画面が何かの1文（題名の下の灰色）／rows＝アイコン＋太字見出し＋灰色説明（3つまで）／
// art＝上部のビジュアル（GUIDE_ARTの鍵）／spots＝スポットライトの的（セレクタ＋一言・無ければ飛ばす）
const PAGE_GUIDES = [
  // ★本人情報の登録はURLでなく画面の目印で見分ける（domOnly）：登録直後は #/login のまま自動で出る画面so、
  //   台帳の先頭に置き、フォームが画面にある時だけこの説明が勝つ。無ければ飛ばす（保留にはしない）
  {
    key: "account", title: "本人情報の登録", art: "account", domOnly: true,
    match: () => true,
    detect: () => !!document.querySelector('[data-guide="account-form"]'),
    lead: "はじめてのときだけ、あなたの情報を登録します。",
    rows: [
      { icon: "profile", t: "氏名・生年月日・住所を入れます", d: "雇用の手続きに必要な情報です。18歳未満は登録できません" },
      { icon: "lock", t: "ほかの人には見えません", d: "表示されるのはニックネームなど、あとで作るプロフィールだけ。氏名は採用が決まった相手にだけ表示されます" },
      { icon: "check", t: "同意して「登録する」", d: "利用規約とプライバシーポリシーに同意して押します。終わると「さがす」に戻ります" },
    ],
    spots: [
      { sel: '[data-guide="account-name"]', label: "氏名はここに。ほかの利用者には表示されません。" },
      { sel: '[data-guide="account-submit"]', label: "入れ終わったら、同意にチェックしてここを押します。" },
    ],
  },
  {
    key: "login", title: "ログイン", art: "login",
    match: (h) => h === "login",
    lead: "メールアドレスとパスワードで入ります。はじめての方は、下のボタンから登録します。",
    rows: [
      { icon: "mail", t: "メールアドレスを入れます", d: "パスワードをお持ちなら、そのまま「ログイン」を押します" },
      { icon: "sprout", t: "はじめての方は「はじめての方はこちら」", d: "6桁の認証コードがメールで届きます。入れたあと、パスワードを決めます" },
      { icon: "lock", t: "パスワードを忘れたら", d: "同じ認証コードで、もう一度パスワードを決められます" },
    ],
    spots: [
      { sel: '[data-guide="login-email"]', label: "メールアドレスはここに入れます。" },
      { sel: '[data-guide="login-signup"]', label: "はじめての方はここから。認証コードがメールで届きます。" },
    ],
  },
  {
    key: "search", title: "さがす", art: "search",
    match: (h) => h === "" || h === "search",
    lead: "農家の求人（農作業のバイト）が並ぶ画面です。",
    rows: [
      { icon: "clipboard", t: "カードをタップ", d: "仕事のくわしい内容が見られます" },
      { icon: "heart", t: "ハート（♥）で保存", d: "あとで見返せます。カレンダーに並びます" },
      { icon: "inbox", t: "応募はくわしい内容の画面から", d: "「応募する」を押します。ログインが必要です" },
    ],
    spots: [{ sel: '[data-guide="job-card"]', label: "求人カードです。タップすると、仕事のくわしい内容が開きます。" }],
  },
  // ★同じURL（work/job/N）に2つの説明がある＝自分が出した求人か、ほかの人の求人か（2026-09-02たきと指示
  //   「自分の求人詳細は分けて説明しよう」）。URLでは見分けられないので detect＝画面のボタンで見分ける：
  //   下部が「あなたの求人」（own-job-btn）なら自分の、「応募する」（apply-btn）ならほかの人の。
  //   どちらもまだ無い（求人の読み込み中・自分の求人かの判定待ち）なら【保留】＝resolveGuide が pending を返し、
  //   自動表示は少し待って撃ち直す（先に決めて間違った説明を出さない・既読にもしない）
  {
    key: "jobDetailOwn", title: "あなたが出した求人", art: "jobDetailOwn",
    match: (h) => h.startsWith("work/job/"),
    detect: () => !!document.querySelector('[data-guide="own-job-btn"]'),
    lead: "あなたが出した求人を、働き手に見えているのと同じ姿で確認する画面です。",
    rows: [
      { icon: "views", t: "働き手にはこう見えています", d: "写真・日程・場所・報酬を、応募する人と同じ形で確かめられます" },
      { icon: "postJob", t: "操作は下の「あなたの求人」から", d: "コピーして新しく出す／一時非公開にする／応募者一覧を見る" },
      { icon: "inbox", t: "応募が来たら応募者一覧へ", d: "この求人に届いた応募だけが並び、承認や採用へ進めます" },
    ],
    spots: [{ sel: '[data-guide="own-job-btn"]', label: "あなたの求人の操作はここから。コピー・一時非公開・応募者一覧が出ます。" }],
  },
  {
    key: "jobDetail", title: "求人のくわしい内容", art: "jobDetail",
    match: (h) => h.startsWith("work/job/"),
    detect: () => !!document.querySelector('[data-guide="apply-btn"]'),
    lead: "1つの求人のくわしい内容の画面です。",
    rows: [
      { icon: "clipboard", t: "内容は上から順に", d: "仕事の内容・日程・場所・報酬・保険が並びます" },
      { icon: "question", t: "農家に質問できます", d: "「質問」のタブから聞けます。名前は出ません" },
      { icon: "hourglass", t: "応募は、すぐ採用ではありません", d: "農家が内容を見て承認します" },
    ],
    spots: [{ sel: '[data-guide="apply-btn"]', label: "応募はこのボタンから。押しても、すぐ採用にはなりません。" }],
  },
  // 相手とのチャット（#/chat/{応募ID}・2026-09-02たきと指示「相手のチャットを初めて開いた時の説明も」）。
  // 運営チャット（chat/admin）は別の画面so対象外。★このページは下部バー・浮遊☰が消える（chat-full）ので、
  // モバイルの☰からは開き直せない＝自動表示の一度きりが主な入口
  {
    key: "chatThread", title: "相手とのチャット", art: "chatThread",
    match: (h) => h.startsWith("chat/") && h !== "chat/admin",
    lead: "応募した仕事について、相手と直接やり取りする画面です。",
    rows: [
      { icon: "chats", t: "下の欄に書いて送ります", d: "送った内容は記録として残り、あとから消したり直したりはできません" },
      { icon: "bell", t: "大事な連絡は自動で入ります", d: "承認・採用・保険の報告などのお知らせも、この画面に届きます" },
      { icon: "profile", t: "相手の名前をタップ", d: "相手のプロフィール・記録・評価が見られます" },
      { icon: "flag", t: "困ったときは「報告する」", d: "右上の「報告する」から、問題のあるコメントを運営に知らせられます" },
    ],
    spots: [
      { sel: '[data-guide="chat-input"]', label: "ここに書いて「送信」。相手にすぐ届きます。" },
      { sel: '[data-guide="chat-partner"]', label: "相手の名前です。タップするとプロフィールが見られます。" },
      { sel: '[data-guide="chat-report"]', label: "困ったときはここから運営に報告できます。" },
    ],
  },
  // 仕事の当日＝今日の記録の用件ページ（農家 day_report／働き手 w_day_report）。自動開始・自動完了の説明の置き場
  // （2026-09-02たきと指示「優先度高いものから実装」＝当日に特別な操作は要らない、を伝える場所が無かった）
  {
    key: "workday", title: "仕事の当日", art: "workday",
    match: (h) => h === "calendar/todo/day_report" || h === "calendar/todo/w_day_report",
    lead: "作業の当日は、特別な操作は要りません。",
    rows: [
      { icon: "clock", t: "開始は自動で記録されます", d: "作業の開始時刻になると、自動で「作業中」になります。打刻は要りません" },
      { icon: "check", t: "終わりも自動です", d: "最終日の終了時刻に、自動で「完了」になります" },
      { icon: "clipboard", t: "何かあった日だけ記録します", d: "遅刻・欠勤・会えない・予定と違う、など。何もなかった日は入力不要です" },
      { icon: "star", t: "評価は最終日に", d: "仕事が終わったら、カレンダーのカードの「評価する」から" },
    ],
    spots: [{ sel: '[data-guide="day-report-card"]', label: "いま進んでいる仕事です。何かあった日は「記録する」から。" }],
  },
  // ── 用件の専用ページ（#/calendar/todo/{stage}）＝マイページのやること箱・カレンダーのカードのボタンから来る
  //    （2026-09-03たきと指示「では次」＝中くらいの優先度の1つ目）。仕事の当日（workday）は上に別建て
  {
    key: "insurance", title: "保険の準備の報告", art: "insurance",
    match: (h) => h === "calendar/todo/insurance",
    lead: "今回の仕事のために用意した保険を、相手に知らせる画面です。",
    rows: [
      { icon: "shield", t: "カードをタップします", d: "用意した保険のカードを1枚選びます。？を押すと保険の説明が出ます" },
      { icon: "chats", t: "OKでチャットに届きます", d: "「報告しますか？」のOKで、相手のチャットに報告が送られ、時刻が記録に残ります" },
      { icon: "clipboard", t: "自己申告です", d: "運営が加入を確認するものではありません。事故のときの備えとして正直に" },
    ],
    spots: [{ sel: '[data-guide="insurance-cards"]', label: "用意した保険のカードをタップすると、報告の確認が出ます。" }],
  },
  {
    key: "hire", title: "採用する", art: "hire",
    match: (h) => h === "calendar/todo/hire",
    lead: "面接を終えた応募者を採用する画面です。",
    rows: [
      { icon: "hire", t: "カードをタップします", d: "最終確認が出ます。日程が重なる人には警告が出ます" },
      { icon: "check", t: "OKで採用が決まります", d: "労働条件がこの時点の内容で確定し、労働条件通知書として双方に残ります" },
      { icon: "profile", t: "お互いの本名が表示されます", d: "雇用の手続きのため。採用が決まった相手にだけです" },
    ],
    spots: [{ sel: '[data-guide="hire-card"]', label: "この人を採用するなら、カードをタップして最終確認へ。" }],
  },
  {
    key: "finalReview", title: "仕事の評価", art: "finalReview",
    match: (h) => h === "calendar/todo/w_review" || h === "calendar/todo/complete",
    lead: "仕事が終わったら、相手を評価する画面です。これで全部の工程が終わります。",
    rows: [
      { icon: "star", t: "3つの問いに答えます", d: "選ぶだけです。自由記述はありません" },
      { icon: "views", t: "相手に見えるのは「はい」だけ", d: "「いいえ」は相手に表示されません。お互いの評価が揃うか、完了から3日たつと見られます" },
      { icon: "clock", t: "終わって24時間ここに並びます", d: "それを過ぎても、カレンダーのカードの「評価する」から評価できます" },
    ],
    spots: [
      { sel: '[data-guide="review-card"]', label: "終わった仕事です。タップすると評価の画面が開きます。" },
      { sel: '[data-guide="todo-row"]', label: "終わった仕事です。「完了・評価 →」で評価の画面へ。" },
    ],
  },
  {
    key: "emergency", title: "緊急連絡", art: "emergency",
    match: (h) => h === "calendar/todo/t_emergency",
    lead: "作業当日の急な連絡（遅れる・休む・会えない）をする画面です。",
    rows: [
      { icon: "alert", t: "カードをタップします", d: "採用が決まった仕事が並びます。開いた中の「緊急連絡をする」から" },
      { icon: "chats", t: "相手に届き、記録に残ります", d: "お知らせとチャットで相手に届きます。あとで確認できるように残ります" },
      { icon: "phone", t: "作業中は緊急連絡先も見られます", d: "仕事の開始から終了までの間だけ、相手の緊急連絡先が表示されます" },
    ],
    spots: [{ sel: '[data-guide="emergency-card"]', label: "連絡したい仕事のカードをタップします。" }],
  },
  {
    key: "question", title: "求人の質問", art: "question",
    match: (h) => h === "calendar/todo/question",
    lead: "あなたの求人に届いた質問に答える画面です。",
    rows: [
      { icon: "question", t: "「回答する →」で求人ページの質問へ", d: "質問と回答は求人ページに公開されます（誰が質問したかは出ません）" },
      { icon: "noSmoke", t: "連絡先は書けません", d: "電話番号・メールアドレス・URLは自動で拒否されます。やり取りはチャットで" },
    ],
    spots: [{ sel: '[data-guide="todo-row"]', label: "届いた質問です。「回答する →」で答えられます。" }],
  },
  {
    key: "revision", title: "修正のお願い", art: "revision",
    match: (h) => h === "calendar/todo/revision" || h === "calendar/todo/w_revision",
    lead: "運営から内容の修正をお願いしたときに、ここから直す画面です。",
    rows: [
      { icon: "edit", t: "「修正する →」で直します", d: "指摘のあった箇所を直して、もう一度掲載します" },
      { icon: "views", t: "直したあとは運営が確認します", d: "修正のお願いがあった求人だけ、再掲載の前に運営が確認してから公開されます" },
      { icon: "support", t: "分からないときは運営チャットへ", d: "チャットのいちばん上の運営チャットから聞けます" },
    ],
    spots: [{ sel: '[data-guide="todo-row"]', label: "修正のお願いが届いた求人です。「修正する →」で直せます。" }],
  },
  {
    key: "savedCalendar", title: "カレンダー", art: "calendar",
    match: (h) => h === "saved",
    lead: "あなたの予定の画面です。応募した仕事と、いいねした求人が並びます。",
    rows: [
      { icon: "calendar", t: "色のついた日をタップ", d: "その日の仕事のカードまで移動します" },
      { icon: "check", t: "色のこさ＝決まりぐあい", d: "濃い色＝採用が決まった日、薄い色＝まだ決まっていない日" },
      { icon: "clipboard", t: "カードのボタンから", d: "チャット・記録・評価・労働条件通知書が開けます" },
    ],
    spots: [{ sel: '[data-guide="calendar"]', label: "あなたの予定のカレンダーです。色のついた日をタップすると、その日のカードが下に出ます。" }],
  },
  {
    key: "farmerCalendar", title: "カレンダー（農家）", art: "calendar",
    match: (h) => h === "profile/employer/calendar",
    lead: "あなたの求人と、届いた応募の予定の画面です。",
    rows: [
      { icon: "calendar", t: "日をタップ", d: "その日の求人と応募者のカードまで移動します" },
      { icon: "postJob", t: "予定のない日をタップ", d: "その日から始まる求人を出せます" },
      { icon: "swap", t: "長押しでうごかせます", d: "自分の求人をつかんで別の日へ。応募が来た求人はコピーになります" },
    ],
    spots: [{ sel: '[data-guide="calendar"]', label: "日をタップ＝その日のカードが下に出ます。予定のない日をタップ＝その日から始まる求人を出せます。" }],
  },
  {
    key: "chats", title: "チャット", art: "chats",
    match: (h) => h === "chats",
    lead: "相手とのやり取りの一覧です。",
    rows: [
      { icon: "chats", t: "相手ごとに1つ", d: "応募すると、相手とのチャットがここに増えます" },
      { icon: "support", t: "いちばん上は運営チャット", d: "困ったとき・使い方が分からないときは、ここから運営に送れます" },
      { icon: "bell", t: "お知らせも届きます", d: "面接の質問や、採用・保険の報告もチャットに届きます" },
      { icon: "alert", t: "やり取りはこの中で", d: "連絡先の交換はしないでください" },
    ],
    // 画面の並びどおり、いちばん上の運営チャットから照らす（相手の行が1つも無い人でも必ず1つは照らせる）
    spots: [
      { sel: '[data-guide="admin-chat-row"]', label: "運営チャットです。困ったとき・使い方が分からないときは、ここから運営に送れます。" },
      { sel: '[data-guide="chat-row"]', label: "タップすると、この相手とのやり取りが開きます。" },
    ],
  },
  {
    key: "applicants", title: "応募者一覧", art: "applicants",
    match: (h) => h === "profile/employer/applicants",
    lead: "あなたの求人に届いた応募が、すべて並ぶ画面です。",
    rows: [
      { icon: "profile", t: "アイコンをタップ", d: "応募者のプロフィールが見られます" },
      { icon: "check", t: "段階のチップをタップ", d: "承認・見送り・採用のシートが開きます" },
      { icon: "hire", t: "承認は採用ではありません", d: "採用は「採用する」で確定します" },
    ],
    spots: [{ sel: ".cb-app-jobcard", label: "応募者のカードです。アイコン＝プロフィール、段階のチップ＝承認・見送り・採用。" }],
  },
  {
    // 応募が届いた時に最初に開く画面（2026-09-02たきと指示「応募きた時の説明を追加」＝2行→4行に作り直し。
    // 流れ＝見る→決める→承認ならチャットで面接→採用。決めないと作業の開始日で自動で失効する（expire_stale）
    // ★key を v2 に＝中身を作り直したので、旧2行版を既に見た端末にも一度だけ出し直す（既読の鍵が変わる）
    key: "newApplicants_v2", title: "応募が届きました", art: "newApplicants",
    match: (h) => h === "new-applicants",
    lead: "あなたの求人に応募が届くと、最初に開く画面です。",
    rows: [
      { icon: "profile", t: "まず応募者を見ます", d: "名前・実績・来られる日が並びます。左の写真で求人が開きます" },
      { icon: "check", t: "「内容を見て決める」を押します", d: "承認する／見送る／あとで決める を選べます" },
      { icon: "chats", t: "承認するとチャットで面接", d: "承認は採用ではありません。話してから「採用する」で決めます" },
      { icon: "hourglass", t: "作業の開始日までに決めます", d: "決めないまま開始日が来ると、自動で失効します" },
    ],
    spots: [
      { sel: '[data-guide="applicant-card"]', label: "届いた応募です。応募者の名前・実績・来られる日が見られます。" },
      { sel: '[data-guide="decide-btn"]', label: "ここを押して、承認するか見送るかを決めます。承認は採用ではありません。" },
    ],
  },
  {
    key: "applying", title: "あなたの応募", art: "applying",
    match: (h) => h === "profile/worker/applying",
    lead: "応募した求人の、返事待ちと過去の記録の画面です。",
    rows: [
      { icon: "hourglass", t: "応募中", d: "農家の承認を待っている求人です" },
      { icon: "ended", t: "過去の応募", d: "見送り・取り消し・失効になった記録です" },
    ],
    spots: [{ sel: '[data-guide="job-card"]', label: "応募した求人のカードです。タップすると返事の状況が見られます。" }],
  },
  // ── プロフィール編集（2026-09-03）：どの項目が誰に見えるかを、入力の前に伝える。
  //    一覧の面（#/profile/worker/profile・#/profile/employer/profile）だけ＝項目ごとの編集ページ（/{項目}）では出さない
  {
    key: "profileWorkerEdit", title: "プロフィールの入力", art: "profileEdit",
    match: (h) => h === "profile/worker/profile",
    lead: "農家に見せるあなたの情報です。本名や電話番号はここには入りません。",
    rows: [
      { icon: "views", t: "農家に見えるのはこの一覧の内容", d: "ニックネーム・居住地（市町村まで）・自己紹介・移動手段・経験など。応募した先の農家が見ます" },
      { icon: "lock", t: "本名・電話は採用が決まった相手だけ", d: "新規登録で入れた本人情報は、ここには表示されません。採用が決まった相手にだけ氏名が出ます" },
      { icon: "check", t: "この3つで応募できます", d: "ニックネーム・居住地・自己紹介。保存するとすぐ表示されます（連絡先を書くと自動で拒否されます）" },
    ],
    spots: [
      { sel: '[data-guide="apply-ready-guide"]', label: "まずこの3つ。埋まれば応募できます。" },
      { sel: '[data-guide="profile-rows"]', label: "タップして1つずつ入力します。保存すると次の未入力へ進みます。" },
    ],
  },
  {
    key: "profileEmployerEdit", title: "農家プロフィールの入力", art: "profileEdit",
    match: (h) => h === "profile/employer/profile",
    lead: "働き手に見せる農家の情報です。氏名・住所・連絡先は求人ページに載ります。",
    rows: [
      { icon: "views", t: "氏名・住所・連絡先は求人ページに表示", d: "募集者の情報として、法律で明示が求められています。ログインした人に見えます" },
      { icon: "gift", t: "待遇と保険は掲載のときに固定", d: "求人を掲載した時点の内容が、その求人に残ります。あとで変えても掲載中の求人は変わりません" },
      { icon: "lock", t: "緊急連絡先は作業中の相手だけ", d: "採用が決まった相手に、仕事の開始から終了までの間だけ表示されます" },
    ],
    spots: [{ sel: '[data-guide="profile-rows"]', label: "タップして1つずつ入力します。赤い印は掲載に必要な項目です。" }],
  },
  // ★マイページの中身は2026-08-25の大整理後の実態（やることの格子・応募者一覧カード・掲載カードは無い）
  {
    key: "profileEmployer", title: "マイページ（農家）", art: "profileEmployer",
    match: (h) => h === "profile/employer",
    lead: "農家としてのあなたの情報をまとめた画面です。",
    rows: [
      { icon: "farmer", t: "名刺カード", d: "タップで裏返って、記録と評価が見られます" },
      { icon: "postJob", t: "求人を出す", d: "「あなたの求人」の面から。カレンダーの予定のない日をタップしても出せます" },
      { icon: "clock", t: "つぎの予定", d: "7日以内の仕事が下に並びます" },
    ],
    spots: [{ sel: '[data-guide="biz-card"]', label: "あなたの名刺カードです。タップで裏返って記録・評価。「あなたの求人」で作成中・公開中へ。" }],
  },
  {
    key: "profileWorker", title: "マイページ", art: "profileWorker",
    match: (h) => h === "profile" || h === "profile/worker",
    lead: "あなたの情報をまとめた画面です。",
    rows: [
      { icon: "profile", t: "名刺カード", d: "タップで裏返って、記録と評価が見られます。「編集する」でプロフィールを直せます" },
      { icon: "heart", t: "いいねした求人", d: "ハートを押した求人が、ここに並びます" },
      { icon: "clock", t: "つぎの予定", d: "7日以内の仕事が下に並びます" },
    ],
    spots: [{ sel: '[data-guide="biz-card"]', label: "あなたの名刺カードです。タップで裏返って記録・評価。「編集する」でプロフィールを直せます。" }],
  },
];

export const GUIDE_PENDING = "pending";
// URLと画面の両方で決める。返り値＝台帳の1件／null（説明の無いページ）／GUIDE_PENDING
// （URLは合うが detect がまだどれも真でない＝画面の読み込み待ち）。
export function resolveGuide(hash) {
  const h = (hash || "").replace(/^#\/?/, "");
  let waiting = false;
  for (const g of PAGE_GUIDES) {
    if (!g.match(h)) continue;
    if (!g.detect) return g;
    if (g.detect()) return g;
    if (g.domOnly) continue; // 画面の目印だけで見分ける説明＝無ければ飛ばす（保留にしない）
    waiting = true;
  }
  return waiting ? GUIDE_PENDING : null;
}
// ☰の項目の出し分けなど「いま何か説明があるか」だけ知りたい側＝保留なら、URLで合う先頭の説明に倒す
export function guideForHash(hash) {
  const r = resolveGuide(hash);
  if (r !== GUIDE_PENDING) return r;
  const h = (hash || "").replace(/^#\/?/, "");
  for (const g of PAGE_GUIDES) { if (!g.domOnly && g.match(h)) return g; }
  return null;
}

const SEEN_KEY = "cb_pageGuideSeen_v1";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } };
const markSeen = (key) => { try { const s = readSeen(); s[key] = 1; localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch {} };

// App.jsx に1つだけ常駐。suspend＝新規登録・再同意など全画面の用件を挟んでいる間は自動表示しない
export function PageGuide({ suspend = false }) {
  const [guide, setGuide] = useState(null); // 開いているガイド
  const [closing, setClosing] = useState(false); // 出口アニメ中（0.18sだけ真）
  const [spot, setSpot] = useState(null); // スポットライト＝{ rect, label, i, list }
  const closeTimerRef = useRef(0);
  const spotTimerRef = useRef(0);
  const suspendRef = useRef(suspend);
  suspendRef.current = suspend;
  // 閉じる＝出口アニメを流してからアンマウント。animated=false（ドラッグで閉じた時）は即アンマウント
  // ＝ドラッグの出口はフック自身の0.22sの滑り落ちが担っている（上に重ねると二重の動きになる）
  const close = (animated = true) => {
    if (!animated) { clearTimeout(closeTimerRef.current); setClosing(false); setGuide(null); return; }
    setClosing(true);
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => { setGuide(null); setClosing(false); }, 180);
  };
  // 開く＝閉じかけの途中でも新しく開けるよう、出口の予約を取り消す。スポットライトも仕切り直す
  const open = (g) => { clearTimeout(closeTimerRef.current); setClosing(false); setSpot(null); setGuide(g); };
  useEffect(() => () => { clearTimeout(closeTimerRef.current); clearTimeout(spotTimerRef.current); }, []);

  // ── スポットライト（④）＝的を順に照らす。無い的・見えない的は黙って飛ばす ──
  // 画面にある的を探す（幅高さ4px以下＝隠れている・畳まれているものは的にしない）
  const findTarget = (sel) => Array.from(document.querySelectorAll(sel))
    .find((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; }) || null;
  const runSpot = (list, i) => {
    if (!list || i >= list.length) { setSpot(null); return; }
    const el = findTarget(list[i].sel);
    if (!el) { runSpot(list, i + 1); return; }
    setSpot(null); // 幕を下ろしてから的を画面の中央へ（幕の cb-lock-scroll がスクロールを止めるため）
    // ★滑らかスクロールを一時的に外して【即座に】運ぶ：appStyles は html に scroll-behavior:smooth を
    //   掛けており、behavior:"auto" は「CSSに従う」＝smooth になる（実測）。動いている最中に位置を
    //   測ると穴が的からズレるので、インラインの scroll-behavior:auto で上書きしてから運び、すぐ戻す
    const rootStyle = document.documentElement.style;
    const prevSB = rootStyle.scrollBehavior;
    rootStyle.scrollBehavior = "auto";
    el.scrollIntoView({ block: "center", behavior: "auto" });
    rootStyle.scrollBehavior = prevSB;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) { runSpot(list, i + 1); return; }
      setSpot({ rect: { top: r.top, left: r.left, width: r.width, height: r.height }, label: list[i].label, i, list });
    }));
  };
  // ★数え方＝【いま画面にある的だけ】で数える（台帳の数ではない）。台帳の数で数えると、
  //   チャットが0件の人に「1 / 2・つぎへ →」と出て、押した瞬間に終わる（無い的を数えた嘘）
  const startTour = (spots) => runSpot((spots || []).filter((sp) => findTarget(sp.sel)), 0);
  // 「わかった」＝出口アニメで閉じてから、その画面の的を照らす（✕・外タップ・ドラッグでは照らさない）
  const finishAndTour = () => {
    const g = guide;
    close();
    clearTimeout(spotTimerRef.current);
    spotTimerRef.current = setTimeout(() => startTour(g?.spots), 220);
  };

  // はじめて開いたページで一度だけ自動表示。連続の画面移動では出さない（800ms落ち着いてから）
  useEffect(() => {
    let timer = 0;
    // 画面の読み込み待ち（resolveGuide が pending）の撃ち直し＝400msごと・最大15回（約6秒）。
    // それでも決まらなければ諦める（既読にしない＝次に開いた時にまた試す）
    const PENDING_RETRY_MS = 400, PENDING_RETRY_MAX = 15;
    const consider = () => {
      clearTimeout(timer);
      setSpot(null); // 画面が変わったらスポットライトは畳む（的の位置がもう無い）
      const startHash = window.location.hash;
      const r0 = resolveGuide(startHash);
      if (!r0) return;
      if (r0 !== GUIDE_PENDING && readSeen()[r0.key]) return;
      let tries = 0;
      const fire = () => {
        if (window.location.hash !== startHash) return; // もう別のページ
        const r = resolveGuide(window.location.hash);
        if (!r) return;
        if (r === GUIDE_PENDING) {                    // 自分の求人か・ほかの人のかが、まだ画面に出ていない
          if (++tries >= PENDING_RETRY_MAX) return;
          timer = setTimeout(fire, PENDING_RETRY_MS);
          return;
        }
        if (suspendRef.current) return;               // 全画面の用件（登録・再同意）が先
        if (readSeen()[r.key]) return;                // 待っている間に別経路で既読になった
        // 他のボックスが開いている間は出さない（お知らせ・祝祭などに重ねない）。
        // 既読にはしない＝次にこのページを開いた時にあらためて出る
        if (document.querySelector(".cb-box-overlay, .cb-sheet-up, [data-takeover]")) return;
        markSeen(r.key); // 出した時点で既読（同じ説明で二度さえぎらない）
        open(r);
      };
      timer = setTimeout(fire, 800);
    };
    consider();
    window.addEventListener("hashchange", consider);
    // ★求人カード→詳細は history.pushState で URL を書く＝hashchange が出ない。pushRoute の合図で拾う
    //   （これが無いと求人詳細の説明は直リンクの時しか出ない・2026-09-01たきと報告の真因）
    window.addEventListener(ROUTE_CHANGED, consider);
    // ☰「この画面の説明」＝既読でもいつでも開き直せる入口
    const reopen = () => { const g = guideForHash(window.location.hash); if (g) { markSeen(g.key); open(g); } };
    window.addEventListener("cb:openPageGuide", reopen);
    return () => { clearTimeout(timer); window.removeEventListener("hashchange", consider); window.removeEventListener(ROUTE_CHANGED, consider); window.removeEventListener("cb:openPageGuide", reopen); };
  }, []);

  // 下スワイプで閉じる（★フックは早期returnより前・PhaseInfoSheetと同じ作法）
  const sheetRef = useRef(null);
  useSheetDragClose(sheetRef, null, () => close(false), !!guide && !closing);

  // ── スポットライトの幕（説明ボックスとは独立に出る・bodyへportal）──
  // 吹き出しは的の下（的が画面の下半分にある時は上）。どこをタップしても進む
  const spotLayer = spot ? createPortal(
    (() => {
      const vh = window.innerHeight;
      const pad = 8;
      const r = spot.rect;
      const below = r.top + r.height / 2 < vh * 0.55;
      const isLast = spot.i >= (spot.list.length - 1);
      return (
        <div className="cb-lock-scroll cb-guide-spot" onClick={() => runSpot(spot.list, spot.i + 1)}
          style={{ position: "fixed", inset: 0, zIndex: 9700, cursor: "pointer" }}>
          {/* 穴＝的の周りだけ明るい（巨大な影で周囲を暗くする） */}
          <div style={{ position: "fixed", top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2,
                        borderRadius: 14, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)", border: "2px solid #fff", pointerEvents: "none" }} />
          <div className="f-sans" style={{ position: "fixed", left: 16, right: 16, margin: "0 auto", maxWidth: 340,
                        ...(below ? { top: Math.min(r.top + r.height + pad + 14, vh - 170) } : { bottom: Math.max(vh - r.top + pad + 14, 90) }),
                        background: "#fff", borderRadius: 14, padding: "16px 16px 14px", boxShadow: "0 8px 32px rgba(0,0,0,0.35)" }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.8, color: "#222", fontWeight: 700 }}>{spot.label}</p>
            <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
              {spot.list.length > 1 && (
                <span style={{ fontSize: 12, color: "#8A8A8A" }}>{spot.i + 1} / {spot.list.length}</span>
              )}
              <span style={{ marginLeft: "auto", background: "#222", color: "#fff", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700 }}>
                {isLast ? "わかった" : "つぎへ →"}
              </span>
            </div>
          </div>
        </div>
      );
    })(), document.body) : null;

  if (!guide) return spotLayer;

  return (<>
    <div className={"cb-box-overlay cb-lock-scroll" + (closing ? " cb-guide-closing" : "")} onClick={() => close()}
      style={{ zIndex:9700, padding:"40px 16px" }}>
      <div ref={sheetRef} onClick={(e) => e.stopPropagation()}
        className={"cb-sheet-up f-sans " + (closing ? "cb-guide-out" : "cb-guide-in")}
        style={{ background:"#fff", borderRadius:20, padding:"14px 24px 20px",
                 maxWidth:560, width:"100%", boxSizing:"border-box", maxHeight:"100%", overflowY:"auto",
                 WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {/* ✕（左上・素のアイコン）＝Airbnbの教育モーダルの構成の写し。外タップ・下スワイプでも閉じる */}
        <button onClick={() => close()} aria-label="とじる" className="f-sans"
          style={{ background:"none", border:"none", cursor:"pointer", padding:8, margin:"0 0 4px -8px",
                   display:"flex", alignItems:"center", justifyContent:"center", color:"#222" }}>
          <NavIcon name="close" size={18} />
        </button>
        {/* 上部のビジュアル（③）＝うすい灰色の帯に線画のひとこま */}
        {GUIDE_ART[guide.art] && (
          <div style={{ background:"#F7F7F7", borderRadius:12, padding:"14px 0", display:"flex",
                        alignItems:"center", justifyContent:"center", marginBottom:16, color:"#222" }}>
            <span style={{ display:"flex", width:150, height:100 }}>{GUIDE_ART[guide.art]}</span>
          </div>
        )}
        {/* 大きな太字の題名＋灰色の1文（この画面は何か） */}
        <h3 style={{ margin:"0 0 8px", fontSize:26, fontWeight:800, color:"#222", lineHeight:1.35 }}>{guide.title}</h3>
        <p style={{ margin:"0 0 22px", fontSize:15, lineHeight:1.8, color:"#717171" }}>{guide.lead}</p>
        {/* 行リスト＝アイコン＋太字の見出し＋灰色の説明（区切り線は引かず余白で区切る） */}
        <div style={{ display:"flex", flexDirection:"column", gap:22, marginBottom:24 }}>
          {guide.rows.map((r, i) => (
            <div key={i} style={{ display:"flex", gap:16, alignItems:"flex-start" }}>
              <span style={{ color:"#222", display:"flex", flexShrink:0, marginTop:2 }}><NavIcon name={r.icon} size={32} /></span>
              <span style={{ minWidth:0 }}>
                <span style={{ display:"block", fontSize:16, fontWeight:700, color:"#222", lineHeight:1.5, marginBottom:3 }}>{r.t}</span>
                <span style={{ display:"block", fontSize:14, color:"#717171", lineHeight:1.7 }}>{r.d}</span>
              </span>
            </div>
          ))}
        </div>
        {/* 下部＝細い罫線＋黒い全幅ボタン（Airbnbの足の型・FinalReviewSheetと同じ言語）。
            わかった＝閉じてからスポットライト（④）＝実物のボタンを照らす */}
        <div style={{ borderTop:"1px solid #EBEBEB", margin:"0 -24px", padding:"14px 24px 0" }}>
          <button onClick={finishAndTour} className="f-sans"
            style={{ display:"block", width:"100%", background:"#222", color:"#fff", border:"none",
                     borderRadius:8, padding:"14px 0", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
            わかった
          </button>
          <p style={{ margin:"10px 0 0", fontSize:11.5, color:"#8A8A8A", lineHeight:1.7, textAlign:"center" }}>
            この説明は、☰メニューの「この画面の説明」からいつでも見られます
          </p>
        </div>
      </div>
    </div>
    {spotLayer}
  </>);
}
