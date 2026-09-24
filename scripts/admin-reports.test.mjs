import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { REPORT_KINDS, mergeReportResults, needsReportAction, reportStatus } from '../src/components/admin/reportModel.js';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/jsdom` : 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`;
const reporter = id(90); const farmer = id(91); const sender = id(92);
const row = (n, extras = {}) => ({ id: id(n), status: 'open', created_at: '2026-09-23T07:00:00Z', reporter_id: reporter, ...extras });
const fixtures = () => ({
  job_reports: [row(1, { job_number: 1232, issue_type: '掲載内容と実際の条件が違うという詳細な申告です。タイトルを省略せずに表示します。', target_field: '報酬', detail: '日給について確認してください。' }), row(2, { job_number: 1200, status: 'resolved', issue_type: '対応済みの求人' })],
  message_reports: [row(1, { application_id: id(80), sender_id_snapshot: sender, reason: '不適切な発言', body_snapshot: '通報時に保存した発言', detail: '前後の事情を確認したい' })],
  profile_reports: [row(3, { target_worker_id: sender, source: 'work_record', target_field: '記録', issue_type: '記載内容の確認', detail: '確認したい記録' })],
  feedback: [row(4, { category: 'broken', page_hash: '#/profile/worker', body: '保存のボタンが反応しない', viewport: 390 }), row(5, { category: 'suggestion', body: '【デモ】文字を大きくしてほしいです（表示の確認用）' })],
  pay_incidents: [row(6, { status: 'reported', application_id: id(81), worker_id: reporter, farmer_id: farmer, job_number: 1233, admin_note: null, snapshot: {
    job: { crop: 'ブロッコリー', task: '収穫' }, application: { terms_snapshot: { party_names: { farmer: '確認用農家', worker: '確認用働き手' }, pay_type: '日給', daily_wage: 6000, date_start: '2026-09-22', pay_timing: 'same_day_after_work', pay_method: 'cash' } },
    day_records: [{ id: id(77), actor_id: reporter, kind: 'plan_mismatch', work_date: '2026-09-22', detail: '報酬', reason: '約束の内容を確認したい' }], final_review: { pay_status: 'unpaid' },
  } })],
});
const button = (w, text, within = w.document) => [...within.querySelectorAll('button')].find(element => element.textContent === text);
const dialog = w => [...w.document.querySelectorAll('[role="dialog"]')].at(-1);
const mainRows = w => [...w.document.querySelectorAll('.reports-room > .reports-list > .reports-row')];
const updates = w => w.qaCalls.filter(call => call.method !== 'GET');
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, `timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('report source failures retain only the failed sources, and samples/closed cases do not inflate action counts', () => {
  const old = [row(1, { kind: 'job' }), row(4, { kind: 'screen' })];
  const results = REPORT_KINDS.map(source => source.key === 'job' ? { status: 'rejected', reason: 'offline' } : { status: 'fulfilled', value: { data: [] } });
  assert.deepEqual(mergeReportResults(old, results), [old[0]], 'successful empty response removes old rows; failed source keeps its rows');
  assert.equal(needsReportAction(row(1, { body: '【デモ】確認用' })), false);
  assert.equal(needsReportAction(row(1, { detail: 'デモ機能についての本物の報告' })), true);
  assert.equal(needsReportAction(row(1, { status: 'unresolved' })), false);
  assert.equal(reportStatus({ kind: 'pay', status: 'checking' }).label, '事実確認中');
  assert.equal(reportStatus({ kind: 'pay', status: 'unresolved' }).label, '未解決で終了');
});

test('report inbox, per-case instructions, evidence, contacts, outcomes and recovery work with the real UI and PostgREST client', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-reports-ui-'));
  let dom;
  const errors = [];
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'reports-fixture', enforce: 'pre', resolveId(module) {
      if (/(?:^|\/)supabase(?:\.js)?$/.test(module)) return path.join(root, 'scripts/fixtures/reports/client.js');
      if (process.env.CB_REPORTS_GLOBAL_CSS_SOURCE && /(?:^|\/)appStyles(?:\.js)?$/.test(module)) return process.env.CB_REPORTS_GLOBAL_CSS_SOURCE;
    } }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/reports/entry.jsx'), name: 'ReportsQA', formats: ['iife'], fileName: 'fixture', cssFileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    const css = await readFile(path.join(output, 'fixture.css'), 'utf8');
    function mount(tables = fixtures(), { hash = '#/admin/reports', cached = [], failed = [] } = {}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError', error => { if (!/CSS|navigation/.test(error.message)) errors.push(error.message); });
      console.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>', { url: `https://ui.test/${hash}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
      const w = dom.window;
      Object.assign(w, { Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder });
      w.qaTables = structuredClone(tables); w.qaFailTables = failed;
      w.localStorage.setItem('cb_snap_me', JSON.stringify({ id: id(99) }));
      w.localStorage.setItem('cb_viewCache_v2_00000099', JSON.stringify({ 'admin:reports': cached }));
      w.fetch = () => { errors.push('Unexpected network'); return Promise.reject(new Error('Unexpected network')); };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      // Model the visual viewport separately from the layout viewport (iOS zoom/pan).
      w.visualViewport = Object.assign(new w.EventTarget(), { scale: 1, width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
      const nativeFocus = w.HTMLElement.prototype.focus;
      w.qaFocusCalls = [];
      w.HTMLElement.prototype.focus = function (options) {
        w.qaFocusCalls.push({ element: this, preventScroll: options?.preventScroll });
        nativeFocus.call(this, options);
      };
      const componentStyles = w.document.createElement('style');
      componentStyles.textContent = css;
      w.document.head.append(componentStyles);
      w.eval(script); return w;
    }
    async function ready(w) {
      // Allow React to commit the click's loading state before looking for completion.
      await new Promise(resolve => setTimeout(resolve, 10));
      await until(() => button(w, '再読み込み') && !button(w, '再読み込み').disabled, 'loaded');
    }
    async function open(w, kind, n) {
      w.document.querySelector(`a[href="#/admin/reports/${kind}/${id(n)}"]`).click();
      await until(() => dialog(w)?.querySelector('.reports-detail-heading'), 'case detail');
    }
    async function back(w) { button(w, '一覧に戻る', dialog(w)).click(); await until(() => !dialog(w), 'back to inbox'); }

    let w = mount(); await ready(w);
    assert.equal(mainRows(w).length, 5);
    assert.equal(w.document.querySelector('.reports-overview strong').textContent, '要対応 5件');
    assert.equal(w.document.querySelector('.reports-samples').open, false);
    assert.ok(mainRows(w).every(element => element.querySelector('.reports-status') && element.querySelector('.reports-row-next')));
    button(w, '対応手順').click(); await until(() => dialog(w), 'handbook');
    assert.match(dialog(w).textContent, /種類別の対応手順/);
    assert.equal(dialog(w).querySelectorAll('details').length, 5);
    button(w, '確認した画面に戻る', dialog(w)).click(); await until(() => !dialog(w), 'close handbook');
    assert.equal(updates(w).length, 0, 'reading never changes a status');

    await open(w, 'job', 1);
    assert.equal(dialog(w).querySelector('a[href="#/admin/review/1232"]').textContent, '対象の求人を確認↗');
    dialog(w).querySelector('a[href="#/admin/review/1232"]').click();
    await until(() => w.document.body.textContent.includes('移動先：'), 'target review');
    button(w, '元の案件に戻る').click(); await until(() => dialog(w)?.querySelector('.reports-detail-heading'), 'back from target to exact case');
    await ready(w);
    assert.equal(w.location.hash, `#/admin/reports/job/${id(1)}`);
    button(w, '対応を完了する', dialog(w)).click(); await until(() => button(w, '結果を保存する', dialog(w)), 'explicit result confirmation');
    assert.equal(updates(w).length, 0);
    assert.match(dialog(w).querySelector('.reports-confirm').textContent, /通知を行いません/);
    let release; w.qaUpdateGate = new Promise(resolve => { release = resolve; });
    const save = button(w, '結果を保存する', dialog(w)); save.click(); save.click();
    await until(() => updates(w).length === 1, 'single in-flight update');
    release(); await until(() => !dialog(w), 'saved history');
    assert.equal(w.qaTables.job_reports[0].status, 'resolved');
    assert.equal(w.qaTables.message_reports[0].status, 'open', 'same id in another source is unaffected');
    assert.match(updates(w)[0].query, /status=eq.open/);
    assert.equal(mainRows(w).length, 2, 'closed list includes the saved case and existing history');
    await open(w, 'job', 1);
    assert.equal(button(w, '対応を完了する', dialog(w)), undefined);
    await back(w);
    w.document.querySelector('.reports-tabs button').click(); await until(() => mainRows(w).length === 4, 'active count decreases');

    await open(w, 'comment', 1);
    assert.match(dialog(w).textContent, /通報時に保存した発言/);
    assert.ok(dialog(w).querySelector(`a[href="#/chat/admin/${reporter}"]`));
    assert.ok(dialog(w).querySelector(`a[href="#/chat/admin/${sender}"]`));
    await back(w);
    await open(w, 'person', 3);
    let preview;
    w.addEventListener('cb:openWorkerPreview', event => { preview = event.detail; });
    button(w, '対象のプロフィールを確認↗', dialog(w)).click();
    assert.equal(preview.workerId, sender); assert.equal(preview.page, 1);
    await back(w);
    w.document.querySelector('.reports-samples').open = true;
    const sampleLink = w.document.querySelector(`a[href="#/admin/reports/screen/${id(5)}"]`);
    sampleLink.focus({ preventScroll: true });
    Object.assign(w.visualViewport, { scale: 1.3, width: 300, height: 600, offsetLeft: 28, offsetTop: 60 });
    await open(w, 'screen', 5);
    assert.match(dialog(w).textContent, /表示サンプル/);
    assert.equal(dialog(w).querySelector('.reports-complete'), null);
    assert.equal(dialog(w).querySelector('a[href^="#/chat/"]'), null);
    await until(() => dialog(w).style.height === '600px', 'sample panel fits the visible, zoomed viewport');
    assert.equal(dialog(w).style.width, '300px');
    assert.equal(dialog(w).style.transform, 'translate(28px, 60px)');
    const header = dialog(w).querySelector('.reports-modal-header');
    // Inspect the actual production stylesheets, including mobile media rules.
    // Any matching !important padding rule would erase the safe area again.
    const rules = [];
    function visit(cssRules) { for (const rule of cssRules) { if (rule.selectorText) rules.push(rule); if (rule.cssRules) visit(rule.cssRules); } }
    for (const sheet of w.document.styleSheets) visit(sheet.cssRules);
    assert.ok(rules.some(rule => rule.selectorText.includes('header:where')), 'shared mobile CSS is present in the harness');
    const overrides = rules.filter(rule => rule.style.getPropertyPriority('padding') === 'important' && header.matches(rule.selectorText));
    assert.deepEqual(overrides.map(rule => rule.selectorText), [], 'global mobile header padding must not override the report safe area');
    const headerRule = rules.find(rule => rule.selectorText === '.reports-modal-header');
    assert.match(headerRule.style.getPropertyValue('padding'), /safe-area-inset-top/);
    assert.match(headerRule.style.getPropertyValue('padding'), /safe-area-inset-left/);
    assert.ok(w.qaFocusCalls.some(call => call.element === header.querySelector('button') && call.preventScroll === true), 'opening does not pan the page toward focus');
    button(w, '手順書', dialog(w)).click();
    await until(() => w.document.querySelectorAll('[role="dialog"]').length === 2, 'sample handbook opens');
    assert.equal(dialog(w).style.height, '600px', 'handbook uses the same viewport fit');
    Object.assign(w.visualViewport, { width: 290, height: 380, offsetLeft: 18, offsetTop: 24 });
    w.visualViewport.dispatchEvent(new w.Event('resize'));
    await until(() => [...w.document.querySelectorAll('[role="dialog"]')].every(element => element.style.height === '380px'), 'both panels follow viewport resize');
    button(w, '確認した画面に戻る', dialog(w)).click();
    await until(() => w.document.querySelectorAll('[role="dialog"]').length === 1, 'handbook returns to sample');
    Object.assign(w.visualViewport, { scale: 1, width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
    w.visualViewport.dispatchEvent(new w.Event('scroll'));
    await until(() => dialog(w).style.height === `${w.visualViewport.height}px`, 'viewport fit retains visible bounds at normal scale');
    Object.assign(w.visualViewport, { width: w.innerWidth, height: 300, offsetLeft: 0, offsetTop: 0 });
    w.visualViewport.dispatchEvent(new w.Event('resize'));
    await until(() => dialog(w).style.height === '300px', 'keyboard alone resizes the panel without zoom or pan');
    Object.assign(w.visualViewport, { width: w.innerWidth, height: w.innerHeight });
    w.visualViewport.dispatchEvent(new w.Event('resize'));
    await until(() => dialog(w).style.height === '', 'full viewport restores CSS bounds');
    header.querySelector('button').click();
    await until(() => !dialog(w), 'top back button returns from sample');
    assert.equal(w.document.querySelector('.reports-samples').open, true, 'sample list stays expanded on return');
    assert.equal(w.document.activeElement, sampleLink, 'focus returns to the sample without scrolling');
    assert.equal(w.qaFocusCalls.at(-1).preventScroll, true);

    await open(w, 'pay', 6);
    await until(() => dialog(w).textContent.includes('確認用農家'), 'selected payment snapshot');
    assert.match(dialog(w).textContent, /日給 6,000円/);
    assert.match(dialog(w).textContent, /現金手渡し/);
    assert.match(dialog(w).textContent, /約束の内容を確認したい/);
    assert.ok(dialog(w).querySelector(`a[href="#/chat/admin/${farmer}"]`));
    assert.ok(w.qaCalls.some(call => call.table === 'pay_incidents' && call.query.includes('select=id%2Csnapshot') && call.query.includes(`id=eq.${id(6)}`)));
    assert.ok(w.qaCalls.filter(call => call.table === 'pay_incidents' && !call.query.includes('id=eq.')).every(call => !call.query.includes('snapshot')), 'no snapshots fetched in list');
    button(w, '事実確認を始める', dialog(w)).click();
    await until(() => dialog(w)?.querySelector('.reports-status-checking'), 'checking status visible');
    assert.equal(w.qaTables.pay_incidents[0].decided_at, undefined);
    button(w, '確認結果を記録する', dialog(w)).click();
    await until(() => dialog(w).querySelector('input[value="unresolved"]'), 'choose actual outcome');
    assert.equal(button(w, '結果を保存する', dialog(w)).disabled, true);
    dialog(w).querySelector('input[value="unresolved"]').click();
    await until(() => !button(w, '結果を保存する', dialog(w)).disabled, 'outcome selected');
    button(w, '結果を保存する', dialog(w)).click(); await until(() => !dialog(w), 'payment archived');
    assert.equal(w.qaTables.pay_incidents[0].status, 'unresolved');
    assert.ok(w.qaTables.pay_incidents[0].decided_at);
    assert.match(mainRows(w).find(element => element.getAttribute('href').includes('/pay/')).textContent, /未解決で終了/);
    const savedTables = structuredClone(w.qaTables);
    w = mount(savedTables, { hash: `#/admin/reports/pay/${id(6)}` }); await ready(w);
    assert.equal(dialog(w).querySelector('.reports-status').textContent, '未解決で終了', 'cold deep link loads the saved result');
    assert.equal(dialog(w).querySelector('.reports-complete'), null);
    assert.equal(updates(w).length, 0);

    w = mount(); await ready(w); await open(w, 'screen', 4);
    w.qaFailUpdate = true;
    button(w, '対応を完了する', dialog(w)).click(); await until(() => button(w, '結果を保存する', dialog(w)), 'confirm failure case');
    button(w, '結果を保存する', dialog(w)).click();
    await until(() => dialog(w)?.textContent.includes('更新を確認できませんでした'), 'write error stays visible');
    assert.equal(w.qaTables.feedback[0].status, 'open');
    assert.equal(dialog(w).querySelector('.reports-status').textContent, '未対応');
    assert.equal(button(w, '結果を保存する', dialog(w)).disabled, true);
    await back(w); w.qaFailUpdate = false; button(w, '再読み込み').click(); await ready(w);
    await open(w, 'screen', 4);
    w.qaTables.feedback[0].status = 'resolved'; // another admin finishes before this stale view saves
    button(w, '対応を完了する', dialog(w)).click(); await until(() => button(w, '結果を保存する', dialog(w)), 'conflict confirmation');
    button(w, '結果を保存する', dialog(w)).click();
    await until(() => dialog(w)?.textContent.includes('更新を確認できませんでした'), 'zero updated rows is not success');
    await back(w); button(w, '再読み込み').click(); await ready(w);
    assert.equal(mainRows(w).some(element => element.href.includes(`/screen/${id(4)}`)), false);

    const tables = fixtures();
    const cached = REPORT_KINDS.flatMap(source => tables[source.table].map(record => ({ ...record, kind: source.key })));
    w = mount(tables, { cached, failed: ['job_reports'] }); await ready(w);
    assert.match(w.document.querySelector('[role="alert"]').textContent, /求人を取得できません/);
    assert.equal(mainRows(w).length, 5, 'failed source is still visible with an error');
    await open(w, 'job', 1); assert.equal(button(w, '対応を完了する', dialog(w)).disabled, true);
    await back(w); w.qaFailTables = []; w.qaTables.job_reports = []; button(w, '再読み込み').click(); await ready(w);
    assert.equal(mainRows(w).length, 4, 'successful empty response clears stale source');
    assert.equal(w.document.querySelector('[role="alert"]'), null);
    w = mount(tables, { failed: REPORT_KINDS.map(source => source.table) }); await ready(w);
    assert.match(w.document.body.textContent, /表示できる案件がありません/);
    assert.doesNotMatch(w.document.body.textContent, /要対応の案件はありません/);
    w.qaFailTables = []; button(w, '再読み込み').click(); await ready(w); assert.equal(mainRows(w).length, 5);
    w = mount(tables, { hash: `#/admin/reports/job/${id(999)}` }); await ready(w);
    assert.match(dialog(w).textContent, /この案件を表示できません/);
    assert.equal(dialog(w).querySelector('.reports-complete'), null);
    assert.deepEqual(errors, []);
  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
