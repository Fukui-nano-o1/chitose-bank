// 完了の祝祭（2026-08-06・赤ちゃん前提の第0歩）
// 採用アニメ（TodayPage HireStagePanel・2026-08-06実装＝サイトで一番正しい画面）の型の共有版。
// 「押した→世界thatが喜んだ」という因果を、文字を読まずに身体で受け取れるようにする。
//
// 【法的リスク回避・絶対】
// ・pointer-events:none＝操作を一切奪わない。表示は自動で消える＝記録・ゲート・フローには触れない
//   （純粋な演出。法定表示・同意・確認の手続きの上に何も被せない・何も省かせない）
// ・負の場面（見送り・欠勤・失効の記録）では使わないこと（祝ってはいけない）
// ・keyframesは使用箇所に同居（NewApplicantsPanel・HireStagePanelと同じ作法）
import { useEffect, useRef } from "react";
import { fbCelebrate } from "../lib/feedback";

const PETALS = ["🌾", "✨", "🌸", "🍃", "✨", "🌾"];
const PETAL_DX = [-90, 70, -50, 95, -110, 40];
const PETAL_DY = [-110, -90, 80, -40, 30, -130];
const PETAL_ROT = [-40, 60, -80, 30, 50, -20];

export function Celebration({ emoji = "🎉", title = "", duration = 2200, onDone }) {
  // onDoneは親の再レンダーで作り直されるso、refに逃がして「マウント時に1回だけ」を保証
  // （依存に入れるとタイマーthatが延長され続け、いつまでも消えない）
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  useEffect(() => {
    fbCelebrate();
    const t = setTimeout(() => onDoneRef.current?.(), duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ position:"fixed", inset:0, zIndex:12000, pointerEvents:"none", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{`
        @keyframes cbFbStamp { 0% { transform:scale(.2); opacity:0; } 55% { transform:scale(1.25); opacity:1; } 100% { transform:scale(1); opacity:1; } }
        @keyframes cbFbRing  { from { transform:scale(.4); opacity:.7; } to { transform:scale(2.4); opacity:0; } }
        @keyframes cbFbPetal { 0% { transform:translate(0,0) scale(.6) rotate(0deg); opacity:0; } 15% { opacity:1; } 100% { transform:translate(var(--dx), var(--dy)) scale(1.1) rotate(var(--rot)); opacity:0; } }
        @keyframes cbFbFade  { from { opacity:1; } to { opacity:0; } }
      `}</style>
      <div style={{ position:"relative", display:"flex", flexDirection:"column", alignItems:"center", animation:`cbFbFade .3s ease ${(duration - 300) / 1000}s forwards` }}>
        <span style={{ position:"absolute", top:"50%", left:"50%", width:120, height:120, margin:"-60px 0 0 -60px", borderRadius:"50%", border:"3px solid #00A86B", animation:"cbFbRing 1s ease-out .1s both" }} />
        {PETALS.map((p, i) => (
          <span key={i} style={{
            position:"absolute", top:"40%", left:"50%", fontSize:26,
            "--dx": PETAL_DX[i] + "px", "--dy": PETAL_DY[i] + "px", "--rot": PETAL_ROT[i] + "deg",
            animation:`cbFbPetal 1.5s ease-out ${0.12 + i * 0.05}s both`,
          }}>{p}</span>
        ))}
        <span style={{ fontSize:88, lineHeight:1, animation:"cbFbStamp .5s cubic-bezier(.2,1.6,.4,1) both", filter:"drop-shadow(0 6px 18px rgba(0,0,0,.18))" }}>{emoji}</span>
        {title && <p className="f-sans" style={{ marginTop:14, fontSize:20, fontWeight:800, color:"#00A86B", background:"rgba(255,255,255,.92)", borderRadius:14, padding:"6px 18px", animation:"cbFbStamp .5s .15s both", margin:"14px 0 0" }}>{title}</p>}
      </div>
    </div>
  );
}
