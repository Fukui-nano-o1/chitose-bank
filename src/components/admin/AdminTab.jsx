// 管理タブ（#/admin・管理者専用・分割3-Aで切り出し2026-07-24）：農家承認・求人審査・質問管理・お知らせ・エラーログ等。
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { recompressBucket, generateJobPhotoThumbs } from "../../lib/image";
import { fmtJstShort, SURVEY_SOURCES, SURVEY_REASONS, C, uid, toKatakana, toHiragana, MONTHS, cn, man, photoThumb } from "../../lib/utils";
import { Avatar, LinkifiedText, StatusRibbon, Dots } from "../ui";
import { AdminJobPreview } from "../AdminJobPreview";
import { AdminNav } from "./AdminNav";

const DEST_INK = ["#2D5A1B","#1A3F6B","#7A3D10","#5C3080","#8B2518","#1A5E5E","#55610F","#6B3A18"];

// 審査セクションのURLキー（#/admin/review/{key}）。ボックス格子の並びと一致させる唯一の正本。
// 数字（#/admin/review/{job_number}）は求人審査プレビューへの深いリンク（従来どおり）。
const REVIEW_SECTION_KEYS = ["jobs","accounts","prs","reports","disputes","questions","withdrawals","contracts"];

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

function diagnoseError(e) {
  const msg = (e.message || "").toLowerCase();
  if (msg.includes("row-level security")) return { title: "RLSポリシーで拒否", fix: "対象テーブルのRLS policyを確認", severity: "high" };
  if (msg.includes("unique") || msg.includes("duplicate key")) return { title: "重複データ", fix: "既存データを確認し重複を整理", severity: "medium" };
  if (msg.includes("failed to fetch") || msg.includes("network")) return { title: "通信エラー", fix: "ネットワーク接続を確認", severity: "medium" };
  if (msg.includes("cannot read properties of null")) return { title: "未選択データ参照", fix: "保存前にnullチェックを追加", severity: "high" };
  if (msg.includes("auth_id") || msg.includes("null")) return { title: "Auth紐づけ失敗", fix: "farmersのauth_idを確認", severity: "high" };
  return { title: "未分類エラー", fix: "message・component・operationを確認", severity: "unknown" };
}

