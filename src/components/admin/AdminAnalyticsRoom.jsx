import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "./AdminAnalyticsRoom.css";

const SCREENS = { search:"さがす", job:"求人詳細", apply:"応募", publish:"求人掲載", profile:"マイページ", schedule:"予定の詳細", calendar:"カレンダー", chat:"チャット", login:"ログイン・登録", help:"使い方", privacy:"プライバシー・規約", other:"その他" };
const OPERATIONS = { apply:"応募の送信（仮応募を含む）", publish:"求人の掲載・更新", pdf:"労働条件通知書のPDF作成" };
const SOURCES = { direct:"指定なし", instagram:"Instagram", qr:"QR", line:"LINE", other:"その他" };

export function AdminAnalyticsRoom() {
  const [days, setDays] = useState(7), [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ data:null, error:false, loading:true });
  useEffect(() => {
    const controller = new AbortController();
    setResult({ data:null, error:false, loading:true });
    (async () => {
      try {
        const { data, error } = await supabase.rpc("admin_product_analytics", { p_days:days }).abortSignal(controller.signal);
        if (!controller.signal.aborted) setResult({ data, error:!!error || !data, loading:false });
      } catch { if (!controller.signal.aborted) setResult({ data:null, error:true, loading:false }); }
    })();
    return () => controller.abort();
  }, [days, retry]);
  return <div className="admin-analytics">
    <div className="analytics-heading"><a href="#/admin" aria-label="管理へ戻る">← 戻る</a><h1>利用状況</h1></div>
    <p>許可した利用者の操作を集計しています。運営者の操作は含めません。</p>
    <label>集計期間 <select value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>過去7日</option><option value={30}>過去30日</option></select></label>
    {result.loading ? <p role="status">読み込み中…</p> : result.error ? <div role="alert"><p>集計を取得できませんでした。通信状態と管理権限をご確認ください。</p><button onClick={() => setRetry(value => value + 1)}>再読み込み</button></div> : <>
      <p className="analytics-total">計測した訪問 <strong>{result.data.sessions}</strong> 回</p>
      <p>同じ画面を見ていても、再読み込みまたは30分以上操作がない場合は別の訪問です。人数や全利用者の数字ではありません。</p>
      {result.data.operations.map(row => <section key={row.name}>
        <h2>{OPERATIONS[row.name]}</h2>
        <dl>{[["開始",row.started],["成功",row.succeeded],["失敗",row.failed],["30分以内・結果待ち",row.in_progress],["結果未記録（30分経過）",row.unrecorded],["20秒以上",row.slow]].map(([label,count]) => <div key={label}><dt>{label}</dt><dd>{count}件</dd></div>)}</dl>
      </section>)}
      <section><h2>表示された画面</h2>{result.data.pages.length ? <dl>{result.data.pages.map(row => <div key={row.screen}><dt>{SCREENS[row.screen]}</dt><dd>{row.views}回</dd></div>)}</dl> : <p>まだ記録がありません。</p>}</section>
      <section><h2>訪問のきっかけ</h2><dl>{result.data.sources.map(row => <div key={row.source}><dt>{SOURCES[row.source]}</dt><dd>{row.sessions}回</dd></div>)}</dl></section>
    </>}
    <details><summary>数字の見方・改善の手順</summary>
      <ol><li>「失敗」がある操作から、同じ操作を試して確認します。</li><li>「20秒以上」が増えていれば、通信や処理の待ち時間を確認します。</li><li>修正後は、同じ期間で数字がどう変わったかを見ます。</li></ol>
      <p>開始は送信・作成処理を始めた回数です。仮応募への切り替えで複数の送信が発生することがあります。入力を始めた回数ではありません。PDFの成功は保存処理を呼び出せた記録で、端末への保存完了は確認できません。</p>
      <p>結果未記録は、画面を閉じた、通信が切れた、計測を停止した場合などにも発生します。失敗や離脱の確定数ではありません。許可しない利用者と送信できなかった記録は含まれません。</p>
      <p>画面録画・入力内容・氏名・求人番号は記録しません。記録は最長30日で削除します。</p>
    </details>
  </div>;
}
