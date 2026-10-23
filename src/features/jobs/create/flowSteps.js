// 保存・旧URLの番号契約。段階的に分割した実画面順序はlistingNavigation.jsに定義する。
// 全体計画と各段階の終了条件は docs/uiux/listing-flow-redesign.md。
export const FARMER_FLOW = Object.freeze([
  "crop", "task", "workplace", "schedule", "terms",
  "details_intro", "photos", "description", "work_video", "danger", "wishes", "review", "complete",
]);
export const REVIEW_STEP_ID = "review";
export const COMPLETE_STEP_ID = "complete";
export const OPTIONAL_DETAIL_IDS = new Set(["photos", "description", "work_video", "danger", "wishes"]);
export const LISTING_STAGE_INFO = Object.freeze([
  Object.freeze({ title: "基本情報", description: "作物・作業・場所と、日程・勤務条件を決めます。", icon: "edit" }),
  Object.freeze({ title: "仕事の詳細", description: "写真や説明を加えて、当日の仕事を伝えます。", icon: "camera" }),
  Object.freeze({ title: "確認・掲載", description: "働き手に見える内容を確認して、募集を始めます。", icon: "tick" }),
]);

export function stepIndex(id) { return FARMER_FLOW.indexOf(id); }
export function stepNumber(id) { const i = stepIndex(id); return i < 0 ? null : i + 1; }
export function stepIdFromNumber(n) { return FARMER_FLOW[Number(n) - 1] || null; }
export function nextStepId(id) { const i = stepIndex(id); return i >= 0 ? FARMER_FLOW[i + 1] || null : FARMER_FLOW[0]; }
export function previousStepId(id) { const i = stepIndex(id); return i > 0 ? FARMER_FLOW[i - 1] : null; }
export function normalizeStepId(id, fallback = "crop") { return FARMER_FLOW.includes(id) ? id : fallback; }

// 番号の意味は配列の並び替えから独立させる。旧形式の世代を推測しない。
export const LEGACY_LISTING_STEPS = Object.freeze({
  "2026-10-05": Object.freeze({
    0: "intro", 1: "crop", 2: "task", 3: "workplace", 4: "schedule", 5: "terms", 6: "details_intro",
    7: "photos", 8: "description", 9: "work_video", 10: "danger", 11: "wishes", 12: "review", 13: "complete",
  }),
  "pre-video": Object.freeze({
    0: "intro", 1: "crop", 2: "task", 3: "workplace", 4: "schedule", 5: "terms", 6: "details_intro",
    7: "photos", 8: "description", 9: "danger", 10: "wishes", 11: "review", 12: "complete",
  }),
});
export function legacyStepId(n, version = "2026-10-05") {
  if (typeof n !== "number" && (typeof n !== "string" || !/^\d+$/.test(n))) return null;
  return LEGACY_LISTING_STEPS[version]?.[Number(n)] || null;
}

// 画面枠の判定はIDで行う。既存呼出元の番号は入口でのみ変換する。
export function listingFrameState(value) {
  const splitPosition = { task_scope: 2.5, place_scope: 3 + 1 / 3, access: 3 + 2 / 3,
    holidays: 4 + 1 / 3, headcount: 4 + 2 / 3, work_time: 5, break_time: 5.25, overtime: 5.5, daily_wage: 5.75 };
  const id = value === "intro" || Object.hasOwn(splitPosition, value) || FARMER_FLOW.includes(value) ? value : legacyStepId(value);
  const valid = !!id;
  const n = id === "intro" ? 0 : splitPosition[id] ?? stepNumber(id);
  const details = stepNumber("details_intro"), review = stepNumber(REVIEW_STEP_ID);
  const stage = valid && n >= review ? 2 : valid && n >= details ? 1 : 0;
  const progress = valid ? [
    Math.min(n / details, 1),
    Math.max(0, Math.min((n - details) / (review - details), 1)),
    id === COMPLETE_STEP_ID ? 1 : id === REVIEW_STEP_ID ? 0.5 : 0,
  ] : [0, 0, 0];
  return {
    id, valid, stage, progress,
    intro: id === "intro", review: id === REVIEW_STEP_ID, complete: id === COMPLETE_STEP_ID,
    wide: ["intro", "details_intro", REVIEW_STEP_ID].includes(id),
    skipDetails: id === "access" || id === "details_intro" || OPTIONAL_DETAIL_IDS.has(id),
    lastDetail: nextStepId(id) === REVIEW_STEP_ID,
  };
}
