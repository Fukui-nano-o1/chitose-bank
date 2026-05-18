import { createClient } from "@supabase/supabase-js";
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

import { useState, useEffect, useCallback, useRef } from "react";
import Terms from "./Terms.jsx";

// ══════════════════════════════════════════════════════════
// DESIGN SYSTEM — 「台帳の美学」
// 和紙と墨、金泥で書かれた帳簿を現代に翻訳する
// ══════════════════════════════════════════════════════════
const C = {
  // ── New design system ──
  bg:           "#FFFFFF",
  bgSoft:       "#F7F7F7",
  card:         "#FFFFFF",
  text:         "#222222",
  textSub:      "#717171",
  textLight:    "#B0B0B0",
  border:       "#EBEBEB",
  accent:       "#00A86B",
  accentLight:  "#E6F7EF",
  danger:       "#E24B4A",
  dangerLight:  "#FCEBEB",
  warning:      "#F5A623",
  warningLight: "#FEF3E2",
  // ── Semantic aliases (backwards compat) ──
  gold:    "#F5A623",
  goldLt:  "#F7B84B",
  goldPl:  "#FEF3E2",
  goldDim: "#B87A1A",
  bamboo:  "#00A86B",
  bambooL: "#2DC28A",
  bambooPl:"#E6F7EF",
  shu:     "#E24B4A",
  shuPl:   "#FCEBEB",
  ink:     "#222222",
  mid:     "#717171",
  dim:     "#717171",
  ghost:   "#B0B0B0",
  rule:    "#EBEBEB",
  ruleD:   "#EBEBEB",
  // ── Deprecated dark colors → light equivalents ──
  void:    "#F7F7F7",
  deep:    "#FFFFFF",
  bark:    "#222222",
  shadow:  "#F7F7F7",
  washi:   "#FFFFFF",
  cream:   "#FFFFFF",
  ivory:   "#F7F7F7",
  pale:    "#F7F7F7",
};

const DEST_INK = ["#2D5A1B","#1A3F6B","#7A3D10","#5C3080","#8B2518","#1A5E5E","#55610F","#6B3A18"];

// 農家データ（PINなし・メール認証のみ）
const SEED_FARMERS = [];
const SEED_DESTS = [];

const THIS_YEAR   = 2025;
const ADMIN_EMAIL = "t5fki6643qty@gmail.com";
const MONTHS    = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

async function sGet(k){try{const r=await window.storage.get(k,true);return r?JSON.parse(r.value):null;}catch{return null;}}
async function sSet(k,v){try{await window.storage.set(k,JSON.stringify(v),true);}catch{}};

const cn  = n => Math.round(n).toLocaleString("ja-JP");
const man = n => { const a=Math.abs(n); return a>=10000?(Math.round(a/1000)/10).toFixed(1)+"万":cn(a); };
function uid(){ return Math.random().toString(36).slice(2,9); }
function destColor(name){ if(!name)return"#888"; let h=0; for(const c of name) h=(h*37+c.charCodeAt(0))>>>0; return DEST_INK[h%DEST_INK.length]; }

