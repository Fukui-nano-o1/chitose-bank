// 分割3-C（2026-07-25）：App.jsxから移動。プロフィールタブ（両役割の入口カードメニュー＋サブページ切替）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { getCache, setCache } from "../lib/viewCache";
import { snapGet, snapSet } from "../lib/snapshot";
import { peekApplyReturn, clearApplyReturn } from "../lib/applyReturn";
import { ymdLocal, WORKER_DECLARATIONS, ROLE_ORANGE, ROLE_GREEN } from "../lib/utils";
import { Avatar } from "./ui";
import { FarmerDashboard } from "./FarmerDashboard";
import { WorkerApplications } from "./WorkerApplications";
import { WorkerProfileEdit } from "./WorkerProfileEdit";
import { WorkerTrustCard } from "./TrustCards";

export function ProfileHub({ me, onNewJob, onResume, onAvatarChange }) {
  const hashToPTab = () => {
    const h = window.location.hash.replace(/^#\/?/,"");
    if (h === "profile/employer" || h.startsWith("profile/employer/")) return "employer";
    if (h === "profile/worker" || h.startsWith("profile/worker/") || h === "profile") return "worker";
    return "worker";
  };
  const [pTab, setPTab] = useState(() => { try { return hashToPTab(); } catch { return "worker"; } });
  const hashToWTab = () => {
    const h = window.location.hash.replace(/^#\/?/,"");
    if (h === "profile/worker/profile") return "wprofile";
    if (h === "profile/worker/applying") return "applying";
    if (h === "profile/worker/approved") return "approved";
    // 働き手のカレンダーページは廃止（2026-07-27たきと指示）＝カレンダーはステータスページ(#/saved)に移植。
    // 旧URLで来た人は入口(ホーム)に着地させる（行き先を失わせない）
    return "home"; // 入口はAirbnb型カードメニュー（2026-07-14・農家プロと同構造）
  };
  const [wTab, setWTab] = useState(() => { try { return hashToWTab(); } catch { return "home"; } });
  // 雇う/働くトグルは両面の入口(カードメニュー)だけ表示。編集・サブページでは邪魔なので非表示（2026-07-14）
  const isEmployerHome = () => window.location.hash.replace(/^#\/?/,"") === "profile/employer";
  const [eHome, setEHome] = useState(() => { try { return isEmployerHome(); } catch { return false; } });
  const [pAnim, setPAnim] = useState(""); // 両面切替の反転: pflip-out(退場0.4s)|pflip-in(入場0.4s)＝合計0.8秒。完了後は空に戻す
  // 下部バー「プロフィール」タップ＝今いる側のトップへ（2026-07-14変更）。
  // 働き手側：wTabをhomeへ（同hash時＝hashchangeが出ない場合の保険）
  useEffect(() => {
    const onWorkerHome = () => { setWTab("home"); };
    window.addEventListener("cb:workerHome", onWorkerHome);
    return () => window.removeEventListener("cb:workerHome", onWorkerHome);
  }, []);
  useEffect(() => {
    const onHash = () => { const p = hashToPTab(); if (p) setPTab(p); const w = hashToWTab(); if (w) setWTab(w); setEHome(isEmployerHome()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // WORKER_TABS(サイドタブ列)は廃止（2026-07-14）：入口カードメニューに一本化
  const [hasEmployerSide, setHasEmployerSide] = useState(() => getCache("hub:hasEmp") ?? false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        // 求人の有無と雇い手プロフィールの有無は独立なので同時に投げる（2026-07-27たきと指示）
        const [{ count }, { data: ep }] = await Promise.all([
          supabase.from("jobs").select("job_number", { count: "exact", head: true }).eq("farmer_id", session.user.id),
          supabase.from("employer_profiles").select("auth_id").eq("auth_id", session.user.id).maybeSingle(),
        ]);
        if (!cancelled && ((count || 0) > 0 || ep)) { setHasEmployerSide(true); setCache("hub:hasEmp", true); }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  const WORKER_TAB_TITLES = { wprofile:"働き手プロフィール", applying:"返事待ち", approved:"きょうの仕事" };
  // 入口カードメニュー用：本人のworker_profiles(表示名/アバター)と応募件数（バッジ表示）
  // 名刺の氏名・アイコンを読み込み前から出す（2026-08-02たきと指示「名刺の氏名が未設定で長時間表示される」）：
  // viewCache（sessionStorage・アプリ終了で消える）に無ければ、snapshot（localStorage・本人の自分用データ・
  // ログアウトで全消去）から前回のプロフィールを即表示し、裏の再取得で最新に差し替える
  const [wMini, setWMini] = useState(() => getCache("hub:wMini") ?? snapGet("wMini") ?? null);
  const [wAppCounts, setWAppCounts] = useState(() => getCache("hub:wCounts") ?? { applying:0, approved:0 });
  const [wTopBack, setWTopBack] = useState(() => { try { return localStorage.getItem("cb_wTopBack") === "1"; } catch { return false; } }); // トップボックスの裏面表示。切り返した画面で固定（localStorageに永続・2026-07-16）
  const [wTopAnim, setWTopAnim] = useState("");    // 反転アニメ: pflip-out|pflip-in（0.4s×2=0.8秒）
  const [wTrust, setWTrust] = useState(() => getCache("hub:wTrust") ?? null);      // 裏面用の自己スタッツ（登録日・本人確認・リピート率）。my_worker_trust_statsは本人限定RPC＝農家には返らない（法務：評価集計の公開禁止）
  const [wHub, setWHub] = useState(() => getCache("hub:wHub") ?? { today:0, searchOpen:0, reviewed:0 }); // ハブ箱用（2026-07-22）：当日の仕事・きょう応募できる求人件数・評価件数
  const [showWAch, setShowWAch] = useState(false); // 🌟わたしの実績モーダル
  const [wSeekFlip, setWSeekFlip] = useState(false); // 「新しく求職を出す」カードの反転（届出受理待ちの案内・2026-07-25）
  const [wSeenReviews, setWSeenReviews] = useState(() => { try { return parseInt(localStorage.getItem("cb_wSeenReviews") || "0", 10) || 0; } catch { return 0; } }); // 既読の評価件数（🌟は新着時のみ）
  useEffect(() => {
    if (wTab !== "home") return; // 入口に戻るたびに再取得（編集後のバッジ・スニペット鮮度を担保）
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        // 【第1波】互いに依存しない4本を同時に投げる（2026-07-27たきと指示「直列を並列に」）。
        // 依存があるのは「きょうの仕事」件数だけ（応募の結果を見て求人の日程を引く）ので第2波に回す
        const [{ data: wp }, { data: apps }, openRes, { data: ts }] = await Promise.all([
          supabase.from("worker_profiles").select("*").eq("auth_id", session.user.id).maybeSingle(),
          supabase.from("applications").select("status,attended,worker_confirmed_end_at,job_number").eq("worker_id", session.user.id),
          // さがす箱＝きょう応募できる求人件数（jobs_public=公開中）
          supabase.from("jobs_public").select("job_number", { count: "exact", head: true }).then(r => r, () => ({ count: 0 })),
          supabase.rpc("my_worker_trust_stats").then(r => r, () => ({ data: null })),
        ]);
        if (cancelled) return;
        if (wp) { setWMini(wp); setCache("hub:wMini", wp); snapSet("wMini", wp); }
        // 承認済みバッジは未対応（手続きが残っている応募）のみ計上。完了・評価済みまで数えると
        // バッジが常時点灯し、新しい要対応があっても気づけなくなるため（2026-07-16）
        if (apps) {
          const counts = {
            applying: apps.filter(a => a.status === "applied").length,
            approved: apps.filter(a =>
              ["approved","meeting","interview","contracted","working","completed"].includes(a.status)
              && !(a.status === "completed" && (a.attended === false || !!a.worker_confirmed_end_at))
            ).length,
          };
          setWAppCounts(counts); setCache("hub:wCounts", counts);
        }
        const openCount = openRes.count || 0;
        // 【第2波】きょうの仕事バッジ＝当日が作業日の確定した仕事（契約済み以降）の件数
        let todayCount = 0;
        try {
          const contracted = (apps || []).filter(a => ["contracted","working"].includes(a.status));
          if (contracted.length) {
            const { data: jd } = await supabase.from("jobs_public").select("job_number,date_start,date_end").in("job_number", contracted.map(a => a.job_number));
            const today = ymdLocal(new Date());
            const jm = Object.fromEntries((jd || []).map(j => [j.job_number, j]));
            todayCount = contracted.filter(a => { const j = jm[a.job_number]; if (!j) return false; const s = j.date_start, e = j.date_end || j.date_start; return s && s <= today && today <= e; }).length;
          }
        } catch {}
        if (cancelled) return;
        if (ts?.ok) { setWTrust(ts); setCache("hub:wTrust", ts); }
        const hub = { today: todayCount, searchOpen: openCount, reviewed: ts?.reviewed_count || 0, completed: ts?.completed_count || 0, hours: ts?.total_hours || 0, wantAgain: ts?.want_again_count || 0 };
        setWHub(hub); setCache("hub:wHub", hub);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [wTab]);
  // 働き手プロフィールの未設定項目数（編集ページの10ボックスに対応。トップボックス右上のバッジ＋赤影に使用）
  // 核（アイコン・ニックネーム・自己紹介）が未設定→赤影＋浮遊アニメ／任意のみ未設定→赤影のみ（2026-07-16）
  const wUnsetReq = wMini ? [
    !!wMini.avatar_url,
    !!(wMini.nickname || "").trim(),
    !!((wMini.pr_pending ?? wMini.pr) || "").trim(),
  ].filter(x => !x).length : 3;
  const wUnsetCount = wMini ? wUnsetReq + [
    !!(wMini.residence_city || "").trim(),
    !!wMini.transport,
    !!wMini.farm_experience,
    !!wMini.physical_level,
    Array.isArray(wMini.interests) && wMini.interests.length > 0,
    Array.isArray(wMini.languages) && wMini.languages.length > 0,
    (Array.isArray(wMini.pr_qa_pending) ? wMini.pr_qa_pending.length : (Array.isArray(wMini.pr_qa) ? wMini.pr_qa.length : 0)) > 0,
  ].filter(x => !x).length : 10;
  // 自己紹介の審査状態（2026-07-19）：審査待ち=帯＋タップ不能／修正依頼中=赤帯（修正のためタップは可能）
  const wHasPending = !!(wMini && (((wMini.pr_pending || "").trim()) || (Array.isArray(wMini.pr_qa_pending) && wMini.pr_qa_pending.length > 0)));
  const wReview = wHasPending ? (wMini.pr_submitted_at ? "pending" : "revision") : null;
  return (
    <div className="profile-employer-edge" style={{maxWidth:1024,margin:"0 auto",padding:"32px 4px"}}>{/* プロフィール両面とも画面端から10pxに統一（モバイル・CSS側の負マージン併用） */}
      {/* 浮遊ボタンはトグル式：働き手側の表示中→「雇う」(雇い手空間へ)／農家プロ(雇い手空間)の表示中→「働く」(働き手側へ)。
          表示は両面の入口(カードメニュー)のみ＝編集・サブページでは非表示（2026-07-14）。
          切替はフェードアウト(0.16s)→面切替→フェードイン(0.22s)の2段階 */}
      {(pTab === "employer" ? eHome : wTab === "home") && (
        <button onClick={()=>{
          if (pAnim === "pflip-out") return; // 連打ガード
          setPAnim("pflip-out");
          setTimeout(()=>{ window.location.hash = pTab === "employer" ? "/profile/worker" : "/profile/employer"; setPAnim("pflip-in"); }, 400);
        }} className="profile-employer-fab f-sans" style={{ background: pTab === "employer" ? ROLE_ORANGE : ROLE_GREEN }}>
          {/* 切替先の役割の色名を予告表示（第11弾）：橙=働き手／緑=農家。FAB自体も切替先の色に灯す */}
          {pTab === "employer"
            ? "⇄ 働き手（橙）に切替"
            : (hasEmployerSide ? "⇄ 農家（緑）に切替" : "🌱 農家（緑）を作る")}
        </button>
      )}
      {/* 面の中身をkey={pTab}で包む：切替時に再マウント→pflip-in/fade-inが再生される */}
      <div key={pTab} className={pAnim || "fade-in"} onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && pAnim === "pflip-in") setPAnim(""); }}>
      {pTab === "worker" ? (
        wTab === "home" ? (
          <>
            {/* ═══ Airbnb型入口メニュー（働き手側・2026-07-14）：農家プロ入口と同構造。旧サイドタブ列は廃止 ═══ */}
            {/* トップボックスは反転式（2026-07-16）：表=アイコン＋ニックネーム／裏=アイコン・ニックネーム抜きのプレビュー。右上⇄で反転0.8秒 */}
            <div style={{ position:"relative" }}>
              <button onClick={()=>{ if (wReview === "pending") return; window.location.hash="/profile/worker/profile"; }}
                className={"f-sans" + (wTopAnim ? " " + wTopAnim : (wReview ? "" : wUnsetReq > 0 ? " cb-urgent-card" : wUnsetCount > 0 ? " cb-urgent-still" : ""))}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && wTopAnim === "pflip-in") setWTopAnim(""); }}
                style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid " + ROLE_ORANGE, borderRadius:24, padding: wReview ? "28px 20px 44px" : "28px 20px", cursor: wReview === "pending" ? "default" : "pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box" }}>
                {/* 審査帯（2026-07-19）：審査待ち=オレンジ帯＋タップ不能／修正依頼中=赤帯（タップで修正へ） */}
                {wReview && (
                  <span className="f-sans" style={{ position:"absolute", left:0, right:0, bottom:0, zIndex:2, padding:"8px 12px", borderRadius:"0 0 24px 24px", background: wReview === "revision" ? "#E24B4A" : "#C77700", color:"#fff", fontSize:13, fontWeight:700, textAlign:"center", boxSizing:"border-box" }}>
                    {wReview === "revision" ? "⚠️ 修正のお願いがあります（タップして修正）" : "⏳ 審査待ち：運営が確認しています"}
                  </span>
                )}
                {!wTopBack ? (
                  <>
                    {/* 未設定の項目数（編集ページの10ボックス基準）。全て設定済みなら非表示。右上は⇄マークなので左隣に */}
                    {wUnsetCount > 0 && (
                      <span style={{ position:"absolute", top:12, right:52, minWidth:22, height:22, borderRadius:11, background:"#F5A623", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{wUnsetCount}</span>
                    )}
                    <Avatar url={wMini?.avatar_url} name={wMini?.nickname || me?.name} size={84} ring={ROLE_ORANGE} />
                    <span>
                      <span className="f-sans" style={{ display:"block", fontSize:22, fontWeight:800, color:"#222" }}>{wMini?.nickname || me?.name || "名前未設定"}</span>
                      {/* 役割チップ（第11弾）：名前直下・大きめ・橙 */}
                      <span className="f-sans" style={{ display:"inline-block", marginTop:6, fontSize:13, fontWeight:800, color:"#fff", background:ROLE_ORANGE, borderRadius:20, padding:"3px 14px" }}>働き手</span>
                    </span>
                  </>
                ) : (
                  <div className="f-sans" style={{ width:"100%", textAlign:"left" }}>
                    {/* プレビューの統一（2026-07-26たきと指示）：裏面も本物のプレビュー
                        （WorkerPreviewSheet＝農家が見る構造：WorkerTrustCard＋Q&A）と同一にする。
                        trustは本人限定RPC(my_worker_trust_stats)＝worker_trust_infoと同形so そのまま渡せる */}
                    {wMini ? (
                      <>
                        <WorkerTrustCard profile={wMini} trust={wTrust} />
                        {Array.isArray(wMini.pr_qa) && wMini.pr_qa.length > 0 && (
                          <div style={{ display:"grid", gap:10, marginTop:16 }}>
                            {wMini.pr_qa.map(({ q, a }) => (
                              <div key={q}>
                                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
                                <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p style={{ fontSize:13, color:"#999", textAlign:"center", margin:"32px 0" }}>プロフィールは未設定です</p>
                    )}
                  </div>
                )}
              </button>
              <button onClick={(e)=>{
                e.stopPropagation();
                if (wTopAnim === "pflip-out") return; // 連打ガード
                setWTopAnim("pflip-out");
                setTimeout(()=>{ setWTopBack(v=>{ const nv = !v; try { localStorage.setItem("cb_wTopBack", nv ? "1" : "0"); } catch {} return nv; }); setWTopAnim("pflip-in"); }, 400);
              }} aria-label="表示を切り替える" style={{ position:"absolute", top:12, right:12, width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>⇄</button>
            </div>
            {(() => {
              return (<>
                {/* 「きょうの仕事」箱は撤去（2026-07-24・1機能1入口）。
                    「返事待ち」「さがす」「いいね」箱も撤去（2026-07-25たきと指示）：
                    さがす・いいねは下部ナビに常設＝入口の重複。返事待ちは相方のアクション待ちで
                    プロフィール入口に置く用事ではない（応募状況ページ #/profile/worker/applying は存続） */}
                {/* 新しく求職を出す（2026-07-25たきと指示・農家の「新しく求人を出す」と同構造のワイドカード）。
                    ★法務境界（CLAUDE.md絶対遵守）：求職者情報の公開・逆オファーは特定募集情報等提供の
                    届出受理＋設計審査まで実装禁止。本カードはプレースホルダーのみ＝機能・入力・保存なし。
                    タップで反転し「届出の受理を確認しています」を明記する */}
                <div style={{ perspective:800, marginTop:12 }}>
                  <button onClick={()=>setWSeekFlip(v=>!v)} className="f-sans" aria-label="新しく求職を出す（準備中）" style={{
                    position:"relative", width:"100%", background:"transparent", border:"none", padding:0, cursor:"pointer",
                    transformStyle:"preserve-3d", transition:"transform .5s", transform: wSeekFlip ? "rotateY(180deg)" : "none", textAlign:"left",
                  }}>
                    {/* 表面 */}
                    <span style={{ display:"flex", alignItems:"center", gap:14, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden" }}>
                      <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>📝</span>
                      <span>
                        <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>新しく求職を出す</span>
                        <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>働ける日や得意な作業を載せて、農家からの声かけを待てます。</span>
                      </span>
                    </span>
                    {/* 裏面（タップで反転） */}
                    <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", gap:14, background:"#FFF8EF", border:"1px solid #F0E1CC", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", transform:"rotateY(180deg)", backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden" }}>
                      <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>⏳</span>
                      <span>
                        <span className="f-sans" style={{ display:"block", fontSize:15, fontWeight:800, color:"#8A5A00" }}>準備中です</span>
                        <span className="f-sans" style={{ display:"block", fontSize:13, color:"#8A5A00", marginTop:2, lineHeight:1.6 }}>届出の受理を確認しています。確認でき次第、使えるようになります。</span>
                      </span>
                    </span>
                  </button>
                </div>
                <div style={{ marginTop:16 }}>
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_ORANGE, paddingLeft:8 }}>📖 わたしの記録</p>
                  <button onClick={()=>{ setShowWAch(true); setWSeenReviews(wHub.reviewed); try { localStorage.setItem("cb_wSeenReviews", String(wHub.reviewed)); } catch {} }} className="f-sans" style={{ position:"relative", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
                    {wHub.reviewed > wSeenReviews && <span style={{ position:"absolute", top:10, right:12, fontSize:18, lineHeight:1 }}>🌟</span>}
                    <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>🌟</span>
                    <span style={{ flex:1, minWidth:0 }}>
                      <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>わたしの実績</span>
                      <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:4 }}>完了 {wHub.completed}回　🌟 {wHub.wantAgain}　作業 {wHub.hours}時間</span>
                    </span>
                  </button>
                  {/* 📋 経験・できること（自己申告）：わたしの実績の下へ（2026-07-23）。タップで編集ボックスを開く */}
                  {(() => {
                    const chips = wMini ? [
                      ...((Array.isArray(wMini.experience_entries) ? wMini.experience_entries : []).filter(e => e && (e.crop||"").trim()).map(e => `${e.crop}×${e.task||""}${e.duration ? `（${e.duration}）` : ""}`)),
                      ...(wMini.farm_experience ? ["🌾 " + wMini.farm_experience] : []),
                      ...((Array.isArray(wMini.experienced_tasks) ? wMini.experienced_tasks : []).filter(Boolean)),
                      ...(wMini.transport ? ["🚗 " + wMini.transport] : []),
                      ...((Array.isArray(wMini.self_declared) ? wMini.self_declared : []).map(k => (WORKER_DECLARATIONS.find(x=>x.k===k)||{}).chip).filter(Boolean)),
                    ] : [];
                    // ボックスは他と同じ白・グレー枠（2026-07-26たきと指示）。チップ（タグ）の青は残す
                    return (
                      <button onClick={()=>{ try { sessionStorage.setItem("cb_expFromApp","1"); } catch {} window.location.hash="/experience"; }} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"16px", cursor:"pointer", textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", display:"block" }}>
                        <span className="f-sans" style={{ display:"block", fontSize:15, fontWeight:800, color:"#222", marginBottom: chips.length ? 8 : 4 }}>📋 経験・できること（自己申告）</span>
                        {chips.length > 0 ? (<>
                          <span style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:6 }}>
                            {chips.map((c,i) => <span key={i} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#3A5570", background:"#E8EEF7", borderRadius:20, padding:"4px 10px" }}>{c}</span>)}
                          </span>
                          <span className="f-sans" style={{ display:"block", fontSize:10, color:"#A0A8B4", lineHeight:1.5 }}>ご本人の申告です。運営が確認したものではありません。タップして編集</span>
                        </>) : (
                          <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", lineHeight:1.6 }}>作物×作業の経験や、免許・資格を登録できます。タップして登録 →</span>
                        )}
                      </button>
                    );
                  })()}
                </div>
              </>);
            })()}
            {showWAch && (
              <div onClick={()=>setShowWAch(false)} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
                <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:20, padding:"20px", maxWidth:460, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative" }}>
                  <button onClick={()=>setShowWAch(false)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", zIndex:1 }}>✕</button>
                  <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 14px" }}>🌟 わたしの実績</p>
                  {/* 実績が1つでもあれば台帳カードを出す（2026-07-24修正）。旧判定は評価(reviewed)のみを見ており、
                      完了はあるが評価が付いていない（完了1回・評価0）状態でハブの「完了1回」と食い違い、空表示になっていた。
                      WorkerTrustCard の実績ブロック判定（完了/また働きたい/作業時間のいずれか>0）に揃える */}
                  {((wHub.completed || 0) > 0 || (wHub.wantAgain || 0) > 0 || (wHub.hours || 0) > 0)
                    ? <WorkerTrustCard profile={wMini || {}} trust={wTrust} hideSelfDeclare />
                    : <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", lineHeight:1.9, padding:"28px 8px" }}>最初の仕事を終えると、ここに実績が刻まれます</p>}
                </div>
              </div>
            )}
          </>
        ) : (
        <div className="profile-content">
            {/* 浮遊の「← プロフィール」ボックスは削除（2026-07-25たきと指示・農家側の「← 農家プロ」削除と対）。
                戻りは下部ナビのプロフィールタップ（＝働き手トップへ）が担う */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <h2 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", margin:0 }}>{WORKER_TAB_TITLES[wTab]}</h2>
            </div>
            {/* 2026-07-14: プレビューページ廃止＝トップボックスタップで直接編集ページへ。プレビューは編集ページ右上→モーダル */}
            {wTab === "wprofile" ? (
              <WorkerProfileEdit me={me} onAvatarChange={onAvatarChange} onDone={()=>{
                const ret = peekApplyReturn();
                if (ret) { clearApplyReturn(); window.location.hash = "/work/job/" + ret; }
              }} />
            ) : wTab === "applying" ? (
              <WorkerApplications filter="applying" me={me} />
            ) : wTab === "approved" ? (
              <WorkerApplications filter="approved" me={me} />
            ) : null}{/* 旧・カレンダーページは廃止（2026-07-27）。カレンダーはステータスページ(#/saved)の上部へ移植 */}
        </div>
        )
      ) : (
        <>
          {/* 「← プロフィールへ」ボタンは削除（2026-07-14）。働き手側への行き来は浮遊「🤝 働く」トグルが担う */}
          {me&&!me.isWorker&&me.status==="pending"&&(
            <div className="f-sans" style={{margin:"0 auto 16px",padding:"14px 18px",background:"#FFF8E7",border:"1px solid #F5D98F",borderRadius:12,fontSize:13,color:"#8A6D1D",lineHeight:1.7}}>
              🕊 ご登録ありがとうございます。現在、運営が内容を確認しています。<b>承認後に求人の公開ができるようになります</b>（通常1〜2日以内）。
            </div>
          )}
          <FarmerDashboard onNewJob={onNewJob} onResume={onResume} me={me} />
        </>
      )}
      </div>
    </div>
  );
}
