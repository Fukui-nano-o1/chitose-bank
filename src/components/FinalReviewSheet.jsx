// 最終日の評価の器（2026-08-20たきと裁定で全面再設計）。両方向で同じ器・違う設問。
// 三層の設計：日次＝事故ログ（DayReportSheet・attendance_events）／最終日＝この画面で評価／
//   プロフィール＝その両方から自動生成（worker_work_record・reviews_public_badges）。
// この画面の構造：
//   ①客観データの自動表示＝日次に蓄積された事実（遅刻・欠勤・合流トラブル…）を件数で見せる。
//     本人に再入力させない。0件でも見せる（「問題なし」も情報）。
//   ②設問は3問程度・すべて選択式（3択）。公開自由記述は置かない（2026-08-20たきと裁定
//     「自由記述は誹謗中傷・感情的評価・個人情報・削除依頼の泥沼を召喚する。MVPでは触らない」）。
//   ③農家側だけ特記事項のタグ選択（肯定タグは公開集計・否定タグは記録のみ＝規約第8条2）。
//   ④送信するタップで最終確認（答えを並べて見せてから保存・後戻りできない操作の直前の一拍）。
// 対称設計にしすぎない（たきと裁定）＝設問の中身は呼び出し側が持つ：
//   農家→働き手＝FarmerDashboard（完了したか・また働きたいか・特記タグ）
//   働き手→農家＝WorkerReviewSheet（求人と一致していたか・報酬は約束どおりか・また働きたいか）
// ★モジュールレベル定義を維持すること：親の中で定義すると再レンダーごとに再マウントされる
//   （フォーカス消失バグの同族・CLAUDE.md）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { DAY_FACT_LABELS } from "../lib/utils";
import { Dots } from "./ui";

// この仕事の記録（客観データ）：attendance_events を当事者RLSで引いて件数に畳む。
// 失敗したら黙って出さない（評価の道は塞がない＝フェイルオープン規則の表示版）
function DayFacts({ applicationId, dayCount }) {
  const [rows, setRows] = useState(null); // null=読み込み中 / [] 以上=取得済み / false=失敗
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      try {
        const { data, error } = await supabase.from("attendance_events")
          .select("kind,detail,work_date").eq("application_id", applicationId);
        if (!cancelled) setRows(error ? false : (data || []));
      } catch { if (!cancelled) setRows(false); }
    })();
    return () => { cancelled = true; };
  }, [applicationId]);
  if (rows === null) return <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 14px" }}>記録を確認しています<Dots /></p>;
  if (rows === false) return null;
  const counts = {};
  rows.forEach(r => { if (r.kind !== "dispute_no_show") counts[r.kind] = (counts[r.kind] || 0) + 1; });
  const shown = DAY_FACT_LABELS.filter(f => ["late","absent_notice","no_show_report"].includes(f.k) || counts[f.k] > 0);
  return (
    <div style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#717171", margin:"0 0 8px" }}>
        この仕事の記録{dayCount ? `（${dayCount}日間）` : ""}
      </p>
      <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 14px" }}>
        {shown.map(f => {
          const n = counts[f.k] || 0;
          return (
            <span key={f.k} className="f-sans" style={{ fontSize:13, color: n > 0 ? "#E24B4A" : "#555", fontWeight: n > 0 ? 700 : 400 }}>
              {f.l} {n}回
            </span>
          );
        })}
      </div>
      {Object.keys(counts).length === 0 && (
        <p className="f-sans" style={{ fontSize:12, color:"#00A86B", fontWeight:700, margin:"8px 0 0" }}>記録された問題はありません</p>
      )}
    </div>
  );
}

