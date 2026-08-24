/*
 * Noura credit handling, shared by every page that calls /api/*.
 *
 * Wraps fetch so a 402 from the server becomes a calm, explicit banner instead
 * of a silent failure. The wrapper is deliberately non-invasive: anything that
 * is not a 402 from our own API is passed straight through untouched, and the
 * 402 response object is still returned to the caller so existing error paths
 * (retry buttons, cached content, saved transcripts) run exactly as before.
 *
 * Running out blocks NEW generation. It never blocks reading what already exists.
 */
(function () {
  'use strict';
  if (window.__nouraCreditsWired) return;
  window.__nouraCreditsWired = true;

  var BANNER_ID = 'nouraCreditBanner';

  function css() {
    if (document.getElementById('nouraCreditCSS')) return;
    var s = document.createElement('style');
    s.id = 'nouraCreditCSS';
    s.textContent =
      '#' + BANNER_ID + '{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:99999;' +
      'max-width:min(560px,92vw);background:#141416;border:1px solid rgba(227,160,8,.45);' +
      'border-radius:14px;padding:14px 17px;box-shadow:0 12px 40px rgba(0,0,0,.5);' +
      "font-family:'Plus Jakarta Sans','Inter',-apple-system,sans-serif;color:#E8E8E6;" +
      'display:flex;gap:13px;align-items:flex-start}' +
      '#' + BANNER_ID + ' .t{font-size:14px;font-weight:800;letter-spacing:-.01em}' +
      '#' + BANNER_ID + ' .d{font-size:12.5px;color:#9a9aa2;margin-top:4px;line-height:1.55}' +
      '#' + BANNER_ID + ' .x{margin-left:auto;background:none;border:none;color:#6f6f76;' +
      'font-size:18px;cursor:pointer;padding:0 2px;line-height:1}' +
      '#' + BANNER_ID + ' .x:hover{color:#fff}';
    document.head.appendChild(s);
  }

  function when(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      return ' Your allowance resets on ' +
        d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) + '.';
    } catch (e) { return ''; }
  }

  function show(info) {
    css();
    var old = document.getElementById(BANNER_ID);
    if (old) old.remove();

    var title, detail;
    if (info && info.error === 'service_capacity') {
      title = 'Noura is at capacity right now';
      detail = 'We have hit our usage ceiling for this period, so new generation is paused ' +
               'for everyone. Everything you have already made is still here and readable.';
    } else {
      title = 'You are out of credits';
      detail = 'New lessons and teaching sessions are paused.' + when(info && info.resets_at) +
               ' Everything you have already generated is still saved and readable.';
    }

    var b = document.createElement('div');
    b.id = BANNER_ID;
    b.setAttribute('role', 'status');
    b.innerHTML =
      '<div><div class="t"></div><div class="d"></div></div>' +
      '<button class="x" type="button" aria-label="Dismiss">&#10005;</button>';
    b.querySelector('.t').textContent = title;
    b.querySelector('.d').textContent = detail;
    b.querySelector('.x').addEventListener('click', function () { b.remove(); });
    document.body.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.remove(); }, 14000);
  }

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    return nativeFetch(input, init).then(function (res) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (res.status === 402 && url.indexOf('/api/') !== -1) {
          // Read a clone so the caller still gets an intact, unread body.
          res.clone().json().then(show).catch(function () { show(null); });
          window.dispatchEvent(new CustomEvent('noura:credits-exhausted'));
        }
      } catch (e) { /* never let metering break a request */ }
      return res;
    });
  };

  // Small helper for surfaces that want to show a live balance.
  window.NouraCredits = {
    async status() {
      try { return await (await nativeFetch('/api/me')).json(); }
      catch (e) { return null; }
    }
  };
})();
