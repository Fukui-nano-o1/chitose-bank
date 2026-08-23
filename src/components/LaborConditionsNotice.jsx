// 労働条件通知書カード（2026-08-18 たきと指示「労働条件通知書カードを新設する。両者のプロフィールページに新設」）
// ・両役割の入口カード。働き手＝ProfileHubの「わたしの記録」／雇い手＝FarmerDashboardの「記録」に置く。
//   同じ部品を role で出し分ける＝文言・体裁が片側だけ古くなることが起きない。
// ・出どころは applications.terms_snapshot（採用＝両者の確認の時点で凍結・変更不可）だけ。
//   現在のプロフィール・求人の値は一切混ぜない（凍結記録に現在値を混ぜると「通知書」が後から変わる）。
// ・読み取り専用：applications は当事者RLS（worker_id／farmer_id が自分の行のみ）。新しい保存・入力は無い。
// ・氏名の窓口は従来どおり：凍結名（terms_snapshot.party_names／掲載時の recruiter_name）を第一に、
//   凍結名を持たない旧契約だけ contract_party_name（当事者のみ・SECURITY DEFINER）で相手名を引く。
//   自分の氏名は account_holders（self-read）。worker_profiles へ本名を写さない原則（2026-07-30裁定(B)）は不変。
// ・★記録に無い法定の明示事項（契約の更新・変更の範囲・退職に関する事項ほか）は作らない（データ憲法3条・
//   表示にダミー禁止）。「記録にありません」と正直に出し、文末で当事者間の別途明示を促す。
// ・印刷は appStyles の「契約の印刷」@media print と対（.cb-ctr-print / -overlay / -sheet の3クラス）。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { payTermsLine, overtimeLine, WAGE_CLOSING_RULE_LABELS, INSURANCE_ITEMS, normalizeInsuranceItems, ROLE_GREEN, ROLE_ORANGE } from "../lib/utils";

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

