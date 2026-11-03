export const WORKPLACE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const WORKPLACE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateWorkplaceImage(file) {
  if (!file || !WORKPLACE_IMAGE_TYPES.includes(file.type)) throw new Error('JPEG・PNG・WebPの写真を選んでください。');
  if (!file.size || file.size > WORKPLACE_IMAGE_MAX_BYTES) throw new Error('写真は1枚5MB以内で選んでください。');
}

// Fresh canvas encoding strips EXIF/GPS and other original metadata. Never fall
// back to the raw bytes when decoding or encoding fails.
export async function encodeWorkplaceImage(file) {
  validateWorkplaceImage(file);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error('写真を読み込めませんでした。別の写真を選んでください。'));
      value.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('写真の大きさを確認できませんでした。');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('写真を変換できませんでした。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.type !== 'image/jpeg' || !blob.size || blob.size > WORKPLACE_IMAGE_MAX_BYTES) throw new Error('写真を安全に変換できませんでした。別の写真を選んでください。');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
