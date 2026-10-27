import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { JSDOM, VirtualConsole } from 'jsdom';
import { errorSignature } from '../src/lib/errorCatalog.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const sample = {
  id: 'translation', message: 'La', source: 'unhandledrejection', component: 'global', action: 'promise_rejection',
  status: 'open', identity_verified: true, created_at: '2026-10-27T12:44:19Z', url: 'https://www.chitose-bank.com/#/search',
  user_agent: 'Mozilla/5.0 (iPhone) CriOS/151.0.7922.57 Mobile Safari/604.1',
  stack: '@https://www.chitose-bank.com/:518:344\nLi@https://www.chitose-bank.com/:196:221\n@https://www.chitose-bank.com/:197:338',
};
const button = (w, text, parent = w.document) => [...parent.querySelectorAll('button')].find(b => b.textContent === text);
const card = (w, kind) => w.document.querySelector(`[data-error-kind="${kind}"]`);
async function until(fn) {
  const end = Date.now() + 4000;
  while (!fn()) { assert.ok(Date.now() < end, 'timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
test('admin list, expanded explanation, copy, split resolution, legacy focus and failed reads use consistent classifications', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-error-ui-'));
  const errors = []; let dom;
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'error-diagnosis-fixture', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/error-diagnosis/client.js');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/error-diagnosis/entry.jsx'), name: 'ErrorsQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    function mount(rows, { readFailure = false, focus = null } = {}) {
      dom?.window.close();
      const vc = new VirtualConsole();
      vc.on('jsdomError', e => { if (!/CSS/.test(e.message)) errors.push(e.message); });
      vc.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/#/admin/system', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
      const w = dom.window;
      w.qaRows = structuredClone(rows); w.qaCalls = []; w.qaReadFailure = readFailure; w.qaAlerts = [];
      w.confirm = () => true; w.alert = text => w.qaAlerts.push(text);
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { w.qaClipboard = text; } } });
      if (focus) w.sessionStorage.setItem('cb_sysErrorFocus', focus);
      w.fetch = () => { throw new Error('Unexpected network'); };
      w.eval(script); return w;
    }
    await t.test('classifies on first paint and copy agrees without another request', async () => {
      const w = mount([sample, { ...sample, id: 'app', stack: 'save@https://www.chitose-bank.com/assets/app.js:1:1' }]);
      await until(() => card(w, 'chrome_ios_translate_request') && card(w, 'unhandled_promise'));
      const found = card(w, 'chrome_ios_translate_request');
      assert.match(found.textContent, /Chrome翻訳の通信処理失敗/);
      assert.match(found.textContent, /発生元をコード照合済み/);
      found.firstElementChild.click();
      await until(() => found.textContent.includes('判定の根拠'));
      assert.match(found.textContent, /518:344/);
      assert.match(found.textContent, /Chrome（iOS） 151.0.7922.57/);
      button(w, 'コピー', found).click(); await until(() => w.qaClipboard);
      assert.match(w.qaClipboard, /大分類: 端末・ブラウザ機能/);
      assert.match(w.qaClipboard, /操作=promise_rejection/);
      assert.match(w.qaClipboard, /表示への影響: 画面の表示停止は確認できません/);
      assert.equal(w.qaCalls.filter(c => c.method === 'GET').length, 1);
      assert.ok(w.qaCalls[0].fields.split(',').includes('stack'));
      assert.equal(w.qaCalls[0].limit, 500);
      button(w, 'この種類の1件をまとめて解決済みにする', found).click();
      await until(() => !card(w, 'chrome_ios_translate_request'));
      assert.ok(card(w, 'unhandled_promise'));
      assert.deepEqual(Array.from(w.qaCalls.find(c => c.method === 'PATCH').ids), ['translation']);
    });
    await t.test('failed queries never masquerade as zero errors, and retry recovers', async () => {
      const w = mount([sample], { readFailure: true });
      await until(() => button(w, 'もう一度読み込む'));
      assert.doesNotMatch(w.document.body.textContent, /エラーは記録されていません/);
      w.qaReadFailure = false; button(w, 'もう一度読み込む').click();
      await until(() => card(w, 'chrome_ios_translate_request'));
      assert.equal(w.document.querySelector('[role="alert"]'), null);
    });
    await t.test('legacy focus is retained only when it identifies one group', async () => {
      let w = mount([sample], { focus: errorSignature(sample) });
      await until(() => button(w, '✓ 解決した'));
      assert.match(w.document.body.textContent, /確認するエラー記録/);
      w = mount([sample, { ...sample, id: 'app', stack: '' }], { focus: errorSignature(sample) });
      await until(() => card(w, 'unhandled_promise'));
      assert.equal(button(w, '✓ 解決した'), undefined);
    });
    assert.deepEqual(errors, []);
  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
