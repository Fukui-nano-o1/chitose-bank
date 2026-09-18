// move_job_dates の成功応答から、表示中の自分の求人だけを先に移す。
// 休日は既存スナップショットをDBと同じ日数だけ移す。最新値は必ず後続の再取得で照合する。
const shiftDate = (ymd, delta) => {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const date = new Date(ymd + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== ymd) return null;
  date.setUTCDate(date.getUTCDate() + delta);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
};

export function applyConfirmedCalendarMove(entries, jobNumber, result) {
  if (!Array.isArray(entries) || !result?.ok || result.unchanged || !Number.isInteger(result.delta_days)) return entries;
  const delta = result.delta_days;
  const oldStart = shiftDate(result.date_start, -delta);
  const oldEnd = result.date_end === null ? null : shiftDate(result.date_end, -delta);
  if (!oldStart || (result.date_end !== null && !oldEnd)) return entries;
  if (result.date_end !== null && result.date_end < result.date_start) return entries;
  return entries.map(entry => {
    // 応募の合意日・過去の記録は書き換えない。手元の日程が古い／二重適用なら再取得に任せる。
    if (entry.relation !== "own" || entry.job_number !== jobNumber || entry.date_start !== oldStart
      || (entry.date_end || null) !== oldEnd) return entry;
    const holidays = Array.isArray(entry.holidays) ? entry.holidays.map(day => shiftDate(day, delta)) : entry.holidays;
    if (Array.isArray(holidays) && holidays.some(day => !day)) return entry;
    return { ...entry, date_start: result.date_start, date_end: result.date_end, holidays,
      ...(typeof result.date_label === "string" ? { date_label: result.date_label } : {}) };
  });
}
