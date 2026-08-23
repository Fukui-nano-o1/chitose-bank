// 分割3-B（2026-07-25）：App.jsxから移動。働き手の応募状況ページ（FlowBar7段・評価モーダル・緊急連絡）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fbSuccess, fbError } from "../lib/feedback";
import { Celebration } from "./Celebration";
import { getCache, setCache } from "../lib/viewCache";
import { useRefreshTick, REFRESH_APPLICATIONS } from "../lib/refreshBus";
import { ymdLocal, calFmtDate, CHAT_ELIGIBLE_STATUSES, appPhaseKey, appPhaseLabelNow, isFinalWorkDone, appWorkDates, mapJobPublicRow, photoThumb } from "../lib/utils";
import { useSheetDragClose } from "../lib/sheetDrag";
import { fetchWorkerReady } from "../lib/workerReady";
import { AutoSkeleton, useSkeletonProbe, FlowBar, Dots, StatusRibbon } from "./ui";
import { JobCard } from "./JobCard";
import { CropIcon } from "./CropIcon";
import { openPhaseInfo } from "../lib/previewBus";
import { AgreedDatesRow, AvailDatesChips } from "./DateChips";
import { WorkerReviewSheet } from "./WorkerReviewSheet";
import { NavIcon, NavIconInline } from "./NavIcons";

