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
async function until(predicate, label, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out: ${label}`);
    await pause(10);
  }
}

// Deliberately use the previous build's persisted shape and stale flags. These
// records are restored by the real viewCache/readCachedJobs path.
const cachedJob = (id, date, overrides = {}) => ({
  id, crop: `テスト作物${id}`, task: '収穫', region: '徳島県吉野川市', cityArea: '徳島県吉野川市',
  dateLabel: date, dateStartRaw: date, dateEndRaw: date, dateStart: date, dateEnd: date,
  workTime: '08:00〜17:00', payType: 'daily', pay: 10000, count: '2名', headcount: 2,
  closed: false, filled: false, expired: false, hiredCount: 0, isNew: false,
  photos: [], holidays: [], maskedFields: [], dangerPlaces: [], dangerTasks: [],
  ...overrides,
});
const cards = w => [...w.document.querySelectorAll('a[data-guide="job-card"]')]
  .map(a => Number(a.getAttribute('href').split('/').pop()));
const listingRequests = w => w.qaRequests.filter(r => r.path === '/rest/v1/jobs_public').length;

test('real search/detail UI expires stale cached jobs offline and at the deadline without refetch', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-job-expiry-ui-'));
  let dom;
  const errors = [];
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'job-expiry-fixture', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/job-expiry/client.js');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/job-expiry/entry.jsx'), name: 'JobExpiryQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');

    function mount(jobs, now, hash = '#/work', signedIn = false, storedSession = {}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError', e => { if (!/CSS|navigation/.test(e.message)) errors.push(e.message); });
      console.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>', { url: `https://ui.test/${hash}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
      const w = dom.window;
      const NativeDate = w.Date;
      let clock = NativeDate.parse(now);
      w.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      w.qaSetNow = next => { clock = NativeDate.parse(next); };
      Object.assign(w, { Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollTo = () => {};
      w.HTMLElement.prototype.scrollBy = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.fetch = () => { errors.push('Unexpected network'); return Promise.reject(new Error('Unexpected network')); };
      w.alert = message => errors.push(message);
      const cache = { 'search:jobs': jobs };
      if (signedIn) {
        w.qaMe = { id: '00000000-0000-4000-8000-000000000001', email: 'worker@fixture.test' };
        w.localStorage.setItem('cb_snap_me', JSON.stringify(w.qaMe));
        Object.assign(cache, { 'search:myJobNums': [], 'search:myApps': {}, 'search:myPend': [] });
        // Viewing this test job was already counted; this scenario concerns
        // application submission, so no view-count mutation is needed.
        for (const job of jobs) w.sessionStorage.setItem(`cb_jobViewed_${job.id}`, String(clock));
      }
      const scope = signedIn ? w.qaMe.id.slice(0, 8) : 'anon';
      w.localStorage.setItem(`cb_viewCache_v2_${scope}`, JSON.stringify(cache));
      for (const [key, value] of Object.entries(storedSession)) w.sessionStorage.setItem(key, value);
      w.eval(script);
      assert.equal(w.qaMounted, true, 'actual search component committed');
      return w;
    }

    const past = cachedJob(101, '2026-09-21');
    const today = cachedJob(102, '2026-09-22');
    const future = cachedJob(103, '2026-09-24');
    let w = mount([past, today, future], '2026-09-22T12:00:00+09:00');
    assert.deepEqual(cards(w), [102, 103], 'past job never flashes even while jobs_public is unresponsive');
    await pause(30);
    assert.equal(listingRequests(w), 1);

    // The fetched-row merge is shared with entrance prefetch. A fresh server
    // response must not reintroduce an ended row from the previous ordering or
    // register it as a newly seen job.
    const rows = [
      { job_number: 101, date_start: '2026-09-21', opened_at: '2026-09-22T09:00:00+09:00' },
      { job_number: 102, date_start: '2026-09-22' },
      { job_number: 103, date_start: '2026-09-24' },
      { job_number: 104, date_start: '2026-09-24', opened_at: '2026-09-22T09:00:00+09:00' },
      { job_number: 105, date_start: '2026-09-24', status: 'closed', opened_at: '2026-09-22T09:00:00+09:00' },
      { job_number: 106, date_start: '2026-09-24', headcount: 1, hired_count: 1 },
    ].map(row => w.qaMapJobPublicRow({ work_time: '08:00〜17:00', ...row }));
    const merged = w.qaOrderSearchJobs(rows, [past, today, future]);
    assert.deepEqual(Array.from(merged.list, job => job.id), [104, 102, 103, 106], 'fresh response filters ended rows while preserving active order and future filled jobs');
    assert.deepEqual(Array.from(merged.freshNew, job => job.id), [104], 'ended new jobs never enter seen-new IDs');

    // Resume from a suspended/background tab after midnight in Japan. The
    // network remains hung; focus alone must invalidate yesterday's card.
    w.qaSetNow('2026-09-23T00:01:00+09:00');
    w.dispatchEvent(new w.Event('focus'));
    await until(() => cards(w).join(',') === '103', 'focus rechecks expiry');
    assert.equal(listingRequests(w), 1, 'focus expiry does not fetch the list again');

    w = mount([today, future], '2026-09-22T12:00:00+09:00');
    w.qaSetNow('2026-09-23T00:01:00+09:00');
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    await until(() => cards(w).join(',') === '103', 'visibility resume rechecks expiry');
    assert.equal(listingRequests(w), 1, 'visibility expiry does not fetch the list again');

    // Stay on the page across its exact work end time, with no focus, route or
    // server event. A normal render must be scheduled by the expiry clock.
    const ending = cachedJob(201, '2026-09-22', { workTime: '08:00〜10:00' });
    w = mount([ending, future], '2026-09-22T09:59:59.800+09:00');
    assert.deepEqual(cards(w), [201, 103]);
    await pause(30);
    const requestCount = listingRequests(w);
    w.qaSetNow('2026-09-22T10:00:00+09:00');
    await until(() => cards(w).join(',') === '103', 'end-time timer removes job at exactly 10:00 JST');
    assert.equal(listingRequests(w), requestCount, 'deadline does not cause another list request');

    w = mount([ending, future], '2026-09-22T09:59:59.800+09:00', '#/work/job/201');
    await until(() => w.document.querySelector('[data-guide="apply-btn"]') && !w.document.querySelector('[data-guide="apply-btn"]').disabled, 'live detail initially allows apply');
    w.qaSetNow('2026-09-22T10:00:00+09:00');
    await until(() => w.document.querySelector('[data-guide="apply-btn"]')?.disabled, 'open detail expires at its end time');
    assert.equal(w.document.querySelector('[data-guide="apply-btn"]').textContent.trim(), '募集終了');
    assert.match(w.document.body.textContent, /テスト作物201/, 'detail remains readable after its deadline');

    // All entry routes show real pages; dates survive history and remounts.
    const period = cachedJob(301, '2026-09-24', { dateEndRaw: '2026-09-27', dateEnd: '2026-09-27', holidays: ['2026-09-25'] });
    w = mount([period], '2026-09-22T12:00:00+09:00', '#/work/job/301', true);
    w.qaApplyMode = 'error';
    const clickPage = text => {
      const button = [...w.document.querySelectorAll('.application-page button')].find(b => b.textContent.trim() === text);
      assert.ok(button && !button.disabled, `enabled ${text}`); button.click();
    };
    w.document.querySelector('[data-guide="apply-btn"]').click();
    await until(() => w.location.hash.endsWith('/apply/intro') && w.document.querySelector('.application-page'), 'detail enters routed page');
    assert.equal(w.document.querySelectorAll('.cb-box-overlay').length, 0, 'no old confirmation box');
    clickPage('次へ'); await until(() => w.document.querySelector('.application-page h1')?.textContent === '応募前の確認', 'about route');
    clickPage('次へ'); await until(() => w.document.querySelector('.application-page-dates'), 'date route');
    const dayButtons = [...w.document.querySelectorAll('.application-page-dates button')];
    assert.equal(dayButtons.length, 3, 'holiday is not offered');
    dayButtons[2].click(); await pause(20); dayButtons[0].click(); await pause(20);
    clickPage('次へ'); await until(() => w.document.querySelector('.application-page h1')?.textContent === '応募の最終確認', 'final confirmation');
    assert.match(w.document.querySelector('.application-page-content').textContent, /2日/);
    clickPage('戻る'); await until(() => w.document.querySelector('.application-page-dates'), 'same return path');
    assert.equal(w.document.querySelectorAll('.application-page-dates [aria-pressed=true]').length, 2);
    clickPage('次へ'); await until(() => w.document.querySelector('.application-page h1')?.textContent === '応募の最終確認', 'confirm again');
    // A transient server failure must retain the page and choice, with retry possible.
    const alerts = []; w.alert = message => alerts.push(message);
    clickPage('応募する');
    await until(() => alerts.length === 1, 'failed submission explained');
    assert.ok(w.document.querySelector('.application-page'));
    const requests = w.qaRequests.filter(r => r.path.endsWith('/apply_to_job'));
    assert.equal(requests.length, 1);
    assert.deepEqual(Array.from(requests[0].body.p_available_dates), ['2026-09-24', '2026-09-27']);
    assert.equal(w.document.querySelector('.application-page-footer .btn-primary').disabled, false);
    w.qaApplyMode = 'success'; clickPage('応募する');
    await until(() => w.location.hash === '#/apply/done', 'existing success route retained');
    assert.equal(w.qaRequests.filter(r => r.path.endsWith('/apply_to_job')).length, 2);

    w = mount([period], '2026-09-22T12:00:00+09:00', '#/work/job/301/apply/dates', true);
    await until(() => w.document.querySelector('.application-page-dates'), 'direct route works');
    assert.equal(w.document.querySelector('.application-page-footer .btn-primary').disabled, true, 'no empty period submission');
    clickPage('期間中いつでもOK'); await pause(20);
    clickPage('次へ'); await until(() => w.document.querySelector('.application-page h1')?.textContent === '応募の最終確認', 'any also gets final confirmation');
    assert.match(w.document.querySelector('.application-page-content').textContent, /期間中いつでもOK/);
    w.qaApplyMode = 'success'; clickPage('応募する');
    await until(() => w.location.hash === '#/apply/done', 'any submission');
    assert.equal(w.qaRequests.find(r => r.path.endsWith('/apply_to_job')).body.p_available_dates, 'any');

    const draftKey = 'cb_application_dates_v1_00000000-0000-4000-8000-000000000001_301';
    w = mount([period], '2026-09-22T12:00:00+09:00', '#/work/job/301/apply/confirm', true, {
      [draftKey]: JSON.stringify({ choice: 'dates', dates: ['2026-09-24', '2026-09-25', '2026-09-27'] }),
    });
    await until(() => w.document.querySelector('.application-page'), 'reloaded final page');
    assert.match(w.document.querySelector('.application-page-content').textContent, /2日/, 'reload restores available dates and removes holiday');
    clickPage('戻る'); await until(() => w.document.querySelector('.application-page-dates'), 'direct page has fallback back route');
    assert.equal(w.document.querySelectorAll('.application-page-dates [aria-pressed=true]').length, 2);

    w = mount([future], '2026-09-22T12:00:00+09:00', '#/work/job/103', true, { cb_openApply: '103' });
    await until(() => w.document.querySelector('.application-page'), 'calendar signal enters same page');
    assert.equal(w.sessionStorage.getItem('cb_openApply'), null);
    clickPage('戻る'); await until(() => !w.document.querySelector('.application-page'), 'calendar page returns to same detail');
    assert.equal(w.location.hash, '#/work/job/103');
    assert.match(w.document.body.textContent, /テスト作物103/);

    w = mount([future], '2026-09-22T12:00:00+09:00', '#/work/job/103/apply/dates', true);
    w.qaApplyMode = 'success'; clickPage('応募する');
    await until(() => w.location.hash === '#/apply/done', 'single day submission');
    assert.equal(w.qaRequests.find(r => r.path.endsWith('/apply_to_job')).body.p_available_dates, null);

    // A worker who began confirmation before the deadline cannot keep a stale
    // submission overlay open after the job ends.
    w = mount([ending, future], '2026-09-22T09:59:59.800+09:00', '#/work/job/201', true);
    const apply = w.document.querySelector('[data-guide="apply-btn"]');
    assert.ok(apply && !apply.disabled, 'signed-in worker can begin confirmation');
    apply.click();
    await until(() => w.document.querySelector('.application-page'), 'application page opened');
    w.qaSetNow('2026-09-22T10:00:00+09:00');
    await until(() => w.document.querySelector('.application-page-footer .btn-primary')?.disabled, 'expired application page blocks progression');
    assert.match(w.document.querySelector('.application-page').textContent, /新規応募は現在受け付けていません/);
    w.document.querySelector('.application-page-back').click();
    await until(() => !w.document.querySelector('.application-page'), 'expired page can return to job');
    assert.equal(w.document.querySelector('[data-guide="apply-btn"]').disabled, true);
    assert.equal(w.qaRequests.filter(r => /(?:apply_to_job|create_pending_application)$/.test(r.path)).length, 0, 'no application mutation attempted');

    // History URLs stay useful. An expired job can be opened from the same old
    // cache, but cannot offer a new application or appear in related jobs.
    w = mount([past, today, future], '2026-09-22T12:00:00+09:00', '#/work/job/101');
    assert.match(w.document.body.textContent, /テスト作物101/);
    await until(() => w.document.querySelector('[data-guide="apply-btn"]')?.disabled, 'ended direct link disables apply');
    assert.equal(w.document.querySelector('[data-guide="apply-btn"]').textContent.trim(), '募集終了');
    assert.deepEqual(cards(w), [102, 103], 'related jobs contain only active jobs');

    w = mount([past, today, future], '2026-09-22T12:00:00+09:00', '#/work/job/103');
    assert.deepEqual(cards(w), [102], 'expired past job is excluded from active job recommendations');
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(`Browser errors: ${JSON.stringify(errors)}\nScreen: ${dom?.window.document.body.textContent}\nRequests: ${JSON.stringify(dom?.window.qaRequests)}`);
    throw error;
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
