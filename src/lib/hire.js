// 採用（confirm_terms）の共有部品（2026-08-06）。
// 採用の窓口は増えたが【判定と警告は1箇所】に集約する＝応募者シート（FarmerDashboard）と
// 採用するページ（TodayPage・HireStagePanel）が同じ二重予約の判定・同じ告知文を使う。
// ここに置くのは「判定」と「文言」だけ。実行（rpc confirm_terms）と画面の更新は各呼び出し側が行う
// （DBの権限・人数上限・見送りの波及は従来どおり confirm_terms が担保する）。
import { supabase } from "./supabase";
import { CHAT_ELIGIBLE_STATUSES } from "./utils";

// 契約成立＝本名の相互開示（2026-07-30たきと裁定(B)）。採用の確認には必ずこの明示を入れること
export const HIRE_NAME_DISCLOSURE_NOTE =
  "採用すると契約が成立し、お互いのお名前（本名）が相手に表示されます。雇用の手続き（労働者名簿・賃金の記録）に必要なためです。";

// 二重予約の下調べ：同じ働き手が、日程の重なる自分の別の求人にも進んでいないか。
// 返り値＝重なっている別の求人番号（無ければ null）。取得に失敗しても採用は止めない（警告が出ないだけ）
export async function findDoubleBookingJob(farmerId, workerId, jobNumber) {
  try {
    const { data: apps } = await supabase.from("applications")
      .select("job_number,status").eq("farmer_id", farmerId).eq("worker_id", workerId).neq("job_number", jobNumber);
    const others = (apps || []).filter(x => CHAT_ELIGIBLE_STATUSES.includes(x.status) && x.job_number != null);
    if (!others.length) return null;
    const nums = [...new Set([jobNumber, ...others.map(x => x.job_number)])];
    const { data: jrows } = await supabase.from("jobs").select("job_number,date_start,date_end").in("job_number", nums);
    const cur = (jrows || []).find(j => j.job_number === jobNumber);
    if (!cur?.date_start) return null;
    const curEnd = cur.date_end || cur.date_start;
    for (const j of jrows || []) {
      if (j.job_number === jobNumber || !j.date_start) continue;
      const jEnd = j.date_end || j.date_start;
      if (cur.date_start <= jEnd && j.date_start <= curEnd) return j.job_number;
    }
  } catch {}
  return null;
}

// 二重予約の警告文（重なりが無ければ空文字）。表示の形（confirm／画面内の確認）は呼び出し側の自由
export const doubleBookingWarning = (dup) => dup
  ? `⚠️ この働き手さんは、日程が重なる別の求人 #${dup} にも進んでいます。同じ日に別の仕事（二重予約）になっていないか確認してください。`
  : "";
