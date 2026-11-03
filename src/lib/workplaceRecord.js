import { validWorkplacePhotoPath } from './workplacePhotoAccess.js';
import { encodeWorkplaceImage } from './workplaceImage.js';

export const WORKPLACE_LIMIT = 6;
export const WORKPLACE_LIBRARY_LIMIT = 24;
const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const fail = (code, message) => Object.assign(new Error(message), { code });
export async function workplaceOwner(client, expected) {
  const { data, error } = await client.auth.getSession();
  const owner = data?.session?.user?.id;
  if (error || !owner || (expected && owner !== expected)) throw fail('SESSION', 'ログイン中のアカウントを確認できません。ページを開き直してください。');
  return owner;
}
export function validWorkplacePhotos(photos, owner) {
  return Array.isArray(photos) && photos.length <= WORKPLACE_LIMIT && new Set(photos.map(p => p?.id)).size === photos.length
    && photos.every(p => p && Object.keys(p).sort().join(',') === 'id,path' && /^[0-9a-f]{64}$/.test(p.id)
      && validWorkplacePhotoPath(p.path) && p.path === `${owner}/${p.id}.jpg`);
}
const validRow = (row, owner) => row?.owner_id === owner && Number.isInteger(row.revision) && row.revision >= 0
  && validWorkplacePhotos(row.draft_photos, owner) && validWorkplacePhotos(row.published_photos, owner)
  && typeof row.publication_active === 'boolean';
export async function readWorkplaceRecord(client, expectedOwner) {
  const owner = await workplaceOwner(client, expectedOwner);
  const { data, error } = await client.rpc('read_my_workplace', { p_owner: owner });
  await workplaceOwner(client, owner);
  if (error?.code === 'PGRST202' || error?.code === '42883') throw fail('UNCONFIGURED', '職場紹介の保存先はまだ準備中です。');
  if (error || !data?.ok) throw fail('READ', '職場紹介を読み込めませんでした。通信を確認して、もう一度お試しください。');
  const row = data.row || { owner_id: owner, revision: 0, draft_photos: [], published_photos: [], publication_active: false };
  if (!validRow(row, owner)) throw fail('READ', '職場紹介の保存内容を確認できませんでした。');
  return row;
}
async function mutate(client, record, name, extra, matches) {
  if (!validRow(record, record?.owner_id)) throw fail('NOT_LOADED', '保存済みの内容を読み込んでください。');
  await workplaceOwner(client, record.owner_id);
  let result;
  try { result = await client.rpc(name, { p_owner: record.owner_id, p_expected_revision: record.revision, ...extra }); } catch { /* Reconcile unknown writes, never resubmit blindly. */ }
  await workplaceOwner(client, record.owner_id);
  const row = result?.data?.ok && result.data.row;
  if (validRow(row, record.owner_id) && row.revision > record.revision && matches(row)) return row;
  let current;
  try { current = await readWorkplaceRecord(client, record.owner_id); }
  catch { throw fail('UNCONFIRMED', '保存結果を確認できません。写真は削除せず残しています。通信が戻ってから読み直してください。'); }
  if (current.revision > record.revision && matches(current)) return current;
  if (current.revision !== record.revision || result?.data?.reason === 'conflict') throw fail('CONFLICT', '別の画面で職場紹介が変更されています。最新の内容を読み直してください。');
  throw fail('SAVE', '保存を確認できませんでした。公開中の写真は変更せず残しています。');
}
export async function saveWorkplacePhotos(client, record, photos) {
  if (!validWorkplacePhotos(photos, record?.owner_id)) throw fail('PHOTOS', '写真の保存先または枚数を確認してください。');
  return mutate(client, record, 'save_my_workplace', { p_photos: photos }, row => same(row.draft_photos, photos));
}
export async function publishWorkplace(client, record, consent) {
  if (!consent?.publicWeb || !consent?.people || !record?.draft_photos?.length) throw fail('CONSENT', '写真のWeb公開と、写っている人の掲載同意を確認してください。');
  return mutate(client, record, 'publish_my_workplace', { p_image_consent: true, p_people_consent: true }, row => row.publication_active === true && same(row.published_photos, record.draft_photos));
}
export async function unpublishWorkplace(client, record) {
  return mutate(client, record, 'unpublish_my_workplace', {}, row => row.publication_active === false);
}
const validAsset = (photo, owner, states = ['pending', 'ready', 'deleting']) => validWorkplacePhotos([{ id: photo?.id, path: photo?.path }], owner)
  && /^[0-9a-f]{64}$/.test(photo.content_hash || '') && states.includes(photo.state) && Number.isInteger(photo.slot) && photo.slot >= 1 && photo.slot <= WORKPLACE_LIBRARY_LIMIT;
