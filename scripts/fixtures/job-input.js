// 本番データを使わない独立した保存契約の例。44列をすべて明示する。
export const jobInputSample = () => ({
  crop: 'ブロッコリー', task: '収穫', zip: '0123456', prefecture: '徳島県', city: '吉野川市', town: '山川町', address: '123番地',
  date_label: '12/1（火） 〜 5（土）', date_start: '2026-12-01', date_end: '2026-12-05', holidays: ['2026-12-02'], headcount: 3,
  pay_type: '日給', hourly_wage: '', daily_wage: '12000', work_time: '9:15〜17:45', break_time: '60分', nearest_station: '山瀬', commute_time: '10分',
  job_exp: '経験あり', beginner_ok: true, instant_approve_repeat: false, experienced_preferred: true,
  perks: {has_transport: true, transport_area: '駅前', has_parking: true, parking_capacity: 0,
    has_commute_allowance: false, commute_allowance_detail: '', has_bonus: false, bonus_detail: '',
    has_raise: true, raise_detail: '経験に応じて', has_severance_pay: false, severance_detail: '',
    employer_pays_supplies: true, supplies_cap: '1000円', accessory_ok: false},
  notes: '作業の説明\n二行目', belongings: '長靴', cautions: '雨天注意', overtime_policy: 'あり', overtime_detail: '30分',
  place_change_scope: '登録圃場', task_change_scope: '選別も含む',
  danger_places: [{icon: '⚠️', label: '水路', desc: '足元注意', photos: [{url: 'https://example.invalid/danger.jpg'}]}],
  danger_tasks: [{icon: '⚠️', label: '刃物', desc: '手袋', photos: []}],
  photos: [{url: 'https://example.invalid/full.jpg', thumb: 'https://example.invalid/thumb.jpg', caption: '説明'},
    {url: 'https://example.invalid/second.jpg', caption: ''}],
  work_video_url: 'https://www.youtube.com/watch?v=abcdefghijk', work_video_job_consent: true, work_video_related_consent: false,
  work_video_consent_at: '2026-10-16T00:00:00+00:00', work_video_consent_version: '2026-10-05-v1', draft_step: 12,
  lat: 34.05, lng: 134.2, geo_radius_m: 1500, geocoded_from: '徳島県吉野川市山川町',
});
export const jobInputOptions = {cropOptions: [{name: 'ブロッコリー'}], taskOptions: [{name: '収穫'}]};
