import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const plain = value => JSON.parse(JSON.stringify(value));
const row = (id, extra = {}) => ({ job_number: id, crop: '合成作物', task: '収穫',
  date_start: '2099-01-01', work_time: '08:00〜17:00', headcount: 2, ...extra });

test('search feature relocation preserves data, cache and compatibility contracts', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'search-jobs-test-'));
  let dom;
  try {
    await build({ configFile: false, root, logLevel: 'error',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{ name: 'isolated-search-data', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/search-jobs-client.js');
      } }],
      build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/search-jobs-entry.js'),
        name: 'SearchDataQA', formats: ['iife'], fileName: 'fixture' }, minify: false },
    });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    const mount = () => {
      dom?.window.close();
      dom = new JSDOM('', { url: 'https://search-data.test', runScripts: 'outside-only' });
      dom.window.fetch = () => { throw new Error('Unexpected network'); };
      dom.window.eval(script);
      return dom.window;
    };

    await t.test('old and feature imports share every export and the same in-flight request', async () => {
      const w = mount(), { legacy, feature } = w.qaSearch;
      assert.deepEqual(Object.keys(legacy).sort(), Object.keys(feature).sort());
      for (const key of Object.keys(legacy)) assert.equal(legacy[key], feature[key], key);
      const request = legacy.fetchPublicJobs();
      assert.equal(feature.fetchPublicJobs(), request);
      assert.equal(w.qaSearchRequests.length, 1);
      const query = w.qaSearchRequests[0];
      assert.deepEqual(plain({ table: query.table, columns: query.columns, method: query.method, args: query.args }),
        { table: 'jobs_public', columns: '*', method: 'order', args: ['job_number', { ascending: false }] });
      query.resolve({ data: [row(17)] });
      assert.equal((await request)[0].id, 17);
      const next = feature.fetchPublicJobs();
      assert.notEqual(next, request, 'completed data is not retained as an in-flight request');
      w.qaSearchRequests[1].resolve({ data: [] });
      await next;
    });

    await t.test('scope, explicit freshness and confirmed updates do not reuse stale requests', async () => {
      const w = mount(), { feature, refresh } = w.qaSearch;
      const first = feature.fetchPublicJobs({ scope: 'fixture-a' });
      const other = feature.fetchPublicJobs({ scope: 'fixture-b' });
      const fresh = feature.fetchPublicJobs({ scope: 'fixture-a', fresh: true });
      assert.notEqual(first, other);
      assert.notEqual(first, fresh);
      assert.equal(feature.fetchPublicJobs({ scope: 'fixture-a' }), fresh);
      w.qaSearchRequests[0].resolve({ data: [] });
      await first;
      assert.equal(feature.fetchPublicJobs({ scope: 'fixture-a' }), fresh, 'older completion must not clear the newer pending entry');
      refresh();
      const updated = feature.fetchPublicJobs({ scope: 'fixture-a' });
      assert.notEqual(updated, fresh);
      assert.equal(w.qaSearchRequests.length, 4);
      for (const query of w.qaSearchRequests.slice(1)) query.resolve({ data: [] });
      await Promise.all([other, fresh, updated]);
    });

    await t.test('error and rejected reads return null and permit retry', async () => {
      const w = mount(), { feature } = w.qaSearch;
      for (const reject of [false, true]) {
        const request = feature.fetchPublicJobs();
        const query = w.qaSearchRequests.at(-1);
        if (reject) query.reject(new Error('synthetic offline'));
        else query.resolve({ data: null, error: { message: 'synthetic failure' } });
        assert.equal(await request, null);
      }
      const retry = feature.fetchPublicJobs();
      assert.equal(w.qaSearchRequests.length, 3);
      w.qaSearchRequests.at(-1).resolve({ data: [row(17)] });
      assert.equal((await retry)[0].id, 17);
    });

    await t.test('ordering retains active order, replaces rows, and excludes closed or expired jobs', () => {
      const w = mount(), { feature, mapJobPublicRow } = w.qaSearch;
      const jobs = [row(1), row(2, { hired_count: 2 }), row(3, { date_start: '2000-01-01' }),
        row(4, { status: 'closed' }), row(5), row(6, { hired_count: 2 })].map(mapJobPublicRow);
      const previous = [{ ...jobs[0], crop: '古い合成表示' }, jobs[1], jobs[2], jobs[3]];
      const result = feature.orderSearchJobs(jobs, previous);
      assert.deepEqual(Array.from(result.list, job => job.id), [5, 1, 2, 6]);
      assert.equal(result.list[1].crop, '合成作物');
      jobs[0].isNew = true;
      feature.recordSeenNewIds([5]);
      jobs[4].isNew = true;
      const initial = feature.orderSearchJobs(jobs, null);
      assert.equal(initial.list[0].id, 1);
      assert.deepEqual(Array.from(initial.freshNew, job => job.id), [1]);
      assert.ok(initial.list.slice(-2).every(job => job.filled));
    });

    await t.test('prefetch shares the pending list and records only its accepted new rows', async () => {
      const w = mount(), { feature, legacy, getCache } = w.qaSearch;
      const prefetch = legacy.prefetchSearchJobs();
      const consumer = feature.fetchPublicJobs();
      assert.equal(w.qaSearchRequests.length, 1);
      w.qaSearchRequests[0].resolve({ data: [row(17, { opened_at: new Date().toISOString() })] });
      await Promise.all([prefetch, consumer]);
      assert.deepEqual(Array.from(getCache('search:jobs'), job => job.id), [17]);
      assert.deepEqual(Array.from(feature.readSeenNewIds()), [17]);
      await feature.prefetchSearchJobs();
      assert.equal(w.qaSearchRequests.length, 1, 'an existing cache prevents another prefetch');
    });

    await t.test('late prefetch cannot overwrite a newer cache or confirmed refresh', async () => {
      for (const reason of ['cache', 'refresh', 'error']) {
        const w = mount(), { feature, setCache, getCache, refresh } = w.qaSearch;
        const prefetch = feature.prefetchSearchJobs();
        if (reason === 'cache') setCache('search:jobs', [{ id: 99 }]);
        if (reason === 'refresh') refresh();
        w.qaSearchRequests[0].resolve(reason === 'error' ? { data: null, error: {} }
          : { data: [row(17, { opened_at: new Date().toISOString() })] });
        await prefetch;
        assert.deepEqual(getCache('search:jobs') === undefined ? undefined : plain(getCache('search:jobs')),
          reason === 'cache' ? [{ id: 99 }] : undefined, reason);
        assert.deepEqual(Array.from(feature.readSeenNewIds()), [], `${reason}: rejected prefetch must not mark rows seen`);
      }
    });

    await t.test('seen-new storage tolerates malformed data and remains bounded', () => {
      const w = mount(), { feature } = w.qaSearch;
      for (const stored of ['broken JSON', '{}', 'null']) {
        w.localStorage.setItem('cb_seenNewJobs', stored);
        assert.deepEqual(Array.from(feature.readSeenNewIds()), []);
      }
      feature.recordSeenNewIds(Array.from({ length: 310 }, (_, index) => index));
      assert.deepEqual(Array.from(feature.readSeenNewIds()), Array.from({ length: 300 }, (_, index) => index + 10));
    });

    await t.test('view reads and counters retain empty/error handling and local duplicate guards', async () => {
      const w = mount(), { feature, legacy } = w.qaSearch;
      assert.deepEqual(plain(await feature.fetchJobViewCounts([NaN, '17', null])), {});
      assert.equal(w.qaSearchRequests.length, 0);
      const read = feature.fetchJobViewCounts([17, NaN]);
      assert.deepEqual(plain(w.qaSearchRequests[0].args), ['job_number', [17]]);
      w.qaSearchRequests[0].resolve({ data: [{ job_number: 17, view_count: '4' }] });
      assert.deepEqual(plain(await read), { 17: 4 });
      const failed = feature.fetchJobViewCounts([17]);
      w.qaSearchRequests[1].resolve({ data: null, error: {} });
      assert.equal(await failed, null, 'read failure must not become a successful empty count');
      assert.equal(feature.countJobView(NaN, true), false);
      assert.equal(feature.countJobView(17, false), false);
      assert.equal(w.qaViewCalls.length, 0);
      assert.equal(feature.countJobView(17, true), true);
      assert.equal(legacy.countJobView(17, true), false);
      w.sessionStorage.setItem('cb_jobViewed_17', String(Date.now() - 11 * 60 * 1000));
      w.qaRejectView = true;
      assert.equal(legacy.countJobView(17, true), true, 'count failure must not interrupt viewing');
      await Promise.resolve();
      assert.deepEqual(plain(w.qaViewCalls), [
        { name: 'count_job_view', args: { p_job_number: 17 } },
        { name: 'count_job_view', args: { p_job_number: 17 } },
      ]);
    });
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
