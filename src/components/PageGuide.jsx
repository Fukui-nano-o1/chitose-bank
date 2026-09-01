// この画面の説明（ページガイド・2026-09-01たきと指示「訪問者にページの説明をすべき」）。
//
// 【型＝Airbnbの写し（コードは流用していない・振る舞いだけ）】Airbnbはページに説明文を常設しない。
//   ①はじめて開いた面に一度だけ教育カードを出す ②あとは (i)/？ の入口から同じ説明を開ける
//   ③空状態が「この画面は何か」を語る——の3点で教える。ここは①②を担う
//   （③＝空状態の説明は各ページが従来どおり持つ）。
//
// 【仕組み】
//   ・PAGE_GUIDES＝主要ページの説明の台帳（このファイルが唯一のソース）。
//     ページを足す・文言を変える時はこの配列だけを直す。match は先頭一致・並び順で先勝ち
//     （例：profile/employer/applicants は profile/employer より上に置く）
//   ・はじめてそのページを開いた時に一度だけ、下からのシートで自動表示（端末ごと・localStorage既読）。
//     ★他のボックス（お知らせ等）が開いている間は出さない＝次にそのページを開いた時に出る
//   ・二度目からは ☰メニューの「この画面の説明」（cb:openPageGuide）からいつでも開ける。
//     ☰側は guideForHash(curHash) が真の時だけ項目を出す（説明の無いページに死んだ項目を置かない）
//   ・シートの作法＝cb-box-overlay + cb-lock-scroll 併用・✕なし・外タップと下スワイプで閉じる（家の規約）
import { useEffect, useRef, useState } from "react";
import { useSheetDragClose } from "../lib/sheetDrag";
import { NavIcon } from "./NavIcons";

