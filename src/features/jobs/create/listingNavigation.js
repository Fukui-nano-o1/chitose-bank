// 第5弾までの画面契約。DBの旧番号と、画面・端末の固定IDを混同しない。
import { FARMER_FLOW, legacyStepId, stepNumber } from "./flowSteps.js";
import { RECRUITER_PAGE_IDS } from "./listingPublicationPages.js";
import { workDurationHours } from "./jobInputCodec.js";
import { calendarDateToYmd, restoreDraftCalendarDate } from "../../../lib/calendarDate.js";

export const LISTING_NAV_VERSION = "2026-10-26-stage5";
export const STAGE4_LISTING_NAV_VERSION = "2026-10-23-stage4";
export const STAGE3_LISTING_NAV_VERSION = "2026-10-23-stage3";
export const PREVIOUS_LISTING_NAV_VERSION = "2026-10-22-stage2";
export const ACTIVE_LISTING_FLOW = Object.freeze([
  "intro", ...FARMER_FLOW.flatMap(id => ({
    task: ["task", "task_scope"], workplace: ["workplace", "place_scope", "access"],
    schedule: ["schedule", "holidays", "headcount"],
    terms: ["work_time", "break_time", "overtime", "daily_wage"],
    photos: ["photos", "photo_captions"],
    description: ["description"],
    work_video: ["work_video", "video_consent"],
    danger: ["danger_places", "danger_tasks"],
    wishes: ["belongings", "cautions", "worker_preferences", "repeat_approval"],
    review: [...RECRUITER_PAGE_IDS, "review", "publish_consent"],
  }[id] || [id])),
]);
export const isListingPage = id => ACTIVE_LISTING_FLOW.includes(id);
// terms は旧URL専用の別名。実際の入力ページには残さない。
export const canonicalListingPage = id => ({terms:"work_time",danger:"danger_places",wishes:"belongings"})[id] || id;
const isRoutablePage = id => isListingPage(id) && id !== "complete";
export const isListingInputPage = id => isListingPage(id) && !["intro", "complete"].includes(id);
const SPLIT_LEGACY_NUMBERS = Object.freeze({ task_scope: 2, place_scope: 3, access: 3,
  holidays: 4, headcount: 4, work_time: 5, break_time: 5, overtime: 5, daily_wage: 5,
  photo_captions: 7, video_consent: 9, danger_places: 10, danger_tasks: 10,
  belongings: 11, cautions: 11, worker_preferences: 11, repeat_approval: 11, recruiter_name: 12, recruiter_address: 12, recruiter_contact: 12, smoking_policy: 12, publish_consent: 12 });
export const legacyNumberForPage = id => id === "intro" ? 0 : SPLIT_LEGACY_NUMBERS[id] ?? stepNumber(id);
const day = value => calendarDateToYmd(value instanceof Date ? value : restoreDraftCalendarDate(value));
export const validSchedule = (start, end) => !!day(start) && (!end || (!!day(end) && day(end) >= day(start)));
export const isMultiDaySchedule = (start, end) => validSchedule(start, end) && !!day(end) && day(end) > day(start);
export const validHeadcount = count => Number.isInteger(Number(count)) && Number(count) > 0;
export function adjacentListingPage(id, direction, { start, end, photoCount = 0, hasVideo = false, missingRecruiter = [] } = {}) {
  const visible = page => (page !== "holidays" || isMultiDaySchedule(start, end)) &&
    (page !== "photo_captions" || photoCount > 0) && (page !== "video_consent" || hasVideo) &&
    (!RECRUITER_PAGE_IDS.includes(page) || missingRecruiter.includes(page));
  const index = ACTIVE_LISTING_FLOW.indexOf(canonicalListingPage(id));
  if (index < 0) return null;
  for (let i = index + (direction > 0 ? 1 : -1); i >= 0 && i < ACTIVE_LISTING_FLOW.length; i += direction > 0 ? 1 : -1) {
    if (visible(ACTIVE_LISTING_FLOW[i])) return ACTIVE_LISTING_FLOW[i];
  }
  return null;
}

