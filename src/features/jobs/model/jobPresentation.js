// DBから取得済みの求人行を表示用に変換する。取得・公開範囲の決定は担当しない。
import { isJobEnded } from "./jobStatus.js";

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
    // 町域を外した住所（都道府県＋市区町村）。訪問者の地図はこれを中心にする（2026-08-17たきと指示）＝
    // 町域の重心を中心にすると、円の中心そのものが町域を指してしまうため
    cityArea: [j.prefecture, j.city].filter(Boolean).join("") || "",
    // 集合場所の番地・建物名（2026-08-03たきと指示：会員には番地まで表示）。
    // jobs_public.work_address は anon に NULL マスク済み（2026-07-31・訪問者開示レベル第1弾）＝
    // 未ログインには常に空で届く。開示の境界はDB側が正・フロントは届いた値を表示するだけ
    // j.address フォールバック＝オーナープレビュー等 jobs テーブルを直読みする経路（列名がaddress）用。
    // jobs_public 経由では address 列が存在しないので訪問者の値が漏れることはない
    workAddress: j.work_address || j.address || "",
    // 番地の「有無」だけは訪問者にも届く（jobs_public.has_work_address・2026-08-03）＝
    // 番地が設定された求人にだけモザイクを出すための判定。番地本文は届かない
    hasWorkAddress: j.has_work_address != null ? !!j.has_work_address : !!((j.work_address || j.address || "").trim()),
    // 訪問者に伏せた項目のうち「値が入っているもの」の名前（jobs_public.masked_fields・2026-08-17）。
    // 値は届かないが、モザイクを描いてよいかの判定に使う＝伏せた項目を画面から消さない。
    // ログイン後・管理者プレビューは空配列＝マスクなし。番地だけは従来どおり hasWorkAddress が担当
    maskedFields: Array.isArray(j.masked_fields) ? j.masked_fields : [],
    experience: j.job_exp || "", // 必要経験の選択式は撤回（2026-07-18）。旧求人の保存値のみ表示・未入力はdispで「ー」
    lat:    j.lat != null ? Number(j.lat) : null,
    lng:    j.lng != null ? Number(j.lng) : null,
    radius: j.geo_radius_m != null ? Number(j.geo_radius_m) : null,
    count: j.headcount != null ? j.headcount + "名" : "", headcount: j.headcount, photos: j.photos || [],
    workVideoUrl: j.work_video_url || "",
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
    // 労働条件の明示・4項目（2026-08-21）：掲載時にDBトリガー（job_publish_zscope）が凍結した値。
    // 変更の範囲＝求人入力（未選択は「変更なし」に倒れる）／契約の更新・退職事項＝固定文／
    // 労災・雇用保険＝プロフィールの申告の掲載時凍結（未申告はNULL＝「ー」表示）
    placeChangeScope: j.place_change_scope || "",
    taskChangeScope: j.task_change_scope || "",
    contractRenewal: j.contract_renewal || "",
    retirementTerms: j.retirement_terms || "",
    laborInsuranceStatus: j.labor_insurance_status || "",
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
    // 掲載が終わった求人。履歴・詳細の表示用で、さがすに残すかどうかの判定とは分ける。
    closed: j.status === "closed",
    // 終了帯の判定。期間終了は共通の日本時間の判定を使う（キャッシュの復元・表示時にも再判定する）。
    hiredCount: j.hired_count != null ? Number(j.hired_count) : 0,
    filled: j.headcount != null && j.hired_count != null && Number(j.hired_count) >= Number(j.headcount),
    expired: isJobEnded(j),
  };
}
