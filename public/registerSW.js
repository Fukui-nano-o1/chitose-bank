// The PWA plugin uses this file instead of generating an unguarded registration.
// Service Workers are optional: a rejected registration must not reject page startup.
(function () {
  if (!('serviceWorker' in navigator)) return;

  function register() {
    // Some restricted environments throw synchronously; others reject the Promise.
    Promise.resolve()
      .then(function () { return navigator.serviceWorker.register('/sw.js', { scope: '/' }); })
      .catch(function (error) {
        // Keep the cause available for diagnostics without creating a global rejection.
        console.warn('[chitose-bank] Service Worker registration unavailable; continuing online.', error);
      });
  }

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
})();
