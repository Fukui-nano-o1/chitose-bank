// 掲載完了の画面（2026-09-02たきと指示「掲載完了アニメーションを削除。Airbnbの完了をパクれ」）。
// 【型＝Airbnbの Publish celebration（コードは流用しない・構成だけ）】掲載を押すと、花火や演出ではなく
//   白い全画面の「おめでとうございます、〇〇さん」＝大きな題名 → 一言のサブタイトル → 掲載した求人のカード
//   （本物の JobCard・公開の姿そのまま）→ 下部固定の「完了」。利用者の選択を待つ（自動では消えない・
//   自動で別のページへも送らない）。旧＝祝祭アニメ（Celebration）＋60秒静止で さがす へ＋選択カード＝全部廃止。
// ・open＝いま公開された（即公開）／false＝公開間近（修正のお願い中の再掲載＝運営の確認を経て公開・2026-08-14）
// ・求人の姿は当事者用の窓口 fetchJobRowForMe で引く（自分の求人so公開前でも読める）。届くまでカードは描かない
//   （ダミーの求人を作らない・憲法3条）。preview＝見本帳・演出一覧用（通信しない・遷移しない・previewJob を描く）
import { useEffect, useState } from "react";
import { fetchJobRowForMe } from "../lib/jobForMe";
import { mapJobPublicRow } from "../lib/utils";
import { JobCard } from "./JobCard";

export function PublishDone({ open = true, jobNumber, name, onClose, preview = false, previewJob = null }) {
  const [job, setJob] = useState(() => (preview ? previewJob : null));
  useEffect(() => {
    if (preview || !jobNumber) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await fetchJobRowForMe(jobNumber);
        if (!cancelled && data) setJob(mapJobPublicRow(data));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [jobNumber, preview]);
  // 名前は2行目に置く＝1行に続けると長い農園名that途中で折れる（実測「千／歳農園さん」）
  const lead = open
    ? "求人が公開されました。働き手の「さがす」に並び、応募が届くとお知らせします。"
    : "求人ができました。公開の準備が整いしだい、働き手に届きます。";
  const goJob = () => { onClose?.(); if (!preview && jobNumber) window.location.hash = "/work/job/" + jobNumber; };
  return (
    /* data-takeover＝この画面の説明（PageGuide）が下の画面へ自動表示しない目印。cb-lock-scroll＝背後のスクロールと
       下部バー・浮遊ボタンを止める（全画面テイクオーバーの家族＝FinalReviewSheet・HireConfirm と同じ器） */
    <div data-takeover="publish-done" className="cb-lock-scroll f-sans" style={{ position:"fixed", inset:0, zIndex:11000, background:"#fff", display:"flex", flexDirection:"column" }}>
      <div style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"calc(56px + env(safe-area-inset-top, 0px)) 24px 24px" }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>
          <h2 className="f-sans" style={{ fontSize:28, fontWeight:800, color:"#222", lineHeight:1.3, margin:"0 0 12px", letterSpacing:"-0.01em" }}>
            おめでとうございます{name ? <>、<br />{name}さん</> : null}
          </h2>
          <p className="f-sans" style={{ fontSize:16, color:"#717171", lineHeight:1.8, margin:"0 0 28px" }}>{lead}</p>
          {job ? (
            <JobCard job={job} variant="wide" onOpen={goJob} hideEndLabel />
          ) : (
            /* 届くまでの間の枠（求人の中身は描かない） */
            <div aria-hidden="true" style={{ height:220, borderRadius:16, background:"#F2F2F2" }} />
          )}
          {open && jobNumber && (
            <button onClick={goJob} className="f-sans" style={{ display:"block", margin:"18px auto 0", background:"none", border:"none", padding:"6px 2px", fontSize:15, fontWeight:700, color:"#222", textDecoration:"underline", cursor:"pointer" }}>掲載した求人を見る</button>
          )}
        </div>
      </div>
      <div style={{ flexShrink:0, borderTop:"1px solid #EBEBEB", padding:"14px 24px calc(14px + env(safe-area-inset-bottom, 0px))", background:"#fff" }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>
          <button onClick={() => onClose?.()} className="f-sans" style={{ width:"100%", padding:"15px", fontSize:16, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:8, cursor:"pointer" }}>完了</button>
        </div>
      </div>
    </div>
  );
}
