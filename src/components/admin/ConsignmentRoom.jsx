// 委託 準備室（#/admin/consignment・管理者専用・分割3-Aで切り出し2026-07-24）。
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

// ── 委託 準備室（#/admin/consignment・管理者専用・2026-07-19）：B2B委託レーンの手動1件（この冬・運営者自身がモデル）用の内部道具。
//    市場機能（掲載板・受託者画面・決済）は作らない——手動1件の後に判断（たきと指示）。
//    タブ2つ：仕様書（フォーム→保存→印刷ビュー）／台帳（consignment_deals一覧・行タップで編集・状態更新・メモ）
const CONSIGN_STEPS = ["下書き", "合意", "前金", "作業中", "検収", "支払", "完了"];
const consignStepState = (d) => {
  const s = d.spec || {}; const st = d.status || "draft";
  const beyond = (arr) => arr.includes(st);
  const hasDeposit = !!(s.advance && String(s.advance).trim()) || (d.deposit_amount != null && d.deposit_amount > 0);
  const done = [
    true,                                                                    // 下書き
    beyond(["agreed","working","inspected","paid","done"]) || !!d.agreed_at,  // 合意
    (!hasDeposit) || !!s.deposit_received_at || beyond(["working","inspected","paid","done"]), // 前金
    beyond(["working","inspected","paid","done"]),                           // 作業中
    !!d.inspected_at || beyond(["inspected","paid","done"]),                 // 検収
    !!d.paid_at || beyond(["paid","done"]),                                  // 支払
    st === "done",                                                           // 完了
  ];
  return { done, active: done.findIndex(x => !x) };
};

const CONSIGN_STATUS = [
  { k:"draft",     l:"下書き", bg:"#F5F5F5", fg:"#717171" },
  { k:"agreed",    l:"合意",   bg:"#E8F0FE", fg:"#1A56C5" },
  { k:"working",   l:"作業中", bg:"#FFF4E0", fg:"#C77700" },
  { k:"inspected", l:"検収済", bg:"#E6F7EF", fg:"#00A86B" },
  { k:"paid",      l:"支払済", bg:"#E6F7EF", fg:"#00A86B" },
  { k:"done",      l:"完了",   bg:"#F3F3F3", fg:"#999" },
];

