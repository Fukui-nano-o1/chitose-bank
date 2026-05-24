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
const PREFECTURES = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

async function sGet(k){try{const r=await window.storage.get(k,true);return r?JSON.parse(r.value):null;}catch{return null;}}
async function sSet(k,v){try{await window.storage.set(k,JSON.stringify(v),true);}catch{}};

const cn  = n => Math.round(n).toLocaleString("ja-JP");
const man = n => { const a=Math.abs(n); return a>=10000?(Math.round(a/1000)/10).toFixed(1)+"万":cn(a); };
function uid(){ return Math.random().toString(36).slice(2,9); }
function destColor(name){ if(!name)return"#888"; let h=0; for(const c of name) h=(h*37+c.charCodeAt(0))>>>0; return DEST_INK[h%DEST_INK.length]; }

const CROP_EMOJIS = ['🥦','🍅','🍆','🥕','🌽','🥬','🍓','🥒','🧅','🥔','🍈','🌶️','🥜','🫛','🧄'];
function getDefaultAvatar(farmerId) {
  const index = farmerId ? farmerId.charCodeAt(0) % CROP_EMOJIS.length : 0;
  return CROP_EMOJIS[index];
}

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

.carousel-scroll::-webkit-scrollbar { height: 6px; }
.carousel-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 3px; }
.carousel-scroll::-webkit-scrollbar-track { background: transparent; }

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
    padding: 8px 0;
    padding-bottom: env(safe-area-inset-bottom, 8px);
  }
  .bottom-tab-bar button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4px 4px 2px;
    border: none;
    background: transparent;
    font-size: 10px;
    font-family: 'Noto Sans JP', sans-serif;
    gap: 3px;
    cursor: pointer;
    color: #717171;
  }
  .bottom-tab-bar button.active { color: #00A86B; font-weight: 600; }
  .bottom-tab-bar button span.icon { font-size: 20px; line-height: 1; }
  /* Hide desktop header nav on mobile */
  .header-nav { display: none !important; }
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


// ── Market chart constants ───────────────────────────────────
const CROP_PALETTE = ["#00A86B","#F5A623","#4A90D9","#E85D5D","#9B59B6","#2ECC71","#E67E22","#1ABC9C","#3498DB","#E74C3C"];

const LABOR_HOURS = {
  'ブロッコリー':102, 'ナス':400,    'トマト':350,    'きゅうり':320,  'キャベツ':80,
  'だいこん':75,      'にんじん':70,  'たまねぎ':65,   'レタス':90,     'ほうれんそう':120,
  'ねぎ':150,         'はくさい':85,  'ピーマン':380,  'いちご':450,    'すいか':200,
  'メロン':350,       'かぼちゃ':60,  'えだまめ':50,   'アスパラガス':280, 'にら':200,
};
const LABOR_DATA   = [
  { crop:"ブロッコリー", min:94,  max:110 },
  { crop:"ナス",         min:300, max:500 },
];
const METRICS = [
  { key:"acreage", label:"作付面積",  unit:"ha",       dataKey:"acreage_ha" },
  { key:"harvest", label:"収穫量",    unit:"t",        dataKey:"harvest_t" },
  { key:"yield",   label:"10a収量",   unit:"kg",       dataKey:"yield_kg_per_10a" },
  { key:"labor",   label:"労働時間",  unit:"時間/10a", dataKey:null },
];

// ── MarketChart ───────────────────────────────────────────────
function MarketChart({ marketStats, visibleCrops, activeMetrics }) {
  const [tip, setTip] = useState(null);

  const W = 600, mainH = 280;

  // 複数年データがある作物のリストとカラー割り当て
  const cropYearCounts = {};
  marketStats.forEach(s => { cropYearCounts[s.crop] = (cropYearCounts[s.crop] || 0) + 1; });
  const allStatCrops = Object.entries(cropYearCounts)
    .filter(([, n]) => n > 1).map(([c]) => c).sort();
  const getCropColor = crop => {
    const i = allStatCrops.indexOf(crop);
    return CROP_PALETTE[i >= 0 ? i % CROP_PALETTE.length : 0];
  };

  const getSeriesData = (crop, metricKey) => {
    const meta = METRICS.find(m => m.key === metricKey);
    if (!meta?.dataKey) return [];
    return marketStats
      .filter(s => s.crop === crop && s[meta.dataKey] != null)
      .map(s => ({ year: s.year, val: s[meta.dataKey] }))
      .sort((a, b) => a.year - b.year);
  };

  if (activeMetrics.size === 0 || visibleCrops.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${mainH}`} width="100%" style={{ display:"block" }}>
        <text x={W/2} y={mainH/2} textAnchor="middle" dominantBaseline="middle"
          fontSize={14} fill="#717171">作物と指標を選択してください</text>
      </svg>
    );
  }

  const lineKeys = ["acreage","harvest","yield"].filter(k => activeMetrics.has(k));
  const hasLabor = activeMetrics.has("labor");
  const laborCrops = hasLabor
    ? [...new Map(
        marketStats
          .filter(s => visibleCrops.includes(s.crop) && s.labor_hours_per_10a != null)
          .map(s => [s.crop, { crop: s.crop, val: s.labor_hours_per_10a }])
      ).values()]
    : [];

  const hasRightAxis = lineKeys.length >= 2;
  const P = { l:60, r: hasRightAxis ? 60 : 20, t:20, b:36 };
  const cW = W - P.l - P.r, cH = mainH - P.t - P.b;

  const scales = {};
  lineKeys.forEach(key => {
    const vals = visibleCrops.flatMap(crop => getSeriesData(crop, key).map(d => d.val));
    if (!vals.length) { scales[key] = { vMin:0, vMax:1 }; return; }
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || hi * 0.1 || 1;
    scales[key] = { vMin: lo - pad, vMax: hi + pad };
  });

  const allYears = [...new Set(
    lineKeys.flatMap(key => visibleCrops.flatMap(crop => getSeriesData(crop, key).map(d => d.year)))
  )].sort((a,b) => a-b);

  const xMin = allYears[0] ?? 2019, xMax = allYears[allYears.length-1] ?? 2025;
  const xp = yr => P.l + ((yr - xMin) / (xMax - xMin || 1)) * cW;
  const yp = (v, key) => {
    const { vMin, vMax } = scales[key] || { vMin:0, vMax:1 };
    return P.t + cH - ((v - vMin) / (vMax - vMin)) * cH;
  };

  const fmtV = (v, unit) => {
    if (unit === "t" || unit === "ha") {
      if (v >= 100000) return `${Math.round(v/1000)}千`;
      if (v >= 10000)  return `${(v/10000).toFixed(1)}万`;
    }
    return Math.round(v).toLocaleString("ja-JP");
  };

  const DASH = { acreage: undefined, harvest: "8,4", yield: "2,4" };
  const leftKey = lineKeys[0], rightKey = lineKeys[1];
  const leftMeta = METRICS.find(m => m.key === leftKey);
  const rightMeta = METRICS.find(m => m.key === rightKey);

  const gridTicks = key => key
    ? Array.from({length:5}, (_,i) => scales[key].vMin + (scales[key].vMax - scales[key].vMin) * i / 4)
    : [];

  const maxLaborVal = laborCrops.length ? Math.max(...laborCrops.map(d => d.val)) : 1;
  const laborBarMaxH = 64;
  const laborAreaH = laborCrops.length ? 100 : 0;
  const totalH = mainH + (laborAreaH ? laborAreaH + 8 : 0);

  const legendEntries = [];
  const legendSeen = new Set();
  lineKeys.forEach(key => {
    const meta = METRICS.find(m => m.key === key);
    visibleCrops.forEach(crop => {
      const id = `${crop}·${key}`;
      if (getSeriesData(crop, key).length && !legendSeen.has(id)) {
        legendSeen.add(id);
        legendEntries.push({ key, crop, meta, col: getCropColor(crop), dash: DASH[key] });
      }
    });
  });
  laborCrops.forEach(d => {
    const id = `${d.crop}·labor`;
    if (!legendSeen.has(id)) {
      legendSeen.add(id);
      legendEntries.push({ key:"labor", crop:d.crop, meta:METRICS.find(m=>m.key==="labor"), col:getCropColor(d.crop), isBar:true });
    }
  });
  const MAX_LEGEND = 12;
  const visibleLegend = legendEntries.slice(0, MAX_LEGEND);
  const hiddenLegendCount = legendEntries.length - visibleLegend.length;

  const citeSet = new Set([
    (activeMetrics.has("acreage")||activeMetrics.has("harvest")||activeMetrics.has("yield")) && "農水省 作物統計調査",
    activeMetrics.has("labor") && "各県農業経営指標",
  ].filter(Boolean));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${totalH}`} width="100%" style={{ display:"block" }}
        onClick={() => setTip(null)}>

        {/* グリッド + 左Y軸ラベル */}
        {gridTicks(leftKey).map((v,i) => (
          <g key={`gl${i}`}>
            <line x1={P.l} y1={yp(v,leftKey)} x2={W-P.r} y2={yp(v,leftKey)}
              stroke="#EBEBEB" strokeDasharray="4,4" />
            <text x={P.l-5} y={yp(v,leftKey)} textAnchor="end" fontSize={11} fill="#717171" dominantBaseline="middle">
              {fmtV(v, leftMeta?.unit)}
            </text>
          </g>
        ))}

        {leftMeta && (
          <text x={10} y={P.t+cH/2} textAnchor="middle" fontSize={11} fill="#717171"
            transform={`rotate(-90 10 ${P.t+cH/2})`}>{leftMeta.unit}</text>
        )}

        {/* 右Y軸ラベル */}
        {rightKey && gridTicks(rightKey).map((v,i) => (
          <text key={`gr${i}`} x={W-P.r+5} y={yp(v,rightKey)}
            textAnchor="start" fontSize={11} fill="#717171" dominantBaseline="middle">
            {fmtV(v, rightMeta?.unit)}
          </text>
        ))}

        {rightMeta && (
          <text x={W-10} y={P.t+cH/2} textAnchor="middle" fontSize={11} fill="#717171"
            transform={`rotate(90 ${W-10} ${P.t+cH/2})`}>{rightMeta.unit}</text>
        )}

        {/* X軸年ラベル */}
        {allYears.map(yr => (
          <text key={yr} x={xp(yr)} y={mainH-P.b+18} textAnchor="middle" fontSize={11} fill="#717171">{yr}</text>
        ))}

        {/* 折れ線 + データポイント */}
        {lineKeys.map(key => visibleCrops.map(crop => {
          const data = getSeriesData(crop, key);
          if (!data.length) return null;
          const col = getCropColor(crop);
          const pts = data.map(d => `${xp(d.year)},${yp(d.val,key)}`).join(" ");
          return (
            <g key={`${key}-${crop}`}>
              <polyline points={pts} fill="none" stroke={col} strokeWidth={2} strokeDasharray={DASH[key]} />
              {data.map((d,di) => {
                const meta = METRICS.find(m => m.key === key);
                return (
                  <circle key={di} cx={xp(d.year)} cy={yp(d.val,key)} r={3}
                    fill={col} stroke="#fff" strokeWidth={1.5} style={{ cursor:"pointer" }}
                    onClick={e => {
                      e.stopPropagation();
                      const id = `${key}-${crop}-${di}`;
                      setTip(t => t?.id===id ? null : { id, key, crop, d, meta, col });
                    }}
                  />
                );
              })}
            </g>
          );
        }))}

        {/* ツールチップ */}
        {tip && (() => {
          const x = xp(tip.d.year), y = yp(tip.d.val, tip.key);
          const txt = `${tip.d.year} ${tip.crop}: ${tip.d.val.toLocaleString("ja-JP")}${tip.meta.unit}`;
          const bw = txt.length * 6.2 + 14;
          const bx = Math.min(Math.max(x - bw/2, P.l), W-P.r-bw);
          const by = y < P.t+30 ? y+8 : y-26;
          return (
            <g>
              <rect x={bx} y={by} width={bw} height={22} rx={4} fill="rgba(34,34,34,.9)" />
              <text x={bx+bw/2} y={by+14} textAnchor="middle" fontSize={10} fill="#fff">{txt}</text>
            </g>
          );
        })()}

        {/* 労働時間 縦棒エリア */}
        {laborCrops.length > 0 && (() => {
          const barW = 40, barGap = 20;
          const totalBarW = laborCrops.length * barW + (laborCrops.length - 1) * barGap;
          const startX = P.l + (cW - totalBarW) / 2;
          const baseY = laborBarMaxH + 16;
          return (
            <g transform={`translate(0,${mainH+8})`}>
              <line x1={P.l} y1={0} x2={W-P.r} y2={0} stroke="#EBEBEB" strokeWidth={1} />
              <text x={P.l} y={-4} fontSize={11} fill="#717171">労働時間（時間/10a）</text>
              {laborCrops.map((d,i) => {
                const col = getCropColor(d.crop);
                const cx = startX + i * (barW + barGap) + barW / 2;
                const h = (d.val / maxLaborVal) * laborBarMaxH;
                const nameFontSize = d.crop.length > 5 ? 9 : 11;
                return (
                  <g key={d.crop}>
                    <rect x={cx-barW/2} y={baseY-h} width={barW} height={h} fill={col} rx={3} />
                    <text x={cx} y={baseY-h-5} textAnchor="middle" fontSize={11} fill={col} fontWeight="600">{d.val}h</text>
                    <text x={cx} y={baseY+13} textAnchor="middle" fontSize={nameFontSize} fill="#717171">{d.crop}</text>
                  </g>
                );
              })}
            </g>
          );
        })()}

      </svg>

      {legendEntries.length > 0 && (
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:10, maxHeight:80, overflow:"hidden" }}>
          {visibleLegend.map(({ key, crop, meta, col, dash, isBar }) => (
            <div key={`${key}-${crop}`} style={{ display:"flex", alignItems:"center", gap:4 }}>
              {isBar
                ? <div style={{ width:8, height:8, borderRadius:"50%", background:col, flexShrink:0 }} />
                : <svg width={20} height={8} style={{ flexShrink:0 }}>
                    <line x1={0} y1={4} x2={20} y2={4} stroke={col} strokeWidth={2} strokeDasharray={dash} />
                    <circle cx={10} cy={4} r={2.5} fill={col} stroke="#fff" strokeWidth={1} />
                  </svg>
              }
              <span className="f-sans" style={{ fontSize:11, color:"#222", whiteSpace:"nowrap" }}>
                {crop} · {meta.label}
              </span>
            </div>
          ))}
          {hiddenLegendCount > 0 && (
            <span className="f-sans" style={{ fontSize:11, color:"#717171", alignSelf:"center" }}>
              ...他{hiddenLegendCount}項目
            </span>
          )}
        </div>
      )}

      {citeSet.size > 0 && (
        <p className="f-sans" style={{ fontSize:9, color:"#B0B0B0", marginTop:6 }}>
          出典：{[...citeSet].join(" / ")}
        </p>
      )}
    </div>
  );
}

