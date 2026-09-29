// 働き手→農家の評価。応募状況と今日ページが同じ入力・保存を使う。
// 良い点5つ／悪い点5つは workReview.js が正。公開範囲は既存のDB関数が担保する。
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fbSuccess, fbError } from '../lib/feedback';
import { buildWorkReviewPayload } from '../lib/workReview';
import { WorkReviewFlow } from './WorkReviewFlow';

function WorkerReviewForm({ app, meId, dayCount, onDone, onClose }) {
  const [answers, setAnswers] = useState({});
  const [unpaid, setUnpaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [alreadySent, setAlreadySent] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function onAnswer(key, value) {
    setAnswers(prev => ({ ...prev, [key]: value }));
    if (key === 'paid_as_posted' && value !== 'negative') setUnpaid(false);
    setError('');
  }

  async function submit() {
    if (busy.current || alreadySent) return;
    busy.current = true;
    setSubmitting(true);
    setError('');
    try {
      const { error: failure } = await supabase.from('reviews').insert(buildWorkReviewPayload({ app, meId, answers, unpaid }));
      if (!alive.current) return;
      if (failure) {
        fbError();
        if (failure.code === '23505') {
          setAlreadySent(true);
          setError('この仕事の評価はすでに送信されています。送信済みの評価は変更されません。');
        } else {
          setError('送信できませんでした。選んだ内容は残っています。通信を確認して、もう一度お試しください。');
        }
        return;
      }
      fbSuccess();
      onDone(app.id);
    } catch {
      if (alive.current) {
        fbError();
        setError('送信できませんでした。選んだ内容は残っています。もう一度お試しください。');
      }
    } finally {
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  return <WorkReviewFlow answers={answers} onAnswer={onAnswer} unpaid={unpaid} onUnpaid={setUnpaid}
    dayCount={dayCount} submitting={submitting} error={error} alreadySent={alreadySent}
    onSubmit={submit} onClose={onClose} onAlreadySent={() => onDone(app.id)} />;
}

export function WorkerReviewSheet(props) {
  // 応募・アカウントが変わったら、ページ位置も回答も引き継がない。
  return props.app ? <WorkerReviewForm key={`${props.meId}:${props.app.id}`} {...props} /> : null;
}
