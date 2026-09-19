import { useEffect, useState } from "react";
import { fetchPublicJobs } from "../lib/searchJobs";
import { getCache } from "../lib/viewCache";
import { DeviceDrafts } from "./DeviceDrafts";

// 同意の送信待ちは公開済みの情報と本人の端末下書きだけを表示する。
// 当事者用の詳細・連絡先・応募操作を持つ画面にはまだ入らない。
export function PendingConsentWorkspace({ owner, onNewJob, onRetry, error }) {
  const [jobs, setJobs] = useState(() => getCache("search:jobs") || []);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchPublicJobs({ scope: "consent-pending" }).then(data => { if (!cancelled && data) setJobs(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return <div className="f-sans" style={{ maxWidth:760, margin:"0 auto", padding:"20px 0" }}>
    <div role="status" style={{ background:"#eef8f3", padding:20, borderRadius:12 }}>
      <h1 style={{ fontSize:20, marginTop:0 }}>同意をこの端末に記録しました</h1>
      <p style={{ lineHeight:1.8 }}>サーバーへ送信しています。このまま求人を読んだり、下書きを作成したりできます。応募・掲載などは同意の送信が完了すると利用できます。</p>
      {error && <p>{error}</p>}
      <button type="button" className="cb-draft-resume" onClick={onRetry}>送信を再確認</button>
      {error && <button type="button" className="cb-draft-resume" style={{ margin:8 }} onClick={() => window.location.reload()}>画面を再読み込み</button>}
    </div>
    <DeviceDrafts owner={owner} />
    <button type="button" className="cb-draft-resume" style={{ margin:"24px 0" }} onClick={onNewJob}>求人の下書きを作る</button>
    <h2 style={{ fontSize:20 }}>公開されている求人</h2>
    {!jobs.length && <p>{loading ? "求人を読み込んでいます。下書き作成は先に進められます。" : "いまは求人を読み込めません。通信が戻ると通常の画面に進みます。"}</p>}
    {jobs.map(j => <article key={j.id} style={{ borderTop:"1px solid #ddd", padding:"16px 0" }}>
      <h3>{[j.crop, j.task].filter(Boolean).join("・") || `求人 #${j.id}`}</h3>
      <p>{j.region || j.prefecture || ""} {j.date || j.dateLabel || ""}</p>
      <p style={{ whiteSpace:"pre-wrap", lineHeight:1.8 }}>{j.notes || ""}</p>
    </article>)}
  </div>;
}
