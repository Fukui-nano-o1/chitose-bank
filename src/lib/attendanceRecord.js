import { inputError as fail } from './inputRecovery.js';
import { createOperationStore } from './operationStore.js';
import { ATTENDANCE_DENIAL_MESSAGES } from './authorization.js';

export const attendanceStore = () => createOperationStore('cb_attendance_requests_v1');
export const attendanceInput = input => ({ application_id: input.application_id, kind: input.kind,
  reason: input.reason || null, work_date: input.work_date || null, detail: input.detail || null });
const equal = (a, b) => Object.keys(a).every(k => a[k] === b[k]);
export const attendanceKey = (owner, applicationId, day, mode) => `${owner}:${applicationId}:${mode}:${day || ''}`;
async function checkOwner(client, owner) {
  const { data, error } = await client.auth.getSession();
  if (error || !owner || data?.session?.user?.id !== owner) throw fail('ATTENDANCE_SESSION', 'ログイン中のアカウントを確認できません。画面を開き直してください。');
}
const valid = (intent, owner, input) => intent?.owner === owner && !!intent.requestId && intent.input?.application_id === input.application_id && intent.input?.work_date === input.work_date;
export async function readAttendancePending(client, owner, applicationId, day, mode, store = attendanceStore()) {
  await checkOwner(client, owner);
  let pending;
  try {
    pending = await store.read(attendanceKey(owner, applicationId, day, mode));
    if (pending && !valid(pending, owner, { application_id: applicationId, work_date: day || null })) throw Error('Invalid pending report');
  } catch { throw fail('ATTENDANCE_STORAGE', '前回の送信記録を読み込めません。もう一度読み込んでください。'); }
  await checkOwner(client, owner);
  return pending;
}
export async function recordAttendance(client, owner, input, mode, { store = attendanceStore(), uuid = () => crypto.randomUUID() } = {}) {
  await checkOwner(client, owner);
  const desired = attendanceInput(input), key = attendanceKey(owner, desired.application_id, desired.work_date, mode);
  let intent;
  try {
    intent = await store.acquire(key, { owner, requestId: uuid(), input: desired });
    if (!valid(intent, owner, desired)) throw Error('Invalid pending report');
  } catch { throw fail('ATTENDANCE_STORAGE', '送信記録を端末に保持できません。送信は開始していません。端末の保存領域を確認してください。'); }
  await checkOwner(client, owner);
  let result;
  try { result = await client.rpc('record_my_attendance_once', { p_owner: owner, p_event_id: intent.requestId, p_input: intent.input }); }
  catch { /* Keep the operation and its exact original input for retry. */ }
  await checkOwner(client, owner);
  const data = result?.data;
  if (result?.error || !data || typeof data.ok !== 'boolean') throw fail('ATTENDANCE_UNCONFIRMED', '送信結果を確認できません。同じ画面で再送すると前回の結果を確認します。');
  if (!data.ok) {
    try { await store.clear(key, intent.requestId); } catch { /* A replay of this rejected operation remains safe. */ }
    throw fail('ATTENDANCE_REJECTED', ATTENDANCE_DENIAL_MESSAGES[data.reason] || '記録を保存できませんでした。入力を控え、対象の仕事と日付を確認してください。続く場合は「ヘルプ・お問い合わせ」へご連絡ください。', data.reason);
  }
  if (data.row?.id !== intent.requestId || data.row?.actor_id !== owner || !equal(intent.input, attendanceInput(data.row))) {
    throw fail('ATTENDANCE_UNCONFIRMED', '送信した内容と保存結果を照合できません。再送して確認してください。');
  }
  return { row: data.row, changed: !equal(desired, intent.input), acknowledge: async () => {
    try { await store.clear(key, intent.requestId); }
    catch { throw fail('ATTENDANCE_ACK', '記録は保存済みですが、端末の確認記録を片付けられません。次の送信は同じ記録を確認します。'); }
  } };
}
