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
//   ・大きな太字の題名（26px・左寄せ）＋その下に灰色の1文（この画面は何か）
//   ・行リスト＝左にアイコン（線画32px）・右に【太字の見出し＋灰色の説明】の2段。区切り線は引かない
//     （Airbnbと同じく余白が区切る）
//   ・下部＝細い罫線の上に黒い全幅ボタン（#222・角丸8）＝FinalReviewSheetのAirbnb化と同じ言語。
//     役割色・ブランド緑はこの画面には使わない（アイコンも中立の#222）
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
import { useSheetDragClose } from "../lib/sheetDrag";
import { NavIcon } from "./NavIcons";

// 台帳。lead＝この画面が何かの1文（題名の下の灰色）／rows＝アイコン＋太字見出し＋灰色説明（3つまで）
const PAGE_GUIDES = [
  {
    key: "search", title: "さがす",
    match: (h) => h === "" || h === "search",
    lead: "農家の求人（農作業のバイト）が並ぶ画面です。",
    rows: [
      { icon: "clipboard", t: "カードをタップ", d: "仕事のくわしい内容が見られます" },
      { icon: "heart", t: "ハート（♥）で保存", d: "あとで見返せます。カレンダーに並びます" },
      { icon: "inbox", t: "応募はくわしい内容の画面から", d: "「応募する」を押します。ログインが必要です" },
    ],
  },
  {
    key: "jobDetail", title: "求人のくわしい内容",
    match: (h) => h.startsWith("work/job/"),
    lead: "1つの求人のくわしい内容の画面です。",
    rows: [
      { icon: "clipboard", t: "内容は上から順に", d: "仕事の内容・日程・場所・報酬・保険が並びます" },
      { icon: "question", t: "農家に質問できます", d: "「質問」のタブから聞けます。名前は出ません" },
      { icon: "hourglass", t: "応募は、すぐ採用ではありません", d: "農家が内容を見て承認します" },
    ],
  },
  {
    key: "savedCalendar", title: "カレンダー",
    match: (h) => h === "saved",
    lead: "あなたの予定の画面です。応募した仕事と、いいねした求人が並びます。",
    rows: [
      { icon: "calendar", t: "色のついた日をタップ", d: "その日の仕事のカードまで移動します" },
      { icon: "check", t: "色のこさ＝決まりぐあい", d: "濃い色＝採用が決まった日、薄い色＝まだ決まっていない日" },
      { icon: "clipboard", t: "カードのボタンから", d: "チャット・記録・評価・労働条件通知書が開けます" },
    ],
  },
  {
    key: "farmerCalendar", title: "カレンダー（農家）",
    match: (h) => h === "profile/employer/calendar",
    lead: "あなたの求人と、届いた応募の予定の画面です。",
    rows: [
      { icon: "calendar", t: "日をタップ", d: "その日の求人と応募者のカードまで移動します" },
      { icon: "postJob", t: "予定のない日をタップ", d: "その日から始まる求人を出せます" },
      { icon: "swap", t: "長押しでうごかせます", d: "自分の求人をつかんで別の日へ。応募が来た求人はコピーになります" },
    ],
  },
  {
    key: "chats", title: "チャット",
    match: (h) => h === "chats",
    lead: "相手とのやり取りの一覧です。",
    rows: [
      { icon: "chats", t: "相手ごとに1つ", d: "応募すると、相手とのチャットがここに増えます" },
      { icon: "bell", t: "お知らせも届きます", d: "面接の質問や、採用・保険の報告もチャットに届きます" },
      { icon: "alert", t: "やり取りはこの中で", d: "連絡先の交換はしないでください" },
    ],
  },
  {
    key: "applicants", title: "応募者一覧",
    match: (h) => h === "profile/employer/applicants",
    lead: "あなたの求人に届いた応募が、すべて並ぶ画面です。",
    rows: [
      { icon: "profile", t: "アイコンをタップ", d: "応募者のプロフィールが見られます" },
      { icon: "check", t: "段階のチップをタップ", d: "承認・見送り・採用のシートが開きます" },
      { icon: "hire", t: "承認は採用ではありません", d: "採用は「採用する」で確定します" },
    ],
  },
  {
    key: "newApplicants", title: "新着の応募",
    match: (h) => h === "new-applicants",
    lead: "まだ返事をしていない応募の画面です。",
    rows: [
      { icon: "views", t: "内容を見て決める", d: "押すと、応募者一覧で承認・見送りを決められます" },
      { icon: "chats", t: "承認するとチャットが始まります", d: "承認は採用ではありません" },
    ],
  },
  {
    key: "applying", title: "あなたの応募",
    match: (h) => h === "profile/worker/applying",
    lead: "応募した求人の、返事待ちと過去の記録の画面です。",
    rows: [
      { icon: "hourglass", t: "応募中", d: "農家の承認を待っている求人です" },
      { icon: "ended", t: "過去の応募", d: "見送り・取り消し・失効になった記録です" },
    ],
  },
  {
    key: "profileEmployer", title: "マイページ（農家）",
    match: (h) => h === "profile/employer",
    lead: "農家としてのあなたの情報と、やることをまとめた画面です。",
    rows: [
      { icon: "inbox", t: "応募者一覧", d: "届いた応募を見て、承認・採用を決める入口です" },
      { icon: "clipboard", t: "やること", d: "採用・保険の報告・評価などの用件の入口です" },
      { icon: "postJob", t: "求人を出す", d: "下の「掲載」タブから出せます" },
    ],
  },
  {
    key: "profileWorker", title: "マイページ",
    match: (h) => h === "profile" || h === "profile/worker",
    lead: "あなたの情報と、やることをまとめた画面です。",
    rows: [
      { icon: "profile", t: "プロフィール", d: "応募に必要なのは、ニックネーム・住んでいる市町村・自己紹介の3つです" },
      { icon: "clipboard", t: "やること", d: "緊急連絡・記録・評価などの用件の入口です" },
      { icon: "book", t: "わたしの記録", d: "はたらいた記録・労働条件通知書・いいねした求人" },
    ],
  },
];

