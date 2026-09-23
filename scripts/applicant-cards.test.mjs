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
  while (!predicate()) { assert.ok(Date.now() < deadline, `timed out: ${label}`); await pause(10); }
}
const button = (el, label) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === label);
const card = (w, id) => w.document.querySelector(`[data-application-id="${id}"]`);
const job = { job_number: 1311, crop: 'ブロッコリー', task: '播種', date_start: '2026-09-24', date_end: '2026-09-30', work_time: '10:00〜12:00', photos: [], holidays: ['2026-09-26'] };
const app = (id, overrides = {}) => ({ id, job_number: 1311, worker_id: `worker-${id}`, status: 'approved',
  created_at: '2026-09-22T09:00:00+09:00', agreed_dates: ['2026-09-24'],
  terms_confirmed_worker_at: '2026-09-22', terms_confirmed_farmer_at: '2026-09-22', ...overrides });
const props = application => ({ application, job, jobNumber: 1311, profile: { nickname: `応募者${application.id}` } });

test('applicant cards keep per-person actions, schedule accuracy, and closed-state gates; dashboard retains scoped navigation and filters', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-applicant-cards-'));
  let dom;
  const errors = [];
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'applicant-fixture', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/applicants/client.js');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/applicants/entry.jsx'), name: 'ApplicantsQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    function mount(cards, { dashboard = false, focus = null } = {}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError', e => { if (!/CSS|navigation/.test(e.message)) errors.push(e.message); });
      console.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>', { url: 'https://ui.test/#/profile/employer/applicants', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
      const w = dom.window;
      const NativeDate = w.Date;
      let now = NativeDate.parse('2026-09-23T09:00:00+09:00');
      w.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      };
      w.qaSetNow = value => { now = NativeDate.parse(value); };
      Object.assign(w, { Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder });
      w.qaMe = { id: '30000000-0000-4000-8000-000000000003' };
      w.qaCards = cards;
      w.qaDashboard = dashboard;
      w.qaActions = []; w.qaRequests = []; w.qaUnexpected = [];
      w.qaJobs = [job];
      w.qaBundle = { apps: cards.map(p => p.application), profiles: cards.map(p => ({ auth_id: p.application.worker_id, ...p.profile })), todo: [], reviewed_ids: [] };
      w.localStorage.setItem('cb_snap_me', JSON.stringify(w.qaMe));
      if (focus) w.sessionStorage.setItem('cb_applicantsJobNo', String(focus));
      w.fetch = () => { errors.push('Unexpected network'); return Promise.reject(new Error('Unexpected network')); };
      w.alert = message => errors.push(message);
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.eval(script);
      return w;
    }

    const cards = [
      props(app('pending', { status: 'applied', terms_confirmed_farmer_at: null, agreed_dates: null, available_dates: ['2026-09-25', '2026-09-27'] })),
      props(app('interview', { terms_confirmed_farmer_at: null })),
      props(app('first')),
      { ...props(app('second', { agreed_dates: ['2026-09-25', '2026-09-26', '2026-09-28'] })), needsAttention: true },
      props(app('insured', { insurance_prepared_at: '2026-09-22' })),
      props(app('working', { status: 'working', agreed_dates: ['2026-09-24', '2026-09-30'] })),
      props(app('complete', { status: 'completed' })),
      { ...props(app('reviewed', { status: 'completed' })), reviewed: true },
      props(app('absent', { status: 'completed', attended: false })),
      ...['rejected', 'expired', 'canceled'].map(status => props(app(status, { status }))),
    ];
    let w = mount(cards);
    assert.equal(w.document.querySelectorAll('.applicant-card').length, cards.length, 'one card per applicant, including shared job');
    assert.equal(w.document.querySelectorAll('button button, button [role="button"]').length, 0, 'no nested interactive status chip');
    assert.match(card(w, 'pending').querySelector('.applicant-card-schedule').textContent, /来られる日全2日次回 9\/25/);
    assert.match(card(w, 'second').querySelector('.applicant-card-schedule').textContent, /働く日全2日次回 9\/25/);
    assert.doesNotMatch(card(w, 'second').querySelector('.applicant-card-schedule').textContent, /9\/26|9\/30/, 'holidays and other applicants dates are absent');
    assert.equal(card(w, 'second').querySelector('.applicant-card-dates').open, false);
    assert.match(card(w, 'first').querySelector('.applicant-card-when').textContent, /9\/24.*10:00〜12:00/);
    button(card(w, 'pending'), '応募内容を確認').click();
    button(card(w, 'interview'), '採用する').click();
    button(card(w, 'second'), '保険の報告').click();
    button(card(w, 'second'), 'チャット').click();
    button(card(w, 'second'), '労働条件通知書›').click();
    button(card(w, 'complete'), '評価する').click();
    assert.deepEqual(Array.from(w.qaActions, a => [a.name, a.value?.id || a.value]), [
      ['OpenDetails', 'pending'], ['Hire', 'interview'], ['Insurance', 'second'], ['Chat', 'second'], ['Notice', 'second'], ['Review', 'complete'],
    ]);
    assert.equal(button(card(w, 'interview'), '労働条件通知書›'), undefined, 'no notice before hire');
    for (const id of ['reviewed', 'absent']) {
      assert.equal(button(card(w, id), '評価する'), undefined);
      assert.ok(button(card(w, id), 'チャット'));
      assert.ok(button(card(w, id), '労働条件通知書›'), 'finished records remain accessible');
    }
    assert.match(card(w, 'insured').textContent, /保険 報告済み/);
    assert.equal(button(card(w, 'insured'), '保険の報告'), undefined);
    for (const status of ['rejected', 'expired', 'canceled']) {
      assert.equal(card(w, status).querySelector('.applicant-card-actions'), null, 'closed application has no hiring/recording actions');
      assert.equal(card(w, status).querySelector('.applicant-card-detail'), null);
    }
    assert.match(card(w, 'expired').querySelector('.applicant-card-status').textContent, /失効/, 'no fake applied status for expired cards');

    const report = button(card(w, 'working'), '今日の記録');
    assert.equal(report.disabled, true, 'record gate closed before work');
    report.click();
    assert.equal(w.qaActions.length, 6);
    // The same shared gate uses local work time; make the test independent of CI timezone.
    w.qaSetNow('2026-09-24T10:30:00'); w.qaRender();
    assert.equal(button(card(w, 'working'), '今日の記録').disabled, false);
    button(card(w, 'working'), '今日の記録').click();
    assert.equal(w.qaActions.at(-1).value.id, 'working');
    w.qaSetNow('2026-09-24T15:01:00'); w.qaRender();
    assert.equal(button(card(w, 'working'), '今日の記録').disabled, true);
    w.qaSetNow('2026-09-30T12:00:00'); w.qaRender();
    assert.ok(button(card(w, 'working'), '評価する'), 'final evaluation appears only after last work ends');

    // Real dashboard wiring: two people on one job must open their own notice/chat/insurance.
    const dashboardCards = [props(app('first')), props(app('second')), props(app('expired', { status: 'expired' }))];
    w = mount(dashboardCards, { dashboard: true });
    await until(() => card(w, 'second'), 'dashboard loaded');
    assert.equal(w.document.querySelector('.cb-applicant-filter-bar'), null, 'filters no longer float over card actions');
    w.document.querySelector('[aria-label="失効を非表示"]').click();
    await until(() => !card(w, 'expired'), 'filter hides ended application');
    assert.equal(w.sessionStorage.getItem('cb_appHidden_v2'), '["expired"]');
    assert.ok(card(w, 'second'));
    w.document.querySelector('[aria-label="失効を非表示"]').click();
    await until(() => card(w, 'expired'), 'filter restores ended application');
    button(card(w, 'second'), '労働条件通知書›').click();
    await until(() => w.document.querySelector('.cb-ctr-print')?.textContent.includes('worker-second専用の通知書'), 'notice for selected applicant');
    assert.doesNotMatch(w.document.querySelector('.cb-ctr-print').textContent, /worker-first専用/);
    assert.ok(w.qaRequests.some(r => r.path === 'applications' && r.query.includes('farmer_id=eq.30000000-0000-4000-8000-000000000003')));
    assert.deepEqual(Array.from(w.qaUnexpected), []);

    w = mount(dashboardCards, { dashboard: true });
    await until(() => card(w, 'second'), 'dashboard remounted');
    button(card(w, 'second'), 'チャット').click();
    await until(() => w.location.hash === '#/chat/second', 'chat for selected applicant');
    button(card(w, 'second'), '保険の報告').click();
    await until(() => w.location.hash === '#/calendar/todo/insurance', 'existing insurance page');
    assert.equal(w.sessionStorage.getItem('cb_insuranceAppId'), 'second');

    w = mount([], { dashboard: true, focus: 1311 });
    await until(() => w.document.querySelector('.applicant-card-empty'), 'focused job with no applicants');
    assert.match(w.document.querySelector('.applicant-card').textContent, /応募はまだありません/);
    assert.equal(w.document.querySelector('.applicant-card-actions'), null);
    assert.deepEqual(Array.from(w.qaUnexpected), []);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(`Errors: ${JSON.stringify(errors)}; Requests: ${JSON.stringify(dom?.window.qaRequests)}; Unexpected: ${JSON.stringify(dom?.window.qaUnexpected)}`);
    throw error;
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
