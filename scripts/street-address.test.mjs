// 番地・建物名の判定を機械検算する（2026-09-27たきと指摘「番地まで表示されてない…求人フローで
// 番地まで入力するのを義務にしていないのか？」）。
// 入力の義務はフロント（この判定）とDB（trg_job_publish_snapshot・migration 20260927133421）の
// 二重の壁。★ここの文字の集合とDBの regexp の文字の集合は同じ。片方だけ変えないこと。
// UIは持ち込まない＝model.js だけを読む（React/DOM/Supabase 非依存の層）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidStreetAddress, STREET_ADDRESS_STRIP } from '../src/features/jobs/create/model.js';

test('住所として読めないものだけを弾く（0・記号・語だけ）', () => {
  // 実際に公開されてしまった値（#1313）
  assert.equal(isValidStreetAddress('00'), false);
  assert.equal(isValidStreetAddress('0'), false);
  assert.equal(isValidStreetAddress('０'), false);       // 全角のゼロ
  assert.equal(isValidStreetAddress('０００'), false);
  assert.equal(isValidStreetAddress('-'), false);
  assert.equal(isValidStreetAddress('ー'), false);       // 長音（ハイフンの打ち間違い）
  assert.equal(isValidStreetAddress('番地'), false);
  assert.equal(isValidStreetAddress(' 0 - 0 '), false);
  assert.equal(isValidStreetAddress('、、'), false);
});

test('正当な番地は止めない', () => {
  assert.equal(isValidStreetAddress('37-2'), true);
  assert.equal(isValidStreetAddress('1166-1'), true);
  assert.equal(isValidStreetAddress('1-2-3 〇〇ハイツ101'), true);
  assert.equal(isValidStreetAddress('100'), true);       // 1が残る
  assert.equal(isValidStreetAddress('10'), true);
  assert.equal(isValidStreetAddress('甲10'), true);
  assert.equal(isValidStreetAddress('西1'), true);
  assert.equal(isValidStreetAddress('字上野 5番地'), true);
});

test('空・未入力・壊れた入力で落ちない', () => {
  assert.equal(isValidStreetAddress(''), false);
  assert.equal(isValidStreetAddress('   '), false);
  assert.equal(isValidStreetAddress(null), false);
  assert.equal(isValidStreetAddress(undefined), false);
  assert.equal(isValidStreetAddress(123), true);         // 数値でも文字にして判定する
});

test('取り除く文字の集合がDB側（migration 20260927133421）と同じ', () => {
  // DBの regexp: [0０\s　ー\-－‐番地号の、,.]
  const chars = ['0', '０', ' ', '　', 'ー', '-', '－', '‐',
                 '番', '地', '号', 'の', '、', ',', '.'];
  for (const c of chars) {
    assert.equal(c.replace(STREET_ADDRESS_STRIP, ''), '', `取り除かれない文字: ${JSON.stringify(c)}`);
  }
  // 逆に、住所になりうる文字は残る
  for (const c of ['1', '9', '甲', 'あ', 'A', '１']) {
    assert.equal(c.replace(STREET_ADDRESS_STRIP, ''), c, `取り除いてはいけない文字: ${c}`);
  }
});
