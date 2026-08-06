import { useState, useEffect, useCallback, useRef, lazy, Suspense, Component } from "react";
import { supabase } from "./lib/supabase";
import { isAdmin, ROLE_ORANGE, ROLE_GREEN, C, THIS_YEAR, farmIntroTopics, perkBadges, isUpcomingSoon } from "./lib/utils";
import { TodayPage } from "./components/TodayPage";
import { Avatar, NoticeJumpText, DevBadge, PhaseInfoSheet, Dots, QaChat } from "./components/ui";
import { SavedJobsView } from "./components/SavedJobsView";
import { WorkerTrustCard, FarmerTrustCard } from "./components/TrustCards";
// ルート分割（2026-07-25）：大物は到達時に読み込む（初期バンドル削減）。named export→lazyのdefault変換
// チャンク取りこぼしの自己修復（2026-07-26・チャットで画面が真っ暗になる不具合の根治）：
// 新デプロイでチャンク名（ハッシュ）が変わるため、古いページを握ったままの端末は旧チャンクを
// 404で取りに行き「Importing a module script failed」で失敗する。Suspenseのfallbackはnullso
// 何も描画されず画面が暗いまま固まる。失敗を捕まえて1度だけ再読込し、新しいビルドを取りに行く。
// ※関数宣言（巻き上げあり）にすること：下のconst定義より前に実行されるためconstだとTDZで落ちる
function lazyChunk(factory) {
  return lazy(() => factory()
    .then(m => { try { sessionStorage.removeItem("cb_chunkReload"); } catch {} return m; })
    .catch(err => {
      // 1セッション1回まで（無限リロード防止）。2回目以降は素直に失敗させる
      try {
        if (!sessionStorage.getItem("cb_chunkReload")) {
          sessionStorage.setItem("cb_chunkReload", "1");
          window.location.reload();
        }
      } catch {}
      throw err;
    }));
}
const ChatView = lazyChunk(() => import("./components/ChatView").then(m => ({ default: m.ChatView })));
// 仮応募の成功ページ（第15弾・2026-07-30）。応募した人だけが通る画面so遅延読み込み
const ApplyPending = lazyChunk(() => import("./components/ApplyPending").then(m => ({ default: m.ApplyPending })));
// 新着の応募ページ（#/new-applicants・2026-08-05）。応募が届いた雇い手だけが通る面so遅延読み込み
const NewApplicantsPage = lazyChunk(() => import("./components/NewApplicantsPage").then(m => ({ default: m.NewApplicantsPage })));
import { ChatList } from "./components/ChatList";
import { LoginScreen } from "./components/LoginScreen";
import { AccountHolderForm } from "./components/AccountHolderForm";
import { ProfileModal } from "./components/ProfileModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { JobSearchMapView } from "./components/JobSearchMapView";
import { MyReviewsOfWorker } from "./components/MyReviewsOfWorker";
import { WorkerWorkRecord } from "./components/WorkerWorkRecord";
const LandingFlow = lazyChunk(() => import("./components/LandingFlow").then(m => ({ default: m.LandingFlow })));
const AdminTab = lazyChunk(() => import("./components/admin/AdminTab").then(m => ({ default: m.AdminTab })));
const ConsignmentRoom = lazyChunk(() => import("./components/admin/ConsignmentRoom").then(m => ({ default: m.ConsignmentRoom })));
const AdminBoxRegistryPage = lazyChunk(() => import("./components/admin/AdminBoxRegistryPage").then(m => ({ default: m.AdminBoxRegistryPage })));
const AdminWorkingRoom = lazyChunk(() => import("./components/admin/AdminWorkingRoom").then(m => ({ default: m.AdminWorkingRoom })));
const AdminUpcomingRoom = lazyChunk(() => import("./components/admin/AdminUpcomingRoom").then(m => ({ default: m.AdminUpcomingRoom })));
const AdminEvaluationRoom = lazyChunk(() => import("./components/admin/AdminEvaluationRoom").then(m => ({ default: m.AdminEvaluationRoom })));
// プロフィールタブ（2026-07-27たきと指示「リロードを必要最低限に」）：農家ハブ・応募状況・
// プロフィール編集・カレンダーがぶら下がる大きな塊so、開いた時に初めて読む＝起動のJSを軽くする
const ProfileHub = lazyChunk(() => import("./components/ProfileHub").then(m => ({ default: m.ProfileHub })));
import { CSS } from "./appStyles";
import { InsurancePrepPage, VisitEntrance, VisitorQRPage } from "./components/VisitAndInsurance";
import { WorkerExperiencePage } from "./components/WorkerExperiencePage";

import { isIOS, syncAppBadge } from "./lib/push";
import { compressImage } from "./lib/image";
import { peekApplyReturn } from "./lib/applyReturn";
import { armLoginReturn, takeLoginReturn } from "./lib/loginReturn";
import { snapGet, snapSet, clearSnapshots } from "./lib/snapshot";
import { setCache, clearCache } from "./lib/viewCache";

import Terms, { TERMS_ARTICLES, renderRichText } from "./Terms.jsx";








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
  // ラベルは「ステータス」（2026-07-27たきと指示）：いいねページが自分の応募段階の確認面になったため。
  // ♡アイコンは変更しない＝いいね一覧であることは絵で伝わる
  { k:"saved",    icon:"♡",  label:"ステータス" },
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


// 画面が真っ暗になるのを止める最後の壁（2026-07-31・委託ページで再発）。
// lazyChunk の自己修復は「1セッション1回だけ再読込」so、デプロイの最中など2回続けて失敗すると
// 例外がそのまま上まで抜け、React がツリーごと外して何も描かれない＝真っ暗になる。
// ここで受け止めて、原因と次の一手（再読み込み）を必ず画面に出す。エラーは app_errors にも残す。
class AppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false, chunk: false }; }
  static getDerivedStateFromError(error) {
    const msg = String(error?.message || error || "");
    // 動的importの失敗＝古いチャンクを掴んだまま（デプロイ直後に起きる）。文言を分ける
    const chunk = /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg);
    return { failed: true, chunk };
  }
  componentDidCatch(error, info) {
    logAppError({ source: "error_boundary", component: "app", action: "render_error", error, metadata: { componentStack: String(info?.componentStack || "").slice(0, 1000) } });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="f-sans" style={{ maxWidth:420, margin:"64px auto", padding:"28px 24px", textAlign:"center", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16 }}>
        <p style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 8px" }}>{this.state.chunk ? "新しい版に更新されました" : "画面を表示できませんでした"}</p>
        <p style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:"0 0 18px" }}>
          {this.state.chunk
            ? "アプリが更新されたため、古い画面のままでは開けません。再読み込みすると最新の画面になります。"
            : "一時的な不具合の可能性があります。再読み込みしても直らない場合は、この画面を報告してください。"}
        </p>
        <button onClick={()=>{
          // 自己修復（2026-08-03）：描画エラーの原因が永続キャッシュ（viewCache）の壊れた・古い形の
          // データだった場合、リロードだけでは同じデータで落ち続ける。再読み込み時は表示キャッシュを
          // 全部捨ててから読み直す（キャッシュは表示専用so捨てても最新を取り直すだけ・実害なし）
          try { clearCache(); } catch {}
          try { sessionStorage.removeItem("cb_chunkReload"); } catch {}
          window.location.reload();
        }}
          style={{ padding:"12px 26px", fontSize:14, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>再読み込み</button>
      </div>
    );
  }
}

async function sGet(k){try{const r=await window.storage.get(k,true);return r?JSON.parse(r.value):null;}catch{return null;}}
async function sSet(k,v){try{await window.storage.set(k,JSON.stringify(v),true);}catch{}};




// ── CSS ────────────────────────────────────────────────────
























// 今日がdateStart〜dateEnd（dateEndなければdateStart単日）の範囲内か。日付のみで比較（時刻無視）












