// 住所の実在チェック（町域まで）を機械検算する（2026-09-27たきと指示「ヒットしない住所はエラーにしよう」）。
// 判定は townMatchesFeatures（純粋関数）。通信は verifyTownAddress が担当＝ここでは fetch を差し替えて確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { townMatchesFeatures, verifyTownAddress } from '../src/features/jobs/create/jobCreateGeo.js';

const F = (...titles) => titles.map(title => ({ properties: { title }, geometry: { coordinates: [134.3, 34.0] } }));

test('町域が見つかる', () => {
  assert.equal(townMatchesFeatures(F('徳島県吉野川市山川町前川'), '徳島県', '吉野川市', '山川町前川'), true);
  // 結果の方が詳しい（丁目つき）
  assert.equal(townMatchesFeatures(F('徳島県徳島市南末広町一丁目'), '徳島県', '徳島市', '南末広町'), true);
  // 入力の方が詳しい（字を足した）
  assert.equal(townMatchesFeatures(F('徳島県吉野川市山川町前川'), '徳島県', '吉野川市', '山川町前川字東'), true);
  // 「大字」「字」・全角空白の表記ゆれ
  assert.equal(townMatchesFeatures(F('徳島県吉野川市鴨島町大字鴨島'), '徳島県', '吉野川市', '鴨島町 鴨島'), true);
});

test('見つからない住所は false', () => {
  // 市区町村だけしか返らない
  assert.equal(townMatchesFeatures(F('徳島県吉野川市'), '徳島県', '吉野川市', 'ほげほげ町'), false);
  // 別の町域だけ返る
  assert.equal(townMatchesFeatures(F('徳島県吉野川市鴨島町鴨島'), '徳島県', '吉野川市', '山川町前川'), false);
  // 別の市の同名の町域（都道府県＋市区町村が一致しない）
  assert.equal(townMatchesFeatures(F('徳島県阿波市山川町前川'), '徳島県', '吉野川市', '山川町前川'), false);
  // 結果が空
  assert.equal(townMatchesFeatures([], '徳島県', '吉野川市', '山川町前川'), false);
  // 町域が空
  assert.equal(townMatchesFeatures(F('徳島県吉野川市山川町前川'), '徳島県', '吉野川市', ''), false);
  // 壊れた結果で落ちない
  assert.equal(townMatchesFeatures([null, {}, { properties: {} }], '徳島県', '吉野川市', '山川町前川'), false);
});

test('通信の結果を ok / notfound / error に分ける（error は止めない側）', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => F('徳島県吉野川市山川町前川') });
    assert.equal(await verifyTownAddress('徳島県', '吉野川市', '山川町前川'), 'ok');
    globalThis.fetch = async () => ({ ok: true, json: async () => F('徳島県吉野川市') });
    assert.equal(await verifyTownAddress('徳島県', '吉野川市', 'ほげほげ町'), 'notfound');
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    assert.equal(await verifyTownAddress('徳島県', '吉野川市', '通信失敗町'), 'error');
    globalThis.fetch = async () => ({ ok: false, json: async () => [] });
    assert.equal(await verifyTownAddress('徳島県', '吉野川市', '五〇三町'), 'error');
    // error は覚えない＝次は再試行して結果が出る
    globalThis.fetch = async () => ({ ok: true, json: async () => F('徳島県吉野川市通信失敗町') });
    assert.equal(await verifyTownAddress('徳島県', '吉野川市', '通信失敗町'), 'ok');
  } finally {
    globalThis.fetch = real;
  }
});
