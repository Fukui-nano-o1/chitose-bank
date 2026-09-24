import { useLayoutEffect } from 'react';

// iOS can pan the visual viewport while a keyboard or zoom is active. Pin the whole
// shell to the visible rectangle, without transform (which would move nested dialogs).
export function useChatViewport(ref) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const apply = () => {
      const element = ref.current;
      if (!element) return;
      const values = { top: viewport?.offsetTop || 0, left: viewport?.offsetLeft || 0,
        width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
      for (const [key, value] of Object.entries(values)) element.style.setProperty(`--chat-${key}`, `${value}px`);
    };
    apply();
    viewport?.addEventListener('resize', apply);
    viewport?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    return () => {
      viewport?.removeEventListener('resize', apply);
      viewport?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  }, [ref]);
}
