// 完了画面のページ（#/admin/animations・管理者専用）。
// 2026-08-07「アニメーションカード」として花火の祝祭（Celebration）を再生する部屋だったが、2026-09-02たきと指示
// 「全てAirbnbをパクれ」で祝祭は全廃＝いまは【完了画面（DoneScreen・PublishDone）の一覧】。
// 見本帳（AdminFarmerPagesRoom）と同じ方針＝似せて描かず【本物の部品をそのまま開く】：本番と同じ props で
// DoneScreen を呼ぶので、本物を変えればこのページも自動で追従する。
// ★DONE_SCREENS の文言は本番の呼び出しの写し。本番側を変えたらここも合わせること（洗い出しは grep "<DoneScreen"）。
// 読み取り専用＝supabaseをimportしない。preview＝通信も遷移もしない（閉じるだけ）。
import { useState } from "react";
import { DoneScreen } from "../DoneScreen";
import { PublishDone } from "../PublishDone";

// 本番で完了画面が出る全場面（2026-09-02時点）。where＝どの画面のどの操作で出るか／src＝呼び出し元
const DONE_SCREENS = [
  { where:"応募を送った直後（応募状況の上に重なる）", src:"App.jsx", props:{ title:"応募を送りました", lead:"農家が内容を確認し、承認するとお知らせします。これはまだ採用ではありません。",
    rows:[
      { icon:"hourglass", t:"農家の返事を待ちます", d:"承認・見送りは農家が決めます。作業の開始日までに決まらないと、応募は自動で終わります" },
      { icon:"chats", t:"承認されるとチャットで面接", d:"農家から質問や日程の相談が届きます" },
      { icon:"calendar", t:"採用が決まると確定", d:"はたらく日は農家が決め、カレンダーに確定の予定として並びます" },
    ], note:"chitose-bankは求人情報の提供と連絡の場を用意します。雇用の契約は当事者間で行われます。" } },
  { where:"仮応募の昇格（プロフィール完成で届いた時）", src:"App.jsx", props:{ title:"2件の応募を届けました", lead:"農家が内容を確認し、承認するとお知らせします。これはまだ採用ではありません。",
    rows:[
      { icon:"hourglass", t:"農家の返事を待ちます", d:"承認・見送りは農家が決めます。作業の開始日までに決まらないと、応募は自動で終わります" },
      { icon:"chats", t:"承認されるとチャットで面接", d:"農家から質問や日程の相談が届きます" },
      { icon:"calendar", t:"採用が決まると確定", d:"はたらく日は農家が決め、カレンダーに確定の予定として並びます" },
    ], note:"chitose-bankは求人情報の提供と連絡の場を用意します。雇用の契約は当事者間で行われます。" } },
  { where:"プロフィール未完成のまま応募した直後", src:"App.jsx", props:{ title:"仮応募をお預かりしました", lead:"プロフィールがそろうと、農家さんに応募が届きます。",
    rows:[
      { icon:"profile", t:"プロフィールを仕上げます", d:"応募状況の「プロフィールを仕上げる」から続けられます" },
      { icon:"inbox", t:"そろった時点で届きます", d:"自己紹介文の確認は運営が行いますが、応募はそれを待たずに届きます" },
    ], secondary:{ label:"プロフィールを仕上げる" } } },
  { where:"応募者ページで応募を承認", src:"FarmerDashboard.jsx", props:{ title:"承認しました", lead:"はなこさんに、承認をお知らせしました。",
    rows:[
      { icon:"chats", t:"チャットで面接します", d:"質問や日程の相談をチャットで進めます" },
      { icon:"hire", t:"採用は「採用する」で決めます", d:"承認は採用ではありません。話してから決めてください" },
      { icon:"hourglass", t:"作業の開始日までに決めます", d:"決めないまま開始日が来ると、応募は自動で失効します" },
    ], primaryLabel:"チャットを開く", secondary:{ label:"とじる" } } },
  { where:"働き手の評価送信（応募状況・カレンダーの仕事の評価）", src:"WorkerApplications.jsx / StagePanels.jsx", props:{ title:"評価を送りました", lead:"ありがとうございました。お互いの評価が揃うか、仕事の完了から3日たつと、相手に表示されます。" } },
  { where:"保険の準備の報告", src:"features/today/components/StagePanels.jsx", props:{ title:"報告しました", lead:"「労災保険」の準備ができたことを、「ブロッコリー 収穫」の相手のチャットにお知らせしました。" } },
  { where:"働き手フロー完了（構想段階の導線）", src:"App.jsx", props:{ title:"ありがとうございます", lead:"この機能は現在構想段階です。実装前に労働局・関係機関へ確認した上で、段階的に追加予定です。", note:"ログインすると実証に参加できます。" } },
];
// 掲載完了（PublishDone）は求人カードを描くので別枠。previewに渡す見本の求人（JobCardにそのまま渡す形・架空）
const PREVIEW_JOB = { id:1026, crop:"ブロッコリー", task:"収穫", region:"吉野川市", pay:9000, payType:"daily", photos:[], dateStartRaw:"2026-10-05", dateEndRaw:"2026-10-09", closed:false, expired:false };
// 部品の中に埋まっていて切り出せないアニメーション＝本物のいる場所へ飛んで確認する
// （コピーを作ると本物と乖離するので、リンクだけ置く）
const EMBEDDED = [
  { l:"採用の押印（文字の印・広がる輪・光の粒）＝成立の画面の中", hash:"/calendar/todo/hire",  where:"採用するページ。採用を実行した時（自動では消えず「チャットを開く」を待つ）" },
  { l:"委託ページの入場演出（幕・草・太陽・花火）", hash:"/admin/consignment", where:"委託 準備室を開いた時" },
  { l:"求人詳細の写真（重なる影・ふわり・写真の一覧の開閉）", hash:"/search",
    where:"さがす → 求人を開く → 写真に指を乗せる／タップして一覧を開く・閉じる" },
];

