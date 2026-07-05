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
// 管理者判定（届出後にゲートを外す際はここを変更する。保存・入力機能のゲートにも使用）
const isAdmin = (user) => user?.email === ADMIN_EMAIL;

// ── DEV バッジ（原因特定用・確認後削除） ─────────────────────
const DEV_V = "2026-06-04";

function isAdminDebugEnabled() {
  try {
    return localStorage.getItem("cb_admin_debug") === "1";
  } catch {
    return false;
  }
}

function DevBadge({ label }) {
  if (!isAdminDebugEnabled()) return null;

  return (
    <div style={{
      position:"fixed",
      top:8,
      left:8,
      zIndex:99999,
      background:"#111",
      color:"#fff",
      fontSize:11,
      padding:"4px 8px",
      borderRadius:999,
      pointerEvents:"none",
    }}>
      DEV: {label} v{DEV_V}
    </div>
  );
}

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
  background: var(--mode-accent, #00A86B);
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
  main { padding: 10px 12px 90px !important; }
  .ledger-card { padding: 16px !important; }
}

/* ── Job search layout ── */
.job-search-layout {
  display: block;
}

/* ── Job detail main info card ── */
.job-detail-main-card {
  width: 50%;
  max-width: 440px;
}
@media (max-width: 759px) {
  .job-detail-main-card {
    width: 100%;
    max-width: none;
  }
}

/* ── Job detail key info: 3x2 grid (Airbnb-style label/value cells) ── */
.job-detail-info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
@media (max-width: 759px) {
  .job-detail-info-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 作物選択カード（Airbnb型・ホバーで枠濃く＋浮く） */
.crop-card {
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.crop-card:hover {
  border-color: #B0B0B0;
  box-shadow: 0 6px 16px rgba(0,0,0,0.10);
  transform: translateY(-2px);
}
/* ── Step0 説明ページ: 左右5:5、狭い画面で縦積み ── */
.step0-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  align-items: center;
}
@media (max-width: 759px) {
  .step0-grid {
    grid-template-columns: 1fr;
  }
}

/* ── Review header: profile (subtle) left / rating (hero) center ── */
.review-header-row {
  display: flex;
  align-items: center;
}
.review-header-profile { flex: 1; }
.review-header-stars { flex: 1; text-align: center; }
.review-header-spacer { flex: 1; }
@media (max-width: 759px) {
  .review-header-row {
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .review-header-stars { order: 1; }
  .review-header-profile { order: 2; justify-content: center; }
  .review-header-spacer { display: none; }
}

/* ── Job detail: 2-column layout (left info / right apply panel) ── */
.job-detail-2col {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(300px, 0.8fr);
  gap: 24px;
}
@media (max-width: 759px) {
  .job-detail-2col {
    grid-template-columns: 1fr;
  }
}

/* ── 応募パネルが画面外に出た時のPC専用下固定バー（スマホは既存の縦積み導線のため非表示） ── */
.pc-apply-bar {
  display: flex;
}
@media (max-width: 759px) {
  .pc-apply-bar {
    display: none;
  }
}

/* ── LandingFlow Step6 grid ── */
.lf-map-hero { height: 360px; }
.lf-preview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(300px, 0.8fr);
  gap: 24px;
  align-items: start;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
}
@media (max-width: 800px) {
  .lf-map-hero { height: 240px; }
  .lf-preview-grid { grid-template-columns: 1fr; }
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
    padding: 6px 10px;
  }
  .site-footer-fixed .footer-inner {
    justify-content: center;
    gap: 4px 10px;
  }
  .site-footer-fixed .footer-copy {
    font-size: 10px;
  }
  .site-footer-fixed .footer-links {
    gap: 12px;
  }
  .site-footer-fixed .footer-links button {
    font-size: 9px;
  }
  .site-footer-fixed .footer-note {
    font-size: 9px;
    margin: 2px 0 0;
    line-height: 1.4;
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
  background: var(--mode-accent, #00A86B);
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 13px 24px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .02em;
}
.btn-primary:hover, .btn-dark:hover { filter: brightness(0.92); }
.btn-primary:active, .btn-dark:active { filter: brightness(0.85); }
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
function LoginScreen({ farmers, onLogin, onGoRegister, onNeedRole }) {
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
    // 既存プロフィールを確認するだけ。作らない・書き換えない（登録は#/roleの役割選択経由のみ・骨格⑥）
    const { data: farmer } = await supabase
      .from("farmers")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (farmer) {
      onLogin({
        ...farmer,
        id: farmer.auth_id || data.user.id,
        joinedYear: farmer.joined_year,
        planned_crops: farmer.planned_crops || [],
        sales_channels: farmer.sales_channels || [],
      });
      return;
    }
    // workers行チェックはC（働き手登録の配線）で追加予定
    // プロフィール無し＝初回 → 役割選択の部屋へ
    if (onNeedRole) onNeedRole();
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

// ── RoleSelectScreen — 初回ログイン後の役割選択（骨格⑥）──────
function RoleSelectScreen({ onGoLogin, onRegistered }) {
  const [sess, setSess] = useState(undefined); // undefined=確認中 / null=未ログイン
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSess(session ?? null));
  }, []);
  const pick = async (role) => {
    if (busy || !sess) return;
    setBusy(true); setErr("");
    const email = (sess.user.email || "").toLowerCase();
    const baseName = email.split("@")[0];
    if (role === "farmer") {
      const { data, error } = await supabase.from("farmers")
        .insert({ email, auth_id: sess.user.id, name: baseName, status: "pending" })
        .select().single();
      setBusy(false);
      if (error) { setErr("登録に失敗しました：" + error.message); return; }
      onRegistered({ ...data, id: data.auth_id || sess.user.id, joinedYear: data.joined_year, planned_crops: data.planned_crops || [], sales_channels: data.sales_channels || [] }, "farmer");
    } else {
      const { data, error } = await supabase.from("workers")
        .insert({ auth_id: sess.user.id, name: baseName })
        .select().single();
      setBusy(false);
      if (error) { setErr("登録に失敗しました：" + error.message); return; }
      onRegistered({ id: sess.user.id, name: data.name, region: data.region || "", experience: data.experience || "", isWorker: true }, "worker");
    }
  };
  if (sess === undefined) return <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:13,color:"#B0B0B0"}}>確認中…</p></div>;
  if (!sess) return (
    <div style={{textAlign:"center",padding:"80px 24px"}}>
      <p className="f-sans" style={{fontSize:14,color:"#717171"}}>先にログインしてください</p>
      <button onClick={onGoLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button>
    </div>
  );
  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"48px 24px",textAlign:"center"}}>
      <h2 className="f-sans" style={{fontSize:22,fontWeight:800,color:"#222",marginBottom:8}}>どちらで始めますか？</h2>
      <p className="f-sans" style={{fontSize:13,color:"#717171",marginBottom:32}}>あとからもう一方を追加することもできます。</p>
      {err && <p className="f-sans" style={{fontSize:12,color:"#E24B4A",marginBottom:16}}>{err}</p>}
      <div style={{display:"grid",gap:16}}>
        <button disabled={busy} onClick={()=>pick("farmer")} className="f-sans" style={{padding:"28px 24px",border:"1px solid #EBEBEB",borderRadius:16,background:"#fff",cursor:busy?"wait":"pointer",textAlign:"left",opacity:busy?0.6:1}}>
          <span style={{fontSize:28,display:"block",marginBottom:8}}>🧑‍🌾</span>
          <span className="f-sans" style={{fontSize:16,fontWeight:700,color:"#222",display:"block",marginBottom:4}}>農家として始める</span>
          <span className="f-sans" style={{fontSize:12,color:"#717171"}}>求人を出して、働き手を募集する（運営の審査あり）</span>
        </button>
        <button disabled={busy} onClick={()=>pick("worker")} className="f-sans" style={{padding:"28px 24px",border:"1px solid #EBEBEB",borderRadius:16,background:"#fff",cursor:busy?"wait":"pointer",textAlign:"left",opacity:busy?0.6:1}}>
          <span style={{fontSize:28,display:"block",marginBottom:8}}>🙋</span>
          <span className="f-sans" style={{fontSize:16,fontWeight:700,color:"#222",display:"block",marginBottom:4}}>働き手として始める</span>
          <span className="f-sans" style={{fontSize:12,color:"#717171"}}>農作業の仕事をさがして応募する</span>
        </button>
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
function Carousel({ children, style, className, wrapperStyle, onScroll }) {
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

  const handleScroll = e => { updatePos(); onScroll && onScroll(e); };

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
      <div ref={ref} className={className} style={style} onScroll={handleScroll}>
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

  const [farmerCount, setFarmerCount] = useState(null);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('public_farmers_count');
      if (!error && data != null) setFarmerCount(data);
    })();
  }, []);

  const [regionList, setRegionList] = useState([]);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('board_region_list');
      if (!error) setRegionList(data ?? []);
    })();
  }, []);

  const [cropSummary, setCropSummary] = useState([]);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('board_crop_summary');
      if (!error) setCropSummary(data ?? []);
    })();
  }, []);

  const [destSummary, setDestSummary] = useState([]);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('board_dest_summary');
      if (!error) setDestSummary(data ?? []);
    })();
  }, []);

  const [cropNames, setCropNames] = useState([]);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('board_crop_names');
      if (!error) setCropNames((data ?? []).map(r => r.crop));
    })();
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

  // 作物別集計（DB集計関数 board_crop_summary の結果をそのまま使用）
  const cropCards = cropSummary.map(s => ({
    crop: s.crop, count: s.farmer_count, medRev: s.med_rev, medCost: s.med_cost, medProfit: s.med_profit, medRate: s.med_rate,
  }));

  // 出荷先別集計（DB集計関数 board_dest_summary の結果をそのまま使用。名前は既存のdestMapで変換）
  const destCards = destSummary.map(s => ({
    destId: s.dest_id, name: destMap[s.dest_id]?.name || "不明", count: s.farmer_count, medRate: s.med_rate, medRev: s.med_rev, medCost: s.med_cost,
  }));

  const sq = searchQuery.trim().toLowerCase();
  const filteredCropCards = sq ? cropCards.filter(c => fuzzyMatch(sq, c.crop)) : cropCards;
  const filteredDestCards = sq ? destCards.filter(d => fuzzyMatch(sq, d.name)) : destCards;

  const isFiltered = selectedCrop !== 'すべて';
  const hasNoData = filteredCropCards.length === 0 && filteredDestCards.length === 0;

  const lastUpdated = new Date().toLocaleDateString("ja-JP", { year:"numeric", month:"2-digit", day:"2-digit" });
  const regionText = regionList.length > 0 ? "（" + regionList.slice(0,3).map(r => r.municipality).join("・") + "）" : "";

  return (
    <div className="appear">
      <DevBadge label="BoardTab(公開ボード)" />

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
        {['すべて', ...cropNames].map(crop => {
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
          現在 <strong style={{ color:C.bamboo }}>{farmerCount != null ? farmerCount : farmers.length}</strong> 名の農家が参加中{regionText}
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
              ? <p className="f-sans" style={{ fontSize:12, color:C.ghost, padding:"20px 0" }}>データ収集中です（5農家以上のデータが集まると表示されます）</p>
              : <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:8 }}>
                  {filteredCropCards.map(c => {
                    return (
                      <div key={c.crop} style={{
                        flexShrink:0, width:200, padding:"18px 18px 16px",
                        background:C.cream, border:`1px solid ${C.rule}`, borderRadius:16,
                        boxShadow:"0 1px 6px rgba(8,6,4,.05)",
                      }}>
                        <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:C.ink, marginBottom:4 }}>{c.crop}</p>
                        <p className="f-sans" style={{ fontSize:10, color:C.ghost, marginBottom:12 }}>{c.count}農家が入力</p>
                        <div style={{ display:"grid", gap:6 }}>
                          {[{l:"売上中央値",v:man(c.medRev),col:C.bamboo},{l:"経費中央値",v:man(c.medCost),col:C.gold},{l:"利益中央値",v:man(c.medProfit),col:c.medProfit>=0?C.bamboo:C.shu},{l:"経費率中央値",v:`${c.medRate}%`,col:C.mid}].map(row => (
                            <div key={row.l} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                              <span className="f-sans" style={{ fontSize:9, color:C.ghost }}>{row.l}</span>
                              <span className="f-mono" style={{ fontSize:13, fontWeight:600, color:row.col }}>{row.v}</span>
                            </div>
                          ))}
                        </div>
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
              ? <p className="f-sans" style={{ fontSize:12, color:C.ghost, padding:"20px 0" }}>データ収集中です（5農家以上のデータが集まると表示されます）</p>
              : <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:8 }}>
                  {filteredDestCards.map(d => {
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
                        <BalanceSheet
                          revenue={d.medRev}
                          costs={[{l:"経費(中央値)", a: d.medCost}]}
                          compact={true}
                        />
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

  const myRecordLists = Object.entries(records)
    .filter(([k]) => k.startsWith(loggedInFarmer.id + "_"))
    .map(([, v]) => v);

  const knownCrops=[...new Set(
    myRecordLists.flat().map(r=>r.crop).filter(Boolean)
  )];

  const knownVarieties=(cropName)=>[...new Set(
    myRecordLists.flat().filter(r=>r.crop===cropName&&r.variety).map(r=>r.variety)
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

// ── JobSearchMapView ────────────────────────────────────────
// 「募集中の仕事を探す」画面。LandingFlow・LaborTab 両方で使用。
// 将来: Google Maps / Mapbox / Leaflet に差し替え可能な構造にしてある。
const JOB_SEARCH_SAMPLES = []; // 役所説明用ダミーは撤去。さがすはjobs_public(実データ)のみ表示

// 応募パネルの「最高額」自動計算（段階2-a・ダミー前提）
// workTime "8:00〜16:00" / dateLabel "6/10〜6/13" or "6/15" を想定。フォーマット外は null を返す
function calcMaxPay(job) {
  const timeMatch = /^(\d{1,2}):(\d{2})〜(\d{1,2}):(\d{2})$/.exec(job.workTime || "");
  const dateMatch = /^(\d{1,2})\/(\d{1,2})(?:〜(\d{1,2})\/(\d{1,2}))?$/.exec(job.dateLabel || "");
  if (!dateMatch) return null;

  const [, m1, d1, m2, d2] = dateMatch;
  let days = 1;
  if (m2 && d2) {
    const start = new Date(2026, Number(m1) - 1, Number(d1));
    const end = new Date(2026, Number(m2) - 1, Number(d2));
    days = Math.round((end - start) / 86400000) + 1;
  }
  if (!Number.isFinite(days) || days < 1) return null;

  if (job.payType === "daily") {
    return job.pay * days;
  }
  if (job.payType === "hourly") {
    if (!timeMatch) return null;
    const [, h1, mi1, h2, mi2] = timeMatch;
    const startH = Number(h1) + Number(mi1) / 60;
    const endH = Number(h2) + Number(mi2) / 60;
    const BREAK_HOURS = 1; // 休憩1hダミー
    const workHours = endH - startH - BREAK_HOURS;
    if (!Number.isFinite(workHours) || workHours <= 0) return null;
    return Math.round(job.pay * workHours * days);
  }
  return null;
}

// 読み書き両用カレンダー（モジュールレベル・入力側と詳細表示側で共有）
function CalendarView({ start, end, readOnly = false, onSelect }) {
  const WD_CV = ["日","月","火","水","木","金","土"];
  const isSameDayCV = (a, b) => a && b && a.toDateString() === b.toDateString();
  const initY = start ? start.getFullYear() : new Date().getFullYear();
  const initM = start ? start.getMonth() : new Date().getMonth();
  const [cvYear, setCvYear] = useState(initY);
  const [cvMonth, setCvMonth] = useState(initM);
  useEffect(() => {
    if (start) { setCvYear(start.getFullYear()); setCvMonth(start.getMonth()); }
  }, [start ? start.getTime() : null]);
  const firstDay = new Date(cvYear, cvMonth, 1).getDay();
  const daysInMonth = new Date(cvYear, cvMonth + 1, 0).getDate();
  const prevMo = () => { if (cvMonth===0){ setCvYear(y=>y-1); setCvMonth(11);} else setCvMonth(m=>m-1); };
  const nextMo = () => { if (cvMonth===11){ setCvYear(y=>y+1); setCvMonth(0);} else setCvMonth(m=>m+1); };
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let dd = 1; dd <= daysInMonth; dd++) cells.push(dd);
  return (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:14, marginTop:8 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <button onClick={prevMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:14 }}>{"‹"}</button>
        <span className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>{cvYear}年{cvMonth+1}月</span>
        <button onClick={nextMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:14 }}>{"›"}</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:8 }}>
        {WD_CV.map(wd => <div key={wd} style={{ textAlign:"center", fontSize:10, color:"#B0B0B0", padding:"3px 0" }}>{wd}</div>)}
        {cells.map((dd, i) => {
          if (!dd) return <div key={`e${i}`} />;
          const dt = new Date(cvYear, cvMonth, dd);
          const isStart = isSameDayCV(dt, start);
          const isEnd = isSameDayCV(dt, end);
          const inRange = start && end && dt > start && dt < end;
          return (
            <button key={dd} onClick={readOnly ? undefined : () => onSelect && onSelect(dt)} style={{
              padding:"7px 2px", borderRadius:8, border:"none", cursor: readOnly ? "default" : "pointer", fontSize:13, textAlign:"center",
              background: (isStart||isEnd) ? "#00A86B" : inRange ? "#E6F7EF" : "transparent",
              color: (isStart||isEnd) ? "#fff" : inRange ? "#00A86B" : "#222",
              fontWeight: (isStart||isEnd) ? 700 : 400,
            }}>{dd}</button>
          );
        })}
      </div>
      {!readOnly && <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", marginTop:6, textAlign:"center" }}>終了日を選ばない場合は、1日募集として扱います</p>}
    </div>
  );
}

// 持ち物名→絵文字の対応表（段階2-a・ガワのみ）。無い語は汎用アイコン📦にフォールバック
const ITEM_ICONS = {
  "長靴":"👢", "軍手":"🧤", "帽子":"🧢", "飲み物":"🥤",
  "タオル":"🧻", "動きやすい服":"👕", "雨具":"🌂", "日焼け止め":"🧴",
};

// 給与表示ラベル（時給/日給）。JobSearchMapView・FarmerDashboard共通
function payLabel(j) { return j.payType === "hourly" ? `時給${j.pay.toLocaleString()}円` : `日給${j.pay.toLocaleString()}円`; }

function ChatView({ applicationId, onBack }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [myId, setMyId] = useState(null);
  const load = async () => {
    try {
      const { data } = await supabase.from("messages").select("*").eq("application_id", applicationId).order("created_at",{ascending:true});
      if (data) setMsgs(data);
    } catch {}
  };
  useEffect(() => {
    (async () => {
      try { const { data:{ session } } = await supabase.auth.getSession(); if (session) setMyId(session.user.id); } catch {}
      load();
    })();
  }, [applicationId]);
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const { data:{ session } } = await supabase.auth.getSession();
      if (!session) { setSending(false); return; }
      const { error } = await supabase.from("messages").insert({ application_id: applicationId, sender_id: session.user.id, body: text.trim() });
      if (!error) { setText(""); await load(); }
    } catch {}
    setSending(false);
  };
  return (
    <div style={{ maxWidth:600, margin:"0 auto", display:"flex", flexDirection:"column", height:"70vh" }}>
      <button onClick={onBack} className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:13, cursor:"pointer", padding:"8px 0", textAlign:"left" }}>← 戻る</button>
      <div style={{ flex:1, overflowY:"auto", padding:"12px 0", display:"flex", flexDirection:"column", gap:8 }}>
        {msgs.length === 0 ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#B0B0B0", fontSize:13, marginTop:40 }}>まだメッセージはありません。<br/>打ち合わせや面接の連絡は、ここで行えます。</p>
        ) : msgs.map(m => (
          <div key={m.id} style={{ alignSelf: m.sender_id===myId ? "flex-end" : "flex-start", maxWidth:"75%", padding:"10px 14px", borderRadius:14, fontSize:14, background: m.sender_id===myId ? "#00A86B" : "#F0F0F0", color: m.sender_id===myId ? "#fff" : "#222" }} className="f-sans">{m.body}</div>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, padding:"12px 0", borderTop:"1px solid #EEE" }}>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") send(); }} placeholder="メッセージを入力" className="field f-sans" style={{ flex:1, fontSize:14 }} />
        <button onClick={send} disabled={sending} className="f-sans" style={{ padding:"10px 20px", fontSize:14, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{sending?"...":"送信"}</button>
      </div>
    </div>
  );
}

function WorkerProfileEdit({ me }) {
  const [nickname, setNickname] = useState("");
  const [pr, setPr] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("worker_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (data) { setNickname(data.nickname || ""); setPr(data.pr || ""); setAvatarUrl(data.avatar_url || ""); }
      } catch {}
      setLoading(false);
    })();
  }, []);
  // 任意形式の画像をCanvasでjpegに統一変換（heic以外の全形式に対応・バケット制限も回避）
  const convertToJpeg = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 512; // アイコンなので512pxに縮小（容量削減）
      let { width, height } = img;
      if (width > height && width > max) { height = Math.round(height * max / width); width = max; }
      else if (height > max) { width = Math.round(width * max / height); height = max; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => { if (blob) resolve(blob); else reject(new Error('変換に失敗')); }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この形式は読み込めません（iPhoneのHEIC等は非対応）')); };
    img.src = url;
  });
  const handleAvatar = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }
      let blob;
      try { blob = await convertToJpeg(file); }
      catch (convErr) { setUploading(false); alert(convErr.message || "この画像形式は対応していません。JPEG・PNG・WebP等をお試しください。"); return; }
      // 拡張子はjpg固定（変換後は必ずjpeg）。旧ファイルが別拡張子で残っていれば掃除
      try {
        const { data: olds } = await supabase.storage.from('avatars').list("worker/" + session.user.id);
        if (olds && olds.length > 0) {
          const paths = olds.map(f => "worker/" + session.user.id + "/" + f.name);
          await supabase.storage.from('avatars').remove(paths);
        }
      } catch {}
      const path = "worker/" + session.user.id + "/avatar.jpg";
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) { setUploading(false); alert("アップロードに失敗しました：" + upErr.message); return; }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = (urlData?.publicUrl || '') + "?t=" + Date.now();
      await supabase.from('worker_profiles').upsert({ auth_id: session.user.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl(url);
    } catch { alert("画像のアップロードに失敗しました。"); }
    setUploading(false);
  };
  const handleDeleteAvatar = async () => {
    if (!avatarUrl || uploading) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }
      const { data: files } = await supabase.storage.from('avatars').list("worker/" + session.user.id);
      if (files && files.length > 0) {
        const paths = files.map(f => "worker/" + session.user.id + "/" + f.name);
        await supabase.storage.from('avatars').remove(paths);
      }
      await supabase.from('worker_profiles').upsert({ auth_id: session.user.id, avatar_url: '', updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl('');
    } catch { alert("削除に失敗しました。"); }
    setUploading(false);
  };
  const save = async () => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      const { error } = await supabase.from("worker_profiles").upsert({ auth_id: session.user.id, nickname: nickname.trim(), pr: pr.trim(), updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setSaving(false);
      if (!error) { setSaved(true); setTimeout(()=>setSaved(false), 2000); }
      else alert("保存に失敗しました：" + error.message);
    } catch { setSaving(false); alert("保存に失敗しました。"); }
  };
  if (loading) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>;
  return (
    <div style={{ marginTop:32, paddingTop:32, borderTop:"1px solid #EEE" }}>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", letterSpacing:".08em", marginBottom:4 }}>働き手プロフィール</p>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>求人に応募したとき、農家に伝わる自己紹介です。任意で入力できます。</p>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>アイコン</label>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", background:"#E6F7EF", border:"1.5px solid #00A86B", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0 }}>
          {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:28 }}>🧑‍🌾</span>}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <label className="f-sans" style={{ padding:"10px 16px", border:"1px solid #EBEBEB", borderRadius:10, background:"#fff", fontSize:13, color:"#222", cursor:"pointer", textAlign:"center" }}>
            {uploading ? "処理中..." : avatarUrl ? "画像を変更" : "画像を選ぶ"}
            <input type="file" accept="image/*" onChange={handleAvatar} disabled={uploading} style={{ display:"none" }} />
          </label>
          {avatarUrl && (
            <button onClick={handleDeleteAvatar} disabled={uploading} className="f-sans" style={{ padding:"8px 16px", border:"1px solid #EBEBEB", borderRadius:10, background:"#fff", fontSize:12, color:"#717171", cursor:"pointer" }}>削除</button>
          )}
        </div>
      </div>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>ニックネーム</label>
      <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="例：たき" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>自己紹介・PR</label>
      <textarea value={pr} onChange={e=>setPr(e.target.value)} placeholder="農作業の経験や、意気込みなど" rows={4} className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16, resize:"vertical" }} />
      <button onClick={save} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12 }}>{saving ? "保存中..." : saved ? "保存しました ✓" : "保存する"}</button>
    </div>
  );
}

