// 仕事中専用ページ（#/admin/working・管理者専用・2026-08-01）。
// 「今まさに作業が進んでいるマッチ（status=working）」と「まもなく開始（採用済み・未開始）」を
// 運営が一望する見守りページ。売り物＝安心（憲法1条）＝作業当日に何が起きているかを運営が把握できること。
// 読み取り専用（admin_working_jobs RPC・security definer + app_admins ゲート）。ここからの書き込みは無し。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { CROP_OPTIONS, dateRangeLabel } from "../../lib/utils";
import { Dots } from "../ui";

const cropIcon = (crop) => CROP_OPTIONS.find(c => c.name === crop)?.icon || "🌱";

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
        <span style={{ fontSize:22, lineHeight:1, flexShrink:0 }}>{cropIcon(item.crop)}</span>
        <div style={{ minWidth:0 }}>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.crop || "作物未設定"}　{item.task || ""}</p>
          <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"2px 0 0" }}>{[item.prefecture, item.city].filter(Boolean).join(" ") || "地域未設定"}</p>
        </div>
      </div>
      <a href={`#/work/job/${item.job_number}`} className="f-sans" style={{ flexShrink:0, textDecoration:"none", fontSize:11, fontWeight:700, color:"#00A86B", background:"#E6F7EF", borderRadius:8, padding:"4px 10px" }}>No.{item.job_number} ↗</a>
    </div>
  );
}

export function AdminWorkingRoom() {
  const [state, setState] = useState(null); // null=読み込み中 | {working, upcoming} | "error" | "denied"
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_working_jobs");
    if (error) { setState("error"); return; }
    if (!data?.ok) { setState(data?.reason === "not_admin" ? "denied" : "error"); return; }
    setState({ working: data.working || [], upcoming: data.upcoming || [] });
  }, []);
  useEffect(() => { load(); }, [load]);

  const back = () => { window.location.hash = "/admin"; };

  return (
    <div className="appear" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px 120px" }}>
      <button onClick={back} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, fontWeight:600, color:"#222", cursor:"pointer", padding:"7px 14px", marginBottom:16 }}>← 管理へ戻る</button>

      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, marginBottom:6 }}>
        <div>
          <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:0 }}>🛠 仕事中</p>
          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>進行中のマッチと、まもなく始まる仕事の見守り</p>
        </div>
        <button onClick={() => { setState(null); load(); }} className="f-sans" style={{ padding:"8px 14px", borderRadius:10, border:"1px solid #EBEBEB", background:"#fff", fontSize:12, fontWeight:600, color:"#222", cursor:"pointer", flexShrink:0 }}>🔄 更新</button>
      </div>

      {state === null && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
      )}
      {state === "denied" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>管理者のみが閲覧できます</p>
      )}
      {state === "error" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"48px 0" }}>読み込みに失敗しました。更新を押してください</p>
      )}

      {state && typeof state === "object" && (<>
        {/* ── 仕事中（status=working） ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, margin:"22px 0 12px" }}>
          <span style={{ width:4, height:16, borderRadius:2, background:"#E24B4A" }} />
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:0 }}>作業中 <span style={{ color:"#E24B4A" }}>{state.working.length}</span></p>
        </div>
        {state.working.length === 0 ? (
          <div className="f-sans" style={{ background:"#FAFAFA", border:"1px solid #F0F0F0", borderRadius:14, padding:"24px 16px", textAlign:"center", color:"#999", fontSize:13 }}>いま作業中のマッチはありません</div>
        ) : state.working.map(item => (
          <div key={item.application_id} className="ledger-card" style={{ padding:"14px 16px", marginBottom:12, borderLeft:"3px solid #E24B4A" }}>
            <CardHead item={item} />
            <PartyLine item={item} />
            <p className="f-sans" style={{ fontSize:12, color:"#444", margin:"8px 0 10px" }}>📅 {scheduleLabel(item)}{item.auto_started ? "　·　自動開始" : ""}</p>
            <div style={{ display:"flex", flexDirection:"column", gap:6, background:"#FAFAFA", borderRadius:10, padding:"10px 12px" }}>
              <CheckRow label="開始（働き手）" at={item.started_at} />
              <CheckRow label="開始確認（農家）" at={item.farmer_confirmed_start_at} />
              <CheckRow label="保険の準備" at={item.insurance_prepared_at} />
              <CheckRow label="完了（農家）" at={item.work_completed_at} />
              <CheckRow label="終了確認（働き手）" at={item.worker_confirmed_end_at} />
            </div>
          </div>
        ))}

        {/* ── まもなく開始（採用済み・未開始） ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, margin:"28px 0 12px" }}>
          <span style={{ width:4, height:16, borderRadius:2, background:"#00897B" }} />
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:0 }}>まもなく開始 <span style={{ color:"#00897B" }}>{state.upcoming.length}</span></p>
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"0 0 12px" }}>採用が決まり、作業日を待っているマッチ（開始日の近い順）</p>
        {state.upcoming.length === 0 ? (
          <div className="f-sans" style={{ background:"#FAFAFA", border:"1px solid #F0F0F0", borderRadius:14, padding:"24px 16px", textAlign:"center", color:"#999", fontSize:13 }}>開始待ちのマッチはありません</div>
        ) : state.upcoming.map(item => (
          <div key={item.application_id} className="ledger-card" style={{ padding:"14px 16px", marginBottom:12, borderLeft:"3px solid #00897B" }}>
            <CardHead item={item} />
            <PartyLine item={item} />
            <p className="f-sans" style={{ fontSize:12, color:"#444", margin:"8px 0 10px" }}>📅 {scheduleLabel(item)}</p>
            <div style={{ display:"flex", flexDirection:"column", gap:6, background:"#FAFAFA", borderRadius:10, padding:"10px 12px" }}>
              <CheckRow label="採用" at={item.hired_at} />
              <CheckRow label="保険の準備" at={item.insurance_prepared_at} />
            </div>
          </div>
        ))}
      </>)}
    </div>
  );
}
