// 第3弾までの画面契約。DBの旧番号と、画面・端末の固定IDを混同しない。
import { FARMER_FLOW, legacyStepId, stepNumber } from "./flowSteps.js";
import { workDurationHours } from "./jobInputCodec.js";
import { calendarDateToYmd, restoreDraftCalendarDate } from "../../../lib/calendarDate.js";

export const LISTING_NAV_VERSION = "2026-10-23-stage3";
export const PREVIOUS_LISTING_NAV_VERSION = "2026-10-22-stage2";
export const ACTIVE_LISTING_FLOW = Object.freeze([
  "intro", ...FARMER_FLOW.flatMap(id => ({
    task: ["task", "task_scope"], workplace: ["workplace", "place_scope", "access"],
    schedule: ["schedule", "holidays", "headcount"],
    terms: ["work_time", "break_time", "overtime", "daily_wage"],
  }[id] || [id])),
]);
export const isListingPage = id => ACTIVE_LISTING_FLOW.includes(id);
// terms は旧URL専用の別名。実際の入力ページには残さない。
export const canonicalListingPage = id => id === "terms" ? "work_time" : id;
const isRoutablePage = id => isListingPage(id) && id !== "complete";
export const isListingInputPage = id => isListingPage(id) && !["intro", "complete"].includes(id);
const SPLIT_LEGACY_NUMBERS = Object.freeze({ task_scope: 2, place_scope: 3, access: 3,
  holidays: 4, headcount: 4, work_time: 5, break_time: 5, overtime: 5, daily_wage: 5 });
export const legacyNumberForPage = id => id === "intro" ? 0 : SPLIT_LEGACY_NUMBERS[id] ?? stepNumber(id);
const day = value => calendarDateToYmd(value instanceof Date ? value : restoreDraftCalendarDate(value));
export const validSchedule = (start, end) => !!day(start) && (!end || (!!day(end) && day(end) >= day(start)));
export const isMultiDaySchedule = (start, end) => validSchedule(start, end) && !!day(end) && day(end) > day(start);
export const validHeadcount = count => Number.isInteger(Number(count)) && Number(count) > 0;
export function adjacentListingPage(id, direction, { start, end } = {}) {
  const pages = ACTIVE_LISTING_FLOW.filter(page => page !== "holidays" || isMultiDaySchedule(start, end));
  const index = pages.indexOf(id);
  // 単日への変更後に履歴で休日ページへ戻った場合も、入力を消さず隣へ進める。
  if (id === "holidays" && index < 0) return direction > 0 ? "headcount" : "schedule";
  return index < 0 ? null : pages[index + (direction > 0 ? 1 : -1)] || null;
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
    const oldIds = ["intro", ...FARMER_FLOW, "holidays", "headcount"];
    if ((!previous && form.listingNavVersion !== LISTING_NAV_VERSION) || (previous && !oldIds.includes(form.listingPageId))) return { error: "unknown_saved_page" };
    const pageId = form.listingPageId === "terms" && previous ? resumeTermsPage(form) : canonicalListingPage(form.listingPageId);
    if (!isRoutablePage(pageId) || (!previous && form.listingPageId === "terms")) return { error: "unknown_saved_page" };
    return { pageId, returnToConfirm: form.listingReturnToReview === true };
  }
  const legacyId = legacyStepId(fallbackStep);
  let pageId = legacyId === "terms" ? resumeTermsPage(form) : legacyId;
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