function JobSearchMapView({ onRegister }) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [dbJobs, setDbJobs] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from("jobs_public").select("*").order("job_number",{ascending:false});
        if (!error && data) {
          const mapped = data.map(j => ({
            id: j.job_number,
            crop: j.crop || "",
            task: j.task || "",
            dateLabel: j.date_label || "",
            payType: j.pay_type === "日給" ? "daily" : "hourly",
            pay: j.pay_type === "日給" ? Number(j.daily_wage)||0 : Number(j.hourly_wage)||0,
            region: [j.prefecture, j.city].filter(Boolean).join("") || "",
            experience: j.job_exp || "未経験可",
            icon: "🌾",
            lat: 34.05, lng: 134.23,
            count: j.headcount != null ? j.headcount + "名" : "", headcount: j.headcount, photos: j.photos || [],
            nearestStation: j.nearest_station || "", workTime: j.work_time || "",
            breakTime: j.break_time || "", notes: j.notes || "",
            commuteTime: j.commute_time || "", jobBody: "",
            wanted: "", items: j.belongings || "",
            payTiming: "", payMethod: "",
            dateStart: j.date_start ? new Date(j.date_start) : null,
            dateEnd: j.date_end ? new Date(j.date_end) : null,
            dangerPlaces: (j.danger_places || []).filter(p => p && (p.label || p.desc)),
            dangerTasks: (j.danger_tasks || []).filter(t => t && (t.label || t.desc)),
          }));
          setDbJobs(mapped);
        }
      } catch {}
    })();
  }, []);
  const jobList = (dbJobs && dbJobs.length > 0) ? dbJobs : JOB_SEARCH_SAMPLES;
  useEffect(() => {
    const m = window.location.hash.replace(/^#\/?/,"").match(/^work\/job\/(\d+)$/);
    if (!m) return;
    const jn = parseInt(m[1],10);
    const found = jobList.find(j => j.id === jn);
    if (found) { setSelectedJob(found); }
  }, [dbJobs]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [reviewSort, setReviewSort] = useState("new");
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [showApplyBar, setShowApplyBar] = useState(false);
  const applyPanelRef = useRef(null);
  const openJob = job => { setSelectedJob(job); setActiveSlide(0); setReviewSort("new"); setShowAllReviews(false); try{ window.history.pushState(null,"","#/work/job/"+job.id); }catch{} };
  const [applying, setApplying] = useState(false);
  const handleApply = async () => {
    if (applying || !selectedJob) return;
    setApplying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setApplying(false); if (onRegister) onRegister(); return; }
      const { data, error } = await supabase.rpc("apply_to_job", { p_job_number: selectedJob.id });
      setApplying(false);
      if (error) { alert("応募に失敗しました。時間をおいて再度お試しください。"); return; }
      if (data && data.ok) { window.location.hash = "/apply/done"; }
      else if (data && data.reason === "not_logged_in") { if (onRegister) onRegister(); }
      else if (data && data.reason === "own_job") { alert("自分の求人には応募できません。"); }
      else if (data && data.reason === "job_not_open") { alert("この求人は現在募集を受け付けていません。"); }
      else { alert("応募できませんでした。"); }
    } catch { setApplying(false); alert("応募に失敗しました。"); }
  };

  // PC専用の下固定応募バー：応募パネル(sticky)が画面より上に通過したら表示（758px以下はCSSで非表示）
  useEffect(() => {
    const el = applyPanelRef.current;
    if (!el) { setShowApplyBar(false); return; }
    const observer = new IntersectionObserver(([entry]) => {
      setShowApplyBar(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectedJob]);
  const handlePhotoScroll = e => {
    const el = e.target;
    setActiveSlide(Math.round(el.scrollLeft / el.clientWidth));
  };

  const pinLabel = j => j.payType === "hourly" ? `¥${j.pay.toLocaleString()}/h` : `¥${j.pay.toLocaleString()}/日`;
  const maxPay = selectedJob ? calcMaxPay(selectedJob) : null;

  // 将来の実地図APIに差し替える際はこの座標変換を修正する
  const MIN_LAT=34.04, MAX_LAT=34.12, MIN_LNG=134.20, MAX_LNG=134.38;
  const pinX = lng => `${Math.max(6, Math.min(88, Math.round((lng-MIN_LNG)/(MAX_LNG-MIN_LNG)*86)))}%`;
  const pinY = lat => `${Math.max(12, Math.min(75, Math.round((1-(lat-MIN_LAT)/(MAX_LAT-MIN_LAT))*70)))}%`;

  return (
    <div>
      {!selectedJob && (<>
      {/* ヘッダー */}
      <div style={{ marginBottom:14 }}>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:6 }}>近くの仕事を探す</h2>
        <p className="f-sans" style={{ fontSize:13, color:"#717171" }}>地域・作物・日程・報酬で、通いやすい仕事を探せます。</p>
      </div>

      {/* 個人情報保護注記 */}
      <div style={{ padding:"7px 12px", background:"#F7F7F7", borderRadius:8, marginBottom:12 }}>
        <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>
          詳細住所は初期表示しません。仕事の場所は市町村・地区単位で表示します。
        </p>
      </div>

      {/* 検索・絞込ピル */}
      <div style={{ display:"flex", gap:8, overflowX:"auto", scrollbarWidth:"none", marginBottom:14, paddingBottom:2 }}>
        {["未経験可","経験者歓迎","〜3人","4〜人","午前のみ","終日"].map(f => (
          <button key={f} onClick={() => setActiveFilter(activeFilter===f ? null : f)} className="f-sans" style={{
            flexShrink:0, padding:"7px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600, border:"2px solid",
            borderColor: activeFilter===f ? "#00A86B" : "#EBEBEB",
            background: activeFilter===f ? "#E6F7EF" : "#fff",
            color: activeFilter===f ? "#00A86B" : "#717171",
          }}>{f}</button>
        ))}
      </div>

      {/* 仕事リスト */}
      <div className="job-search-layout">
        <div>
          {jobList.length === 0 && (
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"64px 20px", color:"#999" }} className="f-sans">
              <div style={{ fontSize:40, marginBottom:12 }}>🌾</div>
              <p style={{ fontSize:14, margin:0 }}>現在、募集中の求人はありません</p>
            </div>
          )}
          {jobList.map(job => (
            <a
              key={job.id}
              href={"#/work/job/" + job.id}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display:"block", width:"100%", padding:0, textAlign:"left", cursor:"pointer", textDecoration:"none",
                background:"#fff", border:"1px solid #EEE", borderRadius:12, marginBottom:14, overflow:"hidden",
              }}
            >
              <div style={{ width:"100%", height:160, borderRadius:"12px 12px 0 0", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:48 }}>
                {job.icon}
              </div>
              <div style={{ padding:"12px 16px 16px" }}>
                <p className="f-sans" style={{ fontSize:16, fontWeight:600, color:"#222", margin:0, marginBottom:4 }}>{job.crop} {job.task}</p>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0, marginBottom:6 }}>{job.dateLabel}　{job.region}</p>
                <p className="f-mono" style={{ fontSize:15, fontWeight:700, color:"#00A86B", margin:0, marginBottom:8 }}>
                  {payLabel(job)}
                  {job.payTiming && (
                    <span className="f-sans" style={{ fontSize:10, fontWeight:400, color:"#B0B0B0", marginLeft:6 }}>{job.payTiming}</span>
                  )}
                </p>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {[job.experience, `募集${job.count}`, job.workTime].map(t => (
                    <span key={t} style={{ padding:"3px 10px", borderRadius:20, background:"#F7F7F7", color:"#717171", fontSize:11 }}>{t}</span>
                  ))}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
      </>)}

      {/* ── 詳細ページ ── */}
      {selectedJob && (
        <div className="appear">
          <button onClick={() => { setSelectedJob(null); try{ window.history.pushState(null,"","#/search"); }catch{} }} className="f-sans" style={{
            display:"flex", alignItems:"center", gap:6, background:"none", border:"none",
            fontSize:13, fontWeight:600, color:"#717171", cursor:"pointer", padding:"4px 0", marginBottom:20,
          }}>← 一覧に戻る</button>

          {/* ヘッダー */}
          <div style={{ marginBottom:20 }}>
            <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>{selectedJob.crop} {selectedJob.task}</h2>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", margin:0, marginTop:2 }}>{selectedJob.region}</p>
          </div>

          {/* 写真ギャラリー（ダミー3枚／将来 selectedJob.photos 配列を受け取る想定・最大10枚） */}
          {(() => {
            const photos = selectedJob.photos || [selectedJob.icon, selectedJob.icon, selectedJob.icon];
            const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
            return (
              <>
                <Carousel
                  className="carousel-scroll"
                  style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory" }}
                  wrapperStyle={{ marginBottom:8 }}
                  onScroll={handlePhotoScroll}
                >
                  {photos.map((photo, i) => (
                    <div key={i} style={{
                      flexShrink:0, width:"100%", height:392, borderRadius:12,
                      background: bgColors[i % bgColors.length],
                      display:"flex", alignItems:"center", justifyContent:"center", fontSize:72,
                      scrollSnapAlign:"start",
                    }}>{photo}</div>
                  ))}
                </Carousel>
                <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:20 }}>
                  {photos.map((_, i) => (
                    <span key={i} style={{ fontSize:10, color: i===activeSlide ? "#00A86B" : "#D0D0D0" }}>{i===activeSlide ? "●" : "○"}</span>
                  ))}
                </div>
              </>
            );
          })()}

          {/* 2カラム: 左=情報 / 右=応募パネル */}
          <div className="job-detail-2col">
            {/* 左カラム */}
            <div>
              {/* 主要情報 */}
              <div style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:14 }}>
                <div className="job-detail-info-grid">
                  {[
                    { label:"日程",     value: selectedJob.dateLabel },
                    { label:"勤務時間", value: selectedJob.workTime },
                    { label:"休憩時間", value: selectedJob.breakTime },
                    { label:"募集人数", value: selectedJob.count },
                    { label:"移動時間", value: selectedJob.commuteTime },
                    { label:"報酬",     value: (selectedJob.payTiming || selectedJob.payMethod) ? `${payLabel(selectedJob)}　${[selectedJob.payTiming, selectedJob.payMethod].filter(Boolean).join("・")}` : payLabel(selectedJob) },
                  ].filter(row => row.value && String(row.value).trim()).map(row => (
                    <div key={row.label} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>{row.label}</span>
                      <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {selectedJob.farmerName && (
                <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{
                    width:44, height:44, borderRadius:"50%", background:"#E6F7EF", flexShrink:0,
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:22,
                  }}>🧑‍🌾</div>
                  <div>
                    <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, marginBottom:2 }}>{selectedJob.farmerName}</p>
                    <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0 }}>{selectedJob.farmerBadge}・{selectedJob.farmerYears}</p>
                  </div>
                </div>
              )}

              {/* 作業説明 */}
              {selectedJob.jobBody && selectedJob.jobBody.trim() && (
              <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:14 }}>
                <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>作業内容</p>
                <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.8, margin:0 }}>{selectedJob.jobBody}</p>
              </div>
              )}

              {/* 経験・持ち物・備考（見出しにアイコン、持ち物は設備一覧風に展開） */}
              <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:14 }}>
                {[
                  { label:"💪 必要経験",       value: selectedJob.experience },
                  { label:"🙋 希望する働き手", value: selectedJob.wanted },
                ].filter(row => row.value && String(row.value).trim()).map(row => (
                  <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                    <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2 }}>{row.label}</span>
                    <span className="f-sans" style={{ fontSize:13, color:"#222" }}>{row.value}</span>
                  </div>
                ))}

                {/* 持ち物（Airbnb設備一覧風：アイコン+ラベルを並べる） */}
                <div style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                  <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:8 }}>🎒 持ち物</span>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {(selectedJob.items || "").split(/[、,，・\n]/).map(s => s.trim()).filter(Boolean).map((thing, i) => (
                      <span key={i} className="f-sans" style={{
                        display:"flex", alignItems:"center", gap:6, padding:"6px 12px",
                        borderRadius:20, background:"#F7F7F7", fontSize:13, color:"#222",
                      }}>
                        <span>{ITEM_ICONS[thing] || "📦"}</span>{thing}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                  <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2 }}>📝 備考・注意</span>
                  <span className="f-sans" style={{ fontSize:13, color:"#222" }}>{selectedJob.notes}</span>
                </div>
              </div>

              {/* 注記 */}
              <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", textAlign:"center", marginBottom:100 }}>
                本名・詳細住所は公開しません。
              </p>

              {/* 危険区域セクション（両方空なら見出しごと非表示＝ブロック化） */}
              {((selectedJob.dangerPlaces && selectedJob.dangerPlaces.length > 0) || (selectedJob.dangerTasks && selectedJob.dangerTasks.length > 0)) && (
              <div style={{ marginBottom:100 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:20 }}>
                  <span style={{ fontSize:18 }}>⚠️</span>
                  <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
                </div>

                {/* 危険な場所 */}
                {(selectedJob.dangerPlaces && selectedJob.dangerPlaces.length > 0) && (
                  <>
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:12, letterSpacing:".06em" }}>危険な場所</p>
                    <Carousel className="carousel-scroll" style={{ display:"flex", gap:16, overflowX:"auto", paddingBottom:4 }} wrapperStyle={{ marginBottom:28 }}>
                      {selectedJob.dangerPlaces.map((place, i) => (
                        <div key={i} style={{ flexShrink:0, width:240 }}>
                          <div style={{
                            width:"100%", height:130, borderRadius:12, background:"#FEF3E2",
                            display:"flex", alignItems:"center", justifyContent:"center", fontSize:40,
                          }}>{place.icon}</div>
                          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0, marginTop:8 }}>{place.label}</p>
                          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginTop:2 }}>{place.desc}</p>
                        </div>
                      ))}
                    </Carousel>
                  </>
                )}

                {/* 危険な作業 */}
                {(selectedJob.dangerTasks && selectedJob.dangerTasks.length > 0) && (
                  <>
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:12, letterSpacing:".06em" }}>危険な作業</p>
                    <Carousel className="carousel-scroll" style={{ display:"flex", gap:16, overflowX:"auto", paddingBottom:4 }}>
                      {selectedJob.dangerTasks.map((task, i) => (
                        <div key={i} style={{ flexShrink:0, width:240 }}>
                          <div style={{
                            width:"100%", height:130, borderRadius:12, background:"#FEF3E2",
                            display:"flex", alignItems:"center", justifyContent:"center", fontSize:40,
                          }}>{task.icon}</div>
                          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0, marginTop:8 }}>{task.label}</p>
                          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginTop:2 }}>{task.desc}</p>
                        </div>
                      ))}
                    </Carousel>
                  </>
                )}
              </div>
              )}
            </div>

            {/* 右カラム: 応募パネル（段階2-a・ガワのみ。応募は実稼働しない）
                外側はグリッドのstretchで左カラムの高さまで伸びるラッパー（枠なし＝sticky可動域の確保用）。
                内側が見た目の白い枠（中身の高さにしか伸びない） */}
            <div>
            <div ref={applyPanelRef} style={{
              position:"sticky", top:20, background:"#fff", border:"1px solid #EBEBEB",
              borderRadius:16, padding:"20px", marginBottom:100,
            }}>
              {/* 給与 */}
              <p className="f-mono" style={{ fontSize:22, fontWeight:800, color:"#222", margin:0, marginBottom:6 }}>
                {payLabel(selectedJob)}
              </p>

              {/* 最高額（自動計算・休憩1hダミー前提） */}
              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:16 }}>
                期間内に全て勤務した場合の最高額: {maxPay != null ? `¥${maxPay.toLocaleString()}` : "—"}
              </p>

              <div style={{ height:1, background:"#EBEBEB", margin:"0 0 16px" }} />

              {/* 期間 */}
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:20 }}>
                <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>期間</span>
                <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600 }}>{selectedJob.dateLabel}</span>
              </div>

              {/* CTAボタン */}
              <button
                onClick={handleApply}
                disabled={applying}
                className="btn-primary f-sans"
                style={{ width:"100%", padding:"16px", fontSize:15, fontWeight:700, borderRadius:14 }}
              >{applying ? "送信中..." : "この仕事に興味がある"}</button>

              {/* 補足文 */}
              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", textAlign:"center", margin:0, marginTop:10 }}>
                まだ応募は確定しません。正確な金額は面接後に決定します。
              </p>

              {/* 開催期間カレンダー（CalendarView readOnly・生データdate_start/date_endから） */}
              {selectedJob.dateStart && (
                <div style={{ marginTop:16, paddingTop:16, borderTop:"1px solid #EBEBEB" }}>
                  <CalendarView start={selectedJob.dateStart} end={selectedJob.dateEnd} readOnly={true} />
                </div>
              )}
            </div>
            </div>
          </div>

          {/* 地図（単一ピン・2カラムの外で全幅） */}
          <div style={{
            width:"100%", position:"relative", borderRadius:16, overflow:"hidden",
            height:480, border:"1px solid #EBEBEB", marginBottom:100,
            background:"linear-gradient(145deg, #c8e6c9 0%, #a5d6a7 35%, #88c98a 65%, #b2dfb4 100%)",
          }}>
            {/* 道路（ダミー） */}
            <div style={{ position:"absolute", top:"43%", left:0, right:0, height:3, background:"rgba(255,255,255,0.55)", transform:"rotate(-2deg)" }} />
            <div style={{ position:"absolute", top:"22%", left:"15%", right:"5%", height:2, background:"rgba(255,255,255,0.4)", transform:"rotate(7deg)" }} />
            <div style={{ position:"absolute", top:0, bottom:0, left:"40%", width:2, background:"rgba(255,255,255,0.4)", transform:"rotate(1deg)" }} />
            <div style={{ position:"absolute", top:"60%", left:"55%", right:0, height:2, background:"rgba(255,255,255,0.35)", transform:"rotate(-5deg)" }} />
            {/* 地名ラベル */}
            <div style={{ position:"absolute", top:8, left:8, padding:"3px 8px", background:"rgba(255,255,255,0.85)", borderRadius:8 }}>
              <span className="f-sans" style={{ fontSize:9, color:"#555" }}>吉野川流域・徳島県</span>
            </div>
            {/* ピン（単一・selectedJobのみ） */}
            <div style={{
              position:"absolute", left:pinX(selectedJob.lng), top:pinY(selectedJob.lat),
              transform:"translate(-50%, -100%)",
              background:"#00A86B", color:"#fff",
              border:"2px solid #00A86B", borderRadius:20,
              padding:"4px 9px", fontSize:11, fontWeight:700,
              whiteSpace:"nowrap",
              boxShadow:"0 2px 6px rgba(0,0,0,0.18)",
              fontFamily:"'DM Mono',monospace",
            }}>{pinLabel(selectedJob)}</div>
          </div>

          {/* 農家へのレビュー（段階2-a・ガワのみ・取引実績ベース・匿名・日付なし） */}
          {(() => {
            const allReviews = selectedJob.farmerReviews || [];
            if (allReviews.length === 0) return null;
            const sortedReviews = [...allReviews];
            if (reviewSort === "high") sortedReviews.sort((a, b) => b.stars - a.stars);
            else if (reviewSort === "low") sortedReviews.sort((a, b) => a.stars - b.stars);
            const visibleReviews = showAllReviews ? sortedReviews : sortedReviews.slice(0, 8);
            const hasMore = sortedReviews.length > 8;

            return (
              <div style={{ marginBottom:100 }}>
                {/* ヘッダー: 左=農家プロフィール(控えめ) / 中央=星評価(主役) */}
                <div className="review-header-row" style={{ marginBottom:24 }}>
                  {/* 左: 農家プロフィール（控えめ・既存プロフィール行を縮小） */}
                  <div className="review-header-profile" style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{
                      width:32, height:32, borderRadius:"50%", background:"#E6F7EF", flexShrink:0,
                      display:"flex", alignItems:"center", justifyContent:"center", fontSize:16,
                    }}>🧑‍🌾</div>
                    <div>
                      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0 }}>{selectedJob.farmerName}</p>
                      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:0 }}>{selectedJob.farmerBadge}・{selectedJob.farmerYears}</p>
                    </div>
                  </div>

                  {/* 中央: 星評価（主役・特大） */}
                  <div className="review-header-stars">
                    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:8 }}>
                      <span style={{ fontSize:36, color:"#00A86B" }}>★</span>
                      <span className="f-mono" style={{ fontSize:36, fontWeight:800, color:"#222" }}>{selectedJob.farmerRating}</span>
                    </div>
                    <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0, marginTop:2 }}>{selectedJob.farmerReviewCount}件のレビュー</p>
                  </div>

                  {/* 右: バランス用の余白 */}
                  <div className="review-header-spacer" />
                </div>

                {/* 並び替えタブ */}
                <div style={{ display:"flex", gap:8, marginBottom:18 }}>
                  {[
                    { key:"new",  label:"新しい順" },
                    { key:"high", label:"評価が高い順" },
                    { key:"low",  label:"評価が低い順" },
                  ].map(opt => {
                    const active = reviewSort === opt.key;
                    return (
                      <button key={opt.key} onClick={() => setReviewSort(opt.key)} className="f-sans" style={{
                        padding:"7px 16px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:600,
                        border: active ? "1px solid #00A86B" : "1px solid #EBEBEB",
                        background: active ? "#E6F7EF" : "#fff",
                        color: active ? "#00A86B" : "#717171",
                      }}>{opt.label}</button>
                    );
                  })}
                </div>

                {/* 個別レビュー一覧（匿名・日付なし・最大8件） */}
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  {visibleReviews.map((review, i) => (
                    <div key={i} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px" }}>
                      <p style={{ margin:0, marginBottom:6, fontSize:13, color:"#00A86B", letterSpacing:1 }}>
                        {"★".repeat(review.stars)}{"☆".repeat(5 - review.stars)}
                      </p>
                      <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0 }}>{review.text}</p>
                    </div>
                  ))}
                </div>

                {/* もっと見る */}
                {hasMore && !showAllReviews && (
                  <button onClick={() => setShowAllReviews(true)} className="f-sans" style={{
                    display:"block", margin:"18px auto 0", padding:"10px 28px", borderRadius:20,
                    border:"1px solid #222", background:"#fff", color:"#222", fontSize:13, fontWeight:700, cursor:"pointer",
                  }}>もっと見る</button>
                )}
              </div>
            );
          })()}

          {/* その他の求人（0件なら「ありません」を表示） */}
          <div style={{ marginBottom:20 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:12 }}>その他の求人</h3>
            {jobList.filter(job => job.id !== selectedJob.id).length === 0 ? (
              <p className="f-sans" style={{ fontSize:13, color:"#999", padding:"20px 0" }}>現在、他の求人はありません。</p>
            ) : (
            <Carousel
              className="carousel-scroll"
              style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:4 }}
            >
              {jobList.filter(job => job.id !== selectedJob.id).map(job => (
                <a
                  key={job.id}
                  href={"#/work/job/" + job.id}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flexShrink:0, width:160, padding:0, textAlign:"left", cursor:"pointer", textDecoration:"none",
                    background:"#fff", border:"1px solid #EEE", borderRadius:12, overflow:"hidden",
                  }}
                >
                  <div style={{ width:"100%", height:100, borderRadius:"12px 12px 0 0", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>
                    {job.icon}
                  </div>
                  <div style={{ padding:"8px 10px 10px" }}>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, marginBottom:2 }}>{job.crop} {job.task}</p>
                    <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:0, marginBottom:4 }}>{job.region}</p>
                    <p className="f-mono" style={{ fontSize:12, fontWeight:700, color:"#00A86B", margin:0 }}>{payLabel(job)}</p>
                  </div>
                </a>
              ))}
            </Carousel>
            )}
          </div>
        </div>
      )}

      {/* PC専用：下固定の応募バー（応募パネルが画面外に出たら表示。スマホはCSSでdisplay:none） */}
      {selectedJob && showApplyBar && (
        <div className="pc-apply-bar" style={{
          position:"fixed", bottom:0, left:0, right:0, zIndex:500,
          background:"#fff", borderTop:"1px solid #EBEBEB",
          padding:"16px 24px", boxShadow:"0 -4px 16px rgba(0,0,0,0.08)",
          alignItems:"center", justifyContent:"space-between", gap:24,
        }}>
          <span className="f-mono" style={{ fontSize:18, fontWeight:800, color:"#222" }}>{payLabel(selectedJob)}</span>
          <button
            onClick={handleApply}
            disabled={applying}
            className="btn-primary f-sans"
            style={{ padding:"14px 32px", fontSize:15, fontWeight:700, borderRadius:14, whiteSpace:"nowrap" }}
          >{applying ? "送信中..." : "この仕事に興味がある"}</button>
        </div>
      )}
    </div>
  );
}

