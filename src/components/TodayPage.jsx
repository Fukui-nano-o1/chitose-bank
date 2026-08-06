// 📆 今日ページ（分割・段階2で切り出し・2026-07-24）：ナビ4番。やること（my_todo_items）＋きょうの仕事＋つぎの予定＋メモ。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { getCache, setCache } from "../lib/viewCache";
import { ymdLocal, calAddDays, calFmtDate, ROLE_ORANGE, ROLE_GREEN, mapJobPublicRow, payLabel, photoThumb,
  appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, CHAT_ELIGIBLE_STATUSES } from "../lib/utils";
import { openPhaseInfo } from "../lib/previewBus";
import { findDoubleBookingJob, doubleBookingWarning, HIRE_NAME_DISCLOSURE_NOTE } from "../lib/hire";
import { Avatar, AutoSkeleton, useSkeletonProbe, Dots, DeclaredBadge, PunchGapNotice } from "./ui";
import ContractPartyName from "./ContractPartyName";
import ContractEmergencyContact from "./ContractEmergencyContact";
import { TimeCorrectionSheet } from "./TimeCorrectionSheet";
// 面接の回答パネル（2026-07-25・働き手）：農家からの【面接の質問】に今日のリストからその場で返事する。
// ★モジュールレベル定義を維持すること：親（TodayPage）内で定義すると再レンダーごとに再マウントされ、
//   textareaのフォーカス・下書きが消える（LandingFlowのフォーカス消失バグと同族）
function InterviewReplyPanel({ items, accent, onAnswered }) {
  const [questions, setQuestions] = useState({}); // application_id → 最新の【面接の質問】本文
  const [drafts, setDrafts] = useState({});       // application_id → 入力中の回答
  const [sending, setSending] = useState("");
  const [jobOpen, setJobOpen] = useState({});     // application_id → 該当求人ボックスの展開状態（2026-07-25たきと指示）
  const [jobInfo, setJobInfo] = useState({});     // job_number → mapJobPublicRow整形済み（null=取得失敗・undefined=未取得）
  const toggleJob = async (t) => {
    if (!t.job_number) return;
    const next = !jobOpen[t.application_id];
    setJobOpen(prev => ({ ...prev, [t.application_id]: next }));
    if (next && !(t.job_number in jobInfo)) {
      try {
        const { data } = await supabase.from("jobs_public").select("*").eq("job_number", t.job_number).maybeSingle();
        setJobInfo(prev => ({ ...prev, [t.job_number]: data ? mapJobPublicRow(data) : null }));
      } catch { setJobInfo(prev => ({ ...prev, [t.job_number]: null })); }
    }
  };
  const idsKey = items.map(t => t.application_id).filter(Boolean).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = idsKey ? idsKey.split(",") : [];
        if (!ids.length) return;
        const { data } = await supabase.from("messages")
          .select("application_id,body,created_at").in("application_id", ids)
          .like("body", "【面接の質問】%").order("created_at", { ascending: true });
        if (cancelled || !data) return;
        const q = {}; data.forEach(m => { q[m.application_id] = m.body; }); // 昇順で上書き＝各応募の最新が残る
        setQuestions(q);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [idsKey]);
  const send = async (t) => {
    const body = (drafts[t.application_id] || "").trim();
    if (!body || sending) return;
    setSending(t.application_id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSending(""); return; }
      const { error } = await supabase.from("messages").insert({ application_id: t.application_id, sender_id: session.user.id, body });
      if (error) { alert("送信に失敗しました：" + error.message); setSending(""); return; }
      setSending("");
      setDrafts(prev => ({ ...prev, [t.application_id]: "" }));
      onAnswered(t.application_id);
    } catch (e) { alert("送信に失敗しました：" + (e?.message || "不明")); setSending(""); }
  };
  return (
    <div style={{ gridColumn:"1 / -1", border:"1px solid #EBEBEB", borderRadius:12, background:"#fff", padding:"12px 14px" }}>
      {/* ボックス内タイトル・左端の役割色バーは廃止（2026-07-26たきと指示：見出しはページヘッダーが担う。TodoStagePanelと同じ整理） */}
      <div style={{ display:"grid", gap:14 }}>
        {items.map(t => (
          <div key={t.application_id} style={{ display:"grid", gap:8 }}>
            {/* 求人チップ：タップでその場に求人ボックスを展開（2026-07-25たきと指示。ページ遷移はボックス内リンクに退避） */}
            <button onClick={()=>toggleJob(t)}
              className="f-sans" style={{ justifySelf:"start", fontSize:11, fontWeight:600, color:"#717171", background:"#F7F7F7", border:"none", borderRadius:8, padding:"4px 8px", cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }}>
              {[t.job_number ? "#" + t.job_number : "", [t.crop, t.task].filter(Boolean).join(" ")].filter(Boolean).join(" ")}{jobOpen[t.application_id] ? " ▲" : " ▼"}
            </button>
            {jobOpen[t.application_id] && (
              <div style={{ border:"1px solid #EBEBEB", borderRadius:12, background:"#FAFAFA", overflow:"hidden" }}>
                {!(t.job_number in jobInfo) ? (
                  <p className="f-sans" style={{ fontSize:12, color:"#999", textAlign:"center", padding:"14px 0", margin:0 }}>読み込み中<Dots /></p>
                ) : jobInfo[t.job_number] ? (() => {
                  const j = jobInfo[t.job_number];
                  const photo = photoThumb(j.photos?.[0]);
                  return (
                    <>
                      <div style={{ display:"flex", gap:10, padding:"10px 12px 8px", alignItems:"center" }}>
                        <div style={{ width:48, height:48, borderRadius:8, background:"#F0F0F0", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, overflow:"hidden" }}>
                          {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌾"}
                        </div>
                        <div style={{ minWidth:0 }}>
                          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[j.crop, j.task].filter(Boolean).join(" ") || "求人"}</p>
                          {j.region && <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"2px 0 0" }}>📍 {j.region}</p>}
                        </div>
                      </div>
                      <div style={{ padding:"0 12px 10px", display:"grid", gap:3 }}>
                        {[["日程", j.dateLabel], ["勤務時間", j.workTime], ["休憩", j.breakTime], ["報酬", j.pay ? payLabel(j) : ""], ["人数", j.count]].filter(r => r[1]).map(r => (
                          <div key={r[0]} style={{ display:"flex", gap:10 }}>
                            <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0, width:52 }}>{r[0]}</span>
                            <span className="f-sans" style={{ fontSize:12, color:"#222", fontWeight:600, minWidth:0 }}>{r[1]}</span>
                          </div>
                        ))}
                      </div>
                      <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + t.job_number; }}
                        className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", background:"#fff", border:"none", borderTop:"1px solid #EBEBEB", padding:"9px", fontSize:12, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>求人ページを見る →</button>
                    </>
                  );
                })() : (
                  <div style={{ padding:"12px" }}>
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 8px", textAlign:"center" }}>求人情報を取得できませんでした。</p>
                    <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + t.job_number; }}
                      className="f-sans" style={{ display:"block", margin:"0 auto", background:"none", border:"none", fontSize:12, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>求人ページを見る →</button>
                  </div>
                )}
              </div>
            )}
            <p className="f-sans" style={{ fontSize:12, color:"#222", lineHeight:1.7, background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>
              {questions[t.application_id] || <>質問を読み込み中<Dots /></>}
            </p>
            <textarea rows={3} value={drafts[t.application_id] || ""} onChange={ev => setDrafts(prev => ({ ...prev, [t.application_id]: ev.target.value }))}
              placeholder="回答を入力（そのまま相手に届きます）" className="field f-sans" style={{ width:"100%", fontSize:14, resize:"vertical", boxSizing:"border-box" }} />
            <button onClick={()=>send(t)} disabled={sending === t.application_id || !(drafts[t.application_id] || "").trim()}
              className="f-sans" style={{ justifySelf:"end", padding:"9px 16px", fontSize:13, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:9, cursor:"pointer", opacity: (sending === t.application_id || !(drafts[t.application_id] || "").trim()) ? 0.5 : 1 }}>
              {sending === t.application_id ? "..." : "返事を送る"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// 新着の応募のお祝いパネル（2026-07-26たきと指示）：応募は祝い事。おめでとう文言＋「応募者 ----→ 求人」の対応行。
// 初展開（その応募をはじめて見た時）だけ花びらが舞う（見た応募IDはlocalStorage cb_celebratedAppsに記録＝再訪では舞わない）。
// ★モジュールレベル定義を維持すること：親内で定義すると再レンダーごとに再マウントされ花びらが途切れる
function NewApplicantsPanel({ items, onTap }) {
  const [petals, setPetals] = useState(false);
  useEffect(() => {
    try {
      const seen = new Set(JSON.parse(localStorage.getItem("cb_celebratedApps") || "[]"));
      if (items.some(t => t.application_id && !seen.has(t.application_id))) {
        setPetals(true);
        items.forEach(t => { if (t.application_id) seen.add(t.application_id); });
        localStorage.setItem("cb_celebratedApps", JSON.stringify([...seen].slice(-200)));
      }
    } catch { setPetals(true); }
  }, []);
  return (
    <div style={{ position:"relative", border:"1px solid #EBEBEB", borderRadius:12, background:"#fff", padding:"18px 14px" }}>
      {petals && (
        <div aria-hidden style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none", borderRadius:12 }}>
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} style={{ position:"absolute", top:-24, left: ((i * 29 + 7) % 96) + "%", fontSize: 13 + (i % 3) * 4, opacity:0, animation: `cbPetalFall ${1.9 + (i % 5) * 0.25}s ease-in ${(i % 7) * 0.13}s forwards` }}>🌸</span>
          ))}
        </div>
      )}
      <style>{`@keyframes cbPetalFall{0%{transform:translateY(0) rotate(0deg);opacity:0}12%{opacity:1}100%{transform:translateY(360px) rotate(230deg);opacity:0}}`}</style>
      <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", textAlign:"center", margin:"0 0 4px" }}>🎉 おめでとうございます！</p>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"0 0 16px" }}>あなたの求人に新しい応募が届きました。タップして確認しましょう。</p>
      <div style={{ display:"grid", gap:10 }}>
        {items.map(t => (
          <button key={t.application_id} onClick={()=>onTap(t)} className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, width:"100%", background:"#FAFAFA", border:"1px solid #F0F0F0", borderRadius:12, padding:"12px 10px", cursor:"pointer", minWidth:0 }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, flexShrink:0, maxWidth:72 }}>
              <Avatar url={t.partner_avatar} name={t.partner_name} size={40} bg={ROLE_ORANGE} />
              <span className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#222", maxWidth:72, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.partner_name ? t.partner_name + "さん" : "応募者"}</span>
            </div>
            <span aria-hidden className="f-sans" style={{ flexShrink:0, fontSize:13, fontWeight:700, color:"#00A86B", letterSpacing:1 }}>----→</span>
            <span className="f-sans" style={{ minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontSize:13, fontWeight:700, color:"#222", background:"#fff", border:"1px solid #EBEBEB", borderRadius:10, padding:"9px 12px" }}>
              {[t.crop, t.task].filter(Boolean).join(" ") || "求人"} <span style={{ color:"#999", fontSize:11 }}>#{t.job_number}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 緊急連絡の専用ページ（2026-08-02たきと指示「ステータスと同じ構造に」）：
// ステータスページ(#/saved・SavedJobsView)と同じカード構造＝左:求人トップ写真＋タイトル/#No.オーバーレイ／
// 右:相手のアイコン＋段階ラベル。カードタップでボックス（下からのシート）が開き、
// 実行（⚠️緊急連絡・チャット・求人ページ）はシート内のボタンが担う。
// ★モジュールレベル定義を維持すること：親内で定義すると再レンダーごとに再マウントされる（フォーカス消失バグの同族）
function EmergencyStagePanel({ items, role }) {
  const [boxItem, setBoxItem] = useState(null); // 展開中のボックス（ステータスページのboxJobと同じ作法）
  // 段階はステータスページと同じ導出（appPhaseKey＝帯の唯一のソース。entriesはterms_confirmed_*を持つ）
  const phaseOf = (e) => e.application_id ? appPhaseKey({ status: e.application_status,
    terms_confirmed_worker_at: e.terms_confirmed_worker_at, terms_confirmed_farmer_at: e.terms_confirmed_farmer_at }) : null;
  const titleOf = (e) => [e.crop, e.task].filter(Boolean).join(" ") || `求人 #${e.job_number}`;
  // 相手アイコンは相手の役割色で統一（2026-08-02たきと指示「働き手のアイコンはオレンジ。農家はミドリ」）：
  // リングも未設定時の下地も役割色（チャットの役割色枠と同じ規約・2026-07-22）。段階は下のラベル文字色が担う
  const partnerColor = role === "farmer" ? ROLE_ORANGE : ROLE_GREEN;
  return (
    <>
      <div style={{ display:"grid", gap:10 }}>
        {items.map(e => {
          const photo = photoThumb(e.photos?.[0]);
          const phase = phaseOf(e);
          return (
            <div key={e.application_id} style={{ position:"relative", display:"flex", alignItems:"stretch", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden" }}>
              {/* 左：求人のトップ写真。タイトル・#No.を写真下部に重ねる（ステータスページと同じ作法・枠は3:4固定） */}
              <button onClick={()=>setBoxItem(e)} aria-label="この仕事の緊急連絡を開く" className="f-sans"
                style={{ flexShrink:0, width:104, aspectRatio:"3 / 4", padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
                <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
                  <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{titleOf(e)}</span>
                  <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{e.job_number}</span>
                </span>
              </button>
              {/* 右：相手のアイコン＋段階（緊急連絡は相手に送るもの＝誰宛かを主役に。アイコンは役割色） */}
              <div style={{ flex:1, minWidth:0, padding:"10px 12px 8px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <button onClick={()=>setBoxItem(e)} className="f-sans"
                  style={{ width:72, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <Avatar url={e.partner_avatar} name={e.partner_name || "？"} size={52} ring={partnerColor} bg={partnerColor} />
                  <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color:"#222", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.partner_name ? e.partner_name + "さん" : "相手"}</span>
                  {phase && <span onClick={(ev)=>{ ev.stopPropagation(); openPhaseInfo(phase); }} role="button" style={{ display:"block", fontSize:9, fontWeight:700, color:APP_PHASE_COLOR[phase] || "#00A86B", marginTop:1, cursor:"pointer" }}>{APP_PHASE_LABEL[phase] || ""}</span>}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {/* ═══ カードタップで展開するボックス（ステータスページのシートと同じ作法） ═══ */}
      {boxItem && (() => {
        const e = boxItem;
        const phase = phaseOf(e);
        const c = APP_PHASE_COLOR[phase] || "#717171";
        const photo = photoThumb(e.photos?.[0]);
        const dateLabel = e.date_start ? (e.date_end && e.date_end !== e.date_start ? `${calFmtDate(e.date_start)}〜${calFmtDate(e.date_end)}` : calFmtDate(e.date_start)) : "未設定";
        const chatOk = !!(e.application_id && CHAT_ELIGIBLE_STATUSES.includes(e.application_status));
        return (
          <div onClick={()=>setBoxItem(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div onClick={ev=>ev.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                <button onClick={()=>setBoxItem(null)} aria-label="閉じる" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                {/* 現在地バナー（ステータスページと同じ・段階色＋APP_PHASE_DESC＝説明の唯一のソース） */}
                {phase && (
                  <div style={{ background: c + "14", borderLeft: "4px solid " + c, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:c, margin:0 }}>{APP_PHASE_LABEL[phase] || ""}</p>
                    {APP_PHASE_DESC[phase] && (
                      <p className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.7, margin:"3px 0 0" }}>{APP_PHASE_DESC[phase]}</p>
                    )}
                  </div>
                )}
                {/* 求人の要約（写真・タイトル・#No.・地域・日程・勤務時間・相手） */}
                <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                  <div style={{ flexShrink:0, width:88, height:88, borderRadius:12, overflow:"hidden", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                    {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>{titleOf(e)}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"2px 0 0" }}>#{e.job_number}{e.town ? "　" + e.town : ""}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>📅 {dateLabel}{e.work_time ? "　🕒" + e.work_time : ""}</p>
                    {e.partner_name && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0" }}>相手 {e.partner_name}さん</p>}
                  </div>
                </div>
                {/* 契約成立後のみ相手の本名を開示（当事者間・KYC非複製・2026-07-30たきと裁定(B)） */}
                {e.application_id && <ContractPartyName applicationId={e.application_id} showPending={false} style={{ margin:"0 0 12px", paddingLeft:2 }} />}
                {/* 緊急連絡先も採用成立後のみ（同じ窓口作法・2026-08-03）。緊急連絡の直前で相手の連絡先が見える */}
                {e.application_id && <ContractEmergencyContact applicationId={e.application_id} style={{ margin:"0 0 12px" }} />}
                {/* 操作（ステータスページのボタン群と同じ位置づけ。主役＝緊急連絡） */}
                <div style={{ display:"grid", gap:8 }}>
                  <button onClick={()=>{ setBoxItem(null); window.location.hash = "/emergency/" + e.application_id; }} className="f-sans"
                    style={{ padding:"12px", fontSize:14, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>⚠️ 緊急連絡をする →</button>
                  {chatOk && (
                    <button onClick={()=>{ setBoxItem(null); window.location.hash = "/chat/" + e.application_id; }} className="f-sans"
                      style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>💬 チャットを開く</button>
                  )}
                  <button onClick={()=>{ setBoxItem(null); try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + e.job_number; }} className="f-sans"
                    style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#555", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>求人ページを見る</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

// 応募者ページへの着地：どの応募のシートを開くかだけを渡す（詳しく見たい時の導線）。
// ★2026-08-06たきと指示で、採用そのものはこのページでも押せるようになった（下の HireStagePanel）。
//   採用の窓口は2つになったが、二重予約の判定と告知文は lib/hire に集約して食い違わせない。
//   実行は双方とも同じ confirm_terms＝人数上限・見送りの波及・権限はDB側が担保する
const HIRE_SHEET_PATH = "/profile/employer/applicants";
function markHireSheet(applicationId) {
  try {
    sessionStorage.setItem("cb_appFilter", "interview");        // 着地先の絞り込みを「面接中」に
    if (applicationId) sessionStorage.setItem("cb_openApplicantId", applicationId); // その応募のシートを自動展開
  } catch {}
}

// 採用するページ（2026-08-06たきと指示「応募者ページと同じ構造に。ただし応募者単位」）：
// 応募者ページ（FarmerDashboard・#/profile/employer/applicants）のカード＝左に求人のトップ写真
// （タイトル・#No.を下部に重ねる）／右に働き手のアイコン（リング＝段階色）＋名前＋段階、をそのまま使う。
// 違いは束ね方だけ＝応募者ページは1枚のカードに1求人（応募者アイコンが横に並ぶ）／このページは1枚＝1応募者。
// カードは横3分割（写真／アイコン／🤝採用）。写真・アイコンのタップで下からのボックス（要約と導線）、
// 🤝で最終確認→OKでその場で採用（ページ遷移しない・2026-08-06たきと指示）。
// ★モジュールレベル定義を維持すること：親内で定義すると再レンダーごとに再マウントされる（フォーカス消失バグの同族）
function HireStagePanel({ items, meId, onHired }) {
  const [boxItem, setBoxItem] = useState(null);
  // 最終確認（2026-08-06たきと指示「ここで採用を押す。最終確認。OKタップで採用。ページ遷移しない」）：
  // 🤝タップ→この画面内の確認カード→OKで confirm_terms を実行。応募者ページへは飛ばさない。
  // ★確認に必ず載せるもの＝二重予約の警告（lib/hire・応募者シートと同じ判定）と、
  //   契約成立で本名が相互開示されること（2026-07-30たきと裁定(B)の「採用confirmに明示」）
  const [confirmItem, setConfirmItem] = useState(null); // { ...todo, dup:number|null, checking:bool }
  const [hiring, setHiring] = useState(false);
  const [done, setDone] = useState(null);   // 採用アニメーション { name, jobNumber, extra }
  const [hiredIds, setHiredIds] = useState(() => new Set()); // 採用済み＝この画面から消す（やることが片付く）
  const openConfirm = async (t) => {
    setBoxItem(null);
    setConfirmItem({ ...t, dup: null, checking: true });
    const dup = meId ? await findDoubleBookingJob(meId, t.partner_id, t.job_number) : null;
    setConfirmItem(prev => (prev && prev.application_id === t.application_id) ? { ...prev, dup, checking: false } : prev);
  };
  const runHire = async () => {
    const t = confirmItem;
    if (!t || hiring) return;
    setHiring(true);
    // 二重予約はDB側confirm_termsも同じ式で見張る（2026-08-06・警告の機構化）。警告を見て
    // OKした時（t.dupあり）だけ受諾フラグを渡す。下調べthat取りこぼした時はDBがdouble_bookedを
    // 返すので、確認カードに警告を出し直し、もう一度OKで受諾ありになる
    const { data, error } = await supabase.rpc("confirm_terms", { p_application_id: t.application_id, p_accept_double_booking: !!t.dup });
    setHiring(false);
    if (!error && data?.reason === "double_booked") {
      setConfirmItem(prev => (prev && prev.application_id === t.application_id) ? { ...prev, dup: data.dup_job, checking: false } : prev);
      alert("日程の重なる別の求人が見つかりました。警告の内容を確認のうえ、もう一度OKを押すと採用が確定します。");
      return;
    }
    if (error || !data?.ok) { alert("処理に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
    // 人数に達した場合、残りの応募はDB側（confirm_terms）が見送りにする。件数はそのまま伝える
    const closed = Array.isArray(data.closed_ids) ? data.closed_ids.length : 0;
    const extra = !data.filled ? "" : (closed > 0
      ? `募集人数に達したため、残りの応募 ${closed} 件は見送りになりました（お相手へ連絡済み）。`
      : "募集人数に達したため、この求人の募集は終了です。");
    setConfirmItem(null);
    setDone({ appId: t.application_id, name: t.partner_name, jobNumber: t.job_number, extra });
    setHiredIds(prev => new Set(prev).add(t.application_id)); // この画面からは即座に消す
  };
  // ★親のやることから消すのは演出を閉じた後（2026-08-06）：先に消すと、最後の1件だった時に
  //   親が空状態へ切り替わってこのパネルごと消え、採用アニメーションが一瞬で消える
  const closeDone = () => {
    if (done?.appId && onHired) onHired(done.appId); // 今日ページのやること・件数バッジからも片付ける
    setDone(null);
  };
  // 求人のトップ写真だけは my_todo_items が返さないため、求人ページ・応募者ページと同じ
  // farm:jobInfo（my_farm_jobs 由来・{job_number:{crop,task,date_start,date_end,photos,holidays}}）から借りる。
  // キャッシュがあれば即描画→無ければ裏で1往復（新しいDBオブジェクトは作らない）
  const [jobInfo, setJobInfo] = useState(() => getCache("farm:jobInfo") ?? {});
  const missing = items.some(t => t.job_number && !jobInfo[t.job_number]);
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: bundle } = await supabase.rpc("my_farm_jobs");
        if (cancelled || !bundle?.jobs) return;
        const jim = Object.fromEntries(bundle.jobs.map(j => [j.job_number, { crop:j.crop, task:j.task, date_start:j.date_start, date_end:j.date_end, photos:j.photos, holidays:j.holidays }]));
        setJobInfo(jim); setCache("farm:jobInfo", jim);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [missing]);
  // 段階は記録から導出：my_todo_items の hire は「status in (approved,meeting,interview) かつ
  // terms_confirmed_farmer_at が無い」＝appPhaseKey でいう「面接中」だけが並ぶ（別の表示用状態を持たない）
  const phase = appPhaseKey({ status: "approved" });
  const phaseColor = APP_PHASE_COLOR[phase];
  const titleOf = (t) => [t.crop, t.task].filter(Boolean).join(" ") || `求人 #${t.job_number}`;
  const dateOf = (t) => t.date_start ? (t.date_end && t.date_end !== t.date_start ? `${calFmtDate(t.date_start)}〜${calFmtDate(t.date_end)}` : calFmtDate(t.date_start)) : "未設定";
  const photoOf = (t) => photoThumb(jobInfo[t.job_number]?.photos?.[0]);
  // 採用した応募はこの場から消える（ページ遷移せずに、やることが片付いたことが見てわかる）
  const shown = items.filter(t => !hiredIds.has(t.application_id));
  return (
    <>
      {/* 採用の演出（下の SUCCESS 用）。keyframesは使う場所に同居させる（NewApplicantsPanelの花びらと同じ作法） */}
      <style>{`
@keyframes cbHireSeal{0%{transform:scale(.3) rotate(-18deg);opacity:0}45%{transform:scale(1.18) rotate(4deg);opacity:1}70%{transform:scale(.95) rotate(0)}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes cbHireRing{0%{transform:scale(.5);opacity:.55}100%{transform:scale(2.6);opacity:0}}
@keyframes cbHireBurst{0%{transform:translate(0,0) scale(.4);opacity:0}20%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
@keyframes cbHireText{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}
`}</style>
      <div style={{ display:"grid", gap:10 }}>
        {shown.length === 0 && (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"28px 0" }}>採用しました。この用事は片付きました</p>
        )}
        {shown.map(t => {
          const photo = photoOf(t);
          return (
            /* 横幅を3分割（2026-08-06たきと指示）：写真／アイコン／🤝採用 を各1/3。
               3列とも同じ幅so、どのカードでも採用ボタンの位置が縦に揃う（迷わず押せる） */
            <div key={t.application_id} style={{ position:"relative", display:"flex", alignItems:"stretch", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden" }}>
              {/* ①求人のトップ写真＋タイトル・#No.（応募者ページのカードと同じ作法・枠は3:4固定） */}
              <button onClick={()=>setBoxItem(t)} aria-label="この応募を開く" className="f-sans"
                style={{ flex:"1 1 0", minWidth:0, aspectRatio:"3 / 4", padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
                <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
                  <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{titleOf(t)}</span>
                  <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{t.job_number}</span>
                </span>
              </button>
              {/* ②この応募の働き手ひとり（応募者ページのアイコン列と同じ見た目＝リングは段階色・
                  未設定アイコンの下地は相手の役割色＝働き手のオレンジ） */}
              <div style={{ flex:"1 1 0", minWidth:0, padding:"10px 8px 8px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <button onClick={()=>setBoxItem(t)} className="f-sans"
                  style={{ width:"100%", maxWidth:88, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <Avatar url={t.partner_avatar} name={t.partner_name || "？"} size={52} ring={phaseColor} bg={ROLE_ORANGE} />
                  <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color: t.partner_name ? "#222" : "#999", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.partner_name ? t.partner_name + "さん" : "未設定"}</span>
                  <span onClick={(ev)=>{ ev.stopPropagation(); openPhaseInfo(phase); }} role="button" style={{ display:"block", fontSize:9, fontWeight:700, color:phaseColor, marginTop:1, cursor:"pointer" }}>{APP_PHASE_LABEL[phase]}</span>
                </button>
              </div>
              {/* ③🤝採用：このページの用件そのもの。押すと最終確認（画面内）→OKでその場で採用。
                  ページ遷移はしない（2026-08-06たきと指示）。判定と告知文は応募者シートと共有（lib/hire） */}
              <button onClick={()=>openConfirm(t)} aria-label="この応募者を採用する" className="f-sans"
                style={{ flex:"1 1 0", minWidth:0, border:"none", borderLeft:"1px solid #F0F0F0", background:"#fff", cursor:"pointer", padding:"10px 8px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4 }}>
                <span style={{ fontSize:30, lineHeight:1 }}>🤝</span>
                <span style={{ fontSize:12, fontWeight:800, color:"#00A86B" }}>採用する</span>
              </button>
            </div>
          );
        })}
      </div>
      {/* ═══ カードタップで展開するボックス（緊急連絡ページ・ステータスページのシートと同じ作法） ═══ */}
      {boxItem && (() => {
        const t = boxItem;
        const photo = photoOf(t);
        return (
          <div onClick={()=>setBoxItem(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div onClick={ev=>ev.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                <button onClick={()=>setBoxItem(null)} aria-label="閉じる" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                {/* 現在地バナー（段階色＋APP_PHASE_DESC＝説明の唯一のソース） */}
                <div style={{ background: phaseColor + "14", borderLeft: "4px solid " + phaseColor, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                  <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:phaseColor, margin:0 }}>{APP_PHASE_LABEL[phase]}</p>
                  <p className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.7, margin:"3px 0 0" }}>{APP_PHASE_DESC[phase]}</p>
                </div>
                {/* 応募者（このページの主役）＋求人の要約 */}
                <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                  <div style={{ flexShrink:0, width:88, height:88, borderRadius:12, overflow:"hidden", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                    {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>{titleOf(t)}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"2px 0 0" }}>#{t.job_number}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>📅 {dateOf(t)}{t.work_time ? "　🕒" + t.work_time : ""}</p>
                    {t.partner_name && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0" }}>応募者 {t.partner_name}さん</p>}
                  </div>
                </div>
                {/* 操作（主役＝採用。この場で最終確認→採用まで進む） */}
                <div style={{ display:"grid", gap:8 }}>
                  <button onClick={()=>openConfirm(t)} className="f-sans"
                    style={{ padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>🤝 採用する</button>
                  <button onClick={()=>{ setBoxItem(null); markHireSheet(t.application_id); window.location.hash = HIRE_SHEET_PATH; }} className="f-sans"
                    style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#555", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>応募者ページで詳しく見る</button>
                  <button onClick={()=>{ setBoxItem(null); window.location.hash = "/chat/" + t.application_id; }} className="f-sans"
                    style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>💬 チャットを開く</button>
                  <button onClick={()=>{ setBoxItem(null); try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + t.job_number; }} className="f-sans"
                    style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#555", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>求人ページを見る</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ 最終確認（画面内・ページ遷移しない） ═══
          OKを押した時だけ confirm_terms が走る。ここに出す情報は「後戻りできない判断」に必要なものだけ */}
      {confirmItem && (() => {
        const t = confirmItem;
        return (
          <div onClick={()=>{ if (!hiring) setConfirmItem(null); }} className="cb-lock-scroll"
            style={{ position:"fixed", inset:0, zIndex:9200, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
            <div onClick={ev=>ev.stopPropagation()} style={{ width:"100%", maxWidth:420, maxHeight:"86vh", overflowY:"auto", background:"#fff", borderRadius:18, padding:"20px 18px calc(18px + env(safe-area-inset-bottom, 0px))", animation:"cbPop .18s ease" }}>
              <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", textAlign:"center", margin:"0 0 4px" }}>最終確認</p>
              <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"0 0 14px" }}>面接を終えてから決めてください</p>
              <div style={{ display:"flex", alignItems:"center", gap:12, background:"#F7F7F7", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
                <Avatar url={t.partner_avatar} name={t.partner_name || "？"} size={48} ring={phaseColor} bg={ROLE_ORANGE} />
                <div style={{ minWidth:0 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>{t.partner_name ? t.partner_name + "さん" : "この方"}</p>
                  <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"3px 0 0", overflow:"hidden", textOverflow:"ellipsis" }}>{titleOf(t)} <span style={{ color:"#999" }}>#{t.job_number}</span></p>
                  <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0" }}>📅 {dateOf(t)}{t.work_time ? "　🕒" + t.work_time : ""}</p>
                </div>
              </div>
              {/* 二重予約の警告（応募者シートと同じ判定＝lib/hire）。下調べ中はその旨を出す＝
                  「警告が無い」のか「まだ調べ終わっていない」のかを取り違えさせない */}
              {t.checking ? (
                <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 10px" }}>日程の重なりを確認中<Dots /></p>
              ) : t.dup ? (
                <p className="f-sans" style={{ fontSize:12, color:"#B54A0E", background:"#FFF6EE", border:"1px solid #F3D3B5", borderRadius:10, padding:"10px 12px", lineHeight:1.7, margin:"0 0 10px" }}>{doubleBookingWarning(t.dup)}</p>
              ) : null}
              {/* 契約成立＝本名の相互開示の明示（2026-07-30たきと裁定(B)・採用confirmに必ず入れる） */}
              <p className="f-sans" style={{ fontSize:12, color:"#555", background:"#F7F7F7", borderRadius:10, padding:"10px 12px", lineHeight:1.7, margin:"0 0 16px" }}>{HIRE_NAME_DISCLOSURE_NOTE}</p>
              <div style={{ display:"grid", gap:8 }}>
                <button onClick={runHire} disabled={hiring || t.checking} className="f-sans"
                  style={{ padding:"13px", fontSize:15, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: (hiring || t.checking) ? 0.5 : 1 }}>
                  {hiring ? <>採用しています<Dots /></> : "OK（採用する）"}
                </button>
                <button onClick={()=>setConfirmItem(null)} disabled={hiring} className="f-sans"
                  style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>やめる</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ 採用アニメーション（2026-08-06たきと指示） ═══
          🤝が押印のように現れ、輪が広がり、粒が弾ける。人生の節目（契約成立）を祝う一拍。
          人数に達して他の応募が見送りになった時だけ、読み落とさないよう閉じるまで残す */}
      {done && (() => {
        const auto = !done.extra;
        return (
          <div onClick={closeDone} className="cb-lock-scroll"
            style={{ position:"fixed", inset:0, zIndex:9300, background:"rgba(255,255,255,0.96)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
            <div style={{ position:"relative", width:180, height:180, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {[0, 1, 2].map(i => (
                <span key={i} aria-hidden style={{ position:"absolute", width:110, height:110, borderRadius:"50%", border:"3px solid #00A86B", animation:`cbHireRing 1.5s ease-out ${0.15 + i * 0.28}s both` }} />
              ))}
              {Array.from({ length: 12 }).map((_, i) => {
                const a = (i / 12) * Math.PI * 2;
                return (
                  <span key={"b" + i} aria-hidden style={{ position:"absolute", fontSize:16, ["--dx"]: Math.cos(a) * 92 + "px", ["--dy"]: Math.sin(a) * 92 + "px", animation:`cbHireBurst 1.1s ease-out ${0.2 + (i % 4) * 0.06}s both` }}>{i % 3 === 0 ? "🌾" : i % 3 === 1 ? "✨" : "🌸"}</span>
                );
              })}
              <span style={{ fontSize:78, lineHeight:1, animation:"cbHireSeal .7s cubic-bezier(.2,1.3,.4,1) both" }}>🤝</span>
            </div>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#00A86B", margin:"8px 0 0", animation:"cbHireText .5s ease .45s both" }}>採用しました</p>
            <p className="f-sans" style={{ fontSize:13, color:"#555", lineHeight:1.8, textAlign:"center", margin:"8px 0 0", animation:"cbHireText .5s ease .6s both" }}>
              {done.name ? done.name + "さん" : "応募者"}と #{done.jobNumber} の契約が成立しました。<br />作業日などの連絡はチャットでどうぞ。
            </p>
            {done.extra && (
              <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.8, textAlign:"center", maxWidth:380, background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:"14px 0 0", animation:"cbHireText .5s ease .7s both" }}>{done.extra}</p>
            )}
            {auto ? <AutoClose onDone={closeDone} /> : (
              <button onClick={closeDone} className="f-sans"
                style={{ marginTop:18, padding:"11px 26px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", animation:"cbHireText .5s ease .8s both" }}>閉じる</button>
            )}
          </div>
        );
      })()}
    </>
  );
}

// 演出を一定時間で自動的に閉じる（タップでも閉じられる）。※モジュールレベル定義を維持すること
function AutoClose({ onDone, ms = 2600 }) {
  // 呼び出し側が毎回新しい関数を渡してもタイマーを張り直さない（refに最新を持たせる）
  const cb = useRef(onDone); cb.current = onDone;
  useEffect(() => { const id = setTimeout(() => cb.current?.(), ms); return () => clearTimeout(id); }, [ms]);
  return null;
}

// #/calendar：ナビ4番「📆 今日」。きょうの契約済み仕事＋つぎの予定（向こう7日）。
// カレンダーは各役割の面へ移植（農家＝応募者ページ／働き手＝ステータスページ・2026-07-27）。
// 両役（働き手・農家）を持つ人だけ役割タブを出す。タブはこのページの表示だけを切替（全体モードは変えない）。
export function TodayPage({ me, defaultRole }) {
  // 前回この面が出した内容をまず描く→裏で最新に差し替える（stale-while-revalidate・2026-07-27たきと指示）
  const [loading, setLoading] = useState(() => getCache("today:entries") === undefined);
  const [entries, setEntries] = useState(() => getCache("today:entries") ?? []);
  const [hasWorker, setHasWorker] = useState(() => getCache("today:roles")?.w ?? false);
  const [hasFarmer, setHasFarmer] = useState(() => getCache("today:roles")?.f ?? false);
  const [role, setRole] = useState(defaultRole === "farmer" ? "farmer" : "worker");
  // 仮配置の骨を測るref：役割で箱の数が違うので鍵も分ける（働き手／農家）
  const skelRef = useSkeletonProbe("today:" + role);
  const [todos, setTodos] = useState(() => getCache("today:todos") ?? []);     // やることフィード（my_todo_items・状態カードの単一ソース）
  // jobCount（自分が出した求人の数）のstateは廃止（2026-08-03）：カレンダー箱のタップ可否判定が
  // 唯一の読み手だったが、タップ不能を全廃したため不要になった。求人の有無は下の f（農家か）の算出で今も使う
  const [hiredIds, setHiredIds] = useState(() => new Set(getCache("today:hired") ?? [])); // 採用済み（両者の確認が揃った）自分の応募ID
  // 画面の状態→キャッシュの写し（2026-07-27）。やることは片付けると手元のstateだけから消えるため、
  // ここで一括して写す。読み込みが終わるまでは写さない（空を焼き付けない）
  useEffect(() => { if (loading) return; setCache("today:todos", todos); }, [todos, loading]);
  const [confirming, setConfirming] = useState("");
  // 打刻の修正申請（第13弾(2)）：自分が承認する側のpendingを直接読む。
  // my_todo_items（RETURNS TABLE・固定型）は触らず、件数はDB側のmy_nav_badges が todo に加算済み
  const [corrections, setCorrections] = useState([]);
  const [punchFacts, setPunchFacts] = useState({}); // application_id → 打刻の事実（申告フラグ・双方の署名時刻）
  const [corrApp, setCorrApp] = useState(null);     // 乖離からの修正申請（シートは共通部品・双方から出せる）
  const [corrDeciding, setCorrDeciding] = useState("");
  // 承認／見送り。片付いたらカードが消える＝やることの件数・ナビのバッジと一致し続ける。
  // 申請者自身は承認できない（RPCが 'self' で拒否し message を返すので、それをそのまま出す）
  const decideCorrection = async (c, approve) => {
    if (corrDeciding) return;
    setCorrDeciding(c.id);
    try {
      const { data, error } = await supabase.rpc("decide_time_correction", { p_id: c.id, p_approve: approve });
      if (error) { alert("処理に失敗しました：" + error.message); setCorrDeciding(""); return; }
      if (!data?.ok) { alert(data?.message || ("処理できませんでした：" + (data?.reason || "不明"))); setCorrDeciding(""); return; }
      setCorrections(prev => prev.filter(x => x.id !== c.id));
      window.dispatchEvent(new Event("cb:unreadRefresh"));   // ナビのやることバッジを取り直す
    } catch (e) { alert("処理に失敗しました：" + (e?.message || "不明")); }
    setCorrDeciding("");
  };
  const [memo, setMemo] = useState(() => { try { return localStorage.getItem("cb_todayMemo") || ""; } catch { return ""; } }); // 私的メモ（端末内・本人のみ）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        // 6本とも互いに独立なので1回で同時に投げる（2026-07-27たきと指示「直列を並列に」）。
        // 以前はカレンダー→やること→残り4本の3段階で待っていた
        const [{ data }, { data: td }, { data: wp }, { count: jc }, { data: ep }, { data: apps }, { data: facts }, { data: corr }] = await Promise.all([
          supabase.rpc("get_my_calendar_jobs"),
          supabase.rpc("my_todo_items"),
          supabase.from("worker_profiles").select("auth_id").eq("auth_id", session.user.id).maybeSingle(),
          supabase.from("jobs").select("job_number", { count: "exact", head: true }).eq("farmer_id", session.user.id),
          supabase.from("employer_profiles").select("auth_id").eq("auth_id", session.user.id).maybeSingle(),
          // 採用の判定に要る時刻。採用してもstatusは'approved'のままなので（contractedは表示用の値で
          // DBには書かれない・CLAUDE.md）、両者の確認時刻で見るしかない。get_my_calendar_jobsは
          // この2列を返さないため、自分の応募から直に引く（当事者RLSの内側・2026-07-27）
          supabase.from("applications")
            .select("id,status,terms_confirmed_worker_at,terms_confirmed_farmer_at")
            .eq("worker_id", session.user.id),
          // 打刻の事実（第13弾・追補）：申告フラグと双方の署名時刻。両役割ぶんをまとめて取る
          // （RLSで当事者の行だけ返る）。get_my_calendar_jobs/my_todo_items は返さない列なので直に読む
          supabase.from("applications")
            .select("id,started_at,farmer_confirmed_start_at,work_completed_at,worker_confirmed_end_at,started_declared,ended_declared,time_corrected")
            .or(`worker_id.eq.${session.user.id},farmer_id.eq.${session.user.id}`)
            .then(r => r, () => ({ data: [] })),
          // 自分が承認する側の打刻修正（申請者自身には出さない＝RPC側でも拒否される）
          supabase.from("attendance_corrections")
            .select("id,application_id,proposed_started_at,proposed_ended_at,reason,created_at,applications(job_number)")
            .eq("status", "pending").neq("requested_by", session.user.id)
            .order("created_at", { ascending: false })
            .then(r => r, () => ({ data: [] })),
        ]);
        if (cancelled) return;
        const rows = data || [];
        setEntries(rows); setCache("today:entries", rows);
        setTodos(td || []);
        const w = !!wp || rows.some(e => e.my_role === "worker");
        const f = (jc || 0) > 0 || !!ep || rows.some(e => e.my_role === "farmer");
        setHasWorker(w); setHasFarmer(f);
        setCache("today:roles", { w, f });
        const hired = (apps || [])
          .filter(a => a.terms_confirmed_worker_at && a.terms_confirmed_farmer_at
                    && !["rejected","expired","completed"].includes(a.status))
          .map(a => a.id);
        setHiredIds(new Set(hired)); setCache("today:hired", hired);
        setCorrections(corr || []);
        setPunchFacts(Object.fromEntries((facts || []).map(f => [f.id, f])));
        // 既定ロールが持っていない側なら、持っている側へ寄せる
        setRole(r => (r === "worker" && !w && f) ? "farmer" : (r === "farmer" && !f && w) ? "worker" : r);
      } catch {}
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const todayYmd = ymdLocal(new Date());
  const in7Ymd = ymdLocal(calAddDays(7));
  const mine = entries.filter(e => e.my_role === role && e.relation === "application");
  // 当日判定（2026-07-24 追記3）：agreed_dates（確定した働く日）があれば当日∈agreed_dates、無ければ従来の期間判定
  const hasAgreed = (e) => Array.isArray(e.agreed_dates) && e.agreed_dates.length > 0;
  const isTodayJob = (e) => e.date_start && (hasAgreed(e) ? e.agreed_dates.includes(todayYmd) : (e.date_start <= todayYmd && todayYmd <= (e.date_end || e.date_start)));
  const todayJobs = mine
    .filter(isTodayJob)
    .sort((a, b) => (a.work_time || "").localeCompare(b.work_time || ""));
  // きょうの仕事の分解（2026-07-25たきと指示・同日改定）：1箱でなく役割ごとの箱に分ける。
  // 確認カード（現場情報）／緊急連絡（当日の遅刻・欠勤・中止）／きょうのチャット（相手との連絡）
  const tCard = todayJobs.map(e => ({ ...e, stage: "t_card" }));
  // 採用済み（契約〜作業中）の仕事は、作業日でなくても緊急連絡・開始の入口を開ける（2026-07-27たきと指示）。
  // 遅刻・欠勤・中止の連絡は前日にもしたいし、開始ページは採用が決まった時点で見たいため
  // 採用済み＝両者の確認が揃った応募（status='approved'のまま採用になる。帯のappPhaseKeyと同じ判定）。
  // statusだけで見ると採用済みが拾えず、緊急連絡・開始の箱が薄いままだった（2026-07-27たきと報告）
  const hiredMine = mine.filter(e => e.application_id
    && (hiredIds.has(e.application_id) || ["contracted","working"].includes(e.application_status)));
  // 作業が開始された仕事（開始打刻でstatusがworkingになる）＝終了の箱も開ける（2026-07-27たきと指示）
  const startedMine = mine.filter(e => e.application_id && e.application_status === "working");
  const tEmergency = (() => {
    const seen = new Set(); const out = [];
    [...todayJobs.filter(e => e.application_id), ...hiredMine].forEach(e => {
      if (seen.has(e.application_id)) return;
      seen.add(e.application_id);
      out.push({ ...e, stage: "t_emergency" });
    });
    return out;
  })();
  const todayStageItems = (st) => st === "t_card" ? tCard : st === "t_emergency" ? tEmergency : null; // t_chatは削除（2026-07-25）
  const upcoming = mine
    .filter(e => e.date_start && e.date_start > todayYmd && e.date_start <= in7Ymd)
    .sort((a, b) => (a.date_start || "").localeCompare(b.date_start || "") || (a.work_time || "").localeCompare(b.work_time || ""));
  const dual = hasWorker && hasFarmer;
  // 用件ごとの専用ページ（2026-07-25たきと指示）：#/calendar/todo/{stage}。ボックスタップで遷移・←で今日へ戻る。
  // ★宣言位置：下のスワイプeffectが[pageStage]依存を持つため、effectより前に置く（no-use-before-define対策・2026-08-02）
  const readTodoStage = () => { const mt = window.location.hash.replace(/^#\/?/, "").match(/^calendar\/todo\/([a-z_]+)$/); return mt ? mt[1] : null; };
  const [pageStage, setPageStage] = useState(readTodoStage());
  useEffect(() => {
    const on = () => setPageStage(readTodoStage());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // 横スワイプで働き手⇄農家（雇い手）を切替（両役持ちのみ・2026-07-25）。
  // なめらか化（同日改修）：①追従はsetStateせずDOMのtransformを直接書く（毎フレーム再レンダーを排除）
  // ②ジェスチャ開始8pxで縦/横を1回だけ判定する方向ロック（縦と誤認識しない）
  // ③容器にtouch-action:pan-y＋横ロック中はpreventDefault（縦スクロールとの奪い合いを断つ。ReactのonTouchMoveは
  //   passiveでpreventDefault不可のため、ネイティブリスナーを{passive:false}で張る）
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const gestureRef = useRef(null); // { x, y, lock:'h'|'v'|null }
  const roleRef = useRef(role); roleRef.current = role;
  const dualRef = useRef(dual); dualRef.current = dual;
  const [slideDir, setSlideDir] = useState(0); // 切替後のスライドイン方向（1=右から・-1=左から）
  const [slideKey, setSlideKey] = useState(0); // key更新でアニメを再生
  const switchRole = (target) => {
    if (target === roleRef.current) return;
    setSlideDir(target === "farmer" ? 1 : -1); // タブ並び：左=働き手・右=農家
    setSlideKey(k => k + 1);
    setRole(target);
  };
  const switchRoleRef = useRef(switchRole); switchRoleRef.current = switchRole;
  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const onStart = (ev) => {
      // オーバーレイ（下からのシート・モーダル＝.cb-lock-scroll）内で始まったタッチは奪わない
      // （緊急連絡ページのボックス展開中に背後の役割が切り替わる事故の防止・2026-08-02）
      if (ev.target && ev.target.closest && ev.target.closest(".cb-lock-scroll")) { gestureRef.current = null; return; }
      const t = ev.touches[0]; if (t) gestureRef.current = { x: t.clientX, y: t.clientY, lock: null };
    };
    const onMove = (ev) => {
      const g = gestureRef.current; if (!g || !dualRef.current) return;
      const t = ev.touches[0]; if (!t) return;
      const dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 8px動くまで判定保留
        g.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";  // 1ジェスチャ1回だけ軸を確定
      }
      if (g.lock !== "h") return; // 縦確定＝以後ノータッチ（ブラウザのスクロールに完全に譲る）
      ev.preventDefault();
      const c = contentRef.current; if (!c) return;
      const target = dx < 0 ? "farmer" : "worker";
      const damp = target === roleRef.current ? 0.12 : 0.4; // 行き先が無い方向は強い抵抗（端の感触）
      c.style.transition = "none";
      c.style.transform = `translateX(${Math.max(-100, Math.min(100, dx * damp))}px)`;
    };
    const onEnd = (ev) => {
      const g = gestureRef.current; gestureRef.current = null;
      if (!g || g.lock !== "h") return;
      const c = contentRef.current;
      const t = ev.changedTouches && ev.changedTouches[0];
      const dx = t ? t.clientX - g.x : 0;
      const target = dx < 0 ? "farmer" : "worker";
      if (Math.abs(dx) >= 50 && target !== roleRef.current) {
        if (c) { c.style.transition = ""; c.style.transform = ""; }
        switchRoleRef.current(target); // key更新で新コンテンツがスライドイン
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
    // pageStage依存（2026-08-02）：本体⇄専用ページでrootの実DOMが差し替わるため、
    // 遷移のたびに現在のroot（本体 or 緊急連絡ページ）へリスナーを張り直す
  }, [pageStage]);
  const accent = role === "worker" ? ROLE_ORANGE : ROLE_GREEN;
  // 役割タブ（両役を持つ人だけ・タップでも切替可）：今日ページ本体と緊急連絡の専用ページで共用（2026-08-02）。
  // 構造は求人タブ（作成中⇄公開中）と同型＝横幅いっぱい均等・白地・選択中は太枠＋太字。枠色のみ役割カラー
  const roleTabsRow = dual ? (
    <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
      {[{ k:"worker", l:"働き手", c:ROLE_ORANGE }, { k:"farmer", l:"農家", c:ROLE_GREEN }].map(t => (
        <button key={t.k} onClick={()=>switchRole(t.k)} className="f-sans" style={{
          flex:1, padding:"11px 0", borderRadius:12, cursor:"pointer", background:"#fff",
          border: role === t.k ? "2px solid " + t.c : "1px solid #EBEBEB",
          fontSize:14, fontWeight: role === t.k ? 800 : 600,
          color: role === t.k ? t.c : "#999",
        }}>{t.l}</button>
      ))}
    </div>
  ) : null;

  // TodayCardコンポーネントは削除（2026-07-25統合）：役割はstage="today"の行（チャット主ボタン・⚠️緊急連絡・求人チップ）へ

  // ── やること（採配台）：状態カード。①②⑧=遷移／③〜⑦=直接実行（保険・開始確認はインライン、日程決定・完了/評価は既存モーダルへ橋渡し） ──
  const removeTodo = (id, st) => setTodos(prev => prev.filter(t => !(t.application_id === id && t.stage === st)));
  const TODO_META = {
    // カレンダー（2026-07-27たきと指示：確認カードをカレンダーに差し替え・統合）：
    // 応募（予定）が1件でもあれば件数0でも常にタップ可＝月カレンダーへ直行。バッジ＝きょうが作業日の仕事の数。
    // 現場情報の確認はカレンダーの日タップ→求人ページで担う（確認カードの役割を吸収）
    // 遷移先は「その役割のカレンダーが載っている面」＝農家は応募者ページ／働き手はステータスページ。
    // どちらも上部にカレンダーを展開して着地する（合図＝cb_openCalendar・2026-07-27たきと指示）。
    // 月カレンダー単独のページ(#/calendar/month)は廃止した
    t_card:      { icon:"📅", title:"カレンダー",           btn:"カレンダー →",     always:true,
                   desc:"応募した仕事・自分の求人の予定を、月のカレンダーで見られます。予定が入ると、日をタップしてその日の仕事を確認できます。",
                   nav: () => {
      try { sessionStorage.setItem("cb_openCalendar", "1"); } catch {}
      return role === "farmer" ? "/profile/employer/applicants" : "/saved";
    } },
    t_emergency: { icon:"⚠️", title:"緊急連絡",             btn:"緊急連絡 →",       nav: e => "/emergency/" + e.application_id,
                   desc:"遅刻・欠勤・中止など、作業当日の急な連絡をする窓口です。採用が決まった仕事から使えます。" },
    // t_chat（きょうのチャット）・chat（未読メッセージ）は削除（2026-07-25たきと指示・両役割）：
    // 未読の案内は下部ナビ「チャット」タブのバッジ＋プッシュ通知＋トーストが担い、今日は自分のアクションだけに絞る
    revision:    { icon:"📝", title:"求人に修正のお願い",   btn:"修正する →",       nav: e => "/work/edit/" + e.job_number,
                   desc:"運営から求人内容の修正のお願いが届いたとき、ここから直して再申請します。" },
    // 求人への質問（2026-07-27たきと指示）：公開Q&A（job_questions）の未回答＝求人カードの❓Nと同じ母集団。
    // 1行=1質問（質問者のアイコン・名前＋その求人のチップ）。行き先は求人詳細の「質問」タブ
    question:    { icon:"💬", title:"求人への質問",         btn:"回答する →",
                   desc:"あなたの求人に届いた質問に回答します。回答は求人ページに公開されます。", nav: e => {
      // 出どころ＝カレンダー（今日）：求人詳細の浮遊「←戻る」ボックスを出さない目印（2026-07-27たきと指示）
      try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {}
      return "/work/job/" + e.job_number + "/questions"; // タブ指定つきURL（リロードしても質問タブのまま）
    } },
    // 新着の応募（2026-07-26たきと指示・同日改定）：タップでお祝いパネル（NewApplicantsPanel）を展開。
    // 行タップで応募者ページへ「応募中」フィルタ着地＝どの求人に誰が応募したかを応募者ページの求人カード設計で見せる
    // 行き先は新着の応募ページ（#/new-applicants・2026-08-05たきと指示で新設）に変更。
    // 応募を受けた雇い手のための専用ページ＝サイトを開いた時の着地先と同じ面に揃える
    // （そこから応募者シート＝承認・見送りの唯一の窓口へ送られる）
    approve:     { icon:"📨", title:"新着の応募",           btn:"確認して承認 →",
                   desc:"あなたの求人に新しく届いた応募を確認します。承認すると面接に進めます。",
                   nav: () => "/new-applicants" },
    // decide_dates（働く日を決める）は廃止（2026-07-24たきと確定）：日程宣言なしもいつでもOKも全期間working前提。
    // 日程変更が必要な時だけ応募者ページの働く日モーダル（set_agreed_dates・cb_agreeAppId着地は温存）で行う
    // interview/hire（2026-07-25たきと指示）：チャットの質問集シート・採用ボタンを今日のリストへ移設。
    // チャットは「アクションの報告（自動送信）＋直接やりとりが必要な時だけ」の最小役割に寄せていく
    interview:   { icon:"❓", title:"面接の質問を送る",     btn:"質問を送る →",     qset:true,
                   desc:"承認した応募者に面接の質問を送ります。質問と回答はチャットに証跡として残ります。" },
    // 採用する（2026-07-27たきと指示）：その場実行をやめ、応募者ページの「面接中」タブへ直行。
    // 採用の実行は応募者シートの🤝採用するボタン（二重予約警告つき）が担う
    // 2026-08-06：専用ページを応募者単位のカードに刷新（HireStagePanel）。行き先も一覧でなく
    // 「その応募のシート」へ＝どの応募者を採用するのかを取り違えない（cb_openApplicantId・新着の応募ページと同じ作法）
    hire:        { icon:"🤝", title:"採用する",             btn:"採用する →",
                   desc:"面接を終えた応募者を採用します。実行は応募者ページの🤝採用するボタン（二重予約の警告つき）です。",
                   nav: (e) => { markHireSheet(e?.application_id); return HIRE_SHEET_PATH; } },
    insurance:   { icon:"🛡", title:"保険の準備の報告",     btn:"準備したと報告",   rpc:"confirm_insurance",
                   desc:"作業前に、保険の準備ができたことを報告します。報告した時刻が記録に残ります。" },
    // 開始を確認／来なかった の2択（2026-07-30たきと指摘「働き手がこなかった場合の措置がない」）。
    // 来なかった時に「開始を確認」しか道が無いのは、事実と違う記録を迫ることになる。altは
    // 応募者ページの完了モーダル（働き手は来ましたか？→来なかった＝欠勤記録・72時間の異議申立つき）へ直行する
    confirm_start:{ icon:"✓", title:"作業の開始を確認",     btn:"開始を確認",       rpc:"confirm_start",
                   desc:"働き手が現場に来て作業が始まったことを確認します。来なかった場合の記録もここからできます。",
                   alt: { label:"来なかった", flag:"cb_completeAppId", to:"/profile/employer/applicants",
                          before: () => { try { sessionStorage.setItem("cb_appFilter", "active"); } catch {} } } },
    // review（評価する）はcompleteへ統合（2026-07-25たきと指示）：完了記録がまだ／評価だけ残り（3日以内）の
    // 両方をmy_todo_itemsが'complete'として返す。行き先は同じ完了モーダル（完了記録→評価の一連）
    // 完了して評価する（2026-07-27たきと指示）：ボックスタップで応募者ページの「完了」タブへ直行。
    // 行タップ（専用ページ経由）でも同じ着地。cb_completeAppId は評価モーダルの自動展開用に併せて渡す
    complete:    { icon:"✅", title:"完了して評価する",     btn:"完了・評価 →",     flag:"cb_completeAppId", to:"/profile/employer/applicants",
                   desc:"作業の完了を記録して、働き手を評価します。完了の記録から3日以内は評価だけ後からもできます。",
                   before: () => { try { sessionStorage.setItem("cb_appFilter", "completed"); } catch {} } },
    // w_waiting（返事待ち）は廃止（2026-07-25たきと指示）：やることリストは当人のアクションが前提。
    // 返事待ちは相方（農家）のアクション待ち＝思想が違う。応募状況の確認は応募状況ページが担う
    // w_confirm（求人内容の確認）は廃止（2026-07-25たきと指示）：内容を確認した上で応募するのが前提。
    // 応募INSERT時にterms_confirmed_worker_atをDBトリガーが自動記録。日程の申請（チャットの候補日）は残す
    // 求職の修正（2026-07-27たきと指示・枠のみ先行）：農家側 revision の働き手版。
    // 求職カード（求職一覧＝Phase2b）の実装後に、運営からの修正依頼をmy_todo_itemsが返す想定。
    // 中身（遷移先・実行内容）は未定so nav/rpc は持たせない＝現状は常に「該当なし」の薄い箱として並ぶ
    w_revision:  { icon:"📝", title:"求職に修正のお願い", btn:"修正する →",
                   desc:"運営から求職内容の修正のお願いが届いたとき、ここから直します。" },
    w_interview: { icon:"✍️", title:"面接の回答",           btn:"返事する",
                   desc:"農家から届いた面接の質問に、その場で返事します。返信はチャットにも残ります。" }, // 農家の【面接の質問】にここで返事（専用パネル・返信はチャットにも残る）
    // w_start（作業を開始する）は廃止（2026-07-27たきと指示）：開始時刻が来たらDB側のcron
    // auto_start_work() が自動で開始を記録するため、働き手に押させる箱を置かない
    // 採用済みなら終了の箱も開ける（2026-07-27たきと指示）。行き先は件数に依らず同じso直行(direct)
    w_review:    { icon:"⭐", title:"終了を確認して評価",   btn:"評価ページへ →",   nav: () => "/profile/worker/approved",
                   desc:"仕事の終了を確認して、農家を評価します。評価は承認済みの応募一覧から行います。" },
  };
  // アクションボックス（2026-07-25・プロフィール入口カードと同型）：用件（stage）ごとに絵文字ボックスを横2列配置。
  // 右上=放置数バッジ。タップで下に対象一覧（働き手アイコン＋ニックネーム＋求人チップ＋実行ボタン）が展開。
  // A案（2026-07-24たきと確定）：農家タブ＝働き手を出す／働き手タブ＝相手（農家）名は出さない（求人チップで識別）
  const todoKey = (t) => t.application_id || ("j" + t.job_number);
  // 面接の回答を送信してリストが空になった時は「送信完了しました。」を出す（2026-07-26たきと指示。ページを離れたらリセット）
  const [answeredDone, setAnsweredDone] = useState(false);
  useEffect(() => { setAnsweredDone(false); }, [pageStage]);
  const TODO_BOX_LABEL = { insurance: "保険の報告", interview: "面接する", revision: "求人の修正", w_revision: "求職の修正", question: "質問に答える" }; // ボックス用の短縮ラベル（未定義はm.titleのまま。hireはタイトル「採用する」をそのまま表示）
  // 役割ごとの全用件カタログ（ボックスは常時表示。該当ありは上位・該当なしは薄く下位に並ぶ。並びは正規フロー順）
  const TODO_STAGE_CATALOG = {
    farmer: ["t_card", "t_emergency", "revision", "question", "approve", "interview", "hire", "insurance", "confirm_start", "complete"],
    worker: ["t_card", "t_emergency", "w_revision", "w_interview", "w_review"],
  };
  // 専用ページを開いたら役割をその用件側へ合わせる（accent・パネルの表示条件が追従）
  useEffect(() => {
    if (!pageStage) return;
    if (pageStage.startsWith("t_")) return; // きょうの仕事系は両役共通＝現在の役割のまま
    const pr = TODO_STAGE_CATALOG.worker.includes(pageStage) ? "worker" : "farmer";
    if (role !== pr) setRole(pr);
  }, [pageStage, role]);
  // hireDoubleBookingCheck・m.hire分岐は削除（2026-07-27）：採用の実行は応募者シートへ移設（二重予約警告もそちらが持つ）
  const runTodo = async (m, e) => {
    const busyKey = (e.application_id || e.job_number) + e.stage;
    if (m.nav) { window.location.hash = m.nav(e); return; }
    if (m.flag) { if (m.before) m.before(); try { sessionStorage.setItem(m.flag, e.application_id); } catch {} window.location.hash = m.to; return; }
    // 面接の質問（チャットからの移設）：チャットに着地して質問集シートを自動で開く（回答は面接の証跡としてチャットに残る）
    if (m.qset) { try { sessionStorage.setItem("cb_openQSet", "1"); } catch {} window.location.hash = "/chat/" + e.application_id; return; }
    if (m.rpc) {
      if (confirming) return; setConfirming(busyKey);
      const { data, error } = await supabase.rpc(m.rpc, { p_application_id: e.application_id });
      setConfirming("");
      if (error || !data?.ok) { alert("処理に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
      removeTodo(e.application_id, e.stage);
    }
  };
  const TodoStageBox = ({ stage, items }) => {
    const m = TODO_META[stage]; if (!m) return null;
    const n = items.length;
    // 各ボックス＝専用ページ(#/calendar/todo/{stage})へのリンクに統一（2026-08-02たきと指示
    // 「各ボックスの遷移先を新設。リンクも新設」）。1件直行・direct直行は廃止＝
    // 実行・個別遷移は専用ページの行が担う。カレンダー（always）だけはカレンダー面へ直行（専用ページを挟まない）。
    // ★タップ不能は全廃（2026-08-03たきと指示）：どのボックスも常に開ける。
    //   薄表示は「いま用事が無い」の目印としてのみ残す（押せなさの表現ではない）
    // ★なにもなければ説明文を明記（2026-08-03たきと指示）：行き先が空っぽの面だと
    //   「なぜ何も無いのか」が分からないため、カレンダーも予定がゼロの時は専用ページ
    //   （用件の説明＋空状態）へ送る。予定があるときだけカレンダー面へ直行する
    const calendarReady = entries.some(e => e.my_role === role) || mine.length > 0;
    const dim = n === 0;
    const onTapBox = () => {
      if (m.always && calendarReady) { window.location.hash = m.nav(); return; }
      window.location.hash = "/calendar/todo/" + stage;
    };
    return (
      <button onClick={onTapBox} className="f-sans" style={{
        position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:18,
        padding:"24px 10px 18px", textAlign:"center", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.04)",
        opacity: dim ? 0.45 : 1,
      }}>
        {n > 0 && <span aria-label={"残り" + n + "件"} style={{ position:"absolute", top:10, right:10, minWidth:24, height:24, borderRadius:12, background:"#00A86B", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 7px" }}>{n}</span>}
        <span style={{ display:"block", fontSize:40, lineHeight:1, marginBottom:10 }}>{m.icon}</span>
        <span style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{TODO_BOX_LABEL[stage] || m.title}</span>
      </button>
    );
  };
  // 展開パネル：タップしたボックスの対象一覧（1行=誰・どの求人・実行ボタン）
  // ボックス内タイトル・左端の役割色バーは廃止（2026-07-26たきと指示：見出しはページヘッダーが担う・属性分け不要）
  const TodoStagePanel = ({ stage, items }) => {
    const m = TODO_META[stage]; if (!m) return null;
    return (
      <div style={{ gridColumn:"1 / -1", border:"1px solid #EBEBEB", borderRadius:12, background:"#fff", padding:"12px 14px" }}>
        <div style={{ display:"grid", gap:8 }}>
          {items.map(t => {
            const busy = confirming === (t.application_id || t.job_number) + t.stage;
            const jobChip = [t.job_number ? "#" + t.job_number : "", [t.crop, t.task].filter(Boolean).join(" "), (stage.startsWith("t_") && t.work_time) ? "🕒" + t.work_time : ""].filter(Boolean).join(" ");
            // 打刻の事実（第13弾・追補）：申告フラグと双方の署名時刻の開き。隠さず、この行の下に添える
            const pf = punchFacts[t.application_id];
            return (
              <div key={todoKey(t)} style={{ display:"grid", gap:6, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                {role === "farmer" && t.partner_name ? (
                  /* ニックネームはアイコンの下（2026-07-26たきと指示） */
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, flexShrink:0, maxWidth:64 }}>
                    <Avatar url={t.partner_avatar} name={t.partner_name} size={36} bg={ROLE_ORANGE} />
                    <span className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#222", maxWidth:64, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.partner_name}さん</span>
                  </div>
                ) : null}
                {/* 求人チップはタップで求人ページへ（確認前に内容を見られる） */}
                {jobChip && <button onClick={()=>{ if (!t.job_number) return; try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + t.job_number; }} className="f-sans" style={{ flexShrink:1, minWidth:0, fontSize:11, fontWeight:600, color:"#717171", background:"#F7F7F7", border:"none", borderRadius:8, padding:"4px 8px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }}>{jobChip}</button>}
                <span style={{ flex:1 }} />
                {/* 副の選択肢（今のところ「来なかった」だけ）。主の隣に控えめに置く */}
                {m.alt && (
                  <button onClick={()=>runTodo(m.alt, t)} disabled={busy} className="f-sans" style={{ flexShrink:0, padding:"8px 10px", fontSize:12, fontWeight:700, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:9, cursor:"pointer", whiteSpace:"nowrap" }}>{m.alt.label}</button>
                )}
                <button onClick={()=>runTodo(m, t)} disabled={busy} className="f-sans" style={{ flexShrink:0, padding:"8px 12px", fontSize:12, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:9, cursor:"pointer", whiteSpace:"nowrap", opacity: busy ? 0.6 : 1 }}>{busy ? "..." : m.btn}</button>
              </div>
              {/* 契約成立後のみ相手の本名を開示（当事者間・KYC非複製・2026-07-30たきと裁定(B)） */}
              {t.application_id && <ContractPartyName applicationId={t.application_id} showPending={false} style={{ margin:0, paddingLeft:2 }} />}
              {pf && (pf.started_declared || pf.ended_declared) && (
                <span><DeclaredBadge show label={(pf.started_declared ? "開始" : "終了") + "は圏外で申告された時刻"} /></span>
              )}
              {/* 導線は双方に出す（2026-07-30たきと訂正）。文言だけ立場で変える */}
              {pf && <PunchGapNotice app={pf} onRequestCorrection={()=>setCorrApp(pf)}
                correctionLabel={role === "worker" ? "🕐 自分の打刻を直す → 修正を申請" : "🕐 実際と違う場合は → 修正を申請"} />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const UpcomingRow = ({ e }) => {
    const label = e.date_end && e.date_end !== e.date_start ? `${calFmtDate(e.date_start)}〜${calFmtDate(e.date_end)}` : calFmtDate(e.date_start);
    return (
      <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + e.job_number; }}
        className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, width:"100%", textAlign:"left", background:"#fff", border:"1px solid #F0F0F0", borderLeft:"3px solid " + accent, borderRadius:10, padding:"11px 12px", cursor:"pointer" }}>
        <span style={{ minWidth:0, overflow:"hidden" }}>
          <span style={{ display:"block", fontSize:13, fontWeight:600, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[e.crop, e.task].filter(Boolean).join(" ") || "求人"} <span style={{ color:"#999", fontWeight:700, fontSize:11 }}>#{e.job_number}</span></span>
          <span style={{ display:"block", fontSize:11, color:"#999", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>📅 {label}{e.work_time ? "　" + e.work_time : ""}{role === "farmer" && e.partner_name ? "　" + e.partner_name : ""}</span>
        </span>
        <span style={{ color:"#C8C8C8", fontSize:16, flexShrink:0 }}>›</span>
      </button>
    );
  };

  // ── 用件の専用ページ（#/calendar/todo/{stage}）：ボックスタップの行き先。←で今日へ戻る ──
  if (pageStage && TODO_META[pageStage]) {
    const pm = TODO_META[pageStage];
    const pItems = todayStageItems(pageStage) || todos.filter(t => t.stage === pageStage);
    // 緊急連絡は農家と働き手でページを分ける（2026-08-02たきと指示）：役割タブ＋横スワイプ（指連動）で切替。
    // スワイプ機構は今日ページ本体と同一（rootRefのネイティブリスナー＋contentRefへのtransform直書き＝
    // 指に追従・50px以上で切替成立・slideKey更新でスライドイン・両役持ちのみ）。他の用件ページは従来どおり単ページ
    const swipeStage = pageStage === "t_emergency";
    return (
      <div ref={swipeStage ? rootRef : undefined}
        style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px", ...(swipeStage ? { overflowX:"hidden", touchAction:"pan-y" } : {}) }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 0 16px" }}>
          <button onClick={()=>{ window.location.hash = "/calendar"; }} aria-label="今日へ戻る" className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:20, cursor:"pointer", padding:"4px 6px", lineHeight:1 }}>←</button>
          <h2 className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:18, fontWeight:800, color:"#222", margin:0, flex:1, minWidth:0 }}>
            <span style={{ fontSize:20 }}>{pm.icon}</span>{TODO_BOX_LABEL[pageStage] || pm.title}
          </h2>
          {/* 件数バッジは廃止（2026-07-26たきと指示：ページ内で通知は不要。件数は今日ページのボックスが示す） */}
        </div>
        {/* 農家⇄働き手の切替タブ（緊急連絡のみ・両役持ちのみ表示。スワイプと同じswitchRoleを共有） */}
        {swipeStage && roleTabsRow}
        {/* 用件の説明（2026-08-02新設）：全ボックスが専用ページへのリンクになったため、
            該当0件で開いても「何のページか」が分かるように各用件の一言説明を置く。
            ★空のときは下の空状態ボックス内に本文として大きく出す（2026-08-03たきと指示
            「なにもなければ説明文を明記」）ので、ここでは出さない＝二重に出さない */}
        {pm.desc && pItems.length > 0 && <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"-6px 0 16px", paddingLeft:38 }}>{pm.desc}</p>}
        <div key={swipeStage ? slideKey : "static"} ref={swipeStage ? contentRef : undefined}
          style={swipeStage && slideDir ? { animation: `${slideDir > 0 ? "cbSlideInR" : "cbSlideInL"} .28s ease` } : undefined}>
        {loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>
        ) : pItems.length === 0 ? (
          /* 空状態：説明文を明記する（2026-08-03たきと指示）。「いまありません」だけだと
             なぜ空なのか・いつここに何が来るのかが分からないため、用件の説明を本文として大きく出す */
          <div style={{ background:"#F7F7F7", borderRadius:14, padding:"28px 20px", textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:10 }}>{pm.icon}</div>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 8px" }}>{answeredDone ? "送信完了しました。" : "この用事はいまありません"}</p>
            {pm.desc && <p className="f-sans" style={{ fontSize:13, color:"#555", lineHeight:1.8, margin:"0 auto", maxWidth:420, textAlign:"left" }}>{pm.desc}</p>}
          </div>
        ) : pageStage === "approve" ? (
          <NewApplicantsPanel items={pItems} onTap={(t)=>runTodo(TODO_META.approve, t)} />
        ) : pageStage === "hire" ? (
          /* 採用するページは応募者ページと同じカード構造・ただし応募者単位（2026-08-06たきと指示）。
             🤝→最終確認→OKでその場で採用（ページ遷移しない）。片付いた応募はやることからも消す */
          <HireStagePanel items={pItems} meId={me?.id} onHired={(id)=>removeTodo(id, "hire")} />
        ) : pageStage === "t_emergency" ? (
          /* 緊急連絡はステータスページと同じカード構造（2026-08-02たきと指示） */
          <EmergencyStagePanel items={pItems} role={role} />
        ) : pageStage === "w_interview" ? (
          <InterviewReplyPanel items={pItems} accent={accent} onAnswered={(id)=>{ removeTodo(id, "w_interview"); setAnsweredDone(true); }} />
        ) : (
          <TodoStagePanel stage={pageStage} items={pItems} />
        )}
        </div>
        {corrApp && <TimeCorrectionSheet key={corrApp.id} app={corrApp} onClose={()=>setCorrApp(null)} />}
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px", overflowX:"hidden", touchAction:"pan-y" }}>
      {/* 見出し「📆 今日」は削除（2026-07-26たきと指示）。現在地は下部ナビの点灯が示すため冗長 */}
      {/* 役割タブ（両役を持つ人だけ・このページの表示だけ切替）。単役は非表示（roleTabsRow＝共通化・2026-08-02） */}
      {roleTabsRow}
      {/* 役割コンテンツ：ドラッグ追従はcontentRefへのtransform直書き（再レンダーなし）。切替成立時はkey更新でスライドイン再生 */}
      <div key={slideKey} ref={contentRef} style={{
        animation: slideDir ? `${slideDir > 0 ? "cbSlideInR" : "cbSlideInL"} .28s ease` : undefined,
      }}>
      {/* 読み込み中は仮配置（2026-07-27たきと指示）。このページは往復が多い
          （セッション→カレンダー→やること→プロフィール類）ので待ちが最も長い */}
      {loading ? (
        <AutoSkeleton shapeKey={"today:" + role} />
      ) : (<>
        {/* 【やること】採配台：状態カードを締切の近い順に。①②⑧=遷移／③〜⑦=直接実行。件数=今日タブのバッジ(todo)と一致 */}
        {(() => {
          // 最新順（sort_keyの新しい順・同日なら求人番号の新しい順）
          const myTodos = todos.filter(t => t.my_role === role && t.stage !== "w_start").sort((a, b) => (b.sort_key || "").localeCompare(a.sort_key || "") || (b.job_number || 0) - (a.job_number || 0));
          // 用件（stage）ごとに1箱へ集約。該当ありは最新順で上位、該当なしもカタログ順で常時表示（薄表示・タップ不可）
          const activeOrder = []; const byStage = new Map();
          [["t_card", tCard], ["t_emergency", tEmergency]].forEach(([st, arr]) => { if (arr.length) { byStage.set(st, arr); activeOrder.push(st); } }); // きょうの仕事系は常に先頭（t_chatは削除・2026-07-25）
          myTodos.forEach(t => { if (!byStage.has(t.stage)) { byStage.set(t.stage, []); activeOrder.push(t.stage); } byStage.get(t.stage).push(t); });
          // 「終了を確認して評価」は採用済みなら常に開ける（2026-07-27たきと指示）。
          // my_todo_itemsのw_reviewは農家の完了記録の後にしか出ないso、それを待たずに灯す。
          // 開始は自動（auto_start_work）になったため、開始済みがあればそれを優先して件数に出す
          const reviewItems = startedMine.length ? startedMine : hiredMine;
          if (role === "worker" && !byStage.has("w_review") && reviewItems.length) {
            byStage.set("w_review", reviewItems.map(e => ({ ...e, stage: "w_review" })));
            activeOrder.push("w_review");
          }
          const catalog = TODO_STAGE_CATALOG[role] || [];
          const stageOrder = [...activeOrder, ...catalog.filter(st => !byStage.has(st))];
          return (
            <div style={{ marginBottom:24 }}>
              {/* 件数は打刻修正の承認ぶんも足す＝ナビのバッジ(todo)と一致させる（my_nav_badgesも同じ加算） */}
              <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid " + accent, paddingLeft:8 }}>やること（{myTodos.length + corrections.length}）</p>
              {/* 打刻の修正の承認（第13弾(2)）：やることの最上部。相手が申請したものだけが並ぶ
                  （申請者自身には出さない＝RPC側でも拒否される）。片付けると消える＝バッジ数と一致する */}
              {corrections.length > 0 && (
                <div style={{ display:"grid", gap:10, marginBottom:12 }}>
                  {corrections.map(c => {
                    const hm = (ts) => ts ? new Date(ts).toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" }) : null;
                    const parts = [hm(c.proposed_started_at) && ("開始 " + hm(c.proposed_started_at)), hm(c.proposed_ended_at) && ("終了 " + hm(c.proposed_ended_at))].filter(Boolean);
                    return (
                      <div key={c.id} style={{ border:"1px solid #F5A623", background:"#FFF9EE", borderRadius:12, padding:"12px 14px" }}>
                        <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:"0 0 4px" }}>🕐 打刻の修正の申請が届いています</p>
                        <p className="f-sans" style={{ fontSize:12, color:"#444", margin:"0 0 2px", lineHeight:1.7 }}>
                          {c.applications?.job_number ? ("求人 #" + c.applications.job_number + "　") : ""}{parts.join("／") || "（時刻の指定なし）"}
                        </p>
                        {c.reason && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 8px", lineHeight:1.7, whiteSpace:"pre-wrap" }}>理由：{c.reason}</p>}
                        <div style={{ display:"flex", gap:8, marginTop:10 }}>
                          <button onClick={()=>decideCorrection(c, true)} disabled={corrDeciding===c.id} className="f-sans"
                            style={{ flex:1, padding:"9px 0", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", opacity: corrDeciding===c.id ? 0.5 : 1 }}>承認する</button>
                          <button onClick={()=>decideCorrection(c, false)} disabled={corrDeciding===c.id} className="f-sans"
                            style={{ flex:1, padding:"9px 0", fontSize:13, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #DDD", borderRadius:8, cursor:"pointer", opacity: corrDeciding===c.id ? 0.5 : 1 }}>見送る</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div ref={skelRef} style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:12 }}>
                {stageOrder.map(st => <TodoStageBox key={st} stage={st} items={byStage.get(st) || []} />)}
              </div>
            </div>
          );
        })()}
        {/* きょうの仕事の独立セクションは廃止（2026-07-25たきと指示）：stage="today"としてやることの箱へ統合。
            仕事がない日の「求人をさがす」導線だけ残す */}
        {todayJobs.length === 0 && upcoming.length === 0 && (
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <button onClick={()=>{ window.location.hash = "/search"; }} className="f-sans" style={{ padding:"10px 22px", fontSize:13, fontWeight:700, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#00A86B", cursor:"pointer" }}>求人をさがす →</button>
          </div>
        )}
        {upcoming.length > 0 && (
          <div style={{ marginBottom:24 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid #DDD", paddingLeft:8 }}>つぎの予定（7日以内）</p>
            <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:8 }}>
              {upcoming.map(e => <UpcomingRow key={e.application_id || e.job_number} e={e} />)}
            </div>
          </div>
        )}
        {/* 📝メモ（私的・端末内localStorage・本人のみ／DB非保存） */}
        <div style={{ marginBottom:24 }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid #DDD", paddingLeft:8 }}>📝 メモ</p>
          <textarea value={memo} onChange={e=>{ setMemo(e.target.value); try { localStorage.setItem("cb_todayMemo", e.target.value); } catch {} }} placeholder="自分用のメモ（この端末だけに保存されます）" rows={3} className="field f-sans" style={{ width:"100%", fontSize:14, resize:"vertical", boxSizing:"border-box" }} />
        </div>
        {/* 「📅 月の予定を見る」ボタンは削除（2026-07-27たきと指示）：やることのカレンダー箱に統合 */}
      </>)}
      </div>
      {corrApp && <TimeCorrectionSheet key={corrApp.id} app={corrApp} onClose={()=>setCorrApp(null)} />}
    </div>
  );
}
