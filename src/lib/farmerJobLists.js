import { isJobEnded, isJobUnpublished } from "./utils.js";

// キャッシュの分類は取得時のもの。毎回現在時刻で仕分け、求人の記録自体は残す。
export function classifyFarmerJobs(rows, now = Date.now()) {
  const unique = new Map();
  for (const row of rows) {
    if (!row) continue;
    const key = row.job_number == null ? row : String(row.job_number);
    const previous = unique.get(key);
    // 古い分類のキャッシュが重なっても1件だけにする。更新日時があれば新しい行を優先。
    if (!previous || (Date.parse(row.updated_at) || 0) > (Date.parse(previous.updated_at) || 0)) unique.set(key, row);
  }
  const drafts = [], active = [], expired = [];
  for (const row of unique.values()) {
    if (row.status === "draft" && !row.opened_at) drafts.push(row);
    else if (row.status === "closed" || isJobEnded(row, now)) expired.push(row);
    else if (row.status === "pending") drafts.push(row);
    else if (row.status === "open" || isJobUnpublished(row)) active.push(row);
  }
  return { drafts, active, expired };
}
