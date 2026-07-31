// 分割3-C（2026-07-25）：App.jsxから移動。「さがす」求人一覧＋求人詳細＋応募パネル。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { setApplyReturn, clearApplyReturn } from "../lib/applyReturn";
import { fetchWorkerReady } from "../lib/workerReady";
import { openLoginBox } from "../lib/previewBus";
import { ymdLocal, isWorkDayToday, punchStartWindow, calFmtDate, payLabel, mapJobPublicRow, CROP_OPTIONS, EMPTY_MARK, disp, stationLabel, farmHostQa, CHAT_ELIGIBLE_STATUSES, SURVEY_SOURCES, SURVEY_REASONS, farmIntroTopics, perkBadges } from "../lib/utils";
import { Avatar, Carousel, DangerItem, JobFlagBadges, JobPhotoFallback, NoticeJumpText, StatusRibbon, AutoSkeleton, useSkeletonProbe, Dots } from "./ui";
import { getCache, setCache } from "../lib/viewCache";
import { CalendarView } from "./CalendarView";
import { JobCard } from "./JobCard";
import { JobLocationMap } from "./JobLocationMap";
import { ContentQTabs, ContentQSwipeArea, JobQuestions } from "./JobQuestions";
import { InsurancePanel } from "./InsurancePanel";
import { FarmerTrustCard } from "./TrustCards";

// ── JobSearchMapView ────────────────────────────────────────
// 「募集中の仕事を探す」画面。LandingFlow・LaborTab 両方で使用。
// 将来: Google Maps / Mapbox / Leaflet に差し替え可能な構造にしてある。
// 応募パネルの「最高額」自動計算（段階2-a・ダミー前提）
// workTime "8:00〜16:00" を想定。日数は job.dateStart / job.dateEnd（date型）から算出。フォーマット外は null を返す
function calcMaxPay(job) {
  const timeMatch = /^(\d{1,2}):(\d{2})〜(\d{1,2}):(\d{2})$/.exec(job.workTime || "");
  if (!job.dateStart) return null;
  const end = job.dateEnd || job.dateStart;
  const days = Math.round((end - job.dateStart) / 86400000) + 1;
  if (!Number.isFinite(days) || days <= 0) return null;

  if (job.payType === "daily") {
    return job.pay * days;
  }
  if (job.payType === "hourly") {
    if (!timeMatch) return null;
    const [, h1, mi1, h2, mi2] = timeMatch;
    const startH = Number(h1) + Number(mi1) / 60;
    const endH = Number(h2) + Number(mi2) / 60;
    const BREAK_HOURS = 1; // 休憩1hダミー
    const workHours = endH - startH - BREAK_HOURS;
    if (!Number.isFinite(workHours) || workHours <= 0) return null;
    return Math.round(job.pay * workHours * days);
  }
  return null;
}

