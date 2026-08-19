// 分割3-C（2026-07-25）：App.jsxから移動。「さがす」求人一覧＋求人詳細＋応募パネル。
import { useState, useEffect, useRef } from "react";
import { setApplyReturn, clearApplyReturn } from "../lib/applyReturn";
import { fetchWorkerReady } from "../lib/workerReady";
import { openLoginBox } from "../lib/previewBus";
import { isAdmin, ymdLocal, isWorkDayToday, calFmtDate, payLabel, mapJobPublicRow, overtimeLine, EMPTY_MARK, disp, stationLabel, farmHostQa, CHAT_ELIGIBLE_STATUSES, SURVEY_SOURCES, SURVEY_REASONS, farmIntroTopics, perkBadges, photoThumb, payTermsLine, PAY_TIMING_LABELS, PAY_METHOD_LABELS, CURRENT_PAY_POLICY } from "../lib/utils";
import { Avatar, Carousel, DangerItem, JobFlagBadges, JobPhotoFallback, LinkifiedText, NoticeJumpText, StatusRibbon, AutoSkeleton, useSkeletonProbe, Dots, MaskedAddress, MaskedText, QaChat } from "./ui";
import { getCache, setCache } from "../lib/viewCache";
import { snapGet } from "../lib/snapshot";
import { fetchPublicJobs, orderSearchJobs, recordSeenNewIds } from "../lib/searchJobs";
import { useRefreshTick, REFRESH_JOBS } from "../lib/refreshBus";
import { createIdleQueue } from "../lib/idleQueue";
import { CalendarView } from "./CalendarView";
import { JobCard } from "./JobCard";
import { CropIcon } from "./CropIcon";
import { JobLocationMap } from "./JobLocationMap";
import { ContentQTabs, ContentQSwipeArea, JobQuestions } from "./JobQuestions";
import { InsurancePanel } from "./InsurancePanel";
import { FarmerTrustCard } from "./TrustCards";
import { SearchLaneTabs } from "./SearchLaneTabs";
import { ConsignmentSearchList } from "./ConsignmentSearchList";
import { canSeeConsignment } from "../lib/consignAccess";
import { calcMaxPay, jobMonths } from "../features/jobs/search/model";
import { readStoredSearch, writeStoredSearch } from "../features/jobs/search/filters/searchFilterStorage";
import { SearchFab, SearchFilterPanel } from "../features/jobs/search/filters/SearchFilterPanel";
import { JobKeyFacts, JobDescription, JobDangerZones, JobLocationSection,
  JobPhotoGallery, JobEmployerCard, JobReviews, RelatedJobs } from "../features/jobs/search/components/JobDetailPanel";
import { ApplyPanel, ApplyBarPC, ApplyBarMobile, ApplyConfirmBox } from "../features/jobs/search/components/ApplyPanel";
import { getSession, fetchPublicJobByNumber, fetchMyJobNumbers, fetchPendingJobPreviews, copyJob, unpublishJob,
  fetchJobEmployerProfile, fetchJobEmployerTrustInfo, fetchEmployerPublicJobs, fetchEmployerPublicJobCounts,
  fetchSavedJobNumbers, deleteSavedJob, insertSavedJob, fetchMyApplications, fetchMyPendingApplications,
  fetchMyApplicationForJob, fetchMyPendingForJob, applyToJob, createPendingApplication, cancelApplication,
  fetchAccountHolderId, insertJobReport, fetchSurveyAnswered, insertSurvey,
  fetchConsignorConsent, fetchSignupOpen } from "../features/jobs/search/jobSearchApi";

// ── JobSearchMapView ────────────────────────────────────────
// 「募集中の仕事を探す」画面。LandingFlow・LaborTab 両方で使用。
// 将来: Google Maps / Mapbox / Leaflet に差し替え可能な構造にしてある。
// 応募パネルの最高額 calcMaxPay・絞り込みの月 jobMonths → features/jobs/search/model.js へ移設（2026-08-17）

