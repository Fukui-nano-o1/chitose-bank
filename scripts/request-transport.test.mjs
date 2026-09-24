import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseFetch } from '../src/lib/requestTransport.js';

const origin = 'https://fixture.supabase.co';
const rest = origin + '/rest/v1/';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const abort = error => error?.name === 'AbortError';
function backend() {
  const calls = [];
  let active = 0, peak = 0;
  const fetchImpl = (url, options) => new Promise((resolve, reject) => {
    active++; peak = Math.max(peak, active);
    const call = { url, options, done: false };
    const finish = (value, failed = false) => {
      if (call.done) return;
      call.done = true; active--;
      options.signal?.removeEventListener('abort', onAbort);
      if (failed) reject(value); else resolve(value);
    };
    const onAbort = () => finish(options.signal.reason, true);
    call.respond = (status = 200, body = '[]', headers = {}) => finish(new Response(
      options.method === 'HEAD' || status === 204 ? null : body, { status, headers }
    ));
    call.fail = error => finish(error, true);
    calls.push(call);
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
  });
  return { calls, fetchImpl, get peak() { return peak; }, get active() { return active; } };
}
async function drain(server, expected) {
  for (let round = 0; round < expected + 2; round++) {
    await flush();
    server.calls.filter(c => !c.done).forEach(c => c.respond());
    await flush();
    if (server.calls.length === expected && server.active === 0) return;
  }
  assert.fail('request queue did not drain');
}

test('optional analytics cannot occupy the reserved application/save slot under a read burst', async () => {
  const server = backend();
  const fetch = createSupabaseFetch({ supabaseUrl:origin, fetchImpl:server.fetchImpl });
  const reads = [1,2,3].map(n => fetch(rest + 'jobs?part=' + n));
  await flush();
  const telemetry = fetch(rest + 'product_events', { method:'POST', body:'[]' });
  await flush();
  assert.equal(server.calls.length,3,'analytics waits when background/read slots are full');
  const application = fetch(rest + 'rpc/apply_to_job', { method:'POST', body:'{}' });
  await flush();
  assert.equal(server.calls.length,4);
  assert.match(server.calls[3].url,/apply_to_job$/);
  await drain(server,5); await Promise.all([...reads,telemetry,application]);
});

// 実際のブラウザーでは、本文のない応答でも body が空のストリームになる場合がある。
// new Response(null, { status: 204 }) だけではこの条件を再現できない。
function emptyStreamResponse(status, headers = {}) {
  const response = new Response('', { headers });
  Object.defineProperty(response, 'status', { value: status });
  return response;
}

test('HTTP no-body responses stay bodyless even when the browser exposes an empty stream', async () => {
  for (const [method, status] of [['PATCH', 204], ['POST', 205], ['GET', 304], ['HEAD', 200]]) {
    let calls = 0;
    const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async () => {
      calls++;
      return emptyStreamResponse(status, { 'Content-Range': '*/2', 'X-Fixture': 'preserved' });
    } });
    const response = await send(rest + 'jobs', { method });
    assert.equal(response.status, status);
    assert.equal(response.body, null);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('Content-Range'), '*/2');
    assert.equal(response.headers.get('X-Fixture'), 'preserved');
    assert.equal(calls, 1);
  }
});

test('installed SDK accepts draft updates and publication checks with empty-stream 204 responses', async () => {
  const requests = [];
  const client = createClient(origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async (input, options) => {
      requests.push({ url: new URL(input), method: options.method, body: JSON.parse(options.body) });
      return emptyStreamResponse(204);
    } }) },
  });
  const draft = await client.from('jobs').update({ status: 'draft', crop: 'fixture crop' })
    .eq('job_number', 99999).eq('farmer_id', 'fixture-owner');
  assert.equal(draft.error, null);
  assert.equal(draft.status, 204);
  const check = await client.from('job_publish_checks').insert({ job_number: 99999, farmer_id: 'fixture-owner' });
  assert.equal(check.error, null);
  assert.equal(check.status, 204);
  assert.equal(requests.length, 2, 'successful writes must not be resent');
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].url.searchParams.get('job_number'), 'eq.99999');
  assert.equal(requests[0].url.searchParams.get('farmer_id'), 'eq.fixture-owner');
  assert.equal(requests[0].body.status, 'draft');
  assert.equal(requests[1].url.pathname, '/rest/v1/job_publish_checks');
});