export function parseListingRoute(hash = "") {
  const [path, query = ""] = String(hash).replace(/^#\/?/, "").split("?");
  const match = path.match(/^(work\/(?:new|edit\/[1-9]\d*|local\/[a-f0-9-]+))(?:\/(.*))?$/);
  if (!match) return null;
  const scope = match[1], tail = match[2] || "";
  const returnToConfirm = new URLSearchParams(query).get("return") === "review";
  if (!tail) return { scope, pageId: null, returnToConfirm: false, explicit: false };
  if ((scope === "work/new" && tail === "3/workplace") || tail === "workplace") {
    return { scope, pageId: "workplace", auxiliary: true, explicit: true, returnToConfirm };
  }
  const named = tail.match(/^page\/([a-z_]+)$/);
  const legacy = scope === "work/new" && /^\d+$/.test(tail) ? legacyStepId(tail) : null;
  const id = canonicalListingPage(named?.[1] || legacy);
  return { scope, pageId: isRoutablePage(id) ? id : null, returnToConfirm,
    explicit: true, invalid: !isRoutablePage(id), legacy: !!legacy };
}
// 完了表示は掲載・保存の結果確認後だけ。URLや下書きから成功画面を生成しない。
export function listingPageHash(scope, pageId, returnToConfirm = false) {
  pageId = canonicalListingPage(pageId);
  if (!/^work\/(?:new|edit\/[1-9]\d*|local\/[a-f0-9-]+)$/.test(scope) || !isRoutablePage(pageId)) return null;
  return `#/${scope}/page/${pageId}${returnToConfirm && !["intro", "review", "complete"].includes(pageId) ? "?return=review" : ""}`;
}

// DBにないページIDを捏造しない。端末の明示IDを優先し、旧4・5は入力内容から再開候補を選ぶ。
// DBだけでは休日ページを確認済みか分からないため、複数日なら休日を再確認する。
export function resolveListingResume(form = {}, fallbackStep = 0) {
  if (form.listingPageId != null) {
    const previous = form.listingNavVersion === PREVIOUS_LISTING_NAV_VERSION;
    const stage4 = form.listingNavVersion === STAGE4_LISTING_NAV_VERSION;
    const stage3 = form.listingNavVersion === STAGE3_LISTING_NAV_VERSION;
    const oldIds = ["intro", ...FARMER_FLOW, "holidays", "headcount"];
    const stage3Ids = ["intro", ...FARMER_FLOW, "task_scope", "place_scope", "access", "holidays", "headcount", "work_time", "break_time", "overtime", "daily_wage"];
    const stage4Ids = ACTIVE_LISTING_FLOW.filter(id => !RECRUITER_PAGE_IDS.includes(id) && id !== "publish_consent");
    if ((!previous && !stage3 && !stage4 && form.listingNavVersion !== LISTING_NAV_VERSION) || (previous && !oldIds.includes(form.listingPageId)) || (stage3 && !stage3Ids.includes(form.listingPageId)) || (stage4 && !stage4Ids.includes(form.listingPageId))) return { error: "unknown_saved_page" };
    const legacyDetail = { danger: "danger_places", wishes: "belongings" };
    const pageId = form.listingPageId === "terms" && (previous || stage3) ? resumeTermsPage(form) :
      (previous || stage3) ? (legacyDetail[form.listingPageId] || canonicalListingPage(form.listingPageId)) : canonicalListingPage(form.listingPageId);
    if (!isRoutablePage(pageId) || (!previous && !stage3 && form.listingPageId === "terms")) return { error: "unknown_saved_page" };
    return { pageId, returnToConfirm: form.listingReturnToReview === true };
  }
  const legacyId = legacyStepId(fallbackStep);
  let pageId = legacyId === "terms" ? resumeTermsPage(form) : ({ danger: "danger_places", wishes: "belongings" }[legacyId] || legacyId);
  if (!isRoutablePage(pageId)) return { error: "unknown_saved_step" };
  if (pageId === "schedule" && validSchedule(form.jobDateStart, form.jobDateEnd)) {
    if (isMultiDaySchedule(form.jobDateStart, form.jobDateEnd)) pageId = "holidays";
    else if (!validHeadcount(form.jobCount)) pageId = "headcount";
  }
  return { pageId, returnToConfirm: false };
}

// 未入力の勤務条件を飛ばさない。金額の適否は従来どおり画面とDBの最低賃金検査で判定する。
function resumeTermsPage(form) {
  if (workDurationHours(form) <= 0) return "work_time";
  if (form.breakTime == null || form.breakTime === "") return "break_time";
  if (!form.overtimePolicy || (form.overtimePolicy === "あり" && !String(form.overtimeDetail || "").trim())) return "overtime";
  return "daily_wage";
}
