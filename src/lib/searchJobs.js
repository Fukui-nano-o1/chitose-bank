// さがす一覧の取得・並び生成の共有ロジック（2026-08-02・玄関の先読み導入で共有化）。
// 消費者は2箇所：①JobSearchMapView（さがす一覧本体）②VisitEntrance（QRの着地点＝#/visit の先読み）。
// 並びの規則（2026-07-24たきと指示）はここが唯一のソース：
// 新着（掲載3日以内・この端末で初見）を上位に、他はランダム。既読はcb_seenNewJobsに記録。
import { supabase } from "./supabase";
import { mapJobPublicRow } from "./utils";
import { visibleSearchJobs } from "./jobSearchVisibility";
import { getCache, setCache } from "./viewCache";
import { getConfirmedRefreshVersion, REFRESH_JOBS } from "./refreshBus";

export const shuffleArr = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 新着の既読記録（この端末で一度上位に出したらもう上位にしない）
export const readSeenNewIds = () => { try { const v = JSON.parse(localStorage.getItem("cb_seenNewJobs") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export const recordSeenNewIds = (ids) => { try { localStorage.setItem("cb_seenNewJobs", JSON.stringify([...readSeenNewIds(), ...ids].slice(-300))); } catch {} };

// 公開求人の全件取得（jobs_publicはanon許可＝未ログインの訪問者でも読める）。失敗はnull
async function loadPublicJobs() {
  try {
    const { data, error } = await supabase.from("jobs_public").select("*").order("job_number", { ascending: false });
    if (error || !data) return null;
    return data.map(mapJobPublicRow);
  } catch { return null; }
}

// 先読みと遷移が重なっても同じ取得中の応答を使う。完了結果はここには保持しない。
// 更新通知は fresh で別の取得を開始する＝保存前に始まった応答を使い回さない。
// 保存後に別画面がマウントされた場合も、更新番号が違う取得は共有しない。
// ユーザーが切り替わった時も混ぜない。画面キャッシュは従来どおりviewCacheが担う。
const pendingJobs = new Map();
export function fetchPublicJobs({ scope = "anon", fresh = false } = {}) {
  const version = getConfirmedRefreshVersion(REFRESH_JOBS);
  const pending = pendingJobs.get(scope);
  if (!fresh && pending?.version === version) return pending.request;
  const request = loadPublicJobs();
  const entry = { version, request };
  pendingJobs.set(scope, entry);
  request.finally(() => {
    if (pendingJobs.get(scope) === entry) pendingJobs.delete(scope);
  });
  return request;
}

// 期間内の満員求人は末尾へ。期限切れ・掲載終了は検索から除外する（2026-09-22）。
// 過去の求人は応募履歴・実績・共有リンクから引き続き参照できる。
export const isEndedJob = (j) => !!(j.closed || j.filled || j.expired);

// 並びの規則の唯一のソース：新着（この端末で初見）→ 募集中 → 期間内の満員。
// prev（前回表示中の並び）があれば、その並びを保ったまま中身だけ最新に差し替える（2026-08-02）
export function orderSearchJobs(mapped, prev) {
  mapped = visibleSearchJobs(mapped);
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

// 玄関（/#/visit）の先読み：QRの着地点でさがす一覧の取得を始め、
// キャッシュに置いておく＝送り先のさがすが即描画になる（初訪問の体感対策）。
// キャッシュが既にあれば何もしない。並び・既読記録はさがす本体と同じ規則
export async function prefetchSearchJobs() {
  if (getCache("search:jobs") !== undefined) return;
  const version = getConfirmedRefreshVersion(REFRESH_JOBS);
  const mapped = await fetchPublicJobs();
  // 先読み中に検索本体が新しい一覧を置いた場合、その結果を古い先読みで戻さない。
  if (!mapped || version !== getConfirmedRefreshVersion(REFRESH_JOBS) || getCache("search:jobs") !== undefined) return;
  const { list, freshNew } = orderSearchJobs(mapped, null);
  setCache("search:jobs", list);
  if (freshNew.length) recordSeenNewIds(freshNew.map(j => j.id));
}

// ── 👀 求人の閲覧数（2026-08-21たきと指示「❤️ボタンの左横に👀〇〇(数値)。求人をタップした総数」）──
// 貯めるのは数だけ（job_view_counts＝job_number と通し数のみ・誰that見たかは持たない）。
// 増やす窓口はDBの count_job_view 1本so、ここは「まとめて読む」と「1つ数える」の2つだけ。
export async function fetchJobViewCounts(jobNumbers) {
  const nums = (jobNumbers || []).filter(n => Number.isFinite(n));
  if (nums.length === 0) return {};
  const { data, error } = await supabase.from("job_view_counts").select("job_number,view_count").in("job_number", nums);
  // 失敗は null を返す＝呼び出し元that手元の値を残せる（エラーの{data:null}を「ゼロ件」と読まない・2026-08-07規則）
  if (error || !data) return null;
  const map = {};
  for (const r of data) map[r.job_number] = Number(r.view_count) || 0;
  return map;
}

// 同じ端末で同じ求人を開き直しても10分は数えない（連打の書き込みを減らす前段）。
// ★かさ増しを止める本体はDB側（2026-09-08 migration job_view_no_padding）：
//   未ログインは数えない／持ち主・運営は数えない／同じアカウント×同じ求人は30日に1回だけ（ハッシュ化した印で判定）。
//   ここの10分ルールは端末の中だけの話であり、API直叩きへの壁ではない＝壁はDBが担う。
const VIEW_DEDUPE_MS = 10 * 60 * 1000;
export function countJobView(jobNumber, loggedIn) {
  if (!Number.isFinite(jobNumber)) return false;
  // 未ログインはDBが数えない（EXECUTEも無い）ため撃たない＝無駄な往復と 401 のログを作らない
  if (!loggedIn) return false;
  const key = "cb_jobViewed_" + jobNumber;
  try {
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < VIEW_DEDUPE_MS) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {}
  // 記録だけ＝失敗しても画面は何も変えない（閲覧の妨げにしない）。
  // 数えるかどうかの規則（持ち主・運営・下書き・30日以内の再閲覧は数えない）はDB側 count_job_view が唯一のソース
  supabase.rpc("count_job_view", { p_job_number: jobNumber }).then(() => {}, () => {});
  return true;
}
