// プッシュ通知（Web Push・2026-07-19）───────────────────────────
// 分割3-B（2026-07-25）：App.jsx冒頭から移動。ChatList（通知オンバナー）とApp（バッジ・iOS判定）が共用する。
// iOSは「ホーム画面に追加したPWA（standalone）」のみ対応。Safariタブでは購読不可。
import { supabase } from "./supabase";

export const isStandalone = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent);
const b64urlToUint8 = (b64) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};
// アプリアイコンのバッジ（赤い数字・2026-07-19）：未読数を反映。iOS16.4+のPWA/Android/PCで動作
export function syncAppBadge(n) {
  try {
    if ("setAppBadge" in navigator) {
      if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge();
    }
  } catch {}
}
// 現在の通知状態を返す：'unsupported' | 'need-standalone' | 'default' | 'denied' | 'granted'
export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  if (isIOS() && !isStandalone()) return "need-standalone"; // iOSはホーム画面追加が前提
  const perm = Notification.permission;
  if (perm === "granted") {
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); return sub ? "granted" : "default"; } catch { return "default"; }
  }
  return perm; // 'default' | 'denied'
}
// 通知をオンにする：許可要求→購読→DB保存。戻り値 {ok, reason}
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (isIOS() && !isStandalone()) return { ok: false, reason: "need-standalone" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: perm };
  try {
    const { data: vapid } = await supabase.rpc("push_vapid_public");
    if (!vapid) return { ok: false, reason: "no_key" };
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToUint8(vapid) });
    const j = sub.toJSON();
    const { data, error } = await supabase.rpc("save_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error || !data?.ok) return { ok: false, reason: data?.reason || error?.message || "save_failed" };
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}
