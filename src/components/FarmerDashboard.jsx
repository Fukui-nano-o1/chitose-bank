// 分割3-C（2026-07-25）：App.jsxから移動。農家モードのお仕事タブ（求人一覧・応募者管理・お気に入り・完了報告・緊急連絡）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { openWorkerPreview, openPhaseInfo } from "../lib/previewBus";
import { INTERVIEW_TEMPLATES, ensureDefaultQuestionSets } from "../lib/questionSets";
import { ymdLocal, calFmtDate, daysBetweenYmd, payLabel, interactionStyleLabel, CHAT_ELIGIBLE_STATUSES, FARMER_EMERGENCY_KINDS, ROLE_GREEN, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR } from "../lib/utils";
import { Avatar, ExpandableText, StatusRibbon, YesNoPill, NoticeJumpText } from "./ui";
import { AgreedDatesRow, AvailDatesChips } from "./DateChips";
import { AdminJobPreview } from "./AdminJobPreview";
import { MyCalendar } from "./MyCalendar";
import { EmployerProfileEdit } from "./EmployerProfileEdit";
import { WorkerTrustCard } from "./TrustCards";
import { MyReviewsOfWorker } from "./MyReviewsOfWorker";

// 承認され当事者間のやり取りが可能になった段階以降のapplications.status一覧（completed含む）
const APPROVED_PLUS_STATUSES = ["approved","meeting","interview","contracted","working","completed"];