// ── LandingFlow 共有UIヘルパー（モジュールレベル定義でフォーカス消失バグを防ぐ）───
// 注意：これらを LandingFlow 内に定義すると再レンダリングのたびに関数参照が変わり
// React が別コンポーネントと判定してアンマウントし input のフォーカスが失われる。
function LFWizCard({ children }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"20px", marginBottom:14, boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}>
      {children}
    </div>
  );
}
function LFCardBtn({ selected, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      width:"100%", textAlign:"left", padding:"20px 22px", borderRadius:16, display:"block", marginBottom:10,
      border: selected ? "2px solid #00A86B" : "2px solid #EBEBEB",
      background: selected ? "#E6F7EF" : "#fff",
      fontSize:15, fontWeight: selected ? 600 : 400, color:"#222", cursor:"pointer", transition:"all .15s",
    }}>{children}</button>
  );
}
function LFPillSelect({ options, value, onSelect }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
      {options.map(o => (
        <button key={o} onClick={() => onSelect(o)} className="f-sans" style={{
          padding:"7px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600, border:"2px solid",
          borderColor: value===o ? "#00A86B" : "#EBEBEB",
          background: value===o ? "#E6F7EF" : "#fff", color: value===o ? "#00A86B" : "#222",
        }}>{o}</button>
      ))}
    </div>
  );
}

// 作物リスト（カードを増やすときはここに1行足すだけ）
const CROP_OPTIONS = [
  { name:"トマト",   icon:"🍅" },
  { name:"キュウリ", icon:"🥒" },
  { name:"ナス",     icon:"🍆" },
  { name:"イチゴ",   icon:"🍓" },
  { name:"米",       icon:"🌾" },
  { name:"ブドウ",   icon:"🍇" },
  { name:"リンゴ",   icon:"🍎" },
];

// 作業リスト（アイコン無し・文字だけカード。増やすときはここに1行足すだけ）
const TASK_OPTIONS = [
  { name:"収穫",     icon:"" },
  { name:"定植",     icon:"" },
  { name:"選果",     icon:"" },
  { name:"農薬散布", icon:"" },
  { name:"草刈り",   icon:"" },
  { name:"袋かけ",   icon:"" },
];

// 選択カードグリッド（Airbnb型・汎用）。options=[{name,icon}], value=選択中, onSelect=カード選択, otherText=自由入力値, onOtherChange=自由入力
function LFCropGrid({ options, value, onSelect, otherText, onOtherChange, otherPlaceholder }) {
  const isOther = value === "__other__";
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12 }}>
        {options.map(c => {
          const sel = value === c.name;
          return (
            <button key={c.name} onClick={() => onSelect(c.name)} className="f-sans crop-card" style={{
              display:"flex", flexDirection:"column", alignItems:"flex-start", gap:8,
              padding:"16px", borderRadius:12, cursor:"pointer", border:"2px solid",
              borderColor: sel ? "#00A86B" : "#EBEBEB",
              background: sel ? "#E6F7EF" : "#fff",
            }}>
              {c.icon && <span style={{ fontSize:28 }}>{c.icon}</span>}
              <span className="f-sans" style={{ fontSize:14, fontWeight:600, color: sel ? "#00A86B" : "#222" }}>{c.name}</span>
            </button>
          );
        })}
        <button onClick={() => onSelect("__other__")} className="f-sans crop-card" style={{
          display:"flex", flexDirection:"column", alignItems:"flex-start", gap:8,
          padding:"16px", borderRadius:12, cursor:"pointer", border:"2px solid",
          borderColor: isOther ? "#00A86B" : "#EBEBEB",
          background: isOther ? "#E6F7EF" : "#fff",
        }}>
          <span style={{ fontSize:28 }}>✏️</span>
          <span className="f-sans" style={{ fontSize:14, fontWeight:600, color: isOther ? "#00A86B" : "#222" }}>その他</span>
        </button>
      </div>
      {isOther && (
        <input value={otherText} onChange={e => onOtherChange(e.target.value)}
          placeholder={otherPlaceholder} className="field f-sans"
          style={{ fontSize:16, marginTop:12 }} />
      )}
    </div>
  );
}
function LFMultiPill({ options, values, onToggle }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
      {options.map(o => {
        const sel = values.includes(o);
        return (
          <button key={o} onClick={() => onToggle(o)} className="f-sans" style={{
            padding:"7px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600, border:"2px solid",
            borderColor: sel ? "#00A86B" : "#EBEBEB",
            background: sel ? "#E6F7EF" : "#fff", color: sel ? "#00A86B" : "#222",
          }}>{o}</button>
        );
      })}
    </div>
  );
}
function LFSummaryRow({ label, value }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid #F7F7F7" }}>
      <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0" }}>{label}</span>
      <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600 }}>{value}</span>
    </div>
  );
}

// 徳島県最低賃金（地域別最低賃金） 2026/1/1発効。改定時に要更新。確認先：徳島労働局 賃金室 088-652-9165
const MIN_WAGE_TOKUSHIMA = 1046;

// 時給・日給が徳島県最低賃金を下回っていないかを判定する純関数
// workHours: 勤務時間（終了時刻 - 開始時刻、時間単位）。6時間超で休憩45分、8時間超で休憩60分を控除した実労働時間で日給を時給換算する。
function validateMinWage(hourly, daily, workHours) {
  const hourlyViolation = hourly > 0 && hourly < MIN_WAGE_TOKUSHIMA;
  let dailyViolation = false;
  if (daily > 0 && workHours > 0) {
    const breakHours = workHours > 8 ? 1 : workHours > 6 ? 0.75 : 0;
    const actualHours = workHours - breakHours;
    if (actualHours > 0 && daily / actualHours < MIN_WAGE_TOKUSHIMA) dailyViolation = true;
  }
  return { hourlyViolation, dailyViolation };
}

