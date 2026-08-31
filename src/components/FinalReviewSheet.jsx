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
//
// 見た目＝Airbnbのレビューフローを1:1で写した（2026-08-31たきと指示「見た目をAirbnbをパクれ」。
// ★コード・画像・ブランド色は写せない＝写すのは見た目の言語）：
//   ・左上の✕/←は丸枠なしの素のアイコン／大きな左寄せの見出し
//   ・選択肢＝白いカード（灰色の枠・角丸12）。選んだら【黒い2重の枠＋うすい灰の下地】
//     （Airbnbのフォームの選択の型。boxShadow inset で枠を太らせる＝1px→2pxのガタつきを作らない）
//   ・タグ＝丸いチップ。選んだら黒地に白（否定タグだけ意味の色 #B54A0E を維持＝公開されない印）
//   ・下部バー＝細い進捗バー（答えた数／設問数・黒）＋右寄せの黒いボタン。未回答は灰色のボタン
//     ＋理由の一言（押せないボタンにしない・2026-08-03の原則は不変）
//   ・役割色（accent）はこの画面の見た目からは外した＝Airbnbの黒で統一（propは互換のため受けるだけ）
// ★モジュールレベル定義を維持すること：親の中で定義すると再レンダーごとに再マウントされる
//   （フォーカス消失バグの同族・CLAUDE.md）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { DAY_FACT_LABELS } from "../lib/utils";
import { NavIcon } from "./NavIcons";
import { Dots } from "./ui";

// この仕事の記録（客観データ）：attendance_events を当事者RLSで引いて件数に畳む。
// 失敗したら黙って出さない（評価の道は塞がない＝フェイルオープン規則の表示版）。
// 見た目＝Airbnbの情報カード（灰色の塗りでなく、細い枠の白いカード）
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
  if (rows === null) return <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 20px" }}>記録を確認しています<Dots /></p>;
  if (rows === false) return null;
  const counts = {};
  rows.forEach(r => { if (r.kind !== "dispute_no_show") counts[r.kind] = (counts[r.kind] || 0) + 1; });
  const shown = DAY_FACT_LABELS.filter(f => ["late","absent_notice","no_show_report"].includes(f.k) || counts[f.k] > 0);
  return (
    <div style={{ border:"1px solid #DDDDDD", borderRadius:12, padding:"14px 16px", marginBottom:24 }}>
      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"0 0 8px" }}>
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

// Airbnbの下部ボタン：主役＝黒・角丸8・右寄せ。押せない状態は灰色（＋理由の一言を左に添える）
const ctaStyle = (enabled, submitting) => ({
  padding:"14px 26px", fontSize:15, fontWeight:700, border:"none", borderRadius:8, cursor:"pointer",
  flexShrink:0, background: enabled ? "#222" : "#DDDDDD", color: enabled ? "#fff" : "#717171",
  opacity: submitting ? 0.5 : 1,
});

