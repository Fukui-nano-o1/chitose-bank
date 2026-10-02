import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { explainError, errorCategoryKey } from '../src/lib/errorCatalog.js';

const script = readFileSync(new URL('../public/registerSW.js', import.meta.url), 'utf8');
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

test('reported stack gets an explanation; unrelated Rejected errors remain visible as render errors', () => {
  const row = { message: 'Rejected', source: 'unhandledrejection', component: 'global',
    stack: 'Error: Rejected\n at wrsParams.serviceWorkers.navigator.serviceWorker.register (<anonymous>:12:648)\n at https://www.chitose-bank.com/registerSW.js:1:98' };
  assert.equal(errorCategoryKey(row), 'browser');
  assert.match(explainError(row).title, /Service Worker/);
  const unrelated = { ...row, stack: 'Error: Rejected\n at saveApplication (app.js:1:2)' };
  assert.equal(errorCategoryKey(unrelated), 'render');
  assert.equal(explainError(unrelated), null);
});
