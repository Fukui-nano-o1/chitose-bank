const fail = (code, message) => Object.assign(new Error(message), { code });
async function owner(client, expected) {
  const { data, error } = await client.auth.getSession();
  const id = data?.session?.user?.id;
  if (error || !id || (expected && expected !== id)) throw fail('COPY_SESSION', 'ログイン中のアカウントを確認できません。ページを開き直してください。');
  return id;
}
// A read-write transaction serializes get-or-create across tabs as well as reloads.
// A failed durable write blocks the RPC, so there is always an ID to retry.
export function copyRequestStore(indexed = globalThis.indexedDB) {
  const transact = (key, proposal, removeId) => new Promise((resolve, reject) => {
    if (!indexed) { reject(Error('IndexedDB unavailable')); return; }
    const open = indexed.open('cb_job_copy_requests_v1', 1);
    let blocked = false;
    open.onupgradeneeded = () => open.result.createObjectStore('pending');
    open.onerror = () => reject(open.error);
    open.onblocked = () => { blocked = true; reject(Error('Copy storage blocked')); };
    open.onsuccess = () => {
      const db = open.result;
      if (blocked) { db.close(); return; }
      let result;
      let tx, store;
      try { tx = db.transaction('pending', 'readwrite'); store = tx.objectStore('pending'); }
      catch (e) { db.close(); reject(e); return; }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || Error('Copy storage failed')); };
      const get = store.get(key);
      get.onsuccess = () => {
        result = get.result || null;
        if (removeId) { if (result?.requestId === removeId) store.delete(key); }
        else if (!result) { result = proposal; store.add(proposal, key); }
      };
    };
  });
  return { acquire: (key, proposal) => transact(key, proposal, null), clear: (key, id) => transact(key, null, id) };
}
export async function copyJobRecord(client, jobNumber, options = {}, { store = copyRequestStore(), uuid = () => crypto.randomUUID() } = {}) {
  if (!Number.isSafeInteger(Number(jobNumber)) || Number(jobNumber) < 1) throw fail('COPY_TARGET', 'コピー元の求人を確認できません。');
  const userId = await owner(client), key = `${userId}:${Number(jobNumber)}`;
  let intent;
  try {
    intent = await store.acquire(key, { owner: userId, source: Number(jobNumber), requestId: uuid(),
      presetDates: options.presetDates || null, quietDates: !!options.quietDates });
    if (intent?.owner !== userId || intent.source !== Number(jobNumber) || !intent.requestId) throw Error('Invalid copy intent');
  } catch { throw fail('COPY_STORAGE', 'コピー操作を端末に保持できません。コピーは開始していません。端末の保存領域を確認してください。'); }
  await owner(client, userId);
  let result;
  try { result = await client.rpc('copy_my_job_once', { p_owner: userId, p_request_id: intent.requestId, p_job_number: intent.source }); }
  catch { /* Preserve the original request on any ambiguous response. */ }
  await owner(client, userId);
  const data = result?.data;
  if (result?.error || !data || typeof data.ok !== 'boolean') throw fail('COPY_UNCONFIRMED', 'コピー結果を確認できません。同じ求人のコピーボタンで、前回の結果を確認できます。');
  if (!data.ok) {
    // The server returned a definite rejection or an intentionally removed copy.
    try { await store.clear(key, intent.requestId); } catch { /* Retrying the same rejection cannot create a duplicate. */ }
    throw fail('COPY_REJECTED', data.reason === 'copy_deleted' ? '前回のコピー先は削除されています。新しく作る場合は、もう一度コピーしてください。'
      : 'コピーできませんでした。' + (data.reason === 'not_yours' ? 'コピー元の所有者を確認してください。' : '入力は変更していません。'));
  }
  if (data.request_id !== intent.requestId || data.owner !== userId || data.job?.farmer_id !== userId || data.job.job_number !== data.job_number) {
    throw fail('COPY_UNCONFIRMED', 'コピー結果を照合できません。同じ求人のコピーボタンで確認してください。');
  }
  // Clear only after the caller hands off the confirmed result. If navigation
  // storage fails, the next attempt still recovers this same target.
  return { data, intent, acknowledge: async () => {
    try { await store.clear(key, intent.requestId); }
    catch { throw fail('COPY_ACK', 'コピー先は保存済みですが、端末の確認記録を片付けられません。次の操作は同じコピー先を再確認します。'); }
  } };
}
