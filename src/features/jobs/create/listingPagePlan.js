// 全体の分割先契約。全ページ一括では有効化しない。
// 第3弾までの基本情報をlistingNavigation.jsに接続済み。詳細・確認の追加分割は未実施。
// 既存の値はそのまま移し、derived/preserved の項目に新しい入力を作らない。
import { legacyStepId } from "./flowSteps.js";
const page = (id, title, stage, formFields = [], columns = [], options = {}) => Object.freeze({
  id, title, stage, formFields: Object.freeze(formFields), columns: Object.freeze(columns), ...options,
});
export const SINGLE_TOPIC_PAGES = Object.freeze([
  page("intro", "求人の掲載", 0, [], [], { kind: "intro" }),
  page("crop", "作物", 0, ["farmerCropPill", "farmerCropText"], ["crop"]),
  page("task", "作業", 0, ["farmerTaskPill", "farmerTaskText"], ["task"]),
  page("task_scope", "作業の変更範囲", 0, ["taskChangeScope"], ["task_change_scope"]),
  page("workplace", "集合場所", 0, ["farmerZip", "farmerPref", "farmerCity", "farmerTown", "farmerAddr"], ["zip", "prefecture", "city", "town", "address"]),
  page("place_scope", "場所の変更範囲", 0, ["placeChangeScope"], ["place_change_scope"]),
  page("access", "アクセス", 0, ["nearestStation", "commuteTime"], ["nearest_station", "commute_time"], { optional: true }),
  page("schedule", "カレンダー", 0, ["jobDateStart", "jobDateEnd"], ["date_start", "date_end"]),
  page("holidays", "期間内の休日", 0, ["jobHolidays"], ["holidays"], { condition: "multi-day" }),
  page("headcount", "採用人数", 0, ["jobCount"], ["headcount"]),
  page("work_time", "勤務時間", 0, ["startHour", "startMinute", "endHour", "endMinute", "workTimeRaw"], ["work_time"]),
  page("break_time", "休憩時間", 0, ["breakTime"], ["break_time"]),
  page("overtime", "時間外労働", 0, ["overtimePolicy", "overtimeDetail"], ["overtime_policy", "overtime_detail"]),
  page("daily_wage", "日給", 0, ["dailyWageInput"], ["daily_wage"]),
  page("details_intro", "仕事の詳細", 1, [], [], { kind: "intro" }),
  page("description", "作業の説明", 1, ["jobDescription"], ["notes"], { optional: true }),
  page("photos", "写真の追加・並べ替え", 1, ["jobPhotos"], ["photos"], { optional: true }),
  page("photo_captions", "写真ごとの説明", 1, [], [], { condition: "has-photos", optional: true, edits: "jobPhotos[].caption", storageOwner: "photos" }),
  page("work_video", "YouTubeリンク", 1, ["workVideoUrl"], ["work_video_url"], { optional: true }),
  page("video_consent", "動画の利用同意", 1, ["workVideoJobConsent", "workVideoRelatedConsent", "workVideoConsentAt", "workVideoConsentVersion"], ["work_video_job_consent", "work_video_related_consent", "work_video_consent_at", "work_video_consent_version"], { condition: "has-video" }),
  page("danger_places", "危険な場所", 1, ["jobDangerPlaces"], ["danger_places"], { optional: true }),
  page("danger_tasks", "危険な作業", 1, ["jobDangerTasks"], ["danger_tasks"], { optional: true }),
  page("belongings", "持ち物", 1, ["jobNotes"], ["belongings"], { optional: true }),
  page("cautions", "注意事項", 1, ["jobCautions"], ["cautions"], { optional: true }),
  page("worker_preferences", "初心者歓迎・経験者優遇", 1, ["beginnerOk", "experiencedPreferred"], ["beginner_ok", "experienced_preferred"], { optional: true }),
  page("repeat_approval", "リピーターの自動承認", 1, ["instantApproveRepeat"], ["instant_approve_repeat"], { optional: true }),
  page("recruiter_name", "募集者の名称", 2, [], [], { condition: "recruiter-missing", externalField: "employer_profiles.recruiter_name" }),
  page("recruiter_address", "募集者の住所", 2, [], [], { condition: "recruiter-missing", externalField: "employer_profiles.recruiter_address" }),
  page("recruiter_contact", "募集者の連絡先", 2, [], [], { condition: "recruiter-missing", externalField: "employer_profiles.recruiter_contact" }),
  page("smoking_policy", "受動喫煙の状況", 2, [], [], { condition: "recruiter-missing", externalField: "employer_profiles.smoking_policy" }),
  page("review", "求人プレビュー", 2, [], [], { kind: "review" }),
  page("publish_consent", "掲載前の同意", 2, [], [], { kind: "consent", externalRecord: "job_publish_checks" }),
  page("complete", "掲載完了", 2, [], [], { kind: "complete" }),
]);
export const AUXILIARY_LISTING_PAGES = Object.freeze([
  page("past_photos", "過去の写真選択", 1, [], [], { parent: "photos", storageOwner: "photos" }),
  page("registered_workplace", "登録した作業場", 0, [], [], { parent: "workplace", externalRecord: "employer_profiles" }),
]);
export const NON_INPUT_COLUMNS = Object.freeze({
  date_label: "derived-from-schedule", pay_type: "fixed-daily-pay", hourly_wage: "fixed-empty",
  job_exp: "legacy-preserve", perks: "profile-inherited-preserve", draft_step: "legacy-progress-preserve",
  lat: "derived-geocode", lng: "derived-geocode", geo_radius_m: "derived-geocode", geocoded_from: "derived-geocode",
});
// draft_step_id は入力許可列ではなく比較元の一部。同期契約を変更・補完しない。
export const PRESERVED_SNAPSHOT_FIELDS = Object.freeze(["draft_step_id"]);
const targets = {
  intro: ["intro"], crop: ["crop"], task: ["task", "task_scope"],
  workplace: ["workplace", "place_scope", "access"], schedule: ["schedule", "holidays", "headcount"],
  terms: ["work_time", "break_time", "overtime", "daily_wage"], details_intro: ["details_intro"],
  photos: ["photos", "photo_captions"], description: ["description"], work_video: ["work_video", "video_consent"],
  danger: ["danger_places", "danger_tasks"], wishes: ["belongings", "cautions", "worker_preferences", "repeat_approval"],
  review: ["review"], complete: ["complete"],
};
export const LEGACY_PAGE_TARGETS = Object.freeze(Object.fromEntries(Object.entries(targets).map(([id, ids]) => [id, Object.freeze(ids)])));

// 再開先候補の解決だけを行う。データ移行や保存、入力済み判定はしない。
// 第2弾以降で既存の項目検査と接続し、未入力先へ案内する。未知形式を勝手に先頭へ送らない。
export function plannedResumeCandidates({ pageId, legacyStep, legacyVersion = "2026-10-05" } = {}) {
  const knownIds = [...SINGLE_TOPIC_PAGES, ...AUXILIARY_LISTING_PAGES].map(item => item.id);
  if (pageId !== undefined && pageId !== null && pageId !== "") return knownIds.includes(pageId) ? [pageId] : [];
  const legacyId = legacyStepId(legacyStep, legacyVersion);
  return [...(LEGACY_PAGE_TARGETS[legacyId] || [])];
}
