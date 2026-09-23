// Optional first-party product measurement. Never accept arbitrary properties or raw URLs.
export const ANALYTICS_VERSION = "2026-09-23";
export const ANALYTICS_CHOICE_KEY = "cb:analytics-choice:v1";
export const CHOICE_TTL_MS = 180 * 86400000;
export const SESSION_IDLE_MS = 30 * 60000;
export const ANALYTICS_SCREENS = ["search", "job", "apply", "publish", "profile", "schedule", "calendar", "chat", "login", "help", "privacy", "other"];
export const ANALYTICS_OPERATIONS = ["apply", "publish", "pdf"];
export const ANALYTICS_SOURCES = ["direct", "instagram", "qr", "line", "other"];

export function analyticsScreen(hash) {
  const path = String(hash || "").split("?")[0].replace(/^#?\/?/, "");
  if (/^(admin|boxes)(\/|$)/.test(path)) return null;
  if (/^work\/job\//.test(path)) return "job";
  if (/^profile\/(worker|employer)\/schedule\//.test(path)) return "schedule";
  if (/^work(\/|$)/.test(path)) return "publish";
  const first = path.split("/")[0];
  if (["chat", "chats"].includes(first)) return "chat";
  if (["login", "account"].includes(first)) return "login";
  if (["help", "install", "insurance"].includes(first)) return "help";
  if (["privacy", "terms", "charter"].includes(first)) return "privacy";
  if (["", "search", "saved", "visit", "qr"].includes(first)) return "search";
  return ANALYTICS_SCREENS.includes(first) ? first : "other";
}

export function analyticsSource(search) {
  const value = new URLSearchParams(search).get("src")?.toLowerCase();
  if (!value) return "direct";
  if (["insta", "instagram", "ig"].includes(value)) return "instagram";
  return ["qr", "line"].includes(value) ? value : "other";
}

export function createProductAnalytics({
  storage = () => window.localStorage, now = Date.now,
  makeId = () => crypto.randomUUID(), getHash = () => window.location.hash,
  getSearch = () => window.location.search,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let transport = null, excluded = true, session = null, queue = [], timer = null, lastPage = null;
  let epoch = 0, blocked = false;
  const subscribers = new Set(), pending = new Set();
  const choice = () => {
    if (blocked) return "denied";
    try {
      const value = JSON.parse(storage().getItem(ANALYTICS_CHOICE_KEY));
      if (value?.version !== ANALYTICS_VERSION || !["granted", "denied"].includes(value.choice)
        || !Number.isFinite(value.at) || value.at > now() || now() - value.at >= CHOICE_TTL_MS) return null;
      return value.choice;
    } catch { return null; }
  };
  const allowed = () => !excluded && transport && choice() === "granted";
  function reset() {
    epoch++;
    queue = []; session = null; lastPage = null;
    if (timer !== null) clearTimer(timer);
    timer = null;
    pending.forEach(controller => controller.abort());
    pending.clear();
  }
  function flush() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!allowed()) { reset(); return; }
    const rows = queue.splice(0, 20);
    if (!rows.length) return;
    const controller = new AbortController();
    pending.add(controller);
    // Measurement failure must never hold up, retry, or fail the user's operation.
    try { Promise.resolve(transport(rows, controller.signal)).catch(() => {}).finally(() => pending.delete(controller)); }
    catch { pending.delete(controller); }
    if (queue.length) timer = setTimer(flush, 2000);
  }
  function record(event, operationId = null, duration = null) {
    try {
      if (!allowed()) return false;
      const screen = analyticsScreen(getHash());
      if (!screen) return false;
      const at = now();
      if (!session || at - session.last >= SESSION_IDLE_MS) {
        session = { id: makeId(), seq: 0, last: at, source: analyticsSource(getSearch()) };
        lastPage = null;
      }
      if (session.seq >= 500 || queue.length >= 40) return false;
      session.last = at;
      queue.push({ session_id: session.id, sequence: ++session.seq, event, screen,
        source: session.source, operation_id: operationId, duration_bucket: duration,
        consent_version: ANALYTICS_VERSION,
        consent_at: new Date(JSON.parse(storage().getItem(ANALYTICS_CHOICE_KEY)).at).toISOString() });
      if (timer === null) timer = setTimer(flush, 2000);
      return true;
    } catch { return false; }
  }
  const page = () => {
    const screen = analyticsScreen(getHash());
    if (lastPage === screen && session && now() - session.last < SESSION_IDLE_MS) return;
    if (record("page_view")) lastPage = screen;
  };
  return {
    choice,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    configure(send, exclude = false) {
      reset(); transport = send; excluded = exclude;
      // The old, persistent visitor identifier and unrestricted campaign text are retired.
      try { storage().removeItem("cb_anonKey"); storage().removeItem("cb_src"); } catch { /* unavailable storage means no consent */ }
      page();
    },
    choose(value) {
      if (!["granted", "denied"].includes(value)) return false;
      reset();
      try { storage().setItem(ANALYTICS_CHOICE_KEY, JSON.stringify({ version: ANALYTICS_VERSION, choice: value, at: now() })); }
      catch { blocked = true; subscribers.forEach(fn => fn()); return false; }
      blocked = false;
      subscribers.forEach(fn => fn());
      if (value === "granted") page();
      return true;
    },
    refresh() { reset(); subscribers.forEach(fn => fn()); page(); },
    stop() { reset(); transport = null; excluded = true; },
    page, flush,
    begin(operation) {
      if (!ANALYTICS_OPERATIONS.includes(operation) || !allowed()) return () => {};
      let id;
      try { id = makeId(); } catch { return () => {}; }
      const started = now(), generation = epoch;
      if (!record(operation + "_start", id)) return () => {};
      let finished = false;
      return outcome => {
        if (finished || generation !== epoch || !["success", "failure"].includes(outcome)) return;
        finished = true;
        const duration = now() - started;
        record(operation + "_" + outcome, id, duration < 1000 ? "lt1s" : duration < 5000 ? "1to5s" : duration < 20000 ? "5to20s" : "over20s");
      };
    },
  };
}

export const productAnalytics = createProductAnalytics();

export async function measureApplicationRequest(run) {
  const finish = productAnalytics.begin("apply");
  try {
    const result = await run();
    finish(!result.error && (result.data?.ok || result.data?.reason === "already_applied") ? "success" : "failure");
    return result;
  } catch (error) { finish("failure"); throw error; }
}