function LFWageNote() {
  return (
    <div style={{ padding:"8px 12px", background:"#FEF3E2", borderRadius:8, border:"1px solid #F5A62333", marginTop:8 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#F5A623" }}>⚠ 報酬は最低賃金を下回らないように設定してください</p>
    </div>
  );
}
function LFPrivacyNote() {
  return (
    <div style={{ padding:"8px 12px", background:"#F7F7F7", borderRadius:8, marginTop:8, marginBottom:8 }}>
      <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", lineHeight:1.7 }}>
        本名・電話番号・詳細住所は初期表示しません。詳細情報の無断共有は禁止です。
      </p>
    </div>
  );
}
function LFWageCompare({ type, value, avg, count }) {
  if (!value || value <= 0) return null;
  const median = Math.round(avg * 0.97);
  if (count < 5) return <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6 }}>まだ同条件のデータが少ないため、平均は表示できません。</p>;
  const diff = value - avg;
  return (
    <div style={{ marginTop:8, padding:"10px 12px", background:"#F7F7F7", borderRadius:8 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>
        この経歴・作業内容の平均{type}：<span className="f-mono" style={{ fontWeight:700, color:"#222" }}>{avg.toLocaleString()}円</span>　中央値：{median.toLocaleString()}円　件数：{count}件
      </p>
      <p className="f-sans" style={{ fontSize:11, fontWeight:600, marginTop:4, color: diff >= 0 ? "#00A86B" : "#F5A623" }}>
        あなたの希望{type}：{value.toLocaleString()}円　平均より {diff >= 0 ? "+" : ""}{diff.toLocaleString()}円{diff < 0 ? "（応募が集まりにくい可能性があります）" : ""}
      </p>
    </div>
  );
}
function LFFakeFilterRow() {
  return (
    <div style={{ display:"flex", gap:6, marginBottom:12, overflowX:"auto", scrollbarWidth:"none" }}>
      {["地域","作物","作業","日付","経験","報酬","移動手段"].map(f => (
        <span key={f} style={{ flexShrink:0, padding:"6px 12px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:11, color:"#717171" }}>{f}</span>
      ))}
    </div>
  );
}

function buildGoogleMapsUrl(region) {
  const query = `${region || "徳島県吉野川市"} 周辺`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// ── LandingFlow ──────────────────────────────────────────────
// 表示条件：{!me && showLanding && <LandingFlow .../>} — 未ログイン訪問者に表示
function LandingFlow({ onComplete, onSkip, onLogin, farmersCount = 0, embedded = false, initialRole = "", onStepChange, initialStep }) {
  const AVG_HOURLY = 1180, AVG_DAILY = 8400, AVG_COUNT = 0;
  const TARGET = 30;
  const progress = Math.min(Math.round((farmersCount / TARGET) * 100), 100);

  // ── ログイン後復帰: postLoginReturnTo を確認して draft を読み込む ──
  const _draftInit = (() => {
    try {
      if (localStorage.getItem('postLoginReturnTo') === 'landingFlowFarmerConfirm') {
        const d = JSON.parse(localStorage.getItem('landingFlowDraft_v1') || '{}');
        if (d.role === 'farmer') return d;
      }
    } catch {}
    return null;
  })();

  const _devJump = (() => { try { return JSON.parse(localStorage.getItem('devJump')||'null'); } catch { return null; } })();

  const [role, setRole] = useState(_devJump?.role ?? _draftInit?.role ?? initialRole ?? ""); // "" | "farmer" | "worker"
  const [step, setStep] = useState((initialStep && initialStep >= 1 && initialStep <= 11) ? initialStep : (_devJump?.step ?? (_draftInit ? (_draftInit.farmerStep ?? 1) : 0))); // URL(#/work/new/{step})最優先→devJump→draft→0
  const _editJobNumber = (() => { const m = window.location.hash.replace(/^#\/?/,"").match(/^work\/edit\/(\d+)$/); return m ? parseInt(m[1],10) : null; })();

  // 農家 state（draft がある場合は復元値を初期値に使う）
  const d = _draftInit || {};
  const [farmerExp,         setFarmerExp]         = useState(d.farmerExp ?? "");
  const [farmerPurpose,     setFarmerPurpose]     = useState(_devJump?.farmerPurpose ?? d.farmerPurpose ?? "post");
  const [farmerDisplayName, setFarmerDisplayName] = useState(d.farmerDisplayName ?? "");
  const [farmerRegion,      setFarmerRegion]      = useState(d.farmerRegion ?? "");
  // 住所4分割（段階1。郵便番号自動検索・地図・新規登録からの引き継ぎは将来）
  const [farmerZip,         setFarmerZip]         = useState(d.farmerZip ?? "");
  const [farmerPref,        setFarmerPref]        = useState(d.farmerPref ?? "");
  const [farmerCity,        setFarmerCity]        = useState(d.farmerCity ?? "");
  const [farmerAddr,        setFarmerAddr]        = useState(d.farmerAddr ?? "");
  const [zipSearching,      setZipSearching]      = useState(false);
  const [zipError,          setZipError]          = useState("");
  // 郵便番号から住所を検索（zipcloud・無料・認証不要）。都道府県・市区町村を自動入力
  const searchZip = async () => {
    const zip = farmerZip.replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setZipError("郵便番号は7桁で入力してください"); return; }
    setZipSearching(true); setZipError("");
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
      const data = await res.json();
      if (data.status === 200 && data.results) {
        const r = data.results[0];
        setFarmerPref(r.address1);
        setFarmerCity(r.address2);
        setFarmerRegion(r.address1 + r.address2);
        setZipError("");
      } else {
        setZipError("郵便番号が見つかりませんでした");
      }
    } catch {
      setZipError("検索に失敗しました。通信環境をご確認ください");
    }
    setZipSearching(false);
  };
  const [farmerCropPill,    setFarmerCropPill]    = useState(d.farmerCropPill ?? ""); // 作物ピル選択
  const [farmerCropText,    setFarmerCropText]    = useState(d.farmerCropText ?? ""); // 作物自由入力
  const [farmerTaskPill,    setFarmerTaskPill]    = useState(d.farmerTaskPill ?? ""); // 作業ピル選択
  const [farmerTaskText,    setFarmerTaskText]    = useState(d.farmerTaskText ?? ""); // 作業自由入力
  const [farmerWanted,      setFarmerWanted]      = useState(d.farmerWanted ?? "");
  const [farmerPayType,     setFarmerPayType]     = useState(d.farmerPayType ?? "");
  const [payTiming,         setPayTiming]         = useState(d.payTiming ?? "即日払い（作業当日）");
  const [payMethod,         setPayMethod]         = useState(d.payMethod  ?? "現金手渡し");
  // 勤務時間（4分割）
  const [startHour,   setStartHour]   = useState(d.startHour   ?? "8");
  const [startMinute, setStartMinute] = useState(d.startMinute ?? "00");
  const [endHour,     setEndHour]     = useState(d.endHour     ?? "16");
  const [endMinute,   setEndMinute]   = useState(d.endMinute   ?? "00");
  // 時給・日給（文字列で保持してカーソル飛び防止）
  const [hourlyWageInput, setHourlyWageInput] = useState(d.hourlyWageInput ?? "");
  const [dailyWageInput,  setDailyWageInput]  = useState(d.dailyWageInput  ?? "");
  // 日程（Date は JSON.parse で文字列になるので再変換）
  const [jobDateStart,    setJobDateStart]    = useState(d.jobDateStart ? new Date(d.jobDateStart) : null);
  const [jobDateEnd,      setJobDateEnd]      = useState(d.jobDateEnd   ? new Date(d.jobDateEnd)   : null);
  const [showCalendar,    setShowCalendar]    = useState(true);
  const [calYear,         setCalYear]         = useState(new Date().getFullYear());
  const [calMonth,        setCalMonth]        = useState(new Date().getMonth());
  const [jobCount,        setJobCount]        = useState(d.jobCount ?? "");
  const [breakTime, setBreakTime] = useState(d.breakTime ?? "");
  const [commuteTime, setCommuteTime] = useState(d.commuteTime ?? "");
  const [nearestStation, setNearestStation] = useState(d.nearestStation ?? "");
  const [jobPhotos, setJobPhotos] = useState(d.jobPhotos ?? []);
  const [jobDescription, setJobDescription] = useState(d.jobDescription ?? "");
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [jobDangerPlaces, setJobDangerPlaces] = useState((d.jobDangerPlaces ?? [{ icon:"⚠️", label:"", desc:"" }, { icon:"⚠️", label:"", desc:"" }]).map(p => ({ photos:[], ...p })));
  const [jobDangerTasks, setJobDangerTasks] = useState((d.jobDangerTasks ?? [{ icon:"⚠️", label:"", desc:"" }, { icon:"⚠️", label:"", desc:"" }]).map(t => ({ photos:[], ...t })));
  const [showPlace2, setShowPlace2] = useState(false);
  const [showTask2, setShowTask2] = useState(false);
  const [confActiveSlide, setConfActiveSlide] = useState(0);
  const confScrollRef = useRef(null);
  const captionTextareaRef = useRef(null);

  // draft 復元後に postLoginReturnTo を削除（1回だけ実行）
  useEffect(() => {
    if (_draftInit) {
      try { localStorage.removeItem('postLoginReturnTo'); } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (_devJump) {
      try { localStorage.removeItem('devJump'); } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 派生値
  const workTimeLabel = `${startHour}:${startMinute}〜${endHour}:${endMinute}`;
  const hourlyWage = Number(hourlyWageInput.replace(/[^\d]/g, "")) || 0;
  const dailyWage  = Number(dailyWageInput.replace(/[^\d]/g, "")) || 0;
  const workHours = (Number(endHour) + Number(endMinute) / 60) - (Number(startHour) + Number(startMinute) / 60);
  const { hourlyViolation, dailyViolation } = validateMinWage(hourlyWage, dailyWage, workHours);
  const calcFarmerMaxPay = () => {
    const days   = jobDateStart ? Math.floor(((jobDateEnd || jobDateStart) - jobDateStart) / 86400000) + 1 : 0;
    const breakH = (Number(String(breakTime).replace(/[^\d]/g,"")) || 0) / 60;
    const netH   = Math.max(workHours - breakH, 0);
    return hourlyWage > 0 ? Math.round(hourlyWage * netH * days) : dailyWage > 0 ? dailyWage * days : 0;
  };
  const [jobExp,            setJobExp]            = useState(d.jobExp ?? "");
  const [jobSaving, setJobSaving] = useState(false);
  const [jobNotes,          setJobNotes]          = useState(d.jobNotes ?? "");
  const [jobCautions,       setJobCautions]       = useState(d.jobCautions ?? "");
  const [jobTemplate,       setJobTemplate]       = useState(d.jobTemplate ?? "収穫補助");

  // ピル選択とテキスト入力の合成値（自由入力優先）
  const farmerCrop = farmerCropPill === "__other__" ? farmerCropText.trim() : (farmerCropText.trim() || farmerCropPill);
  const farmerTask = farmerTaskPill === "__other__" ? farmerTaskText.trim() : (farmerTaskText.trim() || farmerTaskPill);

  // 働き手 state
  const [workerExp,         setWorkerExp]         = useState("");
  const [workerPurpose,     setWorkerPurpose]     = useState(_devJump?.workerPurpose ?? "");
  const [workerDisplayName, setWorkerDisplayName] = useState("");
  const [workerRegion,      setWorkerRegion]      = useState("");
  const [workerTransport,   setWorkerTransport]   = useState("");
  const [workerDays,        setWorkerDays]        = useState([]);
  const [workerTimeSlot,    setWorkerTimeSlot]    = useState("");
  const [workerWork,        setWorkerWork]        = useState("");
  const [workerCrop,        setWorkerCrop]        = useState("");
  const [workerHourly,      setWorkerHourly]      = useState("");
  const [workerDaily,       setWorkerDaily]       = useState("");
  const [workerHours,       setWorkerHours]       = useState("");
  const [expandedJob,       setExpandedJob]       = useState(null);

  const isFarmer = role === "farmer";
  const isWorker = role === "worker";
  const farmerStepLabels = ["作物","作業","場所","日程","募集人数","報酬","確認","完了"];
  const workerStepLabels = ["経歴","目的","プロフィール","報酬比較","確認","詳細","確認","完了"];
  const stepLabels = isFarmer ? farmerStepLabels : isWorker ? workerStepLabels : [];
  const TOTAL = isFarmer ? 14 : 8;

  const goNext = () => setStep(s => s + 1);
  const goBack = () => { if (step <= 1) { setStep(0); } else setStep(s => s - 1); };

  useEffect(() => {
    if (onStepChange && role === "farmer" && step >= 1 && step <= 11) onStepChange(step);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draftJobNumber, setDraftJobNumber] = useState(_editJobNumber ?? _draftInit?.job_number ?? null);
  useEffect(() => {
    if (!_editJobNumber) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data, error } = await supabase.from("jobs").select("*").eq("job_number", _editJobNumber).eq("farmer_id", session.user.id).single();
        if (error || !data) return;
        setRole("farmer");
        setFarmerCropText(data.crop ?? "");
        setFarmerTaskText(data.task ?? "");
        setFarmerZip(data.zip ?? "");
        setFarmerPref(data.prefecture ?? "");
        setFarmerCity(data.city ?? "");
        setFarmerAddr(data.address ?? "");
        setJobDateStart(data.date_start ? new Date(data.date_start) : null);
        setJobDateEnd(data.date_end ? new Date(data.date_end) : null);
        setJobCount(data.headcount != null ? String(data.headcount) : "");
        setHourlyWageInput(data.hourly_wage ?? "");
        setDailyWageInput(data.daily_wage ?? "");
        setBreakTime(data.break_time ?? "");
        setNearestStation(data.nearest_station ?? "");
        setCommuteTime(data.commute_time ?? "");
        setJobExp(data.job_exp ?? "");
        setJobDescription(data.notes ?? "");
        setJobNotes(data.belongings ?? "");
        setJobCautions(data.cautions ?? "");
        setJobDangerPlaces(data.danger_places ?? []);
        setJobDangerTasks(data.danger_tasks ?? []);
        setJobPhotos(data.photos ?? []);
        setStep(data.draft_step != null ? data.draft_step : 11);
      } catch {}
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMsg, setDraftMsg] = useState("");
  const [draftBarFull, setDraftBarFull] = useState(false);
  const [draftOverlay, setDraftOverlay] = useState(false);

  // ドラフト保存 → ログイン後に LandingFlow 初期化時に復元される
  const saveDraft = () => {
    try {
      const draft = {
        role: "farmer", farmerStep: step, job_number: draftJobNumber, // 保存時点の実ステップとupsertキーを記録
        farmerExp, farmerPurpose, farmerDisplayName, farmerRegion,
        farmerZip, farmerPref, farmerCity, farmerAddr, jobPhotos,
        farmerCropPill, farmerCropText, farmerTaskPill, farmerTaskText,
        farmerWanted, farmerPayType, payTiming, payMethod,
        startHour, startMinute, endHour, endMinute,
        jobCount, breakTime, commuteTime, nearestStation, jobDangerPlaces, jobDangerTasks, hourlyWageInput, dailyWageInput,
        jobExp, jobTemplate, jobNotes, jobCautions, jobDescription,
        jobDateStart: jobDateStart?.toISOString() ?? null,
        jobDateEnd:   jobDateEnd?.toISOString()   ?? null,
      };
      localStorage.setItem('landingFlowDraft_v1', JSON.stringify(draft));
      localStorage.setItem('postLoginReturnTo', 'landingFlowFarmerConfirm');
      // ログイン後: LandingFlow 初期化時に _draftInit が読み込まれ、
      //   role="farmer", step=5（確認画面）として復元される
    } catch {}
  };

  const buildJobPayload = (authUid, statusVal = "pending") => ({
    farmer_id:       authUid,
    crop:            farmerCrop,
    task:            farmerTask,
    zip:             farmerZip,
    prefecture:      farmerPref,
    city:            farmerCity,
    address:         farmerAddr,
    date_label:      jobDateLabel,
    date_start:      jobDateStart ? jobDateStart.toISOString().slice(0,10) : null,
    date_end:        jobDateEnd ? jobDateEnd.toISOString().slice(0,10) : null,
    headcount:       Number(jobCount) || null,
    pay_type:        hourlyWage > 0 ? "時給" : "日給",
    hourly_wage:     hourlyWageInput,
    daily_wage:      dailyWageInput,
    work_time:       workTimeLabel,
    break_time:      breakTime,
    nearest_station: nearestStation,
    commute_time:    commuteTime,
    job_exp:         jobExp,
    notes:           jobDescription,
    belongings:      jobNotes,
    cautions:        jobCautions,
    danger_places:   jobDangerPlaces,
    danger_tasks:    jobDangerTasks,
    photos:          jobPhotos,
    draft_step:      step,
    status:          statusVal,
  });

  const saveDraftToSupabase = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { ok:false, reason:"no_session" };
      const payload = buildJobPayload(session.user.id, "draft");
      if (draftJobNumber) {
        const { error } = await supabase.from("jobs").update(payload).eq("job_number", draftJobNumber).eq("farmer_id", session.user.id);
        if (error) return { ok:false, reason:error.message };
        return { ok:true, jobNumber:draftJobNumber };
      } else {
        const { data, error } = await supabase.from("jobs").insert(payload).select("job_number").single();
        if (error) return { ok:false, reason:error.message };
        setDraftJobNumber(data.job_number);
        try { const _d = JSON.parse(localStorage.getItem("landingFlowDraft_v1")||"{}"); _d.job_number = data.job_number; localStorage.setItem("landingFlowDraft_v1", JSON.stringify(_d)); } catch {}
        return { ok:true, jobNumber:data.job_number };
      }
    } catch (e) { return { ok:false, reason:String(e) }; }
  };

  const handleTopSaveExit = async () => {
    if (draftSaving) return;
    setDraftSaving(true); setDraftMsg("");
    const res = await saveDraftToSupabase();
    setDraftSaving(false);
    if (res.ok) {
      try { sessionStorage.setItem("cb_afterDraftSave","1"); } catch {}
      setDraftOverlay(true);
      setTimeout(() => { setDraftOverlay(false); window.location.hash = "/work"; if (typeof onComplete === "function") onComplete(); }, 1100);
    } else if (res.reason === "no_session") {
      saveDraft(); onLogin();
    } else {
      setDraftMsg("保存に失敗しました：" + res.reason);
      alert("保存に失敗しました：" + res.reason);
    }
  };

  // Airbnb模擬・部品1:step移動ごとに自動で下書き保存（農家フロー中のみ・home(0)と完了(12)は除外）
  useEffect(() => {
    if (role === "farmer" && step >= 1 && step <= 11) saveDraft();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // 選択した瞬間に次へ進む（140ms で選択状態を視認させてから遷移）
  const selectAndNext = (setter, value) => {
    setter(value);
    setTimeout(() => setStep(s => s + 1), 140);
  };

  // 自動遷移ステップ（次へボタン非表示、戻るのみ表示）
  const isAutoStep = (
    step === 0 ||
    (isWorker && step === 1) ||
    (isWorker && step === 2)
  );

  // UI helpers はモジュールレベルに移動済み（LF_ プレフィックス）

  // ── カレンダーヘルパー ──────────────────────────────────────
  const WD = ["日","月","火","水","木","金","土"];
  const fmtD = (d) => {
    if (!d) return "";
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}（${WD[d.getDay()]}）`;
  };
  const jobDateLabel = (() => {
    if (!jobDateStart) return "日程を選択してください";
    const end = jobDateEnd || jobDateStart;
    if (fmtD(jobDateStart) === fmtD(end)) return fmtD(jobDateStart);
    return `${fmtD(jobDateStart)} 〜 ${fmtD(end)}`;
  })();
  const handleCalDay = (d) => {
    const clicked = new Date(calYear, calMonth, d);
    if (!jobDateStart || jobDateEnd) { setJobDateStart(clicked); setJobDateEnd(null); }
    else if (clicked >= jobDateStart) { setJobDateEnd(clicked); }
    else { setJobDateStart(clicked); setJobDateEnd(null); }
  };
  const isSameDay = (a, b) => a && b && a.toDateString() === b.toDateString();
  // ── タイポグラフィ定数 ─────────────────────────────────────
  const lfStyles = {
    heroTitle: {
      fontSize:"clamp(28px, 4vw, 42px)", fontWeight:850, lineHeight:1.22,
      letterSpacing:"-0.04em", color:"#222", textAlign:"center", margin:"24px 0 12px",
    },
    stepTitle: {
      fontSize:"clamp(26px, 3.2vw, 36px)", fontWeight:850, lineHeight:1.25,
      letterSpacing:"-0.035em", color:"#222", textAlign:"center", margin:"32px 0 10px",
    },
    subtitle: {
      fontSize:"clamp(14px, 1.6vw, 17px)", lineHeight:1.85, color:"#717171",
      textAlign:"center", margin:"0 auto 28px", maxWidth:520,
    },
    question: {
      fontSize:"clamp(18px, 2vw, 22px)", fontWeight:750, lineHeight:1.4,
      color:"#222", textAlign:"center", margin:"28px 0 18px",
    },
    cardTitle: {
      fontSize:"clamp(16px, 1.8vw, 20px)", fontWeight:750, color:"#222",
      lineHeight:1.45, marginBottom:4,
    },
    cardDesc: {
      fontSize:"clamp(13px, 1.4vw, 15px)", lineHeight:1.75, color:"#717171",
    },
    note: {
      fontSize:"clamp(11px, 1.1vw, 12px)", lineHeight:1.8, color:"#B0B0B0", textAlign:"center",
    },
    inputLabel: { fontSize:14, fontWeight:700, color:"#222", marginBottom:6, display:"block" },
    featureTitle: { fontSize:"clamp(14px, 1.5vw, 16px)", fontWeight:700, color:"#222", marginBottom:3 },
    featureDesc: { fontSize:"clamp(12px, 1.3vw, 14px)", lineHeight:1.75, color:"#717171" },
  };

  // canGoNext per step
  // 農家6ステップ: 0=home,1=就農歴,2=目的,3=プロフィール,4=詳細,5=確認,6=完了
  const farmerCanNext = [true, !!farmerCrop, !!farmerTask, !!farmerZip.trim()&&!!farmerPref.trim()&&!!farmerCity.trim()&&!!farmerAddr.trim(), !!jobDateStart && Number(jobCount) > 0, farmerPurpose !== "post" || ((!!hourlyWageInput || !!dailyWageInput) && !hourlyViolation && !dailyViolation && breakTime !== ""), true, true, true, true, true, true, true];
  const workerCanNext = [true, !!workerExp, !!workerPurpose, true, true, true, true, true, true];
  const canGoNext = isFarmer ? (farmerCanNext[step] ?? true) : isWorker ? (workerCanNext[step] ?? true) : true;

  // ── OUTER SHELL ─────────────────────────────────────────────
  return (
    <div style={embedded ? { position:"relative", background:"#fff" } : { position:"fixed", inset:0, background:"#fff", zIndex:9998 }}>
      <DevBadge label="LandingFlow" />

      {/* 進捗バー */}
      {step > 0 && (
        <div style={{ position: embedded ? "relative" : "absolute", top:0, left:0, right:0, zIndex:1 }}>
          <div style={{ height:4, background:"#EBEBEB" }}>
            <div style={{ height:4, background:"#00A86B", width:((draftBarFull || step >= 12) ? 100 : (step/TOTAL*100))+"%", transition:"width 0.4s ease" }} />
          </div>
          <div style={{ display:"flex", overflowX:"auto", scrollbarWidth:"none", padding:"4px 8px 0" }}>
            {stepLabels.map((label, i) => (
              <span key={i} className="f-sans" style={{ flexShrink:0, fontSize:8, minWidth:48, textAlign:"center", fontWeight: i+1===step ? 700 : 400, color: i+1===step ? "#00A86B" : i+1<step ? "#717171" : "#B0B0B0" }}>{i+1} {label}</span>
            ))}
          </div>
        </div>
      )}

      {/* 保存して終了ボタン（TODO: 管理者(isAdmin)限定で下書き保存を実装する。現状は保存せず閉じるのみ） */}
      {!embedded && step !== 12 && step !== 11 && step !== 0 && step !== 6 && (
        <button onClick={handleTopSaveExit} disabled={draftSaving} className="f-sans" style={{
          position:"absolute", top:step > 0 ? 24 : 16, right:20,
          background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"8px 18px",
          fontSize:13, color:"#222", fontWeight:600, cursor:"pointer", zIndex:2,
          boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>{draftSaving ? "保存中..." : "一時保存して終了"}</button>
      )}

      {/* スクロール領域 */}
      <div style={embedded ? {} : ((step === 0 || step === 6)
        ? { height:"100%", overflowY:"auto", display:"flex", flexDirection:"column", justifyContent:"center" }
        : { height:"100%", overflowY:"auto" })}>
        <div key={step} className="fade-in" style={{ maxWidth: (step === 11 || step === 0 || step === 6) ? 1280 : 480, margin:"0 auto", padding: embedded ? (step > 0 ? "16px 20px 24px" : "0 20px 24px") : (step > 0 ? "64px 20px 140px" : "56px 20px 40px") }}>

          {/* ── HOME ── */}
          {step === 0 && (
            <>
              <div className="step0-grid">
              <div>
              <div style={{ marginBottom:36 }}>
                <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 8px" }}>ステップ1</p>
                <h1 className="f-sans" style={{ fontSize:38, fontWeight:800, color:"#222", lineHeight:1.25, margin:"0 0 20px" }}>
                  {role === "farmer" ? "まず、基本情報から" : "あなたの希望を入力"}
                </h1>
                <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.9, margin:0 }}>
                  {role === "farmer"
                    ? "求人に欠かせない情報を入力します。作物、作業内容、場所、日程、募集人数、報酬の6つを、ひとつずつうかがいます。"
                    : "はじめに、希望する作業内容や、働ける時期・条件についてうかがいます。次に、勤務できる地域、曜日、時間帯、希望する報酬など、お仕事探しに必要な情報をご入力ください。"}
                </p>
              </div>
              </div>
              <div style={{ background:"#fff", border:"1px solid #EEE", borderRadius:16, overflow:"hidden", boxShadow:"0 4px 16px rgba(0,0,0,0.06)" }}>
                <div style={{ height:200, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:80 }}>🥦</div>
                <div style={{ padding:"20px 24px 24px" }}>
                  <p className="f-sans" style={{ fontSize:18, fontWeight:700, color:"#222", margin:"0 0 6px" }}>ブロッコリー 収穫補助</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 12px" }}>吉野川市周辺</p>
                  <p className="f-mono" style={{ fontSize:20, fontWeight:700, color:"#00A86B", margin:0 }}>時給1,200円</p>
                </div>
              </div>
              </div>
              <div style={{ position:"absolute", bottom:24, right:20, zIndex:2 }}>
                <button onClick={() => setStep(1)} className="btn-primary" style={{ padding:"14px 40px", fontSize:15, fontWeight:700 }}>次へ</button>
              </div>
            </>
          )}

          {/* ── FARMER FLOW ── */}
          {isFarmer && step === 1 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>作物を選んでください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>募集する求人の作物を選びます。一覧にない場合は「その他」から入力できます。</p>
            <LFCropGrid
              options={CROP_OPTIONS}
              value={farmerCropPill}
              onSelect={v => {
                if (v === "__other__") { setFarmerCropPill("__other__"); }
                else { setFarmerCropPill(v); setFarmerCropText(""); }
              }}
              otherText={farmerCropText}
              onOtherChange={setFarmerCropText}
              otherPlaceholder="作物名を入力（例：ブロッコリー）"
            />
          </>)}

          {isFarmer && step === 2 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>作業内容を選んでください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>募集する作業を選びます。一覧にない場合は「その他」から入力できます。</p>
            <LFCropGrid
              options={TASK_OPTIONS}
              value={farmerTaskPill}
              onSelect={v => {
                if (v === "__other__") { setFarmerTaskPill("__other__"); }
                else { setFarmerTaskPill(v); setFarmerTaskText(""); }
              }}
              otherText={farmerTaskText}
              onOtherChange={setFarmerTaskText}
              otherPlaceholder="作業名を入力（例：畝立て、マルチ張り）"
            />
          </>)}

          {isFarmer && step === 3 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>場所を入力してください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>作業場所の住所を入力します。番地・建物名は求人票には公開されず、面接・打合せ時に共有されます。</p>

            <LFWizCard>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>郵便番号</label>
                <div style={{ display:"flex", gap:8, alignItems:"stretch", marginBottom:8 }}>
                  <input
                    value={farmerZip}
                    onChange={e => setFarmerZip(e.target.value)}
                    placeholder="例：779-3401"
                    className="field f-sans"
                    style={{ fontSize:16, flex:1, marginBottom:0 }}
                  />
                  <button onClick={searchZip} disabled={zipSearching} className="f-sans" style={{
                    padding:"0 16px", borderRadius:8, border:"1px solid #DADADA",
                    background:"#fff", color:"#222", fontSize:13, fontWeight:600,
                    cursor: zipSearching ? "default" : "pointer", whiteSpace:"nowrap",
                  }}>{zipSearching ? "検索中..." : "住所を検索"}</button>
                </div>
                {zipError && <p className="f-sans" style={{ fontSize:12, color:"#E53935", marginBottom:12 }}>{zipError}</p>}
                <label className="f-sans" style={lfStyles.inputLabel}>都道府県</label>
                <input
                  value={farmerPref}
                  onChange={e => { setFarmerPref(e.target.value); setFarmerRegion(e.target.value + farmerCity); }}
                  placeholder="例：徳島県"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12 }}
                />
                <label className="f-sans" style={lfStyles.inputLabel}>市区町村</label>
                <input
                  value={farmerCity}
                  onChange={e => { setFarmerCity(e.target.value); setFarmerRegion(farmerPref + e.target.value); }}
                  placeholder="例：吉野川市"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12 }}
                />
                <label className="f-sans" style={lfStyles.inputLabel}>番地・建物名</label>
                <input
                  value={farmerAddr}
                  onChange={e => setFarmerAddr(e.target.value)}
                  placeholder="例：山川町〇〇 1-2-3"
                  className="field f-sans"
                  style={{ fontSize:16 }}
                />
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6 }}>番地・建物名は求人票には公開されず、面接・打合せ時に共有されます。</p>
                {(!farmerZip.trim() || !farmerPref.trim() || !farmerCity.trim() || !farmerAddr.trim()) && <p className="f-sans" style={{ fontSize:12, color:"#F5A623", marginTop:4 }}>すべての住所欄を入力してください</p>}
                {/* 5-c. 最寄り駅からの移動時間 */}
                <div style={{ marginBottom:14 }}>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>最寄り駅からの移動時間</label>
                  <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                    <input value={nearestStation} onChange={e => setNearestStation(e.target.value)} placeholder="例：阿波山川駅" className="field f-sans" style={{ fontSize:14, maxWidth:160 }} />
                    <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>から</span>
                    <select value={commuteTime} onChange={e => setCommuteTime(e.target.value)} className="field f-sans" style={{ fontSize:14, maxWidth:160 }}>
                      <option value="">選択してください</option>
                      <option value="徒歩5分以内">徒歩5分以内</option>
                      <option value="徒歩10分以内">徒歩10分以内</option>
                      <option value="車5分以内">車5分以内</option>
                      <option value="車10分以内">車10分以内</option>
                      <option value="車20分以内">車20分以内</option>
                    </select>
                  </div>
                </div>
              </div>
            </LFWizCard>

            <LFPrivacyNote />
          </>)}

                    {/* ── 農家 Step3: 詳細入力 ── */}
          {isFarmer && step === 4 && farmerPurpose === "post" && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>募集人数と作業日程を入力してください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>何人募集するか、いつ作業を行うかを入力します。</p>
            <LFWizCard>
              {/* 5. 募集人数 */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>募集人数</label>
                <input type="number" value={jobCount} onChange={e => setJobCount(e.target.value)} placeholder="例：3" className="field f-mono" style={{ fontSize:16, maxWidth:100 }} />
              </div>
              {/* 3. 開催日（カレンダー） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>作業日程</label>
                <button
                  onClick={() => setShowCalendar(v => !v)}
                  style={{
                    width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12,
                    border:"1px solid", borderColor: jobDateStart ? "#00A86B" : "#EBEBEB",
                    background:"#fff", fontSize:13, cursor:"pointer", color: jobDateStart ? "#222" : "#B0B0B0", fontFamily:"inherit",
                  }}
                >{jobDateLabel}</button>
                {showCalendar && <CalendarView start={jobDateStart} end={jobDateEnd} readOnly={false} onSelect={(dt) => {
                  if (!jobDateStart || jobDateEnd) { setJobDateStart(dt); setJobDateEnd(null); }
                  else if (dt >= jobDateStart) { setJobDateEnd(dt); }
                  else { setJobDateStart(dt); setJobDateEnd(null); }
                }} />}
              </div>
            </LFWizCard>
          </>)}

          {/* ── 農家 Step3: オファー側詳細 ── */}
          {isFarmer && step === 4 && farmerPurpose === "offer" && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>候補者リスト（想定画面）</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:12 }}>作業内容・経験・勤務条件を見える化し、ミスマッチを減らすUI（構想）</p>
            <LFFakeFilterRow />
            {[
              { name:"A. T.", crop:"トマト・キュウリ", work:"収穫・定植",       exp:"4〜10年",  hourly:1200 },
              { name:"K. N.", crop:"イチゴ",           work:"収穫・選果",       exp:"1〜3年",   hourly:1100 },
              { name:"S. M.", crop:"米・大豆",         work:"草刈り・農薬散布", exp:"10年以上", hourly:1300 },
            ].map((c, i) => (
              <div key={i} style={{ padding:"14px 16px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <div style={{ width:40, height:40, borderRadius:"50%", background:"#E6F7EF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>👤</div>
                  <div style={{ flex:1 }}>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>{c.name}</p>
                    <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>{c.exp}</p>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <p className="f-mono" style={{ fontSize:14, fontWeight:700, color:"#00A86B" }}>¥{c.hourly.toLocaleString()}/h</p>
                    {AVG_COUNT >= 5 && (
                      <p className="f-sans" style={{ fontSize:10, color: c.hourly>=AVG_HOURLY ? "#00A86B" : "#F5A623" }}>平均{c.hourly>=AVG_HOURLY?"+":""}{(c.hourly-AVG_HOURLY).toLocaleString()}円</p>
                    )}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {[c.crop, c.work].map(t => <span key={t} style={{ padding:"2px 9px", borderRadius:20, background:"#F7F7F7", color:"#717171", fontSize:11 }}>{t}</span>)}
                </div>
              </div>
            ))}
            <LFPrivacyNote />
          </>)}

          {/* ── 農家 step5: 募集人数（骨格・中身は段階Bで移植） ── */}
          {isFarmer && step === 5 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>勤務条件を入力してください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>働く時間と報酬を入力します。金額に迷ったら、表示される地域の相場を参考にできます。無理のない範囲で、働き手に選ばれやすい条件を整えましょう。</p>
            <LFWizCard>
              {/* 4. 勤務時間（input type=time・iPhoneタイマー型） */}
              {(() => {
                const timeStyle = { height:48, borderRadius:12, border:"1px solid #EBEBEB", background:"#FFFFFF", color:"#222222", fontSize:16, fontWeight:700, textAlign:"center", padding:"0 10px", outline:"none", cursor:"pointer" };
                const rowStyle = { display:"flex", alignItems:"center", justifyContent:"center", gap:10, flexWrap:"wrap", marginTop:12 };
                const toTime = (h, m) => `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
                const fromTime = (val, setH, setM) => {
                  if (!val) return;
                  const [h, m] = val.split(":");
                  setH(String(Number(h)));
                  setM(m);
                };
                return (
                  <div style={{ marginBottom:14 }}>
                    <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:4 }}>勤務時間</label>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:0 }}>開始時間と終了時間を選んでください。</p>
                    <div style={rowStyle}>
                      <input type="time" value={toTime(startHour, startMinute)} onChange={e => fromTime(e.target.value, setStartHour, setStartMinute)} style={timeStyle} />
                      <span style={{ margin:"0 6px", color:"#717171", fontWeight:700, fontSize:16 }}>〜</span>
                      <input type="time" value={toTime(endHour, endMinute)} onChange={e => fromTime(e.target.value, setEndHour, setEndMinute)} style={timeStyle} />
                    </div>
                    <p className="f-sans" style={{ fontSize:12, color:"#00A86B", marginTop:8, textAlign:"center" }}>→ {workTimeLabel}</p>
                  </div>
                );
              })()}
              {/* 5-b. 休憩時間（グループ2予定） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>休憩時間</label>
                <select value={breakTime} onChange={e => setBreakTime(e.target.value)} className="field f-sans" style={{ fontSize:14, maxWidth:160 }}>
                  <option value="">選択してください</option>
                  <option value="なし">なし</option>
                  <option value="30分">30分</option>
                  <option value="60分">60分</option>
                  <option value="90分">90分</option>
                  <option value="120分">120分</option>
                </select>
              </div>
              {/* 6. 報酬 */}
              <div style={{ marginBottom:6 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:4 }}>報酬</label>
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>時給 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円）</span></label>
                <input inputMode="numeric" value={hourlyWageInput} onChange={e => setHourlyWageInput(e.target.value.replace(/[^\d]/g, ""))} placeholder="例：1200" className="field f-mono" style={{ fontSize:18, maxWidth:160 }} />
                <LFWageCompare type="時給" value={hourlyWage} avg={AVG_HOURLY} count={AVG_COUNT} />
                {hourlyViolation && (
                  <p className="f-sans" style={{ fontSize:11, color:"#E24B4A", marginTop:6 }}>徳島県の最低賃金（時給{MIN_WAGE_TOKUSHIMA.toLocaleString()}円）を下回っています。この金額では掲載できません</p>
                )}
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>日給 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円）</span></label>
                <input inputMode="numeric" value={dailyWageInput} onChange={e => setDailyWageInput(e.target.value.replace(/[^\d]/g, ""))} placeholder="例：9000" className="field f-mono" style={{ fontSize:18, maxWidth:160 }} />
                <LFWageCompare type="日給" value={dailyWage} avg={AVG_DAILY} count={AVG_COUNT} />
                {dailyViolation && (
                  <p className="f-sans" style={{ fontSize:11, color:"#E24B4A", marginTop:6 }}>徳島県の最低賃金（時給{MIN_WAGE_TOKUSHIMA.toLocaleString()}円）を下回っています。この金額では掲載できません</p>
                )}
              </div>
              <div style={{ marginBottom:14, marginTop:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>支払いタイミング</label>
                <LFPillSelect options={["即日払い（作業当日）","週末まとめ払い","月末締め・翌月払い"]} value={payTiming} onSelect={setPayTiming} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>支払方法</label>
                <LFPillSelect options={["現金手渡し","銀行振込","相談して決める"]} value={payMethod} onSelect={setPayMethod} />
              </div>
            </LFWizCard>
          </>)}

          {/* ── 農家 step6: グループ2 説明ページ（step0と同じ2カラム構造） ── */}
          {isFarmer && step === 6 && (<>
            <div className="step0-grid">
              <div>
                <div style={{ marginBottom:36 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#00A86B", margin:"0 0 8px" }}>ステップ2</p>
                  <h1 className="f-sans" style={{ fontSize:38, fontWeight:800, color:"#222", lineHeight:1.25, margin:"0 0 20px" }}>ここからは任意です</h1>
                  <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.7, margin:0 }}>ここから先は、入力しなくても求人を出せます。ですが、写真や作業の詳しい説明、勤務条件などを加えると、働き手が「ここで働きたい」と感じやすくなります。あなたの求人を、もっと魅力的にしましょう。</p>
                </div>
              </div>
              <div style={{ background:"#fff", border:"1px solid #EEE", borderRadius:16, overflow:"hidden", boxShadow:"0 4px 16px rgba(0,0,0,0.06)" }}>
                <div style={{ height:200, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:80 }}>📸</div>
                <div style={{ padding:"20px 24px 24px" }}>
                  <p className="f-sans" style={{ fontSize:18, fontWeight:700, color:"#222", margin:"0 0 6px" }}>写真・条件がそろった求人は</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 12px" }}>働き手に選ばれやすくなります</p>
                  <p className="f-mono" style={{ fontSize:20, fontWeight:700, color:"#00A86B", margin:0 }}>応募 ↑</p>
                </div>
              </div>
            </div>
            <div style={{ position:"absolute", bottom:24, right:20, zIndex:2 }}>
              <button onClick={() => setStep(7)} className="btn-primary" style={{ padding:"14px 40px", fontSize:15, fontWeight:700 }}>次へ</button>
            </div>
          </>)}

          {/* ── 農家 step7: 写真 ── */}
          {isFarmer && step === 7 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>写真</h2>
            <p className="f-sans" style={lfStyles.subtitle}>最初の1枚が、働き手が最初に目にする「顔」になります。畑の全景・作業の様子・収穫物が伝わる写真ほど、応募が増えます。（最大10枚・1枚目がカバー写真になります）</p>
            <LFWizCard>
                  {/* アップロードボタン（multiple・残り枠まで直列処理） */}
                  <div style={{ marginBottom: jobPhotos.length > 0 ? 16 : 0 }}>
                    <label className="f-sans btn-primary" style={{ display:"inline-block", padding:"12px 24px", fontSize:14, fontWeight:700, cursor: photoUploading ? "wait" : "pointer", opacity: (photoUploading || jobPhotos.length >= 10) ? 0.5 : 1 }}>
                      {photoUploading ? "アップロード中..." : "＋ 写真を追加"}
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} disabled={photoUploading || jobPhotos.length >= 10} onChange={async e => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;
                        const room = 10 - jobPhotos.length;
                        const queue = files.slice(0, room);
                        setPhotoUploading(true);
                        const uploaded = [];
                        for (const file of queue) {
                          try {
                            const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
                            const path = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
                            const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file);
                            if (upErr) throw upErr;
                            const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(path);
                            if (urlData?.publicUrl) uploaded.push({ url: urlData.publicUrl, caption: "" });
                          } catch (err) {
                            console.error('photo upload failed', file.name, err);
                          }
                        }
                        if (uploaded.length > 0) setJobPhotos(prev => [...prev, ...uploaded]);
                        if (uploaded.length < queue.length) {
                          alert(`${queue.length - uploaded.length}枚のアップロードに失敗しました。通信環境を確認して、もう一度お試しください。`);
                        }
                        setPhotoUploading(false);
                        e.target.value = '';
                      }} />
                    </label>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:8 }}>{jobPhotos.length} / 10 枚</p>
                  </div>

                  {/* 空状態：大タップゾーン */}
                  {jobPhotos.length === 0 && (
                    <label className="f-sans" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"48px 24px", border:"2px dashed #D8D8D8", borderRadius:16, cursor: photoUploading ? "wait" : "pointer", background:"#FAFAFA", textAlign:"center" }}>
                      <span style={{ fontSize:44, lineHeight:1 }}>📷</span>
                      <span className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>写真をドロップ、またはタップして追加</span>
                      <span className="f-sans" style={{ fontSize:12, color:"#B0B0B0", maxWidth:280, lineHeight:1.6 }}>畑の全景・作業の様子・収穫物が伝わる写真ほど、応募が増えます。1枚目がカバー写真になります。</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} disabled={photoUploading} onChange={async e => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;
                        const queue = files.slice(0, 10);
                        setPhotoUploading(true);
                        const uploaded = [];
                        for (const file of queue) {
                          try {
                            const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
                            const path = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
                            const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file);
                            if (upErr) throw upErr;
                            const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(path);
                            if (urlData?.publicUrl) uploaded.push({ url: urlData.publicUrl, caption: "" });
                          } catch (err) {
                            console.error('photo upload failed', file.name, err);
                          }
                        }
                        if (uploaded.length > 0) setJobPhotos(prev => [...prev, ...uploaded]);
                        if (uploaded.length < queue.length) {
                          alert(`${queue.length - uploaded.length}枚のアップロードに失敗しました。通信環境を確認して、もう一度お試しください。`);
                        }
                        setPhotoUploading(false);
                        e.target.value = '';
                      }} />
                    </label>
                  )}

                  {/* 追加後：カバー大・以降小グリッド */}
                  {jobPhotos.length > 0 && (
                    <div>
                      <div style={{ position:"relative", marginBottom:10 }}>
                        <img src={jobPhotos[0].url} alt="カバー写真" style={{ width:"100%", height:260, objectFit:"cover", borderRadius:14, border:"1px solid #EEE" }} />
                        <span className="f-sans" style={{ position:"absolute", top:10, left:10, padding:"4px 12px", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, fontWeight:700, borderRadius:8 }}>カバー</span>
                        <button onClick={() => setJobPhotos(prev => prev.filter((_, j) => j !== 0))} style={{ position:"absolute", top:8, right:8, width:28, height:28, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:15, cursor:"pointer", lineHeight:1 }}>×</button>
                      </div>
                      {jobPhotos.length > 1 && (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                          {jobPhotos.slice(1).map((p, i) => {
                            const idx = i + 1;
                            return (
                              <div key={idx} style={{ position:"relative" }}>
                                <img src={p.url} alt={`写真${idx+1}`} style={{ width:100, height:100, objectFit:"cover", borderRadius:10, border:"1px solid #EEE" }} />
                                <button onClick={() => setJobPhotos(prev => prev.filter((_, j) => j !== idx))} style={{ position:"absolute", top:-6, right:-6, width:22, height:22, borderRadius:"50%", border:"none", background:"#222", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </LFWizCard>
          </>)}

          {/* ── 農家 step8: 作業説明文 ── */}
          {isFarmer && step === 8 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>作業の説明</h2>
            <p className="f-sans" style={lfStyles.subtitle}>どんな作業をするか、自由に書けます。空欄のままでも、作業内容に応じた説明が自動で入ります。思いつくことから書いてみましょう。</p>
            <LFWizCard>
              <textarea
                value={jobDescription}
                onChange={e => setJobDescription(e.target.value)}
                placeholder="例：ブロッコリーの収穫と箱詰めをお願いします。畑は平坦で、初めての方でも当日にコツをお教えします。10時と15時に休憩があります。"
                maxLength={1000}
                style={{ background:"#fff", color:"#222", width:"100%", minHeight:200, padding:"16px", fontSize:15, lineHeight:1.8, border:"1px solid #E5E5E5", borderRadius:14, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
              />
              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:8, textAlign:"right" }}>{jobDescription.length} / 1000</p>
            </LFWizCard>

    {jobPhotos.length > 0 && (
      <LFWizCard>
        <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:6 }}>写真ごとの説明</p>
        <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:14 }}>写真を選ぶと、その写真について一言添えられます。</p>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
          {jobPhotos.map((p, i) => (
            <button key={i} onClick={() => { setSelectedPhotoIndex(i); captionTextareaRef.current?.focus(); }} style={{ padding:0, border: i === selectedPhotoIndex ? "3px solid #00A86B" : "3px solid transparent", borderRadius:12, cursor:"pointer", background:"none", lineHeight:0 }}>
              <img src={p.url} alt={`写真${i+1}`} style={{ width:84, height:84, objectFit:"cover", borderRadius:9, opacity: i === selectedPhotoIndex ? 1 : 0.6 }} />
            </button>
          ))}
        </div>
        <div style={{ position:"relative" }}>
          <img src={jobPhotos[selectedPhotoIndex]?.url} alt="選択中の写真" style={{ width:"100%", height:200, objectFit:"cover", borderRadius:14, marginBottom:10 }} />
        </div>
        <textarea
          ref={captionTextareaRef}
          value={jobPhotos[selectedPhotoIndex]?.caption ?? ""}
          onChange={e => setJobPhotos(prev => prev.map((p, i) => i === selectedPhotoIndex ? { ...p, caption: e.target.value } : p))}
          placeholder="この写真について一言（例：収穫するブロッコリー畑です）"
          maxLength={100}
          style={{ width:"100%", minHeight:80, padding:"14px", fontSize:14, lineHeight:1.6, background:"#fff", color:"#222", border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
        />
      </LFWizCard>
    )}

          </>)}

          {/* ── 農家 step10: 危険箇所 ── */}
          {isFarmer && step === 9 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>危険な作業・場所</h2>
            <p className="f-sans" style={lfStyles.subtitle}>危険な場所や作業を入力できます。写真や補足説明を添えると、より正確に伝わります。安心して働けるよう、気になる危険は正直に伝えましょう。</p>
            <LFWizCard>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な場所（任意）</label>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な場所があれば入力してください。</p>
                {jobDangerPlaces.slice(0, showPlace2 ? 2 : 1).map((place, i) => (
                  <div key={i} style={{ marginBottom:8 }}>
                    <input value={place.label} onChange={e => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, label: e.target.value } : p))} placeholder={`危険な場所${i + 1}（例：ぬかるみ）`} className="field f-sans" style={{ fontSize:14, marginBottom:4 }} />
                    <input value={place.desc} onChange={e => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, desc: e.target.value } : p))} placeholder="補足説明（例：雨上がりは特に滑りやすい）" className="field f-sans" style={{ fontSize:13 }} />
                        <div style={{ display:"flex", gap:8, marginTop:6 }}>
                          {[0,1].map(k => {
                            const ph = place.photos?.[k];
                            return ph ? (
                              <div key={k} style={{ position:"relative", flex:1, height:90, borderRadius:10, overflow:"hidden", border:"1px solid #EEE" }}>
                                <img src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                                <button onClick={() => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, photos: p.photos.filter((_, x) => x !== k) } : p))} style={{ position:"absolute", top:4, right:4, width:22, height:22, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                              </div>
                            ) : (
                              <label key={k} style={{ flex:1, height:90, border:"2px dashed #D8D8D8", borderRadius:10, background:"#FAFAFA", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, cursor:"pointer" }}>
                                <span style={{ fontSize:22, lineHeight:1, opacity:0.6 }}>📷</span>
                                <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>写真を追加</span>
                                <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} onChange={async e => {
                                  const files = Array.from(e.target.files || []);
                                  if (files.length === 0) return;
                                  const room = 2 - (place.photos?.length || 0);
                                  const queue = files.slice(0, room);
                                  const uploaded = [];
                                  for (const file of queue) {
                                    try {
                                      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
                                      const path = 'danger_' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
                                      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file);
                                      if (upErr) throw upErr;
                                      const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(path);
                                      if (urlData?.publicUrl) uploaded.push({ url: urlData.publicUrl });
                                    } catch (err) { console.error('danger photo upload failed', err); }
                                  }
                                  if (uploaded.length > 0) setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, photos: [...(p.photos||[]), ...uploaded] } : p));
                                  if (uploaded.length < queue.length) { alert('一部の写真のアップロードに失敗しました。もう一度お試しください。'); }
                                  e.target.value = '';
                                }} />
                              </label>
                            );
                          })}
                        </div>
                  </div>
                ))}
                    {!showPlace2 ? (
                      <button onClick={() => setShowPlace2(true)} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"10px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600 }}>＋ 危険な場所をもう1つ追加</button>
                    ) : (
                      <button onClick={() => { setShowPlace2(false); setJobDangerPlaces(prev => prev.map((p, j) => j === 1 ? { ...p, label:"", desc:"" } : p)); }} className="f-sans" style={{ background:"none", border:"none", padding:"6px", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>× 2つ目を削除</button>
                    )}
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な作業（任意）</label>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な作業があれば入力してください。</p>
                {jobDangerTasks.slice(0, showTask2 ? 2 : 1).map((task, i) => (
                  <div key={i} style={{ marginBottom:8 }}>
                    <input value={task.label} onChange={e => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, label: e.target.value } : t))} placeholder={`危険な作業${i + 1}（例：重いコンテナの運搬）`} className="field f-sans" style={{ fontSize:14, marginBottom:4 }} />
                    <input value={task.desc} onChange={e => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, desc: e.target.value } : t))} placeholder="補足説明（例：腰を痛めないよう正しい持ち方が必要）" className="field f-sans" style={{ fontSize:13 }} />
                        <div style={{ display:"flex", gap:8, marginTop:6 }}>
                          {[0,1].map(k => {
                            const ph = task.photos?.[k];
                            return ph ? (
                              <div key={k} style={{ position:"relative", flex:1, height:90, borderRadius:10, overflow:"hidden", border:"1px solid #EEE" }}>
                                <img src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                                <button onClick={() => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, photos: t.photos.filter((_, x) => x !== k) } : t))} style={{ position:"absolute", top:4, right:4, width:22, height:22, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                              </div>
                            ) : (
                              <label key={k} style={{ flex:1, height:90, border:"2px dashed #D8D8D8", borderRadius:10, background:"#FAFAFA", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, cursor:"pointer" }}>
                                <span style={{ fontSize:22, lineHeight:1, opacity:0.6 }}>📷</span>
                                <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>写真を追加</span>
                                <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} onChange={async e => {
                                  const files = Array.from(e.target.files || []);
                                  if (files.length === 0) return;
                                  const room = 2 - (task.photos?.length || 0);
                                  const queue = files.slice(0, room);
                                  const uploaded = [];
                                  for (const file of queue) {
                                    try {
                                      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
                                      const path = 'danger_' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
                                      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file);
                                      if (upErr) throw upErr;
                                      const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(path);
                                      if (urlData?.publicUrl) uploaded.push({ url: urlData.publicUrl });
                                    } catch (err) { console.error('danger photo upload failed', err); }
                                  }
                                  if (uploaded.length > 0) setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, photos: [...(t.photos||[]), ...uploaded] } : t));
                                  if (uploaded.length < queue.length) { alert('一部の写真のアップロードに失敗しました。もう一度お試しください。'); }
                                  e.target.value = '';
                                }} />
                              </label>
                            );
                          })}
                        </div>
                  </div>
                ))}
                    {!showTask2 ? (
                      <button onClick={() => setShowTask2(true)} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"10px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600 }}>＋ 危険な作業をもう1つ追加</button>
                    ) : (
                      <button onClick={() => { setShowTask2(false); setJobDangerTasks(prev => prev.map((t, j) => j === 1 ? { ...t, label:"", desc:"" } : t)); }} className="f-sans" style={{ background:"none", border:"none", padding:"6px", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>× 2つ目を削除</button>
                    )}
              </div>
            </LFWizCard>
          </>)}

          {/* ── 農家 step11: 持ち物・備考＋必要経験 ── */}
          {isFarmer && step === 10 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>働き手への希望</h2>
            <p className="f-sans" style={lfStyles.subtitle}>持ち物や注意事項、求める経験など、働き手に伝えておきたいことを入力できます。作業に必要な道具や安全への備えは、受け入れる農家側でご用意・ご対応ください。（すべて任意です）</p>
            <LFWizCard>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>持ち物（任意）</label>
                <textarea value={jobNotes} onChange={e => setJobNotes(e.target.value)} placeholder="例：長靴、軍手、飲み物" className="field f-sans" rows={2} style={{ fontSize:13, resize:"vertical" }} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>注意事項（任意）</label>
                <textarea value={jobCautions} onChange={e => setJobCautions(e.target.value)} placeholder="例：天候により作業時間が変わることがあります" className="field f-sans" rows={2} style={{ fontSize:13, resize:"vertical" }} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>必要経験（任意）</label>
                <LFPillSelect options={["未経験可","1回以上","3回以上","農家経験者"]} value={jobExp} onSelect={setJobExp} />
              </div>
            </LFWizCard>
          </>)}

          {/* ── ページX: 移植待ち退避ブロック（step90=農家フロー非到達。グループ2/3項目をここに貯蔵し、移植先ができ次第移す。退避項目の次へ条件・バリデーションは付けない） ── */}
          {isFarmer && step === 90 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>移植待ち項目（退避所）</h2>
            <p className="f-sans" style={lfStyles.subtitle}>開発用の退避所です。農家フローには表示されません。移植先ができ次第、各ページへ移します。</p>
            <LFWizCard>
              {/* 8. 募集文テンプレート（グループ2予定） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>募集文テンプレート</label>
                <LFPillSelect options={["収穫補助","選果作業","定植作業","草刈り"]} value={jobTemplate} onSelect={setJobTemplate} />
              </div>
            </LFWizCard>
          </>)}

          {/* ── 農家 Step3: Airbnb風 掲載プレビュー確認 ── */}
          {/* ── 農家 Step3: Airbnb風 掲載プレビュー確認 ── */}
          {isFarmer && step === 11 && (() => {
            const JT_MAP = {
              "収穫補助": { body:"作物の収穫、運搬補助、簡単な選別作業をお願いします。未経験の方でも、当日説明します。", items:["汚れてもよい服","長靴","手袋","飲み物","帽子"], notes:"屋外作業のため、天候により時間変更の可能性があります。" },
              "選果作業": { body:"収穫した作物の仕分け、箱詰め、出荷前の確認作業をお願いします。", items:["動きやすい服","飲み物","手袋"], notes:"立ち作業が中心になる場合があります。" },
              "定植作業": { body:"苗の植え付け、苗運び、簡単な圃場作業をお願いします。", items:["長靴","手袋","汚れてもよい服","飲み物"], notes:"土に触れる作業があります。" },
              "草刈り":   { body:"圃場周辺の草刈り、片付け、運搬補助をお願いします。", items:["長袖","長ズボン","飲み物","タオル"], notes:"機械を使う作業は経験者のみを想定しています。" },
            };
            const tmpl = JT_MAP[jobTemplate] || JT_MAP["収穫補助"];
            const titleRequired = `${farmerCrop || "作物"}${farmerTask || "作業"}スタッフ ${jobCount ? jobCount + "人募集" : ""}`.trim();
            const titleOptional = [
              nearestStation ? `${nearestStation}から${commuteTime || ""}`.trim() : "",
            ].filter(Boolean).join("・");
            const listingTitle = titleOptional ? `${titleRequired}｜${titleOptional}` : titleRequired;
            const subInfo = [farmerRegion || "地域未入力", jobDateLabel !== "日程を選択してください" ? jobDateLabel : "日程未設定", workTimeLabel].join("・");
            const rewardLabel = hourlyWage > 0 ? `¥${hourlyWage.toLocaleString()} / 時` : dailyWage > 0 ? `¥${dailyWage.toLocaleString()} / 日` : "未設定";
            const wageType = hourlyWage > 0 ? "時給" : "日給";
            const wageNum  = hourlyWage > 0 ? hourlyWage : dailyWage;
            const avgWage  = hourlyWage > 0 ? AVG_HOURLY : AVG_DAILY;
            const maxPay = calcFarmerMaxPay();
            const periodLabel = jobDateStart ? (jobDateLabel !== "日程を選択してください" ? jobDateLabel : "未設定") : "未設定";
            const ConfCalendar = () => {
              if (!jobDateStart) return null;
              const WD2 = ["日","月","火","水","木","金","土"];
              const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();
              const end = jobDateEnd || jobDateStart;
              // 開始月〜終了月を列挙
              const months = [];
              let y = jobDateStart.getFullYear(), m = jobDateStart.getMonth();
              const ey = end.getFullYear(), em = end.getMonth();
              while (y < ey || (y === ey && m <= em)) {
                months.push({ y, m });
                if (m === 11) { y++; m = 0; } else m++;
                if (months.length > 12) break; // 安全弁
              }
              const LIMIT = 3;
              const shown = months.slice(0, LIMIT);
              const fmtEnd = `${end.getFullYear()}/${String(end.getMonth()+1).padStart(2,"0")}/${String(end.getDate()).padStart(2,"0")}（${WD2[end.getDay()]}）`;
              const renderMonth = ({ y, m }) => {
                const firstDay = new Date(y, m, 1).getDay();
                const daysInMonth = new Date(y, m + 1, 0).getDate();
                const cells = [];
                for (let i = 0; i < firstDay; i++) cells.push(null);
                for (let dd = 1; dd <= daysInMonth; dd++) cells.push(dd);
                return (
                  <div key={`${y}-${m}`} style={{ marginBottom:12 }}>
                    <div style={{ textAlign:"center", marginBottom:10 }}>
                      <span className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>{y}年{m+1}月</span>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
                      {WD2.map(wd => <div key={wd} style={{ textAlign:"center", fontSize:10, color:"#B0B0B0", padding:"3px 0" }}>{wd}</div>)}
                      {cells.map((dd, i) => {
                        if (!dd) return <div key={`e${i}`} />;
                        const dt = new Date(y, m, dd);
                        const isStart = sameDay(dt, jobDateStart);
                        const isEnd   = sameDay(dt, jobDateEnd);
                        const inRange = jobDateStart && jobDateEnd && dt > jobDateStart && dt < jobDateEnd;
                        return (
                          <div key={dd} style={{
                            padding:"7px 2px", borderRadius:8, fontSize:13, textAlign:"center",
                            background: (isStart||isEnd) ? "#00A86B" : inRange ? "#E6F7EF" : "transparent",
                            color: (isStart||isEnd) ? "#fff" : inRange ? "#00A86B" : "#222",
                            fontWeight: (isStart||isEnd) ? 700 : 400,
                          }}>{dd}</div>
                        );
                      })}
                    </div>
                  </div>
                );
              };
              return (
                <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:14, marginBottom:16 }}>
                  {shown.map(renderMonth)}
                  {months.length > LIMIT && (
                    <p className="f-sans" style={{ fontSize:11, color:"#717171", textAlign:"center", marginTop:4 }}>ほか {months.length - LIMIT} か月　〜 {fmtEnd} まで</p>
                  )}
                </div>
              );
            };
            const diffWage = wageNum > 0 ? wageNum - avgWage : 0;

            // プロフィール完成度
            const profileFields = [farmerDisplayName, farmerRegion, farmerCrop, farmerTask, farmerWanted, farmerPayType, jobCount, jobDateStart, workTimeLabel, hourlyWageInput || dailyWageInput];
            const fieldNames     = ["表示名","地域","作物","作業","希望する働き手","支払い方式","募集人数","作業日程","勤務時間","報酬"];
            const filledCount   = profileFields.filter(Boolean).length;
            const profilePct    = Math.round(filledCount / profileFields.length * 100);
            const missingFields = fieldNames.filter((_, i) => !profileFields[i]);

            // jobs INSERT用ペイロードはトップレベルに移設（saveDraftToSupabaseからも参照するため）
            const handleSaveJob = async () => {
              if (jobSaving) return;
              setJobSaving(true);
              try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session || !isAdmin(session.user)) { saveDraft(); onLogin(); return; }
                let _jn = draftJobNumber;
                if (!_jn) { try { const _d = JSON.parse(localStorage.getItem("landingFlowDraft_v1")||"{}"); _jn = _d.job_number ?? null; } catch {} }
                let error;
                if (_jn) {
                  const r = await supabase.from("jobs").update(buildJobPayload(session.user.id, "pending")).eq("job_number", _jn).eq("farmer_id", session.user.id);
                  error = r.error;
                } else {
                  const r = await supabase.from("jobs").insert(buildJobPayload(session.user.id, "pending")).select("job_number").single();
                  error = r.error;
                  if (!error && r.data) setDraftJobNumber(r.data.job_number);
                }
                if (error) { alert("掲載エラー: " + error.message); return; }
                try { localStorage.removeItem("landingFlowDraft_v1"); } catch {}
                setDraftJobNumber(null);
                setStep(12);
              } catch (e) {
                alert("【管理者デバッグ】catch: " + (e?.message || e));
              } finally {
                setJobSaving(false);
              }
            };

            const handleSaveDraft = async () => {
              if (draftSaving) return;
              setDraftSaving(true); setDraftMsg("");
              const res = await saveDraftToSupabase();
              setDraftSaving(false);
              if (res.ok) {
                setDraftBarFull(true);
                try { sessionStorage.setItem("cb_afterDraftSave","1"); } catch {}
                setDraftMsg("作成中に保存しました（求人番号 " + res.jobNumber + "）");
                setDraftOverlay(true);
                setTimeout(() => { setDraftOverlay(false); window.location.hash = "/work"; if (typeof onComplete === "function") onComplete(); }, 1100);
              } else if (res.reason === "no_session") {
                saveDraft(); onLogin();
              } else {
                setDraftMsg("保存に失敗しました：" + res.reason);
              }
            };

            const tagStyle = { padding:"6px 14px", borderRadius:20, background:"#F7F7F7", color:"#717171", fontSize:13 };
            const inputSt = { width:"100%", height:48, borderRadius:14, border:"1px solid #E5E5E5", fontSize:15, padding:"0 14px", outline:"none", boxSizing:"border-box" };

            return (<>
              {/* タイトル */}
              <h2 className="f-sans" style={{ fontSize:"clamp(20px,3vw,30px)", fontWeight:850, color:"#222", marginBottom:6, lineHeight:1.3 }}>
                掲載イメージを確認してください
              </h2>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>働き手には、以下のように表示されます。</p>

              {/* 公開イメージ：タイトル＋住所（公開求人と同一構造） */}
              <div style={{ marginBottom:20 }}>
                <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>{farmerCrop || "作物"} {farmerTask || "作業"}</h2>
                <p className="f-sans" style={{ fontSize:14, color:"#717171", margin:0, marginTop:2 }}>{farmerRegion || "地域未設定"}</p>
              </div>

              {/* 公開イメージ・セクション②：写真ギャラリー（公開求人と同サイズ・ダミー） */}
              {(() => {
                const cropIcon = farmerCrop && farmerCrop.includes("ブロッコリー") ? "🥦" : farmerCrop && farmerCrop.includes("なす") ? "🍆" : farmerCrop && farmerCrop.includes("トマト") ? "🍅" : farmerCrop && farmerCrop.includes("ねぎ") ? "🌿" : "🌱";
                const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
                return (
                  <div style={{ marginBottom:28, maxWidth:1000, margin:"0 auto 28px" }}>
                    <div style={{ position:"relative", maxWidth:870, margin:"0 auto" }}>
                      <div ref={confScrollRef} onScroll={e => { const w = e.currentTarget.offsetWidth; if (w > 0) setConfActiveSlide(Math.round(e.currentTarget.scrollLeft / w)); }} style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory", borderRadius:12 }}>
                        {jobPhotos.length > 0
                          ? jobPhotos.map((p, i) => (
                              <div key={i} style={{ position:"relative", flexShrink:0, width:"100%", height:391, borderRadius:12, background:"#F0F0F0", scrollSnapAlign:"start" }}>
                                <img src={p.url} alt={`写真${i+1}`} style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:12 }} />
                                {p.caption && (
                                  <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 20px 16px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:14, fontWeight:600, borderRadius:"0 0 12px 12px", boxSizing:"border-box" }}>{p.caption}</div>
                                )}
                              </div>
                            ))
                          : [0, 1, 2].map(i => (
                              <div key={i} style={{ flexShrink:0, width:"100%", height:391, borderRadius:12, background:bgColors[i % bgColors.length], display:"flex", alignItems:"center", justifyContent:"center", fontSize:72, scrollSnapAlign:"start" }}>{cropIcon}</div>
                            ))}
                      </div>
                      <button onClick={() => { const el = confScrollRef.current; if (el) el.scrollBy({ left: -el.offsetWidth, behavior:"smooth" }); }} style={{ position:"absolute", top:"50%", left:12, transform:"translateY(-50%)", width:40, height:40, borderRadius:"50%", border:"none", background:"rgba(255,255,255,0.9)", boxShadow:"0 2px 8px rgba(0,0,0,0.15)", cursor:"pointer", fontSize:18, color:"#222", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
                      <button onClick={() => { const el = confScrollRef.current; if (el) el.scrollBy({ left: el.offsetWidth, behavior:"smooth" }); }} style={{ position:"absolute", top:"50%", right:12, transform:"translateY(-50%)", width:40, height:40, borderRadius:"50%", border:"none", background:"rgba(255,255,255,0.9)", boxShadow:"0 2px 8px rgba(0,0,0,0.15)", cursor:"pointer", fontSize:18, color:"#222", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
                    </div>
                    <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:8 }}>
                      {(jobPhotos.length > 0 ? jobPhotos.map((_, i) => i) : [0, 1, 2]).map(i => (
                        <span key={i} style={{ fontSize:10, color: i === confActiveSlide ? "#00A86B" : "#D0D0D0" }}>{i === confActiveSlide ? "●" : "○"}</span>
                      ))}
                    </div>
                    {jobPhotos.length === 0 && <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", textAlign:"center", marginTop:8 }}>※ 写真は後から登録できます。現在はイメージです。</p>}
                  </div>
                );
              })()}

              {/* ═══ 2カラムグリッド ═══ */}
              <div className="lf-preview-grid">

                {/* ── 左: 掲載プレビュー ── */}
                <div>
                  <h3 className="f-sans" style={{ fontSize:"clamp(20px,2.5vw,26px)", fontWeight:800, color:"#222", marginBottom:6, lineHeight:1.3 }}>{listingTitle}</h3>
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:18 }}>{subInfo}</p>
                  <div style={{ borderBottom:"1px solid #EBEBEB", marginBottom:20 }} />

                  {/* 募集概要カード */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:20 }}>
                    {[
                      { label:"作物",   value:farmerCrop || "未設定" },
                      { label:"作業",   value:farmerTask || "未設定" },
                      { label:"人数",   value:jobCount ? `${jobCount}人募集` : "未設定" },
                      { label:"経験",   value:jobExp || "未設定" },
                    ].map(item => (
                      <div key={item.label} style={{ padding:"14px 16px", background:"#F7F7F7", borderRadius:16 }}>
                        <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", marginBottom:4 }}>{item.label}</p>
                        <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>{item.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* 農家プロフィール（公開イメージ・確認ページにある変数のみ使用） */}
                  <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 0", borderBottom:"1px solid #F7F7F7", marginBottom:16 }}>
                    <div style={{ width:44, height:44, borderRadius:"50%", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🧑‍🌾</div>
                    <div>
                      <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, marginBottom:2 }}>{farmerDisplayName || "農園名未設定"}</p>
                      <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0 }}>{farmerExp ? `就農 ${farmerExp}` : "就農歴未設定"}</p>
                    </div>
                  </div>

                  {/* 募集本文 */}
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:10 }}>募集内容</p>
                  <p className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.85, marginBottom:16, whiteSpace:"pre-wrap" }}>{jobDescription || tmpl.body}</p>

                  {/* 持ち物・注意事項 */}
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:10 }}>持ち物・注意事項</p>
                  {jobNotes && jobNotes.trim() ? (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
                      {jobNotes.split(/[、,，\n]/).map(n => n.trim()).filter(Boolean).map((n,i) => (
                        <span key={i} style={{ ...tagStyle, background:"#FEF3E2", color:"#F5A623" }}>📌 {n}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="f-sans" style={{ fontSize:14, color:"#B0B0B0", marginBottom:8 }}>未設定</p>
                  )}
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:10, marginTop:16 }}>注意事項</p>
                  <p className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.85, marginBottom:8, whiteSpace:"pre-wrap" }}>{jobCautions && jobCautions.trim() ? jobCautions : "未設定"}</p>
                  {/* 必要経験・希望する働き手（公開イメージ） */}
                  <div style={{ borderTop:"1px solid #F7F7F7", paddingTop:16 }}>
                    <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:4 }}>💪 必要経験</p>
                    <p className="f-sans" style={{ fontSize:14, color:"#222", marginBottom:14 }}>{jobExp || "未設定"}</p>
                    <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:4 }}>🙋 希望する働き手</p>
                    <p className="f-sans" style={{ fontSize:14, color:"#222", margin:0 }}>{farmerWanted || "未設定"}</p>
                  </div>
                </div>

                {/* ── 右: 編集パネル ── */}
                <div style={{ position:"sticky", top:88, border:"1px solid #EBEBEB", borderRadius:28, padding:24, background:"#fff", boxShadow:"0 16px 40px rgba(0,0,0,0.10)" }}>
                  {/* 報酬・最高額・期間 */}
                  <p className="f-mono" style={{ fontSize:26, fontWeight:800, color:"#222", marginBottom:6 }}>{rewardLabel}</p>
                  {maxPay > 0 && (
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:16 }}>期間内に全て勤務した場合の最高額：<span className="f-mono" style={{ fontWeight:700, color:"#00A86B" }}>¥{maxPay.toLocaleString()}</span></p>
                  )}
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"12px 0", borderTop:"1px solid #F0F0F0", borderBottom:"1px solid #F0F0F0", marginBottom:16 }}>
                    <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>期間</span>
                    <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222" }}>{periodLabel}</span>
                  </div>
                  <ConfCalendar />
                  {/* 保存ボタン */}
                  <button
                    onClick={handleSaveJob}
                    disabled={jobSaving}
                    className="btn-primary"
                    style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:14, marginBottom:10 }}
                  >
                    {jobSaving ? "保存中..." : "掲載する"}
                  </button>
                  <button
                    onClick={handleSaveDraft}
                    disabled={draftSaving}
                    className="f-sans"
                    style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:14, marginBottom:8, background:"#F7F7F7", border:"1px solid #DDD", color:"#222", cursor:"pointer" }}
                  >
                  {draftSaving ? "保存中..." : "一時保存（作成中に残す）"}
                  </button>
                  {draftMsg && <p className="f-sans" style={{ fontSize:11, color:draftMsg.startsWith("保存に失敗") ? "#E24B4A" : "#00A86B", textAlign:"center", marginBottom:8 }}>{draftMsg}</p>}
                  <p className="f-sans" style={{ fontSize:11, color:"#8A6D1D", background:"#FFF8E7", padding:"8px 12px", borderRadius:8, textAlign:"center", marginBottom:8 }}>「掲載する」を押しても、すぐには掲載されません。運営の確認後に公開されます。</p>
                  {draftOverlay && (
                    <div style={{ position:"fixed", inset:0, background:"rgba(255,255,255,0.92)", zIndex:9999, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
                      <div style={{ width:44, height:44, border:"4px solid #E0E0E0", borderTopColor:"#00A86B", borderRadius:"50%", animation:"cbspin 0.8s linear infinite" }} />
                      <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700 }}>保存しています…</p>
                      <style>{`@keyframes cbspin { to { transform: rotate(360deg); } }`}</style>
                    </div>
                  )}
                </div>
              </div>
              {/* ═══ 大きな地図（2カラムの後・移動先） ═══ */}
              <a href={buildGoogleMapsUrl(farmerRegion)} target="_blank" rel="noopener noreferrer" style={{ display:"block", textDecoration:"none", color:"inherit", marginBottom:28, maxWidth:1000, margin:"0 auto 28px" }}>
                <div className="lf-map-hero" style={{ width:"100%", maxWidth:870, height:479, margin:"0 auto", borderRadius:28, overflow:"hidden", position:"relative", border:"1px solid #EBEBEB", background:"linear-gradient(145deg,#D8EFE0 0%,#E8F4F0 35%,#F0EBD8 65%,#D8EFE0 100%)", boxShadow:"0 12px 36px rgba(0,0,0,0.08)", cursor:"pointer" }}>
                  {/* 道路ダミー */}
                  <div style={{ position:"absolute", top:"40%", left:0, right:0, height:4, background:"rgba(255,255,255,0.6)", transform:"rotate(-1.5deg)" }} />
                  <div style={{ position:"absolute", top:"22%", left:"8%", right:"6%", height:3, background:"rgba(255,255,255,0.45)", transform:"rotate(6deg)" }} />
                  <div style={{ position:"absolute", top:0, bottom:0, left:"36%", width:3, background:"rgba(255,255,255,0.4)" }} />
                  <div style={{ position:"absolute", top:"58%", left:"55%", right:0, height:2, background:"rgba(255,255,255,0.35)", transform:"rotate(-4deg)" }} />
                  {/* ラベル */}
                  <div style={{ position:"absolute", top:14, left:14, padding:"4px 12px", background:"rgba(255,255,255,0.92)", borderRadius:12, backdropFilter:"blur(4px)" }}>
                    <span className="f-sans" style={{ fontSize:10, color:"#555", fontWeight:600 }}>勤務地エリア</span>
                  </div>
                  {/* Google Maps バッジ */}
                  <div style={{ position:"absolute", top:14, right:14, padding:"5px 12px", background:"rgba(255,255,255,0.95)", borderRadius:12, boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>
                    <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#00A86B" }}>Google Mapsで開く ↗</span>
                  </div>
                  {/* ピン */}
                  <div style={{ position:"absolute", top:"46%", left:"50%", transform:"translate(-50%,-130%)", display:"flex", flexDirection:"column", alignItems:"center" }}>
                    <div style={{ width:48, height:48, borderRadius:"50%", background:"#1a1a1a", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, boxShadow:"0 6px 20px rgba(0,0,0,0.3)" }}>📍</div>
                    <div style={{ width:0, height:0, borderLeft:"7px solid transparent", borderRight:"7px solid transparent", borderTop:"10px solid #1a1a1a", marginTop:-1 }} />
                  </div>
                  {/* 地域ラベル */}
                  <div style={{ position:"absolute", bottom:"26%", left:"50%", transform:"translateX(-50%)", padding:"8px 20px", background:"rgba(255,255,255,0.96)", borderRadius:16, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", whiteSpace:"nowrap", backdropFilter:"blur(6px)" }}>
                    <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>{farmerRegion ? `${farmerRegion} 周辺` : "地域未入力"}</p>
                  </div>
                  {/* 補助文 */}
                  <div style={{ position:"absolute", bottom:10, left:"50%", transform:"translateX(-50%)", padding:"3px 12px", background:"rgba(255,255,255,0.88)", borderRadius:10, whiteSpace:"nowrap" }}>
                    <span className="f-sans" style={{ fontSize:9, color:"#B0B0B0" }}>タップするとGoogle Mapsで開きます　詳細住所は公開されません。</span>
                  </div>
                </div>
              </a>

              {/* ═══ 詳細確認ミニ表（下部格下げ） ═══ */}
              <div style={{ maxWidth:1120, margin:"24px auto 0" }}>
                {jobDangerTasks.some(t => t.label) && (
                  <div style={{ marginTop:16 }}>
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", marginBottom:10 }}>危険な作業</p>
                    <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:4 }}>
                      {jobDangerTasks.filter(t => t.label).map((task, i) => (
                        <div key={i} style={{ flexShrink:0, width:200 }}>
                          {task.photos && task.photos.length > 0 && (
                            <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                              {task.photos.map((ph, k) => (
                                <img key={k} src={ph.url} alt="" style={{ flex:1, width:0, height:110, objectFit:"cover", borderRadius:12, border:"1px solid #EEE" }} />
                              ))}
                            </div>
                          )}
                          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0, marginTop:8 }}>{task.label}</p>
                          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginTop:2 }}>{task.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {jobDangerPlaces.some(p => p.label) && (
                  <div style={{ marginTop:16 }}>
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", marginBottom:10 }}>危険な場所</p>
                    <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:4 }}>
                      {jobDangerPlaces.filter(p => p.label).map((place, i) => (
                        <div key={i} style={{ flexShrink:0, width:200 }}>
                          {place.photos && place.photos.length > 0 && (
                            <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                              {place.photos.map((ph, k) => (
                                <img key={k} src={ph.url} alt="" style={{ flex:1, width:0, height:110, objectFit:"cover", borderRadius:12, border:"1px solid #EEE" }} />
                              ))}
                            </div>
                          )}
                          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0, marginTop:8 }}>{place.label}</p>
                          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginTop:2 }}>{place.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* レビュー（表示ダミーのみ・取引実績ベース・④⑤回答後に実装） */}
                <div style={{ marginTop:24 }}>
                  <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", marginBottom:10 }}>レビュー（公開時の表示イメージ）</p>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                    <span className="f-mono" style={{ fontSize:32, fontWeight:800, color:"#222" }}>4.8</span>
                    <span style={{ fontSize:16, color:"#00A86B", letterSpacing:1 }}>★★★★★</span>
                    <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>24件のレビュー</span>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                    {[
                      { stars:5, text:"初めての収穫作業でしたが、ていねいに教えてもらえたので安心して取り組めました。" },
                      { stars:4, text:"時間通りに終わり、当日中に報酬を支払ってもらえてとても助かりました。" },
                    ].map((review, i) => (
                      <div key={i} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px" }}>
                        <p style={{ margin:0, marginBottom:6, fontSize:13, color:"#00A86B", letterSpacing:1 }}>{"★".repeat(review.stars)}{"☆".repeat(5 - review.stars)}</p>
                        <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0 }}>{review.text}</p>
                      </div>
                    ))}
                  </div>
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:10 }}>※ レビューは実際に働いた方のみ投稿できます。現在は表示イメージです。</p>
                </div>
              </div>
            </>);
          })()}

          {/* ── 農家 Step3: 完了 ── */}
          {/* ── 農家 Step3: 完了 ── */}
          {isFarmer && step === 12 && (<>
            <div style={{ minHeight:"70vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", maxWidth:400, margin:"0 auto", padding:"0 20px" }}>
              <div style={{ fontSize:56, marginBottom:16 }}>✅</div>
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}>審査に提出されました</h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, marginBottom:28 }}>
                運営が確認後、公開されます。<br/>
                公開までしばらくお待ちください。
              </p>
              <div style={{ display:"grid", gap:10, width:"100%" }}>
                <button onClick={onComplete} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12 }}>あなたの求人を見る</button>
                <button onClick={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} if(typeof onComplete==="function") onComplete(); setTimeout(()=>{ window.location.hash="/work/new"; }, 50); }} style={{ width:"100%", padding:"13px", fontSize:13, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#222", cursor:"pointer", fontFamily:"inherit" }}>新しい求人を出す</button>
              </div>
            </div>
          </>)}

          {/* ── WORKER FLOW ── */}
{/* ── WORKER FLOW ── */}
          {isWorker && step === 1 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>農業経験を教えてください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>経験は問いません。当てはまるものをお選びください</p>
            {["未経験","経験あり"].map(v => (
              <LFCardBtn key={v} selected={workerExp===v} onClick={() => selectAndNext(setWorkerExp, v)}>
                <div className="f-sans" style={lfStyles.cardTitle}>{v}</div>
              </LFCardBtn>
            ))}
          </>)}

          {isWorker && step === 2 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>何をしたいですか？</h2>
            <p className="f-sans" style={lfStyles.subtitle}>あとから変更できます</p>
            <LFCardBtn selected={workerPurpose==="open"} onClick={() => selectAndNext(setWorkerPurpose, "open")}>
              <div className="f-sans" style={lfStyles.cardTitle}>📅 働ける日を公開する</div>
              <div className="f-sans" style={lfStyles.cardDesc}>農家からオファーを受けたい</div>
            </LFCardBtn>
            <LFCardBtn selected={workerPurpose==="search"} onClick={() => selectAndNext(setWorkerPurpose, "search")}>
              <div className="f-sans" style={lfStyles.cardTitle}>🔍 募集中の仕事を探す</div>
              <div className="f-sans" style={lfStyles.cardDesc}>自分から応募したい</div>
            </LFCardBtn>
          </>)}

          {isWorker && step === 3 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>働き手プロフィール</h2>
            <p className="f-sans" style={lfStyles.subtitle}>農家に見せる情報を入力してください</p>
            <LFWizCard>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>表示名</label>
                <input value={workerDisplayName} onChange={e => setWorkerDisplayName(e.target.value)} placeholder="例：田中 T." className="field f-sans" style={{ fontSize:16 }} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>活動地域</label>
                <input value={workerRegion} onChange={e => setWorkerRegion(e.target.value)} placeholder="例：吉野川市" className="field f-sans" style={{ fontSize:16 }} />
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4, lineHeight:1.5 }}>※ 市町村まで。番地・字は公開されません</p>
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>移動手段</label>
                <LFPillSelect options={["車","バイク","自転車","公共交通"]} value={workerTransport} onSelect={setWorkerTransport} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>働ける曜日</label>
                <LFMultiPill options={["月","火","水","木","金","土","日"]} values={workerDays}
                  onToggle={d => setWorkerDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev,d])} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>働ける時間帯</label>
                <LFPillSelect options={["早朝（〜8時）","午前","午後","夕方以降","終日"]} value={workerTimeSlot} onSelect={setWorkerTimeSlot} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>やりたい作業</label>
                <LFPillSelect options={["収穫","定植","選果","草刈り","農薬散布","梱包","なんでも"]} value={workerWork} onSelect={setWorkerWork} />
              </div>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>経験のある作物</label>
                <LFPillSelect options={["トマト","キュウリ","イチゴ","米","なんでも"]} value={workerCrop} onSelect={setWorkerCrop} />
              </div>
            </LFWizCard>
            <LFPrivacyNote />
          </>)}

          {isWorker && step === 4 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>希望報酬を入力します</h2>
            <p className="f-sans" style={lfStyles.subtitle}>平均・中央値と比較できます（参考値）</p>
            <LFWizCard>
              <div style={{ marginBottom:16 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>希望時給 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（円）</span></label>
                <input type="number" value={workerHourly} onChange={e => setWorkerHourly(e.target.value)} placeholder="例：1200" className="field f-mono" style={{ fontSize:20, maxWidth:180 }} />
                <LFWageCompare type="時給" value={parseFloat(workerHourly)||0} avg={AVG_HOURLY} count={AVG_COUNT} />
              </div>
              <div style={{ marginBottom:16 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>希望日給 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（円）</span></label>
                <input type="number" value={workerDaily} onChange={e => setWorkerDaily(e.target.value)} placeholder="例：9000" className="field f-mono" style={{ fontSize:20, maxWidth:180 }} />
                <LFWageCompare type="日給" value={parseFloat(workerDaily)||0} avg={AVG_DAILY} count={AVG_COUNT} />
              </div>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>日給の場合の想定勤務時間 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（時間）</span></label>
                <input type="number" value={workerHours} onChange={e => setWorkerHours(e.target.value)} placeholder="例：8" className="field f-mono" style={{ fontSize:16, maxWidth:120 }} />
                {workerDaily && workerHours && parseFloat(workerHours) > 0 && (
                  <p className="f-sans" style={{ fontSize:11, color:"#717171", marginTop:4 }}>
                    時給換算：<span className="f-mono" style={{ fontWeight:700 }}>¥{Math.round(parseFloat(workerDaily)/parseFloat(workerHours)).toLocaleString()}/h</span>
                  </p>
                )}
              </div>
              <LFWageNote />
            </LFWizCard>
          </>)}

          {isWorker && step === 5 && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>プロフィール確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>農家に表示される情報です</p>
            <LFWizCard>
              <LFSummaryRow label="表示名"   value={workerDisplayName || "未入力"} />
              <LFSummaryRow label="経験"     value={workerExp} />
              <LFSummaryRow label="地域"     value={workerRegion || "未入力"} />
              <LFSummaryRow label="移動手段" value={workerTransport || "未設定"} />
              <LFSummaryRow label="曜日"     value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="時間帯"   value={workerTimeSlot || "未設定"} />
              <LFSummaryRow label="作業"     value={workerWork || "未設定"} />
              <LFSummaryRow label="目的"     value={workerPurpose==="open" ? "働ける日を公開" : "募集を探す"} />
            </LFWizCard>
            <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", lineHeight:1.7 }}>※ 本名・電話番号・詳細住所は表示されません。詳細情報の無断共有は禁止です。</p>
          </>)}

          {isWorker && step === 6 && workerPurpose === "open" && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>希望条件の確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>これはプレビューです。実際の公開はまだ行いません</p>
            <LFWizCard>
              <LFSummaryRow label="地域"     value={workerRegion || "未入力"} />
              <LFSummaryRow label="曜日"     value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="時間帯"   value={workerTimeSlot || "未設定"} />
              <LFSummaryRow label="移動手段" value={workerTransport || "未設定"} />
              <LFSummaryRow label="希望時給" value={workerHourly ? `¥${parseFloat(workerHourly).toLocaleString()}/h` : "未設定"} />
              <LFSummaryRow label="希望日給" value={workerDaily ? `¥${parseFloat(workerDaily).toLocaleString()}/日` : "未設定"} />
            </LFWizCard>
          </>)}

          {isWorker && step === 6 && workerPurpose === "search" && (
            <JobSearchMapView />
          )}

          {isWorker && step === 7 && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>内容の確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>構想段階のため、実際の公開は行いません</p>
            <LFWizCard>
              <LFSummaryRow label="ロール"    value="働き手" />
              <LFSummaryRow label="表示名"    value={workerDisplayName || "未設定"} />
              <LFSummaryRow label="経験"      value={workerExp} />
              <LFSummaryRow label="地域"      value={workerRegion || "未設定"} />
              <LFSummaryRow label="移動手段"  value={workerTransport || "未設定"} />
              <LFSummaryRow label="曜日"      value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="目的"      value={workerPurpose==="open" ? "働ける日を公開" : "募集を探す"} />
              <LFSummaryRow label="希望時給"  value={workerHourly ? `¥${parseFloat(workerHourly).toLocaleString()}/h` : "未設定"} />
            </LFWizCard>
          </>)}

          {isWorker && step === 8 && (<>
            <div style={{ textAlign:"center", paddingTop:20 }}>
              <div style={{ fontSize:56, marginBottom:16 }}>✅</div>
              <h2 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", marginBottom:10 }}>ありがとうございます</h2>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, marginBottom:24 }}>
                この機能は現在構想段階です。<br/>
                実装前に労働局・関係機関へ確認した上で、段階的に追加予定です。
              </p>
              <div style={{ display:"grid", gap:10 }}>
                <button onClick={onLogin} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12 }}>実証に参加する →</button>
                <button onClick={onSkip} style={{ width:"100%", padding:"13px", fontSize:13, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#222", cursor:"pointer", fontFamily:"inherit" }}>公開データを見る</button>
                <button onClick={onComplete} className="f-sans" style={{ width:"100%", padding:"10px", background:"none", border:"none", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>意見を送る（準備中）</button>
              </div>
            </div>
          </>)}

        </div>
      </div>

      {/* 下部ナビ（ホーム・完了画面以外） */}
      {step > 0 && step < TOTAL && step !== 12 && (
        <div style={embedded ? {
          background:"#fff", borderTop:"1px solid #EBEBEB", padding:"16px 20px",
          display:"flex", alignItems:"center", justifyContent: isAutoStep ? "flex-start" : "space-between",
        } : {
          position:"fixed", bottom:0, left:0, right:0, background:"#fff",
          borderTop:"1px solid #EBEBEB",
          padding:"16px 20px calc(16px + env(safe-area-inset-bottom, 0px))",
          display:"flex", alignItems:"center", justifyContent: isAutoStep ? "flex-start" : "space-between",
        }}>
          <button onClick={goBack} className="f-sans" style={{ background:"none", border:"none", fontSize:15, color:"#222", cursor:"pointer", padding:"8px 0" }}>← 戻る</button>
          {!isAutoStep && step !== 11 && (
            <button onClick={canGoNext ? goNext : undefined} className="btn-primary" style={{
              padding:"14px 28px", fontSize:15, fontWeight:700,
              cursor: canGoNext ? "pointer" : "not-allowed", opacity: canGoNext ? 1 : 0.5,
            }}>次へ →</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── AdminTab ─────────────────────────────────────────────────
function AdminTab({ onJump }) {
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
  const [pendingJobs, setPendingJobs] = useState([]);
  const [publishing, setPublishing] = useState(null);

  const TIERS = ["1-3","4-10","10+"];

  const load = useCallback(async () => {
    setLoading(true);
    const [fr, de, re, ae, pj] = await Promise.all([
      supabase.from("farmers").select("*").order("created_at", { ascending: false }),
      supabase.from("dests").select("*").order("name"),
      supabase.from("records").select("*").order("year,month"),
      supabase.from("app_errors").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("jobs").select("*").eq("status","pending").order("created_at",{ascending:false}),
    ]);
    if (!fr.error) setFarmers(fr.data || []);
    if (!de.error) setDests(de.data || []);
    if (!re.error) setRecords(re.data || []);
    if (!ae.error) setAppErrors(ae.data || []);
    if (!pj.error) setPendingJobs(pj.data || []);
    setLoading(false);
  }, []);

  const publishJob = async (jobNumber) => {
    if (publishing) return;
    setPublishing(jobNumber);
    const { error } = await supabase.from("jobs").update({ status: "open" }).eq("job_number", jobNumber);
    setPublishing(null);
    if (error) { alert("公開に失敗しました：" + error.message); return; }
    load();
  };
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
    { k:"jobs",    l:"求人審査",  n: pendingJobs.length },
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

      {/* 開発: 画面ジャンプ */}
      <div style={{ marginBottom:16 }}>
        <p className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", marginBottom:6 }}>開発: 画面ジャンプ</p>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[
            { k:"jobs",  l:"募集中の仕事" },
            { k:"board", l:"公開ボード" },
            { k:"input", l:"データ入力" },
            { k:"plan",  l:"五年計画" },
            { k:"labor", l:"お仕事" },
          ].map(({ k, l }) => (
            <button key={k} onClick={() => onJump(k)} className="f-sans" style={{
              padding:"6px 12px", borderRadius:8, border:"1px solid #EBEBEB",
              background:"#F7F7F7", color:"#717171", fontSize:11, fontWeight:600,
              cursor:"pointer",
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* 開発: 画面ジャンプ(LandingFlow) */}
      <div style={{ marginBottom:16 }}>
        <p className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", marginBottom:6 }}>開発: 画面ジャンプ(LandingFlow)</p>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[
            { l:"LFトップ",      dj:{ role:"",       step:0 } },
            { l:"農1作物",       dj:{ role:"farmer", step:1 } },
            { l:"農2作業",       dj:{ role:"farmer", step:2 } },
            { l:"農3場所",       dj:{ role:"farmer", step:3 } },
            { l:"農4日程人数",   dj:{ role:"farmer", step:4 } },
            { l:"農5報酬",       dj:{ role:"farmer", step:5 } },
            { l:"農6G2説明",     dj:{ role:"farmer", step:6 } },
            { l:"農7写真",       dj:{ role:"farmer", step:7 } },
            { l:"農8作業説明",   dj:{ role:"farmer", step:8 } },
            { l:"農9危険",       dj:{ role:"farmer", step:9 } },
            { l:"農10持ち物",    dj:{ role:"farmer", step:10 } },
            { l:"農確認",        dj:{ role:"farmer", step:11 } },
            { l:"農完了",        dj:{ role:"farmer", step:12 } },
            { l:"ページX",       dj:{ role:"farmer", step:90 } },
            { l:"働3",           dj:{ role:"worker", step:3 } },
            { l:"働6求人",       dj:{ role:"worker", step:6, workerPurpose:"search" } },
          ].map(({ l, dj }) => (
            <button key={l} onClick={() => onJump("labor", dj)} className="f-sans" style={{
              padding:"6px 12px", borderRadius:8, border:"1px solid #D0E8FF",
              background:"#EBF5FF", color:"#1a73e8", fontSize:11, fontWeight:600,
              cursor:"pointer",
            }}>{l}</button>
          ))}
        </div>
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

      {/* ── 求人審査 ── */}
      {sub==="jobs" && (
        <div style={{ display:"grid", gap:12 }}>
          {pendingJobs.length === 0 ? (
            <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>公開待ちの求人はありません</p>
          ) : pendingJobs.map(j => (
            <div key={j.job_number} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff", display:"flex", justifyContent:"space-between", alignItems:"center", gap:16 }}>
              <div>
                <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 4px" }}>#{j.job_number} {j.crop} {j.task}</p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0 }}>{[j.prefecture,j.city].filter(Boolean).join("")} ・ {j.date_label||""} ・ {j.headcount||"?"}名</p>
              </div>
              <button onClick={()=>publishJob(j.job_number)} disabled={publishing===j.job_number} className="f-sans" style={{ padding:"10px 20px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", whiteSpace:"nowrap" }}>{publishing===j.job_number ? "公開中..." : "公開する"}</button>
            </div>
          ))}
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


// ── FarmerDashboard（農家モードのお仕事タブ＝求人ダッシュボード・ガワ） ──
function FarmerDashboard({ onNewJob, onResume }) {
  const hashToJobTab = () => {
    const h = window.location.hash.replace(/^#\/?/,"");
    if (h === "work/drafts") return "draft";
    if (h === "work/active") return "active";
    if (h === "work/applicants") return "applicants";
    if (h === "work/expired") return "expired";
    return null;
  };
  const [jobTab, setJobTab] = useState(() => {
    try { const j = hashToJobTab(); if (j) return j; } catch {}
    return (sessionStorage.getItem("cb_afterDraftSave")==="1") ? "draft" : "active";
  });
  useEffect(() => {
    const onHash = () => { const j = hashToJobTab(); if (j) setJobTab(j); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [dbDrafts, setDbDrafts] = useState([]);
  const [dbActive, setDbActive] = useState([]);
  const [dbApplicants, setDbApplicants] = useState([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setDraftsLoading(false); return; }
        const { data, error } = await supabase.from("jobs").select("job_number,crop,task,date_label,prefecture,city,pay_type,hourly_wage,daily_wage,photos,status").eq("farmer_id", session.user.id).eq("status","draft").order("job_number",{ascending:false});
        if (!error && data) setDbDrafts(data);
        const { data: adata, error: aerror } = await supabase.from("jobs").select("job_number,crop,task,date_label,prefecture,city,pay_type,hourly_wage,daily_wage,photos,status").eq("farmer_id", session.user.id).in("status",["pending","open"]).order("job_number",{ascending:false});
        if (!aerror && adata) setDbActive(adata);
        const { data: appData, error: appErr } = await supabase.from("applications").select("*").eq("farmer_id", session.user.id).order("created_at",{ascending:false});
        if (!appErr && appData) setDbApplicants(appData);
      } catch {}
      setDraftsLoading(false);
      try { if (sessionStorage.getItem("cb_afterDraftSave")==="1") { setJobTab("draft"); } sessionStorage.removeItem("cb_afterDraftSave"); } catch {}
    })();
  }, []);
  const JOB_TABS = [
    { k:"draft",   l:"作成中" },
    { k:"active",  l:"募集中" },
    { k:"applicants", l:"応募者" },
    { k:"expired", l:"期限切れ" },
  ];
  // ダミー撤去（憲法3条:表示にダミー禁止）。Phase2aでjobsテーブルから自分の求人を読む
  const jobList = [];
  return (
    <div style={{ maxWidth:1200, margin:"0 auto", padding:"24px 20px 80px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0 }}>あなたの求人</h2>
        <button onClick={onNewJob} className="btn-primary" style={{ padding:"10px 18px", fontSize:13 }}>＋ 新しく求人を出す</button>
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:16, borderBottom:"1px solid #EEE" }}>
        {JOB_TABS.map(t => (
          <button key={t.k} onClick={()=>{ const _map={draft:"/work/drafts",active:"/work/active",applicants:"/work/applicants",expired:"/work/expired"}; window.location.hash=(_map[t.k]||"/work"); }} className="f-sans" style={{
            padding:"8px 4px", marginBottom:-1, background:"none", border:"none", cursor:"pointer",
            fontSize:13, fontWeight: jobTab===t.k ? 700 : 400,
            color: jobTab===t.k ? "#222" : "#999",
            borderBottom: jobTab===t.k ? "2px solid var(--mode-accent, #00A86B)" : "2px solid transparent",
          }}>{t.l}</button>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:20 }}>
      {jobTab==="draft" ? (
        draftsLoading ? (
          <p className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>
        ) : dbDrafts.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🌱</div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>作成中の求人はありません</p>
            <button onClick={onNewJob} className="btn-primary" style={{ padding:"12px 28px", fontSize:14 }}>＋ 新しく求人を出す</button>
          </div>
        ) : (
          dbDrafts.map(d => (
            <button key={d.job_number} onClick={()=>onResume(d.job_number)}
              className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", maxWidth:360, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:0, overflow:"hidden", cursor:"pointer", marginBottom:16 }}>
              <div style={{ height:160, background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:56 }}>{d.photos && d.photos[0] ? <img src={d.photos[0]} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : "📝"}</div>
              <div style={{ padding:"14px 16px" }}>
                <span style={{ display:"inline-block", fontSize:11, fontWeight:700, color:"#8A6D1D", background:"#FFF8E7", padding:"3px 10px", borderRadius:20, marginBottom:8 }}>作成中</span>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:"0 0 4px" }}>{((d.crop||"")+" "+(d.task||"")).trim() || "無題の求人"}</p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0 }}>{d.date_label || "日程未定"}　タップして再開</p>
              </div>
            </button>
          ))
        )
      ) : jobTab==="active" ? (
        dbActive.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
            <div style={{ fontSize:40, marginBottom:12 }}>🌾</div>
            <p style={{ fontSize:14, margin:0 }}>募集中の求人はまだありません</p>
          </div>
        ) : (
          dbActive.map(d => (
            <div key={d.job_number} style={{ border:"1px solid #EBEBEB", borderRadius:16, overflow:"hidden", background:"#fff" }}>
              <div style={{ height:140, background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                {d.photos && d.photos[0] ? <img src={d.photos[0]} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:40 }}>🌾</span>}
              </div>
              <div style={{ padding:"14px 16px" }}>
                <div style={{ display:"inline-block", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, marginBottom:8, background: d.status==="open" ? "#E6F7EE" : "#FFF4E0", color: d.status==="open" ? "#00A86B" : "#C77700" }}>{d.status==="open" ? "公開中" : "審査中"}</div>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:"0 0 4px" }}>{(d.crop||"")+" "+(d.task||"") || "無題"}</p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0 }}>{d.date_label||""}</p>
              </div>
            </div>
          ))
        )
      ) : jobTab==="applicants" ? (
        dbApplicants.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
            <div style={{ fontSize:40, marginBottom:12 }}>📩</div>
            <p style={{ fontSize:14, margin:0 }}>まだ応募はありません</p>
            <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>求人が公開されると、働き手が応募できます。</p>
          </div>
        ) : (
          dbApplicants.map(a => (
            <div key={a.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
              <div style={{ display:"inline-block", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, marginBottom:8, background:"#FFF4E0", color:"#C77700" }}>
                {a.status==="applied" ? "承認待ち" : a.status==="approved" ? "承認済み" : a.status==="rejected" ? "見送り" : a.status}
              </div>
              <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 4px" }}>求人番号 {a.job_number}</p>
              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:12 }}>応募日 {new Date(a.created_at).toLocaleDateString("ja-JP")}</p>
              <button onClick={()=>{ window.location.hash="/chat/"+a.id; }} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>チャットを開く</button>
            </div>
          ))
        )
      ) : jobList.length === 0 ? (
        <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0 40px" }}>
          <div style={{ fontSize:44, marginBottom:14 }}>🌱</div>
          <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:6 }}>まだ求人がありません</p>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:22 }}>最初の求人を出して、働き手を募集しましょう。</p>
          <button onClick={onNewJob} className="btn-primary" style={{ padding:"14px 32px", fontSize:14 }}>＋ 新しく求人を出す</button>
        </div>
      ) : jobList.map(job => (
        <div key={job.id} style={{ display:"block", width:"100%", background:"#fff", border:"1px solid #EEE", borderRadius:12, overflow:"hidden" }}>
          <div style={{ width:"100%", height:220, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:72 }}>{job.icon}</div>
          <div style={{ padding:"12px 16px 16px" }}>
            <p className="f-sans" style={{ fontSize:16, fontWeight:600, color:"#222", margin:0, marginBottom:4 }}>{job.crop} {job.task}</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0, marginBottom:6 }}>{job.dateLabel}　{job.region}</p>
            <p className="f-mono" style={{ fontSize:15, fontWeight:700, color:"#00A86B", margin:0 }}>{payLabel(job)}</p>
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

