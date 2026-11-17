import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './jobHostPage.css';

const EVENT = 'job-host-page-open';
const KEY = 'jobHostPage';
// Only navigation metadata is written to history, never profile content.
export function openJobHostPage(trigger) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { trigger: trigger?.currentTarget || trigger } }));
}

export function JobHostPage({ enabled, children }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef(null);
  const returning = useRef(false);
  const origin = useRef(null);
  const heading = useRef(null);
  const token = useRef(null);
  const route = useRef(null);
  const returnFocus = useRef(null);
  useEffect(() => {
    if (!enabled) { setOpen(false); token.current = null; return; }
    const show = event => {
      if (token.current && history.state?.[KEY] === token.current) return;
      route.current = location.href;
      returnFocus.current = event.detail?.trigger instanceof HTMLElement ? event.detail.trigger : document.activeElement;
      origin.current = { x: window.scrollX, y: window.scrollY };
      token.current = `host-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try { history.pushState({ ...history.state, [KEY]: token.current }, '', location.href); }
      catch { token.current = null; }
      returning.current = false;
      setOpen(true);
    };
    const sync = () => { returning.current = false; setOpen(Boolean(token.current && history.state?.[KEY] === token.current && location.href === route.current)); };
    window.addEventListener(EVENT, show);
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener(EVENT, show);
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !open) return;
    const el = dialog.current;
    el.showModal();
    heading.current?.focus({ preventScroll: true });
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      el.close();
      document.body.style.overflow = previous;
      if (location.href === route.current) {
        window.scrollTo(origin.current?.x || 0, origin.current?.y || 0);
        if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      }
    };
  }, [enabled, open]);
  const back = () => {
    if (returning.current) return;
    returning.current = true;
    if (history.state?.[KEY] === token.current) history.back();
    else setOpen(false);
  };
  if (!enabled || !open) return null;
  return createPortal(<dialog ref={dialog} className="job-host-page" aria-labelledby="host-page-title" onCancel={event => { event.preventDefault(); back(); }}>
    <div className="job-host-page-inner">
      <button type="button" className="job-host-page-back" onClick={back}>← 求人詳細に戻る</button>
      <h1 id="host-page-title" ref={heading} tabIndex={-1}>募集主について</h1>
      {children}
    </div>
  </dialog>, document.body);
}
