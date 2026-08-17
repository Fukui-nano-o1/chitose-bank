// 純粋ヘルパー＋定数（分割・段階1・2026-07-24）：React/DOM/supabaseに依存しない層。
// ここに置いてよいのは「引数→戻り値」だけで完結する関数と、読み取り専用の定数のみ。

// 管理者判定（届出後にゲートを外す際はここを変更する。保存・入力機能のゲートにも使用）
export const ADMIN_EMAIL = "t5fki6643qty@gmail.com";
export const isAdmin = (user) => user?.email === ADMIN_EMAIL;

// ローカル時刻基準の "YYYY-MM-DD"（toISOString はUTC変換でJSTでは前日にズレる＝date_start保存バグの原因。必ずこちらを使う）
export const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// ── まもなく開始の表示窓（#/admin/upcoming・2026-08-01たきと指示「開始1週間前から展開」）──
// 実施日＝合意日程（agreed_dates）の最初の日、無ければ求人の開始日（admin_working_jobs RPC の upcoming 行を想定）。
// 日程未設定は窓に入らない（仕事中ページ #/admin/working の「まもなく開始」には全件出るので、そちらで見える）
export const upcomingStartYmd = (item) => {
  const ad = item?.agreed_dates;
  if (Array.isArray(ad) && ad.length) return [...ad].map(String).sort()[0];
  return item?.date_start || null;
};
// 開始日が days 日以内（過ぎているものも含む＝開始日到来後・自動開始前の取りこぼしも見せる）
export const startsWithinDays = (item, days = 7) => {
  const start = upcomingStartYmd(item);
  if (!start) return false;
  const limit = new Date(); limit.setDate(limit.getDate() + days);
  return start <= ymdLocal(limit);
};

// ── 求人の状態の定義（唯一のソース・2026-07-27たきと指示「終了は終了、下書きは下書き」）──
// 曖昧なまま各所でstatus文字列だけを見ていると、終了した求人が下書き扱いで出る等の食い違いが起きる。
// 判定はここに集約し、各画面はこの関数を使う。引数は jobs 行（date_start/date_end/work_time/status/opened_at）
//
// 終了（ended）＝作業日程が過ぎた。statusに関係なく最優先（下書きでも審査中でも、日程が過ぎたら終了）
export const isJobEnded = (j) => {
  if (!j) return false;
  const end = j.date_end || j.date_start;
  if (!end) return false;
  const today = ymdLocal(new Date());
  if (end < today) return true;
  // 最終日が今日なら、勤務終了時刻を過ぎているかで判定（例：17:00〜19:00 は19時以降が終了）
  if (end === today && j.work_time) {
    const m = String(j.work_time).match(/〜\s*(\d{1,2}):(\d{2})/);
    if (m) { const n = new Date(); if (n.getHours()*60 + n.getMinutes() > parseInt(m[1],10)*60 + parseInt(m[2],10)) return true; }
  }
  return false;
};
// 一時非公開＝掲載歴（opened_at）があるのに今はdraft。下書きではない（公開中タブに帯付きで残す側）
export const isJobUnpublished = (j) => !!(j && j.status === "draft" && j.opened_at);
// 下書き（作成中）＝まだ一度も掲載しておらず、日程も過ぎていないdraft。これ以外をdraftと呼ばない
export const isJobDraft = (j) => !!(j && j.status === "draft" && !j.opened_at && !isJobEnded(j));

