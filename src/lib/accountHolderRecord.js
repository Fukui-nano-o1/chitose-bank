const fields = ['full_name', 'birth_date', 'postal_code', 'address', 'entity_type', 'company_name', 'company_number',
  'contact_email', 'contact_phone', 'agreed_terms_version', 'agreed_privacy_version'];
const columns = ['auth_id', ...fields].join(',');
const fail = (code, message) => Object.assign(new Error(message), { code });
async function sessionFor(client, owner) {
  const { data, error } = await client.auth.getSession();
  if (error || !owner || data?.session?.user?.id !== owner) throw fail('ACCOUNT_SESSION', 'ログイン中のアカウントを確認できません。画面を開き直してください。');
  return data.session;
}
const matches = (row, expected) => row && row.auth_id === expected.auth_id && fields.every(k => (row[k] ?? null) === (expected[k] ?? null));
async function read(client, owner) {
  const { data, error } = await client.from('account_holders').select(columns).eq('auth_id', owner).maybeSingle();
  if (error) throw fail('ACCOUNT_READ', '登録済みの情報を読み込めません。入力は残しています。通信を確認してもう一度登録してください。');
  await sessionFor(client, owner);
  return data;
}
const conflict = () => fail('ACCOUNT_CONFLICT', '登録済みの内容と今回の入力が異なります。画面を開き直して、登録済みの内容を確認してください。');

// The existing UNIQUE(auth_id) is the registration identity. Never upsert an
// existing identity and never treat a duplicate-key response alone as success.
export async function registerAccountHolder(client, owner, input) {
  const session = await sessionFor(client, owner);
  const expected = { ...Object.fromEntries(fields.map(k => [k, input[k] ?? null])), auth_id: owner,
    contact_email: session.user.email || null, contact_phone: session.user.phone || null };
  const existing = await read(client, owner);
  if (existing) { if (!matches(existing, expected)) throw conflict(); return existing; }
  await sessionFor(client, owner);
  let result;
  try { result = await client.from('account_holders').insert(expected).select(columns).single(); }
  catch { /* A lost response may still have committed; read the canonical row. */ }
  await sessionFor(client, owner);
  if (!result?.error && matches(result?.data, expected)) return result.data;
  let current;
  try { current = await read(client, owner); }
  catch (error) {
    if (error.code === 'ACCOUNT_SESSION') throw error;
    throw fail('ACCOUNT_UNCONFIRMED', '登録結果を確認できません。入力は残しています。もう一度登録すると保存済みの内容を確認します。');
  }
  if (matches(current, expected)) return current;
  if (current) throw conflict();
  throw fail('ACCOUNT_UNCONFIRMED', '登録を確認できません。入力は残しています。もう一度登録してください。');
}
