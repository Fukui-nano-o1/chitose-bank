// Local, synthetic-data browser check. No production requests or credentials.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), 'error-details-browser-'));
const evidence = process.env.CB_EVIDENCE_DIR || output;
await mkdir(evidence, { recursive: true });
let browser;
try {
  await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'synthetic-errors', enforce: 'pre', resolveId(id) { if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/error-diagnosis/client.js'); } }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/error-diagnosis/entry.jsx'), name: 'ErrorsQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  for (const width of [390, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' }));
    await page.goto('https://fixture.invalid/#/admin/system');
    await page.evaluate(() => {
      window.qaCalls = []; window.qaRows = [{ id: '12345678-1234-4234-8234-123456789abc', message: 'ResizeObserver loop completed with undelivered notifications.', source: 'window.onerror', component: 'global', action: 'runtime_error', created_at: '2026-11-05T19:18:00Z', status: 'open', identity_verified: true, url: 'https://fixture.invalid/#/search', user_agent: 'iPhone Version/18.0 Safari/604.1', stack: '', admin_note: '合成テスト用メモ。実機調査は未実施。' }];
    });
    await page.addStyleTag({ content: await readFile(path.join(root, 'src/index.css'), 'utf8') });
    await page.addScriptTag({ content: await readFile(path.join(output, 'fixture.iife.js'), 'utf8') });
    const card = page.locator('[data-error-kind="resize_observer_delivery"]');
    await card.waitFor();
    await card.locator('button[aria-expanded]').click();
    await page.getByText('5. 現在の結果・対応状態', { exact: true }).waitFor();
    assert.match(await card.innerText(), /調査.*履歴ではありません/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}`);
    await card.locator('summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `technical overflow at ${width}`);
    await page.screenshot({ path: path.join(evidence, `details-${width}.png`), fullPage: true });
    await card.locator('button[aria-expanded]').click();
    await card.locator('button[aria-expanded]').click();
    assert.equal(await page.evaluate(() => window.qaCalls.filter(call => call.method === 'PATCH').length), 0);
    await page.evaluate(() => { window.location.hash = '/admin/system/errors/12345678-1234-4234-8234-123456789abc'; });
    await page.getByText('確認するエラー記録', { exact: true }).waitFor();
    await page.getByText('5. 現在の結果・対応状態', { exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /合成テスト用メモ/);
    await page.screenshot({ path: path.join(evidence, `direct-detail-${width}.png`), fullPage: true });
    assert.deepEqual(failures, []);
    console.log(`PASS Chromium width=${width}: expand/collapse, complete details, technical disclosure, no horizontal overflow, no writes, no runtime errors`);
    await page.close();
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ head: process.env.CB_HEAD_SHA || 'local', widths: [390, 768], result: 'passed', data: 'synthetic only' }, null, 2));
  console.log(`Screenshots: ${evidence}`);
} finally { await browser?.close(); if (!process.env.KEEP_QA_SCREENSHOTS) await rm(output, { recursive: true, force: true }); }
