// ステータス一覧（#/saved・分割・段階2後半・2026-07-24／2026-07-27に役割を刷新）：
// 働き手が「いいね」「応募」した求人と、その求人での自分の段階を確認する面。
// 2026-07-27たきと指示：雇い手の応募者ページと同じ構造（左=求人トップ写真＋タイトル/#No.／右=アイコン）に。
// ★アイコンは「自分のもの」だけ＝自分の応募がいまどの段階かを確認するための面。
//   他の働き手の情報（誰が応募しているか・人数）は取得も表示も一切しない（データ憲法・個人情報の最小化）。
// ★求人の供給源は my_job_actions()（SECURITY DEFINER・2026-07-27）。jobs_public は status='open' しか
//   含まないため、応募した求人が掲載終了すると一覧から消えていた（＝失効・完了の暗幕が出なかった）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, CHAT_ELIGIBLE_STATUSES, photoThumb, mapJobPublicRow } from "../lib/utils";
import { JobCard } from "./JobCard";
import { openPhaseInfo } from "../lib/previewBus";
import { Avatar, AutoSkeleton, useSkeletonProbe } from "./ui";
import { AgreedDatesRow, AvailDatesChips } from "./DateChips";
import { getCache, setCache } from "../lib/viewCache";
import { MyCalendar } from "./MyCalendar";

