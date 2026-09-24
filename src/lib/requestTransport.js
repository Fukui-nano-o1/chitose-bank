// Supabase RESTへの突入を抑える。利用者全体ではなく、このクライアント1つの上限。
// 読み込みは3本・全体は4本。保存用に1枠を空け、認証・Storageはこの行列に入れない。
// 読み取りRPCもPOSTなので明示する。未知のRPCは操作側として扱い、再送・統合はしない。
const READ_RPCS = new Set([
  "admin_list_accounts", "admin_list_contracts", "admin_preview_job", "admin_review_comments", "admin_product_analytics",
  "admin_worker_list", "admin_working_jobs", "am_i_account_allowed", "consignment_summary",
  "contract_emergency_contact", "contract_party_name", "employer_public_job_counts",
  "employer_public_jobs", "employer_public_jobs_by_farmer", "employer_trust_info",
  "get_minimum_wage", "get_my_calendar_jobs", "is_account_moderated", "is_worker_profile_ready",
  "job_details_for_party", "job_employer_profile", "job_employer_reviews", "job_employer_trust_info",
  "job_exists", "job_meeting_place", "my_chat_partner_initials", "my_chat_inbox_previews", "my_farm_applicants",
  "my_farm_jobs", "my_job_actions", "my_nav_badges", "my_todo_items", "my_unread_message_counts",
  "my_worker_trust_stats", "pending_job_previews", "push_vapid_public", "reviews_public_badges",
  "signup_open", "worker_cards_for_farmer", "worker_profile_for_farmer", "worker_trust_info",
  "worker_want_again_count", "worker_work_record",
]);

function abortError(message = "Request was aborted") {
  return new DOMException(message, "AbortError");
}

export function createSupabaseFetch({
  supabaseUrl,
  fetchImpl = (...args) => fetch(...args),
  maxConcurrent = 4,
  maxReads = 3,
  maxQueued = 64,
  timeoutMs = 15000,
} = {}) {
  const base = new URL(supabaseUrl);
  const restPath = base.pathname.replace(/\/$/, "") + "/rest/v1/";
  const authPath = base.pathname.replace(/\/$/, "") + "/auth/v1/";
  const queue = [];
  let active = 0, reads = 0;

  function pump() {
    while (active < maxConcurrent) {
      // 操作を先に送る。同じ種類の中では到着順を保つ。
      let index = queue.findIndex(item => !item.read);
      if (index < 0 && reads < maxReads) index = queue.findIndex(item => item.read);
      if (index < 0) return;
      const item = queue.splice(index, 1)[0];
      item.signal.removeEventListener("abort", item.cancel);
      if (item.signal.aborted) { item.reject(abortError()); continue; }
      active++; if (item.read) reads++;
      item.resolve(() => {
        active--; if (item.read) reads--;
        pump();
      });
    }
  }

  function acquire(read, signal) {
    if (signal.aborted) return Promise.reject(abortError());
    const canStart = active < maxConcurrent && (!read || reads < maxReads);
    if (!canStart && queue.length >= maxQueued) return Promise.reject(abortError("Request queue is full; request was not sent"));
    return new Promise((resolve, reject) => {
      const item = { read, signal, resolve, reject };
      item.cancel = () => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        signal.removeEventListener("abort", item.cancel);
        reject(abortError());
      };
      signal.addEventListener("abort", item.cancel, { once: true });
      queue.push(item); pump();
    });
  }

  return async function managedFetch(input, options = {}) {
    let url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); } catch {}
    const auth = url?.origin === base.origin && url.pathname.startsWith(authPath);
    if (!url || url.origin !== base.origin || (!auth && !url.pathname.startsWith(restPath))) {
      // 画像アップロード等は従来のストリームと呼び出し元のsignalを維持する。
      const signal = options.signal || input?.signal;
      if (!signal && typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
        return fetchImpl(input, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      }
      return fetchImpl(input, options);
    }

    const method = (options.method || input?.method || "GET").toUpperCase();
    const rpc = url.pathname.slice(restPath.length);
    // Optional telemetry uses the read/background budget, never the reserved action slot.
    // Dropping a measurement is preferable to delaying an application or a save.
    const telemetry = method === "POST" && rpc === "product_events";
    const deadlineMs = telemetry ? Math.min(timeoutMs, 2000) : timeoutMs;
    const read = telemetry || ["GET", "HEAD", "OPTIONS"].includes(method)
      || (method === "POST" && rpc.startsWith("rpc/") && READ_RPCS.has(rpc.slice(4)));
    const controller = new AbortController();
    const callerSignal = options.signal || input?.signal;
    // AbortSignal.timeoutのTimeoutErrorはSDKが通信失敗と見て最大3回再試行する。
    // 意図的な期限切れはAbortErrorにする。待機時間と応答本文の受信も同じ15秒に含める。
    const cancel = () => controller.abort();
    if (callerSignal?.aborted) cancel();
    else callerSignal?.addEventListener("abort", cancel, { once: true });
    let expired = false, sent = false;
    const timer = setTimeout(() => { expired = true; cancel(); }, deadlineMs);
    let release;
    try {
      // 認証はRESTの混雑に並ばない。ただし既存signalの有無にかかわらず本文受信まで期限を守る。
      if (!auth) release = await acquire(read, controller.signal);
      if (controller.signal.aborted) throw abortError();
      sent = true;
      const response = await fetchImpl(input, { ...options, signal: controller.signal });
      // REST・AuthはSDKも本文全体を読んでから結果を返す。ここで受信まで待ち、ヘッダーだけ
      // 届く通信も上限と期限の内側に置く。Storage等のストリームは上の直通経路。
      // body が空のストリームになるブラウザーでも、HEAD・204等には本文を渡せない。
      // 空のArrayBufferで作り直すと、保存成功の応答までTypeErrorになってしまう。
      const noBody = method === "HEAD" || [204, 205, 304].includes(response.status);
      const body = noBody || response.body === null ? null : await response.arrayBuffer();
      if (controller.signal.aborted) throw abortError();
      const result = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      for (const key of ["url", "redirected", "type"]) Object.defineProperty(result, key, { value: response[key] });
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw abortError(expired
        ? `Request deadline exceeded ${sent ? "after sending" : "before sending"} (${deadlineMs}ms)`
        : "Request was aborted");
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", cancel);
      release?.();
    }
  };
}
