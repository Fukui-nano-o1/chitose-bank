import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobCardPress, ownJobActionOptions, resolveOwnJobSelection } from '../src/lib/ownJobActions.js';

function fixture() {
  let now = 0, next = 0, holds = 0;
  const timers = new Map();
  const press = createJobCardPress(() => { holds++; }, {
    schedule: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
    unschedule: id => timers.delete(id),
  });
  const tick = ms => { now += ms; for (const [id, item] of timers) if (item.at <= now) { timers.delete(id); item.fn(); } };
  return { press, tick, holds: () => holds };
}
const point = (x = 20, y = 20, extra = {}) => ({ pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true, ...extra });
const kinds = (job, ended) => ownJobActionOptions(job, ended).map(a => a.kind);

test('normal tap remains normal', () => { const f = fixture(); f.press.start(point()); f.tick(200); f.press.end(point()); f.tick(500); assert.equal(f.holds(), 0); assert.equal(f.press.consumeClick(), false); });
test('450 ms hold selects once and consumes only its following click', () => { const f = fixture(); f.press.start(point()); f.tick(449); assert.equal(f.holds(), 0); f.tick(1); f.press.open(); f.press.end(point()); assert.equal(f.holds(), 1); assert.equal(f.press.consumeClick(), true); assert.equal(f.press.consumeClick(), false); });
test('moving more than 10 px cancels the hold and stray click', () => { const f = fixture(); f.press.start(point()); f.press.move(point(20, 31)); f.tick(700); assert.equal(f.holds(), 0); assert.equal(f.press.consumeClick(), true); });
test('minor finger movement still permits a hold', () => { const f = fixture(); f.press.start(point()); f.press.move(point(23, 24)); f.tick(450); assert.equal(f.holds(), 1); });
test('pointercancel or scroll cancels the pending hold', () => { const f = fixture(); f.press.start(point()); f.press.cancel(true); f.tick(1000); assert.equal(f.holds(), 0); });
test('a second touch cancels a pending hold', () => { const f = fixture(); f.press.start(point()); f.press.start(point(20, 20, { pointerId: 2, isPrimary: false })); f.tick(600); assert.equal(f.holds(), 0); });
test('right mouse button never starts the timer', () => { const f = fixture(); f.press.start(point(20, 20, { button: 2 })); f.tick(600); assert.equal(f.holds(), 0); });
test('unrelated pointer release does not complete the gesture', () => { const f = fixture(); f.press.start(point()); f.press.end(point(20, 20, { pointerId: 2 })); f.tick(450); assert.equal(f.holds(), 1); });
test('new physical tap after a hold is not suppressed', () => { const f = fixture(); f.press.start(point()); f.tick(450); f.press.end(point()); f.press.start(point()); f.press.end(point()); assert.equal(f.press.consumeClick(), false); });
test('unmount clears all pending work', () => { const f = fixture(); f.press.start(point()); f.press.destroy(); f.tick(1000); assert.equal(f.holds(), 0); });
test('unpublished drafts allow resume, copy and delete even with a past date', () => { assert.deepEqual(kinds({ job_number: 1, status: 'draft', opened_at: null }, true), ['resume', 'copy', 'delete']); });
test('previously published jobs never offer delete', () => { assert.deepEqual(kinds({ job_number: 1, status: 'draft', opened_at: '2026-10-01' }, false), ['resume', 'copy']); });
test('active jobs allow edit, copy and unpublish; expired jobs only copy', () => { assert.deepEqual(kinds({ job_number: 1, status: 'open' }, false), ['edit', 'copy', 'unpublish']); assert.deepEqual(kinds({ job_number: 1, status: 'open' }, true), ['copy']); assert.deepEqual(kinds({ job_number: 1, status: 'closed' }, true), ['copy']); });
test('missing or pending job never gets destructive actions', () => { assert.deepEqual(kinds(null), []); assert.deepEqual(kinds({ job_number: 1, status: 'pending' }), ['copy']); });
test('selection resolves only one current row within its owner and tab', () => {
  const rows = [{ job_number: 1 }, { job_number: 2 }];
  const context = { rows, scope: 'draft', ownerId: 'owner-a', enabled: true };
  const selection = { number: 2, scope: 'draft', ownerId: 'owner-a' };
  assert.equal(resolveOwnJobSelection(selection, context), rows[1]);
  for (const change of [{ ownerId: 'owner-b' }, { scope: 'active' }, { enabled: false }, { rows: [rows[0]] }]) assert.equal(resolveOwnJobSelection(selection, { ...context, ...change }), null);
});

test('right-click can reopen actions after an earlier hold', () => { const f = fixture(); f.press.start(point()); f.tick(450); f.press.end(point()); f.press.start(point(20, 20, { button: 2 })); f.press.open(); assert.equal(f.holds(), 2); });