// 作業日当日か（開始・終了打刻の表示条件などに使用）
export function isWorkDayToday(dateStart, dateEnd) {
  if (!dateStart) return false;
  const fmt = d => { const dt = new Date(d); return dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0"); };
  const todayStr = fmt(new Date());
  const startStr = fmt(dateStart);
  const endStr = dateEnd ? fmt(dateEnd) : startStr;
  return todayStr >= startStr && todayStr <= endStr;
}

// ── 見守りページ（仕事中／まもなく開始）の振り分け（唯一のソース・2026-08-03たきと指示）──
// 当日は「仕事中」が正。まもなく開始は仕事当日には展開しない＝2ページに同じマッチを二重展開しない。
// 3箇所（仕事中ページの昇格・まもなく開始ページの表示・App.jsxのトップページ着地判定）が
// 必ず同じ判定を使うため、ここに集約する。ズレると「着地したのに空のページ」が起きる。
//
// 作業当日か（合意日 agreed_dates があればその範囲、無ければ求人の date_start〜date_end）
export const isTodayWork = (item) => {
  const ad = item?.agreed_dates;
  if (Array.isArray(ad) && ad.length) {
    const days = ad.map(d => String(d).slice(0, 10)).sort();
    const today = ymdLocal(new Date());
    return today >= days[0] && today <= days[days.length - 1];
  }
  return isWorkDayToday(item?.date_start, item?.date_end);
};
// まもなく開始に出す対象＝開始 days 日以内、ただし当日は除く（当日は仕事中ページが持つ）
export const isUpcomingSoon = (item, days = 7) => startsWithinDays(item, days) && !isTodayWork(item);

// ── カレンダーに出す日（唯一のソース・2026-08-11たきと指示「希望日は反映されているか」）──
// この予定が実際に占める日を返す。優先順は「決まったもの＞申請されたもの＞求人票の期間」：
//   1. agreed_dates    … 農家が確定した働く日（確定）
//   2. available_dates … 働き手が応募時に申請した労働希望日（未確定。承認直後はこれが最新の事実）
//   3. 求人期間 date_start〜date_end … 上のどちらも無いとき
// いずれからも holidays（求人の休日）を除く。返り値は "YYYY-MM-DD" の Set。
// available_dates は配列のほかに "any"（期間中いつでもOK）と null（単日求人）を取り、
// どちらも「日を絞っていない」＝3の期間へ倒す（配列のときだけ絞り込む）。
//
// ★この関数が答えるのは「どの日か」だけ。「確定したか」は別＝段階（appPhaseKey）で見る
//   ＝承認（面接中）は未確定・採用（contracted）で確定（2026-08-11たきと指示）。
//   日の出どころ（希望日か合意日か）を確定の判定に使わないこと。
// ★カレンダーの塗り・名前チップ・きょうの仕事は必ずこの関数を使うこと。
//   別々に書くと同じ画面の中で食い違う（塗りは期間・チップは合意日、が実際に起きていた）。
// ★lib/hire.js の effectiveWorkDates とは別物。あちらは二重予約の壁の判定で、
//   DBの app_work_dates と1対1で揃える約束があるため、未確定の希望日を混ぜない
//   （混ぜると採用を止める壁の意味が変わる＝load-bearing ので、変えるなら両方＋DBを揃える）。
export function entryWorkDays(entry) {
  const holidays = new Set(Array.isArray(entry?.holidays) ? entry.holidays.filter(d => typeof d === "string") : []);
  const pickDays = (v) => (Array.isArray(v) ? v.filter(d => typeof d === "string" && d).map(d => d.slice(0, 10)) : null);
  const keep = (list) => new Set(list.filter(d => !holidays.has(d)));

  const agreed = pickDays(entry?.agreed_dates);
  if (agreed && agreed.length) return keep(agreed);
  const avail = pickDays(entry?.available_dates);
  if (avail && avail.length) return keep(avail);

  const start = entry?.date_start ? String(entry.date_start).slice(0, 10) : null;
  if (!start) return new Set();
  const end = entry?.date_end ? String(entry.date_end).slice(0, 10) : start;
  const out = [];
  // 比較は "YYYY-MM-DD" の文字列で行う（時差の影響を受けない）。
  // 上限400は保険＝終了日が壊れていても無限ループにしない
  for (let t = new Date(start + "T00:00:00"), i = 0; ymdLocal(t) <= end && i < 400; t.setDate(t.getDate() + 1), i++) {
    out.push(ymdLocal(t));
  }
  return keep(out);
}

// ── 打刻の時間窓（第13弾(1)・2026-07-30たきと指示）──
// 他社（タイミー・メルカリハロ・LINEスキマニ）は全て打刻可能な時間窓を持つ。当方も入れる。
// 判定はここに集約し、打刻ボタンのある画面（応募状況ページ・求人詳細）はこの関数を使う。
export const PUNCH_WINDOW_MIN = 60; // 開始の握手は作業開始時刻の60分前から押せる

// work_time（"8:00〜17:00"）の開始時刻を「その日の0時からの分」で返す。取れなければ null
export const workStartMinutes = (workTime) => {
  const m = String(workTime || "").match(/^\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
  return h * 60 + mi;
};
// "8:00" のような表示用文字列に戻す
export const minutesToHm = (mins) => {
  const v = ((mins % 1440) + 1440) % 1440;
  return Math.floor(v / 60) + ":" + String(v % 60).padStart(2, "0");
};
// 開始の握手を押せるか。押せない時は理由の文言つきで返す。
// ・作業日当日でなければ押せない（深夜4:00の日境界は既存の isWorkDayToday の扱いをそのまま使う）
// ・work_time が取れない求人は時間で縛らない（＝当日ならいつでも押せる。従来どおり）
export function punchStartWindow(job, now = new Date()) {
  if (!isWorkDayToday(job?.date_start, job?.date_end)) {
    return { canPunch: false, reason: "作業日の当日になると押せます" };
  }
  const startMin = workStartMinutes(job?.work_time);
  if (startMin === null) return { canPunch: true, reason: "" };
  const openMin = startMin - PUNCH_WINDOW_MIN;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin >= openMin) return { canPunch: true, reason: "" };
  return {
    canPunch: false,
    reason: `${minutesToHm(startMin)}の${PUNCH_WINDOW_MIN}分前（${minutesToHm(openMin)}）から押せます`,
  };
}

// ── 打刻の透明性（第13弾・追補・2026-07-30たきと判断）──
// オフラインの申告打刻に相手の承認は課さない（電波が最も悪い場面で摩擦を増やさない）。
// 代わりに「事実の質」を隠さず出す＝申告であることのフラグと、双方の署名時刻の乖離を見せる。
// 記録そのものは改変しない・申告打刻も実績に算入する、という台帳の扱いは変えない。
export const PUNCH_GAP_MIN = 30; // これ以上ズレていたら並べて出す

// 働き手の打刻と農家の確認、それぞれの署名時刻の開き（分）。片方でも無ければ null
const gapMinutes = (a, b) => {
  if (!a || !b) return null;
  const d = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  if (!isFinite(d)) return null;
  return Math.round(d / 60000);
};
// 開始・終了それぞれについて「並べて出すべきか」を返す。
// 開始＝働き手のstarted_at と 農家のfarmer_confirmed_start_at
// 終了＝農家のwork_completed_at と 働き手のworker_confirmed_end_at
export function punchDivergence(app) {
  const s = gapMinutes(app?.started_at, app?.farmer_confirmed_start_at);
  const e = gapMinutes(app?.work_completed_at, app?.worker_confirmed_end_at);
  return {
    start: (s !== null && s >= PUNCH_GAP_MIN) ? { minutes: s, worker: app.started_at, farmer: app.farmer_confirmed_start_at } : null,
    end:   (e !== null && e >= PUNCH_GAP_MIN) ? { minutes: e, farmer: app.work_completed_at, worker: app.worker_confirmed_end_at } : null,
  };
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

// 掲載前の確認（2026-07-30たきと指示で記録化）：掲載モーダルで農家がチェックする自己申告。
// 表示と記録（job_publish_checks.items）でこの配列を共用する＝画面と台帳の文言が食い違わない。
// ★文言を直す時の注意：過去の記録には「その時の文言」が入っているので、既存行は書き換えない（追記のみの台帳）
export const PUBLISH_CHECKS = [
  "報酬・勤務時間・休憩の内容に間違いはありません",
  "危険な場所・作業は、漏れなく記載しました（該当が無いことを確認しました）",
  "日程・場所・人数は、実際に働いていただける内容です",
  "記載内容は事実です。公開後に運営が内容を確認することに同意します", // 2026-08-14 承認プロセスの削除＝事前審査→公開後の確認に改定（過去の記録の文言は不変）
];

// 保険の準備・自己申告（2026-07-23）：農家プロフィールで方針を表明。運営は証書を確認しない。
// considering=これから準備する は、表示チップでは「これから準備予定」にする。employer_profiles.insurance_items に key配列で保存。
export const INSURANCE_ITEMS = [
  // これから準備する＝先頭・排他（2026-07-25たきと指示）。選ぶと他の保険の選択・ひとことはリセットされる
  { k:"considering",     label:"これから準備する",               chip:"これから準備予定",   icon:"🌱" },
  { k:"day_accident",    label:"1日単位の傷害保険（作業日ごと）", chip:"1日単位の傷害保険",   icon:"🗓" },
  { k:"annual_accident", label:"年間の傷害保険",                 chip:"年間の傷害保険",     icon:"☂️" },
  { k:"rosai",           label:"労災保険（特別加入など）",        chip:"労災保険",           icon:"🏥" },
  { k:"facility",        label:"農業施設・賠償責任保険",          chip:"施設・賠償責任保険", icon:"🏠" },
  { k:"vehicle",         label:"移動中の車両保険",               chip:"車両保険",           icon:"🚗" },
];

// 保険申告の排他ガード（2026-07-25たきと指示）：「これから準備する(considering)」は実際の保険と両立しない。
// 編集UIは排他済みだが、排他化以前の旧データが両方持つ場合があるため、表示側では実際の保険を優先しconsideringを落とす
export const normalizeInsuranceItems = (items) => {
  const arr = Array.isArray(items) ? items : [];
  return arr.some(k => k !== "considering") ? arr.filter(k => k !== "considering") : arr;
};

// 保険の選択を切り替えた結果を返す純粋関数（2026-07-29・保険ページとプロフィールの保険カードで共用）。
// 排他ルール：「これから準備する(considering)」と実際の保険は両立しない。
//   losing=true は「他の選択・ひとことが消える」印＝呼び出し側が確認を取ってから適用する（確認の文言はUI側）
export const insuranceToggle = (items, notes, k, v) => {
  const its = Array.isArray(items) ? items : [];
  const nts = (notes && typeof notes === "object") ? notes : {};
  if (k === "considering" && v) {
    return {
      items: ["considering"],
      notes: nts.considering ? { considering: nts.considering } : {},
      losing: its.some(x => x !== "considering") || Object.keys(nts).some(x => x !== "considering" && (nts[x] || "").trim()),
    };
  }
  if (v && its.includes("considering")) {
    // 実際の保険を選んだら「これから準備する」は自動で外れる（逆向きは失うものが無いので確認なし）
    const n = { ...nts }; delete n.considering;
    return { items: [k], notes: n, losing: false };
  }
  return { items: v ? [...new Set([...its, k])] : its.filter(x => x !== k), notes: nts, losing: false };
};

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

// カード・サムネ表示用：写真1枚（{url,thumb,caption} または旧string形式）から軽量サムネURLを選ぶ
// （2026-08-02・転送量対策②）。thumbが無い古い写真は原寸へフォールバック。詳細ページの
// カルーセル・ライトボックス・審査プレビューは原寸(url)のままにすること（画質が要る画面）
export const photoThumb = (p) => !p ? null : (typeof p === "string" ? p : (p.thumb || p.url || null));

// ── 賃金支払条件（2026-08-02・固定ポリシーの構造化保存）─────────────────────
// 内部値はコード値（jobs.pay_method / pay_timing / wage_closing_rule）。表示ラベルはここに集約し、
// 各コンポーネントへ同じ日本語を再ハードコードしない。
// 現在の正式な値は cash / same_day_after_work / each_workday の3つのみ。
// 「相談して決める」「銀行振込」「週末/月末払い」は正式な選択肢として扱わない
// （封印中の入力UIの残置ラベルであり、解禁時は締切日・支払日・同意処理を含めて別途設計する）
export const PAY_METHOD_LABELS = { cash: "現金手渡し" };
export const PAY_TIMING_LABELS = { same_day_after_work: "各作業日の作業終了後" };
export const WAGE_CLOSING_RULE_LABELS = { each_workday: "各作業日" };
export const PAY_TERMS_UNKNOWN = "支払条件を確認できません";
// 1行要約「支払：各作業日の作業終了後・現金手渡し」。NULL・未知コードは推測表示せず「確認できません」
// （プロフィールや旧stateへのフォールバック禁止）
export function payTermsLine(j) {
  const t = PAY_TIMING_LABELS[j?.payTiming], m = PAY_METHOD_LABELS[j?.payMethod];
  return (t && m) ? `支払：${t}・${m}` : PAY_TERMS_UNKNOWN;
}
// 現在の固定ポリシー（draftの確認ページ・掲載シート＝DB列が入る前のプレビュー表示に使う）
export const CURRENT_PAY_POLICY = { payMethod: "cash", payTiming: "same_day_after_work", wageClosingRule: "each_workday" };

// 時間外労働の表示（2026-08-03たきと指示）：所定の勤務時間を超える労働の有無は労働条件の明示事項。
// 求人詳細・確認ページ・審査プレビューで同じ文言を出すためここに一本化する。
// policy: "なし"／"あり"／空（未設定）、detail: "あり"のときの目安。未設定は "" を返し、
// 呼び出し側が他の項目と同じ体裁（「ー」「未設定」）で描く
export const OVERTIME_OPTIONS = ["なし", "あり"];
export function overtimeLine(policy, detail) {
  const p = String(policy || "").trim();
  if (!p) return "";
  if (p !== "あり") return p; // 「なし」はそのまま
  const d = String(detail || "").trim();
  return d ? `あり（${d}）` : "あり";
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
    // 集合場所の番地・建物名（2026-08-03たきと指示：会員には番地まで表示）。
    // jobs_public.work_address は anon に NULL マスク済み（2026-07-31・訪問者開示レベル第1弾）＝
    // 未ログインには常に空で届く。開示の境界はDB側が正・フロントは届いた値を表示するだけ
    // j.address フォールバック＝オーナープレビュー等 jobs テーブルを直読みする経路（列名がaddress）用。
    // jobs_public 経由では address 列が存在しないので訪問者の値が漏れることはない
    workAddress: j.work_address || j.address || "",
    // 番地の「有無」だけは訪問者にも届く（jobs_public.has_work_address・2026-08-03）＝
    // 番地が設定された求人にだけモザイクを出すための判定。番地本文は届かない
    hasWorkAddress: j.has_work_address != null ? !!j.has_work_address : !!((j.work_address || j.address || "").trim()),
    experience: j.job_exp || "", // 必要経験の選択式は撤回（2026-07-18）。旧求人の保存値のみ表示・未入力はdispで「ー」
    icon: "🌾",
    lat:    j.lat != null ? Number(j.lat) : null,
    lng:    j.lng != null ? Number(j.lng) : null,
    radius: j.geo_radius_m != null ? Number(j.geo_radius_m) : null,
    count: j.headcount != null ? j.headcount + "名" : "", headcount: j.headcount, photos: j.photos || [],
    // 募集主の法定表示（2026-07-30・第14弾）：掲載時にjobsへ転写された値をそのまま出す。
    // 原本（employer_profiles）ではなく求人ごとの控えを見るので、掲載後にプロフィールを直しても
    // その求人の表示は掲載時点のまま＝広告の記載と食い違わない
    recruiterName: j.recruiter_name || "",
    recruiterAddress: j.recruiter_address || "",
    recruiterContact: j.recruiter_contact || "",
    nearestStation: j.nearest_station || "", workTime: j.work_time || "",
    breakTime: j.break_time || "",
    commuteTime: j.commute_time || "", jobBody: j.notes || "",
    cautions: j.cautions || "",
    // 時間外労働（2026-08-03）：有無＋「あり」のときの目安。求人ごとの条件ので jobs 直持ち
    overtimePolicy: j.overtime_policy || "",
    overtimeDetail: j.overtime_detail || "",
    wanted: "", items: j.belongings || "",
    // 賃金支払条件（2026-08-02）：掲載申請時にトリガーが固定ポリシーを確定保存した値。表示はコード値→ラベル変換のみ
    payMethod: j.pay_method || "", payTiming: j.pay_timing || "", wageClosingRule: j.wage_closing_rule || "",
    dateStart: j.date_start ? new Date(j.date_start) : null,
    dateEnd: j.date_end ? new Date(j.date_end) : null,
    holidays: Array.isArray(j.holidays) ? j.holidays : [], // 期間内の休日（"YYYY-MM-DD"配列・2026-08-03）

    dangerPlaces: (j.danger_places || []).filter(p => p && (p.label || p.desc)),
    dangerTasks: (j.danger_tasks || []).filter(t => t && (t.label || t.desc)),
    fullPayGuarantee: !!j.full_pay_guarantee,
    beginnerOk: !!j.beginner_ok,
    instantApproveRepeat: !!j.instant_approve_repeat,
    // 待遇（2026-08-02改定）：掲載申請時にDBトリガーがプロフィール10項目＋求人固有上書きを合成して
    // jobs.perksへ確定保存する＝公開求人はこの値だけを見る（employer_profilesの現在値へのフォールバック禁止）。
    // NULLは掲載前のdraftのみ（確認ページはプレビューとしてプロフィール待遇を初期値に使う・従来どおり）
    perks: j.perks || null,
    // 保険（2026-08-02新設）：掲載申請時に凍結した {items, notes, snapshot_at}。
    // NULL＝スナップショット導入前のレガシー求人＝「保険情報を確認できません」を表示（現在値への代用禁止）
    insuranceSnapshot: j.insurance_snapshot || null,
    profileSnapshotAt: j.profile_snapshot_at || "",
    // 写真の無い求人の表紙に出す求人者のアイコン（2026-07-30たきと指示）。jobs_publicに2列追加済み。
    // 公開範囲は増えていない＝同じ2項目は job_employer_profile が求人詳細で既に返している
    employerName: j.employer_nickname || "",
    employerAvatar: j.employer_avatar_url || "",
    experiencedPreferred: !!j.experienced_preferred,
    // 掲載が終わった求人（2026-08-05）：jobs_public が status='closed' も返すようになった。
    // 「過去の求人は消さない」方針の表示側＝さがすには終了帯つきで並べる（応募はできない）
    closed: j.status === "closed",
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
// 2026-08-08たきと指示「作物はできる限り追加」：徳島・吉野川の産地作物（スダチ・レンコン・
// カリフラワー・ニンジン・ユズ等）を優先しつつ全国の主要作物まで拡充。
// ★粒度は大分類まで（品種名は入れない＝求職者公開項目の制約「品種は非公開」と揃える。
//   なると金時→サツマイモ、シャインマスカット→ブドウ）。一覧に無いものは従来どおり「その他」で自由入力
// ★並びの制約：JobCardのアイコン照合が job.crop.includes(name) の先頭一致ので、
//   名前が他の名前を含む組は長い方を先に置く（タマネギ→ネギ の順を崩さない）
// 2026-08-08たきと指示「アイコンが重複している。ないなら描画して挿入しろ」：
//   絵文字を近いもので流用した結果 🥬が4種・🌿が4種・🥕が3種…と重複していたため、
//   絵文字が無い作物は svg:"キー" を指定し components/CropIcon.jsx の自作SVGで描く（全種が別の絵）。
//   ★icon（絵文字）と svg（自作）はどちらか一方だけを持たせる。増やす時もこの規則を守ること
export const CROP_OPTIONS = [
  // 野菜（果菜）
  { name:"ブロッコリー", icon:"🥦" },
  { name:"トマト",       icon:"🍅" },
  { name:"キュウリ",     icon:"🥒" },
  { name:"ナス",         icon:"🍆" },
  { name:"イチゴ",       icon:"🍓" },
  { name:"ピーマン",     icon:"🫑" },
  { name:"カボチャ",     icon:"🎃" },
  { name:"ズッキーニ",   svg:"zucchini" },
  { name:"オクラ",       svg:"okra" },
  { name:"トウモロコシ", icon:"🌽" },
  { name:"スイカ",       icon:"🍉" },
  { name:"メロン",       icon:"🍈" },
  // 野菜（葉茎菜）
  { name:"キャベツ",     icon:"🥬" },
  { name:"レタス",       svg:"lettuce" },
  { name:"ホウレンソウ", svg:"spinach" },
  { name:"ハクサイ",     svg:"napa" },
  { name:"カリフラワー", svg:"cauliflower" },
  { name:"アスパラガス", svg:"asparagus" },
  { name:"タマネギ",     icon:"🧅" },
  { name:"ネギ",         svg:"negi" },
  { name:"ニンニク",     icon:"🧄" },
  { name:"シソ",         svg:"shiso" },
  // 野菜（根菜・イモ）
  { name:"ニンジン",     icon:"🥕" },
  { name:"ダイコン",     svg:"daikon" },
  { name:"カブ",         svg:"turnip" },
  { name:"ジャガイモ",   icon:"🥔" },
  { name:"サツマイモ",   icon:"🍠" },
  { name:"サトイモ",     svg:"taro" },
  { name:"ショウガ",     svg:"ginger" },
  { name:"レンコン",     icon:"🪷" },
  // 穀類・豆
  { name:"米",           icon:"🌾" },
  { name:"麦",           svg:"wheat" },
  { name:"ソバ",         svg:"soba" },
  { name:"大豆",         icon:"🫘" },
  { name:"エダマメ",     svg:"edamame" },
  // 果樹
  { name:"ブドウ",       icon:"🍇" },
  { name:"リンゴ",       icon:"🍎" },
  { name:"ミカン",       icon:"🍊" },
  { name:"スダチ",       svg:"sudachi" },
  { name:"ユズ",         svg:"yuzu" },
  { name:"レモン",       icon:"🍋" },
  { name:"カキ",         svg:"persimmon" },
  { name:"ナシ",         icon:"🍐" },
  { name:"モモ",         icon:"🍑" },
  { name:"ウメ",         svg:"ume" },
  { name:"クリ",         icon:"🌰" },
  { name:"キウイ",       icon:"🥝" },
  // その他
  { name:"シイタケ",     icon:"🍄" },
  { name:"茶",           icon:"🍵" },
  { name:"花",           icon:"💐" },
];

// 働き手Q&Aの質問を、表示だけ簡易型にする（2026-08-06たきと指示「意図は変えずに簡易型に」）。
// ★保存されている質問文（worker_profiles.pr_qa の q）は書き換えない＝記録は当時の文言のまま。
//   ここは表示用の対応表で、未登録の質問文はそのまま出す（消さない・推測で言い換えない）
export const QA_SHORT_LABELS = {
  "これまでの農作業の経験を教えてください": "農作業の経験は？",
  "これまでにどんな農作業の経験がありますか？（他のサービスや手伝いでの経験も、作業の内容で教えてください）": "どんな農作業の経験が？",
  "自分の強みはなんですか？": "強みは？",
  "どのくらいの頻度で働きたいですか？": "働きたい頻度は？",
  "農業のバイトを始めたのはいつですか？": "始めたのはいつ？",
  "農作業に興味を持ったきっかけは？": "興味を持ったきっかけは？",
  "農業にどれくらい興味がありますか？": "農業への興味は？",
  "将来、農業とどう関わりたいですか？": "将来の関わり方は？",
  "バイトをするうえで心がけていることは？": "心がけていることは？",
  "働くうえで大事にしていることは？": "大事にしていることは？",
  "人と働くときに気をつけていることは？": "人と働くとき気をつけることは？",
  "農業以外の仕事・バイトの経験は？": "農業以外の経験は？",
  "使ったことのある道具や機械はありますか？": "使える道具・機械は？",
  "体を動かすことは好きですか？": "体を動かすのは好き？",
  "働けるのはどの季節・時期ですか？": "働ける季節は？",
  "朝と夕方、どちらが動きやすいですか？": "朝と夕方どちら？",
  "どのくらいの距離まで通えますか？": "通える距離は？",
  "農家さんに一言お願いします": "農家さんへ一言",
  "趣味や普段していることは？": "趣味は？",
  "chitose-bankを知ったきっかけは？": "知ったきっかけは？",
  "このバイトで得たいことは？": "得たいことは？",
};
// 農園紹介のお題・問いかけQ&Aは「運営が本当に質問している」文体へ言い換え（2026-08-07たきと指示・
// 意図は変えない・保存されているラベルは不変＝表示だけの対応表。QaChatがこの辞書を通す）
export const QA_ASK_LABELS = {
  "就農するまで": "就農するまでの道のりを教えてください",
  "いま楽しいこと": "いま、楽しいことはなんですか？",
  "どんな作物を、どんな想いで": "どんな作物を、どんな想いで育てていますか？",
  "職場の雰囲気": "職場の雰囲気を教えてください",
  "初めての人へのメッセージ": "初めての人へ、メッセージをお願いします",
  "うちの畑・農園のユニークなところ": "うちの畑・農園のユニークなところは？",
  "働きに来た人に、いつもしていること": "働きに来た人に、いつもしていることは？",
};
export const qaShort = (q) => {
  const key = String(q || "").trim();
  return QA_SHORT_LABELS[key] || QA_ASK_LABELS[key] || q;
};

// ── 働き手「はたらき方の希望」質問セット（2026-08-14たきと承認・雇い手のHOST_STYLE_QUESTIONSと対）──
// すべて選択式・任意。値は physical_level と同じくラベル文字列で保存（旧値もそのまま表示＝書き換えない）。
// ★「希望する作業の強さ」のラベルは必ずこの名称（「体力」等の身体属性を想起させる表現は禁止・2026-07-14規則）。
// ★追加3問（作業中の雰囲気・教わり方の希望・希望する働き方）は公開許可リストへの追加＝2026-08-14たきと裁定。
//   判断理由：いずれも労働条件の希望／業務上の意思疎通に必要な情報（身体属性・年代等の禁止項目に非該当）
export const WORKER_STYLE_QUESTIONS = [
  { k:"physical_level", label:"希望する作業の強さ", q:"希望する作業の強さは？", emoji:"💪",
    options:["軽めの作業がうれしい","どちらでもOK","力仕事も歓迎"] },
  { k:"work_mood", label:"作業中の雰囲気", q:"作業中の雰囲気は？",
    options:["おしゃべり歓迎","ほどよく会話","黙々と集中"] },
  { k:"learning_pref", label:"教わり方の希望", q:"教わり方の希望は？",
    options:["やって見せてほしい","口頭での説明がいい","やりながら覚えたい"] },
  { k:"work_pattern", label:"希望する働き方", q:"希望する働き方は？",
    options:["単発で働きたい","気に入った農園に続けて通いたい","季節ごとに働きたい"] },
];

// 働き手プレビューのQ&A（コメント形式）に流す項目の唯一のソース（2026-08-07たきと指示）。
// 選択式の「はたらき方の希望」4問を質問要素として先頭に合流させ、その後にpr_qa（自由記述Q&A）
export const workerQaItems = (profile) => [
  ...WORKER_STYLE_QUESTIONS
    .filter(q => ((profile?.[q.k] || "") + "").trim())
    .map(q => ({ q: q.q, a: (q.emoji ? q.emoji + " " : "") + profile[q.k] })),
  ...(Array.isArray(profile?.pr_qa) ? profile.pr_qa : []),
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

// 「✓ 連絡先確認済み（YYYY年M月）」用
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

// ── 関わり方の質問セット（2026-08-14たきと指示「もっと充実させて。他の質問を足すのも良し」）──
// 編集ボックス（EmployerProfileEdit）と表示チップ（FarmerTrustCard）の唯一のソース。
// すべて選択式＝事実の申告（自由記述のNG検査・公開フローに乗らない）。点数・評価は作らない。
// 列は employer_profiles にそれぞれ text で保存（値=value・表示=label）。
// ★質問・選択肢を足す時はここに1行足すだけ（DB列の追加と、employer_profiles_public／
//   job_employer_profile への列追加も忘れずに＝2026-08-14 migration host_style_questions 参照）
export const HOST_STYLE_QUESTIONS = [
  { k:"interaction_style", label:"作業中の関わり方", options: INTERACTION_STYLE_OPTIONS },
  { k:"teaching_style", label:"教え方", options:[
    { value:"show_first", label:"やって見せてから任せる" },
    { value:"verbal", label:"口頭でていねいに説明" },
    { value:"learn_by_doing", label:"一緒にやりながら覚えてもらう" },
  ]},
  { k:"chat_style", label:"作業中の雰囲気", options:[
    { value:"chatty", label:"おしゃべり歓迎" },
    { value:"moderate", label:"ほどよく会話" },
    { value:"quiet", label:"黙々と集中" },
  ]},
  { k:"question_style", label:"質問・相談のしかた", options:[
    { value:"anytime", label:"いつでもその場で聞いてOK" },
    { value:"at_breaks", label:"休憩のときにまとめて" },
    { value:"try_first", label:"まず試してみてから相談" },
  ]},
];
// 回答済みの質問だけラベルの配列で返す（表示チップ用）。未回答は出さない（ダミー禁止）
export const hostStyleChips = (e) => HOST_STYLE_QUESTIONS
  .map(q => (q.options.find(o => o.value === e?.[q.k]) || {}).label || null)
  .filter(Boolean);

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
// expired=失効も一覧に残す（2026-07-27たきと指示）：判断のないまま開始日を迎えた応募も、何があったかを
// 双方が後から確認できる状態に保つ（チャット履歴の保全と同じ思想）。チップは黒の「失効」で表示される
// canceled=働き手の取り消しも一覧に残す（2026-08-16）：応募時の自動メッセージ〜取り消しの報告までを
// 双方が後から確認できる状態に保つ（削除でなく記録＝行動記録の憲法・チャット履歴の保全）
export const CHAT_LIST_STATUSES = ["applied", ...CHAT_ELIGIBLE_STATUSES, "completed", "rejected", "expired", "canceled"];
// リアルタイム帯（2026-07-25たきと指示・同日改定）：応募中→面接中→採用→作業中→完了 の5段＋終端（見送り/失効）。
// すべて農家のアクションがトリガー（承認→面接中／採用タップ→採用／開始→作業中／完了記録→完了）。
// 「打合せ」段階はトリガーを定義できないため削除（2026-07-25たきと判断）。
// statusだけでは面接中/採用を区別できない（採用はterms確認時刻で管理・contracted/meeting/interviewは書き込まれない）ため、
// 応募行(a)から段階キーを導出する：承認〜採用前＝面接中／採用（双方確認）後〜開始前＝採用
// ★DB側の鏡＝public.app_phase(applications)（migration 20260807 app_phase_derived_label）。
//   同じ式のSQL版で、DB側の状態条件（二重予約壁・評価の壁等）はそちらを参照する。片方を変えたら必ず両方変えること
export const appPhaseKey = (a) => {
  const st = a?.status;
  if (["applied","rejected","expired","completed","working","canceled"].includes(st)) return st;
  const hired = !!(a?.terms_confirmed_worker_at && a?.terms_confirmed_farmer_at);
  return hired ? "contracted" : "interview";
};
export const APP_PHASE_LABEL = { applied:"応募中", interview:"面接中", contracted:"採用", working:"作業中", completed:"完了", rejected:"見送り", expired:"失効", canceled:"取り消し" };
// expiredは黒＝失効カードの黒オーバーレイと同色（2026-07-25。失効は応募の段階でなく求人の締め切りとして表示する）
// 段階の説明（2026-07-25たきと指示「ステータスタップで説明を展開」）：帯・チップ・凡例の説明の唯一のソース。
// タップ→PhaseInfoSheet（components/ui）で表示。文面は両役割から読める中立の言い回しにする
export const APP_PHASE_DESC = {
  applied:    "応募が届いた状態。農家がプロフィールを見て、承認するか見送るかを決めます",
  interview:  "承認された応募。チャットで面接し、農家が採用するかを決めます",
  contracted: "採用が決まった応募。作業日などの連絡はチャットで行います",
  working:    "作業当日・進行中です",
  completed:  "作業が終わった応募。お互いを評価できます",
  rejected:   "見送りになった応募です",
  expired:    "承認・見送りの判断がないまま作業開始日を迎え、自動で取り消しになった応募です",
  canceled:   "働き手が取り消した応募です",
};
export const APP_PHASE_COLOR = { applied:"#C77700", interview:"#8E24AA", contracted:"#00897B", working:"#E24B4A", completed:"#607D8B", rejected:"#9E9E9E", expired:"#111111", canceled:"#757575" };
// 応募者ページのステータス絞り込みのキー（2026-08-07・帯5段＋終端と同順）。
// 使う側＝FarmerDashboard（絞り込みの実体）と NewApplicantsPage（同じ並びのピル＝タップで応募者ページへ送る）。
// 並び・ラベルの唯一のソース＝この配列＋APP_PHASE_LABEL（片方だけ変えない）
export const APP_FILTER_KEYS = ["all","applied","interview","contracted","working","completed","rejected","expired"];
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
// 規約v2.1 = 2026-08 一部改定（前文新設・第5条/第6条4参照方式化・第12条労災/上限型ほか・トラックA）
// プラポリv3.1 = 2026-08 改定（v3=保存期間の確定に加え、利用目的列・第8条請求手続・第2条D業務委託先・委託先現行化）。表示ヘッダーの改定日と一致させること
// プラポリv3.2 = 2026-08-07 改定（集合場所番地の保存期間を実態＝掲載終了後も契約の証跡として保存、に整合。設計台帳v1の④）
// 2026-08-14 承認プロセスの削除：規約第5条（掲載＝即公開・事後確認）／プラポリ自由記述行（保存＝即公開・NG自動検査）を改訂し版上げ
// 2026-08-14(続) プラポリ第3条データ台帳に4行追加（緊急連絡先・お知らせとプッシュ登録・変更の記録・ご意見とアンケート）
// ＝第1条「表に無い取得は行いません」と実態の突き合わせ。v3.5への同意は0件のまま改訂ので実質の版差は1段
// 2026-08-14(続2) v3.7：外部送信の明記（第5条＝地図タイル・郵便番号検索。フォントは同梱化ので外部接続なし）＋
// 台帳2行追記（募集主の情報＝求人票でログイン利用者に表示／求人Q&A）。v3.6への同意も0件のままの続き改訂
// 規約v2.4 = 2026-08 改定（第14条を民法548条の4準拠の3項に全面差し替え＝変更要件・効力発生日の周知・
// 適用時期を明記／第7条3に「確認した内容は、記録として保存します。」を追記）。
// ※指示は「v2.2」だったが、2026-08-14に別セッションがv2.3へ版上げ済みだったため逆行を避けv2.4とした
export const TERMS_VERSION = "v2.4-2026-08";
export const PRIVACY_VERSION = "v3.8-2026-08";

// 分割3-B（2026-07-25）：App.jsxから移動（LandingFlow・WorkerProfileEditで共用）
// 作業リスト（アイコン無し・文字だけカード。増やすときはここに1行足すだけ）
// 2026-08-06たきと指示：播種を追加／「袋かけ」を「包装」に変更。
// 2026-08-08たきと指示：準備・片付けを追加（並びは作業の流れ＝準備→播種→…→包装→片付け。収穫は最需要ので先頭）。
// ★これは【これから選べる語彙】の変更で、過去の求人の記録（jobs.task）は書き換えない。
//   既に「袋かけ」で掲載された求人はその文字のまま残る（記録は改変しない・行動記録の憲法）。
//   自由入力も併存するため、選択肢に無い値の求人・働き手プロフィールも従来どおり表示される
//   （WorkerProfileEdit/WorkerExperiencePage は保存済みの値を選択肢に足して描く作りが既にある）。
export const TASK_OPTIONS = [
  { name:"収穫",     icon:"" },
  { name:"準備",     icon:"" },
  { name:"播種",     icon:"" },
  { name:"定植",     icon:"" },
  { name:"選果",     icon:"" },
  { name:"農薬散布", icon:"" },
  { name:"草刈り",   icon:"" },
  { name:"包装",     icon:"" },
  { name:"片付け",   icon:"" },
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

// 自由記述の書き分け（2026-08-03たきと指示「入力項目を空にするなら審査は必要ない」）。
// ★2026-08-14の承認プロセス削除以降、pending は「審査待ち」ではない：texts_pending に積んでも
//   DBトリガー（trg_ep_z_publish_texts）が保存の瞬間に公開列へ畳む＝どちらの経路でも即公開になる。
//   つまり pending と cleared は今や結果が同じ（どちらも保存＝即公開）。分岐と Review という名前は
//   審査時代の名残で、残っていても害は無いので触っていない。書き分けをやめて公開列へ直接書く形に
//   まとめることはできる（NG検査は公開列の差分で走るので効き続ける）＝やるなら3ファイル同時に。
// 返り値 pending=文字が入る変更（pending列に積む→トリガーが畳む）／cleared=その場で空にするキー
export function splitTextsForReview(desired, approved) {
  const pending = {}, cleared = {};
  Object.keys(desired || {}).forEach(k => {
    const next = String(desired[k] ?? "");
    const cur = String((approved && approved[k]) ?? "");
    if (next === cur) return;              // 変わっていない＝何もしない
    if (next.trim() === "") cleared[k] = ""; // 空にした＝審査不要・即反映
    else pending[k] = next;                  // 文字が入る変更＝審査へ
  });
  return { pending, cleared };
}

// ── プロフィールの未設定項目数（2026-08-03・唯一のソース）──────────────────────
// 「まだ入力されていない項目」の数え方を1箇所に集約する。読み手は3つ：
//   ①プロフィール入口の名刺バッジ・赤影（ProfileHub／FarmerDashboard）
//   ②今日ページの「プロフィールの未入力」ボックス（未入力がある間だけ現れ、埋まると消える）
// 数え方が枝分かれすると「今日ページには出るのに名刺は0件」のような食い違いが起きるため、
// 項目を足す時は必ずここだけを直すこと（編集ページのボックス構成と対応させる）。
// 返り値 { req: 核（アイコン・名前・場所/自己紹介）の未設定数, total: 全体の未設定数 }。
// 行そのものが無い（プロフィール未作成）＝全項目が未設定として数える。
export function workerUnsetCount(w) {
  if (!w) return { req: 3, total: 10 };     // 編集ページの10ボックス基準
  const req = [
    !!w.avatar_url,
    !!(w.nickname || "").trim(),
    !!((w.pr_pending ?? w.pr) || "").trim(),
  ].filter(x => !x).length;
  const opt = [
    !!(w.residence_city || "").trim(),
    !!w.transport,
    !!w.farm_experience,
    // はたらき方の希望＝4問（WORKER_STYLE_QUESTIONS）のどれかに回答があれば設定済み（2026-08-14拡充）
    !!(w.physical_level || w.work_mood || w.learning_pref || w.work_pattern),
    Array.isArray(w.interests) && w.interests.length > 0,
    Array.isArray(w.languages) && w.languages.length > 0,
    (Array.isArray(w.pr_qa_pending) ? w.pr_qa_pending.length : (Array.isArray(w.pr_qa) ? w.pr_qa.length : 0)) > 0,
  ].filter(x => !x).length;
  return { req, total: req + opt };
}
// opts.hasEmergency＝emergency_contacts（別テーブル・self-only RLS）の登録有無。呼び出し側が引いて渡す
// （2026-08-07たきと承認：募集者の連絡先＋緊急連絡先＝掲載時必須なのにバッジに数えられていなかった2つを合流）
export function employerUnsetCount(e, { hasEmergency = false } = {}) {
  if (!e) return { req: 3, total: 9 };      // 編集ページの9ボックス基準（従業員数は2026-08-01に削除）
  // ★編集ページ（EmployerProfileEdit の boxFilled）と同じ物差しで数える（2026-08-03）：
  //   氏名・名称＝recruiter_name（保存時に nickname へも写るので両方見る）
  //   住所・所在地＝recruiter_* の分割値、無ければ1行の recruiter_address
  //   待遇＝6つの待遇のどれか、または受動喫煙の設定
  //   （旧実装は place_city を見ていたが、その列を編集する入力欄はもう無く、
  //     空のままの人は永久に「未入力1」が残り続けていた＝今日ページの未入力ボックスも消えなかった）
  const placeFilled = !!((e.recruiter_prefecture || "") + (e.recruiter_city || "") + (e.recruiter_address_detail || "")).trim()
    || !!(e.recruiter_address || "").trim();
  const req = [
    !!e.avatar_url,
    !!((e.recruiter_name || e.nickname || "").trim()),
    placeFilled,
  ].filter(x => !x).length;
  const opt = [
    !!(e.has_transport || e.has_parking || e.has_commute_allowance || e.has_bonus || e.employer_pays_supplies || e.accessory_ok || e.smoking_policy),
    [e.intro_path, e.intro_joy, e.intro_crops, e.intro_atmosphere, e.intro_message, e.owner_comment].some(t => t && String(t).trim()),
    [e.unique_point, e.always_do, e.break_style].some(t => t && String(t).trim()),
    // 関わり方＝4問（HOST_STYLE_QUESTIONS）のどれかに回答があれば設定済み（2026-08-14拡充）
    !!(e.interaction_style || e.teaching_style || e.chat_style || e.question_style),
    !!(e.recruiter_contact || "").trim(), // 募集者の連絡先（掲載時必須・2026-08-07）
    hasEmergency,                          // 🆘緊急連絡先（2026-08-07）
  ].filter(x => !x).length;
  return { req, total: req + opt };
}
// 上の判定に必要な列だけ（今日ページはプロフィール全列を読まない＝転送量を増やさない）。
// ★項目を足したら、上の関数と一緒にこの列リストも直すこと
export const WORKER_UNSET_COLUMNS = "avatar_url,nickname,pr,pr_pending,residence_city,transport,farm_experience,physical_level,work_mood,learning_pref,work_pattern,interests,languages,pr_qa,pr_qa_pending";
export const EMPLOYER_UNSET_COLUMNS = "avatar_url,nickname,recruiter_name,recruiter_contact,recruiter_address,recruiter_prefecture,recruiter_city,recruiter_address_detail,smoking_policy,has_transport,has_parking,has_commute_allowance,has_bonus,employer_pays_supplies,accessory_ok,intro_path,intro_joy,intro_crops,intro_atmosphere,intro_message,owner_comment,unique_point,always_do,break_style,interaction_style,teaching_style,chat_style,question_style";
