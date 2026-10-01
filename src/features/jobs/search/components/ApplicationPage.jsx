import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dots } from '../../../../components/ui';
import { calFmtDate, payLabel } from '../../../../lib/utils';
import { goAlongPath, returnAlongPath } from '../../../../lib/routeTrail';
import './ApplicationPage.css';

export const APPLICATION_STEPS = ['intro', 'about', 'dates', 'confirm'];
export function readApplicationStep() {
  const match = window.location.hash.match(/^#\/?work\/job\/\d+\/apply\/(intro|about|dates|confirm)$/);
  return match ? APPLICATION_STEPS.indexOf(match[1]) : null;
}

// Only the chosen availability is stored locally; submission remains in the search controller.
export function ApplicationPage({ selectedJob, step, me, isPeriodJob, periodDays, applying, blocked, checking, handleApply, applyAvailRef }) {
  const draftKey = `cb_application_dates_v1_${me?.id || 'anon'}_${selectedJob?.id}`;
  const [selection, setSelection] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey));
      return { choice: saved?.choice === 'any' ? 'any' : 'dates', dates: Array.isArray(saved?.dates) ? saved.dates : [] };
    } catch { return { choice: 'dates', dates: [] }; }
  });
  const dates = selection.dates.filter(d => periodDays.includes(d));
  const unavailable = blocked || checking;
  const validDates = !isPeriodJob || selection.choice === 'any' || dates.length > 0;
  const heading = useRef(null);
  const content = useRef(null);
  useEffect(() => {
    try { sessionStorage.setItem(draftKey, JSON.stringify(selection)); } catch { /* page works without storage */ }
  }, [draftKey, selection]);
  useEffect(() => {
    content.current?.scrollTo?.(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  const path = next => `/work/job/${selectedJob.id}/apply/${APPLICATION_STEPS[next]}`;
  const back = () => {
    if (applying) return;
    if (!returnAlongPath()) window.location.hash = step > 0 ? path(step - 1) : `/work/job/${selectedJob.id}`;
  };
  const next = () => goAlongPath(path(step + 1), '前の確認ページに戻る');
  const submit = () => {
    if (!validDates || applying || unavailable) return;
    applyAvailRef.current = isPeriodJob ? (selection.choice === 'any' ? 'any' : [...dates].sort()) : null;
    handleApply();
  };
  const title = ['応募の流れ', '応募前の確認', isPeriodJob ? '来られる日' : '応募の確認', '応募の最終確認'][step];
  return createPortal(
    <section className="application-page f-sans" aria-label="応募の確認">
      <header className="application-page-header">
        <button onClick={back} disabled={applying} aria-label={step ? '前の確認ページに戻る' : '求人詳細に戻る'}>〈</button>
        <span>応募の確認</span>
        <span className="application-page-count">{step + 1} / {isPeriodJob ? 4 : 3}</span>
      </header>
      <div className="application-page-scroll" ref={content}>
        <main className="application-page-content">
          <p className="application-page-job">{selectedJob.crop}・{selectedJob.task}　{payLabel(selectedJob)}</p>
          <h1 ref={heading} tabIndex={-1}>{title}</h1>
          {step === 0 && <img src="/apply-approval-flow.jpg" width={1000} height={750} alt="承認の流れ：応募者のプロフィールを見て、承認するか決めます" className="application-page-flow" />}
          {step === 1 && <>
            <p>応募はまだ採用ではありません。承認前であれば、「あなたの応募」ページからいつでも取り消せます。</p>
            <p className="application-page-note">採用されると契約が成立し、お互いのお名前（本名）が当事者に表示されます。雇用の手続き（労働者名簿・賃金の記録）に必要なためです。</p>
          </>}
          {step === 2 && (isPeriodJob ? <>
            <p>来られる日を農家に伝えてから応募します。</p>
            <button className="application-page-any" aria-pressed={selection.choice === 'any'} onClick={() => setSelection(s => ({ ...s, choice: s.choice === 'any' ? 'dates' : 'any' }))}>期間中いつでもOK</button>
            <p className="application-page-hint">または、来られる日を選ぶ</p>
            <div className="application-page-dates" role="group" aria-label="来られる日">
              {periodDays.map(d => <button key={d} aria-pressed={selection.choice === 'dates' && dates.includes(d)} onClick={() => setSelection(s => ({ choice: 'dates', dates: s.dates.includes(d) ? s.dates.filter(x => x !== d) : [...s.dates, d] }))}>{calFmtDate(d)}</button>)}
            </div>
          </> : <p>「応募する」を押すと、農家に応募が届きます。</p>)}
          {step === 3 && <>
            <p className="application-page-note">来られる日：{selection.choice === 'any' ? '期間中いつでもOK' : dates.length ? `${[...dates].sort().map(calFmtDate).join('・')}（${dates.length}日）` : '日程を選んでください'}</p>
            <p>「応募する」を押すと、この内容で農家に応募が届きます。</p>
          </>}
          {checking && !blocked && <p role="status">応募状況を確認しています<Dots /></p>}
          {blocked && <p role="status" className="application-page-note">{!me ? '応募するにはログインしてください。求人詳細に戻り、ログインしてからお進みください。' : 'この求人への新規応募は現在受け付けていません。求人詳細で応募状況をご確認ください。'}</p>}
        </main>
      </div>
      <footer className="application-page-footer">
        <div>
          <button onClick={back} disabled={applying} className="application-page-back">戻る</button>
          {step < 2 || (step === 2 && isPeriodJob) ? <button onClick={next} disabled={applying || unavailable || (step === 2 && !validDates)} className="btn-primary">次へ</button> : <button onClick={submit} disabled={applying || unavailable || !validDates} className="btn-primary">{applying ? <>送信中<Dots /></> : '応募する'}</button>}
        </div>
      </footer>
    </section>, document.body,
  );
}
