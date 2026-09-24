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
const button = (w, label) => [...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === label);
const otpCalls = w => w.qaRequests.filter(r => r.path === '/auth/v1/otp');

test('real login UI recovers from SMTP/connection/body timeouts without claiming mail was sent; logout works when native dialogs are suppressed', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-auth-ui-'));
  let dom;
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'auth-fixture', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/auth/client.js');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/auth/entry.jsx'), name: 'AuthQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    function mount(mode, profile = false) {
      dom?.window.close();
      dom = new JSDOM('<div id="root"></div>', { url: profile ? 'https://ui.test/#/profile/worker' : 'https://ui.test/#/login', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
      const w = dom.window;
      Object.assign(w, { Response, Request, Headers, ReadableStream, AbortController, AbortSignal, TextEncoder, TextDecoder });
      w.qaMode = mode; w.qaProfile = profile; w.qaRequests = [];
      w.confirm = () => false;
      w.fetch = () => { throw new Error('Unexpected real network'); };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.eval(script);
      return w;
    }
    for (const mode of ['smtp', 'timeout', 'body-timeout']) {
      const w = mount(mode);
      await until(() => button(w, '新規登録'), 'login ready');
      button(w, '新規登録').click();
      await until(() => button(w, '続ける'), 'email form');
      const input = w.document.querySelector('input[type="email"]');
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, 'person@fixture.test');
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      await until(() => !button(w, '続ける').disabled, 'email accepted');
      const form = w.document.querySelector('form');
      form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await until(() => w.document.querySelector('[role="alert"]') && button(w, '続ける') && !button(w, '続ける').disabled, 'send failure ends loading');
      assert.equal(otpCalls(w).length, 1, 'no duplicate submit or automatic resend');
      assert.equal(w.document.querySelector('input[name="code"]'), null, 'no sent-code screen on failure');
      assert.match(w.document.querySelector('[role="alert"]').textContent, mode === 'smtp' ? /運営側の不具合/ : /送信できたか確認できません/);
      assert.equal(w.document.querySelector('[aria-label="前の画面に戻る"]').disabled, false);
      await until(() => w.qaRequests.some(r => r.path === '/rest/v1/app_errors'), 'anonymous failure diagnostic');
      const diagnostic = w.qaRequests.find(r => r.path === '/rest/v1/app_errors').body;
      assert.doesNotMatch(JSON.stringify(diagnostic), /person@fixture\.test/);
      w.qaMode = 'success';
      button(w, '続ける').click();
      await until(() => w.document.querySelector('input[name="code"]'), 'manual retry succeeds');
      assert.equal(otpCalls(w).length, 2);
      assert.equal(button(w, '再送信（あと60秒）').disabled, true);
    }
    const w = mount('success', true);
    await until(() => button(w, 'ログアウト›'), 'profile logout button');
    button(w, 'ログアウト›').click();
    assert.equal(w.qaLoggedOut, true, 'native confirm false no longer blocks the logout action');
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
