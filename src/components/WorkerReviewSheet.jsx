// 仕事の全体的な評価（働き手→農園）の入力シート（2026-08-19新設・同日に1問1ページへ）。
// ★この形は2箇所から開く：①応募状況ページ（#/profile/worker/approved）②今日ページの「仕事の評価」。
//   同じ入力が枝分かれしないよう、フォームと保存はこの1部品に集約する
//   （項目を足す時・文言を変える時はここだけを直す）。
// ★2026-08-19たきと指示「完了日は仕事の全体的な評価をする。もっと入力項目を増やせ。
//   多いようなら入力したら強制横スワイプ。戻るを設置しろ。送信するタップで最終確認」＝
//   6問を1問1ページにし、選ぶと次の問いへ自動で送る。最後に自由記述→送信するで最終確認。
//   送りはネイティブ横スクロール＋scroll-snap（WorkerProfileEdit のはたらき方の希望と同じ作法）
//   ＝自前のtransform管理を持たず、指でも戻れる。
// ★ページの高さは全ページ共通で固定する：問いごとに高さが変わると、次へ進んだ瞬間にボタンが
//   移動して指が黒幕に落ちる（2026-08-16の誤タップの型）。
// 保存するのは reviews の1行だけ（打刻の署名は撃たない・2026-08-18「打刻の全面削除」）。
// DBの壁：trg_reviews_party_consistency（当事者と向きの一致）＋trg_reviews_phase_gate
//   （worker_to_farmer は working 以上）が最後の担保so、画面はその手前の案内に徹する。
// ★モジュールレベル定義を維持すること：親の中で定義すると再レンダーごとに再マウントされ、
//   textarea のフォーカス・入力中の下書きが消える（LandingFlowのフォーカス消失バグと同族）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fbSuccess, fbError } from "../lib/feedback";

// 全体の評価の設問（順＝表示順）。k は reviews の列名と1対1。
// ★列を足したら DBの reviews_public_badges の列挙と components/ReceivedReviews.jsx の
//   BADGE_DEFS.worker_to_farmer も同時に直すこと（直さないと入力できるのに誰にも表示されない）。
// ★肯定（はい）だけが相手に表示される（利用規約 第8条2）。いいえは公開されないが記録には残る。
// ★entrust / followed_instructions / completed_work は農家→働き手の評価語so、この向きでは使わない。
const REVIEW_QUESTIONS = [
  { k:"want_again",         label:"また働きたい",             hint:"またこの農園で働きたいと思いましたか" },
  { k:"as_described",       label:"説明のとおりだった",       hint:"作業の内容・時間・場所が求人の説明どおりでしたか" },
  { k:"safety_care",        label:"安全に配慮されていた",     hint:"危険な場所や作業の説明・備えがありましたか" },
  { k:"on_time",            label:"時間どおりだった",         hint:"始まりと終わりが予定どおりでしたか" },
  { k:"instructions_clear", label:"教え方が分かりやすかった", hint:"何をどうすればよいか、分かるように教えてもらえましたか" },
  { k:"paid_as_posted",     label:"賃金が求人のとおりだった", hint:"金額・支払い方（当日の現金手渡し）が求人のとおりでしたか" },
];
const TOTAL_PAGES = REVIEW_QUESTIONS.length + 1;   // ＋自由記述の1ページ
const PAGE_H = 250;                                // 全ページ共通の高さ（ボタンを動かさない）