export function JobSearchMapView({ onRegister, me }) {
  const [selectedJob, setSelectedJob] = useState(null);
  const [detailTab, setDetailTab] = useState("content"); // 求人詳細の「仕事の内容/質問」タブ（第10弾）
  // 別の求人を開いたら内容タブに戻す（2026-07-27：selectedJob監視のリセットeffectは廃止。
  // タブ指定つきURL #/work/job/{番号}/questions の指定を後から打ち消してしまうため、
  // 「開く側」＝openJob・戻るスタック・hash解釈のそれぞれで明示的にタブを決める）
  // 出どころ（cb_jobBackTo）は開いた時点でstateに引き取る（2026-07-27）：
  // 描画のたびにsessionStorageを読むと、消し忘れが次の求人に持ち越されて戻り先を誤る
  const [backTo, setBackTo] = useState(null);
  // 自分が出した求人の番号（2026-07-29たきと指示「自分の求人にはいいねを付けられないように」）。
  // 一覧のカードは jobs_public 経由で farmer_id を持たないため、自分の求人番号をまとめて引いて突き合わせる。
  // jobsのRLS（owner select）で返るのは自分の行だけので、他人の求人番号は取得できない
  // キャッシュから即座に持つ（2026-08-03たきと指摘「満員判定が数十秒かかる」）：
  // この一覧は求人詳細の「自分の求人か」の判定も兼ねる（下記 isOwnJob）。以前は求人を開くたびに
  // jobs を1件引いて確定を待っていたため、セッション復元＋その往復ぶん（回線が悪いと数十秒）
  // フッターも満員表示も出なかった。番号の集合は本人スコープの表示専用データのでキャッシュ可
  const [myJobNums, setMyJobNums] = useState(() => { const c = getCache("search:myJobNums"); return new Set(Array.isArray(c) ? c : []); });
  const [myJobNumsLoaded, setMyJobNumsLoaded] = useState(() => Array.isArray(getCache("search:myJobNums")));
  useEffect(() => {
    if (!me) { setMyJobNums(new Set()); setMyJobNumsLoaded(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await fetchMyJobNumbers(me.id);
        if (!cancelled && data) { const nums = data.map(r => r.job_number); setMyJobNums(new Set(nums)); setCache("search:myJobNums", nums); }
      } catch {}
      if (!cancelled) setMyJobNumsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- meはidだけを見る（識別子の変化で再取得しない）
  const canLike = (job) => !!job && !myJobNums.has(job.id); // 自分の求人はいいね対象外
  // ── あなたの求人メニュー（2026-08-15たきと指示「本人の求人も同じ下部ヘッダー。応募ボタンを
  //    あなたの求人に差し替え。タップでコピーと一時非公開と応募者一覧」）──
  // 実体はお仕事タブの浮遊ピルと同じRPC・同じ確認文（窓口がが増えても文言・挙動を食い違わせない）
  const [ownMenuOpen, setOwnMenuOpen] = useState(false);
  const ownCopyJob = async () => {
    setOwnMenuOpen(false);
    const { data, error } = await copyJob(selectedJob.id);
    if (error || !data?.ok) { alert("コピーに失敗しました：" + (data?.reason || error?.message || "不明")); return; }
    try { if (data.job) sessionStorage.setItem("cb_editJobPrefill", JSON.stringify(data.job)); } catch {}
    // コピーは期間のみリセット（2026-08-16たきと指示）：日程・休日は常に空＝新しく選び直す。他は全部引き継ぎ
    if (data.dates_cleared) alert("コピーしました。作業日程は引き継がないため空になっています。確認ページの「日程」から新しい日を選んでください。");
    window.location.hash = "/work/edit/" + data.job_number; // 新しい下書きを編集フローで開く
  };
  const ownUnpublishJob = async () => {
    // 再掲載＝そのまま公開（2026-08-14 承認プロセスの削除。旧「もう一度審査を通ります」は誤り）
    if (!confirm("この求人を一時非公開にしますか？\n\n・働き手から見えなくなり「作成中」に移ります（編集できます）\n・あとから再掲載できます（そのまま公開されます）\n・応募中・面接中の方は見送りになり、その旨のお知らせが届きます（採用が決まっている方はそのままです）")) return;
    const { data, error } = await unpublishJob(selectedJob.id);
    if (error || !data?.ok) { alert("一時非公開にできませんでした：" + (data?.reason || error?.message || "不明")); return; }
    setOwnMenuOpen(false);
    // open→draftでさがすから消えるので、行き先はお仕事タブ（公開中に一時非公開の帯で残る）
    window.location.hash = "/profile/employer";
  };

  // 自分の求人か（2026-07-22）：自分の求人には応募フッター（日給・応募ボタン）を出さない。
  // 一覧（myJobNums・jobsのRLS owner selectで自分の行だけ返る）から同期的に決める＝求人ごとの往復なし。
  // ownLoaded＝この判定が使える状態か。未ログインは自分の求人ではありえない＝即確定。
  // ログイン中はキャッシュがあれば即確定し、裏の再取得で最新に直る（2026-07-27の
  // 「一瞬だけ満員が映ってすぐ戻る」対策＝確定するまで出さない、は維持）
  const isOwnJob = !!(me && selectedJob && myJobNums.has(selectedJob.id));
  const ownLoaded = !me || myJobNumsLoaded;
  // 前回の一覧が残っていればまず出す→裏で最新に差し替える（2026-07-27たきと指示・遷移の待ち時間対策）
  // さがす一覧はアプリを完全に終了した後の起動でも前回内容を即描画する（2026-08-02たきと指示
  // 「サイトを落としてから入ると遅い」）。viewCache自体がlocalStorage永続（本人スコープ・
  // ログアウトで全消去・表示専用）になったので、ここはgetCacheを読むだけでよい。
  // ★復元時にdateStart/dateEndをDateへ再生する（2026-08-03クラッシュ修理）：mapJobPublicRowは
  //   Dateオブジェクトで持つが、localStorage(JSON)経由では文字列に化け、CalendarView等が落ちた
  // ★もう一つの型（2026-08-18修理）：キャッシュは【前のビルドが焼いた形】で残る。あとから足した項目は
  //   古い行に存在しないため、配列前提で読むと undefined になって画面が落ちる
  //   （実例：masked_fields は2026-08-17に追加。それ以前のキャッシュから求人詳細を開くと
  //    maskedFields.includes(...) で真っ白になった）。新しい項目を mapJobPublicRow に足したら、
  //   ここにも「無ければ既定値」を1行足すこと
  const [dbJobs, setDbJobs] = useState(() => {
    const c = getCache("search:jobs");
    return Array.isArray(c)
      ? c.map(j => ({
          ...j,
          dateStart: j.dateStart ? new Date(j.dateStart) : null,
          dateEnd: j.dateEnd ? new Date(j.dateEnd) : null,
          maskedFields: Array.isArray(j.maskedFields) ? j.maskedFields : [],
        }))
      : null;
  });
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
      const { data } = await fetchEmployerPublicJobs(selectedJob.id);
      // 今見ている求人も含めて全公開求人を出す（2026-07-16）。審査中(pending)・下書きは
      // 運営承認ゲート（憲法5条）前のため含めない——承認されれば自動でここに並ぶ
      setPastJobs(data || []);
    } catch { setPastJobs([]); }
    // 求人ごとの応募・承認・採用人数（展開概要用・失敗しても「ー」表示になるだけ）
    try {
      const { data: cnts } = await fetchEmployerPublicJobCounts(selectedJob.id);
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
    const { error } = await insertJobReport({
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
  // 後送りの待ち行列（2026-08-18 Speed-1C-1）。画面が消えたら未実行分は捨てる
  // （閉じた画面のために通信しない・Speed-1Bの原則）。
  // ★取り出しは必ずこの関数から＝アンマウントで捨てた後に作り直せる
  //   （開発時のStrictModeは mount→unmount→mount するため、使い捨てのまま残ると二度と流れない）
  const idleQueueRef = useRef(null);
  const bootQueue = () => {
    if (!idleQueueRef.current) idleQueueRef.current = createIdleQueue();
    return idleQueueRef.current;
  };
  useEffect(() => () => { idleQueueRef.current?.cancel(); idleQueueRef.current = null; }, []);
  const bootSettledRef = useRef(false);
  const [bootSettled, setBootSettled] = useState(false); // 一覧の初回取得が終わったか
  const jobsRefreshTick = useRefreshTick(REFRESH_JOBS);
  useEffect(() => {
    // 訪問者モード（2026-07-24）：jobs_publicはanon許可ので未ログインでも公開面を読める。
    // 取得・並び規則（新着上位＋ランダム・既読記録）は lib/searchJobs に一本化（玄関の先読みと共有・2026-08-02）
    (async () => {
      try {
        const mapped = await fetchPublicJobs();
        if (mapped) {
          let newIds = [];
          setDbJobs(prev => {
            // 並びの規則は lib/searchJobs の orderSearchJobs が唯一のソース（玄関の先読みと共通）。
            // 前回内容を表示中は並びを保ち、募集中を先・終了を末尾に置く（2026-08-05）
            const { list, freshNew } = orderSearchJobs(mapped, prev);
            newIds = freshNew.map(j => j.id);
            setCache("search:jobs", list);
            return list;
          });
          if (newIds.length) recordSeenNewIds(newIds);
        }
      } catch {}
      // 起動バーストの削減（2026-08-18 Speed-1C-1）：一覧の初回取得が終わった時点を
      // 「検索画面が成立した」合図にし、初期表示に要らない問い合わせをここから後ろへ送る。
      // 成否は問わない（失敗しても後続を永久に止めない）。合図は初回だけ＝復帰の再取得では立てない
      if (!bootSettledRef.current) {
        bootSettledRef.current = true; setBootSettled(true);
        // Realtimeの購読開始もここまで待たせる（2026-08-18 Speed-1C 起動衝突テスト）。
        // payloadは載せない・一回きり＝Appはこれを受けて購読を開ける（受け手はApp.jsxのrealtimeBootReady）
        try { window.dispatchEvent(new Event("cb:criticalBootSettled")); } catch {}
      }
    })();
    // meのオブジェクトでなくidを依存に（2026-08-02）：セッション復元のsetMeで識別子が毎回変わり、
    // 1起動につき全件取得が2回走っていた。
    // refreshTick＝画面の復帰の合図（2026-08-18 Speed-1B）。jobsにRealtimeは無いので合図はこれだけ。
    // 並びは orderSearchJobs が前回の並びを保つので、取り直してもカードが飛び跳ねない
  }, [me?.id, jobsRefreshTick]);
  const jobList = dbJobs || [];

  // ── 「まもなく公開」カード（2026-08-12たきと指示）──────────────────────────
  // 掲載申請済み（pending）の求人を、タップできないカードとしてさがすの末尾に並べる。
  // 出るのはトップ写真だけ＝作物・作業・地域・報酬・募集主は取得すらしない（pending_job_previews が
  // 2列しか返さない＝データ最小化）。タップは求人詳細へ行かず「まもなく公開されます」の説明だけ開く。
  // ★運営のキルスイッチ：app_settings.pending_preview_on_search='false' で即0件（デプロイ不要）
  const [pendingPreviews, setPendingPreviews] = useState(() => getCache("search:pendingPreviews") ?? []);
  const [pendingInfo, setPendingInfo] = useState(false); // 説明ボックスの開閉
  // 起動バーストから外して後送り（2026-08-18 Speed-1C-1）：一覧が出てから暇な時に1本流す。
  // このカードは一覧末尾の付け足しso、初期表示の成立条件ではない
  useEffect(() => {
    if (!bootSettled) return;
    bootQueue().push(async () => {
      const res = await fetchPendingJobPreviews();
      // 失敗時は手元の値を残す（supabase-jsはHTTPエラーでthrowしない＝errorを見る・2026-08-07規則）
      if (res.error) return;
      const list = res.data || [];
      setPendingPreviews(list);
      setCache("search:pendingPreviews", list);
    });
  }, [bootSettled, me?.id]);

  // ── レーン切替（求人／委託）＝2026-08-03たきと指示 ──────────────────────────
  // 委託タブを出す条件は lib/consignAccess.js の canSeeConsignment ただ1箇所（管理者 かつ 特約同意）。
  // 後日その1行から管理者条件を外すだけで一般公開になる（＋DB側のRLSも同時に開ける・詳細はlibのコメント）。
  // 特約の同意状況は consignment_profiles を読んで判定する。RLSが管理者限定ので、
  // 一般ユーザーで無駄な往復をしないよう「見せる可能性がある人」だけ引く
  const [consignor, setConsignor] = useState(() => getCache("search:consignor") ?? null);
  // 起動バーストから外して後送り（2026-08-18 Speed-1C-1）：委託レーンの出し分けは管理者だけの話so、
  // 初期表示の成立条件ではない。上の「まもなく公開」と同じ行列＝1本ずつ順に流れる
  useEffect(() => {
    if (!isAdmin(me)) { setConsignor(null); return; } // ★解禁時：この行も一緒に外す（読む相手を広げる）
    if (!bootSettled) return;
    let cancelled = false;
    bootQueue().push(async () => {
      const { data: { session } } = await getSession();
      if (!session || cancelled) return;
      const { data } = await fetchConsignorConsent(session.user.id);
      if (cancelled) return;
      setConsignor(data || null);
      setCache("search:consignor", data || null);
    });
    return () => { cancelled = true; };
  }, [bootSettled, me]);
  const showConsignLane = canSeeConsignment(me, consignor);
  const [lane, setLane] = useState("jobs"); // "jobs" | "consign"
  // 条件を満たさなくなった時（ログアウト・特約の版数更新）に委託レーンに取り残されない
  useEffect(() => { if (!showConsignLane && lane === "consign") setLane("jobs"); }, [showConsignLane, lane]);

  // ── 横スワイプの指連動で求人⇄委託を切替（2026-08-07たきと指示）。
  // 機構は今日ページの役割スワイプと同一（ネイティブリスナー＋contentRefへのtransform直書き＝
  // 毎フレーム再レンダーなし・方向ロック8px・50px以上で切替成立・slideKey更新でスライドイン）。
  // 委託レーンが見える人（canSeeConsignment）だけ発動＝1レーンの人は従来どおり無反応
  const laneRootRef = useRef(null);
  const laneContentRef = useRef(null);
  const laneGestureRef = useRef(null); // { x, y, lock:'h'|'v'|null }
  const laneValRef = useRef(lane); laneValRef.current = lane;
  const laneDualRef = useRef(showConsignLane); laneDualRef.current = showConsignLane;
  const [laneSlideDir, setLaneSlideDir] = useState(0); // 1=右から（委託へ）・-1=左から（求人へ）
  const [laneSlideKey, setLaneSlideKey] = useState(0); // key更新でアニメを再生
  const switchLane = (target) => {
    if (target === laneValRef.current) return;
    setLaneSlideDir(target === "consign" ? 1 : -1); // タブ並び：左=求人・右=委託
    setLaneSlideKey(k => k + 1);
    setLane(target);
  };
  const switchLaneRef = useRef(switchLane); switchLaneRef.current = switchLane;
  useEffect(() => {
    const el = laneRootRef.current; if (!el) return;
    const onStart = (ev) => {
      // オーバーレイ（シート類=.cb-lock-scroll・全画面の検索パネル=.cb-search-overlay）内で
      // 始まったタッチは奪わない（パネル操作中に背後のレーンが切り替わる事故の防止）
      if (ev.target && ev.target.closest && ev.target.closest(".cb-lock-scroll, .cb-search-overlay")) { laneGestureRef.current = null; return; }
      const t = ev.touches[0]; if (t) laneGestureRef.current = { x: t.clientX, y: t.clientY, lock: null };
    };
    const onMove = (ev) => {
      const g = laneGestureRef.current; if (!g || !laneDualRef.current) return;
      const t = ev.touches[0]; if (!t) return;
      const dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 8px動くまで判定保留
        g.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";  // 1ジェスチャ1回だけ軸を確定
      }
      if (g.lock !== "h") return; // 縦確定＝以後ノータッチ（ブラウザのスクロールに完全に譲る）
      ev.preventDefault();
      const c = laneContentRef.current; if (!c) return;
      const target = dx < 0 ? "consign" : "jobs";
      const damp = target === laneValRef.current ? 0.12 : 0.4; // 行き先が無い方向は強い抵抗（端の感触）
      c.style.transition = "none";
      c.style.transform = `translateX(${Math.max(-100, Math.min(100, dx * damp))}px)`;
    };
    const onEnd = (ev) => {
      const g = laneGestureRef.current; laneGestureRef.current = null;
      if (!g || g.lock !== "h") return;
      const c = laneContentRef.current;
      const t = ev.changedTouches && ev.changedTouches[0];
      const dx = t ? t.clientX - g.x : 0;
      const target = dx < 0 ? "consign" : "jobs";
      if (Math.abs(dx) >= 50 && target !== laneValRef.current) {
        if (c) { c.style.transition = ""; c.style.transform = ""; }
        switchLaneRef.current(target); // key更新で新コンテンツがスライドイン
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
    // 詳細ページ⇄一覧でrootの実DOMが差し替わるため、戻るたびに現在のrootへ張り直す
  }, [selectedJob]);

  // ── Airbnb風検索（2026-07-27たきと指示・骨格②の段階解禁を運営判断で前倒し）：
  // 上部ピルバー→タップで全画面パネル。なにを（作物・作業）／どこで（地域）／いつ（月）の3セクションを
  // アコーディオンで選び「検索」で確定。チップは実在の求人から生成（ダミー禁止・憲法3条）。
  // 下書き（sel*）と確定（appliedSearch）を分離＝Airbnbと同じ「検索ボタンで初めて反映」動作
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSec, setSearchSec] = useState("what"); // 展開中セクション（1つだけ開くアコーディオン）
  // 絞り込みはlocalStorageに保存＝リロード・別ページ遷移でもリセットされない（2026-07-27たきと指示）。
  // 掛かりっぱなしでもピルの要約＋✕クリアで状態は常に見える
  const [selWhats, setSelWhats] = useState(() => readStoredSearch("w"));
  const [selRegions, setSelRegions] = useState(() => readStoredSearch("r"));
  const [selMonths, setSelMonths] = useState(() => readStoredSearch("m"));
  useEffect(() => {
    writeStoredSearch(selWhats, selRegions, selMonths);
  }, [selWhats, selRegions, selMonths]);
  // リアルタイム反映（2026-07-27たきと指示）：チップを触った瞬間に一覧へ反映（検索ボタン待ちの下書き方式は廃止）。
  // パネルは半透明の暗幕ので、背後で一覧が絞られていくのが見える
  const searchActive = selWhats.length > 0 || selRegions.length > 0 || selMonths.length > 0;
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
  // 絞り込みパネルに渡す3セクション（移設前は JSX 内の配列リテラルだった。中身は同一）。
  // ★state（selWhats/…）と候補（searchWhatOpts/…）の持ち主は親のまま＝
  //   パネルは「選ばせて見せる」だけ。どの求人が残るかは上の filteredList が決める
  const searchSections = [
    { k:"what",   q:"なにを", title:"なにをする？", opts: searchWhatOpts,   sel: selWhats,   tog: togSel(setSelWhats),   label: v => v },
    { k:"region", q:"どこで", title:"どこでする？", opts: searchRegionOpts, sel: selRegions, tog: togSel(setSelRegions), label: v => "📍 " + v },
    { k:"month",  q:"いつ",   title:"いつする？",   opts: searchMonthOpts,  sel: selMonths,  tog: togSel(setSelMonths),  label: v => v + "月" },
  ];

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
        const { data } = await fetchSurveyAnswered(me.id);
        if (!cancelled) setSurveyAnswered(!!data);
      } catch { if (!cancelled) setSurveyAnswered(true); } // 取得失敗時はゲートしない（コア動作＝いいねを止めない）
    })();
    return () => { cancelled = true; };
  }, [me]);
  useEffect(() => {
    if (!me) { setSavedIds(new Set()); return; }
    (async () => {
      try {
        const { data } = await fetchSavedJobNumbers(me.id);
        setSavedIds(new Set((data || []).map(r => r.job_number)));
      } catch {}
    })();
  }, [me]);
  // 実いいね処理（アンケートゲート通過後・解除時に呼ぶ）
  const performSave = async (job) => {
    const isSaved = savedIds.has(job.id);
    setSavedIds(prev => { const next = new Set(prev); isSaved ? next.delete(job.id) : next.add(job.id); return next; });
    const { error } = isSaved
      ? await deleteSavedJob(me.id, job.id)
      : await insertSavedJob(me.id, job.id);
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
      const { error } = await insertSurvey({
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
    // 一覧の到着を待たず、該当求人だけ先に1行引いて詳細を出す（2026-08-02・求人ページの体感）。
    // ディープリンク（#/work/job/N・お仕事タブや通知からの遷移）は従来、全求人一覧の取得完了まで
    // 白いままだった。1行なら数KBで先に返る。後から一覧が届いたら上の found 経路が同じ求人で上書きする
    if (!dbJobs) {
      let cancelled = false;
      (async () => {
        try {
          const { data } = await fetchPublicJobByNumber(jn);
          if (!cancelled && data) { setSelectedJob(prev => prev || mapJobPublicRow(data)); setDetailTab(m[2] || "content"); clearApplyReturn(); }
        } catch {}
      })();
      return () => { cancelled = true; };
    }
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
    // 前回の内容（求人ごとのviewCache）をまず出す→裏で最新に差し替える（SWR・2026-08-14たきと指摘
    // 「求人者と待遇の復元が10秒」＝コールドスパイクのRPC待ちがそのまま画面の待ちだった）。
    setOwnMenuOpen(false); // 求人を切り替えたらあなたの求人メニューは閉じる
    const cacheKey = "search:jobEmp:" + selectedJob.id;
    const cached = getCache(cacheKey);
    setEmpEmployer((cached && cached.emp) || null);
    setEmpTrust((cached && cached.trust) || null);
    let cancelled = false;
    (async () => {
      // 依存のない2本は並列で（2026-08-02・更新時間の短縮：直列2往復→1往復ぶんの待ちに）
      const [profRes, trustRes] = await Promise.all([
        Promise.resolve(fetchJobEmployerProfile(selectedJob.id)).catch(() => ({ data: null })),
        Promise.resolve(fetchJobEmployerTrustInfo(selectedJob.id)).catch(() => ({ data: null })),
      ]);
      if (cancelled) return;
      const emp = (profRes.data && profRes.data[0]) || null;
      const trust = trustRes.data || null;
      // 失敗（null）の時はキャッシュ表示を上書きしない（2026-08-07規則・フェイルオープンにしない）
      if (emp) setEmpEmployer(emp);
      if (trust) setEmpTrust(trust);
      if (emp || trust) setCache(cacheKey, { emp: emp || (cached && cached.emp) || null, trust: trust || (cached && cached.trust) || null });
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.id]);
  const [myApplication, setMyApplication] = useState(null);
  // 仮応募中（第15弾・2026-07-30）：意思は預かったがプロフィールがまだ＝応募ボタンを仕上げ導線に変える
  const [myPending, setMyPending] = useState(false);
  // 自分の応募を「求人ごとに1往復」から「本人ぶん一括＋キャッシュ」へ（2026-08-03たきと指摘
  // 「満員判定が数十秒かかる」）：以前は求人を開くたびにapplicationsとpending_applicationsを
  // 引き、その到着まで応募ボタンは「確認中…」・満員表示も出せなかった。セッション復元の待ちに
  // この往復が積み増さり、回線が悪いと数十秒かかっていた。
  // 一括＝自分の応募だけ（worker_id=本人。RLSに加えて明示的に絞る＝農家として見える応募者の行を拾わない）
  const [myAppsMap, setMyAppsMap] = useState(() => { const c = getCache("search:myApps"); return (c && typeof c === "object" && !Array.isArray(c)) ? c : null; });
  const [myPendSet, setMyPendSet] = useState(() => { const c = getCache("search:myPend"); return new Set(Array.isArray(c) ? c : []); });
  const [myAppsLoaded, setMyAppsLoaded] = useState(() => { const c = getCache("search:myApps"); return !!(c && typeof c === "object" && !Array.isArray(c)); });
  useEffect(() => {
    if (!me) { setMyAppsMap(null); setMyPendSet(new Set()); setMyAppsLoaded(false); return; }
    let cancelled = false;
    (async () => {
      try {
        // 仮応募（第15弾）も一緒に見る。RLS「pending own」で自分の行しか返らない
        const [appRes, pendRes] = await Promise.all([
          // canceled（取り消し済み・2026-08-16）は除く＝取り消した求人は「未応募」に戻り再応募できる
          fetchMyApplications(me.id),
          Promise.resolve(fetchMyPendingApplications(me.id)).then(r => r, () => ({ data: null })),
        ]);
        if (cancelled) return;
        // ★エラー時は上書きしない（2026-08-07）：503・タイムアウトはthrowされず {data:null, error} で
        //   解決するため、旧実装はDB不調のたびに空のmapを焼き付け「応募が取り消されたように見える」
        //   （応募済みの求人で応募ボタンが復活する）事故になっていた。失敗時は手元の値のまま
        if (!appRes.error && appRes.data) {
          const map = {};
          appRes.data.forEach(r => { map[r.job_number] = { id: r.id, status: r.status }; });
          setMyAppsMap(map); setCache("search:myApps", map);
        }
        if (!pendRes.error && pendRes.data) {
          const pend = pendRes.data.map(r => r.job_number);
          setMyPendSet(new Set(pend)); setCache("search:myPend", pend);
        }
      } catch { /* 取得できなければキャッシュのまま（下の確定判定でloadedにはする） */ }
      if (!cancelled) setMyAppsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- meはidだけを見る（識別子の変化で再取得しない）
  // 開いている求人の応募状況は、上の一覧から同期的に取り出す（求人ごとの往復なし）。
  // 取消はこの後 patchMyApp で一覧ごと直すため、裏の再取得で巻き戻らない
  useEffect(() => {
    if (!selectedJob || !me) { setMyApplication(null); setMyPending(false); return; }
    setMyApplication((myAppsMap && myAppsMap[selectedJob.id]) || null);
    setMyPending(myPendSet.has(selectedJob.id));
  }, [selectedJob?.id, me?.id, myAppsMap, myPendSet]); // eslint-disable-line react-hooks/exhaustive-deps -- selectedJobはid、meはidだけを見る
  // 自分の応募が分かっているか（2026-07-27・「満員」が一瞬映る修理）。
  // 未確定のままhideApplyを決めると、応募済みの人にも一瞬「満員」が出てから本来の表示に戻る
  const myAppLoaded = !me || myAppsLoaded;
  // 応募状況の手元の変更（取消・裏取りの結果）を一覧にも反映する＝画面とキャッシュを1つの現実に保つ。
  // 最新値はrefで持つ（effect内から呼ぶとstateのクロージャが古くなり、同時に来た更新を落とすため）
  const myAppsRef = useRef(myAppsMap);
  useEffect(() => { myAppsRef.current = myAppsMap; }, [myAppsMap]);
  const patchMyApp = (jobNumber, next) => {
    const m = { ...(myAppsRef.current || {}) };
    if (next) m[jobNumber] = next; else delete m[jobNumber];
    myAppsRef.current = m;
    setMyAppsMap(m);
    setCache("search:myApps", m);
  };
  const myPendRef = useRef(myPendSet);
  useEffect(() => { myPendRef.current = myPendSet; }, [myPendSet]);
  const patchMyPend = (jobNumber, isPending) => {
    const s = new Set(myPendRef.current);
    if (isPending) s.add(jobNumber); else s.delete(jobNumber);
    myPendRef.current = s;
    setMyPendSet(s);
    setCache("search:myPend", [...s]); // キャッシュは配列で持つ（Setは入れない・2026-08-03の規則）
  };
  // 開いた求人だけは裏で最新に確かめる（2026-08-03）：一括取得のあとに変わった状態
  //（応募直後・農家が承認した・別端末で取り消した）を取り込む。★表示は止めない＝
  // myAppLoadedはキャッシュで既に確定しているので、満員も応募ボタンも待たされない
  useEffect(() => {
    if (!selectedJob || !me) return;
    let cancelled = false;
    (async () => {
      try {
        const [appRes, pendRes] = await Promise.all([
          // canceledを除く（2026-08-16）：取り消し→再応募で同じ求人に2行になり得るため、
          // 除かないと maybeSingle が複数行エラーになる（現役の応募は部分ユニークで常に1行）
          fetchMyApplicationForJob(selectedJob.id, me.id),
          Promise.resolve(fetchMyPendingForJob(selectedJob.id, me.id)).then(r => r, () => ({ data: null, error: true })),
        ]);
        if (cancelled) return;
        // ★エラー時は上書きしない（2026-08-07・上の一括取得と同じ理由）：旧実装は appRes.data||null を
        //   無条件に書き、DBが503を返している数秒の間だけ「応募済み」が消えて取り消されたように見えていた
        if (!appRes.error) {
          setMyApplication(appRes.data || null);
          patchMyApp(selectedJob.id, appRes.data || null);
        }
        if (!pendRes.error) {
          setMyPending(!!pendRes.data);
          patchMyPend(selectedJob.id, !!pendRes.data);
        }
      } catch { /* 取れなければ手元の値のまま（表示は既に出ている） */ }
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.id, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- selectedJobはid、meはidだけを見る

  // 集合場所の詳細ページ表示は削除（2026-07-16）。承認後の共有はチャットの「はじめる前の確認」カード（job_meeting_place RPC）に一本化

  const [applying, setApplying] = useState(false);
  // プロフィールゲートのモーダル状態。null=非表示 / {mode:"soft"}=クライアント側の空チェック（両方選べる）
  // / {mode:"hard", hasNickname, qaAnswered, qaRequired}=サーバー側の必須ゲート（プロフィールを書く、のみ）

  const applyAvailRef = useRef(null);

  // apply_to_job本体（プロフィールゲート通過後、または「このまま応募する」選択後に呼ぶ）
  // 仮応募として預かる（2026-08-17たきと指示「他は仮応募」）。応募ボタン（条件を満たさない時）と
  // 本応募that profile_incomplete を返した時の両方から呼ぶ＝結末を1つに合流させる。
  // ★ここからは doApply を呼ばない（doApply→goPending→doApply の往復を作らないため）。
  //   預かれなかった時は false を返し、呼び出し側が次の手を決める。
  const goPending = async () => {
    // 来られる日（期間求人のみ）を仮応募でも渡す（2026-08-06）。渡さないと昇格時に来られる日が
    // 欠落し、正規apply_to_jobならdates_requiredで弾かれる期間応募が成立してしまう
    const { data: pend } = await createPendingApplication(selectedJob.id, applyAvailRef.current);
    setApplying(false);
    // 新規の仮応募＝ページでなくアニメーション（②・2026-08-07）。App側thatこのフラグを消費して
    // 祝祭＋トースト＋応募状況への着地に切り替える。フラグ無しの /apply/pending は従来のチェックリスト
    if (pend && pend.ok) { try { sessionStorage.setItem("cb_pendingNew", "1"); } catch {} window.location.hash = "/apply/pending"; return true; }
    if (pend && pend.reason === "already_applied") { window.location.hash = "/apply/done"; return true; }
    if (pend && pend.reason === "dates_required") { alert("この求人は期間募集です。来られる日（または「期間中いつでもOK」）を選んでから応募してください。"); return true; }
    return false;
  };

  const doApply = async () => {
    setApplying(true);
    try {
      const { data, error } = await applyToJob(selectedJob.id, applyAvailRef.current);
      setApplying(false);
      if (error) { alert("応募に失敗しました。時間をおいて再度お試しください。"); return; }
      if (data && data.reason === "dates_required") { alert("この求人は期間募集です。来られる日（または「期間中いつでもOK」）を選んでから応募してください。"); return; }
      if (data && data.ok) {
        try { if (data.already) sessionStorage.setItem("cb_applyAlready","1"); else sessionStorage.removeItem("cb_applyAlready"); } catch {}
        // 応募祝祭のビジュアル素材（アイコン＋求人カード）の受け渡しは廃止した（2026-08-19
        // たきと指示「アニメーションにアイコンや絵は使うな」）。祝祭は題字だけで出る＝
        // 素材を作る必要がなくなり、ここでの1往復（fetchMyWorkerNickname）も不要になった
        window.location.hash = "/apply/done";
      }
      else if (data && data.reason === "not_logged_in") { setApplyReturn(selectedJob.id); if (onRegister) onRegister(); }
      else if (data && data.reason === "own_job") { alert("自分の求人には応募できません。"); }
      else if (data && data.reason === "job_not_open") { alert("この求人は現在募集を受け付けていません。"); }
      // アカウント停止中（2026-08-17）：仮応募も昇格も止まる（DB側の壁）ので、理由をそのまま伝える。
      // 従来は「応募できませんでした。」に落ちて、なぜ通らないのか本人に分からなかった
      else if (data && data.reason === "account_suspended") { alert("アカウントが停止中のため、応募できません。運営（t5fki6643qty@gmail.com）までご連絡ください。"); }
      // プロフィールの3項目が足りない＝止めずに仮応募として預かる（2026-08-17たきと指示「他は仮応募」）。
      // 通常は応募ボタンthat先に is_worker_profile_ready を見て仮応募へ回すので、ここに来るのは
      // 画面を開いている間に項目が空になった等の競合だけ。同じ結末（仮応募）に合流させる
      else if (data && data.reason === "profile_incomplete") { await goPending(); }
      // 本人情報（お名前・生年月日・規約同意）の登録that未了＝登録画面へ送る。
      // 18歳確認と同意記録の唯一の場所so、ここは仮応募にせず登録を先に済ませてもらう
      else if (data && data.reason === "not_registered") { setApplyReturn(selectedJob.id); window.location.hash = "/account"; }
      // profile_under_review（自己紹介の審査待ちで応募を止める）の分岐は削除した（2026-08-17）。
      // 承認プロセスの削除（2026-08-14）で自由記述は保存＝即公開になり、apply_to_job はこの理由を返さない
      // ＝到達不能なうえ「審査待ちです」は嘘になるため。万一返っても下の汎用メッセージで受ける
      else { alert("応募できませんでした。"); }
    } catch { setApplying(false); alert("応募に失敗しました。"); }
  };

  const handleApply = async () => {
    if (applying || !selectedJob) return;
    setApplying(true);
    try {
      const { data: { session } } = await getSession();
      if (!session) {
        setApplying(false);
        setApplyReturn(selectedJob.id);
        if (onRegister) onRegister();
        return;
      }
      // ①(account_holders)未登録なら重い登録へ。戻り先を退避。
      const { data: ah } = await fetchAccountHolderId(session.user.id);
      if (!ah) {
        setApplying(false);
        setApplyReturn(selectedJob.id);
        window.location.hash = "/account";
        return;
      }
      // 仮応募（第15弾・2026-07-30たきと指示）：必須項目がそろっていない人は、応募の意思だけ先に預かる。
      // 判定の基準は is_worker_profile_ready（DB）1本＝画面ごとに別の必須セットを作らない。
      // 条件は3項目＝ニックネーム・居住地・自己紹介（緊急連絡先は2026-08-19に任意へ）。
      // 昇格の引き金は本人のプロフィール完成だけ（運営の自由記述審査は間に立たない）
      const ready = await fetchWorkerReady();
      if (!ready.ready) {
        // 預かれなかった時（停止中・自分の求人・募集終了）は、本応募を試して理由をサーバーに言わせる
        if (!(await goPending())) await doApply();
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
      const { data, error } = await cancelApplication(myApplication.id);
      setApplying(false);
      // ok（already=既に取り消し済み含む）／not_found＝行が既に無い（旧DELETE時代の残り）＝どちらも取り消し済み扱い。
      // 2026-08-16からは削除でなく status='canceled' の記録＝マップから外せば「未応募」に戻り再応募できる
      if (!error && data && (data.ok || data.reason === "not_found")) { setMyApplication(null); patchMyApp(selectedJob.id, null); }
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
  const applyBtnLabel = appPending ? <>確認中<Dots /></>
    : applying ? (myAppStatus === "applied" ? <>取り消し中<Dots /></> : <>送信中<Dots /></>)
    : myAppStatus === "approved" ? "承認されました — チャットを開く"
    : myAppStatus === "rejected" ? "今回は見送りとなりました"
    : myAppStatus === "applied" ? "応募済み — 取り消す"
    // 仮応募中（第15弾）：意思は預かり済み。次の一手はプロフィールの仕上げ
    : (!myAppStatus && myPending) ? "仮応募中 → プロフィールを仕上げる"
    // 新規応募の基本ラベルは「日程の確認」（2026-08-16たきと指示「右下の応募ボタンは日程の確認に差し替え」）：
    // タップの実体は応募の送信でなく確認ボックス（3面・最後がが日程選択と応募）を開くことので、その通りの顔にする
    : "日程の確認";
  const applyBtnStyle = myAppStatus === "rejected" ? { background:"#EBEBEB", color:"#717171" }
    : myAppStatus === "applied" ? { background:"#F7F7F7", color:"#717171", border:"1px solid #EBEBEB" }
    : (!myAppStatus && myPending) ? { background:"#C77700" }
    : {};
  // 2026-07-13 労働局確認済み・当事者間の直接連絡は適法（CLAUDE.md参照）
  // 応募確認ボックス（2026-07-18）：新規応募はボタン直送信でなく、内容確認のボックスを展開してから
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  // 3面切り替え（2026-08-16たきと指示「3つの切り替え。次へと戻るを設置」）：0=承認の流れ図／1=説明／2=日程・応募。
  // 期間求人のみ4面目あり（2026-08-16たきと指示「いつでもOKと日程選択のどちらも最終確認をして」）：
  // 2=日程の選択（ここでは応募しない）→3=最終確認（選んだ内容を見せて「応募する」）。単日は2が最終確認のまま
  const [applyConfirmStep, setApplyConfirmStep] = useState(0);
  const [applyChoice, setApplyChoice] = useState(null); // 期間求人の選択："any"（いつでもOK）／"dates"（日程選択）／null
  const [applyImgZoom, setApplyImgZoom] = useState(false); // 承認の流れ図の大画面表示（タップで拡大・2026-08-16）
  // 応募時の来られる日宣言（2026-07-24）：期間求人（date_end有り・単日でない）だけ、応募シートで日程を選ぶ。
  // applyAvailRefに最終値（"any"／日付配列／null）を同期的に入れてからhandleApply＝ゲート往復でも保持できる
  const [applyDates, setApplyDates] = useState([]); // 選択中の特定日（"YYYY-MM-DD"）
  useEffect(() => { setApplyConfirmOpen(false); setApplyConfirmStep(0); setApplyChoice(null); setApplyImgZoom(false); setApplyDates([]); applyAvailRef.current = null; }, [selectedJob?.id]);
  const isPeriodJob = !!(selectedJob && selectedJob.dateEndRaw && selectedJob.dateEndRaw !== selectedJob.dateStartRaw);
  // 期間内の日付を "YYYY-MM-DD" 配列で列挙（開始〜終了・両端含む）
  const periodDays = (() => {
    if (!isPeriodJob) return [];
    // 休日（jobs.holidays・2026-08-03）は「来られる日」の候補から除く＝休日に応募日を宣言できない
    const hs = new Set(Array.isArray(selectedJob.holidays) ? selectedJob.holidays : []);
    const out = []; const [ys, ms, ds] = selectedJob.dateStartRaw.split("-").map(Number);
    const start = new Date(ys, ms - 1, ds); const end = new Date(selectedJob.dateEndRaw + "T00:00:00");
    let guard = 0;
    for (let d = new Date(start); d <= end && guard < 400; d.setDate(d.getDate() + 1), guard++) { const y = ymdLocal(d); if (!hs.has(y)) out.push(y); }
    return out;
  })();
  const [signupOpen, setSignupOpen] = useState(false); // 未ログイン画面の文言用（app_settings.signup_open・既定false=招待制）
  useEffect(() => { fetchSignupOpen().then(({ data }) => { if (data === true) setSignupOpen(true); }).catch(()=>{}); }, []);
  // 訪問者（未ログイン）が応募・いいね・投稿等をタップした時の案内（2026-07-24・隠さず案内する）
  // 「閉じる」で普通に閉じる（2026-07-27たきと指示）：以前は閉じた直後に#/loginへ飛ばしていたため、
  // 案内を読んだだけで見ていた求人から引き剥がされていた。案内だけ出して画面はそのまま残す。
  // 文面も「登録画面へ進みます」を撤回（進まないので）。応募・いいね両方の入口から呼ばれるsо共通の言い回しにする
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
    : (() => { setApplyConfirmStep(0); setApplyChoice(null); setApplyConfirmOpen(true); });
  // 募集終了（2026-07-24）：設定した採用人数に達した（満員＝filled）／作業日程が過ぎた（expired）求人は
  // 応募導線（下部フッター・応募ボタン）を出さない＝新規の募集を締め切る。
  // ただし既に応募・承認・見送りの関係がある本人には、状況確認とチャット導線を残すため従来どおり表示する。
  const recruitClosed = !!(selectedJob && (selectedJob.filled || selectedJob.expired || selectedJob.closed));
  // ★自分の応募が分かるまでは締切扱いにしない（2026-07-27たきと報告「一瞬だけ満員が映る」）。
  //   未取得の間はmyAppStatusがundefinedので、応募済みの人にも一度「満員」を出してから戻っていた
  const hideApply = recruitClosed && myAppLoaded && !myAppStatus;
  // 満員の2段階（2026-08-14たきと指示・JobCardの帯と同じ区別）：満員のみ＝募集終了／満員かつ終了済み＝掲載終了
  const closedLabel = selectedJob?.filled
    ? ((selectedJob.closed || selectedJob.expired) ? "この求人は掲載を終了しました（満員）" : "この募集は終了しました（満員）")
    : selectedJob?.closed ? "この募集は終了しました" : "この募集は終了しました（期間終了）";
  // 下部フッターは幅が狭いので短い言葉に差し替える（2026-07-27たきと指示）。
  // 「応募する」の位置＝そのままボタンの場所に「満員」（期間終了なら「募集終了」）を出す
  const closedLabelShort = selectedJob?.filled ? "満員" : "募集終了";  // closed も期間終了も同じ短縮語

  return (
    <div>
      {!selectedJob && (<>
      {/* 見出し「近くの仕事を探す」は削除（2026-07-27たきと指示）。現在地は下部ナビの点灯が示すため冗長。
          支払いの注記は求人一覧の一番下へ移植（下記） */}

      {/* ── レーンタブ（求人／委託・2026-08-03たきと指示）：契約の性質が違う別レーンので絞り込みでなくタブで並べる。
           委託タブは canSeeConsignment（管理者 かつ 特約同意）を満たす人にだけ現れる。
           条件を満たさない人にはタブ自体が出ない＝従来どおり求人一覧のまま（1レーンなら非表示） ── */}
      {/* ── スワイプ容器（2026-08-07たきと指示・指連動でレーン切替）。タブは容器内・アニメの外＝動かない。
           1レーンの人もrootは張るがタッチ判定がlaneDualRefで眠る＝従来どおり無反応 ── */}
      <div ref={laneRootRef} style={{ overflowX:"hidden", touchAction:"pan-y" }}>
      <SearchLaneTabs value={lane} onChange={switchLane}
        lanes={showConsignLane ? [{ k:"jobs", label:"求人" }, { k:"consign", label:"委託" }] : [{ k:"jobs", label:"求人" }]} />
      {/* ドラッグ追従はlaneContentRefへのtransform直書き（再レンダーなし）。切替成立時はkey更新でスライドイン再生 */}
      <div key={laneSlideKey} ref={laneContentRef} style={laneSlideDir ? { animation: `${laneSlideDir > 0 ? "cbSlideInR" : "cbSlideInL"} .28s ease` } : undefined}>

      {/* 委託レーン：一覧だけを出す（絞り込みバー・支払いの注記は求人の話ので出さない） */}
      {lane === "consign" && <ConsignmentSearchList />}

      {lane === "jobs" && (<>
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
      {/* ── まもなく公開（2026-08-12たきと指示）：掲載申請済みの求人を「タップできないカード」で並べる。
           見せるのはトップ写真だけ（RPCが2列しか返さない）。タップ＝求人詳細へ行かず説明ボックスだけ開く。
           絞り込み（作物・地域・月）の対象にしない＝条件になる情報を持っていないため（条件を推測しない） ── */}
      {pendingPreviews.length > 0 && (
        <div style={{ marginTop:8 }}>
          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#0E8A6B", margin:"0 0 10px" }}>まもなく公開（{pendingPreviews.length}）</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:10 }}>
            {pendingPreviews.map(p => (
              <button key={p.job_number} onClick={()=>setPendingInfo(true)} aria-label="まもなく公開される求人"
                className="f-sans" style={{ display:"block", width:"100%", padding:0, border:"none", background:"transparent", cursor:"pointer", position:"relative" }}>
                <div style={{ position:"relative", borderRadius:16, overflow:"hidden", background:"#F7F7F7" }}>
                  <img loading="lazy" src={p.photo} alt="" style={{ width:"100%", aspectRatio:"1 / 1", objectFit:"cover", display:"block" }} />
                  {/* 白いすりガラスの帯：写真は見せるが「まだ応募できない」ことを目で分からせる */}
                  <div style={{ position:"absolute", inset:0, background:"rgba(255,255,255,0.30)", backdropFilter:"blur(1.5px)", WebkitBackdropFilter:"blur(1.5px)", display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
                    <span className="f-sans" style={{ background:"rgba(14,138,107,0.92)", color:"#fff", fontSize:12, fontWeight:800, letterSpacing:".04em", padding:"6px 14px", borderRadius:8, boxShadow:"0 2px 8px rgba(0,0,0,0.25)" }}>まもなく公開</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 支払いの注記（2026-07-27たきと指示で最上部から求人一覧の一番下へ移植）。
          一覧全体の原則案内なので個別求人の保存値ではなく共通定数（現在の固定ポリシー）から導出（2026-08-02） */}
      <div style={{ padding:"7px 12px", background:"#F7F7F7", borderRadius:8, marginTop:12 }}>
        <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>
          お支払いは、{PAY_TIMING_LABELS[CURRENT_PAY_POLICY.payTiming]}の{PAY_METHOD_LABELS[CURRENT_PAY_POLICY.payMethod]}が原則です。
        </p>
      </div>
      </>)}
      </div>
      {/* 検索バー・検索パネル（position:fixed）はスワイプ容器のtransformの外に置く：
          祖先にtransformがあるとfixedの基準が画面でなくなる（2026-07-14既知の罠）ため。
          fixed同士なので描画位置は従来と同一 */}
      {lane === "jobs" && (<>
      {/* ── 検索バー（浮遊ピル） → features/jobs/search/filters/SearchFilterPanel.jsx ── */}
      <SearchFab active={searchActive} summary={searchSummary} count={filteredList.length}
        onOpen={()=>{ setSearchOpen(true); setSearchSec("what"); }} onClear={clearSearch} />

      {/* ── 検索パネル → features/jobs/search/filters/SearchFilterPanel.jsx（表示だけ・条件は上の searchSections/filteredList が持つ） ── */}
      <SearchFilterPanel
        open={searchOpen} onClose={()=>setSearchOpen(false)}
        sections={searchSections} section={searchSec} onSection={setSearchSec}
        onClear={clearSearch} resultCount={filteredList.length} />
      </>)}
      </div>
      </>)}

      {/* 「まもなく公開」の説明ボックス（2026-08-12たきと指示）：カードのタップで開く唯一の行き先。
          求人の中身も募集主も見せない＝働き手にはまだ「もうすぐ何かが出る」ことだけを伝える。
          cb-lock-scroll＝レーンの横スワイプにタッチを奪われない（2026-08-07のガードと同じ作法） */}
      {pendingInfo && (
        <div onClick={()=>setPendingInfo(false)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"28px 24px 24px", maxWidth:360, width:"100%", textAlign:"center", position:"relative", boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize:48, marginBottom:10 }}>🌱</div>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 16px" }}>まもなく公開されます</p>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.9, margin:"0 0 6px" }}>この求人は、公開の準備が整いしだい、ここに並びます。</p>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.9, margin:0 }}>公開されると、内容を見て応募できるようになります。</p>
          </div>
        </div>
      )}

      {/* ── 詳細ページ ── */}
      {selectedJob && (<>
        {/* .appear(transform保持)の外に置く＝fixedの基準を画面に保つ（2026-07-16スクロール追従修理） */}
          {/* ←戻る／♡いいね：同じ高さの浮遊固定ボックス（スクロール追従・2026-07-16） */}
        {/* カレンダー（今日ページ）から来た時は戻るボックスを出さない（2026-07-27たきと指示）：
            下部ナビのカレンダータブが戻り道ので浮遊ボックスは重複。他の出どころ（チャット・応募状況・一覧）では従来どおり出す */}
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
        }}><span className="cb-like-heart" style={{ display:"inline-block", fontSize:18 }}>{savedIds.has(selectedJob.id) ? "♥" : "♡"}</span>{savedIds.has(selectedJob.id) ? "いいね済み" : "いいね"}</button>
        )}
        <div className="appear job-detail-body-mobile">
          {/* 通報リンク（いいねの上=ページ先頭右）。自分の求人には出さない（2026-08-11たきと指示
              「戻る以外のボタンを設置するな」＝新着の応募ページから開く自分の求人。
              自分の求人を自分で報告する意味がも無いので、出どころに関係なく isOwnJob で伏せる） */}
          {me && !isOwnJob && (
            <div className="job-detail-back-btn" style={{ textAlign:"right", marginBottom:8 }}>
              <button onClick={()=>setShowReportModal(true)} className="f-sans" style={{
                background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                fontSize:11, color:"#717171", textDecoration:"underline", padding:"2px 4px",
              }}>⚑ この求人を報告する</button>
            </div>
          )}

          <JobPhotoGallery job={selectedJob} employer={empEmployer} photosLooped={photosLooped} activeSlide={activeSlide} scrollerRef={photoScrollerRef} onScroll={handlePhotoScroll} />

          {/* 仕事の内容 / 保険 / 質問 タブ（第10弾・2026-07-22）。中身は横スワイプでも切替（2026-07-27） */}
          {/* 保険は掲載時凍結のinsuranceSnapshotのみを見る（2026-08-02・プロフィール現在値へのフォールバック禁止）。
              snapshotが無いレガシー求人はタブ非表示＋直リンク時は「保険情報を確認できません」 */}
          <ContentQSwipeArea value={detailTab} onChange={setDetailTab} showInsurance={Array.isArray(selectedJob.insuranceSnapshot?.items) && selectedJob.insuranceSnapshot.items.length > 0}>
          <ContentQTabs value={detailTab} onChange={setDetailTab} showInsurance={Array.isArray(selectedJob.insuranceSnapshot?.items) && selectedJob.insuranceSnapshot.items.length > 0} />
          {detailTab === "questions" ? (
            <JobQuestions jobNumber={selectedJob.id} me={me} />
          ) : (detailTab === "insurance" && !selectedJob.insuranceSnapshot) ? (
            <p className="f-sans" style={{ fontSize:13, color:"#717171", padding:"24px 4px" }}>保険情報を確認できません</p>
          ) : (detailTab === "insurance" && Array.isArray(selectedJob.insuranceSnapshot?.items) && selectedJob.insuranceSnapshot.items.length > 0) ? (
            <InsurancePanel employer={{ insurance_items: selectedJob.insuranceSnapshot.items, insurance_notes: selectedJob.insuranceSnapshot.notes }} />
          ) : (<>
          {/* ヘッダー */}
          <div style={{ marginBottom:20 }}>
            {/* タイトルの場所＝集合場所（2026-08-03たきと指示）：ログイン済み利用者には番地まで含む正式な住所。
                訪問者はDBマスクによりworkAddress/townが空で届く（市区町村まで）。
                伏せ字は【町域だけ】に絞る（2026-08-17たきと指示「町域だけモザイク処理」）＝
                市区町村の後ろに1つだけ置く。番地の伏せ字は会員向けの表示のみに使う（訪問者には並べない）。
                町域は masked_fields に載っている時だけ描く＝町域が未設定の求人に偽のモザイクを出さない */}
            <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>
              {selectedJob.crop} {selectedJob.task}{selectedJob.region ? `｜${selectedJob.region}` : ""}
              {selectedJob.region && Array.isArray(selectedJob.maskedFields) && selectedJob.maskedFields.includes("town") && <MaskedText label="町域から先の住所" chars={4} />}
              {me && selectedJob.region && <MaskedAddress value={selectedJob.workAddress} unlocked={true} exists={selectedJob.hasWorkAddress} />}
            </h2>
            {/* 初心者大歓迎・リピート即決＋待遇はタイトル下にも表示（2026-07-16・求人カードと同じバッジ） */}
            {/* 待遇は掲載時に確定保存されたjobs.perksのみを見る（2026-08-02・プロフィール現在値とのマージ廃止） */}
            {(selectedJob.beginnerOk || selectedJob.experiencedPreferred || selectedJob.instantApproveRepeat || perkBadges(selectedJob.perks).length > 0) && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
                <JobFlagBadges beginner={selectedJob.beginnerOk} expert={selectedJob.experiencedPreferred} repeat={selectedJob.instantApproveRepeat} />
                {perkBadges(selectedJob.perks).map(b => (
                  <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{b}</span>
                ))}
              </div>
            )}
          </div>

          {/* 2カラム: 左=情報 / 右=応募パネル */}
          <div className="job-detail-2col">
            {/* 左カラム */}
            <div>
              <JobKeyFacts job={selectedJob} />

              <JobEmployerCard job={selectedJob} employer={empEmployer} trust={empTrust} onOpenIntro={setFarmIntroOpen} />

              <JobDescription job={selectedJob} />

              <JobDangerZones job={selectedJob} onPhoto={setDangerLightbox} />
            </div>

            <ApplyPanel selectedJob={selectedJob} applyPanelRef={applyPanelRef} maxPay={maxPay} hideApply={hideApply} applying={applying} applyBtnOnClick={applyBtnOnClick} applyBtnDisabled={applyBtnDisabled} applyBtnStyle={applyBtnStyle} applyBtnLabel={applyBtnLabel} closedLabel={closedLabel} />
          </div>

          {/* 募集者情報ボックスは削除（2026-08-03たきと指示・法定表示の警告提示のうえ本人判断）。
              住所は農園紹介プレビューの氏名下（FarmerTrustCard・recruiter_address）へ移設済み。
              募集者名・連絡先の常設表示は廃止（データはjobs転写・job_employer_profileに残存＝表示のみの削除） */}

          <JobLocationSection job={selectedJob} me={me} />

          {/* 農園紹介セクションはページから削除（2026-07-16）。内容は農家カードのアイコン・名前タップのボックスに集約 */}

          <JobReviews job={selectedJob} sort={reviewSort} onSort={setReviewSort} showAll={showAllReviews} onShowAll={setShowAllReviews} />

          <RelatedJobs currentJob={selectedJob} jobList={jobList} savedIds={savedIds} canLike={canLike} onToggleSave={toggleSave} />

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

      <ApplyBarPC selectedJob={selectedJob} showApplyBar={showApplyBar} isOwnJob={isOwnJob} ownLoaded={ownLoaded} hideApply={hideApply} applying={applying} applyBtnOnClick={applyBtnOnClick} applyBtnDisabled={applyBtnDisabled} applyBtnStyle={applyBtnStyle} applyBtnLabel={applyBtnLabel} closedLabel={closedLabel} />
      {/* 本人の求人にも同じ下部バーを出す（2026-08-15たきと指示）：応募ボタンの位置に「あなたの求人」。
          タップで下から操作シート（コピー／一時非公開／応募者一覧） */}
      {selectedJob && showApplyBar && ownLoaded && isOwnJob && (
        <div className="pc-apply-bar" style={{
          position:"fixed", bottom:0, left:0, right:0, zIndex:500,
          background:"#fff", borderTop:"1px solid #EBEBEB",
          padding:"16px 24px", boxShadow:"0 -4px 16px rgba(0,0,0,0.08)",
          alignItems:"center", justifyContent:"space-between", gap:24,
        }}>
          <span className="f-mono" style={{ fontSize:18, fontWeight:800, color:"#222" }}>{payLabel(selectedJob)}</span>
          <button onClick={()=>setOwnMenuOpen(true)} className="btn-primary f-sans"
            style={{ padding:"14px 32px", fontSize:15, fontWeight:700, borderRadius:14, whiteSpace:"nowrap" }}>あなたの求人</button>
        </div>
      )}

      <ApplyBarMobile selectedJob={selectedJob} isOwnJob={isOwnJob} ownLoaded={ownLoaded} setOwnMenuOpen={setOwnMenuOpen} hideApply={hideApply} applying={applying} applyBtnOnClick={applyBtnOnClick} applyBtnDisabled={applyBtnDisabled} applyBtnStyle={applyBtnStyle} applyBtnLabel={applyBtnLabel} closedLabelShort={closedLabelShort} />
      {/* あなたの求人の操作シート：コピー／一時非公開（公開中のみ）／応募者一覧。
          cb-lock-scroll＝表示中は下部バー・☰がが隠れる（既存規格） */}
      {selectedJob && isOwnJob && ownMenuOpen && (
        <div onClick={()=>setOwnMenuOpen(false)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:"20px 20px 0 0", padding:"20px 16px calc(20px + env(safe-area-inset-bottom, 0px))", width:"100%", maxWidth:560, boxSizing:"border-box" }}>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 12px" }}>あなたの求人 #{selectedJob.id}</p>
            <div style={{ display:"grid", gap:8 }}>
              <button onClick={ownCopyJob} className="f-sans" style={{ padding:"14px", fontSize:14, fontWeight:700, background:"#fff", color:"#00A86B", border:"1.5px solid #00A86B", borderRadius:12, cursor:"pointer" }}>コピーして新しい求人を作る</button>
              {!selectedJob.closed && (
                <button onClick={ownUnpublishJob} className="f-sans" style={{ padding:"14px", fontSize:14, fontWeight:700, background:"#fff", color:"#C77700", border:"1.5px solid #FFB020", borderRadius:12, cursor:"pointer" }}>一時非公開にする</button>
              )}
              <button onClick={()=>{ setOwnMenuOpen(false); window.location.hash = "/profile/employer/applicants"; }} className="f-sans" style={{ padding:"14px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>応募者一覧を見る</button>
            </div>
          </div>
        </div>
      )}

      {/* 応募確認ボックス（2026-07-18）：応募ボタンタップで展開。承認制の説明＋下部に「戻る」「応募する」。
          意匠はお知らせボックスの規格（左詰め・緑太縁3px・タイトルジャンプ・横線・上限30px/下限フッター+40px・本文18）。
          cb-lock-scroll＝展開中は背後ページのスクロールを固定（2026-08-15たきと指示）＋レーンの横スワイプにタッチを奪われない（仮応募案内ボックスと同じ作法） */}
      <ApplyConfirmBox selectedJob={selectedJob} applyConfirmOpen={applyConfirmOpen} setApplyConfirmOpen={setApplyConfirmOpen} applyConfirmStep={applyConfirmStep} setApplyConfirmStep={setApplyConfirmStep} applyChoice={applyChoice} setApplyChoice={setApplyChoice} applyDates={applyDates} setApplyDates={setApplyDates} setApplyImgZoom={setApplyImgZoom} applyAvailRef={applyAvailRef} isPeriodJob={isPeriodJob} periodDays={periodDays} applying={applying} handleApply={handleApply} />

      {/* 承認の流れ図の大画面表示（2026-08-16たきと指示「承認の画像はタップで大画面に」）。
          ★画面に収める表示（maxWidth/maxHeight）だと文字が小さく、読むにはピンチ拡大が要る。
          このサイトのviewportはピンチでページ全体が拡大される＝閉じた後も倍率が残り「一部しか見えない」
          事故になった（2026-08-16たきと報告）。ので 最初から読める大きさ（幅min(200vw,1200px)）で描き、
          指でずらして見るパン方式に変更＝ピンチ不要。✕と余白タップで閉じる（画像タップでは閉じない
          ＝ずらす操作の途中で誤って閉じないため。✕なし規約の例外・理由はこれ） */}
      {applyImgZoom && (
        <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:10500, background:"rgba(0,0,0,0.92)", animation:"fadeIn .2s ease" }}>
          <div onClick={()=>setApplyImgZoom(false)}
            ref={el => { if (el) { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; } }}
            style={{ position:"absolute", inset:0, overflow:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", display:"flex" }}>
            {/* margin:auto＝小さければ中央・はみ出せば端から全部見える（flex中央寄せだと左端が切れる）。
                aspectRatio＝読み込み前から高さが確定し、中央スクロール初期化がズレない */}
            <img onClick={e=>e.stopPropagation()} src="/apply-approval-flow.jpg" alt="承認の流れ：応募者のプロフィールを見て、承認するか決めます"
              width={1000} height={750} style={{ display:"block", margin:"auto", width:"min(200vw, 1200px)", maxWidth:"none", flexShrink:0, aspectRatio:"1000 / 750", height:"auto", padding:"56px 0" }} />
          </div>
          <p className="f-sans" style={{ position:"absolute", left:0, right:0, bottom:"calc(14px + env(safe-area-inset-bottom, 0px))", textAlign:"center", fontSize:13, color:"rgba(255,255,255,0.85)", margin:0, pointerEvents:"none" }}>指でうごかすと全体を見られます／余白をタップで閉じます</p>
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

            <button onClick={submitSurvey} disabled={surveySaving || !surveySource} className="btn-primary f-sans" style={{ width:"100%", padding:"15px", fontSize:15, fontWeight:700, borderRadius:12, opacity:(surveySaving||!surveySource)?0.5:1 }}>{surveySaving ? <>送信中<Dots /></> : "送信していいねする"}</button>
          </div>
        </div>
      )}
      {/* 初いいねボックス（2026-07-19）：各求人の最初のいいねで1回だけ展開。
          意匠はお知らせボックスの規格（左詰め・緑太縁3px・タイトルジャンプ・横線・本文18・リンク18）。
          求人カードに❤️が付く動作（cb-heart-pop）＋「いいね一覧を見る →」リンク */}
      {likeDone && (
        <div onClick={()=>setLikeDone(null)} className="cb-box-overlay cb-lock-scroll" style={{ zIndex:9000 }}>{/* cb-lock-scroll＝展開中は背後スクロール固定（2026-08-15） */}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            {/* ✕ボタンは置かない（2026-07-27たきと指示）：ボックス外タップで閉じられるので重複 */}
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text="いいねしました！" /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            {/* いいねした求人のカード：右上に❤️が付く動作（一覧カードの♡ボタンと同じ位置） */}
            <div style={{ position:"relative", margin:"6px 0 14px" }}>
              <div style={{ border:"1px solid #EBEBEB", borderRadius:12, overflow:"hidden", background:"#fff" }}>
                {(() => {
                  const p0 = likeDone.photos?.[0];
                  const src = photoThumb(p0);
                  return src
                    ? <img loading="lazy" src={src} alt="" style={{ width:"100%", height:150, objectFit:"cover", display:"block" }} />
                    : <div style={{ width:"100%", height:150, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center" }}><CropIcon crop={likeDone.crop} size={44} /></div>;
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
              {/* ✕・タイトル「〇〇の農園紹介」は削除（2026-08-14たきと指示・EmployerPreviewSheetの
                  2026-08-07と同じ作法）＝閉じるはボックス外タップ。名乗りは信頼カード内の氏名行が担う */}
              {/* まず信頼カード（農園紹介の下のボックス）→次に農園紹介（2026-07-16） */}
              {/* 質問形式の群れ（問いかけQ&A＋紹介文のお題）は代表よりの下へ移植（2026-08-14たきと指示）。
                  カード内のQaChatはhideQaで出さない＝カードは身元・実績・タグに専念 */}
              {(farmHostQa(empEmployer).length > 0 || !!empEmployer.interaction_style || !!(empTrust && empTrust.ok)) && (
                <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:16 }}>
                  {/* 募集者の住所・連絡先は訪問者に届かないが、行ごと消さず伏せ字で出す
                      （2026-08-17たきと指示「求人者プロフィールの住所や連絡先はモザイク処理」）＝
                      「連絡先を載せていない農家」と誤解させない。伏せ字はタップでログインの説明が出る。
                      値が未設定の求人は masked_fields に載らないso従来どおり行ごと出ない
                      （無い情報をあるように見せない）。会員には従来どおり本物が出る */}
                  <FarmerTrustCard profile={empEmployer} trust={empTrust} maskedFields={selectedJob.maskedFields}
                    onTapOpenJobs={() => openPastJobs("open")} onTapExperience={() => openPastJobs("ended")} hideQa />
                </div>
              )}
              {/* 過去の求人ボックス（受け入れ実績タップで展開・公開中/終了の帯・タップで詳細へ） */}
              {pastJobsOpen && (
                <div onClick={()=>setPastJobsOpen(false)} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none" }}>
                  <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, padding:20, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}>
                    <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 16px", paddingRight:40 }}>{empEmployer.nickname ? `${empEmployer.nickname}さんの求人` : "この農家の求人"}</h3>
                    {pastJobs === null ? (
                      <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>
                    ) : pastJobs.length === 0 ? (
                      <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>
                        {(empTrust?.ok && empTrust.completed_hires > 0) ? "これまでの求人は、掲載を終了しています" : "初めての求人です"}
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
                          const photo = photoThumb(r.photos?.[0]);
                          const isFocus = focusIdx >= 0 && r.job_number === pastJobsFocus;
                          if (isFocus) {
                            // 展開概要カード：最前列（グリッド全幅）。人数は集計値のみ・0は「ー」
                            const c = pastJobsCounts[r.job_number] || {};
                            return (
                              <div key={r.job_number} style={{ gridColumn:"1 / -1", position:"relative", background:"#F7F7F7", borderRadius:12, padding:10, display:"flex", gap:10, alignItems:"flex-start" }}>
                                <button onClick={()=>setPastJobsFocus(null)} aria-label="閉じる" style={{ position:"absolute", top:6, right:6, width:26, height:26, borderRadius:"50%", background:"#fff", border:"none", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                                <div style={{ width:84, height:84, borderRadius:10, overflow:"hidden", flexShrink:0, background:"#EBEBEB", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                                  {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", ...(ended ? { filter:"grayscale(40%)" } : {}) }} /> : "🌾"}
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
                                {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", ...(ended ? { filter:"grayscale(40%)" } : {}) }} /> : "🌾"}
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
              {/* 質問形式の群れ（問いかけQ&A＋紹介文のお題）＝代表よりの下（2026-08-14たきと指示）。
                  1つのQaChatに合流＝同じ要素の視覚的グループ分けは維持 */}
              {(() => {
                const qaAll = [...farmHostQa(empEmployer), ...topics.map(t => ({ q: t.label, a: t.body }))];
                return qaAll.length > 0 ? <QaChat items={qaAll} accent="#00A86B" /> : null;
              })()}
            </div>
          </div>
        );
      })()}

      {/* 通報モーダル：差し戻しモーダル(759e54c)と同じ視覚文法・語彙 */}
      {showReportModal && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
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
                  >{reportSending ? <>送信中<Dots /></> : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
