// 管理タブ（#/admin・管理者専用・分割3-Aで切り出し2026-07-24）：農家承認・求人審査・質問管理・お知らせ・エラーログ等。
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { openWorkerPreview } from "../../lib/previewBus";
import { fmtJstShort, SURVEY_SOURCES, SURVEY_REASONS } from "../../lib/utils";
import { Avatar, LinkifiedText, Dots } from "../ui";
import { AdminJobPreview } from "../AdminJobPreview";
import { AdminNav } from "./AdminNav";
import { getCache, setCache } from "../../lib/viewCache";

// あいうえお順の比較（アカウント面・2026-08-07）。毎描画で作らないためモジュールレベルに置く
const JA_COLLATOR = new Intl.Collator("ja");

// 審査セクションのURLキー（#/admin/review/{key}）。ボックス格子の並びと一致させる唯一の正本。
// 数字（#/admin/review/{job_number}）は求人審査プレビューへの深いリンク（従来どおり）。
// 「jobs（求人審査）」「prs（自由記述審査）」は承認プロセスの削除（2026-08-14）で廃止＝掲載・保存は即公開に
const REVIEW_SECTION_KEYS = ["disputes","questions","withdrawals","contracts"]; // reports は #/admin/reports（統合報告ページ）へ独立（2026-08-15）

// 日付キー（YYYY-MM-DD）はローカル整形で統一する。toISOString().slice(0,10)は


