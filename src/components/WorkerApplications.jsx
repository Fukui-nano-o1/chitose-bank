// 分割3-B（2026-07-25）：App.jsxから移動。働き手の応募状況ページ（FlowBar7段・評価モーダル・緊急連絡）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { fbSuccess, fbError } from "../lib/feedback";
import { Celebration } from "./Celebration";
import { getCache, setCache } from "../lib/viewCache";
import { useRefreshTick, REFRESH_APPLICATIONS } from "../lib/refreshBus";
import { ymdLocal, calFmtDate, CHAT_ELIGIBLE_STATUSES, WORKER_EMERGENCY_KINDS, appPhaseKey, APP_PHASE_LABEL, photoThumb } from "../lib/utils";
import { fetchWorkerReady } from "../lib/workerReady";
import { YesNoPill, AutoSkeleton, useSkeletonProbe, FlowBar, Dots } from "./ui";
import { openPhaseInfo } from "../lib/previewBus";
import { AgreedDatesRow, AvailDatesChips } from "./DateChips";

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
  const [pastOpen, setPastOpen] = useState(false); // 過去の応募（見送り・失効）の折りたたみ（第9弾）
  // 評価（Part2・農家の完了記録のあと）
  const [reviewModalApp, setReviewModalApp] = useState(null);
  const [reviewWantAgain, setReviewWantAgain] = useState(null);
  const [reviewAsDescribed, setReviewAsDescribed] = useState(null);
  const [reviewSafetyCare, setReviewSafetyCare] = useState(null);
  const [reviewPublicComment, setReviewPublicComment] = useState("");
  const [reviewPrivateMemo, setReviewPrivateMemo] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  // 完了の祝祭（2026-08-06）：評価送信の成功時。演出のみ＝記録には触れない
  const [celebrate, setCelebrate] = useState(null);
  const openReviewModal = (a) => {
    setReviewModalApp(a);
    setReviewWantAgain(null); setReviewAsDescribed(null); setReviewSafetyCare(null);
    setReviewPublicComment(""); setReviewPrivateMemo("");
  };
  const submitWorkerReview = async () => {
    if (!reviewModalApp || reviewWantAgain===null || reviewAsDescribed===null || reviewSafetyCare===null || reviewSubmitting) return;
    setReviewSubmitting(true);
    try {
      const { error: revErr } = await supabase.from('reviews').insert({
        application_id: reviewModalApp.id, reviewer_id: me.id, reviewee_id: reviewModalApp.farmer_id,
        direction: 'worker_to_farmer', want_again: reviewWantAgain, as_described: reviewAsDescribed, safety_care: reviewSafetyCare,
        public_comment: reviewPublicComment.trim() || null, private_memo: reviewPrivateMemo.trim() || null,
      });
      if (revErr) { fbError(); alert('評価の保存に失敗しました：' + revErr.message); setReviewSubmitting(false); return; }
      setReviewedIds(prev => new Set(prev).add(reviewModalApp.id));
      setReviewModalApp(null);
      fbSuccess(); setCelebrate({ emoji:"⭐", title:"ありがとうございました" });
    } catch { alert('処理に失敗しました。'); }
    setReviewSubmitting(false);
  };

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

  // 緊急連絡（Part3・働き手側）
  const [emergencyModalApp, setEmergencyModalApp] = useState(null);
  const [emergencyKind, setEmergencyKind] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [emergencySubmitting, setEmergencySubmitting] = useState(false);
  const [emergencySent, setEmergencySent] = useState(false);
  const [emergencySentAt, setEmergencySentAt] = useState("");
  const [emergencyCtx, setEmergencyCtx] = useState(null); // 状況カード {jobNumber,jobLabel,dateLabel,partnerName}
  const openEmergencyModal = (a) => {
    setEmergencyModalApp(a); setEmergencyKind(""); setEmergencyReason(""); setEmergencySent(false);
    // 「何についての連絡か」を開いた瞬間に見せる（焦っている人に思い出させない）。詳細は非同期で追記
    setEmergencyCtx({ jobNumber: a.job_number, jobLabel: "", dateLabel: "", partnerName: "" });
    (async () => {
      try {
        const [jobRes, epRes] = await Promise.all([
          supabase.from("jobs_public").select("crop,task,date_start,work_time").eq("job_number", a.job_number).maybeSingle(),
          supabase.rpc("job_employer_profile", { p_job_number: a.job_number }),
        ]);
        const job = jobRes.data;
        const ep = epRes.data && epRes.data[0];
        setEmergencyCtx(prev => prev && prev.jobNumber === a.job_number ? {
          ...prev,
          jobLabel: job ? [job.crop, job.task].filter(Boolean).join(" ") : "",
          dateLabel: job && job.date_start ? calFmtDate(job.date_start) + (job.work_time ? " " + job.work_time.split("〜")[0] + "〜" : "") : "",
          partnerName: ep?.nickname || "",
        } : prev);
      } catch {}
    })();
  };

  // ↓ここに置く理由：この中の緊急連絡ディープリンク着地が openEmergencyModal を呼ぶため、
  //   その宣言より後ろに置く（2026-07-29に並べ替え・中身は不変）
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
            jobNumbers.length > 0
              ? supabase.from("jobs_public").select("job_number,date_start,date_end,crop,task,photos,work_time,pay_type,hourly_wage,daily_wage,city,town").in("job_number", jobNumbers).then(r => r, () => ({ data: [] }))
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
          }
          if (respEntries.length > 0) setRespByFarmer(Object.fromEntries(respEntries));
          // 緊急連絡ディープリンク着地：該当応募にバインドしてモーダル自動展開（#/emergency/{id}→resolveEmergencyLink経由）
          try {
            const pend = sessionStorage.getItem("cb_emergencyAppId");
            if (pend) {
              sessionStorage.removeItem("cb_emergencyAppId");
              const target = data.find(x => x.id === pend);
              if (target && CHAT_ELIGIBLE_STATUSES.includes(target.status)) openEmergencyModal(target);
            }
          } catch {}
        }
      } catch {}
      setLoading(false);
    })();
    // refreshTick＝応募の変化(Realtime)と画面の復帰の合図（2026-08-18 Speed-1B）。
    // 合図は「変わった」だけ＝中身はこの窓口から取り直す。loadingは立て直さないので骨は出ない
  }, [refreshTick]);
  const submitEmergency = async () => {
    if (!emergencyModalApp || !emergencyKind || !emergencyReason.trim() || emergencySubmitting) return;
    setEmergencySubmitting(true);
    try {
      const { error } = await supabase.from('attendance_events').insert({
        application_id: emergencyModalApp.id, actor_id: me.id, kind: emergencyKind, reason: emergencyReason.trim(),
      });
      if (error) { alert('送信に失敗しました：' + error.message); setEmergencySubmitting(false); return; }
      const sentAt = new Date().toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" });
      setEmergencySentAt(sentAt);
      setAllApps(prev => prev.map(x => x.id === emergencyModalApp.id ? { ...x, _emergencySentAt: sentAt } : x));
      setEmergencySent(true);
    } catch { alert('送信に失敗しました。'); }
    setEmergencySubmitting(false);
  };

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
  const label = (a) => a.status==="applied" ? "応募中" : (APP_PHASE_LABEL[appPhaseKey(a)] || a.status);
  const color = (s) => s==="approved"||s==="contracted"||s==="working" ? {bg:"#E6F7EE",fg:"#00A86B"} : s==="rejected" ? {bg:"#F3F3F3",fg:"#999"} : {bg:"#FFF4E0",fg:"#C77700"};
  // 承認済みタブのグリッド用（農家の作成中ページと同設計・2026-07-16）
  const [sheetAppId, setSheetAppId] = useState(null); // タップした応募のボトムシート
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
                <AvailDatesChips value={a.available_dates} />
                <AgreedDatesRow value={a.agreed_dates} />
                {/* お仕事の流れ（応募→承認→面接→採用→仕事→完了報告→評価）を可視化（2026-07-19／07-25） */}
                {a.status !== "applied" && <div style={{ marginBottom:14 }}><FlowBar a={{ ...a, _reviewed: reviewedIds.has(a.id) }} /></div>}
                {/* 評価（Part2・農家が完了を記録したあと） */}
                {a.status === "completed" && (
                  a.attended === false ? (
                    a._disputed ? (
                      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#717171", margin:"0 0 8px", textAlign:"center" }}>異議申立を送信しました</p>
                    ) : (
                      <button onClick={()=>{ setDisputeModalApp(a); setDisputeReason(""); }} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer", marginBottom:8 }}>異議申立</button>
                    )
                  ) : reviewedIds.has(a.id) ? (
                    <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#00A86B", margin:"0 0 8px", textAlign:"center" }}>✓ 評価済み</p>
                  ) : (
                    <button onClick={()=>openReviewModal(a)} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", marginBottom:8 }}>⭐ 農家を評価する</button>
                  )
                )}
                {/* 緊急連絡（Part3） */}
                {CHAT_ELIGIBLE_STATUSES.includes(a.status) && (
                  <button onClick={()=>openEmergencyModal(a)} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#fff", color:"#C77700", border:"1px solid #FFB020", borderRadius:10, cursor:"pointer", marginBottom:8 }}>⚠️ 緊急連絡</button>
                )}
                {a._emergencySentAt && (
                  <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#C77700", margin:"0 0 8px", textAlign:"center" }}>⚠️ 連絡済み（{a._emergencySentAt}）</p>
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
                  {isDone ? "✓" : ""}
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
          <p className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#0B6B4F", margin:"0 0 2px" }}>💬 この農家さんの返答：これまで おおむね{bucket}</p>
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
      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#0B6B4F", margin:"0 0 10px" }}>📎 待っている間にできること</p>
      <button onClick={()=>{ window.location.hash = "/profile/worker/profile"; }} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #DDEDE5", borderRadius:10, padding:"12px 14px", fontSize:13, fontWeight:700, color:"#00A86B", cursor:"pointer", marginBottom:8 }}>⭐農家がよく見る質問に答える →</button>
      <button onClick={()=>{ window.location.hash = "/search"; }} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #DDEDE5", borderRadius:10, padding:"12px 14px", fontSize:13, color:"#222", cursor:"pointer", lineHeight:1.6 }}>同じ日の別の求人にも応募できます <span style={{ color:"#00A86B", fontWeight:700 }}>→さがす</span></button>
    </div>
  );
  // 過去の応募（見送り・失効）の折りたたみ
  const pastAppsBlock = pastApps.length > 0 && (
    <div style={{ marginTop:20 }}>
      <button onClick={()=>setPastOpen(v=>!v)} className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"none", border:"none", padding:"8px 0", cursor:"pointer" }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#717171" }}>過去の応募（{pastApps.length}）</span>
        <span style={{ fontSize:12, color:"#B0B0B0" }}>{pastOpen ? "閉じる ▲" : "見る ▼"}</span>
      </button>
      {pastOpen && (
        <div style={{ display:"grid", gap:8, marginTop:8 }}>
          {pastApps.map(a => {
            const job = jobDates[a.job_number] || {};
            return (
              <div key={a.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, border:"1px solid #F0F0F0", borderRadius:10, padding:"10px 12px", background:"#FAFAFA" }}>
                <span className="f-sans" style={{ fontSize:13, color:"#717171", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[job.crop, job.task].filter(Boolean).join(" ") || ("求人 #" + a.job_number)}</span>
                {/* 掲載取り下げ（rejected_reason='unpublished'）は見送りと区別（2026-08-08たきと指示・
                    選考の結果ではないことを表示でも示す。ステータスページの暗幕と同じ語） */}
                <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#999", background:"#F0F0F0", borderRadius:20, padding:"2px 10px", flexShrink:0 }}>{a.status === "rejected" ? (a.rejected_reason === "unpublished" ? "掲載取り下げ" : "見送り") : a.status === "canceled" ? "取り消し" : "失効"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
  // ─────────────────────────────────────────────────────────────────────────
  // お仕事の流れ（FLOW_STEPS/flowState/FlowBar）は components/ui.jsx へ移設（2026-08-16）：
  // ステータスページのボックスでも同じ進み具合を展開表示するため、見た目・段の定義を1箇所に。
  return (
    <div style={{ marginTop:32, paddingTop:32, borderTop:"1px solid #EEE" }}>
      {celebrate && <Celebration {...celebrate} onDone={()=>setCelebrate(null)} />}
      {/* きょうの仕事タブはタイトルをフローバナーに差し替え（2026-07-19）。返事待ちタブは従来のタイトル */}
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
          <>
            {pendingBlock}
            {apps.length > 0 && <div ref={skelRef} style={{ display:"grid", gap:12 }}>{apps.map(a => renderWaitingCard(a))}</div>}
            {waitingTodoBox}
            {pastAppsBlock}
          </>
        )
      ) : apps.length === 0 ? (
        <div style={{ textAlign:"center", padding:"32px 20px", color:"#999" }} className="f-sans">
          <div style={{ fontSize:36, marginBottom:10 }}>🌱</div>
          <p style={{ fontSize:14, margin:0, lineHeight:1.7 }}>仕事が決まると、ここに当日やることが出ます</p>
          <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>農家が承認すると、ここに表示されます。</p>
        </div>
      ) : (
        // フロー可視化のため1列リスト（2026-07-19）：写真＋タイトル＋状態＋進捗ステッパー。タップでボトムシート
        <div ref={skelRef} style={{ display:"grid", gap:12 }}>
          {apps.map(a => {
            const job = jobDates[a.job_number] || {};
            const photo = photoThumb(job.photos?.[0]);
            return (
              <button key={a.id} onClick={()=>setSheetAppId(a.id)}
                className={"f-sans" + (isAppDone(a) ? "" : " cb-urgent-card")}
                style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"12px 14px 14px", cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:52, height:52, borderRadius:10, background:"#F7F7F7", flexShrink:0, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>
                    {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌾"}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[job.crop, job.task].filter(Boolean).join(" ") || ("求人 #" + a.job_number)}</p>
                    <span className="f-sans" style={{ display:"inline-block", marginTop:4, fontSize:11, fontWeight:700, padding:"2px 10px", borderRadius:20, background: ribbonColor(a) === "#00A86B" ? "#E6F7EF" : ribbonColor(a) === "#C77700" ? "#FFF4E0" : "#F3F3F3", color: ribbonColor(a) }}>{ribbonLabel(a)}</span>
                  </div>
                </div>
                <FlowBar a={{ ...a, _reviewed: reviewedIds.has(a.id) }} />
              </button>
            );
          })}
        </div>
      )}

      {/* 承認済みカードのボトムシート（タップで展開・中身は従来の応募カード＝操作ボタン込み） */}
      {filter === "approved" && (() => {
        const live = apps.find(x => x.id === sheetAppId);
        if (!live) return null;
        return (
          <div onClick={()=>setSheetAppId(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                <button onClick={()=>setSheetAppId(null)} aria-label="戻る" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                {renderAppCard(live)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 終了確認・評価モーダル（Part2） */}
      {reviewModalApp && (
        <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
            <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:16 }}>終了の確認・評価</p>
            <YesNoPill label="また働きたい" value={reviewWantAgain} onChange={setReviewWantAgain} />
            <YesNoPill label="説明のとおりだった" value={reviewAsDescribed} onChange={setReviewAsDescribed} />
            <YesNoPill label="安全に配慮されていた" value={reviewSafetyCare} onChange={setReviewSafetyCare} />
            <textarea value={reviewPublicComment} onChange={e=>setReviewPublicComment(e.target.value)} placeholder="農園について良かった点を一言（公開されます）" rows={3}
              className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:8 }} />
            <textarea value={reviewPrivateMemo} onChange={e=>setReviewPrivateMemo(e.target.value)} placeholder="自分だけが見えるメモ（任意）" rows={3}
              className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setReviewModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
              <button onClick={submitWorkerReview} disabled={reviewSubmitting || reviewWantAgain===null || reviewAsDescribed===null || reviewSafetyCare===null}
                className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{reviewSubmitting ? <>送信中<Dots /></> : "送信する"}</button>
            </div>
          </div>
        </div>
      )}

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

      {/* 緊急連絡モーダル（Part3・働き手側） */}
      {emergencyModalApp && (
        <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            {emergencySent ? (
              <>
                <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0 8px", margin:0, lineHeight:1.7 }}>
                  ⚠️ {(WORKER_EMERGENCY_KINDS.find(k=>k.v===emergencyKind)?.l || "緊急")}の連絡を{emergencyCtx?.partnerName ? emergencyCtx.partnerName + "さん" : "農家さん"}に送りました（{emergencySentAt}）
                </p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"0 0 16px" }}>チャットで詳しく伝えることもできます</p>
                <button onClick={()=>{ const id = emergencyModalApp.id; setEmergencyModalApp(null); window.location.hash = "/chat/" + id; }} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer", marginBottom:8 }}>チャットを開く →</button>
                <button onClick={()=>setEmergencyModalApp(null)} className="btn-primary f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, borderRadius:10 }}>閉じる</button>
              </>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>緊急連絡</p>
                {emergencyCtx && (
                  <div className="f-sans" style={{ background:"#F7F7F7", borderRadius:10, padding:"10px 12px", marginBottom:12, lineHeight:1.7 }}>
                    <p style={{ margin:0, fontSize:13, fontWeight:700, color:"#222" }}>求人 #{emergencyCtx.jobNumber}{emergencyCtx.jobLabel ? "・" + emergencyCtx.jobLabel : ""}</p>
                    <p style={{ margin:0, fontSize:12, color:"#717171" }}>{emergencyCtx.dateLabel && "作業日 " + emergencyCtx.dateLabel}{emergencyCtx.dateLabel && emergencyCtx.partnerName && "　"}{emergencyCtx.partnerName && "相手：" + emergencyCtx.partnerName + "さん"}</p>
                  </div>
                )}
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                  {WORKER_EMERGENCY_KINDS.map(k => (
                    <button key={k.v} type="button" onClick={()=>setEmergencyKind(k.v)} className="f-sans" style={{
                      flex: k.v==="no_show_report" ? "1 1 100%" : "1 1 0", padding:"9px", borderRadius:10, fontSize:13, cursor:"pointer", fontWeight:600, border:"2px solid",
                      borderColor: emergencyKind===k.v ? "#00A86B" : "#EBEBEB",
                      background: emergencyKind===k.v ? "#E6F7EF" : "#fff", color: emergencyKind===k.v ? "#00A86B" : "#222",
                    }}>{k.l}</button>
                  ))}
                </div>
                {emergencyKind==="no_show_report" && (
                  <div className="f-sans" style={{ background:"#FFF4E0", borderRadius:10, padding:"10px 12px", marginBottom:12, fontSize:12, color:"#C77700", lineHeight:1.7 }}>
                    まずチャットか電話で連絡を試してください。15分待っても会えない時にこの連絡を送ると、相手と運営に即時に通知され、日時が記録されます。
                  </div>
                )}
                <textarea value={emergencyReason} onChange={e=>setEmergencyReason(e.target.value)} placeholder="理由・詳細" rows={4}
                  className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setEmergencyModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submitEmergency} disabled={emergencySubmitting || !emergencyKind || !emergencyReason.trim()}
                    className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{emergencySubmitting ? <>送信中<Dots /></> : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
