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
// 失敗の記録（2026-08-17たきと報告「通知をオンにできませんでした」）：
// 従来は理由that呼び出し側の汎用alertに畳まれ、何that起きたのか誰にも分からなかった
// （day4の教訓「catchthat全エラーを握りつぶす→まずコードに喋らせる」）。
// どの段階で落ちたかを app_errors に残す＝システムページで運営that見られる。記録の失敗は無視する
const logPushFail = (step, reason) => {
  try {
    supabase.from("app_errors").insert({
      level: "error", source: "client", component: "push", action: "enable_push",
      operation: step, message: String(reason || "").slice(0, 500),
      url: window.location.href, user_agent: navigator.userAgent,
      metadata: { standalone: isStandalone(), ios: isIOS(), permission: (window.Notification && Notification.permission) || null },
    }).then(() => {}, () => {});
  } catch {}
};
// サービスワーカーの準備待ち。iOSでは稀に永久に解決しないso待ち時間で打ち切る
// （打ち切らないとボタンthat「…」のまま戻らない）
const swReady = (ms) => Promise.race([
  navigator.serviceWorker.ready,
  new Promise(resolve => setTimeout(() => resolve(null), ms)),
]);
// 既存の購読that今の鍵で作られたものか。options.applicationServerKey を出さない環境では判定せず true 扱い
const sameServerKey = (sub, key) => {
  try {
    const cur = sub?.options?.applicationServerKey;
    if (!cur) return true;
    const a = new Uint8Array(cur);
    if (a.length !== key.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== key[i]) return false;
    return true;
  } catch { return true; }
};
// 通知をオンにする：許可要求→購読→DB保存。戻り値 {ok, reason}
// reason は呼び出し側thatそのまま画面に出せる文字列（原因の切り分けに使う）
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (isIOS() && !isStandalone()) return { ok: false, reason: "need-standalone" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: perm };
  let step = "start";
  const fail = (reason) => { logPushFail(step, reason); return { ok: false, reason: String(reason) }; };
  try {
    step = "vapid";
    const { data: vapid, error: vErr } = await supabase.rpc("push_vapid_public");
    if (vErr || !vapid) return fail(vErr?.message || "no_key");
    const key = b64urlToUint8(vapid);
    step = "sw_ready";
    const reg = await swReady(10000);
    if (!reg) return fail("sw_timeout");
    if (!reg.pushManager) return fail("no_push_manager");
    step = "subscribe";
    let sub = await reg.pushManager.getSubscription();
    // ★鍵thatちがう古い購読は作り直す：残したままだと保存は通るのに通知thatが永久に届かない
    //   （送信側は今の鍵で署名するため、購読の鍵と合わないと配信that拒否される）
    if (sub && !sameServerKey(sub, key)) { try { await sub.unsubscribe(); } catch {} sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    step = "save";
    const j = sub.toJSON();
    const { data, error } = await supabase.rpc("save_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error || !data?.ok) return fail(data?.reason || error?.message || "save_failed");
    return { ok: true };
  } catch (e) {
    return fail([e?.name, e?.message].filter(Boolean).join(": ") || String(e));
  }
}
