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

const THIS_YEAR   = new Date().getFullYear();
const ADMIN_EMAIL = "t5fki6643qty@gmail.com";

// ── エラー監視ユーティリティ ──────────────────────────────────
function getSessionId() {
  try {
    let sid = localStorage.getItem("cb_session_id");
    if (!sid) { sid = crypto.randomUUID(); localStorage.setItem("cb_session_id", sid); }
    return sid;
  } catch { return "no-storage-" + Math.random().toString(36).slice(2); }
}

function sanitizeMessage(msg = "") {
  return String(msg).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, "[phone]").slice(0, 1000);
}

async function logAppError({ level = "error", source = "client", page = "", component = "", action = "", operation = "", error, metadata = {}, userId = null }) {
  try {
    await supabase.from("app_errors").insert({
      session_id: getSessionId(), user_id: userId, level, source, page, component, action, operation,
      error_code: error?.code || error?.status || null,
      message: sanitizeMessage(error?.message || String(error || "")),
      stack: sanitizeMessage(error?.stack || ""),
      url: window.location.href, user_agent: navigator.userAgent, metadata,
    });
  } catch (e) { console.warn("error logging failed", e); }
}

function diagnoseError(e) {
  const msg = (e.message || "").toLowerCase();
  if (msg.includes("row-level security")) return { title: "RLSポリシーで拒否", fix: "対象テーブルのRLS policyを確認", severity: "high" };
  if (msg.includes("unique") || msg.includes("duplicate key")) return { title: "重複データ", fix: "既存データを確認し重複を整理", severity: "medium" };
  if (msg.includes("failed to fetch") || msg.includes("network")) return { title: "通信エラー", fix: "ネットワーク接続を確認", severity: "medium" };
  if (msg.includes("cannot read properties of null")) return { title: "未選択データ参照", fix: "保存前にnullチェックを追加", severity: "high" };
  if (msg.includes("auth_id") || msg.includes("null")) return { title: "Auth紐づけ失敗", fix: "farmersのauth_idを確認", severity: "high" };
  return { title: "未分類エラー", fix: "message・component・operationを確認", severity: "unknown" };
}
const MONTHS    = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const PREFECTURES = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

async function sGet(k){try{const r=await window.storage.get(k,true);return r?JSON.parse(r.value):null;}catch{return null;}}
async function sSet(k,v){try{await window.storage.set(k,JSON.stringify(v),true);}catch{}};

const cn  = n => Math.round(n).toLocaleString("ja-JP");
const man = n => { const a=Math.abs(n); return a>=10000?(Math.round(a/1000)/10).toFixed(1)+"万":cn(a); };
function uid(){ return Math.random().toString(36).slice(2,9); }
function destColor(name){ if(!name)return"#888"; let h=0; for(const c of name) h=(h*37+c.charCodeAt(0))>>>0; return DEST_INK[h%DEST_INK.length]; }

function toKatakana(str) {
  return str.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}
