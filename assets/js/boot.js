/* Runs before first paint: apply the saved language and theme so the page
 * never flashes in the wrong direction or colour scheme. Kept external
 * because the Content-Security-Policy forbids inline scripts. */
(function () {
  var root = document.documentElement;
  var guide = root.getAttribute('data-page') === 'guide'; // Arabic articles: theme only
  var prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem('df-prefs') || '{}') || {};
  } catch (e) { /* storage blocked: defaults below */ }
  if (prefs.lang === 'en' && !guide) {
    root.lang = 'en';
    root.dir = 'ltr';
  }
  var theme = prefs.theme === 'light' || prefs.theme === 'dark' ? prefs.theme
    : (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  root.setAttribute('data-theme', theme);
  if (guide) return;
  // Hold JS-rendered regions until the first render (no layout shift);
  // the app removes this class, the timeout is a safety net.
  root.classList.add('is-loading');
  setTimeout(function () { root.classList.remove('is-loading'); }, 3500);
})();
