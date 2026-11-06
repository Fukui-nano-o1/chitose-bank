// Display adapter only. Keep stored bodies, message IDs, read markers and report payloads intact.
// Legacy automatic replies used the farmer's identity, without a system-message discriminator.
// Only the exact historical template, farmer sender and application transaction timestamp qualify.
const legacyApprovalBodies = new Set([
  '🌟リピート即決の設定により、応募を自動で承認しました。チャットで打ち合わせを進めましょう。',
  '🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。',
]);
const timestamp = value => {
  // PostgreSQL UTC serializations can differ in trailing fractional zeroes. Do not round to
  // milliseconds: a later human message in the same millisecond must remain untouched.
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00(?::?00)?)$/);
  return match ? match[1].replace(' ', 'T') + '.' + (match[2] || '').padEnd(6, '0') : null;
};
export function historicalMessageText(message, application, { pending = false } = {}) {
  const body = message?.body || '';
  if (!legacyApprovalBodies.has(body)) return body;
  // Prevent a cold-cache flash while the independently loaded application context arrives.
  if (!application) return pending ? 'メッセージを確認しています…' : body;
  const created = timestamp(application.created_at);
  if (message.application_id !== application.id || !application.farmer_id
    || message.sender_id !== application.farmer_id || !created || timestamp(message.created_at) !== created) return body;
  return '応募が承認されました（採用ではありません）。チャットで打ち合わせを進めましょう。';
}
