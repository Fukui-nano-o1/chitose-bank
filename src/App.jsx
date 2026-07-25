import { supabase } from "./lib/supabase";
import { openEmployerPreview, openWorkerPreview } from "./lib/previewBus";
import { chatCache } from "./lib/chatCache";
import { INTERVIEW_TEMPLATES, ensureDefaultQuestionSets } from "./lib/questionSets";
import { ADMIN_EMAIL, isAdmin, ymdLocal, isWorkDayToday, fmtJstShort, CALENDAR_WD, calAddDays, calFmtDate, daysBetweenYmd, INSURANCE_ITEMS, ROLE_ORANGE, ROLE_ORANGE_INK, ROLE_GREEN, payLabel, dateRangeLabel, mapJobPublicRow, CROP_OPTIONS, WORKER_DECLARATIONS, yearMonthLabel, farmHostQa, INTERACTION_STYLE_OPTIONS, interactionStyleLabel, tenureLabel, EMPTY_MARK, disp, stationLabel, CALENDAR_STATUS_LABEL, CALENDAR_STATUS_COLOR, CHAT_ELIGIBLE_STATUSES, CHAT_LIST_STATUSES, CHAT_STATUS_LABEL, CHAT_TEMPLATES_FARMER, CHAT_TEMPLATES_WORKER, SURVEY_SOURCES, SURVEY_REASONS, C, uid, toKatakana, toHiragana, MONTHS, cn, man, THIS_YEAR, TERMS_VERSION, PRIVACY_VERSION } from "./lib/utils";
import { TodayPage } from "./components/TodayPage";
import { StatusRibbon, StatusRibbonLeft, ExpandableText, DangerItem, Avatar, Carousel, JobFlagBadges, NoticeJumpText, LinkifiedText } from "./components/ui";
import { CalendarView } from "./components/CalendarView";
import { JobCard } from "./components/JobCard";
import { JobLocationMap } from "./components/JobLocationMap";
import { SavedJobsView } from "./components/SavedJobsView";
import { WorkerTrustCard, FarmerTrustCard } from "./components/TrustCards";
import { AdminJobPreview } from "./components/AdminJobPreview";
import { MyCalendar } from "./components/MyCalendar";
import { ChatView } from "./components/ChatView";
import { ChatList } from "./components/ChatList";
import { LoginScreen } from "./components/LoginScreen";
import { AdminTab } from "./components/admin/AdminTab";
import { ConsignmentRoom } from "./components/admin/ConsignmentRoom";
import { AdminBoxRegistryPage } from "./components/admin/AdminBoxRegistryPage";
import { ToggleSwitch } from "./components/ToggleSwitch";
import { CSS } from "./appStyles";
import { ContentQTabs, JobQuestions } from "./components/JobQuestions";
import { InsurancePrepPage, VisitEntrance, VisitorQRPage } from "./components/VisitAndInsurance";
import { AgreedDatesRow, AvailDatesChips } from "./components/DateChips";

import { isIOS, syncAppBadge } from "./lib/push";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import Terms, { TERMS_ARTICLES, renderRichText } from "./Terms.jsx";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const APPLY_RETURN_KEY = 'applyReturnJob';
const peekApplyReturn  = () => { try { return localStorage.getItem(APPLY_RETURN_KEY); } catch { return null; } };
const setApplyReturn   = (n) => { try { localStorage.setItem(APPLY_RETURN_KEY, String(n)); } catch {} };
const clearApplyReturn = () => { try { localStorage.removeItem(APPLY_RETURN_KEY); } catch {} };


// 国土地理院 住所検索API（APIキー不要・無料）
// 町域レベルの重心を返す。番地を渡してはならない。
async function geocodeTown(prefecture, city, town) {
  const q = `${prefecture || ""}${city || ""}${town || ""}`.trim();
  if (!q) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q),
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const features = await res.json();
    if (!Array.isArray(features) || features.length === 0) return null;

    // 検索語で始まる結果のみを採用する（無関係な一致を排除）
    const hits = features.filter(f => (f?.properties?.title || "").startsWith(q));
    const use = hits.length > 0 ? hits : features;

    // 全点の重心を取る（先頭1件を採用しない）
    const pts = use
      .map(f => f?.geometry?.coordinates)
      .filter(c => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (pts.length === 0) return null;

    const lng = pts.reduce((s, c) => s + c[0], 0) / pts.length;
    const lat = pts.reduce((s, c) => s + c[1], 0) / pts.length;

    // 重心から最も遠い点までの距離を半径にする（町域の広がりを円が覆う）
    // 緯度1度≒111km、経度1度≒111km×cos(緯度)
    const mPerLat = 111000;
    const mPerLng = 111000 * Math.cos((lat * Math.PI) / 180);
    let maxDist = 0;
    for (const c of pts) {
      const dx = (c[0] - lng) * mPerLng;
      const dy = (c[1] - lat) * mPerLat;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) maxDist = d;
    }
    // 最小500m・最大3000mに収める（1点しか返らない場合の下限を確保）
    const radius = Math.round(Math.min(Math.max(maxDist, 500), 3000));

    return { lat, lng, radius, from: q };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 農園紹介のお題一覧（求人詳細・確認ページ共通。記入済みのお題のみ返す）
const farmIntroTopics = (e) => [
  { label:"就農するまで", body: e.intro_path },
  { label:"いま楽しいこと", body: e.intro_joy },
  { label:"どんな作物を、どんな想いで", body: e.intro_crops },
  { label:"職場の雰囲気", body: e.intro_atmosphere },
  { label:"初めての人へのメッセージ", body: e.intro_message },
].filter(t => t.body && t.body.trim());





// ハンバーガーメニュー（PC）。項目の追加・削除はこの配列を編集するだけでよい。
// auth: true=ログイン時のみ / false=常時 / guestOnly: true=未ログイン時のみ
// 運営憲章・利用規約・プライバシーはフッター3列に常設のため☰からは削除（二重掲載の解消・2026-07-14）
const MENU_ITEMS = [
  { key:"chats",    label:"💬 チャット",   hash:"/chats",    auth:true  },
  { key:"calendar", label:"📆 今日", hash:"/calendar", auth:true  },
  { key:"profile",  label:"プロフィール",  hash:"/profile",  auth:true  },
  { key:"login",    label:"ログイン",      hash:"/login",    auth:false, guestOnly:true },
];

// モバイル下部バー：☰(左端・アイコンのみ)＋5機能タブ。カレンダーが中央に来る並び。
// ☰の中身：求人を出す・使い方・この画面を報告・管理・ログアウト（2026-07-14最終形）。
// 下部ナビ＝取引の時系列（第12弾・2026-07-23）：さがす→いいね→チャット(③約束する)→カレンダー(④当日)→プロフィール
const MOBILE_TABS = [
  { k:"search",   icon:"🔍", label:"さがす" },
  { k:"saved",    icon:"♡",  label:"いいね" },
  { k:"chats",    icon:"💬", label:"チャット" },
  { k:"calendar", icon:"📆", label:"今日" },
  { k:"profile",  icon:"👤", label:"プロフィール" },
];
// モバイル☰メニューの静的リンク項目（求人を出す・使い方・報告・ログアウトは動作が固有なので別途JSXで扱う）
const MOBILE_MENU_ITEMS = [
  { key:"admin",   label:"⚙️ 管理",       hash:"/admin",   auth:false, adminOnly:true },
  { key:"boxes",   label:"🗂 ボックス一覧", hash:"/boxes",   auth:false, adminOnly:true },
  { key:"qr",      label:"📇 QRコード",    hash:"/qr",      auth:false, adminOnly:true },
];



// 農家データ（PINなし・メール認証のみ）
const SEED_FARMERS = [];
const SEED_DESTS = [];

// 役割カラー（第11弾・2026-07-22）：目印限定。働き手=橙／農家=緑。
// ブランド緑のCTA（応募・承認等の主ボタン＝--mode-accent）は両モード共通のまま不変。塗るのは「今どっちか」の目印だけ。

// 段階1: 役割撤廃リファクタの安全ネット。現時点では未使用（段階2でRoleSelectScreen撤廃時にme構築へ使用予定）
function buildMeFromAccountHolder(session, ah) {
  return { id: session.user.id, name: ah.full_name, email: session.user.email || null, viaAccountHolder: true };
}

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

const PREFECTURES = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

async function sGet(k){try{const r=await window.storage.get(k,true);return r?JSON.parse(r.value):null;}catch{return null;}}
async function sSet(k,v){try{await window.storage.set(k,JSON.stringify(v),true);}catch{}};



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


// ── AccountHolderForm — 新規登録①（本人確認・口座名義人情報）────
// 送信は届出完了までADMIN_EMAIL限定。一般ユーザーはボタン無効「準備中」表示（RLS側もadmin限定で二重ゲート）
function AccountHolderForm({ onDone, onSessionExpired, onShowTerms, onShowPrivacy }) {
  const [sess, setSess] = useState(undefined); // undefined=確認中 / null=未ログイン
  const [fullName, setFullName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressAuto, setAddressAuto] = useState("");   // 郵便番号検索で埋まる部分
  const [addressDetail, setAddressDetail] = useState(""); // 番地・建物名(手入力)
  const [apiAddress, setApiAddress] = useState("");       // 郵便番号検索で返ったAPI住所(都道府県+市区町村)。addressAutoとの前方一致照合用
  const [apiAddressZip, setApiAddressZip] = useState(""); // apiAddressが対応する郵便番号(7桁)。postalCode変更後の未再検索を検知するガード
  const [zipSearching, setZipSearching] = useState(false);
  const [zipError, setZipError] = useState("");
  const [entityType, setEntityType] = useState("individual");
  const [companyName, setCompanyName] = useState("");
  const [companyNumber, setCompanyNumber] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSess(session ?? null));
  }, []);

  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
  const yearOptions = []; for (let y = THIS_YEAR - 18; y >= 1930; y--) yearOptions.push(y);
  const daysInMonth = (birthYear && birthMonth) ? new Date(Number(birthYear), Number(birthMonth), 0).getDate() : 31;
  const birthDateStr = (birthYear && birthMonth && birthDay)
    ? `${birthYear}-${String(birthMonth).padStart(2,'0')}-${String(birthDay).padStart(2,'0')}`
    : "";
  const isAdult = !!birthDateStr && new Date(birthDateStr) <= cutoff;

  // 住所バリデーション（入力チェックのみ・account_holdersの構造やinsertには関与しない）
  const ALPHABET_RE = /[a-zA-Zａ-ｚＡ-Ｚ]/;
  const addressAutoHasAlphabet = ALPHABET_RE.test(addressAuto);
  const addressDetailHasAlphabet = ALPHABET_RE.test(addressDetail);
  const missingPrefectureWord = !!addressAuto.trim() && !/[都道府県]/.test(addressAuto);
  const missingCityWord = !!addressAuto.trim() && !/[市区町村]/.test(addressAuto);
  const zipDigits = postalCode.replace(/[^0-9]/g, "");
  const zipNotSevenDigits = !!postalCode.trim() && zipDigits.length !== 7;
  // 郵便番号と住所の前方一致検証。apiAddressZipが現在のzipDigitsと食い違う場合は
  // 郵便番号変更後の未再検索とみなし未検証扱い（=不一致エラー）にする
  const zipAddressVerified = zipDigits.length === 7 && apiAddressZip === zipDigits
    && !!apiAddress.trim() && addressAuto.startsWith(apiAddress);
  const zipAddressMismatch = !!addressAuto.trim() && zipDigits.length === 7 && !zipAddressVerified;

  const [isAllowed, setIsAllowed] = useState(null);  // null=判定中
  useEffect(() => {
    let cancelled = false;
    if (!sess?.user) { setIsAllowed(false); return; }
    (async () => {
      try {
        const { data, error } = await supabase.rpc('am_i_account_allowed');
        if (!cancelled) setIsAllowed(error ? false : !!data);
      } catch { if (!cancelled) setIsAllowed(false); }
    })();
    return () => { cancelled = true; };
  }, [sess?.user?.id]);
  const formValid = !!(fullName.trim() && isAdult && postalCode.trim() && addressAuto.trim() && addressDetail.trim()
    && entityType && (entityType === "individual" || (companyName.trim() && companyNumber.trim())) && agreed
    && !addressAutoHasAlphabet && !addressDetailHasAlphabet && !missingPrefectureWord && !missingCityWord
    && zipDigits.length === 7 && !zipAddressMismatch);
  const canSubmit = isAllowed === true && formValid;

  // ① 非公開情報(送達先)用の住所検索。求人フローsearchZip(②公開情報)とは
  // 情報の層が異なるため意図的に分離。共通化しない。
  const searchAccountZip = async () => {
    const zip = postalCode.replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setZipError("郵便番号は7桁で入力してください"); return; }
    setZipSearching(true); setZipError("");
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
      const data = await res.json();
      if (data.status === 200 && data.results) {
        const r = data.results[0];
        const full = (r.address1 || "") + (r.address2 || "");
        setAddressAuto(full);
        setApiAddress(full);
        setApiAddressZip(zip);
        setZipError("");
      } else {
        setZipError("郵便番号が見つかりませんでした");
      }
    } catch {
      setZipError("検索に失敗しました。通信環境をご確認ください");
    }
    setZipSearching(false);
  };

  const submit = async () => {
    if (!canSubmit || !sess) return;
    setBusy(true); setErr("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setBusy(false);
      if (onSessionExpired) onSessionExpired();
      else window.location.hash = "/login";
      return;
    }
    const { error } = await supabase.from("account_holders").insert({
      auth_id: session.user.id,
      full_name: fullName.trim(),
      birth_date: birthDateStr,
      postal_code: postalCode.trim(),
      address: (addressAuto.trim() + " " + addressDetail.trim()).trim(),
      entity_type: entityType,
      company_name: entityType === "corporate" ? companyName.trim() : null,
      company_number: entityType === "corporate" ? companyNumber.trim() : null,
      contact_email: session.user.email || null,
      contact_phone: session.user.phone || null,
      agreed_terms_version: TERMS_VERSION,
      agreed_privacy_version: PRIVACY_VERSION,
    });
    setBusy(false);
    if (error) { setErr("登録に失敗しました：" + error.message); return; }
    onDone();
  };

  if (sess === undefined) return <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:13,color:"#B0B0B0"}}>確認中…</p></div>;

  return (
    <div className="fade-in" style={{ minHeight:"80vh", padding:"28px 24px 64px" }}>
      <div style={{ width:"100%", maxWidth:640, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:36, marginBottom:12 }}>📝</div>
          <div className="f-sans" style={{ fontSize:20, fontWeight:700, color:C.ink }}>新規登録：本人情報の入力</div>
          <p className="f-sans" style={{ fontSize:11, color:C.dim, marginTop:6 }}>ご利用のために、本人確認情報をご入力ください</p>
        </div>

        <div className="ledger-card" style={{ padding:28, display:"grid", gap:28 }}>
          <div>
            <div className="f-sans" style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:10 }}>区分</div>
            <div style={{ display:"flex", gap:8 }}>
              <button type="button" onClick={()=>{ setEntityType("individual"); setCompanyName(""); setCompanyNumber(""); }} className="f-sans" style={{
                flex:1, padding:"10px 0", borderRadius:8,
                border: entityType==="individual" ? `2px solid ${C.bamboo}` : "1px solid #DADADA",
                background: entityType==="individual" ? C.bambooPl : "#fff",
                color: entityType==="individual" ? C.bamboo : "#717171",
                fontSize:13, fontWeight:700, cursor:"pointer",
              }}>個人</button>
              <button type="button" onClick={()=>setEntityType("corporate")} className="f-sans" style={{
                flex:1, padding:"10px 0", borderRadius:8,
                border: entityType==="corporate" ? `2px solid ${C.bamboo}` : "1px solid #DADADA",
                background: entityType==="corporate" ? C.bambooPl : "#fff",
                color: entityType==="corporate" ? C.bamboo : "#717171",
                fontSize:13, fontWeight:700, cursor:"pointer",
              }}>法人</button>
            </div>
          </div>

          <div>
            <div className="f-sans" style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:14 }}>本人確認</div>
            <div style={{ marginBottom:16 }}>
              <label className="lbl f-sans">{entityType==="corporate" ? "代表者氏名" : "氏名"}</label>
              <input className="field f-sans" type="text" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="山田 太郎" />
            </div>
            {entityType === "corporate" && (
              <div className="fade-in" style={{ marginBottom:16 }}>
                <label className="lbl f-sans">法人名</label>
                <input className="field f-sans" type="text" value={companyName} onChange={e=>setCompanyName(e.target.value)} placeholder="株式会社〇〇" />
              </div>
            )}
            {entityType === "corporate" && (
              <div className="fade-in" style={{ marginBottom:16 }}>
                <label className="lbl f-sans">法人番号</label>
                <input className="field f-sans" type="text" value={companyNumber} onChange={e=>setCompanyNumber(e.target.value)} placeholder="1234567890123（13桁）" />
                <p className="f-sans" style={{ marginTop:6, fontSize:11, color:"#717171" }}>国税庁の法人番号13桁</p>
              </div>
            )}
            <div>
              <label className="lbl f-sans">生年月日</label>
              <p className="f-sans" style={{ marginTop:0, marginBottom:6, fontSize:11, color:"#717171" }}>18歳未満は登録できません</p>
              <div style={{ display:"flex", gap:8 }}>
                <select className="field f-sans" style={{ flex:1.3 }} value={birthYear} onChange={e=>{
                  const y = e.target.value; setBirthYear(y);
                  if (y && birthMonth) { const dim = new Date(Number(y), Number(birthMonth), 0).getDate(); if (Number(birthDay) > dim) setBirthDay(""); }
                }}>
                  <option value="">年</option>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select className="field f-sans" style={{ flex:1 }} value={birthMonth} onChange={e=>{
                  const m = e.target.value; setBirthMonth(m);
                  if (birthYear && m) { const dim = new Date(Number(birthYear), Number(m), 0).getDate(); if (Number(birthDay) > dim) setBirthDay(""); }
                }}>
                  <option value="">月</option>
                  {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="field f-sans" style={{ flex:1 }} value={birthDay} onChange={e=>setBirthDay(e.target.value)}>
                  <option value="">日</option>
                  {Array.from({length:daysInMonth},(_,i)=>i+1).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {birthDateStr && !isAdult && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>18歳未満はご登録いただけません</p>}
            </div>
          </div>

          <div>
            <div className="f-sans" style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:14 }}>送達先</div>
            <div style={{ marginBottom:16 }}>
              <label className="lbl f-sans">郵便番号</label>
              <div style={{ display:"flex", gap:8 }}>
                <input className="field f-sans" type="text" value={postalCode} onChange={e=>setPostalCode(e.target.value)} placeholder="7790000" style={{ flex:1 }} />
                <button type="button" onClick={searchAccountZip} disabled={zipSearching} className="f-sans" style={{
                  padding:"0 16px", borderRadius:8, border:"1px solid #DADADA",
                  background:"#fff", color:"#222", fontSize:13, fontWeight:600,
                  cursor: zipSearching ? "default" : "pointer", whiteSpace:"nowrap",
                }}>{zipSearching ? "検索中..." : "住所を検索"}</button>
              </div>
              {zipError && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>{zipError}</p>}
              {!zipError && zipNotSevenDigits && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>郵便番号は7桁で入力してください</p>}
            </div>
            <div style={{ marginBottom:16 }}>
              <label className="lbl f-sans">{entityType==="corporate" ? "本店所在地" : "住所"}</label>
              <input className="field f-sans" type="text" value={addressAuto} onChange={e=>setAddressAuto(e.target.value)} placeholder="例：徳島県吉野川市（町名から先はご自身で入力してください）" />
              {addressAuto.trim() && addressAutoHasAlphabet && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>住所は日本語で入力してください</p>}
              {addressAuto.trim() && missingPrefectureWord && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>都道府県が含まれていません</p>}
              {addressAuto.trim() && missingCityWord && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>市区町村が含まれていません</p>}
              {addressAuto.trim() && !addressAutoHasAlphabet && !missingPrefectureWord && !missingCityWord && zipAddressMismatch && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>郵便番号と住所が一致しません</p>}
            </div>
            <div>
              <label className="lbl f-sans">番地・建物名</label>
              <input className="field f-sans" type="text" value={addressDetail} onChange={e=>setAddressDetail(e.target.value)} placeholder="1-2-3 ○○マンション101" />
              {addressDetail.trim() && addressDetailHasAlphabet && <p className="f-sans" style={{ marginTop:6, fontSize:11, color:C.shu }}>住所は日本語で入力してください</p>}
            </div>
          </div>

          <div>
            <div className="f-sans" style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:14 }}>連絡先</div>
            <p className="f-sans" style={{ fontSize:12, color:C.mid }}>
              {sess?.user?.email || sess?.user?.phone || "登録中のアカウント"} 宛に通知します
            </p>
          </div>

          <div>
            <label className="f-sans" style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12, color:C.mid, cursor:"pointer", lineHeight:1.6 }}>
              <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{ marginTop:2 }} />
              <span>
                <span onClick={e=>{ e.stopPropagation(); if (onShowTerms) onShowTerms(); }} style={{ color:C.bamboo, textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>利用規約</span>
                ・
                <span onClick={e=>{ e.stopPropagation(); if (onShowPrivacy) onShowPrivacy(); }} style={{ color:C.bamboo, textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>プライバシーポリシー</span>
                に同意します
              </span>
            </label>
          </div>

          {err && <p className="f-sans" style={{ fontSize:12, color:C.shu }}>{err}</p>}

          <div>
            <button className="btn-primary" style={{ width:"100%" }} disabled={!canSubmit || busy} onClick={submit}>
              {isAllowed === null ? "確認中…" : !isAllowed ? "準備中" : busy ? "登録中…" : "登録する"}
            </button>
            {isAllowed === false && (
              <p className="f-sans" style={{ fontSize:11, color:C.dim, textAlign:"center", marginTop:10 }}>
                現在準備中です。もうしばらくお待ちください
              </p>
            )}
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







// ── JobSearchMapView ────────────────────────────────────────
// 「募集中の仕事を探す」画面。LandingFlow・LaborTab 両方で使用。
// 将来: Google Maps / Mapbox / Leaflet に差し替え可能な構造にしてある。
// 応募パネルの「最高額」自動計算（段階2-a・ダミー前提）
// workTime "8:00〜16:00" を想定。日数は job.dateStart / job.dateEnd（date型）から算出。フォーマット外は null を返す
function calcMaxPay(job) {
  const timeMatch = /^(\d{1,2}):(\d{2})〜(\d{1,2}):(\d{2})$/.exec(job.workTime || "");
  if (!job.dateStart) return null;
  const end = job.dateEnd || job.dateStart;
  const days = Math.round((end - job.dateStart) / 86400000) + 1;
  if (!Number.isFinite(days) || days <= 0) return null;

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





// 承認され当事者間のやり取りが可能になった段階以降のapplications.status一覧（completed含む）
const APPROVED_PLUS_STATUSES = ["approved","meeting","interview","contracted","working","completed"];

// 今日がdateStart〜dateEnd（dateEndなければdateStart単日）の範囲内か。日付のみで比較（時刻無視）

// 評価モーダルの「はい/いいえ」2択ピル。reviews.want_again等のbool列と1対1で対応
function YesNoPill({ label, value, onChange }) {
  return (
    <div style={{ marginBottom:12 }}>
      <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", marginBottom:6 }}>{label}</p>
      <div style={{ display:"flex", gap:8 }}>
        {[["はい",true],["いいえ",false]].map(([l,v]) => (
          <button key={l} type="button" onClick={()=>onChange(v)} className="f-sans" style={{
            flex:1, padding:"9px", borderRadius:10, fontSize:13, cursor:"pointer", fontWeight:600, border:"2px solid",
            borderColor: value===v ? "#00A86B" : "#EBEBEB",
            background: value===v ? "#E6F7EF" : "#fff", color: value===v ? "#00A86B" : "#222",
          }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// 緊急連絡の種別選択肢（当事者ごとに異なる）。attendance_events.kindのCHECK制約と対応
const WORKER_EMERGENCY_KINDS = [{ v:"late", l:"遅れる" }, { v:"absent_notice", l:"欠勤の連絡" }, { v:"no_show_report", l:"👻 現地に相手がいません・連絡がつきません" }];
const FARMER_EMERGENCY_KINDS = [{ v:"cancel", l:"中止" }, { v:"postpone", l:"延期" }, { v:"no_show_report", l:"👻 現地に相手がいません・連絡がつきません" }];

// アップロード前のクライアント圧縮（2026-07-16）：長辺1600px・JPEG品質0.8に縮小する。
// 原寸4MB級の写真が確認ページ等で「白いまま読み込み待ち」になる問題と、転送量（egress）対策の両方。
// 圧縮に失敗したら原本をそのまま返す（古いブラウザ等でも壊れない）
async function compressImage(file, maxSide = 1600, quality = 0.8) {
  try {
    if (!file || !file.type || !file.type.startsWith("image/")) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 600 * 1024) return file; // 十分小さい画像は無加工
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // 逆に大きくなったら原本
    return new File([blob], (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}

// 待遇バッジ（タイトル下用・2026-07-16）：employer_profilesのONの項目だけ短いラベルで返す。
// 確認ページ・詳細ページで共通。OFFの項目は出さない（ダミー禁止）
function perkBadges(ep) {
  if (!ep) return [];
  return [
    ep.has_transport && "🚐 送迎あり",
    ep.has_parking && "🅿️ 駐車場",
    ep.has_commute_allowance && "🚃 通勤手当",
    ep.has_bonus && "🎁 賞与",
    ep.employer_pays_supplies && ("🧤 持ち物は農家負担" + (ep.supplies_cap ? "（" + ep.supplies_cap + "）" : "")),
    ep.accessory_ok && "💍 アクセサリーOK",
  ].filter(Boolean);
}

// 写真配列の正規化（2026-07-16）：旧形式（"url"文字列）が混ざると確認ページ等の p.url が
// undefined になり真っ白なスライドが出るため、復元・再開の境界で必ず {url, caption} に揃える。
// url の無い壊れた要素は除外する
function normalizePhotos(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(p => (typeof p === "string" ? { url: p } : p))
    .filter(p => p && typeof p.url === "string" && p.url.trim());
}

// 危険項目の2つ目に中身（タイトル・説明・写真）があるか（2026-07-16）。
// 復元時にshowPlace2/showTask2を立てないと、2つ目がstep9で見えないまま確認ページに残り続ける
function dangerHasSecond(arr) {
  const x = Array.isArray(arr) ? arr[1] : null;
  return !!(x && (((x.label || "").trim()) || ((x.desc || "").trim()) || ((x.photos || []).length > 0)));
}





const PR_PROMPTS = [
  { q:"農作業に興味を持ったきっかけは？", placeholder:"きっかけを、あなたの言葉で" },
  { q:"働くうえで大事にしていることは？", placeholder:"大事にしていることを、あなたの言葉で" },
  { q:"農家さんに一言、伝えたいことは？", placeholder:"伝えたいことを、あなたの言葉で" },
];
// 働き手プロフィールQ&A：20問メニュー（4グループ）。答えた問いだけがpr_qaに残る＝義務ではない
const WORKER_QA_QUESTIONS = [
  { group:"⭐農家がよく見る質問", questions:[
    "これまでの農作業の経験を教えてください",
    "自分の強みはなんですか？",
    "どのくらいの頻度で働きたいですか？",
  ]},
  { group:"きっかけ・興味", questions:[
    "農業のバイトを始めたのはいつですか？",
    "農作業に興味を持ったきっかけは？",
    "農業にどれくらい興味がありますか？",
    "将来、農業とどう関わりたいですか？",
  ]},
  { group:"姿勢", questions:[
    "バイトをするうえで心がけていることは？",
    "働くうえで大事にしていることは？",
    "自分の強みはなんですか？",
    "人と働くときに気をつけていることは？",
  ]},
  { group:"経験", questions:[
    "これまでの農作業の経験を教えてください",
    "これまでにどんな農作業の経験がありますか？（他のサービスや手伝いでの経験も、作業の内容で教えてください）",
    "農業以外の仕事・バイトの経験は？",
    "使ったことのある道具や機械はありますか？",
    "体を動かすことは好きですか？",
  ]},
  { group:"条件・生活", questions:[
    "どのくらいの頻度で働きたいですか？",
    "働けるのはどの季節・時期ですか？",
    "朝と夕方、どちらが動きやすいですか？",
    "どのくらいの距離まで通えますか？",
  ]},
  { group:"ひとこと", questions:[
    "農家さんに一言お願いします",
    "趣味や普段していることは？",
    "chitose-bankを知ったきっかけは？",
    "このバイトで得たいことは？",
  ]},
];

// 特定の問いにだけ入力例を添える（回数・バッジ・星ではなく「作業の中身」を書いてもらう誘導）。
// キーは質問文そのもの。未定義の問いはプレースホルダなし
const WORKER_QA_PLACEHOLDERS = {
  "これまでにどんな農作業の経験がありますか？（他のサービスや手伝いでの経験も、作業の内容で教えてください）": "ナスの収穫と袋詰めを2シーズン。タイミーで倉庫の仕分けもしていました",
};

// 15秒カード用プリセット（2026-07-14たきと判断でCLAUDE.md許可リストに追加。詳細はCLAUDE.md参照）
const WORK_INTENSITY_OPTIONS = ["軽めの作業希望", "どちらでも", "力仕事もOK"];
const INTEREST_OPTIONS = ["釣り","料理","ランニング","筋トレ","読書","音楽","映画","ゲーム","旅行","キャンプ","園芸","DIY","動物","写真","スポーツ観戦","ショッピング","ドライブ","ネットサーフィン"];
const LANGUAGE_OPTIONS = ["日本語","英語","中国語","ベトナム語","インドネシア語","タガログ語","ポルトガル語","その他"];



// 15秒カード（プレビュー最上部・農家側応募者カードで共通利用）。値が無い項目は非表示
// onEditItem（任意）: 本人プレビュー用。渡すと各項目がタップ可能になり、対応する編集ボックスのキーを返す。
// 農家側（応募者カード等）は渡さない＝従来どおり表示専用


// あなたの評価（2026-07-19）：この農家自身が過去にこの働き手へ行った評価の全記録。
// 職安法対応：reviewsのRLSは reviewer_id = auth.uid() のSELECTのみ＝評価した当人にしか読めず、
// 他の農家・第三者への評価公開（推薦・選別）はDBレベルで不可能。本人の記録を本人に見せるだけの設計
function MyReviewsOfWorker({ workerId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { if (!cancelled) setRows([]); return; }
        const { data } = await supabase.from("reviews")
          .select("id,application_id,want_again,entrust,public_comment,private_memo,created_at")
          .eq("reviewer_id", session.user.id).eq("reviewee_id", workerId).eq("direction", "farmer_to_worker")
          .order("created_at", { ascending: false });
        if (!cancelled) setRows(data || []);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, [workerId]);
  if (!rows || rows.length === 0) return null;
  const yn = (v) => (v === true ? "はい" : v === false ? "いいえ" : "ー");
  return (
    <div style={{ marginTop:14, background:"#F7FBF9", border:"1px solid #D8EFE3", borderRadius:12, padding:"12px 14px" }}>
      <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:"#00A86B", margin:"0 0 2px" }}>📋 あなたの評価</p>
      <p className="f-sans" style={{ fontSize:10, color:"#999", margin:"0 0 8px" }}>あなたが行った評価の記録です。あなた以外の農家には表示されません</p>
      {rows.map(r => (
        <div key={r.id} className="f-sans" style={{ borderTop:"1px solid #E5F2EB", padding:"8px 0 6px", fontSize:12, color:"#222" }}>
          <p style={{ margin:"0 0 4px", color:"#999", fontSize:11 }}>{new Date(r.created_at).toLocaleDateString("ja-JP")}</p>
          <p style={{ margin:0 }}>また呼びたい：<b>{yn(r.want_again)}</b>　安心して任せられた：<b>{yn(r.entrust)}</b></p>
          {r.public_comment && <p style={{ margin:"4px 0 0", lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word" }}>働きぶり：{r.public_comment}</p>}
          {r.private_memo && <p style={{ margin:"4px 0 0", lineHeight:1.6, color:"#717171", overflowWrap:"break-word", wordBreak:"break-word" }}>🔒 メモ（自分のみ）：{r.private_memo}</p>}
        </div>
      ))}
    </div>
  );
}

function EmployerPreviewSheet() {
  const [st, setSt] = useState(null); // {farmer_id, loading, profile, trust}
  useEffect(() => {
    const f = (e) => {
      const farmerId = e.detail;
      if (!farmerId) return;
      setSt({ farmer_id: farmerId, loading: true, profile: null, trust: null });
      (async () => {
        try {
          const [epRes, trustRes] = await Promise.all([
            supabase.from("employer_profiles_public").select("auth_id,nickname,avatar_url,owner_comment,pr,intro_path,intro_joy,intro_crops,intro_atmosphere,intro_message,unique_point,always_do,break_style,interaction_style,staff_count,commitment,has_transport,has_parking,has_commute_allowance,has_bonus,employer_pays_supplies,accessory_ok,parking_capacity,commute_allowance_detail,transport_area,supplies_cap,insurance_items,created_at").eq("auth_id", farmerId).maybeSingle(),
            supabase.rpc("employer_trust_info", { p_farmer_id: farmerId }),
          ]);
          setSt(prev => prev && prev.farmer_id === farmerId ? {
            farmer_id: farmerId, loading: false,
            profile: epRes.data || null,
            trust: (trustRes.data && trustRes.data.ok) ? trustRes.data : null,
          } : prev);
        } catch {
          setSt(prev => prev && prev.farmer_id === farmerId ? { ...prev, loading: false } : prev);
        }
      })();
    };
    window.addEventListener("cb:openEmployerPreview", f);
    return () => window.removeEventListener("cb:openEmployerPreview", f);
  }, []);
  if (!st) return null;
  const topics = st.profile ? farmIntroTopics(st.profile) : [];
  return (
    <div onClick={()=>setSt(null)} className="cb-preview-overlay" style={{ position:"fixed", inset:0, zIndex:9700, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <button onClick={()=>setSt(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 16px" }}>{st.profile?.nickname ? `${st.profile.nickname}の農園紹介` : "農園紹介"}</p>
        {st.loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中...</p>
        ) : st.profile ? (
          <>
            <FarmerTrustCard profile={st.profile} trust={st.trust} />
            {perkBadges(st.profile).length > 0 && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:14 }}>
                {perkBadges(st.profile).map(b => (
                  <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{b}</span>
                ))}
              </div>
            )}
            {topics.length > 0 && (
              <div style={{ display:"grid", gap:10, marginTop:16 }}>
                {topics.map(t => (
                  <div key={t.label}>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{t.label}</p>
                    <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{t.body}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>この農家のプロフィールは未設定です</p>
        )}
      </div>
    </div>
  );
}

// アバターのアップロード（通信断耐性・2026-07-19）：iOS Safariでは応答だけ失われて「Load failed」に
// なっても実際にはサーバー保存済みのことがある（実事例：2026-07-19 働き手アイコン）。
// 1回リトライ→それでも失敗なら実物の存在確認で救済する。呼び出し前に旧ファイルは掃除済みの前提
// （フォルダにavatar.jpgが残っていれば今回のアップロードの実物と判断できる）
async function uploadAvatarResilient(folder, blob) {
  const path = folder + "/avatar.jpg";
  const attempt = async () => (await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })).error;
  let err = await attempt();
  if (err) {
    await new Promise(r => setTimeout(r, 800));
    err = await attempt();
  }
  if (err) {
    try {
      const { data: files, error: listErr } = await supabase.storage.from('avatars').list(folder);
      if (!listErr && (files || []).some(f => f.name === 'avatar.jpg')) err = null;
    } catch {}
  }
  return err;
}
function WorkerPreviewSheet() {
  const [st, setSt] = useState(null); // {worker_id, loading, profile, trust}
  useEffect(() => {
    const f = (e) => {
      const workerId = e.detail;
      if (!workerId) return;
      setSt({ worker_id: workerId, loading: true, profile: null, trust: null });
      (async () => {
        try {
          const [wpRes, trustRes, sessRes] = await Promise.all([
            supabase.from("worker_profiles").select("*").eq("auth_id", workerId).maybeSingle(),
            supabase.rpc("worker_trust_info", { p_worker_id: workerId }),
            supabase.auth.getSession(),
          ]);
          // 審査中（審査待ち／修正依頼中）の働き手は、本人と運営以外にプレビューを見せない（2026-07-19）
          const p = wpRes.data || null;
          const viewer = sessRes?.data?.session?.user || null;
          const underReview = !!(p && (((p.pr_pending || "").trim()) || (Array.isArray(p.pr_qa_pending) && p.pr_qa_pending.length > 0)));
          const blocked = underReview && viewer?.id !== workerId && !isAdmin(viewer);
          setSt(prev => prev && prev.worker_id === workerId ? {
            worker_id: workerId, loading: false, blocked,
            profile: blocked ? null : p,
            trust: (!blocked && trustRes.data && trustRes.data.ok) ? trustRes.data : null,
          } : prev);
        } catch {
          setSt(prev => prev && prev.worker_id === workerId ? { ...prev, loading: false } : prev);
        }
      })();
    };
    window.addEventListener("cb:openWorkerPreview", f);
    return () => window.removeEventListener("cb:openWorkerPreview", f);
  }, []);
  if (!st) return null;
  return (
    <div onClick={()=>setSt(null)} className="cb-preview-overlay" style={{ position:"fixed", inset:0, zIndex:9700, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <button onClick={()=>setSt(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 16px" }}>働き手のプレビュー</p>
        {st.loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中...</p>
        ) : st.profile ? (
          <>
            <WorkerTrustCard profile={st.profile} trust={st.trust} />
            {Array.isArray(st.profile.pr_qa) && st.profile.pr_qa.length > 0 && (
              <div style={{ display:"grid", gap:10, marginTop:16 }}>
                {st.profile.pr_qa.map(({ q, a }) => (
                  <div key={q}>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
                    <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                  </div>
                ))}
              </div>
            )}
            <MyReviewsOfWorker workerId={st.worker_id} />
          </>
        ) : st.blocked ? (
          <div style={{ textAlign:"center", padding:"32px 0" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>⏳</div>
            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 6px" }}>プロフィールは審査中です</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>運営の確認が終わると表示されます。</p>
          </div>
        ) : (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>この方のプロフィールは未設定です</p>
        )}
      </div>
    </div>
  );
}


function WorkerProfileEdit({ me, onDone, onCancel, onAvatarChange }) {
  const [nickname, setNickname] = useState("");
  const [pr, setPr] = useState("");
  const [prPromptIndex, setPrPromptIndex] = useState(null); // 選んだ問い(ヒント)。PR欄への保存内容には含めない
  const [prQa, setPrQa] = useState([]); // [{q,a}]（20問メニューのうち答えた分だけ）
  const [activeQ, setActiveQ] = useState(null); // 現在テキストエリアを開いている問い
  const [qaDraft, setQaDraft] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [residenceCity, setResidenceCity] = useState("");
  const [transport, setTransport] = useState("");
  const [farmExperience, setFarmExperience] = useState("");
  const [physicalLevel, setPhysicalLevel] = useState("");
  const [interests, setInterests] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [selfDeclared, setSelfDeclared] = useState([]); // できること・資格（自己申告・key配列・2026-07-23）
  const [expEntries, setExpEntries] = useState([]); // 経験の構造化申告 {crop,task,duration}（最大5・2026-07-23）
  const [experiencedTasks, setExperiencedTasks] = useState([]); // 旧「経験のある作業」＝その他の作業（残置・データ移行なし）
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [revTargets, setRevTargets] = useState([]); // 修正依頼の指摘対象（"自己紹介本文"/質問文・2026-07-19）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("worker_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (data) {
          setNickname(data.nickname || "");
          // 自由記述は確認待ち(pending)があればそちらを編集継続、無ければ公開版を初期値に
          setPr(data.pr_pending ?? data.pr ?? "");
          setAvatarUrl(data.avatar_url || "");
          setPrQa(Array.isArray(data.pr_qa_pending) ? data.pr_qa_pending : (Array.isArray(data.pr_qa) ? data.pr_qa : []));
          setResidenceCity(data.residence_city || "");
          setTransport(data.transport || "");
          setFarmExperience(data.farm_experience || "");
          setPhysicalLevel(data.physical_level || "");
          setInterests(Array.isArray(data.interests) ? data.interests : []);
          setLanguages(Array.isArray(data.languages) ? data.languages : []);
          setSelfDeclared(Array.isArray(data.self_declared) ? data.self_declared : []);
          setExpEntries(Array.isArray(data.experience_entries) ? data.experience_entries : []);
          setExperiencedTasks(Array.isArray(data.experienced_tasks) ? data.experienced_tasks : []);
          // 修正依頼の指摘対象（2026-07-19）：該当ボックスに赤帯を出す。再提出（保存）で消える
          setRevTargets(Array.isArray(data.pr_revision_targets) ? data.pr_revision_targets : []);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);
  const toggleInterest = (v) => setInterests(prev => {
    if (prev.includes(v)) return prev.filter(x => x !== v);
    if (prev.length >= 3) return prev;
    return [...prev, v];
  });
  const toggleLanguage = (v) => setLanguages(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const qaAnswerFor = (q) => prQa.find(x => x.q === q)?.a || "";
  const openQuestion = (q) => { setActiveQ(q); setQaDraft(qaAnswerFor(q)); };
  const saveQaAnswer = () => {
    const text = qaDraft.trim();
    if (!text) return;
    setPrQa(prev => prev.some(x => x.q === activeQ) ? prev.map(x => x.q === activeQ ? { ...x, a: text } : x) : [...prev, { q: activeQ, a: text }]);
    setActiveQ(null); setQaDraft("");
  };
  const deleteQaAnswer = (q) => {
    setPrQa(prev => prev.filter(x => x.q !== q));
    if (activeQ === q) { setActiveQ(null); setQaDraft(""); }
  };
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像を読み込めませんでした。別の画像をお試しください。')); };
    img.src = url;
  });
  const handleAvatar = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }
      let sourceFile = file;
      // iPhoneのHEIC/HEIF形式は、まずheic2anyでjpegにデコード（選択時のみ動的import）
      const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
      if (isHeic) {
        try {
          const heic2any = (await import('heic2any')).default;
          const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
          sourceFile = Array.isArray(converted) ? converted[0] : converted;
        } catch (heicErr) { setUploading(false); alert("iPhoneの写真（HEIC）の変換に失敗しました。もう一度お試しください。"); return; }
      }
      let blob;
      try { blob = await convertToJpeg(sourceFile); }
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
      const upErr = await uploadAvatarResilient("worker/" + session.user.id, blob);
      if (upErr) { setUploading(false); alert("アップロードに失敗しました：" + upErr.message + "\n通信環境を確認して、もう一度お試しください。"); return; }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = (urlData?.publicUrl || '') + "?t=" + Date.now();
      await supabase.from('worker_profiles').upsert({ auth_id: session.user.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl(url);
      if (typeof onAvatarChange === "function") onAvatarChange({ url, name: nickname });
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
      if (typeof onAvatarChange === "function") onAvatarChange({ url: "", name: nickname });
    } catch { alert("削除に失敗しました。"); }
    setUploading(false);
  };
  // ハブの「📋 経験・できること」カードから来た時は、その場でそのボックスを開く（2026-07-23）
  const [editBox, setEditBox] = useState(() => { try { const b = sessionStorage.getItem("cb_wkOpenBox"); if (b) { sessionStorage.removeItem("cb_wkOpenBox"); return b; } } catch {} return null; }); // avatar|nickname|residence|transport|exp|intensity|interests|languages|declared|pr|qa
  const [showPreview, setShowPreview] = useState(false); // 右上「プレビュー」→WorkerProfilePreviewをモーダル展開
  const [editFromPreview, setEditFromPreview] = useState(false); // プレビュー発の編集：閉じたらプレビューへ戻る（往復）
  // 承認ポップアップ「プレビューを見る🔗」からの着地：編集ページを開いた直後にプレビューを自動展開
  useEffect(() => {
    try {
      if (sessionStorage.getItem("cb_openWorkerPreview") === "1") {
        sessionStorage.removeItem("cb_openWorkerPreview");
        setShowPreview(true);
      }
    } catch {}
  }, []);
  const closeEditBox = () => {
    setEditBox(null);
    if (editFromPreview) { setEditFromPreview(false); setShowPreview(true); }
  };
  // 保存→次の未入力ボックスを自動展開（全て入力されるまでループ・2026-07-16）
  const BOX_ORDER = ["avatar","nickname","pr","residence","transport","exp","intensity","interests","languages","declared","qa"];
  const boxFilled = (k) => (
    k === "pr" ? !!pr.trim() : k === "nickname" ? !!nickname.trim() : k === "residence" ? !!residenceCity.trim()
    : k === "transport" ? !!transport : k === "exp" ? !!farmExperience : k === "intensity" ? !!physicalLevel
    : k === "interests" ? interests.length > 0 : k === "languages" ? languages.length > 0
    : k === "declared" ? (selfDeclared.length > 0 || expEntries.some(e => (e.crop||"").trim())) : k === "avatar" ? !!avatarUrl : prQa.length > 0
  );
  const nextUnfilledBox = (afterKey) => {
    const start = Math.max(0, BOX_ORDER.indexOf(afterKey));
    for (let i = 1; i <= BOX_ORDER.length; i++) {
      const k = BOX_ORDER[(start + i) % BOX_ORDER.length];
      if (!boxFilled(k)) return k;
    }
    return null;
  };
  const save = async (stay = false) => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      // 自由記述(pr/pr_qa)は運営確認後に公開。pr_pending/pr_qa_pendingに保存し、
      // 公開版のpr/pr_qaは書かない(承認RPC/48時間cronだけが書く)。選択式項目は従来どおり即時保存
      const { error } = await supabase.from("worker_profiles").upsert({
        auth_id: session.user.id, nickname: nickname.trim(),
        pr_pending: pr.trim(), pr_qa_pending: prQa, pr_submitted_at: new Date().toISOString(),
        pr_revision_targets: null, // 再提出＝修正依頼の赤帯を解除（2026-07-19）
        residence_city: residenceCity.trim(), transport, farm_experience: farmExperience, physical_level: physicalLevel,
        interests, languages, self_declared: selfDeclared,
        experience_entries: expEntries.map(e => ({ crop:(e.crop||"").trim(), task:e.task||"", duration:e.duration||"" })).filter(e => e.crop).slice(0, 5),
        experienced_tasks: experiencedTasks,
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      setSaving(false);
      if (!error) {
        setSaved(true);
        setRevTargets([]);
        if (typeof onAvatarChange === "function") onAvatarChange({ url: avatarUrl, name: nickname.trim() });
        if (stay === true) {
          // 保存→次の未入力ボックスへ（全て入力済みなら閉じる・2026-07-16）。
          // BOX_ORDER外のボックス（保険=ホームから開く移植分）は次へ送らず閉じる
          const nxt = BOX_ORDER.includes(editBox) ? nextUnfilledBox(editBox) : null;
          if (nxt) setEditBox(nxt); else closeEditBox();
          setTimeout(() => setSaved(false), 2200);
        }
        else setTimeout(() => { setSaved(false); if (typeof onDone === "function") onDone(); }, 2200);
      }
      else alert("保存に失敗しました：" + error.message);
    } catch { setSaving(false); alert("保存に失敗しました。"); }
  };
  if (loading) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>;
  return (
    <div style={{ marginTop:32, paddingTop:32, borderTop:"1px solid #EEE" }}>
      {/* 右上に保存・プレビュー（2026-07-14）。プレビューはモーダル展開（保存済みの内容を表示） */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:4 }}>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", letterSpacing:".08em", margin:0 }}>働き手プロフィール</p>
        <div style={{ display:"flex", gap:8, flexShrink:0 }}>
          <button onClick={()=>setShowPreview(true)} className="f-sans" style={{ padding:"9px 16px", fontSize:13, fontWeight:600, background:"#fff", color:"#222", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>プレビュー</button>
          <button onClick={()=>save(true)} disabled={saving} className="btn-primary f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, borderRadius:10 }}>{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>求人に応募したとき、農家に伝わる自己紹介です。タップして入力できます。</p>

      {/* はじめの3つガイド（2026-07-22）：空の時だけ上部に。①名前②顔写真③経験の質問1つ。タップで該当欄・埋まると✓ */}
      {(() => {
        const steps = [
          { k:"nickname", l:"①お名前",        done: !!nickname.trim() },
          { k:"avatar",   l:"②顔写真",        done: !!avatarUrl },
          { k:"qa",       l:"③経験の質問を1つ", done: prQa.length > 0 },
        ];
        if (steps.every(s => s.done)) return null;
        return (
          <div className="f-sans" style={{ background:"#F0F7F4", border:"1px solid #00A86B33", borderRadius:16, padding:"16px", marginBottom:20 }}>
            <p style={{ fontSize:14, fontWeight:800, color:"#00A86B", margin:"0 0 4px" }}>まずこの3つで応募できます</p>
            <p style={{ fontSize:11, color:"#717171", margin:"0 0 12px", lineHeight:1.6 }}>この3つが埋まれば求人に応募できます。あとからいつでも足せます。</p>
            <div style={{ display:"grid", gap:8 }}>
              {steps.map(s => (
                <button key={s.k} onClick={()=>setEditBox(s.k)} className="f-sans" style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", background:"#fff", border:"1px solid "+(s.done?"#00A86B":"#EBEBEB"), borderRadius:12, padding:"12px 14px", cursor:"pointer" }}>
                  <span style={{ width:24, height:24, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, background: s.done?"#00A86B":"#F0F0F0", color: s.done?"#fff":"#B0B0B0" }}>{s.done?"✓":""}</span>
                  <span style={{ fontSize:14, fontWeight:700, color: s.done?"#00A86B":"#222", flex:1 }}>{s.l}</span>
                  {!s.done && <span style={{ fontSize:12, color:"#00A86B", fontWeight:700, flexShrink:0 }}>入力する →</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ═══ ボックス格子（入口カードと同じ様式・タップでモーダル編集・2026-07-14） ═══ */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {[
          // req:true=看板の核（未入力なら浮遊アニメ）。それ以外は任意=未入力でも赤影のみ（2026-07-16・農家プロと同じ規則）
          // 配置（2026-07-16）：アイコン・ニックネーム／アイコンの下に自己紹介。任意は農家プロと同じ系統順（条件系→属性→問いかけ系が最後）
          { k:"avatar",    e:"🖼️", l:"アイコン",     req:true, v: avatarUrl ? "設定済み" : "" },
          { k:"nickname",  e:"✏️", l:"ニックネーム", req:true, v: nickname },
          { k:"pr",        e:"📝", l:"自己紹介",     req:true, v: pr },
          { k:"residence", e:"📍", l:"居住地",       v: residenceCity },
          { k:"transport", e:"🚗", l:"移動手段",     v: transport },
          { k:"exp",       e:"🌾", l:"農業経験",     v: farmExperience },
          { k:"intensity", e:"💪", l:"作業の強さ",   v: physicalLevel },
          { k:"interests", e:"🎨", l:"趣味",         v: interests.join("・") },
          { k:"languages", e:"🗣️", l:"言語",         v: languages.join("・") },
          { k:"declared",  e:"📋", l:"経験・資格", v: [...expEntries.filter(e=>(e.crop||"").trim()).map(e=>`${e.crop}×${e.task||""}`), ...selfDeclared.map(k => (WORKER_DECLARATIONS.find(x=>x.k===k)||{}).chip)].filter(Boolean).join("・") },
          { k:"qa",        e:"💬", l:"質問に答える", v: prQa.length > 0 ? `${prQa.length}問に回答` : "" },
        ].map(b => {
          // 修正依頼の赤帯（2026-07-19）：指摘対象「自己紹介本文」→自己紹介ボックス／質問文→質問に答えるボックス
          const revFlagged = revTargets.length > 0 && (b.k === "pr" ? revTargets.includes("自己紹介本文") : b.k === "qa" ? revTargets.some(t => t !== "自己紹介本文") : false);
          return (
          <button key={b.k} onClick={()=>setEditBox(b.k)} className={"f-sans" + (revFlagged ? " cb-urgent-still" : b.v ? "" : (b.req ? " cb-urgent-card" : " cb-urgent-still"))} style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding: revFlagged ? "20px 10px 38px" : "20px 10px 16px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0 }}>
            {revFlagged && (
              <span className="f-sans" style={{ position:"absolute", left:0, right:0, bottom:0, zIndex:1, padding:"5px 6px", borderRadius:"0 0 20px 20px", background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, textAlign:"center", boxSizing:"border-box" }}>⚠️ 修正のお願い</span>
            )}
            {b.k === "avatar" ? <Avatar url={avatarUrl} name={nickname} size={36} /> : <span style={{ fontSize:34, lineHeight:1 }}>{b.e}</span>}
            <span style={{ fontSize:14, fontWeight:700, color:"#222" }}>{b.l}</span>
            <span style={{ fontSize:11, color: b.v ? "#00A86B" : "#B0B0B0", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.v || "未設定"}</span>
          </button>
          );
        })}
      </div>
      {saved && (
        <p className="f-sans" style={{ fontSize:12, color:"#00A86B", textAlign:"center", marginTop:14 }}>保存しました ✓　自己紹介は運営の確認後に公開されます（最大2日）</p>
      )}
      {onCancel && (
        <button onClick={onCancel} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:14, background:"none", border:"none", cursor:"pointer", fontSize:13, color:"#717171", textDecoration:"underline" }}>プレビューに戻る</button>
      )}

      {/* ═══ 編集モーダル（各ボックスの中身。保存はモーダル内の「保存する」＝全項目upsert） ═══ */}
      {editBox && (
      <div onClick={closeEditBox} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:520, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative" }}>
      <button onClick={closeEditBox} style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer", zIndex:1 }}>✕</button>

      {editBox==="avatar" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>アイコン</label>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", border:"1.5px solid #00A86B", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0 }}>
          <Avatar url={avatarUrl} name={nickname} size={64} />
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
      </>)}

      {editBox==="nickname" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>ニックネーム</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>呼び名です。本名でなくてかまいません。</p>
      <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="例：たき" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      </>)}

      {editBox==="residence" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>居住地</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>通える範囲の確認に使われます。</p>
      <input value={residenceCity} onChange={e=>setResidenceCity(e.target.value)} placeholder="例：吉野川市（市町村まで）" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      </>)}

      {editBox==="transport" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>移動手段</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>集合場所までの足の確認に使われます。</p>
      <LFPillSelect options={["車","バイク","自転車","公共交通"]} value={transport} onSelect={setTransport} />
      </>)}

      {editBox==="exp" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6, marginTop:8 }}>農業就労の経験</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>未経験でも大丈夫。正直に選んでください。</p>
      <LFPillSelect options={["未経験","経験あり"]} value={farmExperience} onSelect={setFarmExperience} />
      </>)}

      {editBox==="intensity" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6, marginTop:8 }}>希望する作業の強さ</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 10px", lineHeight:1.6 }}>力仕事もOKか、軽めがいいか、希望で選べます。</p>
      <LFPillSelect options={WORK_INTENSITY_OPTIONS} value={physicalLevel} onSelect={setPhysicalLevel} />
      </>)}

      {editBox==="interests" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6, marginTop:16 }}>趣味（最大3つ）</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
        {INTEREST_OPTIONS.map(v => {
          const selected = interests.includes(v);
          const disabled = !selected && interests.length >= 3;
          return (
            <button key={v} type="button" onClick={()=>toggleInterest(v)} disabled={disabled} className="f-sans" style={{
              padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor: disabled ? "default" : "pointer",
              border:"1px solid " + (selected ? "#00A86B" : "#EBEBEB"),
              background: selected ? "#E6F7EF" : "#F7F7F7",
              color: selected ? "#00A86B" : (disabled ? "#D0D0D0" : "#717171"),
            }}>{v}</button>
          );
        })}
      </div>
      </>)}

      {editBox==="languages" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>やり取りできる言語</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
        {LANGUAGE_OPTIONS.map(v => (
          <button key={v} type="button" onClick={()=>toggleLanguage(v)} className="f-sans" style={{
            padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
            border:"1px solid " + (languages.includes(v) ? "#00A86B" : "#EBEBEB"),
            background: languages.includes(v) ? "#E6F7EF" : "#F7F7F7",
            color: languages.includes(v) ? "#00A86B" : "#717171",
          }}>{v}</button>
        ))}
      </div>
      </>)}

      {editBox==="declared" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>📋 経験・できること（自己申告）</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:12, lineHeight:1.6 }}>あなたのプロフィールに「ご本人の申告」として表示されます。運営が確認するものではありません。</p>

      {/* 経験の構造化申告（作物×作業×どのくらい・最大5・2026-07-23） */}
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"0 0 6px" }}>経験（作物 × 作業 × どのくらい）</p>
      <datalist id="cb-crop-opts">{CROP_OPTIONS.map(c => <option key={c.name} value={c.name} />)}</datalist>
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:8 }}>
        {expEntries.map((e, i) => (
          <div key={i} style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
            <input list="cb-crop-opts" value={e.crop || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, crop: ev.target.value } : x))} placeholder="作物（選択・自由入力）" className="field f-sans" style={{ fontSize:13, flex:"1 1 120px", minWidth:0, marginBottom:0 }} />
            <select value={e.task || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, task: ev.target.value } : x))} className="field f-sans" style={{ fontSize:13, flex:"1 1 90px", minWidth:0, marginBottom:0 }}>
              <option value="">作業</option>
              {TASK_OPTIONS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <select value={e.duration || ""} onChange={ev=>setExpEntries(prev => prev.map((x,j)=> j===i ? { ...x, duration: ev.target.value } : x))} className="field f-sans" style={{ fontSize:13, flex:"1 1 110px", minWidth:0, marginBottom:0 }}>
              <option value="">どのくらい</option>
              {["少し","1〜2シーズン","3シーズン以上"].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button onClick={()=>setExpEntries(prev => prev.filter((_,j)=>j!==i))} aria-label="削除" className="f-sans" style={{ flexShrink:0, width:30, height:30, borderRadius:8, background:"#F5F5F5", border:"none", color:"#999", fontSize:15, cursor:"pointer" }}>×</button>
          </div>
        ))}
      </div>
      {expEntries.length < 5 && (
        <button onClick={()=>setExpEntries(prev => [...prev, { crop:"", task:"", duration:"" }])} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"9px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600, marginBottom:16 }}>＋ 経験を追加</button>
      )}

      {/* 免許・資格・保険方針 */}
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"4px 0 6px" }}>免許・資格・保険方針</p>
      <div style={{ marginBottom:16, borderTop:"1px solid #EBEBEB" }}>
        {WORKER_DECLARATIONS.map((it, i) => (
          <div key={it.k} style={{ borderBottom: i < WORKER_DECLARATIONS.length - 1 ? "1px solid #EBEBEB" : "none" }}>
            <ToggleSwitch label={it.label} checked={selfDeclared.includes(it.k)} onChange={(v)=>setSelfDeclared(prev => v ? [...new Set([...prev, it.k])] : prev.filter(x => x !== it.k))} />
          </div>
        ))}
      </div>

      {/* その他の作業（旧「経験のある作業」＝experienced_tasksが既にある人だけ残置。空の人には構造化のみ・2026-07-23） */}
      {experiencedTasks.length > 0 && (
        <>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"4px 0 6px" }}>その他の作業</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
            {[...new Set([...TASK_OPTIONS.map(t=>t.name), ...experiencedTasks])].map(v => {
              const on = experiencedTasks.includes(v);
              return (
                <button key={v} type="button" onClick={()=>setExperiencedTasks(prev => on ? prev.filter(x=>x!==v) : [...prev, v])} className="f-sans" style={{
                  padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                  border:"1px solid " + (on ? "#00A86B" : "#EBEBEB"), background: on ? "#E6F7EF" : "#F7F7F7", color: on ? "#00A86B" : "#717171",
                }}>{v}</button>
              );
            })}
          </div>
        </>
      )}
      </>)}

      {editBox==="pr" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>自己紹介・PR</label>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 8px", lineHeight:1.6 }}>承認の判断でいちばん読まれます。</p>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
        {PR_PROMPTS.map((p, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setPrPromptIndex(i)}
            className="f-sans"
            style={{
              padding:"6px 12px", borderRadius:20,
              border:"1px solid " + (prPromptIndex===i ? "#00A86B" : "#EBEBEB"),
              background: prPromptIndex===i ? "#E6F7EF" : "#F7F7F7",
              color: prPromptIndex===i ? "#00A86B" : "#717171",
              fontSize:12, fontWeight:600, cursor:"pointer",
            }}
          >{p.q}</button>
        ))}
      </div>
      <p className="f-sans" style={{ fontSize:11, color:"#717171", marginBottom:8 }}>うまく書く必要はありません。あなたの言葉が、いちばん伝わります</p>
      <textarea
        value={pr}
        onChange={e=>setPr(e.target.value)}
        placeholder={prPromptIndex != null ? PR_PROMPTS[prPromptIndex].placeholder : "農作業の経験や、意気込みなど"}
        rows={4}
        className="field f-sans"
        style={{ width:"100%", fontSize:14, marginBottom:16, resize:"vertical" }}
      />
      </>)}

      {editBox==="qa" && (
      <div style={{ marginTop:8, marginBottom:16 }}>
        <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", marginBottom:12, paddingRight:36 }}>質問に答えて、あなたを伝える（好きな質問だけでOK）</p>
        {prQa.length > 0 && (
          <div style={{ display:"grid", gap:8, marginBottom:16 }}>
            {prQa.map(({ q, a }) => (
              <div key={q} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px", background:"#F7FBF9" }}>
                <p className="f-sans" style={{ fontSize:11, color:"#717171", marginBottom:4 }}>{q}</p>
                <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
              </div>
            ))}
          </div>
        )}
        {WORKER_QA_QUESTIONS.map(({ group, questions }) => (
          <div key={group} style={{ marginBottom:14 }}>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, marginBottom:6, letterSpacing:".04em" }}>{group}</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {questions.map(q => {
                const answered = prQa.some(x => x.q === q);
                const revFlaggedQ = revTargets.includes(q); // 修正依頼の指摘対象の質問は赤で明示（2026-07-19）
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => openQuestion(q)}
                    className="f-sans"
                    style={{
                      padding:"6px 12px", borderRadius:20,
                      border: revFlaggedQ ? "2px solid #E24B4A" : "1px solid " + (answered ? "#00A86B" : "#EBEBEB"),
                      background: revFlaggedQ ? "#FDECEC" : answered ? "#E6F7EF" : "#F7F7F7",
                      color: revFlaggedQ ? "#E24B4A" : answered ? "#00A86B" : "#717171",
                      fontSize:12, fontWeight:600, cursor:"pointer",
                    }}
                  >{revFlaggedQ ? "⚠️ " : answered ? "✓ " : ""}{q}</button>
                );
              })}
            </div>
          </div>
        ))}
        {activeQ && (
          <div style={{ border:"1px solid #00A86B", borderRadius:12, padding:14, marginTop:4 }}>
            <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", marginBottom:8 }}>{activeQ}</p>
            <textarea
              value={qaDraft}
              onChange={e=>setQaDraft(e.target.value)}
              rows={3}
              autoFocus
              placeholder={WORKER_QA_PLACEHOLDERS[activeQ] || ""}
              className="field f-sans"
              style={{ width:"100%", fontSize:14, marginBottom:10, resize:"vertical" }}
            />
            <div style={{ display:"flex", gap:8 }}>
              <button
                onClick={saveQaAnswer}
                disabled={!qaDraft.trim()}
                className="f-sans"
                style={{ flex:1, padding:"10px", background: qaDraft.trim() ? "#00A86B" : "#EBEBEB", color: qaDraft.trim() ? "#fff" : "#717171", border:"none", borderRadius:10, fontSize:13, fontWeight:600, cursor:"pointer" }}
              >保存</button>
              {prQa.some(x => x.q === activeQ) && (
                <button onClick={() => deleteQaAnswer(activeQ)} className="f-sans" style={{ padding:"10px 16px", background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A44", borderRadius:10, fontSize:13, fontWeight:600, cursor:"pointer" }}>削除</button>
              )}
              <button onClick={() => { setActiveQ(null); setQaDraft(""); }} className="f-sans" style={{ padding:"10px 16px", background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, fontSize:13, fontWeight:600, cursor:"pointer" }}>閉じる</button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* モーダルフッター：保存する（全項目upsert）＋自由記述の注記 */}
      <button onClick={()=>save(true)} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, marginTop:4 }}>{saving ? "保存中..." : "保存する"}</button>
      {(editBox === "pr" || editBox === "qa") && (
        <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", marginTop:10 }}>自由記述は運営の確認後に公開されます（最大2日）</p>
      )}
      </div>
      </div>
      )}

      {/* ═══ プレビューモーダル（保存済みの内容を表示） ═══ */}
      {showPreview && (
        <div onClick={()=>setShowPreview(false)} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none" }}>
          {/* 求人プレビューと同型のボックス：ポップアップ0.8秒・下限=下部フッター+10px（2026-07-16） */}
          {/* touchAction/overscrollBehavior: iOSでスクロールが背面ページに奪われるのを防ぐ（2026-07-14） */}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, padding:"20px", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}>
            <button onClick={()=>setShowPreview(false)} style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer", zIndex:1 }}>✕</button>
            <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"0 0 8px" }}>プレビュー（保存済みの内容）・項目をタップで編集できます</p>
            <WorkerProfilePreview me={me} onEdit={()=>setShowPreview(false)}
              onEditItem={(key)=>{ setShowPreview(false); setEditFromPreview(true); setEditBox(key); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function WorkerProfilePreview({ me, onEdit, onEditItem }) {
  const [profile, setProfile] = useState(null);
  const [trust, setTrust] = useState(null);
  const [wantAgainCount, setWantAgainCount] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("worker_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (data) setProfile(data);
        const { data: ah } = await supabase.from("account_holders").select("created_at").eq("auth_id", session.user.id).maybeSingle();
        setTrust({ joined_at: session.user.created_at, verified_at: ah?.created_at || null });
        const { data: wac } = await supabase.rpc('worker_want_again_count', { p_worker_id: session.user.id });
        if (wac && wac.ok) setWantAgainCount(wac.want_again_count);
      } catch {}
      setLoading(false);
    })();
  }, []);
  if (loading) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>;
  const prQa = Array.isArray(profile?.pr_qa) ? profile.pr_qa : [];
  const pendingPrQa = Array.isArray(profile?.pr_qa_pending) ? profile.pr_qa_pending : [];
  const hasPending = !!(profile?.pr_pending || pendingPrQa.length > 0);
  const isEmpty = !profile || (!profile.nickname && !profile.pr && !profile.avatar_url && prQa.length === 0);
  return (
    <div>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>応募したとき、農家にこのように表示されます。</p>
      {isEmpty ? (
        <div style={{ textAlign:"center", padding:"40px 20px", border:"1px solid #EBEBEB", borderRadius:16 }} className="f-sans">
          <div style={{ fontSize:32, marginBottom:14 }}>🧑‍🌾</div>
          <p style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 8px" }}>プロフィールを完成させましょう</p>
          <p style={{ fontSize:13, color:"#717171", margin:"0 0 20px", lineHeight:1.7 }}>自己紹介があると、農家に安心して承認してもらえます。</p>
          <button onClick={onEdit} className="btn-primary f-sans" style={{ padding:"12px 28px", fontSize:14, fontWeight:700, borderRadius:12 }}>はじめる</button>
        </div>
      ) : (
        <div style={{ border:"1px solid #EBEBEB", borderRadius:16, padding:"20px" }}>
          <WorkerTrustCard profile={profile} trust={trust} onEditItem={onEditItem} />
          {prQa.length > 0 && (
            <div style={{ display:"grid", gap:10, marginTop:16 }} onClick={onEditItem ? ()=>onEditItem("qa") : undefined} role={onEditItem ? "button" : undefined}>
              {prQa.map(({ q, a }) => (
                <div key={q} style={onEditItem ? { cursor:"pointer" } : undefined}>
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* 確認待ち（自由記述は運営確認後に公開。書いたものが消えて見える事故の防止） */}
      {!isEmpty && hasPending && (
        <div style={{ border:"1px solid #F5D98B", background:"#FFF8E7", borderRadius:16, padding:"20px", marginTop:16 }}>
          <span className="f-sans" style={{ display:"inline-block", fontSize:11, fontWeight:700, color:"#8A6D1D", background:"#fff", padding:"3px 10px", borderRadius:20, marginBottom:12 }}>確認待ち</span>
          {profile.pr_pending && (
            <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.8, margin:"0 0 12px", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{profile.pr_pending}</p>
          )}
          {pendingPrQa.length > 0 && (
            <div style={{ display:"grid", gap:10 }}>
              {pendingPrQa.map(({ q, a }) => (
                <div key={q}>
                  <p className="f-sans" style={{ fontSize:11, color:"#8A6D1D", margin:"0 0 2px" }}>{q}</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                </div>
              ))}
            </div>
          )}
          <p className="f-sans" style={{ fontSize:11, color:"#8A6D1D", margin:"12px 0 0" }}>運営の確認後、農家に表示される内容として公開されます（最大2日）</p>
        </div>
      )}
      {/* 実績・評価（Part3・席の確保） */}
      {!isEmpty && (
        <div style={{ border:"1px solid #EBEBEB", borderRadius:16, padding:"20px", marginTop:16 }}>
          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:10, letterSpacing:".06em" }}>実績・評価</p>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>
            まだ勤務実績はありません。初回勤務後から、労働時間・作業・出勤状況が記録されます。
          </p>
          {wantAgainCount > 0 && (
            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#00A86B", margin:"10px 0 0" }}>🌟また呼びたい ×{wantAgainCount}</p>
          )}
        </div>
      )}
    </div>
  );
}

function WorkerApplications({ filter, me }) {
  const [allApps, setAllApps] = useState([]);
  const [jobDates, setJobDates] = useState({}); // { [job_number]: {date_start, date_end} }
  const [loading, setLoading] = useState(true);
  const [punchingId, setPunchingId] = useState(null);
  const [respByFarmer, setRespByFarmer] = useState({}); // { [farmer_id]: avg_response_hours }（第9弾・返答傾向）
  const [pastOpen, setPastOpen] = useState(false); // 過去の応募（見送り・失効）の折りたたみ（第9弾）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data, error } = await supabase.from("applications").select("*").eq("worker_id", session.user.id).order("created_at",{ascending:false});
        if (!error && data) {
          setAllApps(data);
          const jobNumbers = [...new Set(data.map(a => a.job_number).filter(Boolean))];
          if (jobNumbers.length > 0) {
            const { data: jobRows } = await supabase.from("jobs_public").select("job_number,date_start,date_end,crop,task,photos,work_time,pay_type,hourly_wage,daily_wage,city,town").in("job_number", jobNumbers);
            const map = {};
            (jobRows || []).forEach(j => { map[j.job_number] = j; });
            setJobDates(map);
          }
          // 農家の返答傾向（第9弾・2026-07-22）：返事待ち(applied)の各求人の農家について、信頼カードの返答速度を転用。
          // employer_trust_info(avg_response_hours) を farmer_id ごとに引き、当日中/1日以内/2日以内のバケットで表示する
          try {
            const waitFarmerIds = [...new Set(data.filter(a => a.status === "applied").map(a => a.farmer_id).filter(Boolean))];
            if (waitFarmerIds.length > 0) {
              const entries = await Promise.all(waitFarmerIds.map(async fid => {
                try { const { data: t } = await supabase.rpc("employer_trust_info", { p_farmer_id: fid }); return [fid, (t && t.ok) ? t.avg_response_hours : null]; }
                catch { return [fid, null]; }
              }));
              setRespByFarmer(Object.fromEntries(entries));
            }
          } catch {}
          // 緊急連絡ディープリンク着地：該当応募にバインドしてモーダル自動展開（#/emergency/{id}→resolveEmergencyLink経由）
          try {
            const pend = sessionStorage.getItem("cb_emergencyAppId");
            if (pend) {
              sessionStorage.removeItem("cb_emergencyAppId");
              const target = data.find(x => x.id === pend);
              if (target && CHAT_ELIGIBLE_STATUSES.includes(target.status)) openEmergencyModal(target);
            }
          } catch {}
        }
      } catch {}
      setLoading(false);
    })();
  }, []);
  const punchStart = async (a) => {
    if (punchingId) return;
    setPunchingId(a.id);
    try {
      const { data, error } = await supabase.rpc('punch_start', { p_application_id: a.id });
      if (!error && data && data.ok) {
        setAllApps(prev => prev.map(x => x.id===a.id ? { ...x, started_at: data.started_at, status: data.already ? x.status : 'working' } : x));
      } else if (data && !data.ok) {
        alert('開始できませんでした：' + (data.reason || '不明'));
      }
    } catch { alert('開始の記録に失敗しました。'); }
    setPunchingId(null);
  };

  // 終了確認・評価（Part2）
  const [reviewModalApp, setReviewModalApp] = useState(null);
  const [reviewWantAgain, setReviewWantAgain] = useState(null);
  const [reviewAsDescribed, setReviewAsDescribed] = useState(null);
  const [reviewSafetyCare, setReviewSafetyCare] = useState(null);
  const [reviewPublicComment, setReviewPublicComment] = useState("");
  const [reviewPrivateMemo, setReviewPrivateMemo] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const openReviewModal = (a) => {
    setReviewModalApp(a);
    setReviewWantAgain(null); setReviewAsDescribed(null); setReviewSafetyCare(null);
    setReviewPublicComment(""); setReviewPrivateMemo("");
  };
  const submitWorkerReview = async () => {
    if (!reviewModalApp || reviewWantAgain===null || reviewAsDescribed===null || reviewSafetyCare===null || reviewSubmitting) return;
    setReviewSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('confirm_end', { p_application_id: reviewModalApp.id });
      if (error || !data?.ok) { alert('確認に失敗しました：' + (data?.reason || error?.message || '不明')); setReviewSubmitting(false); return; }
      const { error: revErr } = await supabase.from('reviews').insert({
        application_id: reviewModalApp.id, reviewer_id: me.id, reviewee_id: reviewModalApp.farmer_id,
        direction: 'worker_to_farmer', want_again: reviewWantAgain, as_described: reviewAsDescribed, safety_care: reviewSafetyCare,
        public_comment: reviewPublicComment.trim() || null, private_memo: reviewPrivateMemo.trim() || null,
      });
      if (revErr) { alert('評価の保存に失敗しました：' + revErr.message); setReviewSubmitting(false); return; }
      setAllApps(prev => prev.map(x => x.id===reviewModalApp.id ? { ...x, worker_confirmed_end_at: new Date().toISOString() } : x));
      setReviewModalApp(null);
    } catch { alert('処理に失敗しました。'); }
    setReviewSubmitting(false);
  };

  // 欠勤記録への異議申立（Part2・attended=falseの代替導線）
  const [disputeModalApp, setDisputeModalApp] = useState(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const submitDispute = async () => {
    if (!disputeModalApp || !disputeReason.trim() || disputeSubmitting) return;
    setDisputeSubmitting(true);
    try {
      const { error } = await supabase.from('attendance_events').insert({
        application_id: disputeModalApp.id, actor_id: me.id, kind: 'dispute_no_show', reason: disputeReason.trim(),
      });
      if (error) { alert('送信に失敗しました：' + error.message); setDisputeSubmitting(false); return; }
      setAllApps(prev => prev.map(x => x.id===disputeModalApp.id ? { ...x, _disputed: true } : x));
      setDisputeModalApp(null); setDisputeReason("");
    } catch { alert('送信に失敗しました。'); }
    setDisputeSubmitting(false);
  };

  // 緊急連絡（Part3・働き手側）
  const [emergencyModalApp, setEmergencyModalApp] = useState(null);
  const [emergencyKind, setEmergencyKind] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [emergencySubmitting, setEmergencySubmitting] = useState(false);
  const [emergencySent, setEmergencySent] = useState(false);
  const [emergencySentAt, setEmergencySentAt] = useState("");
  const [emergencyCtx, setEmergencyCtx] = useState(null); // 状況カード {jobNumber,jobLabel,dateLabel,partnerName}
  const openEmergencyModal = (a) => {
    setEmergencyModalApp(a); setEmergencyKind(""); setEmergencyReason(""); setEmergencySent(false);
    // 「何についての連絡か」を開いた瞬間に見せる（焦っている人に思い出させない）。詳細は非同期で追記
    setEmergencyCtx({ jobNumber: a.job_number, jobLabel: "", dateLabel: "", partnerName: "" });
    (async () => {
      try {
        const [jobRes, epRes] = await Promise.all([
          supabase.from("jobs_public").select("crop,task,date_start,work_time").eq("job_number", a.job_number).maybeSingle(),
          supabase.rpc("job_employer_profile", { p_job_number: a.job_number }),
        ]);
        const job = jobRes.data;
        const ep = epRes.data && epRes.data[0];
        setEmergencyCtx(prev => prev && prev.jobNumber === a.job_number ? {
          ...prev,
          jobLabel: job ? [job.crop, job.task].filter(Boolean).join(" ") : "",
          dateLabel: job && job.date_start ? calFmtDate(job.date_start) + (job.work_time ? " " + job.work_time.split("〜")[0] + "〜" : "") : "",
          partnerName: ep?.nickname || "",
        } : prev);
      } catch {}
    })();
  };
  const submitEmergency = async () => {
    if (!emergencyModalApp || !emergencyKind || !emergencyReason.trim() || emergencySubmitting) return;
    setEmergencySubmitting(true);
    try {
      const { error } = await supabase.from('attendance_events').insert({
        application_id: emergencyModalApp.id, actor_id: me.id, kind: emergencyKind, reason: emergencyReason.trim(),
      });
      if (error) { alert('送信に失敗しました：' + error.message); setEmergencySubmitting(false); return; }
      const sentAt = new Date().toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" });
      setEmergencySentAt(sentAt);
      setAllApps(prev => prev.map(x => x.id === emergencyModalApp.id ? { ...x, _emergencySentAt: sentAt } : x));
      setEmergencySent(true);
    } catch { alert('送信に失敗しました。'); }
    setEmergencySubmitting(false);
  };

  // 応募の取消（承認前のみ・本人）
  const [cancelingId, setCancelingId] = useState(null);
  const cancelApplication = async (a) => {
    if (cancelingId) return;
    if (!window.confirm("この応募を取り消しますか？農家にお知らせが届きます")) return;
    setCancelingId(a.id);
    try {
      const { data, error } = await supabase.rpc('cancel_application', { p_application_id: a.id });
      if (!error && data && data.ok) setAllApps(prev => prev.filter(x => x.id !== a.id));
      else alert('取り消しに失敗しました：' + (data?.reason || error?.message || '不明'));
    } catch { alert('取り消しに失敗しました。'); }
    setCancelingId(null);
  };

  // filter: "applying"=応募中(applied), "approved"=承認済み(approved以降), 見送り(rejected)はどちらにも出さない(通知で知らせる)
  const apps = allApps.filter(a => {
    if (filter === "applying") return a.status === "applied";
    if (filter === "approved") return ["approved","meeting","interview","contracted","working","completed"].includes(a.status);
    return a.status !== "rejected";
  });
  const label = (s) => s==="applied" ? "応募中" : s==="approved" ? "承認されました" : s==="rejected" ? "見送り" : s==="meeting" ? "打ち合わせ" : s==="interview" ? "面接" : s==="contracted" ? "契約" : s==="working" ? "作業中" : s==="completed" ? "完了" : s;
  const color = (s) => s==="approved"||s==="contracted"||s==="working" ? {bg:"#E6F7EE",fg:"#00A86B"} : s==="rejected" ? {bg:"#F3F3F3",fg:"#999"} : {bg:"#FFF4E0",fg:"#C77700"};
  // 承認済みタブのグリッド用（農家の作成中ページと同設計・2026-07-16）
  const [sheetAppId, setSheetAppId] = useState(null); // タップした応募のボトムシート
  // 帯は「働き手側の実態」を出す：農家が完了記録済みでも、こちらの終了確認・評価が残っていれば「評価待ち」
  const ribbonLabel = (a) => {
    if (a.status === "completed") {
      if (a.attended === false) return "欠勤記録";
      if (!a.worker_confirmed_end_at) return "評価待ち";
      return "完了";
    }
    return a.status === "approved" ? "承認済み" : label(a.status);
  };
  const ribbonColor = (a) => {
    if (a.status === "completed") return (a.attended === false || a.worker_confirmed_end_at) ? "#9E9E9E" : "#E24B4A";
    return a.status === "working" ? "#C77700" : "#00A86B";
  };
  // 未完了＝働き手側の手続きが残っている応募（完了して評価済み/欠勤記録済みになるまで）
  const isAppDone = (a) => a.status === "completed" && (a.attended === false || !!a.worker_confirmed_end_at);
  // 応募カード本体（返事待ちタブのリスト表示と、きょうの仕事タブのボトムシートで共用）
  const renderAppCard = (a) => {
    const c = color(a.status);
    return (
      <div key={a.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
                <div style={{ display:"inline-block", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, marginBottom:8, background:c.bg, color:c.fg }}>{label(a.status)}</div>
                <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 4px" }}>{[jobDates[a.job_number]?.crop, jobDates[a.job_number]?.task].filter(Boolean).join(" ") || "求人"} <span style={{ color:"#999", fontWeight:700, fontSize:12 }}>#{a.job_number}</span></p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:8 }}>応募日 {new Date(a.created_at).toLocaleDateString("ja-JP")}</p>
                <AvailDatesChips value={a.available_dates} />
                <AgreedDatesRow value={a.agreed_dates} />
                {/* お仕事の流れ（応募→承認→打合せ・面接→採用→仕事→完了報告→評価）を可視化（2026-07-19／07-22） */}
                {a.status !== "applied" && <div style={{ marginBottom:14 }}><FlowBar a={a} /></div>}
                {/* 開始打刻（①・承認済み以降・作業日当日のみ） */}
                {CHAT_ELIGIBLE_STATUSES.includes(a.status) && isWorkDayToday(jobDates[a.job_number]?.date_start, jobDates[a.job_number]?.date_end) && (
                  a.started_at ? (
                    <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#00A86B", margin:"0 0 8px", textAlign:"center" }}>
                      開始済み（{new Date(a.started_at).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})}）
                    </p>
                  ) : (
                    <button onClick={()=>punchStart(a)} disabled={punchingId===a.id} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", marginBottom:8 }}>
                      {punchingId===a.id ? "..." : "▶ 作業を開始する"}
                    </button>
                  )
                )}
                {/* 終了確認・評価（Part2・completed後） */}
                {a.status === "completed" && (
                  a.attended === false ? (
                    a._disputed ? (
                      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#717171", margin:"0 0 8px", textAlign:"center" }}>異議申立を送信しました</p>
                    ) : (
                      <button onClick={()=>{ setDisputeModalApp(a); setDisputeReason(""); }} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer", marginBottom:8 }}>異議申立</button>
                    )
                  ) : a.worker_confirmed_end_at ? (
                    <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#00A86B", margin:"0 0 8px", textAlign:"center" }}>✓ 完了・評価済み</p>
                  ) : (
                    <button onClick={()=>openReviewModal(a)} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", marginBottom:8 }}>✓ 終了を確認して評価する</button>
                  )
                )}
                {/* 緊急連絡（Part3） */}
                {CHAT_ELIGIBLE_STATUSES.includes(a.status) && (
                  <button onClick={()=>openEmergencyModal(a)} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#fff", color:"#C77700", border:"1px solid #FFB020", borderRadius:10, cursor:"pointer", marginBottom:8 }}>⚠️ 緊急連絡</button>
                )}
                {a._emergencySentAt && (
                  <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#C77700", margin:"0 0 8px", textAlign:"center" }}>⚠️ 連絡済み（{a._emergencySentAt}）</p>
                )}
                {/* 2026-07-13 労働局確認済み・当事者間の直接連絡は適法（CLAUDE.md参照） */}
                {(a.status==="approved"||a.status==="meeting"||a.status==="interview"||a.status==="contracted"||a.status==="working") && (
                  <button onClick={()=>{ window.location.hash="/chat/"+a.id; }} className="f-sans" style={{ width:"100%", padding:"10px", fontSize:13, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>チャットを開く</button>
                )}
                {/* 応募の取消（承認前のみ・テキストリンクで控えめに） */}
                {a.status === "applied" && (
                  <button onClick={()=>cancelApplication(a)} disabled={cancelingId===a.id} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:8, background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#717171", textDecoration:"underline" }}>
                    {cancelingId===a.id ? "取り消し中..." : "応募を取り消す"}
                  </button>
                )}
      </div>
    );
  };
  // ── 返事待ちページの役割強化（第9弾・2026-07-22）───────────────────────────
  // 過去の応募（見送り・失効）：applyingタブの下に折りたたみで分離。現状statusは rejected（見送り）
  const pastApps = allApps.filter(a => ["rejected", "expired", "canceled"].includes(a.status));
  // 作業日の前日（date_start-1）を "YYYY-MM-DD" で返す
  const dayBefore = (ymd) => {
    if (!ymd) return null;
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - 1);
    const p = n => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  };
  // 返答速度（時間）→ おおむねバケット。データ不足(null)・48h超は非表示
  const respBucket = (hours) => hours == null ? null : hours <= 12 ? "当日中" : hours <= 24 ? "1日以内" : hours <= 48 ? "2日以内" : null;
  // 返事待ちカード（応募中＝applied専用の再設計・上図の構成）
  const WAIT_STEPS = ["応募", "農家が確認中", "結果"];
  const renderWaitingCard = (a) => {
    const job = jobDates[a.job_number] || {};
    const title = [job.crop, job.task].filter(Boolean).join(" ") || "求人";
    const town = [job.city, job.town].filter(Boolean).join("");
    const wage = job.pay_type === "日給"
      ? (Number(job.daily_wage) ? `日給${Number(job.daily_wage).toLocaleString()}円` : "")
      : (Number(job.hourly_wage) ? `時給${Number(job.hourly_wage).toLocaleString()}円` : "");
    const summary = [job.date_start ? calFmtDate(job.date_start) : "", job.work_time || "", wage, town].filter(Boolean).join("　");
    // ⏰約束の分岐（2026-07-22）：終了/開始超過→終了文／期限日(前日)が過去→失効予告／通常→前日までに。過去日付は絶対に出さない
    const startYmd = job.date_start || null;
    const startMoment = (() => {
      if (!startYmd) return null;
      const [Y, M, D] = startYmd.split("-").map(Number);
      const tm = job.work_time && String(job.work_time).match(/(\d{1,2}):(\d{2})/); // "H:MM〜..." の先頭＝開始時刻。無ければ日末扱い
      return new Date(Y, M - 1, D, tm ? parseInt(tm[1], 10) : 23, tm ? parseInt(tm[2], 10) : 59);
    })();
    // 求人がjobs_public(open)に無い＝閉鎖/充足、または開始時刻を過ぎた＝終了
    const jobEnded = !startYmd || (!!startMoment && Date.now() > startMoment.getTime());
    const deadlineYmd = startYmd ? dayBefore(startYmd) : null;
    const deadlinePast = deadlineYmd ? (deadlineYmd < ymdLocal(new Date())) : false;
    const deadline = deadlineYmd ? calFmtDate(deadlineYmd) : null;
    const bucket = respBucket(respByFarmer[a.farmer_id]);
    const activeIdx = 1; // 現在＝2段目（農家が確認中）
    return (
      <div key={a.id} style={{ border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px", background:"#fff" }}>
        {/* 求人要約行（日付・時間帯・時給・町名。タップで求人詳細へ） */}
        <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", window.location.hash.replace(/^#/, "")); } catch {} window.location.hash = "/work/job/" + a.job_number; }}
          className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"none", border:"none", padding:0, cursor:"pointer" }}>
          <p style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 4px" }}>{title} <span style={{ color:"#999", fontWeight:700, fontSize:12 }}>#{a.job_number}</span></p>
          <p style={{ fontSize:12, color:"#717171", margin:0, lineHeight:1.6 }}>{summary || `応募日 ${new Date(a.created_at).toLocaleDateString("ja-JP")}`}</p>
        </button>
        {/* 3段プログレス（応募→農家が確認中→結果・現在=2段目） */}
        <div style={{ display:"flex", alignItems:"flex-start", margin:"14px 0 12px" }}>
          {WAIT_STEPS.map((s, i) => {
            const isDone = i < activeIdx; const isActive = i === activeIdx; const reached = isDone || isActive;
            return (
              <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
                {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? "#00A86B" : "#E5E5E5" }} />}
                <div style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, boxSizing:"border-box",
                  background: isDone ? "#00A86B" : "#fff", border: isDone ? "none" : isActive ? "2px solid #00A86B" : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? "#00A86B" : "#C8C8C8" }}>
                  {isDone ? "✓" : ""}
                </div>
                <span className="f-sans" style={{ fontSize:9, marginTop:4, lineHeight:1.2, textAlign:"center", color: reached ? "#00A86B" : "#B0B0B0", fontWeight: isActive ? 700 : 500 }}>{s}</span>
              </div>
            );
          })}
        </div>
        {/* 期限の約束（2026-07-22 分岐）：終了→終了文／期限日が過去→失効予告／通常→前日までに（過去日付は出さない） */}
        {jobEnded ? (
          <div style={{ background:"#F3F3F3", border:"1px solid #E0E0E0", borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#717171", margin:0, lineHeight:1.7 }}>この求人は終了しました。応募はまもなく自動で失効し、お知らせが届きます</p>
          </div>
        ) : deadlinePast ? (
          <div style={{ background:"#FFF8E7", border:"1px solid #F5D98F", borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#8A6D1D", margin:0, lineHeight:1.7 }}>⏰ 開始時刻までに返事がない場合は、自動で失効のお知らせが届きます</p>
          </div>
        ) : deadline ? (
          <div style={{ background:"#FFF8E7", border:"1px solid #F5D98F", borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#8A6D1D", margin:0, lineHeight:1.7 }}>⏰ 遅くとも <b>{deadline}</b> までに必ず結果が届きます</p>
            <p className="f-sans" style={{ fontSize:11, color:"#B08A2E", margin:"2px 0 0", lineHeight:1.6 }}>（返事がない場合も自動でお知らせします）</p>
          </div>
        ) : null}
        {/* 農家の返答傾向（信頼カードの返答速度を転用・データ不足時は非表示） */}
        {bucket && (
          <p className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#0B6B4F", margin:"0 0 2px" }}>💬 この農家さんの返答：これまで おおむね{bucket}</p>
        )}
        {/* 応募を取り消す（小さくグレーで最下部へ降格） */}
        <button onClick={()=>cancelApplication(a)} disabled={cancelingId===a.id} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:10, background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#B0B0B0", textDecoration:"underline" }}>
          {cancelingId===a.id ? "取り消し中..." : "応募を取り消す"}
        </button>
      </div>
    );
  };
  // 待っている間にできること（カード群の下）
  const waitingTodoBox = (
    <div style={{ background:"#F7FBF9", border:"1px solid #DDEDE5", borderRadius:14, padding:"14px 16px", marginTop:16 }}>
      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#0B6B4F", margin:"0 0 10px" }}>📎 待っている間にできること</p>
      <button onClick={()=>{ window.location.hash = "/profile/worker/profile"; }} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #DDEDE5", borderRadius:10, padding:"12px 14px", fontSize:13, fontWeight:700, color:"#00A86B", cursor:"pointer", marginBottom:8 }}>⭐農家がよく見る質問に答える →</button>
      <button onClick={()=>{ window.location.hash = "/search"; }} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #DDEDE5", borderRadius:10, padding:"12px 14px", fontSize:13, color:"#222", cursor:"pointer", lineHeight:1.6 }}>同じ日の別の求人にも応募できます <span style={{ color:"#00A86B", fontWeight:700 }}>→さがす</span></button>
    </div>
  );
  // 過去の応募（見送り・失効）の折りたたみ
  const pastAppsBlock = pastApps.length > 0 && (
    <div style={{ marginTop:20 }}>
      <button onClick={()=>setPastOpen(v=>!v)} className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"none", border:"none", padding:"8px 0", cursor:"pointer" }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#717171" }}>過去の応募（{pastApps.length}）</span>
        <span style={{ fontSize:12, color:"#B0B0B0" }}>{pastOpen ? "閉じる ▲" : "見る ▼"}</span>
      </button>
      {pastOpen && (
        <div style={{ display:"grid", gap:8, marginTop:8 }}>
          {pastApps.map(a => {
            const job = jobDates[a.job_number] || {};
            return (
              <div key={a.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, border:"1px solid #F0F0F0", borderRadius:10, padding:"10px 12px", background:"#FAFAFA" }}>
                <span className="f-sans" style={{ fontSize:13, color:"#717171", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[job.crop, job.task].filter(Boolean).join(" ") || ("求人 #" + a.job_number)}</span>
                <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#999", background:"#F0F0F0", borderRadius:20, padding:"2px 10px", flexShrink:0 }}>{a.status === "rejected" ? "見送り" : "失効"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
  // ─────────────────────────────────────────────────────────────────────────
  // お仕事の流れ（2026-07-19／2026-07-22 完了報告を独立段に）：応募→承認→打合せ・面接→採用→仕事→完了報告→評価。各カードで現在地を可視化
  const FLOW_STEPS = ["応募", "承認", "打合せ・面接", "採用", "仕事", "完了報告", "評価"];
  const flowState = (a) => {
    const bothConfirmed = !!(a.terms_confirmed_worker_at && a.terms_confirmed_farmer_at); // 採用（双方確認）
    const started  = a.status === "working" || a.status === "completed" || !!a.started_at || !!a.farmer_confirmed_start_at; // 仕事（開始打刻）
    const reported = a.status === "completed"; // 完了報告（作業完了が記録された）
    const reviewed = !!a.worker_confirmed_end_at || (a.status === "completed" && a.attended === false); // 評価
    const done = [true, true, bothConfirmed, bothConfirmed, started, reported, reviewed];
    return { done, active: done.findIndex(d => !d) };
  };
  const FlowBar = ({ a }) => {
    const { done, active } = flowState(a);
    return (
      <div style={{ display:"flex", alignItems:"flex-start", marginTop:12 }}>
        {FLOW_STEPS.map((s, i) => {
          const isDone = done[i]; const isActive = i === active;
          const reached = isDone || isActive;
          return (
            <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative", minWidth:0 }}>
              {i > 0 && <div style={{ position:"absolute", top:8, right:"50%", width:"100%", height:2, background: reached ? "#00A86B" : "#E5E5E5" }} />}
              <div style={{ position:"relative", zIndex:1, width:18, height:18, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, boxSizing:"border-box",
                background: isDone ? "#00A86B" : "#fff", border: isDone ? "none" : isActive ? "2px solid #00A86B" : "2px solid #E5E5E5", color: isDone ? "#fff" : isActive ? "#00A86B" : "#C8C8C8" }}>
                {isDone ? "✓" : ""}
              </div>
              <span className="f-sans" style={{ fontSize:9, marginTop:4, lineHeight:1.2, textAlign:"center", color: reached ? "#00A86B" : "#B0B0B0", fontWeight: isActive ? 700 : 500 }}>{s}</span>
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <div style={{ marginTop:32, paddingTop:32, borderTop:"1px solid #EEE" }}>
      {/* きょうの仕事タブはタイトルをフローバナーに差し替え（2026-07-19）。返事待ちタブは従来のタイトル */}
      {filter !== "approved" && (<>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", letterSpacing:".08em", marginBottom:4 }}>応募状況</p>
        <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>あなたが応募した求人の状況です。</p>
      </>)}
      {/* お仕事の流れバナー（2026-07-19・きょうの仕事タブのみ）＝タイトルの代わり */}
      {filter === "approved" && apps.length > 0 && (
        <div style={{ background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#0B6B4F", margin:"0 0 4px" }}>お仕事は、この流れで進みます</p>
          <p className="f-sans" style={{ fontSize:12, color:"#5B7B6D", margin:"0 0 12px", lineHeight:1.6 }}>いまどこまで進んでいるかは、各求人カードでわかります。</p>
          <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"4px 2px" }}>
            {FLOW_STEPS.map((s, i) => (
              <Fragment key={s}>
                {i > 0 && <span style={{ color:"#9BC4B3", fontSize:12, fontWeight:700 }}>→</span>}
                <span className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#0B6B4F", background:"#fff", border:"1px solid #CDE9DD", borderRadius:20, padding:"4px 10px" }}>{s}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {loading ? (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"20px 0" }}>読み込み中...</p>
      ) : filter !== "approved" ? (
        // 返事待ちタブ（第9弾）：応募中カード（再設計）＋待っている間にできること＋過去の応募
        (apps.length === 0 && pastApps.length === 0) ? (
          <div style={{ textAlign:"center", padding:"32px 20px", color:"#999" }} className="f-sans">
            <div style={{ fontSize:36, marginBottom:10 }}>🌱</div>
            <p style={{ fontSize:14, margin:0, lineHeight:1.7 }}>いまは待つだけ。作業日の前日までに必ず結果が届きます</p>
            <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>「さがす」から求人に応募できます。</p>
          </div>
        ) : (
          <>
            {apps.length > 0 && <div style={{ display:"grid", gap:12 }}>{apps.map(a => renderWaitingCard(a))}</div>}
            {waitingTodoBox}
            {pastAppsBlock}
          </>
        )
      ) : apps.length === 0 ? (
        <div style={{ textAlign:"center", padding:"32px 20px", color:"#999" }} className="f-sans">
          <div style={{ fontSize:36, marginBottom:10 }}>🌱</div>
          <p style={{ fontSize:14, margin:0, lineHeight:1.7 }}>仕事が決まると、ここに当日やることが出ます</p>
          <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>農家が承認すると、ここに表示されます。</p>
        </div>
      ) : (
        // フロー可視化のため1列リスト（2026-07-19）：写真＋タイトル＋状態＋進捗ステッパー。タップでボトムシート
        <div style={{ display:"grid", gap:12 }}>
          {apps.map(a => {
            const job = jobDates[a.job_number] || {};
            const photo = job.photos && job.photos[0] ? (typeof job.photos[0] === "string" ? job.photos[0] : job.photos[0]?.url) : null;
            return (
              <button key={a.id} onClick={()=>setSheetAppId(a.id)}
                className={"f-sans" + (isAppDone(a) ? "" : " cb-urgent-card")}
                style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"12px 14px 14px", cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:52, height:52, borderRadius:10, background:"#F7F7F7", flexShrink:0, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>
                    {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌾"}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[job.crop, job.task].filter(Boolean).join(" ") || ("求人 #" + a.job_number)}</p>
                    <span className="f-sans" style={{ display:"inline-block", marginTop:4, fontSize:11, fontWeight:700, padding:"2px 10px", borderRadius:20, background: ribbonColor(a) === "#00A86B" ? "#E6F7EF" : ribbonColor(a) === "#C77700" ? "#FFF4E0" : "#F3F3F3", color: ribbonColor(a) }}>{ribbonLabel(a)}</span>
                  </div>
                </div>
                <FlowBar a={a} />
              </button>
            );
          })}
        </div>
      )}

      {/* 承認済みカードのボトムシート（タップで展開・中身は従来の応募カード＝操作ボタン込み） */}
      {filter === "approved" && (() => {
        const live = apps.find(x => x.id === sheetAppId);
        if (!live) return null;
        return (
          <div onClick={()=>setSheetAppId(null)} style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                <button onClick={()=>setSheetAppId(null)} aria-label="戻る" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px" }}>
                {renderAppCard(live)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 終了確認・評価モーダル（Part2） */}
      {reviewModalApp && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
            <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:16 }}>終了の確認・評価</p>
            <YesNoPill label="また働きたい" value={reviewWantAgain} onChange={setReviewWantAgain} />
            <YesNoPill label="説明のとおりだった" value={reviewAsDescribed} onChange={setReviewAsDescribed} />
            <YesNoPill label="安全に配慮されていた" value={reviewSafetyCare} onChange={setReviewSafetyCare} />
            <textarea value={reviewPublicComment} onChange={e=>setReviewPublicComment(e.target.value)} placeholder="農園について良かった点を一言（公開されます）" rows={3}
              className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:8 }} />
            <textarea value={reviewPrivateMemo} onChange={e=>setReviewPrivateMemo(e.target.value)} placeholder="自分だけが見えるメモ（任意）" rows={3}
              className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setReviewModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
              <button onClick={submitWorkerReview} disabled={reviewSubmitting || reviewWantAgain===null || reviewAsDescribed===null || reviewSafetyCare===null}
                className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{reviewSubmitting ? "送信中..." : "送信する"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 異議申立モーダル（Part2・欠勤記録への異議） */}
      {disputeModalApp && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%" }}>
            <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>欠勤記録への異議申立</p>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.6, marginBottom:12 }}>心当たりがない場合、理由を書いて送信してください。運営が確認します。</p>
            <textarea value={disputeReason} onChange={e=>setDisputeReason(e.target.value)} placeholder="異議の理由" rows={4}
              className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setDisputeModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
              <button onClick={submitDispute} disabled={disputeSubmitting || !disputeReason.trim()}
                className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{disputeSubmitting ? "送信中..." : "送信する"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 緊急連絡モーダル（Part3・働き手側） */}
      {emergencyModalApp && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%" }}>
            {emergencySent ? (
              <>
                <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0 8px", margin:0, lineHeight:1.7 }}>
                  ⚠️ {(WORKER_EMERGENCY_KINDS.find(k=>k.v===emergencyKind)?.l || "緊急")}の連絡を{emergencyCtx?.partnerName ? emergencyCtx.partnerName + "さん" : "農家さん"}に送りました（{emergencySentAt}）
                </p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"0 0 16px" }}>チャットで詳しく伝えることもできます</p>
                <button onClick={()=>{ const id = emergencyModalApp.id; setEmergencyModalApp(null); window.location.hash = "/chat/" + id; }} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer", marginBottom:8 }}>チャットを開く →</button>
                <button onClick={()=>setEmergencyModalApp(null)} className="btn-primary f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, borderRadius:10 }}>閉じる</button>
              </>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>緊急連絡</p>
                {emergencyCtx && (
                  <div className="f-sans" style={{ background:"#F7F7F7", borderRadius:10, padding:"10px 12px", marginBottom:12, lineHeight:1.7 }}>
                    <p style={{ margin:0, fontSize:13, fontWeight:700, color:"#222" }}>求人 #{emergencyCtx.jobNumber}{emergencyCtx.jobLabel ? "・" + emergencyCtx.jobLabel : ""}</p>
                    <p style={{ margin:0, fontSize:12, color:"#717171" }}>{emergencyCtx.dateLabel && "作業日 " + emergencyCtx.dateLabel}{emergencyCtx.dateLabel && emergencyCtx.partnerName && "　"}{emergencyCtx.partnerName && "相手：" + emergencyCtx.partnerName + "さん"}</p>
                  </div>
                )}
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                  {WORKER_EMERGENCY_KINDS.map(k => (
                    <button key={k.v} type="button" onClick={()=>setEmergencyKind(k.v)} className="f-sans" style={{
                      flex: k.v==="no_show_report" ? "1 1 100%" : "1 1 0", padding:"9px", borderRadius:10, fontSize:13, cursor:"pointer", fontWeight:600, border:"2px solid",
                      borderColor: emergencyKind===k.v ? "#00A86B" : "#EBEBEB",
                      background: emergencyKind===k.v ? "#E6F7EF" : "#fff", color: emergencyKind===k.v ? "#00A86B" : "#222",
                    }}>{k.l}</button>
                  ))}
                </div>
                {emergencyKind==="no_show_report" && (
                  <div className="f-sans" style={{ background:"#FFF4E0", borderRadius:10, padding:"10px 12px", marginBottom:12, fontSize:12, color:"#C77700", lineHeight:1.7 }}>
                    まずチャットか電話で連絡を試してください。15分待っても会えない時にこの連絡を送ると、相手と運営に即時に通知され、日時が記録されます。
                  </div>
                )}
                <textarea value={emergencyReason} onChange={e=>setEmergencyReason(e.target.value)} placeholder="理由・詳細" rows={4}
                  className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setEmergencyModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submitEmergency} disabled={emergencySubmitting || !emergencyKind || !emergencyReason.trim()}
                    className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{emergencySubmitting ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}




// #/calendar の入口：既定は「今日」、奥（#/calendar/month）で月カレンダー（MyCalendar）。hashで切替
function CalendarRouter({ me, defaultRole }) {
  const isMonth = () => window.location.hash.replace(/^#\/?/, "") === "calendar/month";
  const [month, setMonth] = useState(isMonth());
  useEffect(() => {
    const on = () => setMonth(isMonth());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return month ? <MyCalendar backToToday /> : <TodayPage me={me} defaultRole={defaultRole} />;
}

function ProfileHub({ me, onNewJob, onResume, onAvatarChange }) {
  const hashToPTab = () => {
    const h = window.location.hash.replace(/^#\/?/,"");
    if (h === "profile/employer" || h.startsWith("profile/employer/")) return "employer";
    if (h === "profile/worker" || h.startsWith("profile/worker/") || h === "profile") return "worker";
    return "worker";
  };
  const [pTab, setPTab] = useState(() => { try { return hashToPTab(); } catch { return "worker"; } });
  const hashToWTab = () => {
    const h = window.location.hash.replace(/^#\/?/,"");
    if (h === "profile/worker/profile") return "wprofile";
    if (h === "profile/worker/applying") return "applying";
    if (h === "profile/worker/approved") return "approved";
    if (h === "profile/worker/calendar") return "wcalendar";
    return "home"; // 入口はAirbnb型カードメニュー（2026-07-14・農家プロと同構造）
  };
  const [wTab, setWTab] = useState(() => { try { return hashToWTab(); } catch { return "home"; } });
  // 雇う/働くトグルは両面の入口(カードメニュー)だけ表示。編集・サブページでは邪魔なので非表示（2026-07-14）
  const isEmployerHome = () => window.location.hash.replace(/^#\/?/,"") === "profile/employer";
  const [eHome, setEHome] = useState(() => { try { return isEmployerHome(); } catch { return false; } });
  const [pAnim, setPAnim] = useState(""); // 両面切替の反転: pflip-out(退場0.4s)|pflip-in(入場0.4s)＝合計0.8秒。完了後は空に戻す
  // 下部バー「プロフィール」タップ＝今いる側のトップへ（2026-07-14変更）。
  // 働き手側：wTabをhomeへ（同hash時＝hashchangeが出ない場合の保険）
  useEffect(() => {
    const onWorkerHome = () => { setWTab("home"); };
    window.addEventListener("cb:workerHome", onWorkerHome);
    return () => window.removeEventListener("cb:workerHome", onWorkerHome);
  }, []);
  const [wProfileMode, setWProfileMode] = useState("preview");
  useEffect(() => {
    const onHash = () => { const p = hashToPTab(); if (p) setPTab(p); const w = hashToWTab(); if (w) setWTab(w); setEHome(isEmployerHome()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // WORKER_TABS(サイドタブ列)は廃止（2026-07-14）：入口カードメニューに一本化
  const [hasEmployerSide, setHasEmployerSide] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const { count } = await supabase.from("jobs")
          .select("job_number", { count: "exact", head: true })
          .eq("farmer_id", session.user.id);
        if (!cancelled && (count || 0) > 0) { setHasEmployerSide(true); return; }
        const { data: ep } = await supabase.from("employer_profiles")
          .select("auth_id").eq("auth_id", session.user.id).maybeSingle();
        if (!cancelled && ep) setHasEmployerSide(true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  const WORKER_TAB_TITLES = { wprofile:"働き手プロフィール", applying:"返事待ち", approved:"きょうの仕事", wcalendar:"カレンダー" };
  // 入口カードメニュー用：本人のworker_profiles(表示名/アバター)と応募件数（バッジ表示）
  const [wMini, setWMini] = useState(null);
  const [wAppCounts, setWAppCounts] = useState({ applying:0, approved:0 });
  const [wTopBack, setWTopBack] = useState(() => { try { return localStorage.getItem("cb_wTopBack") === "1"; } catch { return false; } }); // トップボックスの裏面表示。切り返した画面で固定（localStorageに永続・2026-07-16）
  const [wTopAnim, setWTopAnim] = useState("");    // 反転アニメ: pflip-out|pflip-in（0.4s×2=0.8秒）
  const [wTrust, setWTrust] = useState(null);      // 裏面用の自己スタッツ（登録日・本人確認・リピート率）。my_worker_trust_statsは本人限定RPC＝農家には返らない（法務：評価集計の公開禁止）
  const [wHub, setWHub] = useState({ today:0, searchOpen:0, reviewed:0 }); // ハブ箱用（2026-07-22）：当日の仕事・きょう応募できる求人件数・評価件数
  const [hubFlip, setHubFlip] = useState(null); // ？タップで反転して説明を出す箱のラベル（2026-07-22）
  const [showWAch, setShowWAch] = useState(false); // 🌟わたしの実績モーダル
  const [wSeenReviews, setWSeenReviews] = useState(() => { try { return parseInt(localStorage.getItem("cb_wSeenReviews") || "0", 10) || 0; } catch { return 0; } }); // 既読の評価件数（🌟は新着時のみ）
  useEffect(() => {
    if (wTab !== "home") return; // 入口に戻るたびに再取得（編集後のバッジ・スニペット鮮度を担保）
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const { data: wp } = await supabase.from("worker_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (!cancelled && wp) setWMini(wp);
        const { data: apps } = await supabase.from("applications").select("status,attended,worker_confirmed_end_at,job_number").eq("worker_id", session.user.id);
        // 承認済みバッジは未対応（手続きが残っている応募）のみ計上。完了・評価済みまで数えると
        // バッジが常時点灯し、新しい要対応があっても気づけなくなるため（2026-07-16）
        if (!cancelled && apps) setWAppCounts({
          applying: apps.filter(a => a.status === "applied").length,
          approved: apps.filter(a =>
            ["approved","meeting","interview","contracted","working","completed"].includes(a.status)
            && !(a.status === "completed" && (a.attended === false || !!a.worker_confirmed_end_at))
          ).length,
        });
        // きょうの仕事バッジ＝当日が作業日の確定した仕事（契約済み以降）の件数
        let todayCount = 0;
        try {
          const contracted = (apps || []).filter(a => ["contracted","working"].includes(a.status));
          if (contracted.length) {
            const { data: jd } = await supabase.from("jobs_public").select("job_number,date_start,date_end").in("job_number", contracted.map(a => a.job_number));
            const today = ymdLocal(new Date());
            const jm = Object.fromEntries((jd || []).map(j => [j.job_number, j]));
            todayCount = contracted.filter(a => { const j = jm[a.job_number]; if (!j) return false; const s = j.date_start, e = j.date_end || j.date_start; return s && s <= today && today <= e; }).length;
          }
        } catch {}
        // さがす箱＝きょう応募できる求人件数（jobs_public=公開中）
        let openCount = 0;
        try { const { count } = await supabase.from("jobs_public").select("job_number", { count: "exact", head: true }); openCount = count || 0; } catch {}
        const { data: ts } = await supabase.rpc("my_worker_trust_stats");
        if (!cancelled && ts?.ok) setWTrust(ts);
        if (!cancelled) setWHub({ today: todayCount, searchOpen: openCount, reviewed: ts?.reviewed_count || 0, completed: ts?.completed_count || 0, hours: ts?.total_hours || 0, wantAgain: ts?.want_again_count || 0 });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [wTab]);
  // 働き手プロフィールの未設定項目数（編集ページの10ボックスに対応。トップボックス右上のバッジ＋赤影に使用）
  // 核（アイコン・ニックネーム・自己紹介）が未設定→赤影＋浮遊アニメ／任意のみ未設定→赤影のみ（2026-07-16）
  const wUnsetReq = wMini ? [
    !!wMini.avatar_url,
    !!(wMini.nickname || "").trim(),
    !!((wMini.pr_pending ?? wMini.pr) || "").trim(),
  ].filter(x => !x).length : 3;
  const wUnsetCount = wMini ? wUnsetReq + [
    !!(wMini.residence_city || "").trim(),
    !!wMini.transport,
    !!wMini.farm_experience,
    !!wMini.physical_level,
    Array.isArray(wMini.interests) && wMini.interests.length > 0,
    Array.isArray(wMini.languages) && wMini.languages.length > 0,
    (Array.isArray(wMini.pr_qa_pending) ? wMini.pr_qa_pending.length : (Array.isArray(wMini.pr_qa) ? wMini.pr_qa.length : 0)) > 0,
  ].filter(x => !x).length : 10;
  // 自己紹介の審査状態（2026-07-19）：審査待ち=帯＋タップ不能／修正依頼中=赤帯（修正のためタップは可能）
  const wHasPending = !!(wMini && (((wMini.pr_pending || "").trim()) || (Array.isArray(wMini.pr_qa_pending) && wMini.pr_qa_pending.length > 0)));
  const wReview = wHasPending ? (wMini.pr_submitted_at ? "pending" : "revision") : null;
  return (
    <div className="profile-employer-edge" style={{maxWidth:1024,margin:"0 auto",padding:"32px 4px"}}>{/* プロフィール両面とも画面端から10pxに統一（モバイル・CSS側の負マージン併用） */}
      {/* 浮遊ボタンはトグル式：働き手側の表示中→「雇う」(雇い手空間へ)／農家プロ(雇い手空間)の表示中→「働く」(働き手側へ)。
          表示は両面の入口(カードメニュー)のみ＝編集・サブページでは非表示（2026-07-14）。
          切替はフェードアウト(0.16s)→面切替→フェードイン(0.22s)の2段階 */}
      {(pTab === "employer" ? eHome : wTab === "home") && (
        <button onClick={()=>{
          if (pAnim === "pflip-out") return; // 連打ガード
          setPAnim("pflip-out");
          setTimeout(()=>{ window.location.hash = pTab === "employer" ? "/profile/worker" : "/profile/employer"; setPAnim("pflip-in"); }, 400);
        }} className="profile-employer-fab f-sans" style={{ background: pTab === "employer" ? ROLE_ORANGE : ROLE_GREEN }}>
          {/* 切替先の役割の色名を予告表示（第11弾）：橙=働き手／緑=農家。FAB自体も切替先の色に灯す */}
          {pTab === "employer"
            ? "⇄ 働き手（橙）に切替"
            : (hasEmployerSide ? "⇄ 農家（緑）に切替" : "🌱 農家（緑）を作る")}
        </button>
      )}
      {/* 面の中身をkey={pTab}で包む：切替時に再マウント→pflip-in/fade-inが再生される */}
      <div key={pTab} className={pAnim || "fade-in"} onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && pAnim === "pflip-in") setPAnim(""); }}>
      {pTab === "worker" ? (
        wTab === "home" ? (
          <>
            {/* ═══ Airbnb型入口メニュー（働き手側・2026-07-14）：農家プロ入口と同構造。旧サイドタブ列は廃止 ═══ */}
            {/* トップボックスは反転式（2026-07-16）：表=アイコン＋ニックネーム／裏=アイコン・ニックネーム抜きのプレビュー。右上⇄で反転0.8秒 */}
            <div style={{ position:"relative" }}>
              <button onClick={()=>{ if (wReview === "pending") return; window.location.hash="/profile/worker/profile"; }}
                className={"f-sans" + (wTopAnim ? " " + wTopAnim : (wReview ? "" : wUnsetReq > 0 ? " cb-urgent-card" : wUnsetCount > 0 ? " cb-urgent-still" : ""))}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && wTopAnim === "pflip-in") setWTopAnim(""); }}
                style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid " + ROLE_ORANGE, borderRadius:24, padding: wReview ? "28px 20px 44px" : "28px 20px", cursor: wReview === "pending" ? "default" : "pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box" }}>
                {/* 審査帯（2026-07-19）：審査待ち=オレンジ帯＋タップ不能／修正依頼中=赤帯（タップで修正へ） */}
                {wReview && (
                  <span className="f-sans" style={{ position:"absolute", left:0, right:0, bottom:0, zIndex:2, padding:"8px 12px", borderRadius:"0 0 24px 24px", background: wReview === "revision" ? "#E24B4A" : "#C77700", color:"#fff", fontSize:13, fontWeight:700, textAlign:"center", boxSizing:"border-box" }}>
                    {wReview === "revision" ? "⚠️ 修正のお願いがあります（タップして修正）" : "⏳ 審査待ち：運営が確認しています"}
                  </span>
                )}
                {!wTopBack ? (
                  <>
                    {/* 未設定の項目数（編集ページの10ボックス基準）。全て設定済みなら非表示。右上は⇄マークなので左隣に */}
                    {wUnsetCount > 0 && (
                      <span style={{ position:"absolute", top:12, right:52, minWidth:22, height:22, borderRadius:11, background:"#F5A623", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{wUnsetCount}</span>
                    )}
                    <Avatar url={wMini?.avatar_url} name={wMini?.nickname || me?.name} size={84} ring={ROLE_ORANGE} />
                    <span>
                      <span className="f-sans" style={{ display:"block", fontSize:22, fontWeight:800, color:"#222" }}>{wMini?.nickname || me?.name || "名前未設定"}</span>
                      {/* 役割チップ（第11弾）：名前直下・大きめ・橙 */}
                      <span className="f-sans" style={{ display:"inline-block", marginTop:6, fontSize:13, fontWeight:800, color:"#fff", background:ROLE_ORANGE, borderRadius:20, padding:"3px 14px" }}>働き手</span>
                    </span>
                  </>
                ) : (
                  <div className="f-sans" style={{ width:"100%", textAlign:"left" }}>
                    {/* 信頼スタッツ（登録日・本人確認・リピート率）。本人限定RPC由来＝自分にだけ見える（2026-07-16） */}
                    {wTrust && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 12px", marginBottom:10, paddingBottom:10, borderBottom:"1px solid #F5F5F5" }}>
                        {wTrust.joined_at && (
                          <span style={{ fontSize:11, color:"#717171" }}>📅 登録 {yearMonthLabel(wTrust.joined_at)}</span>
                        )}
                        {wTrust.verified_at
                          ? <span style={{ fontSize:11, color:"#00A86B", fontWeight:600 }}>✓ 本人確認済み（{yearMonthLabel(wTrust.verified_at)}）</span>
                          : <span style={{ fontSize:11, color:"#999" }}>本人確認 未</span>}
                        {wTrust.reviewed_count > 0
                          ? <span style={{ fontSize:11, color:"#222", fontWeight:600 }}>🔁 リピート率 {Math.round(wTrust.want_again_count / wTrust.reviewed_count * 100)}%（また呼びたい {wTrust.want_again_count}/{wTrust.reviewed_count}件）</span>
                          : <span style={{ fontSize:11, color:"#999" }}>🔁 リピート率 —（評価はまだありません）</span>}
                      </div>
                    )}
                    {(() => {
                      const badges = [
                        wMini?.transport && "🚗 " + wMini.transport,
                        wMini?.farm_experience && "🌾 " + wMini.farm_experience,
                        wMini?.physical_level && "💪 " + wMini.physical_level,
                      ].filter(Boolean);
                      const tags = [...(wMini?.interests || []), ...(wMini?.languages || [])];
                      const pr = (wMini?.pr || "").trim();
                      const hasAny = wMini && (wMini.residence_city || badges.length || tags.length || pr);
                      if (!hasAny) return <p style={{ fontSize:13, color:"#999", textAlign:"center", margin:"32px 0" }}>プロフィールは未設定です</p>;
                      return (
                        <>
                          {wMini.residence_city && <p style={{ fontSize:12, color:"#717171", margin:"0 0 8px" }}>📍{wMini.residence_city}</p>}
                          {badges.length > 0 && (
                            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
                              {badges.map((b,i) => <span key={i} style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"4px 10px" }}>{b}</span>)}
                            </div>
                          )}
                          {tags.length > 0 && (
                            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
                              {tags.map((t,i) => <span key={i} style={{ fontSize:11, color:"#717171", background:"#F0F7F4", borderRadius:20, padding:"3px 10px" }}>#{t}</span>)}
                            </div>
                          )}
                          {pr && <ExpandableText text={pr} limit={100} style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, overflowWrap:"break-word", wordBreak:"break-word" }} />}
                        </>
                      );
                    })()}
                  </div>
                )}
              </button>
              <button onClick={(e)=>{
                e.stopPropagation();
                if (wTopAnim === "pflip-out") return; // 連打ガード
                setWTopAnim("pflip-out");
                setTimeout(()=>{ setWTopBack(v=>{ const nv = !v; try { localStorage.setItem("cb_wTopBack", nv ? "1" : "0"); } catch {} return nv; }); setWTopAnim("pflip-in"); }, 400);
              }} aria-label="表示を切り替える" style={{ position:"absolute", top:12, right:12, width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>⇄</button>
            </div>
            {(() => {
              // 区画見出し＋2箱ずつ（2026-07-22 役割区画化）。数字バッジ＝相手/自分を待たせている件数のみ
              const hubBox = (c) => {
                const flipped = hubFlip === c.l;
                return (
                <button key={c.l} onClick={()=>{ if (flipped) { setHubFlip(null); return; } c.onClick ? c.onClick() : (window.location.hash=c.h); }} className={"f-sans" + (!flipped && c.urgent && c.n > 0 ? " cb-urgent-card" : "")} style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"26px 8px 18px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0, minHeight:132, boxSizing:"border-box" }}>
                  {c.desc && <span onClick={(e)=>{ e.stopPropagation(); setHubFlip(flipped ? null : c.l); }} role="button" aria-label="説明" style={{ position:"absolute", top:8, right:8, zIndex:3, width:22, height:22, borderRadius:11, background: flipped ? "#00A86B" : "#F0F0F0", color: flipped ? "#fff" : "#999", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>？</span>}
                  {flipped ? (
                    <span className="f-sans pflip-in" style={{ fontSize:12, color:"#555", lineHeight:1.7, textAlign:"center", padding:"2px 8px" }}>{c.desc}</span>
                  ) : (<>
                    {c.n > 0 && <span style={{ position:"absolute", top:9, right:c.desc?34:10, minWidth:22, height:22, borderRadius:11, background:"#00A86B", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{c.n}</span>}
                    {c.mark && <span style={{ position:"absolute", top:8, right:c.desc?34:10, fontSize:18, lineHeight:1 }}>🌟</span>}
                    <span style={{ fontSize:44, lineHeight:1 }}>{c.e}</span>
                    <span style={{ fontSize:15, fontWeight:700, color:"#222" }}>{c.l}</span>
                    {c.sub && <span className="f-sans" style={{ fontSize:11, color:"#717171", textAlign:"center", lineHeight:1.4 }}>{c.sub}</span>}
                  </>)}
                </button>
                );
              };
              const sec = (title, boxes) => (
                <div key={title} style={{ marginTop:16 }}>
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_ORANGE, paddingLeft:8 }}>{title}</p>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>{boxes.map(hubBox)}</div>
                </div>
              );
              return (<>
                {/* 「きょうの仕事」箱は撤去（2026-07-24・1機能1入口＝ナビ「📆今日」が唯一の入口）。📌いまは返事待ちのみ */}
                {sec("📌 いま", [
                  { e:"📨", l:"返事待ち",     h:"/profile/worker/applying", n:wAppCounts.applying, desc:"応募して、農家の返事を待っている求人です。作業日の前日までに結果が届きます。" },
                ])}
                {sec("🔎 次の仕事", [
                  { e:"🔍", l:"さがす", h:"/search", sub:`きょう応募できる求人 ${wHub.searchOpen}件`, desc:"近くの募集中の求人をさがせます。気になったら応募できます。" },
                  { e:"🧡", l:"いいね", h:"/saved", desc:"気になる求人を🧡で保存した一覧です。" },
                ])}
                <div style={{ marginTop:16 }}>
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_ORANGE, paddingLeft:8 }}>📖 わたしの記録</p>
                  <button onClick={()=>{ setShowWAch(true); setWSeenReviews(wHub.reviewed); try { localStorage.setItem("cb_wSeenReviews", String(wHub.reviewed)); } catch {} }} className="f-sans" style={{ position:"relative", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
                    {wHub.reviewed > wSeenReviews && <span style={{ position:"absolute", top:10, right:12, fontSize:18, lineHeight:1 }}>🌟</span>}
                    <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>🌟</span>
                    <span style={{ flex:1, minWidth:0 }}>
                      <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>わたしの実績</span>
                      <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:4 }}>完了 {wHub.completed}回　🌟 {wHub.wantAgain}　作業 {wHub.hours}時間</span>
                    </span>
                  </button>
                  {/* 📋 経験・できること（自己申告）：わたしの実績の下へ（2026-07-23）。タップで編集ボックスを開く */}
                  {(() => {
                    const chips = wMini ? [
                      ...((Array.isArray(wMini.experience_entries) ? wMini.experience_entries : []).filter(e => e && (e.crop||"").trim()).map(e => `${e.crop}×${e.task||""}${e.duration ? `（${e.duration}）` : ""}`)),
                      ...(wMini.farm_experience ? ["🌾 " + wMini.farm_experience] : []),
                      ...((Array.isArray(wMini.experienced_tasks) ? wMini.experienced_tasks : []).filter(Boolean)),
                      ...(wMini.transport ? ["🚗 " + wMini.transport] : []),
                      ...((Array.isArray(wMini.self_declared) ? wMini.self_declared : []).map(k => (WORKER_DECLARATIONS.find(x=>x.k===k)||{}).chip).filter(Boolean)),
                    ] : [];
                    return (
                      <button onClick={()=>{ try { sessionStorage.setItem("cb_wkOpenBox","declared"); } catch {} window.location.hash="/profile/worker/profile"; }} className="f-sans" style={{ width:"100%", marginTop:12, background:"#F6F8FC", border:"1px solid #E1E8F2", borderRadius:20, padding:"16px", cursor:"pointer", textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", display:"block" }}>
                        <span className="f-sans" style={{ display:"block", fontSize:15, fontWeight:800, color:"#3A5570", marginBottom: chips.length ? 8 : 4 }}>📋 経験・できること（自己申告）</span>
                        {chips.length > 0 ? (<>
                          <span style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:6 }}>
                            {chips.map((c,i) => <span key={i} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#3A5570", background:"#E8EEF7", borderRadius:20, padding:"4px 10px" }}>{c}</span>)}
                          </span>
                          <span className="f-sans" style={{ display:"block", fontSize:10, color:"#A0A8B4", lineHeight:1.5 }}>ご本人の申告です。運営が確認したものではありません。タップして編集</span>
                        </>) : (
                          <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", lineHeight:1.6 }}>作物×作業の経験や、免許・資格を登録できます。タップして登録 →</span>
                        )}
                      </button>
                    );
                  })()}
                </div>
              </>);
            })()}
            {showWAch && (
              <div onClick={()=>setShowWAch(false)} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
                <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:20, padding:"20px", maxWidth:460, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative" }}>
                  <button onClick={()=>setShowWAch(false)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", zIndex:1 }}>✕</button>
                  <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 14px" }}>🌟 わたしの実績</p>
                  {/* 実績が1つでもあれば台帳カードを出す（2026-07-24修正）。旧判定は評価(reviewed)のみを見ており、
                      完了はあるが評価が付いていない（完了1回・評価0）状態でハブの「完了1回」と食い違い、空表示になっていた。
                      WorkerTrustCard の実績ブロック判定（完了/また働きたい/作業時間のいずれか>0）に揃える */}
                  {((wHub.completed || 0) > 0 || (wHub.wantAgain || 0) > 0 || (wHub.hours || 0) > 0)
                    ? <WorkerTrustCard profile={wMini || {}} trust={wTrust} hideSelfDeclare />
                    : <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", lineHeight:1.9, padding:"28px 8px" }}>最初の仕事を終えると、ここに実績が刻まれます</p>}
                </div>
              </div>
            )}
          </>
        ) : (
        <div className="profile-content">
            {/* 戻るは浮遊固定ボックス（求人詳細の←戻ると同じ意匠・スクロール追従・2026-07-16）。
                fadeInはopacityのみ＝fixedの基準を壊さない（壊すのは祖先のtransform） */}
            <button onClick={()=>{ setWTab("home"); window.location.hash="/profile/worker"; }} className="f-sans job-float-back" style={{
              display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
              fontSize:13, fontWeight:600, color:"#717171", cursor:"pointer", padding:"8px 14px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
            }}>← プロフィール</button>
            {/* 浮遊ボックスと見出しが重ならないためのスペーサー（ノッチ端末はsafe-area分も確保） */}
            <div aria-hidden="true" style={{ height:"calc(48px + env(safe-area-inset-top, 0px))" }} />
            {/* カレンダーはMyCalendar自身が見出しを持つため、ここでは出さない（文字重複防止・2026-07-16） */}
            {wTab !== "wcalendar" && (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <h2 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", margin:0 }}>{WORKER_TAB_TITLES[wTab]}</h2>
              </div>
            )}
            {/* 2026-07-14: プレビューページ廃止＝トップボックスタップで直接編集ページへ。プレビューは編集ページ右上→モーダル */}
            {wTab === "wprofile" ? (
              <WorkerProfileEdit me={me} onAvatarChange={onAvatarChange} onDone={()=>{
                const ret = peekApplyReturn();
                if (ret) { clearApplyReturn(); window.location.hash = "/work/job/" + ret; }
              }} />
            ) : wTab === "applying" ? (
              <WorkerApplications filter="applying" me={me} />
            ) : wTab === "approved" ? (
              <WorkerApplications filter="approved" me={me} />
            ) : (
              <MyCalendar />
            )}{/* カレンダーはページ内に直接展開（旧：カレンダーへ→の案内ページ・2026-07-16） */}
        </div>
        )
      ) : (
        <>
          {/* 「← プロフィールへ」ボタンは削除（2026-07-14）。働き手側への行き来は浮遊「🤝 働く」トグルが担う */}
          {me&&!me.isWorker&&me.status==="pending"&&(
            <div className="f-sans" style={{margin:"0 auto 16px",padding:"14px 18px",background:"#FFF8E7",border:"1px solid #F5D98F",borderRadius:12,fontSize:13,color:"#8A6D1D",lineHeight:1.7}}>
              🕊 ご登録ありがとうございます。現在、運営が内容を確認しています。<b>承認後に求人の公開ができるようになります</b>（通常1〜2日以内）。
            </div>
          )}
          <FarmerDashboard onNewJob={onNewJob} onResume={onResume} me={me} />
        </>
      )}
      </div>
    </div>
  );
}


function JobSearchMapView({ onRegister, me }) {
  const [selectedJob, setSelectedJob] = useState(null);
  const [detailTab, setDetailTab] = useState("content"); // 求人詳細の「仕事の内容/質問」タブ（第10弾）
  useEffect(() => { setDetailTab("content"); }, [selectedJob?.id]); // 別の求人を開いたら内容タブに戻す
  // 自分の求人か（2026-07-22）：自分の求人には応募フッター（日給・応募ボタン）を出さない。
  // jobsのRLS owner selectで自分の行だけ返る（他人の求人はnull＝false）
  const [isOwnJob, setIsOwnJob] = useState(false);
  useEffect(() => {
    if (!selectedJob || !me) { setIsOwnJob(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("jobs").select("farmer_id").eq("job_number", selectedJob.id).maybeSingle();
        if (!cancelled) setIsOwnJob(!!(data && data.farmer_id === me.id));
      } catch { if (!cancelled) setIsOwnJob(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.id, me]);
  const [dbJobs, setDbJobs] = useState(null);
  const [dangerLightbox, setDangerLightbox] = useState(null);
  const [farmIntroOpen, setFarmIntroOpen] = useState(false); // 農園紹介モーダル（ページには代表よりのみ・タップで全文展開）
  const [farmTrustOpen, setFarmTrustOpen] = useState(false); // 信頼カードのボックス展開（2026-07-16）
  // 受け入れ実績タップ→この農家の過去の求人ボックス（2026-07-16）
  const [pastJobsOpen, setPastJobsOpen] = useState(false);
  const [pastJobs, setPastJobs] = useState(null); // null=読み込み中
  const [pastJobsTab, setPastJobsTab] = useState("all"); // すべて/公開中/終了（2026-07-23）
  const [pastJobsFocus, setPastJobsFocus] = useState(null); // タップした求人（job_number）。先頭に移動して概要を展開（2026-07-24）
  const [pastJobsCounts, setPastJobsCounts] = useState({}); // { job_number: {applied, approved, hired} }（集計値のみ）
  const [jobBackStack, setJobBackStack] = useState([]); // 過去求人から遷移した時の「前の求人」スタック
  const openPastJobs = async (tab) => {
    // tab: "open"（公開中→から）/"ended"（実績→から）/未指定は"all"。イベントオブジェクト混入ガード付き
    setPastJobsOpen(true); setPastJobs(null); setPastJobsTab(typeof tab === "string" ? tab : "all");
    setPastJobsFocus(null); setPastJobsCounts({});
    try {
      const { data } = await supabase.rpc("employer_public_jobs", { p_job_number: selectedJob.id });
      // 今見ている求人も含めて全公開求人を出す（2026-07-16）。審査中(pending)・下書きは
      // 運営承認ゲート（憲法5条）前のため含めない——承認されれば自動でここに並ぶ
      setPastJobs(data || []);
    } catch { setPastJobs([]); }
    // 求人ごとの応募・承認・採用人数（展開概要用・失敗しても「ー」表示になるだけ）
    try {
      const { data: cnts } = await supabase.rpc("employer_public_job_counts", { p_job_number: selectedJob.id });
      if (cnts) setPastJobsCounts(cnts);
    } catch {}
  };
  const openPastJob = (row) => {
    if (row.job_number === selectedJob.id) { setPastJobsOpen(false); setFarmIntroOpen(false); return; } // 今の求人ならボックスを閉じるだけ
    const job = mapJobPublicRow(row);
    setJobBackStack(prev => [...prev, selectedJob]);
    setPastJobsOpen(false); setFarmIntroOpen(false);
    openJob(job);
    try { window.scrollTo(0, 0); } catch {}
  };
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTargetField, setReportTargetField] = useState("");
  const [reportIssueType, setReportIssueType] = useState("");
  const [reportDetail, setReportDetail] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const REPORT_TARGET_FIELDS = ["報酬","勤務時間・休憩","危険情報","作業の説明","写真","場所・日程","その他"];
  const REPORT_ISSUE_TYPES = ["虚偽・誇大の疑い","最低賃金違反","差別的条件","連絡先の直書き・外部誘導","危険情報の欠落","個人情報・肖像権","不快・不適切な表現","その他"];
  const closeReportModal = () => { setShowReportModal(false); setReportTargetField(""); setReportIssueType(""); setReportDetail(""); };
  const submitReport = async () => {
    if (reportSending || !reportTargetField || !reportIssueType || !selectedJob || !me) return;
    setReportSending(true);
    const { error } = await supabase.from('job_reports').insert({
      job_number: selectedJob.id,
      reporter_id: me.id,
      target_field: reportTargetField,
      issue_type: reportIssueType,
      detail: reportDetail.trim() || null,
    });
    setReportSending(false);
    if (error) { alert("報告の送信に失敗しました：" + error.message); return; }
    setReportDone(true);
    setTimeout(() => { setReportDone(false); closeReportModal(); }, 1500);
  };
  useEffect(() => {
    // 訪問者モード（2026-07-24）：jobs_publicはanon許可so未ログインでも公開面を読める
    (async () => {
      try {
        const { data, error } = await supabase.from("jobs_public").select("*").order("job_number",{ascending:false});
        if (!error && data) {
          const mapped = data.map(mapJobPublicRow);
          // 並び順（2026-07-24たきと指示）：一覧・その他の求人はランダム。新着（掲載3日以内）は
          // この端末で「初めて見る時だけ」上位に配置（cb_seenNewJobsに既読記録＝二度目からは通常のランダム枠）。
          // シャッフルは読み込み時に1回＝表示中に並びが飛ばない
          const shuffleArr = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
          let seen = []; try { seen = JSON.parse(localStorage.getItem("cb_seenNewJobs") || "[]"); } catch {}
          const seenSet = new Set(seen);
          const freshNew = mapped.filter(j => j.isNew && !seenSet.has(j.id));
          const rest = mapped.filter(j => !(j.isNew && !seenSet.has(j.id)));
          setDbJobs([...shuffleArr(freshNew), ...shuffleArr(rest)]);
          if (freshNew.length) { try { localStorage.setItem("cb_seenNewJobs", JSON.stringify([...seen, ...freshNew.map(j => j.id)].slice(-300))); } catch {} }
        }
      } catch {}
    })();
  }, [me]);
  const jobList = dbJobs || [];

  // ── いいね（お気に入り）：saved_jobs（本人のみRLS）。job_number(=job.id)をキーに管理 ──
  const [savedIds, setSavedIds] = useState(new Set());
  const [likeDone, setLikeDone] = useState(null); // 初いいねボックス（2026-07-19）：各求人の最初のいいねで1回だけ展開（localStorage cb_likeBoxShown）
  // きっかけアンケート（初回いいね時・2026-07-24）：未回答ユーザーの最初のいいね前に1度だけ聞く
  const [surveyAnswered, setSurveyAnswered] = useState(null); // null=未取得 / true / false
  const [surveyJob, setSurveyJob] = useState(null); // アンケート表示中に保留するいいね対象
  const [surveySource, setSurveySource] = useState("");
  const [surveySourceOther, setSurveySourceOther] = useState("");
  const [surveyReasons, setSurveyReasons] = useState([]);
  const [surveyReasonOther, setSurveyReasonOther] = useState("");
  const [surveySaving, setSurveySaving] = useState(false);
  useEffect(() => {
    if (!me) { setSurveyAnswered(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("user_onboarding_survey").select("auth_id").eq("auth_id", me.id).maybeSingle();
        if (!cancelled) setSurveyAnswered(!!data);
      } catch { if (!cancelled) setSurveyAnswered(true); } // 取得失敗時はゲートしない（コア動作＝いいねを止めない）
    })();
    return () => { cancelled = true; };
  }, [me]);
  useEffect(() => {
    if (!me) { setSavedIds(new Set()); return; }
    (async () => {
      try {
        const { data } = await supabase.from("saved_jobs").select("job_number").eq("worker_id", me.id);
        setSavedIds(new Set((data || []).map(r => r.job_number)));
      } catch {}
    })();
  }, [me]);
  // 実いいね処理（アンケートゲート通過後・解除時に呼ぶ）
  const performSave = async (job) => {
    const isSaved = savedIds.has(job.id);
    setSavedIds(prev => { const next = new Set(prev); isSaved ? next.delete(job.id) : next.add(job.id); return next; });
    const { error } = isSaved
      ? await supabase.from("saved_jobs").delete().eq("worker_id", me.id).eq("job_number", job.id)
      : await supabase.from("saved_jobs").insert({ worker_id: me.id, job_number: job.id });
    if (error) { setSavedIds(prev => { const next = new Set(prev); isSaved ? next.add(job.id) : next.delete(job.id); return next; }); return; }
    // 各求人の初いいねだけボックス展開（求人ごとに1回・解除→再いいねでは出さない）
    if (!isSaved) {
      try {
        const shown = JSON.parse(localStorage.getItem("cb_likeBoxShown") || "[]");
        if (!shown.includes(job.id)) {
          localStorage.setItem("cb_likeBoxShown", JSON.stringify([...shown, job.id]));
          setLikeDone(job);
        }
      } catch { setLikeDone(job); }
    }
  };
  const toggleSave = async (job) => {
    if (!me) { visitorGuide(); return; }
    const isSaved = savedIds.has(job.id);
    // 未回答ユーザーの「最初のいいね」の前にきっかけアンケート（追加時のみ・解除時は出さない・2026-07-24）
    if (!isSaved && surveyAnswered === false) { setSurveyJob(job); return; }
    performSave(job);
  };
  const toggleSurveyReason = (v) => setSurveyReasons(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const submitSurvey = async () => {
    if (surveySaving || !me) return;
    if (!surveySource) { alert("Q1をひとつ選んでください"); return; }
    setSurveySaving(true);
    try {
      const { error } = await supabase.from("user_onboarding_survey").insert({
        auth_id: me.id,
        source: surveySource,
        source_other: surveySource === "その他" ? (surveySourceOther.trim() || null) : null,
        reasons: surveyReasons,
        reason_other: surveyReasons.includes("その他") ? (surveyReasonOther.trim() || null) : null,
      });
      if (error && error.code !== "23505") { alert("送信に失敗しました：" + error.message); setSurveySaving(false); return; }
      setSurveyAnswered(true);
      const job = surveyJob;
      setSurveyJob(null); setSurveySaving(false);
      if (job) performSave(job); // ★元のいいねを自動で完了させる
    } catch (e) { alert("送信に失敗しました"); setSurveySaving(false); }
  };
  useEffect(() => {
    const m = window.location.hash.replace(/^#\/?/,"").match(/^work\/job\/(\d+)$/);
    if (!m) return;
    const jn = parseInt(m[1],10);
    const found = jobList.find(j => j.id === jn);
    if (found) { setSelectedJob(found); clearApplyReturn(); return; }
    if (dbJobs && dbJobs.length > 0) clearApplyReturn();
  }, [dbJobs]);
  useEffect(() => {
    const onHash = () => {
      const m = window.location.hash.replace(/^#\/?/,"").match(/^work\/job\/(\d+)$/);
      if (!m) { setSelectedJob(null); try { sessionStorage.removeItem("cb_jobBackTo"); } catch {} return; }
      const jn = parseInt(m[1],10);
      const found = jobList.find(j => j.id === jn);
      if (found) setSelectedJob(found);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, [jobList]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [reviewSort, setReviewSort] = useState("new");
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [showApplyBar, setShowApplyBar] = useState(false);
  const applyPanelRef = useRef(null);
  const openJob = job => { setSelectedJob(job); setActiveSlide(0); setReviewSort("new"); setShowAllReviews(false); try{ window.history.pushState(null,"","#/work/job/"+job.id); }catch{} };
  const [empEmployer, setEmpEmployer] = useState(null);
  const [empTrust, setEmpTrust] = useState(null);
  useEffect(() => {
    if (!selectedJob) { setEmpEmployer(null); setEmpTrust(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.rpc('job_employer_profile', { p_job_number: selectedJob.id });
        if (!cancelled) setEmpEmployer((data && data[0]) || null);
      } catch { if (!cancelled) setEmpEmployer(null); }
      try {
        const { data: trust } = await supabase.rpc('job_employer_trust_info', { p_job_number: selectedJob.id });
        if (!cancelled) setEmpTrust(trust || null);
      } catch { if (!cancelled) setEmpTrust(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.id]);
  const [myApplication, setMyApplication] = useState(null);
  useEffect(() => {
    if (!selectedJob || !me) { setMyApplication(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from('applications').select('id,status,started_at')
          .eq('job_number', selectedJob.id).maybeSingle();
        if (!cancelled) setMyApplication(data || null);
      } catch { if (!cancelled) setMyApplication(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.id, me]);

  // 集合場所の詳細ページ表示は削除（2026-07-16）。承認後の共有はチャットの「はじめる前の確認」カード（job_meeting_place RPC）に一本化

  // 開始打刻（①）：承認済み以降・作業日当日のみ
  const [punching, setPunching] = useState(false);
  const punchStart = async () => {
    if (punching || !myApplication) return;
    setPunching(true);
    try {
      const { data, error } = await supabase.rpc('punch_start', { p_application_id: myApplication.id });
      if (!error && data && data.ok) {
        setMyApplication(prev => prev ? { ...prev, started_at: data.started_at, status: data.already ? prev.status : 'working' } : prev);
      } else if (data && !data.ok) {
        alert('開始できませんでした：' + (data.reason || '不明'));
      }
    } catch { alert('開始の記録に失敗しました。'); }
    setPunching(false);
  };
  const [applying, setApplying] = useState(false);
  // プロフィールゲートのモーダル状態。null=非表示 / {mode:"soft"}=クライアント側の空チェック（両方選べる）
  // / {mode:"hard", hasNickname, qaAnswered, qaRequired}=サーバー側の必須ゲート（プロフィールを書く、のみ）
  const [profileGate, setProfileGate] = useState(null);

  // apply_to_job本体（プロフィールゲート通過後、または「このまま応募する」選択後に呼ぶ）
  const doApply = async () => {
    setApplying(true);
    try {
      const { data, error } = await supabase.rpc("apply_to_job", { p_job_number: selectedJob.id, p_available_dates: applyAvailRef.current });
      setApplying(false);
      if (error) { alert("応募に失敗しました。時間をおいて再度お試しください。"); return; }
      if (data && data.reason === "dates_required") { alert("この求人は期間募集です。来られる日（または「期間中いつでもOK」）を選んでから応募してください。"); return; }
      if (data && data.ok) {
        try { if (data.already) sessionStorage.setItem("cb_applyAlready","1"); else sessionStorage.removeItem("cb_applyAlready"); } catch {}
        window.location.hash = "/apply/done";
      }
      else if (data && data.reason === "not_logged_in") { setApplyReturn(selectedJob.id); if (onRegister) onRegister(); }
      else if (data && data.reason === "own_job") { alert("自分の求人には応募できません。"); }
      else if (data && data.reason === "job_not_open") { alert("この求人は現在募集を受け付けていません。"); }
      else if (data && data.reason === "profile_incomplete") {
        setProfileGate({ mode:"hard", hasNickname: !!data.has_nickname, qaAnswered: data.qa_answered ?? 0, qaRequired: data.qa_required ?? 5 });
      }
      else if (data && data.reason === "profile_under_review") {
        alert(data.revision
          ? "自己紹介に運営から修正のお願いが届いています。プロフィールを修正して保存すると、審査のうえ応募できるようになります。"
          : "自己紹介が運営の審査待ちのため、いまは応募できません。公開までお待ちください（最大2日）。");
      }
      else { alert("応募できませんでした。"); }
    } catch { setApplying(false); alert("応募に失敗しました。"); }
  };

  const handleApply = async () => {
    if (applying || !selectedJob) return;
    setApplying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setApplying(false);
        setApplyReturn(selectedJob.id);
        if (onRegister) onRegister();
        return;
      }
      // ①(account_holders)未登録なら重い登録へ。戻り先を退避。
      const { data: ah } = await supabase.from('account_holders')
        .select('id').eq('auth_id', session.user.id).maybeSingle();
      if (!ah) {
        setApplying(false);
        setApplyReturn(selectedJob.id);
        window.location.hash = "/account";
        return;
      }
      // プロフィール空チェック（ソフトゲート：nickname・prが両方空の時だけ一呼吸置かせる。取得失敗は「入力済み」側に倒し応募を止めない）
      let profileBlank = false;
      try {
        const { data: wp } = await supabase.from('worker_profiles').select('nickname, pr').eq('auth_id', session.user.id).maybeSingle();
        const isBlank = v => !v || !v.trim();
        profileBlank = !!wp && isBlank(wp.nickname) && isBlank(wp.pr);
      } catch { profileBlank = false; }
      if (profileBlank) {
        setApplying(false);
        setProfileGate({ mode:"soft" });
        return;
      }
      await doApply();
    } catch { setApplying(false); alert("応募に失敗しました。"); }
  };

  // 応募の取消（承認前のみ・本人）
  const cancelMyApplication = async () => {
    if (applying || !myApplication) return;
    if (!window.confirm("この応募を取り消しますか？農家にお知らせが届きます")) return;
    setApplying(true);
    try {
      const { data, error } = await supabase.rpc("cancel_application", { p_application_id: myApplication.id });
      setApplying(false);
      if (!error && data && data.ok) setMyApplication(null);
      else alert("取り消しに失敗しました：" + (data?.reason || error?.message || "不明"));
    } catch { setApplying(false); alert("取り消しに失敗しました。"); }
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

  // トップ写真のループ（2026-07-16）：両端にクローンを置き、端に着地した瞬間に本物へ瞬間ジャンプ。
  // 1枚目で左へ→最後の写真／最後の写真で右へ→1枚目
  const photoScrollerRef = useRef(null);
  const photoCount = selectedJob?.photos?.length || 0;
  const photosLooped = photoCount > 1;
  const handlePhotoScroll = e => {
    const el = e.target;
    const w = el.clientWidth;
    if (!w) return;
    const idx = Math.round(el.scrollLeft / w);
    if (!photosLooped) { setActiveSlide(idx); return; }
    const settled = Math.abs(el.scrollLeft - idx * w) < 2;
    if (settled && idx === 0) { el.scrollLeft = photoCount * w; setActiveSlide(photoCount - 1); return; }
    if (settled && idx === photoCount + 1) { el.scrollLeft = w; setActiveSlide(0); return; }
    setActiveSlide(((idx - 1) % photoCount + photoCount) % photoCount);
  };
  useEffect(() => {
    if (!photosLooped) return;
    const el = photoScrollerRef.current;
    if (el) requestAnimationFrame(() => { el.scrollLeft = el.clientWidth; });
    setActiveSlide(0);
  }, [selectedJob?.id, photosLooped]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxPay = selectedJob ? calcMaxPay(selectedJob) : null;
  const myAppStatus = myApplication?.status;
  const applyBtnDisabled = myAppStatus === "rejected";
  const applyBtnLabel = applying ? (myAppStatus === "applied" ? "取り消し中..." : "送信中...")
    : myAppStatus === "approved" ? "承認されました — チャットを開く"
    : myAppStatus === "rejected" ? "今回は見送りとなりました"
    : myAppStatus === "applied" ? "応募済み — 取り消す"
    : "応募";
  const applyBtnStyle = myAppStatus === "rejected" ? { background:"#EBEBEB", color:"#717171" }
    : myAppStatus === "applied" ? { background:"#F7F7F7", color:"#717171", border:"1px solid #EBEBEB" }
    : {};
  // 2026-07-13 労働局確認済み・当事者間の直接連絡は適法（CLAUDE.md参照）
  // 応募確認ボックス（2026-07-18）：新規応募はボタン直送信でなく、内容確認のボックスを展開してから
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  // 応募時の来られる日宣言（2026-07-24）：期間求人（date_end有り・単日でない）だけ、応募シートで日程を選ぶ。
  // applyAvailRefに最終値（"any"／日付配列／null）を同期的に入れてからhandleApply＝ゲート往復でも保持できる
  const [applyDates, setApplyDates] = useState([]); // 選択中の特定日（"YYYY-MM-DD"）
  const applyAvailRef = useRef(null);
  useEffect(() => { setApplyConfirmOpen(false); setApplyDates([]); applyAvailRef.current = null; }, [selectedJob?.id]);
  const isPeriodJob = !!(selectedJob && selectedJob.dateEndRaw && selectedJob.dateEndRaw !== selectedJob.dateStartRaw);
  // 期間内の日付を "YYYY-MM-DD" 配列で列挙（開始〜終了・両端含む）
  const periodDays = (() => {
    if (!isPeriodJob) return [];
    const out = []; const [ys, ms, ds] = selectedJob.dateStartRaw.split("-").map(Number);
    const start = new Date(ys, ms - 1, ds); const end = new Date(selectedJob.dateEndRaw + "T00:00:00");
    let guard = 0;
    for (let d = new Date(start); d <= end && guard < 400; d.setDate(d.getDate() + 1), guard++) out.push(ymdLocal(d));
    return out;
  })();
  const [signupOpen, setSignupOpen] = useState(false); // 未ログイン画面の文言用（app_settings.signup_open・既定false=招待制）
  useEffect(() => { supabase.rpc("signup_open").then(({ data }) => { if (data === true) setSignupOpen(true); }).catch(()=>{}); }, []);
  // 訪問者（未ログイン）が応募・いいね・投稿等をタップした時の案内（2026-07-24・隠さず案内する）
  const visitorGuide = () => {
    alert(signupOpen ? "登録すると応募できます。登録画面へ進みます。" : "現在は招待制です。招待を受けた方は招待メールのアドレスでログインしてください。");
    window.location.hash = "/login";
  };
  const applyBtnOnClick = !me ? visitorGuide
    : myAppStatus === "approved" ? (() => { window.location.hash = "/chat/" + myApplication.id; })
    : myAppStatus === "applied" ? cancelMyApplication
    : (() => setApplyConfirmOpen(true));
  // 募集終了（2026-07-24）：設定した採用人数に達した（満員＝filled）／作業日程が過ぎた（expired）求人は
  // 応募導線（下部フッター・応募ボタン）を出さない＝新規の募集を締め切る。
  // ただし既に応募・承認・見送りの関係がある本人には、状況確認とチャット導線を残すため従来どおり表示する。
  const recruitClosed = !!(selectedJob && (selectedJob.filled || selectedJob.expired));
  const hideApply = recruitClosed && !myAppStatus;
  const closedLabel = selectedJob?.filled ? "募集終了（満員）" : "募集期間終了";

  return (
    <div>
      {!selectedJob && (<>
      {/* ヘッダー */}
      <div style={{ marginBottom:5 }}>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:6 }}>近くの仕事を探す</h2>
      </div>

      {/* 個人情報保護注記 */}
      <div style={{ padding:"7px 12px", background:"#F7F7F7", borderRadius:8, marginBottom:12 }}>
        <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>
          お支払いは、作業当日の現金手渡しが原則です。
        </p>
      </div>

      {/* 絞込ピルは削除（2026-07-16）：実フィルタ未接続の飾りだった。検索機能は市場の厚みに応じて段階解禁（骨格②） */}

      {/* 仕事リスト */}
      <div className="job-search-layout">
        <div>
          {jobList.length === 0 && (
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"64px 20px", color:"#999" }} className="f-sans">
              <div style={{ fontSize:40, marginBottom:12 }}>🌾</div>
              <p style={{ fontSize:16, margin:0, lineHeight:1.6 }}>現在、募集中の求人はありません</p>
            </div>
          )}
          {jobList.map(job => (
            <JobCard key={job.id} job={job} variant="list" saved={savedIds.has(job.id)} onToggleSave={toggleSave} />
          ))}
        </div>
      </div>
      </>)}

      {/* ── 詳細ページ ── */}
      {selectedJob && (<>
        {/* .appear(transform保持)の外に置く＝fixedの基準を画面に保つ（2026-07-16スクロール追従修理） */}
          {/* ←戻る／♡いいね：同じ高さの浮遊固定ボックス（スクロール追従・2026-07-16） */}
        <button onClick={() => {
          // 過去の求人から来た場合は前の求人詳細へ戻る（2026-07-16）
          if (jobBackStack.length > 0) {
            const prev = jobBackStack[jobBackStack.length - 1];
            setJobBackStack(st => st.slice(0, -1));
            setSelectedJob(prev);
            try { window.history.pushState(null, "", "#/work/job/" + prev.id); } catch {}
            try { window.scrollTo(0, 0); } catch {}
            return;
          }
          // カレンダー等の出どころから来た場合はそこへ戻る（2026-07-16）
          let backTo = null; try { backTo = sessionStorage.getItem("cb_jobBackTo"); sessionStorage.removeItem("cb_jobBackTo"); } catch {}
          if (backTo) { setSelectedJob(null); window.location.hash = backTo; return; }
          setSelectedJob(null); try{ window.history.pushState(null,"","#/search"); }catch{}
        }} className="f-sans job-float-back" style={{
          display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
          fontSize:13, fontWeight:600, color:"#717171", cursor:"pointer", padding:"8px 14px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>{jobBackStack.length > 0 ? "← 前の求人に戻る" : ((()=>{ try { return sessionStorage.getItem("cb_jobBackTo") === "/calendar"; } catch { return false; } })() ? "← カレンダーに戻る" : "← 一覧に戻る")}</button>
        <button onClick={() => toggleSave(selectedJob)} aria-label={savedIds.has(selectedJob.id) ? "いいねを解除" : "いいね"} className="f-sans job-float-like" style={{
          display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
          fontSize:13, fontWeight:600, color: savedIds.has(selectedJob.id) ? "#E24B4A" : "#717171", cursor:"pointer", padding:"8px 14px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>{savedIds.has(selectedJob.id) ? "♥ いいね済み" : "♡ いいね"}</button>
        <div className="appear job-detail-body-mobile">
          {/* 通報リンク（いいねの上=ページ先頭右） */}
          {me && (
            <div className="job-detail-back-btn" style={{ textAlign:"right", marginBottom:8 }}>
              <button onClick={()=>setShowReportModal(true)} className="f-sans" style={{
                background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                fontSize:11, color:"#717171", textDecoration:"underline", padding:"2px 4px",
              }}>⚑ この求人を報告する</button>
            </div>
          )}

          {/* 写真ギャラリー（ダミー3枚／将来 selectedJob.photos 配列を受け取る想定・最大10枚） */}
          {(() => {
            const photos = selectedJob.photos || [selectedJob.icon, selectedJob.icon, selectedJob.icon];
            const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
            // ループ用クローン：[最後, ...本物, 最初]。初期位置とジャンプはhandlePhotoScroll側
            const slides = photosLooped ? [photos[photos.length - 1], ...photos, photos[0]] : photos;
            return (
              <>
                <Carousel
                  className="carousel-scroll"
                  style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory" }}
                  wrapperStyle={{ marginBottom:8 }}
                  onScroll={handlePhotoScroll}
                  scrollerRef={photoScrollerRef}
                >
                  {slides.map((photo, i) => {
                    const src = typeof photo === "string" ? photo : photo?.url;
                    const cap = typeof photo === "string" ? "" : photo?.caption;
                    return (
                      <div key={i} style={{
                        flexShrink:0, width:"100%", height:392, borderRadius:12,
                        background: bgColors[i % bgColors.length],
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:72,
                        scrollSnapAlign:"start", position:"relative", overflow:"hidden",
                      }}>
                        <img src={src} alt={cap || ""} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                        {cap && (
                          <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 20px 16px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:16, fontWeight:600, lineHeight:1.6, boxSizing:"border-box" }}>{cap}</div>
                        )}
                      </div>
                    );
                  })}
                </Carousel>
                <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:20 }}>
                  {photos.map((_, i) => (
                    <span key={i} style={{ fontSize:10, color: i===activeSlide ? "#00A86B" : "#D0D0D0" }}>{i===activeSlide ? "●" : "○"}</span>
                  ))}
                </div>
              </>
            );
          })()}

          {/* 仕事の内容 / 質問 タブ（第10弾・2026-07-22） */}
          <ContentQTabs value={detailTab} onChange={setDetailTab} />
          {detailTab === "questions" ? (
            <JobQuestions jobNumber={selectedJob.id} me={me} />
          ) : (<>
          {/* ヘッダー */}
          <div style={{ marginBottom:20 }}>
            <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>{selectedJob.crop} {selectedJob.task}{selectedJob.region ? `｜${selectedJob.region}` : ""}</h2>
            {/* はじめてOK・リピート即決＋待遇はタイトル下にも表示（2026-07-16・求人カードと同じバッジ） */}
            {(selectedJob.beginnerOk || selectedJob.experiencedPreferred || selectedJob.instantApproveRepeat || perkBadges(selectedJob.perks ? { ...(empEmployer || {}), ...selectedJob.perks } : empEmployer).length > 0) && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
                <JobFlagBadges beginner={selectedJob.beginnerOk} expert={selectedJob.experiencedPreferred} repeat={selectedJob.instantApproveRepeat} />
                {perkBadges(selectedJob.perks ? { ...(empEmployer || {}), ...selectedJob.perks } : empEmployer).map(b => (
                  <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{b}</span>
                ))}
              </div>
            )}
          </div>

          {/* 2カラム: 左=情報 / 右=応募パネル */}
          <div className="job-detail-2col">
            {/* 左カラム */}
            <div>
              {/* 主要情報 */}
              <div style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                <div className="job-detail-info-grid">
                  {[
                    // 日程は確認ページと同じ設計（2026-07-16）：「〜終了日」を下段に折り返し
                    { label:"日程",     value: (selectedJob.dateLabel || "").replace("〜", "\n〜") },
                    { label:"勤務時間", value: selectedJob.workTime },
                    { label:"休憩時間", value: selectedJob.breakTime },
                    { label:"採用人数", value: selectedJob.count },
                    { label:"移動時間", value: stationLabel(selectedJob.nearestStation, selectedJob.commuteTime) },
                    { label:"報酬",     value: payLabel(selectedJob) },
                  ].filter(row => row.value && String(row.value).trim()).map(row => (
                    <div key={row.label} style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center", textAlign:"center" }}>
                      <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>{row.label}</span>
                      <span className="f-sans" style={{ fontSize:15, color:"#222", fontWeight:600, lineHeight:1.6, whiteSpace:"pre-line" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}>支払方法：当日現金手渡し</p>
              </div>

              {/* 集合場所の表示は詳細ページから削除（2026-07-16）。承認後の共有はチャットの「はじめる前の確認」カードに一本化 */}

              {/* 開始打刻（①・承認済み以降・作業日当日のみ） */}
              {CHAT_ELIGIBLE_STATUSES.includes(myApplication?.status) && isWorkDayToday(selectedJob.dateStart, selectedJob.dateEnd) && (
                <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                  {myApplication.started_at ? (
                    <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#00A86B", margin:0 }}>
                      開始済み（{new Date(myApplication.started_at).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})}）
                    </p>
                  ) : (
                    <button onClick={punchStart} disabled={punching} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:15, fontWeight:700, borderRadius:14 }}>
                      {punching ? "..." : "▶ 作業を開始する"}
                    </button>
                  )}
                </div>
              )}

              {empEmployer && empEmployer.nickname && (() => {
                const pk = selectedJob.perks ? { ...empEmployer, ...selectedJob.perks } : empEmployer; // 求人ごとの待遇上書き（2026-07-18）
                const perkRows = [
                  { label:"送迎",     on: pk.has_transport,        value: pk.has_transport ? `あり${pk.transport_area ? "（" + pk.transport_area + "）" : ""}` : EMPTY_MARK },
                  { label:"駐車場",   on: pk.has_parking,          value: pk.has_parking ? `あり${pk.parking_capacity ? "（" + pk.parking_capacity + "台）" : ""}` : EMPTY_MARK },
                  { label:"通勤手当", on: pk.has_commute_allowance, value: pk.has_commute_allowance ? `あり${pk.commute_allowance_detail ? "（" + pk.commute_allowance_detail + "）" : ""}` : EMPTY_MARK },
                  { label:"賞与",     on: pk.has_bonus,            value: pk.has_bonus ? "あり" : EMPTY_MARK },
                  { label:"農家負担", on: pk.employer_pays_supplies, value: pk.employer_pays_supplies ? `あり${pk.supplies_cap ? "（" + pk.supplies_cap + "）" : ""}` : EMPTY_MARK },
                  { label:"アクセサリー", on: pk.accessory_ok,          value: pk.accessory_ok ? "OK" : EMPTY_MARK },
                ];
                return (
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    {/* アイコン左・2倍(88px)・名前に「さん」・登録してからの月日。紹介文はここでは出さない（2026-07-16） */}
                    {/* アイコン・名前タップ→農園紹介をボックス展開（2026-07-16） */}
                    <div onClick={()=>setFarmIntroOpen(true)} role="button" style={{ display:"flex", alignItems:"center", gap:14, textAlign:"left", cursor:"pointer" }}>
                      <Avatar url={empEmployer.avatar_url} name={empEmployer.nickname} size={70} />
                      <div style={{ minWidth:0 }}>
                        <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>{empEmployer.nickname}さん</p>
                        {empTrust?.ok && empTrust.member_since && (
                          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>chitose-bank利用 {empTrust.member_since}から</p>
                        )}
                      </div>
                    </div>
                    <div style={{ borderTop:"1px solid #EBEBEB", margin:"14px 0 4px" }} />
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:4, letterSpacing:".06em", textAlign:"center" }}>待遇</p>
                    <div style={{ width:"fit-content", margin:"0 auto" }}>{/* 待遇ブロックはカード中央配置（2026-07-16・旧:境界線を中央に合わせるtranslateX(-78px)） */}
                      {perkRows.map((row, i) => (
                        <div key={row.label} style={{
                          display:"flex", alignItems:"center", gap:12, padding:"8px 0",
                          borderBottom: i < perkRows.length - 1 ? "1px solid #F7F7F7" : "none",
                        }}>
                          <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", width:72, flexShrink:0 }}>{row.label}</span>
                          <span className="f-sans" style={{ fontSize:15, color: row.on ? "#222" : "#B0B0B0", fontWeight: row.on ? 600 : 400, lineHeight:1.6 }}>{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 作業説明 */}
              {selectedJob.jobBody && selectedJob.jobBody.trim() && (
              <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>作業内容</p>
                <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, overflowWrap:"break-word", wordBreak:"break-word" }}>{selectedJob.jobBody}</p>
              </div>
              )}

              {/* 経験・持ち物・備考（配列駆動・未入力は「ー」）。希望する働き手は削除・必要経験と持ち物はバッジ表示（2026-07-16・確認/プレビューと同設計） */}
              <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                {[
                  { label:"持ち物",     value: disp(selectedJob.items), chips:true, pin:true },
                  { label:"備考・注意", value: disp(selectedJob.cautions) },
                ].map(row => (
                  <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                    <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2, textAlign:"center" }}>{row.label}</span>
                    {row.chips && row.value !== "ー"
                      ? (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:2, justifyContent:"center" }}>
                          {String(row.value).split(/[、,・\n／/]+/).map(s => s.trim()).filter(Boolean).map((c, i) => (
                            <span key={i} className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"6px 14px" }}>{row.pin ? "📌 " : ""}{c}</span>
                          ))}
                        </div>
                      )
                      : <span className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word", display:"block", textAlign:"center" }}>{row.value}</span>}
                  </div>
                ))}
              </div>

              {/* 危険区域セクション（両方空なら見出しごと非表示＝ブロック化） */}
              {((selectedJob.dangerPlaces && selectedJob.dangerPlaces.length > 0) || (selectedJob.dangerTasks && selectedJob.dangerTasks.length > 0)) && (
              <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
                  <span style={{ fontSize:18 }}>⚠️</span>
                  <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
                </div>

                {/* 危険な場所 */}
                {(selectedJob.dangerPlaces && selectedJob.dangerPlaces.length > 0) && (
                  <>
                    <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:28 }}>
                      {selectedJob.dangerPlaces.map((place, i) => {
                        const placePhotos = place.photos || [];
                        return (
                        <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={placePhotos} onPhotoClick={setDangerLightbox} />
                        );
                      })}
                    </div>
                  </>
                )}

                {/* 危険な作業 */}
                {(selectedJob.dangerTasks && selectedJob.dangerTasks.length > 0) && (
                  <>
                    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                      {selectedJob.dangerTasks.map((task, i) => {
                        const taskPhotos = task.photos || [];
                        return (
                        <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={taskPhotos} onPhotoClick={setDangerLightbox} />
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              )}
            </div>

            {/* 右カラム: 応募パネル（段階2-a・ガワのみ。応募は実稼働しない）
                外側はグリッドのstretchで左カラムの高さまで伸びるラッパー（枠なし＝sticky可動域の確保用）。
                内側が見た目の白い枠（中身の高さにしか伸びない） */}
            <div>
            <div ref={applyPanelRef} className="job-apply-panel" style={{
              position:"sticky", background:"#fff", border:"1px solid #EBEBEB",
              borderRadius:16, padding:"20px", marginBottom:5,
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

              {/* CTAボタン（募集終了・未応募なら「募集終了」表示で押下不可） */}
              <button
                onClick={hideApply ? undefined : applyBtnOnClick}
                disabled={hideApply || applying || applyBtnDisabled}
                className="btn-primary f-sans"
                style={{ width:"100%", padding:"16px", fontSize:15, fontWeight:700, borderRadius:14, ...(hideApply ? { background:"#EBEBEB", color:"#717171" } : applyBtnStyle) }}
              >{hideApply ? closedLabel : applyBtnLabel}</button>
              <p style={{ fontSize:12, color:"#888", textAlign:"center", marginTop:8 }}>お支払いは現金手渡し、作業当日のお支払いとなります。</p>

              {/* 補足文 */}
              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", textAlign:"center", margin:0, marginTop:10 }}>
                まだ応募は確定しません。正確な金額は面接後に決定します。
              </p>

            </div>
            </div>
          </div>

          {/* 地図（集合場所のおおよその範囲・円のみ） */}
          <div style={{ width:"100%", marginBottom:5 }}>
            <JobLocationMap
              lat={selectedJob.lat}
              lng={selectedJob.lng}
              radius={selectedJob.radius}
              label={selectedJob.region}
            />
          </div>

          {/* 開催期間カレンダー（地図の下・全幅・PCのみ表示。スマホはフッター📅からモーダル） */}
          {selectedJob.dateStart && (
            <div className="calendar-below-map" style={{ marginBottom:5 }}>
              <CalendarView start={selectedJob.dateStart} end={selectedJob.dateEnd} readOnly={true} />
            </div>
          )}

          {/* 農園紹介セクションはページから削除（2026-07-16）。内容は農家カードのアイコン・名前タップのボックスに集約 */}

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
              <div style={{ marginBottom:5 }}>
                {/* ヘッダー: 左=農家プロフィール(控えめ) / 中央=星評価(主役) */}
                <div className="review-header-row" style={{ marginBottom:24 }}>
                  {/* 左: 農家プロフィール（控えめ・既存プロフィール行を縮小） */}
                  <div className="review-header-profile" style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{
                      width:32, height:32, borderRadius:"50%", background:"#E6F7EF", flexShrink:0,
                      display:"flex", alignItems:"center", justifyContent:"center", fontSize:16,
                    }}>🧑‍🌾</div>
                    <div>
                      <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:0 }}>{selectedJob.farmerName}</p>
                      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:0 }}>{selectedJob.farmerBadge}・{selectedJob.farmerYears}</p>
                    </div>
                  </div>

                  {/* 中央: 星評価（主役・特大） */}
                  <div className="review-header-stars">
                    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:8 }}>
                      <span style={{ fontSize:36, color:"#00A86B" }}>★</span>
                      <span className="f-mono" style={{ fontSize:36, fontWeight:800, color:"#222" }}>{selectedJob.farmerRating}</span>
                    </div>
                    <p className="f-sans" style={{ fontSize:15, color:"#717171", margin:0, marginTop:2 }}>{selectedJob.farmerReviewCount}件のレビュー</p>
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
                      <p style={{ margin:0, marginBottom:6, fontSize:15, color:"#00A86B", letterSpacing:1 }}>
                        {"★".repeat(review.stars)}{"☆".repeat(5 - review.stars)}
                      </p>
                      <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.7, margin:0 }}>{review.text}</p>
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
          <div className="job-detail-more-jobs" style={{ marginBottom:20 }}>
            <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:12 }}>その他の求人</h3>
            {jobList.filter(job => job.id !== selectedJob.id).length === 0 ? (
              <p className="f-sans" style={{ fontSize:15, color:"#999", padding:"20px 0" }}>現在、他の求人はありません。</p>
            ) : (
            <Carousel
              className="carousel-scroll"
              style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:4 }}
            >
              {jobList.filter(job => job.id !== selectedJob.id).map(job => (
                <JobCard key={job.id} job={job} variant="related" saved={savedIds.has(job.id)} onToggleSave={toggleSave} />
              ))}
            </Carousel>
            )}
          </div>

          {/* 通報リンク（目立たせない・ログイン時のみ） */}
          {me && (
            <div style={{ textAlign:"center", marginTop:8 }}>
              <button onClick={()=>setShowReportModal(true)} className="f-sans" style={{
                background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                fontSize:12, color:"#717171", textDecoration:"underline", padding:4,
              }}>⚑ この求人を報告する</button>
            </div>
          )}
          </>)}
        </div>
      </>)}

      {/* PC専用：下固定の応募バー（応募パネルが画面外に出たら表示。スマホはCSSでdisplay:none）。募集終了かつ未応募では非表示（2026-07-24） */}
      {selectedJob && showApplyBar && !isOwnJob && !hideApply && (
        <div className="pc-apply-bar" style={{
          position:"fixed", bottom:0, left:0, right:0, zIndex:500,
          background:"#fff", borderTop:"1px solid #EBEBEB",
          padding:"16px 24px", boxShadow:"0 -4px 16px rgba(0,0,0,0.08)",
          alignItems:"center", justifyContent:"space-between", gap:24,
        }}>
          <span className="f-mono" style={{ fontSize:18, fontWeight:800, color:"#222" }}>{payLabel(selectedJob)}</span>
          <button
            onClick={applyBtnOnClick}
            disabled={applying || applyBtnDisabled}
            className="btn-primary f-sans"
            style={{ padding:"14px 32px", fontSize:15, fontWeight:700, borderRadius:14, whiteSpace:"nowrap", ...applyBtnStyle }}
          >{applyBtnLabel}</button>
        </div>
      )}

      {/* 求人詳細（スマホ専用）：常時表示の下部応募フッター。スクロール中は非表示(CSS)。自分の求人には出さない（2026-07-22）。
          募集終了（満員／期間終了）かつ未応募の求人では、この日程・募集ボタンの下部フッター自体を非表示にする（2026-07-24） */}
      {selectedJob && !isOwnJob && !hideApply && (
        <div className="mobile-apply-bar" style={{ boxShadow:"0 -4px 16px rgba(0,0,0,0.08)" }}>
          {/* 並び入れ替え（2026-07-16）：日給＋応募ボタンが上・注記が下 */}
          {/* バランス修正（2026-07-24）：報酬は1行固定(flexShrink:0)・ボタンは残り幅(flex:1)で長いラベル
              （「承認されました — チャットを開く」等）は2行に折り返す＝画面から見切れない */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
            <span className="f-mono" style={{ fontSize:16, fontWeight:800, color:"#222", flexShrink:0, whiteSpace:"nowrap" }}>{payLabel(selectedJob)}</span>
            <button
              onClick={applyBtnOnClick}
              disabled={applying || applyBtnDisabled}
              className="btn-primary f-sans"
              style={{ flex:1, minWidth:0, padding:"12px 12px", fontSize:14, fontWeight:700, borderRadius:14, lineHeight:1.35, textAlign:"center", ...applyBtnStyle }}
            >{applyBtnLabel}</button>
          </div>
          <p className="f-sans" style={{ fontSize:11, color:"#888", textAlign:"center", margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            応募しても即採用ではなく、面接後に決まります
          </p>
        </div>
      )}

      {/* 応募確認ボックス（2026-07-18）：応募ボタンタップで展開。承認制の説明＋下部に「戻る」「応募する」。
          意匠はお知らせボックスの規格（左詰め・緑太縁3px・タイトルジャンプ・横線・上限30px/下限フッター+40px・本文18） */}
      {applyConfirmOpen && selectedJob && (
        <div onClick={()=>setApplyConfirmOpen(false)} className="cb-box-overlay" style={{ zIndex:9000 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            <button onClick={()=>setApplyConfirmOpen(false)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text="応募の確認" /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            {/* 承認の流れ（①プロフィール確認②判断③承認決定）のインフォグラフィック＝応募前に承認制であることを伝える */}
            <img src="/apply-approval-flow.jpg" alt="承認の流れ：応募者のプロフィールを見て、承認するか決めます" style={{ display:"block", width:"100%", borderRadius:12 }} />
            <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:"14px 0 0" }}>
              応募はまだ採用ではありません。承認前であれば、返事待ちページからいつでも取り消せます。
            </p>
            {isPeriodJob ? (
              /* 期間求人：来られる日を宣言してから応募（いつでもOK=1タップ／特定日=複数選択） */
              <div style={{ marginTop:18 }}>
                <div style={{ height:1, background:"#E5E5E5", margin:"0 0 16px" }} />
                <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 4px" }}>来られる日を選んでください</p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 14px", lineHeight:1.6 }}>この求人は期間募集です。来られる日を農家に伝えてから応募します。</p>
                {/* ⭕ 期間中いつでもOK＝1タップで即応募 */}
                <button onClick={()=>{ applyAvailRef.current = "any"; setApplyConfirmOpen(false); handleApply(); }} disabled={applying} className="f-sans" style={{ width:"100%", padding:"16px", fontSize:16, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:14, cursor:"pointer", marginBottom:16, opacity: applying ? 0.6 : 1 }}>⭕ 期間中いつでもOK</button>
                <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", margin:"0 0 12px" }}>または、来られる日を選ぶ</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
                  {periodDays.map(d => {
                    const on = applyDates.includes(d);
                    return (
                      <button key={d} onClick={()=>setApplyDates(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])} className="f-sans" style={{ padding:"9px 12px", fontSize:13, fontWeight:700, borderRadius:20, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{calFmtDate(d)}</button>
                    );
                  })}
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>setApplyConfirmOpen(false)} className="f-sans" style={{ flex:1, padding:"14px", fontSize:14, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>戻る</button>
                  <button onClick={()=>{ if (applyDates.length===0) return; applyAvailRef.current = [...applyDates].sort(); setApplyConfirmOpen(false); handleApply(); }} disabled={applying || applyDates.length===0} className="btn-primary f-sans" style={{ flex:2, padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, opacity: (applying || applyDates.length===0) ? 0.5 : 1, cursor: applyDates.length===0 ? "not-allowed" : "pointer" }}>{applying ? "送信中..." : `この日程で応募する${applyDates.length>0 ? `（${applyDates.length}日）` : ""}`}</button>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", gap:8, marginTop:18 }}>
                <button onClick={()=>setApplyConfirmOpen(false)} className="f-sans" style={{ flex:1, padding:"14px", fontSize:14, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>戻る</button>
                <button onClick={()=>{ applyAvailRef.current = null; setApplyConfirmOpen(false); handleApply(); }} disabled={applying} className="btn-primary f-sans" style={{ flex:2, padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, opacity: applying ? 0.6 : 1 }}>{applying ? "送信中..." : "応募する"}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* きっかけアンケート（初回いいね時・2026-07-24）：スキップ導線なし（10秒・一度きり・いいね限定のゲート）。
          応募・Q&A・チャットには絶対にゲートを置かない＝コア動作は永久に無料通行 */}
      {surveyJob && (
        <div style={{ position:"fixed", inset:0, zIndex:10050, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"22px 20px", maxWidth:460, width:"100%", maxHeight:"88vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 4px" }}>はじめてのいいねの前に</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 18px", lineHeight:1.7 }}>10秒だけ教えてください。今後の運営の参考にします。</p>

            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 8px" }}>Q1. このサイトをどこで知りましたか？</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom: surveySource==="その他" ? 8 : 18 }}>
              {SURVEY_SOURCES.map(s => (
                <button key={s} onClick={()=>setSurveySource(s)} className="f-sans" style={{ padding:"8px 14px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer", border:"1px solid "+(surveySource===s?"#00A86B":"#EBEBEB"), background: surveySource===s?"#E6F7EF":"#F7F7F7", color: surveySource===s?"#00A86B":"#717171" }}>{s}</button>
              ))}
            </div>
            {surveySource==="その他" && (
              <input value={surveySourceOther} onChange={e=>setSurveySourceOther(e.target.value)} placeholder="よければ一言（任意）" className="field f-sans" style={{ fontSize:14, marginBottom:18 }} />
            )}

            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 8px" }}>Q2. どんなふうに使いたいですか？（複数選択可）</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom: surveyReasons.includes("その他") ? 8 : 20 }}>
              {SURVEY_REASONS.map(s => (
                <button key={s} onClick={()=>toggleSurveyReason(s)} className="f-sans" style={{ padding:"8px 14px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer", border:"1px solid "+(surveyReasons.includes(s)?"#00A86B":"#EBEBEB"), background: surveyReasons.includes(s)?"#E6F7EF":"#F7F7F7", color: surveyReasons.includes(s)?"#00A86B":"#717171" }}>{s}</button>
              ))}
            </div>
            {surveyReasons.includes("その他") && (
              <input value={surveyReasonOther} onChange={e=>setSurveyReasonOther(e.target.value)} placeholder="よければ一言（任意）" className="field f-sans" style={{ fontSize:14, marginBottom:20 }} />
            )}

            <button onClick={submitSurvey} disabled={surveySaving || !surveySource} className="btn-primary f-sans" style={{ width:"100%", padding:"15px", fontSize:15, fontWeight:700, borderRadius:12, opacity:(surveySaving||!surveySource)?0.5:1 }}>{surveySaving ? "送信中..." : "送信していいねする"}</button>
          </div>
        </div>
      )}
      {/* 初いいねボックス（2026-07-19）：各求人の最初のいいねで1回だけ展開。
          意匠はお知らせボックスの規格（左詰め・緑太縁3px・タイトルジャンプ・横線・本文18・リンク18）。
          求人カードに❤️が付く動作（cb-heart-pop）＋「いいね一覧を見る →」リンク */}
      {likeDone && (
        <div onClick={()=>setLikeDone(null)} className="cb-box-overlay" style={{ zIndex:9000 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            <button onClick={()=>setLikeDone(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2 }}>✕</button>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text="いいねしました！" /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            {/* いいねした求人のカード：右上に❤️が付く動作（一覧カードの♡ボタンと同じ位置） */}
            <div style={{ position:"relative", margin:"6px 0 14px" }}>
              <div style={{ border:"1px solid #EBEBEB", borderRadius:12, overflow:"hidden", background:"#fff" }}>
                {(() => {
                  const p0 = likeDone.photos?.[0];
                  const src = typeof p0 === "string" ? p0 : p0?.url;
                  const icon = CROP_OPTIONS.find(c => likeDone.crop && likeDone.crop.includes(c.name))?.icon || "🌱";
                  return src
                    ? <img src={src} alt="" style={{ width:"100%", height:150, objectFit:"cover", display:"block" }} />
                    : <div style={{ width:"100%", height:150, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44 }}>{icon}</div>;
                })()}
                <div style={{ padding:"10px 14px 12px" }}>
                  <p className="f-sans" style={{ fontSize:15, fontWeight:600, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[likeDone.crop, likeDone.task].filter(Boolean).join(" ") || "求人"}</p>
                  {likeDone.region && <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"2px 0 0" }}>{likeDone.region}</p>}
                </div>
              </div>
              <span className="cb-heart-pop" style={{ position:"absolute", top:8, right:8, width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,0.92)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, boxShadow:"0 1px 4px rgba(0,0,0,0.18)" }}>❤️</span>
            </div>
            <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0 }}>
              いいねした求人は、いつでも一覧から見返せます。
            </p>
            <button onClick={()=>{ setLikeDone(null); window.location.hash="/saved"; }} className="f-sans" style={{ marginTop:16, background:"none", border:"none", borderBottom:"2px solid #00A86B", padding:"0 0 2px", fontSize:18, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>いいね一覧を見る →</button>
          </div>
        </div>
      )}

      {/* 開催期間カレンダー📅の浮遊ボタンは削除（2026-07-24・誰も展開しないため）。開催期間はPC地図下のカレンダー・主要情報カードで確認できる */}

      {/* 危険箇所の写真ライトボックス（全画面拡大） */}
      {dangerLightbox && (
        <div onClick={() => setDangerLightbox(null)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", animation:"fadeIn .2s ease", padding:16,
        }}>
          <button onClick={e => { e.stopPropagation(); setDangerLightbox(null); }} style={{
            position:"absolute", top:20, right:20,
            width:40, height:40, borderRadius:"50%",
            background:"rgba(255,255,255,0.15)", border:"none",
            color:"#fff", fontSize:22, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>✕</button>
          <img src={dangerLightbox} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}

      {/* 農園紹介モーダル（代表よりカードのタップで展開。お題＋代表よりの全文） */}
      {farmIntroOpen && empEmployer && (() => {
        const topics = farmIntroTopics(empEmployer);
        return (
          <div onClick={() => setFarmIntroOpen(false)} style={{
            position:"fixed", inset:0, zIndex:10000,
            background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none",
          }}>
            <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{
              position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))",
              maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, padding:20,
              overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y",
            }}>
              <button onClick={() => setFarmIntroOpen(false)} style={{
                position:"absolute", top:12, right:12,
                width:36, height:36, borderRadius:"50%",
                background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer",
              }}>✕</button>
              <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 16px", paddingRight:40 }}>
                {empEmployer.nickname ? `${empEmployer.nickname}の農園紹介` : "農園紹介"}
              </h3>
              {/* まず信頼カード（農園紹介の下のボックス）→次に農園紹介（2026-07-16） */}
              {(farmHostQa(empEmployer).length > 0 || !!empEmployer.interaction_style || !!(empTrust && empTrust.ok)) && (
                <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:16 }}>
                  <FarmerTrustCard profile={empEmployer} trust={empTrust} onTapOpenJobs={() => openPastJobs("open")} onTapExperience={() => openPastJobs("ended")} />
                </div>
              )}
              {/* 過去の求人ボックス（受け入れ実績タップで展開・公開中/終了の帯・タップで詳細へ） */}
              {pastJobsOpen && (
                <div onClick={()=>setPastJobsOpen(false)} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none" }}>
                  <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, padding:20, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}>
                    <button onClick={()=>setPastJobsOpen(false)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", zIndex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                    <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 16px", paddingRight:40 }}>{empEmployer.nickname ? `${empEmployer.nickname}さんの求人` : "この農家の求人"}</h3>
                    {pastJobs === null ? (
                      <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中...</p>
                    ) : pastJobs.length === 0 ? (
                      <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>
                        {(empTrust?.ok && empTrust.completed_hires > 0) ? "過去に受け入れた求人は、掲載を終了しています" : "初めての求人です"}
                      </p>
                    ) : (() => {
                      // 求人を「終了（掲載日程が過ぎた）／公開中」で仕分けし、すべて/公開中/終了タブで絞る（2026-07-23）
                      const today = ymdLocal(new Date());
                      const withEnded = pastJobs.map(r => {
                        const endYmd = r.date_end || r.date_start;
                        return { r, ended: !!endYmd && endYmd < today };
                      });
                      const openList = withEnded.filter(x => !x.ended);
                      const endedList = withEnded.filter(x => x.ended);
                      const tabs = [
                        { key:"all", label:"すべて", n: withEnded.length },
                        { key:"open", label:"公開中", n: openList.length },
                        { key:"ended", label:"過去の実績", n: endedList.length },
                      ];
                      const shown = pastJobsTab === "open" ? openList : pastJobsTab === "ended" ? endedList : withEnded;
                      // タップした求人を最前列へ移動し、概要をタブ内で展開（2026-07-24）
                      const focusIdx = pastJobsFocus != null ? shown.findIndex(x => x.r.job_number === pastJobsFocus) : -1;
                      const ordered = focusIdx >= 0 ? [shown[focusIdx], ...shown.slice(0, focusIdx), ...shown.slice(focusIdx + 1)] : shown;
                      const fmtCnt = (v) => (v > 0 ? `${v}人` : "ー"); // なければ「ー」で統一
                      return (
                      <>
                      <div style={{ display:"flex", gap:6, marginBottom:14, borderBottom:"1px solid #EBEBEB" }}>
                        {tabs.map(t => (
                          <button key={t.key} onClick={()=>{ setPastJobsTab(t.key); setPastJobsFocus(null); }} className="f-sans" style={{
                            background:"none", border:"none", cursor:"pointer", padding:"6px 6px 10px",
                            fontSize:13, fontWeight: pastJobsTab===t.key ? 700 : 500,
                            color: pastJobsTab===t.key ? "#00A86B" : "#999",
                            borderBottom: pastJobsTab===t.key ? "2px solid #00A86B" : "2px solid transparent",
                            marginBottom:-1,
                          }}>{t.label}{t.n > 0 ? ` ${t.n}` : ""}</button>
                        ))}
                      </div>
                      {shown.length === 0 ? (
                        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"28px 0" }}>
                          {pastJobsTab==="ended" ? "まだ過去の実績はありません" : pastJobsTab==="open" ? "公開中の求人はありません" : "求人がありません"}
                        </p>
                      ) : (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
                        {ordered.map(({ r, ended }) => {
                          const photo = r.photos && r.photos[0] ? (typeof r.photos[0] === "string" ? r.photos[0] : r.photos[0]?.url) : null;
                          const isFocus = focusIdx >= 0 && r.job_number === pastJobsFocus;
                          if (isFocus) {
                            // 展開概要カード：最前列（グリッド全幅）。人数は集計値のみ・0は「ー」
                            const c = pastJobsCounts[r.job_number] || {};
                            return (
                              <div key={r.job_number} style={{ gridColumn:"1 / -1", position:"relative", background:"#F7F7F7", borderRadius:12, padding:10, display:"flex", gap:10, alignItems:"flex-start" }}>
                                <button onClick={()=>setPastJobsFocus(null)} aria-label="閉じる" style={{ position:"absolute", top:6, right:6, width:26, height:26, borderRadius:"50%", background:"#fff", border:"none", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                                <div style={{ width:84, height:84, borderRadius:10, overflow:"hidden", flexShrink:0, background:"#EBEBEB", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                                  {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", ...(ended ? { filter:"grayscale(40%)" } : {}) }} /> : "🌾"}
                                </div>
                                <div style={{ flex:1, minWidth:0, paddingRight:24 }}>
                                  <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"0 0 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                    {[r.crop, r.task].filter(Boolean).join(" ") || ("求人 #" + r.job_number)}
                                    {pastJobsTab === "all" && <span className="f-sans" style={{ fontSize:10, fontWeight:600, color: ended ? "#9E9E9E" : "#00A86B", marginLeft:6 }}>{ended ? "終了" : "公開中"}</span>}
                                  </p>
                                  {r.date_label && <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 6px" }}>{r.date_label}</p>}
                                  <p className="f-sans" style={{ fontSize:12, color:"#222", margin:"0 0 8px" }}>
                                    応募 {fmtCnt(c.applied)}・承認 {fmtCnt(c.approved)}・採用 {fmtCnt(c.hired)}
                                  </p>
                                  <button onClick={()=>openPastJob(r)} className="f-sans" style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                                    {r.job_number === selectedJob.id ? "この求人を見ています" : "求人ページを見る →"}
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <button key={r.job_number} onClick={()=>setPastJobsFocus(r.job_number)} className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#F7F7F7", border:"none", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                              <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, overflow:"hidden" }}>
                                {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", ...(ended ? { filter:"grayscale(40%)" } : {}) }} /> : "🌾"}
                                {/* 状態帯は「すべて」タブでのみ表示。公開中/過去の実績タブは絞り込み済みで帯が冗長（2026-07-24） */}
                                {pastJobsTab === "all" && <StatusRibbon label={ended ? "終了" : "公開中"} color={ended ? "#9E9E9E" : "#00A86B"} />}
                                {/* 概要は写真の上に重ねる。黒の半透明グラデで写真の明暗を問わず白文字を読ませる（2026-07-23） */}
                                <div style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))", pointerEvents:"none" }}>
                                  <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#fff", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.5)" }}>{[r.crop, r.task].filter(Boolean).join(" ") || ("求人 #" + r.job_number)}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      )}
                      </>
                      );
                    })()}
                  </div>
                </div>
              )}
              {empEmployer.owner_comment && empEmployer.owner_comment.trim() && (
                <div style={{ background:"#F7F7F7", borderRadius:16, padding:"16px", marginBottom:16 }}>
                  <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>代表より</p>
                  <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{empEmployer.owner_comment}</p>
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {topics.map((t, i) => (
                  <div key={i} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px" }}>
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>{t.label}</p>
                    <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{t.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 通報モーダル：差し戻しモーダル(759e54c)と同じ視覚文法・語彙 */}
      {showReportModal && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%" }}>
            {reportDone ? (
              <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0", margin:0 }}>報告を受け付けました。運営が確認します</p>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>この求人を報告する</p>
                <div style={{ display:"grid", gap:8, marginBottom:8 }}>
                  <select value={reportTargetField} onChange={e=>setReportTargetField(e.target.value)} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" }}>
                    <option value="">対象項目を選択</option>
                    {REPORT_TARGET_FIELDS.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={reportIssueType} onChange={e=>setReportIssueType(e.target.value)} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" }}>
                    <option value="">問題の種類を選択</option>
                    {REPORT_ISSUE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  <textarea
                    value={reportDetail}
                    onChange={e=>setReportDetail(e.target.value)}
                    placeholder="詳細（任意）"
                    rows={4}
                    className="f-sans"
                    style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }}
                  />
                </div>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>報告は運営のみが確認します。求人の掲載者にはあなたの情報は伝わりません</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={closeReportModal} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button
                    onClick={submitReport}
                    disabled={reportSending || !reportTargetField || !reportIssueType}
                    className="f-sans"
                    style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background: (reportTargetField && reportIssueType) ? "#E24B4A" : "#EBEBEB", color: (reportTargetField && reportIssueType) ? "#fff" : "#717171", border:"none", borderRadius:10, cursor:"pointer" }}
                  >{reportSending ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* プロフィールゲート：softは応募を止めず誘導するだけ／hardはサーバー側の必須条件未達（プロフィールを書くのみ） */}
      {profileGate && (
        <div style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.4)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:16,
        }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:360, width:"100%", textAlign:"center" }}>
            {profileGate.mode === "hard" ? (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>応募には自己紹介が必要です</p>
                <div style={{ display:"flex", justifyContent:"center", gap:16, marginBottom:16 }}>
                  <span className="f-sans" style={{ fontSize:15, fontWeight:600, color: profileGate.hasNickname ? "#00A86B" : "#E24B4A" }}>
                    ニックネーム {profileGate.hasNickname ? "✓" : "✗"}
                  </span>
                  <span className="f-sans" style={{ fontSize:15, fontWeight:600, color: profileGate.qaAnswered >= profileGate.qaRequired ? "#00A86B" : "#717171" }}>
                    質問への回答 {profileGate.qaAnswered}/{profileGate.qaRequired}
                  </span>
                </div>
                <p className="f-sans" style={{ fontSize:15, color:"#717171", lineHeight:1.8, marginBottom:20 }}>あなたのことが伝わると、農家は安心して承認できます。</p>
                <button
                  onClick={() => { setApplyReturn(selectedJob.id); setProfileGate(null); window.location.hash = "/profile/worker/profile"; }}
                  className="f-sans"
                  style={{ width:"100%", padding:"12px", background:"#00A86B", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:700, cursor:"pointer" }}
                >プロフィールを書く</button>
              </>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:8 }}>プロフィールがまだ空です</p>
                <p className="f-sans" style={{ fontSize:15, color:"#717171", lineHeight:1.8, marginBottom:20 }}>自己紹介があると、農家に安心して承認してもらえます。</p>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <button
                    onClick={() => { setApplyReturn(selectedJob.id); setProfileGate(null); window.location.hash = "/profile/worker/profile"; }}
                    className="f-sans"
                    style={{ padding:"12px", background:"#00A86B", color:"#fff", border:"none", borderRadius:12, fontSize:14, fontWeight:700, cursor:"pointer" }}
                  >プロフィールを書く</button>
                  <button
                    onClick={() => { setProfileGate(null); doApply(); }}
                    className="f-sans"
                    style={{ padding:"12px", background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, fontSize:14, fontWeight:600, cursor:"pointer" }}
                  >このまま応募する</button>
                </div>
              </>
            )}
          </div>
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

// サービス提供範囲。展開時はこの配列に都道府県を追加するだけでよい
const ALLOWED_PREFECTURES = ["徳島県"];
const isAllowedPrefecture = (pref) => ALLOWED_PREFECTURES.includes((pref || "").trim());

// 時給・日給が最低賃金を下回っていないかを判定する純関数
// workHours: 勤務時間（終了時刻 - 開始時刻、時間単位）。6時間超で休憩45分、8時間超で休憩60分を控除した実労働時間で日給を時給換算する。
function validateMinWage(hourly, daily, workHours, minWage) {
  // 最低賃金が取得できていない場合は検証不能。安全側に倒して掲載を止める
  if (!minWage || minWage <= 0) {
    return { hourlyViolation: hourly > 0, dailyViolation: daily > 0, unknownWage: true };
  }
  const hourlyViolation = hourly > 0 && hourly < minWage;
  let dailyViolation = false;
  if (daily > 0 && workHours > 0) {
    const breakHours = workHours > 8 ? 1 : workHours > 6 ? 0.75 : 0;
    const actualHours = workHours - breakHours;
    if (actualHours > 0 && daily / actualHours < minWage) dailyViolation = true;
  }
  return { hourlyViolation, dailyViolation, unknownWage: false };
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
      // 復元条件：①ログイン往復フラグ ②URLが求人フロー(#/work/new*)のままのリロード（2026-07-14追加）
      // ②が無いと、確認ページ等でリロードした際に入力が全て白紙に戻る（stateは復元されずURLだけ残る）
      const _h = window.location.hash.replace(/^#\/?/, "");
      const _inNewJobFlow = _h === "work/new" || _h.startsWith("work/new/");
      if (localStorage.getItem('postLoginReturnTo') === 'landingFlowFarmerConfirm' || _inNewJobFlow) {
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
  const [farmerTown,        setFarmerTown]        = useState(d.farmerTown ?? "");
  const [farmerAddr,        setFarmerAddr]        = useState(d.farmerAddr ?? "");
  const zipRef   = useRef(null);
  const prefRef  = useRef(null);
  const cityRef  = useRef(null);
  const townRef  = useRef(null);
  const addrRef  = useRef(null);
  const [minWage, setMinWage] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!farmerPref) { setMinWage(null); return; }
    (async () => {
      try {
        const { data } = await supabase.rpc('get_minimum_wage', { p_prefecture: farmerPref });
        if (!cancelled) setMinWage(typeof data === 'number' ? data : null);
      } catch { if (!cancelled) setMinWage(null); }
    })();
    return () => { cancelled = true; };
  }, [farmerPref]);
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
        // 町域（address3）まで自動入力（2026-07-16）。町域・番地は個別に手直しできる
        setFarmerTown(r.address3 || "");
        setFarmerRegion(r.address1 + r.address2 + (r.address3 || ""));
        setZipError("");
        // 町域が取れたら番地欄へ、取れなければ町域欄へフォーカス
        setTimeout(() => { (r.address3 ? addrRef : townRef).current?.focus(); }, 0);
      } else {
        setZipError("郵便番号が見つかりませんでした");
      }
    } catch {
      setZipError("検索に失敗しました。通信環境をご確認ください");
    }
    setZipSearching(false);
  };
  useEffect(() => {
    const digits = farmerZip.replace(/[^0-9]/g, "");
    if (digits.length === 7) { searchZip(); }
  }, [farmerZip]);
  const [farmerCropPill,    setFarmerCropPill]    = useState(d.farmerCropPill ?? ""); // 作物ピル選択
  const [farmerCropText,    setFarmerCropText]    = useState(d.farmerCropText ?? ""); // 作物自由入力
  const [farmerTaskPill,    setFarmerTaskPill]    = useState(d.farmerTaskPill ?? ""); // 作業ピル選択
  const [farmerTaskText,    setFarmerTaskText]    = useState(d.farmerTaskText ?? ""); // 作業自由入力
  const [farmerWanted,      setFarmerWanted]      = useState(d.farmerWanted ?? "");
  const [farmerPayType,     setFarmerPayType]     = useState(d.farmerPayType ?? "");
  const [payTiming,         setPayTiming]         = useState("即日払い（作業当日）");
  const [payMethod,         setPayMethod]         = useState("現金手渡し");
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
  const [jobPhotos, setJobPhotos] = useState(normalizePhotos(d.jobPhotos)); // 旧形式draft対策（真っ白バグ・2026-07-16）
  // 写真の並び替え（2026-07-19）：確認ページで隣と入れ替え。先頭が求人カードのカバー
  const movePhoto = (i, dir) => setJobPhotos(prev => { const j = i + dir; if (j < 0 || j >= prev.length) return prev; const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next; });
  const [jobDescription, setJobDescription] = useState(d.jobDescription ?? "");
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [photoCaptionsOpen, setPhotoCaptionsOpen] = useState(false); // step8「写真ごとに説明」ポップアップ（2026-07-16）
  const [photoUploading, setPhotoUploading] = useState(false);
  const [jobDangerPlaces, setJobDangerPlaces] = useState((d.jobDangerPlaces ?? [{ icon:"⚠️", label:"", desc:"" }, { icon:"⚠️", label:"", desc:"" }]).map(p => ({ photos:[], ...p })));
  const [jobDangerTasks, setJobDangerTasks] = useState((d.jobDangerTasks ?? [{ icon:"⚠️", label:"", desc:"" }, { icon:"⚠️", label:"", desc:"" }]).map(t => ({ photos:[], ...t })));
  // 2つ目に中身があれば最初から展開（2026-07-16）：閉じたままだと編集も削除もできない見えない項目になる
  const [showPlace2, setShowPlace2] = useState(() => dangerHasSecond(d.jobDangerPlaces));
  const [showTask2, setShowTask2] = useState(() => dangerHasSecond(d.jobDangerTasks));
  const [confActiveSlide, setConfActiveSlide] = useState(0);
  const confScrollRef = useRef(null);
  // 確認ページ写真のループ（2026-07-16・詳細ページと同方式）：[最後,...実写真,最初]のクローンを並べ、端に静止したら実体位置へ瞬間ジャンプ
  const confLooped = jobPhotos.length > 1;
  const handleConfPhotoScroll = (e) => {
    const el = e.currentTarget;
    const w = el.clientWidth;
    if (!w) return;
    const idx = Math.round(el.scrollLeft / w);
    if (!confLooped) { setConfActiveSlide(idx); return; }
    const n = jobPhotos.length;
    const settled = Math.abs(el.scrollLeft - idx * w) < 2;
    if (settled && idx === 0) { el.scrollLeft = n * w; setConfActiveSlide(n - 1); return; }
    if (settled && idx === n + 1) { el.scrollLeft = w; setConfActiveSlide(0); return; }
    setConfActiveSlide(((idx - 1) % n + n) % n);
  };
  useEffect(() => {
    if (step !== 11 || !confLooped) return;
    const el = confScrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollLeft = el.clientWidth; }); // 初期位置＝実写真1枚目（クローンの次）
    setConfActiveSlide(0);
  }, [step, confLooped]); // eslint-disable-line react-hooks/exhaustive-deps
  const captionTextareaRef = useRef(null);
  const flowScrollRef = useRef(null); // スクロール領域（step遷移時に先頭へ戻す用）

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
  const { hourlyViolation, dailyViolation, unknownWage } = validateMinWage(hourlyWage, dailyWage, workHours, minWage);
  const calcFarmerMaxPay = () => {
    const days   = jobDateStart ? Math.floor(((jobDateEnd || jobDateStart) - jobDateStart) / 86400000) + 1 : 0;
    const breakH = (Number(String(breakTime).replace(/[^\d]/g,"")) || 0) / 60;
    const netH   = Math.max(workHours - breakH, 0);
    return hourlyWage > 0 ? Math.round(hourlyWage * netH * days) : dailyWage > 0 ? dailyWage * days : 0;
  };
  const [jobExp,            setJobExp]            = useState(d.jobExp ?? "");
  const [beginnerOk,        setBeginnerOk]        = useState(d.beginnerOk ?? false); // 🌱はじめての人も歓迎 → jobs.beginner_ok
  const [instantApproveRepeat, setInstantApproveRepeat] = useState(d.instantApproveRepeat ?? false); // 🌟また呼びたい即決 → jobs.instant_approve_repeat（効果は自分の求人×自分が評価した相手のみ・労働局確認済み）
  const [flagInfoOpen, setFlagInfoOpen] = useState(null); // 「はじめてOKとは？」「リピート即決とは？」の説明ボックス（2026-07-18）
  const [jobPerks, setJobPerks] = useState(d.jobPerks ?? null); // この求人だけの待遇上書き → jobs.perks（NULL=プロフィールの待遇・2026-07-18）
  const [experiencedPreferred, setExperiencedPreferred] = useState(d.experiencedPreferred ?? false); // 💪経験者優遇 → jobs.experienced_preferred（2026-07-18・必要経験の選択式は撤回）
  const [jobSaving, setJobSaving] = useState(false);
  const [publishChecks, setPublishChecks] = useState([false, false, false, false]);
  const [publishModal, setPublishModal] = useState(false); // 確認ページ下部ナビ「掲載する」→チェックリストモーダル
  // 掲載前の日程ガード（2026-07-24）：日程未設定のまま掲載に進ませない（終了求人コピー→日程空で複製、の受け皿）
  const openPublish = () => {
    if (!jobDateStart) { alert("作業日程が未設定です。「日程」から新しい日を選んでから掲載してください。"); setReturnToConfirm(true); setStep(4); return; }
    setPublishModal(true);
  };
  const [confEmployer, setConfEmployer] = useState(null); // 確認ページ用：本人の雇い手プロフィール（詳細ページempEmployerと同じデータ源employer_profiles）
  const [confProfileOpen, setConfProfileOpen] = useState(false); // 農家プロ未入力時：カードタップで編集ボックス展開（2026-07-16）
  // 待遇の求人ごと変更（2026-07-18）：確認ページの待遇タップで編集ボックス。
  // 「この求人のみ」＝jobPerksに保持→jobs.perksへ保存（求人審査で内容確認）／「保存」＝プロフィールにも反映
  // （自由記述3項目=送迎範囲・通勤手当の内容・農家負担の上限はtexts_pending経由＝運営承認後に公開・憲法5条）
  const [perksEditOpen, setPerksEditOpen] = useState(false);
  const [perkDraft, setPerkDraft] = useState(null);
  const [perkSaving, setPerkSaving] = useState(false);
  const openPerksEdit = () => {
    const base = jobPerks ? { ...(confEmployer || {}), ...jobPerks } : (confEmployer || {});
    setPerkDraft({
      has_transport: !!base.has_transport, transport_area: base.transport_area || "",
      has_parking: !!base.has_parking, parking_capacity: base.parking_capacity || "",
      has_commute_allowance: !!base.has_commute_allowance, commute_allowance_detail: base.commute_allowance_detail || "",
      has_bonus: !!base.has_bonus,
      employer_pays_supplies: !!base.employer_pays_supplies, supplies_cap: base.supplies_cap || "",
      accessory_ok: !!base.accessory_ok,
    });
    setPerksEditOpen(true);
  };
  const savePerksToProfile = async () => {
    if (perkSaving || !perkDraft) return;
    setPerkSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setPerkSaving(false); return; }
      const { data: cur } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
      // 自由記述はtexts_pending経由（承認済み値と異なるキーだけ積む・EmployerProfileEdit.saveと同じ作法）
      const desired = {
        transport_area: perkDraft.has_transport ? (perkDraft.transport_area || "") : "",
        commute_allowance_detail: perkDraft.has_commute_allowance ? (perkDraft.commute_allowance_detail || "") : "",
        supplies_cap: perkDraft.employer_pays_supplies ? (perkDraft.supplies_cap.trim() || "") : "",
      };
      const pend = { ...((cur && cur.texts_pending) || {}) };
      Object.entries(desired).forEach(([k, v]) => {
        if (((cur && cur[k]) || "") !== v) pend[k] = v; else delete pend[k];
      });
      const payload = {
        auth_id: session.user.id,
        has_transport: perkDraft.has_transport,
        has_parking: perkDraft.has_parking,
        // parking_capacityはinteger列。「3台」等の文字が混ざっても数字だけ取り出し、空はnull（2026-07-19修正）
        parking_capacity: (() => { const n = parseInt(String(perkDraft.parking_capacity ?? "").replace(/[^0-9]/g, ""), 10); return (perkDraft.has_parking && Number.isFinite(n)) ? n : null; })(),
        has_commute_allowance: perkDraft.has_commute_allowance,
        has_bonus: perkDraft.has_bonus,
        employer_pays_supplies: perkDraft.employer_pays_supplies,
        accessory_ok: perkDraft.accessory_ok,
        texts_pending: pend,
        texts_submitted_at: Object.keys(pend).length ? new Date().toISOString() : ((cur && cur.texts_submitted_at) || null),
        // 再提出で修正依頼フラグ（赤帯）を解除（2026-07-19）
        ...(Object.keys(pend).length ? { texts_revision_requested_at: null } : {}),
      };
      const { error } = await supabase.from("employer_profiles").upsert(payload, { onConflict: "auth_id" });
      if (error) { alert("保存に失敗しました：" + error.message); setPerkSaving(false); return; }
      setJobPerks(null); // プロフィールに保存＝この求人はプロフィールの待遇に従う
      try {
        const { data: ep } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (ep) setConfEmployer(ep);
      } catch {}
      setPerksEditOpen(false);
    } catch { alert("保存に失敗しました。"); }
    setPerkSaving(false);
  };
  const [confTrust, setConfTrust] = useState(null); // 確認ページ用：登録してからの月日など（employer_trust_info）
  const [confGeo, setConfGeo] = useState(null); // 確認ページ用：住所→座標（詳細ページと同構造のJobLocationMap表示に使用）
  const [confIntroOpen, setConfIntroOpen] = useState(false); // 確認ページ用：農園紹介モーダル（詳細ページと同構造）
  const [confTrustOpen, setConfTrustOpen] = useState(false); // 確認ページ用：信頼カードのボックス展開（2026-07-16）
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
  const TOTAL = isFarmer ? 14 : 8;

  // step遷移アニメ：退場(0.4s)→step切替→入場(0.4s)＝体感0.8秒（2026-07-16）。連打はbusyガードで無視
  const [stepAnim, setStepAnim] = useState("");
  const stepAnimBusy = useRef(false);
  const animateStepChange = (applyChange, dir) => {
    if (stepAnimBusy.current) return;
    stepAnimBusy.current = true;
    setStepAnim(dir === "fwd" ? "step-out-left" : "step-out-right");
    setTimeout(() => {
      applyChange();
      setStepAnim(dir === "fwd" ? "step-in-right" : "step-in-left");
      stepAnimBusy.current = false;
    }, 400);
  };
  const goNext = () => animateStepChange(() => setStep(s => s + 1), "fwd");
  const goBack = () => animateStepChange(() => { if (step <= 1) { setStep(0); } else setStep(s => s - 1); }, "back");
  // 全stepスワイプ移動（2026-07-16）：左スワイプ=次へ（バリデーション尊重）／右スワイプ=戻る。
  // 掲載(step11→)と完了(step12)からは進めない。step1の戻りはスワイプでも不可（戻るボタン削除と整合）
  const flowSwipe = useRef(null);
  const onFlowTouchStart = (e) => { flowSwipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onFlowTouchEnd = (e) => {
    const s = flowSwipe.current;
    flowSwipe.current = null;
    if (!s || publishModal || showExitModal || photoCaptionsOpen || placeBoxOpen) return;
    if (step === 11) return; // 確認ページは横スワイプ遷移なし（2026-07-16たきと指定・写真カルーセル優先）
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // 縦スクロール優先
    if (dx < 0) {
      if (step === 11 || step === 12 || step >= TOTAL || !canGoNext) return;
      if (returnToConfirm) { setStep(11); setReturnToConfirm(false); return; }
      goNext();
    } else {
      if (step <= 1 || step === 12 || step >= TOTAL) return;
      if (returnToConfirm) { setStep(11); setReturnToConfirm(false); return; }
      goBack();
    }
  };

  // 確認ページ(step11)からの編集ジャンプ中フラグ。trueの間、共通フッターの「次へ／戻る」は
  // 通常の順送りでなく確認ページへ直帰する（Airbnb出品確認の「編集→保存して確認へ戻る」と同型）。
  const [returnToConfirm, setReturnToConfirm] = useState(false);
  useEffect(() => {
    if (step === 11) setReturnToConfirm(false); // 確認ページ到達で必ず解除（保険）
  }, [step]);

  useEffect(() => {
    if (onStepChange && role === "farmer" && step >= 1 && step <= 11) onStepChange(step);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draftJobNumber, setDraftJobNumber] = useState(_editJobNumber ?? _draftInit?.job_number ?? null);
  const [confTab, setConfTab] = useState("content"); // 確認ページの「仕事の内容/質問」タブ（第10弾）
  // 集合場所の復元元＝農家プロフィールの「作業場所」（2026-07-16・直近jobsからの復元は撤回）。未設定ならnull=ボタン非表示
  const [prevAddress, setPrevAddress] = useState(null);
  useEffect(() => {
    if (!isFarmer || step !== 3 || prevAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const { data: ep } = await supabase.from("employer_profiles")
          .select("place_zip,place_prefecture,place_city,place_town,place_address")
          .eq("auth_id", session.user.id).maybeSingle();
        if (cancelled || !ep) return;
        if ((ep.place_city || "").trim() || (ep.place_zip || "").trim() || (ep.place_address || "").trim()) {
          setPrevAddress({ zip: ep.place_zip, prefecture: ep.place_prefecture, city: ep.place_city, town: ep.place_town, address: ep.place_address });
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [step, isFarmer]); // eslint-disable-line react-hooks/exhaustive-deps
  // 農家プロの作業場所が未入力のとき：⎘タップでこの入力ボックスを展開し、保存で「農家プロ＋求人フロー」両方へ反映（2026-07-16）
  const [placeBoxOpen, setPlaceBoxOpen] = useState(false);
  const [pbZip, setPbZip] = useState("");
  const [pbPref, setPbPref] = useState("");
  const [pbCity, setPbCity] = useState("");
  const [pbTown, setPbTown] = useState("");
  const [pbAddr, setPbAddr] = useState("");
  const [pbBusy, setPbBusy] = useState(false);
  const [pbErr, setPbErr] = useState("");
  const [pbSaving, setPbSaving] = useState(false);
  const searchPbZip = async () => {
    const zip = pbZip.replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setPbErr("郵便番号は7桁で入力してください"); return; }
    setPbBusy(true); setPbErr("");
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
      const data = await res.json();
      if (data.status === 200 && data.results) {
        const r = data.results[0];
        setPbPref(r.address1); setPbCity(r.address2); setPbTown(r.address3 || "");
      } else { setPbErr("郵便番号が見つかりませんでした"); }
    } catch { setPbErr("検索に失敗しました。通信環境をご確認ください"); }
    setPbBusy(false);
  };
  const savePlaceBox = async () => {
    if (pbSaving) return;
    setPbSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { alert("ログインが必要です"); setPbSaving(false); return; }
      const { error } = await supabase.from("employer_profiles").upsert({
        auth_id: session.user.id,
        place_zip: pbZip.trim(), place_prefecture: pbPref.trim(), place_city: pbCity.trim(),
        place_town: pbTown.trim(), place_address: pbAddr.trim(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      if (error) { alert("保存に失敗しました：" + error.message); setPbSaving(false); return; }
      // 求人フロー側の集合場所にも反映
      setFarmerZip(pbZip.trim()); setFarmerPref(pbPref.trim()); setFarmerCity(pbCity.trim());
      setFarmerTown(pbTown.trim()); setFarmerAddr(pbAddr.trim());
      setFarmerRegion(pbPref.trim() + pbCity.trim() + pbTown.trim());
      setZipError("");
      setPrevAddress({ zip: pbZip.trim(), prefecture: pbPref.trim(), city: pbCity.trim(), town: pbTown.trim(), address: pbAddr.trim() });
      setPlaceBoxOpen(false);
    } catch (e) { alert("保存に失敗しました"); }
    setPbSaving(false);
  };
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
        setFarmerTown(data.town ?? "");
        setFarmerAddr(data.address ?? "");
        setFarmerRegion((data.prefecture ?? "") + (data.city ?? "") + (data.town ?? ""));
        setJobDateStart(data.date_start ? new Date(data.date_start) : null);
        setJobDateEnd(data.date_end ? new Date(data.date_end) : null);
        setJobCount(data.headcount != null ? String(data.headcount) : "");
        setFarmerPayType(data.pay_type ?? ""); // 報酬方式（時給/日給）も復元（2026-07-24・コピー/再開で欠けていた）
        setHourlyWageInput(data.hourly_wage ?? "");
        setDailyWageInput(data.daily_wage ?? "");
        // 勤務時間（"H:MM〜H:MM"）を start/end に復元（2026-07-24・コピー/再開で欠けていた）
        { const wt = String(data.work_time ?? "").match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/); if (wt) { setStartHour(wt[1]); setStartMinute(wt[2]); setEndHour(wt[3]); setEndMinute(wt[4]); } }
        setBreakTime(data.break_time ?? "");
        setNearestStation(data.nearest_station ?? "");
        setCommuteTime(data.commute_time ?? "");
        setJobExp(data.job_exp ?? "");
        setBeginnerOk(!!data.beginner_ok);
        setInstantApproveRepeat(!!data.instant_approve_repeat);
        setJobPerks(data.perks || null);
        setExperiencedPreferred(!!data.experienced_preferred);
        setJobDescription(data.notes ?? "");
        setJobNotes(data.belongings ?? "");
        setJobCautions(data.cautions ?? "");
        // photos未所持の旧データを補完しつつ復元。2つ目に中身があれば展開フラグも立てる（2026-07-16）
        const dp = (data.danger_places ?? []).map(x => ({ photos: [], ...x }));
        const dt = (data.danger_tasks ?? []).map(x => ({ photos: [], ...x }));
        setJobDangerPlaces(dp.length ? dp : [{ icon:"⚠️", label:"", desc:"", photos:[] }, { icon:"⚠️", label:"", desc:"", photos:[] }]);
        setJobDangerTasks(dt.length ? dt : [{ icon:"⚠️", label:"", desc:"", photos:[] }, { icon:"⚠️", label:"", desc:"", photos:[] }]);
        setShowPlace2(dangerHasSecond(dp));
        setShowTask2(dangerHasSecond(dt));
        setJobPhotos(normalizePhotos(data.photos)); // 旧形式（文字列配列）の求人でも真っ白にならないよう正規化（2026-07-16）
        setStep(data.draft_step != null ? data.draft_step : 11);
      } catch {}
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMsg, setDraftMsg] = useState("");
  const [draftBarFull, setDraftBarFull] = useState(false);
  const [draftOverlay, setDraftOverlay] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);

  // ドラフト保存 → ログイン後に LandingFlow 初期化時に復元される
  const saveDraft = () => {
    try {
      const draft = {
        role: "farmer", farmerStep: step, job_number: draftJobNumber, // 保存時点の実ステップとupsertキーを記録
        farmerExp, farmerPurpose, farmerDisplayName, farmerRegion,
        farmerZip, farmerPref, farmerCity, farmerTown, farmerAddr, jobPhotos,
        farmerCropPill, farmerCropText, farmerTaskPill, farmerTaskText,
        farmerWanted, farmerPayType, payTiming, payMethod,
        startHour, startMinute, endHour, endMinute,
        jobCount, breakTime, commuteTime, nearestStation, jobDangerPlaces, jobDangerTasks, hourlyWageInput, dailyWageInput,
        jobExp, jobTemplate, jobNotes, jobCautions, jobDescription, beginnerOk, instantApproveRepeat, jobPerks, experiencedPreferred,
        jobDateStart: jobDateStart?.toISOString() ?? null,
        jobDateEnd:   jobDateEnd?.toISOString()   ?? null,
      };
      localStorage.setItem('landingFlowDraft_v1', JSON.stringify(draft));
      localStorage.setItem('postLoginReturnTo', 'landingFlowFarmerConfirm');
      // ログイン後: LandingFlow 初期化時に _draftInit が読み込まれ、
      //   role="farmer", step=5（確認画面）として復元される
    } catch {}
  };

  const buildJobPayload = async (authUid, statusVal = "pending") => {
    const geo = await geocodeTown(farmerPref, farmerCity, farmerTown);
    return {
      farmer_id:       authUid,
      crop:            farmerCrop,
      task:            farmerTask,
      zip:             farmerZip,
      prefecture:      farmerPref,
      city:            farmerCity,
      town:            farmerTown,
      address:         farmerAddr,
      date_label:      jobDateLabel,
      date_start:      jobDateStart ? ymdLocal(jobDateStart) : null,
      date_end:        jobDateEnd ? ymdLocal(jobDateEnd) : null,
      headcount:       Number(jobCount) || null,
      pay_type:        "日給", // 時給入力は廃止（2026-07-16）。新規保存は常に日給
      hourly_wage:     "", // 時給入力は廃止（2026-07-16）。レガシー下書きの隠れ値を保存しない
      daily_wage:      dailyWageInput,
      work_time:       workTimeLabel,
      break_time:      breakTime,
      nearest_station: nearestStation,
      commute_time:    commuteTime,
      job_exp:         jobExp,
      beginner_ok:     beginnerOk,
      instant_approve_repeat: instantApproveRepeat,
      perks:           jobPerks,
      experienced_preferred: experiencedPreferred,
      notes:           jobDescription,
      belongings:      jobNotes,
      cautions:        jobCautions,
      danger_places:   jobDangerPlaces,
      danger_tasks:    jobDangerTasks,
      photos:          jobPhotos,
      draft_step:      step,
      status:          statusVal,
      lat:             geo ? geo.lat : null,
      lng:             geo ? geo.lng : null,
      geo_radius_m:    geo ? geo.radius : null,
      geocoded_from:   geo ? geo.from : null,
    };
  };

  const saveDraftToSupabase = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { ok:false, reason:"no_session" };
      const payload = await buildJobPayload(session.user.id, "draft");
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

  // devJumpは1回のマウントで消費したら破棄する（残り続けると、後日の通常フロー起動時に
  // _devJumpが読まれて古いstep/roleへ勝手にジャンプする。読み込み済みの_devJump変数には影響しない）
  useEffect(() => { try { localStorage.removeItem('devJump'); } catch {} }, []);

  // 確認ページ到達時：住所からおおよその座標を取得（保存時のgeocodeTownと同じ手順。
  // 取得失敗・住所未入力ならnullのまま＝JobLocationMapが「地図は準備中です」を表示）
  useEffect(() => {
    if (step !== 11 || role !== "farmer") return;
    let cancelled = false;
    (async () => {
      const geo = await geocodeTown(farmerPref, farmerCity, farmerTown);
      if (!cancelled) setConfGeo(geo);
    })();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // 確認ページ用：本人の雇い手プロフィールを取得（詳細ページと同構造のプロフィールカード・農園紹介に使用。
  // 未ログイン・未作成なら null のまま＝最小カードにフォールバック）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (data) setConfEmployer(data);
        const { data: t } = await supabase.rpc("employer_trust_info", { p_farmer_id: session.user.id });
        if (t && t.ok) setConfTrust(t);
      } catch {}
    })();
  }, [confProfileOpen]); // 編集ボックスを閉じたら再取得＝入力したプロフィールが確認ページに即反映（2026-07-16）

  // プロフィール入力のお願い（2026-07-17）：確認ページ到達時、農家プロに未入力の項目があれば
  // Appルートへ通知（cb:confirmNotice→trigger=confirmのお知らせ展開）。判定項目は農家プロ入口の
  // ボックス格子(boxFilled: avatar/nickname/place/perks/staff/intro/ask/style)と同じ8区分
  useEffect(() => {
    if (step !== 11 || role !== "farmer") return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data: ep } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (cancelled) return;
        const filledText = (...vals) => vals.some(v => (v || "").trim() !== "");
        const hasUnfilled = !ep
          || !ep.avatar_url
          || !filledText(ep.nickname)
          || !filledText(ep.place_city)
          || !(ep.has_transport || ep.has_parking || ep.has_commute_allowance || ep.has_bonus || ep.employer_pays_supplies || ep.accessory_ok)
          || ep.staff_count == null || String(ep.staff_count).trim() === ""
          || !filledText(ep.owner_comment, ep.intro_path, ep.intro_joy, ep.intro_crops, ep.intro_atmosphere, ep.intro_message)
          || !filledText(ep.unique_point, ep.always_do, ep.break_style)
          || !filledText(ep.interaction_style);
        if (hasUnfilled) window.dispatchEvent(new Event("cb:confirmNotice"));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  // お知らせの「はじめる」リンク（event:cb:openConfProfile）＝農家プロ入力ボックスをこの場で展開
  useEffect(() => {
    const f = () => setConfProfileOpen(true);
    window.addEventListener("cb:openConfProfile", f);
    return () => window.removeEventListener("cb:openConfProfile", f);
  }, []);

  // Airbnb模擬・部品1:step移動ごとに自動で下書き保存（農家フロー中のみ・home(0)と完了(12)は除外）
  useEffect(() => {
    if (role === "farmer" && step >= 1 && step <= 11) saveDraft();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // step遷移時にスクロール位置をトップへリセット（前ページの途中位置が引き継がれるのを防ぐ）
  useEffect(() => {
    try {
      if (flowScrollRef.current) flowScrollRef.current.scrollTo(0, 0);
      window.scrollTo(0, 0);
    } catch {}
  }, [step]);

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
  const fmtD = (d, opts = {}) => {
    if (!d) return "";
    const w = WD[d.getDay()];
    if (opts.omitYearMonth) return `${d.getDate()}（${w}）`;
    if (opts.omitYear) return `${d.getMonth()+1}/${d.getDate()}（${w}）`;
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}（${w}）`;
  };
  // 日程ラベル（2026-07-16）：年内に終了なら年を省く。年内かつ同じ月で終了なら終了側は年と月も省く
  const jobDateLabel = (() => {
    if (!jobDateStart) return "日程を選択してください";
    const end = jobDateEnd || jobDateStart;
    const thisYear = new Date().getFullYear();
    const inYear = jobDateStart.getFullYear() === thisYear && end.getFullYear() === thisYear;
    if (jobDateStart.toDateString() === end.toDateString()) return fmtD(jobDateStart, { omitYear: inYear });
    const sameMonth = inYear && jobDateStart.getMonth() === end.getMonth();
    return `${fmtD(jobDateStart, { omitYear: inYear })} 〜 ${fmtD(end, sameMonth ? { omitYearMonth: true } : { omitYear: inYear })}`;
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
      fontSize:"clamp(16px, 1.6vw, 18px)", lineHeight:1.7, color:"#717171",
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
      fontSize:"clamp(13px, 1.1vw, 14px)", lineHeight:1.8, color:"#B0B0B0", textAlign:"center",
    },
    inputLabel: { fontSize:14, fontWeight:700, color:"#222", marginBottom:6, display:"block" },
    featureTitle: { fontSize:"clamp(14px, 1.5vw, 16px)", fontWeight:700, color:"#222", marginBottom:3 },
    featureDesc: { fontSize:"clamp(13px, 1.3vw, 14px)", lineHeight:1.75, color:"#717171" },
  };

  // canGoNext per step
  // 農家6ステップ: 0=home,1=就農歴,2=目的,3=プロフィール,4=詳細,5=確認,6=完了
  const prefNotAllowed = !!farmerPref.trim() && !isAllowedPrefecture(farmerPref);
  const farmerCanNext = [true, !!farmerCrop, !!farmerTask, !!farmerZip.trim()&&isAllowedPrefecture(farmerPref)&&!!farmerCity.trim()&&!!farmerTown.trim()&&!!farmerAddr.trim(), !!jobDateStart && Number(jobCount) > 0, farmerPurpose !== "post" || (!!dailyWageInput && !dailyViolation && breakTime !== ""), true, true, true, true, true, true, true];
  const workerCanNext = [true, !!workerExp, !!workerPurpose, true, true, true, true, true, true];
  const canGoNext = isFarmer ? (farmerCanNext[step] ?? true) : isWorker ? (workerCanNext[step] ?? true) : true;

  // 掲載（status=pending投入）前の必須項目チェック。欠けている項目名を返す
  const getPublishMissingFields = () => {
    const checks = [
      ["作物",                   !!farmerCrop],
      ["作業",                   !!farmerTask],
      ["郵便番号",                !!farmerZip.trim()],
      ["都道府県（徳島県）",        isAllowedPrefecture(farmerPref)],
      ["市区町村",                !!farmerCity.trim()],
      ["町域",                   !!farmerTown.trim()],
      ["作業日程（開始日）",       !!jobDateStart],
      ["採用人数",                Number(jobCount) > 0],
      ["日給（最低賃金以上）", !!dailyWageInput && !dailyViolation],
      ["休憩時間",                breakTime !== ""],
    ];
    return checks.filter(([, ok]) => !ok).map(([label]) => label);
  };

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
        </div>
      )}

      {/* 終了ボタン（押すと保存して終了／保存せずに終了／キャンセルの3択モーダルを開く） */}
      {!embedded && step !== 12 && step !== 11 && step !== 0 && step !== 6 && (
        <button onClick={() => setShowExitModal(true)} disabled={draftSaving} className="f-sans" style={{
          position:"absolute", top:step > 0 ? 24 : 16, right:20,
          background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"8px 18px",
          fontSize:13, color:"#222", fontWeight:600, cursor:"pointer", zIndex:2,
          boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>{draftSaving ? "保存中..." : "終了"}</button>
      )}

      {/* 終了3択モーダル */}
      {showExitModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, maxWidth:360, width:"100%", boxShadow:"0 8px 40px rgba(0,0,0,0.15)" }}>
            <h3 className="f-sans" style={{ fontSize:18, fontWeight:700, color:"#222", marginBottom:20, textAlign:"center" }}>作成を終了しますか？</h3>
            <div style={{ display:"grid", gap:10 }}>
              <button onClick={() => { setShowExitModal(false); handleTopSaveExit(); }} disabled={draftSaving} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:12 }}>保存して終了</button>
              <div>
                <button onClick={() => {
                  try { localStorage.removeItem('landingFlowDraft_v1'); localStorage.removeItem('postLoginReturnTo'); } catch {}
                  setShowExitModal(false);
                  window.location.hash = "/profile/employer";
                  if (typeof onSkip === "function") onSkip();
                }} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:12, background:"#fff", border:"1px solid #EBEBEB", color:"#222", cursor:"pointer" }}>保存せずに終了</button>
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", textAlign:"center", marginTop:6 }}>最後に「保存して終了」した内容は残ります</p>
              </div>
              <button onClick={() => setShowExitModal(false)} className="f-sans" style={{ width:"100%", padding:"10px", background:"none", border:"none", fontSize:13, color:"#717171", cursor:"pointer" }}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* スクロール領域（全stepスワイプで次へ/戻る・2026-07-16） */}
      <div ref={flowScrollRef} onTouchStart={onFlowTouchStart} onTouchEnd={onFlowTouchEnd} style={embedded ? {} : ((step === 0 || step === 6)
        ? { height:"100%", overflowY:"auto", display:"flex", flexDirection:"column", justifyContent:"center" }
        : { height:"100%", overflowY:"auto" })}>
        <div key={step} className={stepAnim || "fade-in"}
          onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && stepAnim.startsWith("step-in")) setStepAnim(""); }}
          style={{ maxWidth: (step === 11 || step === 0 || step === 6) ? 1280 : 480, margin:"0 auto", padding: embedded ? (step > 0 ? "16px 20px 24px" : "0 20px 24px") : (step > 0 ? "64px 20px calc(76px + env(safe-area-inset-bottom, 0px))" : "56px 20px 40px") }}>{/* 下余白は浮遊ピル(約66px)+10px（2026-07-16・旧140px） */}

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
                <p className="f-sans" style={{ fontSize:16, color:"#222", lineHeight:1.7, margin:0 }}>
                  {role === "farmer"
                    ? "求人に欠かせない情報を入力します。作物、作業内容、場所、日程、採用人数、報酬の6つを、ひとつずつうかがいます。"
                    : "はじめに、希望する作業内容や、働ける時期・条件についてうかがいます。次に、勤務できる地域、曜日、時間帯、希望する報酬など、お仕事探しに必要な情報をご入力ください。"}
                </p>
              </div>
              </div>
              {/* 見本求人カード（🥦ブロッコリー）は削除（2026-07-16）：既に求人が作られていると誤認されたため。憲法3条（表示にダミー禁止）とも整合 */}
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
            {/* 農家プロの作業場所ボックス（未設定時に⎘から展開・2026-07-16）。保存＝農家プロ＋この画面の両方へ反映 */}
            {placeBoxOpen && (
              <div onClick={()=>setPlaceBoxOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:700, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:480, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                    <button onClick={()=>setPlaceBoxOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>📍 作業場所（農家プロフィール）</p>
                  </div>
                  <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:16 }}>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 12px", lineHeight:1.7 }}>プロフィールに作業場所が未設定です。保存すると、農家プロフィールとこの求人の集合場所の両方に入ります。</p>
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>郵便番号</label>
                    <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                      <input value={pbZip} onChange={e=>{ setPbZip(e.target.value); setPbErr(""); }} placeholder="例：779-3401" className="field f-sans" style={{ flex:1, fontSize:14, marginBottom:0 }} />
                      <button onClick={searchPbZip} disabled={pbBusy} className="f-sans" style={{ padding:"0 14px", borderRadius:8, border:"1px solid #DADADA", background:"#fff", color:"#222", fontSize:12, fontWeight:600, cursor: pbBusy ? "default" : "pointer", whiteSpace:"nowrap" }}>{pbBusy ? "検索中..." : "住所を検索"}</button>
                    </div>
                    {pbErr && <p className="f-sans" style={{ fontSize:12, color:"#E53935", marginBottom:8 }}>{pbErr}</p>}
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>都道府県</label>
                    <input value={pbPref} onChange={e=>setPbPref(e.target.value)} placeholder="例：徳島県" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>市区町村</label>
                    <input value={pbCity} onChange={e=>setPbCity(e.target.value)} placeholder="例：吉野川市" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>町域</label>
                    <input value={pbTown} onChange={e=>setPbTown(e.target.value)} placeholder="例：山川町〇〇" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>番地・建物名</label>
                    <input value={pbAddr} onChange={e=>setPbAddr(e.target.value)} placeholder="例：1-2-3 〇〇ハイツ101" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
                    <button onClick={savePlaceBox} disabled={pbSaving || !pbCity.trim()} className="btn-primary f-sans" style={{ width:"100%", padding:"13px", fontSize:14, fontWeight:700, opacity: (pbSaving || !pbCity.trim()) ? 0.5 : 1 }}>{pbSaving ? "保存中..." : "保存する"}</button>
                  </div>
                </div>
              </div>
            )}
            {/* ⎘＝作業場所の復元マーク（2026-07-16）：緑地×白マーク・見出し行の右端（カード内の「住所を検索」との重なり回避）。
                プロフィール設定済み=タップで復元／未設定=タップで作業場所の入力ボックスを展開（保存で農家プロ＋この画面の両方へ反映） */}
            <div style={{ position:"relative", paddingRight:44 }}>
              <h2 className="f-sans" style={lfStyles.stepTitle}>集合場所を入力してください</h2>
              <button onClick={() => {
                if (prevAddress) {
                  setFarmerZip(prevAddress.zip || "");
                  setFarmerPref(prevAddress.prefecture || "");
                  setFarmerCity(prevAddress.city || "");
                  setFarmerTown(prevAddress.town || "");
                  setFarmerAddr(prevAddress.address || "");
                  setFarmerRegion((prevAddress.prefecture || "") + (prevAddress.city || "") + (prevAddress.town || ""));
                  setZipError("");
                } else {
                  setPbZip(farmerZip); setPbPref(farmerPref); setPbCity(farmerCity); setPbTown(farmerTown); setPbAddr(farmerAddr);
                  setPbErr("");
                  setPlaceBoxOpen(true);
                }
              }} aria-label="作業場所を復元" className="f-sans" style={{ position:"absolute", top:0, right:0, zIndex:1, width:36, height:36, borderRadius:"50%", border:"none", background:"#00A86B", fontSize:16, fontWeight:700, color:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>⎘</button>
            </div>
            <p className="f-sans" style={lfStyles.subtitle}>集合場所の住所を入力します。番地・建物名は求人票には公開されず、面接・打合せ時に共有されます。</p>

            <LFWizCard>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>郵便番号</label>
                <div style={{ display:"flex", gap:8, alignItems:"stretch", marginBottom:8 }}>
                  <input
                    ref={zipRef}
                    value={farmerZip}
                    onChange={e => setFarmerZip(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchZip(); } }}
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
                {zipError && <p className="f-sans" style={{ fontSize:14, color:"#E53935", marginBottom:12 }}>{zipError}</p>}
                <label className="f-sans" style={lfStyles.inputLabel}>都道府県</label>
                <input
                  ref={prefRef}
                  value={farmerPref}
                  readOnly
                  placeholder="例：徳島県"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12, background:"#F7F7F7", color:"#717171", cursor:"not-allowed" }}
                />
                <label className="f-sans" style={lfStyles.inputLabel}>市区町村</label>
                <input
                  ref={cityRef}
                  value={farmerCity}
                  readOnly
                  placeholder="例：吉野川市"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12, background:"#F7F7F7", color:"#717171", cursor:"not-allowed" }}
                />
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:4 }}>
                  郵便番号から自動で入力されます。誤りがある場合は郵便番号を修正してください
                </p>
                <label className="f-sans" style={lfStyles.inputLabel}>町域</label>
                <input
                  ref={townRef}
                  value={farmerTown}
                  onChange={e => { setFarmerTown(e.target.value); setFarmerRegion(farmerPref + farmerCity + e.target.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addrRef.current?.focus(); } }}
                  placeholder="例：山川町〇〇"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12 }}
                />
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:-6, marginBottom:12 }}>この項目は求人票に公開されます</p>
                <label className="f-sans" style={lfStyles.inputLabel}>番地・建物名</label>
                <input
                  ref={addrRef}
                  value={farmerAddr}
                  onChange={e => setFarmerAddr(e.target.value)}
                  onKeyDown={(e) => {
                    // 最後の欄の確定＝次の入力先（次のステップ）へ自動遷移。未入力が残っていればキーボードを閉じるだけ
                    if (e.key === "Enter") { e.preventDefault(); if (canGoNext) goNext(); else e.currentTarget.blur(); }
                  }}
                  placeholder="例：1-2-3 〇〇ハイツ101"
                  className="field f-sans"
                  style={{ fontSize:16 }}
                />
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:6 }}>番地・建物名は求人票には公開されません。応募を承認した方にのみお伝えします。</p>
                {(!farmerZip.trim() || !farmerPref.trim() || !farmerCity.trim() || !farmerTown.trim() || !farmerAddr.trim()) && <p className="f-sans" style={{ fontSize:14, color:"#F5A623", marginTop:4 }}>すべての住所欄を入力してください</p>}
                {prefNotAllowed && (
                  <p className="f-sans" style={{ fontSize:14, color:"#E24B4A", marginTop:4 }}>
                    現在、徳島県内の求人のみ受け付けています。他の地域への展開は準備中です
                  </p>
                )}
                {/* 5-c. 最寄り駅からの移動時間 */}
                <div style={{ marginBottom:14 }}>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>最寄り駅からの移動時間</label>
                  <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                    <input value={nearestStation} onChange={e => setNearestStation(e.target.value)} placeholder="例：阿波山川" className="field f-sans" style={{ fontSize:14, maxWidth:160 }} />
                    <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>駅から</span>
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
            <h2 className="f-sans" style={lfStyles.stepTitle}>採用人数と作業日程を入力してください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>何人募集するか、いつ作業を行うかを入力します。</p>
            <LFWizCard>
              {/* 5. 採用人数 */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>採用人数</label>
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

          {/* ── 農家 step5: 採用人数（骨格・中身は段階Bで移植） ── */}
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
                    <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:0 }}>開始時間と終了時間を選んでください。</p>
                    <div style={rowStyle}>
                      <input type="time" value={toTime(startHour, startMinute)} onChange={e => fromTime(e.target.value, setStartHour, setStartMinute)} style={timeStyle} />
                      <span style={{ margin:"0 6px", color:"#717171", fontWeight:700, fontSize:16 }}>〜</span>
                      <input type="time" value={toTime(endHour, endMinute)} onChange={e => fromTime(e.target.value, setEndHour, setEndMinute)} style={timeStyle} />
                    </div>
                    <p className="f-sans" style={{ fontSize:14, color:"#00A86B", marginTop:8, textAlign:"center" }}>→ {workTimeLabel}</p>
                  </div>
                );
              })()}
              {/* 5-b. 休憩時間（グループ2予定） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>休憩時間</label>
                <select value={breakTime} onChange={e => setBreakTime(e.target.value)} className="field f-sans" style={{ fontSize:14, maxWidth:160 }}>
                  <option value="">選択してください</option>
                  <option value="なし">なし</option>
                  {/* 5分刻み（2026-07-16）。値は従来と同じ「N分」形式＝既存データ（30分/60分等）とそのまま互換 */}
                  {Array.from({ length: 24 }, (_, i) => (i + 1) * 5).map(m => (
                    <option key={m} value={`${m}分`}>{m}分</option>
                  ))}
                </select>
              </div>
              {/* 6. 報酬 */}
              <div style={{ marginBottom:6 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:4 }}>報酬</label>
              </div>
              {/* 時給欄は削除（2026-07-16・日給に一本化）。変数hourlyWageInput・保存経路・最賃チェックは
                  既存下書きの復元と表示のため温存（UIのみ撤去） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>日給 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円）</span></label>
                <input inputMode="numeric" value={dailyWageInput} onChange={e => setDailyWageInput(e.target.value.replace(/[^\d]/g, ""))} placeholder="例：9000" className="field f-mono" style={{ fontSize:18, maxWidth:160 }} />
                <LFWageCompare type="日給" value={dailyWage} avg={AVG_DAILY} count={AVG_COUNT} />
                {dailyViolation && (
                  <p className="f-sans" style={{ fontSize:14, color:"#E24B4A", marginTop:6 }}>{farmerPref || "この地域"}の最低賃金（時給{minWage ? minWage.toLocaleString() : "―"}円）を下回っています。この金額では掲載できません</p>
                )}
                {unknownWage && (hourlyWage > 0 || dailyWage > 0) && (
                  <p className="f-sans" style={{ fontSize:14, color:"#E24B4A", marginTop:6 }}>
                    この地域の最低賃金データが未登録のため、金額を確認できません。運営にお問い合わせください
                  </p>
                )}
              </div>
              {false && (
              <div style={{ marginBottom:14, marginTop:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>支払いタイミング</label>
                <LFPillSelect options={["即日払い（作業当日）","週末まとめ払い","月末締め・翌月払い"]} value={payTiming} onSelect={setPayTiming} />
              </div>
              )}
              {false && (
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>支払方法</label>
                <LFPillSelect options={["現金手渡し","銀行振込","相談して決める"]} value={payMethod} onSelect={setPayMethod} />
              </div>
              )}
            </LFWizCard>
          </>)}

          {/* ── 農家 step6: グループ2 説明ページ（step0と同じ2カラム構造） ── */}
          {isFarmer && step === 6 && (<>
            <div className="step0-grid">
              <div>
                <div style={{ marginBottom:36 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#00A86B", margin:"0 0 8px" }}>ステップ2</p>
                  <h1 className="f-sans" style={{ fontSize:38, fontWeight:800, color:"#222", lineHeight:1.25, margin:"0 0 20px" }}>ここからは任意です</h1>
                  <p className="f-sans" style={{ fontSize:16, color:"#222", lineHeight:1.7, margin:0 }}>ここから先は、入力しなくても求人を出せます。ですが、写真や作業の詳しい説明、勤務条件などを加えると、働き手が「ここで働きたい」と感じやすくなります。あなたの求人を、もっと魅力的にしましょう。</p>
                </div>
              </div>
              {/* 📸見本カードは削除（2026-07-16）：step0の見本カードと同じく、実在の求人と誤認されうるため */}
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:24 }}>
              {!returnToConfirm && (
                <button onClick={() => setStep(11)} className="f-sans" style={{ padding:"12px 28px", fontSize:14, fontWeight:700, background:"#fff", border:"1px solid #00A86B", borderRadius:12, color:"#00A86B", cursor:"pointer" }}>あとで書く — 確認画面へ進む →</button>
              )}
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
                            const upFile = await compressImage(file); // アップロード前に圧縮（2026-07-16）
                                      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, upFile, { contentType: upFile.type || undefined });
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
                    <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:8 }}>{jobPhotos.length} / 10 枚</p>
                  </div>

                  {/* 空状態：大タップゾーン */}
                  {jobPhotos.length === 0 && (
                    <label className="f-sans" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"48px 24px", border:"2px dashed #D8D8D8", borderRadius:16, cursor: photoUploading ? "wait" : "pointer", background:"#FAFAFA", textAlign:"center" }}>
                      <span style={{ fontSize:44, lineHeight:1 }}>📷</span>
                      <span className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>写真をドロップ、またはタップして追加</span>
                      <span className="f-sans" style={{ fontSize:14, color:"#B0B0B0", maxWidth:280, lineHeight:1.6 }}>畑の全景・作業の様子・収穫物が伝わる写真ほど、応募が増えます。1枚目がカバー写真になります。</span>
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
                            const upFile = await compressImage(file); // アップロード前に圧縮（2026-07-16）
                                      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, upFile, { contentType: upFile.type || undefined });
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
                      {/* 2枚目以降は2列の大サイズ（2026-07-16）。justifyContent:centerで奇数枚の最後の1枚＝空白が中央に来る */}
                      {jobPhotos.length > 1 && (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center" }}>
                          {jobPhotos.slice(1).map((p, i) => {
                            const idx = i + 1;
                            return (
                              <div key={idx} style={{ position:"relative", width:"calc(50% - 4px)" }}>
                                <img src={p.url} alt={`写真${idx+1}`} style={{ width:"100%", aspectRatio:"4 / 3", objectFit:"cover", borderRadius:10, border:"1px solid #EEE", display:"block" }} />
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
            {jobPhotos.length > 0 && (
              <button onClick={()=>setPhotoCaptionsOpen(true)} className="f-sans" style={{ display:"inline-flex", alignItems:"center", gap:6, background:"none", border:"none", padding:0, margin:"-8px 0 16px", fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>
                写真の説明 →
              </button>
            )}
            <LFWizCard>
              <textarea
                value={jobDescription}
                onChange={e => setJobDescription(e.target.value)}
                placeholder="例：ブロッコリーの収穫と箱詰めをお願いします。畑は平坦で、初めての方でも当日にコツをお教えします。10時と15時に休憩があります。"
                maxLength={1000}
                style={{ background:"#fff", color:"#222", width:"100%", minHeight:200, padding:"16px", fontSize:15, lineHeight:1.8, border:"1px solid #E5E5E5", borderRadius:14, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
              />
              <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:8, textAlign:"right" }}>{jobDescription.length} / 1000</p>
            </LFWizCard>

    {/* 写真ごとの説明はポップアップに移設（2026-07-16）：「写真ごとに説明→🔗」タップで展開・0.8秒 */}
    {photoCaptionsOpen && jobPhotos.length > 0 && (
      <div onClick={()=>setPhotoCaptionsOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:700, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>{/* タッチ遮断=写真スワイプがフローの画面遷移にならない（2026-07-16） */}
        <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
            <button onClick={()=>setPhotoCaptionsOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
            <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>写真の説明</p>
          </div>
          <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y", padding:16 }}>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:14 }}>写真を横にスワイプして、それぞれに一言添えられます。</p>
            {/* サムネイル選択→横スワイプ切替に変更（2026-07-16）。表示中の写真のキャプションを下で編集 */}
            <div onScroll={e => { const w = e.currentTarget.clientWidth; if (w > 0) setSelectedPhotoIndex(Math.max(0, Math.min(jobPhotos.length - 1, Math.round(e.currentTarget.scrollLeft / w)))); }}
              style={{ display:"flex", overflowX:"auto", overflowY:"hidden", scrollSnapType:"x mandatory", borderRadius:14, touchAction:"pan-x pan-y", overscrollBehaviorX:"contain", transform:"translateZ(0)", marginBottom:8 }}>
              {jobPhotos.map((p, i) => (
                <img key={i} src={p.url} alt={`写真${i+1}`} style={{ flexShrink:0, width:"100%", height:200, objectFit:"cover", borderRadius:14, scrollSnapAlign:"start" }} />
              ))}
            </div>
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:10 }}>
              {jobPhotos.map((_, i) => (
                <span key={i} style={{ fontSize:10, color: i === selectedPhotoIndex ? "#00A86B" : "#D0D0D0" }}>{i === selectedPhotoIndex ? "●" : "○"}</span>
              ))}
            </div>
            <textarea
              ref={captionTextareaRef}
              value={jobPhotos[selectedPhotoIndex]?.caption ?? ""}
              onChange={e => setJobPhotos(prev => prev.map((p, i) => i === selectedPhotoIndex ? { ...p, caption: e.target.value } : p))}
              placeholder="この写真について一言（例：収穫するブロッコリー畑です）"
              maxLength={100}
              style={{ width:"100%", minHeight:80, padding:"14px", fontSize:14, lineHeight:1.6, background:"#fff", color:"#222", border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
            />
          </div>
        </div>
      </div>
    )}

          </>)}

          {/* ── 農家 step10: 危険箇所 ── */}
          {isFarmer && step === 9 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>危険な作業・場所</h2>
            <p className="f-sans" style={lfStyles.subtitle}>危険な場所や作業を入力できます。写真や補足説明を添えると、より正確に伝わります。安心して働けるよう、気になる危険は正直に伝えましょう。</p>
            <LFWizCard>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な場所（任意）</label>
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な場所があれば入力してください。</p>
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
                                      const upFile = await compressImage(file); // アップロード前に圧縮（2026-07-16）
                                      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, upFile, { contentType: upFile.type || undefined });
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
                      <button onClick={() => { setShowPlace2(false); setJobDangerPlaces(prev => prev.map((p, j) => j === 1 ? { ...p, label:"", desc:"", photos:[] } : p)); }} className="f-sans" style={{ background:"none", border:"none", padding:"6px", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>× 2つ目を削除</button>
                    )}
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な作業（任意）</label>
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な作業があれば入力してください。</p>
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
                                      const upFile = await compressImage(file); // アップロード前に圧縮（2026-07-16）
                                      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, upFile, { contentType: upFile.type || undefined });
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
                      <button onClick={() => { setShowTask2(false); setJobDangerTasks(prev => prev.map((t, j) => j === 1 ? { ...t, label:"", desc:"", photos:[] } : t)); }} className="f-sans" style={{ background:"none", border:"none", padding:"6px", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>× 2つ目を削除</button>
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
              {/* 必要経験の選択式は撤回（2026-07-18）：はじめてOK・経験者優遇・リピート即決の3トグルに整理。jobExpは旧求人の表示用に温存 */}
              <div style={{ marginBottom:10 }}>
                <button type="button" onClick={()=>setBeginnerOk(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: beginnerOk ? "#00A86B" : "#EBEBEB", background: beginnerOk ? "#E6F7EF" : "#fff", cursor:"pointer" }}>
                  <span style={{ display:"block", fontSize:14, fontWeight:700, color: beginnerOk ? "#00A86B" : "#222" }}>🌱 はじめての人も歓迎{beginnerOk ? "　✓" : ""}</span>
                  <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>求人カードに「🌱はじめてOK」バッジが表示されます</span>
                </button>
                <button type="button" onClick={()=>setFlagInfoOpen("beginner")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>はじめてOKとは？</button>
              </div>
              <div style={{ marginBottom:10 }}>
                <button type="button" onClick={()=>setExperiencedPreferred(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: experiencedPreferred ? "#1A56C5" : "#EBEBEB", background: experiencedPreferred ? "#E8F0FE" : "#fff", cursor:"pointer" }}>
                  <span style={{ display:"block", fontSize:14, fontWeight:700, color: experiencedPreferred ? "#1A56C5" : "#222" }}>💪 経験者優遇{experiencedPreferred ? "　✓" : ""}</span>
                  <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>求人カードに「💪経験者優遇」バッジが表示されます</span>
                </button>
                <button type="button" onClick={()=>setFlagInfoOpen("expert")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#1A56C5", textDecoration:"underline", cursor:"pointer" }}>経験者優遇とは？</button>
              </div>
              <div>
                <button type="button" onClick={()=>setInstantApproveRepeat(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: instantApproveRepeat ? "#D9A013" : "#EBEBEB", background: instantApproveRepeat ? "#FFF8E7" : "#fff", cursor:"pointer" }}>
                  <span style={{ display:"block", fontSize:14, fontWeight:700, color: instantApproveRepeat ? "#8A6D1D" : "#222" }}>🌟 また呼びたい即決{instantApproveRepeat ? "　✓" : ""}</span>
                  <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>あなたがお気に入り登録（また呼びたい）した方の応募だけ、自動で承認されます（採用ではありません）</span>
                </button>
                <button type="button" onClick={()=>setFlagInfoOpen("repeat")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#8A6D1D", textDecoration:"underline", cursor:"pointer" }}>リピート即決とは？</button>
              </div>
            </LFWizCard>

            {/* 「〇〇とは？」説明ボックス（2026-07-18）：タップで展開・✕/背景で閉じる。フロー横スワイプに拾われないようタッチを遮断 */}
            {flagInfoOpen && (() => {
              const info = flagInfoOpen === "beginner"
                ? { icon:"🌱", title:"はじめてOKとは？", body:"農業がはじめての人も歓迎する求人であることを示すマークです。ONにすると、求人カードと詳細ページに「🌱はじめてOK」バッジが表示され、経験のない方も応募しやすくなります。承認するかどうかの判断は、これまで通りあなたが行います。" }
                : flagInfoOpen === "expert"
                ? { icon:"💪", title:"経験者優遇とは？", body:"農作業の経験がある方を優先したいことを示すマークです。ONにすると、求人カードと詳細ページに「💪経験者優遇」バッジが表示され、経験のある方が応募しやすくなります。経験の浅い方の応募を妨げるものではなく、承認の判断はこれまで通りあなたが行います。" }
                : { icon:"🌟", title:"リピート即決とは？", body:"一緒に働いたあと、あなたが「また呼びたい」と評価してお気に入り登録した方が、この求人に応募したときだけ、自動的に承認される仕組みです（承認は採用ではありません。採用は打ち合わせ・面接のあとに、あなたが「採用する」で決めます）。登録していない方の応募は、これまで通りあなたが判断します。効果はあなた自身の求人だけに働き、ほかの農家の求人には影響しません。" };
              return (
                <div onClick={()=>setFlagInfoOpen(null)}
                  onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}
                  style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 12px" }}>
                  <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"relative", width:"100%", maxWidth:480, background:"#fff", borderRadius:20, padding:"28px 24px 24px", boxShadow:"0 12px 48px rgba(0,0,0,0.25)" }}>
                    <button onClick={()=>setFlagInfoOpen(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                    <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{info.icon} {info.title}</p>
                    <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:0 }}>{info.body}</p>
                  </div>
                </div>
              );
            })()}
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
            const rewardLabel = dailyWage > 0 ? `¥${dailyWage.toLocaleString()} / 日` : "未設定"; // 時給は廃止（2026-07-16）
            const wageType = "日給";
            const wageNum  = dailyWage;
            const avgWage  = hourlyWage > 0 ? AVG_HOURLY : AVG_DAILY;
            const maxPay = calcFarmerMaxPay();
            const periodLabel = jobDateStart ? (jobDateLabel !== "日程を選択してください" ? jobDateLabel : "未設定") : "未設定";
            const ConfCalendar = () => {
              if (!jobDateStart) return null;
              const WD2 = ["日","月","火","水","木","金","土"];
              const sameDay = (a, b) => a && b && ymdLocal(a) === ymdLocal(b);
              const todayYmdConf = ymdLocal(new Date());
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
                        const isToday = ymdLocal(dt) === todayYmdConf;
                        return (
                          <div key={dd} style={{
                            padding:"7px 2px", borderRadius:8, fontSize:13, textAlign:"center",
                            background: (isStart||isEnd) ? "#00A86B" : inRange ? "#E6F7EF" : "transparent",
                            color: (isStart||isEnd) ? "#fff" : inRange ? "#00A86B" : "#222",
                            fontWeight: (isStart||isEnd) ? 700 : 400,
                            boxShadow: isToday && !(isStart||isEnd) ? "inset 0 0 0 1.5px #00A86B" : "none",
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
                    <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", marginTop:4 }}>ほか {months.length - LIMIT} か月　〜 {fmtEnd} まで</p>
                  )}
                </div>
              );
            };
            const diffWage = wageNum > 0 ? wageNum - avgWage : 0;

            // プロフィール完成度
            const profileFields = [farmerDisplayName, farmerRegion, farmerCrop, farmerTask, farmerWanted, farmerPayType, jobCount, jobDateStart, workTimeLabel, hourlyWageInput || dailyWageInput];
            const fieldNames     = ["表示名","地域","作物","作業","希望する働き手","支払い方式","採用人数","作業日程","勤務時間","報酬"];
            const filledCount   = profileFields.filter(Boolean).length;
            const profilePct    = Math.round(filledCount / profileFields.length * 100);
            const missingFields = fieldNames.filter((_, i) => !profileFields[i]);

            // jobs INSERT用ペイロードはトップレベルに移設（saveDraftToSupabaseからも参照するため）
            const handleSaveJob = async () => {
              if (jobSaving) return;
              const missing = getPublishMissingFields();
              if (missing.length > 0) {
                alert("掲載前に以下の項目を入力してください：\n" + missing.join("\n"));
                return;
              }
              setJobSaving(true);
              try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) { saveDraft(); onLogin(); return; }
                // プロフィール審査中の農家は掲載不能（編集・下書きは可・2026-07-19）。DBトリガーの手前で分かりやすく案内
                if (!isAdmin(session.user)) {
                  try {
                    const { data: ep } = await supabase.from("employer_profiles").select("texts_pending,texts_revision_requested_at").eq("auth_id", session.user.id).maybeSingle();
                    const epPending = !!(ep?.texts_pending && Object.keys(ep.texts_pending).length > 0);
                    if (epPending || ep?.texts_revision_requested_at) {
                      alert(!epPending && ep?.texts_revision_requested_at
                        ? "プロフィールに修正のお願いが届いているため、いまは掲載できません。\nプロフィールを修正して保存すると、審査のうえ掲載できるようになります。\n（この求人の編集・下書き保存はいつでも可能です）"
                        : "プロフィールが運営の審査待ちのため、いまは掲載できません。\n審査が終わると掲載できるようになります（最大2日）。\n（この求人の編集・下書き保存はいつでも可能です）");
                      return;
                    }
                  } catch {}
                }
                let _jn = draftJobNumber;
                if (!_jn) { try { const _d = JSON.parse(localStorage.getItem("landingFlowDraft_v1")||"{}"); _jn = _d.job_number ?? null; } catch {} }
                let error;
                const payload = await buildJobPayload(session.user.id, "pending");
                if (_jn) {
                  const r = await supabase.from("jobs").update(payload).eq("job_number", _jn).eq("farmer_id", session.user.id);
                  error = r.error;
                } else {
                  const r = await supabase.from("jobs").insert(payload).select("job_number").single();
                  error = r.error;
                  if (!error && r.data) setDraftJobNumber(r.data.job_number);
                }
                if (error) {
                  alert(String(error.message || "").includes("PROFILE_UNDER_REVIEW")
                    ? "プロフィールが審査中のため、いまは掲載できません（下書き保存は可能です）。審査が終わると掲載できるようになります。"
                    : "掲載エラー: " + error.message);
                  return;
                }
                try { localStorage.removeItem("landingFlowDraft_v1"); } catch {}
                setDraftJobNumber(null);
                setPublishModal(false);
                setStep(12);
              } catch (e) {
                alert("【管理者デバッグ】catch: " + (e?.message || e));
              } finally {
                setJobSaving(false);
              }
            };

            // 一時保存は下部ナビの「保存」ボタン（トップレベルのhandleTopSaveExitを再利用）に移設（2026-07-13）

            return (<>
              {/* タイトル */}
              <h2 className="f-sans" style={{ fontSize:"clamp(20px,3vw,30px)", fontWeight:850, color:"#222", marginBottom:6, lineHeight:1.3 }}>
                掲載イメージを確認してください
              </h2>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>働き手には、以下のように表示されます。</p>

              {/* 公開イメージ・セクション①：写真ギャラリー（求人詳細ページと同じく写真が先頭） */}
              {(() => {
                const cropIcon = farmerCrop && farmerCrop.includes("ブロッコリー") ? "🥦" : farmerCrop && farmerCrop.includes("なす") ? "🍆" : farmerCrop && farmerCrop.includes("トマト") ? "🍅" : farmerCrop && farmerCrop.includes("ねぎ") ? "🌿" : "🌱";
                const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
                return (
                  <div style={{ marginBottom:28, maxWidth:1000, margin:"0 auto 5px" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:870, margin:"0 auto 8px" }}>
                      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:0 }}>写真</p>
                      <button onClick={() => { setReturnToConfirm(true); setStep(7); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                    </div>
                    <div style={{ position:"relative", maxWidth:870, margin:"0 auto" }}>
                      {/* 白落ち対策（2026-07-16）：iOS Safariでtransformアニメ中の親内のスナップスクロール画像が
                          白く描画されない事象への対処。translateZ(0)で各スライドを独立レイヤーに昇格（☰固定バグと同じ処方）。
                          画像URLが読めない場合は📷プレースホルダーが出る（真っ白のまま原因不明、を防ぐ） */}
                      {/* overflowY:hidden（2026-07-16）：スクローラー自身が縦にバウンスせず、縦ドラッグは親（ページ）のスクロールへ渡る */}
                      <div ref={confScrollRef} onScroll={handleConfPhotoScroll} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ display:"flex", overflowX:"auto", overflowY:"hidden", scrollSnapType:"x mandatory", borderRadius:12, transform:"translateZ(0)", touchAction:"pan-x pan-y", overscrollBehaviorX:"contain" }}>
                        {jobPhotos.length > 0
                          ? (confLooped ? [jobPhotos[jobPhotos.length - 1], ...jobPhotos, jobPhotos[0]] : jobPhotos).map((p, i) => (
                              <div key={i} style={{ position:"relative", flexShrink:0, width:"100%", height:392, borderRadius:12, background:"#F0F0F0", scrollSnapAlign:"start", transform:"translateZ(0)" }}>
                                <span aria-hidden="true" style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48 }}>📷</span>
                                <img src={p.url} alt={`写真${i+1}`} onError={(e)=>{ e.currentTarget.style.display = "none"; }} style={{ position:"relative", width:"100%", height:"100%", objectFit:"cover", borderRadius:12 }} />
                                {p.caption && (
                                  <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 20px 16px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:16, fontWeight:600, borderRadius:"0 0 12px 12px", boxSizing:"border-box" }}>{p.caption}</div>
                                )}
                              </div>
                            ))
                          : [0, 1, 2].map(i => (
                              <div key={i} style={{ flexShrink:0, width:"100%", height:392, borderRadius:12, background:bgColors[i % bgColors.length], display:"flex", alignItems:"center", justifyContent:"center", fontSize:72, scrollSnapAlign:"start" }}>{cropIcon}</div>
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
                    {/* 写真の並び替え（2026-07-19）：◀▶で隣と入れ替え。先頭が求人カードのカバー */}
                    {jobPhotos.length > 1 && (
                      <div style={{ maxWidth:870, margin:"12px auto 0" }}>
                        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 8px" }}>写真の並び替え（先頭が求人カードの表紙になります）</p>
                        <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:4, WebkitOverflowScrolling:"touch" }}>
                          {jobPhotos.map((p, i) => (
                            <div key={i} style={{ flexShrink:0, width:76 }}>
                              <div style={{ position:"relative", width:76, height:76, borderRadius:8, overflow:"hidden", border: i === 0 ? "2px solid #00A86B" : "1px solid #EBEBEB" }}>
                                <img src={p.url} alt={`写真${i + 1}`} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                                {i === 0 && <span className="f-sans" style={{ position:"absolute", top:4, left:4, fontSize:9, fontWeight:700, color:"#fff", background:"#00A86B", borderRadius:6, padding:"1px 5px" }}>表紙</span>}
                              </div>
                              <div style={{ display:"flex", gap:4, marginTop:4 }}>
                                <button onClick={() => movePhoto(i, -1)} disabled={i === 0} aria-label="前へ" className="f-sans" style={{ flex:1, padding:"6px 0", fontSize:13, fontWeight:700, background:"#fff", color: i === 0 ? "#D0D0D0" : "#00A86B", border:"1px solid #EBEBEB", borderRadius:6, cursor: i === 0 ? "default" : "pointer" }}>◀</button>
                                <button onClick={() => movePhoto(i, 1)} disabled={i === jobPhotos.length - 1} aria-label="次へ" className="f-sans" style={{ flex:1, padding:"6px 0", fontSize:13, fontWeight:700, background:"#fff", color: i === jobPhotos.length - 1 ? "#D0D0D0" : "#00A86B", border:"1px solid #EBEBEB", borderRadius:6, cursor: i === jobPhotos.length - 1 ? "default" : "pointer" }}>▶</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {jobPhotos.length === 0 && <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", textAlign:"center", marginTop:8 }}>※ 写真は後から登録できます。現在はイメージです。</p>}
                  </div>
                );
              })()}

              {/* 仕事の内容 / 質問 タブ（第10弾・2026-07-22） */}
              <div style={{ maxWidth:870, margin:"0 auto" }}><ContentQTabs value={confTab} onChange={setConfTab} /></div>
              {confTab === "questions" ? (
                /* LandingFlow内に me は存在しない（未定義参照＝ReferenceErrorで画面真っ白の原因だった・2026-07-24修正）。
                   meはisAdmin判定（運営の非表示スイッチ）専用so未指定でよい。農家本人の回答UIはJobQuestions内のsession判定(isOwner)が担う */
                <div style={{ maxWidth:870, margin:"0 auto" }}><JobQuestions jobNumber={draftJobNumber} /></div>
              ) : (<>
              {/* ヘッダー（求人詳細ページと同一構造：作物 作業｜地域）＋編集リンク */}
              <div style={{ marginBottom:20 }}>
                <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>{farmerCrop || "作物"} {farmerTask || "作業"}{farmerRegion ? `｜${farmerRegion}` : ""}</h2>
                {/* はじめてOK・リピート即決＋待遇はタイトル下にも表示（2026-07-16・詳細ページと同じバッジ） */}
                {(beginnerOk || experiencedPreferred || instantApproveRepeat || perkBadges(jobPerks ? { ...(confEmployer || {}), ...jobPerks } : confEmployer).length > 0) && (
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
                    <JobFlagBadges beginner={beginnerOk} expert={experiencedPreferred} repeat={instantApproveRepeat} />
                    {perkBadges(jobPerks ? { ...(confEmployer || {}), ...jobPerks } : confEmployer).map(b => (
                      <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{b}</span>
                    ))}
                  </div>
                )}
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", margin:0, marginTop:4, display:"flex", alignItems:"center", gap:10 }}>
                  編集：
                  <button onClick={() => { setReturnToConfirm(true); setStep(1); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>作物</button>
                  <button onClick={() => { setReturnToConfirm(true); setStep(2); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>作業</button>
                  <button onClick={() => { setReturnToConfirm(true); setStep(3); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>集合場所</button>
                </p>
              </div>

              {/* ═══ 掲載プレビュー本体（右パネル削除により1カラム・中央寄せ） ═══ */}
              <div style={{ maxWidth:870, margin:"0 auto" }}>

                {/* ── 左: 掲載プレビュー（求人詳細ページの左カラムと同一構造） ── */}
                <div>
                  {/* 主要情報カード（詳細ページと同じ・各行に編集リンク・未入力は「未設定」表示） */}
                  <div style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    <div className="job-detail-info-grid">
                      {[
                        // 期間ものは「〜終了日」を下段に折り返す（2026-07-16・whiteSpace:pre-lineで改行）
                        { label:"日程",     value: jobDateLabel !== "日程を選択してください" ? jobDateLabel.replace("〜", "\n〜") : "", editStep:4 },
                        { label:"勤務時間", value: workTimeLabel, editStep:5 },
                        { label:"休憩時間", value: breakTime, editStep:5 },
                        { label:"採用人数", value: jobCount ? `${jobCount}人` : "", editStep:4 },
                        { label:"移動時間", value: stationLabel(nearestStation, commuteTime), editStep:3 },
                        // 報酬は金額だけ表示（2026-07-16）：支払いタイミング・支払方法を繋げると読みにくいため
                        { label:"報酬",     value: rewardLabel !== "未設定" ? rewardLabel : "", editStep:5 },
                      ].map(row => (
                        <div key={row.label} style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center", textAlign:"center" }}>
                          <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"flex", alignItems:"center", gap:6 }}>
                            {row.label}
                            <button onClick={() => { setReturnToConfirm(true); setStep(row.editStep); }} className="f-sans" style={{ background:"none", border:"none", fontSize:11, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                          </span>
                          <span className="f-sans" style={{ fontSize:15, color: row.value ? "#222" : "#B0B0B0", fontWeight: row.value ? 600 : 400, lineHeight:1.6, whiteSpace:"pre-line" }}>{row.value || "未設定"}</span>
                        </div>
                      ))}
                    </div>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}>支払方法：当日現金手渡し</p>
                  </div>

                  {/* 農家プロフィールカード（詳細ページと同一構造：アバター・自己紹介・待遇。
                      データは employer_profiles の本人行。未作成なら最小カードにフォールバック） */}
                  {(confEmployer && confEmployer.nickname) ? (() => {
                    const pk = jobPerks ? { ...confEmployer, ...jobPerks } : confEmployer; // この求人だけの待遇があれば上書き表示（2026-07-18）
                    const perkRows = [
                      { label:"送迎",     on: pk.has_transport,        value: pk.has_transport ? `あり${pk.transport_area ? "（" + pk.transport_area + "）" : ""}` : EMPTY_MARK },
                      { label:"駐車場",   on: pk.has_parking,          value: pk.has_parking ? `あり${pk.parking_capacity ? "（" + pk.parking_capacity + "台）" : ""}` : EMPTY_MARK },
                      { label:"通勤手当", on: pk.has_commute_allowance, value: pk.has_commute_allowance ? `あり${pk.commute_allowance_detail ? "（" + pk.commute_allowance_detail + "）" : ""}` : EMPTY_MARK },
                      { label:"賞与",     on: pk.has_bonus,            value: pk.has_bonus ? "あり" : EMPTY_MARK },
                      { label:"農家負担", on: pk.employer_pays_supplies, value: pk.employer_pays_supplies ? `あり${pk.supplies_cap ? "（" + pk.supplies_cap + "）" : ""}` : EMPTY_MARK },
                      { label:"アクセサリー", on: pk.accessory_ok,          value: pk.accessory_ok ? "OK" : EMPTY_MARK },
                    ];
                    return (
                      <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                        {/* アイコン左・2倍(88px)・名前に「さん」・登録してからの月日。紹介文はここでは出さない（2026-07-16・詳細ページと同じ） */}
                        {/* アイコン・名前タップ→農園紹介をボックス展開（2026-07-16・詳細ページと同じ） */}
                        <div onClick={()=>setConfIntroOpen(true)} role="button" style={{ display:"flex", alignItems:"center", gap:14, textAlign:"left", cursor:"pointer" }}>
                          <Avatar url={confEmployer.avatar_url} name={confEmployer.nickname} size={70} />
                          <div style={{ minWidth:0 }}>
                            <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>{confEmployer.nickname}さん</p>
                            {confTrust?.member_since && (
                              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>chitose-bank利用 {confTrust.member_since}から</p>
                            )}
                          </div>
                        </div>
                        <div style={{ borderTop:"1px solid #EBEBEB", margin:"14px 0 4px" }} />
                        {/* 待遇タップ→この求人だけの待遇を編集するボックスを展開（2026-07-18） */}
                        <div onClick={openPerksEdit} role="button" style={{ cursor:"pointer" }}>
                        <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:4, letterSpacing:".06em", textAlign:"center" }}>待遇{jobPerks ? "（この求人のみ変更中）" : ""}</p>
                        <div style={{ width:"fit-content", margin:"0 auto" }}>{/* 待遇ブロックはカード中央配置（2026-07-16・旧:境界線を中央に合わせるtranslateX(-78px)） */}
                          {perkRows.map((row, i) => (
                            <div key={row.label} style={{
                              display:"flex", alignItems:"center", gap:12, padding:"8px 0",
                              borderBottom: i < perkRows.length - 1 ? "1px solid #F7F7F7" : "none",
                            }}>
                              <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", width:72, flexShrink:0 }}>{row.label}</span>
                              <span className="f-sans" style={{ fontSize:15, color: row.on ? "#222" : "#B0B0B0", fontWeight: row.on ? 600 : 400, lineHeight:1.6 }}>{row.value}</span>
                            </div>
                          ))}
                        </div>
                        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#00A86B", textAlign:"center", margin:"8px 0 0" }}>タップして待遇を変更 →</p>
                        </div>
                      </div>
                    );
                  })() : (
                    <div onClick={()=>setConfProfileOpen(true)} role="button" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5, cursor:"pointer" }}>{/* 未入力＝タップで農家プロの入力項目を展開（2026-07-16） */}
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center" }}>
                        <div style={{ width:44, height:44, borderRadius:"50%", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, marginBottom:8 }}>🧑‍🌾</div>
                        <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, marginBottom:2 }}>{farmerDisplayName || "農園名未設定"}</p>
                        <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0 }}>{farmerExp ? `就農 ${farmerExp}` : "就農歴未設定"}</p>
                        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#00A86B", margin:"8px 0 0" }}>タップして農園プロフィールを入力 →</p>
                      </div>
                    </div>
                  )}
                  {/* 待遇の編集ボックス（2026-07-18）：送迎から順。下部に「保存」（プロフィールにも反映）と「この求人のみ」 */}
                  {perksEditOpen && perkDraft && (
                    <div onClick={()=>setPerksEditOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                          <button onClick={()=>setPerksEditOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>🎁 待遇の変更</p>
                        </div>
                        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 16px 16px" }}>
                          {[
                            { k:"has_transport", l:"🚐 送迎", tk:"transport_area", tp:"送迎の範囲（例：吉野川市内）" },
                            { k:"has_parking", l:"🅿️ 駐車場", tk:"parking_capacity", tp:"台数（例：3）" },
                            { k:"has_commute_allowance", l:"🚃 通勤手当", tk:"commute_allowance_detail", tp:"内容（例：1日500円まで）" },
                            { k:"has_bonus", l:"🎁 賞与" },
                            { k:"employer_pays_supplies", l:"🧤 持ち物は農家負担", tk:"supplies_cap", tp:"上限（例：軍手・長靴まで）" },
                            { k:"accessory_ok", l:"💍 アクセサリーOK" },
                          ].map(row => (
                            <div key={row.k} style={{ borderBottom:"1px solid #F7F7F7", padding:"10px 0" }}>
                              <button type="button" onClick={()=>setPerkDraft(p=>({ ...p, [row.k]: !p[row.k] }))} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:"2px solid", borderColor: perkDraft[row.k] ? "#00A86B" : "#EBEBEB", background: perkDraft[row.k] ? "#E6F7EF" : "#fff", cursor:"pointer", fontSize:14, fontWeight:700, color: perkDraft[row.k] ? "#00A86B" : "#222" }}>
                                {row.l}{perkDraft[row.k] ? "　✓" : ""}
                              </button>
                              {row.tk && perkDraft[row.k] && (
                                // 台数(parking_capacity)はinteger列so数字のみ入力させる（「3台」等を弾く・2026-07-19）
                                <input value={perkDraft[row.tk]} inputMode={row.tk === "parking_capacity" ? "numeric" : "text"}
                                  onChange={e=>{ const v = row.tk === "parking_capacity" ? e.target.value.replace(/[^0-9]/g, "") : e.target.value; setPerkDraft(p=>({ ...p, [row.tk]: v })); }}
                                  placeholder={row.tp} className="field f-sans" style={{ fontSize:13, marginTop:8, marginBottom:0 }} />
                              )}
                            </div>
                          ))}
                          <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginTop:10 }}>
                            「保存」＝農家プロフィールの待遇も更新します（文章の項目は運営の確認後に公開）。「この求人のみ」＝この求人だけに適用し、プロフィールは変わりません（求人審査の中で確認されます）。
                          </p>
                        </div>
                        <div style={{ display:"flex", gap:8, padding:"10px 12px calc(10px + env(safe-area-inset-bottom, 0px))", borderTop:"1px solid #F0F0F0", flexShrink:0 }}>
                          <button onClick={savePerksToProfile} disabled={perkSaving} className="f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:12, cursor:"pointer", opacity: perkSaving ? 0.6 : 1 }}>{perkSaving ? "保存中..." : "保存"}</button>
                          <button onClick={()=>{ setJobPerks({ ...perkDraft }); setPerksEditOpen(false); }} disabled={perkSaving} className="btn-primary f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, borderRadius:12 }}>この求人のみ</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 農家プロの入力項目ボックス（確認ページから・2026-07-16）。閉じるとカードに即反映 */}
                  {confProfileOpen && (
                    <div onClick={()=>setConfProfileOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                          <button onClick={()=>setConfProfileOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>🧑‍🌾 農園プロフィール</p>
                        </div>
                        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"4px 12px 16px" }}>
                          <EmployerProfileEdit />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 作業内容カード（詳細ページと同じ） */}
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:0 }}>作業内容</p>
                      <button onClick={() => { setReturnToConfirm(true); setStep(8); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                    </div>
                    <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{jobDescription || tmpl.body}</p>
                  </div>

                  {/* 経験・持ち物・備考カード：詳細ページと同じ3行縦積み設計（2026-07-16・タブ式から戻した）。
                      必要経験・持ち物はバッジ・備考は文章・すべて中央配置。未入力は「未設定」。
                      希望する働き手は削除済み（変数farmerWantedは保存・詳細表示で継続使用のため温存） */}
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    <div style={{ display:"flex", justifyContent:"flex-end" }}>
                      <button onClick={() => { setReturnToConfirm(true); setStep(10); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                    </div>
                    {[
                      { label:"持ち物",     value: jobNotes, chips:true, pin:true },
                      { label:"備考・注意", value: jobCautions },
                    ].map(row => {
                      const has = row.value && String(row.value).trim();
                      return (
                        <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                          <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2, textAlign:"center" }}>{row.label}</span>
                          {row.chips && has
                            ? (
                              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:2, justifyContent:"center" }}>
                                {String(row.value).split(/[、,・\n／/]+/).map(s => s.trim()).filter(Boolean).map((c, i) => (
                                  <span key={i} className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"6px 14px" }}>{row.pin ? "📌 " : ""}{c}</span>
                                ))}
                              </div>
                            )
                            : <span className="f-sans" style={{ fontSize:15, color: has ? "#222" : "#B0B0B0", lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word", whiteSpace:"pre-wrap", display:"block", textAlign:"center" }}>{has ? row.value : "未設定"}</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* 危険区域カード（詳細ページと同一構造：場所→作業・縦積み・全幅写真） */}
                  {(jobDangerPlaces.some(p => p.label) || jobDangerTasks.some(t => t.label)) && (
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
                      <span style={{ fontSize:18 }}>⚠️</span>
                      <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
                      <button onClick={() => { setReturnToConfirm(true); setStep(9); }} className="f-sans" style={{ position:"absolute", right:0, background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                    </div>
                    {jobDangerPlaces.some(p => p.label) && (
                      <>
                        <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:28 }}>
                          {jobDangerPlaces.filter(p => p.label).map((place, i) => (
                            <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={place.photos} />
                          ))}
                        </div>
                      </>
                    )}
                    {jobDangerTasks.some(t => t.label) && (
                      <>
                        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                          {jobDangerTasks.filter(t => t.label).map((task, i) => (
                            <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={task.photos} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  )}
                </div>

                {/* 右パネル（報酬・期間・カレンダー・一時保存）は削除（2026-07-13）。
                    報酬・日程は左の主要情報カードに編集リンク付きで表示済み。
                    一時保存は下部ナビ「保存」・保存中オーバーレイはLandingFlowトップレベルへ移設 */}
              </div>
              {/* ═══ 地図（集合場所のおおよその範囲・円のみ。求人詳細ページのJobLocationMapと同一構造。
                   旧Googleマップ風ダミーは廃止(2026-07-14)。座標は住所からgeocodeTownで取得(保存時と同じ手順) ═══ */}
              <div style={{ maxWidth:870, margin:"0 auto 5px" }}>
                <JobLocationMap lat={confGeo?.lat} lng={confGeo?.lng} radius={confGeo?.radius} label={farmerRegion} />
              </div>

              {/* 開催期間カレンダー（地図の下・2026-07-16・詳細ページと同じ） */}
              {jobDateStart && (
                <div className="calendar-below-map" style={{ maxWidth:870, margin:"0 auto 5px" }}>
                  <CalendarView start={jobDateStart} end={jobDateEnd} readOnly={true} />
                </div>
              )}
              </>)}

              {/* 農園紹介セクションはページから削除（2026-07-16）。内容は農家カードのアイコン・名前タップのボックスに集約 */}

              {/* ═══ 農園紹介モーダル（詳細ページと同構造。お題＋代表よりの全文） ═══ */}
              {confIntroOpen && confEmployer && (() => {
                const topics = farmIntroTopics(confEmployer);
                return (
                  <div onClick={() => setConfIntroOpen(false)} style={{
                    position:"fixed", inset:0, zIndex:10000,
                    background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none",
                  }}>
                    <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{
                      position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))",
                      maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, padding:20,
                      overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y",
                    }}>
                      <button onClick={() => setConfIntroOpen(false)} style={{
                        position:"absolute", top:12, right:12,
                        width:36, height:36, borderRadius:"50%",
                        background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer",
                      }}>✕</button>
                      <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 16px", paddingRight:40 }}>
                        {confEmployer.nickname ? `${confEmployer.nickname}の農園紹介` : "農園紹介"}
                      </h3>
                      {/* まず信頼カード（農園紹介の下のボックス）→次に農園紹介（2026-07-16・詳細ページと同じ） */}
                      {(farmHostQa(confEmployer).length > 0 || !!confEmployer.interaction_style || !!confTrust) && (
                        <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:16 }}>
                          <FarmerTrustCard profile={confEmployer} trust={confTrust} />
                        </div>
                      )}
                      {confEmployer.owner_comment && confEmployer.owner_comment.trim() && (
                        <div style={{ background:"#F7F7F7", borderRadius:16, padding:"16px", marginBottom:16 }}>
                          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>代表より</p>
                          <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{confEmployer.owner_comment}</p>
                        </div>
                      )}
                      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                        {topics.map((t, i) => (
                          <div key={i} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px" }}>
                            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>{t.label}</p>
                            <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{t.body}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ═══ 掲載モーダル（下部ナビ「掲載する」から展開。チェックリスト・同意・掲載・注意文を右パネルから移植） ═══ */}
              {publishModal && (
                <div onClick={() => setPublishModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
                  <div onClick={(e) => e.stopPropagation()} style={{ width:"100%", maxWidth:520, maxHeight:"85vh", overflowY:"auto", background:"#fff", borderRadius:"20px 20px 0 0", padding:"20px 20px calc(20px + env(safe-area-inset-bottom, 0px))", boxSizing:"border-box" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                      <h3 className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:0 }}>掲載前の確認</h3>
                      <button onClick={() => setPublishModal(false)} aria-label="閉じる" style={{ background:"none", border:"none", fontSize:22, color:"#717171", cursor:"pointer", padding:"0 4px", lineHeight:1 }}>×</button>
                    </div>
                    <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:8 }}>掲載前に、以下をご確認ください</p>
                    {[
                      "報酬・勤務時間・休憩の内容に間違いはありません",
                      "危険な場所・作業は、漏れなく記載しました（該当が無いことを確認しました）",
                      "日程・場所・人数は、実際に働いていただける内容です",
                      "記載内容は事実です。掲載には運営の審査があることに同意します",
                    ].map((text, i) => (
                      <label key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"8px 0", cursor:"pointer" }}>
                        <input
                          type="checkbox"
                          checked={publishChecks[i]}
                          onChange={() => setPublishChecks(prev => prev.map((v, idx) => idx === i ? !v : v))}
                          style={{ marginTop:3, width:18, height:18, flexShrink:0, accentColor:"#00A86B", cursor:"pointer" }}
                        />
                        <span className="f-sans" style={{ fontSize:14, color: publishChecks[i] ? "#00A86B" : "#222", lineHeight:1.6 }}>
                          {publishChecks[i] ? "✓ " : ""}{text}
                        </span>
                      </label>
                    ))}
                    <button
                      onClick={handleSaveJob}
                      disabled={jobSaving || !publishChecks.every(Boolean)}
                      className="btn-primary"
                      style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:14, marginTop:12, marginBottom:10, ...(!publishChecks.every(Boolean) ? { background:"#EBEBEB", color:"#717171" } : {}) }}
                    >
                      {jobSaving ? "保存中..." : "同意して掲載する"}
                    </button>
                    {!publishChecks.every(Boolean) && (
                      <p style={{ fontSize:13, color:"#717171", textAlign:"center", margin:"0 0 8px" }}>すべての確認にチェックすると掲載できます</p>
                    )}
                    <p style={{ fontSize:14, color:"#888", textAlign:"center", marginTop:8, marginBottom:8 }}>お支払いは現金手渡し、作業当日のお支払いとなります。</p>
                    <p className="f-sans" style={{ fontSize:13, color:"#8A6D1D", background:"#FFF8E7", padding:"8px 12px", borderRadius:8, textAlign:"center", margin:0 }}>「掲載する」を押しても、すぐには掲載されません。運営の確認後に公開されます。</p>
                  </div>
                </div>
              )}
            </>);
          })()}

          {/* ── 農家 Step3: 完了 ── */}
          {/* ── 農家 Step3: 完了 ── */}
          {isFarmer && step === 12 && (<>
            <div style={{ minHeight:"70vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", maxWidth:400, margin:"0 auto", padding:"0 20px" }}>
              <div style={{ fontSize:56, marginBottom:16 }}>✅</div>
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}>審査に提出されました</h2>
              <p className="f-sans" style={{ fontSize:16, color:"#717171", lineHeight:1.8, marginBottom:28 }}>
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
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:4, lineHeight:1.5 }}>※ 市町村まで。番地・字は公開されません</p>
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
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", marginTop:4 }}>
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
              <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, marginBottom:24 }}>
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

      {/* 保存中オーバーレイ（下部ナビ「保存」・保存して終了 共通。どのstepでも表示。旧:確認ページ右パネル内） */}
      {draftOverlay && (
        <div style={{ position:"fixed", inset:0, background:"rgba(255,255,255,0.92)", zIndex:9999, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
          <div style={{ width:44, height:44, border:"4px solid #E0E0E0", borderTopColor:"#00A86B", borderRadius:"50%", animation:"cbspin 0.8s linear infinite" }} />
          <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700 }}>保存しています…</p>
          <style>{`@keyframes cbspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* 開催期間カレンダー📅の浮遊ボタン＋モーダルは削除（2026-07-24・誰も展開しないため）。
          作業日程は主要情報カードの「日程」行の編集リンク（→step4）で選び直せる */}

      {/* 下部ナビのバーは削除（2026-07-16）：戻る／次へは浮遊固定ボックス（スクロール追従）に。
          embedded（プレビューシート内）はfixedが使えないため従来のバーを残す */}
      {step > 0 && step < TOTAL && step !== 12 && !publishModal && (
        embedded ? (
        <div style={{
          background:"#fff", borderTop:"1px solid #EBEBEB", padding:"16px 8px",
          display:"flex", alignItems:"center", justifyContent: isAutoStep ? "flex-start" : "space-between",
        }}>
          {/* step1は戻る先が説明ページしかないため戻るボタンなし（2026-07-16）。spanはspace-betweenの左詰め維持用 */}
          {step === 1
            ? <span aria-hidden="true" />
            : <button onClick={returnToConfirm ? () => { setStep(11); setReturnToConfirm(false); } : goBack} className="f-sans" style={{ background:"none", border:"none", fontSize:15, color:"#222", cursor:"pointer", padding:"8px 0" }}>← 戻る</button>}
          {!isAutoStep && step !== 11 && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <button onClick={canGoNext ? (returnToConfirm ? () => { setStep(11); setReturnToConfirm(false); } : goNext) : undefined} className="btn-primary" style={{
                padding:"14px 28px", fontSize:15, fontWeight:700,
                cursor: canGoNext ? "pointer" : "not-allowed", opacity: canGoNext ? 1 : 0.5,
              }}>{returnToConfirm ? "確認に戻る →" : "次へ →"}</button>
              {!returnToConfirm && step >= 7 && step <= 10 && (
                <button onClick={() => setStep(11)} className="f-sans" style={{ background:"none", border:"none", fontSize:12, color:"#717171", textDecoration:"underline", cursor:"pointer", padding:0 }}>残りをスキップして確認へ →</button>
              )}
            </div>
          )}
          {isFarmer && step === 11 && (
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button onClick={handleTopSaveExit} disabled={draftSaving} className="f-sans" style={{ padding:"14px 20px", fontSize:15, fontWeight:700, background:"#fff", border:"1px solid #DDD", borderRadius:12, color:"#222", cursor:"pointer" }}>{draftSaving ? "保存中..." : "保存"}</button>
              <button onClick={openPublish} className="btn-primary" style={{ padding:"14px 28px", fontSize:15, fontWeight:700 }}>掲載する</button>
            </div>
          )}
        </div>
        ) : (<>
          {/* ← 戻る：左下の浮遊ボックス（step1は非表示） */}
          {step !== 1 && (
            <button onClick={returnToConfirm ? () => { setStep(11); setReturnToConfirm(false); } : goBack} className="f-sans" style={{
              position:"fixed", left:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60,
              display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
              fontSize:14, fontWeight:600, color:"#222", cursor:"pointer", padding:"12px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
            }}>← 戻る</button>
          )}
          {/* 次へ（＋スキップ）：右下の浮遊ボックス */}
          {!isAutoStep && step !== 11 && (
            <div style={{ position:"fixed", right:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
              {!returnToConfirm && step >= 7 && step <= 10 && (
                <button onClick={() => setStep(11)} className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, color:"#717171", textDecoration:"underline", cursor:"pointer", padding:"7px 12px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>残りをスキップして確認へ →</button>
              )}
              <button onClick={canGoNext ? (returnToConfirm ? () => { setStep(11); setReturnToConfirm(false); } : goNext) : undefined} className="btn-primary" style={{
                padding:"14px 28px", fontSize:15, fontWeight:700, borderRadius:20, boxShadow:"0 2px 8px rgba(0,0,0,0.18)",
                cursor: canGoNext ? "pointer" : "not-allowed", opacity: canGoNext ? 1 : 0.5,
              }}>{returnToConfirm ? "確認に戻る →" : "次へ →"}</button>
            </div>
          )}
          {/* 確認ページ(step11)：右下に「保存」＋「掲載する」の浮遊ペア */}
          {isFarmer && step === 11 && (
            <div style={{ position:"fixed", right:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60, display:"flex", alignItems:"center", gap:10 }}>
              <button onClick={handleTopSaveExit} disabled={draftSaving} className="f-sans" style={{ padding:"14px 20px", fontSize:15, fontWeight:700, background:"#fff", border:"1px solid #DDD", borderRadius:20, color:"#222", cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>{draftSaving ? "保存中..." : "保存"}</button>
              <button onClick={openPublish} className="btn-primary" style={{ padding:"14px 28px", fontSize:15, fontWeight:700, borderRadius:20, boxShadow:"0 2px 8px rgba(0,0,0,0.18)" }}>掲載する</button>
            </div>
          )}
        </>)
      )}
    </div>
  );
}












// ── FarmerDashboard（農家モードのお仕事タブ＝求人ダッシュボード・ガワ） ──
function EmployerProfileEdit({ me, onDone, onCancel }) {
  const [nickname, setNickname] = useState("");
  const [pr, setPr] = useState(""); // 紹介・PRボックスは廃止（2026-07-16）。既存データ保全のためstateと保存は温存
  const [avatarUrl, setAvatarUrl] = useState("");
  // 作業場所（集合場所の既定値・紹介PRボックスの差し替え・2026-07-16）。求人フローstep3の復元ボタンがここを読む
  const [placeZip, setPlaceZip] = useState("");
  const [placePref, setPlacePref] = useState("");
  const [placeCity, setPlaceCity] = useState("");
  const [placeTown, setPlaceTown] = useState("");
  const [placeAddr, setPlaceAddr] = useState("");
  const [placeZipBusy, setPlaceZipBusy] = useState(false);
  const [placeZipError, setPlaceZipError] = useState("");
  const approvedTextsRef = useRef({}); // 自由記述の承認済み（本公開）値の控え。保存時の差分判定に使う（2026-07-16）
  const searchPlaceZip = async () => {
    const zip = placeZip.replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setPlaceZipError("郵便番号は7桁で入力してください"); return; }
    setPlaceZipBusy(true); setPlaceZipError("");
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
      const data = await res.json();
      if (data.status === 200 && data.results) {
        const r = data.results[0];
        setPlacePref(r.address1); setPlaceCity(r.address2); setPlaceTown(r.address3 || "");
      } else { setPlaceZipError("郵便番号が見つかりませんでした"); }
    } catch { setPlaceZipError("検索に失敗しました。通信環境をご確認ください"); }
    setPlaceZipBusy(false);
  };
  const [hasTransport, setHasTransport] = useState(false);
  const [hasParking, setHasParking] = useState(false);
  const [hasCommuteAllowance, setHasCommuteAllowance] = useState(false);
  const [hasBonus, setHasBonus] = useState(false);
  const [employerPaysSupplies, setEmployerPaysSupplies] = useState(false);
  const [accessoryOk, setAccessoryOk] = useState(false);
  const [parkingCapacity, setParkingCapacity] = useState("");
  const [commuteAllowanceDetail, setCommuteAllowanceDetail] = useState("");
  const [suppliesCap, setSuppliesCap] = useState(""); // 持ち物農家負担の上限設定（例：上限1,000円まで・2026-07-16）
  const [transportArea, setTransportArea] = useState("");
  const [introPath, setIntroPath] = useState("");
  const [introJoy, setIntroJoy] = useState("");
  const [introCrops, setIntroCrops] = useState("");
  const [introAtmosphere, setIntroAtmosphere] = useState("");
  const [introMessage, setIntroMessage] = useState("");
  const [ownerComment, setOwnerComment] = useState("");
  const [staffCount, setStaffCount] = useState("");
  const [uniquePoint, setUniquePoint] = useState("");
  const [alwaysDo, setAlwaysDo] = useState("");
  const [breakStyle, setBreakStyle] = useState("");
  const [interactionStyle, setInteractionStyle] = useState("");
  const [introOpen, setIntroOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (data) {
          setNickname(data.nickname || ""); setPr(data.pr || ""); setAvatarUrl(data.avatar_url || "");
          setPlaceZip(data.place_zip || ""); setPlacePref(data.place_prefecture || ""); setPlaceCity(data.place_city || "");
          setPlaceTown(data.place_town || ""); setPlaceAddr(data.place_address || "");
          setHasTransport(data.has_transport ?? false);
          setHasParking(data.has_parking ?? false);
          setHasCommuteAllowance(data.has_commute_allowance ?? false);
          setHasBonus(data.has_bonus ?? false);
          setEmployerPaysSupplies(data.employer_pays_supplies ?? false);
          setAccessoryOk(data.accessory_ok ?? false);
          setParkingCapacity(data.parking_capacity != null ? String(data.parking_capacity) : "");
          // 自由記述は審査待ち（texts_pending）優先で編集欄へ＝自分が書いた最新が見える。承認済み値は差分判定用に控える（2026-07-16）
          const tp = data.texts_pending || {};
          approvedTextsRef.current = {
            owner_comment: data.owner_comment ?? "", intro_path: data.intro_path ?? "", intro_joy: data.intro_joy ?? "",
            intro_crops: data.intro_crops ?? "", intro_atmosphere: data.intro_atmosphere ?? "", intro_message: data.intro_message ?? "",
            unique_point: data.unique_point ?? "", always_do: data.always_do ?? "", break_style: data.break_style ?? "",
            transport_area: data.transport_area ?? "", commute_allowance_detail: data.commute_allowance_detail ?? "", supplies_cap: data.supplies_cap ?? "",
          };
          setCommuteAllowanceDetail(tp.commute_allowance_detail ?? (data.commute_allowance_detail || ""));
          setSuppliesCap(tp.supplies_cap ?? (data.supplies_cap || ""));
          setTransportArea(tp.transport_area ?? (data.transport_area || ""));
          setIntroPath(tp.intro_path ?? data.intro_path ?? "");
          setIntroJoy(tp.intro_joy ?? data.intro_joy ?? "");
          setIntroCrops(tp.intro_crops ?? data.intro_crops ?? "");
          setIntroAtmosphere(tp.intro_atmosphere ?? data.intro_atmosphere ?? "");
          setIntroMessage(tp.intro_message ?? data.intro_message ?? "");
          setOwnerComment(tp.owner_comment ?? data.owner_comment ?? "");
          setStaffCount(data.staff_count != null ? String(data.staff_count) : "");
          setUniquePoint(tp.unique_point ?? data.unique_point ?? "");
          setAlwaysDo(tp.always_do ?? data.always_do ?? "");
          setBreakStyle(tp.break_style ?? data.break_style ?? "");
          setInteractionStyle(data.interaction_style ?? "");
          // 既に1つでも入力済みなら初期状態でアコーディオンを開く（値が見えず消えたと誤解されるのを防ぐ）
          const hasIntroContent = !!(data.intro_path || data.intro_joy || data.intro_crops || data.intro_atmosphere || data.intro_message || data.owner_comment || (data.staff_count != null && data.staff_count !== "") || data.unique_point || data.always_do || data.break_style || data.interaction_style);
          if (hasIntroContent) setIntroOpen(true);
        }
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像を読み込めませんでした。別の画像をお試しください。')); };
    img.src = url;
  });
  const handleAvatar = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }
      let sourceFile = file;
      // iPhoneのHEIC/HEIF形式は、まずheic2anyでjpegにデコード（選択時のみ動的import）
      const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
      if (isHeic) {
        try {
          const heic2any = (await import('heic2any')).default;
          const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
          sourceFile = Array.isArray(converted) ? converted[0] : converted;
        } catch (heicErr) { setUploading(false); alert("iPhoneの写真（HEIC）の変換に失敗しました。もう一度お試しください。"); return; }
      }
      let blob;
      try { blob = await convertToJpeg(sourceFile); }
      catch (convErr) { setUploading(false); alert(convErr.message || "この画像形式は対応していません。JPEG・PNG・WebP等をお試しください。"); return; }
      // 拡張子はjpg固定（変換後は必ずjpeg）。旧ファイルが別拡張子で残っていれば掃除
      try {
        const { data: olds } = await supabase.storage.from('avatars').list("employer/" + session.user.id);
        if (olds && olds.length > 0) {
          const paths = olds.map(f => "employer/" + session.user.id + "/" + f.name);
          await supabase.storage.from('avatars').remove(paths);
        }
      } catch {}
      const path = "employer/" + session.user.id + "/avatar.jpg";
      const upErr = await uploadAvatarResilient("employer/" + session.user.id, blob);
      if (upErr) { setUploading(false); alert("アップロードに失敗しました：" + upErr.message + "\n通信環境を確認して、もう一度お試しください。"); return; }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = (urlData?.publicUrl || '') + "?t=" + Date.now();
      await supabase.from('employer_profiles').upsert({ auth_id: session.user.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
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
      const { data: files } = await supabase.storage.from('avatars').list("employer/" + session.user.id);
      if (files && files.length > 0) {
        const paths = files.map(f => "employer/" + session.user.id + "/" + f.name);
        await supabase.storage.from('avatars').remove(paths);
      }
      await supabase.from('employer_profiles').upsert({ auth_id: session.user.id, avatar_url: '', updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setAvatarUrl('');
    } catch { alert("削除に失敗しました。"); }
    setUploading(false);
  };
  // ホームの「🛡 保険の準備」から来た時は、その場で保険ボックスを開く（移植・2026-07-23）
  const [editBox, setEditBox] = useState(null);
  const [showPreview, setShowPreview] = useState(false); // 右上「プレビュー」→FarmerProfilePreviewをモーダル展開
  const [editFromPreview, setEditFromPreview] = useState(false); // プレビュー発の編集：閉じたらプレビューへ戻る（往復・働き手側と同構造）
  const closeEditBox = () => {
    setEditBox(null);
    if (editFromPreview) { setEditFromPreview(false); setShowPreview(true); }
  };
  // 保存→次の未入力ボックスを自動展開（全て入力されるまでループ・2026-07-16・働き手側と同構造）
  // 保険の準備はホーム（面接の質問集の下）へ移植したため、格子の自動フロー(BOX_ORDER)には載せない（2026-07-23）
  const BOX_ORDER = ["avatar","nickname","place","perks","staff","intro","ask","style"];
  const boxFilled = (k) => (
    k === "avatar" ? !!avatarUrl : k === "nickname" ? !!nickname.trim() : k === "place" ? !!placeCity.trim()
    : k === "perks" ? perksOn.length > 0
    : k === "staff" ? staffCount !== "" : k === "intro" ? introFilled > 0
    : k === "ask" ? askFilled > 0 : !!interactionStyle
  );
  const nextUnfilledBox = (afterKey) => {
    const start = Math.max(0, BOX_ORDER.indexOf(afterKey));
    for (let i = 1; i <= BOX_ORDER.length; i++) {
      const k = BOX_ORDER[(start + i) % BOX_ORDER.length];
      if (!boxFilled(k)) return k;
    }
    return null;
  };
  const save = async (stay = false) => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      // 自由記述は直接公開しない（2026-07-16・憲法5条）：承認済み値と異なるキーだけをtexts_pendingに積み、運営承認で公開される
      const desiredTexts = {
        owner_comment: ownerComment || "", intro_path: introPath || "", intro_joy: introJoy || "",
        intro_crops: introCrops || "", intro_atmosphere: introAtmosphere || "", intro_message: introMessage || "",
        unique_point: uniquePoint || "", always_do: alwaysDo || "", break_style: breakStyle || "",
        transport_area: hasTransport ? (transportArea || "") : "",
        commute_allowance_detail: hasCommuteAllowance ? (commuteAllowanceDetail || "") : "",
        supplies_cap: employerPaysSupplies ? (suppliesCap.trim() || "") : "",
      };
      const textsPending = {};
      Object.keys(desiredTexts).forEach(k => { if (desiredTexts[k] !== (approvedTextsRef.current[k] ?? "")) textsPending[k] = desiredTexts[k]; });
      const { error } = await supabase.from("employer_profiles").upsert({
        auth_id: session.user.id, nickname: nickname.trim(), pr: pr.trim(),
        place_zip: placeZip.trim(), place_prefecture: placePref.trim(), place_city: placeCity.trim(),
        place_town: placeTown.trim(), place_address: placeAddr.trim(),
        has_transport: hasTransport, has_parking: hasParking, has_commute_allowance: hasCommuteAllowance,
        has_bonus: hasBonus, employer_pays_supplies: employerPaysSupplies, accessory_ok: accessoryOk,
        parking_capacity: hasParking && parkingCapacity !== "" ? Number(parkingCapacity) : null,
        staff_count: staffCount === "" ? null : Number(staffCount),
        interaction_style: interactionStyle || null,
        texts_pending: textsPending,
        texts_submitted_at: Object.keys(textsPending).length > 0 ? new Date().toISOString() : null,
        // 再提出で修正依頼フラグ（赤帯）を解除（2026-07-19）
        ...(Object.keys(textsPending).length > 0 ? { texts_revision_requested_at: null } : {}),
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      setSaving(false);
      if (!error) {
        setSaved(true);
        if (stay === true) {
          // 保存→次の未入力ボックスへ（全て入力済みなら閉じる・2026-07-16）。
          // BOX_ORDER外のボックス（保険=ホームから開く移植分）は次へ送らず閉じる
          const nxt = BOX_ORDER.includes(editBox) ? nextUnfilledBox(editBox) : null;
          if (nxt) setEditBox(nxt); else closeEditBox();
          setTimeout(() => setSaved(false), 2200);
        }
        else setTimeout(() => { setSaved(false); if (typeof onDone === "function") onDone(); }, 900);
      }
      else alert("保存に失敗しました：" + error.message);
    } catch { setSaving(false); alert("保存に失敗しました。"); }
  };
  if (loading) return <p className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>;
  const perksOn = [hasTransport&&"送迎", hasParking&&"駐車場", hasCommuteAllowance&&"通勤手当", hasBonus&&"賞与", employerPaysSupplies&&"持ち物負担", accessoryOk&&"アクセサリーOK"].filter(Boolean);
  const introFilled = [introPath, introJoy, introCrops, introAtmosphere, introMessage, ownerComment].filter(t => t && t.trim()).length;
  const askFilled = [uniquePoint, alwaysDo, breakStyle].filter(t => t && t.trim()).length;
  return (
    <div style={{ gridColumn:"1/-1", maxWidth:680 }}>
      {/* 右上に保存・プレビュー（2026-07-14・働き手編集ページと同一構造）。プレビューはモーダル展開 */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:4 }}>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", letterSpacing:".08em", margin:0 }}>雇い手プロフィール</p>
        <div style={{ display:"flex", gap:8, flexShrink:0 }}>
          <button onClick={()=>setShowPreview(true)} className="f-sans" style={{ padding:"9px 16px", fontSize:13, fontWeight:600, background:"#fff", color:"#222", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>プレビュー</button>
          <button onClick={()=>save(true)} disabled={saving} className="btn-primary f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, borderRadius:10 }}>{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>求人に掲載したとき、働き手に伝わる紹介です。タップして入力できます。</p>

      {/* ═══ ボックス格子（働き手編集ページと全く同じ様式・タップでモーダル編集・2026-07-14） ═══ */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {[
          // req:true=看板の核（未入力なら浮遊アニメ）。それ以外は任意=未入力でも赤影のみ（2026-07-16）
          { k:"avatar",   e:"🖼️", l:"ロゴ・アイコン", req:true, v: avatarUrl ? "設定済み" : "" },
          { k:"nickname", e:"✏️", l:"農園名",         req:true, v: nickname },
          { k:"place",    e:"📍", l:"作業場所",       req:true, v: [placePref, placeCity, placeTown].filter(Boolean).join("") },
          { k:"perks",    e:"🎁", l:"待遇",           v: perksOn.join("・") },
          { k:"staff",    e:"👥", l:"従業員数",       v: staffCount !== "" ? `${staffCount}人` : "" },
          { k:"intro",    e:"🏡", l:"代表より",       v: introFilled > 0 ? `${introFilled}件記入` : "" },
          { k:"ask",      e:"💬", l:"問いかけ",       v: askFilled > 0 ? `${askFilled}件記入` : "" },
          { k:"style",    e:"🤝", l:"関わり方",       v: (INTERACTION_STYLE_OPTIONS.find(o => o.value === interactionStyle) || {}).label || "" },
        ].map(b => (
          // 未入力ボックスは赤影アニメで促す（2026-07-16）
          <button key={b.k} onClick={()=>setEditBox(b.k)} className={"f-sans" + (b.v ? "" : (b.req ? " cb-urgent-card" : " cb-urgent-still"))} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"20px 10px 16px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0 }}>
            {b.k === "avatar" ? <Avatar url={avatarUrl} name={nickname} size={36} /> : <span style={{ fontSize:34, lineHeight:1 }}>{b.e}</span>}
            <span style={{ fontSize:14, fontWeight:700, color:"#222" }}>{b.l}</span>
            <span style={{ fontSize:11, color: b.v ? "#00A86B" : "#B0B0B0", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.v || "未設定"}</span>
          </button>
        ))}
      </div>
      {saved && (
        <p className="f-sans" style={{ fontSize:12, color:"#00A86B", textAlign:"center", marginTop:14 }}>保存しました ✓</p>
      )}
      {onCancel && (
        <button onClick={onCancel} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", marginTop:14, background:"none", border:"none", cursor:"pointer", fontSize:13, color:"#717171", textDecoration:"underline" }}>プレビューに戻る</button>
      )}

      {/* ═══ 編集モーダル（各ボックスの中身。保存はモーダル内の「保存する」＝全項目upsert） ═══ */}
      {editBox && (
      <div onClick={closeEditBox} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px 16px calc(64px + 10px + env(safe-area-inset-bottom, 0px))", animation:"fadeIn .2s ease" }}>{/* 下余白=下部フッター64px+10px：編集ボックスがフッターに重ならない（2026-07-16） */}
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:520, width:"100%", maxHeight:"100%", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
      <button onClick={closeEditBox} style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer", zIndex:1 }}>✕</button>

      {editBox==="avatar" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>ロゴ・アイコン</label>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", border:"1.5px solid #00A86B", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0 }}>
          <Avatar url={avatarUrl} name={nickname} size={64} />
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
      </>)}

      {editBox==="nickname" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>農園名・屋号・社名</label>
      <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="例：山川ファーム / 千歳農園" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      </>)}

      {editBox==="place" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>作業場所（集合場所の既定値）</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:10, lineHeight:1.6 }}>求人作成の集合場所で「復元」を押すと、ここの住所が入ります。番地・建物名は公開されません。</p>
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>郵便番号</label>
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <input value={placeZip} onChange={e=>{ setPlaceZip(e.target.value); setPlaceZipError(""); }} placeholder="例：779-3401" className="field f-sans" style={{ flex:1, fontSize:14, marginBottom:0 }} />
        <button onClick={searchPlaceZip} disabled={placeZipBusy} className="f-sans" style={{ padding:"0 14px", borderRadius:8, border:"1px solid #DADADA", background:"#fff", color:"#222", fontSize:12, fontWeight:600, cursor: placeZipBusy ? "default" : "pointer", whiteSpace:"nowrap" }}>{placeZipBusy ? "検索中..." : "住所を検索"}</button>
      </div>
      {placeZipError && <p className="f-sans" style={{ fontSize:12, color:"#E53935", marginBottom:8 }}>{placeZipError}</p>}
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>都道府県</label>
      <input value={placePref} onChange={e=>setPlacePref(e.target.value)} placeholder="例：徳島県" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>市区町村</label>
      <input value={placeCity} onChange={e=>setPlaceCity(e.target.value)} placeholder="例：吉野川市" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>町域</label>
      <input value={placeTown} onChange={e=>setPlaceTown(e.target.value)} placeholder="例：山川町〇〇" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
      <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>番地・建物名</label>
      <input value={placeAddr} onChange={e=>setPlaceAddr(e.target.value)} placeholder="例：1-2-3 〇〇ハイツ101" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
      </>)}

      {editBox==="perks" && (<>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>求人に共通する条件</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:8, lineHeight:1.6 }}>ここで設定した内容は、あなたが出す全ての求人に共通して表示されます。</p>
      <div style={{ marginBottom:16, borderTop:"1px solid #EBEBEB" }}>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch label="送迎" checked={hasTransport} onChange={setHasTransport} />
          {hasTransport && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={transportArea} onChange={e=>setTransportArea(e.target.value)} placeholder="例：吉野川市内" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch label="駐車場" checked={hasParking} onChange={setHasParking} />
          {hasParking && (
            <div style={{ marginLeft:16, paddingBottom:12, display:"flex", alignItems:"center", gap:8 }}>
              <input type="number" value={parkingCapacity} onChange={e=>setParkingCapacity(e.target.value)} placeholder="3" className="field f-sans" style={{ width:80, fontSize:13 }} />
              <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>台まで駐車できます</span>
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch label="通勤手当" checked={hasCommuteAllowance} onChange={setHasCommuteAllowance} />
          {hasCommuteAllowance && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={commuteAllowanceDetail} onChange={e=>setCommuteAllowanceDetail(e.target.value)} placeholder="例：上限500円 / 実費支給" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}><ToggleSwitch label="賞与" checked={hasBonus} onChange={setHasBonus} /></div>
        <div style={{ borderBottom:"1px solid #EBEBEB" }}>
          <ToggleSwitch label="持ち物は農家負担" checked={employerPaysSupplies} onChange={setEmployerPaysSupplies} />
          {employerPaysSupplies && (
            <div style={{ marginLeft:16, paddingBottom:12 }}>
              <input value={suppliesCap} onChange={e=>setSuppliesCap(e.target.value)} placeholder="上限の設定（例：上限1,000円まで / 軍手・長靴のみ）" className="field f-sans" style={{ width:"100%", fontSize:13 }} />
            </div>
          )}
        </div>
        <div><ToggleSwitch label="アクセサリーOK" checked={accessoryOk} onChange={setAccessoryOk} /></div>
      </div>
      </>)}

      {/* 旧「📝農園の紹介を書く」アコーディオンは廃止（2026-07-14）：中身を従業員数/農園紹介/問いかけ/関わり方の各ボックスに分割 */}
      {editBox==="staff" && (<>
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>従業員数（任意）</label>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
              <input type="number" value={staffCount} onChange={e=>setStaffCount(e.target.value)} placeholder="例：3" className="field f-mono" style={{ fontSize:16, maxWidth:100 }} />
              <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>人</span>
            </div>
      </>)}

      {editBox==="intro" && (<>
            {/* 農園紹介→代表よりに改名・代表よりの入力を最上段へ（2026-07-16） */}
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>代表より</label>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:12, lineHeight:1.6 }}>働き手への一言と、書きたいお題だけ記入してください（任意）</p>
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>代表より（任意）</label>
            <textarea
              value={ownerComment}
              onChange={e => setOwnerComment(e.target.value)}
              maxLength={1000}
              style={{ background:"#fff", color:"#222", width:"100%", minHeight:100, padding:"12px", fontSize:14, lineHeight:1.7, border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit", marginBottom:4 }}
            />
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:0, marginBottom:16, textAlign:"right" }}>{ownerComment.length} / 1000</p>
            <div className="employer-intro-grid" style={{ marginBottom:16 }}>
              {[
                { label:"就農するまで", value:introPath, set:setIntroPath },
                { label:"いま楽しいこと", value:introJoy, set:setIntroJoy },
                { label:"どんな作物を、どんな想いで", value:introCrops, set:setIntroCrops },
                { label:"職場の雰囲気", value:introAtmosphere, set:setIntroAtmosphere },
                { label:"初めての人へのメッセージ", value:introMessage, set:setIntroMessage },
              ].map((topic, i) => (
                <div key={i}>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>{topic.label}（任意）</label>
                  <textarea
                    value={topic.value}
                    onChange={e => topic.set(e.target.value)}
                    maxLength={1000}
                    style={{ background:"#fff", color:"#222", width:"100%", minHeight:100, padding:"12px", fontSize:14, lineHeight:1.7, border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
                  />
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4, textAlign:"right" }}>{topic.value.length} / 1000</p>
                </div>
              ))}
            </div>
      </>)}

      {editBox==="ask" && (<>
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>働き手への問いかけ</label>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:12, lineHeight:1.6 }}>書きたい問いだけ、記入してください（任意）</p>
            <div className="employer-intro-grid" style={{ marginBottom:16 }}>
              {[
                { label:"うちの畑・農園のユニークなところ", placeholder:"例：吉野川の川霧が育てるナスです", value:uniquePoint, set:setUniquePoint },
                { label:"働きに来た人に、いつもしていること", placeholder:"例：最初に全体をひと回り案内します", value:alwaysDo, set:setAlwaysDo },
                { label:"休憩とお茶はどうしてる？", placeholder:"例：10時と15時に冷たいお茶を出します", value:breakStyle, set:setBreakStyle },
              ].map((topic, i) => (
                <div key={i}>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>{topic.label}（任意）</label>
                  <textarea
                    value={topic.value}
                    onChange={e => topic.set(e.target.value)}
                    placeholder={topic.placeholder}
                    maxLength={1000}
                    style={{ background:"#fff", color:"#222", width:"100%", minHeight:100, padding:"12px", fontSize:14, lineHeight:1.7, border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
                  />
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:4, textAlign:"right" }}>{topic.value.length} / 1000</p>
                </div>
              ))}
            </div>
      </>)}

      {editBox==="style" && (<>
            <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>作業中の関わり方（任意）</label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
              {INTERACTION_STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setInteractionStyle(cur => cur === opt.value ? "" : opt.value)}
                  className="f-sans"
                  style={{
                    padding:"8px 16px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer",
                    border: interactionStyle === opt.value ? "1.5px solid #00A86B" : "1px solid #EBEBEB",
                    background: interactionStyle === opt.value ? "#E6F7EF" : "#fff",
                    color: interactionStyle === opt.value ? "#00A86B" : "#222",
                  }}
                >{opt.label}</button>
              ))}
            </div>
      </>)}

      {/* モーダルフッター：保存する（全項目upsert）→格子に戻る */}
      <button onClick={()=>save(true)} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, marginTop:4 }}>{saving ? "保存中..." : "保存する"}</button>
      </div>
      </div>
      )}

      {/* ═══ プレビューモーダル（保存済みの内容を表示） ═══ */}
      {showPreview && (
        <div onClick={()=>setShowPreview(false)} style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none" }}>
          {/* 求人・働き手プレビューと同型のボックス：ポップアップ0.8秒・下限=下部フッター+10px（2026-07-16） */}
          {/* touchAction/overscrollBehavior: iOSでスクロールが背面ページに奪われるのを防ぐ（2026-07-14） */}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, padding:"20px", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}>
            <button onClick={()=>setShowPreview(false)} style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:18, cursor:"pointer", zIndex:1 }}>✕</button>
            <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"0 0 8px" }}>プレビュー（保存済みの内容）・項目をタップで編集できます</p>
            <FarmerProfilePreview me={me} onEdit={()=>setShowPreview(false)}
              onEditItem={(key)=>{ setShowPreview(false); setEditFromPreview(true); setEditBox(key); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function FarmerProfilePreview({ me, onEdit, onEditItem }) {
  const [data, setData] = useState(null);
  const [trust, setTrust] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data: ep } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (ep) setData(ep);
        const { data: t } = await supabase.rpc('employer_trust_info', { p_farmer_id: session.user.id });
        setTrust(t || null);
      } catch {}
      setLoading(false);
    })();
  }, []);
  if (loading) return <p className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>;
  const isEmpty = !data || (!data.nickname && !data.pr && !data.avatar_url);
  const perks = data ? [
    { on: data.has_transport, label: `🚗送迎あり${data.transport_area ? "（" + data.transport_area + "）" : ""}` },
    { on: data.has_parking, label: `🅿️駐車場あり${data.parking_capacity ? "（" + data.parking_capacity + "台）" : ""}` },
    { on: data.has_commute_allowance, label: `💰通勤手当あり${data.commute_allowance_detail ? "（" + data.commute_allowance_detail + "）" : ""}` },
    { on: data.has_bonus, label: "🎁賞与あり" },
    { on: data.employer_pays_supplies, label: "🎒持ち物は農家負担" },
    { on: data.accessory_ok, label: "💍アクセサリーOK" },
  ].filter(p => p.on) : [];
  const topics = data ? [
    { label:"就農するまで", body: data.intro_path },
    { label:"いま楽しいこと", body: data.intro_joy },
    { label:"どんな作物を、どんな想いで", body: data.intro_crops },
    { label:"職場の雰囲気", body: data.intro_atmosphere },
    { label:"初めての人へのメッセージ", body: data.intro_message },
  ].filter(t => t.body && t.body.trim()) : [];
  const comment = data?.owner_comment && data.owner_comment.trim();
  const qa = data ? farmHostQa(data) : [];
  const hasTrustCard = data ? (qa.length > 0 || !!data.interaction_style || !!(trust && trust.ok)) : false;
  return (
    <div style={{ gridColumn:"1/-1", maxWidth:680 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", letterSpacing:".08em", marginBottom:4 }}>雇い手プロフィール</p>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:20, lineHeight:1.7 }}>求人詳細で、働き手にこのように表示されます。</p>
      {isEmpty ? (
        <div style={{ textAlign:"center", padding:"32px 20px", border:"1px solid #EBEBEB", borderRadius:16, marginBottom:20 }} className="f-sans">
          <div style={{ fontSize:32, marginBottom:10 }}>🧑‍🌾</div>
          <p style={{ fontSize:13, color:"#717171", margin:0, lineHeight:1.7 }}>まだプロフィールがありません。紹介を書くと、働き手に安心して応募してもらいやすくなります。</p>
        </div>
      ) : (
        <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"20px", marginBottom:20 }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", marginBottom: perks.length ? 14 : 0 }}>
            <div onClick={onEditItem ? ()=>onEditItem("avatar") : undefined} role={onEditItem ? "button" : undefined} style={{ width:56, height:56, borderRadius:"50%", border:"1.5px solid #00A86B", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", marginBottom:8, ...(onEditItem ? { cursor:"pointer" } : {}) }}>
              <Avatar url={data.avatar_url} name={data.nickname} size={56} />
            </div>
            <p onClick={onEditItem ? ()=>onEditItem("nickname") : undefined} role={onEditItem ? "button" : undefined} className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, marginBottom:2, ...(onEditItem ? { cursor:"pointer" } : {}) }}>{data.nickname || "農園名未設定"}</p>
            {/* 旧・自己PR枠は代表より（owner_comment）に差し替え（2026-07-16）。タップで農園紹介ボックスを編集 */}
            {comment && (
              <p onClick={onEditItem ? ()=>onEditItem("intro") : undefined} role={onEditItem ? "button" : undefined} className="f-sans" style={{ fontSize:13, color:"#717171", margin:0, overflowWrap:"break-word", wordBreak:"break-word", ...(onEditItem ? { cursor:"pointer" } : {}) }}>{comment.length > 100 ? comment.slice(0, 100) + "…" : comment}</p>
            )}
          </div>
          {perks.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {perks.map((p, i) => (
                <span key={i} onClick={onEditItem ? ()=>onEditItem("perks") : undefined} role={onEditItem ? "button" : undefined} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#00A86B", background:"#E6F7EF", padding:"5px 12px", borderRadius:20, ...(onEditItem ? { cursor:"pointer" } : {}) }}>{p.label}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {(topics.length > 0 || comment || hasTrustCard) && (
        <div style={{ marginBottom:20 }}>
          <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:16 }}>
            {data.nickname ? `${data.nickname}の農園紹介` : "農園紹介"}
          </h3>
          {hasTrustCard && (
            <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom: (topics.length > 0 || comment) ? 16 : 0 }}>
              <FarmerTrustCard profile={data} trust={trust} onEditItem={onEditItem} />
            </div>
          )}
          {topics.length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(min(100%,280px), 1fr))", gap:16, marginBottom:0 }}>
              {topics.map((t, i) => (
                <div key={i} onClick={onEditItem ? ()=>onEditItem("intro") : undefined} role={onEditItem ? "button" : undefined} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", ...(onEditItem ? { cursor:"pointer" } : {}) }}>
                  <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>{t.label}</p>
                  <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{t.body}</p>
                </div>
              ))}
            </div>
          )}
          {/* 下部の代表よりカードは削除（2026-07-16）：名前下に移設したため重複回避 */}
        </div>
      )}
      {/* 「編集する」ボタンは削除（2026-07-16）：項目タップ編集に一本化 */}
    </div>
  );
}


function FarmerDashboard({ onNewJob, onResume, me }) {
  const hashToJobTab = () => {
    const h = window.location.hash.replace(/^#\/?/,"");
    if (h === "profile/employer/profile") return "profile";
    if (h === "profile/employer/drafts") return "draft";
    if (h === "profile/employer/active") return "active";
    if (h === "profile/employer/applicants") return "applicants";
    if (h === "profile/employer/expired") return "expired";
    if (h === "profile/employer/calendar") return "calendar";
    if (h === "profile/employer") return "home"; // 入口はAirbnb型カードメニュー（2026-07-14）
    return null;
  };
  const [jobTab, setJobTab] = useState(() => {
    try { const j = hashToJobTab(); if (j) return j; } catch {}
    return (sessionStorage.getItem("cb_afterDraftSave")==="1") ? "draft" : "home";
  });
  useEffect(() => {
    const onHash = () => { const j = hashToJobTab(); if (j) setJobTab(j); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // 下部バー「プロフィール」タップ＝農家プロのトップへ（同hash時＝hashchangeが出ない場合の保険）
  useEffect(() => {
    const onEmployerHome = () => setJobTab("home");
    window.addEventListener("cb:employerHome", onEmployerHome);
    return () => window.removeEventListener("cb:employerHome", onEmployerHome);
  }, []);
  // ── 面接の質問集（2026-07-23）：農家が質問セット(タイトル＋質問1〜5)を作り、応募者チャットに投函 ──
  const [questionSets, setQuestionSets] = useState([]);
  const [qMgrOpen, setQMgrOpen] = useState(false);      // 管理モーダル
  const qMgrScrollY = useRef(0);                        // 質問集を開く直前のハブのスクロール位置（閉じたら元の場所へ戻す・2026-07-24）
  // 質問集フルページ(.qset-full)は body{overflow:hidden;height:100%} で開くため、閉じるとハブ先頭へ飛ぶ。開く前の位置を控えて復元する
  const openQMgr = () => { qMgrScrollY.current = window.scrollY; setQEditing(null); setQMgrOpen(true); };
  const closeQMgr = () => { const y = qMgrScrollY.current; setQMgrOpen(false); requestAnimationFrame(() => window.scrollTo(0, y)); };
  const [qEditing, setQEditing] = useState(null);       // 編集中セット {id?, title, questions:[...]}（null=一覧）
  const [qSaving, setQSaving] = useState(false);
  const [sendQTarget, setSendQTarget] = useState(null); // 「質問を送る」対象の応募(a)
  const [sendingQ, setSendingQ] = useState(false);
  const loadQuestionSets = async () => {
    if (!me?.id) { setQuestionSets([]); return; }
    try {
      // 初回はデフォルト3種を用意してから読み込む（準備しておく・2026-07-23）
      const list = await ensureDefaultQuestionSets(me.id);
      setQuestionSets(list);
    } catch {}
  };
  useEffect(() => { loadQuestionSets(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [me?.id]);
  const saveQuestionSet = async () => {
    if (!qEditing || !me?.id) return;
    const title = (qEditing.title || "").trim();
    const questions = (qEditing.questions || []).map(q => (q || "").trim()).filter(Boolean).slice(0, 5);
    if (!title && questions.length === 0) { alert("タイトルか質問を入力してください"); return; }
    setQSaving(true);
    try {
      if (qEditing.id) {
        const { error } = await supabase.from("farmer_question_sets").update({ title, questions, updated_at: new Date().toISOString() }).eq("id", qEditing.id).eq("farmer_id", me.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("farmer_question_sets").insert({ farmer_id: me.id, title, questions });
        if (error) throw error;
      }
      await loadQuestionSets();
      setQEditing(null);
    } catch (e) { alert("保存に失敗しました：" + (e?.message || "不明")); }
    finally { setQSaving(false); }
  };
  const deleteQuestionSet = async (id) => {
    if (!id || !confirm("この質問集を削除しますか？")) return;
    try {
      const { error } = await supabase.from("farmer_question_sets").delete().eq("id", id).eq("farmer_id", me.id);
      if (error) throw error;
      await loadQuestionSets();
      setQEditing(null);
    } catch (e) { alert("削除に失敗しました：" + (e?.message || "不明")); }
  };
  const sendInterviewQuestions = async (setId) => {
    if (!sendQTarget || sendingQ) return;
    setSendingQ(true);
    try {
      const { data, error } = await supabase.rpc("send_interview_questions", { p_application_id: sendQTarget.id, p_set_id: setId });
      if (error || !data?.ok) { alert("送信に失敗しました：" + (data?.message || data?.reason || error?.message || "不明")); setSendingQ(false); return; }
      const appId = sendQTarget.id;
      setSendQTarget(null); setSendingQ(false);
      if (confirm("チャットに質問を送りました。チャットを開きますか？")) window.location.hash = "/chat/" + appId;
    } catch (e) { alert("送信に失敗しました：" + (e?.message || "不明")); setSendingQ(false); }
  };
  // 作成中⇄公開中ページャー（2026-07-16）：2枚のパネルを横並びにし、指に追従して実際に横移動させる。
  // 横ロック判定後はtrackのtransformを直接書く（state経由だと1フレーム遅れてカクつくため）。
  // 端（作成中で右・公開中で左）は1/3の抵抗。離した時に幅の1/4（最大80px）を超えていたらタブ確定
  const pagerTrackRef = useRef(null);
  const pagerDrag = useRef(null); // {x, y, dx, lock:"h"|"v"|null, w}
  const pagerBasePct = () => (jobTab === "draft" ? 0 : -50);
  const onPagerStart = (e) => {
    pagerDrag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: null, w: e.currentTarget.clientWidth || 1 };
  };
  const onPagerMove = (e) => {
    const s = pagerDrag.current, el = pagerTrackRef.current;
    if (!s || !el) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 方向が定まるまで様子見
      s.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (s.lock !== "h") return; // 縦スクロール中は関与しない
    const atEdge = (jobTab === "draft" && dx > 0) || (jobTab === "active" && dx < 0);
    s.dx = atEdge ? dx / 3 : dx;
    el.style.transition = "none";
    el.style.transform = `translateX(calc(${pagerBasePct()}% + ${s.dx}px))`;
  };
  const onPagerEnd = () => {
    const s = pagerDrag.current, el = pagerTrackRef.current;
    pagerDrag.current = null;
    if (!s || !el || s.lock !== "h") return;
    el.style.transition = "transform .3s ease"; // dragで消したtransitionはReactが復元しないので手で戻す
    const threshold = Math.min(80, s.w / 4);
    if (jobTab === "draft" && s.dx < -threshold) {
      el.style.transform = "translateX(-50%)";
      setJobTab("active"); window.location.hash = "/profile/employer/active";
    } else if (jobTab === "active" && s.dx > threshold) {
      el.style.transform = "translateX(0%)";
      setJobTab("draft"); window.location.hash = "/profile/employer/drafts";
    } else {
      el.style.transform = `translateX(${pagerBasePct()}%)`; // 届かなければ元の位置へスナップバック
    }
  };
  const [dbDrafts, setDbDrafts] = useState([]);
  const [dbActive, setDbActive] = useState([]);
  // 働く日を決める（2026-07-24 追記3）：期間求人・承認後、農家が働く日を確定する。agreeModal=対象の応募／agreeSel=選択中
  const [agreeModal, setAgreeModal] = useState(null);
  const [agreeSel, setAgreeSel] = useState([]);
  const [agreeSaving, setAgreeSaving] = useState(false);
  const [qUnansweredMap, setQUnansweredMap] = useState({}); // { job_number: 未回答質問数 }（第10弾・求人カードのバッジ）
  const [dbExpired, setDbExpired] = useState([]); // 作業日程が過ぎた自分の求人（statusは持たず日付から導出・2026-07-16）
  const [dbApplicants, setDbApplicants] = useState([]);
  const [jobInfoMap, setJobInfoMap] = useState({}); // job_number→{crop,task}（応募者を求人毎に分ける見出し用・2026-07-19）
  const [workerProfiles, setWorkerProfiles] = useState({});
  const [workerTrust, setWorkerTrust] = useState({}); // { [worker_id]: {joined_at, verified_at} }
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [profileMode, setProfileMode] = useState("preview");
  const [empMini, setEmpMini] = useState(null); // 入口メニューの大プロフィールカード用（全列・裏面プレビューにも使用）
  const [empTopBack, setEmpTopBack] = useState(() => { try { return localStorage.getItem("cb_empTopBack") === "1"; } catch { return false; } }); // トップボックスの裏面表示。切り返した画面で固定（localStorageに永続・2026-07-16）
  const [empTopAnim, setEmpTopAnim] = useState("");    // 反転アニメ: pflip-out|pflip-in（0.4s×2=0.8秒）
  // 未設定の項目数（編集ページの8ボックス基準）。トップボックスの通知バッジ＋赤影に使用（2026-07-16・働き手側と同構造）
  // 核（アイコン・農園名・作業場所）が未設定→赤影＋浮遊アニメ／任意のみ未設定→赤影のみ（紹介PR→作業場所に差替・2026-07-16）
  const empUnsetReq = empMini ? [
    !!empMini.avatar_url,
    !!(empMini.nickname || "").trim(),
    !!(empMini.place_city || "").trim(),
  ].filter(x => !x).length : 3;
  const empUnsetCount = empMini ? empUnsetReq + [
    !!(empMini.has_transport || empMini.has_parking || empMini.has_commute_allowance || empMini.has_bonus || empMini.employer_pays_supplies || empMini.accessory_ok),
    empMini.staff_count !== null && empMini.staff_count !== undefined && empMini.staff_count !== "",
    [empMini.intro_path, empMini.intro_joy, empMini.intro_crops, empMini.intro_atmosphere, empMini.intro_message, empMini.owner_comment].some(t => t && String(t).trim()),
    [empMini.unique_point, empMini.always_do, empMini.break_style].some(t => t && String(t).trim()),
    !!empMini.interaction_style,
  ].filter(x => !x).length : 8;
  // 自由記述の審査状態（2026-07-19）：審査待ち=帯＋タップ不能／修正依頼中（差し戻し済み）=赤帯（修正のためタップは可能）
  const empHasPending = !!(empMini && empMini.texts_pending && Object.keys(empMini.texts_pending).length > 0);
  const empReview = empHasPending ? "pending" : (empMini?.texts_revision_requested_at ? "revision" : null);
  const [rosterRows, setRosterRows] = useState([]); // また呼びたいリスト（repeat_roster＋worker_profiles結合済み）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setDraftsLoading(false); return; }
        const { data: epMini } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle(); // トップボックス裏面プレビュー用に全列（2026-07-16）
        if (epMini) setEmpMini(epMini);
        const { data: rosterData } = await supabase.from("repeat_roster").select("worker_id,created_at").eq("farmer_id", session.user.id).order("created_at",{ascending:false});
        if (rosterData && rosterData.length > 0) {
          const { data: rosterWp } = await supabase.from("worker_profiles").select("auth_id,nickname,avatar_url").in("auth_id", rosterData.map(r => r.worker_id));
          const wpMap = {};
          (rosterWp || []).forEach(wp => { wpMap[wp.auth_id] = wp; });
          setRosterRows(rosterData.map(r => ({ worker_id: r.worker_id, nickname: wpMap[r.worker_id]?.nickname || null, avatar_url: wpMap[r.worker_id]?.avatar_url || null })));
        }
        // 自分の求人を一括取得し、日付で仕分ける：終了日(無ければ開始日)が昨日以前＝期限切れ。
        // 「期限切れ」というstatusはDBに存在しない（導出のみ）。当日の求人はまだ現役扱い
        // opened_at＝一時非公開（掲載歴あり）判定に必須（2026-07-16）。固定列SELECTに入れ忘れると一時非公開が作成中へ落ちる
        const { data: allJobs, error } = await supabase.from("jobs").select("job_number,crop,task,date_label,prefecture,city,pay_type,hourly_wage,daily_wage,photos,status,date_start,date_end,work_time,opened_at").eq("farmer_id", session.user.id).order("job_number",{ascending:false});
        if (!error && allJobs) {
          setJobInfoMap(Object.fromEntries(allJobs.map(j => [j.job_number, { crop: j.crop, task: j.task, date_start: j.date_start, date_end: j.date_end }])));
          const todayYmd = ymdLocal(new Date());
          const isPast = (j) => {
            const end = j.date_end || j.date_start;
            if (!end) return false;
            if (end < todayYmd) return true;
            // 最終日が今日で、勤務終了時刻を過ぎていれば終了（例：17:00〜19:00 は19時以降）
            if (end === todayYmd && j.work_time) {
              const m = String(j.work_time).match(/〜\s*(\d{1,2}):(\d{2})/);
              if (m) { const n = new Date(); if (n.getHours()*60 + n.getMinutes() > parseInt(m[1],10)*60 + parseInt(m[2],10)) return true; }
            }
            return false;
          };
          // 一時非公開（status=draftだが掲載歴opened_atあり）は作成中でなく公開中タブに帯付きで残す（2026-07-16）
          const isUnpublished = (j) => j.status === "draft" && !!j.opened_at;
          // 作成中タブ＝作成中＋審査中／公開中タブ＝公開中＋一時非公開（2026-07-16たきと指定）
          setDbDrafts(allJobs.filter(j => ((j.status === "draft" && !j.opened_at) || j.status === "pending") && !isPast(j)));
          setDbActive(allJobs.filter(j => (j.status === "open" || isUnpublished(j)) && !isPast(j)));
          setDbExpired(allJobs.filter(isPast));
          // 未回答の質問数を集計（第10弾）：自分の求人の、回答なし・非表示でない質問
          try {
            const nums = allJobs.map(j => j.job_number);
            if (nums.length > 0) {
              const { data: qs } = await supabase.from("job_questions").select("job_number").is("answer", null).eq("hidden", false).in("job_number", nums);
              const m = {};
              (qs || []).forEach(q => { m[q.job_number] = (m[q.job_number] || 0) + 1; });
              setQUnansweredMap(m);
            }
          } catch {}
        }
        const { data: appData, error: appErr } = await supabase.from("applications").select("*").eq("farmer_id", session.user.id).order("created_at",{ascending:false});
        if (!appErr && appData) {
          setDbApplicants(appData);
          const workerIds = [...new Set(appData.map(a => a.worker_id).filter(Boolean))];
          if (workerIds.length > 0) {
            const { data: wpData, error: wpErr } = await supabase.from("worker_profiles").select("*").in("auth_id", workerIds);
            if (!wpErr && wpData) {
              const map = {};
              wpData.forEach(wp => { map[wp.auth_id] = wp; });
              setWorkerProfiles(map);
            }
            const trustResults = await Promise.all(workerIds.map(id => supabase.rpc('worker_trust_info', { p_worker_id: id })));
            const trustMap = {};
            trustResults.forEach((r, i) => { if (r.data && r.data.ok) trustMap[workerIds[i]] = r.data; });
            setWorkerTrust(trustMap);
          }
          // 緊急連絡ディープリンク着地：該当応募にバインドしてモーダル自動展開（#/emergency/{id}→resolveEmergencyLink経由）
          try {
            const pend = sessionStorage.getItem("cb_emergencyAppId");
            if (pend) {
              sessionStorage.removeItem("cb_emergencyAppId");
              const target = appData.find(x => x.id === pend);
              if (target && CHAT_ELIGIBLE_STATUSES.includes(target.status)) openEmergencyModal(target);
            }
          } catch {}
          // 完了・評価モーダルの着地（2026-07-24）：今日ページの「完了して評価する」から cb_completeAppId 経由で自動展開（モーダルはここに常駐）
          try {
            const pendC = sessionStorage.getItem("cb_completeAppId");
            if (pendC) {
              sessionStorage.removeItem("cb_completeAppId");
              const target = appData.find(x => x.id === pendC);
              if (target && CHAT_ELIGIBLE_STATUSES.includes(target.status)) openCompleteModal(target);
            }
          } catch {}
          // 働く日を決めるモーダルの着地（2026-07-24）：今日ページの「日を決める」から cb_agreeAppId 経由で自動展開
          try {
            const pendA = sessionStorage.getItem("cb_agreeAppId");
            if (pendA) {
              sessionStorage.removeItem("cb_agreeAppId");
              const target = appData.find(x => x.id === pendA);
              if (target && CHAT_ELIGIBLE_STATUSES.includes(target.status)) { setAgreeModal(target); setAgreeSel(Array.isArray(target.agreed_dates) ? target.agreed_dates.slice() : []); }
            }
          } catch {}
        }
      } catch {}
      setDraftsLoading(false);
      try { if (sessionStorage.getItem("cb_afterDraftSave")==="1") { setJobTab("draft"); } sessionStorage.removeItem("cb_afterDraftSave"); } catch {}
    })();
  }, []);
  // 応募者タブを開くたびに応募の最新statusを取り直す（2026-07-16）。
  // 初回マウント時の1回だけだと、働き手側の操作（終了打刻→completed等）が進んでも
  // カードの帯が古いまま（契約のまま）になるため
  useEffect(() => {
    if (jobTab !== "applicants") return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data: appData } = await supabase.from("applications").select("*").eq("farmer_id", session.user.id).order("created_at", { ascending: false });
        if (!appData) return;
        setDbApplicants(appData);
        // 新しく増えた応募者のプロフィールも補充
        const missing = [...new Set(appData.map(a => a.worker_id).filter(Boolean))].filter(id => !workerProfiles[id]);
        if (missing.length > 0) {
          const { data: wpData } = await supabase.from("worker_profiles").select("*").in("auth_id", missing);
          if (wpData && wpData.length > 0) {
            setWorkerProfiles(prev => { const m = { ...prev }; wpData.forEach(wp => { m[wp.auth_id] = wp; }); return m; });
          }
        }
      } catch {}
    })();
  }, [jobTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const JOB_TABS = [
    { k:"profile", l:"雇い手プロフィール" },
    { k:"draft",   l:"作成中" },
    { k:"active",  l:"公開中" },
    { k:"applicants", l:"応募者" },
    { k:"expired", l:"期限切れ" },
    { k:"calendar", l:"カレンダー" },
  ];
  // ダミー撤去（憲法3条:表示にダミー禁止）。Phase2aでjobsテーブルから自分の求人を読む
  const jobList = [];

  // 開始の握手（Part4）
  const [startConfirmingId, setStartConfirmingId] = useState(null);
  const confirmStart = async (a) => {
    if (startConfirmingId) return;
    setStartConfirmingId(a.id);
    try {
      const { data, error } = await supabase.rpc('confirm_start', { p_application_id: a.id });
      if (!error && data && data.ok) {
        setDbApplicants(prev => prev.map(x => x.id===a.id ? { ...x, farmer_confirmed_start_at: new Date().toISOString() } : x));
      } else if (data && !data.ok) {
        alert('確認できませんでした：' + (data.reason || '不明'));
      }
    } catch { alert('確認に失敗しました。'); }
    setStartConfirmingId(null);
  };

  // 完了・評価モーダル（Part1）
  const [completeModalApp, setCompleteModalApp] = useState(null);
  const [completeStep, setCompleteStep] = useState('attend'); // 'attend' | 'review'
  const [completeWantAgain, setCompleteWantAgain] = useState(null);
  const [completeEntrust, setCompleteEntrust] = useState(null);
  const [completePublicComment, setCompletePublicComment] = useState("");
  const [completePrivateMemo, setCompletePrivateMemo] = useState("");
  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [completeNotifyNext, setCompleteNotifyNext] = useState(true); // また呼びたい=はい時のみ表示。ON=repeat_rosterへupsert
  const [completeDone, setCompleteDone] = useState(null); // 評価登録完了モーダル {jobLabel,jobNumber,workerId,workerName,at,wantAgain,entrust,publicComment,privateMemo,favorited}
  const openCompleteModal = (a) => {
    setCompleteModalApp(a); setCompleteStep('attend');
    setCompleteWantAgain(null); setCompleteEntrust(null);
    setCompletePublicComment(""); setCompletePrivateMemo("");
    setCompleteNotifyNext(true);
  };
  const markNoShow = async () => {
    if (!completeModalApp || completeSubmitting) return;
    if (!confirm('欠勤として記録します。働き手に通知され、72時間の異議申立ができます')) return;
    setCompleteSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('complete_work', { p_application_id: completeModalApp.id, p_attended: false });
      if (error || !data?.ok) { alert('記録に失敗しました：' + (data?.reason || error?.message || '不明')); setCompleteSubmitting(false); return; }
      setDbApplicants(prev => prev.map(x => x.id===completeModalApp.id ? { ...x, status:'completed', attended:false } : x));
      setCompleteModalApp(null);
    } catch { alert('記録に失敗しました。'); }
    setCompleteSubmitting(false);
  };
  const submitFarmerReview = async () => {
    if (!completeModalApp || completeWantAgain===null || completeEntrust===null || completeSubmitting) return;
    setCompleteSubmitting(true);
    try {
      // 原子化（2026-07-19）：完了処理・評価保存・お気に入り登録を1つのRPC＝1トランザクションで実行。
      // 送信ボタンのタップだけがトリガーで、途中失敗なら何も保存されない（中途半端な履歴が残らない）
      const { data, error } = await supabase.rpc('submit_farmer_review', {
        p_application_id: completeModalApp.id,
        p_want_again: completeWantAgain, p_entrust: completeEntrust,
        p_public_comment: completePublicComment.trim(), p_private_memo: completePrivateMemo.trim(),
        p_favorite: completeNotifyNext,
      });
      if (error || !data?.ok) { alert('送信に失敗しました（何も保存されていません）：' + (data?.reason || error?.message || '不明')); setCompleteSubmitting(false); return; }
      const favorited = !!data.favorited;
      if (favorited) {
        const wp = workerProfiles[completeModalApp.worker_id];
        setRosterRows(prev => prev.some(r => r.worker_id === completeModalApp.worker_id) ? prev
          : [{ worker_id: completeModalApp.worker_id, nickname: wp?.nickname || null, avatar_url: wp?.avatar_url || null }, ...prev]);
        setFavDetailOpen(false);
        setFavDone({ workerId: completeModalApp.worker_id, nickname: wp?.nickname || "", avatar_url: wp?.avatar_url || "" });
      }
      setDbApplicants(prev => prev.map(x => x.id===completeModalApp.id ? { ...x, status:'completed', attended:true } : x));
      // 評価登録完了モーダル用の控えを組み立てる（求人タイトルはdbActive→jobsの順で解決）
      let jobLabel = "";
      const cached = dbActive.find(d => d.job_number === completeModalApp.job_number) || dbDrafts.find(d => d.job_number === completeModalApp.job_number);
      if (cached) jobLabel = [cached.crop, cached.task].filter(Boolean).join(" ");
      else {
        try {
          const { data: jr } = await supabase.from("jobs").select("crop,task").eq("job_number", completeModalApp.job_number).eq("farmer_id", me.id).maybeSingle();
          if (jr) jobLabel = [jr.crop, jr.task].filter(Boolean).join(" ");
        } catch {}
      }
      setCompleteDone({
        jobLabel, jobNumber: completeModalApp.job_number,
        workerId: completeModalApp.worker_id,
        workerName: workerProfiles[completeModalApp.worker_id]?.nickname || "働き手",
        at: new Date().toLocaleString("ja-JP", { year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }),
        wantAgain: completeWantAgain, entrust: completeEntrust,
        publicComment: completePublicComment.trim(), privateMemo: completePrivateMemo.trim(),
        favorited,
      });
      setCompleteModalApp(null);
    } catch { alert('処理に失敗しました。'); }
    setCompleteSubmitting(false);
  };
  // お気に入り登録しました！ボックス（2026-07-19）：登録成功の瞬間に展開。アイコンに❤️が付く動作つき
  const [favDone, setFavDone] = useState(null); // {workerId, nickname, avatar_url}
  const [favDetailOpen, setFavDetailOpen] = useState(false);
  const [rosterInfoOpen, setRosterInfoOpen] = useState(false); // また呼びたいリストの説明：?マークタップで展開（既定は閉・情報過多回避・2026-07-19）
  const [showRoster, setShowRoster] = useState(false); // 記録と予定：また呼びたいリスト箱→モーダル（2026-07-22）
  const [eFlip, setEFlip] = useState(null); // 農家ハブ：？タップで反転して説明を出す箱のラベル（2026-07-22）
  const [appFilter, setAppFilter] = useState("all"); // 応募者タブの状態フィルタ（2026-07-22）
  const [appLegendOpen, setAppLegendOpen] = useState(false); // 応募者ページ下部「帯の意味」の説明ボックス開閉
  // 評価登録完了モーダル内のお気に入り登録チェック（ON=roster upsert／OFF=行削除）
  const toggleDoneFavorite = async (checked) => {
    if (!completeDone) return;
    try {
      if (checked) {
        const { error } = await supabase.from('repeat_roster').upsert(
          { farmer_id: me.id, worker_id: completeDone.workerId, notify: true },
          { onConflict: 'farmer_id,worker_id' }
        );
        if (error) { alert('登録に失敗しました：' + error.message); return; }
        const wp = workerProfiles[completeDone.workerId];
        setRosterRows(prev => prev.some(r => r.worker_id === completeDone.workerId) ? prev
          : [{ worker_id: completeDone.workerId, nickname: wp?.nickname || null, avatar_url: wp?.avatar_url || null }, ...prev]);
        setFavDetailOpen(false);
        setFavDone({ workerId: completeDone.workerId, nickname: wp?.nickname || "", avatar_url: wp?.avatar_url || "" });
      } else {
        const { error } = await supabase.from('repeat_roster').delete().eq('farmer_id', me.id).eq('worker_id', completeDone.workerId);
        if (error) { alert('解除に失敗しました：' + error.message); return; }
        setRosterRows(prev => prev.filter(r => r.worker_id !== completeDone.workerId));
      }
      setCompleteDone(prev => prev ? { ...prev, favorited: checked } : prev);
    } catch { alert('処理に失敗しました。'); }
  };
  // 求人カードタップ→確認ページと同型の全画面プレビュー（AdminJobPreviewのownerViewモード流用）
  const [previewJob, setPreviewJob] = useState(null); // { num: job_number, draft: bool（trueなら編集再開ボタンを出す） }
  // 応募者タブのグリッド用（働き手の承認済みタブと同設計・2026-07-16）
  const [sheetApplicantId, setSheetApplicantId] = useState(null); // タップした応募者のボトムシート
  const appRibbonLabel = (st) => st==="applied" ? "承認待ち" : st==="approved" ? "承認済み" : st==="rejected" ? "見送り" : st==="meeting" ? "打ち合わせ" : st==="interview" ? "面接" : st==="contracted" ? "契約" : st==="working" ? "作業中" : st==="completed" ? "完了" : st;
  // 状態ごとに色を全て分ける（同色は混乱するため・2026-07-22）。帯・凡例の唯一のソース
  const APP_COLORS = { applied:"#C77700", approved:"#00A86B", meeting:"#1E88E5", interview:"#8E24AA", contracted:"#00897B", working:"#E24B4A", completed:"#607D8B", rejected:"#9E9E9E" };
  const appRibbonColor = (st) => APP_COLORS[st] || "#00A86B";
  // 応募者ページの状態フィルタ（2026-07-22）：上部タブ＝タップ＋横スワイプで切替
  const APP_FILTERS = [
    { k:"all",       l:"すべて",   match: () => true },
    { k:"applied",   l:"承認待ち", match: (s) => s==="applied" },
    { k:"active",    l:"進行中",   match: (s) => ["approved","meeting","interview","contracted","working"].includes(s) },
    { k:"completed", l:"完了",     match: (s) => s==="completed" },
  ];
  const appSwipeRef = useRef(null);
  const onAppSwipeStart = (e) => { appSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onAppSwipeEnd = (e) => {
    const s = appSwipeRef.current; appSwipeRef.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // 横スワイプのみ
    const idx = Math.max(0, APP_FILTERS.findIndex(f => f.k === appFilter));
    const next = dx < 0 ? Math.min(APP_FILTERS.length - 1, idx + 1) : Math.max(0, idx - 1);
    setAppFilter(APP_FILTERS[next].k);
  };
  // 未完了＝農家側の対応が残っている応募（完了 or 見送りになるまで）
  const isApplicantDone = (a) => a.status === "completed" || a.status === "rejected";
  // 応募者の注意表示（2026-07-16）：未承認（承認待ち）＝赤影＋浮遊アニメ／保険未チェック＝赤影のみ（静止）
  const needsInsurance = (a) => APPROVED_PLUS_STATUSES.includes(a.status) && a.status !== "completed" && !a.insurance_prepared_at;
  const hasUnapprovedApplicant = dbApplicants.some(a => a.status === "applied");
  const hasInsurancePending = dbApplicants.some(needsInsurance);

  // また呼びたいリストのアイコンタップ→働き手詳細モーダル（応募者カードと同じWorkerTrustCard表示）
  const [rosterDetail, setRosterDetail] = useState(null); // {worker_id, loading, profile, trust}
  const openRosterDetail = (workerId) => {
    setRosterDetail({ worker_id: workerId, loading: true, profile: null, trust: null });
    (async () => {
      try {
        const [wpRes, trustRes] = await Promise.all([
          supabase.from("worker_profiles").select("*").eq("auth_id", workerId).maybeSingle(),
          supabase.rpc("worker_trust_info", { p_worker_id: workerId }),
        ]);
        setRosterDetail(prev => prev && prev.worker_id === workerId ? {
          worker_id: workerId, loading: false,
          profile: wpRes.data || null,
          trust: (trustRes.data && trustRes.data.ok) ? trustRes.data : null,
        } : prev);
      } catch {
        setRosterDetail(prev => prev && prev.worker_id === workerId ? { ...prev, loading: false } : prev);
      }
    })();
  };
  // また呼びたいリストの行削除（通知を止める）
  const stopRosterNotify = async (workerId) => {
    if (!confirm('この方への新求人のお知らせを止めますか？（次回の評価で再登録できます）')) return;
    try {
      const { error } = await supabase.from('repeat_roster').delete().eq('farmer_id', me.id).eq('worker_id', workerId);
      if (error) { alert('解除に失敗しました：' + error.message); return; }
      setRosterRows(prev => prev.filter(r => r.worker_id !== workerId));
    } catch { alert('解除に失敗しました。'); }
  };

  // 緊急連絡（Part3・農家側）
  const [emergencyModalApp, setEmergencyModalApp] = useState(null);
  const [emergencyKind, setEmergencyKind] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [emergencySubmitting, setEmergencySubmitting] = useState(false);
  const [emergencySent, setEmergencySent] = useState(false);
  const [emergencySentAt, setEmergencySentAt] = useState("");
  const [emergencyCtx, setEmergencyCtx] = useState(null); // 状況カード {jobNumber,jobLabel,dateLabel,partnerName}
  const openEmergencyModal = (a) => {
    setEmergencyModalApp(a); setEmergencyKind(""); setEmergencyReason(""); setEmergencySent(false);
    // 「何についての連絡か」を開いた瞬間に見せる（焦っている人に思い出させない）。詳細は非同期で追記
    setEmergencyCtx({ jobNumber: a.job_number, jobLabel: "", dateLabel: "", partnerName: workerProfiles[a.worker_id]?.nickname || "" });
    (async () => {
      try {
        const { data: job } = await supabase.from("jobs").select("crop,task,date_start,work_time").eq("job_number", a.job_number).eq("farmer_id", me.id).maybeSingle();
        setEmergencyCtx(prev => prev && prev.jobNumber === a.job_number ? {
          ...prev,
          jobLabel: job ? [job.crop, job.task].filter(Boolean).join(" ") : "",
          dateLabel: job && job.date_start ? calFmtDate(job.date_start) + (job.work_time ? " " + job.work_time.split("〜")[0] + "〜" : "") : "",
        } : prev);
      } catch {}
    })();
  };
  const submitEmergency = async () => {
    if (!emergencyModalApp || !emergencyKind || !emergencyReason.trim() || emergencySubmitting) return;
    setEmergencySubmitting(true);
    try {
      const { error } = await supabase.from('attendance_events').insert({
        application_id: emergencyModalApp.id, actor_id: me.id, kind: emergencyKind, reason: emergencyReason.trim(),
      });
      if (error) { alert('送信に失敗しました：' + error.message); setEmergencySubmitting(false); return; }
      const sentAt = new Date().toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" });
      setEmergencySentAt(sentAt);
      setDbApplicants(prev => prev.map(x => x.id === emergencyModalApp.id ? { ...x, _emergencySentAt: sentAt } : x));
      setEmergencySent(true);
    } catch { alert('送信に失敗しました。'); }
    setEmergencySubmitting(false);
  };

  // 応募者カード本体（ボトムシートで表示。承認/見送り・保険・開始確認・完了評価・緊急連絡・チャットの操作込み）
  const renderApplicantCard = (a) => {
    const badgeColor = a.status==="approved" ? {bg:"#E6F7EF",fg:"#00A86B"} : a.status==="rejected" ? {bg:"#F5F5F5",fg:"#717171"} : {bg:"#FFF4E0",fg:"#C77700"};
    const wp = workerProfiles[a.worker_id];
    return (
      <div key={a.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
              <div style={{ display:"inline-block", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, marginBottom:8, background:badgeColor.bg, color:badgeColor.fg }}>
                {a.status==="applied" ? "承認待ち" : a.status==="approved" ? "承認済み" : a.status==="rejected" ? "見送り" : a.status}
              </div>
              <div style={{ marginBottom:10 }}>
                <WorkerTrustCard profile={wp || {}} trust={workerTrust[a.worker_id]} />
                <MyReviewsOfWorker workerId={a.worker_id} />
              </div>
              {Array.isArray(wp?.pr_qa) && wp.pr_qa.length > 0 && (
                <div style={{ display:"grid", gap:6, marginBottom:10 }}>
                  {wp.pr_qa.map(({ q, a: ans }) => (
                    <div key={q}>
                      <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
                      <p className="f-sans" style={{ fontSize:12, color:"#222", margin:0, lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{ans}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* 求人名はタップで求人プレビューを開くリンク（2026-07-19） */}
              {(() => {
                const info = jobInfoMap[a.job_number] || dbActive.find(d => d.job_number === a.job_number) || dbDrafts.find(d => d.job_number === a.job_number) || {};
                const title = [info.crop, info.task].filter(Boolean).join(" ") || "求人";
                return (
                  <button onClick={()=>setPreviewJob({ num: a.job_number })} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", padding:0, margin:"0 0 4px", cursor:"pointer" }}>
                    <span style={{ fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline" }}>{title}</span>
                    <span style={{ color:"#999", fontWeight:700, fontSize:12, marginLeft:6 }}>#{a.job_number}</span>
                    <span style={{ color:"#00A86B", fontWeight:700, fontSize:12, marginLeft:6 }}>→</span>
                  </button>
                );
              })()}
              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:8 }}>応募日 {new Date(a.created_at).toLocaleDateString("ja-JP")}</p>
              {/* 来られる日（期間求人・すり合わせの起点・2026-07-24） */}
              <AvailDatesChips value={a.available_dates} />
              {/* 働く日（確定済み・2026-07-24 追記3） */}
              <AgreedDatesRow value={a.agreed_dates} />
              {/* ── 応募者カードは「承認」と「チャット」に純化（2026-07-24 最終版）。当日・事後の行動は今日ページ、道具はチャットの＋へ引っ越し ── */}
              {/* 主ボタン：承認する（applied時のみ）＋見送る（従来位置・小さく誤タップ防止）。承認＝宣言日程の受け入れ（DB側でagreed_dates自動転写） */}
              {a.status === "applied" && (
                <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                  <button onClick={async ()=>{
                    const { data, error } = await supabase.rpc('approve_application', { p_application_id: a.id, p_approve: true });
                    if (error || !data?.ok) { alert('承認に失敗しました：' + (data?.reason || error?.message || '不明')); return; }
                    setDbApplicants(prev => prev.map(x => x.id===a.id ? {...x, status:'approved'} : x));
                  }} className="f-sans" style={{ flex:2, padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>承認する</button>
                  <button onClick={async ()=>{
                    if (!confirm('この応募を見送りますか？')) return;
                    const { data, error } = await supabase.rpc('approve_application', { p_application_id: a.id, p_approve: false });
                    if (error || !data?.ok) { alert('処理に失敗しました：' + (data?.reason || error?.message || '不明')); return; }
                    setDbApplicants(prev => prev.map(x => x.id===a.id ? {...x, status:'rejected'} : x));
                  }} className="f-sans" style={{ flex:1, padding:"12px", fontSize:12, fontWeight:600, background:"#fff", color:"#999", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>見送る</button>
                </div>
              )}
              {/* 状態メモ（進行の記録は小さく残す・操作は今日ページ） */}
              {a.status === "completed" && (
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color: a.attended===false ? "#E24B4A" : "#00A86B", margin:"0 0 8px" }}>{a.attended===false ? "欠勤記録済み" : "✓ 完了・評価済み"}</p>
              )}
              {/* 常時表示：チャットを開く */}
              <button onClick={()=>{ window.location.hash="/chat/"+a.id; }} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>💬 チャットを開く</button>
      </div>
    );
  };
  return (
    // 入口(home)は余白を持たない＝働き手入口と開始位置・下端が完全一致（外側のプロフィールwrapperが32px/4pxを提供）
    <div style={{ maxWidth:1200, margin:"0 auto", padding: jobTab === "home" ? "0" : "24px 0 80px" }}>
      {jobTab === "home" ? (
        <>
          {/* ═══ Airbnb型入口メニュー（2026-07-14）：大プロフィールカード＋絵文字カード格子＋ワイド求人作成カード。
               文字タブの羅列を廃止し、タップで各サブページへ ═══ */}
          {/* トップボックスは反転式（2026-07-16・働き手側と同構造）：表=アイコン＋農園名／裏=アイコン・名前抜きのプレビュー。右上⇄で反転0.8秒 */}
          <div style={{ position:"relative" }}>
            <button onClick={()=>{ if (empReview === "pending") return; window.location.hash="/profile/employer/profile"; }}
              className={"f-sans" + (empTopAnim ? " " + empTopAnim : (empReview ? "" : empUnsetReq > 0 ? " cb-urgent-card" : empUnsetCount > 0 ? " cb-urgent-still" : ""))}
              onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && empTopAnim === "pflip-in") setEmpTopAnim(""); }}
              style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid " + ROLE_GREEN, borderRadius:24, padding: empReview ? "28px 20px 44px" : "28px 20px", cursor: empReview === "pending" ? "default" : "pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box" }}>
              {/* 審査帯（2026-07-19）：審査待ち=オレンジ帯＋タップ不能／修正依頼中=赤帯（タップで修正へ） */}
              {empReview && (
                <span className="f-sans" style={{ position:"absolute", left:0, right:0, bottom:0, zIndex:2, padding:"8px 12px", borderRadius:"0 0 24px 24px", background: empReview === "revision" ? "#E24B4A" : "#C77700", color:"#fff", fontSize:13, fontWeight:700, textAlign:"center", boxSizing:"border-box" }}>
                  {empReview === "revision" ? "⚠️ 修正のお願いがあります（タップして修正）" : "⏳ 審査待ち：運営が確認しています"}
                </span>
              )}
              {!empTopBack ? (
                <>
                  {/* 未設定の項目数（全て設定済みなら非表示）。右上は⇄マークなので左隣に */}
                  {empUnsetCount > 0 && (
                    <span style={{ position:"absolute", top:12, right:52, minWidth:22, height:22, borderRadius:11, background:"#F5A623", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{empUnsetCount}</span>
                  )}
                  <Avatar url={empMini?.avatar_url} name={empMini?.nickname || me?.name} size={84} />
                  <span>
                    <span className="f-sans" style={{ display:"block", fontSize:22, fontWeight:800, color:"#222" }}>{empMini?.nickname || me?.name || "農園名未設定"}</span>
                    <span className="f-sans" style={{ display:"inline-block", marginTop:6, fontSize:13, fontWeight:800, color:"#fff", background:ROLE_GREEN, borderRadius:20, padding:"3px 14px" }}>農家</span>
                  </span>
                </>
              ) : (
                <div className="f-sans" style={{ width:"100%", textAlign:"left" }}>
                  {(() => {
                    const perks = empMini ? [
                      { on: empMini.has_transport, label: "🚗送迎あり" },
                      { on: empMini.has_parking, label: "🅿️駐車場あり" },
                      { on: empMini.has_commute_allowance, label: "💰通勤手当あり" },
                      { on: empMini.has_bonus, label: "🎁賞与あり" },
                      { on: empMini.employer_pays_supplies, label: "🎒持ち物は農家負担" },
                      { on: empMini.accessory_ok, label: "💍アクセサリーOK" },
                    ].filter(p => p.on) : [];
                    const pr = (empMini?.pr || "").trim();
                    const styleLabel = interactionStyleLabel(empMini?.interaction_style);
                    const hasAny = pr || perks.length || styleLabel;
                    if (!hasAny) return <p style={{ fontSize:13, color:"#999", textAlign:"center", margin:"32px 0" }}>プロフィールは未設定です</p>;
                    {/* 並び：タブ（待遇・関わり方のチップ）が上部→下に自己紹介（2026-07-16） */}
                    return (
                      <>
                        {(perks.length > 0 || styleLabel) && (
                          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
                            {perks.map((p,i) => <span key={i} style={{ fontSize:12, fontWeight:600, color:"#00A86B", background:"#E6F7EF", borderRadius:20, padding:"4px 10px" }}>{p.label}</span>)}
                            {styleLabel && <span style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"4px 10px" }}>🤝 {styleLabel}</span>}
                          </div>
                        )}
                        {pr && <ExpandableText text={pr} limit={100} style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, overflowWrap:"break-word", wordBreak:"break-word" }} />}
                      </>
                    );
                  })()}
                </div>
              )}
            </button>
            <button onClick={(e)=>{
              e.stopPropagation();
              if (empTopAnim === "pflip-out") return; // 連打ガード
              setEmpTopAnim("pflip-out");
              setTimeout(()=>{ setEmpTopBack(v=>{ const nv = !v; try { localStorage.setItem("cb_empTopBack", nv ? "1" : "0"); } catch {} return nv; }); setEmpTopAnim("pflip-in"); }, 400);
            }} aria-label="表示を切り替える" style={{ position:"absolute", top:12, right:12, width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>⇄</button>
          </div>
          {(() => {
            // 役割区画化（2026-07-22）：現行の箱を区画見出しで整理。数字バッジ＝要対応/当日のみ
            const today = ymdLocal(new Date());
            const jdm = {}; [...dbActive, ...dbExpired, ...dbDrafts].forEach(j => { jdm[j.job_number] = j; });
            const todayCount = dbApplicants.filter(a => ["contracted","working"].includes(a.status) && jdm[a.job_number] && (() => { const j = jdm[a.job_number]; const s = j.date_start, e = j.date_end || j.date_start; return s && s <= today && today <= e; })()).length;
            const eHubBox = (c) => {
              const flipped = eFlip === c.l;
              return (
              <button key={c.l} onClick={()=>{ if (flipped) { setEFlip(null); return; } c.onClick ? c.onClick() : (window.location.hash=c.h); }} className={"f-sans" + (!flipped ? (c.urgent ? " cb-urgent-card" : c.still ? " cb-urgent-still" : "") : "")} style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"26px 8px 18px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minWidth:0, minHeight:132, boxSizing:"border-box" }}>
                {c.desc && <span onClick={(e)=>{ e.stopPropagation(); setEFlip(flipped ? null : c.l); }} role="button" aria-label="説明" style={{ position:"absolute", top:8, right:8, zIndex:3, width:22, height:22, borderRadius:11, background: flipped ? "#00A86B" : "#F0F0F0", color: flipped ? "#fff" : "#999", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>？</span>}
                {flipped ? (
                  <span className="f-sans pflip-in" style={{ fontSize:12, color:"#555", lineHeight:1.7, textAlign:"center", padding:"2px 8px" }}>{c.desc}</span>
                ) : (<>
                  {c.n > 0 && <span style={{ position:"absolute", top:9, right:c.desc?34:10, minWidth:22, height:22, borderRadius:11, background: c.urgent ? "#E24B4A" : "#00A86B", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{c.n}</span>}
                  <span style={{ fontSize:44, lineHeight:1 }}>{c.e}</span>
                  <span style={{ fontSize:15, fontWeight:700, color:"#222" }}>{c.l}</span>
                  {c.sub && <span className="f-sans" style={{ fontSize:11, color:"#717171", textAlign:"center", lineHeight:1.4 }}>{c.sub}</span>}
                </>)}
              </button>
              );
            };
            const eSec = (title, boxes) => (
              <div key={title} style={{ marginTop:16 }}>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_GREEN, paddingLeft:8 }}>{title}</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>{boxes.map(eHubBox)}</div>
              </div>
            );
            return (<>
              {/* 「きょうの仕事」箱は撤去（2026-07-24・1機能1入口＝ナビ「📆今日」が唯一の入口）。📌いまは応募者のみ */}
              {eSec("📌 いま", [
                // 応募者：バッジは未完了（完了・見送り以外）のみ計上。未承認あり＝赤バッジ＋浮遊／保険未チェックのみ＝赤影
                { e:"🤝", l:"応募者", n:dbApplicants.filter(a => !isApplicantDone(a)).length, h:"/profile/employer/applicants", urgent:hasUnapprovedApplicant, still:hasInsurancePending, desc:"あなたの求人に応募した働き手の一覧。承認・打合せ・採用はここから。" },
              ])}
              {eSec("📋 求人の管理", [
                { e:"🌱", l:"作成中", n:dbDrafts.length, h:"/profile/employer/drafts", desc:"下書き・審査中の求人です。編集して掲載できます。" },
                { e:"📣", l:"公開中", n:dbActive.length, h:"/profile/employer/active", desc:"いま公開している求人です。終了した求人もここに残ります。" },
              ])}
            </>);
          })()}
          <button onClick={onNewJob} className="f-sans cb-jump" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>{/* 赤影なしの飛ぶ動作（チャット未読アイコンと同じcb-jump・2026-07-19） */}
            <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>📝</span>
            <span>
              <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>新しく求人を出す</span>
              <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>基本情報だけなら5分。写真や説明は後から追加できます。</span>
            </span>
          </button>
          {/* 面接の質問集（2026-07-23）：応募者チャットに送る質問を用意 */}
          <button onClick={openQMgr} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
            <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>📋</span>
            <span>
              <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>面接の質問集</span>
              <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>聞きたいことをセットにして、応募者のチャットに送れます。回答もチャットに残ります。</span>
            </span>
          </button>
          {/* 保険の準備（2026-07-24・専用ページ#/insuranceへ遷移）。アプリ内遷移の目印を残し、戻るは history.back で元の場所（スクロール位置）へ復帰させる */}
          <button onClick={()=>{ try{ sessionStorage.setItem("cb_insFromApp","1"); }catch{} window.location.hash="/insurance"; }} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
            <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>🛡</span>
            <span>
              <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>保険の準備</span>
              <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>働き手のケガに備える保険の準備方針を、自己申告で表明できます。</span>
            </span>
          </button>
          <div style={{ marginTop:16 }}>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_GREEN, paddingLeft:8 }}>📖 記録</p>
            <div className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, margin:"0 0 12px" }}>
                <p style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>❤️ また呼びたいリスト</p>
                <button onClick={()=>setRosterInfoOpen(v=>!v)} aria-label="説明を見る" className="f-sans" style={{ width:22, height:22, borderRadius:11, background: rosterInfoOpen ? "#00A86B" : "#F0F0F0", color: rosterInfoOpen ? "#fff" : "#717171", border:"none", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>？</button>
              </div>
              {rosterInfoOpen && (
                <p className="fade-in" style={{ fontSize:12, color:"#717171", margin:"0 0 12px", lineHeight:1.6 }}>一緒に働いたあと「また呼びたい」と評価してお気に入り登録した方のリストです。新しい求人を出すとお知らせが届き、リピート即決ONの求人には応募と同時に自動承認されます。</p>
              )}
              {rosterRows.length === 0
                ? <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>まだ登録はありません。仕事のあと「また呼びたい」で登録できます。</p>
                : <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>{rosterRows.map(r => (<button key={r.worker_id} onClick={()=>openRosterDetail(r.worker_id)} aria-label="働き手の詳細" style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}><Avatar url={r.avatar_url} name={r.nickname || "？"} size={52} /></button>))}</div>}
            </div>
          </div>
          <button onClick={()=>{ window.location.hash="/profile/employer/expired"; }} className="f-sans" style={{ display:"block", margin:"18px auto 0", background:"none", border:"none", fontSize:13, color:"#717171", textDecoration:"underline", cursor:"pointer" }}>期限切れの求人を見る</button>
        </>
      ) : (
      <>
      {/* 戻る／求人を出す：同じ高さの浮遊固定ボックス（スクロール追従・2026-07-16・働き手側の戻ると同じ意匠）。
          hashが既に/profile/employerの場合(保存後遷移等)はhashchangeが発火しないため、stateも直接homeへ */}
      <button onClick={()=>{ setJobTab("home"); window.location.hash="/profile/employer"; }} className="f-sans job-float-back" style={{
        display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
        fontSize:13, fontWeight:600, color:"#717171", cursor:"pointer", padding:"8px 14px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
      }}>← 農家プロ</button>
      <button onClick={onNewJob} className="f-sans job-float-like" style={{
        display:"flex", alignItems:"center", gap:6, background:"#00A86B", border:"none", borderRadius:20,
        fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", padding:"8px 14px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
      }}>＋ 求人を出す</button>
      {/* 浮遊ボックスとタブ・見出しが重ならないためのスペーサー（ノッチ端末はsafe-area分も確保） */}
      <div aria-hidden="true" style={{ height:"calc(48px + env(safe-area-inset-top, 0px))" }} />
      {/* 旧タブ列は廃止（2026-07-14）：ナビは入口カードメニューに一本化。現在地の見出しだけ残す */}
      {/* 作成中⇄公開中は上部タブで行き来できる（2026-07-16）。入口ボックスはそれぞれ自分のページ（hash）を開く */}
      {(jobTab==="draft" || jobTab==="active") ? (
        <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
          {[
            { k:"draft",  l:"作成中", h:"/profile/employer/drafts", n:dbDrafts.length },
            { k:"active", l:"公開中", h:"/profile/employer/active", n:dbActive.length },
          ].map(t => (
            <button key={t.k} onClick={()=>{ if (jobTab !== t.k) { setJobTab(t.k); window.location.hash = t.h; } }} className="f-sans"
              style={{ flex:1, padding:"11px 0", borderRadius:12, border: jobTab===t.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:14, fontWeight: jobTab===t.k ? 800 : 600, color: jobTab===t.k ? "#222" : "#999", cursor:"pointer" }}>
              {t.l}{t.n > 0 ? `（${t.n}）` : ""}
            </button>
          ))}
        </div>
      ) : jobTab==="calendar" ? null : (
        <h2 className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 16px" }}>{(JOB_TABS.find(t => t.k === jobTab) || {}).l || ""}</h2>
      )}
      {/* 作成中⇄公開中はページャー（2026-07-16）：文字・絵文字・ボタン・カードが指に追従して実際に横移動する */}
      {(jobTab==="draft" || jobTab==="active") ? (
      <div onTouchStart={onPagerStart} onTouchMove={onPagerMove} onTouchEnd={onPagerEnd} style={{ overflow:"hidden", touchAction:"pan-y" }}>
        <div ref={pagerTrackRef} style={{ display:"flex", width:"200%", transform: jobTab==="draft" ? "translateX(0%)" : "translateX(-50%)", transition:"transform .3s ease" }}>
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingRight:5 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>{/* 作成中パネル（メルカリ風・横3列） */}
      {draftsLoading ? (
          <p className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>
        ) : dbDrafts.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🌱</div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>作成中の求人はありません</p>
            <button onClick={onNewJob} className="btn-primary" style={{ padding:"12px 28px", fontSize:14 }}>＋ 新しく求人を出す</button>
          </div>
        ) : (
          (() => {
            // 作成中と審査中をセクションで分離（2026-07-16）。審査中は閲覧のみ（再開/削除は作成中のみ）
            const renderDraftCard = (d) => {
              const photo = d.photos && d.photos[0] ? (typeof d.photos[0] === "string" ? d.photos[0] : d.photos[0]?.url) : null;
              return (
              <button key={d.job_number} onClick={()=>setPreviewJob({ num: d.job_number, draft: d.status === "draft" })}
                className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                  {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "📝"}
                  <StatusRibbon label={d.status === "pending" ? "審査中" : "作成中"} color={d.status === "pending" ? "#C77700" : "#8A6D1D"} />
                </div>
                <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{((d.crop||"")+" "+(d.task||"")).trim() || "無題の求人"}</p>
              </button>
              );
            };
            const making = dbDrafts.filter(d => d.status === "draft");
            const pending = dbDrafts.filter(d => d.status === "pending");
            return (
              <>
                {making.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#8A6D1D", margin:"0 0 -2px" }}>作成中（{making.length}）</p>}
                {making.map(renderDraftCard)}
                {pending.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#C77700", margin:"8px 0 -2px" }}>審査中（{pending.length}）</p>}
                {pending.map(renderDraftCard)}
              </>
            );
          })()
        )}
            </div>
          </div>
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingLeft:5 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>{/* 公開中パネル（メルカリ風・横3列） */}
      {(dbActive.length === 0 && dbExpired.length === 0) ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"56px 0" }}>{/* 空状態は作成中ページと全く同じ配置（2026-07-16） */}
            <div style={{ fontSize:40, marginBottom:12 }}>🌾</div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>公開中の求人はありません</p>
            <button onClick={onNewJob} className="btn-primary" style={{ padding:"12px 28px", fontSize:14 }}>＋ 新しく求人を出す</button>
          </div>
        ) : (
          (() => {
            // 審査中(pending)と公開中(open)をセクションで分離（2026-07-16）。
            // 終了（作業日程が過ぎた求人）も公開中ボックスに残す（2026-07-22）＝endedフラグで灰色帯「終了」
            const renderActiveJobCard = (d, ended=false) => {
              const photo = d.photos && d.photos[0] ? (typeof d.photos[0] === "string" ? d.photos[0] : d.photos[0]?.url) : null;
              return (
              <div key={d.job_number} onClick={()=>setPreviewJob({ num: d.job_number, draft: d.status === "draft", open: d.status === "open" })} style={{ border:"1px solid #EBEBEB", borderRadius:12, overflow:"hidden", background:"#fff", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                  {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter: ended ? "grayscale(40%)" : "none" }} /> : (ended ? "🍂" : "🌾")}
                  <StatusRibbon label={ended ? "終了" : d.status==="open" ? "公開中" : d.status==="draft" ? "一時非公開" : "審査中"} color={ended ? "#9E9E9E" : d.status==="open" ? "#00A86B" : d.status==="draft" ? "#757575" : "#C77700"} />
                  {qUnansweredMap[d.job_number] > 0 && (
                    <span className="f-sans" style={{ position:"absolute", top:6, right:6, background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, borderRadius:20, padding:"2px 8px", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}>❓{qUnansweredMap[d.job_number]}</span>
                  )}
                </div>
                <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{((d.crop||"")+" "+(d.task||"")).trim() || "無題"}</p>
              </div>
              );
            };
            const open = dbActive.filter(d => d.status === "open");
            const unpub = dbActive.filter(d => d.status === "draft"); // 一時非公開（掲載歴あり）
            const ended = dbExpired; // 作業日程が過ぎた求人＝終了（探すからは自動で外れるが、農家の公開中ボックスには残す）
            return (
              <>
                {open.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#00A86B", margin:"0 0 -2px" }}>公開中（{open.length}）</p>}
                {open.map(d => renderActiveJobCard(d))}
                {unpub.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#757575", margin:"8px 0 -2px" }}>一時非公開（{unpub.length}）</p>}
                {unpub.map(d => renderActiveJobCard(d))}
                {ended.length > 0 && <p className="f-sans" style={{ gridColumn:"1/-1", fontSize:13, fontWeight:700, color:"#9E9E9E", margin:"8px 0 -2px" }}>終了（{ended.length}）</p>}
                {ended.map(d => renderActiveJobCard(d, true))}
              </>
            );
          })()
        )}
            </div>
          </div>
        </div>
      </div>
      ) : (
      <div onTouchStart={jobTab==="applicants" ? onAppSwipeStart : undefined} onTouchEnd={jobTab==="applicants" ? onAppSwipeEnd : undefined} style={{ display:"grid", gridTemplateColumns: (jobTab==="applicants"||jobTab==="expired") ? "repeat(3, 1fr)" : "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: (jobTab==="applicants"||jobTab==="expired") ? 10 : 20 }}>{/* 求人一覧はメルカリ風に横3列固定・タイトルのみ */}
      {/* 2026-07-14: プレビューページ廃止＝トップボックスタップで直接編集ページへ。プレビューは編集ページ右上→モーダル */}
      {jobTab==="profile" ? (
        <EmployerProfileEdit me={me} />
      ) : jobTab==="applicants" ? (
        dbApplicants.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
            <div style={{ fontSize:40, marginBottom:12 }}>📩</div>
            <p style={{ fontSize:14, margin:0 }}>まだ応募はありません</p>
            <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>求人が公開されると、働き手が応募できます。</p>
          </div>
        ) : (
          // 応募者を求人毎に分ける（2026-07-19）。上部＝状態フィルタタブ（タップ＋横スワイプ）／下部＝帯の意味の説明（2026-07-22）
          (() => {
            const shown = dbApplicants.filter(a => (APP_FILTERS.find(f => f.k === appFilter) || APP_FILTERS[0]).match(a.status));
            const order = []; const byJob = {};
            shown.forEach(a => { const jn = a.job_number; if (!jobInfoMap[jn]) return; if (!byJob[jn]) { byJob[jn] = []; order.push(jn); } byJob[jn].push(a); });
            const tabBar = (
              <div key="app-tabs" style={{ gridColumn:"1/-1", display:"flex", gap:6, marginBottom:2, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
                {APP_FILTERS.map(f => (
                  <button key={f.k} onClick={()=>setAppFilter(f.k)} className="f-sans" style={{ flex:"1 0 auto", padding:"8px 14px", borderRadius:20, border: appFilter===f.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:13, fontWeight: appFilter===f.k?800:600, color: appFilter===f.k?"#222":"#999", cursor:"pointer", whiteSpace:"nowrap" }}>{f.l}</button>
                ))}
              </div>
            );
            const legend = (
              <div key="app-legend" style={{ gridColumn:"1/-1", marginTop:14 }}>
                <button onClick={()=>setAppLegendOpen(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#555" }}>帯（ステータス）の意味</span>
                  <span style={{ fontSize:14, color:"#999" }}>{appLegendOpen ? "－" : "＋"}</span>
                </button>
                {appLegendOpen && (
                  <div className="fade-in" style={{ marginTop:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:10, padding:"12px 14px", display:"grid", gap:10 }}>
                    {[["applied","承認待ち","応募が届いた状態。プロフィールを見て、承認するか見送るかを決めます"],["approved","承認済み","承認した応募。チャットで打ち合わせ・面接に進みます"],["meeting","打ち合わせ","チャットで打ち合わせ中"],["interview","面接","面接の段階"],["contracted","契約","双方が内容を確認し、採用が決まった状態"],["working","作業中","作業当日・進行中"],["completed","完了","作業が終わった応募。お互いを評価できます"],["rejected","見送り","見送りにした応募"]].map(([st,l,d]) => (
                      <div key={l} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                        <span className="f-sans" style={{ flexShrink:0, marginTop:1, background:APP_COLORS[st], color:"#fff", fontSize:11, fontWeight:700, borderRadius:6, padding:"3px 8px", minWidth:56, textAlign:"center" }}>{l}</span>
                        <span className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.6 }}>{d}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
            const body = order.length === 0
              ? [<p key="app-empty" className="f-sans" style={{ gridColumn:"1/-1", textAlign:"center", color:"#999", fontSize:13, padding:"36px 0" }}>この状態の応募者はいません</p>]
              : order.flatMap(jn => {
                  const info = jobInfoMap[jn] || {};
                  const title = [info.crop, info.task].filter(Boolean).join(" ") || `求人 #${jn}`;
                  return [
                    <button key={`h-${jn}`} onClick={()=>setPreviewJob({ num: jn })} className="f-sans"
                      style={{ gridColumn:"1/-1", display:"flex", alignItems:"center", gap:8, width:"100%", textAlign:"left", background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 14px", cursor:"pointer", marginTop:2 }}>
                      <span style={{ fontSize:14, fontWeight:700, color:"#222", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title} <span style={{ fontSize:11, color:"#C8C8C8" }}>#{jn}</span></span>
                      <span style={{ fontSize:11, color:"#00A86B", fontWeight:700, flexShrink:0 }}>{byJob[jn].length}名 · 求人を見る →</span>
                    </button>,
                    ...byJob[jn].map(a => {
                      const wp = workerProfiles[a.worker_id];
                      return (
                        <button key={a.id} onClick={()=>setSheetApplicantId(a.id)}
                          className={"f-sans" + (a.status === "applied" ? " cb-urgent-card" : needsInsurance(a) ? " cb-urgent-still" : "")}
                          style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                          <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                            {wp?.avatar_url
                              ? <img src={wp.avatar_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                              : <Avatar url={null} name={wp?.nickname || "？"} size={64} />}
                            <StatusRibbon label={appRibbonLabel(a.status)} color={appRibbonColor(a.status)} />
                          </div>
                          <p className="f-sans" style={{ fontSize:13, fontWeight:600, color: wp?.nickname ? "#222" : "#999", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{wp?.nickname || "（名前未設定）"}</p>
                        </button>
                      );
                    })
                  ];
                });
            return [tabBar, ...body, legend];
          })()
        )
      ) : jobTab==="expired" ? (
        dbExpired.length === 0 ? (
          <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
            <div style={{ fontSize:40, marginBottom:12 }}>🍂</div>
            <p style={{ fontSize:14, margin:0 }}>期限切れの求人はありません</p>
            <p style={{ fontSize:12, margin:0, marginTop:6, color:"#B0B0B0" }}>作業日程が過ぎた求人がここに入ります。</p>
          </div>
        ) : (
          dbExpired.map(d => {
            const photo = d.photos && d.photos[0] ? (typeof d.photos[0] === "string" ? d.photos[0] : d.photos[0]?.url) : null;
            return (
            <button key={d.job_number} onClick={()=>setPreviewJob({ num: d.job_number, draft: d.status === "draft" })}
              className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
              <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter:"grayscale(40%)" }} /> : "🍂"}
                <StatusRibbon label="期限切れ" color="#9E9E9E" />
              </div>
              <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{((d.crop||"")+" "+(d.task||"")).trim() || "無題"}</p>
            </button>
            );
          })
        )
      ) : jobTab==="calendar" ? (
        <div style={{ gridColumn:"1/-1" }}><MyCalendar /></div>
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
      )}
      </>
      )}

      {/* 応募者カードのボトムシート（タップで展開・中身は従来の応募者カード＝操作ボタン込み） */}
      {(() => {
        const live = dbApplicants.find(x => x.id === sheetApplicantId);
        if (!live) return null;
        return (
          <div onClick={()=>setSheetApplicantId(null)} style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                <button onClick={()=>setSheetApplicantId(null)} aria-label="戻る" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px" }}>
                {renderApplicantCard(live)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 完了・評価モーダル（Part1） */}
      {/* 働く日を決めるモーダル（2026-07-24 追記3）：来られる日をプリセット→農家がタップ選択→set_agreed_dates */}
      {agreeModal && (() => {
        const info = jobInfoMap[agreeModal.job_number] || {};
        const av = agreeModal.available_dates;
        // 候補＝働き手の来られる日（配列）。いつでもOK("any")や未宣言は求人の全期間
        const candidates = Array.isArray(av) && av.length > 0 ? av.slice().sort() : daysBetweenYmd(info.date_start, info.date_end);
        return (
          <div onClick={()=>{ if (!agreeSaving) { setAgreeModal(null); setAgreeSel([]); } }} style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div onClick={e=>e.stopPropagation()} className="f-sans" style={{ background:"#fff", borderRadius:16, padding:22, maxWidth:440, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
              <p style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 4px" }}>📅 働く日を決める</p>
              <p style={{ fontSize:12, color:"#717171", margin:"0 0 14px", lineHeight:1.6 }}>
                {Array.isArray(av) ? "働き手が「来られる日」に選んだ日から確定します。" : "働き手は「期間中いつでもOK」です。働く日を選んで確定します。"}
                働き手にお知らせが届きます（変更したら再送されます）。
              </p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:18 }}>
                {candidates.map(d => {
                  const on = agreeSel.includes(d);
                  return (
                    <button key={d} onClick={()=>setAgreeSel(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])} style={{ padding:"9px 12px", fontSize:13, fontWeight:700, borderRadius:20, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{calFmtDate(d)}</button>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>{ if (!agreeSaving) { setAgreeModal(null); setAgreeSel([]); } }} style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>やめる</button>
                <button disabled={agreeSaving || agreeSel.length===0} onClick={async ()=>{
                  if (agreeSel.length===0) return;
                  setAgreeSaving(true);
                  const dates = [...agreeSel].sort();
                  const { data, error } = await supabase.rpc("set_agreed_dates", { p_application_id: agreeModal.id, p_dates: dates });
                  setAgreeSaving(false);
                  if (error || !data?.ok) { alert("確定に失敗しました：" + (data?.message || data?.reason || error?.message || "不明")); return; }
                  setDbApplicants(prev => prev.map(x => x.id===agreeModal.id ? { ...x, agreed_dates: dates } : x));
                  setAgreeModal(null); setAgreeSel([]);
                }} className="btn-primary" style={{ flex:2, padding:"13px", fontSize:14, fontWeight:700, borderRadius:12, opacity: (agreeSaving || agreeSel.length===0) ? 0.5 : 1, cursor: agreeSel.length===0 ? "not-allowed" : "pointer" }}>{agreeSaving ? "確定中..." : `この日で確定する${agreeSel.length>0 ? `（${agreeSel.length}日）` : ""}`}</button>
              </div>
            </div>
          </div>
        );
      })()}
      {completeModalApp && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
            {completeStep === "attend" ? (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:16 }}>働き手は来ましたか？</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={markNoShow} disabled={completeSubmitting} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:600, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer" }}>来なかった</button>
                  <button onClick={()=>setCompleteStep("review")} disabled={completeSubmitting} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>はい</button>
                </div>
                <button onClick={()=>setCompleteModalApp(null)} className="f-sans" style={{ display:"block", margin:"16px auto 0", background:"none", border:"none", color:"#717171", fontSize:12, cursor:"pointer" }}>キャンセル</button>
              </>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:16 }}>作業の評価</p>
                <YesNoPill label="また呼びたい" value={completeWantAgain} onChange={setCompleteWantAgain} />
                <YesNoPill label="安心して任せられた" value={completeEntrust} onChange={setCompleteEntrust} />
                <textarea value={completePublicComment} onChange={e=>setCompletePublicComment(e.target.value)} placeholder="働きぶりで良かった点を一言（働き手のプロフィールに表示されます）" rows={3}
                  className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:8 }} />
                <textarea value={completePrivateMemo} onChange={e=>setCompletePrivateMemo(e.target.value)} placeholder="自分だけが見えるメモ（任意）" rows={3}
                  className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
                {completeWantAgain === true && (
                  <label className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#222", cursor:"pointer", marginBottom:16 }}>
                    <input type="checkbox" checked={completeNotifyNext} onChange={e=>setCompleteNotifyNext(e.target.checked)} style={{ width:18, height:18, accentColor:"#00A86B", flexShrink:0 }} />
                    ❤️ お気に入り登録する
                  </label>
                )}
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setCompleteModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submitFarmerReview} disabled={completeSubmitting || completeWantAgain===null || completeEntrust===null}
                    className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{completeSubmitting ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 求人カードタップ→確認ページと同型のボトムシート（作成中=再開・削除ボタン付き） */}
      {previewJob && (
        <AdminJobPreview jobNumber={previewJob.num} ownerView
          onClose={()=>setPreviewJob(null)}
          onResumeJob={previewJob.draft ? ()=>{ const n = previewJob.num; setPreviewJob(null); onResume(n); } : undefined}
          onDeleteJob={previewJob.draft ? async ()=>{
            if (!confirm("この求人（下書き）を削除しますか？元に戻せません")) return;
            const { error } = await supabase.from("jobs").delete().eq("job_number", previewJob.num).eq("farmer_id", me.id);
            if (error) { alert("削除に失敗しました：" + error.message); return; }
            setDbDrafts(prev => prev.filter(d => d.job_number !== previewJob.num));
            setDbActive(prev => prev.filter(d => d.job_number !== previewJob.num)); // 一時非公開は公開中タブ側にいる
            setPreviewJob(null);
          } : undefined}
          onUnpublishJob={previewJob.open ? async ()=>{
            // 一時非公開（2026-07-16）：open→draftへ（unpublish_job RPC・本人限定）。編集は作成中→再開から。再掲載は審査を通る
            const { data, error } = await supabase.rpc("unpublish_job", { p_job_number: previewJob.num });
            if (error || !data?.ok) { alert("一時非公開にできませんでした：" + (data?.reason || error?.message || "不明")); return; }
            // 公開中タブに「一時非公開」帯で残す（2026-07-16たきと指定）。opened_atは掲載歴の印としてそのまま
            setDbActive(prev => prev.map(d => d.job_number === previewJob.num ? { ...d, status: "draft" } : d));
            setPreviewJob(null);
          } : undefined}
          onCopyJob={async ()=>{
            const { data, error } = await supabase.rpc("copy_job", { p_job_number: previewJob.num });
            if (error || !data?.ok) { alert("コピーに失敗しました：" + (data?.reason || error?.message || "不明")); return; }
            // 元の日程が過ぎていた場合は空で複製される（終了扱い防止・2026-07-24）。選び直しを案内
            if (data.dates_cleared) alert("コピーしました。元の作業日程は終了しているため空にしています。確認ページの「日程」から新しい日を選んでください。");
            setPreviewJob(null);
            window.location.hash = "/work/edit/" + data.job_number; // 新しい下書きを編集フローで開く
          }} />
      )}

      {/* お気に入り登録しました！ボックス（2026-07-19）：働き手アイコンに❤️が付く動作・説明は1文×2・詳細は展開 */}
      {favDone && (
        <div onClick={()=>setFavDone(null)} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"28px 24px 24px", maxWidth:360, width:"100%", textAlign:"center", position:"relative", boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
            <button onClick={()=>setFavDone(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 18px" }}>お気に入り登録しました！</p>
            <div onClick={()=>openWorkerPreview(favDone.workerId)} role="button" style={{ position:"relative", width:88, height:88, margin:"0 auto 16px", cursor:"pointer" }}>
              <Avatar url={favDone.avatar_url} name={favDone.nickname || "？"} size={88} />
              <span className="cb-heart-pop" style={{ position:"absolute", right:-8, bottom:-4, fontSize:32, lineHeight:1, filter:"drop-shadow(0 2px 4px rgba(0,0,0,0.25))" }}>❤️</span>
            </div>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.8, margin:"0 0 6px" }}>「また呼びたい」と思った方を、あなたのお気に入りに登録しました。</p>
            <p className="f-sans" style={{ fontSize:13, color:"#444", lineHeight:1.8, margin:0 }}>リピート即決ONのあなたの求人にこの方が応募すると、自動で承認されます。</p>
            {favDetailOpen ? (
              <div className="f-sans fade-in" style={{ marginTop:14, background:"#F7F7F7", borderRadius:12, padding:"12px 14px", textAlign:"left", fontSize:12, color:"#555", lineHeight:1.8 }}>
                ・新しい求人を出すと、この方にお知らせが届きます<br/>
                ・効果はあなた自身の求人だけに働き、ほかの農家の求人には影響しません<br/>
                ・登録した方は農家プロフィールの「❤️ また呼びたいリスト」に表示されます<br/>
                ・解除はいつでも：リストのアイコンをタップ→「お気に入りを解除する」
              </div>
            ) : (
              <button onClick={()=>setFavDetailOpen(true)} className="f-sans" style={{ marginTop:14, background:"none", border:"none", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>詳しく見る ▾</button>
            )}
          </div>
        </div>
      )}
      {/* また呼びたいリスト：働き手詳細モーダル（アイコンタップで展開・応募者カードと同じ表示部品） */}
      {rosterDetail && (
        <div onClick={()=>setRosterDetail(null)} style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setRosterDetail(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 16px" }}>働き手の詳細</p>
            {rosterDetail.loading ? (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中...</p>
            ) : rosterDetail.profile ? (
              <>
                <WorkerTrustCard profile={rosterDetail.profile} trust={rosterDetail.trust} />
                <MyReviewsOfWorker workerId={rosterDetail.worker_id} />
                {Array.isArray(rosterDetail.profile.pr_qa) && rosterDetail.profile.pr_qa.length > 0 && (
                  <div style={{ display:"grid", gap:10, marginTop:16 }}>
                    {rosterDetail.profile.pr_qa.map(({ q, a }) => (
                      <div key={q}>
                        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 2px" }}>{q}</p>
                        <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>この方のプロフィールは未設定です</p>
            )}
            <button onClick={()=>{ const wid = rosterDetail.worker_id; setRosterDetail(null); stopRosterNotify(wid); }} className="f-sans" style={{ width:"100%", marginTop:16, padding:"12px", fontSize:13, fontWeight:600, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A44", borderRadius:10, cursor:"pointer" }}>
              お気に入りを解除する
            </button>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, margin:"8px 0 0", textAlign:"center" }}>解除するとリストから外れ、新しい求人のお知らせとリピート即決の対象からも外れます</p>
          </div>
        </div>
      )}

      {/* 評価登録完了モーダル（評価送信後の控え） */}
      {completeDone && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setCompleteDone(null)} aria-label="戻る" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 16px" }}>☑️ 評価登録完了</p>
            <div className="f-sans" style={{ display:"grid", gap:8, fontSize:13, marginBottom:14 }}>
              <div style={{ display:"flex", gap:8 }}>
                <span style={{ flexShrink:0, width:72, color:"#717171" }}>求人</span>
                <span style={{ fontWeight:700, color:"#222" }}>{completeDone.jobLabel || ("求人 #" + completeDone.jobNumber)}</span>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <span style={{ flexShrink:0, width:72, color:"#717171" }}>求職者</span>
                <span style={{ fontWeight:700, color:"#222" }}>{completeDone.workerName}</span>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <span style={{ flexShrink:0, width:72, color:"#717171" }}>登録日時</span>
                <span style={{ color:"#222" }}>{completeDone.at}</span>
              </div>
            </div>
            <div className="f-sans" style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", fontSize:13, marginBottom:14 }}>
              <p style={{ fontSize:12, fontWeight:700, color:"#717171", margin:"0 0 8px" }}>評価内容</p>
              <p style={{ margin:"0 0 4px", color:"#222" }}>また呼びたい：<strong>{completeDone.wantAgain ? "はい" : "いいえ"}</strong></p>
              <p style={{ margin:0, color:"#222" }}>安心して任せられた：<strong>{completeDone.entrust ? "はい" : "いいえ"}</strong></p>
              {completeDone.publicComment && (
                <p style={{ margin:"8px 0 0", color:"#222", lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>{completeDone.publicComment}</p>
              )}
              {completeDone.privateMemo && (
                <p style={{ margin:"8px 0 0", color:"#717171", lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>🔒 {completeDone.privateMemo}</p>
              )}
            </div>
            <label className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#222", cursor:"pointer", marginBottom:16 }}>
              <input type="checkbox" checked={completeDone.favorited} onChange={e=>toggleDoneFavorite(e.target.checked)} style={{ width:18, height:18, accentColor:"#00A86B", flexShrink:0 }} />
              お気に入り登録（また呼びたいリストに登録し、次の求人をお知らせする）
            </label>
            <button onClick={()=>setCompleteDone(null)} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>閉じる</button>
          </div>
        </div>
      )}

      {/* 緊急連絡モーダル（Part3・農家側） */}
      {emergencyModalApp && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%" }}>
            {emergencySent ? (
              <>
                <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0 8px", margin:0, lineHeight:1.7 }}>
                  ⚠️ {(FARMER_EMERGENCY_KINDS.find(k=>k.v===emergencyKind)?.l || "緊急")}の連絡を{emergencyCtx?.partnerName ? emergencyCtx.partnerName + "さん" : "働き手さん"}に送りました（{emergencySentAt}）
                </p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"0 0 16px" }}>チャットで詳しく伝えることもできます</p>
                <button onClick={()=>{ const id = emergencyModalApp.id; setEmergencyModalApp(null); window.location.hash = "/chat/" + id; }} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer", marginBottom:8 }}>チャットを開く →</button>
                <button onClick={()=>setEmergencyModalApp(null)} className="btn-primary f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, borderRadius:10 }}>閉じる</button>
              </>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>緊急連絡</p>
                {emergencyCtx && (
                  <div className="f-sans" style={{ background:"#F7F7F7", borderRadius:10, padding:"10px 12px", marginBottom:12, lineHeight:1.7 }}>
                    <p style={{ margin:0, fontSize:13, fontWeight:700, color:"#222" }}>求人 #{emergencyCtx.jobNumber}{emergencyCtx.jobLabel ? "・" + emergencyCtx.jobLabel : ""}</p>
                    <p style={{ margin:0, fontSize:12, color:"#717171" }}>{emergencyCtx.dateLabel && "作業日 " + emergencyCtx.dateLabel}{emergencyCtx.dateLabel && emergencyCtx.partnerName && "　"}{emergencyCtx.partnerName && "相手：" + emergencyCtx.partnerName + "さん"}</p>
                  </div>
                )}
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                  {FARMER_EMERGENCY_KINDS.map(k => (
                    <button key={k.v} type="button" onClick={()=>setEmergencyKind(k.v)} className="f-sans" style={{
                      flex: k.v==="no_show_report" ? "1 1 100%" : "1 1 0", padding:"9px", borderRadius:10, fontSize:13, cursor:"pointer", fontWeight:600, border:"2px solid",
                      borderColor: emergencyKind===k.v ? "#00A86B" : "#EBEBEB",
                      background: emergencyKind===k.v ? "#E6F7EF" : "#fff", color: emergencyKind===k.v ? "#00A86B" : "#222",
                    }}>{k.l}</button>
                  ))}
                </div>
                {emergencyKind==="no_show_report" && (
                  <div className="f-sans" style={{ background:"#FFF4E0", borderRadius:10, padding:"10px 12px", marginBottom:12, fontSize:12, color:"#C77700", lineHeight:1.7 }}>
                    まずチャットか電話で連絡を試してください。15分待っても会えない時にこの連絡を送ると、相手と運営に即時に通知され、日時が記録されます。<br/>
                    作業後の欠勤の記録とは別の、その場の緊急連絡です。
                  </div>
                )}
                <textarea value={emergencyReason} onChange={e=>setEmergencyReason(e.target.value)} placeholder="理由・詳細" rows={4}
                  className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setEmergencyModalApp(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submitEmergency} disabled={emergencySubmitting || !emergencyKind || !emergencyReason.trim()}
                    className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{emergencySubmitting ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ 面接の質問集 管理モーダル（2026-07-23）：セットの作成・編集・削除＋テンプレのコピー ═══ */}
      {qMgrOpen && (
        <div className="qset-full">
          {/* トップバー：←（編集中は一覧へ／一覧ならページを閉じる）＋タイトル */}
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"calc(env(safe-area-inset-top,0px) + 12px) 12px 12px", borderBottom:"1px solid #EBEBEB", flexShrink:0 }}>
            <button onClick={()=>{ if (qEditing) setQEditing(null); else closeQMgr(); }} aria-label="戻る" className="f-sans" style={{ background:"none", border:"none", fontSize:24, lineHeight:1, cursor:"pointer", color:"#222", padding:"2px 8px" }}>←</button>
            <h3 className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:0 }}>📋 面接の質問集</h3>
          </div>
          <div className="f-sans" style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", maxWidth:560, width:"100%", margin:"0 auto", padding:"16px 16px calc(env(safe-area-inset-bottom,0px) + 24px)", boxSizing:"border-box" }}>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 16px", lineHeight:1.6 }}>聞きたいことをセットにして保存し、応募者のチャットに送れます。回答もチャットに残ります。</p>

            {qEditing === null ? (
              <>
                {questionSets.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:18 }}>
                    {questionSets.map(s => (
                      <button key={s.id} onClick={()=>setQEditing({ id:s.id, title:s.title || "", questions: (Array.isArray(s.questions) && s.questions.length ? [...s.questions] : [""]) })} className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px", cursor:"pointer" }}>
                        <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222" }}>{s.title || "無題の質問集"}</span>
                        <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2 }}>質問{Array.isArray(s.questions) ? s.questions.length : 0}問</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 8px" }}>テンプレートからコピー（編集できます）</p>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
                  {INTERVIEW_TEMPLATES.map(tpl => (
                    <div key={tpl.title} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px" }}>
                      <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 4px" }}>{tpl.title}</p>
                      <ul className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 10px", paddingLeft:18, lineHeight:1.7 }}>
                        {tpl.questions.map((q,i) => <li key={i}>{q}</li>)}
                      </ul>
                      <button onClick={()=>setQEditing({ title: tpl.title, questions: [...tpl.questions] })} className="f-sans" style={{ background:"#E6F7EF", color:"#00A86B", border:"none", borderRadius:8, padding:"7px 14px", fontSize:13, fontWeight:700, cursor:"pointer" }}>コピーして使う</button>
                    </div>
                  ))}
                </div>
                <button onClick={()=>setQEditing({ title:"", questions:[""] })} className="f-sans" style={{ width:"100%", background:"#fff", border:"1px dashed #C8C8C8", borderRadius:12, padding:"12px", fontSize:14, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>＋ 自分で作る</button>
              </>
            ) : (
              <>
                <label className="f-sans" style={{ display:"block", fontSize:12, fontWeight:700, color:"#222", marginBottom:6 }}>タイトル</label>
                <input value={qEditing.title} onChange={e=>setQEditing(prev=>({ ...prev, title:e.target.value }))} placeholder="例：経験の確認" className="field f-sans" style={{ fontSize:14, marginBottom:16 }} />
                <label className="f-sans" style={{ display:"block", fontSize:12, fontWeight:700, color:"#222", marginBottom:6 }}>質問（最大5問）</label>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
                  {qEditing.questions.map((q,i) => (
                    <div key={i} style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <span className="f-sans" style={{ fontSize:13, color:"#999", flexShrink:0, width:16 }}>{i+1}.</span>
                      <input value={q} onChange={e=>setQEditing(prev=>({ ...prev, questions: prev.questions.map((x,j)=> j===i ? e.target.value : x) }))} placeholder={`質問${i+1}`} className="field f-sans" style={{ fontSize:14, flex:1 }} />
                      {qEditing.questions.length > 1 && (
                        <button onClick={()=>setQEditing(prev=>({ ...prev, questions: prev.questions.filter((_,j)=>j!==i) }))} aria-label="削除" className="f-sans" style={{ flexShrink:0, width:32, height:32, borderRadius:8, background:"#F5F5F5", border:"none", color:"#999", fontSize:16, cursor:"pointer" }}>×</button>
                      )}
                    </div>
                  ))}
                </div>
                {qEditing.questions.length < 5 && (
                  <button onClick={()=>setQEditing(prev=>({ ...prev, questions:[...prev.questions, ""] }))} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"9px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600, marginBottom:16 }}>＋ 質問を追加</button>
                )}
                <div style={{ display:"flex", gap:8, marginTop:4 }}>
                  <button onClick={()=>setQEditing(null)} className="f-sans" style={{ flex:"0 0 auto", padding:"11px 16px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>戻る</button>
                  <button onClick={saveQuestionSet} disabled={qSaving} className="f-sans" style={{ flex:1, padding:"11px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{qSaving ? "保存中..." : "保存する"}</button>
                </div>
                {qEditing.id && (
                  <button onClick={()=>deleteQuestionSet(qEditing.id)} className="f-sans" style={{ width:"100%", marginTop:10, padding:"9px", fontSize:13, background:"none", color:"#E24B4A", border:"none", cursor:"pointer" }}>この質問集を削除</button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ 質問を送る（応募者カード「📋 質問を送る」→セット選択→send_interview_questions RPC・2026-07-23） ═══ */}
      {sendQTarget && (
        <div onClick={()=>{ if (!sendingQ) setSendQTarget(null); }} style={{ position:"fixed", inset:0, zIndex:10002, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:"20px 20px 0 0", padding:"22px 20px calc(env(safe-area-inset-bottom,0px) + 20px)", maxWidth:520, width:"100%", maxHeight:"80vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>{ if (!sendingQ) setSendQTarget(null); }} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>✕</button>
            <h3 className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 4px", paddingRight:40 }}>📋 質問を送る</h3>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 16px", lineHeight:1.6 }}>選んだ質問集を、この応募者とのチャットに【面接の質問】として送ります。回答もチャットに残ります。</p>
            {questionSets.length === 0 ? (
              <div style={{ textAlign:"center", padding:"12px 0" }}>
                <p className="f-sans" style={{ fontSize:14, color:"#717171", margin:"0 0 16px" }}>まだ質問集がありません。</p>
                <button onClick={()=>{ qMgrScrollY.current=window.scrollY; setSendQTarget(null); setQEditing(null); setQMgrOpen(true); }} className="f-sans" style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:10, padding:"11px 20px", fontSize:14, fontWeight:700, cursor:"pointer" }}>質問集を作る</button>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {questionSets.map(s => (
                  <button key={s.id} disabled={sendingQ} onClick={()=>sendInterviewQuestions(s.id)} className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px", cursor:"pointer" }}>
                    <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222" }}>{s.title || "無題の質問集"}</span>
                    <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{(Array.isArray(s.questions) ? s.questions : []).join(" / ") || "質問なし"}</span>
                  </button>
                ))}
                {sendingQ && <p className="f-sans" style={{ fontSize:12, color:"#999", textAlign:"center", margin:"4px 0 0" }}>送信中...</p>}
              </div>
            )}
          </div>
        </div>
      )}
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
// sections本体はモーダル(PrivacyPolicy)とページ(#/privacy)で共通利用するためモジュールレベル定数化
const PRIVACY_SECTIONS = [
    { id:"privacy-1", title:"第1条 基本の約束", body:[
      "1. 本サービスが取得する情報・その保存と保護・誰に表示されるかは、第3条の一覧表にすべて記載します。**表に無い取得・表に無い開示は行いません。**",
      "2. 個人情報を、広告目的で利用すること、および第三者に販売・提供することはありません（法令に基づく場合を除きます。第4条）。",
      "3. 入力の途中の内容、およびキー操作を記録することはありません。",
    ]},
    { id:"privacy-2", title:"第2条 開示される相手は3種類だけ", body:[
      "本サービスの中で、あなたの情報を見る可能性があるのは次の3者に限られます。",
      "**A：他の利用者**——第3条の表で「開示先」に明示された範囲だけが表示されます。",
      "**B：運営者**——サービスの提供・確認・苦情対応のために、表の範囲で扱います。",
      "**C：公的機関**——法令に基づく適法な照会（裁判所・警察・労働局・個人情報保護委員会など）があった場合に限ります。",
    ]},
    { id:"privacy-3", title:"第3条 個人情報の取り扱い一覧・データ台帳", body:[
      "本サービスが取得する個人情報の全項目を、次の表にまとめます。",
    ], table:{
      headers:["情報","取得する時","保存の場所と保護","誰にどう表示されるか","保存期間"],
      rows:[
        ["メールアドレス","アカウント登録時","認証データベース（東京リージョン）。技術的な行制限により本人と運営者以外は読めません","他の利用者には**一切表示されません**。運営者の管理画面でも通常は伏せ字（例：t5***@…）で表示されます","アカウント存続中"],
        ["本人確認情報（氏名・ふりがな・住所・生年月日・電話番号）","登録直後の本人確認の入力時","専用テーブル。本人と運営者以外は読めません。変更があった事実は記録されますが、記録メールに値そのものは含めません","他の利用者には値は表示されず、**「本人確認済み」の表示と確認の年月だけ**が出ます","アカウント存続中＋退会後、一定期間（詳細は今後定めます）"],
        ["プロフィールの選択項目（活動地域・移動手段・経験・作業の強さ・趣味・言語など）","本人が入力・選択した時","プロフィールテーブル","求人に応募した先の求人者、および求人を閲覧する求職者に**即時**表示されます","存続中（本人がいつでも変更・削除できます）"],
        ["自己紹介・質問への回答（自由記述）","本人が入力した時","まず**非公開の確認待ち**として保存","**運営者が内容を確認してから**（最大2日・確認され次第）応募先などに表示されます。確認するのは連絡先の記載・個人の特定・不適切な表現の有無だけです","存続中（本人がいつでも変更・削除できます）"],
        ["プロフィール写真・農園の紹介","本人が登録した時","画像ストレージ＋プロフィールテーブル","応募先・求人の閲覧者に表示されます","存続中"],
        ["集合場所の詳細（番地・目印）","求人者が求人を作成した時","求人テーブル。公開用の表示からは**除外**されています","**応募が承認された求職者にだけ**表示されます。承認前の閲覧者には町名までしか表示されません","求人の存続中"],
        ["チャットの内容","送信した時","メッセージテーブル。技術的な行制限により**当事者以外は読めません**","当事者だけが読めます。運営者が内容を確認するのは、**苦情・通報・紛争への対応に必要な場合に限ります**","存続中（紛争対応のための保存を含みます）"],
        ["応募・承認・作業の記録（応募日時・承認日時・開始と終了の確認・出欠・欠勤への異議）","それぞれの操作の時","応募テーブル","当事者の双方に表示されます。集計した実績（完了件数など）は将来、プロフィールに表示されます","退会後も一定期間（詳細は今後定めます）保存"],
        ["労働条件の確認記録（双方確認した時点の求人内容の写し）","双方が「相違ありません」を押した時","応募テーブルに改変されない形で保存","当事者の求めと紛争対応の際に使用します。運営者は印刷可能な形で保管します","同上"],
        ["評価（選択項目・公開コメント・非公開メモ）","作業完了後に本人が入力した時","評価テーブル","**公開されるのは肯定的な評価と公開コメントだけ**です。非公開メモは書いた本人しか見られません。双方の評価が揃うか3日たつまで相手には表示されません。全量は運営者がサービス改善と安全のために保存します","存続中"],
        ["ページの閲覧履歴（どのページをいつ表示したか）","ページを表示した時","閲覧記録テーブル。**運営者だけ**が見られます","他の利用者には一切表示されません。使い道はサービスの改善（どの画面が分かりにくいかの分析）だけです","一定期間（詳細は今後定めます）で削除"],
        ["通報・画面の報告・緊急連絡","本人が送信した時","各記録テーブル","通報は運営者だけが確認し、**通報した人が誰かは相手に伝わりません**。緊急連絡は相手方と運営者に通知されます","対応の完了後、一定期間（詳細は今後定めます）"],
      ],
    }},
    { id:"privacy-4", title:"第4条 第三者への提供", body:[
      "1. 第2条のA・B・C以外に個人情報を提供しません。",
      "2. 個人情報を外国にある第三者に提供することはありません。",
    ]},
    { id:"privacy-5", title:"第5条 業務の委託先", body:[
      "システムの運用のため、次の事業者のサービスを利用しています。いずれも上記のデータの保管・配信・送信という役割の範囲でのみ関与し、目的外の利用はできません。",
      "・データベースと認証：Supabase（データ保存地域：東京）",
      "・サイトの配信：Vercel",
      "・メールの送信：Resend",
    ]},
    { id:"privacy-6", title:"第6条 安全のためにしていること", body:[
      "1. **行レベルの権限制御**：すべてのデータは、本人・当事者・運営者という権限の範囲でしか読み書きできないよう、データベースの層で技術的に制限しています。画面側の不具合があっても、権限のないデータには届きません。",
      "2. **変更の全記録**：個人情報を含むデータの追加・変更・削除は、誰がいつ何を変えたかがすべて記録され、運営者に即時通知されます。不正な操作は発見できます。",
      "3. **運営アカウントの保護**：運営者のアカウントには2段階認証を設定しています。",
      "4. **バックアップ**：データは定期的にバックアップし、復元できることを定期的に確認します。",
      "5. **事故対応**：万一、情報の漏えい・滅失が起きた場合の対応手順（被害の封鎖・個人情報保護委員会への報告・ご本人への通知）をあらかじめ定めています。",
    ]},
    { id:"privacy-7", title:"第7条 保存期間の終わりと退会", body:[
      "1. 退会のお申し出があった場合、本人確認情報とプロフィールを削除します。",
      "2. 労働条件の確認記録・応募と作業の記録・評価は、紛争への対応と法令上の必要のため、第3条の表に定める期間、保存します。",
      "3. 削除のご希望・お問い合わせは、第9条の窓口までお申し出ください。",
    ]},
    { id:"privacy-8", title:"第8条 開示・訂正・利用停止の請求", body:[
      "ご本人は、自己の個人情報について、開示・訂正・利用停止を請求できます。ご本人であることを確認のうえ、遅滞なく対応します。",
    ]},
    { id:"privacy-9", title:"第9条 お問い合わせ窓口", body:[
      "運営者：福井滝人（屋号：千歳）／サービス名称：chitose-bank",
      "窓口：t5fki6643qty@gmail.com",
      "苦情のお申し出には、内容を確認のうえ遅滞なく対応します。",
    ]},
  ];

// プライバシーポリシー第3条データ台帳の表描画（モーダル・ページ共通）
function PrivacyDataTable({ table }) {
  return (
    <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
      <table style={{ borderCollapse:"collapse", width:"100%", minWidth:760, fontSize:13 }}>
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th key={i} className="f-sans" style={{ textAlign:"left", padding:"10px 12px", background:"#EFEFEF", borderBottom:"2px solid #DDD", color:"#222", fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="f-sans" style={{ textAlign:"left", padding:"10px 12px", borderBottom:"1px solid #EBEBEB", color:"#444", lineHeight:1.8, verticalAlign:"top" }}>{renderRichText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrivacyPolicy({ onClose }) {
  const sections = PRIVACY_SECTIONS;

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
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:24 }}>千歳（chitose-bank） · 制定：2026年7月5日／全面改定：2026年7月21日</p>
        <div style={{ display:"grid", gap:20 }}>
          {sections.map((s, i) => (
            <div key={i} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB" }}>
              <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>{s.title}</h3>
              {s.body.map((p, j) => (
                <p key={j} className="f-sans" style={{ fontSize:16, color:"#444", lineHeight:1.9, margin: j < s.body.length-1 ? "0 0 8px" : 0, textAlign:"left" }}>{renderRichText(p)}</p>
              ))}
              {s.table && <div style={{ marginTop:12 }}><PrivacyDataTable table={s.table} /></div>}
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
            <p className="f-sans" style={{ fontSize:16, color:"#444", lineHeight:1.9, margin:0, textAlign:"left" }}>
              本文書は、日本農業研究所（chitose-bank）がデータを取り扱う上での基本原則を定めたものです。すべての機能開発・運用判断はこの原則に基づきます。
            </p>
          </div>
          {articles.map(a => (
            <div key={a.num} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB" }}>
              <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>第{a.num}条　{a.title}</h3>
              <p className="f-sans" style={{ fontSize:16, color:"#444", lineHeight:1.9, margin:0, textAlign:"left" }}>{a.body}</p>
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

// ── ヘルプセンター（#/help・#/help/{chapter}） ──────────────────
// HELP_CONTENT: 章キー→{num,title,items:[{label,body}]}。
// 画像はここに持たず、help_imagesテーブルからslot_key(章キー+配列index)で引く（管理者アップロード・スロット制）
const HELP_CHAPTER_KEYS = ["about","farmer","worker","mails","info","faq"];
const HELP_CONTENT = {
  about: {
    num: "第1章", title: "chitose-bankとは",
    items: [
      { key:"about-intro",      label: null, body: "chitose-bankは、農家と働き手が直接つながる場です。" },
      { key:"about-principles", label: "3つの原則", body: "① 連絡手段は縛らない\n② 成功報酬は永久に受け取らない\n③ 採否に関与しない" },
      { key:"about-role",       label: null, body: "運営は、場の提供と安全の確認だけを行います。" },
      { key:"about-installapp", label: "アプリとして使う", body: "iPhone（Safari）\n① 共有ボタン（□に↑）をタップ\n② 「ホーム画面に追加」を選ぶ\n③ 右上の「追加」をタップ\n\nAndroid（Chrome）\n① メニュー（⋮）をタップ\n② 「ホーム画面に追加」または「アプリをインストール」を選ぶ\n③ 「インストール」をタップ" },
    ],
  },
  farmer: {
    num: "第2章", title: "農家の流れ",
    items: [
      { key:"farmer-write",           label: "① 求人を書く", body: "途中保存ができるので、時間があるときに少しずつ書き進められます。" },
      { key:"farmer-4checks",         label: "② 掲載前の4つの確認", body: "掲載前に、内容に不備がないか4つの項目を確認します。" },
      { key:"farmer-review",          label: "③ 運営の審査", body: "運営が内容を確認します。" },
      { key:"farmer-publish",         label: "④ 公開", body: "審査を通過すると、求人が公開されます。" },
      { key:"farmer-applyMail",       label: "⑤ 応募メールが届く", body: "働き手から応募があると、メールで知らされます。" },
      { key:"farmer-approve",         label: "⑥ 承認", body: "応募者のプロフィールを見て、承認するか決めます。" },
      { key:"farmer-chatMeet",        label: "⑦ チャットと確認カードで打合せ", body: "承認後、チャットと確認カードで日程や集合場所などを打ち合わせます。" },
      { key:"farmer-insurance",       label: "⑧ 保険の準備", body: "作業当日に備えて、働き手のケガに備える保険（1日傷害保険など）の準備をおすすめします。準備したら「☑保険を準備した」を押しましょう。働き手にお知らせが届きます。" },
      { key:"farmer-confirmStart",    label: "⑨ 当日「開始を確認」", body: "働き手が作業を開始したら、「開始を確認」を押します。" },
      { key:"farmer-completeReview",  label: "⑩ 作業後「完了して評価する」", body: "働き手が来たか確認し、2タップで評価します。" },
      { key:"farmer-fullPay",         label: "満額保証型とは", body: "満額保証型（デフォルト）では、予定より早く作業が終わっても、予定していた時間分の報酬が満額支払われます。" },
    ],
  },
  worker: {
    num: "第3章", title: "働き手の流れ",
    items: [
      { key:"worker-register",    label: "① 登録", body: "メールアドレスで登録します。" },
      { key:"worker-verify",      label: "② 本人確認", body: "本人確認情報を入力します。" },
      { key:"worker-profile",     label: "③ プロフィール", body: "書いた分だけ農家に伝わります。自己紹介（自由記述）は運営の確認後に公開されます（最大2日）。" },
      { key:"worker-apply",       label: "④ 応募", body: "気になる求人に応募します。" },
      { key:"worker-approveMail", label: "⑤ 承認メール", body: "農家が承認すると、メールで知らされます。" },
      { key:"worker-chatMeet",    label: "⑥ チャット・確認カード", body: "チャットと確認カードで、日程や集合場所などを打ち合わせます。" },
      { key:"worker-startWork",   label: "⑦ 当日「▶ 作業を開始する」", body: "作業を始めるときに押します。" },
      { key:"worker-endReview",   label: "⑧ 終了後「✓ 終了を確認」", body: "作業が終わったら押し、3タップで評価します。" },
    ],
  },
  mails: {
    num: "第4章", title: "届くメール一覧",
    items: [
      { key:"mails-jobPublished",      label: "M01　求人が公開されました", body: "いつ：審査が完了して求人が公開された時／誰に：農家／内容：公開と同時に届きます。応募が入ると「M02 応募あり」が届きます" },
      { key:"mails-applied",           label: "M02　応募あり", body: "いつ：働き手が応募した時／誰に：農家／内容：応募者カードつきの通知" },
      { key:"mails-approved",          label: "M03　承認のお知らせ", body: "いつ：農家が承認した時／誰に：働き手" },
      { key:"mails-rejected",          label: "M04　応募の結果のお知らせ", body: "いつ：農家が見送りにした時／誰に：働き手" },
      { key:"mails-applyCanceled",     label: "M05　応募の取り消し", body: "いつ：働き手が応募を取り消した時／誰に：農家" },
      { key:"mails-applyExpired",      label: "M06　応募の失効", body: "いつ：農家の判断がないまま作業日を迎えた時（自動で失効します）／誰に：働き手／内容：働き手に不利益の記録は残りません" },
      { key:"mails-replyReminder",     label: "M07　応募への返答のお願い", body: "いつ：作業前日（承認待ちのままの応募がある時）／誰に：農家" },
      { key:"mails-message",           label: "M20　新着メッセージ", body: "いつ：チャットにメッセージが届くたび（毎回・例外なし）／誰に：受信した側" },
      { key:"mails-revision",          label: "M21　求人修正のお願い", body: "いつ：審査で差し戻しになった時／誰に：農家" },
      { key:"mails-profileRevision",   label: "M15　自己紹介の修正のお願い", body: "いつ：自由記述の確認で修正をお願いする時／誰に：働き手" },
      { key:"mails-insuranceReminder", label: "M08　保険のご準備を", body: "いつ：承認後・作業日の3日前・前日17時／誰に：農家" },
      { key:"mails-insuranceDone",     label: "M09　保険の準備の報告", body: "いつ：農家が「保険を準備した」と報告した時／誰に：働き手\nこのお知らせは農家からの報告に基づきます（運営が保険の証書を確認するものではありません）" },
      { key:"mails-startSoon",         label: "M10　まもなく作業開始", body: "いつ：作業開始の1時間前／誰に：農家・働き手の双方／内容：緊急連絡ボタンつき。メールのリンクから緊急連絡をそのまま送れます" },
      { key:"mails-doneCheck",         label: "M12　作業は終わりましたか", body: "いつ：作業日翌朝9時（最大2回）／誰に：農家" },
      { key:"mails-reviewRequest",     label: "M13　評価のお願い", body: "いつ：作業が完了した時／誰に：働き手" },
      { key:"mails-reviewArrived",     label: "M19　🌟評価が届きました", body: "いつ：相手からの評価が公開された時／誰に：農家・働き手の双方／内容：お互いの評価が揃うか、3日たつと公開されます（3日ルール）" },
      { key:"mails-noShow",            label: "M14　欠勤の記録", body: "いつ：農家が欠勤を記録した時／誰に：働き手／内容：72時間以内に異議申立ができます" },
      { key:"mails-emergency",         label: "M11　緊急連絡", body: "いつ：遅刻・欠勤・中止・延期・欠勤記録への異議の連絡があった時／誰に：相手方（即時）\n現地で会えない時の連絡も、ここから送れます（日時が記録され、話し合いの資料になります）" },
      { key:"mails-repeatNewJob",      label: "M16　🌟また呼びたい農家さんの新求人", body: "いつ：あなたを「また呼びたい」に登録した農家さんが新しい求人を公開した時／誰に：指名リストの働き手" },
      { key:"mails-repeatInstant",       label: "M17　🌟即決で承認されました", body: "いつ：以前「また呼びたい」と評価してくれた農家さんの求人に応募し、選考なしで確定した時／誰に：働き手" },
      { key:"mails-repeatInstantFarmer", label: "M18　🌟リピート即決のお知らせ", body: "いつ：自分の求人の設定（また呼びたい即決）に基づいて自動承認が実行された時／誰に：農家" },
      { key:"mails-jobQuestion",       label: "M22　求人に質問が届きました", body: "いつ：働き手があなたの求人に質問した時／誰に：農家／内容：回答は求人ページの「質問」タブからできます。回答は他の閲覧者にも公開され、同じ質問を減らせます" },
      { key:"mails-jobQuestionAnswered", label: "M23　質問に回答がつきました", body: "いつ：あなたがした求人への質問に、農家が回答した時／誰に：質問した働き手／内容：回答は求人ページの「質問」タブで、その求人を見る全員に公開されます" },
    ],
  },
  info: {
    num: "第5章", title: "あなたの情報の扱い",
    items: [
      { key:"info-personalData", label: "氏名・住所・生年月日・電話", body: "運営のみが保管します。画面には「✓ 本人確認済み」バッジだけが表示されます。" },
      { key:"info-profileData",  label: "ニックネーム・写真・自己紹介・Q&A・タグ", body: "応募先の農家に表示されます。自由記述は運営が確認してから公開されます。" },
      { key:"info-externalRecord", label: "他のサービスでの実績について", body: "他サービスでの経験は、ご本人の自己申告として表示されます。運営が確認したものではありません。\nchitose-bankの実績（🌟・完了数・作業時間）は、このサイトでの働きの記録からだけ作られ、自己申告では増えません。" },
      { key:"info-address",      label: "集合場所の番地", body: "承認された働き手にだけ表示されます。" },
      { key:"info-chat",         label: "チャット", body: "当事者だけが読めます。" },
      { key:"info-reviews",      label: "評価", body: "良い評価のみ公開されます。お互いの評価が揃うか、3日たつまでは相手に見えません。メモは自分だけが見られます。" },
      { key:"info-report",       label: "通報", body: "通報した人が誰かは、相手に伝わりません。" },
    ],
  },
  faq: {
    num: "第6章", title: "困ったとき",
    items: [
      { key:"faq-askBeforeApply",  label: "応募前に質問できますか", body: "求人ページの質問タブからどうぞ。回答は全員に公開されます。" },
      { key:"faq-interview",       label: "面接はできますか", body: "農家は「面接の質問集」をチャットに送れます（プロフィールから作成・テンプレートのコピーも可）。回答もチャットに残るので、あとから見返せます。集合場所や持ち物の確認も、このチャットでやり取りできます。" },
      { key:"faq-cancelApply",     label: "応募を取り消したい", body: "返事待ちタブから取り消せます。承認された後は、緊急連絡からご相談ください。" },
      { key:"faq-noContact",       label: "承認されたのに連絡がない", body: "承認後の連絡はチャットで届きます。チャットを確認しても連絡がない場合は、お問い合わせ窓口までご連絡ください。" },
      { key:"faq-cantGo",          label: "当日行けなくなった", body: "チャット画面の「⚠️ 緊急連絡」ボタンから、遅れる・欠勤の連絡ができます。相手にすぐに通知されます。" },
      { key:"faq-noShowOrDiffer",  label: "農家が来ない・話が違う", body: "求人詳細ページ最下部の「⚑ 報告する」から通報できます。通報した人が誰かは相手に伝わりません。" },
      { key:"faq-payWho",          label: "報酬はいつ誰からもらえますか", body: "報酬は農家から直接受け取ります。運営は報酬のやり取りに関与しません。" },
      { key:"faq-earlyFinish",     label: "早く終わったら給与は減りますか", body: "満額保証型（デフォルト）の求人では、予定より早く作業が終わっても、予定していた時間分の報酬が満額支払われます。" },
      { key:"faq-wrongReview",     label: "評価を間違えた", body: "お問い合わせ窓口までご連絡ください。" },
      { key:"faq-profileHidden",   label: "自己紹介が表示されない", body: "自由記述の自己紹介は、運営の確認後に公開されます（最大2日）。確認中は、あなたのプレビューに「確認待ち」と表示されます。" },
      { key:"faq-withdraw",        label: "退会したい", body: "お問い合わせ窓口までご連絡ください。" },
      { key:"faq-insuranceWho",    label: "保険は誰が掛けますか", body: "保険の準備は農家にお願いしています（1日傷害保険など・多くは前日までの加入が必要です）。農家が「保険を準備した」と報告すると、働き手にお知らせが届きます。お知らせは農家からの報告に基づくもので、運営が証書を確認するものではありません。気になる時は、チャットで保険の内容を気軽に確認してください。働き手自身が1日数百円の傷害保険に入ることもできます。農家プロフィールで、保険の準備の方針を表明できます（自己申告）。" },
      { key:"faq-howToReport",     label: "通報のしかた", body: "求人詳細ページ最下部の「⚑ 報告する」から通報できます。" },
      { key:"faq-howToDispute",    label: "異議申立のしかた", body: "欠勤記録の通知から72時間以内に、アプリから異議申立ができます。" },
      { key:"faq-contact",         label: "お問い合わせ", body: "t5fki6643qty@gmail.com までご連絡ください。苦情には遅滞なく対応します。" },
    ],
  },
};

// 💬この画面を報告（Part B）。feedbackテーブルのcategory CHECK制約と対応
const FEEDBACK_CATEGORIES = [
  { v:"confusing",   l:"分かりにくい" },
  { v:"broken",      l:"動かない" },
  { v:"typo",        l:"誤字・表示" },
  { v:"suggestion",  l:"提案" },
  { v:"other",       l:"その他" },
];

// この画面を報告（Part B）のモーダル本体。☰の開閉やヘルプの章開閉と無関係な階層（App直下）に
// 1個だけ常駐させ、open/onCloseで外部から制御する。過去バージョンはトリガーボタンと同居させていたため、
// ☰を閉じるとトリガーごとアンマウントされモーダルが開かないバグがあった（2026-07-14修正）
function FeedbackModal({ open, onClose }) {
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (open) { setCategory(""); setBody(""); setSent(false); }
  }, [open]);
  const submit = async () => {
    if (!category || submitting) return;
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSubmitting(false); return; }
      const { error } = await supabase.from('feedback').insert({
        reporter_id: session.user.id,
        page_hash: window.location.hash || '#/',
        category, body: body.trim() || null,
        viewport: window.innerWidth,
      });
      if (error) { alert('送信に失敗しました：' + error.message); setSubmitting(false); return; }
      setSent(true);
    } catch { alert('送信に失敗しました。'); }
    setSubmitting(false);
  };
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%" }}>
        {sent ? (
          <>
            <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0", margin:0 }}>ありがとうございます。改善に使わせていただきます</p>
            <button onClick={onClose} className="btn-primary f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, borderRadius:10 }}>閉じる</button>
          </>
        ) : (
          <>
            <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>この画面を報告</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
              {FEEDBACK_CATEGORIES.map(c => (
                <button key={c.v} type="button" onClick={() => setCategory(c.v)} className="f-sans" style={{
                  padding:"7px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", border:"2px solid",
                  borderColor: category===c.v ? "#00A86B" : "#EBEBEB",
                  background: category===c.v ? "#E6F7EF" : "#fff", color: category===c.v ? "#00A86B" : "#222",
                }}>{c.l}</button>
              ))}
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="どの部分が、どうでしたか？" rows={4}
              className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:8 }} />
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>操作の記録としてページ名が運営に送られます</p>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={onClose} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
              <button onClick={submit} disabled={submitting || !category} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background: category ? "#00A86B" : "#EBEBEB", color: category ? "#fff" : "#717171", border:"none", borderRadius:10, cursor:"pointer" }}>{submitting ? "送信中..." : "送信する"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// help-imagesバケットの公開URLから、削除に必要なストレージパスだけを取り出す
function helpImagePathFromUrl(url) {
  if (!url) return null;
  const marker = "/help-images/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length).split("?")[0];
}


// インストール案内（#/install・未ログインでも閲覧可・2026-07-22）：OS自動判定で手順を並べ、
// 画像2枠（help_images: install-ios / install-android）は管理者がアップロードできる（ヘルプ画像スロット方式）
function InstallGuide({ me }) {
  const [images, setImages] = useState({});
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const admin = isAdmin(me);
  const ios = isIOS();
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("help_images").select("slot_key,url").in("slot_key", ["install-ios","install-android"]);
        if (data) { const m = {}; data.forEach(r => { m[r.slot_key] = r.url; }); setImages(m); }
      } catch {}
    })();
  }, []);
  const upload = async (slotKey, file) => {
    if (!file || uploadingSlot) return;
    setUploadingSlot(slotKey);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = slotKey + "." + ext;
      const { error: upErr } = await supabase.storage.from("help-images").upload(path, file, { upsert: true });
      if (upErr) { alert("アップロードに失敗しました：" + upErr.message); setUploadingSlot(null); return; }
      const { data: urlData } = supabase.storage.from("help-images").getPublicUrl(path);
      const url = (urlData?.publicUrl || "") + "?t=" + Date.now();
      const { error: dbErr } = await supabase.from("help_images").upsert({ slot_key: slotKey, url, updated_at: new Date().toISOString() });
      if (dbErr) { alert("保存に失敗しました：" + dbErr.message); setUploadingSlot(null); return; }
      setImages(prev => ({ ...prev, [slotKey]: url }));
    } catch { alert("アップロードに失敗しました。"); }
    setUploadingSlot(null);
  };
  const slot = (slotKey, label, steps) => (
    <div key={slotKey} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"20px", boxShadow:"0 2px 10px rgba(0,0,0,0.05)" }}>
      <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{label}</p>
      <ol className="f-sans" style={{ margin:"0 0 14px", paddingLeft:20, fontSize:14, color:"#333", lineHeight:1.9 }}>
        {steps.map((s,i) => <li key={i}>{s}</li>)}
      </ol>
      {images[slotKey]
        ? <img src={images[slotKey]} alt={label+"の手順"} style={{ width:"100%", borderRadius:12, display:"block" }} />
        : <div className="f-sans" style={{ width:"100%", aspectRatio:"3 / 4", background:"#F5F5F5", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", color:"#B0B0B0", fontSize:13 }}>手順の画像（準備中）</div>}
      {admin && (
        <label className="f-sans" style={{ display:"inline-block", marginTop:10, fontSize:12, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>
          {uploadingSlot===slotKey ? "アップロード中..." : (images[slotKey] ? "画像を差し替え" : "＋ 画像をアップロード")}
          <input type="file" accept="image/*" style={{ display:"none" }} onChange={e => upload(slotKey, e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
  const iosSlot = slot("install-ios", "iPhone（Safari）", ["Safariでこのページを開く","下の共有ボタン（□に↑）をタップ","「ホーム画面に追加」を選ぶ","右上の「追加」をタップ"]);
  const andSlot = slot("install-android", "Android（Chrome）", ["Chromeでこのページを開く","右上のメニュー（⋮）をタップ","「アプリをインストール」または「ホーム画面に追加」を選ぶ","「インストール」をタップ"]);
  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"40px 16px 60px" }}>
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <div style={{ fontSize:64, lineHeight:1, marginBottom:12 }}>🥦</div>
        <h1 className="f-sans" style={{ fontSize:24, fontWeight:800, color:"#222", margin:"0 0 6px" }}>chitose-bankをアプリとして入れる</h1>
        <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.7, margin:0 }}>ホーム画面に追加すると、アプリのように開けて通知も受け取れます。</p>
      </div>
      <div style={{ display:"grid", gap:16 }}>
        {ios ? <>{iosSlot}{andSlot}</> : <>{andSlot}{iosSlot}</>}
      </div>
    </div>
  );
}

function HelpCenter({ me, onReportClick }) {
  const chapterFromHash = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const m = h.match(/^help\/(\w+)$/);
    return (m && HELP_CHAPTER_KEYS.includes(m[1])) ? m[1] : null;
  };
  const [openChapter, setOpenChapter] = useState(chapterFromHash());
  const [images, setImages] = useState({}); // { [slot_key]: url }
  const [uploadingSlot, setUploadingSlot] = useState(null);
  useEffect(() => {
    const onHash = () => setOpenChapter(chapterFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!openChapter) return;
    const el = document.getElementById("help-" + openChapter);
    if (el) setTimeout(() => el.scrollIntoView({ behavior:"smooth", block:"start" }), 50);
  }, [openChapter]);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("help_images").select("slot_key,url");
        if (data) {
          const map = {};
          data.forEach(row => { map[row.slot_key] = row.url; });
          setImages(map);
        }
      } catch {}
    })();
  }, []);
  const toggle = (key) => {
    const next = openChapter === key ? null : key;
    setOpenChapter(next);
    window.location.hash = next ? "/help/" + next : "/help";
  };
  const uploadSlotImage = async (slotKey, file) => {
    if (uploadingSlot) return;
    setUploadingSlot(slotKey);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = slotKey + "." + ext;
      const { error: upErr } = await supabase.storage.from("help-images").upload(path, file, { upsert: true });
      if (upErr) { alert("アップロードに失敗しました：" + upErr.message); setUploadingSlot(null); return; }
      const { data: urlData } = supabase.storage.from("help-images").getPublicUrl(path);
      const url = (urlData?.publicUrl || "") + "?t=" + Date.now();
      const { error: dbErr } = await supabase.from("help_images").upsert({ slot_key: slotKey, url, updated_at: new Date().toISOString() });
      if (dbErr) { alert("保存に失敗しました：" + dbErr.message); setUploadingSlot(null); return; }
      setImages(prev => ({ ...prev, [slotKey]: url }));
    } catch { alert("アップロードに失敗しました。"); }
    setUploadingSlot(null);
  };
  const deleteSlotImage = async (slotKey) => {
    if (!confirm("この画像を削除しますか？")) return;
    try {
      const path = helpImagePathFromUrl(images[slotKey]);
      if (path) await supabase.storage.from("help-images").remove([path]);
      const { error } = await supabase.from("help_images").delete().eq("slot_key", slotKey);
      if (error) { alert("削除に失敗しました：" + error.message); return; }
      setImages(prev => { const next = { ...prev }; delete next[slotKey]; return next; });
    } catch { alert("削除に失敗しました。"); }
  };
  return (
    <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（モバイル・CSS側の負マージン併用） */}
      <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>使い方ガイド</h1>
      <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>chitose-bankの使い方をまとめています</p>
      <div style={{ display:"grid", gap:16 }}>
        {HELP_CHAPTER_KEYS.map(key => {
          const ch = HELP_CONTENT[key];
          const isOpen = openChapter === key;
          return (
            <section key={key} id={"help-" + key} style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", overflow:"hidden" }}>
              <button onClick={() => toggle(key)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"20px 24px", background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <span>
                  <span style={{ display:"block", fontSize:12, color:"#B0B0B0", marginBottom:2 }}>{ch.num}</span>
                  <span style={{ fontSize:19, fontWeight:700, color:"#222" }}>{ch.title}</span>
                </span>
                <span style={{ fontSize:22, color:"#B0B0B0", flexShrink:0 }}>{isOpen ? "－" : "＋"}</span>
              </button>
              {isOpen && (
                <div style={{ padding:"0 24px 24px", display:"grid", gap:20 }}>
                  {key === "faq" && me && (
                    <button onClick={onReportClick} className="f-sans" style={{
                      justifySelf:"start", padding:"9px 18px", fontSize:13, fontWeight:600, color:"#00A86B",
                      background:"#E6F7EF", border:"none", borderRadius:20, cursor:"pointer",
                    }}>💬 この画面を報告</button>
                  )}
                  {ch.items.map((it, i) => {
                    const slotKey = it.key;
                    const imgUrl = images[slotKey];
                    return (
                      <div key={slotKey}>
                        {it.label && <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:"0 0 6px" }}>{it.label}</p>}
                        <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap" }}>{it.body}</p>
                        {imgUrl && <img src={imgUrl} alt="" style={{ display:"block", marginTop:12, width:"100%", borderRadius:12, border:"3px solid #E0E0E0", boxShadow:"0 4px 16px rgba(0,0,0,0.12)", boxSizing:"border-box" }} />}
                        {isAdmin(me) && (
                          <div style={{ marginTop:8 }}>
                            {imgUrl ? (
                              <button onClick={() => deleteSlotImage(slotKey)} className="f-sans" style={{ fontSize:11, color:"#E24B4A", background:"none", border:"1px solid #E24B4A44", borderRadius:8, padding:"4px 10px", cursor:"pointer" }}>🗑 削除</button>
                            ) : (
                              <label className="f-sans" style={{ display:"inline-block", fontSize:11, color:"#717171", background:"#F7F7F7", border:"1px dashed #D0D0D0", borderRadius:8, padding:"4px 10px", cursor: uploadingSlot ? "default" : "pointer" }}>
                                {uploadingSlot === slotKey ? "アップロード中..." : "＋ スクショを追加"}
                                <input type="file" accept="image/*" disabled={!!uploadingSlot} onChange={e => { const f = e.target.files?.[0]; if (f) uploadSlotImage(slotKey, f); e.target.value = ""; }} style={{ display:"none" }} />
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── ROOT ─────────────────────────────────────────────────────
export default function App(){
  // URL(#/タブ名)⇄tab の同期（リンク第1段）。有効タブ名のみ受け付ける
  const TAB_URL_KEYS = ["admin","boxes","search","work","profile","login","charter","privacy","terms","chats","saved","calendar","help","install","visit","qr","insurance"];
  const readHashTab = () => { const h = window.location.hash.replace(/^#\/?/, ""); if (h.startsWith("chat/")) return "work"; if (h === "apply/done" || h.startsWith("apply/")) return "search"; if (h.startsWith("work/job/")) return "search"; if (h === "work" || h.startsWith("work/")) return "work"; if (h === "profile" || h.startsWith("profile/")) return "profile"; if (h.startsWith("admin/review/")) return "admin"; if (h === "admin/consignment") return "admin"; if (h === "boxes" || h.startsWith("boxes/")) return "boxes"; if (h === "help" || h.startsWith("help/")) return "help"; if (h === "calendar" || h.startsWith("calendar/")) return "calendar"; return TAB_URL_KEYS.includes(h) ? h : null; };
  const initialHashTab = readHashTab(); // 起動した瞬間にURLでタブ指定があったか（同期useEffectが書き込む前の記録）
  const [tab,setTab]=useState(initialHashTab ?? "search");
  // tab → URL：タブが変わったらアドレスバーの#を書き換える
  useEffect(() => {
    const target = "#/" + tab;
    const _curHash = window.location.hash.replace(/^#\/?/, "");
    // フロー系(求人作成・編集・詳細・チャット・緊急連絡リンク)は正当にhashを保持
    const _inFlow = _curHash === "work/new" || _curHash.startsWith("work/new/") || _curHash.startsWith("work/edit/") || _curHash.startsWith("work/job/") || _curHash.startsWith("chat/") || _curHash.startsWith("emergency/");
    // workタブ内サブタブ(drafts/active/applicants/expired)は、向かうタブもworkの時だけ保持
    const _subTabOfWork = (tab === "work") && (_curHash === "work/drafts" || _curHash === "work/active" || _curHash === "work/applicants" || _curHash === "work/expired");
    const _subTabOfProfile = (tab === "profile") && (_curHash === "profile/worker" || _curHash === "profile/worker/profile" || _curHash === "profile/worker/applying" || _curHash === "profile/worker/approved" || _curHash === "profile/worker/calendar" || _curHash === "profile/employer" || _curHash === "profile/employer/profile" || _curHash === "profile/employer/drafts" || _curHash === "profile/employer/active" || _curHash === "profile/employer/applicants" || _curHash === "profile/employer/expired" || _curHash === "profile/employer/calendar");
    // 審査メールの深いリンク(#/admin/review/{job_number})を、tab同期で#/adminに巻き戻さないよう保持
    const _subTabOfAdmin = (tab === "admin") && (_curHash.startsWith("admin/review/") || _curHash === "admin/consignment");
    // ヘルプの章アンカー(#/help/{chapter})を、tab同期で#/helpに巻き戻さないよう保持
    const _subTabOfHelp = (tab === "help") && _curHash.startsWith("help/");
    // ボックス一覧ページのお知らせタブ(#/boxes/notices)を、tab同期で#/boxesに巻き戻さないよう保持
    const _subTabOfBoxes = (tab === "boxes") && _curHash.startsWith("boxes/");
    // 「今日」の奥の月カレンダー(#/calendar/month)を、tab同期で#/calendarに巻き戻さないよう保持（2026-07-24）
    const _subTabOfCalendar = (tab === "calendar") && _curHash.startsWith("calendar/");
    if (!_inFlow && !_subTabOfWork && !_subTabOfProfile && !_subTabOfAdmin && !_subTabOfHelp && !_subTabOfBoxes && !_subTabOfCalendar && window.location.hash !== target) window.location.hash = "/" + tab;
  }, [tab]);
  // 緊急連絡ディープリンク #/emergency/{application_id}（開始1時間前メールから直行・2026-07-16）
  // ログイン済み当事者→該当タブへ移動しモーダル自動展開（cb_emergencyAppId経由）。未ログイン→ログインへ（復帰用にcb_emergencyLink保存）
  const resolveEmergencyLink = async (appId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        try { sessionStorage.setItem("cb_emergencyLink", appId); } catch {}
        window.location.hash = "/login";
        return;
      }
      // RLSにより当事者(worker_id/farmer_id=本人)以外は0行しか返らない
      const { data: app } = await supabase.from("applications").select("id,worker_id,farmer_id").eq("id", appId).maybeSingle();
      if (!app) {
        alert("このページは応募の当事者のみ開けます。メールを受け取ったアカウントでログインし直してください。");
        window.location.hash = "/search";
        return;
      }
      try { sessionStorage.setItem("cb_emergencyAppId", app.id); } catch {}
      window.location.hash = (app.worker_id === session.user.id) ? "/profile/worker/approved" : "/profile/employer/applicants";
    } catch { window.location.hash = "/search"; }
  };
  // 初回ロード（hashchangeは発火しない）用
  useEffect(() => {
    const m = window.location.hash.replace(/^#\/?/, "").match(/^emergency\/([0-9a-fA-F-]+)$/);
    if (m) resolveEmergencyLink(m[1]);
  }, []);
  // URL → tab：戻る/進むボタン・URL直打ちでタブを切り替える
  useEffect(() => {
    const onHash = () => {
      const rawHash = window.location.hash.replace(/^#\/?/, "");
      const _em = rawHash.match(/^emergency\/([0-9a-fA-F-]+)$/);
      if (_em) { resolveEmergencyLink(_em[1]); return; }
      // 現在モード（雇い手/働き手）はempCtxに集約（同一ソース・二重状態を作らない）。プロフィールの側に入った時だけ
      // 更新し、共通タブ（カレンダー/チャット等）へ移っても保持（sticky・localStorage永続）。下部ナビの役割追従もこれを見る
      if (rawHash.startsWith("profile/employer")) { setEmpCtx(true); try { localStorage.setItem("cb_empCtx","1"); } catch {} }
      else if (rawHash === "profile" || rawHash.startsWith("profile/worker")) { setEmpCtx(false); try { localStorage.setItem("cb_empCtx","0"); } catch {} }
      if (rawHash === "work/new" || rawHash.startsWith("work/new/") || rawHash.startsWith("work/edit/")) { setShowJobPost(true); setTab("profile"); return; }
      if (!rawHash.startsWith("work/new") && !rawHash.startsWith("work/edit/")) { setShowJobPost(prev => prev ? false : prev); }
      setShowApplyDone(rawHash === "apply/done");
      setConsignRoom(rawHash === "admin/consignment");
      if (rawHash === "apply/done") {
        try { setApplyAlready(sessionStorage.getItem("cb_applyAlready")==="1"); sessionStorage.removeItem("cb_applyAlready"); } catch {}
      }
      const _cm = rawHash.match(/^chat\/([0-9a-f-]+)$/);
      setChatAppId(_cm ? _cm[1] : null);
      if (rawHash === "account") {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) { setOpenAccountForm(true); }
          else { setOpenAccountForm(false); window.location.hash = "/login"; }
        });
      } else {
        setOpenAccountForm(false);
      }
      const t = readHashTab(); if (t) setTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // 訪問者の同意ゲート（2026-07-24）：未ログイン & cb_visitConsent 未記録のアクセスは、
  // どの入口（QR・検索・直リンク）でも まず #/visit（同意の玄関）へ集約する。玄関は必ず一つ。
  // 元の宛先は cb_visitReturn に退避し、同意後に VisitEntrance.agree が読んで元ページへ戻す。
  // 例外＝玄関自身／法務ページ（規約・プラポリ・憲章）／認証系の機能リンク（login・account・emergency）。
  //   これらは同意前でも到達できないと、玄関の導線（規約リンク）や会員の認証が壊れるため。
  useEffect(() => {
    const gate = async () => {
      const raw = window.location.hash.replace(/^#\/?/, "");
      const exempt = raw === "visit" || raw === "terms" || raw === "privacy" || raw === "charter"
        || raw === "login" || raw === "account" || raw.startsWith("emergency/");
      if (exempt) return;
      let consent = false; try { consent = localStorage.getItem("cb_visitConsent") === "1"; } catch {}
      if (consent) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return; // ログイン済み会員はゲート対象外（同意は訪問者のみの概念）
      try { if (raw) localStorage.setItem("cb_visitReturn", raw); } catch {}
      window.location.hash = "/visit";
    };
    gate();
    window.addEventListener("hashchange", gate);
    return () => window.removeEventListener("hashchange", gate);
  }, []);
  // #/account 直打ち（初回ロード）の認証チェック。hashchangeイベントは初回ロードでは発火しないため別途判定
  useEffect(() => {
    if (window.location.hash.replace(/^#\/?/, "") !== "account") return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { setOpenAccountForm(true); }
      else { setOpenAccountForm(false); window.location.hash = "/login"; }
    });
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
  const [blockedAccount,setBlockedAccount]=useState(false); // 停止／追放されたアカウントの制限画面（2026-07-19）
  // ヘッダー（PC・モバイル下部バー）共通のアバター表示規則（2026-07-14改）：
  // 働き手=worker_profiles／雇い手空間(#/profile/employer*)の表示中=employer_profiles でアイコンを分ける。
  // 取得はme.id変化と雇い手空間の出入り(empCtx)ごと。編集画面での変更はonAvatarChangeで即時反映（マージ更新）。
  const [meAvatar,setMeAvatar]=useState({ url:"", name:"", empUrl:"", empName:"" });
  const isEmpCtxHash = () => window.location.hash.replace(/^#\/?/, "").startsWith("profile/employer");
  const [empCtx, setEmpCtx] = useState(() => { try { const s = localStorage.getItem("cb_empCtx"); return s !== null ? s === "1" : isEmpCtxHash(); } catch { return false; } });
  const [empPending, setEmpPending] = useState(0); // 農家モードの下部ナビ「🤝応募者」バッジ＝返事待ち（status=applied）件数
  useEffect(() => {
    if (!me?.id || !empCtx) { setEmpPending(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const { count } = await supabase.from("applications").select("id", { count:"exact", head:true }).eq("farmer_id", me.id).eq("status","applied");
        if (!cancelled) setEmpPending(count || 0);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [me?.id, empCtx]);

  // 下部ナビの宿題バッジ（第12弾・2026-07-23）：チャット未読スレッド／きょうの契約済み仕事／評価締切内未実施／差し戻し有無。
  // 1本のRPC(my_nav_badges)で取得。再計算＝起動・ページ遷移・既読等(cb:unreadRefresh)・モード切替。
  const [navBadges, setNavBadges] = useState({ chat_threads:0, calendar_today:0, todo:0, review_due:0, job_revision:0 });
  useEffect(() => {
    if (!me?.id) { setNavBadges({ chat_threads:0, calendar_today:0, todo:0, review_due:0, job_revision:0 }); return; }
    const refresh = async () => {
      try {
        const { data } = await supabase.rpc("my_nav_badges");
        if (data) setNavBadges({ chat_threads:data.chat_threads||0, calendar_today:data.calendar_today||0, todo:data.todo||0, review_due:data.review_due||0, job_revision:data.job_revision||0 });
      } catch {}
    };
    refresh();
    window.addEventListener("hashchange", refresh);
    window.addEventListener("cb:unreadRefresh", refresh);
    return () => { window.removeEventListener("hashchange", refresh); window.removeEventListener("cb:unreadRefresh", refresh); };
  }, [me?.id, empCtx]);
  // 下部ナビの初回コーチマーク（第12弾）：「← 左から順に、仕事の流れです」を1度だけ。タップで消える（localStorage既読）
  const [navCoach, setNavCoach] = useState(() => { try { return !localStorage.getItem("cb_navCoachSeen"); } catch { return false; } });
  const dismissNavCoach = () => { setNavCoach(false); try { localStorage.setItem("cb_navCoachSeen","1"); } catch {} };
  // 下部ナビもモード切替で反転（プロフィールのカードフリップと同じpflip・2026-07-22）。初回マウントは回さない
  const [navFlip, setNavFlip] = useState("");
  const navFlipInit = useRef(true);
  useEffect(() => {
    if (navFlipInit.current) { navFlipInit.current = false; return; }
    setNavFlip("pflip-in");
    const t = setTimeout(() => setNavFlip(""), 450);
    return () => clearTimeout(t);
  }, [empCtx]);
  useEffect(() => {
    if (!me?.id) { setMeAvatar({ url:"", name:"", empUrl:"", empName:"" }); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("worker_profiles").select("avatar_url,nickname").eq("auth_id", me.id).maybeSingle();
        const { data: ep } = await supabase.from("employer_profiles").select("avatar_url,nickname").eq("auth_id", me.id).maybeSingle();
        if (!cancelled) setMeAvatar({ url: data?.avatar_url || "", name: data?.nickname || me.name || "", empUrl: ep?.avatar_url || "", empName: ep?.nickname || me.name || "" });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [me?.id, empCtx]);
  // 行動計測：ページ遷移ロガー（ログイン済みのみ・page_eventsへfire-and-forget）。入力内容・キー操作は一切収集しない
  const lastLoggedHashRef = useRef(null);
  useEffect(() => {
    if (!me?.id) return;
    const logPageEvent = () => {
      const h = window.location.hash || "#/";
      if (h === lastLoggedHashRef.current) return; // 連続同一hashはskip
      lastLoggedHashRef.current = h;
      supabase.from("page_events").insert({ auth_id: me.id, page_hash: h }).then(() => {}, () => {});
    };
    logPageEvent();
    window.addEventListener("hashchange", logPageEvent);
    return () => window.removeEventListener("hashchange", logPageEvent);
  }, [me?.id]);
  const [needsAccountHolder,setNeedsAccountHolder]=useState(false); // account_holders未登録なら新規登録①を最優先オーバーレイ表示
  const [openAccountForm,setOpenAccountForm]=useState(false); // #/account 直打ち用(URL由来の任意入口・needsAccountHolderとは別系統)
  const [authV,setAuthV]=useState("login");
  const [showLanding,setShowLanding]=useState(false);
  const [showJobPost,setShowJobPost]=useState(()=>{ const h=window.location.hash.replace(/^#\/?/,""); return h==="work/new"||h.startsWith("work/new/")||h.startsWith("work/edit/"); });
  const [consignRoom,setConsignRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"")==="admin/consignment"; } catch { return false; } }); // 委託準備室（#/admin/consignment・管理者専用・2026-07-19）
  const [showApplyDone,setShowApplyDone]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/done");
  const [applyAlready,setApplyAlready]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/done" && sessionStorage.getItem("cb_applyAlready")==="1");
  const [chatAppId,setChatAppId]=useState(()=>{ const m=window.location.hash.replace(/^#\/?/,"").match(/^chat\/([0-9a-f-]+)$/); return m?m[1]:null; });
  // 規約v2・プラポリv2 全面改定バナー（7日間限定・2026-07-21〜07-28）。閉じるとlocalStorageで再表示しない
  const [legalV2BannerDismissed,setLegalV2BannerDismissed]=useState(()=>{ try { return localStorage.getItem("cb_legalv2_banner_dismissed")==="1"; } catch { return false; } });
  const showLegalV2Banner = (() => {
    const from = new Date("2026-07-21T00:00:00+09:00").getTime();
    const until = from + 7*24*60*60*1000;
    const now = Date.now();
    return !legalV2BannerDismissed && now >= from && now < until;
  })();
  const [showDevJump,setShowDevJump]=useState(false); // 開発用ジャンプ（管理者がログイン中でも各stepへ飛ぶ）
  const [showProfileMenu,setShowProfileMenu]=useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false); // モバイル下部バー左端☰（PCのmenuOpenとは別系統）
  // この画面を報告：☰の開閉やヘルプの章開閉と無関係な階層で開閉させる（2026-07-14・アンマウントバグ修正）
  const [showFeedback, setShowFeedback] = useState(false);
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
  // 新規登録①ゲート：meがセットされる箇所（ログイン/役割選択/セッション復元）を問わず、
  // meが変わるたびにaccount_holders行の有無を1箇所でチェックする（個別setMe箇所は無変更）
  useEffect(()=>{
    if(!me?.id){ setNeedsAccountHolder(false); return; }
    let cancelled=false;
    (async()=>{
      const { data } = await supabase.from('account_holders').select('id').eq('auth_id', me.id).maybeSingle();
      if(!cancelled) setNeedsAccountHolder(!data);
    })();
    return ()=>{ cancelled=true; };
  },[me?.id]);
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
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = () => setMenuOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onDoc = () => setMobileMenuOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [mobileMenuOpen]);

  // PWA(ホーム画面アプリ)専用：ページ最上部で下に引っ張ると強制リロード（pull-to-refresh・2026-07-14）。
  // Safari表示には標準のリロード手段があるため対象外。モーダル・フロー等の内部スクロール要素上では発動しない
  useEffect(() => {
    const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
    if (!standalone) return;
    let startY = null, fired = false;
    const inScrollableOrFixed = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        try {
          const st = getComputedStyle(n);
          if ((st.overflowY === "auto" || st.overflowY === "scroll") && n.scrollHeight > n.clientHeight + 1) return true;
          if (st.position === "fixed") return true; // モーダル・オーバーレイ内では発動させない
        } catch { return true; }
      }
      return false;
    };
    const onStart = (e) => {
      fired = false;
      if (window.scrollY > 0 || inScrollableOrFixed(e.target)) { startY = null; return; }
      startY = e.touches[0].clientY;
    };
    const onMove = (e) => {
      if (startY == null || fired) return;
      if (window.scrollY > 0) { startY = null; return; }
      if (e.touches[0].clientY - startY > 90) {
        fired = true;
        const ov = document.createElement("div");
        ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(255,255,255,.88);display:flex;align-items:center;justify-content:center;font-size:14px;color:#00A86B;font-weight:700;font-family:'Noto Sans JP',sans-serif";
        ov.textContent = "↻ 更新しています…";
        document.body.appendChild(ov);
        setTimeout(() => window.location.reload(), 150);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => { window.removeEventListener("touchstart", onStart); window.removeEventListener("touchmove", onMove); };
  }, []);

  // モバイル専用：下部バー＋浮遊ボタン「🌱 雇う」のスクロール連動格納。
  // 下方向に30px超スクロールで格納、上方向スクロール or 最上部付近で復帰。
  // 最下部付近（残り64px以内）では方向に関係なく常に格納＝フッターがバーに隠れない。
  // iOSのバウンスが上スクロール扱いになりバーが復帰してフッターを覆う問題への対処。
  // チャット画面(chatAppId)は入力欄との干渉を避けるため対象外。求人詳細の応募フッター
  // (.mobile-apply-bar)はこのクラスの対象外＝CSS側で触れていないので常時表示のまま。
  useEffect(() => {
    if (chatAppId) { document.body.classList.remove('cb-scroll-hide'); document.body.classList.remove('cb-dir-down'); return; }
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const diff = y - lastY;
      // トグル用の方向クラス：最下部の強制格納(下限)は適用しない（2026-07-16撤廃）。純粋に方向だけで出入り
      if (diff > 30) document.body.classList.add('cb-dir-down');
      else if (diff < -10) document.body.classList.remove('cb-dir-down');
      if (y < 40) { document.body.classList.remove('cb-scroll-hide'); document.body.classList.remove('cb-dir-down'); lastY = y; return; }
      // 最下部からの残り距離。64px以内=常に格納。180px以内=バウンス吸収帯（強フリックの
      // 跳ね返りやSafariツールバー伸縮で一瞬上向き判定になっても復帰させず状態維持）。
      // 180pxを超えて上に戻したときだけ通常の方向判定に戻る。
      const fromBottom = document.documentElement.scrollHeight - window.innerHeight - y;
      if (fromBottom <= 64) { document.body.classList.add('cb-scroll-hide'); lastY = y; return; }
      if (fromBottom <= 180) { lastY = y; return; }
      if (diff > 30) { document.body.classList.add('cb-scroll-hide'); lastY = y; }
      else if (diff < -10) { document.body.classList.remove('cb-scroll-hide'); lastY = y; }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // 初期位置（リロード直後に最下部にいる場合等）でもドック判定を反映
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.body.classList.remove('cb-scroll-hide');
      document.body.classList.remove('cb-dir-down');
    };
  }, [chatAppId]);

  // 入力中（テキスト入力にフォーカス＝キーボード表示）は下部バー・浮遊☰を隠す（2026-07-19）。
  // 入力欄の切替でチラつかないよう、blur時は少し遅らせて判定
  useEffect(() => {
    const isTextField = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag === "INPUT") { const t = (el.type || "text").toLowerCase(); return !["checkbox","radio","button","submit","reset","file","range","color","image"].includes(t); }
      return el.isContentEditable === true;
    };
    let t = null;
    const onFocusIn = (e) => { if (isTextField(e.target)) { if (t) { clearTimeout(t); t = null; } document.body.classList.add("cb-typing"); } };
    const onFocusOut = () => { if (t) clearTimeout(t); t = setTimeout(() => { if (!isTextField(document.activeElement)) document.body.classList.remove("cb-typing"); }, 120); };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => { document.removeEventListener("focusin", onFocusIn); document.removeEventListener("focusout", onFocusOut); if (t) clearTimeout(t); document.body.classList.remove("cb-typing"); };
  }, []);

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
      // 停止／追放チェック（2026-07-19）：ログイン封鎖(banned_until)が効くまでの猶予（既存トークン最大1h）を塞ぐ。
      // 停止中なら即サインアウトして制限画面へ（meはセットしない）
      try {
        const { data: modded } = await supabase.rpc('is_account_moderated', { p_uid: session.user.id });
        if (modded) { setBlockedAccount(true); try { await supabase.auth.signOut(); } catch {} setLoaded(true); return; }
      } catch {}
      const { data: dbFarmer } = await supabase.from('farmers').select('*').eq('email', session.user.email).single();
      if (dbFarmer) {
        const loggedIn = { id: dbFarmer.auth_id || dbFarmer.id, name: dbFarmer.name, email: dbFarmer.email, status: dbFarmer.status, joinedYear: dbFarmer.joined_year, prefecture: dbFarmer.prefecture || "", municipality: dbFarmer.municipality || "", planned_crops: dbFarmer.planned_crops || [], experience_tier: dbFarmer.experience_tier || "", farming_type: dbFarmer.farming_type || "", area_tan: dbFarmer.area_tan || "", sales_channels: dbFarmer.sales_channels || [], avatar_url: dbFarmer.avatar_url || "" };
        f = [loggedIn];
        setMe({ ...loggedIn, id: session.user.id });
        const _onNewJobFlow = (() => { const h = window.location.hash.replace(/^#\/?/, ""); return h === "work/new" || h.startsWith("work/new/"); })();
        if (!initialHashTab && !_onNewJobFlow) setTab("search"); // hash無しの時はさがすへ（デフォルトタブ）
      } else {
        // farmers行なし＝働き手または初回。最小形の me でログインさせる（段階1と同じ形）。
        // account_holders未登録ならneedsAccountHolderゲートが後段で①フォームを自動表示する。
        setMe({ id: session.user.id, email: session.user.email || "", name: "", isWorker: true });
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

  // プロフィール承認の「お帰りなさい」ポップアップ（2026-07-16）
  // approve_profile_text が notifications(type='profile_approved') を挿入する。
  // 起動時の未読チェック＋Realtime購読（承認された瞬間にも展開）。
  // 既読化＝確認操作（✕・ボックス外タップ・リンク遷移）の時だけ。それ以外では非表示・既読化しない
  // 運営お知らせ（admin_notice_registry・2026-07-16）：公開中を取得し未読分をポップアップ。
  // RLSが「published＋期間内」だけを返すので、フロントは対象(audience)・展開機会(trigger_on)・既読だけ判定する。
  // 展開機会（2026-07-17・カンマ区切りで複数可）：startup=起動時／login=ログイン画面を開いたとき／
  // after_login=ログイン後（ログイン済みでサイトを開いた時を含む）／approval=応募承認後（承認メール受信後にサイトを開いた時）
  const [activeNotices, setActiveNotices] = useState(null);
  const showNoticesFor = async (trigger) => {
    try {
      const { data } = await supabase.from("admin_notice_registry").select("id,name,body,audience,link_label,link_hash,trigger_on,image_url,show_every_time,repeat_chance,published,starts_at,ends_at").order("sort");
      if (!data || data.length === 0) return;
      let read = [];
      try { read = JSON.parse(localStorage.getItem("cb_readNotices") || "[]"); } catch {}
      const roleAud = !me ? ["all"] : me.isWorker ? ["all", "worker"] : ["all", "farmer"];
      // 公開中＋期間内だけを表示（2026-07-22）：管理者はRLSで下書き含む全行が返るため、フロントでも公開判定する。
      // 一般ユーザーはRLSで既に公開分のみだが、二重に担保して下書きが漏れないようにする
      const now = Date.now();
      const isLive = (n) => n.published
        && (!n.starts_at || now >= new Date(n.starts_at).getTime())
        && (!n.ends_at || now <= new Date(n.ends_at).getTime());
      const fresh = data.filter(n => isLive(n)
        && (n.trigger_on || "startup").split(",").map(s => s.trim()).includes(trigger)
        && (!read.includes(n.id) || n.show_every_time || (n.repeat_chance > 0 && Math.random() * 100 < n.repeat_chance))
        && roleAud.includes(n.audience));
      if (fresh.length > 0) setActiveNotices(prev => (prev && prev.length ? prev : fresh)); // 表示中は上書きしない＝1回1件
    } catch {}
  };
  useEffect(() => { showNoticesFor("startup"); }, [me?.id]); // ログインで農家/働き手向けの未読が増えることがあるため再判定
  useEffect(() => { if (tab === "login") showNoticesFor("login"); }, [tab]); // ログインをタップ＝ログイン画面を開いた瞬間に展開
  useEffect(() => { if (me?.id) showNoticesFor("after_login"); }, [me?.id]); // ログイン後（ログイン完了・ログイン済みの起動を含む）
  useEffect(() => { // 確認ページ（trigger=confirm）：LandingFlowが「農家プロ未入力で確認ページ到達」を検知してこのイベントを飛ばす
    const f = () => showNoticesFor("confirm");
    window.addEventListener("cb:confirmNotice", f);
    return () => window.removeEventListener("cb:confirmNotice", f);
  }, [me?.id]);
  // チャット未読通知（2026-07-17）：下部バー「チャット」に未読合計（当事者チャット＋運営DM）の赤バッジ。
  // 再計算のタイミング＝起動・ページ遷移(hashchange)・チャット/運営DMを開いて既読化した時(cb:unreadRefresh)
  const [chatUnread, setChatUnread] = useState(0);
  const [msgToast, setMsgToast] = useState(null); // アプリ内トースト（新着メッセージ・2026-07-19）：{text, hash}
  const msgToastTimer = useRef(null);
  useEffect(() => {
    if (!me?.id) { setChatUnread(0); return; }
    const refresh = async () => {
      try {
        const { data } = await supabase.rpc("my_unread_message_counts");
        if (data) setChatUnread((data.chat || 0) + (data.dm || 0));
      } catch {}
    };
    // 新着でアプリ内トースト表示（内容は出さない＝「新しいメッセージが届きました」のみ・B案）。
    // 自分の送信分・今まさに開いているチャットは出さない
    const showToast = (hash) => {
      const cur = window.location.hash.replace(/^#\/?/, "");
      if (hash === "/chats" && (cur === "chats" || cur.startsWith("chat/"))) return; // DM系
      if (hash.startsWith("/chat/") && cur === hash.replace(/^#?\/?/, "").replace(/^\//, "")) return;
      if (hash.startsWith("/chat/") && cur.startsWith("chat/")) return; // チャットを開いている間は出さない
      setMsgToast({ text: "新しいメッセージが届きました", hash });
      if (msgToastTimer.current) clearTimeout(msgToastTimer.current);
      msgToastTimer.current = setTimeout(() => setMsgToast(null), 5000);
    };
    const onMsg = (payload) => { refresh(); const m = payload?.new; if (m && m.sender_id !== me.id) showToast("/chat/" + m.application_id); };
    const onDm = (payload) => { refresh(); const m = payload?.new; if (m && m.from_admin) showToast("/chats"); };
    refresh();
    window.addEventListener("hashchange", refresh);
    window.addEventListener("cb:unreadRefresh", refresh);
    // リアルタイム（2026-07-19）：自分宛メッセージのINSERTを購読し、バッジ即時更新＋トースト。
    // 配信はRLS準拠＝自分が当事者のchat/自分宛DMしか届かない
    const ch = supabase.channel("unread-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onMsg)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, onDm)
      .subscribe();
    return () => { window.removeEventListener("hashchange", refresh); window.removeEventListener("cb:unreadRefresh", refresh); supabase.removeChannel(ch); };
  }, [me?.id]);
  // アプリアイコンのバッジに未読数を反映（2026-07-19）。ログアウト時は0でクリア
  useEffect(() => { syncAppBadge(me?.id ? chatUnread : 0); }, [chatUnread, me?.id]);
  // 採用おめでとうボックス（2026-07-19）：農家が採用を決定した応募を検知し、働き手に1回だけ展開
  // （localStorage cb_hiredBoxShownで応募ごとに1回）。起動時チェック＋applicationsのUPDATEをRealtime購読で即時展開
  const [hiredBox, setHiredBox] = useState(null); // {appId, jobNumber, farmerName, jobTitle}
  const [hiredInfoOpen, setHiredInfoOpen] = useState(null); // 開いている？マーク: emergency|flow|review|null
  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    const check = async () => {
      try {
        const { data: apps } = await supabase.from("applications")
          .select("id,job_number,farmer_id,terms_confirmed_farmer_at")
          .eq("worker_id", me.id).not("terms_confirmed_farmer_at", "is", null)
          .gte("terms_confirmed_farmer_at", new Date(Date.now() - 7 * 86400 * 1000).toISOString()) // 新端末で過去の採用を再生しない（直近7日限定）
          .order("terms_confirmed_farmer_at", { ascending: false }).limit(5);
        if (cancelled || !apps || apps.length === 0) return;
        let shown = []; try { shown = JSON.parse(localStorage.getItem("cb_hiredBoxShown") || "[]"); } catch {}
        const fresh = apps.find(a => !shown.includes(a.id));
        if (!fresh) return;
        const [epRes, jobRes] = await Promise.all([
          supabase.from("employer_profiles_public").select("nickname").eq("auth_id", fresh.farmer_id).maybeSingle(),
          supabase.from("jobs_public").select("crop,task").eq("job_number", fresh.job_number).maybeSingle(),
        ]);
        if (cancelled) return;
        try { localStorage.setItem("cb_hiredBoxShown", JSON.stringify([...shown, fresh.id])); } catch {}
        setHiredBox({
          appId: fresh.id, jobNumber: fresh.job_number,
          farmerName: (epRes.data?.nickname || "").trim() || "農家",
          jobTitle: jobRes.data ? [jobRes.data.crop, jobRes.data.task].filter(Boolean).join(" ") : "",
        });
        setHiredInfoOpen(null);
      } catch {}
    };
    check();
    const ch = supabase.channel("hired-watch")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "applications", filter: "worker_id=eq." + me.id }, check)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [me?.id]);
  // 段階お祝いボックス（2026-07-19）：②承認・⑤仕事・⑥評価を、働き手/農家の両側に1回だけ展開。
  // ①応募=apply/done・④採用=hiredBox は別で担当so除外。applications変化をRealtime購読＋起動時チェック
  const [stageBox, setStageBox] = useState(null); // {emoji,head,body,link,hash}
  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    const check = async () => {
      try {
        let shown = []; try { shown = JSON.parse(localStorage.getItem("cb_stageShown") || "[]"); } catch {}
        const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
        const [wRes, fRes] = await Promise.all([
          supabase.from("applications").select("id,job_number,status,attended,worker_confirmed_end_at,created_at").eq("worker_id", me.id).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
          supabase.from("applications").select("id,job_number,status,created_at").eq("farmer_id", me.id).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
        ]);
        if (cancelled) return;
        const cands = [];
        (wRes.data || []).forEach(a => {
          if (["approved","meeting","interview","contracted","working","completed"].includes(a.status)) cands.push({ a, role:"w", stage:"approved" });
          if (a.status === "completed" && a.attended === true && !a.worker_confirmed_end_at) cands.push({ a, role:"w", stage:"worked" });
          if (a.status === "completed" && a.worker_confirmed_end_at) cands.push({ a, role:"w", stage:"reviewed" });
        });
        (fRes.data || []).forEach(a => {
          if (a.status === "applied") cands.push({ a, role:"f", stage:"applied" });
          if (a.status === "completed") cands.push({ a, role:"f", stage:"worked" });
        });
        // 候補を順に確認：農家側は自分の求人(全status)をRLSで読めるので、行が無い＝削除済みの孤児応募
        // → 存在しない求人の完了ボックスは出さずスキップ（既読に倒して次へ）。働き手側はjobsを読めないのでjobs_publicで題名解決（2026-07-22）
        let fresh = null, jobRow = null;
        for (const c of cands) {
          const key = `${c.a.id}:${c.stage}:${c.role}`;
          if (shown.includes(key)) continue;
          if (c.role === "f") {
            const { data } = await supabase.from("jobs").select("crop,task").eq("job_number", c.a.job_number).maybeSingle();
            if (cancelled) return;
            if (!data) { shown.push(key); try { localStorage.setItem("cb_stageShown", JSON.stringify(shown)); } catch {} continue; }
            fresh = c; jobRow = data; break;
          }
          // 働き手側：jobsをRLSで読めないので job_exists RPCで実在確認。削除済み(false)はスキップ＝
          // 存在しない求人の完了ボックスを出さない。クローズ済み等(true・jobs_publicには無い)は題名フォールバックで表示（2026-07-22）
          const { data: exists } = await supabase.rpc('job_exists', { p_job_number: c.a.job_number });
          if (cancelled) return;
          if (exists === false) { shown.push(key); try { localStorage.setItem("cb_stageShown", JSON.stringify(shown)); } catch {} continue; }
          const { data } = await supabase.from("jobs_public").select("crop,task").eq("job_number", c.a.job_number).maybeSingle();
          if (cancelled) return;
          fresh = c; jobRow = data; break;
        }
        if (!fresh) return;
        const title = jobRow ? ([jobRow.crop, jobRow.task].filter(Boolean).join(" ") || `求人 #${fresh.a.job_number}`) : `求人 #${fresh.a.job_number}`;
        try { localStorage.setItem("cb_stageShown", JSON.stringify([...new Set([...shown, `${fresh.a.id}:${fresh.stage}:${fresh.role}`])])); } catch {}
        const defs = {
          "w:approved": { emoji:"🎉", head:"承認されました！", body:`「${title}」に承認されました。打ち合わせ・面接をチャットで進めましょう。`, link:"チャットを開く →", hash:"/chat/" + fresh.a.id },
          "w:worked":   { emoji:"🌾", head:"お仕事おつかれさまでした", body:`農家が「${title}」の作業完了を記録しました。最後に、お互いを評価しましょう。`, link:"評価する →", hash:"/profile/worker/approved" },
          "w:reviewed": { emoji:"⭐", head:"評価を送りました", body:`ありがとうございました。「${title}」の実績が、あなたのプロフィールに反映されます。`, link:"実績を見る →", hash:"/profile/worker" },
          "f:applied":  { emoji:"📩", head:"新しい応募が届きました", body:`「${title}」に新しい応募があります。プロフィールを見て、承認するか決めましょう。`, link:"応募者を見る →", hash:"/profile/employer/applicants" },
          "f:worked":   { emoji:"🌾", head:"作業が完了しました", body:`「${title}」の作業が完了しました。働き手を評価しましょう。`, link:"応募者を見る →", hash:"/profile/employer/applicants" },
        };
        const d = defs[`${fresh.role}:${fresh.stage}`];
        if (d && !cancelled) setStageBox(d);
      } catch {}
    };
    check();
    const ch = supabase.channel("stage-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: "worker_id=eq." + me.id }, check)
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: "farmer_id=eq." + me.id }, check)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [me?.id]);
  // approvalトリガー（応募承認後）の専用照会は2026-07-17に撤去：熱中症お知らせがafter_login×毎回表示に変更され、
  // ログイン済み利用者の来訪すべてをカバーするため。approval値の判定はshowNoticesForに残っており、再開時はここにeffectを足すだけ
  const dismissNotices = () => {
    // 既読にするのは表示した1件だけ。残りは次回サイトを開いたときに1件ずつ＝詰め込まない（2026-07-16たきと方針）
    setActiveNotices(prev => {
      const n = prev?.[0];
      if (n) {
        try {
          const read = JSON.parse(localStorage.getItem("cb_readNotices") || "[]");
          localStorage.setItem("cb_readNotices", JSON.stringify([...new Set([...read, n.id])]));
        } catch {}
      }
      return null;
    });
  };
  const [welcomeApproved, setWelcomeApproved] = useState(null); // { name, ids: [notification.id] }
  const showWelcomeApproved = useCallback(async (uid, noteIds) => {
    let name = "";
    try {
      const { data: wp } = await supabase.from("worker_profiles").select("nickname").eq("auth_id", uid).maybeSingle();
      name = (wp?.nickname || "").trim();
    } catch {}
    setWelcomeApproved(prev => ({ name, ids: [...new Set([...(prev?.ids || []), ...noteIds])] }));
  }, []);
  const confirmWelcomeApproved = useCallback((thenNavigate) => {
    setWelcomeApproved(prev => {
      const ids = prev?.ids || [];
      if (ids.length) supabase.from("notifications").update({ read: true }).in("id", ids).then(() => {}, () => {});
      return null;
    });
    if (typeof thenNavigate === "function") thenNavigate();
  }, []);
  useEffect(() => {
    let channel = null;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const uid = session.user.id;
        // 起動時：未読のprofile_approvedがあれば展開（既読化はしない）
        const { data: notes } = await supabase.from("notifications").select("id")
          .eq("farmer_id", uid).eq("type", "profile_approved")
          .or("read.is.null,read.eq.false").limit(5);
        if (notes && notes.length > 0) showWelcomeApproved(uid, notes.map(n => n.id));
        // リアルタイム：サイトを開いている最中に承認されたら即展開
        channel = supabase.channel("cb-profile-approved")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "farmer_id=eq." + uid }, (payload) => {
            if (payload.new?.type === "profile_approved") showWelcomeApproved(uid, [payload.new.id]);
          })
          .subscribe();
      } catch {}
    })();
    return () => { if (channel) { try { supabase.removeChannel(channel); } catch {} } };
  }, [showWelcomeApproved]);

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
    setTab("profile");
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

  // 停止／追放されたアカウントの制限画面（2026-07-19）：ログイン封鎖が効くまでの猶予も含めここで止める
  if (blockedAccount) return (
    <div style={{ minHeight:"100vh", background:"#fff", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"0 28px" }}>
      <div style={{ fontSize:44, marginBottom:14 }}>⏸</div>
      <h2 className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 10px" }}>アカウントの利用を停止しています</h2>
      <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.9, maxWidth:360, margin:0 }}>
        現在、このアカウントはご利用いただけません。<br/>
        お心当たりのない場合や、詳細のお問い合わせは、下記までご連絡ください。
      </p>
      <a href="mailto:t5fki6643qty@gmail.com" className="f-sans" style={{ marginTop:18, fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline" }}>運営に問い合わせる</a>
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
    {k:"profile",l:"プロフィール",modes:["farmer","worker"]},
    ...(isAdmin(me)?[{k:"admin",l:"管理",badge:badgeCnt,modes:["farmer","worker"]}]:[]),
  ];
  const TABS = ALL_TABS;

  const visibleTabKeys = TABS.map(t=>t.k);
  // 未ログインで input（ログイン画面）要求時はモード不問で通す（認証は役割不問・骨格⑥）
  // 部屋番号(TAB_URL_KEYS)にある部屋は全て到達可（避難部屋含む・骨格④）。資格の無い部屋と迷子はsearchへ
  const safeTab = TAB_URL_KEYS.includes(tab)
    ? (((tab === "admin" || tab === "boxes" || tab === "qr") && !isAdmin(me)) || (tab === "insurance" && !me) ? "search" : tab)
    : "search";

  // 下部ナビの役割追従（2026-07-22）：農家モード（me && empCtx）は「さがす・いいね」を「📣求人・🤝応募者」に差し替え。
  // 後半3つ（カレンダー・チャット・プロフィール）は両モード共通。未ログインは現行のまま（empNav=false）
  const empNav = !!(me && empCtx);
  // 訪問者版3タブ（未ログイン・2026-07-24）：さがす／入れ方／登録・ログイン
  const visitorNav = [
    { k:"search",  icon:"🔍", label:"さがす" },
    { k:"install", icon:"📲", label:"入れ方", hash:"/install" },
    { k:"login",   icon:"🔑", label:"登録・ログイン", hash:"/login" },
  ];
  // 農家：求人→応募者→チャット(③約束する)→カレンダー(④当日)→プロフィール（第12弾・時系列。働き手と文法統一）
  const navTabs = !me
    ? visitorNav
    : empNav
    ? [
        { k:"emp-jobs",       icon:"📣", label:"求人",       hash:"/profile/employer/active" },
        { k:"emp-applicants", icon:"🤝", label:"応募者",     hash:"/profile/employer/applicants", badge: empPending },
        { k:"chats",          icon:"💬", label:"チャット" },
        { k:"calendar",       icon:"📆", label:"今日" },
        { k:"profile",        icon:"👤", label:"プロフィール" },
      ]
    : MOBILE_TABS;

  return(
    <div style={{minHeight:"100vh",background:C.washi,color:C.ink,"--mode-accent":modeAccent,"--role-accent":(me && !empCtx) ? ROLE_ORANGE : ROLE_GREEN,"--role-accent-soft":(me && !empCtx) ? "rgba(247,107,28,0.15)" : "rgba(0,168,107,0.13)"}}>
      <style>{CSS}</style>

      {/* 働き手/雇い手プレビューの全域ボックス（どの画面のアイコンからでもイベントで展開・2026-07-19） */}
      {/* 採用おめでとうボックス（2026-07-19）：花びら🌸＋求人リンク＋？マーク3つ（緊急連絡先・採用からの流れ・評価とは） */}
      {/* 段階お祝いボックス（2026-07-19・②承認/⑤仕事/⑥評価・働き手/農家両側）：お知らせ規格の意匠 */}
      {stageBox && (
        <div onClick={()=>setStageBox(null)} style={{ position:"fixed", inset:0, zIndex:9630, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", border:"3px solid #00A86B", borderRadius:20, padding:"28px 24px 22px", maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", textAlign:"left", boxShadow:"0 12px 48px rgba(0,0,0,0.25)", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setStageBox(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <div style={{ fontSize:34, marginBottom:8 }}>{stageBox.emoji}</div>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text={stageBox.head} /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0 }}>{stageBox.body}</p>
            <button onClick={()=>{ const h = stageBox.hash; setStageBox(null); window.location.hash = h; }} className="f-sans" style={{ marginTop:16, background:"none", border:"none", borderBottom:"2px solid #00A86B", padding:"0 0 2px", fontSize:18, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>{stageBox.link}</button>
          </div>
        </div>
      )}
      {hiredBox && (
        <div onClick={()=>setHiredBox(null)} style={{ position:"fixed", inset:0, zIndex:9640, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, animation:"fadeIn .2s ease", overflow:"hidden" }}>
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} className="cb-petal" style={{ left: `${(i * 7.3 + 3) % 100}%`, fontSize: 14 + (i % 4) * 5, animationDuration: `${4 + (i % 5)}s`, animationDelay: `${(i % 7) * 0.6}s` }}>🌸</span>
          ))}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", border:"3px solid #00A86B", borderRadius:20, padding:"28px 24px 20px", maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", textAlign:"left", boxShadow:"0 12px 48px rgba(0,0,0,0.25)", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setHiredBox(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text="採用されました！" /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:"0 0 14px" }}>
              {hiredBox.farmerName}さんの
              <a href={"#/work/job/" + hiredBox.jobNumber} onClick={()=>setHiredBox(null)} style={{ color:"#00A86B", fontWeight:700 }}>「{hiredBox.jobTitle || `求人 #${hiredBox.jobNumber}`}」</a>
              に採用されました。
            </p>
            {[
              { k:"emergency", l:"緊急連絡先", body:"当日行けない・遅れる時は、プロフィールの「きょうの仕事」ページにある「⚠️ 緊急連絡」から連絡できます。無断欠勤は記録に残るため、必ず連絡してください。" },
              { k:"flow", l:"採用からの流れ", body:"作業日までにチャットで最終確認（集合場所・持ち物・時間）→ 当日作業 → 終了後に農家が完了処理をします。困ったことはチャットで相談してください。" },
              { k:"review", l:"評価とは？", body:"仕事を終えたあと、農家と働き手がお互いを記録する仕組みです。「また呼びたい」と評価されてお気に入り登録されると、その農家のリピート即決の対象になることがあります。" },
            ].map(r => (
              <div key={r.k} style={{ borderTop:"1px solid #F0F0F0", padding:"10px 0" }}>
                <button onClick={()=>setHiredInfoOpen(v => v === r.k ? null : r.k)} className="f-sans" style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"none", border:"none", padding:0, fontSize:15, fontWeight:700, color:"#222", cursor:"pointer" }}>
                  {r.l}
                  <span style={{ width:24, height:24, borderRadius:"50%", background:"#E6F7EF", color:"#00A86B", fontSize:14, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>？</span>
                </button>
                {hiredInfoOpen === r.k && <p className="f-sans fade-in" style={{ fontSize:13, color:"#555", lineHeight:1.8, margin:"8px 0 0" }}>{r.body}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* アプリ内トースト（新着メッセージ・2026-07-19）：画面上部からスライドイン。タップでチャットへ。内容は出さない */}
      {msgToast && (
        <button onClick={()=>{ const h = msgToast.hash; setMsgToast(null); window.location.hash = h; }} className="f-sans"
          style={{ position:"fixed", top:"calc(env(safe-area-inset-top, 0px) + 12px)", left:12, right:12, zIndex:11000, maxWidth:460, margin:"0 auto",
                   display:"flex", alignItems:"center", gap:12, background:"#222", color:"#fff", border:"none", borderRadius:14,
                   padding:"14px 16px", cursor:"pointer", boxShadow:"0 8px 28px rgba(0,0,0,0.28)", textAlign:"left", animation:"cbToastIn .28s cubic-bezier(.2,.9,.3,1) both" }}>
          <span style={{ fontSize:22, lineHeight:1, flexShrink:0 }}>💬</span>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ display:"block", fontSize:14, fontWeight:700 }}>{msgToast.text}</span>
            <span style={{ display:"block", fontSize:12, color:"#B8B8B8", marginTop:2 }}>タップして開く</span>
          </span>
          <span aria-label="閉じる" onClick={(e)=>{ e.stopPropagation(); setMsgToast(null); }} style={{ flexShrink:0, width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>✕</span>
        </button>
      )}
      <WorkerPreviewSheet />
      <EmployerPreviewSheet />

      {/* ── プロフィール承認の「お帰りなさい」ポップアップ（起動時1回・ボックス展開） ── */}
      {welcomeApproved && (
        <div onClick={()=>confirmWelcomeApproved()} style={{ position:"fixed", inset:0, zIndex:11000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"28px 24px 24px", maxWidth:360, width:"100%", textAlign:"center", position:"relative", boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
            <button onClick={()=>confirmWelcomeApproved()} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <div style={{ fontSize:44, lineHeight:1, marginBottom:12 }}>🎉</div>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 6px" }}>お帰りなさい{welcomeApproved.name ? "、" + welcomeApproved.name + "さん" : ""}</p>
            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#00A86B", margin:"0 0 4px" }}>プロフィールが承認されました！</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 18px" }}>さっそく確認してみましょう！</p>
            <button onClick={()=>confirmWelcomeApproved(()=>{ try { sessionStorage.setItem("cb_openWorkerPreview", "1"); } catch {} window.location.hash = "/profile/worker/profile"; })}
              className="f-sans" style={{ width:"100%", padding:"13px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>プレビューを見る 🔗</button>
          </div>
        </div>
      )}

      {/* 運営お知らせポップアップの規定（2026-07-17設計）：左詰め・緑の太縁(3px)・タイトルと説明の間に横線・
          上限=画面上から30px・下限=下部フッターの40px上（2026-07-18に20px引き上げ）・最後の段に「〇〇する」形式のリンク（タップ=既読化して遷移）。
          文字はタイトル20/本文18/リンク18（2026-07-17縮小・説明文が5行を超えると読まれないため）。1回の起動で1件、残りは次回（たきと方針） */}
      {activeNotices && !welcomeApproved && (
        <div onClick={dismissNotices} className="cb-box-overlay" style={{ zIndex:10900 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            <button onClick={dismissNotices} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#00A86B", margin:"0 0 14px" }}>📢 お知らせ</p>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text={activeNotices[0].name} /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            {activeNotices[0].image_url
              ? <img src={activeNotices[0].image_url} alt={activeNotices[0].name} style={{ display:"block", width:"100%", borderRadius:12 }} />
              : <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>{activeNotices[0].body}</p>}
            {activeNotices[0].link_label && activeNotices[0].link_hash && (
              <p style={{ margin:"22px 0 0" }}>
                <button onClick={()=>{ const h = activeNotices[0].link_hash; dismissNotices(); if (h.startsWith("event:")) window.dispatchEvent(new Event(h.slice(6))); else window.location.hash = h; }} className="f-sans" style={{ background:"none", border:"none", padding:"0 0 1px", fontSize:18, fontWeight:800, color:"#00A86B", borderBottom:"2px solid #00A86B", cursor:"pointer" }}><NoticeJumpText text={activeNotices[0].link_label + " →"} /></button>
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── PC HEADER（無変更） ── */}
      <header className="app-header app-header-desktop">
        <div className="app-header-inner">
        <button onClick={() => { setTab("search"); window.location.hash = "/search"; }}
          style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                   fontSize:17, fontWeight:800, color:"#00A86B", padding:0 }}>
          🥦 chitose-bank
        </button>

        <div style={{ display:"flex", alignItems:"center", gap:12, position:"relative" }}>
          <button onClick={() => { window.location.hash = "/work/new"; }}
            className="f-sans app-header-post-btn"
            style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                     fontSize:14, fontWeight:600, color:"#222", padding:"8px 14px", borderRadius:20 }}>
            <span className="post-label-full">求人を出す</span>
            <span className="post-label-short">＋求人</span>
          </button>

          <button onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
            aria-label="メニュー"
            style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
                     background:"#fff", border:"1px solid #EBEBEB", borderRadius:24,
                     padding:"6px 8px 6px 12px", fontFamily:"inherit" }}>
            <span style={{ fontSize:14, lineHeight:1 }}>☰</span>
            <span style={{ width:28, height:28, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
              <Avatar url={empCtx ? meAvatar.empUrl : meAvatar.url} name={(empCtx ? meAvatar.empName : meAvatar.name) || me?.name} size={28} bg={empCtx ? ROLE_GREEN : ROLE_ORANGE} />
            </span>
          </button>

          {menuOpen && (
            <div style={{ position:"absolute", top:52, right:0, minWidth:200, background:"#fff",
                          border:"1px solid #EBEBEB", borderRadius:12,
                          boxShadow:"0 4px 16px rgba(0,0,0,.08)", padding:"8px 0", zIndex:30 }}>
              {MENU_ITEMS
                .filter(item =>
                  (item.auth ? !!me : true) &&
                  (item.guestOnly ? !me : true))
                .map(item => (
                  <button key={item.key}
                    onClick={() => { setMenuOpen(false); window.location.hash = item.hash; }}
                    className="f-sans"
                    style={{ display:"block", width:"100%", textAlign:"left", background:"none",
                             border:"none", cursor:"pointer", fontFamily:"inherit",
                             fontSize:14, color:"#222", padding:"10px 16px" }}>
                    {item.label}
                  </button>
                ))}
              <button onClick={() => { setMenuOpen(false); window.location.hash = "/help"; }}
                className="f-sans"
                style={{ display:"block", width:"100%", textAlign:"left", background:"none",
                         border:"none", cursor:"pointer", fontFamily:"inherit",
                         fontSize:14, color:"#222", padding:"10px 16px" }}>
                📖 使い方
              </button>
              {me && (
                <button onClick={() => { setMenuOpen(false); setShowFeedback(true); }}
                  className="f-sans"
                  style={{ display:"block", width:"100%", textAlign:"left", background:"none",
                           border:"none", cursor:"pointer", fontFamily:"inherit",
                           fontSize:14, color:"#222", padding:"10px 16px" }}>
                  💬 この画面を報告
                </button>
              )}
              {isAdmin(me) && (
                <button onClick={() => { setMenuOpen(false); window.location.hash = "/admin"; }}
                  className="f-sans"
                  style={{ display:"block", width:"100%", textAlign:"left", background:"none",
                           border:"none", cursor:"pointer", fontFamily:"inherit",
                           fontSize:14, color:"#222", padding:"10px 16px" }}>
                  ⚙️ 管理
                </button>
              )}
              {me && (
                <button onClick={() => { setMenuOpen(false); handleLogout(); }}
                  className="f-sans"
                  style={{ display:"block", width:"100%", textAlign:"left", background:"none",
                           border:"none", cursor:"pointer", fontFamily:"inherit",
                           fontSize:14, color:"#E24B4A", padding:"10px 16px",
                           borderTop:"1px solid #EBEBEB", marginTop:4 }}>
                  ログアウト
                </button>
              )}
            </div>
          )}
        </div>
        </div>
      </header>

      {/* ── MOBILE ☰浮遊ボタン（2026-07-13 下部バーから上部左へ移設。fixed＝スクロール追従）
           新規登録（本人情報の入力）表示中は非表示（2026-07-19） ── */}
      {!(needsAccountHolder || openAccountForm) && <div className="app-header-mobile-float">
        <button
          onClick={(e) => { e.stopPropagation(); setMobileMenuOpen(v => !v); }}
          aria-label="メニュー"
          className={"app-header-mobile-float-btn" + (mobileMenuOpen ? " active" : "")}>
          <span className="icon">☰</span>
        </button>
        {mobileMenuOpen && (
          <div className="app-header-mobile-menu" onClick={(e)=>e.stopPropagation()}>
            <button onClick={()=>{ setMobileMenuOpen(false); try{localStorage.removeItem("landingFlowDraft_v1");}catch{} setShowJobPost(true); window.location.hash="/work/new"; }} className="f-sans app-header-mobile-menu-item">🌱 求人を出す</button>
            <button onClick={()=>{ setMobileMenuOpen(false); window.location.hash="/help"; }} className="f-sans app-header-mobile-menu-item">📖 使い方</button>
            {me && (
              <button onClick={()=>{ setMobileMenuOpen(false); setShowFeedback(true); }} className="f-sans app-header-mobile-menu-item">💬 この画面を報告</button>
            )}
            {MOBILE_MENU_ITEMS
              .filter(item => !item.adminOnly || isAdmin(me))
              .map(item => (
                <button key={item.key} onClick={()=>{ setMobileMenuOpen(false); window.location.hash = item.hash; }} className="f-sans app-header-mobile-menu-item">{item.label}</button>
              ))}
            {me && (
              <button onClick={()=>{ setMobileMenuOpen(false); handleLogout(); }} className="f-sans app-header-mobile-menu-item" style={{ color:"#E24B4A", borderTop:"1px solid #EBEBEB" }}>ログアウト</button>
            )}
          </div>
        )}
      </div>}

      {/* 下部ナビ初回コーチマーク（第12弾）：ログイン済みの初回1度だけ。タップで消える（localStorage既読） */}
      {me && navCoach && !(needsAccountHolder || openAccountForm) && (
        <button className="f-sans nav-coach" onClick={dismissNavCoach}>← 左から順に、仕事の流れです</button>
      )}

      {/* ── MOBILE BOTTOM NAV（5機能タブ。☰は上部浮遊へ移設済み・第12弾で時系列順に）
           新規登録（本人情報の入力）表示中は非表示（2026-07-19） ── */}
      {!(needsAccountHolder || openAccountForm) && <header className="app-header app-header-mobile">
        <div className={"app-header-mobile-tabs" + (navFlip ? " " + navFlip : "")}>
          {navTabs.map(t => {
            const cur = window.location.hash.replace(/^#\/?/, "");
            const isActive = t.hash
              ? cur.startsWith(t.hash.replace(/^\//, ""))
              : (t.k === "profile"
                  ? (empNav ? (cur === "profile/employer" || cur === "profile") : safeTab === "profile")
                  : safeTab === t.k);
            // 宿題バッジ（第12弾）：数字＝待たせている/自分の宿題の件数。求人(農家)の差し戻しのみ⚠フラグ
            const badge = t.k === "chats" ? (navBadges.chat_threads || 0)
              : t.k === "calendar" ? (navBadges.todo || 0)
              : t.k === "profile" ? (navBadges.review_due || 0)
              : (t.badge || 0);
            const warn = t.k === "emp-jobs" && (navBadges.job_revision || 0) > 0;
            return (
            <button key={t.k}
              onClick={() => {
                setMobileMenuOpen(false);
                // プロフィールタップ＝現在モードのトップへ（農家モード→農家プロ入口／それ以外→働き手入口）
                if (t.k === "profile") {
                  if (empCtx) {
                    window.location.hash = "/profile/employer";
                    window.dispatchEvent(new Event("cb:employerHome"));
                  } else {
                    setTab("profile");
                    window.location.hash = "/profile/worker";
                    window.dispatchEvent(new Event("cb:workerHome"));
                  }
                  return;
                }
                if (t.hash) { setTab("profile"); window.location.hash = t.hash; return; }
                setTab(t.k); window.location.hash = "/" + t.k;
              }}
              className={"app-header-mobile-tab" + (isActive ? " active" : "")}>
              <span className={"icon" + (t.k === "chats" && (navBadges.chat_threads || 0) > 0 ? " cb-jump" : "")} style={{ position:"relative" }}>
                {t.k === "profile" && me ? <Avatar url={empCtx ? meAvatar.empUrl : meAvatar.url} name={(empCtx ? meAvatar.empName : meAvatar.name) || me?.name} size={26} bg={empCtx ? ROLE_GREEN : ROLE_ORANGE} /> : t.icon}
                {badge > 0 && (
                  <span style={{ position:"absolute", top:-4, right:-10, minWidth:16, height:16, borderRadius:8, background:"#E24B4A", color:"#fff", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px", pointerEvents:"none" }}>{badge > 99 ? "99+" : badge}</span>
                )}
                {warn && (
                  <span aria-label="差し戻しあり" style={{ position:"absolute", top:-6, right:-10, fontSize:13, lineHeight:1, pointerEvents:"none", filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.25))" }}>⚠️</span>
                )}
              </span>
              <span className="label">{t.label}</span>
            </button>
            );
          })}
        </div>
      </header>}

      {/* ── 旧・下部タブバー（さがす/プロフィール/管理）：モバイル下部バー統合につき廃止。
           削除ではなく非表示化（CSS）。PCは元々min-width:769pxで非表示済みのため無変更。
           不要と判断できたら後日A群としてこのブロックごと削除する ── */}
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
      <main style={{maxWidth:1200,margin:"0 auto",padding:"16px 24px 72px"}}>
        <DevBadge label="App(Dashboard/Home)" />
        {me&&!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab!=="terms"&&safeTab!=="privacy"&&showLegalV2Banner&&(
          <div className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, margin:"0 0 16px", padding:"14px 18px", background:"#EAF7F0", border:"1px solid #00A86B", borderRadius:12, fontSize:13, color:"#1B5E3F", lineHeight:1.6 }}>
            <span>利用規約とプライバシーポリシーを全面改定しました（7/21）</span>
            <div style={{ display:"flex", alignItems:"center", gap:14, flexShrink:0 }}>
              <button onClick={()=>{ window.location.hash="/terms"; }} className="f-sans" style={{ background:"none", border:"none", padding:0, fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>→ 読む</button>
              <button onClick={()=>{ setLegalV2BannerDismissed(true); try{ localStorage.setItem("cb_legalv2_banner_dismissed","1"); }catch{} }} aria-label="閉じる" style={{ background:"none", border:"none", fontSize:16, color:"#1B5E3F", cursor:"pointer", padding:0 }}>×</button>
            </div>
          </div>
        )}
        {(needsAccountHolder || openAccountForm) ? (
          <AccountHolderForm onDone={()=>{
            setNeedsAccountHolder(false); setOpenAccountForm(false);
            const ret = peekApplyReturn();
            if (ret) { window.location.hash = "/work/job/" + ret; setTab("search"); }
            else { window.location.hash="/search"; setTab("search"); }
          }} onSessionExpired={()=>{
            setNeedsAccountHolder(false); setOpenAccountForm(false);
            window.location.hash="/login";
          }} onShowTerms={()=>setShowTerms(true)} onShowPrivacy={()=>setShowPrivacy(true)} />
        ) : chatAppId ? (
          <ChatView applicationId={chatAppId} onBack={()=>{ window.history.length > 1 ? window.history.back() : (window.location.hash="/profile"); }} />
        ) : showApplyDone ? (
          <div style={{ minHeight:"70vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", maxWidth:400, margin:"0 auto", padding:"0 20px" }}>
            <div style={{ fontSize:56, marginBottom:16 }}>📩</div>
            {/* タイトルは応募完了しました！に統一・タイトルだけ文字ジャンプ（2026-07-19） */}
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}><NoticeJumpText text={applyAlready ? "この求人には応募済みです" : "応募完了しました！"} /></h2>
            <p className="f-sans" style={{ fontSize:16, color:"#717171", lineHeight:1.8, marginBottom:8 }}>
              {applyAlready ? (
                "農家が内容を確認し、承認するとお知らせします。"
              ) : (<>
                これはまだ採用ではありません。<br/>
                農家が内容を確認し、承認するとお知らせします。<br/>
                その後、打ち合わせ・面接を経て、契約となります。
              </>)}
            </p>
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginBottom:16 }}>
              chitose-bankは求人情報の提供と連絡の場を用意します。雇用の契約は当事者間で行われます。
            </p>
            <button onClick={()=>{ window.location.hash="/help/mails"; }} className="f-sans" style={{ background:"none", border:"none", fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor:"pointer", marginBottom:20 }}>どんなメールが来るか確認する →</button>
            <button onClick={()=>{ window.location.hash="/search"; }} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12 }}>ほかの仕事を探す</button>
          </div>
        ) : safeTab==="search" ? <JobSearchMapView onRegister={()=>setTab("login")} me={me} /> : null}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="profile"&&(me
          ? <ProfileHub me={me}
              onNewJob={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} setShowJobPost(true); window.location.hash="/work/new"; }}
              onResume={(n)=>{ setShowJobPost(true); window.location.hash="/work/edit/"+n; }}
              onAvatarChange={(a)=>setMeAvatar(prev=>({ ...prev, ...a }))} />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>プロフィールを見るにはログインしてください</p><button onClick={()=>setTab("login")} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="chats"&&(me
          ? <ChatList />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>チャットを見るにはログインしてください</p><button onClick={()=>setTab("login")} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="saved"&&(me
          ? <SavedJobsView me={me} />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>いいねを見るにはログインしてください</p><button onClick={()=>setTab("login")} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="calendar"&&(me
          ? <CalendarRouter me={me} defaultRole={empCtx ? "farmer" : "worker"} />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>今日の予定を見るにはログインしてください</p><button onClick={()=>setTab("login")} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="login"&&(me
          ? <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#222"}}>ログイン済みです</p></div>
          : <LoginScreen farmers={farmers} onLogin={f=>{
              setMe(f);setAuthV("login");loadNotifs(f.id);
              // 緊急連絡ディープリンクからの復帰（最優先・時間に敏感）
              try {
                const em = sessionStorage.getItem("cb_emergencyLink");
                if (em) { sessionStorage.removeItem("cb_emergencyLink"); window.location.hash = "/emergency/" + em; return; }
              } catch {}
              setTab("profile");
              const ret = peekApplyReturn();
              if (ret) { window.location.hash = "/work/job/" + ret; setTab("search"); }
            }}/>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="admin"&&isAdmin(me)&&consignRoom&&<ConsignmentRoom/>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="admin"&&isAdmin(me)&&!consignRoom&&<AdminTab
          destPending={destPend} destApproved={destOk}
          farmers={farmers} farmersPending={farmPend}
          onApprove={appDest} onReject={rejDest}
          onApproveFarmer={appFarmer} onRejectFarmer={rejFarmer}
          onJump={(t, dj) => {
            if (dj) {
              // LandingFlowジャンプは通常フローと同じレール(#/work/new/{step}+showJobPost)に乗せる。
              // 旧実装のsetTab("labor")+showDevJumpはlaborが部屋番号(TAB_URL_KEYS)に無いため、
              // リロード時にreadHashTabが迷子扱い→searchへ落ちていた（2026-07-14修正）
              localStorage.setItem('devJump', JSON.stringify(dj));
              setShowJobPost(true);
              window.location.hash = (dj.step >= 1 && dj.step <= 11) ? "/work/new/" + dj.step : "/work/new";
            } else { setTab(t); }
          }}
          onShowAccountForm={() => setNeedsAccountHolder(true)}/>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="boxes"&&isAdmin(me)&&<AdminBoxRegistryPage/>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="charter"&&(
          <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>運営憲章</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／改定：2026年7月24日</p>

            <nav style={{ display:"grid", gap:10, marginBottom:36 }}>
              {[
                { id:"charter-ch1", l:"一、この場について" },
                { id:"charter-ch2", l:"二、三つの原則" },
                { id:"charter-ch3", l:"三、我々の仕事" },
                { id:"charter-ch4", l:"四、双方に寄り添うこと" },
                { id:"charter-ch5", l:"五、これからの仕組みについて" },
                { id:"charter-def", l:"定義" },
              ].map(t => (
                <button key={t.id} onClick={()=>{ document.getElementById(t.id)?.scrollIntoView({ behavior:"smooth", block:"start" }); }} className="f-sans" style={{ fontSize:17, fontWeight:600, color:"#00A86B", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, boxShadow:"0 2px 8px rgba(0,0,0,0.05)", cursor:"pointer", padding:"14px 18px", textAlign:"left", width:"100%" }}>{t.l}</button>
              ))}
            </nav>

            <div style={{ display:"grid", gap:28 }}>

              <section id="charter-ch1" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>一、この場について</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>我々は、農家と働き手が出会い、働き、つながる場を運営する。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>はじめての人が経験を積み、頼れる担い手へ育っていける場であることを大切にする。</p>
              </section>

              <section id="charter-ch2" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>二、三つの原則</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>1. 我々は、当事者どうしの連絡を制限しない。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>2. 我々は、雇用の成立に対する成功報酬を、現在も将来も受け取らない。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>3. 我々は、採用の判断に関与しない。誰を選ぶかは、農家と働き手が決める。</p>
              </section>

              <section id="charter-ch3" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>三、我々の仕事</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>我々は、場を整え、約束の記録を守り、法令に反する掲載を防ぐ。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>実績は、この場での働きの記録からだけ作られる。我々はそれを改変せず、飾らない。</p>
              </section>

              <section id="charter-ch4" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>四、双方に寄り添うこと</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>我々は、農家と働き手のどちらか一方の味方ではなく、双方に寄り添う立場で運営する。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>困りごとの窓口を常に開き、寄せられた声には必ず返事をする。</p>
              </section>

              <section id="charter-ch5" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>五、これからの仕組みについて</h2>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>農作業の委託・受託など、新しい仕組みをこの場に加えるときは、その約束をこの憲章に書き足してから始める。黙って変えることはしない。</p>
              </section>

              <section id="charter-def" style={{ scrollMarginTop:88, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", padding:"24px 26px" }}>
                <h2 className="f-sans" style={{ fontSize:19, fontWeight:700, color:"#222", marginBottom:14 }}>定義</h2>
                <p className="f-sans" style={{ fontSize:15, color:"#555", lineHeight:2, margin:0 }}>※　働き手とは、農作業に携わるために本サービスを利用する者をいう。</p>
                <p className="f-sans" style={{ fontSize:15, color:"#555", lineHeight:2, margin:0 }}>※　農家とは、農作業の求人を掲載する者をいう。</p>
              </section>

            </div>
          </div>
        )}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="help"&&<HelpCenter me={me} onReportClick={() => setShowFeedback(true)} />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="install"&&<InstallGuide me={me} />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="visit"&&<VisitEntrance me={me} />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="insurance"&&me&&<InsurancePrepPage me={me} />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="qr"&&isAdmin(me)&&<VisitorQRPage />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="privacy"&&(
          <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>プライバシーポリシー</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／全面改定：2026年7月21日</p>

            <nav style={{ display:"grid", gap:10, marginBottom:36 }}>
              {PRIVACY_SECTIONS.map(s => (
                <button key={s.id}
                  onClick={()=>{ document.getElementById(s.id)?.scrollIntoView({ behavior:"smooth", block:"start" }); }}
                  className="f-sans"
                  style={{ fontSize:17, fontWeight:600, color:"#00A86B", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, boxShadow:"0 2px 8px rgba(0,0,0,0.05)", cursor:"pointer", padding:"14px 18px", textAlign:"left", width:"100%" }}>
                  {s.title}
                </button>
              ))}
            </nav>

            <div style={{ display:"grid", gap:20 }}>
              {PRIVACY_SECTIONS.map((s, i) => (
                <div key={i} id={s.id} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB", scrollMarginTop:88 }}>
                  <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>{s.title}</h3>
                  {s.body.map((p, j) => (
                    <p key={j} className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin: j < s.body.length-1 ? "0 0 8px" : 0, textAlign:"left" }}>{renderRichText(p)}</p>
                  ))}
                  {s.table && <div style={{ marginTop:12 }}><PrivacyDataTable table={s.table} /></div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!showApplyDone&&safeTab==="terms"&&(
          <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>利用規約</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／全面改定：2026年7月21日</p>

            <nav style={{ display:"grid", gap:10, marginBottom:36 }}>
              {TERMS_ARTICLES.map(a => (
                <button key={a.id}
                  onClick={()=>{ document.getElementById(a.id)?.scrollIntoView({ behavior:"smooth", block:"start" }); }}
                  className="f-sans"
                  style={{ fontSize:17, fontWeight:600, color:"#00A86B", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, boxShadow:"0 2px 8px rgba(0,0,0,0.05)", cursor:"pointer", padding:"14px 18px", textAlign:"left", width:"100%" }}>
                  {a.title}
                </button>
              ))}
            </nav>

            <div style={{ display:"grid", gap:20 }}>
              {TERMS_ARTICLES.map((a, i) => (
                <div key={i} id={a.id} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB", scrollMarginTop:88 }}>
                  <h3 className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10, marginTop:0 }}>{a.title}</h3>
                  {a.body.map((p, j) => (
                    <p key={j} className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin: j < a.body.length-1 ? "0 0 8px" : 0, textAlign:"left" }}>{renderRichText(p)}</p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── FOOTER（Airbnb型3列）：新規登録（本人情報の入力）表示中は非表示（2026-07-19） ── */}
      {!(needsAccountHolder || openAccountForm) && <footer className="site-footer-fixed">
        <div className="footer-columns">
          <div>
            <p className="f-sans footer-col-title">サポート</p>
            <button onClick={()=>{ window.location.hash="/help"; }} className="f-sans footer-col-link">使い方ガイド</button>
            <button onClick={()=>{ window.location.hash="/help/faq"; }} className="f-sans footer-col-link">よくある質問</button>
            <button onClick={()=>{ window.location.hash="/help/faq"; }} className="f-sans footer-col-link">通報のしかた</button>
            <button onClick={()=>{ window.location.hash="/help/faq"; }} className="f-sans footer-col-link">異議申立</button>
            <a href="mailto:t5fki6643qty@gmail.com" className="f-sans footer-col-link">お問い合わせ</a>
          </div>
          <div>
            <p className="f-sans footer-col-title">雇う・働く</p>
            <button onClick={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} setShowJobPost(true); window.location.hash="/work/new"; }} className="f-sans footer-col-link">求人を出す</button>
            <button onClick={()=>{ window.location.hash="/help/farmer"; }} className="f-sans footer-col-link">審査のしくみ</button>
            <button onClick={()=>{ window.location.hash="/help/farmer"; }} className="f-sans footer-col-link">満額保証型とは</button>
            <button onClick={()=>{ window.location.hash="/help/mails"; }} className="f-sans footer-col-link">保険の準備</button>
            <button onClick={()=>{ window.location.hash="/help/worker"; }} className="f-sans footer-col-link">評価のしくみ</button>
          </div>
          <div>
            <p className="f-sans footer-col-title">chitose-bank</p>
            <button onClick={()=>{ window.location.hash="/charter"; }} className="f-sans footer-col-link">運営憲章</button>
            <button onClick={()=>{ window.location.hash="/terms"; }} className="f-sans footer-col-link">利用規約</button>
            <button onClick={()=>{ window.location.hash="/privacy"; }} className="f-sans footer-col-link">プライバシー</button>
            <button onClick={()=>{ window.location.hash="/terms"; }} className="f-sans footer-col-link">届出について</button>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="f-sans footer-copy">
            © {THIS_YEAR} chitose-bank（屋号 千歳）・徳島県吉野川市
          </span>
          <p className="f-sans footer-note">
            chitose-bankは銀行ではありません。
          </p>
        </div>
      </footer>}

      {/* この画面を報告：☰やヘルプの章開閉と無関係な階層に常駐（2026-07-14アンマウントバグ修正） */}
      <FeedbackModal open={showFeedback} onClose={() => setShowFeedback(false)} />

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
          onComplete={()=>{ setShowJobPost(false); window.location.hash="/profile/employer"; }}
          onSkip={()=>{ setShowJobPost(false); window.location.hash="/profile/employer"; }}
          onLogin={()=>{ setShowJobPost(false); window.location.hash="/profile/employer"; }}
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
      {me&&!me.isWorker&&!me.viaAccountHolder&&showOnboarding&&(
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
