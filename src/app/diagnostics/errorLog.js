// ── エラー監視ユーティリティ ──────────────────────────────────
// 第2次構造改革（2026-08-17）でApp.jsxから移設。2026-09-28に連発の間引きを追加。
// ★app_errors への記録はプラポリ第3条データ台帳「エラーの記録」の行に対応（保存1年・
//   purge_old_app_errors が毎日掃除）。記録する項目を増やすときは台帳の改訂が要る。
import { supabase } from "../../lib/supabase";
import { rememberSupportFailure } from "../../lib/supportDiagnostics";
import { makeErrorThrottle, MAX_PER_MESSAGE } from "./errorThrottle";

// 連発の間引き（2026-09-28・Script error 18,200行/15分の教訓・詳細は errorThrottle.js）。
// rememberSupportFailure（端末内の診断メモ）は間引きの前＝手元の診断は全件見える
const admitError = makeErrorThrottle();

export function getSessionId() {
  try {
    let sid = localStorage.getItem("cb_session_id");
    if (!sid) { sid = crypto.randomUUID(); localStorage.setItem("cb_session_id", sid); }
    return sid;
  } catch { return "no-storage-" + Math.random().toString(36).slice(2); }
}

export function sanitizeMessage(msg = "") {
  return String(msg).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, "[phone]").slice(0, 1000);
}

export async function logAppError({ level = "error", source = "client", page = "", component = "", action = "", operation = "", error, metadata = {}, userId = null }) {
  rememberSupportFailure({ source, action, operation, error });
  try {
    const message = sanitizeMessage(error?.message || String(error || ""));
    const gate = admitError(message);
    if (!gate.ok) return;   // 同じ文言の連発＝この読み込みでは以後書かない（DBを守る）
    await supabase.from("app_errors").insert({
      session_id: getSessionId(), user_id: userId, level, source, page, component, action, operation,
      error_code: error?.code || error?.status || null,
      message,
      stack: sanitizeMessage(error?.stack || ""),
      url: window.location.href, user_agent: navigator.userAgent,
      // 枠を使い切る1件に印＝運営が「以後は間引かれている」と分かる
      metadata: gate.last ? { ...metadata, throttled_after: MAX_PER_MESSAGE } : metadata,
    });
  } catch (e) { console.warn("error logging failed", e); }
}