// 進行ステッパー（FlowBarと同じ視覚文法：緑の✓＝完了・緑リング＝現在地・グレー＝未着手）
function ConsignStepper({ deal }) {
  const { done, active } = consignStepState(deal);
  return (
    <div style={{ display:"flex", alignItems:"flex-start", margin:"4px 0 18px" }}>
      {CONSIGN_STEPS.map((s, i) => {
        const isDone = done[i]; const isActive = i === active; const reached = isDone || isActive;
        return (
          <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
            {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? "#00A86B" : "#E5E5E5" }} />}
            <div style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, boxSizing:"border-box",
              background: isDone ? "#00A86B" : "#fff", border: isDone ? "none" : isActive ? "2px solid #00A86B" : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? "#00A86B" : "#C8C8C8" }}>
              {isDone ? "✓" : ""}
            </div>
            <span className="f-sans" style={{ fontSize:9, marginTop:4, lineHeight:1.2, textAlign:"center", color: reached ? "#00A86B" : "#B0B0B0", fontWeight: isActive ? 700 : 500 }}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

const CONSIGN_FIXED_CLAUSES = [
  "本委託の対価は作業の実施であり、収量・収益を保証するものではありません",
  "賠償は本件報酬額を上限とし、逸失利益は対象外とします（故意・重過失を除く）",
  "作業の指揮命令は受託者の責任者が行います",
  "天候等による中止：開始◯日前までの通知は無償、以後は前金を上限に精算",
  "支払い：前金→区画ごとの検収後に残額",
];

const CONSIGN_EMPTY = { contractor:"", field_name:"", area_a:"", crop:"", task:"", unit_price_10a:"", total:"", advance:"", period_start:"", period_end:"", inspection:"", field_cond:"", special:"" };

const CONSIGN_BASIC_FIELDS = [
  { k:"contractor",     l:"受託者名" },
  { k:"field_name",     l:"圃場の呼び名" },
  { k:"area_a",         l:"面積（a）" },
  { k:"crop",           l:"作物" },
  { k:"task",           l:"作業" },
  { k:"unit_price_10a", l:"単価（10aあたり・円）" },
  { k:"total",          l:"総額（円）" },
  { k:"advance",        l:"前金額（円）" },
];

const CONSIGN_TEXT_FIELDS = [
  { k:"inspection", l:"検収基準", ph:"例：2L以上・軸2cm・コンテナ渡し" },
  { k:"field_cond", l:"圃場条件", ph:"残渣・傾斜・進入路など" },
  { k:"special",    l:"特約",     ph:"あれば記入" },
];

export function ConsignmentRoom() {
  const [cTab, setCTab] = useState("spec"); // spec=仕様書 / ledger=台帳
  const [spec, setSpec] = useState({ ...CONSIGN_EMPTY });
  const [editId, setEditId] = useState(null);
  const [curDeal, setCurDeal] = useState(null); // 開いている案件の全行（status/agreed_at/inspected_at/paid_at/spec_snapshot等）
  const [status, setStatus] = useState("draft");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [deals, setDeals] = useState([]);
  const [progAgg, setProgAgg] = useState({}); // 台帳の要約用：deal_id→{hours,boxes,days}
  const [busy, setBusy] = useState(false);
  const todayJst = () => { try { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); } };
  // 日次進捗（作業中）
  const [prog, setProg] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pForm, setPForm] = useState({ work_date: "", hours: "", workers: "", yield_boxes: "", note: "" });
  const [inspectNote, setInspectNote] = useState("");
  const [reflection, setReflection] = useState("");
  const dealAreaA = (d) => { const v = d?.area_a != null ? d.area_a : (d?.spec || {}).area_a; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const hoursPer10a = (hours, area) => area ? Math.round(hours * 10 / area * 10) / 10 : null;
  const loadDeals = async () => {
    const [dl, pr] = await Promise.all([
      supabase.from("consignment_deals").select("*").order("created_at", { ascending: false }),
      supabase.from("consignment_progress").select("deal_id,hours,yield_boxes,work_date"),
    ]);
    setDeals(dl.data || []);
    const agg = {};
    (pr.data || []).forEach(r => { const a = agg[r.deal_id] || { hours: 0, boxes: 0, days: new Set() }; a.hours += Number(r.hours || 0); a.boxes += Number(r.yield_boxes || 0); if (r.work_date) a.days.add(r.work_date); agg[r.deal_id] = a; });
    const out = {}; Object.entries(agg).forEach(([k, v]) => { out[k] = { hours: v.hours, boxes: v.boxes, days: v.days.size }; });
    setProgAgg(out);
  };
  const loadProgress = async (id) => {
    if (!id) { setProg([]); setSummary(null); return; }
    const [{ data: rows }, { data: sum }] = await Promise.all([
      supabase.from("consignment_progress").select("*").eq("deal_id", id).order("work_date", { ascending: false }),
      supabase.rpc("consignment_summary", { p_deal_id: id }),
    ]);
    setProg(rows || []);
    setSummary(sum && sum.ok ? sum : null);
  };
  useEffect(() => { loadDeals(); }, []);
  const setF = (k, v) => setSpec(p => ({ ...p, [k]: v }));
  const refreshCur = async (id) => {
    const { data } = await supabase.from("consignment_deals").select("*").eq("id", id).maybeSingle();
    if (data) { setCurDeal(data); setStatus(data.status || "draft"); }
    await loadDeals();
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = { spec: { ...spec, fixed_clauses: CONSIGN_FIXED_CLAUSES }, status, notes: memo.trim() || null, updated_at: new Date().toISOString() };
      if (editId) {
        const { error } = await supabase.from("consignment_deals").update(payload).eq("id", editId);
        if (error) { alert("保存に失敗しました：" + error.message); setSaving(false); return; }
        await refreshCur(editId);
      } else {
        const { data, error } = await supabase.from("consignment_deals").insert(payload).select("*").single();
        if (error) { alert("保存に失敗しました：" + error.message); setSaving(false); return; }
        if (data) { setEditId(data.id); setCurDeal(data); }
        await loadDeals();
      }
    } catch { alert("保存に失敗しました。"); }
    setSaving(false);
  };
  // 状態を1つ進める共通処理（合意/前金/作業中/検収/支払/完了）。パッチをupdate→現行行を取り直す
  const advance = async (patch, confirmMsg) => {
    if (busy || !editId) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    const { error } = await supabase.from("consignment_deals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", editId);
    if (error) { alert("更新に失敗しました：" + error.message); setBusy(false); return; }
    await refreshCur(editId);
    setBusy(false);
  };
  const makeAgreed = () => advance({ status: "agreed" }, "この内容で合意にしますか？\n合意すると、いまの仕様書が「合意時の仕様書」として凍結されます。");
  const receiveDeposit = async () => advance({ spec: { ...(curDeal?.spec || spec), deposit_received_at: todayJst() } }, "前金を受領した記録を残しますか？");
  const startWork = () => advance({ status: "working" }, "作業中にしますか？");
  const doInspect = () => advance({ status: "inspected", inspected_at: todayJst(), notes: inspectNote.trim() || (curDeal?.notes || null) }, "検収を記録しますか？");
  const doPay = () => advance({ status: "paid", paid_at: todayJst() }, "残金の支払いを記録しますか？");
  const doComplete = () => advance({ status: "done", spec: { ...(curDeal?.spec || spec), reflection: reflection.trim() } }, "この委託を完了にしますか？");
  const addProgress = async () => {
    if (busy || !editId) return;
    const p = pForm;
    if (!p.hours && !p.yield_boxes && !p.workers && !p.note.trim()) { alert("実働時間・人数・収量箱・メモのいずれかを入力してください。"); return; }
    setBusy(true);
    const { error } = await supabase.from("consignment_progress").insert({
      deal_id: editId,
      work_date: p.work_date || todayJst(),
      hours: p.hours === "" ? null : Number(p.hours),
      workers: p.workers === "" ? null : parseInt(p.workers, 10),
      yield_boxes: p.yield_boxes === "" ? null : parseInt(p.yield_boxes, 10),
      note: p.note.trim() || "",
    });
    if (error) { alert("記録に失敗しました：" + error.message); setBusy(false); return; }
    setPForm({ work_date: "", hours: "", workers: "", yield_boxes: "", note: "" });
    await loadProgress(editId);
    setBusy(false);
  };
  const openDeal = (d) => { setSpec({ ...CONSIGN_EMPTY, ...(d.spec || {}) }); setEditId(d.id); setCurDeal(d); setStatus(d.status || "draft"); setMemo(d.notes || ""); setInspectNote(d.notes || ""); setReflection((d.spec || {}).reflection || ""); setCTab("spec"); loadProgress(d.id); };
  const newDeal = () => { setSpec({ ...CONSIGN_EMPTY }); setEditId(null); setCurDeal(null); setStatus("draft"); setMemo(""); setInspectNote(""); setReflection(""); setProg([]); setSummary(null); setCTab("spec"); };
  const stBadge = (k) => CONSIGN_STATUS.find(s => s.k === k) || CONSIGN_STATUS[0];
  const period = [spec.period_start, spec.period_end].filter(Boolean).join(" 〜 ");
  // 合意後にフォームを変更したか（保存済みspec vs 凍結snapshot・基本/テキスト項目で比較）
  const specKeys = [...CONSIGN_BASIC_FIELDS.map(f => f.k), ...CONSIGN_TEXT_FIELDS.map(f => f.k), "period_start", "period_end"];
  const pick = (o) => specKeys.reduce((a, k) => { a[k] = (o || {})[k] || ""; return a; }, {});
  const changedAfterAgree = !!(curDeal && curDeal.spec_snapshot && JSON.stringify(pick(curDeal.spec)) !== JSON.stringify(pick(curDeal.spec_snapshot)));
  const snapAtLabel = curDeal?.snapshot_at ? new Date(curDeal.snapshot_at).toLocaleString("ja-JP") : "";
  const hasDeposit = !!(spec.advance && String(spec.advance).trim());

  if (printOpen) {
    return (
      <div style={{ maxWidth:760, margin:"0 auto", padding:"24px 16px 120px" }}>
        <div className="no-print" style={{ display:"flex", gap:8, marginBottom:16 }}>
          <button onClick={()=>setPrintOpen(false)} className="f-sans" style={{ padding:"9px 16px", fontSize:13, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>← 戻る</button>
          <button onClick={()=>window.print()} className="btn-primary f-sans" style={{ padding:"9px 20px", fontSize:13, fontWeight:700, borderRadius:10 }}>🖨 印刷する</button>
        </div>
        <div className="consign-print" style={{ background:"#fff", border:"1px solid #DDD", borderRadius:4, padding:"32px 28px", fontFamily:"serif", color:"#111" }}>
          <h1 className="f-sans" style={{ fontSize:22, fontWeight:800, textAlign:"center", margin:"0 0 4px" }}>農作業委託 仕様書</h1>
          <p className="f-sans" style={{ fontSize:11, color:"#666", textAlign:"center", margin:"0 0 20px" }}>chitose-bank 委託準備室</p>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, marginBottom:18 }}>
            <tbody>
              {[...CONSIGN_BASIC_FIELDS.map(f => [f.l, spec[f.k]]), ["作業期間", period]].map(([l, v]) => (
                <tr key={l}>
                  <td style={{ border:"1px solid #999", padding:"7px 10px", width:170, background:"#F5F5F5", fontWeight:700 }}>{l}</td>
                  <td style={{ border:"1px solid #999", padding:"7px 10px" }}>{v || "　"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {CONSIGN_TEXT_FIELDS.map(f => (
            <div key={f.k} style={{ marginBottom:14 }}>
              <p className="f-sans" style={{ fontSize:13, fontWeight:700, margin:"0 0 4px" }}>■ {f.l}</p>
              <p style={{ fontSize:13, lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", border:"1px solid #999", padding:"8px 10px", minHeight:36 }}>{spec[f.k] || "　"}</p>
            </div>
          ))}
          <div style={{ marginTop:18 }}>
            <p className="f-sans" style={{ fontSize:13, fontWeight:700, margin:"0 0 6px" }}>■ 定型条項（全仕様書共通）</p>
            {CONSIGN_FIXED_CLAUSES.map(c => (
              <p key={c} style={{ fontSize:12, lineHeight:1.9, margin:0 }}>・{c}</p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth:640, margin:"0 auto", padding:"24px 16px 120px" }}>
      <button onClick={()=>{ window.location.hash = "/admin"; }} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, fontWeight:600, color:"#717171", cursor:"pointer", padding:"7px 14px", marginBottom:16 }}>← 管理</button>
      <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 4px" }}>🚩 委託 準備室</p>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 16px" }}>B2B委託レーンの手動1件用の内部道具です（管理者のみ・市場機能はまだ作らない）</p>
      <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
        {[{ k:"spec", l:"📄 仕様書" }, { k:"ledger", l:"📚 台帳", n:deals.length }].map(t => (
          <button key={t.k} onClick={()=>setCTab(t.k)} className="f-sans"
            style={{ flex:1, padding:"11px 0", borderRadius:12, border: cTab===t.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:14, fontWeight: cTab===t.k ? 800 : 600, color: cTab===t.k ? "#222" : "#999", cursor:"pointer" }}>
            {t.l}{t.n > 0 ? `（${t.n}）` : ""}
          </button>
        ))}
      </div>

      {cTab === "spec" && (
        <div className="fade-in">
          {editId && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
              <span className="f-sans" style={{ fontSize:12, color:"#717171" }}>編集中：{spec.contractor || "（受託者未記入）"}</span>
              <button onClick={newDeal} className="f-sans" style={{ marginLeft:"auto", background:"none", border:"1px solid #EBEBEB", borderRadius:8, padding:"5px 10px", fontSize:12, color:"#717171", cursor:"pointer" }}>＋ 新規作成</button>
            </div>
          )}

          {/* ── 全行程の進行（保存済みの案件のみ）：ステッパー＋現在の状態に応じたアクション ── */}
          {editId && curDeal && (
            <div style={{ border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", marginBottom:16, background:"#fff" }}>
              <ConsignStepper deal={curDeal} />

              {/* 合意（下書き→合意）：仕様書を凍結 */}
              {curDeal.status === "draft" && (
                <button onClick={makeAgreed} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#1A56C5", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{busy ? "..." : "🤝 合意にする（仕様書を凍結）"}</button>
              )}

              {/* 合意時の仕様書（凍結・契約記録と同じ方式） */}
              {curDeal.spec_snapshot && (
                <details style={{ marginTop: curDeal.status === "draft" ? 12 : 0 }}>
                  <summary className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#1A56C5", cursor:"pointer" }}>📸 合意時の仕様書（凍結・{snapAtLabel}）</summary>
                  <div style={{ marginTop:10, background:"#F7F9FF", border:"1px solid #DCE6FB", borderRadius:10, padding:"10px 12px", display:"grid", gap:6 }}>
                    {[...CONSIGN_BASIC_FIELDS, { k:"period_start", l:"作業期間（開始）" }, { k:"period_end", l:"作業期間（終了）" }, ...CONSIGN_TEXT_FIELDS].map(f => {
                      const v = (curDeal.spec_snapshot || {})[f.k];
                      return v ? (
                        <div key={f.k} style={{ display:"flex", gap:10 }}>
                          <span className="f-sans" style={{ fontSize:11, color:"#8AA0C8", minWidth:96, flexShrink:0 }}>{f.l}</span>
                          <span className="f-sans" style={{ fontSize:12, color:"#222", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{v}</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                  {changedAfterAgree && (
                    <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#C77700", margin:"8px 0 0" }}>※ 合意後の変更あり（上のフォームは凍結内容と異なります）</p>
                  )}
                </details>
              )}

              {/* 前金：deposit入力済みなら受領ボタン（合意〜作業前） */}
              {(curDeal.status === "agreed") && hasDeposit && (
                <div style={{ marginTop:12 }}>
                  {curDeal.spec?.deposit_received_at ? (
                    <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#00A86B", margin:0 }}>✓ 前金 受領済み（{curDeal.spec.deposit_received_at}）</p>
                  ) : (
                    <button onClick={receiveDeposit} disabled={busy} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#1A56C5", border:"1px solid #1A56C5", borderRadius:10, cursor:"pointer" }}>💴 前金を受領した（{Number(spec.advance).toLocaleString()}円）</button>
                  )}
                </div>
              )}

              {/* 作業を開始（合意→作業中） */}
              {curDeal.status === "agreed" && (
                <button onClick={startWork} disabled={busy} className="f-sans" style={{ width:"100%", marginTop:12, padding:"12px", fontSize:14, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>▶ 作業を開始する（作業中にする）</button>
              )}

              {/* 検収（作業中→検収済） */}
              {curDeal.status === "working" && (
                <div style={{ marginTop:12 }}>
                  <input className="field f-sans" value={inspectNote} onChange={e=>setInspectNote(e.target.value)} placeholder="検収メモ（任意・基準の可否など）" style={{ fontSize:13, marginBottom:8 }} />
                  <button onClick={doInspect} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>✓ 検収した</button>
                </div>
              )}

              {/* 支払（検収済→支払済） */}
              {curDeal.status === "inspected" && (
                <button onClick={doPay} disabled={busy} className="f-sans" style={{ width:"100%", marginTop:12, padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>💰 残金を支払った</button>
              )}

              {/* 完了（支払済→完了）＋振り返り */}
              {curDeal.status === "paid" && (
                <div style={{ marginTop:12 }}>
                  <textarea className="field f-sans" value={reflection} onChange={e=>setReflection(e.target.value)} placeholder="振り返りメモ（次回への気づき・任意）" rows={2} style={{ fontSize:13, marginBottom:8, resize:"vertical" }} />
                  <button onClick={doComplete} disabled={busy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>🏁 完了にする</button>
                </div>
              )}
              {curDeal.status === "done" && (
                <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#00A86B", margin:0, textAlign:"center" }}>🏁 この委託は完了しています{curDeal.spec?.reflection ? "" : ""}</p>
              )}
              {curDeal.status === "done" && curDeal.spec?.reflection && (
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"8px 0 0", whiteSpace:"pre-wrap" }}>振り返り：{curDeal.spec.reflection}</p>
              )}
            </div>
          )}

          {/* ── 日次進捗（作業中以降）：履行サマリー＋1行フォーム＋日別一覧 ── */}
          {editId && curDeal && ["working","inspected","paid","done"].includes(curDeal.status) && (
            <div style={{ border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", marginBottom:16, background:"#fff" }}>
              <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:"0 0 10px" }}>📋 日次進捗</p>
              {summary && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                  {[
                    ["実働合計", summary.total_hours != null ? `${summary.total_hours}h` : "—"],
                    ["稼働日数", `${summary.work_days ?? 0}日`],
                    ["延べ人数", `${summary.total_workers ?? 0}人`],
                    ["収量", `${summary.total_boxes ?? 0}箱`],
                    ["10aあたり", summary.hours_per_10a != null ? `${summary.hours_per_10a}h` : "—"],
                  ].map(([l, v]) => (
                    <div key={l} style={{ flex:"1 0 30%", background:"#F7F7F7", borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                      <span className="f-sans" style={{ display:"block", fontSize:10, color:"#B0B0B0" }}>{l}</span>
                      <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {curDeal.status === "working" && (
                <div style={{ background:"#F9FAFB", border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                    <div><label className="lbl f-sans" style={{ fontSize:11 }}>日付</label><input type="date" className="field f-sans" value={pForm.work_date} onChange={e=>setPForm(p=>({...p, work_date:e.target.value}))} style={{ fontSize:13, marginBottom:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:11 }}>実働時間(h)</label><input inputMode="decimal" className="field f-sans" value={pForm.hours} onChange={e=>setPForm(p=>({...p, hours:e.target.value.replace(/[^0-9.]/g,"")}))} placeholder="例：6.5" style={{ fontSize:13, marginBottom:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:11 }}>人数</label><input inputMode="numeric" className="field f-sans" value={pForm.workers} onChange={e=>setPForm(p=>({...p, workers:e.target.value.replace(/[^0-9]/g,"")}))} placeholder="例：3" style={{ fontSize:13, marginBottom:0 }} /></div>
                    <div><label className="lbl f-sans" style={{ fontSize:11 }}>収量（箱）</label><input inputMode="numeric" className="field f-sans" value={pForm.yield_boxes} onChange={e=>setPForm(p=>({...p, yield_boxes:e.target.value.replace(/[^0-9]/g,"")}))} placeholder="例：40" style={{ fontSize:13, marginBottom:0 }} /></div>
                  </div>
                  <input className="field f-sans" value={pForm.note} onChange={e=>setPForm(p=>({...p, note:e.target.value}))} placeholder="メモ（任意）" style={{ fontSize:13, marginBottom:8 }} />
                  <button onClick={addProgress} disabled={busy} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>＋ 進捗を記録</button>
                </div>
              )}
              {prog.length === 0 ? (
                <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", padding:"12px 0", margin:0 }}>日次の記録はまだありません</p>
              ) : (
                <div style={{ display:"grid", gap:6 }}>
                  {prog.map(r => (
                    <div key={r.id} style={{ display:"flex", gap:10, alignItems:"baseline", borderBottom:"1px solid #F7F7F7", paddingBottom:6 }}>
                      <span className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", minWidth:78, flexShrink:0 }}>{r.work_date}</span>
                      <span className="f-sans" style={{ fontSize:12, color:"#555", flex:1, minWidth:0 }}>
                        {[r.hours != null ? `${r.hours}h` : null, r.workers != null ? `${r.workers}人` : null, r.yield_boxes != null ? `${r.yield_boxes}箱` : null].filter(Boolean).join("・")}
                        {r.note ? `　${r.note}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {CONSIGN_BASIC_FIELDS.map(f => (
            <div key={f.k} style={{ marginBottom:10 }}>
              <label className="lbl f-sans">{f.l}</label>
              <input className="field f-sans" value={spec[f.k]} onChange={e=>setF(f.k, e.target.value)} style={{ fontSize:14, marginBottom:0 }} />
            </div>
          ))}
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <div style={{ flex:1 }}>
              <label className="lbl f-sans">作業期間（開始）</label>
              <input className="field f-sans" type="date" value={spec.period_start} onChange={e=>setF("period_start", e.target.value)} style={{ fontSize:13, marginBottom:0 }} />
            </div>
            <div style={{ flex:1 }}>
              <label className="lbl f-sans">作業期間（終了）</label>
              <input className="field f-sans" type="date" value={spec.period_end} onChange={e=>setF("period_end", e.target.value)} style={{ fontSize:13, marginBottom:0 }} />
            </div>
          </div>
          {CONSIGN_TEXT_FIELDS.map(f => (
            <div key={f.k} style={{ marginBottom:10 }}>
              <label className="lbl f-sans">{f.l}</label>
              <textarea className="field f-sans" value={spec[f.k]} onChange={e=>setF(f.k, e.target.value)} placeholder={f.ph} rows={3} style={{ fontSize:13, lineHeight:1.7, marginBottom:0, resize:"vertical" }} />
            </div>
          ))}
          <div style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", margin:"14px 0" }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#717171", margin:"0 0 6px" }}>定型条項（編集不可・全仕様書に印字）</p>
            {CONSIGN_FIXED_CLAUSES.map(c => (
              <p key={c} className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.8, margin:0 }}>・{c}</p>
            ))}
          </div>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <div style={{ flex:1 }}>
              <label className="lbl f-sans">状態（手動上書き・通常は上のボタンで進める）</label>
              <select className="field f-sans" value={status} onChange={e=>setStatus(e.target.value)} style={{ fontSize:13, marginBottom:0 }}>
                {CONSIGN_STATUS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label className="lbl f-sans">メモ（内部用・仕様書には印字されない）</label>
            <textarea className="field f-sans" value={memo} onChange={e=>setMemo(e.target.value)} rows={2} style={{ fontSize:13, marginBottom:0, resize:"vertical" }} />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={save} disabled={saving} className="btn-primary f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, borderRadius:12, opacity: saving ? 0.6 : 1 }}>{saving ? "保存中..." : (editId ? "更新を保存" : "保存")}</button>
            <button onClick={()=>setPrintOpen(true)} className="f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, background:"#fff", color:"#222", border:"1px solid #222", borderRadius:12, cursor:"pointer" }}>🖨 印刷ビュー</button>
          </div>
        </div>
      )}

      {cTab === "ledger" && (
        <div className="fade-in">
          {deals.length === 0 ? (
            <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", textAlign:"center", padding:"32px 0" }}>台帳は空です。仕様書タブから保存すると、ここに並びます。</p>
          ) : deals.map(d => {
            const s = d.spec || {};
            const st = stBadge(d.status);
            const ag = progAgg[d.id]; const area = dealAreaA(d);
            const hpa = ag && area ? hoursPer10a(ag.hours, area) : null;
            return (
              <button key={d.id} onClick={()=>openDeal(d)} className="f-sans" style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"12px 4px", background:"none", border:"none", borderBottom:"1px solid #F7F7F7", textAlign:"left", cursor:"pointer" }}>
                <span style={{ flexShrink:0, padding:"3px 10px", borderRadius:8, fontSize:11, fontWeight:700, background:st.bg, color:st.fg }}>{st.l}</span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span className="f-sans" style={{ display:"block", fontSize:13, fontWeight:700, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.contractor || "（受託者未記入）"}　{[s.crop, s.task].filter(Boolean).join(" ")}</span>
                  <span className="f-sans" style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>{s.field_name || "圃場未記入"}・{s.area_a ? s.area_a + "a" : "面積未記入"}・総額{s.total ? Number(s.total).toLocaleString() + "円" : "未記入"}　{new Date(d.created_at).toLocaleDateString("ja-JP")}</span>
                  {ag && (ag.hours > 0 || ag.days > 0) && (
                    <span className="f-sans" style={{ display:"block", fontSize:11, color:"#00A86B", fontWeight:700, marginTop:2 }}>履行：実働{ag.hours}h・{ag.days}日{ag.boxes > 0 ? `・${ag.boxes}箱` : ""}{hpa != null ? `　10aあたり ${hpa}h` : ""}</span>
                  )}
                </span>
                <span style={{ fontSize:14, color:"#B0B0B0", flexShrink:0 }}>›</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
