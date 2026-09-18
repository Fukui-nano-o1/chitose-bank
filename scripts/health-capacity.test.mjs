import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/health.js';

// 管理用キーは架空値。実ネットワークには接続しない。
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-test-key';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function response() {
  return { headers: {}, statusCode: null, body: undefined, ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; },
  };
}
function blockedFetch(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => {
    calls.push({ url, options, resolve });
    if (options.signal.aborted) reject(options.signal.reason);
    else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  return calls;
}

test('simultaneous GET and HEAD health checks share one probe without caching later results', async t => {
  const calls = blockedFetch(t);
  const responses = Array.from({ length: 5 }, response);
  const pending = responses.map((res, i) => handler({ method: i === 0 ? 'HEAD' : 'GET' }, res));
  await flush(); assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'HEAD');
  calls[0].resolve(new Response(null, { status: 200 })); await Promise.all(pending);
  assert.equal(responses[0].ended, true); assert.equal(responses[0].body, undefined);
  for (const res of responses) { assert.equal(res.statusCode, 200); assert.match(res.headers['Cache-Control'], /no-store/); }
  const res = response(); const next = handler({ method: 'GET' }, res);
  await flush(); assert.equal(calls.length, 2);
  calls[1].resolve(new Response(null, { status: 200 })); await next;
  assert.equal(res.body.db, 'connected');
});

test('health timeout aborts the database request, returns 503 and allows a fresh probe', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'error', () => {});
  const calls = blockedFetch(t);
  const responses = Array.from({ length: 5 }, response);
  const pending = responses.map(res => handler({ method: 'GET' }, res));
  await flush(); assert.equal(calls.length, 1);
  t.mock.timers.tick(3000); await Promise.all(pending); await flush();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.ok(responses.every(res => res.statusCode === 503 && res.body.db === 'disconnected'));
  const res = response(); const next = handler({ method: 'GET' }, res);
  await flush(); assert.equal(calls.length, 2);
  calls[1].resolve(new Response(null, { status: 200 })); await next;
  assert.equal(res.statusCode, 200);
});

test('health database rejection stays an error and unsupported methods do not query the database', async t => {
  t.mock.method(console, 'error', () => {});
  const calls = blockedFetch(t);
  const denied = response(); const pending = handler({ method: 'GET' }, denied);
  await flush(); calls[0].resolve(new Response(null, { status: 401 })); await pending;
  assert.equal(denied.statusCode, 503);
  const unsupported = response(); await handler({ method: 'POST' }, unsupported);
  assert.equal(unsupported.statusCode, 405); assert.equal(calls.length, 1);
});
