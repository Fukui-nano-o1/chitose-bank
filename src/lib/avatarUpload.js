// 分割3-B（2026-07-25）：App.jsxから移動。働き手・雇い手のアバター保存で共用。
import { supabase } from "./supabase";

// アバターのアップロード（通信断耐性・2026-07-19）：iOS Safariでは応答だけ失われて「Load failed」に
// なっても実際にはサーバー保存済みのことがある（実事例：2026-07-19 働き手アイコン）。
// 1回リトライ→それでも失敗なら実物の存在確認で救済する。呼び出し前に旧ファイルは掃除済みの前提
// （フォルダにavatar.jpgが残っていれば今回のアップロードの実物と判断できる）
export async function uploadAvatarResilient(folder, blob) {
  const path = folder + "/avatar.jpg";
  const attempt = async () => (await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })).error;
  let err = await attempt();
  if (err) {
    await new Promise(r => setTimeout(r, 800));
    err = await attempt();
  }
  if (err) {
    try {
      const { data: files, error: listErr } = await supabase.storage.from('avatars').list(folder);
      if (!listErr && (files || []).some(f => f.name === 'avatar.jpg')) err = null;
    } catch {}
  }
  return err;
}