// ── SavedJobsView（ステータス一覧・#/saved） ──
export function SavedJobsView({ me }) {
  // 前回の内容が残っていればまず出す→裏で最新に差し替える（2026-07-27たきと指示・遷移の待ち時間対策）
  const [rows, setRows] = useState(() => getCache("saved:rows") ?? null);
  const [myProfile, setMyProfile] = useState(() => getCache("saved:me") ?? null); // 自分のアイコン・ニックネーム
  const [boxJob, setBoxJob] = useState(null);       // 展開中のボックス（求人1件・応募者ページのシートと同じ作法）
  // ボックス内の求人カード用の全体像（2026-08-07たきと指示「その他の求人と同じ配置と要素」＝JobCard）。
  // my_job_actions はカードの最小限（報酬・地域・3トグルを含まない）so、開いた求人だけ jobs_public から
  // 1行読み足す。job_number→mapped行｜null(非公開=draft/pending等でビューに無い)。開いたものだけ・1回だけ
  const [boxFull, setBoxFull] = useState({});
  useEffect(() => {
    const jn = boxJob?.job_number;
    if (!jn || jn in boxFull) return;
    let dead = false;
    (async () => {
      try {
        const { data } = await supabase.from("jobs_public").select("*").eq("job_number", jn).maybeSingle();
        if (!dead) setBoxFull(prev => ({ ...prev, [jn]: data ? mapJobPublicRow(data) : null }));
      } catch { if (!dead) setBoxFull(prev => ({ ...prev, [jn]: null })); }
    })();
    return () => { dead = true; };
  }, [boxJob]); // eslint-disable-line react-hooks/exhaustive-deps -- boxFullは取得済み判定のみ（依存に入れると再取得ループ）
  const [legendOpen, setLegendOpen] = useState(false); // 下部「ステータスの意味」の開閉（応募者ページの凡例と同じ）
  // カレンダー（2026-07-27たきと指示）：働き手のカレンダーページを廃止し、この面の上部へ移植。
  // 開閉は雇い手の応募者ページと同じ作法＝横スワイプ or 案内行のタップ。今日ページのカレンダー箱から
  // 来たときは合図(cb_openCalendar)で開いた状態で着地する
  const [calOnTop, setCalOnTop] = useState(false);
  const [calDay, setCalDay] = useState(null); // { ymd, jobs:[job_number] }＝選んだ日の求人を光らせる
  // 畳む動作は開く動作の逆順（①縦に畳む→②横に縮む・2026-07-29たきと指示）。応募者ページと同じ作法
  const [calClosing, setCalClosing] = useState(false);
  const calCloseT = useRef(null);
  const CAL_CLOSE_MS = 660; // CSS: 縦0.34s +（0.34s待ち）横0.3s ＝ 0.64s ＋ 余白
  useEffect(() => () => clearTimeout(calCloseT.current), []);
  const toggleCalTop = () => {
    if (calOnTop) {
      if (calClosing) return;
      setCalClosing(true);
      setCalDay(null);
      calCloseT.current = setTimeout(() => { setCalOnTop(false); setCalClosing(false); }, CAL_CLOSE_MS);
    } else {
      clearTimeout(calCloseT.current);
      setCalClosing(false);
      setCalOnTop(true);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
    }
  };
  const jobCardRefs = useRef({});
  // 仮配置の骨を測るref（このページが実際に描いた形が、次回の読み込み中の形になる）
  const skelRef = useSkeletonProbe("saved");
  useEffect(() => {
    try { if (sessionStorage.getItem("cb_openCalendar")) { sessionStorage.removeItem("cb_openCalendar"); setCalOnTop(true); } } catch {}
  }, []);
  const onCalDayTap = (ymd, jobNumbers) => {
    setCalDay({ ymd, jobs: jobNumbers });
    if (!jobNumbers.length) return;
    setTimeout(() => {
      const el = jobNumbers.map(n => jobCardRefs.current[n]).find(Boolean);
      if (el) el.scrollIntoView({ behavior:"smooth", block:"center" });
    }, 40);
  };
  // 横スワイプでカレンダーを開閉（応募者ページと同じ判定。内側の横スクロールで始まったタッチは奪わない）
  const swipeRef = useRef(null);
  const onSwipeStart = (e) => {
    const inHScroll = (() => {
      for (let n = e.target; n && n !== e.currentTarget; n = n.parentElement) {
        try {
          const st = window.getComputedStyle(n);
          if ((st.overflowX === "auto" || st.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
        } catch { return true; }
      }
      return false;
    })();
    swipeRef.current = inHScroll ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onSwipeEnd = (e) => {
    const s = swipeRef.current; swipeRef.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // 横スワイプのみ
    toggleCalTop();
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [actRes, wpRes] = await Promise.all([
          supabase.rpc("my_job_actions"),
          supabase.from("worker_profiles").select("nickname,avatar_url").eq("auth_id", me.id).maybeSingle(),
        ]);
        if (cancelled) return;
        setRows(actRes.data || []); setCache("saved:rows", actRes.data || []);
        setMyProfile(wpRes.data || null); setCache("saved:me", wpRes.data || null);
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

  // 初回（キャッシュ無し）は空白でなく仮の箱を並べる＝読み込み中がひと目で分かる
  if (rows === null) return <div style={{ paddingTop:4 }}><AutoSkeleton shapeKey="saved" /></div>;

  const photoOf = (r) => photoThumb(r.photos?.[0]);
  const titleOf = (r) => [r.crop, r.task].filter(Boolean).join(" ") || `求人 #${r.job_number}`;
  // 応募行の形（appPhaseKeyは status＋terms_confirmed_* から段階を導く。帯の唯一のソース）
  const appOf = (r) => r.application_id ? {
    id: r.application_id, status: r.application_status,
    terms_confirmed_worker_at: r.terms_confirmed_worker_at,
    terms_confirmed_farmer_at: r.terms_confirmed_farmer_at,
  } : null;
  // 見送り・失効のアイコンは「その時の状態」で出す（2026-07-27たきと指示）。どちらも応募中から進まずに
  // 終わった応募なので、アイコンは応募中のまま。終わった事実はカード全体の暗幕＋ラベルが担う
  const phaseOf = (r) => { const a = appOf(r); return a ? appPhaseKey((a.status === "expired" || a.status === "rejected") ? { ...a, status: "applied" } : a) : null; };
  const openJobPage = (r) => { try { sessionStorage.setItem("cb_jobBackTo", "/saved"); } catch { /* 戻り先が無くても遷移はする */ } window.location.hash = "/work/job/" + r.job_number; };

  return (
    <div>
      {undoJob && (
        <div className="fade-in" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:12, padding:"10px 14px", marginBottom:12 }}>
          <span className="f-sans" style={{ fontSize:12, color:"#717171", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>いいねを外しました（#{undoJob.job_number}）</span>
          <button onClick={handleUndo} className="f-sans" style={{ flexShrink:0, background:"none", border:"none", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>元に戻す</button>
        </div>
      )}
      {/* 展開はヌルッと（2026-07-27たきと指示）：cb-cal-revealが高さ0→自動へ滑らかに開く */}
      {(calOnTop || calClosing) && <div className={"cb-cal-reveal" + (calClosing ? " cb-cal-closing" : "")} style={{ marginBottom:14 }}><div><MyCalendar onDayTapJobs={onCalDayTap} /></div></div>}
      {rows.length > 0 && (
        <button onClick={toggleCalTop} className="f-sans"
          style={{ width:"100%", background:"none", border:"none", padding:"0 0 6px", fontSize:11, color:"#B0B0B0", textAlign:"center", cursor:"pointer" }}>
          {(calOnTop && !calClosing) ? "横スワイプでカレンダーを畳む" : "📅 横スワイプでカレンダーを開く"}
        </button>
      )}
      {rows.length === 0 ? (
        <div style={{ textAlign:"center", padding:"80px 24px" }}>
          <div style={{ fontSize:40, marginBottom:16, color:"#E24B4A" }}>♡</div>
          <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.7 }}>気になる求人を♥しておくと、ここに並びます</p>
        </div>
      ) : (
        <div ref={skelRef} onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd} style={{ display:"grid", gap:10 }}>
          {rows.map(r => {
            const photo = photoOf(r);
            const title = titleOf(r);
            // 終わった応募・求人は暗幕＋中央ラベル＋タップ無反応（応募者ページと同設計）。
            // 見送り(rejected)も失効と同じ構造にする（2026-07-27たきと指示）＝日程に関係なく暗幕。
            // ラベルの優先順：完了 ＞ 見送り（農家の判断） ＞ 失効（判断なきまま日程を過ぎた）
            const jobEnd = r.date_end || r.date_start;
            const jobPast = !!jobEnd && jobEnd < ymdLocal(new Date());
            const isRejected = r.application_status === "rejected";
            const jobCompleted = r.application_status === "completed";
            const covered = jobPast || isRejected || jobCompleted;
            const coverLabel = jobCompleted ? "完了" : isRejected ? "見送り" : "失効";
            const coverColor = jobCompleted ? "#607D8B" : isRejected ? APP_PHASE_COLOR.rejected : "#111";
            const phase = phaseOf(r);
            // カレンダーで選んだ日に該当する求人は光らせる（応募者ページと同じ引き継ぎ）
            const calHit = !!calDay && calDay.jobs.includes(r.job_number);
            return (
              <div key={r.job_number} ref={el => { jobCardRefs.current[r.job_number] = el; }}
                style={{ position:"relative", display:"flex", alignItems:"stretch", background: calHit ? "#FFF6DE" : "#fff", border:"1px solid " + (calHit ? "#E8C77A" : "#EBEBEB"), borderRadius:14, overflow:"hidden", transition:"background .5s", pointerEvents: covered ? "none" : undefined }}>
                {covered && (
                  <div style={{ position:"absolute", inset:0, zIndex:2, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span className="f-sans" style={{ background: coverColor, color:"#fff", fontSize:13, fontWeight:800, borderRadius:8, padding:"6px 20px", letterSpacing:"0.15em" }}>{coverLabel}</span>
                  </div>
                )}
                {/* 左：求人のトップ写真。タイトル・#No.を写真下部に重ねる（応募者ページと同じ作法）。
                    タップ＝ボックス展開（2026-07-27たきと指示。求人ページへの直行はボックス内のボタンが担う） */}
                <button onClick={()=>setBoxJob(r)} aria-label="この求人の状況を開く" className="f-sans"
                  /* 写真の枠は3:4で固定（2026-07-27たきと指示「3番目のカードだけ低い」の修正）：
                      以前は高さ指定が無く、写真の縦横比がそのままカードの高さになっていた＝
                      横長の写真の求人だけカードが低くなっていた。枠を固定し中身はcoverで切り抜く */
                  style={{ flexShrink:0, width:104, aspectRatio:"3 / 4", padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                  {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover", filter: covered ? "grayscale(70%)" : "none" }} /> : "🌱"}
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
                    style={{ position:"absolute", top:6, right:6, zIndex:1, width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,0.92)", border:"none", cursor:"pointer", fontSize:20, lineHeight:1, color:"#E24B4A", boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}><span className="cb-like-heart" style={{ display:"inline-block" }}>♥</span></button>
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
                {/* 求人の要約＝その他の求人と同じカード（2026-08-07たきと指示・スクショ＝関連求人カード）：
                    JobCard variant="wide"＝写真に タイトル・地域・#No.・報酬・日程・3トグル を重ねる型を全幅で。
                    要約の顔を独自に作らない＝JobCardが唯一のソース。my_job_actions は報酬・地域・3トグルを
                    持たないso、開いた求人だけ jobs_public から読み足す（boxFull）。届くまで／非公開求人は
                    手元の行から作った仮の姿（写真・タイトル・#No.・日程・町域）＝報酬0円やダミーは出さない */}
                <div style={{ marginBottom:12 }}>
                  {(() => {
                    const full = boxFull[r.job_number];
                    const job = full || {
                      id: r.job_number, crop: r.crop || "", task: r.task || "", photos: r.photos || [],
                      region: r.town || "", dateStartRaw: r.date_start || "", dateEndRaw: r.date_end || "", pay: 0,
                    };
                    return <JobCard job={job} variant="wide" onOpen={()=>{ setBoxJob(null); openJobPage(r); }} />;
                  })()}
                  {r.application_id && (
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"8px 4px 0" }}>応募日 {new Date(r.applied_at).toLocaleDateString("ja-JP")}</p>
                  )}
                </div>
                {/* 選択した日にち（2026-08-07たきと指示）：働く日（農家が確定・濃緑）＞来られる日（応募時に自分が選んだ日）。
                    共有部品＝応募者カード・返事待ちカード・チャット文脈カードと同じ見た目。
                    'any'（期間中いつでも）・未選択は部品側で非表示（実データ／未設定／非表示の三択・憲法3条） */}
                <AgreedDatesRow value={r.agreed_dates} />
                <AvailDatesChips value={r.available_dates} />
                {/* 操作ボックス＝横2列（2026-08-07たきと指示）。形は今日ページの「やること」箱と同型
                    （絵文字を上に・太字タイトル・中央寄せの2列格子）＝ボックス格子の作法を増やさない */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:10, marginTop:12 }}>
                  <button onClick={()=>{ setBoxJob(null); openJobPage(r); }} className="f-sans"
                    style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:18, padding:"20px 10px 16px", textAlign:"center", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                    <span style={{ display:"block", fontSize:40, lineHeight:1, marginBottom:10 }}>📄</span>
                    <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>求人ページ</span>
                    <span className="f-sans" style={{ display:"block", fontSize:11, color:"#717171", marginTop:4, lineHeight:1.6 }}>募集内容・場所・持ち物をもう一度確認できます</span>
                  </button>
                  {chatOk && (
                    <button onClick={()=>{ setBoxJob(null); window.location.hash = "/chat/" + r.application_id; }} className="f-sans"
                      style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:18, padding:"20px 10px 16px", textAlign:"center", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                      <span style={{ display:"block", fontSize:40, lineHeight:1, marginBottom:10 }}>💬</span>
                      <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>チャットを開く</span>
                      <span className="f-sans" style={{ display:"block", fontSize:11, color:"#717171", marginTop:4, lineHeight:1.6 }}>農家さんとのやり取り・面接はここで行います</span>
                    </button>
                  )}
                  {r.application_id && (
                    <button onClick={()=>{ setBoxJob(null); window.location.hash = "/profile/worker/applying"; }} className="f-sans"
                      style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:18, padding:"20px 10px 16px", textAlign:"center", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                      <span style={{ display:"block", fontSize:40, lineHeight:1, marginBottom:10 }}>📋</span>
                      <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>応募状況</span>
                      <span className="f-sans" style={{ display:"block", fontSize:11, color:"#717171", marginTop:4, lineHeight:1.6 }}>応募の進み具合（承認→面接→採用）を確認できます</span>
                    </button>
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
