// 完了の画面（2026-09-02たきと指示「全てAirbnbをパクれ」＝花火の祝祭アニメ（Celebration）を全廃し、
// 掲載完了（PublishDone）と同じ器に揃えた）。
// 【型＝Airbnbの完了画面（Request sent／Thanks for your review／Publish celebration・コードは流用しない・構成だけ）】
//   白い全画面 → 大きな題名 → 一言 → つぎに起きること（アイコン＋太字＋灰色）→ 中身（求人カード等）→
//   小さな注記（法的な一言）→ 下部固定の黒い主ボタン（＋下線の副リンク）。
//   利用者の選択を待つ（自動では消えない・自動で別のページへも送らない）。
// ・data-takeover＝この画面の説明（PageGuide）が下の画面へ自動表示しない目印
// ・cb-lock-scroll＝背後のスクロールと下部バー・浮遊ボタンを止める（FinalReviewSheet・HireConfirm と同じ器）
// ・rows は PageGuide／StageBoxBody と同じ言語＝画面ごとに行の見た目を作らない
import { NavIcon } from "./NavIcons";

export function DoneScreen({ title, lead, rows = [], note, children, primary, secondary, takeover = "done" }) {
  return (
    <div data-takeover={takeover} className="cb-lock-scroll f-sans" style={{ position:"fixed", inset:0, zIndex:11000, background:"#fff", display:"flex", flexDirection:"column" }}>
      <div style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"calc(56px + env(safe-area-inset-top, 0px)) 24px 24px" }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>
          <h2 className="f-sans" style={{ fontSize:28, fontWeight:800, color:"#222", lineHeight:1.3, margin:"0 0 12px", letterSpacing:"-0.01em" }}>{title}</h2>
          {lead && <p className="f-sans" style={{ fontSize:16, color:"#717171", lineHeight:1.8, margin:"0 0 24px" }}>{lead}</p>}
          {rows.length > 0 && (
            <div style={{ display:"grid", gap:18, margin:"0 0 24px" }}>
              {rows.map((r) => (
                <div key={r.t} style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                  <span style={{ flexShrink:0, color:"#222", marginTop:1 }}><NavIcon name={r.icon} size={28} /></span>
                  <span style={{ minWidth:0 }}>
                    <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:700, color:"#222", lineHeight:1.5 }}>{r.t}</span>
                    {r.d && <span className="f-sans" style={{ display:"block", fontSize:14, color:"#717171", lineHeight:1.7, marginTop:2 }}>{r.d}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
          {children}
          {note && <p className="f-sans" style={{ fontSize:12, color:"#999", lineHeight:1.7, margin:"20px 0 0" }}>{note}</p>}
          {secondary && (
            <button onClick={secondary.onClick} className="f-sans" style={{ display:"block", margin:"18px auto 0", background:"none", border:"none", padding:"6px 2px", fontSize:15, fontWeight:700, color:"#222", textDecoration:"underline", cursor:"pointer" }}>{secondary.label}</button>
          )}
        </div>
      </div>
      <div style={{ flexShrink:0, borderTop:"1px solid #EBEBEB", padding:"14px 24px calc(14px + env(safe-area-inset-bottom, 0px))", background:"#fff" }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>
          <button onClick={primary?.onClick} className="f-sans" style={{ width:"100%", padding:"15px", fontSize:16, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:8, cursor:"pointer" }}>{primary?.label || "完了"}</button>
        </div>
      </div>
    </div>
  );
}
