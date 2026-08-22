// 分割3-C（2026-07-25）：App.jsxから移動。プロフィールタブ（両役割の入口カードメニュー＋サブページ切替）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { getCache, setCache } from "../lib/viewCache";
import { snapGet, snapSet } from "../lib/snapshot";
import { peekApplyReturn, clearApplyReturn } from "../lib/applyReturn";
import { WORKER_DECLARATIONS, ROLE_ORANGE, ROLE_GREEN, workerQaItems, workerUnsetCount } from "../lib/utils";
import { Avatar, QaChat, Dots, SwipeTabPages } from "./ui";
import { WorkerWorkRecord } from "./WorkerWorkRecord";
import { ReceivedReviews } from "./ReceivedReviews";
import { FarmerDashboard } from "./FarmerDashboard";
import { WorkerApplications } from "./WorkerApplications";
import { WorkerProfileEdit } from "./WorkerProfileEdit";
import { WorkerTrustCard } from "./TrustCards";
import LaborConditionsNotice from "./LaborConditionsNotice";
import { LikedJobsCard } from "./LikedJobsCard";
import { TodayTaskBoxes } from "../features/today/components/TaskBoxes";
import { RoleSwitchOverlay } from "./RoleSwitchOverlay";

// 役割切替の全画面アニメ（Airbnb「ホストに切り替え」風・2026-08-22）のタイミング。
// ★時間の正は appStyles.js の cbRs* 群（入り.2s→全開→1.25sからフェードアウト.35s＝計1.6s）。
//   swap＝幕が全開の間に面を入れ替える時刻／total＝幕が消え切ってアンマウントする時刻。
//   CSSを変えたらここも必ず合わせる（swapは「0.2s以降〜1.25s以前」に収めること）
const ROLE_SWITCH_MS = { swap: 500, total: 1600 };

// 退会で削除される情報の一覧（2026-08-07たきと指示）＝process_withdrawal(migration 20260807133659)の
// 削除対象を利用者の言葉に噛み砕いたもの。★DBの削除対象を増減したらここも合わせること（表示と実処理を揃える）。
// 「削除される情報のみ」＝残る証跡（応募・チャット・評価等）はここに載せない。表示専用（編集不可）。
// DBの17テーブルとの対応：farmers（農家の基本情報）は「農園・雇い手プロフィール」に含意／
// records（旧・経営記録）は現行UIで作成できない遺物ので利用者向けには省略（持たない情報を列挙しない）。
const WITHDRAW_DELETED_ITEMS = [
  "メールアドレス・ログイン情報",
  "本人確認情報（氏名・ふりがな・住所・生年月日・電話番号）",
  "働き手プロフィール（自己紹介・経験・希望条件など）",
  "農園・雇い手プロフィール（農園紹介・待遇・募集者情報など）",
  "委託者プロフィール（氏名・住所・連絡先・振込先の口座情報）",
  "緊急連絡先",
  "お知らせの通知設定（プッシュ購読）",
  "いいねした求人・お気に入り登録",
  "下書きの応募・既読の記録・お知らせ",
  "閲覧履歴・ログイン履歴",
  "きっかけアンケート・ご意見（フィードバック）の回答",
];