export default function LaborConditionsNotice({ me, role = "worker" }) {
  const isWorker = role === "worker";
  const accent = isWorker ? ROLE_ORANGE : ROLE_GREEN;
  const [rows, setRows] = useState(null);        // null=読み込み中
  const [myName, setMyName] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [open, setOpen] = useState(null);        // 表示中の契約（applications行）
  const [partnerName, setPartnerName] = useState(""); // 凍結名を持たない旧契約のRPCフォールバック名
  const [infoOpen, setInfoOpen] = useState(false); // 説明は？ボタンで展開（また呼びたいリストと同じ作法・2026-08-18たきと指示）

  useEffect(() => {
    if (!me?.id) return;
    let live = true;
    (async () => {
      const [apps, ah] = await Promise.all([
        supabase.from("applications")
          .select("id, job_number, terms_snapshot, terms_confirmed_worker_at, terms_confirmed_farmer_at")
          .eq(isWorker ? "worker_id" : "farmer_id", me.id)
          .not("terms_snapshot", "is", null)
          .order("terms_confirmed_farmer_at", { ascending: false, nullsFirst: false }),
        supabase.from("account_holders").select("full_name").eq("auth_id", me.id).maybeSingle(),
      ]);
      if (!live) return;
      if (!apps.error) setRows(apps.data || []); else setRows(r => r ?? []); // 失敗時は手元の値を上書きしない
      if (!ah.error && ah.data?.full_name) setMyName(ah.data.full_name);
    })();
    return () => { live = false; };
  }, [me?.id, isWorker]);

  const openNotice = (r) => {
    setOpen(r); setPartnerName("");
    const s = r.terms_snapshot || {};
    // 相手の凍結名が無い旧契約だけRPCで引く（働き手から見た相手＝募集主／雇い手から見た相手＝働き手）
    const frozen = isWorker ? (s?.party_names?.farmer || s?.recruiter_name) : s?.party_names?.worker;
    if (!frozen) {
      Promise.resolve(supabase.rpc("contract_party_name", { p_application_id: r.id }))
        .then(res => { if (!res.error && res.data?.ok && res.data.name) setPartnerName(res.data.name); })
        .catch(() => {});
    }
  };

  // 印刷（2026-08-18たきと報告「1枚目の大部分が空白」）：紙に出さないものを流し込みから外すため、
  // 押した瞬間に html/body へ .cb-print-doc を付ける。効くのは @media print の中だけなので画面は変わらない。
  // ★:has() に頼らない＝素のクラスセレクタで確実に当てる。afterprint は iOS で発火しないことが
  //   あるため時間でも外す（外し忘れても画面には影響しない）。
  const printNotice = () => {
    const el = [document.documentElement, document.body];
    el.forEach(n => n && n.classList.add("cb-print-doc"));
    const off = () => { el.forEach(n => n && n.classList.remove("cb-print-doc")); window.removeEventListener("afterprint", off); };
    window.addEventListener("afterprint", off);
    setTimeout(off, 60000);
    try { window.print(); } catch { off(); }
  };

  const count = rows ? rows.length : 0;

  return (
    <>
      {/* 「わたしの記録」「記録」カテゴリーの中に並ぶ1枚（2026-08-18たきと指示）＝専用の見出しは持たない。
          件数0でもカードは出す（タップ不能・非表示にしない＝2026-08-03の原則。中で説明を出す） */}
      <button type="button" onClick={() => setListOpen(true)} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"block", textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
        <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>労働条件通知書</span>
        <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:4, lineHeight:1.6 }}>
          {rows === null ? "読み込み中…" : count > 0 ? `${count}件　採用の時点で決まった労働条件です。表示・印刷できます` : (isWorker ? "採用が決まると、その時の労働条件がここに残ります" : "働き手の採用を決めると、その時の労働条件がここに残ります")}
        </span>
      </button>

      {/* 一覧（契約の選択）。ボックスは上下40pxの余白を残して画面中央＝2026-08-01に統一した
          編集モーダルと同じ規格（overlayに padding:"40px 16px"／シートは maxHeight:"100%"＝
          余白を差し引いた高さが上限）。85vhだと余白が上下で不均等に見えるので使わない */}
      {listOpen && createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget) setListOpen(false); }} className="cb-box-overlay cb-lock-scroll" style={{ zIndex:10000, padding:"40px 16px" }}>
          <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"20px", maxWidth:460, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", position:"relative" }}>
            {/* 見出し行ごと「？」の当たり判定にする（22pxだけだと外して黒幕に当たる・2026-08-18たきと報告）。
                ✕（右上・36px）と重ならないよう右に48pxの余白を空ける。？は見た目の丸チップ＝入れ子のbuttonにしない */}
            <button type="button" onClick={(e) => { e.stopPropagation(); setInfoOpen(v => !v); }} aria-label="説明を見る" aria-expanded={infoOpen}
              style={{ display:"flex", alignItems:"center", gap:8, width:"100%", margin:"0 0 12px", padding:"4px 48px 4px 0", background:"none", border:"none", cursor:"pointer", textAlign:"left" }}>
              <span className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222" }}>労働条件通知書</span>
              <span className="f-sans" style={{ width:22, height:22, borderRadius:11, background: infoOpen ? accent : "#F0F0F0", color: infoOpen ? "#fff" : "#717171", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>？</span>
            </button>
            {infoOpen && (
              <p className="fade-in f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.8, margin:"0 0 12px" }}>
                採用（両者の確認）が決まった時点の労働条件の記録です。タップすると内容の表示・印刷ができます。あとから変更できません。
              </p>
            )}
            {rows === null ? (
              <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", padding:"24px 8px" }}>読み込み中…</p>
            ) : count === 0 ? (
              <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", lineHeight:1.9, padding:"24px 8px" }}>
                まだ採用が決まった仕事はありません。<br />
                {isWorker ? "採用が決まると、その時の労働条件がここに残ります。" : "働き手の採用を決めると、その時の労働条件がここに残ります。"}
              </p>
            ) : (
              <div style={{ display:"grid", gap:8 }}>
                {rows.map(r => {
                  const s = r.terms_snapshot || {};
                  const title = [s.crop, s.task].filter(Boolean).join(" ") || `求人 #${r.job_number}`;
                  // 雇い手は同じ求人に複数人ぶん並ぶので、相手（働き手）の凍結名を添えて見分けられるようにする
                  const who = isWorker ? (s?.party_names?.farmer || s?.recruiter_name || "") : (s?.party_names?.worker || "");
                  return (
                    <button key={r.id} onClick={() => openNotice(r)} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px", background:"#fff", cursor:"pointer" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8 }}>
                        <span style={{ fontSize:13, fontWeight:700, color:"#222" }}>{title} <span style={{ fontSize:11, color:"#C8C8C8" }}>#{r.job_number}</span></span>
                        <span style={{ fontSize:11, color:"#B0B0B0", flexShrink:0 }}>{fmtJstFull(s.snapshot_at || r.terms_confirmed_farmer_at)}</span>
                      </div>
                      {who && <span style={{ display:"block", fontSize:12, color:"#717171", marginTop:2 }}>{isWorker ? "募集主" : "働き手"}：{who}</span>}
                      <span style={{ display:"block", fontSize:11, color:accent, marginTop:4 }}>表示・印刷 →</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* 通知書本体（印刷対象＝.cb-ctr-print） */}
      {open && createPortal(
        (() => {
          const r = open; const s = r.terms_snapshot || {};
          const farmerName = s?.party_names?.farmer || s?.recruiter_name || (isWorker ? partnerName : myName) || "—";
          const workerName = s?.party_names?.worker || (isWorker ? myName : partnerName) || "—";
          const sections = buildSections(s, r);
          // 印刷する／とじるは2箇所に置く（当事者欄の直下と、いちばん下）。
          // 長い通知書でも最後までスクロールせずに押せる。className="no-print" ＝紙には出ない
          const actionRow = (style) => (
            <div className="no-print" style={{ display:"flex", gap:10, ...style }}>
              <button onClick={printNotice} className="f-sans" style={{ flex:1, background:accent, color:"#fff", border:"none", borderRadius:12, padding:"13px 0", fontSize:14, fontWeight:700, cursor:"pointer" }}>印刷する</button>
              <button onClick={() => setOpen(null)} className="f-sans" style={{ flex:"0 0 auto", background:"#F0F0F0", color:"#555", border:"none", borderRadius:12, padding:"13px 18px", fontSize:14, fontWeight:700, cursor:"pointer" }}>とじる</button>
            </div>
          );
          return (
            <div onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }} className="cb-box-overlay cb-lock-scroll cb-ctr-print-overlay" style={{ zIndex: 10500, padding:"40px 16px" }}>
              <div onClick={e => e.stopPropagation()} className="cb-sheet-up cb-ctr-print-sheet" style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:460, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
                {/* ✕は置かない（外タップで閉じる・入力ボックスの統一と同じ作法）。下部に「とじる」あり */}
                <div className="cb-ctr-print">
                  <p className="f-sans" style={{ fontSize:19, fontWeight:800, color:"#222", margin:"0 0 2px", textAlign:"center" }}>労働条件通知書</p>
                  <p className="f-sans" style={{ fontSize:11, color:"#909090", margin:"0 0 14px", textAlign:"center" }}>
                    採用（両者の確認）の時点で凍結された記録　{fmtJstFull(s.snapshot_at || r.terms_confirmed_farmer_at) || "—"}
                  </p>

                  {/* 当事者欄 */}
                  <div className="cb-ctr-sec" style={{ border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 12px", marginBottom:14 }}>
                    <p className="f-sans" style={{ fontSize:11, color:"#909090", margin:"0 0 2px" }}>雇用者（募集主）</p>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 2px" }}>{farmerName}</p>
                    {s.recruiter_address && <p className="f-sans" style={{ fontSize:12, color:"#444", margin:0 }}>{s.recruiter_address}</p>}
                    {s.recruiter_contact && <p className="f-sans" style={{ fontSize:12, color:"#444", margin:0 }}>{s.recruiter_contact}</p>}
                    <p className="f-sans" style={{ fontSize:11, color:"#909090", margin:"10px 0 2px" }}>労働者</p>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>{workerName}</p>
                  </div>
                  {actionRow({ margin:"0 0 14px" })}

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
                    この通知書は、採用（両者の確認）の時点で凍結された記録から作成しています。あとから変更できません。<br />
                    次の事項はこの記録に残っていません：{NOT_RECORDED_ITEMS}。必要な場合は当事者間で別途明示してください。<br />
                    雇用の契約は募集主と働き手の当事者間で成立しています。<br />
                    chitose-bank（https://chitose-bank.com）
                  </p>
                </div>
                {actionRow({ marginTop:16 })}
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </>
  );
}