// 15秒カード（プレビュー最上部・農家側応募者カードで共通利用）。値が無い項目は非表示
// onEditItem（任意）: 本人プレビュー用。渡すと各項目がタップ可能になり、対応する編集ボックスのキーを返す。
// 農家側（応募者カード等）は渡さない＝従来どおり表示専用



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
            supabase.from("employer_profiles_public").select("auth_id,nickname,avatar_url,owner_comment,pr,intro_path,intro_joy,intro_crops,intro_atmosphere,intro_message,unique_point,always_do,break_style,interaction_style,commitment,has_transport,has_parking,has_commute_allowance,has_bonus,employer_pays_supplies,accessory_ok,parking_capacity,commute_allowance_detail,transport_area,supplies_cap,insurance_items,created_at").eq("auth_id", farmerId).maybeSingle(),
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
    <div onClick={()=>setSt(null)} className="cb-preview-overlay" style={{ position:"fixed", inset:0, zIndex:9700, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:"calc(48px + env(safe-area-inset-top, 0px)) 16px calc(48px + env(safe-area-inset-bottom, 0px))", animation:"fadeIn .2s ease" }}>
      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <button onClick={()=>setSt(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 16px" }}>{st.profile?.nickname ? `${st.profile.nickname}の農園紹介` : "農園紹介"}</p>
        {st.loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>
        ) : st.profile ? (
          <>
            {/* 待遇バッジはカードのタグ行へ合流（2026-07-27たきと指示：タグは1箇所） */}
            <FarmerTrustCard profile={st.profile} trust={st.trust} extraBadges={perkBadges(st.profile)} />
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

// ── 働き手プレビューからの通報（2026-08-06たきと指示「プレビューに報告するを2つ」）──
// 求人詳細の「⚑ この求人を報告する」と同じ語彙・同じ視覚文法。保存先は profile_reports（三本目の通報台帳）。
// 選択肢は事実の申告だけを並べる＝運営の主観（評価・おすすめ度）は混ぜない（2026-07-16あっせん回避）。
// ★2ページ（プロフィール／はたらいた記録）の末尾に同じボタンを1つずつ置く。中身は共通で、
//   どちらの面から出したかは source 列に自動で入る＝運営が「何についての報告か」を取り違えない
const PROFILE_REPORT_FIELDS = ["自己紹介", "質問への回答", "自己申告（経験・資格）", "写真・アイコン", "はたらいた記録", "その他"];
const PROFILE_REPORT_ISSUES = ["虚偽・誇大の疑い", "連絡先の直書き・外部誘導", "個人情報・肖像権", "差別的・不快な表現", "なりすましの疑い", "記録の食い違い", "その他"];

// ボタン本体。押すと親が持つモーダルを開くだけ（送信は親の1箇所に集約＝発火点を散らさない）
function ProfileReportButton({ onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="f-sans" style={{ display:"block", width:"100%", marginTop:20, padding:"10px 0", background:"none", border:"none", fontSize:12, color:"#B0B0B0", textDecoration:"underline", cursor:"pointer" }}>
      ⚑ この人を報告する
    </button>
  );
}

function WorkerPreviewSheet() {
  const [st, setSt] = useState(null); // {worker_id, loading, profile, trust, viewer_id}
  // 通報モーダル：{ source:"profile"|"work_record", field, issue, detail, sending, done }
  const [rep, setRep] = useState(null);
  // ボックスは2枚（0=プロフィール／1=はたらいた記録）。横スワイプで行き来する（2026-08-05たきと指示）
  const [page, setPage] = useState(0);
  useEffect(() => {
    const f = (e) => {
      const workerId = e.detail;
      if (!workerId) return;
      setPage(0); // 開くたびに1枚目から
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
            worker_id: workerId, loading: false, blocked, viewer_id: viewer?.id || null,
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

  // 通報の送信（発火点はここ1箇所。2枚のボタンはモーダルを開くだけ）
  const closeSheet = () => { setSt(null); setRep(null); };
  const submitReport = async () => {
    if (!rep || rep.sending || !rep.field || !rep.issue || !st?.worker_id || !st?.viewer_id) return;
    setRep(r => ({ ...r, sending: true }));
    const { error } = await supabase.from("profile_reports").insert({
      target_worker_id: st.worker_id,
      reporter_id: st.viewer_id,
      source: rep.source,
      target_field: rep.field,
      issue_type: rep.issue,
      detail: (rep.detail || "").trim() || null,
    });
    if (error) { setRep(r => ({ ...r, sending: false })); alert("報告の送信に失敗しました：" + error.message); return; }
    setRep(r => ({ ...r, sending: false, done: true }));
    setTimeout(() => setRep(null), 1800);
  };

  // ── 指追従ページャー（ボックス一覧・農家プロ作成中⇄公開中と同じ作法）──
  // 横に動かしたと分かってから（8px）transformを直接書く＝毎フレームの再描画なしで指に付いてくる。
  // 縦の指はページャーが奪わない（touchAction:pan-y）＝ボックスの縦スクロールは従来どおり。
  const trackRef = useRef(null);
  const dragRef = useRef(null); // {x, y, dx, lock:"h"|"v"|null, w}
  const basePct = () => (page === 0 ? 0 : -50);
  const onPagerStart = (e) => {
    dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: null, w: e.currentTarget.clientWidth || 1 };
  };
  const onPagerMove = (e) => {
    const s = dragRef.current, el = trackRef.current;
    if (!s || !el) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (s.lock !== "h") return;
    const atEdge = (page === 0 && dx > 0) || (page === 1 && dx < 0); // 端は1/3の抵抗
    s.dx = atEdge ? dx / 3 : dx;
    el.style.transition = "none";
    el.style.transform = `translateX(calc(${basePct()}% + ${s.dx}px))`;
  };
  const onPagerEnd = () => {
    const s = dragRef.current, el = trackRef.current;
    dragRef.current = null;
    if (!s || !el || s.lock !== "h") return;
    el.style.transition = "transform .3s ease";
    const threshold = Math.min(80, s.w / 4);
    if (page === 0 && s.dx < -threshold) { el.style.transform = "translateX(-50%)"; setPage(1); }
    else if (page === 1 && s.dx > threshold) { el.style.transform = "translateX(0%)"; setPage(0); }
    else { el.style.transform = `translateX(${basePct()}%)`; }
  };

  if (!st) return null;
  // 報告できるのはログイン済みの他人だけ（自分は報告しない＝DB側のCHECK制約と揃える）
  const canReport = !!(st.viewer_id && st.viewer_id !== st.worker_id);
  return (
    <div onClick={closeSheet} className="cb-preview-overlay" style={{ position:"fixed", inset:0, zIndex:9700, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:"calc(48px + env(safe-area-inset-top, 0px)) 16px calc(48px + env(safe-area-inset-bottom, 0px))", animation:"fadeIn .2s ease" }}>
      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <button onClick={closeSheet} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 12px" }}>働き手のプレビュー</p>
        {st.loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>
        ) : st.profile ? (
          <>
            {/* 2枚のどちらを見ているかの目印。タップでも切り替わる（スワイプがあることに気づけるように） */}
            <div style={{ display:"flex", gap:8, margin:"0 0 14px" }}>
              {[{ k:0, l:"プロフィール" }, { k:1, l:"はたらいた記録" }].map(t => (
                <button key={t.k} type="button" onClick={()=>setPage(t.k)} className="f-sans"
                  style={{ flex:1, padding:"9px 0", borderRadius:10, cursor:"pointer", background:"#fff",
                    border: page===t.k ? "2px solid #222" : "1px solid #EBEBEB",
                    fontSize:12, fontWeight: page===t.k ? 800 : 600, color: page===t.k ? "#222" : "#999" }}>
                  {t.l}
                </button>
              ))}
            </div>
            <div onTouchStart={onPagerStart} onTouchMove={onPagerMove} onTouchEnd={onPagerEnd} style={{ overflow:"hidden", touchAction:"pan-y" }}>
              <div ref={trackRef} style={{ display:"flex", alignItems:"flex-start", width:"200%", transform: page===0 ? "translateX(0%)" : "translateX(-50%)", transition:"transform .3s ease" }}>
                {/* 1枚目：プロフィール（従来の中身をそのまま） */}
                <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingRight:5 }}>
                  <WorkerTrustCard profile={st.profile} trust={st.trust} />
                  {/* Q&Aはチャットと同じコメント形式（2026-08-06たきと指示） */}
                  <QaChat items={st.profile.pr_qa} />
                  <MyReviewsOfWorker workerId={st.worker_id} />
                  {canReport && <ProfileReportButton onOpen={()=>setRep({ source:"profile", field:"", issue:"", detail:"", sending:false, done:false })} />}
                </div>
                {/* 2枚目：はたらいた記録（働き手ダッシュボードと同じ部品） */}
                <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingLeft:5 }}>
                  <WorkerWorkRecord workerId={st.worker_id} />
                  {canReport && <ProfileReportButton onOpen={()=>setRep({ source:"work_record", field:"", issue:"", detail:"", sending:false, done:false })} />}
                </div>
              </div>
            </div>
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

      {/* 通報モーダル：求人の通報（JobSearchMapView）と同じ視覚文法・語彙。2枚のボタンの共通の行き先 */}
      {rep && (
        <div onClick={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:9800, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%" }}>
            {rep.done ? (
              <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0", margin:0 }}>報告を受け付けました。運営が確認します</p>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:4 }}>この人を報告する</p>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 12px" }}>{rep.source === "work_record" ? "はたらいた記録の面から" : "プロフィールの面から"}</p>
                <div style={{ display:"grid", gap:8, marginBottom:8 }}>
                  <select value={rep.field} onChange={e=>setRep(r=>({ ...r, field:e.target.value }))} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" }}>
                    <option value="">対象項目を選択</option>
                    {PROFILE_REPORT_FIELDS.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={rep.issue} onChange={e=>setRep(r=>({ ...r, issue:e.target.value }))} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" }}>
                    <option value="">問題の種類を選択</option>
                    {PROFILE_REPORT_ISSUES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  <textarea value={rep.detail} onChange={e=>setRep(r=>({ ...r, detail:e.target.value }))} placeholder="詳細（任意）" rows={4} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:16, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }} />
                </div>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>報告は運営のみが確認します。相手にはあなたの情報は伝わりません</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setRep(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submitReport} disabled={rep.sending || !rep.field || !rep.issue} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background: (rep.field && rep.issue) ? "#E24B4A" : "#EBEBEB", color: (rep.field && rep.issue) ? "#fff" : "#717171", border:"none", borderRadius:10, cursor:"pointer" }}>{rep.sending ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}







// #/calendar の入口：「今日」ページ。
// 月カレンダー単独のページ(#/calendar/month)は廃止（2026-07-27たきと指示）＝カレンダーは
// 農家＝応募者ページ／働き手＝ステータスページ の上部に移植した。旧URLで来た人は「今日」に着地する
function CalendarRouter({ me, defaultRole }) {
  // 旧URL(#/calendar/month)で来たら#/calendarに正す＝アドレスバーと中身を食い違わせない
  useEffect(() => {
    if (window.location.hash.replace(/^#\/?/, "") === "calendar/month") window.location.hash = "/calendar";
  }, []);
  return <TodayPage me={me} defaultRole={defaultRole} />;
}
























// ── PrivacyPolicy ────────────────────────────────────────────
// sections本体はモーダル(PrivacyPolicy)とページ(#/privacy)で共通利用するためモジュールレベル定数化
const PRIVACY_SECTIONS = [
    { id:"privacy-1", title:"第1条 基本の約束", body:[
      "1. 本サービスが取得する情報・その保存と保護・誰に表示されるかは、第3条の一覧表にすべて記載します。**表に無い取得・表に無い開示は行いません。**",
      "2. 第3条に定める利用者間の表示、第5条に定める委託、および法令に基づく場合を除き、個人情報を第三者へ販売または提供しません。個人情報を広告の目的で利用しません。",
      "3. 入力の途中の内容、およびキー操作を記録することはありません。",
    ]},
    { id:"privacy-2", title:"第2条 開示される相手は4種類だけ", body:[
      "本サービスの中で、あなたの情報を見る可能性があるのは次の4者に限られます。",
      "**A：他の利用者**——第3条の表で「開示先」に明示された範囲だけが表示されます。",
      "**B：運営者**——サービスの提供・確認・苦情対応のために、表の範囲で扱います。",
      "**C：公的機関**——法令に基づく適法な照会（裁判所・警察・労働局・個人情報保護委員会など）があった場合に限ります。",
      "**D：業務委託先**——第5条に記載するシステム運用の事業者が、契約で必要な範囲に限り、データの保管・配信・送信などを行います。",
    ]},
    { id:"privacy-3", title:"第3条 個人情報の取り扱い一覧・データ台帳", body:[
      "本サービスが取得する個人情報の全項目を、次の表にまとめます。",
    ], table:{
      headers:["情報","取得する時","利用目的","保存の場所と保護","誰にどう表示されるか","保存期間"],
      rows:[
        ["メールアドレス","アカウント登録時","本人認証とログイン。重要なお知らせ・応募・苦情対応のご連絡。","認証データベース（東京リージョン）。技術的な行制限により本人と運営者以外は読めません","他の利用者には**一切表示されません**。運営者の管理画面でも通常は伏せ字（例：t5***@…）で表示されます","アカウントの存続中。退会の申し出から30日以内に削除します。"],
        ["本人確認情報（氏名・ふりがな・住所・生年月日・電話番号）","登録直後の本人確認の入力時","なりすましの防止と本人確認。不正利用の防止。雇用契約が成立した相手方への氏名の表示。","専用テーブル。本人と運営者以外は読めません。変更があった事実は記録されますが、記録メールに値そのものは含めません","他の利用者には値は表示されず、**「本人確認済み」の表示と確認の年月だけ**が出ます。雇用契約が成立した相手方には、雇用の法定手続きのため氏名が表示されます","アカウントの存続中。退会の申し出から30日以内に削除します。"],
        ["プロフィールの選択項目（活動地域・移動手段・経験・作業の強さ・趣味・言語など）","本人が入力・選択した時","求人と求職の条件の照合のための表示。応募と承認の判断の材料。","プロフィールテーブル","求人に応募した先の求人者、および求人を閲覧する求職者に**即時**表示されます","アカウントの存続中。本人はいつでも変更と削除ができます。退会の申し出から30日以内に削除します。"],
        ["自己紹介・質問への回答（自由記述）","本人が入力した時","応募先へ人柄と経験を伝えるための表示。掲載前の内容の確認。","まず**非公開の確認待ち**として保存","**運営者が内容を確認してから**（最大2日・確認され次第）応募先などに表示されます。確認するのは連絡先の記載・個人の特定・不適切な表現の有無だけです","アカウントの存続中。本人はいつでも変更と削除ができます。退会の申し出から30日以内に削除します。"],
        ["プロフィール写真・農園の紹介","本人が登録した時","働く場所と相手の様子を事前に伝えるための表示。","画像ストレージ＋プロフィールテーブル","応募先・求人の閲覧者に表示されます","アカウントの存続中。退会の申し出から30日以内に削除します。"],
        ["集合場所の詳細（番地・目印）","求人者が求人を作成した時","作業当日の集合場所のご案内。承認された求職者への場所の共有。","求人テーブル。公開用の表示からは**除外**されています","**応募が承認された求職者にだけ**表示します。契約が成立した場合は、労働条件の確認記録の一部として保存されます。","求人の掲載が終わるまで。"],
        ["チャットの内容","送信した時","当事者間の連絡。苦情・通報・紛争への対応。","メッセージテーブル。技術的な行制限により**当事者以外は読めません**","当事者だけが読めます。運営者が内容を確認するのは、**苦情・通報・紛争への対応に必要な場合に限ります**","応募の終了から3年間保存し、削除します。"],
        ["応募・承認・作業の記録（応募日時・承認日時・開始と終了の確認・出欠・欠勤への異議）","それぞれの操作の時","応募状況の管理。実績の表示。紛争への対応。不正利用の防止。","応募テーブル","当事者の双方に表示されます。集計した実績（完了件数など）は将来、プロフィールに表示されます。また、あなたから応募を受けた農家には、記録から導出した事実（働いた回数・時間、直近の遅刻・欠勤、作物別・作業別の件数）が「はたらいた記録」として表示されます","アカウントの存続中。退会後は、個人を特定できない形にして保存します。"],
        ["労働条件の確認記録。双方が確認した時点の求人内容の写しです。写しには、募集主の氏名・住所・連絡先と、集合場所の詳しい住所が含まれます。","双方が「相違ありません」を押した時","労働条件の相互確認。契約内容の証跡の保存。紛争への対応。","応募テーブルに改変されない形で保存","契約の相手方に、契約の記録として表示されます。当事者の求めと紛争対応の際に使用します。運営者は印刷可能な形で保管します。","作業の完了から3年間保存し、削除します。"],
        ["評価（選択項目・公開コメント・非公開メモ）","作業完了後に本人が入力した時","利用者への表示。安全の確保。運営上の判断。","評価テーブル","**公開されるのは肯定的な評価と公開コメントだけ**です。非公開メモは書いた本人しか見られません。双方の評価が揃うか3日たつまで相手には表示されません。全量は運営者がサービス改善と安全のために保存します","アカウントの存続中。退会後は、書いた人の情報を個人を特定できない形にして保存します。"],
        ["ページの閲覧履歴（どのページをいつ表示したか）","ページを表示した時","利用状況の分析と改善。不具合の調査。","閲覧記録テーブル。**運営者だけ**が見られます","他の利用者には一切表示されません。使い道はサービスの改善（どの画面が分かりにくいかの分析）だけです","取得から30日で削除します。"],
        ["通報・画面の報告・緊急連絡","本人が送信した時","緊急時の相手方へのご連絡。事実確認。利用者の保護。規約違反への対応。","各記録テーブル","通報は運営者だけが確認し、**通報した人が誰かは相手に伝わりません**。緊急連絡は相手方と運営者に通知されます","対応の完了から3年間保存し、削除します。"],
      ],
    }},
    { id:"privacy-4", title:"第4条 第三者への提供", body:[
      "1. 第2条のA・B・C・D以外に個人情報を提供しません。",
      "2. 個人情報を外国にある第三者に提供することはありません。",
    ]},
    { id:"privacy-5", title:"第5条 業務の委託先", body:[
      "システムの運用のため、次の事業者のサービスを利用しています。いずれも上記のデータの保管・配信・送信という役割の範囲でのみ関与し、目的外の利用はできません。",
      "・データベースと認証：Supabase（データ保存地域：東京）",
      "・サイトの配信：Vercel",
      "・メールの送信：Brevo",
      "・プッシュ通知の配信：お使いのブラウザの提供元の通知配信サービス。通知の本文は暗号化して送ります。",
      "・バックアップの保管：GitHub。バックアップは暗号化して保管します。",
    ]},
    { id:"privacy-6", title:"第6条 安全のためにしていること", body:[
      "1. **行レベルの権限制御**：個人情報を含むデータは、本人・当事者・運営者という権限の範囲で読み書きできるよう、データベースの層で技術的に制限しています。画面側に不具合があった場合にも、権限の範囲を超える読み書きを防ぐための措置です。",
      "2. **変更の記録**：個人情報を含む主要なデータの追加・変更・削除は、誰がいつ何を変えたかを記録し、運営者に通知します。不正な操作を発見するための措置を行っています。",
      "3. **運営アカウントの保護**：運営者のアカウントには2段階認証を設定しています。",
      "4. **バックアップ**：データは定期的にバックアップします。",
      "5. **事故対応**：万一、情報の漏えい・滅失が起きた場合の対応手順（被害の封鎖・個人情報保護委員会への報告・ご本人への通知）をあらかじめ定めています。",
    ]},
    { id:"privacy-7", title:"第7条 保存期間の終わりと退会", body:[
      "1. 退会のお申し出から30日以内に、本人確認情報とプロフィールを削除します。",
      "2. 労働条件の確認記録・応募と作業の記録・評価は、紛争への対応と法令上の必要のため、第3条の表に定める期間、保存します。",
      "3. 削除のご希望・お問い合わせは、第9条の窓口までお申し出ください。",
    ]},
    { id:"privacy-8", title:"第8条 ご本人の権利と請求の手続", body:[
      "1. ご本人は、自己の個人情報について、次の請求ができます。",
      "一　利用目的の通知。",
      "二　保有個人データおよび第三者提供記録の開示。",
      "三　内容の訂正・追加・削除。",
      "四　利用停止・消去。",
      "五　第三者への提供の停止。",
      "2. 請求は、第9条の窓口のメールアドレスで受け付けます。",
      "3. ご本人であることは、登録されたメールアドレスその他の登録情報により確認します。",
      "4. 回答は、原則として電磁的方法で行います。",
      "5. 手数料は無料です。",
      "6. 代理人による請求は、委任状などによりご本人の意思と代理権を確認したうえで対応します。",
    ]},
    { id:"privacy-9", title:"第9条 お問い合わせ窓口", body:[
      "運営者：福井滝人（屋号：千歳）／サービス名称：chitose-bank",
      "窓口：t5fki6643qty@gmail.com",
      "所在地は、ご本人の求めに応じて遅滞なく回答します。",
      "第8条の請求は、この窓口で受け付けます。手続は第8条の定めによります。",
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
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginBottom:24 }}>千歳（chitose-bank） · 制定：2026年7月5日／全面改定：2026年7月21日／改定：2026年8月●日</p>
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
    { num:10, title:"本人の権利保障と最小保存",  body:"本人からのデータ訂正、削除、利用停止の請求に応じる導線を常に用意する。退会後は、原則30日以内に個人に紐づくデータを削除、または個人との紐づけを解除した統計データとして処理する。ただし、法令対応、不正防止、請求・同意履歴、運用上必要な最小限の記録は、目的と期間を限定して保存する。" },
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
      { key:"farmer-fullPay",         label: "満額支払型とは", body: "満額支払型（デフォルト）では、予定より早く作業が終わっても、予定していた時間分の報酬が満額支払われます。" },
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
      // 募集主の法定表示（2026-07-30・第14弾）：なぜ書くのかを一言で答える
      { key:"faq-whyRecruiterInfo", label: "なぜ住所や連絡先を書くのですか", body: "求人広告には、募集主の氏名（名称）・住所・連絡先の表示が法律で義務づけられているためです（職業安定法）。業務内容・就業場所・賃金と合わせた6項目が、求人ページに必ず表示されます。ニックネームとは別に、正式な情報をプロフィールの「募集者の情報」にご記入ください。" },
      { key:"faq-payWho",          label: "報酬はいつ誰からもらえますか", body: "報酬は農家から直接受け取ります。運営は報酬のやり取りに関与しません。" },
      { key:"faq-earlyFinish",     label: "早く終わったら給与は減りますか", body: "満額支払型（デフォルト）の求人では、予定より早く作業が終わっても、予定していた時間分の報酬が満額支払われます。" },
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
      // スクショは原寸1〜3MB級so長辺1280px・品質0.75に圧縮してから上げる（表示幅760pxの約1.7倍=Retina十分・2026-07-26）
      const upFile = await compressImage(file, 1280, 0.75);
      const ext = (upFile.name.split(".").pop() || "jpg").toLowerCase();
      const path = slotKey + "." + ext;
      const { error: upErr } = await supabase.storage.from("help-images").upload(path, upFile, { upsert: true });
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
      {/* 画像が無いときは何も出さない（2026-07-27たきと指示）：「準備中」の空枠は訪問者には不要 */}
      {images[slotKey] && <img src={images[slotKey]} alt={label+"の手順"} loading="lazy" decoding="async" style={{ width:"100%", borderRadius:12, display:"block" }} />}
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
        {/* 🥦は削除（2026-07-27たきと指示） */}
        <h1 className="f-sans" style={{ fontSize:24, fontWeight:800, color:"#222", margin:"0 0 6px" }}>chitose-bankをアプリとして入れる</h1>
        <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.7, margin:0 }}>ホーム画面に追加すると、アプリのように開けて通知も受け取れます。</p>
        {/* 訪問者の「入れ方」タブから来る人向けに、何をするのかを最初に明記する（2026-07-27たきと指示） */}
        <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, margin:"12px auto 0", maxWidth:420, background:"#F7F7F7", borderRadius:12, padding:"12px 14px", textAlign:"left" }}>
          App Store・Google Playからのインストールは不要です。いま見ているこのページを、お使いのブラウザから
          ホーム画面に置くだけで完了します。下の手順のとおりに進めてください（1分ほどで終わります）。
        </p>
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
      // スクショは原寸1〜3MB級so長辺1280px・品質0.75に圧縮してから上げる（表示幅760pxの約1.7倍=Retina十分・2026-07-26）
      const upFile = await compressImage(file, 1280, 0.75);
      const ext = (upFile.name.split(".").pop() || "jpg").toLowerCase();
      const path = slotKey + "." + ext;
      const { error: upErr } = await supabase.storage.from("help-images").upload(path, upFile, { upsert: true });
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
  // 既存スクショの一括軽量化（管理者のみ・2026-07-26）：圧縮なしで上がった原寸PNG級を、ブラウザで
  // 取得→compressImage(1280px/0.75)→差し替え。png→jpgで拡張子が変わったら旧ファイルを削除しURLも更新。
  // 既に軽い画像（compressImageが原本を返す）はスキップ＝何度押しても安全
  const [recompressing, setRecompressing] = useState("");
  const recompressAll = async () => {
    if (recompressing) return;
    const entries = Object.entries(images);
    if (!entries.length) { alert("画像がありません。"); return; }
    if (!confirm(`ガイドのスクショ${entries.length}枚を軽量化して差し替えます。よろしいですか？`)) return;
    let done = 0, replaced = 0, savedBytes = 0;
    for (const [slotKey, url] of entries) {
      done++; setRecompressing(`${done}/${entries.length}`);
      try {
        const res = await fetch(url.split("?")[0] + "?t=" + Date.now(), { cache: "reload" });
        if (!res.ok) continue;
        const blob = await res.blob();
        const file = new File([blob], helpImagePathFromUrl(url) || slotKey + ".jpg", { type: blob.type });
        const upFile = await compressImage(file, 1280, 0.75);
        if (upFile === file) continue; // 既に軽い
        const ext = (upFile.name.split(".").pop() || "jpg").toLowerCase();
        const path = slotKey + "." + ext;
        const { error: upErr } = await supabase.storage.from("help-images").upload(path, upFile, { upsert: true });
        if (upErr) continue;
        const oldPath = helpImagePathFromUrl(url);
        if (oldPath && oldPath !== path) { try { await supabase.storage.from("help-images").remove([oldPath]); } catch { /* 旧ファイル残置は表示に影響なし */ } }
        const { data: urlData } = supabase.storage.from("help-images").getPublicUrl(path);
        const newUrl = (urlData?.publicUrl || "") + "?t=" + Date.now();
        const { error: dbErr } = await supabase.from("help_images").upsert({ slot_key: slotKey, url: newUrl, updated_at: new Date().toISOString() });
        if (dbErr) continue;
        setImages(prev => ({ ...prev, [slotKey]: newUrl }));
        replaced++; savedBytes += Math.max(0, blob.size - upFile.size);
      } catch { /* この1枚は飛ばして続行 */ }
    }
    setRecompressing("");
    alert(`軽量化が完了しました：${entries.length}枚中 ${replaced}枚を差し替え（約${Math.round(savedBytes / 1024 / 1024 * 10) / 10}MB削減）`);
  };
  return (
    <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（モバイル・CSS側の負マージン併用） */}
      <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>使い方ガイド</h1>
      <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom: isAdmin(me) ? 12 : 36 }}>chitose-bankの使い方をまとめています</p>
      {isAdmin(me) && (
        <button onClick={recompressAll} disabled={!!recompressing} className="f-sans" style={{ marginBottom:24, padding:"8px 14px", fontSize:12, fontWeight:700, color:"#717171", background:"#F7F7F7", border:"1px dashed #D0D0D0", borderRadius:10, cursor: recompressing ? "default" : "pointer" }}>
          {recompressing ? `🗜 軽量化中 ${recompressing}…` : "🗜 スクショを一括軽量化（管理）"}
        </button>
      )}
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
                        {imgUrl && (
                          /* 画像は2倍表示（2026-07-27たきと指示）：横幅いっぱいだと文字が小さくて読めないため、
                             縦横とも2倍に拡大する＝高さが2倍になる。比率は変えない（引き伸ばすと文字がぼやける）。
                             はみ出した横方向はこの枠の中だけを指でなぞって送れる（ページは横スクロールしない） */
                          <div style={{ marginTop:12, overflowX:"auto", WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain", borderRadius:12 }}>
                            <img src={imgUrl} alt="" loading="lazy" decoding="async" style={{ display:"block", width:"200%", maxWidth:"none", borderRadius:12, border:"3px solid #E0E0E0", boxShadow:"0 4px 16px rgba(0,0,0,0.12)", boxSizing:"border-box" }} />
                          </div>
                        )}
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
  const TAB_URL_KEYS = ["admin","boxes","search","work","profile","login","charter","privacy","terms","chats","saved","calendar","help","install","visit","qr","insurance","experience","new-applicants"];
  const readHashTab = () => { const h = window.location.hash.replace(/^#\/?/, ""); if (h.startsWith("chat/")) return "work"; if (h === "apply/done" || h.startsWith("apply/")) return "search"; if (h.startsWith("work/job/")) return "search"; if (h === "work" || h.startsWith("work/")) return "work"; if (h === "profile" || h.startsWith("profile/")) return "profile"; if (h === "admin/review" || h.startsWith("admin/review/")) return "admin"; if (h === "admin/consignment" || h.startsWith("admin/consignment/")) return "admin"; if (h === "admin/working" || h.startsWith("admin/working/")) return "admin"; if (h === "admin/upcoming" || h.startsWith("admin/upcoming/")) return "admin"; if (h === "admin/evaluation" || h.startsWith("admin/evaluation/")) return "admin"; if (h === "boxes" || h.startsWith("boxes/")) return "boxes"; if (h === "help" || h.startsWith("help/")) return "help"; if (h === "calendar" || h.startsWith("calendar/")) return "calendar"; return TAB_URL_KEYS.includes(h) ? h : null; };
  const initialHashTab = readHashTab(); // 起動した瞬間にURLでタブ指定があったか（同期useEffectが書き込む前の記録）
  const [tab,setTab]=useState(initialHashTab ?? "search");
  // 利用規約・プライバシーポリシーを開いたら必ず先頭から（2026-07-30たきと指示）。
  // どちらもフッター等ページの下の方から開くため、スクロール位置が残ると本文の途中に着地する。
  // 章リンク（#見出しへのscrollIntoView）は別動作so、ここではページを開いた瞬間だけ先頭に戻す
  useEffect(() => {
    if (tab !== "terms" && tab !== "privacy") return;
    try { window.scrollTo({ top: 0, behavior: "auto" }); } catch { window.scrollTo(0, 0); }
  }, [tab]);
  // tab → URL：タブが変わったらアドレスバーの#を書き換える
  useEffect(() => {
    const target = "#/" + tab;
    const _curHash = window.location.hash.replace(/^#\/?/, "");
    // フロー系(求人作成・編集・詳細・チャット・緊急連絡リンク)は正当にhashを保持
    // 応募の成功ページ（apply/done・apply/pending）も保持する（2026-07-30）。プロフィール保存からの
    // 昇格でtabがprofile→searchに変わるため、保持しないと着地の瞬間に#/searchへ巻き戻る
    const _inFlow = _curHash === "work/new" || _curHash.startsWith("work/new/") || _curHash.startsWith("work/edit/") || _curHash.startsWith("work/job/") || _curHash.startsWith("chat/") || _curHash.startsWith("emergency/") || _curHash.startsWith("apply/");
    // workタブ内サブタブ(drafts/active/applicants/expired)は、向かうタブもworkの時だけ保持
    const _subTabOfWork = (tab === "work") && (_curHash === "work/drafts" || _curHash === "work/active" || _curHash === "work/applicants" || _curHash === "work/expired");
    const _subTabOfProfile = (tab === "profile") && (_curHash === "profile/worker" || _curHash === "profile/worker/profile" || _curHash === "profile/worker/applying" || _curHash === "profile/worker/approved" || _curHash === "profile/worker/calendar" || _curHash === "profile/employer" || _curHash === "profile/employer/profile" || _curHash === "profile/employer/drafts" || _curHash === "profile/employer/active" || _curHash === "profile/employer/applicants" || _curHash === "profile/employer/expired" || _curHash === "profile/employer/calendar");
    // 審査ページの深いリンク(#/admin/review/{セクション} と #/admin/review/{job_number})を、tab同期で#/adminに巻き戻さないよう保持
    const _subTabOfAdmin = (tab === "admin") && (_curHash.startsWith("admin/review/") || _curHash === "admin/consignment" || _curHash.startsWith("admin/consignment/") || _curHash === "admin/working" || _curHash.startsWith("admin/working/") || _curHash === "admin/upcoming" || _curHash.startsWith("admin/upcoming/") || _curHash === "admin/evaluation" || _curHash.startsWith("admin/evaluation/"));
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
  const [farmers,setFarmers]=useState([]);
  const [farmPend,setFarmPend]=useState([]);
  const [destOk,setDestOk]=useState([]);
  const [destPend,setDestPend]=useState([]);
  const [recs,setRecs]=useState({});
  // スナップショット起動（2026-07-25本命）：前回のmeがあればネットワーク0本で即・ログイン済み骨格を描く。
  // セッション復元は従来どおり裏で走り、本物のme/停止判定/ログアウト検知で後から上書きされる
  const [loaded,setLoaded]=useState(() => !!snapGet("me"));
  const [badgeCnt,setBadgeCnt]=useState(0);
  const [me,setMe]=useState(() => snapGet("me"));
  const [blockedAccount,setBlockedAccount]=useState(false); // 停止／追放されたアカウントの制限画面（2026-07-19）
  useEffect(() => { if (me?.id) snapSet("me", me); }, [me]);
  // ヘッダー（PC・モバイル下部バー）共通のアバター表示規則（2026-07-14改）：
  // 働き手=worker_profiles／雇い手空間(#/profile/employer*)の表示中=employer_profiles でアイコンを分ける。
  // 取得はme.id変化と雇い手空間の出入り(empCtx)ごと。編集画面での変更はonAvatarChangeで即時反映（マージ更新）。
  const [meAvatar,setMeAvatar]=useState({ url:"", name:"", empUrl:"", empName:"" });
  const isEmpCtxHash = () => window.location.hash.replace(/^#\/?/, "").startsWith("profile/employer");
  // 現在のURL（ハッシュ）を状態として持つ（2026-07-27・下部ナビの点灯が付いてこないバグの根治）。
  // 描画中に window.location.hash を直接読むと、同じタブ内でのページ移動（例 応募者→求人）は
  // 他のstateが変わらない＝再描画が起きないため、点灯が前のページのまま固まる。
  // hashchangeでこの値を更新すれば、URLが変わるたびに必ず描き直される
  const [curHash, setCurHash] = useState(() => { try { return window.location.hash.replace(/^#\/?/, ""); } catch { return ""; } });
  useEffect(() => {
    const on = () => setCurHash(window.location.hash.replace(/^#\/?/, ""));
    window.addEventListener("hashchange", on);
    on();
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const [empCtx, setEmpCtx] = useState(() => { try { const s = localStorage.getItem("cb_empCtx"); return s !== null ? s === "1" : isEmpCtxHash(); } catch { return false; } });
  // 「🤝応募者」バッジは navBadges.applicants_pending（未対応の応募＝跳ねるアイコンと同数）に一本化（2026-07-26）。
  // 旧・独自の status='applied' 件数カウントは廃止＝バッジとアイコンで数が食い違う原因だった

  // 下部ナビの宿題バッジ（第12弾・2026-07-23）：チャット未読スレッド／きょうの契約済み仕事／評価締切内未実施／差し戻し有無。
  // 1本のRPC(my_nav_badges)で取得。再計算＝起動・ページ遷移・既読等(cb:unreadRefresh)・モード切替。
  const [navBadges, setNavBadges] = useState({ chat_threads:0, calendar_today:0, todo:0, applicants_pending:0, review_due:0, job_revision:0 });
  useEffect(() => {
    if (!me?.id) { setNavBadges({ chat_threads:0, calendar_today:0, todo:0, applicants_pending:0, review_due:0, job_revision:0 }); return; }
    const refresh = async () => {
      try {
        const { data } = await supabase.rpc("my_nav_badges");
        if (data) setNavBadges({ chat_threads:data.chat_threads||0, calendar_today:data.calendar_today||0, todo:data.todo||0, applicants_pending:data.applicants_pending||0, review_due:data.review_due||0, job_revision:data.job_revision||0 });
      } catch {}
    };
    // ページ遷移のたびに全体のバッジRPCを撃たない（2026-07-27たきと指示「該当ページだけリロード」）：
    // 同一ページ内の移動（求人詳細・サブページ）でも毎回走り、遷移の体感を重くしていた。
    // 20秒のスロットルを噛ませる。即時性はRealtime購読と既読イベント(cb:unreadRefresh・throttle対象外)が担保する
    let lastAt = 0;
    const refreshOnNav = () => { const now = Date.now(); if (now - lastAt < 20000) return; lastAt = now; refresh(); };
    const refreshNow = () => { lastAt = Date.now(); refresh(); };
    refreshNow();
    window.addEventListener("hashchange", refreshOnNav);
    window.addEventListener("cb:unreadRefresh", refreshNow);
    return () => { window.removeEventListener("hashchange", refreshOnNav); window.removeEventListener("cb:unreadRefresh", refreshNow); };
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
        // 依存のない2本は並列で（2026-08-02・更新時間の短縮：直列2往復→1往復ぶんの待ちに）
        const [{ data }, { data: ep }] = await Promise.all([
          supabase.from("worker_profiles").select("avatar_url,nickname").eq("auth_id", me.id).maybeSingle(),
          supabase.from("employer_profiles").select("avatar_url,nickname").eq("auth_id", me.id).maybeSingle(),
        ]);
        if (!cancelled) setMeAvatar({ url: data?.avatar_url || "", name: data?.nickname || me.name || "", empUrl: ep?.avatar_url || "", empName: ep?.nickname || me.name || "" });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [me?.id, empCtx]);
  // 行動計測：ページ遷移ロガー（運営者本人の自己デバッグ専用・page_eventsへfire-and-forget）。
  // 利用者（協力者・一般）の閲覧行動は記録しない（データ憲法・行動記録の憲法／2026-07-27たきと指示）。
  // DB側もRLS「pe insert self admin only」で本人以外のINSERTを拒否＝画面の実装に関わらず入らない
  const lastLoggedHashRef = useRef(null);
  useEffect(() => {
    if (!me?.id || !isAdmin(me)) return;
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
  // 訪問者の「登録が必要です」案内をボックス化（2026-07-27たきと指示）。どの画面からでも openLoginBox() で開く
  const [loginBox, setLoginBox] = useState(false);
  useEffect(() => {
    // ボックスで開く時も、閉じて別経路でログインした時に戻れるよう発火ページを覚えておく
    const f = () => { armLoginReturn(); setLoginBox(true); };
    window.addEventListener("cb:openLoginBox", f);
    return () => window.removeEventListener("cb:openLoginBox", f);
  }, []);
  // 訪問者をログイン画面へ送る唯一の入口（2026-07-30たきと指示）。
  // 送り出す前に「今いるページ」を覚え、ログイン成功後にそこへ戻す（下の onLogin で消費）
  const goLogin = () => { armLoginReturn(); setTab("login"); };
  // ログイン成功後の行き先。優先順＝①緊急連絡リンク（時間に敏感）②応募の戻り先（具体的）
  // ③発火したページ ④既定（プロフィール）。戻り先の記録は読んだ時点で消える
  const afterLoginGo = () => {
    try {
      const em = sessionStorage.getItem("cb_emergencyLink");
      if (em) { sessionStorage.removeItem("cb_emergencyLink"); window.location.hash = "/emergency/" + em; return; }
    } catch {}
    const ret = peekApplyReturn();
    if (ret) { window.location.hash = "/work/job/" + ret; setTab("search"); return; }
    const back = takeLoginReturn();
    if (back) { window.location.hash = "/" + back; return; }
    setTab("profile");
  };
  const [openAccountForm,setOpenAccountForm]=useState(false); // #/account 直打ち用(URL由来の任意入口・needsAccountHolderとは別系統)
  const [showLanding,setShowLanding]=useState(false);
  const [showJobPost,setShowJobPost]=useState(()=>{ const h=window.location.hash.replace(/^#\/?/,""); return h==="work/new"||h.startsWith("work/new/")||h.startsWith("work/edit/"); });
  const [consignRoom,setConsignRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/consignment"); } catch { return false; } }); // 委託準備室（#/admin/consignment・管理者専用・2026-07-19。/profile 等のサブページ含む）
  const [workingRoom,setWorkingRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/working"); } catch { return false; } }); // 仕事中専用ページ（#/admin/working・管理者専用・2026-08-01）
  const [upcomingRoom,setUpcomingRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/upcoming"); } catch { return false; } }); // まもなく開始ページ（#/admin/upcoming・管理者専用・2026-08-01）
  const [evalRoom,setEvalRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/evaluation"); } catch { return false; } }); // 客観的評価ページ（#/admin/evaluation・管理者専用・2026-08-05）
  const [showApplyDone,setShowApplyDone]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/done");
  // 仮応募の成功ページ（#/apply/pending・第15弾・2026-07-30）。応募系の全画面ページは
  // applyPage 1変数にまとめる＝各タブの描画式に付けるガードが1つで済む（オーバーレイ描画の鉄則）
  const [showApplyPending,setShowApplyPending]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/pending");
  const applyPage = showApplyDone ? "done" : showApplyPending ? "pending" : null;
  const [applyAlready,setApplyAlready]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/done" && sessionStorage.getItem("cb_applyAlready")==="1");
  // 仮応募からの昇格件数（プロフィール保存の直後に promote_my_pending_applications が返した数）
  const [promotedCount,setPromotedCount]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"")==="apply/done" ? Number(sessionStorage.getItem("cb_promoted") || 0) : 0; } catch { return 0; } });
  const [chatAppId,setChatAppId]=useState(()=>{ const m=window.location.hash.replace(/^#\/?/,"").match(/^chat\/([0-9a-f-]+)$/); return m?m[1]:null; });

  // ↓ここに置く理由：この中で使う state（openAccountForm・showJobPost 等）の宣言より後ろでないと
  //   宣言前参照になる（no-use-before-define。2026-07-29に並べ替え・中身は不変）
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
      setShowApplyPending(rawHash === "apply/pending");
      setConsignRoom(rawHash.startsWith("admin/consignment"));
      setWorkingRoom(rawHash.startsWith("admin/working"));
      setUpcomingRoom(rawHash.startsWith("admin/upcoming"));
      setEvalRoom(rawHash.startsWith("admin/evaluation"));
      if (rawHash === "apply/done") {
        try { setApplyAlready(sessionStorage.getItem("cb_applyAlready")==="1"); sessionStorage.removeItem("cb_applyAlready"); } catch {}
        try { setPromotedCount(Number(sessionStorage.getItem("cb_promoted") || 0)); sessionStorage.removeItem("cb_promoted"); } catch {}
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

  // #/account 直打ち（初回ロード）の認証チェック。hashchangeイベントは初回ロードでは発火しないため別途判定
  useEffect(() => {
    if (window.location.hash.replace(/^#\/?/, "") !== "account") return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { setOpenAccountForm(true); }
      else { setOpenAccountForm(false); window.location.hash = "/login"; }
    });
  }, []);
  // トップページの着地（サイト/アプリを開いた時、既定の着地先を差し替える）。優先順は上から：
  //   ① 新着の応募（雇い手・2026-08-05たきと指示「応募を受けた直後からサイトに入ると
  //      トップ画面がこのページになる」）→ #/new-applicants
  //   ② まもなく開始（2026-08-01たきと指示・いまは管理者のみ）→ #/admin/upcoming
  //      開始1週間以内（作業当日は除く＝当日は仕事中ページが持つ）のマッチがある時。
  //      判定はページ側の表示フィルタと同じ isUpcomingSoon（空着地の防止）
  // ①②を1つのeffectに束ねる理由：別々のeffectだと両方が非同期に hash を書いて奪い合う。
  // 順に判定し、先に着地したらそこで終わる＝優先順が決まる。
  // URL直打ち（ディープリンク・#/work/job/… や #/chat/… 等）で開いた時は行き先を奪わない
  //（initialHashTab=null＝既定着地の時だけ）。判定は1アプリ起動につき1回（ログアウト時はreloadで起動し直すため実質毎回）
  const topLandingChecked = useRef(false);
  useEffect(() => {
    if (topLandingChecked.current || !me || initialHashTab !== null) return;
    topLandingChecked.current = true;
    // RPCが返るまでの数秒間にユーザーが別ページへ移動していたら着地させない（2026-08-02）：
    // 「開いた時の着地」であって、操作中の引き戻しはしない。判定は今のhashで行う
    const stillOnDefault = () => { const t = readHashTab(); return t === null || t === "search"; };
    (async () => {
      // ── ① 新着の応募（未対応＝status='applied'の件数。my_nav_badges の applicants_pending が
      //    下部ナビ「🤝応募者」バッジと同じ唯一のソース。決めればゼロになり着地は自然に止む）
      try {
        const { data: badges } = await supabase.rpc("my_nav_badges");
        if ((badges?.applicants_pending || 0) > 0 && stillOnDefault()) { window.location.hash = "/new-applicants"; return; }
      } catch { /* 失敗時は通常の着地のまま（応募者ページ・今日ページからも辿れる） */ }
      // ── ② まもなく開始（管理者）
      if (!isAdmin(me)) return;
      try {
        const { data } = await supabase.rpc("admin_working_jobs");
        // 結果をキャッシュに置く（2026-08-02・更新時間の短縮）：着地先のまもなく開始／仕事中ページが
        // 同じRPCをもう一度待たずに即描画できる（起動でRPCが2回直列に走っていた無駄の解消）
        if (data?.ok) setCache("admin:workingJobs", data);
        if (data?.ok && (data.upcoming || []).some(it => isUpcomingSoon(it, 7)) && stillOnDefault()) window.location.hash = "/admin/upcoming";
      } catch { /* 失敗時は通常の着地のまま（見守りページは管理タブからも開ける） */ }
    })();
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps -- initialHashTab は起動時定数

  // 規約v2・プラポリv2 全面改定バナー（7日間限定・2026-07-21〜07-28）。閉じるとlocalStorageで再表示しない
  const [legalV2BannerDismissed,setLegalV2BannerDismissed]=useState(()=>{ try { return localStorage.getItem("cb_legalv2_banner_dismissed")==="1"; } catch { return false; } });
  const showLegalV2Banner = (() => {
    const from = new Date("2026-07-21T00:00:00+09:00").getTime();
    const until = from + 7*24*60*60*1000;
    const now = Date.now();
    return !legalV2BannerDismissed && now >= from && now < until;
  })();
  const [showDevJump,setShowDevJump]=useState(false); // 開発用ジャンプ（管理者がログイン中でも各stepへ飛ぶ）
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false); // モバイル下部バー左端☰（PCのmenuOpenとは別系統）
  // この画面を報告：☰の開閉やヘルプの章開閉と無関係な階層で開閉させる（2026-07-14・アンマウントバグ修正）
  const [showFeedback, setShowFeedback] = useState(false);
  const [showTerms,setShowTerms]=useState(false);
  const [showConstitution,setShowConstitution]=useState(false);
  const [showPrivacy,setShowPrivacy]=useState(false);
  const [showOnboarding,setShowOnboarding]=useState(false);
  const [obModalKey,setObModalKey]=useState(0);
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
    // 通信エラー＝「未登録」と断定しない（2026-07-27修正：+testで登録済みアカウントに新規登録①が
    // 出た誤爆。ログイン直後はトークン切替等でクエリが一時失敗しうる）。エラー時はゲートを
    // 動かさず3秒後に1回だけ再確認。判定が確定した時（error無し）だけsetする＝getSession誤認と同じ型
    const check = async (retryLeft)=>{
      const { data, error } = await supabase.from('account_holders').select('id').eq('auth_id', me.id).maybeSingle();
      if(cancelled) return;
      if(error){ if(retryLeft > 0) setTimeout(()=>{ if(!cancelled) check(retryLeft - 1); }, 3000); return; }
      setNeedsAccountHolder(!data);
    };
    check(1);
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
    let startY = null, startX = null, fired = false;
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
      startY = e.touches[0].clientY; startX = e.touches[0].clientX;
    };
    const onMove = (e) => {
      if (startY == null || fired) return;
      if (window.scrollY > 0) { startY = null; return; }
      const dy = e.touches[0].clientY - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      // 横スワイプでは発動させない（2026-07-27たきと報告）：応募者ページのタブ切替スワイプが
      // 少し下に流れただけでリロードが走り、選んでいたタブが「すべて」に戻っていた。
      // 判定は他のスワイプと同じ作法＝縦が横の1.5倍以上あって初めて「引き下げ」とみなす
      if (dy > 90 && dy > dx * 1.5) {
        fired = true;
        const ov = document.createElement("div");
        // 委託ページ（黒の世界）ではブラック、他は既定の緑（2026-07-31たきと指示）
        const inkColor = document.querySelector(".cb-consign-page") ? "#111111" : "#00A86B";
        ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(255,255,255,.88);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;font-family:'Noto Sans JP',sans-serif";
        ov.style.color = inkColor;
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
  // (.mobile-apply-bar)はcb-scroll-hideの対象外＝スクロール中は常時表示。ただし最下部から
  // 50px以内では cb-at-bottom クラスで下へ格納する（フッターのサポート等が読める・2026-07-25）。
  useEffect(() => {
    if (chatAppId) { document.body.classList.remove('cb-scroll-hide'); document.body.classList.remove('cb-at-bottom'); return; }
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const diff = y - lastY;
      // 最下部からの残り距離（cb-at-bottom判定と下の格納判定で共用）
      const fromBottom = document.documentElement.scrollHeight - window.innerHeight - y;
      // 求人詳細の応募フッター格納用（2026-07-25たきと指示）：最下部から50px以内で目印クラス。
      // y>40ガード＝スクロール余地のない短いページで付きっぱなしになる事故を防ぐ
      if (fromBottom <= 50 && y > 40) document.body.classList.add('cb-at-bottom');
      else document.body.classList.remove('cb-at-bottom');
      // cb-dir-down（トグル専用の方向クラス）は廃止（2026-07-27）：バー・☰・トグル・運営チャットFABの
      // 格納タイミングをcb-scroll-hide 1本に統一（最下部の常時格納・バウンス吸収帯も全員に効く）
      if (y < 40) { document.body.classList.remove('cb-scroll-hide'); lastY = y; return; }
      // 最下部からの残り距離。64px以内=常に格納。180px以内=バウンス吸収帯（強フリックの
      // 跳ね返りやSafariツールバー伸縮で一瞬上向き判定になっても復帰させず状態維持）。
      // 180pxを超えて上に戻したときだけ通常の方向判定に戻る。
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
      document.body.classList.remove('cb-at-bottom');
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
    // 起動フェイルセーフ（2026-07-25）：ネットワークが刺さってもUIを人質にしない。4秒でloadedを強制的に立て、
    // 画面（骨格）を先に出す。セッション復元は裏で続き、完了した時点でme等が後から埋まる
    const loadedFailsafe = setTimeout(() => setLoaded(true), 4000);
    // 起動で読むのは「今のページに要るもの」だけにする（2026-07-27たきと指示）。
    // dests×2・records（旧事業データ）は管理タブ・プロフィールモーダルでしか使わないso起動から外し、
    // 開いた時にloadLegacyData()で読む＝全員のリロードが3往復→2往復に軽くなる
    const [sessRes] = await Promise.all([
      supabase.auth.getSession().catch(e => ({ data: { session: null }, error: e })),
    ]);
    const session = sessRes?.data?.session || null;
    const sessErr = sessRes?.error || null;

    let f = [];
    // ログアウト誤認の修正（2026-07-26）：「セッションが無い（トークン不在＝本物のログアウト）」と
    // 「復元に失敗した（トークン更新の一時エラー・電波等）」を区別する。
    // 前者だけログアウト扱い（スナップショット消去）。後者はログイン状態を維持し、3秒後に1回だけ静かに再試行
    if (!session && !sessErr) { setMe(null); clearSnapshots(); }
    if (!session && sessErr) {
      setTimeout(async () => {
        try {
          const { data: { session: s2 } } = await supabase.auth.getSession();
          if (!s2) return; // まだ復元できない→スナップショットのまま次のリロードに任せる
          const { data: dbF } = await supabase.from('farmers').select('*').eq('email', s2.user.email).single();
          if (dbF) setMe({ id: s2.user.id, name: dbF.name, email: dbF.email, status: dbF.status, joinedYear: dbF.joined_year, prefecture: dbF.prefecture || "", municipality: dbF.municipality || "", planned_crops: dbF.planned_crops || [], experience_tier: dbF.experience_tier || "", farming_type: dbF.farming_type || "", area_tan: dbF.area_tan || "", sales_channels: dbF.sales_channels || [], avatar_url: dbF.avatar_url || "" });
          else setMe({ id: s2.user.id, email: s2.user.email || "", name: "", isWorker: true });
        } catch {}
      }, 3000);
    }
    if (session) {
      const [moddedRes, farmerRes] = await Promise.all([
        // supabase.rpc()の戻りはthenableだがPromiseではない＝.catchが存在せず、直に繋ぐと
        // 「.catch is not a function」で起動処理ごと落ちる（2026-07-26・応募者ページ白画面の原因）。
        // Promise.resolveで本物のPromiseに包んでから握る
        Promise.resolve(supabase.rpc('is_account_moderated', { p_uid: session.user.id })).catch(() => ({ data: null })),
        supabase.from('farmers').select('*').eq('email', session.user.email).single(),
      ]);
      // 停止／追放チェック（2026-07-19）：ログイン封鎖(banned_until)が効くまでの猶予（既存トークン最大1h）を塞ぐ。
      // 停止中なら即サインアウトして制限画面へ（meはセットしない）
      if (moddedRes?.data) { setBlockedAccount(true); clearSnapshots(); try { await supabase.auth.signOut(); } catch {} clearTimeout(loadedFailsafe); setLoaded(true); return; }
      const { data: dbFarmer } = farmerRes;
      if (dbFarmer) {
        const loggedIn = { id: dbFarmer.auth_id || dbFarmer.id, name: dbFarmer.name, email: dbFarmer.email, status: dbFarmer.status, joinedYear: dbFarmer.joined_year, prefecture: dbFarmer.prefecture || "", municipality: dbFarmer.municipality || "", planned_crops: dbFarmer.planned_crops || [], experience_tier: dbFarmer.experience_tier || "", farming_type: dbFarmer.farming_type || "", area_tan: dbFarmer.area_tan || "", sales_channels: dbFarmer.sales_channels || [], avatar_url: dbFarmer.avatar_url || "" };
        f = [loggedIn];
        setMe({ ...loggedIn, id: session.user.id });
        const _onNewJobFlow = (() => { const h = window.location.hash.replace(/^#\/?/, ""); return h === "work/new" || h.startsWith("work/new/"); })();
        // hash無しの時はさがすへ（デフォルトタブ）。ただし更新中（この復元が返るまでの数秒間）に
        // ユーザーが別タブへ移動していたら行き先を奪わない（2026-08-02）：initialHashTabは起動瞬間の
        // 記録なので、移動済みかどうかは「今のhash」で判定する
        const _nowTab = readHashTab();
        if (!initialHashTab && !_onNewJobFlow && (_nowTab === null || _nowTab === "search")) setTab("search");
      } else {
        // farmers行なし＝働き手または初回。最小形の me でログインさせる（段階1と同じ形）。
        // account_holders未登録ならneedsAccountHolderゲートが後段で①フォームを自動表示する。
        setMe({ id: session.user.id, email: session.user.email || "", name: "", isWorker: true });
      }
    }
    setFarmers(f);setFarmPend(fp);
    setBadgeCnt(fp.length);clearTimeout(loadedFailsafe);setLoaded(true);
  })();},[]);

  // 旧事業データ（出荷先・記録）の遅延読込（2026-07-27たきと指示「該当するページのみリロード」）：
  // 管理タブ／プロフィールモーダルを開いた時に1回だけ読む。閉じても保持so再取得はしない
  // ★safeTabはこの下（2000行台）で定義されるため参照禁止（初期化前アクセスで真っ黒画面になる）。
  //   生のtabで判定する（adminタブは資格ガードを通った後だけ描画されるので実害なし）
  const legacyLoadedRef = useRef(false);
  useEffect(() => {
    if (!(tab === "admin" || showProfile) || legacyLoadedRef.current) return;
    legacyLoadedRef.current = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const [okRes, pendRes, recsRes] = await Promise.all([
          supabase.from('dests').select('*').eq('status', 'approved'),
          supabase.from('dests').select('*').eq('status', 'pending'),
          session ? supabase.from('records').select('*').eq('farmer_id', session.user.id) : Promise.resolve({ data: [] }),
        ]);
        const da = (okRes.data || []).map(d => ({ id: d.id, name: d.name, status: d.status, notes: d.notes }));
        const dp = (pendRes.data || []).map(d => ({ id: d.id, name: d.name, status: d.status, submittedBy: d.submitted_by }));
        const r = {};
        (recsRes.data || []).forEach(rec => {
          const k = `${rec.farmer_id}_${rec.year}_${rec.month}`;
          if (!r[k]) r[k] = [];
          r[k].push({ id: rec.id, destId: rec.dest_id, boxes: rec.boxes, ppb: rec.ppb, costs: rec.costs || [], crop: rec.crop, variety: rec.variety, is_brand: rec.is_brand, created_at: rec.created_at });
        });
        setDestOk(da); setDestPend(dp); setRecs(r);
        setBadgeCnt(prev => prev + dp.length);
      } catch { legacyLoadedRef.current = false; } // 失敗したら次に開いた時にもう一度
    })();
  }, [tab, showProfile]);

  const savF=useCallback(async f=>{setFarmers(f);await sSet("yw_farmers",f);},[]);
  const savFP=useCallback(async f=>{setFarmPend(f);await sSet("yw_farmers_pend",f);setBadgeCnt(f.length+(destPend?.length||0));},[destPend]);
  const savDA=useCallback(async d=>{setDestOk(d);await sSet("yw_dests_ok",d);},[]);
  const savDP=useCallback(async d=>{setDestPend(d);await sSet("yw_dests_pend",d);setBadgeCnt((farmPend?.length||0)+d.length);},[farmPend]);
  



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
    // ナビバッジと同じ理由で遷移時は20秒スロットル（2026-07-27）。新着はRealtime、既読はcb:unreadRefreshが即反映
    let lastAt = 0;
    const refreshOnNav = () => { const now = Date.now(); if (now - lastAt < 20000) return; lastAt = now; refresh(); };
    refresh(); lastAt = Date.now();
    window.addEventListener("hashchange", refreshOnNav);
    window.addEventListener("cb:unreadRefresh", refresh);
    // リアルタイム（2026-07-19）：自分宛メッセージのINSERTを購読し、バッジ即時更新＋トースト。
    // 配信はRLS準拠＝自分が当事者のchat/自分宛DMしか届かない
    const ch = supabase.channel("unread-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onMsg)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, onDm)
      .subscribe();
    return () => { window.removeEventListener("hashchange", refreshOnNav); window.removeEventListener("cb:unreadRefresh", refresh); supabase.removeChannel(ch); };
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
    clearSnapshots(); // 前回画面の残像（me等）を残さない
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



  const appFarmer=useCallback(async id=>{
    const f=farmPend.find(x=>x.id===id);if(!f)return;
    // appliedAt を意図的に捨てる分割代入（farmers に申請日時の列は無い）。
    // 未使用に見えるが消してはいけない＝消すと appliedAt が farmer に混ざりINSERTが落ちる
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

  const ALL_TABS=[
    {k:"search",l:"さがす",modes:["farmer","worker"]},
    {k:"profile",l:"プロフィール",modes:["farmer","worker"]},
    ...(isAdmin(me)?[{k:"admin",l:"管理",badge:badgeCnt,modes:["farmer","worker"]}]:[]),
  ];
  const TABS = ALL_TABS;

  // 未ログインで input（ログイン画面）要求時はモード不問で通す（認証は役割不問・骨格⑥）
  // 部屋番号(TAB_URL_KEYS)にある部屋は全て到達可（避難部屋含む・骨格④）。資格の無い部屋と迷子はsearchへ
  const safeTab = TAB_URL_KEYS.includes(tab)
    ? (((tab === "admin" || tab === "boxes" || tab === "qr") && !isAdmin(me)) || ((tab === "insurance" || tab === "experience" || tab === "new-applicants") && !me) ? "search" : tab)
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
        // matchは「そのタブの領域に居るか」を明示する（2026-07-27）。hashのstartsWithだけだと
        // 作成中(drafts)・期限切れ(expired)・雇い手プロフィール等で どのタブも点かない穴があった
        { k:"emp-jobs",       icon:"📣", label:"求人",       hash:"/profile/employer/active",
          match: h => h.startsWith("profile/employer/active") || h.startsWith("profile/employer/drafts") || h.startsWith("profile/employer/expired") },
        { k:"emp-applicants", icon:"🤝", label:"応募者",     hash:"/profile/employer/applicants", badge: navBadges.applicants_pending,
          match: h => h.startsWith("profile/employer/applicants") },
        { k:"chats",          icon:"💬", label:"チャット" },
        { k:"calendar",       icon:"📆", label:"今日" },
        { k:"profile",        icon:"👤", label:"プロフィール",
          match: h => h === "profile" || h === "profile/employer" || h.startsWith("profile/employer/profile") || h.startsWith("profile/worker") },
      ]
    : MOBILE_TABS;

  return(
    <div style={{minHeight:"100vh",background:C.washi,color:C.ink,"--mode-accent":modeAccent,"--role-accent":(me && !empCtx) ? ROLE_ORANGE : ROLE_GREEN,"--role-accent-soft":(me && !empCtx) ? "rgba(247,107,28,0.15)" : "rgba(0,168,107,0.13)"}}>
      <style>{CSS}</style>

      {/* 働き手/雇い手プレビューの全域ボックス（どの画面のアイコンからでもイベントで展開・2026-07-19） */}
      {/* 採用おめでとうボックス（2026-07-19）：花びら🌸＋求人リンク＋？マーク3つ（緊急連絡先・採用からの流れ・評価とは） */}
      {/* 段階お祝いボックス（2026-07-19・②承認/⑤仕事/⑥評価・働き手/農家両側）：お知らせ規格の意匠 */}
      {!consignRoom && stageBox && (
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
      {!consignRoom && hiredBox && (
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
      {!consignRoom && msgToast && (
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
      {/* ── 世界の分離（2026-07-31たきと指示）──
          委託ページ（consignRoom）では、求人求職プラットフォームのボックス（お祝い・お知らせ・
          チャット新着トースト・プレビュー・段階ヘルプ）を一切展開しない。世界観の混同を防ぐ。
          描画を止めるだけ＝stateは生きているので、委託ページを出れば未読のお知らせ等は従来どおり出る */}
      {!consignRoom && <WorkerPreviewSheet />}
      {!consignRoom && <EmployerPreviewSheet />}
      {!consignRoom && <PhaseInfoSheet />}
      {/* ログインのボックス（2026-07-27たきと指示）：訪問者が応募・いいね等を押したとき、
          alertでなくログイン画面をその場に展開する。中身はログインタブと同じLoginScreen＝
          認証の入口は1つだけ（分岐を増やさない）。閉じれば見ていた画面に戻る */}
      {loginBox && (
        <div onClick={()=>setLoginBox(false)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:10200, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
              <button onClick={()=>setLoginBox(false)} aria-label="閉じる" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            </div>
            <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"0 0 calc(16px + env(safe-area-inset-bottom, 0px))" }}>
              <LoginScreen farmers={farmers} onLogin={f=>{
                setLoginBox(false);
                setMe(f);
                // ボックスは画面を奪っていないので、原則その場に留まる。
                // 緊急連絡・応募の戻り先だけは行き先が決まっているので従来どおり移動する
                try {
                  const em = sessionStorage.getItem("cb_emergencyLink");
                  if (em) { sessionStorage.removeItem("cb_emergencyLink"); window.location.hash = "/emergency/" + em; return; }
                } catch {}
                const ret = peekApplyReturn();
                if (ret) { window.location.hash = "/work/job/" + ret; setTab("search"); return; }
                takeLoginReturn(); // その場に居るので戻り先は使わない＝古い記録を残さない
              }}/>
            </div>
          </div>
        </div>
      )}

      {/* ── プロフィール承認の「お帰りなさい」ポップアップ（起動時1回・ボックス展開） ── */}
      {!consignRoom && welcomeApproved && (
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
      {!consignRoom && activeNotices && !welcomeApproved && (
        <div onClick={dismissNotices} className="cb-box-overlay" style={{ zIndex:10900 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            {/* ✕ボタンは置かない（2026-07-27たきと指示）：ボックス外タップで閉じられる（＝既読化も同じdismissNotices）so重複 */}
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
        {/* 🥦は削除・ブランド名は黒文字に統一（2026-07-27たきと指示・ログイン画面と同じ） */}
        <button onClick={() => { setTab("search"); window.location.hash = "/search"; }}
          style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                   fontSize:17, fontWeight:800, color:"#222", padding:0 }}>
          chitose-bank
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
                /* ログインへ行く時だけ、今いるページを覚える（戻ってこられるように・2026-07-30） */
                <button key={item.key} onClick={()=>{ setMobileMenuOpen(false); if (item.hash === "/login") armLoginReturn(); window.location.hash = item.hash; }} className="f-sans app-header-mobile-menu-item">{item.label}</button>
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
            const cur = curHash; // ★描画中にwindow.location.hashを読まない（同一タブ内の移動で点灯が固まる・2026-07-27）
            const isActive = t.match
              ? t.match(cur)
              : t.hash
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
                // hash指定のタブは、hashの先頭区画から行き先タブを決める（2026-07-27修正）。
                // 以前は一律 setTab("profile") だったため、tab→URL同期useEffectが直後に
                // #/install・#/login を #/profile へ巻き戻し、訪問者の「入れ方」「登録・ログイン」が
                // プロフィールに飛んでいた（農家ナビの行き先は /profile/… なので偶然動いていた）
                if (t.hash) {
                  const seg = t.hash.replace(/^\//, "").split("/")[0];
                  setTab(TAB_URL_KEYS.includes(seg) ? seg : "profile");
                  window.location.hash = t.hash;
                  return;
                }
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
        <AppErrorBoundary>
        {me&&!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab!=="terms"&&safeTab!=="privacy"&&showLegalV2Banner&&(
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
          <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><ChatView applicationId={chatAppId} onBack={()=>{ window.history.length > 1 ? window.history.back() : (window.location.hash="/profile"); }} /></Suspense>
        ) : showApplyPending ? (
          <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><ApplyPending /></Suspense>
        ) : showApplyDone ? (
          <div style={{ minHeight:"70vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", maxWidth:400, margin:"0 auto", padding:"0 20px" }}>
            <div style={{ fontSize:56, marginBottom:16 }}>📩</div>
            {/* タイトルは応募完了しました！に統一・タイトルだけ文字ジャンプ（2026-07-19）。
                仮応募からの昇格で来た時は、届いた件数を見出しに出す（第15弾・2026-07-30） */}
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}><NoticeJumpText text={promotedCount > 0 ? `${promotedCount}件の応募を農家さんにお届けしました` : applyAlready ? "この求人には応募済みです" : "応募完了しました！"} /></h2>
            <p className="f-sans" style={{ fontSize:16, color:"#717171", lineHeight:1.8, marginBottom:8 }}>
              {promotedCount > 0 ? (
                "これはまだ採用ではありません。農家が内容を確認し、承認するとお知らせします。"
              ) : applyAlready ? (
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
        ) : safeTab==="search" ? <JobSearchMapView onRegister={goLogin} me={me} /> : null}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="profile"&&(me
          ? <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><ProfileHub me={me}
              onNewJob={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} setShowJobPost(true); window.location.hash="/work/new"; }}
              onResume={(n)=>{ setShowJobPost(true); window.location.hash="/work/edit/"+n; }}
              onAvatarChange={(a)=>setMeAvatar(prev=>({ ...prev, ...a }))} /></Suspense>
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>プロフィールを見るにはログインしてください</p><button onClick={goLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {/* 新着の応募ページ（#/new-applicants・2026-08-05たきと指示）：応募を受けた雇い手専用。
            未対応の応募があればサイトを開いた時にここへ着地する（起動時の着地判定・topLandingChecked）。読み取り専用＝
            承認・見送りの実行は応募者シートが唯一の窓口so、ここからはそこへ送るだけ */}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="new-applicants"&&me&&
          <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><NewApplicantsPage/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="chats"&&(me
          ? <ChatList />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>チャットを見るにはログインしてください</p><button onClick={goLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="saved"&&(me
          ? <SavedJobsView me={me} />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>いいねを見るにはログインしてください</p><button onClick={goLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="calendar"&&(me
          ? <CalendarRouter me={me} defaultRole={empCtx ? "farmer" : "worker"} />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>今日の予定を見るにはログインしてください</p><button onClick={goLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="login"&&(me
          ? <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#222"}}>ログイン済みです</p></div>
          : <LoginScreen farmers={farmers} onLogin={f=>{
              setMe(f);
              // 行き先の決め方は afterLoginGo に一本化（緊急連絡→応募の戻り先→発火したページ→既定）
              afterLoginGo();
            }}/>)}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&consignRoom&&<Suspense fallback={<div style={{ minHeight:"70vh", display:"flex", alignItems:"center", justifyContent:"center" }}><p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, margin:0 }}>読み込み中<Dots /></p></div>}><ConsignmentRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&workingRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminWorkingRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&upcomingRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminUpcomingRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&evalRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminEvaluationRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&!consignRoom&&!workingRoom&&!upcomingRoom&&!evalRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminTab
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
          onShowAccountForm={() => { setOpenAccountForm(true); window.location.hash = "/account"; }}/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="boxes"&&isAdmin(me)&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminBoxRegistryPage/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="charter"&&(
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
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>農業の雇用には、雇用して初めて分かることが二つある。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>雇い手にとっては働き手の技術と知識、働き手にとっては職場の環境と待遇である。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>我々は、その双方を事実として記録し、雇い手と働き手が雇用の前に互いを判断できる場を運営する。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>働き手は自らの望む条件を示すことができ、雇い手はそれに応えることができる。</p>
                <p className="f-sans" style={{ fontSize:16, color:"#333", lineHeight:2, margin:0 }}>記録の積み重ねが働き手の資産となり、頼れる担い手が育っていく土壌となることを大切にする。</p>
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
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="help"&&<HelpCenter me={me} onReportClick={() => setShowFeedback(true)} />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="install"&&<InstallGuide me={me} />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="visit"&&<VisitEntrance me={me} />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="insurance"&&me&&<InsurancePrepPage me={me} />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="experience"&&me&&<WorkerExperiencePage />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="qr"&&isAdmin(me)&&<VisitorQRPage />}
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="privacy"&&(
          <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>プライバシーポリシー</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／全面改定：2026年7月21日／改定：2026年8月●日</p>

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
        {!needsAccountHolder&&!openAccountForm&&!chatAppId&&!applyPage&&safeTab==="terms"&&(
          <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>利用規約</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／全面改定：2026年7月21日／一部改定：2026年8月●日</p>

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
        </AppErrorBoundary>
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
            <button onClick={()=>{ window.location.hash="/help/farmer"; }} className="f-sans footer-col-link">満額支払型とは</button>
            <button onClick={()=>{ window.location.hash="/help/mails"; }} className="f-sans footer-col-link">保険の準備</button>
            <button onClick={()=>{ window.location.hash="/help/worker"; }} className="f-sans footer-col-link">評価のしくみ</button>
          </div>
          <div>
            <p className="f-sans footer-col-title">chitose-bank</p>
            <button onClick={()=>{ window.location.hash="/charter"; window.scrollTo(0,0); }} className="f-sans footer-col-link">運営憲章</button>
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
        <Suspense fallback={null}><LandingFlow
          onComplete={()=>setShowLanding(false)}
          onSkip={()=>{setShowLanding(false);setTab("search");}}
          onLogin={()=>{setShowLanding(false);setTab("login");}}
        /></Suspense>
      )}
      {me&&showJobPost&&(
        <Suspense fallback={null}><LandingFlow
          initialRole="farmer"
          onComplete={()=>{ setShowJobPost(false); window.location.hash="/profile/employer"; }}
          onSkip={()=>{ setShowJobPost(false); window.location.hash="/profile/employer"; }}
          onLogin={()=>{ setShowJobPost(false); window.location.hash="/profile/employer"; }}
          onStepChange={(s)=>{ if(window.location.hash.replace(/^#\/?/,"").startsWith("work/new")) window.location.hash="/work/new/"+s; }}
          initialStep={(()=>{ const m=window.location.hash.replace(/^#\/?/,"").match(/^work\/new\/(\d+)$/); return m?parseInt(m[1],10):undefined; })()}
        /></Suspense>
      )}
      {me&&showDevJump&&(
        <Suspense fallback={null}><LandingFlow
          onComplete={()=>setShowDevJump(false)}
          onSkip={()=>setShowDevJump(false)}
          onLogin={()=>setShowDevJump(false)}
        /></Suspense>
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
