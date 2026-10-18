// 画面の入力・端末保存形式・DB列の変換。React、Storage、通信を呼ばない。
// DBの許可列はlib/jobInputFields、端末保存はdeviceDrafts、同期管理はofflineSyncが担当する。
import { calendarDateFromYmd, calendarDateToYmd } from "../../../lib/calendarDate.js";
import { normalizePhotos, dangerHasSecond } from "./model.js";

// 単純な文字列項目は同じ対応表を両方向に使う。notesとbelongingsの取り違えもここで防ぐ。
const TEXT_FIELDS = {
  farmerZip: "zip", farmerPref: "prefecture", farmerCity: "city", farmerTown: "town", farmerAddr: "address",
  dailyWageInput: "daily_wage", breakTime: "break_time", nearestStation: "nearest_station", commuteTime: "commute_time",
  jobExp: "job_exp", jobDescription: "notes", jobNotes: "belongings", jobCautions: "cautions",
};
const BOOLEAN_FIELDS = {
  beginnerOk: "beginner_ok", instantApproveRepeat: "instant_approve_repeat", experiencedPreferred: "experienced_preferred",
};

export const digitsOnly = value => String(value ?? "").replace(/[^0-9]/g, "");
export const wageAmount = value => Number(digitsOnly(value)) || 0;
export const selectionValue = (selected, text) => selected === "__other__" ? text.trim() : (text.trim() || selected);
const validPart = (value, max) => /^\d{1,2}$/.test(String(value ?? "")) && Number(value) <= max;
export const hasWorkTime = form => validPart(form.startHour, 23) && validPart(form.endHour, 23) && validPart(form.startMinute, 59) && validPart(form.endMinute, 59);
export const workDurationHours = form => hasWorkTime(form) ? Number(form.endHour) + Number(form.endMinute) / 60 - Number(form.startHour) - Number(form.startMinute) / 60 : 0;
export const workTimeLabel = form => form.workTimeRaw !== undefined ? form.workTimeRaw : hasWorkTime(form) ? `${form.startHour}:${form.startMinute}〜${form.endHour}:${form.endMinute}` : null;
export function parseWorkTime(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})\s*[〜～~–—-]\s*(\d{1,2}):(\d{2})$/);
  const parts = match ? { startHour: match[1], startMinute: match[2], endHour: match[3], endMinute: match[4] } : {};
  return hasWorkTime(parts) ? parts : { startHour: "", startMinute: "", endHour: "", endMinute: "" };
}

export function dateLabel(start, finish, now = new Date()) {
  if (!start) return "日程を選択してください";
  const end = finish || start;
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const format = (date, { omitYear = false, omitYearMonth = false } = {}) => {
    const day = `${date.getDate()}（${days[date.getDay()]}）`;
    if (omitYearMonth) return day;
    return `${omitYear ? "" : date.getFullYear() + "/"}${date.getMonth() + 1}/${day}`;
  };
  const inYear = start.getFullYear() === now.getFullYear() && end.getFullYear() === now.getFullYear();
  if (start.toDateString() === end.toDateString()) return format(start, { omitYear: inYear });
  const sameMonth = inYear && start.getMonth() === end.getMonth();
  return `${format(start, { omitYear: inYear })} 〜 ${format(end, sameMonth ? { omitYearMonth: true } : { omitYear: inYear })}`;
}

// 未入力・false・空配列を消さない。Dateだけを端末保存用の日付文字列にする。
export function serializeJobForm(form) {
  return { ...form, jobDateStart: calendarDateToYmd(form.jobDateStart), jobDateEnd: calendarDateToYmd(form.jobDateEnd) };
}

