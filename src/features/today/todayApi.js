// 今日ページ（やること・きょうの仕事・つぎの予定）が触るDBの全面。
// 第2次構造改革 Phase 4-B・2026-08-18で TodayPage.jsx / StagePanels.jsx から分離。
//
// ★ここが今日featureのDBの唯一の窓口＝画面側は supabase を直接持たない。
//   表・RPC・列・絞り込み・戻り値の形は移設前と1文字も変えていない（薄い通し口だけ）。
// ★エラー処理は呼び出し側に残してある（{data,error} をそのまま返す）＝
//   「res.error を見て、失敗時は手元の値を上書きしない」規則（2026-08-07）を呼び出し側で守る。
// ★失敗時に既定値へ倒す .then(r => r, () => ({...})) も移設前と同じ位置に置いてある。
//   これは Promise.all の中で1本の失敗が全体を落とさないための保険＝形を変えると挙動が変わる。
import { supabase } from "../../lib/supabase";

// ── 認証 ───────────────────────────────────────────────
export const getSession = () => supabase.auth.getSession();

// ── 今日ページの本体（互いに独立なので呼び出し側が Promise.all で同時に投げる）──
export const fetchMyCalendarJobs = () => supabase.rpc("get_my_calendar_jobs");
export const fetchMyTodoItems = () => supabase.rpc("my_todo_items");

// 役割の判定＋プロフィールの未入力を数える列（列は lib/utils の *_UNSET_COLUMNS が唯一のソース）
export const fetchMyWorkerProfile = (uid, cols) =>
  supabase.from("worker_profiles").select("auth_id," + cols).eq("auth_id", uid).maybeSingle();
export const fetchMyEmployerProfile = (uid, cols) =>
  supabase.from("employer_profiles").select("auth_id," + cols).eq("auth_id", uid).maybeSingle();
export const countMyJobs = (uid) =>
  supabase.from("jobs").select("job_number", { count: "exact", head: true }).eq("farmer_id", uid);
// 🆘緊急連絡先の有無（self-only RLS・2026-08-07）。失敗時はnull＝未登録扱い
export const fetchMyEmergencyContact = (uid) =>
  supabase.from("emergency_contacts").select("auth_id").eq("auth_id", uid).maybeSingle().then(r => r, () => ({ data: null }));

// 採用の判定に要る時刻（statusは採用後も'approved'のまま＝両者の確認時刻で見るしかない）
export const fetchMyApplicationTerms = (uid) =>
  supabase.from("applications")
    .select("id,status,terms_confirmed_worker_at,terms_confirmed_farmer_at")
    .eq("worker_id", uid);
// ── やることの実行 ─────────────────────────────────────
// 用件カードのその場実行（confirm_insurance）。どのRPCかは TODO_META が持つ
export const runTodoRpc = (rpc, applicationId) =>
  supabase.rpc(rpc, { p_application_id: applicationId });
// 採用の確定（採用するページ・応募者シートと同じ confirm_terms＝人数上限・見送りの波及はDB側）
export const confirmTerms = (applicationId, acceptDoubleBooking) =>
  supabase.rpc("confirm_terms", { p_application_id: applicationId, p_accept_double_booking: acceptDoubleBooking });

// ── 段階パネルが引く付随データ ─────────────────────────
export const fetchPublicJobByNumber = (jobNumber) =>
  supabase.from("jobs_public").select("*").eq("job_number", jobNumber).maybeSingle();
export const fetchMyFarmJobs = () => supabase.rpc("my_farm_jobs");
// 面接の質問の取得・メッセージの投函の窓口は削除（2026-08-19）：今日ページの面接の回答パネルが
// 唯一の使い手だったが、その箱ごと廃止した（返事はチャットで行う＝ChatViewが自前の窓口を持つ）
