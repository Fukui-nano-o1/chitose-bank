import { safeDraftRebase, draftPayloadMatches } from "./jobDraftProtocol.js";

// 端末上の作業記録。アカウント・作業ごとに分離し、送信内容は押した時点で固定する。
export const DEVICE_DRAFT_EVENT = "cb:device-drafts";
const PREFIX = "cb:device-draft:v1:";
const CONSENT = "cb:pending-consent:v1:";
const ACTIVE = "cb:active-draft:v1:";
const copy = value => JSON.parse(JSON.stringify(value));
const announce = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(DEVICE_DRAFT_EVENT)); };
const key = (owner, id) => `${PREFIX}${owner}:${id}`;
const storage = () => globalThis.localStorage;
function write(k, value) {
  const raw = JSON.stringify(value);
  storage().setItem(k, raw); // 容量不足・利用不可は呼び出し元に返す。「保存済み」と表示しない。
  if (storage().getItem(k) !== raw) throw new Error("DEVICE_SAVE_FAILED");
  announce();
  return copy(value);
}
export function readDeviceDraft(owner, id) {
  if (!owner || !id) return null;
  try {
    const value = JSON.parse(storage().getItem(key(owner, id)) || "null");
    return value?.owner === owner && value?.id === id ? value : null;
  } catch { return null; }
}
export function listDeviceDrafts(owner) {
  if (!owner) return [];
  try {
    return Object.keys(storage()).filter(k => k.startsWith(`${PREFIX}${owner}:`))
      .map(k => readDeviceDraft(owner, k.slice(`${PREFIX}${owner}:`.length))).filter(Boolean)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch { return []; }
}
export function newDeviceDraft(owner, row = null) {
  if (!owner) throw new Error("AUTH_REQUIRED");
  if (row && row.farmer_id !== owner) throw new Error("NOT_YOURS");
  return { owner, id: crypto.randomUUID(), jobId: row?.id || crypto.randomUUID(),
    jobNumber: row?.job_number || null, base: row, revision: null, form: null,
    payload: null, pending: null, state: "local", savedAt: Date.now() };
}
export function saveDeviceDraft(record, form, payload) {
  const current = readDeviceDraft(record.owner, record.id);
  // 別タブが書いたフォームは上書きしない。同期処理によるメタデータ更新は引き継ぐ。
  if (current && current.revision !== record.revision) throw new Error("DEVICE_DRAFT_CHANGED");
  if (current && JSON.stringify(current.form) === JSON.stringify(form) && JSON.stringify(current.payload) === JSON.stringify(payload)) return current;
  const next = { ...(current || record), form: copy(form), payload: copy(payload),
    revision: crypto.randomUUID(), savedAt: Date.now() };
  // 失敗（blocked/conflict）は終端ではない＝新しい入力があれば「未送信の入力」に戻す。
  // 競合の元スナップショットはconflictContextに保持し、入力を直しても上書き防止を維持する。
  if (next.state === "blocked" || next.state === "conflict") { next.state = "local"; next.pending = null; delete next.next; delete next.reason; delete next.rebased; }
  if (!next.pending && next.state === "synced") next.state = "local";
  return write(key(next.owner, next.id), next);
}
// 送信を予約する。通信の再送は同じ求人ID・同じリビジョンで行う。
// 競合が安全に解消できない場合は、入力を保持したまま送信を予約しない。
export function queueDeviceDraft(owner, id) {
  const record = readDeviceDraft(owner, id);
  if (!record?.payload) throw new Error("DEVICE_SAVE_FAILED");
  if (record.conflictContext && !record.pending) {
    const { remote, known } = record.conflictContext;
    const check = conflictCheck(record, remote, known);
    if (!check.safe) {
      record.state = "conflict"; record.reason = "conflict"; record.conflictReason = check.reason;
      return write(key(owner, id), record);
    }
    record.base = remote;
    record.jobNumber = remote.job_number;
  }
  if (["conflict", "blocked"].includes(record.state)) { record.pending = null; delete record.next; delete record.reason; delete record.rebased; }
  if (record.pending?.token === record.revision || record.next?.token === record.revision) return record;
  // 応答不明の送信内容を置き換えない。先の結果確認後、次に保存した内容を送る。
  const request = { token: record.revision, payload: copy(record.payload), base: record.base,
    open: record.base?.status === "open" };
  if (record.pending) record.next = request;
  else record.pending = request;
  record.state = "pending";
  return write(key(owner, id), record);
}
// 競合の比較元は成功するまで保持する。押し直しや別項目の入力で安全検査を外さない。
function conflictCheck(record, remote, known = true) {
  const base = record.conflictContext ? record.conflictContext.base : record.base;
  if (!known || !remote) return { safe: false, reason: "missing_remote" };
  if (remote.id !== record.jobId || remote.farmer_id !== record.owner) return { safe: false, reason: "wrong_identity" };
  if (!["draft", "pending"].includes(remote.status)) return { safe: false, reason: "not_editable" };
  if (!base) return { safe: draftPayloadMatches(remote, record.payload), reason: "unconfirmed_base" };
  return safeDraftRebase(base, remote, record.payload);
}
function rememberConflict(record, remote, known = true) {
  const base = record.conflictContext ? record.conflictContext.base
    : record.pending && Object.hasOwn(record.pending, "base") ? record.pending.base : record.base;
  const own = remote && remote.id === record.jobId && remote.farmer_id === record.owner;
  record.conflictContext = { base, remote: own ? remote : null, known: known && (remote === null || !!own) };
  record.state = "conflict";
  record.reason = "conflict";
  record.pending = null; delete record.next; delete record.rebased;
}
// 最新行を取得できても、他の変更を上書きする比較元の差し替えは許可しない。
export function rebaseDeviceDraft(owner, id, row) {
  const record = readDeviceDraft(owner, id);
  if (!record || record.state === "pending") return record;
  // 新規・未送信の下書きに限り、行が存在しない状態を維持できる。
  if (!row && !record.base && !record.conflictContext && !record.jobNumber) return record;
  const check = conflictCheck(record, row);
  if (!check.safe) {
    rememberConflict(record, row);
    record.conflictReason = check.reason;
    return write(key(owner, id), record);
  }
  if (record.conflictContext) record.conflictContext.remote = row;
  record.base = row;
  record.jobNumber = row.job_number;
  record.pending = null; delete record.next; delete record.reason; delete record.rebased;
  record.state = "local";
  return write(key(owner, id), record);
}
export function settleDeviceDraft(owner, id, token, result) {
  const record = readDeviceDraft(owner, id);
  if (record?.pending?.token !== token) return record;
  if (result.ok && (!result.row || result.row.id !== record.jobId || result.row.farmer_id !== owner)) {
    result = { ok: false, reason: "response_mismatch" };
  }
  if (result.ok) {
    delete record.conflictContext; delete record.conflictReason;
    record.base = result.row;
    record.jobId = result.row.id;
    record.jobNumber = result.row.job_number;
    record.pending = record.next ? { ...record.next, base: result.row } : null;
    delete record.next;
    record.state = record.pending ? "pending" : record.revision === token ? "synced" : "local";
    delete record.reason; delete record.rebased;
  } else {
    // 競合元は保存するが、新しい比較元として無条件に採用しない。
    // 応答紛失は同期側でpendingを維持し、ここには明確な拒否だけが届く。
    if (result.reason === "conflict") {
      rememberConflict(record, result.row, Object.hasOwn(result, "row"));
      if (record.conflictContext.remote) record.jobNumber = record.conflictContext.remote.job_number;
    } else {
      record.state = "blocked"; record.reason = result.reason || "save_failed";
      record.pending = null; delete record.next; delete record.rebased;
    }
  }
  return write(key(owner, id), record);
}
export function forkDeviceDraft(record) {
  const fresh = newDeviceDraft(record.owner);
  return saveDeviceDraft(fresh, { ...record.form, job_number: null }, record.payload);
}
export function removeDeviceDraft(owner, id) {
  storage().removeItem(key(owner, id));
  announce();
}
export function activeDeviceDraft(owner, id) {
  try {
    if (id !== undefined) {
      if (id) storage().setItem(ACTIVE + owner, id);
      else storage().removeItem(ACTIVE + owner);
    }
    return readDeviceDraft(owner, storage().getItem(ACTIVE + owner));
  } catch { return null; }
}
export function readPendingConsent(owner, version) {
  try {
    const record = JSON.parse(storage().getItem(CONSENT + owner) || "null");
    return record?.owner === owner && record?.version === version ? record : null;
  } catch { return null; }
}
export function queuePrivacyConsent(owner, version) {
  if (!owner || !version) throw new Error("AUTH_REQUIRED");
  const existing = readPendingConsent(owner, version);
  return write(CONSENT + owner, existing || { owner, version, agreedAt: new Date().toISOString() });
}
export function clearPendingConsent(owner, version) {
  if (readPendingConsent(owner, version)) { storage().removeItem(CONSENT + owner); announce(); }
}
