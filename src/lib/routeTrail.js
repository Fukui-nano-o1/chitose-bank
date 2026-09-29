import { ROUTE_CHANGED } from './pushRoute.js';
// Return through browser history instead of appending a second copy of the source page.
export const currentPath = () => window.location.hash.replace(/^#/, '') || '/search';
export function goAlongPath(path, label = '前の画面に戻る') {
  const from = currentPath();
  if (from === path) return;
  window.location.hash = path;
  // A hash navigation creates a new history entry. Keep return metadata on that entry only.
  window.history.replaceState({ cbRouteReturn: { from, to: path, label } }, '');
}
export function routeReturn() {
  const value = window.history.state?.cbRouteReturn;
  return value?.to === currentPath() && typeof value.from === 'string' && value.from.startsWith('/') ? value : null;
}
export function returnAlongPath() {
  if (!routeReturn()) return false;
  window.history.back();
  return true;
}
export function readApplicantView(owner) {
  const value = window.history.state?.cbApplicantView;
  return value?.owner === owner && value.path === currentPath() ? value : null;
}
export function rememberApplicantView(owner, id, tab, scrollTop) {
  window.history.replaceState({ ...window.history.state, cbApplicantView: {
    owner, id, path: currentPath(), tab, scrollTop: Math.max(0, Number(scrollTop) || 0),
  } }, '');
}
export function clearApplicantView() {
  const state = { ...window.history.state }; delete state.cbApplicantView;
  window.history.replaceState(state, '');
}

// Job search already updates its own selected item; notify the other route listeners only.
export function pushAlongPath(hash, label = '前の画面に戻る') {
  const to = hash.replace(/^#/, ''), from = currentPath();
  if (to === from) return;
  window.history.pushState({ cbRouteReturn: { from, to, label } }, '', '#' + to);
  window.dispatchEvent(new Event(ROUTE_CHANGED));
}
