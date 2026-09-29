import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { reviewAnswers } from './workReviewModel';
import './AdminWorkReviewsRoom.css';

const DIRECTIONS = { worker_to_farmer: '働き手 → 農家', farmer_to_worker: '農家 → 働き手' };
const date = value => value ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '記録なし';

function AnswerGroup({ label, items, negative }) {
  return <section className={negative ? 'admin-work-reviews__negative' : ''}>
    <h3>{label}<span> {items.length}項目</span></h3>
    {items.length ? <ul>{items.map(text => <li key={text}>{text}</li>)}</ul> : <p className="admin-work-reviews__muted">選択なし</p>}
  </section>;
}

export function AdminWorkReviewsRoom() {
  const [direction, setDirection] = useState('worker_to_farmer');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ status: 'loading' });
  const top = useRef(null);
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const { data, error } = await supabase.rpc('admin_work_reviews', { p_direction: direction, p_offset: offset });
        if (!active) return;
        if (error) throw error;
        if (!data?.ok) { setState({ status: data?.reason === 'not_admin' ? 'denied' : 'error' }); return; }
        setState({ status: 'ready', items: data.items || [], hasMore: data.has_more });
      } catch { if (active) setState({ status: 'error' }); }
    })();
    return () => { active = false; };
  }, [direction, offset, retry]);
  function page(next) { setOffset(next); top.current?.scrollIntoView({ block: 'start' }); }
  return <main className="cb-admin-page admin-work-reviews f-sans" ref={top}>
    <a className="admin-work-reviews__back" href="#/admin">← 管理画面に戻る</a>
    <h1>仕事後の評価</h1>
    <p className="admin-work-reviews__muted">仕事終了後に届いた回答を、新しい順に表示します。回答は当事者の申告であり、運営の事実認定ではありません。</p>
    <p className="admin-work-reviews__muted">管理者専用です。悪い点は他の利用者には表示されません。未回答は悪い評価に数えません。</p>
    <div className="admin-work-reviews__filters" role="group" aria-label="評価の方向">
      {Object.entries(DIRECTIONS).map(([key, label]) => <button type="button" key={key} aria-pressed={direction === key}
        onClick={() => { setDirection(key); setOffset(0); }}>{label}</button>)}
    </div>
    {state.status === 'loading' && <p role="status">評価を読み込んでいます…</p>}
    {state.status === 'denied' && <p role="alert">管理者のみが閲覧できます。</p>}
    {state.status === 'error' && <div role="alert"><p>評価を読み込めませんでした。</p><button type="button" onClick={() => setRetry(v => v + 1)}>もう一度読み込む</button></div>}
    {state.status === 'ready' && <>
      {!state.items.length && <p>この方向の評価はまだありません。</p>}
      {state.items.map(review => {
        const answers = reviewAnswers(review);
        const worker = review.worker_name || '働き手（名前未設定）';
        const farmer = review.farmer_name || '農家（名前未設定）';
        return <article className="admin-work-reviews__card" key={review.id}>
          <p className="admin-work-reviews__muted"><time dateTime={review.created_at}>{date(review.created_at)}</time> · 投稿</p>
          <h2>{[review.crop, review.task].filter(Boolean).join(' ') || '求人'} <span>#{review.job_number}</span></h2>
          <p>{review.direction === 'worker_to_farmer' ? `${worker} → ${farmer}` : `${farmer} → ${worker}`}</p>
          <p className="admin-work-reviews__muted">仕事の完了：{date(review.work_completed_at)}</p>
          {review.pay_status === 'unpaid' && <a className="admin-work-reviews__unpaid" href="#/admin/reports">未払いの申告あり · 通報案件を確認 →</a>}
          <details>
            <summary>回答を見る <span>良い点 {answers.positive.length} · 悪い点 {answers.negative.length}</span></summary>
            <AnswerGroup label="良い点" items={answers.positive} />
            <AnswerGroup label="悪い点" items={answers.negative} negative />
            {!!answers.other.length && <section><h3>その他の回答・旧項目</h3><ul>{answers.other.map(text => <li key={text}>{text}</li>)}</ul></section>}
            {!answers.positive.length && !answers.negative.length && !answers.other.length && <p>項目を選択せずに送信された評価です。</p>}
          </details>
          <a href={`#/admin/review/${review.job_number}`}>この求人を確認 →</a>
        </article>;
      })}
      <nav aria-label="評価一覧のページ" className="admin-work-reviews__pagination">
        <button type="button" disabled={!offset} onClick={() => page(Math.max(0, offset - 30))}>前の30件</button>
        <span>{offset / 30 + 1}ページ</span>
        <button type="button" disabled={!state.hasMore} onClick={() => page(offset + 30)}>次の30件</button>
      </nav>
    </>}
  </main>;
}