// ── Carousel ─────────────────────────────────────────────────
function Carousel({ children, style, className, wrapperStyle }) {
  const ref = useRef(null);
  const [atLeft, setAtLeft] = useState(true);
  const [atRight, setAtRight] = useState(true);

  const updatePos = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtLeft(el.scrollLeft <= 1);
    setAtRight(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updatePos();
    window.addEventListener('resize', updatePos);
    return () => window.removeEventListener('resize', updatePos);
  }, [updatePos]);

  useEffect(() => { updatePos(); });

  const scroll = dir => ref.current?.scrollBy({ left: dir * 300, behavior: 'smooth' });

  const btnStyle = {
    position:'absolute', top:'50%', transform:'translateY(-50%)',
    width:36, height:36, borderRadius:'50%',
    background:'#fff', border:'1px solid #EBEBEB',
    boxShadow:'0 2px 4px rgba(0,0,0,0.1)',
    cursor:'pointer', fontSize:18,
    display:'flex', alignItems:'center', justifyContent:'center',
    zIndex:2, padding:0, lineHeight:1,
  };

  return (
    <div style={{ position:'relative', ...wrapperStyle }}>
      {!atLeft && (
        <button onClick={() => scroll(-1)} className="f-sans"
          style={{ ...btnStyle, left:-16 }}>‹</button>
      )}
      <div ref={ref} className={className} style={style} onScroll={updatePos}>
        {children}
      </div>
      {!atRight && (
        <button onClick={() => scroll(1)} className="f-sans"
          style={{ ...btnStyle, right:-16 }}>›</button>
      )}
    </div>
  );
}

