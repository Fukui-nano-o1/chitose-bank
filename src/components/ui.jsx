// 汎用UIアトム（分割・段階2後半・2026-07-24）：リボン帯・長文の省略表示。
import { useState } from "react";

// メルカリSOLD風の斜めリボン（写真の右上角）。農家の求人一覧の状態表示（作成中/審査中/公開中）
export function StatusRibbon({ label, color }) {
  return (
    <div style={{ position:"absolute", top:0, right:0, width:64, height:64, overflow:"hidden", pointerEvents:"none" }}>
      <span className="f-sans" style={{ position:"absolute", top:12, right:-30, transform:"rotate(45deg)", width:110, textAlign:"center", background:color, color:"#fff", fontSize:10, fontWeight:800, padding:"3px 0", boxShadow:"0 1px 4px rgba(0,0,0,0.25)" }}>{label}</span>
    </div>
  );
}

// 左上帯（新着用・2026-07-16）：StatusRibbonの左右反転版。白文字・赤帯で使用
export function StatusRibbonLeft({ label, color }) {
  return (
    <div style={{ position:"absolute", top:0, left:0, width:64, height:64, overflow:"hidden", pointerEvents:"none", zIndex:2 }}>
      <span className="f-sans" style={{ position:"absolute", top:12, left:-30, transform:"rotate(-45deg)", width:110, textAlign:"center", background:color, color:"#fff", fontSize:10, fontWeight:800, padding:"3px 0", boxShadow:"0 1px 4px rgba(0,0,0,0.25)" }}>{label}</span>
    </div>
  );
}

// 長文プレビュー：…で省略し、該当要素のタップで全文表示（雇い手/働き手プレビューの自己紹介など・2026-07-23）。
// 親がボタン（カード全体タップ）でも展開できるよう、クリックは伝播を止める。
export function ExpandableText({ text, limit = 100, style }) {
  const [open, setOpen] = useState(false);
  const s = (text == null ? "" : String(text));
  if (!s) return null;
  const truncated = s.length > limit;
  return (
    <p
      onClick={truncated ? (e) => { e.stopPropagation(); e.preventDefault(); setOpen(v => !v); } : undefined}
      role={truncated ? "button" : undefined}
      className="f-sans"
      style={{ whiteSpace:"pre-wrap", ...style, ...(truncated ? { cursor:"pointer" } : {}) }}
    >
      {open || !truncated ? s : s.slice(0, limit) + "…"}
      {truncated && <span style={{ color:"#00A86B", fontWeight:700 }}>{open ? "　閉じる" : "　もっと見る"}</span>}
    </p>
  );
}
