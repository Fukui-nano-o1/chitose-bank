import test from 'node:test';
import assert from 'node:assert/strict';
import { readScheduleRoute, schedulePath, schedulePhase, upcomingSchedules } from '../src/features/today/schedule.js';

const now = Date.parse('2026-09-23T18:48:00+09:00');
const row = {
  relation: 'application', my_role: 'farmer', application_id: '10000000-0000-4000-8000-000000000001',
  job_number: 1311, status: 'closed', application_status: 'approved',
  date_start: '2026-09-20', date_end: '2026-09-30', work_time: '10:00〜12:00',
  agreed_dates: ['2026-09-24', '2026-09-28'], available_dates: ['2026-09-25'], holidays: [],
};

test('upcoming uses each application’s actual next date, including already-started multi-day jobs', () => {
  const other = { ...row, application_id: '20000000-0000-4000-8000-000000000002', agreed_dates: ['2026-09-26'] };
  const result = upcomingSchedules([other, row], 'farmer', now);
  assert.deepEqual(result.map(e => [e.application_id, e.next_date]), [[row.application_id, '2026-09-24'], [other.application_id, '2026-09-26']]);
  assert.equal(row.next_date, undefined, 'do not mutate the shared calendar cache');
});

test('requested days and holidays agree with the calendar; terminal states, own jobs and other role are excluded', () => {
  const requested = { ...row, agreed_dates: [], available_dates: ['2026-09-24', '2026-09-25'], holidays: ['2026-09-24'] };
  const ineligible = ['completed', 'canceled', 'rejected', 'expired'].map(application_status => ({ ...row, application_status }));
  assert.deepEqual(upcomingSchedules([
    ...ineligible, { ...row, relation: 'own' }, { ...row, application_id: null }, { ...row, my_role: 'worker' },
    { ...row, agreed_dates: ['2026-09-23'] }, { ...row, agreed_dates: ['2026-10-01'] }, requested,
  ], 'farmer', now).map(e => e.next_date), ['2026-09-25']);
});

test('seven-day boundary is based on Japan time even when the device uses UTC', () => {
  const midnight = Date.parse('2026-09-23T15:00:00Z'); // 9/24 in Japan
  assert.equal(upcomingSchedules([{ ...row, agreed_dates: ['2026-09-24'] }], 'farmer', midnight).length, 0);
  assert.equal(upcomingSchedules([{ ...row, agreed_dates: ['2026-10-01'] }], 'farmer', midnight).length, 1);
});

test('job status does not override the application phase; approved alone is not hired', () => {
  assert.equal(schedulePhase(row), 'interview');
  assert.equal(schedulePhase({ ...row, terms_confirmed_worker_at: '2026-09-20', terms_confirmed_farmer_at: '2026-09-21' }), 'contracted');
  assert.equal(schedulePhase({ ...row, application_status: 'applied' }), 'applied');
});

test('schedule deep links preserve role and application identity', () => {
  for (const role of ['worker', 'farmer']) {
    const route = schedulePath(role, row.application_id);
    assert.deepEqual(readScheduleRoute('#' + route), { role, applicationId: row.application_id });
  }
  for (const route of ['/work/job/1311', '/profile/employer', '/profile/worker/schedule/', '/profile/admin/schedule/123']) {
    assert.equal(readScheduleRoute(route), null);
  }
});
