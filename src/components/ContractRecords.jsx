// 契約の記録と印刷（わたしの実績・2026-08-16 たきと指示「私の実績に契約の印刷ができるようにして」）
// ・自分（働き手）が当事者の契約＝ terms_snapshot が凍結された応募を一覧し、タップで契約書を表示→印刷。
// ・読み取り専用：applications は当事者RLS（自分の行のみ）。新しい保存・入力は無い。
// ・氏名の窓口は従来どおり：相手方＝ contract_party_name（当事者のみ・SECURITY DEFINER・
//   凍結party_names→account_holders フォールバック）／自分＝ account_holders（self-read）。
//   worker_profiles へ本名を写さない原則（2026-07-30裁定(B)）は不変。
// ・terms_snapshot は to_jsonb(jobs)−lat/lng＋snapshot_at（confirm_terms・DB実測）。
//   旧契約（2026-08-02より前）には pay_method 等が無い＝支払条件は「確認できません」に倒す
//   （フォールバック禁止・lib/utils payTermsLine の規則どおり）。
// ・印刷は appStyles の「契約の印刷」@media print と対（.cb-ctr-print* の3クラス）。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { payTermsLine, overtimeLine } from "../lib/utils";

// 契約書には年まで要る（fmtJstShort は月日からなので使わない）
const fmtJstFull = (ts) => {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return String(ts).slice(0, 16).replace("T", " "); }
};

