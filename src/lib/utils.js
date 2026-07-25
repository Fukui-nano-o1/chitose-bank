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

// 保険種類ごとの運営用意の定型説明（2026-07-25）。求人の「保険」タブで各項目をタップした時、
// この定型説明＋農家の自由記述メモ（insurance_notes）を並べて出す。運営が保証する文ではなく、
// 保険の一般的な性質の説明にとどめる（自己申告の注記は別途表示）。
export const INSURANCE_DESC = {
  day_accident:    "作業日ごとに加入する傷害保険です。加入した日の作業中のケガに備えます。",
  annual_accident: "1年間を通して有効な傷害保険です。期間中の作業中のケガに備えます。",
  rosai:           "労働者災害補償保険です。特別加入などの形で、作業中のケガや病気に備えます。",
  facility:        "農作業や農業施設が原因で他人にケガをさせたり物を壊したりした場合の賠償に備える保険です。",
  vehicle:         "作業場所への移動中などの車両事故に備える保険です。",
  considering:     "保険の加入をこれから準備する段階です。まだ加入は完了していません。",
};


// 役割カラー（第11弾）：目印限定。働き手=橙／農家=緑。ブランド緑CTAは不変
export const ROLE_ORANGE = "#F76B1C";      // 働き手モードの目印色（枠・チップ背景・ナビ・アクセントバー）。白文字とのコントラストは緑CTAと同等
export const ROLE_ORANGE_INK = "#B54A0E";  // 小さい橙テキスト用の濃色（生成り背景でも読める・コントラスト約5:1）
export const ROLE_GREEN = "#00A86B";       // 農家モードの目印色（ブランド緑と同色）

// 給与表示ラベル（時給/日給）。JobSearchMapView・FarmerDashboard共通
export function payLabel(j) { return j.payType === "hourly" ? `時給${j.pay.toLocaleString()}円` : `日給${j.pay.toLocaleString()}円`; }