export async function readWorkplaceLibrary(client, expectedOwner) {
  const owner = await workplaceOwner(client, expectedOwner);
  const { data, error } = await client.rpc('read_my_workplace_photos', { p_owner: owner });
  await workplaceOwner(client, owner);
  if (error?.code === 'PGRST202' || error?.code === '42883') throw fail('UNCONFIGURED', '職場紹介の保存先はまだ準備中です。');
  if (error || !data?.ok || data.limit !== WORKPLACE_LIBRARY_LIMIT || !Array.isArray(data.photos)
    || data.photos.length > WORKPLACE_LIBRARY_LIMIT || new Set(data.photos.map(p => p?.id)).size !== data.photos.length
    || new Set(data.photos.map(p => p?.slot)).size !== data.photos.length || !data.photos.every(p => validAsset(p, owner))) {
    throw fail('LIBRARY', '保存済み写真を確認できません。もう一度読み込んでください。');
  }
  return data.photos;
}
async function assetCommand(client, owner, name, id, extra = {}) {
  if (!/^[0-9a-f]{64}$/.test(id || '')) throw fail('PHOTOS', '写真の保存先を確認できません。');
  await workplaceOwner(client, owner);
  let result;
  try { result = await client.rpc(name, { p_owner: owner, p_id: id, ...extra }); } catch { /* Unknown outcome: explicit recovery only. */ }
  await workplaceOwner(client, owner);
  const photo = result?.data?.photo;
  if (result?.data?.ok && validAsset(photo, owner, ['pending', 'ready', 'deleting', 'deleted']) && photo.id === id) return photo;
  const reason = result?.data?.reason;
  if (reason === 'in_use') throw fail('IN_USE', 'この写真は下書きまたは公開中の紹介で使われています。最新の内容を読み直してください。');
  if (['quota', 'quota_exceeded'].includes(reason)) throw fail('QUOTA', '保存済み写真は24枚までです。未使用の写真を削除して空きを作ってください。');
  if (reason === 'deleted') throw fail('DELETED', 'この写真は完全削除済みです。同じ保存先には再登録できません。');
  throw fail('ASSET_UNCONFIRMED', '写真の処理結果を確認できません。保存済み写真を読み直して確認してください。');
}
export async function reuseWorkplacePhoto(client, record, id) {
  const photos = await readWorkplaceLibrary(client, record?.owner_id);
  const photo = photos.find(p => p.id === id && p.state === 'ready');
  if (!photo) throw fail('PHOTOS', '利用できる保存済み写真を選んでください。');
  if (record.draft_photos.some(p => p.id === id)) return record;
  return saveWorkplacePhotos(client, record, [...record.draft_photos, { id, path: photo.path }]);
}
export async function deleteWorkplacePhoto(client, record, id, confirmation) {
  if (!confirmation?.irreversible) throw fail('CONSENT', '取り消せない削除であることを確認してください。');
  if (!validRow(record, record?.owner_id)) throw fail('NOT_LOADED', '保存済みの内容を読み込んでください。');
  if ([...record.draft_photos, ...record.published_photos].some(p => p.id === id)) throw fail('IN_USE', '下書きや公開中の写真は削除できません。');
  const photo = await assetCommand(client, record.owner_id, 'prepare_delete_workplace_photo', id, { p_confirm: true });
  if (photo.state !== 'deleting') throw fail('DELETE_UNCONFIRMED', '削除の準備を確認できません。写真一覧を読み直してください。');
  let removed;
  try { removed = await client.storage.from('workplace-photos').remove([photo.path]); } catch { /* Keep deleting state and quota until explicit retry. */ }
  await workplaceOwner(client, record.owner_id);
  if (!removed || removed.error) throw fail('DELETE_UNCONFIRMED', '削除の完了を確認できません。保存済み写真の削除中表示から、もう一度確認して再試行してください。');
  let done;
  try { done = await assetCommand(client, record.owner_id, 'finalize_delete_workplace_photo', id); }
  catch (failure) { if (failure.code === 'SESSION') throw failure; throw fail('DELETE_UNCONFIRMED', '削除の確認結果が届きませんでした。写真一覧を読み直してください。'); }
  if (done.state !== 'deleted') throw fail('DELETE_UNCONFIRMED', '削除の完了を確認できません。写真一覧を読み直してください。');
  return readWorkplaceRecord(client, record.owner_id);
}
export async function addWorkplacePhoto(client, record, file) {
  if (!record || record.draft_photos.length >= WORKPLACE_LIMIT) throw fail('LIMIT', '職場の写真は6枚までです。');
  await workplaceOwner(client, record.owner_id);
  const blob = await encodeWorkplaceImage(file);
  await workplaceOwner(client, record.owner_id);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const contentHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const library = await readWorkplaceLibrary(client, record.owner_id);
  const existing = library.find(p => p.content_hash === contentHash && p.state === 'pending');
  const id = existing?.id || Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  if (record.draft_photos.some(p => p.id === id)) return record;
  const reserved = await assetCommand(client, record.owner_id, 'reserve_workplace_photo', id, { p_content_hash: contentHash });
  if (reserved.content_hash !== contentHash || !['pending', 'ready'].includes(reserved.state)) throw fail('UPLOAD', 'この写真は処理中です。写真一覧を読み直してください。');
  const path = `${record.owner_id}/${id}.jpg`, storage = client.storage.from('workplace-photos');
  let uploaded = reserved.state === 'ready';
  if (!uploaded) {
    try { const result = await storage.upload(path, blob, { upsert: false, contentType: 'image/jpeg' }); uploaded = !result.error; } catch { /* Unknown upload can already exist. */ }
    await workplaceOwner(client, record.owner_id);
    if (!uploaded) {
      try {
        const result = await storage.download(path, {}, { cache: 'no-store' });
        const actual = result.error || !result.data ? null : new Uint8Array(await result.data.arrayBuffer());
        uploaded = !!actual && actual.length === bytes.length && bytes.every((v, i) => v === actual[i]);
      } catch { /* Retain unknown private object; no deletion. */ }
    }
    await workplaceOwner(client, record.owner_id);
    if (!uploaded) throw fail('UPLOAD', '写真の保存を確認できません。同じ写真で再試行してください。');
    const finalized = await assetCommand(client, record.owner_id, 'finalize_workplace_photo', id);
    if (finalized.state !== 'ready') throw fail('UPLOAD', '写真の保存を確認できません。写真一覧を読み直してください。');
  }
  return saveWorkplacePhotos(client, record, [...record.draft_photos, { id, path }]);
}