export default function ContractRecords({ me }) {
  const [rows, setRows] = useState(null);       // null=読み込み中
  const [myName, setMyName] = useState("");
  const [open, setOpen] = useState(null);       // 表示中の契約（applications行）
  const [partnerName, setPartnerName] = useState(""); // 旧契約のRPCフォールバック名

  useEffect(() => {
    if (!me?.id) return;
    let live = true;
    (async () => {
      const [apps, ah] = await Promise.all([
        supabase.from("applications")
          .select("id, job_number, terms_snapshot, terms_confirmed_worker_at, terms_confirmed_farmer_at")
          .eq("worker_id", me.id)
          .not("terms_snapshot", "is", null)
          .order("terms_confirmed_farmer_at", { ascending: false, nullsFirst: false }),
        supabase.from("account_holders").select("full_name").eq("auth_id", me.id).maybeSingle(),
      ]);
      if (!live) return;
      if (!apps.error) setRows(apps.data || []); else setRows(r => r ?? []); // 失敗時は上書きしない
      if (!ah.error && ah.data?.full_name) setMyName(ah.data.full_name);
    })();
    return () => { live = false; };
  }, [me?.id]);

  const openContract = (r) => {
    setOpen(r); setPartnerName("");
    const s = r.terms_snapshot || {};
    // 凍結名（party_names／掲載時のrecruiter_name）が無い旧契約だけRPCで相手名を引く
    if (!(s?.party_names?.farmer || s?.recruiter_name)) {
      Promise.resolve(supabase.rpc("contract_party_name", { p_application_id: r.id }))
        .then(res => { if (!res.error && res.data?.ok && res.data.name) setPartnerName(res.data.name); })
        .catch(() => {});
    }
  };

  if (!rows || rows.length === 0) return null; // 契約が無ければセクションごと非表示（ダミー禁止）

  return (
    <div style={{ marginTop: 16 }}>
      <p className="f-sans" style={{ fontSize: 12, fontWeight: 700, color: "#B0B0B0", letterSpacing: ".06em", margin: "0 0 4px" }}>📄 契約の記録</p>
      <p className="f-sans" style={{ fontSize: 11, color: "#B0B0B0", lineHeight: 1.7, margin: "0 0 8px" }}>採用が決まった時点の労働条件の記録です。タップすると内容の表示・印刷ができます。</p>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map(r => {
          const s = r.terms_snapshot || {};
          const title = [s.crop, s.task].filter(Boolean).join(" ") || `求人 #${r.job_number}`;
          return (
            <button key={r.id} onClick={() => openContract(r)} className="f-sans" style={{ display: "block", width: "100%", textAlign: "left", border: "1px solid #EBEBEB", borderRadius: 12, padding: "12px 14px", background: "#fff", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>{title} <span style={{ fontSize: 11, color: "#C8C8C8" }}>#{r.job_number}</span></span>
                <span style={{ fontSize: 11, color: "#B0B0B0", flexShrink: 0 }}>{fmtJstFull(s.snapshot_at || r.terms_confirmed_farmer_at)}</span>
              </div>
              <span style={{ display: "block", fontSize: 11, color: "#00A86B", marginTop: 4 }}>🖨 表示・印刷 →</span>
            </button>
          );
        })}
      </div>

      {open && createPortal(
        (() => {
          const r = open; const s = r.terms_snapshot || {};
          const title = [s.crop, s.task].filter(Boolean).join(" ") || `求人 #${r.job_number}`;
          const wage = s.pay_type === "日給" ? (s.daily_wage ? `日給 ${s.daily_wage}円` : "") : (s.hourly_wage ? `時給 ${s.hourly_wage}円` : "");
          const farmerName = s?.party_names?.farmer || s?.recruiter_name || partnerName || "—";
          const workerName = s?.party_names?.worker || myName || "—";
          const docRows = [
            ["求人", `${title}　#${r.job_number}`],
            ["募集主（農家）", farmerName],
            ["働き手", workerName],
            ["契約の成立（凍結）", fmtJstFull(s.snapshot_at || r.terms_confirmed_farmer_at) || "—"],
            ["働き手の確認", fmtJstFull(r.terms_confirmed_worker_at) || "—"],
            ["農家の採用", fmtJstFull(r.terms_confirmed_farmer_at) || "—"],
            ["作業日程", s.date_label || [s.date_start, s.date_end].filter(Boolean).join("〜") || "—"],
            ["勤務時間", s.work_time || "—"],
            ["休憩", s.break_time || "—"],
            ["報酬", wage || "—"],
            ["満額支払", s.full_pay_guarantee ? "あり" : "—"],
            ["支払条件", payTermsLine({ payTiming: s.pay_timing, payMethod: s.pay_method })],
            ["時間外労働", overtimeLine(s.overtime_policy, s.overtime_detail) || "—"],
            ["集合場所", [s.prefecture, s.city, s.town, s.address].filter(Boolean).join("") || "—"],
            ["最寄り駅", s.nearest_station ? `${s.nearest_station}（${s.commute_time || "—"}）` : "—"],
            ["持ち物", s.belongings || "—"],
            ["注意・備考", s.cautions || "—"],
            ["作業説明", s.notes || "—"],
          ];
          return (
            <div onClick={() => setOpen(null)} className="cb-box-overlay cb-lock-scroll cb-ctr-print-overlay" style={{ zIndex: 10500 }}>
              <div onClick={e => e.stopPropagation()} className="cb-sheet-up cb-ctr-print-sheet" style={{ background: "#fff", borderRadius: 16, padding: "20px", maxWidth: 460, width: "100%", maxHeight: "85vh", overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
                {/* ✕は置かない（外タップで閉じる・2026-08-16の入力ボックス統一と同じ作法）。下部に「とじる」あり */}
                <div className="cb-ctr-print">
                  <p className="f-sans" style={{ fontSize: 12, fontWeight: 700, color: "#00A86B", margin: "0 0 2px" }}>労働条件の確認記録（採用時に凍結・変更不可）</p>
                  <p className="f-sans" style={{ fontSize: 17, fontWeight: 800, color: "#222", margin: "0 0 12px" }}>{title}</p>
                  <div style={{ display: "grid", gap: 8 }}>
                    {docRows.map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: 10, borderBottom: "1px solid #F0F0F0", paddingBottom: 8 }}>
                        <span className="f-sans" style={{ fontSize: 12, color: "#909090", minWidth: 96, flexShrink: 0 }}>{k}</span>
                        <span className="f-sans" style={{ fontSize: 13, color: "#222", overflowWrap: "break-word", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <p className="f-sans" style={{ fontSize: 10.5, color: "#909090", lineHeight: 1.8, margin: "14px 0 0" }}>
                    この記録は採用（両者の確認）の時点で凍結されたもので、あとから変更できません。雇用の契約は募集主と働き手の当事者間で成立しています。<br />
                    chitose-bank（https://chitose-bank.com）
                  </p>
                </div>
                <div className="no-print" style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button onClick={() => { try { window.print(); } catch {} }} className="f-sans" style={{ flex: 1, background: "#00A86B", color: "#fff", border: "none", borderRadius: 12, padding: "13px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>🖨 印刷する</button>
                  <button onClick={() => setOpen(null)} className="f-sans" style={{ flex: "0 0 auto", background: "#F0F0F0", color: "#555", border: "none", borderRadius: 12, padding: "13px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>とじる</button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
