// A retry reuses the original UUID. A lost HTTP response must not send a second message.
export const CHAT_TIMEOUT_MS = 15000;
export function chatDeadline(request) {
  let timer;
  return Promise.race([Promise.resolve(request), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('CHAT_TIMEOUT'), { code: 'CHAT_TIMEOUT' })), CHAT_TIMEOUT_MS);
  })]).finally(() => clearTimeout(timer));
}
export async function sendChatMessage(client, table, row) {
  const result = await chatDeadline(client.from(table).insert(row).select().single());
  if (!result.error && result.data) return result.data;
  if (result.error?.code === '23505') {
    const found = await chatDeadline(client.from(table).select('*').eq('id', row.id).maybeSingle());
    if (!found.error && found.data && Object.entries(row).every(([key, value]) => found.data[key] === value)) return found.data;
  }
  throw result.error || new Error('CHAT_RESULT_UNKNOWN');
}
export const CHAT_CLOSED = ['rejected', 'expired', 'canceled', 'completed'];
const format = (value, options) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', ...options });
};
export const chatDay = value => format(value, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
export const chatTime = value => format(value, { hour: '2-digit', minute: '2-digit' });
export const chatInboxTime = value => format(value, { month: 'numeric', day: 'numeric' });
export function mergeChatPreviews(previous, messages) {
  const next = { ...previous };
  for (const message of messages) {
    const old = next[message.application_id];
    if (!old || Date.parse(message.created_at) > Date.parse(old.created_at)
      || (message.created_at === old.created_at && message.id > old.id)) next[message.application_id] = message;
  }
  return next;
}