export function jobFormFromRow(row, { cropOptions, taskOptions }) {
  const selected = (value, options) => options.some(option => option.name === value) ? value : value ? "__other__" : "";
  const places = (row.danger_places ?? []).map(item => ({ photos: [], ...item }));
  const tasks = (row.danger_tasks ?? []).map(item => ({ photos: [], ...item }));
  const emptyDanger = () => [{ icon: "⚠️", label: "", desc: "", photos: [] }, { icon: "⚠️", label: "", desc: "", photos: [] }];

  return {
    ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([formKey, column]) => [formKey, row[column] ?? ""])),
    ...Object.fromEntries(Object.entries(BOOLEAN_FIELDS).map(([formKey, column]) => [formKey, !!row[column]])),
    farmerCropPill: selected(row.crop, cropOptions), farmerCropText: row.crop ?? "",
    farmerTaskPill: selected(row.task, taskOptions), farmerTaskText: row.task ?? "",
    farmerRegion: (row.prefecture ?? "") + (row.city ?? "") + (row.town ?? ""),
    jobDateStart: calendarDateFromYmd(row.date_start), jobDateEnd: calendarDateFromYmd(row.date_end),
    jobCount: row.headcount != null ? String(row.headcount) : "",
    farmerPayType: row.pay_type ?? "", hourlyWageInput: row.hourly_wage ?? "",
    // Preserve the original DB value until the user edits the time controls.
    // Blank or unparseable rows must never inherit the new-job default hours.
    workTimeRaw: row.work_time ?? null, ...parseWorkTime(row.work_time),
    jobPerks: row.perks || null,
    workVideoUrl: row.work_video_url ?? "", workVideoJobConsent: !!row.work_video_job_consent,
    workVideoRelatedConsent: !!row.work_video_related_consent,
    workVideoConsentAt: row.work_video_consent_at ?? null, workVideoConsentVersion: row.work_video_consent_version ?? null,
    overtimePolicy: row.overtime_policy ?? "", overtimeDetail: row.overtime_detail ?? "",
    placeChangeScope: row.place_change_scope ?? "変更なし", taskChangeScope: row.task_change_scope ?? "変更なし",
    jobDangerPlaces: places.length ? places : emptyDanger(), jobDangerTasks: tasks.length ? tasks : emptyDanger(),
    showPlace2: dangerHasSecond(places), showTask2: dangerHasSecond(tasks),
    jobPhotos: normalizePhotos(row.photos), jobHolidays: Array.isArray(row.holidays) ? row.holidays : [],
    farmerStep: row.draft_step != null ? row.draft_step : 12,
  };
}

export function jobPayloadFromForm(form, { ownerId, status = "pending", base = null, geo = null, now = new Date() }) {
  if (!geo && base && base.prefecture === form.farmerPref && base.city === form.farmerCity && base.town === form.farmerTown) {
    geo = { lat: base.lat, lng: base.lng, radius: base.geo_radius_m, from: base.geocoded_from };
  }
  const video = form.workVideoUrl.trim();
  return {
    ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([formKey, column]) => [column, form[formKey]])),
    ...Object.fromEntries(Object.entries(BOOLEAN_FIELDS).map(([formKey, column]) => [column, form[formKey]])),
    farmer_id: ownerId, status,
    crop: selectionValue(form.farmerCropPill, form.farmerCropText),
    task: selectionValue(form.farmerTaskPill, form.farmerTaskText),
    date_label: dateLabel(form.jobDateStart, form.jobDateEnd, now),
    date_start: calendarDateToYmd(form.jobDateStart), date_end: calendarDateToYmd(form.jobDateEnd),
    holidays: form.jobHolidays, headcount: Number(form.jobCount) || null,
    pay_type: "日給", hourly_wage: "", // 既存の固定ポリシー。旧時給の隠れ値を送らない。
    work_time: workTimeLabel(form), perks: form.jobPerks,
    work_video_url: video || null,
    work_video_job_consent: video ? form.workVideoJobConsent : null,
    work_video_related_consent: video ? form.workVideoRelatedConsent : null,
    work_video_consent_at: video && form.workVideoJobConsent ? (form.workVideoConsentAt || now.toISOString()) : null,
    work_video_consent_version: video && form.workVideoJobConsent ? (form.workVideoConsentVersion || "2026-10-05-v1") : null,
    overtime_policy: form.overtimePolicy || null,
    overtime_detail: form.overtimePolicy === "あり" ? form.overtimeDetail.trim() : "",
    place_change_scope: form.placeChangeScope || null, task_change_scope: form.taskChangeScope || null,
    danger_places: form.jobDangerPlaces, danger_tasks: form.jobDangerTasks, photos: form.jobPhotos,
    draft_step: form.farmerStep,
    lat: geo ? geo.lat : null, lng: geo ? geo.lng : null,
    geo_radius_m: geo ? geo.radius : null, geocoded_from: geo ? geo.from : null,
  };
}
