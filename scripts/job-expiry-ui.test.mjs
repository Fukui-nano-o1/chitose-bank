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

    function mount(jobs, now, hash = '#/work', signedIn = false) {
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

    // A worker who began confirmation before the deadline cannot keep a stale
    // submission overlay open after the job ends.
    w = mount([ending, future], '2026-09-22T09:59:59.800+09:00', '#/work/job/201', true);
    const apply = w.document.querySelector('[data-guide="apply-btn"]');
    assert.ok(apply && !apply.disabled, 'signed-in worker can begin confirmation');
    apply.click();
    await until(() => w.document.querySelector('.cb-box-overlay .cb-notice-sheet'), 'application confirmation opened');
    w.qaSetNow('2026-09-22T10:00:00+09:00');
    await until(() => !w.document.querySelector('.cb-box-overlay .cb-notice-sheet'), 'expired application confirmation removed');
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
