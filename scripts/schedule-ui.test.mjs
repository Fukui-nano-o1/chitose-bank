import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/jsdom` : 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out: ${label}`);
    await pause(10);
  }
}
const first = '10000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const row = (id, partner, overrides = {}) => ({
  application_id: id, job_number: 1311, relation: 'application', my_role: 'farmer',
  crop: 'ブロッコリー', task: '播種', partner_name: partner, status: 'closed', application_status: 'approved',
  date_start: '2026-09-20', date_end: '2026-09-30', agreed_dates: ['2026-09-24'], work_time: '10:00〜12:00', photos: [],
  terms_confirmed_worker_at: '2026-09-21', terms_confirmed_farmer_at: '2026-09-22', ...overrides,
});
const button = (w, text) => [...w.document.querySelectorAll('button')].find(b => b.textContent.includes(text));

test('real upcoming/detail/notice UI follows the selected application, survives reload/back, and handles lost access or connectivity', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-schedule-ui-'));
  let dom;
  const errors = [];
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'schedule-fixture', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/schedule/client.js');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/schedule/entry.jsx'), name: 'ScheduleQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    function mount(entries, hash = '#/profile/employer', { cached = entries, offline = false } = {}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError', e => { if (!/CSS|navigation/.test(e.message)) errors.push(e.message); });
      console.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>', { url: `https://ui.test/${hash}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
      const w = dom.window;
      const NativeDate = w.Date;
      const now = NativeDate.parse('2026-09-23T18:48:00+09:00');
      w.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      };
      Object.assign(w, { Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder });
      w.qaMe = { id: '30000000-0000-4000-8000-000000000003' };
      w.qaEntries = entries;
      w.qaOffline = offline;
      w.qaContracts = entries.map(e => ({ id: e.application_id, job_number: e.job_number, status: e.application_status,
        terms_confirmed_worker_at: e.terms_confirmed_worker_at, terms_confirmed_farmer_at: e.terms_confirmed_farmer_at,
        terms_snapshot: { crop: `${e.partner_name}専用の通知書`, date_start: '2026-09-24', party_names: { farmer: 'テスト農家', worker: e.partner_name } },
      }));
      w.localStorage.setItem('cb_snap_me', JSON.stringify(w.qaMe));
      w.localStorage.setItem('cb_viewCache_v2_30000000', JSON.stringify({ 'today:entries': cached }));
      w.fetch = () => { errors.push('Unexpected network'); return Promise.reject(new Error('Unexpected network')); };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.qaScrolls = [];
      w.scrollTo = options => w.qaScrolls.push(options);
      w.eval(script);
      return w;
    }

    const entries = [row(first, 'テスト甲'), row(second, 'テスト乙')];
    let w = mount(entries);
    assert.equal(w.document.querySelectorAll('button[data-prefetch-route]').length, 2);
    button(w, 'テスト乙').click();
    await until(() => w.document.querySelector('#schedule-partner-heading')?.textContent === 'テスト乙', 'selected partner detail');
    assert.equal(w.location.hash, `#/profile/employer/schedule/${second}`);
    assert.ok(w.qaScrolls.some(options => options.top === 0), 'detail starts at top after opening from the bottom of My Page');
    assert.equal(w.document.querySelector('.schedule-message').getAttribute('href'), `#/chat/${second}`);
    assert.match(w.document.querySelector('.schedule-value').textContent, /9\/24/);
    assert.doesNotMatch(w.document.querySelector('.schedule-value').textContent, /9\/20|9\/30/);
    button(w, '労働条件通知書を確認').click();
    await until(() => w.document.querySelector('.cb-ctr-print')?.textContent.includes('テスト乙専用の通知書'), 'selected application notice');
    assert.doesNotMatch(w.document.querySelector('.cb-ctr-print').textContent, /テスト甲専用/);
    assert.ok(w.qaCalls.find(c => c.path === 'applications' && c.query.includes('farmer_id=eq.30000000-0000-4000-8000-000000000003')));
    w.document.querySelector('.schedule-message').click();
    await until(() => w.location.hash === `#/chat/${second}`, 'selected chat');
    w.history.back();
    await until(() => w.document.querySelector('#schedule-partner-heading')?.textContent === 'テスト乙', 'browser back to detail');
    button(w, '求人の内容を見る').click();
    await until(() => w.location.hash === '#/work/job/1311', 'secondary job link');
    assert.equal(w.sessionStorage.getItem('cb_jobBackTo'), `/profile/employer/schedule/${second}`);

    // A cold deep link must resolve without a previously selected public job.
    w = mount(entries, `#/profile/employer/schedule/${second}`, { cached: [] });
    await until(() => w.document.querySelector('#schedule-partner-heading')?.textContent === 'テスト乙', 'cold reload');
    button(w, '応募内容・採用の手続きを確認').click();
    await until(() => w.location.hash === '#/profile/employer/applicants', 'existing applicant review flow');
    assert.equal(w.sessionStorage.getItem('cb_openApplicantId'), second, 'review also selects this application');
    w.history.back();
    await until(() => w.document.querySelector('#schedule-partner-heading')?.textContent === 'テスト乙', 'back from applicant review');
    w.document.querySelector('[aria-label="マイページに戻る"]').click();
    await until(() => w.location.hash === '#/profile/employer', 'farmer home');

    const worker = row(first, 'テスト農家', { my_role: 'worker', application_status: 'applied', terms_confirmed_farmer_at: null });
    w = mount([worker], `#/profile/worker/schedule/${first}`, { cached: [] });
    await until(() => w.document.querySelector('.schedule-phase')?.textContent === '応募中', 'worker tentative state');
    assert.match(w.document.body.textContent, /採用前の予定/);
    assert.equal(button(w, '労働条件通知書を確認'), undefined);
    assert.equal(w.document.querySelector('.schedule-message').getAttribute('href'), `#/chat/${first}`);
    w.document.querySelector('[aria-label="マイページに戻る"]').click();
    await until(() => w.location.hash === '#/profile/worker', 'worker home');

    // Data from another role/application never substitutes for the requested one.
    w = mount(entries, `#/profile/worker/schedule/${second}`, { cached: [] });
    await until(() => w.document.body.textContent.includes('この予定は表示できません'), 'wrong role denied');
    assert.equal(w.document.querySelector('.schedule-message'), null);
    w = mount(entries, '#/profile/employer/schedule/99999999-0000-4000-8000-000000000009', { cached: [] });
    await until(() => w.document.body.textContent.includes('この予定は表示できません'), 'unknown application denied');

    w = mount(entries, `#/profile/employer/schedule/${second}`, { offline: true });
    await until(() => w.document.body.textContent.includes('前回の内容を表示しています'), 'offline cache disclosed');
    assert.equal(w.document.querySelector('#schedule-partner-heading').textContent, 'テスト乙');
    w.qaEntries = []; w.qaOffline = false;
    button(w, '再読み込み').click();
    await until(() => w.document.body.textContent.includes('この予定は表示できません'), 'removed entry clears stale cache and actions');
    assert.equal(w.document.querySelector('.schedule-message'), null);
    w = mount([], `#/profile/employer/schedule/${second}`, { offline: true });
    await until(() => w.document.body.textContent.includes('通信状況を確認'), 'cold offline error');
    w.qaEntries = entries; w.qaOffline = false;
    button(w, '再読み込み').click();
    await until(() => w.document.querySelector('#schedule-partner-heading')?.textContent === 'テスト乙', 'retry recovers');
    w.qaEntries = [row(second, 'テスト乙', { application_status: 'applied', terms_confirmed_farmer_at: null })];
    w.qaRefresh();
    await until(() => w.document.querySelector('.schedule-phase')?.textContent === '応募中', 'realtime refresh updates phase');
    assert.equal(button(w, '労働条件通知書を確認'), undefined);
    assert.equal(w.qaCalls.filter(c => c.method !== 'GET' && c.path !== 'rpc/get_my_calendar_jobs').length, 0, 'no mutations');
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
