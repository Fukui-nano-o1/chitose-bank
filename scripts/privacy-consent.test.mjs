import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseFetch } from '../src/lib/requestTransport.js';
import { privacyConsentErrorMessage, savePrivacyConsent } from '../src/lib/privacyConsent.js';

const origin = 'https://fixture.supabase.co';
const authId = '00000000-0000-4000-8000-000000000001';
const version = 'consent-fixture';
const row = { agreed_privacy_version: version };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
function fixture(handler) {
  const calls = [], reports = [];
  const client = createClient(origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch({ supabaseUrl: origin, fetchImpl: async (input, options) => {
      const request = { url: new URL(input), ...options };
      calls.push(request);
      return handler(request);
    } }) },
  });
  const save = options => savePrivacyConsent(client, authId, version, {
    report: detail => reports.push(detail), ...options,
  });
  return { client, calls, reports, save };
}

test('confirms the version returned by the update; writes only the version and reads only the owner row', async () => {
  const f = fixture(() => json(row));
  const result = await f.save();
  assert.equal(result.ok, true);
  assert.equal(f.calls.length, 1);
  const request = f.calls[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url.pathname, '/rest/v1/rpc/save_my_privacy_consent');
  assert.deepEqual(JSON.parse(request.body), { p_auth_id: authId, p_version: version });
});

for (const [label, data] of [['no matching row', null], ['an older version', { agreed_privacy_version: 'old' }]]) {
  test(`does not complete consent with ${label}`, async () => {
    const f = fixture(() => json(data));
    const result = await f.save();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CONSENT_NOT_CONFIRMED');
    assert.equal(f.calls.length, 1);
  });
}

test('a lost write response is recovered by one owner-scoped read without resubmitting the write', async () => {
  const f = fixture(request => {
    if (request.method === 'POST') throw new TypeError('fixture lost response');
    return json([row]);
  });
  let verifying = 0;
  const result = await f.save({ onVerifying: () => verifying++ });
  assert.equal(result.ok, true);
  assert.equal(result.recovered, true);
  assert.equal(verifying, 1);
  assert.deepEqual(f.calls.map(c => c.method), ['POST', 'GET']);
  assert.equal(f.calls[1].url.searchParams.get('auth_id'), 'eq.' + authId);
  assert.equal(f.calls[1].url.searchParams.get('select'), 'agreed_privacy_version');
  assert.equal(f.reports.at(-1).confirmed, true);
  const diagnostics = JSON.stringify(f.reports);
  assert.ok(!diagnostics.includes(authId));
  assert.ok(!diagnostics.includes(version));
  assert.ok(!diagnostics.includes('fixture lost response'));
});

for (const [label, response] of [
  ['old consent', () => json([{ agreed_privacy_version: 'old' }])],
  ['missing owner row', () => json([])],
  ['a database outage', () => json({ code: 'PGRST000', message: 'fixture db down' }, 503)],
]) {
  test(`a lost response followed by ${label} keeps the consent gate closed`, async () => {
    const f = fixture(request => {
      if (request.method === 'POST') throw new TypeError('fixture response lost');
      return response();
    });
    const result = await f.save();
    assert.equal(result.ok, false);
    assert.deepEqual(f.calls.map(c => c.method), ['POST', 'GET']);
    assert.match(privacyConsentErrorMessage(result.error, result.status), /保存を確認できません/);
  });
}

test('stops verification when its deadline expires and keeps the gate closed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let beginRead, readSignal;
  const readStarted = new Promise(resolve => { beginRead = resolve; });
  const f = fixture(request => {
    if (request.method === 'POST') throw new TypeError('fixture lost response');
    readSignal = request.signal;
    return new Promise((resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      beginRead();
    });
  });
  const pending = f.save();
  await readStarted;
  t.mock.timers.tick(6000);
  assert.equal((await pending).ok, false);
  assert.equal(readSignal.aborted, true);
  assert.deepEqual(f.calls.map(c => c.method), ['POST', 'GET']);
});

for (const [status, code, message] of [
  [401, 'PGRST301', /ログイン/],
  [403, '42501', /権限/],
  [503, 'PGRST000', /サーバーが一時的に応答していません/],
  [500, '57014', /サーバーが一時的に応答していません/],
]) {
  test(`HTTP ${status} ${code} is classified without extra requests or exposing database details`, async () => {
    const f = fixture(() => json({ code, message: 'fixture private database detail' }, status));
    const result = await f.save();
    assert.equal(result.ok, false);
    assert.equal(f.calls.length, 1);
    const text = privacyConsentErrorMessage(result.error, result.status);
    assert.match(text, message);
    assert.ok(!text.includes('fixture private'));
    assert.ok(!text.includes('通信の状態をご確認'));
  });
}

test('missing authentication sends no update and does not complete consent', async () => {
  const f = fixture(() => { throw new Error('must not send'); });
  const result = await savePrivacyConsent(f.client, null, version);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(f.calls.length, 0);
});

test('logging failures do not prevent recovery from a lost response', async () => {
  const f = fixture(request => {
    if (request.method === 'POST') throw new TypeError('fixture lost response');
    return json([row]);
  });
  assert.equal((await f.save({ report: () => { throw new Error('fixture logger'); } })).ok, true);
});
