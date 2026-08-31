// 農家の「受け入れの記録」（2026-08-24たきと指示「農家プレビューも働き手プレビューと同じ構造に。
// プロフィール、記録、評価」）。働き手側の components/WorkerWorkRecord と対になる面。
//
// 2026-08-31たきと指示「Airbnbの設計をまるパクリしろ。」＝Airbnbのホストプロフィールページの
// 構成を1:1で写した（★コード・画像・ブランド色は写せない＝プロプライエタリ。写すのは構成と寸法の言語）：
//   ①プロフィールカード＝白いカード（角丸24・影）・左にアバター（確認済みバッジ重ね）＋名前・
//     右に統計を罫線で区切って縦積み（Airbnbの「レビュー／評価／ホスト歴」の列と同じ型）
//   ②「〇〇さんの確認済み情報」＝チェックの列（Airbnbの本人確認セクションの型）
//   ③返答情報の行（Airbnbの「返答率／返答所要時間」の型）＝承認までの時間・受け入れ中
//   ④「〇〇さんの掲載一覧」＝求人カードの横並びカルーセル（公開中／終了した求人の2区画）
//   各セクションは細い罫線（#EBEBEB）で区切る＝Airbnbのプロフィールページと同じ区切り方。
// ★数字の材料は employer_trust_info（プレビューが既に取っている trust）のまま＝意味・集計・見える範囲はDB側。
// ★求人カードの材料は employer_public_jobs_by_farmer（migration 20260831134249）＝jobs_public の行を
//   そのまま返す姉妹RPC。公開の姿（anonマスク・停止の除外・open または満員closed）を継承し開示を広げない
//   ＝jobs_public に無い終了求人はカードにならない（統計の件数よりカードが少ないことがある＝正直な差）。
// 【この面が言わないこと】点数・順位・おすすめ度は作らない。運営の主観は混ぜない（2026-07-16）。
//   誰を受け入れたか（相手が誰か）は出さない＝出すのは数と、もともと公開されている求人だけ。
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { mapJobPublicRow, ROLE_GREEN } from "../lib/utils";
import { getCache, setCache } from "../lib/viewCache";
import { NavIcon, NavIconInline } from "./NavIcons";
import { Avatar, JobRow } from "./ui";
import { JobCard } from "./JobCard";

// プロフィールカードの右列の1行（Airbnbの「173 レビュー」の型＝太い数字の下に小さなラベル・罫線区切り）
function StatRow({ value, unit, label, last }) {
  return (
    <div style={{ padding:"8px 0", borderBottom: last ? "none" : "1px solid #EBEBEB" }}>
      <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:0, lineHeight:1.2, whiteSpace:"nowrap" }}>
        {value}<span style={{ fontSize:11, fontWeight:700, marginLeft:1 }}>{unit}</span>
      </p>
      <p className="f-sans" style={{ fontSize:10, fontWeight:600, color:"#222", margin:"1px 0 0", whiteSpace:"nowrap" }}>{label}</p>
    </div>
  );
}

// セクションの区切り（Airbnbのプロフィールページの細い罫線）
const sectionStyle = { borderTop:"1px solid #EBEBEB", marginTop:22, paddingTop:22 };
// セクション見出し（Airbnbの「〇〇さんの掲載一覧」の型）
const headingStyle = { fontSize:18, fontWeight:800, color:"#222", margin:"0 0 14px" };

// 求人カードの横並びの1区画（公開中／終了した求人で共用）
// ★見出しに件数は付けない：カードは「公開の姿（jobs_public）に残っているものだけ」で、
//   上の統計（jobsテーブル全体の数）より少ないことがある＝2つの数字を並べて矛盾に見せない
function JobSection({ title, jobs, hideEndLabel, onOpenJob }) {
  if (jobs.length === 0) return null;
  return (
    <div style={sectionStyle}>
      <p className="f-sans" style={headingStyle}>{title}</p>
      <JobRow count={jobs.length}>
        {jobs.map(j => (
          <JobCard key={j.id} job={j} hideEndLabel={hideEndLabel}
            onOpen={onOpenJob ? () => onOpenJob(j.id) : undefined} />
        ))}
      </JobRow>
    </div>
  );
}

