import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConfirmedCalendarMove as apply } from '../src/lib/calendarUpdates.js';

const entry = { relation: 'own', job_number: 1, date_start: '2028-02-28', date_end: '2028-03-01', holidays: ['2028-02-29'], crop: 'fixture' };
const result = { ok: true, date_start: '2028-03-02', date_end: '2028-03-04', delta_days: 3, date_label: '3/2〜3/4' };

test('confirmed move shifts the cached holiday across leap day and preserves other fields', () => {
  const [moved] = apply([entry], 1, result);
  assert.deepEqual(moved, { ...entry, date_start: '2028-03-02', date_end: '2028-03-04', holidays: ['2028-03-03'], date_label: '3/2〜3/4' });
  assert.equal(entry.date_start, '2028-02-28');
  assert.deepEqual(entry.holidays, ['2028-02-29']);
});

test('single-day moves retain null end dates and do not depend on local DST', () => {
  const single = { ...entry, date_start: '2026-03-08', date_end: null, holidays: [] };
  const [moved] = apply([single], 1, { ok: true, date_start: '2026-03-07', date_end: null, delta_days: -1 });
  assert.equal(moved.date_start, '2026-03-07');
  assert.equal(moved.date_end, null);
  assert.deepEqual(moved.holidays, []);
});

test('stale snapshots and repeated results are left for authoritative revalidation', () => {
  const wrongStart = { ...entry, date_start: '2028-02-27' };
  const wrongEnd = { ...entry, date_end: '2028-03-02' };
  assert.equal(apply([wrongStart], 1, result)[0], wrongStart);
  assert.equal(apply([wrongEnd], 1, result)[0], wrongEnd);
  const first = apply([entry], 1, result);
  assert.equal(apply(first, 1, result)[0], first[0]);
});

test('failed, incomplete or malformed server results cannot invent calendar dates', () => {
  const rows = [entry];
  for (const response of [{ ok: false }, { ok: true, unchanged: true }, { ok: true },
    { ...result, delta_days: 0.5 }, { ...result, date_start: '2028-02-31' },
    { ...result, date_end: undefined }, { ...result, date_end: '2028-02-01' }]) {
    assert.deepEqual(apply(rows, 1, response), rows);
  }
  const invalidHoliday = { ...entry, holidays: ['not-a-date'] };
  assert.equal(apply([invalidHoliday], 1, result)[0], invalidHoliday);
});

test('unrelated jobs, applications and agreed dates are never shifted as an own job', () => {
  const application = { ...entry, relation: 'application', agreed_dates: ['2028-02-28'] };
  const other = { ...entry, job_number: 2 };
  const moved = apply([entry, application, other], 1, result);
  assert.equal(moved[1], application); assert.equal(moved[2], other);
});

test('successive committed moves use the latest snapshot, not the original dates', () => {
  const first = apply([entry], 1, result);
  const second = apply(first, 1, { ok: true, date_start: '2028-03-05', date_end: '2028-03-07', delta_days: 3 });
  assert.equal(second[0].date_start, '2028-03-05');
  assert.deepEqual(second[0].holidays, ['2028-03-06']);
  assert.equal(apply(second, 1, result)[0], second[0]);
});
