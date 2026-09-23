import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { newDeviceDraft, saveDeviceDraft, readDeviceDraft, listDeviceDrafts, queueDeviceDraft,
  settleDeviceDraft, queuePrivacyConsent, readPendingConsent, forkDeviceDraft } from '../src/lib/deviceDrafts.js';
import { syncDeviceWork } from '../src/lib/offlineSync.js';

const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const version = 'test-version';
function storage() {
  const object = {};
  Object.defineProperties(object, {
    getItem: { value: key => object[key] ?? null }, setItem: { value: (key, value) => { object[key] = String(value); } },
    removeItem: { value: key => { delete object[key]; } },
  });
  return object;
}
function reset() { Object.defineProperty(globalThis, 'localStorage', { value: storage(), configurable: true }); }
const draft = () => saveDeviceDraft(newDeviceDraft(owner), { role: 'farmer', jobDescription: '入力中' }, { notes: '入力中' });
const row = d => ({ id: d.jobId, farmer_id: owner, job_number: 42, status: 'draft', ...d.payload });
function client(handler, user = owner) {
  const calls = [];
  const db = createClient('https://offline.test', 'fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const request = { path: new URL(url).pathname, method: init.method || 'GET', body: init.body && JSON.parse(init.body) };
      calls.push(request);
      const data = await handler(request);
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  db.auth.getSession = async () => ({ data: { session: { user: { id: user } } } });
  return { db, calls };
}
test.beforeEach(reset);

test('device drafts survive a reload and never appear under another account; new copy has a new server ID', () => {
  const first = draft();
  assert.equal(readDeviceDraft(owner, first.id).form.jobDescription, '入力中');
  assert.equal(readDeviceDraft(other, first.id), null);
  assert.deepEqual(listDeviceDrafts(other), []);
  const cloned = forkDeviceDraft(first);
  assert.notEqual(cloned.jobId, first.jobId);
  assert.equal(cloned.jobNumber, null);
  assert.equal(cloned.form.jobDescription, first.form.jobDescription);
});
test('storage failure is never reported as saved', () => {
  Object.defineProperty(globalThis, 'localStorage', { value: { setItem() { throw new Error('quota'); }, getItem() { return null; } }, configurable: true });
  assert.throws(draft, /quota/);
  assert.throws(() => queuePrivacyConsent(owner, version), /quota/);
});
test('late acknowledgement retains newer input and chains separately requested saves without replaying the old payload', () => {
  let d = draft();
  queueDeviceDraft(owner, d.id);
  const oldToken = d.revision;
  d = saveDeviceDraft(d, { jobDescription: '新しい入力' }, { notes: '新しい入力' });
  queueDeviceDraft(owner, d.id);
  assert.equal(readDeviceDraft(owner, d.id).pending.payload.notes, '入力中');
  const firstRow = { ...row(d), notes: '入力中' };
  settleDeviceDraft(owner, d.id, oldToken, { ok: true, row: firstRow });
  let current = readDeviceDraft(owner, d.id);
  assert.equal(current.form.jobDescription, '新しい入力');
  assert.equal(current.pending.payload.notes, '新しい入力');
  assert.deepEqual(current.pending.base, firstRow);
  assert.equal(current.state, 'pending');
  settleDeviceDraft(owner, d.id, oldToken, { ok: false, reason: 'conflict' });
  assert.equal(readDeviceDraft(owner, d.id).state, 'pending');
  settleDeviceDraft(owner, d.id, d.revision, { ok: true, row: row(d) });
  current = readDeviceDraft(owner, d.id);
  assert.equal(current.state, 'synced');
  assert.equal(current.pending, null);
});
test('another tab cannot overwrite a newer local form; conflict retains input and prevents automatic retry', () => {
  const old = draft();
  const current = saveDeviceDraft(old, { jobDescription: '別タブの入力' }, { notes: '別タブの入力' });
  assert.throws(() => saveDeviceDraft(old, { jobDescription: '古い内容' }, { notes: '古い内容' }), /DEVICE_DRAFT_CHANGED/);
  queueDeviceDraft(owner, current.id);
  settleDeviceDraft(owner, current.id, current.revision, { ok: false, reason: 'conflict' });
  let stuck = readDeviceDraft(owner, current.id);
  assert.equal(stuck.state, 'conflict');
  assert.equal(stuck.pending, null); // 失敗した送信内容は自動では再送しない
  assert.equal(stuck.form.jobDescription, '別タブの入力');
  // 利用者の明示の操作（掲載する／保存）は例外にならず、いまの内容で送り直せる（旧: DRAFT_REQUIRES_REVIEW で詰まった）
  const requeued = queueDeviceDraft(owner, current.id);
  assert.equal(requeued.state, 'pending');
  assert.equal(requeued.pending.payload.notes, '別タブの入力');
});
test('conflict with the current row rebases the device draft so an explicit resend uses the DB row as its expected value', async () => {
  const d = draft(); queueDeviceDraft(owner, d.id);
  const dbRow = { ...row(d), notes: 'DB側で変わった内容', job_number: 77 };
  const f = client(r => {
    if (r.path.endsWith('/account_holders')) return [{ agreed_privacy_version: version }];
    if (r.body.p_expected === null) return { ok: false, reason: 'conflict', row: dbRow };
    assert.deepEqual(r.body.p_expected.notes, 'DB側で変わった内容'); // 取り直した比較元で送っている
    return { ok: true, row: { ...dbRow, notes: r.body.p_patch.notes } };
  });
  await syncDeviceWork(f.db, owner, version);
  let current = readDeviceDraft(owner, d.id);
  assert.equal(current.state, 'conflict');
  assert.equal(current.rebased, true);
  assert.equal(current.jobNumber, 77);
  assert.deepEqual(current.base, dbRow);
  assert.equal(current.form.jobDescription, '入力中'); // 入力は消えない
  queueDeviceDraft(owner, d.id);
  await syncDeviceWork(f.db, owner, version);
  current = readDeviceDraft(owner, d.id);
  assert.equal(current.state, 'synced');
  assert.equal(current.base.notes, '入力中');
  // 削除済み（row:null）の衝突は「新規」に戻る＝同じUUIDで作り直せる
  const gone = draft(); queueDeviceDraft(owner, gone.id);
  settleDeviceDraft(owner, gone.id, gone.revision, { ok: false, reason: 'conflict', row: null });
  const fresh = readDeviceDraft(owner, gone.id);
  assert.equal(fresh.base, null); assert.equal(fresh.jobNumber, null); assert.equal(fresh.jobId, gone.jobId);
  // 他人の行は比較元にしない（RLS外の行が紛れても取り込まない）
  const foreign = draft(); queueDeviceDraft(owner, foreign.id);
  settleDeviceDraft(owner, foreign.id, foreign.revision, { ok: false, reason: 'conflict', row: { ...row(foreign), farmer_id: other } });
  assert.equal(readDeviceDraft(owner, foreign.id).base, null);
  // 新しい入力があれば conflict は「未送信の入力」に戻る（一覧の警告を残さない）
  const edited = saveDeviceDraft(readDeviceDraft(owner, foreign.id), { jobDescription: '直した' }, { notes: '直した' });
  assert.equal(edited.state, 'local');
});
test('lost response leaves a durable request; reopening retries the same job ID and succeeds only after confirmation', async () => {
  const d = draft(); queueDeviceDraft(owner, d.id);
  let lost = true;
  const f = client(r => {
    if (r.path.endsWith('/account_holders')) return [{ agreed_privacy_version: version }];
    if (lost) throw new TypeError('network error');
    return { ok: true, row: row(d) };
  });
  await syncDeviceWork(f.db, owner, version);
  assert.equal(readDeviceDraft(owner, d.id).state, 'pending');
  lost = false;
  await syncDeviceWork(f.db, owner, version);
  assert.equal(readDeviceDraft(owner, d.id).state, 'synced');
  const writes = f.calls.filter(r => r.path.endsWith('/sync_my_job_draft'));
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.p_id, writes[1].body.p_id);
});
test('a different session and an unconfirmed consent cannot send a draft', async () => {
  const d = draft(); queueDeviceDraft(owner, d.id);
  const wrong = client(() => assert.fail('must not send'), other);
  assert.equal((await syncDeviceWork(wrong.db, owner, version)).authRequired, true);
  assert.equal(wrong.calls.length, 0);
  const noConsent = client(() => [{ agreed_privacy_version: 'old' }]);
  assert.equal((await syncDeviceWork(noConsent.db, owner, version)).consentRequired, true);
  assert.ok(noConsent.calls.every(r => r.method === 'GET'));
});
test('consent is persisted before sending, scoped by version, and all waiting callers receive confirmation', async () => {
  queuePrivacyConsent(owner, version);
  assert.equal(readPendingConsent(owner, 'next-version'), null);
  let release;
  const f = client(() => new Promise(resolve => { release = () => resolve({ agreed_privacy_version: version }); }));
  let a = 0, b = 0;
  const first = syncDeviceWork(f.db, owner, version, { onConsent: () => a++ });
  const second = syncDeviceWork(f.db, owner, version, { onConsent: () => b++ });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.ok(readPendingConsent(owner, version));
  release(); await Promise.all([first, second]);
  assert.equal(f.calls.length, 1);
  assert.equal(a, 1); assert.equal(b, 1);
  assert.equal(readPendingConsent(owner, version), null);
});
