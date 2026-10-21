import { inputError as fail } from './inputRecovery.js';
import { uploadAvatarResilient } from "./avatarUpload.js";

const DIRECTORIES = { worker_profiles: "worker", employer_profiles: "employer", consignment_profiles: "consignment" };
const COLUMNS = "avatar_url,updated_at";


async function owner(client, userId) {
  const { data, error } = await client.auth.getSession();
  if (error || !userId || data?.session?.user?.id !== userId) {
    throw fail("AVATAR_SESSION", "ログインが確認できません。ページを開き直してください。");
  }
}
async function read(client, table, userId) {
  const { data, error } = await client.from(table).select(COLUMNS).eq("auth_id", userId).maybeSingle();
  if (error) throw fail("AVATAR_READ", "現在の画像を確認できません。通信が戻ってから、もう一度お試しください。");
  return data;
}
function ownedPath(client, folder, url) {
  try {
    const base = new URL(client.storage.from("avatars").getPublicUrl(folder + "/").data.publicUrl);
    const value = new URL(url);
    if (value.origin !== base.origin || !value.pathname.startsWith(base.pathname)) return null;
    const name = decodeURIComponent(value.pathname.slice(base.pathname.length));
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name)) return null;
    return folder + "/" + name;
  } catch { return null; }
}

// Only remove the one superseded object, after the DB reference is confirmed.
// A copied reference in another profile must remain usable. Never clear a folder.
async function cleanPrevious(client, userId, folder, previousUrl) {
  const path = ownedPath(client, folder, previousUrl);
  if (!path) return "";
  try {
    await owner(client, userId);
    for (const table of Object.keys(DIRECTORIES)) {
      const row = await read(client, table, userId);
      if (row?.avatar_url && ownedPath(client, folder, row.avatar_url) === path) return "";
    }
    const { error } = await client.storage.from("avatars").remove([path]);
    if (error) throw error;
    return "";
  } catch {
    return "画像の表示は更新しましたが、旧画像の削除を確認できませんでした。";
  }
}

// The UI supplies its visible URL as the comparison value, never as the new DB value.
// Unique objects + a conditional DB write protect both the old image and other tabs.
export async function saveProfileAvatar({ client, table, directory, userId, expectedUrl, blob = null }) {
  if (DIRECTORIES[table] !== directory || !/^[a-zA-Z0-9-]+$/.test(userId || "")) {
    throw fail("AVATAR_TARGET", "画像の保存先を確認できません。ページを開き直してください。");
  }
  await owner(client, userId);
  const before = await read(client, table, userId);
  if ((before?.avatar_url || "") !== (expectedUrl || "")) {
    throw fail("AVATAR_CONFLICT", "別の画面で画像が変更されています。ページを開き直してから変更してください。");
  }
  const folder = directory + "/" + userId;
  let url = "";
  if (blob) {
    const path = folder + "/avatar-" + crypto.randomUUID() + ".jpg";
    url = client.storage.from("avatars").getPublicUrl(path).data?.publicUrl;
    if (!url) throw fail("AVATAR_URL", "画像の保存先を確認できませんでした。");
    await uploadAvatarResilient(client, path, blob);
  }
  // Deleting an already empty profile does not create an otherwise empty row.
  if (!before && !blob) return { url: "", warning: "" };
  await owner(client, userId);
  const updatedAt = new Date(Math.max(Date.now(), (Date.parse(before?.updated_at) || 0) + 1)).toISOString();
  const payload = { avatar_url: url, updated_at: updatedAt };
  let written, writeError;
  try {
    let query;
    if (before) {
      query = client.from(table).update(payload).eq("auth_id", userId).eq("updated_at", before.updated_at);
      query = before.avatar_url == null ? query.is("avatar_url", null) : query.eq("avatar_url", before.avatar_url);
    } else {
      query = client.from(table).insert({ auth_id: userId, ...payload });
    }
    const result = await query.select(COLUMNS).maybeSingle();
    written = result.data; writeError = result.error;
  } catch (error) { writeError = error; }
  if (writeError || !written || written.avatar_url !== url) {
    let current;
    try { current = await read(client, table, userId); }
    catch {
      // The write may already have committed. Retain both objects until reconciled.
      throw fail("AVATAR_UNCONFIRMED", "保存結果を確認できませんでした。画像は消さずに残しています。通信が戻ってからページを開き直してください。");
    }
    if (!current || current.avatar_url !== url) {
      if (!writeError || writeError.code === "23505" || current?.updated_at !== before?.updated_at) {
        throw fail("AVATAR_CONFLICT", "別の画面でプロフィールが変更されています。ページを開き直してから変更してください。");
      }
      throw fail("AVATAR_SAVE", "画像の保存に失敗しました。元の画像を残しています。もう一度お試しください。");
    }
  }
  const warning = await cleanPrevious(client, userId, folder, before?.avatar_url);
  return { url, warning };
}
