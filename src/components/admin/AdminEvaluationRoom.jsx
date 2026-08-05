// 働き手ダッシュボード（#/admin/evaluation・2026-08-05たきと指示）。
// 用途：農家が働き手を確認するときに一番見るページ。運営の見守り用ではない。
//   ① 直近5件に遅刻・欠勤はあるか ② 労働の総件数・総時間 ③ 作物別・作業別の件数と時間
//
// 【いまは管理画面の中に置いている】農家に見せるのは、CLAUDE.md「求職者公開項目の制約」
//   （提示してよい項目は10個・稼働回数などの生の数値は絶対禁止）に照らした判断のあと。
//   DB側も admin_worker_dashboard を app_admins ゲートにしてある＝画面を隠すだけにしない。
//
// 【この画面が言わないこと】点数・順位・おすすめ度は作らない。良し悪しの断定もしない。
//   出すのは記録そのもの（打刻・出欠・求人の勤務時間）だけ。運営の主観は混ぜない（2026-07-16）。
//   打刻が無い・自動開始の回は「記録なし」と正直に書く＝憶測で遅刻にも時間どおりにもしない。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { getCache, setCache } from "../../lib/viewCache";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";

// URLから働き手を読む（#/admin/evaluation/{worker_id}）。無ければ一覧
function readWorkerId() {
  try {
    const h = window.location.hash.replace(/^#\/?/, "");
    const m = h.match(/^admin\/evaluation\/([0-9a-f-]{36})$/i);
    return m ? m[1] : null;
  } catch { return null; }
}

const hm = (min) => {
  if (min == null) return "ー";
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
};

// 1回ぶんの打刻の読み方。判定できないものは判定しない（no_record）
function punchOf(r) {
  if (r.attended === false) return { key:"absent", label:"欠勤", color:"#E24B4A", bg:"#FDECEC" };
  if (r.late_minutes == null) return { key:"no_record", label:"記録なし", color:"#999", bg:"#F5F5F5" };
  if (r.late_minutes >= 1) return { key:"late", label:`遅刻 ${r.late_minutes}分`, color:"#E24B4A", bg:"#FDECEC" };
  return { key:"on_time", label:"時間どおり", color:"#00A86B", bg:"#E6F7EF" };
}

// 大きい数字（総件数・総時間）
function BigStat({ label, value, unit, tone }) {
  return (
    <div style={{ flex:"1 1 0", minWidth:0, background:"#FAFAFA", borderRadius:12, padding:"12px 10px", textAlign:"center" }}>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 4px" }}>{label}</p>
      <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:tone || "#222", margin:0, lineHeight:1.2 }}>
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

// 直近5件の1行
function RecentRow({ r }) {
  const p = punchOf(r);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:"1px solid #F5F5F5" }}>
      <div style={{ minWidth:0, flex:1 }}>
        <p className="f-sans" style={{ fontSize:12, color:"#222", margin:0, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {r.work_date || "日付なし"}　{r.crop || "作物未設定"} {r.task || ""}
        </p>
        <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"2px 0 0" }}>
          No.{r.job_number}
          {r.scheduled_start && <>　予定 {r.scheduled_start}</>}
          {r.actual_start && <>　打刻 {r.actual_start}</>}
          {r.auto_started && <>　自動開始</>}
          {r.started_declared && <>　申告</>}
          {r.time_corrected && <>　修正あり</>}
        </p>
      </div>
      <span className="f-sans" style={{ flexShrink:0, fontSize:11, fontWeight:800, color:p.color, background:p.bg, borderRadius:20, padding:"3px 10px" }}>{p.label}</span>
    </div>
  );
}