// 同じ通信窓口を使う求人以外の保存と、本文を返さない他の操作も公開前に確認する。
for (const { name, status, method, path, run } of [
  { name: 'privacy agreement update', status: 204, method: 'PATCH', path: 'account_holders',
    run: client => client.from('account_holders').update({ agreed_privacy_version: 'fixture-version' }).eq('auth_id', 'fixture-owner') },
  { name: 'employer profile upsert', status: 201, method: 'POST', path: 'employer_profiles',
    run: client => client.from('employer_profiles').upsert({ auth_id: 'fixture-owner', nickname: 'fixture' }, { onConflict: 'auth_id' }) },
  { name: 'draft deletion', status: 204, method: 'DELETE', path: 'jobs',
    run: client => client.from('jobs').delete().eq('job_number', 99999).eq('farmer_id', 'fixture-owner') },
  { name: 'void RPC', status: 204, method: 'POST', path: 'rpc/fixture_void_action',
    run: client => client.rpc('fixture_void_action', { p_id: 99999 }) },
]) {
  test(`SDK completes ${name} with an empty-stream response and no duplicate write`, async () => {
    const calls = [];
    const client = createClient(origin, 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return emptyStreamResponse(status);
      } }) },
    });
    const result = await run(client);
    assert.equal(result.error, null);
    assert.equal(result.status, status);
    assert.equal(result.data, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, method);
    assert.equal(new URL(calls[0].url).pathname, '/rest/v1/' + path);
  });
}

test('SDK HEAD counts retain zero and nonzero totals when the browser exposes an empty stream', async () => {
  for (const count of [0, 2]) {
    let calls = 0;
    const client = createClient(origin, 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async (_url, options) => {
        calls++;
        assert.equal(options.method, 'HEAD');
        return emptyStreamResponse(200, { 'Content-Range': `*/${count}` });
      } }) },
    });
    const result = await client.from('applications').select('id', { count: 'exact', head: true }).eq('job_number', 99999);
    assert.equal(result.error, null);
    assert.equal(result.count, count);
    assert.equal(result.data, null);
    assert.equal(calls, 1);
  }
});

test('a read burst has three active requests; all queued reads eventually receive their own response', async () => {
  const server = backend();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl });
  const pending = Array.from({ length: 20 }, (_, i) => send(rest + 'jobs_public?fixture=' + i));
  await flush(); assert.equal(server.calls.length, 3);
  await drain(server, 20);
  assert.equal(server.peak, 3);
  assert.equal(new Set(server.calls.map(c => c.url)).size, 20);
  assert.equal((await Promise.all(pending)).length, 20);
});

test('read RPCs share the read limit; writes get the reserved slot and preserve payload and headers', async () => {
  const server = backend();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl });
  const reads = Array.from({ length: 6 }, () => send(rest + 'rpc/my_farm_jobs', { method: 'POST', body: '{}' }));
  await flush(); assert.equal(server.calls.length, 3);
  const payload = JSON.stringify({ p_job_number: 100 });
  const write = send(rest + 'rpc/copy_job', { method: 'POST', body: payload, headers: { Authorization: 'Bearer fixture' } });
  await flush(); assert.equal(server.calls.length, 4);
  assert.equal(server.calls[3].url, rest + 'rpc/copy_job');
  assert.equal(server.calls[3].options.body, payload);
  assert.equal(server.calls[3].options.headers.Authorization, 'Bearer fixture');
  await drain(server, 7); await Promise.all([...reads, write]);
  assert.equal(server.peak, 4);
});

test('waiting mutations keep arrival order and run before waiting reads', async () => {
  const server = backend();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl });
  const pending = Array.from({ length: 4 }, (_, i) => send(rest + 'rpc/action_' + i, { method: 'POST' }));
  pending.push(send(rest + 'jobs_public'));
  pending.push(send(rest + 'rpc/action_4', { method: 'POST' }));
  pending.push(send(rest + 'rpc/action_5', { method: 'POST' }));
  await flush(); assert.equal(server.calls.length, 4);
  server.calls[0].respond(); await flush(); assert.ok(server.calls[4].url.endsWith('action_4'));
  server.calls[1].respond(); await flush(); assert.ok(server.calls[5].url.endsWith('action_5'));
  await drain(server, 7); await Promise.all(pending);
});

