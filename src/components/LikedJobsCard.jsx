// いいねした求人カード（2026-08-22 たきと指示「マイページのわたしの記録グループにいいねした求人カードを新設」）
// ・マイページ（ProfileHub・働き手ホーム）の「わたしの記録」カテゴリーに並ぶ1枚。
//   カード＝件数＋説明／タップで一覧ボックス（労働条件通知書と同じ規格）。
// ・一覧は【その他の求人と同じカード】（2026-08-22たきと指示「その他の求人と同じカード一覧構造にしてほしい」）：
//   JobCard＝関連求人と同じ「写真に情報を重ねる」型。横スクロール用の related は幅280px固定なので、
//   縦一列のこの面には全幅版の variant="wide" を使う（仕事の評価ページ ReviewStagePanel と同じ適用）。
//   ♥（解除⇄再いいね）・👀閲覧数・募集終了の帯もその他の求人と同じ＝JobCardが唯一のソース（独自の顔を作らない）。
// ・データ源はステータスページ(#/saved)と同じ my_job_actions（SECURITY DEFINER・本人のいいね＋応募だけ）。
//   liked=true の行だけをこのカードが使う＝いいねの取得経路を増やさない。
//   キャッシュもステータスページと同じ "saved:rows"（同じRPCの同じ形）を共用＝どちらから開いても互いに温まる。
// ・♥の実処理は さがす の performSave と同じ作法（楽観更新→失敗時は戻す・saved_jobs は本人スコープRLS）。
//   解除してもボックスを開いている間はカードを残す（♥を空にするだけ＝タップし直せば戻る＝暗黙の取り消し）。
//   ボックスを閉じた時に、解除したままの求人を一覧から下ろす。
// ・取得の規則（SavedJobsViewと同じ・2026-08-07フェイルオープン規則）：
//   ①res.errorを見る・失敗時は手元の値もキャッシュも上書きしない
//   ②my_job_actions は auth.uid() が無いと【200で空配列】を返すので、空配列はセッションを確かめてから信じる
// ・★jobs（mapJobPublicRowの結果）は viewCache に入れない：dateStart/dateEnd が Date オブジェクトで、
//   JSONで保存→復元すると文字列になり読む側が落ちる（2026-08-03の実害と同じ型）。開いた時に1往復するだけ。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { getCache, setCache } from "../lib/viewCache";
import { mapJobPublicRow, ROLE_ORANGE } from "../lib/utils";
import { fetchJobViewCounts } from "../lib/searchJobs";
import { JobCard } from "./JobCard";
import { NavIconInline } from "./NavIcons";

const likedOf = (list) => (Array.isArray(list) ? list.filter(r => r.liked) : null);

