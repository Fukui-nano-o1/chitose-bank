// 作物アイコン（2026-08-08）。
// 【経緯】作物を50種に増やした際、絵文字が無い作物へ近い絵文字を流用したため 🥬が4種・🌿が4種…と
// 重複して見分けがつかなくなった。いったん自作SVG 20種で描き分けたが、たきと指示
// 「無料のアイコンをどこかのサイトから持ってこい」→「全50種を既製品で統一」により、
// game-icons.net（CC BY 3.0）の既製アイコンで全種を統一した。
//   ・出典表示はライセンスの条件ので、lib/cropArt.js の冒頭とヘルプの「このサイトについて」に掲示している。
//   ・絵の重複ゼロは機械検査済み（50種すべて別の絵）。
//
// 【読み込みの設計】絵のデータ（lib/cropArt.js）は約100KBあるので、初期バンドルに載せず動的importする。
//   届くまでは絵文字（CROP_OPTIONS.icon）を出す＝一瞬でも空白にしない・遅い回線でも名前と一緒に何か見える。
//   絵文字を持たない作物には🌱を出す（届いた瞬間に本来の絵へ差し替わる）。
//
// 【使い方】<CropIcon crop={求人のcrop文字列 または 作物名} size={28} />
//   crop は求人の自由入力（「トマト（桃太郎）」等）も来るので内部で includes 照合する
//   ＝各画面が持っていた照合ロジックをここへ集約している。
import { useEffect, useState } from "react";
import { CROP_OPTIONS } from "../lib/utils";

// ── 最新の作物アイコン（フルカラー・完全自作）────────────────────────────────
// 2026-08-22たきと指示「最新のアイコンを常に取得して」＝docs/design/crop-icons-draft を
// 【最新アイコンの唯一の置き場】として、ビルド時に全SVGを自動で取り込む。
// ・SVGを描き直す／新しい作物のSVGと manifest.json の行を足す → 次のビルドからアプリが自動追従
//   （コピーを作らない＝二重の真実を作らない。URLはハッシュ付きなので古いキャッシュも掴まない）
// ・まだ新アイコンが無い作物は、従来どおり単色アイコン（game-icons）→絵文字の順で埋める
// ・対応表＝manifest.json（name:作物名 / file:ファイル名）。プレビューは preview.html（運営確認用）
import cropIconManifest from "../../docs/design/crop-icons-draft/manifest.json";
// ?no-inline＝data:URIとしてバンドルに焼き込まない（35個で+63KBをuiチャンクに抱えない・実測）。
// 各SVGはハッシュ付きの独立ファイルになり、カードが描かれた時にだけ読み込まれる（img loading="lazy"）
const COLOR_ICON_URLS = import.meta.glob("../../docs/design/crop-icons-draft/*.svg", { eager: true, query: "?no-inline", import: "default" });
const COLOR_ICON_BY_NAME = {};
cropIconManifest.forEach(m => {
  const url = COLOR_ICON_URLS[`../../docs/design/crop-icons-draft/${m.file}.svg`];
  if (url) COLOR_ICON_BY_NAME[m.name] = url;
});

// 絵のデータは1度だけ読み、以後は使い回す（画面ごとに読み直さない）
let _art = null;
let _artPromise = null;
const _subs = new Set();
function loadArt() {
  if (_art) return;
  if (!_artPromise) {
    _artPromise = import("../lib/cropArt")
      .then(m => { _art = m.CROP_ART; _subs.forEach(fn => fn()); })
      .catch(() => { /* 取得できなければ絵文字のまま＝画面は壊れない */ });
  }
}

// 作物名（求人の自由入力も可）→ 一致する CROP_OPTIONS の項目。
// includes 照合＝「トマト（桃太郎）」のような自由入力でもアイコンが出る
export function findCropOption(crop) {
  if (!crop) return null;
  const s = String(crop);
  return CROP_OPTIONS.find(c => s.includes(c.name)) || null;
}

export function CropIcon({ crop, size = 28, fallback = "🌱", style }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (_art) return;
    const fn = () => force(v => v + 1);
    _subs.add(fn);
    loadArt();
    return () => { _subs.delete(fn); };
  }, []);

  const hit = findCropOption(crop);
  // 最新のフルカラーアイコンがある作物はそれを最優先（上記＝置き場から自動取得）
  const colorUrl = hit ? COLOR_ICON_BY_NAME[hit.name] : null;
  if (colorUrl) {
    return <img src={colorUrl} alt={hit.name} width={size} height={size} loading="lazy"
      style={{ display:"block", flexShrink:0, width:size, height:size, ...style }} />;
  }
  const art = hit && _art ? _art[hit.name] : null;
  if (art) {
    // path要素として組み立てる（HTML直挿入＝dangerouslySetInnerHTMLは使わない・CLAUDE.mdの禁止規則）。
    // 先頭"!"＝fill="none"（線だけのパス）
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label={hit.name}
        style={{ display:"block", flexShrink:0, color:art.c, ...style }}>
        {art.d.map((d, i) => (
          <path key={i} d={d.startsWith("!") ? d.slice(1) : d} fill={d.startsWith("!") ? "none" : "currentColor"} />
        ))}
      </svg>
    );
  }
  // 絵が届くまで／該当なし＝絵文字で埋める（空白を出さない）
  return <span aria-label={hit ? hit.name : undefined} style={{ fontSize:size, lineHeight:1, ...style }}>{hit?.icon || fallback}</span>;
}
