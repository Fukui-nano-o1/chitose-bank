// アニメーションページ（#/admin/animations・管理者専用・2026-08-07たきと指示
// 「アニメーションカードを追加。そこで実機の確認と編集を行う。実物と同じものをもってこい」）。
// 見本帳（AdminFarmerPagesRoom）と同じ方針＝似せて描かず【本物の部品をそのまま再生する】：
// components/Celebration（祝祭v2・音と振動つき）を本番と同じpropsで呼ぶので、
// 本物を変えればこのページも自動で追従する（写し間違い・経年ズレthaが構造的に起きない）。
// ★CELEBRATIONS の props は本番の呼び出しの写し。本番側の絵文字・文言を変えたらここも合わせること
//   （洗い出しは grep "<Celebration" と grep "setCelebrate({"）。
// 読み取り専用＝supabaseをimportしない。試し打ちの入力はその場の再生にだけ使い、どこにも保存しない。
import { useState } from "react";
import { Celebration } from "../Celebration";
import { PublishDone } from "../PublishDone";

// 本番で祝祭（Celebration）が出る全場面（2026-08-19時点・10場面）。
// where＝どの画面のどの操作で出るか／src＝呼び出し元ファイル
// ★2026-08-19たきと指示「アニメーションにアイコンや絵は使うな」＝祝祭から絵文字とビジュアル
//   （働き手アイコン→求人カード）を廃止した。出るのは題字だけso、このリストも題字だけを持つ。
//   ここに絵の欄を復活させないこと。
// ※「作業が始まりました（🌅・開始の確認）」は本番から消えていたので一覧から外した（2026-08-19確認）。
const CELEBRATIONS = [
  { title:"応募できました",             where:"応募を送った直後", src:"App.jsx" },
  { title:"2件を届けました",            where:"仮応募の昇格（プロフィール完成で届いた時）", src:"App.jsx", note:"件数は promotedCount の実数。ここでは2件で再生" },
  { title:"仮応募をお預かりしました",   where:"プロフィール未完成のまま応募した直後", src:"App.jsx" },
  // 掲載完了の祝祭2種は廃止（2026-09-02たきと指示「掲載完了アニメーションを削除」）＝下の「静止の画面」へ
  { title:"承認しました",               where:"応募者ページで応募を承認", src:"FarmerDashboard.jsx" },
  { title:"おつかれさまでした",         where:"バイトの評価（農家）", src:"FarmerDashboard.jsx" },
  { title:"ありがとうございました",     where:"働き手の評価送信", src:"WorkerApplications.jsx" },
  { title:"報告しました",               where:"保険の準備の報告", src:"features/today/components/StagePanels.jsx" },
  { title:"ありがとうございます",       where:"働き手フロー完了（構想段階の導線）", src:"App.jsx" },
];
// 部品の中に埋まっていて切り出せないアニメーション＝本物のいる場所へ飛んで確認する
// （コピーを作ると本物と乖離するので、リンクだけ置く）
const EMBEDDED = [
  { l:"採用の押印（文字の印・広がる輪・光の粒）", hash:"/calendar/todo/hire",  where:"採用するページ。採用を実行した時" },
  { l:"委託ページの入場演出（幕・草・太陽・花火）", hash:"/admin/consignment", where:"委託 準備室を開いた時" },
  // 2026-09-01たきと指示「アニメーションもだ」＝求人詳細の写真まわりの動き（Airbnbの写し）
  { l:"求人詳細の写真（重なる影・ふわり・写真の一覧の開閉）", hash:"/search",
    where:"さがす → 求人を開く → 写真に指を乗せる／タップして一覧を開く・閉じる" },
];

// 掲載完了の画面のpreviewに渡す見本の求人（JobCardにそのまま渡す形・架空）
const PREVIEW_JOB = { id:1026, crop:"ブロッコリー", task:"収穫", region:"吉野川市", pay:9000, payType:"日給", photos:[], dateStartRaw:"2026-10-05", dateEndRaw:"2026-10-09", closed:false, expired:false };

