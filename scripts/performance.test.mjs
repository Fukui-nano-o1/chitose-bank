import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createModuleLoader } from '../src/lib/moduleLoader.js';
import { collectStartupAssets, startupPrecache } from '../startupPrecache.js';

test('navigation and simultaneous preloads share one import, including after completion', async () => {
  let count = 0;
  let complete;
  const module = { default: () => null };
  const load = createModuleLoader(() => { count++; return new Promise(resolve => { complete = resolve; }); });
  const first = load();
  const second = load();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(count, 1);
  complete(module);
  assert.equal(await first, module);
  assert.equal(await load(), module);
  assert.equal(count, 1);
});

test('offline preloading can fail and navigation can retry successfully', async () => {
  let online = false;
  const load = createModuleLoader(() => online ? { default: 'page' } : Promise.reject(new Error('offline')));
  await assert.rejects(load(), /offline/);
  online = true;
  assert.deepEqual(await load(), { default: 'page' });
});

test('synchronous import errors do not leave a poisoned loader', async () => {
  let first = true;
  const load = createModuleLoader(() => { if (first) { first = false; throw new Error('failed'); } return 'ready'; });
  await assert.rejects(load(), /failed/);
  assert.equal(await load(), 'ready');
});

const chunk = (fileName, imports = [], css = [], isEntry = false) => ({
  type: 'chunk', fileName, imports, isEntry,
  dynamicImports: ['assets/calendar-abc.js'], viteMetadata: { importedCss: new Set(css) },
});
const bundle = {
  'assets/app-abc.js': chunk('assets/app-abc.js', ['assets/shared-abc.js'], ['assets/app-abc.css'], true),
  'assets/shared-abc.js': chunk('assets/shared-abc.js', ['assets/app-abc.js'], ['assets/shared-abc.css']),
  'assets/calendar-abc.js': chunk('assets/calendar-abc.js', ['assets/shared-abc.js'], ['assets/calendar-abc.css']),
};

test('precache follows all static dependencies and their CSS, handles cycles, and excludes unopened pages', () => {
  assert.deepEqual([...collectStartupAssets(bundle)].sort(), [
    'assets/app-abc.js', 'assets/app-abc.css', 'assets/shared-abc.js', 'assets/shared-abc.css',
  ].sort());
});

test('precache preserves icons/registration but does not install dynamic routes', () => {
  const config = startupPrecache();
  config.plugin.generateBundle({}, bundle);
  const files = [...Object.keys(bundle), 'assets/app-abc.css', 'assets/shared-abc.css', 'assets/calendar-abc.css', 'pwa-192.png', 'registerSW.js'];
  const { manifest, warnings } = config.transform(files.map(url => ({ url, revision: 'fixture' })));
  assert.equal(manifest.length, 6);
  assert(!manifest.some(entry => entry.url.includes('calendar')));
  assert(manifest.some(entry => entry.url === 'pwa-192.png'));
  assert(manifest.every(entry => entry.revision === 'fixture'));
  assert.deepEqual(warnings, []);
});

test('a missing build graph fails the build instead of shipping incomplete startup caches', () => {
  assert.throws(() => startupPrecache().transform([]), /依存グラフ/);
});

// SWのルート登録を隔離して実行。実ネットワークや端末のキャッシュには触らない。
function serviceWorkerRoutes() {
  const routes = [];
  const listeners = [];
  class Strategy { constructor(options) { this.options = options; } }
  class Navigation { constructor(handler, options) { this.handler = handler; this.options = options; } }
  const source = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
  new Function('self', 'clientsClaim', 'precacheAndRoute', 'cleanupOutdatedCaches',
    'registerRoute', 'NavigationRoute', 'NetworkFirst', 'StaleWhileRevalidate', 'CacheFirst',
    'ExpirationPlugin', 'CacheableResponsePlugin', source)(
    { location: { origin: 'https://fixture.invalid' }, skipWaiting() {},
      addEventListener(name) { listeners.push(name); }, __WB_MANIFEST: [] },
    () => {}, () => {}, () => {}, (...args) => routes.push(args), Navigation,
    Strategy, Strategy, Strategy, Strategy, Strategy,
  );
  return { routes, listeners };
}

test('route cache matches only same-origin immutable assets, never API/private data', () => {
  const { routes } = serviceWorkerRoutes();
  const [match] = routes.find(([, strategy]) => strategy?.options.cacheName === 'route-assets-v1');
  const matches = url => match({ url: new URL(url, 'https://fixture.invalid') });
  assert(matches('/assets/ChatList-abc_123.js'));
  assert(matches('/assets/auth-ABC123.css'));
  for (const url of ['/rest/v1/messages', '/auth/v1/token', '/api/save', '/assets/app.js',
    '/assets/page-abc.js.map', 'https://external.invalid/assets/page-abc.js']) assert.equal(matches(url), false, url);
});

test('route cache rejects SPA fallback HTML, errors, and missing MIME types', async () => {
  const { routes } = serviceWorkerRoutes();
  const [, strategy] = routes.find(([, item]) => item?.options.cacheName === 'route-assets-v1');
  const plugin = strategy.options.plugins.find(item => item.cacheWillUpdate);
  for (const type of ['text/javascript', 'application/javascript', 'text/css']) {
    const response = new Response('fixture', { headers: { 'content-type': type } });
    assert.equal(await plugin.cacheWillUpdate({ response }), response);
  }
  for (const [type, status] of [['text/html', 200], ['application/javascript', 404], ['', 200]]) {
    const response = new Response('fixture', { status, headers: { 'content-type': type } });
    assert.equal(await plugin.cacheWillUpdate({ response }), null);
  }
});

test('navigation keeps its 150ms fallback and excludes share endpoints; push handlers survive', () => {
  const { routes, listeners } = serviceWorkerRoutes();
  const [navigation] = routes.find(([item]) => item.handler);
  assert.equal(navigation.handler.options.networkTimeoutSeconds, 0.15);
  assert(navigation.options.denylist.some(pattern => pattern.test('/j/123')));
  assert.deepEqual(listeners.sort(), ['notificationclick', 'push']);
});
