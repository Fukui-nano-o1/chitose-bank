// 作物アイコン（2026-08-22に自作50種へ差し替え）。
// 【経緯】2026-08-08に絵文字の重複を解消するため game-icons.net（CC BY 3.0）の素材で50種を統一したが、
//   2026-08-22にすべて当方の自作フルカラーへ差し替えた。外部素材は使っていないので出典表示は不要
//   （ヘルプ「このサイトについて」の掲示も同時に外した）。
//
// 【絵の正】docs/design/crop-icons-draft/*.svg。直したらそのフォルダで build_crop_art.py を実行し、
//   src/lib/cropArt.js を作り直す（cropArt.js は自動生成so手で編集しない）。
//
// 【読み込みの設計】絵のデータ（lib/cropArt.js）は約64KBあるので、初期バンドルに載せず動的importする。
//   届くまでは絵文字（CROP_OPTIONS.icon）を出す＝一瞬でも空白にしない・遅い回線でも名前と一緒に何か見える。
//   絵文字を持たない作物には🌱を出す（届いた瞬間に本来の絵へ差し替わる）。
//
// 【使い方】<CropIcon crop={求人のcrop文字列 または 作物名} size={28} />
//   crop は求人の自由入力（「トマト（桃太郎）」等）も来るので内部で includes 照合する
//   ＝各画面が持っていた照合ロジックをここへ集約している。
import { createElement, useEffect, useId, useState } from "react";
import { CROP_OPTIONS } from "../lib/utils";

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

// 要素ツリー ["タグ", {属性}, [子]] を React 要素へ。
// ★uid＝clipPath等のidを描画ごとにユニークにする接頭辞。付けないと同じ画面に同種のアイコンを
//   複数出したときにidが重複し、参照が最初の1つに吸われて絵が崩れる（HTML的にも不正）。
function build(node, uid, key) {
  const [tag, props = {}, kids] = node;
  const p = { key };
  for (const k in props) {
    let v = props[k];
    if (k === "id") v = uid + "-" + v;
    else if (typeof v === "string" && v.startsWith("url(#")) v = "url(#" + uid + "-" + v.slice(5);
    p[k] = v;
  }
  return createElement(tag, p, kids ? kids.map((c, i) => build(c, uid, i)) : undefined);
}

export function CropIcon({ crop, size = 28, fallback = "🌱", style }) {
  const [, force] = useState(0);
  const uid = useId().replace(/:/g, "");  // useIdの「:」はCSSセレクタで無効so外す
  useEffect(() => {
    if (_art) return;
    const fn = () => force(v => v + 1);
    _subs.add(fn);
    loadArt();
    return () => { _subs.delete(fn); };
  }, []);

  const hit = findCropOption(crop);
  const art = hit && _art ? _art[hit.name] : null;
  if (art) {
    const v = art.v || 64;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${v} ${v}`} role="img" aria-label={hit.name}
        style={{ display:"block", flexShrink:0, ...style }}>
        {art.e.map((n, i) => build(n, uid, i))}
      </svg>
    );
  }
  // 絵が届くまで／該当なし＝絵文字で埋める（空白を出さない）
  return <span aria-label={hit ? hit.name : undefined} style={{ fontSize:size, lineHeight:1, ...style }}>{hit?.icon || fallback}</span>;
}
