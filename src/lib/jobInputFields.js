// 求人入力の送信項目を分類する唯一の一覧。所有者・ID・公開状態は入力に含めない。
// 項目追加時はcodecとDBの許可列も照合する（DB制約をフロントから変更しない）。
export const JOB_INPUT_GROUPS = Object.freeze(Object.fromEntries(Object.entries({
  content: ["crop", "task", "notes", "belongings", "cautions"],
  location: ["zip", "prefecture", "city", "town", "address", "nearest_station", "commute_time"],
  schedule: ["date_label", "date_start", "date_end", "holidays", "work_time", "break_time"],
  pay: ["pay_type", "hourly_wage", "daily_wage"],
  conditions: ["headcount", "job_exp", "beginner_ok", "instant_approve_repeat", "perks", "experienced_preferred",
    "overtime_policy", "overtime_detail", "place_change_scope", "task_change_scope"],
  mediaAndSafety: ["danger_places", "danger_tasks", "photos"],
  video: ["work_video_url", "work_video_job_consent", "work_video_related_consent", "work_video_consent_at", "work_video_consent_version"],
  progress: ["draft_step"],
  geo: ["lat", "lng", "geo_radius_m", "geocoded_from"],
}).map(([group, fields]) => [group, Object.freeze(fields)])));

export const JOB_DRAFT_FIELDS = Object.freeze(Object.values(JOB_INPUT_GROUPS).flat());

// コピー時の入力契約。求人ごとの同意は引き継がず、URLを下書きに保管して再確認する。
const COPY_RESET = Object.freeze({date_label:'schedule',date_start:'schedule',date_end:'schedule',holidays:'schedule',
  work_video_job_consent:'consent',work_video_related_consent:'consent',work_video_consent_at:'consent',work_video_consent_version:'consent',draft_step:'review'});
export const JOB_COPY_POLICY = Object.freeze(Object.fromEntries(JOB_DRAFT_FIELDS.map(key => [key,COPY_RESET[key] || 'carry'])));
