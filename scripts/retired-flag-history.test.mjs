import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalMessageText } from '../src/features/chat/presentation/historyMessage.js';
const body = '🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。';
const application = { id: 'application', farmer_id: 'farmer', created_at: '2026-08-19T01:02:03.123456+00:00' };
const message = { id: 'message', application_id: application.id, sender_id: application.farmer_id, created_at: application.created_at, body, read_at: null };
test('legacy automatic reply is neutral only at its exact application transaction, without altering history', () => {
  const before = JSON.stringify({ message, application });
  assert.equal(historicalMessageText(message, application), '応募が承認されました（採用ではありません）。チャットで打ち合わせを進めましょう。');
  assert.equal(JSON.stringify({ message, application }), before);
});
test('human messages, other senders, applications and even one microsecond later are preserved', () => {
  for (const change of [{ body: body + '補足' }, { body: 'リピート即決とは何ですか？' }, { sender_id: 'worker' }, { application_id: 'other' }, { created_at: '2026-08-19T01:02:03.123457+00:00' }, { created_at: null }]) {
    const row = { ...message, ...change };
    assert.equal(historicalMessageText(row, application), row.body);
  }
  assert.equal(historicalMessageText(message, { ...application, farmer_id: null }), body);
  assert.equal(historicalMessageText(message, null), body);
});
test('UTC timestamp representation is normalized without losing microseconds', () => {
  assert.doesNotMatch(historicalMessageText({ ...message, created_at: '2026-08-19T01:02:03.120Z' }, { ...application, created_at: '2026-08-19 01:02:03.12+00' }), /リピート/);
});
test('cold-cache pending candidate does not flash retired copy; unrelated messages appear immediately', () => {
  assert.equal(historicalMessageText(message, null, { pending: true }), 'メッセージを確認しています…');
  assert.equal(historicalMessageText({ ...message, body: '明日はよろしくお願いします。' }, null, { pending: true }), '明日はよろしくお願いします。');
});
