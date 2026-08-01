// まもなく開始ページ（#/admin/upcoming・管理者専用・2026-08-01）。
// 「採用が決まり、作業日を待っているマッチ（status=approved・双方契約確認済み・未開始）」のうち、
// 開始1週間前の窓に入ったものだけを一望する見守りページ（たきと指示「1週間前から展開」）。
// 該当があれば、サイトを開いた時のトップページとして展開する（着地の判定は App.jsx 側・startsWithinDays を共用）。
// 仕事中専用ページ（AdminWorkingRoom）と同じ設計・同じRPCを流用する。
// 読み取り専用（admin_working_jobs RPC・security definer + app_admins ゲート）。ここからの書き込みは無し。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { CROP_OPTIONS, dateRangeLabel, startsWithinDays } from "../../lib/utils";
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

export function AdminUpcomingRoom() {
  const [state, setState] = useState(null); // null=読み込み中 | {upcoming} | "error" | "denied"
  const load = useCallback(async () => {
    // 仕事中専用ページと同じ RPC（admin_working_jobs）を流用。返り値の upcoming バケットのうち、
    // 開始1週間以内（過ぎた未開始も含む）の該当求人だけを表示する
    const { data, error } = await supabase.rpc("admin_working_jobs");
    if (error) { setState("error"); return; }
    if (!data?.ok) { setState(data?.reason === "not_admin" ? "denied" : "error"); return; }
    setState({ upcoming: (data.upcoming || []).filter(it => startsWithinDays(it, 7)) });
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="appear" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px 120px" }}>
      <div style={{ marginBottom:6 }}>
        <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:0 }}>⏳ まもなく開始</p>
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>開始まで1週間を切ったマッチの見守り</p>
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

      {state && typeof state === "object" && (<>
        {/* ── まもなく開始（採用済み・未開始） ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, margin:"22px 0 12px" }}>
          <span style={{ width:4, height:16, borderRadius:2, background:"#00897B" }} />
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:0 }}>まもなく開始 <span style={{ color:"#00897B" }}>{state.upcoming.length}</span></p>
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"0 0 12px" }}>採用が決まり、開始1週間前になったマッチ（開始日の近い順）</p>
        {state.upcoming.length === 0 ? (
          <div className="f-sans" style={{ background:"#FAFAFA", border:"1px solid #F0F0F0", borderRadius:14, padding:"24px 16px", textAlign:"center", color:"#999", fontSize:13 }}>1週間以内に始まるマッチはありません</div>
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