// 日程ラベル（確認ページのjobDateLabelと同一仕様・2026-07-16）：
// 年内に終了なら年を省く。年内かつ同じ月で終了なら終了側は年と月も省く
export function dateRangeLabel(startStr, endStr) {
  if (!startStr) return "";
  const parse = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const WD = ["日","月","火","水","木","金","土"];
  const fmt = (d, opts = {}) => {
    const w = WD[d.getDay()];
    if (opts.omitYearMonth) return `${d.getDate()}（${w}）`;
    if (opts.omitYear) return `${d.getMonth()+1}/${d.getDate()}（${w}）`;
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}（${w}）`;
  };
  const start = parse(startStr);
  const end = endStr ? parse(endStr) : start;
  const thisYear = new Date().getFullYear();
  const inYear = start.getFullYear() === thisYear && end.getFullYear() === thisYear;
  if (start.toDateString() === end.toDateString()) return fmt(start, { omitYear: inYear });
  const sameMonth = inYear && start.getMonth() === end.getMonth();
  return `${fmt(start, { omitYear: inYear })} 〜 ${fmt(end, sameMonth ? { omitYearMonth: true } : { omitYear: inYear })}`;
}

// jobs_public（同一列構成のadmin_preview_jobも含む）の1行を求人詳細表示用オブジェクトへ整形
// さがす一覧・求人詳細・管理者プレビューで共通利用
export function mapJobPublicRow(j) {
  return {
    id: j.job_number,
    crop: j.crop || "",
    task: j.task || "",
    // date_start/date_endから確認ページと同じ仕様で組み立て。日付列が無い旧データは保存済みラベルへフォールバック
    dateLabel: dateRangeLabel(j.date_start, j.date_end) || (j.date_label || ""),
    dateStartRaw: j.date_start || "",
    dateEndRaw: j.date_end || "",
    // 新着＝掲載（status→open遷移）から3日間（2026-07-16・jobs.opened_atはDBトリガーが刻む）
    isNew: !!j.opened_at && (Date.now() - new Date(j.opened_at).getTime()) < 3 * 24 * 60 * 60 * 1000,
    payType: j.pay_type === "日給" ? "daily" : "hourly",
    pay: j.pay_type === "日給" ? Number(j.daily_wage)||0 : Number(j.hourly_wage)||0,
    town: j.town || "",
    region: [j.prefecture, j.city, j.town].filter(Boolean).join("") || "",
    experience: j.job_exp || "", // 必要経験の選択式は撤回（2026-07-18）。旧求人の保存値のみ表示・未入力はdispで「ー」
    icon: "🌾",
    lat:    j.lat != null ? Number(j.lat) : null,
    lng:    j.lng != null ? Number(j.lng) : null,
    radius: j.geo_radius_m != null ? Number(j.geo_radius_m) : null,
    count: j.headcount != null ? j.headcount + "名" : "", headcount: j.headcount, photos: j.photos || [],
    nearestStation: j.nearest_station || "", workTime: j.work_time || "",
    breakTime: j.break_time || "",
    commuteTime: j.commute_time || "", jobBody: j.notes || "",
    cautions: j.cautions || "",
    wanted: "", items: j.belongings || "",
    payTiming: "", payMethod: "",
    dateStart: j.date_start ? new Date(j.date_start) : null,
    dateEnd: j.date_end ? new Date(j.date_end) : null,
    dangerPlaces: (j.danger_places || []).filter(p => p && (p.label || p.desc)),
    dangerTasks: (j.danger_tasks || []).filter(t => t && (t.label || t.desc)),
    fullPayGuarantee: !!j.full_pay_guarantee,
    beginnerOk: !!j.beginner_ok,
    instantApproveRepeat: !!j.instant_approve_repeat,
    perks: j.perks || null, // この求人だけの待遇上書き（NULL=農家プロフィールの待遇・2026-07-18）
    experiencedPreferred: !!j.experienced_preferred,
    // 終了帯の判定（2026-07-21）：採用人数を満たした／作業日程が過ぎた。探すからは除外しない
    hiredCount: j.hired_count != null ? Number(j.hired_count) : 0,
    filled: j.headcount != null && j.hired_count != null && Number(j.hired_count) >= Number(j.headcount),
    expired: (() => {
      const end = j.date_end || j.date_start;
      if (!end) return false;
      const today = ymdLocal(new Date());
      if (end < today) return true;
      // 最終日が今日で、勤務終了時刻を過ぎていれば終了（例：17:00〜19:00 は19時以降＝終了）
      if (end === today && j.work_time) {
        const m = String(j.work_time).match(/〜\s*(\d{1,2}):(\d{2})/);
        if (m) { const n = new Date(); if (n.getHours()*60 + n.getMinutes() > parseInt(m[1],10)*60 + parseInt(m[2],10)) return true; }
      }
      return false;
    })(),
  };
}

// 作物リスト（カードを増やすときはここに1行足すだけ）
export const CROP_OPTIONS = [
  { name:"ブロッコリー", icon:"🥦" },
  { name:"トマト",   icon:"🍅" },
  { name:"キュウリ", icon:"🥒" },
  { name:"ナス",     icon:"🍆" },
  { name:"イチゴ",   icon:"🍓" },
  { name:"米",       icon:"🌾" },
  { name:"ブドウ",   icon:"🍇" },
  { name:"リンゴ",   icon:"🍎" },
];

// 働き手の「できること・資格（自己申告）」（2026-07-23）：worker_profiles.self_declared に key配列で保存。
// 免許・資格・保険方針のみ。身体属性（体力等）に類する項目は絶対に追加しない（CLAUDE.mdルール・今後も）。
export const WORKER_DECLARATIONS = [
  { k:"license_car",     label:"普通自動車免許",             chip:"普通自動車免許" },
  { k:"license_special", label:"大型・特殊など上位の運転免許", chip:"上位運転免許" },
  { k:"forklift",        label:"フォークリフト運転技能",      chip:"フォークリフト" },
  { k:"brush_cutter",    label:"刈払機（草刈機）の取扱",       chip:"刈払機" },
  { k:"machinery",       label:"農業機械の操作（トラクター等）", chip:"農業機械の操作" },
  { k:"self_insurance",  label:"自分で傷害保険に加入している", chip:"傷害保険に加入" },
];

// 「✓ 本人確認済み（YYYY年M月）」用
export function yearMonthLabel(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

// 雇い手ホスト3問（FarmerTrustCard・求人詳細・雇い手プレビュー共通。記入済みの問いのみ返す）
export const farmHostQa = (e) => [
  { q:"うちの畑・農園のユニークなところ", a: e.unique_point },
  { q:"働きに来た人に、いつもしていること", a: e.always_do },
  { q:"休憩とお茶はどうしてる？", a: e.break_style },
].filter(x => x.a && x.a.trim());

// 作業中の関わり方（EmployerProfileEdit・FarmerTrustCard共通）
export const INTERACTION_STYLE_OPTIONS = [
  { value:"together", label:"一緒に作業する" },
  { value:"explain_then_leave", label:"最初に説明して任せる" },
  { value:"on_call", label:"必要な時だけ声かけ" },
];
export const interactionStyleLabel = v => INTERACTION_STYLE_OPTIONS.find(o => o.value === v)?.label || "";

// 「chitose-bank利用〇年〇ヶ月」用。開始日からの経過を年月で返す
export function tenureLabel(dateStr) {
  const start = new Date(dateStr);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months--;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0 && rem === 0) return "今月から";
  if (years === 0) return `${rem}ヶ月`;
  if (rem === 0) return `${years}年`;
  return `${years}年${rem}ヶ月`;
}

// 未入力の表示は必ずこの関数を通す。記号を変えたい場合はここだけ変更する
export const EMPTY_MARK = "ー";
export const disp = (v) => {
  if (v === null || v === undefined) return EMPTY_MARK;
  const s = String(v).trim();
  return s === "" ? EMPTY_MARK : s;
};

// 最寄り駅からの移動時間ラベル。「駅」の有無を正規化して「○○駅から◯分」に統一（求人詳細・農家プレビュー共通）
export function stationLabel(station, commute) {
  const s = (station || "").trim();
  if (!s) return commute || "";
  const withEki = s.endsWith("駅") ? s : s + "駅";
  return `${withEki}から${commute || ""}`.trim();
}

// カレンダーの応募状態ラベル/色（MyCalendar・今日ページ系で共用）
// リアルタイム表記（2026-07-25）。カレンダーRPCはterms確認時刻を返さないため、approvedは面接中（採用前の代表段階）で表示
export const CALENDAR_STATUS_LABEL = { approved:"面接中", meeting:"採用", interview:"面接中", contracted:"採用", working:"作業中", completed:"完了" };
export const CALENDAR_STATUS_COLOR = (s) => (["approved","contracted","working"].includes(s) ? {bg:"#E6F7EE",fg:"#00A86B"} : s==="completed" ? {bg:"#F3F3F3",fg:"#717171"} : {bg:"#FFF4E0",fg:"#C77700"});

// ── チャット定数（ChatView・応募者カード・今日ページ等で共用） ──
// チャット可能な段階（承認以降）のapplicationsを一覧表示。自分がworker/farmerどちらの当事者でも拾う
export const CHAT_ELIGIBLE_STATUSES = ["approved","meeting","interview","contracted","working"];
// チャット一覧の表示対象（2026-07-19）：完了後もスレッドを残す＝履歴として双方の確認が取れる状態を保つ。
// 打刻・緊急連絡など「進行中だけの操作」の判定はCHAT_ELIGIBLE_STATUSESのまま変えない
// applied=応募直後から相手とチャットで繋がる（2026-07-19）。rejected=見送りの自動返信を読めるよう履歴として残す
export const CHAT_LIST_STATUSES = ["applied", ...CHAT_ELIGIBLE_STATUSES, "completed", "rejected"];
// リアルタイム帯（2026-07-25たきと指示・同日改定）：応募中→面接中→採用→作業中→完了 の5段＋終端（見送り/失効）。
// すべて農家のアクションがトリガー（承認→面接中／採用タップ→採用／開始→作業中／完了記録→完了）。
// 「打合せ」段階はトリガーを定義できないため削除（2026-07-25たきと判断）。
// statusだけでは面接中/採用を区別できない（採用はterms確認時刻で管理・contracted/meeting/interviewは書き込まれない）ため、
// 応募行(a)から段階キーを導出する：承認〜採用前＝面接中／採用（双方確認）後〜開始前＝採用
export const appPhaseKey = (a) => {
  const st = a?.status;
  if (["applied","rejected","expired","completed","working"].includes(st)) return st;
  const hired = !!(a?.terms_confirmed_worker_at && a?.terms_confirmed_farmer_at);
  return hired ? "contracted" : "interview";
};
export const APP_PHASE_LABEL = { applied:"応募中", interview:"面接中", contracted:"採用", working:"作業中", completed:"完了", rejected:"見送り", expired:"失効" };
// expiredは黒＝失効カードの黒オーバーレイと同色（2026-07-25。失効は応募の段階でなく求人の締め切りとして表示する）
export const APP_PHASE_COLOR = { applied:"#C77700", interview:"#8E24AA", contracted:"#00897B", working:"#E24B4A", completed:"#607D8B", rejected:"#9E9E9E", expired:"#111111" };
// 定型文（2026-07-22・第8弾）：チャット入力欄の＋から役割別に挿入。「何を書けばいいか分からない」摩擦を消す
export const CHAT_TEMPLATES_FARMER = [
  "承認しました。日程のご相談をお願いします",
  "集合場所と持ち物は確認カードのとおりです",
  "当日はよろしくお願いします",
  "その日は都合が悪くなりました。別の日はいかがですか",
];
export const CHAT_TEMPLATES_WORKER = [
  "はじめまして。よろしくお願いします",
  "集合場所を教えてください",
  "持ち物はこれで大丈夫ですか？",
  "本日はありがとうございました",
];

// きっかけアンケートの選択肢（SurveyStats・さがすの初回いいねアンケートで共用）
// きっかけアンケート（初回いいね時・2026-07-24）：Q1どこで知ったか（単一）、Q2どう使いたいか（複数）
export const SURVEY_SOURCES = ["定例会・イベントで", "知人・家族の紹介", "冊子・チラシのQRから", "SNS・ネット検索", "農家さんから聞いた", "その他"];
export const SURVEY_REASONS = ["収入を得たい", "農業を経験してみたい", "繁忙期の人手がほしい", "地域の人とつながりたい", "空いた時間を活かしたい", "その他"];

// カラーパレット（旧デザインシステム・App全域とadmin系で使用）
// ══════════════════════════════════════════════════════════
// DESIGN SYSTEM — 「台帳の美学」
// 和紙と墨、金泥で書かれた帳簿を現代に翻訳する
// ══════════════════════════════════════════════════════════
export const C = {
  // ── New design system ──
  bg:           "#FFFFFF",
  bgSoft:       "#F7F7F7",
  card:         "#FFFFFF",
  text:         "#222222",
  textSub:      "#717171",
  textLight:    "#B0B0B0",
  border:       "#EBEBEB",
  accent:       "#00A86B",
  accentLight:  "#E6F7EF",
  danger:       "#E24B4A",
  dangerLight:  "#FCEBEB",
  warning:      "#F5A623",
  warningLight: "#FEF3E2",
  // ── Semantic aliases (backwards compat) ──
  gold:    "#F5A623",
  goldLt:  "#F7B84B",
  goldPl:  "#FEF3E2",
  goldDim: "#B87A1A",
  bamboo:  "#00A86B",
  bambooL: "#2DC28A",
  bambooPl:"#E6F7EF",
  shu:     "#E24B4A",
  shuPl:   "#FCEBEB",
  ink:     "#222222",
  mid:     "#717171",
  dim:     "#717171",
  ghost:   "#B0B0B0",
  rule:    "#EBEBEB",
  ruleD:   "#EBEBEB",
  // ── Deprecated dark colors → light equivalents ──
  void:    "#F7F7F7",
  deep:    "#FFFFFF",
  bark:    "#222222",
  shadow:  "#F7F7F7",
  washi:   "#FFFFFF",
  cream:   "#FFFFFF",
  ivory:   "#F7F7F7",
  pale:    "#F7F7F7",
};

export function uid(){ return Math.random().toString(36).slice(2,9); }

export function toKatakana(str) {
  return str.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

export function toHiragana(str) {
  return str.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// 月ラベル・数値表記（cn=桁区切り・man=万表記）
export const MONTHS    = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
export const cn  = n => Math.round(n).toLocaleString("ja-JP");
export const man = n => { const a=Math.abs(n); return a>=10000?(Math.round(a/1000)/10).toFixed(1)+"万":cn(a); };

// 今年（西暦）。就農年数表示・生年選択肢・フッターコピーライトで共用
export const THIS_YEAR = new Date().getFullYear();
// account_holders（本人確認・口座名義人情報）の規約バージョン。全面改訂時にここを上げると再同意検出に使える
export const TERMS_VERSION = "v1-2026-07";
export const PRIVACY_VERSION = "v1-2026-07";

// 分割3-B（2026-07-25）：App.jsxから移動（LandingFlow・WorkerProfileEditで共用）
export // 作業リスト（アイコン無し・文字だけカード。増やすときはここに1行足すだけ）
const TASK_OPTIONS = [
  { name:"収穫",     icon:"" },
  { name:"定植",     icon:"" },
  { name:"選果",     icon:"" },
  { name:"農薬散布", icon:"" },
  { name:"草刈り",   icon:"" },
  { name:"袋かけ",   icon:"" },
];

// 分割3-B（2026-07-25）：App.jsxから移動

// 緊急連絡の種別選択肢（当事者ごとに異なる）。attendance_events.kindのCHECK制約と対応
export const WORKER_EMERGENCY_KINDS = [{ v:"late", l:"遅れる" }, { v:"absent_notice", l:"欠勤の連絡" }, { v:"no_show_report", l:"👻 現地に相手がいません・連絡がつきません" }];
export const FARMER_EMERGENCY_KINDS = [{ v:"cancel", l:"中止" }, { v:"postpone", l:"延期" }, { v:"no_show_report", l:"👻 現地に相手がいません・連絡がつきません" }];

// 分割3-C（2026-07-25）：App.jsxから移動（求人詳細・確認ページ・プレビューシートで共用）

// 農園紹介のお題一覧（求人詳細・確認ページ共通。記入済みのお題のみ返す）
export const farmIntroTopics = (e) => [
  { label:"就農するまで", body: e.intro_path },
  { label:"いま楽しいこと", body: e.intro_joy },
  { label:"どんな作物を、どんな想いで", body: e.intro_crops },
  { label:"職場の雰囲気", body: e.intro_atmosphere },
  { label:"初めての人へのメッセージ", body: e.intro_message },
].filter(t => t.body && t.body.trim());

// 待遇バッジ（タイトル下用・2026-07-16）：employer_profilesのONの項目だけ短いラベルで返す。
// 確認ページ・詳細ページで共通。OFFの項目は出さない（ダミー禁止）
export function perkBadges(ep) {
  if (!ep) return [];
  return [
    ep.has_transport && "🚐 送迎あり",
    ep.has_parking && "🅿️ 駐車場",
    ep.has_commute_allowance && "🚃 通勤手当",
    ep.has_bonus && "🎁 賞与",
    ep.employer_pays_supplies && ("🧤 持ち物は農家負担" + (ep.supplies_cap ? "（" + ep.supplies_cap + "）" : "")),
    ep.accessory_ok && "💍 アクセサリーOK",
  ].filter(Boolean);
}
