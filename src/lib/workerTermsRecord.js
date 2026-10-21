import { inputError as fail } from './inputRecovery.js';

async function checkOwner(client, owner) {
  const { data, error } = await client.auth.getSession();
  if (error || !owner || data?.session?.user?.id !== owner) throw fail('TERMS_SESSION', 'ログイン中のアカウントを確認できません。画面を開き直してください。');
}
export async function confirmWorkerTerms(client, owner, applicationId) {
  await checkOwner(client, owner);
  let result;
  try { result = await client.rpc('confirm_my_worker_terms', { p_owner: owner, p_application_id: applicationId }); }
  catch { /* Retrying this same application returns its existing confirmation. */ }
  await checkOwner(client, owner);
  const data = result?.data;
  if (result?.error || !data || typeof data.ok !== 'boolean') throw fail('TERMS_UNCONFIRMED', '確認結果を取得できません。もう一度押すと、同じ仕事の保存結果を確認します。');
  if (!data.ok) throw fail('TERMS_REJECTED', '求人内容の確認を保存できませんでした。仕事の最新状態を確認し、続く場合は「ヘルプ・お問い合わせ」へご連絡ください。', data.reason);
  if (data.owner !== owner || data.application_id !== applicationId || data.worker_confirmed !== true) throw fail('TERMS_UNCONFIRMED', '保存結果を照合できません。もう一度お試しください。');
  return data;
}
