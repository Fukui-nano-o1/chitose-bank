// 分割3-C（2026-07-25）：App.jsxから移動。農家モードのお仕事タブ（求人一覧・応募者管理・お気に入り・完了報告・緊急連絡）。
import { useState, useEffect, useRef } from "react";
import { getSession, fetchMyEmployerProfileFull, fetchEmployerTrustInfo, fetchMyRoster, fetchMyEmergencyContact,
  fetchWorkerCards, fetchMyFarmJobs, fetchMyFarmApplicants, fetchPublicJobByNumber, fetchMyJobLabel, fetchMyJobContext,
  unpublishJob, copyJob, deleteMyJob, approveApplication, rejectApplication, setAgreedDates, setApplicationFollowup,
  markWorkNoShow, submitFarmerReviewRpc, insertAttendanceEvent, fetchWorkerProfileForFarmer, fetchWorkerTrustInfo,
  upsertRoster, deleteRoster, updateQuestionSet, insertQuestionSet, deleteQuestionSetRow, sendInterviewQuestionsRpc,
  upsertInsurance } from "../features/farmer/dashboard/farmerDashboardApi";
import { openWorkerPreview, openPhaseInfo } from "../lib/previewBus";
import { INTERVIEW_TEMPLATES, ensureDefaultQuestionSets } from "../lib/questionSets";
import { isAdmin, ymdLocal, calFmtDate, daysBetweenYmd, payLabel, CHAT_ELIGIBLE_STATUSES, FARMER_EMERGENCY_KINDS, ROLE_GREEN, appPhaseKey, appPhaseLabelNow, appPhaseColorNow, APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, APP_FILTER_KEYS, perkBadges, isJobEnded, isJobUnpublished, isJobDraft, INSURANCE_ITEMS, insuranceToggle, photoThumb, workerQaItems, mapJobPublicRow, employerUnsetCount } from "../lib/utils";
import { Avatar, StatusRibbon, YesNoPill, NoticeJumpText, AutoSkeleton, useSkeletonProbe, useSkeletonProbeOn, Dots, DeclaredBadge, PunchGapNotice, VineCorner, QaChat } from "./ui";
import { ToggleSwitch } from "./ToggleSwitch";
import { AgreedDatesRow, AvailDatesChips } from "./DateChips";
import { TimeCorrectionSheet } from "./TimeCorrectionSheet";
import { DragSheet } from "./DragSheet";
import { JobCard } from "./JobCard";
import { JobDetailBody } from "./JobDetailBody";
import { AdminJobPreview } from "./AdminJobPreview";
import { MyCalendar } from "./MyCalendar";
import { EmployerProfileEdit } from "./EmployerProfileEdit";
import { WorkerTrustCard, FarmerTrustCard } from "./TrustCards";
import { MyReviewsOfWorker } from "./MyReviewsOfWorker";
import ContractPartyName from "./ContractPartyName";
import ContractEmergencyContact from "./ContractEmergencyContact";
import { getCache, setCache } from "../lib/viewCache";
import { useRefreshTick, REFRESH_APPLICATIONS, REFRESH_JOBS } from "../lib/refreshBus";
import { snapGet, snapSet } from "../lib/snapshot";
import { fbSuccess, fbError } from "../lib/feedback";
import { Celebration } from "./Celebration";

