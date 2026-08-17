// 住所→座標（国土地理院 住所検索API・APIキー不要・無料）。
// LandingFlow の geocodeTown（町域重心・番地を渡さない）とは役割が違う：
// こちらは【番地まで含む正確な位置】を取りに行く。用途はGoogleマップ導線の精度確保（2026-08-03たきと指摘
// 「Googleマップへ遷移しても正確な位置に行かない。手動で同じ住所を入れると正確な位置に行く」）。
//
// なぜ座標が要るか：Googleマップに住所【文字列】を渡すと、Google側の検索に委ねることになり、
// 番地まで持っていない地域では町域の中心に着地する（手で入力した時は候補から場所を選ぶので正確に着く）。
// 座標を渡せばGoogleの検索を通さず必ずその点に着く。
// 精度が取れなかった時は null を返し、呼び出し側は従来どおり住所文字列にフォールバックする（劣化しない）。

// 表記ゆれを吸収して比較するための正規化：空白除去・全角英数を半角へ・ハイフン類を統一
const normalizeAddr = (s) => String(s || "")
  .replace(/[\s\u3000]/g, "") // \u3000＝全角スペース（直書きはlintのno-irregular-whitespaceに当たる）
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[‐‑‒–—―ー−ｰ]/g, "-");

// 住所文字列（都道府県+市区町村+町域+番地）から座標を取る。
// 返すのは「問い合わせた住所そのもの（＝番地まで）に一致した結果」だけ。
// 町域までしか当たらなかった場合は null（町域重心はピンが既に持っているので、ここで返す意味がない）
export async function geocodeAddressPrecise(fullAddress) {
  const q = String(fullAddress || "").trim();
  if (!q) return null;
  const nq = normalizeAddr(q);
  if (!nq) return null;
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
    // 問い合わせた住所と同じ（またはそれ以上に詳しい）結果だけを採る。
    // 例：「…山川町宮島37-2」で引いて「…山川町宮島」しか返らなければ＝番地未対応ので不採用
    const hit = features.find((f) => {
      const t = normalizeAddr(f?.properties?.title);
      return t && t.startsWith(nq);
    });
    const c = hit?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length !== 2) return null;
    const lng = Number(c[0]), lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
