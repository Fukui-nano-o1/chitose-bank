// いいねした求人（マイページ・働き手面の区画）
// 経緯：2026-08-22たきと指示でカード＋一覧ボックスとして新設（「わたしの記録」カテゴリーの1枚）→
//   2026-08-25「働き手のわたしの記録をいいねした求人に差し替え。ボックスは削除。いいねした求人を
//   置いていこう」＝カテゴリーごとこの区画に置き換え、カードをページに直接並べる（ボックスは廃止）。
// ・カードは【その他の求人と同じ】JobCard＝関連求人と同じ「写真に情報を重ねる」型。横スクロール用の
//   related は幅280px固定なので、縦一列のこの面には全幅版の variant="wide" を使う
//   （仕事の評価ページ ReviewStagePanel と同じ適用）。♥・👀閲覧数・募集終了の帯も JobCard が唯一のソース。
// ・データ源はステータスページ(#/saved)と同じ my_job_actions（SECURITY DEFINER・本人のいいね＋応募だけ）。
//   liked=true の行だけを使う＝いいねの取得経路を増やさない。キャッシュも "saved:rows" を共用
//   （同じRPCの同じ形）＝どちらから開いても互いに温まる。
// ・♥の実処理は さがす の performSave と同じ作法（楽観更新→失敗時は戻す・saved_jobs は本人スコープRLS）。
//   解除してもカードはその場に残す（♥を空にするだけ＝タップし直せば戻る＝指の下でカードが消えない）。
//   次に読み込んだ時に一覧から下りる。
// ・取得の規則（SavedJobsViewと同じ・2026-08-07フェイルオープン規則）：
//   ①res.errorを見る・失敗時は手元の値もキャッシュも上書きしない
//   ②my_job_actions は auth.uid() が無いと【200で空配列】を返すので、空配列はセッションを確かめてから信じる
// ・★jobs（mapJobPublicRowの結果）は viewCache に入れない：dateStart/dateEnd が Date オブジェクトで、
//   JSONで保存→復元すると文字列になり読む側が落ちる（2026-08-03の実害と同じ型）。開くたび1往復する。
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchJobRowListForMe } from "../lib/jobForMe";
import { getCache, setCache } from "../lib/viewCache";
import { mapJobPublicRow, ROLE_ORANGE } from "../lib/utils";
import { fetchJobViewCounts } from "../lib/searchJobs";
import { JobCard } from "./JobCard";
import { Dots } from "./ui";

const likedOf = (list) => (Array.isArray(list) ? list.filter(r => r.liked) : null);