// ── BoardTab ─────────────────────────────────────────────────
function BoardTab({ farmers, destApproved, records, userLevel = 2, onLogin, me }) {
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

  const [marketStats, setMarketStats] = useState([]);
  useEffect(() => {
    supabase.from('market_stats').select('*').order('crop').then(({ data }) => {
      if (data) setMarketStats(data);
    });
  }, []);

  const enrichedStats = marketStats.map(s => ({
    ...s,
    labor_hours_per_10a: s.labor_hours_per_10a || LABOR_HOURS[s.crop] || null,
  }));

  const [showAllStats, setShowAllStats] = useState(false);
  const [statSort, setStatSort] = useState("default");
  const [activeAudience, setActiveAudience] = useState(null);
  const [showMarketChart, setShowMarketChart] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [visibleCrops, setVisibleCrops] = useState([]);
  const [activeMetrics, setActiveMetrics] = useState(() => new Set(['acreage']));
  const toggleCrop = crop => setVisibleCrops(v => {
    if (v.includes(crop)) return v.filter(c => c !== crop);
    if (v.length >= 5) return v;
    return [...v, crop];
  });
  const toggleMetric = key => setActiveMetrics(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

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

  const recordCrops = allFarmerRecs.flatMap(f => f.recs).map(r => r.crop).filter(Boolean);
  const statCrops = marketStats.map(s => s.crop).filter(Boolean);
  const allCrops = [...new Set([...recordCrops, ...statCrops])];

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
  const regions = [...new Set(farmers.map(f => f.municipality).filter(Boolean))];
  const regionText = regions.length > 0 ? "（" + regions.slice(0,3).join("・") + "）" : "";
  const MIN_FARMERS = 5;

  return (
    <div className="appear">

      {userLevel === 1 && (<>

      {/* ══ 対象者別導線 ══════════════════════════════════ */}
      <div style={{ marginBottom:28 }}>
        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",
          gap:12,
        }}>
          {[
            { id:"for-institutions", icon:"🏛", title:"JA・支援センターの方へ",   desc:"融資審査に必要な収支計画書を標準化。確認負担を減らします。",           color:"#1A5E5E", bg:"#E8F5F0" },
            { id:"for-newcomers",    icon:"🌱", title:"新規就農者の方へ",           desc:"何から始めるか分からなくても、10分で五年計画書が作れます。",           color:"#00A86B", bg:"#E6F7EF" },
            { id:"for-veterans",     icon:"🌾", title:"ベテラン・中堅農家の方へ",   desc:"あなたの経費データが地域の基準になります。",                           color:"#B87A1A", bg:"#FEF3E2" },
            { id:"for-non-farmers",  icon:"👀", title:"これから農業を始める方へ",   desc:"就農前にリアルな経費・収支データを見て判断できます。",                 color:"#4A90D9", bg:"#EBF3FC" },
          ].map(card => (
            <button
              key={card.id}
              onClick={() => setActiveAudience(card.id)}
              style={{
                padding:"22px 20px", background:card.bg,
                border:"1px solid " + card.color + "22",
                borderRadius:16, cursor:"pointer",
                textAlign:"left", display:"block",
                transition:"transform .15s, box-shadow .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform="translateY(0)";    e.currentTarget.style.boxShadow="none"; }}
            >
              <div style={{ fontSize:28, marginBottom:10 }}>{card.icon}</div>
              <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:card.color, marginBottom:6 }}>{card.title}</p>
              <p className="f-sans" style={{ fontSize:11, color:"#717171", lineHeight:1.7 }}>{card.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ══ 不安除去ピル ══════════════════════════════════ */}
      <div style={{
        display:"flex", gap:16, overflowX:"auto", paddingBottom:8,
        marginBottom:24, WebkitOverflowScrolling:"touch",
      }}>
        {[
          { icon:"🔒", text:"個人名は非公開" },
          { icon:"📊", text:"ランキングしない" },
          { icon:"📄", text:"融資資料になる" },
          { icon:"🤝", text:"同意なく共有しない" },
        ].map(item => (
          <div key={item.text} style={{
            flexShrink:0, display:"flex", alignItems:"center", gap:8,
            padding:"10px 16px", background:"#F7F7F7",
            border:"1px solid #EBEBEB", borderRadius:20,
          }}>
            <span style={{ fontSize:16 }}>{item.icon}</span>
            <span className="f-sans" style={{ fontSize:12, color:"#222", fontWeight:500, whiteSpace:"nowrap" }}>{item.text}</span>
          </div>
        ))}
      </div>

      </>)}

      {/* ══ 公的統計 ════════════════════════════════════ */}
      {(() => {
        const fmtHarvest = t => t >= 10000 ? (t / 10000).toFixed(1) + "万t" : t.toLocaleString('ja-JP') + "t";
        const fmtAcreage = h => h >= 10000 ? (h / 10000).toFixed(1) + "万ha" : h.toLocaleString('ja-JP') + "ha";

        const byCrop = {};
        enrichedStats.forEach(s => {
          if (!byCrop[s.crop] || s.year > byCrop[s.crop].year) byCrop[s.crop] = s;
        });

        const filtered = selectedCrop === 'すべて'
          ? Object.values(byCrop)
          : Object.values(byCrop).filter(s => s.crop === selectedCrop);

        const getComment = (s) => {
          const labor = s.labor_hours_per_10a;
          if (!labor) return null;
          if (labor >= 400) return "労働集約型。人手の確保が重要";
          if (labor >= 200) return "労働時間が多め。計画的な作業管理が必要";
          if (labor >= 100) return "標準的な労働時間";
          return "比較的省力。初心者にも取り組みやすい";
        };

        // ソート＋パーソナライズ
        const myCrops = me?.planned_crops || [];

        const sorted = [...filtered].sort((a, b) => {
          const aIsMine = myCrops.includes(a.crop) ? 0 : 1;
          const bIsMine = myCrops.includes(b.crop) ? 0 : 1;
          if (aIsMine !== bIsMine) return aIsMine - bIsMine;
          if (statSort === "labor_asc")    return (a.labor_hours_per_10a || 9999) - (b.labor_hours_per_10a || 9999);
          if (statSort === "labor_desc")   return (b.labor_hours_per_10a || 0) - (a.labor_hours_per_10a || 0);
          if (statSort === "yield_desc")   return (b.yield_kg_per_10a || 0) - (a.yield_kg_per_10a || 0);
          if (statSort === "yield_asc")    return (a.yield_kg_per_10a || 0) - (b.yield_kg_per_10a || 0);
          if (statSort === "acreage_desc") return (b.acreage_ha || 0) - (a.acreage_ha || 0);
          return a.crop.localeCompare(b.crop, 'ja');
        });

        if (enrichedStats.length === 0) {
          return (
            <div style={{ marginBottom: 24 }}>
              <p className="f-sans" style={{ fontSize: 13, color: C.mid }}>公的統計データを読み込み中...</p>
            </div>
          );
        }
        if (filtered.length === 0) return null;

        return (
          <div id="public-stats-section" style={{ marginBottom: 24 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:16 }}>
              <h2 className="f-sans" style={{ fontSize:15, fontWeight:700, color:C.ink, letterSpacing:'.03em', margin:0 }}>
                公的統計（作物統計調査）
              </h2>
              <span className="f-sans" style={{ fontSize:10, color:C.ghost }}>{sorted.length}品目</span>
            </div>
            <div className="filter-scroll" style={{
              display:"flex", gap:6, overflowX:"auto", paddingBottom:8, marginBottom:12,
              scrollbarWidth:"none", msOverflowStyle:"none",
            }}>
              {[
                { key:"default",      label:"五十音順" },
                { key:"labor_asc",    label:"労働時間 少→多" },
                { key:"labor_desc",   label:"労働時間 多→少" },
                { key:"yield_desc",   label:"10a収量 多→少" },
                { key:"yield_asc",    label:"10a収量 少→多" },
                { key:"acreage_desc", label:"作付面積 大→小" },
              ].map(opt => {
                const active = statSort === opt.key;
                return (
                  <button key={opt.key} onClick={() => setStatSort(opt.key)} className="f-sans" style={{
                    flexShrink:0, padding:"6px 14px", borderRadius:20, fontSize:11,
                    border: active ? "1px solid " + C.accent : "1px solid " + C.border,
                    background: active ? C.accent : "#fff",
                    color: active ? "#fff" : C.mid,
                    fontWeight: active ? 600 : 400,
                    cursor:"pointer", transition:"all .15s", whiteSpace:"nowrap",
                  }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))",
              gap:12,
            }}>
              {(showAllStats ? sorted : sorted.slice(0, 5)).map(s => {
                const comment = getComment(s);
                const statRows = [
                  s.acreage_ha          != null && { label:'作付面積', value:fmtAcreage(s.acreage_ha) },
                  s.harvest_t           != null && { label:'収穫量',   value:fmtHarvest(s.harvest_t) },
                  s.yield_kg_per_10a    != null && { label:'10a収量',  value:s.yield_kg_per_10a.toLocaleString('ja-JP') + "kg" },
                  s.labor_hours_per_10a != null && { label:'労働時間', value:s.labor_hours_per_10a + "時間/10a" },
                ].filter(Boolean);
                return (
                  <div key={s.crop} className="ledger-card" style={{ padding:"20px 22px" }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:14 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:C.ink, margin:0 }}>{s.crop}</p>
                        {myCrops.includes(s.crop) && (
                          <span style={{
                            padding:"2px 8px", borderRadius:8, fontSize:9, fontWeight:700,
                            background:C.accentLight, color:C.accent,
                          }}>栽培中</span>
                        )}
                      </div>
                      <span className="f-sans" style={{ fontSize:10, color:C.ghost }}>{s.year}年産</span>
                    </div>
                    {statRows.map(r => (
                      <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
                        <span className="f-sans" style={{ fontSize:12, color:C.mid }}>{r.label}</span>
                        <span className="f-mono" style={{ fontSize:13, fontWeight:600, color:C.ink }}>{r.value}</span>
                      </div>
                    ))}
                    {comment && (
                      <div style={{
                        marginTop:10, padding:"8px 12px",
                        background:C.bgSoft, borderRadius:8,
                        borderLeft:"3px solid " + C.accent,
                      }}>
                        <p className="f-sans" style={{ fontSize:10, color:C.mid, lineHeight:1.6, margin:0 }}>
                          💡 {comment}
                        </p>
                      </div>
                    )}
                    <p className="f-sans" style={{ fontSize:8, color:C.ghost, margin:"10px 0 0" }}>
                      出典：農水省 作物統計調査
                    </p>
                  </div>
                );
              })}
            </div>
            {sorted.length > 5 && (
              <button
                onClick={() => setShowAllStats(v => !v)}
                className="f-sans"
                style={{
                  display:"block",
                  width:"100%",
                  marginTop:16,
                  padding:"14px",
                  background:"#fff",
                  border:"1px solid #EBEBEB",
                  borderRadius:12,
                  fontSize:13,
                  fontWeight:600,
                  color:C.ink,
                  cursor:"pointer",
                  transition:"background .15s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#F7F7F7"}
                onMouseLeave={e => e.currentTarget.style.background = "#fff"}
              >
                {showAllStats
                  ? "閉じる ▲"
                  : "もっと見る（残り" + (sorted.length - 5) + "品目） ▼"
                }
              </button>
            )}
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

        <div style={{ maxHeight: showMarketChart ? "3000px" : "0", overflow:"hidden", transition:"max-height 0.3s ease" }}>
          <div style={{ marginTop:16, background:"#fff", borderRadius:16, padding:24, border:`1px solid ${C.border}` }}>

            {/* A. 設定エリア */}
            <div style={{ background:"#F7F7F7", borderRadius:12, padding:16, marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"flex-end" }}>
                <button onClick={() => setShowSettings(v => !v)} className="f-sans" style={{
                  background:"none", border:"none", fontSize:12, color:C.mid, cursor:"pointer", padding:0,
                }}>
                  {showSettings ? "設定を隠す ▲" : "設定を表示 ▼"}
                </button>
              </div>
              <div style={{ maxHeight: showSettings ? "500px" : "0", overflow:"hidden", transition:"max-height 0.3s ease" }}>
                <div style={{ paddingTop:10 }}>

                  {/* 段1：作物ピル（market_statsから動的生成、複数年データのある作物のみ） */}
                  {(() => {
                    const cropCounts = {};
                    enrichedStats.forEach(s => { cropCounts[s.crop] = (cropCounts[s.crop] || 0) + 1; });
                    const availCrops = Object.entries(cropCounts).filter(([,n]) => n > 1).map(([c]) => c).sort();
                    if (availCrops.length === 0) return (
                      <p className="f-sans" style={{ fontSize:12, color:C.ghost, marginBottom:14 }}>データ読み込み中...</p>
                    );
                    return (
                      <div style={{ marginBottom:14 }}>
                        <div className="f-sans" style={{ fontSize:11, color:C.mid, marginBottom:6 }}>
                          作物<span style={{ marginLeft:6, color:C.ghost }}>（最大5つ）</span>
                        </div>
                        <div className="filter-scroll" style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, scrollbarWidth:"none", msOverflowStyle:"none" }}>
                          {availCrops.map((crop, idx) => {
                            const active = visibleCrops.includes(crop);
                            const atMax = visibleCrops.length >= 5 && !active;
                            const col = CROP_PALETTE[idx % CROP_PALETTE.length];
                            return (
                              <button key={crop} onClick={() => !atMax && toggleCrop(crop)} className="f-sans" style={{
                                flexShrink:0, padding:"6px 14px", borderRadius:20, fontSize:12,
                                border:`1px solid ${active ? "transparent" : C.border}`,
                                background: active ? col : "#fff",
                                color: active ? "#fff" : C.mid,
                                cursor: atMax ? "not-allowed" : "pointer",
                                opacity: atMax ? 0.4 : 1,
                                transition:"all .15s",
                                whiteSpace:"nowrap",
                              }}>
                                {crop}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 段2：指標ピル */}
                  <div>
                    <div className="f-sans" style={{ fontSize:11, color:C.mid, marginBottom:6 }}>指標</div>
                    <div className="filter-scroll" style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, scrollbarWidth:"none", msOverflowStyle:"none" }}>
                      {METRICS.map(m => {
                        const active = activeMetrics.has(m.key);
                        return (
                          <button key={m.key} onClick={() => toggleMetric(m.key)} className="f-sans" style={{
                            flexShrink:0, padding:"6px 14px", borderRadius:20, fontSize:12,
                            border:`1px solid ${active ? "transparent" : C.border}`,
                            background: active ? "#222" : "#fff",
                            color: active ? "#fff" : C.mid,
                            cursor:"pointer",
                            transition:"all .15s",
                            whiteSpace:"nowrap",
                          }}>
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* B. グラフエリア（常時表示） */}
            <MarketChart
              marketStats={enrichedStats}
              visibleCrops={visibleCrops}
              activeMetrics={activeMetrics}
            />

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
      <Carousel
        className="carousel-scroll"
        style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:10 }}
        wrapperStyle={{ marginBottom:16 }}
      >
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
      </Carousel>

      {/* ══ 参加状況バナー ══════════════════════════════ */}
      <div style={{
        padding:"14px 20px", background:C.ivory, border:`1px solid ${C.rule}`,
        borderRadius:16, marginBottom:28,
        display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8,
      }}>
        <span className="f-sans" style={{ fontSize:13, color:C.ink }}>
          現在 <strong style={{ color:C.bamboo }}>{farmers.length}</strong> 名の農家が参加中{regionText}
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

      {/* ══ 対象者モーダル ═══════════════════════════════ */}
      {activeAudience && userLevel === 1 && (() => {
        const contents = {
          "for-institutions": {
            icon:"🏛", title:"JA・支援センターの方へ", color:"#1A5E5E", bg:"#E8F5F0",
            body: (
              <>
                <div style={{ marginBottom:20 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:8 }}>課題</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9 }}>
                    新規就農者の融資審査で、収支計画書の作成指導に時間がかかる。
                    提出される計画書のフォーマットがバラバラで、確認作業が非効率。
                  </p>
                </div>
                <div style={{ marginBottom:24 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:8 }}>このサービスで解決できること</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9 }}>
                    農家が売上・経費を入力するだけで、JA融資審査フォーマットの五年計画書がPDF出力されます。
                    公的統計データが自動参照され、保守的な数値が入ります。
                    収支計画書のフォーマットが統一されるため、確認負担が軽減されます。
                  </p>
                </div>
                <button onClick={onLogin} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14 }}>
                  導入について相談する →
                </button>
              </>
            ),
          },
          "for-newcomers": {
            icon:"🌱", title:"新規就農者の方へ", color:"#00A86B", bg:"#E6F7EF",
            body: (
              <>
                <div style={{ display:"grid", gap:18, marginBottom:24 }}>
                  {[
                    { n:"1", t:"作物と出荷先を選ぶ",      d:"栽培予定の作物を選び、出荷先を登録します。" },
                    { n:"2", t:"売上と経費を月ごとに入力", d:"出荷箱数と単価、経費項目を入れるだけ。1回3分。" },
                    { n:"3", t:"五年計画書をPDF出力",      d:"JA融資に使える収支計画書が自動生成されます。支援センターにそのまま提出可能。" },
                  ].map(step => (
                    <div key={step.n} style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                      <span className="f-mono" style={{ fontSize:22, fontWeight:700, color:"#00A86B", flexShrink:0, lineHeight:1 }}>{step.n}</span>
                      <div>
                        <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:4 }}>{step.t}</p>
                        <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7 }}>{step.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={onLogin} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14 }}>
                  無料で始める →
                </button>
              </>
            ),
          },
          "for-veterans": {
            icon:"🌾", title:"ベテラン・中堅農家の方へ", color:"#B87A1A", bg:"#FEF3E2",
            body: (
              <>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, marginBottom:16 }}>
                  あなたが入力した経費データは、匿名で集計され、地域の経営基準になります。
                  新規就農者が参考にする数字を、現場の経験者が作る。
                  それが吉野川の農業を強くします。
                </p>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, marginBottom:24 }}>
                  貢献者として継続入力すると、他の農家の集計データや出荷先別の採算比較が利用できます。
                </p>
                <button onClick={onLogin} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14, background:"#B87A1A" }}>
                  データを入力する →
                </button>
              </>
            ),
          },
          "for-non-farmers": {
            icon:"👀", title:"これから農業を始める方へ", color:"#4A90D9", bg:"#EBF3FC",
            body: (
              <>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, marginBottom:16 }}>
                  就農する前に、リアルな数字を見てください。
                  作物ごとの作付面積・収穫量・労働時間。農家が実際に入力した経費率。
                  「思っていたのと違った」を減らすために、このデータがあります。
                </p>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, marginBottom:24 }}>
                  登録は無料。公的統計データは登録なしでも閲覧できます。
                </p>
                <button onClick={onLogin} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14, background:"#4A90D9" }}>
                  無料で登録する →
                </button>
              </>
            ),
          },
        };
        const content = contents[activeAudience];
        if (!content) return null;
        return (
          <div
            onClick={() => setActiveAudience(null)}
            style={{
              position:"fixed", inset:0, zIndex:9000,
              background:"rgba(0,0,0,0.5)",
              display:"flex", alignItems:"center", justifyContent:"center",
              padding:16,
              animation:"fadeIn .2s ease",
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="appear"
              style={{
                background:"#fff", borderRadius:20,
                maxWidth:480, width:"100%",
                maxHeight:"85vh", overflowY:"auto",
                boxShadow:"0 12px 48px rgba(0,0,0,0.15)",
              }}
            >
              <div style={{
                padding:"28px 28px 20px",
                background:content.bg,
                borderRadius:"20px 20px 0 0",
                position:"relative",
              }}>
                <button
                  onClick={() => setActiveAudience(null)}
                  style={{
                    position:"absolute", top:16, right:16,
                    width:32, height:32, borderRadius:"50%",
                    background:"rgba(0,0,0,0.08)", border:"none",
                    fontSize:16, cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color:"#666",
                  }}
                >✕</button>
                <div style={{ fontSize:36, marginBottom:12 }}>{content.icon}</div>
                <h2 className="f-sans" style={{
                  fontSize:20, fontWeight:800, color:content.color,
                  margin:0, lineHeight:1.3,
                }}>{content.title}</h2>
              </div>
              <div style={{ padding:"24px 28px 32px" }}>
                {content.body}
              </div>
            </div>
          </div>
        );
      })()}

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