// ── CSS ────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Inter:wght@300;400;500;600;700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; background: #fff; }
body { background: #fff; }

::-webkit-scrollbar { width: 2px; height: 2px; }
::-webkit-scrollbar-thumb { background: #EBEBEB; border-radius: 1px; }
::-webkit-scrollbar-track { background: transparent; }

.filter-scroll::-webkit-scrollbar { display: none; }

/* ── Print ── */
@media print {
  header, footer, .bottom-tab-bar, .no-print { display: none !important; }
  main { padding: 0 !important; max-width: 100% !important; }
  body, html { background: #fff !important; }
  .ledger-card { box-shadow: none !important; border: 1px solid #EBEBEB !important; }
}

.f-serif { font-family: 'Noto Sans JP', 'Inter', sans-serif; font-weight: 700; }
.f-sans  { font-family: 'Noto Sans JP', 'Inter', sans-serif; }
.f-mono  { font-family: 'DM Mono', 'Courier New', monospace; }

button, input, select { font-family: 'Noto Sans JP', 'Inter', sans-serif; }
button { cursor: pointer; transition: all .2s ease; }
button:active { transform: scale(.97); }
input:focus { outline: none; }

/* ── Entrance animations ── */
@keyframes appear {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
@keyframes pulse {
  0%,100% { opacity: 1; }
  50%      { opacity: .35; }
}
@keyframes shake {
  0%,100% { transform: translateX(0); }
  25%      { transform: translateX(-7px); }
  75%      { transform: translateX(7px); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.appear      { animation: appear .5s cubic-bezier(.22,.8,.36,1) both; }
.fade-in     { animation: fadeIn .35s ease both; }
.pulse-slow  { animation: pulse 2s ease infinite; }
.shake       { animation: shake .4s ease; }

/* staggered children */
.stagger > *:nth-child(1) { animation-delay: 0s; }
.stagger > *:nth-child(2) { animation-delay: .08s; }
.stagger > *:nth-child(3) { animation-delay: .16s; }
.stagger > *:nth-child(4) { animation-delay: .24s; }
.stagger > *:nth-child(5) { animation-delay: .32s; }

/* ── Ledger card ── */
.ledger-card {
  background: #FFFFFF;
  border: 1px solid #EBEBEB;
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05);
  position: relative;
  overflow: hidden;
}
.ledger-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, #00A86B44, transparent);
  opacity: 0;
  transition: opacity .3s;
}
.ledger-card:hover::before { opacity: 1; }

/* ── Ghost / skeleton ── */
.ghost-line {
  background: linear-gradient(90deg, #F7F7F7 25%, #EBEBEB 50%, #F7F7F7 75%);
  background-size: 200% 100%;
  animation: shimmer 2s ease infinite;
  border-radius: 4px;
}

/* ── Nav underline ── */
.nav-item { position: relative; }
.nav-item::after {
  content: '';
  position: absolute;
  bottom: -1px; left: 50%; right: 50%;
  height: 2px;
  background: #00A86B;
  transition: left .25s ease, right .25s ease;
  border-radius: 2px;
}
.nav-item.active::after { left: 0; right: 0; }

/* ── Bottom tab bar (mobile) ── */
.bottom-tab-bar {
  display: none;
}
@media (max-width: 640px) {
  .bottom-tab-bar {
    display: flex;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: #FFFFFF;
    border-top: 1px solid #EBEBEB;
    z-index: 100;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .bottom-tab-bar button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 4px 6px;
    border: none;
    background: transparent;
    font-size: 9px;
    font-family: 'Noto Sans JP', sans-serif;
    gap: 3px;
    cursor: pointer;
    color: #B0B0B0;
  }
  .bottom-tab-bar button.active { color: #00A86B; }
  .bottom-tab-bar button span.icon { font-size: 20px; line-height: 1; }
  /* Hide desktop header nav on mobile */
  header nav { display: none !important; }
  header { padding: 0 16px !important; height: 52px !important; }
  main { padding: 16px 12px 90px !important; }
  .ledger-card { padding: 16px !important; }
}

/* ── Input ── */
.field {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid #EBEBEB;
  border-radius: 12px;
  font-size: 14px;
  color: #222222;
  background: #FFFFFF;
  transition: border-color .2s, box-shadow .2s;
}
.field:focus {
  border-color: #00A86B;
  box-shadow: 0 0 0 3px #00A86B18;
}
.field::placeholder { color: #B0B0B0; }

/* ── Mobile responsive ── */
@media (max-width: 640px) {
  .hero-row { flex-direction: column !important; }
  .hero-cta { flex-direction: column !important; }
  .hero-cta button { width: 100% !important; }
  .how-to-grid { flex-direction: column !important; }
  .farmer-3cols { grid-template-columns: 1fr !important; }
}

/* ── Buttons ── */
.btn-primary, .btn-dark {
  background: #00A86B;
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 13px 24px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .02em;
}
.btn-primary:hover, .btn-dark:hover { background: #009960; }
.btn-primary:disabled, .btn-dark:disabled { opacity: .35; cursor: not-allowed; transform: none; }

.btn-outline {
  background: transparent;
  color: #222222;
  border: 1px solid #222222;
  border-radius: 12px;
  padding: 12px 20px;
  font-size: 13px;
  font-weight: 500;
}
.btn-outline:hover { background: #F7F7F7; }

.btn-gold {
  background: #F5A623;
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 13px 24px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .02em;
}
.btn-gold:hover { background: #F7B84B; }
.btn-gold:disabled { background: #EBEBEB; color: #B0B0B0; cursor: not-allowed; transform: none; }

/* ── Label ── */
.lbl {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: #717171;
  margin-bottom: 7px;
}

/* ── Rule with text ── */
.rule-text {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #B0B0B0;
  font-size: 10px;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.rule-text::before, .rule-text::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #EBEBEB;
}

/* ── Tag ── */
.tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
}
`;

// ── BalanceSheet ────────────────────────────────────────────
function BalanceSheet({ revenue, costs, compact = false }) {
  const [open, setOpen] = useState(false);
  const items = costs || [];
  const totalCost = items.reduce((s, c) => s + (c.a || 0), 0);
  const profit = revenue - totalCost;
  const isLoss = profit < 0;
  const costRate = revenue > 0 ? Math.round(totalCost / revenue * 100) : 0;
  const profRate = 100 - costRate;
  const maxItem = Math.max(...items.map(c => c.a || 0), 1);
  const h = compact ? 20 : 28;

  if (revenue === 0) return (
    <div style={{ padding:"12px 0", textAlign:"center" }}>
      <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0" }}>データなし</p>
    </div>
  );

  return (
    <div>
      {/* 売上バー */}
      <div style={{ height:h, background:"#00A86B", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:6 }}>
        <span className="f-sans" style={{ fontSize: compact ? 9 : 11, color:"#fff", fontWeight:600 }}>売上 {man(revenue)}</span>
      </div>

      {/* 利益・経費の積み上げバー */}
      <div style={{ display:"flex", height:h, borderRadius:8, overflow:"hidden" }}>
        {isLoss ? (
          <div style={{ flex:1, background:"#E24B4A", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span className="f-sans" style={{ fontSize: compact ? 8 : 9, color:"#fff", fontWeight:600 }}>赤字 {man(Math.abs(profit))}</span>
          </div>
        ) : (
          <>
            <div style={{ width:`${profRate}%`, minWidth:0, background:"#00A86B", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
              {profRate >= 22 && <span className="f-sans" style={{ fontSize: compact ? 8 : 9, color:"#fff", fontWeight:600, whiteSpace:"nowrap", padding:"0 3px" }}>利益 {man(profit)}（{profRate}%）</span>}
            </div>
            <div style={{ width:`${costRate}%`, minWidth:0, background:"#F5A623", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
              {costRate >= 22 && <span className="f-sans" style={{ fontSize: compact ? 8 : 9, color:"#fff", fontWeight:600, whiteSpace:"nowrap", padding:"0 3px" }}>経費 {man(totalCost)}（{costRate}%）</span>}
            </div>
          </>
        )}
      </div>

      {/* 経費内訳展開ボタン（compactでない場合のみ） */}
      {!compact && items.length > 0 && (
        <div>
          <button onClick={() => setOpen(o => !o)} style={{
            width:"100%", marginTop:8, padding:"7px 12px",
            background:"transparent", border:"1px solid #EBEBEB",
            borderRadius:8, fontFamily:"inherit",
            fontSize:11, color:"#717171", cursor:"pointer",
            display:"flex", justifyContent:"space-between", alignItems:"center",
          }}>
            <span>経費の内訳を見る</span>
            <span style={{ transition:"transform 0.3s", display:"inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
          </button>
          <div style={{ overflow:"hidden", maxHeight: open ? "600px" : "0", transition:"max-height 0.3s ease" }}>
            <div style={{ paddingTop:12 }}>
              {items.map((c, i) => {
                const w = Math.round((c.a || 0) / maxItem * 100);
                return (
                  <div key={c.l + i} style={{ display:"grid", gridTemplateColumns:"80px 1fr 56px", alignItems:"center", gap:8, marginBottom:8 }}>
                    <span className="f-sans" style={{ fontSize:11, color:"#717171", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.l}</span>
                    <div style={{ height:8, background:"#F7F7F7", borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:8, width:`${w}%`, background:"#F5A623", borderRadius:4 }}/>
                    </div>
                    <span className="f-mono" style={{ fontSize:11, color:"#F5A623", fontWeight:600, textAlign:"right" }}>{man(c.a || 0)}</span>
                  </div>
                );
              })}
              <div style={{ borderTop:"2px solid #EBEBEB", paddingTop:8, marginTop:4, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#222" }}>合計</span>
                <div style={{ display:"flex", gap:8, alignItems:"baseline" }}>
                  <span className="f-mono" style={{ fontSize:13, fontWeight:700, color:"#F5A623" }}>{man(totalCost)}</span>
                  <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>売上の{costRate}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Atoms ──────────────────────────────────────────────────
function DestMark({ name, sz=32, showLabel=true }) {
  const col = destColor(name);
  const ch  = name?.match(/[\u4E00-\u9FFF]/)?.[0] || name?.[0] || "?";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
      <span style={{
        width:sz, height:sz, borderRadius:"50%",
        background:`${col}16`, border:`1.5px solid ${col}`,
        display:"inline-flex", alignItems:"center", justifyContent:"center",
        fontSize:sz*.4, flexShrink:0,
        fontFamily:"'Shippori Mincho B1',serif", fontWeight:700,
        color:col,
      }}>{ch}</span>
      {showLabel && (
        <span className="f-sans" style={{ fontSize:Math.max(11,sz*.34), color:C.ink, fontWeight:500 }}>{name}</span>
      )}
    </span>
  );
}

// ── FarmerCard — アコーディオン農家カード ────────────────────
function FarmerCard({ farmer, fi, records, destMap }) {
  const [open, setOpen] = useState(false);

  const mRecs    = MONTHS.map((_,i) => records[`${farmer.id}_${THIS_YEAR}_${i}`] || []);
  const allFRecs = mRecs.flat();
  const fRev     = allFRecs.reduce((s,e) => s+e.boxes*e.ppb, 0);
  const fCst     = allFRecs.reduce((s,e) => s+e.costs.reduce((a,c)=>a+c.a,0), 0);
  const fProfit  = fRev - fCst;
  const cstRatio = fRev>0 ? Math.round(fCst/fRev*100) : 0;
  const pftRatio = fRev>0 ? Math.round(Math.max(0,fProfit)/fRev*100) : 0;
  const usedDsts = [...new Set(allFRecs.map(e=>e.destId))].map(id=>destMap[id]).filter(Boolean);

  const cLabels = {};
  allFRecs.forEach(e => e.costs.forEach(c => { if(c.l) cLabels[c.l]=(cLabels[c.l]||0)+c.a; }));
  const cList = Object.entries(cLabels).sort((a,b)=>b[1]-a[1]);

  const byDest = {};
  allFRecs.forEach(e => {
    if (!byDest[e.destId]) byDest[e.destId]={boxes:0,rev:0,cost:0};
    byDest[e.destId].boxes += e.boxes;
    byDest[e.destId].rev   += e.boxes*e.ppb;
    byDest[e.destId].cost  += e.costs.reduce((a,c)=>a+c.a,0);
  });

  const years = THIS_YEAR - farmer.joinedYear + 1;
  const badgeColor = years<=2 ? C.shu   : years<=4 ? C.gold   : C.bamboo;
  const badgeBg    = years<=2 ? C.shuPl : years<=4 ? C.goldPl : C.bambooPl;

  const monthlyRev = MONTHS.map((_,i) => (records[`${farmer.id}_${THIS_YEAR}_${i}`]||[]).reduce((s,e)=>s+e.boxes*e.ppb,0));
  const monthlyCst = MONTHS.map((_,i) => (records[`${farmer.id}_${THIS_YEAR}_${i}`]||[]).reduce((s,e)=>s+e.costs.reduce((a,c)=>a+c.a,0),0));

  const svgW=400, svgH=120, padL=44, padR=16, padT=12, padB=28;
  const chartW=svgW-padL-padR, chartH=svgH-padT-padB;
  const maxVal=Math.max(...monthlyRev,...monthlyCst,1);
  const toX=i=>padL+i*(chartW/(MONTHS.length-1));
  const toY=v=>padT+chartH-(v/maxVal*chartH);
  const pts=arr=>arr.map((v,i)=>`${toX(i)},${toY(v)}`).join(" ");

  const hasChart = monthlyRev.some(v=>v>0)||monthlyCst.some(v=>v>0);

  return (
    <div className="appear" style={{ animationDelay:`${fi*.08}s` }}>

      {/* ── 閉じた状態：1行リスト ── */}
      <div onClick={()=>setOpen(o=>!o)} style={{
        display:"flex", alignItems:"center", gap:14,
        background:"#fff",
        border:`0.5px solid ${C.rule}`,
        borderRadius: open ? "16px 16px 0 0" : 16,
        padding:"14px 18px",
        cursor:"pointer", userSelect:"none",
        transition:"border-radius .2s, box-shadow .2s",
        boxShadow: open ? "none" : "0 1px 4px rgba(8,6,4,.04)",
      }}>
        <span style={{
          display:"inline-flex", alignItems:"center", justifyContent:"center",
          padding:"3px 11px", borderRadius:20,
          background:badgeBg, border:`1px solid ${badgeColor}30`,
          color:badgeColor, fontSize:11, fontWeight:700, flexShrink:0,
          fontFamily:"'DM Mono',monospace",
        }}>{years}年目</span>

        <div style={{ flex:1, minWidth:0 }}>
          <div className="f-sans" style={{ fontSize:13, fontWeight:600, color:C.ink, marginBottom:2 }}>
            就農{years}年目 · ブロッコリー
          </div>
          <div className="f-sans" style={{ fontSize:10, color:C.dim }}>
            出荷先 {usedDsts.length}件
          </div>
        </div>

        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div className="f-mono" style={{ fontSize:16, fontWeight:700, color:fProfit>=0?C.bamboo:C.shu }}>
            {fProfit<0?"−":"+"}{man(Math.abs(fProfit))}
          </div>
          <div className="f-sans" style={{ fontSize:9, color:C.ghost }}>{fProfit>=0?"黒字":"赤字"}</div>
        </div>

        <span style={{
          color:C.dim, fontSize:10, flexShrink:0,
          display:"inline-block",
          transition:"transform .25s",
          transform: open?"rotate(180deg)":"rotate(0deg)",
        }}>▼</span>
      </div>

      {/* ── 展開コンテンツ ── */}
      {open&&(
        <div style={{
          background:"#fff",
          border:`0.5px solid ${C.rule}`, borderTop:"none",
          borderRadius:"0 0 16px 16px",
          padding:"20px 18px",
          animation:"appear .2s ease both",
        }}>

          {/* A. 売上・経費・利益 3カード */}
          <div className="farmer-3cols" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:18 }}>
            {[
              { lbl:"売上", val:man(fRev),                                    color:C.bamboo,              bg:C.bambooPl },
              { lbl:"経費", val:man(fCst),                                    color:C.gold,                bg:C.goldPl   },
              { lbl:"利益", val:(fProfit<0?"−":"+")+man(Math.abs(fProfit)),   color:fProfit>=0?C.bamboo:C.shu, bg:fProfit>=0?C.bambooPl:C.shuPl },
            ].map(s=>(
              <div key={s.lbl} style={{ padding:"12px 14px", background:s.bg, borderRadius:8, textAlign:"center" }}>
                <div className="f-sans" style={{ fontSize:9, color:s.color, fontWeight:700, letterSpacing:".1em", marginBottom:6 }}>{s.lbl}</div>
                <div className="f-mono" style={{ fontSize:15, fontWeight:700, color:s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* B. 売上vs経費 積み上げバー */}
          {fRev>0&&(
            <div style={{ marginBottom:18 }}>
              <div style={{ height:28, display:"flex", borderRadius:8, overflow:"hidden", background:C.ivory }}>
                <div style={{
                  width:`${cstRatio}%`, transition:"width .6s ease",
                  background:`linear-gradient(90deg,${C.gold},${C.goldLt})`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  {cstRatio>14&&<span className="f-mono" style={{ fontSize:9, color:"#fff", fontWeight:700 }}>経費 {cstRatio}%</span>}
                </div>
                <div style={{
                  width:`${pftRatio}%`, transition:"width .6s ease",
                  background:`linear-gradient(90deg,${C.bamboo},${C.bambooL})`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  {pftRatio>14&&<span className="f-mono" style={{ fontSize:9, color:"#fff", fontWeight:700 }}>利益 {pftRatio}%</span>}
                </div>
              </div>
              <div className="f-sans" style={{ display:"flex", justifyContent:"space-between", marginTop:5, fontSize:9 }}>
                <span style={{ color:C.gold }}>■ 経費 {cstRatio}%</span>
                <span style={{ color:C.bamboo }}>■ 利益 {pftRatio}%</span>
              </div>
            </div>
          )}

          {/* C. 月次折れ線グラフ */}
          {hasChart&&(
            <div style={{ marginBottom:18 }}>
              <div className="f-sans" style={{ fontSize:9, fontWeight:700, letterSpacing:".12em", textTransform:"uppercase", color:C.dim, marginBottom:10 }}>月次推移</div>
              <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width:"100%", height:"auto", display:"block" }}>
                {[0,.5,1].map(r=>(
                  <line key={r} x1={padL} y1={padT+chartH*(1-r)} x2={svgW-padR} y2={padT+chartH*(1-r)}
                    stroke={C.rule} strokeWidth=".5" strokeDasharray={r===0?"none":"3,3"}/>
                ))}
                {[0,.5,1].map(r=>(
                  <text key={r} x={padL-4} y={padT+chartH*(1-r)+3} textAnchor="end"
                    fill={C.ghost} fontSize="7" fontFamily="'DM Mono',monospace">
                    {r===0?"0":man(maxVal*r)}
                  </text>
                ))}
                {MONTHS.map((m,i)=>i%3===0&&(
                  <text key={i} x={toX(i)} y={svgH-4} textAnchor="middle"
                    fill={C.ghost} fontSize="7" fontFamily="'Zen Kaku Gothic New',sans-serif">{m}</text>
                ))}
                <polyline points={pts(monthlyRev)} fill="none" stroke={C.bamboo} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
                <polyline points={pts(monthlyCst)} fill="none" stroke={C.gold}   strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
                {monthlyRev.map((v,i)=>v>0&&<circle key={i} cx={toX(i)} cy={toY(v)} r="2.5" fill={C.bamboo}/>)}
                {monthlyCst.map((v,i)=>v>0&&<circle key={i} cx={toX(i)} cy={toY(v)} r="2.5" fill={C.gold}/>)}
              </svg>
              <div className="f-sans" style={{ display:"flex", gap:16, fontSize:9, justifyContent:"center", marginTop:4 }}>
                <span style={{ color:C.bamboo }}>— 売上</span>
                <span style={{ color:C.gold   }}>— 経費</span>
              </div>
            </div>
          )}

          {/* D. 経費内訳 横棒グラフ */}
          {cList.length>0&&(
            <div style={{ marginBottom:18 }}>
              <div className="f-sans" style={{ fontSize:9, fontWeight:700, letterSpacing:".12em", textTransform:"uppercase", color:C.dim, marginBottom:10 }}>経費の内訳</div>
              <div style={{ display:"grid", gap:8 }}>
                {cList.map(([lbl,amt])=>{
                  const pct=fCst>0?Math.round(amt/fCst*100):0;
                  return(
                    <div key={lbl} style={{ display:"grid", gridTemplateColumns:"80px 1fr 56px 28px", alignItems:"center", gap:10 }}>
                      <div className="f-sans" style={{ fontSize:11, color:C.ink }}>{lbl}</div>
                      <div style={{ height:6, background:C.ivory, borderRadius:8, overflow:"hidden" }}>
                        <div style={{ height:6, width:`${pct}%`, background:`linear-gradient(90deg,${C.gold},${C.goldLt})`, borderRadius:4 }}/>
                      </div>
                      <div className="f-mono" style={{ fontSize:11, color:C.gold, fontWeight:600, textAlign:"right" }}>{man(amt)}</div>
                      <div className="f-sans" style={{ fontSize:9, color:C.dim, textAlign:"right" }}>{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* E. 出荷先別リスト */}
          {Object.keys(byDest).length>0&&(
            <div>
              <div className="f-sans" style={{ fontSize:9, fontWeight:700, letterSpacing:".12em", textTransform:"uppercase", color:C.dim, marginBottom:10 }}>出荷先別</div>
              <div style={{ display:"grid", gap:8 }}>
                {Object.entries(byDest).map(([did,d])=>{
                  const dest=destMap[did];
                  const revShare=fRev>0?Math.round(d.rev/fRev*100):0;
                  return(
                    <div key={did} style={{
                      display:"flex", alignItems:"center", gap:12,
                      padding:"10px 14px",
                      background:C.cream, border:`0.5px solid ${C.rule}`, borderRadius:8,
                    }}>
                      {dest?<DestMark name={dest.name} sz={28} showLabel={true}/>:<span className="f-sans" style={{ fontSize:11, color:C.ghost }}>不明</span>}
                      <div style={{ flex:1 }}/>
                      <div style={{ textAlign:"right" }}>
                        <div className="f-mono" style={{ fontSize:13, fontWeight:600, color:C.bamboo }}>{man(d.rev)}</div>
                        <div className="f-sans" style={{ fontSize:9, color:C.dim }}>売上の{revShare}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GhostCard({ index }) {
  const yr = 2021 + index;
  return (
    <div className="ledger-card appear" style={{ overflow:"hidden", animationDelay:`${index*.12}s` }}>
      {/* dark header */}
      <div style={{
        background:C.bgSoft, padding:"22px 28px",
        borderBottom:`1px solid ${C.border}`,
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div className="f-sans" style={{ fontSize:9, color:C.textLight, letterSpacing:".14em", marginBottom:8, textTransform:"uppercase" }}>
              {THIS_YEAR} · 就農{THIS_YEAR - yr + 1}年目 · ブロッコリー
            </div>
            <div className="ghost-line" style={{ width:140, height:22, marginBottom:6 }}/>
            <div className="ghost-line" style={{ width:90, height:12 }}/>
          </div>
          <div style={{ textAlign:"right" }}>
            <div className="f-sans" style={{ fontSize:9, color:C.goldDim, letterSpacing:".1em", marginBottom:6, textTransform:"uppercase" }}>
              年間経費
            </div>
            <div style={{
              width:80, height:32,
              background:`${C.gold}18`,
              borderRadius:8,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <span className="f-mono" style={{ color:`${C.gold}44`, fontSize:18, fontWeight:500 }}>——</span>
            </div>
          </div>
        </div>
      </div>

      {/* body */}
      <div style={{ padding:"22px 28px" }}>
        {/* awaiting message */}
        <div style={{
          padding:"20px 0 28px",
          textAlign:"center",
          borderBottom:`1px dashed ${C.rule}`,
          marginBottom:20,
        }}>
          <div style={{ fontSize:32, marginBottom:10, opacity:.15 }}>帳</div>
          <div className="f-sans" style={{ fontSize:13, color:C.ghost, lineHeight:2, letterSpacing:".06em" }}>
            データ入力後に<br/>
            <span style={{ color:C.gold, opacity:.6 }}>経費の内訳</span>と<span style={{ color:C.bamboo, opacity:.6 }}>売上</span>が<br/>
            ここに表示されます
          </div>
        </div>

        {/* ghost lines like empty ledger */}
        <div style={{ display:"grid", gap:10 }}>
          {[100, 72, 55, 40].map((w,i) => (
            <div key={i} style={{
              display:"flex", alignItems:"center", gap:10,
              paddingBottom:10,
              borderBottom:`1px solid ${C.rule}`,
              opacity: 1 - i*.18,
            }}>
              <div className="ghost-line" style={{ width:60, height:9, animationDelay:`${i*.15}s` }}/>
              <div style={{ flex:1, height:1, background:`${C.rule}` }}/>
              <div className="ghost-line" style={{ width:`${w}px`, height:9, animationDelay:`${i*.2}s` }}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── LoginScreen — メールOTP認証 ───────────────────────────────
function LoginScreen({ farmers, onLogin, onGoRegister }) {
  const [email,   setEmail]   = useState("");
  const [code,    setCode]    = useState("");
  const [pending, setPending] = useState(null); // {code, expiresAt}
  const [sending, setSending] = useState(false);
  const [err,     setErr]     = useState("");
  const [shk,     setShk]     = useState(false);

  const bounce = () => { setShk(true); setTimeout(()=>setShk(false),500); };

  const requestCode = async () => {
    let f = farmers.find(x => x.email?.toLowerCase()===email.trim().toLowerCase());
    if (!f) {
      const { error: insertErr } = await supabase.from('farmers').insert({
        name: email.trim().split('@')[0],
        email: email.trim().toLowerCase(),
        joined_year: 2025,
        status: 'approved',
      });
      if (insertErr) { setErr("登録に失敗しました。しばらく経ってから再度お試しください"); bounce(); return; }
      f = { id: null, name: email.trim().split('@')[0], email: email.trim().toLowerCase(), joinedYear: 2025 };
    }
    setSending(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setSending(false);
    if (error) { setErr("メール送信に失敗しました。しばらく経ってから再度お試しください"); return; }
    setPending({ farmer: f });
    setCode("");
  };

const verifyCode = async () => {
    if (!pending) return;
    setSending(true); setErr("");
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    setSending(false);
    if (error) { setErr("コードが違います、または有効期限切れです"); setCode(""); bounce(); return; }
    await supabase.from('farmers').update({ auth_id: data.user.id }).eq('email', email.trim().toLowerCase());
    onLogin({ ...pending.farmer, id: data.user.id });
};

  return (
    <div className="fade-in" style={{ minHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center",padding:28 }}>
      <div style={{ width:"100%",maxWidth:360 }}>
        <div style={{ textAlign:"center",marginBottom:40 }}>
          <div style={{ fontSize:44,marginBottom:14,lineHeight:1 }}>🥦</div>
          <div className="f-sans" style={{ fontSize:22,fontWeight:700,color:C.ink,letterSpacing:".06em" }}>吉野川 農家</div>
          <div className="f-sans" style={{ fontSize:9,color:C.dim,marginTop:7,letterSpacing:".18em",textTransform:"uppercase" }}>Yoshinogawa Farmers</div>
        </div>

        <div className="ledger-card" style={{ padding:32 }}>
          <div className="f-sans" style={{ fontSize:14,fontWeight:700,color:C.ink,marginBottom:24,letterSpacing:".04em" }}>ログイン</div>

          {!pending ? (
            /* ── STEP 1: メールアドレス入力 ── */
            <div className="fade-in">
              <div style={{ marginBottom:20 }}>
                <label className="lbl f-sans">登録済みのメールアドレス</label>
                <input className="field f-sans" type="email" placeholder="your@email.com"
                  value={email} autoFocus
                  onChange={e=>{setEmail(e.target.value);setErr("");}}
                  onKeyDown={e=>e.key==="Enter"&&email.trim()&&!sending&&requestCode()}/>
                {err&&<p className="f-sans" style={{ marginTop:6,fontSize:11,color:C.shu }}>{err}</p>}
              </div>
              <button className="btn-primary" style={{ width:"100%",position:"relative" }}
                disabled={!email.trim()||sending} onClick={requestCode}>
                {sending
                  ? <span style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                      <span style={{ width:12,height:12,borderRadius:"50%",border:`2px solid ${C.washi}`,borderTopColor:"transparent",display:"inline-block",animation:"spin .8s linear infinite" }}/>
                      送信中…
                    </span>
                  : "認証コードを送信する →"}
              </button>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : (
            /* ── STEP 2: コード入力 ── */
            <div className="fade-in">
              <div style={{ padding:"12px 14px",background:C.bambooPl,borderRadius:8,border:`1px solid ${C.bamboo}22`,marginBottom:18 }}>
                <p className="f-sans" style={{ fontSize:11,color:C.bamboo,lineHeight:1.8 }}>
                  <strong>{email}</strong> に6桁のコードを送信しました。<br/>
                  メールを確認してコードを入力してください。<br/>
                  <span style={{ fontSize:10,color:C.dim }}>有効期限：10分</span>
                </p>
              </div>
              <div style={{ marginBottom:20 }}>
                <label className="lbl f-sans">認証コード（6桁）</label>
                <input className={`field f-mono ${shk?"shake":""}`}
                  type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                  value={code} autoFocus
                  onChange={e=>{setCode(e.target.value.replace(/\D/g,"").slice(0,6));setErr("");}}
                  onKeyDown={e=>e.key==="Enter"&&code.length===6&&verifyCode()}
                  style={{
                    fontSize:28,textAlign:"center",letterSpacing:".5em",
                    borderColor:err?C.shu:undefined,
                    background:err?C.shuPl:undefined,
                  }}/>
                {err&&<p className="f-sans" style={{ marginTop:6,fontSize:11,color:C.shu }}>{err}</p>}
              </div>
              <button className="btn-primary" style={{ width:"100%",marginBottom:10 }}
                disabled={code.length!==6} onClick={verifyCode}>
                ログイン
              </button>
              <button onClick={()=>{setPending(null);setCode("");setErr("");}} className="f-sans"
                style={{ width:"100%",background:"none",border:"none",fontSize:11,color:C.dim,textDecoration:"underline",textUnderlineOffset:3 }}>
                ← メールアドレスを変更する
              </button>
            </div>
          )}

          <div className="rule-text f-sans" style={{ margin:"22px 0" }}>or</div>
          <div style={{ textAlign:"center" }}>
            <span className="f-sans" style={{ fontSize:12,color:C.dim }}>まだ登録していない方は </span>
            <button onClick={onGoRegister} className="f-sans" style={{
              background:"none",border:"none",fontSize:12,color:C.gold,
              fontWeight:700,textDecoration:"underline",textUnderlineOffset:3,
            }}>新規登録申請</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── RegisterScreen

// ── RegisterScreen — 名前＋メールのみ（PINなし）───────────────
function RegisterScreen({ onGoLogin, onSubmit }) {
  const [name,  setName]  = useState("");
  const [email, setEmail] = useState("");
  const [done,  setDone]  = useState(false);
  const valid = name.trim() && email.trim();

  const go = async () => {
    if (!valid) return;
    await onSubmit({ id:uid(), name:name.trim(), email:email.trim().toLowerCase(),
      joinedYear:THIS_YEAR, appliedAt:new Date().toISOString() });
    setDone(true);
  };

  if (done) return (
    <div className="fade-in" style={{ minHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center",padding:28 }}>
      <div className="ledger-card" style={{ maxWidth:360,padding:40,textAlign:"center" }}>
        <div style={{ fontSize:40,marginBottom:16 }}>📬</div>
        <div className="f-sans" style={{ fontSize:18,fontWeight:700,color:C.bamboo,marginBottom:12 }}>申請を受け付けました</div>
        <p className="f-sans" style={{ fontSize:12,color:C.mid,lineHeight:2,marginBottom:28 }}>
          管理者が承認するまでお待ちください。<br/>
          承認後はメールアドレスだけで<br/>
          ログインできます（コード認証）。
        </p>
        <button className="btn-primary" onClick={onGoLogin}>ログイン画面へ</button>
      </div>
    </div>
  );

  return (
    <div className="fade-in" style={{ minHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center",padding:28 }}>
      <div style={{ width:"100%",maxWidth:380 }}>
        <div style={{ textAlign:"center",marginBottom:32 }}>
          <div style={{ fontSize:36,marginBottom:12 }}>🥦</div>
          <div className="f-sans" style={{ fontSize:20,fontWeight:700,color:C.ink }}>新規登録申請</div>
          <p className="f-sans" style={{ fontSize:11,color:C.dim,marginTop:6 }}>
            管理者の承認後、メール認証でログインできます
          </p>
        </div>
        <div className="ledger-card" style={{ padding:28 }}>
          <div style={{ display:"grid",gap:16,marginBottom:22 }}>
            <div>
              <label className="lbl f-sans">お名前</label>
              <input className="field f-sans" type="text" placeholder="例：山田 太郎"
                value={name} autoFocus onChange={e=>setName(e.target.value)}/>
            </div>
            <div>
              <label className="lbl f-sans">メールアドレス</label>
              <input className="field f-sans" type="email" placeholder="your@email.com"
                value={email}
                onChange={e=>setEmail(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&valid&&go()}/>
            </div>
          </div>
          <button className="btn-gold" style={{ width:"100%" }} disabled={!valid} onClick={go}>
            登録申請する
          </button>
          <div style={{ marginTop:16,textAlign:"center" }}>
            <button onClick={onGoLogin} className="f-sans" style={{ background:"none",border:"none",fontSize:12,color:C.dim }}>
              ← ログイン画面に戻る
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MAFF public statistics (10a) ────────────────────────────
const MAFF_DATA = [
  {
    crop: "ブロッコリー",
    source: "農水省 農業経営統計調査・各県経営指標",
    per10a: {
      yield:       { min: 750,  max: 1080, unit: "kg" },
      revenue:     { min: 297,  max: 528,  unit: "千円" },
      expense:     { min: 158,  max: 384,  unit: "千円" },
      income:      { min: 110,  max: 178,  unit: "千円" },
      incomeRate:  { min: 27,   max: 34,   unit: "%" },
      laborHours:  { min: 94,   max: 110,  unit: "時間" },
    },
  },
  {
    crop: "ナス",
    source: "農水省 農業経営統計調査",
    per10a: {
      yield:       { min: 3000, max: 5000, unit: "kg" },
      revenue:     { min: 800,  max: 1500, unit: "千円" },
      expense:     { min: 500,  max: 1000, unit: "千円" },
      income:      { min: 200,  max: 500,  unit: "千円" },
      incomeRate:  { min: 25,   max: 35,   unit: "%" },
      laborHours:  { min: 300,  max: 500,  unit: "時間" },
    },
  },
];

// ── Market chart constants ───────────────────────────────────
const MARKET_DATA = {
  tokyo: {
    name: "東京（大田市場）", available: true,
    broccoli: {
      price: [
        {year:2019,val:340},{year:2020,val:370},{year:2021,val:350},
        {year:2022,val:410},{year:2023,val:423},{year:2024,val:460},{year:2025,val:380},
      ],
      acreage: [
        {year:2019,val:15900},{year:2020,val:16100},{year:2021,val:16400},
        {year:2022,val:16900},{year:2023,val:17300},
      ],
      harvest: [
        {year:2019,val:151900},{year:2020,val:158400},{year:2021,val:165300},
        {year:2022,val:172800},{year:2023,val:171400},
      ],
    },
    eggplant: {
      price: [
        {year:2019,val:380},{year:2020,val:420},{year:2021,val:400},
        {year:2022,val:450},{year:2023,val:480},{year:2024,val:500},{year:2025,val:460},
      ],
      acreage: [
        {year:2019,val:9200},{year:2020,val:9000},{year:2021,val:8800},
        {year:2022,val:8600},{year:2023,val:8400},
      ],
      harvest: [
        {year:2019,val:299000},{year:2020,val:291000},{year:2021,val:283000},
        {year:2022,val:276000},{year:2023,val:269000},
      ],
    },
  },
  osaka:   { name:"大阪",   available:false },
  nagoya:  { name:"名古屋", available:false },
  fukuoka: { name:"福岡",   available:false },
  sapporo: { name:"札幌",   available:false },
};
const CROP_COLORS = { "ブロッコリー": "#00A86B", "ナス": "#F5A623" };
const CROP_TO_KEY  = { "ブロッコリー": "broccoli", "ナス": "eggplant" };
const LABOR_DATA   = [
  { crop:"ブロッコリー", min:94,  max:110 },
  { crop:"ナス",         min:300, max:500 },
];

// ── MarketLineChart ───────────────────────────────────────────
function MarketLineChart({ title, series, visibleCrops, xYears, citation }) {
  const [tip, setTip] = useState(null);
  const W = 600, H = 260;
  const P = { l:60, r:16, t:16, b:32 };
  const cW = W - P.l - P.r, cH = H - P.t - P.b;

  const visSeries = series.filter(s => visibleCrops.includes(s.crop) && s.data?.length > 0);
  if (visSeries.length === 0) return null;

  const allVals = visSeries.flatMap(s => s.data.map(d => d.val));
  const minY = xYears[0], maxY = xYears[xYears.length - 1];
  const dv = Math.max(...allVals) - Math.min(...allVals) || 1;
  const vMin = Math.min(...allVals) - dv * 0.1;
  const vMax = Math.max(...allVals) + dv * 0.1;

  const xp = y => P.l + ((y - minY) / (maxY - minY || 1)) * cW;
  const yp = v => P.t + cH - ((v - vMin) / (vMax - vMin)) * cH;

  const grids = Array.from({ length: 5 }, (_, i) => vMin + (vMax - vMin) * i / 4);
  const fmtL = v => v >= 10000 ? `${Math.round(v/1000)}千` : Math.round(v).toLocaleString("ja-JP");

  return (
    <div>
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:C.ink, marginBottom:8 }}>{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:"block" }}
        onClick={() => setTip(null)}>
        {grids.map((v, i) => (
          <g key={i}>
            <line x1={P.l} y1={yp(v)} x2={W - P.r} y2={yp(v)}
              stroke="#EBEBEB" strokeDasharray="4,4" />
            <text x={P.l - 4} y={yp(v)} textAnchor="end" fontSize={11} fill="#717171" dominantBaseline="middle">
              {fmtL(v)}
            </text>
          </g>
        ))}
        {xYears.map(y => (
          <text key={y} x={xp(y)} y={H - P.b + 16} textAnchor="middle" fontSize={11} fill="#717171">{y}</text>
        ))}
        {series.map((s, si) => {
          if (!visibleCrops.includes(s.crop) || !s.data?.length) return null;
          const col = CROP_COLORS[s.crop] || "#888";
          const pts = s.data.map(d => `${xp(d.year)},${yp(d.val)}`).join(" ");
          return (
            <g key={si}>
              <polyline points={pts} fill="none" stroke={col} strokeWidth={2} />
              {s.data.map((d, di) => (
                <circle key={di} cx={xp(d.year)} cy={yp(d.val)} r={4}
                  fill={col} stroke="#fff" strokeWidth={1.5} style={{ cursor:"pointer" }}
                  onClick={e => { e.stopPropagation(); setTip(t => t?.si===si&&t?.di===di ? null : {si,di}); }}
                />
              ))}
            </g>
          );
        })}
        {tip && (() => {
          const s = series[tip.si]; const d = s?.data[tip.di];
          if (!d) return null;
          const x = xp(d.year), y = yp(d.val);
          const txt = `${d.year}: ${d.val.toLocaleString("ja-JP")}`;
          const bw = txt.length * 6.5 + 10;
          const bx = Math.min(Math.max(x - bw / 2, P.l), W - P.r - bw);
          const by = y < P.t + 30 ? y + 8 : y - 26;
          return (
            <g>
              <rect x={bx} y={by} width={bw} height={20} rx={4} fill="rgba(34,34,34,.85)" />
              <text x={bx + bw / 2} y={by + 13} textAnchor="middle" fontSize={10} fill="#fff">{txt}</text>
            </g>
          );
        })()}
      </svg>
      <p className="f-sans" style={{ fontSize:9, color:C.ghost, marginTop:4 }}>{citation}</p>
    </div>
  );
}

// ── LaborBarChart ─────────────────────────────────────────────
function LaborBarChart({ data, visibleCrops }) {
  const maxH = Math.max(...data.map(d => d.max));
  const visible = data.filter(d => visibleCrops.includes(d.crop));
  if (visible.length === 0) return null;
  return (
    <div>
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:C.ink, marginBottom:12 }}>
        年間労働時間（10aあたり）
      </p>
      {visible.map(d => {
        const pMax = (d.max / maxH * 100).toFixed(1);
        const pMin = (d.min / maxH * 100).toFixed(1);
        const col = CROP_COLORS[d.crop] || "#888";
        const dMin = Math.round(d.min / 8), dMax = Math.round(d.max / 8);
        return (
          <div key={d.crop} style={{ marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
              <span className="f-sans" style={{ width:72, fontSize:12, color:C.ink, flexShrink:0 }}>{d.crop}</span>
              <div style={{ flex:1, position:"relative", height:22, borderRadius:4, overflow:"hidden", background:C.bgSoft }}>
                <div style={{ position:"absolute", left:0, top:0, width:`${pMax}%`, height:"100%", background:col, opacity:0.25, borderRadius:4 }}/>
                <div style={{ position:"absolute", left:0, top:0, width:`${pMin}%`, height:"100%", background:col, borderRadius:4 }}/>
              </div>
              <span className="f-mono" style={{ fontSize:12, color:C.ink, whiteSpace:"nowrap", flexShrink:0 }}>
                {d.min}〜{d.max}時間
              </span>
            </div>
            <p className="f-sans" style={{ fontSize:10, color:C.mid, marginLeft:80 }}>
              1日8時間換算で{dMin}〜{dMax}日分
            </p>
          </div>
        );
      })}
      <p className="f-sans" style={{ fontSize:9, color:C.ghost, marginTop:8 }}>出典：各県農業経営指標</p>
    </div>
  );
}

// ── BoardTab ─────────────────────────────────────────────────
function BoardTab({ farmers, destApproved, records, userLevel = 2, onLogin }) {
  const destMap = Object.fromEntries(destApproved.map(d => [d.id, d]));

  const [selectedCrop, setSelectedCrop] = useState(() => {
    try { return localStorage.getItem('boardFilterCrop') || 'すべて'; } catch { return 'すべて'; }
  });
  const [searchQuery, setSearchQuery] = useState(() => {
    try { return localStorage.getItem('boardSearchQuery') || ''; } catch { return ''; }
  });
  const handleSetCrop = crop => {
    setSelectedCrop(crop);
    try { localStorage.setItem('boardFilterCrop', crop); } catch {}
  };
  const handleSetSearch = q => {
    setSearchQuery(q);
    try { localStorage.setItem('boardSearchQuery', q); } catch {}
  };

  const [showMarketChart, setShowMarketChart] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState('tokyo');
  const [visibleCrops, setVisibleCrops] = useState(['ブロッコリー', 'ナス']);
  const toggleCrop = crop => setVisibleCrops(v => v.includes(crop) ? v.filter(c => c !== crop) : [...v, crop]);

  const median = arr => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const allFarmerRecs = farmers.map(f => ({
    id: f.id,
    recs: MONTHS.flatMap((_, i) => records[`${f.id}_${THIS_YEAR}_${i}`] || []),
  }));

  const allCrops = [...new Set(allFarmerRecs.flatMap(f => f.recs).map(r => r.crop).filter(Boolean))];

  const filteredFarmerRecs = selectedCrop === 'すべて'
    ? allFarmerRecs
    : allFarmerRecs.map(({ id, recs }) => ({ id, recs: recs.filter(r => r.crop === selectedCrop) }));

  // 作物別集計（農家単位）
  const cropFarmerMap = {};
  filteredFarmerRecs.forEach(({ id, recs }) => {
    recs.forEach(r => {
      const crop = r.crop || "";
      if (!crop) return;
      if (!cropFarmerMap[crop]) cropFarmerMap[crop] = {};
      if (!cropFarmerMap[crop][id]) cropFarmerMap[crop][id] = { rev: 0, cost: 0 };
      cropFarmerMap[crop][id].rev += (r.boxes || 0) * (r.ppb || 0);
      cropFarmerMap[crop][id].cost += (r.costs || []).reduce((s, c) => s + (c.a || 0), 0);
    });
  });
  const cropCards = Object.entries(cropFarmerMap).map(([crop, fm]) => {
    const entries = Object.values(fm);
    const revs = entries.map(e => e.rev);
    const costs = entries.map(e => e.cost);
    const profits = entries.map(e => e.rev - e.cost);
    const rates = entries.filter(e => e.rev > 0).map(e => Math.round(e.cost / e.rev * 100));
    return { crop, count: entries.length, medRev: median(revs), medCost: median(costs), medProfit: median(profits), medRate: Math.round(median(rates)) };
  }).sort((a, b) => b.count - a.count);

  // 出荷先別集計（農家単位）
  const destFarmerMap = {};
  filteredFarmerRecs.forEach(({ id, recs }) => {
    recs.forEach(r => {
      if (!r.destId) return;
      if (!destFarmerMap[r.destId]) destFarmerMap[r.destId] = {};
      if (!destFarmerMap[r.destId][id]) destFarmerMap[r.destId][id] = { rev: 0, cost: 0 };
      destFarmerMap[r.destId][id].rev += (r.boxes || 0) * (r.ppb || 0);
      destFarmerMap[r.destId][id].cost += (r.costs || []).reduce((s, c) => s + (c.a || 0), 0);
    });
  });
  const destCards = Object.entries(destFarmerMap).map(([destId, fm]) => {
    const entries = Object.values(fm);
    const revs = entries.map(e => e.rev);
    const costs = entries.map(e => e.cost);
    const rates = entries.filter(e => e.rev > 0).map(e => Math.round(e.cost / e.rev * 100));
    return { destId, name: destMap[destId]?.name || "不明", count: entries.length, medRate: Math.round(median(rates)), medRev: median(revs), medCost: median(costs) };
  }).sort((a, b) => b.count - a.count);

  const sq = searchQuery.trim().toLowerCase();
  const filteredCropCards = sq ? cropCards.filter(c => c.crop.toLowerCase().includes(sq)) : cropCards;
  const filteredDestCards = sq ? destCards.filter(d => d.name.toLowerCase().includes(sq)) : destCards;

  const isFiltered = selectedCrop !== 'すべて';
  const hasNoData = filteredCropCards.length === 0 && filteredDestCards.length === 0;

  const lastUpdated = new Date().toLocaleDateString("ja-JP", { year:"numeric", month:"2-digit", day:"2-digit" });
  const MIN_FARMERS = 5;

  return (
    <div className="appear">

      {/* ══ HERO ══════════════════════════════════════════ */}
      <div style={{
        background: C.cream, border:`1px solid ${C.rule}`, borderRadius:16,
        padding:"44px 40px 36px", marginBottom:24,
        position:"relative", overflow:"hidden",
        boxShadow:"0 2px 16px rgba(8,6,4,.06)",
      }}>
        <div style={{ position:"absolute", top:-60, right:-60, width:240, height:240, borderRadius:"50%", background:`${C.gold}07`, pointerEvents:"none" }}/>
        <div style={{ position:"absolute", bottom:-40, left:120, width:140, height:140, borderRadius:"50%", background:`${C.bamboo}05`, pointerEvents:"none" }}/>
        <div style={{ position:"relative", zIndex:1 }}>
          <div className="f-sans" style={{ fontSize:9, letterSpacing:".2em", color:C.dim, textTransform:"uppercase", marginBottom:14 }}>
            {THIS_YEAR} · 吉野川 · {farmers.length}農家
          </div>
          <h1 className="f-sans" style={{ fontSize:36, fontWeight:800, color:C.ink, lineHeight:1.3, letterSpacing:".03em", margin:"0 0 14px" }}>
            日本農業研究所。
          </h1>
          <p className="f-sans" style={{ fontSize:14, color:C.mid, lineHeight:1.8, marginBottom:28 }}>
            吉野川の農家が、実際の経費を公開するサイトです。
          </p>
          <div style={{ marginTop:28, paddingTop:16, borderTop:`1px solid ${C.rule}`, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
            {["個人名は非公開","格付け・ランキングを目的としない","データは農家本人が入力"].map(t => (
              <span key={t} className="f-sans" style={{ fontSize:9, color:C.ghost, letterSpacing:".08em", display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ width:5, height:5, borderRadius:"50%", background:C.accent, display:"inline-block" }}/>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ══ 公的統計 ════════════════════════════════════ */}
      {(() => {
        const toMan = v => `${(v / 10).toFixed(1)}万円`;
        const maffFiltered = selectedCrop === 'すべて'
          ? MAFF_DATA
          : MAFF_DATA.filter(d => d.crop === selectedCrop);
        if (maffFiltered.length === 0) return null;
        return (
          <div style={{ marginBottom: 24 }}>
            <h2 className="f-sans" style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 12, letterSpacing: '.04em' }}>
              公的統計（10aあたり）
            </h2>
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {maffFiltered.map(d => {
                const p = d.per10a;
                const revMid = Math.round((p.revenue.min + p.revenue.max) / 2) * 1000;
                const expMid = Math.round((p.expense.min + p.expense.max) / 2) * 1000;
                const rows = [
                  { label: '収量',     value: `${p.yield.min}〜${p.yield.max}${p.yield.unit}` },
                  { label: '粗収益',   value: `${toMan(p.revenue.min)}〜${toMan(p.revenue.max)}` },
                  { label: '経費',     value: `${toMan(p.expense.min)}〜${toMan(p.expense.max)}` },
                  { label: '所得',     value: `${toMan(p.income.min)}〜${toMan(p.income.max)}` },
                  { label: '所得率',   value: `${p.incomeRate.min}〜${p.incomeRate.max}%` },
                  { label: '労働時間', value: `${p.laborHours.min}〜${p.laborHours.max}${p.laborHours.unit}` },
                ];
                return (
                  <div key={d.crop} style={{ flexShrink: 0, width: 280, background: '#fff', borderRadius: 16, padding: '18px 20px', border: `1px solid ${C.rule}` }}>
                    <p className="f-sans" style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 12 }}>{d.crop}</p>
                    {rows.map(r => (
                      <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span className="f-sans" style={{ fontSize: 11, color: C.mid }}>{r.label}</span>
                        <span className="f-mono" style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{r.value}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 14, marginBottom: 10 }}>
                      <BalanceSheet revenue={revMid} costs={[{ l: '経費', a: expMid }]} compact={true} />
                    </div>
                    <p className="f-sans" style={{ fontSize: 9, color: C.ghost, lineHeight: 1.6 }}>出典：{d.source}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ══ 市場データ展開セクション ════════════════════ */}
      <div style={{ marginBottom:24 }}>
        <div style={{ textAlign:"center" }}>
          <button onClick={() => setShowMarketChart(v => !v)} className="f-sans" style={{
            padding:"12px 24px", borderRadius:12, border:`1px solid ${C.border}`,
            background:"#fff", fontSize:13, color:C.ink, cursor:"pointer",
          }}>
            {showMarketChart ? '▲ 閉じる' : '市場データを詳しく見る ▼'}
          </button>
        </div>
        <div style={{ maxHeight: showMarketChart ? "2000px" : "0", overflow:"hidden", transition:"max-height 0.3s ease" }}>
          <div style={{ marginTop:16, background:"#fff", borderRadius:16, padding:24, border:`1px solid ${C.border}` }}>

            {/* 市場選択 + 作物トグル */}
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24, flexWrap:"wrap" }}>
              <select value={selectedMarket} onChange={e => setSelectedMarket(e.target.value)} className="f-sans" style={{
                padding:"8px 12px", borderRadius:8, border:`1px solid ${C.border}`,
                fontSize:13, color:C.ink, background:"#fff",
              }}>
                {Object.entries(MARKET_DATA).map(([k, v]) => (
                  <option key={k} value={k} disabled={!v.available}>
                    {v.name}{!v.available ? '（準備中）' : ''}
                  </option>
                ))}
              </select>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {Object.keys(CROP_COLORS).map(crop => {
                  const active = visibleCrops.includes(crop);
                  return (
                    <button key={crop} onClick={() => toggleCrop(crop)} className="f-sans" style={{
                      display:"flex", alignItems:"center", gap:6,
                      padding:"6px 14px", borderRadius:20, fontSize:12,
                      border:`1px solid ${active ? CROP_COLORS[crop] : C.border}`,
                      background: active ? `${CROP_COLORS[crop]}18` : "#fff",
                      color:C.ink, cursor:"pointer",
                      opacity: active ? 1 : 0.4,
                      transition:"all .15s",
                    }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:CROP_COLORS[crop], display:"inline-block" }}/>
                      {crop}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* グラフ */}
            {(() => {
              const mkt = MARKET_DATA[selectedMarket];
              const mkSeries = (key) => Object.keys(CROP_COLORS).map(crop => ({
                crop, data: mkt[CROP_TO_KEY[crop]]?.[key] || [],
              }));
              return (
                <>
                  <MarketLineChart
                    title="卸売価格（円/kg）"
                    series={mkSeries('price')}
                    visibleCrops={visibleCrops}
                    xYears={[2019,2020,2021,2022,2023,2024,2025]}
                    citation="出典：東京都中央卸売市場 市場統計情報"
                  />
                  <div style={{ marginTop:32 }}>
                    <MarketLineChart
                      title="全国作付面積（ha）"
                      series={mkSeries('acreage')}
                      visibleCrops={visibleCrops}
                      xYears={[2019,2020,2021,2022,2023]}
                      citation="出典：農水省 作物統計調査"
                    />
                  </div>
                  <div style={{ marginTop:32 }}>
                    <MarketLineChart
                      title="全国収穫量（t）"
                      series={mkSeries('harvest')}
                      visibleCrops={visibleCrops}
                      xYears={[2019,2020,2021,2022,2023]}
                      citation="出典：農水省 作物統計調査"
                    />
                  </div>
                  <div style={{ marginTop:32 }}>
                    <LaborBarChart data={LABOR_DATA} visibleCrops={visibleCrops} />
                  </div>
                </>
              );
            })()}

          </div>
        </div>
      </div>

      {/* ══ 検索バー ════════════════════════════════════ */}
      <div style={{ marginBottom:12, position:"relative" }}>
        <span style={{ position:"absolute", left:16, top:"50%", transform:"translateY(-50%)", fontSize:16, pointerEvents:"none" }}>🔍</span>
        <input
          className="f-sans"
          type="text"
          placeholder="作物や出荷先を検索..."
          value={searchQuery}
          onChange={e => handleSetSearch(e.target.value)}
          style={{
            width:"100%", padding:"14px 16px 14px 44px",
            borderRadius:16, border:"none", background:C.bgSoft,
            fontSize:14, color:C.ink, outline:"none",
          }}
        />
        {searchQuery && (
          <button onClick={() => handleSetSearch('')} style={{
            position:"absolute", right:14, top:"50%", transform:"translateY(-50%)",
            background:"none", border:"none", fontSize:18, color:C.ghost, cursor:"pointer",
          }}>×</button>
        )}
      </div>

      {/* ══ 作物フィルターピル ════════════════════════ */}
      <div className="filter-scroll" style={{
        display:"flex", gap:8, overflowX:"auto", paddingBottom:10, marginBottom:16,
        scrollbarWidth:"none", msOverflowStyle:"none",
      }}>
        {['すべて', ...allCrops].map(crop => {
          const active = selectedCrop === crop;
          return (
            <button key={crop} onClick={() => handleSetCrop(crop)} style={{
              flexShrink:0, padding:"8px 20px", borderRadius:20, fontSize:13,
              fontWeight: active ? 700 : 400,
              background: active ? C.accent : "#fff",
              color: active ? "#fff" : C.ink,
              border: active ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
              whiteSpace:"nowrap", cursor:"pointer",
              transition:"all .15s ease",
            }}>{crop}</button>
          );
        })}
      </div>

      {/* ══ 参加状況バナー ══════════════════════════════ */}
      <div style={{
        padding:"14px 20px", background:C.ivory, border:`1px solid ${C.rule}`,
        borderRadius:16, marginBottom:28,
        display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8,
      }}>
        <span className="f-sans" style={{ fontSize:13, color:C.ink }}>
          現在 <strong style={{ color:C.bamboo }}>{farmers.length}</strong> 名の農家が参加中
        </span>
        <span className="f-sans" style={{ fontSize:10, color:C.ghost }}>最終更新 {lastUpdated}</span>
      </div>

      {/* ══ フィルター中バナー ════════════════════════ */}
      {(isFiltered || sq) && (
        <div style={{
          padding:"12px 18px", marginBottom:20,
          background: hasNoData ? C.dangerLight : C.accentLight,
          border:`1px solid ${hasNoData ? C.danger+'44' : C.accent+'44'}`,
          borderRadius:12,
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap",
        }}>
          <span className="f-sans" style={{ fontSize:13, color: hasNoData ? C.danger : C.accent, fontWeight:600 }}>
            {hasNoData
              ? `「${selectedCrop !== 'すべて' ? selectedCrop : sq}」のデータはまだありません。最初の入力者になりましょう！`
              : `${selectedCrop !== 'すべて' ? selectedCrop : `"${sq}"`}のデータを表示中`
            }
          </span>
          <button onClick={() => { handleSetCrop('すべて'); handleSetSearch(''); }} style={{
            padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600,
            background:"#fff", border:`1px solid ${C.border}`, color:C.ink, cursor:"pointer",
          }}>すべてに戻す</button>
        </div>
      )}

      {/* ══ 吉野川リアルデータ ══════════════════════════ */}
      {userLevel >= 2 ? (
        <>
          {/* 作物別中央値カルーセル */}
          <div style={{ marginBottom:32 }}>
            <div className="f-sans" style={{ fontSize:9, fontWeight:700, letterSpacing:".14em", textTransform:"uppercase", color:C.dim, marginBottom:14 }}>作物別 集計（中央値）</div>
            {filteredCropCards.length === 0
              ? <p className="f-sans" style={{ fontSize:12, color:C.ghost, padding:"20px 0" }}>データ収集中です</p>
              : <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:8 }}>
                  {filteredCropCards.map(c => {
                    const masked = c.count < MIN_FARMERS;
                    return (
                      <div key={c.crop} style={{
                        flexShrink:0, width:200, padding:"18px 18px 16px",
                        background:C.cream, border:`1px solid ${C.rule}`, borderRadius:16,
                        boxShadow:"0 1px 6px rgba(8,6,4,.05)",
                      }}>
                        <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:C.ink, marginBottom:4 }}>{c.crop}</p>
                        <p className="f-sans" style={{ fontSize:10, color:C.ghost, marginBottom:12 }}>{c.count}農家が入力</p>
                        {masked ? (
                          <div style={{ padding:"12px 10px", background:C.ivory, borderRadius:8, textAlign:"center" }}>
                            <p className="f-sans" style={{ fontSize:10, color:C.dim, lineHeight:1.7 }}>データ収集中<br/>（あと{MIN_FARMERS - c.count}人）</p>
                          </div>
                        ) : (
                          <div style={{ display:"grid", gap:6 }}>
                            {[{l:"売上中央値",v:man(c.medRev),col:C.bamboo},{l:"経費中央値",v:man(c.medCost),col:C.gold},{l:"利益中央値",v:man(c.medProfit),col:c.medProfit>=0?C.bamboo:C.shu},{l:"経費率中央値",v:`${c.medRate}%`,col:C.mid}].map(row => (
                              <div key={row.l} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                                <span className="f-sans" style={{ fontSize:9, color:C.ghost }}>{row.l}</span>
                                <span className="f-mono" style={{ fontSize:13, fontWeight:600, color:row.col }}>{row.v}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
            }
          </div>

          {/* 出荷先別経費率カルーセル */}
          <div style={{ marginBottom:32 }}>
            <div className="f-sans" style={{ fontSize:9, fontWeight:700, letterSpacing:".14em", textTransform:"uppercase", color:C.dim, marginBottom:14 }}>出荷先別 採算（中央値）</div>
            {filteredDestCards.length === 0
              ? <p className="f-sans" style={{ fontSize:12, color:C.ghost, padding:"20px 0" }}>データ収集中です</p>
              : <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:8 }}>
                  {filteredDestCards.map(d => {
                    const masked = d.count < MIN_FARMERS;
                    return (
                      <div key={d.destId} style={{
                        flexShrink:0, width:280, padding:"16px",
                        background:C.cream, border:`1px solid ${C.rule}`, borderRadius:16,
                        boxShadow:"0 1px 6px rgba(8,6,4,.05)",
                      }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                          <DestMark name={d.name} sz={24} showLabel={true} />
                          <span className="f-sans" style={{ marginLeft:"auto", fontSize:9, color:C.ghost }}>{d.count}農家</span>
                        </div>
                        {masked ? (
                          <div style={{ padding:"10px 8px", background:C.ivory, borderRadius:8, textAlign:"center" }}>
                            <p className="f-sans" style={{ fontSize:10, color:C.dim, lineHeight:1.7 }}>データ収集中（あと{MIN_FARMERS - d.count}人）</p>
                          </div>
                        ) : (
                          <BalanceSheet
                            revenue={d.medRev}
                            costs={[{l:"経費(中央値)", a: d.medCost}]}
                            compact={true}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        </>
      ) : (
        /* レベル1：登録促進カード */
        <div style={{
          borderRadius:16, background:"#F7F7F7", border:`1px solid ${C.rule}`,
          padding:"40px 24px", textAlign:"center", marginBottom:32,
        }}>
          <p className="f-sans" style={{ fontSize:14, color:C.ink, fontWeight:600, marginBottom:12 }}>
            登録すると産地の実績データが見れます
          </p>
          <button onClick={onLogin} style={{
            padding:"10px 28px", borderRadius:20, background:C.accent,
            color:"#fff", border:"none", fontSize:13, fontWeight:600, cursor:"pointer",
          }}>無料で登録する（10秒）</button>
        </div>
      )}

      {/* ══ 注記 ════════════════════════════════════════ */}
      <div style={{ marginTop:8, padding:"12px 18px", borderTop:`1px solid ${C.rule}` }}>
        <p className="f-sans" style={{ fontSize:10, color:C.ghost, lineHeight:1.9 }}>
          このデータは参加農家の入力に基づく集計値です。個人の情報は公開されません。
        </p>
      </div>

    </div>
  );
}

// ── InputTab ─────────────────────────────────────────────────
function InputTab({ loggedInFarmer, destApproved, destPending, records, onAddRecord, onSubmitDest, onGoBoard }) {
  const [step,setStep]=useState(1);
  const [crop,setCrop]=useState("");
  const [cropInput,setCropInput]=useState("");
  const [variety,setVariety]=useState("");
  const [isBrand,setIsBrand]=useState(false);
  const [mon,setMon]=useState(new Date().getMonth());
  const [dest,setDest]=useState(null);
  const [boxes,setBoxes]=useState("");
  const [ppb,setPpb]=useState("");
  const [costs,setCosts]=useState([{l:"",v:"",mode:"fixed"}]);
  const [saved,setSaved]=useState(false);
  const [newDN,setNewDN]=useState("");
  const [subDest,setSubDest]=useState(false);
  const [dSubmit,setDSubmit]=useState(false);
  const [destSearch,setDestSearch]=useState("");
  const rev=(parseFloat(boxes)||0)*(parseFloat(ppb)||0);
  const myPend=destPending.filter(d=>d.submittedBy===loggedInFarmer?.name);

  const knownCrops=[...new Set(
    Object.values(records).flat().map(r=>r.crop).filter(Boolean)
  )];

  const knownVarieties=(cropName)=>[...new Set(
    Object.values(records).flat().filter(r=>r.crop===cropName&&r.variety).map(r=>r.variety)
  )];

  const save=async()=>{
    if(!boxes||!ppb)return;
    const ci=costs.filter(c=>c.l&&c.v).map(c=>{
      const v=parseFloat(c.v)||0;
      let a=0;
      if(c.mode==="pct") a=Math.round(rev*v/100);
      else if(c.mode==="per_box") a=Math.round(parseFloat(boxes)*v);
      else a=Math.round(v);
      return {l:c.l,v,mode:c.mode,a};
    });
    await onAddRecord(loggedInFarmer.id,THIS_YEAR,mon,{destId:dest.id,boxes:parseFloat(boxes),ppb:parseFloat(ppb),costs:ci,crop:crop,variety:variety.trim(),is_brand:isBrand});
    setSaved(true);
  };
  const submitDest=async()=>{
    if(!newDN.trim())return;
    await onSubmitDest({id:uid(),name:newDN.trim(),status:"pending",submittedBy:loggedInFarmer.name});
    setNewDN("");setSubDest(false);setDSubmit(true);
  };

  const STEPS=["作物","月を選ぶ","出荷先","売上・経費"];
  return (
    <div className="appear" style={{maxWidth:540,margin:"0 auto"}}>
      {/* ステップ */}
      <div style={{display:"flex",marginBottom:28}}>
        {STEPS.map((s,i)=>{
          const act=step===i+1,dn=step>i+1;
          return(
            <div key={i} style={{
              flex:1,padding:"10px 4px",textAlign:"center",
              borderBottom:`2px solid ${act?C.gold:dn?C.dim:C.rule}`,
              transition:"border-color .3s",
            }}>
              <span className="f-sans" style={{fontSize:11,fontWeight:act?700:400,color:act?C.gold:dn?C.mid:C.ghost}}>
                <span style={{
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  width:18,height:18,borderRadius:"50%",marginRight:5,
                  background:act?C.gold:dn?C.mid:C.ivory,
                  color:act||dn?"#fff":C.ghost,fontSize:9,fontWeight:700,
                }}>{dn?"✓":i+1}</span>
                {s}
              </span>
            </div>
          );
        })}
      </div>

      <div className="ledger-card" style={{padding:28}}>
        {step===1&&(
          <div className="fade-in">
            <p className="f-sans" style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:16}}>作物を選んでください</p>
            {knownCrops.length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
                {knownCrops.map(c=>(
                  <button key={c} onClick={()=>{setCrop(c);setCropInput(c);setVariety("");}} style={{
                    padding:"6px 12px",border:`1.5px solid ${crop===c?C.gold:C.rule}`,borderRadius:20,
                    background:crop===c?`${C.gold}12`:"#fff",
                    color:crop===c?C.gold:C.mid,fontSize:12,fontWeight:crop===c?700:400,
                  }}>{c}</button>
                ))}
              </div>
            )}
            <input className="field f-sans" placeholder="作物名を入力（例：トマト）" value={cropInput}
              onChange={e=>{setCropInput(e.target.value);setCrop(e.target.value);setVariety("");}}
              style={{marginBottom:18,fontSize:14}}/>

            {/* 品種入力 */}
            <div style={{marginBottom:16}}>
              <label className="lbl f-sans">品種（例：千両2号、おかわかめ等）</label>
              {crop&&knownVarieties(crop).length>0&&(
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                  {knownVarieties(crop).map(v=>(
                    <button key={v} onClick={()=>setVariety(v)} style={{
                      padding:"4px 10px",border:`1.5px solid ${variety===v?C.bamboo:C.rule}`,borderRadius:20,
                      background:variety===v?`${C.bamboo}12`:"#fff",
                      color:variety===v?C.bamboo:C.mid,fontSize:11,fontWeight:variety===v?700:400,
                    }}>{v}</button>
                  ))}
                </div>
              )}
              <input className="field f-sans" placeholder="品種名（任意）" value={variety}
                onChange={e=>setVariety(e.target.value)}
                style={{fontSize:13}}/>
            </div>

            {/* ブランド品トグル */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,padding:"12px 14px",background:C.bgSoft,borderRadius:10}}>
              <div>
                <span className="f-sans" style={{fontSize:13,fontWeight:600,color:C.ink}}>ブランド品</span>
                {isBrand&&<span style={{marginLeft:8,padding:"2px 8px",borderRadius:8,fontSize:10,fontWeight:700,background:C.accentLight,color:C.accent}}>ブランド</span>}
              </div>
              <button onClick={()=>setIsBrand(b=>!b)} style={{
                width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",
                background:isBrand?C.accent:"#D1D1D1",
                transition:"background .2s",
                position:"relative",padding:0,flexShrink:0,
              }}>
                <span style={{
                  position:"absolute",top:3,left:isBrand?23:3,
                  width:18,height:18,borderRadius:"50%",background:"#fff",
                  transition:"left .2s",
                  boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
                  display:"block",
                }}/>
              </button>
            </div>

            <button className="btn-primary" style={{width:"100%"}} disabled={!crop.trim()} onClick={()=>setStep(2)}>続ける →</button>
          </div>
        )}

        {step===2&&(
          <div className="fade-in">
            <p className="f-sans" style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:20}}>何月のデータを入力しますか？</p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:22}}>
              {MONTHS.map((m,i)=>{
                const has=(records[`${loggedInFarmer.id}_${THIS_YEAR}_${i}`]||[]).length>0;
                const act=mon===i;
                return(
                  <button key={i} onClick={()=>setMon(i)} style={{
                    padding:"11px 4px",border:`1.5px solid ${act?C.gold:C.rule}`,borderRadius:16,
                    background:act?`${C.gold}12`:"#fff",
                    color:act?C.gold:C.ink,fontSize:12,fontWeight:act?700:400,
                    position:"relative",
                  }}>
                    {m}
                    {has&&<span style={{position:"absolute",top:5,right:5,width:5,height:5,borderRadius:"50%",background:C.gold}}/>}
                  </button>
                );
              })}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-outline" onClick={()=>setStep(1)}>← 戻る</button>
              <button className="btn-primary" style={{flex:1}} onClick={()=>setStep(3)}>続ける →</button>
            </div>
          </div>
        )}

        {step===3&&(
          <div className="fade-in">
            <p className="f-sans" style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:18}}>{MONTHS[mon]}の出荷先</p>
            <input className="field f-sans" placeholder="出荷先を検索..." value={destSearch}
              onChange={e=>setDestSearch(e.target.value)}
              style={{marginBottom:12,fontSize:13}}/>
            <div style={{display:"grid",gap:8,marginBottom:14,maxHeight:240,overflowY:"auto"}}>
              {destApproved.filter(d=>!destSearch||d.name.includes(destSearch)).map(d=>{
                const sel=dest?.id===d.id,col=destColor(d.name);
                return(
                  <button key={d.id} onClick={()=>{
                    setDest(d);setDSubmit(false);setDestSearch("");
                    setCosts([{l:"",v:"",mode:"fixed"}]);
                    setPpb("");
                    const prevRecs = Object.entries(records).flatMap(([k,arr])=>arr.filter(r=>r.destId===d.id&&k.startsWith(loggedInFarmer.id)));
                    if(prevRecs.length>0){
                      const latest = prevRecs[prevRecs.length-1];
                      if(latest.costs&&latest.costs.length>0){
                        setCosts(latest.costs.map(c=>({l:c.l,v:String(c.v||c.a),mode:c.mode||"fixed"})));
                      }
                      if(latest.ppb) setPpb(String(latest.ppb));
                    }
                  }} style={{
                    padding:"12px 16px",border:`1.5px solid ${sel?col:C.rule}`,borderRadius:8,
                    background:sel?`${col}10`:"#fff",
                    display:"flex",alignItems:"center",gap:10,
                  }}>
                    <DestMark name={d.name} sz={26}/>
                    {d.notes&&<span className="f-sans" style={{fontSize:9,color:C.ghost,marginLeft:"auto"}}>{d.notes}</span>}
                  </button>
                );
              })}
            </div>
            {myPend.length>0&&<div className="f-sans" style={{padding:"8px 12px",background:C.goldPl,borderRadius:8,marginBottom:10,fontSize:11,color:C.gold}}>承認待ち: {myPend.map(d=>d.name).join("、")}</div>}
            {dSubmit&&<div className="f-sans" style={{padding:"8px 12px",background:C.bambooPl,borderRadius:8,marginBottom:10,fontSize:11,color:C.bamboo}}>✓ 申請しました。管理者の承認後に利用できます。</div>}
            {!subDest
              ? <button onClick={()=>{setSubDest(true);setDSubmit(false);}} style={{width:"100%",padding:"9px",border:`1px dashed ${C.rule}`,borderRadius:8,background:"transparent",color:C.mid,fontSize:11,marginBottom:14,fontFamily:"inherit"}}>＋ 出荷先を申請する</button>
              : <div style={{padding:14,background:C.ivory,borderRadius:8,marginBottom:14,display:"grid",gap:9}}>
                  <p className="f-sans" style={{fontSize:11,color:C.gold}}>新しい出荷先は管理者の承認後に公開されます</p>
                  <input className="field f-sans" placeholder="会社・団体名" value={newDN} onChange={e=>setNewDN(e.target.value)}/>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn-gold" style={{flex:1}} onClick={submitDest}>申請する</button>
                    <button className="btn-outline" style={{flex:1}} onClick={()=>setSubDest(false)}>キャンセル</button>
                  </div>
                </div>
            }
            <div style={{display:"flex",gap:8}}>
              <button className="btn-outline" onClick={()=>setStep(2)}>← 戻る</button>
              <button className="btn-primary" style={{flex:1}} disabled={!dest} onClick={()=>setStep(4)}>続ける →</button>
            </div>
          </div>
        )}

        {step===4&&(
          <div className="fade-in">
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
              {[
                {lbl:loggedInFarmer.name,color:C.bark},
                crop&&{lbl:crop,color:C.bamboo},
                {lbl:MONTHS[mon],color:C.bamboo},
                dest&&{lbl:dest.name,color:destColor(dest.name)},
              ].filter(Boolean).map(t=>(
                <span key={t.lbl} className="tag f-sans" style={{background:`${t.color}12`,color:t.color,border:`1px solid ${t.color}22`}}>{t.lbl}</span>
              ))}
            </div>
            <div style={{display:"grid",gap:14,marginBottom:18}}>
              {[{lbl:"出荷箱数",unit:"箱",val:boxes,fn:setBoxes,next:"ppb-input"},{lbl:"1箱あたり単価",unit:"円/箱",val:ppb,fn:setPpb,next:null}].map(f=>(
                <div key={f.lbl}>
                  <label className="lbl f-sans">{f.lbl}</label>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <input className="field f-mono" type="number" inputMode="numeric" placeholder="0" value={f.val}
                      id={f.lbl==="1箱あたり単価"?"ppb-input":undefined}
                      onChange={e=>f.fn(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter"&&f.next){e.preventDefault();document.getElementById(f.next)?.focus();}}}
                      style={{flex:1,fontSize:20}}/>
                    <span className="f-sans" style={{fontSize:12,color:C.mid,whiteSpace:"nowrap"}}>{f.unit}</span>
                  </div>
                </div>
              ))}
              {rev>0&&<div style={{padding:"12px 16px",background:C.bambooPl,borderRadius:8,border:`1px solid ${C.bamboo}22`,display:"flex",justifyContent:"space-between"}}>
                <span className="f-sans" style={{fontSize:11,color:C.bamboo}}>売上合計</span>
                <span className="f-mono" style={{fontSize:18,fontWeight:500,color:C.bamboo}}>{man(rev)}</span>
              </div>}
              <div>
                <label className="lbl f-sans">経費項目（省略可）</label>
                <div style={{display:"grid",gap:8}}>
                  {costs.map((c,i)=>{
                    return(
                      <div key={i}>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <input className="field f-sans" placeholder="項目名（例：運賃）" value={c.l}
                            onChange={e=>{const n=[...costs];n[i]={...n[i],l:e.target.value};setCosts(n);}} style={{flex:2}}/>
                          <input className="field f-mono" type="number" placeholder="0" value={c.v}
                            onChange={e=>{const n=[...costs];n[i]={...n[i],v:e.target.value};setCosts(n);}} style={{flex:1}}/>
                          <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:`1px solid ${C.rule}`,flexShrink:0}}>
                            {["pct","per_box","fixed"].map(mode=>(
                              <button key={mode} onClick={()=>{const n=[...costs];n[i]={...n[i],mode};setCosts(n);}} style={{
                                padding:"8px 9px",border:"none",fontSize:10,fontWeight:700,
                                background:c.mode===mode?C.text:"transparent",
                                color:c.mode===mode?"#fff":C.dim,
                              }}>{mode==="pct"?"%":mode==="per_box"?"/箱":"固定"}</button>
                            ))}
                          </div>
                          {costs.length>1&&<button onClick={()=>setCosts(costs.filter((_,j)=>j!==i))} style={{padding:"8px",border:`1px solid ${C.rule}`,borderRadius:8,background:"transparent",color:C.dim,fontSize:11}}>×</button>}
                        </div>
                        {c.mode==="pct"&&rev>0&&<p className="f-sans" style={{marginTop:4,fontSize:10,color:C.gold}}>→ 売上の{c.v||0}% ≒ {cn(Math.round(rev*(parseFloat(c.v)||0)/100))} 円</p>}
                        {c.mode==="per_box"&&boxes&&<p className="f-sans" style={{marginTop:4,fontSize:10,color:C.gold}}>→ {boxes}箱 × {c.v||0}円 ≒ {cn(Math.round(parseFloat(boxes)*(parseFloat(c.v)||0)))} 円</p>}
                        {c.mode==="fixed"&&c.v&&<p className="f-sans" style={{marginTop:4,fontSize:10,color:C.gold}}>→ 固定 {cn(Math.round(parseFloat(c.v)||0))} 円</p>}
                      </div>
                    );
                  })}
                  {costs.length<5&&<button onClick={()=>setCosts([...costs,{l:"",v:"",mode:"fixed"}])} style={{padding:"8px",border:`1px dashed ${C.rule}`,borderRadius:8,background:"transparent",color:C.mid,fontSize:11,fontFamily:"inherit"}}>＋ 経費追加</button>}
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-outline" onClick={()=>setStep(3)}>← 戻る</button>
              <button className="btn-primary" style={{flex:1,background:saved?C.bamboo:undefined}} disabled={!boxes||!ppb} onClick={save}>
                {saved?"✓ 保存しました":"保存する"}
              </button>
            </div>
            {saved&&<div style={{marginTop:12,textAlign:"center",display:"grid",gap:8}}>
              <button onClick={()=>{setStep(1);setSaved(false);setCosts([{l:"",v:"",mode:"fixed"}]);setCrop("");setCropInput("");}} className="f-sans" style={{fontSize:12,color:C.mid,background:"none",border:"none",textDecoration:"underline",textUnderlineOffset:3}}>入力を続ける</button>
              <button onClick={()=>onGoBoard&&onGoBoard()} className="btn-primary" style={{width:"100%"}}>公開ボードを見る →</button>
            </div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MyLedger ─────────────────────────────────────────────────
function MyLedger({ loggedInFarmer, records, destApproved }) {
  const fid = loggedInFarmer.id;

  const getMonthData = (year, mi) => {
    const rs = records[`${fid}_${year}_${mi}`] || [];
    let rev = 0, cost = 0;
    rs.forEach(r => {
      rev += (r.boxes || 0) * (r.ppb || 0);
      cost += (r.costs || []).reduce((s, c) => s + (c.a || 0), 0);
    });
    return { rev, cost, profit: rev - cost };
  };

  const getMonthCosts = (year, mi) => {
    const rs = records[`${fid}_${year}_${mi}`] || [];
    const map = {};
    rs.forEach(r => (r.costs || []).forEach(c => { if (c.l) map[c.l] = (map[c.l] || 0) + (c.a || 0); }));
    return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([l,a]) => ({l,a}));
  };

  const topN = (items, n) => {
    if (items.length <= n) return items;
    const rest = items.slice(n).reduce((s,c) => s + c.a, 0);
    return [...items.slice(0, n), { l:"その他", a:rest }];
  };

  const monthlyData = MONTHS.map((label, mi) => ({ label, mi, ...getMonthData(THIS_YEAR, mi) }));

  const destMap = {};
  Object.entries(records).forEach(([k, arr]) => {
    if (!k.startsWith(fid + "_")) return;
    arr.forEach(r => {
      if (!destMap[r.destId]) destMap[r.destId] = { rev: 0, cost: 0 };
      destMap[r.destId].rev += (r.boxes || 0) * (r.ppb || 0);
      destMap[r.destId].cost += (r.costs || []).reduce((s, c) => s + (c.a || 0), 0);
    });
  });
  const destCards = Object.entries(destMap).map(([id, d]) => {
    const dest = destApproved.find(x => x.id === id);
    const profit = d.rev - d.cost;
    const costRate = d.rev > 0 ? Math.round(d.cost / d.rev * 100) : 0;
    return { id, name: dest?.name || "不明", ...d, profit, costRate };
  }).sort((a, b) => a.costRate - b.costRate);

  const curMi = new Date().getMonth();
  const curData = getMonthData(THIS_YEAR, curMi);
  const prevData = getMonthData(THIS_YEAR - 1, curMi);
  const hasPrev = (records[`${fid}_${THIS_YEAR - 1}_${curMi}`] || []).length > 0;

  const costLabels = {};
  Object.entries(records).forEach(([k, arr]) => {
    if (!k.startsWith(fid + "_")) return;
    arr.forEach(r => {
      (r.costs || []).forEach(c => {
        if (!c.l) return;
        costLabels[c.l] = (costLabels[c.l] || 0) + (c.a || 0);
      });
    });
  });
  const costItems = Object.entries(costLabels).sort((a, b) => b[1] - a[1]);
  const totalCost = costItems.reduce((s, [, v]) => s + v, 0);

  const totalRev = monthlyData.reduce((s, d) => s + d.rev, 0);

  const getDestCosts = (destId) => {
    const map = {};
    Object.entries(records).forEach(([k, arr]) => {
      if (!k.startsWith(fid + "_")) return;
      arr.filter(r => r.destId === destId).forEach(r => {
        (r.costs || []).forEach(c => {
          if (!c.l) return;
          map[c.l] = (map[c.l] || 0) + (c.a || 0);
        });
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([l, a]) => ({l, a}));
  };

  return (
    <div className="appear" style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 24 }}>

      {/* 1. 月次推移 */}
      <div className="ledger-card" style={{ padding: 24, background: C.cream, borderRadius: 12 }}>
        <p className="f-sans" style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 16 }}>月次推移（{THIS_YEAR}年）</p>
        <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:8 }}>
          {monthlyData.map((d, i) => (
            <div key={i} style={{ flexShrink:0, width:280, padding:"14px 16px", background:"#fff", border:`1px solid ${C.rule}`, borderRadius:16 }}>
              <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:C.ink, marginBottom:10 }}>{d.label}</p>
              <BalanceSheet revenue={d.rev} costs={getMonthCosts(THIS_YEAR, d.mi)} compact={true} />
            </div>
          ))}
        </div>
      </div>

      {/* 2. 出荷先別採算 */}
      <div className="ledger-card" style={{ padding: 24, background: C.cream, borderRadius: 12 }}>
        <p className="f-sans" style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 16 }}>出荷先別採算（経費率 低い順）</p>
        {destCards.length === 0
          ? <p className="f-sans" style={{ fontSize: 12, color: C.ghost }}>データがありません</p>
          : <div style={{ display: "grid", gap: 12 }}>
              {destCards.map(d => (
                <div key={d.id} style={{ padding: "14px 16px", border: `1px solid ${C.rule}`, borderRadius: 16, background: "#fff" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                    <DestMark name={d.name} sz={28} showLabel={true} />
                  </div>
                  <BalanceSheet revenue={d.rev} costs={getDestCosts(d.id)} />
                </div>
              ))}
            </div>
        }
      </div>

      {/* 3. 前年同月比較 */}
      <div className="ledger-card" style={{ padding: 24, background: C.cream, borderRadius: 12 }}>
        <p className="f-sans" style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 4 }}>前年同月比較 — {MONTHS[curMi]}</p>
        {!hasPrev
          ? <p className="f-sans" style={{ fontSize: 12, color: C.ghost, marginTop: 12 }}>前年データなし</p>
          : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginTop: 14 }}>
              {[{lbl:"売上",cur:curData.rev,prev:prevData.rev},{lbl:"経費",cur:curData.cost,prev:prevData.cost},{lbl:"利益",cur:curData.profit,prev:prevData.profit}].map(row => {
                const diff = row.cur - row.prev;
                const up = diff >= 0;
                const color = row.lbl === "経費" ? (up ? C.shu : C.bamboo) : (up ? C.bamboo : C.shu);
                return (
                  <div key={row.lbl} style={{ padding: "12px 14px", background: C.ivory, borderRadius: 10 }}>
                    <p className="f-sans" style={{ fontSize: 10, color: C.ghost, marginBottom: 4 }}>{row.lbl}</p>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                      <span className="f-mono" style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{man(row.cur)}</span>
                      <span className="f-sans" style={{ fontSize: 11, color, fontWeight: 700 }}>{up ? "↑" : "↓"} {man(Math.abs(diff))}</span>
                    </div>
                    <p className="f-sans" style={{ fontSize: 9, color: C.ghost, marginTop: 2 }}>前年: {man(row.prev)}</p>
                  </div>
                );
              })}
            </div>
        }
      </div>

      {/* 4. 経費内訳（全期間） */}
      <div className="ledger-card" style={{ padding: 24, background: C.cream, borderRadius: 12 }}>
        <p className="f-sans" style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 16 }}>経費内訳（全期間）</p>
        {costItems.length === 0
          ? <p className="f-sans" style={{ fontSize: 12, color: C.ghost }}>経費データなし</p>
          : <BalanceSheet revenue={totalRev} costs={costItems.map(([l, a]) => ({l, a}))} />
        }
      </div>

    </div>
  );
}

// ── FiveYearPlanTab ──────────────────────────────────────────
function FiveYearPlanTab({ loggedInFarmer, records }) {
  const PLAN_YEARS = Array.from({ length: 5 }, (_, i) => THIS_YEAR + i); // kept for compat
  const today = new Date().toLocaleDateString("ja-JP", { year:"numeric", month:"long", day:"numeric" });
  const YR_LABELS = ["直近実績","1年目","2年目","3年目","4年目","5年目(目標)"];

  // ── records ──────────────────────────────────────────────
  const myRecs = MONTHS.flatMap((_, mi) =>
    records[`${loggedInFarmer.id}_${THIS_YEAR}_${mi}`] || []
  );
  const myCrops = [...new Set(myRecs.map(r => r.crop).filter(Boolean))];

  // 作物別売上実績（千円）
  const cropRev0 = crop =>
    Math.round(
      myRecs.filter(r => r.crop === crop)
            .reduce((s, r) => s + (r.boxes || 0) * (r.ppb || 0), 0) / 1000
    );

  // 出荷販売経費実績（手数料・運賃合算、千円）
  const shipping0 = Math.round(
    myRecs.flatMap(r => r.costs || [])
          .filter(c => c.l && (c.l.includes("手数料") || c.l.includes("運賃")))
          .reduce((s, c) => s + (c.a || 0), 0) / 1000
  );

  // ── state（全inputをlocalStorageに自動保存）────────────────
  const lsKey = `plan5_${loggedInFarmer.id}`;
  const [vals, setVals] = useState(() => {
    try { return JSON.parse(localStorage.getItem(lsKey) || "{}"); }
    catch { return {}; }
  });
  const set = (key, yi, v) => {
    const next = { ...vals, [`${key}_${yi}`]: v };
    setVals(next);
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
  };

  // 数値取得：yi=0は実績値優先、yi=1はデフォルト=実績、yi>=2はカスケード
  const num = (key, yi, actDef = 0) => {
    const stored = vals[`${key}_${yi}`];
    if (stored !== undefined && stored !== "") return parseFloat(stored) || 0;
    if (yi <= 1) return actDef;
    return num(key, yi - 1, actDef);
  };

  // input表示文字列
  const inp = (key, yi, actDef = 0) => {
    const stored = vals[`${key}_${yi}`];
    if (stored !== undefined) return stored;
    if (yi <= 1) return actDef !== 0 ? String(actDef) : "";
    const pv = num(key, yi - 1, actDef);
    return pv !== 0 ? String(pv) : "";
  };

  // ── 集計関数 ─────────────────────────────────────────────
  const grossRevY = yi =>
    myCrops.reduce((s, c) => s + num(`cr_${c}_rev`, yi, cropRev0(c)), 0)
    + num("work_recv", yi, 0)
    + num("other_rev", yi, 0);

  const totalCostY = yi =>
    num("c_material", yi, 0)
    + num("c_facility", yi, 0)
    + num("c_deprec", yi, 0)
    + num("c_shipping", yi, shipping0)
    + num("c_labor", yi, 0)
    + num("c_interest", yi, 0)
    + num("c_rent", yi, 0)
    + num("c_other_cost", yi, 0);

  const farmIncomeY   = yi => grossRevY(yi) - totalCostY(yi);
  const totalIncomeY  = yi => farmIncomeY(yi) + num("non_farm", yi, 0) + num("pension", yi, 0);
  const repaySourceY  = yi => totalIncomeY(yi) - num("household", yi, 1080) - num("tax", yi, 150);
  const surplusY      = yi => repaySourceY(yi) - num("repay_principal", yi, 0);
  const totalDebtY    = yi =>
    num("debt_short", yi, 0) + num("debt_long", yi, 0) + num("debt_nonfarm", yi, 0);

  // ── スタイル定数 ─────────────────────────────────────────
  const b   = "1px solid #CCC";
  const cs  = { border: b, padding: "6px 8px", fontSize: 12 };
  const cats = { ...cs, background: "#F5F5F5", fontWeight: 600 };
  const aus  = { ...cs, background: "#FAFAFA", textAlign: "right", fontFamily: "'DM Mono',monospace" };
  const ls   = { ...cs, paddingLeft: 20 };
  const ics  = { border: b, padding: 0 };
  const us   = { ...cs, textAlign: "center", fontSize: 10, color: C.mid };
  const is_  = {
    border: "none", background: "transparent", textAlign: "right",
    width: "100%", padding: "6px 8px", fontSize: 12,
    fontFamily: "'DM Mono',monospace", color: "inherit", outline: "none", display: "block",
  };

  // ── セルコンポーネント ───────────────────────────────────
  const AutoCell = ({ v }) => (
    <td style={{ ...aus, color: v < 0 ? "#E24B4A" : undefined }}>{v.toLocaleString("ja-JP")}</td>
  );

  const InputCell = ({ rowKey, yi, actDef = 0 }) => (
    <td style={ics}>
      <input type="number" value={inp(rowKey, yi, actDef)}
        onChange={e => set(rowKey, yi, e.target.value)} style={is_} />
    </td>
  );

  // 直近実績は実績値表示（読取専用）、1〜5年目はinput
  const CropRevCell = ({ crop, yi }) =>
    yi === 0
      ? <td style={aus}>{cropRev0(crop) !== 0 ? cropRev0(crop).toLocaleString("ja-JP") : "—"}</td>
      : <InputCell rowKey={`cr_${crop}_rev`} yi={yi} actDef={cropRev0(crop)} />;

  const ShippingCell = ({ yi }) =>
    yi === 0
      ? <td style={aus}>{shipping0 !== 0 ? shipping0.toLocaleString("ja-JP") : "—"}</td>
      : <InputCell rowKey="c_shipping" yi={yi} actDef={shipping0} />;

  // ── 行コンポーネント（レンダー関数）──────────────────────
  const CatRow = ({ label, calcFn }) => (
    <tr>
      <td colSpan={2} style={cats}>{label}</td>
      {[0,1,2,3,4,5].map(yi => <AutoCell key={yi} v={calcFn(yi)} />)}
      <td style={cats}></td>
    </tr>
  );

  const InpRow = ({ label, unit, rowKey, actDef = 0 }) => (
    <tr>
      <td style={ls}>{label}</td>
      <td style={us}>{unit}</td>
      {[0,1,2,3,4,5].map(yi => <InputCell key={yi} rowKey={rowKey} yi={yi} actDef={actDef} />)}
      <td style={cs}></td>
    </tr>
  );

  const AutoRow = ({ label, calcFn }) => (
    <tr>
      <td colSpan={2} style={{ ...cs, fontWeight: 700 }}>{label}</td>
      {[0,1,2,3,4,5].map(yi => <AutoCell key={yi} v={calcFn(yi)} />)}
      <td style={cs}></td>
    </tr>
  );

  return (
    <div className="appear" id="five-year-plan">

      {/* PDF出力ボタン */}
      <div className="no-print" style={{ display:"flex", justifyContent:"flex-end", marginBottom:16, gap:8 }}>
        <button onClick={() => window.print()} className="btn-primary" style={{ padding:"10px 24px", fontSize:13 }}>
          収支計画書をPDF出力
        </button>
      </div>

      {/* 表ヘッダー */}
      <div style={{ maxWidth:900, margin:"0 auto 10px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:6 }}>
          <div>
            <p className="f-sans" style={{ fontSize:13, color:C.ink, fontWeight:600 }}>{loggedInFarmer.name}</p>
            <p className="f-sans" style={{ fontSize:10, color:C.mid }}>
              作成日：{today}　　日本農業研究所（chitose-bank.com）
            </p>
          </div>
          <p className="f-sans" style={{ fontSize:11, color:C.mid }}>金額単位：千円</p>
        </div>
        <h2 className="f-sans" style={{ fontSize:18, fontWeight:800, color:C.ink, letterSpacing:".03em" }}>
          収支計画書（個人）
        </h2>
      </div>

      {/* テーブル */}
      <div style={{ overflowX:"auto", maxWidth:900, margin:"0 auto", printColorAdjust:"exact", WebkitPrintColorAdjust:"exact" }}>
        <table style={{ minWidth:800, width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={{ ...cats, textAlign:"left", minWidth:170 }}>項目</th>
              <th style={{ ...cats, textAlign:"center", width:44 }}>単位</th>
              {YR_LABELS.map(l => (
                <th key={l} style={{ ...cats, textAlign:"center", minWidth:86 }}>{l}</th>
              ))}
              <th style={{ ...cats, textAlign:"left", minWidth:80 }}>備考</th>
            </tr>
          </thead>
          <tbody>

            {/* ─── 農業粗収入 ─── */}
            {CatRow({ label:"農業粗収入", calcFn:grossRevY })}

            {myCrops.flatMap(crop => [
              <tr key={`${crop}_scale`}>
                <td style={ls}>{crop}（生産規模）</td>
                <td style={us}>a</td>
                {[0,1,2,3,4,5].map(yi => <InputCell key={yi} rowKey={`cr_${crop}_scale`} yi={yi} actDef={0} />)}
                <td style={cs}></td>
              </tr>,
              <tr key={`${crop}_qty`}>
                <td style={ls}>{crop}（生産量）</td>
                <td style={us}>kg</td>
                {[0,1,2,3,4,5].map(yi => <InputCell key={yi} rowKey={`cr_${crop}_qty`} yi={yi} actDef={0} />)}
                <td style={cs}></td>
              </tr>,
              <tr key={`${crop}_rev`}>
                <td style={ls}>{crop}（収入金額）</td>
                <td style={us}>千円</td>
                {[0,1,2,3,4,5].map(yi => <CropRevCell key={yi} crop={crop} yi={yi} />)}
                <td style={cs}></td>
              </tr>,
            ])}

            {InpRow({ label:"作業受託収入", unit:"千円", rowKey:"work_recv", actDef:0 })}
            {InpRow({ label:"その他", unit:"千円", rowKey:"other_rev", actDef:0 })}

            {/* ─── 農業経営費 ─── */}
            {CatRow({ label:"農業経営費", calcFn:totalCostY })}
            {InpRow({ label:"原材料費", unit:"千円", rowKey:"c_material", actDef:0 })}
            {InpRow({ label:"施設・機械費", unit:"千円", rowKey:"c_facility", actDef:0 })}
            {InpRow({ label:"減価償却費", unit:"千円", rowKey:"c_deprec", actDef:0 })}
            <tr>
              <td style={ls}>出荷販売経費</td>
              <td style={us}>千円</td>
              {[0,1,2,3,4,5].map(yi => <ShippingCell key={yi} yi={yi} />)}
              <td style={cs}></td>
            </tr>
            {InpRow({ label:"雇用労賃", unit:"千円", rowKey:"c_labor", actDef:0 })}
            {InpRow({ label:"支払利息", unit:"千円", rowKey:"c_interest", actDef:0 })}
            {InpRow({ label:"支払地代", unit:"千円", rowKey:"c_rent", actDef:0 })}
            {InpRow({ label:"その他", unit:"千円", rowKey:"c_other_cost", actDef:0 })}

            {/* ─── 農業所得 ─── */}
            {AutoRow({ label:"農業所得", calcFn:farmIncomeY })}

            {InpRow({ label:"農外所得", unit:"千円", rowKey:"non_farm", actDef:0 })}
            {InpRow({ label:"年金被贈等", unit:"千円", rowKey:"pension", actDef:0 })}

            {/* ─── 農家総所得 ─── */}
            {AutoRow({ label:"農家総所得", calcFn:totalIncomeY })}

            {InpRow({ label:"家計費", unit:"千円", rowKey:"household", actDef:1080 })}
            {InpRow({ label:"租税公課", unit:"千円", rowKey:"tax", actDef:150 })}

            {/* ─── 償還財源 ─── */}
            {AutoRow({ label:"償還財源", calcFn:repaySourceY })}

            {InpRow({ label:"償還元金", unit:"千円", rowKey:"repay_principal", actDef:0 })}

            {/* ─── 差引余剰 ─── */}
            {AutoRow({ label:"差引余剰", calcFn:surplusY })}

            {InpRow({ label:"施設・機械等の設備投資", unit:"千円", rowKey:"capex", actDef:0 })}
            {InpRow({ label:"農業負債（短期）", unit:"千円", rowKey:"debt_short", actDef:0 })}
            {InpRow({ label:"農業負債（長期）", unit:"千円", rowKey:"debt_long", actDef:0 })}
            {InpRow({ label:"農外負債", unit:"千円", rowKey:"debt_nonfarm", actDef:0 })}

            {/* ─── 負債合計 ─── */}
            {AutoRow({ label:"負債合計", calcFn:totalDebtY })}

          </tbody>
        </table>
      </div>

      {/* 注釈 */}
      <div className="f-sans" style={{ maxWidth:900, margin:"12px auto 40px", fontSize:10, color:C.mid, lineHeight:2 }}>
        <p>注1：品目に合わせて生産規模・生産量の単位を記載してください。</p>
        <p>注2：特別の事情があるときは直近実績欄に前期実績を記入可。</p>
        <p>数値的根拠：農水省統計および日本農業研究所の実績データに基づく。</p>
      </div>

    </div>
  );
}

// ── AdminTab ─────────────────────────────────────────────────
function AdminTab() {
  const [sub, setSub] = useState("farmers");
  const [farmers, setFarmers] = useState([]);
  const [dests, setDests] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null); // {msg, onOk}

  // フィルター (記録データ)
  const [filterFarmer, setFilterFarmer] = useState("");
  const [filterCrop,   setFilterCrop]   = useState("");
  const [filterDest,   setFilterDest]   = useState("");
  const [filterMonth,  setFilterMonth]  = useState("");

  // 新規出荷先フォーム
  const [newDestName, setNewDestName] = useState("");
  const [newDestNote, setNewDestNote] = useState("");
  const [addingDest, setAddingDest]   = useState(false);

  const TIERS = ["1-3","4-10","10+"];

  const load = useCallback(async () => {
    setLoading(true);
    const [fr, de, re] = await Promise.all([
      supabase.from("farmers").select("*").order("created_at", { ascending: false }),
      supabase.from("dests").select("*").order("name"),
      supabase.from("records").select("*").order("year,month"),
    ]);
    if (!fr.error) setFarmers(fr.data || []);
    if (!de.error) setDests(de.data || []);
    if (!re.error) setRecords(re.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ask = (msg, onOk) => setConfirm({ msg, onOk });
  const closeConfirm = () => setConfirm(null);

  // ── 農家 actions ──
  const updateTier = async (id, tier) => {
    await supabase.from("farmers").update({ experience_tier: tier }).eq("id", id);
    setFarmers(prev => prev.map(f => f.id === id ? { ...f, experience_tier: tier } : f));
  };
  const deleteFarmer = (f) => ask(
    `「${f.name}」を削除しますか？この操作は元に戻せません。`,
    async () => {
      await supabase.from("farmers").delete().eq("id", f.id);
      setFarmers(prev => prev.filter(x => x.id !== f.id));
    }
  );

  // ── 出荷先 actions ──
  const approveDest = async (d) => {
    await supabase.from("dests").update({ status: "approved" }).eq("id", d.id);
    setDests(prev => prev.map(x => x.id === d.id ? { ...x, status: "approved" } : x));
  };
  const deleteDest = (d) => ask(
    `「${d.name}」を削除しますか？`,
    async () => {
      await supabase.from("dests").delete().eq("id", d.id);
      setDests(prev => prev.filter(x => x.id !== d.id));
    }
  );
  const addDest = async () => {
    if (!newDestName.trim()) return;
    const row = { id: uid(), name: newDestName.trim(), status: "approved", notes: newDestNote.trim() || null };
    const { error } = await supabase.from("dests").insert(row);
    if (!error) { setDests(prev => [...prev, row]); setNewDestName(""); setNewDestNote(""); setAddingDest(false); }
  };

  // ── 記録 actions ──
  const deleteRecord = (r) => ask(
    `この記録（${r.crop || "不明"} / ${r.year}年${r.month+1}月）を削除しますか？`,
    async () => {
      await supabase.from("records").delete()
        .eq("farmer_id", r.farmer_id).eq("year", r.year).eq("month", r.month).eq("dest_id", r.dest_id);
      setRecords(prev => prev.filter(x => !(x.farmer_id===r.farmer_id&&x.year===r.year&&x.month===r.month&&x.dest_id===r.dest_id)));
    }
  );

  // 派生データ
  const farmerMap = Object.fromEntries(farmers.map(f => [f.id, f]));
  const destMap   = Object.fromEntries(dests.map(d => [d.id, d]));
  const filteredRecs = records.filter(r => {
    const fn = farmerMap[r.farmer_id]?.name || "";
    if (filterFarmer && !fn.includes(filterFarmer)) return false;
    if (filterCrop && !(r.crop || "").includes(filterCrop)) return false;
    if (filterDest && r.dest_id !== filterDest) return false;
    if (filterMonth !== "" && r.month !== Number(filterMonth)) return false;
    return true;
  });

  // 統計
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate()-30);
  const activeFarmerIds = new Set(records.map(r=>r.farmer_id));
  const cropCount = {};
  records.forEach(r => { if(r.crop) cropCount[r.crop]=(cropCount[r.crop]||new Set()).add(r.farmer_id)||cropCount[r.crop]; });
  const destRecCount = {};
  records.forEach(r => { destRecCount[r.dest_id]=(destRecCount[r.dest_id]||0)+1; });

  const NOTIF_SQL = `CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id uuid REFERENCES auth.users(id) NOT NULL,
  type text NOT NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (auth.uid() = farmer_id)
  WITH CHECK (auth.uid() = farmer_id);
CREATE INDEX idx_notifications_farmer
  ON notifications(farmer_id, created_at DESC);`;

  const VARIETY_SQL = `ALTER TABLE records ADD COLUMN IF NOT EXISTS variety text DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS is_brand boolean DEFAULT false;`;

  const SUB_TABS = [
    { k:"farmers", l:"農家",     n: farmers.length },
    { k:"dests",   l:"出荷先",   n: dests.filter(d=>d.status==="pending").length },
    { k:"records", l:"記録データ", n: records.length },
    { k:"stats",   l:"統計",     n: null },
    { k:"sql",     l:"SQL",      n: null },
  ];

  const Card = ({ children, style }) => (
    <div className="ledger-card" style={{ padding:"16px 20px", ...style }}>{children}</div>
  );
  const DangerBtn = ({ onClick, children }) => (
    <button onClick={onClick} style={{
      padding:"6px 14px", border:"1px solid #E24B4A44", borderRadius:8,
      background:"transparent", color:"#E24B4A", fontSize:11, fontWeight:600, cursor:"pointer",
    }}>{children}</button>
  );

  return (
    <div className="appear" style={{ maxWidth:800, margin:"0 auto" }}>

      {/* 確認ダイアログ */}
      {confirm && (
        <div style={{ position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
          <div style={{ background:"#fff",borderRadius:16,padding:28,maxWidth:360,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.15)" }}>
            <p className="f-sans" style={{ fontSize:14,color:"#222",lineHeight:1.8,marginBottom:20 }}>{confirm.msg}</p>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}>
              <button onClick={closeConfirm} className="btn-outline" style={{ padding:"9px 20px",fontSize:12 }}>キャンセル</button>
              <button onClick={()=>{ confirm.onOk(); closeConfirm(); }} style={{
                padding:"9px 20px",background:"#E24B4A",color:"#fff",border:"none",borderRadius:12,fontSize:12,fontWeight:600,cursor:"pointer",
              }}>削除する</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom:20 }}>
        <p className="f-sans" style={{ fontSize:18,fontWeight:700,color:"#222",marginBottom:4 }}>管理者コンソール</p>
        <p className="f-sans" style={{ fontSize:12,color:"#717171" }}>農家・出荷先・記録データの管理</p>
      </div>

      {/* サブタブ */}
      <div style={{ display:"flex",gap:4,background:"#F7F7F7",border:"1px solid #EBEBEB",borderRadius:12,padding:4,marginBottom:24 }}>
        {SUB_TABS.map(({ k, l, n }) => (
          <button key={k} onClick={() => setSub(k)} style={{
            flex:1, padding:"9px 8px", border:"none", borderRadius:8, fontFamily:"inherit",
            background:sub===k?"#fff":"transparent",
            color:sub===k?"#222":"#717171",
            fontSize:12, fontWeight:sub===k?700:400,
            boxShadow:sub===k?"0 1px 4px rgba(0,0,0,0.08)":"none",
            display:"flex", alignItems:"center", justifyContent:"center", gap:5,
          }}>
            {l}
            {n!=null&&n>0&&<span style={{ padding:"1px 6px",borderRadius:8,fontSize:9,fontWeight:700,background:sub===k?"#E6F7EF":"#EBEBEB",color:sub===k?"#00A86B":"#717171" }}>{n}</span>}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign:"center",padding:48,color:"#B0B0B0",fontSize:13 }}>読み込み中...</div>}

      {/* ── 農家管理 ── */}
      {!loading && sub==="farmers" && (
        <div className="fade-in" style={{ display:"grid",gap:12 }}>
          {farmers.length===0 && <p className="f-sans" style={{ fontSize:13,color:"#B0B0B0",padding:"32px 0",textAlign:"center" }}>農家がいません</p>}
          {farmers.map(f => (
            <Card key={f.id}>
              <div style={{ display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
                <div style={{ width:40,height:40,borderRadius:"50%",background:"#E6F7EF",border:"2px solid #00A86B",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>🌾</div>
                <div style={{ flex:1,minWidth:140 }}>
                  <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222" }}>{f.name}</p>
                  <p className="f-sans" style={{ fontSize:11,color:"#717171",marginTop:2 }}>{f.email}</p>
                  {f.created_at && <p className="f-sans" style={{ fontSize:10,color:"#B0B0B0",marginTop:2 }}>登録日: {new Date(f.created_at).toLocaleDateString("ja-JP")}</p>}
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
                  <div>
                    <p className="f-sans" style={{ fontSize:9,color:"#B0B0B0",marginBottom:3 }}>就農年数</p>
                    <select value={f.experience_tier||"1-3"} onChange={e=>updateTier(f.id,e.target.value)} style={{
                      padding:"6px 10px",border:"1px solid #EBEBEB",borderRadius:8,fontSize:12,background:"#fff",cursor:"pointer",fontFamily:"inherit",
                    }}>
                      {TIERS.map(t=><option key={t} value={t}>{t}年</option>)}
                    </select>
                  </div>
                  <DangerBtn onClick={()=>deleteFarmer(f)}>削除</DangerBtn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── 出荷先管理 ── */}
      {!loading && sub==="dests" && (
        <div className="fade-in">
          <div style={{ display:"grid",gap:12,marginBottom:20 }}>
            {dests.map(d => (
              <Card key={d.id}>
                <div style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
                  <DestMark name={d.name} sz={36} showLabel={false}/>
                  <div style={{ flex:1,minWidth:120 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:2 }}>
                      <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222" }}>{d.name}</p>
                      <span style={{
                        padding:"2px 8px",borderRadius:8,fontSize:10,fontWeight:700,
                        background:d.status==="approved"?"#E6F7EF":"#FEF3E2",
                        color:d.status==="approved"?"#00A86B":"#F5A623",
                      }}>{d.status==="approved"?"承認済":"承認待ち"}</span>
                    </div>
                    {d.notes&&<p className="f-sans" style={{ fontSize:11,color:"#717171" }}>{d.notes}</p>}
                    {d.submitted_by&&<p className="f-sans" style={{ fontSize:10,color:"#B0B0B0" }}>申請者: {d.submitted_by}</p>}
                  </div>
                  <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                    {d.status==="pending"&&(
                      <button onClick={()=>approveDest(d)} style={{ padding:"7px 16px",background:"#00A86B",color:"#fff",border:"none",borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer" }}>承認</button>
                    )}
                    <DangerBtn onClick={()=>deleteDest(d)}>削除</DangerBtn>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* 新規追加フォーム */}
          {!addingDest
            ? <button onClick={()=>setAddingDest(true)} style={{ width:"100%",padding:14,border:"1.5px dashed #EBEBEB",borderRadius:16,background:"transparent",color:"#717171",fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>＋ 出荷先を手動追加</button>
            : <Card style={{ border:"1.5px solid #00A86B" }}>
                <p className="f-sans" style={{ fontSize:13,fontWeight:700,color:"#222",marginBottom:14 }}>新規出荷先</p>
                <div style={{ display:"grid",gap:10 }}>
                  <input className="field f-sans" placeholder="出荷先名（必須）" value={newDestName} onChange={e=>setNewDestName(e.target.value)}/>
                  <input className="field f-sans" placeholder="メモ（任意）" value={newDestNote} onChange={e=>setNewDestNote(e.target.value)}/>
                  <div style={{ display:"flex",gap:8 }}>
                    <button className="btn-primary" style={{ flex:1 }} onClick={addDest}>追加する</button>
                    <button className="btn-outline" onClick={()=>setAddingDest(false)}>キャンセル</button>
                  </div>
                </div>
              </Card>
          }
        </div>
      )}

      {/* ── 記録データ管理 ── */}
      {!loading && sub==="records" && (
        <div className="fade-in">
          {/* フィルター */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:16 }}>
            <input className="field f-sans" placeholder="農家名で絞り込み" value={filterFarmer} onChange={e=>setFilterFarmer(e.target.value)} style={{ fontSize:12 }}/>
            <input className="field f-sans" placeholder="作物で絞り込み" value={filterCrop} onChange={e=>setFilterCrop(e.target.value)} style={{ fontSize:12 }}/>
            <select className="field f-sans" value={filterDest} onChange={e=>setFilterDest(e.target.value)} style={{ fontSize:12 }}>
              <option value="">出荷先すべて</option>
              {dests.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="field f-sans" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{ fontSize:12 }}>
              <option value="">月すべて</option>
              {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <p className="f-sans" style={{ fontSize:11,color:"#B0B0B0",marginBottom:12 }}>{filteredRecs.length} 件</p>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12,fontFamily:"'Noto Sans JP','Inter',sans-serif",minWidth:640 }}>
              <thead>
                <tr style={{ borderBottom:"2px solid #EBEBEB",color:"#B0B0B0",fontSize:10 }}>
                  {["農家","作物","年月","出荷先","箱数","単価","売上","経費","利益",""].map(h=>(
                    <th key={h} style={{ padding:"8px 10px",textAlign:"left",fontWeight:600,whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRecs.map((r,i)=>{
                  const rev=(r.boxes||0)*(r.ppb||0);
                  const cost=(r.costs||[]).reduce((s,c)=>s+(c.a||0),0);
                  const profit=rev-cost;
                  return(
                    <tr key={i} style={{ borderBottom:"1px solid #F7F7F7" }}>
                      <td style={{ padding:"10px 10px",color:"#222",fontWeight:500 }}>{farmerMap[r.farmer_id]?.name||"不明"}</td>
                      <td style={{ padding:"10px 10px",color:"#444" }}>{r.crop||"—"}</td>
                      <td style={{ padding:"10px 10px",color:"#444",whiteSpace:"nowrap" }}>{r.year}/{r.month+1}月</td>
                      <td style={{ padding:"10px 10px",color:"#444" }}>{destMap[r.dest_id]?.name||"不明"}</td>
                      <td style={{ padding:"10px 10px",color:"#444",fontFamily:"'DM Mono',monospace" }}>{r.boxes}</td>
                      <td style={{ padding:"10px 10px",color:"#444",fontFamily:"'DM Mono',monospace" }}>{cn(r.ppb)}</td>
                      <td style={{ padding:"10px 10px",color:"#00A86B",fontFamily:"'DM Mono',monospace",fontWeight:600 }}>{man(rev)}</td>
                      <td style={{ padding:"10px 10px",color:"#F5A623",fontFamily:"'DM Mono',monospace" }}>{man(cost)}</td>
                      <td style={{ padding:"10px 10px",color:profit>=0?"#00A86B":"#E24B4A",fontFamily:"'DM Mono',monospace",fontWeight:600 }}>{man(profit)}</td>
                      <td style={{ padding:"10px 10px" }}>
                        <DangerBtn onClick={()=>deleteRecord(r)}>削除</DangerBtn>
                      </td>
                    </tr>
                  );
                })}
                {filteredRecs.length===0&&(
                  <tr><td colSpan={10} style={{ padding:"32px 0",textAlign:"center",color:"#B0B0B0" }}>該当するデータがありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 統計 ── */}
      {!loading && sub==="stats" && (
        <div className="fade-in" style={{ display:"grid",gap:16 }}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12 }}>
            {[
              { l:"登録農家数", v:farmers.length, icon:"🌾" },
              { l:"アクティブ農家", v:activeFarmerIds.size, icon:"✅" },
              { l:"総レコード数", v:records.length, icon:"📋" },
              { l:"出荷先数", v:dests.filter(d=>d.status==="approved").length, icon:"🚚" },
            ].map(s=>(
              <Card key={s.l} style={{ textAlign:"center" }}>
                <div style={{ fontSize:28,marginBottom:8 }}>{s.icon}</div>
                <div className="f-sans" style={{ fontSize:28,fontWeight:700,color:"#222" }}>{s.v}</div>
                <div className="f-sans" style={{ fontSize:11,color:"#717171",marginTop:4 }}>{s.l}</div>
              </Card>
            ))}
          </div>
          <Card>
            <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:14 }}>作物別 農家数</p>
            {Object.entries(
              records.reduce((acc,r)=>{ if(r.crop){if(!acc[r.crop])acc[r.crop]=new Set();acc[r.crop].add(r.farmer_id);}return acc;},{})
            ).sort((a,b)=>b[1].size-a[1].size).map(([crop,ids])=>(
              <div key={crop} style={{ display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #F7F7F7" }}>
                <span className="f-sans" style={{ fontSize:13,color:"#222" }}>{crop}</span>
                <span className="f-sans" style={{ fontSize:13,fontWeight:600,color:"#00A86B" }}>{ids.size}農家</span>
              </div>
            ))}
            {Object.keys(records.reduce((a,r)=>{if(r.crop)a[r.crop]=1;return a},{})).length===0&&(
              <p className="f-sans" style={{ fontSize:12,color:"#B0B0B0" }}>データなし</p>
            )}
          </Card>
          <Card>
            <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:14 }}>出荷先別 レコード数</p>
            {Object.entries(destRecCount).sort((a,b)=>b[1]-a[1]).map(([destId,cnt])=>(
              <div key={destId} style={{ display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #F7F7F7" }}>
                <span className="f-sans" style={{ fontSize:13,color:"#222" }}>{destMap[destId]?.name||"不明"}</span>
                <span className="f-sans" style={{ fontSize:13,fontWeight:600,color:"#717171" }}>{cnt}件</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* ── SQL ── */}
      {!loading && sub==="sql" && (
        <div className="fade-in" style={{ display:"grid",gap:16 }}>
          <Card>
            <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:4 }}>records 列追加SQL（品種・ブランド）</p>
            <p className="f-sans" style={{ fontSize:11,color:"#717171",marginBottom:16 }}>Supabase SQL Editorで実行してください。</p>
            <pre style={{
              background:"#F7F7F7",borderRadius:12,padding:16,overflowX:"auto",
              fontFamily:"'DM Mono','Courier New',monospace",fontSize:12,color:"#222",lineHeight:1.7,margin:0,
              border:"1px solid #EBEBEB",whiteSpace:"pre",
            }}>{VARIETY_SQL}</pre>
            <button onClick={()=>navigator.clipboard.writeText(VARIETY_SQL)} style={{
              marginTop:12,padding:"8px 20px",background:"#00A86B",color:"#fff",border:"none",
              borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer",
            }}>SQLをコピー</button>
          </Card>
          <Card>
            <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:4 }}>notifications テーブル作成SQL</p>
            <p className="f-sans" style={{ fontSize:11,color:"#717171",marginBottom:16 }}>Supabase SQL Editorで実行してください。</p>
            <pre style={{
              background:"#F7F7F7",borderRadius:12,padding:16,overflowX:"auto",
              fontFamily:"'DM Mono','Courier New',monospace",fontSize:12,color:"#222",lineHeight:1.7,margin:0,
              border:"1px solid #EBEBEB",whiteSpace:"pre",
            }}>{NOTIF_SQL}</pre>
            <button onClick={()=>navigator.clipboard.writeText(NOTIF_SQL)} style={{
              marginTop:12,padding:"8px 20px",background:"#00A86B",color:"#fff",border:"none",
              borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer",
            }}>SQLをコピー</button>
          </Card>
        </div>
      )}

    </div>
  );
}


// ── ROOT ─────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("board");
  const [farmers,setFarmers]=useState([]);
  const [farmPend,setFarmPend]=useState([]);
  const [destOk,setDestOk]=useState([]);
  const [destPend,setDestPend]=useState([]);
  const [recs,setRecs]=useState({});
  const [loaded,setLoaded]=useState(false);
  const [badgeCnt,setBadgeCnt]=useState(0);
  const [me,setMe]=useState(null);
  const [authV,setAuthV]=useState("login");
  const [showTerms,setShowTerms]=useState(false);
  const [notifs,setNotifs]=useState([]);
  const [showNotifs,setShowNotifs]=useState(false);
  useEffect(()=>{
    if(!showNotifs)return;
    const close=e=>{ if(!e.target.closest('[data-notif-bell]'))setShowNotifs(false); };
    document.addEventListener('mousedown',close);
    return()=>document.removeEventListener('mousedown',close);
  },[showNotifs]);

  useEffect(()=>{(async()=>{
    const init=await sGet("yw_pres_v3");
    if(!init){
      for(const k of ["yw_pres_v1","yw_init_v3","yw_init_v4","yw_farmers","yw_farmers_pend","yw_dests_ok","yw_dests_pend","yw_records"])
        try{await window.storage.delete(k,true);}catch{}
      await sSet("yw_farmers",SEED_FARMERS);
      await sSet("yw_farmers_pend",[]);
      await sSet("yw_dests_ok",SEED_DESTS);
      await sSet("yw_dests_pend",[]);
      await sSet("yw_records",{});
      await sSet("yw_pres_v3",true);
    }
  　const { data: dbFarmers } = await supabase.from('farmers').select('*');
    const f = dbFarmers ? dbFarmers.map(fr => ({ id: fr.auth_id || fr.id, name: fr.name, email: fr.email, joinedYear: fr.joined_year })) : [];
    const fp=await sGet("yw_farmers_pend")||[];
    const { data: dbDestsOk } = await supabase.from('dests').select('*').eq('status', 'approved');
    const da = dbDestsOk ? dbDestsOk.map(d => ({ id: d.id, name: d.name, status: d.status, notes: d.notes })) : [];
    const { data: dbDestsPend } = await supabase.from('dests').select('*').eq('status', 'pending');
    const dp = dbDestsPend ? dbDestsPend.map(d => ({ id: d.id, name: d.name, status: d.status, submittedBy: d.submitted_by })) : [];
    const { data: dbRecs } = await supabase.from('records').select('*');
    const r = {};
    if (dbRecs) {
      dbRecs.forEach(rec => {
        const k = `${rec.farmer_id}_${rec.year}_${rec.month}`;
        if (!r[k]) r[k] = [];
        r[k].push({ destId: rec.dest_id, boxes: rec.boxes, ppb: rec.ppb, costs: rec.costs || [], created_at: rec.created_at });
      });
    }
    setFarmers(f);setFarmPend(fp);setDestOk(da);setDestPend(dp);setRecs(r);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const loggedIn = f.find(x => x.email?.toLowerCase() === session.user.email?.toLowerCase());
      if (loggedIn) { setMe({ ...loggedIn, id: session.user.id }); setTab("input"); }
    }
    setBadgeCnt(fp.length+dp.length);setLoaded(true);
  })();},[]);

  const savF=useCallback(async f=>{setFarmers(f);await sSet("yw_farmers",f);},[]);
  const savFP=useCallback(async f=>{setFarmPend(f);await sSet("yw_farmers_pend",f);setBadgeCnt(f.length+(destPend?.length||0));},[destPend]);
  const savDA=useCallback(async d=>{setDestOk(d);await sSet("yw_dests_ok",d);},[]);
  const savDP=useCallback(async d=>{setDestPend(d);await sSet("yw_dests_pend",d);setBadgeCnt((farmPend?.length||0)+d.length);},[farmPend]);
  const savR=useCallback(async r=>{setRecs(r);await sSet("yw_records",r);},[]);
  
const loadNotifs=useCallback(async(farmerId)=>{
    const{data}=await supabase.from('notifications').select('*').eq('farmer_id',farmerId).order('created_at',{ascending:false}).limit(10);
    if(data)setNotifs(data);
  },[]);

  const markRead=useCallback(async(id)=>{
    await supabase.from('notifications').update({read:true}).eq('id',id);
    setNotifs(prev=>prev.map(n=>n.id===id?{...n,read:true}:n));
  },[]);

  const pushNotif=useCallback(async(farmerId,type,message)=>{
    const{data}=await supabase.from('notifications').insert({farmer_id:farmerId,type,message}).select().single();
    if(data)setNotifs(prev=>[data,...prev].slice(0,10));
  },[]);

const addRec=useCallback(async(fid,yr,mi,e)=>{
    const k=`${fid}_${yr}_${mi}`;
    const newRecs={...recs,[k]:[...(recs[k]||[]).filter(x=>x.destId!==e.destId),e]};
    setRecs(newRecs);
    const { error } = await supabase.from('records').upsert({
      farmer_id: fid,
      year: yr,
      month: mi,
      dest_id: e.destId,
      boxes: e.boxes,
      ppb: e.ppb,
      costs: e.costs || [],
      crop: e.crop,
      variety: e.variety || '',
      is_brand: e.is_brand || false,
    }, { onConflict: 'farmer_id,year,month,dest_id' });
    if (error) { console.error('records upsert error:', error); return; }

    // ── 経営インサイト通知 ──
    const rev = e.boxes * e.ppb;
    const cost = (e.costs||[]).reduce((s,c)=>s+(c.a||0),0);
    if(rev<=0) return;
    const rate = Math.round(cost/rev*100);

    // 経費率50%超
    if(rate>50) await pushNotif(fid,'expense_alert',`経費率が${rate}%です。利益を圧迫しています。`);

    // 経費1項目が50%以上
    if(cost>0){
      const dominated=(e.costs||[]).find(c=>(c.a||0)/cost>=0.5&&c.l);
      if(dominated) await pushNotif(fid,'cost_concentration',`${dominated.l}が経費全体の${Math.round((dominated.a||0)/cost*100)}%を占めています。`);
    }

    // 前月比 悪化
    const prevMi=mi===0?11:mi-1;const prevYr=mi===0?yr-1:yr;
    const prevRecs=(recs[`${fid}_${prevYr}_${prevMi}`]||[]);
    if(prevRecs.length>0){
      const pr=prevRecs.find(r=>r.destId===e.destId);
      if(pr){
        const prevRev=(pr.boxes||0)*(pr.ppb||0);
        const prevCost=(pr.costs||[]).reduce((s,c)=>s+(c.a||0),0);
        if(prevRev>0){
          const prevRate=Math.round(prevCost/prevRev*100);
          const diff=rate-prevRate;
          if(diff>=5) await pushNotif(fid,'monthly_change',`前月比で経費率が${diff}%上昇しました（${prevRate}%→${rate}%）。`);
        }
      }
    }

    // 出荷先間の経費率差10%超
    const allDestRecs=Object.values(recs).flat().filter(r=>r&&r.boxes&&r.ppb);
    const destRates={};
    allDestRecs.forEach(r=>{
      const rv=(r.boxes||0)*(r.ppb||0);const cs=(r.costs||[]).reduce((s,c)=>s+(c.a||0),0);
      if(rv>0) destRates[r.destId]=Math.round(cs/rv*100);
    });
    destRates[e.destId]=rate;
    const destEntries=Object.entries(destRates);
    if(destEntries.length>=2){
      destEntries.sort((a,b)=>a[1]-b[1]);
      const[lowId,lowR]=destEntries[0];const[highId,highR]=destEntries[destEntries.length-1];
      if(highR-lowR>=10){
        const destOkLocal=destOk||[];
        const lowName=destOkLocal.find(d=>d.id===lowId)?.name||lowId;
        const highName=destOkLocal.find(d=>d.id===highId)?.name||highId;
        await pushNotif(fid,'dest_compare',`${lowName}の経費率は${lowR}%、${highName}は${highR}%です。`);
      }
    }
  },[recs,pushNotif,destOk]);
  
const subDest=useCallback(async d=>{
    await supabase.from('dests').insert({ id: d.id, name: d.name, status: 'approved', submitted_by: d.submittedBy });
    await savDA([...destOk,{...d,status:"approved"}]);
  },[destOk,savDA]);
  const subReg=useCallback(async f=>{await savFP([...farmPend,f]);},[farmPend,savFP]);
  const appFarmer=useCallback(async id=>{
    const f=farmPend.find(x=>x.id===id);if(!f)return;
    const{appliedAt,...farmer}=f;
    await supabase.from('farmers').insert({
      name: farmer.name,
      email: farmer.email,
      joined_year: farmer.joinedYear || 2025,
      status: 'approved',
    });
    await savF([...farmers,farmer]);await savFP(farmPend.filter(x=>x.id!==id));
  },[farmPend,farmers,savF,savFP]);
  const rejFarmer=useCallback(async id=>{await savFP(farmPend.filter(x=>x.id!==id));},[farmPend,savFP]);
　const appDest=useCallback(async id=>{
    const d=destPend.find(x=>x.id===id);if(!d)return;
    await supabase.from('dests').update({ status: 'approved' }).eq('id', id);
    await savDA([...destOk,{...d,status:"approved"}]);await savDP(destPend.filter(x=>x.id!==id));
  },[destPend,destOk,savDA,savDP]);
  const rejDest=useCallback(async id=>{
    await supabase.from('dests').delete().eq('id', id);
    await savDP(destPend.filter(x=>x.id!==id));
  },[destPend,savDP]);


  if(!loaded)return(
    <div style={{minHeight:"100vh",background:C.deep,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p className="f-sans pulse-slow" style={{color:C.dim,fontSize:12,letterSpacing:".1em"}}>読み込み中</p>
    </div>
  );

  // ── 貢献者レベル判定 ──────────────────────────────────────
  const myAllRecs = me
    ? Object.entries(recs).filter(([k]) => k.startsWith(me.id + "_")).flatMap(([, v]) => v)
    : [];
  const createdDates = myAllRecs.map(r => r.created_at).filter(Boolean).map(d => new Date(d));
  const lastInputDate = createdDates.length > 0 ? new Date(Math.max(...createdDates)) : null;
  const daysSinceInput = lastInputDate !== null
    ? Math.floor((Date.now() - lastInputDate.getTime()) / 86400000)
    : null;
  const isContributor = lastInputDate !== null && daysSinceInput <= 30;
  const isMember = !!me;
  const userLevel = !me ? 1 : isContributor ? 3 : 2;

  const TABS=[
    {k:"board",l:"公開ボード"},
    {k:"input",l:isMember?"データ入力":"🔒 データ入力",locked:!isMember},
    ...(isMember?[{k:"plan",l:"五年計画書",locked:!isContributor}]:[]),
    ...(isContributor?[{k:"ledger",l:"マイ台帳"}]:[]),
    ...(me?.email===ADMIN_EMAIL?[{k:"admin",l:"管理",badge:badgeCnt}]:[]),
  ];

  return(
    <div style={{minHeight:"100vh",background:C.washi,color:C.ink}}>
      <style>{CSS}</style>

      {/* ── HEADER ── */}
      <header style={{
        background:"#FFFFFF",
        borderBottom:"1px solid #EBEBEB",
        height:52,
        display:"flex",alignItems:"center",
        padding:"0 24px",
        position:"sticky",top:0,zIndex:50,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginRight:"auto"}}>
          <span style={{fontSize:20}}>🥦</span>
          <span className="f-sans" style={{fontSize:14,fontWeight:700,color:"#222222",letterSpacing:".02em"}}>吉野川 農家記録</span>
        </div>
        {me&&(
          <div style={{display:"flex",alignItems:"center",gap:8,marginRight:12}}>
            {/* 通知ベル */}
            <div data-notif-bell="" style={{position:"relative"}}>
              <button onClick={()=>setShowNotifs(v=>!v)} style={{
                width:36,height:36,borderRadius:"50%",border:"1px solid #EBEBEB",
                background:"#F7F7F7",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",
              }}>
                🔔
                {notifs.filter(n=>!n.read).length>0&&(
                  <span style={{position:"absolute",top:2,right:2,width:14,height:14,borderRadius:"50%",background:"#E24B4A",color:"#fff",fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {notifs.filter(n=>!n.read).length}
                  </span>
                )}
              </button>
              {showNotifs&&(
                <div style={{
                  position:"absolute",top:44,right:0,width:320,background:"#fff",borderRadius:16,
                  border:"1px solid #EBEBEB",boxShadow:"0 8px 32px rgba(0,0,0,0.12)",zIndex:200,overflow:"hidden",
                }}>
                  <div style={{padding:"14px 16px",borderBottom:"1px solid #EBEBEB",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span className="f-sans" style={{fontSize:13,fontWeight:700,color:"#222"}}>通知</span>
                    <button onClick={()=>setShowNotifs(false)} style={{border:"none",background:"none",color:"#B0B0B0",fontSize:16,cursor:"pointer",padding:4}}>×</button>
                  </div>
                  {notifs.length===0
                    ? <div style={{padding:"28px 16px",textAlign:"center",color:"#B0B0B0",fontSize:12}}>通知はありません</div>
                    : <div style={{maxHeight:360,overflowY:"auto"}}>
                        {notifs.map(n=>(
                          <div key={n.id} onClick={()=>markRead(n.id)} style={{
                            padding:"12px 16px",borderBottom:"1px solid #F7F7F7",cursor:"pointer",
                            background:n.read?"#fff":"#F0FBF6",
                          }}>
                            <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                              <span style={{fontSize:16,flexShrink:0}}>
                                {n.type==="expense_alert"?"⚠️":n.type==="dest_compare"?"🔄":n.type==="monthly_change"?"📉":"💡"}
                              </span>
                              <div style={{flex:1}}>
                                <p className="f-sans" style={{fontSize:12,color:"#222",lineHeight:1.6}}>{n.message}</p>
                                <p className="f-sans" style={{fontSize:10,color:"#B0B0B0",marginTop:3}}>
                                  {new Date(n.created_at).toLocaleDateString("ja-JP",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                                </p>
                              </div>
                              {!n.read&&<span style={{width:6,height:6,borderRadius:"50%",background:"#00A86B",flexShrink:0,marginTop:5}}/>}
                            </div>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              )}
            </div>
            {/* ユーザーピル */}
            <div style={{
              display:"flex",alignItems:"center",gap:8,
              padding:"5px 12px",background:"#F7F7F7",
              borderRadius:20,border:"1px solid #EBEBEB",
            }}>
              <span style={{fontSize:11}}>🌾</span>
              <span className="f-sans" style={{fontSize:11,fontWeight:500,color:"#222222"}}>{me.name}</span>
              <button onClick={()=>{setMe(null);setTab("board");setNotifs([]);setShowNotifs(false);}} className="f-sans" style={{
                fontSize:9,color:"#717171",background:"transparent",
                border:"1px solid #EBEBEB",borderRadius:16,padding:"2px 8px",
              }}>ログアウト</button>
            </div>
          </div>
        )}
        <nav style={{display:"flex"}}>
          {TABS.map(({k,l,badge,locked})=>(
            <button key={k} onClick={()=>setTab(k)}
              className={`nav-item ${tab===k?"active":""}`}
              style={{
                padding:"0 16px",height:52,border:"none",borderRadius:0,
                background:"transparent",
                color:tab===k?"#222222":locked?"#D0D0D0":"#717171",
                fontSize:12,fontWeight:tab===k?600:400,
                letterSpacing:".02em",position:"relative",
              }}>
              {l}
              {badge>0&&<span style={{
                position:"absolute",top:10,right:4,
                width:14,height:14,borderRadius:"50%",
                background:"#E24B4A",color:"#fff",fontSize:8,fontWeight:700,
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>{badge}</span>}
            </button>
          ))}
        </nav>
      </header>

      {/* ── 格下げカウントダウン通知 ── */}
      {isMember && daysSinceInput !== null && daysSinceInput >= 25 && (
        <div style={{
          padding:"12px 24px",
          background: daysSinceInput <= 30 ? "#FEF3E2" : "#FCEBEB",
          borderBottom:`1px solid ${daysSinceInput <= 30 ? "#F5A62344" : "#E24B4A44"}`,
          display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8,
        }}>
          <span className="f-sans" style={{ fontSize:12, color: daysSinceInput <= 30 ? "#B87A1A" : "#E24B4A" }}>
            {daysSinceInput <= 30
              ? `貢献者アクセスがあと${30 - daysSinceInput}日で停止します。データを入力して維持しましょう。`
              : "貢献者アクセスが停止しました。データを入力すると復活します。"
            }
          </span>
          <button onClick={() => setTab("input")} style={{
            padding:"6px 16px", borderRadius:20, fontSize:12, fontWeight:600,
            background:C.accent, color:"#fff", border:"none", cursor:"pointer",
          }}>今すぐ入力する</button>
        </div>
      )}

      {/* ── MOBILE BOTTOM TAB BAR ── */}
      <div className="bottom-tab-bar">
        {[
          {k:"board", icon:"📋", l:"ボード"},
          {k:"input", icon:"✏️", l:"入力"},
          ...(isMember?[{k:"plan", icon:"📄", l:"計画書"}]:[]),
          ...(isContributor?[{k:"ledger", icon:"📓", l:"台帳"}]:[]),
          ...(me?.email===ADMIN_EMAIL?[{k:"admin", icon:"⚙️", l:"管理"}]:[]),
        ].map(({k,icon,l})=>(
          <button key={k} onClick={()=>setTab(k)} className={tab===k?"active":""}>
            <span className="icon">{icon}</span>
            {l}
          </button>
        ))}
      </div>

      {/* ── MAIN ── */}
      <main style={{maxWidth:920,margin:"0 auto",padding:"32px 24px 72px"}}>
        {tab==="board"&&<BoardTab farmers={farmers} destApproved={destOk} records={recs} userLevel={userLevel} onLogin={()=>setTab("input")}/>}
        {tab==="input"&&(me
          ? <InputTab loggedInFarmer={me} destApproved={destOk} destPending={destPend}
              records={recs} onAddRecord={addRec} onSubmitDest={subDest} onGoBoard={()=>setTab("board")}/>
          : authV==="register"
            ? <RegisterScreen onGoLogin={()=>setAuthV("login")} onSubmit={subReg}/>
            : <LoginScreen farmers={farmers} onLogin={f=>{setMe(f);setAuthV("login");loadNotifs(f.id);}} onGoRegister={()=>setAuthV("register")}/>
        )}
        {tab==="ledger"&&isContributor&&<MyLedger loggedInFarmer={me} records={recs} destApproved={destOk}/>}
        {tab==="plan"&&isMember&&(
          isContributor
            ? <FiveYearPlanTab loggedInFarmer={me} records={recs} destApproved={destOk} farmers={farmers}/>
            : <div style={{ textAlign:"center", padding:"64px 24px", maxWidth:480, margin:"0 auto" }}>
                <div style={{ fontSize:48, marginBottom:20 }}>🔒</div>
                <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:C.ink, marginBottom:12 }}>
                  五年計画書を利用するにはデータの入力が必要です
                </p>
                <p className="f-sans" style={{ fontSize:13, color:C.mid, lineHeight:1.8, marginBottom:24 }}>
                  月に1回、売上と経費を入力するだけで五年計画書の作成支援が利用できます。
                </p>
                <button onClick={()=>setTab("input")} style={{
                  padding:"12px 32px", borderRadius:20, background:C.accent,
                  color:"#fff", border:"none", fontSize:14, fontWeight:600, cursor:"pointer",
                }}>データを入力する</button>
              </div>
        )}
        {tab==="admin"&&me?.email===ADMIN_EMAIL&&<AdminTab
          destPending={destPend} destApproved={destOk}
          farmers={farmers} farmersPending={farmPend}
          onApprove={appDest} onReject={rejDest}
          onApproveFarmer={appFarmer} onRejectFarmer={rejFarmer}/>}
      </main>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop:"1px solid #EBEBEB",
        padding:"16px 28px",
        display:"flex",justifyContent:"space-between",alignItems:"center",
        background:"#F7F7F7",
        flexWrap:"wrap",gap:8,
      }}>
        <span className="f-sans" style={{fontSize:11,color:"#B0B0B0"}}>
          © {THIS_YEAR} chitose-bank · 吉野川農家 記録プロジェクト
        </span>
        <div style={{display:"flex",gap:16,alignItems:"center"}}>
          <span className="f-sans" style={{fontSize:11,color:"#B0B0B0"}}>
            本データは農家本人の入力による参考値です
          </span>
          <button onClick={()=>setShowTerms(true)} style={{
            fontSize:11,color:"#717171",background:"none",border:"none",
            cursor:"pointer",textDecoration:"underline",textUnderlineOffset:3,padding:0,
          }}>利用規約</button>
        </div>
      </footer>
      {showTerms&&<Terms onClose={()=>setShowTerms(false)}/>}
    </div>
  );
}
