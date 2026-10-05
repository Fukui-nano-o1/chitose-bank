// 求人掲載フローの唯一の順序定義。
// 画面追加・削除・並び替えは原則この配列だけを変更する。IDは保存済み下書きとの契約なので変更しない。
export const FARMER_FLOW = [
  "crop", "task", "workplace", "schedule", "terms",
  "details_intro", "photos", "description", "work_video", "danger", "wishes", "review", "complete",
];

export const REVIEW_STEP_ID = "review";
export const COMPLETE_STEP_ID = "complete";
export const OPTIONAL_DETAIL_IDS = new Set(["photos","description","work_video","danger","wishes"]);

export function stepIndex(id) { return FARMER_FLOW.indexOf(id); }
export function stepNumber(id) { const i=stepIndex(id); return i < 0 ? null : i + 1; }
export function stepIdFromNumber(n) { return FARMER_FLOW[Number(n) - 1] || null; }
export function nextStepId(id) { const i=stepIndex(id); return i >= 0 ? FARMER_FLOW[i + 1] || null : FARMER_FLOW[0]; }
export function previousStepId(id) { const i=stepIndex(id); return i > 0 ? FARMER_FLOW[i - 1] : null; }
export function normalizeStepId(id, fallback="crop") { return FARMER_FLOW.includes(id) ? id : fallback; }

// 旧URL / 旧draft_step互換。将来FARMER_FLOWを変えても、旧番号の意味はこの表で固定する。
const LEGACY_20261005 = {
  1:"crop",2:"task",3:"workplace",4:"schedule",5:"terms",6:"details_intro",
  7:"photos",8:"description",9:"work_video",10:"danger",11:"wishes",12:"review",13:"complete",
};
export function legacyStepId(n) { return LEGACY_20261005[Number(n)] || null; }
