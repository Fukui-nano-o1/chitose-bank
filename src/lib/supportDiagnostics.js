// Support context stays in memory until the user chooses to attach it to a report.
// Never collect inputs, raw errors, URLs, account IDs, tokens, or chat contents here.
/* global __APP_BUILD__ */
const ROOT_ROUTES = new Set(["search", "saved", "login", "help", "install", "insurance", "experience", "new-applicants", "profile", "calendar", "work", "chat", "chats", "apply", "admin", "boxes", "privacy", "terms", "charter", "visit", "qr"]);
const STATIC_ROUTES = new Set([
  "work/new", "work/job", "work/edit", "work/drafts", "apply/done",
  "profile/worker", "profile/employer", "profile/worker/schedule", "profile/employer/schedule",
  "help/about", "help/farmer", "help/worker", "help/mails", "help/info", "help/faq",
  "admin/review", "admin/consignment", "admin/working", "admin/upcoming", "admin/evaluation",
  "admin/system", "admin/review-comments", "admin/analytics", "admin/reports", "admin/farmer-pages", "admin/animations", "admin/timeless",
]);
const SOURCES = new Set(["client", "window.onerror", "unhandledrejection", "error_boundary"]);
const OPERATIONS = new Set(["runtime_error", "promise_rejection", "render_error", "privacy_consent", "auth.signInWithOtp", "auth.signInWithPassword", "auth.verifyOtp", "auth.updateUser", "auth.profile", "auth.action", "apply", "publish", "pdf", "calendar_move"]);
const CODES = new Set(["unknown", "AbortError", "TimeoutError", "TypeError", "ReferenceError", "SyntaxError", "NetworkError", "AuthRetryableFetchError", "invalid_credentials", "otp_expired", "over_email_send_rate_limit", "over_request_rate_limit", "email_not_confirmed", "signup_disabled", "unexpected_failure", "request_timeout", "REQUEST_TIMEOUT", "23505", "42501", "57014", "PGRST301"]);

export function sanitizeSupportPath(raw = "") {
  const path = String(raw).replace(/^#?\/?/, "").split(/[?&#]/)[0];
  if (!raw || raw === "#" || raw === "#/" || raw === "/") return "#/search";
  const segments = path.split("/");
  if (!ROOT_ROUTES.has(segments[0])) return "#/other";
  // Only known static segments survive. IDs and all query/fragment values are omitted.
  for (let length = Math.min(3, segments.length); length > 1; length--) {
    const route = segments.slice(0, length).join("/");
    if (STATIC_ROUTES.has(route)) return "#/" + route;
  }
  return "#/" + segments[0];
}

function safeCode(error) {
  for (const value of [error?.code, error?.status, error?.name]) {
    const code = String(value || "");
    if (CODES.has(code) || /^[45]\d{2}$/.test(code)) return code;
  }
  return "unknown";
}

export function sanitizeSupportFailure(event = {}, at = Date.now()) {
  return {
    at: new Date(at).toISOString(),
    source: SOURCES.has(event.source) ? event.source : "client",
    operation: OPERATIONS.has(event.operation) ? event.operation : OPERATIONS.has(event.action) ? event.action : "unknown",
    code: safeCode(event.error),
  };
}

const failures = [];
export function rememberSupportFailure(event) {
  try {
    failures.push(sanitizeSupportFailure(event));
    if (failures.length > 10) failures.splice(0, failures.length - 10);
  } catch { /* Diagnostics must never interrupt the original operation. */ }
}
export function clearSupportDiagnostics() { failures.length = 0; }

function currentBuildId() {
  try {
    if (typeof __APP_BUILD__ === "string") return __APP_BUILD__;
    const script = document.querySelector('script[type="module"][src]');
    return new URL(script?.src || "").pathname.match(/\/assets\/index-([A-Za-z0-9_-]{6,64})\.js$/)?.[1] || null;
  } catch { return null; }
}

export function captureSupportContext() {
  const now = Date.now();
  return {
    page_hash: sanitizeSupportPath(typeof window === "undefined" ? "" : window.location.hash),
    captured_at: new Date(now).toISOString(),
    viewport: typeof window === "undefined" ? null : { width: window.innerWidth, height: window.innerHeight },
    build_id: currentBuildId(),
    online: typeof navigator === "undefined" ? null : navigator.onLine,
    // A previous problem should not be attached to an unrelated report hours later.
    recent_errors: failures.filter(item => now - Date.parse(item.at) < 30 * 60 * 1000).map(item => ({ ...item })),
  };
}

export function openSupport(request = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cb:open-support", { detail: {
    topic: request.topic, view: request.view || (request.topic ? "guide" : "home"), context: captureSupportContext(),
  } }));
}
