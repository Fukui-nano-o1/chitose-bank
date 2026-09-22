import { useEffect, useMemo, useState } from "react";
import { jobEndTimeMs } from "../lib/utils.js";

// 次の終了時刻だけで描き直す。通信やDBの定期処理に依存せず、停止中も期限を守る。
export function useJobExpiryClock(jobs, selectedJob = null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const deadlines = [...(jobs || []), selectedJob].map(jobEndTimeMs)
        .filter(end => end !== null && end > current);
      if (deadlines.length) {
        timer = setTimeout(schedule, Math.min(Math.min(...deadlines) - current, 86400000));
      }
    };
    const resume = () => { if (document.visibilityState !== "hidden") schedule(); };
    schedule();
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [jobs, selectedJob]);
  // 新しく届いた行はその瞬間の時刻で評価する。無関係な再描画では分類・キャッシュ保存を繰り返さない。
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 新しい求人データが届いた瞬間にも時計を進める。
  return useMemo(() => Math.max(now, Date.now()), [now, jobs, selectedJob]);
}
