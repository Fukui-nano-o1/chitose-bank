// エラー記録の間引きの機械検算（2026-09-28・Script error 18,200行/15分の教訓）。
// 規則＝同じ文言はページの読み込みごとに5件まで・全部で50件まで。詳細は
// src/app/diagnostics/errorThrottle.js（純関数＝supabase・DOM非依存の層だけを読む）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeErrorThrottle, MAX_PER_MESSAGE, MAX_PER_LOAD } from '../src/app/diagnostics/errorThrottle.js';

test('同じ文言は5件まで＝6件目からは書かない', () => {
  const admit = makeErrorThrottle();
  for (let i = 1; i <= MAX_PER_MESSAGE; i++) {
    const r = admit('Script error.');
    assert.equal(r.ok, true, `${i}件目は書く`);
    assert.equal(r.last, i === MAX_PER_MESSAGE, '枠を使い切る1件だけに印');
  }
  // 実際の事故のペース＝毎秒20件×15分。全部落ちること
  for (let i = 0; i < 18200; i++) assert.equal(admit('Script error.').ok, false);
});

test('別の文言は別の枠＝互いに食い合わない', () => {
  const admit = makeErrorThrottle();
  for (let i = 0; i < MAX_PER_MESSAGE; i++) admit('Script error.');
  assert.equal(admit('Script error.').ok, false);
  assert.equal(admit('TypeError: x is not a function').ok, true, '新しい文言は書ける');
});

test('全体の上限50件＝文言を変え続けても書き続けられない', () => {
  const admit = makeErrorThrottle();
  let wrote = 0;
  for (let i = 0; i < MAX_PER_LOAD + 30; i++) {
    const r = admit(`エラー その${i}`);   // 毎回違う文言
    if (r.ok) {
      wrote++;
      if (wrote === MAX_PER_LOAD) assert.equal(r.last, true, '50件目に印');
    }
  }
  assert.equal(wrote, MAX_PER_LOAD);
  assert.equal(admit('まったく新しい文言').ok, false, '上限後は新しい文言も書かない');
});

test('文言の頭200文字で束ねる＝末尾だけ違う長文で枠を逃れられない', () => {
  const admit = makeErrorThrottle();
  const base = 'x'.repeat(200);
  for (let i = 0; i < MAX_PER_MESSAGE; i++) assert.equal(admit(base + '違い' + i).ok, true);
  assert.equal(admit(base + 'まだ違う').ok, false);
});

test('空・null の文言でも落ちない', () => {
  const admit = makeErrorThrottle();
  assert.equal(admit('').ok, true);
  assert.equal(admit(null).ok, true);   // '' と同じ枠
  for (let i = 0; i < MAX_PER_MESSAGE; i++) admit(undefined);
  assert.equal(admit('').ok, false);
});
