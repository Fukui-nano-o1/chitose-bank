// 求人作成フローの位置情報I/O。第2次構造改革2026-08-17で LandingFlow.jsx から分離・中身は不変。
// ★挙動は一切変えていない：4秒でabort／検索語で始まる結果を優先／全点の重心／
//   重心から最遠点までを半径にし 500〜3000m に収める。番地は絶対に渡さない（町域まで）。
//   訪問者に見せる座標の丸め（小数2桁・半径3000m）はDB側 jobs_public のマスクが担当＝別物。

// 国土地理院 住所検索API（APIキー不要・無料）
// 町域レベルの重心を返す。番地を渡してはならない。
export async function geocodeTown(prefecture, city, town) {
  const q = `${prefecture || ""}${city || ""}${town || ""}`.trim();
  if (!q) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q),
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const features = await res.json();
    if (!Array.isArray(features) || features.length === 0) return null;

    // 検索語で始まる結果のみを採用する（無関係な一致を排除）
    const hits = features.filter(f => (f?.properties?.title || "").startsWith(q));
    const use = hits.length > 0 ? hits : features;

    // 全点の重心を取る（先頭1件を採用しない）
    const pts = use
      .map(f => f?.geometry?.coordinates)
      .filter(c => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (pts.length === 0) return null;

    const lng = pts.reduce((s, c) => s + c[0], 0) / pts.length;
    const lat = pts.reduce((s, c) => s + c[1], 0) / pts.length;

    // 重心から最も遠い点までの距離を半径にする（町域の広がりを円が覆う）
    // 緯度1度≒111km、経度1度≒111km×cos(緯度)
    const mPerLat = 111000;
    const mPerLng = 111000 * Math.cos((lat * Math.PI) / 180);
    let maxDist = 0;
    for (const c of pts) {
      const dx = (c[0] - lng) * mPerLng;
      const dy = (c[1] - lat) * mPerLat;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) maxDist = d;
    }
    // 最小500m・最大3000mに収める（1点しか返らない場合の下限を確保）
    const radius = Math.round(Math.min(Math.max(maxDist, 500), 3000));

    return { lat, lng, radius, from: q };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
