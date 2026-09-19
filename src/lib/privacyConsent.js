import { rpcOutageKind } from "./rpcOutage.js";

// 本人の同意版数だけを返し、更新対象が0件だった場合も成功扱いにしない。
// 応答が途切れた場合は書き込みを再送せず、本人の保存結果を1回だけ照合する。
export async function savePrivacyConsent(client, authId, version, {
  onVerifying = () => {},
  report = detail => console.warn("[privacy:consent]", detail),
  verifyTimeoutMs = 6000,
} = {}) {
  if (!authId) return { ok: false, status: 401, error: { code: "AUTH_REQUIRED" } };
  const startedAt = Date.now();
  const confirmed = result => !result.error && result.data?.agreed_privacy_version === version;
  const diagnose = (phase, result) => {
    // 氏名・住所・認証情報・DBからの生のエラー本文は記録しない。
    try {
      report({ at: new Date().toISOString(), phase, status: result.status ?? 0,
        code: String(result.error?.code || "").replace(/[^a-z0-9_]/gi, "").slice(0, 40),
        confirmed: confirmed(result), elapsedMs: Date.now() - startedAt });
    } catch {}
  };
  let result;
  try {
    result = await client.from("account_holders")
      .update({ agreed_privacy_version: version })
      .eq("auth_id", authId)
      .select("agreed_privacy_version")
      .maybeSingle()
      .retry(false);
  } catch (error) {
    result = { error, status: 0 };
  }
  if (confirmed(result)) return { ...result, ok: true };
  if (!result.error) result = { ...result, error: { code: "CONSENT_NOT_CONFIRMED" } };
  diagnose("save", result);
  if (rpcOutageKind(result.error, result.status) !== "noResponse") return { ...result, ok: false };

  onVerifying();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), verifyTimeoutMs);
  try {
    const verified = await client.from("account_holders")
      .select("agreed_privacy_version")
      .eq("auth_id", authId)
      .maybeSingle()
      .abortSignal(controller.signal)
      .retry(false);
    diagnose("verify", verified);
    if (confirmed(verified)) return { ...verified, ok: true, recovered: true };
  } catch (error) {
    diagnose("verify", { error, status: 0 });
  } finally {
    clearTimeout(timer);
  }
  return { ...result, ok: false };
}

export function privacyConsentErrorMessage(error, status) {
  const code = String(error?.code || "");
  if (status === 401 || code === "AUTH_REQUIRED" || ["PGRST301", "PGRST302", "PGRST303"].includes(code)) {
    return "ログインを確認できませんでした。画面を再読み込みして、もう一度お試しください。";
  }
  if (status === 403 || code === "42501") {
    return "同意を保存する権限を確認できませんでした。解消しない場合は運営へお問い合わせください。";
  }
  const outage = rpcOutageKind(error, status);
  if (outage === "down") {
    return "サーバーが一時的に応答していません。同意の保存を確認できませんでした。少し待ってから、もう一度お試しください。";
  }
  if (outage === "noResponse") {
    return "サーバーからの応答が届かず、同意の保存を確認できませんでした。少し待ってから、もう一度お試しください。";
  }
  return "同意の保存を確認できませんでした。もう一度お試しいただき、解消しない場合は運営へお問い合わせください。";
}
