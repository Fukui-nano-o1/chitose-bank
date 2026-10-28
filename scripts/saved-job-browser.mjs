// Isolated Chromium checks: synthetic records, intercepted assets, no production access.
// CHROMIUM_PATH=/usr/bin/chromium node scripts/saved-job-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), 'saved-job-browser-'));
const evidence = process.env.CB_EVIDENCE_DIR || path.join(tmpdir(), 'saved-job-browser-evidence');
const origin = 'https://saved-job-browser.test';
const results = [];
let browser;
try {
  await mkdir(evidence, { recursive: true });
  await build({
    configFile: false, root, logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'isolated-saved-job-fixture', enforce: 'pre',
      resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/saved-job-ui-client.js');
      },
    }, react()],
    build: {
      outDir: output,
      lib: { entry: path.join(root, 'scripts/fixtures/saved-job-ui-entry.jsx'), name: 'SavedJobQA', formats: ['iife'], fileName: 'fixture' },
      minify: false,
    },
  });
  const css = (await readdir(output)).filter(file => file.endsWith('.css'));
  const html = `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file => `<link rel="stylesheet" href="/${file}">`).join('')}</head><body><div id="root"></div><script src="/fixture.iife.js"></script></body></html>`;
  const assets = new Map([['/', { data: html, mime: 'text/html; charset=utf-8' }]]);
  for (const file of [...css, 'fixture.iife.js']) {
    assets.set(`/${file}`, { data: await readFile(path.join(output, file)), mime: file.endsWith('.css') ? 'text/css' : 'text/javascript' });
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const mode of ['liked', 'status', 'search']) {
      console.log(JSON.stringify({ width: viewport.width, mode, stage: 'start' }));
      const context = await browser.newContext({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
      const errors = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        const item = url.origin === origin && assets.get(url.pathname);
        return item ? route.fulfill({ status: 200, contentType: item.mime, body: item.data }) : route.abort();
      });
      await context.addInitScript(mode => {
        window.qaMode = mode;
        window.qaOptions = {};
        window.qaAlerts = [];
        window.alert = message => window.qaAlerts.push(message);
      }, mode);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const startHash = mode === 'search' ? '#/search' : mode === 'liked' ? '#/profile' : '#/saved';
      await page.goto(`${origin}/${startHash}`);
      const liked = page.getByRole('button', { name: 'いいねを解除', exact: true });
      const unliked = page.getByRole('button', { name: 'いいね', exact: true });
      await liked.waitFor();
      // A denied write cannot clear the heart or the shared cache; retry stays available.
      await page.evaluate(() => { window.qaOptions.rejected = true; });
      await liked.click();
      await page.waitForFunction(() => window.qaAlerts.length === 1);
      assert.equal(await liked.count(), 1);
      assert.equal(await page.evaluate(() => window.qaGetCache('saved:rows')[0].liked), true);
      // While a response is delayed, repeated clicks must not duplicate the mutation.
      await page.evaluate(() => {
        window.qaOptions.rejected = false;
        window.qaOptions.lostResponse = true;
        window.qaOptions.beforeWrite = () => new Promise(resolve => { window.qaReleaseWrite = resolve; });
      });
      const calls = await page.evaluate(() => window.qaSaved.state.mutationCalls);
      await liked.click();
      await page.waitForFunction(() => typeof window.qaReleaseWrite === 'function');
      if (mode === 'status') assert.equal(await liked.isDisabled(), true);
      const heartBounds = await liked.boundingBox();
      assert.ok(heartBounds);
      await page.mouse.click(heartBounds.x + heartBounds.width / 2, heartBounds.y + heartBounds.height / 2);
      assert.equal(await page.evaluate(() => window.qaSaved.state.mutationCalls), calls + 1);
      assert.equal(await liked.count(), 1);
      await page.evaluate(() => window.qaReleaseWrite());
      await liked.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.qaSaved.state.saved), false);
      assert.equal(await page.evaluate(() => window.qaAlerts.length), 1);
      // Read-after-write confirmation also restores a lost-response insert.
      await page.evaluate(() => { delete window.qaOptions.beforeWrite; });
      if (mode === 'status') await page.getByRole('button', { name: '元に戻す', exact: true }).click();
      else await unliked.click();
      await liked.waitFor();
      assert.equal(await page.evaluate(() => window.qaSaved.state.saved), true);
      assert.equal(await page.evaluate(() => window.qaGetCache('saved:rows')[0].liked), true);
      assert.equal(await page.evaluate(() => window.qaAlerts.length), 1);
      // The moved profile section still records its return path and uses the same job route.
      if (mode === 'liked') {
        await page.locator('a[href="#/work/job/17"]').click();
        await page.waitForURL(`${origin}/#/work/job/17`);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('cb_jobBackTo')), '/profile');
        await page.goBack();
        await page.waitForURL(`${origin}/${startHash}`);
        await liked.waitFor();
        await page.goForward();
        await page.waitForURL(`${origin}/#/work/job/17`);
        await page.goBack();
        await page.waitForURL(`${origin}/${startHash}`);
      }
      await page.screenshot({ path: path.join(evidence, `${viewport.width}-${mode}.png`), fullPage: true });
      assert.deepEqual(errors, [], `${viewport.width}/${mode}: page errors`);
      results.push({ width: viewport.width, mode, deniedWrite: true, delayedDoubleClick: true, lostResponseRetry: true, routeBackForward: mode === 'liked', pageErrors: 0 });
      await context.close();
    }
  }
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ engine: 'Chromium', checkedAt: new Date().toISOString(), checks: results }, null, 2));
  console.log(JSON.stringify({ engine: 'Chromium', screens: results.length, checks: results, evidence }));
} finally {
  await browser?.close();
  await rm(output, { recursive: true, force: true });
}
