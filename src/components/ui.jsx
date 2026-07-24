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

// 危険項目の表示（詳細・確認・プレビュー共通・2026-07-16）：
// タイトル=写真の上・説明=写真の内部（1枚目にグラデ帯）・全て中央配置。写真なしは⚠️色ボックス内に説明
export function DangerItem({ icon, label, desc, photos, onPhotoClick }) {
  const list = (photos || []).map(p => (typeof p === "string" ? p : p?.url)).filter(Boolean);
  return (
    <div style={{ width:"100%" }}>
      <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:"0 0 8px", textAlign:"center", overflowWrap:"break-word" }}>{label}</p>
      {list.length > 0 ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {list.map((src, k) => (
            <div key={k} style={{ position:"relative", borderRadius:8, overflow:"hidden" }}>
              <img src={src} alt="" onClick={onPhotoClick ? () => onPhotoClick(src) : undefined} style={{ width:"100%", height:190, objectFit:"cover", display:"block", cursor: onPhotoClick ? "pointer" : "default" }} />
              {k === 0 && desc && String(desc).trim() && (
                <div className="f-sans" style={{ position:"absolute", bottom:0, left:0, right:0, padding:"26px 16px 12px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:13, fontWeight:600, textAlign:"center", lineHeight:1.6, boxSizing:"border-box" }}>{desc}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ width:"100%", minHeight:130, borderRadius:8, background:"#FEF3E2", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:"14px 16px", boxSizing:"border-box", textAlign:"center" }}>
          <span style={{ fontSize:40, lineHeight:1 }}>{icon}</span>
          {desc && String(desc).trim() && <p className="f-sans" style={{ fontSize:12, color:"#8A6D1D", margin:0, lineHeight:1.6, overflowWrap:"break-word" }}>{desc}</p>}
        </div>
      )}
    </div>
  );
}

// 共通アバター部品：写真あり→円形サムネ／写真なし→緑丸＋頭文字2字。
// 全画面（ヘッダー・応募者カード・チャット・求人詳細の紹介・プロフィール）でこれに統一する。
// ring（任意）：アイコンに役割色の枠を付ける（チャットで使用・働き手=橙／雇い手=緑・第11弾）
export const Avatar = ({ url, name, size = 40, ring, bg }) => {
  const ringStyle = ring ? { border: "2px solid " + ring, boxSizing: "border-box" } : {};
  return url
    ? <img src={url} alt="" width={size} height={size}
        style={{ width:size, height:size, borderRadius:"50%", objectFit:"cover", flexShrink:0, ...ringStyle }} />
    : <div style={{ width:size, height:size, borderRadius:"50%", background: bg || ring || "#00A86B",
        color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:size*0.38, fontWeight:700, flexShrink:0, ...ringStyle }}>
        {(name||"？").replace(/\s/g,"").slice(0,2)}
      </div>;
};
