// まもなく開始ページ（#/admin/upcoming・管理者専用・2026-08-01）。
// 「採用が決まり、作業日を待っているマッチ（status=approved・双方契約確認済み・未開始）」のうち、
// 開始1週間前の窓に入ったものだけを一望する見守りページ（たきと指示「1週間前から展開」）。
// 作業当日のものは出さない（2026-08-03たきと指示）＝当日は仕事中ページ側に展開される。判定は
// lib/utils の isUpcomingSoon に集約（App.jsxのトップページ着地判定と同じ関数を使う＝空着地を防ぐ）。
// 該当があれば、サイトを開いた時のトップページとして展開する（着地の判定は App.jsx 側・isUpcomingSoon を共用）。
// 仕事中専用ページ（AdminWorkingRoom）と同じ設計・同じRPCを流用する。
// 読み取り専用（admin_working_jobs RPC・security definer + app_admins ゲート）。ここからの書き込みは無し。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { dateRangeLabel, isUpcomingSoon } from "../../lib/utils";
import { getCache, setCache } from "../../lib/viewCache";
import { Dots } from "../ui";


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

export function AdminUpcomingRoom() {
  // 前回結果（App.jsxの着地判定が置いたものを含む）があれば読み込み中を出さず即描画し、
  // 裏で最新に差し替える（2026-08-02・更新時間の短縮。起動時にRPCが2回直列に走っていた無駄の解消）
  const [state, setState] = useState(() => {
    const d = getCache("admin:workingJobs");
    return d?.ok ? { upcoming: (d.upcoming || []).filter(it => isUpcomingSoon(it, 7)) } : null;
  }); // null=読み込み中 | {upcoming} | "error" | "denied"
  const load = useCallback(async () => {
    // 仕事中専用ページと同じ RPC（admin_working_jobs）を流用。返り値の upcoming バケットのうち、
    // 開始1週間以内（過ぎた未開始も含む）の該当求人だけを表示する。
    // ただし作業当日のものは出さない（2026-08-03たきと指示）＝当日は仕事中ページが持つ・二重展開しない
    const { data, error } = await supabase.rpc("admin_working_jobs");
    // 裏の再取得が失敗しても、キャッシュ表示中ならそのまま保つ（エラー画面で上書きしない）
    if (error) { setState(prev => (prev && typeof prev === "object") ? prev : "error"); return; }
    if (!data?.ok) { setState(data?.reason === "not_admin" ? "denied" : "error"); return; }
    setCache("admin:workingJobs", data);
    setState({ upcoming: (data.upcoming || []).filter(it => isUpcomingSoon(it, 7)) });
  }, []);
  useEffect(() => { load(); }, [load]);

  // 見出し・セクションバー・件数・空状態ボックスは置かない（2026-08-01たきと指示
  // 「まもなく開始ページにスクショの要素は必要ない」＝内容は該当する求人のカードのみ）。
  // 読み込み中・権限なし・失敗・0件は最小の1行テキストだけ（直URLで開いた時に白紙に見えないための最低限）
  return (
    /* cb-admin-page＝サイトフッターを隠す目印（下部バー・浮遊☰は出す・appStyles・2026-08-05） */
    <div className="appear cb-admin-page" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px", paddingBottom:"calc(140px + env(safe-area-inset-bottom, 0px))" }}>
      {state === null && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
      )}
      {state === "denied" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>管理者のみが閲覧できます</p>
      )}
      {state === "error" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"48px 0" }}>読み込みに失敗しました。ページを開き直してください</p>
      )}

      {state && typeof state === "object" && (
        state.upcoming.length === 0 ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>1週間以内に始まるマッチはありません</p>
        ) : state.upcoming.map(item => (
          <div key={item.application_id} className="ledger-card" style={{ padding:"14px 16px", marginBottom:12, borderLeft:"3px solid #00897B" }}>
            <CardHead item={item} />
            <PartyLine item={item} />
            <p className="f-sans" style={{ fontSize:12, color:"#444", margin:"8px 0 10px" }}>{scheduleLabel(item)}</p>
            <div style={{ display:"flex", flexDirection:"column", gap:6, background:"#FAFAFA", borderRadius:10, padding:"10px 12px" }}>
              <CheckRow label="採用" at={item.hired_at} />
              <CheckRow label="保険の準備" at={item.insurance_prepared_at} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
