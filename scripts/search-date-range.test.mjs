// さがすの「いつする？」＝カレンダーの範囲指定の純粋関数を機械検算する（2026-09-27）。
// タップの規則（1回目＝始まり・2回目＝終わり・3回目で始まりに戻るループ）と、求人の日程との重なり判定。
// UIは持ち込まない＝model.js だけを読む（React/DOM/Supabase 非依存の層）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDateRange, normalizeDateRange, jobInDateRange, dateRangeLabel } from '../src/features/jobs/search/model.js';

test('pickDateRange：1回目＝始まり・2回目＝終わり・3回目で始まりに戻る（ループ）', () => {
  const r1 = pickDateRange(null, '2026-09-10');
  assert.deepEqual(r1, { start: '2026-09-10', end: null });
  const r2 = pickDateRange(r1, '2026-09-20');
  assert.deepEqual(r2, { start: '2026-09-10', end: '2026-09-20' });
  const r3 = pickDateRange(r2, '2026-10-01');
  assert.deepEqual(r3, { start: '2026-10-01', end: null });
});

test('pickDateRange：始まりより前の日を2回目にタップしたら入れ替える・同じ日なら1日だけ', () => {
  assert.deepEqual(pickDateRange({ start: '2026-09-10', end: null }, '2026-09-03'), { start: '2026-09-03', end: '2026-09-10' });
  assert.deepEqual(pickDateRange({ start: '2026-09-10', end: null }, '2026-09-10'), { start: '2026-09-10', end: '2026-09-10' });
});

test('pickDateRange / normalizeDateRange：壊れた入力で落ちない・逆転は直す', () => {
  assert.equal(pickDateRange(null, 'abc'), null);
  assert.deepEqual(pickDateRange({ start: '2026-09-10', end: null }, undefined), { start: '2026-09-10', end: null });
  assert.equal(normalizeDateRange({ start: 'x' }), null);
  assert.equal(normalizeDateRange('2026-09-10'), null);
  assert.deepEqual(normalizeDateRange({ start: '2026-09-20', end: '2026-09-10' }), { start: '2026-09-10', end: '2026-09-20' });
  assert.deepEqual(normalizeDateRange({ start: '2026-09-10', end: 7 }), { start: '2026-09-10', end: null });
});

test('jobInDateRange：求人の日程と範囲が1日でも重なれば残る', () => {
  const job = { dateStartRaw: '2026-09-11', dateEndRaw: '2026-09-15' };
  const R = (start, end = null) => ({ start, end });
  assert.equal(jobInDateRange(job, R('2026-09-01', '2026-09-10')), false); // 前に終わる
  assert.equal(jobInDateRange(job, R('2026-09-15', '2026-09-30')), true);  // 最終日で重なる
  assert.equal(jobInDateRange(job, R('2026-09-01', '2026-09-11')), true);  // 初日で重なる
  assert.equal(jobInDateRange(job, R('2026-09-16', '2026-09-30')), false); // 後に始まる
  assert.equal(jobInDateRange(job, R('2026-09-12', '2026-09-13')), true);  // 中に収まる
  assert.equal(jobInDateRange(job, R('2026-09-01', '2026-09-30')), true);  // 包む
});

test('jobInDateRange：始まりだけの間は「その日以降に日程がある求人」・単日求人・指定なし・日程なし', () => {
  const single = { dateStartRaw: '2026-09-12', dateEndRaw: null };
  assert.equal(jobInDateRange(single, { start: '2026-09-12', end: null }), true);
  assert.equal(jobInDateRange(single, { start: '2026-09-13', end: null }), false);
  assert.equal(jobInDateRange({ dateStartRaw: '2026-12-01', dateEndRaw: '2026-12-05' }, { start: '2026-09-13', end: null }), true);
  assert.equal(jobInDateRange(single, null), true);            // 指定なし＝全部残る
  assert.equal(jobInDateRange({}, { start: '2026-09-13', end: null }), false); // 日程の無い求人は範囲に合わない
});

test('dateRangeLabel：9/10〜9/20・9/10〜・9/10・指定なしは空', () => {
  assert.equal(dateRangeLabel({ start: '2026-09-10', end: '2026-09-20' }), '9/10〜9/20');
  assert.equal(dateRangeLabel({ start: '2026-09-10', end: null }), '9/10〜');
  assert.equal(dateRangeLabel({ start: '2026-09-10', end: '2026-09-10' }), '9/10');
  assert.equal(dateRangeLabel(null), '');
});