// 応募者ページの状態フィルタのキー：lib/utils の APP_FILTER_KEYS に一本化（2026-08-07・
// 新着の応募ページのピルと並びを共有）。帯5段＋終端（appPhaseKeyの全段階）と同順。
// 旧キー「active（進行中）」は廃止＝保存済みの値は検証で弾かれ「すべて」に落ちる（壊れない）


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
  // 完了の祝祭（2026-08-06・赤ちゃん前提の第0歩）：承認・採用・完了評価の成功時に1回。
  // 演出のみ＝記録・ゲートには触れない。負の場面（見送り・欠勤）では使わない
  const [celebrate, setCelebrate] = useState(null);
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
  // 使う側（openQMgr・応募者の読み込み・評価の送信）より前に置く（宣言前参照の解消・2026-07-29）
  const [qEditing, setQEditing] = useState(null);       // 編集中セット {id?, title, questions:[...]}（null=一覧）
  // 質問集カードの反転（2026-07-29たきと指示）：表=案内文／裏=作ってある質問集のタイトル横スクロール。
  // トップボックス(empTopBack)と同じ作法で、切り返した面をlocalStorageに覚える
  const [qCardBack, setQCardBack] = useState(() => { try { return localStorage.getItem("cb_qCardBack") === "1"; } catch { return false; } });
  const [qCardAnim, setQCardAnim] = useState("");       // 反転アニメ: pflip-out|pflip-in（0.4s×2）
  const [favDone, setFavDone] = useState(null); // {workerId, nickname, avatar_url}
  const [favDetailOpen, setFavDetailOpen] = useState(false);
  const [todoAppIds, setTodoAppIds] = useState(() => new Set()); // 未対応（＝農家の番）の応募ID。my_todo_items由来・アイコンのジャンプに使う
  const [reviewedAppIds, setReviewedAppIds] = useState(() => new Set()); // 自分が評価を書いた応募ID。お仕事の流れバーの「評価」段の点灯に使う

  const openQMgr = () => { qMgrScrollY.current = window.scrollY; setQEditing(null); setQMgrOpen(true); };
  const closeQMgr = () => { const y = qMgrScrollY.current; setQMgrOpen(false); requestAnimationFrame(() => window.scrollTo(0, y)); };
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
        const { error } = await updateQuestionSet(qEditing.id, me.id, title, questions);
        if (error) throw error;
      } else {
        const { error } = await insertQuestionSet(me.id, title, questions);
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
      const { error } = await deleteQuestionSetRow(id, me.id);
      if (error) throw error;
      await loadQuestionSets();
      setQEditing(null);
    } catch (e) { alert("削除に失敗しました：" + (e?.message || "不明")); }
  };
  const [qSentAppIds, setQSentAppIds] = useState(() => new Set());
  // loadQSentIds（質問送信済みの個別取得）は廃止（2026-08-02）：my_farm_applicants の qsent_ids に統合

  const sendInterviewQuestions = async (setId) => {
    if (!sendQTarget || sendingQ) return;
    setSendingQ(true);
    try {
      const { data, error } = await sendInterviewQuestionsRpc(sendQTarget.id, setId);
      if (error || !data?.ok) { alert("送信に失敗しました：" + (data?.message || data?.reason || error?.message || "不明")); setSendingQ(false); return; }
      const appId = sendQTarget.id;
      setSendQTarget(null); setSendingQ(false);
      setQSentAppIds(prev => new Set(prev).add(appId)); // 初面接後＝シートのボタンが「採用する」に切り替わる
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
  // 前回この面が出した内容をまず描く→裏で最新に差し替える（stale-while-revalidate・2026-07-27たきと指示）。
  // 待ち時間の体感を消すのが目的で、正しさは毎回の再取得で担保する。キャッシュはページ寿命だけ（lib/viewCache）
  const [dbDrafts, setDbDrafts] = useState(() => getCache("farm:drafts") ?? []);
  const [dbActive, setDbActive] = useState(() => getCache("farm:active") ?? []);
  // 働く日を決める（2026-07-24 追記3）：期間求人・承認後、農家が働く日を確定する。agreeModal=対象の応募／agreeSel=選択中
  const [agreeModal, setAgreeModal] = useState(null);
  const [agreeSel, setAgreeSel] = useState([]);
  const [agreeSaving, setAgreeSaving] = useState(false);
  const [qUnansweredMap, setQUnansweredMap] = useState(() => getCache("farm:qUnanswered") ?? {}); // { job_number: 未回答質問数 }（第10弾・求人カードのバッジ）
  const [dbExpired, setDbExpired] = useState(() => getCache("farm:expired") ?? []); // 作業日程が過ぎた自分の求人（statusは持たず日付から導出・2026-07-16）
  const [dbApplicants, setDbApplicants] = useState(() => getCache("farm:apps") ?? []);
  const [jobInfoMap, setJobInfoMap] = useState(() => getCache("farm:jobInfo") ?? {}); // job_number→{crop,task}（応募者を求人毎に分ける見出し用・2026-07-19）
  const [workerProfiles, setWorkerProfiles] = useState(() => getCache("farm:wp") ?? {});
  const [workerTrust, setWorkerTrust] = useState(() => getCache("farm:trust") ?? {}); // { [worker_id]: {joined_at, verified_at} }
  const [draftsLoading, setDraftsLoading] = useState(() => getCache("farm:drafts") === undefined); // キャッシュがあれば最初から仮配置を出さない
  const [appsLoading, setAppsLoading] = useState(() => getCache("farm:apps") === undefined);       // 応募は求人と別に読むので、待ちの判定も別（2026-07-29）
  // 画面の状態→キャッシュの写し（2026-07-27）。承認・削除・一時非公開などは手元のstateだけを
  // 書き換えるので、ここで一括して写す。呼び出し側（14箇所）にsetCacheを撒かない＝写し忘れが起きない。
  // 読み込みが一度も終わっていない間は写さない（空の[]を焼き付けて「求人ゼロ」に見せないため）
  useEffect(() => { if (draftsLoading) return; setCache("farm:drafts", dbDrafts); }, [dbDrafts, draftsLoading]);
  useEffect(() => { if (draftsLoading) return; setCache("farm:active", dbActive); }, [dbActive, draftsLoading]);
  useEffect(() => { if (draftsLoading) return; setCache("farm:expired", dbExpired); }, [dbExpired, draftsLoading]);
  useEffect(() => { if (appsLoading) return; setCache("farm:apps", dbApplicants); }, [dbApplicants, appsLoading]);
  // 仮配置の骨を測るref（この面が実際に描いた形が、次回の読み込み中の形になる）
  const skelDraftRef = useSkeletonProbe("farmDrafts");
  // 応募者一覧のDOM参照。スワイプ判定（下部）とスケルトン計測（直下）で共用するため、
  // 使う場所より前で宣言する（constは巻き上げても初期化前に触れないため、後ろに置くと
  // 「Cannot access ... before initialization」で応募者ページが真っ白になる・2026-07-29修理）
  const appGridRef = useRef(null);
  // 応募者ページの一覧はappGridRef（スワイプ判定用）と共用なので、ref付き要素を測る版を使う
  useSkeletonProbeOn(appGridRef, (jobTab === "applicants" && !appsLoading) ? "farmList:applicants" : null);
  const skelActiveRef = useSkeletonProbe("farmActive");
  // 名刺の氏名・アイコンを読み込み前から出す（2026-08-02たきと指示）：viewCacheに無ければsnapshot
  // （localStorage・本人の自分用データ・ログアウトで全消去）から前回値を即表示→裏で最新に差し替え
  const [empMini, setEmpMini] = useState(() => getCache("farm:empMini") ?? snapGet("empMini") ?? null); // 入口メニューの大プロフィールカード用（全列・裏面プレビューにも使用）
  const [hasEmergency, setHasEmergency] = useState(() => getCache("farm:hasEmergency") ?? false); // 🆘緊急連絡先の登録有無（未設定バッジ用・2026-08-07）
  const [empTrust, setEmpTrust] = useState(() => getCache("farm:empTrust") ?? null); // 名刺カード裏面＝本物のプレビュー（FarmerTrustCard）用の信頼情報
  const [empTopBack, setEmpTopBack] = useState(() => { try { return localStorage.getItem("cb_empTopBack") === "1"; } catch { return false; } }); // トップボックスの裏面表示。切り返した画面で固定（localStorageに永続・2026-07-16）
  const [empTopAnim, setEmpTopAnim] = useState("");    // 反転アニメ: pflip-out|pflip-in（0.4s×2=0.8秒）
  // 🛡保険の準備カードの反転（2026-07-29たきと指示・質問集カードと同じ作法）：
  // 表＝案内文（タップで#/insurance）／裏＝保険の箱を横スクロール、タップでその場に開いて申告できる。
  // 中身は employer_profiles.insurance_items / insurance_notes（empMiniが全列を持っているので追加の読み込みは無し）
  const [insCardBack, setInsCardBack] = useState(() => { try { return localStorage.getItem("cb_insCardBack") === "1"; } catch { return false; } });
  const [insCardAnim, setInsCardAnim] = useState("");
  const [insOpenKey, setInsOpenKey] = useState(null);  // 展開中の保険のキー（null=閉じている）
  const [insItems, setInsItems] = useState([]);        // 作業コピー（保存で employer_profiles へ書き戻す）
  const [insNotes, setInsNotes] = useState({});
  const [insSaving, setInsSaving] = useState(false);
  useEffect(() => {
    if (insOpenKey) return;                            // 入力中は上書きしない（読み込みが後から来ても消えない）
    setInsItems(Array.isArray(empMini?.insurance_items) ? empMini.insurance_items : []);
    setInsNotes((empMini?.insurance_notes && typeof empMini.insurance_notes === "object") ? empMini.insurance_notes : {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [empMini]);
  // 箱の並び（2026-07-29たきと指示）：申告した順に左へ、そのあとに未申告。
  // 並びの元は「保存ずみ」の順（empMini）＝入力中にトグルするたび箱が飛び回らない。保存すると並び替わる
  const insOrderedItems = (() => {
    const saved = Array.isArray(empMini?.insurance_items) ? empMini.insurance_items : [];
    const declared = saved.map(k => INSURANCE_ITEMS.find(x => x.k === k)).filter(Boolean);
    return [...declared, ...INSURANCE_ITEMS.filter(it => !saved.includes(it.k))];
  })();
  const toggleInsurance = (k, v) => {
    // 排他ルールは lib/utils の insuranceToggle（保険ページと共用）。確認の文言も保険ページと同じ
    const r = insuranceToggle(insItems, insNotes, k, v);
    if (r.losing && !window.confirm("「これから準備する」を選ぶと、他の保険の選択と入力したひとことはリセットされます。よろしいですか？")) return;
    setInsItems(r.items); setInsNotes(r.notes);
  };
  const saveInsurance = async () => {
    if (insSaving) return;
    setInsSaving(true);
    try {
      const { data: { session } } = await getSession();
      if (!session) { setInsSaving(false); return; }
      // ひとことは選択中の項目のぶんだけ残す（外した項目のメモは持ち越さない＝保険ページと同じ規則）
      const pruned = {};
      insItems.forEach(k => { const t = (insNotes[k] || "").trim(); if (t) pruned[k] = t; });
      const { error } = await upsertInsurance(session.user.id, insItems, pruned);
      if (error) throw error;
      setEmpMini(prev => { const nx = { ...(prev || {}), insurance_items: insItems, insurance_notes: pruned }; setCache("farm:empMini", nx); snapSet("empMini", nx); return nx; });
      setInsOpenKey(null);
    } catch (e) { alert("保存に失敗しました：" + (e?.message || "不明")); }
    finally { setInsSaving(false); }
  };
  // 未設定の項目数（編集ページの9ボックス基準・従業員数は削除済み2026-08-01）。トップボックスの通知バッジ＋赤影に使用（2026-07-16・働き手側と同構造）
  // 核（アイコン・農園名・作業場所）が未設定→赤影＋浮遊アニメ／任意のみ未設定→赤影のみ（紹介PR→作業場所に差替・2026-07-16）
  // 数え方はlib/utilsのemployerUnsetCountが唯一のソース（今日ページの未入力ボックスと同じ定義・2026-08-03）。
  // 2026-08-07追加：募集者の連絡先＋緊急連絡先（hasEmergency＝emergency_contactsの有無）も同関数で数える
  const { req: empUnsetReq, total: empUnsetCount } = employerUnsetCount(empMini, { hasEmergency });
  // 自由記述の審査帯（2026-07-19）は削除した（2026-08-17）。承認プロセスの削除（2026-08-14）で
  // 自由記述は保存＝即公開になり、trg_ep_z_publish_texts が texts_pending / texts_submitted_at /
  // texts_revision_requested_at を書かれた瞬間に畳む（＝クリアする）。この3列を立てる関数は
  // DB全体で1本も無く、実データも0件＝「審査中の農家」という状態が構造的に存在しない。
  const [rosterRows, setRosterRows] = useState(() => getCache("farm:roster") ?? []); // また呼びたいリスト（repeat_roster＋worker_profiles結合済み）
  // ── 読み込みは「その面を開いた時だけ」（2026-07-29たきと指示 D＝必要になったときに読む）──
  // 以前は入口(home)を開いただけで、求人・応募・応募者プロフィール・信頼情報まで全部読んでいた。
  // 入口が要るのは 雇い手プロフィール／信頼情報／また呼びたいリスト の3つだけ。
  // 求人は「作成中・公開中・期限切れ・応募者」を開いた時、応募は「応募者」を開いた時に読む。
  // 一度読んだらそのマウント中は読み直さない（求人作成から戻るとマウントし直されるので鮮度は保たれる）。

  // 【入口】常に読む3本（互いに独立なので同時に投げる）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (!session) return;
        const uid = session.user.id;
        const [epRes, trustRes, rosterRes, emgRes] = await Promise.all([
          fetchMyEmployerProfileFull(uid),   // トップボックス裏面プレビュー用に全列（2026-07-16）
          fetchEmployerTrustInfo(uid),
          fetchMyRoster(uid),
          fetchMyEmergencyContact(uid),      // 🆘の有無だけ（self-only RLS・バッジ用）
        ]);
        const epMini = epRes.data, tI = trustRes.data, rosterData = rosterRes.data;
        setEmpTrust(tI && tI.ok ? tI : null); setCache("farm:empTrust", tI && tI.ok ? tI : null);
        if (!emgRes.error) { const has = !!emgRes.data; setHasEmergency(has); setCache("farm:hasEmergency", has); }
        if (epMini) { setEmpMini(epMini); setCache("farm:empMini", epMini); snapSet("empMini", epMini); }
        if (rosterData && rosterData.length > 0) {
          const { data: rosterWp } = await fetchWorkerCards(rosterData.map(r => r.worker_id));
          const wpMap = {};
          (rosterWp || []).forEach(wp => { wpMap[wp.auth_id] = wp; });
          const rr = rosterData.map(r => ({ worker_id: r.worker_id, nickname: wpMap[r.worker_id]?.nickname || null, avatar_url: wpMap[r.worker_id]?.avatar_url || null }));
          setRosterRows(rr); setCache("farm:roster", rr);
        }
      } catch {}
      try { if (sessionStorage.getItem("cb_afterDraftSave")==="1") { setJobTab("draft"); } sessionStorage.removeItem("cb_afterDraftSave"); } catch {}
    })();
  }, []);

  // 再取得の合図（2026-08-18 Speed-1B）。求人面＝求人の変化と復帰／応募者面＝応募の変化と復帰。
  // 面ごとに分けてある＝合図が来ても、いま開いていない面は取りに行かない
  const jobsRefreshTick = useRefreshTick(REFRESH_JOBS);
  const appsRefreshTick = useRefreshTick(REFRESH_APPLICATIONS);

  // 【求人】作成中・公開中・期限切れ・応募者（求人名の表示に要る）を開いた時に一度だけ
  const jobsLoadedRef = useRef(false);
  useEffect(() => {
    if (!["draft","active","expired","applicants"].includes(jobTab)) return;
    // 一度きりガード（面を行き来しても取り直さない）は維持しつつ、再取得の合図が来た時だけ破る。
    // 初回は false !== 0 で通り、以後は同じ数字の間だけ止まる（2026-08-18 Speed-1B）
    if (jobsLoadedRef.current === jobsRefreshTick) return;
    jobsLoadedRef.current = jobsRefreshTick;
    (async () => {
      try {
        // 1往復に集約（2026-08-02たきと指示「求人ページも遅い」）：従来は getSession→自分のjobs取得→
        // 未回答質問集計の直列で、スケルトン解除が最後だった。my_farm_jobs（SECURITY INVOKER＝RLSそのまま）
        // が求人と未回答質問数をまとめて返す
        const { data: bundle, error } = await fetchMyFarmJobs();
        const allJobs = bundle?.jobs;
        if (!error && allJobs) {
          const jim = Object.fromEntries(allJobs.map(j => [j.job_number, { crop: j.crop, task: j.task, date_start: j.date_start, date_end: j.date_end, photos: j.photos, holidays: j.holidays }]));
          setJobInfoMap(jim); setCache("farm:jobInfo", jim);
          // 自分の求人を日付で仕分ける：終了日(無ければ開始日)が昨日以前＝期限切れ。
          // 「期限切れ」というstatusはDBに存在しない（導出のみ）。当日の求人はまだ現役扱い。
          // opened_at＝一時非公開（掲載歴あり）判定に必須（2026-07-16）。RPC側の固定列から落とさないこと。
          // 判定は lib/utils に一本化（2026-07-27たきと指示）：終了＝日程が過ぎた（statusより優先）／
          // 一時非公開＝掲載歴ありのdraft／下書き＝掲載歴なし・日程も未過去のdraft。ここで独自に書かない
          const isPast = isJobEnded;
          const isUnpublished = isJobUnpublished;
          // 作成中タブ＝作成中＋公開間近(pending)／公開中タブ＝公開中＋一時非公開（2026-07-16たきと指定）。
          // pending は掲載＝即公開になった今もう1つだけ残る状態＝修正のお願い中の求人の再掲載（20260814093042）
          setDbDrafts(allJobs.filter(j => (isJobDraft(j) || (j.status === "pending" && !isPast(j)))));
          setDbActive(allJobs.filter(j => (j.status === "open" || isUnpublished(j)) && !isPast(j)));
          setDbExpired(allJobs.filter(isPast));
          // 未回答の質問数（第10弾）：{ job_number: 件数 }。参照側の qUnansweredMap[j.job_number] は
          // 数値添字でもJSがキーを文字列化するので、jsonの文字列キーのままで一致する
          const m = bundle.q_unanswered || {};
          setQUnansweredMap(m); setCache("farm:qUnanswered", m);
        }
      } catch {}
      setDraftsLoading(false);
    })();
  }, [jobTab, jobsRefreshTick]);
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


  // 完了・評価モーダル（Part1）
  const [completeModalApp, setCompleteModalApp] = useState(null);
  const [completeWantAgain, setCompleteWantAgain] = useState(null);
  const [completeEntrust, setCompleteEntrust] = useState(null);
  const [completePublicComment, setCompletePublicComment] = useState("");
  const [completePrivateMemo, setCompletePrivateMemo] = useState("");
  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [completeNotifyNext, setCompleteNotifyNext] = useState(true); // また呼びたい=はい時のみ表示。ON=repeat_rosterへupsert
  const [completeDone, setCompleteDone] = useState(null); // 評価登録完了モーダル {jobLabel,jobNumber,workerId,workerName,at,wantAgain,entrust,publicComment,privateMemo,favorited}
  const openCompleteModal = (a) => {
    // 完了ボタン＝そのまま評価（2026-08-16たきと指示）。以前は「働き手は来ましたか？」の1枚を
    // 挟んでいたが、通常の道（来た→評価）が2タップになるため廃止＝最初から評価を出す。
    // 送信＝完了の記録＋評価（submit_farmer_review・1トランザクション）。
    // 来なかった場合（欠勤の記録・72時間の異議申立）は評価画面の下に控えめに残す＝例外の道は消さない
    setCompleteModalApp(a);
    setCompleteWantAgain(null); setCompleteEntrust(null);
    setCompletePublicComment(""); setCompletePrivateMemo("");
    setCompleteNotifyNext(true);
  };
  const markNoShow = async () => {
    if (!completeModalApp || completeSubmitting) return;
    if (!confirm('欠勤として記録します。働き手に通知され、72時間の異議申立ができます')) return;
    setCompleteSubmitting(true);
    try {
      const { data, error } = await markWorkNoShow(completeModalApp.id);
      if (error || !data?.ok) { fbError(); alert('記録に失敗しました：' + (data?.reason || error?.message || '不明')); setCompleteSubmitting(false); return; }
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
      const { data, error } = await submitFarmerReviewRpc(completeModalApp.id, {
        wantAgain: completeWantAgain, entrust: completeEntrust,
        publicComment: completePublicComment.trim(), privateMemo: completePrivateMemo.trim(),
        favorite: completeNotifyNext,
      });
      if (error || !data?.ok) { fbError(); alert('送信に失敗しました（何も保存されていません）：' + (data?.reason || error?.message || '不明')); setCompleteSubmitting(false); return; }
      const favorited = !!data.favorited;
      if (favorited) {
        const wp = workerProfiles[completeModalApp.worker_id];
        setRosterRows(prev => prev.some(r => r.worker_id === completeModalApp.worker_id) ? prev
          : [{ worker_id: completeModalApp.worker_id, nickname: wp?.nickname || null, avatar_url: wp?.avatar_url || null }, ...prev]);
        setFavDetailOpen(false);
        setFavDone({ workerId: completeModalApp.worker_id, nickname: wp?.nickname || "", avatar_url: wp?.avatar_url || "" });
      }
      setDbApplicants(prev => prev.map(x => x.id===completeModalApp.id ? { ...x, status:'completed', attended:true } : x));
      fbSuccess(); setCelebrate({ emoji:"🌾", title:"おつかれさまでした" });
      // 評価登録完了モーダル用の控えを組み立てる（求人タイトルはdbActive→jobsの順で解決）
      let jobLabel = "";
      const cached = dbActive.find(d => d.job_number === completeModalApp.job_number) || dbDrafts.find(d => d.job_number === completeModalApp.job_number);
      if (cached) jobLabel = [cached.crop, cached.task].filter(Boolean).join(" ");
      else {
        try {
          const { data: jr } = await fetchMyJobLabel(completeModalApp.job_number, me.id);
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
      // 評価が終わった応募を未対応リストから外す＝この時点で「完了」の暗幕が掛かる（2026-07-27）
      setTodoAppIds(prev => { const n = new Set(prev); n.delete(completeModalApp.id); return n; });
    } catch { alert('処理に失敗しました。'); }
    setCompleteSubmitting(false);
  };
  // お気に入り登録しました！ボックス（2026-07-19）：登録成功の瞬間に展開。アイコンに❤️が付く動作つき
  const [rosterInfoOpen, setRosterInfoOpen] = useState(false); // また呼びたいリストの説明：?マークタップで展開（既定は閉・情報過多回避・2026-07-19）
  // 応募者タブの状態フィルタ（2026-07-22）。選んだタブはsessionStorageに残す（2026-07-27たきと報告）＝
  // 画面上端での引き下げ（pull-to-refresh）などでリロードが走っても「すべて」に戻らない。
  // タブを閉じれば消えるので、次に開き直した時は既定（すべて）から始まる
  const [appFilter, setAppFilter] = useState(() => {
    try { const f = sessionStorage.getItem("cb_appFilterCur"); if (f && APP_FILTER_KEYS.includes(f)) return f; } catch {}
    return "all";
  });
  useEffect(() => { try { sessionStorage.setItem("cb_appFilterCur", appFilter); } catch {} }, [appFilter]);
  // 今日ページ「新着の応募」「採用する」からの着地（2026-07-26）：フラグがあれば指定フィルタで開く。読んだら消す
  useEffect(() => {
    if (jobTab !== "applicants") return;
    try {
      const f = sessionStorage.getItem("cb_appFilter");
      if (f) { sessionStorage.removeItem("cb_appFilter"); if (APP_FILTER_KEYS.includes(f)) setAppFilter(f); }
    } catch {}
  }, [jobTab]);
  const [appLegendOpen, setAppLegendOpen] = useState(false); // 応募者ページ下部「帯の意味」の説明ボックス開閉
  // 今日ページのカレンダー箱から来たときだけ、応募者ページの上部にカレンダーを展開する（2026-07-27たきと指示）。
  // 合図は sessionStorage の cb_openCalendar（TodayPage側で立てる）。一度読んだら消す＝タブを離れると元に戻る
  const [calOnTop, setCalOnTop] = useState(false);
  // 畳む動作は開く動作の逆順（①縦に畳む→②横に縮む・2026-07-29たきと指示）。
  // アニメが終わるまで要素を残す必要があるので、calClosing を立ててから遅れて外す
  const [calClosing, setCalClosing] = useState(false);
  const calCloseT = useRef(null);
  const CAL_CLOSE_MS = 660; // CSS: 縦0.34s +（0.34s待ち）横0.3s ＝ 0.64s ＋ 余白
  useEffect(() => () => clearTimeout(calCloseT.current), []);
  useEffect(() => {
    if (jobTab !== "applicants") { clearTimeout(calCloseT.current); setCalClosing(false); setCalOnTop(false); return; }
    try {
      if (sessionStorage.getItem("cb_openCalendar")) {
        sessionStorage.removeItem("cb_openCalendar");
        setCalOnTop(true);
      }
    } catch {}
  }, [jobTab]);
  // カレンダーの予定カード（アジェンダ）を廃止した引き継ぎ（2026-07-27たきと指示）：
  // 日付タップ＝その日の求人を、下の応募者リストで光らせて位置まで運ぶ。求人の中身は既存の求人カードが持っている
  const [calDay, setCalDay] = useState(null); // { ymd, jobs:[job_number] }
  const jobCardRefs = useRef({});
  const onCalDayTap = (ymd, jobNumbers) => {
    setCalDay({ ymd, jobs: jobNumbers });
    if (!jobNumbers.length) return;
    setTimeout(() => {
      const el = jobNumbers.map(n => jobCardRefs.current[n]).find(Boolean);
      if (el) el.scrollIntoView({ behavior:"smooth", block:"center" });
    }, 40);
  };
  // 開閉はここ1箇所（横スワイプ・案内行タップの両方から呼ぶ）。setCalDayを使うのでcalDayの後に置く
  const toggleCalTop = () => {
    if (calOnTop) {
      if (calClosing) return;                  // 二度押しで二重に走らせない
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
  const calendarTop = (calOnTop || calClosing) ? (
    /* カレンダー上のスワイプはカレンダー（月送り）が優先（2026-07-27たきと指示）：
       タッチをここで止めないと、ページ側の横スワイプ（カレンダーの開閉）に食われて
       月を送ったつもりがカレンダーごと畳まれていた */
    /* 展開はヌルッと（2026-07-27たきと指示）：cb-cal-revealが高さ0→自動へ滑らかに開く */
    <div key="app-cal-top" onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}
      className={"cb-cal-reveal" + (calClosing ? " cb-cal-closing" : "")} style={{ gridColumn:"1/-1", marginBottom:14 }}><div><MyCalendar onDayTapJobs={onCalDayTap} /></div></div>
  ) : null;
  // 評価登録完了モーダル内のお気に入り登録チェック（ON=roster upsert／OFF=行削除）
  const toggleDoneFavorite = async (checked) => {
    if (!completeDone) return;
    try {
      if (checked) {
        const { error } = await upsertRoster(me.id, completeDone.workerId);
        if (error) { alert('登録に失敗しました：' + error.message); return; }
        const wp = workerProfiles[completeDone.workerId];
        setRosterRows(prev => prev.some(r => r.worker_id === completeDone.workerId) ? prev
          : [{ worker_id: completeDone.workerId, nickname: wp?.nickname || null, avatar_url: wp?.avatar_url || null }, ...prev]);
        setFavDetailOpen(false);
        setFavDone({ workerId: completeDone.workerId, nickname: wp?.nickname || "", avatar_url: wp?.avatar_url || "" });
      } else {
        const { error } = await deleteRoster(me.id, completeDone.workerId);
        if (error) { alert('解除に失敗しました：' + error.message); return; }
        setRosterRows(prev => prev.filter(r => r.worker_id !== completeDone.workerId));
      }
      setCompleteDone(prev => prev ? { ...prev, favorited: checked } : prev);
    } catch { alert('処理に失敗しました。'); }
  };
  // 求人カードタップ→確認ページと同型の全画面プレビュー（AdminJobPreviewのownerViewモード流用）
  const [previewJob, setPreviewJob] = useState(null); // { num: job_number, draft: bool（trueなら編集再開ボタンを出す） }
  // ── 求人の操作ピル（2026-08-07たきと指示・同日改定「各役割タップ→求人を直接タップする。
  //    削除と非公開だけが最終確認」）──
  // ピルのタップ＝モード選択（もう一度タップで取消）。その状態で一覧の求人カードを直接タップすると実行。
  // 選択シートは廃止（対象は画面のカードそのものを指させる＝赤ちゃん前提の直接操作）。
  // 最終確認（confirm）は削除・非公開のみ。再開・コピーはカードタップで即実行
  const [armedAction, setArmedAction] = useState(null); // 'resume'|'copy'|'delete'|'unpublish'
  const ARMED_LABEL = { resume:"再開", copy:"コピー", delete:"削除", unpublish:"非公開" };
  const runJobAction = async (kind, num) => {
    if (kind === "resume") { onResume(num); return; }
    if (kind === "unpublish") {
      // 一時非公開：open→draftへ（unpublish_job RPC・本人限定）。最終確認あり（たきと指定）。
      // 再掲載は作成中→再開→掲載＝そのまま公開（2026-08-14 承認プロセスの削除。旧「審査を通る」は誤り）。
      // 例外＝運営から修正のお願いが届いている求人だけ、再掲載が運営確認に落ちる（migration 20260814093042）。
      // その状態の農家には赤帯で別途知らせているので、この確認文には書かない（普通の一時非公開の話を短く伝える）
      // ★応募中・面接中は見送りになる（migration 20260808004900・採用済みは不変）＝確認文に明記
      if (!confirm("この求人を一時非公開にしますか？（さがすに表示されなくなります。応募中・面接中の方は見送りになります。あとから再掲載できます）")) return;
      const { data, error } = await unpublishJob(num);
      if (error || !data?.ok) { alert("一時非公開にできませんでした：" + (data?.reason || error?.message || "不明")); return; }
      // 公開中タブに「一時非公開」帯で残す（2026-07-16たきと指定）。opened_atは掲載歴の印としてそのまま
      setDbActive(prev => prev.map(d => d.job_number === num ? { ...d, status: "draft" } : d));
      return;
    }
    if (kind === "delete") {
      // 削除は下書きのみ（タップ側で判定済み＋DBの trg_block_delete_past_job が二重の壁）。最終確認あり（不可逆）
      if (!confirm("この求人（下書き）を削除しますか？元に戻せません")) return;
      const { error } = await deleteMyJob(num, me.id);
      if (error) { alert("削除に失敗しました：" + error.message); return; }
      setDbDrafts(prev => prev.filter(d => d.job_number !== num));
      setDbActive(prev => prev.filter(d => d.job_number !== num));
      return;
    }
    if (kind === "copy") {
      const { data, error } = await copyJob(num);
      if (error || !data?.ok) { alert("コピーに失敗しました：" + (data?.reason || error?.message || "不明")); return; }
      // コピーした行をそのまま次の画面へ渡す（2026-08-03）：jobsの読み直しを待たずに復元できる
      try { if (data.job) sessionStorage.setItem("cb_editJobPrefill", JSON.stringify(data.job)); } catch {}
      // コピーは期間のみリセット（2026-08-16たきと指示）：日程・休日は常に空＝新しく選び直す。他は全部引き継ぎ
      if (data.dates_cleared) alert("コピーしました。作業日程は引き継がないため空になっています。確認ページの「日程」から新しい日を選んでください。");
      window.location.hash = "/work/edit/" + data.job_number; // 新しい下書きを編集フローで開く
    }
  };
  // ピルのタップ＝モードの入/切。対象が1件も無い時はモードに入らず理由を案内
  const armJobAction = (kind) => {
    if (armedAction === kind) { setArmedAction(null); return; }
    const jobs = kind === "resume" ? dbDrafts.filter(d => d.status === "draft")
      : kind === "copy" ? [...dbDrafts, ...dbActive]
      : kind === "unpublish" ? dbActive.filter(d => d.status === "open")
      : dbDrafts.filter(d => d.status === "draft" && !d.opened_at);
    if (jobs.length === 0) {
      alert(kind === "delete" ? "削除できる下書きがありません（一度でも掲載した求人・応募のある求人は削除できません）"
        : kind === "unpublish" ? "非公開にできる公開中の求人がありません"
        : kind === "resume" ? "作成中の求人がありません" : "コピーできる求人がありません");
      return;
    }
    setArmedAction(kind);
  };
  // モード中に求人カードをタップ→その求人に実行（適さないカードは理由を出してモード維持）
  const handleArmedCardTap = (d) => {
    const kind = armedAction;
    if (kind === "resume" && d.status !== "draft") { alert("再開できるのは作成中の下書きだけです"); return; }
    if (kind === "delete" && !(d.status === "draft" && !d.opened_at)) { alert("削除できるのは一度も掲載していない下書きだけです"); return; }
    if (kind === "unpublish" && d.status !== "open") { alert("非公開にできるのは公開中の求人だけです"); return; }
    setArmedAction(null);
    runJobAction(kind, d.job_number);
  };
  // ペイン切替（作成中⇄公開中）でモード解除：3つ目のピルが削除⇄非公開に入れ替わるため持ち越さない
  useEffect(() => { setArmedAction(null); }, [jobTab]);
  // 「公開間近」（＝掲載申請済み・公開の準備中）のカードをタップした時の説明ボックス（2026-08-07たきと指示）。
  // 詳細も求人者プロフィールも見せず、説明だけを展開する＝「審査されている」感を出さない
  const [nearPublishInfo, setNearPublishInfo] = useState(false);
  const [nearPubDetail, setNearPubDetail] = useState(false);
  // 応募者タブのグリッド用（働き手の承認済みタブと同設計・2026-07-16）
  const [sheetApplicantId, setSheetApplicantId] = useState(null); // タップした応募者のボトムシート
  // シート内の求人カード→詳細面（2026-08-08たきと指示「ここも同じにしよう。アニメーションもコピー」＝
  // ステータスページのボックスと同じ：求人タップで面全体が演出→詳細面へスライド・横スワイプで戻る）
  const [sheetPane, setSheetPane] = useState("main");        // main | detail
  const [sheetShowcase, setSheetShowcase] = useState(false); // 面全体の演出（cbJobShowcase）
  const [sheetJobFull, setSheetJobFull] = useState({});      // job_number → jobs_publicのmapped行｜null(非公開)
  useEffect(() => {
    setSheetPane("main"); setSheetShowcase(false); // 開き直しで面と演出の残骸を持ち越さない
    const live = dbApplicants.find(x => x.id === sheetApplicantId);
    const jn = live?.job_number;
    if (!jn || jn in sheetJobFull) return;
    let dead = false;
    (async () => {
      try {
        const { data } = await fetchPublicJobByNumber(jn);
        if (!dead) setSheetJobFull(prev => ({ ...prev, [jn]: data ? mapJobPublicRow(data) : null }));
      } catch { if (!dead) setSheetJobFull(prev => ({ ...prev, [jn]: null })); }
    })();
    return () => { dead = true; };
  }, [sheetApplicantId]); // eslint-disable-line react-hooks/exhaustive-deps -- sheetJobFullは取得済み判定のみ（依存に入れると再取得ループ）
  // 面接の質問を一度でも送った応募ID（interview_question_sends・農家本人select可）。
  // シートのボタン出し分け「初面接後=採用する」の判定に使用（2026-07-26たきと指示）
  // 採用の実行窓口は「採用するページ」1箇所に一本化（2026-08-06たきと指示「器と機能の役割は一つに絞れ」）。
  // シートの役割は判断材料を見せることに徹し、採用ボタンは採用ページへのリンク。
  // 最終確認・二重予約警告・本名開示の明示・実行（confirm_terms）はすべて採用ページ側が担う。
  const goHirePage = () => { window.location.hash = "/calendar/todo/hire"; };
  // リアルタイム帯（2026-07-25たきと指示）：「〇〇済み」でなく今の段階「〇〇中」を出す。
  // 段階の導出・ラベル・色は lib/utils の appPhaseKey/APP_PHASE_LABEL/APP_PHASE_COLOR に一本化（帯・凡例の唯一のソース）
  // ★作業中は「今日」で出し分ける（2026-08-18たきと指示「作業していない時間は作業中ではない」）＝
  //   働く日でない日は「次は 8/20(木)」。働く日の材料は応募行（agreed_dates/来られる日）＋
  //   求人（日程・休日）＝jobInfoMap から渡す。凡例・絞り込みは区分名ので従来どおり APP_PHASE_LABEL
  const appRibbonLabel = (a) => {
    const info = jobInfoMap[a.job_number] || {};
    return appPhaseLabelNow(a, { ...a, date_start: info.date_start, date_end: info.date_end, holidays: info.holidays }) || a.status;
  };
  // ★色もラベルと同じ材料で出す（2026-08-18たきと指示「採用の色に戻せ」）＝働く日でない日は
  //   赤（作業中）でなく採用の色。判定は lib/utils 側で一本化＝文字と色が食い違わない
  const appRibbonColor = (a) => {
    const info = jobInfoMap[a.job_number] || {};
    return appPhaseColorNow(a, { ...a, date_start: info.date_start, date_end: info.date_end, holidays: info.holidays });
  };
  // 応募者ページの状態フィルタ（2026-07-22・2026-08-07ステータス統一）：
  // 帯と同じ段階判定（appPhaseKey）で絞る＝帯5段（応募中→面接中→採用→作業中→完了）＋終端（見送り/失効）。
  // ラベル・並びは APP_FILTER_KEYS と APP_PHASE_LABEL から引く＝帯・凡例と文言が枝分かれしない
  const APP_FILTERS = [
    { k:"all", l:"すべて", match: () => true },
    ...APP_FILTER_KEYS.filter(k => k !== "all").map(k => ({ k, l: APP_PHASE_LABEL[k], match: (s, a) => appPhaseKey(a) === k })),
  ];
  // 応募者ページの横スワイプ＝上部カレンダーの開閉（2026-07-27たきと指示。旧・フィルタ切替から置換）。
  // フィルタは上部/浮遊バーのボタンタップで切り替える（スワイプとの二重割り当てをやめる）。
  // 求人カードのアイコン列など内側の横スクロールで始まったタッチは奪わない
  // スワイプの追従（2026-07-27たきと指示・同日改定）：指の動きに合わせて求人カードだけが同じ方向へズレ、
  // 指が20px動いた時点で発火（カレンダーの開閉）。カードは指と1対1で動く（上限40px）
  // ※appGridRef の宣言は上部（スケルトン計測の useSkeletonProbeOn より前）に移動済み
  // animate=false（指の追従中）＝transitionを切って1:1でついてくる／animate=true（発火後・指を離した後）
  // ＝transitionを効かせて滑らかに戻す。
  // ★カード要素へ直接インラインで書く（2026-07-27修正）：CSS変数＋クラス指定では、カードの
  //   インラインstyle（transition:background）やアニメーション指定に負けて見た目が動かなかった。
  //   インラインのtransformなら他の指定に勝つ。参照は既にあるjobCardRefs（各求人カードのDOM）を使う
  const setSwipeDx = (px, animate = false) => {
    Object.values(jobCardRefs.current).forEach(el => {
      if (!el) return;
      el.style.transition = animate ? "transform .18s ease, background .5s" : "background .5s";
      el.style.transform = px ? `translateX(${px}px)` : "";
    });
    const grid = appGridRef.current;
    if (grid) grid.classList.toggle("cb-swiping", !animate && px !== 0); // 案内文の点灯（CSS側）
  };
  const appSwipeRef = useRef(null);
  const onAppSwipeMove = (e) => {
    const s = appSwipeRef.current; if (!s || s.fired) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (s.lock == null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;      // まだ向きが決まっていない
      // 斜めのスワイプも横として拾う（2026-07-27たきと指示「判定が厳しい」）。
      // 真下・真上へ引いた時だけ縦（＝スクロール）に倒す
      s.lock = Math.abs(dx) >= Math.abs(dy) * 0.7 ? "h" : "v"; // 一度決めたら最後まで変えない
    }
    if (s.lock !== "h") return;                               // 縦スクロールは邪魔しない
    // 追従は指と1対1（たきと指示「指に連動させて」）。上限だけ設けて画面外まで流れないようにする
    setSwipeDx(Math.max(-40, Math.min(40, dx)));
    if (Math.abs(dx) >= 20) {                                 // 20pxで発火（30pxは厳しすぎた・たきと報告）
      s.fired = true;
      // ズレた形をひと呼吸だけ見せてから戻す＝「ここで効いた」が目で分かる
      setSwipeDx(dx > 0 ? 20 : -20, true);
      setTimeout(() => setSwipeDx(0, true), 160);
      toggleCalTop();
    }
  };
  const onAppSwipeStart = (e) => {
    const inHScroll = (() => {
      for (let n = e.target; n && n !== e.currentTarget; n = n.parentElement) {
        try {
          const st = window.getComputedStyle(n);
          if ((st.overflowX === "auto" || st.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
        } catch { return true; }
      }
      return false;
    })();
    appSwipeRef.current = inHScroll ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: null, fired: false };
  };
  // 指を離したら追従を戻すだけ（発火はonAppSwipeMoveの20px時点で済んでいる）
  const onAppSwipeEnd = () => { appSwipeRef.current = null; setSwipeDx(0, true); };

  // また呼びたいリストのアイコンタップ→働き手詳細モーダル（応募者カードと同じWorkerTrustCard表示）
  const [rosterDetail, setRosterDetail] = useState(null); // {worker_id, loading, profile, trust}
  const openRosterDetail = (workerId) => {
    setRosterDetail({ worker_id: workerId, loading: true, profile: null, trust: null });
    (async () => {
      try {
        const [wpRes, trustRes] = await Promise.all([
          // 未承認の自己紹介(pr_pending等)を農家に渡さないため、承認済み列だけ返すRPC経由（2026-08-07）
          fetchWorkerProfileForFarmer(workerId),
          fetchWorkerTrustInfo(workerId),
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
      const { error } = await deleteRoster(me.id, workerId);
      if (error) { alert('解除に失敗しました：' + error.message); return; }
      setRosterRows(prev => prev.filter(r => r.worker_id !== workerId));
    } catch { alert('解除に失敗しました。'); }
  };

  // 打刻の修正申請（第13弾・追補の訂正／2026-07-30たきと指示「申請権の非対称を解消」）。
  // 申請は相手の承認で成立するので、雇い手から出しても双方署名の構造は崩れない。シートは働き手側と同じ共通部品
  const [corrApp, setCorrApp] = useState(null);

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
        const { data: job } = await fetchMyJobContext(a.job_number, me.id);
        setEmergencyCtx(prev => prev && prev.jobNumber === a.job_number ? {
          ...prev,
          jobLabel: job ? [job.crop, job.task].filter(Boolean).join(" ") : "",
          dateLabel: job && job.date_start ? calFmtDate(job.date_start) + (job.work_time ? " " + job.work_time.split("〜")[0] + "〜" : "") : "",
        } : prev);
      } catch {}
    })();
  };

  // ↓応募者ページの読み込み。ここに置く理由：この中の着地処理が openCompleteModal と
  //   openEmergencyModal を呼ぶため、両方の宣言より後ろでないと宣言前参照になる
  //   （2026-07-29に並べ替え・中身は不変。読み込み処理は上部の入口/求人ローダーと対）
  // 応募者タブを開くたびに応募の最新statusを取り直す（2026-07-16）。
  // 初回マウント時の1回だけだと、働き手側の操作（終了打刻→completed等）が進んでも
  // カードの帯が古いまま（契約のまま）になるため
  useEffect(() => {
    if (jobTab !== "applicants") return;
    (async () => {
      try {
        // 1往復に集約（2026-08-02たきと指示「応募者ページの復元も遅い」）：従来は getSession→
        // ①やること＋応募一覧→②評価＋プロフィール＋信頼情報（＋質問送信済み）の直列2波・計6本で、
        // 全部返るまでスケルトンのままだった。my_farm_applicants（SECURITY INVOKER＝各テーブルの
        // RLSがそのまま適用・見える範囲は従来の直叩きと同一）が全部まとめて返す
        const { data: bundle, error } = await fetchMyFarmApplicants();
        if (error || !bundle) { setAppsLoading(false); return; }
        const appData = bundle.apps || [];
        // 未対応（＝こちらの番）の応募＝やること・バッジと同じ単一ソース my_todo_items 由来（2026-07-26たきと指示）。
        // hireは除外：承認後ずっと出続ける段ので、質問送信後の「働き手の回答待ち」でも跳ね続けてしまう。
        // 除外すると流れが正しく出る＝承認直後はinterview(質問を送る)で跳ね、送ったら静止（働き手の番）、
        // 働き手が答えるとchat(未読)で再び跳ねる。やることリスト側のhireはそのまま（表示だけの調整）
        setTodoAppIds(new Set((bundle.todo || []).filter(t => t.stage !== "hire").map(t => t.application_id)));
        setDbApplicants(appData);
        setQSentAppIds(new Set(bundle.qsent_ids || []));
        // 自分が書いた評価（お仕事の流れバーの「評価」段の判定）。RLS「review select own」で自分の行のみ
        setReviewedAppIds(new Set(bundle.reviewed_ids || []));
        if (Array.isArray(bundle.profiles) && bundle.profiles.length > 0) {
          // farm:wp はこれまで読むだけで書かれておらず、名前・アイコンが毎回ネット待ちだった（2026-08-02修理）
          setWorkerProfiles(prev => { const m = { ...prev }; bundle.profiles.forEach(wp => { m[wp.auth_id] = wp; }); setCache("farm:wp", m); return m; });
        }
        if (bundle.trust) {
          // { worker_id: {ok,...} }。権限の無いidはキーごと入らない（DB側で1人ずつ判定）
          const trustMap = {};
          Object.entries(bundle.trust).forEach(([wid, v]) => { if (v && v.ok) trustMap[wid] = v; });
          setWorkerTrust(trustMap); setCache("farm:trust", trustMap);
        }
        // ここから下は、今日ページ・緊急連絡メールからの着地（応募が手元に揃ってから判定する）。
        // 行き先はいずれも応募者ページなので、応募をこの面で読む今の形と噛み合っている
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
            // completed も対象（評価だけ残っている応募・2026-07-27）。以前は進行中の状態しか通さず、
            // 今日ページの「完了して評価する」が完了済みの応募では何も開かなかった
            if (target && (CHAT_ELIGIBLE_STATUSES.includes(target.status) || target.status === 'completed')) openCompleteModal(target);
          }
        } catch {}
        // 応募者シートの着地（2026-08-05）：新着の応募ページ（#/new-applicants）の
        // 「内容を見て決める（承認・見送り）」から cb_openApplicantId 経由で該当応募のシートを自動展開。
        // 承認・見送りの実行はこのシートが唯一の窓口ので、送り出す側は「どの応募か」だけを渡す
        try {
          const pendO = sessionStorage.getItem("cb_openApplicantId");
          if (pendO) {
            sessionStorage.removeItem("cb_openApplicantId");
            if (appData.some(x => x.id === pendO)) setSheetApplicantId(pendO);
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
      } catch {}
      setAppsLoading(false);
    })();
  }, [jobTab, appsRefreshTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const submitEmergency = async () => {
    if (!emergencyModalApp || !emergencyKind || !emergencyReason.trim() || emergencySubmitting) return;
    setEmergencySubmitting(true);
    try {
      const { error } = await insertAttendanceEvent({
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
  // お仕事の流れ（雇い手側・2026-07-26たきと指示）：働き手側FlowBar（WorkerApplications）の鏡写し。
  // 芯は両者共通（承認→面接→採用→仕事→完了報告→評価）で、頭だけ違う＝働き手「応募」／雇い手「掲載」
  // （CLAUDE.md「正規フロー（働き手／雇い手）の整理」に準拠）。現在地は応募行から算出する。
  const EMP_FLOW_STEPS = ["掲載", "承認", "面接", "採用", "仕事", "完了報告", "評価"];
  const empFlowState = (a) => {
    const approved = ["approved","meeting","interview","contracted","working","completed"].includes(a.status);
    const hired    = !!(a.terms_confirmed_worker_at && a.terms_confirmed_farmer_at); // 採用（双方確認）＝面接も済んだ扱い
    const started  = a.status === "working" || a.status === "completed" || !!a.started_at || !!a.farmer_confirmed_start_at;
    const reported = a.status === "completed";
    const reviewed = reviewedAppIds.has(a.id) || (a.status === "completed" && a.attended === false); // 欠勤記録は評価の代わり
    const done = [true, approved, hired, hired, started, reported, reviewed];
    return { done, active: done.findIndex(d => !d) };
  };
  // ※コンポーネントではなく関数として呼ぶ（親の再描画で作り直されても状態を持たないので影響なし）
  const renderEmpFlowBar = (a) => {
    const { done, active } = empFlowState(a);
    return (
      <div style={{ display:"flex", alignItems:"flex-start", marginBottom:12 }}>
        {EMP_FLOW_STEPS.map((s, i) => {
          const isDone = done[i]; const isActive = i === active;
          const reached = isDone || isActive;
          return (
            <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
              {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? ROLE_GREEN : "#E5E5E5" }} />}
              <div style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, boxSizing:"border-box",
                background: isDone ? ROLE_GREEN : "#fff", border: isDone ? "none" : isActive ? "2px solid " + ROLE_GREEN : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? ROLE_GREEN : "#C8C8C8" }}>
                {isDone ? "✓" : ""}
              </div>
              <span className="f-sans" style={{ fontSize:9, marginTop:4, lineHeight:1.2, textAlign:"center", color: reached ? ROLE_GREEN : "#B0B0B0", fontWeight: isActive ? 700 : 500 }}>{s}</span>
            </div>
          );
        })}
      </div>
    );
  };
  // 保留・対応済み（2026-08-16たきと裁定）：未回答の督促メール（12〜72時間）の4択のうち、
  // 判断を保留する／サイトの外を含め対応を済ませた、を記録する。statusは変えず時刻だけ追記＝
  // 帯・FlowBar・失効の仕組みには一切触れない（書き込みの窓口は set_application_followup 1本）
  // 押した瞬間には記録しない（2026-08-16たきと指示「どちらも一度だけ押すと最終確認展開。
  // OKで保留と対応済みは非表示」）＝ {id, kind} を持ってその応募の下に最終確認を開き、OKで初めて記録する。
  // 記録できたら両方のボタンを畳む＝取り消し（clear）の道はこの画面から無くなる。
  // ★2度押しでリセットされる／対応済みのあとに保留を押しても画面が変わらない（handled_at優先の表示）を
  //   同時に解消：1件につき1回だけ・押した後は出さない、という形にする
  const [followupConfirm, setFollowupConfirm] = useState(null); // { id, kind } | null
  const [followupBusy, setFollowupBusy] = useState(false);
  const setFollowup = async (a, kind) => {
    if (followupBusy) return;
    setFollowupBusy(true);
    const { data, error } = await setApplicationFollowup(a.id, kind);
    setFollowupBusy(false);
    if (error || !data?.ok) { fbError(); alert('保存に失敗しました：' + (data?.reason || error?.message || '不明')); return; }
    setDbApplicants(prev => prev.map(x => x.id === a.id ? { ...x, held_at: data.held_at, handled_at: data.handled_at } : x));
    setFollowupConfirm(null);
    fbSuccess();
  };
  const renderApplicantCard = (a) => {
    // 旧・独自のチップ配色(badgeColor)は廃止（2026-07-26）：現在地バナーが段階色APP_PHASE_COLORを使う
    const wp = workerProfiles[a.worker_id];
    // 操作ボタン（2026-07-27たきと指示）：現在地バナーの直下とカード末尾の2箇所に同じものを置く。
    // 上＝状態を読んだ直後にそのまま押せる／下＝プロフィールを読み終えた流れで押せる。
    /* ── ボタンは段階で出し分け（2026-07-26たきと指示）：
                  応募中＝見送る／承認する → 承認後（質問未送信）＝質問を送る／チャットを開く →
                  初面接後（質問送信済み）＝質問を送る／採用する → 採用後＝チャットを開く。
                  段階はappPhaseKey（帯と同じ唯一のソース）＋interview_question_sends（質問送信履歴）で判定 ── */
    const actionButtons = (() => {
                const phase = appPhaseKey(a);
                const chatBtn = (
                  <button onClick={()=>{ window.location.hash="/chat/"+a.id; }} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>💬 チャットを開く</button>
                );
                if (phase === "applied") {
                  // 4択（承認・見送り・保留・対応済み）＝督促メールの文面と同じ選択肢を画面にも置く。
                  // 保留・対応済みは判断そのものではないので、下段に控えめに並べる
                  const followup = a.handled_at ? "handled" : a.held_at ? "held" : null;
                  // 最終確認を開いている種類（この応募のぶんだけ）。押した時点では記録しない
                  const askKind = (followupConfirm && followupConfirm.id === a.id) ? followupConfirm.kind : null;
                  const subBtn = (label, kind) => {
                    const on = askKind === kind; // 確認を開いている側を点灯（どちらを押したかが分かる）
                    return (
                      <button onClick={()=>setFollowupConfirm({ id: a.id, kind })} className="f-sans" style={{
                        flex:1, padding:"9px", fontSize:12, fontWeight:600, cursor:"pointer", borderRadius:9,
                        background: on ? "#F0F7F4" : "#fff", color: on ? "#00794D" : "#999",
                        border: "1px solid " + (on ? "#00A86B" : "#EBEBEB"),
                      }}>{label}</button>
                    );
                  };
                  return (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={async ()=>{
                        if (!confirm('この応募を見送りますか？')) return;
                        const { data, error } = await rejectApplication(a.id);
                        if (error || !data?.ok) { fbError(); alert('処理に失敗しました：' + (data?.reason || error?.message || '不明')); return; }
                        setDbApplicants(prev => prev.map(x => x.id===a.id ? {...x, status:'rejected'} : x));
                      }} className="f-sans" style={{ flex:1, padding:"12px", fontSize:12, fontWeight:600, background:"#fff", color:"#999", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>見送る</button>
                      <button onClick={async ()=>{
                        const { data, error } = await approveApplication(a.id);
                        if (error || !data?.ok) { fbError(); alert('承認に失敗しました：' + (data?.reason || error?.message || '不明')); return; }
                        setDbApplicants(prev => prev.map(x => x.id===a.id ? {...x, status:'approved'} : x));
                        fbSuccess(); setCelebrate({ emoji:"✅", title:"承認しました" });
                      }} className="f-sans" style={{ flex:2, padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>承認する</button>
                    </div>
                    {/* 記録が済んだら両方とも出さない（2026-08-16たきと指示「OKで保留と対応済みは非表示」） */}
                    {!followup && (
                      <div style={{ display:"flex", gap:8 }}>
                        {subBtn("保留", "hold")}
                        {subBtn("対応済み", "handled")}
                      </div>
                    )}
                    {/* 最終確認（押したボタンの下にその場で開く）。OKで初めて記録する */}
                    {!followup && askKind && (
                      <div className="fade-in" style={{ background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:10, padding:"12px 14px" }}>
                        <p className="f-sans" style={{ fontSize:12, color:"#222", margin:"0 0 10px", lineHeight:1.8 }}>
                          {askKind === "hold" ? "この応募を保留にします。" : "この応募を対応済みにします。"}<br />
                          未回答のお知らせメールは止まります。承認・見送りの判断はまだ済んでいません（あとから決められます）。<br />
                          <span style={{ color:"#717171" }}>この記録は、あとから取り消せません。</span>
                        </p>
                        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                          <button onClick={()=>setFollowupConfirm(null)} disabled={followupBusy} className="f-sans"
                            style={{ padding:"8px 16px", fontSize:12, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:9, cursor:"pointer" }}>キャンセル</button>
                          <button onClick={()=>setFollowup(a, askKind)} disabled={followupBusy} className="f-sans"
                            style={{ padding:"8px 20px", fontSize:12, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:9, cursor:"pointer", opacity: followupBusy ? 0.6 : 1 }}>{followupBusy ? "..." : "OK"}</button>
                        </div>
                      </div>
                    )}
                    {followup && (
                      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:0, lineHeight:1.6 }}>
                        {followup === "held" ? "保留にしました。" : "対応済みにしました。"}
                        未回答のお知らせメールは止まります。
                        承認・見送りの判断は、まだ済んでいません。
                      </p>
                    )}
                  </div>
                  );
                }
                if (phase === "interview") return (
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>setSendQTarget(a)} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#555", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>📋 質問を送る</button>
                    {qSentAppIds.has(a.id)
                      ? <button onClick={goHirePage} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>🤝 採用する →</button>
                      : chatBtn}
                  </div>
                );
                // 採用〜作業中（＝作業日が来ている／来る応募）に「完了・欠勤を記録」を置く（2026-07-30たきと指摘
                // 「働き手がこなかった場合の措置がない」）。これまでは今日ページの「作業の開始を確認」を
                // 押した後にしか完了モーダルへ行けず、来なかった時は開始を確認するしかない（＝事実と違う記録を
                // 迫る）状態だった。complete_work は承認済み〜作業中を受け付ける（開始確認は要件でない）ため、
                // ここから直接「働き手は来ましたか？」→「来なかった」に入れる。作業日前は
                // RPCが「開始日はまだ先です」と理由付きで断る
                if (phase === "contracted" || phase === "working") return (
                  <div style={{ display:"flex", gap:8 }}>
                    {chatBtn}
                    <button onClick={()=>openCompleteModal(a)} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>✅ 完了・欠勤を記録</button>
                  </div>
                );
                // 完了（出勤あり）でまだ評価していない応募＝評価ボタンを出す（2026-07-27たきと指示）。
                // 欠勤記録済み（attended===false）は評価の代わりので出さない。評価後はチャットだけに戻る
                if (phase === "completed" && a.attended !== false && !reviewedAppIds.has(a.id)) return (
                  <div style={{ display:"flex", gap:8 }}>
                    {chatBtn}
                    <button onClick={()=>openCompleteModal(a)} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>⭐ 評価する</button>
                  </div>
                );
                return <div style={{ display:"flex", gap:8 }}>{chatBtn}</div>;
    })();
    return (
      <div key={a.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
              {/* 現在地バナー（2026-07-26たきと指示）：ステータスと説明を1つの帯にまとめる。
                  色は段階色（APP_PHASE_COLOR）を左バーと見出しに、背景はその薄色（+"14"＝約8%不透明）。
                  文面はAPP_PHASE_DESC＝帯・凡例・タップ説明と同じ唯一のソースので言い回しが枝分かれしない */}
              {(() => {
                const pk = appPhaseKey(a);
                const c = APP_PHASE_COLOR[pk] || "#717171";
                return (
                  <div style={{ background: c + "14", borderLeft: "4px solid " + c, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:c, margin:0 }}>{appRibbonLabel(a)}</p>
                    {APP_PHASE_DESC[pk] && (
                      <p className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.7, margin:"3px 0 0" }}>{APP_PHASE_DESC[pk]}</p>
                    )}
                  </div>
                );
              })()}
              {/* バナー直下の操作ボタン（末尾と同じもの・2箇所） */}
              <div style={{ marginBottom:12 }}>{actionButtons}</div>
              {/* お仕事の流れ（現在地）。見送り・失効は流れが途中で終わるので出さない（バナーが理由を説明する） */}
              {a.status !== "rejected" && a.status !== "expired" && renderEmpFlowBar(a)}
              {/* 打刻の事実の質（第13弾・追補）：申告打刻の印と、双方の署名時刻の乖離。
                  申告打刻に承認は課さない代わりに、農家が見て気づける形で必ず出す */}
              {a.started_at && (
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 6px" }}>
                  開始 {new Date(a.started_at).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})}
                  <DeclaredBadge show={a.started_declared} />
                  {a.time_corrected && <span className="f-sans" style={{ marginLeft:6, fontSize:10, fontWeight:700, color:"#717171", background:"#F0F0F0", borderRadius:4, padding:"1px 5px" }}>修正済み</span>}
                </p>
              )}
              <PunchGapNotice app={a} onRequestCorrection={()=>setCorrApp(a)} correctionLabel="🕐 実際と違う場合は → 修正を申請" />
              <div style={{ marginBottom:10 }}>
                <WorkerTrustCard profile={wp || {}} trust={workerTrust[a.worker_id]} />
                {/* 契約成立後のみ本名を開示（当事者間・KYC非複製・2026-07-30たきと裁定(B)） */}
                <ContractPartyName applicationId={a.id} showPending={false} />
                {/* 緊急連絡先も採用成立後のみ（同じ窓口作法・2026-08-03） */}
                <ContractEmergencyContact applicationId={a.id} />
                <MyReviewsOfWorker workerId={a.worker_id} />
              </div>
              {/* Q&Aはチャットと同じコメント形式（2026-08-06たきと指示）。💪希望する作業の強さも質問要素として合流 */}
              <QaChat items={workerQaItems(wp)} style={{ marginTop:10, marginBottom:10 }} />
              {/* 求人＝ステータスページのボックスと同じカード＋動き（2026-08-08たきと指示
                  「ここも同じにしよう。アニメーションもコピー」）：旧・下線リンク（タップで求人プレビュー）を
                  廃止し、wide JobCardに。タップ＝面全体の演出→シート内の詳細面へスライド（DragSheetのdetail）。
                  jobs_publicの読み足し（sheetJobFull）が届くまで／非公開求人は手元の情報で仮の姿
                  （報酬0円やダミーは出さない＝JobCard側でpay>0のみ表示） */}
              {(() => {
                const info = jobInfoMap[a.job_number] || dbActive.find(d => d.job_number === a.job_number) || dbDrafts.find(d => d.job_number === a.job_number) || {};
                const full = sheetJobFull[a.job_number];
                const job = full || {
                  id: a.job_number, crop: info.crop || "", task: info.task || "", photos: info.photos || [],
                  region: "", dateStartRaw: info.date_start || "", dateEndRaw: info.date_end || "", pay: 0,
                };
                return (
                  <div style={{ margin:"0 0 8px" }}>
                    <JobCard job={job} variant="wide" onOpen={()=>{ if (!sheetShowcase && sheetPane === "main") setSheetShowcase(true); }} />
                  </div>
                );
              })()}
              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:8 }}>応募日 {new Date(a.created_at).toLocaleDateString("ja-JP")}</p>
              {/* 来られる日（期間求人・すり合わせの起点・2026-07-24） */}
              <AvailDatesChips value={a.available_dates} />
              {/* 働く日（確定済み・2026-07-24 追記3） */}
              <AgreedDatesRow value={a.agreed_dates} />
              {/* 状態メモ（進行の記録は小さく残す・操作は今日ページ） */}
              {a.status === "completed" && (
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color: a.attended===false ? "#E24B4A" : "#00A86B", margin:"0 0 8px" }}>{a.attended===false ? "欠勤記録済み" : "✓ 完了・評価済み"}</p>
              )}
              {actionButtons}
      </div>
    );
  };
  return (
    // 入口(home)は余白を持たない＝働き手入口と開始位置・下端が完全一致（外側のプロフィールwrapperが32px/4pxを提供）
    // サブページの上空白は15px固定（2026-07-25応募者→2026-07-26求人タブも・たきと指示で全サブページ統一）
    // 応募者ページは下余白もCSS側(20px)へ一本化するので、コンテナ自身の下80pxは持たせない（2026-07-26たきと指示）
    <div className={jobTab === "applicants" ? "emp-applicants-page" : undefined} style={{ maxWidth:1200, margin:"0 auto", padding: jobTab === "home" ? "0" : jobTab === "applicants" ? "15px 0 0" : "15px 0 80px" }}>
      {celebrate && <Celebration {...celebrate} onDone={()=>setCelebrate(null)} />}
      {jobTab === "home" ? (
        <>
          {/* ═══ Airbnb型入口メニュー（2026-07-14）：大プロフィールカード＋絵文字カード格子＋ワイド求人作成カード。
               文字タブの羅列を廃止し、タップで各サブページへ ═══ */}
          {/* トップボックスは反転式（2026-07-16・働き手側と同構造）：表=アイコン＋農園名／裏=アイコン・名前抜きのプレビュー。右上⇄で反転0.8秒 */}
          <div style={{ position:"relative" }}>
            <button onClick={()=>{ window.location.hash="/profile/employer/profile"; }}
              className={"f-sans" + (empTopAnim ? " " + empTopAnim : empUnsetReq > 0 ? " cb-urgent-card" : empUnsetCount > 0 ? " cb-urgent-still" : "")}
              onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && empTopAnim === "pflip-in") setEmpTopAnim(""); }}
              style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid " + ROLE_GREEN, borderRadius:24, padding:"28px 20px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box" }}>
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
                  {/* プレビューの統一（2026-07-25たきと指示）：裏面も本物のプレビュー
                      （EmployerPreviewSheet＝働き手が見る構造：FarmerTrustCard＋待遇チップ）と同一にする */}
                  {empMini ? (
                    <>
                      <FarmerTrustCard profile={empMini} trust={empTrust} />
                      {perkBadges(empMini).length > 0 && (
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:14 }}>
                          {perkBadges(empMini).map(b => (
                            <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{b}</span>
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
          {/* 新しく委託を出す（2026-07-31たきと指示）：求人カードの真下・同じ構造。
              配色はブラック＝委託・受託の世界（求人・求職のオレンジ／ミドリとは分ける）。アイコンは置かない。
              黒いカードそのものが「別の世界への扉」の目印になる。
              管理者のみ表示＝B2B委託レーンは運営の手動1件用の内部道具（市場機能はまだ作らない）。
              画面で隠すだけでなく consignment_deals のRLSが app_admins 限定＝サーバ側でも閉じている */}
          {isAdmin(me) && (
            <button onClick={()=>{ window.location.hash = "/admin/consignment"; }} className="f-sans" style={{ position:"relative", overflow:"hidden", width:"100%", marginTop:12, background:"#111111", border:"none", borderRadius:20, padding:"20px 18px", cursor:"pointer", display:"block", textAlign:"left" }}>
              {/* カードの角を這う白い蔓（2026-07-31たきと指示）。文字はzIndexで蔓の上に */}
              <VineCorner flip size={110} style={{ top:-6, right:-6, opacity:0.5 }} />
              <span className="f-sans" style={{ position:"relative", zIndex:1, display:"block", fontSize:16, fontWeight:800, color:"#fff", letterSpacing:".02em" }}>新しく委託を出す</span>
              <span className="f-sans" style={{ position:"relative", zIndex:1, display:"block", fontSize:13, color:"#B9B9B9", marginTop:4, lineHeight:1.6 }}>圃場ごとの作業を請け負う委託の仕様書を作ります。</span>
            </button>
          )}
          {/* 面接の質問集（2026-07-23）：応募者チャットに送る質問を用意。
              右上⇄で反転（2026-07-29たきと指示）：裏＝作ってある質問集のタイトルを横スクロールで一覧。
              反転はトップボックスと同じ作法（pflip-out→中身入替→pflip-in・0.4s×2）。
              裏面は<div>で描く＝中のタイトルを本物のボタンにできる（button の中に button は置けない） */}
          <div style={{ position:"relative", marginTop:12 }}>
            {!qCardBack ? (
              <button onClick={openQMgr} className={"f-sans" + (qCardAnim ? " " + qCardAnim : "")}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && qCardAnim === "pflip-in") setQCardAnim(""); }}
                style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:100, boxSizing:"border-box" }}>
                <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>📋</span>
                <span style={{ minWidth:0, paddingRight:28 }}>
                  <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>面接の質問集</span>
                  <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>聞きたいことをセットにして、応募者のチャットに送れます。回答もチャットに残ります。</span>
                </span>
              </button>
            ) : (
              <div className={"f-sans" + (qCardAnim ? " " + qCardAnim : "")}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && qCardAnim === "pflip-in") setQCardAnim(""); }}
                style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:100, boxSizing:"border-box", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 10px", paddingRight:28 }}>📋 質問集（{questionSets.length}）</p>
                {questionSets.length === 0 ? (
                  <button onClick={openQMgr} className="f-sans" style={{ background:"none", border:"none", padding:0, textAlign:"left", fontSize:13, color:"#717171", lineHeight:1.6, cursor:"pointer" }}>まだありません。タップして作成できます。</button>
                ) : (
                  /* 横スクロール（たきと指示）：タイトルの箱を横一列に。タップでその場にボックスが開き、
                     質問をここで直接入力できる（2026-07-29たきと指示）。もう一度タップで畳む */
                  <>
                    <div style={{ display:"flex", gap:8, overflowX:"auto", WebkitOverflowScrolling:"touch", margin:"0 -16px", padding:"2px 16px" }}>
                      {questionSets.map(s => {
                        const on = qEditing?.id === s.id;
                        return (
                          <button key={s.id} onClick={()=>setQEditing(on ? null : { id:s.id, title:s.title || "", questions:(s.questions && s.questions.length) ? [...s.questions] : [""] })}
                            className="f-sans" style={{ flexShrink:0, maxWidth:200, background: on ? "#EAF7F1" : "#F7F7F7", border:"1px solid " + (on ? ROLE_GREEN : "#EBEBEB"), borderRadius:12, padding:"10px 14px", cursor:"pointer", textAlign:"left" }}>
                            <span style={{ display:"block", fontSize:13, fontWeight:700, color: on ? ROLE_GREEN : "#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.title || "無題"}</span>
                            <span style={{ display:"block", fontSize:11, color:"#B0B0B0", marginTop:2 }}>{(s.questions || []).length}問</span>
                          </button>
                        );
                      })}
                    </div>
                    {qEditing?.id && (
                      /* 展開したボックス：この質問集の質問をその場で入力・保存する。
                         状態(qEditing)と保存(saveQuestionSet)は質問集ページと共用＝入力の作法が2つに割れない */
                      <div className="fade-in" style={{ marginTop:12, background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:14, padding:"14px" }}>
                        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"0 0 8px" }}>{qEditing.title || "無題"} の質問（最大5問）</p>
                        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:10 }}>
                          {qEditing.questions.map((q,i) => (
                            <div key={i} style={{ display:"flex", gap:8, alignItems:"center" }}>
                              <span className="f-sans" style={{ fontSize:13, color:"#999", flexShrink:0, width:16 }}>{i+1}.</span>
                              <input value={q} onChange={e=>setQEditing(prev=>({ ...prev, questions: prev.questions.map((x,j)=> j===i ? e.target.value : x) }))} placeholder={`質問${i+1}`} className="field f-sans" style={{ fontSize:14, flex:1, minWidth:0, background:"#fff" }} />
                              {qEditing.questions.length > 1 && (
                                <button onClick={()=>setQEditing(prev=>({ ...prev, questions: prev.questions.filter((_,j)=>j!==i) }))} aria-label="削除" className="f-sans" style={{ flexShrink:0, width:32, height:32, borderRadius:8, background:"#EBEBEB", border:"none", color:"#999", fontSize:16, cursor:"pointer" }}>×</button>
                              )}
                            </div>
                          ))}
                        </div>
                        {qEditing.questions.length < 5 && (
                          <button onClick={()=>setQEditing(prev=>({ ...prev, questions:[...prev.questions, ""] }))} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"9px", width:"100%", fontSize:13, color:ROLE_GREEN, cursor:"pointer", fontWeight:600, marginBottom:10 }}>＋ 質問を追加</button>
                        )}
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={()=>setQEditing(null)} className="f-sans" style={{ flex:"0 0 auto", padding:"11px 16px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>閉じる</button>
                          <button onClick={saveQuestionSet} disabled={qSaving} className="f-sans" style={{ flex:1, padding:"11px", fontSize:14, fontWeight:700, background:ROLE_GREEN, color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{qSaving ? <>保存中<Dots /></> : "保存する"}</button>
                        </div>
                        {/* タイトルの変更・削除は質問集ページで（ここは質問の入力に絞る） */}
                        <button onClick={()=>{ qMgrScrollY.current = window.scrollY; setQMgrOpen(true); }} className="f-sans" style={{ width:"100%", marginTop:8, padding:"6px", fontSize:12, background:"none", border:"none", color:"#B0B0B0", cursor:"pointer" }}>タイトルの変更・削除はこちら →</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <button onClick={()=>{
              if (qCardAnim === "pflip-out") return; // 連打ガード
              setQEditing(null);                     // 開いていた入力ボックスは畳んでから返す
              setQCardAnim("pflip-out");
              setTimeout(()=>{ setQCardBack(v=>{ const nv = !v; try { localStorage.setItem("cb_qCardBack", nv ? "1" : "0"); } catch {} return nv; }); setQCardAnim("pflip-in"); }, 400);
            }} aria-label="表示を切り替える" style={{ position:"absolute", top:12, right:12, width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>⇄</button>
          </div>
          {/* 保険の準備（2026-07-24・専用ページ#/insuranceへ遷移）。アプリ内遷移の目印を残し、戻るは history.back で元の場所（スクロール位置）へ復帰させる。
              質問集カードと同じ反転式（2026-07-29たきと指示）：裏＝保険の箱を横スクロール、タップでその場に開いて申告できる */}
          <div style={{ position:"relative", marginTop:12 }}>
            {!insCardBack ? (
              <button onClick={()=>{ try{ sessionStorage.setItem("cb_insFromApp","1"); }catch{} window.location.hash="/insurance"; }}
                className={"f-sans" + (insCardAnim ? " " + insCardAnim : "")}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && insCardAnim === "pflip-in") setInsCardAnim(""); }}
                style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:100, boxSizing:"border-box" }}>
                <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>🛡</span>
                <span style={{ minWidth:0, paddingRight:28 }}>
                  <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>保険の準備</span>
                  <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>働き手のケガに備える保険の準備方針を、自己申告で表明できます。</span>
                </span>
              </button>
            ) : (
              <div className={"f-sans" + (insCardAnim ? " " + insCardAnim : "")}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && insCardAnim === "pflip-in") setInsCardAnim(""); }}
                style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:100, boxSizing:"border-box", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 10px", paddingRight:28 }}>🛡 保険の準備（自己申告・{insItems.length}件）</p>
                <div style={{ display:"flex", gap:8, overflowX:"auto", WebkitOverflowScrolling:"touch", margin:"0 -16px", padding:"2px 16px" }}>
                  {insOrderedItems.map(it => {
                    const on = insItems.includes(it.k);
                    const open = insOpenKey === it.k;
                    return (
                      /* 箱の色（2026-07-29たきと指示）：既定=元のまま／申告ずみ=縁だけ緑／開いている=全体が緑 */
                      <button key={it.k} onClick={()=>setInsOpenKey(open ? null : it.k)}
                        className="f-sans" style={{ flexShrink:0, maxWidth:200, background: open ? ROLE_GREEN : "#F7F7F7", border:"1px solid " + (open || on ? ROLE_GREEN : "#EBEBEB"), borderRadius:12, padding:"10px 14px", cursor:"pointer", textAlign:"left" }}>
                        <span style={{ display:"block", fontSize:13, fontWeight:700, color: open ? "#fff" : "#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.icon} {it.chip}</span>
                        <span style={{ display:"block", fontSize:11, color: open ? "rgba(255,255,255,.85)" : on ? ROLE_GREEN : "#B0B0B0", marginTop:2 }}>{on ? "申告ずみ ✓" : "未申告"}</span>
                      </button>
                    );
                  })}
                </div>
                {insOpenKey && (() => {
                  const it = INSURANCE_ITEMS.find(x => x.k === insOpenKey);
                  const on = insItems.includes(insOpenKey);
                  return (
                    /* 展開したボックス：この保険の申告ON/OFFと、働き手へのひとことをその場で入力する */
                    <div className="fade-in" style={{ marginTop:12, background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:14, padding:"6px 14px 14px" }}>
                      <ToggleSwitch label={it.label} checked={on} onChange={(v)=>toggleInsurance(insOpenKey, v)} />
                      {on && (
                        <textarea value={insNotes[insOpenKey] || ""} onChange={e=>setInsNotes(prev => ({ ...prev, [insOpenKey]: e.target.value }))}
                          placeholder="働き手へのひとこと（任意・例：加入している保険会社や補償の範囲など）" rows={2} maxLength={300}
                          className="field f-sans" style={{ fontSize:13, resize:"vertical", width:"100%", boxSizing:"border-box", background:"#fff", marginTop:2 }} />
                      )}
                      <div style={{ display:"flex", gap:8, marginTop:10 }}>
                        <button onClick={()=>setInsOpenKey(null)} className="f-sans" style={{ flex:"0 0 auto", padding:"11px 16px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>閉じる</button>
                        <button onClick={saveInsurance} disabled={insSaving} className="f-sans" style={{ flex:1, padding:"11px", fontSize:14, fontWeight:700, background:ROLE_GREEN, color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{insSaving ? <>保存中<Dots /></> : "保存する"}</button>
                      </div>
                      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"8px 0 0", lineHeight:1.6 }}>自己申告です。運営が確認するものではありません。</p>
                    </div>
                  );
                })()}
              </div>
            )}
            <button onClick={()=>{
              if (insCardAnim === "pflip-out") return; // 連打ガード
              setInsOpenKey(null);                     // 開いていた入力ボックスは畳んでから返す
              setInsCardAnim("pflip-out");
              setTimeout(()=>{ setInsCardBack(v=>{ const nv = !v; try { localStorage.setItem("cb_insCardBack", nv ? "1" : "0"); } catch {} return nv; }); setInsCardAnim("pflip-in"); }, 400);
            }} aria-label="表示を切り替える" style={{ position:"absolute", top:12, right:12, width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>⇄</button>
          </div>
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
      ) : (jobTab==="calendar" || jobTab==="applicants" || jobTab==="profile") ? null : (
        /* 応募者ページの見出し「応募者」は削除（2026-07-26たきと指示）。現在地は下部ナビの点灯が示す。
           「雇い手プロフィール」の見出しも削除（2026-08-03たきと指示・名刺カードから開けば現在地は明らか） */
        <h2 className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 16px" }}>{(JOB_TABS.find(t => t.k === jobTab) || {}).l || ""}</h2>
      )}
      {/* 作成中⇄公開中はページャー（2026-07-16）：文字・絵文字・ボタン・カードが指に追従して実際に横移動する */}
      {(jobTab==="draft" || jobTab==="active") ? (
      <div onTouchStart={onPagerStart} onTouchMove={onPagerMove} onTouchEnd={onPagerEnd} style={{ overflow:"hidden", touchAction:"pan-y" }}>
        <div ref={pagerTrackRef} style={{ display:"flex", width:"200%", transform: jobTab==="draft" ? "translateX(0%)" : "translateX(-50%)", transition:"transform .3s ease" }}>
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingRight:5 }}>
            <div ref={skelDraftRef} style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>{/* 作成中パネル（メルカリ風・横3列） */}
      {draftsLoading ? (
          /* 「読み込み中...」の文字でなく、前回この面が実際に描いた形の仮配置を並べる（2026-07-27たきと指示） */
          <div style={{ gridColumn:"1/-1" }}><AutoSkeleton shapeKey="farmDrafts" /></div>
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
              const photo = photoThumb(d.photos?.[0]);
              const nearPublish = d.status === "pending"; // 掲載申請済み＝公開の準備中（「公開間近」）
              return (
              <button key={d.job_number}
                onClick={()=> armedAction ? handleArmedCardTap(d)  // モード中はカード直接タップ＝実行（2026-08-07）
                  : nearPublish
                  ? setNearPublishInfo(true)  // 公開間近は詳細も求人者も見せず、説明ボックスを展開する
                  : setPreviewJob({ num: d.job_number, draft: d.status === "draft", published: !!d.opened_at })}
                className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                  {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : (nearPublish ? "🌱" : "📝")}
                  {/* タブ名（作成中）と同じ帯は出さない（重複排除）。公開間近だけ帯を出す＝「審査中」ではなく前向きな色（2026-08-07） */}
                  {nearPublish && <StatusRibbon label="公開間近" color="#0E8A6B" />}
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
                {pending.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#0E8A6B", margin:"8px 0 -2px" }}>公開間近（{pending.length}）</p>}
                {pending.map(renderDraftCard)}
              </>
            );
          })()
        )}
            </div>
          </div>
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingLeft:5 }}>
            <div ref={skelActiveRef} style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>{/* 公開中パネル（メルカリ風・横3列） */}
      {draftsLoading ? (
          /* 読み込み中に「公開中の求人はありません」を出すと一瞬ゼロに見える。確定するまでは仮配置 */
          <div style={{ gridColumn:"1/-1" }}><AutoSkeleton shapeKey="farmActive" /></div>
        ) : (dbActive.length === 0 && dbExpired.length === 0) ? (
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
              const photo = photoThumb(d.photos?.[0]);
              return (
              <div key={d.job_number} onClick={()=> armedAction ? handleArmedCardTap(d)  // モード中はカード直接タップ＝実行（2026-08-07）
                : setPreviewJob({ num: d.job_number, draft: d.status === "draft", open: d.status === "open", published: !!d.opened_at })} style={{ border:"1px solid #EBEBEB", borderRadius:12, overflow:"hidden", background:"#fff", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                  {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter: ended ? "grayscale(40%)" : "none" }} /> : (ended ? "🍂" : "🌾")}
                  {/* 帯は見出しと重複させない（2026-07-25／2026-07-27たきと指示）：タブ名と同じ「公開中」に加え、
                      区画見出し「終了（N）」があるので終了の帯も出さない（写真のグレースケール＋🍂で十分伝わる） */}
                  {!ended && d.status !== "open" && <StatusRibbon label={d.status==="draft" ? "一時非公開" : "公開間近"} color={d.status==="draft" ? "#757575" : "#0E8A6B"} />}
                  {qUnansweredMap[d.job_number] > 0 && (
                    // ❓バッジのタップ＝その求人の質問タブへ直行（2026-07-27たきと指示）。
                    // カード本体のプレビュー展開とは別動作なのでstopPropagation。戻るはこのページへ。
                    // 求人詳細はjobs_public（公開中のみ）を読むため、公開中でない・終了した求人では
                    // 詳細が開けないため、その場合は従来どおりカードのプレビューに任せる（バッジは表示のみ）
                    <span onClick={(d.status === "open" && !ended) ? (e => {
                      e.stopPropagation();
                      try { sessionStorage.setItem("cb_jobBackTo", "/profile/employer/active"); } catch {}
                      window.location.hash = "/work/job/" + d.job_number + "/questions";
                    }) : undefined}
                      role={(d.status === "open" && !ended) ? "button" : undefined}
                      aria-label={(d.status === "open" && !ended) ? "未回答の質問を見る" : undefined}
                      className="f-sans" style={{ position:"absolute", top:6, right:6, background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, borderRadius:20, padding:"2px 8px", boxShadow:"0 1px 4px rgba(0,0,0,0.2)", cursor:(d.status === "open" && !ended) ? "pointer" : undefined }}>❓{qUnansweredMap[d.job_number]}</span>
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
      <div ref={appGridRef}
        onTouchStart={jobTab==="applicants" ? onAppSwipeStart : undefined}
        onTouchMove={jobTab==="applicants" ? onAppSwipeMove : undefined}
        onTouchEnd={jobTab==="applicants" ? onAppSwipeEnd : undefined}
        onTouchCancel={jobTab==="applicants" ? onAppSwipeEnd : undefined}
        style={{ display:"grid", gridTemplateColumns: (jobTab==="applicants"||jobTab==="expired") ? "repeat(3, 1fr)" : "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: (jobTab==="applicants"||jobTab==="expired") ? 10 : 20 }}>{/* 求人一覧はメルカリ風に横3列固定・タイトルのみ */}
      {/* 2026-07-14: プレビューページ廃止＝トップボックスタップで直接編集ページへ。プレビューは編集ページ右上→モーダル */}
      {jobTab==="profile" ? (
        <EmployerProfileEdit me={me} />
      ) : jobTab==="applicants" ? (
        appsLoading ? (
          <div style={{ gridColumn:"1/-1" }}><AutoSkeleton shapeKey="farmList:applicants" /></div>
        ) : dbApplicants.length === 0 ? (
          <>
            {calendarTop}
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
              <div style={{ fontSize:40, marginBottom:12 }}>📩</div>
              <p style={{ fontSize:14, margin:0 }}>まだ応募はありません</p>
              <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>求人が公開されると、働き手が応募できます。</p>
            </div>
          </>
        ) : (
          // 応募者を求人毎に分ける（2026-07-19）。上部＝状態フィルタタブ（タップ＋横スワイプ）／下部＝帯の意味の説明（2026-07-22）
          (() => {
            const shown = dbApplicants.filter(a => (APP_FILTERS.find(f => f.k === appFilter) || APP_FILTERS[0]).match(a.status, a));
            const order = []; const byJob = {};
            shown.forEach(a => { const jn = a.job_number; if (!jobInfoMap[jn]) return; if (!byJob[jn]) { byJob[jn] = []; order.push(jn); } byJob[jn].push(a); });
            // 絞り込みバー（2026-07-27たきと指示）：下部バーの真上に浮かせる。
            // スクロール格納・入力中の退避・オーバーレイ中の非表示は、浮遊☰と同じCSS作法で揃えてある
            // （.cb-applicant-filter-bar / body.cb-scroll-hide 等）。PCは従来どおり本文中に並べる
            const filterButtons = APP_FILTERS.map(f => (
              <button key={f.k} onClick={()=>setAppFilter(f.k)} className="f-sans" style={{ flex:"1 0 auto", display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:20, border: appFilter===f.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:13, fontWeight: appFilter===f.k?800:600, color: appFilter===f.k?"#222":"#999", cursor:"pointer", whiteSpace:"nowrap" }}>
                {/* 段階色の点＝帯・凡例と同じAPP_PHASE_COLOR（ステータス絞り込みだと一目で分かる目印） */}
                {f.k !== "all" && <span aria-hidden="true" style={{ width:8, height:8, borderRadius:"50%", background: APP_PHASE_COLOR[f.k] || "#999", flexShrink:0 }} />}
                {f.l}
              </button>
            ));
            const tabBar = (
              <div key="app-tabs" className="cb-applicant-filter-inline" style={{ gridColumn:"1/-1", display:"flex", gap:6, marginBottom:2, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
                {filterButtons}
              </div>
            );
            const floatingFilterBar = (
              <div key="app-tabs-float" className="cb-applicant-filter-bar">{filterButtons}</div>
            );
            // スワイプでカレンダーが開くことの案内（2026-07-27）。開いている間は畳み方を出す
            const calHint = (
              <button key="cal-hint" onClick={toggleCalTop} className="f-sans cb-cal-hint"
                style={{ gridColumn:"1/-1", background:"none", border:"none", padding:"0 0 6px", fontSize:11, color:"#B0B0B0", textAlign:"center", cursor:"pointer" }}>
                {(calOnTop && !calClosing) ? "横スワイプでカレンダーを畳む" : "📅 横スワイプでカレンダーを開く"}
              </button>
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
            // カレンダーで日を選んだのに、その日の求人が今の絞り込みに出ていない時だけ知らせる
            // （「予定がない」はカレンダー側が出すので、ここでは重複させない・2026-07-27）
            const calNote = (calDay && calDay.jobs.length > 0 && !calDay.jobs.some(n => order.includes(n))) ? (
              <p key="cal-note" className="f-sans" style={{ gridColumn:"1/-1", fontSize:12, color:"#B0B0B0", textAlign:"center", margin:"2px 0 6px" }}>
                この日の求人は、いまの絞り込みには表示されていません。
              </p>
            ) : null;
            const body = order.length === 0
              ? [<p key="app-empty" className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"36px 0" }}>この状態の応募者はいません</p>]
              : order.map(jn => {
                  // 求人カード化（2026-07-25たきと指示）：左＝トップ写真／右＝タイトル・No.／その下に応募者アイコンの横スワイプ列。
                  // アイコン列のtouchはstopPropagationで親のフィルタ切替スワイプと分離する
                  const info = jobInfoMap[jn] || {};
                  const title = [info.crop, info.task].filter(Boolean).join(" ") || `求人 #${jn}`;
                  // 表示は軽量サムネ優先（2026-07-25）：thumbが無い旧写真は原寸URLへフォールバック
                  const p0 = info.photos && info.photos[0];
                  const photo = photoThumb(p0);
                  // 終端求人の暗幕設計（2026-07-25たきと指示・完了も失効と同じ設計）：
                  // 日程が過ぎた求人は、完了記録あり＝「完了」／なし＝「失効」の暗幕＋中央ラベル＋タップ無反応
                  const jobEnd = info.date_end || info.date_start;
                  const datePast = !!jobEnd && jobEnd < ymdLocal(new Date());
                  // ★完了ラベル（暗幕）は評価まで終わってから（2026-07-27たきと指示）。
                  //   従来は日程が過ぎた時点で暗幕＋pointerEvents:noneを掛けていたため、今日ページの
                  //   「完了して評価する」から来ても応募者カードに触れず、完了記録・評価ができなかった。
                  //   todoAppIds（my_todo_items由来＝完了記録・評価が残っている応募）が1件でもあれば暗幕を出さない
                  const jobPendingAction = byJob[jn].some(a => todoAppIds.has(a.id));
                  const jobPast = datePast && !jobPendingAction;
                  const jobCompleted = jobPast && byJob[jn].some(a => a.status === "completed");
                  // カレンダーで選んだ日に該当する求人は光らせる（アジェンダ廃止の引き継ぎ・2026-07-27）
                  const calHit = !!calDay && calDay.jobs.includes(jn);
                  // 未対応（＝農家の番）の応募が1件でもあるカードは、赤影＋跳ねで気づかせる（2026-07-27たきと指示）。
                  // 既存の .cb-urgent-card（赤影＋3.5秒の浮遊ループ）をそのまま使う。終わった求人は静かにする
                  const cardUrgent = !jobPast && byJob[jn].some(a => todoAppIds.has(a.id));
                  return (
                    <div key={`job-${jn}`} ref={el => { jobCardRefs.current[jn] = el; }} className={"cb-app-jobcard" + (cardUrgent ? " cb-urgent-card" : "")}
                      style={{ gridColumn:"1/-1", position:"relative", display:"flex", alignItems:"stretch", background: calHit ? "#FFF6DE" : "#fff", border:"1px solid " + (calHit ? "#E8C77A" : "#EBEBEB"), borderRadius:14, overflow:"hidden", marginTop:2, transition:"background .5s", pointerEvents: jobPast ? "none" : undefined }}>
                      {jobPast && (
                        <div style={{ position:"absolute", inset:0, zIndex:2, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <span className="f-sans" style={{ background: jobCompleted ? "#607D8B" : "#111", color:"#fff", fontSize:13, fontWeight:800, borderRadius:8, padding:"6px 20px", letterSpacing:"0.15em" }}>{jobCompleted ? "完了" : "失効"}</span>
                        </div>
                      )}
                      {/* 左：求人のトップ写真。タイトル・No.は写真の下部に重ね、暗いグラデーション越しに
                          写真が透ける（2026-07-26たきと指示・求人カードのカバー写真と同じ作法）。
                          No.は必ず明記＝タイトルだけ「…」で省略し、#No.は別行で常時表示。タップで求人を見る。
                          ★枠は3:4固定（2026-08-06たきと指示「縦幅が求人ごとに違う。統一しろ」）：
                            高さを決めずに置くと、中の<img>のheight:100%が高さ未定の親では実質autoになり、
                            写真そのものの縦横比＝求人ごとの高さになっていた。3:4に固定すれば
                            objectFit:coverが切り取る側に回り、どの求人でも 104×139 で揃う
                            （新着の応募ページ・採用するページのカードと同じ作法） */}
                      <button onClick={()=>setPreviewJob({ num: jn })} aria-label="求人を見る" className="f-sans"
                        style={{ flexShrink:0, width:104, aspectRatio:"3 / 4", padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                        {/* 写真が1枚も無い求人は、絵文字でなく求人者のアイコンを出す（2026-08-06たきと指示・
                            求人詳細のJobPhotoFallbackと同じ考え方＝ダミー写真で水増ししない・憲法3条）。
                            この面の求人はすべて自分が出したものので求人者＝自分＝empMini。
                            アイコン未設定なら Avatar が農園名の頭文字の丸（雇い手の緑）を出す＝これも実データ */}
                        {photo
                          ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover", filter: jobPast ? "grayscale(70%)" : "none" }} />
                          : <span style={{ display:"block", lineHeight:0, filter: jobPast ? "grayscale(70%)" : "none" }}>
                              <Avatar url={empMini?.avatar_url} name={empMini?.nickname || "？"} size={56} />
                            </span>}
                        <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
                          <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{title}</span>
                          <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{jn}</span>
                        </span>
                      </button>
                      {/* 右：応募者アイコンスワイプ（人数「N名 →」は削除・2026-07-26たきと指示） */}
                      <div style={{ flex:1, minWidth:0, padding:"10px 12px 8px", display:"flex", alignItems:"center" }}>
                        {/* アイコンのみ・中央配置（2026-07-25たきと指示）：箱装飾なし。少人数なら中央、溢れたら横スクロール（max-content＋margin auto） */}
                        {/* アイコン列がはみ出して実際に横スクロールできる時だけ、ページのスワイプに渡さない
                            （2026-07-27たきと報告「失効・見送りのカードでしかスワイプが効かない」の修理）。
                            人数が少なくスクロールの余地が無い時は、カードの上でも普通にスワイプできる */}
                        <div onTouchStart={e=>{ const el = e.currentTarget; if (el.scrollWidth > el.clientWidth + 1) e.stopPropagation(); }}
                          onTouchEnd={e=>{ const el = e.currentTarget; if (el.scrollWidth > el.clientWidth + 1) e.stopPropagation(); }}
                          /* overflowX:autoは縦も切り取る（CSSの規則：片軸がautoならvisibleはautoになる）ので、
                             ジャンプ(-5px)が上で欠ける。paddingTopで跳ねる分の逃げを確保（2026-07-26たきと報告） */
                          style={{ width:"100%", minWidth:0, overflowX:"auto", WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain", paddingTop:8, paddingBottom:2 }}>
                          <div style={{ display:"flex", gap:12, width:"max-content", margin:"0 auto" }}>
                          {byJob[jn].map(a => {
                            const wp = workerProfiles[a.worker_id];
                            // 失効応募のアイコンは「失効当時の状態」で表示（2026-07-25たきと指示）。失効はappliedからのみ発生（cron）＝応募中。
                            // 失効の事実はカード全体の黒「失効」オーバーレイが担う（アイコン側に失効ラベルは出さない）
                            const phaseA = a.status === "expired" ? { ...a, status: "applied" } : a;
                            return (
                              <button key={a.id} onClick={()=>setSheetApplicantId(a.id)} className="f-sans"
                                style={{ flexShrink:0, width:64, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                                {/* 未対応（農家の番）のアイコンだけ跳ねる。働き手のアクション待ちは静止（2026-07-26たきと指示） */}
                                <span className={!jobPast && todoAppIds.has(a.id) ? "cb-jump" : undefined} style={{ display:"block", lineHeight:0 }}>
                                  <Avatar url={wp?.avatar_url} name={wp?.nickname || "？"} size={52} ring={appRibbonColor(phaseA)} />
                                </span>
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
            return [calendarTop, calHint, tabBar, calNote, floatingFilterBar, ...body, legend];
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
            const photo = photoThumb(d.photos?.[0]);
            return (
            <button key={d.job_number} onClick={()=>setPreviewJob({ num: d.job_number, draft: d.status === "draft", published: !!d.opened_at })}
              className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
              <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter:"grayscale(40%)" }} /> : "🍂"}
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

      {/* 応募者カードのボックス（アイコンタップで展開・中身は従来の応募者カード＝操作ボタン込み）。
          枠＝ステータスページの展開ボックスと同じ規格・非表示条件（2026-08-08たきと指示
          「ステータスページのボックスと同じ規格や枠、非表示条件にしよう」＝共有部品DragSheet）：
          下から生える全画面シート・グラバー・✕なし。閉じる＝背景タップ／下スワイプで畳む
          （中身最上部から指に連動・シート上端が画面中央より下で離すと閉じる） */}
      {(() => {
        const live = dbApplicants.find(x => x.id === sheetApplicantId);
        if (!live) return null;
        // 詳細面（2026-08-08たきと指示「アニメーションもコピー」）＝ステータスページのボックスと同じ：
        // シート内の求人カードタップ→面全体の演出→この面へスライド。横スワイプで戻る
        const full = sheetJobFull[live.job_number];
        const detailPane = (
          <div>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", textAlign:"center", margin:"0 0 10px" }}>横スワイプで戻る</p>
            {full
              ? <JobDetailBody job={full} me={me} onBack={()=>{ setSheetPane("main"); setSheetShowcase(false); }} />
              : <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>
                  {full === null ? "この求人は現在公開されていないため、詳しい内容を表示できません" : <>読み込み中<Dots /></>}
                </p>}
          </div>
        );
        return (
          <DragSheet onClose={()=>setSheetApplicantId(null)}
            pane={sheetPane} showcase={sheetShowcase}
            onShowcaseEnd={()=>setSheetPane("detail")}
            onPaneChange={(p)=>{ setSheetPane(p); if (p === "main") setSheetShowcase(false); }}
            detail={detailPane}>
            {renderApplicantCard(live)}
          </DragSheet>
        );
      })()}

      {/* 完了・評価モーダル（Part1） */}
      {/* 働く日を決めるモーダル（2026-07-24 追記3）：来られる日をプリセット→農家がタップ選択→set_agreed_dates */}
      {agreeModal && (() => {
        const info = jobInfoMap[agreeModal.job_number] || {};
        const av = agreeModal.available_dates;
        // 候補＝働き手の来られる日（配列）。いつでもOK("any")や未宣言は求人の全期間。
        // 休日（jobs.holidays・2026-08-03）は除外＝休日を働く日に確定できない（来られる日宣言後に休日を足した場合も守る）
        const hs = new Set(Array.isArray(info.holidays) ? info.holidays : []);
        const candidates = (Array.isArray(av) && av.length > 0 ? av.slice().sort() : daysBetweenYmd(info.date_start, info.date_end)).filter(x => !hs.has(x));
        return (
          <div onClick={()=>{ if (!agreeSaving) { setAgreeModal(null); setAgreeSel([]); } }} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
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
                  const { data, error } = await setAgreedDates(agreeModal.id, dates);
                  setAgreeSaving(false);
                  if (error || !data?.ok) { alert("確定に失敗しました：" + (data?.message || data?.reason || error?.message || "不明")); return; }
                  setDbApplicants(prev => prev.map(x => x.id===agreeModal.id ? { ...x, agreed_dates: dates } : x));
                  setAgreeModal(null); setAgreeSel([]);
                }} className="btn-primary" style={{ flex:2, padding:"13px", fontSize:14, fontWeight:700, borderRadius:12, opacity: (agreeSaving || agreeSel.length===0) ? 0.5 : 1, cursor: agreeSel.length===0 ? "not-allowed" : "pointer" }}>{agreeSaving ? <>確定中<Dots /></> : `この日で確定する${agreeSel.length>0 ? `（${agreeSel.length}日）` : ""}`}</button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* 完了・評価モーダル：完了ボタン＝そのまま評価（2026-08-16たきと指示）。
          「働き手は来ましたか？」の1枚は廃止＝送信＝完了の記録＋評価（submit_farmer_review・
          1トランザクション）。来なかった場合の道は下の控えめなリンクで残す（欠勤の記録・
          72時間の異議申立＝2026-07-30に足した「来なかった場合の措置」を消さない） */}
      {completeModalApp && (() => {
        const notDone = completeModalApp.status !== "completed"; // 完了の記録がまだ＝送信で一緒に記録される
        // 出欠の記録がまだ開いているか（2026-08-18）：最終日の終了時刻で自動完了するようになったため、
        // 「完了＝もう欠勤を記録できない」ではなくなった。自動完了で出欠が空のままの行は、
        // 農家がここから欠勤を記録できる（DB側も complete_work が同じ条件で受け付ける）＝
        // 2026-07-30に足した「来なかった場合の措置」を自動完了で奪わない
        const attendOpen = notDone || (completeModalApp.auto_completed && completeModalApp.attended == null);
        return (
        <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom: notDone ? 6 : 16 }}>{notDone ? "作業の完了と評価" : "作業の評価"}</p>
                {notDone && (
                  <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 16px" }}>送信すると、作業の完了が記録され、評価が働き手に届きます。</p>
                )}
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
                    className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{completeSubmitting ? <>送信中<Dots /></> : "送信する"}</button>
                </div>
                {/* 例外の道：来なかった場合（出欠の記録が済むまでのあいだだけ出す） */}
                {attendOpen && (
                  <button onClick={markNoShow} disabled={completeSubmitting} className="f-sans"
                    style={{ display:"block", width:"100%", marginTop:16, paddingTop:14, borderTop:"1px solid #F0F0F0", background:"none", border:"none", fontSize:12, color:"#E24B4A", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>
                    働き手が来なかった場合は → 欠勤として記録する
                  </button>
                )}
          </div>
        </div>
        );
      })()}

      {/* 求人カードタップ→確認ページと同型のボトムシート＝【閲覧専用】（2026-08-07〜08たきと指示）。
          再開・削除・コピー・非公開はすべて求人一覧ページの浮遊ピル（.cb-job-action-fabs）に集約。
          畳む道はステータスページのボックスと同じ規格＝背景タップ／下スワイプ（✕は置かない） */}
      {previewJob && (
        <AdminJobPreview jobNumber={previewJob.num} ownerView onClose={()=>setPreviewJob(null)} />
      )}

      {/* ── 求人の操作ピル（2026-08-07たきと指示・同日改定「各役割タップ→求人を直接タップする。
           削除と非公開だけが最終確認」）──
           求人一覧ページ（作成中⇄公開中）に常設。位置は浮遊☰の真横・同じ高さ（CSS .cb-job-action-fabs）。
           ピルのタップ＝モード選択（点灯・もう一度で取消）→一覧の求人カードを直接タップで実行。
           最終確認は削除・非公開のみ（runJobAction内のconfirm）。再開・コピーは即実行。
           3つ目のピルはペインで切替：作成中＝削除／公開中＝非公開（key切替でcbPillSwapアニメ）。
           削除の対象は下書き（一度も掲載していない）のみ＝DBの trg_block_delete_past_job と二重の壁 */}
      {(jobTab === "draft" || jobTab === "active") && (<>
        {/* モード中の案内バブル：画面中央に配置（2026-08-07たきと指示。ピル行の左端anchorだと右にはみ出していた）。
            pointer-events:none＝下のカードのタップを妨げない */}
        {armedAction && (
          <div className="cb-job-action-hint">
            <div className="f-sans" style={{ background:"#222", color:"#fff", fontSize:12, fontWeight:700, padding:"9px 13px", borderRadius:10, whiteSpace:"nowrap", boxShadow:"0 2px 10px rgba(0,0,0,.3)", animation:"cbPillSwap .2s ease" }}>
              {ARMED_LABEL[armedAction]}する求人をタップ（もう一度ピルで取消）
            </div>
          </div>
        )}
        <div className="cb-job-action-fabs">
          {/* 再開は作成中のみ（2026-08-07たきと指示「公開中タブのときは再開は非表示」）。
              公開中の求人は再開＝編集の対象ではない（編集は一時非公開→作成中→再開の順）。
              ★消える時も枠は空けたまま（同日たきと指示「詰めるな」）＝visibility:hiddenの同じ寸法の
              ダミーを残す。display:noneにすると後続のピルが左へ動いてしまう。
              出入りは削除⇄非公開と同じ cbPillSwap */}
          {jobTab !== "active" ? (
            <button key="resume" onClick={()=>armJobAction("resume")} className="f-sans" style={{ animation:"cbPillSwap .28s ease", padding:"12px 16px", fontSize:13, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:24, cursor:"pointer", whiteSpace:"nowrap",
              boxShadow: armedAction === "resume" ? "0 0 0 3px rgba(0,168,107,.35), 0 4px 12px rgba(0,0,0,.18)" : "0 4px 12px rgba(0,0,0,.18)", opacity: (!armedAction || armedAction === "resume") ? 1 : 0.45 }}>再開</button>
          ) : (
            <span aria-hidden="true" className="f-sans" style={{ visibility:"hidden", pointerEvents:"none", padding:"12px 16px", fontSize:13, fontWeight:800, border:"none", borderRadius:24, whiteSpace:"nowrap" }}>再開</span>
          )}
          <button onClick={()=>armJobAction("copy")} className="f-sans" style={{ padding:"12px 16px", fontSize:13, fontWeight:800, borderRadius:24, cursor:"pointer", whiteSpace:"nowrap",
            background: armedAction === "copy" ? "#00A86B" : "#fff", color: armedAction === "copy" ? "#fff" : "#00A86B", border:"1.5px solid #00A86B",
            boxShadow: armedAction === "copy" ? "0 0 0 3px rgba(0,168,107,.35), 0 4px 12px rgba(0,0,0,.18)" : "0 4px 12px rgba(0,0,0,.15)", opacity: (!armedAction || armedAction === "copy") ? 1 : 0.45 }}>コピー</button>
          {jobTab === "active" ? (
            <button key="unpublish" onClick={()=>armJobAction("unpublish")} className="f-sans" style={{ animation:"cbPillSwap .28s ease", padding:"12px 16px", fontSize:13, fontWeight:800, borderRadius:24, cursor:"pointer", whiteSpace:"nowrap",
              background: armedAction === "unpublish" ? "#C77700" : "#fff", color: armedAction === "unpublish" ? "#fff" : "#C77700", border:"1.5px solid #FFB020",
              boxShadow: armedAction === "unpublish" ? "0 0 0 3px rgba(199,119,0,.3), 0 4px 12px rgba(0,0,0,.18)" : "0 4px 12px rgba(0,0,0,.15)", opacity: (!armedAction || armedAction === "unpublish") ? 1 : 0.45 }}>非公開</button>
          ) : (
            <button key="delete" onClick={()=>armJobAction("delete")} className="f-sans" style={{ animation:"cbPillSwap .28s ease", padding:"12px 16px", fontSize:13, fontWeight:800, borderRadius:24, cursor:"pointer", whiteSpace:"nowrap",
              background: armedAction === "delete" ? "#E24B4A" : "#fff", color: armedAction === "delete" ? "#fff" : "#E24B4A", border:"1.5px solid #E24B4A",
              boxShadow: armedAction === "delete" ? "0 0 0 3px rgba(226,75,74,.3), 0 4px 12px rgba(0,0,0,.18)" : "0 4px 12px rgba(0,0,0,.15)", opacity: (!armedAction || armedAction === "delete") ? 1 : 0.45 }}>削除</button>
          )}
        </div>
      </>)}

      {/* 「公開間近」の説明ボックス（2026-08-07たきと指示）：掲載申請済み求人のタップで開く。
          求人の詳細も求人者プロフィールも見せず、状態の説明だけを展開する＝「審査されている」感を出さない。
          法的な公開ゲート（運営承認・届出）は不変で、働き手にはまだ表示されない＝それを前向きに正直に伝える */}
      {nearPublishInfo && (
        <div onClick={()=>{ setNearPublishInfo(false); setNearPubDetail(false); }} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"28px 24px 24px", maxWidth:360, width:"100%", textAlign:"center", position:"relative", boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
            <button onClick={()=>{ setNearPublishInfo(false); setNearPubDetail(false); }} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <div style={{ fontSize:48, marginBottom:10 }}>🌱</div>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 16px" }}>もうすぐ公開されます</p>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.9, margin:"0 0 6px" }}>この求人は、公開の準備が整いしだい、働き手に公開されます。</p>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.9, margin:0 }}>公開されると「さがす」に並び、応募が届くようになります。</p>
            {nearPubDetail ? (
              <div className="f-sans fade-in" style={{ marginTop:14, background:"#F1F8F4", borderRadius:12, padding:"12px 14px", textAlign:"left", fontSize:12, color:"#3a5a49", lineHeight:1.9 }}>
                ・公開までの間も、写真の追加や内容の修正はいつでもできます<br/>
                ・公開されると、応募のお知らせがこの画面に届きます<br/>
                ・公開までの少しの間、この求人はまだ働き手には表示されていません
              </div>
            ) : (
              <button onClick={()=>setNearPubDetail(true)} className="f-sans" style={{ marginTop:14, background:"none", border:"none", fontSize:13, fontWeight:700, color:"#0E8A6B", textDecoration:"underline", cursor:"pointer" }}>詳しく見る ▾</button>
            )}
          </div>
        </div>
      )}

      {/* お気に入り登録しました！ボックス（2026-07-19）：働き手アイコンに❤️が付く動作・説明は1文×2・詳細は展開 */}
      {favDone && (
        <div onClick={()=>setFavDone(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
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
        <div onClick={()=>setRosterDetail(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setRosterDetail(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 16px" }}>働き手の詳細</p>
            {rosterDetail.loading ? (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>
            ) : rosterDetail.profile ? (
              <>
                <WorkerTrustCard profile={rosterDetail.profile} trust={rosterDetail.trust} />
                <MyReviewsOfWorker workerId={rosterDetail.worker_id} />
                {/* Q&Aはチャットと同じコメント形式（2026-08-06たきと指示）。💪希望する作業の強さも質問要素として合流 */}
                <QaChat items={workerQaItems(rosterDetail.profile)} />
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
        <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
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

      {/* 打刻の修正を申請（第13弾・追補の訂正）。働き手側と同じ共通シート */}
      {corrApp && (
        <TimeCorrectionSheet key={corrApp.id} app={corrApp} onClose={()=>setCorrApp(null)} />
      )}

      {/* 緊急連絡モーダル（Part3・農家側） */}
      {emergencyModalApp && (
        <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
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
                    className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{emergencySubmitting ? <>送信中<Dots /></> : "送信する"}</button>
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
                {/* 1列の行カード（2026-07-27たきと指示・同日改定）：左＝タイトル／右＝中身。
                    応募者ページの求人カードと同じ読み方に揃え、ボックス内のアイコンは置かない */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:12, marginBottom:12 }}>
                  {questionSets.map(s => (
                    <button key={s.id} onClick={()=>setQEditing({ id:s.id, title:s.title || "", questions: (Array.isArray(s.questions) && s.questions.length ? [...s.questions] : [""]) })} className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0, textAlign:"left" }}>
                      {/* 左＝タイトル／右＝中身（応募者ページのカードと同じ並び・2026-07-27たきと指示）。
                          ボックス内の📋アイコンは削除＝中身が質問集であることは見出しが示している */}
                      <span style={{ flexShrink:0, maxWidth:"46%", fontSize:15, fontWeight:700, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.title || "無題の質問集"}</span>
                      <span style={{ flex:1, minWidth:0, textAlign:"right", overflow:"hidden" }}>
                        <span style={{ display:"block", fontSize:11, fontWeight:700, color:"#00A86B" }}>質問{Array.isArray(s.questions) ? s.questions.filter(Boolean).length : 0}問</span>
                        <span style={{ display:"block", fontSize:12, color:"#717171", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {(Array.isArray(s.questions) ? s.questions.filter(Boolean) : []).join("・") || "質問はまだありません"}
                        </span>
                      </span>
                    </button>
                  ))}
                  {/* テンプレ区画は削除（2026-07-25たきと指示）：＋自分で作るを押した時、未使用テンプレの内容を
                      デフォルト値として入力欄に表示する方式に（編集・上書き保存可能）。全テンプレ使用済みなら白紙。
                      ボックス格子の最後の1枠として同じ大きさで並べる（2026-07-27） */}
                  <button onClick={()=>{
                    const used = new Set(questionSets.map(s => s.title));
                    const tpl = INTERVIEW_TEMPLATES.find(t => !used.has(t.title));
                    setQEditing(tpl ? { title: tpl.title, questions: [...tpl.questions] } : { title:"", questions:[""] });
                  }} className="f-sans" style={{ background:"#fff", border:"1px dashed #C8C8C8", borderRadius:14, padding:"14px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:12, minWidth:0, textAlign:"left" }}>
                    <span style={{ flexShrink:0, fontSize:15, fontWeight:700, color:"#00A86B" }}>＋ 自分で作る</span>
                    <span style={{ flex:1, minWidth:0, textAlign:"right", fontSize:12, color:"#B0B0B0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>新しい質問集</span>
                  </button>
                </div>
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
                  <button onClick={saveQuestionSet} disabled={qSaving} className="f-sans" style={{ flex:1, padding:"11px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{qSaving ? <>保存中<Dots /></> : "保存する"}</button>
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
        <div onClick={()=>{ if (!sendingQ) setSendQTarget(null); }} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:10002, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .2s ease" }}>
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
                {sendingQ && <p className="f-sans" style={{ fontSize:12, color:"#999", textAlign:"center", margin:"4px 0 0" }}>送信中<Dots /></p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
