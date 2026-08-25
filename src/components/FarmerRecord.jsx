// 農家の「受け入れの記録」（2026-08-24たきと指示「農家プレビューも働き手プレビューと同じ構造に。
// プロフィール、記録、評価」）。働き手側の components/WorkerWorkRecord と対になる面＝
// プロフィール＝人となり／記録＝数字／評価＝相手の回答、の分け方を両役割で揃える。
//
// 中身：受け入れた人数・掲載した求人（公開中／終了）・受け入れ中の内訳・承認までの時間。
// ★材料は employer_trust_info（プレビューが既に取っている trust）だけ＝この面のための往復を増やさない。
//   数字の意味・集計・見える範囲はDB側が決める（ここは表示するだけ）。
// 【この面が言わないこと】点数・順位・おすすめ度は作らない。運営の主観は混ぜない（2026-07-16）。
//   誰を受け入れたか（相手が誰か）は出さない＝出すのは数だけ。
import { NavIconInline } from "./NavIcons";

// 大きい数字。働き手の記録（WorkerWorkRecord の BigStat）と同じ見た目に揃えてある
function BigStat({ label, value, unit }) {
  return (
    <div style={{ flex:"1 1 0", minWidth:0, background:"#FAFAFA", borderRadius:12, padding:"12px 4px", textAlign:"center" }}>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 4px", whiteSpace:"nowrap" }}>{label}</p>
      <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.2, whiteSpace:"nowrap" }}>
        {value}<span style={{ fontSize:12, fontWeight:700, marginLeft:2 }}>{unit}</span>
      </p>
    </div>
  );
}

export function FarmerRecord({ trust }) {
  const ok = !!(trust && trust.ok);
  const hires = ok ? (trust.completed_hires || 0) : 0;
  const openJobs = ok ? (trust.open_jobs || 0) : 0;
  const endedJobs = ok ? (trust.ended_jobs || 0) : 0;
  const applied = ok ? (trust.active_applied || 0) : 0;
  const approved = ok ? (trust.active_approved || 0) : 0;
  const hired = ok ? (trust.active_hired || 0) : 0;
  const avgH = ok ? trust.avg_approval_hours : null;
  // 何ひとつ記録が無い＝「まだありません」と明記する（空の面を黙らせない・2026-08-24）
  const empty = hires === 0 && openJobs === 0 && endedJobs === 0 && applied + approved + hired === 0;
  if (!ok || empty) {
    return <p className="f-sans" style={{ fontSize:12, color:"#999", padding:"12px 0", margin:0 }}>まだ記録はありません</p>;
  }
  return (<>
    <div className="ledger-card" style={{ padding:"16px", marginBottom:12 }}>
      <div style={{ display:"flex", gap:8 }}>
        <BigStat label="受け入れ" value={hires} unit="人" />
        <BigStat label="公開中" value={openJobs} unit="件" />
        <BigStat label="終了した求人" value={endedJobs} unit="件" />
      </div>
    </div>

    {(applied + approved + hired > 0 || avgH != null) && (
      <div className="ledger-card" style={{ padding:"16px", marginBottom:12 }}>
        {applied + approved + hired > 0 && (
          <p className="f-sans" style={{ fontSize:13, color:"#222", margin:"0 0 6px" }}>
            <NavIconInline name="inbox" size={13} />受け入れ中：応募{applied}件・承認{approved}件・採用{hired}人
          </p>
        )}
        {avgH != null && (
          <p className="f-sans" style={{ fontSize:13, color:"#222", margin:0 }}>
            <NavIconInline name="clock" size={13} />承認までの時間：平均{avgH}時間
          </p>
        )}
      </div>
    )}

    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, margin:"14px 2px 0" }}>
      すべて記録から出しています。受け入れは、作業が完了した人数です。
      誰を受け入れたかは出しません。点数や順位は付けません。
    </p>
  </>);
}