test('auth, storage, and other hosts bypass the REST queue', async () => {
  const server = backend();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl });
  const pending = Array.from({ length: 3 }, () => send(rest + 'jobs_public'));
  const urls = [origin + '/auth/v1/token', origin + '/storage/v1/object/photo', 'https://elsewhere.invalid/rest/v1/jobs'];
  pending.push(...urls.map(url => send(url, { method: 'POST' })));
  await flush(); assert.equal(server.calls.length, 6);
  assert.deepEqual(server.calls.filter(c => urls.includes(c.url)).map(c => c.url), urls);
  await drain(server, 6); await Promise.all(pending);
});

test('auth deadlines include response bodies and combine with an existing caller signal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caller = new AbortController();
  let signal;
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } }));
  } });
  const request = assert.rejects(send(origin + '/auth/v1/otp', { method: 'POST', signal: caller.signal }), abort);
  await flush();
  t.mock.timers.tick(15000);
  await request;
  assert.equal(signal.aborted, true);
  assert.equal(caller.signal.aborted, false);
});

test('the installed Auth SDK finishes a stalled OTP request without automatic resend', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'error', () => {}); // SDK reports the expected simulated network abort.
  const server = backend();
  const client = createClient(origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl }) },
  });
  const result = client.auth.signInWithOtp({ email: 'person@fixture.test', options: { shouldCreateUser: false } });
  await flush();
  assert.equal(server.calls.length, 1);
  t.mock.timers.tick(15000);
  assert.ok((await result).error);
  assert.equal(server.calls.length, 1);
  assert.ok(server.calls[0].url.endsWith('/auth/v1/otp'));
});

test('cancelled queued calls are removed and never sent; other calls still finish', async () => {
  const server = backend();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl });
  const pending = Array.from({ length: 3 }, () => send(rest + 'jobs_public'));
  const controller = new AbortController();
  const canceled = assert.rejects(send(rest + 'private?fixture=canceled', { signal: controller.signal }), abort);
  controller.abort(); await canceled;
  const preCanceled = new AbortController(); preCanceled.abort();
  await assert.rejects(send(rest + 'never', { signal: preCanceled.signal }), abort);
  await drain(server, 3); await Promise.all(pending);
  assert.equal(server.calls.length, 3);
});

test('the queue is bounded and saturation does not occupy the reserved action slot', async () => {
  const server = backend();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl, maxQueued: 2 });
  const pending = Array.from({ length: 5 }, () => send(rest + 'jobs_public'));
  await assert.rejects(send(rest + 'overflow'), abort);
  pending.push(send(rest + 'rpc/approve_application', { method: 'POST' }));
  await flush(); assert.equal(server.calls.length, 4);
  await drain(server, 6); await Promise.all(pending);
});

test('deadline covers queue time, removes expired requests and allows later recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = backend();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl });
  const pending = Array.from({ length: 8 }, () => assert.rejects(send(rest + 'jobs_public'), abort));
  await flush(); assert.equal(server.calls.length, 3);
  t.mock.timers.tick(15000); await Promise.all(pending);
  assert.equal(server.calls.length, 3); assert.equal(server.active, 0);
  const recovered = send(rest + 'jobs_public'); await flush(); server.calls[3].respond();
  assert.equal((await recovered).status, 200);
});

test('caller cancellation still works for an in-flight request and releases its slot', async () => {
  const server = backend(); const controller = new AbortController();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl, maxConcurrent: 1, maxReads: 1 });
  const first = assert.rejects(send(rest + 'jobs_public', { signal: controller.signal }), abort);
  const next = send(rest + 'jobs_public'); await flush();
  controller.abort(new DOMException('caller deadline', 'TimeoutError')); await first; await flush();
  assert.equal(server.calls.length, 2); server.calls[1].respond(); await next;
});

test('deadline remains active after headers arrive while response body is still pending', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } }));
  } });
  const request = assert.rejects(send(rest + 'jobs_public'), abort);
  await flush(); t.mock.timers.tick(15000); await request;
  assert.equal(signal.aborted, true);
});

