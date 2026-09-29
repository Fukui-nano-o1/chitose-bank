// 労働条件通知書の専用ページ。本文・PDF・印刷は同じ契約記録から作成する。
// 当事者本人と応募IDで絞り込み、既存のRLS・旧契約の来歴表示を維持する。
import { productAnalytics } from "../lib/productAnalytics";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { fetchJobRowsForMe } from "../lib/jobForMe";
import { saveElementAsPdf } from "../lib/pdfExport";
import { payTermsLine, overtimeLine, WAGE_CLOSING_RULE_LABELS, INSURANCE_ITEMS, normalizeInsuranceItems, ROLE_GREEN, ROLE_ORANGE } from "../lib/utils";
import { Dots } from "./ui";
import { returnAlongPath, routeReturn } from "../lib/routeTrail";
import "./LaborConditionsNotice.css";

// 通知書には年まで要る（fmtJstShort は月日からなので使わない）
const fmtJstFull = (ts) => {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return String(ts).slice(0, 16).replace("T", " "); }
};
const fmtYmd = (d) => {
  const s = String(d || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : "";
};

// 記録に無い法定の明示事項（この通知書では作らないもの）。文末の注意書きで当事者間の明示を促す
// ★2026-08-19：昇給・賞与・退職手当は待遇（jobs.perks）として掲載時に凍結されるようになったので
//   この一覧から外した。凍結前の旧契約は perks にキーが無い＝5.賃金の欄が「記録にありません」になる
// ★2026-08-21：契約の更新・変更の範囲・退職に関する事項・労災/雇用保険は掲載時凍結
//   （migration 20260821090000）で記録されるようになったので一覧から外した。
//   残るのは健康保険・厚生年金だけ（データを持っていない＝約束しない）
const NOT_RECORDED_ITEMS = "健康保険・厚生年金の適用";

// 凍結スナップショットから通知書の中身を組み立てる（値が無い法定項目は null＝「記録にありません」）
function buildSections(s, r) {
  const wage = s.pay_type === "日給"
    ? (s.daily_wage ? `日給 ${s.daily_wage}円` : null)
    : (s.hourly_wage ? `時給 ${s.hourly_wage}円` : null);
  const period = s.date_start
    ? (s.date_end && s.date_end !== s.date_start ? `${fmtYmd(s.date_start)} 〜 ${fmtYmd(s.date_end)}` : fmtYmd(s.date_start))
    : (s.date_label || null);
  const holidays = Array.isArray(s.holidays) && s.holidays.length
    ? s.holidays.map(fmtYmd).filter(Boolean).join("・")
    : null;
  const place = [s.prefecture, s.city, s.town, s.address].filter(Boolean).join("") || null;
  const closing = WAGE_CLOSING_RULE_LABELS[s.wage_closing_rule] || null;
  const payTerms = payTermsLine({ payTiming: s.pay_timing, payMethod: s.pay_method });
  // 昇給・賞与・退職手当（2026-08-19）：掲載時に凍結された待遇から「あり／なし」を出す。
  // キーが無い＝凍結前の旧契約なので null＝「記録にありません」（憶測で「なし」にしない）
  const pk = s.perks || {};
  const yesNo = (v) => (v === true ? "あり" : v === false ? "なし" : null);
  const withDetail = (v, d) => (v === true ? (String(d || "").trim() ? `あり（${String(d).trim()}）` : "あり") : yesNo(v));
  const ins = s.insurance_snapshot || null;
  const insItems = normalizeInsuranceItems(Array.isArray(ins?.items) ? ins.items : [])
    .map(k => (INSURANCE_ITEMS.find(x => x.k === k) || {}).label).filter(Boolean).join("・");

  return [
    { h: "1. 労働契約の期間", rows: [
      ["作業日程", period],
      ["期間の定め", period ? "あり（上記の作業日程）" : null],
      // 契約の更新（2026-08-21）：掲載時に凍結された固定ポリシー。旧契約はキーが無い＝「記録にありません」
      ["契約の更新", s.contract_renewal || null],
    ]},
    { h: "2. 就業の場所", rows: [
      ["場所", place],
      ["変更の範囲", s.place_change_scope || null],
      ["最寄り駅", s.nearest_station ? `${s.nearest_station}${s.commute_time ? `（${s.commute_time}）` : ""}` : null],
    ]},
    { h: "3. 従事すべき業務", rows: [
      ["作物・作業", [s.crop, s.task].filter(Boolean).join("　") || null],
      ["変更の範囲", s.task_change_scope || null],
      ["作業の説明", s.notes || null],
    ]},
    { h: "4. 始業・終業の時刻、休憩、休日、時間外労働", rows: [
      ["勤務時間", s.work_time || null],
      ["休憩時間", s.break_time || null],
      ["休日", holidays],
      ["所定時間外の労働", overtimeLine(s.overtime_policy, s.overtime_detail) || null],
    ]},
    { h: "5. 賃金", rows: [
      ["賃金", wage],
      ["賃金の締切", closing],
      ["支払方法・支払時期", payTerms === "支払条件を確認できません" ? null : payTerms.replace(/^支払：/, "")],
      ["天候中止などの取扱い", s.full_pay_guarantee ? "作業が中止になった場合も満額を支払う" : null],
      // 「あり」のときは内容（時期・金額等）まで出す＝労基則5条1項3号（昇給）・5号（賞与）・
      // 4号の2（退職手当）は、定めがある場合その内容の明示を求めているため（2026-08-19）
      ["昇給", withDetail(pk.has_raise, pk.raise_detail)],
      ["賞与", withDetail(pk.has_bonus, pk.bonus_detail)],
      ["退職手当", withDetail(pk.has_severance_pay, pk.severance_detail)],
    ]},
    // 退職に関する事項（2026-08-21・労基則5条1項4号＝解雇の事由を含む）：掲載時に凍結された標準文。
    // 旧契約はキーが無い＝「記録にありません」
    { h: "6. 退職に関する事項（解雇の事由を含む）", rows: [
      ["内容", s.retirement_terms || null],
    ]},
    { h: "7. そのほかの記録", rows: [
      ["持ち物", s.belongings || null],
      ["注意・備考", s.cautions || null],
      // 相談窓口（2026-08-19）：パート有期法6条1項＋則2条の4点セットの1つ。
      // 掲載時にperksへ凍結された値なので、あとからプロフィールを変えてもこの通知書は変わらない
      ["相談窓口", String(pk.consultation_contact || "").trim() || null],
      // 労災・雇用保険（2026-08-21）：プロフィールの申告を掲載時に凍結した値
      ["労災・雇用保険", s.labor_insurance_status || null],
      ["募集主の保険の申告", insItems || null],
      ["求人番号", `#${r.job_number}`],
    ]},
  ];
}

export default function LaborConditionsNotice({ me, role = "worker", applicationId }) {
  const isWorker = role === "worker";
  const accent = isWorker ? ROLE_ORANGE : ROLE_GREEN;
  const [open, setOpen] = useState(null);
  const [jobRows, setJobRows] = useState({});
  const [myName, setMyName] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const printRef = useRef(null);
  const headingRef = useRef(null);
  const printCleanup = useRef(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    return () => printCleanup.current?.();
  }, []);

  useEffect(() => {
    let live = true;
    setOpen(null); setJobRows({}); setMyName(""); setPartnerName("");
    setLoading(true); setError(false);
    (async () => {
      try {
        if (!me?.id || !applicationId) return;
        const [apps, ah] = await Promise.all([
          supabase.from("applications")
            .select("id, job_number, status, terms_snapshot, terms_confirmed_worker_at, terms_confirmed_farmer_at")
            .eq(isWorker ? "worker_id" : "farmer_id", me.id)
            .eq("id", applicationId)
            .not("terms_confirmed_farmer_at", "is", null),
          supabase.from("account_holders").select("full_name").eq("auth_id", me.id).maybeSingle(),
        ]);
        if (apps.error) throw apps.error;
        const r = (apps.data || []).find(row => row.id === applicationId && row.terms_confirmed_farmer_at &&
          (row.terms_snapshot || row.terms_confirmed_worker_at || row.status === "completed"));
        if (!r || !live) return;
        let jobs = {};
        if (!r.terms_snapshot) {
          const result = await fetchJobRowsForMe([r.job_number]);
          if (result.error && !result.rows[r.job_number]) throw result.error;
          jobs = result.rows;
        }
        const terms = r.terms_snapshot || jobs[r.job_number] || {};
        const frozenName = isWorker ? (terms.party_names?.farmer || terms.recruiter_name) : terms.party_names?.worker;
        let name = "";
        if (!frozenName) {
          const result = await supabase.rpc("contract_party_name", { p_application_id: r.id });
          if (!result.error && result.data?.ok) name = result.data.name || "";
        }
        if (!live) return;
        setJobRows(jobs); setMyName(ah.data?.full_name || ""); setPartnerName(name); setOpen(r);
      } catch {
        if (live) setError(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [me?.id, isWorker, applicationId, reload]);

  const termsOf = (r) => {
    if (r?.terms_snapshot) return { s: r.terms_snapshot, fromJob: false };
    const j = jobRows[r?.job_number];
    return { s: j ? { ...j, address: j.work_address } : {}, fromJob: true };
  };
  const back = () => {
    if (!returnAlongPath()) window.location.hash = isWorker ? "/profile/worker/applying" : "/profile/employer/applicants";
  };
  const noticeFileName = (r) => {
    const s = termsOf(r).s;
    const label = [s.crop, s.task].filter(Boolean).join(" ");
    return ["労働条件通知書", r?.job_number ? "No" + r.job_number : "", label].filter(Boolean).join("_");
  };

  // PDFで保存＝印刷ダイアログを通さずにPDFファイルを保存する（2026-08-19たきと報告）。
  // iPhone Safari の印刷シートからPDFにするのは隠れた操作が要るため、ここで直接ファイルを作る。
  // 写す範囲は通知書の本体だけ（ボタンは .no-print ので写らない）
  const savePdf = async (r) => {
    if (pdfBusy) return;
    setPdfBusy(true);
    const finishMeasurement = productAnalytics.begin("pdf");
    try {
      await saveElementAsPdf(printRef.current, noticeFileName(r));
      finishMeasurement("success");
    } catch (error) {
      alert(error?.message === "PDF_TIMEOUT"
        ? "PDFの作成が時間内に完了しませんでした。もう一度「PDFで保存」をお試しください。"
        : "PDFを作成できませんでした。お手数ですが「印刷する」からお試しください。");
    } finally {
      finishMeasurement("failure");
      setPdfBusy(false);
    }
  };

  const printNotice = (r) => {
    printCleanup.current?.();
    const docTitle = noticeFileName(r);
    const prevTitle = document.title;
    const el = [document.documentElement, document.body];
    el.forEach(n => n && n.classList.add("cb-print-doc"));
    document.title = docTitle;
    let timer;
    const off = () => {
      clearTimeout(timer);
      printCleanup.current = null;
      el.forEach(n => n && n.classList.remove("cb-print-doc"));
      document.title = prevTitle;
      window.removeEventListener("afterprint", off);
    };
    window.addEventListener("afterprint", off);
    printCleanup.current = off;
    timer = setTimeout(off, 60000);
    try { window.print(); } catch { off(); }
  };

  return createPortal(
    <section role="main" className="labor-notice-page cb-ctr-print-overlay f-sans" style={{ "--notice-accent": accent }} aria-labelledby="labor-notice-heading">
      <header className="labor-notice-header no-print">
        <button type="button" onClick={back} aria-label={routeReturn()?.label || "応募一覧に戻る"}>‹</button>
        <h1 id="labor-notice-heading" ref={headingRef} tabIndex={-1}>労働条件通知書</h1>
      </header>
      <div className="labor-notice-scroll cb-ctr-print-sheet">
        {!open && <div className="labor-notice-feedback" role="status">
          <p>{loading ? <>通知書を読み込み中<Dots /></> : error
            ? "通知書を読み込めませんでした。通信状況を確認して、もう一度お試しください。"
            : "この仕事の労働条件の記録を確認できません。応募一覧からご確認ください。"}</p>
          {error && <button type="button" onClick={() => setReload(value => value + 1)}>再読み込み</button>}
        </div>}
        {open && (() => {
          const r = open; const { s, fromJob } = termsOf(r);
          const farmerName = s?.party_names?.farmer || s?.recruiter_name || (isWorker ? partnerName : myName) || "—";
          const workerName = s?.party_names?.worker || (isWorker ? myName : partnerName) || "—";
          const sections = buildSections(s, r);
          return (
                <div className="cb-ctr-print" ref={printRef}>
                  <p className="f-sans" style={{ fontSize:19, fontWeight:800, color:"#222", margin:"0 0 2px", textAlign:"center" }}>労働条件通知書</p>
                  <p className="f-sans" style={{ fontSize:11, color:"#909090", margin:"0 0 14px", textAlign:"center" }}>
                    {fromJob ? "求人の記録から作成" : "採用（両者の確認）の時点で凍結された記録"}　{fmtJstFull(s.snapshot_at || r.terms_confirmed_farmer_at) || "—"}
                  </p>
                  {/* 凍結が無い採用（2026-08-24たきと指示「通知書の提供は義務だ」）：
                      出さない選択肢は取らず、求人の記録から作って「凍結ではない」ことを紙にも明示する。
                      ★憲法3条（ダミー禁止）に触れない＝これは実在する求人の記録で、作り話ではない */}
                  {fromJob && (
                    <div className="cb-ctr-sec" style={{ border:"1px solid #F0D9A8", background:"#FFF9EC", borderRadius:10, padding:"10px 12px", marginBottom:14 }}>
                      <p className="f-sans" style={{ fontSize:11.5, color:"#7A5A10", lineHeight:1.8, margin:0 }}>
                        この通知書は、採用の時点で凍結された記録が無いため、<b>求人の記録から作成</b>しています。
                        求人があとから書き換えられている場合、この内容が採用の時点と違うことがあります。
                        内容に違いがあるときは、当事者どうしで確認してください。
                      </p>
                    </div>
                  )}

                  {/* 当事者欄 */}
                  <div className="cb-ctr-sec" style={{ border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 12px", marginBottom:14 }}>
                    <p className="f-sans" style={{ fontSize:11, color:"#909090", margin:"0 0 2px" }}>雇用者（募集主）</p>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 2px" }}>{farmerName}</p>
                    {s.recruiter_address && <p className="f-sans" style={{ fontSize:12, color:"#444", margin:0 }}>{s.recruiter_address}</p>}
                    {s.recruiter_contact && <p className="f-sans" style={{ fontSize:12, color:"#444", margin:0 }}>{s.recruiter_contact}</p>}
                    <p className="f-sans" style={{ fontSize:11, color:"#909090", margin:"10px 0 2px" }}>労働者</p>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>{workerName}</p>
                  </div>

                  {sections.map(sec => (
                    <div key={sec.h} className="cb-ctr-sec" style={{ marginBottom:12 }}>
                      <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:accent, margin:"0 0 6px" }}>{sec.h}</p>
                      <div style={{ display:"grid", gap:8 }}>
                        {sec.rows.map(([k, v]) => (
                          <div key={k} style={{ display:"flex", gap:10, borderBottom:"1px solid #F0F0F0", paddingBottom:8 }}>
                            <span className="f-sans" style={{ fontSize:12, color:"#909090", minWidth:104, flexShrink:0 }}>{k}</span>
                            <span className="f-sans" style={{ fontSize:13, color: v ? "#222" : "#B0B0B0", overflowWrap:"break-word", wordBreak:"break-word", whiteSpace:"pre-wrap" }}>{v || "記録にありません"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* 記録の来歴（争いになったときに、いつ誰が確認したかを示す） */}
                  <div style={{ display:"grid", gap:8, marginTop:14 }}>
                    {[["働き手の内容確認", fmtJstFull(r.terms_confirmed_worker_at)], ["募集主の採用", fmtJstFull(r.terms_confirmed_farmer_at)]].map(([k, v]) => (
                      <div key={k} style={{ display:"flex", gap:10 }}>
                        <span className="f-sans" style={{ fontSize:11, color:"#909090", minWidth:104, flexShrink:0 }}>{k}</span>
                        <span className="f-sans" style={{ fontSize:11, color:"#444" }}>{v || "—"}</span>
                      </div>
                    ))}
                  </div>

                  <p className="f-sans" style={{ fontSize:10.5, color:"#909090", lineHeight:1.8, margin:"14px 0 0" }}>
                    {fromJob
                      ? "この通知書は、採用の時点で凍結された記録が無いため、求人の記録から作成しています（凍結記録ではありません）。"
                      : "この通知書は、採用（両者の確認）の時点で凍結された記録から作成しています。あとから変更できません。"}<br />
                    次の事項はこの記録に残っていません：{NOT_RECORDED_ITEMS}。必要な場合は当事者間で別途明示してください。<br />
                    雇用の契約は募集主と働き手の当事者間で成立しています。<br />
                    chitose-bank（https://chitose-bank.com）
                  </p>
                </div>
          );
        })()}
      </div>
      {open && <footer className="labor-notice-actions no-print">
        <button type="button" onClick={() => printNotice(open)}>印刷する</button>
        <button type="button" className="labor-notice-save" onClick={() => savePdf(open)} disabled={pdfBusy} aria-busy={pdfBusy}>{pdfBusy ? <>作成中<Dots /></> : "PDFで保存"}</button>
      </footer>}
    </section>, document.body
  );
}
