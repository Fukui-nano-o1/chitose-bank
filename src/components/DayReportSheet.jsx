// その日の記録（遅刻・欠勤・相手に会えない）の入力シート（2026-08-19新設）。
// ★たきと指示「最終日だけ全体的な評価を入力。これは全ての工程の終了を意味する。
//   それ以外は遅刻や欠勤、農家が来ていないとかの入力にする」＝評価フローの中日側がこれ。
// ★この形は2箇所から開く：①今日ページの「今日の記録」の箱 ②今日ページの緊急連絡のシート。
//   同じ入力が枝分かれしないよう、フォームと保存はこの1部品に集約する
//   （種別を足す時は lib/utils の *_DAY_REPORT_KINDS ＝ attendance_events.kind の CHECK と対で直す）。
// 保存するのは attendance_events の1行だけ＝作業全体の出欠（applications.attended）には触れない。
//   出欠と完了は最終日の評価（submit_farmer_review／complete_work）が決める。
// DBの壁：attendance_events は当事者RLS（actor_id = auth.uid() かつ その応募の当事者）＝
//   画面はその手前の案内に徹する。相手への通知・運営への警報は trg_notify_attendance が撃つ。
// ★モジュールレベル定義を維持すること：親の中で定義すると再レンダーごとに再マウントされ、
//   textarea のフォーカス・入力中の下書きが消える（LandingFlowのフォーカス消失バグと同族）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { fbSuccess, fbError } from "../lib/feedback";
import { dayReportKinds, ymdLocal } from "../lib/utils";

// app＝{ id }（応募のID）。meId＝自分のauth_id。role＝"farmer" | "worker"（選択肢が変わる）。
// workDate＝この記録が指す作業日（"YYYY-MM-DD"／省略時は今日）。
// onDone(applicationId)＝保存できた時に親へ知らせる（一覧から消す・祝祭を出すのは親の仕事）。
export function DayReportSheet({ app, meId, role, workDate, onClose, onDone }) {
  const [kind, setKind] = useState("");
  const [detail, setDetail] = useState("");   // 内訳（選択式・kindにsubがある時だけ必須）
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 開き直したら前回の選択を持ち越さない（別の日・別の相手の記録に前の入力が残らないように）
  useEffect(() => { setKind(""); setDetail(""); setReason(""); }, [app?.id]);
  const kinds = dayReportKinds(role);
  const day = workDate || ymdLocal(new Date());
  const selKind = kinds.find(k => k.v === kind);
  const needsDetail = !!selKind?.sub;
  const submit = async () => {
    if (!app || !kind || submitting) return;
    if (needsDetail && !detail) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("attendance_events").insert({
        application_id: app.id, actor_id: meId, kind,
        detail: needsDetail ? detail : null,
        reason: reason.trim() || null, work_date: day,
      });
      if (error) { fbError(); alert("記録の保存に失敗しました：" + error.message); setSubmitting(false); return; }
      fbSuccess();
      onDone(app.id);
    } catch { alert("処理に失敗しました。"); }
    setSubmitting(false);
  };
  if (!app) return null;
  const dayLabel = (() => {
    const d = new Date(day + "T00:00:00");
    return isNaN(d) ? day : `${d.getMonth() + 1}/${d.getDate()}`;
  })();
  return (
    <div onClick={()=>{ if (!submitting) onClose(); }} className="cb-lock-scroll"
      style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={ev=>ev.stopPropagation()}
        style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:420, width:"100%", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 4px" }}>{dayLabel} の記録</p>
        <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 14px" }}>
          その日に起きたことを記録します。相手にお知らせが届き、記録として残ります。
          何もなかった日は、記録しなくて大丈夫です。作業全体の評価は、最終の作業日にお願いします。
        </p>
        <div style={{ display:"grid", gap:8, marginBottom:14 }}>
          {kinds.map(k => {
            const on = kind === k.v;
            return (
              <div key={k.v}>
                <button onClick={()=>{ setKind(k.v); setDetail(""); }} className="f-sans"
                  style={{ display:"block", width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, cursor:"pointer", boxSizing:"border-box",
                    border: on ? "2px solid #E24B4A" : "1px solid #EBEBEB", background: on ? "#FFF5F5" : "#fff" }}>
                  <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222" }}>{k.l}</span>
                  <span style={{ display:"block", fontSize:12, color:"#717171", lineHeight:1.6, marginTop:3 }}>{k.d}</span>
                </button>
                {/* 内訳（選択式）：何が違ったか・どう終わったかを構造化して残す（detail列）。
                    自由記述に埋めない＝あとで「求人票と現実の一致」を集計できるデータになる */}
                {on && k.sub && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, margin:"8px 2px 0" }}>
                    {k.sub.map(sc => {
                      const son = detail === sc.v;
                      return (
                        <button key={sc.v} onClick={()=>setDetail(sc.v)} className="f-sans"
                          style={{ padding:"8px 12px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer",
                            border: son ? "2px solid #E24B4A" : "1px solid #DDD",
                            background: son ? "#E24B4A" : "#fff", color: son ? "#fff" : "#555" }}>{sc.l}</button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3}
          placeholder="状況を一言（任意・相手に届きます）"
          className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} disabled={submitting} className="f-sans"
            style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
          <button onClick={submit} disabled={submitting || !kind || (needsDetail && !detail)} className="f-sans"
            style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: (submitting || !kind || (needsDetail && !detail)) ? 0.5 : 1 }}>
            {submitting ? "送信中..." : "記録する"}
          </button>
        </div>
      </div>
    </div>
  );
}
