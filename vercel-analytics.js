/**
 * Vercel Web Analytics for static HTML pages.
 * This project is not Next.js — do NOT use @vercel/analytics/next.
 * Enable "Web Analytics" in the Vercel project dashboard after deploy.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.va =
    window.va ||
    function () {
      (window.vaq = window.vaq || []).push(arguments);
    };

  // Avoid double-inject
  if (document.querySelector('script[data-noura-vercel-analytics]')) return;

  var s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  s.setAttribute('data-noura-vercel-analytics', '1');
  document.head.appendChild(s);
})();