export function JobSearchMapView({ onRegister, me }) {
  const [selectedJob, setSelectedJob] = useState(null);
  const [detailTab, setDetailTab] = useState("content"); // 求人詳細の「仕事の内容/質問」タブ（第10弾）
  // 別の求人を開いたら内容タブに戻す（2026-07-27：selectedJob監視のリセットeffectは廃止。
  // タブ指定つきURL #/work/job/{番号}/questions の指定を後から打ち消してしまうため、
  // 「開く側」＝openJob・戻るスタック・hash解釈のそれぞれで明示的にタブを決める）
  // 自分の求人か（2026-07-22）：自分の求人には応募フッター（日給・応募ボタン）を出さない。
  // jobsのRLS owner selectで自分の行だけ返る（他人の求人はnull＝false）
  const [isOwnJob, setIsOwnJob] = useState(false);
  // 自分の求人かどうかが分かるまでフッターを出さない（2026-07-27たきと報告「一瞬だけ満員が映ってすぐ戻る」）。
  // 判定は非同期so、既定のfalse（＝他人の求人）のまま一度描くと、自分の満員求人でも
  // 「満員」フッターが出てから消える。確定するまで保留する
  const [ownLoaded, setOwnLoaded] = useState(false);
  // 出どころ（cb_jobBackTo）は開いた時点でstateに引き取る（2026-07-27）：
  // 描画のたびにsessionStorageを読むと、消し忘れが次の求人に持ち越されて戻り先を誤る
  const [backTo, setBackTo] = useState(null);
  // 自分が出した求人の番号（2026-07-29たきと指示「自分の求人にはいいねを付けられないように」）。
  // 一覧のカードは jobs_public 経由で farmer_id を持たないため、自分の求人番号をまとめて引いて突き合わせる。
  // jobsのRLS（owner select）で返るのは自分の行だけso、他人の求人番号は取得できない
  const [myJobNums, setMyJobNums] = useState(() => new Set());
  useEffect(() => {
    if (!me) { setMyJobNums(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("jobs").select("job_number").eq("farmer_id", me.id);
        if (!cancelled && data) setMyJobNums(new Set(data.map(r => r.job_number)));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [me]);
  const canLike = (job) => !!job && !myJobNums.has(job.id); // 自分の求人はいいね対象外

  useEffect(() => {
    if (!selectedJob || !me) { setIsOwnJob(false); setOwnLoaded(!me); return; } // 未ログインは自分の求人ではありえない＝確定
    let cancelled = false;
    setOwnLoaded(false);
    (async () => {
      try {
        const { data } = await supabase.from("jobs").select("farmer_id").eq("job_number", selectedJob.id).maybeSingle();
        if (!cancelled) setIsOwnJob(!!(data && data.farmer_id === me.id));
      } catch { if (!cancelled) setIsOwnJob(false); }
      if (!cancelled) setOwnLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.id, me]);
  // 前回の一覧が残っていればまず出す→裏で最新に差し替える（2026-07-27たきと指示・遷移の待ち時間対策）
  const [dbJobs, setDbJobs] = useState(() => getCache("search:jobs") ?? null);
  // 仮配置の骨を測るref（このページが実際に描いた形が、次回の読み込み中の形になる）
  const skelRef = useSkeletonProbe("search");
  const [dangerLightbox, setDangerLightbox] = useState(null);
  const [farmIntroOpen, setFarmIntroOpen] = useState(false); // 農園紹介モーダル（ページには代表よりのみ・タップで全文展開）
  // 受け入れ実績タップ→この農家の過去の求人ボックス（2026-07-16）
  const [pastJobsOpen, setPastJobsOpen] = useState(false);
  const [pastJobs, setPastJobs] = useState(null); // null=読み込み中
  const [pastJobsTab, setPastJobsTab] = useState("all"); // すべて/公開中/終了（2026-07-23）
  const [pastJobsFocus, setPastJobsFocus] = useState(null); // タップした求人（job_number）。先頭に移動して概要を展開（2026-07-24）
  const [pastJobsCounts, setPastJobsCounts] = useState({}); // { job_number: {applied, approved, hired} }（集計値のみ）
  const [jobBackStack, setJobBackStack] = useState([]); // 過去求人から遷移した時の「前の求人」スタック
  const openPastJobs = async (tab) => {
    // tab: "open"（公開中→から）/"ended"（実績→から）/未指定は"all"。イベントオブジェクト混入ガード付き
    setPastJobsOpen(true); setPastJobs(null); setPastJobsTab(typeof tab === "string" ? tab : "all");
    setPastJobsFocus(null); setPastJobsCounts({});
    try {
      const { data } = await supabase.rpc("employer_public_jobs", { p_job_number: selectedJob.id });
      // 今見ている求人も含めて全公開求人を出す（2026-07-16）。審査中(pending)・下書きは
      // 運営承認ゲート（憲法5条）前のため含めない——承認されれば自動でここに並ぶ
      setPastJobs(data || []);
    } catch { setPastJobs([]); }
    // 求人ごとの応募・承認・採用人数（展開概要用・失敗しても「ー」表示になるだけ）
    try {
      const { data: cnts } = await supabase.rpc("employer_public_job_counts", { p_job_number: selectedJob.id });
      if (cnts) setPastJobsCounts(cnts);
    } catch {}
  };
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTargetField, setReportTargetField] = useState("");
  const [reportIssueType, setReportIssueType] = useState("");
  const [reportDetail, setReportDetail] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const REPORT_TARGET_FIELDS = ["報酬","勤務時間・休憩","危険情報","作業の説明","写真","場所・日程","その他"];
  const REPORT_ISSUE_TYPES = ["虚偽・誇大の疑い","最低賃金違反","差別的条件","連絡先の直書き・外部誘導","危険情報の欠落","個人情報・肖像権","不快・不適切な表現","その他"];
  const closeReportModal = () => { setShowReportModal(false); setReportTargetField(""); setReportIssueType(""); setReportDetail(""); };
  const submitReport = async () => {
    if (reportSending || !reportTargetField || !reportIssueType || !selectedJob || !me) return;
    setReportSending(true);
    const { error } = await supabase.from('job_reports').insert({
      job_number: selectedJob.id,
      reporter_id: me.id,
      target_field: reportTargetField,
      issue_type: reportIssueType,
      detail: reportDetail.trim() || null,
    });
    setReportSending(false);
    if (error) { alert("報告の送信に失敗しました：" + error.message); return; }
    setReportDone(true);
    setTimeout(() => { setReportDone(false); closeReportModal(); }, 1500);
  };
  useEffect(() => {
    // 訪問者モード（2026-07-24）：jobs_publicはanon許可so未ログインでも公開面を読める
    (async () => {
      try {
        const { data, error } = await supabase.from("jobs_public").select("*").order("job_number",{ascending:false});
        if (!error && data) {
          const mapped = data.map(mapJobPublicRow);
          // 並び順（2026-07-24たきと指示）：一覧・その他の求人はランダム。新着（掲載3日以内）は
          // この端末で「初めて見る時だけ」上位に配置（cb_seenNewJobsに既読記録＝二度目からは通常のランダム枠）。
          // シャッフルは読み込み時に1回＝表示中に並びが飛ばない
          const shuffleArr = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
          let seen = []; try { seen = JSON.parse(localStorage.getItem("cb_seenNewJobs") || "[]"); } catch {}
          const seenSet = new Set(seen);
          const freshNew = mapped.filter(j => j.isNew && !seenSet.has(j.id));
          const rest = mapped.filter(j => !(j.isNew && !seenSet.has(j.id)));
          { const _list = [...shuffleArr(freshNew), ...shuffleArr(rest)]; setDbJobs(_list); setCache("search:jobs", _list); }
          if (freshNew.length) { try { localStorage.setItem("cb_seenNewJobs", JSON.stringify([...seen, ...freshNew.map(j => j.id)].slice(-300))); } catch {} }
        }
      } catch {}
    })();
  }, [me]);
  const jobList = dbJobs || [];
  // ── Airbnb風検索（2026-07-27たきと指示・骨格②の段階解禁を運営判断で前倒し）：
  // 上部ピルバー→タップで全画面パネル。なにを（作物・作業）／どこで（地域）／いつ（月）の3セクションを
  // アコーディオンで選び「検索」で確定。チップは実在の求人から生成（ダミー禁止・憲法3条）。
  // 下書き（sel*）と確定（appliedSearch）を分離＝Airbnbと同じ「検索ボタンで初めて反映」動作
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSec, setSearchSec] = useState("what"); // 展開中セクション（1つだけ開くアコーディオン）
  // 絞り込みはlocalStorageに保存＝リロード・別ページ遷移でもリセットされない（2026-07-27たきと指示）。
  // 掛かりっぱなしでもピルの要約＋✕クリアで状態は常に見える
  const readStoredSearch = (key) => {
    try { const v = (JSON.parse(localStorage.getItem("cb_searchFilters") || "null") || {})[key]; return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const [selWhats, setSelWhats] = useState(() => readStoredSearch("w"));
  const [selRegions, setSelRegions] = useState(() => readStoredSearch("r"));
  const [selMonths, setSelMonths] = useState(() => readStoredSearch("m"));
  useEffect(() => {
    try { localStorage.setItem("cb_searchFilters", JSON.stringify({ w: selWhats, r: selRegions, m: selMonths })); } catch { /* 保存不可でも絞り込み自体は動く */ }
  }, [selWhats, selRegions, selMonths]);
  // リアルタイム反映（2026-07-27たきと指示）：チップを触った瞬間に一覧へ反映（検索ボタン待ちの下書き方式は廃止）。
  // パネルは半透明の暗幕so、背後で一覧が絞られていくのが見える
  const searchActive = selWhats.length > 0 || selRegions.length > 0 || selMonths.length > 0;
  const jobMonths = (j) => { // 求人の日程が跨る月（1〜12）の一覧
    // ★dateStart/dateEndはDateオブジェクト（mapJobPublicRow）。文字列連結するとInvalid Dateになるため
    //   "YYYY-MM-DD"文字列のdateStartRaw/dateEndRawを使う（2026-07-27修正：いつする？が常に空だったバグ）
    const s = j.dateStartRaw, e = j.dateEndRaw || j.dateStartRaw;
    if (!s) return [];
    const out = [];
    const end = new Date(e + "T00:00:00");
    const d = new Date(s + "T00:00:00"); d.setDate(1);
    if (isNaN(d.getTime()) || isNaN(end.getTime())) return [];
    while (d <= end && out.length < 12) { out.push(d.getMonth() + 1); d.setMonth(d.getMonth() + 1); }
    return out;
  };
  const filteredList = !searchActive ? jobList : jobList.filter(j => {
    if (selWhats.length && !selWhats.some(w => j.crop === w || j.task === w)) return false;
    if (selRegions.length && !selRegions.includes(j.region || "")) return false;
    if (selMonths.length && !selMonths.some(m => jobMonths(j).includes(m))) return false;
    return true;
  });
  const searchWhatOpts = [...new Set(jobList.flatMap(j => [j.crop, j.task]).filter(Boolean))];
  const searchRegionOpts = [...new Set(jobList.map(j => j.region).filter(Boolean))];
  const searchMonthOpts = [...new Set(jobList.flatMap(jobMonths))].sort((a, b) => a - b);
  const searchSummary = [selWhats.join("・"), selRegions.join("・"), selMonths.map(m => m + "月").join("・")].filter(Boolean).join("｜");
  const togSel = (setter) => (v) => setter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const clearSearch = () => { setSelWhats([]); setSelRegions([]); setSelMonths([]); };

  // ── いいね（お気に入り）：saved_jobs（本人のみRLS）。job_number(=job.id)をキーに管理 ──
  const [savedIds, setSavedIds] = useState(new Set());
  const [likeDone, setLikeDone] = useState(null); // 初いいねボックス（2026-07-19）：各求人の最初のいいねで1回だけ展開（localStorage cb_likeBoxShown）
  // きっかけアンケート（初回いいね時・2026-07-24）：未回答ユーザーの最初のいいね前に1度だけ聞く
  const [surveyAnswered, setSurveyAnswered] = useState(null); // null=未取得 / true / false
  const [surveyJob, setSurveyJob] = useState(null); // アンケート表示中に保留するいいね対象
  const [surveySource, setSurveySource] = useState("");
  const [surveySourceOther, setSurveySourceOther] = useState("");
  const [surveyReasons, setSurveyReasons] = useState([]);
  const [surveyReasonOther, setSurveyReasonOther] = useState("");
  const [surveySaving, setSurveySaving] = useState(false);
  useEffect(() => {
    if (!me) { setSurveyAnswered(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("user_onboarding_survey").select("auth_id").eq("auth_id", me.id).maybeSingle();
        if (!cancelled) setSurveyAnswered(!!data);
      } catch { if (!cancelled) setSurveyAnswered(true); } // 取得失敗時はゲートしない（コア動作＝いいねを止めない）
    })();
    return () => { cancelled = true; };
  }, [me]);
  useEffect(() => {
    if (!me) { setSavedIds(new Set()); return; }
    (async () => {
      try {
        const { data } = await supabase.from("saved_jobs").select("job_number").eq("worker_id", me.id);
        setSavedIds(new Set((data || []).map(r => r.job_number)));
      } catch {}
    })();
  }, [me]);
  // 実いいね処理（アンケートゲート通過後・解除時に呼ぶ）
  const performSave = async (job) => {
    const isSaved = savedIds.has(job.id);
    setSavedIds(prev => { const next = new Set(prev); isSaved ? next.delete(job.id) : next.add(job.id); return next; });
    const { error } = isSaved
      ? await supabase.from("saved_jobs").delete().eq("worker_id", me.id).eq("job_number", job.id)
      : await supabase.from("saved_jobs").insert({ worker_id: me.id, job_number: job.id });
    if (error) { setSavedIds(prev => { const next = new Set(prev); isSaved ? next.add(job.id) : next.delete(job.id); return next; }); return; }
    // 各求人の初いいねだけボックス展開（求人ごとに1回・解除→再いいねでは出さない）
    if (!isSaved) {
      try {
        const shown = JSON.parse(localStorage.getItem("cb_likeBoxShown") || "[]");
        if (!shown.includes(job.id)) {
          localStorage.setItem("cb_likeBoxShown", JSON.stringify([...shown, job.id]));
          setLikeDone(job);
        }
      } catch { setLikeDone(job); }
    }
  };
  const toggleSurveyReason = (v) => setSurveyReasons(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const submitSurvey = async () => {
    if (surveySaving || !me) return;
    if (!surveySource) { alert("Q1をひとつ選んでください"); return; }
    setSurveySaving(true);
    try {
      const { error } = await supabase.from("user_onboarding_survey").insert({
        auth_id: me.id,
        source: surveySource,
        source_other: surveySource === "その他" ? (surveySourceOther.trim() || null) : null,
        reasons: surveyReasons,
        reason_other: surveyReasons.includes("その他") ? (surveyReasonOther.trim() || null) : null,
      });
      if (error && error.code !== "23505") { alert("送信に失敗しました：" + error.message); setSurveySaving(false); return; }
      setSurveyAnswered(true);
      const job = surveyJob;
      setSurveyJob(null); setSurveySaving(false);
      if (job) performSave(job); // ★元のいいねを自動で完了させる
    } catch (e) { alert("送信に失敗しました"); setSurveySaving(false); }
  };
  // #/work/job/{番号} と、タブ指定つきの #/work/job/{番号}/questions（2026-07-27たきと指示）。
  // 農家の求人カードの❓バッジ（未回答の質問）から、その求人の質問タブへ直接入るための入口
  const JOB_HASH_RE = /^work\/job\/(\d+)(?:\/(content|questions|insurance))?$/;
  useEffect(() => {
    const m = window.location.hash.replace(/^#\/?/,"").match(JOB_HASH_RE);
    if (!m) return;
    const jn = parseInt(m[1],10);
    const found = jobList.find(j => j.id === jn);
    if (found) { setSelectedJob(found); setDetailTab(m[2] || "content"); clearApplyReturn(); return; }
    if (dbJobs && dbJobs.length > 0) clearApplyReturn();
  }, [dbJobs]);
  useEffect(() => {
    const onHash = () => {
      const m = window.location.hash.replace(/^#\/?/,"").match(JOB_HASH_RE);
      if (!m) { setSelectedJob(null); setBackTo(null); try { sessionStorage.removeItem("cb_jobBackTo"); } catch {} return; }
      const jn = parseInt(m[1],10);
      const found = jobList.find(j => j.id === jn);
      if (found) { setSelectedJob(found); setDetailTab(m[2] || "content"); }
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, [jobList]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [reviewSort, setReviewSort] = useState("new");
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [showApplyBar, setShowApplyBar] = useState(false);
  const applyPanelRef = useRef(null);
  const openJob = job => { setSelectedJob(job); setActiveSlide(0); setReviewSort("new"); setShowAllReviews(false); setDetailTab("content"); try{ window.history.pushState(null,"","#/work/job/"+job.id); }catch{} };

  const openPastJob = (row) => {
    // いま見ている求人をタップ＝ボックスを閉じて、ページの先頭までゆっくり戻る（2026-07-27たきと指示）。
    // 一瞬で飛ばすと「どこへ戻ったか」が分からないため、スクロールしている過程を見せることが大事。
    // 閉じてから1フレーム置いて動かす（ボックスが消える前だと画面が固定されていて動かないことがある）
    if (row.job_number === selectedJob.id) {
      setPastJobsOpen(false); setFarmIntroOpen(false);
      setTimeout(() => {
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
      }, 60);
      return;
    }
    const job = mapJobPublicRow(row);
    setJobBackStack(prev => [...prev, selectedJob]);
    setPastJobsOpen(false); setFarmIntroOpen(false);
    openJob(job);
    try { window.scrollTo(0, 0); } catch {}
  };
  // 出どころは開いた時点で引き取る（タブ指定はURL #/work/job/{番号}/questions が担うのでフラグは持たない）
  useEffect(() => {
    if (!selectedJob) return;
    try {
      const b = sessionStorage.getItem("cb_jobBackTo");
      if (b) { sessionStorage.removeItem("cb_jobBackTo"); setBackTo(b); }
    } catch {}
  }, [selectedJob]);
  const [empEmployer, setEmpEmployer] = useState(null);
  const [empTrust, setEmpTrust] = useState(null);
  useEffect(() => {
    if (!selectedJob) { setEmpEmployer(null); setEmpTrust(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.rpc('job_employer_profile', { p_job_number: selectedJob.id });
        if (!cancelled) setEmpEmployer((data && data[0]) || null);
      } catch { if (!cancelled) setEmpEmployer(null); }
      try {
        const { data: trust } = await supabase.rpc('job_employer_trust_info', { p_job_number: selectedJob.id });
        if (!cancelled) setEmpTrust(trust || null);
      } catch { if (!cancelled) setEmpTrust(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.id]);
  const [myApplication, setMyApplication] = useState(null);
  // 自分の応募を取得できたかどうか（2026-07-27・「満員」が一瞬映る修理）。
  // 未取得の間にhideApplyを確定させると、応募済みの人にも一瞬「満員」が出てから本来の表示に戻る
  const [myAppLoaded, setMyAppLoaded] = useState(false);
  // 仮応募中（第15弾・2026-07-30）：意思は預かったがプロフィールがまだ＝応募ボタンを仕上げ導線に変える
  const [myPending, setMyPending] = useState(false);
  useEffect(() => {
    if (!selectedJob || !me) { setMyApplication(null); setMyAppLoaded(!me); return; } // 未ログインは判定不要＝確定扱い
    let cancelled = false;
    setMyAppLoaded(false);
    (async () => {
      try {
        // 仮応募（第15弾）も一緒に見る。RLS「pending own」で自分の行しか返らない
        const [appRes, pendRes] = await Promise.all([
          supabase.from('applications').select('id,status,started_at').eq('job_number', selectedJob.id).maybeSingle(),
          supabase.from('pending_applications').select('id').eq('job_number', selectedJob.id).maybeSingle().then(r => r, () => ({ data: null })),
        ]);
        if (!cancelled) { setMyApplication(appRes.data || null); setMyPending(!!pendRes.data); }
      } catch { if (!cancelled) { setMyApplication(null); setMyPending(false); } }
      if (!cancelled) setMyAppLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.id, me]);

  // 集合場所の詳細ページ表示は削除（2026-07-16）。承認後の共有はチャットの「はじめる前の確認」カード（job_meeting_place RPC）に一本化

  // 開始打刻（①）：承認済み以降・作業日当日のみ
  const [punching, setPunching] = useState(false);
  const punchStart = async () => {
    if (punching || !myApplication) return;
    setPunching(true);
    try {
      const { data, error } = await supabase.rpc('punch_start', { p_application_id: myApplication.id });
      if (!error && data && data.ok) {
        setMyApplication(prev => prev ? { ...prev, started_at: data.started_at, status: data.already ? prev.status : 'working' } : prev);
      } else if (data && !data.ok) {
        alert('開始できませんでした：' + (data.reason || '不明'));
      }
    } catch { alert('開始の記録に失敗しました。'); }
    setPunching(false);
  };
  const [applying, setApplying] = useState(false);
  // プロフィールゲートのモーダル状態。null=非表示 / {mode:"soft"}=クライアント側の空チェック（両方選べる）
  // / {mode:"hard", hasNickname, qaAnswered, qaRequired}=サーバー側の必須ゲート（プロフィールを書く、のみ）
  const [profileGate, setProfileGate] = useState(null);

  const applyAvailRef = useRef(null);

  // apply_to_job本体（プロフィールゲート通過後、または「このまま応募する」選択後に呼ぶ）
  const doApply = async () => {
    setApplying(true);
    try {
      const { data, error } = await supabase.rpc("apply_to_job", { p_job_number: selectedJob.id, p_available_dates: applyAvailRef.current });
      setApplying(false);
      if (error) { alert("応募に失敗しました。時間をおいて再度お試しください。"); return; }
      if (data && data.reason === "dates_required") { alert("この求人は期間募集です。来られる日（または「期間中いつでもOK」）を選んでから応募してください。"); return; }
      if (data && data.ok) {
        try { if (data.already) sessionStorage.setItem("cb_applyAlready","1"); else sessionStorage.removeItem("cb_applyAlready"); } catch {}
        window.location.hash = "/apply/done";
      }
      else if (data && data.reason === "not_logged_in") { setApplyReturn(selectedJob.id); if (onRegister) onRegister(); }
      else if (data && data.reason === "own_job") { alert("自分の求人には応募できません。"); }
      else if (data && data.reason === "job_not_open") { alert("この求人は現在募集を受け付けていません。"); }
      else if (data && data.reason === "profile_incomplete") {
        setProfileGate({ mode:"hard", hasNickname: !!data.has_nickname, qaAnswered: data.qa_answered ?? 0, qaRequired: data.qa_required ?? 5 });
      }
      else if (data && data.reason === "profile_under_review") {
        alert(data.revision
          ? "自己紹介に運営から修正のお願いが届いています。プロフィールを修正して保存すると、審査のうえ応募できるようになります。"
          : "自己紹介が運営の審査待ちのため、いまは応募できません。公開までお待ちください（最大2日）。");
      }
      else { alert("応募できませんでした。"); }
    } catch { setApplying(false); alert("応募に失敗しました。"); }
  };

  const handleApply = async () => {
    if (applying || !selectedJob) return;
    setApplying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setApplying(false);
        setApplyReturn(selectedJob.id);
        if (onRegister) onRegister();
        return;
      }
      // ①(account_holders)未登録なら重い登録へ。戻り先を退避。
      const { data: ah } = await supabase.from('account_holders')
        .select('id').eq('auth_id', session.user.id).maybeSingle();
      if (!ah) {
        setApplying(false);
        setApplyReturn(selectedJob.id);
        window.location.hash = "/account";
        return;
      }
      // 仮応募（第15弾・2026-07-30たきと指示）：必須項目がそろっていない人は、応募の意思だけ先に預かる。
      // 判定の基準は is_worker_profile_ready（DB）1本＝画面ごとに別の必須セットを作らない。
      // 昇格の引き金は本人のプロフィール完成だけ（運営の自由記述審査は間に立たない）
      const ready = await fetchWorkerReady();
      if (!ready.ready) {
        const { data: pend } = await supabase.rpc("create_pending_application", { p_job: selectedJob.id });
        setApplying(false);
        if (pend && pend.ok) { window.location.hash = "/apply/pending"; return; }
        if (pend && pend.reason === "already_applied") { window.location.hash = "/apply/done"; return; }
        // 預かりに失敗した時は、従来どおり本応募を試して理由をサーバーに言わせる
        await doApply();
        return;
      }
      await doApply();
    } catch { setApplying(false); alert("応募に失敗しました。"); }
  };

  // 応募の取消（承認前のみ・本人）
  const cancelMyApplication = async () => {
    if (applying || !myApplication) return;
    if (!window.confirm("この応募を取り消しますか？農家にお知らせが届きます")) return;
    setApplying(true);
    try {
      const { data, error } = await supabase.rpc("cancel_application", { p_application_id: myApplication.id });
      setApplying(false);
      if (!error && data && data.ok) setMyApplication(null);
      else alert("取り消しに失敗しました：" + (data?.reason || error?.message || "不明"));
    } catch { setApplying(false); alert("取り消しに失敗しました。"); }
  };

  // PC専用の下固定応募バー：応募パネル(sticky)が画面より上に通過したら表示（758px以下はCSSで非表示）
  useEffect(() => {
    const el = applyPanelRef.current;
    if (!el) { setShowApplyBar(false); return; }
    const observer = new IntersectionObserver(([entry]) => {
      setShowApplyBar(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectedJob]);

  // トップ写真のループ（2026-07-16）：両端にクローンを置き、端に着地した瞬間に本物へ瞬間ジャンプ。
  // 1枚目で左へ→最後の写真／最後の写真で右へ→1枚目
  const photoScrollerRef = useRef(null);
  const photoCount = selectedJob?.photos?.length || 0;
  const photosLooped = photoCount > 1;
  const handlePhotoScroll = e => {
    const el = e.target;
    const w = el.clientWidth;
    if (!w) return;
    const idx = Math.round(el.scrollLeft / w);
    if (!photosLooped) { setActiveSlide(idx); return; }
    const settled = Math.abs(el.scrollLeft - idx * w) < 2;
    if (settled && idx === 0) { el.scrollLeft = photoCount * w; setActiveSlide(photoCount - 1); return; }
    if (settled && idx === photoCount + 1) { el.scrollLeft = w; setActiveSlide(0); return; }
    setActiveSlide(((idx - 1) % photoCount + photoCount) % photoCount);
  };
  useEffect(() => {
    if (!photosLooped) return;
    const el = photoScrollerRef.current;
    if (el) requestAnimationFrame(() => { el.scrollLeft = el.clientWidth; });
    setActiveSlide(0);
  }, [selectedJob?.id, photosLooped]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxPay = selectedJob ? calcMaxPay(selectedJob) : null;
  const myAppStatus = myApplication?.status;
  // 自分の応募が分かるまでは押させない（2026-07-27）：締切求人で一瞬「満員」が出る問題の裏返しで、
  // 逆に締切なのに「応募」を押せてしまう窓も塞ぐ。ラベルは状態を偽らない「確認中…」
  const appPending = !!(me && !myAppLoaded);
  const applyBtnDisabled = myAppStatus === "rejected" || appPending;
  const applyBtnLabel = appPending ? "確認中…"
    : applying ? (myAppStatus === "applied" ? "取り消し中..." : "送信中...")
    : myAppStatus === "approved" ? "承認されました — チャットを開く"
    : myAppStatus === "rejected" ? "今回は見送りとなりました"
    : myAppStatus === "applied" ? "応募済み — 取り消す"
    // 仮応募中（第15弾）：意思は預かり済み。次の一手はプロフィールの仕上げ
    : (!myAppStatus && myPending) ? "仮応募中 → プロフィールを仕上げる"
    : "応募";
  const applyBtnStyle = myAppStatus === "rejected" ? { background:"#EBEBEB", color:"#717171" }
    : myAppStatus === "applied" ? { background:"#F7F7F7", color:"#717171", border:"1px solid #EBEBEB" }
    : (!myAppStatus && myPending) ? { background:"#C77700" }
    : {};
  // 2026-07-13 労働局確認済み・当事者間の直接連絡は適法（CLAUDE.md参照）
  // 応募確認ボックス（2026-07-18）：新規応募はボタン直送信でなく、内容確認のボックスを展開してから
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  // 応募時の来られる日宣言（2026-07-24）：期間求人（date_end有り・単日でない）だけ、応募シートで日程を選ぶ。
  // applyAvailRefに最終値（"any"／日付配列／null）を同期的に入れてからhandleApply＝ゲート往復でも保持できる
  const [applyDates, setApplyDates] = useState([]); // 選択中の特定日（"YYYY-MM-DD"）
  useEffect(() => { setApplyConfirmOpen(false); setApplyDates([]); applyAvailRef.current = null; }, [selectedJob?.id]);
  const isPeriodJob = !!(selectedJob && selectedJob.dateEndRaw && selectedJob.dateEndRaw !== selectedJob.dateStartRaw);
  // 期間内の日付を "YYYY-MM-DD" 配列で列挙（開始〜終了・両端含む）
  const periodDays = (() => {
    if (!isPeriodJob) return [];
    const out = []; const [ys, ms, ds] = selectedJob.dateStartRaw.split("-").map(Number);
    const start = new Date(ys, ms - 1, ds); const end = new Date(selectedJob.dateEndRaw + "T00:00:00");
    let guard = 0;
    for (let d = new Date(start); d <= end && guard < 400; d.setDate(d.getDate() + 1), guard++) out.push(ymdLocal(d));
    return out;
  })();
  const [signupOpen, setSignupOpen] = useState(false); // 未ログイン画面の文言用（app_settings.signup_open・既定false=招待制）
  useEffect(() => { supabase.rpc("signup_open").then(({ data }) => { if (data === true) setSignupOpen(true); }).catch(()=>{}); }, []);
  // 訪問者（未ログイン）が応募・いいね・投稿等をタップした時の案内（2026-07-24・隠さず案内する）
  // 「閉じる」で普通に閉じる（2026-07-27たきと指示）：以前は閉じた直後に#/loginへ飛ばしていたため、
  // 案内を読んだだけで見ていた求人から引き剥がされていた。案内だけ出して画面はそのまま残す。
  // 文面も「登録画面へ進みます」を撤回（進まないso）。応募・いいね両方の入口から呼ばれるsо共通の言い回しにする
  const visitorGuide = () => {
    // ログインのボックスをその場に展開（2026-07-27たきと指示）。alertは画面を止めるだけで先に進めず、
    // 見ていた求人からログイン画面へ飛ばすと文脈が切れるため、同じ画面の上に重ねる
    if (signupOpen) { openLoginBox(); return; }
    alert("現在は招待制です。招待を受けた方は招待メールのアドレスでログインしてください。");
  };

  const toggleSave = async (job) => {
    if (!me) { visitorGuide(); return; }
    if (!canLike(job)) return; // 自分が出した求人（DB側もトリガーで拒否する）
    const isSaved = savedIds.has(job.id);
    // 未回答ユーザーの「最初のいいね」の前にきっかけアンケート（追加時のみ・解除時は出さない・2026-07-24）
    if (!isSaved && surveyAnswered === false) { setSurveyJob(job); return; }
    performSave(job);
  };
  // 未ログイン（訪問者）が応募を押したら、戻り先にこの求人を記録してからログイン導線を開く（2026-07-31）。
  // これが無いと、登録→新規登録①（AccountHolderForm）完了後に #/search へ落ち、見ていた求人を見失う
  // （県大会のQRから来た人の一気通貫を守る）。applyReturn は login-box成功(App:1974)・
  // AccountHolderForm.onDone(App:2239)・afterLoginGo(App:1181) の三箇所が読んで /work/job/{n} へ戻す。
  const applyBtnOnClick = !me ? (() => { if (selectedJob) setApplyReturn(selectedJob.id); visitorGuide(); })
    : myAppStatus === "approved" ? (() => { window.location.hash = "/chat/" + myApplication.id; })
    : myAppStatus === "applied" ? cancelMyApplication
    : (!myAppStatus && myPending) ? (() => { window.location.hash = "/apply/pending"; })
    : (() => setApplyConfirmOpen(true));
  // 募集終了（2026-07-24）：設定した採用人数に達した（満員＝filled）／作業日程が過ぎた（expired）求人は
  // 応募導線（下部フッター・応募ボタン）を出さない＝新規の募集を締め切る。
  // ただし既に応募・承認・見送りの関係がある本人には、状況確認とチャット導線を残すため従来どおり表示する。
  const recruitClosed = !!(selectedJob && (selectedJob.filled || selectedJob.expired));
  // ★自分の応募が分かるまでは締切扱いにしない（2026-07-27たきと報告「一瞬だけ満員が映る」）。
  //   未取得の間はmyAppStatusがundefinedso、応募済みの人にも一度「満員」を出してから戻っていた
  const hideApply = recruitClosed && myAppLoaded && !myAppStatus;
  const closedLabel = selectedJob?.filled ? "この募集は終了しました（満員）" : "この募集は終了しました（期間終了）";
  // 下部フッターは幅が狭いso短い言葉に差し替える（2026-07-27たきと指示）。
  // 「応募する」の位置＝そのままボタンの場所に「満員」（期間終了なら「募集終了」）を出す
  const closedLabelShort = selectedJob?.filled ? "満員" : "募集終了";

  return (
    <div>
      {!selectedJob && (<>
      {/* 見出し「近くの仕事を探す」は削除（2026-07-27たきと指示）。現在地は下部ナビの点灯が示すため冗長。
          支払いの注記は求人一覧の一番下へ移植（下記） */}

      {/* ── Airbnb風検索バー（2026-07-27）：下部バー直上の浮遊ピル（上は遠い・たきと指示）。
           スクロールで他のFABと同じくcb-scroll-hideで格納。適用中は条件の要約＋✕クリア ── */}
      <button onClick={()=>{ setSearchOpen(true); setSearchSec("what"); }} className="cb-search-fab f-sans" style={{ display:"flex", alignItems:"center", gap:10, background:"#fff", border:"1px solid #DDD", borderRadius:32, padding:"11px 18px", boxShadow:"0 4px 16px rgba(0,0,0,0.18)", cursor:"pointer", textAlign:"left", boxSizing:"border-box" }}>
        <span style={{ fontSize:17, flexShrink:0 }}>🔍</span>
        <span style={{ minWidth:0, flex:1 }}>
          <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {searchActive ? searchSummary : "仕事をさがす"}
          </span>
          <span style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>
            {searchActive ? `${filteredList.length}件の仕事` : "作物・地域・時期でしぼり込み"}
          </span>
        </span>
        {searchActive && (
          <span role="button" aria-label="条件をクリア" onClick={(e)=>{ e.stopPropagation(); clearSearch(); }} style={{ flexShrink:0, width:28, height:28, borderRadius:"50%", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"#555" }}>✕</span>
        )}
      </button>

      {/* ── 検索パネル（Airbnb風）：半透明の暗幕で背景の一覧が薄く見える。チップはタップの瞬間に一覧へ
           リアルタイム反映（2026-07-27たきと指示）。暗幕タップ・✕・「N件を表示」いずれでも閉じる ── */}
      {searchOpen && (
        <div className="fade-in" onClick={()=>setSearchOpen(false)} style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(255,255,255,0.35)", backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)", overflowY:"auto", WebkitOverflowScrolling:"touch", display:"flex" }}>{/* モザイク（すりガラス）処理（2026-07-27たきと指示）：暗幕では背景が見えすぎたためblurに。輪郭と件数の増減は伝わるが文字は読めない */}
          {/* margin:auto＝縦横中央（2026-07-27たきと指示）。中身が画面より高い時はflex+autoマージンで正しくスクロールできる */}
          <div onClick={e=>e.stopPropagation()} style={{ width:"100%", maxWidth:520, margin:"auto", padding:"calc(env(safe-area-inset-top, 0px) + 12px) 16px 24px", boxSizing:"border-box" }}>
          {/* ✕閉じるボタンは削除（2026-07-27たきと指示）：モザイク部分のタップで閉じられるため不要 */}
          <div style={{ display:"grid", gap:12, alignContent:"start" }}>
            {[
              { k:"what",   q:"なにを", title:"なにをする？", opts: searchWhatOpts,   sel: selWhats,   tog: togSel(setSelWhats),   label: v => v },
              { k:"region", q:"どこで", title:"どこでする？", opts: searchRegionOpts, sel: selRegions, tog: togSel(setSelRegions), label: v => "📍 " + v },
              { k:"month",  q:"いつ",   title:"いつする？",   opts: searchMonthOpts,  sel: selMonths,  tog: togSel(setSelMonths),  label: v => v + "月" },
            ].map(sec => searchSec === sec.k ? (
              <div key={sec.k} style={{ background:"#fff", borderRadius:20, boxShadow:"0 2px 10px rgba(0,0,0,0.07)", padding:"18px 18px 20px" }}>
                <p className="f-sans" style={{ fontSize:19, fontWeight:800, color:"#222", margin:"0 0 14px" }}>{sec.title}</p>
                {sec.opts.length === 0 ? (
                  <p className="f-sans" style={{ fontSize:12, color:"#999", margin:0 }}>選べる条件がありません</p>
                ) : (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {sec.opts.map(v => { const on = sec.sel.includes(v); return (
                      <button key={v} onClick={()=>sec.tog(v)} className="f-sans" style={{ padding:"9px 16px", borderRadius:24, fontSize:13, fontWeight:700, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{sec.label(v)}</button>
                    ); })}
                  </div>
                )}
              </div>
            ) : (
              <button key={sec.k} onClick={()=>setSearchSec(sec.k)} className="f-sans" style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, background:"#fff", border:"none", borderRadius:16, padding:"16px 18px", cursor:"pointer", boxShadow:"0 1px 6px rgba(0,0,0,0.06)" }}>
                <span style={{ fontSize:13, fontWeight:600, color:"#717171", flexShrink:0 }}>{sec.q}</span>
                <span style={{ fontSize:13, fontWeight:700, color:"#222", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sec.sel.length ? sec.sel.map(sec.label).join("・") : "指定なし"}</span>
              </button>
            ))}
          </div>
          {/* 下部バー：クリア／「N件を表示」（件数はチップ操作に合わせてリアルタイム更新） */}
          <div style={{ background:"#fff", borderRadius:16, marginTop:12, padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", boxShadow:"0 2px 10px rgba(0,0,0,0.15)" }}>
            <button onClick={clearSearch} className="f-sans" style={{ background:"none", border:"none", fontSize:14, fontWeight:700, color:"#222", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>すべてクリア</button>
            <button onClick={()=>setSearchOpen(false)} className="f-sans" style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:12, padding:"12px 26px", fontSize:15, fontWeight:800, cursor:"pointer" }}>{filteredList.length}件を表示</button>
          </div>
          </div>
        </div>
      )}

      {/* 仕事リスト（検索適用中はfilteredList） */}
      <div className="job-search-layout">
        <div ref={skelRef}>
          {/* 読み込み中（dbJobs未取得）は「ありません」でなく仮の箱を並べる（2026-07-27たきと指示）。
              空だと確定してから初めて空状態を出す＝一瞬「求人ゼロ」に見える誤解を防ぐ */}
          {dbJobs === null && <AutoSkeleton shapeKey="search" />}
          {dbJobs !== null && jobList.length === 0 && (
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"64px 20px", color:"#999" }} className="f-sans">
              <div style={{ fontSize:40, marginBottom:12 }}>🌾</div>
              <p style={{ fontSize:16, margin:0, lineHeight:1.6 }}>現在、募集中の求人はありません</p>
            </div>
          )}
          {jobList.length > 0 && filteredList.length === 0 && (
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"64px 20px", color:"#999" }} className="f-sans">
              <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
              <p style={{ fontSize:16, margin:"0 0 16px", lineHeight:1.6 }}>条件に合う求人が見つかりませんでした</p>
              <button onClick={clearSearch} className="f-sans" style={{ padding:"10px 22px", fontSize:13, fontWeight:700, background:"#fff", border:"1px solid #DDD", borderRadius:20, color:"#00A86B", cursor:"pointer" }}>条件をクリア</button>
            </div>
          )}
          {filteredList.map(job => (
            <JobCard key={job.id} job={job} variant="list" saved={savedIds.has(job.id)} onToggleSave={canLike(job) ? toggleSave : undefined} />
          ))}
        </div>
      </div>
      {/* 支払いの注記（2026-07-27たきと指示で最上部から求人一覧の一番下へ移植） */}
      <div style={{ padding:"7px 12px", background:"#F7F7F7", borderRadius:8, marginTop:12 }}>
        <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>
          お支払いは、作業当日の現金手渡しが原則です。
        </p>
      </div>
      </>)}

      {/* ── 詳細ページ ── */}
      {selectedJob && (<>
        {/* .appear(transform保持)の外に置く＝fixedの基準を画面に保つ（2026-07-16スクロール追従修理） */}
          {/* ←戻る／♡いいね：同じ高さの浮遊固定ボックス（スクロール追従・2026-07-16） */}
        {/* カレンダー（今日ページ）から来た時は戻るボックスを出さない（2026-07-27たきと指示）：
            下部ナビのカレンダータブが戻り道so浮遊ボックスは重複。他の出どころ（チャット・応募状況・一覧）では従来どおり出す */}
        {backTo !== "/calendar" && (
        <button onClick={() => {
          // 過去の求人から来た場合は前の求人詳細へ戻る（2026-07-16）
          if (jobBackStack.length > 0) {
            const prev = jobBackStack[jobBackStack.length - 1];
            setJobBackStack(st => st.slice(0, -1));
            setSelectedJob(prev); setDetailTab("content");
            try { window.history.pushState(null, "", "#/work/job/" + prev.id); } catch {}
            try { window.scrollTo(0, 0); } catch {}
            return;
          }
          // チャット等の出どころから来た場合はそこへ戻る（2026-07-16）
          if (backTo) { setSelectedJob(null); setBackTo(null); window.location.hash = backTo; return; }
          setSelectedJob(null); try{ window.history.pushState(null,"","#/search"); }catch{}
        }} className="f-sans job-float-back" style={{
          display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
          fontSize:13, fontWeight:600, color:"#717171", cursor:"pointer", padding:"8px 14px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>{jobBackStack.length > 0 ? "← 前の求人に戻る"
          // 出どころで戻り先の名前を変える。農家の求人ボックス（❓バッジ経由）も対象（2026-07-27）
          : (backTo && backTo.startsWith("/profile/employer")) ? "← 求人に戻る" : "← 一覧に戻る"}</button>
        )}
        {/* 自分が出した求人にはいいねを出さない（2026-07-29たきと指示） */}
        {!isOwnJob && canLike(selectedJob) && (
        <button onClick={() => toggleSave(selectedJob)} aria-label={savedIds.has(selectedJob.id) ? "いいねを解除" : "いいね"} className="f-sans job-float-like" style={{
          display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
          fontSize:13, fontWeight:600, color: savedIds.has(selectedJob.id) ? "#E24B4A" : "#717171", cursor:"pointer", padding:"8px 14px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>{savedIds.has(selectedJob.id) ? "♥ いいね済み" : "♡ いいね"}</button>
        )}
        <div className="appear job-detail-body-mobile">
          {/* 通報リンク（いいねの上=ページ先頭右） */}
          {me && (
            <div className="job-detail-back-btn" style={{ textAlign:"right", marginBottom:8 }}>
              <button onClick={()=>setShowReportModal(true)} className="f-sans" style={{
                background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                fontSize:11, color:"#717171", textDecoration:"underline", padding:"2px 4px",
              }}>⚑ この求人を報告する</button>
            </div>
          )}

          {/* 写真ギャラリー（最大10枚）。1枚も無い求人は求人者のアイコンを1枚だけ大きく出す（2026-07-30たきと指示） */}
          {(() => {
            const photos = Array.isArray(selectedJob.photos) ? selectedJob.photos : [];
            if (photos.length === 0) return (
              <div style={{ marginBottom:20 }}>
                <JobPhotoFallback url={empEmployer?.avatar_url} name={empEmployer?.nickname || "？"} />
              </div>
            );
            const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
            // ループ用クローン：[最後, ...本物, 最初]。初期位置とジャンプはhandlePhotoScroll側
            const slides = photosLooped ? [photos[photos.length - 1], ...photos, photos[0]] : photos;
            return (
              <>
                <Carousel
                  className="carousel-scroll"
                  style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory" }}
                  wrapperStyle={{ marginBottom:8 }}
                  onScroll={handlePhotoScroll}
                  scrollerRef={photoScrollerRef}
                >
                  {slides.map((photo, i) => {
                    const src = typeof photo === "string" ? photo : photo?.url;
                    const cap = typeof photo === "string" ? "" : photo?.caption;
                    return (
                      <div key={i} style={{
                        flexShrink:0, width:"100%", height:392, borderRadius:12,
                        background: bgColors[i % bgColors.length],
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:72,
                        scrollSnapAlign:"start", position:"relative", overflow:"hidden",
                      }}>
                        <img src={src} alt={cap || ""} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                        {cap && (
                          <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 20px 16px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:16, fontWeight:600, lineHeight:1.6, boxSizing:"border-box" }}>{cap}</div>
                        )}
                      </div>
                    );
                  })}
                </Carousel>
                <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:20 }}>
                  {photos.map((_, i) => (
                    <span key={i} style={{ fontSize:10, color: i===activeSlide ? "#00A86B" : "#D0D0D0" }}>{i===activeSlide ? "●" : "○"}</span>
                  ))}
                </div>
              </>
            );
          })()}

          {/* 仕事の内容 / 保険 / 質問 タブ（第10弾・2026-07-22）。中身は横スワイプでも切替（2026-07-27） */}
          <ContentQSwipeArea value={detailTab} onChange={setDetailTab} showInsurance={Array.isArray(empEmployer?.insurance_items) && empEmployer.insurance_items.length > 0}>
          <ContentQTabs value={detailTab} onChange={setDetailTab} showInsurance={Array.isArray(empEmployer?.insurance_items) && empEmployer.insurance_items.length > 0} />
          {detailTab === "questions" ? (
            <JobQuestions jobNumber={selectedJob.id} me={me} />
          ) : (detailTab === "insurance" && Array.isArray(empEmployer?.insurance_items) && empEmployer.insurance_items.length > 0) ? (
            <InsurancePanel employer={empEmployer} />
          ) : (<>
          {/* ヘッダー */}
          <div style={{ marginBottom:20 }}>
            <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>{selectedJob.crop} {selectedJob.task}{selectedJob.region ? `｜${selectedJob.region}` : ""}</h2>
            {/* はじめてOK・リピート即決＋待遇はタイトル下にも表示（2026-07-16・求人カードと同じバッジ） */}
            {(selectedJob.beginnerOk || selectedJob.experiencedPreferred || selectedJob.instantApproveRepeat || perkBadges(selectedJob.perks ? { ...(empEmployer || {}), ...selectedJob.perks } : empEmployer).length > 0) && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
                <JobFlagBadges beginner={selectedJob.beginnerOk} expert={selectedJob.experiencedPreferred} repeat={selectedJob.instantApproveRepeat} />
                {perkBadges(selectedJob.perks ? { ...(empEmployer || {}), ...selectedJob.perks } : empEmployer).map(b => (
                  <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{b}</span>
                ))}
              </div>
            )}
          </div>

          {/* 2カラム: 左=情報 / 右=応募パネル */}
          <div className="job-detail-2col">
            {/* 左カラム */}
            <div>
              {/* 主要情報 */}
              <div style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                <div className="job-detail-info-grid">
                  {[
                    // 日程は確認ページと同じ設計（2026-07-16）：「〜終了日」を下段に折り返し
                    { label:"日程",     value: (selectedJob.dateLabel || "").replace("〜", "\n〜") },
                    { label:"勤務時間", value: selectedJob.workTime },
                    { label:"休憩時間", value: selectedJob.breakTime },
                    { label:"採用人数", value: selectedJob.count },
                    { label:"移動時間", value: stationLabel(selectedJob.nearestStation, selectedJob.commuteTime) },
                    { label:"報酬",     value: payLabel(selectedJob) },
                  ].filter(row => row.value && String(row.value).trim()).map(row => (
                    <div key={row.label} style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center", textAlign:"center" }}>
                      <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>{row.label}</span>
                      <span className="f-sans" style={{ fontSize:15, color:"#222", fontWeight:600, lineHeight:1.6, whiteSpace:"pre-line" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}>支払方法：当日現金手渡し</p>
              </div>

              {/* 集合場所の表示は詳細ページから削除（2026-07-16）。承認後の共有はチャットの「はじめる前の確認」カードに一本化 */}

              {/* 開始打刻（①・承認済み以降・作業日当日のみ） */}
              {CHAT_ELIGIBLE_STATUSES.includes(myApplication?.status) && isWorkDayToday(selectedJob.dateStart, selectedJob.dateEnd) && (
                <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                  {myApplication.started_at ? (
                    <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#00A86B", margin:0 }}>
                      開始済み（{new Date(myApplication.started_at).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})}）
                      {myApplication.time_corrected && <span className="f-sans" style={{ marginLeft:6, fontSize:10, fontWeight:700, color:"#717171", background:"#F0F0F0", borderRadius:4, padding:"1px 5px" }}>修正済み</span>}
                    </p>
                  ) : (() => {
                    // 打刻の時間窓（第13弾(1)）。応募状況ページと同じ規則を使う＝ここだけ早く押せる抜け道を作らない
                    const win = punchStartWindow({ date_start: selectedJob.dateStart, date_end: selectedJob.dateEnd, work_time: selectedJob.workTime });
                    return (
                      <>
                        <button onClick={punchStart} disabled={punching || !win.canPunch} className={win.canPunch ? "btn-primary f-sans" : "f-sans"}
                          style={{ width:"100%", padding:"14px", fontSize:15, fontWeight:700, borderRadius:14, ...(win.canPunch ? {} : { background:"#E5E5E5", color:"#999", border:"none" }) }}>
                          {punching ? "..." : "▶ 作業を開始する"}
                        </button>
                        {!win.canPunch && <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"8px 0 0" }}>{win.reason}</p>}
                      </>
                    );
                  })()}
                </div>
              )}

              {empEmployer && empEmployer.nickname && (() => {
                const pk = selectedJob.perks ? { ...empEmployer, ...selectedJob.perks } : empEmployer; // 求人ごとの待遇上書き（2026-07-18）
                const perkRows = [
                  { label:"送迎",     on: pk.has_transport,        value: pk.has_transport ? `あり${pk.transport_area ? "（" + pk.transport_area + "）" : ""}` : EMPTY_MARK },
                  { label:"駐車場",   on: pk.has_parking,          value: pk.has_parking ? `あり${pk.parking_capacity ? "（" + pk.parking_capacity + "台）" : ""}` : EMPTY_MARK },
                  { label:"通勤手当", on: pk.has_commute_allowance, value: pk.has_commute_allowance ? `あり${pk.commute_allowance_detail ? "（" + pk.commute_allowance_detail + "）" : ""}` : EMPTY_MARK },
                  { label:"賞与",     on: pk.has_bonus,            value: pk.has_bonus ? "あり" : EMPTY_MARK },
                  { label:"農家負担", on: pk.employer_pays_supplies, value: pk.employer_pays_supplies ? `あり${pk.supplies_cap ? "（" + pk.supplies_cap + "）" : ""}` : EMPTY_MARK },
                  { label:"アクセサリー", on: pk.accessory_ok,          value: pk.accessory_ok ? "OK" : EMPTY_MARK },
                ];
                return (
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    {/* アイコン左・2倍(88px)・名前に「さん」・登録してからの月日。紹介文はここでは出さない（2026-07-16） */}
                    {/* アイコン・名前タップ→農園紹介をボックス展開（2026-07-16） */}
                    <div onClick={()=>setFarmIntroOpen(true)} role="button" style={{ display:"flex", alignItems:"center", gap:14, textAlign:"left", cursor:"pointer" }}>
                      <Avatar url={empEmployer.avatar_url} name={empEmployer.nickname} size={70} />
                      <div style={{ minWidth:0 }}>
                        <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>{empEmployer.nickname}さん</p>
                        {empTrust?.ok && empTrust.member_since && (
                          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>chitose-bank利用 {empTrust.member_since}から</p>
                        )}
                      </div>
                    </div>
                    <div style={{ borderTop:"1px solid #EBEBEB", margin:"14px 0 4px" }} />
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:4, letterSpacing:".06em", textAlign:"center" }}>待遇</p>
                    <div style={{ width:"fit-content", margin:"0 auto" }}>{/* 待遇ブロックはカード中央配置（2026-07-16・旧:境界線を中央に合わせるtranslateX(-78px)） */}
                      {perkRows.map((row, i) => (
                        <div key={row.label} style={{
                          display:"flex", alignItems:"center", gap:12, padding:"8px 0",
                          borderBottom: i < perkRows.length - 1 ? "1px solid #F7F7F7" : "none",
                        }}>
                          <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", width:72, flexShrink:0 }}>{row.label}</span>
                          <span className="f-sans" style={{ fontSize:15, color: row.on ? "#222" : "#B0B0B0", fontWeight: row.on ? 600 : 400, lineHeight:1.6 }}>{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 作業説明 */}
              {selectedJob.jobBody && selectedJob.jobBody.trim() && (
              <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>作業内容</p>
                <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, overflowWrap:"break-word", wordBreak:"break-word" }}>{selectedJob.jobBody}</p>
              </div>
              )}

              {/* 経験・持ち物・備考（配列駆動・未入力は「ー」）。希望する働き手は削除・必要経験と持ち物はバッジ表示（2026-07-16・確認/プレビューと同設計） */}
              <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                {[
                  { label:"持ち物",     value: disp(selectedJob.items), chips:true, pin:true },
                  { label:"備考・注意", value: disp(selectedJob.cautions) },
                ].map(row => (
                  <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                    <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2, textAlign:"center" }}>{row.label}</span>
                    {row.chips && row.value !== "ー"
                      ? (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:2, justifyContent:"center" }}>
                          {String(row.value).split(/[、,・\n／/]+/).map(s => s.trim()).filter(Boolean).map((c, i) => (
                            <span key={i} className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"6px 14px" }}>{row.pin ? "📌 " : ""}{c}</span>
                          ))}
                        </div>
                      )
                      : <span className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word", display:"block", textAlign:"center" }}>{row.value}</span>}
                  </div>
                ))}
              </div>

              {/* 危険区域セクション（両方空なら見出しごと非表示＝ブロック化） */}
              {((selectedJob.dangerPlaces && selectedJob.dangerPlaces.length > 0) || (selectedJob.dangerTasks && selectedJob.dangerTasks.length > 0)) && (
              <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
                  <span style={{ fontSize:18 }}>⚠️</span>
                  <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
                </div>

                {/* 危険な場所 */}
                {(selectedJob.dangerPlaces && selectedJob.dangerPlaces.length > 0) && (
                  <>
                    <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:28 }}>
                      {selectedJob.dangerPlaces.map((place, i) => {
                        const placePhotos = place.photos || [];
                        return (
                        <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={placePhotos} onPhotoClick={setDangerLightbox} />
                        );
                      })}
                    </div>
                  </>
                )}

                {/* 危険な作業 */}
                {(selectedJob.dangerTasks && selectedJob.dangerTasks.length > 0) && (
                  <>
                    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                      {selectedJob.dangerTasks.map((task, i) => {
                        const taskPhotos = task.photos || [];
                        return (
                        <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={taskPhotos} onPhotoClick={setDangerLightbox} />
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              )}
            </div>

            {/* 右カラム: 応募パネル（段階2-a・ガワのみ。応募は実稼働しない）
                外側はグリッドのstretchで左カラムの高さまで伸びるラッパー（枠なし＝sticky可動域の確保用）。
                内側が見た目の白い枠（中身の高さにしか伸びない） */}
            <div>
            <div ref={applyPanelRef} className="job-apply-panel" style={{
              position:"sticky", background:"#fff", border:"1px solid #EBEBEB",
              borderRadius:16, padding:"20px", marginBottom:5,
            }}>
              {/* 給与 */}
              <p className="f-mono" style={{ fontSize:22, fontWeight:800, color:"#222", margin:0, marginBottom:6 }}>
                {payLabel(selectedJob)}
              </p>

              {/* 最高額（自動計算・休憩1hダミー前提） */}
              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:16 }}>
                期間内に全て勤務した場合の最高額: {maxPay != null ? `¥${maxPay.toLocaleString()}` : "—"}
              </p>

              <div style={{ height:1, background:"#EBEBEB", margin:"0 0 16px" }} />

              {/* CTAボタン（募集終了・未応募なら「募集終了」表示で押下不可） */}
              <button
                onClick={hideApply ? undefined : applyBtnOnClick}
                disabled={hideApply || applying || applyBtnDisabled}
                className="btn-primary f-sans"
                style={{ width:"100%", padding:"16px", fontSize:15, fontWeight:700, borderRadius:14, ...(hideApply ? { background:"#EBEBEB", color:"#717171" } : applyBtnStyle) }}
              >{hideApply ? closedLabel : applyBtnLabel}</button>
              <p style={{ fontSize:12, color:"#888", textAlign:"center", marginTop:8 }}>お支払いは現金手渡し、作業当日のお支払いとなります。</p>

              {/* 補足文 */}
              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", textAlign:"center", margin:0, marginTop:10 }}>
                まだ応募は確定しません。正確な金額は面接後に決定します。
              </p>

            </div>
            </div>
          </div>

          {/* 募集者情報（2026-07-27たきと指示）：労働者の募集広告に必要な明示事項のうち
              「募集者の氏名または名称／住所・所在地／連絡先」をここに出す。
              残りの明示事項（業務内容＝作物と作業／業務を行う場所／報酬）は、この上の求人本体に記載済み。
              値は農家プロフィールの「募集者の情報」から（job_employer_profile経由・未ログインでも読める） */}
          <div style={{ width:"100%", marginBottom:12, background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:12, padding:"14px 16px" }}>
            <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:"0 0 10px" }}>募集者情報</p>
            {/* 値は求人ごとの控え（jobs_publicへ掲載時に転写）を優先。まだ控えの無い旧求人だけ
                原本（employer_profiles）へフォールバックする（2026-07-30・第14弾） */}
            {/* 募集者の氏名・住所・連絡先は未ログイン（anon）には非開示（2026-07-31・訪問者開示レベル第1弾）。
                DB側で jobs_public・job_employer_profile とも anon には NULL を返す。ここでは null を
                「未設定」ではなく会員登録の導線に置き換える（会員には全開示＝募集広告の明示義務） */}
            {[["募集者", selectedJob.recruiterName || empEmployer?.recruiter_name],
              ["住所・所在地", selectedJob.recruiterAddress || empEmployer?.recruiter_address],
              ["連絡先", selectedJob.recruiterContact || empEmployer?.recruiter_contact]].map(([l, v]) => (
              <div key={l} style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:6 }}>
                <span className="f-sans" style={{ flexShrink:0, width:88, fontSize:12, color:"#999" }}>{l}</span>
                <span className="f-sans" style={{ fontSize:13, color: (v && v.trim()) ? "#222" : (!me ? "#717171" : "#C77700"), lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word", minWidth:0 }}>
                  {(v && v.trim()) ? v : (!me ? "🔒 会員のみ表示" : "未設定")}
                </span>
              </div>
            ))}
            {!me ? (
              <button onClick={visitorGuide} className="btn-primary f-sans" style={{ width:"100%", marginTop:8, padding:"11px 16px", fontSize:13, fontWeight:700, borderRadius:10, border:"none", cursor:"pointer" }}>
                会員登録・ログインすると表示されます
              </button>
            ) : (
              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"8px 0 0", lineHeight:1.7 }}>
                業務内容・業務を行う場所・報酬は、このページの上部に記載しています。
              </p>
            )}
          </div>

          {/* 地図（集合場所のおおよその範囲・円のみ） */}
          <div style={{ width:"100%", marginBottom:5 }}>
            <JobLocationMap
              lat={selectedJob.lat}
              lng={selectedJob.lng}
              radius={selectedJob.radius}
              label={selectedJob.region}
            />
          </div>

          {/* 開催期間カレンダー（地図の下・全幅・PCのみ表示。スマホはフッター📅からモーダル） */}
          {selectedJob.dateStart && (
            <div className="calendar-below-map" style={{ marginBottom:5 }}>
              <CalendarView start={selectedJob.dateStart} end={selectedJob.dateEnd} readOnly={true} />
            </div>
          )}

          {/* 農園紹介セクションはページから削除（2026-07-16）。内容は農家カードのアイコン・名前タップのボックスに集約 */}

          {/* 農家へのレビュー（段階2-a・ガワのみ・取引実績ベース・匿名・日付なし） */}
          {(() => {
            const allReviews = selectedJob.farmerReviews || [];
            if (allReviews.length === 0) return null;
            const sortedReviews = [...allReviews];
            if (reviewSort === "high") sortedReviews.sort((a, b) => b.stars - a.stars);
            else if (reviewSort === "low") sortedReviews.sort((a, b) => a.stars - b.stars);
            const visibleReviews = showAllReviews ? sortedReviews : sortedReviews.slice(0, 8);
            const hasMore = sortedReviews.length > 8;

            return (
              <div style={{ marginBottom:5 }}>
                {/* ヘッダー: 左=農家プロフィール(控えめ) / 中央=星評価(主役) */}
                <div className="review-header-row" style={{ marginBottom:24 }}>
                  {/* 左: 農家プロフィール（控えめ・既存プロフィール行を縮小） */}
                  <div className="review-header-profile" style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{
                      width:32, height:32, borderRadius:"50%", background:"#E6F7EF", flexShrink:0,
                      display:"flex", alignItems:"center", justifyContent:"center", fontSize:16,
                    }}>🧑‍🌾</div>
                    <div>
                      <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:0 }}>{selectedJob.farmerName}</p>
                      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:0 }}>{selectedJob.farmerBadge}・{selectedJob.farmerYears}</p>
                    </div>
                  </div>

                  {/* 中央: 星評価（主役・特大） */}
                  <div className="review-header-stars">
                    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:8 }}>
                      <span style={{ fontSize:36, color:"#00A86B" }}>★</span>
                      <span className="f-mono" style={{ fontSize:36, fontWeight:800, color:"#222" }}>{selectedJob.farmerRating}</span>
                    </div>
                    <p className="f-sans" style={{ fontSize:15, color:"#717171", margin:0, marginTop:2 }}>{selectedJob.farmerReviewCount}件のレビュー</p>
                  </div>

                  {/* 右: バランス用の余白 */}
                  <div className="review-header-spacer" />
                </div>

                {/* 並び替えタブ */}
                <div style={{ display:"flex", gap:8, marginBottom:18 }}>
                  {[
                    { key:"new",  label:"新しい順" },
                    { key:"high", label:"評価が高い順" },
                    { key:"low",  label:"評価が低い順" },
                  ].map(opt => {
                    const active = reviewSort === opt.key;
                    return (
                      <button key={opt.key} onClick={() => setReviewSort(opt.key)} className="f-sans" style={{
                        padding:"7px 16px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:600,
                        border: active ? "1px solid #00A86B" : "1px solid #EBEBEB",
                        background: active ? "#E6F7EF" : "#fff",
                        color: active ? "#00A86B" : "#717171",
                      }}>{opt.label}</button>
                    );
                  })}
                </div>

                {/* 個別レビュー一覧（匿名・日付なし・最大8件） */}
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  {visibleReviews.map((review, i) => (
                    <div key={i} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px" }}>
                      <p style={{ margin:0, marginBottom:6, fontSize:15, color:"#00A86B", letterSpacing:1 }}>
                        {"★".repeat(review.stars)}{"☆".repeat(5 - review.stars)}
                      </p>
                      <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.7, margin:0 }}>{review.text}</p>
                    </div>
                  ))}
                </div>

                {/* もっと見る */}
                {hasMore && !showAllReviews && (
                  <button onClick={() => setShowAllReviews(true)} className="f-sans" style={{
                    display:"block", margin:"18px auto 0", padding:"10px 28px", borderRadius:20,
                    border:"1px solid #222", background:"#fff", color:"#222", fontSize:13, fontWeight:700, cursor:"pointer",
                  }}>もっと見る</button>
                )}
              </div>
            );
          })()}

          {/* その他の求人（0件なら「ありません」を表示） */}
          <div className="job-detail-more-jobs" style={{ marginBottom:20 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:12 }}>その他の求人</h3>
            {jobList.filter(job => job.id !== selectedJob.id).length === 0 ? (
              <p className="f-sans" style={{ fontSize:15, color:"#999", padding:"20px 0" }}>現在、他の求人はありません。</p>
            ) : (
            <Carousel
              className="carousel-scroll"
              style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:4 }}
            >
              {jobList.filter(job => job.id !== selectedJob.id).map(job => (
                <JobCard key={job.id} job={job} variant="related" saved={savedIds.has(job.id)} onToggleSave={canLike(job) ? toggleSave : undefined} />
              ))}
            </Carousel>
            )}
          </div>

          {/* 通報リンク（目立たせない・ログイン時のみ） */}
          {me && (
            <div style={{ textAlign:"center", marginTop:8 }}>
              <button onClick={()=>setShowReportModal(true)} className="f-sans" style={{
                background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                fontSize:12, color:"#717171", textDecoration:"underline", padding:4,
              }}>⚑ この求人を報告する</button>
            </div>
          )}
          </>)}
          </ContentQSwipeArea>
        </div>
      </>)}

      {/* PC専用：下固定の応募バー（応募パネルが画面外に出たら表示。スマホはCSSでdisplay:none）。募集終了かつ未応募では非表示（2026-07-24） */}
      {selectedJob && showApplyBar && ownLoaded && !isOwnJob && (
        <div className="pc-apply-bar" style={{
          position:"fixed", bottom:0, left:0, right:0, zIndex:500,
          background:"#fff", borderTop:"1px solid #EBEBEB",
          padding:"16px 24px", boxShadow:"0 -4px 16px rgba(0,0,0,0.08)",
          alignItems:"center", justifyContent:"space-between", gap:24,
        }}>
          <span className="f-mono" style={{ fontSize:18, fontWeight:800, color:"#222" }}>{payLabel(selectedJob)}</span>
          <button
            onClick={hideApply ? undefined : applyBtnOnClick}
            disabled={hideApply || applying || applyBtnDisabled}
            className="btn-primary f-sans"
            style={{ padding:"14px 32px", fontSize:15, fontWeight:700, borderRadius:14, whiteSpace:"nowrap", ...(hideApply ? { background:"#EBEBEB", color:"#717171" } : applyBtnStyle) }}
          >{hideApply ? closedLabel : applyBtnLabel}</button>
        </div>
      )}

      {/* 求人詳細（スマホ専用）：常時表示の下部応募フッター。スクロール中は非表示(CSS)。自分の求人には出さない（2026-07-22）。
          募集終了（満員／期間終了）かつ未応募でも、構造は同じままボタンを「この募集は終了しました」の
          灰色・押せない状態にする（2026-07-27たきと指示。以前はフッターごと消していたため、訪問者には
          下部ナビだけが残り、終了したことが伝わらなかった） */}
      {selectedJob && ownLoaded && !isOwnJob && (
        <div className="mobile-apply-bar" style={{ boxShadow:"0 -4px 16px rgba(0,0,0,0.08)" }}>
          {/* 並び入れ替え（2026-07-16）：日給＋応募ボタンが上・注記が下 */}
          {/* バランス修正（2026-07-24）：報酬は1行固定(flexShrink:0)・ボタンは残り幅(flex:1)で長いラベル
              （「承認されました — チャットを開く」等）は2行に折り返す＝画面から見切れない */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
            <span className="f-mono" style={{ fontSize:16, fontWeight:800, color:"#222", flexShrink:0, whiteSpace:"nowrap" }}>{payLabel(selectedJob)}</span>
            <button
              onClick={hideApply ? undefined : applyBtnOnClick}
              disabled={hideApply || applying || applyBtnDisabled}
              className="btn-primary f-sans"
              style={{ flex:1, minWidth:0, padding:"12px 12px", fontSize:14, fontWeight:700, borderRadius:14, lineHeight:1.35, textAlign:"center", ...(hideApply ? { background:"#EBEBEB", color:"#717171" } : applyBtnStyle) }}
            >{hideApply ? closedLabelShort : applyBtnLabel}</button>
          </div>
          <p className="f-sans" style={{ fontSize:11, color:"#888", textAlign:"center", margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {hideApply ? "ほかの求人は「さがす」から見られます" : "応募しても即採用ではなく、面接後に決まります"}
          </p>
        </div>
      )}

      {/* 応募確認ボックス（2026-07-18）：応募ボタンタップで展開。承認制の説明＋下部に「戻る」「応募する」。
          意匠はお知らせボックスの規格（左詰め・緑太縁3px・タイトルジャンプ・横線・上限30px/下限フッター+40px・本文18） */}
      {applyConfirmOpen && selectedJob && (
        <div onClick={()=>setApplyConfirmOpen(false)} className="cb-box-overlay" style={{ zIndex:9000 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            {/* ✕ボタンは置かない（2026-07-27たきと指示）：ボックス外タップ＋下部「戻る」で閉じられるso重複 */}
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text="応募の確認" /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            {/* 承認の流れ（①プロフィール確認②判断③承認決定）のインフォグラフィック＝応募前に承認制であることを伝える */}
            {/* ★aspectRatioで場所を先に確保する（2026-07-27・日程チップの誤タップ修理）。
                高さ未指定だと画像の読み込み完了時に下の内容（来られる日のチップ）が一段ずり下がり、
                狙った位置に別のチップが来る＝「押していない日が選ばれる」誤作動になっていた */}
            <img src="/apply-approval-flow.jpg" alt="承認の流れ：応募者のプロフィールを見て、承認するか決めます"
              width={1000} height={750} style={{ display:"block", width:"100%", height:"auto", aspectRatio:"1000 / 750", borderRadius:12, background:"#F7F7F7" }} />
            <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:"14px 0 0" }}>
              応募はまだ採用ではありません。承認前であれば、返事待ちページからいつでも取り消せます。
            </p>
            <p className="f-sans" style={{ fontSize:13, color:"#8A8A8A", lineHeight:1.7, margin:"12px 0 0", background:"#F7F7F7", borderRadius:10, padding:"10px 12px" }}>
              採用されると契約が成立し、お互いのお名前（本名）が農家に表示されます。雇用の手続き（労働者名簿・賃金の記録）に必要なためです。
            </p>
            {isPeriodJob ? (
              /* 期間求人：来られる日を宣言してから応募（いつでもOK=1タップ／特定日=複数選択） */
              <div style={{ marginTop:18 }}>
                <div style={{ height:1, background:"#E5E5E5", margin:"0 0 16px" }} />
                <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 4px" }}>来られる日を選んでください</p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 14px", lineHeight:1.6 }}>この求人は期間募集です。来られる日を農家に伝えてから応募します。</p>
                {/* ⭕ 期間中いつでもOK＝1タップで即応募 */}
                <button onClick={()=>{ applyAvailRef.current = "any"; setApplyConfirmOpen(false); handleApply(); }} disabled={applying} className="f-sans" style={{ width:"100%", padding:"16px", fontSize:16, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:14, cursor:"pointer", marginBottom:16, opacity: applying ? 0.6 : 1 }}>⭕ 期間中いつでもOK</button>
                <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", margin:"0 0 12px" }}>または、来られる日を選ぶ</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
                  {periodDays.map(d => {
                    const on = applyDates.includes(d);
                    return (
                      <button key={d} onClick={()=>setApplyDates(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])} className="f-sans" style={{ padding:"9px 12px", fontSize:13, fontWeight:700, borderRadius:20, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{calFmtDate(d)}</button>
                    );
                  })}
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>setApplyConfirmOpen(false)} className="f-sans" style={{ flex:1, padding:"14px", fontSize:14, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>戻る</button>
                  <button onClick={()=>{ if (applyDates.length===0) return; applyAvailRef.current = [...applyDates].sort(); setApplyConfirmOpen(false); handleApply(); }} disabled={applying || applyDates.length===0} className="btn-primary f-sans" style={{ flex:2, padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, opacity: (applying || applyDates.length===0) ? 0.5 : 1, cursor: applyDates.length===0 ? "not-allowed" : "pointer" }}>{applying ? "送信中..." : `この日程で応募する${applyDates.length>0 ? `（${applyDates.length}日）` : ""}`}</button>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", gap:8, marginTop:18 }}>
                <button onClick={()=>setApplyConfirmOpen(false)} className="f-sans" style={{ flex:1, padding:"14px", fontSize:14, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>戻る</button>
                <button onClick={()=>{ applyAvailRef.current = null; setApplyConfirmOpen(false); handleApply(); }} disabled={applying} className="btn-primary f-sans" style={{ flex:2, padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, opacity: applying ? 0.6 : 1 }}>{applying ? "送信中..." : "応募する"}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* きっかけアンケート（初回いいね時・2026-07-24）：スキップ導線なし（10秒・一度きり・いいね限定のゲート）。
          応募・Q&A・チャットには絶対にゲートを置かない＝コア動作は永久に無料通行 */}
      {surveyJob && (
        <div style={{ position:"fixed", inset:0, zIndex:10050, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"22px 20px", maxWidth:460, width:"100%", maxHeight:"88vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 4px" }}>はじめてのいいねの前に</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 18px", lineHeight:1.7 }}>10秒だけ教えてください。今後の運営の参考にします。</p>

            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 8px" }}>Q1. このサイトをどこで知りましたか？</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom: surveySource==="その他" ? 8 : 18 }}>
              {SURVEY_SOURCES.map(s => (
                <button key={s} onClick={()=>setSurveySource(s)} className="f-sans" style={{ padding:"8px 14px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer", border:"1px solid "+(surveySource===s?"#00A86B":"#EBEBEB"), background: surveySource===s?"#E6F7EF":"#F7F7F7", color: surveySource===s?"#00A86B":"#717171" }}>{s}</button>
              ))}
            </div>
            {surveySource==="その他" && (
              <input value={surveySourceOther} onChange={e=>setSurveySourceOther(e.target.value)} placeholder="よければ一言（任意）" className="field f-sans" style={{ fontSize:14, marginBottom:18 }} />
            )}

            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 8px" }}>Q2. どんなふうに使いたいですか？（複数選択可）</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom: surveyReasons.includes("その他") ? 8 : 20 }}>
              {SURVEY_REASONS.map(s => (
                <button key={s} onClick={()=>toggleSurveyReason(s)} className="f-sans" style={{ padding:"8px 14px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer", border:"1px solid "+(surveyReasons.includes(s)?"#00A86B":"#EBEBEB"), background: surveyReasons.includes(s)?"#E6F7EF":"#F7F7F7", color: surveyReasons.includes(s)?"#00A86B":"#717171" }}>{s}</button>
              ))}
            </div>
            {surveyReasons.includes("その他") && (
              <input value={surveyReasonOther} onChange={e=>setSurveyReasonOther(e.target.value)} placeholder="よければ一言（任意）" className="field f-sans" style={{ fontSize:14, marginBottom:20 }} />
            )}

            <button onClick={submitSurvey} disabled={surveySaving || !surveySource} className="btn-primary f-sans" style={{ width:"100%", padding:"15px", fontSize:15, fontWeight:700, borderRadius:12, opacity:(surveySaving||!surveySource)?0.5:1 }}>{surveySaving ? "送信中..." : "送信していいねする"}</button>
          </div>
        </div>
      )}
      {/* 初いいねボックス（2026-07-19）：各求人の最初のいいねで1回だけ展開。
          意匠はお知らせボックスの規格（左詰め・緑太縁3px・タイトルジャンプ・横線・本文18・リンク18）。
          求人カードに❤️が付く動作（cb-heart-pop）＋「いいね一覧を見る →」リンク */}
      {likeDone && (
        <div onClick={()=>setLikeDone(null)} className="cb-box-overlay" style={{ zIndex:9000 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            {/* ✕ボタンは置かない（2026-07-27たきと指示）：ボックス外タップで閉じられるso重複 */}
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text="いいねしました！" /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            {/* いいねした求人のカード：右上に❤️が付く動作（一覧カードの♡ボタンと同じ位置） */}
            <div style={{ position:"relative", margin:"6px 0 14px" }}>
              <div style={{ border:"1px solid #EBEBEB", borderRadius:12, overflow:"hidden", background:"#fff" }}>
                {(() => {
                  const p0 = likeDone.photos?.[0];
                  const src = typeof p0 === "string" ? p0 : p0?.url;
                  const icon = CROP_OPTIONS.find(c => likeDone.crop && likeDone.crop.includes(c.name))?.icon || "🌱";
                  return src
                    ? <img src={src} alt="" style={{ width:"100%", height:150, objectFit:"cover", display:"block" }} />
                    : <div style={{ width:"100%", height:150, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44 }}>{icon}</div>;
                })()}
                <div style={{ padding:"10px 14px 12px" }}>
                  <p className="f-sans" style={{ fontSize:15, fontWeight:600, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[likeDone.crop, likeDone.task].filter(Boolean).join(" ") || "求人"}</p>
                  {likeDone.region && <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"2px 0 0" }}>{likeDone.region}</p>}
                </div>
              </div>
              <span className="cb-heart-pop" style={{ position:"absolute", top:8, right:8, width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,0.92)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, boxShadow:"0 1px 4px rgba(0,0,0,0.18)" }}>❤️</span>
            </div>
            <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0 }}>
              いいねした求人は、いつでも一覧から見返せます。
            </p>
            <button onClick={()=>{ setLikeDone(null); window.location.hash="/saved"; }} className="f-sans" style={{ marginTop:16, background:"none", border:"none", borderBottom:"2px solid #00A86B", padding:"0 0 2px", fontSize:18, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>いいね一覧を見る →</button>
          </div>
        </div>
      )}

      {/* 開催期間カレンダー📅の浮遊ボタンは削除（2026-07-24・誰も展開しないため）。開催期間はPC地図下のカレンダー・主要情報カードで確認できる */}

      {/* 危険箇所の写真ライトボックス（全画面拡大） */}
      {dangerLightbox && (
        <div onClick={() => setDangerLightbox(null)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", animation:"fadeIn .2s ease", padding:16,
        }}>
          <button onClick={e => { e.stopPropagation(); setDangerLightbox(null); }} style={{
            position:"absolute", top:20, right:20,
            width:40, height:40, borderRadius:"50%",
            background:"rgba(255,255,255,0.15)", border:"none",
            color:"#fff", fontSize:22, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>✕</button>
          <img src={dangerLightbox} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}

      {/* 農園紹介モーダル（代表よりカードのタップで展開。お題＋代表よりの全文） */}
      {farmIntroOpen && empEmployer && (() => {
        const topics = farmIntroTopics(empEmployer);
        return (
          <div onClick={() => setFarmIntroOpen(false)} style={{
            position:"fixed", inset:0, zIndex:10000,
            background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none",
          }}>
            <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{
              position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))",
              maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, padding:20,
              overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y",
            }}>
              <button onClick={() => setFarmIntroOpen(false)} style={{
                position:"absolute", top:12, right:12,
                width:36, height:36, borderRadius:"50%",
                background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer",
              }}>✕</button>
              <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 16px", paddingRight:40 }}>
                {empEmployer.nickname ? `${empEmployer.nickname}の農園紹介` : "農園紹介"}
              </h3>
              {/* まず信頼カード（農園紹介の下のボックス）→次に農園紹介（2026-07-16） */}
              {(farmHostQa(empEmployer).length > 0 || !!empEmployer.interaction_style || !!(empTrust && empTrust.ok)) && (
                <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:16 }}>
                  <FarmerTrustCard profile={empEmployer} trust={empTrust} onTapOpenJobs={() => openPastJobs("open")} onTapExperience={() => openPastJobs("ended")} />
                </div>
              )}
              {/* 過去の求人ボックス（受け入れ実績タップで展開・公開中/終了の帯・タップで詳細へ） */}
              {pastJobsOpen && (
                <div onClick={()=>setPastJobsOpen(false)} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none" }}>
                  <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, padding:20, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}>
                    <button onClick={()=>setPastJobsOpen(false)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", zIndex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                    <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 16px", paddingRight:40 }}>{empEmployer.nickname ? `${empEmployer.nickname}さんの求人` : "この農家の求人"}</h3>
                    {pastJobs === null ? (
                      <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>
                    ) : pastJobs.length === 0 ? (
                      <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>
                        {(empTrust?.ok && empTrust.completed_hires > 0) ? "過去に受け入れた求人は、掲載を終了しています" : "初めての求人です"}
                      </p>
                    ) : (() => {
                      // 求人を「終了（掲載日程が過ぎた）／公開中」で仕分けし、すべて/公開中/終了タブで絞る（2026-07-23）
                      const today = ymdLocal(new Date());
                      const withEnded = pastJobs.map(r => {
                        const endYmd = r.date_end || r.date_start;
                        return { r, ended: !!endYmd && endYmd < today };
                      });
                      const openList = withEnded.filter(x => !x.ended);
                      const endedList = withEnded.filter(x => x.ended);
                      const tabs = [
                        { key:"all", label:"すべて", n: withEnded.length },
                        { key:"open", label:"公開中", n: openList.length },
                        { key:"ended", label:"過去の実績", n: endedList.length },
                      ];
                      const shown = pastJobsTab === "open" ? openList : pastJobsTab === "ended" ? endedList : withEnded;
                      // タップした求人を最前列へ移動し、概要をタブ内で展開（2026-07-24）
                      const focusIdx = pastJobsFocus != null ? shown.findIndex(x => x.r.job_number === pastJobsFocus) : -1;
                      const ordered = focusIdx >= 0 ? [shown[focusIdx], ...shown.slice(0, focusIdx), ...shown.slice(focusIdx + 1)] : shown;
                      const fmtCnt = (v) => (v > 0 ? `${v}人` : "ー"); // なければ「ー」で統一
                      return (
                      <>
                      <div style={{ display:"flex", gap:6, marginBottom:14, borderBottom:"1px solid #EBEBEB" }}>
                        {tabs.map(t => (
                          <button key={t.key} onClick={()=>{ setPastJobsTab(t.key); setPastJobsFocus(null); }} className="f-sans" style={{
                            background:"none", border:"none", cursor:"pointer", padding:"6px 6px 10px",
                            fontSize:13, fontWeight: pastJobsTab===t.key ? 700 : 500,
                            color: pastJobsTab===t.key ? "#00A86B" : "#999",
                            borderBottom: pastJobsTab===t.key ? "2px solid #00A86B" : "2px solid transparent",
                            marginBottom:-1,
                          }}>{t.label}{t.n > 0 ? ` ${t.n}` : ""}</button>
                        ))}
                      </div>
                      {shown.length === 0 ? (
                        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"28px 0" }}>
                          {pastJobsTab==="ended" ? "まだ過去の実績はありません" : pastJobsTab==="open" ? "公開中の求人はありません" : "求人がありません"}
                        </p>
                      ) : (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
                        {ordered.map(({ r, ended }) => {
                          const photo = r.photos && r.photos[0] ? (typeof r.photos[0] === "string" ? r.photos[0] : r.photos[0]?.url) : null;
                          const isFocus = focusIdx >= 0 && r.job_number === pastJobsFocus;
                          if (isFocus) {
                            // 展開概要カード：最前列（グリッド全幅）。人数は集計値のみ・0は「ー」
                            const c = pastJobsCounts[r.job_number] || {};
                            return (
                              <div key={r.job_number} style={{ gridColumn:"1 / -1", position:"relative", background:"#F7F7F7", borderRadius:12, padding:10, display:"flex", gap:10, alignItems:"flex-start" }}>
                                <button onClick={()=>setPastJobsFocus(null)} aria-label="閉じる" style={{ position:"absolute", top:6, right:6, width:26, height:26, borderRadius:"50%", background:"#fff", border:"none", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                                <div style={{ width:84, height:84, borderRadius:10, overflow:"hidden", flexShrink:0, background:"#EBEBEB", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                                  {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", ...(ended ? { filter:"grayscale(40%)" } : {}) }} /> : "🌾"}
                                </div>
                                <div style={{ flex:1, minWidth:0, paddingRight:24 }}>
                                  <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"0 0 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                    {[r.crop, r.task].filter(Boolean).join(" ") || ("求人 #" + r.job_number)}
                                    {pastJobsTab === "all" && <span className="f-sans" style={{ fontSize:10, fontWeight:600, color: ended ? "#9E9E9E" : "#00A86B", marginLeft:6 }}>{ended ? "終了" : "公開中"}</span>}
                                  </p>
                                  {r.date_label && <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 6px" }}>{r.date_label}</p>}
                                  <p className="f-sans" style={{ fontSize:12, color:"#222", margin:"0 0 8px" }}>
                                    応募 {fmtCnt(c.applied)}・承認 {fmtCnt(c.approved)}・採用 {fmtCnt(c.hired)}
                                  </p>
                                  <button onClick={()=>openPastJob(r)} className="f-sans" /* 文言は必ず1行（2026-07-27たきと指示）：折り返すと2行になり読みにくかったため、nowrapに加えて表示中のラベルを短くした */ style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:8, padding:"7px 12px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", maxWidth:"100%" }}>
                                    {r.job_number === selectedJob.id ? "この求人を表示中" : "求人ページを見る →"}
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <button key={r.job_number} onClick={()=>setPastJobsFocus(r.job_number)} className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#F7F7F7", border:"none", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                              <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, overflow:"hidden" }}>
                                {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", ...(ended ? { filter:"grayscale(40%)" } : {}) }} /> : "🌾"}
                                {/* 状態帯は「すべて」タブでのみ表示。公開中/過去の実績タブは絞り込み済みで帯が冗長（2026-07-24） */}
                                {pastJobsTab === "all" && <StatusRibbon label={ended ? "終了" : "公開中"} color={ended ? "#9E9E9E" : "#00A86B"} />}
                                {/* 概要は写真の上に重ねる。黒の半透明グラデで写真の明暗を問わず白文字を読ませる（2026-07-23） */}
                                <div style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))", pointerEvents:"none" }}>
                                  <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#fff", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.5)" }}>{[r.crop, r.task].filter(Boolean).join(" ") || ("求人 #" + r.job_number)}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      )}
                      </>
                      );
                    })()}
                  </div>
                </div>
              )}
              {empEmployer.owner_comment && empEmployer.owner_comment.trim() && (
                <div style={{ background:"#F7F7F7", borderRadius:16, padding:"16px", marginBottom:16 }}>
                  <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>代表より</p>
                  <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{empEmployer.owner_comment}</p>
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {topics.map((t, i) => (
                  <div key={i} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px" }}>
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>{t.label}</p>
                    <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{t.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 通報モーダル：差し戻しモーダル(759e54c)と同じ視覚文法・語彙 */}
      {showReportModal && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%" }}>
            {reportDone ? (
              <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0", margin:0 }}>報告を受け付けました。運営が確認します</p>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>この求人を報告する</p>
                <div style={{ display:"grid", gap:8, marginBottom:8 }}>
                  <select value={reportTargetField} onChange={e=>setReportTargetField(e.target.value)} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" }}>
                    <option value="">対象項目を選択</option>
                    {REPORT_TARGET_FIELDS.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={reportIssueType} onChange={e=>setReportIssueType(e.target.value)} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" }}>
                    <option value="">問題の種類を選択</option>
                    {REPORT_ISSUE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  <textarea
                    value={reportDetail}
                    onChange={e=>setReportDetail(e.target.value)}
                    placeholder="詳細（任意）"
                    rows={4}
                    className="f-sans"
                    style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }}
                  />
                </div>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>報告は運営のみが確認します。求人の掲載者にはあなたの情報は伝わりません</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={closeReportModal} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button
                    onClick={submitReport}
                    disabled={reportSending || !reportTargetField || !reportIssueType}
                    className="f-sans"
                    style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background: (reportTargetField && reportIssueType) ? "#E24B4A" : "#EBEBEB", color: (reportTargetField && reportIssueType) ? "#fff" : "#717171", border:"none", borderRadius:10, cursor:"pointer" }}
                  >{reportSending ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* プロフィールゲート：softは応募を止めず誘導するだけ／hardはサーバー側の必須条件未達（プロフィールを書くのみ） */}
      {profileGate && (
        <div style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.4)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16,
        }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:360, width:"100%", textAlign:"center" }}>
            {profileGate.mode === "hard" ? (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>応募には自己紹介が必要です</p>
                <div style={{ display:"flex", justifyContent:"center", gap:16, marginBottom:16 }}>
                  <span className="f-sans" style={{ fontSize:15, fontWeight:600, color: profileGate.hasNickname ? "#00A86B" : "#E24B4A" }}>
                    ニックネーム {profileGate.hasNickname ? "✓" : "✗"}
                  </span>
                  <span className="f-sans" style={{ fontSize:15, fontWeight:600, color: profileGate.qaAnswered >= profileGate.qaRequired ? "#00A86B" : "#717171" }}>
                    質問への回答 {profileGate.qaAnswered}/{profileGate.qaRequired}
                  </span>
                </div>
                <p className="f-sans" style={{ fontSize:15, color:"#717171", lineHeight:1.8, marginBottom:20 }}>あなたのことが伝わると、農家は安心して承認できます。</p>
                <button
                  onClick={() => { setApplyReturn(selectedJob.id); setProfileGate(null); window.location.hash = "/profile/worker/profile"; }}
                  className="f-sans"
                  style={{ width:"100%", padding:"12px", background:"#00A86B", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:700, cursor:"pointer" }}
                >プロフィールを書く</button>
              </>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:8 }}>プロフィールがまだ空です</p>
                <p className="f-sans" style={{ fontSize:15, color:"#717171", lineHeight:1.8, marginBottom:20 }}>自己紹介があると、農家に安心して承認してもらえます。</p>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <button
                    onClick={() => { setApplyReturn(selectedJob.id); setProfileGate(null); window.location.hash = "/profile/worker/profile"; }}
                    className="f-sans"
                    style={{ padding:"12px", background:"#00A86B", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:700, cursor:"pointer" }}
                  >プロフィールを書く</button>
                  <button
                    onClick={() => { setProfileGate(null); doApply(); }}
                    className="f-sans"
                    style={{ padding:"12px", background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, fontSize:14, fontWeight:600, cursor:"pointer" }}
                  >このまま応募する</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
