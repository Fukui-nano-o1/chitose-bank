import { inputError as fail } from './inputRecovery.js';

const revisions = new Map();
export const savedJobRevision = owner => revisions.get(owner) || 0;
async function checkOwner(client, owner) {
  const { data, error } = await client.auth.getSession();
  if (error || !owner || data?.session?.user?.id !== owner) throw fail('SAVED_JOB_SESSION', 'ログイン中のアカウントを確認できません。画面を開き直してください。');
}
export async function setSavedJob(client, owner, jobNumber, liked) {
  if (!Number.isSafeInteger(Number(jobNumber)) || Number(jobNumber) < 1 || typeof liked !== 'boolean') throw fail('SAVED_JOB_INPUT', '対象の求人を確認できません。');
  await checkOwner(client, owner);
  try {
    if (liked) await client.from('saved_jobs').insert({ worker_id: owner, job_number: Number(jobNumber) });
    else await client.from('saved_jobs').delete().eq('worker_id', owner).eq('job_number', Number(jobNumber));
  } catch { /* Read after an ambiguous result, including duplicate-key inserts. */ }
  await checkOwner(client, owner);
  let current;
  try { current = await client.from('saved_jobs').select('worker_id,job_number').eq('worker_id', owner).eq('job_number', Number(jobNumber)).maybeSingle(); }
  catch { /* An unreadable result must not update the UI or undo state. */ }
  await checkOwner(client, owner);
  if (current?.error || !current || (current.data && (current.data.worker_id !== owner || Number(current.data.job_number) !== Number(jobNumber)))) {
    throw fail('SAVED_JOB_UNCONFIRMED', 'いいねの保存結果を確認できません。表示は変更していません。通信を確認してもう一度操作してください。');
  }
  const saved = !!current.data;
  if (saved !== liked) throw fail('SAVED_JOB_REJECTED', 'いいねの変更を確認できません。表示は変更していません。もう一度操作してください。');
  revisions.set(owner, savedJobRevision(owner) + 1);
  return saved;
}
