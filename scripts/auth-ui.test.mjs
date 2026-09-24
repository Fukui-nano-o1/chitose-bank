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

test('real authentication UI handles failures and guides returning accounts without duplicate registration or forced password changes', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-auth-ui-'));
  let dom;
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'auth-fixture', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/auth/client.js');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/auth/entry.jsx'), name: 'AuthQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    function mount(mode, profile = false, settings = {}) {
      dom?.window.close();
      dom = new JSDOM('<div id="root"></div>', { url: profile ? 'https://ui.test/#/profile/worker' : 'https://ui.test/#/login', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
      const w = dom.window;
      Object.assign(w, { Response, Request, Headers, ReadableStream, AbortController, AbortSignal, TextEncoder, TextDecoder });
      w.qaMode = mode; w.qaProfile = profile; w.qaRequests = [];
      Object.assign(w, settings);
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
    async function fill(w, selector, value) {
      const input = w.document.querySelector(selector);
      assert.ok(input, selector);
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      await pause(10);
    }
    async function openCode(w, reset = false) {
      await until(() => button(w, '新規登録'), 'login ready');
      button(w, reset ? 'パスワードを忘れた方・未設定の方' : '新規登録').click();
      await until(() => button(w, '続ける'), 'email form');
      await fill(w, 'input[type="email"]', 'person@fixture.test');
      button(w, '続ける').click();
      await until(() => w.document.querySelector('input[name="code"]'), 'code form');
      assert.equal(w.qaRequests.some(r => r.path === '/rest/v1/account_holders'), false, 'no account lookup before authentication');
    }
    async function verify(w) {
      await fill(w, 'input[name="code"]', '123456');
      button(w, '確認して続ける').click();
    }
    const updates = w => w.qaRequests.filter(r => r.path === '/auth/v1/user' && r.method === 'PUT');
    const signups = w => w.qaRequests.filter(r => r.path === '/auth/v1/signup');
    await t.test('login help opens support without losing the email, password or current screen', async () => {
      const w = mount('success');
      await until(() => button(w, 'ログインでお困りですか？'), 'support link ready');
      await fill(w, 'input[type="email"]', 'person@fixture.test');
      await fill(w, 'input[name="password"]', 'fixture-password');
      let request;
      w.addEventListener('cb:open-support', event => { request = event.detail; });
      button(w, 'ログインでお困りですか？').click();
      assert.equal(request.topic, 'login');
      assert.equal(request.context.page_hash, '#/login');
      assert.equal(w.location.hash, '#/login');
      assert.equal(w.document.querySelector('input[type="email"]').value, 'person@fixture.test');
      assert.equal(w.document.querySelector('input[name="password"]').value, 'fixture-password');
      assert.equal(JSON.stringify(request).includes('person@fixture.test'), false);
      assert.equal(JSON.stringify(request).includes('fixture-password'), false);
      assert.equal(otpCalls(w).length, 0);
    });
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
    await t.test('password login is available before sending mail and from the code screen, with email retained', async () => {
      for (const fromCode of [false, true]) {
        const w = mount('success');
        if (fromCode) await openCode(w);
        else {
          await until(() => button(w, '新規登録'), 'login ready');
          button(w, '新規登録').click();
          await until(() => button(w, '続ける'), 'email form');
          await fill(w, 'input[type="email"]', 'person@fixture.test');
        }
        assert.ok(button(w, 'パスワードでログイン'));
        assert.equal(button(w, 'パスワードを決めて登録する'), undefined);
        button(w, 'パスワードでログイン').click();
        await until(() => w.document.querySelector('input[name="password"]'), 'password login');
        assert.equal(w.document.querySelector('input[type="email"]').value, 'person@fixture.test');
        await fill(w, 'input[name="password"]', 'fixture-password');
        button(w, 'ログイン').click();
        await until(() => w.qaLoggedIn, 'login complete');
        assert.equal(otpCalls(w).length, fromCode ? 1 : 0, 'switching method never sends mail');
        assert.equal(signups(w).length, 0);
        assert.equal(updates(w).length, 0);
      }
    });
    await t.test('verified returning account gets a login action, retains its profile, and does not reset its password', async () => {
      const farmer = { id: 'fixture-farmer', auth_id: '10000000-0000-4000-8000-000000000001', name: 'Fixture Farm', planned_crops: ['broccoli'] };
      const w = mount('success', false, { qaFarmer: farmer });
      await openCode(w); await verify(w);
      await until(() => button(w, 'ログインして続ける'), 'welcome back');
      assert.match(w.document.querySelector('h1').textContent, /おかえりなさい/);
      assert.equal(w.document.querySelector('input[type="password"]'), null);
      const lookup = w.qaRequests.find(r => r.path === '/rest/v1/account_holders');
      assert.equal(lookup.authorization, 'Bearer fixture-token');
      assert.match(lookup.query, /auth_id=eq\.10000000-0000-4000-8000-000000000001/);
      button(w, 'ログインして続ける').click(); button(w, 'ログインして続ける').click();
      await until(() => w.qaLoggedIn, 'existing account login');
      assert.equal(w.qaLoggedIn.id, farmer.auth_id);
      assert.equal(w.qaLoggedIn.name, farmer.name);
      assert.equal(w.qaLoggedIn.planned_crops[0], 'broccoli');
      assert.equal(w.qaLoginCount, 1);
      assert.equal(signups(w).length, 0);
      assert.equal(updates(w).length, 0);
    });
    await t.test('an unfinished registration is not treated as returning just because its auth record is old', async () => {
      const w = mount('success', false, { qaRegistered: false });
      await openCode(w); await verify(w);
      await until(() => button(w, '設定して続ける'), 'new account password');
      assert.doesNotMatch(w.document.body.textContent, /おかえりなさい|登録済みのアカウントを確認/);
      await fill(w, 'input[name="new-password"]', 'fixture-password');
      await fill(w, 'input[name="confirm-password"]', 'fixture-password');
      button(w, '設定して続ける').click();
      await until(() => w.qaLoggedIn, 'registration continues');
      assert.equal(updates(w).length, 1);
      assert.equal(signups(w).length, 0);
    });
    await t.test('a password reset is explicit and never requests creation of another account', async () => {
      const w = mount('success');
      await openCode(w, true);
      assert.equal(otpCalls(w)[0].body.create_user, false);
      await verify(w);
      await until(() => button(w, '変更してログイン'), 'reset password');
      assert.equal(w.qaLoggedIn, undefined);
      await fill(w, 'input[name="new-password"]', 'replacement-fixture');
      await fill(w, 'input[name="confirm-password"]', 'replacement-fixture');
      button(w, '変更してログイン').click();
      await until(() => w.qaLoggedIn, 'reset complete');
      assert.equal(updates(w).length, 1);
      assert.equal(signups(w).length, 0);
    });
    await t.test('returning users can choose password reset and go back without changing anything', async () => {
      const w = mount('success');
      await openCode(w); await verify(w);
      await until(() => button(w, 'ログインして続ける'), 'welcome back');
      button(w, 'パスワードを再設定する').click();
      await until(() => button(w, '変更してログイン'), 'optional reset');
      w.document.querySelector('[aria-label="前の画面に戻る"]').click();
      await until(() => button(w, 'ログインして続ける'), 'return to welcome');
      button(w, 'ログインして続ける').click();
      await until(() => w.qaLoggedIn, 'login without reset');
      assert.equal(updates(w).length, 0);
      assert.equal(w.qaRequests.filter(r => r.path === '/auth/v1/verify').length, 1);
    });
    await t.test('a profile failure after password setup retries login without writing the password again', async () => {
      const w = mount('success', false, { qaRegistered: false, qaFarmerError: true });
      await openCode(w); await verify(w);
      await until(() => button(w, '設定して続ける'), 'new account password');
      await fill(w, 'input[name="new-password"]', 'fixture-password');
      await fill(w, 'input[name="confirm-password"]', 'fixture-password');
      button(w, '設定して続ける').click();
      await until(() => w.document.querySelector('[role="alert"]') && button(w, 'ログインして続ける') && !button(w, 'ログインして続ける').disabled, 'password saved, profile failed');
      assert.match(w.document.querySelector('h1').textContent, /パスワードを設定しました/);
      assert.equal(w.qaLoggedIn, undefined);
      assert.equal(updates(w).length, 1);
      w.qaFarmerError = false; button(w, 'ログインして続ける').click();
      await until(() => w.qaLoggedIn, 'retry login only');
      assert.equal(updates(w).length, 1);
    });
    await t.test('failed account/profile reads can be retried without repeating OTP verification or losing the existing role', async () => {
      const w = mount('success', false, { qaLookupError: true, qaFarmerError: true });
      await openCode(w); await verify(w);
      await until(() => button(w, 'もう一度確認する') && !button(w, 'もう一度確認する').disabled, 'lookup failure');
      assert.match(w.document.querySelector('[role="alert"]').textContent, /メールの確認は済んでいます/);
      assert.equal(button(w, '設定して続ける'), undefined);
      w.qaLookupError = false; button(w, 'もう一度確認する').click();
      await until(() => button(w, 'ログインして続ける'), 'lookup recovered');
      assert.equal(w.qaRequests.filter(r => r.path === '/auth/v1/verify').length, 1);
      button(w, 'ログインして続ける').click();
      await until(() => w.document.querySelector('[role="alert"]') && !button(w, 'ログインして続ける').disabled, 'profile failure');
      assert.equal(w.qaLoggedIn, undefined, 'a failed farmer lookup must not log in as a blank worker');
      w.qaFarmerError = false; button(w, 'ログインして続ける').click();
      await until(() => w.qaLoggedIn, 'profile recovered');
      assert.equal(updates(w).length, 0);
    });
    await t.test('an invalid code never exposes registration status; invite-only mode remains closed', async () => {
      const w = mount('success', false, { qaVerifyError: true, qaSignupOpen: false });
      await openCode(w);
      assert.equal(otpCalls(w)[0].body.create_user, false);
      await verify(w);
      await until(() => w.document.querySelector('[role="alert"]'), 'invalid code');
      assert.equal(w.qaRequests.some(r => r.path === '/rest/v1/account_holders'), false);
      assert.equal(button(w, 'ログインして続ける'), undefined);
      assert.equal(w.qaLoggedIn, undefined);
    });
    const w = mount('success', true);
    await until(() => button(w, 'ログアウト›'), 'profile logout button');
    button(w, 'ログアウト›').click();
    assert.equal(w.qaLoggedOut, true, 'native confirm false no longer blocks the logout action');
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
