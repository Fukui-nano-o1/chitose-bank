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
const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
const button = (w, label) => [...w.document.querySelectorAll('button')].find(element => {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"]').forEach(child => child.remove());
  return clone.textContent.trim() === label;
});
const sendButton = w => button(w, '運営に送信する') || button(w, '同じ内容で再送する');
const dialog = w => w.document.querySelector('[role="dialog"]');
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, `timed out: ${label}`); await pause(10); }
}
async function fill(w, selector, value) {
  const input = w.document.querySelector(selector);
  assert.ok(input, selector);
  const proto = input.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await pause(10);
}

test('support preserves the original task while reports, replies and recovery work through the real client', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-support-ui-'));
  let dom;
  const errors = [];
  try {
    await build({ configFile: false, root, logLevel: 'error', define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.VITE_SUPABASE_URL': '"https://support-fixture.test"',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '"fixture-anon-key"',
    }, plugins: [{
      name: 'support-fixture', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/support/client.js');
      },
      transform(code, id) {
        // Exercise the real deadline behavior without a 15-second test pause.
        if (id.endsWith('/src/lib/supportClient.js')) return code.replace('SUPPORT_TIMEOUT_MS = 15000', 'SUPPORT_TIMEOUT_MS = 250');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/support/entry.jsx'), name: 'SupportQA', formats: ['iife'], fileName: 'fixture', cssFileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    const css = await readFile(path.join(output, 'fixture.css'), 'utf8');
    function mount(settings = {}) {
      dom?.window.close();
      const console = new VirtualConsole();
      console.on('jsdomError', error => { if (!/CSS|navigation/.test(error.message)) errors.push(error.message); });
      console.on('error', (...args) => errors.push(args.join(' ')));
      dom = new JSDOM('<div id="root"></div>', { url: `https://ui.test/${settings.qaHash || '#/login'}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
      const w = dom.window;
      Object.assign(w, { Response, Request, Headers, ReadableStream, AbortController, AbortSignal, TextEncoder, TextDecoder });
      Object.assign(w, { qaUserId: null, qaRequests: [], qaReports: {}, qaFail: null, qaAuthSessionReads: 0 }, settings);
      if (settings.qaStorageBlocked) Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('Storage disabled', 'SecurityError'); } });
      else for (const [key, value] of Object.entries(settings.qaStored || {})) w.localStorage.setItem(key, JSON.stringify(value));
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.visualViewport = Object.assign(new w.EventTarget(), { width: 390, height: 844, offsetLeft: 0, offsetTop: 0, scale: 1 });
      const style = w.document.createElement('style'); style.textContent = css; w.document.head.append(style);
      w.eval(script);
      return w;
    }
    async function compose(w, topic = 'ログイン・認証メール') {
      await until(() => button(w, topic), 'help topics');
      button(w, topic).click();
      await until(() => button(w, 'この内容で相談する'), 'topic guide');
      button(w, 'この内容で相談する').click();
      await until(() => button(w, '運営に送信する'), 'report composer');
    }

    // Each scenario below uses synthetic records only; no production network is available.
    await t.test('the modal closes back to the untouched task and restores keyboard focus', async () => {
      const w = mount({ qaOpen: false });
      await until(() => button(w, 'ヘルプを開く'), 'trigger');
      await fill(w, '#underlying-draft', '途中まで入力した求人');
      const trigger = button(w, 'ヘルプを開く'); trigger.focus(); trigger.click();
      await until(() => dialog(w), 'help dialog');
      assert.match(dialog(w).textContent, /ヘルプ・お問い合わせ/);
      w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await until(() => !dialog(w), 'escape closes');
      assert.equal(w.document.querySelector('#underlying-draft').value, '途中まで入力した求人');
      assert.equal(w.document.activeElement, trigger);
      assert.equal(w.location.hash, '#/login');
    });

    await t.test('guests submit without authentication and keep their receipt secret outside the request', async () => {
      const w = mount();
      await compose(w);
      await fill(w, 'textarea[name="support-body"]', '認証メールが届かず登録を進められません。');
      await fill(w, 'input[name="support-expected"]', '認証コードを受け取り、新規登録を完了したかった。');
      sendButton(w).click();
      await until(() => button(w, '相談の状況を見る'), 'guest receipt');
      assert.equal(w.qaAuthSessionReads, 0, 'support must not await the stalled auth session');
      const sent = w.qaRequests.find(request => request.name === 'support_create');
      assert.equal(sent.args.p_expected, '認証コードを受け取り、新規登録を完了したかった。');
      assert.equal(sent.guest, true);
      assert.match(sent.args.p_guest_token, /^[a-f0-9]{64}$/);
      assert.equal(w.qaGuestHeaders.authorization, 'Bearer fixture-anon-key');
      assert.equal(w.location.href.includes(sent.args.p_guest_token), false);
      assert.equal(w.document.body.textContent.includes(sent.args.p_guest_token), false);
      assert.equal(JSON.stringify(sent.args.p_diagnostics).includes(sent.args.p_guest_token), false);
      button(w, '相談の状況を見る').click();
      await until(() => button(w, '追記を送信する'), 'guest report detail');
      assert.match(dialog(w).textContent, /認証メールが届かず登録を進められません/);
      assert.equal(Object.values(w.qaReports)[0].report.expected_result, '認証コードを受け取り、新規登録を完了したかった。');
      assert.match(dialog(w).textContent, /期待したこと：認証コードを受け取り、新規登録を完了したかった。/);
    });

    await t.test('send failures retain input after close/reopen, and concurrent clicks do not send duplicates', async () => {
      const w = mount({ qaUserId: userA, qaFail: 'create' });
      await compose(w);
      await fill(w, 'textarea[name="support-body"]', '保存中から進みません。入力は残したいです。');
      const send = button(w, '運営に送信する'); send.click(); send.click();
      await until(() => w.document.querySelector('[role="alert"]'), 'failed report');
      assert.equal(w.qaRequests.filter(request => request.name === 'support_create').length, 1);
      assert.equal(w.document.querySelector('textarea[name="support-body"]').value, '保存中から進みません。入力は残したいです。');
      w.document.querySelector('[aria-label="元の画面に戻る"]').click();
      await until(() => !dialog(w), 'back to task');
      button(w, 'ヘルプを開く').click();
      await until(() => dialog(w), 'open retained support draft');
      if (!w.document.querySelector('textarea[name="support-body"]')) {
        const resume = [...dialog(w).querySelectorAll('button')].find(element => /入力.*続|下書き|相談.*続/.test(element.textContent));
        assert.ok(resume, 'retained report draft has a clear resume action'); resume.click();
      }
      await until(() => w.document.querySelector('textarea[name="support-body"]'), 'resume report');
      assert.equal(w.document.querySelector('textarea[name="support-body"]').value, '保存中から進みません。入力は残したいです。');
      w.qaFail = null;
      sendButton(w).click();
      await until(() => button(w, '相談の状況を見る'), 'retry succeeded');
      const requests = w.qaRequests.filter(request => request.name === 'support_create');
      assert.equal(requests.length, 2);
      assert.equal(requests[0].args.p_id, requests[1].args.p_id, 'retry identity remains fixed');
    });

    await t.test('a lost response after creation retries the same report without duplicating it', async () => {
      const w = mount({ qaLoseCreateResponse: true });
      await compose(w, '労働条件通知書・PDF');
      await fill(w, 'textarea[name="support-body"]', 'PDFが作成中のままです。');
      sendButton(w).click();
      await until(() => w.document.querySelector('[role="alert"]'), 'unknown result');
      assert.equal(Object.keys(w.qaReports).length, 1, 'server had already created the report');
      sendButton(w).click();
      await until(() => button(w, '相談の状況を見る'), 'confirmed retry');
      const sends = w.qaRequests.filter(request => request.name === 'support_create');
      assert.equal(sends.length, 2);
      assert.deepEqual(sends[0].args, sends[1].args, 'same payload is retried after an unknown result');
      assert.equal(Object.keys(w.qaReports).length, 1);
    });

    await t.test('a stalled guest request stops loading and leaves a manual retry plus the original task', async () => {
      const w = mount({ qaHold: 'create' });
      await compose(w);
      await fill(w, 'textarea[name="support-body"]', '通信が応答しないときの相談です。');
      sendButton(w).click();
      await until(() => w.document.querySelector('[role="alert"]') && sendButton(w) && !sendButton(w).disabled, 'deadline recovers controls');
      assert.equal(w.qaAuthSessionReads, 0);
      assert.equal(w.qaRequests.filter(request => request.name === 'support_create').length, 1, 'no automatic repeated sending');
      assert.equal(w.document.querySelector('textarea[name="support-body"]').value, '通信が応答しないときの相談です。');
      assert.ok(button(w, '報告内容をコピー'));
      assert.equal(w.document.querySelector('[aria-label="元の画面に戻る"]').disabled, false);
      w.qaHold = null;
      sendButton(w).click();
      await until(() => button(w, '相談の状況を見る'), 'manual retry after deadline');
    });

    await t.test('optional diagnostics can be declined without blocking support', async () => {
      const w = mount({ qaHash: '#/work/job/private-job-id?token=private-query' });
      await compose(w, '労働条件通知書・PDF');
      await fill(w, 'textarea[name="support-body"]', '個別の記録は添付せず相談します。');
      const diagnostics = w.document.querySelector('input[type="checkbox"]');
      assert.ok(diagnostics, 'diagnostics attachment has a visible choice');
      if (diagnostics.checked) diagnostics.click();
      await pause(10);
      button(w, '運営に送信する').click();
      await until(() => button(w, '相談の状況を見る'), 'report without diagnostics');
      const sent = w.qaRequests.find(request => request.name === 'support_create');
      assert.deepEqual(Object.keys(sent.args.p_diagnostics), []);
      assert.equal(sent.args.p_page_hash, '#/work/job', 'minimal route never contains a record ID or query');
    });

    await t.test('switching accounts never shows the previous account draft or completed request', async () => {
      const w = mount({ qaUserId: userA, qaHold: 'create' });
      await compose(w);
      await fill(w, 'textarea[name="support-body"]', '別アカウントには見せない相談です。');
      button(w, '運営に送信する').click();
      await until(() => w.qaRelease, 'pending request');
      w.qaSetUserId(userB);
      await pause(30);
      assert.equal(dialog(w).textContent.includes('別アカウントには見せない相談です。'), false);
      assert.notEqual(w.document.querySelector('textarea[name="support-body"]')?.value, '別アカウントには見せない相談です。');
      w.qaRelease();
      await pause(30);
      assert.equal(button(w, '相談の状況を見る'), undefined, 'late response from account A cannot populate account B');
      assert.equal(dialog(w).textContent.includes('別アカウントには見せない相談です。'), false);
    });

    await t.test('reporters can read the answer and reopen a resolved case without duplicating a lost reply', async () => {
      const w = mount({ qaUserId: userA });
      await compose(w, '労働条件通知書・PDF');
      await fill(w, 'textarea[name="support-body"]', 'PDFの保存が終わりません。');
      button(w, '運営に送信する').click();
      await until(() => button(w, '相談の状況を見る'), 'receipt');
      const record = Object.values(w.qaReports)[0];
      record.report.status = 'resolved';
      record.messages.push({ id: 'fixture-admin-reply', author_role: 'admin', body: '保存処理を修正しました。再度ご確認ください。', created_at: new Date().toISOString() });
      button(w, '相談の状況を見る').click();
      await until(() => button(w, 'まだ解決していない'), 'resolved case detail');
      assert.match(dialog(w).textContent, /保存処理を修正しました/);
      await fill(w, 'textarea', '再度試しましたが、まだ保存できません。');
      w.qaLoseReplyResponse = true;
      button(w, 'まだ解決していない').click();
      await until(() => w.document.querySelector('[role="alert"]'), 'reply delivery is uncertain');
      assert.equal(w.document.querySelector('textarea').value, '再度試しましたが、まだ保存できません。');
      assert.equal(record.messages.filter(message => message.author_role === 'user').length, 1);
      const retry = button(w, 'まだ解決していない') || button(w, '追記を送信する');
      retry.click();
      await until(() => !w.document.querySelector('[role="alert"]') && record.report.status === 'open', 'case reopened');
      const replies = w.qaRequests.filter(request => request.name === 'support_reply');
      assert.equal(replies.length, 2);
      assert.deepEqual(replies[0].args, replies[1].args, 'the same message identity is retried');
      assert.equal(record.messages.filter(message => message.author_role === 'user').length, 1);
    });

    await t.test('a failed history read has retry guidance and never claims an empty inbox', async () => {
      const w = mount({ qaUserId: userA, qaFail: 'list' });
      await until(() => button(w, '相談履歴'), 'history entry');
      button(w, '相談履歴').click();
      await until(() => w.document.querySelector('[role="alert"]'), 'history failure');
      assert.doesNotMatch(dialog(w).textContent, /相談はまだありません|まだ相談はありません/);
      assert.ok(button(w, '相談履歴を更新する'));
      w.qaFail = null;
      button(w, '相談履歴を更新する').click();
      await until(() => !w.document.querySelector('[role="alert"]'), 'history recovered');
    });

    await t.test('forgetting guest receipt information invalidates an earlier in-flight submission', async () => {
      const w = mount({ qaHold: 'create' });
      await compose(w);
      await fill(w, 'textarea[name="support-body"]', '共用端末から消した後は見せない相談です。');
      sendButton(w).click();
      await until(() => w.qaRelease, 'pending guest request');
      button(w, '相談履歴で受付を確認').click();
      await until(() => button(w, 'この端末の受付情報を消す'), 'guest history');
      button(w, 'この端末の受付情報を消す').click();
      await until(() => button(w, '端末の受付情報を消す'), 'explicit forget confirmation');
      button(w, '端末の受付情報を消す').click();
      await pause(20);
      assert.equal(w.localStorage.getItem('cb_support_v1:guest-access'), null);
      assert.equal(w.localStorage.getItem('cb_support_v1:draft:guest'), null);
      w.qaRelease();
      await pause(30);
      assert.equal(Boolean(button(w, '相談の状況を見る')), false, 'a response from the forgotten guest identity must not restore the receipt');
      assert.equal(w.localStorage.getItem('cb_support_v1:last:guest'), null, 'a late response must not recreate forgotten receipt storage');
      assert.doesNotMatch(dialog(w).textContent, /共用端末から消した後は見せない相談です/);
    });

    await t.test('blocked device storage still allows support and explains its retention limit', async () => {
      const w = mount({ qaStorageBlocked: true, qaFail: 'create' });
      await compose(w);
      await fill(w, 'textarea[name="support-body"]', '保存が禁止されたブラウザでも相談したいです。');
      assert.match(dialog(w).textContent, /下書きを保存できません/);
      sendButton(w).click();
      await until(() => w.document.querySelector('[role="alert"]'), 'failed report remains in memory');
      w.document.querySelector('[aria-label="元の画面に戻る"]').click();
      await until(() => !dialog(w), 'return to task');
      button(w, 'ヘルプを開く').click();
      await until(() => button(w, '下書きを続ける'), 'memory draft');
      button(w, '下書きを続ける').click();
      await until(() => w.document.querySelector('textarea[name="support-body"]'), 'resume memory draft');
      assert.equal(w.document.querySelector('textarea[name="support-body"]').value, '保存が禁止されたブラウザでも相談したいです。');
      w.qaFail = null;
      sendButton(w).click();
      await until(() => button(w, '相談の状況を見る'), 'successful guest receipt without localStorage');
      assert.match(dialog(w).textContent, /受付情報を保存できません/);
      button(w, '相談の状況を見る').click();
      await until(() => button(w, '追記を送信する'), 'receipt usable in current page');
    });

    await t.test('expired report and reply drafts are removed instead of silently restoring old input', async () => {
      const id = '20000000-0000-4000-8000-000000000001';
      const savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const draftKey = `cb_support_v1:draft:user:${userA}`;
      const replyKey = `cb_support_v1:reply:user:${userA}:${id}`;
      const w = mount({ qaUserId: userA, qaStored: {
        [draftKey]: { id, topic: 'login', body: '期限を過ぎた下書き', expected: '', savedAt },
        [replyKey]: { id: 'expired-message-id', body: '期限を過ぎた追記', savedAt },
      }, qaReports: {
        [id]: { owner: `user:${userA}`, report: { id, topic: 'login', body: '受付済みの相談', status: 'open', created_at: new Date().toISOString() }, messages: [] },
      } });
      await until(() => button(w, '相談履歴'), 'support home');
      assert.equal(Boolean(button(w, '下書きを続ける')), false);
      assert.equal(w.localStorage.getItem(draftKey), null);
      button(w, '相談履歴').click();
      await until(() => w.document.querySelector('.support-ticket'), 'report history');
      w.document.querySelector('.support-ticket').click();
      await until(() => w.document.querySelector('textarea[name="support-reply"]'), 'reply composer');
      assert.equal(w.document.querySelector('textarea[name="support-reply"]').value, '');
      assert.equal(w.localStorage.getItem(replyKey), null);
    });

    await t.test('erasing an unsent report does not restore the removed text on reopening', async () => {
      const w = mount({ qaUserId: userA });
      await compose(w);
      await fill(w, 'textarea[name="support-body"]', '自分で消すことにした下書き');
      await fill(w, 'input[name="support-expected"]', 'この文章も消す');
      await fill(w, 'textarea[name="support-body"]', '');
      await fill(w, 'input[name="support-expected"]', '');
      w.document.querySelector('[aria-label="元の画面に戻る"]').click();
      await until(() => !dialog(w), 'close empty draft');
      button(w, 'ヘルプを開く').click();
      await until(() => button(w, '相談履歴'), 'help reopened');
      assert.equal(Boolean(button(w, '下書きを続ける')), false, 'erased content must not be restored as an older draft');
      assert.equal(w.localStorage.getItem(`cb_support_v1:draft:user:${userA}`), null);
    });

    assert.ok(css.includes('safe-area-inset-top'), 'close/back controls reserve the iPhone safe area');
    assert.ok(css.includes('safe-area-inset-bottom'), 'composer controls reserve the home indicator area');
    assert.deepEqual(errors, [], 'no rendering errors');
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
