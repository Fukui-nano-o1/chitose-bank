// 分割3-C（2026-07-25）：App.jsxから移動。求人作成フロー全体（農家・働き手の入口〜確認〜完了）。
// 専用ヘルパー（geocodeTown/compressImage/normalizePhotos/dangerHasSecond/LF系UI部品/最賃チェック）も同居。
// LF系UI部品はモジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { productAnalytics } from "../../../lib/productAnalytics";
import { logAppError } from "../../../app/diagnostics/errorLog";
import { safeDraftRebase } from "../../../lib/offlineSync";
import { jobSaveGuidance } from "../../../lib/inputRecovery.js";
import { calendarDateFromYmd, restoreDraftCalendarDate } from "../../../lib/calendarDate";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { activeDeviceDraft, readDeviceDraft, listDeviceDrafts, newDeviceDraft, saveDeviceDraft, queueDeviceDraft, rebaseDeviceDraft, removeDeviceDraft, prepareDevicePublication, settleDevicePublication, DEVICE_DRAFT_EVENT } from "../../../lib/deviceDrafts";
import { emitConfirmedRefresh, REFRESH_JOBS } from "../../../lib/refreshBus";
import { fbCelebrate } from "../../../lib/feedback";
import { zipLookup } from "../../../lib/zipLookup";
import { isAdmin, ymdLocal, CROP_OPTIONS, TASK_OPTIONS, farmHostQa, farmIntroTopics, PUBLISH_CHECKS, payTermsLine, CURRENT_PAY_POLICY, CONTRACT_RENEWAL_FIXED, overtimeLine, splitTextsForReview } from "../../../lib/utils";
// 確認ページ（step11）の本文＝求人詳細ページ・ボックス版・審査プレビューと同じ JobDetailBody（2026-09-19）。
// 旧・確認ページが自前で描いていた写真カルーセル・主要情報カード・待遇表・危険箇所・地図・カレンダー・保険の
// 部品（Carousel系/DangerItem/JobLocationMap/JobInsuranceSection ほか）の import はここから消えた
import { JobDetailBody } from "../../../components/JobDetailBody";
import { getCache, setCache } from "../../../lib/viewCache";
import { snapGet } from "../../../lib/snapshot";
import { LFPillSelect, LFWizCard, LFCardBtn, LFCropGrid, LFSummaryRow, DevBadge, QaChat, Dots } from "../../../components/ui";
import { NavIcon, NavIconInline } from "../../../components/NavIcons";
import { CalendarView } from "../../../components/CalendarView";
import { FarmerTrustCard } from "../../../components/TrustCards";
import { EmployerProfileEdit } from "../../../components/EmployerProfileEdit";
import { JobSearchMapView } from "../../../components/JobSearchMapView";
import { normalizePhotos, dangerHasSecond, isAllowedPrefecture, isValidStreetAddress, validateMinWage } from "./model";
import { digitsOnly, wageAmount, selectionValue, workDurationHours, workTimeLabel as formatWorkTime, dateLabel, serializeJobForm, jobFormFromRow, jobPayloadFromForm } from "./jobInputCodec";
import { geocodeTown } from "./jobCreateGeo";
import { useTownCheck, TOWN_NOT_FOUND_MESSAGE, TOWN_CHECK_ERROR_MESSAGE } from "./useTownCheck";
import { getSession, fetchMinimumWage, fetchEmployerProfile, fetchEmployerPlaceAddress,
  fetchEmployerRecruiterInfo, upsertEmployerProfile, fetchEmployerTrustInfo, fetchAccountHolder,
  fetchJobByNumber, fetchJobStatus, publishMyJobWithCheck,
  countLiveApplications, syncJobDeviceDrafts,
  uploadPhoto } from "./jobCreateApi";
import { LFMultiPill, LFWageNote, LFWageCompare, LFFakeFilterRow } from "./components/LFParts";
import { lfStyles } from "./lfStyles";
import { StepPhotos } from "./components/StepPhotos";
import { StepDescription } from "./components/StepDescription";
import { useListingRecruiter } from "./useListingRecruiter";
import { isRecruiterPage, RECRUITER_FIELDS, recruiterPageValid } from "./listingPublicationPages";
import { ListingRecruiterPage, ListingPublishConsent } from "./components/ListingPublicationPages";
import { StepPhotoCaptions } from "./components/StepPhotoCaptions";
import { StepWorkVideo, isValidYoutubeVideo } from "./components/StepWorkVideo";
import { StepDanger } from "./components/StepDanger";
import { StepWishes } from "./components/StepWishes";
import { ListingHeader, ListingIntro, ListingDetailsIntro, ListingFooter, LISTING_STAGES, listingStage } from "./components/ListingFrame";
import { SavedWorkplaceCard, WorkplacePage } from "./components/WorkplacePage";
import { ListingPage } from "./components/ListingPage";
import { StepSchedule, StepHolidays, StepHeadcount } from "./components/StepSchedule";
import { StepTaskScope, StepPlaceScope, StepAccess } from "./components/StepBasicTopics";
import { StepWorkTime, StepBreakTime, StepOvertime, StepDailyWage } from "./components/StepWorkTerms";
import { useListingNavigation } from "./useListingNavigation.js";
import { LISTING_NAV_VERSION, adjacentListingPage, isListingInputPage, isMultiDaySchedule, validSchedule, validHeadcount, parseListingRoute } from "./listingNavigation.js";
import "./listingFlow.css";

// 掲載前の確認（step11）：値がまだ無い区画の代わりに出す空の区画（2026-09-19）。JobDetailBody は値の無い区画を
// 描かない（作業内容・作業日程）が、掲載前の確認では「未設定」と編集の入口を見せる必要がある。
// 見た目は JobDetailPanel の AirSection と同じ区切り（細い線＋太い見出し）。★モジュールレベル定義を維持すること
function ConfEmptySection({ title, children }) {
  return (
    <div style={{ borderTop:"1px solid #EBEBEB", marginTop:24, paddingTop:24 }}>
      <h3 className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 14px" }}>{title}</h3>
      <p className="f-sans" style={{ fontSize:15, color:"#B0B0B0", margin:0 }}>{children}</p>
    </div>
  );
}

const isWorkplaceRoute = () => !!parseListingRoute(window.location.hash)?.auxiliary;

// geocodeTown（町域重心の取得） → features/jobs/create/jobCreateGeo.js へ移設（2026-08-17）

// compressImage（アップロード前のクライアント圧縮）は lib/image.js へ移動（2026-07-26・ヘルプのスクショと共用化）

// 求人作成の純関数（写真の正規化・危険項目・提供範囲・最賃判定） → features/jobs/create/model.js へ移設（2026-08-17）

// LF共有UI部品（写真並び替え・複数選択ピル・最賃メモ・相場比較・見本のフィルタ行）
//   → features/jobs/create/components/LFParts.jsx へ移設（2026-08-17）
// 求人作成の純関数（写真の正規化・危険項目・提供範囲・最賃判定） → features/jobs/create/model.js へ移設（2026-08-17）

// ── LandingFlow ──────────────────────────────────────────────
// 表示条件：{!me && showLanding && <LandingFlow .../>} — 未ログイン訪問者に表示
// 2026-10-05 作業動画ページ追加前の下書き互換。
// 旧9=危険、10=希望、11=確認。新規フローでは動画を9に挿入したため、旧9以降は+1して再開する。
// 動画項目を持つ行/端末下書きは新フローで保存済みなので変換しない。
function resumeListingStep(oldStep, hasVideoFields = false) {
  const n = Number(oldStep);
  if (!Number.isFinite(n)) return 1;
  if (hasVideoFields) return Math.max(1, Math.min(n, 12));
  return n >= 9 && n <= 11 ? n + 1 : Math.max(1, Math.min(n, 12));
}

