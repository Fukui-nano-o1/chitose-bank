// さがす（求人検索）の型（副作用のない計算だけ）。
// 第2次構造改革2026-08-17で JobSearchMapView.jsx から分離・中身は不変。
// ★この層に React / DOM / Supabase / fetch / localStorage を入れない（純粋なまま保つ）。
// ★jobMonths は「いつする？」の絞り込みの実体＝検索の意味論。式を変えたら検索結果が変わる。

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

export const jobMonths = (j) => { // 求人の日程が跨る月（1〜12）の一覧
  // ★dateStart/dateEndはDateオブジェクト（mapJobPublicRow）。文字列連結するとInvalid Dateになるため
  //   "YYYY-MM-DD"文字列のdateStartRaw/dateEndRawを使う（2026-07-27修正：いつする？が常に空だったバグ）
  const s = j.dateStartRaw, e = j.dateEndRaw || j.dateStartRaw;
  if (!s) return [];
  const out = [];
  const end = new Date(e + "T00:00:00");
  const d = new Date(s + "T00:00:00"); d.setDate(1);
  if (isNaN(d.getTime()) || isNaN(end.getTime())) return [];
  while (d <= end && out.length < 12) { out.push(d.getMonth() + 1); d.setMonth(d.getMonth() + 1); }
  return out;
};
