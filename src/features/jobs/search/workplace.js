import { goAlongPath, returnAlongPath, routeReturn } from '../../../lib/routeTrail.js';
import { ROUTE_CHANGED } from '../../../lib/pushRoute.js';

export const readWorkplaceRoute = hash => {
  const match = String(hash || '').replace(/^#\/?/, '').match(/^work\/job\/(\d+)\/workplace$/);
  return match ? Number(match[1]) : null;
};
export function openWorkplace(jobId) {
  if (readWorkplaceRoute(window.location.hash) === jobId) return;
  window.history.replaceState({ ...window.history.state, cbWorkplaceReturn: {
    jobId, scrollY: Math.max(0, window.scrollY || 0),
  } }, '');
  goAlongPath(`/work/job/${jobId}/workplace`, '求人詳細に戻る');
}
export function returnFromWorkplace(jobId) {
  const source = routeReturn()?.from;
  if (source && new RegExp(`^/work/job/${jobId}(?:/(?:content|questions|insurance))?$`).test(source) && returnAlongPath()) return;
  // Direct links have no known in-app parent. Replace rather than creating a back loop.
  window.history.replaceState(null, '', `#/work/job/${jobId}`);
  window.dispatchEvent(new Event(ROUTE_CHANGED));
}
export function workplaceReturnScroll(jobId) {
  const saved = window.history.state?.cbWorkplaceReturn;
  return saved?.jobId === jobId && Number.isFinite(saved.scrollY) ? Math.max(0, saved.scrollY) : null;
}
