import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPeriod, REVIEW_WINDOW_MS, reviewDeadlineLabel } from '../src/lib/reviewWindow.js';

test('review list window uses the final agreed workday, holidays and Japan time', () => {
  const app={agreed_dates:['2026-09-29','2026-09-24','2026-09-28']};
  const job={date_start:'2026-09-20',date_end:'2026-09-30',holidays:['2026-09-29'],work_time:'10:00〜12:00'};
  const at=Date.parse('2026-09-28T12:00:00+09:00');
  assert.equal(reviewPeriod(app,job,at-1).state,'not_started');
  assert.equal(reviewPeriod(app,job,at).state,'open');
  assert.equal(reviewPeriod(app,job,at+REVIEW_WINDOW_MS-1).state,'open');
  assert.equal(reviewPeriod(app,job,at+REVIEW_WINDOW_MS).state,'closed');
  assert.equal(reviewPeriod(app,job,at).opensAt,at);
  assert.match(reviewDeadlineLabel(at+REVIEW_WINDOW_MS),/10\/1.*12:00/);
});

test('a fixed review origin wins over edited dates and a later completion click', () => {
  const at=Date.parse('2026-09-24T12:00:00+09:00');
  const app={review_opened_at:new Date(at).toISOString(),work_completed_at:'2026-09-29T18:00:00+09:00',agreed_dates:['2026-10-01']};
  assert.equal(reviewPeriod(app,{work_time:'10:00〜12:00'},at+REVIEW_WINDOW_MS).state,'closed');
  assert.equal(reviewPeriod(app,{},at).opensAt,at);
});

test('missing schedules use recorded completion; unknown completion never allows submission', () => {
  const at=Date.parse('2026-09-29T09:00:00Z');
  assert.equal(reviewPeriod({work_completed_at:new Date(at).toISOString()},null,at).state,'open');
  assert.equal(reviewPeriod({},null,at).state,'unavailable');
  assert.equal(reviewPeriod({}, {date_start:'2026-09-29',work_time:'未定'},at).opensAt,Date.parse('2026-09-29T23:59:00+09:00'));
});
