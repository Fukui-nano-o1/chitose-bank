// 仕事中専用ページ（#/admin/working・管理者専用・2026-08-01）。
// 「今まさに作業が進んでいるマッチ（status=working）」と「本日開始（採用済み・当日が作業日）」を
// 運営が一望する見守りページ。後日の採用済み（まもなく開始）は出さない（当日分のみ・たきと指示）。
// 売り物＝安心（憲法1条）＝作業当日に何が起きているかを運営が把握できること。
// 読み取り専用（admin_working_jobs RPC・security definer + app_admins ゲート）。ここからの書き込みは無し。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { dateRangeLabel, isTodayWork } from "../../lib/utils";
import { getCache, setCache } from "../../lib/viewCache";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";

// 作業当日の判定（isTodayWork）は lib/utils に集約（2026-08-03）。
// まもなく開始ページの表示フィルタ・App.jsxのトップページ着地判定と同じ関数を使う＝二重展開もズレも起きない

// 作業日程：agreed_dates（当事者が合意した実施日の配列）があればそれ、無ければ求人の日程
function scheduleLabel(item) {
  const ad = item.agreed_dates;
  if (Array.isArray(ad) && ad.length) {
    const sorted = [...ad].map(String).sort();
    return dateRangeLabel(sorted[0], sorted[sorted.length - 1]);
  }
  if (item.date_start) return dateRangeLabel(item.date_start, item.date_end);
  return item.date_label || "日程未設定";
}

// チェック行（時刻があれば緑✓＋時刻、無ければグレー「未」）
function CheckRow({ label, at }) {
  const done = !!at;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
      <span style={{ width:18, height:18, borderRadius:"50%", flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800,
        background: done ? "#00A86B" : "#F0F0F0", color: done ? "#fff" : "#C8C8C8" }}>{done ? "✓" : ""}</span>
      <span className="f-sans" style={{ color:"#717171", width:96, flexShrink:0 }}>{label}</span>
      <span className="f-sans" style={{ color: done ? "#222" : "#B0B0B0", fontWeight: done ? 600 : 400 }}>{done ? at : "未"}</span>
    </div>
  );
}

function PartyLine({ item }) {
  return (
    <div className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#222", flexWrap:"wrap" }}>
      <span style={{ fontWeight:700 }}>{item.worker_name || "働き手"}</span>
      <span style={{ color:"#B0B0B0" }}>働き手</span>
      <span style={{ color:"#C8C8C8", margin:"0 2px" }}>⇄</span>
      <span style={{ fontWeight:700 }}>{item.farmer_name || "農家"}</span>
      <span style={{ color:"#B0B0B0" }}>農家</span>
    </div>
  );
}

function CardHead({ item }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
        <div style={{ minWidth:0 }}>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.crop || "作物未設定"}　{item.task || ""}</p>
          <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"2px 0 0" }}>{[item.prefecture, item.city].filter(Boolean).join(" ") || "地域未設定"}</p>
        </div>
      </div>
      <a href={`#/work/job/${item.job_number}`} className="f-sans" style={{ flexShrink:0, textDecoration:"none", fontSize:11, fontWeight:700, color:"#00A86B", background:"#E6F7EF", borderRadius:8, padding:"4px 10px" }}>No.{item.job_number} ↗</a>
    </div>
  );
}

