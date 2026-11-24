import { inputError as error } from './inputRecovery.js';
const TABLES = new Set(['worker_profiles', 'employer_profiles', 'consignment_profiles', 'emergency_contacts']);

const stable = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(stable(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))]))
  : value ?? null);
export const sameProfileValue = (a, b) => stable(a) === stable(b);
const sameField = (key, a, b) => a == null && (b === '' || (Array.isArray(b) && b.length === 0))
  ? true : key.endsWith('_at') && a && b && Number.isFinite(Date.parse(a)) && Number.isFinite(Date.parse(b))
    ? Date.parse(a) === Date.parse(b) : sameProfileValue(a, b);

async function sessionOwner(client, expected) {
  const { data, error: failed } = await client.auth.getSession();
  const id = data?.session?.user?.id;
  if (failed || !id || (expected && id !== expected)) throw error('PROFILE_SESSION', 'ログインが確認できません。ページを開き直してください。');
  return id;
}
export async function readProfileRecord(client, table, expectedUserId) {
  if (!TABLES.has(table)) throw error('PROFILE_TARGET', '保存先を確認できません。');
  const userId = await sessionOwner(client, expectedUserId);
  const { data, error: failed } = await client.from(table).select('*').eq('auth_id', userId).maybeSingle();
  if (failed) throw error('PROFILE_READ', '保存済みの情報を読み込めませんでした。通信を確認して、もう一度読み込んでください。');
  await sessionOwner(client, userId);
  return { status: 'ready', table, userId, row: data };
}

// Expected values travel in the POST body. The invoker RPC compares and writes
// atomically under the existing RLS, including exact JSON/array equality.
const outcome = (code, message, saveReason) => Object.assign(error(code, message), { saveReason });
const conflictMessage = '別の画面でこの項目が変更されています。入力は残しています。最新の内容を確認してから変更してください。';
const unconfirmedMessage = '保存結果を確認できませんでした。入力は残しています。通信が戻ってから保存済みの内容を確認してください。';

export async function saveProfileRecord(client, record, patch, { guard = Object.keys(patch), confirmed = patch, verify, onCompareRefused } = {}) {
  if (record?.status !== 'ready' || !TABLES.has(record.table)) throw error('PROFILE_NOT_LOADED', '保存済みの情報を読み込んでから保存してください。');
  const keys = Object.keys(patch);
  if ((keys.length && !guard.length) || !Object.keys(confirmed).length || guard.some(k => !/^[a-z][a-z0-9_]*$/.test(k)) || keys.some(k => !/^[a-z][a-z0-9_]*$/.test(k) || ['auth_id', 'id', 'created_at', 'updated_at'].includes(k))) {
    throw error('PROFILE_FIELDS', '保存する項目を確認できません。');
  }
  await sessionOwner(client, record.userId);
  if (!keys.length) {
    const current = await readProfileRecord(client, record.table, record.userId);
    if (current.userId !== record.userId || (verify && !verify(current.row)) || !Object.entries(confirmed).every(([k, v]) => sameField(k, current.row?.[k] ?? (typeof v === 'string' ? '' : Array.isArray(v) ? [] : null), v))) {
      throw outcome('PROFILE_CONFLICT', '別の画面でこの項目が変更されています。最新の内容を確認してください。', 'READ_MISMATCH');
    }
    return current;
  }
  let data, failed, acknowledged = false, compareRefused = false, transportUncertain = false;
  try {
    const result = await client.rpc('save_my_profile_fields', {
      p_owner: record.userId,
      p_table: record.table,
      p_expected: record.row ? Object.fromEntries([...new Set([...guard, ...keys])].map(k => [k, record.row[k] ?? null])) : null,
      p_patch: patch,
    });
    data = result.data?.ok ? result.data.row : null;
    acknowledged = !result.error && result.data?.ok === true;
    compareRefused = !result.error && result.data?.ok === false && result.data.reason === 'conflict';
    transportUncertain = [0,502,503,504].includes(result.status);
    failed = result.error || (result.data?.reason && result.data.reason !== 'conflict' ? { message: result.data.reason } : null);
  } catch (e) { failed = e; transportUncertain = true; }
  const matches = row => row && (!verify || verify(row)) && Object.entries(confirmed).every(([k, v]) => sameField(k, row[k], v));
  if (!failed && matches(data)) {
    await sessionOwner(client, record.userId);
    return { ...record, row: data };
  }
  let current;
  try {
    current = await readProfileRecord(client, record.table, record.userId);
    if (current.userId !== record.userId) throw error('PROFILE_SESSION', 'ログイン中のアカウントが変わりました。');
  } catch {
    throw error('PROFILE_UNCONFIRMED', unconfirmedMessage);
  }
  if (matches(current.row)) return current;
  if (verify && transportUncertain) throw outcome('PROFILE_UNCONFIRMED', unconfirmedMessage, 'TRANSPORT_UNCERTAIN');
  if (compareRefused && onCompareRefused) {
    const retry = onCompareRefused(current, true);
    if (retry) {
      // Only this explicit server refusal is known not to have written. The
      // second request is independently guarded and cannot retry itself.
      return saveProfileRecord(client, current, retry.patch, {
        ...retry.options, onCompareRefused: latest => { onCompareRefused(latest, false); return null; },
      });
    }
  }
  if (!failed || failed.code === '23505' || guard.some(k => !sameProfileValue(current.row?.[k], record.row?.[k]))) {
    throw outcome('PROFILE_CONFLICT', conflictMessage,
      compareRefused ? 'COMPARE_REFUSED' : acknowledged ? 'ACK_MISMATCH' : failed?.code === '23505' ? 'DUPLICATE_UNVERIFIED' : 'OUTCOME_MISMATCH');
  }
  throw error('PROFILE_SAVE', '保存に失敗しました。入力は残しています。' + (failed?.message ? '\n' + failed.message : ''));
}