export function LandingFlow({ ownerId, localOnly = false, onComplete, onDraftSaved, onSkip, onLogin, onPublished, onWorkerDone, farmersCount = 0, embedded = false, initialRole = "", onStepChange, initialStep }) {
  const AVG_HOURLY = 1180, AVG_DAILY = 8400, AVG_COUNT = 0;

  const [_deviceInit] = useState(() => {
    if (!ownerId) return null;
    try {
    const hash = window.location.hash;
    if (sessionStorage.getItem("cb_newJobDateStart") && /work\/new/.test(hash)) return null;
    const localId = hash.match(/work\/local\/([a-f0-9-]+)/)?.[1];
    const number = Number(hash.match(/work\/edit\/(\d+)/)?.[1]);
    return localId ? readDeviceDraft(ownerId, localId)
      : number ? listDeviceDrafts(ownerId).find(d => d.jobNumber === number && d.state !== "synced") || null
      : activeDeviceDraft(ownerId);
    } catch { return null; }
  });
  const deviceDraftRef = useRef(_deviceInit);
  const deviceReadyRef = useRef(!!_deviceInit?.form || !/work\/edit\//.test(window.location.hash));
  const completedRef = useRef(false);
  const localRouteMissing = /work\/local\//.test(window.location.hash) && !_deviceInit;

  // ── ログイン後復帰: postLoginReturnTo を確認して draft を読み込む ──
  const _draftInit = (() => {
    if (_deviceInit?.form) return _deviceInit.form;
    try {
      if (ownerId && sessionStorage.getItem("cb_anonymousDraft") !== "1") return null;
      // 復元条件：①ログイン往復フラグ ②URLが求人フロー(#/work/new*)のままのリロード（2026-07-14追加）
      // ②が無いと、確認ページ等でリロードした際に入力が全て白紙に戻る（stateは復元されずURLだけ残る）
      const _h = window.location.hash.replace(/^#\/?/, "");
      const _inNewJobFlow = _h === "work/new" || _h.startsWith("work/new/");
      if (localStorage.getItem('postLoginReturnTo') === 'landingFlowFarmerConfirm' || _inNewJobFlow) {
        const d = JSON.parse(localStorage.getItem('landingFlowDraft_v1') || '{}');
        if (d.role === 'farmer') return d;
      }
    } catch {}
    return null;
  })();

  const _devJump = (() => { try { return JSON.parse(localStorage.getItem('devJump')||'null'); } catch { return null; } })();

  const _editJobNumber = Number(parseListingRoute(window.location.hash)?.scope.match(/work\/edit\/(\d+)$/)?.[1]) || null;
  // 編集中の求人が【公開中(open)】か（2026-09-11「応募者がいない求人は編集可能に」）。
  // 公開中の編集は一時非公開にせず、update_my_open_job（本人・open・進行中の応募なし の壁つき）で
  // 掲載したまま保存する。draft/pending の編集は従来どおり（保存→掲載）
  const [editingOpen, setEditingOpen] = useState(_deviceInit?.base?.status === "open");
  const [editJobLoading, setEditJobLoading] = useState(!!_editJobNumber && !_deviceInit?.form);
  const [editJobError, setEditJobError] = useState("");
  const [editJobRetry, setEditJobRetry] = useState(0);
  const [role, setRole] = useState(_devJump?.role ?? _draftInit?.role ?? (_editJobNumber ? "farmer" : null) ?? initialRole ?? ""); // "" | "farmer" | "worker"
  // 編集・コピー（#/work/edit/{n}）は確認ページ(11)から始める（2026-08-03）。
  // 初期値が0（入口）だと、jobsを読み終えるまで「はじめから」の画面が見えてしまう。
  // 実際のstepは読み込み後に draft_step で上書きされる（copy_jobも draft_step=11 で作る）
  const { step, pageId, setStep, setPage, restorePage, routeError, returnToConfirm, setReturnToConfirm } = useListingNavigation({
    farmer: role === "farmer", ready: !editJobLoading,
    initialStep: (initialStep != null && initialStep >= 0 && initialStep <= 13) ? initialStep
      : (_devJump?.step ?? (_draftInit ? resumeListingStep(_draftInit.farmerStep ?? 1, Object.hasOwn(_draftInit, "workVideoUrl")) : (_editJobNumber ? 12 : 0))),
    initialForm: _draftInit,
  });

  // 農家 state（draft がある場合は復元値を初期値に使う）
  const d = _draftInit || {};
  const [farmerExp,         setFarmerExp]         = useState(d.farmerExp ?? "");
  const [farmerPurpose,     setFarmerPurpose]     = useState(_devJump?.farmerPurpose ?? d.farmerPurpose ?? "post");
  const [farmerDisplayName, setFarmerDisplayName] = useState(d.farmerDisplayName ?? "");
  const [farmerRegion,      setFarmerRegion]      = useState(d.farmerRegion ?? "");
  // 住所4分割（段階1。郵便番号自動検索・地図・新規登録からの引き継ぎは将来）
  const [farmerZip,         setFarmerZip]         = useState(d.farmerZip ?? "");
  const [farmerPref,        setFarmerPref]        = useState(d.farmerPref ?? "");
  const [farmerCity,        setFarmerCity]        = useState(d.farmerCity ?? "");
  const [farmerTown,        setFarmerTown]        = useState(d.farmerTown ?? "");
  const [farmerAddr,        setFarmerAddr]        = useState(d.farmerAddr ?? "");
  const zipRef   = useRef(null);
  const prefRef  = useRef(null);
  const cityRef  = useRef(null);
  const townRef  = useRef(null);
  const addrRef  = useRef(null);
  const [minWage, setMinWage] = useState(null);
  const [minWageLoading, setMinWageLoading] = useState(true);
  const [minWageRetry, setMinWageRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    setMinWage(null);
    if (!farmerPref) { setMinWageLoading(false); return; }
    const load = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      setMinWageLoading(true);
      try {
        const { data } = await fetchMinimumWage(farmerPref);
        if (!cancelled) setMinWage(typeof data === 'number' ? data : null);
      } catch { if (!cancelled) setMinWage(null); }
      finally { inFlight = false; if (!cancelled) setMinWageLoading(false); }
    };
    load();
    window.addEventListener('online', load);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('online', load);
      window.removeEventListener('focus', load);
    };
  }, [farmerPref, minWageRetry]);
  const [zipSearching,      setZipSearching]      = useState(false);
  const [zipError,          setZipError]          = useState("");
  const zipLookupVersion = useRef(0);
  // 郵便番号から住所を検索（zipLookup＝2系統レース＋タイムアウト＋キャッシュ・2026-08-02「数十秒」対策）。
  // 都道府県・市区町村を自動入力。
  // ★引数で郵便番号を受け取れるようにしてある（2026-07-29）：入力欄のonChangeから呼ぶとき、
  //   その時点の farmerZip state はまだ更新前なので、打たれた値を直接渡す必要がある
  const searchZip = async (zipRaw) => {
    const version = ++zipLookupVersion.current;
    const zip = String(zipRaw === undefined ? farmerZip : zipRaw).replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setZipSearching(false); setZipError("郵便番号は7桁で入力してください"); return; }
    setZipSearching(true); setZipError("");
    try {
      const r = await zipLookup(zip);
      if (version !== zipLookupVersion.current) return;
      if (r.ok) {
        setFarmerPref(r.prefecture);
        setFarmerCity(r.city);
        // 町域まで自動入力（2026-07-16）。町域・番地は個別に手直しできる
        setFarmerTown(r.town || "");
        setFarmerRegion(r.prefecture + r.city + (r.town || ""));
        setZipError("");
        // 町域が取れたら番地欄へ、取れなければ町域欄へフォーカス
        setTimeout(() => { if (version === zipLookupVersion.current) (r.town ? addrRef : townRef).current?.focus(); }, 0);
      } else {
        setZipError(r.reason === "notfound" ? "郵便番号が見つかりませんでした" : "検索に失敗しました。通信環境をご確認ください");
      }
    } catch {
      if (version === zipLookupVersion.current) setZipError("検索に失敗しました。通信環境をご確認ください");
    } finally {
      if (version === zipLookupVersion.current) setZipSearching(false);
    }
  };
  // ★farmerZip を監視して自動検索する useEffect は廃止した（2026-07-29・集合場所が復元できない不具合の根治）。
  //   farmerZip に書き込む経路は5つあり、うち4つは「正しい住所を丸ごと入れる」復元処理だった：
  //     ①下書き復元（useStateの初期値 d.farmerZip） ②求人の編集読み込み ③「前回の住所を使う」
  //     ④作業場の登録ページの保存後（保存した町域までそのまま反映）
  //   監視effectはこの4つでも発火し、直後に zipcloud の address3 で町域を上書きしていた。
  //   例：町域を「宮島」に直して保存 → その場で「忌部」（郵便番号が指す町域）に戻る。
  //   自動検索は「利用者が郵便番号を打った時」だけに限定する＝入力欄のonChangeから呼ぶ（下記）。
  const [farmerCropPill,    setFarmerCropPill]    = useState(d.farmerCropPill ?? ""); // 作物ピル選択
  const [farmerCropText,    setFarmerCropText]    = useState(d.farmerCropText ?? ""); // 作物自由入力
  const [farmerTaskPill,    setFarmerTaskPill]    = useState(d.farmerTaskPill ?? ""); // 作業ピル選択
  const [farmerTaskText,    setFarmerTaskText]    = useState(d.farmerTaskText ?? ""); // 作業自由入力
  const [farmerWanted,      setFarmerWanted]      = useState(d.farmerWanted ?? "");
  const [farmerPayType,     setFarmerPayType]     = useState(d.farmerPayType ?? "");
  const [payTiming,         setPayTiming]         = useState("即日払い（作業当日）");
  const [payMethod,         setPayMethod]         = useState("現金手渡し");
  const [workTimeRaw, setWorkTimeRaw] = useState(d.workTimeRaw);
  // 勤務時間（4分割）
  const [startHour,   setStartHour]   = useState(d.startHour   ?? "8");
  const [startMinute, setStartMinute] = useState(d.startMinute ?? "00");
  const [endHour,     setEndHour]     = useState(d.endHour     ?? "16");
  const [endMinute,   setEndMinute]   = useState(d.endMinute   ?? "00");
  // 時給・日給（文字列で保持してカーソル飛び防止）
  const [hourlyWageInput, setHourlyWageInput] = useState(d.hourlyWageInput ?? "");
  const [dailyWageInput,  setDailyWageInput]  = useState(d.dailyWageInput  ?? "");
  // 保存形式は日付のみ。Dateへの変換はUI境界で行い、UTC変換による前日化を防ぐ。
  // カレンダーの「この日から始まる求人を出す」（2026-08-21）：タップした日that cb_newJobDateStart で届く。
  // 優先順は 下書きの日程 ＞ タップした日＝進行中の入力を上書きしない。編集モードは対象外
  // （applyJobRow that正）。消費は下のマウントeffectで行う（初期化関数内で消すとStrictModeの
  // 二重実行で2回目that空になるため、読むだけにする）
  const [jobDateStart,    setJobDateStart]    = useState(() => {
    if (d.jobDateStart) return restoreDraftCalendarDate(d.jobDateStart, _deviceInit?.payload?.date_start);
    if (!_editJobNumber) {
      try {
        const v = sessionStorage.getItem("cb_newJobDateStart");
        if (v) return calendarDateFromYmd(v);
      } catch {}
    }
    return null;
  });
  useEffect(() => { try { sessionStorage.removeItem("cb_newJobDateStart"); } catch {} }, []);
  const [jobDateEnd,      setJobDateEnd]      = useState(() => restoreDraftCalendarDate(d.jobDateEnd, _deviceInit?.payload?.date_end));
  // 期間内の休日（2026-08-03たきと指示）："YYYY-MM-DD"配列。休日ボタン→カレンダータップで設定
  const [jobHolidays,     setJobHolidays]     = useState(Array.isArray(d.jobHolidays) ? d.jobHolidays : []);
  // 日程変更に休日を追従：期間の外に出た休日は自動で外す。単日（終了日なし）は全消し＝データが日程とズレない
  useEffect(() => {
    setJobHolidays(prev => {
      if (!prev.length) return prev;
      if (!jobDateStart || !jobDateEnd) return [];
      const s = ymdLocal(jobDateStart), e = ymdLocal(jobDateEnd);
      const next = prev.filter(x => x > s && x < e);
      return next.length === prev.length ? prev : next;
    });
  }, [jobDateStart, jobDateEnd]);
  const [jobCount,        setJobCount]        = useState(d.jobCount ?? "");
  const [breakTime, setBreakTime] = useState(d.breakTime ?? "");
  const [commuteTime, setCommuteTime] = useState(d.commuteTime ?? "");
  const [nearestStation, setNearestStation] = useState(d.nearestStation ?? "");
  const [jobPhotos, setJobPhotos] = useState(normalizePhotos(d.jobPhotos)); // 旧形式draft対策（真っ白バグ・2026-07-16）
  // 写真の並び替えは LFPhotoReorderStrip（モジュールレベル・◀▶＋長押しドラッグ）に移動（2026-08-03）
  const [jobDescription, setJobDescription] = useState(d.jobDescription ?? "");
  // 作業動画（MVP）：掲載フローではYouTube URLと利用同意だけを扱う。
  // 表示側への埋め込みは次段階。URLが空なら同意値も保存しない。
  const [workVideoUrl, setWorkVideoUrl] = useState(d.workVideoUrl ?? "");
  const [workVideoJobConsent, setWorkVideoJobConsent] = useState(!!d.workVideoJobConsent);
  const [workVideoRelatedConsent, setWorkVideoRelatedConsent] = useState(!!d.workVideoRelatedConsent);
  const [workVideoConsentAt, setWorkVideoConsentAt] = useState(d.workVideoConsentAt ?? null);
  const [workVideoConsentVersion, setWorkVideoConsentVersion] = useState(d.workVideoConsentVersion ?? null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [photoCaptionsOpen, setPhotoCaptionsOpen] = useState(false); // step8「写真ごとに説明」ポップアップ（2026-07-16）
  const [photoUploading, setPhotoUploading] = useState(false);
  const [jobDangerPlaces, setJobDangerPlaces] = useState((d.jobDangerPlaces ?? [{ icon:"⚠️", label:"", desc:"" }, { icon:"⚠️", label:"", desc:"" }]).map(p => ({ photos:[], ...p })));
  const [jobDangerTasks, setJobDangerTasks] = useState((d.jobDangerTasks ?? [{ icon:"⚠️", label:"", desc:"" }, { icon:"⚠️", label:"", desc:"" }]).map(t => ({ photos:[], ...t })));
  // 2つ目に中身があれば最初から展開（2026-07-16）：閉じたままだと編集も削除もできない見えない項目になる
  const [showPlace2, setShowPlace2] = useState(() => dangerHasSecond(d.jobDangerPlaces));
  const [showTask2, setShowTask2] = useState(() => dangerHasSecond(d.jobDangerTasks));
  // 確認ページ（step11）の写真カルーセル（confScrollRef／confLooped／confActiveSlide）は2026-09-19に廃止＝
  // 本文が JobDetailBody（求人詳細と同じギャラリー部品）になり、写真の送り・ループはそちらが持つ
  const captionTextareaRef = useRef(null);
  const flowScrollRef = useRef(null); // スクロール領域（step遷移時に先頭へ戻す用）
  const pageScrollPositions = useRef({});
  const [reviewBarsHidden, setReviewBarsHidden] = useState(false);
  const [reviewScrolled, setReviewScrolled] = useState(false);
  const reviewScrollLast = useRef(0);
  useEffect(() => {
    reviewScrollLast.current = 0;
    setReviewBarsHidden(false);
    setReviewScrolled(false);
  }, [pageId]);
  const onListingScroll = (event) => {
    const el = event.currentTarget;
    pageScrollPositions.current[pageId] = el.scrollTop;
    if (pageId !== "review") return;
    const top = Math.max(0, el.scrollTop);
    setReviewScrolled(top > 160);
    const delta = top - reviewScrollLast.current;
    reviewScrollLast.current = top;
    if (top < 48 || el.scrollHeight - top - el.clientHeight < 80 || delta < -8) {
      setReviewBarsHidden(false);
    } else if (delta > 8 && top > 100) {
      setReviewBarsHidden(true);
    }
  };


  // draft 復元後に postLoginReturnTo を削除（1回だけ実行）
  useEffect(() => {
    if (_draftInit) {
      try { localStorage.removeItem('postLoginReturnTo'); } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (_devJump) {
      try { localStorage.removeItem('devJump'); } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 派生値
  const workTimeLabel = formatWorkTime({ startHour, startMinute, endHour, endMinute, workTimeRaw });
  const hourlyWage = wageAmount(hourlyWageInput);
  const dailyWage  = wageAmount(dailyWageInput);
  const wageInputOk = Number.isSafeInteger(dailyWage) && dailyWage > 0;
  const workHours = workDurationHours({ startHour, startMinute, endHour, endMinute });
  // 申告休憩（分）：DBトリガーと同じ抽出（"90分"等から最初の数字・無ければ0）
  const breakMinutes = Number((String(breakTime).match(/\d+/) || [0])[0]);
  const { hourlyViolation, dailyViolation, unknownWage } = validateMinWage(hourlyWage, dailyWage, workHours, minWage, breakMinutes);
  const [jobExp,            setJobExp]            = useState(d.jobExp ?? "");
  const [beginnerOk,        setBeginnerOk]        = useState(d.beginnerOk ?? false); // 🌱はじめての人も歓迎 → jobs.beginner_ok
  const [instantApproveRepeat, setInstantApproveRepeat] = useState(d.instantApproveRepeat ?? false); // 🌟また呼びたい即決 → jobs.instant_approve_repeat（効果は自分の求人×自分がお気に入り登録した相手＝repeat_rosterのみ・労働局確認済み）
  const [flagInfoOpen, setFlagInfoOpen] = useState(null); // 「初心者大歓迎とは？」「リピート即決とは？」の説明ボックス（2026-07-18）
  const [jobPerks, setJobPerks] = useState(d.jobPerks ?? null); // この求人だけの待遇上書き → jobs.perks（NULL=プロフィールの待遇・2026-07-18）
  const [experiencedPreferred, setExperiencedPreferred] = useState(d.experiencedPreferred ?? false); // 💪経験者優遇 → jobs.experienced_preferred（2026-07-18・必要経験の選択式は撤回）
  const [jobSaving, setJobSaving] = useState(false);
  // 掲載前の確認（2026-08-07たきと指示「チェックは1つにまとめる」）：4項目は本文として列挙し、
  // 「確認しました」1つのチェックで掲載ボタンを解錠する（旧：4つの個別チェックボックス）
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  // 掲載＝即公開（2026-08-14 承認プロセスの削除・届出受理済み）。運営者本人は直接 open で INSERT、
  // 一般農家は下書き保存→確認記録付き掲載RPCで即 open（RLSは draft/pending のまま＝直接の open 書き込みは不可）。
  // 掲載＝即公開（2026-08-14 承認プロセスの削除）：管理者か一般農家かの体験の分岐（meCanOpen）は廃止。
  // 実際の公開ゲートは不変（jobs admin write・trg_block_third_party_open がが最終担保）。
  const [publishedOpen, setPublishedOpen] = useState(false); // 直前の掲載が即公開だったか（完了画面の文言に使う）
  // 時間外労働（2026-08-03）：有無＋「あり」のときの目安。労働条件の明示事項ので求人ごとに持つ。
  const [overtimePolicy,    setOvertimePolicy]    = useState(d.overtimePolicy ?? "");
  const [overtimeDetail,    setOvertimeDetail]    = useState(d.overtimeDetail ?? "");
  // 就業の場所・業務の【変更の範囲】（2026-08-21・労基則の明示事項）。求人ごとの入力＝
  // 場所はstep3・作業はstep2に選択肢を置く。未選択のまま掲載してもDBトリガー（job_publish_zscope）が
  // 「変更なし」に倒すので掲載は止めない（既定＝働き手に最も有利な約束の側）
  const [placeChangeScope, setPlaceChangeScope] = useState(d.placeChangeScope ?? "変更なし");
  const [taskChangeScope,  setTaskChangeScope]  = useState(d.taskChangeScope ?? "変更なし");
  // 掲載前の必須ガード（2026-07-24〜）：未入力のまま掲載に進ませない（終了求人コピー・編集の受け皿）。
  // 判定の中身は getPublishMissingFields（下）に集約し、openPublish もそこで定義している
  // 確認ページ用：本人の雇い手プロフィール（詳細ページempEmployerと同じデータ源employer_profiles）。
  // 読み込み前から出す（2026-08-03たきと指示「確認ページのプロフィールの復元が遅い」）：お仕事タブが
  // 保存した同じ全列データ（viewCache farm:empMini → アプリ再起動後は snapshot empMini）を初期値にし、
  // 裏で最新へ差し替える。キャッシュは表示専用の規則どおり（保存値・権限判定には使わない）
  const [confEmployer, setConfEmployer] = useState(() => getCache("farm:empMini") ?? snapGet("empMini") ?? null);
  const [confProfileOpen, setConfProfileOpen] = useState(false); // 農家プロ未入力時：カードタップで編集ボックス展開（2026-07-16）
  // 待遇の求人ごと変更（2026-07-18）：確認ページの待遇タップで編集ボックス。
  // 「この求人のみ」＝jobPerksに保持→jobs.perksへ保存／「保存」＝プロフィールにも反映
  // （自由記述3項目=送迎範囲・通勤手当の内容・農家負担の上限はtexts_pending経由。承認プロセス削除後は
  //   DBトリガーが保存の瞬間に公開列へ畳む＝即公開。NG検査＝電話・メール・URLはトリガー側で拒否）
  const [perksEditOpen, setPerksEditOpen] = useState(false);
  const [perkDraft, setPerkDraft] = useState(null);
  // 待遇変更ボックス展開中は下部ナビ（←戻る・保存・掲載する）を画面下へ潜らせる（2026-08-07たきと指示）。
  // 非表示は unmount でなく transform：mount したまま translateY を切り替えることで、
  // 「下へ潜る」と「閉じたら戻る」の両方向が CSS transition で動く（unmountだと退場アニメが効かない）。
  // 移動量＝自分の高さ100%＋下余白＋セーフエリア＝画面外まで確実に出る
  // 確認ページのシートは3つとも同じ規格（枠・見出し・スクロール領域・下部ボタン）＝待遇の変更／
  // 農園プロフィール／掲載前の確認（2026-08-09たきと指示「最後の確認ボックスも待遇と同じ規格に」）。
  // 開いている間の扱い（下部ナビを潜らせる・背後のスクロールを止める）もここで一括して決める。
  const recruiter = useListingRecruiter({ ownerId, initialDraft: d.listingRecruiterDraft,
    onProfile: row => setConfEmployer(previous => ({ ...(previous || {}), ...row })),
  });
  const reloadRecruiter = recruiter.reload;
  const previousProfileEditor = useRef(false);
  useEffect(() => {
    const opened = perksEditOpen || confProfileOpen;
    if (previousProfileEditor.current && !opened) reloadRecruiter();
    previousProfileEditor.current = opened;
  }, [perksEditOpen, confProfileOpen, reloadRecruiter]);
  // 同意は画面の入退場でリセットし、表示後の最初のチェック操作を消さない。
  useLayoutEffect(() => { setPublishConfirmed(false); }, [pageId]);
  const sheetOpen = perksEditOpen || confProfileOpen;
  const sheetNavHide = {
    transform: sheetOpen ? "translateY(calc(100% + 24px + env(safe-area-inset-bottom, 0px)))" : "translateY(0)",
    transition: "transform .3s ease",
    pointerEvents: sheetOpen ? "none" : "auto",
  };
  // シート展開中は背後のページを動かさず、スクロールはシート内だけに効かせる（2026-08-09たきと指示）。
  // ★フローの本体は body ではなく flowScrollRef 自身がスクロールするため、汎用の cb-lock-scroll
  //   （html/bodyを固定・オーバーレイ側に付ける）だけでは止まらない。ここで overflowY も塞ぐ＝2枚で塞ぐ。
  //   シート内のスクロールは position:fixed の別要素なので、この overflow:hidden の影響を受けない。
  const flowScrollLock = sheetOpen ? { overflowY: "hidden" } : null;
  // overflow の切り替えでスクロール位置を失う環境への保険＝開く直前の位置を控え、閉じたらそこへ戻す。
  // 控えは必ず state を変える前に取る（描画後だと overflow:hidden 適用済みで 0 が返る環境がある）ため、
  // シートを開く3箇所で rememberFlowScroll() を呼ぶ
  const flowScrollTopRef = useRef(0);
  const rememberFlowScroll = () => { flowScrollTopRef.current = flowScrollRef.current?.scrollTop || 0; };
  useEffect(() => {
    if (sheetOpen) return;
    const el = flowScrollRef.current;
    if (el && flowScrollTopRef.current && el.scrollTop !== flowScrollTopRef.current) el.scrollTop = flowScrollTopRef.current;
  }, [sheetOpen]);
  const [perkSaving, setPerkSaving] = useState(false);
  const openPerksEdit = () => {
    rememberFlowScroll();
    const base = jobPerks ? { ...(confEmployer || {}), ...jobPerks } : (confEmployer || {});
    setPerkDraft({
      has_transport: !!base.has_transport, transport_area: base.transport_area || "",
      has_parking: !!base.has_parking, parking_capacity: base.parking_capacity || "",
      has_commute_allowance: !!base.has_commute_allowance, commute_allowance_detail: base.commute_allowance_detail || "",
      has_bonus: !!base.has_bonus,
      // 昇給・退職手当（2026-08-19たきと指示）と、あり のときの内容（時期・金額等・任意）
      has_raise: !!base.has_raise, raise_detail: base.raise_detail || "",
      has_severance_pay: !!base.has_severance_pay, severance_detail: base.severance_detail || "",
      bonus_detail: base.bonus_detail || "",
      employer_pays_supplies: !!base.employer_pays_supplies, supplies_cap: base.supplies_cap || "",
      accessory_ok: !!base.accessory_ok,
      // 受動喫煙（2026-08-07たきと指示「ここでも変更可能に」）。jobPerksには入らないため常にプロフィール値
      smoking_policy: (confEmployer && confEmployer.smoking_policy) || "",
      smoking_area: (confEmployer && confEmployer.smoking_area) || "",
    });
    setPerksEditOpen(true);
  };
  // 「この求人のみ」（2026-08-07に関数化）：待遇はこの求人だけの上書き（jobPerks）へ。
  // ★受動喫煙だけは求人ごとの上書きにしない（2026-08-03たきと裁定：同一募集者が喫煙環境の異なる
  //   就業場所を掲載する事例が確認されるまで実装しない）。このボックスで変えた受動喫煙は、
  //   「この求人のみ」を押した場合も事業所の設定＝プロフィールへ保存する（UIにもその旨を明記）
  const applyPerksToJobOnly = async () => {
    if (perkSaving || !perkDraft) return;
    const { smoking_policy, smoking_area, ...jobOnly } = perkDraft;
    const nextArea = smoking_policy === "喫煙場所あり" ? (smoking_area || "").trim() : "";
    const changedSmoking = (smoking_policy || "") !== ((confEmployer && confEmployer.smoking_policy) || "")
      || nextArea !== ((confEmployer && confEmployer.smoking_area) || "");
    if (changedSmoking) {
      setPerkSaving(true);
      try {
        const { data: { session } } = await getSession();
        if (session) {
          const payload = { auth_id: session.user.id, smoking_policy: smoking_policy || null, smoking_area: nextArea };
          if (localOnly) throw new Error("同意の送信完了後に保存できます");
          const { error } = await upsertEmployerProfile(payload);
          if (error) { alert("受動喫煙の保存に失敗しました：" + error.message); setPerkSaving(false); return; }
          const next = { ...(confEmployer || {}), ...payload };
          setConfEmployer(next); setCache("farm:empMini", next);
        }
      } catch { alert("受動喫煙の保存に失敗しました。"); setPerkSaving(false); return; }
      setPerkSaving(false);
    }
    setJobPerks({ ...jobOnly });
    setPerksEditOpen(false);
  };
  const savePerksToProfile = async () => {
    if (perkSaving || !perkDraft) return;
    setPerkSaving(true);
    try {
      const { data: { session } } = await getSession();
      if (!session) { setPerkSaving(false); return; }
      const { data: cur } = await fetchEmployerProfile(session.user.id);
      // 自由記述はtexts_pending経由（変わったキーだけ積む・EmployerProfileEdit.saveと同じ作法）。
      // 2026-08-14承認プロセス廃止後は、DBトリガー（trg_ep_z_publish_texts）が書いた瞬間に公開列へ畳む＝実質即公開
      const desired = {
        transport_area: perkDraft.has_transport ? (perkDraft.transport_area || "") : "",
        commute_allowance_detail: perkDraft.has_commute_allowance ? (perkDraft.commute_allowance_detail || "") : "",
        supplies_cap: perkDraft.employer_pays_supplies ? (perkDraft.supplies_cap.trim() || "") : "",
        raise_detail: perkDraft.has_raise ? (perkDraft.raise_detail || "") : "",
        bonus_detail: perkDraft.has_bonus ? (perkDraft.bonus_detail || "") : "",
        severance_detail: perkDraft.has_severance_pay ? (perkDraft.severance_detail || "") : "",
      };
      // 空にした項目（例：通勤手当のチェックを外す）は審査に出さず、その場で公開列を空にする
      // （2026-08-03たきと指示「入力項目を空にするなら審査は必要ない」）。審査は文字が入る変更だけ
      const { pending: newPend, cleared: clearedTexts } = splitTextsForReview(desired, cur || {});
      const pend = { ...((cur && cur.texts_pending) || {}) };
      Object.keys(desired).forEach(k => { delete pend[k]; });        // 今回触ったキーは一旦外し
      Object.entries(newPend).forEach(([k, v]) => { pend[k] = v; }); // 審査に出す分だけ積み直す
      const payload = {
        auth_id: session.user.id,
        ...clearedTexts, // 空にした項目は即その場で消す（審査を通さない）
        has_transport: perkDraft.has_transport,
        has_parking: perkDraft.has_parking,
        // parking_capacityはinteger列。「3台」等の文字が混ざっても数字だけ取り出し、空はnull（2026-07-19修正）
        parking_capacity: (() => { const n = parseInt(String(perkDraft.parking_capacity ?? "").replace(/[^0-9]/g, ""), 10); return (perkDraft.has_parking && Number.isFinite(n)) ? n : null; })(),
        has_commute_allowance: perkDraft.has_commute_allowance,
        has_bonus: perkDraft.has_bonus,
        has_raise: perkDraft.has_raise,
        has_severance_pay: perkDraft.has_severance_pay,
        employer_pays_supplies: perkDraft.employer_pays_supplies,
        accessory_ok: perkDraft.accessory_ok,
        // 受動喫煙（2026-08-07）：EmployerProfileEditと同じ作法＝直接列へ。
        // 「あり」以外を選んだら場所の記述は保存しない（選び直しの残骸を残さない）
        smoking_policy: perkDraft.smoking_policy || null,
        smoking_area: perkDraft.smoking_policy === "喫煙場所あり" ? (perkDraft.smoking_area || "").trim() : "",
        texts_pending: pend,
        texts_submitted_at: Object.keys(pend).length ? new Date().toISOString() : ((cur && cur.texts_submitted_at) || null),
        // 再提出で修正依頼フラグ（赤帯）を解除（2026-07-19）
        ...(Object.keys(pend).length ? { texts_revision_requested_at: null } : {}),
      };
      if (localOnly) throw new Error("同意の送信完了後に保存できます");
      const { error } = await upsertEmployerProfile(payload);
      if (error) { alert("保存に失敗しました：" + error.message); setPerkSaving(false); return; }
      setJobPerks(null); // プロフィールに保存＝この求人はプロフィールの待遇に従う
      try {
        const { data: ep } = await fetchEmployerProfile(session.user.id);
        if (ep) { setConfEmployer(ep); setCache("farm:empMini", ep); }
      } catch {}
      setPerksEditOpen(false);
    } catch { alert("保存に失敗しました。"); }
    setPerkSaving(false);
  };
  const [confTrust, setConfTrust] = useState(() => getCache("farm:empTrust") ?? null); // 確認ページ用：登録してからの月日など（employer_trust_info・お仕事タブと同じキャッシュ）
  const [confGeo, setConfGeo] = useState(null); // 確認ページ用：住所→座標（詳細ページと同構造のJobLocationMap表示に使用）
  const [confIntroOpen, setConfIntroOpen] = useState(false); // 確認ページ用：農園紹介モーダル（詳細ページと同構造）
  const [jobNotes,          setJobNotes]          = useState(d.jobNotes ?? "");
  const [jobCautions,       setJobCautions]       = useState(d.jobCautions ?? "");
  const [jobTemplate,       setJobTemplate]       = useState(d.jobTemplate ?? "収穫補助");

  // ピル選択とテキスト入力の合成値（自由入力優先）
  const farmerCrop = selectionValue(farmerCropPill, farmerCropText);
  const farmerTask = selectionValue(farmerTaskPill, farmerTaskText);

  // 働き手 state
  const [workerExp,         setWorkerExp]         = useState("");
  const [workerPurpose,     setWorkerPurpose]     = useState(_devJump?.workerPurpose ?? "");
  const [workerDisplayName, setWorkerDisplayName] = useState("");
  const [workerRegion,      setWorkerRegion]      = useState("");
  const [workerTransport,   setWorkerTransport]   = useState("");
  const [workerDays,        setWorkerDays]        = useState([]);
  const [workerTimeSlot,    setWorkerTimeSlot]    = useState("");
  const [workerWork,        setWorkerWork]        = useState("");
  const [workerCrop,        setWorkerCrop]        = useState("");
  const [workerHourly,      setWorkerHourly]      = useState("");
  const [workerDaily,       setWorkerDaily]       = useState("");
  const [workerHours,       setWorkerHours]       = useState("");

  const isFarmer = role === "farmer";
  const isWorker = role === "worker";
  const TOTAL = isFarmer ? 15 : 8;

  // step遷移アニメ：退場(0.4s)→step切替→入場(0.4s)＝体感0.8秒（2026-07-16）。連打はbusyガードで無視
  const [stepAnim, setStepAnim] = useState("");
  const stepAnimBusy = useRef(false);
  const stepAnimTimer = useRef(null);
  useEffect(() => () => clearTimeout(stepAnimTimer.current), []);
  const animateStepChange = (applyChange, dir) => {
    if (stepAnimBusy.current) return;
    stepAnimBusy.current = true;
    if (isFarmer) {
      // 先に画面を切り替える。入力のたびに400ms待たせず、短いフェードだけを重ねる。
      applyChange();
      setStepAnim("listing-motion");
      stepAnimTimer.current = setTimeout(() => { stepAnimBusy.current = false; }, 160);
      return;
    }
    setStepAnim(dir === "fwd" ? "step-out-left" : "step-out-right");
    setTimeout(() => {
      applyChange();
      setStepAnim(dir === "fwd" ? "step-in-right" : "step-in-left");
      stepAnimBusy.current = false;
    }, 400);
  };
  const goNext = () => animateStepChange(() => {
    if (isFarmer) setPage(adjacentListingPage(pageId, 1, { start: jobDateStart, end: jobDateEnd, photoCount: jobPhotos.length, hasVideo: !!workVideoUrl.trim(), missingRecruiter: recruiter.missing }));
    else setStep(s => s + 1);
  }, "fwd");
  const goBack = () => animateStepChange(() => {
    if (isFarmer) setPage(adjacentListingPage(pageId, -1, { start: jobDateStart, end: jobDateEnd, photoCount: jobPhotos.length, hasVideo: !!workVideoUrl.trim(), missingRecruiter: recruiter.missing }) || "intro");
    else if (step <= 1) setStep(0); else setStep(s => s - 1);
  }, "back");
  // 全stepスワイプ移動（2026-07-16）：左スワイプ=次へ（バリデーション尊重）／右スワイプ=戻る。
  // 掲載(step11→)と完了(step12)からは進めない。step1の戻りはスワイプでも不可（戻るボタン削除と整合）
  const flowSwipe = useRef(null);
  const onFlowTouchStart = (e) => { if (isFarmer) return; flowSwipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };

  // 確認ページ(step11)からの編集ジャンプ中フラグ。trueの間、共通フッターの「次へ／戻る」は
  // 通常の順送りでなく確認ページへ直帰する（Airbnb出品確認の「編集→保存して確認へ戻る」と同型）。
  useEffect(() => {
    if (pageId === "review") setReturnToConfirm(false); // 確認ページ到達で必ず解除（保険）
    if (step === 13) fbCelebrate(); // 完了ページ到達＝祝祭の音と振動（2026-08-06・画面は既存の完了ページのまま）
  }, [step, pageId, setReturnToConfirm]);

  useEffect(() => {
    if (onStepChange && role === "farmer" && isListingInputPage(pageId) && !isWorkplaceRoute()) onStepChange(step, pageId);
  }, [pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draftJobNumber, setDraftJobNumber] = useState(_deviceInit?.jobNumber ?? _editJobNumber ?? _draftInit?.job_number ?? null);
  // 集合場所の復元元＝農家プロフィールの「作業場所」。未登録なら専用ページへ進む。
  const [prevAddress, setPrevAddress] = useState(null);
  const [placeStatus, setPlaceStatus] = useState("loading");
  const [placeRetry, setPlaceRetry] = useState(0);
  const [placeNotice, setPlaceNotice] = useState("");
  const [placePageOpen, setPlacePageOpen] = useState(isWorkplaceRoute);
  useEffect(() => {
    if (!isFarmer || pageId !== "workplace" || prevAddress) return;
    let cancelled = false;
    setPlaceStatus("loading");
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (cancelled) return;
        if (!session) throw new Error("session unavailable");
        const { data: ep, error } = await fetchEmployerPlaceAddress(session.user.id);
        if (cancelled) return;
        if (error) throw error;
        if (ep && [ep.place_city, ep.place_zip, ep.place_address].some(value => (value || "").trim())) {
          setPrevAddress({ zip: ep.place_zip, prefecture: ep.place_prefecture, city: ep.place_city, town: ep.place_town, address: ep.place_address });
        }
        setPlaceStatus("ready");
      } catch { if (!cancelled) setPlaceStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [pageId, isFarmer, prevAddress, placeRetry]);
  useEffect(() => {
    const syncPage = () => {
      const open = isWorkplaceRoute();
      setPlacePageOpen(open);
      if (open) setStep(3);
    };
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, [setStep]);
  const applyWorkplaceAddress = address => {
    // 入力中に始まった郵便番号検索が、選んだ作業場の住所を上書きしない。
    zipLookupVersion.current += 1;
    setZipSearching(false);
    setFarmerZip(address.zip || ""); setFarmerPref(address.prefecture || ""); setFarmerCity(address.city || "");
    setFarmerTown(address.town || ""); setFarmerAddr(address.address || "");
    setFarmerRegion((address.prefecture || "") + (address.city || "") + (address.town || ""));
    setZipError("");
  };
  const openWorkplacePage = () => {
    zipLookupVersion.current += 1;
    setZipSearching(false);
    setPlaceNotice("");
    setPlacePageOpen(true);
    const scope = parseListingRoute(window.location.hash)?.scope;
    if (scope) window.location.hash = `/${scope}/workplace${returnToConfirm ? "?return=review" : ""}`;
  };
  const closeWorkplacePage = () => {
    setPlacePageOpen(false);
    // 保存後の「戻る」で登録フォームが再表示されないよう、戻り先で置き換える。
    const scope = parseListingRoute(window.location.hash)?.scope;
    if (scope) window.history.replaceState(window.history.state, "", `#/${scope}/page/workplace${returnToConfirm ? "?return=review" : ""}`);
  };
  // 集合場所の説明の一本化（2026-08-08たきと指示「各説明が散乱して読まない。1箇所に・〇〇とは？形式で」）：
  // 欄ごとに散らばっていた注記（自動入力・町域まで公開・番地は会員のみ・プライバシー）を
  // 「集合場所の公開範囲とは？」のタップ展開1つに集約。UI一時state・保存しない
  const [placeInfoOpen, setPlaceInfoOpen] = useState(false);
  // jobs行 → フローのstateへ復元（2026-08-03に関数化）。コピー直後の即時復元（prefill）と
  // 通常の読み込みで同じ対応表を使う＝どちらかだけ直して食い違う事故を防ぐ
  const applyJobRow = (data) => {
    if (ownerId && data.id && data.farmer_id === ownerId) {
      deviceDraftRef.current = newDeviceDraft(ownerId, data);
      deviceReadyRef.current = true;
    }
    setEditingOpen(!!_editJobNumber && data.status === "open");
    setRole("farmer");
    const input = jobFormFromRow(data, { cropOptions: CROP_OPTIONS, taskOptions: TASK_OPTIONS });
    setFarmerCropPill(input.farmerCropPill);
    setFarmerTaskPill(input.farmerTaskPill);
    setFarmerCropText(input.farmerCropText);
    setFarmerTaskText(input.farmerTaskText);
    setFarmerZip(input.farmerZip);
    setFarmerPref(input.farmerPref);
    setFarmerCity(input.farmerCity);
    setFarmerTown(input.farmerTown);
    setFarmerAddr(input.farmerAddr);
    setFarmerRegion(input.farmerRegion);
    setJobDateStart(input.jobDateStart);
    setJobDateEnd(input.jobDateEnd);
    setJobCount(input.jobCount);
    setFarmerPayType(input.farmerPayType);
    setHourlyWageInput(input.hourlyWageInput);
    setDailyWageInput(input.dailyWageInput);
    setBreakTime(input.breakTime);
    setNearestStation(input.nearestStation);
    setCommuteTime(input.commuteTime);
    setJobExp(input.jobExp);
    setBeginnerOk(input.beginnerOk);
    setInstantApproveRepeat(input.instantApproveRepeat);
    setJobPerks(input.jobPerks);
    setExperiencedPreferred(input.experiencedPreferred);
    setJobDescription(input.jobDescription);
    setWorkVideoUrl(input.workVideoUrl);
    setWorkVideoJobConsent(input.workVideoJobConsent);
    setWorkVideoRelatedConsent(input.workVideoRelatedConsent);
    setWorkVideoConsentAt(input.workVideoConsentAt);
    setWorkVideoConsentVersion(input.workVideoConsentVersion);
    setJobNotes(input.jobNotes);
    setJobCautions(input.jobCautions);
    setOvertimePolicy(input.overtimePolicy);
    setOvertimeDetail(input.overtimeDetail);
    setPlaceChangeScope(input.placeChangeScope);
    setTaskChangeScope(input.taskChangeScope);
    setJobDangerPlaces(input.jobDangerPlaces);
    setJobDangerTasks(input.jobDangerTasks);
    setShowPlace2(input.showPlace2);
    setShowTask2(input.showTask2);
    setJobPhotos(input.jobPhotos);
    setJobHolidays(input.jobHolidays);
    setWorkTimeRaw(input.workTimeRaw);
    if (Object.hasOwn(input, "startHour")) {
      setStartHour(input.startHour); setStartMinute(input.startMinute);
      setEndHour(input.endHour); setEndMinute(input.endMinute);
    }
    // 同期済み端末記録からは再開位置だけを使う。入力値・比較元は読み直したDB行を正とする。
    const lastPosition = ownerId && data.id ? listDeviceDrafts(ownerId).find(record =>
      record.jobId === data.id && record.jobNumber === data.job_number && record.state === "synced")?.form : null;
    const resumeInput = lastPosition?.listingPageId != null ? { ...input,
      listingPageId: lastPosition.listingPageId, listingNavVersion: lastPosition.listingNavVersion,
      listingReturnToReview: lastPosition.listingReturnToReview } : input;
    if (lastPosition?.listingRecruiterDraft) recruiter.restore(lastPosition.listingRecruiterDraft);
    restorePage(resumeInput, input.farmerStep);
  };

  // 編集・コピーで開いた時の復元（2026-08-03に高速化）。
  // 【従来の問題】stepの初期値が0（＝フローの入口）で、jobsを読み終えてから確認ページへ飛ぶ設計だった。
  // そのため通信が少しでも遅いと「はじめから」の画面が見え続けた（コピー直後に多発）。
  // 【対処】①stepの初期値を編集モードでは11（確認ページ）に変更＝入口をそもそも描かない
  //        ②コピー直後は copy_job が返した行をsessionStorage経由で受け取り、通信を待たずに即復元
  //        ③通常の読み込みは getSession の往復を待たない（jobsのRLS owner select が自分の行に絞るので
  //          farmer_idの明示条件は冗長だった）＝1往復ぶん速くなる
  useEffect(() => {
    if (!_editJobNumber || _deviceInit?.form) return;
    let cancelled = false;
    setEditJobLoading(true);
    setEditJobError("");
    let prefillApplied = false; // コピー直後の即時復元が済んだら、遅れて届くDB復元で上書きしない（下記★）
    // ②コピー直後の即時復元：copy_jobの返り値をそのまま使う（ネット往復ゼロ）。一度きりで消費する
    try {
      const raw = sessionStorage.getItem("cb_editJobPrefill");
      if (raw) {
        sessionStorage.removeItem("cb_editJobPrefill");
        const row = JSON.parse(raw);
        if (row && row.job_number === _editJobNumber && (!ownerId || row.farmer_id === ownerId)) {
          applyJobRow(row); prefillApplied = true;
          // カレンダーの「この日にコピー」の日＝【画面の入力にだけ】入れる（2026-09-23）。
          // 行(row)に重ねると端末が覚える比較元(base)がDBの行と食い違い、掲載時の同期が conflict で詰まる。
          // DBの下書きは日程なしのまま＝この日は「掲載する」「保存」で入る
          try {
            const p = JSON.parse(sessionStorage.getItem("cb_editJobPresetDates") || "null");
            sessionStorage.removeItem("cb_editJobPresetDates");
            if (p && p.job_number === _editJobNumber) {
              setJobDateStart(calendarDateFromYmd(p.date_start));
              setJobDateEnd(calendarDateFromYmd(p.date_end));
              if (Array.isArray(p.holidays)) setJobHolidays(p.holidays);
            }
          } catch {}
        }
      }
    } catch {}
    (async () => {
      try {
        // ★コピー直後（prefill適用済み）はネットワーク側の復元をしない（2026-08-09たきと報告
        //   「休日を連続で入力すると募集日に反転する」の根治）。prefillの行とDBの行は同一なのに、
        //   遅れて届いた2回目の applyJobRow が、その間に入力した休日などを丸ごと巻き戻していた
        //   （DBのコールドスパイクで2〜6秒遅れる実測あり＝入力が数タップ進んでから上書きされる）。
        //   直接の編集（prefillなし）は復元がこの1回だけ＝従来どおり実行する
        if (prefillApplied) return;
        // ③セッションと求人を並列で取る（従来はgetSession→jobsの直列で、JWT更新が走ると
        //   その待ちがまるまる上乗せされていた）。取れなければ何もしない（prefillの値を残す）
        const [sessRes, jobRes] = await Promise.all([
          getSession(),
          fetchJobByNumber(_editJobNumber),
        ]);
        if (cancelled) return;
        const uid = sessRes?.data?.session?.user?.id;
        const data = jobRes?.data;
        if (jobRes?.error || !data) throw new Error("job_unavailable");
        // 所有者チェックは維持（管理者はRLS上ずべての求人を読めるので、他人の求人を編集フローで開かせない）
        if (!uid || data.farmer_id !== uid) throw new Error("job_unavailable");
        // 公開中の求人は「進行中の応募が無い」時だけ編集できる（DBの update_my_open_job と同じ物差し）。
        // あるなら入力させる前に止めてコピーへ誘導する（保存の時に拒否されると入力が無駄になる）
        if (data.status === "open") {
          try {
            const { count, error } = await countLiveApplications(_editJobNumber);
            if (!error && (count || 0) > 0) {
              alert("応募が届いている求人は、内容を変えられません（応募した方はこの内容を見て決めています）。内容を変える場合は、コピーで新しい求人として出してください。");
              if (typeof onSkip === "function") onSkip();
              return;
            }
          } catch {}
        }
        if (!cancelled) applyJobRow(data);
      } catch {
        if (!cancelled) setEditJobError("保存した求人を読み込めませんでした。もう一度お試しください。");
      } finally {
        if (!cancelled) setEditJobLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editJobRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // 汚染された下書きの自浄（2026-08-09）：修正前は編集・コピー中も localStorage 下書きに書いていたため、
  // 端末に「既存求人の全項目＋job_number」が残っている場合がある。#/work/new でそれを復元すると
  // 入力した覚えのない文字（前の求人の備考・注意など）が出る上、保存すると既存求人を上書きしてしまう。
  // → 復元した下書きが job_number を持つのに、その求人が status='draft' でない（掲載済み・終了等）なら
  //   下書きごと捨てて白紙から始める。本物の下書きの再開（status='draft'）はそのまま通す。
  // 通信失敗時は消さない（フェイルセーフ規則＝res.errorで手元を上書きしない・2026-08-07）
  useEffect(() => {
    if (ownerId || _editJobNumber || !_draftInit?.job_number) return;
    (async () => {
      try {
        const { data, error } = await fetchJobStatus(_draftInit.job_number);
        if (error) return;
        if (!data || data.status !== "draft") {
          try { localStorage.removeItem("landingFlowDraft_v1"); localStorage.removeItem("postLoginReturnTo"); } catch {}
          applyJobRow({ draft_step: 1 }); // 全項目を白紙へ（applyJobRowの既定値＝空で統一）
          setDraftJobNumber(null);
        }
      } catch {}
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMsg, setDraftMsg] = useState("");
  const [publishIssue, setPublishIssue] = useState("");
  const [draftBarFull, setDraftBarFull] = useState(false);
  const [draftOverlay, setDraftOverlay] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  // その場保存（下部ナビ「保存」）の完了表示。遷移しない代わりに、保存できたことをここで知らせる
  const [savedToast, setSavedToast] = useState(false);
  const savedToastTimer = useRef(null);
  useEffect(() => () => { if (savedToastTimer.current) clearTimeout(savedToastTimer.current); }, []);

  // ドラフト保存 → ログイン後に LandingFlow 初期化時に復元される
  // 入力の採取は一か所。変換はcodec、保存と同期待ちは既存の各層へ渡す。
  function currentJobForm() {
    return {
        listingRecruiterDraft: recruiter.draft,
        role: "farmer", farmerStep: step, listingPageId: pageId, listingNavVersion: LISTING_NAV_VERSION, listingReturnToReview: returnToConfirm, job_number: draftJobNumber, // 保存時点の実ステップとupsertキーを記録
        farmerExp, farmerPurpose, farmerDisplayName, farmerRegion,
        farmerZip, farmerPref, farmerCity, farmerTown, farmerAddr, jobPhotos,
        farmerCropPill, farmerCropText, farmerTaskPill, farmerTaskText,
        farmerWanted, farmerPayType, payTiming, payMethod,
        startHour, startMinute, endHour, endMinute, workTimeRaw,
        jobCount, breakTime, commuteTime, nearestStation, jobDangerPlaces, jobDangerTasks, hourlyWageInput, dailyWageInput,
        jobExp, jobTemplate, jobNotes, jobCautions, overtimePolicy, overtimeDetail, placeChangeScope, taskChangeScope, jobDescription,
        workVideoUrl, workVideoJobConsent, workVideoRelatedConsent, workVideoConsentAt, workVideoConsentVersion,
        beginnerOk, instantApproveRepeat, jobPerks, experiencedPreferred,
        jobDateStart,
        jobDateEnd,
        jobHolidays,
      };
  }

  const saveDraft = (payloadOverride) => {
    if (completedRef.current || !deviceReadyRef.current || localRouteMissing || routeError) return null;
    const draft = serializeJobForm(currentJobForm());
    try {
      if (ownerId) {
        const record = deviceDraftRef.current || newDeviceDraft(ownerId);
        const saved = saveDeviceDraft(record, draft, payloadOverride || buildJobPayload(ownerId, "draft"));
        deviceDraftRef.current = saved;
        if (!_editJobNumber && !/work\/local\//.test(window.location.hash)) activeDeviceDraft(ownerId, saved.id);
        sessionStorage.removeItem("cb_anonymousDraft");
        return saved;
      }
      if (!_editJobNumber) {
        localStorage.setItem("landingFlowDraft_v1", JSON.stringify(draft));
        localStorage.setItem("postLoginReturnTo", "landingFlowFarmerConfirm");
        sessionStorage.setItem("cb_anonymousDraft", "1");
      }
      return draft;
    } catch (error) {
      setDraftMsg(error.message === "DEVICE_DRAFT_CHANGED"
        ? "保存済みの下書きと、この画面の入力内容に差があります。入力内容は消えていません。いったん「保存して終了」し、下書きを開き直してください。"
        : "この端末に保存できません。画面を閉じずに、ブラウザーの空き容量をご確認ください。");
      return null;
    }
  };

  const jobDateLabel = dateLabel(jobDateStart, jobDateEnd);

  function buildJobPayload(authUid, statusVal = "pending", geo = null) {
    return jobPayloadFromForm(currentJobForm(), {
      ownerId: authUid, status: statusVal, geo, base: deviceDraftRef.current?.base,
    });
  }

  const handleTopSave = ({ exit = false } = {}) => {
    if (draftSaving || completedRef.current) return;
    setDraftSaving(true); setDraftMsg("");
    const saved = saveDraft();
    if (!saved) { setDraftSaving(false); return; }
    if (!ownerId) { setDraftSaving(false); onLogin(); return; }
    try {
      queueDeviceDraft(ownerId, saved.id);
      setDraftSaving(false);
      if (exit) {
        completedRef.current = true;
        if (typeof onDraftSaved === "function") onDraftSaved(null);
        else window.location.hash = "/profile/employer/drafts";
      } else setDraftMsg(saved.publication
        ? "入力はこの端末に保存済みです。先の掲載結果を確認するため、確認画面で「掲載する」を押してください。"
        : "この端末に保存済み・同期待ち。通信が戻ると自動で送信します。");
    } catch {
      // queueDeviceDraft が投げるのは端末に書けない時だけ（conflict/blocked は例外にしない・2026-09-23）
      setDraftSaving(false);
      setDraftMsg("この端末に保存できません。画面を閉じずに、ブラウザーの空き容量をご確認ください。");
    }
  };

  // 同期結果は番号と比較元だけ更新する。待っている間に入力したフォームを巻き戻さない。
  useEffect(() => {
    const sync = () => {
      const previous = deviceDraftRef.current;
      if (!previous) return;
      const saved = readDeviceDraft(ownerId, previous.id);
      if (saved && saved.revision === previous.revision) {
        deviceDraftRef.current = saved;
        if (saved.jobNumber) setDraftJobNumber(saved.jobNumber);
      }
    };
    window.addEventListener(DEVICE_DRAFT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(DEVICE_DRAFT_EVENT, sync); window.removeEventListener("storage", sync); };
  }, [ownerId]);

  // devJumpは1回のマウントで消費したら破棄する（残り続けると、後日の通常フロー起動時に
  // _devJumpが読まれて古いstep/roleへ勝手にジャンプする。読み込み済みの_devJump変数には影響しない）
  useEffect(() => { try { localStorage.removeItem('devJump'); } catch {} }, []);

  // 働き手フロー完了（step8）＝ページでなくアニメーション（2026-08-07たきと指示・③）。
  // onWorkerDone があれば親（App）が祝祭＋案内トースト＋着地を出すので、ここでは1回通知するだけで何も描かない
  // （フロー自体は親が閉じる＝フロー内に祝祭を置くとアンマウントで消えるため親側に置く・onPublishedと同じ作法）。
  // 未指定の呼び出しは従来の完了画面にフォールバック（onPublished未指定→step12と同じ後方互換）
  const workerDoneFired = useRef(false);
  useEffect(() => {
    if (!(isWorker && step === 8) || typeof onWorkerDone !== "function") return;
    if (workerDoneFired.current) return;
    workerDoneFired.current = true;
    onWorkerDone();
  }, [isWorker, step, onWorkerDone]);

  // 確認ページ到達時：住所からおおよその座標を取得（保存時のgeocodeTownと同じ手順。
  // 取得失敗・住所未入力ならnullのまま＝JobLocationMapが「地図は準備中です」を表示）
  useEffect(() => {
    if (pageId !== "review" || role !== "farmer") return;
    let cancelled = false;
    (async () => {
      const geo = await geocodeTown(farmerPref, farmerCity, farmerTown);
      if (!cancelled) setConfGeo(geo);
    })();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // 確認ページ用：本人の雇い手プロフィールを取得（詳細ページと同構造のプロフィールカード・農園紹介に使用。
  // 未ログイン・未作成なら null のまま＝最小カードにフォールバック）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (!session) return;
        // 依存の無い2本は並列（2026-08-03・直列2往復→1往復ぶんの待ちに）。
        // 取得できたらお仕事タブと同じキャッシュへ書き戻す＝どちらの画面から入っても次回は即描画
        const [epRes, tRes] = await Promise.all([
          fetchEmployerProfile(session.user.id),
          Promise.resolve(fetchEmployerTrustInfo(session.user.id)).catch(() => ({ data: null })),
        ]);
        if (epRes.data) { setConfEmployer(epRes.data); setCache("farm:empMini", epRes.data); }
        const t = tRes.data;
        if (t && t.ok) { setConfTrust(t); setCache("farm:empTrust", t); }
      } catch {}
    })();
  }, [confProfileOpen]); // 編集ボックスを閉じたら再取得＝入力したプロフィールが確認ページに即反映（2026-07-16）

  // プロフィール入力のお願い（2026-07-17）：確認ページ到達時、農家プロに未入力の項目があれば
  // Appルートへ通知（cb:confirmNotice→trigger=confirmのお知らせ展開）。判定項目は農家プロ入口の
  // ボックス格子(boxFilled: avatar/nickname/place/perks/staff/intro/ask/style)と同じ8区分
  useEffect(() => {
    if (pageId !== "review" || role !== "farmer") return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (!session) return;
        const { data: ep } = await fetchEmployerProfile(session.user.id);
        if (cancelled) return;
        const filledText = (...vals) => vals.some(v => (v || "").trim() !== "");
        const hasUnfilled = !ep
          || !ep.avatar_url
          || !filledText(ep.nickname)
          || !filledText(ep.place_city)
          || !(ep.has_transport || ep.has_parking || ep.has_commute_allowance || ep.has_bonus || ep.has_raise || ep.has_severance_pay || ep.employer_pays_supplies || ep.accessory_ok)
          || !filledText(ep.owner_comment, ep.intro_path, ep.intro_joy, ep.intro_crops, ep.intro_atmosphere, ep.intro_message)
          || !filledText(ep.unique_point, ep.always_do, ep.break_style)
          || !filledText(ep.interaction_style);
        if (hasUnfilled) window.dispatchEvent(new Event("cb:confirmNotice"));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  // お知らせの「はじめる」リンク（event:cb:openConfProfile）＝農家プロ入力ボックスをこの場で展開
  useEffect(() => {
    const f = () => { rememberFlowScroll(); setConfProfileOpen(true); };
    window.addEventListener("cb:openConfProfile", f);
    return () => window.removeEventListener("cb:openConfProfile", f);
  }, []);

  // Airbnb模擬・部品1:step移動ごとに自動で下書き保存（農家フロー中のみ・home(0)と完了(12)は除外）
  useEffect(() => {
    if (role === "farmer" && isListingInputPage(pageId)) saveDraft();
  }, [pageId, returnToConfirm]); // eslint-disable-line react-hooks/exhaustive-deps

  // 入力のたびの自動保存（2026-08-09たきと報告「休日にした日が募集日に反転する」の根治）。
  // 従来の自動保存はstep移動時のみで、同じページに留まったまま入力した分（日程ページの休日・
  // 期間・人数など）は、リロードやアプリ切替からの再起動（iOSのメモリ整理・引き下げ更新・
  // 更新直後の自動復旧）で失われていた。期間は先のstep移動時に保存済みのことが多く残るため、
  // 「休日だけ消えて募集日に戻る」ように見える（jsdom＋実コンポーネントで再現・修正後の復元を実測）。
  // → 主要入力が変わるたび800msのデバウンスで下書きへ書く＝いつ再起動しても直前の入力から再開できる。
  //   saveDraft自体が編集・コピー中は書かないガード（_editJobNumber）を持つので、汚染の再発はない
  const draftInputSaveTimer = useRef(null);
  useEffect(() => {
    if (!(role === "farmer" && isListingInputPage(pageId))) return;
    if (draftInputSaveTimer.current) clearTimeout(draftInputSaveTimer.current);
    saveDraft();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmerExp, farmerPurpose, farmerDisplayName, farmerRegion, farmerZip, farmerPref, farmerCity, farmerTown, farmerAddr,
      jobPhotos, farmerCropPill, farmerCropText, farmerTaskPill, farmerTaskText, farmerWanted, farmerPayType, payTiming, payMethod,
      startHour, startMinute, endHour, endMinute, workTimeRaw, jobCount, breakTime, commuteTime, nearestStation,
      jobDangerPlaces, jobDangerTasks, hourlyWageInput, dailyWageInput, jobExp, jobTemplate, jobNotes, jobCautions,
      overtimePolicy, overtimeDetail, placeChangeScope, taskChangeScope, jobDescription,
      workVideoUrl, workVideoJobConsent, workVideoRelatedConsent, workVideoConsentAt, workVideoConsentVersion,
      beginnerOk, instantApproveRepeat, jobPerks, experiencedPreferred,
      jobDateStart, jobDateEnd, jobHolidays, editJobLoading, recruiter.draft]);


  // ページごとのスクロール位置を保持し、戻る時は見出しへフォーカスだけを戻す。
  useEffect(() => {
    try {
      if (flowScrollRef.current) flowScrollRef.current.scrollTo(0, isFarmer ? (pageScrollPositions.current[pageId] || 0) : 0);
      window.scrollTo(0, 0);
      if (isFarmer) {
        const heading = flowScrollRef.current?.querySelector(".listing-page h1, .listing-page h2");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus({ preventScroll: true });
      }
    } catch {}
  }, [step, pageId, isFarmer, placePageOpen]);

  // 選択した瞬間に次へ進む（140ms で選択状態を視認させてから遷移）
  const selectAndNext = (setter, value) => {
    setter(value);
    setTimeout(() => setStep(s => s + 1), 140);
  };

  // 自動遷移ステップ（次へボタン非表示、戻るのみ表示）
  const isAutoStep = (
    step === 0 ||
    (isWorker && step === 1) ||
    (isWorker && step === 2)
  );

  // UI helpers はモジュールレベルに移動済み（LF_ プレフィックス）

  // ── タイポグラフィ定数 ─────────────────────────────────────
  // タイポグラフィ定数 lfStyles → features/jobs/create/lfStyles.js へ移設（2026-08-17）

  // canGoNext per step
  // 農家6ステップ: 0=home,1=就農歴,2=目的,3=プロフィール,4=詳細,5=確認,6=完了
  const prefNotAllowed = !!farmerPref.trim() && !isAllowedPrefecture(farmerPref);
  // 時間外労働の入力が揃っているか（2026-08-03たきと指示「必須」）：有無は必ず選ぶ。
  // 「あり」なら目安の時間まで書く＝「有無（どれくらいの時間）」を明記させる
  const overtimeOk = !!overtimePolicy && (overtimePolicy !== "あり" || !!overtimeDetail.trim());
  // 賃金の確認待ちでも下書きの入力は続ける。掲載時の必須チェックとDB検査は維持する。
  // 住所の実在チェック（2026-09-27）：町域まで見つからない住所は入力エラー＝「次へ」も掲載も止める。
  // 通信で確かめられない時（"error"）は止めない（フェイルオープン）
  const townCheck = useTownCheck(farmerPref, farmerCity, farmerTown);
  const farmerCanNext = {
    intro: true, crop: !!farmerCrop, task: !!farmerTask, task_scope: !!taskChangeScope, place_scope: !!placeChangeScope, access: true,
    workplace: !!farmerZip.trim() && isAllowedPrefecture(farmerPref) && !!farmerCity.trim() && !!farmerTown.trim() && townCheck !== "notfound" && isValidStreetAddress(farmerAddr),
    schedule: validSchedule(jobDateStart, jobDateEnd), holidays: validSchedule(jobDateStart, jobDateEnd), headcount: validHeadcount(jobCount),
    work_time: workHours > 0, break_time: breakTime !== "", overtime: overtimeOk,
    daily_wage: farmerPurpose !== "post" || (workHours > 0 && wageInputOk && (unknownWage || !dailyViolation) && breakTime !== ""),
    details_intro: true, photos: !photoUploading, photo_captions: true, description: true,
    work_video: !workVideoUrl.trim() || isValidYoutubeVideo(workVideoUrl),
    video_consent: !workVideoUrl.trim() || workVideoJobConsent,
    danger_places: !photoUploading, danger_tasks: !photoUploading,
    belongings: true, cautions: true, worker_preferences: true, repeat_approval: true, review: true,
    publish_consent: publishConfirmed,
    ...Object.fromEntries(Object.keys(RECRUITER_FIELDS).map(id => [id, recruiter.status === "ready" && recruiterPageValid(id, recruiter.values)])),
  };
  const workerCanNext = [true, !!workerExp, !!workerPurpose, true, true, true, true, true, true];
  const canGoNext = isFarmer ? (farmerCanNext[pageId] ?? false) : isWorker ? (workerCanNext[step] ?? true) : true;

  // ↓ここに置く理由：この中で canGoNext を読むため、その宣言より後ろに置く
  //   （2026-07-29に並べ替え・中身は不変。参照はJSXのonTouchEndのみ）
  const onFlowTouchEnd = (e) => {
    const s = flowSwipe.current;
    flowSwipe.current = null;
    if (!s || pageId === "publish_consent" || showExitModal || photoCaptionsOpen || placePageOpen) return;
    if (step === 12) return; // 確認ページは横スワイプ遷移なし（2026-07-16たきと指定・写真カルーセル優先）
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // 縦スクロール優先
    if (dx < 0) {
      if (step === 12 || step === 13 || step >= TOTAL || !canGoNext) return;
      if (returnToConfirm) { setStep(12); setReturnToConfirm(false); return; }
      goNext();
    } else {
      if (step <= 1 || step === 13 || step >= TOTAL) return;
      if (returnToConfirm) { setStep(12); setReturnToConfirm(false); return; }
      goBack();
    }
  };

  // 掲載（status=pending投入）前の必須項目チェック。欠けている項目を {label, step} で返す。
  // ★掲載前チェックの唯一のソース＝「掲載する」(openPublish)と保存(handleSaveJob)の両方がここを見る。
  //   必須項目を足すときはこの表だけ直す。2箇所に散らすと、確認ページに直接入る経路
  //   （求人の編集・コピー＝step3/4/5を通らない）がフロントを素通りし、DBのエラーで止まることになる。
  // step はその項目を入力するページ＝案内するだけでなく、その欄へ実際に送るために持たせている。
  const getPublishMissingFields = () => {
    const checks = [
      ["作物",                   !!farmerCrop,                        1],
      ["作業",                   !!farmerTask,                        2],
      ["郵便番号",                !!farmerZip.trim(),                  3],
      ["都道府県（徳島県）",        isAllowedPrefecture(farmerPref),     3],
      ["市区町村",                !!farmerCity.trim(),                 3],
      ["町域（実在する住所）",       !!farmerTown.trim() && townCheck !== "notfound", 3],
      ["番地・建物名",             isValidStreetAddress(farmerAddr),    3],
      ["作業日程（開始日）",       validSchedule(jobDateStart, jobDateEnd), "schedule"],
      ["採用人数",                validHeadcount(jobCount),            "headcount"],
      // 勤務時間：終了が開始以前だと、DB側の job_scheduled_minutes が null を返して掲載が止まる。
      // かつ日給の最賃判定（validateMinWage）も workHours>0 のときしか働かないため、ここで先に止める
      ["勤務時間（開始〜終了）",    workHours > 0,                       "work_time"],
      ["日給（最低賃金以上）", wageInputOk && !unknownWage && !minWageLoading && !dailyViolation,      "daily_wage"],
      ["休憩時間",                breakTime !== "",                    "break_time"],
      ["時間外労働",              overtimeOk,                          "overtime"],
      ["作業動画のURL", !workVideoUrl.trim() || isValidYoutubeVideo(workVideoUrl), "work_video"],
      ["作業動画の掲載同意", !workVideoUrl.trim() || workVideoJobConsent, "video_consent"],
    ];
    if (recruiter.status === "ready") {
      for (const id of recruiter.missing) checks.push([RECRUITER_FIELDS[id].title, false, id]);
    }
    return checks.filter(([, ok]) => !ok).map(([label, , step]) => ({ label, step }));
  };
  // 足りない欄を伝えて、その欄のページへ送る（案内だけで終わらせない）。戻り先は確認ページ。
  // プロフィール由来の必須項目も、同じ固定IDの専用ページへ案内する。
  const goToMissingField = (missing) => {
    setPublishIssue("掲載前に確認が必要です：" + missing.map(m => m.label).join("、"));
    const target = missing.find(m => m.step != null);
    if (!target) return;
    setReturnToConfirm(true);
    if (typeof target.step === "string") setPage(target.step); else setStep(target.step);
  };
  const openPublish = () => {
    setPublishIssue("");
    try {
    if (localOnly) {
      handleTopSave();
      setDraftMsg("同意の送信完了後に掲載できます。入力を続けたり、保存して終了したりできます。");
      return;
    }
    if (readDeviceDraft(ownerId, deviceDraftRef.current?.id)?.publication) {
      setPublishIssue("先の掲載と確認記録の結果を、同じ操作IDで確認します。待っている間の追加編集は送りません。");
        setPublishConfirmed(false);
      setPage("publish_consent", { returnToConfirm: false });
      return;
    }
    if (recruiter.status !== "ready") {
      setPublishIssue("掲載に必要な登録情報を確認できません。登録情報を再確認してください。入力は保持されています。");
      return;
    }
    const missing = getPublishMissingFields();
    if (missing.length > 0) { goToMissingField(missing); return; }
    rememberFlowScroll();
    setPublishConfirmed(false);
    setPage("publish_consent", { returnToConfirm: false });
    } catch (error) {
      setPublishIssue("掲載前の確認を開始できませんでした。下書きを保存し、再度お試しください。");
      console.error("listing publish preflight failed", error);
    }
  };

  // 掲載の入口は確認を挟まず閉じる。入力中はヘッダーの「保存して終了」で保存する。
  const closeListing = () => {
    if (typeof onSkip === "function") onSkip();
    else window.location.hash = "/profile/employer/drafts";
  };

  const handleSaveJob = async () => {
    if (jobSaving || !publishConfirmed || pageId !== "publish_consent") return;
    setPublishIssue("");
    const classifyDraftSyncFailure = (saved, syncOutcome) => {
      const reason = String(saved?.reason || "").toLowerCase();
      if (saved?.state === "conflict" || reason === "conflict") return "conflict";
      if (["consent_required","consent_required_version"].includes(reason) || syncOutcome?.consentRequired) return "consent";
      if (syncOutcome?.authRequired || ["not_logged_in","jwt_expired","pgrst301"].includes(reason)) return "authentication";
      if (syncOutcome?.retry || globalThis.navigator?.onLine === false || ["pgrst000","57014","timeout","network_error"].includes(reason)) return "communication";
      if (saved?.state === "blocked" || reason) return "database_rejection";
      return "unconfirmed";
    };
    const reportPublishFailure = (phase, reason = "unknown", error = null) => {
      const safePhase = ["profile_read","draft_sync","publish_rpc","unexpected"].includes(phase) ? phase : "unexpected";
      const code = String(error?.code || reason || "unknown").slice(0,80).replace(/[^a-zA-Z0-9_-]/g, "_");
      void logAppError({
        component: "ListingFlow", page: "listing_publish", action: "publish",
        operation: safePhase, error: { message: "求人掲載失敗: " + safePhase + " / " + code, code },
        metadata: { phase: safePhase, reason_code: code },
      });
    };
    const confirmPublication = async (record, finishMeasurement) => {
      const operation = record.publication;
      deviceDraftRef.current = record;
      let pub;
      try { pub = await publishMyJobWithCheck(operation); }
      finally { emitConfirmedRefresh(REFRESH_JOBS); }
      const outcome = pub.error ? { confirmed: false, reason: pub.error.code }
        : settleDevicePublication(ownerId, record.id, operation.requestId, pub.data);
      if (outcome.record) deviceDraftRef.current = outcome.record;
      if (!outcome.confirmed) {
        reportPublishFailure("publish_rpc", outcome.reason || "unconfirmed", pub.error || (pub.data?.code ? { code: pub.data.code } : null));
        setPublishIssue((outcome.record && !outcome.record.publication
          ? jobSaveGuidance({ state: outcome.reason === "conflict" ? "conflict" : "blocked", reason: outcome.reason })
          : "掲載と確認記録の完了を確認できません。掲載済みの場合もあります。入力はこの端末に残っています。通信が戻ってから、同じ端末・ブラウザで同じ掲載ボタンを押して前回の結果を確認してください。確認が済むまで新しい求人として作り直したり、サイトデータを削除したりしないでください。")
          + (outcome.reason === "conflict" ? " 別の保存で変更された項目があるため、内容の確認が必要です。" : ""));
        return;
      }
      const status = outcome.currentStatus;
      setEditingOpen(status === "open");
      if (outcome.newerInput || !["open", "pending"].includes(status)) {
        // 結果未確定・終了済みの記録をページ移動の自動保存で解除しない。
        const notice = outcome.newerInput
          ? "先の掲載と確認記録は保存済みです。その後の追加編集は未反映のため、この端末に残しました。内容を確認して保存してください。"
          : "先の掲載と確認記録は保存済みですが、求人はその後に非公開または掲載終了になっています。再掲載は行っていません。入力はこの端末に残しています。";
        setPublishConfirmed(false); setPublishIssue(notice); setDraftMsg(notice);
        return;
      }
      completedRef.current = true;
      removeDeviceDraft(ownerId, record.id);
      activeDeviceDraft(ownerId, null);
      try { localStorage.removeItem("landingFlowDraft_v1"); } catch {}
      setDraftJobNumber(null);
      setPage("review", { returnToConfirm: false });
      finishMeasurement("success");
      if (typeof onPublished === "function") onPublished(status === "open", record.jobNumber);
      else { setPublishedOpen(status === "open"); setStep(13); }
    };
    if (localOnly || !ownerId) { handleTopSave(); return; }
    if (recruiter.status !== "ready" && !readDeviceDraft(ownerId, deviceDraftRef.current?.id)?.publication) {
      setPublishIssue("募集者情報を確認できません。確認画面に戻り、登録情報を再確認してください。");
      return;
    }
    const missing = getPublishMissingFields();
    if (missing.length > 0 && !readDeviceDraft(ownerId, deviceDraftRef.current?.id)?.publication) {
      setPublishConfirmed(false);
      goToMissingField(missing);
      return;
    }
    setJobSaving(true);
    const finishMeasurement = productAnalytics.begin("publish");
    let sessionUser = null; // catch 節でも参照する（try の中の const は catch から見えない）
    try {
      const { data: { session } } = await getSession();
      if (!session) { saveDraft(); onLogin(); return; }
      sessionUser = session.user;
      if (session.user.id !== ownerId) throw new Error("AUTH_REQUIRED");
      // 応答紛失後は下書き同期・再掲載を始めず、凍結した操作を先に照合する。
      const awaiting = readDeviceDraft(ownerId, deviceDraftRef.current?.id);
      if (awaiting?.publication) { await confirmPublication(awaiting, finishMeasurement); return; }
      // 掲載直前にも本人の最新値を確認する。補完後に自動で掲載しない。
      {
        const { data: info, error: readError } = await fetchEmployerRecruiterInfo(session.user.id);
        if (readError) {
          reportPublishFailure("profile_read", "profile_read_failed", readError);
          setPublishIssue("募集者情報を確認できませんでした。入力は残っています。通信が戻ってから再試行してください。");
          return;
        }
        const field = ["recruiter_name", "recruiter_address", "recruiter_contact"].find(key => !String(info?.[key] || "").trim());
        if (field) {
          await recruiter.reload();
          setPublishConfirmed(false);
          goToMissingField([{ label: RECRUITER_FIELDS[field].title, step: field }]);
          return;
        }
      }
      // プロフィール審査中の掲載ブロックは廃止（2026-08-14 承認プロセスの削除。
      // 自由記述は保存＝即公開になったため「審査待ちの農家」という状態が存在しない）
      const payload = buildJobPayload(session.user.id, "draft", await geocodeTown(farmerPref, farmerCity, farmerTown));
      const local = saveDraft(payload);
      if (!local) return;
      const originalBase = local.base;
      // 応答不明の古い保存があれば先に照合し、その後に今の内容を送る。
      let lastSyncOutcome = null;
      const syncNow = async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const beforeToken = readDeviceDraft(ownerId, local.id)?.pending?.token;
          const syncOutcome = await syncJobDeviceDrafts(ownerId);
          lastSyncOutcome = syncOutcome;
          const latest = readDeviceDraft(ownerId, local.id);
          if (!latest?.pending || latest.state !== "pending" || latest.pending.token === beforeToken) break;
        }
        return readDeviceDraft(ownerId, local.id);
      };
      queueDeviceDraft(ownerId, local.id);
      let saved = await syncNow();
      // 衝突（conflict）＝DBの行が端末の比較元と違う（コピー直後の受け渡しの食い違い・別タブの保存など）。
      // 掲載は利用者の明示の操作なので、比較元をDBの行に取り直して【いま画面にある内容】を1回だけ送り直す。
      // 二度と「別の更新がある」で詰まらせない（2026-09-23・DRAFT_REQUIRES_REVIEW の根治）
      if (saved?.state === "conflict") {
        // 競合は利用者に押し直させず、最新DB行を基準に【いま画面にある内容】を自動で再保存する。
        // 最大2回。毎回DBを取り直すので、古い比較元を同じまま投げ続けるループにはしない。
        for (let retry = 0; retry < 2 && saved?.state === "conflict"; retry++) {
          const currentNumber = saved.jobNumber || readDeviceDraft(ownerId, local.id)?.jobNumber;
          if (!currentNumber) {
            // A previously existing job must never silently become a new listing.
            if (originalBase) break;
            rebaseDeviceDraft(ownerId, local.id, null);
          } else {
            const { data: row, error: rowErr } = await fetchJobByNumber(currentNumber);
            if (rowErr || !row || row.farmer_id !== ownerId) break;
            const check = safeDraftRebase(originalBase, row, payload);
            if (!check.safe) {
              reportPublishFailure("draft_sync", "conflict_" + check.reason);
              setPublishIssue("別の保存で変更された項目があります。上書きを防ぐため掲載を停止しました。下書きを保存して開き直し、内容を確認してください。");
              break;
            }
            rebaseDeviceDraft(ownerId, local.id, row);
          }
          const st = readDeviceDraft(ownerId, local.id)?.base?.status;
          if (st && st !== "draft" && st !== "pending" && st !== "open") {
            setPage("review", { returnToConfirm: false });
            setDraftMsg("この求人はすでに掲載を終えています。入力内容はこの端末に残っています。「保存して終了」で下書きを残し、求人をコピーして新しい求人として掲載してください。");
            return;
          }
          queueDeviceDraft(ownerId, local.id);
          saved = await syncNow();
        }
      }
      if (saved?.state !== "synced" || saved.revision !== local.revision || !saved.jobNumber) {
        const reason = saved?.reason || "sync_unconfirmed";
        const failureCategory = classifyDraftSyncFailure(saved, lastSyncOutcome);
        reportPublishFailure("draft_sync", failureCategory + "_" + reason);
        const failureMessage = jobSaveGuidance(saved, lastSyncOutcome);
        setDraftMsg(failureMessage);
        setPublishIssue(failureMessage);
        return;
      }
      deviceDraftRef.current = saved;
      const _jn = saved.jobNumber;
      setDraftJobNumber(_jn);
      if (editingOpen) {
        completedRef.current = true;
        removeDeviceDraft(ownerId, local.id);
        activeDeviceDraft(ownerId, null);
        setPage("review", { returnToConfirm: false });
        emitConfirmedRefresh(REFRESH_JOBS);
        finishMeasurement("success");
        if (typeof onPublished === "function") onPublished(true, _jn, { edited: true });
        else { setPublishedOpen(true); setStep(13); }
        return;
      }
      await confirmPublication(prepareDevicePublication(ownerId, local.id,
        PUBLISH_CHECKS.map(text => ({ text, checked: true }))), finishMeasurement);
    } catch (e) {
      reportPublishFailure("unexpected", e?.code || "exception", e);
      // 生の英文（内部の符号）を利用者に見せない。入力は端末に残っている＝押し直しで済む
      setDraftMsg("掲載できませんでした。入力はこの端末に残っています。時間をおいて、もう一度「掲載する」を押してください。"
        + (isAdmin(sessionUser) ? `（管理者向け：${e?.message || e}）` : ""));
      setPublishIssue("掲載処理が失敗しました。入力は保持されています。もう一度お試しください。");
    } finally {
      finishMeasurement("failure");
      setJobSaving(false);
    }
  };

  const continueListing = async () => {
    if (isRecruiterPage(pageId)) {
      if (!await recruiter.save(pageId)) return;
      if (returnToConfirm) setPage("review", { returnToConfirm: false });
      else setPage(adjacentListingPage(pageId, 1, { missingRecruiter: recruiter.missing.filter(id => id !== pageId) }));
      return;
    }
    if (pageId === "publish_consent") { await handleSaveJob(); return; }
    if (returnToConfirm) setPage("review", { returnToConfirm: false });
    else goNext();
  };

  const wageLookupNotice = unknownWage && <div role="status" style={{ fontSize:14, lineHeight:1.8, padding:12, background:"#F1F8F4", borderRadius:8 }}>
    <p style={{ margin:0 }}>{minWageLoading ? "最低賃金を確認しています。下書きの入力は続けられます。" : "最低賃金を確認できませんでした。下書きの入力・保存は続けられます。掲載前に再確認してください。"}</p>
    <button type="button" className="listing-back" disabled={minWageLoading} onClick={() => setMinWageRetry(n => n + 1)}>最低賃金を再確認</button>
  </div>;

  // ── OUTER SHELL ─────────────────────────────────────────────
  // 復元が済むまでは空の確認画面を出さない。読み込み失敗時も白紙で上書きさせず、再試行へ。
  if (isFarmer && routeError) return (
    <div className={`job-listing-flow f-sans${embedded ? " listing-embedded" : ""}`}>
      <ListingHeader step="intro" onExit={closeListing} />
      <main className="listing-page"><h2>再開するページを確認できません</h2>
        <p role="alert">入力内容は変更していません。作成中の一覧から開き直してください。</p>
        <button type="button" className="listing-next" onClick={closeListing}>一覧へ戻る</button>
      </main>
    </div>
  );
  if (isFarmer && (editJobLoading || editJobError || localRouteMissing)) return (
    <div className={`job-listing-flow f-sans${embedded ? " listing-embedded" : ""}`} style={embedded ? { position:"relative", background:"#fff" } : { position:"fixed", inset:0, background:"#fff", zIndex:9998 }}>
      <ListingHeader step={0} onExit={closeListing} />
      <main className="listing-page" style={{ padding:"40px 24px" }}>
        {editJobLoading ? <p role="status">保存した求人を読み込んでいます<Dots /></p> : <div role="alert">
          <p style={{ lineHeight:1.8, marginBottom:20 }}>{localRouteMissing ? "このアカウントの端末下書きが見つかりません。作成中の一覧から開き直してください。" : editJobError}</p>
          <button type="button" className="listing-next" onClick={()=>setEditJobRetry(n=>n+1)}>もう一度読み込む</button>
        </div>}
      </main>
    </div>
  );
  if (isFarmer && placePageOpen) return (
    <div className={`job-listing-flow f-sans${embedded ? " listing-embedded" : ""}`} style={embedded ? { position:"relative", background:"#fff" } : { position:"fixed", inset:0, background:"#fff", zIndex:9998 }}>
      <WorkplacePage draftOnly={localOnly} initialAddress={prevAddress || { zip: farmerZip, prefecture: farmerPref, city: farmerCity, town: farmerTown, address: farmerAddr }}
        onBack={closeWorkplacePage} onSaved={(address, info) => {
          applyWorkplaceAddress(address);
          setPrevAddress(address);
          setPlaceStatus("ready");
          setPlaceNotice(info?.local ? "この求人の集合場所に入力しました。作業場の登録は通信復旧後に行えます。" : "作業場を保存し、集合場所に入力しました。");
          closeWorkplacePage();
        }} />
    </div>
  );
  return (
    <div className={isFarmer ? `job-listing-flow f-sans${embedded ? " listing-embedded" : ""}` : undefined} style={embedded ? { position:"relative", background:"#fff" } : { position:"fixed", inset:0, background:"#fff", zIndex:9998 }}>
      <DevBadge label="LandingFlow" />

      {isFarmer && step <= 12 && <ListingHeader step={pageId} autoHidden={pageId === "review" && reviewBarsHidden} saving={draftSaving} busy={draftSaving || jobSaving || photoUploading || recruiter.busy} onSave={() => handleTopSave({ exit: true })} onExit={closeListing} />}

      {/* 働き手フローの進捗バー */}
      {!isFarmer && step > 0 && (
        <div style={{ position: embedded ? "relative" : "absolute", top:0, left:0, right:0, zIndex:1 }}>
          <div style={{ height:4, background:"#EBEBEB" }}>
            <div style={{ height:4, background:"#00A86B", width:((draftBarFull || step >= 12) ? 100 : (step/TOTAL*100))+"%", transition:"width 0.4s ease" }} />
          </div>
        </div>
      )}

      {/* 終了ボタン（押すと保存して終了／保存せずに終了／キャンセルの3択モーダルを開く） */}
      {!isFarmer && !embedded && step !== 12 && step !== 11 && step !== 0 && step !== 6 && (
        <button onClick={() => setShowExitModal(true)} disabled={draftSaving} className="f-sans" style={{
          position:"absolute", top:`calc(${step > 0 ? 24 : 16}px + env(safe-area-inset-top, 0px))`, right:20,
          background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"8px 18px",
          fontSize:13, color:"#222", fontWeight:600, cursor:"pointer", zIndex:2,
          boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>{draftSaving ? <>保存中<Dots /></> : "終了"}</button>
      )}

      {/* 働き手フローの終了確認 */}
      {!isFarmer && showExitModal && (
        // 注記と「キャンセル」は削除（2026-08-19たきと指示）。閉じる手段は背景タップ＝
        // キャンセルボタンを消しても閉じ込めないように、被せ側に onClick を持たせる
        <div onClick={() => setShowExitModal(false)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:28, maxWidth:360, width:"100%", boxShadow:"0 8px 40px rgba(0,0,0,0.15)" }}>
            <h3 className="f-sans" style={{ fontSize:18, fontWeight:700, color:"#222", marginBottom:20, textAlign:"center" }}>作成を終了しますか？</h3>
            <div style={{ display:"grid", gap:10 }}>
              <button onClick={() => { setShowExitModal(false); handleTopSave({ exit: true }); }} disabled={draftSaving} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:12 }}>保存して終了</button>
              {/* 「戻る」＝保存せずに、フローに入る直前の画面へ強制遷移（2026-08-19たきと指示）。
                  行き先は親（App）が控えている入口の画面なので、ここでは hash を書かず onSkip に委ねる。
                  onSkip を持たない呼び出し（devJump等）のためのフォールバックだけ残す */}
              <button onClick={() => {
                try { localStorage.removeItem('landingFlowDraft_v1'); localStorage.removeItem('postLoginReturnTo'); } catch {}
                setShowExitModal(false);
                if (typeof onSkip === "function") onSkip();
                else window.location.hash = "/profile/employer";
              }} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:12, background:"#fff", border:"1px solid #EBEBEB", color:"#222", cursor:"pointer" }}>戻る</button>
            </div>
          </div>
        </div>
      )}

      {/* スクロール領域（全stepスワイプで次へ/戻る・2026-07-16） */}
      <div ref={flowScrollRef} onScroll={isFarmer ? onListingScroll : undefined} className={isFarmer ? `listing-scroll${step === 0 || step === 6 ? " listing-scroll-intro" : ""}` : undefined} onTouchStart={onFlowTouchStart} onTouchEnd={onFlowTouchEnd} style={isFarmer ? { ...flowScrollLock } : embedded ? {} : ((step === 0 || step === 6)
        ? { height:"100%", overflowY:"auto", display:"flex", flexDirection:"column", justifyContent:"center", ...flowScrollLock }
        : { height:"100%", overflowY:"auto", ...flowScrollLock })}>
        <ListingPage key={isFarmer ? pageId : step} step={step} pageId={pageId} isFarmer={isFarmer} embedded={embedded} stepAnim={stepAnim}
          onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && stepAnim.startsWith("step-in")) setStepAnim(""); }}>{/* 下余白は浮遊ピル(約66px)+10px（2026-07-16・旧140px）。上余白はblack-translucent対応でsafe-area加算（2026-07-31） */}

          {isFarmer && (draftMsg || localOnly) && <p role={draftMsg ? "alert" : "status"} style={{ padding:"12px 16px", background:"#eef8f3", lineHeight:1.8 }}>{draftMsg || "同意を送信しています。入力はこの端末に保存されるので、そのまま続けられます。"}</p>}
          {isFarmer && step > 0 && step !== 6 && step <= 12 && <p className="listing-stage-caption">ステップ{listingStage(pageId) + 1} / 3 · {LISTING_STAGES[listingStage(pageId)].title}</p>}
          {isFarmer && step === 0 && <ListingIntro />}

          {/* ── HOME ── */}
          {!isFarmer && step === 0 && (
            <>
              <div className="step0-grid" data-guide="flow-intro">
              <div>
              <div style={{ marginBottom:36 }}>
                <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 8px" }}>ステップ1</p>
                <h1 className="f-sans" style={{ fontSize:38, fontWeight:800, color:"#222", lineHeight:1.25, margin:"0 0 20px" }}>
                  {role === "farmer" ? "まず、基本情報から" : "あなたの希望を入力"}
                </h1>
                <p className="f-sans" style={{ fontSize:16, color:"#222", lineHeight:1.7, margin:0 }}>
                  {role === "farmer"
                    ? "求人に欠かせない情報を入力します。作物、作業内容、場所、日程、採用人数、報酬の6つを、ひとつずつうかがいます。"
                    : "はじめに、希望する作業内容や、働ける時期・条件についてうかがいます。次に、勤務できる地域、曜日、時間帯、希望する報酬など、お仕事探しに必要な情報をご入力ください。"}
                </p>
              </div>
              </div>
              {/* 見本求人カード（🥦ブロッコリー）は削除（2026-07-16）：既に求人が作られていると誤認されたため。憲法3条（表示にダミー禁止）とも整合 */}
              </div>
              <div style={{ position:"absolute", bottom:24, right:20, zIndex:2 }}>
                <button onClick={() => setStep(1)} data-guide="flow-next" className="btn-primary" style={{ padding:"14px 40px", fontSize:15, fontWeight:700 }}>次へ</button>
              </div>
            </>
          )}

          {/* ── FARMER FLOW ── */}
          {isFarmer && step === 1 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>どの作物の仕事ですか？</h2>
            <p className="f-sans" style={lfStyles.subtitle}>科ごとに分けています。作物を1つ選んでください。</p>
            <LFCropGrid
              options={CROP_OPTIONS}
              grouped
              value={farmerCropPill}
              onSelect={v => {
                if (v === "__other__") { setFarmerCropPill("__other__"); }
                else { setFarmerCropPill(v); setFarmerCropText(""); }
              }}
              otherText={farmerCropText}
              onOtherChange={setFarmerCropText}
              otherPlaceholder="作物名を入力（例：ブロッコリー）"
            />
          </>)}

          {isFarmer && pageId === "task" && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>どんな作業をお願いしますか？</h2>
            <p className="f-sans" style={lfStyles.subtitle}>お願いしたい作業を1つ選んでください。</p>
            <LFCropGrid
              options={TASK_OPTIONS}
              noIcon
              value={farmerTaskPill}
              onSelect={v => {
                if (v === "__other__") { setFarmerTaskPill("__other__"); }
                else { setFarmerTaskPill(v); setFarmerTaskText(""); }
              }}
              otherText={farmerTaskText}
              onOtherChange={setFarmerTaskText}
              otherPlaceholder="作業名を入力（例：畝立て、マルチ張り）"
            />

          </>)}

          {isFarmer && pageId === "task_scope" && <StepTaskScope value={taskChangeScope} onChange={setTaskChangeScope} />}
          {isFarmer && pageId === "place_scope" && <StepPlaceScope value={placeChangeScope} onChange={setPlaceChangeScope} />}
          {isFarmer && pageId === "access" && <StepAccess station={nearestStation} setStation={setNearestStation} commute={commuteTime} setCommute={setCommuteTime} />}

          {isFarmer && pageId === "workplace" && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>集合場所を入力してください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>働き手が当日集まる場所の住所を入力してください。</p>
            <SavedWorkplaceCard address={prevAddress} status={placeStatus}
              onUse={() => { applyWorkplaceAddress(prevAddress); setPlaceNotice("登録した作業場を集合場所に入力しました。"); }}
              onRegister={openWorkplacePage} onRetry={() => setPlaceRetry(value => value + 1)} />
            {placeNotice && <p className="listing-workplace-notice" role="status">{placeNotice}</p>}
            <div className="listing-address-divider"><span>または、集合場所を入力</span></div>
            {/* 説明の一本化（2026-08-08たきと指示）：欄ごとに散らばっていた注記（自動入力・町域まで公開・
                番地は会員のみ・プライバシー）をこの1箇所に集約。「初心者大歓迎とは？」と同じ〜とは？形式。
                開示の実態はDBが正（jobs_public：町域・番地はanonマスク・2026-08-03） */}
            <button type="button" onClick={() => setPlaceInfoOpen(v => !v)} className="listing-condition-help">集合場所の公開範囲とは？</button>
            {placeInfoOpen && (
              <div className="f-sans" style={{ fontSize:14, color:"#717171", background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:12, padding:16, margin:"0 0 16px", lineHeight:1.8 }}>
                <p style={{ margin:0 }}>・郵便番号を入れると、都道府県・市区町村は自動で入ります。違っているときは郵便番号を直してください</p>
                <p style={{ margin:0 }}>・町域までの住所は、求人ページで誰でも見られます</p>
                <p style={{ margin:0 }}>・番地・建物名は、ログインした利用者にだけ表示されます（未ログインの訪問者には伏せ字になります）</p>
                <p style={{ margin:0 }}>・本名・電話番号がこのページから公開されることはありません</p>
              </div>
            )}

            <LFWizCard>
              <div>
                <label htmlFor="meeting-zip" className="f-sans" style={lfStyles.inputLabel}>郵便番号</label>
                <div style={{ display:"flex", gap:8, alignItems:"stretch", marginBottom:8 }}>
                  <input
                    ref={zipRef}
                    id="meeting-zip"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    value={farmerZip}
                    onChange={e => {
                      const v = e.target.value;
                      zipLookupVersion.current += 1;
                      setZipSearching(false);
                      setFarmerZip(v);
                      // 7桁打ち終わった時だけ自動検索（復元処理では走らない・上のコメント参照）
                      if (v.replace(/[^0-9]/g, "").length === 7) searchZip(v);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchZip(); } }}
                    placeholder="例：779-3401"
                    className="field f-sans"
                    style={{ fontSize:16, flex:1, minWidth:0, marginBottom:0 }}
                  />
                  {/* onClick={searchZip} と書かないこと：Reactがイベントを第1引数で渡すため、
                      それが郵便番号として解釈されてしまう（searchZipは引数を取るようになった） */}
                  <button onClick={() => searchZip()} disabled={zipSearching} className="f-sans" style={{
                    padding:"0 16px", borderRadius:8, border:"1px solid #DADADA",
                    background:"#fff", color:"#222", fontSize:13, fontWeight:600,
                    cursor: zipSearching ? "default" : "pointer", whiteSpace:"nowrap",
                  }}>{zipSearching ? <>検索中<Dots /></> : "住所を検索"}</button>
                </div>
                {zipError && <p className="f-sans" style={{ fontSize:14, color:"#E53935", marginBottom:12 }}>{zipError}</p>}
                <label htmlFor="meeting-pref" className="f-sans" style={lfStyles.inputLabel}>都道府県</label>
                <input
                  ref={prefRef}
                  id="meeting-pref"
                  value={farmerPref}
                  readOnly
                  placeholder="例：徳島県"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12, background:"#F7F7F7", color:"#717171", cursor:"not-allowed" }}
                />
                <label htmlFor="meeting-city" className="f-sans" style={lfStyles.inputLabel}>市区町村</label>
                <input
                  ref={cityRef}
                  id="meeting-city"
                  value={farmerCity}
                  readOnly
                  placeholder="例：吉野川市"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12, background:"#F7F7F7", color:"#717171", cursor:"not-allowed" }}
                />
                <label htmlFor="meeting-town" className="f-sans" style={lfStyles.inputLabel}>町域</label>
                <input
                  ref={townRef}
                  id="meeting-town"
                  value={farmerTown}
                  onChange={e => { setFarmerTown(e.target.value); setFarmerRegion(farmerPref + farmerCity + e.target.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addrRef.current?.focus(); } }}
                  placeholder="例：山川町〇〇"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12 }}
                />
                <label htmlFor="meeting-addr" className="f-sans" style={lfStyles.inputLabel}>番地・建物名</label>
                <input
                  ref={addrRef}
                  id="meeting-addr"
                  value={farmerAddr}
                  onChange={e => setFarmerAddr(e.target.value)}
                  onKeyDown={(e) => {
                    // 最後の欄の確定＝次の入力先（次のステップ）へ自動遷移。未入力が残っていればキーボードを閉じるだけ
                    if (e.key === "Enter") { e.preventDefault(); if (canGoNext) goNext(); else e.currentTarget.blur(); }
                  }}
                  placeholder="例：1-2-3 〇〇ハイツ101"
                  className="field f-sans"
                  style={{ fontSize:16 }}
                />
                {(!farmerZip.trim() || !farmerPref.trim() || !farmerCity.trim() || !farmerTown.trim() || !farmerAddr.trim()) && <p className="f-sans" style={{ fontSize:14, color:"#F5A623", marginTop:4 }}>すべての住所欄を入力してください</p>}
                {/* 番地が「00」のように住所として読めない時（2026-09-27）。就業場所は法定の明示事項so、
                    空でなければ何でも通る状態をやめた（DBの掲載トリガーも同じ式で止める） */}
                {!!farmerAddr.trim() && !isValidStreetAddress(farmerAddr) && (
                  <p className="f-sans" style={{ fontSize:14, color:"#E24B4A", marginTop:4 }}>
                    番地・建物名を正しく入力してください（例：1-2-3 〇〇ハイツ101）。働き手は、この住所を見て応募するかどうかを決めます
                  </p>
                )}
                {/* 住所の実在チェック（2026-09-27たきと指示「ヒットしない住所はエラーにしよう。赤字で説明させよう」） */}
                {townCheck === "notfound" && (
                  <p className="f-sans" role="alert" style={{ fontSize:14, color:"#E24B4A", marginTop:4 }}>{TOWN_NOT_FOUND_MESSAGE}</p>
                )}
                {townCheck === "checking" && !!farmerTown.trim() && (
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", marginTop:4 }}>住所を確かめています…</p>
                )}
                {townCheck === "error" && (
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", marginTop:4 }}>{TOWN_CHECK_ERROR_MESSAGE}</p>
                )}
                {prefNotAllowed && (
                  <p className="f-sans" style={{ fontSize:14, color:"#E24B4A", marginTop:4 }}>
                    現在、徳島県内の求人のみ受け付けています。他の地域への展開は準備中です
                  </p>
                )}

              </div>
            </LFWizCard>
            {/* LFPrivacyNote は削除（2026-08-08）：内容は上の「集合場所の公開範囲とは？」に統合 */}
          </>)}

                    {/* ── 農家 Step3: 詳細入力 ── */}
          {isFarmer && pageId === "schedule" && farmerPurpose === "post" && <StepSchedule
            start={jobDateStart} end={jobDateEnd} setStart={setJobDateStart} setEnd={setJobDateEnd} holidays={jobHolidays} />}
          {isFarmer && pageId === "holidays" && <StepHolidays start={jobDateStart} end={jobDateEnd}
            holidays={jobHolidays} setHolidays={setJobHolidays} onEditSchedule={() => setPage("schedule")} />}
          {isFarmer && pageId === "headcount" && <StepHeadcount count={jobCount} setCount={setJobCount} />}

          {/* ── 農家 Step3: オファー側詳細 ── */}
          {isFarmer && step === 4 && farmerPurpose === "offer" && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>候補者リスト（想定画面）</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:12 }}>作業内容・経験・勤務条件を見える化し、ミスマッチを減らすUI（構想）</p>
            <LFFakeFilterRow />
            {[
              { name:"A. T.", crop:"トマト・キュウリ", work:"収穫・定植",       exp:"4〜10年",  hourly:1200 },
              { name:"K. N.", crop:"イチゴ",           work:"収穫・選果",       exp:"1〜3年",   hourly:1100 },
              { name:"S. M.", crop:"米・大豆",         work:"草刈り・農薬散布", exp:"10年以上", hourly:1300 },
            ].map((c, i) => (
              <div key={i} style={{ padding:"14px 16px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <div style={{ width:40, height:40, borderRadius:"50%", background:"#E6F7EF", display:"flex", alignItems:"center", justifyContent:"center", color:"#00A86B", flexShrink:0 }}><NavIcon name="profile" size={18} /></div>
                  <div style={{ flex:1 }}>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>{c.name}</p>
                    <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>{c.exp}</p>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <p className="f-mono" style={{ fontSize:14, fontWeight:700, color:"#00A86B" }}>¥{c.hourly.toLocaleString()}/h</p>
                    {AVG_COUNT >= 5 && (
                      <p className="f-sans" style={{ fontSize:10, color: c.hourly>=AVG_HOURLY ? "#00A86B" : "#F5A623" }}>平均{c.hourly>=AVG_HOURLY?"+":""}{(c.hourly-AVG_HOURLY).toLocaleString()}円</p>
                    )}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {[c.crop, c.work].map(t => <span key={t} style={{ padding:"2px 9px", borderRadius:20, background:"#F7F7F7", color:"#717171", fontSize:11 }}>{t}</span>)}
                </div>
              </div>
            ))}
          </>)}

          {/* 第3弾：勤務時間・休憩・時間外・日給はそれぞれ独立した入力ページ。保存stateは親で共有する。 */}
          {isFarmer && pageId === "work_time" && <StepWorkTime
            startHour={startHour} startMinute={startMinute} endHour={endHour} endMinute={endMinute}
            onStart={value => { const [h, m] = value.split(":"); setWorkTimeRaw(undefined); setStartHour(h ? String(Number(h)) : ""); setStartMinute(m ?? ""); }}
            onEnd={value => { const [h, m] = value.split(":"); setWorkTimeRaw(undefined); setEndHour(h ? String(Number(h)) : ""); setEndMinute(m ?? ""); }}
            label={workTimeLabel} raw={workTimeRaw} workHours={workHours} />}
          {isFarmer && pageId === "break_time" && <StepBreakTime value={breakTime} onChange={setBreakTime} />}
          {isFarmer && pageId === "overtime" && <StepOvertime policy={overtimePolicy} setPolicy={setOvertimePolicy} detail={overtimeDetail} setDetail={setOvertimeDetail} />}
          {isFarmer && pageId === "daily_wage" && <StepDailyWage
            input={dailyWageInput} setInput={setDailyWageInput} wage={dailyWage} timeLabel={workTimeLabel}
            workHours={workHours} breakTime={breakTime} breakMinutes={breakMinutes}
            violation={dailyViolation} unknownWage={unknownWage} minWage={minWage} prefecture={farmerPref}
            wageNotice={wageLookupNotice} onEditTime={() => setPage("work_time")} onEditBreak={() => setPage("break_time")}
            average={AVG_DAILY} count={AVG_COUNT} />}

          {/* ── 農家 step6: グループ2 説明ページ（step0と同じ2カラム構造） ── */}
          {isFarmer && step === 6 && <ListingDetailsIntro crop={farmerCrop} task={farmerTask} region={farmerPref + farmerCity} dates={jobDateLabel} wage={dailyWage} />}

          {/* 第4弾: 詳細は1ページ1種類。親stateと既存保存列を共用する。 */}
          {isFarmer && pageId === "photos" && <StepPhotos ownerId={ownerId} jobPhotos={jobPhotos} setJobPhotos={setJobPhotos} photoUploading={photoUploading} setPhotoUploading={setPhotoUploading} currentJobNumber={draftJobNumber} />}
          {isFarmer && pageId === "photo_captions" && <StepPhotoCaptions jobPhotos={jobPhotos} setJobPhotos={setJobPhotos} />}
          {isFarmer && pageId === "description" && <StepDescription jobDescription={jobDescription} setJobDescription={setJobDescription} />}
          {isFarmer && pageId === "work_video" && <StepWorkVideo url={workVideoUrl} setUrl={setWorkVideoUrl}
            jobConsent={workVideoJobConsent} setJobConsent={setWorkVideoJobConsent} relatedConsent={workVideoRelatedConsent} setRelatedConsent={setWorkVideoRelatedConsent}
            setConsentAt={setWorkVideoConsentAt} setConsentVersion={setWorkVideoConsentVersion} mode="url" />}
          {isFarmer && pageId === "video_consent" && <StepWorkVideo url={workVideoUrl} setUrl={setWorkVideoUrl}
            jobConsent={workVideoJobConsent} setJobConsent={setWorkVideoJobConsent} relatedConsent={workVideoRelatedConsent} setRelatedConsent={setWorkVideoRelatedConsent}
            setConsentAt={setWorkVideoConsentAt} setConsentVersion={setWorkVideoConsentVersion} mode="consent" />}
          {isFarmer && (pageId === "danger_places" || pageId === "danger_tasks") && <StepDanger
            mode={pageId === "danger_places" ? "places" : "tasks"} ownerId={ownerId} currentJobNumber={draftJobNumber}
            photoUploading={photoUploading} setPhotoUploading={setPhotoUploading} jobDangerPlaces={jobDangerPlaces} setJobDangerPlaces={setJobDangerPlaces}
            jobDangerTasks={jobDangerTasks} setJobDangerTasks={setJobDangerTasks} showPlace2={showPlace2} setShowPlace2={setShowPlace2}
            showTask2={showTask2} setShowTask2={setShowTask2} />}
          {isFarmer && ["belongings","cautions","worker_preferences","repeat_approval"].includes(pageId) && <StepWishes
            mode={{belongings:"belongings",cautions:"cautions",worker_preferences:"preferences",repeat_approval:"repeat"}[pageId]}
            jobNotes={jobNotes} setJobNotes={setJobNotes} jobCautions={jobCautions} setJobCautions={setJobCautions}
            beginnerOk={beginnerOk} setBeginnerOk={setBeginnerOk} experiencedPreferred={experiencedPreferred} setExperiencedPreferred={setExperiencedPreferred}
            instantApproveRepeat={instantApproveRepeat} setInstantApproveRepeat={setInstantApproveRepeat} flagInfoOpen={flagInfoOpen} setFlagInfoOpen={setFlagInfoOpen} />}

          {/* ── ページX: 移植待ち退避ブロック（step90=農家フロー非到達。グループ2/3項目をここに貯蔵し、移植先ができ次第移す。退避項目の次へ条件・バリデーションは付けない） ── */}
          {isFarmer && step === 90 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>移植待ち項目（退避所）</h2>
            <p className="f-sans" style={lfStyles.subtitle}>開発用の退避所です。農家フローには表示されません。移植先ができ次第、各ページへ移します。</p>
            <LFWizCard>
              {/* 8. 募集文テンプレート（グループ2予定） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>募集文テンプレート</label>
                <LFPillSelect options={["収穫補助","選果作業","定植作業","草刈り"]} value={jobTemplate} onSelect={setJobTemplate} />
              </div>
            </LFWizCard>
          </>)}

          {/* ── 農家 Step3: Airbnb風 掲載プレビュー確認 ── */}
          {/* ── 農家 Step3: Airbnb風 掲載プレビュー確認 ── */}
          {isFarmer && publishIssue && pageId !== "publish_consent" && <p role="alert" className="listing-publication-error">{publishIssue}</p>}
          {isFarmer && isRecruiterPage(pageId) && <ListingRecruiterPage pageId={pageId} state={recruiter} />}
          {isFarmer && pageId === "publish_consent" && <ListingPublishConsent editingOpen={editingOpen}
            confirmed={publishConfirmed} onConfirm={setPublishConfirmed} issue={publishIssue} busy={jobSaving} />}

          {isFarmer && pageId === "review" && (() => {


            // jobs INSERT用ペイロードはトップレベルに移設（saveDraftToSupabaseからも参照するため）
            // 一時保存は下部ナビの「保存」ボタン（トップレベルのhandleTopSaveを再利用）に移設（2026-07-13）

            // ── 掲載前の確認＝最新の求人詳細と同じ1本（2026-09-19たきと指示「最終確認画面が旧求人のままだ。
            //    最新の求人画面に切り替えて。誤解する」）。本文は JobDetailBody（求人詳細ページ・ボックス版・
            //    審査プレビューと同じ Airbnb の並び）。入力中の値を mapJobPublicRow と同じ形（previewJob）に組んで渡す
            //    ＝掲載後に働き手が見る姿をそのまま出す。掲載時にDBトリガーが凍結する値（待遇・保険・契約の更新・
            //    労災雇用保険・支払条件）は同じ材料（プロフィールの現在値・固定ポリシー）から組む＝掲載前後で食い違わない。
            //    ★列を足したら mapJobPublicRow（lib/utils）とここの両方に足すこと。
            //    各区画の「編集」は decorate で差し込む（JobDetailBody の区画ラベルが鍵）＝旧ページの編集リンクの置き換え
            const previewPerks = (confEmployer || jobPerks) ? { ...(confEmployer || {}), ...(jobPerks || {}) } : null;
            const previewJob = {
              id: draftJobNumber || null,
              crop: farmerCrop || "作物", task: farmerTask || "作業",
              dateLabel: jobDateStart ? jobDateLabel : "",
              dateStartRaw: jobDateStart ? ymdLocal(jobDateStart) : "", dateEndRaw: jobDateEnd ? ymdLocal(jobDateEnd) : "",
              isNew: false,
              payType: "daily", pay: dailyWage,
              town: farmerTown || "",
              region: [farmerPref, farmerCity, farmerTown].map(s => (s || "").trim()).filter(Boolean).join(""),
              cityArea: [farmerPref, farmerCity].map(s => (s || "").trim()).filter(Boolean).join(""),
              workAddress: farmerAddr || "", hasWorkAddress: !!(farmerAddr || "").trim(), maskedFields: [],
              experience: jobExp || "",
              lat: confGeo?.lat ?? null, lng: confGeo?.lng ?? null, radius: confGeo?.radius ?? null,
              count: jobCount ? `${jobCount}名` : "", headcount: Number(jobCount) || null,
              photos: jobPhotos,
              workVideoUrl: workVideoUrl.trim() && workVideoJobConsent ? workVideoUrl.trim() : "",
              recruiterName: recruiter.profile?.recruiter_name || "", recruiterAddress: recruiter.profile?.recruiter_address || "", recruiterContact: recruiter.profile?.recruiter_contact || "",
              nearestStation: nearestStation || "", workTime: workHours > 0 ? workTimeLabel : "",
              breakTime: breakTime || "", commuteTime: commuteTime || "",
              jobBody: jobDescription || "", cautions: jobCautions || "",
              overtimePolicy: overtimePolicy || "", overtimeDetail: overtimePolicy === "あり" ? overtimeDetail : "",
              // 変更の範囲＝未選択は掲載時に「変更なし」へ倒れる（DBトリガー）ので、プレビューも同じ姿にする
              placeChangeScope: (placeChangeScope || "").trim() || "変更なし", taskChangeScope: (taskChangeScope || "").trim() || "変更なし",
              contractRenewal: CONTRACT_RENEWAL_FIXED, retirementTerms: "",
              laborInsuranceStatus: (confEmployer?.labor_insurance_status || "").trim(),
              wanted: "", items: jobNotes || "",
              payMethod: CURRENT_PAY_POLICY.payMethod, payTiming: CURRENT_PAY_POLICY.payTiming, wageClosingRule: CURRENT_PAY_POLICY.wageClosingRule,
              dateStart: jobDateStart || null, dateEnd: jobDateEnd || null, holidays: jobHolidays,
              dangerPlaces: (jobDangerPlaces || []).filter(p => p && (p.label || p.desc)),
              dangerTasks: (jobDangerTasks || []).filter(t => t && (t.label || t.desc)),
              fullPayGuarantee: false, beginnerOk, instantApproveRepeat, experiencedPreferred,
              perks: previewPerks,
              insuranceSnapshot: confEmployer ? { items: Array.isArray(confEmployer.insurance_items) ? confEmployer.insurance_items : [], notes: confEmployer.insurance_notes || "" } : null,
              profileSnapshotAt: "",
              employerName: confEmployer?.nickname || "", employerAvatar: confEmployer?.avatar_url || "",
              closed: false, hiredCount: 0, filled: false, expired: false,
            };
            // 本人（ログイン中）は番地・評価を見られる。未ログインの下書き（localOnly）は訪問者と同じ見え方
            const previewMe = ownerId ? { id: ownerId } : null;
            const goStep = (n) => () => { setReturnToConfirm(true); if (typeof n === "string") setPage(n); else setStep(n); };
            // 旧プレビュー区画の編集リンク構築は残し、表示のみ編集タブへ集約する。
            // confDecorate の既存参照を壊さない。
            const editBtn = (label, go) => <button key={label} type="button" onClick={go}>{label}</button>;
            // 確認画面の編集入口は「編集」タブに集約する。
            const editRow = () => null;
            const confDecorate = (label, node) => {
              switch (label) {
                case "写真": return (
                  <div key={label}>
                    {node}
                    {/* 写真の並び替え（2026-07-19）：◀▶で隣と入れ替え＋長押しドラッグ。先頭が求人カードのカバー */}

                    {jobPhotos.length === 0 && <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", textAlign:"center", margin:"8px 0 0" }}>写真は後から登録できます。いまは求人者のアイコンが表紙になります。</p>}
                    {editRow([editBtn("写真を編集", goStep("photos")), ...(jobPhotos.length ? [editBtn("写真の説明", goStep("photo_captions"))] : [])])}
                  </div>
                );
                case "求人タイトル・募集タグ": return (
                  <div key={label}>
                    {node}
                    {editRow([editBtn("作物", goStep(1)), editBtn("作業", goStep("task")), editBtn("作業の変更範囲", goStep("task_scope")), editBtn("集合場所", goStep("workplace")), editBtn("場所の変更範囲", goStep("place_scope")), editBtn("アクセス", goStep("access")), editBtn("日程", goStep("schedule")), ...(isMultiDaySchedule(jobDateStart, jobDateEnd) ? [editBtn("休日", goStep("holidays"))] : []), editBtn("採用人数", goStep("headcount")), editBtn("勤務時間", goStep("work_time")), editBtn("休憩時間", goStep("break_time")), editBtn("時間外労働", goStep("overtime")), editBtn("日給", goStep("daily_wage")), editBtn("経験に関する希望", goStep("worker_preferences")), editBtn("リピーターの自動承認", goStep("repeat_approval"))], "編集：")}
                    {/* 農園プロフィール未入力＝募集主の行が出ない。タップで入力ボックスを展開（2026-07-16の入口を維持） */}
                    {!(confEmployer && confEmployer.nickname) && (
                      <div onClick={()=>{ rememberFlowScroll(); setConfProfileOpen(true); }} role="button" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginTop:16, cursor:"pointer" }}>
                        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center" }}>
                          <div style={{ width:44, height:44, borderRadius:"50%", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", color:"#717171", marginBottom:8 }}><NavIcon name="farmer" size={24} /></div>
                          <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, marginBottom:2 }}>{farmerDisplayName || "農園名未設定"}</p>
                          <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0 }}>募集主の行・待遇・保険は、農園プロフィールから表示されます</p>
                          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#00A86B", margin:"8px 0 0" }}>タップして農園プロフィールを入力 →</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
                case "作業内容": return (
                  <div key={label}>
                    {(jobDescription && jobDescription.trim()) ? node : <ConfEmptySection title="作業内容">未設定</ConfEmptySection>}
                    {editRow([editBtn("作業内容を編集", goStep("description")), editBtn("YouTube動画", goStep("work_video")), ...(workVideoUrl.trim() ? [editBtn("動画の利用同意", goStep("video_consent"))] : [])])}
                  </div>
                );
                case "待遇": return (
                  <div key={label}>
                    {node}
                    {editRow([editBtn(jobPerks ? "待遇を変更（この求人のみ変更中）" : "待遇を変更", openPerksEdit)])}
                  </div>
                );
                case "報酬・勤務条件・日程": return (
                  <div key={label}>
                    {jobDateStart ? node : <ConfEmptySection title="作業日程">未設定</ConfEmptySection>}
                    {editRow([editBtn("日程を編集", goStep("schedule")), ...(isMultiDaySchedule(jobDateStart, jobDateEnd) ? [editBtn("休日を編集", goStep("holidays"))] : [])])}
                  </div>
                );
                case "場所・地図": return (
                  <div key={label}>{node}{editRow([editBtn("集合場所を編集", goStep("workplace")), editBtn("場所の変更範囲を編集", goStep("place_scope")), editBtn("アクセスを編集", goStep("access"))])}</div>
                );
                case "持ち物・備考・危険箇所・保険": return (
                  <div key={label}>
                    {node}
                    {editRow([editBtn("持ち物", goStep("belongings")), editBtn("注意事項", goStep("cautions")), editBtn("時間外労働", goStep("overtime")), editBtn("危険な場所", goStep("danger_places")), editBtn("危険な作業", goStep("danger_tasks"))], "編集：", true)}
                  </div>
                );
                default: return node;
              }
            };

            return (<>
              {/* タイトル */}
              <h2 className="f-sans" style={{ fontSize:"clamp(20px,3vw,30px)", fontWeight:850, color:"#222", marginBottom:6, lineHeight:1.3 }}>
                掲載前に、内容を確認しましょう
              </h2>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>働き手に表示される内容です。直したい項目は、各区画の「編集」から直せます。</p>
              {wageLookupNotice}

              <div style={{ maxWidth:870, margin:"0 auto" }}>
                {/* 本文＝求人詳細ページ・ボックス版・審査プレビューと同じ JobDetailBody。募集主の材料（employer／trust）は
                    本人のプロフィールを渡す＝求人番号の無い下書きでも募集主の行・募集主カード・保険が出る。
                    仕事の内容／質問のタブも同じ（質問は draftJobNumber があるときだけ本物の求人Q&A） */}
                {recruiter.status !== "ready" && <div role="status" className="listing-publication-error">
                  <p>{recruiter.status === "loading" ? "登録情報を確認しています…" : "登録情報を確認できませんでした。確認できるまで掲載しません。"}</p>
                  <button type="button" className="listing-back" disabled={recruiter.status === "loading"} onClick={recruiter.reload}>登録情報を再確認</button>
                </div>}
                {getPublishMissingFields().length > 0 && <section className="listing-publication-error" aria-label="掲載前に確認が必要な項目">
                  <h2>掲載前に確認が必要です</h2>
                  {getPublishMissingFields().map(item => <button key={item.label} type="button" className="listing-review-edit" onClick={() => goToMissingField([item])}>{item.label}を確認</button>)}
                </section>}
                <JobDetailBody hideTopButton reviewEditContent={(
                  <section className="listing-review-edit-index" aria-label="入力項目を編集">
                    <h2>入力項目を編集</h2>
                    <p>変更したい項目を選んでください。編集後は確認画面へ戻ります。</p>
                    <div>{[
                  ["crop","作物"],["task","作業"],["task_scope","作業の変更範囲"],
                  ["workplace","集合場所"],["place_scope","場所の変更範囲"],["access","アクセス"],
                  ["schedule","日程"],...(isMultiDaySchedule(jobDateStart,jobDateEnd)?[["holidays","期間内の休日"]]:[]),
                  ["headcount","採用人数"],["work_time","勤務時間"],["break_time","休憩時間"],
                  ["overtime","時間外労働"],["daily_wage","日給"],
                  ["photos","写真"],...(jobPhotos.length?[["photo_captions","写真の説明"]]:[]),
                  ["description","作業の説明"],["work_video","YouTube動画"],
                  ...(workVideoUrl.trim()?[["video_consent","動画の利用同意"]]:[]),
                  ["danger_places","危険な場所"],["danger_tasks","危険な作業"],
                  ["belongings","持ち物"],["cautions","注意事項"],
                  ["worker_preferences","経験に関する希望"],["repeat_approval","リピーターの自動承認"],
                  ...Object.entries(RECRUITER_FIELDS).map(([id, field])=>[id,field.title]),
                  ["smoking_policy","受動喫煙の状況"]
                ].map(([id,title])=><button type="button" className="listing-review-edit" key={id} data-edit-page={id} onClick={goStep(id)}><span>{title}</span><span aria-hidden="true">編集 ›</span></button>)}</div>
                    <button type="button" className="listing-review-edit" onClick={openPerksEdit}><span>待遇</span><span aria-hidden="true">編集 ›</span></button>
                  </section>
                )} job={previewJob} me={previewMe} employer={confEmployer} trust={confTrust}
                  onOpenIntro={(confEmployer && confEmployer.nickname) ? () => setConfIntroOpen(true) : undefined}
                  decorate={confDecorate} />
                {/* 報酬バー＝求人詳細ページの下の応募バー（報酬＋支払条件）に当たる部分（審査プレビューと同じ置き方）。
                    本文は報酬を持たないのでここに置く。sticky＝スクロールの下端に留まる。右端は本文の「トップ」浮遊ボックス
                    （56px・zIndex5）が重なる場所なので空けておく（zIndexはそれより下） */}
                <div style={{ position:"sticky", bottom:0, zIndex:4, background:"#fff", borderTop:"1px solid #EBEBEB", padding:"10px 68px 10px 0", marginTop:16, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                  <div style={{ minWidth:0 }}>
                    <span className="f-mono" style={{ display:"block", fontSize:18, fontWeight:800, color: dailyWage > 0 ? "#222" : "#B0B0B0" }}>{dailyWage > 0 ? `日給${dailyWage.toLocaleString()}円` : "報酬 未設定"}</span>
                    {/* draftはDB列が入る前なので「現在の固定ポリシー」を共通定数から表示（2026-08-02・ハードコード廃止） */}
                    <span className="f-sans" style={{ display:"block", fontSize:12, color:"#717171", lineHeight:1.5, marginTop:2 }}>{payTermsLine(CURRENT_PAY_POLICY)}</span>
                  </div>
                  
                </div>
              </div>

                  {/* 待遇の編集ボックス（2026-07-18）：送迎から順。下部に「保存」（プロフィールにも反映）と「この求人のみ」 */}
                  {perksEditOpen && perkDraft && (
                    // cb-lock-scroll＝html/bodyを固定する汎用クラス（embedded表示ではページ自体が
                    // スクロールするため必要）。フロー本体のスクロール領域は flowScrollLock で塞ぐ。
                    // 背景に touch-action は付けない＝祖先に付けるとボックス内のスクロールまで止まる
                    <div onClick={()=>setPerksEditOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}><NavIconInline name="gift" size={14} />待遇の変更</p>
                        </div>
                        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 16px 16px" }}>
                          {[
                            { k:"has_transport", iconName:"van", l:"送迎", tk:"transport_area", tp:"送迎の範囲（例：吉野川市内）" },
                            { k:"has_parking", iconName:"parking", l:"駐車場", tk:"parking_capacity", tp:"台数（例：3）" },
                            { k:"has_commute_allowance", iconName:"train", l:"通勤手当", tk:"commute_allowance_detail", tp:"内容（例：1日500円まで）" },
                            { k:"has_bonus", iconName:"gift", l:"賞与", tk:"bonus_detail", tp:"時期・金額など（例：年2回（夏・冬））" },
                            { k:"has_raise", iconName:"raise", l:"昇給", tk:"raise_detail", tp:"時期・金額など（例：年1回（4月））" },
                            { k:"has_severance_pay", iconName:"briefcase", l:"退職手当", tk:"severance_detail", tp:"対象・計算・支払時期など" },
                            { k:"employer_pays_supplies", iconName:"glove", l:"作業用品は募集主の負担", tk:"supplies_cap", tp:"上限（例：軍手・長靴まで）" },
                            { k:"accessory_ok", iconName:"ring", l:"アクセサリーOK" },
                          ].map(row => (
                            <div key={row.k} style={{ borderBottom:"1px solid #F7F7F7", padding:"10px 0" }}>
                              <button type="button" onClick={()=>setPerkDraft(p=>({ ...p, [row.k]: !p[row.k] }))} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:"2px solid", borderColor: perkDraft[row.k] ? "#00A86B" : "#EBEBEB", background: perkDraft[row.k] ? "#E6F7EF" : "#fff", cursor:"pointer", fontSize:14, fontWeight:700, color: perkDraft[row.k] ? "#00A86B" : "#222" }}>
                                {row.iconName && <NavIconInline name={row.iconName} size={14} style={{ verticalAlign:"-2.5px" }} />}{row.l}{perkDraft[row.k] ? <NavIconInline name="tick" size={13} style={{ verticalAlign:"-2px", marginLeft:6, marginRight:0 }} /> : ""}
                              </button>
                              {row.tk && perkDraft[row.k] && (
                                // 台数(parking_capacity)はinteger列ので数字のみ入力させる（「3台」等を弾く・2026-07-19）
                                <input value={perkDraft[row.tk]} inputMode={row.tk === "parking_capacity" ? "numeric" : "text"}
                                  onChange={e=>{ const v = row.tk === "parking_capacity" ? e.target.value.replace(/[^0-9]/g, "") : e.target.value; setPerkDraft(p=>({ ...p, [row.tk]: v })); }}
                                  placeholder={row.tp} className="field f-sans" style={{ fontSize:13, marginTop:8, marginBottom:0 }} />
                              )}
                            </div>
                          ))}
                          {/* 受動喫煙（2026-08-19たきと指示「他の待遇欄と同じ構造に」・元は2026-08-07のピル2択）：
                              上の行と同じボタン。押すたび 喫煙場所あり ⇄ 禁煙（喫煙場所なし）。
                              ★未設定は残す（触るまで値を書かない）＝掲載時のDBトリガー（空を弾く壁）が効き続ける。
                              求人ごとの上書きにはしない（2026-08-03裁定を維持）＝どちらのボタンでもプロフィールへ保存 */}
                          {(() => {
                            const smokeOn = perkDraft.smoking_policy === "喫煙場所あり";
                            return (
                          <div style={{ borderBottom:"1px solid #F7F7F7", padding:"10px 0" }}>
                            <button type="button" onClick={()=>setPerkDraft(p=>({ ...p, smoking_policy: p.smoking_policy === "喫煙場所あり" ? "禁煙（喫煙場所なし）" : "喫煙場所あり" }))} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:"2px solid", borderColor: smokeOn ? "#00A86B" : "#EBEBEB", background: smokeOn ? "#E6F7EF" : "#fff", cursor:"pointer", fontSize:14, fontWeight:700, color: smokeOn ? "#00A86B" : "#222" }}>
                              <NavIconInline name="noSmoke" size={14} style={{ verticalAlign:"-2.5px" }} />喫煙場所あり{smokeOn ? <NavIconInline name="tick" size={13} style={{ verticalAlign:"-2px", marginLeft:6, marginRight:0 }} /> : ""}
                            </button>
                            {smokeOn && (
                              <input value={perkDraft.smoking_area} onChange={e=>setPerkDraft(p=>({ ...p, smoking_area: e.target.value }))} placeholder="喫煙場所（例：屋外の休憩小屋の横）" maxLength={100} className="field f-sans" style={{ fontSize:13, marginTop:8, marginBottom:0 }} />
                            )}
                            {perkDraft.smoking_policy === "禁煙（喫煙場所なし）" && (
                              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"8px 0 0", lineHeight:1.6 }}>求人には「禁煙（喫煙場所なし）」と表示されます。</p>
                            )}
                            {!perkDraft.smoking_policy && (<>
                              <p className="f-sans" style={{ fontSize:12, color:"#C77700", margin:"8px 0 0", lineHeight:1.6 }}>未設定です。受動喫煙の状況は求人の明示事項なので、どちらかを選ぶまで掲載できません。</p>
                              <button type="button" onClick={()=>setPerkDraft(p=>({ ...p, smoking_policy: "禁煙（喫煙場所なし）" }))} className="f-sans"
                                style={{ marginTop:8, padding:"8px 12px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>
                                禁煙（喫煙場所なし）にする
                              </button>
                            </>)}
                            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"8px 0 0", lineHeight:1.6 }}>受動喫煙は事業所（就業場所）の設定のため、「この求人のみ」を押した場合も農家プロフィールに保存されます。</p>
                          </div>
                            );
                          })()}
                          <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginTop:10 }}>
                            「保存」＝農家プロフィールの待遇も更新します。「この求人のみ」＝この求人だけに適用し、プロフィールは変わりません。
                          </p>
                        </div>
                        <div style={{ display:"flex", gap:8, padding:"10px 12px calc(10px + env(safe-area-inset-bottom, 0px))", borderTop:"1px solid #F0F0F0", flexShrink:0 }}>
                          <button onClick={savePerksToProfile} disabled={perkSaving} className="f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:12, cursor:"pointer", opacity: perkSaving ? 0.6 : 1 }}>{perkSaving ? <>保存中<Dots /></> : "保存"}</button>
                          <button onClick={applyPerksToJobOnly} disabled={perkSaving} className="btn-primary f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, borderRadius:12, opacity: perkSaving ? 0.6 : 1 }}>この求人のみ</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 農家プロの入力項目ボックス（確認ページから・2026-07-16）。閉じるとカードに即反映 */}
                  {confProfileOpen && !localOnly && (
                    <div onClick={()=>setConfProfileOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}><NavIconInline name="farmer" size={14} />農園プロフィール</p>
                        </div>
                        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"4px 12px 16px" }}>
                          <EmployerProfileEdit />
                        </div>
                      </div>
                    </div>
                  )}

              {/* 農園紹介セクションはページから削除（2026-07-16）。内容は農家カードのアイコン・名前タップのボックスに集約 */}

              {/* ═══ 農園紹介モーダル（詳細ページと同構造。お題＋代表よりの全文） ═══ */}
              {confIntroOpen && confEmployer && (() => {
                const topics = farmIntroTopics(confEmployer);
                return (
                  <div className="cb-lock-scroll" onClick={() => setConfIntroOpen(false)} style={{
                    position:"fixed", inset:0, zIndex:10000,
                    background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none",
                  }}>
                    <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{
                      position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))",
                      maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, padding:20,
                      overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y",
                    }}>
                      {/* ✕・タイトルは削除（2026-08-14たきと指示・詳細ページの農園紹介と同一様式）＝
                          閉じるはボックス外タップ。名乗りは信頼カード内の氏名行が担う */}
                      {/* まず信頼カード（農園紹介の下のボックス）→次に農園紹介（2026-07-16・詳細ページと同じ） */}
                      {/* 質問形式の群れは代表よりの下へ移植（2026-08-14たきと指示・詳細ページと同一様式）。
                          カード内のQaChatはhideQaで出さない */}
                      {(farmHostQa(confEmployer).length > 0 || !!confEmployer.interaction_style || !!confTrust) && (
                        <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:16 }}>
                          <FarmerTrustCard profile={confEmployer} trust={confTrust} hideQa />
                        </div>
                      )}
                      {confEmployer.owner_comment && confEmployer.owner_comment.trim() && (
                        <div style={{ background:"#F7F7F7", borderRadius:16, padding:"16px", marginBottom:16 }}>
                          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>代表より</p>
                          <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{confEmployer.owner_comment}</p>
                        </div>
                      )}
                      {/* 質問形式の群れ（問いかけQ&A＋紹介文のお題）＝代表よりの下（2026-08-14たきと指示） */}
                      {(() => {
                        const qaAll = [...farmHostQa(confEmployer), ...topics.map(t => ({ q: t.label, a: t.body }))];
                        return qaAll.length > 0 ? <QaChat items={qaAll} accent="#00A86B" /> : null;
                      })()}
                    </div>
                  </div>
                );
              })()}

              {/* ═══ 掲載モーダル（下部ナビ「掲載する」から展開。チェックリスト・同意・掲載・注意文を右パネルから移植） ═══ */}
            </>);
          })()}

          {/* ── 農家 Step3: 完了 ── */}
          {/* ── 農家 Step3: 完了 ── */}
          {isFarmer && step === 13 && (<>
            <div style={{ minHeight:"70vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", maxWidth:400, margin:"0 auto", padding:"0 20px" }}>
              <div style={{ marginBottom:16, display:"flex", justifyContent:"center", color:"#00A86B" }}><NavIcon name={publishedOpen ? "party" : "sprout"} size={56} /></div>
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}>{publishedOpen ? "公開しました！" : "求人ができました！"}</h2>
              <p className="f-sans" style={{ fontSize:16, color:"#717171", lineHeight:1.8, marginBottom:28 }}>
                {publishedOpen ? (<>働き手に公開されました。<br/>「さがす」に並んでいます。</>)
                              : (<>公開の準備が整いしだい、働き手に届きます。<br/>公開されると「さがす」に並び、応募が届きます。</>)}
              </p>
              <div style={{ display:"grid", gap:10, width:"100%" }}>
                {/* 遷移先は農家プロフィール（App.jsxのonComplete＝/profile/employer）ので、ラベルもそれに合わせる。
                    旧「あなたの求人を見る」は実際の行き先と食い違っていた（2026-07-26たきと指示） */}
                <button onClick={onComplete} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12 }}>プロフィールに戻る</button>
                <button onClick={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} if(typeof onComplete==="function") onComplete(); setTimeout(()=>{ window.location.hash="/work/new"; }, 50); }} style={{ width:"100%", padding:"13px", fontSize:13, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#222", cursor:"pointer", fontFamily:"inherit" }}>新しい求人を出す</button>
              </div>
            </div>
          </>)}

          {/* ── WORKER FLOW ── */}
{/* ── WORKER FLOW ── */}
          {isWorker && step === 1 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>農業経験を教えてください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>経験は問いません。当てはまるものをお選びください</p>
            {["未経験","経験あり"].map(v => (
              <LFCardBtn key={v} selected={workerExp===v} onClick={() => selectAndNext(setWorkerExp, v)}>
                <div className="f-sans" style={lfStyles.cardTitle}>{v}</div>
              </LFCardBtn>
            ))}
          </>)}

          {isWorker && step === 2 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>何をしたいですか？</h2>
            <p className="f-sans" style={lfStyles.subtitle}>あとから変更できます</p>
            <LFCardBtn selected={workerPurpose==="open"} onClick={() => selectAndNext(setWorkerPurpose, "open")}>
              <div className="f-sans" style={lfStyles.cardTitle}><NavIconInline name="calendar" size={15} />働ける日を公開する</div>
              <div className="f-sans" style={lfStyles.cardDesc}>農家からオファーを受けたい</div>
            </LFCardBtn>
            <LFCardBtn selected={workerPurpose==="search"} onClick={() => selectAndNext(setWorkerPurpose, "search")}>
              <div className="f-sans" style={lfStyles.cardTitle}><NavIconInline name="search" size={15} />募集中の仕事を探す</div>
              <div className="f-sans" style={lfStyles.cardDesc}>自分から応募したい</div>
            </LFCardBtn>
          </>)}

          {isWorker && step === 3 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>働き手プロフィール</h2>
            <p className="f-sans" style={lfStyles.subtitle}>農家に見せる情報を入力してください</p>
            <LFWizCard>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>表示名</label>
                <input value={workerDisplayName} onChange={e => setWorkerDisplayName(e.target.value)} placeholder="例：田中 T." className="field f-sans" style={{ fontSize:16 }} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>活動地域</label>
                <input value={workerRegion} onChange={e => setWorkerRegion(e.target.value)} placeholder="例：吉野川市" className="field f-sans" style={{ fontSize:16 }} />
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:4, lineHeight:1.5 }}>※ 市町村まで。番地・字は公開されません</p>
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>移動手段</label>
                <LFPillSelect options={["車","バイク","自転車","公共交通"]} value={workerTransport} onSelect={setWorkerTransport} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>働ける曜日</label>
                <LFMultiPill options={["月","火","水","木","金","土","日"]} values={workerDays}
                  onToggle={d => setWorkerDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev,d])} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>働ける時間帯</label>
                <LFPillSelect options={["早朝（〜8時）","午前","午後","夕方以降","終日"]} value={workerTimeSlot} onSelect={setWorkerTimeSlot} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>やりたい作業</label>
                <LFPillSelect options={["収穫","定植","選果","草刈り","農薬散布","梱包","なんでも"]} value={workerWork} onSelect={setWorkerWork} />
              </div>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>経験のある作物</label>
                <LFPillSelect options={["トマト","キュウリ","イチゴ","米","なんでも"]} value={workerCrop} onSelect={setWorkerCrop} />
              </div>
            </LFWizCard>
          </>)}

          {isWorker && step === 4 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>希望報酬を入力します</h2>
            <p className="f-sans" style={lfStyles.subtitle}>平均・中央値と比較できます（参考値）</p>
            <LFWizCard>
              <div style={{ marginBottom:16 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>希望時給 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（円）</span></label>
                <input type="number" value={workerHourly} onChange={e => setWorkerHourly(e.target.value)} placeholder="例：1200" className="field f-mono" style={{ fontSize:20, maxWidth:180 }} />
                <LFWageCompare type="時給" value={parseFloat(workerHourly)||0} avg={AVG_HOURLY} count={AVG_COUNT} />
              </div>
              <div style={{ marginBottom:16 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>希望日給 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（円）</span></label>
                <input type="number" value={workerDaily} onChange={e => setWorkerDaily(e.target.value)} placeholder="例：9000" className="field f-mono" style={{ fontSize:20, maxWidth:180 }} />
                <LFWageCompare type="日給" value={parseFloat(workerDaily)||0} avg={AVG_DAILY} count={AVG_COUNT} />
              </div>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>日給の場合の想定勤務時間 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（時間）</span></label>
                <input type="number" value={workerHours} onChange={e => setWorkerHours(e.target.value)} placeholder="例：8" className="field f-mono" style={{ fontSize:16, maxWidth:120 }} />
                {workerDaily && workerHours && parseFloat(workerHours) > 0 && (
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", marginTop:4 }}>
                    時給換算：<span className="f-mono" style={{ fontWeight:700 }}>¥{Math.round(parseFloat(workerDaily)/parseFloat(workerHours)).toLocaleString()}/h</span>
                  </p>
                )}
              </div>
              <LFWageNote />
            </LFWizCard>
          </>)}

          {isWorker && step === 5 && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>プロフィール確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>農家に表示される情報です</p>
            <LFWizCard>
              <LFSummaryRow label="表示名"   value={workerDisplayName || "未入力"} />
              <LFSummaryRow label="経験"     value={workerExp} />
              <LFSummaryRow label="地域"     value={workerRegion || "未入力"} />
              <LFSummaryRow label="移動手段" value={workerTransport || "未設定"} />
              <LFSummaryRow label="曜日"     value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="時間帯"   value={workerTimeSlot || "未設定"} />
              <LFSummaryRow label="作業"     value={workerWork || "未設定"} />
              <LFSummaryRow label="目的"     value={workerPurpose==="open" ? "働ける日を公開" : "募集を探す"} />
            </LFWizCard>
          </>)}

          {isWorker && step === 6 && workerPurpose === "open" && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>希望条件の確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>これはプレビューです。実際の公開はまだ行いません</p>
            <LFWizCard>
              <LFSummaryRow label="地域"     value={workerRegion || "未入力"} />
              <LFSummaryRow label="曜日"     value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="時間帯"   value={workerTimeSlot || "未設定"} />
              <LFSummaryRow label="移動手段" value={workerTransport || "未設定"} />
              <LFSummaryRow label="希望時給" value={workerHourly ? `¥${parseFloat(workerHourly).toLocaleString()}/h` : "未設定"} />
              <LFSummaryRow label="希望日給" value={workerDaily ? `¥${parseFloat(workerDaily).toLocaleString()}/日` : "未設定"} />
            </LFWizCard>
          </>)}

          {isWorker && step === 6 && workerPurpose === "search" && (
            <JobSearchMapView />
          )}

          {isWorker && step === 7 && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>内容の確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>構想段階のため、実際の公開は行いません</p>
            <LFWizCard>
              <LFSummaryRow label="ロール"    value="働き手" />
              <LFSummaryRow label="表示名"    value={workerDisplayName || "未設定"} />
              <LFSummaryRow label="経験"      value={workerExp} />
              <LFSummaryRow label="地域"      value={workerRegion || "未設定"} />
              <LFSummaryRow label="移動手段"  value={workerTransport || "未設定"} />
              <LFSummaryRow label="曜日"      value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="目的"      value={workerPurpose==="open" ? "働ける日を公開" : "募集を探す"} />
              <LFSummaryRow label="希望時給"  value={workerHourly ? `¥${parseFloat(workerHourly).toLocaleString()}/h` : "未設定"} />
            </LFWizCard>
          </>)}

          {/* ③（2026-08-07）：onWorkerDone があれば親がアニメーションに置換するのでこのページは出さない */}
          {isWorker && step === 8 && typeof onWorkerDone !== "function" && (<>
            <div style={{ textAlign:"center", paddingTop:20 }}>
              <div style={{ display:"flex", justifyContent:"center", marginBottom:16, color:"#00A86B" }}><NavIcon name="check" size={56} /></div>
              <h2 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", marginBottom:10 }}>ありがとうございます</h2>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, marginBottom:24 }}>
                この機能は現在構想段階です。<br/>
                実装前に労働局・関係機関へ確認した上で、段階的に追加予定です。
              </p>
              <div style={{ display:"grid", gap:10 }}>
                <button onClick={onLogin} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12 }}>実証に参加する →</button>
                <button onClick={onSkip} style={{ width:"100%", padding:"13px", fontSize:13, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#222", cursor:"pointer", fontFamily:"inherit" }}>公開データを見る</button>
                <button onClick={onComplete} className="f-sans" style={{ width:"100%", padding:"10px", background:"none", border:"none", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>意見を送る（準備中）</button>
              </div>
            </div>
          </>)}

        </ListingPage>
      </div>

      {/* 保存中オーバーレイ（下部ナビ「保存」・保存して終了 共通。どのstepでも表示。旧:確認ページ右パネル内） */}
      {draftOverlay && (
        <div style={{ position:"fixed", inset:0, background:"rgba(255,255,255,0.92)", zIndex:9999, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
          <div style={{ width:44, height:44, border:"4px solid #E0E0E0", borderTopColor:"#00A86B", borderRadius:"50%", animation:"cbspin 0.8s linear infinite" }} />
          <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700 }}>保存しています<Dots /></p>
          <style>{`@keyframes cbspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* その場保存の完了表示（2026-08-03）：下部ナビ「保存」は遷移しないので、
          保存できたことをこの一言で知らせる。1.8秒で自然に消える */}
      {savedToast && (
        <div className="f-sans" style={{ position:"fixed", left:"50%", transform:"translateX(-50%)", bottom:"calc(84px + env(safe-area-inset-bottom, 0px))", zIndex:9998, background:"rgba(34,34,34,0.92)", color:"#fff", fontSize:13, fontWeight:700, padding:"10px 18px", borderRadius:20, boxShadow:"0 4px 16px rgba(0,0,0,0.2)", pointerEvents:"none" }}>
          保存しました
        </div>
      )}

      {isFarmer && pageId === "review" && reviewScrolled && !sheetOpen && (
        <button type="button" className={`listing-review-top-button${reviewBarsHidden ? " listing-review-top-button-expanded" : ""}`}
          aria-label="ページの先頭へ戻る" onClick={() => flowScrollRef.current?.scrollTo({ top:0, behavior:"smooth" })}>
          <span aria-hidden="true">↑</span><span>トップ</span>
        </button>
      )}

      {/* 開催期間カレンダー📅の浮遊ボタン＋モーダルは削除（2026-07-24・誰も展開しないため）。
          作業日程は確認ページ「作業日程」区画の「日程を編集」（→step4）で選び直せる */}

      {/* 下部ナビのバーは削除（2026-07-16）：戻る／次へは浮遊固定ボックス（スクロール追従）に。
          embedded（プレビューシート内）はfixedが使えないため従来のバーを残す */}
      {isFarmer && step <= 12 && <ListingFooter
        step={pageId} autoHidden={pageId === "review" && reviewBarsHidden} canNext={canGoNext} busy={draftSaving || jobSaving || photoUploading || recruiter.busy} uploading={photoUploading}
        returnToConfirm={returnToConfirm} editingOpen={editingOpen}
        publishDisabled={!localOnly && !deviceDraftRef.current?.publication && (unknownWage || recruiter.status === "loading")}
        hidden={sheetOpen || photoCaptionsOpen}
        onBack={step === 0 ? closeListing : pageId === "publish_consent" ? () => setPage("review", { returnToConfirm: false }) : returnToConfirm ? () => { setStep(12); setReturnToConfirm(false); } : goBack}
        onNext={continueListing}
        nextLabel={pageId === "publish_consent" ? (editingOpen ? "変更を保存する" : "同意して掲載する") : isRecruiterPage(pageId) ? (returnToConfirm ? "保存して確認に戻る" : "保存して次へ") : undefined}
        onSkipDetails={pageId === "details_intro" ? () => animateStepChange(() => setStep(12), "fwd") : goNext} onPublish={openPublish}
      />}
      {!isFarmer && step > 0 && step < TOTAL && step !== 13 && (
        embedded ? (
        <div style={{
          background:"#fff", borderTop:"1px solid #EBEBEB", padding:"16px 8px",
          display:"flex", alignItems:"center", justifyContent: isAutoStep ? "flex-start" : "space-between",
          ...sheetNavHide,
        }}>
          {/* step1は戻る先が説明ページしかないため戻るボタンなし（2026-07-16）。spanはspace-betweenの左詰め維持用 */}
          {step === 1
            ? <span aria-hidden="true" />
            : <button onClick={returnToConfirm ? () => { setStep(12); setReturnToConfirm(false); } : goBack} className="f-sans" style={{ background:"none", border:"none", fontSize:15, color:"#222", cursor:"pointer", padding:"8px 0" }}>← 戻る</button>}
          {!isAutoStep && step !== 12 && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <button onClick={canGoNext ? (returnToConfirm ? () => { setStep(12); setReturnToConfirm(false); } : goNext) : undefined} className="btn-primary" style={{
                padding:"14px 28px", fontSize:15, fontWeight:700,
                cursor: canGoNext ? "pointer" : "not-allowed", opacity: canGoNext ? 1 : 0.5,
              }}>{returnToConfirm ? "確認に戻る →" : "次へ →"}</button>
              {!returnToConfirm && step >= 7 && step <= 11 && (
                <button onClick={() => setStep(12)} className="f-sans" style={{ background:"none", border:"none", fontSize:12, color:"#717171", textDecoration:"underline", cursor:"pointer", padding:0 }}>残りをスキップして確認へ →</button>
              )}
            </div>
          )}
          {isFarmer && step === 12 && (
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button onClick={() => handleTopSave({ exit: true })} disabled={draftSaving} className="f-sans" style={{ padding:"14px 20px", fontSize:15, fontWeight:700, background:"#fff", border:"1px solid #DDD", borderRadius:12, color:"#222", cursor:"pointer" }}>{draftSaving ? <>保存中<Dots /></> : "保存"}</button>
              {publishIssue && <p role="alert" style={{color:"#B42318",fontSize:13,maxWidth:280,margin:0}}>{publishIssue}</p>}
              <button onClick={openPublish} className="btn-primary" style={{ padding:"14px 28px", fontSize:15, fontWeight:700 }}>{editingOpen ? "変更を保存" : "掲載する"}</button>
            </div>
          )}
        </div>
        ) : (<>
          {/* ← 戻る：左下の浮遊ボックス（step1は非表示） */}
          {step !== 1 && (
            <button onClick={returnToConfirm ? () => { setStep(12); setReturnToConfirm(false); } : goBack} className="f-sans" style={{
              position:"fixed", left:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60,
              display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
              fontSize:14, fontWeight:600, color:"#222", cursor:"pointer", padding:"12px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
              ...sheetNavHide,
            }}>← 戻る</button>
          )}
          {/* 次へ（＋スキップ）：右下の浮遊ボックス */}
          {!isAutoStep && step !== 12 && (
            <div style={{ position:"fixed", right:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
              {!returnToConfirm && step >= 7 && step <= 11 && (
                <button onClick={() => setStep(12)} className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, color:"#717171", textDecoration:"underline", cursor:"pointer", padding:"7px 12px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>残りをスキップして確認へ →</button>
              )}
              <button onClick={canGoNext ? (returnToConfirm ? () => { setStep(12); setReturnToConfirm(false); } : goNext) : undefined} className="btn-primary" style={{
                padding:"14px 28px", fontSize:15, fontWeight:700, borderRadius:20, boxShadow:"0 2px 8px rgba(0,0,0,0.18)",
                cursor: canGoNext ? "pointer" : "not-allowed", opacity: canGoNext ? 1 : 0.5,
              }}>{returnToConfirm ? "確認に戻る →" : "次へ →"}</button>
            </div>
          )}
          {/* 確認ページ(step11)：右下に「保存」＋「掲載する」の浮遊ペア */}
          {isFarmer && step === 12 && (
            <div style={{ position:"fixed", right:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60, display:"flex", alignItems:"center", gap:10, ...sheetNavHide }}>
              <button onClick={() => handleTopSave({ exit: true })} disabled={draftSaving} className="f-sans" style={{ padding:"14px 20px", fontSize:15, fontWeight:700, background:"#fff", border:"1px solid #DDD", borderRadius:20, color:"#222", cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>{draftSaving ? <>保存中<Dots /></> : "保存"}</button>
              <button onClick={openPublish} className="btn-primary" style={{ padding:"14px 28px", fontSize:15, fontWeight:700, borderRadius:20, boxShadow:"0 2px 8px rgba(0,0,0,0.18)" }}>{editingOpen ? "変更を保存" : "掲載する"}</button>
            </div>
          )}
        </>)
      )}
    </div>
  );
}
