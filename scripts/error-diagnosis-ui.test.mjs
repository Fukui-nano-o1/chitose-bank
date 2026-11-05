import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { JSDOM, VirtualConsole } from 'jsdom';
import { errorSignature, buildErrorDetails, diagnoseError } from '../src/lib/errorCatalog.js';
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
    function mount(rows, { readFailure = false, focus = null, route = "/admin/system", detailRows = null } = {}) {
      dom?.window.close();
      const vc = new VirtualConsole();
      vc.on('jsdomError', e => { if (!/CSS/.test(e.message)) errors.push(e.message); });
      vc.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>', { url: `https://test.invalid/#${route}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
      const w = dom.window;
      w.qaDetailRows = detailRows; w.qaRows = structuredClone(rows); w.qaCalls = []; w.qaReadFailure = readFailure; w.qaAlerts = [];
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
      found.querySelector('button[aria-expanded]').click();
      await until(() => found.textContent.includes('確認の過程と結果'));
      assert.match(found.textContent, /518:344/);
      assert.match(found.textContent, /Chrome（iOS） 151.0.7922.57/);
      button(w, 'コピー', found).click(); await until(() => w.qaClipboard);
      assert.match(w.qaClipboard, /大分類: 端末・ブラウザ機能/);
      assert.match(w.qaClipboard, /操作=promise_rejection/);
      assert.match(w.qaClipboard, /表示への影響: 画面の表示停止は確認できません/);
      assert.equal(w.qaCalls.filter(c => c.method === 'GET').length, 1);
      for (const field of ['stack', 'admin_note', 'resolved_at']) assert.ok(w.qaCalls[0].fields.split(',').includes(field));
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
    await t.test('ResizeObserver details explain the saved record, show every check, copy and close without resolving', async () => {
      const resize = { ...sample, id: 'resize', message: 'ResizeObserver loop completed with undelivered notifications.', source: 'window.onerror', stack: null, admin_note: '再現操作を記録。端末確認は未完了。', resolved_at: '2026-11-01T00:00:00Z' };
      const w = mount([resize], { focus: errorSignature(resize) });
      await until(() => button(w, '✓ 解決した'));
      const found = card(w, diagnoseError(resize).key);
      const toggle = found.querySelector('button[aria-expanded]');
      assert.equal(toggle.getAttribute('aria-expanded'), 'true');
      const panel = w.document.getElementById(toggle.getAttribute('aria-controls'));
      assert.ok(panel);
      const details = buildErrorDetails(resize);
      assert.ok(panel.textContent.includes(details.summary));
      for (const section of details.sections) {
        assert.ok(panel.textContent.includes(section.title));
        for (const item of section.items) assert.ok(panel.textContent.includes(item));
      }
      for (const check of details.checks) {
        assert.ok(panel.textContent.includes(check.step));
        assert.ok(panel.textContent.includes(check.result));
        assert.ok(panel.textContent.includes(check.status));
      }
      assert.match(panel.textContent, /再現テストや修正後の動作確認は実行されません/);
      assert.match(panel.textContent, /未記録（発生箇所の情報は保存されていません）/);
      assert.doesNotMatch(panel.textContent, /スタック）を取得中/);
      const technical = panel.querySelector('details');
      assert.match(panel.textContent, /再現操作を記録。端末確認は未完了。/);
      assert.equal(technical.open, false);
      technical.querySelector('summary').click();
      assert.equal(technical.open, true);
      assert.match(technical.textContent, /ResizeObserver loop completed with undelivered notifications/);
      button(w, 'コピー', found).click(); await until(() => w.qaClipboard);
      assert.ok(w.qaClipboard.includes(details.summary));
      assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'copy does not collapse details');
      button(w, '閉じる').click();
      await until(() => !button(w, '✓ 解決した'));
      assert.ok(card(w, diagnoseError(resize).key));
      assert.equal(w.sessionStorage.getItem('cb_sysErrorFocus'), null);
      assert.equal(w.qaCalls.filter(c => c.method === 'PATCH').length, 0, 'close never marks resolved');
      assert.equal(w.qaCalls.filter(c => c.method === 'GET').length, 1, 'details do not trigger live investigation');
    });
    await t.test('unknown and generic errors get the same detailed explanation and reversible disclosure', async () => {
      for (const source of ['window.onerror', 'unhandledrejection']) {
        const row = { ...sample, id: source, source, message: 'unclassified fixture failure', stack: '' };
        const w = mount([row]);
        await until(() => card(w, diagnoseError(row).key));
        const found = card(w, diagnoseError(row).key);
        const toggle = found.querySelector('button[aria-expanded]');
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        toggle.click(); await until(() => toggle.getAttribute('aria-expanded') === 'true');
        assert.ok(found.textContent.includes(buildErrorDetails(row).summary));
        assert.match(found.textContent, /確認の過程と結果/);
        assert.ok(found.querySelector('[aria-label="エラーの詳しい説明"]'));
        toggle.click(); await until(() => toggle.getAttribute('aria-expanded') === 'false');
        assert.equal(found.querySelector('[aria-label="エラーの詳しい説明"]'), null);
        toggle.click(); await until(() => toggle.getAttribute('aria-expanded') === 'true');
        assert.ok(found.textContent.includes(buildErrorDetails(row).summary));
        assert.equal(w.qaCalls.filter(c => c.method === 'GET').length, 1);
      }
    });
    await t.test('historical sensitive text is masked in header, technical disclosure and clipboard', async () => {
      const secret = 'fixture-private-value';
      const row = { ...sample, id: 'masked', source: 'window.onerror',
        message: `failure https://test.invalid/file?token=${secret} /profile?code=${secret}&name=${secret} {"access_token":"${secret}"}`,
        component: `password=${secret}`, action: 'contact fixture@example.invalid',
        url: `https://test.invalid/?token=${secret}`,
        stack: `at https://test.invalid/file.js?token=${secret}`,
      };
      const w = mount([row]);
      await until(() => card(w, diagnoseError(row).key));
      const found = card(w, diagnoseError(row).key);
      found.querySelector('button[aria-expanded]').click();
      await until(() => found.querySelector('details'));
      assert.ok(!found.textContent.includes(secret));
      assert.ok(!found.innerHTML.includes(secret), "DOM accessibility IDs must not contain raw error messages");
      assert.ok(!found.textContent.includes('fixture@example.invalid'));
      button(w, 'コピー', found).click(); await until(() => w.qaClipboard);
      assert.ok(!w.qaClipboard.includes(secret));
      assert.ok(!w.qaClipboard.includes('fixture@example.invalid'));
    });
    await t.test('record deep links load outside the list window and survive refresh, close, back and forward', async () => {
      const id = '12345678-1234-4234-8234-123456789abc';
      const old = { ...sample, id, status: 'fixed', admin_note: '確認済み' };
      const route = '/admin/system/errors/' + id;
      let w = mount([], { route, detailRows: [old] });
      await until(() => w.document.body.textContent.includes('通知された1件'));
      assert.match(w.document.body.textContent, /確認済み/);
      assert.ok(w.qaCalls.some(c => c.id === id));
      assert.equal(card(w, 'chrome_ios_translate_request').querySelector('button[aria-expanded]').getAttribute('aria-expanded'), 'true');
      w = mount([], { route, detailRows: [old] });
      await until(() => w.document.body.textContent.includes('通知された1件'));
      button(w, '閉じる').click();
      await until(() => w.location.hash === '#/admin/system' && !w.document.body.textContent.includes('通知された1件'));
      w.history.back(); await until(() => w.document.body.textContent.includes('通知された1件'));
      w.history.forward(); await until(() => !w.document.body.textContent.includes('通知された1件'));
      assert.equal(w.qaCalls.filter(c => c.method === 'PATCH').length, 0);
    });
    await t.test('missing, invalid and failed detail links are explicit; retry recovers', async () => {
      const id = '12345678-1234-4234-8234-123456789abc';
      let w = mount([], { route: '/admin/system/errors/' + id });
      await until(() => w.document.body.textContent.includes('閲覧権限がありません'));
      w = mount([], { route: '/admin/system/errors/invalid' });
      await until(() => w.document.body.textContent.includes('リンクが正しくありません'));
      assert.ok(!w.qaCalls.some(c => c.id));
      w = mount([], { route: '/admin/system/errors/' + id, readFailure: true, detailRows: [{ ...sample, id }] });
      await until(() => button(w, '再試行'));
      w.qaReadFailure = false; button(w, '再試行').click();
      await until(() => w.document.body.textContent.includes('通知された1件'));
    });
    assert.deepEqual(errors, []);
  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
