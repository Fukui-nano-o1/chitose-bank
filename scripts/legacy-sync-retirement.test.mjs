import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const endpoint = new URL('../api/sync-farmer.js', import.meta.url).href;
function response() {
  return {
    headers: {}, statusCode: null, body: undefined, ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; },
  };
}

test('retired endpoint imports without Supabase configuration or network access', () => {
  const env = { ...process.env };
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[key];
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = () => { throw new Error('Unexpected network during module import'); };
    const { default: handler } = await import(${JSON.stringify(endpoint)});
    if (typeof handler !== 'function') throw new Error('Missing handler');
  `], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
});

test('retirement denies requests without consulting identity, payload or the database', async t => {
  // Dummy configuration allows the old vulnerable module to load for the red test.
  // No real key is loaded; any attempted Supabase request is intercepted below.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected outbound request'); });
  const prior = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://audit.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-audit-key';
  t.after(() => {
    for (const [key, value] of [['NEXT_PUBLIC_SUPABASE_URL', prior.url], ['SUPABASE_SERVICE_ROLE_KEY', prior.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const { default: handler } = await import(endpoint);

  await t.test('anonymous caller cannot overwrite the farmer identified by an arbitrary email', async () => {
    const res = response();
    await handler({ method: 'POST', headers: {}, body: { email: 'other-person@example.invalid', name: 'Unauthorized replacement' } }, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.code, 'LEGACY_ENDPOINT_RETIRED');
    assert.equal(res.body.status, undefined, 'never return the old success response');
    assert.doesNotMatch(JSON.stringify(res.body), /other-person|Unauthorized replacement/);
  });

  for (const authorization of [undefined, 'Bearer invalid-token', 'Bearer former-client-token']) {
    await t.test(`credentials cannot reactivate the retired endpoint: ${authorization || 'absent'}`, async () => {
      const res = response();
      await handler({ method: 'POST', headers: { authorization }, body: { email: 'audit@example.invalid', name: 'Audit' } }, res);
      assert.equal(res.statusCode, 410);
      assert.equal(res.body.code, 'LEGACY_ENDPOINT_RETIRED');
      assert.equal(res.headers['Cache-Control'], 'no-store');
    });
  }

  await t.test('malformed or lazy request data is never read; all methods stay closed', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'POST']) {
      const res = response();
      const req = { method, get body() { throw new Error('Payload must not be read'); }, get headers() { throw new Error('Credentials must not be read'); } };
      await handler(req, res);
      assert.equal(res.statusCode, 410, method);
      assert.equal(res.headers['Cache-Control'], 'no-store', method);
      if (method === 'HEAD') { assert.equal(res.ended, true); assert.equal(res.body, undefined); }
      else assert.equal(res.body.code, 'LEGACY_ENDPOINT_RETIRED', method);
    }
  });
  assert.equal(globalThis.fetch.mock.callCount(), 0, 'retirement must not query or mutate any backend');
});
