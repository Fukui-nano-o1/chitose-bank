import { rpcOutageKind } from "./rpcOutage.js";

// 書き込みの返答が途切れても、保存済みかもしれない。移動要求は再送せず、
// 既存の本人用カレンダーを読み直して移動先を照合する。
export async function moveCalendarJob(client, jobNumber, newStart, {
  onVerifying = () => {},
  report = detail => console.warn("[calendar:move]", detail),
  verifyTimeoutMs = 6000,
} = {}) {
  const startedAt = Date.now();
  let result;
  try {
    result = await client.rpc("move_job_dates", { p_job_number: jobNumber, p_new_start: newStart });
  } catch (error) {
    result = { data: null, error, status: 0 };
  }
  if (result.data?.ok && !result.error) return result;
  const outage = rpcOutageKind(result.error, result.status);
  if (!outage) return result;

  // 個人情報・求人の内容・認証情報は記録しない。端末の期限切れとその他の通信失敗を区別する。
  report({ at: new Date().toISOString(), phase: "write", status: result.status,
    kind: /deadline exceeded/i.test(result.error?.message || "") ? "client_timeout" : outage,
    elapsedMs: Date.now() - startedAt });
  onVerifying();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), verifyTimeoutMs);
  try {
    const verified = await client.rpc("get_my_calendar_jobs").abortSignal(controller.signal);
    if (!verified.error && Array.isArray(verified.data)) {
      const current = verified.data.find(row => row.relation === "own" && row.job_number === jobNumber);
      const confirmed = current?.date_start === newStart;
      report({ at: new Date().toISOString(), phase: "verify", status: verified.status,
        confirmed, elapsedMs: Date.now() - startedAt });
      return {
        ...(confirmed ? { data: { ok: true, recovered: true }, error: null, status: 200 } : result),
        calendarEntries: verified.data,
      };
    }
    report({ at: new Date().toISOString(), phase: "verify", status: verified.status,
      confirmed: false, elapsedMs: Date.now() - startedAt });
  } catch {
    report({ at: new Date().toISOString(), phase: "verify", status: 0,
      confirmed: false, elapsedMs: Date.now() - startedAt });
  } finally {
    clearTimeout(timer);
  }
  return result;
}
