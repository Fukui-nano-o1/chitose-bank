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

// 実働日集合を作る（DBの app_work_dates と同じ規則・2026-08-06）：
//   agreed_dates（非空配列）があればその日付／無ければ求人範囲 date_start..date_end を展開／
//   いずれからも holidays（jobs.holidays）を除く。返り値は 'YYYY-MM-DD' 文字列の Set。
// ★DB(app_work_dates)と1対1で揃えること＝ズレると画面とサーバーで警告が食い違う
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function effectiveWorkDates(app, job) {
  const set = new Set();
  if (!job) return set;
  const holidays = new Set(Array.isArray(job.holidays) ? job.holidays.filter(x => typeof x === "string") : []);
  const agreed = app && Array.isArray(app.agreed_dates) ? app.agreed_dates : null;
  if (agreed && agreed.length) {
    for (const d of agreed) if (typeof d === "string" && !holidays.has(d)) set.add(d);
    return set;
  }
  if (!job.date_start) return set;
  const start = new Date(job.date_start + "T00:00:00");
  const end = new Date((job.date_end || job.date_start) + "T00:00:00");
  for (let t = new Date(start); t <= end; t.setDate(t.getDate() + 1)) {
    const s = ymd(t);
    if (!holidays.has(s)) set.add(s);
  }
  return set;
}

// 二重予約の下調べ：同じ働き手が、【実働日that重なる】自分の別の求人にも進んでいないか。
// 求人票の生の範囲ではなく、agreed_dates（実際に働く日）と holidays を反映した実働日の積で見る
// （2026-08-06 精度修理・旧実装は範囲重複だけで、別々の日に雇う正当な採用に毎回誤警告を出していた）。
// 返り値＝重なっている別の求人番号（無ければ null）。取得に失敗しても採用は止めない（警告that出ないだけ）
export async function findDoubleBookingJob(farmerId, workerId, jobNumber) {
  try {
    const { data: apps } = await supabase.from("applications")
      .select("job_number,status,agreed_dates").eq("farmer_id", farmerId).eq("worker_id", workerId);
    if (!apps || !apps.length) return null;
    const cur = apps.find(a => a.job_number === jobNumber);
    const others = apps.filter(a => a.job_number !== jobNumber && CHAT_ELIGIBLE_STATUSES.includes(a.status) && a.job_number != null);
    if (!cur || !others.length) return null;
    const nums = [...new Set([jobNumber, ...others.map(a => a.job_number)])];
    const { data: jrows } = await supabase.from("jobs").select("job_number,date_start,date_end,holidays").in("job_number", nums);
    const jobByNum = new Map((jrows || []).map(j => [j.job_number, j]));
    const curSet = effectiveWorkDates(cur, jobByNum.get(cur.job_number));
    if (!curSet.size) return null;
    for (const o of others) {
      const os = effectiveWorkDates(o, jobByNum.get(o.job_number));
      for (const d of os) if (curSet.has(d)) return o.job_number;
    }
  } catch {}
  return null;
}

// 二重予約の警告文（重なりが無ければ空文字）。表示の形（confirm／画面内の確認）は呼び出し側の自由
export const doubleBookingWarning = (dup) => dup
  ? `⚠️ この働き手さんは、日程が重なる別の求人 #${dup} にも進んでいます。同じ日に別の仕事（二重予約）になっていないか確認してください。`
  : "";
