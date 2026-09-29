import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WORK_REVIEW_POINTS } from '../lib/workReview';
import { useVisualViewportFit } from '../lib/visualViewportFit';
import { REVIEW_PUBLICATION_NOTE, reviewDeadlineLabel } from '../lib/reviewWindow';
import './WorkReviewFlow.css';

const UNPAID_NOTE = '「未払い」は、未払いの申告として運営にも記録されます。運営が内容を確認し、必要に応じて双方に事実を確認します。';

export function WorkReviewFlow({ answers, onAnswer, unpaid, onUnpaid, dayCount, submitting, error,
  alreadySent, onSubmit, onClose, onAlreadySent, points = WORK_REVIEW_POINTS,
  startContent, startReady = true, startTitle = '今回の仕事を完了する', summaryContent, publicationNote, reviewWindow }) {
  const [step, setStep] = useState(startContent ? -1 : 0);
  const [notice, setNotice] = useState('');
  const shellRef = useRef(null);
  const scrollRef = useRef(null);
  const headingRef = useRef(null);
  useVisualViewportFit(shellRef, true);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
    setNotice('');
  }, [step]);
  useEffect(() => {
    if (error && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [error]);

  const positive = points.filter(point => answers[point.key] === 'positive');
  const negative = points.filter(point => answers[point.key] === 'negative');
  const count = positive.length + negative.length;
  const polarity = step === 0 ? 'positive' : 'negative';
  const locked = submitting || alreadySent;
  const windowBlocked = reviewWindow && reviewWindow.state !== 'open';
  const windowTitle = {loading:'評価の受付を確認しています',error:'受付期限を確認できませんでした',closed:'評価の受付は終了しました',not_started:'仕事が終わってから評価できます',unavailable:'仕事の終了日時を確認できません'}[reviewWindow?.state];
  const unpaidReport = answers.paid_as_posted === 'negative' && unpaid;

  function toggle(point) {
    const previous = answers[point.key];
    onAnswer(point.key, previous === polarity ? undefined : polarity);
    setNotice(previous && previous !== polarity
      ? `「${point.category}」を${polarity === 'positive' ? '良い点' : '悪い点'}に変更しました。` : '');
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!submitting) onClose();
    }
    if (event.key !== 'Tab') return;
    const focusable = [...shellRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }

  return createPortal(
    <section ref={shellRef} className="work-review-overlay cb-lock-scroll f-sans"
      role="dialog" aria-modal="true" aria-labelledby="work-review-title" aria-busy={submitting}
      onKeyDown={onKeyDown} onClick={event => event.stopPropagation()}>
      <header className="work-review-header">
        {!windowBlocked && step > (startContent ? -1 : 0) ? <button type="button" className="work-review-icon" aria-label="前のページに戻る"
          disabled={locked} onClick={() => setStep(step - 1)}><span aria-hidden="true">←</span></button> : <span />}
        <span>仕事の評価</span>
        <button type="button" className="work-review-icon" aria-label="評価を閉じる" disabled={submitting}
          onClick={onClose}><span aria-hidden="true">×</span></button>
      </header>

      <div ref={scrollRef} className="work-review-scroll">
        <div className="work-review-content">
          <p className="work-review-kicker">{step === -1 ? '仕事の完了' : step < 2 ? `${step + 1} / 2` : '送信前の確認'}
            {dayCount > 0 && <span> · {dayCount}日間の仕事</span>}</p>
          <h2 id="work-review-title" ref={headingRef} tabIndex={-1}>
            {windowBlocked ? windowTitle : step === -1 ? startTitle : step === 0 ? '良かった点はありますか？' : step === 1 ? '悪かった点はありますか？' : 'この内容で送信しますか？'}
          </h2>
          {reviewWindow?.closes_at && <p className="work-review-privacy">入力の締切・公開：{reviewDeadlineLabel(reviewWindow.closes_at)}（日本時間）</p>}
          {windowBlocked ? <p className="work-review-lead" role="status">{reviewWindow.state==='closed'
            ? '最終作業の終了から72時間が経過しました。これ以降は送信できません。期限内に届いた評価は、片方だけでも保存・公開されます。悪い点は非公開です。'
            : reviewWindow.state==='error' ? '通信を確認して、もう一度お試しください。選んだ内容は残っています。'
              : reviewWindow.state==='loading' ? 'サーバーで入力できる期間を確認しています。'
                : '評価は最終作業の終了から72時間だけ入力できます。'}</p> : step === -1 ? startContent : step < 2 ? <>
            <p className="work-review-lead">当てはまるものをいくつでも選べます。<br />なければ、選ばずに進めます。</p>
            <p className="work-review-privacy">{step === 0
              ? '良い点は件数にまとめて表示されます。誰が選んだかは表示されません。'
              : '悪い点は公開されません。改善・安全確認のために運営に記録されます。'}</p>
            <div role="group" aria-label={step === 0 ? `良い点の${points.length}項目` : `悪い点の${points.length}項目`}>
              {[...new Set(points.map(point => point.group))].map(group => <section className="work-review-group" key={group}>
                <h3>{group}</h3>
                <div className="work-review-points">
                  {points.filter(point => point.group === group).map(point => {
                    const selected = answers[point.key] === polarity;
                    const opposite = answers[point.key] && !selected;
                    return <button type="button" key={point.key} className="work-review-point"
                      aria-pressed={selected} disabled={locked} onClick={() => toggle(point)}>
                      <span><strong>{point[polarity]}</strong>{opposite && <small>
                        {step === 0 ? '悪い点' : '良い点'}から変更できます
                      </small>}</span>
                      <span className="work-review-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                    </button>;
                  })}
                </div>
              </section>)}
            </div>
            {step === 1 && answers.paid_as_posted === 'negative' && <div className="work-review-unpaid">
              <label><input type="checkbox" checked={unpaid} disabled={locked} onChange={event => onUnpaid(event.target.checked)} />
                <span>まだ報酬を受け取っていない</span></label>
              <p>{UNPAID_NOTE}</p>
            </div>}
            <p className="work-review-notice" role="status">{notice}</p>
          </> : <>
            <p className="work-review-lead">選んだ内容を確認してください。<br />送信後は変更できません。</p>
            {summaryContent && <section className="work-review-summary" aria-label="仕事の完了確認">
              <div className="work-review-summary-heading"><h3>仕事の完了確認</h3>
                <button type="button" className="work-review-link" disabled={locked} onClick={() => setStep(-1)}
                  aria-label="仕事の完了確認を変更">変更</button></div>
              {summaryContent}
            </section>}
            {[{ label: '良い点', points: positive, value: 'positive', page: 0 },
              { label: '悪い点', points: negative, value: 'negative', page: 1 }].map(group => (
              <section key={group.value} className="work-review-summary" aria-label={`${group.label}の確認`}>
                <div className="work-review-summary-heading"><h3>{group.label} <span>{group.points.length}件</span></h3>
                  <button type="button" className="work-review-link" disabled={locked} onClick={() => setStep(group.page)}
                    aria-label={`${group.label}を変更`}>変更</button></div>
                <p className="work-review-privacy">{group.page === 0 ? '件数のみ表示・評価者は非表示' : '非公開・運営への記録'}</p>
                {group.points.length ? <ul>{group.points.map(point => <li key={point.key}>{point[group.value]}</li>)}</ul>
                  : <p className="work-review-empty">選択なし</p>}
              </section>
            ))}
            {unpaidReport && <div className="work-review-unpaid"><strong>未払いとして申告します</strong><p>{UNPAID_NOTE}</p></div>}
            {!count && <p className="work-review-empty">項目を選択せずに、この仕事の評価を終了します。</p>}
            {publicationNote && <p className="work-review-privacy">{publicationNote}</p>}
            <p className="work-review-privacy work-review-publication">{REVIEW_PUBLICATION_NOTE}</p>
          </>}
          {error && <p className="work-review-error" role="alert">{error}</p>}
        </div>
      </div>

      <footer className="work-review-footer">
        <div className="work-review-progress" aria-hidden="true"><span data-complete={step >= 1} /><span data-complete={step >= 2} /></div>
        <div className="work-review-actions">
          {!windowBlocked && step > (startContent ? -1 : 0) && !alreadySent ? <button type="button" className="work-review-link" disabled={submitting}
            onClick={() => setStep(step - 1)}>戻る</button> : <span className="work-review-count">{count}項目を選択</span>}
          <button type="button" className="work-review-primary" disabled={submitting || reviewWindow?.state==='loading' || (!windowBlocked && step === -1 && !startReady)}
            onClick={windowBlocked ? (reviewWindow.state==='error' ? reviewWindow.refresh : onClose) : alreadySent ? onAlreadySent : step < 2 ? () => setStep(step + 1) : onSubmit}>
            {windowBlocked ? (reviewWindow.state==='loading' ? '確認中…' : reviewWindow.state==='error' ? 'もう一度確認' : '仕事に戻る') : alreadySent ? '評価済みの仕事に戻る' : submitting ? '送信中…' : step === -1 ? '良い点へ' : step === 0 ? '悪い点へ' : step === 1 ? '内容を確認' : '送信する'}
          </button>
        </div>
      </footer>
    </section>, document.body,
  );
}
