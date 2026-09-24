import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSupportPath, sanitizeSupportFailure, captureSupportContext, rememberSupportFailure, clearSupportDiagnostics, openSupport } from '../src/lib/supportDiagnostics.js';

test('support paths keep only known screen names and never identify people, jobs or auth tokens', () => {
  const cases = [
    ['#/login?email=person@example.test&access_token=secret', '#/login'],
    ['/login?email=person@example.test', '#/login'],
    ['#access_token=secret&refresh_token=secret2', '#/other'],
    ['#/work/job/1311?code=123456', '#/work/job'],
    ['#/profile/employer/schedule/other-person', '#/profile/employer/schedule'],
    ['#/chat/other-person', '#/chat'],
    ['#/help/faq', '#/help/faq'],
    ['#/admin/reports/other-person', '#/admin/reports'],
    ['#/unknown/person@example.test', '#/other'],
    ['https://example.test/#/login?email=person@example.test', '#/other'],
    ['#/login/person@example.test', '#/login'],
    ['#/', '#/search'],
  ];
  for (const [raw, expected] of cases) assert.equal(sanitizeSupportPath(raw), expected, raw);
});

test('support failures allow only operational labels and codes, omitting all raw errors and metadata', () => {
  const at = Date.parse('2026-09-24T12:00:00Z');
  assert.deepEqual(sanitizeSupportFailure({ source: 'client', operation: 'auth.signInWithOtp', error: { code: 'over_email_send_rate_limit', message: 'person@example.test', stack: 'secret', token: '123456' }, metadata: { password: 'secret' } }, at), {
    at: '2026-09-24T12:00:00.000Z', source: 'client', operation: 'auth.signInWithOtp', code: 'over_email_send_rate_limit',
  });
  assert.deepEqual(sanitizeSupportFailure({ source: 'person@example.test', action: 'secret', operation: '123456', error: { code: 'secret', status: 503 } }, at), {
    at: '2026-09-24T12:00:00.000Z', source: 'client', operation: 'unknown', code: '503',
  });
  assert.equal(sanitizeSupportFailure({ error: { code: 'PERSONAL_NAME' } }, at).code, 'unknown');
});

test('context is captured at opening, recent failures are bounded and snapshots cannot mutate later reports', () => {
  clearSupportDiagnostics();
  for (let n = 0; n < 15; n++) rememberSupportFailure({ action: 'runtime_error', error: { status: 500 + n } });
  const captured = captureSupportContext();
  assert.equal(captured.recent_errors.length, 10);
  assert.equal(captured.recent_errors[0].code, '505');
  rememberSupportFailure({ operation: 'pdf', error: { name: 'TimeoutError' } });
  assert.equal(captured.recent_errors.at(-1).code, '514');
  captured.recent_errors[0].code = 'injected';
  assert.equal(captureSupportContext().recent_errors.some(item => item.code === 'injected'), false);
  clearSupportDiagnostics();
  assert.deepEqual(captureSupportContext().recent_errors, []);
});

test('support opening captures safe diagnostics without navigating or accepting arbitrary supplied context', () => {
  const previous = globalThis.window;
  const previousEvent = globalThis.CustomEvent;
  let event;
  globalThis.window = { location: { hash: '#/login?email=person@example.test' }, innerWidth: 390, innerHeight: 844, dispatchEvent: value => { event = value; } };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  try {
    openSupport({ topic: 'login', view: 'compose', context: { token: 'secret' } });
    assert.equal(event.type, 'cb:open-support');
    assert.equal(event.detail.topic, 'login');
    assert.equal(event.detail.context.page_hash, '#/login');
    assert.deepEqual(event.detail.context.viewport, { width: 390, height: 844 });
    assert.equal(JSON.stringify(event.detail).includes('secret'), false);
    assert.equal(window.location.hash, '#/login?email=person@example.test');
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    if (previousEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = previousEvent;
  }
});
