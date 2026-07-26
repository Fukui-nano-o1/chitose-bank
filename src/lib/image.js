// 画像のクライアント圧縮（2026-07-26 LandingFlowから共有層へ移動）：求人写真・ヘルプのスクショ等、
// アップロード前に必ず通す。原寸4MB級が「白いまま読み込み待ち」になる問題と転送量（egress）対策の両方。
// 圧縮に失敗したら原本をそのまま返す（古いブラウザ等でも壊れない）
export async function compressImage(file, maxSide = 1600, quality = 0.8) {
  try {
    if (!file || !file.type || !file.type.startsWith("image/")) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 600 * 1024) return file; // 十分小さい画像は無加工
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // 逆に大きくなったら原本
    return new File([blob], (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}

// バケット内の全画像を再帰列挙（2026-07-26・一括軽量化用）。フォルダはid=nullで返るので潜る
export async function listBucketFiles(supabase, bucket, prefix = "") {
  const out = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return out;
  for (const item of data) {
    const path = prefix ? prefix + "/" + item.name : item.name;
    if (item.id === null) out.push(...await listBucketFiles(supabase, bucket, path));
    else out.push({ path, size: item.metadata?.size || 0 });
  }
  return out;
}

// バケットの一括軽量化（管理者用・2026-07-26）：重いファイルだけダウンロード→圧縮→【同一パスに上書き】。
// URLが変わらないのでDB（jobs.photos jsonb・avatar_url・凍結terms_snapshotのURL参照）は一切触らない。
// thumb_やしきい値未満・圧縮しても縮まないファイルはスキップ＝何度実行しても安全（冪等）
export async function recompressBucket(supabase, bucket, { maxSide = 1600, quality = 0.8, minBytes = 400 * 1024, onProgress } = {}) {
  const files = (await listBucketFiles(supabase, bucket)).filter(f =>
    !f.path.split("/").pop().startsWith("thumb_") &&
    /\.(jpe?g|png|webp)$/i.test(f.path) &&
    f.size >= minBytes
  );
  let done = 0, replaced = 0, savedBytes = 0;
  for (const f of files) {
    done++; onProgress?.(done, files.length);
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(f.path);
      if (dlErr || !blob) continue;
      const file = new File([blob], f.path.split("/").pop(), { type: blob.type || "image/jpeg" });
      const upFile = await compressImage(file, maxSide, quality);
      if (upFile === file || upFile.size >= file.size) continue;
      const { error: upErr } = await supabase.storage.from(bucket).upload(f.path, upFile, { upsert: true, contentType: "image/jpeg" });
      if (upErr) continue;
      replaced++; savedBytes += f.size - upFile.size;
    } catch { /* この1枚は飛ばして続行 */ }
  }
  return { candidates: files.length, replaced, savedBytes };
}
