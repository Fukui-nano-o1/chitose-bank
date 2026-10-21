import { useEffect, useState } from "react";
import { DEVICE_DRAFT_EVENT, listDeviceDrafts, forkDeviceDraft } from "../lib/deviceDrafts";
import { jobSaveGuidance } from '../lib/inputRecovery.js';

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
        {d.state === "conflict" ? "保存済みの内容と差があるため、自動保存を止めています。入力はこの端末に残っています。「続きを入力」で内容を控え、最新の求人と比べてください。別の募集として残す場合は「新しい下書きにコピー」を使えます。"
          : d.state === "publishing" ? "掲載結果の確認待ちです。掲載済みの場合もあります。入力はこの端末に残っています。同じ端末・ブラウザで「続きを入力」から確認画面を開き、同じ掲載操作の結果を確認してください。"
          : d.state === "blocked" ? jobSaveGuidance(d)
          : d.state === "pending" ? "この端末に保存済み・サーバーへの反映は確認待ちです。通信が戻るか、次にこの画面を開いたときに送信します。確認が済むまでサイトデータを削除しないでください。"
          : "この端末に保存済み。続きを入力できます。"}
      </p>
      <button className="cb-draft-resume" type="button" onClick={() => { window.location.hash = `/work/local/${d.id}`; }}>続きを入力</button>
      {["conflict", "blocked"].includes(d.state) && <button type="button" className="cb-draft-resume" style={{ margin:8 }} onClick={() => {
        try { const fresh = forkDeviceDraft(d); window.location.hash = `/work/local/${fresh.id}`; }
        catch { setError("新しい下書きの保存を確認できません。元の下書きの内容を控え、端末の空き容量とブラウザの保存設定を確認してください。サイトデータは削除しないでください。"); }
      }}>新しい下書きにコピー</button>}
    </article>)}
  </section>;
}
