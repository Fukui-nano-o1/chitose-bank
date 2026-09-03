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
import { DoneScreen } from "./DoneScreen";

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
    <DoneScreen takeover="publish-done"
      title={<>おめでとうございます{name ? <>、<br />{name}さん</> : null}</>}
      lead={lead}
      primary={{ label:"完了", onClick: () => onClose?.() }}
      secondary={open && jobNumber ? { label:"掲載した求人を見る", onClick: goJob } : null}>
      {job ? (
        <JobCard job={job} variant="wide" onOpen={goJob} hideEndLabel />
      ) : (
        /* 届くまでの間の枠（求人の中身は描かない） */
        <div aria-hidden="true" style={{ height:220, borderRadius:16, background:"#F2F2F2" }} />
      )}
    </DoneScreen>
  );
}
