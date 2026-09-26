// 求人作成フローの型（副作用のない変換・判定だけ）。
// 第2次構造改革2026-08-17で LandingFlow.jsx から分離・中身は不変。
// ★この層に React / DOM / Supabase / fetch を入れない（純粋なまま保つ）。

// 写真配列の正規化（2026-07-16）：旧形式（"url"文字列）が混ざると確認ページ等の p.url が
// undefined になり真っ白なスライドが出るため、復元・再開の境界で必ず {url, caption} に揃える。
// url の無い壊れた要素は除外する
export function normalizePhotos(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(p => (typeof p === "string" ? { url: p } : p))
    .filter(p => p && typeof p.url === "string" && p.url.trim());
}

// 過去に掲載した求人の写真を「求人ごとの束」に組む（step7「過去の写真から選ぶ」・2026-09-26）。
// 入力＝自分の求人の行（job_number/crop/task/photos/date_start/created_at）。新しい順のまま束にする。
// ・いま編集中の求人（excludeJobNumber）は外す＝その写真は既に手元にある
// ・同じ url は最初の束にだけ出す（コピーで作った求人は同じ写真を持つため、重複して並べない）
// ・いま選んでいる写真（currentPhotos）と同じ url は inUse=true＝一覧には出すが選べない（「追加済み」）
// ・写真の無い求人は束にしない（空の束を並べない）
export function pastPhotoGroups(rows, { excludeJobNumber = null, currentPhotos = [] } = {}) {
  const have = new Set(normalizePhotos(currentPhotos).map(p => p.url));
  const seen = new Set();
  const groups = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    if (excludeJobNumber != null && r.job_number === excludeJobNumber) continue;
    const photos = [];
    for (const p of normalizePhotos(r.photos)) {
      if (seen.has(p.url)) continue;
      seen.add(p.url);
      photos.push({ url: p.url, thumb: p.thumb || null, caption: p.caption || "", inUse: have.has(p.url) });
    }
    if (photos.length === 0) continue;
    const title = [r.crop, r.task].map(s => (s || "").trim()).filter(Boolean).join(" ") || "無題の求人";
    const date = (r.date_start || (r.created_at || "").slice(0, 10) || "");
    groups.push({ jobNumber: r.job_number ?? null, title, date, photos });
  }
  return groups;
}

// 選んだ過去の写真を手元の写真に足す。同じ url は足さない・上限（10枚）を越えたぶんは捨てる。
// 足す形は uploadPhoto の結果と同じ {url, thumb?, caption}＝以後の保存・表示は新規アップロードと区別しない。
// 元の求人で付けていた説明（caption）は引き継ぐ（step8で書き換えられる）
export function mergePastPhotos(current, picked, cap = 10) {
  const base = normalizePhotos(current);
  const have = new Set(base.map(p => p.url));
  const added = [];
  for (const p of Array.isArray(picked) ? picked : []) {
    if (!p || typeof p.url !== "string" || !p.url.trim()) continue;
    if (have.has(p.url)) continue;
    if (base.length + added.length >= cap) break;
    have.add(p.url);
    added.push({ url: p.url, ...(p.thumb ? { thumb: p.thumb } : {}), caption: p.caption || "" });
  }
  return added.length ? [...base, ...added] : current;
}

// 危険項目の2つ目に中身（タイトル・説明・写真）があるか（2026-07-16）。
// 復元時にshowPlace2/showTask2を立てないと、2つ目がstep9で見えないまま確認ページに残り続ける
export function dangerHasSecond(arr) {
  const x = Array.isArray(arr) ? arr[1] : null;
  return !!(x && (((x.label || "").trim()) || ((x.desc || "").trim()) || ((x.photos || []).length > 0)));
}

// サービス提供範囲。展開時はこの配列に都道府県を追加するだけでよい
export const ALLOWED_PREFECTURES = ["徳島県"];
export const isAllowedPrefecture = (pref) => ALLOWED_PREFECTURES.includes((pref || "").trim());

// 時給・日給が最低賃金を下回っていないかを判定する純関数
// workHours: 勤務時間（終了時刻 - 開始時刻、時間単位）。breakMinutes: 申告休憩（分）。
// 実働 = 拘束 − greatest(申告休憩, 法定最低休憩)。法定最低休憩＝拘束6時間超45分・8時間超60分（労基法34条）。
// ★DBの掲載トリガー（trg_job_publish_snapshot・migration 20260806163552）と同じ式。片方だけ変えないこと
export function validateMinWage(hourly, daily, workHours, minWage, breakMinutes = 0) {
  // 最低賃金が取得できていない場合は検証不能。安全側に倒して掲載を止める
  if (!minWage || minWage <= 0) {
    return { hourlyViolation: hourly > 0, dailyViolation: daily > 0, unknownWage: true };
  }
  const hourlyViolation = hourly > 0 && hourly < minWage;
  let dailyViolation = false;
  if (daily > 0 && workHours > 0) {
    const legalBreakHours = workHours > 8 ? 1 : workHours > 6 ? 0.75 : 0;
    const breakHours = Math.max(breakMinutes / 60, legalBreakHours);
    const actualHours = workHours - breakHours;
    if (actualHours <= 0 || daily / actualHours < minWage) dailyViolation = true;
  }
  return { hourlyViolation, dailyViolation, unknownWage: false };
}

