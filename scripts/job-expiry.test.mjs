import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isJobEnded, jobEndTimeMs, mapJobPublicRow } from '../src/lib/utils.js';
import { isSearchJobVisible, refreshJobExpiry, visibleSearchJobs } from '../src/lib/jobSearchVisibility.js';

const single = { date_start: '2026-09-22', date_end: null, work_time: '08:00〜17:00' };
const deadline = Date.parse('2026-09-22T17:00:00+09:00');

test('a single-day job ends at the exact work end, including when the DB status is still open', () => {
  const job = { ...single, status: 'open' };
  assert.equal(jobEndTimeMs(job), deadline);
  assert.equal(isJobEnded(job, deadline - 1), false);
  assert.equal(isJobEnded(job, deadline), true);
  assert.equal(isJobEnded(job, new Date(deadline + 1)), true);
});

test('a period job remains active until its final day ends', () => {
  const job = { ...single, date_start: '2026-09-01', date_end: '2026-09-25' };
  assert.equal(isJobEnded(job, '2026-09-22T20:00:00+09:00'), false);
  assert.equal(isJobEnded(job, '2026-09-25T16:59:59.999+09:00'), false);
  assert.equal(isJobEnded(job, '2026-09-25T17:00:00+09:00'), true);
});

test('raw rows and mapped cached rows use the same deadline and ignore frozen expired flags', () => {
  const cached = { dateStartRaw: single.date_start, dateEndRaw: '', workTime: single.work_time, expired: false };
  assert.equal(jobEndTimeMs(cached), jobEndTimeMs(single));
  assert.equal(isJobEnded(cached, deadline), true);
  assert.equal(isJobEnded({ ...cached, expired: true }, deadline - 1), false);
});

test('legacy Date and serialized Date cache entries recover the Japanese work day', () => {
  for (const start of [new Date('2026-09-21T15:00:00Z'), '2026-09-21T15:00:00.000Z', '2026-09-22']) {
    assert.equal(jobEndTimeMs({ dateStart: start, workTime: single.work_time }), deadline);
  }
  const oldPeriod = { dateStart: '2026-09-01T00:00:00Z', dateEnd: '2026-09-21T15:00:00.000Z', workTime: single.work_time };
  assert.equal(jobEndTimeMs(oldPeriod), deadline);
});

test('all stored work-time delimiters have the same exact ending instant', () => {
  for (const delimiter of ['〜', '～', '~', '-', '–']) {
    const job = { ...single, work_time: ` 8:00 ${delimiter} 17:00 ` };
    assert.equal(jobEndTimeMs(job), deadline, delimiter);
    assert.equal(isJobEnded(job, deadline), true, delimiter);
  }
});

test('missing or invalid work times keep the final date and expire at next Japanese midnight', () => {
  const midnight = Date.parse('2026-09-23T00:00:00+09:00');
  for (const work_time of [undefined, '', 'not-a-time', '08:00〜25:00', '08:00〜17:99', '99:00〜17:00']) {
    const job = { ...single, work_time };
    assert.equal(jobEndTimeMs(job), midnight);
    assert.equal(isJobEnded(job, midnight - 1), false);
    assert.equal(isJobEnded(job, midnight), true);
  }
});

test('midnight and month/year boundaries are evaluated in Japan time', () => {
  const job = { date_start: '2026-12-31' };
  assert.equal(isJobEnded(job, '2026-12-31T14:59:59.999Z'), false);
  assert.equal(isJobEnded(job, '2026-12-31T15:00:00.000Z'), true);
  const leap = { date_start: '2028-02-29' };
  assert.equal(isJobEnded(leap, '2028-02-29T15:00:00Z'), true);
});

test('unknown or invalid dates do not invent an expiry or throw', () => {
  for (const job of [null, {}, { expired: true }, { date_start: 'invalid' },
    { date_start: '2026-02-30' }, { date_start: '2026-13-01' },
    { dateStart: new Date(NaN) }, { dateStart: new Date(8640000000000000) }]) {
    assert.equal(jobEndTimeMs(job), null);
    assert.equal(isJobEnded(job, deadline), false);
  }
  assert.equal(isJobEnded(single, new Date(NaN)), false);
  assert.equal(isJobEnded(single, 'invalid'), false);
});

test('the public-row mapper delegates expiry and remains safe as an Array.map callback', t => {
  t.mock.timers.enable({ apis: ['Date'], now: deadline });
  const rows = [{ ...single, job_number: 1 }, { ...single, date_start: '2026-09-23', job_number: 2 }];
  const mapped = rows.map(mapJobPublicRow);
  assert.deepEqual(mapped.map(job => job.expired), [true, false]);
  assert.equal(mapped[0].expired, isJobEnded(mapped[0]));
});

test('browser/system time zones cannot change the Japanese job deadline', () => {
  const moduleUrl = new URL('../src/lib/utils.js', import.meta.url).href;
  const source = `import { isJobEnded, jobEndTimeMs } from ${JSON.stringify(moduleUrl)};
    const job = ${JSON.stringify(single)};
    process.stdout.write(JSON.stringify([jobEndTimeMs(job), isJobEnded(job, ${deadline - 1}), isJobEnded(job, ${deadline})]));`;
  for (const TZ of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), [deadline, false, true], TZ);
  }
});

test('discovery removes expired and closed jobs while retaining future filled jobs', () => {
  const mapped = { dateStartRaw: '2026-09-23', workTime: '08:00〜17:00', expired: false };
  const active = { ...mapped, id: 1 };
  const filled = { ...mapped, id: 2, filled: true };
  const expired = { ...mapped, id: 3, dateStartRaw: '2026-09-22' };
  const closed = { ...mapped, id: 4, closed: true };
  const closedRaw = { ...single, id: 5, date_start: '2026-09-23', status: 'closed' };
  const rows = [active, expired, filled, closed, closedRaw];
  const result = visibleSearchJobs(rows, deadline);
  assert.deepEqual(result.map(job => job.id), [1, 2]);
  assert.equal(result[0], active);
  assert.equal(result[1], filled);
  assert.equal(isSearchJobVisible(expired, deadline), false);
  assert.equal(isSearchJobVisible(null, deadline), false);
  assert.deepEqual(visibleSearchJobs(null, deadline), []);
  assert.equal(rows.length, 5);
  assert.equal(rows[1], expired);
  assert.equal(expired.expired, false);
});

test('cached expiry is refreshed in either direction without changing history objects', () => {
  const cached = Object.freeze({ ...single, expired: false });
  assert.equal(refreshJobExpiry(cached, deadline - 1), cached);
  const ended = refreshJobExpiry(cached, deadline);
  assert.notEqual(ended, cached);
  assert.equal(ended.expired, true);
  assert.equal(cached.expired, false);
  assert.equal(refreshJobExpiry(ended, deadline + 1), ended);

  const staleEarly = Object.freeze({ ...single, expired: true });
  const active = refreshJobExpiry(staleEarly, deadline - 1);
  assert.notEqual(active, staleEarly);
  assert.equal(active.expired, false);
  assert.equal(staleEarly.expired, true);
  const results = visibleSearchJobs([staleEarly], deadline - 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].expired, false);
  assert.equal(staleEarly.expired, true);
  assert.equal(refreshJobExpiry(null, deadline), null);
});
