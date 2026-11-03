// Review uses its own scroll container, never window.scrollY. Rebase when the
// viewport changes (keyboard, bars, rotation) so layout shifts are not gestures.
export function updateReviewScroll(previous, { top, height, viewport, controlsFocused = false }) {
  const max = Math.max(0, height - viewport);
  const position = Math.max(0, Math.min(top, max));
  const next = { top: position, height, viewport, travel: 0, hidden: previous?.hidden ?? false, bottomLocked: previous?.bottomLocked ?? false };
  if (position <= 8) return { ...next, hidden: false, bottomLocked: false };
  // Expanding the bars reduces the viewport again. Keep the end-of-page actions
  // open during continued downward scrolling instead of trapping it in a loop.
  if (max - position <= 8) return { ...next, hidden: false, bottomLocked: true };
  if (controlsFocused) return { ...next, hidden: false };
  if (!previous || previous.height !== height || previous.viewport !== viewport) return next;
  const delta = position - previous.top;
  const travel = Math.sign(delta) === Math.sign(previous.travel) || delta === 0 ? previous.travel + delta : delta;
  next.travel = travel;
  // Accumulate even slow/subpixel scrolling; small direction reversals are jitter.
  if (Math.abs(travel) >= 8) {
    if (travel < 0) next.bottomLocked = false;
    next.hidden = travel > 0 && !next.bottomLocked;
    next.travel = 0;
  }
  return next;
}