test('Request inputs retain headers, status, body and caller cancellation', async () => {
  const controller = new AbortController();
  const request = new Request(rest + 'jobs_public', { headers: { 'X-Fixture': 'yes' }, signal: controller.signal });
  let seen;
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async (input, options) => {
    seen = { input, options };
    return new Response('[1,2]', { status: 206, headers: { 'Content-Range': '0-1/2' } });
  } });
  const response = await send(request);
  assert.equal(seen.input, request); assert.equal(seen.input.headers.get('X-Fixture'), 'yes');
  assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), '0-1/2');
  assert.deepEqual(await response.json(), [1, 2]);
  controller.abort(); await assert.rejects(send(request), abort);
});

test('HEAD/no-content responses stay empty and failed requests free their slots without automatic resubmission', async () => {
  const server = backend();
  const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl, maxConcurrent: 1, maxReads: 1 });
  const failed = assert.rejects(send(rest + 'rpc/copy_job', { method: 'POST' }), /fixture/);
  const next = send(rest + 'jobs_public', { method: 'HEAD' });
  await flush(); server.calls[0].fail(new TypeError('fixture network failure')); await failed; await flush();
  server.calls[1].respond(204); const response = await next;
  assert.equal(response.body, null); assert.equal(await response.text(), ''); assert.equal(server.calls.length, 2);
});

test('real installed Supabase SDK does not retry a managed 15-second deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = backend();
  const client = createClient(origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl }) },
  });
  const result = Promise.resolve(client.from('jobs_public').select('*'));
  await flush(); assert.equal(server.calls.length, 1);
  t.mock.timers.tick(15000); await flush();
  assert.equal((await result).status, 0);
  t.mock.timers.tick(60000); await flush(); assert.equal(server.calls.length, 1);
});

test('SDK receives HTTP errors unchanged and a failed write is not retried or declared successful', async () => {
  let calls = 0;
  const client = createClient(origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ code: 'PGRST003', message: 'fixture pool timeout', details: null, hint: null }), { status: 504 });
    } }) },
  });
  const result = await client.rpc('copy_job', { p_job_number: 100 });
  assert.equal(calls, 1); assert.equal(result.data, null); assert.equal(result.status, 504);
  assert.equal(result.error.code, 'PGRST003');
});

test('SDK reads and successful writes keep count, single-row parsing, filters and mutation arguments', async () => {
  const calls = [];
  const client = createClient(origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return options.method === 'POST'
        ? new Response(JSON.stringify({ ok: true, job_number: 100 }), { status: 200 })
        : new Response(JSON.stringify({ id: 'fixture-row' }), { status: 200, headers: { 'Content-Range': '0-0/1' } });
    } }) },
  });
  const row = await client.from('applications').select('id', { count: 'exact' }).eq('worker_id', 'fixture-user').single();
  assert.equal(row.error, null); assert.equal(row.count, 1); assert.equal(row.data.id, 'fixture-row');
  assert.equal(new URL(calls[0].url).searchParams.get('worker_id'), 'eq.fixture-user');
  const write = await client.rpc('copy_job', { p_job_number: 100 });
  assert.deepEqual(write.data, { ok: true, job_number: 100 }); assert.equal(write.error, null);
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_job_number: 100 });
});

test('SDK may retry a transient HTTP 503 using Retry-After; the response is not disguised as success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const client = createClient(origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ code: 'PGRST002' }), { status: 503, headers: { 'Retry-After': '1' } })
        : new Response('[{"id":"recovered"}]', { status: 200 });
    } }) },
  });
  const result = Promise.resolve(client.from('jobs_public').select('id'));
  // Response本文を消費してSDKが再試行タイマーを登録するまで、イベントループを一巡する。
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  t.mock.timers.tick(1000); await flush();
  assert.equal(calls, 2); assert.deepEqual((await result).data, [{ id: 'recovered' }]);
});

test('five independent browser clients cap a synthetic 100-read burst at 15 in-flight reads', async () => {
  const server = backend();
  const pending = Array.from({ length: 5 }, () => {
    const send = createSupabaseFetch({ supabaseUrl: origin, fetchImpl: server.fetchImpl });
    return Array.from({ length: 20 }, () => send(rest + 'rpc/my_todo_items', { method: 'POST', body: '{}' }));
  }).flat();
  await flush(); assert.equal(server.calls.length, 15);
  await drain(server, 100); await Promise.all(pending);
  assert.equal(server.peak, 15);
});
