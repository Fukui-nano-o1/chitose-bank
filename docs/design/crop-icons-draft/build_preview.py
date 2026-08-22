#!/usr/bin/env python3
# 作物アイコン試作の見本ページ生成。
# 使い方：SVGを足す→manifest.jsonに1行追記→このスクリプトを実行（docs/design/crop-icons-draft で）。
# 「いま」の絵は ../../../src/lib/cropArt.js から名前で抜き出す（現物を写す＝手で貼らない）。
import json, re, os
HERE = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(HERE, "manifest.json")))
src = open(os.path.join(HERE, "../../../src/lib/cropArt.js"), encoding="utf-8").read()

def cur_svg(name, size):
    m = re.search(r'"%s"\s*:\s*\{\s*c\s*:\s*"([^"]+)"\s*,\s*d\s*:\s*\[(.*?)\]\s*\}' % re.escape(name), src, re.S)
    if not m:
        return '<span style="font-size:11px;color:#999">なし</span>'
    c = m.group(1)
    paths = []
    for d in re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(2)):
        if d.startswith("!"):
            paths.append('<path d="%s" fill="none" stroke="%s" stroke-width="14"/>' % (d[1:], c))
        else:
            paths.append('<path d="%s" fill="%s"/>' % (d, c))
    return '<svg width="%d" height="%d" viewBox="0 0 512 512">%s</svg>' % (size, size, "".join(paths))

def new_svg(entry, size):
    raw = open(os.path.join(HERE, entry["file"] + ".svg"), encoding="utf-8").read()
    return raw.replace('<svg ', '<svg width="%d" height="%d" ' % (size, size), 1)

cards = []
for e in manifest:
    cards.append(f'''
    <div class="card">
      <div class="big">{new_svg(e, 104)}</div>
      <div class="name">{e["name"]}</div>
      <div class="note">{e["note"]}</div>
      <div class="cmp">
        <div class="cell"><div class="lbl">いま</div><div class="chip">{cur_svg(e["name"], 32)}</div></div>
        <div class="cell"><div class="lbl">案</div><div class="chip">{new_svg(e, 32)}</div></div>
      </div>
    </div>''')

grid = "".join(
    f'<div class="pick"><div class="pick-ic">{new_svg(e, 40)}</div><div class="pick-nm">{e["name"]}</div></div>'
    for e in manifest)

html = f'''<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>作物アイコンの試作（{len(manifest)} / 50種）</title>
<style>
  body {{ margin:0; padding:24px 16px 48px; font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif; background:#F7F7F5; color:#222; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  .sub {{ font-size:13px; color:#717171; margin:0 0 20px; line-height:1.6; }}
  .cards {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; max-width:860px; }}
  .card {{ background:#fff; border:1px solid #E8E8E4; border-radius:16px; padding:16px 12px 12px; text-align:center; box-shadow:0 3px 10px rgba(0,0,0,0.06); }}
  .big svg {{ display:block; margin:0 auto; }}
  .name {{ font-weight:700; font-size:15px; margin-top:8px; }}
  .note {{ font-size:11px; color:#8A8A8A; margin-top:2px; min-height:2.6em; line-height:1.3; }}
  .cmp {{ display:flex; justify-content:center; gap:14px; border-top:1px dashed #E4E4DE; margin-top:8px; padding-top:8px; }}
  .cell {{ text-align:center; }}
  .chip {{ background:#F1F1EC; border-radius:10px; padding:5px; }}
  .chip svg {{ display:block; margin:0 auto; }}
  .lbl {{ font-size:10px; color:#9A9A9A; margin-bottom:3px; }}
  h2 {{ font-size:14px; margin:28px 0 8px; }}
  .grid {{ display:flex; gap:10px; flex-wrap:wrap; max-width:860px; }}
  .pick {{ width:92px; background:#fff; border:1.5px solid #E0E0DA; border-radius:14px; padding:12px 6px; text-align:center; }}
  .pick-ic svg {{ display:block; margin:0 auto 6px; }}
  .pick-nm {{ font-size:12px; font-weight:600; }}
  .foot {{ font-size:12px; color:#717171; margin-top:24px; max-width:860px; line-height:1.7; }}
</style></head><body>
<h1>作物アイコンの試作（{len(manifest)} / 50種）</h1>
<p class="sub">差し替え前の見本です（本番は従来どおり）。いま＝game-icons.net の単色シルエット／案＝自作のフルカラー（出典表示のいらない完全自作・同一トーン）。</p>
<div class="cards">{''.join(cards)}</div>
<h2>作物えらびカードでの見え方（イメージ）</h2>
<div class="grid">{grid}</div>
<p class="foot">色はサイトの役割カラー（緑 #00A86B 系）と喧嘩しない落ち着いたトーンでそろえています。</p>
</body></html>'''
open(os.path.join(HERE, "preview.html"), "w", encoding="utf-8").write(html)
print("preview.html rebuilt:", len(manifest), "icons")
