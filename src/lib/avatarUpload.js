// Upload to an operation-specific key. Existing avatars never prove this upload succeeded.
export async function uploadAvatarResilient(client, path, blob) {
  const storage = client.storage.from("avatars");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await storage.upload(path, blob, { upsert: false, contentType: "image/jpeg" });
      if (!error) return;
    } catch { /* A response can be lost after the object is stored. */ }
  }
  try {
    const { data, error } = await storage.download(path);
    if (!error && data?.size === blob.size) {
      const [wanted, actual] = await Promise.all([blob.arrayBuffer(), data.arrayBuffer()]);
      const left = new Uint8Array(wanted), right = new Uint8Array(actual);
      if (left.length === right.length && left.every((value, index) => value === right[index])) return;
    }
  } catch { /* Preserve the old reference when this exact content cannot be verified. */ }
  throw Object.assign(new Error("画像のアップロードを確認できませんでした。元の画像を残しています。もう一度お試しください。"), { code: "AVATAR_UPLOAD" });
}