// 📊きっかけ集計（管理者・2026-07-24）：source/reasonsの件数棒＋自由記述一覧。RLS survey admin selectで全件読める。
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
  const [accounts, setAccounts] = useState([]); // 新アカウントタブ：admin_list_accounts()の全ユーザー台帳
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
  const [otherBox, setOtherBox] = useState(null); // その他タブのポップアップ: pages|flow|legacy|system|notices|null（boxlistは#/boxes専用ページへ昇格・2026-07-17）
  // ボックス一覧の台帳は専用ページ（#/boxes・AdminBoxRegistryPage）へ昇格（2026-07-17）
  // お知らせ一覧の台帳は専用ページ（#/boxes/notices・AdminBoxRegistryPageのタブ）へ移設（2026-07-17）
  const [legacyView, setLegacyView] = useState(null); // 旧事業データの表示中コンテンツ: farmers|dests|records|stats|datadef|null
  const [systemView, setSystemView] = useState(null); // システムの表示中コンテンツ: sql|errors|images|null
  // 画像の一括軽量化（その他＞システム・2026-07-26）：既存ストレージの重い画像を同一パス上書きで圧縮。
  // URL不変so DB（avatar_url・jobs.photos jsonb・凍結terms_snapshotのURL参照）は無変更＝参照が壊れない
  const [imgOptRunning, setImgOptRunning] = useState("");   // 実行中のバケット名
  const [imgOptProgress, setImgOptProgress] = useState(""); // "3/12"
  const [imgOptResults, setImgOptResults] = useState({});   // bucket → {candidates, replaced, savedBytes}
  // カード用サムネの後埋め（2026-08-02・②）：既存jobs.photosに640pxサムネを生成しjsonbへ書き戻す
  const [thumbGenRunning, setThumbGenRunning] = useState(false);
  const [thumbGenProgress, setThumbGenProgress] = useState("");
  const [thumbGenResult, setThumbGenResult] = useState(null);
  const runThumbGen = async () => {
    if (thumbGenRunning || imgOptRunning) return;
    if (!window.confirm("求人写真のカード用サムネ（640px）を一括生成し、jobsのphotosに書き戻します。再実行しても増殖しません。よろしいですか？")) return;
    setThumbGenRunning(true); setThumbGenProgress("");
    const r = await generateJobPhotoThumbs(supabase, { onProgress: (d, t) => setThumbGenProgress(`${d}/${t}`) });
    setThumbGenRunning(false); setThumbGenProgress("");
    setThumbGenResult(r);
  };
  const runRecompress = async (bucket, maxSide, quality) => {
    if (imgOptRunning) return;
    // window.confirm と書くこと：同じスコープに確認モーダル用の state `confirm`（{msg,onOk}）があり、
    // 素の confirm(...) はそちらに解決されて「confirm is not a function」で落ちる（2026-07-29修理）
    if (!window.confirm(`${bucket} 内の重い画像（400KB以上）を圧縮して差し替えます。よろしいですか？`)) return;
    setImgOptRunning(bucket); setImgOptProgress("");
    const r = await recompressBucket(supabase, bucket, { maxSide, quality, onProgress: (d, t) => setImgOptProgress(`${d}/${t}`) });
    setImgOptRunning(""); setImgOptProgress("");
    setImgOptResults(prev => ({ ...prev, [bucket]: r }));
  };
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
  const [withdrawals, setWithdrawals] = useState([]); // 退会申請の未対応一覧（プラポリv3第7条1：申し出から30日以内に手動削除）
  const [pendingPrs, setPendingPrs] = useState([]); // 働き手プロフィール自由記述の確認待ち（pr_pending/pr_qa_pending）
  const [sheetPrId, setSheetPrId] = useState(null); // 自由記述審査：タップした働き手のボトムシート（auth_id）
  // 全ての自由記述の審査（2026-07-16）：農家プロフィールの自由記述はtexts_pendingに溜まり、ここで承認して初めて公開される
  const [empTexts, setEmpTexts] = useState([]);
  const loadEmpTexts = async () => {
    try {
      const { data } = await supabase.from("employer_profiles")
        .select("auth_id,nickname,avatar_url,updated_at,texts_pending,texts_submitted_at,owner_comment,intro_path,intro_joy,intro_crops,intro_atmosphere,intro_message,unique_point,always_do,break_style,transport_area,commute_allowance_detail,supplies_cap,pr")
        .order("updated_at", { ascending: false });
      if (!data) return;
      const hasText = (r) => (r.texts_pending && Object.keys(r.texts_pending).length > 0)
        || [r.owner_comment, r.intro_path, r.intro_joy, r.intro_crops, r.intro_atmosphere, r.intro_message, r.unique_point, r.always_do, r.break_style, r.transport_area, r.commute_allowance_detail, r.supplies_cap, r.pr].some(t => t && String(t).trim());
      setEmpTexts(data.filter(hasText));
    } catch {}
  };
  useEffect(() => { if (sub === "jobs") loadEmpTexts(); }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps
  // 審査に出るのは「中身のある pending」だけ（2026-08-03たきと指示「入力項目を空にするなら審査は必要ない」）。
  // 空欄はフロント側で即反映するようになったが、過去に積まれた空だけの pending を審査待ちに見せないための防御でもある
  const hasPendingText = (r) => !!r.texts_pending && Object.values(r.texts_pending).some(v => String(v ?? "").trim() !== "");
  const empPendingCount = empTexts.filter(hasPendingText).length;
  const EMP_TEXT_LABELS = {
    owner_comment:"代表より", intro_path:"就農するまで", intro_joy:"いま楽しいこと", intro_crops:"どんな作物を、どんな想いで",
    intro_atmosphere:"職場の雰囲気", intro_message:"初めての人へのメッセージ", unique_point:"畑・農園のユニークなところ",
    always_do:"いつもしていること", break_style:"休憩とお茶", transport_area:"送迎エリア",
    commute_allowance_detail:"通勤手当の内容", supplies_cap:"持ち物の上限設定",
  };
  const approveEmpTexts = async (authId) => {
    const { data, error } = await supabase.rpc("approve_employer_texts", { p_auth_id: authId });
    if (error || !data?.ok) { alert("承認に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
    loadEmpTexts();
  };
  const rejectEmpTexts = async (authId) => {
    if (!window.confirm("この審査待ちの自由記述を差し戻し（破棄）しますか？公開中の文はそのまま残ります")) return;
    const { data, error } = await supabase.rpc("reject_employer_texts", { p_auth_id: authId });
    if (error || !data?.ok) { alert("差し戻しに失敗しました：" + (data?.reason || error?.message || "不明")); return; }
    loadEmpTexts();
  };
  const [reports, setReports] = useState([]); // 通報（job_reports）
  const [msgReports, setMsgReports] = useState([]); // チャットのコメント報告（message_reports・2026-07-19）
  const [adminQuestions, setAdminQuestions] = useState([]); // 求人Q&A（job_questions・第10弾・非表示スイッチ）
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
  const [disputes, setDisputes] = useState([]); // 欠勤記録への異議（attendance_events kind=dispute_no_show）
  const [prPublishing, setPrPublishing] = useState(null);
  // 自己紹介（働き手・審査待ち）への修正依頼（2026-07-19）：どこの何がどう問題かを選んで積み上げ→運営チャット＋メールをセット送信
  const [prRevTarget, setPrRevTarget] = useState(null); // フォームを開いている対象（auth_id）
  const emptyPrFinding = () => ({ target:"", issueType:"", note:"" });
  const [prRevFindings, setPrRevFindings] = useState([emptyPrFinding()]);
  const [prRevSending, setPrRevSending] = useState(false);
  const [prRevDone, setPrRevDone] = useState(false);
  const PR_REVISION_ISSUE_TYPES = ["連絡先・外部サービスへの誘導","個人情報の書きすぎ（本名・住所など）","禁止項目に触れる内容（年代・学校名・家族構成・国籍など）","誹謗中傷・不適切な表現","虚偽・誇大の疑い","表現が不明瞭","その他"];
  const buildPrRevisionText = (fs) => fs
    .filter(f => f.target && f.issueType)
    .map(f => `【${f.target}】→ ${f.issueType}${f.note.trim() ? `（${f.note.trim()}）` : ""}`)
    .join("\n");
  const sendPrRevision = async (w) => {
    const reasonText = buildPrRevisionText(prRevFindings);
    if (prRevSending || !reasonText) return;
    setPrRevSending(true);
    // 指摘対象（どこ）も渡す＝本人の編集ページで該当ボックスに赤帯を出すため（2026-07-19）
    const targets = [...new Set(prRevFindings.filter(f => f.target && f.issueType).map(f => f.target))];
    const { data, error } = await supabase.rpc("request_worker_pr_revision", { p_auth_id: w.auth_id, p_reason: reasonText, p_targets: targets });
    setPrRevSending(false);
    if (error || !data?.ok) { alert("修正依頼の送信に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
    setPrRevDone(true);
    setTimeout(() => {
      setPrRevDone(false); setPrRevTarget(null); setPrRevFindings([emptyPrFinding()]);
      setSheetPrId(null);
      setPendingPrs(prev => prev.filter(x => x.auth_id !== w.auth_id));
    }, 1100);
  };
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
    setLoading(true);
    const [fr, de, re, ae, pj, wp, jr, av, la, mr, jq, wd] = await Promise.all([
      supabase.from("farmers").select("*").order("created_at", { ascending: false }),
      supabase.from("dests").select("*").order("name"),
      supabase.from("records").select("*").order("year,month"),
      supabase.from("app_errors").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("jobs").select("*").eq("status","pending").order("created_at",{ascending:false}),
      supabase.from("worker_profiles").select("auth_id,nickname,avatar_url,pr_pending,pr_qa_pending,pr_submitted_at"),
      supabase.from("job_reports").select("*").order("created_at",{ascending:false}),
      supabase.from("attendance_events").select("*").eq("kind","dispute_no_show").order("created_at",{ascending:false}),
      supabase.rpc("admin_list_accounts"),
      supabase.from("message_reports").select("*").order("created_at",{ascending:false}),
      supabase.from("job_questions").select("*").order("created_at",{ascending:false}),
      supabase.from("withdrawal_requests").select("*").is("processed_at", null).order("requested_at",{ascending:true}),
    ]);
    if (!fr.error) setFarmers(fr.data || []);
    if (!de.error) setDests(de.data || []);
    if (!re.error) setRecords(re.data || []);
    if (!ae.error) setAppErrors(ae.data || []);
    if (!pj.error) setPendingJobs(pj.data || []);
    // pr_submitted_at必須（2026-07-19）：修正依頼済み（submitted_at=null）は本人が修正して再保存するまで審査待ちに出さない
    if (!wp.error) setPendingPrs((wp.data || []).filter(w => w.pr_submitted_at && ((w.pr_pending || "").trim() || (Array.isArray(w.pr_qa_pending) && w.pr_qa_pending.length > 0))));
    if (!jr.error) setReports(jr.data || []);
    if (!av.error) setDisputes(av.data || []);
    if (!la.error && Array.isArray(la.data)) setAccounts(la.data); // {ok:false,reason:'not_admin'}時は配列でないため無視
    if (!mr.error) setMsgReports(mr.data || []);
    if (!jq.error) setAdminQuestions(jq.data || []);
    if (!wd.error) setWithdrawals(wd.data || []);
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
  const approveFarmerAccount = async (f) => {
    const { error } = await supabase.from("farmers").update({ status: "approved" }).eq("id", f.id);
    if (error) { alert("承認に失敗しました：" + error.message); return; }
    setFarmers(prev => prev.map(x => x.id === f.id ? { ...x, status: "approved" } : x));
  };
  const publishPendingPr = async (w) => {
    if (prPublishing) return;
    setPrPublishing(w.auth_id);
    const payload = { pr_pending: null, pr_qa_pending: null };
    if (w.pr_pending) payload.pr = w.pr_pending;
    if (Array.isArray(w.pr_qa_pending) && w.pr_qa_pending.length > 0) payload.pr_qa = w.pr_qa_pending;
    const { error } = await supabase.from("worker_profiles").update(payload).eq("auth_id", w.auth_id);
    setPrPublishing(null);
    if (error) { alert("公開に失敗しました：" + error.message); return; }
    setPendingPrs(prev => prev.filter(x => x.auth_id !== w.auth_id));
  };
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

  // 審査タブに全ての審査待ちを集約（2026-07-14）：求人＋アカウント承認＋自由記述＋通報＋異議
  const pendingFarmerAccounts = farmers.filter(f => f.status === "pending");
  const openReports = reports.filter(r => r.status !== "resolved");
  const openMsgReports = msgReports.filter(r => r.status !== "resolved");
  const reviewTotal = pendingJobs.length + pendingFarmerAccounts.length + pendingPrs.length + empPendingCount + openReports.length + openMsgReports.length + disputes.length;
  const TOP_TABS = [
    { k:"jobs",    l:"審査",       icon:"🔍", n: reviewTotal },
    { k:"account", l:"アカウント", icon:"👤", n: null },
    { k:"other",   l:"その他",     icon:"🧰", n: null },
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

      {/* 運営DMスレッド（アカウント→✉️で展開・2026-07-16） */}
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
        <button onClick={() => { setLoading(true); load(); }} style={{
          padding:"8px 16px", borderRadius:10, border:"1px solid #EBEBEB",
          background:"#fff", fontSize:12, fontWeight:600, color:"#222",
          cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", gap:6,
        }}>
          🔄 更新
        </button>
      </div>

      {/* メインタブ（求人審査をデフォルト・毎日使うのはここだけ） */}
      <div style={{ display:"flex",gap:4,background:"#F7F7F7",border:"1px solid #EBEBEB",borderRadius:12,padding:4,marginBottom:24 }}>
        {TOP_TABS.map(({ k, l, icon, n }) => (
          <button key={k} onClick={() => setSub(k)} style={{
            flex:1, padding:"11px 8px", border:"none", borderRadius:8, fontFamily:"inherit",
            background:topTab===k?"#fff":"transparent",
            color:topTab===k?"#222":"#717171",
            fontSize:13, fontWeight:topTab===k?700:400,
            boxShadow:topTab===k?"0 1px 4px rgba(0,0,0,0.08)":"none",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            cursor:"pointer",
          }}>
            <span>{icon}</span>{l}
            {n!=null&&n>0&&<span style={{ padding:"1px 6px",borderRadius:8,fontSize:9,fontWeight:700,background:topTab===k?"#E6F7EF":"#EBEBEB",color:topTab===k?"#00A86B":"#717171" }}>{n}</span>}
          </button>
        ))}
      </div>
      </>)}

      {/* ── その他（ボックス化・2026-07-16）：絵文字カード格子。タップでポップアップ展開（他画面と同じ意匠）。
           旧アコーディオン（開発ツール／旧事業データ／システム）は、開発ツールを主要ページ・求人フローに分解し、ボックス一覧を追加した5ボックスに再編 ── */}
      {sub==="other" && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12, marginBottom:24 }}>
          {[
            { k:"pages",   e:"📄", l:"主要ページ" },
            { k:"flow",    e:"🧭", l:"求人フロー" },
            { k:"legacy",  e:"📦", l:"旧事業データ" },
            { k:"system",  e:"⚙️", l:"システム" },
            { k:"survey",  e:"📊", l:"きっかけ" },
            { k:"working", e:"🛠", l:"仕事中" },
            { k:"upcoming", e:"⏳", l:"まもなく開始" },
            { k:"boxlist", e:"🗂", l:"ボックス一覧" },
            { k:"notices", e:"📢", l:"お知らせ一覧" },
            { k:"consign", e:"🚩", l:"委託 準備室" },
          ].map(c => (
            <button key={c.k} onClick={()=>{ if (c.k === "working") { window.location.hash = "/admin/working"; } else if (c.k === "upcoming") { window.location.hash = "/admin/upcoming"; } else if (c.k === "boxlist") { window.location.hash = "/boxes"; } else if (c.k === "notices") { window.location.hash = "/boxes/notices"; } else if (c.k === "consign") { window.location.hash = "/admin/consignment"; } else { setOtherBox(c.k); } }} className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"22px 8px 18px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:10, boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
              <span style={{ fontSize:36, lineHeight:1 }}>{c.e}</span>
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
                {otherBox==="pages" ? "📄 主要ページ" : otherBox==="flow" ? "🧭 求人フロー" : otherBox==="legacy" ? "📦 旧事業データ" : otherBox==="survey" ? "📊 きっかけ" : "⚙️ システム"}
              </p>
            </div>
            <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y", padding:16 }}>

              {otherBox==="survey" && <SurveyStats />}

              {otherBox==="pages" && (<>
                <p className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", marginBottom:8 }}>開発: 画面ジャンプ</p>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
                  {[
                    { k:"search",  l:"さがす" },
                    { k:"profile", l:"プロフィール" },
                    { k:"login",   l:"ログイン" },
                    { k:"charter", l:"運営憲章" },
                  ].map(({ k, l }) => (
                    <button key={k} onClick={() => onJump(k)} className="f-sans" style={{
                      padding:"6px 12px", borderRadius:8, border:"1px solid #EBEBEB",
                      background:"#F7F7F7", color:"#717171", fontSize:11, fontWeight:600,
                      cursor:"pointer",
                    }}>{l}</button>
                  ))}
                </div>
                <button onClick={onShowAccountForm} className="f-sans" style={{
                  padding:"8px 14px", borderRadius:8, border:"1px solid #EBEBEB",
                  background:"#fff", color:"#717171", fontSize:11, fontWeight:600,
                  cursor:"pointer",
                }}>①登録画面を再表示(開発用)</button>
              </>)}

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
                    <button key={k} onClick={() => { setLegacyView(k); setSystemView(null); setOtherBox(null); }} className="f-sans" style={{
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

              {otherBox==="system" && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {[
                    { k:"sql",    l:"SQL" },
                    { k:"errors", l:"エラー" },
                    { k:"images", l:"画像軽量化" },
                  ].map(({ k, l }) => (
                    <button key={k} onClick={() => { setSystemView(k); setLegacyView(null); setOtherBox(null); }} className="f-sans" style={{
                      padding:"7px 14px", borderRadius:8, border:"1px solid #EBEBEB",
                      background:systemView===k?"#222":"#F7F7F7",
                      color:systemView===k?"#fff":"#717171",
                      fontSize:11, fontWeight:600, cursor:"pointer",
                    }}>{l}</button>
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
            {accounts.map(u => (
              <button key={u.auth_id} onClick={()=>{ setEmailShown(null); setExpandedAccount(u.auth_id); }}
                className="f-sans"
                style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                  {u.avatar_url
                    ? <img loading="lazy" src={u.avatar_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter: u.mod_state && u.mod_state !== "active" ? "grayscale(1) opacity(0.6)" : "none" }} />
                    : <Avatar url={null} name={u.nickname || u.email_masked || "？"} size={64} />}
                  {/* 状態マーク（右上）：停止/追放＞通報＞確認待ち＞未ログインの優先順で1つだけ */}
                  {(u.mod_state && u.mod_state !== "active") ? (
                    <span style={{ position:"absolute", top:6, right:6, padding:"2px 7px", borderRadius:9, background: u.mod_state === "banned" ? "#E24B4A" : "#C77700", color:"#fff", fontSize:10, fontWeight:800, boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}>{u.mod_state === "banned" ? "追放" : "停止"}</span>
                  ) : (u.reported > 0 || u.pending_text || u.never_signed_in) && (
                    <span style={{ position:"absolute", top:6, right:6, width:26, height:26, borderRadius:13, background:"rgba(255,255,255,0.92)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}>
                      {u.reported > 0 ? "⚠️" : (u.pending_text ? "📝" : "✉️")}
                    </span>
                  )}
                </div>
                <p className="f-sans" style={{ fontSize:13, fontWeight:600, color: u.nickname ? "#222" : "#999", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.nickname || u.email_masked || "—"}</p>
              </button>
            ))}
          </div>

          {/* アカウント詳細ボックス（閲覧専用＋運営DM。承認操作は置かない） */}
          {(() => {
            const u = accounts.find(a => a.auth_id === expandedAccount);
            if (!u) return null;
            const badgeSt = (bg, fg) => ({ padding:"3px 10px", borderRadius:9, fontSize:11, fontWeight:700, background:bg, color:fg, whiteSpace:"nowrap" });
            return (
              <div onClick={()=>{ setExpandedAccount(null); setEmailShown(null); }} style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                    <button onClick={()=>{ setExpandedAccount(null); setEmailShown(null); }} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                    <Avatar url={u.avatar_url} name={u.nickname || u.email_masked} size={30} />
                    <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.nickname || u.email_masked || "—"}</p>
                  </div>
                  <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 16px 16px" }}>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                      {u.has_id_check && <span className="f-sans" style={badgeSt("#E6F7EF","#00A86B")}>✓ 本人確認</span>}
                      {u.pending_text && <span className="f-sans" style={badgeSt("#FFF4E0","#C77700")}>📝 確認待ち{u.pending_since ? ` ${u.pending_since}` : ""}</span>}
                      {u.never_signed_in && <span className="f-sans" style={badgeSt("#F5F5F5","#717171")}>✉️ 未ログイン</span>}
                      {u.reported > 0 && <span className="f-sans" style={badgeSt("#FDECEC","#E24B4A")}>⚠️ 通報×{u.reported}</span>}
                    </div>
                    {/* メール行：既定はマスク表示。「メールを表示」タップで全文（コピー用） */}
                    <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                      <span className="f-sans" style={{ fontSize:12, color:"#B0B0B0", minWidth:72, flexShrink:0 }}>メール</span>
                      <span className="f-sans" style={{ fontSize:13, color:"#222", overflowWrap:"break-word", wordBreak:"break-all", userSelect:"text" }}>
                        {emailShown === u.auth_id ? (u.email || "—") : (u.email_masked || "—")}
                        {emailShown !== u.auth_id && u.email && (
                          <button onClick={()=>setEmailShown(u.auth_id)} className="f-sans" style={{ background:"none", border:"none", fontSize:12, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0, marginLeft:8 }}>メールを表示</button>
                        )}
                      </span>
                    </div>
                    {[
                      { label:"登録日",       value: u.created_jst || "—" },
                      { label:"最終ログイン", value: u.never_signed_in ? "未ログイン" : (u.last_sign_in_jst || "—") },
                      { label:"本人確認",     value: u.has_id_check ? (u.id_check_month || "済") : "未" },
                      { label:"活動",         value: `応募${u.apps_applied ?? 0}・完了${u.apps_completed ?? 0}・求人${u.jobs_posted ?? 0}・🌟${u.want_again ?? 0}` },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                        <span className="f-sans" style={{ fontSize:12, color:"#B0B0B0", minWidth:72, flexShrink:0 }}>{label}</span>
                        <span className="f-sans" style={{ fontSize:13, color:"#222", overflowWrap:"break-word", wordBreak:"break-word" }}>{value}</span>
                      </div>
                    ))}
                    <button onClick={()=>openAccountDm(u)} className="f-sans" style={{ marginTop:12, width:"100%", padding:"12px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>✉️ 運営メッセージを送る</button>
                    {u.pending_text && (
                      <p className="f-sans" style={{ marginTop:12, fontSize:12, color:"#C77700", background:"#FFFBF2", border:"1px solid #F5D98F", borderRadius:10, padding:"10px 12px", lineHeight:1.7 }}>
                        📝 自由記述の確認待ちがあります。承認・差し戻しは「審査」タブで行ってください（このボックスでは行いません）
                      </p>
                    )}

                    {/* アカウントの停止／追放（2026-07-19）：管理者のみ。ログイン封鎖＋アプリ内操作の封鎖＋公開物の非表示 */}
                    <div style={{ marginTop:16, borderTop:"1px solid #F0F0F0", paddingTop:14 }}>
                      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 8px" }}>アカウントの制限</p>
                      {(u.mod_state && u.mod_state !== "active") ? (
                        <div>
                          <div className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, background: u.mod_state === "banned" ? "#FDECEC" : "#FFF7ED", border:"1px solid " + (u.mod_state === "banned" ? "#F5B5B5" : "#FDBA74"), borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
                            <span style={{ fontSize:13, fontWeight:800, color: u.mod_state === "banned" ? "#E24B4A" : "#C77700" }}>{u.mod_state === "banned" ? "🚫 永久追放中" : "⏸ 一時停止中"}</span>
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
                            <button onClick={()=>runModerate(u.auth_id, "suspend", modReason)} disabled={modBusy} className="f-sans" style={{ flex:1, padding:"12px", fontSize:13, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>⏸ 一時停止</button>
                            <button onClick={()=>runModerate(u.auth_id, "ban", modReason)} disabled={modBusy} className="f-sans" style={{ flex:1, padding:"12px", fontSize:13, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>🚫 永久追放</button>
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
            { k:"jobs",     e:"🔍", l:"求人",           n:pendingJobs.length },
            { k:"accounts", e:"👤", l:"アカウント承認", n:pendingFarmerAccounts.length },
            { k:"prs",      e:"📝", l:"自由記述",       n:pendingPrs.length + empPendingCount },
            { k:"reports",  e:"🚨", l:"通報",           n:openReports.length + openMsgReports.length },
            { k:"disputes", e:"⚖️", l:"欠勤異議",       n:disputes.length },
            { k:"questions",e:"❓", l:"質問",           n:0 },
            { k:"withdrawals", e:"🚪", l:"退会申請",    n:withdrawals.length },
            { k:"contracts",e:"📄", l:"契約記録",       n:0 },
          ].map(c => (
            <button key={c.k} onClick={()=>goReview(c.k)} className="f-sans" style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"26px 8px 20px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12, boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
              {c.n > 0 && (
                <span style={{ position:"absolute", top:10, right:10, minWidth:22, height:22, borderRadius:11, background:"#E24B4A", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{c.n}</span>
              )}
              <span style={{ fontSize:44, lineHeight:1 }}>{c.e}</span>
              <span style={{ fontSize:15, fontWeight:700, color:"#222" }}>{c.l}</span>
            </button>
          ))}
        </div>
      )}
      {sub==="jobs" && reviewSec && (
        <div className="fade-in" style={{ display:"grid", gap:16 }}>
        <button onClick={backToReviewGrid} className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, color:"#717171", padding:"4px 0", justifySelf:"start" }}>← 審査</button>

        {/* ① 求人 */}
        {reviewSec==="jobs" && (
        <div>
        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 10px" }}>求人{pendingJobs.length > 0 ? `（${pendingJobs.length}）` : ""}</p>
        {/* 農家・働き手の一覧と同設計（2026-07-16）：3列グリッド・画像＋タイトルのみ・未審査は赤影アニメ。
            タップ→審査プレビュー（公開する/修正を依頼はプレビュー上部バーに集約済み） */}
        {pendingJobs.length === 0 ? (
          <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>公開待ちの求人はありません</p>
        ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
          {pendingJobs.map(j => {
            const photo = photoThumb(j.photos?.[0]);
            return (
              <button key={j.job_number} onClick={()=>setPreviewJobNumber(j.job_number)}
                className="f-sans cb-urgent-card"
                style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
                  {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌾"}
                  <StatusRibbon label="審査待ち" color="#C77700" />
                </div>
                <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[j.crop, j.task].filter(Boolean).join(" ") || ("求人 #" + j.job_number)}</p>
              </button>
            );
          })}
        </div>
        )}
        </div>
        )}

        {/* ② アカウント承認（農家の審査待ち） */}
        {reviewSec==="accounts" && (
        <div>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 10px" }}>アカウント承認{pendingFarmerAccounts.length > 0 ? `（${pendingFarmerAccounts.length}）` : ""}</p>
          <div style={{ display:"grid", gap:12 }}>
            {pendingFarmerAccounts.length === 0 ? (
              <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>承認待ちのアカウントはありません</p>
            ) : pendingFarmerAccounts.map(f => (
              <div key={f.id} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"16px", background:"#fff", display:"flex", justifyContent:"space-between", alignItems:"center", gap:16 }}>
                <div style={{ minWidth:0 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 4px" }}>{f.name || "名前未設定"}</p>
                  <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0 }}>{[f.prefecture, f.municipality].filter(Boolean).join("")}　{f.email || ""}</p>
                </div>
                <button onClick={()=>approveFarmerAccount(f)} className="f-sans" style={{ padding:"10px 20px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>承認する</button>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* ③ プロフィール自由記述（働き手の確認待ち。公開で pr_pending→pr に反映） */}
        {reviewSec==="prs" && (
        <div>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 10px" }}>プロフィール自由記述{pendingPrs.length > 0 ? `（${pendingPrs.length}）` : ""}</p>
          {/* 求人審査と同設計（2026-07-16）：3列グリッド・アイコン＋ニックネームのみ・未審査は赤影アニメ。タップでボトムシート */}
          {pendingPrs.length === 0 ? (
            <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>確認待ちの自由記述はありません</p>
          ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
            {pendingPrs.map(w => (
              <button key={w.auth_id} onClick={()=>setSheetPrId(w.auth_id)}
                className="f-sans cb-urgent-card"
                style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                  {w.avatar_url
                    ? <img loading="lazy" src={w.avatar_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                    : <Avatar url={null} name={w.nickname || "？"} size={64} />}
                  <StatusRibbon label="審査待ち" color="#C77700" />
                </div>
                <p className="f-sans" style={{ fontSize:13, fontWeight:600, color: w.nickname ? "#222" : "#999", margin:0, padding:"8px 10px 10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{w.nickname || "（名前未設定）"}</p>
              </button>
            ))}
          </div>
          )}
          {/* ── 農家プロフィールの自由記述（2026-07-16）：texts_pendingの審査キュー＋公開中全件の目視一覧 ── */}
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#C77700", letterSpacing:".08em", margin:"24px 0 10px" }}>農家プロフィール：審査待ち{empPendingCount > 0 ? `（${empPendingCount}）` : ""}</p>
          {empPendingCount === 0 ? (
            <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>審査待ちの自由記述はありません</p>
          ) : (
            <div style={{ display:"grid", gap:10 }}>
              {empTexts.filter(hasPendingText).map(r => (
                <div key={"pend-" + r.auth_id} className="cb-urgent-card" style={{ background:"#fff", border:"1px solid #F5D98F", borderRadius:12, padding:"12px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                    <Avatar url={r.avatar_url} name={r.nickname || "？"} size={30} />
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0, flex:1 }}>{r.nickname || "（名前未設定）"}</p>
                    {r.texts_submitted_at && <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>{String(r.texts_submitted_at).slice(0, 10)}提出</span>}
                  </div>
                  {Object.entries(r.texts_pending).map(([k, v]) => (
                    <div key={k} style={{ padding:"6px 0", borderTop:"1px solid #F7F7F7" }}>
                      <span className="f-sans" style={{ fontSize:11, color:"#C77700", fontWeight:700, display:"block", marginBottom:2 }}>{EMP_TEXT_LABELS[k] || k}</span>
                      <span className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{String(v).trim() ? v : "（この項目を空にする）"}</span>
                    </div>
                  ))}
                  <div style={{ display:"flex", gap:8, marginTop:10 }}>
                    <button onClick={()=>approveEmpTexts(r.auth_id)} className="f-sans" style={{ flex:1, padding:"10px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>承認して公開</button>
                    <button onClick={()=>rejectEmpTexts(r.auth_id)} className="f-sans" style={{ flex:1, padding:"10px", fontSize:13, fontWeight:700, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer" }}>差し戻す</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"24px 0 10px" }}>農家プロフィールの公開中の自由記述（全件・更新順）</p>
          {empTexts.length === 0 ? (
            <p className="f-sans" style={{ color:"#999", fontSize:13, margin:0 }}>自由記述のある農家プロフィールはありません</p>
          ) : (
            <div style={{ display:"grid", gap:10 }}>
              {empTexts.map(r => {
                const fields = [
                  { l:"代表より", v:r.owner_comment },
                  { l:"就農するまで", v:r.intro_path },
                  { l:"いま楽しいこと", v:r.intro_joy },
                  { l:"どんな作物を、どんな想いで", v:r.intro_crops },
                  { l:"職場の雰囲気", v:r.intro_atmosphere },
                  { l:"初めての人へのメッセージ", v:r.intro_message },
                  { l:"畑・農園のユニークなところ", v:r.unique_point },
                  { l:"いつもしていること", v:r.always_do },
                  { l:"休憩とお茶", v:r.break_style },
                  { l:"送迎エリア", v:r.transport_area },
                  { l:"通勤手当の内容", v:r.commute_allowance_detail },
                  { l:"持ち物の上限設定", v:r.supplies_cap },
                  { l:"旧・紹介PR", v:r.pr },
                ].filter(f => f.v && String(f.v).trim());
                return (
                  <div key={r.auth_id} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                      <Avatar url={r.avatar_url} name={r.nickname || "？"} size={30} />
                      <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0, flex:1 }}>{r.nickname || "（名前未設定）"}</p>
                      {r.updated_at && <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>{String(r.updated_at).slice(0, 10)}</span>}
                    </div>
                    {fields.map(f => (
                      <div key={f.l} style={{ padding:"6px 0", borderTop:"1px solid #F7F7F7" }}>
                        <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2 }}>{f.l}</span>
                        <span className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{f.v}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {/* 自由記述のボトムシート（本文・Q&A・公開ボタン。公開後は一覧から消えて自動で閉じる） */}
          {(() => {
            const w = pendingPrs.find(x => x.auth_id === sheetPrId);
            if (!w) return null;
            return (
              <div onClick={()=>setSheetPrId(null)} style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, display:"flex", flexDirection:"column", overflow:"hidden" }}>
                  <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                    <button onClick={()=>setSheetPrId(null)} aria-label="戻る" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                  </div>
                  <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:10 }}>
                      <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>{w.nickname || "名前未設定"}</p>
                      <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0 }}>{w.pr_submitted_at ? new Date(w.pr_submitted_at).toLocaleString("ja-JP") : ""}</span>
                    </div>
                    {w.pr_pending && (
                      <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.8, margin:"0 0 10px", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", background:"#F7F7F7", borderRadius:10, padding:"10px 12px" }}>{w.pr_pending}</p>
                    )}
                    {Array.isArray(w.pr_qa_pending) && w.pr_qa_pending.map(({ q, a }) => (
                      <div key={q} style={{ background:"#F7FBF9", borderRadius:10, padding:"8px 12px", marginBottom:8 }}>
                        <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"0 0 2px" }}>{q}</p>
                        <p className="f-sans" style={{ fontSize:13, color:"#222", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{a}</p>
                      </div>
                    ))}
                    {(() => {
                      // 修正依頼フォーム（2026-07-19）：どこ（本文/各質問）×どう問題か を選んで積み上げ→チャット＋メールで本人へ
                      const targets = [
                        ...(w.pr_pending ? ["自己紹介本文"] : []),
                        ...((Array.isArray(w.pr_qa_pending) ? w.pr_qa_pending : []).map(x => x.q).filter(Boolean)),
                      ];
                      const formOpen = prRevTarget === w.auth_id;
                      const reasonText = buildPrRevisionText(prRevFindings);
                      const pill = (selected) => ({ padding:"7px 11px", borderRadius:18, border: selected ? "2px solid #EA580C" : "1px solid #EBEBEB", background: selected ? "#FFF1E7" : "#fff", fontSize:12, fontWeight:600, color: selected ? "#EA580C" : "#717171", cursor:"pointer", textAlign:"left" });
                      return (
                        <>
                          <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                            <button onClick={()=>{ setPrRevTarget(formOpen ? null : w.auth_id); setPrRevFindings([emptyPrFinding()]); setPrRevDone(false); }} className="f-sans" style={{ padding:"10px 16px", fontSize:13, fontWeight:700, background:"#fff", color:"#EA580C", border:"1px solid #EA580C", borderRadius:10, cursor:"pointer", whiteSpace:"nowrap" }}>{formOpen ? "修正依頼をやめる" : "修正を依頼"}</button>
                            <button onClick={()=>publishPendingPr(w)} disabled={prPublishing===w.auth_id} className="f-sans" style={{ padding:"10px 20px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", whiteSpace:"nowrap" }}>{prPublishing===w.auth_id ? "公開中..." : "公開する"}</button>
                          </div>
                          {formOpen && (
                            <div className="fade-in" style={{ marginTop:14, background:"#FFF7ED", border:"1px solid #FDBA74", borderRadius:12, padding:"12px 14px" }}>
                              {prRevDone ? (
                                <p className="f-sans" style={{ textAlign:"center", fontSize:14, fontWeight:700, color:"#EA580C", margin:"8px 0" }}>✓ 修正依頼を送信しました（チャット＋メール）</p>
                              ) : (
                                <>
                                  <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#9A3412", margin:"0 0 10px" }}>どこの何が、どう問題かを選んでください（複数可）</p>
                                  {prRevFindings.map((f, i) => (
                                    <div key={i} style={{ background:"#fff", borderRadius:10, padding:"10px 12px", marginBottom:8, position:"relative" }}>
                                      {prRevFindings.length > 1 && (
                                        <button onClick={()=>setPrRevFindings(prev => prev.filter((_,idx)=>idx!==i))} aria-label="この指摘を削除" style={{ position:"absolute", top:6, right:6, width:26, height:26, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:12, cursor:"pointer" }}>✕</button>
                                      )}
                                      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#717171", margin:"0 0 6px" }}>どこ</p>
                                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                                        {targets.map(t => (
                                          <button key={t} onClick={()=>setPrRevFindings(prev=>prev.map((x,idx)=>idx===i?{...x,target:t}:x))} className="f-sans" style={pill(f.target===t)}>{t}</button>
                                        ))}
                                      </div>
                                      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#717171", margin:"0 0 6px" }}>どう問題か</p>
                                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                                        {PR_REVISION_ISSUE_TYPES.map(t => (
                                          <button key={t} onClick={()=>setPrRevFindings(prev=>prev.map((x,idx)=>idx===i?{...x,issueType:t}:x))} className="f-sans" style={pill(f.issueType===t)}>{t}</button>
                                        ))}
                                      </div>
                                      <input value={f.note} onChange={e=>setPrRevFindings(prev=>prev.map((x,idx)=>idx===i?{...x,note:e.target.value}:x))} placeholder="補足があれば（任意）" className="field f-sans" style={{ fontSize:12 }} />
                                    </div>
                                  ))}
                                  <button onClick={()=>setPrRevFindings(prev=>[...prev, emptyPrFinding()])} className="f-sans" style={{ width:"100%", padding:"8px", fontSize:12, fontWeight:700, background:"#fff", color:"#717171", border:"1px dashed #D0D0D0", borderRadius:10, cursor:"pointer", marginBottom:10 }}>＋ 指摘を追加</button>
                                  {reasonText && (
                                    <div className="f-sans" style={{ background:"#fff", borderRadius:10, padding:"8px 12px", fontSize:12, color:"#444", lineHeight:1.8, whiteSpace:"pre-wrap", marginBottom:10 }}>{reasonText}</div>
                                  )}
                                  <p className="f-sans" style={{ fontSize:11, color:"#9A3412", lineHeight:1.7, margin:"0 0 10px" }}>送信すると、本人に運営チャットとメールがセットで届きます。この提出は審査待ちから外れ、本人が修正して保存すると再び審査に届きます。</p>
                                  <button onClick={()=>sendPrRevision(w)} disabled={!reasonText || prRevSending} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:13, fontWeight:700, background: reasonText ? "#EA580C" : "#EBEBEB", color: reasonText ? "#fff" : "#717171", border:"none", borderRadius:10, cursor:"pointer" }}>{prRevSending ? "送信中..." : "修正を依頼する（チャット＋メール）"}</button>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        )}

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
        <div onClick={()=>setContractDetail(null)} className="cb-box-overlay" style={{ zIndex:9600 }}>
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
                  <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#00A86B", margin:"0 0 2px" }}>📄 契約スナップショット（凍結・閲覧専用）</p>
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

      {/* ── SQL（その他＞システム） ── */}
      {!loading && sub==="other" && systemView==="sql" && (
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

      {/* ── 画像軽量化（その他＞システム・2026-07-26） ── */}
      {!loading && sub==="other" && systemView==="images" && (
        <div className="fade-in" style={{ display:"grid",gap:16 }}>
          <Card>
            <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:4 }}>🗜 画像の一括軽量化</p>
            <p className="f-sans" style={{ fontSize:11,color:"#717171",lineHeight:1.8,marginBottom:16 }}>
              圧縮なしで保存された既存の画像（400KB以上）をダウンロード→圧縮→同じ場所に上書きします。
              URLが変わらないため、求人・プロフィール・凍結済み契約の参照はそのまま。
              既に軽い画像はスキップ＝何度実行しても安全。使い方ガイドのスクショはガイドページ上部の専用ボタンで。
            </p>
            <div style={{ display:"grid", gap:10 }}>
              {[
                { bucket:"avatars",    label:"アイコン（avatars）",    maxSide:512,  quality:0.8, note:"表示84px級→512pxに縮小" },
                { bucket:"job-photos", label:"求人写真（job-photos）", maxSide:1600, quality:0.8, note:"圧縮導入(7/16)前の原寸写真を縮小" },
              ].map(b => (
                <div key={b.bucket} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  <button onClick={()=>runRecompress(b.bucket, b.maxSide, b.quality)} disabled={!!imgOptRunning} className="f-sans" style={{ padding:"9px 16px", fontSize:12, fontWeight:700, background: imgOptRunning===b.bucket ? "#EBEBEB" : "#00A86B", color: imgOptRunning===b.bucket ? "#717171" : "#fff", border:"none", borderRadius:10, cursor: imgOptRunning ? "default" : "pointer" }}>
                    {imgOptRunning===b.bucket ? `軽量化中 ${imgOptProgress}…` : b.label}
                  </button>
                  <span className="f-sans" style={{ fontSize:11, color:"#999" }}>
                    {imgOptResults[b.bucket]
                      ? `完了：対象${imgOptResults[b.bucket].candidates}枚中 ${imgOptResults[b.bucket].replaced}枚を差し替え（約${Math.round(imgOptResults[b.bucket].savedBytes/1024/1024*10)/10}MB削減）`
                      : b.note}
                  </span>
                </div>
              ))}
              {/* カード用サムネの後埋め（2026-08-02・②）：一覧カードは軽量サムネ(thumb)を読む。
                  thumbが無い既存写真（サムネ導入前のアップロード分）へ640pxサムネを生成する */}
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <button onClick={runThumbGen} disabled={thumbGenRunning || !!imgOptRunning} className="f-sans" style={{ padding:"9px 16px", fontSize:12, fontWeight:700, background: thumbGenRunning ? "#EBEBEB" : "#00A86B", color: thumbGenRunning ? "#717171" : "#fff", border:"none", borderRadius:10, cursor: (thumbGenRunning || imgOptRunning) ? "default" : "pointer" }}>
                  {thumbGenRunning ? `生成中 ${thumbGenProgress}…` : "カード用サムネ生成（job-photos）"}
                </button>
                <span className="f-sans" style={{ fontSize:11, color:"#999" }}>
                  {thumbGenResult
                    ? (thumbGenResult.error
                        ? `失敗：${thumbGenResult.error}`
                        : `完了：${thumbGenResult.total}枚中 ${thumbGenResult.made}枚生成（失敗${thumbGenResult.failed}・求人${thumbGenResult.updatedJobs}件更新）`)
                    : "一覧カードの転送を軽くする（640px・既存写真の後埋め・再実行OK）"}
                </span>
              </div>
            </div>
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

      {/* ── エラー（その他＞システム） ── */}
      {!loading && sub==="other" && systemView==="errors" && (
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
