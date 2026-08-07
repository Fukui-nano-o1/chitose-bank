// 働き手の「はたらいた記録」（2026-08-05たきと指示）。
// 農家が働き手を確認するときに見る面。働き手ダッシュボード（#/admin/evaluation）と
// 働き手プレビュー（ボックス展開の横スワイプ2枚目）の両方が、この1つの部品を使う
// ＝見た目と数え方がページごとにズレない。
//
// 中身：① 直近5件に遅刻・欠勤はあるか ② 働いた回数・時間・欠勤 ③ 作物別・作業別の件数と時間
//
// 【この画面が言わないこと】点数・順位・おすすめ度は作らない。良し悪しの断定もしない。
//   出すのは記録そのもの（打刻・出欠・求人の勤務時間）だけ。運営の主観は混ぜない（2026-07-16）。
//   打刻が無い・自動開始の回は「記録なし」と正直に書く＝憶測で遅刻にも時間どおりにもしない。
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

// 1回ぶんの打刻の読み方。判定できないものは判定しない（no_record）
export function punchOf(r) {
  if (r.attended === false) return { key:"absent", label:"欠勤", color:"#E24B4A", bg:"#FDECEC" };
  if (r.late_minutes == null) return { key:"no_record", label:"記録なし", color:"#999", bg:"#F5F5F5" };
  if (r.late_minutes >= 1) return { key:"late", label:`遅刻 ${r.late_minutes}分`, color:"#E24B4A", bg:"#FDECEC" };
  return { key:"on_time", label:"時間どおり", color:"#00A86B", bg:"#E6F7EF" };
}

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
  // 閲覧された回数の説明は？タップで展開（2026-08-07たきと指示・常時表示をやめる）
  const [showViewHelp, setShowViewHelp] = useState(false);
  // 直近5件の要約＝この面で農家がまず知りたい1行
  const lateCount = recent.filter(r => punchOf(r).key === "late").length;
  const absentCount = recent.filter(r => punchOf(r).key === "absent").length;
  const clean = lateCount === 0 && absentCount === 0;
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
      {/* 閲覧された回数（2026-08-07たきと裁定）：匿名カウンター＝誰が見たかは記録していない。
          DBが本人・運営にだけ値を返す（農家にはキーがnull）＝この枠は本人と運営にしか出ない */}
      {data.profile_view_count != null && (
        <>
          <div style={{ marginTop:8, background:"#FAFAFA", borderRadius:12, padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span className="f-sans" style={{ fontSize:11, color:"#717171" }}>閲覧された回数</span>
              <button type="button" onClick={()=>setShowViewHelp(v=>!v)} aria-label="説明" className="f-sans"
                style={{ width:16, height:16, borderRadius:"50%", border:"1px solid #D9D9D9", background: showViewHelp ? "#EFEFEF" : "#fff", color:"#999", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0, lineHeight:1 }}>？</button>
            </span>
            <span className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222" }}>{data.profile_view_count}<span style={{ fontSize:11, fontWeight:700, marginLeft:2 }}>回</span></span>
          </div>
          {showViewHelp && (
            <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"6px 0 0", lineHeight:1.6 }}>農家がプロフィールを確認した回数。本人と運営にだけ表示され、誰が見たかは記録していません</p>
          )}
        </>
      )}
    </div>

    {/* ① 直近5件の遅刻・欠勤：要約チップのみ。回ごとの明細行（日付・予定時刻・判定）は
        2026-08-07たきと指示「丸ごと消せ」で削除した＝日付×時刻から過去の求人を辿らせない徹底。
        数え方（punchOf・記録なしは遅刻とも時間どおりとも数えない）は不変 */}
    <div className="ledger-card" style={{ padding:"16px", marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
        <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:0 }}>直近5件</p>
        {recent.length > 0 && (
          <span className="f-sans" style={{ fontSize:11, fontWeight:800, borderRadius:20, padding:"3px 10px",
            color: clean ? "#00A86B" : "#E24B4A", background: clean ? "#E6F7EF" : "#FDECEC" }}>
            {clean ? "遅刻・欠勤なし" : [lateCount ? `遅刻${lateCount}件` : null, absentCount ? `欠勤${absentCount}件` : null].filter(Boolean).join("・")}
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
      打刻のない回・自動で開始になった回は、遅刻とも時間どおりとも決めつけません。
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

  // 閲覧された回数のリアルタイム表示（2026-08-07たきと指示）：本人・運営が記録面を開いている間、
  // 農家の閲覧（+1）をその場で数字に反映する。チャットのライブ購読（ChatView）と同じ作法。
  // RLSにより本人・運営以外には行が届かない＝農家が購読しても何も来ない（開示範囲は不変）
  const canLive = !!(state && typeof state === "object" && state.profile_view_count != null);
  useEffect(() => {
    if (!canLive) return;
    const ch = supabase.channel("wpv-" + workerId)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_profile_view_counts", filter: "worker_id=eq." + workerId }, (payload) => {
        const v = payload?.new?.view_count;
        if (v == null) return;
        setState(prev => (prev && typeof prev === "object") ? { ...prev, profile_view_count: Number(v) } : prev);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [canLive, workerId]);

  if (state === null) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>;
  if (state === "denied") return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>この方のはたらいた記録は表示できません</p>;
  if (state === "error") return <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"40px 0" }}>読み込みに失敗しました。開き直してください</p>;
  return <WorkRecordBody data={state} showName={showName} />;
}
