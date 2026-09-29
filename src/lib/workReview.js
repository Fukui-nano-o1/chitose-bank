import { WORK_REVIEW_POINTS, workReviewTag } from './reviewCatalog.js';
export { WORK_REVIEW_POINTS } from './reviewCatalog.js';

export function buildWorkReviewPayload({ app, meId, answers, unpaid }) {
  const fields = Object.fromEntries(WORK_REVIEW_POINTS.filter(point => point.column).map(({ key }) => [
    key, answers[key] === 'positive' ? true : answers[key] === 'negative' ? false : null,
  ]));
  return {
    application_id: app.id, reviewer_id: meId, reviewee_id: app.farmer_id,
    direction: 'worker_to_farmer', ...fields,
    traits: WORK_REVIEW_POINTS.filter(point => !point.column && ['positive','negative'].includes(answers[point.key]))
      .map(point => workReviewTag(point.key, answers[point.key])),
    // 「違いがあった」から一部／大きい違いの程度は推測しない。
    match_level: fields.as_described === true ? 'matched' : null,
    // 報酬への不満と未払いは別。明示した時だけ既存の未払い申告を起票する。
    pay_status: fields.paid_as_posted === true ? 'paid' : fields.paid_as_posted === false ? (unpaid ? 'unpaid' : 'other') : null,
    want_again_choice: fields.want_again === true ? 'yes' : fields.want_again === false ? 'no' : null,
  };
}
