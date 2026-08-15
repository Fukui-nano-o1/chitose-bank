// 完了の祝祭 v2（2026-08-06たきと指示「もっと過激で印象に残るように。参考元は委託ページ遷移」）
// 委託ページ入場演出（ConsignmentRoom）の視覚言語をそのまま借りる：
//   一瞬の暗幕 → 打ち上げの尾が昇る → 閃光 → 菊の光条の炸裂（本体・特大）→
//   絵文字が押印で叩き込まれ画面が揺れる → 追い花火4〜6発が続けざまに開く → 幕が引く
// 白い画面の上では白い花火は見えないso、委託の「黒幕」を敷いてから開く＝これが過激さの土台。
//
// 【法的リスク回避・絶対（v1から不変）】
// ・pointer-events:none＝操作を一切奪わない。自動で消える＝記録・ゲート・フローには触れない
// ・負の場面（見送り・欠勤・失効の記録）では使わないこと（祝ってはいけない）
// ・keyframesは使用箇所に同居（委託入場・HireStagePanelと同じ作法）
import { useEffect, useRef, useState } from "react";
import { fbCelebrate } from "../lib/feedback";
import { Avatar } from "./ui";

// 追い花火の抽選（委託入場の makeConsignGrass と同じ思想＝毎回違う夜空）。
// 1発＝閃光＋菊の光条（長短交互の光条＋先端の粒＝委託の炸裂SVGと同じ構造）
function makeShells() {
  const r = (min, max) => min + Math.random() * (max - min);
  const n = 4 + Math.floor(Math.random() * 3); // 4〜6発
  const colors = ["#FFFFFF", "#FFD54F", "#8CE99A", "#FFFFFF", "#FFD54F"];
  return Array.from({ length: n }, (_, i) => ({
    left: +r(10, 90).toFixed(1),                 // 炸裂点の横位置%
    top: +r(12, 78).toFixed(1),                  // 縦位置%
    size: Math.round(r(140, 260)),               // 炸裂の直径px
    rays: 16 + Math.floor(Math.random() * 8) * 2, // 光条16〜30
    spin: Math.round(r(0, 22)),
    delay: +(0.65 + i * r(0.14, 0.22)).toFixed(2), // 本体の炸裂(0.45s)の後に続けざま
    dur: +r(0.8, 1.05).toFixed(2),
    color: colors[i % colors.length],
  }));
}

