import { isJobEnded } from "./utils.js";

// 終了フラグは保存した時点の写し。表示するときの日本時間で必ず再判定する。
export function refreshJobExpiry(job, now = Date.now()) {
  if (!job) return job;
  const expired = isJobEnded(job, now);
  return job.expired === expired ? job : { ...job, expired };
}

// 検索・関連求人用。過去の記録や共有リンクの詳細はこのフィルターを通さない。
// 満員でも日程内の求人は従来どおり末尾に残す。
export function isSearchJobVisible(job, now = Date.now()) {
  return !!job && !job.closed && job.status !== "closed" && !isJobEnded(job, now);
}

export function visibleSearchJobs(jobs, now = Date.now()) {
  return (jobs || []).filter(job => isSearchJobVisible(job, now)).map(job => refreshJobExpiry(job, now));
}
