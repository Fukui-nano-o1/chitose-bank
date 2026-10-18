const error = (code, message) => Object.assign(new Error(message), { code });
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
async function owner(client, expected) {
  const { data, error: failed } = await client.auth.getSession();
  if (failed || !expected || data?.session?.user?.id !== expected) throw error('HELP_IMAGE_SESSION', 'ログイン中のアカウントを確認できません。ページを開き直してください。');
}
export async function readHelpImages(client, slots) {
  let query = client.from('help_images').select('slot_key,url,updated_at');
  if (slots) query = query.in('slot_key', slots);
  const { data, error: failed } = await query;
  if (failed || !Array.isArray(data)) throw error('HELP_IMAGE_READ', '保存済みの画像を読み込めません。通信を確認して、もう一度読み込んでください。');
  return Object.fromEntries(data.map(row => [row.slot_key, row]));
}
async function uploadExact(storage, path, blob) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const { error: failed } = await storage.upload(path, blob, { upsert: false, contentType: blob.type }); if (!failed) return; }
    catch { /* Upload may have committed despite a lost response. */ }
  }
  try {
    const { data, error: failed } = await storage.download(path);
    if (!failed && data?.size === blob.size) {
      const [wanted, actual] = await Promise.all([blob.arrayBuffer(), data.arrayBuffer()]);
      const a = new Uint8Array(wanted), b = new Uint8Array(actual);
      if (a.length === b.length && a.every((v, i) => v === b[i])) return;
    }
  } catch { /* Keep every old object and reference. */ }
  throw error('HELP_IMAGE_UPLOAD', '画像のアップロードを確認できません。元の画像は残しています。');
}
// Immutable upload first; conditionally change the DB reference second.
// Do not delete objects here: other slots, stale clients and in-flight requests
// may still hold their URLs. Object retirement requires separate reconciliation.
export async function saveHelpImage({ client, userId, slotKey, record, blob = null }) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(slotKey || '') || (record && (record.slot_key !== slotKey || !record.updated_at))) {
    throw error('HELP_IMAGE_TARGET', '画像の保存先を確認できません。');
  }
  await owner(client, userId);
  const before = (await readHelpImages(client, [slotKey]))[slotKey] || null;
  if ((before?.url || null) !== (record?.url || null) || (before && Date.parse(before.updated_at) !== Date.parse(record?.updated_at))) {
    throw error('HELP_IMAGE_CONFLICT', '別の画面で画像が変更されています。最新の画像を読み込んでから変更してください。');
  }
  let url = null;
  if (blob) {
    const ext = extensions[blob.type];
    if (!ext || !blob.size) throw error('HELP_IMAGE_TYPE', 'JPEG・PNG・WebP・GIF形式の画像を選んでください。');
    const storage = client.storage.from('help-images');
    const path = `v2/${slotKey}/${crypto.randomUUID()}.${ext}`;
    url = storage.getPublicUrl(path).data?.publicUrl;
    if (!url || !url.startsWith('https://')) throw error('HELP_IMAGE_URL', '画像の保存先を確認できません。');
    await uploadExact(storage, path, blob);
  }
  await owner(client, userId);
  let result;
  try { result = await client.rpc('save_help_image_reference', { p_owner: userId, p_slot: slotKey,
    p_expected: record ? { url: record.url, updated_at: record.updated_at } : null, p_url: url }); }
  catch { /* Re-read the canonical reference after a lost response. */ }
  await owner(client, userId);
  const matches = row => url === null ? row === null : row?.slot_key === slotKey && row.url === url;
  if (!result?.error && result?.data?.ok && matches(result.data.row)) return result.data.row;
  let current;
  try { current = (await readHelpImages(client, [slotKey]))[slotKey] || null; await owner(client, userId); }
  catch { throw error('HELP_IMAGE_UNCONFIRMED', '保存結果を確認できません。画像ファイルは消していません。通信が戻ってから読み込み直してください。'); }
  if (matches(current)) return current;
  if (result?.data?.reason === 'conflict' || current?.url !== before?.url || current?.updated_at !== before?.updated_at) {
    throw error('HELP_IMAGE_CONFLICT', '別の画面で画像が変更されています。最新の画像を読み込んでから変更してください。');
  }
  throw error('HELP_IMAGE_SAVE', '画像の保存に失敗しました。元の画像は残しています。もう一度お試しください。');
}
