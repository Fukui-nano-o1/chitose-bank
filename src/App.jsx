import { createClient } from "@supabase/supabase-js";
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

import { useState, useEffect, useCallback, useRef } from "react";

// ══════════════════════════════════════════════════════════
// DESIGN SYSTEM — 「台帳の美学」
// 和紙と墨、金泥で書かれた帳簿を現代に翻訳する
// ══════════════════════════════════════════════════════════
const C = {
  // 暗地
  void:    "#080604",
  deep:    "#0F0B07",
  bark:    "#1C1409",
  shadow:  "#241A0C",
  // 和紙
  washi:   "#F4EDD8",
  cream:   "#FBF6EC",
  ivory:   "#EDE3C8",
  pale:    "#E8DEC8",
  // 金泥（経費の主役）
  gold:    "#C8890A",
  goldLt:  "#E8A820",
  goldPl:  "#FDF3DC",
  goldDim: "#6B4A08",
  // 青竹（売上）
  bamboo:  "#2D5A1B",
  bambooL: "#4A8C2A",
  bambooPl:"#EBF5E4",
  // 朱（警告）
  shu:     "#8B2A1A",
  shuPl:   "#FAE8E4",
  // テキスト
  ink:     "#14100A",
  mid:     "#6B5535",
  dim:     "#A08B6E",
  ghost:   "#C8B89A",
  rule:    "#DDD0B8",
  ruleD:   "#2A2016",
};

const DEST_INK = ["#2D5A1B","#1A3F6B","#7A3D10","#5C3080","#8B2518","#1A5E5E","#55610F","#6B3A18"];

// 農家データ（PINなし・メール認証のみ）
const SEED_FARMERS = [];
const SEED_DESTS = [];

const THIS_YEAR = 2025;
const ADMIN_PW  = "yoshino2025";
const MONTHS    = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

async function sGet(k){try{const r=await window.storage.get(k,true);return r?JSON.parse(r.value):null;}catch{return null;}}
async function sSet(k,v){try{await window.storage.set(k,JSON.stringify(v),true);}catch{}};

const cn  = n => Math.round(n).toLocaleString("ja-JP");
const man = n => { const a=Math.abs(n); return a>=10000?(Math.round(a/1000)/10).toFixed(1)+"万":cn(a); };
function uid(){ return Math.random().toString(36).slice(2,9); }
function destColor(name){ if(!name)return"#888"; let h=0; for(const c of name) h=(h*37+c.charCodeAt(0))>>>0; return DEST_INK[h%DEST_INK.length]; }

// ── CSS ────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@400;500;600;700;800&family=Zen+Kaku+Gothic+New:wght@300;400;500;700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }

::-webkit-scrollbar { width: 2px; height: 2px; }
::-webkit-scrollbar-thumb { background: ${C.ruleD}; border-radius: 1px; }
::-webkit-scrollbar-track { background: transparent; }

.f-serif { font-family: 'Shippori Mincho B1', 'Hiragino Mincho ProN', 'Yu Mincho', serif; }
.f-sans  { font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif; }
.f-mono  { font-family: 'DM Mono', 'Courier New', monospace; }

button, input, select { font-family: 'Zen Kaku Gothic New', sans-serif; }
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
@keyframes drawLine {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
@keyframes countUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
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
  background: ${C.cream};
  border: 1px solid ${C.rule};
  border-radius: 2px;
  box-shadow:
    0 1px 3px rgba(8,6,4,.06),
    0 4px 16px rgba(8,6,4,.08),
    0 12px 40px rgba(8,6,4,.05);
  position: relative;
  overflow: hidden;
}
.ledger-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, ${C.gold}55, transparent);
  opacity: 0;
  transition: opacity .3s;
}
.ledger-card:hover::before { opacity: 1; }

/* ── Ghost / skeleton ── */
.ghost-line {
  background: linear-gradient(90deg, ${C.ivory} 25%, ${C.pale} 50%, ${C.ivory} 75%);
  background-size: 200% 100%;
  animation: shimmer 2s ease infinite;
  border-radius: 2px;
}

/* ── Nav underline ── */
.nav-item { position: relative; }
.nav-item::after {
  content: '';
  position: absolute;
  bottom: -1px; left: 50%; right: 50%;
  height: 1px;
  background: ${C.washi};
  transition: left .25s ease, right .25s ease;
}
.nav-item.active::after { left: 0; right: 0; }

/* ── Input ── */
.field {
  width: 100%;
  padding: 11px 14px;
  border: 1px solid ${C.rule};
  border-radius: 3px;
  font-size: 14px;
  color: ${C.ink};
  background: ${C.cream};
  transition: border-color .2s, box-shadow .2s;
}
.field:focus {
  border-color: ${C.gold};
  box-shadow: 0 0 0 3px ${C.gold}18;
}
.field::placeholder { color: ${C.ghost}; }

/* ── Buttons ── */
.btn-dark {
  background: ${C.bark};
  color: ${C.washi};
  border: 1px solid ${C.shadow};
  border-radius: 3px;
  padding: 11px 24px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .06em;
}
.btn-dark:hover { background: ${C.shadow}; border-color: ${C.ruleD}; }
.btn-dark:disabled { opacity: .35; cursor: not-allowed; transform: none; }

.btn-outline {
  background: transparent;
  color: ${C.mid};
  border: 1px solid ${C.rule};
  border-radius: 3px;
  padding: 10px 20px;
  font-size: 12px;
}
.btn-outline:hover { border-color: ${C.dim}; color: ${C.ink}; }

.btn-gold {
  background: ${C.gold};
  color: #fff;
  border: none;
  border-radius: 3px;
  padding: 11px 24px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .04em;
}
.btn-gold:hover { background: ${C.goldLt}; }
.btn-gold:disabled { background: ${C.rule}; color: ${C.ghost}; cursor: not-allowed; transform: none; }

/* ── Label ── */
.lbl {
  display: block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: ${C.dim};
  margin-bottom: 7px;
}

