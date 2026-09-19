import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { DEVICE_DRAFT_EVENT, readPendingConsent } from "../lib/deviceDrafts";
import { syncDeviceWork } from "../lib/offlineSync";
import { privacyConsentErrorMessage } from "../lib/privacyConsent";
import { emitConfirmedRefresh, REFRESH_JOBS } from "../lib/refreshBus";

export function useDeviceSync(owner, version, onConfirmed) {
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(() => !!readPendingConsent(owner, version));
  useEffect(() => {
    let stopped = false, running = false, timer, attempts = 0;
    const refresh = () => setPending(!!readPendingConsent(owner, version));
    const run = async () => {
      if (running || stopped || !owner) return;
      running = true;
      clearTimeout(timer); timer = null;
      try {
        const result = await syncDeviceWork(supabase, owner, version, {
          onConsent: () => { if (!stopped) { setError(""); onConfirmed(); } },
          onSaved: () => emitConfirmedRefresh(REFRESH_JOBS),
        });
        if (!stopped) {
          if (result.consentError) setError(privacyConsentErrorMessage(result.consentError.error, result.consentError.status));
          if (result.authRequired) setError("ログインの確認が必要です。入力はこの端末に残っています。");
          if (result.retry) timer = setTimeout(run, Math.min(60000, 3000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 1000);
          else attempts = 0;
        }
      } catch {
        if (!stopped) timer = setTimeout(run, 30000);
      } finally { running = false; if (!stopped) refresh(); }
    };
    // 入力の端末保存イベントを通信の連打にしない。送信待ちがある時だけ本体が動く。
    const wake = () => { refresh(); if (!running && !timer) timer = setTimeout(run, 500); };
    const reconnect = () => { clearTimeout(timer); timer = null; wake(); };
    const visible = () => { if (document.visibilityState === "visible") reconnect(); };
    refresh(); void run();
    window.addEventListener(DEVICE_DRAFT_EVENT, wake);
    window.addEventListener("storage", wake);
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener(DEVICE_DRAFT_EVENT, wake);
      window.removeEventListener("storage", wake); window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect); document.removeEventListener("visibilitychange", visible); };
  }, [owner, version, tick, onConfirmed]);
  return { pending, error, retry: () => setTick(t => t + 1) };
}