// questions＝[{ k, label, choices:[{v,l,negative?}] }]（kは reviews の列名と1対1・選択式のみ）。
// answers＝{ [k]: v }（親が持つ＝controlled。親は answers を見て favorite などの追加UIを出せる）。
// tagDef＝{ label, hint, options:[{v,l,negative?}] }（農家の特記事項。省略可）。tags＝選択中の配列。
// extra＝設問の下に足すUI（❤️お気に入り登録など）。footer＝一番下の導線（欠勤として記録する）。
export function FinalReviewSheet({
  app, title, intro, dayCount,
  questions, answers, onAnswer,
  tagDef, tags = [], onToggleTag,
  extra, confirmNote, confirmExtra, footer,
  submitting, onSubmit, onClose, accent = "#00A86B",
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setConfirming(false); }, [app?.id]);
  if (!app) return null;
  const unanswered = questions.filter(q => !answers[q.k]);
  const ready = unanswered.length === 0;
  const choiceLabel = (q) => (q.choices.find(c => c.v === answers[q.k]) || {}).l || "（未回答）";

  const shell = (children) => (
    <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:420, width:"100%", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {children}
      </div>
    </div>
  );

  // ═══ 送信するタップ後の最終確認 ═══
  if (confirming) return shell(
    <>
      <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 6px" }}>これで送信します</p>
      {confirmNote && <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, margin:"0 0 14px" }}>{confirmNote}</p>}
      {/* ★問いと答えは【上下】に置く（2026-08-23たきと指示「見やすくして」）：
          横並び（flex）だと、問いが長い時に答えの幅が min-content まで押し潰され、
          「どちらともいえない」が1文字ずつの縦書きになっていた。下のタグ行と同じ
          「小さい灰色のラベル＋大きい答え」の形に全部そろえる＝行の形が枝分かれしない */}
      <div style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"4px 14px", marginBottom:14 }}>
        {questions.map(q => (
          <div key={q.k} style={{ padding:"11px 0", borderBottom:"1px solid #F4F4F4" }}>
            <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 3px", lineHeight:1.5 }}>{q.label}</p>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:accent, margin:0, lineHeight:1.5 }}>{choiceLabel(q)}</p>
          </div>
        ))}
        {tagDef && (
          <div style={{ padding:"11px 0", borderBottom: confirmExtra ? "1px solid #F4F4F4" : "none" }}>
            <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 3px", lineHeight:1.5 }}>{tagDef.label}</p>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color: tags.length ? "#222" : "#B0B0B0", margin:0, lineHeight:1.6 }}>
              {tags.length ? tagDef.options.filter(o => tags.includes(o.v)).map(o => o.l).join("・") : "（なし）"}
            </p>
          </div>
        )}
        {confirmExtra}
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={()=>{ if (!submitting) setConfirming(false); }} disabled={submitting} className="f-sans"
          style={{ padding:"11px 20px", fontSize:14, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>← 戻って直す</button>
        <button onClick={onSubmit} disabled={submitting} className="f-sans"
          style={{ padding:"11px 20px", fontSize:14, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: submitting ? 0.5 : 1 }}>
          {submitting ? "送信中..." : "送信する"}
        </button>
      </div>
    </>
  );

  return shell(
    <>
      <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 6px" }}>{title}</p>
      {intro && <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, margin:"0 0 14px" }}>{intro}</p>}
      {/* ①客観データの自動表示（本人に再入力させない） */}
      <DayFacts applicationId={app.id} dayCount={dayCount} />
      {/* ②設問（3問程度・3択・縦に選択肢を並べる） */}
      {questions.map(q => (
        <div key={q.k} style={{ marginBottom:16 }}>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:"0 0 8px" }}>{q.label}</p>
          <div style={{ display:"grid", gap:6 }}>
            {q.choices.map(c => {
              const on = answers[q.k] === c.v;
              return (
                <button key={c.v} type="button" onClick={()=>onAnswer(q.k, c.v)} className="f-sans"
                  style={{ textAlign:"left", padding:"11px 14px", borderRadius:10, fontSize:14, fontWeight:600, cursor:"pointer",
                    border: on ? `2px solid ${accent}` : "1px solid #EBEBEB",
                    background: on ? accent + "14" : "#fff", color: on ? accent : "#222" }}>{c.l}</button>
              );
            })}
          </div>
        </div>
      ))}
      {/* ③特記事項のタグ（農家のみ・複数選択・任意）。否定タグも選べるが公開はされない（規約第8条2） */}
      {tagDef && (
        <div style={{ marginBottom:16 }}>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:"0 0 2px" }}>{tagDef.label}</p>
          {tagDef.hint && <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"0 0 8px" }}>{tagDef.hint}</p>}
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {tagDef.options.map(o => {
              const on = tags.includes(o.v);
              const c = o.negative ? "#B54A0E" : accent;
              return (
                <button key={o.v} type="button" onClick={()=>onToggleTag(o.v)} className="f-sans"
                  style={{ padding:"8px 12px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer",
                    border: on ? `2px solid ${c}` : "1px solid #DDD",
                    background: on ? c : "#fff", color: on ? "#fff" : "#555" }}>{o.l}</button>
              );
            })}
          </div>
        </div>
      )}
      {extra}
      <div style={{ display:"flex", gap:8, justifyContent:"space-between", alignItems:"center", marginTop:4 }}>
        <button onClick={()=>{ if (!submitting) onClose(); }} disabled={submitting} className="f-sans"
          style={{ padding:"11px 20px", fontSize:14, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
        {/* ★押せないボタンにしない（2026-08-03の原則）：未回答があれば理由を添えて薄くする */}
        <button onClick={()=>{ if (ready) setConfirming(true); }} className="f-sans"
          style={{ padding:"11px 20px", fontSize:14, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: ready ? 1 : 0.5 }}>
          送信する
        </button>
      </div>
      {!ready && (
        <p className="f-sans" style={{ fontSize:11, color:"#B54A0E", textAlign:"right", margin:"8px 0 0" }}>
          あと{unanswered.length}問、選んでください
        </p>
      )}
      {footer}
    </>
  );
}
