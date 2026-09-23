import { useEffect, useState, useSyncExternalStore } from "react";
import { productAnalytics, ANALYTICS_CHOICE_KEY } from "../lib/productAnalytics";
import { supabase } from "../lib/supabase";
import { isAdmin } from "../lib/utils";
import "./AnalyticsPreferences.css";

export function ProductAnalyticsController({ excluded }) {
  useEffect(() => {
    productAnalytics.configure(async (rows, signal) => {
      // Session restoration can finish before App's user state. Exclude the
      // operator at send time as well, and recheck withdrawal after the wait.
      const { data, error } = await supabase.auth.getSession();
      if (signal.aborted || error || isAdmin(data?.session?.user)) return;
      return supabase.from("product_events").insert(rows).abortSignal(signal).retry(false);
    }, excluded);
    const page = () => productAnalytics.page();
    const storage = event => { if (!event.key || event.key === ANALYTICS_CHOICE_KEY) productAnalytics.refresh(); };
    window.addEventListener("hashchange", page);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("hashchange", page);
      window.removeEventListener("storage", storage);
      productAnalytics.stop();
    };
  }, [excluded]);
  return null;
}

export function AnalyticsPreferences({ always = false, hidden = false }) {
  const choice = useSyncExternalStore(productAnalytics.subscribe, productAnalytics.choice, () => null);
  const [error, setError] = useState(false);
  if (hidden || (!always && choice !== null)) return null;
  const choose = value => setError(!productAnalytics.choose(value));
  return <section className="analytics-preferences" aria-label="利用状況の計測">
    <h2>使いやすくするための計測</h2>
    <p>表示した画面の種類と、応募・求人掲載・PDF作成の開始と結果を記録してよいですか？</p>
    <p>千歳の運営者が改善のために確認します。記録は最長30日で削除します。氏名・入力内容・チャット本文は含めません。</p>
    <p>許可しなくてもすべての機能を利用できます。マイページの設定からいつでも変更できます。</p>
    {always && <p className="analytics-choice" role="status">現在：{choice === "granted" ? "許可しています" : choice === "denied" ? "許可していません" : "未選択（計測していません）"}</p>}
    <div className="analytics-buttons">
      <button type="button" onClick={() => choose("denied")} aria-pressed={choice === "denied"}>許可しない</button>
      <button type="button" onClick={() => choose("granted")} aria-pressed={choice === "granted"}>許可する</button>
    </div>
    {error && <p role="alert">設定を保存できませんでした。この画面では計測を停止しています。次回の利用時に、もう一度設定してください。</p>}
    <a href="#/privacy">記録する内容と送信先を確認する</a>
  </section>;
}
