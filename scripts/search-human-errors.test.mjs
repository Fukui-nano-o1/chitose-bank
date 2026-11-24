import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = path.join(root, 'scripts/fixtures/search-human-virtual.jsx');
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JobSearchMapView} from '${root}src/features/jobs/search/JobSearchMapView.jsx';
flushSync(() => createRoot(document.getElementById('root')).render(<JobSearchMapView me={null} />));
`;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const demoJob = (job_number, crop = 'ブロッコリー') => ({
  job_number, crop, task: '選別', city: '合成市', date_start: '2099-11-01',
  date_end: '2099-11-01', pay: 5000, headcount: 2, status: 'open', photos: [], masked_fields: [],
});
const pause = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, ms = 850) {
  const deadline = Date.now() + ms;
  do { const result = fn(); if (result) return result; await pause(); } while (Date.now() < deadline);
  assert.fail(message);
}
const textButton = (w, text) => [...w.document.querySelectorAll('button')].find(x => x.textContent.trim() === text);

test('signed-out job search handles real human recovery paths with a synthetic network boundary', async t => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'cb-search-human-'));
  let dom;
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{ name: 'search-human-fixture', enforce: 'pre', resolveId(id) {
        if (id === entry) return id;
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/search-human-client.js');
      }, load(id) { if (id === entry) return fixture; } }, react()],
      build: { outDir, lib: { entry, name: 'SearchHumanQA', formats: ['iife'], fileName: 'fixture' }, minify: false },
    });
    const script = await readFile(path.join(outDir, 'fixture.iife.js'), 'utf8');
    const mount = ({ list = () => Promise.resolve(json([])), detail = [], filters = null, hash = '/search', fromSearch = false } = {}) => {
      dom?.window.close();
      const virtualConsole = new VirtualConsole();
      const errors = [];
      virtualConsole.on('jsdomError', err => errors.push(err.message));
      dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example/#' + (fromSearch ? '/search' : hash), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
      const w = dom.window;
      Object.assign(w, { Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder,
        qaList: list, qaListCount: 0, qaDetailRequests: [], qaDetail: new Map(detail), qaErrors: errors,
        IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
        ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        scrollTo() {}, fetch() { throw new Error('Real network unavailable in this test'); },
      });
      w.HTMLElement.prototype.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      if (filters) w.localStorage.setItem('cb_searchFilters', JSON.stringify(filters));
      if (fromSearch) w.history.pushState({}, '', '#' + hash);
      w.eval(script);
      return w;
    };
    await t.test('first read failure settles and can be retried without reloading the page', async () => {
      let requestCount = 0;
      const w = mount({ list: () => ++requestCount === 1
        ? Promise.resolve(json({ message: 'fixture unavailable' }, 400))
        : Promise.resolve(json([demoJob(7001)])) });
      const retry = await until(() => textButton(w, '求人を再読み込み'), 'request failure never exposed a retry');
      assert.doesNotMatch(w.document.body.textContent, /現在、募集中の求人はありません/);
      retry.click();
      retry.click(); // same interaction turn / stale DOM reference must not create another retry
      await until(() => w.document.body.textContent.includes('ブロッコリー'), 'retry never showed the recovered listing');
      assert.equal(w.qaListCount, 2);
      assert.deepEqual(w.qaErrors, []);
    });
    await t.test('previously selected crop remains removable after the last matching job closes', async () => {
      const w = mount({ list: () => Promise.resolve(json([demoJob(7001)])), filters: { w: ['ニンジン'], r: ['合成市'], d: null } });
      await until(() => w.document.body.textContent.includes('条件に合う求人が見つかりませんでした'), 'initial persistent filter did not affect results');
      w.document.querySelector('.cb-search-fab button, button.cb-search-fab').click();
      const chip = await until(() => textButton(w, 'ニンジン'), 'selected crop vanished from the filter editor');
      chip.click();
      await until(() => w.document.body.textContent.includes('1件を表示'), 'removing one filter should preserve the region and reveal one result');
      assert.deepEqual(JSON.parse(w.localStorage.getItem('cb_searchFilters')), { w: [], r: ['合成市'], d: null });
    });
    await t.test('floating clear is a separate focusable native control and does not open filters', async () => {
      const w = mount({ list: () => Promise.resolve(json([demoJob(7001)])), filters: { w: ['ニンジン'], r: [], d: null } });
      const clear = w.document.querySelector('.cb-search-fab [aria-label="条件をクリア"]');
      assert.equal(clear?.tagName, 'BUTTON', 'clear should be a native keyboard-operable button');
      assert.equal(clear.closest('button'), clear, 'clear should not be nested in the open control');
      assert.equal(clear.parentElement.closest('button'), null);
      clear.focus();
      assert.equal(w.document.activeElement, clear);
      clear.click();
      assert.equal(w.document.querySelector('.cb-search-overlay'), null);
      await until(() => w.document.body.textContent.includes('ブロッコリー'), 'clear should restore all jobs');
    });
    await t.test('superseded detail completion must not hide loading for the newer route', async () => {
      let resolveOld;
      const old = new Promise(resolve => { resolveOld = resolve; });
      const current = new Promise(() => {});
      const w = mount({ hash: '/work/job/7002', detail: [['in.(7002)', old], ['in.(7003)', current]], list: () => new Promise(() => {}) });
      await until(() => w.qaDetailRequests.includes('in.(7002)'), 'old detail request not sent');
      w.location.hash = '/work/job/7003';
      await until(() => w.qaDetailRequests.includes('in.(7003)'), 'new detail request not sent');
      resolveOld(json([])); // complete the older request with no match while the new one remains pending
      await pause(120);
      assert.equal(w.location.hash, '#/work/job/7003');
      assert.match(w.document.body.textContent, /読み込み中/, 'old completion removed the newer detail loading state');
      assert.equal(w.document.querySelector('.cb-search-fab'), null);
    });
    await t.test('pressing Back before a direct job response arrives does not reopen it', async () => {
      let resolveDetail;
      const pending = new Promise(resolve => { resolveDetail = resolve; });
      const w = mount({ hash: '/work/job/7002', fromSearch: true, detail: [['in.(7002)', pending]], list: () => new Promise(() => {}) });
      await until(() => w.document.body.textContent.includes('読み込み中'), 'loading route not mounted');
      await until(() => w.qaDetailRequests.includes('in.(7002)'), 'detail request not sent');
      w.history.back();
      await until(() => !!w.document.querySelector('.cb-search-fab'), 'search did not return');
      resolveDetail(json([demoJob(7002, '戻った後の古い求人')]));
      await pause(120);
      assert.equal(w.location.hash, '#/search');
      assert.equal(w.document.querySelector('.job-detail-body-mobile'), null, 'late response reopened old detail');
    });
  } finally {
    dom?.window.close();
    await rm(outDir, { recursive: true, force: true });
  }
});
