// ── tracker.js ──────────────────────────────────────────────────────────────
// Inkluder i alle moduler: <script src="/tracker.js"></script>
// Logger page_view + fanger opp ubehandlede feil og sender til tracking API.
// Krever at hoy_access_token finnes i localStorage.
// ─────────────────────────────────────────────────────────────────────────────
(function(){
  'use strict';
  var TRACKING = window.location.origin + '/.netlify/functions/tracking';
  var tok = localStorage.getItem('hoy_access_token');
  if (!tok) return;

  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + tok
  };

  function guessModule() {
    var m = window.location.pathname.match(/\/(befaring|budmodul|prospekt|annonsegenerator|sjekkliste|handbok|soper|admin)\//);
    return m ? m[1] : 'portal';
  }

  function track(event_type, module, payload) {
    try {
      fetch(TRACKING, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ event_type: event_type, module: module || guessModule(), payload: payload || {} })
      }).catch(function(){});
    } catch(e) {}
  }

  // Log page view
  track('page_view', guessModule());

  // Catch uncaught errors
  window.addEventListener('error', function(e) {
    track('error', guessModule(), {
      message: String(e.message || e.error),
      source: e.filename,
      line: e.lineno,
      col: e.colno
    });
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    track('error', guessModule(), {
      message: String(e.reason),
      type: 'unhandledrejection'
    });
  });

  // Expose for manual tracking from modules
  window.hoyTrack = track;
})();