// questions＝[{ k, label, choices:[{v,l,negative?}] }]（kは reviews の列名と1対1・選択式のみ）。
// answers＝{ [k]: v }（親が持つ＝controlled。親は answers を見て favorite などの追加UIを出せる）。
// tagDef＝{ label, hint, options:[{v,l,negative?}] }（農家の特記事項。省略可）。tags＝選択中の配列。
// extra＝設問の下に足すUI（❤️お気に入り登録など）。footer＝一番下の導線（欠勤として記録する）。
// accent＝互換のため受けるだけ（見た目はAirbnbの黒に統一・2026-08-31）
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

  // ★全画面テイクオーバー（2026-08-31たきと指示「Airbnbはどうしてる？パクれ」）：
  //   Airbnbのレビューは小さなボックスでもURLが変わるページ遷移でもなく、アプリの上に
  //   白い全画面が乗る形（左上に✕/←・中身は縦スクロール・下部に固定の大きな送信ボタン）。
  //   その振る舞いだけを写した（コードは非公開なので流用していない）。URLは変えない
  //   ＝「ページ遷移するな」（2026-08-28採用の指示）と同じ作法。
  //   中身のスクロールと操作ボタンを分離＝長い設問でも送信ボタンが常に見える。
  // 左上の✕/←＝Airbnbと同じ素のアイコン（丸枠なし・タップ領域だけ40px確保）
  const headerBtn = (onClick, label, inner) => (
    <button onClick={onClick} disabled={submitting} aria-label={label} className="f-sans"
      style={{ width:40, height:40, border:"none", background:"none", color:"#222", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, padding:0, flexShrink:0, marginLeft:-10 }}>{inner}</button>
  );
  const shell = (head, children, bar) => (
    <div onClick={e=>e.stopPropagation()} className="cb-lock-scroll"
      style={{ position:"fixed", inset:0, zIndex:9500, background:"#fff", display:"flex", flexDirection:"column" }}>
      <div style={{ flexShrink:0, padding:"calc(12px + env(safe-area-inset-top, 0px)) 24px 6px" }}>{head}</div>
      <div style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"6px 24px 24px" }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>{children}</div>
      </div>
      <div style={{ flexShrink:0, borderTop:"1px solid #EBEBEB", background:"#fff", position:"relative" }}>
        {bar}
      </div>
    </div>
  );
  // 下部バーの中身の余白（進捗バーを上端いっぱいに敷くため、余白はこちらで持つ）
  const barInner = { maxWidth:560, margin:"0 auto", padding:"12px 24px calc(14px + env(safe-area-inset-bottom, 0px))" };

  // ═══ 送信するタップ後の最終確認（左上の←で設問に戻る） ═══
  if (confirming) return shell(
    headerBtn(()=>{ if (!submitting) setConfirming(false); }, "もどって直す", "←"),
    <>
      <p className="f-sans" style={{ fontSize:26, fontWeight:800, color:"#222", lineHeight:1.3, margin:"6px 0 8px" }}>これで送信します</p>
      {confirmNote && <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, margin:"0 0 18px" }}>{confirmNote}</p>}
      {/* ★問いと答えは【上下】に置く（2026-08-23たきと指示「見やすくして」）：
          横並び（flex）だと、問いが長い時に答えの幅が min-content まで押し潰され、
          「どちらともいえない」が1文字ずつの縦書きになっていた。下のタグ行と同じ
          「小さい灰色のラベル＋大きい答え」の形に全部そろえる＝行の形が枝分かれしない */}
      <div style={{ border:"1px solid #DDDDDD", borderRadius:12, padding:"4px 16px", marginBottom:14 }}>
        {questions.map(q => (
          <div key={q.k} style={{ padding:"12px 0", borderBottom:"1px solid #F4F4F4" }}>
            <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 3px", lineHeight:1.5 }}>{q.label}</p>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:0, lineHeight:1.5 }}>{choiceLabel(q)}</p>
          </div>
        ))}
        {tagDef && (
          <div style={{ padding:"12px 0", borderBottom: confirmExtra ? "1px solid #F4F4F4" : "none" }}>
            <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 3px", lineHeight:1.5 }}>{tagDef.label}</p>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color: tags.length ? "#222" : "#B0B0B0", margin:0, lineHeight:1.6 }}>
              {tags.length ? tagDef.options.filter(o => tags.includes(o.v)).map(o => o.l).join("・") : "（なし）"}
            </p>
          </div>
        )}
        {confirmExtra}
      </div>
    </>,
    /* 下部の固定バー（Airbnbのフローの足：左＝下線の戻る／右＝黒いボタン） */
    <div style={{ ...barInner, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
      <button onClick={()=>{ if (!submitting) setConfirming(false); }} disabled={submitting} className="f-sans"
        style={{ background:"none", border:"none", padding:"10px 0", fontSize:15, fontWeight:700, color:"#222", textDecoration:"underline", cursor:"pointer" }}>
        もどって直す
      </button>
      <button onClick={onSubmit} disabled={submitting} className="f-sans" style={ctaStyle(true, submitting)}>
        {submitting ? <>送信中<Dots /></> : "送信する"}
      </button>
    </div>
  );

  const answeredN = questions.length - unanswered.length;
  return shell(
    headerBtn(()=>{ if (!submitting) onClose(); }, "とじる", <NavIcon name="close" size={18} />),
    <>
      <p className="f-sans" style={{ fontSize:26, fontWeight:800, color:"#222", lineHeight:1.3, margin:"6px 0 8px" }}>{title}</p>
      {intro && <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, margin:"0 0 20px" }}>{intro}</p>}
      {/* ①客観データの自動表示（本人に再入力させない） */}
      <DayFacts applicationId={app.id} dayCount={dayCount} />
      {/* ②設問（3問程度・3択・縦に選択肢を並べる）。選択の型＝Airbnbのフォーム：
          白いカード＋灰色の枠→選んだら黒い2重の枠＋うすい灰の下地。太い枠は boxShadow inset で
          描く＝枠の太さで高さが変わらない（タップ対象を動かさない・2026-08-16の誤タップの型を作らない） */}
      {questions.map(q => (
        <div key={q.k} style={{ marginBottom:28 }}>
          <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{q.label}</p>
          <div style={{ display:"grid", gap:10 }}>
            {q.choices.map(c => {
              const on = answers[q.k] === c.v;
              return (
                <button key={c.v} type="button" onClick={()=>onAnswer(q.k, c.v)} className="f-sans"
                  style={{ textAlign:"left", padding:"16px", borderRadius:12, fontSize:15, cursor:"pointer",
                    fontWeight: on ? 700 : 500, color:"#222",
                    border: on ? "1px solid #222" : "1px solid #B0B0B0",
                    boxShadow: on ? "inset 0 0 0 1px #222" : "none",
                    background: on ? "#F7F7F7" : "#fff" }}>{c.l}</button>
              );
            })}
          </div>
        </div>
      ))}
      {/* ③特記事項のタグ（農家のみ・複数選択・任意）＝Airbnbのレビューのチップ：丸いチップ・
          選んだら黒地に白。否定タグだけ選択時 #B54A0E ＝「公開されない記録」の意味の色は消さない */}
      {tagDef && (
        <div style={{ marginBottom:28 }}>
          <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 2px" }}>{tagDef.label}</p>
          {tagDef.hint && <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"2px 0 12px" }}>{tagDef.hint}</p>}
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {tagDef.options.map(o => {
              const on = tags.includes(o.v);
              const c = o.negative ? "#B54A0E" : "#222";
              return (
                <button key={o.v} type="button" onClick={()=>onToggleTag(o.v)} className="f-sans"
                  style={{ padding:"10px 16px", borderRadius:24, fontSize:14, fontWeight:600, cursor:"pointer",
                    border: on ? `1px solid ${c}` : "1px solid #B0B0B0",
                    background: on ? c : "#fff", color: on ? "#fff" : "#222" }}>{o.l}</button>
              );
            })}
          </div>
        </div>
      )}
      {extra}
      {footer}
    </>,
    /* 下部の固定バー＝Airbnbのフローの足：上端に細い進捗バー（答えた数／設問数・黒）、
       右寄せの黒いボタン。とじるは左上の✕が担うのでキャンセルは置かない。
       ★押せないボタンにしない（2026-08-03の原則）：未回答があれば理由を左に添えて灰色にする */
    <>
      <div aria-hidden="true" style={{ position:"absolute", top:-1, left:0, right:0, height:4, background:"#EBEBEB" }}>
        <div style={{ height:"100%", width: `${questions.length ? Math.round(answeredN / questions.length * 100) : 0}%`, background:"#222", transition:"width .3s ease" }} />
      </div>
      <div style={{ ...barInner, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <p className="f-sans" style={{ fontSize:12, color: ready ? "#717171" : "#B54A0E", margin:0, lineHeight:1.5 }}>
          {ready ? "" : `あと${unanswered.length}問、選んでください`}
        </p>
        <button onClick={()=>{ if (ready) setConfirming(true); }} className="f-sans" style={ctaStyle(ready, false)}>
          送信する
        </button>
      </div>
    </>
  );
}
