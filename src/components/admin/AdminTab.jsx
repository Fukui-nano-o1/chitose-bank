// 管理タブ（#/admin・管理者専用・分割3-Aで切り出し2026-07-24）：農家承認・求人審査・質問管理・お知らせ・エラーログ等。
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { openWorkerPreview } from "../../lib/previewBus";
import { fmtJstShort, SURVEY_SOURCES, SURVEY_REASONS, C, uid, toKatakana, toHiragana, MONTHS, cn, man, photoThumb } from "../../lib/utils";
import { Avatar, LinkifiedText, StatusRibbon, Dots } from "../ui";
import { AdminJobPreview } from "../AdminJobPreview";
import { AdminNav } from "./AdminNav";
import { getCache, setCache } from "../../lib/viewCache";

// あいうえお順の比較（アカウント面・2026-08-07）。毎描画で作らないためモジュールレベルに置く
const JA_COLLATOR = new Intl.Collator("ja");

const DEST_INK = ["#2D5A1B","#1A3F6B","#7A3D10","#5C3080","#8B2518","#1A5E5E","#55610F","#6B3A18"];

// 審査セクションのURLキー（#/admin/review/{key}）。ボックス格子の並びと一致させる唯一の正本。
// 数字（#/admin/review/{job_number}）は求人審査プレビューへの深いリンク（従来どおり）。
// 「jobs（求人審査）」「prs（自由記述審査）」は承認プロセスの削除（2026-08-14）で廃止＝掲載・保存は即公開に
const REVIEW_SECTION_KEYS = ["accounts","reports","disputes","questions","withdrawals","contracts"];

