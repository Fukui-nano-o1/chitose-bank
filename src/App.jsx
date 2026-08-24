import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { supabase } from "./lib/supabase";
import { fetchJobRowForMe } from "./lib/jobForMe";
import { isAdmin, ROLE_ORANGE, ROLE_GREEN, C, THIS_YEAR, isUpcomingSoon, msgSnippet, PRIVACY_VERSION } from "./lib/utils";
import { fbTap, unlockAudio } from "./lib/feedback";
import { emitRefresh, REFRESH_APPLICATIONS, REFRESH_JOBS } from "./lib/refreshBus";
import { chatCache, hydrateChatCache } from "./lib/chatCache";
import { createIdleQueue } from "./lib/idleQueue";
import { useSheetDragClose } from "./lib/sheetDrag";
import { getTrafficSrc, getAnonKey } from "./lib/visitSource";
import { installFixedRepin } from "./lib/fixedRepin";
import { Celebration } from "./components/Celebration";
import { PublishChoiceCard } from "./components/PublishChoiceCard";
import { TodayPage } from "./components/TodayPage";
import { Avatar, NoticeJumpText, DevBadge, PhaseInfoSheet, Dots } from "./components/ui";
import { NavIcon, NavIconInline } from "./components/NavIcons";
import { SavedJobsView } from "./components/SavedJobsView";
import { WorkerTrustCard, FarmerTrustCard } from "./components/TrustCards";
import { logAppError } from "./app/diagnostics/errorLog";
import { lazyChunk, prepareFreshReload } from "./app/chunkReload";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import { PRIVACY_SECTIONS, PrivacyDataTable, PrivacyPolicy } from "./app/legal/PrivacyPolicy";
import { DataConstitution } from "./app/legal/DataConstitution";
import { HelpCenter, InstallGuide } from "./app/help/HelpCenter";
import { FeedbackModal } from "./app/diagnostics/FeedbackModal";
import { WorkerPreviewSheet, EmployerPreviewSheet } from "./app/preview/PreviewSheets";
// ルート分割の自己修復（lazyChunk / prepareFreshReload / ChunkUpdating）→ app/chunkReload.jsx へ移設（2026-08-17）

// 掲載完了アニメの後の「60秒ノーアクションで さがす へ」の見張り（2026-08-07たきと指示）。
// マウント中に一度でも操作（タップ・キー・スクロール・タッチ）or 画面遷移があれば取り消す＝
// 本当に何もせず滞在した時だけ /search へ送る。onEnd(fired)：firedならタイムアウト発火・falseなら取り消し。
// ★モジュールレベル定義（フォーカス消失バグ回避の作法）。pointer-events等は一切奪わない（listenerのみ）。
// 応募完了の法的一言トースト（2026-08-07・①）。完了ページを廃止したので、その画面にあった
// 「まだ採用ではない／雇用契約は当事者間」の明示を、着地先に一度だけ出して消さない（法務の一線）。
// 下から出る帯。8秒で自動的に消え、タップでも閉じる。pointer-events:noneにはしない（タップで閉じられるように）。
// 求人フローの読み込み中に出す全画面の待ち画面（2026-08-08たきと指示「新しく求人を出すタップで
// 働き手に切り替えられる。1秒後に遷移する。切り替えを止めろ。せめて更新していることをアニメーションで見せろ」）。
// 【症状の正体】求人フローは遅延読み込み。タップ→hash=work/new→tab=profile になるが、フロー本体が
// 届くまでの約1秒間、Suspenseのfallbackがnullだったため背後のプロフィール（既定＝働き手面）が丸見えで、
// 「働き手に切り替わってから1秒後に遷移する」ように見えていた。
// 【対処】①背後を描かない（ProfileHubの描画条件に !showJobPost）②その1秒をこの画面で埋める。
// 意匠は保存中オーバーレイ（LandingFlow）と同じ緑のスピナー＝アプリ内で待ち画面の見た目を1つに保つ。
// 開いている画面thaが求人を取り直す間隔（2026-08-19）。jobs にはRealtimeを繋げないため、
// 「見えている間の定期的な合図」thaが新しい掲載を届ける唯一の経路になる（下のuseEffectで使用）
const JOBS_POLL_MS = 3 * 60 * 1000;