// 菊の光条（委託の consign-fw-burst のSVGと同じ描き方：長短交互＋先端の粒）
function BurstSVG({ rays, spin, color, stroke = 1 }) {
  return (
    <svg viewBox="-100 -100 200 200" style={{ width:"100%", height:"100%", display:"block", overflow:"visible" }}>
      <g transform={`rotate(${spin})`}>
        {Array.from({ length: rays }, (_, j) => {
          const long = j % 2 === 0;
          const tip = long ? -94 : -74;
          return (
            <g key={j} transform={`rotate(${(360 / rays) * j})`}>
              <line x1="0" y1="-14" x2="0" y2={tip + 8} stroke={color} strokeWidth={(long ? 3.2 : 2.2) * stroke} strokeLinecap="round" opacity=".9" />
              <circle cx="0" cy={tip} r={(long ? 4.2 : 3) * stroke} fill={color} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// 応募の祝祭ビジュアル（2026-08-07たきと指示「応募できましたはアイコン削除。求職者アイコン→求人カードにする」）。
// 絵文字の代わりに Celebration の custom に渡して押印させる。★Celebrationの中でだけ使う
// （矢印の脈動 cbFb2Arrow のkeyframesは Celebration の<style>にある）。
// avatar/name＝応募した働き手、photo/crop/task/city＝応募先の求人カード（写真なしは🌾の下地）
export function ApplyCelebrationVisual({ avatar, name, photo, crop, task, city }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
      <div style={{ borderRadius:"50%", flexShrink:0, boxShadow:"0 0 0 3px #fff, 0 10px 30px rgba(0,0,0,.5)" }}>
        <Avatar url={avatar || null} name={name || "？"} size={72} />
      </div>
      <span aria-hidden="true" style={{ fontSize:34, fontWeight:900, color:"#fff", textShadow:"0 2px 12px rgba(0,0,0,.6)",
        animation:"cbFb2Arrow 0.9s ease-in-out .95s infinite" }}>→</span>
      <div style={{ width:150, flexShrink:0, background:"#fff", borderRadius:14, overflow:"hidden", boxShadow:"0 10px 30px rgba(0,0,0,.5)" }}>
        {photo
          ? <img src={photo} alt="" style={{ width:"100%", height:88, objectFit:"cover", display:"block" }} />
          : <div style={{ width:"100%", height:88, background:"#E6F7EF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }} aria-hidden="true">🌾</div>}
        <div style={{ padding:"8px 10px 10px" }}>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[crop, task].filter(Boolean).join(" ") || "求人"}</p>
          {city && <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"2px 0 0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{city}</p>}
        </div>
      </div>
    </div>
  );
}

// custom＝押印スロットに絵文字の代わりに差し込むJSX（応募のアイコン→求人カード等）。無指定なら従来どおり絵文字
export function Celebration({ emoji = "🎉", title = "", duration = 3000, custom = null, onDone }) {
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  const [shells] = useState(makeShells); // マウント時に1回だけ抽選（再レンダーで夜空が変わらない）
  useEffect(() => {
    fbCelebrate();
    const t = setTimeout(() => onDoneRef.current?.(), duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const out = ((duration - 450) / 1000).toFixed(2) + "s"; // 幕が引き始める時刻
  return (
    <div style={{ position:"fixed", inset:0, zIndex:12000, pointerEvents:"none", overflow:"hidden" }}>
      <style>{`
        /* 暗幕：一瞬で落ち、終わりに引く（委託の幕の借用。ここは開閉でなくフェード＝1枚幕） */
        @keyframes cbFb2Dim   { from { opacity:0; } to { opacity:1; } }
        @keyframes cbFb2Out   { from { opacity:1; } to { opacity:0; } }
        /* 打ち上げの尾：画面下から中央へ昇って消える（consign-fw-trail と同じ呼吸） */
        @keyframes cbFb2Rise  { 0% { transform:translate(-50%, 46vh); opacity:0; }
                                12% { opacity:1; } 88% { opacity:1; }
                                100% { transform:translate(-50%, 0); opacity:0; } }
        /* 芯の閃光：炸裂の瞬間だけ強く光る（consign-fw-flash） */
        @keyframes cbFb2Flash { 0% { transform:translate(-50%,-50%) scale(.1); opacity:1; }
                                100% { transform:translate(-50%,-50%) scale(1.9); opacity:0; } }
        /* 炸裂：開くほど減速して消える（consign-fw-burst） */
        @keyframes cbFb2Burst { 0% { transform:translate(-50%,-50%) scale(0); opacity:0; }
                                10% { opacity:1; } 55% { opacity:.95; }
                                100% { transform:translate(-50%,-50%) scale(1.08); opacity:0; } }
        /* 押印：特大で叩き込まれて弾む */
        @keyframes cbFb2Stamp { 0% { transform:scale(3.2); opacity:0; }
                                45% { transform:scale(.88); opacity:1; }
                                70% { transform:scale(1.12); } 100% { transform:scale(1); opacity:1; } }
        /* 画面の揺れ：押印の衝撃（overlay内だけ揺らす＝ページ本体は動かさない） */
        @keyframes cbFb2Shake { 0%,100% { transform:translate(0,0); } 15% { transform:translate(-7px,4px); }
                                30% { transform:translate(6px,-5px); } 45% { transform:translate(-4px,-3px); }
                                60% { transform:translate(4px,3px); } 75% { transform:translate(-2px,2px); } }
        @keyframes cbFb2Title { 0% { transform:translateY(18px) scale(.7); opacity:0; }
                                60% { transform:translateY(0) scale(1.06); opacity:1; }
                                100% { transform:translateY(0) scale(1); opacity:1; } }
        /* 応募ビジュアルの矢印：働き手→求人カードへ流れる脈動（ApplyCelebrationVisualが使う） */
        @keyframes cbFb2Arrow { 0%,100% { transform:translateX(-5px); opacity:.55; }
                                50% { transform:translateX(5px); opacity:1; } }
      `}</style>
      {/* 暗幕（0.18sで落ちる→終わりで引く）。花火が見えるのはこの闇があるから */}
      <div style={{ position:"absolute", inset:0, background:"rgba(8,10,8,.82)",
        animation:`cbFb2Dim .18s ease-out both, cbFb2Out .45s ease-in ${out} both` }} />
      {/* 以降ぜんぶ暗幕の上。全体も幕と一緒に引く */}
      <div style={{ position:"absolute", inset:0, animation:`cbFb2Out .45s ease-in ${out} both` }}>
        {/* 打ち上げの尾（画面下→中央・0.45sで到達） */}
        <div style={{ position:"absolute", left:"50%", top:"44%", width:4, height:64, borderRadius:3,
          background:"linear-gradient(to top, rgba(255,255,255,0), #fff)",
          animation:"cbFb2Rise .45s cubic-bezier(.15,.6,.4,1) both" }} />
        {/* 本体の炸裂（特大・中央）：閃光＋菊の光条 */}
        <div style={{ position:"absolute", left:"50%", top:"44%", width:"min(92vw, 500px)", height:"min(92vw, 500px)", borderRadius:"50%",
          background:"radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,255,255,.4) 38%, rgba(255,255,255,0) 70%)",
          animation:"cbFb2Flash .5s ease-out .45s both" }} />
        <div style={{ position:"absolute", left:"50%", top:"44%", width:"min(92vw, 500px)", height:"min(92vw, 500px)",
          animation:"cbFb2Burst 1.05s cubic-bezier(.12,.75,.3,1) .45s both" }}>
          <BurstSVG rays={24} spin={8} color="#fff" stroke={1.2} />
        </div>
        {/* 追い花火（4〜6発・毎回違う位置と色で続けざま） */}
        {shells.map((sh, i) => (
          <div key={i} style={{ position:"absolute", left: sh.left + "%", top: sh.top + "%", width:0, height:0 }}>
            <div style={{ position:"absolute", width: sh.size, height: sh.size, borderRadius:"50%",
              background:"radial-gradient(circle, rgba(255,255,255,.9) 0%, rgba(255,255,255,.35) 38%, rgba(255,255,255,0) 70%)",
              animation:`cbFb2Flash .45s ease-out ${sh.delay}s both` }} />
            <div style={{ position:"absolute", width: sh.size, height: sh.size,
              animation:`cbFb2Burst ${sh.dur}s cubic-bezier(.12,.75,.3,1) ${sh.delay}s both` }}>
              <BurstSVG rays={sh.rays} spin={sh.spin} color={sh.color} />
            </div>
          </div>
        ))}
        {/* 押印の絵文字＋題字（炸裂と同時に叩き込む・overlay内だけ揺れる） */}
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          animation:"cbFb2Shake .5s ease-out .45s both" }}>
          {custom ? (
            <div style={{ animation:"cbFb2Stamp .55s cubic-bezier(.2,1.5,.4,1) .45s both" }}>{custom}</div>
          ) : (
            <span style={{ fontSize:"min(38vw, 170px)", lineHeight:1, animation:"cbFb2Stamp .55s cubic-bezier(.2,1.5,.4,1) .45s both",
              filter:"drop-shadow(0 10px 30px rgba(0,0,0,.5))" }}>{emoji}</span>
          )}
          {title && (
            <p className="f-sans" style={{ margin:"18px 0 0", fontSize:"min(7vw, 30px)", fontWeight:900, color:"#fff",
              letterSpacing:".04em", textShadow:"0 2px 18px rgba(0,0,0,.6)",
              animation:"cbFb2Title .5s cubic-bezier(.2,1.4,.4,1) .75s both" }}>{title}</p>
          )}
        </div>
      </div>
    </div>
  );
}