export function WorkerApplications({ filter, me }) {
  // 前回この面が出した内容をまず描く→裏で最新に差し替える（2026-07-27たきと指示）
  const [allApps, setAllApps] = useState(() => getCache("wapp:apps") ?? []);
  const [jobDates, setJobDates] = useState(() => getCache("wapp:jobs") ?? {}); // { [job_number]: {date_start, date_end} }
  const [loading, setLoading] = useState(() => getCache("wapp:apps") === undefined);
  // 応募の変化(Realtime)と画面の復帰で取り直す合図（2026-08-18 Speed-1B）
  const refreshTick = useRefreshTick(REFRESH_APPLICATIONS);
  // 画面の状態→キャッシュの写し（2026-07-27）。評価・取消は手元のstateだけを書き換えるため、
  // ここで一括して写す。読み込みが終わるまでは写さない（空を焼き付けない）
  useEffect(() => { if (loading) return; setCache("wapp:apps", allApps); }, [allApps, loading]);
  // 評価済みの応募（自分が書いた評価の行＝記録から導出する。打刻の署名時刻は使わない）
  const [reviewedIds, setReviewedIds] = useState(() => new Set(getCache("wapp:reviewed") ?? []));
  // jobs_public に行が無い求人（失効・見送りなど。ビューは open または 満員closed だけ・20260807021647）の
  // カードの顔を補う材料＝my_job_actions（本人の応募＋いいね・写真/作物/日程/町域つき）。
  // LikedJobsCard・ステータスページと同じRPC・同じキャッシュ "saved:rows" を共用（取得経路を増やさない）
  const [actionRows, setActionRows] = useState(() => getCache("saved:rows") ?? null);
  // 仮応募（第15弾・2026-07-30）：応募の意思だけ預かった行と、必須項目の残り
  const [pendingApps, setPendingApps] = useState([]);
  const [readyState, setReadyState] = useState(null); // { ready, missing:[...] }
  const cancelPending = async (p) => {
    if (!window.confirm("この仮応募を取り消しますか？")) return;
    // RLS「pending own」で自分の行だけ消せる（取り消しは本人の操作＝記録は残さず預かりを解く）
    const { error } = await supabase.from("pending_applications").delete().eq("id", p.id);
    if (error) { alert("取り消しに失敗しました：" + error.message); return; }
    setPendingApps(prev => prev.filter(x => x.id !== p.id));
  };
  const [respByFarmer, setRespByFarmer] = useState({}); // { [farmer_id]: avg_response_hours }（第9弾・返答傾向）
  // 過去の応募の折りたたみ（pastOpen）は廃止＝常に展開（2026-08-22たきと指示「過去の応募は閉じないで」）
  // あなたの求人ページと同じ構造（2026-08-22たきと指示「あなたの求人ページと同じ構造にしよう。文言は編集するな」）：
  // 応募中⇄過去の応募の上部タブ＋指に追従するページャー＋正方形カードの横3列グリッド。
  // ★ページャーは FarmerDashboard（作成中⇄公開中）の写し＝挙動を変えるときは両方を揃える。
  //   タブはこのページの中の面切替ので hash は書かない（URLは /profile/worker/applying の1本のまま）
  const [wapTab, setWapTab] = useState("now"); // "now"=応募中 / "past"=過去の応募
  const pagerTrackRef = useRef(null);
  const pagerDrag = useRef(null); // {x, y, dx, lock:"h"|"v"|null, w}
  const pagerBasePct = () => (wapTab === "now" ? 0 : -50);
  const onPagerStart = (e) => {
    pagerDrag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: null, w: e.currentTarget.clientWidth || 1 };
  };
  const onPagerMove = (e) => {
    const s = pagerDrag.current, el = pagerTrackRef.current;
    if (!s || !el) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 方向が定まるまで様子見
      s.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (s.lock !== "h") return; // 縦スクロール中は関与しない
    const atEdge = (wapTab === "now" && dx > 0) || (wapTab === "past" && dx < 0);
    s.dx = atEdge ? dx / 3 : dx;
    el.style.transition = "none";
    el.style.transform = `translateX(calc(${pagerBasePct()}% + ${s.dx}px))`;
  };
  const onPagerEnd = () => {
    const s = pagerDrag.current, el = pagerTrackRef.current;
    pagerDrag.current = null;
    if (!s || !el || s.lock !== "h") return;
    el.style.transition = "transform .3s ease"; // dragで消したtransitionはReactが復元しないので手で戻す
    const threshold = Math.min(80, s.w / 4);
    if (wapTab === "now" && s.dx < -threshold) {
      el.style.transform = "translateX(-50%)"; setWapTab("past");
    } else if (wapTab === "past" && s.dx > threshold) {
      el.style.transform = "translateX(0%)"; setWapTab("now");
    } else {
      el.style.transform = `translateX(${pagerBasePct()}%)`; // 届かなければ元の位置へスナップバック
    }
  };
  // 評価（Part2）：フォームと保存は共有部品 WorkerReviewSheet が持つ（今日ページの「仕事の評価」と
  // 同じ入力を使う＝2箇所で枝分かれさせない・2026-08-19）。ここが持つのは「どの応募を開いているか」だけ
  const [reviewModalApp, setReviewModalApp] = useState(null);
  // 完了の祝祭（2026-08-06）：評価送信の成功時。演出のみ＝記録には触れない
  const [celebrate, setCelebrate] = useState(null);
  const openReviewModal = (a) => setReviewModalApp(a);

  // 欠勤記録への異議申立（Part2・attended=falseの代替導線）
  const [disputeModalApp, setDisputeModalApp] = useState(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const submitDispute = async () => {
    if (!disputeModalApp || !disputeReason.trim() || disputeSubmitting) return;
    setDisputeSubmitting(true);
    try {
      const { error } = await supabase.from('attendance_events').insert({
        application_id: disputeModalApp.id, actor_id: me.id, kind: 'dispute_no_show', reason: disputeReason.trim(),
      });
      if (error) { alert('送信に失敗しました：' + error.message); setDisputeSubmitting(false); return; }
      setAllApps(prev => prev.map(x => x.id===disputeModalApp.id ? { ...x, _disputed: true } : x));
      setDisputeModalApp(null); setDisputeReason("");
    } catch { alert('送信に失敗しました。'); }
    setDisputeSubmitting(false);
  };

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        // 仮応募（第15弾・2026-07-30）：意思だけ預かった行と、あと何項目かの内訳を同時に取る
        const [appsRes, pendRes, readyRes, revRes] = await Promise.all([
          supabase.from("applications").select("*").eq("worker_id", session.user.id).order("created_at",{ascending:false}),
          supabase.from("pending_applications").select("id,job_number,created_at").order("created_at",{ascending:false}).then(r => r, () => ({ data: [] })),
          fetchWorkerReady().then(r => r, () => null),
          // 評価済みの判定（打刻の署名時刻の代わり）。失敗時は手元の値を上書きしない（2026-08-07規則）
          supabase.from("reviews").select("application_id").eq("reviewer_id", session.user.id).then(r => r, () => ({ error: true })),
        ]);
        setPendingApps(pendRes.data || []);
        if (!revRes.error && revRes.data) {
          const ids = revRes.data.map(r => r.application_id).filter(Boolean);
          setReviewedIds(new Set(ids)); setCache("wapp:reviewed", ids);
        }
        if (readyRes) setReadyState(readyRes);
        const { data, error } = appsRes;
        if (!error && data) {
          setAllApps(data);
          // 求人の日程と農家の返答傾向は互いに独立なので同時に投げる（2026-07-27たきと指示「直列を並列に」）
          const jobNumbers = [...new Set([...data.map(a => a.job_number), ...(pendRes.data || []).map(p => p.job_number)].filter(Boolean))];
          // 農家の返答傾向（第9弾・2026-07-22）：返事待ち(applied)の各求人の農家について、信頼カードの返答速度を転用。
          // employer_trust_info(avg_response_hours) を farmer_id ごとに引き、当日中/1日以内/2日以内のバケットで表示する
          const waitFarmerIds = [...new Set(data.filter(a => a.status === "applied").map(a => a.farmer_id).filter(Boolean))];
          const [jobRes, respEntries] = await Promise.all([
            // 全列で引く（2026-08-22たきと指示「さがすページと同じ求人カード一覧構造に」＝
            // JobCardの材料 mapJobPublicRow が全列を前提にするため）。キャッシュ(wapp:jobs)には
            // この生の行（JSON安全）だけを置き、Dateを含む整形後は描画のたびに作る（2026-08-03の実害の型）
            jobNumbers.length > 0
              ? supabase.from("jobs_public").select("*").in("job_number", jobNumbers).then(r => r, () => ({ data: [] }))
              : Promise.resolve({ data: [] }),
            waitFarmerIds.length > 0
              ? Promise.all(waitFarmerIds.map(async fid => {
                  try { const { data: t } = await supabase.rpc("employer_trust_info", { p_farmer_id: fid }); return [fid, (t && t.ok) ? t.avg_response_hours : null]; }
                  catch { return [fid, null]; }
                }))
              : Promise.resolve([]),
          ]);
          if (jobNumbers.length > 0) {
            const map = {};
            (jobRes.data || []).forEach(j => { map[j.job_number] = j; });
            setJobDates(map); setCache("wapp:jobs", map);
            // jobs_public に行が無かった求人（失効・見送りなどの過去の応募に多い）の顔を
            // my_job_actions で補う（2026-08-22たきと報告「失効ラベルの求人が復元されていない」）。
            // セッションは上で確認済みなので空配列の再確認は不要。失敗時は手元の値を上書きしない（2026-08-07規則）
            if (jobNumbers.some(n => !map[n])) {
              try {
                const actRes = await supabase.rpc("my_job_actions");
                if (!actRes.error && Array.isArray(actRes.data)) { setActionRows(actRes.data); setCache("saved:rows", actRes.data); }
              } catch {}
            }
          }
          if (respEntries.length > 0) setRespByFarmer(Object.fromEntries(respEntries));
        }
      } catch {}
      setLoading(false);
    })();
    // refreshTick＝応募の変化(Realtime)と画面の復帰の合図（2026-08-18 Speed-1B）。
    // 合図は「変わった」だけ＝中身はこの窓口から取り直す。loadingは立て直さないので骨は出ない
  }, [refreshTick]);

  // 応募の取消（承認前のみ・本人）
  const [cancelingId, setCancelingId] = useState(null);
  const cancelApplication = async (a) => {
    if (cancelingId) return;
    if (!window.confirm("この応募を取り消しますか？農家にお知らせが届きます")) return;
    setCancelingId(a.id);
    try {
      const { data, error } = await supabase.rpc('cancel_application', { p_application_id: a.id });
      // 2026-08-16：取り消しは削除でなく記録（status='canceled'）。already=既に取り消し済みも成功扱い。
      // ローカルもstatus更新＝カードは「過去の応募（取り消し）」へ移る（表示は記録から導出）
      if (!error && data && data.ok) setAllApps(prev => prev.map(x => x.id === a.id ? { ...x, status: 'canceled', canceled_at: new Date().toISOString() } : x));
      // not_found＝行が既に無い（旧DELETE時代の残り）＝取り消し済みとして扱う
      else if (!error && data && data.reason === 'not_found') setAllApps(prev => prev.filter(x => x.id !== a.id));
      else alert('取り消しに失敗しました：' + (data?.reason || error?.message || '不明'));
    } catch { alert('取り消しに失敗しました。'); }
    setCancelingId(null);
  };

  // filter: "applying"=応募中(applied), "approved"=承認済み(approved以降), 見送り(rejected)はどちらにも出さない(通知で知らせる)
  const apps = allApps.filter(a => {
    if (filter === "applying") return a.status === "applied";
    // きょうの仕事＝採用された仕事だけ（2026-07-27たきと指示）。面接中（承認されたが採用前）は
    // 「返事待ち」側の面が担う。採用の実体は両者の確認時刻が揃っていること
    // （採用してもstatusは'approved'のまま＝contractedはDBに書かれない表示用の値・CLAUDE.md）
    if (filter === "approved") return ["contracted","working","completed"].includes(a.status)
      || (!!a.terms_confirmed_worker_at && !!a.terms_confirmed_farmer_at && a.status !== "rejected" && a.status !== "expired");
    return a.status !== "rejected" && a.status !== "canceled";
  });
  // リアルタイム帯（2026-07-25）：応募中→面接中→採用→作業中→完了（appPhaseKeyで導出）
  // 「作業中」は【いま】で出す（2026-08-19たきと指示）：作業日でない日・その日の終了時刻を過ぎた後は
  // 「次は M/D(曜)」。材料は応募行（合意した日・来られる日）＋求人の日程（jobDates）
  const label = (a) => a.status==="applied" ? "応募中"
    : (appPhaseLabelNow(a, { ...a, ...(jobDates[a.job_number] || {}) }) || a.status);
  const color = (s) => s==="approved"||s==="contracted"||s==="working" ? {bg:"#E6F7EE",fg:"#00A86B"} : s==="rejected" ? {bg:"#F3F3F3",fg:"#999"} : {bg:"#FFF4E0",fg:"#C77700"};
  // 承認済みタブのグリッド用（農家の作成中ページと同設計・2026-07-16）
  const [sheetAppId, setSheetAppId] = useState(null); // タップした応募のボトムシート
  // 下スワイプで閉じる（指に連動・応募者ページのボックスと同じ規則・2026-08-19）
  const appSheetSheetRef = useRef(null), appSheetScrollRef = useRef(null);
  useSheetDragClose(appSheetSheetRef, appSheetScrollRef, ()=>setSheetAppId(null), !!sheetAppId);
  // 仮配置の骨を測るref：タブごとに形が違う（返事待ち／きょうの仕事）ので鍵も分ける
  const skelRef = useSkeletonProbe("wapp:" + filter);
  // 帯は「働き手側の実態」を出す：農家が完了記録済みでも、こちらの終了確認・評価が残っていれば「評価待ち」
  const ribbonLabel = (a) => {
    if (a.status === "completed") {
      if (a.attended === false) return "欠勤記録";
      if (!reviewedIds.has(a.id)) return "評価待ち";
      return "完了";
    }
    return label(a);
  };
  const ribbonColor = (a) => {
    if (a.status === "completed") return (a.attended === false || reviewedIds.has(a.id)) ? "#9E9E9E" : "#E24B4A";
    return a.status === "working" ? "#C77700" : "#00A86B";
  };
  // 未完了＝働き手側の手続きが残っている応募（完了して評価済み/欠勤記録済みになるまで）
  const isAppDone = (a) => a.status === "completed" && (a.attended === false || reviewedIds.has(a.id));
  // 応募カード本体（返事待ちタブのリスト表示と、きょうの仕事タブのボトムシートで共用）
  const renderAppCard = (a) => {
    const c = color(a.status);
    return (
      <div key={a.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
                <div onClick={()=>openPhaseInfo(appPhaseKey(a))} role="button" style={{ display:"inline-block", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, marginBottom:8, background:c.bg, color:c.fg, cursor:"pointer" }}>{label(a)}</div>
                <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 4px" }}>{[jobDates[a.job_number]?.crop, jobDates[a.job_number]?.task].filter(Boolean).join(" ") || "求人"} <span style={{ color:"#999", fontWeight:700, fontSize:12 }}>#{a.job_number}</span></p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:8 }}>応募日 {new Date(a.created_at).toLocaleDateString("ja-JP")}</p>
                <AvailDatesChips value={a.available_dates} agreed={a.agreed_dates} />
                <AgreedDatesRow value={a.agreed_dates} />
                {/* お仕事の流れ（応募→承認→面接→採用→仕事→完了報告→評価）を可視化（2026-07-19／07-25） */}
                {a.status !== "applied" && <div style={{ marginBottom:14 }}><FlowBar a={{ ...a, _reviewed: reviewedIds.has(a.id) }} /></div>}
                {/* 評価（Part2）：最終の作業日から出す（2026-08-19たきと指示
                    「最終日だけ全体的な評価を入力。これは全ての工程の終了を意味する」）。
                    それより前の作業日は評価ではなく「今日の記録」（遅刻・欠勤・農家に会えない）＝
                    今日ページの📋今日の記録の箱が受け持つ。
                    ★今日ページの⭐仕事の評価の箱と同じ窓にする＝箱が灯っているのにここにボタンが無い、
                      逆にここにボタンがあるのに箱が無い、のどちらも作らない。判定は lib/utils の
                      isFinalWorkDone（DBの my_todo_items と同じ物差し＝app_work_dates の最終日）。
                    DBの壁(trg_reviews_phase_gate)も worker_to_farmer は working 以上を許す */}
                {(a.status === "completed"
                  || (a.status === "working" && isFinalWorkDone(a, jobDates[a.job_number]))) && (
                  a.attended === false ? (
                    a._disputed ? (
                      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#717171", margin:"0 0 8px", textAlign:"center" }}>異議申立を送信しました</p>
                    ) : (
                      <button onClick={()=>{ setDisputeModalApp(a); setDisputeReason(""); }} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer", marginBottom:8 }}>異議申立</button>
                    )
                  ) : reviewedIds.has(a.id) ? (
                    <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#00A86B", margin:"0 0 8px", textAlign:"center" }}><NavIconInline name="tick" size={13} style={{ verticalAlign:"-2px" }} />評価済み</p>
                  ) : (
                    <button onClick={()=>openReviewModal(a)} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", marginBottom:8 }}><NavIconInline name="star" size={13} style={{ verticalAlign:"-2px" }} />仕事の評価</button>
                  )
                )}
                {/* 2026-07-13 労働局確認済み・当事者間の直接連絡は適法（CLAUDE.md参照） */}
                {(a.status==="approved"||a.status==="meeting"||a.status==="interview"||a.status==="contracted"||a.status==="working") && (
                  <button onClick={()=>{ window.location.hash="/chat/"+a.id; }} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>チャットを開く</button>
                )}
                {/* 応募の取消（承認前のみ・テキストリンクで控えめに） */}
                {a.status === "applied" && (
                  <button onClick={()=>cancelApplication(a)} disabled={cancelingId===a.id} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:8, background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#717171", textDecoration:"underline" }}>
                    {cancelingId===a.id ? <>取り消し中<Dots /></> : "応募を取り消す"}
                  </button>
                )}
      </div>
    );
  };
  // 応募した求人の一覧カード（2026-08-22たきと指示「さがすページと同じ求人カード一覧構造に」）：
  // さがすと同じ JobCard variant="list" ＝顔を独自に描かない（JobCardが唯一のソース）。
  // カードの上に段階チップ（応募中／評価待ち等）だけ添え、タップで従来の詳細カード
  // （3段プログレス・期限の約束・評価・チャット・取り消し）をボトムシートに展開＝
  // 仕事の評価ページ・ステータスページと同じ「カード一覧＋タップで展開」の作法。
  // ★終了帯：返事待ちタブでは出す（募集終了＝応募がまもなく失効する正直な情報）／
  //   きょうの仕事タブでは hideEndLabel（自分が採用された求人に「掲載終了」と出て読み違える
  //   ＝2026-08-17の理由。段階はチップとシート内の流れバーが語る）
  // opts.chip＝段階チップの上書き（過去の応募＝見送り・取り消し・失効の灰色チップ用）／
  // opts.onOpen＝カードタップの行き先の上書き（過去の応募＝シートでなく求人ページへ）
  const renderJobCardRow = (a, opts = {}) => {
    const raw = jobDates[a.job_number];
    const approvedTab = filter === "approved";
    const chip = opts.chip || (approvedTab
      ? { label: ribbonLabel(a), fg: ribbonColor(a), bg: ribbonColor(a) === "#00A86B" ? "#E6F7EF" : ribbonColor(a) === "#C77700" ? "#FFF4E0" : "#F3F3F3" }
      : { label: label(a), fg: color(a.status).fg, bg: color(a.status).bg });
    const open = opts.onOpen || (() => setSheetAppId(a.id));
    return (
      <div key={a.id} className={approvedTab && !isAppDone(a) ? "cb-urgent-card" : undefined}>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
          <span onClick={()=>openPhaseInfo(appPhaseKey(a))} role="button" className="f-sans"
            style={{ display:"inline-block", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:chip.bg, color:chip.fg, cursor:"pointer" }}>{chip.label}</span>
        </div>
        {(() => {
          if (raw) return <JobCard job={mapJobPublicRow(raw)} variant="list" hideEndLabel={approvedTab} onOpen={open} />;
          // jobs_public に行が無い求人（失効・見送りなど）：my_job_actions の行から仮の姿を組む＝
          // LikedJobsCard・ステータスページの展開ボックスと同じフォールバック。
          // 報酬は取れないので pay:0（JobCard側が0円を出さず空にする・ダミー禁止）。closed の帯も同じに出す
          const fb = Array.isArray(actionRows) ? actionRows.find(r => r.job_number === a.job_number) : null;
          if (fb) return <JobCard variant="list" hideEndLabel={approvedTab} onOpen={open} job={{
            id: fb.job_number, crop: fb.crop || "", task: fb.task || "", photos: fb.photos || [],
            region: fb.town || "", dateStartRaw: fb.date_start || "", dateEndRaw: fb.date_end || "",
            pay: 0, closed: fb.job_status === "closed",
          }} />;
          // それでも引けなかった時：#No.だけの最小カード＝一覧から落とさない
          return (
            <button onClick={open} className="f-sans"
              style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px 14px", cursor:"pointer", marginBottom:22 }}>
              <span style={{ display:"block", fontSize:15, fontWeight:700, color:"#222" }}>求人</span>
              <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2 }}>#{a.job_number}</span>
            </button>
          );
        })()}
      </div>
    );
  };
  // 正方形カード（あなたの求人ページの作成中/公開中カードの写し・横3列グリッド用・2026-08-22）。
  // ・応募中面＝タブ名と同じ帯は出さない（重複排除＝求人ページと同じ規則）
  // ・過去面＝終端の事実を帯で（見送り・取り消し・失効・掲載取り下げ＝従来のチップと同じ語）＋写真グレースケール
  //   （求人ページの終了カードと同じ見せ方）
  // ・タップ＝応募中はボトムシート（詳細・操作）／過去は求人ページへ（終わった応募に操作は無い）
  // ・写真が無い求人は作物アイコン（最新のフルカラー・CropIcon）
  const renderSquareCard = (a, opts = {}) => {
    const raw = jobDates[a.job_number];
    const fb = !raw && Array.isArray(actionRows) ? actionRows.find(r => r.job_number === a.job_number) : null;
    const src = raw || fb || {};
    const photo = photoThumb(src.photos?.[0]);
    const title = [src.crop, src.task].filter(Boolean).join(" ") || ("求人 #" + a.job_number);
    const open = opts.past
      ? () => { try { sessionStorage.setItem("cb_jobBackTo", window.location.hash.replace(/^#/, "")); } catch {} window.location.hash = "/work/job/" + a.job_number; }
      : () => setSheetAppId(a.id);
    const ribbon = opts.past
      ? { label: a.status === "rejected" ? (a.rejected_reason === "unpublished" ? "掲載取り下げ" : "見送り") : a.status === "canceled" ? "取り消し" : "失効", color:"#757575" }
      : null;
    return (
      <button key={a.id} onClick={open} className="f-sans"
        style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
        <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
          {photo
            ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter: opts.past ? "grayscale(40%)" : "none" }} />
            : <CropIcon crop={src.crop} size={36} fallback="🌾" />}
          {ribbon && <StatusRibbon label={ribbon.label} color={ribbon.color} />}
        </div>
        <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</p>
      </button>
    );
  };
  // ── 返事待ちページの役割強化（第9弾・2026-07-22）───────────────────────────
  // 過去の応募（見送り・失効）：applyingタブの下に折りたたみで分離。現状statusは rejected（見送り）
  const pastApps = allApps.filter(a => ["rejected", "expired", "canceled"].includes(a.status));
  // 作業日の前日（date_start-1）を "YYYY-MM-DD" で返す
  const dayBefore = (ymd) => {
    if (!ymd) return null;
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - 1);
    const p = n => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  };
  // 返答速度（時間）→ おおむねバケット。データ不足(null)・48h超は非表示
  const respBucket = (hours) => hours == null ? null : hours <= 12 ? "当日中" : hours <= 24 ? "1日以内" : hours <= 48 ? "2日以内" : null;
  // 返事待ちカード（応募中＝applied専用の再設計・上図の構成）
  const WAIT_STEPS = ["応募", "農家が確認中", "結果"];
  const renderWaitingCard = (a) => {
    const job = jobDates[a.job_number] || {};
    const title = [job.crop, job.task].filter(Boolean).join(" ") || "求人";
    const town = [job.city, job.town].filter(Boolean).join("");
    const wage = job.pay_type === "日給"
      ? (Number(job.daily_wage) ? `日給${Number(job.daily_wage).toLocaleString()}円` : "")
      : (Number(job.hourly_wage) ? `時給${Number(job.hourly_wage).toLocaleString()}円` : "");
    const summary = [job.date_start ? calFmtDate(job.date_start) : "", job.work_time || "", wage, town].filter(Boolean).join("　");
    // ⏰約束の分岐（2026-07-22）：終了/開始超過→終了文／期限日(前日)が過去→失効予告／通常→前日までに。過去日付は絶対に出さない
    const startYmd = job.date_start || null;
    const startMoment = (() => {
      if (!startYmd) return null;
      const [Y, M, D] = startYmd.split("-").map(Number);
      const tm = job.work_time && String(job.work_time).match(/(\d{1,2}):(\d{2})/); // "H:MM〜..." の先頭＝開始時刻。無ければ日末扱い
      return new Date(Y, M - 1, D, tm ? parseInt(tm[1], 10) : 23, tm ? parseInt(tm[2], 10) : 59);
    })();
    // 求人がjobs_public(open)に無い＝閉鎖/充足、または開始時刻を過ぎた＝終了
    const jobEnded = !startYmd || (!!startMoment && Date.now() > startMoment.getTime());
    const deadlineYmd = startYmd ? dayBefore(startYmd) : null;
    const deadlinePast = deadlineYmd ? (deadlineYmd < ymdLocal(new Date())) : false;
    const deadline = deadlineYmd ? calFmtDate(deadlineYmd) : null;
    const bucket = respBucket(respByFarmer[a.farmer_id]);
    const activeIdx = 1; // 現在＝2段目（農家が確認中）
    return (
      <div key={a.id} style={{ border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", background:"#fff" }}>
        {/* 求人要約行（日付・時間帯・時給・町名。タップで求人詳細へ） */}
        <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", window.location.hash.replace(/^#/, "")); } catch {} window.location.hash = "/work/job/" + a.job_number; }}
          className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"none", border:"none", padding:0, cursor:"pointer" }}>
          <p style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 4px" }}>{title} <span style={{ color:"#999", fontWeight:700, fontSize:12 }}>#{a.job_number}</span></p>
          <p style={{ fontSize:12, color:"#717171", margin:0, lineHeight:1.6 }}>{summary || `応募日 ${new Date(a.created_at).toLocaleDateString("ja-JP")}`}</p>
        </button>
        {/* 3段プログレス（応募→農家が確認中→結果・現在=2段目） */}
        <div style={{ display:"flex", alignItems:"flex-start", margin:"14px 0 12px" }}>
          {WAIT_STEPS.map((s, i) => {
            const isDone = i < activeIdx; const isActive = i === activeIdx; const reached = isDone || isActive;
            return (
              <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
                {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? "#00A86B" : "#E5E5E5" }} />}
                <div style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, boxSizing:"border-box",
                  background: isDone ? "#00A86B" : "#fff", border: isDone ? "none" : isActive ? "2px solid #00A86B" : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? "#00A86B" : "#C8C8C8" }}>
                  {isDone ? <NavIcon name="tick" size={11} /> : ""}
                </div>
                <span className="f-sans" style={{ fontSize:9, marginTop:4, lineHeight:1.2, textAlign:"center", color: reached ? "#00A86B" : "#B0B0B0", fontWeight: isActive ? 700 : 500 }}>{s}</span>
              </div>
            );
          })}
        </div>
        {/* 期限の約束（2026-07-22 分岐）：終了→終了文／期限日が過去→失効予告／通常→前日までに（過去日付は出さない） */}
        {jobEnded ? (
          <div style={{ background:"#F3F3F3", border:"1px solid #E0E0E0", borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#717171", margin:0, lineHeight:1.7 }}>この求人は終了しました。応募はまもなく自動で失効し、お知らせが届きます</p>
          </div>
        ) : deadlinePast ? (
          <div style={{ background:"#FFF8E7", border:"1px solid #F5D98F", borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#8A6D1D", margin:0, lineHeight:1.7 }}>⏰ 開始時刻までに返事がない場合は、自動で失効のお知らせが届きます</p>
          </div>
        ) : deadline ? (
          <div style={{ background:"#FFF8E7", border:"1px solid #F5D98F", borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#8A6D1D", margin:0, lineHeight:1.7 }}>⏰ 遅くとも <b>{deadline}</b> までに必ず結果が届きます</p>
            <p className="f-sans" style={{ fontSize:11, color:"#B08A2E", margin:"2px 0 0", lineHeight:1.6 }}>（返事がない場合も自動でお知らせします）</p>
          </div>
        ) : null}
        {/* 農家の返答傾向（信頼カードの返答速度を転用・データ不足時は非表示） */}
        {bucket && (
          <p className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#0B6B4F", margin:"0 0 2px" }}><NavIconInline name="chats" size={12} style={{ verticalAlign:"-1.5px" }} />この農家さんの返答：これまで おおむね{bucket}</p>
        )}
        {/* 応募を取り消す（小さくグレーで最下部へ降格） */}
        <button onClick={()=>cancelApplication(a)} disabled={cancelingId===a.id} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:10, background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#B0B0B0", textDecoration:"underline" }}>
          {cancelingId===a.id ? <>取り消し中<Dots /></> : "応募を取り消す"}
        </button>
      </div>
    );
  };
  // 待っている間にできること（カード群の下）
  // 仮応募（第15弾・2026-07-30たきと指示）：プロフィール待ちで預かっている応募。
  // 「あと◯項目」はDBと同じ条件（lib/workerReady）から出す＝画面ごとに必須セットを作らない
  const pendingBlock = pendingApps.length > 0 && (
    <div style={{ background:"#FFF8E7", border:"1px solid #F0E0B8", borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#8A6D1D", margin:"0 0 4px" }}>⏳ 仮応募（プロフィール待ち・{pendingApps.length}）</p>
      <p className="f-sans" style={{ fontSize:12, color:"#8A6D1D", margin:"0 0 10px", lineHeight:1.7 }}>
        {readyState && readyState.missing.length > 0
          ? `あと${readyState.missing.length}項目で応募が届きます`
          : "必須項目はそろっています。プロフィールを保存すると応募が届きます"}
      </p>
      <div style={{ display:"grid", gap:8 }}>
        {pendingApps.map(p => {
          const job = jobDates[p.job_number] || {};
          return (
            <div key={p.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, background:"#fff", border:"1px solid #F0E0B8", borderRadius:10, padding:"10px 12px" }}>
              <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/profile/worker/applying"); } catch {} window.location.hash = "/work/job/" + p.job_number; }}
                className="f-sans" style={{ flex:1, minWidth:0, textAlign:"left", background:"none", border:"none", padding:0, cursor:"pointer", fontSize:13, fontWeight:600, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {[job.crop, job.task].filter(Boolean).join(" ") || ("求人 #" + p.job_number)}
                <span style={{ color:"#B0B0B0", fontWeight:700, fontSize:11 }}> #{p.job_number}</span>
              </button>
              <button onClick={()=>cancelPending(p)} className="f-sans" style={{ flexShrink:0, background:"none", border:"none", fontSize:11, color:"#B0B0B0", textDecoration:"underline", cursor:"pointer" }}>取り消す</button>
            </div>
          );
        })}
      </div>
      <button onClick={()=>{ window.location.hash = "/apply/pending"; }} className="f-sans" style={{ display:"block", width:"100%", marginTop:10, padding:"12px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>プロフィールを仕上げる →</button>
    </div>
  );
  const waitingTodoBox = (
    <div style={{ background:"#F7FBF9", border:"1px solid #DDEDE5", borderRadius:14, padding:"14px 16px", marginTop:16 }}>
      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#0B6B4F", margin:"0 0 10px" }}><NavIconInline name="clip" size={13} style={{ verticalAlign:"-2px" }} />待っている間にできること</p>
      <button onClick={()=>{ window.location.hash = "/profile/worker/profile"; }} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #DDEDE5", borderRadius:10, padding:"12px 14px", fontSize:13, fontWeight:700, color:"#00A86B", cursor:"pointer", marginBottom:8 }}><NavIconInline name="star" size={13} style={{ verticalAlign:"-2px" }} />農家がよく見る質問に答える →</button>
      <button onClick={()=>{ window.location.hash = "/search"; }} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #DDEDE5", borderRadius:10, padding:"12px 14px", fontSize:13, color:"#222", cursor:"pointer", lineHeight:1.6 }}>同じ日の別の求人にも応募できます <span style={{ color:"#00A86B", fontWeight:700 }}>→さがす</span></button>
    </div>
  );
  // 過去の応募：折りたたみは廃止し常に展開（2026-08-22たきと指示「過去の応募は閉じないで」）。
  // さがすと同じ求人カードで並べる。チップは終端の事実（見送り・取り消し・失効）。
  // 掲載取り下げ（rejected_reason='unpublished'）は見送りと区別（2026-08-08たきと指示・
  // 選考の結果ではないことを表示でも示す）。
  // タップはシートでなく求人ページへ（終わった応募に操作は無い＝見るだけ）。終了帯は既定どおり出す
  // 過去の応募の縦一列ブロック（pastAppsBlock）は廃止＝求人ページと同じ構造の「過去の応募」タブ・
  // 正方形カードグリッドへ（2026-08-22たきと指示「あなたの求人ページと同じ構造にしよう」）。
  // 見出し「過去の応募（N）」の語はタブに移った（文言は不変）
  // ─────────────────────────────────────────────────────────────────────────
  // お仕事の流れ（FLOW_STEPS/flowState/FlowBar）は components/ui.jsx へ移設（2026-08-16）：
  // ステータスページのボックスでも同じ進み具合を展開表示するため、見た目・段の定義を1箇所に。
  return (
    // あなたの応募（applying）はタイトルと横線を出さない（2026-08-22たきと指示）＝
    // 見出しはProfileHub側で非表示・横線(borderTop)と見出しぶんの余白はここで外す。きょうの仕事は従来どおり
    <div style={filter !== "approved" ? { marginTop:8 } : { marginTop:32, paddingTop:32, borderTop:"1px solid #EEE" }}>
      {celebrate && <Celebration {...celebrate} onDone={()=>setCelebrate(null)} />}
      {/* ラベル「応募状況」＋説明文は見出し直下（2026-08-22たきと指示で一度 過去の応募の下へ移した後、
          「あなたが応募した求人の状況です。は応募状況の下に移植」で元の並びに復帰）。
          見出し「あなたの応募」は ProfileHub の WORKER_TAB_TITLES が出す */}
      {filter !== "approved" && (<>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", letterSpacing:".08em", marginBottom:4 }}>応募状況</p>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>あなたが応募した求人の状況です。</p>
      </>)}
      {/* お仕事の流れバナー（説明ボックス）は削除（2026-07-27たきと指示）：
          同じ7段は各求人カードの流れバーが出しているので重複 */}
      {/* 読み込み中は仮配置（前回この面が描いた形・2026-07-27たきと指示「1秒以上かかるページに」）。
          応募＋求人＋プロフィールで数往復するので、文字の「読み込み中...」では待ちが長く感じる */}
      {loading ? (
        <AutoSkeleton shapeKey={"wapp:" + filter} />
      ) : filter !== "approved" ? (
        // 返事待ちタブ（第9弾）：仮応募＋応募中カード（再設計）＋待っている間にできること＋過去の応募
        (apps.length === 0 && pastApps.length === 0 && pendingApps.length === 0) ? (
          <div style={{ textAlign:"center", padding:"32px 20px", color:"#999" }} className="f-sans">
            <div style={{ fontSize:36, marginBottom:10 }}>🌱</div>
            <p style={{ fontSize:14, margin:0, lineHeight:1.7 }}>いまは待つだけ。作業日の前日までに必ず結果が届きます</p>
            <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>「さがす」から求人に応募できます。</p>
          </div>
        ) : (
          // あなたの求人ページと同じ構造（2026-08-22たきと指示）：上部タブ（応募中⇄過去の応募）＋
          // 指に追従するページャー＋正方形カードの横3列グリッド。文言は既存の語のみ
          <>
            <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
              {[
                { k:"now",  l:"応募中",     n:apps.length },
                { k:"past", l:"過去の応募", n:pastApps.length },
              ].map(t => (
                <button key={t.k} onClick={()=>setWapTab(t.k)} className="f-sans"
                  style={{ flex:1, padding:"11px 0", borderRadius:12, border: wapTab===t.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:14, fontWeight: wapTab===t.k ? 800 : 600, color: wapTab===t.k ? "#222" : "#999", cursor:"pointer" }}>
                  {t.l}{t.n > 0 ? `（${t.n}）` : ""}
                </button>
              ))}
            </div>
            <div onTouchStart={onPagerStart} onTouchMove={onPagerMove} onTouchEnd={onPagerEnd} style={{ overflow:"hidden", touchAction:"pan-y" }}>
              <div ref={pagerTrackRef} style={{ display:"flex", width:"200%", transform: wapTab==="now" ? "translateX(0%)" : "translateX(-50%)", transition:"transform .3s ease" }}>
                <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingRight:5 }}>{/* 応募中パネル */}
                  {pendingBlock}
                  {(apps.length === 0 && pendingApps.length === 0) ? (
                    <div style={{ textAlign:"center", padding:"32px 20px", color:"#999" }} className="f-sans">
                      <div style={{ fontSize:36, marginBottom:10 }}>🌱</div>
                      <p style={{ fontSize:14, margin:0, lineHeight:1.7 }}>いまは待つだけ。作業日の前日までに必ず結果が届きます</p>
                      <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>「さがす」から求人に応募できます。</p>
                    </div>
                  ) : (
                    apps.length > 0 && <div ref={skelRef} style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>{apps.map(a => renderSquareCard(a))}</div>
                  )}
                  {waitingTodoBox}
                </div>
                <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingLeft:5 }}>{/* 過去の応募パネル */}
                  {pastApps.length > 0 && (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
                      {pastApps.map(a => renderSquareCard(a, { past: true }))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )
      ) : apps.length === 0 ? (
        <div style={{ textAlign:"center", padding:"32px 20px", color:"#999" }} className="f-sans">
          <div style={{ fontSize:36, marginBottom:10 }}>🌱</div>
          <p style={{ fontSize:14, margin:0, lineHeight:1.7 }}>仕事が決まると、ここに当日やることが出ます</p>
          <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>農家が承認すると、ここに表示されます。</p>
        </div>
      ) : (
        // さがすと同じ求人カード一覧（2026-08-22たきと指示・旧52pxサムネ行＋FlowBarはシートの中の応募カードが担う）。
        // タップでボトムシート（従来どおり）
        <div ref={skelRef}>
          {apps.map(a => renderJobCardRow(a))}
        </div>
      )}

      {/* 応募カードのボトムシート（タップで展開・中身は従来の詳細カード＝操作ボタン込み。
          きょうの仕事＝応募カード（流れバー・評価・チャット）／返事待ち＝待機カード（3段プログレス・期限・取り消し） */}
      {(() => {
        const live = apps.find(x => x.id === sheetAppId);
        if (!live) return null;
        return (
          <div onClick={()=>setSheetAppId(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div ref={appSheetSheetRef} onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
              </div>
              <div ref={appSheetScrollRef} style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                {filter === "approved" ? renderAppCard(live) : renderWaitingCard(live)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 終了確認・評価モーダル（Part2） */}
      {/* 仕事の評価：フォームと保存は共有部品（今日ページの「仕事の評価」と同じもの）。
          送信できたら一覧の表示を評価済みに変え、祝祭を出す＝画面側の役目だけをここに残す */}
      <WorkerReviewSheet app={reviewModalApp && { id: reviewModalApp.id, farmer_id: reviewModalApp.farmer_id }} meId={me.id}
        dayCount={reviewModalApp ? appWorkDates(reviewModalApp, jobDates[reviewModalApp.job_number]).size || null : null}
        onClose={()=>setReviewModalApp(null)}
        onDone={(id)=>{ setReviewedIds(prev => new Set(prev).add(id)); setReviewModalApp(null); setCelebrate({ title:"ありがとうございました" }); }} />

      {/* 異議申立モーダル（Part2・欠勤記録への異議） */}
      {disputeModalApp && (
        <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>欠勤記録への異議申立</p>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.6, marginBottom:12 }}>心当たりがない場合、理由を書いて送信してください。運営が確認します。</p>
            <textarea value={disputeReason} onChange={e=>setDisputeReason(e.target.value)} placeholder="異議の理由" rows={4}
              className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setDisputeModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
              <button onClick={submitDispute} disabled={disputeSubmitting || !disputeReason.trim()}
                className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{disputeSubmitting ? <>送信中<Dots /></> : "送信する"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
