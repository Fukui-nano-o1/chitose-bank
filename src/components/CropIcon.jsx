// 作物アイコン（2026-08-08たきと指示「作物のアイコンが重複している。ないなら、君が描画して挿入しろ」）。
// 【なぜ必要か】作物を50種に増やしたとき、Unicodeに絵文字が無い作物（レタス・ハクサイ・ダイコン等）へ
// 近い絵文字を流用したため、🥬が4種・🌿が4種・🥕が3種…と重複し、カードで見分けがつかなくなっていた。
// 【方針】絵文字で一意に表せる作物はそのまま絵文字、無いものはここで自作SVGを描く＝全種が別の絵になる。
// 【層の規則】lib/utils.js は React/DOM 非依存の層so、あちらには文字列キー（svg:"lettuce"）だけを置き、
// JSX（実際の絵）はこのコンポーネント側に持つ。
// 【使い方】<CropIcon crop={求人のcrop文字列 または 作物名} size={28} />
//   crop は求人の自由入力（「トマト（桃太郎）」等）も来るので、内部で includes 照合する
//   ＝JobCard等が持っていた照合ロジックをここへ集約（3箇所の重複実装を1つに）。
import { CROP_OPTIONS } from "../lib/utils";

// 自作SVGの絵（viewBox 32x32 で統一・単色ベタ塗り中心＝小さくても形で識別できることを優先）。
// 増やすときは lib/utils の CROP_OPTIONS に svg:"キー" を足し、ここに同じキーで1行足す。
const CROP_SVG = {
  // ── 果菜 ──
  zucchini: (
    <g>
      <path d="M9 25c-3-3-2-9 3-13S23 6 25 8s0 8-5 12-8 8-11 5z" fill="#2E7D32" />
      <path d="M23 6l2-3 3 1-2 3z" fill="#7CB342" />
      <path d="M13 20c3-3 6-6 9-8" stroke="#66BB6A" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </g>
  ),
  okra: (
    <g>
      <path d="M16 4l5 6-3 18h-4L11 10z" fill="#43A047" />
      <path d="M16 10v16M13 12l1 14M19 12l-1 14" stroke="#2E7D32" strokeWidth="1" />
      <path d="M13 5h6l-3-3z" fill="#7CB342" />
    </g>
  ),
  // ── 葉茎菜 ──
  lettuce: (
    <g>
      <path d="M6 18c0-7 4-11 10-11s10 4 10 11c0 5-4 8-10 8S6 23 6 18z" fill="#AED581" />
      <path d="M10 17c2-4 4-6 6-6s4 2 6 6c-2 3-4 4-6 4s-4-1-6-4z" fill="#7CB342" />
      <path d="M16 11v10" stroke="#558B2F" strokeWidth="1.2" />
    </g>
  ),
  spinach: (
    <g>
      <path d="M16 26V14" stroke="#8D6E63" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 15c-6 1-9-2-9-6 5-2 8 1 9 6z" fill="#2E7D32" />
      <path d="M16 15c6 1 9-2 9-6-5-2-8 1-9 6z" fill="#388E3C" />
      <path d="M16 20c-4 1-6-1-6-4 3-1 5 1 6 4z" fill="#43A047" />
      <path d="M14 26h4" stroke="#E53935" strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  napa: (
    <g>
      <path d="M11 28c-2-4-2-14 1-20h8c3 6 3 16 1 20z" fill="#FFF9C4" />
      <path d="M12 8c-3 5-3 15-1 20-4-3-5-15-2-20z" fill="#AED581" />
      <path d="M20 8c3 5 3 15 1 20 4-3 5-15 2-20z" fill="#9CCC65" />
      <path d="M16 8v20" stroke="#C0CA33" strokeWidth="1.2" />
    </g>
  ),
  cauliflower: (
    <g>
      <circle cx="12" cy="13" r="5" fill="#FFFDE7" />
      <circle cx="20" cy="13" r="5" fill="#FFF9C4" />
      <circle cx="16" cy="9" r="5" fill="#FFFDE7" />
      <circle cx="16" cy="15" r="5" fill="#FFF8E1" />
      <path d="M7 16c-1 6 3 11 9 11s10-5 9-11c-3 4-6 5-9 5s-6-1-9-5z" fill="#7CB342" />
    </g>
  ),
  asparagus: (
    <g>
      <path d="M16 28V9" stroke="#43A047" strokeWidth="3" strokeLinecap="round" />
      <path d="M11 28l2-13" stroke="#66BB6A" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M21 28l-2-13" stroke="#66BB6A" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 9l-2 3 2-1 2 1z" fill="#2E7D32" />
      <path d="M13 15l-2 3 2-1 1 1z" fill="#2E7D32" />
      <path d="M19 15l2 3-2-1-1 1z" fill="#2E7D32" />
    </g>
  ),
  negi: (
    <g>
      <path d="M14 28c-2 0-3-1-3-3V16h10v9c0 2-1 3-3 3z" fill="#FFFDE7" />
      <path d="M11 16c-1-6 1-11 3-13 1 5 1 9 1 13z" fill="#43A047" />
      <path d="M21 16c1-6-1-11-3-13-1 5-1 9-1 13z" fill="#2E7D32" />
      <path d="M16 16V6" stroke="#66BB6A" strokeWidth="1.4" />
      <path d="M11 20h10" stroke="#F0F4C3" strokeWidth="1" />
    </g>
  ),
  shiso: (
    <g>
      <path d="M16 27V16" stroke="#6D4C41" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M16 16C9 16 5 12 5 7c7-2 11 3 11 9z" fill="#7B1FA2" />
      <path d="M16 16c7 0 11-4 11-9-7-2-11 3-11 9z" fill="#8E24AA" />
      <path d="M7 8l9 8M25 8l-9 8" stroke="#CE93D8" strokeWidth="0.9" />
    </g>
  ),
  // ── 根菜・イモ ──
  daikon: (
    <g>
      <path d="M13 12h6l1 8c0 5-2 9-4 9s-4-4-4-9z" fill="#FAFAFA" stroke="#E0E0E0" strokeWidth="0.8" />
      <path d="M16 29v-2" stroke="#E0E0E0" strokeWidth="1" />
      <path d="M14 12c-4-1-6-4-6-8 4 0 6 3 7 8z" fill="#43A047" />
      <path d="M18 12c4-1 6-4 6-8-4 0-6 3-7 8z" fill="#2E7D32" />
      <path d="M16 12V6" stroke="#66BB6A" strokeWidth="1.2" />
    </g>
  ),
  turnip: (
    <g>
      <path d="M16 29c-5 0-8-4-8-8s3-7 8-7 8 3 8 7-3 8-8 8z" fill="#FAFAFA" stroke="#E0E0E0" strokeWidth="0.8" />
      <path d="M15 14c-4-2-5-5-5-9 4 1 5 4 6 9z" fill="#43A047" />
      <path d="M17 14c4-2 5-5 5-9-4 1-5 4-6 9z" fill="#2E7D32" />
      <path d="M16 14V6" stroke="#66BB6A" strokeWidth="1.2" />
    </g>
  ),
  taro: (
    <g>
      <ellipse cx="16" cy="18" rx="7" ry="9" fill="#8D6E63" />
      <path d="M9 14h14M9 18h14M9 22h14" stroke="#6D4C41" strokeWidth="1.1" />
      <path d="M16 9c0-3 2-5 4-6-1 3-1 5-2 6z" fill="#66BB6A" />
    </g>
  ),
  ginger: (
    <g>
      <path d="M8 20c0-4 3-6 6-6 1-3 4-4 6-2s2 5 0 6c2 2 2 5 0 6-3 2-6 1-7-1-3 1-5-1-5-3z" fill="#D7A55B" />
      <path d="M14 14c1 2 1 4 0 6M20 18c-2 0-3 1-4 3" stroke="#B07C3A" strokeWidth="1.1" fill="none" />
    </g>
  ),
  // ── 穀類・豆 ──
  wheat: (
    <g>
      <path d="M16 28V13" stroke="#C9A227" strokeWidth="1.6" strokeLinecap="round" />
      <g fill="#E1B93C">
        <ellipse cx="13" cy="12" rx="2.4" ry="3.4" transform="rotate(-25 13 12)" />
        <ellipse cx="19" cy="12" rx="2.4" ry="3.4" transform="rotate(25 19 12)" />
        <ellipse cx="13" cy="17" rx="2.4" ry="3.4" transform="rotate(-25 13 17)" />
        <ellipse cx="19" cy="17" rx="2.4" ry="3.4" transform="rotate(25 19 17)" />
        <ellipse cx="16" cy="8" rx="2.4" ry="3.6" />
      </g>
    </g>
  ),
  soba: (
    <g>
      <path d="M16 28V15" stroke="#8D6E63" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M16 20c-4 0-7-2-8-4 3-2 6-1 8 2z" fill="#A5D6A7" />
      <g fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.6">
        <circle cx="11" cy="10" r="3" />
        <circle cx="17" cy="7" r="3" />
        <circle cx="21" cy="12" r="3" />
        <circle cx="15" cy="13" r="3" />
      </g>
      <g fill="#FBC02D">
        <circle cx="11" cy="10" r="0.9" /><circle cx="17" cy="7" r="0.9" />
        <circle cx="21" cy="12" r="0.9" /><circle cx="15" cy="13" r="0.9" />
      </g>
    </g>
  ),
  edamame: (
    <g>
      <path d="M7 20c0-5 5-9 12-9 5 0 7 2 7 4s-3 3-3 5-2 6-8 6-8-3-8-6z" fill="#8BC34A" />
      <g fill="#689F38">
        <circle cx="12" cy="19" r="2.6" /><circle cx="17" cy="20" r="2.6" /><circle cx="22" cy="19" r="2.6" />
      </g>
      <path d="M7 20c1-1 3-2 5-2" stroke="#7CB342" strokeWidth="1" fill="none" />
    </g>
  ),
  // ── 果樹 ──
  sudachi: (
    <g>
      <circle cx="16" cy="18" r="9" fill="#7CB342" />
      <path d="M16 9c-1-3 0-5 2-6-1 3-1 4 0 6z" fill="#558B2F" />
      <path d="M10 15c1-2 3-3 5-3" stroke="#AED581" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M16 27c4 0 7-3 8-6" stroke="#689F38" strokeWidth="1" fill="none" />
    </g>
  ),
  yuzu: (
    <g>
      <path d="M16 27c-5 0-9-4-9-9s4-9 9-9 9 4 9 9-4 9-9 9z" fill="#FDD835" />
      <path d="M8 15c2 1 3 0 4 1s-1 2 0 3M24 15c-2 1-3 0-4 1s1 2 0 3M12 24c1-2 3-1 4-2" stroke="#F9A825" strokeWidth="1.1" fill="none" />
      <path d="M16 9c0-2 1-4 3-5-1 3-1 4 0 5z" fill="#7CB342" />
    </g>
  ),
  persimmon: (
    <g>
      <ellipse cx="16" cy="19" rx="9" ry="8" fill="#F4791F" />
      <path d="M16 11c-4 0-6-1-6-3 2 0 3-1 6-1s4 1 6 1c0 2-2 3-6 3z" fill="#558B2F" />
      <path d="M16 7v4" stroke="#33691E" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 18c1-3 3-4 5-4" stroke="#FBB040" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </g>
  ),
  ume: (
    <g>
      <circle cx="16" cy="19" r="8" fill="#E91E63" />
      <path d="M16 11v16" stroke="#AD1457" strokeWidth="1.2" />
      <path d="M16 11c0-3 2-5 4-6-1 3-1 5 0 6z" fill="#7CB342" />
      <path d="M11 16c1-2 3-3 4-3" stroke="#F48FB1" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </g>
  ),
};

// 作物名（求人の自由入力も可）→ 一致する CROP_OPTIONS の項目。
// includes 照合＝「トマト（桃太郎）」のような自由入力でもアイコンが出る（従来の各画面の照合と同じ規則）
export function findCropOption(crop) {
  if (!crop) return null;
  const s = String(crop);
  return CROP_OPTIONS.find(c => s.includes(c.name)) || null;
}

export function CropIcon({ crop, size = 28, fallback = "🌱", style }) {
  const hit = findCropOption(crop);
  const shape = hit && hit.svg ? CROP_SVG[hit.svg] : null;
  if (shape) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={hit.name}
        style={{ display:"block", flexShrink:0, ...style }}>
        {shape}
      </svg>
    );
  }
  return <span aria-label={hit ? hit.name : undefined} style={{ fontSize:size, lineHeight:1, ...style }}>{hit?.icon || fallback}</span>;
}
