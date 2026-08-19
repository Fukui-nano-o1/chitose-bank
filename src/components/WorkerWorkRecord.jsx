// 働き手の「はたらいた記録」（2026-08-05たきと指示）。
// 農家が働き手を確認するときに見る面。働き手ダッシュボード（#/admin/evaluation）と
// 働き手プレビュー（ボックス展開の横スワイプ2枚目）の両方が、この1つの部品を使う
// ＝見た目と数え方がページごとにズレない。
//
// 中身：① 直近5件に欠勤はあるか ② 働いた回数・時間・欠勤 ③ 作物別・作業別の件数と時間
//
// 【この画面が言わないこと】点数・順位・おすすめ度は作らない。良し悪しの断定もしない。
//   出すのは記録そのもの（出欠・求人の勤務時間）だけ。運営の主観は混ぜない（2026-07-16）。
//   遅刻の判定は持たない（2026-08-18「打刻の全面削除」）＝開始時刻は自動で入るので、
//   その時刻から遅刻を導くと憶測になる。数えるのは記録として残る欠勤だけ。
//
// 【見える人】worker_work_record の関係ゲート＝本人・その働き手から応募を受けた農家・運営だけ
//   （2026-08-05たきと指示で管理者専用を撤回。worker_trust_info と同じ相手・同じ範囲）。
//   不特定の農家・訪問者には出ない。権限がない人には短い1行を出すだけ（エラー画面にしない）。
//   求人No.は運営と本人にだけ返る＝閲覧する農家からは相手先の求人を辿れない（DB側で伏せている）。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { getCache, setCache } from "../lib/viewCache";
import { Dots } from "./ui";

export const workRecordMinutesLabel = (min) => {
  if (min == null) return "ー";
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
};
const hm = workRecordMinutesLabel;

// 大きい数字（回数・時間・欠勤）。ラベルは折り返さない＝「働いた回／数」と割れない
function BigStat({ label, value, unit, tone }) {
  return (
    <div style={{ flex:"1 1 0", minWidth:0, background:"#FAFAFA", borderRadius:12, padding:"12px 4px", textAlign:"center" }}>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 4px", whiteSpace:"nowrap" }}>{label}</p>
      <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:tone || "#222", margin:0, lineHeight:1.2, whiteSpace:"nowrap" }}>
        {value}<span style={{ fontSize:12, fontWeight:700, marginLeft:2 }}>{unit}</span>
      </p>
    </div>
  );
}

// 作物別・作業別の内訳（件数の多い順にDBが並べたものをそのまま出す）
function Breakdown({ title, rows }) {
  return (
    <div style={{ flex:"1 1 240px", minWidth:0 }}>
      <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:"#717171", margin:"0 0 6px" }}>{title}</p>
      {rows.length === 0 ? (
        <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:0 }}>記録がありません</p>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {rows.map(r => (
            <div key={r.key} className="f-sans" style={{ display:"flex", alignItems:"baseline", gap:8, fontSize:12, borderBottom:"1px solid #F5F5F5", paddingBottom:5 }}>
              <span style={{ color:"#222", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.key}</span>
              <span style={{ color:"#222", fontWeight:700, flexShrink:0 }}>{r.count}件</span>
              <span style={{ color:"#717171", flexShrink:0, width:72, textAlign:"right" }}>{r.minutes ? hm(r.minutes) : "ー"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 記録の本体。showName=名前を出す（ダッシュボードでは出す・プレビューは上に名刺があるので出さない）
export function WorkRecordBody({ data, showName }) {
  const t = data.totals || {};
  const recent = data.recent || [];
  // 直近5件の要約＝この面で農家がまず知りたい1行（数えるのは記録に残る欠勤だけ）
  const absentCount = recent.filter(r => r.attended === false).length;
  const clean = absentCount === 0;
  return (<>
    <div className="ledger-card" style={{ padding:"16px", marginBottom:12 }}>
      {showName && <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{data.worker?.name || "名前未設定"}</p>}

      {/* ② 働いた回数・時間・欠勤 */}
      <div style={{ display:"flex", gap:8 }}>
        <BigStat label="件数" value={t.completed_count ?? 0} unit="件" />
        <BigStat label="時間" value={Math.floor((t.total_minutes ?? 0) / 60)} unit="時間" />
        <BigStat label="欠勤" value={t.absent_count ?? 0} unit="件" tone={(t.absent_count ?? 0) > 0 ? "#E24B4A" : "#222"} />
      </div>
      {(t.unknown_time_count ?? 0) > 0 && (
        <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"6px 0 0" }}>うち{t.unknown_time_count}件は勤務時間の記録がなく、時間に含めていません</p>
      )}
    </div>

    {/* ① 直近5件の欠勤：要約チップのみ。回ごとの明細行（日付・予定時刻・判定）は
        2026-08-07たきと指示「丸ごと消せ」で削除した＝日付×時刻から過去の求人を辿らせない徹底。
        遅刻は数えない（2026-08-18・打刻の全面削除＝判定の材料が無い） */}
    <div className="ledger-card" style={{ padding:"16px", marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
        <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:0 }}>直近5件</p>
        {recent.length > 0 && (
          <span className="f-sans" style={{ fontSize:11, fontWeight:800, borderRadius:20, padding:"3px 10px",
            color: clean ? "#00A86B" : "#E24B4A", background: clean ? "#E6F7EF" : "#FDECEC" }}>
            {clean ? "欠勤なし" : `欠勤${absentCount}件`}
          </span>
        )}
      </div>
      {recent.length === 0 && (
        <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"8px 0 0" }}>働いた記録がまだありません</p>
      )}
    </div>

    {/* ③ 作物別・作業別 */}
    <div className="ledger-card" style={{ padding:"16px", marginBottom:12 }}>
      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        <Breakdown title="作物別" rows={data.by_crop || []} />
        <Breakdown title="作業別" rows={data.by_task || []} />
      </div>
    </div>

    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, margin:"14px 2px 0" }}>
      すべて記録から出しています。時間は求人の勤務時間から数えています（休憩は引いていません）。
      遅刻の判定はしません（開始時刻は自動で記録されるため、そこから遅刻を決めつけません）。
      点数や順位は付けません。
    </p>
  </>);
}

// 読み込みつきの1人ぶん。ダッシュボードもプレビューもこれを置くだけ
export function WorkerWorkRecord({ workerId, showName }) {
  const cacheKey = `workRecord:${workerId}`;
  const [state, setState] = useState(() => {
    const d = getCache(cacheKey);
    return d?.ok ? d : null;
  }); // null=読み込み中 | データ | "error" | "denied"
  const load = useCallback(async () => {
    const cached = getCache(cacheKey);
    setState(cached?.ok ? cached : null);
    const { data, error } = await supabase.rpc("worker_work_record", { p_worker_id: workerId });
    // 裏の再取得が失敗しても、キャッシュ表示中ならそのまま保つ（エラー画面で上書きしない）
    if (error) { setState(prev => (prev && typeof prev === "object") ? prev : "error"); return; }
    if (!data?.ok) { setState(data?.reason === "not_entitled" ? "denied" : "error"); return; }
    setCache(cacheKey, data);
    setState(data);
  }, [cacheKey, workerId]);
  useEffect(() => { load(); }, [load]);

  if (state === null) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>;
  if (state === "denied") return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>この方のはたらいた記録は表示できません</p>;
  if (state === "error") return <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"40px 0" }}>読み込みに失敗しました。開き直してください</p>;
  return <WorkRecordBody data={state} showName={showName} />;
}
