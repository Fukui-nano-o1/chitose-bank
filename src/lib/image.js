// 画像のクライアント圧縮（2026-07-26 LandingFlowから共有層へ移動）：求人写真・ヘルプのスクショ等、
// アップロード前に必ず通す。原寸4MB級が「白いまま読み込み待ち」になる問題と転送量（egress）対策の両方。
// 圧縮に失敗したら原本をそのまま返す（古いブラウザ等でも壊れない）
// デコード済みビットマップから指定サイズのJPEG Fileを作る（compressImageの中核・デコード結果を使い回す用）
async function encodeBitmap(bitmap, srcFile, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1 && srcFile.size < 600 * 1024) return srcFile; // 十分小さい画像は無加工
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob || blob.size >= srcFile.size) return srcFile; // 逆に大きくなったら原本
  return new File([blob], (srcFile.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

export async function compressImage(file, maxSide = 1600, quality = 0.8) {
  try {
    if (!file || !file.type || !file.type.startsWith("image/")) return file;
    const bitmap = await createImageBitmap(file);
    const out = await encodeBitmap(bitmap, file, maxSide, quality);
    bitmap.close?.();
    return out;
  } catch { return file; }
}

// 求人写真を1枚アップロード（2026-08-01・体感速度改善）。旧実装は1ファイルにつき
// 「圧縮→upload→（同じファイルを再デコードして）サムネ圧縮→upload」を直列に行い、
// さらに呼び出し側でもファイルごとに直列だったため複数枚で非常に遅かった。ここでは
// (1)デコードは1回だけ・原寸とサムネで使い回す (2)原寸とサムネのuploadを並列に投げる。
// 呼び出し側で Promise.all すれば全ファイルも並列になる。
// 返り値: { url, thumb? }（withThumb=false の危険箇所写真は { url } のみ）
export async function uploadJobPhoto(supabase, file, { bucket = "job-photos", pathPrefix = "job_", withThumb = true } = {}) {
  const base = pathPrefix + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  let full = file, thumb = null;
  try {
    let src = file;
    // iPhoneのHEIC/HEIFはブラウザがcreateImageBitmapでデコードできず、これまでは
    // 例外→原本のまま（＝無圧縮の巨大ファイル）を上げていた。アバターと同様に
    // まずheic2anyでjpegへデコードしてから圧縮する（HEICのときだけ動的import）
    const isHeic = /\.(heic|heif)$/i.test(file?.name || "") || /heic|heif/i.test(file?.type || "");
    if (isHeic) {
      const heic2any = (await import("heic2any")).default;
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      src = Array.isArray(converted) ? converted[0] : converted;
    }
    if (src && (!src.type || src.type.startsWith("image/"))) {
      const bitmap = await createImageBitmap(src);
      full = await encodeBitmap(bitmap, src, 1600, 0.8);
      // 軽量サムネ（2026-07-25たきと指示「画質荒くてもいいからすぐ」）：320px/品質0.5。
      // 一覧・応募者ページ等の小さい表示はこちらを読む（原寸の1/10以下）
      if (withThumb) thumb = await encodeBitmap(bitmap, src, 320, 0.5);
      bitmap.close?.();
    }
  } catch { full = file; thumb = null; }
  const fullPath = base + ".jpg";
  const thumbPath = "thumb_" + base + ".jpg";
  const jobs = [supabase.storage.from(bucket).upload(fullPath, full, { contentType: full.type || undefined })];
  if (thumb) jobs.push(supabase.storage.from(bucket).upload(thumbPath, thumb, { contentType: thumb.type || undefined }));
  const [fullRes, thumbRes] = await Promise.all(jobs);
  if (fullRes.error) throw fullRes.error;
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fullPath);
  let thumbUrl = "";
  if (thumb && thumbRes && !thumbRes.error) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(thumbPath);
    thumbUrl = data?.publicUrl || "";
  }
  return { url: urlData?.publicUrl || "", ...(thumbUrl ? { thumb: thumbUrl } : {}) };
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
