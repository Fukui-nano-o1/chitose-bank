// 求人の全体像を取る唯一の窓口（2026-08-24たきと指示「Aから」）。
// ・まず jobs_public（掲載中＋満員の掲載終了・訪問者にも開いているビュー）を引く
// ・そこに無かった求人だけ job_details_for_party（当事者だけに開くRPC）で補う
//   ＝一時非公開・掲載終了・下書きでも、その求人の当事者（応募した働き手／求人の農家本人／運営）なら
//     中身を見られる。当事者でなければ何も返らない＝見える範囲は従来と変わらない
// ★返す形は jobs_public の行と同じなので、呼び出し側は従来どおり mapJobPublicRow に渡すだけ。
// ★取得に失敗した時は error を返す＝呼び出し側は「失敗時は手元の値を上書きしない」を守ること
//   （2026-08-07のフェイルオープン規則。supabase-js は 5xx でも throw しない）。
import { supabase } from "./supabase";

// jobNumbers＝求人番号の配列。columns＝jobs_public から引く列（既定は全部）。
// 返り値 { rows: { [job_number]: 行 }, error }
export async function fetchJobRowsForMe(jobNumbers, columns = "*") {
  const nums = [...new Set((jobNumbers || []).map(Number).filter(n => Number.isFinite(n) && n > 0))];
  if (nums.length === 0) return { rows: {}, error: null };
  const rows = {};
  let error = null;
  try {
    const res = await supabase.from("jobs_public").select(columns).in("job_number", nums);
    if (res.error) error = res.error;
    else if (Array.isArray(res.data)) res.data.forEach(r => { if (r && r.job_number != null) rows[r.job_number] = r; });
  } catch (e) { error = e; }
  const missing = nums.filter(n => !(n in rows));
  if (missing.length > 0) {
    try {
      // 上限は100件（DB側も p_job_numbers[1:100] で切っている）
      const res = await supabase.rpc("job_details_for_party", { p_job_numbers: missing.slice(0, 100) });
      if (!res.error && Array.isArray(res.data)) res.data.forEach(r => { if (r && r.job_number != null) rows[r.job_number] = r; });
    } catch { /* 当事者でない・未ログイン＝何も返らない（従来どおり） */ }
  }
  return { rows, error };
}

// 1件だけ（{ data, error } ＝ maybeSingle と同じ形なので、呼び出し側の書き換えが最小で済む）
export async function fetchJobRowForMe(jobNumber, columns = "*") {
  const { rows, error } = await fetchJobRowsForMe([jobNumber], columns);
  return { data: rows[Number(jobNumber)] ?? null, error };
}

// 配列で受け取りたい呼び出し用（{ data: [...], error }）
export async function fetchJobRowListForMe(jobNumbers, columns = "*") {
  const { rows, error } = await fetchJobRowsForMe(jobNumbers, columns);
  return { data: Object.values(rows), error };
}
