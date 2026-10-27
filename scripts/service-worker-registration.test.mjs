import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { explainError, errorCategoryKey } from '../src/lib/errorCatalog.js';
import { clearLegacyPageCache } from '../src/app/browserStartup.js';

const script = readFileSync(new URL('../public/registerSW.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('cb_bootReload'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function run(navigator, readyState = 'loading') {
  const window = new EventTarget();
  const warnings = [];
  vm.runInNewContext(script, { navigator, document: { readyState }, window,
    console: { warn: (...args) => warnings.push(args) }, Promise });
  return { window, warnings };
}

test('registers the same worker and scope once after load, preserving normal PWA support', async () => {
  const calls = [];
  const { window, warnings } = run({ serviceWorker: { register: (...args) => { calls.push(args); return Promise.resolve({}); } } });
  assert.equal(calls.length, 0);
  window.dispatchEvent(new Event('load'));
  window.dispatchEvent(new Event('load'));
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/sw.js');
  assert.equal(calls[0][1].scope, '/');
  assert.equal(warnings.length, 0);
});

test('late loading still registers, while unsupported environments do nothing', async () => {
  let calls = 0;
  const ready = run({ serviceWorker: { register: () => { calls++; return Promise.resolve({}); } } }, 'complete');
  const unsupported = run({}, 'complete');
  await tick();
  assert.equal(calls, 1);
  assert.equal(ready.warnings.length + unsupported.warnings.length, 0);
});

for (const kind of ['promise', 'synchronous', 'getter']) {
  test(`registration ${kind} rejection is handled locally and leaves the page running`, async () => {
    const error = new Error('Rejected');
    const navigator = kind === 'getter'
      ? Object.defineProperty({}, 'serviceWorker', { get() { throw error; } })
      : { serviceWorker: { register() { if (kind === 'synchronous') throw error; return Promise.reject(error); } } };
    const { warnings } = run(navigator, 'complete');
    let pageContinued = false;
    await Promise.resolve().then(() => { pageContinued = true; });
    await tick(); // node:test fails automatically if a rejection escapes the handler.
    assert.equal(pageContinued, true);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][1], error, 'retain the original cause for diagnostics');
  });
}

test('reported stack gets an explanation; unrelated Rejected errors remain visible as async errors', () => {
  const row = { message: 'Rejected', source: 'unhandledrejection', component: 'global',
    stack: 'Error: Rejected\n at wrsParams.serviceWorkers.navigator.serviceWorker.register (<anonymous>:12:648)\n at https://www.chitose-bank.com/registerSW.js:1:98' };
  assert.equal(errorCategoryKey(row), 'browser');
  assert.match(explainError(row).title, /Service Worker/);
  const unrelated = { ...row, stack: 'Error: Rejected\n at saveApplication (app.js:1:2)' };
  assert.equal(errorCategoryKey(unrelated), 'async');
  assert.match(explainError(unrelated).title, /原因未特定/);
});

function boot({ serviceWorker, caches } = {}) {
  let onError, reloads = 0, now = 0, sequence = 0;
  const storage = new Map(), timers = new Map();
  const origin = 'https://fixture.test';
  vm.runInNewContext(bootScript, {
    window: { caches, addEventListener: (_name, fn) => { onError = fn; } },
    navigator: serviceWorker ? { serviceWorker } : {}, caches, URL, Promise,
    sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    location: { origin, href: origin + '/#/login', reload: () => { reloads++; } },
    setTimeout: (fn, delay) => { const id = ++sequence; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    error: (src, tagName = 'SCRIPT') => onError({ target: { tagName, src } }),
    get reloads() { return reloads; }, storage, timers,
    advance(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
  };
}

test('failure to load the optional SW file never reloads a form or consumes required-script recovery', async () => {
  let cleanups = 0;
  const page = boot({ serviceWorker: { getRegistrations: async () => { cleanups++; return []; } } });
  page.error('https://fixture.test/registerSW.js?version=1');
  await tick(); page.advance(3000);
  assert.equal(page.reloads, 0);
  assert.equal(cleanups, 0);
  assert.equal(page.storage.has('cb_bootReload'), false);
  page.error('https://fixture.test/assets/main.js');
  await tick(); page.advance(3000);
  assert.equal(page.reloads, 1);
  assert.equal(cleanups, 1);
  page.error('https://fixture.test/assets/main.js');
  await tick(); assert.equal(page.reloads, 1, 'no reload loop');
});

for (const kind of ['serviceWorker', 'cache']) {
  test(`required-script recovery proceeds after two seconds when ${kind} cleanup hangs, without reloading again on late completion`, async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const page = boot(kind === 'serviceWorker'
      ? { serviceWorker: { getRegistrations: () => pending } }
      : { caches: { keys: () => pending } });
    page.error('https://fixture.test/assets/main.js');
    await tick(); page.advance(1999); assert.equal(page.reloads, 0);
    page.advance(1); assert.equal(page.reloads, 1);
    finish([]); await tick(); assert.equal(page.reloads, 1);
    assert.equal(page.timers.size, 0);
  });
}

test('required-script recovery still works with rejected or absent APIs, and ignores non-script errors', async () => {
  for (const options of [{}, { caches: { keys: () => Promise.reject(new Error('Denied')) } }]) {
    const page = boot(options);
    page.error('https://fixture.test/photo.jpg', 'IMG');
    assert.equal(page.storage.size, 0);
    page.error('https://other.test/registerSW.js');
    await tick(); assert.equal(page.reloads, 1, 'only our optional script is exempt');
    assert.equal(page.timers.size, 0);
  }
});

test('legacy cache cleanup handles unavailable, rejected and throwing APIs, without marking failure as complete or touching auth/input', async () => {
  for (const kind of ['success', 'reject', 'throw', 'getter', 'storage', 'unsupported', 'diagnostic']) {
    const saved = new Map([['auth-token', 'keep'], ['input-draft', 'keep']]), warnings = [], names = [];
    const browser = {
      console: { warn: (...args) => { if (kind === 'diagnostic') throw new Error('Console denied'); warnings.push(args); } },
      localStorage: { getItem: k => { if (kind === 'storage') throw new Error('Storage denied'); return saved.get(k); }, setItem: (k, v) => saved.set(k, v) },
    };
    if (kind === 'getter') Object.defineProperty(browser, 'caches', { get() { throw new Error('Cache denied'); } });
    else if (kind !== 'unsupported') browser.caches = { delete: name => {
      names.push(name);
      if (kind === 'throw') throw new Error('Cache denied');
      if (['reject', 'diagnostic'].includes(kind)) return Promise.reject(new Error('Cache denied'));
      return Promise.resolve(true);
    } };
    await clearLegacyPageCache(browser);
    assert.equal(saved.has('cb_pagesCachePurge_v1'), kind === 'success', kind);
    assert.equal(saved.get('auth-token'), 'keep'); assert.equal(saved.get('input-draft'), 'keep');
    assert.ok(names.every(name => name === 'pages-cache'));
    if (kind === 'success') { await clearLegacyPageCache(browser); assert.equal(names.length, 1); }
  }
});