export function guideForHash(hash) {
  const h = (hash || "").replace(/^#\/?/, "");
  for (const g of PAGE_GUIDES) { if (g.match(h)) return g; }
  return null;
}

const SEEN_KEY = "cb_pageGuideSeen_v1";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } };
const markSeen = (key) => { try { const s = readSeen(); s[key] = 1; localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch {} };

// App.jsx に1つだけ常駐。suspend＝新規登録・再同意など全画面の用件を挟んでいる間は自動表示しない
export function PageGuide({ suspend = false }) {
  const [guide, setGuide] = useState(null); // 開いているガイド
  const suspendRef = useRef(suspend);
  suspendRef.current = suspend;

  // はじめて開いたページで一度だけ自動表示。連続の画面移動では出さない（800ms落ち着いてから）
  useEffect(() => {
    let timer = 0;
    const consider = () => {
      clearTimeout(timer);
      const g = guideForHash(window.location.hash);
      if (!g) return;
      if (readSeen()[g.key]) return;
      timer = setTimeout(() => {
        if (suspendRef.current) return;               // 全画面の用件（登録・再同意）が先
        if (readSeen()[g.key]) return;                // 待っている間に別経路で既読になった
        if (guideForHash(window.location.hash)?.key !== g.key) return; // もう別のページ
        // 他のボックスが開いている間は出さない（お知らせ・祝祭などに重ねない）。
        // 既読にはしない＝次にこのページを開いた時にあらためて出る
        if (document.querySelector(".cb-box-overlay, .cb-sheet-up")) return;
        markSeen(g.key); // 出した時点で既読（同じ説明で二度さえぎらない）
        setGuide(g);
      }, 800);
    };
    consider();
    window.addEventListener("hashchange", consider);
    // ☰「この画面の説明」＝既読でもいつでも開き直せる入口
    const reopen = () => { const g = guideForHash(window.location.hash); if (g) { markSeen(g.key); setGuide(g); } };
    window.addEventListener("cb:openPageGuide", reopen);
    return () => { clearTimeout(timer); window.removeEventListener("hashchange", consider); window.removeEventListener("cb:openPageGuide", reopen); };
  }, []);

  // 下スワイプで閉じる（★フックは早期returnより前・PhaseInfoSheetと同じ作法）
  const sheetRef = useRef(null);
  useSheetDragClose(sheetRef, null, () => setGuide(null), !!guide);
  if (!guide) return null;

  return (
    <div className="cb-box-overlay cb-lock-scroll" onClick={() => setGuide(null)}
      style={{ zIndex:9700, padding:"40px 16px" }}>
      <div ref={sheetRef} onClick={(e) => e.stopPropagation()} className="cb-sheet-up f-sans"
        style={{ background:"#fff", borderRadius:20, padding:"14px 24px 20px",
                 maxWidth:560, width:"100%", boxSizing:"border-box", maxHeight:"100%", overflowY:"auto",
                 WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {/* ✕（左上・素のアイコン）＝Airbnbの教育モーダルの構成の写し。外タップ・下スワイプでも閉じる */}
        <button onClick={() => setGuide(null)} aria-label="とじる" className="f-sans"
          style={{ background:"none", border:"none", cursor:"pointer", padding:8, margin:"0 0 4px -8px",
                   display:"flex", alignItems:"center", justifyContent:"center", color:"#222" }}>
          <NavIcon name="close" size={18} />
        </button>
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
        {/* 下部＝細い罫線＋黒い全幅ボタン（Airbnbの足の型・FinalReviewSheetと同じ言語） */}
        <div style={{ borderTop:"1px solid #EBEBEB", margin:"0 -24px", padding:"14px 24px 0" }}>
          <button onClick={() => setGuide(null)} className="f-sans"
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
  );
}
