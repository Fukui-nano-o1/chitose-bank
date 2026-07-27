// ステータス一覧（#/saved・分割・段階2後半・2026-07-24／2026-07-27に役割を刷新）：
// 働き手が「いいね」「応募」した求人と、その求人での自分の段階を確認する面。
// 2026-07-27たきと指示：雇い手の応募者ページと同じ構造（左=求人トップ写真＋タイトル/#No.／右=アイコン）に。
// ★アイコンは「自分のもの」だけ＝自分の応募がいまどの段階かを確認するための面。
//   他の働き手の情報（誰が応募しているか・人数）は取得も表示も一切しない（データ憲法・個人情報の最小化）。
// ★求人の供給源は my_job_actions()（SECURITY DEFINER・2026-07-27）。jobs_public は status='open' しか
//   含まないため、応募した求人が掲載終了すると一覧から消えていた（＝失効・完了の暗幕が出なかった）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, calFmtDate, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, CHAT_ELIGIBLE_STATUSES } from "../lib/utils";
import { openPhaseInfo } from "../lib/previewBus";
import { Avatar } from "./ui";

// ── SavedJobsView（ステータス一覧・#/saved） ──
export function SavedJobsView({ me }) {
  const [rows, setRows] = useState(null);           // my_job_actions() の行（求人＋自分の応募）
  const [myProfile, setMyProfile] = useState(null); // 自分のアイコン・ニックネーム
  const [boxJob, setBoxJob] = useState(null);       // 展開中のボックス（求人1件・応募者ページのシートと同じ作法）
  const [legendOpen, setLegendOpen] = useState(false); // 下部「ステータスの意味」の開閉（応募者ページの凡例と同じ）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [actRes, wpRes] = await Promise.all([
          supabase.rpc("my_job_actions"),
          supabase.from("worker_profiles").select("nickname,avatar_url").eq("auth_id", me.id).maybeSingle(),
        ]);
        if (cancelled) return;
        setRows(actRes.data || []);
        setMyProfile(wpRes.data || null);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, [me?.id]);

  // いいね解除。応募のある求人はステータス確認のため一覧に残す（消えるのは「いいねだけ」の求人）。
  // 誤タップ救済に「元に戻す」を10秒出す（2026-07-27）
  const [undoJob, setUndoJob] = useState(null);
  const handleUnsave = async (r) => {
    setRows(prev => (prev || []).flatMap(x => x.job_number !== r.job_number ? [x] : (x.application_id ? [{ ...x, liked: false }] : [])));
    setUndoJob(r);
    setTimeout(() => setUndoJob(prev => (prev && prev.job_number === r.job_number) ? null : prev), 10000);
    await supabase.from("saved_jobs").delete().eq("worker_id", me.id).eq("job_number", r.job_number);
  };
  const handleUndo = async () => {
    const r = undoJob; if (!r) return;
    setUndoJob(null);
    const { error } = await supabase.from("saved_jobs").insert({ worker_id: me.id, job_number: r.job_number });
    if (error) { alert("戻せませんでした：" + error.message); return; }
    setRows(prev => {
      const has = (prev || []).some(x => x.job_number === r.job_number);
      const next = has ? (prev || []).map(x => x.job_number === r.job_number ? { ...x, liked: true } : x)
                       : [{ ...r, liked: true }, ...(prev || [])];
      return next.sort((a, b) => b.job_number - a.job_number);
    });
  };

  if (rows === null) return null;

  const photoOf = (r) => (r.photos && r.photos[0]) ? (typeof r.photos[0] === "string" ? r.photos[0] : (r.photos[0].thumb || r.photos[0].url)) : null;
  const titleOf = (r) => [r.crop, r.task].filter(Boolean).join(" ") || `求人 #${r.job_number}`;
  // 応募行の形（appPhaseKeyは status＋terms_confirmed_* から段階を導く。帯の唯一のソース）
  const appOf = (r) => r.application_id ? {
    id: r.application_id, status: r.application_status,
    terms_confirmed_worker_at: r.terms_confirmed_worker_at,
    terms_confirmed_farmer_at: r.terms_confirmed_farmer_at,
  } : null;
  const phaseOf = (r) => { const a = appOf(r); return a ? appPhaseKey(a.status === "expired" ? { ...a, status: "applied" } : a) : null; };
  const openJobPage = (r) => { try { sessionStorage.setItem("cb_jobBackTo", "/saved"); } catch { /* 戻り先が無くても遷移はする */ } window.location.hash = "/work/job/" + r.job_number; };

  return (
    <div>
      {undoJob && (
        <div className="fade-in" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:12, padding:"10px 14px", marginBottom:12 }}>
          <span className="f-sans" style={{ fontSize:12, color:"#717171", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>いいねを外しました（#{undoJob.job_number}）</span>
          <button onClick={handleUndo} className="f-sans" style={{ flexShrink:0, background:"none", border:"none", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>元に戻す</button>
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ textAlign:"center", padding:"80px 24px" }}>
          <div style={{ fontSize:40, marginBottom:16, color:"#E24B4A" }}>♡</div>
          <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.7 }}>気になる求人を♥しておくと、ここに並びます</p>
        </div>
      ) : (
        <div style={{ display:"grid", gap:10 }}>
          {rows.map(r => {
            const photo = photoOf(r);
            const title = titleOf(r);
            // 日程が過ぎた求人は暗幕＋中央ラベル＋タップ無反応（応募者ページと同設計）。
            // 自分が完了していれば「完了」、そうでなければ「失効」
            const jobEnd = r.date_end || r.date_start;
            const jobPast = !!jobEnd && jobEnd < ymdLocal(new Date());
            const jobCompleted = jobPast && r.application_status === "completed";
            const phase = phaseOf(r);
            return (
              <div key={r.job_number} style={{ position:"relative", display:"flex", alignItems:"stretch", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden", pointerEvents: jobPast ? "none" : undefined }}>
                {jobPast && (
                  <div style={{ position:"absolute", inset:0, zIndex:2, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span className="f-sans" style={{ background: jobCompleted ? "#607D8B" : "#111", color:"#fff", fontSize:13, fontWeight:800, borderRadius:8, padding:"6px 20px", letterSpacing:"0.15em" }}>{jobCompleted ? "完了" : "失効"}</span>
                  </div>
                )}
                {/* 左：求人のトップ写真。タイトル・#No.を写真下部に重ねる（応募者ページと同じ作法）。
                    タップ＝ボックス展開（2026-07-27たきと指示。求人ページへの直行はボックス内のボタンが担う） */}
                <button onClick={()=>setBoxJob(r)} aria-label="この求人の状況を開く" className="f-sans"
                  style={{ flexShrink:0, width:104, padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                  {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover", filter: jobPast ? "grayscale(70%)" : "none" }} /> : "🌱"}
                  <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
                    <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{title}</span>
                    <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{r.job_number}</span>
                  </span>
                </button>
                {/* 右：自分のアイコン＋自分の段階。応募していない求人は「未応募」＋求人への導線 */}
                <div style={{ flex:1, minWidth:0, padding:"10px 12px 8px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {phase ? (
                    <button onClick={()=>setBoxJob(r)} className="f-sans"
                      style={{ width:64, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <Avatar url={myProfile?.avatar_url} name={myProfile?.nickname || (me?.name || "？")} size={52} ring={APP_PHASE_COLOR[phase] || "#00A86B"} />
                      <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color:"#222", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>あなた</span>
                      <span onClick={(e)=>{ e.stopPropagation(); openPhaseInfo(phase); }} role="button" style={{ display:"block", fontSize:9, fontWeight:700, color:APP_PHASE_COLOR[phase] || "#00A86B", marginTop:1, cursor:"pointer" }}>{APP_PHASE_LABEL[phase] || ""}</span>
                    </button>
                  ) : (
                    <button onClick={()=>setBoxJob(r)} className="f-sans" style={{ background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center" }}>
                      <span style={{ display:"block", fontSize:11, color:"#B0B0B0" }}>まだ応募していません</span>
                      <span style={{ display:"block", fontSize:12, fontWeight:700, color:"#00A86B", marginTop:4 }}>求人を見る →</span>
                    </button>
                  )}
                </div>
                {/* いいね解除（求人カードの♥と同じ役割・色も赤で統一・2026-07-27たきと指示）。
                    応募済みの求人はステータス確認のため一覧に残る（消えるのは「いいねだけ」の求人） */}
                {r.liked && (
                  <button onClick={()=>handleUnsave(r)} aria-label="いいねを解除" className="f-sans"
                    style={{ position:"absolute", top:6, right:6, zIndex:1, width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.92)", border:"none", cursor:"pointer", fontSize:15, lineHeight:1, color:"#E24B4A", boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}>♥</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ステータスの意味（2026-07-27たきと指示・応募者ページ下部の凡例と同じ）。
          並び・ラベル・色・説明はすべて APP_PHASE_* から引く＝雇い手側と文言が枝分かれしない */}
      {rows.length > 0 && (
        <div style={{ marginTop:14 }}>
          <button onClick={()=>setLegendOpen(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:13, fontWeight:700, color:"#555" }}>ステータスの意味</span>
            <span style={{ fontSize:14, color:"#999" }}>{legendOpen ? "－" : "＋"}</span>
          </button>
          {legendOpen && (
            <div className="fade-in" style={{ marginTop:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:10, padding:"12px 14px", display:"grid", gap:10 }}>
              {["applied","interview","contracted","working","completed","rejected","expired"].map(k => (
                <div key={k} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                  <span className="f-sans" style={{ flexShrink:0, marginTop:1, background:APP_PHASE_COLOR[k], color:"#fff", fontSize:11, fontWeight:700, borderRadius:6, padding:"3px 8px", minWidth:56, textAlign:"center" }}>{APP_PHASE_LABEL[k]}</span>
                  <span className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.6 }}>{APP_PHASE_DESC[k]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ 求人タップで展開するボックス（2026-07-27たきと指示・応募者ページのシートと同じ作法） ═══
           cb-lock-scroll＝展開中は背後のページを固定し、スクロールをシート内だけにする */}
      {boxJob && (() => {
        const r = boxJob;
        const phase = phaseOf(r);
        const c = APP_PHASE_COLOR[phase] || "#717171";
        const dateLabel = r.date_start ? (r.date_end && r.date_end !== r.date_start ? `${calFmtDate(r.date_start)}〜${calFmtDate(r.date_end)}` : calFmtDate(r.date_start)) : "未設定";
        const chatOk = !!(r.application_id && CHAT_ELIGIBLE_STATUSES.includes(r.application_status));
        return (
          <div onClick={()=>setBoxJob(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                <button onClick={()=>setBoxJob(null)} aria-label="閉じる" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                {/* 現在地バナー（応募者ページと同じ・段階色＋APP_PHASE_DESC＝説明の唯一のソース） */}
                {phase ? (
                  <div style={{ background: c + "14", borderLeft: "4px solid " + c, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:c, margin:0 }}>{APP_PHASE_LABEL[phase] || ""}</p>
                    {APP_PHASE_DESC[phase] && (
                      <p className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.7, margin:"3px 0 0" }}>{APP_PHASE_DESC[phase]}</p>
                    )}
                  </div>
                ) : (
                  <div style={{ background:"#F7F7F7", borderLeft:"4px solid #B0B0B0", borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#717171", margin:0 }}>まだ応募していません</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.7, margin:"3px 0 0" }}>いいねした求人です。求人ページから応募できます。</p>
                  </div>
                )}
                {/* 求人の要約（写真・タイトル・#No.・日程・地域） */}
                <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                  <div style={{ flexShrink:0, width:88, height:88, borderRadius:12, overflow:"hidden", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                    {photoOf(r) ? <img src={photoOf(r)} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>{titleOf(r)}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"2px 0 0" }}>#{r.job_number}{r.town ? "　" + r.town : ""}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>📅 {dateLabel}</p>
                    {r.application_id && (
                      <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0" }}>応募日 {new Date(r.applied_at).toLocaleDateString("ja-JP")}</p>
                    )}
                  </div>
                </div>
                {/* 操作（応募者ページのボタン群と同じ位置づけ） */}
                <div style={{ display:"grid", gap:8 }}>
                  <button onClick={()=>{ setBoxJob(null); openJobPage(r); }} className="f-sans"
                    style={{ padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>求人ページを見る →</button>
                  {chatOk && (
                    <button onClick={()=>{ setBoxJob(null); window.location.hash = "/chat/" + r.application_id; }} className="f-sans"
                      style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>💬 チャットを開く</button>
                  )}
                  {r.application_id && (
                    <button onClick={()=>{ setBoxJob(null); window.location.hash = "/profile/worker/applying"; }} className="f-sans"
                      style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#555", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>応募状況を見る</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