function toHiragana(str) {
  return str.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
function fuzzyMatch(query, target) {
  if (!query || !target) return false;
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (t.includes(q)) return true;
  if (t.includes(toKatakana(q))) return true;
  if (t.includes(toHiragana(q))) return true;
  if (toKatakana(t).includes(toKatakana(q))) return true;
  if (toHiragana(t).includes(toHiragana(q))) return true;
  return false;
}

// ── 作物名正規化 ──────────────────────────────────────────────
function normalizeCropKey(name = "") {
  return toKatakana(String(name).trim().normalize("NFKC"))
    .replace(/\s+/g, "").replace(/[・･]/g, "").toLowerCase();
}
const CROP_CANONICAL_MAP = {
  "ブロッコリー":"ブロッコリー","ブロッコリ":"ブロッコリー","ぶろっこりー":"ブロッコリー",
  "ぶろっこり":"ブロッコリー","ﾌﾞﾛｯｺﾘｰ":"ブロッコリー","broccoli":"ブロッコリー",
  "ナス":"なす","なす":"なす","茄子":"なす",
  "スイートコーン":"スイートコーン","すいーとこーん":"スイートコーン",
  "トウモロコシ":"スイートコーン","とうもろこし":"スイートコーン","とうきび":"スイートコーン",
  "ネギ":"ねぎ","ねぎ":"ねぎ","葱":"ねぎ",
};
function canonicalCropName(name = "") {
  const raw = String(name).trim();
  if (!raw) return "";
  const key = normalizeCropKey(raw);
  const found = Object.entries(CROP_CANONICAL_MAP).find(([k]) => normalizeCropKey(k) === key);
  return found ? found[1] : raw.normalize("NFKC");
}
function uniqueCropsByCanonical(crops = []) {
  const map = new Map();
  crops.filter(Boolean).forEach(c => {
    const canonical = canonicalCropName(c);
    const key = normalizeCropKey(canonical);
    if (!map.has(key)) map.set(key, canonical);
  });
  return [...map.values()];
}

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
  #data-definition-print, #data-definition-print * { visibility: visible !important; }
  #data-definition-print { position: absolute; left: 0; top: 0; width: 100%; }
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
  .bottom-tab-bar button:hover { color: #008F5B; }
  .bottom-tab-bar button.active { color: #00A86B; font-weight: 600; }
  .bottom-tab-bar button span.icon { font-size: 20px; line-height: 1; }
  /* Hide desktop header nav on mobile */
  .header-nav { display: none !important; }
  header { padding: 0 16px !important; height: 52px !important; }
  main { padding: 16px 12px 90px !important; }
  .ledger-card { padding: 16px !important; }
}

/* ── Fixed footer ── */
.site-footer-fixed {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 80;
  background: rgba(255,255,255,0.96);
  backdrop-filter: blur(10px);
  border-top: 1px solid #EBEBEB;
  padding: 10px 24px;
  text-align: center;
}
.site-footer-fixed .footer-inner {
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.site-footer-fixed .footer-copy {
  font-size: 11px;
  color: #B0B0B0;
}
.site-footer-fixed .footer-links {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.site-footer-fixed .footer-note {
  width: 100%;
  font-size: 10px;
  color: #B0B0B0;
  line-height: 1.6;
}
@media (min-width: 641px) {
  main {
    padding-bottom: 96px !important;
  }
}
@media (max-width: 640px) {
  .site-footer-fixed {
    bottom: 62px;
    padding: 8px 12px;
  }
  .site-footer-fixed .footer-inner {
    justify-content: center;
    gap: 8px 14px;
  }
  .site-footer-fixed .footer-copy {
    font-size: 10px;
  }
  .site-footer-fixed .footer-links {
    gap: 12px;
  }
  .site-footer-fixed .footer-note {
    font-size: 9px;
  }
  main {
    padding-bottom: 150px !important;
  }
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
.btn-primary:hover, .btn-dark:hover { background: #008F5B; }
.btn-primary:active, .btn-dark:active { background: #007A4D; }
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
    setSending(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setSending(false);
    if (error) { setErr("メール送信に失敗しました。しばらく経ってから再度お試しください"); return; }
    setPending({ email: email.trim().toLowerCase() });
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
    const normalizedEmail = email.trim().toLowerCase();
    const { data: farmer, error: farmerErr } = await supabase
      .from("farmers")
      .upsert({
        email: normalizedEmail,
        auth_id: data.user.id,
        name: normalizedEmail.split("@")[0],
        status: "approved",
      }, { onConflict: "email" })
      .select()
      .single();
    if (farmerErr) {
      console.error("farmer auth_id link error:", farmerErr);
      setErr(`農家情報の紐づけに失敗しました：${farmerErr.message}`);
      bounce();
      return;
    }
    onLogin({
      ...farmer,
      id: farmer.auth_id || data.user.id,
      joinedYear: farmer.joined_year,
      planned_crops: farmer.planned_crops || [],
      sales_channels: farmer.sales_channels || [],
    });
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
          <div className="f-sans" style={{ fontSize:14,fontWeight:700,color:C.ink,marginBottom:24,letterSpacing:".04em" }}>ログイン / 新規登録</div>

          {!pending ? (
            /* ── STEP 1: メールアドレス入力 ── */
            <div className="fade-in">
              <div style={{ marginBottom:20 }}>
                <label className="lbl f-sans">メールアドレス</label>
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

          <div style={{ textAlign:"center", marginTop:22 }}>
            <p className="f-sans" style={{ fontSize:11, color:C.dim, lineHeight:1.8 }}>
              初めての方もこのフォームから登録できます。<br/>
              メールアドレスを入力して認証コードを送信してください。
            </p>
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
function BoardTab({ farmers, destApproved, records, userLevel = 2, onLogin, me, onGoPlan, onShowConstitution, onShowTerms, onShowPrivacy }) {
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
  const [selectedStatCrop, setSelectedStatCrop] = useState(null);
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
  const filteredCropCards = sq ? cropCards.filter(c => fuzzyMatch(sq, c.crop)) : cropCards;
  const filteredDestCards = sq ? destCards.filter(d => fuzzyMatch(sq, d.name)) : destCards;

  const isFiltered = selectedCrop !== 'すべて';
  const hasNoData = filteredCropCards.length === 0 && filteredDestCards.length === 0;

  const lastUpdated = new Date().toLocaleDateString("ja-JP", { year:"numeric", month:"2-digit", day:"2-digit" });
  const regions = [...new Set(farmers.map(f => f.municipality).filter(Boolean))];
  const regionText = regions.length > 0 ? "（" + regions.slice(0,3).join("・") + "）" : "";
  const MIN_FARMERS = 5;

  return (
    <div className="appear">

      {!me && (<>

      {/* ══ ドキュメントリンクピル ══════════════════════ */}
      <div style={{
        display:"flex", gap:10, overflowX:"auto", paddingBottom:8,
        marginBottom:24, WebkitOverflowScrolling:"touch",
      }}>
        {[
          { label:"利用規約", action:() => onShowTerms && onShowTerms() },
          { label:"データ憲法", action:() => onShowConstitution && onShowConstitution() },
          { label:"プライバシーポリシー", action:() => onShowPrivacy && onShowPrivacy() },
        ].map(item => (
          <button key={item.label} onClick={item.action} className="f-sans" style={{
            flexShrink:0, padding:"10px 18px", background:"#fff",
            border:"1px solid #EBEBEB", borderRadius:20, fontSize:12,
            color:"#222", fontWeight:500, whiteSpace:"nowrap", cursor:"pointer",
            transition:"all .15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background="#F7F7F7"; }}
          onMouseLeave={e => { e.currentTarget.style.background="#fff"; }}
          >{item.label}</button>
        ))}
      </div>

      </>)}


      {/* ══ 今月のサマリー ══════════════════════════════ */}
      {userLevel >= 2 && me && (() => {
        const now = new Date();
        const thisMonth = now.getMonth();
        const myRecordKeys = Object.keys(records).filter(k => k.startsWith(me.id + "_"));
        const myYears = myRecordKeys.map(k => parseInt(k.split("_")[1])).filter(y => !isNaN(y));
        const thisYear = myYears.length > 0 ? Math.max(...myYears) : THIS_YEAR;
        const prevMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const prevYear = thisMonth === 0 ? thisYear - 1 : thisYear;

        const myRecsThisMonth = records[me.id + "_" + thisYear + "_" + thisMonth] || [];
        const myRecsPrevMonth = records[me.id + "_" + prevYear + "_" + prevMonth] || [];

        const calcTotals = (recs) => {
          const rev = recs.reduce((s, r) => s + (r.boxes || 0) * (r.ppb || 0), 0);
          const cost = recs.reduce((s, r) => s + (r.costs || []).reduce((a, c) => a + (c.a || 0), 0), 0);
          return { rev, cost, profit: rev - cost };
        };

        const thisM = calcTotals(myRecsThisMonth);
        const prevM = calcTotals(myRecsPrevMonth);

        const costRate = thisM.rev > 0 ? Math.round(thisM.cost / thisM.rev * 100) : 0;
        const pctChange = (cur, prev) => {
          if (prev === 0) return null;
          return Math.round((cur - prev) / prev * 100);
        };

        const revChange = pctChange(thisM.rev, prevM.rev);
        const costChange = pctChange(thisM.cost, prevM.cost);
        const profitChange = pctChange(thisM.profit, prevM.profit);

        const fmtYen = v => {
          if (Math.abs(v) >= 10000) return "¥" + (Math.round(v / 1000) / 10).toFixed(1) + "万";
          return "¥" + Math.round(v).toLocaleString("ja-JP");
        };

        const ChangeBadge = ({ val }) => {
          if (val === null) return null;
          const isUp = val >= 0;
          return (
            <span className="f-sans" style={{
              fontSize: 10, fontWeight: 600,
              color: isUp ? "#00A86B" : "#E24B4A",
            }}>
              前月比 {isUp ? "+" : ""}{val}%
            </span>
          );
        };

        const monthlyData = Array.from({ length: 12 }, (_, i) => {
          const recs = records[me.id + "_" + thisYear + "_" + i] || [];
          const t = calcTotals(recs);
          return { month: i, rev: t.rev, cost: t.cost, profit: t.profit };
        });

        const hasAnyData = monthlyData.some(d => d.rev > 0 || d.cost > 0);

        const maxVal = Math.max(...monthlyData.map(d => Math.max(d.rev, d.cost)), 1);
        const chartW = 300, chartH = 80, padL = 4, padR = 4, padT = 8, padB = 20;
        const cW = chartW - padL - padR, cH = chartH - padT - padB;
        const toX = i => padL + (i / 11) * cW;
        const toY = v => padT + cH - (v / maxVal) * cH;
        const pts = arr => arr.map((d, i) => toX(i) + "," + toY(d)).join(" ");

        if (!hasAnyData && myRecsThisMonth.length === 0) {
          return (
            <div style={{
              marginBottom: 24, padding: "24px",
              background: "#F7F7F7", border: "1px solid #EBEBEB",
              borderRadius: 16, textAlign: "center",
            }}>
              <p className="f-sans" style={{ fontSize: 14, fontWeight: 600, color: "#222", marginBottom: 8 }}>
                まず先月の1件を記録しましょう
              </p>
              <p className="f-sans" style={{ fontSize: 12, color: "#717171", marginBottom: 16 }}>
                売上・経費・手残り・経費率がここに表示されます
              </p>
              <button onClick={() => { if (onLogin) onLogin(); }} className="btn-primary" style={{ padding: "12px 28px", fontSize: 13 }}>
                記録を入力する →
              </button>
            </div>
          );
        }

        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
              <h2 className="f-sans" style={{ fontSize: 15, fontWeight: 700, color: "#222", margin: 0 }}>
                今月のサマリー
                <span className="f-sans" style={{ fontSize: 10, color: "#717171", fontWeight: 400, marginLeft: 8 }}>
                  {thisMonth + 1}月
                </span>
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
              {[
                { label: "売上", val: thisM.rev, color: "#00A86B", bg: "#E6F7EF", change: revChange },
                { label: "経費", val: thisM.cost, color: "#F5A623", bg: "#FEF3E2", change: costChange },
                { label: "手残り", val: thisM.profit, color: thisM.profit >= 0 ? "#00A86B" : "#E24B4A", bg: thisM.profit >= 0 ? "#E6F7EF" : "#FCEBEB", change: profitChange },
              ].map(card => (
                <div key={card.label} style={{
                  padding: "16px 14px", background: card.bg,
                  borderRadius: 12, textAlign: "center",
                }}>
                  <p className="f-sans" style={{ fontSize: 10, color: card.color, fontWeight: 600, marginBottom: 6 }}>{card.label}</p>
                  <p className="f-mono" style={{ fontSize: 18, fontWeight: 700, color: card.color, margin: "0 0 4px" }}>
                    {fmtYen(card.val)}
                  </p>
                  <ChangeBadge val={card.change} />
                </div>
              ))}
            </div>

            {thisM.rev > 0 && (
              <div style={{
                padding: "12px 16px", background: "#fff",
                border: "1px solid #EBEBEB", borderRadius: 12, marginBottom: 14,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span className="f-sans" style={{ fontSize: 12, fontWeight: 600, color: "#222" }}>経費率</span>
                  <span className="f-mono" style={{ fontSize: 16, fontWeight: 700, color: costRate > 60 ? "#E24B4A" : costRate > 40 ? "#F5A623" : "#00A86B" }}>
                    {costRate}%
                  </span>
                </div>
                <div style={{ height: 8, background: "#F7F7F7", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: 8, borderRadius: 4,
                    width: Math.min(costRate, 100) + "%",
                    background: costRate > 60 ? "#E24B4A" : costRate > 40 ? "#F5A623" : "#00A86B",
                    transition: "width 0.6s ease",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span className="f-sans" style={{ fontSize: 9, color: "#B0B0B0" }}>0%</span>
                  <span className="f-sans" style={{ fontSize: 9, color: "#B0B0B0" }}>目安：60%以下</span>
                  <span className="f-sans" style={{ fontSize: 9, color: "#B0B0B0" }}>100%</span>
                </div>
              </div>
            )}

            {hasAnyData && (
              <div style={{
                padding: "16px", background: "#fff",
                border: "1px solid #EBEBEB", borderRadius: 12,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span className="f-sans" style={{ fontSize: 12, fontWeight: 600, color: "#222" }}>年間推移</span>
                  <div className="f-sans" style={{ display: "flex", gap: 12, fontSize: 9 }}>
                    <span style={{ color: "#00A86B" }}>● 売上</span>
                    <span style={{ color: "#F5A623" }}>● 経費</span>
                  </div>
                </div>
                <svg viewBox={"0 0 " + chartW + " " + chartH} style={{ width: "100%", height: "auto", display: "block" }}>
                  {monthlyData.map((d, i) => (
                    i % 2 === 0 && <text key={i} x={toX(i)} y={chartH - 4} textAnchor="middle" fontSize="8" fill="#B0B0B0">{i + 1}月</text>
                  ))}
                  <polyline points={pts(monthlyData.map(d => d.rev))} fill="none" stroke="#00A86B" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  <polyline points={pts(monthlyData.map(d => d.cost))} fill="none" stroke="#F5A623" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {monthlyData.map((d, i) => d.rev > 0 && <circle key={"r" + i} cx={toX(i)} cy={toY(d.rev)} r="3" fill="#00A86B" />)}
                  {monthlyData.map((d, i) => d.cost > 0 && <circle key={"c" + i} cx={toX(i)} cy={toY(d.cost)} r="3" fill="#F5A623" />)}
                </svg>
              </div>
            )}
          </div>
        );
      })()}

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
                  <div key={s.crop} className="ledger-card" onClick={() => setSelectedStatCrop(s.crop)} style={{ padding:"20px 22px", cursor:"pointer" }}>
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
          const isMatch = crop !== 'すべて' && sq && fuzzyMatch(sq, crop);
          return (
            <button key={crop} onClick={() => handleSetCrop(crop)} style={{
              flexShrink:0, padding:"8px 20px", borderRadius:20, fontSize:13,
              fontWeight: active ? 700 : isMatch ? 600 : 400,
              background: active ? C.accent : isMatch ? "#E6F7EF" : "#fff",
              color: active ? "#fff" : isMatch ? C.accent : C.ink,
              border: active ? `1px solid ${C.accent}` : isMatch ? `1px solid ${C.accent}44` : `1px solid ${C.border}`,
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
            実証に参加すると産地の実績データが見れます
          </p>
          <button onClick={onLogin} style={{
            padding:"10px 28px", borderRadius:20, background:C.accent,
            color:"#fff", border:"none", fontSize:13, fontWeight:600, cursor:"pointer",
          }}>実証に参加する</button>
        </div>
      )}


      {/* ══ 注記 ════════════════════════════════════════ */}
      <div style={{ marginTop:8, padding:"12px 18px", borderTop:`1px solid ${C.rule}` }}>
        <p className="f-sans" style={{ fontSize:10, color:C.ghost, lineHeight:1.9 }}>
          このデータは参加農家の入力に基づく集計値です。個人の情報は公開されません。
        </p>
      </div>

      {/* ══ 公的統計モーダル ══════════════════════════════ */}
      {selectedStatCrop && (() => {
        const cropStats = enrichedStats.filter(s => s.crop === selectedStatCrop).sort((a,b) => a.year - b.year);
        if (cropStats.length === 0) return null;

        const latest = cropStats[cropStats.length - 1];
        const years = cropStats.map(s => s.year);
        const hasMultiYear = cropStats.length > 1;

        const metrics = [
          { key:"acreage_ha",          label:"作付面積",   unit:"ha",       color:"#00A86B" },
          { key:"harvest_t",           label:"収穫量",     unit:"t",        color:"#4A90D9" },
          { key:"yield_kg_per_10a",    label:"10a収量",    unit:"kg",       color:"#F5A623" },
          { key:"labor_hours_per_10a", label:"労働時間",   unit:"時間/10a", color:"#E85D5D" },
        ].filter(m => cropStats.some(s => s[m.key] != null));

        const fmtVal = (v, unit) => {
          if (v == null) return "—";
          if (unit === "ha" || unit === "t") {
            if (v >= 10000) return (v / 10000).toFixed(1) + "万";
          }
          return Math.round(v).toLocaleString("ja-JP");
        };

        const MiniChart = ({ data, color }) => {
          if (data.length < 2) return null;
          const vals = data.map(d => d.val).filter(v => v != null);
          if (vals.length < 2) return null;
          const min = Math.min(...vals), max = Math.max(...vals);
          const range = max - min || 1;
          const w = 200, h = 60, pad = 4;
          const pts = data
            .filter(d => d.val != null)
            .map((d, i, arr) => {
              const x = pad + (i / (arr.length - 1)) * (w - pad * 2);
              const y = pad + (1 - (d.val - min) / range) * (h - pad * 2);
              return x + "," + y;
            }).join(" ");
          return (
            <svg viewBox={"0 0 " + w + " " + h} style={{ width:"100%", height:60, display:"block" }}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
              {data.filter(d => d.val != null).map((d, i, arr) => {
                const x = pad + (i / (arr.length - 1)) * (w - pad * 2);
                const y = pad + (1 - (d.val - min) / range) * (h - pad * 2);
                return <circle key={i} cx={x} cy={y} r="3" fill={color} stroke="#fff" strokeWidth="1.5"/>;
              })}
            </svg>
          );
        };

        return (
          <div
            onClick={() => setSelectedStatCrop(null)}
            style={{
              position:"fixed", inset:0, zIndex:9000,
              background:"rgba(0,0,0,0.5)",
              display:"flex", alignItems:"center", justifyContent:"center",
              padding:16, animation:"fadeIn .2s ease",
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="appear"
              style={{
                background:"#fff", borderRadius:20,
                maxWidth:520, width:"100%",
                maxHeight:"85vh", overflowY:"auto",
                boxShadow:"0 12px 48px rgba(0,0,0,0.15)",
              }}
            >
              <div style={{
                padding:"24px 28px 16px",
                borderBottom:"1px solid #EBEBEB",
                position:"relative",
              }}>
                <button
                  onClick={() => setSelectedStatCrop(null)}
                  style={{
                    position:"absolute", top:16, right:16,
                    width:32, height:32, borderRadius:"50%",
                    background:"#F7F7F7", border:"none",
                    fontSize:16, cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}
                >✕</button>
                <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:"0 0 4px" }}>
                  {selectedStatCrop}
                </h2>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>
                  {years[0]}〜{years[years.length - 1]}年 · 出典：農水省 作物統計調査
                </p>
              </div>

              <div style={{ padding:"20px 28px 28px" }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10, marginBottom:24 }}>
                  {metrics.map(m => (
                    <div key={m.key} style={{
                      padding:"14px 16px", background:"#F7F7F7",
                      borderRadius:12, borderLeft:"3px solid " + m.color,
                    }}>
                      <p className="f-sans" style={{ fontSize:10, color:"#717171", marginBottom:4 }}>{m.label}</p>
                      <p className="f-mono" style={{ fontSize:18, fontWeight:700, color:"#222", margin:0 }}>
                        {fmtVal(latest[m.key], m.unit)}
                      </p>
                      <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:0 }}>{m.unit}</p>
                    </div>
                  ))}
                </div>

                {hasMultiYear && (
                  <div style={{ display:"grid", gap:20 }}>
                    {metrics.map(m => {
                      const data = cropStats.map(s => ({ year: s.year, val: s[m.key] }));
                      if (data.every(d => d.val == null)) return null;
                      return (
                        <div key={m.key}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                            <p className="f-sans" style={{ fontSize:12, fontWeight:600, color:m.color, margin:0 }}>{m.label}</p>
                            <div className="f-sans" style={{ display:"flex", gap:8, fontSize:9, color:"#B0B0B0" }}>
                              {data.filter(d => d.val != null).map(d => (
                                <span key={d.year}>{d.year}</span>
                              ))}
                            </div>
                          </div>
                          <MiniChart data={data} color={m.color} />
                          <div className="f-mono" style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#717171", marginTop:4 }}>
                            {data.filter(d => d.val != null).map(d => (
                              <span key={d.year}>{fmtVal(d.val, m.unit)}</span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!hasMultiYear && (
                  <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", padding:"20px 0" }}>
                    複数年のデータが蓄積されるとグラフが表示されます
                  </p>
                )}

                <div style={{
                  marginTop:24, paddingTop:20,
                  borderTop:"1px solid #EBEBEB",
                  display:"grid", gap:10,
                }}>
                  {userLevel === 1 ? (
                    <button onClick={() => { setSelectedStatCrop(null); onLogin(); }} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14 }}>
                      無料で登録して詳しいデータを見る →
                    </button>
                  ) : (
                    <button onClick={() => { setSelectedStatCrop(null); if(onGoPlan) onGoPlan(); }} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14 }}>
                      この作物で五年計画書を作る →
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

// ── InputTab ─────────────────────────────────────────────────
const COST_TEMPLATES = [
  { label: "手数料",  mode: "pct"     },
  { label: "運賃",   mode: "per_box" },
  { label: "箱代",   mode: "per_box" },
  { label: "選果料", mode: "per_box" },
  { label: "肥料費", mode: "fixed"   },
  { label: "農薬費", mode: "fixed"   },
  { label: "種苗費", mode: "fixed"   },
];

function InputTab({ loggedInFarmer, destApproved, destPending, records, onAddRecord, onSubmitDest, onGoBoard, onDeleteRec }) {
  const [step,setStep]=useState(1);
  const [crop,setCrop]=useState("");
  const [cropInput,setCropInput]=useState("");
  const [variety,setVariety]=useState("");
  const [isBrand,setIsBrand]=useState(false);
  const [selectedYear, setSelectedYear] = useState(THIS_YEAR);
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
    if(!dest?.id){alert("出荷先を選択してください");return;}
    if(!boxes||!ppb)return;
    const ci=costs.filter(c=>c.l&&c.v).map(c=>{
      const v=parseFloat(c.v)||0;
      let a=0;
      if(c.mode==="pct") a=Math.round(rev*v/100);
      else if(c.mode==="per_box") a=Math.round(parseFloat(boxes)*v);
      else a=Math.round(v);
      return {l:c.l,v,mode:c.mode,a};
    });
    await onAddRecord(loggedInFarmer.id,selectedYear,mon,{destId:dest.id,boxes:parseFloat(boxes),ppb:parseFloat(ppb),costs:ci,crop:canonicalCropName(crop),variety:variety.trim(),is_brand:isBrand});
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
                  <button key={c} onClick={()=>{ const cc=canonicalCropName(c); setCrop(cc);setCropInput(cc);setVariety("");}} style={{
                    padding:"6px 12px",border:`1.5px solid ${crop===c?C.gold:C.rule}`,borderRadius:20,
                    background:crop===c?`${C.gold}12`:"#fff",
                    color:crop===c?C.gold:C.mid,fontSize:12,fontWeight:crop===c?700:400,
                  }}>{c}</button>
                ))}
              </div>
            )}
            <input className="field f-sans" placeholder="作物名を入力（例：トマト）" value={cropInput}
              onChange={e=>{setCropInput(e.target.value);setCrop(canonicalCropName(e.target.value));setVariety("");}}
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
            <div style={{ display:"flex", gap:8, marginBottom:16, alignItems:"center" }}>
              <label className="lbl f-sans" style={{ marginBottom:0 }}>年</label>
              <select
                className="field f-sans"
                value={selectedYear}
                onChange={e => setSelectedYear(Number(e.target.value))}
                style={{ width:"auto", padding:"10px 14px", fontSize:14 }}
              >
                {Array.from({ length: THIS_YEAR - 2019 }, (_, i) => THIS_YEAR - i).map(y => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:22}}>
              {MONTHS.map((m,i)=>{
                const has=(records[`${loggedInFarmer.id}_${selectedYear}_${i}`]||[]).length>0;
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
              {destApproved.filter(d=>!destSearch||fuzzyMatch(destSearch, d.name)).map(d=>{
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
                <div style={{marginBottom:10}}>
                  <p className="f-sans" style={{fontSize:11,color:"#888",marginBottom:6}}>よくある経費を追加</p>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {COST_TEMPLATES.map(tmpl=>{
                      const already=costs.some(c=>c.l===tmpl.label);
                      return(
                        <button key={tmpl.label} onClick={()=>{
                          if(already)return;
                          setCosts(prev=>[...prev,{l:tmpl.label,v:"",mode:tmpl.mode}]);
                        }} style={{
                          fontSize:12,borderRadius:999,
                          border:`1px solid ${already?"#D0D0D0":"#EBEBEB"}`,
                          background:already?"#F0F0F0":"#fff",
                          padding:"8px 12px",color:already?"#B0B0B0":"#222",
                          cursor:already?"default":"pointer",fontFamily:"inherit",
                        }}>{tmpl.label}</button>
                      );
                    })}
                  </div>
                </div>
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
                  {costs.length<10&&<button onClick={()=>setCosts([...costs,{l:"",v:"",mode:"fixed"}])} style={{padding:"8px",border:`1px dashed ${C.rule}`,borderRadius:8,background:"transparent",color:C.mid,fontSize:11,fontFamily:"inherit"}}>＋ 経費追加</button>}
                </div>
              </div>
            </div>
            {(() => {
              const existingRecs = (records[loggedInFarmer.id + "_" + selectedYear + "_" + mon] || [])
                .filter(r => r.destId === dest?.id);
              if (existingRecs.length === 0) return null;
              const totalRev = existingRecs.reduce((s, r) => s + (r.boxes || 0) * (r.ppb || 0), 0);
              return (
                <div style={{ marginBottom: 18, padding: "16px", background: "#F7F7F7", borderRadius: 12, border: "1px solid #EBEBEB" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span className="f-sans" style={{ fontSize: 12, fontWeight: 700, color: "#222" }}>
                      この月の入力済みデータ（{existingRecs.length}件）
                    </span>
                    <span className="f-mono" style={{ fontSize: 12, fontWeight: 600, color: "#00A86B" }}>
                      合計 {totalRev >= 10000 ? (Math.round(totalRev / 1000) / 10).toFixed(1) + "万" : totalRev.toLocaleString("ja-JP")}円
                    </span>
                  </div>
                  {existingRecs.map((r, i) => {
                    const rRev = (r.boxes || 0) * (r.ppb || 0);
                    const rCost = (r.costs || []).reduce((a, c) => a + (c.a || 0), 0);
                    return (
                      <div key={r.id || i} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", background: "#fff", borderRadius: 8,
                        marginBottom: 6, border: "1px solid #EBEBEB",
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="f-sans" style={{ fontSize: 12, color: "#222" }}>
                            {r.boxes}箱 × {r.ppb}円 = <span className="f-mono" style={{ fontWeight: 600, color: "#00A86B" }}>{rRev >= 10000 ? (Math.round(rRev / 1000) / 10).toFixed(1) + "万" : rRev.toLocaleString("ja-JP")}円</span>
                          </div>
                          {rCost > 0 && (
                            <div className="f-sans" style={{ fontSize: 10, color: "#F5A623", marginTop: 2 }}>
                              経費 {rCost.toLocaleString("ja-JP")}円
                            </div>
                          )}
                        </div>
                        <button onClick={() => {
                          if (window.confirm("この記録を削除しますか？")) {
                            onDeleteRec(loggedInFarmer.id, selectedYear, mon, r.id);
                          }
                        }} style={{
                          padding: "4px 10px", border: "1px solid #E24B4A44",
                          borderRadius: 8, background: "transparent",
                          color: "#E24B4A", fontSize: 10, fontWeight: 600,
                          cursor: "pointer", flexShrink: 0,
                        }}>削除</button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{display:"flex",gap:8}}>
              <button className="btn-outline" onClick={()=>setStep(3)}>← 戻る</button>
              <button className="btn-primary" style={{flex:1,background:saved?C.bamboo:undefined}} disabled={!boxes||!ppb} onClick={save}>
                {saved?"✓ 保存しました":"保存する"}
              </button>
            </div>
            {saved&&<div style={{marginTop:12,textAlign:"center",display:"grid",gap:8}}>
              {saved && (() => {
                const savedRev = (parseFloat(boxes) || 0) * (parseFloat(ppb) || 0);
                const savedCost = costs.filter(c => c.l && c.v).reduce((s, c) => {
                  const v = parseFloat(c.v) || 0;
                  if (c.mode === "pct") return s + Math.round(savedRev * v / 100);
                  if (c.mode === "per_box") return s + Math.round(parseFloat(boxes) * v);
                  return s + Math.round(v);
                }, 0);
                const savedProfit = savedRev - savedCost;
                const savedRate = savedRev > 0 ? Math.round(savedCost / savedRev * 100) : 0;

                const fmtYen = v => {
                  if (Math.abs(v) >= 10000) return (Math.round(v / 1000) / 10).toFixed(1) + "万";
                  return Math.round(v).toLocaleString("ja-JP");
                };

                return (
                  <div style={{
                    marginTop: 16, marginBottom: 16,
                    padding: "20px", background: "#F7F7F7",
                    borderRadius: 12, border: "1px solid #EBEBEB",
                  }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                      <div style={{ textAlign: "center", padding: "12px 8px", background: "#E6F7EF", borderRadius: 8 }}>
                        <p className="f-sans" style={{ fontSize: 9, color: "#00A86B", fontWeight: 600, marginBottom: 4 }}>売上</p>
                        <p className="f-mono" style={{ fontSize: 16, fontWeight: 700, color: "#00A86B", margin: 0 }}>{fmtYen(savedRev)}</p>
                      </div>
                      <div style={{ textAlign: "center", padding: "12px 8px", background: "#FEF3E2", borderRadius: 8 }}>
                        <p className="f-sans" style={{ fontSize: 9, color: "#F5A623", fontWeight: 600, marginBottom: 4 }}>経費</p>
                        <p className="f-mono" style={{ fontSize: 16, fontWeight: 700, color: "#F5A623", margin: 0 }}>{fmtYen(savedCost)}</p>
                      </div>
                      <div style={{ textAlign: "center", padding: "12px 8px", background: savedProfit >= 0 ? "#E6F7EF" : "#FCEBEB", borderRadius: 8 }}>
                        <p className="f-sans" style={{ fontSize: 9, color: savedProfit >= 0 ? "#00A86B" : "#E24B4A", fontWeight: 600, marginBottom: 4 }}>手残り</p>
                        <p className="f-mono" style={{ fontSize: 16, fontWeight: 700, color: savedProfit >= 0 ? "#00A86B" : "#E24B4A", margin: 0 }}>{fmtYen(savedProfit)}</p>
                      </div>
                    </div>
                    {savedRev > 0 && (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span className="f-sans" style={{ fontSize: 11, fontWeight: 600, color: "#222" }}>経費率</span>
                          <span className="f-mono" style={{ fontSize: 14, fontWeight: 700, color: savedRate > 60 ? "#E24B4A" : savedRate > 40 ? "#F5A623" : "#00A86B" }}>{savedRate}%</span>
                        </div>
                        <div style={{ height: 6, background: "#EBEBEB", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            height: 6, borderRadius: 3,
                            width: Math.min(savedRate, 100) + "%",
                            background: savedRate > 60 ? "#E24B4A" : savedRate > 40 ? "#F5A623" : "#00A86B",
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
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
  const myCrops = uniqueCropsByCanonical(myRecs.map(r => r.crop).filter(Boolean));
  const planCrops = uniqueCropsByCanonical(loggedInFarmer.planned_crops || []);
  const allCrops = uniqueCropsByCanonical([...planCrops, ...myCrops]);

  // 作物別売上実績（千円）
  const cropRev0 = crop =>
    Math.round(
      myRecs.filter(r => canonicalCropName(r.crop) === canonicalCropName(crop))
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

  // ── Wizard state ──────────────────────────────────────────
  const [planView, setPlanView] = useState("wizard"); // "full" | "wizard"
  const [planStep, setPlanStep] = useState(1);
  const [selectedPlanCrop, setSelectedPlanCrop] = useState("");
  const [customCropInput, setCustomCropInput] = useState("");
  const WIZ_YI = 1;
  const TOTAL_STEPS = 7;
  const STEP_LABELS = ["作物","生産規模","収入","経費","借入","償還財源","確認"];

  const getStatus = (key, yi) => vals[`${key}_status_${yi}`] ?? "later";
  const setStatus = (key, yi, status) => {
    const next = { ...vals, [`${key}_status_${yi}`]: status };
    setVals(next);
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
  };

  const loanHas = vals[`loan_has_status_${WIZ_YI}`] || "later";
  const wizCrop = selectedPlanCrop || allCrops[0] || "";
  const wizMd   = getMarketData(wizCrop);
  const wizScale  = parseFloat(vals[`cr_${wizCrop}_scale_${WIZ_YI}`]) || 0;
  const wizQty    = parseFloat(vals[`cr_${wizCrop}_qty_${WIZ_YI}`]) || (wizMd.yield_per_10a ?? 0);
  const wizPrice  = parseFloat(vals[`cr_${wizCrop}_price_${WIZ_YI}`]) || (wizMd.price ?? 0);
  const wizProdKg  = wizScale > 0 && wizQty > 0 ? Math.round(wizScale * wizQty / 10) : 0;
  const wizRevAuto = wizScale > 0 && wizQty > 0 && wizPrice > 0 ? Math.round(wizProdKg * wizPrice / 1000) : 0;
  const wizNonFarm  = getStatus("non_farm", WIZ_YI) === "none" ? 0 : (parseFloat(vals[`non_farm_${WIZ_YI}`]) || 0);
  const wizPension  = getStatus("pension",  WIZ_YI) === "none" ? 0 : (parseFloat(vals[`pension_${WIZ_YI}`])  || 0);
  const wizHousehold = parseFloat(vals[`household_${WIZ_YI}`]) || 1080;
  const wizTax     = getStatus("tax", WIZ_YI) === "none" ? 0 : (parseFloat(vals[`tax_${WIZ_YI}`]) || 150);
  const wizRepay   = parseFloat(vals[`repay_principal_${WIZ_YI}`]) || 0;
  const wizFarmIncome = farmIncomeY(WIZ_YI);
  const wizSurplus  = wizFarmIncome + wizNonFarm + wizPension - wizHousehold - wizTax - wizRepay;

  // ── Wizard UIヘルパー ──────────────────────────────────────
  const StatusButtons = ({ rowKey, yi = WIZ_YI }) => {
    const status = getStatus(rowKey, yi);
    return (
      <div style={{ display:"flex", gap:8 }}>
        {[["input","金額を入力"],["none","なし"],["later","あとで入力"]].map(([s,l]) => (
          <button key={s} onClick={() => setStatus(rowKey, yi, s)} className="f-sans" style={{
            padding:"8px 14px", borderRadius:20, fontSize:12, fontWeight:600,
            cursor:"pointer", border:"none",
            background: status === s ? "#00A86B" : "#F7F7F7",
            color:       status === s ? "#fff"    : "#717171",
          }}>{l}</button>
        ))}
      </div>
    );
  };
  const WizCard = ({ children }) => (
    <div style={{
      background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
      padding:"24px", marginBottom:16, boxShadow:"0 2px 8px rgba(0,0,0,0.04)",
    }}>{children}</div>
  );

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

      {/* ── 表示切替 ── */}
      <div className="no-print" style={{ display:"flex", gap:4, marginBottom:24, padding:"4px", background:"#F7F7F7", borderRadius:22, width:"fit-content" }}>
        {[["full","確認する"],["wizard","入力する"]].map(([v,l]) => (
          <button key={v} onClick={() => { setPlanView(v); if(v==="wizard") setPlanStep(1); }} className="f-sans" style={{
            padding:"10px 22px", borderRadius:18, fontSize:13, fontWeight:600, cursor:"pointer", border:"none",
            background: planView===v ? "#fff" : "transparent",
            color:       planView===v ? "#222" : "#717171",
            boxShadow:   planView===v ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
            transition:"all .15s",
          }}>{l}</button>
        ))}
      </div>

      {/* ━━━ WIZARD VIEW ━━━ */}
      {planView === "wizard" && (
        <div style={{ maxWidth:560, margin:"0 auto", paddingBottom:32 }}>

          {/* 進捗バー */}
          <div style={{ marginBottom:28 }}>
            <div style={{ display:"flex", gap:3, marginBottom:8 }}>
              {STEP_LABELS.map((_, i) => (
                <div key={i} onClick={() => i+1 < planStep && setPlanStep(i+1)} style={{
                  flex:1, height:4, borderRadius:2,
                  cursor: i+1 < planStep ? "pointer" : "default",
                  background: i+1 <= planStep ? "#00A86B" : "#EBEBEB",
                  transition:"background 0.3s",
                }} />
              ))}
            </div>
            <div style={{ display:"flex", overflowX:"auto", gap:0, scrollbarWidth:"none" }}>
              {STEP_LABELS.map((label, i) => (
                <div key={i} style={{ flexShrink:0, textAlign:"center", minWidth:56, paddingRight:4 }}>
                  <span className="f-sans" style={{
                    fontSize:9, fontWeight: i+1===planStep ? 700 : 400,
                    color: i+1===planStep ? "#00A86B" : i+1<planStep ? "#717171" : "#B0B0B0",
                  }}>{i+1} {label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ─── STEP 1: 作物 ─── */}
          {planStep === 1 && (
            <div className="fade-in">
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>
                どの作物の計画を作りますか？
              </h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>複数ある場合は代表作物から始めましょう</p>
              <WizCard>
                {allCrops.length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:16 }}>
                    {allCrops.map(c => (
                      <button key={c} onClick={() => setSelectedPlanCrop(canonicalCropName(c))} className="f-sans" style={{
                        padding:"12px 20px", borderRadius:20, fontSize:14, fontWeight:600, cursor:"pointer",
                        border:"2px solid", borderColor: selectedPlanCrop===c ? "#00A86B" : "#EBEBEB",
                        background: selectedPlanCrop===c ? "#E6F7EF" : "#fff",
                        color: selectedPlanCrop===c ? "#00A86B" : "#222",
                      }}>{c}</button>
                    ))}
                  </div>
                )}
                <div style={{ display:"flex", gap:8 }}>
                  <input value={customCropInput} onChange={e => setCustomCropInput(e.target.value)}
                    placeholder="作物名を入力（例：ブドウ）" className="field f-sans"
                    style={{ flex:1, fontSize:14 }}
                    onKeyDown={e => { if(e.key==="Enter"&&customCropInput.trim()){ setSelectedPlanCrop(canonicalCropName(customCropInput.trim())); setCustomCropInput(""); }}}
                  />
                  <button onClick={() => { if(customCropInput.trim()){ setSelectedPlanCrop(canonicalCropName(customCropInput.trim())); setCustomCropInput(""); }}} className="f-sans" style={{
                    padding:"12px 18px", borderRadius:12, fontSize:13, fontWeight:600, cursor:"pointer",
                    background:"#F7F7F7", border:"1px solid #EBEBEB", color:"#222",
                  }}>追加</button>
                </div>
              </WizCard>
              {selectedPlanCrop && (
                <div style={{ padding:"12px 18px", background:"#E6F7EF", borderRadius:12 }}>
                  <span className="f-sans" style={{ fontSize:13, color:"#00A86B", fontWeight:600 }}>✓ {selectedPlanCrop} を選択中</span>
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 2: 生産規模 ─── */}
          {planStep === 2 && (
            <div className="fade-in">
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>
                {wizCrop}をどれくらい作りますか？
              </h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>1年目の計画値（千円単位）</p>
              <WizCard>
                <div style={{ marginBottom:20 }}>
                  <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>
                    作付面積 <span style={{ fontSize:11, color:"#B0B0B0" }}>（a）</span>
                  </label>
                  <input type="number" value={vals[`cr_${wizCrop}_scale_${WIZ_YI}`] || ""}
                    onChange={e => set(`cr_${wizCrop}_scale`, WIZ_YI, e.target.value)}
                    placeholder="例：30" className="field f-mono" style={{ fontSize:18, maxWidth:200 }} />
                </div>
                <div style={{ marginBottom:20 }}>
                  <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>
                    10a収量 <span style={{ fontSize:11, color:"#B0B0B0" }}>（kg/10a）</span>
                  </label>
                  {wizMd.yield_per_10a && <p className="f-sans" style={{ fontSize:11, color:"#00A86B", marginBottom:6 }}>📊 全国参考値 {wizMd.yield_per_10a.toLocaleString()}kg</p>}
                  <input type="number" value={vals[`cr_${wizCrop}_qty_${WIZ_YI}`] || ""}
                    onChange={e => set(`cr_${wizCrop}_qty`, WIZ_YI, e.target.value)}
                    placeholder={wizMd.yield_per_10a ? String(wizMd.yield_per_10a) : "例：1200"}
                    className="field f-mono" style={{ fontSize:18, maxWidth:200 }} />
                </div>
                {wizProdKg > 0 && (
                  <div style={{ padding:"12px 16px", background:"#F7F7F7", borderRadius:10, marginBottom:20 }}>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171" }}>生産量（自動計算）</p>
                    <p className="f-mono" style={{ fontSize:18, fontWeight:700, color:"#222" }}>{wizProdKg.toLocaleString("ja-JP")} kg</p>
                  </div>
                )}
                <div style={{ marginBottom: wizRevAuto > 0 ? 20 : 0 }}>
                  <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>
                    単価 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円/kg）</span>
                  </label>
                  {wizMd.price && <p className="f-sans" style={{ fontSize:11, color:"#00A86B", marginBottom:6 }}>📊 全国参考値 {wizMd.price.toLocaleString()}円</p>}
                  <input type="number" value={vals[`cr_${wizCrop}_price_${WIZ_YI}`] || ""}
                    onChange={e => set(`cr_${wizCrop}_price`, WIZ_YI, e.target.value)}
                    placeholder={wizMd.price ? String(wizMd.price) : "例：200"}
                    className="field f-mono" style={{ fontSize:18, maxWidth:200 }} />
                </div>
                {wizRevAuto > 0 && (
                  <div style={{ padding:"16px", background:"#E6F7EF", borderRadius:12, border:"1px solid #00A86B22" }}>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:4 }}>収入金額（自動計算）</p>
                    <p className="f-mono" style={{ fontSize:22, fontWeight:700, color:"#00A86B" }}>{wizRevAuto.toLocaleString("ja-JP")} 千円</p>
                  </div>
                )}
              </WizCard>
            </div>
          )}

          {/* ─── STEP 3: 農業収入 ─── */}
          {planStep === 3 && (
            <div className="fade-in">
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>農業収入を確認します</h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>金額は千円単位</p>
              <WizCard>
                <div style={{ marginBottom:24 }}>
                  <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", marginBottom:8, display:"block" }}>{wizCrop}の収入</label>
                  <div style={{ padding:"14px 18px", background:"#F7F7F7", borderRadius:12, marginBottom:8 }}>
                    {wizRevAuto > 0
                      ? <p className="f-mono" style={{ fontSize:18, fontWeight:700, color:"#222" }}>
                          {wizRevAuto.toLocaleString("ja-JP")} 千円
                          <span className="f-sans" style={{ fontSize:11, color:"#717171", marginLeft:8 }}>（Step 2から自動計算）</span>
                        </p>
                      : <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>Step 2で生産規模・単価を入力すると自動計算されます</p>
                    }
                  </div>
                  {wizRevAuto > 0 && (
                    <>
                      <p className="f-sans" style={{ fontSize:11, color:"#717171", marginBottom:4 }}>手動で上書きする場合:</p>
                      <input type="number" value={vals[`cr_${wizCrop}_rev_${WIZ_YI}`] || ""}
                        onChange={e => set(`cr_${wizCrop}_rev`, WIZ_YI, e.target.value)}
                        placeholder={String(wizRevAuto)} className="field f-mono"
                        style={{ fontSize:16, maxWidth:180 }} />
                    </>
                  )}
                </div>
                {[
                  { label:"作業受託収入", rowKey:"work_recv" },
                  { label:"その他収入",   rowKey:"other_rev" },
                ].map(({ label, rowKey }) => (
                  <div key={rowKey} style={{ marginBottom:20 }}>
                    <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>{label}</label>
                    <StatusButtons rowKey={rowKey} />
                    {getStatus(rowKey, WIZ_YI) === "input" && (
                      <input type="number" value={vals[`${rowKey}_${WIZ_YI}`] || ""} onChange={e => set(rowKey, WIZ_YI, e.target.value)}
                        placeholder="千円" className="field f-mono" style={{ fontSize:16, maxWidth:180, marginTop:8 }} />
                    )}
                    {getStatus(rowKey, WIZ_YI) === "none" && <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4 }}>0円として保存します</p>}
                  </div>
                ))}
              </WizCard>
              <div style={{ padding:"16px 20px", background:"#E6F7EF", borderRadius:16, border:"1px solid #00A86B22" }}>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:4 }}>農業粗収入（1年目）</p>
                <p className="f-mono" style={{ fontSize:22, fontWeight:700, color:"#00A86B" }}>{grossRevY(WIZ_YI).toLocaleString("ja-JP")} 千円</p>
              </div>
            </div>
          )}

          {/* ─── STEP 4: 農業経費 ─── */}
          {planStep === 4 && (
            <div className="fade-in">
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>主な経費を入力します</h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>金額は千円単位。「なし」は0円として保存します</p>
              <WizCard>
                {[
                  { label:"原材料費",     rowKey:"c_material",   hint:null },
                  { label:"施設・機械費", rowKey:"c_facility",   hint:null },
                  { label:"減価償却費",   rowKey:"c_deprec",     hint:null },
                  { label:"出荷販売経費", rowKey:"c_shipping",   hint: shipping0 > 0 ? `記録から実績 ${shipping0.toLocaleString()}千円（参考）` : null },
                  { label:"雇用労賃",     rowKey:"c_labor",      hint:null },
                  { label:"支払利息",     rowKey:"c_interest",   hint:null },
                  { label:"支払地代",     rowKey:"c_rent",       hint:null },
                  { label:"その他",       rowKey:"c_other_cost", hint:null },
                ].map(({ label, rowKey, hint }, idx, arr) => (
                  <div key={rowKey} style={{ marginBottom:20, paddingBottom:20, borderBottom: idx < arr.length-1 ? "1px solid #F7F7F7" : "none" }}>
                    <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>{label}</label>
                    {hint && <p className="f-sans" style={{ fontSize:11, color:"#00A86B", marginBottom:6 }}>📊 {hint}</p>}
                    <StatusButtons rowKey={rowKey} />
                    {getStatus(rowKey, WIZ_YI) === "input" && (
                      <input type="number" value={vals[`${rowKey}_${WIZ_YI}`] || ""} onChange={e => set(rowKey, WIZ_YI, e.target.value)}
                        placeholder="千円" className="field f-mono" style={{ fontSize:16, maxWidth:180, marginTop:8 }} />
                    )}
                    {getStatus(rowKey, WIZ_YI) === "none" && <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4 }}>0円として保存します</p>}
                  </div>
                ))}
              </WizCard>
              <div style={{ padding:"16px 20px", background: totalCostY(WIZ_YI) > grossRevY(WIZ_YI) ? "#FCEBEB" : "#E6F7EF", borderRadius:16 }}>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:4 }}>農業経費合計（1年目）</p>
                <p className="f-mono" style={{ fontSize:22, fontWeight:700, color: totalCostY(WIZ_YI) > grossRevY(WIZ_YI) ? "#E24B4A" : "#00A86B" }}>
                  {totalCostY(WIZ_YI).toLocaleString("ja-JP")} 千円
                </p>
                <p className="f-sans" style={{ fontSize:11, color:"#717171", marginTop:4 }}>
                  農業所得（見込み）：{farmIncomeY(WIZ_YI).toLocaleString("ja-JP")} 千円
                </p>
              </div>
            </div>
          )}

          {/* ─── STEP 5: 借入・返済 ─── */}
          {planStep === 5 && (
            <div className="fade-in">
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>借入や返済はありますか？</h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>農業のための借入金についてお答えください</p>
              <WizCard>
                <div style={{ display:"flex", gap:12, marginBottom:24 }}>
                  {[["yes","ある"],["no","なし"]].map(([v,l]) => (
                    <button key={v} onClick={() => {
                      const next = { ...vals, [`loan_has_status_${WIZ_YI}`]: v };
                      if(v==="no") {
                        ["debt_short","debt_long","debt_nonfarm","repay_principal","c_interest"].forEach(k => {
                          next[`${k}_${WIZ_YI}`] = "0";
                          next[`${k}_status_${WIZ_YI}`] = "none";
                        });
                      }
                      setVals(next);
                      try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
                    }} className="f-sans" style={{
                      flex:1, padding:"16px", borderRadius:16, fontSize:15, fontWeight:600, cursor:"pointer",
                      border:"2px solid", borderColor: loanHas===v ? "#00A86B" : "#EBEBEB",
                      background: loanHas===v ? "#E6F7EF" : "#fff",
                      color: loanHas===v ? "#00A86B" : "#222",
                    }}>{l}</button>
                  ))}
                </div>
                {loanHas === "no" && (
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center" }}>借入関連の項目は0円として保存します</p>
                )}
                {loanHas === "yes" && (
                  <div>
                    {[
                      { label:"借入金（残高）",       rowKey:"debt_long",        unit:"千円", placeholder:"例：5000" },
                      { label:"年間返済額（償還元金）", rowKey:"repay_principal",  unit:"千円", placeholder:"例：600" },
                      { label:"支払利息（年間）",      rowKey:"c_interest",       unit:"千円", placeholder:"例：50" },
                    ].map(({ label, rowKey, unit, placeholder }) => (
                      <div key={rowKey} style={{ marginBottom:20 }}>
                        <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>
                          {label} <span style={{ fontSize:11, color:"#B0B0B0" }}>（{unit}）</span>
                        </label>
                        <input type="number" value={vals[`${rowKey}_${WIZ_YI}`] || ""}
                          onChange={e => set(rowKey, WIZ_YI, e.target.value)}
                          placeholder={placeholder} className="field f-mono"
                          style={{ fontSize:16, maxWidth:200 }} />
                      </div>
                    ))}
                  </div>
                )}
              </WizCard>
            </div>
          )}

          {/* ─── STEP 6: 償還財源 ─── */}
          {planStep === 6 && (
            <div className="fade-in">
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>返済に使えるお金を確認します</h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>金額は千円単位</p>
              <WizCard>
                <div style={{ padding:"12px 16px", background:"#F7F7F7", borderRadius:10, marginBottom:20 }}>
                  <p className="f-sans" style={{ fontSize:12, color:"#717171" }}>農業所得（自動計算）</p>
                  <p className="f-mono" style={{ fontSize:18, fontWeight:700, color: wizFarmIncome < 0 ? "#E24B4A" : "#222" }}>
                    {wizFarmIncome.toLocaleString("ja-JP")} 千円
                  </p>
                </div>
                {[
                  { label:"農外所得",   rowKey:"non_farm" },
                  { label:"年金・その他収入", rowKey:"pension" },
                ].map(({ label, rowKey }) => (
                  <div key={rowKey} style={{ marginBottom:20 }}>
                    <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>{label}</label>
                    <StatusButtons rowKey={rowKey} />
                    {getStatus(rowKey, WIZ_YI) === "input" && (
                      <input type="number" value={vals[`${rowKey}_${WIZ_YI}`] || ""} onChange={e => set(rowKey, WIZ_YI, e.target.value)}
                        placeholder="千円" className="field f-mono" style={{ fontSize:16, maxWidth:180, marginTop:8 }} />
                    )}
                    {getStatus(rowKey, WIZ_YI) === "none" && <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4 }}>0円として保存します</p>}
                  </div>
                ))}
                <div style={{ marginBottom:20 }}>
                  <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>
                    家計費 <span style={{ fontSize:11, color:"#B0B0B0" }}>（千円）</span>
                  </label>
                  <input type="number" value={vals[`household_${WIZ_YI}`] || ""}
                    onChange={e => set("household", WIZ_YI, e.target.value)}
                    placeholder="1080（参考値）" className="field f-mono" style={{ fontSize:16, maxWidth:200 }} />
                </div>
                <div style={{ marginBottom:20 }}>
                  <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>租税公課</label>
                  <StatusButtons rowKey="tax" />
                  {getStatus("tax", WIZ_YI) === "input" && (
                    <input type="number" value={vals[`tax_${WIZ_YI}`] || ""} onChange={e => set("tax", WIZ_YI, e.target.value)}
                      placeholder="150（参考値）" className="field f-mono" style={{ fontSize:16, maxWidth:180, marginTop:8 }} />
                  )}
                  {getStatus("tax", WIZ_YI) === "none" && <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4 }}>0円として保存します</p>}
                </div>
                <div style={{ padding:"12px 16px", background:"#F7F7F7", borderRadius:10 }}>
                  <p className="f-sans" style={{ fontSize:12, color:"#717171" }}>償還元金（Step 5から反映）</p>
                  <p className="f-mono" style={{ fontSize:18, fontWeight:700, color:"#222" }}>{wizRepay.toLocaleString("ja-JP")} 千円</p>
                </div>
              </WizCard>
              <div style={{ padding:"20px 24px", background: wizSurplus >= 0 ? "#E6F7EF" : "#FCEBEB", borderRadius:16, border:`1px solid ${wizSurplus >= 0 ? "#00A86B22" : "#E24B4A22"}` }}>
                <p className="f-sans" style={{ fontSize:11, color:"#717171", marginBottom:6 }}>差引余剰 = 農業所得 + 農外所得 + 年金 − 家計費 − 租税 − 償還元金</p>
                <p className="f-mono" style={{ fontSize:26, fontWeight:700, color: wizSurplus >= 0 ? "#00A86B" : "#E24B4A" }}>
                  {wizSurplus.toLocaleString("ja-JP")} 千円
                </p>
                {wizSurplus < 0 && (
                  <p className="f-sans" style={{ fontSize:11, color:"#E24B4A", marginTop:4 }}>⚠ 差引余剰がマイナスです。収入増加または経費削減を検討してください。</p>
                )}
              </div>
            </div>
          )}

          {/* ─── STEP 7: 確認 ─── */}
          {planStep === 7 && (
            <div className="fade-in">
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>この内容で五年計画書を作ります</h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>1年目の計画値サマリー（千円単位）</p>
              <WizCard>
                {[
                  { label:"農業収入",  value:grossRevY(WIZ_YI),   accent:false },
                  { label:"農業経費",  value:totalCostY(WIZ_YI),  accent:false },
                  { label:"農業所得",  value:farmIncomeY(WIZ_YI), accent:true },
                  { label:"農外所得",  value:wizNonFarm,           accent:false },
                  { label:"家計費",    value:wizHousehold,         accent:false },
                  { label:"償還元金",  value:wizRepay,             accent:false },
                  { label:"差引余剰",  value:wizSurplus,           accent:true },
                ].map(({ label, value, accent }) => (
                  <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 0", borderBottom:"1px solid #F7F7F7" }}>
                    <span className="f-sans" style={{ fontSize:14, color:"#222", fontWeight: accent ? 700 : 400 }}>{label}</span>
                    <span className="f-mono" style={{ fontSize:16, fontWeight:700, color: accent ? (value >= 0 ? "#00A86B" : "#E24B4A") : "#222" }}>
                      {value.toLocaleString("ja-JP")} 千円
                    </span>
                  </div>
                ))}
              </WizCard>
              <div style={{ display:"grid", gap:10, marginTop:24 }}>
                <button onClick={() => setPlanView("full")} className="btn-primary" style={{ width:"100%", padding:"16px", fontSize:15, borderRadius:14 }}>
                  完成版を見る →
                </button>
                <button onClick={() => window.print()} style={{
                  width:"100%", padding:"14px", fontSize:14, borderRadius:14,
                  background:"#fff", border:"1px solid #EBEBEB", color:"#222", cursor:"pointer", fontFamily:"inherit",
                }}>PDF出力</button>
                <button onClick={() => setPlanStep(1)} style={{
                  width:"100%", padding:"12px", fontSize:13, borderRadius:14,
                  background:"none", border:"none", color:"#717171", cursor:"pointer", fontFamily:"inherit",
                }}>← 入力を修正する</button>
              </div>
            </div>
          )}

          {/* ナビゲーション（STEP 7以外） */}
          {planStep < TOTAL_STEPS && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:32, paddingTop:16, borderTop:"1px solid #EBEBEB" }}>
              {planStep > 1
                ? <button onClick={() => setPlanStep(s => s-1)} className="f-sans" style={{
                    padding:"14px 24px", borderRadius:12, fontSize:14, cursor:"pointer",
                    background:"#F7F7F7", border:"none", color:"#222", fontWeight:600,
                  }}>← 戻る</button>
                : <div />
              }
              <button onClick={() => setPlanStep(s => s+1)} className="btn-primary" style={{
                padding:"14px 32px", fontSize:14, borderRadius:12,
                opacity: planStep===1 && !wizCrop ? 0.4 : 1,
                pointerEvents: planStep===1 && !wizCrop ? "none" : "auto",
              }}>次へ →</button>
            </div>
          )}

        </div>
      )}

      {/* ━━━ FULL TABLE VIEW ━━━ */}
      {planView === "full" && (
        <>
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
                {AutoRow({ label:"農業所得", calcFn:farmIncomeY })}
                {InpRow({ label:"農外所得", unit:"千円", rowKey:"non_farm", actDef:0 })}
                {InpRow({ label:"年金被贈等", unit:"千円", rowKey:"pension", actDef:0 })}
                {AutoRow({ label:"農家総所得", calcFn:totalIncomeY })}
                {InpRow({ label:"家計費", unit:"千円", rowKey:"household", actDef:1080 })}
                {InpRow({ label:"租税公課", unit:"千円", rowKey:"tax", actDef:150 })}
                {AutoRow({ label:"償還財源", calcFn:repaySourceY })}
                {InpRow({ label:"償還元金", unit:"千円", rowKey:"repay_principal", actDef:0 })}
                {AutoRow({ label:"差引余剰", calcFn:surplusY })}
                {InpRow({ label:"施設・機械等の設備投資", unit:"千円", rowKey:"capex", actDef:0 })}
                {InpRow({ label:"農業負債（短期）", unit:"千円", rowKey:"debt_short", actDef:0 })}
                {InpRow({ label:"農業負債（長期）", unit:"千円", rowKey:"debt_long", actDef:0 })}
                {InpRow({ label:"農外負債", unit:"千円", rowKey:"debt_nonfarm", actDef:0 })}
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
        </>
      )}

    </div>
  );
}

// ── LandingFlow ──────────────────────────────────────────────
function LandingFlow({ onComplete, onSkip, onLogin }) {
  const totalSteps = 5;
  const [step, setStep] = useState(1);
  const [userType, setUserType] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [agreed, setAgreed] = useState(false);

  const goNext = () => { if (step < totalSteps) setStep(s => s + 1); };
  const goBack = () => { if (step > 1) setStep(s => s - 1); };

  const canGoNext = [null, true, !!userType, !!painPoint, true, agreed][step] ?? true;

  const CardBtn = ({ selected, onClick, children }) => (
    <button onClick={onClick} style={{
      width:"100%", textAlign:"left", padding:"20px 24px", borderRadius:16,
      border: selected ? "2px solid #00A86B" : "2px solid #EBEBEB",
      background: selected ? "#E6F7EF" : "#fff",
      fontSize:15, fontWeight: selected ? 600 : 400,
      color:"#222", cursor:"pointer", transition:"all .15s", marginBottom:10,
      display:"block",
    }}>{children}</button>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:9998 }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:"#EBEBEB" }}>
        <div style={{ height:4, background:"#00A86B", width:(step/totalSteps*100)+"%", transition:"width 0.3s ease" }} />
      </div>

      <button onClick={onSkip} className="f-sans" style={{
        position:"absolute", top:16, right:20,
        background:"#fff", border:"1px solid #EBEBEB",
        borderRadius:20, padding:"8px 18px",
        fontSize:13, color:"#222", fontWeight:600,
        cursor:"pointer", zIndex:1,
        boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
      }}>スキップ →</button>

      <div style={{ maxWidth:480, margin:"0 auto", padding:"60px 24px 140px", overflowY:"auto", height:"100%" }}>
        <div key={step} className="fade-in">

          {step === 1 && (
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:48, marginBottom:20 }}>🌾</div>
              <h1 className="f-sans" style={{ fontSize:24, fontWeight:700, color:"#222", marginBottom:14, lineHeight:1.4 }}>
                月1回の記録が、<br/>あとで人手確保に役立ちます
              </h1>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.9 }}>
                売上・経費・出荷の記録を残した農家から、将来の農業バイト優先案内や手数料割引につなげる予定です。
              </p>
            </div>
          )}

          {step === 2 && (
            <>
              <h1 className="f-sans" style={{ fontSize:24, fontWeight:700, color:"#222", marginBottom:10, lineHeight:1.35 }}>
                あなたはどちらに近いですか？
              </h1>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, marginBottom:28 }}>
                あなたに合った情報をお見せします。
              </p>
              <CardBtn selected={userType==="veteran"} onClick={() => setUserType("veteran")}>🌾 ベテラン農家（10年以上）</CardBtn>
              <CardBtn selected={userType==="mid"} onClick={() => setUserType("mid")}>🌱 中堅農家（4〜10年）</CardBtn>
              <CardBtn selected={userType==="newcomer"} onClick={() => setUserType("newcomer")}>🔰 新規就農者（1〜3年）</CardBtn>
              <CardBtn selected={userType==="pre"} onClick={() => setUserType("pre")}>👀 これから農業を始める方</CardBtn>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="f-sans" style={{ fontSize:24, fontWeight:700, color:"#222", marginBottom:10, lineHeight:1.35 }}>
                今いちばん困っていることは？
              </h1>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, marginBottom:28 }}>
                あなたに合った使い方をご提案します。
              </p>
              <CardBtn selected={painPoint==="labor"} onClick={() => setPainPoint("labor")}>🤝 人手が足りない</CardBtn>
              <CardBtn selected={painPoint==="docs"} onClick={() => setPainPoint("docs")}>📄 計画書や資料づくりが面倒</CardBtn>
              <CardBtn selected={painPoint==="costs"} onClick={() => setPainPoint("costs")}>💰 経費や販売先を見直したい</CardBtn>
              <CardBtn selected={painPoint==="start"} onClick={() => setPainPoint("start")}>🤔 まだ何から始めるか分からない</CardBtn>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="f-sans" style={{ fontSize:24, fontWeight:700, color:"#222", marginBottom:14, lineHeight:1.35, textAlign:"center" }}>
                入力すると、こう見えます
              </h1>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.9, marginBottom:20, textAlign:"center" }}>
                売上・経費・手残り・経費率・月別推移が確認できます。
              </p>
              <img
                src="https://aegwepgtmwcnwzybpgsh.supabase.co/storage/v1/object/public/assets/dashboard.png.png"
                alt="ダッシュボードイメージ"
                style={{ width:"100%", borderRadius:12, border:"1px solid #EBEBEB" }}
              />
            </>
          )}

          {step === 5 && (
            <>
              <h1 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:20, lineHeight:1.4, textAlign:"center" }}>
                個人名・個別収支・販売先名は<br/>公開しません
              </h1>
              <div style={{ display:"grid", gap:10, marginBottom:20 }}>
                {[
                  { icon:"🔒", text:"氏名・住所・電話番号は非公開" },
                  { icon:"📊", text:"公開するのは5農家以上の集計値だけ" },
                  { icon:"🚫", text:"販売先名は本人画面のみ表示" },
                  { icon:"🤝", text:"同意なく第三者に共有しません" },
                ].map(item => (
                  <div key={item.text} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:"#F7F7F7", borderRadius:10 }}>
                    <span style={{ fontSize:20, flexShrink:0 }}>{item.icon}</span>
                    <span className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.6 }}>{item.text}</span>
                  </div>
                ))}
              </div>
              <label style={{
                display:"flex", alignItems:"flex-start", gap:10,
                marginBottom:16, cursor:"pointer",
              }}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                  style={{ marginTop:3, width:18, height:18, flexShrink:0, accentColor:"#00A86B" }}
                />
                <span className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7 }}>
                  <span style={{ color:"#00A86B", textDecoration:"underline", cursor:"pointer" }} onClick={e => { e.preventDefault(); e.stopPropagation(); }}>利用規約</span>
                  と
                  <span style={{ color:"#00A86B", textDecoration:"underline", cursor:"pointer" }} onClick={e => { e.preventDefault(); e.stopPropagation(); }}>プライバシーポリシー</span>
                  に同意する
                </span>
              </label>
              <button onClick={agreed ? onLogin : undefined} className="btn-primary" style={{
                width:"100%", padding:"16px", fontSize:16, fontWeight:700, borderRadius:12, marginBottom:12,
                opacity: agreed ? 1 : 0.4, cursor: agreed ? "pointer" : "not-allowed",
              }}>実証に参加する →</button>
              <button onClick={onSkip} className="f-sans" style={{
                width:"100%", padding:"12px", background:"none", border:"1px solid #EBEBEB",
                borderRadius:12, fontSize:13, color:"#717171", cursor:"pointer",
              }}>まず公開データを見る</button>
            </>
          )}

        </div>
      </div>

      {step < 5 && (
        <div style={{
          position:"fixed", bottom:0, left:0, right:0, background:"#fff",
          borderTop:"1px solid #EBEBEB",
          padding:"20px 24px calc(20px + env(safe-area-inset-bottom, 0px))",
          display:"flex", alignItems:"center", justifyContent:"space-between",
        }}>
          {step > 1
            ? <button onClick={goBack} className="f-sans" style={{ background:"none", border:"none", fontSize:15, color:"#222", cursor:"pointer", padding:"8px 0" }}>← 戻る</button>
            : <div />
          }
          <button onClick={canGoNext ? goNext : undefined} className="btn-primary" style={{
            padding:"16px 32px", fontSize:16, fontWeight:700,
            cursor:canGoNext?"pointer":"not-allowed", opacity:canGoNext?1:0.5,
            transition:"background 0.15s, opacity .2s",
          }}>
            {step === 1 ? "自分に合う使い方を見る →" : "次へ →"}
          </button>
        </div>
      )}
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
  const [appErrors, setAppErrors] = useState([]);

  const TIERS = ["1-3","4-10","10+"];

  const load = useCallback(async () => {
    setLoading(true);
    const [fr, de, re, ae] = await Promise.all([
      supabase.from("farmers").select("*").order("created_at", { ascending: false }),
      supabase.from("dests").select("*").order("name"),
      supabase.from("records").select("*").order("year,month"),
      supabase.from("app_errors").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    if (!fr.error) setFarmers(fr.data || []);
    if (!de.error) setDests(de.data || []);
    if (!re.error) setRecords(re.data || []);
    if (!ae.error) setAppErrors(ae.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, sub]);

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
  const farmerMap = Object.fromEntries([
    ...farmers.map(f => [f.id, f]),
    ...farmers.filter(f => f.auth_id).map(f => [f.auth_id, f]),
  ]);
  const destMap   = Object.fromEntries(dests.map(d => [d.id, d]));
  const filteredRecs = records.filter(r => {
    const fn = farmerMap[r.farmer_id]?.name || "";
    if (filterFarmer && !fuzzyMatch(filterFarmer, fn)) return false;
    if (filterCrop && !fuzzyMatch(filterCrop, r.crop || "")) return false;
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
    { k:"farmers", l:"農家",      n: farmers.length },
    { k:"dests",   l:"出荷先",    n: dests.filter(d=>d.status==="pending").length },
    { k:"records", l:"記録データ", n: records.length },
    { k:"stats",   l:"統計",      n: null },
    { k:"sql",     l:"SQL",       n: null },
    { k:"datadef", l:"データ定義", n: null },
    { k:"errors",  l:"エラー",    n: null },
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

      <div style={{ marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <p className="f-sans" style={{ fontSize:18,fontWeight:700,color:"#222",marginBottom:4 }}>管理者コンソール</p>
          <p className="f-sans" style={{ fontSize:12,color:"#717171" }}>農家・出荷先・記録データの管理</p>
        </div>
        <button onClick={() => { setLoading(true); load(); }} style={{
          padding:"8px 16px", borderRadius:10, border:"1px solid #EBEBEB",
          background:"#fff", fontSize:12, fontWeight:600, color:"#222",
          cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", gap:6,
        }}>
          🔄 更新
        </button>
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
            const fRecsWithDate = fRecs.filter(r => r.created_at);
            const lastRecDate = fRecsWithDate.length > 0
              ? fRecsWithDate.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at
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

      {/* ── データ定義 ── */}
      {!loading && sub==="datadef" && (
        <div className="fade-in" id="data-definition-print">
          <div className="no-print" style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}>
            <button onClick={() => window.print()} className="btn-primary" style={{ padding:"10px 24px", fontSize:13 }}>
              PDF印刷 / 保存
            </button>
          </div>

          <div style={{ marginBottom:32, paddingBottom:20, borderBottom:"2px solid #222" }}>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:"0 0 6px" }}>データ定義・分類表</h2>
            <p className="f-sans" style={{ fontSize:12, color:"#717171" }}>日本農業研究所（chitose-bank） v1.0 · 制定日：2026年5月25日</p>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:8, lineHeight:1.8 }}>本文書は内部判断基準です。すべてのデータ公開・アクセス権限・保存期間の判断はこの分類表に基づきます。</p>
          </div>

          <div style={{ marginBottom:32 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:14 }}>1. 危険度分類（Rランク）</h3>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #EBEBEB" }}>
                    {["ランク","名称","具体例","原則","公開可否"].map(h => (
                      <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#717171", fontSize:10, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { rank:"R5", name:"原本核情報",     ex:"伝票写真、精算書画像、証憑資料",                                          rule:"非公開・厳重保管",       pub:"不可",    bg:"#FCEBEB" },
                    { rank:"R4", name:"直接識別情報",   ex:"氏名、住所、電話番号、メール、口座番号、振込先、農園名、屋号",             rule:"非公開",                 pub:"不可",    bg:"#FCEBEB" },
                    { rank:"R3", name:"取引特定情報",   ex:"販売先名、業者名、担当者名、伝票番号、単価、控除額、入金日数",             rule:"本人画面・内部確認のみ", pub:"原則不可", bg:"#FEF3E2" },
                    { rank:"R2", name:"再特定リスク情報", ex:"市町村、町名、品目、面積、出荷量、就農年数、特殊作物",                   rule:"集計条件つき",           pub:"条件付き", bg:"#FEF3E2" },
                    { rank:"R1", name:"集計候補情報",   ex:"地域×品目×期間×5農家以上の平均値・中央値",                              rule:"公開判定を満たす場合のみ", pub:"判定後に可", bg:"#E6F7EF" },
                    { rank:"R0", name:"公開情報",       ex:"公的統計、一般作物情報、出典明記済みデータ",                              rule:"通常公開",               pub:"可",      bg:"#E6F7EF" },
                  ].map(r => (
                    <tr key={r.rank} style={{ borderBottom:"1px solid #F7F7F7", background:r.bg }}>
                      <td style={{ padding:"10px 12px", fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{r.rank}</td>
                      <td style={{ padding:"10px 12px", fontWeight:600 }}>{r.name}</td>
                      <td style={{ padding:"10px 12px", color:"#717171", maxWidth:200 }}>{r.ex}</td>
                      <td style={{ padding:"10px 12px" }}>{r.rule}</td>
                      <td style={{ padding:"10px 12px", fontWeight:600 }}>{r.pub}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="f-sans" style={{ fontSize:11, color:"#717171", marginTop:10, lineHeight:1.8 }}>
              ※ 危険度ランクは原データでは固定されるが、十分な集計・加工・再特定リスク確認を経た場合、下位ランクへ変換される場合がある。ただし1農家の寄与率が高い場合はランク据え置き。
            </p>
          </div>

          <div style={{ marginBottom:32 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:14 }}>2. データ状態分類（Sステージ）</h3>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #EBEBEB" }}>
                    {["状態","名称","定義","利用範囲"].map(h => (
                      <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#717171", fontSize:10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { s:"S0", name:"原本",             def:"アップロードされた画像・証憑・根拠資料",               use:"証拠保管・再確認のみ" },
                    { s:"S1", name:"未確認入力",        def:"手入力直後、AI読取直後、本人確認前",                   use:"本人画面の下書き" },
                    { s:"S2", name:"本人確認済み",      def:"農家本人が確認・修正・確定したデータ",                 use:"本人記録・内部集計候補" },
                    { s:"S3", name:"管理者確認済み",    def:"重複・異常値・個人情報混入を確認済み",                 use:"集計候補" },
                    { s:"S4", name:"仮名化済み",        def:"farmer_id等に置換、直接識別情報を分離",                use:"内部分析" },
                    { s:"S5", name:"集計済み",          def:"5農家以上など条件を満たした統計",                      use:"条件付き表示" },
                    { s:"S6", name:"外部提供用加工済み", def:"再特定困難な形に加工した提供用データ",                use:"外部提供候補（法務確認要）" },
                    { s:"S7", name:"公開済み",          def:"サイトや資料に表示したデータ",                         use:"公開ログ保存" },
                  ].map(r => (
                    <tr key={r.s} style={{ borderBottom:"1px solid #F7F7F7" }}>
                      <td style={{ padding:"10px 12px", fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{r.s}</td>
                      <td style={{ padding:"10px 12px", fontWeight:600 }}>{r.name}</td>
                      <td style={{ padding:"10px 12px", color:"#717171" }}>{r.def}</td>
                      <td style={{ padding:"10px 12px" }}>{r.use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginBottom:32 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:14 }}>3. 公開判定ルール</h3>
            <div style={{ padding:20, background:"#F7F7F7", borderRadius:12, border:"1px solid #EBEBEB" }}>
              <pre className="f-mono" style={{ fontSize:13, color:"#222", lineHeight:2, margin:0, whiteSpace:"pre-wrap" }}>{`公開可能 =\n  R1以下\n  × S5以上\n  × 原則5農家以上\n  × 特定農家の寄与率が高すぎない\n  × 再特定リスク低\n  × 利用目的内`}</pre>
            </div>
            <p className="f-sans" style={{ fontSize:11, color:"#717171", marginTop:10, lineHeight:1.8 }}>
              5農家以上であっても、特定農家の寄与率が高い場合、または地域・品目・期間の組み合わせから個別農家が推定される場合は、非公開・広域化・期間拡大・数値の丸め処理を行う。
            </p>
          </div>

          <div style={{ marginBottom:32 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:14 }}>4. 現フェーズでの適用</h3>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #EBEBEB" }}>
                    {["データ","危険度","状態","公開可否"].map(h => (
                      <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#717171", fontSize:10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { data:"農家名・メール",           r:"R4", s:"S2",    pub:"不可" },
                    { data:"市町村・作物・就農年数",   r:"R2", s:"S2",    pub:"条件付き（現状不可：5農家未満）" },
                    { data:"売上・経費・利益",         r:"R3", s:"S1〜S2", pub:"不可" },
                    { data:"販売先名",                 r:"R3", s:"S1〜S2", pub:"不可" },
                    { data:"公的統計",                 r:"R0", s:"S7",    pub:"公開可" },
                    { data:"運営メタ情報（参加農家数等）", r:"—", s:"—",  pub:"個人特定されない範囲で可" },
                  ].map((r,i) => (
                    <tr key={i} style={{ borderBottom:"1px solid #F7F7F7" }}>
                      <td style={{ padding:"10px 12px", fontWeight:500 }}>{r.data}</td>
                      <td style={{ padding:"10px 12px", fontFamily:"'DM Mono',monospace", fontWeight:600 }}>{r.r}</td>
                      <td style={{ padding:"10px 12px", fontFamily:"'DM Mono',monospace" }}>{r.s}</td>
                      <td style={{ padding:"10px 12px", fontWeight:600, color:r.pub==="公開可"?"#00A86B":r.pub==="不可"?"#E24B4A":"#F5A623" }}>{r.pub}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", marginTop:12 }}>
              結論：現時点で公開できる実データはR0の公的統計のみ。運営メタ情報は個人特定されない範囲で表示可能。
            </p>
          </div>

          <div style={{ marginBottom:32 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:14 }}>5. アクセス権限</h3>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #EBEBEB" }}>
                    {["権限","閲覧可能","閲覧不可"].map(h => (
                      <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#717171", fontSize:10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { role:"未ログイン",           yes:"公的統計、サービス説明、公開済み集計",     no:"個別農家データ" },
                    { role:"登録農家本人",         yes:"自分のデータ・集計・販売先",               no:"他農家の個別データ" },
                    { role:"管理者",               yes:"承認・確認に必要な範囲",                   no:"目的外閲覧は禁止" },
                    { role:"支援センター・金融機関", yes:"本人同意済み資料・集計データ",           no:"同意なき個別データ" },
                    { role:"行政・研究機関",       yes:"集計・加工済みデータ",                     no:"個別農家情報" },
                  ].map((r,i) => (
                    <tr key={i} style={{ borderBottom:"1px solid #F7F7F7" }}>
                      <td style={{ padding:"10px 12px", fontWeight:600 }}>{r.role}</td>
                      <td style={{ padding:"10px 12px", color:"#00A86B" }}>{r.yes}</td>
                      <td style={{ padding:"10px 12px", color:"#E24B4A" }}>{r.no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginBottom:32 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:14 }}>6. 利用目的分類</h3>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #EBEBEB" }}>
                    {["目的ID","利用目的","対象","同意"].map(h => (
                      <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#717171", fontSize:10, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id:"P1",  purpose:"本人の経営記録作成",         target:"入力データ",         consent:"必須",            bg:"#fff" },
                    { id:"P2",  purpose:"AI読取・入力補助",           target:"証憑画像",           consent:"機能利用時",      bg:"#F7F7F7" },
                    { id:"P3",  purpose:"本人確認・修正",             target:"未確認データ",       consent:"必須",            bg:"#fff" },
                    { id:"P4",  purpose:"重複・不正・異常値確認",     target:"原本・入力データ",   consent:"必須",            bg:"#F7F7F7" },
                    { id:"P5",  purpose:"貢献スコア算定",             target:"確認済みデータ",     consent:"任意または準必須", bg:"#fff" },
                    { id:"P6",  purpose:"集計データ作成",             target:"確認済みデータ",     consent:"同意取得",        bg:"#F7F7F7" },
                    { id:"P7",  purpose:"サイト上の集計表示",         target:"集計済みデータ",     consent:"任意",            bg:"#fff" },
                    { id:"P8",  purpose:"支援センター・JA向け資料",   target:"本人同意済み資料",   consent:"個別同意",        bg:"#FEF3E2" },
                    { id:"P9",  purpose:"金融機関向け資料",           target:"本人提出データ",     consent:"都度同意",        bg:"#FEF3E2" },
                    { id:"P10", purpose:"行政・研究向け分析",         target:"加工済みデータ",     consent:"任意または別同意", bg:"#F7F7F7" },
                    { id:"P11", purpose:"サービス改善",               target:"仮名化・集計データ中心", consent:"同意範囲内",  bg:"#fff" },
                    { id:"P12", purpose:"将来の農業人材マッチング特典", target:"貢献スコア",       consent:"任意",            bg:"#F7F7F7" },
                  ].map(r => (
                    <tr key={r.id} style={{ borderBottom:"1px solid #F7F7F7", background:r.bg }}>
                      <td style={{ padding:"10px 12px", fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{r.id}</td>
                      <td style={{ padding:"10px 12px", fontWeight:500 }}>{r.purpose}</td>
                      <td style={{ padding:"10px 12px", color:"#717171" }}>{r.target}</td>
                      <td style={{ padding:"10px 12px", fontWeight:600, color:r.consent==="必須"?"#E24B4A":r.consent.includes("都度")?"#F5A623":"#00A86B" }}>{r.consent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="f-sans" style={{ fontSize:11, color:"#717171", marginTop:10, lineHeight:1.8 }}>
              ※ P8・P9は都度本人同意が必要。「最初に同意したから全部出していい」は不可。<br/>
              ※ 利用目的を追加する場合は、本人に通知し必要に応じて同意を得る（データ憲法第9条）。
            </p>
          </div>

          <div style={{ marginBottom:32 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:14 }}>7. 保存期間</h3>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #EBEBEB" }}>
                    {["データ","保存期間","備考"].map(h => (
                      <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#717171", fontSize:10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { data:"原本画像",              period:"読取確定後1年以内を目安",           note:"将来フェーズ" },
                    { data:"未確認入力",             period:"30日以内に確定・修正・削除",        note:"放置禁止" },
                    { data:"本人確認済み記録",       period:"利用中は保存",                      note:"本人記録" },
                    { data:"集計・加工済みデータ",   period:"継続保存可",                        note:"再特定リスクを定期確認" },
                    { data:"操作ログ",               period:"3年目安",                           note:"法令・紛争対応により変動" },
                    { data:"退会後の個人紐づけ",     period:"1か月以内に削除または解除",         note:"最小限の履歴は目的限定で保存" },
                  ].map((r,i) => (
                    <tr key={i} style={{ borderBottom:"1px solid #F7F7F7" }}>
                      <td style={{ padding:"10px 12px", fontWeight:500 }}>{r.data}</td>
                      <td style={{ padding:"10px 12px" }}>{r.period}</td>
                      <td style={{ padding:"10px 12px", color:"#717171" }}>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ paddingTop:20, borderTop:"2px solid #222" }}>
            <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", lineHeight:1.8 }}>
              本文書は日本農業研究所（chitose-bank）の内部判断基準です。外部共有は、管理者による確認および必要な範囲での承認を経て行います。<br/>
              法令上の匿名加工情報として扱う場合は、別途加工基準と法務確認を満たす必要があります。<br/>
              本文書の内容は、サービスの発展に伴い改訂される場合があります。
            </p>
          </div>
        </div>
      )}

      {/* ── エラー ── */}
      {!loading && sub==="errors" && (
        <div className="fade-in">
          {appErrors.length === 0 ? (
            <div style={{ textAlign:"center", padding:"48px 0", color:"#B0B0B0" }}>
              <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
              <p className="f-sans" style={{ fontSize:14 }}>エラーは記録されていません</p>
            </div>
          ) : (
            <div style={{ display:"grid", gap:8 }}>
              {appErrors.map(e => {
                const diag = diagnoseError(e);
                return (
                  <div key={e.id} style={{
                    padding:"16px 20px", background:"#fff", border:"1px solid #EBEBEB",
                    borderRadius:12, boxShadow:"0 1px 3px rgba(0,0,0,0.04)",
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <span style={{
                        padding:"2px 8px", borderRadius:8, fontSize:10, fontWeight:700,
                        background: diag.severity === "high" ? "#FCEBEB" : diag.severity === "medium" ? "#FEF3E2" : "#F7F7F7",
                        color: diag.severity === "high" ? "#E24B4A" : diag.severity === "medium" ? "#F5A623" : "#717171",
                      }}>{diag.severity === "high" ? "重大" : diag.severity === "medium" ? "注意" : "不明"}</span>
                      <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>
                        {new Date(e.created_at).toLocaleString("ja-JP")}
                      </span>
                    </div>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", marginBottom:4 }}>{diag.title}</p>
                    <p className="f-mono" style={{ fontSize:11, color:"#717171", marginBottom:8, wordBreak:"break-all" }}>{e.message}</p>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
                      {e.component && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{e.component}</span>}
                      {e.action && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{e.action}</span>}
                      {e.operation && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{e.operation}</span>}
                    </div>
                    <div style={{ padding:"8px 12px", background:"#E6F7EF", borderRadius:8, borderLeft:"3px solid #00A86B" }}>
                      <p className="f-sans" style={{ fontSize:11, color:"#00A86B" }}>💡 修正案: {diag.fix}</p>
                    </div>
                    {e.status === "open" && (
                      <button onClick={async () => {
                        await supabase.from("app_errors").update({ status:"fixed", resolved_at: new Date().toISOString() }).eq("id", e.id);
                        setAppErrors(prev => prev.map(x => x.id === e.id ? { ...x, status:"fixed" } : x));
                      }} style={{
                        marginTop:8, padding:"6px 14px", border:"1px solid #00A86B44", borderRadius:8,
                        background:"transparent", color:"#00A86B", fontSize:11, fontWeight:600, cursor:"pointer",
                      }}>解決済みにする</button>
                    )}
                    {e.status === "fixed" && (
                      <span className="f-sans" style={{ display:"inline-block", marginTop:8, fontSize:11, color:"#00A86B", fontWeight:600 }}>✅ 解決済み</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}


// ── LaborTab ─────────────────────────────────────────────────
function LaborTab({ farmersCount, onLogin }) {
  const TARGET = 30;
  const progress = Math.min(Math.round((farmersCount / TARGET) * 100), 100);
  const AVG_HOURLY = 1180, AVG_DAILY = 8400, AVG_COUNT = 12;

  const [role,    setRole]    = useState(""); // "" | "farmer" | "worker"
  const [step,    setStep]    = useState(0);

  const [farmerExp,     setFarmerExp]     = useState("");
  const [farmerPurpose, setFarmerPurpose] = useState("");
  const [farmerCrop,    setFarmerCrop]    = useState("");
  const [farmerWork,    setFarmerWork]    = useState("");
  const [farmerRegion,  setFarmerRegion]  = useState("");
  const [farmerHourly,  setFarmerHourly]  = useState("");
  const [farmerDaily,   setFarmerDaily]   = useState("");

  const [workerExp,     setWorkerExp]     = useState("");
  const [workerPurpose, setWorkerPurpose] = useState("");
  const [workerCrop,    setWorkerCrop]    = useState("");
  const [workerWork,    setWorkerWork]    = useState("");
  const [workerRegion,  setWorkerRegion]  = useState("");
  const [workerHourly,  setWorkerHourly]  = useState("");
  const [workerDaily,   setWorkerDaily]   = useState("");
  const [workerHours,   setWorkerHours]   = useState("");

  const isFarmer = role === "farmer";
  const isWorker = role === "worker";
  const farmerStepLabels = ["就農歴","機能紹介","目的","プロフィール","確認","詳細","最終確認","完了"];
  const workerStepLabels = ["経歴","目的","プロフィール","確認","詳細","最終確認","完了"];
  const stepLabels = isFarmer ? farmerStepLabels : isWorker ? workerStepLabels : [];

  const goNext = () => setStep(s => s + 1);
  const goBack = () => { if (step <= 1) { setRole(""); setStep(0); } else setStep(s => s - 1); };

  const CardBtn = ({ selected, onClick, children }) => (
    <button onClick={onClick} style={{
      width:"100%", textAlign:"left", padding:"20px 22px", borderRadius:16, display:"block", marginBottom:10,
      border: selected ? "2px solid #00A86B" : "2px solid #EBEBEB",
      background: selected ? "#E6F7EF" : "#fff",
      fontSize:15, fontWeight: selected ? 600 : 400, color:"#222", cursor:"pointer", transition:"all .15s",
    }}>{children}</button>
  );
  const WizCard = ({ children }) => (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"24px", marginBottom:16, boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}>
      {children}
    </div>
  );
  const NavRow = ({ canNext = true }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:32, paddingTop:16, borderTop:"1px solid #EBEBEB" }}>
      <button onClick={goBack} className="f-sans" style={{ padding:"14px 24px", borderRadius:12, fontSize:14, cursor:"pointer", background:"#F7F7F7", border:"none", color:"#222", fontWeight:600 }}>← 戻る</button>
      <button onClick={goNext} className="btn-primary" style={{ padding:"14px 32px", fontSize:14, borderRadius:12, opacity: canNext ? 1 : 0.4, pointerEvents: canNext ? "auto" : "none" }}>次へ →</button>
    </div>
  );
  const ProgressBar = () => (
    <div style={{ marginBottom:28 }}>
      <div style={{ display:"flex", gap:3, marginBottom:6 }}>
        {stepLabels.map((_, i) => (
          <div key={i} style={{ flex:1, height:4, borderRadius:2, background: i+1 <= step ? "#00A86B" : "#EBEBEB", transition:"background 0.3s" }} />
        ))}
      </div>
      <div style={{ display:"flex", overflowX:"auto", scrollbarWidth:"none" }}>
        {stepLabels.map((label, i) => (
          <span key={i} className="f-sans" style={{ flexShrink:0, fontSize:9, minWidth:56, textAlign:"center", fontWeight: i+1===step ? 700 : 400, color: i+1===step ? "#00A86B" : i+1<step ? "#717171" : "#B0B0B0" }}>{i+1} {label}</span>
        ))}
      </div>
    </div>
  );
  const WageCompare = ({ type, value, avg, count }) => {
    if (!value || value <= 0) return null;
    if (count < 5) return <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4 }}>まだ同条件のデータが少ないため、平均は表示できません</p>;
    const diff = value - avg;
    return (
      <div style={{ marginTop:8, padding:"10px 14px", background:"#F7F7F7", borderRadius:10 }}>
        <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>
          この条件の平均{type}：<span className="f-mono" style={{ fontWeight:700, color:"#222" }}>{avg.toLocaleString()}円</span>　中央値：{Math.round(avg*0.97).toLocaleString()}円　件数：{count}件
        </p>
        <p className="f-sans" style={{ fontSize:11, marginTop:4, color: diff >= 0 ? "#00A86B" : "#F5A623" }}>
          あなたの設定：{value.toLocaleString()}円　平均より {diff >= 0 ? "+" : ""}{diff.toLocaleString()}円
          {diff < 0 ? "　※応募が集まりにくい可能性があります" : ""}
        </p>
      </div>
    );
  };
  const PillSelect = ({ options, value, onSelect }) => (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
      {options.map(o => (
        <button key={o} onClick={() => onSelect(o)} className="f-sans" style={{
          padding:"8px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600,
          border:"2px solid", borderColor: value===o ? "#00A86B" : "#EBEBEB",
          background: value===o ? "#E6F7EF" : "#fff", color: value===o ? "#00A86B" : "#222",
        }}>{o}</button>
      ))}
    </div>
  );
  const SummaryRow = ({ label, value }) => (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid #F7F7F7" }}>
      <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>{label}</span>
      <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600 }}>{value}</span>
    </div>
  );
  const WageNote = () => (
    <div style={{ padding:"10px 14px", background:"#FEF3E2", borderRadius:10, border:"1px solid #F5A62333", marginTop:8 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#F5A623" }}>⚠ 報酬は最低賃金を下回らないように設定してください</p>
    </div>
  );

  const wrap = (children) => (
    <div className="appear" style={{ maxWidth:560, margin:"0 auto", paddingBottom:40 }}>
      <ProgressBar />{children}
    </div>
  );

  // ── HOME ──
  if (step === 0) return (
    <div className="appear" style={{ maxWidth:560, margin:"0 auto", paddingBottom:40 }}>
      <div style={{ textAlign:"center", marginBottom:32 }}>
        <div style={{ fontSize:52, marginBottom:16 }}>🌾</div>
        <h1 className="f-sans" style={{ fontSize:24, fontWeight:700, color:"#222", lineHeight:1.4, marginBottom:12 }}>
          農業の人手探しを、<br/>もっと分かりやすく
        </h1>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, marginBottom:20 }}>
          作物・作業内容・地域・希望条件を整理し、<br/>農家と働き手のミスマッチを減らす機能を準備しています。
        </p>
        <span style={{ display:"inline-block", padding:"6px 18px", background:"#FEF3E2", borderRadius:20, marginBottom:8 }}>
          <span className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#F5A623" }}>構想段階</span>
        </span>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7 }}>実装前に労働局・関係機関へ確認した上で、段階的に追加予定です。</p>
      </div>
      <div style={{ padding:"18px 22px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, marginBottom:28 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
          <span className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222" }}>参加農家</span>
          <span className="f-mono" style={{ fontSize:18, fontWeight:700, color:"#00A86B" }}>{farmersCount}<span className="f-sans" style={{ fontSize:12, color:"#B0B0B0", fontWeight:400 }}> / {TARGET}名</span></span>
        </div>
        <div style={{ height:8, background:"#F7F7F7", borderRadius:4, overflow:"hidden" }}>
          <div style={{ height:8, borderRadius:4, background:"#00A86B", width:progress+"%", transition:"width 0.6s ease" }} />
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6, textAlign:"center" }}>あと{Math.max(TARGET-farmersCount,0)}名でマッチング機能を開始します</p>
      </div>
      <h2 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:14 }}>あなたはどちらですか？</h2>
      <CardBtn selected={false} onClick={() => { setRole("farmer"); setStep(1); }}>
        🚜 農家として使う
        <p className="f-sans" style={{ fontSize:12, color:"#717171", marginTop:4, fontWeight:400 }}>人手を探したい・働き手を見つけたい</p>
      </CardBtn>
      <CardBtn selected={false} onClick={() => { setRole("worker"); setStep(1); }}>
        👤 働き手として使う
        <p className="f-sans" style={{ fontSize:12, color:"#717171", marginTop:4, fontWeight:400 }}>農作業を手伝いたい・仕事を探したい</p>
      </CardBtn>
    </div>
  );

  // ── FARMER FLOW ──
  if (isFarmer) {
    if (step === 1) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>就農歴を教えてください</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>表示される機能の参考にします</p>
      {["1〜3年","4〜10年","10年以上"].map(v => <CardBtn key={v} selected={farmerExp===v} onClick={() => setFarmerExp(v)}>{v}</CardBtn>)}
      <NavRow canNext={!!farmerExp} />
    </>);

    if (step === 2) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>農家向け機能のご紹介</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>準備中の機能をご確認ください</p>
      <WizCard>
        {[
          { icon:"📋", title:"募集を出す", desc:"作物・作業内容・日程・報酬を入力して、働き手を募集できます。" },
          { icon:"👤", title:"候補者を探す", desc:"経験・作物・希望報酬で絞り込み、直接オファーを送れます。" },
          { icon:"📊", title:"経営連携", desc:"月次記録から雇用可能額を自動試算し、無理のない採用判断を支援します。" },
        ].map(item => (
          <div key={item.title} style={{ display:"flex", alignItems:"flex-start", gap:14, marginBottom:16 }}>
            <div style={{ width:40, height:40, borderRadius:10, background:"#E6F7EF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{item.icon}</div>
            <div style={{ flex:1 }}>
              <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:3 }}>{item.title}</p>
              <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7 }}>{item.desc}</p>
            </div>
          </div>
        ))}
      </WizCard>
      <NavRow canNext={true} />
    </>);

    if (step === 3) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>何をしたいですか？</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>あとから変更できます</p>
      <CardBtn selected={farmerPurpose==="post"} onClick={() => setFarmerPurpose("post")}>
        📋 仕事を出す
        <p className="f-sans" style={{ fontSize:12, color:"#717171", marginTop:4, fontWeight:400 }}>募集内容を入力して働き手を募集する</p>
      </CardBtn>
      <CardBtn selected={farmerPurpose==="offer"} onClick={() => setFarmerPurpose("offer")}>
        👤 働き手にオファーする
        <p className="f-sans" style={{ fontSize:12, color:"#717171", marginTop:4, fontWeight:400 }}>候補者を探して直接声をかける</p>
      </CardBtn>
      <NavRow canNext={!!farmerPurpose} />
    </>);

    if (step === 4) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>農家プロフィール</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>働き手に見せる情報を入力してください</p>
      <WizCard>
        <div style={{ marginBottom:20 }}>
          <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>主な作物</label>
          <PillSelect options={["トマト","キュウリ","ナス","イチゴ","米","ブドウ","リンゴ"]} value={farmerCrop} onSelect={setFarmerCrop} />
          <input value={farmerCrop} onChange={e => setFarmerCrop(e.target.value)} placeholder="その他の作物を入力" className="field f-sans" style={{ fontSize:14 }} />
        </div>
        <div style={{ marginBottom:20 }}>
          <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>主な作業内容</label>
          <PillSelect options={["収穫","定植","選果","農薬散布","草刈り","袋かけ"]} value={farmerWork} onSelect={setFarmerWork} />
        </div>
        <div>
          <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>地域</label>
          <input value={farmerRegion} onChange={e => setFarmerRegion(e.target.value)} placeholder="例：徳島県吉野川市" className="field f-sans" style={{ fontSize:14 }} />
        </div>
      </WizCard>
      <NavRow canNext={!!farmerCrop && !!farmerWork} />
    </>);

    if (step === 5) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>プロフィール確認</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>この内容で進めます</p>
      <WizCard>
        <SummaryRow label="就農歴" value={farmerExp} />
        <SummaryRow label="作物"   value={farmerCrop} />
        <SummaryRow label="作業"   value={farmerWork} />
        <SummaryRow label="地域"   value={farmerRegion || "未入力"} />
        <SummaryRow label="目的"   value={farmerPurpose==="post" ? "仕事を出す" : "オファーする"} />
      </WizCard>
      <NavRow canNext={true} />
    </>);

    if (step === 6) {
      if (farmerPurpose === "post") return wrap(<>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>募集内容を入力します</h2>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>これはプレビューです。実際の公開はまだ行いません</p>
        <WizCard>
          <div style={{ marginBottom:20 }}>
            <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>希望時給 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円）</span></label>
            <input type="number" value={farmerHourly} onChange={e => setFarmerHourly(e.target.value)} placeholder="例：1200" className="field f-mono" style={{ fontSize:18, maxWidth:180 }} />
            <WageCompare type="時給" value={parseFloat(farmerHourly)||0} avg={AVG_HOURLY} count={AVG_COUNT} />
          </div>
          <div style={{ marginBottom:16 }}>
            <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>希望日給 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円）</span></label>
            <input type="number" value={farmerDaily} onChange={e => setFarmerDaily(e.target.value)} placeholder="例：9000" className="field f-mono" style={{ fontSize:18, maxWidth:180 }} />
            <WageCompare type="日給" value={parseFloat(farmerDaily)||0} avg={AVG_DAILY} count={AVG_COUNT} />
          </div>
          <WageNote />
        </WizCard>
        <NavRow canNext={true} />
      </>);

      return wrap(<>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>候補者リスト（想定画面）</h2>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>実装後はこのような画面になる予定です</p>
        <div style={{ padding:"12px 16px", background:"#F7F7F7", borderRadius:12, marginBottom:12 }}>
          <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>📱 スマホ：地図→検索・絞込→リスト　🖥 PC：左に地図、右にリスト</p>
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:14, overflowX:"auto" }}>
          {["地域","作物","作業内容","日付","経験","報酬","移動手段"].map(f => (
            <span key={f} style={{ flexShrink:0, padding:"7px 14px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:11, color:"#717171" }}>{f}</span>
          ))}
        </div>
        {[
          { name:"A. T.", crop:"トマト・キュウリ", work:"収穫・定植", exp:"4〜10年", hourly:1200 },
          { name:"K. N.", crop:"イチゴ",           work:"収穫・選果", exp:"1〜3年",  hourly:1100 },
          { name:"S. M.", crop:"米・大豆",         work:"草刈り・農薬散布", exp:"10年以上", hourly:1300 },
        ].map((c, i) => (
          <div key={i} style={{ padding:"16px 18px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
              <div style={{ width:44, height:44, borderRadius:"50%", background:"#E6F7EF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>👤</div>
              <div>
                <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>{c.name}</p>
                <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>{c.exp}</p>
              </div>
              <div style={{ marginLeft:"auto", textAlign:"right" }}>
                <p className="f-mono" style={{ fontSize:14, fontWeight:700, color:"#00A86B" }}>¥{c.hourly.toLocaleString()}/h</p>
                <p className="f-sans" style={{ fontSize:10, color: c.hourly>=AVG_HOURLY ? "#00A86B" : "#F5A623" }}>平均{c.hourly>=AVG_HOURLY?"+":""}{(c.hourly-AVG_HOURLY).toLocaleString()}円</p>
              </div>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[c.crop, c.work].map(t => <span key={t} style={{ padding:"3px 10px", borderRadius:20, background:"#F7F7F7", color:"#717171", fontSize:11 }}>{t}</span>)}
            </div>
          </div>
        ))}
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", textAlign:"center", marginTop:4 }}>※ 表示名・アイコンのみ。本名・詳細住所は非公開</p>
        <NavRow canNext={true} />
      </>);
    }

    if (step === 7) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>内容の確認</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>この内容で登録します（構想段階のため、実際の公開は行いません）</p>
      <WizCard>
        <SummaryRow label="ロール"  value="農家" />
        <SummaryRow label="就農歴"  value={farmerExp} />
        <SummaryRow label="作物"    value={farmerCrop} />
        <SummaryRow label="作業"    value={farmerWork} />
        <SummaryRow label="地域"    value={farmerRegion || "未設定"} />
        <SummaryRow label="目的"    value={farmerPurpose==="post" ? "仕事を出す" : "オファー"} />
        <SummaryRow label="希望時給" value={farmerHourly ? `¥${parseFloat(farmerHourly).toLocaleString()}/h` : "未設定"} />
        <SummaryRow label="希望日給" value={farmerDaily ? `¥${parseFloat(farmerDaily).toLocaleString()}/日` : "未設定"} />
      </WizCard>
      <NavRow canNext={true} />
    </>);

    return wrap(<>
      <div style={{ textAlign:"center", paddingTop:16 }}>
        <div style={{ fontSize:64, marginBottom:20 }}>✅</div>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}>ありがとうございます</h2>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, marginBottom:28 }}>
          機能が正式リリースされた際にご案内します。<br/>
          それまでは月次記録を続けることで、<br/>優先案内の対象になります。
        </p>
        <button onClick={() => { setRole(""); setStep(0); }} className="btn-primary" style={{ padding:"16px 40px", fontSize:15, borderRadius:14 }}>ホームへ戻る</button>
      </div>
    </>);
  }

  // ── WORKER FLOW ──
  if (isWorker) {
    if (step === 1) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>農業経験を教えてください</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>経験は問いません。当てはまるものをお選びください</p>
      {["農業未経験","農業ボランティア経験あり","農業アルバイト経験あり","就農・研修経験あり"].map(v => (
        <CardBtn key={v} selected={workerExp===v} onClick={() => setWorkerExp(v)}>{v}</CardBtn>
      ))}
      <NavRow canNext={!!workerExp} />
    </>);

    if (step === 2) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>何をしたいですか？</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>あとから変更できます</p>
      <CardBtn selected={workerPurpose==="open"} onClick={() => setWorkerPurpose("open")}>
        📅 働ける日を公開する
        <p className="f-sans" style={{ fontSize:12, color:"#717171", marginTop:4, fontWeight:400 }}>農家からオファーを受けたい</p>
      </CardBtn>
      <CardBtn selected={workerPurpose==="search"} onClick={() => setWorkerPurpose("search")}>
        🔍 募集中の仕事を探す
        <p className="f-sans" style={{ fontSize:12, color:"#717171", marginTop:4, fontWeight:400 }}>自分から応募したい</p>
      </CardBtn>
      <NavRow canNext={!!workerPurpose} />
    </>);

    if (step === 3) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>働き手プロフィール</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>農家に見せる情報を入力してください</p>
      <WizCard>
        <div style={{ marginBottom:20 }}>
          <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>得意な作物</label>
          <PillSelect options={["トマト","キュウリ","ナス","イチゴ","米","なんでも"]} value={workerCrop} onSelect={setWorkerCrop} />
        </div>
        <div style={{ marginBottom:20 }}>
          <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>できる作業</label>
          <PillSelect options={["収穫","定植","選果","草刈り","農薬散布","梱包"]} value={workerWork} onSelect={setWorkerWork} />
        </div>
        <div>
          <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>活動地域</label>
          <input value={workerRegion} onChange={e => setWorkerRegion(e.target.value)} placeholder="例：徳島県内" className="field f-sans" style={{ fontSize:14 }} />
        </div>
      </WizCard>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>※ 本名・電話番号・詳細住所は表示されません</p>
      <NavRow canNext={true} />
    </>);

    if (step === 4) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>プロフィール確認</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>農家に表示される情報です</p>
      <WizCard>
        <SummaryRow label="経験" value={workerExp} />
        <SummaryRow label="作物" value={workerCrop || "未設定"} />
        <SummaryRow label="作業" value={workerWork || "未設定"} />
        <SummaryRow label="地域" value={workerRegion || "未入力"} />
        <SummaryRow label="目的" value={workerPurpose==="open" ? "働ける日を公開" : "募集を探す"} />
      </WizCard>
      <NavRow canNext={true} />
    </>);

    if (step === 5) {
      if (workerPurpose === "open") return wrap(<>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>希望条件を入力します</h2>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>これはプレビューです。実際の公開はまだ行いません</p>
        <WizCard>
          <div style={{ marginBottom:20 }}>
            <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>希望時給 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円）</span></label>
            <input type="number" value={workerHourly} onChange={e => setWorkerHourly(e.target.value)} placeholder="例：1200" className="field f-mono" style={{ fontSize:18, maxWidth:180 }} />
            <WageCompare type="時給" value={parseFloat(workerHourly)||0} avg={AVG_HOURLY} count={AVG_COUNT} />
          </div>
          <div style={{ marginBottom:20 }}>
            <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>希望日給 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円）</span></label>
            <input type="number" value={workerDaily} onChange={e => setWorkerDaily(e.target.value)} placeholder="例：9000" className="field f-mono" style={{ fontSize:18, maxWidth:180 }} />
            <WageCompare type="日給" value={parseFloat(workerDaily)||0} avg={AVG_DAILY} count={AVG_COUNT} />
          </div>
          <div style={{ marginBottom:16 }}>
            <label className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>日給の場合の想定勤務時間 <span style={{ fontSize:11, color:"#B0B0B0" }}>（時間）</span></label>
            <input type="number" value={workerHours} onChange={e => setWorkerHours(e.target.value)} placeholder="例：8" className="field f-mono" style={{ fontSize:18, maxWidth:140 }} />
            {workerDaily && workerHours && parseFloat(workerHours) > 0 && (
              <p className="f-sans" style={{ fontSize:11, color:"#717171", marginTop:4 }}>
                時給換算：<span className="f-mono" style={{ fontWeight:700 }}>¥{Math.round(parseFloat(workerDaily)/parseFloat(workerHours)).toLocaleString()}/h</span>
              </p>
            )}
          </div>
          <WageNote />
        </WizCard>
        <NavRow canNext={true} />
      </>);

      return wrap(<>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>仕事リスト（想定画面）</h2>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>実装後はこのような画面になる予定です</p>
        <div style={{ padding:"12px 16px", background:"#F7F7F7", borderRadius:12, marginBottom:12 }}>
          <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>📱 スマホ：地図→検索・絞込→リスト　🖥 PC：左に地図、右にリスト</p>
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:14, overflowX:"auto" }}>
          {["地域","作物","作業内容","日付","経験","報酬","移動手段"].map(f => (
            <span key={f} style={{ flexShrink:0, padding:"7px 14px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:11, color:"#717171" }}>{f}</span>
          ))}
        </div>
        {[
          { farm:"○○農園", crop:"トマト", work:"収穫・選果",   date:"7月上旬〜中旬", hourly:1200 },
          { farm:"△△農場", crop:"キュウリ", work:"収穫・定植", date:"6月〜9月",       hourly:1150 },
          { farm:"□□農業", crop:"イチゴ",  work:"収穫",        date:"11月〜3月",      hourly:1100 },
        ].map((j, i) => (
          <div key={i} style={{ padding:"16px 18px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
              <div>
                <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>{j.farm}</p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171" }}>{j.date}</p>
              </div>
              <p className="f-mono" style={{ fontSize:14, fontWeight:700, color:"#00A86B" }}>¥{j.hourly.toLocaleString()}/h</p>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[j.crop, j.work].map(t => <span key={t} style={{ padding:"3px 10px", borderRadius:20, background:"#F7F7F7", color:"#717171", fontSize:11 }}>{t}</span>)}
            </div>
          </div>
        ))}
        <NavRow canNext={true} />
      </>);
    }

    if (step === 6) return wrap(<>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>内容の確認</h2>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:24 }}>この内容で登録します（構想段階のため、実際の公開は行いません）</p>
      <WizCard>
        <SummaryRow label="ロール"   value="働き手" />
        <SummaryRow label="経験"     value={workerExp} />
        <SummaryRow label="作物"     value={workerCrop || "未設定"} />
        <SummaryRow label="作業"     value={workerWork || "未設定"} />
        <SummaryRow label="地域"     value={workerRegion || "未設定"} />
        <SummaryRow label="目的"     value={workerPurpose==="open" ? "働ける日を公開" : "募集を探す"} />
        <SummaryRow label="希望時給" value={workerHourly ? `¥${parseFloat(workerHourly).toLocaleString()}/h` : "未設定"} />
        <SummaryRow label="希望日給" value={workerDaily ? `¥${parseFloat(workerDaily).toLocaleString()}/日` : "未設定"} />
      </WizCard>
      <NavRow canNext={true} />
    </>);

    return wrap(<>
      <div style={{ textAlign:"center", paddingTop:16 }}>
        <div style={{ fontSize:64, marginBottom:20 }}>✅</div>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}>ありがとうございます</h2>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, marginBottom:28 }}>
          機能が正式リリースされた際にご案内します。<br/>
          作業内容・経験・勤務条件を見える化し、<br/>ミスマッチを減らす機能を順次開発しています。
        </p>
        <button onClick={() => { setRole(""); setStep(0); }} className="btn-primary" style={{ padding:"16px 40px", fontSize:15, borderRadius:14 }}>ホームへ戻る</button>
      </div>
    </>);
  }

  return null;
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

function OnboardingModal({ me, setMe, onComplete, isEditing = false, onClose }) {
  const totalSteps = 9;
  const [obStep, setObStep] = useState(1);
  const [obName,         setObName]         = useState(isEditing ? (me.name || "") : "");
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

  const canGoNext = [null, !!obName.trim(), !!obPrefecture, !!obMunicipality.trim(), !!obTier, !!obFarmingType, Number(obArea) > 0, obCrops.length > 0, obChannels.length > 0, true][obStep] ?? true;

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
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('farmers').upsert({
        email: user.email,
        auth_id: user.id,
        name: obName.trim(),
        prefecture: obPrefecture,
        municipality: obMunicipality.trim(),
        experience_tier: obTier,
        farming_type: obFarmingType,
        area_tan: String(parseFloat(obArea) || 0),
        planned_crops: uniqueCropsByCanonical(obCrops),
        sales_channels: obChannels,
      }, { onConflict: 'email' });
      if (!error) {
        try { localStorage.setItem('ob_farming_type', obFarmingType); } catch {}
        try { localStorage.setItem('ob_area_tan', obArea); } catch {}
        try { localStorage.setItem('ob_sales_channels', JSON.stringify(obChannels)); } catch {}
        const { data: farmer } = await supabase.from('farmers').select('*').eq('email', user.email).single();
        if (farmer) setMe(farmer);
        await onComplete({ name: obName.trim(), prefecture: obPrefecture, municipality: obMunicipality.trim(), experience_tier: obTier, planned_crops: uniqueCropsByCanonical(obCrops) });
      } else {
        console.error('onboarding save error:', error);
        alert(`保存に失敗しました。\n${error.message || JSON.stringify(error)}`);
      }
    } catch (e) {
      console.error('onboarding save exception:', e);
      alert(`保存に失敗しました。\n${e.message || String(e)}`);
    } finally {
      setSaving(false);
    }
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

    // 8: 確認画面
    <div style={{ maxWidth:400, margin:"0 auto", padding:24, background:"#F7F7F7", borderRadius:20 }}>
      <div style={{ textAlign:"center", marginBottom:20 }}>
        <div style={{ width:80, height:80, borderRadius:"50%", background:"#00A86B22", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px", fontSize:36 }}>🌾</div>
        <p className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222" }}>{obName}</p>
      </div>
      <div style={{ display:"grid", gap:12 }}>
        {[
          { icon:"📍", label:"都道府県", value: obPrefecture },
          { icon:"📍", label:"市区町村", value: obMunicipality },
          { icon:"📅", label:"就農歴", value: obTier },
          { icon:"🌾", label:"専業/兼業", value: obFarmingType === "fulltime" ? "専業農家" : "兼業農家" },
          { icon:"📐", label:"経営面積", value: obArea + " 反" },
        ].map(item => (
          <div key={item.label} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:"#fff", borderRadius:10 }}>
            <span style={{ fontSize:18 }}>{item.icon}</span>
            <span className="f-sans" style={{ fontSize:12, color:"#717171", width:80 }}>{item.label}</span>
            <span className="f-sans" style={{ fontSize:14, fontWeight:600, color:"#222" }}>{item.value}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop:12, display:"flex", flexWrap:"wrap", gap:6 }}>
        <span className="f-sans" style={{ fontSize:11, color:"#717171", marginRight:4 }}>栽培作物:</span>
        {obCrops.map(c => (
          <span key={c} style={{ padding:"4px 10px", background:"#E6F7EF", borderRadius:999, fontSize:12, color:"#00A86B", fontWeight:600 }}>{c}</span>
        ))}
      </div>
      <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:6 }}>
        <span className="f-sans" style={{ fontSize:11, color:"#717171", marginRight:4 }}>販売先:</span>
        {obChannels.map(s => {
          const ch = OB_SALES_CHANNELS.find(c => c.value === s);
          return (
            <span key={s} style={{ padding:"4px 10px", background:"#FEF3E2", borderRadius:999, fontSize:12, color:"#F5A623", fontWeight:600 }}>{ch ? ch.label : s}</span>
          );
        })}
      </div>
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
    {
      title:"プロフィール確認",
      sub:"内容をご確認ください",
      desc:"以下の内容で登録します。修正したい場合は「戻る」を押してください。",
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
          {saving ? "保存中..." : obStep === totalSteps ? "この内容で始める →" : "次へ →"}
        </button>
      </div>
    </div>
  );
}

// ── PrivacyPolicy ────────────────────────────────────────────
function PrivacyPolicy({ onClose }) {
  const sections = [
    { title:"1. 運営者・サービス概要", body:["日本農業研究所（以下「当研究所」）は、chitose-bank（以下「本サービス」）を運営し、農業経営データの記録・集計・資料作成支援を提供します。","本ポリシーは、本サービスが取得する情報の取り扱いについて定めます。"] },
    { title:"2. 取得する情報", body:["本サービスは、登録時に、氏名、メールアドレス、都道府県、市区町村、就農歴、専業兼業の別、経営面積、栽培作物、販売先分類等を取得します。","利用中に、売上データ（出荷箱数・単価）、経費データ（項目・金額）、出荷先情報、五年計画書の入力内容、プロフィール画像等を取得します。","また、アクセス日時、利用端末情報、操作ログ等を自動的に取得する場合があります。","今後、伝票写真のアップロード機能およびAI読取機能を追加する場合があります。その際は、本ポリシーを更新し、利用者に通知します。"] },
    { title:"3. 利用目的", body:["取得した情報は、利用者本人の経営記録の作成・表示、売上・経費データの本人確認・修正、重複・異常値・不正投稿の確認、個人が特定されにくいよう加工した集計データの作成、集計データのサイト上での表示、五年計画書の作成支援・PDF出力、サービスの改善・品質向上、将来の農業人材マッチング機能における貢献者特典の算定のために利用します。","利用目的を追加する場合は、利用者に通知し、必要に応じて同意を得ます。"] },
    { title:"4. 公開範囲", body:["本サービスが公開するデータは、個人、個別農家、個別取引、個別販売先が特定されにくいよう加工した、地域・品目・期間単位の集計値に限ります。","氏名、住所、電話番号、メールアドレス、口座番号、振込先、個別農家の売上・経費・利益・出荷量、販売先名・業者名・担当者名、アップロードされた画像・証憑資料は公開しません。なお、住所、口座番号、振込先等については、将来の証憑画像・伝票写真等に含まれる場合があります。","集計データは、原則として5農家以上のデータが集まるまで表示しません。5農家以上であっても、地域・品目等の組み合わせから個別農家が推定されるおそれがある場合は、表示しない、または地域・期間を広げる措置を行います。"] },
    { title:"5. 第三者提供", body:["当研究所は、利用者の個人データを、本人の同意なく第三者に提供しません。ただし、法令に基づく場合、人の生命・身体・財産の保護のために必要な場合を除きます。","利用者本人がPDF等をダウンロードし、金融機関・支援センター等に自ら提出する場合、当研究所による第三者提供には該当しません。","当研究所が、利用者に代わってJA、金融機関、行政機関、支援センター等へ個別データまたは個別レポートを提供する場合は、その都度、利用者本人の明示的な同意を得ます。"] },
    { title:"6. 外部サービス・委託先の利用", body:["本サービスは、認証、データ保存、メール送信、AI読取、保守運用等のため、必要な範囲で外部サービスまたは委託先を利用する場合があります。","この場合、当研究所は、委託先に対して必要かつ適切な監督を行い、利用目的の達成に必要な範囲を超えて情報を取り扱わせないよう管理します。"] },
    { title:"7. 安全管理", body:["当研究所は、取得した情報の漏えい、滅失、毀損を防ぐため、アクセス権限の制限、管理者操作ログの記録、通信の暗号化（HTTPS）、パスワードを保存しない認証方式（メールOTP）、管理画面へのアクセス制限、データベース・ストレージの権限管理等の措置を講じます。","個人情報、原本資料、個別収支、取引情報の漏えい、誤公開、不正閲覧のおそれがある場合は、速やかに公開停止、影響範囲確認、本人通知、必要な報告、再発防止を行います。"] },
    { title:"8. 保存期間", body:["利用者の経営記録は、利用中は保存します。退会後は、原則1か月以内に個人との紐づけを削除または解除します。","未確認の入力データは、30日以内に確定・修正・削除します。","操作ログは、3年を目安に保存します。","退会後の同意履歴・削除履歴については、法令対応・不正防止の目的で、最小限の記録を目的と期間を限定して保存する場合があります。"] },
    { title:"9. 利用者の権利", body:["利用者は、自己のデータの開示、訂正、削除、利用停止を請求できます。","請求は、本サービスのプロフィール画面の退会機能、または本ポリシー記載の問い合わせ先への連絡により行うことができます。"] },
    { title:"10. Cookieおよびローカルストレージ", body:["本サービスは、利用者の利便性向上のため、Cookieおよびブラウザのローカルストレージを使用する場合があります。認証情報の保持、入力内容の一時保存等に利用します。","Cookieまたはローカルストレージを無効化・削除した場合、一部機能が正常に動作しない場合があります。"] },
    { title:"11. 当サービスについて", body:["本サービス（chitose-bank）は銀行ではありません。預金、融資実行、為替取引、金融商品の販売は行いません。農業経営データの記録・集計・資料作成支援を目的とする情報サービスです。","表示されるデータ、集計値、シミュレーション、資料出力は、農業経営の判断を補助するための参考情報です。融資採択、補助金採択、収益改善を保証するものではありません。"] },
    { title:"12. お問い合わせ", body:["個人情報の取り扱いに関するお問い合わせ：t5fki6643qty@gmail.com"] },
    { title:"13. 改定", body:["本ポリシーは、サービスの発展・法令の改正に伴い改定する場合があります。重要な変更がある場合は、サイト上で利用者に通知します。"] },
  ];

  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"#fff", borderRadius:20, maxWidth:640, width:"100%", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 12px 48px rgba(0,0,0,0.15)" }}>
        <div style={{ padding:"28px 28px 16px", borderBottom:"1px solid #EBEBEB", position:"sticky", top:0, background:"#fff", borderRadius:"20px 20px 0 0", zIndex:1 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0 }}>プライバシーポリシー</h2>
            <button onClick={onClose} style={{ width:32, height:32, borderRadius:"50%", background:"#F7F7F7", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
          <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6 }}>日本農業研究所（chitose-bank） · 最終更新日：2026年5月25日</p>
        </div>
        <div style={{ padding:"24px 28px 36px" }}>
          {sections.map((s, i) => (
            <div key={i} style={{ marginBottom:24 }}>
              <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:8 }}>{s.title}</p>
              {s.body.map((p, j) => (
                <p key={j} className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, marginBottom:8 }}>{p}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── DataConstitution ─────────────────────────────────────────
function DataConstitution({ onClose }) {
  const articles = [
    { num:1,  title:"原本・証憑非公開の原則",   body:"手入力の根拠資料、伝票写真、精算書画像、その他の証憑資料は公開しない。証拠保管、再確認、読取精度向上、本人確認のためにのみ利用し、閲覧は本人、管理者、必要最小限の委託先に限る。" },
    { num:2,  title:"個人識別情報の保護",        body:"氏名、住所、電話番号、メールアドレス、口座番号、振込先、農園名、屋号、伝票番号、担当者名、その他個人または個別農家を識別しうる情報を、本人の同意なく公開・第三者提供しない。" },
    { num:3,  title:"個別収支の非公開",          body:"個別農家の売上、経費、利益、出荷量、販売先別実績を、本人の明示的な同意なく第三者に開示しない。" },
    { num:4,  title:"集計値のみ公開",            body:"公開するデータは、個人、個別農家、個別取引、個別販売先が特定されにくいよう加工した、地域・品目・期間単位の集計値に限る。" },
    { num:5,  title:"最低集計人数",              body:"地域・品目別の集計データは、原則5農家以上のデータが集まるまで表示しない。ただし、5農家以上であっても、地域・品目・面積・販売先等から特定の農家が推定されるおそれがある場合は、表示しない、または地域・期間・分類を広げる。" },
    { num:6,  title:"再特定リスクへの対応",      body:"特殊品目、小規模地域、少数出荷者、特徴的な販売条件など、匿名でも本人または個別農家が推定されうる場合は、広域化、期間拡大、分類変更、非表示により再特定リスクを下げる。" },
    { num:7,  title:"販売先情報の段階的公開",    body:"販売先名・業者名の公開は最終段階とし、データ密度、証拠水準、反論窓口、法務確認を条件とする。それまでは本人画面、内部集計、販売先分類での分析にのみ使用する。" },
    { num:8,  title:"未確認データの非確定",      body:"手入力データ、AI読取結果、アップロード資料から抽出されたデータは、本人確認または必要な確認手続きを経るまで確定データとして扱わない。未確認データを、外部公開、法人向け提供、販売先比較、信用判断用レポートに使用しない。" },
    { num:9,  title:"利用目的の事前明示",        body:"データの利用目的を事前に明示し、明示された目的の範囲を超えて利用しない。利用目的を追加する場合は、改めて本人に通知し、必要に応じて同意を得る。" },
    { num:10, title:"本人の権利保障と最小保存",  body:"本人からのデータ訂正、削除、利用停止の請求に応じる導線を常に用意する。退会後は、原則1か月以内に個人に紐づくデータを削除、または個人との紐づけを解除した統計データとして処理する。ただし、法令対応、不正防止、請求・同意履歴、運用上必要な最小限の記録は、目的と期間を限定して保存する。" },
    { num:11, title:"管理者閲覧の記録",          body:"管理者が原本資料、個別収支、個人識別情報、取引情報を閲覧・修正・承認した場合は、日時、対象データ、操作内容を記録する。" },
    { num:12, title:"漏えい・事故対応",          body:"個人情報、原本資料、個別収支、取引情報の漏えい、誤公開、不正閲覧のおそれがある場合は、速やかに公開停止、影響範囲確認、本人通知、必要な報告、再発防止を行う。" },
  ];

  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"#fff", borderRadius:20, maxWidth:640, width:"100%", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 12px 48px rgba(0,0,0,0.15)" }}>
        <div style={{ padding:"28px 28px 16px", borderBottom:"1px solid #EBEBEB", position:"sticky", top:0, background:"#fff", borderRadius:"20px 20px 0 0", zIndex:1 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0 }}>データ憲法</h2>
            <button onClick={onClose} style={{ width:32, height:32, borderRadius:"50%", background:"#F7F7F7", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
          <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6 }}>日本農業研究所（chitose-bank） v1.1 · 制定日：2026年5月25日</p>
        </div>
        <div style={{ padding:"24px 28px 36px" }}>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, marginBottom:24 }}>
            本文書は、日本農業研究所（chitose-bank）がデータを取り扱う上での基本原則を定めたものです。すべての機能開発・運用判断はこの原則に基づきます。
          </p>
          {articles.map(a => (
            <div key={a.num} style={{ marginBottom:20 }}>
              <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:6 }}>第{a.num}条　{a.title}</p>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9 }}>{a.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ProfileModal ─────────────────────────────────────────────
function ProfileModal({ me, recs, isContributor, avatarUrl, onClose, onEditProfile, onLogout, onAvatarChange }) {
  const [delConfirm, setDelConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const fileRef = useRef(null);

  const fid = me.id;
  const myRecs = Object.entries(recs)
    .filter(([k]) => k.startsWith(fid + "_"))
    .flatMap(([, v]) => v);
  const recCount = myRecs.length;
  const lastDates = myRecs.map(r => r.created_at).filter(Boolean);
  const lastDate = lastDates.length > 0
    ? new Date(Math.max(...lastDates.map(d => new Date(d)))).toLocaleDateString("ja-JP")
    : "未入力";

  const crops = Array.isArray(me.planned_crops) ? me.planned_crops : [];
  const farmType = me.farming_type || localStorage.getItem('ob_farming_type') || "";
  const areaTan = me.area_tan || localStorage.getItem('ob_area_tan') || "";
  const salesChannels = (me.sales_channels && Array.isArray(me.sales_channels) && me.sales_channels.length > 0)
    ? me.sales_channels
    : (() => { try { return JSON.parse(localStorage.getItem('ob_sales_channels') || '[]'); } catch { return []; } })();

  const SALES_LABELS = { ja:"JA出荷", market:"市場出荷", direct_store:"直売所", direct_trade:"直接取引", online:"ネット販売", undecided:"未定" };
  const TIER_LABELS = { "0":"未就農", "1-3":"1〜3年", "4-10":"4〜10年", "10+":"10年以上" };

  const displayUrl = avatarUrl || me.avatar_url || null;

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
    } catch (err) { console.error('Avatar delete error:', err); }
    setUploading(false);
  };

  const totalBoxes = myRecs.reduce((s, r) => s + (r.boxes || 0), 0);
  const uniqueMonths = new Set(myRecs.map(r => r.year + "-" + r.month)).size;
  const uniqueDests = new Set(myRecs.map(r => r.destId).filter(Boolean)).size;

  return (
    <div style={{ position:"fixed", inset:0, background:"#fff", zIndex:9000, overflowY:"auto" }}>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display:"none" }} onChange={handleFile} />

      {/* ヘッダーバー */}
      <div style={{
        position:"sticky", top:0, zIndex:1, background:"#fff",
        borderBottom:"1px solid #EBEBEB",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"12px 20px", height:56,
      }}>
        <button onClick={onClose} style={{
          background:"none", border:"none", fontSize:15, color:"#222",
          cursor:"pointer", padding:"4px 0", fontFamily:"inherit",
        }}>← 戻る</button>
        <span className="f-sans" style={{ fontSize:14, fontWeight:600, color:"#222" }}>プロフィール</span>
        <button onClick={onEditProfile} style={{
          background:"none", border:"none", fontSize:13, color:"#00A86B",
          cursor:"pointer", fontWeight:600, fontFamily:"inherit",
        }}>編集</button>
      </div>

      <div style={{ maxWidth:480, margin:"0 auto", padding:"24px 20px 40px" }}>

        {/* アバター + 名前 */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:28 }}>
          <div style={{ position:"relative", marginBottom:16 }}>
            <div
              onClick={displayUrl ? () => setShowLightbox(true) : undefined}
              style={{
                width:120, height:120, borderRadius:"50%",
                background:"#F7F7F7", border:"3px solid #fff",
                boxShadow:"0 4px 20px rgba(0,0,0,0.1)",
                display:"flex", alignItems:"center", justifyContent:"center",
                overflow:"hidden", fontSize:56, cursor: displayUrl ? "pointer" : "default",
              }}
            >
              {displayUrl
                ? <img src={displayUrl} alt="avatar" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                : getDefaultAvatar(me.id)
              }
            </div>
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
              position:"absolute", bottom:4, right:4,
              width:34, height:34, borderRadius:"50%",
              background:"#222", border:"2px solid #fff", color:"#fff",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:15, cursor:"pointer",
            }}>📷</button>
          </div>
          <h1 className="f-sans" style={{ fontSize:26, fontWeight:700, color:"#222", margin:"0 0 4px", textAlign:"center" }}>{me.name}</h1>
          <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", margin:0 }}>{me.email}</p>

          {/* バッジ */}
          <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap", justifyContent:"center" }}>
            <span style={{
              padding:"5px 14px", borderRadius:20, fontSize:11, fontWeight:700,
              background: isContributor ? "#E6F7EF" : "#FEF3E2",
              color: isContributor ? "#00A86B" : "#F5A623",
              border: isContributor ? "1px solid #00A86B33" : "1px solid #F5A62333",
            }}>{isContributor ? "✅ 貢献者" : "⚠ 入力で復活"}</span>
            <span style={{
              padding:"5px 14px", borderRadius:20, fontSize:11, fontWeight:600,
              background:"#F7F7F7", color:"#717171",
            }}>📧 メール認証済み</span>
          </div>
        </div>

        {/* 実績カード */}
        <div style={{
          display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10, marginBottom:24,
        }}>
          {[
            { label:"入力データ", value:recCount + "件", icon:"📋" },
            { label:"入力月数", value:uniqueMonths + "ヶ月", icon:"📅" },
            { label:"出荷先数", value:uniqueDests + "件", icon:"🚚" },
            { label:"最終入力日", value:lastDate, icon:"🕐" },
          ].map(stat => (
            <div key={stat.label} style={{
              padding:"16px", background:"#F7F7F7", borderRadius:16, textAlign:"center",
            }}>
              <div style={{ fontSize:22, marginBottom:6 }}>{stat.icon}</div>
              <p className="f-mono" style={{ fontSize:18, fontWeight:700, color:"#222", margin:"0 0 2px" }}>{stat.value}</p>
              <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:0 }}>{stat.label}</p>
            </div>
          ))}
        </div>

        {/* 基本情報セクション */}
        <div style={{ marginBottom:20 }}>
          <h2 className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:12 }}>基本情報</h2>
          <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, overflow:"hidden" }}>
            {[
              { icon:"🗾", label:"地域", value:(me.prefecture || "") + (me.municipality ? " " + me.municipality : "") || "未設定" },
              { icon:"📅", label:"就農歴", value:TIER_LABELS[me.experience_tier] || "未設定" },
              { icon:"🏠", label:"専業/兼業", value:farmType === "fulltime" ? "専業農家" : farmType === "parttime" ? "兼業農家" : "未設定" },
              { icon:"📐", label:"経営面積", value:areaTan ? areaTan + " 反" : "未設定" },
            ].map((item, i, arr) => (
              <div key={item.label} style={{
                display:"flex", alignItems:"center", gap:12,
                padding:"14px 18px",
                borderBottom: i < arr.length - 1 ? "1px solid #F7F7F7" : "none",
              }}>
                <span style={{ fontSize:18, width:24, textAlign:"center", flexShrink:0 }}>{item.icon}</span>
                <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", width:72, flexShrink:0 }}>{item.label}</span>
                <span className="f-sans" style={{ fontSize:14, color:"#222", fontWeight:500 }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 栽培作物セクション */}
        <div style={{ marginBottom:20 }}>
          <h2 className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:12 }}>栽培作物</h2>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {crops.length > 0
              ? crops.map(c => (
                  <span key={c} style={{
                    padding:"8px 16px", borderRadius:20,
                    background:"#E6F7EF", color:"#00A86B",
                    fontSize:13, fontWeight:600,
                  }}>{c}</span>
                ))
              : <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>未設定</span>
            }
          </div>
        </div>

        {/* 販売先セクション */}
        <div style={{ marginBottom:28 }}>
          <h2 className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:12 }}>販売先</h2>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {salesChannels.length > 0
              ? salesChannels.map(v => (
                  <span key={v} style={{
                    padding:"8px 16px", borderRadius:20,
                    background:"#F7F7F7", color:"#222",
                    fontSize:13, fontWeight:500,
                  }}>{SALES_LABELS[v] || v}</span>
                ))
              : <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>未設定</span>
            }
          </div>
        </div>

        {/* アクションセクション */}
        <div style={{ display:"grid", gap:10, marginBottom:20 }}>
          <button onClick={onEditProfile} className="btn-primary" style={{
            width:"100%", padding:"15px", fontSize:14, borderRadius:14,
          }}>プロフィールを編集する</button>

          {displayUrl && (
            <button onClick={handleDeleteAvatar} disabled={uploading} style={{
              width:"100%", padding:"13px", fontSize:13,
              background:"#fff", border:"1px solid #EBEBEB", borderRadius:14,
              color:"#717171", cursor:"pointer", fontFamily:"inherit",
            }}>プロフィール写真を削除</button>
          )}

        </div>

        {/* 退会セクション */}
        <div style={{ borderTop:"1px solid #EBEBEB", paddingTop:20 }}>
          {!delConfirm
            ? <button onClick={() => setDelConfirm(true)} className="f-sans" style={{
                width:"100%", padding:"12px", border:"none", background:"none",
                fontSize:13, color:"#E24B4A", cursor:"pointer", textAlign:"center",
              }}>退会する</button>
            : <div style={{ padding:20, background:"#FCEBEB", borderRadius:14, border:"1px solid #E24B4A22" }}>
                <p className="f-sans" style={{ fontSize:13, color:"#E24B4A", marginBottom:14, lineHeight:1.7, textAlign:"center" }}>
                  本当に退会しますか？<br/>データは30日以内に削除されます。
                </p>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => setDelConfirm(false)} style={{
                    flex:1, padding:"11px", background:"#fff", border:"1px solid #EBEBEB",
                    borderRadius:12, fontSize:13, cursor:"pointer", fontFamily:"inherit", color:"#222",
                  }}>キャンセル</button>
                  <button onClick={async () => { await supabase.auth.signOut(); onLogout(); }} style={{
                    flex:1, padding:"11px", background:"#E24B4A", color:"#fff", border:"none",
                    borderRadius:12, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                  }}>退会する</button>
                </div>
              </div>
          }
          <button onClick={() => { if (window.confirm("ログアウトしますか？")) onLogout(); }} className="f-sans" style={{
            width:"100%", padding:"12px", border:"none", background:"none",
            fontSize:12, color:"#B0B0B0", cursor:"pointer", textAlign:"center", marginTop:8,
          }}>ログアウト</button>
        </div>
      </div>

      {/* ライトボックス */}
      {showLightbox && displayUrl && (
        <div onClick={() => setShowLightbox(false)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", animation:"fadeIn .2s ease",
        }}>
          <button onClick={e => { e.stopPropagation(); setShowLightbox(false); }} style={{
            position:"absolute", top:20, right:20,
            width:40, height:40, borderRadius:"50%",
            background:"rgba(255,255,255,0.15)", border:"none",
            color:"#fff", fontSize:22, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>✕</button>
          <img src={displayUrl} alt="avatar full" onClick={e => e.stopPropagation()}
            style={{ maxWidth:"90vw", maxHeight:"90vh", objectFit:"contain", borderRadius:4, cursor:"default" }} />
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
  const [showLanding,setShowLanding]=useState(true);
  const [showTerms,setShowTerms]=useState(false);
  const [showConstitution,setShowConstitution]=useState(false);
  const [showPrivacy,setShowPrivacy]=useState(false);
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
  useEffect(() => {
    const onError = (event) => {
      logAppError({ source: "window.onerror", component: "global", action: "runtime_error", error: event.error || { message: event.message }, userId: me?.id || null });
    };
    const onUnhandled = (event) => {
      logAppError({ source: "unhandledrejection", component: "global", action: "promise_rejection", error: event.reason, userId: me?.id || null });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onUnhandled); };
  }, [me?.id]);
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
        r[k].push({ id: rec.id, destId: rec.dest_id, boxes: rec.boxes, ppb: rec.ppb, costs: rec.costs || [], crop: rec.crop, variety: rec.variety, is_brand: rec.is_brand, created_at: rec.created_at });
      });
    }
    setFarmers(f);setFarmPend(fp);setDestOk(da);setDestPend(dp);setRecs(r);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const loggedIn = f.find(x => x.email?.toLowerCase() === session.user.email?.toLowerCase());
      if (loggedIn) { setMe({ ...loggedIn, id: session.user.id }); setTab("board"); }
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setMe(null);
    setTab("board");
    setShowLanding(true);
    localStorage.removeItem('sb-aegwepgtmwcnwzybpgsh-auth-token');
    window.location.reload();
  };

  const completeOnboarding=useCallback(async(updates)=>{
    // TODO: 一般ユーザーではfarmers全件取得を避け、本人行のみ取得する
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
    const newEntry = { ...e, id: Math.random().toString(36).slice(2,11), created_at: new Date().toISOString() };
    const newRecs={...recs,[k]:[...(recs[k]||[]),newEntry]};
    const { data: insertedData, error } = await supabase.from('records').insert({
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
    }).select().single();
    if (error) { console.error('records insert error:', error); return; }
    if (insertedData) {
      const finalEntry = { ...newEntry, id: insertedData.id, created_at: insertedData.created_at };
      const finalRecs = {...recs,[k]:[...(recs[k]||[]),finalEntry]};
      setRecs(finalRecs);
    }

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

  const deleteRec = useCallback(async (fid, yr, mi, recId) => {
    const { error } = await supabase.from('records').delete().eq('id', recId);
    if (error) { console.error('record delete error:', error); return; }
    const k = fid + "_" + yr + "_" + mi;
    setRecs(prev => ({
      ...prev,
      [k]: (prev[k] || []).filter(r => r.id !== recId),
    }));
  }, []);

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
    {k:"labor",l:"人手確保"},
    {k:"input",l:!me?"新規登録・ログイン":isMember?"データ入力":"🔒 データ入力",locked:!isMember},
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
          {k:"labor", icon:"🤝", l:"人手確保"},
          {k:"input", icon:"✏️", l:me?"入力":"新規登録"},
          ...(isMember?[{k:"plan", icon:"📋", l:"計画書"}]:[]),
          ...(me?.email===ADMIN_EMAIL?[{k:"admin", icon:"⚙️", l:"管理"}]:[]),
        ].map(({k,icon,l})=>(
          <button key={k} onClick={()=>setTab(k)} className={tab===k?"active":""}
            style={k==="input"&&tab!==k?{color:"#00A86B"}:undefined}>
            <span className="icon">{icon}</span>
            {l}
          </button>
        ))}
      </div>

      {/* ── MAIN ── */}
      <main style={{maxWidth:920,margin:"0 auto",padding:"32px 24px 72px"}}>
        {tab==="board"&&<BoardTab farmers={farmers} destApproved={destOk} records={recs} userLevel={userLevel} onLogin={()=>setTab("input")} me={me} onGoPlan={()=>setTab("plan")} onShowConstitution={()=>setShowConstitution(true)} onShowTerms={()=>setShowTerms(true)} onShowPrivacy={()=>setShowPrivacy(true)}/>}
        {tab==="labor"&&<LaborTab farmersCount={farmers.length} onLogin={()=>setTab("input")} />}
        {tab==="input"&&(me
          ? <InputTab loggedInFarmer={me} destApproved={destOk} destPending={destPend}
              records={recs} onAddRecord={addRec} onSubmitDest={subDest} onGoBoard={()=>setTab("board")} onDeleteRec={deleteRec}/>
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

      {/* ── FOOTER（固定） ── */}
      <footer className="site-footer-fixed">
        <div className="footer-inner">
          <span className="f-sans footer-copy">
            © {THIS_YEAR} chitose-bank · 吉野川農家 記録プロジェクト
          </span>
          <div className="footer-links">
            <button onClick={()=>setShowTerms(true)} className="f-sans" style={{
              fontSize:11, color:"#717171", background:"none", border:"none",
              cursor:"pointer", textDecoration:"underline", textUnderlineOffset:3, padding:0,
            }}>利用規約</button>
            <button onClick={()=>setShowConstitution(true)} className="f-sans" style={{
              fontSize:11, color:"#717171", background:"none", border:"none",
              cursor:"pointer", textDecoration:"underline", textUnderlineOffset:3, padding:0,
            }}>データ憲法</button>
            <button onClick={()=>setShowPrivacy(true)} className="f-sans" style={{
              fontSize:11, color:"#717171", background:"none", border:"none",
              cursor:"pointer", textDecoration:"underline", textUnderlineOffset:3, padding:0,
            }}>プライバシーポリシー</button>
          </div>
          <p className="f-sans footer-note">
            chitose-bankは銀行ではありません。表示データは参考情報であり、融資採択・補助金採択・収益改善を保証しません。
          </p>
        </div>
      </footer>
      {!me&&showLanding&&(
        <LandingFlow
          onComplete={()=>setShowLanding(false)}
          onSkip={()=>{setShowLanding(false);setTab("input");}}
          onLogin={()=>{setShowLanding(false);setTab("input");}}
        />
      )}
      {showTerms&&<Terms onClose={()=>setShowTerms(false)}/>}
      {showConstitution&&<DataConstitution onClose={()=>setShowConstitution(false)}/>}
      {showPrivacy&&<PrivacyPolicy onClose={()=>setShowPrivacy(false)}/>}
      {me&&((!me.name?.trim()||!me.prefecture)||showOnboarding)&&(
        <OnboardingModal
          key={obModalKey}
          me={me}
          setMe={setMe}
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
          onLogout={handleLogout}
          onAvatarChange={url=>setAvatarUrl(url)}
        />
      )}
    </div>
  );
}
