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

// 玄関（/#/visit）の先読み：訪問者が同意文を読んでいる数秒の間に、さがす一覧を取得して
// キャッシュに置いておく＝「同意して見てみる」タップ後のさがすが即描画になる（初訪問の体感対策）。
// キャッシュが既にあれば何もしない。並び・既読記録はさがす本体と同じ規則
export async function prefetchSearchJobs() {
  if (getCache("search:jobs") !== undefined) return;
  const mapped = await fetchPublicJobs();
  if (!mapped) return;
  const seenSet = new Set(readSeenNewIds());
  const freshNew = mapped.filter(j => j.isNew && !seenSet.has(j.id));
  const rest = mapped.filter(j => !(j.isNew && !seenSet.has(j.id)));
  setCache("search:jobs", [...shuffleArr(freshNew), ...shuffleArr(rest)]);
  if (freshNew.length) recordSeenNewIds(freshNew.map(j => j.id));
}
