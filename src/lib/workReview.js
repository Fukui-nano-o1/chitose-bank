// 仕事の評価は良い点5つ・悪い点5つ。未選択は否定として扱わない。
export const WORK_REVIEW_POINTS = [
  { key: 'as_described', category: '仕事内容', positive: '求人の内容どおりだった', negative: '求人の内容と違いがあった' },
  { key: 'instructions_clear', category: '説明・教え方', positive: '説明・教え方が分かりやすかった', negative: '説明・教え方が分かりにくかった' },
  { key: 'safety_care', category: '安全・休憩', positive: '安全や休憩への配慮があった', negative: '安全や休憩への配慮が足りなかった' },
  { key: 'paid_as_posted', category: '報酬', positive: '報酬が約束どおりだった', negative: '報酬が約束どおりではなかった' },
  { key: 'want_again', category: '次回の仕事', positive: 'またこの農家で働きたい', negative: 'また働きたいとは思わなかった' },
];

export function buildWorkReviewPayload({ app, meId, answers, unpaid }) {
  const fields = Object.fromEntries(WORK_REVIEW_POINTS.map(({ key }) => [
    key, answers[key] === 'positive' ? true : answers[key] === 'negative' ? false : null,
  ]));
  return {
    application_id: app.id, reviewer_id: meId, reviewee_id: app.farmer_id,
    direction: 'worker_to_farmer', ...fields,
    // 「違いがあった」から一部／大きい違いの程度は推測しない。
    match_level: fields.as_described === true ? 'matched' : null,
    // 報酬への不満と未払いは別。明示した時だけ既存の未払い申告を起票する。
    pay_status: fields.paid_as_posted === true ? 'paid' : fields.paid_as_posted === false ? (unpaid ? 'unpaid' : 'other') : null,
    want_again_choice: fields.want_again === true ? 'yes' : fields.want_again === false ? 'no' : null,
  };
}