// ── FiveYearPlanTab ──────────────────────────────────────────
function FiveYearPlanTab({ loggedInFarmer, records }) {
  const PLAN_YEARS = Array.from({ length: 5 }, (_, i) => THIS_YEAR + i); // kept for compat
  const today = new Date().toLocaleDateString("ja-JP", { year:"numeric", month:"long", day:"numeric" });
  const YR_LABELS = ["直近実績","1年目","2年目","3年目","4年目","5年目(目標)"];

  // ── marketStats ───────────────────────────────────────────
  const [marketStats, setMarketStats] = useState([]);
  useEffect(() => {
    supabase.from('market_stats').select('*').then(({ data }) => {
      if (data) setMarketStats(data);
    });
  }, []);

  const getMarketData = useCallback((crop) => {
    const entries = marketStats.filter(s => s.crop === crop);
    if (!entries.length) return { yield_per_10a: null, price: null };
    const latest = entries.reduce((best, s) => (!best || (s.year ?? 0) > (best.year ?? 0)) ? s : best, null);
    return {
      yield_per_10a: latest?.yield_kg_per_10a ?? null,
      price: latest?.price_yen_per_kg ?? null,
    };
  }, [marketStats]);

  // ── records ──────────────────────────────────────────────
  const myRecs = MONTHS.flatMap((_, mi) =>
    records[`${loggedInFarmer.id}_${THIS_YEAR}_${mi}`] || []
  );
  const myCrops = [...new Set(myRecs.map(r => r.crop).filter(Boolean))];
  const planCrops = loggedInFarmer.planned_crops || [];
  const allCrops = [...new Set([...planCrops, ...myCrops])];

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

  // ── market収益デフォルト（scale×yield×price÷10000） ────────
  const cropMarketRevDef = (crop, yi) => {
    if (yi === 0) return cropRev0(crop);
    const md = getMarketData(crop);
    const scale = num(`cr_${crop}_scale`, yi, 0);
    const qty   = num(`cr_${crop}_qty`,   yi, md.yield_per_10a ?? 0);
    const price = num(`cr_${crop}_price`, yi, md.price ?? 0);
    if (scale > 0 && qty > 0 && price > 0) {
      return Math.round(qty * scale / 10 * price / 1000);
    }
    return cropRev0(crop);
  };

  // ── 集計関数 ─────────────────────────────────────────────
  const grossRevY = yi =>
    allCrops.reduce((s, c) => s + num(`cr_${c}_rev`, yi, cropMarketRevDef(c, yi)), 0)
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

  // 直近実績は実績値表示（読取専用）、1〜5年目はmarket default対応input
  const CropRevCell = ({ crop, yi }) =>
    yi === 0
      ? <td style={aus}>{cropRev0(crop) !== 0 ? cropRev0(crop).toLocaleString("ja-JP") : "—"}</td>
      : <InputCell rowKey={`cr_${crop}_rev`} yi={yi} actDef={cropMarketRevDef(crop, yi)} />;

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

      {/* 都道府県バナー */}
      {loggedInFarmer.prefecture && (
        <div className="no-print" style={{ maxWidth:900, margin:"0 auto 12px" }}>
          <p className="f-sans" style={{
            fontSize:11, color:C.mid,
            background:C.bgSoft, padding:"8px 12px", borderRadius:8,
            border:`1px solid ${C.border}`,
          }}>
            📍 {loggedInFarmer.prefecture}の経営指標を参照しています（※現在は全国データのみ）
          </p>
        </div>
      )}

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

            {allCrops.flatMap(crop => {
              const md = getMarketData(crop);
              return [
                <tr key={`${crop}_scale`}>
                  <td style={ls}>{crop}（生産規模）</td>
                  <td style={us}>a</td>
                  {[0,1,2,3,4,5].map(yi => <InputCell key={yi} rowKey={`cr_${crop}_scale`} yi={yi} actDef={0} />)}
                  <td style={cs}></td>
                </tr>,
                <tr key={`${crop}_qty`}>
                  <td style={ls}>{crop}（生産量）</td>
                  <td style={us}>kg/10a</td>
                  {[0,1,2,3,4,5].map(yi => (
                    <InputCell key={yi} rowKey={`cr_${crop}_qty`} yi={yi} actDef={yi === 0 ? 0 : (md.yield_per_10a ?? 0)} />
                  ))}
                  <td style={{ ...cs, fontSize:10, color:C.mid }}>
                    {md.yield_per_10a != null ? `全国平均 ${md.yield_per_10a.toLocaleString("ja-JP")}kg` : ""}
                  </td>
                </tr>,
                <tr key={`${crop}_price`}>
                  <td style={ls}>{crop}（単価）</td>
                  <td style={us}>円/kg</td>
                  {[0,1,2,3,4,5].map(yi => (
                    <InputCell key={yi} rowKey={`cr_${crop}_price`} yi={yi} actDef={md.price ?? 0} />
                  ))}
                  <td style={{ ...cs, fontSize:10, color:C.mid }}>
                    {md.price != null ? `参考 ${md.price.toLocaleString("ja-JP")}円` : ""}
                  </td>
                </tr>,
                <tr key={`${crop}_rev`}>
                  <td style={ls}>{crop}（収入金額）</td>
                  <td style={us}>千円</td>
                  {[0,1,2,3,4,5].map(yi => <CropRevCell key={yi} crop={crop} yi={yi} />)}
                  <td style={cs}></td>
                </tr>,
              ];
            })}

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
  const [expandedFarmer, setExpandedFarmer] = useState(null);

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
        <div className="fade-in" style={{ display:"grid", gap:8 }}>
          {farmers.length===0 && <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", padding:"32px 0", textAlign:"center" }}>農家がいません</p>}
          {farmers.map(f => {
            const isOpen = expandedFarmer === f.id;
            const tier = f.experience_tier || "1-3";
            const fRecs = records.filter(r => r.farmer_id === f.id || r.farmer_id === f.auth_id);
            const lastRecDate = fRecs.length > 0
              ? fRecs.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at
              : null;
            const crops = Array.isArray(f.planned_crops) ? f.planned_crops : [];
            const detailRows = [
              { label:"都道府県",   value: f.prefecture || "未設定" },
              { label:"市区町村",   value: f.municipality || "未設定" },
              { label:"栽培作物",   crops },
              { label:"登録日",     value: f.created_at ? new Date(f.created_at).toLocaleDateString("ja-JP") : "—" },
              { label:"最終入力日", value: lastRecDate ? new Date(lastRecDate).toLocaleDateString("ja-JP") : "未入力" },
            ];
            return (
              <div key={f.id} style={{ borderRadius:12, border:"1px solid #EBEBEB", background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.04)", overflow:"hidden" }}>
                {/* 閉じた状態 */}
                <div
                  onClick={() => setExpandedFarmer(isOpen ? null : f.id)}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", cursor:"pointer", userSelect:"none" }}
                >
                  <div style={{ flex:1, minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>{f.name}</p>
                    <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"2px 0 0" }}>{f.email}</p>
                  </div>
                  <span style={{
                    padding:"3px 9px", borderRadius:8, fontSize:10, fontWeight:700, flexShrink:0, whiteSpace:"nowrap",
                    background:"#E6F7EF", color:"#00A86B",
                  }}>{tier}年</span>
                  <span style={{ color:"#B0B0B0", fontSize:11, flexShrink:0 }}>{isOpen ? "▲" : "▼"}</span>
                </div>

                {/* 展開コンテンツ */}
                <div style={{ overflow:"hidden", maxHeight: isOpen ? "400px" : "0", transition:"max-height 0.3s ease" }}>
                  <div style={{ padding:"2px 16px 14px", borderTop:"1px solid #F7F7F7" }}>
                    {detailRows.map(({ label, value, crops: rowCrops }) => (
                      <div key={label} style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"6px 0", borderBottom:"1px solid #F7F7F7" }}>
                        <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", minWidth:88, flexShrink:0 }}>{label}</span>
                        {rowCrops !== undefined ? (
                          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                            {rowCrops.length > 0
                              ? rowCrops.map(c => (
                                  <span key={c} style={{ padding:"2px 8px", borderRadius:8, background:"#E6F7EF", color:"#00A86B", fontSize:11, fontWeight:600 }}>{c}</span>
                                ))
                              : <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>未設定</span>
                            }
                          </div>
                        ) : (
                          <span className="f-sans" style={{ fontSize:13, color:"#222" }}>{value}</span>
                        )}
                      </div>
                    ))}
                    <div style={{ display:"flex", gap:8, marginTop:12, justifyContent:"flex-end" }}>
                      <select value={f.experience_tier||"1-3"} onChange={e=>{ e.stopPropagation(); updateTier(f.id,e.target.value); }} style={{
                        padding:"5px 9px", border:"1px solid #EBEBEB", borderRadius:8, fontSize:11, background:"#fff", cursor:"pointer", fontFamily:"inherit", color:"#717171",
                      }}>
                        {TIERS.map(t=><option key={t} value={t}>{t}年</option>)}
                      </select>
                      <DangerBtn onClick={e=>{ e.stopPropagation(); deleteFarmer(f); }}>削除</DangerBtn>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
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


// ── OnboardingModal ──────────────────────────────────────────
const OB_SALES_CHANNELS = [
  { label:"JA（農協）出荷",           value:"ja" },
  { label:"市場出荷",                  value:"market" },
  { label:"直売所",                    value:"direct_store" },
  { label:"直接取引（レストラン・小売等）", value:"direct_trade" },
  { label:"ネット販売",                value:"online" },
  { label:"まだ決めていない",          value:"undecided" },
];

function OnboardingModal({ me, onComplete, isEditing = false, onClose }) {
  const totalSteps = 8;
  const [obStep, setObStep] = useState(1);
  const [obName,         setObName]         = useState(me.name || "");
  const [obPrefecture,   setObPrefecture]   = useState(me.prefecture || "");
  const [obMunicipality, setObMunicipality] = useState(me.municipality || "");
  const [obTier,         setObTier]         = useState(me.experience_tier || "");
  const [obFarmingType, setObFarmingType] = useState(me.farming_type || localStorage.getItem('ob_farming_type') || "");
  const [obArea,        setObArea]        = useState(me.area_tan || localStorage.getItem('ob_area_tan') || "");
  const [obCrops,       setObCrops]       = useState(me.planned_crops || []);
  const [obChannels,    setObChannels]    = useState(() => {
    if (me.sales_channels && Array.isArray(me.sales_channels) && me.sales_channels.length > 0) return me.sales_channels;
    try { return JSON.parse(localStorage.getItem('ob_sales_channels') || '[]'); } catch { return []; }
  });
  const [cropInput,     setCropInput]     = useState("");
  const [cropCandidates,setCropCandidates]= useState([]);
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    supabase.from('market_stats').select('crop').then(({ data }) => {
      if (data) setCropCandidates([...new Set(data.map(d => d.crop).filter(Boolean))].sort());
    });
  }, []);

  const canGoNext = [null, !!obName.trim(), !!obPrefecture, true, !!obTier, !!obFarmingType, true, true, true][obStep] ?? true;

  const goNext = () => { if (obStep < totalSteps) setObStep(s => s + 1); else handleSubmit(); };
  const goBack = () => setObStep(s => s - 1);

  const toggleCrop = crop => setObCrops(prev => {
    if (prev.includes(crop)) return prev.filter(c => c !== crop);
    if (prev.length >= 5) return prev;
    return [...prev, crop];
  });

  const addCustomCrop = () => {
    const c = cropInput.trim();
    if (!c || obCrops.includes(c) || obCrops.length >= 5) { setCropInput(""); return; }
    setObCrops(prev => [...prev, c]);
    setCropInput("");
  };

  const toggleChannel = value => {
    if (value === "undecided") {
      setObChannels(prev => prev.includes("undecided") ? [] : ["undecided"]);
    } else {
      setObChannels(prev => {
        const without = prev.filter(c => c !== "undecided");
        return without.includes(value) ? without.filter(c => c !== value) : [...without, value];
      });
    }
  };

  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);
    const { error } = await supabase.from('farmers').update({
      name: obName.trim(),
      prefecture: obPrefecture,
      municipality: obMunicipality.trim(),
      experience_tier: obTier,
      planned_crops: obCrops,
      farming_type: obFarmingType,
      area_tan: obArea,
      sales_channels: obChannels,
    }).eq('auth_id', me.id);
    if (!error) {
      try { localStorage.setItem('ob_farming_type', obFarmingType); } catch {}
      try { localStorage.setItem('ob_area_tan', obArea); } catch {}
      try { localStorage.setItem('ob_sales_channels', JSON.stringify(obChannels)); } catch {}
      await onComplete({ name: obName.trim(), prefecture: obPrefecture, municipality: obMunicipality.trim(), experience_tier: obTier, planned_crops: obCrops });
    }
    setSaving(false);
  };

  const CardBtn = ({ selected, onClick, children }) => (
    <button onClick={onClick} style={{
      width:"100%", textAlign:"left", padding:"20px", borderRadius:16,
      border: selected ? `2px solid ${C.accent}` : `2px solid ${C.border}`,
      background: selected ? C.accentLight : "#fff",
      fontSize:16, fontWeight: selected ? 600 : 400,
      color:C.ink, cursor:"pointer", transition:"all .15s", marginBottom:10,
    }}>{children}</button>
  );

  const stepContent = [
    // 1: 名前
    <div style={{ marginTop:32 }}>
      <input
        type="text" placeholder="例：田中太郎" value={obName} autoFocus
        onChange={e => setObName(e.target.value)}
        onKeyDown={e => e.key === "Enter" && obName.trim() && goNext()}
        style={{
          width:"100%", fontSize:24, textAlign:"center",
          border:"none", borderBottom:`2px solid ${C.ink}`,
          outline:"none", padding:"12px 0", background:"transparent",
          color:C.ink, fontFamily:"'Noto Sans JP',sans-serif",
        }}
      />
    </div>,

    // 2: 都道府県
    <div style={{
      display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginTop:24,
      maxHeight:"52vh", overflowY:"auto",
    }}>
      {PREFECTURES.map(p => (
        <button key={p} onClick={() => setObPrefecture(p)} style={{
          padding:"12px 4px", borderRadius:12, fontSize:13,
          border:`1px solid ${obPrefecture === p ? C.accent : C.border}`,
          background: obPrefecture === p ? C.accent : "#fff",
          color: obPrefecture === p ? "#fff" : C.ink,
          fontWeight: obPrefecture === p ? 600 : 400,
          cursor:"pointer", transition:"all .12s",
        }}>{p}</button>
      ))}
    </div>,

    // 3: 市町村
    <div style={{ marginTop:32 }}>
      <input
        type="text" placeholder="例：吉野川市山川町" value={obMunicipality} autoFocus
        onChange={e => setObMunicipality(e.target.value)}
        onKeyDown={e => e.key === "Enter" && goNext()}
        style={{
          width:"100%", fontSize:20, textAlign:"center",
          border:"none", borderBottom:`2px solid ${C.ink}`,
          outline:"none", padding:"12px 0", background:"transparent",
          color:C.ink, fontFamily:"'Noto Sans JP',sans-serif",
        }}
      />
      <p className="f-sans" style={{ fontSize:12, color:C.ghost, marginTop:16, textAlign:"center" }}>
        地域の経営指標をより正確に参照できます
      </p>
    </div>,

    // 4: 就農歴
    <div style={{ marginTop:24 }}>
      {[
        { label:"まだ始めていない（未就農）", value:"0" },
        { label:"1〜3年",  value:"1-3" },
        { label:"4〜10年", value:"4-10" },
        { label:"10年以上", value:"10+" },
      ].map(({ label, value }) => (
        <CardBtn key={value} selected={obTier === value} onClick={() => setObTier(value)}>{label}</CardBtn>
      ))}
    </div>,

    // 4: 専業/兼業
    <div style={{ marginTop:24 }}>
      <CardBtn selected={obFarmingType === "fulltime"} onClick={() => setObFarmingType("fulltime")}>専業農家（農業のみ）</CardBtn>
      <CardBtn selected={obFarmingType === "parttime"} onClick={() => setObFarmingType("parttime")}>兼業農家（他の仕事も）</CardBtn>
    </div>,

    // 5: 経営面積
    <div style={{ textAlign:"center", marginTop:48 }}>
      <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"center", gap:12 }}>
        <input
          type="number" min="0" value={obArea} autoFocus
          onChange={e => setObArea(e.target.value)}
          onKeyDown={e => e.key === "Enter" && goNext()}
          style={{
            width:160, fontSize:48, textAlign:"center",
            border:"none", borderBottom:`2px solid ${C.ink}`,
            outline:"none", padding:"8px 0", background:"transparent",
            color:C.ink, fontFamily:"'DM Mono','Courier New',monospace",
          }}
        />
        <span className="f-sans" style={{ fontSize:24, color:C.mid, marginBottom:10 }}>反</span>
      </div>
      <p className="f-sans" style={{ fontSize:12, color:C.ghost, marginTop:20 }}>1反 = 約1,000㎡ = 約10a</p>
    </div>,

    // 6: 栽培作物
    <div style={{ marginTop:20 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <input
          type="text" placeholder="作物名を入力してEnter" value={cropInput}
          onChange={e => setCropInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addCustomCrop()}
          style={{
            flex:1, border:`1px solid ${C.border}`, borderRadius:12,
            padding:"10px 14px", fontSize:14, outline:"none",
            fontFamily:"'Noto Sans JP',sans-serif",
          }}
        />
        <span className="f-mono" style={{ fontSize:13, color:C.mid, fontWeight:600, whiteSpace:"nowrap" }}>
          {obCrops.length}/5
        </span>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, maxHeight:"42vh", overflowY:"auto" }}>
        {[...new Set([...obCrops, ...cropCandidates])].map(crop => {
          const sel = obCrops.includes(crop);
          return (
            <button key={crop} onClick={() => toggleCrop(crop)} style={{
              padding:"8px 16px", borderRadius:20,
              border:`1px solid ${sel ? C.accent : C.border}`,
              background: sel ? C.accent : "#fff",
              color: sel ? "#fff" : C.ink,
              fontSize:13, fontWeight: sel ? 600 : 400,
              cursor: !sel && obCrops.length >= 5 ? "not-allowed" : "pointer",
              opacity: !sel && obCrops.length >= 5 ? 0.35 : 1,
              transition:"all .12s",
            }}>{crop}</button>
          );
        })}
      </div>
    </div>,

    // 7: 販売先
    <div style={{ marginTop:24 }}>
      {OB_SALES_CHANNELS.map(({ label, value }) => {
        const sel = obChannels.includes(value);
        return (
          <button key={value} onClick={() => toggleChannel(value)} style={{
            width:"100%", textAlign:"left", padding:"18px 20px", borderRadius:16,
            border: sel ? `2px solid ${C.accent}` : `2px solid ${C.border}`,
            background: sel ? C.accentLight : "#fff",
            fontSize:15, fontWeight: sel ? 600 : 400,
            color:C.ink, cursor:"pointer", transition:"all .15s", marginBottom:8, display:"block",
          }}>{label}</button>
        );
      })}
    </div>,
  ];

  const stepMeta = [
    {
      title:"お名前を教えてください",
      sub:"五年計画書に表示されます",
      desc:"五年計画書や融資資料に表示されます。本名をご入力ください。",
    },
    {
      title:"どちらにお住まいですか？",
      sub:"地域の経営指標を参照します",
      desc:"お住まいの地域の経営指標を自動で参照します。より正確な五年計画書を作成できます。",
    },
    {
      title:"市区町村を教えてください",
      sub:"地域の経営データに活用します",
      desc:"同じ地域の農家同士で経営データを比較できます。例：吉野川市、阿南市、美馬市など。",
    },
    {
      title:"農業の経験は？",
      sub:"同じ経験年数の農家と比較できます",
      desc:"同じ経験年数の農家と収支を比較できます。これから始める方は「まだ始めていない」を選んでください。",
    },
    {
      title:"農業は専業ですか？",
      sub:"収支構造の参考にします",
      desc:"専業と兼業では経営の収支構造が大きく異なります。五年計画書の農外所得の計算に使用します。",
    },
    {
      title:"経営面積を教えてください",
      sub:"おおよそで構いません（反）",
      desc:"10a（1反）あたりの収支を計算する基準になります。これから始める方は予定の面積でOKです。",
    },
    {
      title:"何を栽培していますか？",
      sub:"最大5つまで選べます（予定でもOK）",
      desc:"選んだ作物の公的統計データを五年計画書に自動で反映します。予定の作物でもOKです。最大5つまで。",
    },
    {
      title:"主な販売先は？",
      sub:"複数選べます（予定でもOK）",
      desc:"販売先によって手数料や運賃などの経費構造が変わります。将来の収支比較にも活用されます。",
    },
  ];

  const { title, sub, desc } = stepMeta[obStep - 1];

  return (
    <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:9999 }}>
      {/* プログレスバー */}
      <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:C.border }}>
        <div style={{
          height:4, background:C.accent,
          width:`${(obStep / totalSteps) * 100}%`,
          transition:"width 0.3s ease",
        }} />
      </div>

      {/* 閉じるボタン（編集時のみ） */}
      {isEditing && (
        <button
          onClick={onClose}
          style={{
            position:"absolute", top:16, right:20,
            background:"none", border:"none",
            fontSize:22, color:C.mid, cursor:"pointer",
            lineHeight:1, padding:4, zIndex:1,
          }}
        >✕</button>
      )}

      {/* コンテンツ */}
      <div style={{ maxWidth:480, margin:"0 auto", padding:"56px 24px 140px", overflowY:"auto", height:"100%" }}>
        <div key={obStep} className="fade-in">
          <h1 className="f-sans" style={{ fontSize:26, fontWeight:700, color:C.ink, marginBottom:8, lineHeight:1.35 }}>
            {title}
          </h1>
          <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, marginBottom:24 }}>{desc}</p>
          {stepContent[obStep - 1]}
        </div>
      </div>

      {/* ボトムナビ */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        background:"#fff", borderTop:`1px solid ${C.border}`,
        padding:"20px 24px calc(20px + env(safe-area-inset-bottom, 0px))",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        {obStep > 1
          ? <button onClick={goBack} className="f-sans" style={{
              background:"none", border:"none", fontSize:15,
              color:C.ink, cursor:"pointer", padding:"8px 0",
            }}>← 戻る</button>
          : <div />
        }
        <button
          onClick={canGoNext ? goNext : undefined}
          style={{
            background:C.accent, color:"#fff",
            border:"none", borderRadius:12,
            padding:"16px 32px", fontSize:16, fontWeight:700,
            cursor: canGoNext ? "pointer" : "not-allowed",
            opacity: canGoNext ? 1 : 0.5,
            pointerEvents: canGoNext ? "auto" : "none",
            transition:"opacity .2s",
          }}
        >
          {saving ? "保存中..." : obStep === totalSteps ? "始める" : "次へ →"}
        </button>
      </div>
    </div>
  );
}

