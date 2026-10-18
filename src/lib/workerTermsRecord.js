const fail = (code, message) => Object.assign(new Error(message), { code });
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
  if (!data.ok) throw fail('TERMS_REJECTED', data.reason === 'closed' ? 'この仕事は終了しているため確認できません。' : '求人内容の確認と確認記録を保存できませんでした。もう一度お試しください。');
  if (data.owner !== owner || data.application_id !== applicationId || data.worker_confirmed !== true) throw fail('TERMS_UNCONFIRMED', '保存結果を照合できません。もう一度お試しください。');
  return data;
}