// app＝{ id, farmer_id }（応募のID と 相手＝農家のauth_id）。meId＝自分のauth_id。
// onDone(applicationId)＝保存できた時に親へ知らせる（一覧から消す・祝祭を出すのは親の仕事）。
export function WorkerReviewSheet({ app, meId, onDone, onClose }) {
  const [answers, setAnswers] = useState({});          // { [k]: true|false }
  const [publicComment, setPublicComment] = useState("");
  const [privateMemo, setPrivateMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idx, setIdx] = useState(0);                   // いま見えているページ
  const [confirming, setConfirming] = useState(false); // 送信するタップ後の最終確認
  const [typing, setTyping] = useState(false);         // 自由記述に入力中（下記★）
  const scrollRef = useRef(null);
  // 開き直したら前回の入力を持ち越さない（別の応募の評価に前の答えが残らないように）
  useEffect(() => {
    setAnswers({}); setPublicComment(""); setPrivateMemo("");
    setIdx(0); setConfirming(false); setTyping(false);
    const el = scrollRef.current; if (el) el.scrollLeft = 0;
  }, [app?.id]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setIdx(Math.max(0, Math.min(TOTAL_PAGES - 1, Math.round(el.scrollLeft / el.clientWidth))));
  };
  const go = (i) => {
    const n = Math.max(0, Math.min(TOTAL_PAGES - 1, i));
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
    else setIdx(n);
  };
  // 選んだら次の問いへ自動で送る（強制横スワイプ）。最後の問いは自由記述のページへ
  const pick = (k, v, i) => {
    setAnswers(prev => ({ ...prev, [k]: v }));
    if (i < TOTAL_PAGES - 1) setTimeout(() => go(i + 1), 220);
  };
  const unanswered = REVIEW_QUESTIONS.filter(q => answers[q.k] === undefined);
  const ready = unanswered.length === 0;
  const submit = async () => {
    if (!app || !ready || submitting) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("reviews").insert({
        application_id: app.id, reviewer_id: meId, reviewee_id: app.farmer_id,
        direction: "worker_to_farmer",
        ...Object.fromEntries(REVIEW_QUESTIONS.map(q => [q.k, answers[q.k]])),
        public_comment: publicComment.trim() || null, private_memo: privateMemo.trim() || null,
      });
      if (error) { fbError(); alert("評価の保存に失敗しました：" + error.message); setSubmitting(false); return; }
      fbSuccess();
      onDone(app.id);
    } catch { alert("処理に失敗しました。"); }
    setSubmitting(false);
  };
  if (!app) return null;

  const shell = (children) => (
    <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {children}
      </div>
    </div>
  );

  // ═══ 送信するタップ後の最終確認（2026-08-19たきと指示）═══
  // 後戻りできない操作の直前に、答えた内容をそのまま並べて見せる。直したい時は「戻って直す」で入力へ戻る
  if (confirming) return shell(
    <>
      <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 4px" }}>これで送信します</p>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 14px" }}>
        送信すると、この仕事は終わりになります。あとから直すことはできません。
        「はい」と答えた項目だけが農園に表示されます。
      </p>
      <div style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"4px 14px", marginBottom:14 }}>
        {REVIEW_QUESTIONS.map(q => (
          <div key={q.k} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"9px 0", borderBottom:"1px solid #F4F4F4" }}>
            <span className="f-sans" style={{ fontSize:13, color:"#222" }}>{q.label}</span>
            <span className="f-sans" style={{ fontSize:13, fontWeight:800, flexShrink:0, color: answers[q.k] ? "#00A86B" : "#B0B0B0" }}>
              {answers[q.k] ? "はい" : "いいえ"}
            </span>
          </div>
        ))}
        <div style={{ padding:"9px 0" }}>
          <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"0 0 2px" }}>農園について一言（公開）</p>
          <p className="f-sans" style={{ fontSize:13, color: publicComment.trim() ? "#222" : "#B0B0B0", margin:0, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{publicComment.trim() || "（なし）"}</p>
        </div>
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={()=>{ if (!submitting) setConfirming(false); }} disabled={submitting} className="f-sans"
          style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>← 戻って直す</button>
        <button onClick={submit} disabled={submitting} className="f-sans"
          style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: submitting ? 0.5 : 1 }}>
          {submitting ? "送信中..." : "送信する"}
        </button>
      </div>
    </>
  );

  return shell(
    <>
      <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 2px" }}>仕事の評価</p>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 12px" }}>{Math.min(idx + 1, TOTAL_PAGES)} / {TOTAL_PAGES}</p>
      {/* ★入力中は snap と横スクロールを止める：iOSはscroll-snapコンテナ内のtextareaにフォーカスすると
          キーボード表示のレイアウト変化で再スナップが走り、打鍵が奪われる（2026-08-19の既知の対策） */}
      <div ref={scrollRef} onScroll={onScroll}
        style={{ display:"flex", overflowX: typing ? "hidden" : "auto", scrollSnapType: typing ? "none" : "x mandatory",
                 WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain", scrollbarWidth:"none", margin:"0 -2px" }}>
        {REVIEW_QUESTIONS.map((q, i) => (
          <div key={q.k} style={{ flex:"0 0 100%", boxSizing:"border-box", scrollSnapAlign:"start", padding:"0 2px", height:PAGE_H }}>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"8px 0 6px" }}>{q.label}</p>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 16px" }}>{q.hint}</p>
            <div style={{ display:"flex", gap:8 }}>
              {[["はい", true], ["いいえ", false]].map(([l, v]) => {
                const on = answers[q.k] === v;
                return (
                  <button key={l} type="button" onClick={()=>pick(q.k, v, i)} className="f-sans" style={{
                    flex:1, padding:"14px 9px", borderRadius:12, fontSize:15, cursor:"pointer", fontWeight:700, border:"2px solid",
                    borderColor: on ? "#00A86B" : "#EBEBEB",
                    background: on ? "#E6F7EF" : "#fff", color: on ? "#00A86B" : "#222",
                  }}>{l}</button>
                );
              })}
            </div>
          </div>
        ))}
        {/* 最後のページ＝自由記述（どちらも任意）。ここで「送信する」→最終確認 */}
        <div style={{ flex:"0 0 100%", boxSizing:"border-box", scrollSnapAlign:"start", padding:"0 2px", height:PAGE_H, overflowY:"auto" }}>
          <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"8px 0 6px" }}>ひとこと（任意）</p>
          <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 10px" }}>書かなくても送信できます。</p>
          <textarea value={publicComment} onChange={e=>setPublicComment(e.target.value)}
            onFocus={()=>setTyping(true)} onBlur={()=>setTyping(false)}
            placeholder="農園について良かった点を一言（公開されます）" rows={3}
            className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:16, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }} />
          <textarea value={privateMemo} onChange={e=>setPrivateMemo(e.target.value)}
            onFocus={()=>setTyping(true)} onBlur={()=>setTyping(false)}
            placeholder="自分だけが見えるメモ" rows={3}
            className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:16, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginTop:8 }} />
        </div>
      </div>
      {/* 進み具合（タップでその問いへ）。答えた問いは薄い緑で埋まる */}
      <div style={{ display:"flex", justifyContent:"center", gap:6, margin:"12px 0 14px" }}>
        {Array.from({ length: TOTAL_PAGES }).map((_, i) => {
          const answered = i < REVIEW_QUESTIONS.length && answers[REVIEW_QUESTIONS[i].k] !== undefined;
          return (
            <button key={i} type="button" onClick={()=>go(i)} aria-label={(i + 1) + "ページ目へ"}
              style={{ width:8, height:8, borderRadius:"50%", border:"none", padding:0, cursor:"pointer",
                       background: i === idx ? "#00A86B" : answered ? "#A8DEC5" : "#DDD" }} />
          );
        })}
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"space-between", alignItems:"center" }}>
        {/* 戻る（2026-08-19たきと指示「戻るを設置しろ」）。1ページ目の戻るは閉じる＝行き止まりを作らない */}
        <button onClick={()=>{ if (submitting) return; if (idx === 0) onClose(); else go(idx - 1); }} disabled={submitting} className="f-sans"
          style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>
          {idx === 0 ? "キャンセル" : "← 戻る"}
        </button>
        {idx === TOTAL_PAGES - 1 ? (
          /* ★押せないボタンにしない（2026-08-03の原則）：未回答があるなら、その問いへ連れて行く */
          <button onClick={()=>{ if (ready) setConfirming(true); else go(REVIEW_QUESTIONS.findIndex(q => answers[q.k] === undefined)); }}
            className="f-sans"
            style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: ready ? 1 : 0.5 }}>
            送信する
          </button>
        ) : (
          <button onClick={()=>go(idx + 1)} className="f-sans"
            style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>次へ →</button>
        )}
      </div>
      {idx === TOTAL_PAGES - 1 && !ready && (
        <p className="f-sans" style={{ fontSize:11, color:"#B54A0E", textAlign:"right", margin:"8px 0 0" }}>
          あと{unanswered.length}問（「送信する」でその問いに戻ります）
        </p>
      )}
    </>
  );
}
