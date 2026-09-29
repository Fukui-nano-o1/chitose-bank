import { detailReviewTags } from '../../lib/reviewCatalog.js';
import { WORK_REVIEW_POINTS } from '../../lib/workReview.js';

const WORKER_LEGACY = { on_time: '時間を守っていた', completed_work: '仕事を完了した' };
const FARMER_LEGACY = { on_time: '時間を守っていた', followed_instructions: '指示どおりに作業した', entrust: '任せられた' };
export function reviewAnswers(review) {
  const positive = [], negative = [], other = [];
  if (review.direction === 'worker_to_farmer') {
    for (const point of WORK_REVIEW_POINTS) {
      if (review[point.key] === true) positive.push(point.positive);
      else if (review[point.key] === false) negative.push(point.negative);
    }
    for (const tag of Array.isArray(review.traits) ? review.traits : []) {
      const item = detailReviewTags(review.direction).find(option => option.v === tag);
      if (item) (item.negative ? negative : positive).push(item.l);
    }
    if (review.match_level === 'partly') other.push('求人との一致：一部違った');
    if (review.match_level === 'differed') other.push('求人との一致：大きく違った');
    if (review.pay_status === 'unpaid') other.push('未払いの申告あり');
    if (review.pay_status === 'other') other.push('報酬の回答：その他（未払いとは限りません）');
  } else {
    const outcome = { completed: '仕事の完了：予定どおり完了', partial: '仕事の完了：一部完了', not_completed: '仕事の完了：完了できなかった' }[review.work_outcome];
    if (outcome) other.push(outcome);
    else if (typeof review.completed_work === 'boolean') other.push(`仕事の完了（旧項目）：${review.completed_work ? 'はい' : 'いいえ'}`);
    const again = review.want_again_choice ?? (review.want_again === true ? 'yes' : review.want_again === false ? 'no' : null);
    if (again === 'yes') positive.push('またこの人と働きたい');
    if (again === 'no') negative.push('またこの人と働きたいとは思わなかった');
    for (const tag of Array.isArray(review.traits) ? review.traits : []) {
      const item = detailReviewTags(review.direction).find(option => option.v === tag);
      if (item) (item.negative ? negative : positive).push(item.l);
    }
  }
  if (review.want_again_choice === 'neutral') other.push('また働きたいか：どちらともいえない');
  const legacy = review.direction === 'worker_to_farmer' ? WORKER_LEGACY : FARMER_LEGACY;
  for (const [key, label] of Object.entries(legacy)) {
    if (typeof review[key] === 'boolean') other.push(`${label}（旧項目）：${review[key] ? 'はい' : 'いいえ'}`);
  }
  return { positive, negative, other };
}