export function LikedJobsCard({ me }) {
  // 前回の内容（ステータスページと共用のキャッシュ）が残っていればまず出す→裏で最新に差し替える
  const [rows, setRows] = useState(() => likedOf(getCache("saved:rows"))); // null=読み込み中
  const [listOpen, setListOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false); // 説明は？ボタンで展開（労働条件通知書と同じ作法）
  const [jobs, setJobs] = useState({});            // job_number → mapJobPublicRow（★viewCacheに入れない・上記）
  // 👀閲覧数：さがすと同じキャッシュを共用（search:viewCounts＝数のみ・誰が見たかは持たない）
  const [viewCounts, setViewCounts] = useState(() => getCache("search:viewCounts") ?? {});
  // ♥の表示状態（この求人にいまいいねが付いているか）。一覧の行はボックスを閉じるまで動かさない
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

  // ボックスを開いたら、カードの材料（jobs_public・その他の求人と同じ全体像）と閲覧数を読み足す。
  // 取得済みの求人は読み直さない。失敗時は手元の値を上書きしない（最小カードのまま出す）
  const numsKey = (rows || []).map(r => r.job_number).join(",");
  useEffect(() => {
    if (!listOpen || !numsKey) return;
    let live = true;
    const nums = numsKey.split(",").map(Number).filter(n => Number.isFinite(n) && !(n in jobs));
    if (!nums.length) return;
    (async () => {
      try {
        const [jobRes, vc] = await Promise.all([
          supabase.from("jobs_public").select("*").in("job_number", nums),
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
  }, [listOpen, numsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- jobsは取得済み判定のみ（依存に入れると再取得ループ）

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

  // 閉じる時に、解除したままの求人を一覧から下ろす（開いている間は♥を空にして残す＝暗黙の取り消し）
  const closeList = () => {
    setListOpen(false);
    setRows(prev => (prev || []).filter(r => savedIds.has(r.job_number)));
  };

  const count = rows ? rows.length : 0;

  // 求人ページへ（戻り先＝いまのマイページ。WorkerApplicationsの求人リンクと同じ作法）
  const openJob = (jn) => {
    closeList(); // ポータルごとアンマウントされる前に閉じておく（cb-lock-scrollの残骸を作らない）
    try { sessionStorage.setItem("cb_jobBackTo", window.location.hash.replace(/^#/, "")); } catch {}
    window.location.hash = "/work/job/" + jn;
  };

  return (
    <>
      {/* 「わたしの記録」カテゴリーの中に並ぶ1枚＝専用の見出しは持たない。
          件数0でもカードは出す（タップ不能・非表示にしない＝2026-08-03の原則。中で説明を出す） */}
      <button type="button" onClick={() => setListOpen(true)} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"block", textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
        <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}><NavIconInline name="heartFill" size={15} style={{ color:"#E24B4A" }} />いいねした求人</span>
        <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:4, lineHeight:1.6 }}>
          {rows === null ? "読み込み中…" : count > 0 ? `${count}件　気になる求人の一覧です。タップで見返せます` : "気になる求人をいいねしておくと、ここに並びます"}
        </span>
      </button>

      {/* 一覧ボックス（労働条件通知書の一覧と同じ規格：中央・上下40px余白・外タップで閉じる・✕なし） */}
      {listOpen && createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget) closeList(); }} className="cb-box-overlay cb-lock-scroll" style={{ zIndex:10000, padding:"40px 16px" }}>
          <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"20px", maxWidth:460, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", position:"relative" }}>
            {/* 見出し行ごと「？」の当たり判定にする（丸チップだけだと外して黒幕に当たる・2026-08-18の教訓） */}
            <button type="button" onClick={(e) => { e.stopPropagation(); setInfoOpen(v => !v); }} aria-label="説明を見る" aria-expanded={infoOpen}
              style={{ display:"flex", alignItems:"center", gap:8, width:"100%", margin:"0 0 12px", padding:"4px 48px 4px 0", background:"none", border:"none", cursor:"pointer", textAlign:"left" }}>
              <span className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222" }}><NavIconInline name="heartFill" size={15} style={{ color:"#E24B4A" }} />いいねした求人</span>
              <span className="f-sans" style={{ width:22, height:22, borderRadius:11, background: infoOpen ? ROLE_ORANGE : "#F0F0F0", color: infoOpen ? "#fff" : "#717171", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>？</span>
            </button>
            {infoOpen && (
              <p className="fade-in f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.8, margin:"0 0 12px" }}>
                求人ページでいいねした求人の一覧です。カードをタップすると求人ページが開きます。ハートをタップすると解除できます（もう一度タップで戻せます）。
              </p>
            )}
            {rows === null ? (
              <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", padding:"24px 8px" }}>読み込み中…</p>
            ) : count === 0 ? (
              <div style={{ textAlign:"center", padding:"24px 8px" }}>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, margin:0 }}>
                  まだいいねした求人はありません。<br />気になる求人をいいねしておくと、ここに並びます。
                </p>
                <button type="button" onClick={() => { closeList(); window.location.hash = "/search"; }} className="f-sans"
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
        </div>,
        document.body
      )}
    </>
  );
}