// 日付キー（YYYY-MM-DD）はローカル整形で統一する。toISOString().slice(0,10)は
function destColor(name){ if(!name)return"#888"; let h=0; for(const c of name) h=(h*37+c.charCodeAt(0))>>>0; return DEST_INK[h%DEST_INK.length]; }

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
  const [legacyView, setLegacyView] = useState(null); // 旧事業データの表示中コンテンツ: farmers|dests|records|stats|datadef|null
  // システム（SQL／エラー／画像軽量化）は専用ページ #/admin/system（AdminSystemRoom）へ移設（2026-08-03たきと指示）
  const [farmers, setFarmers] = useState(() => getCache("admin:console")?.farmers || []);
  const [dests, setDests] = useState(() => getCache("admin:console")?.dests || []);
  const [records, setRecords] = useState(() => getCache("admin:console")?.records || []);
  // 前回の内容（viewCache）があれば読み込み中を出さず即描画する（他ページと同じSWR・2026-08-07）
  const [loading, setLoading] = useState(() => !getCache("admin:console"));
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
  const [withdrawals, setWithdrawals] = useState(() => getCache("admin:console")?.withdrawals || []); // 退会申請の未対応一覧（プラポリv3第7条1：申し出から30日以内に手動削除）
  // 求人審査キュー（pendingJobs）・自由記述の審査キュー（pendingPrs・empTexts）は
  // 承認プロセスの削除（2026-08-14）で廃止。掲載・保存＝即公開＋運営FYIメール（事後確認）に置き換え
  const [reports, setReports] = useState(() => getCache("admin:console")?.reports || []); // 通報（job_reports）
  const [msgReports, setMsgReports] = useState(() => getCache("admin:console")?.msgReports || []); // チャットのコメント報告（message_reports・2026-07-19）
  const [profReports, setProfReports] = useState(() => getCache("admin:console")?.profReports || []); // 働き手プレビューからの報告（profile_reports・2026-08-06）
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

  const TIERS = ["1-3","4-10","10+"];

  const load = useCallback(async () => {
    // 前回内容を表示中ならスピナーで隠さない（裏で差し替え）。初回だけ読み込み中を出す
    if (!getCache("admin:console")) setLoading(true);
    const [fr, de, re, jr, av, la, mr, jq, wd, pr] = await Promise.all([
      supabase.from("farmers").select("*").order("created_at", { ascending: false }),
      supabase.from("dests").select("*").order("name"),
      supabase.from("records").select("*").order("year,month"),
      supabase.from("job_reports").select("*").order("created_at",{ascending:false}),
      supabase.from("attendance_events").select("*").eq("kind","dispute_no_show").order("created_at",{ascending:false}),
      supabase.rpc("admin_list_accounts"),
      supabase.from("message_reports").select("*").order("created_at",{ascending:false}),
      supabase.from("job_questions").select("*").order("created_at",{ascending:false}),
      supabase.from("withdrawal_requests").select("*").is("processed_at", null).order("requested_at",{ascending:true}),
      supabase.from("profile_reports").select("*").order("created_at",{ascending:false}),
    ]);
    // 成功した分だけを反映し、同じものをviewCacheへ写す（次に開いた時・引き下げ更新後は即描画）
    const next = {};
    if (!fr.error) next.farmers = fr.data || [];
    if (!de.error) next.dests = de.data || [];
    if (!re.error) next.records = re.data || [];
    if (!jr.error) next.reports = jr.data || [];
    if (!av.error) next.disputes = av.data || [];
    if (!la.error && Array.isArray(la.data)) next.accounts = la.data; // {ok:false,reason:'not_admin'}時は配列でないため無視
    if (!mr.error) next.msgReports = mr.data || [];
    if (!jq.error) next.adminQuestions = jq.data || [];
    if (!wd.error) next.withdrawals = wd.data || [];
    if (!pr.error) next.profReports = pr.data || [];
    if (next.farmers) setFarmers(next.farmers);
    if (next.dests) setDests(next.dests);
    if (next.records) setRecords(next.records);
    if (next.reports) setReports(next.reports);
    if (next.disputes) setDisputes(next.disputes);
    if (next.accounts) setAccounts(next.accounts);
    if (next.msgReports) setMsgReports(next.msgReports);
    if (next.adminQuestions) setAdminQuestions(next.adminQuestions);
    if (next.withdrawals) setWithdrawals(next.withdrawals);
    if (next.profReports) setProfReports(next.profReports);
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
  const resolveReport = async (r) => {
    const { error } = await supabase.from("job_reports").update({ status: "resolved" }).eq("id", r.id);
    if (error) { alert("更新に失敗しました：" + error.message); return; }
    setReports(prev => prev.map(x => x.id === r.id ? { ...x, status: "resolved" } : x));
  };
  const resolveMsgReport = async (r) => {
    const { error } = await supabase.from("message_reports").update({ status: "resolved" }).eq("id", r.id);
    if (error) { alert("更新に失敗しました：" + error.message); return; }
    setMsgReports(prev => prev.map(x => x.id === r.id ? { ...x, status: "resolved" } : x));
  };
  const resolveProfReport = async (r) => {
    const { error } = await supabase.from("profile_reports").update({ status: "resolved" }).eq("id", r.id);
    if (error) { alert("更新に失敗しました：" + error.message); return; }
    setProfReports(prev => prev.map(x => x.id === r.id ? { ...x, status: "resolved" } : x));
  };

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

  // 審査タブに全ての審査待ちを集約（2026-07-14）：求人＋アカウント承認＋自由記述＋通報＋異議
  const openReports = reports.filter(r => r.status !== "resolved");
  const openMsgReports = msgReports.filter(r => r.status !== "resolved");
  const openProfReports = profReports.filter(r => r.status !== "resolved");
  const reviewTotal = openReports.length + openMsgReports.length + openProfReports.length + disputes.length;
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
            { k:"legacy",  l:"旧事業データ" },
            { k:"system",  l:"システム" },
            { k:"survey",  l:"きっかけ" },
            { k:"working", l:"仕事中" },
            { k:"upcoming", l:"まもなく開始" },
            { k:"evaluation", l:"評価" },
            { k:"boxlist", l:"ボックス一覧" },
            { k:"notices", l:"お知らせ一覧" },
            { k:"consign", l:"委託 準備室" },
            { k:"farmerpages", l:"農家のアクションページ" },
            { k:"animations", l:"アニメーション" },
          ].map(c => (
            <button key={c.k} onClick={()=>{ if (c.k === "working") { window.location.hash = "/admin/working"; } else if (c.k === "upcoming") { window.location.hash = "/admin/upcoming"; } else if (c.k === "evaluation") { window.location.hash = "/admin/evaluation"; } else if (c.k === "system") { window.location.hash = "/admin/system"; } else if (c.k === "boxlist") { window.location.hash = "/boxes"; } else if (c.k === "notices") { window.location.hash = "/boxes/notices"; } else if (c.k === "consign") { window.location.hash = "/admin/consignment"; } else if (c.k === "farmerpages") { window.location.hash = "/admin/farmer-pages"; } else if (c.k === "animations") { window.location.hash = "/admin/animations"; } else if (c.k === "signup") { onShowAccountForm(); } else { setOtherBox(c.k); } }} className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"22px 8px 18px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:10, boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
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
                {otherBox==="flow" ? "求人フロー" : otherBox==="legacy" ? "旧事業データ" : "きっかけ"}
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

              {otherBox==="legacy" && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {[
                    { k:"farmers", l:"農家台帳",   n: null }, // 旧アカウントタブ(farmers基準)の移設先（2026-07-14・温存）
                    { k:"dests",   l:"出荷先",     n: dests.filter(d=>d.status==="pending").length },
                    { k:"records", l:"記録データ", n: records.length },
                    { k:"stats",   l:"統計",       n: null },
                    { k:"datadef", l:"データ定義", n: null },
                  ].map(({ k, l, n }) => (
                    <button key={k} onClick={() => { setLegacyView(k); setOtherBox(null); }} className="f-sans" style={{
                      padding:"7px 14px", borderRadius:8, border:"1px solid #EBEBEB",
                      background:legacyView===k?"#222":"#F7F7F7",
                      color:legacyView===k?"#fff":"#717171",
                      fontSize:11, fontWeight:600, cursor:"pointer",
                      display:"flex", alignItems:"center", gap:5,
                    }}>
                      {l}
                      {n!=null&&n>0&&<span style={{ padding:"1px 6px",borderRadius:8,fontSize:9,fontWeight:700,background:legacyView===k?"#00A86B":"#EBEBEB",color:legacyView===k?"#fff":"#717171" }}>{n}</span>}
                    </button>
                  ))}
                </div>
              )}

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

      {/* ── 農家台帳（旧・アカウントタブのfarmers基準台帳を移設・温存。CRUDもここに残す） ── */}
      {!loading && sub==="other" && legacyView==="farmers" && (
        <div className="fade-in" style={{ display:"grid", gap:8 }}>
          {farmers.length===0 && <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", padding:"32px 0", textAlign:"center" }}>農家がいません</p>}
          {farmers.map(f => {
            const isOpen = expandedFarmer === f.id;
            const tier = f.experience_tier || "1-3";
            const statusInfo = f.status === "pending"
              ? { label:"承認待ち", bg:"#FFF4E0", fg:"#C77700" }
              : f.status === "approved"
                ? { label:"承認済み", bg:"#E6F7EF", fg:"#00A86B" }
                : { label: f.status || "—", bg:"#F5F5F5", fg:"#717171" };
            const fRecs = records.filter(r => r.farmer_id === f.id || r.farmer_id === f.auth_id);
            const fRecsWithDate = fRecs.filter(r => r.created_at);
            const lastRecDate = fRecsWithDate.length > 0
              ? fRecsWithDate.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at
              : null;
            const crops = Array.isArray(f.planned_crops) ? f.planned_crops : [];
            const detailRows = [
              { label:"メールアドレス", value: f.email || "未設定" },
              { label:"都道府県",   value: f.prefecture || "未設定" },
              { label:"市区町村",   value: f.municipality || "未設定" },
              { label:"栽培作物",   crops },
              { label:"登録日",     value: f.created_at ? new Date(f.created_at).toLocaleDateString("ja-JP") : "—" },
              { label:"最終入力日", value: lastRecDate ? new Date(lastRecDate).toLocaleDateString("ja-JP") : "未入力" },
            ];
            return (
              <div key={f.id} style={{ borderRadius:12, border:"1px solid #EBEBEB", background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.04)", overflow:"hidden" }}>
                {/* 閉じた状態：ニックネーム＋ステータスバッジのみ。個人情報は展開時のみ表示 */}
                <div
                  onClick={() => setExpandedFarmer(isOpen ? null : f.id)}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", cursor:"pointer", userSelect:"none" }}
                >
                  <div style={{ flex:1, minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>{f.name || "名前未設定"}</p>
                  </div>
                  <span style={{
                    padding:"3px 9px", borderRadius:8, fontSize:10, fontWeight:700, flexShrink:0, whiteSpace:"nowrap",
                    background:statusInfo.bg, color:statusInfo.fg,
                  }}>{statusInfo.label}</span>
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

      {/* ── 出荷先管理（その他＞旧事業データ） ── */}
      {!loading && sub==="other" && legacyView==="dests" && (
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

      {/* ── 審査（全ての審査待ちをここに集約・2026-07-14）：入口はプロフィール型のボックス格子。
           タップで各審査の一覧へ(reviewSec)。未完了数はボックス右上の赤バッジ ── */}
      {sub==="jobs" && !reviewSec && !loading && (
        <div className="fade-in" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {[
            { k:"reports",  l:"通報",           n:openReports.length + openMsgReports.length + openProfReports.length },
            { k:"disputes", l:"欠勤異議",       n:disputes.length },
            { k:"questions",l:"質問",           n:0 },
            { k:"withdrawals", l:"退会申請",    n:withdrawals.length },
            { k:"contracts",l:"契約記録",       n:0 },
          ].map(c => (
            <button key={c.k} onClick={()=>goReview(c.k)} className="f-sans" style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"26px 8px 20px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
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

        {/* ④ 通報（job_reports。対応済みで一覧から消える） */}
        {reviewSec==="reports" && (
        <div>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 10px" }}>通報{openReports.length > 0 ? `（${openReports.length}）` : ""}</p>
          <div style={{ display:"grid", gap:12 }}>
            {openReports.length === 0 ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>未対応の通報はありません</p>
            ) : openReports.map(r => (
              <div key={r.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:6 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>求人 #{r.job_number}　<span style={{ color:"#E24B4A" }}>{r.issue_type}</span></p>
                  <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0 }}>{r.created_at ? new Date(r.created_at).toLocaleString("ja-JP") : ""}</span>
                </div>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 10px" }}>対象：{r.target_field}{r.detail ? `　${r.detail}` : ""}</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setPreviewJobNumber(r.job_number)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>求人を見る</button>
                  <button onClick={()=>resolveReport(r)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>対応済みにする</button>
                </div>
              </div>
            ))}
          </div>
          {/* チャットのコメント報告（message_reports・2026-07-19）：本文は報告時点の凍結コピー */}
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"24px 0 10px" }}>チャットのコメント報告{openMsgReports.length > 0 ? `（${openMsgReports.length}）` : ""}</p>
          <div style={{ display:"grid", gap:12 }}>
            {openMsgReports.length === 0 ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>未対応のコメント報告はありません</p>
            ) : openMsgReports.map(r => (
              <div key={r.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:6 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#E24B4A", margin:0 }}>{r.reason}</p>
                  <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0 }}>{r.created_at ? new Date(r.created_at).toLocaleString("ja-JP") : ""}</span>
                </div>
                <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:"0 0 8px", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", background:"#F7F7F7", borderRadius:8, padding:"8px 10px" }}>{r.body_snapshot}</p>
                {r.detail && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 8px" }}>補足：{r.detail}</p>}
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 10px" }}>応募ID：{String(r.application_id || "").slice(0, 8)}…　発言者：{String(r.sender_id_snapshot || "").slice(0, 8)}…　報告者：{String(r.reporter_id || "").slice(0, 8)}…</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>resolveMsgReport(r)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>対応済みにする</button>
                </div>
              </div>
            ))}
          </div>
          {/* 働き手プレビューからの報告（profile_reports・2026-08-06）：どちらの面から出したかを source で見分ける */}
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"24px 0 10px" }}>働き手プレビューの報告{openProfReports.length > 0 ? `（${openProfReports.length}）` : ""}</p>
          <div style={{ display:"grid", gap:12 }}>
            {openProfReports.length === 0 ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>未対応の報告はありません</p>
            ) : openProfReports.map(r => (
              <div key={r.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:6 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#E24B4A", margin:0 }}>{r.issue_type}</p>
                  <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0 }}>{r.created_at ? new Date(r.created_at).toLocaleString("ja-JP") : ""}</span>
                </div>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 8px" }}>面：{r.source === "work_record" ? "はたらいた記録" : "プロフィール"}　対象：{r.target_field}</p>
                {r.detail && <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:"0 0 8px", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", background:"#F7F7F7", borderRadius:8, padding:"8px 10px" }}>{r.detail}</p>}
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 10px" }}>相手：{String(r.target_worker_id || "").slice(0, 8)}…　報告者：{String(r.reporter_id || "").slice(0, 8)}…</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>openWorkerPreview(r.target_worker_id)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>働き手を見る</button>
                  <button onClick={()=>resolveProfReport(r)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>対応済みにする</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* 求人への質問（job_questions・第10弾）：不適切なQ&Aを「非表示にする」で公開から外す */}
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

      {/* ── 記録データ管理（その他＞旧事業データ） ── */}
      {!loading && sub==="other" && legacyView==="records" && (
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

      {/* ── 統計（その他＞旧事業データ） ── */}
      {!loading && sub==="other" && legacyView==="stats" && (
        <div className="fade-in" style={{ display:"grid",gap:16 }}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12 }}>
            {[
              { l:"登録農家数", v:farmers.length },
              { l:"アクティブ農家", v:activeFarmerIds.size },
              { l:"総レコード数", v:records.length },
              { l:"出荷先数", v:dests.filter(d=>d.status==="approved").length },
            ].map(s=>(
              <Card key={s.l} style={{ textAlign:"center" }}>
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

      {/* ── データ定義（その他＞旧事業データ） ── */}
      {!loading && sub==="other" && legacyView==="datadef" && (
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
              ※ 利用目的を追加する場合は、本人に通知し必要に応じて同意を得る。
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
                    { data:"退会後の個人紐づけ",     period:"30日以内に削除または解除",          note:"最小限の履歴は目的限定で保存" },
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

    </div>
  );
}
