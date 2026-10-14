// Production read-only smoke check. No login, posting, deletion, or application API writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const origin = 'https://www.chitose-bank.com';
const stamp = new Date().toISOString();
async function note(value) {
  console.log(JSON.stringify(value));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`);
}
async function get(path) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'Read-only checks stay on the production origin');
  const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
  assert.equal(response.status, 200, `GET ${url.pathname}`);
  return { text: await response.text(), url, type: response.headers.get('content-type') || '' };
}
function imports(text, base) {
  return [...text.matchAll(/["'`]([^"'`\s]+\.js)["'`]/g)].map(match => {
    const value = match[1];
    return new URL(value.startsWith('assets/') ? '/' + value : value, base);
  }).filter(url => url.origin === origin && url.pathname.startsWith('/assets/'));
}

test('active production bundles include the complete comparison snapshot and conflict protection', { timeout: 90000 }, async () => {
  const html = await get('/?verification=stage4-' + encodeURIComponent(stamp));
  assert.match(html.type, /text\/html/);
  const scripts = [...html.text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(match => new URL(match[1], origin)).filter(url => url.origin === origin && url.pathname.startsWith('/assets/'));
  assert.ok(scripts.length > 0, 'Active HTML references app scripts');
  const targets = new Map();
  for (const script of scripts) {
    const entry = await get(script);
    for (const url of imports(entry.text, script)) {
      if (/\/(?:deviceDrafts|jobDraftProtocol)-[^/]+\.js$/.test(url.pathname)) targets.set(url.href, url);
    }
  }
  assert.ok(targets.size > 0, 'Active entry references the draft implementation');
  let source = '';
  const assets = [];
  for (const url of targets.values()) {
    const asset = await get(url);
    assert.match(asset.type, /javascript/);
    source += asset.text;
    assets.push({ path: url.pathname, sha256: createHash('sha256').update(asset.text).digest('hex') });
  }
  const snapshotPattern = /Object\.hasOwn\([^)]*,["'`]draft_step_id["'`]\)[\s\S]{0,120}draft_step_id/;
  // The production minifier may emit any JavaScript string delimiter.
  for (const quote of ['"', "'", '`']) {
    assert.ok(snapshotPattern.test('Object.hasOwn(row,' + quote + 'draft_step_id' + quote + ')?{draft_step_id:row.draft_step_id}:{}'));
  }
  assert.equal(snapshotPattern.test('return {...patch(row),status:row.status}'), false);
  assert.ok(snapshotPattern.test(source), 'Server step ID is included only when actually present in the comparison');
  assert.match(source, /conflictContext/, 'Original conflict evidence survives retries');
  assert.match(source, /wrong_identity/, 'Responses cannot change the job or owner');
  await note({ checkedAt: stamp, check: 'live-assets', result: 'pass', assets, productionWrites: 0 });
});

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: fresh mobile session renders production without fatal script errors`, { timeout: 90000 }, async () => {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
    let writesBlocked = 0, externalBlocked = 0;
    const scriptErrors = [], assetErrors = [];
    try {
      // Only static files and documents are allowed to leave this isolated browser.
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['GET', 'HEAD'].includes(request.method())) { writesBlocked++; return route.abort('blockedbyclient'); }
        if (url.origin !== origin) { externalBlocked++; return route.abort('blockedbyclient'); }
        if (!['document', 'script', 'stylesheet', 'image', 'font', 'manifest'].includes(request.resourceType())) return route.abort('blockedbyclient');
        return route.continue();
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage();
      page.on('pageerror', error => scriptErrors.push(error.name + ': ' + error.message.slice(0,180)));
      page.on('response', response => { const url = new URL(response.url()); if (url.origin === origin && /\.(?:js|css)$/.test(url.pathname) && response.status() >= 400) assetErrors.push({ path: url.pathname, status: response.status() }); });
      const probes = [];
      for (const hash of ['/', '/work/new/12']) {
        const response = await page.goto(origin + '/?verification=stage4-' + encodeURIComponent(hash) + '#' + hash, { waitUntil: 'domcontentloaded', timeout: 30000 });
        assert.equal(response?.status(), 200);
        await page.waitForFunction(() => { const root = document.querySelector('#root'); return root?.querySelector('button,a,input') && root.textContent.trim().length > 20; }, null, { timeout: 20000 });
        probes.push(await page.evaluate(() => ({ hash: location.hash, rootRendered: !!document.querySelector('#root')?.children.length, buttons: document.querySelectorAll('#root button').length, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth })));
      }
      assert.deepEqual(scriptErrors, []);
      assert.deepEqual(assetErrors, []);
      await note({ checkedAt: new Date().toISOString(), check: 'mobile-' + name, result: 'pass', probes, productionWrites: 0, writesBlocked, externalBlocked, limitation: 'Clean anonymous emulation; APIs and service workers are blocked. Does not certify an authenticated iPhone publication.' });
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
