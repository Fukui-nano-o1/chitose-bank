// カレンダー上の日は時刻ではない。保存・通信では YYYY-MM-DD、UIだけローカルDate。
export function calendarDateToYmd(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarDateFromYmd(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  // 2/30などをDateの自動繰り上げで別の日にしない。
  return calendarDateToYmd(date) === value ? date : null;
}

export function restoreDraftCalendarDate(value, payloadDate) {
  if (!value) return null; // 消した入力を古いpayloadから復活させない。
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return calendarDateFromYmd(value);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  // 旧端末下書きのISO時刻より、同時保存された送信payloadの日付を優先する。
  // pending/baseは古い入力なので参照しない。匿名の旧下書きは保存元の時差を持たないため従来解釈を維持。
  const saved = calendarDateFromYmd(payloadDate);
  if (saved) return saved;
  const legacy = new Date(value);
  return Number.isFinite(legacy.getTime()) ? legacy : null;
}
