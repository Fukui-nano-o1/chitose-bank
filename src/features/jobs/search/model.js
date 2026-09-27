// さがす（求人検索）の型（副作用のない計算だけ）。
// 第2次構造改革2026-08-17で JobSearchMapView.jsx から分離・中身は不変。
// ★この層に React / DOM / Supabase / fetch / localStorage を入れない（純粋なまま保つ）。
// ★pickDateRange / jobInDateRange は「いつする？」の絞り込みの実体＝検索の意味論。式を変えたら検索結果が変わる。

// 応募パネルの「最高額」自動計算（段階2-a・ダミー前提）
// workTime "8:00〜16:00" を想定。日数は job.dateStart / job.dateEnd（date型）から算出。フォーマット外は null を返す
export function calcMaxPay(job) {
  const timeMatch = /^(\d{1,2}):(\d{2})〜(\d{1,2}):(\d{2})$/.exec(job.workTime || "");
  if (!job.dateStart) return null;
  const end = job.dateEnd || job.dateStart;
  const days = Math.round((end - job.dateStart) / 86400000) + 1;
  if (!Number.isFinite(days) || days <= 0) return null;

  if (job.payType === "daily") {
    return job.pay * days;
  }
  if (job.payType === "hourly") {
    if (!timeMatch) return null;
    const [, h1, mi1, h2, mi2] = timeMatch;
    const startH = Number(h1) + Number(mi1) / 60;
    const endH = Number(h2) + Number(mi2) / 60;
    const BREAK_HOURS = 1; // 休憩1hダミー
    const workHours = endH - startH - BREAK_HOURS;
    if (!Number.isFinite(workHours) || workHours <= 0) return null;
    return Math.round(job.pay * workHours * days);
  }
  return null;
}

// ── いつする？＝カレンダーの範囲指定（2026-09-27たきと指示「タップ1回目は始まり、2回目は終わりのループ」）──
// 範囲は { start:"YYYY-MM-DD", end:"YYYY-MM-DD"|null } か null（指定なし）。
// タップの規則（3拍で1周する）：
//   ①何も無い／両方そろっている → その日を【始まり】にする（終わりは空に）＝3回目のタップで始まりに戻る
//   ②始まりだけある → その日を【終わり】にする。始まりより前の日なら入れ替える（始まり≦終わりを保つ）。
//     同じ日をもう一度なら1日だけの範囲
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function pickDateRange(range, ymd) {
  if (typeof ymd !== "string" || !YMD.test(ymd)) return range ?? null;
  const cur = normalizeDateRange(range);
  if (!cur || cur.end) return { start: ymd, end: null };
  if (ymd < cur.start) return { start: ymd, end: cur.start };
  return { start: cur.start, end: ymd };
}
// 保存や古いキャッシュから来た値を安全な形に倒す（壊れていれば null＝指定なし）
export function normalizeDateRange(range) {
  if (!range || typeof range !== "object") return null;
  const start = typeof range.start === "string" && YMD.test(range.start) ? range.start : null;
  if (!start) return null;
  const end = typeof range.end === "string" && YMD.test(range.end) ? range.end : null;
  if (end && end < start) return { start: end, end: start };
  return { start, end };
}
// 求人の日程（dateStartRaw〜dateEndRaw・"YYYY-MM-DD"）が範囲と1日でも重なるか。
// 終わりが無い（始まりだけタップした）間は「その日以降に日程がある求人」＝始まり以降を全部残す。
// ★文字列のまま比べる（"YYYY-MM-DD" は辞書順＝日付順）。Dateに変えない＝時差で1日ずれない
export function jobInDateRange(j, range) {
  const r = normalizeDateRange(range);
  if (!r) return true;
  const s = j?.dateStartRaw, e = j?.dateEndRaw || j?.dateStartRaw;
  if (typeof s !== "string" || !YMD.test(s)) return false;
  const jobEnd = typeof e === "string" && YMD.test(e) ? e : s;
  if (jobEnd < r.start) return false;
  if (r.end && s > r.end) return false;
  return true;
}
// 要約の文字（ピル・畳んだ行）＝「9/10〜9/20」「9/10〜」「9/10」
export function dateRangeLabel(range) {
  const r = normalizeDateRange(range);
  if (!r) return "";
  const f = (ymd) => { const [, m, d] = ymd.split("-").map(Number); return `${m}/${d}`; };
  if (!r.end) return f(r.start) + "〜";
  if (r.end === r.start) return f(r.start);
  return f(r.start) + "〜" + f(r.end);
}
