// 通報の受信箱。管理者ゲートはApp、閲覧・更新権限は既存のRLSが担う。
import { useState, useEffect, useCallback, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { Dots } from "../ui";
import { openWorkerPreview } from "../../lib/previewBus";
import { getCache, setCache } from "../../lib/viewCache";
import { useVisualViewportFit } from "../../lib/visualViewportFit";
import { DAY_FACT_LABELS, dateRangeLabel, payTermsLine } from "../../lib/utils";
import {
  REPORT_KINDS, REPORT_CACHE, REPORT_STEPS, isDemoReport, isClosedReport,
  needsReportAction, reportKey, reportPath, reportKindLabel, reportStatus,
  reportSummary, reportNextAction, mergeReportResults, reportRoute, reportDate, matchesReportSearch,
} from "./reportModel";
import { supportImpactLabel } from "../../lib/supportModel";
import { SupportReportEvidence } from "./SupportReportEvidence";
import { AdminSupportThread } from "./AdminSupportThread";
import "./AdminReportsRoom.css";

function Status({ row }) {
  const status = reportStatus(row);
  return <span className={`reports-status reports-status-${status.tone}`}>{status.label}</span>;
}

function ReportDialog({ title, onClose, children, footer, covered = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useVisualViewportFit(ref, true);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("button")?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const onKeyDown = event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const focusable = [...ref.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')];
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-hidden={covered || undefined} inert={covered}
      onKeyDown={onKeyDown} className="reports-modal cb-lock-scroll f-sans">
      <header className="reports-modal-header">
        <button type="button" className="reports-back" onClick={onClose} aria-label="前の画面に戻る">←</button>
        <h2 id={titleId}>{title}</h2>
      </header>
      <div className="reports-modal-scroll"><div className="reports-detail-inner">{children}</div></div>
      {footer && <footer className="reports-footer"><div>{footer}</div></footer>}
    </div>, document.body,
  );
}

function ReportSteps({ kind }) {
  return <ol className="reports-steps">{REPORT_STEPS[kind].map(step => <li key={step.title}>
    <h3>{step.title}</h3><p>{step.body}</p>
  </li>)}</ol>;
}

function ContactLink({ id, children }) {
  return id ? <a className="reports-link" href={`#/chat/admin/${id}`}>{children}<span aria-hidden="true">↗</span></a> : null;
}

function PayEvidence({ row }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    supabase.from("pay_incidents").select("id,snapshot").eq("id", row.id).single()
      .then(result => {
        if (!active) return;
        if (result.error || !result.data?.snapshot) setError(true);
        else setRecord(result.data.snapshot);
      }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [row.id, attempt]);
  const terms = record?.application?.terms_snapshot;
  const job = record?.job || {};
  const days = Array.isArray(record?.day_records) ? record.day_records : [];
  const money = terms?.pay_type === "日給" ? terms.daily_wage : terms?.pay_type === "時給" ? terms.hourly_wage : null;
  return <section className="reports-section" aria-labelledby="reports-evidence-heading">
    <h2 id="reports-evidence-heading">申告時の記録</h2>
    <p className="reports-muted">申告時点で保存された内容です。その後の支払いは、双方に確認してください。</p>
    {error ? <div className="reports-error" role="alert">記録を取得できません。<button type="button" onClick={() => setAttempt(value => value + 1)}>記録を再読み込み</button></div>
      : !record ? <p role="status">記録を読み込み中<Dots /></p> : <>
        <dl className="reports-facts">
          <div><dt>仕事</dt><dd>{[job.crop, job.task].filter(Boolean).join(" ") || "記録なし"}</dd></div>
          <div><dt>雇い手</dt><dd>{terms?.party_names?.farmer || terms?.recruiter_name || "氏名の記録なし"}</dd></div>
          <div><dt>働き手</dt><dd>{terms?.party_names?.worker || "氏名の記録なし"}</dd></div>
          <div><dt>契約の報酬</dt><dd>{money != null && money !== "" && Number.isFinite(Number(money)) ? `${terms.pay_type} ${Number(money).toLocaleString("ja-JP")}円` : "記録なし"}</dd></div>
          <div><dt>契約の日程</dt><dd>{record.application?.agreed_dates?.length ? record.application.agreed_dates.join("、") : terms?.date_start ? dateRangeLabel(terms.date_start, terms.date_end) : terms?.date_label || "記録なし"}</dd></div>
          <div><dt>支払時期・方法</dt><dd>{terms ? payTermsLine({ payTiming: terms.pay_timing, payMethod: terms.pay_method }) || "記録なし" : "契約の記録なし"}</dd></div>
          <div><dt>最終回答</dt><dd>{record.final_review?.pay_status === "unpaid" ? "働き手が「未払い」と回答" : "未払いの回答を確認できません"}</dd></div>
        </dl>
        {!terms && <p className="reports-muted">この申告には契約条件の記録がありません。求人の内容と当事者への確認をもとに調べてください。</p>}
        <details className="reports-disclosure"><summary>日次の記録（{days.length}件）</summary>
          {days.length === 0 ? <p>申告時点で日次の記録はありません。</p> : <ul className="reports-events">{days.map((day, index) => <li key={day.id || index}>
            <strong>{DAY_FACT_LABELS.find(item => item.k === day.kind)?.l || "その他の記録"}</strong>
            <p>{day.work_date || reportDate(day.created_at)} · {day.actor_id && day.actor_id === row.worker_id ? "働き手" : day.actor_id && day.actor_id === row.farmer_id ? "雇い手" : "記録者不明"}</p>
            {(day.detail || day.reason) && <p>{[day.detail, day.reason].filter(Boolean).join(" · ")}</p>}
          </li>)}</ul>}
        </details>
      </>}
  </section>;
}

function ReportDetail({ row, busy, fresh, updateError, onUpdate, onGuide, onSupportChange }) {
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState("");
  const summary = reportSummary(row);
  const demo = isDemoReport(row);
  const closed = isClosedReport(row);
  const disabled = busy || !fresh;
  const supportThread = row.kind === "screen" && Object.hasOwn(row, "updated_at");
  return <>
    <div className="reports-detail-heading">
      <div className="reports-row-meta"><span>{reportKindLabel(row.kind)}</span><Status row={row} /></div>
      <h1>{summary.title}</h1>
      <p className="reports-target">{summary.target}</p>
      <p className="reports-muted">受付：{reportDate(row.created_at, true)}</p>
    </div>
    {demo ? <p className="reports-notice">「【デモ】」と記載された表示サンプルです。実案件の要対応件数には含めず、この画面から状態を変更することもできません。</p>
      : closed ? <p className="reports-notice">この案件は「{reportStatus(row).label}」として対応履歴に残っています。{row.decided_at ? `終了：${reportDate(row.decided_at, true)}` : ""}</p>
      : <div className="reports-next"><span>次にすること</span><h2>{reportNextAction(row)}</h2><p>{row.kind === "pay" ? "未払いの申告です。支払いの有無を確認してから、結果を記録してください。" : "下の通報内容と対象を確認し、必要な対応を進めてください。"}</p></div>}
    <section className="reports-section"><h2>{row.kind === "comment" ? "通報時のコメント" : row.kind === "pay" ? "運営メモ" : "通報・報告の内容"}</h2>
      <blockquote>{row.kind === "pay" ? row.admin_note || "メモの記録はありません。" : summary.body}</blockquote>
      {row.kind === "comment" && row.detail && <p className="reports-body">補足：{row.detail}</p>}
      {row.kind === "screen" && (row.topic || row.diagnostics ? <SupportReportEvidence row={row} /> : <p className="reports-muted">報告時の画面幅：{row.viewport ? `${row.viewport}px` : "記録なし"}</p>)}
      {!demo && <div className="reports-links">
        {(row.kind === "job" || row.kind === "pay") && row.job_number != null && <a className="reports-link" href={`#/admin/review/${row.job_number}`}>対象の求人を確認<span aria-hidden="true">↗</span></a>}
        {row.kind === "person" && row.target_worker_id && <button type="button" className="reports-link" onClick={() => openWorkerPreview(row.target_worker_id, row.source === "work_record" ? 1 : 0)}>対象のプロフィールを確認<span aria-hidden="true">↗</span></button>}
      </div>}
    </section>
    {row.kind === "pay" && !demo && <PayEvidence key={row.id} row={row} />}
    {!demo && supportThread && <AdminSupportThread row={row} onChange={onSupportChange} />}
    {!demo && !supportThread && <section className="reports-section"><h2>事実確認の連絡先</h2>
      <p className="reports-muted">運営チャットが開きます。内容を入力して送信するまでは、相手への連絡は行われません。</p>
      <div className="reports-links">
        <ContactLink id={row.reporter_id}>{row.kind === "pay" ? "申告した働き手に確認" : "通報・報告した人に確認"}</ContactLink>
        {row.kind === "pay" && <ContactLink id={row.farmer_id}>雇い手に確認</ContactLink>}
        {row.kind === "comment" && <ContactLink id={row.sender_id_snapshot}>発言した人に確認</ContactLink>}
        {row.kind === "person" && <ContactLink id={row.target_worker_id}>対象の働き手に確認</ContactLink>}
      </div>
      {!row.reporter_id && <p className="reports-muted">通報・報告した人の記録はありません。</p>}
    </section>}
    <section className="reports-section"><div className="reports-section-heading"><h2>この案件の対応手順</h2><button type="button" className="reports-text-button" onClick={onGuide}>手順書</button></div><ReportSteps kind={row.kind} /></section>
    <details className="reports-disclosure"><summary>案件情報</summary><dl className="reports-facts">
      <div><dt>案件ID</dt><dd>{row.id}</dd></div>
      {row.application_id && <div><dt>応募ID</dt><dd>{row.application_id}</dd></div>}
      {row.reporter_id && <div><dt>報告者ID</dt><dd>{row.reporter_id}</dd></div>}
    </dl></details>
    {!closed && !demo && !supportThread && <section className="reports-section reports-complete" aria-labelledby="reports-complete-heading">
      <h2 id="reports-complete-heading">対応の状態を更新</h2>
      {!fresh && <p className="reports-error" role="status">最新の状態を取得できるまで、更新はできません。一覧の「再読み込み」をお試しください。</p>}
      {updateError && <p className="reports-error" role="alert">{updateError}</p>}
      {row.kind === "pay" && row.status === "reported" && <button type="button" className="reports-primary" disabled={disabled} onClick={() => onUpdate(row, "checking")}>{busy ? "更新中…" : "事実確認を始める"}</button>}
      {closing ? <div className="reports-confirm">
        <h3>確認と必要な対応は終わりましたか？</h3>
        {row.kind === "pay" ? <fieldset disabled={disabled}><legend>確認結果を選んでください</legend>
          <label><input type="radio" name="report-outcome" value="resolved" checked={outcome === "resolved"} onChange={() => setOutcome("resolved")} /><span><strong>解決済み</strong><small>支払いの問題が解消したことを確認した</small></span></label>
          <label><input type="radio" name="report-outcome" value="unresolved" checked={outcome === "unresolved"} onChange={() => setOutcome("unresolved")} /><span><strong>未解決で終了</strong><small>解消を確認できないまま、対応を終える</small></span></label>
        </fieldset> : <p>「対応済み」として対応履歴に移します。この操作は、求人・コメントの削除やアカウント停止、相手への通知を行いません。</p>}
        <div className="reports-confirm-actions"><button type="button" className="reports-secondary" disabled={busy} onClick={() => setClosing(false)}>確認を続ける</button>
          <button type="button" className="reports-primary" disabled={disabled || (row.kind === "pay" && !outcome)} onClick={() => onUpdate(row, row.kind === "pay" ? outcome : "resolved")}>{busy ? "保存中…" : "結果を保存する"}</button></div>
      </div> : <button type="button" className={row.kind === "pay" && row.status === "reported" ? "reports-secondary" : "reports-primary"} disabled={disabled} onClick={() => setClosing(true)}>{row.kind === "pay" ? "確認結果を記録する" : "対応を完了する"}</button>}
      <p className="reports-muted">まだ確認が必要な場合は、状態を変えずに一覧へ戻れます。</p>
    </section>}
  </>;
}

export function AdminReportsRoom() {
  const [items, setItems] = useState(() => getCache(REPORT_CACHE) || null);
  const [loading, setLoading] = useState(true);
  const [failedKinds, setFailedKinds] = useState([]);
  const [freshKinds, setFreshKinds] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sequence = useRef(0);
  const [updateError, setUpdateError] = useState("");
  const [message, setMessage] = useState("");
  const [view, setView] = useState("open");
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [route, setRoute] = useState(() => reportRoute(window.location.hash));
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    const follow = () => { setRoute(reportRoute(window.location.hash)); setUpdateError(""); };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    const request = ++sequence.current;
    setLoading(true); setFreshKinds([]);
    const results = await Promise.allSettled(REPORT_KINDS.map(source => supabase.from(source.table)
      .select(source.key === "pay" ? "id,application_id,job_number,status,created_at,admin_note,decided_at,reporter_id,farmer_id,worker_id" : "*")
      .order("created_at", { ascending: false })));
    if (request !== sequence.current) return;
    const failures = REPORT_KINDS.filter((_, index) => results[index].status !== "fulfilled" || results[index].value.error).map(source => source.key);
    setFailedKinds(failures);
    setFreshKinds(REPORT_KINDS.filter(source => !failures.includes(source.key)).map(source => source.key));
    setItems(previous => {
      const next = mergeReportResults(previous, results);
      setCache(REPORT_CACHE, next);
      return next;
    });
    setLoading(false);
  }, []);
  useEffect(() => { load(); return () => { sequence.current += 1; }; }, [load]);

  const acceptSupportUpdate = useCallback(report => {
    setItems(previous => {
      const next = (previous || []).map(item => reportKey(item) === reportKey(report) && !(Date.parse(item.updated_at) > Date.parse(report.updated_at)) ? { ...item, ...report } : item);
      setCache(REPORT_CACHE, next);
      return next;
    });
  }, []);

  const update = async (row, status) => {
    if (busyRef.current || !freshKinds.includes(row.kind) || !needsReportAction(row)) return;
    if (row.kind === "pay" ? !["checking", "resolved", "unresolved"].includes(status) : status !== "resolved") return;
    busyRef.current = true; setBusy(true); setUpdateError("");
    const request = sequence.current;
    const patch = { status, ...(row.kind === "pay" && status !== "checking" ? { decided_at: new Date().toISOString() } : {}) };
    try {
      // 現在の状態に一致した1件だけ更新し、戻り値で保存を確認。権限切れ・競合を成功に見せない。
      const { data, error } = await supabase.from(REPORT_KINDS.find(source => source.key === row.kind).table)
        .update(patch).eq("id", row.id).eq("status", row.status).select("id,status").single();
      if (error || data?.id !== row.id || data.status !== status) throw new Error("update_failed");
      if (request !== sequence.current) return;
      setItems(previous => {
        const next = (previous || []).map(item => reportKey(item) === reportKey(row) ? { ...item, ...patch } : item);
        setCache(REPORT_CACHE, next); return next;
      });
      setMessage(status === "checking" ? "事実確認中に更新しました。" : "対応履歴に保存しました。");
      if (status !== "checking") {
        setView("closed");
        if (reportRoute(window.location.hash) === reportKey(row)) window.location.hash = "/admin/reports";
      }
    } catch {
      if (request !== sequence.current) return;
      setUpdateError("更新を確認できませんでした。通信状況を確認して、一覧を再読み込みしてください。案件の状態は変更して表示していません。");
      setFreshKinds(previous => previous.filter(value => value !== row.kind));
    } finally { busyRef.current = false; if (request === sequence.current) setBusy(false); }
  };

  const all = items || [];
  const active = all.filter(needsReportAction);
  const closed = all.filter(row => !isDemoReport(row) && isClosedReport(row));
  const samples = all.filter(isDemoReport);
  const pool = view === "closed" ? closed : active;
  const visible = pool.filter(row => (kind === "all" || row.kind === kind) && (!blockedOnly || row.kind === "screen" && row.impact === "blocked") && matchesReportSearch(row, search));
  const detail = all.find(row => reportKey(row) === route);
  const closeDetail = () => { window.location.hash = "/admin/reports"; };
  const renderRow = row => {
    const summary = reportSummary(row);
    return <a key={reportKey(row)} href={`#${reportPath(row)}`} className="reports-row">
      <div className="reports-row-meta"><span>{reportKindLabel(row.kind)}</span><Status row={row} />{row.kind === "screen" && row.impact && <span className={`reports-impact reports-impact-${row.impact}`}>{supportImpactLabel(row.impact)}</span>}<time>{reportDate(row.created_at)}</time></div>
      <h2>{summary.title}</h2><p className="reports-target">{summary.target}</p><p className="reports-excerpt">{summary.body}</p>
      <div className="reports-row-next"><span>{isDemoReport(row) ? "サンプルの内容を見る" : reportNextAction(row)}</span><span aria-hidden="true">→</span></div>
    </a>;
  };
  return <>
    <div className="reports-room f-sans" inert={!!route || helpOpen}>
      <header className="reports-header"><a href="#/admin" className="reports-back" aria-label="管理に戻る">←</a><h1>通報・サポート</h1><button type="button" className="reports-guide-button" onClick={() => setHelpOpen(true)}>対応手順</button></header>
      <p className="reports-lead">届いた内容を確認し、必要な対応を進めましょう。</p>
      <div className="reports-overview"><strong>{items === null ? "読み込み中" : failedKinds.length === REPORT_KINDS.length ? "件数を確認できません" : `要対応 ${active.length}件${failedKinds.length ? "（取得分・前回分）" : ""}`}</strong><p>内容を読む <span aria-hidden="true">→</span> 事実を確認 <span aria-hidden="true">→</span> 結果を記録</p></div>
      {message && <p className="reports-success" role="status">{message}</p>}
      {failedKinds.length > 0 && <div className="reports-error" role="alert"><strong>{failedKinds.map(reportKindLabel).join("・")}を取得できませんでした。</strong><p>取得できた内容と前回の内容を表示しています。件数は最新でない可能性があります。</p></div>}
      <div className="reports-tabs" aria-label="対応状況">
        <button type="button" aria-pressed={view === "open"} onClick={() => setView("open")}>要対応 <span>{active.length}</span></button>
        <button type="button" aria-pressed={view === "closed"} onClick={() => setView("closed")}>対応履歴 <span>{closed.length}</span></button>
      </div>
      <div className="reports-filters"><label>種類<select value={kind} onChange={event => setKind(event.target.value)}><option value="all">すべて（{pool.length}）</option>{REPORT_KINDS.map(source => <option key={source.key} value={source.key}>{source.label}（{pool.filter(row => row.kind === source.key).length}）</option>)}</select></label>
        <button type="button" className="reports-text-button" disabled={loading || busy} onClick={load}>{loading ? "読み込み中…" : "再読み込み"}</button>
      </div>
      <div className="reports-search"><label htmlFor="reports-search">受付番号・内容から探す</label><input id="reports-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="例：ログイン、PDF、受付番号" />
        <label className="reports-blocked-filter"><input type="checkbox" checked={blockedOnly} onChange={event => setBlockedOnly(event.target.checked)} />「操作が止まっている」の申告のみ（{pool.filter(row => row.kind === "screen" && row.impact === "blocked").length}件）</label>
      </div>
      <p className="reports-list-caption">{view === "closed" ? "対応を終えた案件" : "確認・対応が必要な案件"} · 受付が新しい順</p>
      {items === null ? <p role="status" className="reports-empty">通報を読み込み中<Dots /></p>
        : visible.length ? <div className="reports-list">{visible.map(renderRow)}</div>
          : <div className="reports-empty"><h2>{failedKinds.length ? "表示できる案件がありません" : search.trim() || blockedOnly ? "条件に合う案件はありません" : view === "closed" ? "対応履歴はありません" : kind === "all" ? "要対応の案件はありません" : "この種類の要対応はありません"}</h2><p>{failedKinds.length ? "通信状況を確認して、再読み込みしてください。" : search.trim() || blockedOnly ? "検索語や絞り込みを変更してください。" : view === "closed" ? "対応を終えた案件はここで確認できます。" : "新しい通報・報告が届くと、ここに表示されます。"}</p></div>}
      {samples.length > 0 && <details className="reports-samples"><summary>表示サンプル（{samples.length}件）</summary><p>「【デモ】」の記載がある報告です。要対応件数には含めていません。</p><div className="reports-list">{samples.map(renderRow)}</div></details>}
    </div>
    {route && <ReportDialog title="案件の確認" onClose={closeDetail} covered={helpOpen} footer={<button type="button" className="reports-secondary" onClick={closeDetail}>一覧に戻る</button>}>
      {detail ? <ReportDetail key={route} row={detail} fresh={freshKinds.includes(detail.kind)} busy={busy} updateError={updateError} onUpdate={update} onGuide={() => setHelpOpen(true)} onSupportChange={acceptSupportUpdate} />
        : loading ? <p role="status">案件を読み込み中<Dots /></p> : <div className="reports-empty"><h1>この案件を表示できません</h1><p>通信状況や閲覧権限をご確認ください。</p><button type="button" className="reports-secondary" onClick={load}>再読み込み</button></div>}
    </ReportDialog>}
    {helpOpen && <ReportDialog title="通報対応の手順書" onClose={() => setHelpOpen(false)} footer={<button type="button" className="reports-primary" onClick={() => setHelpOpen(false)}>確認した画面に戻る</button>}>
      <p className="reports-lead">迷ったら、この順番で進めてください。</p>
      <ol className="reports-steps">
        <li><h3>「要対応」から案件を開く</h3><p>種類・対象・受付日を確認します。操作が止まっている報告は絞り込めます。「未対応」はこれから確認する案件、「確認中」は調査中、「回答あり」は利用者へ返信した案件です。「事実確認中」は未払いについて確認を進めている案件です。</p></li>
        <li><h3>内容と記録を確認する</h3><p>案件内の「次にすること」と種類別の手順に沿って進めます。通報は利用者からの申告です。必要に応じて双方に事実を確認します。</p></li>
        <li><h3>続けるための案内を伝え、結果を確認する</h3><p>画面・機能の相談には、案件内の返信欄から案内します。「回答あり」は解決を意味しません。修正や案内の結果を確認した後、「対応を完了する」または「確認結果を記録する」で結果を保存します。</p></li>
      </ol>
      <section className="reports-section"><h2>種類別の対応手順</h2>{REPORT_KINDS.map(source => <details key={source.key} className="reports-disclosure"><summary>{source.label}</summary><ReportSteps kind={source.key} /></details>)}</section>
      <section className="reports-section"><h2>完了した案件はどこへ？</h2><p>「対応履歴」に移ります。内容と結果は後から確認できます。未払いの「未解決で終了」は「解決済み」と区別して表示します。</p></section>
      <section className="reports-section"><h2>画面・機能の相談を受けたら</h2><p>まず、利用者が続けられる操作を案内してください。原因が分からないときは「確認中」として調査を続け、直ったとは伝えません。パスワード・認証コードを尋ねたり、失敗した保存・応募を確認せず繰り返すよう案内したりしないでください。</p><p>返信と状態は利用者本人の「相談履歴」で確認できます。自動メールや端末通知はありません。ログイン前の相談も同じ画面で扱えます。追加の相談が届くと、再び「要対応」になります。</p></section>
      <section className="reports-section"><h2>表示サンプル・通信エラー</h2><p>「【デモ】」の記載がある報告は、一覧の下にまとめています。通信エラーが表示された場合は、件数が最新か確認できません。「再読み込み」を押してください。</p></section>
    </ReportDialog>}
  </>;
}
