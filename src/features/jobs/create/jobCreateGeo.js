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

// ───── 住所の実在チェック（2026-09-27たきと指示「ヒットしない住所はエラーにしよう。赤字で説明させよう」）─────
// 国土地理院の住所検索で【都道府県＋市区町村＋町域】が見つかるかを確かめる。
// ★番地までは確かめない：地理院の住所データは番地を持たない地域が多く、正しい番地
//   （例：吉野川市山川町宮島37-2）でも番地では当たらない。番地まで要求すると正しい住所を止めてしまう。
//   番地の中身は isValidStreetAddress（model.js）とDBの掲載トリガーが別に守っている。
// ★通信に失敗した時は "error"＝「見つからない」と区別し、入力は止めない（フェイルオープン）。

// 比較のための正規化：空白・全角数字・ハイフン類・「大字」「字」の表記ゆれを吸収する（両辺に同じ変換）
export const normalizeTownAddr = (s) => String(s || "")
  .replace(/[\s\u3000]/g, "")
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[‐‑‒–—―ー−ｰ－]/g, "-")
  .replace(/大字/g, "")
  .replace(/字/g, "");

// 地理院の結果（features）に、入力した町域と噛み合う地名があるか（純粋関数・テスト対象）。
// 噛み合う＝結果の地名が「都道府県＋市区町村」より詳しく、かつ
//   入力の町域で始まる（例：入力「宮島」→結果「宮島一丁目」）か、
//   入力の町域がその地名で始まる（例：入力「山川町前川字東」→結果「山川町前川」）。
export function townMatchesFeatures(features, prefecture, city, town) {
  const prefCity = normalizeTownAddr(`${prefecture || ""}${city || ""}`);
  const full = normalizeTownAddr(`${prefecture || ""}${city || ""}${town || ""}`);
  if (!prefCity || full.length <= prefCity.length) return false;
  return (Array.isArray(features) ? features : []).some((f) => {
    const t = normalizeTownAddr(f?.properties?.title);
    if (!t || t.length <= prefCity.length || !t.startsWith(prefCity)) return false;
    return t.startsWith(full) || full.startsWith(t);
  });
}

// 返り値："ok"（見つかった）／"notfound"（見つからない）／"error"（確かめられなかった）。
// 同じ住所の結果は覚えておく（入力のたびに外部へ問い合わせない）。"error" は覚えない＝次に再試行する
const townCheckCache = new Map();
export async function verifyTownAddress(prefecture, city, town) {
  const key = `${prefecture || ""}|${city || ""}|${town || ""}`;
  if (townCheckCache.has(key)) return townCheckCache.get(key);
  const q = `${prefecture || ""}${city || ""}${town || ""}`.trim();
  if (!q) return "notfound";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(
      "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q),
      { signal: ctrl.signal }
    );
    if (!res.ok) return "error";
    const features = await res.json();
    if (!Array.isArray(features)) return "error";
    const result = townMatchesFeatures(features, prefecture, city, town) ? "ok" : "notfound";
    townCheckCache.set(key, result);
    return result;
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}
