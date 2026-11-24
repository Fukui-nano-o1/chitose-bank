import { useLayoutEffect, useRef, useState } from 'react';

const FOLLOW_GAP_PX = 80;

function bottomGap(element) {
  return element.scrollHeight - element.clientHeight - element.scrollTop;
}

function pinToLatest(element) {
  if (element && !document.hidden && bottomGap(element) > 1) element.scrollTop = element.scrollHeight;
}

// Both chat views commit their DOM asynchronously. First scroll after the
// real messages have rendered, not while a loading placeholder is present.
export function useChatHistoryScroll({ room, lastMessageId, nearBottom, onReachLatest }) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const lastShown = useRef({ room: null, id: null });
  const [hasNewMessages, setHasNewMessages] = useState(false);

  useLayoutEffect(() => {
    if (lastShown.current.room !== room) {
      lastShown.current = { room, id: null };
      nearBottom.current = true;
      setHasNewMessages(false);
    }
    if (!lastMessageId) return;
    const previous = lastShown.current.id;
    lastShown.current.id = lastMessageId;
    if (!previous || nearBottom.current) {
      nearBottom.current = true;
      pinToLatest(scrollRef.current);
      setHasNewMessages(false);
    } else if (previous !== lastMessageId) {
      setHasNewMessages(true);
    }
  }, [room, lastMessageId, nearBottom]);

  const hasHistory = Boolean(lastMessageId);
  useLayoutEffect(() => {
    const scroller = scrollRef.current, content = contentRef.current;
    if (!hasHistory || !scroller || !content) return;
    // Font/layout and viewport changes can settle after React's commit, with
    // the same last message ID. Defer layout writes out of ResizeObserver's
    // delivery phase and never take over a manual read or hidden page.
    let frame = null;
    const scheduleFollow = () => {
      if (frame !== null || document.hidden || !nearBottom.current) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (nearBottom.current) pinToLatest(scroller);
      });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFollow) : null;
    observer?.observe(content);
    observer?.observe(scroller);
    document.addEventListener('visibilitychange', scheduleFollow);
    window.addEventListener('pageshow', scheduleFollow);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', scheduleFollow);
      window.removeEventListener('pageshow', scheduleFollow);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [room, hasHistory, nearBottom]);

  const onScroll = event => {
    if (!lastMessageId || !lastShown.current.id) return;
    const wasNear = nearBottom.current;
    nearBottom.current = bottomGap(event.currentTarget) < FOLLOW_GAP_PX;
    if (!nearBottom.current) return;
    setHasNewMessages(false);
    if (!wasNear) onReachLatest?.();
  };

  const followToLatest = () => {
    nearBottom.current = true;
    pinToLatest(scrollRef.current);
    setHasNewMessages(false);
  };

  const jumpToLatest = () => {
    followToLatest();
    onReachLatest?.();
  };

  return { scrollRef, contentRef, hasNewMessages, onScroll, followToLatest, jumpToLatest };
}
