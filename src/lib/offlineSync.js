import { listDeviceDrafts, settleDeviceDraft, readPendingConsent, clearPendingConsent } from "./deviceDrafts.js";
import { savePrivacyConsent } from "./privacyConsent.js";
import { rpcOutageKind } from "./rpcOutage.js";

// DBの比較に使うのは編集可能な列と状態。運営・凍結列はクライアントから書き換えない。
export const JOB_DRAFT_FIELDS = ["crop", "task", "zip", "prefecture", "city", "town", "address",
  "date_label", "date_start", "date_end", "holidays", "headcount", "pay_type", "hourly_wage", "daily_wage",
  "work_time", "break_time", "nearest_station", "commute_time", "job_exp", "beginner_ok", "instant_approve_repeat",
  "perks", "experienced_preferred", "notes", "belongings", "cautions", "overtime_policy", "overtime_detail",
  "place_change_scope", "task_change_scope", "danger_places", "danger_tasks", "photos", "draft_step",
  "lat", "lng", "geo_radius_m", "geocoded_from"];
export function jobDraftPatch(payload) {
  return Object.fromEntries(JOB_DRAFT_FIELDS.filter(k => Object.hasOwn(payload, k)).map(k => [k, payload[k]]));
}
export function jobDraftBase(row) { return row ? { ...jobDraftPatch(row), status: row.status } : null; }
export const retryable = result => !!rpcOutageKind(result.error, result.status) || result.status === 429;

// 1ページ内は1本。複数タブ/応答紛失はDB側の同一ID・行ロック・内容照合で安全に扱う。
const flights = new Map();
export function syncDeviceWork(client, owner, version, { onConsent = () => {}, onSaved = () => {} } = {}) {
  if (!owner) return Promise.resolve({});
  const flightKey = `${owner}:${version}`;
  let flight = flights.get(flightKey);
  if (!flight) {
    flight = run(client, owner, version).finally(() => flights.delete(flightKey));
    flights.set(flightKey, flight);
  }
  return flight.then(result => {
    if (result.consentConfirmed) onConsent();
    for (const row of result.savedRows || []) onSaved(row);
    return result;
  });
}

async function run(client, owner, version) {
  const outcome = { savedRows: [], consentConfirmed: false };
  const finish = value => ({ ...outcome, ...value });
  if (!readPendingConsent(owner, version) && !listDeviceDrafts(owner).some(d => d.state === "pending" && d.pending)) return finish({});
  if (globalThis.navigator?.onLine === false) return finish({ retry: true });
  const session = await client.auth.getSession();
  if (session.error || session.data?.session?.user?.id !== owner) return finish({ authRequired: true });
  const consent = readPendingConsent(owner, version);
  if (consent) {
    const result = await savePrivacyConsent(client, owner, version);
    if (!result.ok) return finish({ retry: retryable(result), consentError: result });
    clearPendingConsent(owner, version);
    outcome.consentConfirmed = true;
  }
  const drafts = listDeviceDrafts(owner).filter(d => d.pending && d.state === "pending");
  if (!drafts.length) return finish({});
  // 画面の仮同意で送信しない。現在のセッション・サーバーに記録された版数を確認する。
  const agreed = await client.from("account_holders").select("agreed_privacy_version")
    .eq("auth_id", owner).maybeSingle().retry(false);
  if (agreed.error) return finish({ retry: retryable(agreed) });
  if (agreed.data?.agreed_privacy_version !== version) return finish({ consentRequired: true });
  for (const record of drafts) {
    // ログアウト/別アカウント切替後の再送を防ぐ。DBの本人条件も維持する。
    const current = await client.auth.getSession();
    if (current.data?.session?.user?.id !== owner) return finish({ authRequired: true });
    const pending = record.pending;
    let result;
    try {
      result = await client.rpc(pending.open ? "sync_my_open_job" : "sync_my_job_draft", {
        p_owner: owner, p_id: record.jobId, p_expected: jobDraftBase(pending.base), p_patch: jobDraftPatch(pending.payload),
      }).retry(false);
    } catch (error) { result = { error, status: 0 }; }
    if (result.error) {
      if (retryable(result)) return finish({ retry: true });
      if (result.status === 401) return finish({ authRequired: true });
      settleDeviceDraft(owner, record.id, pending.token, { ok: false, reason: result.error.code || "save_failed" });
    } else if (result.data?.ok && result.data.row?.farmer_id === owner && result.data.row?.id === record.jobId) {
      settleDeviceDraft(owner, record.id, pending.token, result.data);
      outcome.savedRows.push(result.data.row);
    } else if (result.data?.reason === "not_logged_in") {
      return finish({ authRequired: true });
    } else {
      settleDeviceDraft(owner, record.id, pending.token, { ok: false, reason: result.data?.reason || "not_confirmed" });
    }
  }
  return finish({ retry: listDeviceDrafts(owner).some(d => d.pending && d.state === "pending") });
}