// ── LaborTab ─────────────────────────────────────────────────
// 表示中タブ：「人手確保」(tab==="labor") → <LaborTab> が直接レンダリングされる
function LaborTab({ farmersCount, onLogin }) {
  return <LandingFlow embedded farmersCount={farmersCount} initialRole="farmer"
    onComplete={()=>{}} onSkip={onLogin} onLogin={onLogin} />;
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
  const lfDraft = JSON.parse(localStorage.getItem('landingFlowDraft_v1') || '{}');
  const totalSteps = 9;
  const [obStep, setObStep] = useState(1);
  const [obName,         setObName]         = useState(isEditing ? (me.name || "") : "");
  const [obPrefecture,   setObPrefecture]   = useState(me.prefecture || "");
  const [obMunicipality, setObMunicipality] = useState(me.municipality || (lfDraft.farmerRegion || "").replace(/周辺$/, "") || "");
  const [obTier,         setObTier]         = useState(me.experience_tier || "");
  const [obFarmingType, setObFarmingType] = useState(me.farming_type || localStorage.getItem('ob_farming_type') || "");
  const [obArea,        setObArea]        = useState(me.area_tan || localStorage.getItem('ob_area_tan') || "");
  const [obCrops,       setObCrops]       = useState(
    (me.planned_crops && me.planned_crops.length) ? me.planned_crops
    : [lfDraft.farmerCropPill || lfDraft.farmerCropText].filter(Boolean)
  );
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
    <div
      style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.38)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}
    >
      <div
        style={{ position:"relative", width:"min(92vw, 920px)", maxHeight:"88vh", overflowY:"auto", background:"#FFFFFF", borderRadius:24, padding:"32px", boxShadow:"0 24px 80px rgba(0,0,0,0.18)", fontFamily:"'Noto Sans JP','Inter',sans-serif" }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="閉じる" style={{ position:"absolute", top:18, right:18, width:40, height:40, borderRadius:999, border:"1px solid #EBEBEB", background:"#FFFFFF", color:"#222222", fontSize:24, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 12px rgba(0,0,0,0.12)", cursor:"pointer", zIndex:10 }}>×</button>
        <h2 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", margin:"0 0 4px", textAlign:"center" }}>プライバシーポリシー</h2>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:24 }}>日本農業研究所（chitose-bank） · 最終更新日：2026年5月25日</p>
        <div style={{ display:"grid", gap:20 }}>
          {sections.map((s, i) => (
            <div key={i} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB" }}>
              <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>{s.title}</h3>
              {s.body.map((p, j) => (
                <p key={j} className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin: j < s.body.length-1 ? "0 0 8px" : 0, textAlign:"left" }}>{p}</p>
              ))}
            </div>
          ))}
        </div>
        <div style={{ textAlign:"center", marginTop:28 }}>
          <button onClick={onClose} style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:12, padding:"13px 48px", fontSize:14, fontWeight:600, cursor:"pointer" }}>閉じる</button>
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
    <div
      style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.38)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}
    >
      <div
        style={{ position:"relative", width:"min(92vw, 920px)", maxHeight:"88vh", overflowY:"auto", background:"#FFFFFF", borderRadius:24, padding:"32px", boxShadow:"0 24px 80px rgba(0,0,0,0.18)", fontFamily:"'Noto Sans JP','Inter',sans-serif" }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="閉じる" style={{ position:"absolute", top:18, right:18, width:40, height:40, borderRadius:999, border:"1px solid #EBEBEB", background:"#FFFFFF", color:"#222222", fontSize:24, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 12px rgba(0,0,0,0.12)", cursor:"pointer", zIndex:10 }}>×</button>
        <h2 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", margin:"0 0 4px", textAlign:"center" }}>データ憲法</h2>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:24 }}>日本農業研究所（chitose-bank） v1.1 · 制定日：2026年5月25日</p>
        <div style={{ display:"grid", gap:20 }}>
          <div style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB" }}>
            <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:0, textAlign:"left" }}>
              本文書は、日本農業研究所（chitose-bank）がデータを取り扱う上での基本原則を定めたものです。すべての機能開発・運用判断はこの原則に基づきます。
            </p>
          </div>
          {articles.map(a => (
            <div key={a.num} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB" }}>
              <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>第{a.num}条　{a.title}</h3>
              <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:0, textAlign:"left" }}>{a.body}</p>
            </div>
          ))}
        </div>
        <div style={{ textAlign:"center", marginTop:28 }}>
          <button onClick={onClose} style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:12, padding:"13px 48px", fontSize:14, fontWeight:600, cursor:"pointer" }}>閉じる</button>
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
  // URL(#/タブ名)⇄tab の同期（リンク第1段）。有効タブ名のみ受け付ける
  const TAB_URL_KEYS = ["labor","jobs","board","input","plan","admin","search","work","profile","login","role"];
  const NEW_TAB_KEYS = ["search","work","profile","login","role"]; // 第2段の新部屋＋役割選択（タブバー非表示）
  const readHashTab = () => { const h = window.location.hash.replace(/^#\/?/, ""); if (h.startsWith("chat/")) return "work"; if (h === "apply/done" || h.startsWith("apply/")) return "search"; if (h.startsWith("work/job/")) return "search"; if (h === "work" || h.startsWith("work/")) return "work"; return TAB_URL_KEYS.includes(h) ? h : null; };
  const initialHashTab = readHashTab(); // 起動した瞬間にURLでタブ指定があったか（同期useEffectが書き込む前の記録）
  const [tab,setTab]=useState(initialHashTab ?? "search");
  // tab → URL：タブが変わったらアドレスバーの#を書き換える
  useEffect(() => {
    const target = "#/" + tab;
    const _curHash = window.location.hash.replace(/^#\/?/, "");
    // フロー系(求人作成・編集・詳細・チャット)は正当にhashを保持
    const _inFlow = _curHash === "work/new" || _curHash.startsWith("work/new/") || _curHash.startsWith("work/edit/") || _curHash.startsWith("work/job/") || _curHash.startsWith("chat/");
    // workタブ内サブタブ(drafts/active/applicants/expired)は、向かうタブもworkの時だけ保持
    const _subTabOfWork = (tab === "work") && (_curHash === "work/drafts" || _curHash === "work/active" || _curHash === "work/applicants" || _curHash === "work/expired");
    if (!_inFlow && !_subTabOfWork && window.location.hash !== target) window.location.hash = "/" + tab;
  }, [tab]);
  // URL → tab：戻る/進むボタン・URL直打ちでタブを切り替える
  useEffect(() => {
    const onHash = () => {
      const rawHash = window.location.hash.replace(/^#\/?/, "");
      if (rawHash === "work/new" || rawHash.startsWith("work/new/") || rawHash.startsWith("work/edit/")) { setShowJobPost(true); setTab("work"); return; }
      if (showJobPost && !rawHash.startsWith("work/new") && !rawHash.startsWith("work/edit/")) { setShowJobPost(false); }
      setShowApplyDone(rawHash === "apply/done");
      const _cm = rawHash.match(/^chat\/([0-9a-f-]+)$/);
      setChatAppId(_cm ? _cm[1] : null);
      const t = readHashTab(); if (t) setTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [farmers,setFarmers]=useState([]);
  const [farmPend,setFarmPend]=useState([]);
  const [destOk,setDestOk]=useState([]);
  const [destPend,setDestPend]=useState([]);
  const [recs,setRecs]=useState({});
  const [publicFarmerCount,setPublicFarmerCount]=useState(null);
  const [loaded,setLoaded]=useState(false);
  const [badgeCnt,setBadgeCnt]=useState(0);
  const [me,setMe]=useState(null);
  const [authV,setAuthV]=useState("login");
  const [showLanding,setShowLanding]=useState(false);
  const [showJobPost,setShowJobPost]=useState(()=>{ const h=window.location.hash.replace(/^#\/?/,""); return h==="work/new"||h.startsWith("work/new/")||h.startsWith("work/edit/"); });
  const [showApplyDone,setShowApplyDone]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/done");
  const [chatAppId,setChatAppId]=useState(()=>{ const m=window.location.hash.replace(/^#\/?/,"").match(/^chat\/([0-9a-f-]+)$/); return m?m[1]:null; });
  const [showDevJump,setShowDevJump]=useState(false); // 開発用ジャンプ（管理者がログイン中でも各stepへ飛ぶ）
  const [showProfileMenu,setShowProfileMenu]=useState(false);
  const [showTerms,setShowTerms]=useState(false);
  const [showConstitution,setShowConstitution]=useState(false);
  const [showPrivacy,setShowPrivacy]=useState(false);
  const [showOnboarding,setShowOnboarding]=useState(false);
  const [obModalKey,setObModalKey]=useState(0);
  const [notifs,setNotifs]=useState([]);
  const [showNotifs,setShowNotifs]=useState(false);
  const [showProfile,setShowProfile]=useState(false);
  const modeAccent = "#00A86B";
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
    const { data, error } = await supabase.rpc('public_farmers_count');
    if (!error && data != null) setPublicFarmerCount(data);
  })();},[]);

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
  　const fp=await sGet("yw_farmers_pend")||[];
    const { data: dbDestsOk } = await supabase.from('dests').select('*').eq('status', 'approved');
    const da = dbDestsOk ? dbDestsOk.map(d => ({ id: d.id, name: d.name, status: d.status, notes: d.notes })) : [];
    const { data: dbDestsPend } = await supabase.from('dests').select('*').eq('status', 'pending');
    const dp = dbDestsPend ? dbDestsPend.map(d => ({ id: d.id, name: d.name, status: d.status, submittedBy: d.submitted_by })) : [];

    const { data: { session } } = await supabase.auth.getSession();
    let f = [];
    const r = {};
    if (session) {
      const { data: dbFarmer } = await supabase.from('farmers').select('*').eq('email', session.user.email).single();
      if (dbFarmer) {
        const loggedIn = { id: dbFarmer.auth_id || dbFarmer.id, name: dbFarmer.name, email: dbFarmer.email, status: dbFarmer.status, joinedYear: dbFarmer.joined_year, prefecture: dbFarmer.prefecture || "", municipality: dbFarmer.municipality || "", planned_crops: dbFarmer.planned_crops || [], experience_tier: dbFarmer.experience_tier || "", farming_type: dbFarmer.farming_type || "", area_tan: dbFarmer.area_tan || "", sales_channels: dbFarmer.sales_channels || [], avatar_url: dbFarmer.avatar_url || "" };
        f = [loggedIn];
        setMe({ ...loggedIn, id: session.user.id });
        const _onNewJobFlow = (() => { const h = window.location.hash.replace(/^#\/?/, ""); return h === "work/new" || h.startsWith("work/new/"); })();
        if (!initialHashTab && !_onNewJobFlow) setTab("work"); // hash無しの時だけ「しごと」へ。求人フロー中(#/work/new)は送還しない（骨格③）
      }
      const { data: dbRecs } = await supabase.from('records').select('*').eq('farmer_id', session.user.id);
      if (dbRecs) {
        dbRecs.forEach(rec => {
          const k = `${rec.farmer_id}_${rec.year}_${rec.month}`;
          if (!r[k]) r[k] = [];
          r[k].push({ id: rec.id, destId: rec.dest_id, boxes: rec.boxes, ppb: rec.ppb, costs: rec.costs || [], crop: rec.crop, variety: rec.variety, is_brand: rec.is_brand, created_at: rec.created_at });
        });
      }
    }
    setFarmers(f);setFarmPend(fp);setDestOk(da);setDestPend(dp);setRecs(r);
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
    window.location.hash = "/search"; // reload前に直接書く（setTabの予約はreloadに間に合わない）
    /* 検証中：本来はsetShowLanding(true)。完成後に戻す */
    localStorage.removeItem('sb-aegwepgtmwcnwzybpgsh-auth-token');
    window.location.reload();
  };

  const completeOnboarding=useCallback(async(updates)=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(user){
      const{data:dbFarmer}=await supabase.from('farmers').select('*').eq('email',user.email).single();
      if(dbFarmer){
        const loggedIn={id:dbFarmer.auth_id||dbFarmer.id,name:dbFarmer.name,email:dbFarmer.email,status:dbFarmer.status,joinedYear:dbFarmer.joined_year,prefecture:dbFarmer.prefecture||"",municipality:dbFarmer.municipality||"",planned_crops:dbFarmer.planned_crops||[],experience_tier:dbFarmer.experience_tier||"",farming_type:dbFarmer.farming_type||"",area_tan:dbFarmer.area_tan||"",sales_channels:dbFarmer.sales_channels||[],avatar_url:dbFarmer.avatar_url||""};
        setFarmers([loggedIn]);
        setMe({...loggedIn,id:user.id});
      }
    }
    setShowOnboarding(false);
    setTab("work");
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

  const ALL_TABS=[
    {k:"search",l:"さがす",modes:["farmer","worker"]},
    {k:"work",l:"しごと",modes:["farmer","worker"]},
    {k:"profile",l:"プロフィール",modes:["farmer","worker"]},
    ...(isAdmin(me)?[{k:"admin",l:"管理",badge:badgeCnt,modes:["farmer","worker"]}]:[]),
  ];
  const TABS = ALL_TABS;

  const visibleTabKeys = TABS.map(t=>t.k);
  // 未ログインで input（ログイン画面）要求時はモード不問で通す（認証は役割不問・骨格⑥）
  // 部屋番号(TAB_URL_KEYS)にある部屋は全て到達可（避難部屋含む・骨格④）。資格の無い部屋と迷子はsearchへ
  const safeTab = TAB_URL_KEYS.includes(tab)
    ? ((tab === "admin" && !isAdmin(me)) || (tab === "plan" && !me) ? "search" : tab)
    : "search";

  return(
    <div style={{minHeight:"100vh",background:C.washi,color:C.ink,"--mode-accent":modeAccent}}>
      <style>{CSS}</style>

      {/* ── HEADER ── */}
      <header style={{
        background:"#FFFFFF",
        borderBottom:"1px solid #EBEBEB",
        height:52,
        "--mode-accent":modeAccent,
        display:"flex",alignItems:"center",
        padding:"0 24px",
        position:"sticky",top:0,zIndex:50,
      }}>
        {/* PC: タブ（左）*/}
        {TABS.length>1&&<nav style={{display:"flex",flex:1}} className="header-nav">
          {TABS.map(({k,l,badge,locked})=>(
            <button key={k} onClick={()=>setTab(k)}
              className={`nav-item ${safeTab===k?"active":""}`}
              style={{
                padding:"0 16px",height:52,border:"none",borderRadius:0,
                background:"transparent",
                color:safeTab===k?"#222222":locked?"#D0D0D0":"#717171",
                fontSize:12,fontWeight:safeTab===k?600:400,
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
        </nav>}

        {/* 右：通知ベル＋ユーザーピル（PC）／全幅（スマホ） */}
        {me ? (
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
            {/* ユーザーピル（独立プロフィールタブに一本化のため非表示・要素は転用のため残置） */}
            <div
              onClick={()=>setShowProfile(true)}
              style={{
                display:"none",alignItems:"center",gap:6,
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
        ) : (
          <button
            onClick={()=>setTab("login")}
            className="f-sans"
            style={{
              marginLeft:"auto",
              border:"1px solid #EBEBEB",
              borderRadius:999,
              background:"#FFFFFF",
              padding:"8px 14px",
              fontSize:13,
              fontWeight:700,
              color:"#222",
              boxShadow:"0 2px 8px rgba(0,0,0,0.04)",
              cursor:"pointer",
            }}
          >新規登録・ログイン</button>
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
      {TABS.length>1&&<div className="bottom-tab-bar">
        {TABS.map(({k,badge,l})=>{
          const icons={search:"🔍",work:"🤝",profile:"👤",admin:"⚙️",labor:"🤝"};
          return(
            <button key={k} onClick={()=>setTab(k)} className={safeTab===k?"active":""}>
              <span className="icon">{icons[k]}</span>
              {l}
              {badge>0&&<span style={{position:"absolute",top:4,right:4,width:14,height:14,borderRadius:"50%",background:"#E24B4A",color:"#fff",fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{badge}</span>}
            </button>
          );
        })}
      </div>}

      {/* ── MAIN ── */}
      <main style={{maxWidth:920,margin:"0 auto",padding:"16px 24px 72px"}}>
        <DevBadge label="App(Dashboard/Home)" />
        {chatAppId ? (
          <ChatView applicationId={chatAppId} onBack={()=>{ window.location.hash="/work/applicants"; }} />
        ) : showApplyDone ? (
          <div style={{ minHeight:"70vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", maxWidth:400, margin:"0 auto", padding:"0 20px" }}>
            <div style={{ fontSize:56, marginBottom:16 }}>📩</div>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}>応募を受け付けました</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, marginBottom:8 }}>
              これはまだ採用ではありません。<br/>
              農家が内容を確認し、承認するとお知らせします。<br/>
              その後、打ち合わせ・面接を経て、契約となります。
            </p>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginBottom:28 }}>
              chitose-bankは求人情報の提供と連絡の場を用意します。雇用の契約は当事者間で行われます。
            </p>
            <button onClick={()=>{ window.location.hash="/search"; }} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12 }}>ほかの仕事を探す</button>
          </div>
        ) : safeTab==="search" ? <JobSearchMapView onRegister={()=>setTab("login")} /> : null}
        {!chatAppId&&!showApplyDone&&safeTab==="work"&&(<>
              {me&&!me.isWorker&&me.status==="pending"&&(
                <div className="f-sans" style={{maxWidth:920,margin:"0 auto 16px",padding:"14px 18px",background:"#FFF8E7",border:"1px solid #F5D98F",borderRadius:12,fontSize:13,color:"#8A6D1D",lineHeight:1.7}}>
                  🕊 ご登録ありがとうございます。現在、運営が内容を確認しています。<b>承認後に求人の公開ができるようになります</b>（通常1〜2日以内）。
                </div>
              )}
              <FarmerDashboard
                onNewJob={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} setShowJobPost(true); window.location.hash="/work/new"; }}
                onResume={(n)=>{ setShowJobPost(true); window.location.hash="/work/edit/"+n; }}
              />
            </>)}
        {!chatAppId&&!showApplyDone&&safeTab==="profile"&&(me
          ? <div style={{maxWidth:480,margin:"0 auto",padding:"48px 24px"}}>
              <p className="f-sans" style={{fontSize:11,color:"#B0B0B0",letterSpacing:".08em",marginBottom:8}}>プロフィール</p>
              <p className="f-sans" style={{display:"none",fontSize:22,fontWeight:700,color:"#222",marginBottom:32}}>{me.name || "名前未設定"}</p>
              <WorkerProfileEdit me={me} />
              <div style={{marginTop:32,paddingTop:24,borderTop:"1px solid #EEE",textAlign:"center"}}>
                <button onClick={handleLogout} className="f-sans" style={{padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログアウト</button>
              </div>
            </div>
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>プロフィールを見るにはログインしてください</p><button onClick={()=>setTab("login")} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!chatAppId&&!showApplyDone&&safeTab==="role"&&<RoleSelectScreen onGoLogin={()=>setTab("login")} onRegistered={(p,role)=>{ setMe(p); setTab("work"); }}/>}
        {!chatAppId&&!showApplyDone&&safeTab==="login"&&(me
          ? <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#222"}}>ログイン済みです</p></div>
          : <LoginScreen farmers={farmers} onLogin={f=>{setMe(f);setAuthV("login");loadNotifs(f.id);setTab("work");}} onGoRegister={()=>setAuthV("register")} onNeedRole={()=>setTab("role")}/>)}
        {!chatAppId&&!showApplyDone&&safeTab==="board"&&<BoardTab farmers={farmers} destApproved={destOk} records={recs} userLevel={userLevel} onLogin={()=>setTab("login")} me={me} onGoPlan={()=>setTab("plan")} onShowConstitution={()=>setShowConstitution(true)} onShowTerms={()=>setShowTerms(true)} onShowPrivacy={()=>setShowPrivacy(true)}/>}
        {!chatAppId&&!showApplyDone&&safeTab==="labor"&&(
          <FarmerDashboard
              onNewJob={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} setShowJobPost(true); window.location.hash="/work/new"; }}
              onResume={(n)=>{ setShowJobPost(true); window.location.hash="/work/edit/"+n; }}
            />)}
        {!chatAppId&&!showApplyDone&&safeTab==="jobs"&&<JobSearchMapView onRegister={()=>setTab("login")} />}
        {!chatAppId&&!showApplyDone&&safeTab==="input"&&(me
          ? <InputTab loggedInFarmer={me} destApproved={destOk} destPending={destPend}
              records={recs} onAddRecord={addRec} onSubmitDest={subDest} onGoBoard={()=>setTab("board")} onDeleteRec={deleteRec}/>
          : authV==="register"
            ? <RegisterScreen onGoLogin={()=>setAuthV("login")} onSubmit={subReg}/>
            : <LoginScreen farmers={farmers} onLogin={f=>{setMe(f);setAuthV("login");loadNotifs(f.id);}} onGoRegister={()=>setAuthV("register")} onNeedRole={()=>setTab("role")}/>
        )}
        {!chatAppId&&!showApplyDone&&safeTab==="plan"&&isMember&&(
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
        {!chatAppId&&!showApplyDone&&safeTab==="admin"&&isAdmin(me)&&<AdminTab
          destPending={destPend} destApproved={destOk}
          farmers={farmers} farmersPending={farmPend}
          onApprove={appDest} onReject={rejDest}
          onApproveFarmer={appFarmer} onRejectFarmer={rejFarmer}
          onJump={(t, dj) => { if (dj) { localStorage.setItem('devJump', JSON.stringify(dj)); setShowDevJump(true); } setTab(t); }}/>}
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
            chitose-bankは銀行ではありません。表示データは参考情報です。
          </p>
        </div>
      </footer>
      {!me&&showLanding&&(
        <LandingFlow
          onComplete={()=>setShowLanding(false)}
          onSkip={()=>{setShowLanding(false);setTab("search");}}
          onLogin={()=>{setShowLanding(false);setTab("login");}}
        />
      )}
      {me&&showJobPost&&(
        <LandingFlow
          initialRole="farmer"
          onComplete={()=>{ setShowJobPost(false); window.location.hash="/work"; }}
          onSkip={()=>{ setShowJobPost(false); window.location.hash="/work"; }}
          onLogin={()=>{ setShowJobPost(false); window.location.hash="/work"; }}
          onStepChange={(s)=>{ if(window.location.hash.replace(/^#\/?/,"").startsWith("work/new")) window.location.hash="/work/new/"+s; }}
          initialStep={(()=>{ const m=window.location.hash.replace(/^#\/?/,"").match(/^work\/new\/(\d+)$/); return m?parseInt(m[1],10):undefined; })()}
        />
      )}
      {me&&showDevJump&&(
        <LandingFlow
          onComplete={()=>setShowDevJump(false)}
          onSkip={()=>setShowDevJump(false)}
          onLogin={()=>setShowDevJump(false)}
        />
      )}
      {showTerms&&<Terms onClose={()=>setShowTerms(false)}/>}
      {showConstitution&&<DataConstitution onClose={()=>setShowConstitution(false)}/>}
      {showPrivacy&&<PrivacyPolicy onClose={()=>setShowPrivacy(false)}/>}
      {me&&!me.isWorker&&((!me.name?.trim()||!me.prefecture)||showOnboarding)&&(
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
