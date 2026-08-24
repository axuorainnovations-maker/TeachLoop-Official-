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

  // ── credit pill ───────────────────────────────────────────────────────
  function pillCSS() {
    if (document.getElementById('nouraPillCSS')) return;
    var s = document.createElement('style');
    s.id = 'nouraPillCSS';
    s.textContent =
      '.noura-credit-pill{display:inline-flex;align-items:center;gap:7px;height:38px;' +
      'padding:0 13px;border-radius:999px;background:#17171a;border:1px solid #2a2a2e;' +
      "color:#e4e4e5;font-family:'Plus Jakarta Sans','Inter',-apple-system,sans-serif;" +
      'font-size:13.5px;font-weight:700;cursor:default;user-select:none;line-height:1;' +
      'transition:border-color .15s}' +
      '.noura-credit-pill:hover{border-color:#3a3a40}' +
      '.noura-credit-pill .dot{width:15px;height:15px;border-radius:50%;flex-shrink:0;' +
      'background:linear-gradient(140deg,#c4b5fd 0%,#a855f7 38%,#7c3aed 72%,#6d28d9 100%)}' +
      '.noura-credit-pill.low{border-color:rgba(227,160,8,.55)}' +
      '.noura-credit-pill.out{border-color:rgba(239,68,68,.55);color:#ff9f9a}' +
      '.noura-credit-pill .n{font-variant-numeric:tabular-nums}';
    document.head.appendChild(s);
  }

  function paint(el, d) {
    if (!el || !d) return;
    var bal = d.balance || 0;
    var per = d.cost_per_action || 50;
    el.className = 'noura-credit-pill' + (bal < per ? ' out' : bal < per * 3 ? ' low' : '');
    el.querySelector('.n').textContent = bal.toLocaleString();
    el.title = bal < per
      ? 'Out of credits. Top up to keep studying.'
      : Math.floor(bal / per) + ' study actions left (' + per + ' credits each)';
  }

  /**
   * Mount the balance pill. `where` is a selector; the pill is inserted BEFORE
   * that element so it sits to its left. Falls back to fixed top-right.
   */
  function mountPill(where) {
    pillCSS();
    if (document.getElementById('nouraCreditPill')) return;
    var el = document.createElement('div');
    el.id = 'nouraCreditPill';
    el.className = 'noura-credit-pill';
    el.innerHTML = '<span class="dot"></span><span class="n">--</span>' +
                   '<span style="color:#8a8a93;font-weight:600">credits</span>';
    var anchor = where && document.querySelector(where);
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(el, anchor);   // to the left of the anchor
    } else {
      el.style.cssText = 'position:fixed;top:18px;right:22px;z-index:50';
      document.body.appendChild(el);
    }
    refresh();
  }

  function refresh() {
    var el = document.getElementById('nouraCreditPill');
    if (!el) return Promise.resolve(null);
    return nativeFetch('/api/me').then(function (r) { return r.json(); })
      .then(function (d) { paint(el, d); return d; })
      .catch(function () { return null; });
  }

  // Spending changes the balance, so repaint after any /api call settles.
  window.addEventListener('noura:credits-exhausted', refresh);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
  setInterval(refresh, 30000);

  // ── welcome notification ──────────────────────────────────────────────
  function welcomeToast(d) {
    pillCSS();
    var w = document.createElement('div');
    w.id = 'nouraWelcome';
    w.style.cssText =
      'position:fixed;top:22px;right:22px;z-index:100000;max-width:min(360px,92vw);' +
      'background:#141416;border:1px solid rgba(139,92,246,.5);border-radius:16px;' +
      'padding:16px 18px;box-shadow:0 16px 48px rgba(0,0,0,.55);' +
      "font-family:'Plus Jakarta Sans','Inter',-apple-system,sans-serif;color:#E8E8E6;" +
      'opacity:0;transform:translateY(-8px);transition:opacity .25s,transform .25s';
    w.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<span style="width:26px;height:26px;border-radius:50%;flex-shrink:0;' +
        'background:linear-gradient(140deg,#c4b5fd 0%,#a855f7 38%,#7c3aed 72%,#6d28d9 100%)"></span>' +
        '<div style="font-size:15px;font-weight:800;letter-spacing:-.01em">' +
          d.credits.toLocaleString() + ' credits added</div></div>' +
      '<div style="font-size:12.5px;color:#9a9aa2;margin-top:8px;line-height:1.55">' +
        'Welcome to Noura. That is ' + (d.actions_left || 10) + ' study actions to get started. ' +
        'Credits never expire, and each action costs ' + (d.cost_per_action || 50) + '.</div>';
    document.body.appendChild(w);
    requestAnimationFrame(function () { w.style.opacity = '1'; w.style.transform = 'none'; });
    setTimeout(function () {
      w.style.opacity = '0'; w.style.transform = 'translateY(-8px)';
      setTimeout(function () { if (w.parentNode) w.remove(); }, 300);
    }, 7000);
  }

  /** Called when onboarding finishes. Shows the toast only the first time. */
  function claimWelcome() {
    return nativeFetch('/api/welcome', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.first_time) welcomeToast(d);
        refresh();
        return d;
      })
      .catch(function () { return null; });
  }

  window.NouraCredits = {
    mountPill: mountPill,
    refresh: refresh,
    claimWelcome: claimWelcome,
    async status() {
      try { return await (await nativeFetch('/api/me')).json(); }
      catch (e) { return null; }
    }
  };
})();
