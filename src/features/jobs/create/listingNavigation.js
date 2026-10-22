// 第2弾の画面契約。DBの旧番号と、画面・端末の固定IDを混同しない。
import { FARMER_FLOW, legacyStepId, stepNumber } from "./flowSteps.js";
import { calendarDateToYmd, restoreDraftCalendarDate } from "../../../lib/calendarDate.js";

export const LISTING_NAV_VERSION = "2026-10-22-stage2";
export const ACTIVE_LISTING_FLOW = Object.freeze([
  "intro", ...FARMER_FLOW.flatMap(id => id === "schedule" ? [id, "holidays", "headcount"] : [id]),
]);
export const isListingPage = id => ACTIVE_LISTING_FLOW.includes(id);
const isRoutablePage = id => isListingPage(id) && id !== "complete";
export const isListingInputPage = id => isListingPage(id) && !["intro", "complete"].includes(id);
export const legacyNumberForPage = id => id === "intro" ? 0 : ["holidays", "headcount"].includes(id) ? 4 : stepNumber(id);
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
  if ((scope === "work/new" && tail === "3/workplace") || (/\/edit\//.test(scope) && tail === "workplace")) {
    return { scope, pageId: "workplace", auxiliary: true, explicit: true, returnToConfirm: false };
  }
  const named = tail.match(/^page\/([a-z_]+)$/);
  const legacy = scope === "work/new" && /^\d+$/.test(tail) ? legacyStepId(tail) : null;
  const id = named?.[1] || legacy;
  return { scope, pageId: isRoutablePage(id) ? id : null, returnToConfirm,
    explicit: true, invalid: !isRoutablePage(id), legacy: !!legacy };
}
// 完了表示は掲載・保存の結果確認後だけ。URLや下書きから成功画面を生成しない。
export function listingPageHash(scope, pageId, returnToConfirm = false) {
  if (!/^work\/(?:new|edit\/[1-9]\d*|local\/[a-f0-9-]+)$/.test(scope) || !isRoutablePage(pageId)) return null;
  return `#/${scope}/page/${pageId}${returnToConfirm && !["intro", "review", "complete"].includes(pageId) ? "?return=review" : ""}`;
}

// DBにないページIDを捏造しない。端末の明示IDを優先し、旧4だけ入力内容から再開候補を選ぶ。
// DBだけでは休日ページを確認済みか分からないため、複数日なら休日を再確認する。
export function resolveListingResume(form = {}, fallbackStep = 0) {
  if (form.listingPageId != null) {
    if (form.listingNavVersion !== LISTING_NAV_VERSION || !isRoutablePage(form.listingPageId)) return { error: "unknown_saved_page" };
    return { pageId: form.listingPageId, returnToConfirm: form.listingReturnToReview === true };
  }
  let pageId = legacyStepId(fallbackStep);
  if (!isRoutablePage(pageId)) return { error: "unknown_saved_step" };
  if (pageId === "schedule" && validSchedule(form.jobDateStart, form.jobDateEnd)) {
    if (isMultiDaySchedule(form.jobDateStart, form.jobDateEnd)) pageId = "holidays";
    else if (!validHeadcount(form.jobCount)) pageId = "headcount";
  }
  return { pageId, returnToConfirm: false };
}
