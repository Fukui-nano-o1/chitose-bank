import { useEffect, useRef } from "react";
import { createJobCardPress } from "../lib/ownJobActions.js";

export function useJobCardPress(onActions) {
  const callback = useRef(onActions);
  callback.current = onActions;
  const origin = useRef(null);
  const press = useRef(null);
  if (!press.current) press.current = createJobCardPress(() => callback.current?.(origin.current));
  const enabled = !!onActions;
  useEffect(() => {
    const controller = press.current;
    if (!enabled) { controller.destroy(); return; }
    const cancel = () => controller.cancel(true);
    const hide = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("scroll", cancel, true);
    document.addEventListener("visibilitychange", hide);
    return () => {
      controller.destroy();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("scroll", cancel, true);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [enabled]);
  const nestedControl = event => {
    const control = event.target.closest?.("button, a, input, textarea, select, [role='button']");
    return control && control !== event.currentTarget;
  };
  return {
    onPointerDown(event) {
      if (!enabled || nestedControl(event)) return;
      origin.current = event.currentTarget;
      press.current.start(event);
    },
    onPointerMove: event => press.current.move(event),
    onPointerUp: event => press.current.end(event),
    onPointerCancel: () => press.current.cancel(true),
    onPointerLeave: () => press.current.cancel(true),
    onClickCapture(event) {
      if (press.current.consumeClick()) { event.preventDefault(); event.stopPropagation(); }
    },
    onContextMenu(event) {
      if (!enabled || nestedControl(event)) return;
      event.preventDefault(); origin.current = event.currentTarget; press.current.open();
    },
    onKeyDown(event) {
      if (!enabled || nestedControl(event)) return false;
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); press.current.destroy(); origin.current = event.currentTarget; press.current.open(); return true;
      }
      if (event.key === "Enter" || event.key === " ") press.current.destroy();
      return false;
    },
  };
}
