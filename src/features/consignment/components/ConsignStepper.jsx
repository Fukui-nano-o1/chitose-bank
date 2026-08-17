// 委託の進行ステッパー。第2次構造改革2026-08-17で ConsignmentRoom.jsx から分離・中身は不変。
import { CONSIGN_STEPS, consignStepState } from "../model";

// 進行ステッパー（FlowBarと同じ視覚文法。色だけブラック：黒の✓＝完了・黒リング＝現在地・グレー＝未着手）
export function ConsignStepper({ deal }) {
  const { done, active } = consignStepState(deal);
  return (
    <div style={{ display:"flex", alignItems:"flex-start", margin:"4px 0 18px" }}>
      {CONSIGN_STEPS.map((s, i) => {
        const isDone = done[i]; const isActive = i === active; const reached = isDone || isActive;
        return (
          <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
            {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? "#111111" : "#E5E5E5" }} />}
            <div style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, boxSizing:"border-box",
              background: isDone ? "#111111" : "#fff", border: isDone ? "none" : isActive ? "2px solid #111111" : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? "#111111" : "#C8C8C8" }}>
              {isDone ? "✓" : ""}
            </div>
            <span className="f-sans" style={{ fontSize:9.9, marginTop:4, lineHeight:1.2, textAlign:"center", color: reached ? "#111111" : "#B0B0B0", fontWeight: isActive ? 700 : 500 }}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}
