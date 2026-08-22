#!/usr/bin/env python3
# 試作SVG（このフォルダの50個）→ src/lib/cropArt.js を生成する。
# 使い方：SVGを直したら、このフォルダで python3 build_crop_art.py を実行して再生成する。
#   ★手で cropArt.js を編集しないこと（次の生成で消える）。絵の正はこのフォルダのSVG。
# 形式：{ 作物名: { v: viewBoxの一辺, e: 要素ツリー } }
#   要素ツリー = ["タグ名", {属性}, [子]] ＝ CropIcon が React 要素へ組み立てる
#   （HTML直挿入 dangerouslySetInnerHTML を使わないための形式・CLAUDE.md の禁止規則）
import json, os
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "../../../src/lib/cropArt.js")
NS = "{http://www.w3.org/2000/svg}"

ATTR = {
    "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap",
    "stroke-linejoin": "strokeLinejoin", "clip-path": "clipPath",
    "fill-opacity": "fillOpacity", "stroke-opacity": "strokeOpacity",
    "clip-rule": "clipRule", "fill-rule": "fillRule", "stop-color": "stopColor",
}
SKIP = {"xmlns", "role", "aria-label", "viewBox", "width", "height", "ox"}

def conv(el):
    tag = el.tag.replace(NS, "")
    props = {}
    for k, v in el.attrib.items():
        if k in SKIP:
            continue
        props[ATTR.get(k, k)] = v
    kids = [conv(c) for c in list(el)]
    if kids:
        return [tag, props, kids]
    return [tag, props] if props else [tag]

def main():
    manifest = json.load(open(os.path.join(HERE, "manifest.json")))
    art = {}
    for e in manifest:
        root = ET.parse(os.path.join(HERE, e["file"] + ".svg")).getroot()
        vb = root.attrib.get("viewBox", "0 0 64 64").split()
        art[e["name"]] = {"v": float(vb[2]), "e": [conv(c) for c in list(root)]}
    body = json.dumps(art, ensure_ascii=False, separators=(",", ":"))
    header = (
        "// 作物アイコンの絵。★このファイルは自動生成です（手で編集しないこと）。\n"
        "//   絵の正 = docs/design/crop-icons-draft/*.svg\n"
        "//   直したら docs/design/crop-icons-draft で python3 build_crop_art.py を実行して作り直す。\n"
        "//\n"
        "// ・全50種とも当方の自作（2026-08-22）。外部素材を使っていないので出典表示は不要。\n"
        "//   （2026-08-08〜08-22は game-icons.net の素材を使用。差し替えに伴いヘルプの掲示も外した）\n"
        "// ・形式：{ 作物名: { v: viewBoxの一辺, e: 要素ツリー } }\n"
        "//   要素ツリー = [\"タグ名\", {属性}, [子]]。CropIcon が React 要素へ組み立てる\n"
        "//   ＝HTML直挿入（dangerouslySetInnerHTML）を使わないための形式（CLAUDE.md の禁止規則）。\n"
        "// ・clipPath の id は CropIcon 側で描画ごとにユニーク化する（同じ画面に複数出しても衝突しない）。\n"
        "// ・このファイルは CropIcon から動的importで遅延読み込みする（初期表示を重くしない）。\n"
    )
    open(OUT, "w", encoding="utf-8").write(header + "export const CROP_ART = " + body + ";\n")
    print("wrote src/lib/cropArt.js", os.path.getsize(OUT), "bytes /", len(art), "crops")

main()
