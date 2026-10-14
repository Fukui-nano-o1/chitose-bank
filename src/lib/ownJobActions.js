// UI eligibility only. Existing owner-scoped APIs and database restrictions remain authoritative.
export function ownJobActionOptions(job, ended = false) {
  if (job?.job_number == null) return [];
  const copy = { kind: "copy", label: "コピー" };
  if (job.status === "draft" && (!job.opened_at || !ended)) {
    return [
      { kind: "resume", label: "再開" }, copy,
      ...(!job.opened_at ? [{ kind: "delete", label: "削除" }] : []),
    ];
  }
  if (job.status === "open" && !ended) {
    return [{ kind: "edit", label: "編集" }, copy, { kind: "unpublish", label: "非公開" }];
  }
  return [copy];
}

export function resolveOwnJobSelection(selection, { rows, scope, ownerId, enabled }) {
  if (!enabled || !ownerId || !selection || selection.scope !== scope || selection.ownerId !== ownerId) return null;
  return rows.find(job => String(job.job_number) === String(selection.number)) || null;
}

// A small pointer state machine, shared by touch, pen and mouse. Scrolling is never prevented.
export function createJobCardPress(onHold, {
  delay = 450, slop = 10,
  schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
  unschedule = id => globalThis.clearTimeout(id),
} = {}) {
  let timer = null;
  let pointer = null;
  let held = false;
  let suppressClick = false;
  const clearTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
  const cancel = (suppress = false) => {
    if (suppress && (pointer || held)) suppressClick = true;
    clearTimer(); pointer = null;
  };
  const open = () => {
    clearTimer();
    if (held) return;
    held = true; suppressClick = true; onHold();
  };
  return {
    start(event) {
      if (event.isPrimary === false) { cancel(true); return; }
      if (event.button != null && event.button !== 0) { cancel(); held = false; suppressClick = false; return; }
      cancel(); held = false; suppressClick = false;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      timer = schedule(open, delay);
    },
    move(event) {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > slop) cancel(true);
    },
    end(event) { if (pointer && pointer.id === event.pointerId) cancel(); },
    cancel,
    open,
    consumeClick() { const consume = suppressClick; suppressClick = false; return consume; },
    destroy() { cancel(); held = false; suppressClick = false; },
  };
}
