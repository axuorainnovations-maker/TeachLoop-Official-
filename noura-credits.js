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
  // Automatically remove .html from browser URL address bar across all pages
  try {
    if (window.location.pathname.endsWith('.html')) {
      var cleanPath = window.location.pathname.slice(0, -5);
      if (cleanPath === '/index') cleanPath = '/';
      window.history.replaceState(null, '', cleanPath + window.location.search + window.location.hash);
    }
  } catch (e) {}

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

  /**
   * The account email the app already knows about. The credit allowlist keys
   * on this, so it has to travel with every API call; without it the server
   * only ever sees an anonymous cookie id.
   * A ?email= query parameter claims the account once and persists it.
   */
  function accountEmail() {
    try {
      var q = new URLSearchParams(location.search).get('email');
      if (q && q.indexOf('@') !== -1) {
        localStorage.setItem('NOURA_EMAIL', q.trim());
      }
      var e = localStorage.getItem('NOURA_EMAIL');
      if (e && e.indexOf('@') !== -1) return e.trim();
      var acct = localStorage.getItem('NOURA_ACCOUNT');
      if (acct) {
        try {
          var o = JSON.parse(acct);
          if (o && o.email) return String(o.email).trim();
        } catch (e2) {
          if (acct.indexOf('@') !== -1) return acct.trim();
        }
      }
    } catch (e3) {}
    return null;
  }

  window.fetch = function (input, init) {
    // Attach the account email to our own API calls so credit rules can apply.
    try {
      var u = (typeof input === 'string') ? input : (input && input.url) || '';
      if (u.indexOf('/api/') !== -1) {
        var em = accountEmail();
        if (em) {
          init = init || {};
          var h = new Headers(init.headers || (typeof input === 'object' && input.headers) || {});
          if (!h.has('X-Noura-Email')) h.set('X-Noura-Email', em);
          init.headers = h;
        }
      }
    } catch (e) { /* never let this break a request */ }
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
  // ── credit pill & dropdown ─────────────────────────────────────────────
  function pillCSS() {
    if (document.getElementById('nouraPillCSS')) return;
    var s = document.createElement('style');
    s.id = 'nouraPillCSS';
    s.textContent =
      '.noura-credit-pill-wrap{position:relative;display:inline-flex;}' +
      '.noura-credit-pill{display:inline-flex;align-items:center;gap:7px;height:34px;' +
      'padding:0 14px 0 11px;border-radius:9999px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);' +
      "color:#ffffff;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;" +
      'font-size:13.5px;font-weight:700;cursor:pointer;user-select:none;line-height:1;' +
      'transition:all .15s ease;box-shadow:0 2px 8px rgba(0,0,0,0.2)}' +
      '.noura-credit-pill:hover{border-color:rgba(255,255,255,0.25);background:rgba(255,255,255,0.07)}' +
      '.noura-credit-pill .sparkle-ic{color:#ffffff;flex-shrink:0}' +
      '.noura-credit-pill.low{border-color:rgba(227,160,8,.55)}' +
      '.noura-credit-pill.out{border-color:rgba(239,68,68,.55);color:#ff9f9a}' +
      '.noura-credit-pill .n{font-variant-numeric:tabular-nums;color:#ffffff;font-weight:700;letter-spacing:-0.2px}' +
      '.noura-credit-pill.unlimited{border-color:rgba(139,92,246,.55)}' +
      '.noura-credit-pill.unlimited .n{font-size:15px;line-height:1}' +
      'body.light-mode .noura-credit-pill{background:#ffffff;border-color:rgba(0,0,0,0.14);color:#111827}' +
      'body.light-mode .noura-credit-pill .n{color:#111827}' +
      'body.light-mode .noura-credit-pill .sparkle-ic{color:#111827}' +

      /* Dropdown Popup styling matching Noura purple theme */
      '.nc-dropdown{position:absolute;top:44px;right:0;width:330px;background:#18181b;' +
      'border:1px solid #27272a;border-radius:20px;padding:22px;box-shadow:0 20px 48px rgba(0,0,0,0.6);' +
      "z-index:99999;color:#ffffff;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;" +
      'display:none;flex-direction:column;animation:ncDropFade .18s cubic-bezier(0.16,1,0.3,1);box-sizing:border-box}' +
      '.nc-dropdown.open{display:flex}' +
      '@keyframes ncDropFade{from{opacity:0;transform:translateY(-8px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}' +
      '.nc-drop-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}' +
      ".nc-drop-title{font-size:22px;font-weight:800;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;color:#ffffff;letter-spacing:-0.4px}" +
      '.nc-drop-upgrade{background:linear-gradient(135deg,#a855f7 0%,#7c3aed 100%);color:#ffffff;font-size:13px;font-weight:700;padding:7px 18px;border-radius:9999px;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(139,92,246,0.35);transition:all .15s ease}' +
      '.nc-drop-upgrade:hover{transform:scale(1.03);box-shadow:0 6px 18px rgba(139,92,246,0.5);filter:brightness(1.08)}' +
      '.nc-drop-divider{border-bottom:1.5px dashed #27272a;margin-bottom:16px}' +
      '.nc-drop-banner{background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.3);border-radius:12px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px;cursor:pointer;transition:all .15s ease}' +
      '.nc-drop-banner:hover{background:rgba(168,85,247,0.18);border-color:rgba(168,85,247,0.5)}' +
      '.nc-drop-banner-left{display:flex;align-items:center;gap:9px;color:#c084fc;font-size:13px;font-weight:600;line-height:1.35}' +
      '.nc-drop-banner-left svg{flex-shrink:0}' +
      '.nc-stat-row{margin-bottom:0}' +
      '.nc-stat-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}' +
      '.nc-stat-title-group{display:flex;align-items:center;gap:7px;font-size:15px;font-weight:700;color:#ffffff}' +
      '.nc-stat-title-group svg{color:#c084fc}' +
      '.nc-stat-val-big{font-size:20px;font-weight:800;color:#ffffff;font-variant-numeric:tabular-nums}' +
      '.nc-stat-sub-group{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#808089;margin-top:2px}' +
      '.nc-q-icon{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1.5px solid #52525b;color:#a1a1aa;font-size:10px;font-weight:700;line-height:1;cursor:help}' +
      'body.light-mode .nc-dropdown{background:#ffffff;border-color:#e2e2e6;box-shadow:0 20px 48px rgba(0,0,0,0.15);color:#111827}' +
      'body.light-mode .nc-drop-title{color:#111827}' +
      'body.light-mode .nc-drop-upgrade{background:linear-gradient(135deg,#a855f7 0%,#7c3aed 100%);color:#ffffff}' +
      'body.light-mode .nc-stat-title-group,body.light-mode .nc-stat-val-big{color:#111827}' +
      'body.light-mode .nc-drop-divider{border-bottom-color:#e5e7eb}';
    document.head.appendChild(s);
  }

  function paint(el, d) {
    if (!el || !d) return;
    var per = d.cost_per_action || 50;
    var bal = d.balance || 0;
    var dropBal = document.getElementById('ncDropBalVal');

    if (d.unlimited) {
      el.className = 'noura-credit-pill unlimited';
      el.querySelector('.n').textContent = '\u221E';   // infinity
      el.title = 'Unlimited credits on this account';
      if (dropBal) dropBal.textContent = '\u221E';
      return;
    }

    el.className = 'noura-credit-pill' + (bal < per ? ' out' : bal < per * 3 ? ' low' : '');
    var formatted = bal.toLocaleString();
    el.querySelector('.n').textContent = formatted;
    if (dropBal) dropBal.textContent = formatted;

    el.title = bal < per
      ? 'Out of credits. Top up to keep studying.'
      : Math.floor(bal / per) + ' study actions left (' + per + ' credits each)';
  }

  /**
   * Mount the balance pill to the left of `where`.
   */
  function mountPill(where, opts) {
    pillCSS();
    if (document.getElementById('nouraCreditPill')) return;
    opts = opts || {};

    var wrap = document.createElement('div');
    wrap.className = 'noura-credit-pill-wrap';

    var el = document.createElement('div');
    el.id = 'nouraCreditPill';
    el.className = 'noura-credit-pill';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.innerHTML = '<svg class="sparkle-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c0 4.5-3.5 8-8 8 4.5 0 8 3.5 8 8 0-4.5 3.5-8 8-8-4.5 0-8-3.5-8-8z"/><path d="M19 3c0 1.5-1 2.5-2.5 2.5 1.5 0 2.5 1 2.5 2.5 0-1.5 1-2.5 2.5-2.5-1.5 0-2.5-1-2.5-2.5z" stroke-width="1.5"/></svg><span class="n">--</span>';

    // Dropdown matching user screenshot cleanly
    var drop = document.createElement('div');
    drop.id = 'nouraCreditDropdown';
    drop.className = 'nc-dropdown';
    drop.innerHTML =
      '<div class="nc-drop-top">' +
        '<div class="nc-drop-title">Free</div>' +
        '<button class="nc-drop-upgrade" type="button">Upgrade</button>' +
      '</div>' +
      '<div class="nc-drop-divider"></div>' +
      '<div class="nc-drop-banner">' +
        '<div class="nc-drop-banner-left">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c0 4.5-3.5 8-8 8 4.5 0 8 3.5 8 8 0-4.5 3.5-8 8-8-4.5 0-8-3.5-8-8z"/></svg>' +
          '<span>Noura 1.6 Lite is free for a limited time.</span>' +
        '</div>' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>' +
      '</div>' +
      '<div class="nc-stat-row">' +
        '<div class="nc-stat-header">' +
          '<div class="nc-stat-title-group">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c0 4.5-3.5 8-8 8 4.5 0 8 3.5 8 8 0-4.5 3.5-8 8-8-4.5 0-8-3.5-8-8z"/></svg>' +
            '<span>Credits</span>' +
            '<span class="nc-q-icon" title="Your total credit balance">?</span>' +
          '</div>' +
          '<span class="nc-stat-val-big" id="ncDropBalVal">--</span>' +
        '</div>' +
        '<div class="nc-stat-sub-group">' +
          '<span>Free credits</span>' +
          '<span>500</span>' +
        '</div>' +
        '</div>';

    wrap.appendChild(el);
    wrap.appendChild(drop);

    // Toggle dropdown on click
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      drop.classList.toggle('open');
    });

    document.addEventListener('click', function(e) {
      if (!wrap.contains(e.target)) {
        drop.classList.remove('open');
      }
    });

    var anchor = where && document.querySelector(where);

    if (anchor && opts.group) {
      var cs = getComputedStyle(anchor);
      var row = document.createElement('div');
      row.id = 'nouraTopRow';
      row.style.cssText = 'position:fixed;top:' + (cs.top !== 'auto' ? cs.top : '18px') +
        ';right:' + (cs.right !== 'auto' ? cs.right : '22px') +
        ';z-index:' + (cs.zIndex !== 'auto' ? cs.zIndex : '50') +
        ';display:flex;align-items:center;gap:' + (opts.gap || '12px');
      anchor.parentNode.insertBefore(row, anchor);
      anchor.style.position = 'relative';
      anchor.style.top = 'auto';
      anchor.style.right = 'auto';
      row.appendChild(wrap);
      row.appendChild(anchor);
    } else if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(wrap, anchor);
    } else {
      wrap.style.cssText = 'position:fixed;top:18px;right:22px;z-index:50';
      document.body.appendChild(wrap);
    }
    refresh();
  }

  function refresh() {
    var el = document.getElementById('nouraCreditPill');
    if (!el) return Promise.resolve(null);
    return window.fetch('/api/me').then(function (r) { return r.json(); })
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
    return window.fetch('/api/welcome', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.first_time) welcomeToast(d);
        refresh();
        return d;
      })
      .catch(function () { return null; });
  }

  window.NouraCredits = {
    accountEmail: accountEmail,
    mountPill: mountPill,
    refresh: refresh,
    claimWelcome: claimWelcome,
    async status() {
      try { return await (await window.fetch('/api/me')).json(); }
      catch (e) { return null; }
    }
  };
})();
