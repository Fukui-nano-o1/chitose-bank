// Synthetic actual-browser regression. No production authentication or network.
// Optional: CHROMIUM_PATH=/usr/bin/chromium CB_EVIDENCE_DIR=/tmp/chat-read-evidence
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), 'chat-read-browser-'));
const evidence = process.env.CB_EVIDENCE_DIR || path.join(tmpdir(), 'chat-read-evidence');
await mkdir(evidence, {
  recursive: true
});
const results = [],
  errors = [],
  blocked = [];
let browser, context, page, fatal;
const user = '10000000-0000-4000-8000-000000000001',
  partner = '10000000-0000-4000-8000-000000000002',
  app = '20000000-0000-4000-8000-000000000001',
  past = '20000000-0000-4000-8000-000000000002';
function records() {
  return {
    applications: [{
      id: app,
      farmer_id: partner,
      worker_id: user,
      job_number: 1311,
      status: 'approved',
      terms_confirmed_worker_at: '2026-09-01',
      created_at: '2026-09-01T01:00:00Z'
    }, {
      id: past,
      farmer_id: partner,
      worker_id: user,
      job_number: 1200,
      status: 'completed',
      created_at: '2026-08-01T00:00:00Z'
    }],
    jobs_public: [{
      job_number: 1311,
      crop: 'ブロッコリー',
      task: '播種',
      date_start: '2026-09-24',
      date_end: '2026-09-24',
      work_time: '10:00〜12:00'
    }, {
      job_number: 1200,
      crop: 'にんじん',
      task: '収穫',
      date_start: '2026-08-24'
    }],
    employer_profiles_public: [{
      auth_id: partner,
      nickname: '農園サンプル',
      avatar_url: ''
    }],
    worker_profiles: [{
      auth_id: user,
      nickname: '働き手サンプル',
      avatar_url: ''
    }],
    messages: [{
      id: '30000000-0000-4000-8000-000000000001',
      application_id: app,
      sender_id: partner,
      body: '明日は集合場所でお待ちしています。',
      created_at: '2026-09-23T09:00:00Z',
      read_at: null
    }, {
      id: '30000000-0000-4000-8000-000000000002',
      application_id: past,
      sender_id: partner,
      body: 'ありがとうございました。',
      created_at: '2026-08-24T09:00:00Z',
      read_at: null
    }],
    chat_reads: [],
    admin_messages: []
  };
}
try {
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    plugins: [{
      name: 'chat-fixture',
      enforce: 'pre',
      resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return root + '/scripts/fixtures/chat/client.js';
      }
    }, react()],
    build: {
      outDir: output + '/bundle',
      lib: {
        entry: root + '/scripts/fixtures/chat/entry.jsx',
        name: 'ChatQA',
        formats: ['iife'],
        fileName: 'fixture',
        cssFileName: 'fixture'
      },
      minify: false
    }
  });
  const origin = 'https://example.org'; // All requests are intercepted; no production network or credentials.
  const assets = new Map([['/', {
    mime: 'text/html; charset=utf-8',
    data: '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.iife.js"></script></body></html>'
  }], ['/fixture.css', {
    mime: 'text/css',
    data: await readFile(output + '/bundle/fixture.css')
  }], ['/fixture.iife.js', {
    mime: 'text/javascript',
    data: await readFile(output + '/bundle/fixture.iife.js')
  }]]);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? {
      executablePath: process.env.CHROMIUM_PATH
    } : {}),
    args: ['--no-sandbox']
  });
  async function mount(settings = {}, viewport = {
    width: 1280,
    height: 900
  }) {
    await context?.close();
    context = await browser.newContext({
      viewport
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      const asset = url.origin === origin && assets.get(url.pathname);
      if (asset) return route.fulfill({
        status: 200,
        contentType: asset.mime,
        body: asset.data
      });
      blocked.push(route.request().url());
      return route.abort();
    });
    page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(settings => Object.assign(window, settings), {
      qaUser: user,
      qaData: records(),
      qaUnread: {
        [app]: 1
      },
      qaComputeUnread: true,
      qaChannels: [],
      qaRequests: [],
      qaRoute: app,
      ...settings
    });
    await page.goto(origin);
  }
  const wait = fn => page.waitForFunction(fn, null, {
    timeout: 10000
  });
  const focus = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const statusData = () => {
    const d = records();
    Object.assign(d.applications[0], {
      status_changed_at: '2026-09-24T10:00:00.123456Z',
      status_changed_by: partner
    });
    return d;
  };
  async function test(name, fn) {
    try {
      await fn();
      results.push({
        name,
        status: 'PASS'
      });
      console.log('PASS', name);
    } catch (e) {
      results.push({
        name,
        status: 'FAIL',
        error: e.stack
      });
      console.error('FAIL', name, e.message);
      await page.screenshot({
        path: evidence + '/failure-' + results.length + '.png'
      });
    }
  }
  for (const empty of [false, true]) await test(empty ? 'Status-only acknowledgement and inbox isolation' : 'Visible-message acknowledgement and inbox isolation', async () => {
    const d = statusData();
    if (empty) d.messages = d.messages.filter(m => m.application_id !== app);
    await mount({
      qaData: d
    });
    await wait(() => window.qaData.chat_reads.length === 1);
    assert.equal(await page.evaluate(() => window.qaData.chat_reads[0].last_read_at), '2026-09-24T10:00:00.123456Z');
    await page.getByRole('button', {
      name: 'メッセージ一覧に戻る'
    }).click();
    await page.locator('.chat-inbox-row').filter({
      hasText: '1200'
    }).locator('.chat-unread').waitFor();
    assert.equal(await page.locator('.chat-inbox-row').filter({
      hasText: '1311'
    }).locator('.chat-unread').count(), 0);
    assert.equal(await page.locator('.chat-inbox-row').filter({
      hasText: '1200'
    }).locator('.chat-unread').count(), 1);
    await page.screenshot({
      path: evidence + `/inbox-${empty ? 'status' : 'message'}.png`
    });
  });
  for (const failure of ['qaFailReadWrite', 'qaZeroReadWrite']) await test('Failed save/retry: ' + failure, async () => {
    await mount({
      qaData: statusData(),
      [failure]: 'chat_reads'
    });
    await page.getByRole('button', {
      name: '既読を再試行'
    }).waitFor();
    assert.equal(await page.evaluate(() => window.qaData.chat_reads.length), 0);
    assert.match(await page.locator('.chat-messages').innerText(), /明日は/);
    await page.screenshot({
      path: evidence + '/retry-' + failure + '.png'
    });
    await page.evaluate(f => window[f] = null, failure);
    await page.getByRole('button', {
      name: '既読を再試行'
    }).click();
    await wait(() => window.qaData.chat_reads.length === 1);
    await page.getByRole('button', {
      name: '既読を再試行'
    }).waitFor({
      state: 'hidden'
    });
  });
  await test('In-flight acknowledgement preserves unseen message and status', async () => {
    await mount({
      qaData: statusData(),
      qaHoldReadWrite: 'messages'
    });
    await wait(() => window.qaReleaseReadWrite);
    await page.evaluate(({
      app,
      partner
    }) => {
      window.qaData.messages.push({
        id: 'new-unseen',
        application_id: app,
        sender_id: partner,
        body: '後から届いたメッセージ',
        created_at: '2026-09-24T12:00:00Z',
        read_at: null
      });
      window.qaData.applications[0].status_changed_at = '2026-09-24T13:00:00Z';
      window.qaHoldReadWrite = null;
      window.qaReleaseReadWrite();
    }, {
      app,
      partner
    });
    await wait(() => window.qaData.chat_reads.length === 1);
    assert.equal(await page.evaluate(() => window.qaData.chat_reads[0].last_read_at), '2026-09-24T10:00:00.123456Z');
    assert.equal(await page.evaluate(() => window.qaData.messages.at(-1).read_at), null);
    assert.doesNotMatch(await page.locator('.chat-messages').innerText(), /後から届いた/);
    await focus();
    await wait(() => window.qaData.messages.at(-1).read_at && window.qaData.chat_reads[0].last_read_at === '2026-09-24T13:00:00Z');
  });
  await test('Real scroll keeps new message unread away from bottom, then acknowledges', async () => {
    const d = statusData();
    for (let i = 0; i < 65; i++) d.messages.push({
      id: 'history-' + i,
      application_id: app,
      sender_id: partner,
      body: '履歴メッセージ ' + i,
      created_at: `2026-09-24T09:${String(i % 60).padStart(2, '0')}:00Z`,
      read_at: null
    });
    await mount({
      qaData: d
    }, {
      width: 390,
      height: 844
    });
    await wait(() => window.qaData.messages.filter(m => m.application_id === window.qaRoute).every(m => m.read_at));
    const metrics = await page.locator('.chat-messages').evaluate(el => ({
      h: el.scrollHeight,
      c: el.clientHeight
    }));
    assert.ok(metrics.h > metrics.c + 300, JSON.stringify(metrics));
    await page.locator('.chat-messages').evaluate(el => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll', {
        bubbles: true
      }));
    });
    await page.evaluate(({
      app,
      partner
    }) => window.qaData.messages.push({
      id: 'scrolled-new',
      application_id: app,
      sender_id: partner,
      body: 'スクロール中の新着',
      created_at: '2026-09-24T12:00:00Z',
      read_at: null
    }), {
      app,
      partner
    });
    await focus();
    await page.getByText('スクロール中の新着', {
      exact: true
    }).waitFor({
      state: 'attached'
    });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.qaData.messages.at(-1).read_at), null);
    await page.getByRole('button', {
      name: '新しいメッセージ ↓'
    }).click();
    await wait(() => window.qaData.messages.at(-1).read_at);
    await page.screenshot({
      path: evidence + '/mobile-bottom.png'
    });
  });
  await test('Receipt uses read_at, not status cursor', async () => {
    const d = records();
    d.messages[0].sender_id = user;
    d.chat_reads = [{
      application_id: app,
      reader_id: partner,
      last_read_at: '2026-09-25T00:00:00Z'
    }];
    await mount({
      qaData: d
    });
    await page.locator('.chat-bubble').waitFor();
    assert.doesNotMatch(await page.locator('.chat-messages').innerText(), /既読/);
    await page.evaluate(() => window.qaData.messages[0].read_at = '2026-09-25T01:00:00Z');
    await focus();
    await wait(() => document.querySelector('.chat-messages').textContent.includes('既読'));
    await page.screenshot({
      path: evidence + '/receipt.png'
    });
  });
  await test('Mobile portrait, short viewport, landscape keep composer and details usable', async () => {
    await mount({}, {
      width: 390,
      height: 844
    });
    await page.getByRole('textbox', {
      name: 'メッセージ',
      exact: true
    }).fill('入力途中');
    for (const viewport of [{
      width: 390,
      height: 844
    }, {
      width: 390,
      height: 390
    }, {
      width: 844,
      height: 390
    }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(100);
      const b = await page.locator('.chat-room').boundingBox();
      assert.ok(Math.abs(b.width - viewport.width) < 2 && Math.abs(b.height - viewport.height) < 2, JSON.stringify(b));
      const input = await page.getByRole('textbox', {
        name: 'メッセージ',
        exact: true
      }).boundingBox();
      assert.ok(input.y >= 0 && input.y + input.height <= viewport.height + 1, JSON.stringify(input));
      await page.getByRole('button', {
        name: '詳細',
        exact: true
      }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', {
        name: '閉じる',
        exact: true
      }).click();
      assert.equal(await page.getByRole('textbox', {
        name: 'メッセージ',
        exact: true
      }).inputValue(), '入力途中');
      await page.screenshot({
        path: evidence + `/viewport-${viewport.width}x${viewport.height}.png`
      });
    }
  });
} catch (error) {
  fatal = error.stack || String(error);
  console.error(error);
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({
    checkedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || null,
    browser: browser?.version() || null,
    results,
    errors,
    blocked,
    fatal,
    syntheticOnly: true
  }, null, 2));
  await browser?.close();
  await rm(output, {
    recursive: true,
    force: true
  });
}
console.log(JSON.stringify({
  checks: results.length,
  passed: results.filter(r => r.status === 'PASS').length,
  evidence
}));
if (fatal || results.some(r => r.status === 'FAIL') || errors.length || blocked.length) process.exitCode = 1;
