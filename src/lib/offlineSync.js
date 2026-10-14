import { listDeviceDrafts, settleDeviceDraft, readPendingConsent, clearPendingConsent } from "./deviceDrafts.js";
import { savePrivacyConsent } from "./privacyConsent.js";
import { rpcOutageKind } from "./rpcOutage.js";

import { jobDraftPatch, jobDraftBase } from "./jobDraftProtocol.js";
export { JOB_DRAFT_FIELDS, jobDraftPatch, jobDraftBase, safeDraftRebase } from "./jobDraftProtocol.js";

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
      // conflict にDBが現在の行（本人の行だけ・無ければ null）を添えて返す（20260923070439）＝
      // 端末側が比較元を取り直し、次の明示の操作で送り直せる。row の無い古い応答は従来どおり
      const failure = { ok: false, reason: result.data?.reason || "not_confirmed" };
      if (failure.reason === "conflict" && result.data && Object.hasOwn(result.data, "row")) failure.row = result.data.row;
      settleDeviceDraft(owner, record.id, pending.token, failure);
    }
  }
  return finish({ retry: listDeviceDrafts(owner).some(d => d.pending && d.state === "pending") });
}