/* ── Rule with text ── */
.rule-text {
  display: flex;
  align-items: center;
  gap: 12px;
  color: ${C.ghost};
  font-size: 9px;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.rule-text::before, .rule-text::after {
  content: '';
  flex: 1;
  height: 1px;
  background: ${C.rule};
}

/* ── Tag ── */
.tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 1px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
`;

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

function GhostCard({ index }) {
  const yr = 2021 + index;
  return (
    <div className="ledger-card appear" style={{ overflow:"hidden", animationDelay:`${index*.12}s` }}>
      {/* dark header */}
      <div style={{
        background:C.bark, padding:"22px 28px",
        borderBottom:`1px solid ${C.ruleD}`,
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div className="f-sans" style={{ fontSize:9, color:`${C.washi}30`, letterSpacing:".14em", marginBottom:8, textTransform:"uppercase" }}>
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
              borderRadius:2,
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
          <div className="f-serif" style={{ fontSize:13, color:C.ghost, lineHeight:2, letterSpacing:".06em" }}>
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
    const f = farmers.find(x => x.email?.toLowerCase()===email.trim().toLowerCase());
    if (!f) { setErr("このメールアドレスは登録されていません"); bounce(); return; }
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
    onLogin({ ...pending.farmer, id: data.user.id });
};

  return (
    <div className="fade-in" style={{ minHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center",padding:28 }}>
      <div style={{ width:"100%",maxWidth:360 }}>
        <div style={{ textAlign:"center",marginBottom:40 }}>
          <div style={{ fontSize:44,marginBottom:14,lineHeight:1 }}>🥦</div>
          <div className="f-serif" style={{ fontSize:22,fontWeight:700,color:C.ink,letterSpacing:".06em" }}>吉野川 ブロッコリー農家</div>
          <div className="f-sans" style={{ fontSize:9,color:C.dim,marginTop:7,letterSpacing:".18em",textTransform:"uppercase" }}>Yoshinogawa Broccoli Farmers</div>
        </div>

        <div className="ledger-card" style={{ padding:32 }}>
          <div className="f-serif" style={{ fontSize:14,fontWeight:700,color:C.ink,marginBottom:24,letterSpacing:".04em" }}>ログイン</div>

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
              <button className="btn-dark" style={{ width:"100%",position:"relative" }}
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
              <div style={{ padding:"12px 14px",background:C.bambooPl,borderRadius:2,border:`1px solid ${C.bamboo}22`,marginBottom:18 }}>
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
              <button className="btn-dark" style={{ width:"100%",marginBottom:10 }}
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
        <div className="f-serif" style={{ fontSize:18,fontWeight:700,color:C.bamboo,marginBottom:12 }}>申請を受け付けました</div>
        <p className="f-sans" style={{ fontSize:12,color:C.mid,lineHeight:2,marginBottom:28 }}>
          管理者が承認するまでお待ちください。<br/>
          承認後はメールアドレスだけで<br/>
          ログインできます（コード認証）。
        </p>
        <button className="btn-dark" onClick={onGoLogin}>ログイン画面へ</button>
      </div>
    </div>
  );

  return (
    <div className="fade-in" style={{ minHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center",padding:28 }}>
      <div style={{ width:"100%",maxWidth:380 }}>
        <div style={{ textAlign:"center",marginBottom:32 }}>
          <div style={{ fontSize:36,marginBottom:12 }}>🥦</div>
          <div className="f-serif" style={{ fontSize:20,fontWeight:700,color:C.ink }}>新規登録申請</div>
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

// ── BoardTab ─────────────────────────────────────────────────
function BoardTab({ farmers, destApproved, records }) {
  const destMap = Object.fromEntries(destApproved.map(d => [d.id, d]));

  // 全体集計
  const allRecs = farmers.flatMap(f =>
    MONTHS.flatMap((_,i) => records[`${f.id}_${THIS_YEAR}_${i}`] || [])
  );
  const totalRev   = allRecs.reduce((s,e) => s + e.boxes*e.ppb, 0);
  const totalCst   = allRecs.reduce((s,e) => s + e.costs.reduce((a,c)=>a+c.a,0), 0);
  const hasAnyData = totalRev > 0;

  // 産地経費ランキング
  const costMap = {};
  allRecs.forEach(e => e.costs.forEach(c => { if(c.l) costMap[c.l]=(costMap[c.l]||0)+c.a; }));
  const topCosts = Object.entries(costMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

  return (
    <div className="appear">

      {/* ══ HERO ══════════════════════════════════════════ */}
      <div style={{
        background: C.bark,
        borderRadius:2,
        padding:"44px 40px 36px",
        marginBottom:32,
        position:"relative",
        overflow:"hidden",
        boxShadow:"0 8px 48px rgba(8,6,4,.32)",
      }}>
        {/* 装飾：縦線 */}
        <div style={{
          position:"absolute", top:0, bottom:0, left:40,
          width:1, background:`${C.washi}06`,
        }}/>
        <div style={{
          position:"absolute", top:0, bottom:0, right:40,
          width:1, background:`${C.washi}06`,
        }}/>
        {/* 装飾：右上の円 */}
        <div style={{
          position:"absolute", top:-60, right:-60,
          width:240, height:240, borderRadius:"50%",
          background:`${C.gold}09`,
          pointerEvents:"none",
        }}/>
        <div style={{
          position:"absolute", bottom:-40, left:120,
          width:140, height:140, borderRadius:"50%",
          background:`${C.bamboo}08`,
          pointerEvents:"none",
        }}/>

        <div style={{ position:"relative", zIndex:1 }}>
          {/* 上部ラベル */}
          <div className="f-sans" style={{
            fontSize:9, letterSpacing:".2em", color:`${C.washi}30`,
            textTransform:"uppercase", marginBottom:18,
            display:"flex", alignItems:"center", gap:14,
          }}>
            <span style={{ flex:"none" }}>be-looking</span>
            <span style={{ flex:"none", width:40, height:1, background:`${C.washi}18`, display:"inline-block" }}/>
            <span>{THIS_YEAR} · 吉野川 · ブロッコリー · {farmers.length}農家</span>
          </div>

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:28 }}>
            <div style={{ maxWidth:520 }}>
              <h1 className="f-serif" style={{
                fontSize:32, fontWeight:800, color:C.washi,
                lineHeight:1.4, letterSpacing:".03em", marginBottom:16,
              }}>
                農業経営の実態を、<br/>
                <span style={{ color:C.gold }}>経費から</span>公開する。
              </h1>
              <p className="f-sans" style={{
                fontSize:12, color:`${C.washi}70`,
                lineHeight:2, maxWidth:400,
              }}>
                売上だけではわからない。運賃・資材・手数料——
                <strong style={{ color:`${C.gold}AA` }}>経費の内訳</strong>を公開することで、
                就農を考える人が現実を知り、
                支援する人が正確に動ける。
              </p>
            </div>

            {/* 数字ペア */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, minWidth:220 }}>
              {[
                { lbl:"産地合計経費", val:hasAnyData&&totalCst>0?man(totalCst):"——", accent:true },
                { lbl:"産地合計売上", val:hasAnyData&&totalRev>0?man(totalRev):"——", accent:false },
              ].map(s => (
                <div key={s.lbl} style={{
                  padding:"16px 18px",
                  background: s.accent?`${C.gold}14`:`${C.washi}05`,
                  border:`1px solid ${s.accent?C.gold+"30":C.washi+"12"}`,
                  borderRadius:2,
                }}>
                  <div className="f-sans" style={{
                    fontSize:8, letterSpacing:".12em", textTransform:"uppercase",
                    color:s.accent?`${C.gold}80`:`${C.washi}35`,
                    marginBottom:8,
                  }}>{s.lbl}</div>
                  <div className="f-mono" style={{
                    fontSize:24, fontWeight:500,
                    color:s.accent?C.gold:`${C.washi}70`,
                    lineHeight:1,
                  }}>{s.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* フッター注記 */}
          <div style={{
            marginTop:24, paddingTop:16,
            borderTop:`1px solid ${C.washi}10`,
            display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
          }}>
            {[
              "個人名は非公開",
              "格付け・ランキングを目的としない",
              "データは農家本人が入力",
            ].map(t => (
              <span key={t} className="f-sans" style={{
                fontSize:9, color:`${C.washi}30`, letterSpacing:".08em",
                display:"flex", alignItems:"center", gap:5,
              }}>
                <span style={{ width:3, height:3, borderRadius:"50%", background:`${C.washi}30`, display:"inline-block" }}/>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ══ 経費ランキング ══════════════════════════════════ */}
      <div style={{ marginBottom:32 }}>
        <div style={{
          padding:"24px 28px",
          background:C.goldPl,
          border:`1px solid ${C.gold}28`,
          borderRadius:2,
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
            <div>
              <div className="f-sans" style={{
                fontSize:9, fontWeight:700, letterSpacing:".14em", textTransform:"uppercase",
                color:C.gold, marginBottom:5,
              }}>産地全体 — 経費ランキング</div>
              <div className="f-serif" style={{ fontSize:13, color:C.ink, letterSpacing:".03em" }}>
                何に、いくらかかっているか
              </div>
            </div>
            <span className="tag f-sans" style={{
              background:C.gold, color:"#fff", fontSize:8,
            }}>COST</span>
          </div>

          {topCosts.length > 0 ? (
            <div className="stagger" style={{ display:"grid", gap:12 }}>
              {topCosts.map(([label, total], i) => {
                const max = topCosts[0][1];
                const w   = total / max * 100;
                return (
                  <div key={label} className="appear" style={{
                    display:"grid",
                    gridTemplateColumns:"20px 88px 1fr 72px",
                    alignItems:"center", gap:12,
                  }}>
                    <div className="f-mono" style={{ fontSize:10, color:C.dim, textAlign:"center" }}>
                      {i+1}
                    </div>
                    <div className="f-sans" style={{ fontSize:12, fontWeight:500, color:C.ink }}>
                      {label}
                    </div>
                    <div style={{ height:6, background:C.ivory, borderRadius:1, overflow:"hidden" }}>
                      <div style={{
                        height:6, background:`linear-gradient(90deg, ${C.gold}, ${C.goldLt})`,
                        width:`${w}%`, borderRadius:1,
                        animation:"appear .6s ease both",
                        animationDelay:`${.3+i*.08}s`,
                      }}/>
                    </div>
                    <div className="f-mono" style={{
                      fontSize:13, fontWeight:500, color:C.gold, textAlign:"right",
                    }}>{man(total)}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 空の状態 — 何が入るかを示す */
            <div>
              <div style={{ display:"grid", gap:12, marginBottom:16 }}>
                {[
                  { lbl:"運　　賃", w:100 },
                  { lbl:"資材費",   w:72 },
                  { lbl:"市場手数料", w:55 },
                  { lbl:"包装費",   w:40 },
                  { lbl:"燃料費",   w:28 },
                ].map(({ lbl, w }, i) => (
                  <div key={i} style={{
                    display:"grid", gridTemplateColumns:"20px 88px 1fr 72px",
                    alignItems:"center", gap:12, opacity:1-i*.14,
                  }}>
                    <div className="f-mono" style={{ fontSize:10, color:`${C.gold}40`, textAlign:"center" }}>{i+1}</div>
                    <div className="f-sans" style={{ fontSize:12, color:`${C.mid}60` }}>{lbl}</div>
                    <div style={{ height:6, background:C.ivory, borderRadius:1, overflow:"hidden" }}>
                      <div style={{
                        height:6,
                        background:`linear-gradient(90deg, ${C.gold}30, ${C.gold}18)`,
                        width:`${w}%`, borderRadius:1,
                      }}/>
                    </div>
                    <div className="f-mono" style={{ fontSize:13, color:`${C.gold}35`, textAlign:"right" }}>——</div>
                  </div>
                ))}
              </div>
              <p className="f-sans" style={{
                fontSize:11, color:C.dim, lineHeight:1.9,
                paddingTop:14, borderTop:`1px dashed ${C.rule}`,
              }}>
                農家がデータを入力すると、<strong style={{ color:C.gold }}>何にいくらかかっているか</strong>が
                産地全体でランキング表示されます。
                就農を考える人が最初に知るべき情報です。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ══ 農家カード ══════════════════════════════════════ */}
      <div style={{ marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:18 }}>
          <div className="f-serif" style={{ fontSize:15, color:C.ink, letterSpacing:".04em" }}>
            農家の記録
          </div>
          <div className="f-sans" style={{ fontSize:9, color:C.ghost, letterSpacing:".1em", textTransform:"uppercase" }}>
            {THIS_YEAR}年 · {farmers.length}名
          </div>
        </div>
      </div>

      <div className="stagger" style={{ display:"grid", gap:20 }}>
        {farmers.map((farmer, fi) => {
          const mRecs    = MONTHS.map((_,i) => records[`${farmer.id}_${THIS_YEAR}_${i}`] || []);
          const allFRecs = mRecs.flat();
          const fRev     = allFRecs.reduce((s,e) => s+e.boxes*e.ppb, 0);
          const fCst     = allFRecs.reduce((s,e) => s+e.costs.reduce((a,c)=>a+c.a,0), 0);
          const cstRatio = fRev>0 ? Math.round(fCst/fRev*100) : 0;
          const usedDsts = [...new Set(allFRecs.map(e=>e.destId))].map(id=>destMap[id]).filter(Boolean);
          const hasData  = fRev > 0;

          // 費目集計
          const cLabels = {};
          allFRecs.forEach(e => e.costs.forEach(c => { if(c.l) cLabels[c.l]=(cLabels[c.l]||0)+c.a; }));
          const cList = Object.entries(cLabels).sort((a,b)=>b[1]-a[1]);

          // 出荷先集計
          const byDest = {};
          allFRecs.forEach(e => {
            if (!byDest[e.destId]) byDest[e.destId]={boxes:0,rev:0,cost:0};
            byDest[e.destId].boxes += e.boxes;
            byDest[e.destId].rev   += e.boxes*e.ppb;
            byDest[e.destId].cost  += e.costs.reduce((a,c)=>a+c.a,0);
          });

          if (!hasData) return <GhostCard key={farmer.id} index={fi}/>;

          return (
            <div key={farmer.id} className="ledger-card appear" style={{ animationDelay:`${fi*.1}s` }}>

              {/* ─ HEADER ─ */}
              <div style={{
                background:C.bark,
                padding:"22px 28px 18px",
                borderBottom:`1px solid ${C.ruleD}`,
                position:"relative", overflow:"hidden",
              }}>
                <div style={{
                  position:"absolute", top:-30, right:-30,
                  width:140, height:140, borderRadius:"50%",
                  background:`${C.gold}08`, pointerEvents:"none",
                }}/>
                <div style={{ position:"relative", zIndex:1 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div>
                      <div className="f-sans" style={{
                        fontSize:9, color:`${C.washi}28`, letterSpacing:".14em",
                        textTransform:"uppercase", marginBottom:8,
                      }}>
                        就農{THIS_YEAR-farmer.joinedYear+1}年目 · {farmer.joinedYear}年〜 · ブロッコリー
                      </div>
                      {usedDsts.length>0&&(
                        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                          {usedDsts.map(d => (
                            <DestMark key={d.id} name={d.name} sz={20} showLabel={true}/>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 経費 主役数字 */}
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <div className="f-sans" style={{
                        fontSize:9, fontWeight:700, letterSpacing:".12em",
                        textTransform:"uppercase", color:C.goldDim, marginBottom:6,
                      }}>年間経費</div>
                      <div className="f-mono" style={{
                        fontSize:34, fontWeight:500, color:C.gold,
                        lineHeight:1, letterSpacing:"-.01em",
                      }}>
                        {man(fCst)}
                      </div>
                      <div className="f-sans" style={{ fontSize:10, color:`${C.washi}40`, marginTop:5 }}>
                        売上 <span className="f-mono">{man(fRev)}</span> の
                        <span className="f-mono" style={{ color:`${C.gold}AA`, marginLeft:4, fontWeight:500 }}>
                          {cstRatio}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 経費率バー */}
                  {fRev>0&&(
                    <div style={{ marginTop:16 }}>
                      <div style={{ height:4, background:`${C.washi}10`, borderRadius:1, overflow:"hidden" }}>
                        <div style={{
                          height:4, borderRadius:1,
                          background:`linear-gradient(90deg, ${C.gold}, ${C.goldLt})`,
                          width:`${Math.min(cstRatio,100)}%`,
                          boxShadow:`0 0 8px ${C.gold}60`,
                        }}/>
                      </div>
                      <div className="f-sans" style={{
                        display:"flex", justifyContent:"space-between",
                        marginTop:4, fontSize:8, color:`${C.washi}28`,
                      }}>
                        <span>経費 {cstRatio}%</span>
                        <span>売上 100%</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ─ BODY ─ */}
              <div style={{ padding:"20px 28px" }}>

                {/* 費目内訳 */}
                {cList.length>0&&(
                  <div style={{ marginBottom:20 }}>
                    <div className="f-sans" style={{
                      fontSize:9, fontWeight:700, letterSpacing:".12em",
                      textTransform:"uppercase", color:C.gold, marginBottom:14,
                    }}>経費の内訳</div>
                    <div style={{ display:"grid", gap:10 }}>
                      {cList.map(([lbl, amt]) => {
                        const pct = fCst>0 ? Math.round(amt/fCst*100) : 0;
                        return (
                          <div key={lbl} style={{
                            display:"grid",
                            gridTemplateColumns:"80px 1fr 56px 34px",
                            alignItems:"center", gap:10,
                          }}>
                            <div className="f-sans" style={{ fontSize:11, fontWeight:500, color:C.ink }}>{lbl}</div>
                            <div style={{ height:5, background:C.ivory, borderRadius:1, overflow:"hidden" }}>
                              <div style={{
                                height:5,
                                background:C.gold,
                                width:`${pct}%`, borderRadius:1,
                              }}/>
                            </div>
                            <div className="f-mono" style={{ fontSize:12, color:C.gold, fontWeight:500, textAlign:"right" }}>{man(amt)}</div>
                            <div className="f-sans" style={{ fontSize:9, color:C.dim, textAlign:"right" }}>{pct}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 区切り線 */}
                {cList.length>0&&Object.keys(byDest).length>0&&(
                  <div style={{ height:1, background:C.rule, margin:"0 0 18px" }}/>
                )}

                {/* 出荷先別 */}
                {Object.keys(byDest).length>0&&(
                  <div>
                    <div className="f-sans" style={{
                      fontSize:9, fontWeight:700, letterSpacing:".12em",
                      textTransform:"uppercase", color:C.mid, marginBottom:12,
                    }}>出荷先別</div>
                    <div style={{ display:"grid", gap:8 }}>
                      {Object.entries(byDest).map(([did, d]) => {
                        const dest = destMap[did];
                        const cr   = d.rev>0 ? Math.round(d.cost/d.rev*100) : 0;
                        return (
                          <div key={did} style={{
                            padding:"12px 16px",
                            background:C.cream,
                            border:`1px solid ${C.rule}`,
                            borderRadius:2,
                          }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                              {dest ? <DestMark name={dest.name} sz={22}/> : <span className="f-sans" style={{ fontSize:11, color:C.ghost }}>不明</span>}
                              <div className="f-mono" style={{ fontSize:9, color:C.ghost }}>{cn(d.boxes)}箱</div>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                              <div style={{ padding:"8px 12px", background:C.bambooPl, borderRadius:2 }}>
                                <div className="f-sans" style={{ fontSize:8, color:C.bamboo, fontWeight:700, letterSpacing:".08em", marginBottom:4 }}>売上</div>
                                <div className="f-mono" style={{ fontSize:15, fontWeight:500, color:C.bamboo }}>{man(d.rev)}</div>
                              </div>
                              <div style={{ padding:"8px 12px", background:C.goldPl, borderRadius:2, border:`1px solid ${C.gold}18` }}>
                                <div className="f-sans" style={{ fontSize:8, color:C.gold, fontWeight:700, letterSpacing:".08em", marginBottom:4 }}>経費</div>
                                <div className="f-mono" style={{ fontSize:15, fontWeight:500, color:C.gold }}>{d.cost>0?man(d.cost):"——"}</div>
                                {d.cost>0&&<div className="f-sans" style={{ fontSize:8, color:C.dim, marginTop:2 }}>売上の{cr}%</div>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 注記 */}
      <div style={{
        marginTop:32, padding:"12px 18px",
        borderTop:`1px solid ${C.rule}`,
      }}>
        <p className="f-sans" style={{ fontSize:10, color:C.ghost, lineHeight:1.9 }}>
          ⚠ このデータは農家本人が入力した参考値です。実際の契約・手数料内容は個別に異なります。格付け・ランキングを目的とするものではありません。
        </p>
      </div>
    </div>
  );
}

// ── InputTab ─────────────────────────────────────────────────
function InputTab({ loggedInFarmer, destApproved, destPending, records, onAddRecord, onSubmitDest }) {
  const [step,setStep]=useState(1);
  const [mon,setMon]=useState(new Date().getMonth());
  const [dest,setDest]=useState(null);
  const [boxes,setBoxes]=useState("");
  const [ppb,setPpb]=useState("");
  const [costs,setCosts]=useState([{l:"",v:"",mode:"yen"}]);
  const [saved,setSaved]=useState(false);
  const [newDN,setNewDN]=useState("");
  const [subDest,setSubDest]=useState(false);
  const [dSubmit,setDSubmit]=useState(false);
  const rev=(parseFloat(boxes)||0)*(parseFloat(ppb)||0);
  const myPend=destPending.filter(d=>d.submittedBy===loggedInFarmer?.name);

  const save=async()=>{
    if(!boxes||!ppb)return;
    const ci=costs.filter(c=>c.l&&c.v).map(c=>({
      l:c.l,a:c.mode==="pct"?Math.round(rev*(parseFloat(c.v)||0)/100):Math.round(parseFloat(c.v)||0)
    }));
    await onAddRecord(loggedInFarmer.id,THIS_YEAR,mon,{destId:dest.id,boxes:parseFloat(boxes),ppb:parseFloat(ppb),costs:ci});
    setSaved(true);
  };
  const submitDest=async()=>{
    if(!newDN.trim())return;
    await onSubmitDest({id:uid(),name:newDN.trim(),status:"pending",submittedBy:loggedInFarmer.name});
    setNewDN("");setSubDest(false);setDSubmit(true);
  };

  const STEPS=["月を選ぶ","出荷先","売上・経費"];
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
            <p className="f-serif" style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:20}}>何月のデータを入力しますか？</p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:22}}>
              {MONTHS.map((m,i)=>{
                const has=(records[`${loggedInFarmer.id}_${THIS_YEAR}_${i}`]||[]).length>0;
                const act=mon===i;
                return(
                  <button key={i} onClick={()=>setMon(i)} style={{
                    padding:"11px 4px",border:`1.5px solid ${act?C.gold:C.rule}`,borderRadius:2,
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
            <button className="btn-dark" style={{width:"100%"}} onClick={()=>setStep(2)}>続ける →</button>
          </div>
        )}

        {step===2&&(
          <div className="fade-in">
            <p className="f-serif" style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:18}}>{MONTHS[mon]}の出荷先</p>
            <div style={{display:"grid",gap:8,marginBottom:14}}>
              {destApproved.map(d=>{
                const sel=dest?.id===d.id,col=destColor(d.name);
                return(
                  <button key={d.id} onClick={()=>{setDest(d);setDSubmit(false);}} style={{
                    padding:"12px 16px",border:`1.5px solid ${sel?col:C.rule}`,borderRadius:2,
                    background:sel?`${col}10`:"#fff",
                    display:"flex",alignItems:"center",gap:10,
                  }}>
                    <DestMark name={d.name} sz={26}/>
                    {d.notes&&<span className="f-sans" style={{fontSize:9,color:C.ghost,marginLeft:"auto"}}>{d.notes}</span>}
                  </button>
                );
              })}
            </div>
            {myPend.length>0&&<div className="f-sans" style={{padding:"8px 12px",background:C.goldPl,borderRadius:2,marginBottom:10,fontSize:11,color:C.gold}}>承認待ち: {myPend.map(d=>d.name).join("、")}</div>}
            {dSubmit&&<div className="f-sans" style={{padding:"8px 12px",background:C.bambooPl,borderRadius:2,marginBottom:10,fontSize:11,color:C.bamboo}}>✓ 申請しました。管理者の承認後に利用できます。</div>}
            {!subDest
              ? <button onClick={()=>{setSubDest(true);setDSubmit(false);}} style={{width:"100%",padding:"9px",border:`1px dashed ${C.rule}`,borderRadius:2,background:"transparent",color:C.mid,fontSize:11,marginBottom:14,fontFamily:"inherit"}}>＋ 出荷先を申請する</button>
              : <div style={{padding:14,background:C.ivory,borderRadius:2,marginBottom:14,display:"grid",gap:9}}>
                  <p className="f-sans" style={{fontSize:11,color:C.gold}}>新しい出荷先は管理者の承認後に公開されます</p>
                  <input className="field f-sans" placeholder="会社・団体名" value={newDN} onChange={e=>setNewDN(e.target.value)}/>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn-gold" style={{flex:1}} onClick={submitDest}>申請する</button>
                    <button className="btn-outline" style={{flex:1}} onClick={()=>setSubDest(false)}>キャンセル</button>
                  </div>
                </div>
            }
            <div style={{display:"flex",gap:8}}>
              <button className="btn-outline" onClick={()=>setStep(1)}>← 戻る</button>
              <button className="btn-dark" style={{flex:1}} disabled={!dest} onClick={()=>setStep(3)}>続ける →</button>
            </div>
          </div>
        )}

        {step===3&&(
          <div className="fade-in">
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
              {[
                {lbl:loggedInFarmer.name,color:C.bark},
                {lbl:MONTHS[mon],color:C.bamboo},
                dest&&{lbl:dest.name,color:destColor(dest.name)},
              ].filter(Boolean).map(t=>(
                <span key={t.lbl} className="tag f-sans" style={{background:`${t.color}12`,color:t.color,border:`1px solid ${t.color}22`}}>{t.lbl}</span>
              ))}
            </div>
            <div style={{display:"grid",gap:14,marginBottom:18}}>
              {[{lbl:"出荷箱数",unit:"箱",val:boxes,fn:setBoxes},{lbl:"1箱あたり単価",unit:"円/箱",val:ppb,fn:setPpb}].map(f=>(
                <div key={f.lbl}>
                  <label className="lbl f-sans">{f.lbl}</label>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <input className="field f-mono" type="number" placeholder="0" value={f.val} onChange={e=>f.fn(e.target.value)} style={{flex:1,fontSize:20}}/>
                    <span className="f-sans" style={{fontSize:12,color:C.mid,whiteSpace:"nowrap"}}>{f.unit}</span>
                  </div>
                </div>
              ))}
              {rev>0&&<div style={{padding:"12px 16px",background:C.bambooPl,borderRadius:2,border:`1px solid ${C.bamboo}22`,display:"flex",justifyContent:"space-between"}}>
                <span className="f-sans" style={{fontSize:11,color:C.bamboo}}>売上合計</span>
                <span className="f-mono" style={{fontSize:18,fontWeight:500,color:C.bamboo}}>{man(rev)}</span>
              </div>}
              <div>
                <label className="lbl f-sans">経費項目（省略可）</label>
                <div style={{display:"grid",gap:8}}>
                  {costs.map((c,i)=>{
                    const isPct=c.mode==="pct";
                    const ye=isPct&&rev>0?Math.round(rev*(parseFloat(c.v)||0)/100):null;
                    return(
                      <div key={i}>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <input className="field f-sans" placeholder="項目名（例：運賃）" value={c.l}
                            onChange={e=>{const n=[...costs];n[i]={...n[i],l:e.target.value};setCosts(n);}} style={{flex:2}}/>
                          <input className="field f-mono" type="number" placeholder="0" value={c.v}
                            onChange={e=>{const n=[...costs];n[i]={...n[i],v:e.target.value};setCosts(n);}} style={{flex:1}}/>
                          <div style={{display:"flex",borderRadius:2,overflow:"hidden",border:`1px solid ${C.rule}`,flexShrink:0}}>
                            {["yen","pct"].map(mode=>(
                              <button key={mode} onClick={()=>{const n=[...costs];n[i]={...n[i],mode};setCosts(n);}} style={{
                                padding:"8px 9px",border:"none",fontSize:10,fontWeight:700,
                                background:c.mode===mode?C.bark:"transparent",
                                color:c.mode===mode?"#fff":C.dim,
                              }}>{mode==="yen"?"円":"%"}</button>
                            ))}
                          </div>
                          {costs.length>1&&<button onClick={()=>setCosts(costs.filter((_,j)=>j!==i))} style={{padding:"8px",border:`1px solid ${C.rule}`,borderRadius:2,background:"transparent",color:C.dim,fontSize:11}}>×</button>}
                        </div>
                        {isPct&&ye!==null&&<p className="f-sans" style={{marginTop:4,fontSize:10,color:C.gold}}>→ 売上の{c.v||0}% ≒ {cn(ye)} 円</p>}
                      </div>
                    );
                  })}
                  {costs.length<5&&<button onClick={()=>setCosts([...costs,{l:"",v:"",mode:"yen"}])} style={{padding:"8px",border:`1px dashed ${C.rule}`,borderRadius:2,background:"transparent",color:C.mid,fontSize:11,fontFamily:"inherit"}}>＋ 経費追加</button>}
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-outline" onClick={()=>setStep(2)}>← 戻る</button>
              <button className="btn-dark" style={{flex:1,background:saved?C.bamboo:undefined}} disabled={!boxes||!ppb} onClick={save}>
                {saved?"✓ 保存しました":"保存する"}
              </button>
            </div>
            {saved&&<div style={{marginTop:12,textAlign:"center"}}>
              <button onClick={()=>{setStep(1);setSaved(false);setCosts([{l:"",v:"",mode:"yen"}]);}} className="f-sans" style={{fontSize:12,color:C.mid,background:"none",border:"none",textDecoration:"underline",textUnderlineOffset:3}}>別の月を入力する</button>
            </div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AdminTab ─────────────────────────────────────────────────
function AdminTab({destPending,destApproved,farmers,farmersPending,onApprove,onReject,onApproveFarmer,onRejectFarmer}){
  const [pw,setPw]=useState("");const[ok,setOk]=useState(false);const[err,setErr]=useState(false);
  const [sub,setSub]=useState("pending");
  const auth=()=>{pw===ADMIN_PW?(setOk(true),setErr(false)):setErr(true);};
  const total=destPending.length+farmersPending.length;

  if(!ok)return(
    <div className="fade-in" style={{maxWidth:340,margin:"60px auto"}}>
      <div className="ledger-card" style={{padding:28}}>
        <p className="f-serif" style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:4}}>🔑 管理者ログイン</p>
        <p className="f-sans" style={{fontSize:11,color:C.mid,marginBottom:18,lineHeight:1.8}}>出荷先・農家登録の承認を行います</p>
        <input className="field f-sans" type="password" placeholder="パスワード" value={pw}
          onChange={e=>{setPw(e.target.value);setErr(false);}} onKeyDown={e=>e.key==="Enter"&&auth()}
          style={{marginBottom:8,borderColor:err?C.shu:undefined}}/>
        {err&&<p className="f-sans" style={{fontSize:11,color:C.shu,marginBottom:8}}>パスワードが違います</p>}
        <button className="btn-dark" style={{width:"100%"}} onClick={auth}>ログイン</button>
      </div>
    </div>
  );

  return(
    <div className="appear" style={{maxWidth:640,margin:"0 auto"}}>
      <div style={{marginBottom:18,paddingBottom:14,borderBottom:`1px solid ${C.rule}`}}>
        <p className="f-serif" style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:3}}>管理者コンソール</p>
        <p className="f-sans" style={{fontSize:11,color:C.mid}}>承認・PIN管理</p>
      </div>
      <div style={{display:"flex",gap:3,background:C.ivory,border:`1px solid ${C.rule}`,borderRadius:2,padding:3,marginBottom:22}}>
        {[{k:"pending",l:"📋 承認待ち",c:total},{k:"farmers",l:"🌾 農家アカウント",c:farmers.length}].map(({k,l,c})=>(
          <button key={k} onClick={()=>setSub(k)} style={{
            flex:1,padding:"9px 6px",border:"none",borderRadius:2,fontFamily:"inherit",
            background:sub===k?C.bark:"transparent",color:sub===k?"#fff":C.mid,
            fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:5,
          }}>
            {l}
            {c>0&&<span style={{padding:"1px 6px",borderRadius:10,fontSize:9,background:sub===k?"#fff3":C.rule,color:sub===k?"#fff":C.ink}}>{c}</span>}
          </button>
        ))}
      </div>

      {sub==="pending"&&<div className="fade-in">
        {total===0&&<div style={{padding:"48px 0",textAlign:"center"}}><div style={{fontSize:32,opacity:.15,marginBottom:12}}>✓</div><p className="f-sans" style={{color:C.ghost,fontSize:13}}>承認待ちの申請はありません</p></div>}
        {farmersPending.length>0&&<>
          <p className="f-sans" style={{fontSize:11,fontWeight:700,color:C.ink,marginBottom:10}}>🌱 農家登録申請</p>
          <div style={{display:"grid",gap:8,marginBottom:22}}>
            {farmersPending.map(f=>(
              <div key={f.id} className="ledger-card" style={{padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
                <div><p className="f-serif" style={{fontSize:14,fontWeight:700}}>{f.name}</p><p className="f-sans" style={{fontSize:10,color:C.dim,marginTop:2}}>{f.email}</p></div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn-gold" onClick={()=>onApproveFarmer(f.id)} style={{padding:"8px 18px"}}>承認</button>
                  <button className="btn-outline" onClick={()=>onRejectFarmer(f.id)} style={{color:C.shu,borderColor:`${C.shu}44`,padding:"8px 18px"}}>却下</button>
                </div>
              </div>
            ))}
          </div>
        </>}
        {destPending.length>0&&<>
          <p className="f-sans" style={{fontSize:11,fontWeight:700,color:C.ink,marginBottom:10}}>🆕 出荷先申請</p>
          <div style={{display:"grid",gap:8}}>
            {destPending.map(d=>(
              <div key={d.id} className="ledger-card" style={{padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
                <div><DestMark name={d.name} sz={32}/><p className="f-sans" style={{fontSize:10,color:C.dim,marginTop:6}}>申請者: {d.submittedBy}</p></div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn-gold" onClick={()=>onApprove(d.id)} style={{padding:"8px 18px"}}>承認</button>
                  <button className="btn-outline" onClick={()=>onReject(d.id)} style={{color:C.shu,borderColor:`${C.shu}44`,padding:"8px 18px"}}>却下</button>
                </div>
              </div>
            ))}
          </div>
        </>}
      </div>}

      {sub==="farmers"&&<div className="fade-in">
        <p className="f-sans" style={{fontSize:11,color:C.mid,marginBottom:16}}>
        承認済みの農家一覧です。ログインはメール認証コードで行われます。
      </p>
        <div style={{display:"grid",gap:10}}>
          {farmers.map(f=>(
            <div key={f.id} className="ledger-card" style={{padding:"14px 18px"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:C.bambooPl,border:`2px solid ${C.bamboo}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🌾</div>
                <div style={{flex:1}}>
                  <p className="f-serif" style={{fontSize:13,fontWeight:700}}>{f.name}</p>
                  <p className="f-sans" style={{fontSize:10,color:C.dim,marginTop:2}}>{f.email}</p>
                  <p className="f-sans" style={{fontSize:9,color:C.ghost,marginTop:1}}>就農{THIS_YEAR-f.joinedYear+1}年目</p>
                </div>
                <span className="tag f-sans" style={{background:`${C.bamboo}12`,color:C.bamboo,border:`1px solid ${C.bamboo}20`}}>メール認証</span>
              </div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}


