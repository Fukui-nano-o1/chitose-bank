import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { matchesReportSearch, reportStatus, needsReportAction, mergeReportResults, REPORT_KINDS } from '../src/components/admin/reportModel.js';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/jsdom` : 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
const id = 'a0000001-0000-4000-8000-000000000001';
const fixture = () => ({ id, kind: 'screen', reporter_id: null, category: 'broken', topic: 'pdf', impact: 'blocked', status: 'open',
  created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z', body: '作成中のまま通知書を保存できません', expected_result: 'PDFを端末に保存したい', page_hash: '#/profile/employer',
  diagnostics: { captured_at: '2026-09-24T00:00:00Z', viewport: { width: 390, height: 844 }, build_id: 'testbuild', online: true,
    recent_errors: [{ at: '2026-09-24T00:00:00Z', operation: 'pdf', code: 'REQUEST_TIMEOUT' }], unknown_private_field: 'must-never-display' } });
const button = (w, text) => [...w.document.querySelectorAll('button')].find(element => element.textContent === text);
async function until(predicate, label) { const end = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < end, `timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 10)); } }
function setValue(w, input, value) {
  Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
}

test('support inbox searches receipts/all words and never counts answered as solved', () => {
  const row = fixture();
  assert.equal(matchesReportSearch(row, 'CB-A0000001 PDF'), true);
  assert.equal(matchesReportSearch(row, 'ＰＤＦ　保存'), true);
  assert.equal(matchesReportSearch(row, 'PDF missingword'), false);
  assert.equal(reportStatus({ ...row, status: 'answered' }).label, '回答あり');
  assert.equal(needsReportAction({ ...row, status: 'answered' }), true);
  assert.equal(needsReportAction({ ...row, status: 'resolved' }), false);
  const replied = { ...row, status: 'answered', updated_at: '2026-09-24T00:10:00Z' };
  const results = REPORT_KINDS.map(kind => ({ status: 'fulfilled', value: { data: kind.key === 'screen' ? [row] : [] } }));
  assert.equal(mergeReportResults([replied], results)[0].status, 'answered', 'a stale list response cannot overwrite a confirmed reply');
});

test('admin support preserves draft on error, checks current case, retries one reply and keeps guest conversation in the case', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-admin-support-ui-'));
  let dom;
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'reports-fixture', enforce: 'pre', resolveId(module) {
      if (/(?:^|\/)supabase(?:\.js)?$/.test(module)) return path.join(root, 'scripts/fixtures/reports/client.js');
    } }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/reports/entry.jsx'), name: 'ReportsQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    const errors = [];
    const console = new VirtualConsole();
    console.on('jsdomError', error => { if (!/CSS|navigation/.test(error.message)) errors.push(error.message); });
    dom = new JSDOM('<div id="root"></div>', { url: `https://ui.test/#/admin/reports/screen/${id}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
    const w = dom.window;
    Object.assign(w, { Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder });
    w.qaTables = { feedback: [fixture()], pay_incidents: [], job_reports: [], message_reports: [], profile_reports: [] };
    w.qaSupportMessages = { [id]: [{ id: 'initial-message', author_role: 'user', body: '画面では通知書を読めます', created_at: '2026-09-24T00:00:01Z' }] };
    w.fetch = () => { errors.push('Unexpected live network'); return Promise.reject(new Error('Unexpected live network')); };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); w.scrollTo = () => {};
    w.eval(script);
    await until(() => button(w, '確認を始める') && !button(w, '確認を始める').disabled, 'fresh conversation');
    const dialog = w.document.querySelector('[role="dialog"]');
    assert.match(dialog.textContent, /ログイン前/);
    assert.match(dialog.textContent, /PDFを端末に保存したい/);
    assert.match(dialog.textContent, /REQUEST_TIMEOUT/);
    assert.doesNotMatch(dialog.textContent, /must-never-display/);
    assert.equal(dialog.querySelector('a[href^="#/chat/"]'), null, 'guest uses case conversation, never an account-only chat');
    assert.equal(w.qaCalls.filter(call => call.table === 'rpc/admin_support_update').length, 0, 'opening never sends or changes status');
    assert.match(dialog.textContent, /画面では通知書を読めます/);

    button(w, '確認を始める').click();
    await until(() => dialog.textContent.includes('確認中として記録しました'), 'checking saved');
    assert.equal(w.qaTables.feedback[0].status, 'checking');
    assert.equal(w.qaSupportMessages[id].length, 1, 'status update sends no reply');
    const reply = dialog.querySelector('textarea');
    setValue(w, reply, '端末のダウンロード一覧を確認してください。こちらでも調べます。');
    await until(() => !button(w, '返信を送る').disabled, 'reply ready');
    w.qaSupportLoseResponse = true;
    button(w, '返信を送る').click();
    await until(() => button(w, '同じ内容で再試行'), 'commit response was lost');
    assert.equal(reply.value, '端末のダウンロード一覧を確認してください。こちらでも調べます。');
    assert.equal(w.qaSupportMessages[id].length, 2, 'server committed exactly once');
    assert.equal(dialog.querySelector('.reports-detail-heading .reports-status').textContent, '確認中', 'unconfirmed response does not fake success');
    button(w, '同じ内容で再試行').click();
    await until(() => dialog.textContent.includes('返信を保存しました'), 'idempotent reply confirmed');
    assert.equal(reply.value, '');
    assert.equal(w.qaSupportMessages[id].length, 2, 'retry must not duplicate the reply');
    assert.equal(dialog.querySelector('.reports-detail-heading .reports-status').textContent, '回答あり');
    const replies = w.qaCalls.filter(call => call.table === 'rpc/admin_support_update' && call.patch.p_body);
    assert.equal(replies[0].patch.p_message_id, replies[1].patch.p_message_id);

    setValue(w, reply, '次の案内の入力は失わない');
    w.qaTables.feedback[0].updated_at = '2026-09-24T00:10:00Z';
    w.qaSupportMessages[id].push({ id: 'new-user-message', author_role: 'user', body: 'まだ保存できません', created_at: '2026-09-24T00:10:00Z' });
    await until(() => !button(w, '返信を送る').disabled, 'conflicting reply ready');
    button(w, '返信を送る').click();
    await until(() => dialog.textContent.includes('別の更新がありました'), 'stale update rejected');
    assert.equal(reply.value, '次の案内の入力は失わない');
    assert.equal(button(w, '返信を送る').disabled, true);
    button(w, '会話を再読み込み').click();
    await until(() => !button(w, '返信を送る').disabled && dialog.textContent.includes('まだ保存できません'), 'fresh reply visible');
    assert.equal(reply.value, '次の案内の入力は失わない');
    w.qaSupportWriteFailure = true;
    button(w, '返信を送る').click();
    await until(() => button(w, '同じ内容で再試行'), 'server write failure stays actionable');
    assert.equal(reply.value, '次の案内の入力は失わない');
    w.qaSupportWriteFailure = false;
    button(w, '同じ内容で再試行').click();
    await until(() => reply.value === '', 'retry after server failure');
    button(w, '対応を完了する').click();
    await until(() => button(w, '結果を保存する'), 'explicit confirmation');
    assert.equal(w.qaTables.feedback[0].status, 'answered');
    button(w, '結果を保存する').click();
    await until(() => dialog.textContent.includes('対応済みとして記録しました'), 'resolved saved');
    assert.equal(w.qaTables.feedback[0].status, 'resolved');
    assert.equal(w.qaCalls.some(call => call.method === 'PATCH'), false, 'new support uses authorized RPC with concurrency guard');
    assert.deepEqual(errors, []);
  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
