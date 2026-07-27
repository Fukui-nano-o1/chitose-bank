// 求人Q&A（第10弾・2026-07-22／分割・段階2で切り出し・2026-07-24）：
// 求人詳細・確認ページの「仕事の内容/質問」タブ（ContentQTabs）と公開Q&A本体（JobQuestions）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { isAdmin, fmtJstShort } from "../lib/utils";

// タブ中身の横スワイプ切替（2026-07-27たきと指示）：仕事の内容⇄保険⇄質問を左右スワイプで移動。
// 中の横スクロール要素（写真カルーセル・その他の求人等）内で始まったタッチは奪わない。
// 判定は応募者フィルタと同じ作法（50px以上・横優位のみ）
export function ContentQSwipeArea({ value, onChange, showInsurance, children }) {
  const ref = useRef(null);
  const keys = showInsurance ? ["content", "insurance", "questions"] : ["content", "questions"];
  const inHScroll = (node, stop) => {
    for (let n = node; n && n !== stop; n = n.parentElement) {
      try {
        const st = window.getComputedStyle(n);
        if ((st.overflowX === "auto" || st.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
      } catch { return true; }
    }
    return false;
  };
  const onStart = (e) => {
    const t = e.touches[0]; if (!t) return;
    ref.current = inHScroll(e.target, e.currentTarget) ? null : { x: t.clientX, y: t.clientY };
  };
  const onEnd = (e) => {
    const s = ref.current; ref.current = null;
    if (!s) return;
    const t = e.changedTouches[0]; if (!t) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // 横スワイプのみ
    const idx = Math.max(0, keys.indexOf(value));
    const next = dx < 0 ? Math.min(keys.length - 1, idx + 1) : Math.max(0, idx - 1);
    if (keys[next] !== value) onChange(keys[next]);
  };
  return <div onTouchStart={onStart} onTouchEnd={onEnd}>{children}</div>;
}

// 「仕事の内容」「質問」タブバー（第10弾・2026-07-22）：求人詳細・確認ページの写真下に置く
export function ContentQTabs({ value, onChange, showInsurance }) {
  // 保険タブは農家が保険を自己申告している求人でだけ出す（未申告なら従来の2タブのまま）
  const tabs = showInsurance
    ? [["content", "仕事の内容"], ["insurance", "保険"], ["questions", "質問"]]
    : [["content", "仕事の内容"], ["questions", "質問"]];
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
  const submitAsk = async () => {
    const q = text.trim();
    if (!q || sending) return;
    setNgMsg(""); setSending(true);
    try {
      const { data, error } = await supabase.rpc("ask_job_question", { p_job: jobNumber, p_question: q });
      if (error || !data?.ok) {
        setNgMsg(data?.message || (data?.reason === "not_logged_in" ? "質問するにはログインが必要です。" : data?.reason === "own_job" ? "自分の求人には質問できません。" : data?.reason === "not_open" ? "この求人は現在公開されていません。" : "送信できませんでした。"));
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
        <p style={{ textAlign:"center", color:"#999", fontSize:13, padding:"24px 0" }}>読み込み中...</p>
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
                        <button onClick={()=>submitAnswer(q.id)} disabled={answeringId===q.id || !(answerDraft[q.id]||"").trim()} className="f-sans" style={{ padding:"8px 16px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity:(answeringId===q.id||!(answerDraft[q.id]||"").trim())?0.5:1 }}>{answeringId===q.id?"送信中...":"回答する"}</button>
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
                <button onClick={submitAsk} disabled={sending || !text.trim()} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", flexShrink:0, opacity:(sending||!text.trim())?0.5:1 }}>{sending?"送信中...":"質問する"}</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
