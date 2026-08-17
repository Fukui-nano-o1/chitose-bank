// 求人作成フローが触るDBの全面（第2次構造改革2026-08-17で LandingFlow.jsx から分離）。
// ★ここが求人作成featureのDBの唯一の窓口＝画面側は supabase を直接持たない。
//   表・列・絞り込み・戻り値の形は移設前と1文字も変えていない（薄い通し口だけ）。
//   エラー処理は呼び出し側に残してある（{data,error} をそのまま返す）＝
//   「res.error を見て、失敗時は手元の値を上書きしない」規則（2026-08-07）を呼び出し側で守る。
import { supabase } from "../../../lib/supabase";
import { uploadJobPhoto } from "../../../lib/image";

// ── 認証 ───────────────────────────────────────────────
export const getSession = () => supabase.auth.getSession();

// ── 最低賃金（都道府県ごと・掲載トリガーと同じ値を引く）──────────
export const fetchMinimumWage = (prefecture) =>
  supabase.rpc("get_minimum_wage", { p_prefecture: prefecture });

// ── 雇い手プロフィール ─────────────────────────────────
export const fetchEmployerProfile = (authUid) =>
  supabase.from("employer_profiles").select("*").eq("auth_id", authUid).maybeSingle();

export const fetchEmployerPlaceAddress = (authUid) =>
  supabase.from("employer_profiles")
    .select("place_zip,place_prefecture,place_city,place_town,place_address")
    .eq("auth_id", authUid).maybeSingle();

export const fetchEmployerRecruiterInfo = (authUid) =>
  supabase.from("employer_profiles")
    .select("recruiter_name,recruiter_address,recruiter_contact").eq("auth_id", authUid).maybeSingle();

export const upsertEmployerProfile = (payload) =>
  supabase.from("employer_profiles").upsert(payload, { onConflict: "auth_id" });

export const fetchEmployerTrustInfo = (farmerId) =>
  supabase.rpc("employer_trust_info", { p_farmer_id: farmerId });

// ── 新規登録①の届出情報（募集者情報の初期値の引き継ぎ元）──────
export const fetchAccountHolder = (authUid) =>
  supabase.from("account_holders")
    .select("full_name,company_name,postal_code,address,contact_phone,contact_email")
    .eq("auth_id", authUid).maybeSingle();

// ── 求人 ───────────────────────────────────────────────
export const fetchJobByNumber = (jobNumber) =>
  supabase.from("jobs").select("*").eq("job_number", jobNumber).maybeSingle();

export const fetchJobStatus = (jobNumber) =>
  supabase.from("jobs").select("job_number,status").eq("job_number", jobNumber).maybeSingle();

// 所有者の絞り込み（farmer_id）は移設前と同じ＝他人の求人を書き換えられない二重の壁の内側
export const updateJob = (payload, jobNumber, farmerId) =>
  supabase.from("jobs").update(payload).eq("job_number", jobNumber).eq("farmer_id", farmerId);

export const insertJob = (payload) =>
  supabase.from("jobs").insert(payload).select("job_number").single();

// 掲載＝即公開（一般農家はpending保存→このRPCでopen。第三者公開の可否はDBトリガーが判定）
export const publishMyJob = (jobNumber) =>
  supabase.rpc("publish_my_job", { p_job_number: jobNumber });

// 掲載前の確認の記録（追記のみの台帳・行動記録の憲法）
export const insertJobPublishCheck = (row) =>
  supabase.from("job_publish_checks").insert(row);

// ── 写真のアップロード ───────────────────────────────────
// lib/image.js の uploadJobPhoto に supabase を渡すだけの通し口（第3引数の既定は {} ので
// opts 省略時の挙動は移設前と同値）。画面側が supabase を持たなくて済むようにするためだけの層。
export const uploadPhoto = (file, opts) => uploadJobPhoto(supabase, file, opts);
