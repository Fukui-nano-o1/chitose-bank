// 農家のお仕事タブ（求人・応募者・また呼びたい名簿・質問集・保険・緊急連絡）が触るDBの全面。
// 第2次構造改革 Phase 5・2026-08-18で FarmerDashboard.jsx から分離。
//
// ★ここが農家お仕事タブのDBの唯一の窓口＝画面側は supabase を直接持たない。
//   表・RPC・列・絞り込み・payload・戻り値の形は移設前と1文字も変えていない（薄い通し口だけ）。
// ★エラー処理は呼び出し側に残してある（{data,error} をそのまま返す）＝
//   「res.error を見て、失敗時は手元の値を上書きしない」規則（2026-08-07）を呼び出し側で守る。
// ★失敗時に既定値へ倒す .then(r => r, () => ({...})) も移設前と同じ位置に置いてある。
//   Promise.all の中で1本の失敗が全体を落とさないための保険＝形を変えると挙動が変わる。
// ★働き手の情報は必ずRPC窓口（worker_profile_for_farmer / worker_trust_info /
//   worker_cards_for_farmer）を通す。生の worker_profiles を直に select しないこと
//   ＝未承認の自己紹介(pr_pending等)を農家のクライアントに渡さないための壁（2026-08-07のプラポリ修理）。
// ★また呼びたい名簿（repeat_roster）の操作は必ず farmer_id で絞る（削除は worker_id も）。
//   登録の効果をその求人者本人の範囲から出さないための約束（2026-07-16 労働局回答③）。
// ★質問集（ensureDefaultQuestionSets）は lib/questionSets が持っている共有の処理ので、
//   ここへ吸収しない（画面からそのまま呼ぶ）。
import { supabase } from "../../../lib/supabase";

// ★画面側に同名のハンドラ（submitFarmerReview / deleteQuestionSet / sendInterviewQuestions /
//   saveInsurance）が既にあるので、窓口側の名前を Rpc / Row / upsert で分けてある。
//   画面側の識別子は1つも改名しない（構造分割中は名前を凍結する・2026-08-18の規則）。

// ── 認証 ───────────────────────────────────────────────
export const getSession = () => supabase.auth.getSession();

// ── 入口（雇い手プロフィール・信頼情報・また呼びたい名簿・🆘の有無）──
export const fetchMyEmployerProfileFull = (uid) =>
  supabase.from("employer_profiles").select("*").eq("auth_id", uid).maybeSingle();
export const fetchEmployerTrustInfo = (uid) =>
  supabase.rpc('employer_trust_info', { p_farmer_id: uid }).then(r => r, () => ({ data: null }));
export const fetchMyRoster = (uid) =>
  supabase.from("repeat_roster").select("worker_id,created_at").eq("farmer_id", uid).order("created_at",{ascending:false});
export const fetchMyEmergencyContact = (uid) =>
  supabase.from("emergency_contacts").select("auth_id").eq("auth_id", uid).maybeSingle();
// 名簿の顔（ニックネームとアイコンだけ返すRPC窓口）
export const fetchWorkerCards = (workerIds) =>
  supabase.rpc("worker_cards_for_farmer", { p_worker_ids: workerIds });

// ── 求人・応募者（どちらも1往復に集約済みのRPC）────────
export const fetchMyFarmJobs = () => supabase.rpc("my_farm_jobs");
export const fetchMyFarmApplicants = () => supabase.rpc("my_farm_applicants");
export const fetchPublicJobByNumber = (jobNumber) =>
  supabase.from("jobs_public").select("*").eq("job_number", jobNumber).maybeSingle();
// 求人の題名を引く（評価完了の控え用・自分の求人だけ）
export const fetchMyJobLabel = (jobNumber, farmerId) =>
  supabase.from("jobs").select("crop,task").eq("job_number", jobNumber).eq("farmer_id", farmerId).maybeSingle();
// 緊急連絡の状況カード用（自分の求人だけ）
export const fetchMyJobContext = (jobNumber, farmerId) =>
  supabase.from("jobs").select("crop,task,date_start,work_time").eq("job_number", jobNumber).eq("farmer_id", farmerId).maybeSingle();

