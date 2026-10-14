import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./OwnJobActions.css";

function ActionIcon({ kind }) {
  const paths = {
    resume: <><path d="M4 12h15m-6-6 6 6-6 6" /></>,
    edit: <><path d="m4 16-1 5 5-1L20 8l-4-4L4 16Zm10-10 4 4" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    delete: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
    unpublish: <><path d="m3 3 18 18M10 5c6-1 10 7 10 7a16 16 0 0 1-3 4M6 6a17 17 0 0 0-4 6s4 7 10 7c2 0 3-1 4-1" /><path d="M10 10a3 3 0 0 0 4 4" /></>,
  };
  return <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
}

export function OwnJobActionBar({ job, actions, busy, error, onAction, onClose }) {
  const bar = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    document.body.classList.add("cb-own-job-actions-open");
    bar.current?.querySelector("[data-job-action]")?.focus({ preventScroll: true });
    const outside = event => {
      if (bar.current?.contains(event.target)) return;
      const card = event.target.closest?.("[data-own-job-number]");
      if (card) return; // Cards handle dismissal or switching selection before this bubbling listener.
      close.current(false);
    };
    const escape = event => {
      if (event.key === "Escape") { event.preventDefault(); close.current(true); }
    };
    const hide = () => { if (document.hidden) close.current(false); };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.body.classList.remove("cb-own-job-actions-open");
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [job.job_number]);
  const title = [job.crop, job.task].filter(Boolean).join(" ") || "無題の求人";
  return createPortal(
    <section ref={bar} id="own-job-actions" role="region" aria-label={`求人 #${job.job_number} の操作`} aria-busy={busy}
      className="cb-job-action-fabs cb-own-job-actions f-sans">
      <div className="cb-own-job-actions__heading">
        <p role="status"><span>選択中 · #{job.job_number}</span><strong>{title}</strong></p>
        <button type="button" className="cb-own-job-actions__close" disabled={busy} aria-label="求人の選択を解除" onClick={() => onClose(true)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="cb-own-job-actions__buttons">
        {actions.map(action => <button key={action.kind} type="button" data-job-action={action.kind} disabled={busy}
          className={action.kind === "delete" ? "is-destructive" : undefined}
          aria-label={`求人 #${job.job_number} を${action.label}`} onClick={() => onAction(action.kind)}>
          <ActionIcon kind={action.kind} /><span>{action.label}</span>
        </button>)}
      </div>
      {busy && <p className="cb-own-job-actions__message" role="status">処理しています…</p>}
      {error && <p className="cb-own-job-actions__message" role="alert">{error}</p>}
    </section>, document.body,
  );
}
