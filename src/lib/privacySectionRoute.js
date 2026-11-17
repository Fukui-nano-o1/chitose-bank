import { ROUTE_CHANGED } from './pushRoute.js';

export const ANALYTICS_PRIVACY_HREF = '#/privacy';
const SECTION_KEY = 'cbPrivacySection';
const isPrivacyHash = hash => /^#\/?privacy$/.test(hash);
export function privacySectionId(location, state) {
  return isPrivacyHash(location.hash) && state?.[SECTION_KEY] === 'analytics' ? 'privacy-10' : null;
}

// Keep the app's existing privacy route and its native hashchange event. The
// section belongs to that history entry only, not to the account or its settings.
export function openAnalyticsPrivacy(event) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (!isPrivacyHash(window.location.hash)) window.location.hash = ANALYTICS_PRIVACY_HREF;
  try {
    window.history.replaceState({ ...window.history.state, [SECTION_KEY]: 'analytics' }, '');
  } catch {
    // The ordinary privacy document is still available when history is restricted.
  }
  window.dispatchEvent(new Event(ROUTE_CHANGED));
}

// Installed only while the privacy document is mounted. Read the current
// history entry again before focusing so a delayed frame cannot scroll a new page.
export function observePrivacySection(windowObject = window, documentObject = document) {
  let frame;
  const cancel = () => { if (frame !== undefined) windowObject.cancelAnimationFrame(frame); };
  const navigate = () => {
    cancel();
    const hash = windowObject.location.hash;
    if (!isPrivacyHash(hash)) return;
    const sectionId = privacySectionId(windowObject.location, windowObject.history.state);
    frame = windowObject.requestAnimationFrame(() => {
      if (windowObject.location.hash !== hash || privacySectionId(windowObject.location, windowObject.history.state) !== sectionId) return;
      const target = sectionId ? documentObject.getElementById(sectionId) : documentObject.querySelector('[data-privacy-title]');
      if (!target) return;
      const heading = sectionId ? target.querySelector('h3') : target;
      heading?.focus({ preventScroll: true });
      if (sectionId) target.scrollIntoView({ behavior: 'auto', block: 'start' });
      else windowObject.scrollTo({ top: 0, behavior: 'auto' });
    });
  };
  const events = ['hashchange', 'popstate', ROUTE_CHANGED];
  events.forEach(event => windowObject.addEventListener(event, navigate));
  navigate();
  return () => { cancel(); events.forEach(event => windowObject.removeEventListener(event, navigate)); };
}
