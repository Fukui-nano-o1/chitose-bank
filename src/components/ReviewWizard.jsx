// 仕事の全体的な評価の入力の器（2026-08-19新設）。両方向で同じ形にするための共有部品。
// ★たきと指示「もっと入力項目を増やせ。多いようなら入力したら強制横スワイプ。戻るを設置しろ。
//   送信するタップで最終確認」→「同じように農家→働き手の評価を設計しろ」＝
//   働き手→農園（WorkerReviewSheet）と農家→働き手（FarmerDashboard の完了・評価）が
//   同じ送り方・同じ最終確認になるよう、ページ送りの機構はこの1部品だけに置く。
//   設問と保存は呼び出し側が持つ（向きで中身が違うため）。
//
// 送りはネイティブ横スクロール＋scroll-snap（WorkerProfileEdit のはたらき方の希望と同じ作法）
//   ＝自前のtransform管理を持たず、指でも戻れる。
// ★全ページの高さを固定する：問いごとに高さが変わると、次へ進んだ瞬間にボタンが移動して
//   指が黒幕に落ちる（2026-08-16の誤タップの型）。
// ★入力中は snap と横スクロールを止める：iOSはscroll-snapコンテナ内のtextareaにフォーカスすると
//   キーボード表示のレイアウト変化で再スナップが走り、打鍵が奪われる（2026-08-19の既知の対策）。
// ★モジュールレベル定義を維持すること：親の中で定義すると再レンダーごとに再マウントされ、
//   textarea のフォーカス・入力中の下書きが消える（LandingFlowのフォーカス消失バグと同族）。
import { useState, useEffect, useRef } from "react";

const isTextInput = (el) => !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");