// 台帳。lead＝この画面が何かの1文／points＝できることの短い箇条書き（3つまで・平明な言葉で）。
// icon＝NavIconの名前（見出しの左に出す）
const PAGE_GUIDES = [
  {
    key: "search", icon: "search", title: "さがす",
    match: (h) => h === "" || h === "search",
    lead: "農家の求人（農作業のバイト）が並ぶ画面です。",
    points: [
      "カードをタップすると、仕事のくわしい内容が見られます",
      "ハート（♥）を押すと、あとで見返せます（カレンダーに並びます）",
      "応募は、くわしい内容の画面の「応募する」から。ログインが必要です",
    ],
  },
  {
    key: "jobDetail", icon: "clipboard", title: "求人のくわしい内容",
    match: (h) => h.startsWith("work/job/"),
    lead: "1つの求人のくわしい内容の画面です。",
    points: [
      "写真の下に、仕事の内容・日程・場所・報酬・保険が順に並びます",
      "「質問」のタブから、農家に質問できます（名前は出ません）",
      "「応募する」を押しても、すぐ採用にはなりません（農家が内容を見て承認します）",
    ],
  },
  {
    key: "savedCalendar", icon: "calendar", title: "カレンダー",
    match: (h) => h === "saved",
    lead: "あなたの予定の画面です。応募した仕事と、いいねした求人がカレンダーに並びます。",
    points: [
      "色のついた日をタップすると、その日の仕事のカードまで移動します",
      "濃い色＝採用が決まった日、薄い色＝まだ決まっていない日です",
      "カードのボタンから、チャット・記録・評価・労働条件通知書が開けます",
    ],
  },
  {
    key: "farmerCalendar", icon: "calendar", title: "カレンダー（農家）",
    match: (h) => h === "profile/employer/calendar",
    lead: "あなたの求人と、届いた応募の予定の画面です。",
    points: [
      "日をタップすると、その日の求人と応募者のカードまで移動します",
      "予定のない日をタップすると、その日から始まる求人を出せます",
      "自分の求人の日を長押しすると、つかんで別の日へ動かせます（応募が来た求人はコピー）",
    ],
  },
  {
    key: "chats", icon: "chats", title: "チャット",
    match: (h) => h === "chats",
    lead: "相手とのやり取りの一覧です。応募すると、相手ごとのチャットがここに増えます。",
    points: [
      "面接の質問や、採用・保険の報告などのお知らせもチャットに届きます",
      "やり取りはこのチャットの中で行ってください（連絡先の交換はしないでください）",
    ],
  },
  {
    key: "applicants", icon: "applicants", title: "応募者一覧",
    match: (h) => h === "profile/employer/applicants",
    lead: "あなたの求人に届いた応募が、すべて並ぶ画面です。",
    points: [
      "応募者のアイコンをタップすると、その人のプロフィールが見られます",
      "段階のチップをタップすると、承認・見送り・採用のシートが開きます",
      "承認は採用ではありません。採用は「採用する」で確定します",
    ],
  },
  {
    key: "newApplicants", icon: "inbox", title: "新着の応募",
    match: (h) => h === "new-applicants",
    lead: "まだ返事をしていない応募の画面です。",
    points: [
      "「内容を見て決める」を押すと、応募者一覧で承認・見送りを決められます",
      "承認するとチャットが始まります（承認は採用ではありません）",
    ],
  },
  {
    key: "applying", icon: "hourglass", title: "あなたの応募",
    match: (h) => h === "profile/worker/applying",
    lead: "応募した求人の、返事待ちと過去の記録の画面です。",
    points: [
      "「応募中」＝農家の承認を待っている求人です",
      "「過去の応募」＝見送り・取り消し・失効になった記録です",
    ],
  },
  {
    key: "profileEmployer", icon: "farmer", title: "マイページ（農家）",
    match: (h) => h === "profile/employer",
    lead: "農家としてのあなたの情報と、やることをまとめた画面です。",
    points: [
      "「応募者一覧」＝届いた応募を見て、承認・採用を決める入口です",
      "「やること」＝採用・保険の報告・評価などの用件の入口です",
      "求人を出すときは、下の「掲載」タブを押してください",
    ],
  },
  {
    key: "profileWorker", icon: "profile", title: "マイページ",
    match: (h) => h === "profile" || h === "profile/worker",
    lead: "あなたの情報と、やることをまとめた画面です。",
    points: [
      "応募に必要なのは、ニックネーム・住んでいる市町村・自己紹介 の3つです",
      "「やること」＝緊急連絡・記録・評価などの用件の入口です",
      "「わたしの記録」＝はたらいた記録・労働条件通知書・いいねした求人",
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
      style={{ position:"fixed", inset:0, zIndex:9700, background:"rgba(0,0,0,0.35)",
               display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .15s ease" }}>
      <div ref={sheetRef} onClick={(e) => e.stopPropagation()} className="cb-sheet-up f-sans"
        style={{ background:"#fff", borderRadius:"16px 16px 0 0",
                 padding:"22px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)",
                 maxWidth:560, width:"100%", boxSizing:"border-box", maxHeight:"80vh", overflowY:"auto",
                 WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <span style={{ display:"flex", color:"#222" }}><NavIcon name={guide.icon} size={26} /></span>
          <h3 style={{ margin:0, fontSize:19, fontWeight:800, color:"#222" }}>{guide.title}</h3>
          <span style={{ marginLeft:"auto", fontSize:11, fontWeight:700, color:"#00A86B",
                         border:"1.5px solid #00A86B", borderRadius:8, padding:"3px 8px", flexShrink:0 }}>この画面の説明</span>
        </div>
        <p style={{ margin:"0 0 12px", fontSize:15, lineHeight:1.9, color:"#222", fontWeight:700 }}>{guide.lead}</p>
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
          {guide.points.map((p, i) => (
            <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
              <span style={{ color:"#00A86B", display:"flex", marginTop:3, flexShrink:0 }}><NavIcon name="tick" size={14} /></span>
              <span style={{ fontSize:14, lineHeight:1.8, color:"#333" }}>{p}</span>
            </div>
          ))}
        </div>
        <button onClick={() => setGuide(null)} className="f-sans"
          style={{ display:"block", width:"100%", background:"#00A86B", color:"#fff", border:"none",
                   borderRadius:12, padding:"14px 0", fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
          わかった
        </button>
        <p style={{ margin:"10px 0 0", fontSize:11.5, color:"#8A8A8A", lineHeight:1.7, textAlign:"center" }}>
          この説明は、☰メニューの「この画面の説明」からいつでも見られます
        </p>
      </div>
    </div>
  );
}