// きっかけ集計（管理者・2026-07-24）：source/reasonsの件数棒＋自由記述一覧。RLS survey admin selectで全件読める。
function SurveyStats() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("user_onboarding_survey").select("*").order("created_at", { ascending: false });
        setRows(data || []);
      } catch { setRows([]); }
    })();
  }, []);
  if (rows === null) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"24px 0" }}>読み込み中<Dots /></p>;
  const total = rows.length;
  const countBy = (opts, pick) => opts.map(o => ({ label:o, n: rows.filter(r => pick(r, o)).length }));
  const sourceCounts = countBy(SURVEY_SOURCES, (r,o) => r.source === o);
  const reasonCounts = countBy(SURVEY_REASONS, (r,o) => Array.isArray(r.reasons) && r.reasons.includes(o));
  const maxS = Math.max(1, ...sourceCounts.map(x=>x.n));
  const maxR = Math.max(1, ...reasonCounts.map(x=>x.n));
  const freeTexts = rows.flatMap(r => [
    ...(r.source_other && r.source_other.trim() ? [{ tag:"どこで", t:r.source_other.trim() }] : []),
    ...(r.reason_other && r.reason_other.trim() ? [{ tag:"使い方", t:r.reason_other.trim() }] : []),
  ]);
  const Bar = ({ label, n, max }) => (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
      <span className="f-sans" style={{ fontSize:12, color:"#444", width:130, flexShrink:0, textAlign:"right" }}>{label}</span>
      <div style={{ flex:1, background:"#F0F0F0", borderRadius:6, height:18, overflow:"hidden" }}>
        <div style={{ width: `${Math.round(n/max*100)}%`, minWidth: n>0?6:0, height:"100%", background:"#00A86B" }} />
      </div>
      <span className="f-mono" style={{ fontSize:12, color:"#222", width:28, flexShrink:0 }}>{n}</span>
    </div>
  );
  return (
    <div>
      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"0 0 12px" }}>回答 {total}件</p>
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 8px" }}>Q1. どこで知ったか</p>
      {sourceCounts.map(x => <Bar key={x.label} label={x.label} n={x.n} max={maxS} />)}
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"18px 0 8px" }}>Q2. どう使いたいか（複数可）</p>
      {reasonCounts.map(x => <Bar key={x.label} label={x.label} n={x.n} max={maxR} />)}
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"18px 0 8px" }}>自由記述（その他の一言）</p>
      {freeTexts.length === 0 ? (
        <p className="f-sans" style={{ fontSize:12, color:"#999", margin:0 }}>まだありません</p>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {freeTexts.map((f, i) => (
            <div key={i} style={{ background:"#F7F7F7", borderRadius:8, padding:"8px 10px" }}>
              <span className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#00A86B", marginRight:6 }}>{f.tag}</span>
              <span className="f-sans" style={{ fontSize:13, color:"#222" }}>{f.t}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminTab({ onJump, onShowAccountForm }) {
  const [sub, setSub] = useState("jobs"); // "jobs" | "account" | "other"（審査をデフォルトタブに）
  const [reviewSec, setReviewSec] = useState(null); // 審査タブ内の選択: null=ボックス格子 | jobs|accounts|prs|reports|disputes|contracts
  const [contracts, setContracts] = useState(null); // 契約スナップショット一覧（採用時に凍結・admin_list_contracts）
  const [contractDetail, setContractDetail] = useState(null); // 展開中の1件（スナップショット詳細）
  useEffect(() => {
    if (reviewSec !== "contracts" || contracts !== null) return;
    (async () => {
      const { data } = await supabase.rpc("admin_list_contracts");
      setContracts(Array.isArray(data) ? data : []);
    })();
  }, [reviewSec]); // eslint-disable-line react-hooks/exhaustive-deps
  const [accounts, setAccounts] = useState(() => getCache("admin:console")?.accounts || []); // 新アカウントタブ：admin_list_accounts()の全ユーザー台帳
  const [expandedAccount, setExpandedAccount] = useState(null); // 展開中のauth_id
  const [emailShown, setEmailShown] = useState(null); // 「メールを表示」で全文表示中のauth_id（既定はemail_masked）
  // アカウントの停止／追放（2026-07-19）：一時停止・永久追放・解除。管理者のみ・解除は手動
  const [modOpen, setModOpen] = useState(null); // 操作パネルを開いているauth_id
  const [modAction, setModAction] = useState(null); // "suspend"|"ban"|"unban"
  const [modReason, setModReason] = useState("");
  const [modBusy, setModBusy] = useState(false);
  const runModerate = async (authId, action, reason) => {
    if (modBusy) return;
    const verb = action === "suspend" ? "一時停止" : action === "ban" ? "永久追放" : "解除";
    if (!window.confirm(`このアカウントを${verb}しますか？` + (action === "unban" ? "" : "\nログインと、応募・掲載・チャット送信などが即時に止まります。"))) return;
    setModBusy(true);
    const { data, error } = await supabase.rpc("admin_moderate_account", { p_auth_id: authId, p_action: action, p_reason: reason?.trim() || null });
    setModBusy(false);
    if (error || !data?.ok) {
      alert((data?.reason === "cannot_moderate_admin" ? "運営者アカウントは対象にできません。" : "処理に失敗しました：" + (data?.reason || error?.message || "不明")));
      return;
    }
    setAccounts(prev => prev.map(a => a.auth_id === authId ? { ...a, mod_state: data.state, mod_reason: reason?.trim() || null } : a));
    setModOpen(null); setModAction(null); setModReason("");
  };
  // 運営DM（2026-07-16）：アカウントから利用者へメッセージ送信（admin_messages・利用者側はチャットの運営タブで受信）
  const [dmUser, setDmUser] = useState(null); // { auth_id, name, avatar }
  const [dmThread, setDmThread] = useState([]);
  const [dmBody, setDmBody] = useState("");
  const [dmBusy, setDmBusy] = useState(false);
  const openAccountDm = async (u) => {
    setDmUser({ auth_id: u.auth_id, name: u.nickname || u.email_masked || "利用者", avatar: u.avatar_url || null });
    setDmBody("");
    const { data } = await supabase.from("admin_messages").select("*").eq("user_id", u.auth_id).order("created_at", { ascending: true });
    setDmThread(data || []);
  };
  const sendAccountDm = async () => {
    const body = dmBody.trim();
    if (!body || dmBusy || !dmUser) return;
    setDmBusy(true);
    const { error } = await supabase.from("admin_messages").insert({ user_id: dmUser.auth_id, from_admin: true, body });
    if (error) alert("送信に失敗しました：" + error.message);
    else {
      setDmBody("");
      const { data } = await supabase.from("admin_messages").select("*").eq("user_id", dmUser.auth_id).order("created_at", { ascending: true });
      setDmThread(data || []);
    }
    setDmBusy(false);
  };
  // アカウント面の役割切り替え（2026-08-07たきと指示「雇い手と働き手で切り替え」）：
  // 働き手タブ＝worker_profilesを持つ人＋プロフィール未作成の人（受け皿・誰も消えない）／
  // 雇い手タブ＝employer_profilesを持つ人。両方持ちは両タブに出る。
  // 並びはあいうえお順（2026-08-07たきと指示・表示名のロケール比較。名前なしは最後）
  const [accountTab, setAccountTab] = useState("worker");
  const acctDisplay = (u) => accountTab === "employer"
    ? { name: u.employer_nickname || u.nickname || u.email_masked || "", avatar: u.employer_avatar_url || u.avatar_url }
    : { name: u.nickname || u.email_masked || "", avatar: u.avatar_url };
  const acctWorkers = accounts.filter(u => u.has_worker || !u.has_employer);
  const acctEmployers = accounts.filter(u => !!u.has_employer);
  const acctList = (accountTab === "employer" ? acctEmployers : acctWorkers)
    .slice()
    .sort((a, b) => JA_COLLATOR.compare(
      String(acctDisplay(a).name).trim() || "\uffff",
      String(acctDisplay(b).name).trim() || "\uffff"));
  const [otherBox, setOtherBox] = useState(null); // その他タブのポップアップ: pages|flow|legacy|system|notices|null（boxlistは#/boxes専用ページへ昇格・2026-07-17）
  // ボックス一覧の台帳は専用ページ（#/boxes・AdminBoxRegistryPage）へ昇格（2026-07-17）
  // お知らせ一覧の台帳は専用ページ（#/boxes/notices・AdminBoxRegistryPageのタブ）へ移設（2026-07-17）
  // システム（SQL／エラー／画像軽量化）は専用ページ #/admin/system（AdminSystemRoom）へ移設（2026-08-03たきと指示）
  // 前回の内容（viewCache）があれば読み込み中を出さず即描画する（他ページと同じSWR・2026-08-07）
  const [loading, setLoading] = useState(() => !getCache("admin:console"));

  const [withdrawals, setWithdrawals] = useState(() => getCache("admin:console")?.withdrawals || []); // 退会申請の未対応一覧（プラポリv3第7条1：申し出から30日以内に手動削除）
  // 求人審査キュー（pendingJobs）・自由記述の審査キュー（pendingPrs・empTexts）は
  // 承認プロセスの削除（2026-08-14）で廃止。掲載・保存＝即公開＋運営FYIメール（事後確認）に置き換え
  const [reports, setReports] = useState(() => getCache("admin:console")?.reports || []); // 通報（job_reports）
  const [msgReports, setMsgReports] = useState(() => getCache("admin:console")?.msgReports || []); // チャットのコメント報告（message_reports・2026-07-19）
  const [profReports, setProfReports] = useState(() => getCache("admin:console")?.profReports || []); // 働き手プレビューからの報告（profile_reports・2026-08-06）
  const [fbReports, setFbReports] = useState(() => getCache("admin:console")?.fbReports || []); // 画面の報告（feedback・2026-08-15）。表示は統合報告ページ＝ここではバッジの数のみ
  const [adminQuestions, setAdminQuestions] = useState(() => getCache("admin:console")?.adminQuestions || []); // 求人Q&A（job_questions・第10弾・非表示スイッチ）
  const [qHidingId, setQHidingId] = useState(null);
  const hideQuestion = async (id, hidden) => {
    if (qHidingId) return;
    setQHidingId(id);
    try {
      const { data } = await supabase.rpc("admin_hide_question", { p_id: id, p_hidden: hidden });
      if (data?.ok) setAdminQuestions(prev => prev.map(q => q.id === id ? { ...q, hidden } : q));
    } catch {}
    setQHidingId(null);
  };
  const [disputes, setDisputes] = useState(() => getCache("admin:console")?.disputes || []); // 欠勤記録への異議（attendance_events kind=dispute_no_show）
  // 自由記述の審査（公開ボタン・修正依頼フォーム）は承認プロセスの削除（2026-08-14）で廃止。
  // 公開後の対処＝アカウント面の運営DM＋管理者RLSでの直接編集
  const [publishing, setPublishing] = useState(null);
  const [previewJobNumber, setPreviewJobNumber] = useState(null);
  // 修正依頼は審査プレビュー内のタップ式指摘に一本化（2026-07-19）。送信はsubmitJobRevisionで実行

  // ページ遷移らしく先頭から見せる（審査ページはダッシュボードの下の方から開くため）
  const scrollTop = () => { try { window.scrollTo({ top: 0, behavior: "auto" }); } catch { window.scrollTo(0, 0); } };

  // 審査ページの深いリンク対応（#/admin/review/{key} と #/admin/review/{job_number}）。
  //  ・数字 → 求人審査プレビューを開く（審査メールのボタンからの従来経路）
  //  ・セクションキー → 各審査一覧を開く（お知らせ・ブックマーク・直リンクから）
  // マウント時に加え、既にAdminTabが開いた状態で別の審査リンクを踏んだ場合(hashchange)にも追従。
  // 一致しないハッシュ（#/admin 等）では何もしない＝戻る/他操作でセクション選択を消さない。
  useEffect(() => {
    const applyReviewHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      const m = h.match(/^admin\/review\/(.+)$/);
      if (!m) return;
      const seg = m[1];
      if (/^\d+$/.test(seg)) { setSub("jobs"); setPreviewJobNumber(parseInt(seg, 10)); scrollTop(); return; }
      if (REVIEW_SECTION_KEYS.includes(seg)) { setSub("jobs"); setPreviewJobNumber(null); setReviewSec(seg); scrollTop(); }
    };
    applyReviewHash();
    window.addEventListener("hashchange", applyReviewHash);
    return () => window.removeEventListener("hashchange", applyReviewHash);
  }, []);

  // 審査セクションへ移動／格子へ戻る（状態とURLを同時に動かす＝ボックスが共有可能なリンクになる。URL変更→上のeffectが発火し先頭へスクロール）
  const goReview = (key) => { setSub("jobs"); setPreviewJobNumber(null); setReviewSec(key); window.location.hash = "/admin/review/" + key; };
  const backToReviewGrid = () => { setReviewSec(null); window.location.hash = "/admin"; scrollTop(); };


  const load = useCallback(async () => {
    // 前回内容を表示中ならスピナーで隠さない（裏で差し替え）。初回だけ読み込み中を出す
    if (!getCache("admin:console")) setLoading(true);
    const [jr, av, la, mr, jq, wd, pr, fb] = await Promise.all([
      supabase.from("job_reports").select("*").order("created_at",{ascending:false}),
      supabase.from("attendance_events").select("*").eq("kind","dispute_no_show").order("created_at",{ascending:false}),
      supabase.rpc("admin_list_accounts"),
      supabase.from("message_reports").select("*").order("created_at",{ascending:false}),
      supabase.from("job_questions").select("*").order("created_at",{ascending:false}),
      supabase.from("withdrawal_requests").select("*").is("processed_at", null).order("requested_at",{ascending:true}),
      supabase.from("profile_reports").select("*").order("created_at",{ascending:false}),
      supabase.from("feedback").select("id,status").order("created_at",{ascending:false}),
    ]);
    // 成功した分だけを反映し、同じものをviewCacheへ写す（次に開いた時・引き下げ更新後は即描画）
    const next = {};
    if (!jr.error) next.reports = jr.data || [];
    if (!av.error) next.disputes = av.data || [];
    if (!la.error && Array.isArray(la.data)) next.accounts = la.data; // {ok:false,reason:'not_admin'}時は配列でないため無視
    if (!mr.error) next.msgReports = mr.data || [];
    if (!jq.error) next.adminQuestions = jq.data || [];
    if (!wd.error) next.withdrawals = wd.data || [];
    if (!pr.error) next.profReports = pr.data || [];
    if (!fb.error) next.fbReports = fb.data || [];
    if (next.reports) setReports(next.reports);
    if (next.disputes) setDisputes(next.disputes);
    if (next.accounts) setAccounts(next.accounts);
    if (next.msgReports) setMsgReports(next.msgReports);
    if (next.adminQuestions) setAdminQuestions(next.adminQuestions);
    if (next.withdrawals) setWithdrawals(next.withdrawals);
    if (next.profReports) setProfReports(next.profReports);
    if (next.fbReports) setFbReports(next.fbReports);
    setCache("admin:console", { ...(getCache("admin:console") || {}), ...next });
    setLoading(false);
  }, []);


  // 退会申請を対応済みにする（削除作業の完了後に押す。素のconfirmはこのスコープのstateに解決されるためwindow.confirm必須・2026-07-29教訓）
  const completeWithdrawal = async (w) => {
    if (!window.confirm("この退会申請を対応済みにしますか？30日以内の削除作業を完了してから押してください")) return;
    const { error } = await supabase.from("withdrawal_requests").update({ processed_at: new Date().toISOString() }).eq("id", w.id);
    if (error) { alert("更新に失敗しました：" + error.message); return; }
    setWithdrawals(prev => prev.filter(x => x.id !== w.id));
  };

  // ── 審査タブ集約アクション（2026-07-14・DB側は app_admins 基準の審査ポリシーで担保） ──
  // アカウント承認（approveFarmerAccount）は2026-08-07廃止（たきと指示）：
  // 現在の登録フローは farmers 行を作らない＝キューに新規that入らず、farmers.status を見る
  // ポリシー・関数もゼロ＝承認しても何も変わらない死んだ機能だった。アカウントの統制は
  // signup_open（入口・キルスイッチ）＋account_holders（本人確認）＋account_moderation（停止/追放）that担う
  // resolveReport/resolveMsgReport/resolveProfReport は統合報告ページ（AdminReportsRoom・2026-08-15）へ移設

  const publishJob = async (jobNumber) => {
    if (publishing) return;
    setPublishing(jobNumber);
    const { error } = await supabase.from("jobs").update({ status: "open" }).eq("job_number", jobNumber);
    setPublishing(null);
    if (error) { alert("公開に失敗しました：" + error.message); return; }
    load();
  };
  useEffect(() => { load(); }, [load, sub]);

  // タップ式修正依頼の送信（2026-07-19）：プレビューで積み上げた指摘テキストを受け取りRPC送信。成否をbooleanで返す
  const submitJobRevision = async (jobNumber, reasonText) => {
    if (!reasonText) return false;
    const { data, error } = await supabase.rpc('request_job_revision', { p_job_number: jobNumber, p_reason: reasonText });
    if (error || !data?.ok) { alert("修正依頼の送信に失敗しました：" + (data?.reason || error?.message || "不明")); return false; }
    setTimeout(() => { setPreviewJobNumber(null); window.location.hash = "/admin"; load(); }, 1300);
    return true;
  };


  // 審査タブに全ての審査待ちを集約（2026-07-14）：求人＋アカウント承認＋自由記述＋通報＋異議
  const openReports = reports.filter(r => r.status !== "resolved");
  const openMsgReports = msgReports.filter(r => r.status !== "resolved");
  const openProfReports = profReports.filter(r => r.status !== "resolved");
  const openFbReports = fbReports.filter(r => r.status !== "resolved"); // 画面の報告（2026-08-15・バッジ用）
  const reviewTotal = openReports.length + openMsgReports.length + openProfReports.length + openFbReports.length + disputes.length;
  const TOP_TABS = [
    { k:"jobs",    l:"審査",       n: reviewTotal },
    { k:"account", l:"アカウント", n: null },
    { k:"other",   l:"その他",     n: null },
  ];
  const topTab = sub==="jobs" ? "jobs" : sub==="account" ? "account" : "other";

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
    /* cb-admin-page＝管理画面で操作するページの目印。サイトフッターを隠す（下部バー・浮遊☰は出す・appStyles・2026-08-05たきと指示）
       下余白＝下部バー(64px)＋浮遊☰(バーの12px上・高さ約44px)ぶんを空けておく
       （2026-08-07たきと指示「邪魔してタップできないカードがある」＝最下段のカードが隠れない） */
    <div className="appear cb-admin-page" style={{ maxWidth:800, margin:"0 auto", paddingBottom:"calc(140px + env(safe-area-inset-bottom, 0px))" }}>

      {/* 運営DMスレッド（アカウント→「運営メッセージを送る」で展開・2026-07-16） */}
      {dmUser && (
        <div onClick={()=>setDmUser(null)} style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
              <button onClick={()=>setDmUser(null)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
              <Avatar url={dmUser.avatar} name={dmUser.name} size={28} />
              <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>{dmUser.name} さんへのメッセージ</p>
            </div>
            <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:16, display:"flex", flexDirection:"column", gap:10 }}>
              {dmThread.length === 0 ? (
                <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>まだメッセージはありません</p>
              ) : dmThread.map(m => (
                <div key={m.id} style={{ alignSelf: m.from_admin ? "flex-end" : "flex-start", maxWidth:"85%" }}>
                  {!m.from_admin && <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"0 0 2px" }}>{dmUser.name}</p>}
                  <div className="f-sans" style={{ background: m.from_admin ? "#00A86B" : "#F5F5F5", color: m.from_admin ? "#fff" : "#222", borderRadius:14, padding:"10px 14px", fontSize:14, lineHeight:1.7, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}><LinkifiedText text={m.body} /></div>
                  <p className="f-sans" style={{ fontSize:10, color:"#C8C8C8", margin:"3px 2px 0", textAlign: m.from_admin ? "right" : "left" }}>{fmtJstShort(m.created_at)}{m.from_admin && m.read_at ? "・既読" : ""}</p>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:8, padding:"10px 12px", borderTop:"1px solid #F0F0F0", flexShrink:0 }}>
              <textarea value={dmBody} onChange={e=>setDmBody(e.target.value)} placeholder="メッセージを入力（運営として送信されます）" rows={2} className="field f-sans" style={{ flex:1, marginBottom:0, fontSize:14, resize:"none" }} />
              <button onClick={sendAccountDm} disabled={dmBusy || !dmBody.trim()} className="btn-primary f-sans" style={{ padding:"0 18px", fontSize:14, fontWeight:700, opacity: (dmBusy || !dmBody.trim()) ? 0.5 : 1 }}>{dmBusy ? "..." : "送信"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 審査セクションを開いている間はダッシュボードの見出し＋メインタブを隠し、セクションを1枚のページとして見せる */}
      {!reviewSec && (<>
      {/* 管理ページの共通ナビ（全ページ導線・2026-08-02） */}
      <AdminNav current="admin" />
      <div style={{ marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <p className="f-sans" style={{ fontSize:18,fontWeight:700,color:"#222",marginBottom:4 }}>管理者コンソール</p>
          <p className="f-sans" style={{ fontSize:12,color:"#717171" }}>審査・アカウント・運営ツール</p>
        </div>
        <button onClick={() => { load(); }} style={{
          padding:"8px 16px", borderRadius:10, border:"1px solid #EBEBEB",
          background:"#fff", fontSize:12, fontWeight:600, color:"#222",
          cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", gap:6,
        }}>
          更新
        </button>
      </div>

      {/* メインタブ（求人審査をデフォルト・毎日使うのはここだけ） */}
      <div style={{ display:"flex",gap:4,background:"#F7F7F7",border:"1px solid #EBEBEB",borderRadius:12,padding:4,marginBottom:24 }}>
        {TOP_TABS.map(({ k, l, n }) => (
          <button key={k} onClick={() => setSub(k)} style={{
            flex:1, padding:"11px 8px", border:"none", borderRadius:8, fontFamily:"inherit",
            background:topTab===k?"#fff":"transparent",
            color:topTab===k?"#222":"#717171",
            fontSize:13, fontWeight:topTab===k?700:400,
            boxShadow:topTab===k?"0 1px 4px rgba(0,0,0,0.08)":"none",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            cursor:"pointer",
          }}>
            {l}
            {n!=null&&n>0&&<span style={{ padding:"1px 6px",borderRadius:8,fontSize:9,fontWeight:700,background:topTab===k?"#E6F7EF":"#EBEBEB",color:topTab===k?"#00A86B":"#717171" }}>{n}</span>}
          </button>
        ))}
      </div>
      </>)}

      {/* ── その他（ボックス化・2026-07-16）：カード格子。タップの行き先はカードごとに3種類ある
           （①専用ページへ遷移＝仕事中・まもなく開始・評価・システム・ボックス一覧・お知らせ一覧・委託・農家のアクションページ
             ②その場で画面を開く＝新規登録画面
             ③ポップアップ展開＝求人フロー・旧事業データ・きっかけ）。
           行き先は下のonClickの分岐1箇所に集約する（カードを足したらここに1行足す） ── */}
      {sub==="other" && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12, marginBottom:24 }}>
          {[
            { k:"signup",  l:"新規登録画面" },
            { k:"flow",    l:"求人フロー" },
            { k:"system",  l:"システム" },
            { k:"survey",  l:"きっかけ" },
            { k:"working", l:"仕事中" },
            { k:"upcoming", l:"まもなく開始" },
            { k:"evaluation", l:"評価" },
            { k:"farmerpages", l:"農家のアクションページ" },
            { k:"animations", l:"アニメーション" },
          ].map(c => (
            <button key={c.k} onClick={()=>{ if (c.k === "working") { window.location.hash = "/admin/working"; } else if (c.k === "upcoming") { window.location.hash = "/admin/upcoming"; } else if (c.k === "evaluation") { window.location.hash = "/admin/evaluation"; } else if (c.k === "system") { window.location.hash = "/admin/system"; } else if (c.k === "farmerpages") { window.location.hash = "/admin/farmer-pages"; } else if (c.k === "animations") { window.location.hash = "/admin/animations"; } else if (c.k === "signup") { onShowAccountForm(); } else { setOtherBox(c.k); } }} className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"22px 8px 18px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:10, boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
              <span style={{ fontSize:13, fontWeight:700, color:"#222" }}>{c.l}</span>
            </button>
          ))}
        </div>
      )}

      {/* その他のポップアップ（ポップアップ0.8秒・下限=下部フッター+10px・✕/背景タップで閉じる） */}
      {sub==="other" && otherBox && (
        <div onClick={()=>setOtherBox(null)} style={{ position:"fixed", inset:0, zIndex:600, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
              <button onClick={()=>setOtherBox(null)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
              <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>
                {otherBox==="flow" ? "求人フロー" : "きっかけ"}
              </p>
            </div>
            <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y", padding:16 }}>

              {otherBox==="survey" && <SurveyStats />}

              {/* 「主要ページ」ボックスは削除（2026-08-11たきと指示）。中にあった画面ジャンプ
                  （さがす／プロフィール／ログイン／運営憲章）も一緒に廃止。
                  唯一の実務用途だった「①登録画面を再表示」は、格子の「新規登録画面」カードに昇格した
                  （カード＝1タップで新規登録画面へ・ポップアップを挟まない） */}

              {otherBox==="flow" && (<>
                <p className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", marginBottom:8 }}>開発: 画面ジャンプ(LandingFlow)</p>
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
              </>)}

            </div>
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign:"center",padding:48,color:"#B0B0B0",fontSize:13 }}>読み込み中<Dots /></div>}

      {/* ── アカウント（2026-07-16アイコンカード化）：3列グリッド・アイコン＋ニックネームのみ（他一覧と同設計）。
           タップで詳細ボックス展開（閲覧＋運営DMのみ）。承認・差し戻しはここでは一切行わない＝審査タブに集約 ── */}
      {!loading && sub==="account" && (
        <div className="fade-in">
          {accounts.length === 0 && <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", padding:"32px 0", textAlign:"center" }}>アカウントを取得できませんでした。「更新」を押してください</p>}
          {/* 役割切り替え（ボックス一覧の2タブと同じ意匠） */}
          {accounts.length > 0 && (
            <div style={{ display:"flex", gap:8, margin:"0 0 14px" }}>
              {[
                { k:"worker",   l:"働き手", n:acctWorkers.length },
                { k:"employer", l:"雇い手", n:acctEmployers.length },
              ].map(t => (
                <button key={t.k} onClick={()=>setAccountTab(t.k)} className="f-sans"
                  style={{ flex:1, padding:"11px 0", borderRadius:12, border: accountTab===t.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:14, fontWeight: accountTab===t.k ? 800 : 600, color: accountTab===t.k ? "#222" : "#999", cursor:"pointer" }}>
                  {t.l}{t.n > 0 ? `（${t.n}）` : ""}
                </button>
              ))}
            </div>
          )}
          {accounts.length > 0 && acctList.length === 0 && (
            <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", padding:"32px 0", textAlign:"center" }}>このタブに該当するアカウントはありません</p>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
            {acctList.map(u => (
              <button key={u.auth_id} onClick={()=>{ setEmailShown(null); setExpandedAccount(u.auth_id); }}
                className="f-sans"
                style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                  {acctDisplay(u).avatar
                    ? <img loading="lazy" src={acctDisplay(u).avatar} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter: u.mod_state && u.mod_state !== "active" ? "grayscale(1) opacity(0.6)" : "none" }} />
                    : <Avatar url={null} name={acctDisplay(u).name || "？"} size={64} />}
                  {/* 状態マーク（右上）：停止/追放＞通報＞確認待ち＞未ログインの優先順で1つだけ */}
                  {(u.mod_state && u.mod_state !== "active") ? (
                    <span style={{ position:"absolute", top:6, right:6, padding:"2px 7px", borderRadius:9, background: u.mod_state === "banned" ? "#E24B4A" : "#C77700", color:"#fff", fontSize:10, fontWeight:800, boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}>{u.mod_state === "banned" ? "追放" : "停止"}</span>
                  ) : (u.reported > 0 || u.pending_text || u.never_signed_in) && (
                    <span className="f-sans" style={{ position:"absolute", top:6, right:6, padding:"2px 7px", borderRadius:9, background: u.reported > 0 ? "#E24B4A" : (u.pending_text ? "#C77700" : "#B0B0B0"), color:"#fff", fontSize:10, fontWeight:800, boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}>
                      {u.reported > 0 ? "通報" : (u.pending_text ? "確認待ち" : "未ログイン")}
                    </span>
                  )}
                </div>
                <p className="f-sans" style={{ fontSize:13, fontWeight:600, color: acctDisplay(u).name ? "#222" : "#999", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{acctDisplay(u).name || "—"}</p>
              </button>
            ))}
          </div>

          {/* アカウント詳細ボックス（閲覧専用＋運営DM。承認操作は置かない） */}
          {(() => {
            const u = accounts.find(a => a.auth_id === expandedAccount);
            if (!u) return null;
            const badgeSt = (bg, fg) => ({ padding:"3px 10px", borderRadius:9, fontSize:11, fontWeight:700, background:bg, color:fg, whiteSpace:"nowrap" });
            return (
              <div onClick={()=>{ setExpandedAccount(null); setEmailShown(null); }} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                {/* cb-lock-scroll＝展開中は背後のページを固定（2026-08-07たきと指示「ボックス展開中は画面スクロール解除」）。
                    下部バー・☰thが隠れるので、下端はバー前提でなくセーフエリア+10pxまで伸ばす */}
                <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                    <button onClick={()=>{ setExpandedAccount(null); setEmailShown(null); }} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                    <Avatar url={acctDisplay(u).avatar} name={acctDisplay(u).name} size={30} />
                    <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{acctDisplay(u).name || "—"}</p>
                  </div>
                  <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 16px 16px" }}>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                      {u.has_id_check && <span className="f-sans" style={badgeSt("#E6F7EF","#00A86B")}>✓ 本人確認</span>}
                      {u.pending_text && <span className="f-sans" style={badgeSt("#FFF4E0","#C77700")}>確認待ち{u.pending_since ? ` ${u.pending_since}` : ""}</span>}
                      {u.never_signed_in && <span className="f-sans" style={badgeSt("#F5F5F5","#717171")}>未ログイン</span>}
                      {u.reported > 0 && <span className="f-sans" style={badgeSt("#FDECEC","#E24B4A")}>通報×{u.reported}</span>}
                    </div>
                    {/* メール行：既定はマスク表示。「メールを表示」タップで全文（コピー用） */}
                    <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                      <span className="f-sans" style={{ fontSize:12, color:"#B0B0B0", minWidth:72, flexShrink:0 }}>メール</span>
                      <span className="f-sans" style={{ fontSize:13, color:"#222", overflowWrap:"break-word", wordBreak:"break-all", userSelect:"text" }}>
                        {emailShown === u.auth_id ? (u.email || "—") : (u.email_masked || "—")}
                        {u.email && (emailShown === u.auth_id ? (
                          <button onClick={()=>setEmailShown(null)} className="f-sans" style={{ background:"none", border:"none", fontSize:12, color:"#717171", textDecoration:"underline", cursor:"pointer", padding:0, marginLeft:8 }}>隠す</button>
                        ) : (
                          <button onClick={()=>setEmailShown(u.auth_id)} className="f-sans" style={{ background:"none", border:"none", fontSize:12, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0, marginLeft:8 }}>メールを表示</button>
                        ))}
                      </span>
                    </div>
                    {[
                      { label:"登録日",       value: u.created_jst || "—" },
                      { label:"最終ログイン", value: u.never_signed_in ? "未ログイン" : (u.last_sign_in_jst || "—") },
                      { label:"本人確認",     value: u.has_id_check ? (u.id_check_month || "済") : "未" },
                      { label:"活動",         value: `応募${u.apps_applied ?? 0}・完了${u.apps_completed ?? 0}・求人${u.jobs_posted ?? 0}・また呼びたい${u.want_again ?? 0}` },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                        <span className="f-sans" style={{ fontSize:12, color:"#B0B0B0", minWidth:72, flexShrink:0 }}>{label}</span>
                        <span className="f-sans" style={{ fontSize:13, color:"#222", overflowWrap:"break-word", wordBreak:"break-word" }}>{value}</span>
                      </div>
                    ))}
                    <button onClick={()=>openAccountDm(u)} className="f-sans" style={{ marginTop:12, width:"100%", padding:"12px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>運営メッセージを送る</button>
                    {/* 自由記述の確認待ち注記は削除（2026-08-14 承認プロセスの廃止＝保存で即公開・確認待ちが存在しない） */}

                    {/* アカウントの停止／追放（2026-07-19）：管理者のみ。ログイン封鎖＋アプリ内操作の封鎖＋公開物の非表示 */}
                    <div style={{ marginTop:16, borderTop:"1px solid #F0F0F0", paddingTop:14 }}>
                      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 8px" }}>アカウントの制限</p>
                      {(u.mod_state && u.mod_state !== "active") ? (
                        <div>
                          <div className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, background: u.mod_state === "banned" ? "#FDECEC" : "#FFF7ED", border:"1px solid " + (u.mod_state === "banned" ? "#F5B5B5" : "#FDBA74"), borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
                            <span style={{ fontSize:13, fontWeight:800, color: u.mod_state === "banned" ? "#E24B4A" : "#C77700" }}>{u.mod_state === "banned" ? "永久追放中" : "一時停止中"}</span>
                            {u.mod_reason && <span style={{ fontSize:12, color:"#717171" }}>理由：{u.mod_reason}</span>}
                          </div>
                          <p className="f-sans" style={{ fontSize:11, color:"#999", lineHeight:1.7, margin:"0 0 10px" }}>ログイン・応募・掲載・チャット送信が止まり、公開求人とプロフィールは非表示になっています。チャット履歴は保全されています。</p>
                          <button onClick={()=>runModerate(u.auth_id, "unban")} disabled={modBusy} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{modBusy ? "処理中..." : "制限を解除する"}</button>
                        </div>
                      ) : modOpen === u.auth_id ? (
                        <div className="fade-in">
                          <textarea value={modReason} onChange={e=>setModReason(e.target.value)} placeholder="理由（任意・運営の記録用。本人には表示しません）" rows={2} className="field f-sans" style={{ fontSize:13, marginBottom:10, resize:"vertical" }} />
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={()=>{ setModOpen(null); setModReason(""); }} className="f-sans" style={{ flex:1, padding:"12px", fontSize:13, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>やめる</button>
                            <button onClick={()=>runModerate(u.auth_id, "suspend", modReason)} disabled={modBusy} className="f-sans" style={{ flex:1, padding:"12px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>一時停止</button>
                            <button onClick={()=>runModerate(u.auth_id, "ban", modReason)} disabled={modBusy} className="f-sans" style={{ flex:1, padding:"12px", fontSize:13, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>永久追放</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={()=>{ setModOpen(u.auth_id); setModReason(""); }} className="f-sans" style={{ width:"100%", padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer" }}>アカウントを制限する（停止・追放）</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}



      {/* ── 審査（全ての審査待ちをここに集約・2026-07-14）：入口はプロフィール型のボックス格子。
           タップで各審査の一覧へ(reviewSec)。未完了数はボックス右上の赤バッジ ── */}
      {sub==="jobs" && !reviewSec && !loading && (
        <div className="fade-in" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {[
            { k:"reports",  l:"通報",           n:openReports.length + openMsgReports.length + openProfReports.length + openFbReports.length },
            { k:"disputes", l:"欠勤異議",       n:disputes.length },
            { k:"questions",l:"質問",           n:0 },
            { k:"withdrawals", l:"退会申請",    n:withdrawals.length },
            { k:"contracts",l:"契約記録",       n:0 },
          ].map(c => (
            <button key={c.k} onClick={()=>{ if (c.k === "reports") { window.location.hash = "/admin/reports"; return; } goReview(c.k); }} className="f-sans" style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"26px 8px 20px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
              {c.n > 0 && (
                <span style={{ position:"absolute", top:10, right:10, minWidth:22, height:22, borderRadius:11, background:"#E24B4A", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{c.n}</span>
              )}
              <span style={{ fontSize:15, fontWeight:700, color:"#222" }}>{c.l}</span>
            </button>
          ))}
        </div>
      )}
      {sub==="jobs" && reviewSec && (
        <div className="fade-in" style={{ display:"grid", gap:16 }}>
        <button onClick={backToReviewGrid} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, color:"#717171", padding:"4px 0", justifySelf:"start" }}>← 審査</button>

        {/* 通報の一覧は統合報告ページ（#/admin/reports・AdminReportsRoom・2026-08-15）へ一本化。格子の「通報」カードから遷移 */}
        {reviewSec==="questions" && (
        <div>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 6px" }}>求人への質問{adminQuestions.length > 0 ? `（${adminQuestions.length}）` : ""}</p>
          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 12px", lineHeight:1.7 }}>不適切な質問・回答は「非表示にする」で公開から外せます（本人・農家・運営には残ります）。</p>
          <div style={{ display:"grid", gap:12 }}>
            {adminQuestions.length === 0 ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>質問はありません</p>
            ) : adminQuestions.map(q => (
              <div key={q.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background: q.hidden ? "#FAFAFA" : "#fff", opacity: q.hidden ? 0.7 : 1 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:6 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>求人 #{q.job_number}{q.hidden ? "　（非表示中）" : ""}</p>
                  <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0 }}>{q.created_at ? new Date(q.created_at).toLocaleString("ja-JP") : ""}</span>
                </div>
                <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:"0 0 6px", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>Q. {q.question}</p>
                <p className="f-sans" style={{ fontSize:13, color: q.answer ? "#0B6B4F" : "#B0B0B0", lineHeight:1.7, margin:"0 0 10px", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>A. {q.answer || "未回答"}</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setPreviewJobNumber(q.job_number)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>求人を見る</button>
                  <button onClick={()=>hideQuestion(q.id, !q.hidden)} disabled={qHidingId===q.id} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background: q.hidden ? "#00A86B" : "#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{qHidingId===q.id ? "..." : q.hidden ? "再表示する" : "非表示にする"}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* ⑤ 欠勤記録への異議（attendance_events・表示のみ。対応は当事者チャット等で） */}
        {reviewSec==="disputes" && (
        <div>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 10px" }}>欠勤記録への異議{disputes.length > 0 ? `（${disputes.length}）` : ""}</p>
          <div style={{ display:"grid", gap:12 }}>
            {disputes.length === 0 ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>異議申立はありません</p>
            ) : disputes.map(d => (
              <div key={d.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:6 }}>
                  <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0 }}>応募ID：{String(d.application_id || "").slice(0, 8)}…</p>
                  <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0 }}>{d.created_at ? new Date(d.created_at).toLocaleString("ja-JP") : ""}</span>
                </div>
                <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap" }}>{d.reason || ""}</p>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* 退会申請（プラポリv3第7条1）：申し出から30日以内にたきとが手動で削除し、完了後に対応済みにする */}
        {reviewSec==="withdrawals" && (
        <div>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 6px" }}>退会申請{withdrawals.length > 0 ? `（${withdrawals.length}）` : ""}</p>
          <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 12px" }}>申し出から30日以内に、本人確認情報とプロフィールを削除します（プラポリ第7条1）。削除作業の完了後に「対応済みにする」を押してください。</p>
          <div style={{ display:"grid", gap:10 }}>
            {withdrawals.length === 0 ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>未対応の退会申請はありません</p>
            ) : withdrawals.map(w => {
              const acct = accounts.find(a => a.auth_id === w.auth_id);
              const deadline = new Date(w.requested_at); deadline.setDate(deadline.getDate() + 30);
              const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
              return (
                <div key={w.id} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:6 }}>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {acct ? (acct.nickname || acct.email_masked || "利用者") : `auth_id：${String(w.auth_id).slice(0, 8)}…`}
                    </p>
                    <span className="f-sans" style={{ fontSize:11, color: daysLeft <= 7 ? "#E24B4A" : "#B0B0B0", fontWeight: daysLeft <= 7 ? 700 : 400, flexShrink:0 }}>期限まで{Math.max(daysLeft, 0)}日</span>
                  </div>
                  <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 10px" }}>
                    申し出：{fmtJstShort(w.requested_at)}／削除期限：{deadline.toLocaleDateString("ja-JP")}
                  </p>
                  <button onClick={()=>completeWithdrawal(w)} className="f-sans" style={{ padding:"9px 18px", background:"#fff", border:"1px solid #222", borderRadius:10, fontSize:12, fontWeight:600, color:"#222", cursor:"pointer" }}>対応済みにする</button>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* ⑥ 契約スナップショット（採用時に凍結・terms_snapshot）：争いの証跡。閲覧専用 */}
        {reviewSec==="contracts" && (
        <div>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 6px" }}>契約スナップショット{contracts ? `（${contracts.length}）` : ""}</p>
          <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"0 0 12px" }}>採用が決まった瞬間（働き手の確認＋農家の採用）の契約条件を、そのまま凍結した記録です。あとから求人を編集しても、この内容は変わりません。</p>
          <div style={{ display:"grid", gap:10 }}>
            {contracts === null ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>読み込み中<Dots /></p>
            ) : contracts.length === 0 ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>凍結された契約はまだありません（両者が確認・採用した時点で記録されます）</p>
            ) : contracts.map(c => {
              const s = c.snapshot || {};
              const title = [s.crop, s.task].filter(Boolean).join(" ") || `求人 #${c.job_number}`;
              return (
                <button key={c.application_id} onClick={()=>setContractDetail(c)} className="f-sans" style={{ display:"block", width:"100%", textAlign:"left", border:"1px solid #EBEBEB", borderRadius:12, padding:"14px 16px", background:"#fff", cursor:"pointer" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8 }}>
                    <span style={{ fontSize:14, fontWeight:700, color:"#222" }}>{title} <span style={{ fontSize:11, color:"#C8C8C8" }}>#{c.job_number}</span></span>
                    <span style={{ fontSize:11, color:"#B0B0B0", flexShrink:0 }}>{c.snapshot_at || ""}</span>
                  </div>
                  <p style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>{c.farmer_name || "農家"} ⇄ {c.worker_name || "働き手"}</p>
                </button>
              );
            })}
          </div>
        </div>
        )}

        </div>
      )}

      {/* 契約スナップショット詳細（凍結内容の全項目・閲覧専用・中央ボックス規格） */}
      {contractDetail && createPortal(
        <div onClick={()=>setContractDetail(null)} className="cb-box-overlay cb-lock-scroll" style={{ zIndex:9600 }}>{/* cb-lock-scroll＝展開中は背後スクロール固定（2026-08-15） */}
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:460, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setContractDetail(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2 }}>✕</button>
            {(() => {
              const c = contractDetail; const s = c.snapshot || {};
              const title = [s.crop, s.task].filter(Boolean).join(" ") || `求人 #${c.job_number}`;
              const wage = s.pay_type === "日給" ? (s.daily_wage ? `日給 ${s.daily_wage}円` : "") : (s.hourly_wage ? `時給 ${s.hourly_wage}円` : "");
              const rows = [
                ["求人", `${title}　#${c.job_number}`],
                ["当事者", `農家：${c.farmer_name || "—"}／働き手：${c.worker_name || "—"}`],
                ["凍結時刻", c.snapshot_at || "—"],
                ["働き手の確認", c.worker_confirmed_at || "—"],
                ["農家の採用", c.farmer_confirmed_at || "—"],
                ["日程", s.date_label || [s.date_start, s.date_end].filter(Boolean).join("〜") || "—"],
                ["勤務時間", s.work_time || "—"],
                ["休憩", s.break_time || "—"],
                ["募集人数", s.headcount != null ? `${s.headcount}名` : "—"],
                ["報酬", wage || "—"],
                ["満額支払", s.full_pay_guarantee ? "あり" : "—"],
                ["場所", [s.prefecture, s.city, s.town, s.address].filter(Boolean).join("") || "—"],
                ["最寄り駅", s.nearest_station ? `${s.nearest_station}（${s.commute_time || "—"}）` : "—"],
                ["持ち物", s.belongings || "—"],
                ["注意・備考", s.cautions || "—"],
                ["作業説明", s.notes || "—"],
              ];
              return (
                <>
                  <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#00A86B", margin:"0 0 2px" }}>契約スナップショット（凍結・閲覧専用）</p>
                  <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{title}</p>
                  <div style={{ display:"grid", gap:8 }}>
                    {rows.map(([k, v]) => (
                      <div key={k} style={{ display:"flex", gap:10, borderBottom:"1px solid #F7F7F7", paddingBottom:8 }}>
                        <span className="f-sans" style={{ fontSize:12, color:"#B0B0B0", minWidth:72, flexShrink:0 }}>{k}</span>
                        <span className="f-sans" style={{ fontSize:13, color:"#222", overflowWrap:"break-word", wordBreak:"break-word", whiteSpace:"pre-wrap" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(s.photos) && s.photos.length > 0 && (
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:12 }}>
                      {s.photos.map((p, i) => { const u = typeof p === "string" ? p : p?.url; return u ? <img loading="lazy" key={i} src={u} alt="" style={{ width:72, height:72, objectFit:"cover", borderRadius:8, border:"1px solid #EEE" }} /> : null; })}
                    </div>
                  )}
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, margin:"14px 0 0" }}>この記録は採用時に凍結されており、変更できません（争いの証跡）。</p>
                </>
              );
            })()}
          </div>
        </div>,
        document.body
      )}

      {previewJobNumber != null && (
        <AdminJobPreview
          jobNumber={previewJobNumber}
          publishing={publishing===previewJobNumber}
          onClose={()=>{ setPreviewJobNumber(null); window.location.hash = reviewSec ? ("/admin/review/" + reviewSec) : "/admin"; }}
          onPublish={async ()=>{ await publishJob(previewJobNumber); setPreviewJobNumber(null); window.location.hash = reviewSec ? ("/admin/review/" + reviewSec) : "/admin"; }}
          onRequestRevision={(reasonText)=>submitJobRevision(previewJobNumber, reasonText)}
        />
      )}

      {/* 旧・差し戻しモーダル（ドロップダウン式）は、審査プレビューのタップ式指摘に置き換え（2026-07-19） */}




    </div>
  );
}
