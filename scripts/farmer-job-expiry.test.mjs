import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFarmerJobs } from '../src/lib/farmerJobLists.js';

const end = Date.parse('2026-09-22T17:00:00+09:00');
const job = (number, overrides = {}) => ({
  job_number: number, status: 'open', opened_at: '2026-09-20T10:00:00+09:00',
  date_start: '2026-09-22', date_end: '2026-09-22', work_time: '08:00〜17:00',
  ...overrides,
});
const numbers = list => list.map(row => row.job_number);

test('a cached active listing moves into history at its deadline without replacing its fetched rows', () => {
  const rows = [job(1), job(2, { date_end: '2026-09-23' })];
  const snapshot = structuredClone(rows);
  const before = classifyFarmerJobs(rows, end - 1);
  assert.deepEqual(numbers(before.active), [1, 2]);
  assert.deepEqual(before.expired, []);

  const after = classifyFarmerJobs(rows, end);
  assert.deepEqual(numbers(after.active), [2]);
  assert.deepEqual(numbers(after.expired), [1]);
  assert.equal(after.expired[0], rows[0]);
  assert.deepEqual(rows, snapshot, 'expiry must not overwrite the job or its history');

  // 復元時にも取得当時の分類を信じない。新しい通信結果がなくても過去の求人は掲載中に戻らない。
  const restored = classifyFarmerJobs([...before.drafts, ...before.active, ...before.expired], end + 1);
  assert.deepEqual(numbers(restored.active), [2]);
  assert.deepEqual(numbers(restored.expired), [1]);
});

test('unfinished unpublished drafts stay resumable after their date while pending published jobs expire', () => {
  const rows = [job(1, { status: 'draft', opened_at: null }), job(2, { status: 'pending' })];
  assert.deepEqual(numbers(classifyFarmerJobs(rows, end - 1).drafts), [1, 2]);
  const after = classifyFarmerJobs(rows, end);
  assert.deepEqual(numbers(after.drafts), [1]);
  assert.deepEqual(numbers(after.expired), [2]);
  assert.deepEqual(after.active, []);
});

test('temporarily unpublished jobs retain their category before expiry and their history afterwards', () => {
  const rows = [job(1, { status: 'draft' })];
  assert.deepEqual(numbers(classifyFarmerJobs(rows, end - 1).active), [1]);
  const after = classifyFarmerJobs(rows, end);
  assert.deepEqual(after.active, []);
  assert.deepEqual(after.drafts, []);
  assert.deepEqual(numbers(after.expired), [1]);
});

test('closed jobs remain in history even when their work date is still in the future', () => {
  const rows = [job(1, { status: 'closed', date_end: '2026-09-30' })];
  const lists = classifyFarmerJobs(rows, end);
  assert.deepEqual(lists.active, []);
  assert.deepEqual(numbers(lists.expired), [1]);
});

test('overlapping cached categories show each job once and honor the latest saved state', () => {
  const oldRow = job(1, { updated_at: '2026-09-20T09:00:00Z' });
  const newRow = job('1', { status: 'closed', updated_at: '2026-09-21T09:00:00Z' });
  const rows = [oldRow, newRow, oldRow];
  const lists = classifyFarmerJobs(rows, end - 1);
  assert.deepEqual(lists.active, []);
  assert.equal(lists.expired.length, 1);
  assert.equal(lists.expired[0], newRow);
});
