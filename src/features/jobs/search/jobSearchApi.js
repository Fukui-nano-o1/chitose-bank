// さがす（求人検索・求人詳細・応募）が触るDBの全面。
// 第2次構造改革2026-08-17で JobSearchMapView.jsx から分離。
//
// ★ここが検索featureのDBの唯一の窓口＝画面側は supabase を直接持たない。
//   表・RPC・列・絞り込み・戻り値の形は移設前と1文字も変えていない（薄い通し口だけ）。
// ★エラー処理は呼び出し側に残してある（{data,error} をそのまま返す）＝
//   「res.error を見て、失敗時は手元の値を上書きしない」規則（2026-08-07）を呼び出し側で守る。
// ★一覧そのものの取得（jobs_public 全件）は lib/searchJobs.js の fetchPublicJobs が担う。
//   玄関（#/visit）の先読みと共有するため lib に置いたままにしてある＝ここには持ってこない。
import { supabase } from "../../../lib/supabase";

// ── 認証 ───────────────────────────────────────────────
export const getSession = () => supabase.auth.getSession();

// ── 求人（一覧の外・単票の先読み）───────────────────────
// ディープリンク（#/work/job/N）で一覧の到着を待たずに1行だけ先に引く
export const fetchPublicJobByNumber = (jobNumber) =>
  supabase.from("jobs_public").select("*").eq("job_number", jobNumber).maybeSingle();

// 自分が出した求人の番号（いいね対象外・自分の求人と分かる表示のため）
export const fetchMyJobNumbers = (farmerId) =>
  supabase.from("jobs").select("job_number").eq("farmer_id", farmerId);

// 掲載申請済み（pending）のトップ写真だけ＝「まもなく公開」カード。
// 運営のキルスイッチ app_settings.pending_preview_on_search='false' で即0件になる
export const fetchPendingJobPreviews = () => supabase.rpc("pending_job_previews");

// 自分の求人の操作（コピーして下書き／一時非公開）
export const copyJob = (jobNumber) => supabase.rpc("copy_job", { p_job_number: jobNumber });
export const unpublishJob = (jobNumber) => supabase.rpc("unpublish_job", { p_job_number: jobNumber });

// ── 募集主（求人詳細の農家プロフィール・過去の求人）─────
export const fetchJobEmployerProfile = (jobNumber) =>
  supabase.rpc("job_employer_profile", { p_job_number: jobNumber });
export const fetchJobEmployerTrustInfo = (jobNumber) =>
  supabase.rpc("job_employer_trust_info", { p_job_number: jobNumber });
export const fetchEmployerPublicJobs = (jobNumber) =>
  supabase.rpc("employer_public_jobs", { p_job_number: jobNumber });
export const fetchEmployerPublicJobCounts = (jobNumber) =>
  supabase.rpc("employer_public_job_counts", { p_job_number: jobNumber });

// ── いいね（saved_jobs・本人のみRLS）─────────────────────
export const fetchSavedJobNumbers = (workerId) =>
  supabase.from("saved_jobs").select("job_number").eq("worker_id", workerId);
export const deleteSavedJob = (workerId, jobNumber) =>
  supabase.from("saved_jobs").delete().eq("worker_id", workerId).eq("job_number", jobNumber);
export const insertSavedJob = (workerId, jobNumber) =>
  supabase.from("saved_jobs").insert({ worker_id: workerId, job_number: jobNumber });

// ── 自分の応募の状態（一覧のバッジ・詳細のボタン）───────
export const fetchMyApplications = (workerId) =>
  supabase.from("applications").select("id,job_number,status")
    .eq("worker_id", workerId).neq("status", "canceled");
export const fetchMyPendingApplications = (workerId) =>
  supabase.from("pending_applications").select("job_number").eq("worker_id", workerId);
export const fetchMyApplicationForJob = (jobNumber, workerId) =>
  supabase.from("applications").select("id,status")
    .eq("job_number", jobNumber).eq("worker_id", workerId).neq("status", "canceled").maybeSingle();
export const fetchMyPendingForJob = (jobNumber, workerId) =>
  supabase.from("pending_applications").select("id")
    .eq("job_number", jobNumber).eq("worker_id", workerId).maybeSingle();

// ── 応募・取り消し ─────────────────────────────────────
export const applyToJob = (jobNumber, availableDates) =>
  supabase.rpc("apply_to_job", { p_job_number: jobNumber, p_available_dates: availableDates });
export const createPendingApplication = (jobNumber, availableDates) =>
  supabase.rpc("create_pending_application", { p_job: jobNumber, p_available_dates: availableDates });
export const cancelApplication = (applicationId) =>
  supabase.rpc("cancel_application", { p_application_id: applicationId });

// ── 応募の前提（本人確認の届出・働き手プロフィール）─────
export const fetchAccountHolderId = (authUid) =>
  supabase.from("account_holders").select("id").eq("auth_id", authUid).maybeSingle();
export const fetchMyWorkerNickname = (authUid) =>
  supabase.from("worker_profiles").select("nickname,avatar_url").eq("auth_id", authUid).maybeSingle();

// ── 通報（求人）───────────────────────────────────────
export const insertJobReport = (row) => supabase.from("job_reports").insert(row);

// ── 登録のきっかけアンケート ───────────────────────────
export const fetchSurveyAnswered = (authUid) =>
  supabase.from("user_onboarding_survey").select("auth_id").eq("auth_id", authUid).maybeSingle();
export const insertSurvey = (row) => supabase.from("user_onboarding_survey").insert(row);

// ── 委託レーンを出すか（特約の同意状況）─────────────────
export const fetchConsignorConsent = (authUid) =>
  supabase.from("consignment_profiles")
    .select("consignment_terms_consent,consignment_terms_consent_version")
    .eq("auth_id", authUid).maybeSingle();

// ── 訪問者向けの文言（招待制か一般公開か）───────────────
export const fetchSignupOpen = () => supabase.rpc("signup_open");