// ── OnboardingModal ──────────────────────────────────────────
const ONBOARD_STEPS = [
  {
    icon:"📋",
    title:"公開ボードを見る",
    desc:"ログイン不要。吉野川のブロッコリー農家が実際にかかった経費・売上をそのまま公開しています。就農前に、現実の数字を確認してください。",
    tab:"board",
  },
  {
    icon:"✏️",
    title:"自分のデータを入力する",
    desc:"農家の方は「新規登録」からメールアドレスとPINを登録します。管理者の承認後、月ごとの売上と経費を入力できるようになります。",
    tab:"input",
  },
  {
    icon:"🔑",
    title:"管理者（同志会）へ",
    desc:"出荷先の追加申請・農家登録の承認はここから行います。クローズドな運用のため、管理者パスワードが必要です。",
    tab:"admin",
  },
];

function OnboardingModal({ onDismiss }) {
  const [step, setStep] = useState(0);
  const s = ONBOARD_STEPS[step];
  const isLast = step === ONBOARD_STEPS.length - 1;

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:200,
      background:"rgba(8,6,4,.72)",
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:24,
      backdropFilter:"blur(4px)",
      WebkitBackdropFilter:"blur(4px)",
      animation:"fadeIn .3s ease both",
    }}>
      <div className="ledger-card" style={{
        width:"100%", maxWidth:440,
        overflow:"hidden",
        boxShadow:"0 24px 80px rgba(8,6,4,.5)",
        animation:"appear .4s cubic-bezier(.22,.8,.36,1) both",
      }}>
        {/* ヘッダー */}
        <div style={{
          background:C.bark,
          padding:"22px 28px 18px",
          borderBottom:`1px solid ${C.ruleD}`,
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div className="f-sans" style={{ fontSize:9, color:`${C.washi}35`, letterSpacing:".14em", textTransform:"uppercase" }}>
              はじめての方へ
            </div>
            <button onClick={onDismiss} style={{
              background:"transparent", border:"none",
              color:`${C.washi}40`, fontSize:18, lineHeight:1, padding:0,
            }}>×</button>
          </div>
          {/* ステップドット */}
          <div style={{ display:"flex", gap:6, marginBottom:14 }}>
            {ONBOARD_STEPS.map((_,i) => (
              <div key={i} style={{
                height:3, flex:1, borderRadius:1,
                background: i<=step ? C.gold : `${C.washi}18`,
                transition:"background .3s",
              }}/>
            ))}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:32 }}>{s.icon}</span>
            <div className="f-serif" style={{ fontSize:18, fontWeight:700, color:C.washi, lineHeight:1.3 }}>
              {s.title}
            </div>
          </div>
        </div>

        {/* ボディ */}
        <div style={{ padding:"22px 28px 26px" }}>
          <p className="f-sans" style={{ fontSize:13, color:C.mid, lineHeight:2, marginBottom:24 }}>
            {s.desc}
          </p>

          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {step > 0 && (
              <button className="btn-outline" onClick={()=>setStep(p=>p-1)} style={{ flexShrink:0 }}>
                ← 戻る
              </button>
            )}
            <button
              className="btn-dark"
              style={{ flex:1 }}
              onClick={()=>{ isLast ? onDismiss() : setStep(p=>p+1); }}
            >
              {isLast ? "はじめる →" : "次へ →"}
            </button>
          </div>

          {/* スキップ */}
          <div style={{ marginTop:14, textAlign:"center" }}>
            <button onClick={onDismiss} className="f-sans" style={{
              background:"none", border:"none", fontSize:11, color:C.ghost,
              textDecoration:"underline", textUnderlineOffset:3,
            }}>スキップして公開ボードを見る</button>
          </div>
        </div>
      </div>
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
  const [showOnboard,setShowOnboard]=useState(false);

  const dismissOnboard=async()=>{
    await sSet("yw_onboard_seen",true);
    setShowOnboard(false);
  };

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
const seen=await sGet("yw_onboard_seen");
    if(!seen) setShowOnboard(true);
  　const { data: dbFarmers } = await supabase.from('farmers').select('*');
    const f = dbFarmers ? dbFarmers.map(fr => ({ id: fr.id, name: fr.name, email: fr.email, joinedYear: fr.joined_year })) : [];
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
        r[k].push({ destId: rec.dest_id, boxes: rec.boxes, ppb: rec.ppb, costs: rec.costs || [] });
      });
    }
    setFarmers(f);setFarmPend(fp);setDestOk(da);setDestPend(dp);setRecs(r);
    setBadgeCnt(fp.length+dp.length);setLoaded(true);
  })();},[]);

  const savF=useCallback(async f=>{setFarmers(f);await sSet("yw_farmers",f);},[]);
  const savFP=useCallback(async f=>{setFarmPend(f);await sSet("yw_farmers_pend",f);setBadgeCnt(f.length+(destPend?.length||0));},[destPend]);
  const savDA=useCallback(async d=>{setDestOk(d);await sSet("yw_dests_ok",d);},[]);
  const savDP=useCallback(async d=>{setDestPend(d);await sSet("yw_dests_pend",d);setBadgeCnt((farmPend?.length||0)+d.length);},[farmPend]);
  const savR=useCallback(async r=>{setRecs(r);await sSet("yw_records",r);},[]);
  
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
    }, { onConflict: 'farmer_id,year,month,dest_id' });
    if (error) console.error('records upsert error:', error);
  },[recs]);
  
