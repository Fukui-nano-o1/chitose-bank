import { sameProfileValue } from '../../lib/profileRecord.js';

const error = (code, message) => Object.assign(new Error(message), { code });
export const consignmentPendingKey = (owner, id) => `cb_consignmentSave_v1:${owner}:${id || 'new'}`;
export const consignmentBase = row => row ? Object.fromEntries(['spec', 'status', 'notes', 'updated_at'].map(k => [k, row[k]])) : null;
const termsKeys = ['cmn_pay_due', 'cmn_fee_bearer', 'cmn_inspect', 'cmn_cancel'];
const cleanTerms = terms => Object.fromEntries(termsKeys.filter(k => String(terms?.[k] || '').trim()).map(k => [k, String(terms[k]).trim()]));
export async function consignmentOwner(client, expected) {
  const { data, error: failed } = await client.auth.getSession();
  const id = data?.session?.user?.id;
  if (failed || !id || (expected && expected !== id)) throw error('CONSIGNMENT_SESSION', 'ログイン中のアカウントを確認できません。入力を控えてからページを開き直してください。');
  return id;
}
export function readConsignmentPending(storage, owner, id) {
  try {
    const raw = storage.getItem(consignmentPendingKey(owner, id));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p.p_owner !== owner || !p.p_request_id || !p.p_deal_id || !p.p_patch?.spec || !p.p_terms || (id && p.p_deal_id !== id)) throw Error('Invalid operation');
    return p;
  } catch { throw error('CONSIGNMENT_STORAGE', '前回の保存操作を読み込めません。端末の保存領域を確認してください。新しい保存は開始していません。'); }
}
// 送信内容と比較元を先に保持。応答不明時は同じ操作を再送し、確定済みなら台帳の結果だけを受け取る。
export async function saveConsignmentRecord(client, { owner, row, patch, fields, terms }, { storage = localStorage, uuid = () => crypto.randomUUID() } = {}) {
  if (!owner || (row && !row.updated_at)) throw error('CONSIGNMENT_READ', '保存済みの案件を読み込んでから保存してください。');
  await consignmentOwner(client, owner);
  const key = consignmentPendingKey(owner, row?.id);
  let request = readConsignmentPending(storage, owner, row?.id);
  const desiredTerms = cleanTerms(terms);
  if (!request) {
    const name = String(patch.spec.field_name || '').trim();
    const field = (fields || []).find(f => f.auth_id === owner && f.name === name);
    request = { p_owner: owner, p_request_id: uuid(), p_deal_id: row?.id || uuid(),
      p_expected: consignmentBase(row), p_patch: patch, p_expected_field: field ? { area_a: field.area_a } : null, p_terms: desiredTerms };
    try {
      const raw = JSON.stringify(request); storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('Storage not confirmed');
    } catch { throw error('CONSIGNMENT_STORAGE', '保存操作を端末に保持できません。入力は残しています。端末の保存領域を確認してください。'); }
  }
  let result;
  try { result = await client.rpc('save_my_consignment_bundle', request); } catch { /* 結果不明。操作を消さない。 */ }
  await consignmentOwner(client, owner);
  const data = result?.data;
  if (result?.error || !data || typeof data.ok !== 'boolean') throw error('CONSIGNMENT_UNCONFIRMED', '保存結果を確認できません。入力と保存操作を残しています。同じ保存ボタンで結果を確認できます。');
  if (!data.ok) {
    // サーバーの明確な拒否では関連する更新も全て取り消されている。
    try { storage.removeItem(key); } catch { /* 同じ操作の再試行でも変更は起きない */ }
    const conflict = ['conflict', 'field_conflict', 'terms_conflict', 'not_found'].includes(data.reason);
    throw error(conflict ? 'CONSIGNMENT_CONFLICT' : 'CONSIGNMENT_SAVE', conflict
      ? '別の画面で案件・圃場・標準条件が変更されています。入力は残しています。内容を控えて最新情報と照合してください。'
      : '保存できませんでした。案件・圃場・標準条件はまとめて取り消されています。入力を確認して再試行してください。');
  }
  if (data.request_id !== request.p_request_id || data.owner !== owner || data.row?.id !== request.p_deal_id
    || !sameProfileValue(data.row.spec, request.p_patch.spec) || data.row.status !== request.p_patch.status || data.row.notes !== request.p_patch.notes) {
    throw error('CONSIGNMENT_UNCONFIRMED', '保存結果と送信内容を照合できません。入力と保存操作を残しています。');
  }
  try { storage.removeItem(key); if (storage.getItem(key)) throw Error('Still pending'); }
  catch { throw error('CONSIGNMENT_UNCONFIRMED', '保存は確認できましたが、端末の保存操作を片付けられません。保存ボタンで再確認してください。'); }
  return { ...data, changed: !sameProfileValue(request.p_patch, patch) || !sameProfileValue(request.p_terms, desiredTerms) };
}
