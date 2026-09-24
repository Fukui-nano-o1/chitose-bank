import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useChatViewport } from '../lib/useChatViewport';
import './Chat.css';

export function ChatSheet({ title, onClose, children }) {
  const ref = useRef(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  useChatViewport(ref);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  function keyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
    if (event.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }
  return createPortal(<div ref={ref} className="chat-sheet-overlay cb-lock-scroll" onKeyDown={keyDown} onClick={onClose}>
    <section className="chat-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <header className="chat-sheet-header"><button type="button" className="chat-icon-button" onClick={onClose} aria-label="閉じる">×</button><h2>{title}</h2></header>
      <div className="chat-sheet-body">{children}</div>
    </section>
  </div>, document.body);
}