// 仕事中カード。today=本日開始（採用済み・当日・未打刻）はまだ started_at 等が無いので、
// 採用→保険→開始待ちの並びで「これから始まる」を示す。working は開始〜終了の全打刻を示す
function WorkCard({ item, today }) {
  return (
    <div className="ledger-card" style={{ padding:"14px 16px", marginBottom:12, borderLeft:"3px solid #E24B4A" }}>
      <CardHead item={item} />
      <PartyLine item={item} />
      <p className="f-sans" style={{ fontSize:12, color:"#444", margin:"8px 0 10px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <span>{scheduleLabel(item)}</span>
        {today && <span style={{ fontSize:10, fontWeight:800, color:"#fff", background:"#E24B4A", borderRadius:20, padding:"2px 8px" }}>本日開始</span>}
        {!today && item.auto_started && <span style={{ color:"#999" }}>· 自動開始</span>}
      </p>
      <div style={{ display:"flex", flexDirection:"column", gap:6, background:"#FAFAFA", borderRadius:10, padding:"10px 12px" }}>
        {today ? (<>
          <CheckRow label="採用" at={item.hired_at} />
          <CheckRow label="保険の準備" at={item.insurance_prepared_at} />
          <CheckRow label="開始（働き手）" at={item.started_at} />
          <CheckRow label="開始確認（農家）" at={item.farmer_confirmed_start_at} />
        </>) : (<>
          <CheckRow label="開始（働き手）" at={item.started_at} />
          <CheckRow label="開始確認（農家）" at={item.farmer_confirmed_start_at} />
          <CheckRow label="保険の準備" at={item.insurance_prepared_at} />
          <CheckRow label="完了（農家）" at={item.work_completed_at} />
          <CheckRow label="終了確認（働き手）" at={item.worker_confirmed_end_at} />
        </>)}
      </div>
    </div>
  );
}

export function AdminWorkingRoom() {
  // 前回結果（App.jsxの着地判定・まもなく開始ページと共用のキャッシュ）があれば即描画し、
  // 裏で最新に差し替える（2026-08-02・更新時間の短縮）
  const [state, setState] = useState(() => {
    const d = getCache("admin:workingJobs");
    return d?.ok ? { working: d.working || [], upcoming: d.upcoming || [] } : null;
  }); // null=読み込み中 | {working, upcoming} | "error" | "denied"
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_working_jobs");
    // 裏の再取得が失敗しても、キャッシュ表示中ならそのまま保つ（エラー画面で上書きしない）
    if (error) { setState(prev => (prev && typeof prev === "object") ? prev : "error"); return; }
    if (!data?.ok) { setState(data?.reason === "not_admin" ? "denied" : "error"); return; }
    setCache("admin:workingJobs", data);
    setState({ working: data.working || [], upcoming: data.upcoming || [] });
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    /* cb-admin-page＝下部バーを隠す目印（浮遊☰・フッターは出す・appStyles・2026-08-05） */
    <div className="appear cb-admin-page" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px 120px" }}>
      {/* 管理ページの共通ナビ（全ページ導線・2026-08-02） */}
      <AdminNav current="working" />
      <div style={{ marginBottom:6 }}>
        <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:0 }}>仕事中</p>
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>いま進行中の仕事の見守り（作業中と本日開始）</p>
      </div>

      {state === null && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
      )}
      {state === "denied" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>管理者のみが閲覧できます</p>
      )}
      {state === "error" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"48px 0" }}>読み込みに失敗しました。ページを開き直してください</p>
      )}

      {state && typeof state === "object" && (() => {
        // 「仕事が始まる日」の採用済みマッチ（本日開始）は仕事中として展開する。
        // 後日の採用済み（まもなく開始）はこのページには出さない（2026-08-01たきと指示・当日分のみ）。
        const todayUpcoming = state.upcoming.filter(isTodayWork);
        const workingCount = state.working.length + todayUpcoming.length;
        return (<>
        {/* ── 仕事中（status=working ＋ 本日開始の採用済み） ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, margin:"22px 0 12px" }}>
          <span style={{ width:4, height:16, borderRadius:2, background:"#E24B4A" }} />
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:0 }}>作業中 <span style={{ color:"#E24B4A" }}>{workingCount}</span></p>
        </div>
        {workingCount === 0 ? (
          <div className="f-sans" style={{ background:"#FAFAFA", border:"1px solid #F0F0F0", borderRadius:14, padding:"24px 16px", textAlign:"center", color:"#999", fontSize:13 }}>いま作業中・本日開始のマッチはありません</div>
        ) : (<>
          {todayUpcoming.map(item => <WorkCard key={item.application_id} item={item} today />)}
          {state.working.map(item => <WorkCard key={item.application_id} item={item} />)}
        </>)}
        </>);
      })()}
    </div>
  );
}
