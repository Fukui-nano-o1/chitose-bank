import { inputError as fail } from './inputRecovery.js';
import { sameProfileValue } from './profileRecord.js';

export async function photoOwner(client, expected) {
  const { data, error } = await client.auth.getSession();
  const id = data?.session?.user?.id;
  if (error || !id || (expected && id !== expected)) throw fail('PHOTO_SESSION', 'ログイン中のアカウントを確認できません。画面を開き直してください。');
  return id;
}
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif' };
// The encoded bytes determine an immutable owner-scoped path. Reselecting the
// same bytes after an unknown response reuses the object, including after reload.
export async function putPhotoBytes(client, owner, bucket, prefix, blob) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix) || !extensions[blob?.type] || !blob.size) throw fail('PHOTO_TYPE', '画像の形式または保存先を確認できません。');
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  const path = `${owner}/v2/${prefix}${hash}.${extensions[blob.type]}`;
  const storage = client.storage.from(bucket);
  // Stable identifier compatible with saved drafts and frozen records. The
  // bucket is private; ListingPhoto resolves this through authenticated download.
  const url = storage.getPublicUrl(path).data?.publicUrl;
  if (!url || !url.startsWith('https://')) throw fail('PHOTO_URL', '画像の保存先を確認できません。');
  await photoOwner(client, owner);
  let saved = false;
  try { const { error } = await storage.upload(path, blob, { upsert: false, contentType: blob.type }); saved = !error; }
  catch { /* A lost response may still have committed these immutable bytes. */ }
  if (!saved) {
    try {
      const { data, error } = await storage.download(path);
      if (!error && data?.size === blob.size) {
        const actual = new Uint8Array(await data.arrayBuffer()), expected = new Uint8Array(bytes);
        saved = actual.length === expected.length && expected.every((v, i) => v === actual[i]);
      }
    } catch { /* Unknown is not success; do not overwrite or delete anything. */ }
  }
  await photoOwner(client, owner);
  if (!saved) throw fail('PHOTO_UNCONFIRMED', '写真の保存を確認できません。同じ写真を選び直して再試行してください。');
  return url;
}

// Maintenance may change only the photo list it actually read. A zero-row
// update or lost response is confirmed by reading the exact desired result.
export async function confirmJobPhotoList(client, owner, id, expected, desired) {
  if (!id || !Array.isArray(expected) || !Array.isArray(desired)) throw fail('PHOTO_LIST_INPUT', '写真一覧の比較元を確認できません。');
  await photoOwner(client, owner);
  try {
    await client.from('jobs').update({ photos: desired }).eq('id', id).eq('photos', JSON.stringify(expected));
  } catch { /* A lost response may have committed; never retry without the baseline. */ }
  await photoOwner(client, owner);
  let result;
  try { result = await client.from('jobs').select('id,photos').eq('id', id).maybeSingle(); }
  catch { /* Unknown remains unknown. */ }
  await photoOwner(client, owner);
  if (!result || result.error || (result.data && result.data.id !== id)) throw fail('PHOTO_LIST_UNCONFIRMED', '写真一覧の保存結果を確認できません。');
  if (!result.data || !sameProfileValue(result.data.photos, desired)) throw fail('PHOTO_LIST_CONFLICT', '写真一覧が変更されたか、更新を拒否されました。最新の一覧で再実行してください。');
  return result.data;
}
