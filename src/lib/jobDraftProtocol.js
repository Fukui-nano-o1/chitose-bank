// 送信可能な項目と、DBの楽観ロックに渡す比較用スナップショットを分ける。
// draft_step_id は現行DBの比較対象だが、この画面が編集する値ではない。
import { JOB_DRAFT_FIELDS } from "./jobInputFields.js";
export { JOB_DRAFT_FIELDS };

export function jobDraftPatch(payload) {
  return Object.fromEntries(JOB_DRAFT_FIELDS.filter(k => Object.hasOwn(payload, k)).map(k => [k, payload[k]]));
}
export function jobDraftBase(row) {
  if (!row) return null;
  return { ...jobDraftPatch(row),
    // 未取得の列を推測して埋めない。古い下書きは現在行の取得後に再比較する。
    ...(Object.hasOwn(row, "draft_step_id") ? { draft_step_id: row.draft_step_id } : {}),
    status: row.status };
}

// jsonb と同様、オブジェクトのキー順は無視する。配列の順番・型・nullは区別する。
export function equalDraftValue(left, right) {
  if (left === right) return true;
  if (left == null || right == null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) return left.length === right.length && left.every((value, i) => equalDraftValue(value, right[i]));
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalDraftValue(left[key], right[key]));
}
function equalField(key, left, right) {
  return equalDraftValue(left ?? null, right ?? null);
}
export function draftPayloadMatches(remote, payload) {
  const keys = JOB_DRAFT_FIELDS.filter(key => Object.hasOwn(payload || {}, key));
  return !!remote && keys.length > 0 && keys.every(key => Object.hasOwn(remote, key) && equalField(key, remote[key], payload[key]));
}
// 安全を証明できる場合だけ再比較を許す。リモートだけの変更を含む全置換は許可しない。
// 非重複項目の自動マージはここでは行わず、元の入力を保持したまま確認を求める。
export function safeDraftRebase(base, remote, payload) {
  if (!remote?.id || !base?.id || !base.farmer_id || base.id !== remote.id || base.farmer_id !== remote.farmer_id)
    return { safe: false, reason: "missing_base_or_remote" };
  if (!["draft", "pending"].includes(base.status) || !["draft", "pending"].includes(remote.status))
    return { safe: false, reason: "not_editable" };
  const fields = JOB_DRAFT_FIELDS.filter(key => Object.hasOwn(payload || {}, key) &&
    !equalField(key, base[key], remote[key]) && !equalField(key, remote[key], payload[key]));
  return { safe: fields.length === 0, reason: fields.length ? "overlapping_edits" : "safe", fields };
}
