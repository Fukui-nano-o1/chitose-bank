import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseFetch } from '../src/lib/requestTransport.js';
import { moveCalendarJob } from '../src/lib/calendarMove.js';

const origin = 'https://fixture.supabase.co';
const before = { relation: 'own', job_number: 1307, date_start: '2026-09-20', date_end: null, holidays: [] };
const after = { ...before, date_start: '2026-09-21' };
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
function setup(fetchImpl) {
  const calls = [], reports = [];
  let verifying = 0;
  const client = createClient(origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: (url, options) => {
      const operation = new URL(url).pathname.split('/').pop();
      calls.push({ operation, body: options.body });
      return fetchImpl(operation, options);
    } }) },
  });
  return { calls, reports, client, verifying: () => verifying,
    run: () => moveCalendarJob(client, 1307, '2026-09-21', {
      onVerifying: () => { verifying++; }, report: detail => reports.push(detail),
    }) };
}

test('normal move performs one write and no verification read', async () => {
  const f = setup(() => response({ ok: true, date_start: after.date_start, date_end: null, delta_days: 1 }));
  const result = await f.run();
  assert.equal(result.data.ok, true); assert.equal(f.verifying(), 0);
  assert.deepEqual(f.calls.map(c => c.operation), ['move_job_dates']);
  assert.deepEqual(JSON.parse(f.calls[0].body), { p_job_number: 1307, p_new_start: '2026-09-21' });
});

test('committed move with a lost response is recovered by reading the calendar, never by repeating the write', async () => {
  let rows = [before];
  const f = setup(operation => {
    if (operation === 'move_job_dates') { rows = [after]; throw new TypeError('Load failed'); }
    return response(rows);
  });
  const result = await f.run();
  assert.equal(result.error, null); assert.equal(result.data.recovered, true);
  assert.deepEqual(result.calendarEntries, [after]); assert.equal(f.verifying(), 1);
  assert.deepEqual(f.calls.map(c => c.operation), ['move_job_dates', 'get_my_calendar_jobs']);
  assert.equal(f.reports[0].kind, 'noResponse'); assert.equal(f.reports[1].confirmed, true);
  assert.ok(!JSON.stringify(f.reports).includes('1307'));
});

test('unconfirmed move returns the fresh calendar without claiming success', async () => {
  const f = setup(operation => {
    if (operation === 'move_job_dates') throw new TypeError('Load failed');
    return response([before]);
  });
  const result = await f.run();
  assert.equal(result.status, 0); assert.ok(result.error); assert.ok(!result.data?.ok);
  assert.deepEqual(result.calendarEntries, [before]); assert.equal(f.calls.length, 2);
});

test('a row for another job or an application cannot confirm the owner move', async () => {
  for (const row of [{ ...after, job_number: 1308 }, { ...after, relation: 'application' }]) {
    const f = setup(operation => {
      if (operation === 'move_job_dates') throw new TypeError('Load failed');
      return response([row]);
    });
    assert.ok(!(await f.run()).data?.ok);
  }
});

test('business refusals and permission failures stay failures without a verification request', async () => {
  for (const result of [response({ ok: false, reason: 'has_applications' }),
    response({ ok: false, reason: 'past_date' }), response({ code: '42501', message: 'denied' }, 403)]) {
    const f = setup(() => result);
    assert.ok(!(await f.run()).data?.ok); assert.equal(f.calls.length, 1); assert.equal(f.verifying(), 0);
  }
});

test('a gateway error can be reconciled but does not cause a second write', async () => {
  const f = setup(operation => operation === 'move_job_dates'
    ? response({ code: 'PGRST003', message: 'pool timeout' }, 504) : response([after]));
  assert.equal((await f.run()).data.recovered, true);
  assert.equal(f.calls.filter(c => c.operation === 'move_job_dates').length, 1);
});

test('failed or malformed verification preserves the unknown write result and supplies no replacement calendar', async () => {
  for (const read of [() => response({ code: 'denied' }, 403), () => response(null), () => response({}), () => { throw new TypeError('Load failed'); }]) {
    const f = setup(operation => {
      if (operation === 'move_job_dates') throw new TypeError('Load failed');
      return read();
    });
    const result = await f.run();
    assert.ok(result.error); assert.ok(!result.data?.ok); assert.equal(result.calendarEntries, undefined);
    assert.equal(f.calls.filter(c => c.operation === 'move_job_dates').length, 1);
  }
});

test('client deadline is distinguishable and a committed move is recovered after timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup((operation, options) => operation === 'get_my_calendar_jobs' ? response([after])
    : new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })));
  const result = f.run(); await flush();
  t.mock.timers.tick(15000); await flush();
  assert.equal((await result).data.recovered, true);
  assert.equal(f.reports[0].kind, 'client_timeout'); assert.equal(f.calls.length, 2);
  t.mock.timers.tick(60000); await flush(); assert.equal(f.calls.length, 2);
});

test('verification has its own bounded timeout and leaves the write outcome unknown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup((operation, options) => {
    if (operation === 'move_job_dates') throw new TypeError('Load failed');
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const pending = f.run(); await flush(); assert.equal(f.verifying(), 1);
  t.mock.timers.tick(6000); await flush(); const result = await pending;
  assert.ok(result.error); assert.ok(!result.data?.ok); assert.equal(result.calendarEntries, undefined);
  t.mock.timers.tick(60000); await flush(); assert.equal(f.calls.length, 2);
});
