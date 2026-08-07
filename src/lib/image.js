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
  // 本人フォルダ（auth.uid()/…）に保存する（2026-08-06）。job-photosの書き込みRLSは
  // 「本人フォルダのみ＋管理者は全域」＝他人の写真を消せない・差し替えられない機構の壁。
  // 既存のルート直下ファイルは移動しない（凍結terms_snapshot・photos jsonbのURLを壊さないため）。
  // 未ログインはフォルダ無し＝従来どおりRLSで弾かれる（挙動不変）
  let ownerFolder = "";
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data?.session?.user?.id;
    if (uid) ownerFolder = uid + "/";
  } catch { /* セッション取得失敗時はフォルダ無し＝RLSが弾く */ }
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
      // 軽量サムネ：640px/品質0.65（2026-08-02・②で320px/0.5から拡大）。従来は小さいサムネ専用
      // だったが、さがす一覧カードの顔（幅いっぱい表示）にも使うため640pxへ。それでも原寸の1/6程度
      if (withThumb) thumb = await encodeBitmap(bitmap, src, 640, 0.65);
      bitmap.close?.();
    }
  } catch { full = file; thumb = null; }
  const fullPath = ownerFolder + base + ".jpg";
  const thumbPath = ownerFolder + "thumb_" + base + ".jpg";
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

// 同時実行プール（2026-08-03たきと指示「一括軽量化は一瞬で終了させろ」）：
// 一括処理が1枚ずつの完全直列で何分もかかっていたため、最大limit件を並走させる。
// ダウンロード・アップロードはI/O待ちが大半so並走で数倍速くなる。エラーはworker側で握る前提
async function runPool(items, limit, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await worker(items[i], i); }
  });
  await Promise.all(lanes);
}

