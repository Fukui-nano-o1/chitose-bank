// 分割3-C（2026-07-25）：App.jsxから移動。農家モードのお仕事タブ（求人一覧・応募者管理・お気に入り・完了報告）。
import { useState, useEffect, useRef } from "react";
import { getSession, fetchMyEmployerProfileFull, fetchEmployerTrustInfo, fetchMyRoster, fetchMyEmergencyContact,
  fetchWorkerCards, fetchMyFarmJobs, fetchMyFarmApplicants, fetchPublicJobByNumber, fetchMyJobLabel,
  unpublishJob, copyJob, deleteMyJob, approveApplication, rejectApplication, setAgreedDates, setApplicationFollowup,
  markWorkNoShow, submitFarmerFinalReviewRpc, fetchWorkerProfileForFarmer, fetchWorkerTrustInfo,
  upsertRoster, deleteRoster,
  upsertInsurance } from "../features/farmer/dashboard/farmerDashboardApi";
import { openWorkerPreview, openEmployerPreview } from "../lib/previewBus";
import { isAdmin, ymdLocal, calFmtDate, daysBetweenYmd, payLabel, CHAT_ELIGIBLE_STATUSES, ROLE_GREEN, appPhaseKey, appPhaseLabelNow, appPhaseColorNow, APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, perkBadges, isJobEnded, isJobUnpublished, isJobDraft, INSURANCE_ITEMS, insuranceToggle, photoThumb, workerQaItems, mapJobPublicRow, employerUnsetCount, isFinalWorkDone, appWorkDates } from "../lib/utils";
import { useSheetDragClose } from "../lib/sheetDrag";
import { Avatar, StatusRibbon, NoticeJumpText, AutoSkeleton, useSkeletonProbe, useSkeletonProbeOn, Dots, VineCorner, QaChat, JobRow } from "./ui";
import { ToggleSwitch } from "./ToggleSwitch";
import { AgreedDatesRow, AvailDatesChips } from "./DateChips";
import { DragSheet } from "./DragSheet";
import { JobCard, JOB_CARD_RELATED_SIZE } from "./JobCard";
import { JobDetailBody } from "./JobDetailBody";
import { AdminJobPreview } from "./AdminJobPreview";
import { MyCalendar } from "./MyCalendar";
import { SavedJobsView } from "./SavedJobsView";
import { WorkDaysStrip } from "./WorkDaysStrip";
import { EmployerProfileEdit } from "./EmployerProfileEdit";
import { WorkerTrustCard, FarmerTrustCard } from "./TrustCards";
import { MyReviewsOfWorker } from "./MyReviewsOfWorker";
import ContractPartyName from "./ContractPartyName";
import ContractEmergencyContact from "./ContractEmergencyContact";
import LaborConditionsNotice from "./LaborConditionsNotice";
import { getCache, setCache } from "../lib/viewCache";
import { useRefreshTick, REFRESH_APPLICATIONS, REFRESH_JOBS } from "../lib/refreshBus";
import { snapGet, snapSet } from "../lib/snapshot";
import { fbSuccess, fbError } from "../lib/feedback";
import { Celebration } from "./Celebration";
import { DayReportSheet } from "./DayReportSheet";
import { FinalReviewSheet } from "./FinalReviewSheet";
import { NavIcon, NavIconInline } from "./NavIcons";
import { TodayTaskBoxes } from "../features/today/components/TaskBoxes";

// 応募者ページの非表示の選択（2026-08-18たきと指示「応募者ページも同じようにしろ」＝チャット一覧と同じ形）。
// ★ピルは「見るもの」ではなく【隠すもの】の選択＝見送り／失効／取り消しの3つだけ。複数選択可。
//   既定は3つとも選んだ状態＝終わった応募that日常の一覧を埋めない。全部見たい時は選択を外す。
// 隠すのは表示だけ＝記録・並び・データ取得は不変（行動記録の憲法：記録は消さない）。
// 段階の物差しは appPhaseKey（帯・凡例・チャット一覧と共通）。モジュールレベル定義＝毎描画で作り直さない
const APP_HIDABLE = ["rejected", "expired", "canceled"];


// 最終日の評価（農家→働き手）の設問（2026-08-20たきと裁定で3問×3択＋タグに再設計）。
// ①仕事は完了したか ②またこの人と働きたいか ③特記事項（タグ選択・任意）。
// 客観データ（遅刻・欠勤の回数）は日次の記録から自動表示＝本人に再入力させない（FinalReviewSheet）。
// ★真実は3択の新列（work_outcome/want_again_choice/traits）。既存 boolean（completed_work/want_again）は
//   互換の影＝DB側 submit_farmer_final_review が導出する。選択肢を変える時はDBのCHECK制約と対で直すこと。
// ★肯定だけが働き手に表示される（規約第8条2）。否定の答え・否定タグは公開されないが記録には残る。
const FARMER_FINAL_QUESTIONS = [
  { k:"work_outcome", label:"仕事は完了しましたか", choices:[
    { v:"completed",     l:"予定どおり完了" },
    { v:"partial",       l:"一部完了" },
    { v:"not_completed", l:"完了できなかった" },
  ]},
  { k:"want_again_choice", label:"またこの人と働きたいですか", choices:[
    { v:"yes",     l:"はい" },
    { v:"neutral", l:"どちらともいえない" },
    { v:"no",      l:"いいえ" },
  ]},
];
// 特記事項のタグ。肯定4つ＝公開集計（reviews_public_badges の trait_*）／否定2つ＝記録のみ・非公開。
// ★タグを足す時は DBの badges 関数と ReceivedReviews.BADGE_DEFS（肯定のみ）を対で直すこと
const FARMER_TRAIT_TAGS = {
  label: "特記事項（あれば・複数可）",
  hint: "良かった点は働き手のページに集計で表示されます。問題は記録として残ります（公開されません）",
  options: [
    { v:"careful",    l:"丁寧だった" },
    { v:"fast",       l:"作業が早かった" },
    { v:"attentive",  l:"指示をよく確認した" },
    { v:"safe",       l:"安全に作業した" },
    { v:"work_issue", l:"作業に問題があった", negative:true },
    { v:"comm_issue", l:"コミュニケーションに問題があった", negative:true },
  ],
};

