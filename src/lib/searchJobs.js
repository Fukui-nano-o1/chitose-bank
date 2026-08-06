// さがす一覧の取得・並び生成の共有ロジック（2026-08-02・玄関の先読み導入で共有化）。
// 消費者は2箇所：①JobSearchMapView（さがす一覧本体）②VisitEntrance（訪問者の玄関の先読み）。
// 並びの規則（2026-07-24たきと指示）はここが唯一のソース：
// 新着（掲載3日以内・この端末で初見）を上位に、他はランダム。既読はcb_seenNewJobsに記録。
import { supabase } from "./supabase";
import { mapJobPublicRow } from "./utils";
import { getCache, setCache } from "./viewCache";

export const shuffleArr = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 新着の既読記録（この端末で一度上位に出したらもう上位にしない）
export const readSeenNewIds = () => { try { const v = JSON.parse(localStorage.getItem("cb_seenNewJobs") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export const recordSeenNewIds = (ids) => { try { localStorage.setItem("cb_seenNewJobs", JSON.stringify([...readSeenNewIds(), ...ids].slice(-300))); } catch {} };

// 公開求人の全件取得（jobs_publicはanon許可＝未ログインの訪問者でも読める）。失敗はnull
export async function fetchPublicJobs() {
  try {
    const { data, error } = await supabase.from("jobs_public").select("*").order("job_number", { ascending: false });
    if (error || !data) return null;
    return data.map(mapJobPublicRow);
  } catch { return null; }
}

// 終了した求人（掲載終了・満員・期間終了）は一覧の末尾へ回す＝募集中が先（2026-08-05）。
// 「過去の求人は消さない」方針で、さがすには残すが、募集中の邪魔はしない
export const isEndedJob = (j) => !!(j.closed || j.filled || j.expired);

// 並びの規則の唯一のソース：新着（この端末で初見）→ 募集中 → 終了。
// prev（前回表示中の並び）があれば、その並びを保ったまま中身だけ最新に差し替える（2026-08-02）
export function orderSearchJobs(mapped, prev) {
  const seenSet = new Set(readSeenNewIds());
  const active = mapped.filter(j => !isEndedJob(j));
  const ended = mapped.filter(isEndedJob);
  const freshNew = active.filter(j => j.isNew && !seenSet.has(j.id));
  const rest = active.filter(j => !(j.isNew && !seenSet.has(j.id)));
  let list;
  if (prev && prev.length) {
    const freshById = new Map(mapped.map(j => [j.id, j]));
    const kept = prev.filter(j => freshById.has(j.id)).map(j => freshById.get(j.id));
    const keptIds = new Set(kept.map(j => j.id));
    const added = mapped.filter(j => !keptIds.has(j.id));
    // 既存の並びは保ち、追加ぶんだけ差し込む。募集中は先頭・終了は末尾（区切りは崩さない）
    list = [
      ...shuffleArr(added.filter(j => !isEndedJob(j))),
      ...kept.filter(j => !isEndedJob(j)),
      ...kept.filter(isEndedJob),
      ...shuffleArr(added.filter(isEndedJob)),
    ];
  } else {
    list = [...shuffleArr(freshNew), ...shuffleArr(rest), ...shuffleArr(ended)];
  }
  return { list, freshNew };
}

// 玄関（/#/visit）の先読み：訪問者が同意文を読んでいる数秒の間に、さがす一覧を取得して
// キャッシュに置いておく＝「同意して見てみる」タップ後のさがすが即描画になる（初訪問の体感対策）。
// キャッシュが既にあれば何もしない。並び・既読記録はさがす本体と同じ規則
export async function prefetchSearchJobs() {
  if (getCache("search:jobs") !== undefined) return;
  const mapped = await fetchPublicJobs();
  if (!mapped) return;
  const { list, freshNew } = orderSearchJobs(mapped, null);
  setCache("search:jobs", list);
  if (freshNew.length) recordSeenNewIds(freshNew.map(j => j.id));
}
