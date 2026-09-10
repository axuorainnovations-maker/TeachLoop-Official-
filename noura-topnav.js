/* Noura top account navigation — replaces credit pill + streak badge */
(function () {
  'use strict';
  if (window.__nouraTopNavMounted) return;
  window.__nouraTopNavMounted = true;

  function icon(n) {
    return '<svg class="ntn-icon" aria-hidden="true"><use href="#ntn-' + n + '"/></svg>';
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function mount() {
    if (document.getElementById('nouraTopNav')) return;

    var host = document.getElementById('nouraTopNavHost') || document.body;
    var root = document.createElement('div');
    root.id = 'nouraTopNav';
    root.innerHTML =
      '<svg style="display:none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>' +
      '<symbol id="ntn-fire" viewBox="0 0 24 24"><path d="M13 1C9 1 10 5 7 4 3 8 2 12 3 16c1 5 5 7 9 7s10-3 9-10C20 7 16 3 13 1zm-1 12c4 3 4 7 0 8-4-1-4-4 0-8z"/></symbol>' +
      '<symbol id="ntn-bolt" viewBox="0 0 24 24"><path d="M13 1 3 14q-1 2 1 2h6l-1 6q0 2 2 0L21 9q1-2-1-2h-6l1-5q0-2-2-1z"/></symbol>' +
      '<symbol id="ntn-timer" viewBox="0 0 24 24"><path d="M9 0h6v3H9zm3 4a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4 11-5-4 2-2 4 5z"/></symbol>' +
      '<symbol id="ntn-bell" viewBox="0 0 24 24"><path d="M12 1c-7 0-8 6-8 11l-2 5q0 2 2 2h16q2 0 2-2l-2-5c0-5-1-11-8-11zM8 21h8q-4 6-8 0"/></symbol>' +
      '<symbol id="ntn-chart" viewBox="0 0 24 24"><rect x="2" y="14" width="5" height="10" rx="2"/><rect x="9" y="1" width="5" height="23" rx="2"/><rect x="16" y="7" width="5" height="17" rx="2"/></symbol>' +
      '<symbol id="ntn-person" viewBox="0 0 24 24"><circle cx="12" cy="6" r="4"/><path d="M4 23v-6a8 8 0 0 1 16 0v6zM3 4a3 3 0 0 0 0 6l2-1V5zM21 4l-2 1v4l2 1a3 3 0 0 0 0-6M2 12q-4 4-1 9h2v-6zm20 0-1 3v6h2q3-5-1-9"/></symbol>' +
      '<symbol id="ntn-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11"/></symbol>' +
      '<symbol id="ntn-gear" viewBox="0 0 24 24"><path d="m9 0 6 0 1 3 3 1 3 3-1 3 3 2-2 5-3 1-1 4-5 2-2-3-4 1-3-4 1-3-3-2 2-5 3-1zm3 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10"/></symbol>' +
      '</defs></svg>' +

      '<nav class="ntn-nav" aria-label="Account navigation">' +
        '<button type="button" class="ntn-navicon" data-ntn-panel="ntn-study" aria-label="Study time">' + icon('timer') + '</button>' +
        '<button type="button" class="ntn-navicon ntn-notify-btn" data-ntn-panel="ntn-notifications" aria-label="Notifications">' +
          '<img class="ntn-notify-img" src="assets/nav/notify-icon.png" alt="" width="28" height="28" draggable="false">' +
        '</button>' +
        '<div class="ntn-metrics">' +
          '<button type="button" class="ntn-metric ntn-orange" data-ntn-panel="ntn-streak" id="nouraMetricStreakBtn" aria-label="Day streak">' +
            icon('fire') + '<span id="nouraMetricStreak">0</span>' +
          '</button>' +
          '<button type="button" class="ntn-metric ntn-purple" data-ntn-panel="ntn-energy" id="nouraMetricEnergyBtn" aria-label="Credits">' +
            icon('bolt') + '<span id="nouraMetricEnergy">0</span>' +
          '</button>' +
        '</div>' +
        '<button type="button" class="ntn-profile-trigger" data-ntn-panel="ntn-profile" aria-label="Profile"><span class="ntn-avatar" id="nouraNavAvatar"></span></button>' +
      '</nav>' +

      '<section id="ntn-study" class="ntn-panel ntn-study" aria-label="Study time">' +
        '<div class="ntn-row ntn-heading"><span>Study Time</span><button type="button" class="ntn-muted ntn-press" id="ntnOptions">☷ &nbsp; Options</button></div>' +
        '<div id="ntn-stats">' +
          '<div class="ntn-row"><span>Last 7 days</span><span class="ntn-muted" id="ntnWeekMins">0m</span></div>' +
          '<div class="ntn-days" id="ntnDays"></div>' +
          '<div class="ntn-row"><span class="ntn-muted">Today</span><span id="ntnTodayMins">0m</span></div>' +
          '<div class="ntn-progress" id="ntnProgress"></div>' +
          '<div class="ntn-row ntn-muted"><span><i class="ntn-dot"></i>Study</span><span id="ntnTodayLabel">0m</span></div>' +
        '</div>' +
        '<div class="ntn-timer">' +
          '<h3>Pomodoro</h3><div class="ntn-clock" id="ntnClock">25:00</div>' +
          '<span style="color:#33bcef">● &nbsp;</span>' +
          '<select aria-label="Study subject"><option>General study</option><option>Biology</option><option>Mathematics</option></select>' +
          '<p>Completed rounds count toward your study time</p>' +
          '<button type="button" class="ntn-primary ntn-press" id="ntnStart">▶ &nbsp;Start</button>' +
        '</div>' +
        '<button type="button" class="ntn-outline ntn-press" id="ntnViewActivity">View activity <span style="float:right">›</span></button>' +
      '</section>' +

      '<section id="ntn-notifications" class="ntn-panel ntn-notifications" aria-label="Notifications">' +
        '<div class="ntn-tabs"><button type="button" class="active ntn-press" data-ntn-tab="ntn-notices">Notifications</button><button type="button" class="ntn-press" data-ntn-tab="ntn-news">What\'s new</button></div>' +
        '<div id="ntn-notices">' +
          '<article class="ntn-notice"><div class="ntn-notice-art ntn-notice-teach"></div><div class="ntn-text"><p><b>Learn by Teaching</b> is ready<br><span class="ntn-muted">Teach an AI student and use the protege effect to lock in what you know.</span></p><button type="button" class="ntn-action ntn-press" data-ntn-teach>Start Teach Studio</button></div><button type="button" class="ntn-dismiss ntn-press" aria-label="Dismiss">×</button></article>' +
          '<article class="ntn-notice"><div class="ntn-notice-art ntn-books"></div><div class="ntn-text"><p>Keep your streak going<br><span class="ntn-muted">Open Study and complete one short session today.</span></p><button type="button" class="ntn-action ntn-press" id="ntnNoticeActivity">View activity</button></div><button type="button" class="ntn-dismiss ntn-press" aria-label="Dismiss">×</button></article>' +
        '</div>' +
        '<div id="ntn-news" class="ntn-empty" hidden>You\'re all caught up on Noura updates.</div>' +
      '</section>' +

      '<section id="ntn-streak" class="ntn-panel ntn-streak" aria-label="Day streak">' +
        '<div class="ntn-streak-art" role="img" id="ntnStreakArt" aria-label="Day streak"></div>' +
        '<div class="ntn-streak-summary">' +
          '<div class="ntn-streak-summary-title">Your streak</div>' +
          '<div class="ntn-streak-summary-desc" id="ntnStreakSummary">Study today to start your streak.</div>' +
          '<button type="button" class="ntn-outline ntn-press" id="ntnStreakActivity">View activity <span style="float:right">›</span></button>' +
        '</div>' +
        '<button type="button" class="ntn-accordion ntn-press" data-ntn-expand="ntn-streakhelp">How do streaks work? <span>⌄</span></button>' +
        '<div id="ntn-streakhelp" class="ntn-explanation" hidden>Study on Study or Teach Studio at least once a day. Missing a full calendar day resets the streak. Your top-nav flame shows days studied this week.</div>' +
      '</section>' +

      '<section id="ntn-energy" class="ntn-panel ntn-energy" aria-label="Credits">' +
        '<div class="ntn-energy-art" role="img" aria-label="Credits"></div>' +
        '<div class="ntn-energy-recharge" id="ntnEnergyRecharge">Credits refresh with your plan cycle</div>' +
        '<div class="ntn-energy-meta"><span>' + icon('bolt') + ' Energy</span><span id="ntnEnergyFrac">0/10</span></div>' +
        '<div class="ntn-energy-pills" id="ntnEnergyPills" aria-hidden="true"></div>' +
        '<button type="button" class="ntn-accordion ntn-press" data-ntn-expand="ntn-costs" aria-expanded="true">Credit costs and usage <span>⌃</span></button>' +
        '<div id="ntn-costs" class="ntn-costs"></div>' +
        '<button type="button" class="ntn-upgrade ntn-press" id="ntnUpgrade">Upgrade</button>' +
      '</section>' +

      '<section id="ntn-profile" class="ntn-panel ntn-profile" aria-label="Profile menu">' +
        '<div class="ntn-profile-head"><span class="ntn-avatar" id="ntnProfileAvatar"></span><div><div class="ntn-name" id="ntnProfileName">Account</div><div class="ntn-muted" id="ntnProfileSub">Noura</div><span class="ntn-badge" id="ntnProfileBadge">FREE</span></div><button type="button" class="ntn-edit ntn-press" id="ntnEditName" aria-label="Edit name">✎</button></div>' +
        '<div class="ntn-menu-group" id="ntn-account-items"></div>' +
        '<div class="ntn-menu-group" id="ntn-help-items"></div>' +
        '<div class="ntn-menu-group"><button type="button" class="ntn-menu-item ntn-press" id="ntnSignOut"><span style="font-size:23px">⇥</span>Sign Out</button></div>' +
      '</section>' +
      '<div class="ntn-toast" role="status" id="ntnToast"></div>';

    host.appendChild(root);

    // Fill dynamic lists
    var dayLabels = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'];
    root.querySelector('#ntnDays').innerHTML = dayLabels.map(function (d, i) {
      return '<div class="ntn-day' + (i === dayLabels.length - 1 ? ' is-today' : '') + '"><div class="ntn-bar"></div>' + d + '</div>';
    }).join('');

    root.querySelector('#ntn-costs').innerHTML = [
      ['Generate study package', '100'],
      ['Regenerate lesson set', '100'],
      ['Study Assistant chat', 'Free'],
      ['Teach Studio session', 'Free'],
      ['Flashcards (in package)', 'Incl.'],
      ['Notes (in package)', 'Incl.'],
      ['Recall / quiz checks', 'Incl.'],
      ['Session summary', 'Free']
    ].map(function (pair) {
      var cost = pair[1];
      var costHtml = (cost === 'Free' || cost === 'Incl.')
        ? '<span class="ntn-cost-free">' + cost + '</span>'
        : '<span>' + cost + icon('bolt') + '</span>';
      return '<div class="ntn-cost"><span>' + pair[0] + '</span>' + costHtml + '</div>';
    }).join('');

    var pills = root.querySelector('#ntnEnergyPills');
    if (pills) {
      pills.innerHTML = Array.from({ length: 20 }, function () {
        return '<i></i>';
      }).join('');
    }

    function menuItem(label, ic, cls, extra) {
      return '<button type="button" class="ntn-menu-item ntn-press ' + (cls || '') + '" data-ntn-menu="' + label + '">' +
        icon(ic) + '<span>' + label + '</span>' + (extra || '') + '</button>';
    }
    root.querySelector('#ntn-account-items').innerHTML =
      menuItem('Analytics', 'chart', '', '<span class="ntn-new">New</span>') +
      menuItem('Settings', 'gear') +
      menuItem('Upgrade', 'circle', 'ntn-purple');
    root.querySelector('#ntn-help-items').innerHTML =
      menuItem('Customer Support', 'circle') +
      menuItem('Report a Bug', 'circle', 'ntn-red') +
      menuItem('Switch to Light', 'circle');

    wire(root);
    syncProfile();
    syncCredits();
    if (typeof window.updateUserStreak === 'function') window.updateUserStreak();
  }

  function toast(msg) {
    var t = document.getElementById('ntnToast');
    if (!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.style.display = 'none'; }, 3500);
  }

  function closePanels(root) {
    root.querySelectorAll('.ntn-panel').forEach(function (p) { p.classList.remove('open'); });
    root.querySelectorAll('[data-ntn-panel]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    root._ntnCurrent = null;
  }

  function openActivity() {
    if (typeof window.openNouraActivity === 'function') window.openNouraActivity();
    else {
      var ov = document.getElementById('activityOverlay');
      if (ov) ov.classList.add('open');
    }
  }

  function wire(root) {
    root.querySelectorAll('[data-ntn-panel]').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = b.getAttribute('data-ntn-panel');
        var was = root._ntnCurrent === id;
        closePanels(root);
        if (!was) {
          var panel = document.getElementById(id);
          if (panel) {
            panel.classList.add('open');
            panel.classList.remove('ntn-pop');
            void panel.offsetWidth;
            panel.classList.add('ntn-pop');
          }
          b.setAttribute('aria-expanded', 'true');
          root._ntnCurrent = id;
        }
      });
    });

    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) closePanels(root);
      var d = e.target.closest && e.target.closest('.ntn-dismiss');
      if (d && root.contains(d)) {
        var notice = d.closest('.ntn-notice');
        if (notice) notice.remove();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanels(root);
    });

    root.querySelectorAll('[data-ntn-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tabs = b.parentElement.querySelectorAll('button');
        tabs.forEach(function (x) {
          x.classList.toggle('active', x === b);
          var pane = document.getElementById(x.getAttribute('data-ntn-tab'));
          if (pane) pane.hidden = x !== b;
        });
      });
    });

    root.querySelectorAll('[data-ntn-expand]').forEach(function (a) {
      a.addEventListener('click', function () {
        var t = document.getElementById(a.getAttribute('data-ntn-expand'));
        if (!t) return;
        t.hidden = !t.hidden;
        a.setAttribute('aria-expanded', String(!t.hidden));
        var chev = a.querySelector('span:last-child');
        if (chev) chev.textContent = t.hidden ? '⌄' : '⌃';
      });
    });

    var remaining = 1500, running = false, tick;
    var startBtn = root.querySelector('#ntnStart');
    var clock = root.querySelector('#ntnClock');
    function fmt(sec) {
      return Math.floor(sec / 60).toString().padStart(2, '0') + ':' + (sec % 60).toString().padStart(2, '0');
    }
    startBtn.addEventListener('click', function () {
      running = !running;
      startBtn.textContent = running ? 'Ⅱ  Pause' : '▶  Start';
      if (running) {
        tick = setInterval(function () {
          remaining--;
          clock.textContent = fmt(remaining);
          if (remaining <= 0) {
            clearInterval(tick);
            running = false;
            remaining = 1500;
            startBtn.textContent = '▶  Start';
            clock.textContent = fmt(remaining);
            toast('Study round complete!');
          }
        }, 1000);
      } else clearInterval(tick);
    });
    root.querySelector('#ntnOptions').addEventListener('click', function () {
      var n = prompt('Pomodoro duration in minutes', '25');
      if (n !== null && +n > 0 && +n <= 180) {
        clearInterval(tick);
        running = false;
        remaining = Math.round(+n * 60);
        clock.textContent = Math.floor(remaining / 60).toString().padStart(2, '0') + ':00';
        startBtn.textContent = '▶  Start';
      }
    });

    root.querySelector('#ntnViewActivity').addEventListener('click', function () {
      closePanels(root);
      openActivity();
    });
    root.querySelector('#ntnNoticeActivity').addEventListener('click', function () {
      closePanels(root);
      openActivity();
    });
    var streakAct = root.querySelector('#ntnStreakActivity');
    if (streakAct) {
      streakAct.addEventListener('click', function () {
        closePanels(root);
        openActivity();
      });
    }
    root.querySelector('[data-ntn-teach]').addEventListener('click', function () {
      closePanels(root);
      var teach = document.getElementById('aiStudentsNav');
      if (teach) teach.click();
    });
    root.querySelector('#ntnUpgrade').addEventListener('click', function () {
      closePanels(root);
      if (typeof window.openPricing === 'function') window.openPricing();
    });
    root.querySelector('#ntnEditName').addEventListener('click', function () {
      var nameEl = root.querySelector('#ntnProfileName');
      var n = prompt('Display name', nameEl.textContent);
      if (n && n.trim()) {
        nameEl.textContent = n.trim();
        try { localStorage.setItem('NOURA_NAME', n.trim()); } catch (e) {}
      }
    });
    root.querySelector('#ntnSignOut').addEventListener('click', function () {
      var btn = document.getElementById('pmLogout');
      if (btn) btn.click();
      else toast('Sign out from the sidebar profile menu.');
    });

    root.querySelectorAll('[data-ntn-menu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var label = btn.getAttribute('data-ntn-menu');
        if (label === 'Upgrade') {
          closePanels(root);
          if (typeof window.openPricing === 'function') window.openPricing();
          return;
        }
        if (label === 'Settings') {
          closePanels(root);
          if (typeof window.openNouraSettings === 'function') window.openNouraSettings();
          else {
            var gear = document.getElementById('pmSettings');
            if (gear) gear.click();
            else toast('Open settings from your account menu.');
          }
          return;
        }
        if (label === 'Switch to Light') {
          document.body.classList.toggle('light-mode');
          document.body.classList.toggle('light');
          btn.querySelector('span').textContent = document.body.classList.contains('light-mode') ? 'Switch to Dark' : 'Switch to Light';
          return;
        }
        if (label === 'Analytics') {
          closePanels(root);
          openActivity();
          return;
        }
        toast(label + ' is coming soon.');
      });
    });

    root.querySelectorAll('[data-ntn-msg]').forEach(function (b) {
      b.addEventListener('click', function () { toast(b.getAttribute('data-ntn-msg')); });
    });
  }

  function paintAvatar(node, url, initials) {
    if (!node) return;
    var safeInitials = (initials || 'A').slice(0, 2).toUpperCase();
    if (url) {
      node.classList.add('has-photo');
      node.style.backgroundImage = 'none';
      node.innerHTML = '<img src="' + String(url).replace(/"/g, '&quot;') + '" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove(\'has-photo\');this.parentElement.innerHTML=\'<span class=ntn-initials>' + safeInitials + '</span>\';">';
    } else {
      node.classList.remove('has-photo');
      node.style.backgroundImage = '';
      node.innerHTML = '<span class="ntn-initials">' + safeInitials + '</span>';
    }
  }

  function syncProfile(profile) {
    profile = profile || {};
    var name = (profile.name || localStorage.getItem('NOURA_NAME') || localStorage.getItem('NOURA_EMAIL') || 'Account').trim();
    var email = (profile.email || localStorage.getItem('NOURA_EMAIL') || '').trim();
    var avatar = (profile.avatar || localStorage.getItem('NOURA_AVATAR') || '').trim();
    if (name.indexOf('@') > -1) name = name.split('@')[0];
    var initials = profile.initials || (name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2) || 'A').toUpperCase();

    var nameEl = document.getElementById('ntnProfileName');
    if (nameEl) nameEl.textContent = name || 'Account';
    var subEl = document.getElementById('ntnProfileSub');
    if (subEl) subEl.textContent = 'Noura';
    var badge = document.getElementById('ntnProfileBadge');
    if (badge) {
      badge.textContent = (window.NouraCredits && window.NouraCredits.isUnlimited && window.NouraCredits.isUnlimited())
        ? 'UNLIMITED'
        : 'FREE';
    }
    paintAvatar(document.getElementById('nouraNavAvatar'), avatar, initials);
    paintAvatar(document.getElementById('ntnProfileAvatar'), avatar, initials);
  }

  function syncCredits() {
    var el = document.getElementById('nouraMetricEnergy');
    var btn = document.getElementById('nouraMetricEnergyBtn');
    if (!el) return;
    var unlimited = window.NouraCredits && window.NouraCredits.isUnlimited && window.NouraCredits.isUnlimited();
    var bal = 0;
    try {
      var raw = localStorage.getItem('NOURA_CREDITS_DATA_V1');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && typeof d.balance === 'number') bal = d.balance;
      }
    } catch (e) {}
    var pillN = document.querySelector('#nouraCreditPill .n');
    if (pillN && pillN.textContent) {
      var t = pillN.textContent.trim();
      if (t === '\u221E' || t === '∞') unlimited = true;
      else {
        var parsed = parseInt(t.replace(/,/g, ''), 10);
        if (isFinite(parsed)) bal = parsed;
      }
    }

    if (unlimited) {
      el.textContent = '\u221E';
      if (btn) btn.setAttribute('aria-label', 'Unlimited credits');
      paintEnergyBar(10, 10, true);
      return;
    }
    el.textContent = String(bal);
    if (btn) btn.setAttribute('aria-label', bal + ' credits');
    var packs = Math.min(10, Math.floor(bal / 100));
    paintEnergyBar(packs, 10, false);
  }

  function paintEnergyBar(filled, max, unlimited) {
    var frac = document.getElementById('ntnEnergyFrac');
    var pills = document.getElementById('ntnEnergyPills');
    var recharge = document.getElementById('ntnEnergyRecharge');
    if (frac) frac.textContent = unlimited ? 'Unlimited' : (filled + '/' + max + (filled >= max ? ' (max)' : ''));
    if (recharge) {
      recharge.innerHTML = unlimited
        ? 'Unlimited plan — no recharge wait'
        : '+0 ' + '<svg class="ntn-icon" aria-hidden="true"><use href="#ntn-bolt"/></svg>' + ' until your next credit refresh';
    }
    if (!pills) return;
    var segs = pills.querySelectorAll('i');
    var on = unlimited ? segs.length : Math.round((filled / max) * segs.length);
    segs.forEach(function (seg, i) {
      seg.classList.toggle('on', i < on);
    });
  }

  window.NouraTopNav = {
    mount: mount,
    syncCredits: syncCredits,
    syncProfile: syncProfile,
    setStreak: function (n) {
      var el = document.getElementById('nouraMetricStreak');
      var btn = document.getElementById('nouraMetricStreakBtn');
      if (el) el.textContent = String(n);
      if (btn) btn.setAttribute('aria-label', n + ' day streak');
      var art = document.getElementById('ntnStreakArt');
      if (art) art.setAttribute('aria-label', n + ' day streak');
      var sum = document.getElementById('ntnStreakSummary');
      if (sum) {
        sum.textContent = n <= 0
          ? 'Study today to start your streak.'
          : 'You\'ve studied ' + n + ' day' + (n === 1 ? '' : 's') + ' this week. Keep it going.';
      }
    },
    toast: toast
  };

  window.addEventListener('noura:credits-updated', syncCredits);
  window.addEventListener('noura:credits-exhausted', syncCredits);
  window.addEventListener('noura:plan-changed', function () {
    syncCredits();
    syncProfile();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