// ★モジュールレベル定義（フォーカス消失バグ回避の作法）
function FlowLoading({ label = <>求人フローを開いています<Dots /></> }) {
  return (
    <div style={{ position:"fixed", inset:0, zIndex:8500, background:"#fff", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ width:44, height:44, border:"4px solid #E0E0E0", borderTopColor:"#00A86B", borderRadius:"50%", animation:"cbspin 0.8s linear infinite" }} />
      <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700 }}>{label}</p>
      <style>{`@keyframes cbspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ApplyDoneNote({ promoted = 0, already = false, pending = false, worker = false, onClose }) {
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => onCloseRef.current?.(), 8000);
    return () => clearTimeout(t);
  }, []);
  const head = worker ? "ありがとうございます"
             : pending ? "仮応募をお預かりしました"
             : promoted > 0 ? `${promoted}件の応募を農家さんにお届けしました`
             : already ? "この求人には応募済みです" : "応募を農家さんにお届けしました";
  return (
    <div onClick={()=>onClose?.()} style={{ position:"fixed", left:0, right:0, bottom:0, zIndex:9500, display:"flex", justifyContent:"center", padding:"0 12px calc(12px + env(safe-area-inset-bottom, 0px))", animation:"fadeIn .25s ease" }}>
      <div className="cb-sheet-up" style={{ maxWidth:460, width:"100%", background:"#111", color:"#fff", borderRadius:14, padding:"14px 16px", boxShadow:"0 8px 32px rgba(0,0,0,0.3)", cursor:"pointer" }}>
        <p className="f-sans" style={{ fontSize:14, fontWeight:800, margin:"0 0 4px" }}><NavIconInline name={worker ? "sprout" : pending ? "hourglass" : "inbox"} size={14} />{head}</p>
        {worker ? (
          <>
            {/* 職安法配慮の明示（旧・働き手フロー完了ページstep8から移設）：構想段階＝稼働していないことを消さない */}
            <p className="f-sans" style={{ fontSize:12.5, lineHeight:1.7, color:"#E8E8E8", margin:0 }}>この機能は現在構想段階です。実装前に労働局・関係機関へ確認した上で、段階的に追加予定です。</p>
            <p className="f-sans" style={{ fontSize:11, lineHeight:1.6, color:"#B8B8B8", margin:"6px 0 0" }}>ログインすると実証に参加できます。</p>
          </>
        ) : pending ? (
          <>
            {/* 正直さの明示（仮応募＝まだ届いていない）。旧ApplyPendingページの説明を消さずここへ */}
            <p className="f-sans" style={{ fontSize:12.5, lineHeight:1.7, color:"#E8E8E8", margin:0 }}>プロフィールがそろうと、農家さんに応募が届きます。「プロフィールを仕上げる」から続けられます。</p>
            <p className="f-sans" style={{ fontSize:11, lineHeight:1.6, color:"#B8B8B8", margin:"6px 0 0" }}>自己紹介文の確認は運営が行いますが、応募はそれを待たずに届きます。</p>
          </>
        ) : (
          <>
            <p className="f-sans" style={{ fontSize:12.5, lineHeight:1.7, color:"#E8E8E8", margin:0 }}>これはまだ採用ではありません。農家が内容を確認し、承認するとお知らせします。</p>
            <p className="f-sans" style={{ fontSize:11, lineHeight:1.6, color:"#B8B8B8", margin:"6px 0 0" }}>chitose-bankは求人情報の提供と連絡の場を用意します。雇用の契約は当事者間で行われます。</p>
          </>
        )}
      </div>
    </div>
  );
}

function PublishIdleRedirect({ seconds = 60, onEnd }) {
  const onEndRef = useRef(onEnd); onEndRef.current = onEnd;
  useEffect(() => {
    let done = false;
    let t;
    // ユーザー操作（タップ・キー・スクロール・タッチ）を1つでも拾ったら取り消す。
    // hashchange は入れない＝アプリ内部のルーティングで誤って取り消さないため（タブ移動はpointerdownで拾える）
    const evs = ["pointerdown","keydown","touchstart","wheel"];
    // 関数宣言（巻き上げ）で相互参照する（no-use-before-define の functions:false で許容）
    function finish(fired) {
      if (done) return; done = true;
      clearTimeout(t);
      evs.forEach(ev => window.removeEventListener(ev, cancel, true));
      onEndRef.current?.(fired);
    }
    function cancel() { finish(false); }
    t = setTimeout(() => finish(true), seconds * 1000);
    evs.forEach(ev => window.addEventListener(ev, cancel, true));
    return () => { clearTimeout(t); evs.forEach(ev => window.removeEventListener(ev, cancel, true)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const ChatView = lazyChunk(() => import("./components/ChatView").then(m => ({ default: m.ChatView })));
const AdminChatPage = lazyChunk(() => import("./components/AdminChat").then(m => ({ default: m.AdminChatPage })));
// 仮応募の成功ページ（第15弾・2026-07-30）。応募した人だけが通る画面ので遅延読み込み
const ApplyPending = lazyChunk(() => import("./components/ApplyPending").then(m => ({ default: m.ApplyPending })));
// 新着の応募ページ（#/new-applicants・2026-08-05）。応募が届いた雇い手だけが通る面ので遅延読み込み
const NewApplicantsPage = lazyChunk(() => import("./components/NewApplicantsPage").then(m => ({ default: m.NewApplicantsPage })));
import { ChatList } from "./components/ChatList";
import { AdminErrorChatReporter } from "./components/AdminErrorChatReporter";
import { LoginScreen } from "./components/LoginScreen";
import { AccountHolderForm } from "./components/AccountHolderForm";
import PrivacyReconsent from "./components/PrivacyReconsent";
import { ProfileModal } from "./components/ProfileModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { JobSearchMapView } from "./components/JobSearchMapView";
const LandingFlow = lazyChunk(() => import("./features/jobs/create/LandingFlow").then(m => ({ default: m.LandingFlow })));
const AdminTab = lazyChunk(() => import("./components/admin/AdminTab").then(m => ({ default: m.AdminTab })));
const ConsignmentRoom = lazyChunk(() => import("./features/consignment/ConsignmentRoom").then(m => ({ default: m.ConsignmentRoom })));
const AdminBoxRegistryPage = lazyChunk(() => import("./components/admin/AdminBoxRegistryPage").then(m => ({ default: m.AdminBoxRegistryPage })));
const AdminWorkingRoom = lazyChunk(() => import("./components/admin/AdminWorkingRoom").then(m => ({ default: m.AdminWorkingRoom })));
const AdminUpcomingRoom = lazyChunk(() => import("./components/admin/AdminUpcomingRoom").then(m => ({ default: m.AdminUpcomingRoom })));
const AdminEvaluationRoom = lazyChunk(() => import("./components/admin/AdminEvaluationRoom").then(m => ({ default: m.AdminEvaluationRoom })));
const AdminSystemRoom = lazyChunk(() => import("./components/admin/AdminSystemRoom").then(m => ({ default: m.AdminSystemRoom })));
const AdminReviewCommentsRoom = lazyChunk(() => import("./components/admin/AdminReviewCommentsRoom").then(m => ({ default: m.AdminReviewCommentsRoom })));
const AdminReportsRoom = lazyChunk(() => import("./components/admin/AdminReportsRoom").then(m => ({ default: m.AdminReportsRoom })));
const AdminFarmerPagesRoom = lazyChunk(() => import("./components/admin/AdminFarmerPagesRoom").then(m => ({ default: m.AdminFarmerPagesRoom })));
const AdminAnimationsRoom = lazyChunk(() => import("./components/admin/AdminAnimationsRoom").then(m => ({ default: m.AdminAnimationsRoom })));
// プロフィールタブ（2026-07-27たきと指示「リロードを必要最低限に」）：農家ハブ・応募状況・
// プロフィール編集・カレンダーがぶら下がる大きな塊ので、開いた時に初めて読む＝起動のJSを軽くする
const ProfileHub = lazyChunk(() => import("./components/ProfileHub").then(m => ({ default: m.ProfileHub })));
import { CSS } from "./appStyles";
import { InsurancePrepPage, VisitEntrance, VisitorQRPage } from "./components/VisitAndInsurance";
import { WorkerExperiencePage } from "./components/WorkerExperiencePage";

import { syncAppBadge, closeReadNotifications } from "./lib/push";
import { peekApplyReturn } from "./lib/applyReturn";
import { armLoginReturn, takeLoginReturn } from "./lib/loginReturn";
import { snapGet, snapSet, clearSnapshots } from "./lib/snapshot";
import { getCache, setCache, clearCache } from "./lib/viewCache";

import Terms, { TERMS_ARTICLES, renderRichText } from "./Terms.jsx";

// 起動時に要らない問い合わせを後ろへ送る待ち行列（2026-08-18 Speed-1C-1）。アプリに1本。
// 1本ずつ流す（同じidle枠に2本入れない）。寿命はアプリと同じso cancel は呼ばない
const bootIdleQueue = createIdleQueue();








// ハンバーガーメニュー（PC）。項目の追加・削除はこの配列を編集するだけでよい。
// auth: true=ログイン時のみ / false=常時 / guestOnly: true=未ログイン時のみ
// 運営憲章・利用規約・プライバシーはフッター3列に常設のため☰からは削除（二重掲載の解消・2026-07-14）
const MENU_ITEMS = [
  { key:"chats",    label:<><NavIconInline name="chats" size={14} />チャット</>, hash:"/chats", auth:true },
  { key:"profile",  label:"マイページ",  hash:"/profile",  auth:true  },
  { key:"login",    label:"ログイン",      hash:"/login",    auth:false, guestOnly:true },
];

// モバイル下部バー：☰(左端・アイコンのみ)＋4機能タブ。
// ☰の中身：求人を探す・使い方・この画面を報告・お問い合わせ・管理・ログアウト
// （2026-08-19「求人を出す」を削除し「求人を探す」を新設／2026-08-22 お問い合わせを追加・たきと指示）。
// 下部ナビ＝取引の時系列（第12弾・2026-07-23）：さがす→カレンダー→チャット(③約束する)→マイページ
// アイコンは絵文字→アウトラインSVG（NavIcon・Airbnb風・2026-08-22たきと指示）。
// 訪問者ナビ（visitorNav）も同日に追従＝下部ナビの絵文字アイコンは全廃。
// ★2026-08-22：役割で分けていた2本のナビを1本に統合（切り替えはマイページだけ）。
// ★2026-08-23：農家ナビも【さがす・カレンダー・チャット・マイページ】の同じ4タブに統一
//   （旧「応募者」タブは廃止・応募者一覧はマイページの入口カードへ）。定義は下の navTabs 側。
// ★「今日」タブは下部バー・PC☰・農家ナビの3箇所から削除（2026-08-22たきと指示「今日ページを
//   下部ヘッダーから切り離して」）＝やることカード群をマイページ両面へ移した後の段。
//   ページ自体（#/calendar・用件の専用ページ #/calendar/todo/*）は生きている＝マイページの
//   やることの箱・お知らせ・メールのリンクから従来どおり到達する（TAB_URL_KEYSにcalendarを残置）。
//   NavIcons の today（時計）は使い手がゼロになったが、次の入口を作る時に使うので残す。
const MOBILE_TABS = [
  { k:"search",   icon:<NavIcon name="search" />,   label:"さがす" },
  // ラベルは「カレンダー」（2026-08-22たきと指示・旧「♡ステータス」2026-07-27）：
  // この面の上部にカレンダーが常時展開されているため（2026-08-19）。
  { k:"saved",    icon:<NavIcon name="calendar" />, label:"カレンダー" },
  { k:"chats",    icon:<NavIcon name="chats" />,    label:"チャット" },
  { k:"profile",  icon:<NavIcon name="profile" />,  label:"マイページ" },
];
// モバイル☰メニューの静的リンク項目（求人を探す・使い方・報告・ログアウトは動作が固有なので別途JSXで扱う）
const MOBILE_MENU_ITEMS = [
  { key:"admin",   label:<><NavIconInline name="gear" size={13} />管理</>,        hash:"/admin", auth:false, adminOnly:true },
  { key:"boxes",   label:<><NavIconInline name="folder" size={13} />ボックス一覧</>, hash:"/boxes", auth:false, adminOnly:true },
  { key:"qr",      label:<><NavIconInline name="idCard" size={13} />QRコード</>,    hash:"/qr",    auth:false, adminOnly:true },
];



// 農家データ（PINなし・メール認証のみ）
const SEED_FARMERS = [];
const SEED_DESTS = [];

// 役割カラー（第11弾・2026-07-22）：目印限定。働き手=橙／農家=緑。
// ブランド緑のCTA（応募・承認等の主ボタン＝--mode-accent）は両モード共通のまま不変。塗るのは「今どっちか」の目印だけ。



// ── エラー監視ユーティリティ → app/diagnostics/errorLog.js へ移設（2026-08-17）


// 真っ暗画面を止める最後の壁 AppErrorBoundary → app/AppErrorBoundary.jsx へ移設（2026-08-17）

async function sGet(k){try{const r=await window.storage.get(k,true);return r?JSON.parse(r.value):null;}catch{return null;}}
async function sSet(k,v){try{await window.storage.set(k,JSON.stringify(v),true);}catch{}};




// ── CSS ────────────────────────────────────────────────────
























// 今日がdateStart〜dateEnd（dateEndなければdateStart単日）の範囲内か。日付のみで比較（時刻無視）












// 15秒カード（プレビュー最上部・農家側応募者カードで共通利用）。値が無い項目は非表示
// onEditItem（任意）: 本人プレビュー用。渡すと各項目がタップ可能になり、対応する編集ボックスのキーを返す。
// 農家側（応募者カード等）は渡さない＝従来どおり表示専用



// 働き手・雇い手のプレビューシート → app/preview/PreviewSheets.jsx へ移設（2026-08-17）







// #/calendar の入口：「今日」ページ。
// 月カレンダー単独のページ(#/calendar/month)は廃止（2026-07-27たきと指示）＝カレンダーは
// 農家＝応募者ページ／働き手＝ステータスページ の上部に移植した。旧URLで来た人は「今日」に着地する
function CalendarRouter({ me, defaultRole }) {
  // 旧URL(#/calendar/month)で来たら#/calendarに正す＝アドレスバーと中身を食い違わせない
  useEffect(() => {
    if (window.location.hash.replace(/^#\/?/, "") === "calendar/month") window.location.hash = "/calendar";
  }, []);
  // TodayPage は用件の専用ページ（#/calendar/todo/{stage}）だけを描く（2026-08-22改造）。
  // #/calendar 単体（メールの「今日の仕事を見る」リンク・古いブックマーク）は
  // TodayPage 内のリダイレクトがマイページへ送る＝DBのメール6箇所はmigration不要
  return <TodayPage me={me} defaultRole={defaultRole} />;
}
























// プライバシーポリシー本文・データ台帳 → app/legal/PrivacyPolicy.jsx へ移設（2026-08-17）

// 自作データ憲法 DataConstitution → app/legal/DataConstitution.jsx へ移設（2026-08-17）


// ヘルプセンター（#/help）・アプリの入れ方（#/install） → app/help/HelpCenter.jsx へ移設（2026-08-17）
// 意見・要望（この画面を報告） → app/diagnostics/FeedbackModal.jsx へ移設（2026-08-17）

// ── ROOT ─────────────────────────────────────────────────────
export default function App(){
  // URL(#/タブ名)⇄tab の同期（リンク第1段）。有効タブ名のみ受け付ける
  const TAB_URL_KEYS = ["admin","boxes","search","work","profile","login","charter","privacy","terms","chats","saved","calendar","help","install","visit","qr","insurance","experience","new-applicants"];
  const readHashTab = () => { const h = window.location.hash.replace(/^#\/?/, ""); if (h.startsWith("chat/")) return "work"; if (h === "apply/done" || h.startsWith("apply/")) return "search"; if (h.startsWith("work/job/")) return "search"; if (h === "work" || h.startsWith("work/")) return "work"; if (h === "profile" || h.startsWith("profile/")) return "profile"; if (h === "admin/review" || h.startsWith("admin/review/")) return "admin"; if (h === "admin/consignment" || h.startsWith("admin/consignment/")) return "admin"; if (h === "admin/working" || h.startsWith("admin/working/")) return "admin"; if (h === "admin/upcoming" || h.startsWith("admin/upcoming/")) return "admin"; if (h === "admin/evaluation" || h.startsWith("admin/evaluation/")) return "admin"; if (h === "admin/system" || h.startsWith("admin/system/")) return "admin"; if (h === "admin/review-comments" || h.startsWith("admin/review-comments/")) return "admin"; if (h === "admin/reports" || h.startsWith("admin/reports/")) return "admin"; if (h === "admin/farmer-pages" || h.startsWith("admin/farmer-pages/")) return "admin"; if (h === "admin/animations" || h.startsWith("admin/animations/")) return "admin"; if (h === "boxes" || h.startsWith("boxes/")) return "boxes"; if (h === "help" || h.startsWith("help/")) return "help"; if (h === "calendar" || h.startsWith("calendar/")) return "calendar"; return TAB_URL_KEYS.includes(h) ? h : null; };
  // #/account（新規登録①）はタブ（部屋番号）を持たないため readHashTab は null を返す。
  // null＝「URLの指定なし＝既定の着地でよい」と読む箇所が3つあり（tab→URL同期・トップ着地・
  // セッション復元）、そのままだとリロードのたびに さがす や まもなく開始に奪われる。
  // 判定をここ1箇所に集約し、その3箇所で「奪わない」印として使う
  const isAccountHash = () => window.location.hash.replace(/^#\/?/, "") === "account";
  const initialHashTab = readHashTab(); // 起動した瞬間にURLでタブ指定があったか（同期useEffectが書き込む前の記録）
  const [tab,setTab]=useState(initialHashTab ?? "search");
  // 利用規約・プライバシーポリシーを開いたら必ず先頭から（2026-07-30たきと指示）。
  // どちらもフッター等ページの下の方から開くため、スクロール位置が残ると本文の途中に着地する。
  // 章リンク（#見出しへのscrollIntoView）は別動作ので、ここではページを開いた瞬間だけ先頭に戻す
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
    // 新規登録①(#/account)も保持する（2026-08-19）：部屋番号が無くtabは"search"のままなので、
    // 保持しないとマウント直後にここが #/search を書き、リロードで さがす に飛ばされる
    const _inFlow = _curHash === "account" || _curHash === "work/new" || _curHash.startsWith("work/new/") || _curHash.startsWith("work/edit/") || _curHash.startsWith("work/job/") || _curHash.startsWith("chat/") || _curHash.startsWith("emergency/") || _curHash.startsWith("apply/");
    // workタブ内サブタブ(drafts/active/applicants/expired)は、向かうタブもworkの時だけ保持
    const _subTabOfWork = (tab === "work") && (_curHash === "work/drafts" || _curHash === "work/active" || _curHash === "work/applicants" || _curHash === "work/expired");
    const _subTabOfProfile = (tab === "profile") && (_curHash === "profile/worker" || _curHash === "profile/worker/profile" || _curHash === "profile/worker/applying" || _curHash === "profile/worker/approved" || _curHash === "profile/worker/calendar" || _curHash === "profile/employer" || _curHash === "profile/employer/profile" || _curHash === "profile/employer/drafts" || _curHash === "profile/employer/active" || _curHash === "profile/employer/applicants" || _curHash === "profile/employer/expired" || _curHash === "profile/employer/calendar");
    // 審査ページの深いリンク(#/admin/review/{セクション} と #/admin/review/{job_number})を、tab同期で#/adminに巻き戻さないよう保持
    const _subTabOfAdmin = (tab === "admin") && (_curHash.startsWith("admin/review/") || _curHash === "admin/consignment" || _curHash.startsWith("admin/consignment/") || _curHash === "admin/working" || _curHash.startsWith("admin/working/") || _curHash === "admin/upcoming" || _curHash.startsWith("admin/upcoming/") || _curHash === "admin/evaluation" || _curHash.startsWith("admin/evaluation/") || _curHash === "admin/system" || _curHash.startsWith("admin/system/") || _curHash === "admin/review-comments" || _curHash.startsWith("admin/review-comments/") || _curHash === "admin/reports" || _curHash.startsWith("admin/reports/") || _curHash === "admin/farmer-pages" || _curHash.startsWith("admin/farmer-pages/") || _curHash === "admin/animations" || _curHash.startsWith("admin/animations/"));
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
  // 訪問者の同意ゲート（2026-07-24〜2026-08-17）は撤去した（たきと指示「利用者になる最大の障壁ので削除」）。
  // 以後、訪問者はどの入口（QR・検索・直リンク）からでも、同意画面を挟まずそのままページに着く。
  // ・恒久URL #/visit は従来どおり生きている（QRの焼き込み・CLAUDE.md 2026-07-24）。
  //   玄関の意味＝「訪問者が求人を見に来る入口」も不変で、中身が素通り（#/search へ送る）になっただけ。
  // ・規約・プラポリへの導線はフッター（常設3列）に残る。同意の記録が要るのは会員登録の時＝
  //   AccountHolderForm が agreed_terms_version / agreed_privacy_version を保存する（従来どおり不変）。
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
  // 雇い手の面を持っているか（capability・2026-08-22たきと指示「切り替えはマイページだけに限定」）。
  // ★モード（empCtx）とは別物：これは「持っているか」so、働き手モードに切り替えても変わらない＝
  //   下部ナビの行き先が切り替えで変わらない（カレンダーで自分の求人カードが消える件の根治）。
  //   初期値はマイページが書くキャッシュ（ProfileHubのhub:hasEmp）から。falseには倒さない（ちらつき防止）
  const [hasEmp,setHasEmp]=useState(() => getCache("hub:hasEmp") ?? false);
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
  // 応募者バッジは navBadges.applicants_pending（未対応の応募＝跳ねるアイコンと同数）に一本化（2026-07-26）。
  // 旧・独自の status='applied' 件数カウントは廃止＝バッジとアイコンで数が食い違う原因だった。
  // ★表示場所は旧「応募者」ナビタブ→マイページ農家面の「応募者一覧」入口カードへ移植
  //   （2026-08-23・ProfileHub→FarmerDashboard に applicantsBadge としてprop渡し）

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
        if (!cancelled && ep) { setHasEmp(true); setCache("hub:hasEmp", true); }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [me?.id, empCtx]);
  // 行動計測：ページ遷移ロガー（page_eventsへfire-and-forget）。記録するのは2経路だけ：
  // ①運営者本人（自己デバッグ・従来どおり）②未ログインの訪問者（流入元src＋端末ごとの匿名キーanon_key
  //   ＝?src=insta 等の流入計測。2026-08-22たきと指示）。ログイン済みの一般利用者は従来どおり記録しない
  //   （データ憲法・2026-07-27）。DB側のRLSも二重の壁＝管理者本人INSERTと「auth_id=null＋anon_key必須」の
  //   匿名INSERTだけを通し、読み取りは従来どおり管理者のみ（20260822023935）
  useEffect(() => { getTrafficSrc(); }, []); // ?src= は初回ロードで必ず拾って控える（記録経路が無いログイン中でも保存だけ残す）
  const lastLoggedHashRef = useRef(null);
  useEffect(() => {
    const adminSelf = !!(me?.id && isAdmin(me));
    if (me && !adminSelf) return; // ログイン済みの一般利用者は記録しない
    // 起動バーストから外して後送り（2026-08-18 Speed-1C-1）。
    // ★記録する値は【発生した瞬間】に確定して持つ。実行時に window.location.hash を読み直すと、
    //   待っている間に利用者が別画面へ移っていて計測が嘘になる
    // ★保留中に次の遷移が起きたら、保留分を先に流してから新しい分を送る＝DBで前後が入れ替わらない
    let pending = null;
    const insertRow = (row) => supabase.from("page_events").insert(row).then(() => {}, () => {});
    const send = adminSelf
      ? insertRow
      : (row) => supabase.auth.getSession().then(({ data }) => {
          // 匿名行は「本当に未ログインの端末」だけ：セッション復元が終わる前にこの経路が走った時は
          // ここで落とし、ハッシュの控えも戻す＝me確定後の管理者経路が同じページを取りこぼさない
          if (data?.session) { lastLoggedHashRef.current = null; return; }
          return insertRow(row);
        }, () => {});
    // ★必ずPromiseを返す（2026-08-18 C1.1）。返さないと待ち行列から見て即終了になり、
    //   DBへの挿入が通信中でも次のidle taskへ進んでしまう＝「1本終わってから次」が崩れる
    const flushPending = () => {
      if (!pending) return Promise.resolve();
      const row = pending;
      pending = null;
      return send(row);
    };
    const logPageEvent = ({ defer = false } = {}) => {
      const h = window.location.hash || "#/";
      if (h === lastLoggedHashRef.current) return; // 連続同一hashはskip
      const src = getTrafficSrc();
      const row = adminSelf
        ? { auth_id: me.id, page_hash: h, ...(src ? { src } : {}) } // ここで値を固定する
        : { page_hash: h, anon_key: getAnonKey(), ...(src ? { src } : {}) };
      if (!adminSelf && !row.anon_key) return; // 匿名キーを保存できない端末（プライベートモード等）は記録しない
      lastLoggedHashRef.current = h;
      // ★保留分の完了を待ってから次を送る（2026-08-18 C1.1）。並行に撃つとDB上で前後が入れ替わる
      if (!defer) { void flushPending().then(() => send(row)); return; }
      pending = row;
      bootIdleQueue.push(flushPending);
    };
    logPageEvent({ defer: true }); // 起動の1件目だけ後送り
    const onHashLog = () => logPageEvent();
    window.addEventListener("hashchange", onHashLog);
    return () => { window.removeEventListener("hashchange", onHashLog); flushPending(); };
  }, [me?.id]);
  const [needsAccountHolder,setNeedsAccountHolder]=useState(false); // account_holders未登録なら新規登録①を最優先オーバーレイ表示
  const [needsPrivacyReconsent,setNeedsPrivacyReconsent]=useState(false); // プラポリの版が古ければ再同意画面（2026-08-19）
  // 訪問者の「登録が必要です」案内をボックス化（2026-07-27たきと指示）。どの画面からでも openLoginBox() で開く
  const [loginBox, setLoginBox] = useState(false);
  // 下スワイプで閉じる（指に連動・応募者ページのボックスと同じ規則・2026-08-19）
  const loginSheetRef = useRef(null), loginScrollRef = useRef(null);
  useSheetDragClose(loginSheetRef, loginScrollRef, ()=>setLoginBox(false), loginBox);
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
  // #/account 直打ち用(URL由来の任意入口・needsAccountHolderとは別系統)。
  // 初期値をhashから同期的に決める＝リロードで さがす が一瞬見えてから切り替わるのを防ぐ
  // （求人フローの showJobPost と同じ作法）。未ログインなら下のeffectが #/login へ送る
  const [openAccountForm,setOpenAccountForm]=useState(() => isAccountHash());
  const [showLanding,setShowLanding]=useState(false);
  const [showJobPost,setShowJobPost]=useState(()=>{ const h=window.location.hash.replace(/^#\/?/,""); return h==="work/new"||h.startsWith("work/new/")||h.startsWith("work/edit/"); });
  // 求人フローの「戻る」（保存せずに終了）の行き先＝フローに入る直前の画面。onHashで控える（下記）
  const flowBackToRef = useRef("/profile/employer");
  const [consignRoom,setConsignRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/consignment"); } catch { return false; } }); // 委託準備室（#/admin/consignment・管理者専用・2026-07-19。/profile 等のサブページ含む）
  const [workingRoom,setWorkingRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/working"); } catch { return false; } }); // 仕事中専用ページ（#/admin/working・管理者専用・2026-08-01）
  const [upcomingRoom,setUpcomingRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/upcoming"); } catch { return false; } }); // まもなく開始ページ（#/admin/upcoming・管理者専用・2026-08-01）
  const [evalRoom,setEvalRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/evaluation"); } catch { return false; } }); // 客観的評価ページ（#/admin/evaluation・管理者専用・2026-08-05）
  const [systemRoom,setSystemRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/system"); } catch { return false; } }); // システムページ（#/admin/system・管理者専用・2026-08-03）
  const [animationsRoom,setAnimationsRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/animations"); } catch { return false; } }); // アニメーションページ（#/admin/animations・管理者専用・2026-08-07）
  const [commentRoom,setCommentRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/review-comments"); } catch { return false; } }); // 評価コメント審査（#/admin/review-comments・管理者専用・2026-08-07）
  const [reportsRoom,setReportsRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/reports"); } catch { return false; } }); // 統合報告ページ（#/admin/reports・管理者専用・2026-08-15）
  const [farmerPagesRoom,setFarmerPagesRoom]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"").startsWith("admin/farmer-pages"); } catch { return false; } }); // 農家のアクションページ（#/admin/farmer-pages・管理者専用・見本帳・2026-08-11）
  const [showApplyDone,setShowApplyDone]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/done");
  // 仮応募の成功ページ（#/apply/pending・第15弾・2026-07-30）。応募系の全画面ページは
  // applyPage 1変数にまとめる＝各タブの描画式に付けるガードが1つで済む（オーバーレイ描画の鉄則）
  const [showApplyPending,setShowApplyPending]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/pending");
  const applyPage = showApplyDone ? "done" : showApplyPending ? "pending" : null;
  const [applyAlready,setApplyAlready]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/done" && sessionStorage.getItem("cb_applyAlready")==="1");
  // 応募完了の祝祭（2026-08-06・赤ちゃん前提の第0歩）：apply/doneに新規到着した時だけ1回。
  // 応募済み（already）の再訪では祝わない。演出のみ＝記録・フローには触れない
  const [applyBurst,setApplyBurst]=useState(()=>window.location.hash.replace(/^#\/?/,"")==="apply/done" && sessionStorage.getItem("cb_applyAlready")!=="1");
  // 求人の掲載完了は「ページ」でなくアニメーション（祝祭）に（2026-08-07たきと指示）。
  // 祝祭が消えたあと、60秒ノーアクションなら さがす へ自動遷移（何かタップ/操作すれば取り消す）。
  const [pubCelebrate,setPubCelebrate]=useState(null); // { open:bool } | null（3秒の祝祭）
  const [pubIdle,setPubIdle]=useState(false);          // 60秒アイドル→/search の見張り
  const [pubChoice,setPubChoice]=useState(null);       // 祝祭後の選択カード { open, jobNumber } | null（60秒で自動的に消える）
  // 応募完了も「ページ」でなくアニメーション化（2026-08-07たきと指示・①）。祝祭＋法的一言トースト＋
  // 応募状況に着地＋60秒ノーアクションで さがす。法的一文（まだ採用でない・当事者間契約）は消さずトーストで残す。
  const [applyNote,setApplyNote]=useState(false); // 着地先で1回だけ出す法的一言トースト
  const [applyIdle,setApplyIdle]=useState(false); // 60秒アイドル→/search の見張り（①応募完了・②仮応募で共用）
  // 仮応募の直後も同じ型でアニメーション化（2026-08-07たきと指示・②）。ただしハイブリッド＝
  // 新規の仮応募（JobSearchMapViewがcb_pendingNewを立てて遷移）だけ祝祭＋トースト＋応募状況へ着地し、
  // 再訪（応募状況「プロフィールを仕上げる→」・求人詳細の応募ボタン）は従来どおり ApplyPending の
  // チェックリスト（残り項目のタップ入力・昇格ボタン）を出す＝あの導線の受け皿は消さない
  const [pendBurst,setPendBurst]=useState(false); // 仮応募の祝祭（✅・新規到着だけ1回）
  const [pendNote,setPendNote]=useState(false);   // 仮応募の案内トースト（届くのはプロフィール完成後＝正直さの明示）
  // 働き手フロー完了（LandingFlow step8）もアニメーション化（2026-08-07たきと指示・③）。
  // ※このフローの本番導線は現在無し（setRole("worker")は管理タブdevJump「働3」等のみ）＝実質プレースホルダーの整理。
  // 旧ページの3ボタンの置き換え＝主役「実証に参加する」→ログインへ着地／「公開データを見る」→60秒アイドルのさがす行き
  const [workerFlowBurst,setWorkerFlowBurst]=useState(false); // 祝祭（✅ありがとうございます）
  const [workerFlowNote,setWorkerFlowNote]=useState(false);   // 案内トースト（構想段階の明示＝職安法配慮を消さない）
  // apply/done に来たら：完了ページを出さず、応募状況（/profile/worker/applying）へ着地させ、
  // 祝祭（applyBurst・既存）＋法的トースト＋アイドル見張りを起動する。promotedCount/applyAlready/applyBurst は
  // hashハンドラが先に設定済み（この効果はそれらの設定後に走る）。
  useEffect(() => {
    if (!showApplyDone) return;
    setApplyNote(true);
    setApplyIdle(true);
    window.location.hash = "/profile/worker/applying";
  }, [showApplyDone]);
  // ボックスの出現アニメ中の「すり抜けタップ」で閉じない（2026-08-18たきと指示「一括修理しろ」）。
  // 【原因】.cb-sheet-up は cbPopGate で最初の0.8秒 pointer-events:none になる（アニメ中は中身が
  // 動いていて狙った位置と当たる要素がずれるため・2026-07-27の日程チップ修理）。pointer-events は
  // 【子に継承される】ので、その0.8秒の間のタップはボックスを丸ごとすり抜けて黒幕(.cb-box-overlay)に
  // 当たり、黒幕の onClick（＝閉じる）が走っていた。利用者には「押したのに閉じた」と見える。
  // 【修理】黒幕そのものが叩かれた瞬間に、中のボックスがまだ押せない状態なら、そのクリックを捨てる。
  // captureで document に置くので、React（listenerは document.body 側）へ届く前に止まる＝
  // 各オーバーレイ（53箇所・23ファイル）のコードは1行も触らずに全部に効く。
  // 判定は「実際に押せない状態か」をブラウザに聞く（computed pointer-events）＝アニメ長を写経しない。
  // 本物の黒幕タップ（閉じる意図）が捨てられるのはアニメ中だけ＝もう一度タップすれば閉じる。
  useEffect(() => {
    const swallowPopThrough = (e) => {
      const t = e.target;
      if (!t || typeof t.classList?.contains !== "function") return;
      if (!t.classList.contains("cb-box-overlay")) return; // 黒幕への直撃だけを見る（中身のタップは無関係）
      const sheet = t.querySelector(".cb-sheet-up");        // ゲートを持つのはこのクラスだけ
      if (!sheet) return;
      try { if (getComputedStyle(sheet).pointerEvents !== "none") return; } catch { return; }
      e.stopPropagation(); e.preventDefault();
    };
    document.addEventListener("click", swallowPopThrough, true);
    return () => document.removeEventListener("click", swallowPopThrough, true);
  }, []);
  // 全ボタン共通のタップの手応え（振動のみ・無音・iOSでは静かに無視される）。
  // 「押せた」の証拠＝文字が読めない利用者への最小のフィードバック（2026-08-06）
  useEffect(() => {
    const h = (e) => { try { unlockAudio(); if (e.target?.closest?.("button, a, [role='button']")) fbTap(); } catch {} };
    // pointerdown＝指が触れた最初の瞬間（clickより早く・確実にユーザー操作の同期文脈）でも解錠する
    document.addEventListener("pointerdown", unlockAudio, true);
    document.addEventListener("click", h, true);
    return () => { document.removeEventListener("pointerdown", unlockAudio, true); document.removeEventListener("click", h, true); };
  }, []);
  // iOS（WebKit）の fixed 置き去りバグの自己修復（2026-08-22たきと報告「下部バーが画面中央に・
  // スクロールに追従しない・全ページ」）。中身と発火の節目は lib/fixedRepin.js に集約
  useEffect(() => installFixedRepin(), []);
  // 仮応募からの昇格件数（プロフィール保存の直後に promote_my_pending_applications が返した数）
  const [promotedCount,setPromotedCount]=useState(()=>{ try { return window.location.hash.replace(/^#\/?/,"")==="apply/done" ? Number(sessionStorage.getItem("cb_promoted") || 0) : 0; } catch { return 0; } });
  const [chatAppId,setChatAppId]=useState(()=>{ const m=window.location.hash.replace(/^#\/?/,"").match(/^chat\/(admin|[0-9a-f-]+)$/); return m?m[1]:null; });

  // ↓ここに置く理由：この中で使う state（openAccountForm・showJobPost 等）の宣言より後ろでないと
  //   宣言前参照になる（no-use-before-define。2026-07-29に並べ替え・中身は不変）
  useEffect(() => {
    const onHash = () => {
      const rawHash = window.location.hash.replace(/^#\/?/, "");
      const _em = rawHash.match(/^emergency\/([0-9a-fA-F-]+)$/);
      if (_em) { resolveEmergencyLink(_em[1]); return; }
      // 現在モード（雇い手/働き手）はempCtxに集約（同一ソース・二重状態を作らない）。プロフィールの側に入った時だけ
      // 更新し、共通タブ（カレンダー/チャット等）へ移っても保持（sticky・localStorage永続）。下部ナビの役割追従もこれを見る
      // ★モードが変わるのはマイページの入口・編集だけ（2026-08-22たきと指示「切り替えはマイページだけに限定」）。
      //   雇い手の他のサブページ（カレンダー・応募者・求人一覧）はモードを動かさない＝
      //   下部ナビのカレンダーを押しただけで農家モードに化ける、が起きない
      if (rawHash === "profile/employer" || rawHash.startsWith("profile/employer/profile")) { setEmpCtx(true); try { localStorage.setItem("cb_empCtx","1"); } catch {} }
      else if (rawHash === "profile" || rawHash.startsWith("profile/worker")) { setEmpCtx(false); try { localStorage.setItem("cb_empCtx","0"); } catch {} }
      // 求人フローを閉じた時の戻り先（2026-08-19たきと指示「前回の画面に保存せずに強制遷移」）。
      // フロー以外のハッシュを通るたびに控える＝フローに入る直前に見ていた画面。
      // 直リンク・リロードでフローから始まった場合は控えがないので既定（雇い手プロフィール）に倒す
      if (rawHash && !rawHash.startsWith("work/new") && !rawHash.startsWith("work/edit/")) flowBackToRef.current = "/" + rawHash;
      if (rawHash === "work/new" || rawHash.startsWith("work/new/") || rawHash.startsWith("work/edit/")) { setShowJobPost(true); setTab("profile"); return; }
      if (!rawHash.startsWith("work/new") && !rawHash.startsWith("work/edit/")) { setShowJobPost(prev => prev ? false : prev); }
      setShowApplyDone(rawHash === "apply/done");
      // 仮応募の新規到着（②・2026-08-07）：チェックリストページを出さず、祝祭＋トースト＋応募状況へ。
      // フラグ無しの到着（再訪）は従来どおりページを出す（ハイブリッド）
      let _pendNew = false;
      try { _pendNew = rawHash === "apply/pending" && sessionStorage.getItem("cb_pendingNew") === "1"; } catch {}
      if (_pendNew) {
        try { sessionStorage.removeItem("cb_pendingNew"); } catch {}
        setShowApplyPending(false);
        setPendBurst(true); setPendNote(true); setApplyIdle(true);
        window.location.hash = "/profile/worker/applying";
      } else {
        setShowApplyPending(rawHash === "apply/pending");
      }
      setConsignRoom(rawHash.startsWith("admin/consignment"));
      setWorkingRoom(rawHash.startsWith("admin/working"));
      setUpcomingRoom(rawHash.startsWith("admin/upcoming"));
      setEvalRoom(rawHash.startsWith("admin/evaluation"));
      setSystemRoom(rawHash.startsWith("admin/system"));
      setAnimationsRoom(rawHash.startsWith("admin/animations"));
      setCommentRoom(rawHash.startsWith("admin/review-comments"));
      setReportsRoom(rawHash.startsWith("admin/reports"));
      setFarmerPagesRoom(rawHash.startsWith("admin/farmer-pages"));
      if (rawHash === "apply/done") {
        try {
          const already = sessionStorage.getItem("cb_applyAlready")==="1";
          setApplyAlready(already); sessionStorage.removeItem("cb_applyAlready");
          setApplyBurst(!already); // 新しい応募の到着だけ祝う（2026-08-06）
        } catch {}
        try { setPromotedCount(Number(sessionStorage.getItem("cb_promoted") || 0)); sessionStorage.removeItem("cb_promoted"); } catch {}
      }
      const _cm = rawHash.match(/^chat\/(admin|[0-9a-f-]+)$/);
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
    // #/account は「指定なし」ではなく行き先の指定（新規登録①）ので着地を奪わない（2026-08-19）
    if (topLandingChecked.current || !me || initialHashTab !== null || isAccountHash()) return;
    topLandingChecked.current = true;
    // RPCが返るまでの数秒間にユーザーが別ページへ移動していたら着地させない（2026-08-02）：
    // 「開いた時の着地」であって、操作中の引き戻しはしない。判定は今のhashで行う
    const stillOnDefault = () => { if (isAccountHash()) return false; const t = readHashTab(); return t === null || t === "search"; };
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
    if(!me?.id){ setNeedsAccountHolder(false); setNeedsPrivacyReconsent(false); return; }
    let cancelled=false;
    // 通信エラー＝「未登録」と断定しない（2026-07-27修正：+testで登録済みアカウントに新規登録①が
    // 出た誤爆。ログイン直後はトークン切替等でクエリが一時失敗しうる）。エラー時はゲートを
    // 動かさず3秒後に1回だけ再確認。判定が確定した時（error無し）だけsetする＝getSession誤認と同じ型
    const check = async (retryLeft)=>{
      const { data, error } = await supabase.from('account_holders').select('id,agreed_privacy_version').eq('auth_id', me.id).maybeSingle();
      if(cancelled) return;
      if(error){ if(retryLeft > 0) setTimeout(()=>{ if(!cancelled) check(retryLeft - 1); }, 3000); return; }
      setNeedsAccountHolder(!data);
      // プラポリ再同意ゲート（2026-08-19）：登録済みの人だけが対象。未登録は新規登録①が現行版を書くので出さない。
      // 同じ版に揃うまで、DB側の contract_emergency_contact も緊急連絡先を相手方へ返さない
      setNeedsPrivacyReconsent(!!data && data.agreed_privacy_version !== PRIVACY_VERSION);
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
  // ☰メニューはスクロールで閉じる（2026-08-22たきと報告「展開したままスクロールされる」）。
  // ☰の浮遊ボタン自体はcb-scroll-hideで下へ格納されるのに、開いた一覧だけ画面に残っていた。
  // ★captureで拾う＝scrollはバブルしないので、ページ本体でも内側のスクロール領域でも閉じる。
  //   ただしメニュー自身（max-heightで内側スクロールしうる）から出たスクロールでは閉じない。
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onScroll = (e) => {
      const t = e.target;
      if (t && t.closest && t.closest(".app-header-mobile-menu")) return;
      setMobileMenuOpen(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
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
        ov.textContent = "更新しています…";
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
    let heartTimer = null;
    const onScroll = () => {
      // いいねハートのぷるんぷるん（2026-08-07たきと指示）：縦スクロール中だけ body.cb-scrolling を
      // 立て、CSS（appStyles .cb-like-heart）が震わせる。止まって220ms後に外す（振幅は小ので途中で
      // 切れてもスナップが目立たない）。既存のスクロール監視に相乗り＝リスナーを増やさない
      document.body.classList.add('cb-scrolling');
      if (heartTimer) clearTimeout(heartTimer);
      heartTimer = setTimeout(() => document.body.classList.remove('cb-scrolling'), 220);
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
      if (heartTimer) clearTimeout(heartTimer);
      document.body.classList.remove('cb-scrolling');
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
    // dests×2・records（旧事業データ）は管理タブ・プロフィールモーダルでしか使わないので起動から外し、
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
  // 管理タブ／プロフィールモーダルを開いた時に1回だけ読む。閉じても保持ので再取得はしない
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
  // 起動バーストから外して後送り（2026-08-18 Speed-1C-1）：startup と after_login は
  // 起動のたびに admin_notice_registry を1本ずつ撃つ（管理者は2本）。お知らせのポップアップは
  // 初期表示の成立条件ではないso、暇な時に1本ずつ流す。★login と confirm は即時のまま
  // （利用者の操作に対する通知を遅らせない）。★2本を1問い合わせに統合はしない＝意味保存を優先
  useEffect(() => { bootIdleQueue.push(() => showNoticesFor("startup")); }, [me?.id]); // ログインで農家/働き手向けの未読が増えることがあるため再判定
  useEffect(() => { if (tab === "login") showNoticesFor("login"); }, [tab]); // ログインをタップ＝ログイン画面を開いた瞬間に展開（即時）
  useEffect(() => { if (me?.id) bootIdleQueue.push(() => showNoticesFor("after_login")); }, [me?.id]); // ログイン後（ログイン完了・ログイン済みの起動を含む）
  useEffect(() => { // 確認ページ（trigger=confirm）：LandingFlowが「農家プロ未入力で確認ページ到達」を検知してこのイベントを飛ばす
    const f = () => showNoticesFor("confirm");
    window.addEventListener("cb:confirmNotice", f);
    return () => window.removeEventListener("cb:confirmNotice", f);
  }, [me?.id]);
  // ── Realtimeの購読開始を、重要な初回取得の後ろへ送る（2026-08-18 Speed-1C 起動衝突テスト）──
  // 冷間起動の実測で、Realtimeテナントの起動（CheckConnection 2.9秒・レプリケーションスロット作成）と
  // PostgRESTの再接続・スキーマキャッシュ再構築（3.0秒＋1.1秒）が同じ数秒に重なっていた。
  // 起動直後にWebSocketを張ると、この作り直しをRESTと奪い合う。so購読開始だけを後ろへ送る。
  // ★RESTの初回チェックは今までどおり即時（バッジ・お祝いボックスの判定は遅らせない）。
  // ★購読が始まった時点で各effectが再実行され、check/refresh→subscribe の順に走る＝
  //   購読していなかった間の取りこぼしがcatch-upとして自然に埋まる。
  // ★固定の秒数では待たない：さがすの初回取得がsettleした合図（cb:criticalBootSettled）で開ける。
  const [realtimeBootReady, setRealtimeBootReady] = useState(false);
  useEffect(() => {
    if (realtimeBootReady) return;
    const open = () => setRealtimeBootReady(true);
    window.addEventListener("cb:criticalBootSettled", open);
    // ★逃げ道：さがす以外の画面に着地した起動ではJobSearchMapViewがマウントされず合図が来ない。
    //   その時にRealtimeが永久に始まらないことのないよう、暇になった時点（最長2秒）で開ける。
    //   ★さがすが立ち上がる起動では予約しない（2026-08-18 C1.3）：予約すると、jobs_publicの完了より
    //     先に逃げ道が開いてRealtimeが元の競合区間へ戻る＝この施策自体を打ち消す。
    //   ★どのURLでさがすが立ち上がるかは既存ルーティング（readHashTab）を正とする。
    //     work/job/… や apply/… はreadHashTabがsearchへ解決する。hash無し(null)も既定＝さがす
    //     （664行の stillOnDefault と同じ判定）。ここでURL一覧を手書きしない
    const t = readHashTab();
    const searchWillMount = t === null || t === "search";
    let idleId = null, timerId = null;
    if (!searchWillMount) {
      if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(open, { timeout: 2000 });
      else timerId = window.setTimeout(open, 2000);
    }
    return () => {
      window.removeEventListener("cb:criticalBootSettled", open);
      if (idleId !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleId);
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [realtimeBootReady]); // eslint-disable-line react-hooks/exhaustive-deps -- readHashTabは毎描画で作り直される。依存に入れると描画ごとに逃げ道を取り消して予約し直す

  // チャット未読通知（2026-07-17）：下部バー「チャット」に未読合計（当事者チャット＋運営DM）の赤バッジ。
  // 再計算のタイミング＝起動・ページ遷移(hashchange)・チャット/運営DMを開いて既読化した時(cb:unreadRefresh)
  const [chatUnread, setChatUnread] = useState(0);
  const [msgToast, setMsgToast] = useState(null); // アプリ内トースト（新着メッセージ・2026-07-19）：{title, text, hash}
  const msgToastTimer = useRef(null);
  useEffect(() => {
    if (!me?.id) { setChatUnread(0); return; }
    const refresh = async () => {
      try {
        const { data } = await supabase.rpc("my_unread_message_counts");
        if (data) {
          const total = (data.chat || 0) + (data.dm || 0);
          setChatUnread(total);
          // 未読が0＝もう読んだ、なので残っている通知を消す（2026-08-18・LINEと同じ設計）。
          // 別の端末で読んだ場合の後始末はここが担う（この端末がアプリを開いた時に消える）。
          // ★初期値の0では消さない＝実際に数えた結果が0の時だけ（起動直後に本物の通知を消さない）
          if (total === 0) closeReadNotifications();
        }
      } catch {}
    };
    // 新着でアプリ内トースト表示。2026-08-18たきと裁定で「誰から・どんな内容か」を出す形に変更
    // （従来は内容を出さない＝「新しいメッセージが届きました」のみ・2026-07-19 B案）。
    // プッシュ通知と同じ見え方に揃える＝題名が相手の表示名、下に本文の冒頭。
    // 自分の送信分・今まさに開いているチャットは出さない
    const showToast = (hash, title, text) => {
      const cur = window.location.hash.replace(/^#\/?/, "");
      if (hash === "/chat/admin" && cur === "chats") return; // 運営DM：一覧に行と未読が出ているので二重に出さない
      if (hash.startsWith("/chat/") && cur === hash.replace(/^#?\/?/, "").replace(/^\//, "")) return;
      if (hash.startsWith("/chat/") && cur.startsWith("chat/")) return; // チャットを開いている間は出さない
      setMsgToast({ title: title || "新しいメッセージ", text, hash });
      if (msgToastTimer.current) clearTimeout(msgToastTimer.current);
      msgToastTimer.current = setTimeout(() => setMsgToast(null), 5000);
    };
    // 相手の表示名は、チャット一覧が持っている骨（応募IDごとの相手名）から引く＝この通知のために通信しない。
    // 一覧をまだ一度も開いていない端末では引けないので、その時は名前なしで本文だけ出す
    const partnerNameOf = (appId) => {
      try {
        const c = hydrateChatCache() || chatCache.v;
        const row = (c?.rows || []).find(r => r.id === appId);
        return (row?.partnerName || "").trim();
      } catch { return ""; }
    };
    const onMsg = (payload) => {
      refresh();
      const m = payload?.new;
      if (!m || m.sender_id === me.id) return;
      showToast("/chat/" + m.application_id, partnerNameOf(m.application_id), msgSnippet(m.body));
    };
    const onDm = (payload) => {
      refresh();
      const m = payload?.new;
      if (!m || !m.from_admin) return;
      showToast("/chat/admin", "運営", msgSnippet(m.body)); // 運営チャットのページへ（2026-08-24）
    };
    // ナビバッジと同じ理由で遷移時は20秒スロットル（2026-07-27）。新着はRealtime、既読はcb:unreadRefreshが即反映
    let lastAt = 0;
    const refreshOnNav = () => { const now = Date.now(); if (now - lastAt < 20000) return; lastAt = now; refresh(); };
    refresh(); lastAt = Date.now();
    window.addEventListener("hashchange", refreshOnNav);
    window.addEventListener("cb:unreadRefresh", refresh);
    // リアルタイム（2026-07-19）：自分宛メッセージのINSERTを購読し、バッジ即時更新＋トースト。
    // 配信はRLS準拠＝自分が当事者のchat/自分宛DMしか届かない
    // 購読開始は重要な初回取得の後ろ（2026-08-18 Speed-1C 起動衝突テスト）。上のrefresh()は即時のまま
    const ch = realtimeBootReady ? supabase.channel("unread-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onMsg)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, onDm)
      .subscribe() : null;
    return () => { window.removeEventListener("hashchange", refreshOnNav); window.removeEventListener("cb:unreadRefresh", refresh); if (ch) supabase.removeChannel(ch); };
  }, [me?.id, realtimeBootReady]);
  // 画面の復帰で再取得の合図を出す（2026-08-18 Speed-1B／1B.1で二重発火を除去）。
  // バックグラウンドに置いている間はRealtimeのWebSocketが凍結・切断され、イベントを取りこぼす
  // （iOS PWAで顕著。チャットが2026-07-27に同じ理由で復帰再読込を入れている）。
  // 戻ってきた時に一度だけ合図を出せば、開いている画面が既存の窓口から取り直して整合性が戻る。
  // 出すのは合図だけ＝閉じている画面のために通信はしない（受け手はマウント中の画面のみ）。
  //
  // ★1回の復帰につき1回だけ（時間デバウンスではなく状態で数える）：
  // ブラウザは通常の復帰で visibilitychange → focus を続けて出すため、素直に両方で合図を出すと
  // 「即時fetch＋冷却後の後追いfetch」＝1回の復帰で2波になる（refreshBusは先頭1回＋後追い1回so）。
  // wakeSent を復帰サイクルの旗にして、離れた時（hidden / blur）にだけ倒す。
  // 　hidden → visible → focus ＝ 1回（focusは抑止）／ blur → focus ＝ 1回
  // マウント時に見えていれば旗は立てておく＝起動直後のfocusで起動時fetchと二重にしない
  useEffect(() => {
    let wakeSent = document.visibilityState === "visible";
    const emitWake = () => {
      if (document.visibilityState !== "visible" || wakeSent) return;
      wakeSent = true;
      emitRefresh([REFRESH_APPLICATIONS, REFRESH_JOBS], "wake");
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") emitWake();
      else wakeSent = false;
    };
    const onBlur = () => { wakeSent = false; };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", emitWake);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", emitWake);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  // 開きっぱなしの画面にも新しい掲載を届ける（2026-08-19）。
  // 【契機】ある農家thaが14:32に求人を公開したのに、開いていた画面に出てこなかった。DB側は正常
  // （jobs_public に anon・ログインとも出ていた・公開の通知も全部出ていた）＝取り直す合図thaが無かった。
  // 【なぜ穴thaが空いたか】jobs にはRealtimeを繋げない（jobsのRLSは本人と運営だけso、publicationに
  //   足しても他人の求人の変更は誰にも届かない）。so 合図は「アプリに戻った時」の1本だけで、
  //   画面を開いたままにしていると永久に取り直さなかった（2026-08-18 Speed-1B に残した既知の穴）。
  // 【対処】見えている間だけ、定期的に取り直しの合図を出す。合図を出すだけ＝閉じている画面のためには
  //   通信しない（受け手はマウント中の画面のみ）。隠れている間は refreshBus thaが保留し、復帰時に1回にまとめる。
  //   取り直しの実費は小さい（jobs_public 全件で約12KB・my_farm_jobs 約10KB/46ms の実測）。
  //   ★間隔を変えるならこの1箇所（JOBS_POLL_MS）。applications は Realtime thaがあるso対象にしない
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") emitRefresh(REFRESH_JOBS, "poll");
    }, JOBS_POLL_MS);
    return () => clearInterval(id);
  }, []);
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
          fetchJobRowForMe(fresh.job_number, "job_number,crop,task"),
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
    check(); // 初回チェックは即時（2026-08-18 Speed-1C）。購読だけを重要な初回取得の後ろへ送る
    const ch = realtimeBootReady ? supabase.channel("hired-watch")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "applications", filter: "worker_id=eq." + me.id }, check)
      .subscribe() : null;
    return () => { cancelled = true; if (ch) supabase.removeChannel(ch); };
  }, [me?.id, realtimeBootReady]);
  // 段階お祝いボックス（2026-07-19）：②承認・⑤仕事・⑥評価を、働き手/農家の両側に1回だけ展開。
  // ①応募=apply/done・④採用=hiredBox は別で担当ので除外。applications変化をRealtime購読＋起動時チェック
  const [stageBox, setStageBox] = useState(null); // {emoji,head,body,link,hash}
  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    const check = async () => {
      try {
        let shown = []; try { shown = JSON.parse(localStorage.getItem("cb_stageShown") || "[]"); } catch {}
        const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
        const [wRes, fRes, revRes] = await Promise.all([
          supabase.from("applications").select("id,job_number,status,attended,created_at").eq("worker_id", me.id).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
          supabase.from("applications").select("id,job_number,status,created_at").eq("farmer_id", me.id).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
          // 評価済みかは自分が書いた評価の行で見る（打刻の終了確認は廃止・2026-08-18）
          supabase.from("reviews").select("application_id").eq("reviewer_id", me.id).then(r => r, () => ({ error: true })),
        ]);
        if (cancelled) return;
        const reviewed = new Set(revRes?.error ? [] : (revRes.data || []).map(r => r.application_id));
        const cands = [];
        (wRes.data || []).forEach(a => {
          if (["approved","meeting","interview","contracted","working","completed"].includes(a.status)) cands.push({ a, role:"w", stage:"approved" });
          if (a.status === "completed" && a.attended === true && !reviewed.has(a.id)) cands.push({ a, role:"w", stage:"worked" });
          if (a.status === "completed" && reviewed.has(a.id)) cands.push({ a, role:"w", stage:"reviewed" });
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
          const { data } = await fetchJobRowForMe(c.a.job_number, "job_number,crop,task");
          if (cancelled) return;
          fresh = c; jobRow = data; break;
        }
        if (!fresh) return;
        const title = jobRow ? ([jobRow.crop, jobRow.task].filter(Boolean).join(" ") || `求人 #${fresh.a.job_number}`) : `求人 #${fresh.a.job_number}`;
        try { localStorage.setItem("cb_stageShown", JSON.stringify([...new Set([...shown, `${fresh.a.id}:${fresh.stage}:${fresh.role}`])])); } catch {}
        const defs = {
          "w:approved": { iconName:"party", head:"承認されました！", body:`「${title}」に承認されました。打ち合わせ・面接をチャットで進めましょう。`, link:"チャットを開く →", hash:"/chat/" + fresh.a.id },
          "w:worked":   { iconName:"check", head:"お仕事おつかれさまでした", body:`農家が「${title}」の作業完了を記録しました。最後に、お互いを評価しましょう。`, link:"評価する →", hash:"/profile/worker/approved" },
          "w:reviewed": { iconName:"star", head:"評価を送りました", body:`ありがとうございました。「${title}」の実績が、あなたのプロフィールに反映されます。`, link:"実績を見る →", hash:"/profile/worker" },
          "f:applied":  { iconName:"inbox", head:"新しい応募が届きました", body:`「${title}」に新しい応募があります。プロフィールを見て、承認するか決めましょう。`, link:"応募者を見る →", hash:"/profile/employer/applicants" },
          "f:worked":   { iconName:"check", head:"作業が完了しました", body:`「${title}」の作業が完了しました。働き手を評価しましょう。`, link:"応募者を見る →", hash:"/profile/employer/applicants" },
        };
        const d = defs[`${fresh.role}:${fresh.stage}`];
        if (d && !cancelled) setStageBox(d);
      } catch {}
    };
    check();
    // 応募の変化は「お祝いボックスの判定」だけでなく「開いている画面の再取得の合図」にもする
    // （2026-08-18 Speed-1B）。payloadは渡さない＝合図だけ。中身は各画面が既存の窓口で取り直す
    const onAppChange = () => { check(); emitRefresh(REFRESH_APPLICATIONS, "realtime"); };
    const ch = realtimeBootReady ? supabase.channel("stage-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: "worker_id=eq." + me.id }, onAppChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: "farmer_id=eq." + me.id }, onAppChange)
      .subscribe() : null;
    return () => { cancelled = true; if (ch) supabase.removeChannel(ch); };
  }, [me?.id, realtimeBootReady]);
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
        // リアルタイム：サイトを開いている最中に承認されたら即展開。
        // 購読開始は重要な初回取得の後ろ（2026-08-18 Speed-1C）。上の未読照会は即時のまま
        if (!realtimeBootReady) return;
        channel = supabase.channel("cb-profile-approved")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "farmer_id=eq." + uid }, (payload) => {
            if (payload.new?.type === "profile_approved") showWelcomeApproved(uid, [payload.new.id]);
          })
          .subscribe();
      } catch {}
    })();
    return () => { if (channel) { try { supabase.removeChannel(channel); } catch {} } };
  }, [showWelcomeApproved, realtimeBootReady]);

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


  // 起動中（セッション復元が返るまで）の骨（2026-08-03たきと指摘「スケルトンとか設計したのが無意味だ」）：
  // 以前はここが中央に「読み込み中」の1行だけで、各ページのスケルトンは一切見えなかった
  //（スナップショットが無い＝訪問者・初回ログイン端末は必ずここを通る）。
  // index.html の #cb-boot と【同じ形】にして、HTML→Reactの引き継ぎで見た目が飛ばないようにする。
  // ★<style>{CSS}</style>をここでも注入する：本体の返り値の中にしか無かったため、この画面では
  //   アプリのCSS（ghost-lineのシマー等）が未適用だった
  if(!loaded)return(
    <>
      <style>{CSS}</style>
      <div style={{position:"fixed",inset:0,background:"#fff"}} aria-busy="true" aria-label="読み込み中">
        <div style={{height:64,borderBottom:"1px solid #F0F0F0",display:"flex",alignItems:"center",padding:"0 16px",boxSizing:"border-box"}}>
          <div className="ghost-line" style={{width:120,height:22,borderRadius:6}} />
        </div>
        <div style={{padding:16,display:"grid",gap:10}}>
          <div className="ghost-line" style={{height:44,borderRadius:22}} />
          <div className="ghost-line" style={{height:190,borderRadius:14}} />
          <div className="ghost-line" style={{height:190,borderRadius:14}} />
          <div className="ghost-line" style={{height:190,borderRadius:14}} />
        </div>
        <div style={{position:"fixed",left:0,right:0,bottom:0,height:"calc(64px + env(safe-area-inset-bottom, 0px))",borderTop:"1px solid #F0F0F0",background:"#fff",display:"flex",alignItems:"center",justifyContent:"space-around",padding:"0 16px env(safe-area-inset-bottom, 0px)",boxSizing:"border-box"}}>
          <div className="ghost-line" style={{width:34,height:34,borderRadius:10}} />
          <div className="ghost-line" style={{width:34,height:34,borderRadius:10}} />
          <div className="ghost-line" style={{width:34,height:34,borderRadius:10}} />
        </div>
      </div>
    </>
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
    {k:"profile",l:"マイページ",modes:["farmer","worker"]},
    ...(isAdmin(me)?[{k:"admin",l:"管理",badge:badgeCnt,modes:["farmer","worker"]}]:[]),
  ];
  const TABS = ALL_TABS;

  // 未ログインで input（ログイン画面）要求時はモード不問で通す（認証は役割不問・骨格⑥）
  // 部屋番号(TAB_URL_KEYS)にある部屋は全て到達可（避難部屋含む・骨格④）。資格の無い部屋と迷子はsearchへ
  const safeTab = TAB_URL_KEYS.includes(tab)
    ? (((tab === "admin" || tab === "boxes" || tab === "qr") && !isAdmin(me)) || ((tab === "insurance" || tab === "experience" || tab === "new-applicants") && !me) ? "search" : tab)
    : "search";

  // 下部ナビ（2026-08-22たきと指示「農家と働き手の切り替えはマイページだけに限定」）：
  // ★モード（empCtx）でナビを変えない＝切り替えても行き先が動かない。
  //   カレンダーの行き先だけは【雇い手の面を持っているか（hasEmp）】で決める＝capabilityの話so
  //   モードを切り替えても同じページに着く（働き手モードで開くと自分の求人カードが消える件の根治）。
  //   雇い手の面がある人＝#/profile/employer/calendar（カレンダー＋自分の求人＋日タップで応募者＋
  //   働き手としての予定も埋め込み表示）／持たない人＝#/saved（働き手のカレンダー）。
  // 4タブ＝さがす・カレンダー・チャット・マイページ（2026-08-23統一・「今日」は2026-08-22に削除）
  // 訪問者版3タブ（未ログイン・2026-07-24）：さがす／入れ方／登録・ログイン
  // アイコンは全ナビ共通のアウトラインSVG（NavIcon・2026-08-22）＝下部ナビの絵文字は全廃
  const visitorNav = [
    { k:"search",  icon:<NavIcon name="search" />,  label:"さがす" },
    { k:"install", icon:<NavIcon name="install" />, label:"入れ方", hash:"/install" },
    { k:"login",   icon:<NavIcon name="login" />,   label:"登録・ログイン", hash:"/login" },
  ];
  // カレンダーのタブ（行き先だけ capability で出し分け・ラベルとアイコンは共通）。
  // matchは「そのタブの領域に居るか」を明示する（2026-07-27）＝hashのstartsWithだけだと
  // 雇い手プロフィール等で どのタブも点かない穴があった
  const calendarTab = hasEmp
    ? { k:"emp-calendar", icon:<NavIcon name="calendar" />, label:"カレンダー", hash:"/profile/employer/calendar",
        match: h => h.startsWith("profile/employer/calendar") }
    : { k:"saved", icon:<NavIcon name="calendar" />, label:"カレンダー" };
  const navTabs = !me
    ? visitorNav
    : [
        { k:"search",  icon:<NavIcon name="search" />,  label:"さがす" },
        calendarTab,
        { k:"chats",   icon:<NavIcon name="chats" />,   label:"チャット" },
        { k:"profile", icon:<NavIcon name="profile" />, label:"マイページ",
          match: h => h === "profile" || h === "profile/employer" || h.startsWith("profile/employer/profile") || h.startsWith("profile/worker") },
      ];

  return(
    <div style={{minHeight:"100vh",background:C.washi,color:C.ink,"--mode-accent":modeAccent,"--role-accent":(me && !empCtx) ? ROLE_ORANGE : ROLE_GREEN,"--role-accent-soft":(me && !empCtx) ? "rgba(247,107,28,0.15)" : "rgba(0,168,107,0.13)"}}>
      <style>{CSS}</style>

      {/* 働き手/雇い手プレビューの全域ボックス（どの画面のアイコンからでもイベントで展開・2026-07-19） */}
      {/* 採用おめでとうボックス（2026-07-19）：花びら🌸＋求人リンク＋？マーク3つ（緊急連絡先・採用からの流れ・評価とは） */}
      {/* 段階お祝いボックス（2026-07-19・②承認/⑤仕事/⑥評価・働き手/農家両側）：お知らせ規格の意匠 */}
      {!consignRoom && stageBox && (
        <div className="cb-lock-scroll" onClick={()=>setStageBox(null)} style={{ position:"fixed", inset:0, zIndex:9630, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", border:"3px solid #00A86B", borderRadius:20, padding:"28px 24px 22px", maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", textAlign:"left", boxShadow:"0 12px 48px rgba(0,0,0,0.25)", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <div style={{ marginBottom:8, color:"#00A86B" }}><NavIcon name={stageBox.iconName} size={34} /></div>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text={stageBox.head} /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0 }}>{stageBox.body}</p>
            <button onClick={()=>{ const h = stageBox.hash; setStageBox(null); window.location.hash = h; }} className="f-sans" style={{ marginTop:16, background:"none", border:"none", borderBottom:"2px solid #00A86B", padding:"0 0 2px", fontSize:18, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>{stageBox.link}</button>
          </div>
        </div>
      )}
      {!consignRoom && hiredBox && (
        <div className="cb-lock-scroll" onClick={()=>setHiredBox(null)} style={{ position:"fixed", inset:0, zIndex:9640, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, animation:"fadeIn .2s ease", overflow:"hidden" }}>
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} className="cb-petal" style={{ left: `${(i * 7.3 + 3) % 100}%`, color:"#F2A8C4", animationDuration: `${4 + (i % 5)}s`, animationDelay: `${(i % 7) * 0.6}s` }}><NavIcon name="sakura" size={14 + (i % 4) * 5} /></span>
          ))}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", border:"3px solid #00A86B", borderRadius:20, padding:"28px 24px 20px", maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", textAlign:"left", boxShadow:"0 12px 48px rgba(0,0,0,0.25)", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text="採用されました！" /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:"0 0 14px" }}>
              {hiredBox.farmerName}さんの
              <a href={"#/work/job/" + hiredBox.jobNumber} onClick={()=>setHiredBox(null)} style={{ color:"#00A86B", fontWeight:700 }}>「{hiredBox.jobTitle || `求人 #${hiredBox.jobNumber}`}」</a>
              に採用されました。
            </p>
            {[
              { k:"emergency", l:"緊急連絡先", body:"当日行けない・遅れる時は、プロフィールの「きょうの仕事」ページにある「緊急連絡」から連絡できます。無断欠勤は記録に残るため、必ず連絡してください。" },
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
          <span style={{ flexShrink:0, display:"flex" }}><NavIcon name="chats" size={22} /></span>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ display:"block", fontSize:14, fontWeight:700 }}>{msgToast.title}</span>
            <span style={{ display:"block", fontSize:12, color:"#B8B8B8", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{msgToast.text || "タップして開く"}</span>
          </span>
          <span aria-label="閉じる" onClick={(e)=>{ e.stopPropagation(); setMsgToast(null); }} style={{ flexShrink:0, width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center" }}><NavIcon name="close" size={13} /></span>
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
          <div ref={loginSheetRef} onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
            </div>
            <div ref={loginScrollRef} style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"0 0 calc(16px + env(safe-area-inset-bottom, 0px))" }}>
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
        <div className="cb-lock-scroll" onClick={()=>confirmWelcomeApproved()} style={{ position:"fixed", inset:0, zIndex:11000, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"28px 24px 24px", maxWidth:360, width:"100%", textAlign:"center", position:"relative", boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
            <div style={{ marginBottom:12, display:"flex", justifyContent:"center", color:"#00A86B" }}><NavIcon name="party" size={44} /></div>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 6px" }}>お帰りなさい{welcomeApproved.name ? "、" + welcomeApproved.name + "さん" : ""}</p>
            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#00A86B", margin:"0 0 4px" }}>プロフィールが承認されました！</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 18px" }}>さっそく確認してみましょう！</p>
            <button onClick={()=>confirmWelcomeApproved(()=>{ try { sessionStorage.setItem("cb_openWorkerPreview", "1"); } catch {} window.location.hash = "/profile/worker/profile"; })}
              className="f-sans" style={{ width:"100%", padding:"13px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>プレビューを見る <NavIconInline name="link" size={13} style={{ marginRight:0, marginLeft:3 }} /></button>
          </div>
        </div>
      )}

      {/* 運営お知らせポップアップの規定（2026-07-17設計）：左詰め・緑の太縁(3px)・タイトルと説明の間に横線・
          上限=画面上から30px・下限=下部フッターの40px上（2026-07-18に20px引き上げ）・最後の段に「〇〇する」形式のリンク（タップ=既読化して遷移）。
          文字はタイトル20/本文18/リンク18（2026-07-17縮小・説明文が5行を超えると読まれないため）。1回の起動で1件、残りは次回（たきと方針） */}
      {!consignRoom && activeNotices && !welcomeApproved && (
        <div onClick={dismissNotices} className="cb-box-overlay cb-lock-scroll" style={{ zIndex:10900 }}>{/* cb-lock-scroll＝展開中は背後スクロール固定（2026-08-15） */}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            {/* ✕ボタンは置かない（2026-07-27たきと指示）：ボックス外タップで閉じられる（＝既読化も同じdismissNotices）ので重複 */}
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#00A86B", margin:"0 0 14px" }}><NavIconInline name="megaphone" size={19} />お知らせ</p>
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
          {/* 求人を探す（2026-08-19たきと指示）。旧「求人を出す」CTAの位置に置き換え。
              狭い画面ではラベルを「探す」に縮める（.app-header-search-btn の @media） */}
          <button onClick={() => { setTab("search"); window.location.hash = "/search"; }}
            className="f-sans app-header-search-btn"
            style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                     fontSize:14, fontWeight:600, color:"#222", padding:"8px 14px", borderRadius:20 }}>
            <span className="search-label-full">求人を探す</span>
            <span className="search-label-short">探す</span>
          </button>

          <button onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
            aria-label="メニュー"
            style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
                     background:"#fff", border:"1px solid #EBEBEB", borderRadius:24,
                     padding:"6px 8px 6px 12px", fontFamily:"inherit" }}>
            <span style={{ display:"flex", color:"#222" }}><NavIcon name="menu" size={16} /></span>
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
                <NavIconInline name="book" size={13} />使い方
              </button>
              {me && (
                <button onClick={() => { setMenuOpen(false); setShowFeedback(true); }}
                  className="f-sans"
                  style={{ display:"block", width:"100%", textAlign:"left", background:"none",
                           border:"none", cursor:"pointer", fontFamily:"inherit",
                           fontSize:14, color:"#222", padding:"10px 16px" }}>
                  <NavIconInline name="flag" size={13} />この画面を報告
                </button>
              )}
              {isAdmin(me) && (
                <button onClick={() => { setMenuOpen(false); window.location.hash = "/admin"; }}
                  className="f-sans"
                  style={{ display:"block", width:"100%", textAlign:"left", background:"none",
                           border:"none", cursor:"pointer", fontFamily:"inherit",
                           fontSize:14, color:"#222", padding:"10px 16px" }}>
                  <NavIconInline name="gear" size={13} />管理
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
          <span className="icon"><NavIcon name="menu" size={20} /></span>
        </button>
        {mobileMenuOpen && (
          <div className="app-header-mobile-menu" onClick={(e)=>e.stopPropagation()}>
            <button onClick={()=>{ setMobileMenuOpen(false); window.location.hash="/search"; }} className="f-sans app-header-mobile-menu-item"><NavIconInline name="search" size={13} />求人を探す</button>
            <button onClick={()=>{ setMobileMenuOpen(false); window.location.hash="/help"; }} className="f-sans app-header-mobile-menu-item"><NavIconInline name="book" size={13} />使い方</button>
            {me && (
              <button onClick={()=>{ setMobileMenuOpen(false); setShowFeedback(true); }} className="f-sans app-header-mobile-menu-item"><NavIconInline name="flag" size={13} />この画面を報告</button>
            )}
            {/* お問い合わせ（2026-08-22たきと指示）。フッター「サポート」列と同じ宛先＝メールの窓口は1つ。
                aタグだがメニュー項目のCSSに乗せる（下線を消し文字色を揃える） */}
            <a href="mailto:t5fki6643qty@gmail.com" onClick={()=>setMobileMenuOpen(false)}
               className="f-sans app-header-mobile-menu-item" style={{ textDecoration:"none", color:"#222" }}><NavIconInline name="mail" size={13} />お問い合わせ</a>
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
              : safeTab === t.k;
            // 宿題バッジ（第12弾）：数字＝待たせている/自分の宿題の件数。求人(農家)の差し戻しのみ⚠フラグ
            // ★「今日」タブの赤バッジ（navBadges.todo）は削除（2026-08-21たきと指示「タブの赤バッジも必要ない」・
            //   今日ページ内の丸数字バッジ全廃と対）。my_nav_badges の todo は取得だけ続く（DB不変・読み手なし）
            const badge = t.k === "chats" ? (navBadges.chat_threads || 0)
              : t.k === "profile" ? (navBadges.review_due || 0)
              : (t.badge || 0);
            // ⚠（job_revision＝修正のお願い）の表示は「求人」タブごと消えた（2026-08-21・さがすに差し替え）。
            // 修正のお願いの気づきは今日ページの「📝求人の修正」箱とお知らせ・メールが引き続き担う
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
          const icons={search:"search",work:"hire",profile:"profile",admin:"gear",labor:"hire"};
          return(
            <button key={k} onClick={()=>setTab(k)} className={safeTab===k?"active":""}>
              <span className="icon"><NavIcon name={icons[k]} size={20} /></span>
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
        {/* 管理者専用エラー帯（2026-08-07）：どのタブでも画面上部に出る。システムページ表示中は
            自分自身を指すだけなので出さない。一般ユーザーには描画も取得も走らない（isAdminゲート） */}
        {me&&isAdmin(me)&&<AdminErrorChatReporter/>}
        {me&&!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab!=="terms"&&safeTab!=="privacy"&&showLegalV2Banner&&(
          <div className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, margin:"0 0 16px", padding:"14px 18px", background:"#EAF7F0", border:"1px solid #00A86B", borderRadius:12, fontSize:13, color:"#1B5E3F", lineHeight:1.6 }}>
            <span>利用規約とプライバシーポリシーを全面改訂しました（7/21）</span>
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
        ) : needsPrivacyReconsent ? (
          <PrivacyReconsent authId={me?.id} onAgreed={()=>setNeedsPrivacyReconsent(false)} onShowPrivacy={()=>setShowPrivacy(true)} />
        ) : chatAppId === "admin" ? (
          /* 運営チャット（#/chat/admin）＝当事者チャットと同じ器に相乗り（AdminChat.jsx冒頭の注記） */
          <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminChatPage onBack={()=>{ window.history.length > 1 ? window.history.back() : (window.location.hash="/chats"); }} /></Suspense>
        ) : chatAppId ? (
          <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><ChatView applicationId={chatAppId} onBack={()=>{ window.history.length > 1 ? window.history.back() : (window.location.hash="/profile"); }} /></Suspense>
        ) : showApplyPending ? (
          <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><ApplyPending /></Suspense>
        ) : showApplyDone ? (
          /* 完了ページは廃止（2026-08-07・①）＝アニメーションに置換。上のuseEffectが応募状況へ着地させ、
             祝祭・法的トースト・60秒アイドルはグローバルに出す。ここは着地までの一瞬なので何も描かない */
          null
        ) : safeTab==="search" ? <JobSearchMapView onRegister={goLogin} me={me} /> : null}
        {/* 求人フロー中（showJobPost）は背後を描かない（2026-08-08）：描くとフロー本体が届くまでの
            約1秒、プロフィールの働き手面が露出し「働き手に切り替わった」ように見える＝オーバーレイ描画の鉄則 */}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&!showJobPost&&safeTab==="profile"&&(me
          ? <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><ProfileHub me={me}
              applicantsBadge={navBadges.applicants_pending}
              onNewJob={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} setShowJobPost(true); window.location.hash="/work/new"; }}
              onResume={(n)=>{ setShowJobPost(true); window.location.hash="/work/edit/"+n; }}
              onAvatarChange={(a)=>setMeAvatar(prev=>({ ...prev, ...a }))} onLogout={handleLogout} /></Suspense>
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>プロフィールを見るにはログインしてください</p><button onClick={goLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {/* 新着の応募ページ（#/new-applicants・2026-08-05たきと指示）：応募を受けた雇い手専用。
            未対応の応募があればサイトを開いた時にここへ着地する（起動時の着地判定・topLandingChecked）。読み取り専用＝
            承認・見送りの実行は応募者シートが唯一の窓口ので、ここからはそこへ送るだけ */}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="new-applicants"&&me&&
          <Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><NewApplicantsPage/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="chats"&&(me
          ? <ChatList />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>チャットを見るにはログインしてください</p><button onClick={goLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="saved"&&(me
          ? <SavedJobsView me={me} />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>いいねを見るにはログインしてください</p><button onClick={goLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="calendar"&&(me
          ? <CalendarRouter me={me} defaultRole={empCtx ? "farmer" : "worker"} />
          : <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#717171"}}>今日の予定を見るにはログインしてください</p><button onClick={goLogin} className="f-sans" style={{marginTop:16,padding:"12px 24px",border:"1px solid #EBEBEB",borderRadius:12,background:"#fff",fontSize:13,color:"#222",cursor:"pointer"}}>ログインへ</button></div>)}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="login"&&(me
          ? <div style={{textAlign:"center",padding:"80px 24px"}}><p className="f-sans" style={{fontSize:14,color:"#222"}}>ログイン済みです</p></div>
          : <LoginScreen farmers={farmers} onLogin={f=>{
              setMe(f);
              // 行き先の決め方は afterLoginGo に一本化（緊急連絡→応募の戻り先→発火したページ→既定）
              afterLoginGo();
            }}/>)}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&consignRoom&&<Suspense fallback={<div style={{ minHeight:"70vh", display:"flex", alignItems:"center", justifyContent:"center" }}><p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, margin:0 }}>読み込み中<Dots /></p></div>}><ConsignmentRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&workingRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminWorkingRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&upcomingRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminUpcomingRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&evalRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminEvaluationRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&systemRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminSystemRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&animationsRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminAnimationsRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&commentRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminReviewCommentsRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&reportsRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminReportsRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&farmerPagesRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminFarmerPagesRoom/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="admin"&&isAdmin(me)&&!consignRoom&&!workingRoom&&!upcomingRoom&&!evalRoom&&!systemRoom&&!commentRoom&&!reportsRoom&&!farmerPagesRoom&&!animationsRoom&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminTab
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
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="boxes"&&isAdmin(me)&&<Suspense fallback={<p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>}><AdminBoxRegistryPage/></Suspense>}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="charter"&&(
          <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>運営憲章</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／改訂：2026年7月24日</p>

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
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="help"&&<HelpCenter me={me} onReportClick={() => setShowFeedback(true)} />}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="install"&&<InstallGuide me={me} />}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="visit"&&<VisitEntrance />}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="insurance"&&me&&<InsurancePrepPage me={me} />}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="experience"&&me&&<WorkerExperiencePage />}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="qr"&&isAdmin(me)&&<VisitorQRPage />}
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="privacy"&&(
          <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>プライバシーポリシー</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／全面改訂：2026年7月21日／改訂：2026年8月19日</p>

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

            {/* 各条の箱の minWidth:0 は、モーダル側（app/legal/PrivacyPolicy.jsx）と同じ理由＝表が箱を押し広げないように */}
            <div style={{ display:"grid", gap:20 }}>
              {PRIVACY_SECTIONS.map((s, i) => (
                <div key={i} id={s.id} style={{ padding:"20px 24px", background:"#F7F7F7", borderRadius:16, border:"1px solid #EBEBEB", scrollMarginTop:88, minWidth:0 }}>
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
        {!needsAccountHolder&&!openAccountForm&&!needsPrivacyReconsent&&!chatAppId&&!applyPage&&safeTab==="terms"&&(
          <div className="help-edge" style={{ maxWidth:760, margin:"0 auto", padding:"40px 4px 48px" }}>{/* 画面端から実質4px（使い方ガイドと同じ作法） */}
            <h1 className="f-sans" style={{ fontSize:32, fontWeight:800, color:"#222", marginBottom:8 }}>利用規約</h1>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:4 }}>chitose-bank</p>
            <p className="f-sans" style={{ fontSize:14, color:"#999", marginBottom:36 }}>制定：2026年7月5日／全面改訂：2026年7月21日／一部改訂：2026年8月19日</p>

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
            <button onClick={()=>{ window.location.hash="/search"; }} className="f-sans footer-col-link">求人を探す</button>
            <button onClick={()=>{ window.location.hash="/help/farmer"; }} className="f-sans footer-col-link">掲載のしくみ</button>
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

      {/* 掲載完了はページでなくアニメーション（2026-08-07たきと指示）。タブに依らずグローバルに出す＝
          掲載後に /profile/employer へ遷移した先で祝祭が重なり、60秒ノーアクションで さがす へ送る */}
      {pubCelebrate && <Celebration title={pubCelebrate.open ? "公開しました！" : "求人ができました！"} onDone={()=>{ setPubChoice({ open: pubCelebrate.open, jobNumber: pubCelebrate.open ? pubCelebrate.jobNumber : null }); setPubCelebrate(null); }} />}
      {pubChoice && <PublishChoiceCard jobNumber={pubChoice.jobNumber} onClose={()=>setPubChoice(null)} />}
      {pubIdle && <PublishIdleRedirect seconds={60} onEnd={(fired)=>{ setPubIdle(false); if (fired) { setPubChoice(null); window.location.hash="/search"; } }} />}

      {/* 応募完了もアニメーション（2026-08-07・①）。祝祭（新規到着のみ）＋法的トースト＋60秒アイドル→さがす。
          着地先（応募状況）の上に重なる。promotedCount/applyAlready で見出しを出し分ける */}
      {applyBurst && <Celebration
        title={promotedCount > 0 ? `${promotedCount}件を届けました` : "応募できました"} onDone={()=>setApplyBurst(false)} />}
      {applyNote && <ApplyDoneNote promoted={promotedCount} already={applyAlready} onClose={()=>setApplyNote(false)} />}
      {/* 仮応募の新規到着もアニメーション（2026-08-07・②ハイブリッド）。祝祭＋案内トースト。
          再訪は従来どおり ApplyPending のチェックリストページ（残り項目の受け皿）を出す */}
      {pendBurst && <Celebration title="仮応募をお預かりしました" onDone={()=>setPendBurst(false)} />}
      {pendNote && <ApplyDoneNote pending onClose={()=>setPendNote(false)} />}
      {/* 働き手フロー完了もアニメーション（2026-08-07・③）。祝祭＋構想段階トースト。着地はログイン画面 */}
      {workerFlowBurst && <Celebration title="ありがとうございます" onDone={()=>setWorkerFlowBurst(false)} />}
      {workerFlowNote && <ApplyDoneNote worker onClose={()=>setWorkerFlowNote(false)} />}
      {applyIdle && <PublishIdleRedirect seconds={60} onEnd={(fired)=>{ setApplyIdle(false); if (fired) window.location.hash="/search"; }} />}

      {/* ★LandingFlowのオーバーレイ3つはAppErrorBoundary（タブ描画側）の外にあるので、個別に包む
          （2026-08-07 コピー→白画面の修理）：包まないと、チャンク読み込み失敗・描画エラーが
          ここで起きた時にReactがツリー全体を落とし、復帰ボタンも無い白画面になる */}
      {!me&&showLanding&&(
        <AppErrorBoundary><Suspense fallback={null}><LandingFlow
          onComplete={()=>setShowLanding(false)}
          onSkip={()=>{setShowLanding(false);setTab("search");}}
          onLogin={()=>{setShowLanding(false);setTab("login");}}
          onWorkerDone={()=>{ /* ③（2026-08-07）：完了ページの代わりに祝祭＋トースト＋ログインへ着地＋60秒でさがす */
            setShowLanding(false); setTab("login"); setWorkerFlowBurst(true); setWorkerFlowNote(true); setApplyIdle(true); }}
        /></Suspense></AppErrorBoundary>
      )}
      {me&&showJobPost&&!needsPrivacyReconsent&&(
        <AppErrorBoundary><Suspense fallback={<FlowLoading />}><LandingFlow
          initialRole="farmer"
          // 求人フローの出口は【すべて入る直前の画面へ強制遷移】（2026-08-19「戻る」→2026-08-21 全出口に拡張）。
          // カレンダーの日付シートから コピー／内容を編集 で入った時も、終わればカレンダーに戻る。
          // 行き先の控えは flowBackToRef（フロー以外のハッシュを通るたびに更新）＝1箇所で持つ
          onPublished={(wasOpen, jobNumber)=>{ setShowJobPost(false); window.location.hash = flowBackToRef.current || "/profile/employer"; setPubCelebrate({ open: !!wasOpen, jobNumber: jobNumber || null }); setPubIdle(true); }}
          onComplete={()=>{ setShowJobPost(false); window.location.hash = flowBackToRef.current || "/profile/employer"; }}
          onSkip={()=>{ setShowJobPost(false); window.location.hash = flowBackToRef.current || "/profile/employer"; }}
          onLogin={()=>{ setShowJobPost(false); window.location.hash="/profile/employer"; }}
          onStepChange={(s)=>{ if(window.location.hash.replace(/^#\/?/,"").startsWith("work/new")) window.location.hash="/work/new/"+s; }}
          initialStep={(()=>{ const m=window.location.hash.replace(/^#\/?/,"").match(/^work\/new\/(\d+)$/); return m?parseInt(m[1],10):undefined; })()}
        /></Suspense></AppErrorBoundary>
      )}
      {me&&showDevJump&&(
        <AppErrorBoundary><Suspense fallback={null}><LandingFlow
          onComplete={()=>setShowDevJump(false)}
          onSkip={()=>setShowDevJump(false)}
          onLogin={()=>setShowDevJump(false)}
          onWorkerDone={()=>{ /* devJump（管理者の確認用）：閉じて祝祭＋トーストだけ出す（ログインへは送らない） */
            setShowDevJump(false); setWorkerFlowBurst(true); setWorkerFlowNote(true); }}
        /></Suspense></AppErrorBoundary>
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