const rowBtn = { width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"12px 14px", marginBottom:10, cursor:"pointer", display:"flex", alignItems:"center", gap:12 };

export function AdminAnimationsRoom() {
  const [open, setOpen] = useState(null);       // 開いている DoneScreen の props（preview）
  const [pubDone, setPubDone] = useState(null); // 掲載完了の画面（PublishDone）のpreview { open }
  return (
    /* cb-admin-page＝サイトフッターを隠す目印。下余白＝下部バー＋☰ぶん（2026-08-07規約） */
    <div className="appear cb-admin-page" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px", paddingBottom:"calc(140px + env(safe-area-inset-bottom, 0px))" }}>
      <div style={{ marginBottom:14 }}>
        <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:0 }}>完了画面</p>
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>本番と同じ部品（DoneScreen／PublishDone）を同じ文言で開きます。花火の祝祭は全廃（2026-09-02・Airbnbの型）</p>
      </div>

      {DONE_SCREENS.map((c, i) => (
        <button key={i} onClick={()=>setOpen(c.props)} className="f-sans" style={rowBtn}>
          <span style={{ minWidth:0, flex:1 }}>
            <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{c.props.title}</span>
            <span className="f-sans" style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>{c.where}（{c.src}）</span>
          </span>
          <span className="f-sans" style={{ flexShrink:0, fontSize:12, fontWeight:700, color:"#fff", background:"#222", borderRadius:16, padding:"7px 14px" }}>開く</span>
        </button>
      ))}

      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"18px 0 8px" }}>掲載完了の画面（求人カードつき）</p>
      {[{ l:"求人の掲載（即公開）", open:true }, { l:"求人の掲載（公開間近＝修正のお願い中の再掲載）", open:false }].map((e, i) => (
        <button key={i} onClick={()=>setPubDone({ open:e.open })} className="f-sans" style={rowBtn}>
          <span style={{ minWidth:0, flex:1 }}>
            <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{e.l}</span>
            <span className="f-sans" style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>「おめでとうございます、〇〇さん」＋掲載した求人のカード＋「完了」（App.jsx / components/PublishDone.jsx）</span>
          </span>
          <span className="f-sans" style={{ flexShrink:0, fontSize:12, fontWeight:700, color:"#fff", background:"#222", borderRadius:16, padding:"7px 14px" }}>開く</span>
        </button>
      ))}

      {/* ページに埋め込みのアニメーション＝実物のいる場所へ */}
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"18px 0 8px" }}>ページ埋め込みのアニメーション（実物の場所で確認）</p>
      {EMBEDDED.map((e, i) => (
        <button key={i} onClick={()=>{ window.location.hash = e.hash; }} className="f-sans" style={rowBtn}>
          <span style={{ minWidth:0, flex:1 }}>
            <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{e.l}</span>
            <span className="f-sans" style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>{e.where}</span>
          </span>
          <span className="f-sans" style={{ flexShrink:0, fontSize:12, fontWeight:700, color:"#555" }}>開く →</span>
        </button>
      ))}

      {open && <DoneScreen takeover="preview" title={open.title} lead={open.lead} rows={open.rows || []} note={open.note}
        primary={{ label: open.primaryLabel || "完了", onClick:()=>setOpen(null) }}
        secondary={open.secondary ? { label: open.secondary.label, onClick:()=>setOpen(null) } : null} />}
      {pubDone && <PublishDone preview open={pubDone.open} jobNumber={1026} name="千歳農園" previewJob={PREVIEW_JOB} onClose={()=>setPubDone(null)} />}
    </div>
  );
}
