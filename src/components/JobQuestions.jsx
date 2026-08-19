// 求人Q&A（第10弾・2026-07-22／分割・段階2で切り出し・2026-07-24）：
// 求人詳細・確認ページの「仕事の内容/質問」タブ（ContentQTabs）と公開Q&A本体（JobQuestions）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { isAdmin, fmtJstShort } from "../lib/utils";
import { openLoginBox } from "../lib/previewBus";
import { Dots } from "./ui";
import { armLoginReturn, stashLoginDraft, takeLoginDraft } from "../lib/loginReturn";

// タブ中身の横スワイプ切替（2026-07-27たきと指示）：仕事の内容⇄質問を左右スワイプで移動。
// 指に連動（2026-08-03たきと指示）：今日ページの役割スワイプと同一の機構に揃えた＝
//   ①追従はsetStateせずDOMのtransformを直接書く（毎フレーム再レンダーを排除）
//   ②ジェスチャ開始8pxで縦/横を1回だけ判定する方向ロック（縦スクロールと誤認識しない）
//   ③容器にtouch-action:pan-y＋横ロック中はpreventDefault（ReactのonTouchMoveはpassiveで
//     preventDefault不可ので、ネイティブリスナーを{passive:false}で張る）
//   ④50px以上で切替成立→slideKey更新で新しいタブがスライドイン（cbSlideInR/L・今日ページと共用のCSS）
// 中の横スクロール要素（写真カルーセル・その他の求人等）内で始まったタッチは従来どおり奪わない。
// オーバーレイ（.cb-lock-scroll）が【この中に開いた】時（下からのシート等）も奪わない（今日ページと同じ守り）。
//   ★2026-08-08訂正：自分がオーバーレイの【中にいる】場合（ボックスの詳細面で使う時）は奪ってよい。
//     旧実装は祖先に.cb-lock-scrollがあるだけで降りていたため、シート内ではタブ切替が死んでいた。
// onEdgeSwipe（任意・2026-08-08）：端でさらにスワイプされた時の合図（"prev"/"next"）。
//   ボックスの詳細面では "prev"（最初のタブでさらに右スワイプ）＝面を戻る、に使う
//   ＝タブ切替と「戻る」が同じ横スワイプで両立する。
export function ContentQSwipeArea({ value, onChange, children, onEdgeSwipe }) {
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const gestureRef = useRef(null); // { x, y, lock:'h'|'v'|null }
  const [slideDir, setSlideDir] = useState(0); // 1=右から・-1=左から
  const [slideKey, setSlideKey] = useState(0); // key更新でアニメを再生
  const keys = ["content", "questions"]; // ★ContentQTabs の tabs と同じ並びに保つ（保険タブは2026-08-19に廃止）
  // リスナーはマウント時に1度だけ張るので、最新の値は ref 経由で読む（張り直しを避ける）
  const keysRef = useRef(keys); keysRef.current = keys;
  const valueRef = useRef(value); valueRef.current = value;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onEdgeSwipeRef = useRef(onEdgeSwipe); onEdgeSwipeRef.current = onEdgeSwipe;

  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const inHScroll = (node) => {
      for (let n = node; n && n !== el; n = n.parentElement) {
        try {
          const st = window.getComputedStyle(n);
          if ((st.overflowX === "auto" || st.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
        } catch { return true; }
      }
      return false;
    };
    // いまの位置から dx 方向へ動いた時の行き先（端なら現在地のまま＝抵抗を強くする材料）
    const targetIndex = (dx) => {
      const ks = keysRef.current;
      const idx = Math.max(0, ks.indexOf(valueRef.current));
      return dx < 0 ? Math.min(ks.length - 1, idx + 1) : Math.max(0, idx - 1);
    };
    const onStart = (ev) => {
      // オーバーレイがこの中に開いている時だけ譲る（自分がオーバーレイの中にいる時は奪ってよい・2026-08-08）
      const ov = ev.target && ev.target.closest && ev.target.closest(".cb-lock-scroll");
      if (ov && el.contains(ov)) { gestureRef.current = null; return; }
      if (inHScroll(ev.target)) { gestureRef.current = null; return; }
      const t = ev.touches[0]; if (t) gestureRef.current = { x: t.clientX, y: t.clientY, lock: null };
    };
    const onMove = (ev) => {
      const g = gestureRef.current; if (!g) return;
      const t = ev.touches[0]; if (!t) return;
      const dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 8px動くまで判定保留
        g.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";  // 1ジェスチャ1回だけ軸を確定
      }
      if (g.lock !== "h") return; // 縦確定＝以後ノータッチ（ブラウザのスクロールに完全に譲る）
      ev.preventDefault();
      const c = contentRef.current; if (!c) return;
      const ks = keysRef.current;
      const damp = ks[targetIndex(dx)] === valueRef.current ? 0.12 : 0.4; // 端は強い抵抗（行き止まりの感触）
      c.style.transition = "none";
      c.style.transform = `translateX(${Math.max(-100, Math.min(100, dx * damp))}px)`;
    };
    const onEnd = (ev) => {
      const g = gestureRef.current; gestureRef.current = null;
      if (!g || g.lock !== "h") return;
      const c = contentRef.current;
      const t = ev.changedTouches && ev.changedTouches[0];
      const dx = t ? t.clientX - g.x : 0;
      const ks = keysRef.current;
      const next = ks[targetIndex(dx)];
      if (Math.abs(dx) >= 50 && next !== valueRef.current) {
        if (c) { c.style.transition = ""; c.style.transform = ""; }
        setSlideDir(dx < 0 ? 1 : -1); // 左スワイプ＝次のタブが右から入る
        setSlideKey(k => k + 1);
        onChangeRef.current(next);
        return;
      }
      // 端でさらにスワイプ＝行き先が無い（2026-08-08）：合図を親へ。
      // ボックスの詳細面では "prev"（最初のタブで右スワイプ）＝面を戻る、に使われる
      if (Math.abs(dx) >= 50 && next === valueRef.current && onEdgeSwipeRef.current) {
        if (c) { c.style.transition = "transform .2s ease"; c.style.transform = ""; }
        onEdgeSwipeRef.current(dx > 0 ? "prev" : "next");
        return;
      }
      if (c) { c.style.transition = "transform .2s ease"; c.style.transform = ""; } // スナップバック
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    // cb-content-swipe＝親のシートが「この中の横スワイプはタブ切替のもの」と判別する目印（2026-08-08）
    <div ref={rootRef} className="cb-content-swipe" style={{ touchAction:"pan-y" }}>
      <div key={slideKey} ref={contentRef} style={{ animation: slideDir ? `${slideDir > 0 ? "cbSlideInR" : "cbSlideInL"} .28s ease` : undefined }}>
        {children}
      </div>
    </div>
  );
}

// 「仕事の内容」「質問」タブバー（第10弾・2026-07-22）：求人詳細・確認ページの写真下に置く
export function ContentQTabs({ value, onChange }) {
  // 保険タブは廃止（2026-08-19たきと指示）＝保険カードはカレンダーの下（JobInsuranceSection）へ移植。
  // タブを足す時はここと ContentQSwipeArea の keys を必ず同じ並びで直す（横スワイプの行き先がずれる）
  const tabs = [["content", "仕事の内容"], ["questions", "質問"]];
  return (
    <div style={{ display:"flex", gap:4, borderBottom:"1px solid #EEE", marginBottom:20 }}>
      {tabs.map(([k, l]) => (
        <button key={k} onClick={()=>onChange(k)} className="f-sans" style={{ flex:1, background:"none", border:"none", borderBottom: value===k ? "2px solid #00A86B" : "2px solid transparent", padding:"10px 0", fontSize:14, fontWeight:700, color: value===k ? "#00A86B" : "#999", cursor:"pointer", marginBottom:-1 }}>{l}</button>
      ))}
    </div>
  );
}

// 求人Q&A（第10弾・2026-07-22）：求人詳細・応募前の確認ページの「質問」タブで使う公開Q&A。
// 読み取りは job_questions を直接SELECT（RLS：hidden=false／当事者・管理者は全件）。
// 書き込みは必ずRPC経由（ask_job_question / answer_job_question / admin_hide_question）。NG検査（電話/メール/URL拒否）はDB側。
export function JobQuestions({ jobNumber, me }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [ngMsg, setNgMsg] = useState("");
  const [answerDraft, setAnswerDraft] = useState({}); // {id: 回答テキスト}
  const [answeringId, setAnsweringId] = useState(null);
  const [answerNg, setAnswerNg] = useState({}); // {id: NGメッセージ}
  const [hidingId, setHidingId] = useState(null);
  const admin = isAdmin(me);
  const load = async () => {
    try {
      const { data } = await supabase.from("job_questions").select("*").eq("job_number", jobNumber).order("created_at", { ascending: false });
      setRows(data || []);
    } catch {}
    setLoading(false);
  };
  useEffect(() => {
    if (jobNumber == null) { setLoading(false); return; }
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setMyId(session.user.id);
          // 自分の求人か（jobs owner select＝自分の行のみ返る。管理者は全件返るが farmer_id 一致で本人だけ true）
          const { data: jrow } = await supabase.from("jobs").select("farmer_id").eq("job_number", jobNumber).maybeSingle();
          setIsOwner(!!(jrow && jrow.farmer_id === session.user.id));
        }
      } catch {}
      load();
    })();
  }, [jobNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  // ログインを挟んで戻ってきたとき、書きかけの質問を元の求人にだけ戻す（2026-07-30たきと指示）
  useEffect(() => {
    if (jobNumber == null) return;
    const d = takeLoginDraft("jobQuestion");
    if (d && String(d.jobNumber) === String(jobNumber) && d.text) setText(d.text);
  }, [jobNumber]);
  const submitAsk = async () => {
    const q = text.trim();
    if (!q || sending) return;
    setNgMsg(""); setSending(true);
    try {
      const { data, error } = await supabase.rpc("ask_job_question", { p_job: jobNumber, p_question: q });
      if (error || !data?.ok) {
        if (data?.reason === "not_logged_in") {
          // 書いた文と今いるページを預けてから、その場にログインのボックスを開く。
          // ログイン後にこのページへ戻り、上のuseEffectが文を書き戻す
          stashLoginDraft("jobQuestion", { jobNumber, text: q });
          armLoginReturn();
          setNgMsg("質問するにはログインが必要です。入力した内容は保存されます。");
          openLoginBox();
        } else {
          setNgMsg(data?.message || (data?.reason === "own_job" ? "自分の求人には質問できません。" : data?.reason === "not_open" ? "この求人は現在公開されていません。" : "送信できませんでした。"));
        }
      } else { setText(""); await load(); }
    } catch { setNgMsg("送信できませんでした。"); }
    setSending(false);
  };
  const submitAnswer = async (id) => {
    const ans = (answerDraft[id] || "").trim();
    if (!ans || answeringId) return;
    setAnswerNg(p => ({ ...p, [id]: "" })); setAnsweringId(id);
    try {
      const { data, error } = await supabase.rpc("answer_job_question", { p_id: id, p_answer: ans });
      if (error || !data?.ok) setAnswerNg(p => ({ ...p, [id]: data?.message || "送信できませんでした。" }));
      else { setAnswerDraft(p => ({ ...p, [id]: "" })); await load(); }
    } catch { setAnswerNg(p => ({ ...p, [id]: "送信できませんでした。" })); }
    setAnsweringId(null);
  };
  const toggleHide = async (id, hidden) => {
    if (hidingId) return;
    setHidingId(id);
    try { const { data } = await supabase.rpc("admin_hide_question", { p_id: id, p_hidden: hidden }); if (data?.ok) await load(); } catch {}
    setHidingId(null);
  };
  if (jobNumber == null) {
    return <p className="f-sans" style={{ color:"#999", fontSize:13, padding:"16px 0", textAlign:"center" }}>公開後に、ここで働き手からの質問を受け付けます。</p>;
  }
  return (
    <div className="f-sans">
      {/* 質問の説明（2026-07-24たきと指示）：タブを開いた時に仕組みを先に伝える。農家本人と働き手で文面を出し分け */}
      <div style={{ background:"#F7FBF9", border:"1px solid #DDEDE5", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
        <p style={{ fontSize:13, fontWeight:700, color:"#0B6B4F", margin:"0 0 4px" }}>💬 この求人の公開Q&A</p>
        <p style={{ fontSize:12, color:"#5B7B6D", margin:0, lineHeight:1.7 }}>
          {isOwner
            ? "働き手からの質問がここに届きます。回答はこの求人を見る全員に公開され、同じ質問を減らせます。"
            : "応募前に気になることを質問できます。農家の回答は、この求人を見る全員に公開されます。個人情報や連絡先は書かないでください。"}
        </p>
      </div>
      {loading ? (
        <p style={{ textAlign:"center", color:"#999", fontSize:13, padding:"24px 0" }}>読み込み中<Dots /></p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p style={{ color:"#999", fontSize:13, padding:"12px 0 20px", textAlign:"center" }}>まだ質問はありません。{!isOwner ? "気になることは、下から質問できます。" : ""}</p>
          ) : (
            <div style={{ display:"grid", gap:16, marginBottom:20 }}>
              {rows.map(q => (
                <div key={q.id} style={{ opacity: q.hidden ? 0.5 : 1 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                    <span style={{ flexShrink:0, width:26, height:26, borderRadius:"50%", background:"#EEF4F1", color:"#0B6B4F", fontWeight:800, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>Q</span>
                    <div style={{ background:"#F2F5F4", borderRadius:"4px 14px 14px 14px", padding:"10px 14px", flex:1, minWidth:0 }}>
                      <p style={{ fontSize:14, color:"#222", margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{q.question}</p>
                      <p style={{ fontSize:10, color:"#B0B0B0", margin:"4px 0 0" }}>{fmtJstShort(q.created_at)}{q.hidden ? "・非表示中" : ""}</p>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8, alignItems:"flex-start", marginTop:8, flexDirection:"row-reverse" }}>
                    <span style={{ flexShrink:0, width:26, height:26, borderRadius:"50%", background:"#00A86B", color:"#fff", fontWeight:800, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>A</span>
                    {q.answer ? (
                      <div style={{ background:"#E6F7EF", borderRadius:"14px 4px 14px 14px", padding:"10px 14px", flex:1, minWidth:0 }}>
                        <p style={{ fontSize:14, color:"#0B4A36", margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{q.answer}</p>
                        <p style={{ fontSize:10, color:"#8FBFAB", margin:"4px 0 0", textAlign:"right" }}>{fmtJstShort(q.answered_at)}</p>
                      </div>
                    ) : isOwner ? (
                      <div style={{ flex:1, minWidth:0 }}>
                        <textarea value={answerDraft[q.id] || ""} onChange={e=>setAnswerDraft(p=>({ ...p, [q.id]: e.target.value }))} placeholder="回答を入力（全員に公開されます）" rows={2} className="field f-sans" style={{ fontSize:13, resize:"vertical", marginBottom:6 }} />
                        {answerNg[q.id] && <p style={{ fontSize:11, color:"#E24B4A", margin:"0 0 6px" }}>{answerNg[q.id]}</p>}
                        <button onClick={()=>submitAnswer(q.id)} disabled={answeringId===q.id || !(answerDraft[q.id]||"").trim()} className="f-sans" style={{ padding:"8px 16px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity:(answeringId===q.id||!(answerDraft[q.id]||"").trim())?0.5:1 }}>{answeringId===q.id?<>送信中<Dots /></>:"回答する"}</button>
                      </div>
                    ) : (
                      <span style={{ background:"#F3F3F3", borderRadius:"14px 4px 14px 14px", padding:"8px 14px", fontSize:12, color:"#999" }}>回答待ち</span>
                    )}
                  </div>
                  {admin && (
                    <div style={{ textAlign:"right", marginTop:4 }}>
                      <button onClick={()=>toggleHide(q.id, !q.hidden)} disabled={hidingId===q.id} className="f-sans" style={{ background:"none", border:"none", fontSize:11, color: q.hidden ? "#00A86B" : "#B0B0B0", textDecoration:"underline", cursor:"pointer" }}>{q.hidden ? "再表示する" : "非表示にする"}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!isOwner && (
            <div style={{ borderTop:"1px solid #EEE", paddingTop:14 }}>
              <textarea value={text} onChange={e=>{ setText(e.target.value); setNgMsg(""); }} placeholder="この求人について質問する" rows={2} className="field f-sans" style={{ fontSize:14, resize:"vertical", marginBottom:6 }} />
              {ngMsg && <p style={{ fontSize:12, color:"#E24B4A", margin:"0 0 6px" }}>{ngMsg}</p>}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                <p style={{ fontSize:11, color:"#B0B0B0", margin:0, flex:1, lineHeight:1.5 }}>質問と回答は、この求人を見る全員に公開されます</p>
                <button onClick={submitAsk} disabled={sending || !text.trim()} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", flexShrink:0, opacity:(sending||!text.trim())?0.5:1 }}>{sending?<>送信中<Dots /></>:"質問する"}</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