// questions＝[{ k, label, hint }]（k は reviews の列名と1対1）。answers＝{ [k]: true|false }。
// lastPage＝設問のあとに置く最終入力ページ（自由記述など）。confirmExtra＝最終確認に足す表示。
// footer＝入力ページの下にいつも出す小さな導線（例：欠勤として記録する）。
// resetKey＝これが変わったら1ページ目に戻す（別の相手の評価に前の位置が残らないように）。
export function ReviewWizard({
  title, questions, answers, onAnswer,
  lastPageTitle, lastPageHint, lastPage, confirmTitle, confirmNote, confirmExtra,
  footer, submitting, onSubmit, onClose, resetKey, pageHeight = 250, accent = "#00A86B",
}) {
  const total = questions.length + 1;   // ＋最終入力ページ
  const [idx, setIdx] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef(null);
  useEffect(() => {
    setIdx(0); setConfirming(false); setTyping(false);
    const el = scrollRef.current; if (el) el.scrollLeft = 0;
  }, [resetKey]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setIdx(Math.max(0, Math.min(total - 1, Math.round(el.scrollLeft / el.clientWidth))));
  };
  const go = (i) => {
    const n = Math.max(0, Math.min(total - 1, i));
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
    else setIdx(n);
  };
  // 選んだら次の問いへ自動で送る（強制横スワイプ）
  const pick = (k, v, i) => { onAnswer(k, v); if (i < total - 1) setTimeout(() => go(i + 1), 220); };
  const unanswered = questions.filter(q => answers[q.k] === undefined || answers[q.k] === null);
  const ready = unanswered.length === 0;

  const shell = (children) => (
    <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {children}
      </div>
    </div>
  );

  // ═══ 送信するタップ後の最終確認 ═══
  // 後戻りできない操作の直前に、答えた内容をそのまま並べて見せる。直したい時は「戻って直す」で入力へ戻る
  if (confirming) return shell(
    <>
      <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 4px" }}>{confirmTitle || "これで送信します"}</p>
      {confirmNote && <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 14px" }}>{confirmNote}</p>}
      <div style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"4px 14px", marginBottom:14 }}>
        {questions.map(q => (
          <div key={q.k} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"9px 0", borderBottom:"1px solid #F4F4F4" }}>
            <span className="f-sans" style={{ fontSize:13, color:"#222" }}>{q.label}</span>
            <span className="f-sans" style={{ fontSize:13, fontWeight:800, flexShrink:0, color: answers[q.k] ? accent : "#B0B0B0" }}>
              {answers[q.k] ? "はい" : "いいえ"}
            </span>
          </div>
        ))}
        {confirmExtra}
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={()=>{ if (!submitting) setConfirming(false); }} disabled={submitting} className="f-sans"
          style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>← 戻って直す</button>
        <button onClick={onSubmit} disabled={submitting} className="f-sans"
          style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: submitting ? 0.5 : 1 }}>
          {submitting ? "送信中..." : "送信する"}
        </button>
      </div>
    </>
  );

  return shell(
    <>
      <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 2px" }}>{title}</p>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 12px" }}>{Math.min(idx + 1, total)} / {total}</p>
      <div ref={scrollRef} onScroll={onScroll}
        onFocusCapture={e=>{ if (isTextInput(e.target)) setTyping(true); }}
        onBlurCapture={e=>{ if (isTextInput(e.target)) setTyping(false); }}
        style={{ display:"flex", overflowX: typing ? "hidden" : "auto", scrollSnapType: typing ? "none" : "x mandatory",
                 WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain", scrollbarWidth:"none", margin:"0 -2px" }}>
        {questions.map((q, i) => (
          <div key={q.k} style={{ flex:"0 0 100%", boxSizing:"border-box", scrollSnapAlign:"start", padding:"0 2px", height:pageHeight }}>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"8px 0 6px" }}>{q.label}</p>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 16px" }}>{q.hint}</p>
            <div style={{ display:"flex", gap:8 }}>
              {[["はい", true], ["いいえ", false]].map(([l, v]) => {
                const on = answers[q.k] === v;
                return (
                  <button key={l} type="button" onClick={()=>pick(q.k, v, i)} className="f-sans" style={{
                    flex:1, padding:"14px 9px", borderRadius:12, fontSize:15, cursor:"pointer", fontWeight:700, border:"2px solid",
                    borderColor: on ? accent : "#EBEBEB",
                    background: on ? accent + "14" : "#fff", color: on ? accent : "#222",
                  }}>{l}</button>
                );
              })}
            </div>
          </div>
        ))}
        {/* 最後のページ＝自由記述など。ここで「送信する」→最終確認 */}
        <div style={{ flex:"0 0 100%", boxSizing:"border-box", scrollSnapAlign:"start", padding:"0 2px", height:pageHeight, overflowY:"auto" }}>
          {lastPageTitle && <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"8px 0 6px" }}>{lastPageTitle}</p>}
          {lastPageHint && <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 10px" }}>{lastPageHint}</p>}
          {lastPage}
        </div>
      </div>
      {/* 進み具合（タップでその問いへ）。答えた問いは薄い色で埋まる */}
      <div style={{ display:"flex", justifyContent:"center", gap:6, margin:"12px 0 14px" }}>
        {Array.from({ length: total }).map((_, i) => {
          const q = questions[i];
          const answered = !!q && answers[q.k] !== undefined && answers[q.k] !== null;
          return (
            <button key={i} type="button" onClick={()=>go(i)} aria-label={(i + 1) + "ページ目へ"}
              style={{ width:8, height:8, borderRadius:"50%", border:"none", padding:0, cursor:"pointer",
                       background: i === idx ? accent : answered ? accent + "66" : "#DDD" }} />
          );
        })}
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"space-between", alignItems:"center" }}>
        {/* 戻る（たきと指示「戻るを設置しろ」）。1ページ目の戻るは閉じる＝行き止まりを作らない */}
        <button onClick={()=>{ if (submitting) return; if (idx === 0) onClose(); else go(idx - 1); }} disabled={submitting} className="f-sans"
          style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>
          {idx === 0 ? "キャンセル" : "← 戻る"}
        </button>
        {idx === total - 1 ? (
          /* ★押せないボタンにしない（2026-08-03の原則）：未回答があるなら、その問いへ連れて行く */
          <button onClick={()=>{ if (ready) setConfirming(true); else go(questions.findIndex(q => answers[q.k] === undefined || answers[q.k] === null)); }}
            className="f-sans"
            style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: ready ? 1 : 0.5 }}>
            送信する
          </button>
        ) : (
          <button onClick={()=>go(idx + 1)} className="f-sans"
            style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#fff", color:accent, border:"1px solid " + accent, borderRadius:10, cursor:"pointer" }}>次へ →</button>
        )}
      </div>
      {idx === total - 1 && !ready && (
        <p className="f-sans" style={{ fontSize:11, color:"#B54A0E", textAlign:"right", margin:"8px 0 0" }}>
          あと{unanswered.length}問（「送信する」でその問いに戻ります）
        </p>
      )}
      {footer}
    </>
  );
}
