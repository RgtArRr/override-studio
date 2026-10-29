// Instant locale gateway: bots and no-JS users follow the links in index.html.
// Local dev boots straight into the editor (localized homes only exist in dist).
(function () {
  try {
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      window.location.replace('/app/');
      return;
    }
    var langs = window.navigator.languages || [window.navigator.language];
    var es = langs.some(function (l) {
      return (l || '').toLowerCase().indexOf('es') === 0;
    });
    window.location.replace(es ? '/es/' : '/en/');
  } catch (e) {
    /* stay: manual links below */
  }
})();
