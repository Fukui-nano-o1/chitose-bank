// 純粋ヘルパー＋定数（分割・段階1・2026-07-24）：React/DOM/supabaseに依存しない層。
// ここに置いてよいのは「引数→戻り値」だけで完結する関数と、読み取り専用の定数のみ。

// 管理者判定（届出後にゲートを外す際はここを変更する。保存・入力機能のゲートにも使用）
export const ADMIN_EMAIL = "t5fki6643qty@gmail.com";
export const isAdmin = (user) => user?.email === ADMIN_EMAIL;

// ローカル時刻基準の "YYYY-MM-DD"（toISOString はUTC変換でJSTでは前日にズレる＝date_start保存バグの原因。必ずこちらを使う）
export const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// 作業日当日か（開始・終了打刻の表示条件などに使用）
export function isWorkDayToday(dateStart, dateEnd) {
  if (!dateStart) return false;
  const fmt = d => { const dt = new Date(d); return dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0"); };
  const todayStr = fmt(new Date());
  const startStr = fmt(dateStart);
  const endStr = dateEnd ? fmt(dateEnd) : startStr;
  return todayStr >= startStr && todayStr <= endStr;
}

// JSTの短い日時表示（MM/DD HH:MM）
export const fmtJstShort = (ts) => {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("ja-JP", { timeZone:"Asia/Tokyo", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false });
  } catch { return String(ts).slice(5, 16).replace("T", " "); }
};

// カレンダー系
export const CALENDAR_WD = ["日","月","火","水","木","金","土"];
export const calAddDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
export const calFmtDate = (ymd) => { const [y,m,d] = ymd.split("-").map(Number); return `${m}/${d}(${CALENDAR_WD[new Date(y, m-1, d).getDay()]})`; };
// 期間内の日付を "YYYY-MM-DD" 配列で列挙（開始〜終了・両端含む）
export const daysBetweenYmd = (startYmd, endYmd) => {
  if (!startYmd) return [];
  const [ys, ms, ds] = startYmd.split("-").map(Number);
  const start = new Date(ys, ms - 1, ds);
  const end = endYmd ? new Date(endYmd + "T00:00:00") : start;
  const out = []; let g = 0;
  for (let d = new Date(start); d <= end && g < 400; d.setDate(d.getDate() + 1), g++) out.push(ymdLocal(d));
  return out;
};