export function AdminAnimationsRoom() {
  const [playing, setPlaying] = useState(null); // {title,after} 再生中の祝祭（絵は持たない・2026-08-19）
  const [pubDone, setPubDone] = useState(null);     // 掲載完了の画面（Airbnbの型・静止）のpreview { open }
  const [tryTitle, setTryTitle] = useState("おめでとうございます");
  return (
    /* cb-admin-page＝サイトフッターを隠す目印。下余白＝下部バー＋☰ぶん（2026-08-07規約） */
    <div className="appear cb-admin-page" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px", paddingBottom:"calc(140px + env(safe-area-inset-bottom, 0px))" }}>
      <div style={{ marginBottom:14 }}>
        <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:0 }}>アニメーション</p>
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>本番と同じ部品（Celebration）を同じ文言で再生します。音と振動も本番どおり</p>
      </div>

      {CELEBRATIONS.map((c, i) => (
        <button key={i} onClick={()=>{ setPlaying({ title:c.title, after:c.after || null }); }} className="f-sans"
          style={{ width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"12px 14px", marginBottom:10, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ minWidth:0, flex:1 }}>
            <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{c.title}</span>
            <span className="f-sans" style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>{c.where}（{c.src}）{c.note ? `・${c.note}` : ""}</span>
          </span>
          <span className="f-sans" style={{ flexShrink:0, fontSize:12, fontWeight:700, color:"#fff", background:"#222", borderRadius:16, padding:"7px 14px" }}>再生</span>
        </button>
      ))}

      {/* 掲載完了＝アニメでなく静止の全画面（Airbnbの Publish celebration の型・2026-09-02）。本物の PublishDone を
          preview（通信も遷移もしない・見本の求人を描く）で開く */}
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"18px 0 8px" }}>掲載完了の画面（アニメでなく静止・Airbnbの型）</p>
      {[{ l:"求人の掲載（即公開）", open:true }, { l:"求人の掲載（公開間近＝修正のお願い中の再掲載）", open:false }].map((e, i) => (
        <button key={i} onClick={()=>setPubDone({ open:e.open })} className="f-sans"
          style={{ width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"12px 14px", marginBottom:10, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ minWidth:0, flex:1 }}>
            <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{e.l}</span>
            <span className="f-sans" style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>「おめでとうございます、〇〇さん」＋掲載した求人のカード＋「完了」（App.jsx / components/PublishDone.jsx）</span>
          </span>
          <span className="f-sans" style={{ flexShrink:0, fontSize:12, fontWeight:700, color:"#fff", background:"#222", borderRadius:16, padding:"7px 14px" }}>開く</span>
        </button>
      ))}

      {/* 試し打ち（編集の下書き）：絵文字と文言を変えて実機で確かめる。保存はしない＝本番を変えるのはコード側 */}
      <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"14px", margin:"18px 0 10px" }}>
        <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:"0 0 4px" }}>試し打ち</p>
        <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"0 0 10px" }}>文言を変えて再生できます（この場だけ・どこにも保存されません）。決まったら文言を伝えてください＝本番に反映します</p>
        <div style={{ display:"flex", gap:8, marginBottom:10 }}>
          <input value={tryTitle} onChange={e=>setTryTitle(e.target.value)} className="field f-sans" style={{ flex:1, marginBottom:0, fontSize:14 }} aria-label="文言" placeholder="表示する文言" />
        </div>
        <button onClick={()=>setPlaying({ title: tryTitle.trim() || "おめでとうございます" })} className="f-sans"
          style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>この内容で再生</button>
      </div>

      {/* ページに埋め込みのアニメーション＝実物のいる場所へ */}
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"18px 0 8px" }}>ページ埋め込みのアニメーション（実物の場所で確認）</p>
      {EMBEDDED.map((e, i) => (
        <button key={i} onClick={()=>{ window.location.hash = e.hash; }} className="f-sans"
          style={{ width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"12px 14px", marginBottom:10, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ minWidth:0, flex:1 }}>
            <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{e.l}</span>
            <span className="f-sans" style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>{e.where}</span>
          </span>
          <span className="f-sans" style={{ flexShrink:0, fontSize:12, fontWeight:700, color:"#555" }}>開く →</span>
        </button>
      ))}

      {/* 再生（本物のCelebration・pointer-events:none・約3秒で自動終了） */}
      {playing && <Celebration title={playing.title}
        onDone={()=>setPlaying(null)} />}
      {pubDone && <PublishDone preview open={pubDone.open} jobNumber={1026} name="千歳農園" previewJob={PREVIEW_JOB} onClose={()=>setPubDone(null)} />}
    </div>
  );
}
