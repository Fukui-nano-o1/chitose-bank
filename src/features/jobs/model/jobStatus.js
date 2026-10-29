// 求人の終了・下書き・一時非公開の表示判定。通信・認可・保存は担当しない。
// ── 求人の状態の定義（唯一のソース・2026-07-27たきと指示「終了は終了、下書きは下書き」）──
// 曖昧なまま各所でstatus文字列だけを見ていると、終了した求人が下書き扱いで出る等の食い違いが起きる。
// 判定はここに集約し、各画面はこの関数を使う。jobs 行と mapJobPublicRow の表示用データの両方を受け取る。
//
// 終了（ended）＝作業日程が過ぎた。statusに関係なく最優先（下書きでも審査中でも、日程が過ぎたら終了）
const JOB_JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const JOB_DAY_MS = 24 * 60 * 60 * 1000;

// 日付列はそのまま使い、古いキャッシュの Date / ISO文字列だけ日本の日付へ戻す。
// 不正な日付を Date の自動繰り上がり（2/30 → 3/2）で別の日にしない。
const jobDateYmd = (value) => {
  let ymd = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const ms = value instanceof Date ? value.getTime()
      : /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(ymd) ? Date.parse(ymd) : NaN;
    if (!Number.isFinite(ms)) return null;
    const japanDate = new Date(ms + JOB_JST_OFFSET_MS);
    if (!Number.isFinite(japanDate.getTime())) return null;
    ymd = japanDate.toISOString().slice(0, 10);
  }
  const [year, month, day] = ymd.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  return new Date(ms).toISOString().slice(0, 10) === ymd ? ymd : null;
};

// 終了する瞬間（ミリ秒）。日本の求人日程なので端末のタイムゾーンに依存しない。
// 終了時刻が未入力・不正なら最終日の翌日0時。日程自体が不明なら null（終了と推測しない）。
// 同じ値を使って画面側も時刻到来時に再判定できる＝通信やDBの定期処理を待たない。
export const jobEndTimeMs = (j) => {
  if (!j) return null;
  const end = jobDateYmd(j.date_end || j.dateEndRaw || j.dateEnd || j.date_start || j.dateStartRaw || j.dateStart);
  if (!end) return null;
  const midnight = Date.parse(`${end}T00:00:00+09:00`);
  const time = String(j.work_time || j.workTime || "").match(/^\s*(\d{1,2}):(\d{2})\s*[〜～~–-]\s*(\d{1,2}):(\d{2})\s*$/);
  if (time && Number(time[1]) < 24 && Number(time[2]) < 60 && Number(time[3]) < 24 && Number(time[4]) < 60) {
    return midnight + (Number(time[3]) * 60 + Number(time[4])) * 60 * 1000;
  }
  return midnight + JOB_DAY_MS;
};

export const isJobEnded = (j, now = new Date()) => {
  const end = jobEndTimeMs(j);
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  return end !== null && Number.isFinite(nowMs) && nowMs >= end;
};
// 一時非公開＝掲載歴（opened_at）があるのに今はdraft。下書きではない（公開中タブに帯付きで残す側）
export const isJobUnpublished = (j) => !!(j && j.status === "draft" && j.opened_at);
// 下書き（作成中）＝まだ一度も掲載しておらず、日程も過ぎていないdraft。これ以外をdraftと呼ばない
export const isJobDraft = (j) => !!(j && j.status === "draft" && !j.opened_at && !isJobEnded(j));
