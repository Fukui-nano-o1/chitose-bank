import { appPhaseKey, entryWorkDays } from "../../lib/utils.js";

// 予定は求人ではなく、相手との応募1件。役割もURLに残し、再読込・戻るで面を変えない。
export const schedulePath = (role, applicationId) =>
  `/profile/${role === "farmer" ? "employer" : "worker"}/schedule/${applicationId}`;

export function readScheduleRoute(hash) {
  const match = String(hash || "").replace(/^#?\/?/, "")
    .match(/^profile\/(employer|worker)\/schedule\/([0-9a-f-]+)$/i);
  return match ? { role: match[1] === "employer" ? "farmer" : "worker", applicationId: match[2] } : null;
}

export const schedulePhase = entry => appPhaseKey({
  ...entry, status: entry.application_status,
});

export function upcomingSchedules(entries, role, now = Date.now()) {
  const japanDay = new Date(Number(now) + 9 * 60 * 60 * 1000);
  const today = japanDay.toISOString().slice(0, 10);
  japanDay.setUTCDate(japanDay.getUTCDate() + 7);
  const limit = japanDay.toISOString().slice(0, 10);
  return entries
    .filter(e => e.my_role === role && e.relation === "application" && e.application_id)
    .filter(e => ["applied", "approved", "meeting", "interview", "contracted", "working"].includes(e.application_status))
    .map(e => ({ ...e, next_date: [...entryWorkDays(e)].sort().find(d => d > today && d <= limit) }))
    .filter(e => e.next_date)
    .sort((a, b) => a.next_date.localeCompare(b.next_date) || (a.work_time || "").localeCompare(b.work_time || ""));
}
