// いいね一覧（#/saved・分割・段階2後半・2026-07-24）：saved_jobs(本人のみ)とjobs_publicをjoinして表示。
// 2026-07-27たきと指示：雇い手の応募者ページと同じ構造（左=求人トップ写真＋タイトル/#No.／右=アイコン）に。
// ★ただしアイコンは「自分のもの」だけ＝自分の応募がいまどの段階かを確認するための面。
//   他の働き手の情報（誰が応募しているか・人数）は取得も表示も一切しない（データ憲法・個人情報の最小化）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { mapJobPublicRow, ymdLocal, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR } from "../lib/utils";
import { openPhaseInfo } from "../lib/previewBus";
import { Avatar } from "./ui";

// ── SavedJobsView（いいね一覧・#/saved）：saved_jobs(本人のみ)とjobs_publicをjoinして表示 ──
export function SavedJobsView({ me }) {
  const [jobs, setJobs] = useState(null);
  const [myApps, setMyApps] = useState({});   // job_number → 自分の応募行（段階の算出に使う）
  const [myProfile, setMyProfile] = useState(null); // 自分のアイコン・ニックネーム
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: saved } = await supabase.from("saved_jobs").select("job_number").eq("worker_id", me.id);
        const nums = (saved || []).map(r => r.job_number);
        if (!nums.length) { if (!cancelled) setJobs([]); return; }
        // 求人・自分の応募・自分のプロフィールを並列取得（applicationsは当事者RLSso自分の行しか返らない）
        const [jobRes, appRes, wpRes] = await Promise.all([
          supabase.from("jobs_public").select("*").in("job_number", nums).order("job_number", { ascending: false }),
          supabase.from("applications").select("id,job_number,status,terms_confirmed_worker_at,terms_confirmed_farmer_at").eq("worker_id", me.id).in("job_number", nums),
          supabase.from("worker_profiles").select("nickname,avatar_url").eq("auth_id", me.id).maybeSingle(),
        ]);
        if (cancelled) return;
        setJobs((jobRes.data || []).map(mapJobPublicRow));
        const am = {}; (appRes.data || []).forEach(a => { am[a.job_number] = a; });
        setMyApps(am);
        setMyProfile(wpRes.data || null);
      } catch { if (!cancelled) setJobs([]); }
    })();
    return () => { cancelled = true; };
  }, [me?.id]);

  const handleUnsave = async (job) => {
    setJobs(prev => (prev || []).filter(j => j.id !== job.id));
    await supabase.from("saved_jobs").delete().eq("worker_id", me.id).eq("job_number", job.id);
  };

  if (jobs === null) return null;

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:6 }}>いいねした求人</h2>
      </div>
      {jobs.length === 0 ? (
        <div style={{ textAlign:"center", padding:"80px 24px" }}>
          <div style={{ fontSize:40, marginBottom:16 }}>♡</div>
          <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.7 }}>気になる求人を💚しておくと、ここに並びます</p>
        </div>
      ) : (
        <div style={{ display:"grid", gap:10 }}>
          {jobs.map(job => {
            const photo = job.photos && job.photos[0] ? (typeof job.photos[0] === "string" ? job.photos[0] : job.photos[0]?.url) : null;
            const title = [job.crop, job.task].filter(Boolean).join(" ") || `求人 #${job.id}`;
            // 日程が過ぎた求人は暗幕＋中央ラベル＋タップ無反応（応募者ページと同設計）。
            // 自分が完了していれば「完了」、そうでなければ「失効」
            const jobEnd = job.dateEndRaw || job.dateStartRaw;
            const jobPast = !!jobEnd && jobEnd < ymdLocal(new Date());
            const app = myApps[job.id];
            const jobCompleted = jobPast && app?.status === "completed";
            const phase = app ? appPhaseKey(app.status === "expired" ? { ...app, status: "applied" } : app) : null;
            return (
              <div key={job.id} style={{ position:"relative", display:"flex", alignItems:"stretch", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden", pointerEvents: jobPast ? "none" : undefined }}>
                {jobPast && (
                  <div style={{ position:"absolute", inset:0, zIndex:2, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span className="f-sans" style={{ background: jobCompleted ? "#607D8B" : "#111", color:"#fff", fontSize:13, fontWeight:800, borderRadius:8, padding:"6px 20px", letterSpacing:"0.15em" }}>{jobCompleted ? "完了" : "失効"}</span>
                  </div>
                )}
                {/* 左：求人のトップ写真。タイトル・#No.を写真下部に重ねる（応募者ページと同じ作法）。タップで求人を見る */}
                <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/saved"); } catch { /* 戻り先が無くても遷移はする */ } window.location.hash = "/work/job/" + job.id; }}
                  aria-label="求人を見る" className="f-sans"
                  style={{ flexShrink:0, width:104, padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                  {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover", filter: jobPast ? "grayscale(70%)" : "none" }} /> : "🌱"}
                  <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
                    <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{title}</span>
                    <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{job.id}</span>
                  </span>
                </button>
                {/* 右：自分のアイコン＋自分の段階。応募していない求人は「未応募」＋応募への導線 */}
                <div style={{ flex:1, minWidth:0, padding:"10px 12px 8px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {app ? (
                    <button onClick={()=>{ window.location.hash = "/profile/worker/applying"; }} className="f-sans"
                      style={{ width:64, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <Avatar url={myProfile?.avatar_url} name={myProfile?.nickname || (me?.name || "？")} size={52} ring={APP_PHASE_COLOR[phase] || "#00A86B"} />
                      <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color:"#222", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>あなた</span>
                      <span onClick={(e)=>{ e.stopPropagation(); openPhaseInfo(phase); }} role="button" style={{ display:"block", fontSize:9, fontWeight:700, color:APP_PHASE_COLOR[phase] || "#00A86B", marginTop:1, cursor:"pointer" }}>{APP_PHASE_LABEL[phase] || ""}</span>
                    </button>
                  ) : (
                    <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/saved"); } catch { /* 戻り先が無くても遷移はする */ } window.location.hash = "/work/job/" + job.id; }}
                      className="f-sans" style={{ background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center" }}>
                      <span style={{ display:"block", fontSize:11, color:"#B0B0B0" }}>まだ応募していません</span>
                      <span style={{ display:"block", fontSize:12, fontWeight:700, color:"#00A86B", marginTop:4 }}>求人を見る →</span>
                    </button>
                  )}
                </div>
                {/* いいね解除（従来の♡と同じ役割・終了求人では暗幕でタップ不可） */}
                <button onClick={()=>handleUnsave(job)} aria-label="いいねを解除" className="f-sans"
                  style={{ position:"absolute", top:6, right:6, zIndex:1, width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.92)", border:"none", cursor:"pointer", fontSize:14, lineHeight:1, boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}>💚</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