export function FarmerDashboard({ onNewJob, onResume, me, applicantsBadge }) {
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
  const [favDone, setFavDone] = useState(null); // {workerId, nickname, avatar_url}
  const [favDetailOpen, setFavDetailOpen] = useState(false);
  const [todoAppIds, setTodoAppIds] = useState(() => new Set()); // 未対応（＝農家の番）の応募ID。my_todo_items由来・アイコンのジャンプに使う
  const [reviewedAppIds, setReviewedAppIds] = useState(() => new Set()); // 自分が評価を書いた応募ID。お仕事の流れバーの「評価」段の点灯に使う

  // 作成中⇄公開中ページャー（2026-07-16）：2枚のパネルを横並びにし、指に追従して実際に横移動させる。
  // 横ロック判定後はtrackのtransformを直接書く（state経由だと1フレーム遅れてカクつくため）。
  // 端（作成中で右・公開中で左）は1/3の抵抗。離した時に幅の1/4（最大80px）を超えていたらタブ確定
  const pagerTrackRef = useRef(null);
  const pagerDrag = useRef(null); // {x, y, dx, lock:"h"|"v"|null, w}
  const pagerBasePct = () => (jobTab === "draft" ? 0 : -50);
  const onPagerStart = (e) => {
    // グループの横スライド（.carousel-scroll）の中で始まったタッチは掴まない（2026-08-23）＝
    // カードを送る指theタブ切替に取られない。はみ出していない（1枚だけの）グループは従来どおり
    // ページャーに譲る＝送る余地thatが無い所でタブ切替thatが死なない
    const hs = e.target.closest && e.target.closest(".carousel-scroll");
    if (hs && hs.scrollWidth > hs.clientWidth + 1) { pagerDrag.current = null; return; }
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
  useSkeletonProbeOn(appGridRef, ((jobTab === "applicants" || jobTab === "calendar") && !appsLoading) ? "farmList:applicants" : null);
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
  // req（核の未設定数）はカード枠の強調に使っていたが、強調は削除（2026-08-21）＝totalだけ使う
  const { total: empUnsetCount } = employerUnsetCount(empMini, { hasEmergency });
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
      // 「保存して終了」の直後は作成中の面へ寄せる。ただしURLthat別の面を名指ししている時は従わない
      // （2026-08-21：フローの出口that入口の画面へ戻るようになったため、カレンダーから入って保存すると
      //   URLはカレンダーなのに作成中thatが開く、という食い違いthat起きる。URLを正とする）
      try {
        if (sessionStorage.getItem("cb_afterDraftSave")==="1") {
          const j = hashToJobTab();
          if (!j || j === "home") setJobTab("draft");
        }
        sessionStorage.removeItem("cb_afterDraftSave");
      } catch {}
    })();
  }, []);

  // 再取得の合図（2026-08-18 Speed-1B）。求人面＝求人の変化と復帰／応募者面＝応募の変化と復帰。
  // 面ごとに分けてある＝合図が来ても、いま開いていない面は取りに行かない
  const jobsRefreshTick = useRefreshTick(REFRESH_JOBS);
  const appsRefreshTick = useRefreshTick(REFRESH_APPLICATIONS);

  // 【求人】作成中・公開中・期限切れ・応募者（求人名の表示に要る）を開いた時に一度だけ
  const jobsLoadedRef = useRef(false);
  useEffect(() => {
    if (!["draft","active","expired","applicants","calendar"].includes(jobTab)) return;
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
          const jim = Object.fromEntries(allJobs.map(j => [j.job_number, { crop: j.crop, task: j.task, date_start: j.date_start, date_end: j.date_end, photos: j.photos, holidays: j.holidays, work_time: j.work_time }]));
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
    // 応募者＝全件の一覧（2026-08-23たきと指示「応募者一覧としてマイページに移植」）。
    // カレンダー＝カレンダー＋日タップでその日の求人と応募者（旧・応募者ページの姿＝下部ナビのカレンダータブ）
    { k:"applicants", l:"応募者一覧" },
    { k:"expired", l:"期限切れ" },
    { k:"calendar", l:"カレンダー" },
  ];
  // ダミー撤去（憲法3条:表示にダミー禁止）。Phase2aでjobsテーブルから自分の求人を読む
  const jobList = [];


  // その日の記録（2026-08-19たきと指示）：最終の作業日より前の作業日は、完了・評価でなく
  // 「遅刻・欠勤・会えない」の記録をつける。入力と保存は共有部品 DayReportSheet
  // （今日ページの📋今日の記録・緊急連絡のシートと同じもの＝入力を枝分かれさせない）。
  // ★ここで記録しても作業全体の出欠（applications.attended）は変わらない＝最終日の評価で決まる
  const [dayReportApp, setDayReportApp] = useState(null);
  // 労働条件通知書を1件だけ開く（求人カードのボタン・2026-08-23たきと指示）。表示・印刷は
  // 共有部品 LaborConditionsNotice が担う＝通知書の姿をこの画面で作らない
  const [noticeAppId, setNoticeAppId] = useState(null);
  // 完了・評価モーダル（Part1）
  const [completeModalApp, setCompleteModalApp] = useState(null);
  // 最終日の評価の答え（2026-08-20に3問×3択＋タグへ再設計）。列名をそのまま鍵にする
  const [completeAnswers, setCompleteAnswers] = useState({});
  const [completeTags, setCompleteTags] = useState([]);   // 特記事項タグ（FARMER_TRAIT_TAGS）
  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [completeNotifyNext, setCompleteNotifyNext] = useState(true); // また呼びたい=はい時のみ表示。ON=repeat_rosterへupsert
  const [completeDone, setCompleteDone] = useState(null); // 評価登録完了モーダル {jobLabel,jobNumber,workerId,workerName,at,answers,tags,favorited}
  const openCompleteModal = (a) => {
    // 完了ボタン＝そのまま評価（2026-08-16たきと指示）。以前は「働き手は来ましたか？」の1枚を
    // 挟んでいたが、通常の道（来た→評価）が2タップになるため廃止＝最初から評価を出す。
    // 送信＝完了の記録＋評価（submit_farmer_review・1トランザクション）。
    // 来なかった場合（欠勤の記録・72時間の異議申立）は評価画面の下に控えめに残す＝例外の道は消さない
    setCompleteModalApp(a);
    setCompleteAnswers({}); setCompleteTags([]);
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
    if (!completeModalApp || completeSubmitting) return;
    if (FARMER_FINAL_QUESTIONS.some(q => !completeAnswers[q.k])) return;
    setCompleteSubmitting(true);
    try {
      // 原子化（2026-07-19）：完了処理・評価保存・お気に入り登録を1つのRPC＝1トランザクションで実行。
      // 送信ボタンのタップだけがトリガーで、途中失敗なら何も保存されない（中途半端な履歴が残らない）
      const { data, error } = await submitFarmerFinalReviewRpc(completeModalApp.id, {
        workOutcome: completeAnswers.work_outcome,
        wantAgainChoice: completeAnswers.want_again_choice,
        traits: completeTags,
        favorite: completeAnswers.want_again_choice === "yes" && completeNotifyNext,
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
      fbSuccess(); setCelebrate({ title:"おつかれさまでした" });
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
        answers: completeAnswers, tags: completeTags,
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
  const [appHidden, setAppHidden] = useState(() => {
    try {
      // ★鍵を _v2 に変更（2026-08-22たきと指示「ラベルは貼ったまま表示。アイコンも。」）：
      //   旧既定＝3つとも非表示が保存済みの端末が残るため、鍵を替えて全員を新既定へ倒す
      const raw = sessionStorage.getItem("cb_appHidden_v2");
      if (raw !== null) { const v = JSON.parse(raw); if (Array.isArray(v)) return v.filter(k => APP_HIDABLE.includes(k)); }
    } catch {}
    return []; // 既定＝すべて表示（見送り・失効・取り消しもラベル・アイコンごと出す。隠すのは絞り込みバーの操作）
  });
  useEffect(() => { try { sessionStorage.setItem("cb_appHidden_v2", JSON.stringify(appHidden)); } catch {} }, [appHidden]);
  // 今日ページ・新着の応募からの着地（2026-07-26／2026-08-18に意味を変更）：
  // 旧＝「この段階だけを表示する」。新＝【行き先の応募that隠れていたら見えるようにする】。
  //   既定で見える段階（応募中・面接中・採用・作業中・完了）なら何もしない＝送り側4箇所は無改修で通る。
  //   隠している段階（見送り等）を指してきた時だけ、その1つを非表示から外す
  useEffect(() => {
    if (jobTab !== "applicants" && jobTab !== "calendar") return; // 応募者一覧・カレンダーのどちらに着地しても効く
    try {
      const f = sessionStorage.getItem("cb_appFilter");
      if (f) { sessionStorage.removeItem("cb_appFilter"); if (APP_HIDABLE.includes(f)) setAppHidden(prev => prev.filter(k => k !== f)); }
    } catch {}
  }, [jobTab]);
  const [appLegendOpen, setAppLegendOpen] = useState(false); // 応募者一覧・カレンダー下部「帯の意味」の説明ボックス開閉
  // カレンダータブのカレンダー（2026-08-19たきと指示「カレンダーは常時展開。ステータスページと同じ設計を」）
  // ＝ステータスページ（SavedJobsView）と同じ形にした：常に展開・畳む道は無い。
  //   開閉の状態（calOnTop/calClosing）・畳むアニメ（CAL_CLOSE_MS）・案内行のタップ・横スワイプの開閉は全廃。
  //   今日ページからの合図（cb_openCalendar）はもう「開く材料」ではないので、着いた時点で捨てるだけにする
  useEffect(() => {
    if (jobTab !== "calendar") return;
    try { sessionStorage.removeItem("cb_openCalendar"); } catch {}
  }, [jobTab]);
  // カレンダータブ＝カレンダーが主役（2026-08-21たきと指示「応募者ページはカレンダーだけにしてみて。
  // 求人カードは非表示。カレンダーの特定の日程をタップして該当する求人カードのみ表示」。
  // 2026-08-23の統合で、この姿は #/profile/employer/calendar＝下部ナビのカレンダータブに移った。
  // #/profile/employer/applicants は全件の応募者一覧＝マイページの入口カードから）：
  // calDay＝選んだ日 { ymd, jobs:[job_number] } | null。null＝カレンダーのみ／選ぶとその日の求人カードだけ出す。
  // 同じ日をもう一度タップ＝解除（カレンダーのみへ戻る）。ページを離れたら解除
  const [calDay, setCalDay] = useState(null);
  useEffect(() => { if (jobTab !== "calendar") setCalDay(null); }, [jobTab]);
  // 常時展開のカレンダー（ステータスページの calendarTop と同じ作法）。
  // ページ側の横スワイプ（求人一覧⇄応募者などの面送り）にカレンダーの月送りを食われないよう、
  // タッチはここで止める（開閉が無くなった今も、月送りを守るために必要）
  const calendarTop = (
    <div key="app-cal-top" onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}
      style={{ gridColumn:"1/-1", marginBottom:14 }}>
      {/* dayJobsAll＝関係を問わずその日の求人番号を受け取る（2026-08-23たきと指示
          「農家であっても働き手の求人カードを表示して」）。自分の求人のカードは jobInfoMap で
          絞るので混ざらず、働き手として応募した求人は下の埋め込み一覧が受け持つ */}
      <MyCalendar canPostJob dayJobsAll onDayJobs={(ymd, jobs) => setCalDay(prev => (prev && prev.ymd === ymd) ? null : { ymd, jobs })} />
    </div>
  );
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
  // ── あなたの求人カード（作成中・公開中の両パネル共用・2026-08-23たきと指示
  //    「その他の求人カードと同じ設計にしてほしい」）──
  // さがす・関連求人と同じ JobCard を使う＝カードの顔をこの面だけ別に作らない。
  // related は横スクロール用に幅280px固定so、縦一列のこの面には全幅版の wide を使う
  // （2026-08-19 仕事の評価ページと同じ判断）。JobCard を直せばこの面も自動で追従する。
  // ★この面だけの情報（状態の帯・未回答の質問）はカードの外側に重ねる＝JobCardに分岐を足さない。
  // ribbon＝StatusRibbon（公開間近／一時非公開）。hideEndLabel＝終了の帯を出さない
  //   （区画見出し「終了（N）」thatあるso重複させない・2026-07-27の判断を維持）。
  const renderOwnJobCard = (d, { ribbon, hideEndLabel } = {}) => {
    const j = mapJobPublicRow(d);
    // 何も入力していない下書きthat名無しにならないように（JobCardは crop task をそのまま並べる）
    if (!j.crop && !j.task) j.crop = "無題の求人";
    const nearPublish = d.status === "pending"; // 掲載申請済み＝公開の準備中（「公開間近」）
    const qn = qUnansweredMap[d.job_number] || 0;
    const canOpenQ = d.status === "open" && !hideEndLabel;
    return (
      // JobCard（related）の高さ＝写真の高さ＝カードの高さ。inset:0＋角丸で重ねものを写真の中に収める。
      // 包む側にもカードと同じ幅を持たせる（JOB_CARD_RELATED_SIZE）＝横並び（JobRow）で潰れない。
      // ★包まずに置くと flex thatカードをblock化するthat、包むと<a>thatinlineのままso幅thatが効かない（2026-08-23修理）
      <div key={d.job_number} style={{ position:"relative", flexShrink:0, ...JOB_CARD_RELATED_SIZE }}>
        <JobCard job={j} variant="related" hideEndLabel={hideEndLabel}
          onOpen={() => armedAction ? handleArmedCardTap(d)  // モード中はカード直接タップ＝実行（2026-08-07）
            : nearPublish ? setNearPublishInfo(true)          // 公開間近は詳細も求人者も見せず説明ボックス
            : setPreviewJob({ num: d.job_number, draft: d.status === "draft", open: d.status === "open", published: !!d.opened_at })} />
        {ribbon && (
          <div style={{ position:"absolute", inset:0, borderRadius:16, overflow:"hidden", pointerEvents:"none", zIndex:3 }}>{ribbon}</div>
        )}
        {qn > 0 && (
          // ❓バッジのタップ＝その求人の質問タブへ直行（2026-07-27たきと指示）。
          // カード本体の展開とは別動作so stopPropagation＋preventDefault（JobCardは<a>）。
          // 求人詳細は jobs_public（公開中のみ）を読むso、公開中でない求人では詳細thatが開けない
          // ＝その場合はカードの展開に任せる（バッジは表示のみ）
          <span onClick={canOpenQ ? (e => {
            e.preventDefault(); e.stopPropagation();
            try { sessionStorage.setItem("cb_jobBackTo", "/profile/employer/active"); } catch {}
            window.location.hash = "/work/job/" + d.job_number + "/questions";
          }) : undefined}
            role={canOpenQ ? "button" : undefined}
            aria-label={canOpenQ ? "未回答の質問を見る" : undefined}
            className="f-sans" style={{ position:"absolute", top:10, right:10, zIndex:4, background:"#E24B4A", color:"#fff", fontSize:12, fontWeight:700, borderRadius:20, padding:"3px 10px", boxShadow:"0 1px 4px rgba(0,0,0,0.2)", cursor: canOpenQ ? "pointer" : undefined }}>?{qn}</span>
        )}
      </div>
    );
  };
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
    return appPhaseLabelNow(a, { ...a, date_start: info.date_start, date_end: info.date_end, holidays: info.holidays, work_time: info.work_time }) || a.status;
  };
  // ★色もラベルと同じ材料で出す（2026-08-18たきと指示「採用の色に戻せ」）＝働く日でない日は
  //   赤（作業中）でなく採用の色。判定は lib/utils 側で一本化＝文字と色が食い違わない
  const appRibbonColor = (a) => {
    const info = jobInfoMap[a.job_number] || {};
    return appPhaseColorNow(a, { ...a, date_start: info.date_start, date_end: info.date_end, holidays: info.holidays, work_time: info.work_time });
  };
  // 隠す判定（2026-08-18・チャット一覧と同じ形）：段階の判定は帯と同じ appPhaseKey ＝
  // 帯・凡例・チャット一覧と文言も物差しも枝分かれしない
  // 応募者ページの横スワイプ（上部カレンダーの開閉）は廃止（2026-08-19たきと指示「カレンダーは常時展開」）＝
  // 畳む道が無くなったので、追従アニメ(setSwipeDx)ごと撤去した。誤って横に指を滑らせてもカレンダーは消えない

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

  // ↓応募者ページの読み込み。ここに置く理由：この中の着地処理が openCompleteModal を呼ぶため、
  //   その宣言より後ろでないと宣言前参照になる
  //   （2026-07-29に並べ替え・中身は不変。読み込み処理は上部の入口/求人ローダーと対）
  // 応募者タブを開くたびに応募の最新statusを取り直す（2026-07-16）。
  // 初回マウント時の1回だけだと、働き手側の操作（評価等）が進んでも
  // カードの帯が古いまま（契約のまま）になるため
  useEffect(() => {
    if (jobTab !== "applicants" && jobTab !== "calendar") return; // 応募者一覧・カレンダーの両面が同じ応募データを使う
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
        // ここから下は、今日ページからの着地（応募が手元に揃ってから判定する）。
        // 行き先はいずれも応募者ページなので、応募をこの面で読む今の形と噛み合っている
        // 完了・評価モーダルの着地（2026-07-24）：今日ページの「バイトの評価」（旧・完了して評価する）から cb_completeAppId 経由で自動展開（モーダルはここに常駐）
        try {
          const pendC = sessionStorage.getItem("cb_completeAppId");
          if (pendC) {
            sessionStorage.removeItem("cb_completeAppId");
            const target = appData.find(x => x.id === pendC);
            // completed も対象（評価だけ残っている応募・2026-07-27）。以前は進行中の状態しか通さず、
            // 今日ページの「バイトの評価」（旧・完了して評価する）が完了済みの応募では何も開かなかった
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
  }, [jobTab, appsRefreshTick]);

  // 応募者カード本体（ボトムシートで表示。承認/見送り・保険・開始確認・完了評価・チャットの操作込み）
  // お仕事の流れ（雇い手側・2026-07-26たきと指示）：働き手側FlowBar（WorkerApplications）の鏡写し。
  // 芯は両者共通（承認→面接→採用→仕事→完了報告→評価）で、頭だけ違う＝働き手「応募」／雇い手「掲載」
  // （CLAUDE.md「正規フロー（働き手／雇い手）の整理」に準拠）。現在地は応募行から算出する。
  const EMP_FLOW_STEPS = ["掲載", "承認", "面接", "採用", "仕事", "完了報告", "評価"];
  const empFlowState = (a) => {
    const approved = ["approved","meeting","interview","contracted","working","completed"].includes(a.status);
    const hired    = !!(a.terms_confirmed_worker_at && a.terms_confirmed_farmer_at); // 採用（双方確認）＝面接も済んだ扱い
    // ★働き手側FlowBar（ui.jsx）と同じ規則：「仕事」に✓が付くのは仕事が終わってから
    //   （2026-08-18たきと指示「仕事まで進めてチェックは入れるな」）。鏡写しの約束を守る
    const reported = a.status === "completed";
    const reviewed = reviewedAppIds.has(a.id) || (a.status === "completed" && a.attended === false); // 欠勤記録は評価の代わり
    const done = [true, approved, hired, hired, reported, reported, reviewed];
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
          const isNow = isActive && s === "仕事"; // 働き手側FlowBarと同じ（塗りつぶしの緑＋上下に跳ねて明滅）
          return (
            <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
              {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? ROLE_GREEN : "#E5E5E5" }} />}
              <div className={isNow ? "cb-flow-now" : undefined}
                style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, boxSizing:"border-box",
                background: (isDone || isNow) ? ROLE_GREEN : "#fff", border: (isDone || isNow) ? "none" : isActive ? "2px solid " + ROLE_GREEN : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? ROLE_GREEN : "#C8C8C8" }}>
                {isDone ? <NavIcon name="tick" size={11} /> : ""}
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
                  <button onClick={()=>{ window.location.hash="/chat/"+a.id; }} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}><NavIconInline name="chats" size={13} style={{ verticalAlign:"-2px" }} />チャットを開く</button>
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
                        fbSuccess(); setCelebrate({ title:"承認しました" });
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
                // 面接中＝チャットで直接やり取りし、決まったら採用する（2026-08-17たきと指示で質問集を廃止。
                // 従来は「📋 質問を送る」＋送信済みなら「採用する」の出し分けだった）
                if (phase === "interview") return (
                  <div style={{ display:"flex", gap:8 }}>
                    {chatBtn}
                    <button onClick={goHirePage} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}><NavIconInline name="hire" size={13} style={{ verticalAlign:"-2px" }} />採用する →</button>
                  </div>
                );
                // 採用〜作業中（＝作業日が来ている／来る応募）に「完了・欠勤を記録」を置く（2026-07-30たきと指摘
                // 「働き手がこなかった場合の措置がない」）。これまでは今日ページの「作業の開始を確認」を
                // 押した後にしか完了モーダルへ行けず、来なかった時は開始を確認するしかない（＝事実と違う記録を
                // 迫る）状態だった。complete_work は承認済み〜作業中を受け付ける（開始確認は要件でない）ため、
                // ここから直接「働き手は来ましたか？」→「来なかった」に入れる。作業日前は
                // RPCが「開始日はまだ先です」と理由付きで断る
                // ★2026-08-19たきと指示「最終日だけ全体的な評価。これは全ての工程の終了を意味する。
                //   それ以外は遅刻や欠勤、農家が来ていないとかの入力にする」＝最終の作業日に達するまでは
                //   完了・評価でなく【その日の記録】を出す。中日にここから完了させると、まだ作業が残って
                //   いるのに全工程が終わってしまう。判定は lib/utils の isFinalWorkDone
                //   （DBの my_todo_items と同じ物差し＝app_work_dates の最終日）
                if (phase === "contracted" || phase === "working") {
                  const jinfo = jobInfoMap[a.job_number];
                  if (!isFinalWorkDone(a, jinfo)) return (
                    <div style={{ display:"flex", gap:8 }}>
                      {chatBtn}
                      <button onClick={()=>setDayReportApp(a)} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer" }}><NavIconInline name="clipboard" size={13} style={{ verticalAlign:"-2px" }} />今日の記録</button>
                    </div>
                  );
                  return (
                    <div style={{ display:"flex", gap:8 }}>
                      {chatBtn}
                      <button onClick={()=>openCompleteModal(a)} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}><NavIconInline name="check" size={13} style={{ verticalAlign:"-2px" }} />完了・欠勤を記録</button>
                    </div>
                  );
                }
                // 完了（出勤あり）でまだ評価していない応募＝評価ボタンを出す（2026-07-27たきと指示）。
                // 欠勤記録済み（attended===false）は評価の代わりので出さない。評価後はチャットだけに戻る
                if (phase === "completed" && a.attended !== false && !reviewedAppIds.has(a.id)) return (
                  <div style={{ display:"flex", gap:8 }}>
                    {chatBtn}
                    <button onClick={()=>openCompleteModal(a)} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}><NavIconInline name="star" size={13} style={{ verticalAlign:"-2px" }} />評価する</button>
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
              <AvailDatesChips value={a.available_dates} agreed={a.agreed_dates} />
              {/* 働く日（確定済み・2026-07-24 追記3） */}
              <AgreedDatesRow value={a.agreed_dates} />
              {/* 状態メモ（進行の記録は小さく残す・操作は今日ページ） */}
              {a.status === "completed" && (
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color: a.attended===false ? "#E24B4A" : "#00A86B", margin:"0 0 8px" }}>{a.attended===false ? "欠勤記録済み" : <><NavIconInline name="tick" size={12} style={{ verticalAlign:"-1.5px" }} />完了・評価済み</>}</p>
              )}
              {actionButtons}
      </div>
    );
  };
  return (
    // 入口(home)は余白を持たない＝働き手入口と開始位置・下端が完全一致（外側のプロフィールwrapperが32px/4pxを提供）
    // サブページの上空白は15px固定（2026-07-25応募者→2026-07-26求人タブも・たきと指示で全サブページ統一）
    // 応募者ページは下余白もCSS側(20px)へ一本化するので、コンテナ自身の下80pxは持たせない（2026-07-26たきと指示）
    <div className={(jobTab === "applicants" || jobTab === "calendar") ? "emp-applicants-page" : undefined} style={{ maxWidth:1200, margin:"0 auto", padding: jobTab === "home" ? "0" : (jobTab === "applicants" || jobTab === "calendar") ? "15px 0 0" : "15px 0 80px" }}>
      {celebrate && <Celebration {...celebrate} onDone={()=>setCelebrate(null)} />}
      {/* その日の記録（最終の作業日より前の作業日・2026-08-19）。祝祭は出さない（祝う場面ではない） */}
      <DayReportSheet app={dayReportApp && { id: dayReportApp.id }} meId={me?.id} role="farmer"
        onClose={()=>setDayReportApp(null)} onDone={()=>setDayReportApp(null)} />
      {/* 労働条件通知書（求人カードのボタンから1件だけ開く・2026-08-23）。入口カードは出さないモード */}
      {noticeAppId && <LaborConditionsNotice me={me} role="farmer" applicationId={noticeAppId} onClose={()=>setNoticeAppId(null)} />}
      {jobTab === "home" ? (
        <>
          {/* ═══ Airbnb型入口メニュー（2026-07-14）：大プロフィールカード＋絵文字カード格子＋ワイド求人作成カード。
               文字タブの羅列を廃止し、タップで各サブページへ ═══ */}
          {/* トップボックスは反転式（2026-07-16・働き手側と同構造）：表=アイコン＋農園名／裏=アイコン・名前抜きのプレビュー。
              カードタップで反転（2026-08-21たきと指示「🔁ボタン削除。プロフィールカードタップで反転」）。
              編集への導線は表面の「編集する」ボタンが担う。カードはbuttonでなくdiv＝中の実ボタンと入れ子にしないため */}
          <div style={{ position:"relative" }}>
            <div role="button" tabIndex={0} onClick={()=>{
                if (empTopAnim === "pflip-out") return; // 連打ガード
                setEmpTopAnim("pflip-out");
                setTimeout(()=>{ setEmpTopBack(v=>{ const nv = !v; try { localStorage.setItem("cb_empTopBack", nv ? "1" : "0"); } catch {} return nv; }); setEmpTopAnim("pflip-in"); }, 400);
              }}
              onKeyDown={(e)=>{ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
              className={"f-sans" + (empTopAnim ? " " + empTopAnim : "")}
              onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && empTopAnim === "pflip-in") setEmpTopAnim(""); }}
              style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid " + ROLE_GREEN, borderRadius:24, padding:"28px 20px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box" }}>
              {!empTopBack ? (
                <>
                  {/* アイコンにも役割色の枠（2026-08-21たきと指示）＝働き手側（ProfileHub・橙）と同じ作法 */}
                  <Avatar url={empMini?.avatar_url} name={empMini?.nickname || me?.name} size={84} ring={ROLE_GREEN} />
                  {/* 役割チップ「農家」は削除（2026-08-21たきと指示「配色で役割は判断可能」）。
                      枠・ボタンの緑＝農家。働き手側（ProfileHub）の「働き手」チップは残す指示 */}
                  <span className="f-sans" style={{ display:"block", fontSize:22, fontWeight:800, color:"#222" }}>{empMini?.nickname || me?.name || "農園名未設定"}</span>
                  {/* 「農家」チップの下の導線2つ（2026-08-21たきと指示）。カードタップ=反転と分けるため stopPropagation */}
                  <span style={{ display:"flex", gap:10, marginTop:2 }}>
                    <button onClick={(e)=>{ e.stopPropagation(); window.location.hash="/profile/employer/active"; }} className="f-sans"
                      style={{ background:"#fff", border:"1.5px solid " + ROLE_GREEN, color:ROLE_GREEN, borderRadius:20, padding:"8px 18px", fontSize:13, fontWeight:800, cursor:"pointer" }}>あなたの求人</button>
                    <button onClick={(e)=>{ e.stopPropagation(); window.location.hash="/profile/employer/profile"; }} className="f-sans"
                      style={{ position:"relative", background:ROLE_GREEN, border:"1.5px solid " + ROLE_GREEN, color:"#fff", borderRadius:20, padding:"8px 18px", fontSize:13, fontWeight:800, cursor:"pointer" }}>
                      編集する
                      {/* 未設定の項目数（全て設定済みなら非表示）。カード右上→編集するボタンへ移植（2026-08-21たきと指示）。
                          カード枠の強調（cb-urgent-card/-still）は削除＝未設定の気づきはこのバッジと今日ページが担う */}
                      {empUnsetCount > 0 && (
                        <span style={{ position:"absolute", top:-8, right:-8, minWidth:20, height:20, borderRadius:10, background:"#F5A623", color:"#fff", fontSize:11, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 5px", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}>{empUnsetCount}</span>
                      )}
                    </button>
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
                            <span key={b.label} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{b.icon && <NavIconInline name={b.icon} size={12} style={{ verticalAlign:"-2px", marginRight:3 }} />}{b.emoji ? b.emoji + " " : ""}{b.label}</span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ fontSize:13, color:"#999", textAlign:"center", margin:"32px 0" }}>プロフィールは未設定です</p>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* 応募者一覧の入口カード（2026-08-23たきと指示「応募者一覧としてマイページに移植」）：
              下部ナビの「応募者」タブはカレンダー（#/profile/employer/calendar）に差し替えたため、
              全件の応募者一覧はこのカードが入口。赤バッジ＝未対応の応募（my_nav_badges.applicants_pending
              ＝旧ナビタブのバッジと同じ数・Appからprop渡し）。承認・見送りの実行は従来どおり応募者シートが唯一の窓口 */}
          <button onClick={()=>{ window.location.hash = "/profile/employer/applicants"; }} className="f-sans" style={{ position:"relative", width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
            <span style={{ flexShrink:0, display:"flex", color:"#333" }}><NavIcon name="applicants" size={40} /></span>
            <span style={{ minWidth:0 }}>
              <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>応募者一覧</span>
              <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>求人ごとの応募者と、いまの段階をまとめて確認できます。</span>
            </span>
            {(applicantsBadge || 0) > 0 && (
              <span style={{ position:"absolute", top:-8, right:-8, minWidth:20, height:20, borderRadius:10, background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 5px", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}>{applicantsBadge}</span>
            )}
          </button>
          {/* 入口カード（📌いま=応募者／📋求人の管理=作成中・公開中）は2026-07-25に一度削除→
              2026-08-23に応募者一覧だけ復活（上のカード）。作成中・公開中への入口は名刺カードの
              「あなたの求人」ボタンとURL直打ち(/profile/employer/*)が従来どおり生きている */}
          <button onClick={onNewJob} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>{/* 箱ジャンプ(cb-jump)→タイトル文字の順ジャンプに変更（NoticeJumpText・2026-07-25たきと指示） */}
            <span style={{ flexShrink:0, display:"flex", color:"#333" }}><NavIcon name="postJob" size={40} /></span>
            <span>
              <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}><NoticeJumpText text="求人の掲載" /></span>
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
          {/* 保険の準備（2026-07-24・専用ページ#/insuranceへ遷移）。アプリ内遷移の目印を残し、戻るは history.back で元の場所（スクロール位置）へ復帰させる。
              質問集カードと同じ反転式（2026-07-29たきと指示）：裏＝保険の箱を横スクロール、タップでその場に開いて申告できる */}
          <div style={{ position:"relative", marginTop:12 }}>
            {!insCardBack ? (
              <button onClick={()=>{ try{ sessionStorage.setItem("cb_insFromApp","1"); }catch{} window.location.hash="/insurance"; }}
                className={"f-sans" + (insCardAnim ? " " + insCardAnim : "")}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && insCardAnim === "pflip-in") setInsCardAnim(""); }}
                style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:100, boxSizing:"border-box" }}>
                <span style={{ flexShrink:0, display:"flex" }}><NavIcon name="shield" size={40} /></span>
                <span style={{ minWidth:0, paddingRight:28 }}>
                  <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>保険の準備</span>
                  <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>働き手のケガに備える保険の準備方針を、自己申告で表明できます。</span>
                </span>
              </button>
            ) : (
              <div className={"f-sans" + (insCardAnim ? " " + insCardAnim : "")}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && insCardAnim === "pflip-in") setInsCardAnim(""); }}
                style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:100, boxSizing:"border-box", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 10px", paddingRight:28 }}><NavIconInline name="shield" size={11} style={{ verticalAlign:"-1.5px", marginRight:3 }} />保険の準備（自己申告・{insItems.length}件）</p>
                <div style={{ display:"flex", gap:8, overflowX:"auto", WebkitOverflowScrolling:"touch", margin:"0 -16px", padding:"2px 16px" }}>
                  {insOrderedItems.map(it => {
                    const on = insItems.includes(it.k);
                    const open = insOpenKey === it.k;
                    return (
                      /* 箱の色（2026-07-29たきと指示）：既定=元のまま／申告ずみ=縁だけ緑／開いている=全体が緑 */
                      <button key={it.k} onClick={()=>setInsOpenKey(open ? null : it.k)}
                        className="f-sans" style={{ flexShrink:0, maxWidth:200, background: open ? ROLE_GREEN : "#F7F7F7", border:"1px solid " + (open || on ? ROLE_GREEN : "#EBEBEB"), borderRadius:12, padding:"10px 14px", cursor:"pointer", textAlign:"left" }}>
                        <span style={{ display:"block", fontSize:13, fontWeight:700, color: open ? "#fff" : "#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}><NavIconInline name={it.iconName} size={13} style={{ verticalAlign:"-2px", marginRight:3 }} />{it.chip}</span>
                        <span style={{ display:"block", fontSize:11, color: open ? "rgba(255,255,255,.85)" : on ? ROLE_GREEN : "#B0B0B0", marginTop:2 }}>{on ? <>申告ずみ <NavIconInline name="tick" size={11} style={{ verticalAlign:"-1.5px", marginRight:0 }} /></> : "未申告"}</span>
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
            }} aria-label="表示を切り替える" className={insCardAnim || undefined} style={{ position:"absolute", top:12, right:12, width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}><NavIcon name="swap" size={16} /></button>
          </div>
          <div style={{ marginTop:16 }}>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_GREEN, paddingLeft:8 }}>記録</p>
            <div className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, margin:"0 0 12px" }}>
                <p style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}><NavIconInline name="heartFill" size={14} style={{ verticalAlign:"-2px", color:"#E24B4A" }} />また呼びたいリスト</p>
                <button onClick={()=>setRosterInfoOpen(v=>!v)} aria-label="説明を見る" className="f-sans" style={{ width:22, height:22, borderRadius:11, background: rosterInfoOpen ? "#00A86B" : "#F0F0F0", color: rosterInfoOpen ? "#fff" : "#717171", border:"none", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>？</button>
              </div>
              {rosterInfoOpen && (
                <p className="fade-in" style={{ fontSize:12, color:"#717171", margin:"0 0 12px", lineHeight:1.6 }}>一緒に働いたあと「また呼びたい」と評価してお気に入り登録した方のリストです。新しい求人を出すとお知らせが届き、リピート即決ONの求人には応募と同時に自動承認されます。</p>
              )}
              {rosterRows.length === 0
                ? <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>まだ登録はありません。仕事のあと「また呼びたい」で登録できます。</p>
                : <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>{rosterRows.map(r => (<button key={r.worker_id} onClick={()=>openRosterDetail(r.worker_id)} aria-label="働き手の詳細" style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}><Avatar url={r.avatar_url} name={r.nickname || "？"} size={52} /></button>))}</div>}
            </div>
            {/* 「労働条件通知書」の入口カードは削除（2026-08-22たきと指示）。
                ★通知書そのものは残っている：求人カードのボタンから1件ずつ開く
                （上の noticeAppId 経由・applicationId付きのLaborConditionsNotice・表示と印刷）＝
                雇用主が労働条件を明示・交付する手段はサイトから失われていない */}
          </div>
          {/* やることカード群（2026-08-22たきと指示「農家も実施」＝働き手面のコピーと対）。
              正本は今日ページ（TodayPage）＝移行中の複製。行き先の専用ページ(#/calendar/todo/*)も
              今日ページ側に残っている（削除の段でこちらへ引っ越す）。中身・並びは共有部品が担う */}
          <TodayTaskBoxes role="farmer" />
          {/* 「期限切れの求人を見る」リンクは削除（2026-07-25たきと指示）。ページ自体(/profile/employer/expired)はURL直打ちで到達可 */}
        </>
      ) : (
      <>
      {/* 浮遊の「← 農家プロ」「＋ 求人を出す」ボックスは削除（2026-07-25たきと指示）。
          戻りは下部ナビのプロフィールタブ、求人作成は入口カードの「求人の掲載」が担う
          （☰メニュー・PCヘッダー・フッターの「求人を出す」は2026-08-19たきと指示で削除） */}
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
      ) : (jobTab==="calendar" || jobTab==="profile") ? null : (
        /* 応募者ページの見出し「応募者」は削除（2026-07-26たきと指示）。現在地は下部ナビの点灯が示す。
           「雇い手プロフィール」の見出しも削除（2026-08-03たきと指示・名刺カードから開けば現在地は明らか） */
        <h2 className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 16px" }}>{(JOB_TABS.find(t => t.k === jobTab) || {}).l || ""}</h2>
      )}
      {/* 作成中⇄公開中はページャー（2026-07-16）：文字・絵文字・ボタン・カードが指に追従して実際に横移動する */}
      {(jobTab==="draft" || jobTab==="active") ? (
      <div onTouchStart={onPagerStart} onTouchMove={onPagerMove} onTouchEnd={onPagerEnd} style={{ overflow:"hidden", touchAction:"pan-y" }}>
        <div ref={pagerTrackRef} style={{ display:"flex", width:"200%", transform: jobTab==="draft" ? "translateX(0%)" : "translateX(-50%)", transition:"transform .3s ease" }}>
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingRight:5 }}>
            <div ref={skelDraftRef} style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:16 }}>{/* 作成中パネル（縦一列・カードはさがすと同じ設計・2026-08-23） */}
      {draftsLoading ? (
          /* 「読み込み中...」の文字でなく、前回この面が実際に描いた形の仮配置を並べる（2026-07-27たきと指示） */
          <div style={{ gridColumn:"1/-1" }}><AutoSkeleton shapeKey="farmDrafts" /></div>
        ) : dbDrafts.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0" }}>
            <div style={{ marginBottom:12, display:"flex", justifyContent:"center", color:"#717171" }}><NavIcon name="sprout" size={40} /></div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>作成中の求人はありません</p>
            <button onClick={onNewJob} className="btn-primary" style={{ padding:"12px 28px", fontSize:14 }}>＋ 求人の掲載</button>
          </div>
        ) : (
          (() => {
            // 作成中と審査中をセクションで分離（2026-07-16）。審査中は閲覧のみ（再開/削除は作成中のみ）
            // カードは「その他の求人」と同じ設計＝renderOwnJobCard（JobCard wide）に集約（2026-08-23）。
            // タブ名（作成中）と同じ帯は出さない（重複排除）。公開間近だけ帯を出す
            // ＝「審査中」ではなく前向きな色（2026-08-07）
            const renderDraftCard = (d) => renderOwnJobCard(d, {
              ribbon: d.status === "pending" ? <StatusRibbon label="公開間近" color="#0E8A6B" /> : null,
            });
            const making = dbDrafts.filter(d => d.status === "draft");
            const pending = dbDrafts.filter(d => d.status === "pending");
            return (
              <>
                {making.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#8A6D1D", margin:"0 0 -2px" }}>作成中（{making.length}）</p>}
                {making.length > 0 && <JobRow count={making.length}>{making.map(renderDraftCard)}</JobRow>}
                {pending.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#0E8A6B", margin:"8px 0 -2px" }}>公開間近（{pending.length}）</p>}
                {pending.length > 0 && <JobRow count={pending.length}>{pending.map(renderDraftCard)}</JobRow>}
              </>
            );
          })()
        )}
            </div>
          </div>
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingLeft:5 }}>
            <div ref={skelActiveRef} style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:16 }}>{/* 公開中パネル（縦一列・カードはさがすと同じ設計・2026-08-23） */}
      {draftsLoading ? (
          /* 読み込み中に「公開中の求人はありません」を出すと一瞬ゼロに見える。確定するまでは仮配置 */
          <div style={{ gridColumn:"1/-1" }}><AutoSkeleton shapeKey="farmActive" /></div>
        ) : (dbActive.length === 0 && dbExpired.length === 0) ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0" }}>{/* 空状態は作成中ページと全く同じ配置（2026-07-16） */}
            <div style={{ display:"flex", justifyContent:"center", marginBottom:12, color:"#C8C8C8" }}><NavIcon name="image" size={40} /></div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>公開中の求人はありません</p>
            <button onClick={onNewJob} className="btn-primary" style={{ padding:"12px 28px", fontSize:14 }}>＋ 求人の掲載</button>
          </div>
        ) : (
          (() => {
            // 審査中(pending)と公開中(open)をセクションで分離（2026-07-16）。
            // 終了（作業日程が過ぎた求人）も公開中ボックスに残す（2026-07-22）。
            // カードは「その他の求人」と同じ設計＝renderOwnJobCard（JobCard wide）に集約（2026-08-23）。
            // 帯は見出しと重複させない（2026-07-25／2026-07-27たきと指示）：タブ名と同じ「公開中」は出さず、
            // 区画見出し「終了（N）」thatある終了の段も帯を出さない（hideEndLabel）。
            // ★公開中の段では終了帯を出す＝満員（募集終了（満員））thatカードで分かる。
            //   従来この面は満員を表示できず、公開中の求人と見分けthatつかなかった
            const renderActiveJobCard = (d, ended=false) => renderOwnJobCard(d, {
              hideEndLabel: ended,
              ribbon: (!ended && d.status !== "open")
                ? <StatusRibbon label={d.status==="draft" ? "一時非公開" : "公開間近"} color={d.status==="draft" ? "#757575" : "#0E8A6B"} />
                : null,
            });
            const open = dbActive.filter(d => d.status === "open");
            const unpub = dbActive.filter(d => d.status === "draft"); // 一時非公開（掲載歴あり）
            const ended = dbExpired; // 作業日程が過ぎた求人＝終了（探すからは自動で外れるが、農家の公開中ボックスには残す）
            return (
              <>
                {open.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#00A86B", margin:"0 0 -2px" }}>公開中（{open.length}）</p>}
                {open.length > 0 && <JobRow count={open.length}>{open.map(d => renderActiveJobCard(d))}</JobRow>}
                {unpub.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#757575", margin:"8px 0 -2px" }}>一時非公開（{unpub.length}）</p>}
                {unpub.length > 0 && <JobRow count={unpub.length}>{unpub.map(d => renderActiveJobCard(d))}</JobRow>}
                {ended.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#9E9E9E", margin:"8px 0 -2px" }}>終了（{ended.length}）</p>}
                {ended.length > 0 && <JobRow count={ended.length}>{ended.map(d => renderActiveJobCard(d, true))}</JobRow>}
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
        style={{ display:"grid", gridTemplateColumns: (jobTab==="applicants"||jobTab==="calendar") ? "repeat(3, 1fr)" : jobTab==="expired" ? "minmax(0, 1fr)" : "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: (jobTab==="applicants"||jobTab==="calendar") ? 10 : jobTab==="expired" ? 16 : 20 }}>{/* 応募者・カレンダーは横3列。期限切れは縦一列（カードはさがすと同じ設計・2026-08-23） */}
      {/* 2026-07-14: プレビューページ廃止＝トップボックスタップで直接編集ページへ。プレビューは編集ページ右上→モーダル */}
      {jobTab==="profile" ? (
        <EmployerProfileEdit me={me} />
      ) : (jobTab==="applicants" || jobTab==="calendar") ? (
        /* 統合（2026-08-23たきと指示「働き手のカレンダーと農家の応募者を統合」）：
           カレンダータブ（jobTab==="calendar"）＝カレンダー＋日タップでその日の求人と応募者（旧・応募者ページの姿）。
           応募者一覧（jobTab==="applicants"）＝カレンダー無しで全件の求人×応募者カード（マイページの入口カードから）。
           応募データ・カード・シート・絞り込みは全部共有＝二重実装しない */
        appsLoading ? (
          /* 読み込み中もカレンダーは出す（ステータスページと同じ設計＝この面に来れば必ず予定が見える） */
          <>
            {jobTab==="calendar" && calendarTop}
            <div style={{ gridColumn:"1/-1" }}><AutoSkeleton shapeKey="farmList:applicants" /></div>
          </>
        ) : dbApplicants.length === 0 ? (
          <>
            {jobTab==="calendar" && calendarTop}
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
              <div style={{ marginBottom:12, display:"flex", justifyContent:"center" }}><NavIcon name="inbox" size={40} /></div>
              <p style={{ fontSize:14, margin:0 }}>まだ応募はありません</p>
              <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>求人が公開されると、働き手が応募できます。</p>
            </div>
          </>
        ) : (
          // 応募者を求人毎に分ける（2026-07-19）。上部＝状態フィルタタブ（タップ＋横スワイプ）／下部＝帯の意味の説明（2026-07-22）
          (() => {
            const shown = dbApplicants.filter(a => !appHidden.includes(appPhaseKey(a)));
            const order = []; const byJob = {};
            shown.forEach(a => { const jn = a.job_number; if (!jobInfoMap[jn]) return; if (!byJob[jn]) { byJob[jn] = []; order.push(jn); } byJob[jn].push(a); });
            // ── 面の出し分け（2026-08-23たきと指示「働き手のカレンダーと農家の応募者を統合」）──
            // calMode（カレンダータブ）＝2026-08-21の姿そのまま：
            //   日を選んでいない間＝カレンダー＋1番直近の求人カード1枚（絞り込みバー・凡例は出さない）
            //   日を選ぶと＝その日の求人カードだけ（従来どおり絞り込みバー・凡例つき）
            // 応募者一覧（applicants）＝カレンダー無しで全件（2026-08-21以前の一覧の復元・絞り込みバー・凡例つき）
            // ★order は my_farm_applicants（created_at降順）の初出順ので order[0]＝一番新しい応募の求人。
            // 日付タップの受け口は calendarTop の onDayJobs（同じ日をもう一度タップ＝解除）
            const calMode = jobTab === "calendar";
            const dayJobs = calDay ? new Set(calDay.jobs) : null;
            // ★その日の自分の求人は【応募者ゼロでも出す】（2026-08-21たきと報告「タップしてもカードが出てこない」の修理）。
            //   order＝応募者がいる求人だけので、それだけで絞ると応募の無い求人・絞り込みで全員隠れた求人のカードが消える。
            //   応募者ありを先（order順＝新しい応募の順）・無しを後ろに。jobInfoMap に無い番号＝自分の求人でない
            //   （働き手として応募した求人・いいね）ので出さない
            const dayOrder = !calMode
              ? order
              : calDay
              ? [...order.filter(jn => dayJobs.has(jn)), ...calDay.jobs.filter(jn => jobInfoMap[jn] && !byJob[jn])]
              : order.slice(0, 1);
            // 黄色い帯（「○月○日 の求人を表示しています」＋解除）は削除（2026-08-23たきと指示・
            // スクショの要素削除）。解除＝カレンダーの同じ日をもう一度タップ
            // 絞り込みバー（2026-07-27たきと指示）：下部バーの真上に浮かせる。
            // スクロール格納・入力中の退避・オーバーレイ中の非表示は、浮遊☰と同じCSS作法で揃えてある
            // （.cb-applicant-filter-bar / body.cb-scroll-hide 等）。PCは従来どおり本文中に並べる
            const filterButtons = APP_HIDABLE.map(k => ({
              k, label: APP_PHASE_LABEL[k], on: appHidden.includes(k),
              onTap: () => setAppHidden(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]),
            })).map(b => (
              <button key={b.k} onClick={b.onTap} aria-pressed={b.on} className="f-sans" style={{ flex:"1 0 auto", display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:20, border: b.on ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:13, fontWeight: b.on?800:600, color: b.on?"#222":"#999", cursor:"pointer", whiteSpace:"nowrap" }}>
                {/* 段階色の点＝帯・凡例と同じAPP_PHASE_COLOR */}
                <span aria-hidden="true" style={{ width:8, height:8, borderRadius:"50%", background: APP_PHASE_COLOR[b.k] || "#999", flexShrink:0 }} />
                {/* 選択中＝隠している、を目で分かるように取り消し線 */}
                <span style={{ textDecoration: b.on ? "line-through" : "none" }}>{b.label}</span>
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
            const body = dayOrder.length === 0
              // 0件＝理由と戻し方を明記（空ボックスに説明の原則・2026-08-03）。
              // 日を選んだ時の0件＝その日に自分の求人が無い（応募の有無・絞り込みは関係なくなった＝
              // 求人カード自体は応募者ゼロでも出すため）。働き手として応募した日・いいねの日をタップした時がこれ。
              // 日を選んでいない時（直近カードの面）＝絞り込みで全員隠れている時にここで説明する
              // 日を選んで0件＝何も出さない（2026-08-23たきと指示）。この面は下に働き手のカードが並ぶので、
              // 「あなたが出した求人はありません」と書くと、その下のカードと食い違って見える
              ? (calDay ? [] : [<div key="app-empty" className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"36px 0" }}>
                  <p style={{ margin:0 }}>
                    {calDay ? "この日に、あなたが出した求人はありません。" : "表示できる応募者がいません。"}
                    {!calDay && appHidden.length > 0 && <><br/>{appHidden.map(k => APP_PHASE_LABEL[k]).join("・")}を非表示にしています。</>}
                  </p>
                  {!calDay && appHidden.length > 0 && (
                    <button onClick={()=>setAppHidden([])} className="f-sans" style={{ marginTop:14, padding:"9px 16px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>すべて表示する</button>
                  )}
                </div>])
              : dayOrder.map(jn => {
                  // 求人カード化（2026-07-25たきと指示）：左＝トップ写真／右＝タイトル・No.／その下に応募者アイコンの横スワイプ列。
                  // アイコン列のtouchはstopPropagationで親のフィルタ切替スワイプと分離する
                  // apps＝この求人の表示できる応募者。応募者ゼロでもカードは出す（2026-08-21）ので必ず||[]で受ける
                  const apps = byJob[jn] || [];
                  // 全員が絞り込みで隠れているのか、そもそも応募が無いのかを右側の文言で区別する
                  const hiddenCount = apps.length === 0 ? dbApplicants.filter(a => a.job_number === jn).length : 0;
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
                  //   「バイトの評価」（旧・完了して評価する）から来ても応募者カードに触れず、完了記録・評価ができなかった。
                  //   todoAppIds（my_todo_items由来＝完了記録・評価が残っている応募）が1件でもあれば暗幕を出さない
                  const jobPendingAction = apps.some(a => todoAppIds.has(a.id));
                  const jobPast = datePast && !jobPendingAction;
                  const jobCompleted = jobPast && apps.some(a => a.status === "completed");
                  // カレンダーで選んだ日に該当する求人は光らせる（アジェンダ廃止の引き継ぎ・2026-07-27）
                  // 未対応（＝農家の番）の応募が1件でもあるカードは、赤影＋跳ねで気づかせる（2026-07-27たきと指示）。
                  // 既存の .cb-urgent-card（赤影＋3.5秒の浮遊ループ）をそのまま使う。終わった求人は静かにする
                  const cardUrgent = !jobPast && apps.some(a => todoAppIds.has(a.id));
                  // 見送り・取り消しも失効と同じ扱い（2026-08-23たきと指示「見送りと取り消しも同様」）＝
                  // 表示している応募が全員その状態で終わっている求人に、最前線のラベルを出す。
                  // ★ただしタップは殺さない（暗幕を pointerEvents:none にする）：失効・完了と違い、
                  //   求人自体はまだ生きていて新しい応募が来ることがあるため、開けなくしてはいけない
                  const endedAll = !jobPast && apps.length > 0 && apps.every(a => a.status === "rejected" || a.status === "canceled");
                  const endedLabel = !endedAll ? null : (apps.some(a => a.status === "rejected") ? "見送り" : "取り消し");
                  const endedColor = endedLabel === "見送り" ? (APP_PHASE_COLOR.rejected || "#9E9E9E") : (APP_PHASE_COLOR.canceled || "#9E9E9E");
                  return (
                    <div key={`job-${jn}`} className={"cb-app-jobcard" + (cardUrgent ? " cb-urgent-card" : "")}
                      style={{ gridColumn:"1/-1", position:"relative", display:"flex", flexDirection:"column", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden", marginTop:2, pointerEvents: jobPast ? "none" : undefined }}>
                      {jobPast && (
                        // ★zIndex:5＝カードの中で最前線（2026-08-23たきと指示「失効等のラベルを最前線に」・
                        //   適用はこの応募者一覧ページのみ）。2のままだと、後から描かれる同じzIndexの
                        //   タイトル帯（写真の下部のグラデ）が勝ち、「失効」の文字が求人名の裏に潜っていた
                        <div style={{ position:"absolute", inset:0, zIndex:5, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <span className="f-sans" style={{ background: jobCompleted ? "#607D8B" : "#111", color:"#fff", fontSize:13, fontWeight:800, borderRadius:8, padding:"6px 20px", letterSpacing:"0.15em" }}>{jobCompleted ? "完了" : "失効"}</span>
                        </div>
                      )}
                      {endedLabel && (
                        // 見送り・取り消し（2026-08-23）：失効・完了と同じ最前線のラベル。
                        // pointerEvents:none＝暗幕が乗ってもカードは従来どおりタップできる
                        <div style={{ position:"absolute", inset:0, zIndex:5, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
                          <span className="f-sans" style={{ background: endedColor, color:"#fff", fontSize:13, fontWeight:800, borderRadius:8, padding:"6px 20px", letterSpacing:"0.15em" }}>{endedLabel}</span>
                        </div>
                      )}
                      {/* 上：求人のトップ写真（2026-08-23たきと指示「求人カードを縦に」＝旧・左104pxの横並びから
                          カード幅いっぱいの上下積みに）。タイトル・No.は写真の下部に重ね、暗いグラデーション越しに
                          写真が透ける（2026-07-26たきと指示・求人カードのカバー写真と同じ作法）。
                          No.は必ず明記＝タイトルだけ「…」で省略し、#No.は別行で常時表示。タップで求人を見る。
                          ★高さは180px固定（旧・3:4の縦横比指定からの置き換え）：全幅で縦横比を指定すると、
                            画面幅に比例して高さが伸び、PC（グリッドは1/-1＝全幅）では写真だけで数百pxになる。
                            高さを決めて objectFit:cover に切り取らせれば、どの画面幅・どの求人でも同じ高さで揃う
                            （2026-08-06「縦幅が求人ごとに違う。統一しろ」の狙いはそのまま） */}
                      <button onClick={()=>setPreviewJob({ num: jn })} aria-label="求人を見る" className="f-sans"
                        style={{ flexShrink:0, width:"100%", height:180, padding:0, border:"none", borderBottom:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                        {photo && <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover", filter: (jobPast || endedAll) ? "grayscale(70%)" : "none" }} />}
                        {/* 写真の真ん中に求人者のアイコン（2026-08-23たきと指示「真ん中に求人者のアイコン」）。
                            写真の有無に関わらず必ず置く＝旧は「写真が1枚も無い求人だけ代わりに出す」だった。
                            この面の求人はすべて自分が出したものので求人者＝自分＝empMini。アイコン未設定なら
                            Avatar が農園名の頭文字の丸（雇い手の緑）を出す＝これも実データ（ダミー写真で水増ししない・憲法3条）。
                            写真の上に乗る時は白枠＋影で写真から浮かせる（写真がない時は枠なし＝灰色の下地に丸がひとつ） */}
                        {/* ★タップ＝農家プレビュー（2026-08-23たきと指示「農家のアイコンは農家プレビュー」）。
                            写真のボタンの中に入れ子のbuttonは置けないので span の role="button"＋stopPropagation
                            ＝写真（求人）のタップと分ける */}
                        <span role="button" tabIndex={0} aria-label="農家のプレビューを見る"
                          onClick={(e)=>{ e.stopPropagation(); if (me?.id) openEmployerPreview(me.id); }}
                          onKeyDown={(e)=>{ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (me?.id) openEmployerPreview(me.id); } }}
                          style={{ position:"absolute", left:"50%", top:"50%", transform:"translate(-50%, -50%)", zIndex:3, display:"block", lineHeight:0, borderRadius:"50%", cursor:"pointer", boxShadow: photo ? "0 2px 10px rgba(0,0,0,0.35)" : "none", filter: (jobPast || endedAll) ? "grayscale(70%)" : "none" }}>
                          <Avatar url={empMini?.avatar_url} name={empMini?.nickname || "？"} size={72} ring={photo ? "#fff" : undefined} bg={ROLE_GREEN} />
                        </span>
                        {/* タイトルと#No.は同じ行に（2026-08-23たきと指示「タイトルの横にナンバー」）。
                            タイトルが長い時は「…」で省略し、#No.は必ず読める（flexShrink:0で削られない） */}
                        <span style={{ position:"absolute", left:0, right:0, bottom:0, zIndex:2, padding:"22px 14px 10px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box", display:"flex", alignItems:"baseline", gap:8 }}>
                          <span style={{ flex:1, minWidth:0, fontSize:15, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{title}</span>
                          <span style={{ flexShrink:0, fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.82)", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{jn}</span>
                        </span>
                      </button>
                      {/* 下：応募者アイコンスワイプ（人数「N名 →」は削除・2026-07-26たきと指示） */}
                      <div style={{ width:"100%", minWidth:0, padding:"10px 12px 12px", display:"flex", alignItems:"center", boxSizing:"border-box" }}>
                        {/* 応募者ゼロでもカードは出す（2026-08-21）：右側は理由の一言。
                            全員が絞り込みで隠れている時と、まだ応募が無い時を区別する */}
                        {apps.length === 0 ? (
                          <p className="f-sans" style={{ width:"100%", textAlign:"center", fontSize:12, color:"#999", margin:0, lineHeight:1.7 }}>
                            {hiddenCount > 0
                              ? <>絞り込みで{hiddenCount}名を非表示にしています</>
                              : <>この求人への応募はまだありません</>}
                          </p>
                        ) : (<>
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
                          {apps.map(a => {
                            const wp = workerProfiles[a.worker_id];
                            // 失効応募のアイコンは「失効当時の状態」で表示（2026-07-25たきと指示）。失効はappliedからのみ発生（cron）＝応募中。
                            // 失効の事実はカード全体の黒「失効」オーバーレイが担う（アイコン側に失効ラベルは出さない）
                            const phaseA = a.status === "expired" ? { ...a, status: "applied" } : a;
                            return (
                              // アイコン＝働き手プレビュー（2026-08-23たきと指示「働き手アイコンは働き手のプレビュー」）。
                              // ★段階のチップ＝応募者シート（承認・見送り・採用の窓口）に付け替えた＝
                              //   アイコンをプレビューに譲っても、判断の入口がカードから1タップで残る
                              <button key={a.id} onClick={()=>openWorkerPreview(a.worker_id)} className="f-sans"
                                style={{ flexShrink:0, width:64, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                                {/* 未対応（農家の番）のアイコンだけ跳ねる。働き手のアクション待ちは静止（2026-07-26たきと指示） */}
                                <span className={!jobPast && todoAppIds.has(a.id) ? "cb-jump" : undefined} style={{ display:"block", lineHeight:0 }}>
                                  <Avatar url={wp?.avatar_url} name={wp?.nickname || "？"} size={52} ring={appRibbonColor(phaseA)} />
                                </span>
                                <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color: wp?.nickname ? "#222" : "#999", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{wp?.nickname || "未設定"}</span>
                                {/* 段階は貼るラベル（チップ）で出す（2026-08-22たきと指示「ラベル貼れていない」）：
                                    文字色だけだと貼った感が無い＝凡例の帯と同じ 段階色の下地＋白文字 に統一 */}
                                <span onClick={(e)=>{ e.stopPropagation(); setSheetApplicantId(a.id); }} role="button" style={{ display:"inline-block", fontSize:9, fontWeight:700, background:appRibbonColor(phaseA), color:"#fff", borderRadius:6, padding:"2px 7px", marginTop:3, cursor:"pointer", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{appRibbonLabel(phaseA)}</span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                        </>)}
                      </div>
                      {/* ボタンの並び（2026-08-23たきと指示「各ボタンはチャット、記録する、労働条件通知書の構成に。
                          労働条件通知書は大きく取ってほしい」）：上段＝チャット／記録する（最終の作業日からは評価する）、
                          下段＝労働条件通知書を全幅で大きく。対象は採用が決まった応募だけ
                          （採用前は通知書が無く、記録するものもない）。複数人を採用している求人は1人1組＝名前を添える。
                          ★実行の窓口は増やしていない：チャット＝#/chat/{応募ID}／記録＝DayReportSheet／
                            評価＝完了・評価モーダル（openCompleteModal）＝応募者シート・今日の各ページと同じ部品 */}
                      {(() => {
                        const hired = apps.filter(a => ["contracted","working","completed"].includes(appPhaseKey(a)));
                        if (hired.length === 0) return null;
                        const jinfo = jobInfoMap[jn];
                        const btn = (extra) => ({ flex:1, minWidth:0, padding:"10px", fontSize:12, fontWeight:700, borderRadius:10, cursor:"pointer", whiteSpace:"nowrap", ...extra });
                        return (
                          <div style={{ width:"100%", boxSizing:"border-box", borderTop:"1px solid #F0F0F0", padding:"10px 12px 12px", display:"grid", gap:12 }}>
                            {hired.map(a => {
                              const wp = workerProfiles[a.worker_id];
                              const phase = appPhaseKey(a);
                              // 完了＝評価がまだ残っている時だけ「評価する」。欠勤記録済み・評価済みは押すものがない
                              const rec = phase === "completed"
                                ? ((a.attended === false || reviewedAppIds.has(a.id)) ? null : { label:"評価する", green:true, on:()=>openCompleteModal(a) })
                                : isFinalWorkDone(a, jinfo)
                                ? { label:"評価する", green:true, on:()=>openCompleteModal(a) }
                                : { label:"記録する", green:false, on:()=>setDayReportApp(a) };
                              return (
                                <div key={a.id} style={{ display:"grid", gap:8 }}>
                                  {hired.length > 1 && (
                                    <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#717171", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{wp?.nickname || "未設定"}</span>
                                  )}
                                  <div style={{ display:"flex", gap:8 }}>
                                    <button onClick={()=>{ window.location.hash="/chat/"+a.id; }} className="f-sans" style={btn({ background:"#fff", color:"#00A86B", border:"1px solid #00A86B" })}>
                                      <NavIconInline name="chats" size={12} style={{ verticalAlign:"-2px" }} />チャット
                                    </button>
                                    {rec ? (
                                      <button onClick={rec.on} className="f-sans" style={btn(rec.green
                                        ? { background:"#00A86B", color:"#fff", border:"none" }
                                        : { background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A" })}>
                                        <NavIconInline name={rec.green ? "star" : "clipboard"} size={12} style={{ verticalAlign:"-2px" }} />{rec.label}
                                      </button>
                                    ) : (
                                      <span className="f-sans" style={{ flex:1, textAlign:"center", alignSelf:"center", fontSize:12, fontWeight:700, color: a.attended === false ? "#E24B4A" : "#00A86B" }}>{a.attended === false ? "欠勤記録済み" : "評価済み"}</span>
                                    )}
                                  </div>
                                  {/* 緊急連絡先＝チャット・記録するの下（2026-08-23たきと指示）。
                                      採用成立後のみ・当事者だけに開く唯一の窓口（contract_emergency_contact）を
                                      そのまま置く＝この画面で新しい開示経路を作らない。相手が未登録なら何も出ない */}
                                  <ContractEmergencyContact applicationId={a.id} style={{ margin:0 }} />
                                  {/* 労働条件通知書＝全幅で大きく（たきと指示）。
                                      ★終わった仕事（完了・失効・見送り）でカード全体がタップ不能になっても、
                                        このボタンだけは押せるようにする（2026-08-24たきと指示）＝
                                        通知書の提供は義務なので、記録の閲覧を暗幕で塞がない。
                                        暗幕（zIndex:5）より上に置き、pointerEvents を自分だけ auto に戻す */}
                                  <button onClick={()=>setNoticeAppId(a.id)} className="f-sans"
                                    style={{ width:"100%", padding:"15px 12px", fontSize:14, fontWeight:800, borderRadius:12, cursor:"pointer", background:"#fff", color:"#00A86B", border:"1.5px solid #00A86B", position:"relative", zIndex:6, pointerEvents:"auto" }}>労働条件通知書</button>
                                  {/* 働く日と応募の進み具合＝通知書の下（2026-08-23たきと指示）。
                                      日の集合は appWorkDates（agreed_dates ＞ 求人の期間・holidays を除く）＝
                                      カレンダー・最終日の判定と同じソース。進み具合は応募者シートと同じ
                                      お仕事の流れバー（renderEmpFlowBar）＝段の点き方が枝分かれしない */}
                                  <WorkDaysStrip days={[...appWorkDates(a, jinfo)].sort()} accent="#00A86B" />
                                  <div>
                                    <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:"#717171", margin:"0 0 2px" }}>応募の進み具合</p>
                                    {renderEmpFlowBar(a)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  );
                });
            // カレンダータブ：日を選んでいない時は静かな面＝カレンダー・案内・直近カード1枚だけ
            //（絞り込みバー・凡例は日を選んだ時だけ＝従来どおり）。
            // 応募者一覧：カレンダーは出さず、全件＋絞り込みバー・凡例
            // 働き手として応募した求人のカード（2026-08-23たきと指示）＝働き手のカレンダーページと
            // 同じ部品をそのまま埋め込む（見た目・操作を二重に作らない）。カードGA1枚も無ければ何も出ない
            const workerCards = (
              <div key="worker-cards" style={{ gridColumn:"1/-1" }}>
                <SavedJobsView me={me} embedded calDay={calDay} />
              </div>
            );
            return !calMode
              ? [tabBar, floatingFilterBar, ...body, legend]
              : calDay
              // カレンダータブでは絞り込みのピルを出さない（2026-08-23たきと指示・浮遊バーが
              // カードの「応募の進み具合」と重なっていた）。応募者一覧では従来どおり出す
              ? [calendarTop, ...body, workerCards, legend]
              : [calendarTop, ...body, workerCards];
          })()
        )
      ) : jobTab==="expired" ? (
        dbExpired.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
            <div style={{ marginBottom:12, display:"flex", justifyContent:"center" }}><NavIcon name="ended" size={40} /></div>
            <p style={{ fontSize:14, margin:0 }}>期限切れの求人はありません</p>
            <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>作業日程が過ぎた求人がここに入ります。</p>
          </div>
        ) : (
          // カードは「その他の求人」と同じ設計＝作成中・公開中と同じ renderOwnJobCard（2026-08-23）。
          // 帯は「期限切れ」だけ＝このタブ自体that期限切れso、JobCardの終了帯は出さない（重複排除）
          <JobRow count={dbExpired.length}>
            {dbExpired.map(d => renderOwnJobCard(d, {
              hideEndLabel: true,
              ribbon: <StatusRibbon label="期限切れ" color="#9E9E9E" />,
            }))}
          </JobRow>
        )
      ) : jobList.length === 0 ? (
        <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0 40px" }}>
          <div style={{ marginBottom:14, display:"flex", justifyContent:"center", color:"#717171" }}><NavIcon name="sprout" size={44} /></div>
          <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:6 }}>まだ求人がありません</p>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:22 }}>最初の求人を出して、働き手を募集しましょう。</p>
          <button onClick={onNewJob} className="btn-primary" style={{ padding:"14px 32px", fontSize:14 }}>＋ 求人の掲載</button>
        </div>
      ) : jobList.map(job => (
        <div key={job.id} style={{ display:"block", width:"100%", background:"#fff", border:"1px solid #EEE", borderRadius:12, overflow:"hidden" }}>
          <div style={{ width:"100%", height:220, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", color:"#C8C8C8" }}><NavIcon name="image" size={72} /></div>
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
                  {full === null ? "この求人の詳しい内容を表示できません（求人の記録が見つかりません）" : <>読み込み中<Dots /></>}
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
              <p style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 4px" }}><NavIconInline name="calendar" size={16} />働く日を決める</p>
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
        const wantAgain = completeAnswers.want_again_choice === "yes";
        // 実働日数（客観データの見出し用）。求人情報が無ければ出さないだけ＝評価は止めない
        const jinfo = jobInfoMap[completeModalApp.job_number];
        const dayCount = jinfo ? appWorkDates(completeModalApp, jinfo).size : null;
        return (
        /* 最終日の専用画面（2026-08-20たきと裁定）＝①日次の記録の自動表示 ②3問×3択 ③特記タグ
           →送信するタップで最終確認。器は共有部品 FinalReviewSheet（働き手→農家と同じ形・設問だけ違う）。
           完了の記録は従来どおりRPC（submit_farmer_final_review）が評価と1トランザクションで行う */
        <FinalReviewSheet
          app={completeModalApp}
          title="今回の仕事を完了する"
          intro={notDone ? "送信すると、作業の完了が記録され、評価が働き手に届きます。" : "評価が働き手に届きます。"}
          dayCount={dayCount}
          questions={FARMER_FINAL_QUESTIONS}
          answers={completeAnswers}
          onAnswer={(k, v)=>setCompleteAnswers(prev => ({ ...prev, [k]: v }))}
          tagDef={FARMER_TRAIT_TAGS}
          tags={completeTags}
          onToggleTag={(v)=>setCompleteTags(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
          submitting={completeSubmitting}
          onSubmit={submitFarmerReview}
          onClose={()=>setCompleteModalApp(null)}
          /* お気に入り登録＝リピート即決の判定そのもの（trg_instant_approve が repeat_roster を見る・2026-08-19）。
             登録の意味を伏せない。解除はまた呼びたいリストからいつでもできる */
          extra={wantAgain ? (
            <div style={{ marginBottom:16 }}>
              <label className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#222", cursor:"pointer" }}>
                <input type="checkbox" checked={completeNotifyNext} onChange={e=>setCompleteNotifyNext(e.target.checked)} style={{ width:18, height:18, accentColor:"#00A86B", flexShrink:0 }} />
                <NavIconInline name="heartFill" size={14} style={{ verticalAlign:"-2px", color:"#E24B4A" }} />お気に入り登録する
              </label>
              <p className="f-sans" style={{ fontSize:11, color:"#717171", lineHeight:1.7, margin:"4px 0 0 26px" }}>
                登録すると、新しい求人のお知らせが届きます。「また呼びたい即決」をONにした求人では、この方の応募が自動で承認されます（採用ではありません）。登録はまた呼びたいリストからいつでも解除できます。
              </p>
            </div>
          ) : null}
          confirmNote="送信すると、あとから直すことはできません。肯定的な答えと良かった点のタグだけが働き手のページに表示されます（否定的な答えは公開されませんが、記録には残ります）。"
          confirmExtra={wantAgain ? (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"9px 0" }}>
              <span className="f-sans" style={{ fontSize:13, color:"#222" }}><NavIconInline name="heartFill" size={13} style={{ verticalAlign:"-2px", color:"#E24B4A" }} />お気に入り登録</span>
              <span className="f-sans" style={{ fontSize:13, fontWeight:800, flexShrink:0, color: completeNotifyNext ? "#00A86B" : "#B0B0B0" }}>{completeNotifyNext ? "する" : "しない"}</span>
            </div>
          ) : null}
          /* 例外の道：来なかった場合（出欠の記録が済むまでのあいだだけ出す） */
          footer={attendOpen ? (
            <button onClick={markNoShow} disabled={completeSubmitting} className="f-sans"
              style={{ display:"block", width:"100%", marginTop:16, paddingTop:14, borderTop:"1px solid #F0F0F0", background:"none", border:"none", fontSize:12, color:"#E24B4A", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>
              働き手が来なかった場合は → 欠勤として記録する
            </button>
          ) : null}
        />
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
            <div style={{ marginBottom:10, display:"flex", justifyContent:"center", color:"#0E8A6B" }}><NavIcon name="sprout" size={48} /></div>
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
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 18px" }}>お気に入り登録しました！</p>
            <div onClick={()=>openWorkerPreview(favDone.workerId)} role="button" style={{ position:"relative", width:88, height:88, margin:"0 auto 16px", cursor:"pointer" }}>
              <Avatar url={favDone.avatar_url} name={favDone.nickname || "？"} size={88} />
              <span className="cb-heart-pop" style={{ position:"absolute", right:-8, bottom:-4, fontSize:32, lineHeight:1, filter:"drop-shadow(0 2px 4px rgba(0,0,0,0.25))" }}><NavIcon name="heartFill" size={32} style={{ color:"#E24B4A" }} /></span>
            </div>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.8, margin:"0 0 6px" }}>「また呼びたい」と思った方を、あなたのお気に入りに登録しました。</p>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.8, margin:0 }}>リピート即決ONのあなたの求人にこの方が応募すると、自動で承認されます。</p>
            {favDetailOpen ? (
              <div className="f-sans fade-in" style={{ marginTop:14, background:"#F7F7F7", borderRadius:12, padding:"12px 14px", textAlign:"left", fontSize:12, color:"#555", lineHeight:1.8 }}>
                ・新しい求人を出すと、この方にお知らせが届きます<br/>
                ・効果はあなた自身の求人だけに働き、ほかの農家の求人には影響しません<br/>
                ・登録した方は農家プロフィールの「また呼びたいリスト」に表示されます<br/>
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
        <div onClick={()=>setCompleteDone(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 16px" }}><NavIconInline name="tick" size={16} style={{ verticalAlign:"-2.5px" }} /> 評価登録完了</p>
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
              {FARMER_FINAL_QUESTIONS.map(q => (
                <p key={q.k} style={{ margin:"0 0 4px", color:"#222" }}>{q.label}：<strong>{(q.choices.find(c => c.v === completeDone.answers?.[q.k]) || {}).l || "—"}</strong></p>
              ))}
              {(completeDone.tags || []).length > 0 && (
                <p style={{ margin:"0 0 4px", color:"#222" }}>特記事項：<strong>{FARMER_TRAIT_TAGS.options.filter(t => completeDone.tags.includes(t.v)).map(t => t.l).join("・")}</strong></p>
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

    </div>
  );
}
