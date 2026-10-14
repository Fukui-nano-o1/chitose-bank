import { useCallback, useEffect, useRef, useState } from "react";
import { ownJobActionOptions, resolveOwnJobSelection } from "../lib/ownJobActions.js";

export function useOwnJobSelection({ rows, scope, ownerId, enabled, isEnded, runAction }) {
  const [selection, setSelection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectionRef = useRef(null);
  const originRef = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const current = useRef(null);
  current.current = { rows, scope, ownerId, enabled, isEnded, runAction };
  const selectedJob = resolveOwnJobSelection(selection, current.current);
  const actions = ownJobActionOptions(selectedJob, selectedJob ? isEnded(selectedJob) : false);
  const clearSelection = useCallback((restoreFocus = false) => {
    if (lock.current) return;
    selectionRef.current = null; setSelection(null); setError("");
    if (restoreFocus && originRef.current?.isConnected) originRef.current.focus({ preventScroll: true });
  }, []);
  const selectJob = useCallback((number, origin) => {
    const context = current.current;
    const next = { number, scope: context.scope, ownerId: context.ownerId };
    if (lock.current || !resolveOwnJobSelection(next, context)) return;
    originRef.current = origin;
    selectionRef.current = next; setSelection(next); setError("");
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Invalidate immediately on navigation, even when a dashboard remains mounted behind another route.
  useEffect(() => {
    const reset = () => { selectionRef.current = null; setSelection(null); setError(""); };
    reset();
    window.addEventListener("hashchange", reset);
    window.addEventListener("popstate", reset);
    return () => { window.removeEventListener("hashchange", reset); window.removeEventListener("popstate", reset); };
  }, [scope, ownerId, enabled]);
  useEffect(() => {
    if (selection && !selectedJob) { selectionRef.current = null; setSelection(null); }
  }, [selection, selectedJob]);
  const runSelectedAction = useCallback(async kind => {
    if (lock.current) return;
    const context = current.current;
    const chosen = selectionRef.current;
    const job = resolveOwnJobSelection(chosen, context);
    if (!job || !ownJobActionOptions(job, context.isEnded(job)).some(action => action.kind === kind)) {
      clearSelection(); return;
    }
    const number = job.job_number; // Freeze one target before any confirmation or network request.
    lock.current = true; setBusy(true); setError("");
    try {
      const ok = await context.runAction(kind, number);
      if (mounted.current && selectionRef.current === chosen && ok !== false) {
        selectionRef.current = null; setSelection(null);
      }
    } catch {
      if (mounted.current && selectionRef.current === chosen) setError("処理結果を確認できません。一覧を確認してから、もう一度お試しください。");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [clearSelection]);
  return { selectedJob, actions, busy, error, selectJob, clearSelection, runSelectedAction };
}
