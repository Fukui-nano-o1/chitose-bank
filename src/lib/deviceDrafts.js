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
  // conflict は settle の時点で比較元(base)をDBの行に取り直してあるので、次の明示の操作（掲載する／保存）で
  // いまの内容を送り直せる（2026-09-23・DRAFT_REQUIRES_REVIEW で詰まる型の根治）
  if (next.state === "blocked" || next.state === "conflict") { next.state = "local"; next.pending = null; delete next.next; delete next.reason; delete next.rebased; }
  if (!next.pending && next.state === "synced") next.state = "local";
  return write(key(next.owner, next.id), next);
}
// 送信を予約する。conflict/blocked の記録でも例外にしない（利用者の明示の操作＝いまの内容で送り直す）。
// ★失敗した古い送信内容（pending/next）は捨てる＝同じ比較元でもう一度ぶつけて同じ失敗を繰り返さない
export function queueDeviceDraft(owner, id) {
  const record = readDeviceDraft(owner, id);
  if (!record?.payload) throw new Error("DEVICE_SAVE_FAILED");
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
// 比較元(base)をDBの行に取り直す（行が無ければ「新規」に戻す＝同じUUIDで作り直せる）。
// 送信中（pending）の記録には触らない＝応答が来た時の照合を壊さない
export function rebaseDeviceDraft(owner, id, row) {
  const record = readDeviceDraft(owner, id);
  if (!record || record.state === "pending") return record;
  record.base = row || null;
  record.jobId = row?.id || record.jobId;
  record.jobNumber = row?.job_number || null;
  record.pending = null; delete record.next; delete record.reason; delete record.rebased;
  record.state = "local";
  return write(key(owner, id), record);
}
export function settleDeviceDraft(owner, id, token, result) {
  const record = readDeviceDraft(owner, id);
  if (record?.pending?.token !== token) return record;
  if (result.ok) {
    record.base = result.row;
    record.jobId = result.row.id;
    record.jobNumber = result.row.job_number;
    record.pending = record.next ? { ...record.next, base: result.row } : null;
    delete record.next;
    record.state = record.pending ? "pending" : record.revision === token ? "synced" : "local";
    delete record.reason; delete record.rebased;
  } else {
    // 失敗した送信内容は捨てる（自動では再送しない）。入力(form/payload)はこの端末に残る。
    record.state = result.reason === "conflict" ? "conflict" : "blocked";
    record.reason = result.reason || "save_failed";
    record.pending = null; delete record.next;
    // conflict でDBが現在の行を添えて返した時は比較元を取り直す（行が無い＝削除済みなら新規に戻す）。
    // これで次の明示の操作（掲載する／保存）が、いまの内容で保存し直せる
    if (result.reason === "conflict" && Object.hasOwn(result, "row")) {
      const row = result.row && result.row.farmer_id === owner ? result.row : null;
      record.base = row;
      record.jobId = row?.id || record.jobId;
      record.jobNumber = row?.job_number || null;
      record.rebased = true;
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
