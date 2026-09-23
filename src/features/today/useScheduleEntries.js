import { useEffect, useState } from "react";
import { getCache, setCache } from "../../lib/viewCache";
import { useRefreshTick, REFRESH_APPLICATIONS } from "../../lib/refreshBus";
import { getSession, fetchMyCalendarJobs } from "./todayApi";

// マイページの一覧と予定詳細は、同じ当事者限定RPC・キャッシュを使う。
export function useScheduleEntries() {
  const refreshTick = useRefreshTick(REFRESH_APPLICATIONS);
  const [retry, setRetry] = useState(0);
  const [entries, setEntries] = useState(() => getCache("today:entries") ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (cancelled) return;
        if (!session) { setEntries([]); setError(true); return; }
        const result = await fetchMyCalendarJobs();
        if (cancelled) return;
        if (result.error) throw result.error;
        const rows = result.data || [];
        setEntries(rows);
        setCache("today:entries", rows);
      } catch {
        // 通信失敗を「予定なし」にしない。詳細では再取得の入口も出す。
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshTick, retry]);
  return { entries, loading, error, reload: () => setRetry(n => n + 1) };
}
