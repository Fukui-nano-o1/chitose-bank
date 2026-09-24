import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { authStorageKey, createAuthStorage, createDeviceLogout } from '../src/lib/authSession.js';

const origin = 'https://auth-fixture.test';
const key = authStorageKey(origin);
function memoryStorage() {
  const rows = new Map();
  return { getItem: k => rows.get(k) ?? null, setItem: (k,v) => rows.set(k,v), removeItem: k => rows.delete(k) };
}

for (const kind of ['success', 'error', 'throw', 'hung']) {
  test(`logout clears this device and navigates once when remote revocation is ${kind}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const raw = memoryStorage();
    const auth = createAuthStorage(key, () => raw);
    for (const name of [key, `${key}-code-verifier`, `${key}-user`]) auth.storage.setItem(name, 'fixture');
    raw.setItem('device-draft', 'retain draft');
    raw.setItem('another-project-auth-token', 'unrelated');
    const calls = [];
    const logout = createDeviceLogout({
      signOut: options => {
        calls.push(['remote', options.scope]);
        if (kind === 'throw') throw new Error('fixture failure');
        if (kind === 'hung') return new Promise(() => {});
        return Promise.resolve({ error: kind === 'error' ? new Error('offline') : null });
      },
      stopAutoRefresh: () => calls.push(['stop']),
      clearAuth: () => { calls.push(['clear']); auth.clearSession(); },
      clearPrivateState: () => calls.push(['private']),
      navigate: () => calls.push(['navigate']),
    });
    const pending = logout();
    assert.equal(logout(), pending, 'repeated taps do not start another logout');
    if (kind === 'hung') {
      await Promise.resolve();
      t.mock.timers.tick(1999);
      assert.ok(raw.getItem(key));
      t.mock.timers.tick(1);
    }
    const result = await pending;
    assert.equal(result.remoteRevoked, kind === 'success', 'never claim revocation succeeded on timeout/error');
    assert.deepEqual(calls.slice(-3), [['clear'], ['private'], ['navigate']]);
    assert.equal(calls.filter(c => c[0] === 'remote').length, 1);
    for (const name of [key, `${key}-code-verifier`, `${key}-user`]) assert.equal(raw.getItem(name), null);
    assert.equal(raw.getItem('device-draft'), 'retain draft');
    assert.equal(raw.getItem('another-project-auth-token'), 'unrelated');
    auth.storage.setItem(key, 'late session');
    assert.equal(auth.storage.getItem(key), null);
    assert.equal(raw.getItem(key), null, 'late response cannot restore persisted login');
  });
}

test('logout clears the memory fallback when browser storage is unavailable', async () => {
  const auth = createAuthStorage(key, () => { throw new Error('Storage denied'); });
  auth.storage.setItem(key, 'session');
  assert.equal(auth.storage.getItem(key), 'session');
  auth.clearSession();
  assert.equal(auth.storage.getItem(key), null);
  auth.storage.setItem(key, 'late session');
  assert.equal(auth.storage.getItem(key), null);
});

test('a real SDK refresh completing after logout cannot persist or recover the previous session', async () => {
  const raw = memoryStorage(), auth = createAuthStorage(key, () => raw);
  const user = { id: '10000000-0000-4000-8000-000000000001' };
  const session = { access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now()/1000)+3600, user };
  auth.storage.setItem(key, JSON.stringify(session));
  let respond;
  const client = createClient(origin, 'fixture-key', {
    auth: { storageKey: key, storage: auth.storage, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: () => new Promise(resolve => { respond = resolve; }) },
  });
  assert.equal((await client.auth.getSession()).data.session.user.id, user.id);
  const refresh = client.auth.refreshSession();
  for (let i=0; !respond && i<30; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(respond);
  auth.clearSession();
  respond(new Response(JSON.stringify({ ...session, expires_in: 3600, access_token: 'refreshed-fixture-token' }), { headers: { 'Content-Type': 'application/json' } }));
  await refresh;
  assert.equal(raw.getItem(key), null);
  assert.equal((await client.auth.getSession()).data.session, null);
  await client.auth.stopAutoRefresh();
});
