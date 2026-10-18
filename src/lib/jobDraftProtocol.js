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
// DBのtimestamptzはUTC/JST・小数秒の表記が変わる。Dateだけで比較すると
// マイクロ秒を丸め、別の同意時刻まで同じと誤認するため、小数6桁を保持する。
// 日付だけ・時差なし・不正日付は推測しない。他の入力項目には適用しない。
function consentInstant(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(value);
  if (!match || match[1].startsWith("0000")) return null;
  const [, date, time, fraction = "", zone, sign, hour = "0", minute = "0"] = match;
  const whole = `${date}T${time}`;
  const milliseconds = Date.parse(`${whole}Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== whole ||
      Number(hour) > 15 || Number(minute) > 59) return null;
  const offset = zone === "Z" ? 0 : (Number(hour) * 60 + Number(minute)) * (sign === "+" ? 1 : -1);
  return BigInt(milliseconds - offset * 60000) * 1000n + BigInt(fraction.padEnd(6, "0"));
}
function equalField(key, left, right) {
  if (equalDraftValue(left ?? null, right ?? null)) return true;
  if (key !== "work_video_consent_at") return false;
  const instant = consentInstant(left);
  return instant !== null && instant === consentInstant(right);
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
