// 同梱のお知らせ画像は、読み込み前から縦横比を確保する。
// 実際のお知らせと管理者の見本を同じ部品で描く。未知のURLは従来どおり表示する。
const sizes = {
  "/notice-payment-cash-2026.jpg": { width: 1200, height: 800 },
  "/notice-profile-fill-2026.jpg": { width: 1200, height: 800 },
  "/notice-heatstroke-2026.jpg": { width: 1000, height: 750 },
};

export function NoticeImage({ src, alt }) {
  const dimensions = Object.hasOwn(sizes, src) ? sizes[src] : {};
  return <img src={src} alt={alt} {...dimensions} loading="eager" fetchPriority="high"
    style={{ display: "block", width: "100%", height: "auto", borderRadius: 12,
      aspectRatio: dimensions.width ? `${dimensions.width} / ${dimensions.height}` : undefined }} />;
}
