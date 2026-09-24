import { supabase } from './supabase';

const PREFIX = 'cb_support_v1:';
const DRAFT_AGE = 7 * 24 * 60 * 60 * 1000;
const memory = new Map();
export const SUPPORT_TIMEOUT_MS = 15000;

function read(key) {
  if (memory.has(key)) return memory.get(key);
  try { const value = localStorage.getItem(PREFIX + key); if (value != null) return JSON.parse(value); } catch { /* memory remains usable */ }
  return memory.get(key) || null;
}
function write(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(key) { memory.delete(key); try { localStorage.removeItem(PREFIX + key); } catch { /* optional storage */ } }
export const supportScope = userId => userId ? `user:${userId}` : 'guest';
export function supportId() { return crypto.randomUUID(); }
export function guestSupportToken() {
  const previous = read('guest-access');
  if (typeof previous === 'string' && /^[a-f0-9]{64}$/.test(previous)) return previous;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
  write('guest-access', token);
  return token;
}
export function supportStorageAvailable() {
  try { localStorage.setItem(PREFIX + 'probe', '1'); localStorage.removeItem(PREFIX + 'probe'); return true; } catch { return false; }
}
export function readSupportDraft(userId) {
  const key = `draft:${supportScope(userId)}`;
  const draft = read(key);
  if (!draft || Date.now() - Number(draft.savedAt) > DRAFT_AGE) { remove(key); return null; }
  return draft;
}
export function saveSupportDraft(userId, draft) {
  const key = `draft:${supportScope(userId)}`;
  const previous = read(key);
  const comparable = value => { const copy = { ...value }; delete copy.savedAt; return JSON.stringify(copy); };
  if (previous && comparable(previous) === comparable(draft)) return true;
  return write(key, { ...draft, savedAt: Date.now() });
}
export function clearSupportDraft(userId) { remove(`draft:${supportScope(userId)}`); }
export function forgetGuestSupport() {
  remove('guest-access'); remove('draft:guest'); remove('last:guest');
  const keys = new Set([...memory.keys()].filter(key => key.startsWith('reply:guest:')));
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(PREFIX + 'reply:guest:')) keys.add(key.slice(PREFIX.length)); } } catch { /* memory-only browser */ }
  for (const key of keys) remove(key);
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== PREFIX + 'guest-access' && event.key !== null) return;
  for (const key of [...memory.keys()]) if (key === 'guest-access' || key === 'last:guest' || key === 'draft:guest' || key.startsWith('reply:guest:')) memory.delete(key);
  window.dispatchEvent(new CustomEvent('cb:support-access-cleared'));
});
export function lastSupportReceipt(userId) { return read(`last:${supportScope(userId)}`); }

// Guest support must remain usable even if Supabase Auth's session lock is stuck.
// One-shot requests have a deadline; retry identity is supplied by the caller.
async function call(name, args, userId) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('SUPPORT_TIMEOUT')); }, SUPPORT_TIMEOUT_MS); });
  try {
    const request = userId ? Promise.resolve(supabase.rpc(name, args).abortSignal(controller.signal)).then(result => {
      if (result.error) throw Object.assign(new Error(result.error.message || 'SUPPORT_FAILED'), { code: result.error.code });
      return result.data;
    }) : (async () => {
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST', signal: controller.signal,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.message || 'SUPPORT_FAILED'), { code: result.code });
      return result;
    })();
    const result = await Promise.race([request, deadline]);
    if (result?.ok === false) throw new Error(result.reason || 'SUPPORT_FAILED');
    return result;
  } finally { clearTimeout(timer); }
}

export function prepareSupportRequest(draft, context) {
  if (draft.pending) return draft.pending;
  return {
    p_id: draft.id || supportId(), p_guest_token: guestSupportToken(),
    p_category: draft.category || 'confusing', p_topic: draft.topic || 'other', p_impact: draft.impact || 'difficult',
    p_body: draft.body.trim(), p_expected: (draft.expected || '').trim(),
    p_page_hash: context.page_hash || '#/other',
    p_diagnostics: draft.includeDiagnostics ? context : {},
  };
}
export async function submitSupport(payload, userId) {
  const result = await call('support_create', payload, userId);
  const report = result.report || result;
  if (report.id !== payload.p_id) throw new Error('SUPPORT_UNCONFIRMED');
  // A late response must not restore guest access after the user clears this device.
  if (userId || read('guest-access') === payload.p_guest_token) {
    write(`last:${supportScope(userId)}`, { id: report.id, created_at: report.created_at });
    const draft = readSupportDraft(userId);
    if (draft?.id === payload.p_id) clearSupportDraft(userId);
  }
  return report;
}
export async function listSupport(userId) {
  const result = await call('support_list', { p_guest_token: guestSupportToken() }, userId);
  const rows = result.items || result;
  if (!Array.isArray(rows)) throw new Error('SUPPORT_UNCONFIRMED');
  return rows;
}
export async function getSupport(id, userId) {
  const result = await call('support_detail', { p_id: id, p_guest_token: guestSupportToken() }, userId);
  if (!result?.report?.id) throw new Error('SUPPORT_NOT_FOUND');
  return result;
}
export async function replySupport(id, message, messageId, reopen, userId) {
  const result = await call('support_reply', { p_id: id, p_guest_token: guestSupportToken(), p_message_id: messageId, p_body: message, p_reopen: reopen }, userId);
  if (result?.report?.id !== id || !result.messages?.some(item => item.id === messageId && item.author_role === 'user')) throw new Error('SUPPORT_UNCONFIRMED');
  return result;
}
export async function getAdminSupport(id) {
  return call('support_detail', { p_id: id, p_guest_token: null }, true);
}
export async function updateAdminSupport(payload) {
  return call('admin_support_update', payload, true);
}
export function readSupportReply(userId, id) {
  const key = `reply:${supportScope(userId)}:${id}`;
  const value = read(key);
  if (!value || Date.now() - Number(value.savedAt) >= DRAFT_AGE) { remove(key); return null; }
  return value;
}
export function saveSupportReply(userId, id, value) { write(`reply:${supportScope(userId)}:${id}`, { ...value, savedAt: Date.now() }); }
export function clearSupportReply(userId, id) { remove(`reply:${supportScope(userId)}:${id}`); }
export function supportErrorMessage(error) {
  const code = String(error?.message || '');
  if (/RATE|LIMIT/i.test(code)) return '短時間に送信が集中しています。入力は残しています。少し時間をおいて、もう一度お試しください。';
  if (/AUTH|JWT|session/i.test(code)) return 'ログイン状態を確認できません。入力は残しています。元の画面でログイン状態を確認してください。';
  if (/NOT_FOUND|FORBIDDEN/i.test(code)) return 'この相談を確認できません。相談したアカウント、または同じ端末・ブラウザで開いてください。';
  return '通信が完了したか確認できません。入力は残しています。同じ内容で再送しても、重複して登録されません。';
}
