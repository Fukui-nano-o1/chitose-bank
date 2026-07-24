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

// 保険の準備・自己申告（2026-07-23）：農家プロフィールで方針を表明。運営は証書を確認しない。
// considering=これから準備する は、表示チップでは「これから準備予定」にする。employer_profiles.insurance_items に key配列で保存。
export const INSURANCE_ITEMS = [
  { k:"day_accident",    label:"1日単位の傷害保険（作業日ごと）", chip:"1日単位の傷害保険" },
  { k:"annual_accident", label:"年間の傷害保険",                 chip:"年間の傷害保険" },
  { k:"rosai",           label:"労災保険（特別加入など）",        chip:"労災保険" },
  { k:"facility",        label:"農業施設・賠償責任保険",          chip:"施設・賠償責任保険" },
  { k:"vehicle",         label:"移動中の車両保険",               chip:"車両保険" },
  { k:"considering",     label:"これから準備する",               chip:"これから準備予定" },
];


// 役割カラー（第11弾）：目印限定。働き手=橙／農家=緑。ブランド緑CTAは不変
export const ROLE_ORANGE = "#F76B1C";      // 働き手モードの目印色（枠・チップ背景・ナビ・アクセントバー）。白文字とのコントラストは緑CTAと同等
export const ROLE_ORANGE_INK = "#B54A0E";  // 小さい橙テキスト用の濃色（生成り背景でも読める・コントラスト約5:1）
export const ROLE_GREEN = "#00A86B";       // 農家モードの目印色（ブランド緑と同色）

// 給与表示ラベル（時給/日給）。JobSearchMapView・FarmerDashboard共通
export function payLabel(j) { return j.payType === "hourly" ? `時給${j.pay.toLocaleString()}円` : `日給${j.pay.toLocaleString()}円`; }