export function FarmerDashboard({ onNewJob, onResume, me }) {
  const hashToJobTab = () => {
    const h = window.location.hash.replace(/^#\/?/,"");
    if (h === "profile/employer/profile") return "profile";
    if (h === "profile/employer/drafts") return "draft";
    if (h === "profile/employer/active") return "active";
    if (h === "profile/employer/applicants") return "applicants";
    if (h === "profile/employer/expired") return "expired";
    if (h === "profile/employer/calendar") return "calendar";
    if (h === "profile/employer") return "home"; // 入口はAirbnb型カードメニュー（2026-07-14）
    return null;
  };
  const [jobTab, setJobTab] = useState(() => {
    try { const j = hashToJobTab(); if (j) return j; } catch {}
    return (sessionStorage.getItem("cb_afterDraftSave")==="1") ? "draft" : "home";
  });
  useEffect(() => {
    const onHash = () => { const j = hashToJobTab(); if (j) setJobTab(j); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // 下部バー「プロフィール」タップ＝農家プロのトップへ（同hash時＝hashchangeが出ない場合の保険）
  useEffect(() => {
    const onEmployerHome = () => setJobTab("home");
    window.addEventListener("cb:employerHome", onEmployerHome);
    return () => window.removeEventListener("cb:employerHome", onEmployerHome);
  }, []);
  // ── 面接の質問集（2026-07-23）：農家が質問セット(タイトル＋質問1〜5)を作り、応募者チャットに投函 ──
  const [questionSets, setQuestionSets] = useState([]);
  const [qMgrOpen, setQMgrOpen] = useState(false);      // 管理モーダル
  const qMgrScrollY = useRef(0);                        // 質問集を開く直前のハブのスクロール位置（閉じたら元の場所へ戻す・2026-07-24）
  // 質問集フルページ(.qset-full)は body{overflow:hidden;height:100%} で開くため、閉じるとハブ先頭へ飛ぶ。開く前の位置を控えて復元する
  const openQMgr = () => { qMgrScrollY.current = window.scrollY; setQEditing(null); setQMgrOpen(true); };
  const closeQMgr = () => { const y = qMgrScrollY.current; setQMgrOpen(false); requestAnimationFrame(() => window.scrollTo(0, y)); };
  const [qEditing, setQEditing] = useState(null);       // 編集中セット {id?, title, questions:[...]}（null=一覧）
  const [qSaving, setQSaving] = useState(false);
  const [sendQTarget, setSendQTarget] = useState(null); // 「質問を送る」対象の応募(a)
  const [sendingQ, setSendingQ] = useState(false);
  const loadQuestionSets = async () => {
    if (!me?.id) { setQuestionSets([]); return; }
    try {
      // 初回はデフォルト3種を用意してから読み込む（準備しておく・2026-07-23）
      const list = await ensureDefaultQuestionSets(me.id);
      setQuestionSets(list);
    } catch {}
  };
  useEffect(() => { loadQuestionSets(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [me?.id]);
  const saveQuestionSet = async () => {
    if (!qEditing || !me?.id) return;
    const title = (qEditing.title || "").trim();
    const questions = (qEditing.questions || []).map(q => (q || "").trim()).filter(Boolean).slice(0, 5);
    if (!title && questions.length === 0) { alert("タイトルか質問を入力してください"); return; }
    setQSaving(true);
    try {
      if (qEditing.id) {
        const { error } = await supabase.from("farmer_question_sets").update({ title, questions, updated_at: new Date().toISOString() }).eq("id", qEditing.id).eq("farmer_id", me.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("farmer_question_sets").insert({ farmer_id: me.id, title, questions });
        if (error) throw error;
      }
      await loadQuestionSets();
      setQEditing(null);
    } catch (e) { alert("保存に失敗しました：" + (e?.message || "不明")); }
    finally { setQSaving(false); }
  };
  const deleteQuestionSet = async (id) => {
    if (!id || !confirm("この質問集を削除しますか？")) return;
    try {
      const { error } = await supabase.from("farmer_question_sets").delete().eq("id", id).eq("farmer_id", me.id);
      if (error) throw error;
      await loadQuestionSets();
      setQEditing(null);
    } catch (e) { alert("削除に失敗しました：" + (e?.message || "不明")); }
  };
  const sendInterviewQuestions = async (setId) => {
    if (!sendQTarget || sendingQ) return;
    setSendingQ(true);
    try {
      const { data, error } = await supabase.rpc("send_interview_questions", { p_application_id: sendQTarget.id, p_set_id: setId });
      if (error || !data?.ok) { alert("送信に失敗しました：" + (data?.message || data?.reason || error?.message || "不明")); setSendingQ(false); return; }
      const appId = sendQTarget.id;
      setSendQTarget(null); setSendingQ(false);
      if (confirm("チャットに質問を送りました。チャットを開きますか？")) window.location.hash = "/chat/" + appId;
    } catch (e) { alert("送信に失敗しました：" + (e?.message || "不明")); setSendingQ(false); }
  };
  // 作成中⇄公開中ページャー（2026-07-16）：2枚のパネルを横並びにし、指に追従して実際に横移動させる。
  // 横ロック判定後はtrackのtransformを直接書く（state経由だと1フレーム遅れてカクつくため）。
  // 端（作成中で右・公開中で左）は1/3の抵抗。離した時に幅の1/4（最大80px）を超えていたらタブ確定
  const pagerTrackRef = useRef(null);
  const pagerDrag = useRef(null); // {x, y, dx, lock:"h"|"v"|null, w}
  const pagerBasePct = () => (jobTab === "draft" ? 0 : -50);
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
    const atEdge = (jobTab === "draft" && dx > 0) || (jobTab === "active" && dx < 0);
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
    if (jobTab === "draft" && s.dx < -threshold) {
      el.style.transform = "translateX(-50%)";
      setJobTab("active"); window.location.hash = "/profile/employer/active";
    } else if (jobTab === "active" && s.dx > threshold) {
      el.style.transform = "translateX(0%)";
      setJobTab("draft"); window.location.hash = "/profile/employer/drafts";
    } else {
      el.style.transform = `translateX(${pagerBasePct()}%)`; // 届かなければ元の位置へスナップバック
    }
  };
  const [dbDrafts, setDbDrafts] = useState([]);
  const [dbActive, setDbActive] = useState([]);
  // 働く日を決める（2026-07-24 追記3）：期間求人・承認後、農家が働く日を確定する。agreeModal=対象の応募／agreeSel=選択中
  const [agreeModal, setAgreeModal] = useState(null);
  const [agreeSel, setAgreeSel] = useState([]);
  const [agreeSaving, setAgreeSaving] = useState(false);
  const [qUnansweredMap, setQUnansweredMap] = useState({}); // { job_number: 未回答質問数 }（第10弾・求人カードのバッジ）
  const [dbExpired, setDbExpired] = useState([]); // 作業日程が過ぎた自分の求人（statusは持たず日付から導出・2026-07-16）
  const [dbApplicants, setDbApplicants] = useState([]);
  const [jobInfoMap, setJobInfoMap] = useState({}); // job_number→{crop,task}（応募者を求人毎に分ける見出し用・2026-07-19）
  const [workerProfiles, setWorkerProfiles] = useState({});
  const [workerTrust, setWorkerTrust] = useState({}); // { [worker_id]: {joined_at, verified_at} }
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [profileMode, setProfileMode] = useState("preview");
  const [empMini, setEmpMini] = useState(null); // 入口メニューの大プロフィールカード用（全列・裏面プレビューにも使用）
  const [empTopBack, setEmpTopBack] = useState(() => { try { return localStorage.getItem("cb_empTopBack") === "1"; } catch { return false; } }); // トップボックスの裏面表示。切り返した画面で固定（localStorageに永続・2026-07-16）
  const [empTopAnim, setEmpTopAnim] = useState("");    // 反転アニメ: pflip-out|pflip-in（0.4s×2=0.8秒）
  // 未設定の項目数（編集ページの8ボックス基準）。トップボックスの通知バッジ＋赤影に使用（2026-07-16・働き手側と同構造）
  // 核（アイコン・農園名・作業場所）が未設定→赤影＋浮遊アニメ／任意のみ未設定→赤影のみ（紹介PR→作業場所に差替・2026-07-16）
  const empUnsetReq = empMini ? [
    !!empMini.avatar_url,
    !!(empMini.nickname || "").trim(),
    !!(empMini.place_city || "").trim(),
  ].filter(x => !x).length : 3;
  const empUnsetCount = empMini ? empUnsetReq + [
    !!(empMini.has_transport || empMini.has_parking || empMini.has_commute_allowance || empMini.has_bonus || empMini.employer_pays_supplies || empMini.accessory_ok),
    empMini.staff_count !== null && empMini.staff_count !== undefined && empMini.staff_count !== "",
    [empMini.intro_path, empMini.intro_joy, empMini.intro_crops, empMini.intro_atmosphere, empMini.intro_message, empMini.owner_comment].some(t => t && String(t).trim()),
    [empMini.unique_point, empMini.always_do, empMini.break_style].some(t => t && String(t).trim()),
    !!empMini.interaction_style,
  ].filter(x => !x).length : 8;
  // 自由記述の審査状態（2026-07-19）：審査待ち=帯＋タップ不能／修正依頼中（差し戻し済み）=赤帯（修正のためタップは可能）
  const empHasPending = !!(empMini && empMini.texts_pending && Object.keys(empMini.texts_pending).length > 0);
  const empReview = empHasPending ? "pending" : (empMini?.texts_revision_requested_at ? "revision" : null);
  const [rosterRows, setRosterRows] = useState([]); // また呼びたいリスト（repeat_roster＋worker_profiles結合済み）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setDraftsLoading(false); return; }
        const { data: epMini } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle(); // トップボックス裏面プレビュー用に全列（2026-07-16）
        if (epMini) setEmpMini(epMini);
        const { data: rosterData } = await supabase.from("repeat_roster").select("worker_id,created_at").eq("farmer_id", session.user.id).order("created_at",{ascending:false});
        if (rosterData && rosterData.length > 0) {
          const { data: rosterWp } = await supabase.from("worker_profiles").select("auth_id,nickname,avatar_url").in("auth_id", rosterData.map(r => r.worker_id));
          const wpMap = {};
          (rosterWp || []).forEach(wp => { wpMap[wp.auth_id] = wp; });
          setRosterRows(rosterData.map(r => ({ worker_id: r.worker_id, nickname: wpMap[r.worker_id]?.nickname || null, avatar_url: wpMap[r.worker_id]?.avatar_url || null })));
        }
        // 自分の求人を一括取得し、日付で仕分ける：終了日(無ければ開始日)が昨日以前＝期限切れ。
        // 「期限切れ」というstatusはDBに存在しない（導出のみ）。当日の求人はまだ現役扱い
        // opened_at＝一時非公開（掲載歴あり）判定に必須（2026-07-16）。固定列SELECTに入れ忘れると一時非公開が作成中へ落ちる
        const { data: allJobs, error } = await supabase.from("jobs").select("job_number,crop,task,date_label,prefecture,city,pay_type,hourly_wage,daily_wage,photos,status,date_start,date_end,work_time,opened_at").eq("farmer_id", session.user.id).order("job_number",{ascending:false});
        if (!error && allJobs) {
          setJobInfoMap(Object.fromEntries(allJobs.map(j => [j.job_number, { crop: j.crop, task: j.task, date_start: j.date_start, date_end: j.date_end, photos: j.photos }])));
          const todayYmd = ymdLocal(new Date());
          const isPast = (j) => {
            const end = j.date_end || j.date_start;
            if (!end) return false;
            if (end < todayYmd) return true;
            // 最終日が今日で、勤務終了時刻を過ぎていれば終了（例：17:00〜19:00 は19時以降）
            if (end === todayYmd && j.work_time) {
              const m = String(j.work_time).match(/〜\s*(\d{1,2}):(\d{2})/);
              if (m) { const n = new Date(); if (n.getHours()*60 + n.getMinutes() > parseInt(m[1],10)*60 + parseInt(m[2],10)) return true; }
            }
            return false;
          };
          // 一時非公開（status=draftだが掲載歴opened_atあり）は作成中でなく公開中タブに帯付きで残す（2026-07-16）
          const isUnpublished = (j) => j.status === "draft" && !!j.opened_at;
          // 作成中タブ＝作成中＋審査中／公開中タブ＝公開中＋一時非公開（2026-07-16たきと指定）
          setDbDrafts(allJobs.filter(j => ((j.status === "draft" && !j.opened_at) || j.status === "pending") && !isPast(j)));
          setDbActive(allJobs.filter(j => (j.status === "open" || isUnpublished(j)) && !isPast(j)));
          setDbExpired(allJobs.filter(isPast));
          // 未回答の質問数を集計（第10弾）：自分の求人の、回答なし・非表示でない質問
          try {
            const nums = allJobs.map(j => j.job_number);
            if (nums.length > 0) {
              const { data: qs } = await supabase.from("job_questions").select("job_number").is("answer", null).eq("hidden", false).in("job_number", nums);
              const m = {};
              (qs || []).forEach(q => { m[q.job_number] = (m[q.job_number] || 0) + 1; });
              setQUnansweredMap(m);
            }
          } catch {}
        }
        const { data: appData, error: appErr } = await supabase.from("applications").select("*").eq("farmer_id", session.user.id).order("created_at",{ascending:false});
        if (!appErr && appData) {
          setDbApplicants(appData);
          const workerIds = [...new Set(appData.map(a => a.worker_id).filter(Boolean))];
          if (workerIds.length > 0) {
            const { data: wpData, error: wpErr } = await supabase.from("worker_profiles").select("*").in("auth_id", workerIds);
            if (!wpErr && wpData) {
              const map = {};
              wpData.forEach(wp => { map[wp.auth_id] = wp; });
              setWorkerProfiles(map);
            }
            const trustResults = await Promise.all(workerIds.map(id => supabase.rpc('worker_trust_info', { p_worker_id: id })));
            const trustMap = {};
            trustResults.forEach((r, i) => { if (r.data && r.data.ok) trustMap[workerIds[i]] = r.data; });
            setWorkerTrust(trustMap);
          }
          // 緊急連絡ディープリンク着地：該当応募にバインドしてモーダル自動展開（#/emergency/{id}→resolveEmergencyLink経由）
          try {
            const pend = sessionStorage.getItem("cb_emergencyAppId");
            if (pend) {
              sessionStorage.removeItem("cb_emergencyAppId");
              const target = appData.find(x => x.id === pend);
              if (target && CHAT_ELIGIBLE_STATUSES.includes(target.status)) openEmergencyModal(target);
            }
          } catch {}
          // 完了・評価モーダルの着地（2026-07-24）：今日ページの「完了して評価する」から cb_completeAppId 経由で自動展開（モーダルはここに常駐）
          try {
            const pendC = sessionStorage.getItem("cb_completeAppId");
            if (pendC) {
              sessionStorage.removeItem("cb_completeAppId");
              const target = appData.find(x => x.id === pendC);
              if (target && CHAT_ELIGIBLE_STATUSES.includes(target.status)) openCompleteModal(target);
            }
          } catch {}
          // 働く日を決めるモーダルの着地（2026-07-24）：今日ページの「日を決める」から cb_agreeAppId 経由で自動展開
          try {
            const pendA = sessionStorage.getItem("cb_agreeAppId");
            if (pendA) {
              sessionStorage.removeItem("cb_agreeAppId");
              const target = appData.find(x => x.id === pendA);
              if (target && CHAT_ELIGIBLE_STATUSES.includes(target.status)) { setAgreeModal(target); setAgreeSel(Array.isArray(target.agreed_dates) ? target.agreed_dates.slice() : []); }
            }
          } catch {}
        }
      } catch {}
      setDraftsLoading(false);
      try { if (sessionStorage.getItem("cb_afterDraftSave")==="1") { setJobTab("draft"); } sessionStorage.removeItem("cb_afterDraftSave"); } catch {}
    })();
  }, []);
  // 応募者タブを開くたびに応募の最新statusを取り直す（2026-07-16）。
  // 初回マウント時の1回だけだと、働き手側の操作（終了打刻→completed等）が進んでも
  // カードの帯が古いまま（契約のまま）になるため
  useEffect(() => {
    if (jobTab !== "applicants") return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data: appData } = await supabase.from("applications").select("*").eq("farmer_id", session.user.id).order("created_at", { ascending: false });
        if (!appData) return;
        setDbApplicants(appData);
        // 新しく増えた応募者のプロフィールも補充
        const missing = [...new Set(appData.map(a => a.worker_id).filter(Boolean))].filter(id => !workerProfiles[id]);
        if (missing.length > 0) {
          const { data: wpData } = await supabase.from("worker_profiles").select("*").in("auth_id", missing);
          if (wpData && wpData.length > 0) {
            setWorkerProfiles(prev => { const m = { ...prev }; wpData.forEach(wp => { m[wp.auth_id] = wp; }); return m; });
          }
        }
      } catch {}
    })();
  }, [jobTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const JOB_TABS = [
    { k:"profile", l:"雇い手プロフィール" },
    { k:"draft",   l:"作成中" },
    { k:"active",  l:"公開中" },
    { k:"applicants", l:"応募者" },
    { k:"expired", l:"期限切れ" },
    { k:"calendar", l:"カレンダー" },
  ];
  // ダミー撤去（憲法3条:表示にダミー禁止）。Phase2aでjobsテーブルから自分の求人を読む
  const jobList = [];

  // 開始の握手（Part4）
  const [startConfirmingId, setStartConfirmingId] = useState(null);
  const confirmStart = async (a) => {
    if (startConfirmingId) return;
    setStartConfirmingId(a.id);
    try {
      const { data, error } = await supabase.rpc('confirm_start', { p_application_id: a.id });
      if (!error && data && data.ok) {
        setDbApplicants(prev => prev.map(x => x.id===a.id ? { ...x, farmer_confirmed_start_at: new Date().toISOString() } : x));
      } else if (data && !data.ok) {
        alert('確認できませんでした：' + (data.reason || '不明'));
      }
    } catch { alert('確認に失敗しました。'); }
    setStartConfirmingId(null);
  };

  // 完了・評価モーダル（Part1）
  const [completeModalApp, setCompleteModalApp] = useState(null);
  const [completeStep, setCompleteStep] = useState('attend'); // 'attend' | 'review'
  const [completeWantAgain, setCompleteWantAgain] = useState(null);
  const [completeEntrust, setCompleteEntrust] = useState(null);
  const [completePublicComment, setCompletePublicComment] = useState("");
  const [completePrivateMemo, setCompletePrivateMemo] = useState("");
  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [completeNotifyNext, setCompleteNotifyNext] = useState(true); // また呼びたい=はい時のみ表示。ON=repeat_rosterへupsert
  const [completeDone, setCompleteDone] = useState(null); // 評価登録完了モーダル {jobLabel,jobNumber,workerId,workerName,at,wantAgain,entrust,publicComment,privateMemo,favorited}
  const openCompleteModal = (a) => {
    setCompleteModalApp(a); setCompleteStep('attend');
    setCompleteWantAgain(null); setCompleteEntrust(null);
    setCompletePublicComment(""); setCompletePrivateMemo("");
    setCompleteNotifyNext(true);
  };
  const markNoShow = async () => {
    if (!completeModalApp || completeSubmitting) return;
    if (!confirm('欠勤として記録します。働き手に通知され、72時間の異議申立ができます')) return;
    setCompleteSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('complete_work', { p_application_id: completeModalApp.id, p_attended: false });
      if (error || !data?.ok) { alert('記録に失敗しました：' + (data?.reason || error?.message || '不明')); setCompleteSubmitting(false); return; }
      setDbApplicants(prev => prev.map(x => x.id===completeModalApp.id ? { ...x, status:'completed', attended:false } : x));
      setCompleteModalApp(null);
    } catch { alert('記録に失敗しました。'); }
    setCompleteSubmitting(false);
  };
  const submitFarmerReview = async () => {
    if (!completeModalApp || completeWantAgain===null || completeEntrust===null || completeSubmitting) return;
    setCompleteSubmitting(true);
    try {
      // 原子化（2026-07-19）：完了処理・評価保存・お気に入り登録を1つのRPC＝1トランザクションで実行。
      // 送信ボタンのタップだけがトリガーで、途中失敗なら何も保存されない（中途半端な履歴が残らない）
      const { data, error } = await supabase.rpc('submit_farmer_review', {
        p_application_id: completeModalApp.id,
        p_want_again: completeWantAgain, p_entrust: completeEntrust,
        p_public_comment: completePublicComment.trim(), p_private_memo: completePrivateMemo.trim(),
        p_favorite: completeNotifyNext,
      });
      if (error || !data?.ok) { alert('送信に失敗しました（何も保存されていません）：' + (data?.reason || error?.message || '不明')); setCompleteSubmitting(false); return; }
      const favorited = !!data.favorited;
      if (favorited) {
        const wp = workerProfiles[completeModalApp.worker_id];
        setRosterRows(prev => prev.some(r => r.worker_id === completeModalApp.worker_id) ? prev
          : [{ worker_id: completeModalApp.worker_id, nickname: wp?.nickname || null, avatar_url: wp?.avatar_url || null }, ...prev]);
        setFavDetailOpen(false);
        setFavDone({ workerId: completeModalApp.worker_id, nickname: wp?.nickname || "", avatar_url: wp?.avatar_url || "" });
      }
      setDbApplicants(prev => prev.map(x => x.id===completeModalApp.id ? { ...x, status:'completed', attended:true } : x));
      // 評価登録完了モーダル用の控えを組み立てる（求人タイトルはdbActive→jobsの順で解決）
      let jobLabel = "";
      const cached = dbActive.find(d => d.job_number === completeModalApp.job_number) || dbDrafts.find(d => d.job_number === completeModalApp.job_number);
      if (cached) jobLabel = [cached.crop, cached.task].filter(Boolean).join(" ");
      else {
        try {
          const { data: jr } = await supabase.from("jobs").select("crop,task").eq("job_number", completeModalApp.job_number).eq("farmer_id", me.id).maybeSingle();
          if (jr) jobLabel = [jr.crop, jr.task].filter(Boolean).join(" ");
        } catch {}
      }
      setCompleteDone({
        jobLabel, jobNumber: completeModalApp.job_number,
        workerId: completeModalApp.worker_id,
        workerName: workerProfiles[completeModalApp.worker_id]?.nickname || "働き手",
        at: new Date().toLocaleString("ja-JP", { year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }),
        wantAgain: completeWantAgain, entrust: completeEntrust,
        publicComment: completePublicComment.trim(), privateMemo: completePrivateMemo.trim(),
        favorited,
      });
      setCompleteModalApp(null);
    } catch { alert('処理に失敗しました。'); }
    setCompleteSubmitting(false);
  };
  // お気に入り登録しました！ボックス（2026-07-19）：登録成功の瞬間に展開。アイコンに❤️が付く動作つき
  const [favDone, setFavDone] = useState(null); // {workerId, nickname, avatar_url}
  const [favDetailOpen, setFavDetailOpen] = useState(false);
  const [rosterInfoOpen, setRosterInfoOpen] = useState(false); // また呼びたいリストの説明：?マークタップで展開（既定は閉・情報過多回避・2026-07-19）
  const [showRoster, setShowRoster] = useState(false); // 記録と予定：また呼びたいリスト箱→モーダル（2026-07-22）
  const [eFlip, setEFlip] = useState(null); // 農家ハブ：？タップで反転して説明を出す箱のラベル（2026-07-22）
  const [appFilter, setAppFilter] = useState("all"); // 応募者タブの状態フィルタ（2026-07-22）
  const [appLegendOpen, setAppLegendOpen] = useState(false); // 応募者ページ下部「帯の意味」の説明ボックス開閉
  // 評価登録完了モーダル内のお気に入り登録チェック（ON=roster upsert／OFF=行削除）
  const toggleDoneFavorite = async (checked) => {
    if (!completeDone) return;
    try {
      if (checked) {
        const { error } = await supabase.from('repeat_roster').upsert(
          { farmer_id: me.id, worker_id: completeDone.workerId, notify: true },
          { onConflict: 'farmer_id,worker_id' }
        );
        if (error) { alert('登録に失敗しました：' + error.message); return; }
        const wp = workerProfiles[completeDone.workerId];
        setRosterRows(prev => prev.some(r => r.worker_id === completeDone.workerId) ? prev
          : [{ worker_id: completeDone.workerId, nickname: wp?.nickname || null, avatar_url: wp?.avatar_url || null }, ...prev]);
        setFavDetailOpen(false);
        setFavDone({ workerId: completeDone.workerId, nickname: wp?.nickname || "", avatar_url: wp?.avatar_url || "" });
      } else {
        const { error } = await supabase.from('repeat_roster').delete().eq('farmer_id', me.id).eq('worker_id', completeDone.workerId);
        if (error) { alert('解除に失敗しました：' + error.message); return; }
        setRosterRows(prev => prev.filter(r => r.worker_id !== completeDone.workerId));
      }
      setCompleteDone(prev => prev ? { ...prev, favorited: checked } : prev);
    } catch { alert('処理に失敗しました。'); }
  };
  // 求人カードタップ→確認ページと同型の全画面プレビュー（AdminJobPreviewのownerViewモード流用）
  const [previewJob, setPreviewJob] = useState(null); // { num: job_number, draft: bool（trueなら編集再開ボタンを出す） }
  // 応募者タブのグリッド用（働き手の承認済みタブと同設計・2026-07-16）
  const [sheetApplicantId, setSheetApplicantId] = useState(null); // タップした応募者のボトムシート
  // リアルタイム帯（2026-07-25たきと指示）：「〇〇済み」でなく今の段階「〇〇中」を出す。
  // 段階の導出・ラベル・色は lib/utils の appPhaseKey/APP_PHASE_LABEL/APP_PHASE_COLOR に一本化（帯・凡例の唯一のソース）
  const appRibbonLabel = (a) => APP_PHASE_LABEL[appPhaseKey(a)] || a.status;
  const appRibbonColor = (a) => APP_PHASE_COLOR[appPhaseKey(a)] || "#00A86B";
  // 応募者ページの状態フィルタ（2026-07-22）：上部タブ＝タップ＋横スワイプで切替
  const APP_FILTERS = [
    { k:"all",       l:"すべて",   match: () => true },
    { k:"applied",   l:"応募中",   match: (s) => s==="applied" },
    { k:"active",    l:"進行中",   match: (s) => ["approved","meeting","interview","contracted","working"].includes(s) },
    { k:"completed", l:"完了",     match: (s) => s==="completed" },
  ];
  const appSwipeRef = useRef(null);
  const onAppSwipeStart = (e) => { appSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onAppSwipeEnd = (e) => {
    const s = appSwipeRef.current; appSwipeRef.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // 横スワイプのみ
    const idx = Math.max(0, APP_FILTERS.findIndex(f => f.k === appFilter));
    const next = dx < 0 ? Math.min(APP_FILTERS.length - 1, idx + 1) : Math.max(0, idx - 1);
    setAppFilter(APP_FILTERS[next].k);
  };
  // 未完了＝農家側の対応が残っている応募（完了 or 見送りになるまで）
  const isApplicantDone = (a) => a.status === "completed" || a.status === "rejected";
  // 応募者の注意表示（2026-07-16）：未承認（承認待ち）＝赤影＋浮遊アニメ／保険未チェック＝赤影のみ（静止）
  const needsInsurance = (a) => APPROVED_PLUS_STATUSES.includes(a.status) && a.status !== "completed" && !a.insurance_prepared_at;
  const hasUnapprovedApplicant = dbApplicants.some(a => a.status === "applied");
  const hasInsurancePending = dbApplicants.some(needsInsurance);

  // また呼びたいリストのアイコンタップ→働き手詳細モーダル（応募者カードと同じWorkerTrustCard表示）
  const [rosterDetail, setRosterDetail] = useState(null); // {worker_id, loading, profile, trust}
  const openRosterDetail = (workerId) => {
    setRosterDetail({ worker_id: workerId, loading: true, profile: null, trust: null });
    (async () => {
      try {
        const [wpRes, trustRes] = await Promise.all([
          supabase.from("worker_profiles").select("*").eq("auth_id", workerId).maybeSingle(),
          supabase.rpc("worker_trust_info", { p_worker_id: workerId }),
        ]);
        setRosterDetail(prev => prev && prev.worker_id === workerId ? {
          worker_id: workerId, loading: false,
          profile: wpRes.data || null,
          trust: (trustRes.data && trustRes.data.ok) ? trustRes.data : null,
        } : prev);
      } catch {
        setRosterDetail(prev => prev && prev.worker_id === workerId ? { ...prev, loading: false } : prev);
      }
    })();
  };
  // また呼びたいリストの行削除（通知を止める）
  const stopRosterNotify = async (workerId) => {
    if (!confirm('この方への新求人のお知らせを止めますか？（次回の評価で再登録できます）')) return;
    try {
      const { error } = await supabase.from('repeat_roster').delete().eq('farmer_id', me.id).eq('worker_id', workerId);
      if (error) { alert('解除に失敗しました：' + error.message); return; }
      setRosterRows(prev => prev.filter(r => r.worker_id !== workerId));
    } catch { alert('解除に失敗しました。'); }
  };

  // 緊急連絡（Part3・農家側）
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
    setEmergencyCtx({ jobNumber: a.job_number, jobLabel: "", dateLabel: "", partnerName: workerProfiles[a.worker_id]?.nickname || "" });
    (async () => {
      try {
        const { data: job } = await supabase.from("jobs").select("crop,task,date_start,work_time").eq("job_number", a.job_number).eq("farmer_id", me.id).maybeSingle();
        setEmergencyCtx(prev => prev && prev.jobNumber === a.job_number ? {
          ...prev,
          jobLabel: job ? [job.crop, job.task].filter(Boolean).join(" ") : "",
          dateLabel: job && job.date_start ? calFmtDate(job.date_start) + (job.work_time ? " " + job.work_time.split("〜")[0] + "〜" : "") : "",
        } : prev);
      } catch {}
    })();
  };
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
      setDbApplicants(prev => prev.map(x => x.id === emergencyModalApp.id ? { ...x, _emergencySentAt: sentAt } : x));
      setEmergencySent(true);
    } catch { alert('送信に失敗しました。'); }
    setEmergencySubmitting(false);
  };

  // 応募者カード本体（ボトムシートで表示。承認/見送り・保険・開始確認・完了評価・緊急連絡・チャットの操作込み）
  const renderApplicantCard = (a) => {
    const badgeColor = a.status==="approved" ? {bg:"#E6F7EF",fg:"#00A86B"} : (a.status==="rejected" || a.status==="expired") ? {bg:"#F5F5F5",fg:"#717171"} : {bg:"#FFF4E0",fg:"#C77700"};
    const wp = workerProfiles[a.worker_id];
    return (
      <div key={a.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
              <div style={{ display:"inline-block", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, marginBottom:8, background:badgeColor.bg, color:badgeColor.fg }}>
                {appRibbonLabel(a)}
              </div>
              <div style={{ marginBottom:10 }}>
                <WorkerTrustCard profile={wp || {}} trust={workerTrust[a.worker_id]} />
                <MyReviewsOfWorker workerId={a.worker_id} />
              </div>
              {Array.isArray(wp?.pr_qa) && wp.pr_qa.length > 0 && (
                <div style={{ display:"grid", gap:6, marginBottom:10 }}>
                  {wp.pr_qa.map(({ q, a: ans }) => (
                    <div key={q}>
                      <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
                      <p className="f-sans" style={{ fontSize:12, color:"#222", margin:0, lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{ans}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* 求人名はタップで求人プレビューを開くリンク（2026-07-19） */}
              {(() => {
                const info = jobInfoMap[a.job_number] || dbActive.find(d => d.job_number === a.job_number) || dbDrafts.find(d => d.job_number === a.job_number) || {};
                const title = [info.crop, info.task].filter(Boolean).join(" ") || "求人";
                return (
                  <button onClick={()=>setPreviewJob({ num: a.job_number })} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", padding:0, margin:"0 0 4px", cursor:"pointer" }}>
                    <span style={{ fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline" }}>{title}</span>
                    <span style={{ color:"#999", fontWeight:700, fontSize:12, marginLeft:6 }}>#{a.job_number}</span>
                    <span style={{ color:"#00A86B", fontWeight:700, fontSize:12, marginLeft:6 }}>→</span>
                  </button>
                );
              })()}
              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:8 }}>応募日 {new Date(a.created_at).toLocaleDateString("ja-JP")}</p>
              {/* 来られる日（期間求人・すり合わせの起点・2026-07-24） */}
              <AvailDatesChips value={a.available_dates} />
              {/* 働く日（確定済み・2026-07-24 追記3） */}
              <AgreedDatesRow value={a.agreed_dates} />
              {/* ── 応募者カードは「承認」と「チャット」に純化（2026-07-24 最終版）。当日・事後の行動は今日ページ、道具はチャットの＋へ引っ越し ── */}
              {/* 主ボタン：承認する（applied時のみ）＋見送る（従来位置・小さく誤タップ防止）。承認＝宣言日程の受け入れ（DB側でagreed_dates自動転写） */}
              {a.status === "applied" && (
                <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                  <button onClick={async ()=>{
                    const { data, error } = await supabase.rpc('approve_application', { p_application_id: a.id, p_approve: true });
                    if (error || !data?.ok) { alert('承認に失敗しました：' + (data?.reason || error?.message || '不明')); return; }
                    setDbApplicants(prev => prev.map(x => x.id===a.id ? {...x, status:'approved'} : x));
                  }} className="f-sans" style={{ flex:2, padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>承認する</button>
                  <button onClick={async ()=>{
                    if (!confirm('この応募を見送りますか？')) return;
                    const { data, error } = await supabase.rpc('approve_application', { p_application_id: a.id, p_approve: false });
                    if (error || !data?.ok) { alert('処理に失敗しました：' + (data?.reason || error?.message || '不明')); return; }
                    setDbApplicants(prev => prev.map(x => x.id===a.id ? {...x, status:'rejected'} : x));
                  }} className="f-sans" style={{ flex:1, padding:"12px", fontSize:12, fontWeight:600, background:"#fff", color:"#999", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>見送る</button>
                </div>
              )}
              {/* 状態メモ（進行の記録は小さく残す・操作は今日ページ） */}
              {a.status === "completed" && (
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color: a.attended===false ? "#E24B4A" : "#00A86B", margin:"0 0 8px" }}>{a.attended===false ? "欠勤記録済み" : "✓ 完了・評価済み"}</p>
              )}
              {/* 常時表示：チャットを開く */}
              <button onClick={()=>{ window.location.hash="/chat/"+a.id; }} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>💬 チャットを開く</button>
      </div>
    );
  };
  return (
    // 入口(home)は余白を持たない＝働き手入口と開始位置・下端が完全一致（外側のプロフィールwrapperが32px/4pxを提供）
    // 応募者ページの上空白は15px固定（2026-07-25たきと指示）。他のサブページは従来の24px
    <div style={{ maxWidth:1200, margin:"0 auto", padding: jobTab === "home" ? "0" : jobTab === "applicants" ? "15px 0 80px" : "24px 0 80px" }}>
      {jobTab === "home" ? (
        <>
          {/* ═══ Airbnb型入口メニュー（2026-07-14）：大プロフィールカード＋絵文字カード格子＋ワイド求人作成カード。
               文字タブの羅列を廃止し、タップで各サブページへ ═══ */}
          {/* トップボックスは反転式（2026-07-16・働き手側と同構造）：表=アイコン＋農園名／裏=アイコン・名前抜きのプレビュー。右上⇄で反転0.8秒 */}
          <div style={{ position:"relative" }}>
            <button onClick={()=>{ if (empReview === "pending") return; window.location.hash="/profile/employer/profile"; }}
              className={"f-sans" + (empTopAnim ? " " + empTopAnim : (empReview ? "" : empUnsetReq > 0 ? " cb-urgent-card" : empUnsetCount > 0 ? " cb-urgent-still" : ""))}
              onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && empTopAnim === "pflip-in") setEmpTopAnim(""); }}
              style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid " + ROLE_GREEN, borderRadius:24, padding: empReview ? "28px 20px 44px" : "28px 20px", cursor: empReview === "pending" ? "default" : "pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box" }}>
              {/* 審査帯（2026-07-19）：審査待ち=オレンジ帯＋タップ不能／修正依頼中=赤帯（タップで修正へ） */}
              {empReview && (
                <span className="f-sans" style={{ position:"absolute", left:0, right:0, bottom:0, zIndex:2, padding:"8px 12px", borderRadius:"0 0 24px 24px", background: empReview === "revision" ? "#E24B4A" : "#C77700", color:"#fff", fontSize:13, fontWeight:700, textAlign:"center", boxSizing:"border-box" }}>
                  {empReview === "revision" ? "⚠️ 修正のお願いがあります（タップして修正）" : "⏳ 審査待ち：運営が確認しています"}
                </span>
              )}
              {!empTopBack ? (
                <>
                  {/* 未設定の項目数（全て設定済みなら非表示）。右上は⇄マークなので左隣に */}
                  {empUnsetCount > 0 && (
                    <span style={{ position:"absolute", top:12, right:52, minWidth:22, height:22, borderRadius:11, background:"#F5A623", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{empUnsetCount}</span>
                  )}
                  <Avatar url={empMini?.avatar_url} name={empMini?.nickname || me?.name} size={84} />
                  <span>
                    <span className="f-sans" style={{ display:"block", fontSize:22, fontWeight:800, color:"#222" }}>{empMini?.nickname || me?.name || "農園名未設定"}</span>
                    <span className="f-sans" style={{ display:"inline-block", marginTop:6, fontSize:13, fontWeight:800, color:"#fff", background:ROLE_GREEN, borderRadius:20, padding:"3px 14px" }}>農家</span>
                  </span>
                </>
              ) : (
                <div className="f-sans" style={{ width:"100%", textAlign:"left" }}>
                  {(() => {
                    const perks = empMini ? [
                      { on: empMini.has_transport, label: "🚗送迎あり" },
                      { on: empMini.has_parking, label: "🅿️駐車場あり" },
                      { on: empMini.has_commute_allowance, label: "💰通勤手当あり" },
                      { on: empMini.has_bonus, label: "🎁賞与あり" },
                      { on: empMini.employer_pays_supplies, label: "🎒持ち物は農家負担" },
                      { on: empMini.accessory_ok, label: "💍アクセサリーOK" },
                    ].filter(p => p.on) : [];
                    const pr = (empMini?.pr || "").trim();
                    const styleLabel = interactionStyleLabel(empMini?.interaction_style);
                    const hasAny = pr || perks.length || styleLabel;
                    if (!hasAny) return <p style={{ fontSize:13, color:"#999", textAlign:"center", margin:"32px 0" }}>プロフィールは未設定です</p>;
                    {/* 並び：タブ（待遇・関わり方のチップ）が上部→下に自己紹介（2026-07-16） */}
                    return (
                      <>
                        {(perks.length > 0 || styleLabel) && (
                          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
                            {perks.map((p,i) => <span key={i} style={{ fontSize:12, fontWeight:600, color:"#00A86B", background:"#E6F7EF", borderRadius:20, padding:"4px 10px" }}>{p.label}</span>)}
                            {styleLabel && <span style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"4px 10px" }}>🤝 {styleLabel}</span>}
                          </div>
                        )}
                        {pr && <ExpandableText text={pr} limit={100} style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, overflowWrap:"break-word", wordBreak:"break-word" }} />}
                      </>
                    );
                  })()}
                </div>
              )}
            </button>
            <button onClick={(e)=>{
              e.stopPropagation();
              if (empTopAnim === "pflip-out") return; // 連打ガード
              setEmpTopAnim("pflip-out");
              setTimeout(()=>{ setEmpTopBack(v=>{ const nv = !v; try { localStorage.setItem("cb_empTopBack", nv ? "1" : "0"); } catch {} return nv; }); setEmpTopAnim("pflip-in"); }, 400);
            }} aria-label="表示を切り替える" style={{ position:"absolute", top:12, right:12, width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>⇄</button>
          </div>
          {/* 入口カード（📌いま=応募者／📋求人の管理=作成中・公開中）は削除（2026-07-25たきと指示）。
              各ページへの入口は下部フッター（応募者タブ・求人タブ）に一本化。URL直打ち(/profile/employer/*)は従来どおり生きている */}
          <button onClick={onNewJob} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>{/* 箱ジャンプ(cb-jump)→タイトル文字の順ジャンプに変更（NoticeJumpText・2026-07-25たきと指示） */}
            <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>📝</span>
            <span>
              <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}><NoticeJumpText text="新しく求人を出す" /></span>
              <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>基本情報だけなら5分。写真や説明は後から追加できます。</span>
            </span>
          </button>
          {/* 面接の質問集（2026-07-23）：応募者チャットに送る質問を用意 */}
          <button onClick={openQMgr} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
            <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>📋</span>
            <span>
              <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>面接の質問集</span>
              <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>聞きたいことをセットにして、応募者のチャットに送れます。回答もチャットに残ります。</span>
            </span>
          </button>
          {/* 保険の準備（2026-07-24・専用ページ#/insuranceへ遷移）。アプリ内遷移の目印を残し、戻るは history.back で元の場所（スクロール位置）へ復帰させる */}
          <button onClick={()=>{ try{ sessionStorage.setItem("cb_insFromApp","1"); }catch{} window.location.hash="/insurance"; }} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
            <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>🛡</span>
            <span>
              <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>保険の準備</span>
              <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>働き手のケガに備える保険の準備方針を、自己申告で表明できます。</span>
            </span>
          </button>
          <div style={{ marginTop:16 }}>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_GREEN, paddingLeft:8 }}>📖 記録</p>
            <div className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, margin:"0 0 12px" }}>
                <p style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>❤️ また呼びたいリスト</p>
                <button onClick={()=>setRosterInfoOpen(v=>!v)} aria-label="説明を見る" className="f-sans" style={{ width:22, height:22, borderRadius:11, background: rosterInfoOpen ? "#00A86B" : "#F0F0F0", color: rosterInfoOpen ? "#fff" : "#717171", border:"none", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>？</button>
              </div>
              {rosterInfoOpen && (
                <p className="fade-in" style={{ fontSize:12, color:"#717171", margin:"0 0 12px", lineHeight:1.6 }}>一緒に働いたあと「また呼びたい」と評価してお気に入り登録した方のリストです。新しい求人を出すとお知らせが届き、リピート即決ONの求人には応募と同時に自動承認されます。</p>
              )}
              {rosterRows.length === 0
                ? <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>まだ登録はありません。仕事のあと「また呼びたい」で登録できます。</p>
                : <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>{rosterRows.map(r => (<button key={r.worker_id} onClick={()=>openRosterDetail(r.worker_id)} aria-label="働き手の詳細" style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}><Avatar url={r.avatar_url} name={r.nickname || "？"} size={52} /></button>))}</div>}
            </div>
          </div>
          {/* 「期限切れの求人を見る」リンクは削除（2026-07-25たきと指示）。ページ自体(/profile/employer/expired)はURL直打ちで到達可 */}
        </>
      ) : (
      <>
      {/* 浮遊の「← 農家プロ」「＋ 求人を出す」ボックスは削除（2026-07-25たきと指示）。
          戻りは下部ナビのプロフィールタブ、求人作成は入口カードの「📝新しく求人を出す」と☰メニューが担う */}
      {/* 旧タブ列は廃止（2026-07-14）：ナビは入口カードメニューに一本化。現在地の見出しだけ残す */}
      {/* 作成中⇄公開中は上部タブで行き来できる（2026-07-16）。入口ボックスはそれぞれ自分のページ（hash）を開く */}
      {(jobTab==="draft" || jobTab==="active") ? (
        <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
          {[
            { k:"draft",  l:"作成中", h:"/profile/employer/drafts", n:dbDrafts.length },
            { k:"active", l:"公開中", h:"/profile/employer/active", n:dbActive.length },
          ].map(t => (
            <button key={t.k} onClick={()=>{ if (jobTab !== t.k) { setJobTab(t.k); window.location.hash = t.h; } }} className="f-sans"
              style={{ flex:1, padding:"11px 0", borderRadius:12, border: jobTab===t.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:14, fontWeight: jobTab===t.k ? 800 : 600, color: jobTab===t.k ? "#222" : "#999", cursor:"pointer" }}>
              {t.l}{t.n > 0 ? `（${t.n}）` : ""}
            </button>
          ))}
        </div>
      ) : jobTab==="calendar" ? null : (
        <h2 className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 16px" }}>{(JOB_TABS.find(t => t.k === jobTab) || {}).l || ""}</h2>
      )}
      {/* 作成中⇄公開中はページャー（2026-07-16）：文字・絵文字・ボタン・カードが指に追従して実際に横移動する */}
      {(jobTab==="draft" || jobTab==="active") ? (
      <div onTouchStart={onPagerStart} onTouchMove={onPagerMove} onTouchEnd={onPagerEnd} style={{ overflow:"hidden", touchAction:"pan-y" }}>
        <div ref={pagerTrackRef} style={{ display:"flex", width:"200%", transform: jobTab==="draft" ? "translateX(0%)" : "translateX(-50%)", transition:"transform .3s ease" }}>
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingRight:5 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>{/* 作成中パネル（メルカリ風・横3列） */}
      {draftsLoading ? (
          <p className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>
        ) : dbDrafts.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🌱</div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>作成中の求人はありません</p>
            <button onClick={onNewJob} className="btn-primary" style={{ padding:"12px 28px", fontSize:14 }}>＋ 新しく求人を出す</button>
          </div>
        ) : (
          (() => {
            // 作成中と審査中をセクションで分離（2026-07-16）。審査中は閲覧のみ（再開/削除は作成中のみ）
            const renderDraftCard = (d) => {
              const photo = d.photos && d.photos[0] ? (typeof d.photos[0] === "string" ? d.photos[0] : d.photos[0]?.url) : null;
              return (
              <button key={d.job_number} onClick={()=>setPreviewJob({ num: d.job_number, draft: d.status === "draft" })}
                className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                  {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "📝"}
                  {/* タブ名（作成中）と同じ帯は出さない（2026-07-25たきと指示・重複排除）。タブと違う状態＝審査中だけ帯を出す */}
                  {d.status === "pending" && <StatusRibbon label="審査中" color="#C77700" />}
                </div>
                <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{((d.crop||"")+" "+(d.task||"")).trim() || "無題の求人"}</p>
              </button>
              );
            };
            const making = dbDrafts.filter(d => d.status === "draft");
            const pending = dbDrafts.filter(d => d.status === "pending");
            return (
              <>
                {making.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#8A6D1D", margin:"0 0 -2px" }}>作成中（{making.length}）</p>}
                {making.map(renderDraftCard)}
                {pending.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#C77700", margin:"8px 0 -2px" }}>審査中（{pending.length}）</p>}
                {pending.map(renderDraftCard)}
              </>
            );
          })()
        )}
            </div>
          </div>
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingLeft:5 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>{/* 公開中パネル（メルカリ風・横3列） */}
      {(dbActive.length === 0 && dbExpired.length === 0) ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0" }}>{/* 空状態は作成中ページと全く同じ配置（2026-07-16） */}
            <div style={{ fontSize:40, marginBottom:12 }}>🌾</div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>公開中の求人はありません</p>
            <button onClick={onNewJob} className="btn-primary" style={{ padding:"12px 28px", fontSize:14 }}>＋ 新しく求人を出す</button>
          </div>
        ) : (
          (() => {
            // 審査中(pending)と公開中(open)をセクションで分離（2026-07-16）。
            // 終了（作業日程が過ぎた求人）も公開中ボックスに残す（2026-07-22）＝endedフラグで灰色帯「終了」
            const renderActiveJobCard = (d, ended=false) => {
              const photo = d.photos && d.photos[0] ? (typeof d.photos[0] === "string" ? d.photos[0] : d.photos[0]?.url) : null;
              return (
              <div key={d.job_number} onClick={()=>setPreviewJob({ num: d.job_number, draft: d.status === "draft", open: d.status === "open" })} style={{ border:"1px solid #EBEBEB", borderRadius:12, overflow:"hidden", background:"#fff", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                  {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter: ended ? "grayscale(40%)" : "none" }} /> : (ended ? "🍂" : "🌾")}
                  {/* タブ名（公開中）と同じ帯は出さない（2026-07-25たきと指示・重複排除）。タブと違う状態＝終了・一時非公開・審査中だけ帯を出す */}
                  {!(d.status === "open" && !ended) && <StatusRibbon label={ended ? "終了" : d.status==="draft" ? "一時非公開" : "審査中"} color={ended ? "#9E9E9E" : d.status==="draft" ? "#757575" : "#C77700"} />}
                  {qUnansweredMap[d.job_number] > 0 && (
                    <span className="f-sans" style={{ position:"absolute", top:6, right:6, background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, borderRadius:20, padding:"2px 8px", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}>❓{qUnansweredMap[d.job_number]}</span>
                  )}
                </div>
                <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{((d.crop||"")+" "+(d.task||"")).trim() || "無題"}</p>
              </div>
              );
            };
            const open = dbActive.filter(d => d.status === "open");
            const unpub = dbActive.filter(d => d.status === "draft"); // 一時非公開（掲載歴あり）
            const ended = dbExpired; // 作業日程が過ぎた求人＝終了（探すからは自動で外れるが、農家の公開中ボックスには残す）
            return (
              <>
                {open.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#00A86B", margin:"0 0 -2px" }}>公開中（{open.length}）</p>}
                {open.map(d => renderActiveJobCard(d))}
                {unpub.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#757575", margin:"8px 0 -2px" }}>一時非公開（{unpub.length}）</p>}
                {unpub.map(d => renderActiveJobCard(d))}
                {ended.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#9E9E9E", margin:"8px 0 -2px" }}>終了（{ended.length}）</p>}
                {ended.map(d => renderActiveJobCard(d, true))}
              </>
            );
          })()
        )}
            </div>
          </div>
        </div>
      </div>
      ) : (
      <div onTouchStart={jobTab==="applicants" ? onAppSwipeStart : undefined} onTouchEnd={jobTab==="applicants" ? onAppSwipeEnd : undefined} style={{ display:"grid", gridTemplateColumns: (jobTab==="applicants"||jobTab==="expired") ? "repeat(3, 1fr)" : "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: (jobTab==="applicants"||jobTab==="expired") ? 10 : 20 }}>{/* 求人一覧はメルカリ風に横3列固定・タイトルのみ */}
      {/* 2026-07-14: プレビューページ廃止＝トップボックスタップで直接編集ページへ。プレビューは編集ページ右上→モーダル */}
      {jobTab==="profile" ? (
        <EmployerProfileEdit me={me} />
      ) : jobTab==="applicants" ? (
        dbApplicants.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
            <div style={{ fontSize:40, marginBottom:12 }}>📩</div>
            <p style={{ fontSize:14, margin:0 }}>まだ応募はありません</p>
            <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>求人が公開されると、働き手が応募できます。</p>
          </div>
        ) : (
          // 応募者を求人毎に分ける（2026-07-19）。上部＝状態フィルタタブ（タップ＋横スワイプ）／下部＝帯の意味の説明（2026-07-22）
          (() => {
            const shown = dbApplicants.filter(a => (APP_FILTERS.find(f => f.k === appFilter) || APP_FILTERS[0]).match(a.status));
            const order = []; const byJob = {};
            shown.forEach(a => { const jn = a.job_number; if (!jobInfoMap[jn]) return; if (!byJob[jn]) { byJob[jn] = []; order.push(jn); } byJob[jn].push(a); });
            const tabBar = (
              <div key="app-tabs" style={{ gridColumn:"1/-1", display:"flex", gap:6, marginBottom:2, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
                {APP_FILTERS.map(f => (
                  <button key={f.k} onClick={()=>setAppFilter(f.k)} className="f-sans" style={{ flex:"1 0 auto", padding:"8px 14px", borderRadius:20, border: appFilter===f.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:13, fontWeight: appFilter===f.k?800:600, color: appFilter===f.k?"#222":"#999", cursor:"pointer", whiteSpace:"nowrap" }}>{f.l}</button>
                ))}
              </div>
            );
            const legend = (
              <div key="app-legend" style={{ gridColumn:"1/-1", marginTop:14 }}>
                <button onClick={()=>setAppLegendOpen(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#555" }}>帯（ステータス）の意味</span>
                  <span style={{ fontSize:14, color:"#999" }}>{appLegendOpen ? "－" : "＋"}</span>
                </button>
                {appLegendOpen && (
                  <div className="fade-in" style={{ marginTop:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:10, padding:"12px 14px", display:"grid", gap:10 }}>
                    {/* 帯は5段＋終端（2026-07-25たきと指示）：応募中→面接中→採用→作業中→完了。すべて農家のアクションで進む */}
                    {[["applied","応募中","応募が届いた状態。プロフィールを見て、承認するか見送るかを決めます"],["interview","面接中","承認した応募。チャットで面接し、採用するかを決めます"],["contracted","採用","採用が決まった応募。作業日などの連絡はチャットで"],["working","作業中","作業当日・進行中"],["completed","完了","作業が終わった応募。お互いを評価できます"],["rejected","見送り","見送りにした応募"],["expired","失効","作業日程が過ぎ、自動で締め切られた求人。カード全体が黒くなり、応募は失効当時の状態のまま表示・操作はできません"]].map(([st,l,d]) => (
                      <div key={l} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                        <span className="f-sans" style={{ flexShrink:0, marginTop:1, background:APP_PHASE_COLOR[st], color:"#fff", fontSize:11, fontWeight:700, borderRadius:6, padding:"3px 8px", minWidth:56, textAlign:"center" }}>{l}</span>
                        <span className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.6 }}>{d}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
            const body = order.length === 0
              ? [<p key="app-empty" className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"36px 0" }}>この状態の応募者はいません</p>]
              : order.map(jn => {
                  // 求人カード化（2026-07-25たきと指示）：左＝トップ写真／右＝タイトル・No.／その下に応募者アイコンの横スワイプ列。
                  // アイコン列のtouchはstopPropagationで親のフィルタ切替スワイプと分離する
                  const info = jobInfoMap[jn] || {};
                  const title = [info.crop, info.task].filter(Boolean).join(" ") || `求人 #${jn}`;
                  // 表示は軽量サムネ優先（2026-07-25）：thumbが無い旧写真は原寸URLへフォールバック
                  const p0 = info.photos && info.photos[0];
                  const photo = p0 ? (typeof p0 === "string" ? p0 : (p0.thumb || p0.url)) : null;
                  // 終端求人の暗幕設計（2026-07-25たきと指示・完了も失効と同じ設計）：
                  // 日程が過ぎた求人は、完了記録あり＝「完了」／なし＝「失効」の暗幕＋中央ラベル＋タップ無反応
                  const jobEnd = info.date_end || info.date_start;
                  const jobPast = !!jobEnd && jobEnd < ymdLocal(new Date());
                  const jobCompleted = jobPast && byJob[jn].some(a => a.status === "completed");
                  const jobExpired = jobPast && !jobCompleted;
                  return (
                    <div key={`job-${jn}`} style={{ gridColumn:"1/-1", position:"relative", display:"flex", alignItems:"stretch", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden", marginTop:2, pointerEvents: jobPast ? "none" : undefined }}>
                      {jobPast && (
                        <div style={{ position:"absolute", inset:0, zIndex:2, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <span className="f-sans" style={{ background: jobCompleted ? "#607D8B" : "#111", color:"#fff", fontSize:13, fontWeight:800, borderRadius:8, padding:"6px 20px", letterSpacing:"0.15em" }}>{jobCompleted ? "完了" : "失効"}</span>
                        </div>
                      )}
                      {/* 左：求人のトップ写真（タップで求人を見る） */}
                      <button onClick={()=>setPreviewJob({ num: jn })} aria-label="求人を見る"
                        style={{ flexShrink:0, width:92, padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, overflow:"hidden" }}>
                        {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover", filter: jobPast ? "grayscale(70%)" : "none" }} /> : "🌱"}
                      </button>
                      {/* 右：タイトル・No.＋応募者アイコンスワイプ */}
                      <div style={{ flex:1, minWidth:0, padding:"10px 12px 8px" }}>
                        <button onClick={()=>setPreviewJob({ num: jn })} className="f-sans"
                          style={{ display:"flex", alignItems:"center", gap:8, width:"100%", textAlign:"left", background:"none", border:"none", padding:0, cursor:"pointer" }}>
                          {/* No.は必ず明記（2026-07-25たきと指示）：タイトルだけ「…」で省略し、#No.は省略対象から分離して常時表示 */}
                          <span style={{ flex:1, minWidth:0, display:"flex", alignItems:"baseline", gap:6 }}>
                            <span style={{ fontSize:14, fontWeight:700, color:"#222", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</span>
                            <span style={{ fontSize:11, color:"#C8C8C8", fontWeight:700, flexShrink:0 }}>#{jn}</span>
                          </span>
                          <span style={{ fontSize:11, color:"#00A86B", fontWeight:700, flexShrink:0 }}>{byJob[jn].length}名 →</span>
                        </button>
                        {/* アイコンのみ・中央配置（2026-07-25たきと指示）：箱装飾なし。少人数なら中央、溢れたら横スクロール（max-content＋margin auto） */}
                        <div onTouchStart={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}
                          style={{ overflowX:"auto", WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain", paddingTop:8, paddingBottom:2 }}>
                          <div style={{ display:"flex", gap:12, width:"max-content", margin:"0 auto" }}>
                          {byJob[jn].map(a => {
                            const wp = workerProfiles[a.worker_id];
                            // 失効応募のアイコンは「失効当時の状態」で表示（2026-07-25たきと指示）。失効はappliedからのみ発生（cron）＝応募中。
                            // 失効の事実はカード全体の黒「失効」オーバーレイが担う（アイコン側に失効ラベルは出さない）
                            const phaseA = a.status === "expired" ? { ...a, status: "applied" } : a;
                            return (
                              <button key={a.id} onClick={()=>setSheetApplicantId(a.id)} className="f-sans"
                                style={{ flexShrink:0, width:64, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                                <Avatar url={wp?.avatar_url} name={wp?.nickname || "？"} size={52} ring={appRibbonColor(phaseA)} />
                                <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color: wp?.nickname ? "#222" : "#999", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{wp?.nickname || "未設定"}</span>
                                <span onClick={(e)=>{ e.stopPropagation(); openPhaseInfo(appPhaseKey(phaseA)); }} role="button" style={{ display:"block", fontSize:9, fontWeight:700, color:appRibbonColor(phaseA), marginTop:1, cursor:"pointer" }}>{appRibbonLabel(phaseA)}</span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
            return [tabBar, ...body, legend];
          })()
        )
      ) : jobTab==="expired" ? (
        dbExpired.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
            <div style={{ fontSize:40, marginBottom:12 }}>🍂</div>
            <p style={{ fontSize:14, margin:0 }}>期限切れの求人はありません</p>
            <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>作業日程が過ぎた求人がここに入ります。</p>
          </div>
        ) : (
          dbExpired.map(d => {
            const photo = d.photos && d.photos[0] ? (typeof d.photos[0] === "string" ? d.photos[0] : d.photos[0]?.url) : null;
            return (
            <button key={d.job_number} onClick={()=>setPreviewJob({ num: d.job_number, draft: d.status === "draft" })}
              className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
              <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter:"grayscale(40%)" }} /> : "🍂"}
                <StatusRibbon label="期限切れ" color="#9E9E9E" />
              </div>
              <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{((d.crop||"")+" "+(d.task||"")).trim() || "無題"}</p>
            </button>
            );
          })
        )
      ) : jobTab==="calendar" ? (
        <div style={{ gridColumn:"1/-1" }}><MyCalendar /></div>
      ) : jobList.length === 0 ? (
        <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0 40px" }}>
          <div style={{ fontSize:44, marginBottom:14 }}>🌱</div>
          <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:6 }}>まだ求人がありません</p>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:22 }}>最初の求人を出して、働き手を募集しましょう。</p>
          <button onClick={onNewJob} className="btn-primary" style={{ padding:"14px 32px", fontSize:14 }}>＋ 新しく求人を出す</button>
        </div>
      ) : jobList.map(job => (
        <div key={job.id} style={{ display:"block", width:"100%", background:"#fff", border:"1px solid #EEE", borderRadius:12, overflow:"hidden" }}>
          <div style={{ width:"100%", height:220, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:72 }}>{job.icon}</div>
          <div style={{ padding:"12px 16px 16px" }}>
            <p className="f-sans" style={{ fontSize:16, fontWeight:600, color:"#222", margin:0, marginBottom:4 }}>{job.crop} {job.task}</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0, marginBottom:6 }}>{job.dateLabel}　{job.region}</p>
            <p className="f-mono" style={{ fontSize:15, fontWeight:700, color:"#00A86B", margin:0 }}>{payLabel(job)}</p>
          </div>
        </div>
      ))}
      </div>
      )}
      </>
      )}

      {/* 応募者カードのボトムシート（タップで展開・中身は従来の応募者カード＝操作ボタン込み） */}
      {(() => {
        const live = dbApplicants.find(x => x.id === sheetApplicantId);
        if (!live) return null;
        return (
          <div onClick={()=>setSheetApplicantId(null)} style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                <button onClick={()=>setSheetApplicantId(null)} aria-label="戻る" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px" }}>
                {renderApplicantCard(live)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 完了・評価モーダル（Part1） */}
      {/* 働く日を決めるモーダル（2026-07-24 追記3）：来られる日をプリセット→農家がタップ選択→set_agreed_dates */}
      {agreeModal && (() => {
        const info = jobInfoMap[agreeModal.job_number] || {};
        const av = agreeModal.available_dates;
        // 候補＝働き手の来られる日（配列）。いつでもOK("any")や未宣言は求人の全期間
        const candidates = Array.isArray(av) && av.length > 0 ? av.slice().sort() : daysBetweenYmd(info.date_start, info.date_end);
        return (
          <div onClick={()=>{ if (!agreeSaving) { setAgreeModal(null); setAgreeSel([]); } }} style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div onClick={e=>e.stopPropagation()} className="f-sans" style={{ background:"#fff", borderRadius:16, padding:22, maxWidth:440, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
              <p style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 4px" }}>📅 働く日を決める</p>
              <p style={{ fontSize:12, color:"#717171", margin:"0 0 14px", lineHeight:1.6 }}>
                {Array.isArray(av) ? "働き手が「来られる日」に選んだ日から確定します。" : "働き手は「期間中いつでもOK」です。働く日を選んで確定します。"}
                働き手にお知らせが届きます（変更したら再送されます）。
              </p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:18 }}>
                {candidates.map(d => {
                  const on = agreeSel.includes(d);
                  return (
                    <button key={d} onClick={()=>setAgreeSel(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])} style={{ padding:"9px 12px", fontSize:13, fontWeight:700, borderRadius:20, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{calFmtDate(d)}</button>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>{ if (!agreeSaving) { setAgreeModal(null); setAgreeSel([]); } }} style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>やめる</button>
                <button disabled={agreeSaving || agreeSel.length===0} onClick={async ()=>{
                  if (agreeSel.length===0) return;
                  setAgreeSaving(true);
                  const dates = [...agreeSel].sort();
                  const { data, error } = await supabase.rpc("set_agreed_dates", { p_application_id: agreeModal.id, p_dates: dates });
                  setAgreeSaving(false);
                  if (error || !data?.ok) { alert("確定に失敗しました：" + (data?.message || data?.reason || error?.message || "不明")); return; }
                  setDbApplicants(prev => prev.map(x => x.id===agreeModal.id ? { ...x, agreed_dates: dates } : x));
                  setAgreeModal(null); setAgreeSel([]);
                }} className="btn-primary" style={{ flex:2, padding:"13px", fontSize:14, fontWeight:700, borderRadius:12, opacity: (agreeSaving || agreeSel.length===0) ? 0.5 : 1, cursor: agreeSel.length===0 ? "not-allowed" : "pointer" }}>{agreeSaving ? "確定中..." : `この日で確定する${agreeSel.length>0 ? `（${agreeSel.length}日）` : ""}`}</button>
              </div>
            </div>
          </div>
        );
      })()}
      {completeModalApp && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
            {completeStep === "attend" ? (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:16 }}>働き手は来ましたか？</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={markNoShow} disabled={completeSubmitting} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:600, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer" }}>来なかった</button>
                  <button onClick={()=>setCompleteStep("review")} disabled={completeSubmitting} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>はい</button>
                </div>
                <button onClick={()=>setCompleteModalApp(null)} className="f-sans" style={{ display:"block", margin:"16px auto 0", background:"none", border:"none", color:"#717171", fontSize:12, cursor:"pointer" }}>キャンセル</button>
              </>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:16 }}>作業の評価</p>
                <YesNoPill label="また呼びたい" value={completeWantAgain} onChange={setCompleteWantAgain} />
                <YesNoPill label="安心して任せられた" value={completeEntrust} onChange={setCompleteEntrust} />
                <textarea value={completePublicComment} onChange={e=>setCompletePublicComment(e.target.value)} placeholder="働きぶりで良かった点を一言（働き手のプロフィールに表示されます）" rows={3}
                  className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:8 }} />
                <textarea value={completePrivateMemo} onChange={e=>setCompletePrivateMemo(e.target.value)} placeholder="自分だけが見えるメモ（任意）" rows={3}
                  className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
                {completeWantAgain === true && (
                  <label className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#222", cursor:"pointer", marginBottom:16 }}>
                    <input type="checkbox" checked={completeNotifyNext} onChange={e=>setCompleteNotifyNext(e.target.checked)} style={{ width:18, height:18, accentColor:"#00A86B", flexShrink:0 }} />
                    ❤️ お気に入り登録する
                  </label>
                )}
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setCompleteModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submitFarmerReview} disabled={completeSubmitting || completeWantAgain===null || completeEntrust===null}
                    className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{completeSubmitting ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 求人カードタップ→確認ページと同型のボトムシート（作成中=再開・削除ボタン付き） */}
      {previewJob && (
        <AdminJobPreview jobNumber={previewJob.num} ownerView
          onClose={()=>setPreviewJob(null)}
          onResumeJob={previewJob.draft ? ()=>{ const n = previewJob.num; setPreviewJob(null); onResume(n); } : undefined}
          onDeleteJob={previewJob.draft ? async ()=>{
            if (!confirm("この求人（下書き）を削除しますか？元に戻せません")) return;
            const { error } = await supabase.from("jobs").delete().eq("job_number", previewJob.num).eq("farmer_id", me.id);
            if (error) { alert("削除に失敗しました：" + error.message); return; }
            setDbDrafts(prev => prev.filter(d => d.job_number !== previewJob.num));
            setDbActive(prev => prev.filter(d => d.job_number !== previewJob.num)); // 一時非公開は公開中タブ側にいる
            setPreviewJob(null);
          } : undefined}
          onUnpublishJob={previewJob.open ? async ()=>{
            // 一時非公開（2026-07-16）：open→draftへ（unpublish_job RPC・本人限定）。編集は作成中→再開から。再掲載は審査を通る
            const { data, error } = await supabase.rpc("unpublish_job", { p_job_number: previewJob.num });
            if (error || !data?.ok) { alert("一時非公開にできませんでした：" + (data?.reason || error?.message || "不明")); return; }
            // 公開中タブに「一時非公開」帯で残す（2026-07-16たきと指定）。opened_atは掲載歴の印としてそのまま
            setDbActive(prev => prev.map(d => d.job_number === previewJob.num ? { ...d, status: "draft" } : d));
            setPreviewJob(null);
          } : undefined}
          onCopyJob={async ()=>{
            const { data, error } = await supabase.rpc("copy_job", { p_job_number: previewJob.num });
            if (error || !data?.ok) { alert("コピーに失敗しました：" + (data?.reason || error?.message || "不明")); return; }
            // 元の日程が過ぎていた場合は空で複製される（終了扱い防止・2026-07-24）。選び直しを案内
            if (data.dates_cleared) alert("コピーしました。元の作業日程は終了しているため空にしています。確認ページの「日程」から新しい日を選んでください。");
            setPreviewJob(null);
            window.location.hash = "/work/edit/" + data.job_number; // 新しい下書きを編集フローで開く
          }} />
      )}

      {/* お気に入り登録しました！ボックス（2026-07-19）：働き手アイコンに❤️が付く動作・説明は1文×2・詳細は展開 */}
      {favDone && (
        <div onClick={()=>setFavDone(null)} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"28px 24px 24px", maxWidth:360, width:"100%", textAlign:"center", position:"relative", boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
            <button onClick={()=>setFavDone(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 18px" }}>お気に入り登録しました！</p>
            <div onClick={()=>openWorkerPreview(favDone.workerId)} role="button" style={{ position:"relative", width:88, height:88, margin:"0 auto 16px", cursor:"pointer" }}>
              <Avatar url={favDone.avatar_url} name={favDone.nickname || "？"} size={88} />
              <span className="cb-heart-pop" style={{ position:"absolute", right:-8, bottom:-4, fontSize:32, lineHeight:1, filter:"drop-shadow(0 2px 4px rgba(0,0,0,0.25))" }}>❤️</span>
            </div>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.8, margin:"0 0 6px" }}>「また呼びたい」と思った方を、あなたのお気に入りに登録しました。</p>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.8, margin:0 }}>リピート即決ONのあなたの求人にこの方が応募すると、自動で承認されます。</p>
            {favDetailOpen ? (
              <div className="f-sans fade-in" style={{ marginTop:14, background:"#F7F7F7", borderRadius:12, padding:"12px 14px", textAlign:"left", fontSize:12, color:"#555", lineHeight:1.8 }}>
                ・新しい求人を出すと、この方にお知らせが届きます<br/>
                ・効果はあなた自身の求人だけに働き、ほかの農家の求人には影響しません<br/>
                ・登録した方は農家プロフィールの「❤️ また呼びたいリスト」に表示されます<br/>
                ・解除はいつでも：リストのアイコンをタップ→「お気に入りを解除する」
              </div>
            ) : (
              <button onClick={()=>setFavDetailOpen(true)} className="f-sans" style={{ marginTop:14, background:"none", border:"none", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>詳しく見る ▾</button>
            )}
          </div>
        </div>
      )}
      {/* また呼びたいリスト：働き手詳細モーダル（アイコンタップで展開・応募者カードと同じ表示部品） */}
      {rosterDetail && (
        <div onClick={()=>setRosterDetail(null)} style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setRosterDetail(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 16px" }}>働き手の詳細</p>
            {rosterDetail.loading ? (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中...</p>
            ) : rosterDetail.profile ? (
              <>
                <WorkerTrustCard profile={rosterDetail.profile} trust={rosterDetail.trust} />
                <MyReviewsOfWorker workerId={rosterDetail.worker_id} />
                {Array.isArray(rosterDetail.profile.pr_qa) && rosterDetail.profile.pr_qa.length > 0 && (
                  <div style={{ display:"grid", gap:10, marginTop:16 }}>
                    {rosterDetail.profile.pr_qa.map(({ q, a }) => (
                      <div key={q}>
                        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
                        <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>この方のプロフィールは未設定です</p>
            )}
            <button onClick={()=>{ const wid = rosterDetail.worker_id; setRosterDetail(null); stopRosterNotify(wid); }} className="f-sans" style={{ width:"100%", marginTop:16, padding:"12px", fontSize:13, fontWeight:600, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A44", borderRadius:10, cursor:"pointer" }}>
              お気に入りを解除する
            </button>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, margin:"8px 0 0", textAlign:"center" }}>解除するとリストから外れ、新しい求人のお知らせとリピート即決の対象からも外れます</p>
          </div>
        </div>
      )}

      {/* 評価登録完了モーダル（評価送信後の控え） */}
      {completeDone && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setCompleteDone(null)} aria-label="戻る" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 16px" }}>☑️ 評価登録完了</p>
            <div className="f-sans" style={{ display:"grid", gap:8, fontSize:13, marginBottom:14 }}>
              <div style={{ display:"flex", gap:8 }}>
                <span style={{ flexShrink:0, width:72, color:"#717171" }}>求人</span>
                <span style={{ fontWeight:700, color:"#222" }}>{completeDone.jobLabel || ("求人 #" + completeDone.jobNumber)}</span>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <span style={{ flexShrink:0, width:72, color:"#717171" }}>求職者</span>
                <span style={{ fontWeight:700, color:"#222" }}>{completeDone.workerName}</span>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <span style={{ flexShrink:0, width:72, color:"#717171" }}>登録日時</span>
                <span style={{ color:"#222" }}>{completeDone.at}</span>
              </div>
            </div>
            <div className="f-sans" style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", fontSize:13, marginBottom:14 }}>
              <p style={{ fontSize:12, fontWeight:700, color:"#717171", margin:"0 0 8px" }}>評価内容</p>
              <p style={{ margin:"0 0 4px", color:"#222" }}>また呼びたい：<strong>{completeDone.wantAgain ? "はい" : "いいえ"}</strong></p>
              <p style={{ margin:0, color:"#222" }}>安心して任せられた：<strong>{completeDone.entrust ? "はい" : "いいえ"}</strong></p>
              {completeDone.publicComment && (
                <p style={{ margin:"8px 0 0", color:"#222", lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>{completeDone.publicComment}</p>
              )}
              {completeDone.privateMemo && (
                <p style={{ margin:"8px 0 0", color:"#717171", lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>🔒 {completeDone.privateMemo}</p>
              )}
            </div>
            <label className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#222", cursor:"pointer", marginBottom:16 }}>
              <input type="checkbox" checked={completeDone.favorited} onChange={e=>toggleDoneFavorite(e.target.checked)} style={{ width:18, height:18, accentColor:"#00A86B", flexShrink:0 }} />
              お気に入り登録（また呼びたいリストに登録し、次の求人をお知らせする）
            </label>
            <button onClick={()=>setCompleteDone(null)} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>閉じる</button>
          </div>
        </div>
      )}

      {/* 緊急連絡モーダル（Part3・農家側） */}
      {emergencyModalApp && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%" }}>
            {emergencySent ? (
              <>
                <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0 8px", margin:0, lineHeight:1.7 }}>
                  ⚠️ {(FARMER_EMERGENCY_KINDS.find(k=>k.v===emergencyKind)?.l || "緊急")}の連絡を{emergencyCtx?.partnerName ? emergencyCtx.partnerName + "さん" : "働き手さん"}に送りました（{emergencySentAt}）
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
                  {FARMER_EMERGENCY_KINDS.map(k => (
                    <button key={k.v} type="button" onClick={()=>setEmergencyKind(k.v)} className="f-sans" style={{
                      flex: k.v==="no_show_report" ? "1 1 100%" : "1 1 0", padding:"9px", borderRadius:10, fontSize:13, cursor:"pointer", fontWeight:600, border:"2px solid",
                      borderColor: emergencyKind===k.v ? "#00A86B" : "#EBEBEB",
                      background: emergencyKind===k.v ? "#E6F7EF" : "#fff", color: emergencyKind===k.v ? "#00A86B" : "#222",
                    }}>{k.l}</button>
                  ))}
                </div>
                {emergencyKind==="no_show_report" && (
                  <div className="f-sans" style={{ background:"#FFF4E0", borderRadius:10, padding:"10px 12px", marginBottom:12, fontSize:12, color:"#C77700", lineHeight:1.7 }}>
                    まずチャットか電話で連絡を試してください。15分待っても会えない時にこの連絡を送ると、相手と運営に即時に通知され、日時が記録されます。<br/>
                    作業後の欠勤の記録とは別の、その場の緊急連絡です。
                  </div>
                )}
                <textarea value={emergencyReason} onChange={e=>setEmergencyReason(e.target.value)} placeholder="理由・詳細" rows={4}
                  className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setEmergencyModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submitEmergency} disabled={emergencySubmitting || !emergencyKind || !emergencyReason.trim()}
                    className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{emergencySubmitting ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ 面接の質問集 管理モーダル（2026-07-23）：セットの作成・編集・削除＋テンプレのコピー ═══ */}
      {qMgrOpen && (
        <div className="qset-full">
          {/* 見出しまわりは保険の準備ページと同じ構造（2026-07-25たきと指示）：小さい「← 戻る」→絵文字付き見出し→グレー説明文 */}
          <div className="f-sans" style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", maxWidth:560, width:"100%", margin:"0 auto", padding:"calc(env(safe-area-inset-top,0px) + 24px) 20px calc(env(safe-area-inset-bottom,0px) + 96px)", boxSizing:"border-box" }}>
            <button onClick={()=>{ if (qEditing) setQEditing(null); else closeQMgr(); }} className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:14, cursor:"pointer", padding:"4px 0 14px", display:"inline-flex", alignItems:"center", gap:6 }}>← 戻る</button>
            <h1 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:"0 0 6px" }}>📋 面接の質問集</h1>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 20px", lineHeight:1.7 }}>聞きたいことをセットにして保存し、応募者のチャットに送れます。回答もチャットに残ります。</p>

            {qEditing === null ? (
              <>
                {questionSets.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:18 }}>
                    {questionSets.map(s => (
                      <button key={s.id} onClick={()=>setQEditing({ id:s.id, title:s.title || "", questions: (Array.isArray(s.questions) && s.questions.length ? [...s.questions] : [""]) })} className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px", cursor:"pointer" }}>
                        <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222" }}>{s.title || "無題の質問集"}</span>
                        <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2 }}>質問{Array.isArray(s.questions) ? s.questions.length : 0}問</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* テンプレ区画は削除（2026-07-25たきと指示）：＋自分で作るを押した時、未使用テンプレの内容を
                    デフォルト値として入力欄に表示する方式に（編集・上書き保存可能）。全テンプレ使用済みなら白紙 */}
                <button onClick={()=>{
                  const used = new Set(questionSets.map(s => s.title));
                  const tpl = INTERVIEW_TEMPLATES.find(t => !used.has(t.title));
                  setQEditing(tpl ? { title: tpl.title, questions: [...tpl.questions] } : { title:"", questions:[""] });
                }} className="f-sans" style={{ width:"100%", background:"#fff", border:"1px dashed #C8C8C8", borderRadius:12, padding:"12px", fontSize:14, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>＋ 自分で作る</button>
              </>
            ) : (
              <>
                <label className="f-sans" style={{ display:"block", fontSize:12, fontWeight:700, color:"#222", marginBottom:6 }}>タイトル</label>
                <input value={qEditing.title} onChange={e=>setQEditing(prev=>({ ...prev, title:e.target.value }))} placeholder="例：経験の確認" className="field f-sans" style={{ fontSize:14, marginBottom:16 }} />
                <label className="f-sans" style={{ display:"block", fontSize:12, fontWeight:700, color:"#222", marginBottom:6 }}>質問（最大5問）</label>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
                  {qEditing.questions.map((q,i) => (
                    <div key={i} style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <span className="f-sans" style={{ fontSize:13, color:"#999", flexShrink:0, width:16 }}>{i+1}.</span>
                      <input value={q} onChange={e=>setQEditing(prev=>({ ...prev, questions: prev.questions.map((x,j)=> j===i ? e.target.value : x) }))} placeholder={`質問${i+1}`} className="field f-sans" style={{ fontSize:14, flex:1 }} />
                      {qEditing.questions.length > 1 && (
                        <button onClick={()=>setQEditing(prev=>({ ...prev, questions: prev.questions.filter((_,j)=>j!==i) }))} aria-label="削除" className="f-sans" style={{ flexShrink:0, width:32, height:32, borderRadius:8, background:"#F5F5F5", border:"none", color:"#999", fontSize:16, cursor:"pointer" }}>×</button>
                      )}
                    </div>
                  ))}
                </div>
                {qEditing.questions.length < 5 && (
                  <button onClick={()=>setQEditing(prev=>({ ...prev, questions:[...prev.questions, ""] }))} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"9px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600, marginBottom:16 }}>＋ 質問を追加</button>
                )}
                <div style={{ display:"flex", gap:8, marginTop:4 }}>
                  <button onClick={()=>setQEditing(null)} className="f-sans" style={{ flex:"0 0 auto", padding:"11px 16px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>戻る</button>
                  <button onClick={saveQuestionSet} disabled={qSaving} className="f-sans" style={{ flex:1, padding:"11px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{qSaving ? "保存中..." : "保存する"}</button>
                </div>
                {qEditing.id && (
                  <button onClick={()=>deleteQuestionSet(qEditing.id)} className="f-sans" style={{ width:"100%", marginTop:10, padding:"9px", fontSize:13, background:"none", color:"#E24B4A", border:"none", cursor:"pointer" }}>この質問集を削除</button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ 質問を送る（応募者カード「📋 質問を送る」→セット選択→send_interview_questions RPC・2026-07-23） ═══ */}
      {sendQTarget && (
        <div onClick={()=>{ if (!sendingQ) setSendQTarget(null); }} style={{ position:"fixed", inset:0, zIndex:10002, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:"20px 20px 0 0", padding:"22px 20px calc(env(safe-area-inset-bottom,0px) + 20px)", maxWidth:520, width:"100%", maxHeight:"80vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>{ if (!sendingQ) setSendQTarget(null); }} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>✕</button>
            <h3 className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 4px", paddingRight:40 }}>📋 質問を送る</h3>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 16px", lineHeight:1.6 }}>選んだ質問集を、この応募者とのチャットに【面接の質問】として送ります。回答もチャットに残ります。</p>
            {questionSets.length === 0 ? (
              <div style={{ textAlign:"center", padding:"12px 0" }}>
                <p className="f-sans" style={{ fontSize:14, color:"#717171", margin:"0 0 16px" }}>まだ質問集がありません。</p>
                <button onClick={()=>{ qMgrScrollY.current=window.scrollY; setSendQTarget(null); setQEditing(null); setQMgrOpen(true); }} className="f-sans" style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:10, padding:"11px 20px", fontSize:14, fontWeight:700, cursor:"pointer" }}>質問集を作る</button>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {questionSets.map(s => (
                  <button key={s.id} disabled={sendingQ} onClick={()=>sendInterviewQuestions(s.id)} className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px", cursor:"pointer" }}>
                    <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222" }}>{s.title || "無題の質問集"}</span>
                    <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{(Array.isArray(s.questions) ? s.questions : []).join(" / ") || "質問なし"}</span>
                  </button>
                ))}
                {sendingQ && <p className="f-sans" style={{ fontSize:12, color:"#999", textAlign:"center", margin:"4px 0 0" }}>送信中...</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