function WorkerDashboard({ data }) {
  const t = data.totals || {};
  const recent = data.recent || [];
  // 直近5件の要約＝このページで農家がまず知りたい1行
  const lateCount = recent.filter(r => punchOf(r).key === "late").length;
  const absentCount = recent.filter(r => punchOf(r).key === "absent").length;
  const clean = lateCount === 0 && absentCount === 0;
  return (<>
    <div className="ledger-card" style={{ padding:"16px", marginBottom:12 }}>
      <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{data.worker?.name || "名前未設定"}</p>

      {/* ② 労働の総件数・総時間 */}
      <div style={{ display:"flex", gap:8 }}>
        <BigStat label="働いた回数" value={t.completed_count ?? 0} unit="件" />
        <BigStat label="働いた時間" value={Math.floor((t.total_minutes ?? 0) / 60)} unit="時間" />
        <BigStat label="欠勤" value={t.absent_count ?? 0} unit="件" tone={(t.absent_count ?? 0) > 0 ? "#E24B4A" : "#222"} />
      </div>
      {(t.unknown_time_count ?? 0) > 0 && (
        <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"6px 0 0" }}>うち{t.unknown_time_count}件は勤務時間の記録がなく、時間に含めていません</p>
      )}
    </div>

    {/* ① 直近5件の遅刻・欠勤 */}
    <div className="ledger-card" style={{ padding:"16px", marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:2 }}>
        <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:0 }}>直近5件</p>
        {recent.length > 0 && (
          <span className="f-sans" style={{ fontSize:11, fontWeight:800, borderRadius:20, padding:"3px 10px",
            color: clean ? "#00A86B" : "#E24B4A", background: clean ? "#E6F7EF" : "#FDECEC" }}>
            {clean ? "遅刻・欠勤なし" : [lateCount ? `遅刻${lateCount}件` : null, absentCount ? `欠勤${absentCount}件` : null].filter(Boolean).join("・")}
          </span>
        )}
      </div>
      {recent.length === 0 ? (
        <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"8px 0 0" }}>働いた記録がまだありません</p>
      ) : (
        <div style={{ marginTop:6 }}>{recent.map(r => <RecentRow key={r.application_id} r={r} />)}</div>
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
      打刻のない回・自動で開始になった回は「記録なし」と書き、遅刻とも時間どおりとも決めつけません。
      点数や順位は付けません。
    </p>
  </>);
}

export function AdminEvaluationRoom() {
  const [workerId, setWorkerId] = useState(readWorkerId);
  useEffect(() => {
    const onHash = () => setWorkerId(readWorkerId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 前回結果があれば即描画し、裏で最新に差し替える（2026-08-02・更新時間の短縮の作法）
  const cacheKey = workerId ? `admin:workerDash:${workerId}` : "admin:workerList";
  const [state, setState] = useState(() => {
    const d = getCache(cacheKey);
    return d?.ok ? d : null;
  }); // null=読み込み中 | データ | "error" | "denied"
  const load = useCallback(async () => {
    const cached = getCache(cacheKey);
    setState(cached?.ok ? cached : null);
    const { data, error } = await supabase.rpc("admin_worker_dashboard", workerId ? { p_worker_id: workerId } : {});
    // 裏の再取得が失敗しても、キャッシュ表示中ならそのまま保つ（エラー画面で上書きしない）
    if (error) { setState(prev => (prev && typeof prev === "object") ? prev : "error"); return; }
    if (!data?.ok) { setState(data?.reason === "not_admin" ? "denied" : "error"); return; }
    setCache(cacheKey, data);
    setState(data);
  }, [cacheKey, workerId]);
  useEffect(() => { load(); }, [load]);

  return (
    /* cb-admin-page＝下部バー・浮遊☰・サイトフッターを隠す目印（appStyles・2026-08-05） */
    <div className="appear cb-admin-page" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px 120px" }}>
      <AdminNav current="evaluation" />

      {workerId && (
        <button type="button" className="f-sans" onClick={() => { window.location.hash = "/admin/evaluation"; }}
          style={{ background:"none", border:"none", padding:"0 0 12px", color:"#717171", fontSize:12, fontWeight:700, cursor:"pointer" }}>← 働き手の一覧</button>
      )}

      {state === null && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
      )}
      {state === "denied" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>管理者のみが閲覧できます</p>
      )}
      {state === "error" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"48px 0" }}>読み込みに失敗しました。ページを開き直してください</p>
      )}

      {/* 一覧：働き手を選ぶ（農家に出すときは、この一覧は要らず1人ぶんを直接開く） */}
      {state && typeof state === "object" && !workerId && (
        (state.workers || []).length === 0 ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>働いた記録のある働き手がまだいません</p>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {state.workers.map(w => (
              <button key={w.worker_id} type="button" className="ledger-card f-sans"
                onClick={() => { window.location.hash = "/admin/evaluation/" + w.worker_id; }}
                style={{ textAlign:"left", border:"none", cursor:"pointer", padding:"14px 16px", display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ flex:1, minWidth:0, fontSize:14, fontWeight:800, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{w.name || "名前未設定"}</span>
                <span style={{ flexShrink:0, fontSize:12, color:"#717171" }}>{w.completed_count}件 · {hm(w.total_minutes)}</span>
                {w.absent_count > 0 && <span style={{ flexShrink:0, fontSize:11, fontWeight:800, color:"#E24B4A", background:"#FDECEC", borderRadius:20, padding:"3px 8px" }}>欠勤{w.absent_count}</span>}
              </button>
            ))}
          </div>
        )
      )}

      {state && typeof state === "object" && workerId && <WorkerDashboard data={state} />}
    </div>
  );
}