// 退会セクション（2026-08-07たきと指示・プロフィール最下部）：タップで説明＋いいえ/はいを展開。
// いいえ＝閉じる／はい＝退会申請を記録してログアウト。処理はProfileModal（旧・到達不能だった退会）と同一。
// フォーカス消失バグ回避のためモジュールレベル定義（ProfileHub内に定義しない・CLAUDE.md技術メモ）。
function ProfileWithdrawSection({ onLogout }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showItems, setShowItems] = useState(false); // 「登録した情報」タップで削除される情報を羅列（表示専用）
  const doWithdraw = async () => {
    if (busy) return;
    setBusy(true);
    // 退会申し出を記録（プラポリv3第7条1：申し出から30日以内に運営が削除）。
    // insert失敗でもsignOutは実行する＝退会の意思表示を通信エラーで妨げない
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase.from("withdrawal_requests").insert({ auth_id: user.id });
        if (error) console.error("退会申請の記録に失敗:", error.message);
      }
    } catch (e) { console.error("退会申請の記録に失敗:", e); }
    try { await supabase.auth.signOut(); } catch {}
    if (onLogout) onLogout();
  };
  return (
    <div style={{ borderTop:"1px solid #EBEBEB", marginTop:32, paddingTop:20, paddingBottom:8 }}>
      {!open
        ? <button onClick={()=>setOpen(true)} className="f-sans" style={{ width:"100%", padding:"12px", border:"none", background:"none", fontSize:13, color:"#E24B4A", cursor:"pointer", textAlign:"center" }}>退会する</button>
        : <div style={{ padding:20, background:"#FCEBEB", borderRadius:14, border:"1px solid #E24B4A22" }}>
            <p className="f-sans" style={{ fontSize:13, color:"#E24B4A", marginBottom:14, lineHeight:1.8, textAlign:"center" }}>
              本当に退会しますか？<br/>
              <button onClick={()=>setShowItems(v=>!v)} className="f-sans" style={{ border:"none", background:"none", padding:0, color:"#E24B4A", fontSize:13, fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>登録した情報</button>
              は運営が確認し、申し出から30日以内に削除します。<br/>作業や取引の記録は、法令と紛争対応のため必要な範囲で残ります。
            </p>
            {showItems && (
              <div className="f-sans" style={{ marginBottom:14, padding:"12px 14px", background:"#fff", border:"1px solid #E24B4A22", borderRadius:12, textAlign:"left" }}>
                <p style={{ fontSize:12, fontWeight:700, color:"#B54A0E", margin:"0 0 8px" }}>退会で削除される情報</p>
                <ul style={{ margin:0, paddingLeft:18, listStyle:"disc" }}>
                  {WITHDRAW_DELETED_ITEMS.map(t => (
                    <li key={t} style={{ fontSize:12, color:"#444", lineHeight:1.9 }}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setOpen(false)} disabled={busy} className="f-sans" style={{ flex:1, padding:"11px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, fontSize:13, cursor:"pointer", color:"#222" }}>いいえ</button>
              <button onClick={doWithdraw} disabled={busy} className="f-sans" style={{ flex:1, padding:"11px", background:"#E24B4A", color:"#fff", border:"none", borderRadius:12, fontSize:13, fontWeight:600, cursor:"pointer", opacity: busy ? 0.6 : 1 }}>{busy ? <>処理中<Dots /></> : "はい、退会する"}</button>
            </div>
          </div>
      }
    </div>
  );
}

export function ProfileHub({ me, onNewJob, onResume, onAvatarChange, onLogout }) {
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
    // 働き手のカレンダーページは廃止（2026-07-27たきと指示）＝カレンダーはステータスページ(#/saved)に移植。
    // 旧URLで来た人は入口(ホーム)に着地させる（行き先を失わせない）
    return "home"; // 入口はAirbnb型カードメニュー（2026-07-14・農家プロと同構造）
  };
  const [wTab, setWTab] = useState(() => { try { return hashToWTab(); } catch { return "home"; } });
  // 雇う/働くトグルは両面の入口(カードメニュー)だけ表示。編集・サブページでは邪魔なので非表示（2026-07-14）
  const isEmployerHome = () => window.location.hash.replace(/^#\/?/,"") === "profile/employer";
  const [eHome, setEHome] = useState(() => { try { return isEmployerHome(); } catch { return false; } });
  // 両面切替の全画面アニメ（2026-08-22・旧pflip反転を置き換え）：切替先("worker"|"employer")を持つ間だけ
  // RoleSwitchOverlayが画面を覆う。面の入れ替え（hash変更）は幕が全開の間に行う＝ROLE_SWITCH_MS
  const [roleSwitch, setRoleSwitch] = useState(null);
  // 下部バー「プロフィール」タップ＝今いる側のトップへ（2026-07-14変更）。
  // 働き手側：wTabをhomeへ（同hash時＝hashchangeが出ない場合の保険）
  useEffect(() => {
    const onWorkerHome = () => { setWTab("home"); };
    window.addEventListener("cb:workerHome", onWorkerHome);
    return () => window.removeEventListener("cb:workerHome", onWorkerHome);
  }, []);
  useEffect(() => {
    const onHash = () => { const p = hashToPTab(); if (p) setPTab(p); const w = hashToWTab(); if (w) setWTab(w); setEHome(isEmployerHome()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // WORKER_TABS(サイドタブ列)は廃止（2026-07-14）：入口カードメニューに一本化
  const [hasEmployerSide, setHasEmployerSide] = useState(() => getCache("hub:hasEmp") ?? false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        // 求人の有無と雇い手プロフィールの有無は独立なので同時に投げる（2026-07-27たきと指示）
        const [{ count }, { data: ep }] = await Promise.all([
          supabase.from("jobs").select("job_number", { count: "exact", head: true }).eq("farmer_id", session.user.id),
          supabase.from("employer_profiles").select("auth_id").eq("auth_id", session.user.id).maybeSingle(),
        ]);
        if (!cancelled && ((count || 0) > 0 || ep)) { setHasEmployerSide(true); setCache("hub:hasEmp", true); }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  // applying の見出しは「返事待ち」→「あなたの応募」（2026-08-22たきと指示・入口カードの名前とも一致）
  const WORKER_TAB_TITLES = { wprofile:"働き手プロフィール", applying:"あなたの応募", approved:"きょうの仕事" };
  // 入口カードメニュー用：本人のworker_profiles(表示名/アバター)と応募件数（バッジ表示）
  // 名刺の氏名・アイコンを読み込み前から出す（2026-08-02たきと指示「名刺の氏名が未設定で長時間表示される」）：
  // viewCache（sessionStorage・アプリ終了で消える）に無ければ、snapshot（localStorage・本人の自分用データ・
  // ログアウトで全消去）から前回のプロフィールを即表示し、裏の再取得で最新に差し替える
  const [wMini, setWMini] = useState(() => getCache("hub:wMini") ?? snapGet("wMini") ?? null);
  const [wAppCounts, setWAppCounts] = useState(() => getCache("hub:wCounts") ?? { applying:0, approved:0 });
  const [wTopBack, setWTopBack] = useState(() => { try { return localStorage.getItem("cb_wTopBack") === "1"; } catch { return false; } }); // トップボックスの裏面表示。切り返した画面で固定（localStorageに永続・2026-07-16）
  const [wTopAnim, setWTopAnim] = useState("");    // 反転アニメ: pflip-out|pflip-in（0.4s×2=0.8秒）
  const [wPvPage, setWPvPage] = useState(0);       // 裏面プレビューの面（0=プロフィール/1=記録/2=評価・2026-08-21）
  const [wTrust, setWTrust] = useState(() => getCache("hub:wTrust") ?? null);      // 裏面用の自己スタッツ（登録日・本人確認・リピート率）。my_worker_trust_statsは本人限定RPC＝農家には返らない（法務：評価集計の公開禁止）
  const [hasEmg, setHasEmg] = useState(() => getCache("hub:hasEmg") ?? false); // 緊急連絡先の登録有無（別テーブル・2026-08-19に任意へ）＝未設定数の数え方に要る
  const [wSeekFlip, setWSeekFlip] = useState(false); // 「新しく求職を出す」カードの反転（届出受理待ちの案内・2026-07-25）
  useEffect(() => {
    if (wTab !== "home") return; // 入口に戻るたびに再取得（編集後のバッジ・スニペット鮮度を担保）
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        // 【第1波】互いに依存しない4本を同時に投げる（2026-07-27たきと指示「直列を並列に」）。
        // 依存があるのは「きょうの仕事」件数だけ（応募の結果を見て求人の日程を引く）ので第2波に回す
        const [{ data: wp }, { data: apps }, { data: ts }, emgRes, revRes] = await Promise.all([
          supabase.from("worker_profiles").select("*").eq("auth_id", session.user.id).maybeSingle(),
          supabase.from("applications").select("id,status,attended,job_number").eq("worker_id", session.user.id),
          supabase.rpc("my_worker_trust_stats").then(r => r, () => ({ data: null })),
          // 緊急連絡先（別テーブル・self-only）＝名刺バッジの数え方に要る（任意項目として数える）
          supabase.from("emergency_contacts").select("name,phone").eq("auth_id", session.user.id).maybeSingle().then(r => r, () => ({ data: null })),
          // 評価済みかは自分が書いた評価の行で見る（打刻の終了確認は廃止・2026-08-18）
          supabase.from("reviews").select("application_id").eq("reviewer_id", session.user.id).then(r => r, () => ({ error: true })),
        ]);
        if (cancelled) return;
        if (wp) { setWMini(wp); setCache("hub:wMini", wp); snapSet("wMini", wp); }
        if (!emgRes?.error) {
          const has = !!((emgRes?.data?.name || "").trim() || (emgRes?.data?.phone || "").trim());
          setHasEmg(has); setCache("hub:hasEmg", has);
        }
        // 承認済みバッジは未対応（手続きが残っている応募）のみ計上。完了・評価済みまで数えると
        // バッジが常時点灯し、新しい要対応があっても気づけなくなるため（2026-07-16）
        if (apps) {
          const reviewed = new Set(revRes?.error ? [] : (revRes.data || []).map(r => r.application_id));
          const counts = {
            applying: apps.filter(a => a.status === "applied").length,
            approved: apps.filter(a =>
              ["approved","meeting","interview","contracted","working","completed"].includes(a.status)
              && !(a.status === "completed" && (a.attended === false || reviewed.has(a.id)))
            ).length,
          };
          setWAppCounts(counts); setCache("hub:wCounts", counts);
        }
        // 「わたしの実績」カードの要約（wHub＝当日の仕事・求人件数・評価件数）は
        // カード削除（2026-08-21）とともに撤去＝jobs_publicの2本の問い合わせも不要になった
        if (cancelled) return;
        if (ts?.ok) { setWTrust(ts); setCache("hub:wTrust", ts); }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [wTab]);
  // 未設定の項目数（編集ページのボックスに対応）＝名刺カードの「編集する」ボタンの通知バッジに使う。
  // カード枠の強調（cb-urgent-card/-still）は削除した（2026-08-21たきと指示）。
  // 数え方はlib/utilsのworkerUnsetCountが唯一のソース（今日ページの未入力ボックスと同じ定義・2026-08-03）
  const { total: wUnsetCount } = workerUnsetCount(wMini, { hasEmergency: hasEmg });
  // 自己紹介の審査帯（2026-07-19）は削除した（2026-08-17）。承認プロセスの削除（2026-08-14）で
  // 自由記述は保存＝即公開になり、trg_wp_z_publish_texts が pr_pending/pr_qa_pending/pr_submitted_at を
  // 書かれた瞬間に畳む＝「審査中の働き手」という状態が構造的に存在しない（実データも0件で確認）。
  // 下余白は0にしてCSS側（body:has(.profile-employer-edge) main）で最下段の空きを15pxに一本化（2026-08-03）
  return (
    <div className="profile-employer-edge" style={{maxWidth:1024,margin:"0 auto",padding:"32px 4px 0"}}>{/* プロフィール両面とも画面端から10pxに統一（モバイル・CSS側の負マージン併用） */}
      {/* 役割切替の全画面アニメ（Airbnb風・2026-08-22）：幕が出ている間に下で面が入れ替わる */}
      {roleSwitch && <RoleSwitchOverlay target={roleSwitch} creating={roleSwitch === "employer" && !hasEmployerSide} />}
      {/* 浮遊ボタンはトグル式：働き手側の表示中→「雇う」(雇い手空間へ)／農家プロ(雇い手空間)の表示中→「働く」(働き手側へ)。
          表示は両面の入口(カードメニュー)のみ＝編集・サブページでは非表示（2026-07-14）。
          切替はAirbnb風の全画面アニメ（2026-08-22・旧pflip 0.4s×2を置き換え）：
          白幕＋役割バッジのフリップ→幕が全開の間にhash変更→幕のフェードアウトで新しい面が現れる */}
      {(pTab === "employer" ? eHome : wTab === "home") && (
        <button onClick={()=>{
          if (roleSwitch) return; // 連打ガード（幕が出ている間は受けない）
          const next = pTab === "employer" ? "worker" : "employer";
          setRoleSwitch(next);
          setTimeout(()=>{ window.location.hash = next === "worker" ? "/profile/worker" : "/profile/employer"; }, ROLE_SWITCH_MS.swap);
          setTimeout(()=>{ setRoleSwitch(null); }, ROLE_SWITCH_MS.total);
        }} className="profile-employer-fab f-sans" style={{ background: pTab === "employer" ? ROLE_ORANGE : ROLE_GREEN }}>
          {/* 切替先はFAB自体の色で示す（第11弾）：橙=働き手／緑=農家。
              ラベルの色名「（橙）（緑）」は削除した（2026-08-22たきと指示）＝色は見れば分かる */}
          {pTab === "employer"
            ? "⇄ 働き手に切替"
            : (hasEmployerSide ? "⇄ 農家に切替" : "🌱 農家を作る")}
        </button>
      )}
      {/* 面の中身をkey={pTab}で包む：切替時に再マウント→fade-inが再生される（幕の下で入れ替わり、
          幕のフェードアウトとfade-inが重なって新しい面が現れる） */}
      <div key={pTab} className="fade-in">
      {pTab === "worker" ? (
        wTab === "home" ? (
          <>
            {/* ═══ Airbnb型入口メニュー（働き手側・2026-07-14）：農家プロ入口と同構造。旧サイドタブ列は廃止 ═══ */}
            {/* トップボックスは反転式（2026-07-16）：表=アイコン＋ニックネーム／裏=アイコン・ニックネーム抜きのプレビュー。
                カードタップで反転（2026-08-21たきと指示・農家側と同構造）。編集への導線は表面の「編集する」ボタンが担う。
                カードはbuttonでなくdiv＝中の実ボタンと入れ子にしないため */}
            <div style={{ position:"relative" }}>
              <div role="button" tabIndex={0} onClick={()=>{
                  if (wTopAnim === "pflip-out") return; // 連打ガード
                  setWTopAnim("pflip-out");
                  setTimeout(()=>{ setWTopBack(v=>{ const nv = !v; try { localStorage.setItem("cb_wTopBack", nv ? "1" : "0"); } catch {} return nv; }); setWTopAnim("pflip-in"); }, 400);
                }}
                onKeyDown={(e)=>{ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
                className={"f-sans" + (wTopAnim ? " " + wTopAnim : "")}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && wTopAnim === "pflip-in") setWTopAnim(""); }}
                style={{ position:"relative", width:"100%", background:"#fff", border:"2px solid " + ROLE_ORANGE, borderRadius:24, padding:"28px 20px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", minHeight:180, boxSizing:"border-box" }}>
                {!wTopBack ? (
                  <>
                    {/* 未設定の数字バッジは削除（2026-08-21たきと指示「働き手と農家のバッジ表示は削除」）。
                        未設定の気づきは今日ページのプロフィール入力が担う（枠の強調も同日削除） */}
                    <Avatar url={wMini?.avatar_url} name={wMini?.nickname || me?.name} size={84} ring={ROLE_ORANGE} />
                    <span>
                      <span className="f-sans" style={{ display:"block", fontSize:22, fontWeight:800, color:"#222" }}>{wMini?.nickname || me?.name || "名前未設定"}</span>
                      {/* 役割チップ（第11弾）：名前直下・大きめ・橙。★農家側は削除したが働き手は残す指示（2026-08-21） */}
                      <span className="f-sans" style={{ display:"inline-block", marginTop:6, fontSize:13, fontWeight:800, color:"#fff", background:ROLE_ORANGE, borderRadius:20, padding:"3px 14px" }}>働き手</span>
                    </span>
                    {/* 役割チップの下の導線2つ（2026-08-21たきと指示・農家側と同構造）。
                        カードタップ=反転と分けるため stopPropagation。
                        「あなたの応募」＝農家の「あなたの求人」の対（応募状況ページ #/profile/worker/applying） */}
                    <span style={{ display:"flex", gap:10, marginTop:2 }}>
                      <button onClick={(e)=>{ e.stopPropagation(); window.location.hash="/profile/worker/applying"; }} className="f-sans"
                        style={{ background:"#fff", border:"1.5px solid " + ROLE_ORANGE, color:ROLE_ORANGE, borderRadius:20, padding:"8px 18px", fontSize:13, fontWeight:800, cursor:"pointer" }}>あなたの応募</button>
                      <button onClick={(e)=>{ e.stopPropagation(); window.location.hash="/profile/worker/profile"; }} className="f-sans"
                        style={{ position:"relative", background:ROLE_ORANGE, border:"1.5px solid " + ROLE_ORANGE, color:"#fff", borderRadius:20, padding:"8px 18px", fontSize:13, fontWeight:800, cursor:"pointer" }}>
                        編集する
                        {/* 未設定の項目数（全て設定済みなら非表示）＝農家側と同じ位置・同じ色 */}
                        {wUnsetCount > 0 && (
                          <span style={{ position:"absolute", top:-8, right:-8, minWidth:20, height:20, borderRadius:10, background:"#F5A623", color:"#fff", fontSize:11, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 5px", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}>{wUnsetCount}</span>
                        )}
                      </button>
                    </span>
                  </>
                ) : (
                  <div className="f-sans" style={{ width:"100%", textAlign:"left" }}>
                    {/* プレビューの統一（2026-07-26たきと指示）：裏面も本物のプレビュー
                        （WorkerPreviewSheet＝農家が見る構造）と同一にする。
                        3タブ（プロフィール／記録／評価）＋指スワイプ＝共有部品SwipeTabPages（2026-08-21たきと指示）。
                        trustは本人限定RPC(my_worker_trust_stats)＝worker_trust_infoと同形ので そのまま渡せる。
                        タブのタップは部品側がstopPropagation＝カードは反転しない。中身のタップ＝反転（表へ戻る） */}
                    {wMini ? (
                      <SwipeTabPages tabs={["プロフィール","記録","評価"]} page={wPvPage} onPage={setWPvPage}>
                        <div>
                          <WorkerTrustCard profile={wMini} trust={wTrust} />
                          {/* Q&Aはチャットと同じコメント形式（2026-08-06たきと指示）。💪希望する作業の強さも質問要素として合流 */}
                          <QaChat items={workerQaItems(wMini)} />
                        </div>
                        {/* 記録＝はたらいた記録（本人は閲覧資格あり・worker_work_recordの関係ゲート） */}
                        <div>{wMini.auth_id && <WorkerWorkRecord workerId={wMini.auth_id} />}</div>
                        {/* 評価＝受け取った評価（肯定バッジ＋審査済みコメント。公開できる評価が無ければ何も描かない） */}
                        <div>{wMini.auth_id && <ReceivedReviews userId={wMini.auth_id} direction="farmer_to_worker" />}</div>
                      </SwipeTabPages>
                    ) : (
                      <p style={{ fontSize:13, color:"#999", textAlign:"center", margin:"32px 0" }}>プロフィールは未設定です</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            {(() => {
              return (<>
                {/* 「きょうの仕事」箱は撤去（2026-07-24・1機能1入口）。
                    「返事待ち」「さがす」「いいね」箱も撤去（2026-07-25たきと指示）：
                    さがす・いいねは下部ナビに常設＝入口の重複。返事待ちは相方のアクション待ちで
                    プロフィール入口に置く用事ではない（応募状況ページ #/profile/worker/applying は存続） */}
                {/* 新しく求職を出す（2026-07-25たきと指示・農家の「新しく求人を出す」と同構造のワイドカード）。
                    ★法務境界（CLAUDE.md絶対遵守）：求職者情報の公開・逆オファーは特定募集情報等提供の
                    届出受理＋設計審査まで実装禁止。本カードはプレースホルダーのみ＝機能・入力・保存なし。
                    タップで反転し「届出の受理を確認しています」を明記する */}
                <div style={{ perspective:800, marginTop:12 }}>
                  <button onClick={()=>setWSeekFlip(v=>!v)} className="f-sans" aria-label="新しく求職を出す（準備中）" style={{
                    position:"relative", width:"100%", background:"transparent", border:"none", padding:0, cursor:"pointer",
                    transformStyle:"preserve-3d", transition:"transform .5s", transform: wSeekFlip ? "rotateY(180deg)" : "none", textAlign:"left",
                  }}>
                    {/* 表面 */}
                    <span style={{ display:"flex", alignItems:"center", gap:14, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden" }}>
                      <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>📝</span>
                      <span>
                        <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}>新しく求職を出す</span>
                        <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:2, lineHeight:1.6 }}>働ける日や得意な作業を載せて、農家からの声かけを待てます。</span>
                      </span>
                    </span>
                    {/* 裏面（タップで反転） */}
                    <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", gap:14, background:"#FFF8EF", border:"1px solid #F0E1CC", borderRadius:20, padding:"18px 16px", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", transform:"rotateY(180deg)", backfaceVisibility:"hidden", WebkitBackfaceVisibility:"hidden" }}>
                      <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>⏳</span>
                      <span>
                        <span className="f-sans" style={{ display:"block", fontSize:15, fontWeight:800, color:"#8A5A00" }}>準備中です</span>
                        <span className="f-sans" style={{ display:"block", fontSize:13, color:"#8A5A00", marginTop:2, lineHeight:1.6 }}>届出の受理を確認しています。確認でき次第、使えるようになります。</span>
                      </span>
                    </span>
                  </button>
                </div>
                <div style={{ marginTop:16 }}>
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_ORANGE, paddingLeft:8 }}>わたしの記録</p>
                  {/* 「🌟わたしの実績」カード（プレビューの記録タブ直行）は削除（2026-08-21たきと指示）＝
                      名刺カードの反転→記録／評価タブと完全に重複するため。実績・評価の表示は
                      名刺カード裏面（SwipeTabPages）に一本化。評価新着の🌟マークも一緒に廃止 */}
                  {/* 📋 経験・できること（自己申告）。タップで編集ボックスを開く */}
                  {(() => {
                    const chips = wMini ? [
                      ...((Array.isArray(wMini.experience_entries) ? wMini.experience_entries : []).filter(e => e && (e.crop||"").trim()).map(e => `${e.crop}×${e.task||""}${e.duration ? `（${e.duration}）` : ""}`)),
                      ...(wMini.farm_experience ? ["🌾 " + wMini.farm_experience] : []),
                      ...((Array.isArray(wMini.experienced_tasks) ? wMini.experienced_tasks : []).filter(Boolean)),
                      ...(wMini.transport ? ["🚗 " + wMini.transport] : []),
                      ...((Array.isArray(wMini.self_declared) ? wMini.self_declared : []).map(k => (WORKER_DECLARATIONS.find(x=>x.k===k)||{}).chip).filter(Boolean)),
                    ] : [];
                    // ボックスは他と同じ白・グレー枠（2026-07-26たきと指示）。チップ（タグ）の青は残す
                    return (
                      <button onClick={()=>{ try { sessionStorage.setItem("cb_expFromApp","1"); } catch {} window.location.hash="/experience"; }} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"16px", cursor:"pointer", textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)", display:"block" }}>
                        <span className="f-sans" style={{ display:"block", fontSize:15, fontWeight:800, color:"#222", marginBottom: chips.length ? 8 : 4 }}>📋 経験・できること（自己申告）</span>
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
                  {/* 労働条件通知書（2026-08-18たきと指示）＝「わたしの記録」カテゴリーの1枚。
                      採用時に凍結された terms_snapshot から作る読み取り専用の通知書。表示・印刷のみ＝保存・入力は無い。
                      旧「契約の記録」（実績モーダル内）の機能はここへ統合済み＝1機能1入口 */}
                  <LaborConditionsNotice me={me} role="worker" />
                  {/* いいねした求人（2026-08-22たきと指示「マイページのわたしの記録グループにいいねした求人カードを新設」
                      →同日「その他の求人と同じカード一覧構造に」）。データ源・キャッシュはステータスページと共用
                      （my_job_actions／saved:rows）。一覧はJobCard（関連求人と同じ型・wide全幅）＋♥解除⇄再いいね */}
                  <LikedJobsCard me={me} />
                </div>
                {/* やることカード群（2026-08-22たきと指示「今日ページのカード群をマイページの
                    いいねした求人カードの下にコピー。実機確認後、今日ページの削除に移行する」）。
                    正本は今日ページ（TodayPage）＝移行中の複製。行き先の専用ページ(#/calendar/todo/*)も
                    今日ページ側に残っている（削除の段でこちらへ引っ越す） */}
                <TodayTaskBoxes role="worker" />
              </>);
            })()}
            {/* 旧・🌟わたしの実績モーダル（WorkerTrustCard hideSelfDeclare）は削除（2026-08-21）＝
                カードタップは WorkerPreviewSheet の「記録」タブ直行に一本化。
                契約の記録と印刷（2026-08-16）は「📄 労働条件通知書」カードへ移設済み（2026-08-18・1機能1入口） */}
          </>
        ) : (
        <div className="profile-content">
            {/* 浮遊の「← プロフィール」ボックスは削除（2026-07-25たきと指示・農家側の「← 農家プロ」削除と対）。
                戻りは下部ナビのプロフィールタップ（＝働き手トップへ）が担う */}
            {/* 「働き手プロフィール」の見出しは削除（2026-08-03たきと指示・名刺カードから開けば現在地は明らか）。
                他のサブページ（返事待ち・きょうの仕事）は従来どおり見出しを出す */}
            {wTab !== "wprofile" && (
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
            ) : null}{/* 旧・カレンダーページは廃止（2026-07-27）。カレンダーはステータスページ(#/saved)の上部へ移植 */}
        </div>
        )
      ) : (
        <>
          {/* 「← プロフィールへ」ボタンは削除（2026-07-14）。働き手側への行き来は浮遊「🤝 働く」トグルが担う */}
          {/* 承認待ちバナーは削除（2026-08-14 承認プロセスの廃止＝掲載は即公開。「承認後に公開できます」は嘘になるため） */}
          <FarmerDashboard onNewJob={onNewJob} onResume={onResume} me={me} />
        </>
      )}
      </div>
      {/* 退会（2026-08-07たきと指示）：プロフィール入口の最下部。編集・サブページでは出さない。
          働き手ホーム・雇い手ホームのどちらでも1箇所に出る（退会はアカウント単位ので役割不問） */}
      {(pTab === "employer" ? eHome : wTab === "home") && <ProfileWithdrawSection onLogout={onLogout} />}
    </div>
  );
}