// 一括処理で一度試して縮まなかったファイルの記録（端末ローカル・表示や権限には使わない作業メモ）。
// 400KB以上のまま残る「圧縮しても縮まない写真」を毎回ダウンロードし直す無駄を省く＝再実行がほぼ一瞬になる。
// サイズが変われば（上書きされた等）記録は無効＝また対象に戻る
const RECOMP_SKIP_KEY = "cb_recompressSkip_v1";
const readRecompSkip = () => { try { const v = JSON.parse(localStorage.getItem(RECOMP_SKIP_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const writeRecompSkip = (v) => { try { localStorage.setItem(RECOMP_SKIP_KEY, JSON.stringify(v)); } catch {} };

// バケットの一括軽量化（管理者用・2026-07-26）：重いファイルだけダウンロード→圧縮→【同一パスに上書き】。
// URLが変わらないのでDB（jobs.photos jsonb・avatar_url・凍結terms_snapshotのURL参照）は一切触らない。
// thumb_やしきい値未満・圧縮しても縮まないファイルはスキップ＝何度実行しても安全（冪等）。
// 2026-08-03：6並列化＋「縮まなかった記録」スキップ。初回は数倍速・再実行は一覧チェックだけで即終了
export async function recompressBucket(supabase, bucket, { maxSide = 1600, quality = 0.8, minBytes = 400 * 1024, onProgress } = {}) {
  const skipMemo = readRecompSkip();
  const files = (await listBucketFiles(supabase, bucket)).filter(f =>
    !f.path.split("/").pop().startsWith("thumb_") &&
    /\.(jpe?g|png|webp)$/i.test(f.path) &&
    f.size >= minBytes &&
    skipMemo[bucket + "/" + f.path] !== f.size // 前回このサイズで縮まなかった＝今回も飛ばす
  );
  let done = 0, replaced = 0, savedBytes = 0;
  await runPool(files, 6, async (f) => {
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(f.path);
      if (dlErr || !blob) return;
      const file = new File([blob], f.path.split("/").pop(), { type: blob.type || "image/jpeg" });
      const upFile = await compressImage(file, maxSide, quality);
      if (upFile === file || upFile.size >= file.size) { skipMemo[bucket + "/" + f.path] = f.size; return; }
      const { error: upErr } = await supabase.storage.from(bucket).upload(f.path, upFile, { upsert: true, contentType: "image/jpeg" });
      if (upErr) return;
      replaced++; savedBytes += f.size - upFile.size;
    } catch { /* この1枚は飛ばして続行 */ }
    finally { done++; onProgress?.(done, files.length); }
  });
  writeRecompSkip(skipMemo);
  return { candidates: files.length, replaced, savedBytes };
}

// 既存の求人写真へのサムネ後埋め（管理者用・2026-08-02・②）：jobs.photos の各写真について
// 640pxサムネを生成して thumb_<元ファイル名> に保存し、jsonbへ thumb URL を書き戻す。
// ・thumbのパスは元ファイル名から機械的に決まる＝uploadJobPhotoの命名規則と同一
// ・同一パスへupsert＝再実行しても増殖しない（冪等）。
// ・失敗した写真は飛ばして続行（元のentryを保持＝原寸フォールバックが効き続ける）
// ・危険箇所写真（danger_）はカード表示が無いので対象外
// 2026-08-03たきと指示「一瞬で終了させろ」：
// ・thumbが既にある写真はダウンロードせずスキップ（以前は毎回全枚数を再生成＝再実行も何分もかかった。
//   新規アップロードはuploadJobPhotoがサムネを同時生成するso、このツールの仕事は「thumb無しの後埋め」だけでよい）
// ・残った対象は6並列で処理。★旧320px世代を作り直したい時は force:true（全再生成・通常は不要）
export async function generateJobPhotoThumbs(supabase, { maxSide = 640, quality = 0.65, bucket = "job-photos", onProgress, force = false } = {}) {
  const { data: rows, error } = await supabase.from("jobs").select("id, photos");
  if (error) return { error: error.message };
  const jobsWithPhotos = (rows || []).filter(r => Array.isArray(r.photos) && r.photos.length > 0);
  const total = jobsWithPhotos.reduce((n, r) => n + r.photos.length, 0);
  // 処理が要る写真だけを平らに集める（job行をまたいで1つのプールで並走させるため）
  const tasks = []; // { row, index, url, path, name }
  const nextByJob = new Map(); // job.id → photos配列のコピー（処理結果を差し込む）
  let skipped = 0;
  for (const row of jobsWithPhotos) {
    const next = row.photos.map(p => p);
    nextByJob.set(row.id, next);
    row.photos.forEach((p, i) => {
      const url = typeof p === "string" ? p : p?.url;
      const marker = "/" + bucket + "/";
      const at = url ? url.indexOf(marker) : -1;
      if (at < 0) return; // このバケットの写真でなければ触らない
      if (!force && typeof p === "object" && p?.thumb) { skipped++; return; } // 生成済み＝仕事なし
      const path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
      tasks.push({ row, index: i, url, path, name: path.split("/").pop() });
    });
  }
  let done = 0, made = 0, failed = 0, updatedJobs = 0;
  const changedJobs = new Set();
  await runPool(tasks, 6, async (t) => {
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(t.path);
      if (dlErr || !blob) { failed++; return; }
      const file = new File([blob], t.name, { type: blob.type || "image/jpeg" });
      const small = await compressImage(file, maxSide, quality);
      const thumbPath = t.path.replace(/[^/]+$/, "thumb_" + t.name);
      const { error: upErr } = await supabase.storage.from(bucket).upload(thumbPath, small, { upsert: true, contentType: small.type || "image/jpeg" });
      if (upErr) { failed++; return; }
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(thumbPath);
      const thumbUrl = urlData?.publicUrl || "";
      if (!thumbUrl) { failed++; return; }
      made++;
      const p = t.row.photos[t.index];
      const entry = typeof p === "string" ? { url: t.url } : { ...p };
      if (entry.thumb !== thumbUrl) { entry.thumb = thumbUrl; changedJobs.add(t.row.id); }
      nextByJob.get(t.row.id)[t.index] = entry;
    } catch { failed++; }
    finally { done++; onProgress?.(done, tasks.length); }
  });
  // 書き戻しは並走完了後にjob単位で1回（写真の並び順は維持される：indexで差し込むため）
  for (const row of jobsWithPhotos) {
    if (!changedJobs.has(row.id)) continue;
    const { error: upErr } = await supabase.from("jobs").update({ photos: nextByJob.get(row.id) }).eq("id", row.id);
    if (!upErr) updatedJobs++;
  }
  return { total, made, failed, skipped, updatedJobs };
}
