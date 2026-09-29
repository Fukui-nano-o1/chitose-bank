import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVisualViewportFit } from '../lib/visualViewportFit';
import './ApplicantDetailSheet.css';

export function ApplicantDetailSheet({ name, jobTitle, status, description, profile, application, actions, onClose }) {
  const [tab, setTab] = useState('profile');
  const shell = useRef(null), scroll = useRef(null), close = useRef(null);
  useVisualViewportFit(shell, true);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [tab]);
  function keyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = [...shell.current.querySelectorAll('button:not(:disabled),a[href],summary,input:not(:disabled),[tabindex="0"]')]
      .filter(el => !el.closest('[hidden]'));
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }
  return createPortal(<div ref={shell} className="applicant-detail-overlay cb-lock-scroll f-sans" onKeyDown={keyDown}>
    <section className="applicant-detail" role="dialog" aria-modal="true" aria-labelledby="applicant-detail-title">
      <header className="applicant-detail__header">
        <button ref={close} type="button" onClick={onClose} aria-label="応募者詳細を閉じる">×</button>
        <h2 id="applicant-detail-title">応募者の詳細</h2>
      </header>
      <div className="applicant-detail__tabs" role="group" aria-label="表示する内容">
        <button type="button" aria-pressed={tab === 'profile'} onClick={() => setTab('profile')}>プロフィール</button>
        <button type="button" aria-pressed={tab === 'application'} onClick={() => setTab('application')}>応募内容・日程</button>
      </div>
      <div ref={scroll} className="applicant-detail__scroll">
        <div className="applicant-detail__status"><p className="applicant-detail__job-title">{jobTitle}</p><strong>{status}</strong><p>{description}</p></div>
        {tab === 'profile' ? profile : <><h3>{name}さんの応募</h3>{application}</>}
      </div>
      <footer className="applicant-detail__actions" aria-label="この応募の操作">{actions}</footer>
    </section>
  </div>, document.body);
}
