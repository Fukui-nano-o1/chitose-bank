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