export function FarmerRecord({ trust, profile, farmerId, onOpenJob }) {
  const ok = !!(trust && trust.ok);
  const hires = ok ? (trust.completed_hires || 0) : 0;
  const openJobs = ok ? (trust.open_jobs || 0) : 0;
  const endedJobs = ok ? (trust.ended_jobs || 0) : 0;
  const applied = ok ? (trust.active_applied || 0) : 0;
  const approved = ok ? (trust.active_approved || 0) : 0;
  const hired = ok ? (trust.active_hired || 0) : 0;
  const avgH = ok ? trust.avg_approval_hours : null;
  const name = (profile && profile.nickname) || "この農家";

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
    {/* ① プロフィールカード（Airbnbのホストプロフィール最上部の型）：
        左＝アバター（確認済みバッジを右下に重ねる）＋名前＋肩書き／右＝統計の縦積み。
        影のカード＝Airbnbと同じ「枠線でなく影で浮かせる」作法（バッジの色だけ役割色＝ブランド色は写さない） */}
    <div style={{ background:"#fff", borderRadius:24, boxShadow:"0 6px 20px rgba(0,0,0,0.14)", padding:"22px 20px", display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flex:"1.3 1 0", minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center" }}>
        <div style={{ position:"relative", width:96, height:96 }}>
          <Avatar url={profile?.avatar_url} name={name} size={96} bg={ROLE_GREEN} />
          {ok && trust.id_checked && (
            <span aria-label="連絡先確認済み" style={{ position:"absolute", right:-4, bottom:2, width:30, height:30, borderRadius:"50%", background:ROLE_GREEN, border:"3px solid #fff", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff" }}>
              <NavIcon name="tick" size={14} />
            </span>
          )}
        </div>
        <p className="f-sans" style={{ fontSize:24, fontWeight:800, color:"#222", margin:"10px 0 0", lineHeight:1.2, maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</p>
        <p className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#222", margin:"3px 0 0" }}>農家</p>
      </div>
      <div style={{ flex:"1 1 0", minWidth:0, maxWidth:140 }}>
        <StatRow value={hires} unit="人" label="受け入れ" />
        <StatRow value={openJobs} unit="件" label="公開中の求人" />
        <StatRow value={endedJobs} unit="件" label="終了した求人" last />
      </div>
    </div>

    {/* ② 確認済み情報（Airbnbの「〇〇さんの確認済み情報」の型）。
        出すのは記録にある事実だけ＝連絡先確認・利用開始（無いものはダミーで埋めない・憲法3条） */}
    {(trust.id_checked || trust.member_since) && (
      <div style={sectionStyle}>
        <p className="f-sans" style={headingStyle}>{name}さんの確認済み情報</p>
        {trust.id_checked && (
          <p className="f-sans" style={{ fontSize:14, color:"#222", margin:"0 0 10px" }}>
            <NavIconInline name="tick" size={14} style={{ verticalAlign:"-2px", marginRight:8 }} />連絡先の確認済み
          </p>
        )}
        {trust.member_since && (
          <p className="f-sans" style={{ fontSize:14, color:"#222", margin:0 }}>
            <NavIconInline name="tick" size={14} style={{ verticalAlign:"-2px", marginRight:8 }} />chitose-bank利用{trust.member_since}から
          </p>
        )}
      </div>
    )}

    {/* ③ 返答情報の行（Airbnbの「返答率：100%／返答所要時間：1時間以内」の型） */}
    {(avgH != null || applied + approved + hired > 0) && (
      <div style={sectionStyle}>
        {avgH != null && (
          <p className="f-sans" style={{ fontSize:14, color:"#222", margin: applied + approved + hired > 0 ? "0 0 10px" : 0 }}>
            承認までの時間：平均{avgH}時間
          </p>
        )}
        {applied + approved + hired > 0 && (
          <p className="f-sans" style={{ fontSize:14, color:"#222", margin:0 }}>
            受け入れ中：応募{applied}件・承認{approved}件・採用{hired}人
          </p>
        )}
      </div>
    )}

    {/* ④ 掲載一覧（Airbnbの「〇〇さんの掲載一覧」のカルーセルの型）。カードは本物の JobCard＝
        さがすと同じ顔。タップは onOpenJob（親＝プレビューが閉じてから求人ページへ）。
        渡されなければ別タブ（JobCardの既定） */}
    <JobSection title={name + "さんの掲載一覧"} jobs={recruiting} onOpenJob={onOpenJob} />
    <JobSection title="終了した求人" jobs={endedCards} hideEndLabel onOpenJob={onOpenJob} />

    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, margin:"18px 2px 0" }}>
      すべて記録から出しています。受け入れは、作業が完了した人数です。
      誰を受け入れたかは出しません。点数や順位は付けません。
    </p>
  </>);
}