// ── 求人の操作（一時非公開・削除・コピー）───────────────
export const unpublishJob = (jobNumber) => supabase.rpc("unpublish_job", { p_job_number: jobNumber });
export const copyJob = (jobNumber) => supabase.rpc("copy_job", { p_job_number: jobNumber });
// 削除できるのは下書きだけ（タップ側の判定＋DBの trg_block_delete_past_job が二重の壁）
export const deleteMyJob = (jobNumber, farmerId) =>
  supabase.from("jobs").delete().eq("job_number", jobNumber).eq("farmer_id", farmerId);

// ── 応募者への判断・記録 ───────────────────────────────
// ★承認と見送りは同じRPCで p_approve の真偽だけが違う。呼び分けを混ぜないため窓口も2本に分ける
export const approveApplication = (applicationId) =>
  supabase.rpc('approve_application', { p_application_id: applicationId, p_approve: true });
export const rejectApplication = (applicationId) =>
  supabase.rpc('approve_application', { p_application_id: applicationId, p_approve: false });
export const setAgreedDates = (applicationId, dates) =>
  supabase.rpc("set_agreed_dates", { p_application_id: applicationId, p_dates: dates });
export const setApplicationFollowup = (applicationId, kind) =>
  supabase.rpc('set_application_followup', { p_application_id: applicationId, p_kind: kind });
// 欠勤として記録（出欠なしで完了）
export const markWorkNoShow = (applicationId) =>
  supabase.rpc('complete_work', { p_application_id: applicationId, p_attended: false });
// 完了・評価・お気に入り登録を1トランザクションで（2026-07-19の原子化）。
// ★引数名は窓口の中で綴る（呼び出し側から丸ごとのpayloadを受け取らない）：
//   p_public_comment（公開）と p_private_memo（本人だけ）の取り違えは表に出ない事故ので、
//   どのRPCにどの名前で渡しているかを1箇所に残して指紋の対象に留める。
export const submitFarmerReviewRpc = (applicationId, r) =>
  supabase.rpc('submit_farmer_review', {
    p_application_id: applicationId,
    p_want_again: r.wantAgain, p_entrust: r.entrust,
    p_public_comment: r.publicComment, p_private_memo: r.privateMemo,
    p_favorite: r.favorite,
  });
export const insertAttendanceEvent = (row) => supabase.from('attendance_events').insert(row);

// ── 働き手の情報（承認済み列だけ返すRPC窓口を通す）───────
export const fetchWorkerProfileForFarmer = (workerId) =>
  supabase.rpc("worker_profile_for_farmer", { p_worker_id: workerId });
export const fetchWorkerTrustInfo = (workerId) =>
  supabase.rpc("worker_trust_info", { p_worker_id: workerId });

// ── また呼びたい名簿の登録・解除（farmer_id で必ず絞る）──
export const upsertRoster = (farmerId, workerId) =>
  supabase.from('repeat_roster').upsert(
    { farmer_id: farmerId, worker_id: workerId, notify: true },
    { onConflict: 'farmer_id,worker_id' }
  );
export const deleteRoster = (farmerId, workerId) =>
  supabase.from('repeat_roster').delete().eq('farmer_id', farmerId).eq('worker_id', workerId);

// ── 面接の質問集（farmer_question_sets・本人のセットだけ）─
export const updateQuestionSet = (id, farmerId, title, questions) =>
  supabase.from("farmer_question_sets").update({ title, questions, updated_at: new Date().toISOString() }).eq("id", id).eq("farmer_id", farmerId);
export const insertQuestionSet = (farmerId, title, questions) =>
  supabase.from("farmer_question_sets").insert({ farmer_id: farmerId, title, questions });
export const deleteQuestionSetRow = (id, farmerId) =>
  supabase.from("farmer_question_sets").delete().eq("id", id).eq("farmer_id", farmerId);
export const sendInterviewQuestionsRpc = (applicationId, setId) =>
  supabase.rpc("send_interview_questions", { p_application_id: applicationId, p_set_id: setId });

// ── 保険（雇い手プロフィールへ書き戻す）─────────────────
export const upsertInsurance = (uid, items, notes) =>
  supabase.from("employer_profiles").upsert({ auth_id: uid, insurance_items: items, insurance_notes: notes, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
