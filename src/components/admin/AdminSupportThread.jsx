import { useCallback, useEffect, useRef, useState } from "react";
import { getAdminSupport, updateAdminSupport, supportId } from "../../lib/supportClient";
import { reportDate, reportStatus } from "./reportModel";

export function AdminSupportThread({ row, onChange }) {
  const [record, setRecord] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [body, setBody] = useState("");
  const [closing, setClosing] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const pending = useRef(null);
  const sequence = useRef(0);
  const bodyRef = useRef("");
  const replyId = `support-admin-reply-${row.id}`;

  const accept = useCallback(result => {
    if (result?.report?.id !== row.id || !Array.isArray(result.messages)) throw new Error("SUPPORT_UNCONFIRMED");
    const report = { ...row, ...result.report, kind: "screen" };
    setRecord(report); setMessages(result.messages); onChange(report);
  }, [row, onChange]);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  const load = useCallback(async () => {
    if (inFlight.current) return;
    const request = ++sequence.current;
    setLoading(true); setError("");
    try {
      const result = await getAdminSupport(row.id);
      if (!mounted.current || request !== sequence.current) return;
      acceptRef.current(result);
    } catch {
      if (mounted.current && request === sequence.current) {
        setRecord(null);
        setError("相談の最新状態を確認できません。入力内容は残しています。会話を再読み込みしてください。");
      }
    } finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }, [row.id]);
  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; sequence.current += 1; };
  }, [load]);

  const save = async (status, reply = "") => {
    if (inFlight.current || !record || loading) return;
    const trimmed = reply.trim();
    if (status === "answered" && !trimmed) return;
    const existing = pending.current;
    // A timed-out reply is retried with the exact same ID and payload. A fresh
    // draft only receives a new ID after the previous result is confirmed.
    const request = existing || { id: row.id, expectedUpdatedAt: record.updated_at, status, body: trimmed, messageId: supportId() };
    pending.current = request;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await updateAdminSupport({ p_id: request.id, p_expected_updated_at: request.expectedUpdatedAt, p_status: request.status, p_body: request.body, p_message_id: request.messageId });
      if (!mounted.current) return;
      if (result?.report?.id !== row.id || !Array.isArray(result.messages)) throw new Error("SUPPORT_UNCONFIRMED");
      if (request.body) {
        if (!result?.messages?.some(message => message.id === request.messageId && message.author_role === "admin")) throw new Error("SUPPORT_UNCONFIRMED");
        if (bodyRef.current.trim() === request.body) { setBody(""); bodyRef.current = ""; }
      }
      acceptRef.current(result);
      pending.current = null; setClosing(false);
      setNotice(request.body ? "返信を保存しました。利用者の相談履歴に表示されます。" : request.status === "resolved" ? "対応済みとして記録しました。" : "確認中として記録しました。");
    } catch (failure) {
      if (!mounted.current) return;
      if (/CONFLICT|STALE/i.test(failure?.message || "")) {
        pending.current = null; setRecord(null);
        setError("別の更新がありました。返信の入力は残しています。会話を再読み込みし、最新の連絡を確認してから送ってください。");
      } else {
        setError("保存を確認できませんでした。入力は残しています。「同じ内容で再試行」で結果を確認できます。返信は重複して登録されません。");
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };

  const waiting = !!pending.current;
  const disabled = busy || loading || !record || waiting;
  const activeStatus = record || row;
  return <section className="reports-section reports-support" aria-labelledby="reports-support-heading">
    <div className="reports-section-heading"><h2 id="reports-support-heading">この相談への返信</h2><button type="button" className="reports-text-button" disabled={busy || loading} onClick={load}>会話を再読み込み</button></div>
    <p className="reports-muted">送った返信は、利用者本人の「相談履歴」に表示されます。メール送信や端末通知は行いません。運営だけのメモ欄ではありません。</p>
    {error && <div className="reports-error" role="alert"><p>{error}</p>{waiting && <button type="button" disabled={busy} onClick={() => save(pending.current.status, pending.current.body)}>{busy ? "確認中…" : "同じ内容で再試行"}</button>}</div>}
    {notice && <p className="reports-success" role="status">{notice}</p>}
    {loading ? <p role="status">会話を読み込み中…</p> : <ol className="reports-conversation" aria-label="相談のやり取り">{messages.map(message => <li key={message.id} className={message.author_role === "admin" ? "reports-message-admin" : "reports-message-user"}>
      <div><strong>{message.author_role === "admin" ? "運営" : "利用者"}</strong><time>{reportDate(message.created_at, true)}</time></div><p>{message.body}</p>
    </li>)}</ol>}
    {!loading && record && messages.length === 0 && <p className="reports-muted">まだ追加のやり取りはありません。最初の報告内容は上に表示しています。</p>}
    <label className="reports-reply-label" htmlFor={replyId}>利用者に伝える内容</label>
    <textarea id={replyId} rows={5} maxLength={3000} value={body} disabled={busy || waiting} onChange={event => { setBody(event.target.value); bodyRef.current = event.target.value; }} placeholder="確認したことと、次にできる操作を具体的に伝えてください。" />
    <div className="reports-reply-actions"><button type="button" className="reports-primary" disabled={disabled || !body.trim()} onClick={() => save("answered", body)}>{busy ? "保存中…" : "返信を送る"}</button></div>
    <section className="reports-support-status" aria-labelledby="support-status-heading"><h3 id="support-status-heading">対応の状態</h3><p>現在：{reportStatus(activeStatus).label}</p>
      {activeStatus.status === "open" && <button type="button" className="reports-secondary" disabled={disabled} onClick={() => save("checking")}>確認を始める</button>}
      {activeStatus.status !== "resolved" && (closing ? <div className="reports-confirm"><h3>対応内容を案内し、動作を確認しましたか？</h3><p>状態が利用者の相談履歴に表示されます。返信だけでは解決と扱わず、修正や案内の結果を確認してください。</p><div className="reports-confirm-actions"><button type="button" className="reports-secondary" disabled={busy} onClick={() => setClosing(false)}>確認を続ける</button><button type="button" className="reports-primary" disabled={disabled} onClick={() => save("resolved")}>結果を保存する</button></div></div>
        : <button type="button" className="reports-secondary" disabled={disabled} onClick={() => setClosing(true)}>対応を完了する</button>)}
      <p className="reports-muted">追加の相談が届くと、再び「要対応」に表示されます。閉じずに確認を続けることもできます。</p>
    </section>
  </section>;
}