const subDest=useCallback(async d=>{
    await supabase.from('dests').insert({ id: d.id, name: d.name, status: 'pending', submitted_by: d.submittedBy });
    await savDP([...destPend,d]);
  },[destPend,savDP]);
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


  if(!loaded)return(
    <div style={{minHeight:"100vh",background:C.deep,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p className="f-sans pulse-slow" style={{color:C.dim,fontSize:12,letterSpacing:".1em"}}>読み込み中</p>
    </div>
  );

  const TABS=[
    {k:"board",l:"公開ボード"},
    {k:"input",l:me?"データ入力":"🔒 データ入力",locked:!me},
    {k:"admin",l:"管理",badge:badgeCnt},
  ];

  return(
    <div style={{minHeight:"100vh",background:C.washi,color:C.ink}}>
      <style>{CSS}</style>
      {showOnboard&&loaded&&<OnboardingModal onDismiss={dismissOnboard}/>}

      {/* ── HEADER ── */}
      <header style={{
        background:`${C.deep}F6`,
        backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",
        borderBottom:`1px solid ${C.ruleD}`,
        height:52,
        display:"flex",alignItems:"center",
        padding:"0 24px",
        position:"sticky",top:0,zIndex:50,
      }}>
        {/* ロゴ */}
        <div style={{display:"flex",alignItems:"center",gap:11,marginRight:"auto"}}>
          <span style={{fontSize:19}}>🥦</span>
          <div>
            <div className="f-serif" style={{fontSize:13,fontWeight:700,color:C.washi,letterSpacing:".06em",lineHeight:1.2}}>
              吉野川 ブロッコリー農家 記録
            </div>
            <div className="f-sans" style={{fontSize:7,color:`${C.washi}35`,letterSpacing:".18em",textTransform:"uppercase"}}>
              Yoshinogawa · be-looking
            </div>
          </div>
        </div>

        {/* ログイン中 */}
        {me&&(
          <div style={{
            display:"flex",alignItems:"center",gap:8,
            padding:"5px 12px",background:`${C.washi}0C`,
            borderRadius:20,marginRight:16,border:`1px solid ${C.washi}14`,
          }}>
            <span style={{fontSize:11}}>🌾</span>
            <span className="f-sans" style={{fontSize:11,fontWeight:500,color:C.washi}}>{me.name}</span>
            <button onClick={()=>{setMe(null);setTab("board");}} className="f-sans" style={{
              fontSize:9,color:`${C.washi}50`,background:`${C.washi}10`,
              border:`1px solid ${C.washi}18`,borderRadius:10,padding:"2px 8px",
            }}>ログアウト</button>
          </div>
        )}

        {/* ナビ */}
        <nav style={{display:"flex"}}>
          {TABS.map(({k,l,badge,locked})=>(
            <button key={k} onClick={()=>setTab(k)}
              className={`nav-item ${tab===k?"active":""}`}
              style={{
                padding:"0 18px",height:52,border:"none",borderRadius:0,
                background:"transparent",
                color:tab===k?C.washi:locked?`${C.washi}25`:`${C.washi}55`,
                fontSize:11,fontWeight:tab===k?600:400,
                letterSpacing:".06em",position:"relative",
              }}>
              {l}
              {badge>0&&<span style={{
                position:"absolute",top:10,right:6,
                width:14,height:14,borderRadius:"50%",
                background:C.shu,color:"#fff",fontSize:8,fontWeight:700,
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>{badge}</span>}
            </button>
          ))}
        </nav>
      </header>

      {/* ── MAIN ── */}
      <main style={{maxWidth:920,margin:"0 auto",padding:"32px 24px 72px"}}>
        {tab==="board"&&<BoardTab farmers={farmers} destApproved={destOk} records={recs}/>}
        {tab==="input"&&(me
          ? <InputTab loggedInFarmer={me} destApproved={destOk} destPending={destPend}
              records={recs} onAddRecord={addRec} onSubmitDest={subDest}/>
          : authV==="register"
            ? <RegisterScreen onGoLogin={()=>setAuthV("login")} onSubmit={subReg}/>
            : <LoginScreen farmers={farmers} onLogin={f=>{setMe(f);setAuthV("login");}} onGoRegister={()=>setAuthV("register")}/>
        )}
        {tab==="admin"&&<AdminTab
          destPending={destPend} destApproved={destOk}
          farmers={farmers} farmersPending={farmPend}
          onApprove={appDest} onReject={rejDest}
          onApproveFarmer={appFarmer} onRejectFarmer={rejFarmer}/>}
      </main>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop:`1px solid ${C.rule}`,
        padding:"14px 28px",
        display:"flex",justifyContent:"space-between",alignItems:"center",
        background:C.pale,
      }}>
        <span className="f-sans" style={{fontSize:9,color:C.ghost,letterSpacing:".06em"}}>
          © {THIS_YEAR} be-looking · 吉野川ブロッコリー農家 記録プロジェクト
        </span>
        <span className="f-sans" style={{fontSize:9,color:C.ghost}}>
          ⚠ 本データは農家本人の入力による参考値です
        </span>
      </footer>
    </div>
  );
}
