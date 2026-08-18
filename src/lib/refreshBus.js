// 再取得の合図バス（2026-08-18 Speed-1B）。
//
// ■なぜ要るのか（Speed-0監査の結論）
// DBが変わっても画面が変わらなかった。Realtimeは購読していたが、繋がっていたのは
// バッジとお祝いボックスだけで、一覧・今日ページを取り直す経路がどこにも無かった
// （復帰時の再取得を持っていたのもチャット系3画面だけ）。「遅い」以前に「更新しない」状態。
//
// ■設計の一線：Realtimeのpayloadを画面へ直接流し込まない
// Realtimeは「変わった」という合図としてだけ使い、中身は必ず既存のApi窓口
// （jobSearchApi / todayApi / farmerDashboardApi 等）から取り直す。
// こうしておけば、イベントを取りこぼした時も、再接続後も、復帰の合図ひとつで整合性が戻る。
//
//   DBの変更 → Realtime / focus・visibilitychange → ここ（合図）→ 各画面が既存の窓口で再fetch
//
// ■合図の出どころ（2つだけ・どちらもApp.jsx）
//   ① applications のRealtime購読（stage-watch・自分が当事者の行だけ届く）→ topic "applications"
//   ② 画面の復帰（focus / visibilitychange）→ topic "applications" と "jobs" の両方
// ★jobs にRealtimeが無いのは意図的：jobsのRLSは本人と運営だけなので、publicationに足しても
//   他人の求人の変更は誰にも届かない（さがすの役に立たない）。さがすは復帰の合図で取り直す。
import { useEffect, useRef, useState } from "react";

const EVENT = "cb:refresh";
export const REFRESH_APPLICATIONS = "applications"; // 応募の状態（承認・採用・完了・取消…）
export const REFRESH_JOBS = "jobs";                 // 求人の状態（掲載・非公開・終了…）

// 合図を出す。topics は文字列でも配列でもよい。reason はデバッグ用の由来（"realtime" / "wake"）
export function emitRefresh(topics, reason) {
  const list = Array.isArray(topics) ? topics : [topics];
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { topics: list, reason: reason || "" } }));
}

// 合図を受け取る側。返り値の数字が増えたら「取り直せ」の意味＝既存のローダーの依存配列に足すだけで使える。
// 画面が実際にマウントされている時しか動かない（＝閉じている画面のために通信しない）。
//
// 取り決め3つ：
//  ・見えていない時（バックグラウンド）は取りに行かず、保留にして復帰した時にまとめて1回
//  ・連発は「最初の1回はすぐ・残りは冷却後にまとめて1回」＝1回の連発で最大2回まで
//    （先頭＝反応の速さ、後追い＝冷却中に来た変更を取りこぼさないため。承認→採用のような
//     連続操作でも叩くのは2回で頭打ちになる）
//  ・マウント直後は取りに行かない（起動時のfetchが今まさに走っているため。lastRefの初期値＝マウント時刻）
export function useRefreshTick(topics, minIntervalMs = 5000) {
  const [tick, setTick] = useState(0);
  const key = (Array.isArray(topics) ? topics : [topics]).join(",");
  const lastRef = useRef(Date.now());
  const pendingRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const wanted = key.split(",");
    const run = () => { lastRef.current = Date.now(); pendingRef.current = false; setTick(t => t + 1); };
    const request = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") { pendingRef.current = true; return; }
      const wait = minIntervalMs - (Date.now() - lastRef.current);
      if (wait <= 0) { run(); return; }
      pendingRef.current = true;
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => { timerRef.current = null; if (pendingRef.current) request(); }, wait);
      }
    };
    const onRefresh = (e) => {
      const list = e?.detail?.topics;
      if (Array.isArray(list) && list.some(t => wanted.includes(t))) request();
    };
    const onVisible = () => { if (document.visibilityState === "visible" && pendingRef.current) request(); };
    window.addEventListener(EVENT, onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(EVENT, onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [key, minIntervalMs]);

  return tick;
}
