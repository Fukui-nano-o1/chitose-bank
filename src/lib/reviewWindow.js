import { lastAppWorkDay, workEndMinutes } from './utils.js';

export const REVIEW_WINDOW_MS = 72 * 60 * 60 * 1000;
export const REVIEW_PUBLICATION_NOTE = '評価は最終作業の終了から72時間だけ入力できます。お互いの提出状況にかかわらず、公開は72時間後です。片方だけの評価も保存されます。悪い点は相手に表示されません。';

// 一覧表示用。送信の可否はサーバーのreview_windowとDBトリガーで判定する。
export function reviewPeriod(app, job, now = Date.now()) {
  const last = lastAppWorkDay(app, job);
  const end = workEndMinutes(job?.work_time ?? app?.work_time) ?? 1439;
  const opensAt = app?.review_opened_at ? Date.parse(app.review_opened_at)
    : last ? Date.parse(`${last}T${String(Math.floor(end / 60)).padStart(2,'0')}:${String(end % 60).padStart(2,'0')}:00+09:00`)
      : Date.parse(app?.work_completed_at);
  if (!Number.isFinite(opensAt)) return { state:'unavailable' };
  const closesAt = opensAt + REVIEW_WINDOW_MS;
  return { opensAt, closesAt, state: now < opensAt ? 'not_started' : now >= closesAt ? 'closed' : 'open' };
}

export function reviewDeadlineLabel(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
}