// ── ProfileModal ─────────────────────────────────────────────
const SALES_LABELS = { ja:"JA出荷", market:"市場出荷", direct_store:"直売所", direct_trade:"直接取引", online:"ネット販売", undecided:"未定" };
const TIER_LABELS  = { "1-3":"1〜3年", "4-10":"4〜10年", "10+":"10年以上" };

function ProfileModal({ me, recs, isContributor, avatarUrl, onClose, onEditProfile, onLogout, onAvatarChange }) {
  const [delConfirm,   setDelConfirm]   = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const fileRef = useRef(null);

  const fid = me.id;
  const myRecs = Object.entries(recs)
    .filter(([k]) => k.startsWith(fid + "_"))
    .flatMap(([, v]) => v);
  const recCount = myRecs.length;
  const lastDates = myRecs.map(r => r.created_at).filter(Boolean);
  const lastDate  = lastDates.length > 0
    ? new Date(Math.max(...lastDates.map(d => new Date(d)))).toLocaleDateString("ja-JP")
    : "未入力";

  const crops      = Array.isArray(me.planned_crops) ? me.planned_crops : [];
  const farmType     = me.farming_type || localStorage.getItem('ob_farming_type') || "";
  const areaTan      = me.area_tan || localStorage.getItem('ob_area_tan') || "";
  const salesChannels = (me.sales_channels && Array.isArray(me.sales_channels) && me.sales_channels.length > 0)
    ? me.sales_channels
    : (() => { try { return JSON.parse(localStorage.getItem('ob_sales_channels') || '[]'); } catch { return []; } })();

  const handleFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = me.id + '/avatar.' + ext;
    await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = urlData?.publicUrl || '';
    await supabase.from('farmers').update({ avatar_url: url }).eq('auth_id', me.id);
    try { localStorage.setItem('avatarUrl_' + me.id, url); } catch {}
    onAvatarChange(url);
    setUploading(false);
  };

  const handleDeleteAvatar = async () => {
    if (!displayUrl) return;
    setUploading(true);
    try {
      const { data: files } = await supabase.storage.from('avatars').list(me.id + '/');
      if (files && files.length > 0) {
        const paths = files.map(f => me.id + '/' + f.name);
        await supabase.storage.from('avatars').remove(paths);
      }
      await supabase.from('farmers').update({ avatar_url: '' }).eq('auth_id', me.id);
      try { localStorage.removeItem('avatarUrl_' + me.id); } catch {}
      onAvatarChange("");
    } catch (err) {
      console.error('Avatar delete error:', err);
    }
    setUploading(false);
  };

  const displayUrl = avatarUrl || me.avatar_url || null;

  return (
    <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:9000, overflowY:"auto" }}>
      {/* 閉じるボタン */}
      <button onClick={onClose} style={{
        position:"absolute", top:16, right:16,
        width:36, height:36, borderRadius:"50%", border:"1px solid #EBEBEB",
        background:"#F7F7F7", fontSize:18, cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center", zIndex:1,
      }}>✕</button>

      <div style={{ maxWidth:480, margin:"0 auto", padding:"52px 20px 40px" }}>

        {/* アバターエリア */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:20 }}>
          <div style={{ position:"relative", width:100, height:100, marginBottom:14 }}>
            <div
              onClick={displayUrl ? () => setShowLightbox(true) : undefined}
              style={{
                width:100, height:100, borderRadius:"50%",
                background:"#E6F7EF", border:"2px solid #00A86B",
                display:"flex", alignItems:"center", justifyContent:"center",
                overflow:"hidden", fontSize:48,
                cursor: displayUrl ? "pointer" : "default",
              }}
            >
              {displayUrl
                ? <img src={displayUrl} alt="avatar" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                : getDefaultAvatar(me.id)
              }
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                position:"absolute", bottom:2, right:2,
                width:28, height:28, borderRadius:"50%",
                background:"#00A86B", border:"none",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:13, cursor:"pointer",
              }}
            >📷</button>
            {displayUrl && (
              <button
                onClick={handleDeleteAvatar}
                disabled={uploading}
                style={{
                  position:"absolute", bottom:2, left:2,
                  width:28, height:28, borderRadius:"50%",
                  background:"#E24B4A", border:"none",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:13, cursor:"pointer", color:"#fff",
                }}
              >🗑</button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display:"none" }} onChange={handleFile} />
          </div>
          <p className="f-sans" style={{ fontSize:24, fontWeight:600, color:"#222", textAlign:"center", margin:0 }}>{me.name}</p>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", marginTop:4 }}>{me.email}</p>
        </div>

        {/* 情報カード */}
        <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:20, marginBottom:16 }}>
          {[
            { icon:"🗾", label:"都道府県",   value: me.prefecture || "未設定" },
            { icon:"📍", label:"市区町村",   value: me.municipality || "未設定" },
            { icon:"📅", label:"就農歴",     value: TIER_LABELS[me.experience_tier] || "未設定" },
            { icon:"🏠", label:"専業/兼業",  value: farmType === "fulltime" ? "専業農家" : farmType === "parttime" ? "兼業農家" : "未設定" },
            { icon:"📐", label:"経営面積",   value: areaTan ? areaTan + " 反" : "未設定" },
          ].map(({ icon, label, value }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
              <span style={{ fontSize:14, width:20, textAlign:"center", flexShrink:0 }}>{icon}</span>
              <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", minWidth:80, flexShrink:0 }}>{label}</span>
              <span className="f-sans" style={{ fontSize:13, color:"#222" }}>{value}</span>
            </div>
          ))}
          {/* 栽培作物 */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
            <span style={{ fontSize:14, width:20, textAlign:"center", flexShrink:0 }}>🌱</span>
            <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", minWidth:80, flexShrink:0 }}>栽培作物</span>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {crops.length > 0
                ? crops.map(c => <span key={c} style={{ padding:"2px 8px", borderRadius:8, background:"#E6F7EF", color:"#00A86B", fontSize:11, fontWeight:600 }}>{c}</span>)
                : <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>未設定</span>
              }
            </div>
          </div>
          {/* 販売先 */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 0" }}>
            <span style={{ fontSize:14, width:20, textAlign:"center", flexShrink:0 }}>🚛</span>
            <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", minWidth:80, flexShrink:0 }}>販売先</span>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {salesChannels.length > 0
                ? salesChannels.map(v => <span key={v} style={{ padding:"2px 8px", borderRadius:8, background:"#F7F7F7", color:"#222", fontSize:11, fontWeight:500 }}>{SALES_LABELS[v] || v}</span>)
                : <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>未設定</span>
              }
            </div>
          </div>
        </div>

        {/* データ状況カード */}
        <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:20, marginBottom:24 }}>
          {[
            { label:"入力データ数", value: recCount + " 件" },
            { label:"最終入力日",   value: lastDate },
            { label:"ステータス",   value: isContributor ? "✅ 貢献者" : "⚠ 会員（入力でアクセス復活）" },
          ].map(({ label, value }) => (
            <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
              <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>{label}</span>
              <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:500 }}>{value}</span>
            </div>
          ))}
        </div>

        {/* ボタンエリア */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <button onClick={onEditProfile} className="btn-primary" style={{ width:"100%", padding:"13px" }}>
            プロフィールを編集
          </button>
          <button onClick={onLogout} className="btn-outline" style={{ width:"100%", padding:"12px" }}>
            ログアウト
          </button>
          {!delConfirm
            ? <button onClick={() => setDelConfirm(true)} className="f-sans" style={{
                width:"100%", padding:"12px", border:"none", background:"none",
                fontSize:13, color:"#E24B4A", cursor:"pointer",
              }}>退会する</button>
            : <div style={{ padding:16, background:"#FCEBEB", borderRadius:12, border:"1px solid #E24B4A44" }}>
                <p className="f-sans" style={{ fontSize:13, color:"#E24B4A", marginBottom:12, lineHeight:1.7 }}>
                  本当に退会しますか？<br/>データは30日以内に削除されます。
                </p>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => setDelConfirm(false)} className="btn-outline" style={{ flex:1, padding:"10px" }}>キャンセル</button>
                  <button onClick={async () => { await supabase.auth.signOut(); onLogout(); }} style={{
                    flex:1, padding:"10px", background:"#E24B4A", color:"#fff", border:"none",
                    borderRadius:12, fontSize:13, fontWeight:600, cursor:"pointer",
                  }}>退会する</button>
                </div>
              </div>
          }
        </div>
      </div>

      {showLightbox && displayUrl && (
        <div onClick={() => setShowLightbox(false)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer",
          animation:"fadeIn .2s ease",
        }}>
          <button onClick={e => { e.stopPropagation(); setShowLightbox(false); }} style={{
            position:"absolute", top:20, right:20,
            width:40, height:40, borderRadius:"50%",
            background:"rgba(255,255,255,0.15)", border:"none",
            color:"#fff", fontSize:22, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>✕</button>
          <img
            src={displayUrl}
            alt="avatar full"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth:"90vw", maxHeight:"90vh",
              objectFit:"contain", borderRadius:4,
              cursor:"default",
            }}
          />
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
  const [showOnboarding,setShowOnboarding]=useState(false);
  const [obModalKey,setObModalKey]=useState(0);
  const [notifs,setNotifs]=useState([]);
  const [showNotifs,setShowNotifs]=useState(false);
  const [showProfile,setShowProfile]=useState(false);
  const [avatarUrl,setAvatarUrl]=useState("");
  useEffect(()=>{
    if(!me?.id)return;
    setAvatarUrl(me.avatar_url || localStorage.getItem('avatarUrl_'+me.id) || "");
  },[me?.id, me?.avatar_url]);
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
    const f = dbFarmers ? dbFarmers.map(fr => ({ id: fr.auth_id || fr.id, name: fr.name, email: fr.email, joinedYear: fr.joined_year, prefecture: fr.prefecture || "", municipality: fr.municipality || "", planned_crops: fr.planned_crops || [], experience_tier: fr.experience_tier || "", farming_type: fr.farming_type || "", area_tan: fr.area_tan || "", sales_channels: fr.sales_channels || [], avatar_url: fr.avatar_url || "" })) : [];
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

  const completeOnboarding=useCallback(async(updates)=>{
    const{data:dbFarmers}=await supabase.from('farmers').select('*');
    if(dbFarmers){
      const f=dbFarmers.map(fr=>({id:fr.auth_id||fr.id,name:fr.name,email:fr.email,joinedYear:fr.joined_year,prefecture:fr.prefecture||"",municipality:fr.municipality||"",planned_crops:fr.planned_crops||[],experience_tier:fr.experience_tier||"",farming_type:fr.farming_type||"",area_tan:fr.area_tan||"",sales_channels:fr.sales_channels||[],avatar_url:fr.avatar_url||""}));
      setFarmers(f);
      setMe(prev=>{
        const updated=f.find(x=>x.id===prev?.id);
        return updated?updated:prev;
      });
    }
    setShowOnboarding(false);
    setTab("board");
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
        {/* PC: タブ（左）*/}
        <nav style={{display:"flex",flex:1}} className="header-nav">
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

        {/* 右：通知ベル＋ユーザーピル（PC）／全幅（スマホ） */}
        {me&&(
          <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto"}}>
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
            <div
              onClick={()=>setShowProfile(true)}
              style={{
                display:"flex",alignItems:"center",gap:6,
                padding:"4px 10px 4px 4px",background:"#F7F7F7",
                borderRadius:20,border:"1px solid #EBEBEB",cursor:"pointer",
              }}
            >
              {/* ミニアバター */}
              <div style={{
                width:28,height:28,borderRadius:"50%",
                background:"#E6F7EF",border:"1.5px solid #00A86B",
                display:"flex",alignItems:"center",justifyContent:"center",
                overflow:"hidden",flexShrink:0,fontSize:16,
              }}>
                {(avatarUrl||me.avatar_url)
                  ? <img src={avatarUrl||me.avatar_url} alt="avatar" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  : getDefaultAvatar(me.id)
                }
              </div>
              <span className="f-sans" style={{
                fontSize:11,fontWeight:500,color:"#222222",
                maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
              }}>{me.name}</span>
              <button
                onClick={e=>{e.stopPropagation();setShowOnboarding(true);setObModalKey(k=>k+1);}}
                title="プロフィール編集"
                style={{fontSize:13,background:"transparent",border:"none",cursor:"pointer",padding:"2px 2px",color:"#717171",lineHeight:1,flexShrink:0}}>⚙</button>
              <button onClick={e=>{e.stopPropagation();setMe(null);setTab("board");setNotifs([]);setShowNotifs(false);}} className="f-sans" style={{
                fontSize:9,color:"#717171",background:"transparent",
                border:"1px solid #EBEBEB",borderRadius:16,padding:"2px 8px",flexShrink:0,
              }}>ログアウト</button>
            </div>
          </div>
        )}
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
          {k:"board", icon:"📊", l:"ボード"},
          {k:"input", icon:"✏️", l:"入力"},
          ...(isMember?[{k:"plan", icon:"📋", l:"計画書"}]:[]),
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
        {tab==="board"&&<BoardTab farmers={farmers} destApproved={destOk} records={recs} userLevel={userLevel} onLogin={()=>setTab("input")} me={me}/>}
        {tab==="input"&&(me
          ? <InputTab loggedInFarmer={me} destApproved={destOk} destPending={destPend}
              records={recs} onAddRecord={addRec} onSubmitDest={subDest} onGoBoard={()=>setTab("board")}/>
          : authV==="register"
            ? <RegisterScreen onGoLogin={()=>setAuthV("login")} onSubmit={subReg}/>
            : <LoginScreen farmers={farmers} onLogin={f=>{setMe(f);setAuthV("login");loadNotifs(f.id);}} onGoRegister={()=>setAuthV("register")}/>
        )}
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
      {me&&((!me.name?.trim()||!me.prefecture)||showOnboarding)&&(
        <OnboardingModal
          key={obModalKey}
          me={me}
          onComplete={completeOnboarding}
          isEditing={showOnboarding&&!!(me.name?.trim()&&me.prefecture)}
          onClose={()=>setShowOnboarding(false)}
        />
      )}
      {showProfile&&me&&(
        <ProfileModal
          me={me}
          recs={recs}
          isContributor={isContributor}
          avatarUrl={avatarUrl}
          onClose={()=>setShowProfile(false)}
          onEditProfile={()=>{setShowProfile(false);setShowOnboarding(true);setObModalKey(k=>k+1);}}
          onLogout={()=>{setMe(null);setTab("board");setNotifs([]);setShowNotifs(false);setShowProfile(false);}}
          onAvatarChange={url=>setAvatarUrl(url)}
        />
      )}
    </div>
  );
}
