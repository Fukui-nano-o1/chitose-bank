// 農家の「受け入れの記録」（2026-08-24たきと指示「農家プレビューも働き手プレビューと同じ構造に。
// プロフィール、記録、評価」）。働き手側の components/WorkerWorkRecord と対になる面＝
// プロフィール＝人となり／記録＝数字／評価＝相手の回答、の分け方を両役割で揃える。
//
// 2026-08-31たきと指示「記録ページをAirbnbにして。パクれ。応募中と終了した求人は求人カードとして表示。」
// ＝Airbnbのホストプロフィールと同じ視覚言語（振る舞いだけ・コードは写さない）：
//   上＝大きな数字を罫線で区切って積んだ統計カード／下＝掲載一覧のカードの横並び（公開中／終了した求人）。
// ★数字の材料は employer_trust_info（プレビューが既に取っている trust）のまま＝意味・集計・見える範囲はDB側。
// ★求人カードの材料は employer_public_jobs_by_farmer（migration 20260831134249）＝jobs_public の行を
//   そのまま返す姉妹RPC。公開の姿（anonマスク・停止の除外・open または満員closed）を継承し開示を広げない
//   ＝jobs_public に無い終了求人はカードにならない（統計の件数よりカードが少ないことがある＝正直な差）。
// 【この面が言わないこと】点数・順位・おすすめ度は作らない。運営の主観は混ぜない（2026-07-16）。
//   誰を受け入れたか（相手が誰か）は出さない＝出すのは数と、もともと公開されている求人だけ。
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { mapJobPublicRow } from "../lib/utils";
import { getCache, setCache } from "../lib/viewCache";
import { NavIconInline } from "./NavIcons";
import { JobRow } from "./ui";
import { JobCard } from "./JobCard";

// Airbnbのホストプロフィールの統計と同じ型：大きな数字＋小さなラベルを、罫線で区切って縦に積む
function StatRow({ value, unit, label, last }) {
  return (
    <div style={{ padding:"13px 2px", borderBottom: last ? "none" : "1px solid #EBEBEB" }}>
      <p className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:0, lineHeight:1.2 }}>
        {value}<span style={{ fontSize:12, fontWeight:700, marginLeft:2 }}>{unit}</span>
      </p>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"3px 0 0" }}>{label}</p>
    </div>
  );
}

// 求人カードの横並びの1区画（公開中／終了した求人で共用）
// ★見出しに件数は付けない：カードは「公開の姿（jobs_public）に残っているものだけ」で、
//   上の統計（jobsテーブル全体の数）より少ないことがある＝2つの数字を並べて矛盾に見せない
function JobSection({ title, jobs, hideEndLabel, onOpenJob }) {
  if (jobs.length === 0) return null;
  return (
    <div style={{ marginBottom:18 }}>
      <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 10px" }}>{title}</p>
      <JobRow count={jobs.length}>
        {jobs.map(j => (
          <JobCard key={j.id} job={j} hideEndLabel={hideEndLabel}
            onOpen={onOpenJob ? () => onOpenJob(j.id) : undefined} />
        ))}
      </JobRow>
    </div>
  );
}

export function FarmerRecord({ trust, farmerId, onOpenJob }) {
  const ok = !!(trust && trust.ok);
  const hires = ok ? (trust.completed_hires || 0) : 0;
  const openJobs = ok ? (trust.open_jobs || 0) : 0;
  const endedJobs = ok ? (trust.ended_jobs || 0) : 0;
  const applied = ok ? (trust.active_applied || 0) : 0;
  const approved = ok ? (trust.active_approved || 0) : 0;
  const hired = ok ? (trust.active_hired || 0) : 0;
  const avgH = ok ? trust.avg_approval_hours : null;

  // 求人カードの材料＝jobs_public の生の行（JSON安全）。mapJobPublicRow は Date を作るので、
  // キャッシュには生の行を置き、描く時に整形する（viewCacheにDateを入れない・2026-08-03規則）
  const [rows, setRows] = useState(() => (farmerId && getCache("preview:ejobs:" + farmerId)) || null);
  useEffect(() => {
    if (!farmerId) return;
    setRows(getCache("preview:ejobs:" + farmerId) || null);
    let alive = true;
    Promise.resolve(supabase.rpc("employer_public_jobs_by_farmer", { p_farmer_id: farmerId }))
      .then(res => {
        if (!alive) return;
        // 失敗（res.error）や想定外の形では手元の値を上書きしない（2026-08-07規則）
        if (res?.error || !Array.isArray(res?.data)) return;
        setRows(res.data);
        setCache("preview:ejobs:" + farmerId, res.data);
      }).catch(() => {});
    return () => { alive = false; };
  }, [farmerId]);
  const jobs = useMemo(
    () => (rows || []).map(mapJobPublicRow).sort((a, b) => (b.id || 0) - (a.id || 0)),
    [rows]
  );
  // 区画の分け方は統計と同じ物差し（employer_trust_info・migration 20260831135021）＝
  // 終了＝closed または 期間が過ぎた open／公開中＝それ以外。
  // 公開中の側は終了帯（募集終了（満員）等）を既定どおり出す＝満員は正直に見せる。
  // 終了の側は区画見出しが「終了」を語るので帯を重ねない（hideEndLabel・2026-08-23の作法）
  const recruiting = useMemo(() => jobs.filter(j => !j.closed && !j.expired), [jobs]);
  const endedCards = useMemo(() => jobs.filter(j => j.closed || j.expired), [jobs]);

  // 何ひとつ記録が無い＝「まだありません」と明記する（空の面を黙らせない・2026-08-24）
  const empty = hires === 0 && openJobs === 0 && endedJobs === 0 && applied + approved + hired === 0 && jobs.length === 0;
  if (!ok || empty) {
    return <p className="f-sans" style={{ fontSize:12, color:"#999", padding:"12px 0", margin:0 }}>まだ記録はありません</p>;
  }
  return (<>
    {/* 統計カード（Airbnbのホストプロフィールの型：枠線1本の白いカードに、数字の行を罫線で積む） */}
    <div style={{ border:"1px solid #EBEBEB", borderRadius:16, padding:"4px 18px", marginBottom:14 }}>
      <StatRow value={hires} unit="人" label="受け入れ" />
      <StatRow value={openJobs} unit="件" label="公開中の求人" />
      <StatRow value={endedJobs} unit="件" label="終了した求人" last={avgH == null} />
      {avgH != null && <StatRow value={avgH} unit="時間" label="承認までの時間（平均）" last />}
    </div>

    {applied + approved + hired > 0 && (
      <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 18px" }}>
        <NavIconInline name="inbox" size={12} />受け入れ中：応募{applied}件・承認{approved}件・採用{hired}人
      </p>
    )}

    {/* 掲載一覧（Airbnbの「掲載一覧」のカルーセルの型）。カードは本物の JobCard＝さがすと同じ顔。
        タップは onOpenJob（親＝プレビューが閉じてから求人ページへ）。渡されなければ別タブ（JobCardの既定） */}
    <JobSection title="公開中の求人" jobs={recruiting} onOpenJob={onOpenJob} />
    <JobSection title="終了した求人" jobs={endedCards} hideEndLabel onOpenJob={onOpenJob} />

    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, margin:"14px 2px 0" }}>
      すべて記録から出しています。受け入れは、作業が完了した人数です。
      誰を受け入れたかは出しません。点数や順位は付けません。
    </p>
  </>);
}
