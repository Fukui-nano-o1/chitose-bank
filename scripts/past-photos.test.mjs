// step7「過去に掲載した写真から選ぶ」の純粋関数（束の組み方・重複・追加済み・上限）を機械検算する。
// UIは持ち込まない＝model.js だけを読む（React/DOM/Supabase 非依存の層）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pastPhotoGroups, mergePastPhotos } from '../src/features/jobs/create/model.js';

const row = (job_number, photos, extra = {}) => ({ job_number, crop: 'ネギ', task: '収穫', photos, date_start: '2026-08-18', created_at: '2026-08-10T01:00:00Z', ...extra });

test('pastPhotoGroups：求人ごとの束・新しい順のまま・写真の無い求人は出さない', () => {
  const groups = pastPhotoGroups([
    row(1300, [{ url: 'a', thumb: 'ta', caption: '畑' }, { url: 'b' }]),
    row(1299, []),
    row(1298, ['c'], { crop: 'ナス', task: '', date_start: null, created_at: '2026-07-01T09:00:00Z' }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(g => g.jobNumber), [1300, 1298]);
  assert.equal(groups[0].title, 'ネギ 収穫');
  assert.equal(groups[0].date, '2026-08-18');
  assert.deepEqual(groups[0].photos, [
    { url: 'a', thumb: 'ta', caption: '畑', inUse: false },
    { url: 'b', thumb: null, caption: '', inUse: false },
  ]);
  // 旧形式（文字列）も束になる・日程が無ければ作成日
  assert.equal(groups[1].title, 'ナス');
  assert.equal(groups[1].date, '2026-07-01');
  assert.equal(groups[1].photos[0].url, 'c');
});

test('pastPhotoGroups：編集中の求人は外す・同じ url は最初の束だけ・手元にある写真は inUse', () => {
  const groups = pastPhotoGroups([
    row(1300, [{ url: 'a' }, { url: 'b' }]),
    row(1290, [{ url: 'a' }, { url: 'z' }]), // コピーで作った求人＝a が重複
    row(1280, [{ url: 'x' }]),
  ], { excludeJobNumber: 1280, currentPhotos: [{ url: 'b' }] });
  assert.deepEqual(groups.map(g => g.jobNumber), [1300, 1290]);
  assert.deepEqual(groups[0].photos.map(p => [p.url, p.inUse]), [['a', false], ['b', true]]);
  assert.deepEqual(groups[1].photos.map(p => p.url), ['z']);
});

test('pastPhotoGroups：壊れた入力で落ちない', () => {
  assert.deepEqual(pastPhotoGroups(null), []);
  assert.deepEqual(pastPhotoGroups([null, {}, { job_number: 1, photos: 'bad' }, row(2, [{ nope: 1 }, ''])]), []);
});

test('mergePastPhotos：uploadPhoto と同じ形で足す・重複は足さない・説明は引き継ぐ', () => {
  const current = [{ url: 'a', caption: '' }];
  const out = mergePastPhotos(current, [{ url: 'a', inUse: true }, { url: 'b', thumb: 'tb', caption: '収穫の様子', inUse: false }, { url: 'c', thumb: null }]);
  assert.deepEqual(out, [
    { url: 'a', caption: '' },
    { url: 'b', thumb: 'tb', caption: '収穫の様子' },
    { url: 'c', caption: '' },
  ]);
  assert.notEqual(out, current); // 足したら新しい配列
});

test('mergePastPhotos：上限10枚を越えたぶんは捨てる・足すものが無ければ元の配列をそのまま返す', () => {
  const current = Array.from({ length: 9 }, (_, i) => ({ url: `p${i}`, caption: '' }));
  const out = mergePastPhotos(current, [{ url: 'x' }, { url: 'y' }]);
  assert.equal(out.length, 10);
  assert.equal(out[9].url, 'x');
  assert.equal(mergePastPhotos(current, [{ url: 'p0' }]), current);
  assert.equal(mergePastPhotos(current, null), current);
});
