import { useEffect, useState } from "react";
import { DEVICE_DRAFT_EVENT, listDeviceDrafts, forkDeviceDraft } from "../lib/deviceDrafts";

export function DeviceDrafts({ owner }) {
  const [drafts, setDrafts] = useState(() => listDeviceDrafts(owner));
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => setDrafts(listDeviceDrafts(owner));
    refresh();
    window.addEventListener(DEVICE_DRAFT_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(DEVICE_DRAFT_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [owner]);
  const visible = drafts.filter(d => d.state !== "synced" && d.form);
  if (!visible.length) return null;
  return <section className="f-sans" aria-label="この端末の下書き" style={{ margin:"20px 0" }}>
    <h2 style={{ fontSize:18 }}>この端末の下書き</h2>
    {error && <p role="alert">{error}</p>}
    {visible.map(d => <article key={d.id} style={{ border:"1px solid #ddd", borderRadius:12, padding:16, margin:"12px 0" }}>
      <strong>{[d.payload.crop, d.payload.task].filter(Boolean).join("・") || "作成中の求人"}{d.jobNumber ? ` #${d.jobNumber}` : ""}</strong>
      <p role="status" style={{ fontSize:13, lineHeight:1.8 }}>
        {d.state === "conflict" ? "別の更新があるため、自動反映を止めました。入力はこの端末に残っています。コピーして新しい求人を作れます。"
          : d.state === "blocked" ? "サーバーに反映できませんでした。入力はこの端末に残っています。内容を確認して、必要ならコピーして新しく作成してください。"
          : d.state === "pending" ? `この端末に保存済み・同期待ち。${d.pending?.open ? "公開中の求人にはまだ反映されていません。" : "まだ掲載されていません。"}通信が戻るか、次にこの画面を開いたときに送信します。`
          : "この端末に保存済み。続きを入力できます。"}
      </p>
      <button className="cb-draft-resume" type="button" onClick={() => { window.location.hash = `/work/local/${d.id}`; }}>続きを入力</button>
      {["conflict", "blocked"].includes(d.state) && <button type="button" className="cb-draft-resume" style={{ margin:8 }} onClick={() => {
        try { const fresh = forkDeviceDraft(d); window.location.hash = `/work/local/${fresh.id}`; }
        catch { setError("この端末に保存できません。空き容量をご確認ください。"); }
      }}>新しい下書きにコピー</button>}
    </article>)}
  </section>;
}
