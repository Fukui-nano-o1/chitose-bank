import { supportImpactLabel, supportReceipt, supportTopicLabel } from "../../lib/supportModel";
import { reportDate } from "./reportModel";

const shortText = value => typeof value === "string" ? value.slice(0, 200) : "";
const dimension = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 20000 ? Math.round(Number(value)) : null;

// Display only the diagnostic fields explicitly collected for support. Never dump
// the raw object: future transport metadata could contain private request values.
export function SupportReportEvidence({ row }) {
  const context = row.diagnostics && typeof row.diagnostics === "object" ? row.diagnostics : {};
  const errors = Array.isArray(context.recent_errors) ? context.recent_errors.filter(error => error && typeof error === "object").slice(-10) : [];
  const width = dimension(context.viewport?.width) || dimension(row.viewport);
  const height = dimension(context.viewport?.height);
  return <>
    <dl className="reports-facts">
      <div><dt>受付番号</dt><dd>{supportReceipt(row.id)}</dd></div>
      <div><dt>困っている操作</dt><dd>{supportTopicLabel(row.topic)}</dd></div>
      <div><dt>利用者への影響</dt><dd>{supportImpactLabel(row.impact)}<small className="reports-impact-note">利用者が選んだ内容です。</small></dd></div>
      {row.expected_result && <div><dt>期待した結果</dt><dd className="reports-body">{row.expected_result}</dd></div>}
      <div><dt>報告時の状態</dt><dd>{row.reporter_id ? "ログイン済み" : "ログイン前"}</dd></div>
    </dl>
    <details className="reports-disclosure"><summary>再現に使う記録</summary>
      <dl className="reports-facts">
        <div><dt>画面</dt><dd>{row.page_hash || "記録なし"}</dd></div>
        <div><dt>記録した日時</dt><dd>{reportDate(shortText(context.captured_at), true)}</dd></div>
        <div><dt>画面の大きさ</dt><dd>{width ? `${width}${height ? ` × ${height}` : ""}px` : "記録なし"}</dd></div>
        <div><dt>アプリの版</dt><dd>{shortText(context.build_id) || "記録なし"}</dd></div>
        <div><dt>端末の通信状態</dt><dd>{context.online === true ? "オンラインとの申告" : context.online === false ? "オフラインとの申告" : "記録なし"}</dd></div>
      </dl>
      <p className="reports-muted">入力内容・パスワード・認証コード・会話の全文は自動記録していません。通信状態だけでは、サーバーとの接続成功は判断できません。</p>
      {errors.length > 0 ? <ol className="reports-events">{errors.map((error, index) => <li key={index}>
        <strong>{shortText(error.operation) || "操作名の記録なし"}</strong><p>{reportDate(shortText(error.at), true)} · {shortText(error.code) || "識別子の記録なし"}</p>
      </li>)}</ol> : <p className="reports-muted">添付されたエラーの記録はありません。エラー表示がない操作の問題も、報告本文をもとに確認してください。</p>}
    </details>
  </>;
}