export function LikedJobs({ me }) {
  // 前回の内容（ステータスページと共用のキャッシュ）が残っていればまず出す→裏で最新に差し替える
  const [rows, setRows] = useState(() => likedOf(getCache("saved:rows"))); // null=読み込み中
  const [jobs, setJobs] = useState({});            // job_number → mapJobPublicRow（★viewCacheに入れない・上記）
  // 👀閲覧数：さがすと同じキャッシュを共用（search:viewCounts＝数のみ・誰が見たかは持たない）
  const [viewCounts, setViewCounts] = useState(() => getCache("search:viewCounts") ?? {});
  // ♥の表示状態（この求人にいまいいねが付いているか）
  const [savedIds, setSavedIds] = useState(() => new Set((likedOf(getCache("saved:rows")) || []).map(r => r.job_number)));

  useEffect(() => {
    if (!me?.id) return;
    let live = true;
    (async () => {
      let res;
      try { res = await supabase.rpc("my_job_actions"); }
      catch (e) { res = { data: null, error: e }; }
      if (!live) return;
      let list = res?.error ? null : res?.data;
      if (Array.isArray(list) && list.length === 0) { // ②空配列の正体を確かめる（トークン未確立の0件を信じない）
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!live) return;
          if (!session) list = null;
        } catch { list = null; }
      }
      if (!Array.isArray(list)) return; // ①失敗時は手元の値（キャッシュ）のまま
      setCache("saved:rows", list); // 全体をステータスページと同じ形で保存（形を変えない）
      const liked = likedOf(list);
      setRows(liked);
      setSavedIds(new Set(liked.map(r => r.job_number)));
    })();
    return () => { live = false; };
  }, [me?.id]);

  // カードの材料（jobs_public・その他の求人と同じ全体像）と閲覧数を読み足す。
  // 取得済みの求人は読み直さない。失敗時は手元の値を上書きしない（最小カードのまま出す）
  const numsKey = (rows || []).map(r => r.job_number).join(",");
  useEffect(() => {
    if (!numsKey) return;
    let live = true;
    const nums = numsKey.split(",").map(Number).filter(n => Number.isFinite(n) && !(n in jobs));
    if (!nums.length) return;
    (async () => {
      try {
        const [jobRes, vc] = await Promise.all([
          fetchJobRowListForMe(nums),
          fetchJobViewCounts(nums),
        ]);
        if (!live) return;
        if (!jobRes.error && jobRes.data) {
          setJobs(prev => {
            const nx = { ...prev };
            jobRes.data.forEach(r => { nx[r.job_number] = mapJobPublicRow(r); });
            return nx;
          });
        }
        if (vc) { // null＝失敗（手元の値を残す・2026-08-07規則）
          setViewCounts(prev => {
            const merged = { ...prev, ...vc };
            setCache("search:viewCounts", merged);
            return merged;
          });
        }
      } catch { /* 取得できなくても最小カードで出す */ }
    })();
    return () => { live = false; };
  }, [numsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- jobsは取得済み判定のみ（依存に入れると再取得ループ）

  // ♥の解除⇄再いいね（さがすの performSave と同じ：楽観更新→失敗時は戻す）。
  // 自分の求人は my_job_actions が最初から返さない（farmer_id <> auth.uid()）ので canLike 判定は不要
  const toggleLike = async (job) => {
    const jn = job.id;
    const isSaved = savedIds.has(jn);
    setSavedIds(prev => { const nx = new Set(prev); isSaved ? nx.delete(jn) : nx.add(jn); return nx; });
    const { error } = isSaved
      ? await supabase.from("saved_jobs").delete().eq("worker_id", me.id).eq("job_number", jn)
      : await supabase.from("saved_jobs").insert({ worker_id: me.id, job_number: jn });
    if (error) { setSavedIds(prev => { const nx = new Set(prev); isSaved ? nx.add(jn) : nx.delete(jn); return nx; }); return; }
    // ステータスページと共用のキャッシュにも liked を写す（次に開いた画面が古い♥を出さない）
    const full = getCache("saved:rows");
    if (Array.isArray(full)) setCache("saved:rows", full.map(x => x.job_number === jn ? { ...x, liked: !isSaved } : x));
  };

  // 求人ページへ（戻り先＝いまのマイページ。WorkerApplicationsの求人リンクと同じ作法）
  const openJob = (jn) => {
    try { sessionStorage.setItem("cb_jobBackTo", window.location.hash.replace(/^#/, "")); } catch {}
    window.location.hash = "/work/job/" + jn;
  };

  const count = rows ? rows.length : 0;

  return (
    <div style={{ marginTop:16 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + ROLE_ORANGE, paddingLeft:8 }}>いいねした求人</p>
      {rows === null ? (
        <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", padding:"24px 8px" }}>読み込み中<Dots /></p>
      ) : count === 0 ? (
        <div style={{ textAlign:"center", padding:"20px 8px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, margin:0 }}>
            まだいいねした求人はありません。<br />気になる求人をいいねしておくと、ここに並びます。
          </p>
          <button type="button" onClick={() => { window.location.hash = "/search"; }} className="f-sans"
            style={{ marginTop:14, padding:"10px 18px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>求人をさがす →</button>
        </div>
      ) : (
        /* その他の求人と同じカードを縦一列（仕事の評価ページと同じ適用＝wideを全幅で）。
           ★全件をJobCardで描く（2026-08-22たきと報告「1つだけしかカード化されていない」の修正）：
           jobs_public は「open または 満員でclosed」だけのビューので、満員でない終了求人は行が無い。
           その場合は my_job_actions の行（写真・作物・日程・町域を持つ）から仮の姿を組む＝
           ステータスページの展開ボックス（SavedJobsView boxJob）と同じフォールバック。
           報酬は取れないので pay:0（JobCard側が0円を出さず空にする・ダミー禁止）。
           closed の帯はフォールバックでも出す（job_status から）＝全カードの見え方が揃う */
        <div style={{ display:"grid", gap:16 }}>
          {rows.map(r => {
            const job = jobs[r.job_number] || {
              id: r.job_number, crop: r.crop || "", task: r.task || "", photos: r.photos || [],
              region: r.town || "", dateStartRaw: r.date_start || "", dateEndRaw: r.date_end || "",
              pay: 0, closed: r.job_status === "closed",
            };
            return (
              <JobCard key={r.job_number} job={job} variant="wide"
                saved={savedIds.has(job.id)} onToggleSave={toggleLike}
                views={viewCounts[job.id]} onOpen={() => openJob(job.id)} />
            );
          })}
        </div>
      )}
    </div>
  );
}
