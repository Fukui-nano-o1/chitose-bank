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
      },
      transform(code,id) {
        if(id.endsWith('/src/lib/utils.js')) return code.replace(/^export const ADMIN_EMAIL = .*;$/m,'export const ADMIN_EMAIL = "admin-fixture@example.test";');
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
  const prodHtml = await readFile(root + '/index.html', 'utf8');
  const viewportMeta = ['viewport','color-scheme','theme-color','apple-mobile-web-app-capable','apple-mobile-web-app-status-bar-style','apple-mobile-web-app-title'].map(name => {
    const meta = prodHtml.match(new RegExp('<meta name="' + name + '"[^>]*>'))?.[0];
    assert.ok(meta, 'Missing production meta: ' + name);
    return meta;
  }).join('');
  const assets = new Map([['/', {
    mime: 'text/html; charset=utf-8',
    data: '<!doctype html><html lang="ja"><head><meta charset="UTF-8">' + viewportMeta + '<link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.iife.js"></script></body></html>'
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
      viewport, serviceWorkers: 'block'
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
    await page.addInitScript(settings => {
      Object.assign(window, settings);
      if (settings.qaIosStandalone) Object.defineProperty(window.navigator, 'standalone', { value:true });
    }, {
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
  await test('Notched mobile header remains clear of the status area while only history scrolls', async () => {
    for (const route of [app, past, 'admin']) {
      const data = records();
      const inbox = route === 'admin';
      const messages = Array.from({ length: 45 }, (_, i) => ({
        id: `40000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        application_id: route, sender_id: i % 2 ? user : partner,
        body: `合成会話 ${i + 1}：画面の上下に固定された領域を確認するためのメッセージ`,
        created_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
        read_at: '2026-09-02T00:00:00Z',
      }));
      if (inbox) data.admin_messages = messages.map(message => ({
        ...message, user_id: user, is_admin: false, read_by_user: true, read_by_admin: true,
      }));
      else data.messages = messages;
      await mount({ qaRoute: route, qaData: data }, { width: 390, height: 844 });
      const room = page.locator('.chat-room');
      const scroller = page.locator('.chat-messages');
      await page.locator('.chat-bubble').first().waitFor();
      await wait(() => {
        const history=document.querySelector('.chat-messages');
        return history.scrollHeight - history.clientHeight > 100 &&
          Math.abs(history.scrollHeight - history.clientHeight - history.scrollTop) < 3;
      });
      // Desktop browser emulation reports env(safe-area-inset-top) as zero.
      await room.evaluate(element => element.style.setProperty('--chat-device-safe-top', '59px'));
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const geometry = () => page.evaluate(() => {
        const box = selector => {
          const element = document.querySelector(selector);
          if (!element || getComputedStyle(element).display === 'none') return null;
          const r = element.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height };
        };
        const header = document.querySelector('.chat-room-header');
        const history = document.querySelector('.chat-messages');
        return { room: box('.chat-room'), header: box('.chat-room-header'),
          back: box('.chat-icon-button'), details: box('.chat-details-button, .chat-room-header .chat-text-button'),
          context: box('.chat-context'), history: box('.chat-messages'), historyTop: history.scrollTop,
          maxScroll: history.scrollHeight - history.clientHeight,
          background: getComputedStyle(header).backgroundColor,
          filter: getComputedStyle(header).filter,
          hitBack: (() => { const r = header.querySelector('button').getBoundingClientRect();
            return header.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })(),
        };
      });
      const bottom = await geometry();
      assert.ok(bottom.back.top >= 59 && bottom.details.top >= 59, JSON.stringify(bottom));
      assert.ok(bottom.back.bottom <= bottom.header.bottom && bottom.details.bottom <= bottom.header.bottom);
      assert.equal(bottom.background, 'rgb(255, 255, 255)');
      assert.equal(bottom.filter, 'none');
      assert.equal(bottom.hitBack, true);
      assert.equal(Boolean(bottom.context), !inbox);
      assert.ok(bottom.history.top - (bottom.context || bottom.header).bottom >= 7);
      assert.ok(bottom.maxScroll > 100 && Math.abs(bottom.historyTop - bottom.maxScroll) < 3, JSON.stringify(bottom));
      await scroller.evaluate(element => { element.scrollTop = 0; });
      const top = await geometry();
      assert.equal(top.historyTop, 0);
      for (const key of ['header', 'back', 'details', 'context', 'history']) assert.deepEqual(top[key], bottom[key]);
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
      assert.ok(Math.abs((await geometry()).historyTop - bottom.maxScroll) < 3);
      await room.evaluate(element => {
        // Model a visual viewport already panned beyond the notch.
        element.style.setProperty('--chat-top', '83px');
        element.style.setProperty('--chat-height', '350px');
      });
      const panned = await geometry();
      assert.equal(panned.room.top, 83);
      assert.ok(panned.back.top >= 83 && panned.back.top < 105, JSON.stringify(panned));
      assert.ok(panned.history.height > 0);
    }
  });
  await test('Admin target: compare actual title/report text against a modeled status mask',async()=>{
    const d=records(), nickname='検証用のみどりさん';
    d.worker_profiles.push({auth_id:partner,nickname});
    d.admin_messages=[{id:'fixture-incoming',user_id:partner,from_admin:false,body:'架空の会話',created_at:'2026-09-23T09:00:00Z',read_at:'2026-09-24T09:00:00Z'}];
    await mount({qaRoute:'admin/'+partner,qaAdmin:true,qaIosStandalone:true,qaData:d},{width:390,height:844});
    await page.getByText(nickname,{exact:true}).waitFor();
    await page.getByText('架空の会話',{exact:true}).waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const geometry=async (inset,viewportOffset,maskBottom,visibleHeight=null)=>page.evaluate(({inset,viewportOffset,maskBottom,visibleHeight})=>{
      const room=document.querySelector('.chat-room');
      room.style.setProperty('--chat-device-safe-top',inset+'px');
      room.style.setProperty('--chat-top',viewportOffset+'px');
      if (visibleHeight !== null) room.style.setProperty('--chat-height',visibleHeight+'px');
      const title=document.querySelector('.chat-room-header strong'),report=document.querySelector('.chat-room-header .chat-text-button');
      const calculate=element=>{
        const range=document.createRange();range.selectNodeContents(element);
        const rect=range.getBoundingClientRect();
        const sample=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        return {top:rect.top,bottom:rect.bottom,height:rect.height,underMask:Math.max(0,Math.min(rect.bottom,maskBottom)-rect.top),hit:sample===element||element.contains(sample)};
      };
      return {title:calculate(title),report:calculate(report)};
    },{inset,viewportOffset,maskBottom,visibleHeight});
    const clearOf = (measurements,minTop) => {
      for (const rect of Object.values(measurements)) {
        assert.ok(rect.height>0&&rect.top>=minTop&&rect.underMask===0&&rect.hit,JSON.stringify(measurements));
      }
    };
    const guarded=await geometry(59,0,62);
    clearOf(guarded,64);
    const largerInset=await geometry(82,0,82);
    clearOf(largerInset,82);
    const panned=await geometry(59,83,62);
    clearOf(panned,83);
    assert.ok(panned.title.top<106,'already panned view must not reserve another 64px');
    const noReportedInset=await geometry(0,0,62);
    clearOf(noReportedInset,64);
    // iOS may shrink/pan only the visual viewport while the CSS media
    // query still describes a tall portrait. Never reserve the inset twice.
    const keyboardOnTallPortrait=await geometry(0,100,62,330);
    clearOf(keyboardOnTallPortrait,100);
    assert.ok(keyboardOnTallPortrait.title.top<126);
    const keyboardComposer=await page.getByRole('textbox',{name:'運営へのメッセージ'}).boundingBox();
    assert.ok(keyboardComposer.y>=100&&keyboardComposer.y+keyboardComposer.height<=431);
    // Prevent the stand-alone fallback from taking vertical space in a compact
    // viewport or landscape; regular positive device insets still apply.
    await page.setViewportSize({width:390,height:380});
    const shortViewport=await geometry(0,0,0);
    assert.ok(shortViewport.title.top<48);
    await page.setViewportSize({width:844,height:390});
    const landscape=await geometry(0,0,0);
    assert.ok(landscape.title.top<48);
    await mount({qaRoute:'admin/'+partner,qaAdmin:true,qaData:d},{width:390,height:844});
    await page.getByText(nickname,{exact:true}).waitFor();
    const safariNoStandalone=await geometry(0,0,0);
    assert.ok(safariNoStandalone.title.top<48);
    // The user-facing support thread has the same title + report header.
    await mount({qaRoute:'admin',qaIosStandalone:true},{width:390,height:844});
    await page.getByText('chitose-bank運営',{exact:true}).waitFor();
    const supportNoReportedInset=await geometry(0,0,62);
    clearOf(supportNoReportedInset,64);
    await mount({qaRoute:'admin'},{width:390,height:844});
    await page.getByText('chitose-bank運営',{exact:true}).waitFor();
    const supportSafariNoStandalone=await geometry(0,0,0);
    assert.ok(supportSafariNoStandalone.title.top<48);
    await writeFile(path.join(evidence,'operator-status-mask-model.json'),JSON.stringify({
      guarded,largerInset,panned,noReportedInset,keyboardOnTallPortrait,shortViewport,landscape,safariNoStandalone,
      supportNoReportedInset,supportSafariNoStandalone,syntheticOnly:true
    },null,2));
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
