(function (global) {
  'use strict';

  const PRACTICE_KEY = 'TEACHLOOP_AUTO_PRACTICE';

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const CHART_COLORS = ['#7FC8FF', '#84A15B', '#E88A7A', '#F5A623', '#C4B5FD', '#34D399'];

  function shortChartLabel(label) {
    let t = String(label || '').trim();
    // Drop leading date fragments so the pill stays short like the design
    t = t.replace(/^(early|mid|late)\s+\d{3,4}(-\d{2,4})?\s*[:\-–—]\s*/i, '');
    t = t.replace(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{3,4}\s*[:\-–—]\s*/i, '');
    t = t.replace(/^\d{3,4}(-\d{2,4})?\s*[:\-–—]\s*/i, '');
    // Prefer whole words — never cut mid-word with an ellipsis
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length > 4) t = words.slice(0, 4).join(' ');
    else if (t.length > 36) {
      const cut = t.slice(0, 36);
      const sp = cut.lastIndexOf(' ');
      t = (sp > 16 ? cut.slice(0, sp) : cut).trim();
    }
    return t || String(label || '').split(/\s+/).slice(0, 3).join(' ');
  }

  function termMeta(t) {
    if (!t) return null;
    if (typeof t === 'string') return { term: t, def: '' };
    return { term: t.term || t.word || '', def: t.def || t.definition || t.meaning || '' };
  }

  const IMG_CACHE_KEY = 'TEACHLOOP_IMG_CACHE_V3';

  function parseDiagramLabels(caption, query, title) {
    const raw = String(caption || '').trim();
    let parts = raw
      .split(/\s*[,;|/]\s*|\s+and\s+/i)
      .map(function (x) { return x.replace(/\.$/, '').trim(); })
      .filter(function (x) { return x && x.length > 1 && x.length < 42; });
    if (parts.length < 2) {
      const q = String(query || title || 'Key parts').trim();
      parts = [q.split(/\s+/).slice(0, 3).join(' ') || 'Structure'];
    }
    return parts.slice(0, 6);
  }

  // Real topic-aware, high-contrast SVG diagrams with clean typography & domain-specific visuals
  function buildLabeledDiagramSvg(title, labels) {
    const w = 960;
    const h = 720;
    const cx = 480;
    const cy = 360;
    const labs = (labels && labels.length ? labels : ['Key concept', 'Structure', 'Function', 'Process']).slice(0, 6);
    const left = labs.filter(function (_, i) { return i % 2 === 0; });
    const right = labs.filter(function (_, i) { return i % 2 === 1; });

    const rawTitle = String(title || 'Diagram').slice(0, 52);
    const textForMatch = (rawTitle + ' ' + labs.join(' ')).toLowerCase();

    function escXml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Determine domain category
    let domain = 'general';
    if (/cell|bio|organelle|dna|gene|plant|animal|bacteria|virus|tissue|membrane|mitochondria|nucleus|cytoplasm|ribosome|protein|enzyme|respiration|photosynthesis/i.test(textForMatch)) {
      domain = 'biology';
    } else if (/war|battle|wwii|wwi|treaty|empire|revolution|military|army|nazi|soviet|cold war|theatre|front|reich|allies|axis|inva|conquest|monarch/i.test(textForMatch)) {
      domain = 'history';
    } else if (/physic|atom|molecule|quantum|gravity|planet|orbit|star|solar|electron|proton|neutron|nuclear|chem|force|circuit|energy|wave|magnetic|optics/i.test(textForMatch)) {
      domain = 'physics';
    } else if (/code|comput|algorithm|network|database|ai|neural|data|server|api|logic|software|cpu|memory|compiler|binary|cloud/i.test(textForMatch)) {
      domain = 'tech';
    }

    let colors = ['#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EC4899', '#3B82F6'];
    let bgFill = '#FAFAFA';
    let cardStroke = '#E4E4E7';
    let centerSvg = '';

    if (domain === 'biology') {
      colors = ['#10B981', '#06B6D4', '#8B5CF6', '#F59E0B', '#14B8A6', '#6366F1'];
      // Detailed biological cell cross-section
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="180" ry="215" fill="#ECFDF5" stroke="#10B981" stroke-width="6" stroke-dasharray="8 4"/>';
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="164" ry="198" fill="#F0FDF4" stroke="#059669" stroke-width="4"/>';
      // Cytoplasm subtle organelle texture
      centerSvg += '<path d="M370 270 Q410 240 430 280 T390 320" fill="none" stroke="#6EE7B7" stroke-width="5" stroke-linecap="round"/>';
      centerSvg += '<path d="M530 430 Q570 400 590 440 T550 480" fill="none" stroke="#6EE7B7" stroke-width="5" stroke-linecap="round"/>';
      // Mitochondria capsules
      centerSvg += '<rect x="360" y="380" width="70" height="36" rx="18" fill="#FDE68A" stroke="#D97706" stroke-width="3"/>';
      centerSvg += '<path d="M375 398 Q395 385 415 398" fill="none" stroke="#B45309" stroke-width="2.5"/>';
      centerSvg += '<rect x="530" y="270" width="65" height="32" rx="16" fill="#FDE68A" stroke="#D97706" stroke-width="3"/>';
      centerSvg += '<path d="M545 286 Q562 276 580 286" fill="none" stroke="#B45309" stroke-width="2.5"/>';
      // Large Nucleus with double membrane & nucleolus
      centerSvg += '<circle cx="' + (cx + 10) + '" cy="' + (cy - 10) + '" r="68" fill="#EDE9FE" stroke="#7C3AED" stroke-width="5"/>';
      centerSvg += '<circle cx="' + (cx + 10) + '" cy="' + (cy - 10) + '" r="46" fill="#DDD6FE" stroke="#8B5CF6" stroke-width="3"/>';
      centerSvg += '<circle cx="' + (cx + 15) + '" cy="' + (cy - 12) + '" r="22" fill="#6D28D9"/>';
      // Ribosomes / micro dots
      centerSvg += '<circle cx="450" cy="460" r="4" fill="#3B82F6"/><circle cx="465" cy="475" r="4" fill="#3B82F6"/><circle cx="485" cy="465" r="4" fill="#3B82F6"/>';
      centerSvg += '<circle cx="400" cy="230" r="4" fill="#3B82F6"/><circle cx="420" cy="220" r="4" fill="#3B82F6"/>';
    } else if (domain === 'history') {
      colors = ['#DC2626', '#D97706', '#2563EB', '#475569', '#7C3AED', '#059669'];
      // Strategic Theatre / Conflict Map & Alliance Grid
      centerSvg += '<rect x="300" y="180" width="360" height="360" rx="20" fill="#FEF2F2" stroke="#DC2626" stroke-width="4"/>';
      // Map grid lines
      centerSvg += '<line x1="300" y1="270" x2="660" y2="270" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="300" y1="360" x2="660" y2="360" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="300" y1="450" x2="660" y2="450" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="390" y1="180" x2="390" y2="540" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="480" y1="180" x2="480" y2="540" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="570" y1="180" x2="570" y2="540" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      // Front lines & tactical arrows
      centerSvg += '<path d="M340 480 Q430 380 470 330 Q510 280 620 230" fill="none" stroke="#DC2626" stroke-width="5" stroke-linecap="round"/>';
      centerSvg += '<path d="M350 490 Q440 390 480 340 Q520 290 630 240" fill="none" stroke="#2563EB" stroke-width="3" stroke-dasharray="8 6"/>';
      // Central Shield / Insignia
      centerSvg += '<path d="M480 280 L530 310 V380 Q530 430 480 460 Q430 430 430 380 V310 Z" fill="#FFFFFF" stroke="#991B1B" stroke-width="4"/>';
      centerSvg += '<path d="M480 300 L515 322 V375 Q515 412 480 438 Q445 412 445 375 V322 Z" fill="#FEE2E2"/>';
      centerSvg += '<circle cx="480" cy="365" r="14" fill="#DC2626"/>';
      // Compass Rose
      centerSvg += '<g transform="translate(620, 220)">' +
        '<circle cx="0" cy="0" r="22" fill="#FFFFFF" stroke="#475569" stroke-width="2"/>' +
        '<polygon points="0,-18 4,-4 18,0 4,4 0,18 -4,4 -18,0 -4,-4" fill="#DC2626"/>' +
        '<text x="0" y="-22" text-anchor="middle" font-size="10" font-weight="800" fill="#475569">N</text>' +
      '</g>';
    } else if (domain === 'physics') {
      colors = ['#06B6D4', '#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899'];
      // Quantum / Atomic Planetary Orbits
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="200" ry="85" fill="none" stroke="#06B6D4" stroke-width="3.5" transform="rotate(30 ' + cx + ' ' + cy + ')"/>';
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="200" ry="85" fill="none" stroke="#3B82F6" stroke-width="3.5" transform="rotate(-30 ' + cx + ' ' + cy + ')"/>';
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="200" ry="85" fill="none" stroke="#8B5CF6" stroke-width="3.5" transform="rotate(90 ' + cx + ' ' + cy + ')"/>';
      // Orbiting particles with glowing halos
      centerSvg += '<circle cx="340" cy="270" r="10" fill="#06B6D4"/><circle cx="340" cy="270" r="16" fill="none" stroke="#06B6D4" stroke-width="2" stroke-opacity="0.5"/>';
      centerSvg += '<circle cx="620" cy="270" r="10" fill="#3B82F6"/><circle cx="620" cy="270" r="16" fill="none" stroke="#3B82F6" stroke-width="2" stroke-opacity="0.5"/>';
      centerSvg += '<circle cx="480" cy="540" r="10" fill="#8B5CF6"/><circle cx="480" cy="540" r="16" fill="none" stroke="#8B5CF6" stroke-width="2" stroke-opacity="0.5"/>';
      // Central Radiant Nucleus Cluster
      centerSvg += '<circle cx="' + cx + '" cy="' + cy + '" r="52" fill="#FEF3C7" stroke="#F59E0B" stroke-width="4"/>';
      centerSvg += '<circle cx="' + (cx - 14) + '" cy="' + (cy - 12) + '" r="20" fill="#EF4444"/>';
      centerSvg += '<circle cx="' + (cx + 14) + '" cy="' + (cy - 10) + '" r="20" fill="#3B82F6"/>';
      centerSvg += '<circle cx="' + (cx - 6) + '" cy="' + (cy + 14) + '" r="20" fill="#10B981"/>';
      centerSvg += '<circle cx="' + (cx + 14) + '" cy="' + (cy + 12) + '" r="18" fill="#F59E0B"/>';
    } else if (domain === 'tech') {
      colors = ['#8B5CF6', '#06B6D4', '#10B981', '#3B82F6', '#F59E0B', '#6366F1'];
      // Neural / System Architecture Pipeline Bus
      centerSvg += '<rect x="310" y="210" width="340" height="300" rx="16" fill="#F5F3FF" stroke="#7C3AED" stroke-width="4"/>';
      // PCB traces & connection lines
      centerSvg += '<path d="M340 260 H420 V340 H460" fill="none" stroke="#8B5CF6" stroke-width="3"/>';
      centerSvg += '<path d="M340 460 H420 V380 H460" fill="none" stroke="#8B5CF6" stroke-width="3"/>';
      centerSvg += '<path d="M620 260 H540 V340 H500" fill="none" stroke="#06B6D4" stroke-width="3"/>';
      centerSvg += '<path d="M620 460 H540 V380 H500" fill="none" stroke="#06B6D4" stroke-width="3"/>';
      // Central Processing Core Module
      centerSvg += '<rect x="440" y="320" width="80" height="80" rx="12" fill="#7C3AED" stroke="#5B21B6" stroke-width="3"/>';
      centerSvg += '<circle cx="480" cy="360" r="18" fill="#FFFFFF"/>';
      centerSvg += '<text x="480" y="365" text-anchor="middle" font-size="12" font-weight="900" fill="#7C3AED">CORE</text>';
      // Stage nodes
      centerSvg += '<circle cx="340" cy="260" r="12" fill="#10B981"/><circle cx="340" cy="460" r="12" fill="#10B981"/>';
      centerSvg += '<circle cx="620" cy="260" r="12" fill="#06B6D4"/><circle cx="620" cy="460" r="12" fill="#06B6D4"/>';
    } else {
      // General Dynamic Conceptual System Diagram
      colors = ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];
      centerSvg += '<circle cx="' + cx + '" cy="' + cy + '" r="170" fill="#EEF2FF" stroke="#4F46E5" stroke-width="4" stroke-dasharray="6 4"/>';
      centerSvg += '<circle cx="' + cx + '" cy="' + cy + '" r="120" fill="#E0E7FF" stroke="#6366F1" stroke-width="3"/>';
      // Flow rings & connecting hubs
      centerSvg += '<circle cx="' + (cx - 70) + '" cy="' + (cy - 60) + '" r="34" fill="#FFFFFF" stroke="#06B6D4" stroke-width="3"/>';
      centerSvg += '<circle cx="' + (cx + 70) + '" cy="' + (cy - 60) + '" r="34" fill="#FFFFFF" stroke="#10B981" stroke-width="3"/>';
      centerSvg += '<circle cx="' + cx + '" cy="' + (cy + 75) + '" r="34" fill="#FFFFFF" stroke="#F59E0B" stroke-width="3"/>';
      // Central focal icon
      centerSvg += '<circle cx="' + cx + '" cy="' + (cy - 5) + '" r="42" fill="#4F46E5"/>';
      centerSvg += '<circle cx="' + cx + '" cy="' + (cy - 5) + '" r="28" fill="#EEF2FF"/>';
      centerSvg += '<circle cx="' + cx + '" cy="' + (cy - 5) + '" r="14" fill="#4F46E5"/>';
    }

    let svg = '';
    svg += '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
    svg += '<rect width="100%" height="100%" fill="' + bgFill + '"/>';
    
    // Header Title
    svg += '<text x="' + cx + '" y="56" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="26" font-weight="800" fill="#09090B" letter-spacing="-0.02em">' + escXml(rawTitle) + '</text>';
    svg += '<text x="' + cx + '" y="84" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="13" font-weight="600" fill="#71717A" text-transform="uppercase" letter-spacing="0.08em">Interactive Concept Breakdown</text>';

    // Render central theme
    svg += centerSvg;

    // Draw Left & Right Callout Cards with Angled Pointers
    function drawSide(items, isLeft) {
      const n = Math.max(items.length, 1);
      items.forEach(function (lab, i) {
        const y = 175 + i * Math.min(130, 410 / n);
        const color = colors[i % colors.length];
        const cardX = isLeft ? 40 : 710;
        const cardW = 210;
        const cardH = 58;
        const pinX = isLeft ? (cardX + cardW) : cardX;
        const targetX = isLeft ? (cx - 150 + (i * 15)) : (cx + 150 - (i * 15));
        const targetY = cy - 60 + (i * 45);

        // Connection Line & Glowing Anchor
        svg += '<path d="M' + pinX + ' ' + (y + cardH / 2) + ' Q' + ((pinX + targetX) / 2) + ' ' + (y + cardH / 2) + ' ' + targetX + ' ' + targetY + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round"/>';
        svg += '<circle cx="' + targetX + '" cy="' + targetY + '" r="7" fill="' + color + '" stroke="#FFFFFF" stroke-width="2"/>';

        // Callout Card Box
        svg += '<rect x="' + cardX + '" y="' + y + '" width="' + cardW + '" height="' + cardH + '" rx="14" fill="#FFFFFF" stroke="' + color + '" stroke-width="2.5" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.06))"/>';
        
        // Color Accent Indicator Pill
        svg += '<circle cx="' + (isLeft ? (cardX + 22) : (cardX + 22)) + '" cy="' + (y + cardH / 2) + '" r="6" fill="' + color + '"/>';
        
        // Label Text
        const textX = cardX + 38;
        const maxTextW = cardW - 48;
        svg += '<text x="' + textX + '" y="' + (y + cardH / 2 + 6) + '" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="16" font-weight="700" fill="#18181B">' + escXml(String(lab).slice(0, 24)) + '</text>';
      });
    }

    drawSide(left, true);
    drawSide(right, false);

    svg += '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function resolveTopicImage(query, done, meta) {
    meta = meta || {};
    const q = String(query || '').trim();
    const title = meta.title || q || 'Diagram';
    const labels = parseDiagramLabels(meta.caption, q, title);
    if (!q && !labels.length) { done(null); return; }

    const cacheKey = (q + '|' + labels.join(',')).toLowerCase();
    const cached = readImgCache()[cacheKey];
    if (cached && String(cached).indexOf('data:image/svg') === 0) {
      done(cached);
      return;
    }

    const url = buildLabeledDiagramSvg(title, labels);
    writeImgCache(cacheKey, url);
    done(url);
  }

  function readImgCache() {
    try {
      const v = JSON.parse(localStorage.getItem(IMG_CACHE_KEY) || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch (e) { return {}; }
  }

  function writeImgCache(query, url) {
    try {
      const cache = readImgCache();
      cache[String(query || '').toLowerCase()] = url;
      const keys = Object.keys(cache);
      if (keys.length > 80) keys.slice(0, keys.length - 80).forEach(function (k) { delete cache[k]; });
      localStorage.setItem(IMG_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  function prefetchImage(src) {
    if (!src) return;
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    } catch (e) {}
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function p(text, withTerms) {
    const node = el('p', 'lf-p');
    if (!withTerms || !withTerms.length) {
      node.textContent = text;
      return node;
    }
    let rest = String(text || '');
    const parts = [];
    const metas = (withTerms || []).map(termMeta).filter(function (m) { return m && m.term; });
    // Apply longest terms first so nested matches don't break
    metas.sort(function (a, b) { return b.term.length - a.term.length; });
    metas.forEach(function (m) {
      const term = m.term;
      if (!term || rest.indexOf(term) === -1) return;
      const idx = rest.indexOf(term);
      if (idx > 0) parts.push(document.createTextNode(rest.slice(0, idx)));
      const b = el('span', 'lf-term');
      b.setAttribute('tabindex', '0');
      b.appendChild(document.createTextNode(term));
      if (m.def) {
        const tip = el('span', 'lf-term-tip');
        tip.textContent = m.def;
        b.appendChild(tip);
      }
      parts.push(b);
      rest = rest.slice(idx + term.length);
    });
    if (rest) parts.push(document.createTextNode(rest));
    if (parts.length) parts.forEach(function (x) { node.appendChild(x); });
    else node.textContent = text;
    return node;
  }

  function bulletList(items) {
    const ul = el('ul');
    (items || []).forEach(function (item) {
      const li = el('li');
      li.innerHTML = '<span></span><span>' + esc(item) + '</span>';
      ul.appendChild(li);
    });
    return ul;
  }

  const LessonFlow = {
    root: null,
    shell: null,
    main: null,
    footer: null,
    step: 0,
    visited: new Set([0]),
    expandedCards: new Set(),
    feedback: null,
    autoPractice: false,
    dark: true, // always dark
    data: null,
    callbacks: {},
    topicEmoji: '📖',

    totalSteps: function () {
      const steps = (this.data && this.data.flow && this.data.flow.steps) || [];
      return Math.max(steps.length, 1);
    },

    mount: function (container) {
      this.root = typeof container === 'string' ? document.getElementById(container) : container;
      if (!this.root) return;
      this.root.innerHTML = '';
      this.shell = el('div', 'lf-shell');
      this.root.appendChild(this.shell);
      this.renderChrome();
    },

    renderChrome: function () {
      const self = this;
      this.shell.innerHTML = '';

      const header = el('header', 'lf-header');
      const closeBtn = el('button', 'lf-close');
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      closeBtn.addEventListener('click', function () { self.close(); });

      const progress = el('div', 'lf-progress');
      progress.id = 'lfProgress';
      header.appendChild(closeBtn);
      header.appendChild(progress);


      this.main = el('main', 'lf-main');
      this.main.innerHTML = '<div class="lf-main-inner" id="lfMainInner"></div>';

      this.footer = el('footer', 'lf-footer');
      this.footer.innerHTML = '<div class="lf-footer-inner" id="lfFooterInner"></div>';

      this.shell.appendChild(header);
      this.shell.appendChild(this.main);
      this.shell.appendChild(this.footer);
      this.renderProgress();
      this.renderStep();
      this.renderFooter();
    },

    renderProgress: function () {
      const wrap = document.getElementById('lfProgress');
      if (!wrap) return;
      wrap.innerHTML = '';
      const self = this;
      const total = this.totalSteps();
      for (let i = 0; i < total; i++) {
        const dot = el('button', 'lf-dot' + (i === this.step ? ' active' : '') + (this.visited.has(i) ? ' visited' : ''));
        dot.type = 'button';
        dot.setAttribute('aria-label', 'Step ' + (i + 1));
        (function (idx) {
          dot.addEventListener('click', function () {
            if (self.visited.has(idx) || idx <= self.step) {
              self.step = idx;
              self.renderProgress();
              self.renderStep();
              self.renderFooter();
              if (self.main) self.main.scrollTop = 0;
            }
          });
        })(i);
        wrap.appendChild(dot);
      }
    },

    renderFooter: function () {
      const wrap = document.getElementById('lfFooterInner');
      if (!wrap) return;
      const total = this.totalSteps();
      const s = this.getStep(this.step);
      const kind = s.kind || this.inferKind(this.step, total);

      wrap.className = 'lf-footer-inner' + (this.step === 0 ? ' wide' : '');
      wrap.innerHTML = '';
      const self = this;

      if (kind === 'gate') return;

      if (this.step === 0) {
        const next = el('button', 'lf-btn lf-btn-next');
        next.textContent = 'Next';
        next.addEventListener('click', function () { self.goNext(); });
        wrap.appendChild(next);
        return;
      }

      const back = el('button', 'lf-btn lf-btn-back');
      back.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back';
      back.disabled = this.step <= 0;
      back.addEventListener('click', function () { self.goBack(); });

      const next = el('button', 'lf-btn lf-btn-next');
      const isLast = this.step >= total - 1;
      next.textContent = kind === 'reflection' || isLast ? 'Continue' : 'Next';
      next.addEventListener('click', function () {
        if (isLast) self.finish(false);
        else self.goNext();
      });

      wrap.appendChild(back);
      wrap.appendChild(next);
    },

    goNext: function () {
      if (this.step >= this.totalSteps() - 1) {
        this.finish(false);
        return;
      }
      this.step++;
      this.visited.add(this.step);
      this.renderProgress();
      this.renderStep();
      this.renderFooter();
      if (this.main) this.main.scrollTop = 0;
      if (this.callbacks.onStep) this.callbacks.onStep(this.step);
    },

    goBack: function () {
      if (this.step <= 0) return;
      this.step--;
      this.renderProgress();
      this.renderStep();
      this.renderFooter();
      if (this.main) this.main.scrollTop = 0;
    },

    getStep: function (i) {
      const steps = (this.data && this.data.flow && this.data.flow.steps) || [];
      return steps[i] || {};
    },

    inferKind: function (i, total) {
      const s = this.getStep(i);
      if (s.kind) return s.kind;
      const map = ['hook', 'baseline', 'context', 'compare', 'turning', 'consequence', 'synthesis', 'reflection', 'gate'];
      if (total <= map.length) return map[i] || 'content';
      return 'content';
    },

    renderStep: function () {
      const inner = document.getElementById('lfMainInner');
      if (!inner) return;
      inner.innerHTML = '';
      const s = this.getStep(this.step);
      const kind = this.inferKind(this.step, this.totalSteps());
      const wrap = el('div');

      switch (kind) {
        case 'hook': wrap.appendChild(this.renderHook(s)); break;
        case 'baseline':
        case 'content': wrap.appendChild(this.renderBaseline(s)); break;
        case 'context': wrap.appendChild(this.renderContext(s)); break;
        case 'compare': wrap.appendChild(this.renderCompare(s)); break;
        case 'turning': wrap.appendChild(this.renderTurning(s)); break;
        case 'consequence': wrap.appendChild(this.renderConsequence(s)); break;
        case 'synthesis': wrap.appendChild(this.renderSynthesis(s)); break;
        case 'table': wrap.appendChild(this.renderTable(s)); break;
        case 'reflection': wrap.appendChild(this.renderReflection(s)); break;
        case 'gate': wrap.appendChild(this.renderGate(s)); break;
        default: wrap.appendChild(this.renderBaseline(s)); break;
      }

      inner.appendChild(wrap);
    },

    renderHook: function (s) {
      const box = el('div', 'lf-hook');
      box.innerHTML = '<h1>' + esc(s.question || s.title || 'What makes this topic worth understanding?') + '</h1>' +
        '<p class="lf-subtitle">' + esc(s.subtitle || (this.data && this.data.title) || 'Your lesson') + '</p>';
      return box;
    },

    renderBaseline: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'The Starting Point')));
      const paras = s.paragraphs || (s.body ? [s.body] : []);
      const terms = s.highlightTerms || [];
      paras.forEach(function (txt) {
        box.appendChild(p(txt, terms.length ? terms : null));
      });

      const q = s.imageQuery || s.title || (this.data && this.data.title) || '';
      const captionText = s.imageCaption || s.imageAlt || s.title || '';
      const imgWrap = el('div', 'lf-image-wrap is-loading');
      const skeleton = el('div', 'lf-image-skeleton');
      skeleton.setAttribute('aria-hidden', 'true');
      imgWrap.appendChild(skeleton);
      box.appendChild(imgWrap);
      if (captionText) {
        box.appendChild(el('div', 'lf-image-caption', esc(captionText)));
      }

      function showImg(src, alt) {
        if (!src) {
          imgWrap.classList.remove('is-loading');
          imgWrap.classList.add('is-empty');
          return;
        }
        const img = document.createElement('img');
        img.alt = alt || captionText || '';
        img.decoding = 'async';
        img.loading = 'eager';
        img.onload = function () {
          imgWrap.classList.remove('is-loading');
          img.classList.add('is-ready');
          skeleton.style.display = 'none';
        };
        img.onerror = function () {
          img.remove();
          imgWrap.classList.remove('is-loading');
          imgWrap.classList.add('is-empty');
          skeleton.textContent = 'Diagram unavailable';
          skeleton.classList.add('lf-image-fallback-msg');
        };
        img.src = src;
        imgWrap.insertBefore(img, skeleton);
      }

      // Always use crisp SVG diagrams with real text labels (never AI image gibberish)
      if (s.imageUrl && String(s.imageUrl).indexOf('data:image/svg') === 0) {
        showImg(s.imageUrl, captionText || q);
      } else {
        resolveTopicImage(q, function (src) {
          if (src) s.imageUrl = src;
          showImg(src, captionText || q);
        }, { title: s.title || q, caption: captionText });
      }

      if (s.closing) box.appendChild(p(s.closing));
      if (s.callout) {
        const c = el('div', 'lf-callout');
        c.innerHTML = '<h3>' + esc(s.callout.title) + '</h3><p>' + esc(s.callout.body) + '</p>';
        box.appendChild(c);
      }
      return box;
    },

    renderContext: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'Setting the Scene')));
      const terms = s.highlightTerms || [];
      (s.paragraphs || []).forEach(function (txt) {
        box.appendChild(p(txt, terms.length ? terms : null));
      });
      if (s.callout) {
        const c = el('div', 'lf-callout');
        c.innerHTML = '<h3>' + esc(s.callout.title) + '</h3><p>' + esc(s.callout.body) + '</p>';
        box.appendChild(c);
      }
      return box;
    },

    renderCompare: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'Common Picture vs Reality')));
      (s.paragraphs || []).forEach(function (txt) { box.appendChild(p(txt)); });
      if (s.compareLabel) box.appendChild(el('div', 'lf-compare-label', esc(s.compareLabel)));
      const grid = el('div', 'lf-compare-grid');
      const oldCard = el('div', 'lf-compare-card');
      oldCard.appendChild(el('h4', null, esc(s.oldLabel || 'The old picture')));
      oldCard.appendChild(bulletList(s.oldPicture || []));
      const evCard = el('div', 'lf-compare-card');
      evCard.appendChild(el('h4', null, esc(s.evidenceLabel || 'What evidence shows')));
      evCard.appendChild(bulletList(s.evidence || []));
      grid.appendChild(oldCard);
      grid.appendChild(evCard);
      box.appendChild(grid);
      if (s.insight) box.appendChild(p(s.insight));
      return box;
    },

    renderTurning: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'The Turning Point')));
      (s.paragraphs || []).forEach(function (txt) { box.appendChild(p(txt)); });
      const card = el('div', 'lf-timeline-card');
      const head = el('div', 'lf-timeline-head');
      head.innerHTML = '<div class="lf-kicker">' + esc(s.timelineLabel || 'How the change unfolded') + '</div>' +
        '<div class="lf-badge">' + esc(String((s.milestones || []).length)) + ' Steps</div>';
      card.appendChild(head);
      const list = el('div', 'lf-milestones');
      (s.milestones || []).forEach(function (m, idx) {
        const item = el('div', 'lf-milestone');
        item.innerHTML = '<div class="lf-milestone-num">' + esc(String(m.num || idx + 1)) + '</div>' +
          '<h4>' + esc(m.title) + '</h4><p>' + esc(m.description) + '</p>';
        list.appendChild(item);
      });
      card.appendChild(list);
      box.appendChild(card);
      return box;
    },

    renderConsequence: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'What Changed After')));
      const terms = s.highlightTerms || [];
      (s.paragraphs || []).forEach(function (txt) {
        box.appendChild(p(txt, terms.length ? terms : null));
      });

      // Vertical flow diagram (artifact layout): top pill → two middles → purple outcome
      const flow = s.flow || {};
      const events = (s.events || []).slice(0, 4);
      function lab(x) {
        if (!x) return '';
        if (typeof x === 'string') return shortChartLabel(x);
        return shortChartLabel(x.label || x.title || x.text || '');
      }
      const top = lab(flow.top) || lab(events[0]) || 'Starting point';
      const midA = lab(flow.middle && flow.middle[0]) || lab(events[1]) || 'Path A';
      const midB = lab(flow.middle && flow.middle[1]) || lab(events[2]) || 'Path B';
      const bottom = lab(flow.bottom) || lab(events[3]) || 'Outcome';
      const flowTitle = flow.title || s.chartTitle || s.title || 'How it connects';

      const card = el('div', 'lf-flow');
      card.appendChild(el('div', 'lf-flow-title', esc(flowTitle)));

      const stack = el('div', 'lf-flow-stack');
      stack.appendChild(el('div', 'lf-flow-pill', esc(top)));
      stack.appendChild(el('div', 'lf-flow-arrow', '<span aria-hidden="true">↓</span>'));

      const mid = el('div', 'lf-flow-mid');
      mid.appendChild(el('div', 'lf-flow-box lf-flow-box-mid', esc(midA)));
      mid.appendChild(el('div', 'lf-flow-box lf-flow-box-mid', esc(midB)));
      stack.appendChild(mid);

      stack.appendChild(el('div', 'lf-flow-arrow', '<span aria-hidden="true">↓</span>'));
      stack.appendChild(el('div', 'lf-flow-box lf-flow-box-out', esc(bottom)));

      card.appendChild(stack);
      box.appendChild(card);
      return box;
    },

    renderSynthesis: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'Why This Matters')));
      (s.paragraphs || []).forEach(function (txt) { box.appendChild(p(txt)); });
      const cmp = s.comparison || {};
      const card = el('div', 'lf-timeline-card');
      card.style.textAlign = 'center';
      const kick = el('div', 'lf-kicker', esc(String(cmp.label || 'Two phases of our story').toUpperCase()));
      kick.style.textAlign = 'center';
      card.appendChild(kick);
      const grid = el('div', 'lf-synth-grid');
      ['before', 'after'].forEach(function (side) {
        const col = el('div', 'lf-synth-col');
        const phase = cmp[side] || {};
        col.innerHTML = '<div class="lf-synth-phase">' + esc(phase.title || (side === 'before' ? 'Before' : 'After')) + '</div>';
        const items = el('div', 'lf-synth-items');
        (phase.items || []).slice(0, 3).forEach(function (item) {
          let text = String(item || '').trim();
          const words = text.split(/\s+/);
          if (words.length > 8) text = words.slice(0, 8).join(' ');
          items.appendChild(el('div', 'lf-synth-item', esc(text)));
        });
        col.appendChild(items);
        grid.appendChild(col);
      });
      card.appendChild(grid);
      if (cmp.shared) {
        const shared = el('div', 'lf-synth-shared');
        const sharedText = String(cmp.shared);
        if (/^both have[:\s]/i.test(sharedText)) {
          shared.innerHTML = '<strong>Both have</strong><span>' + esc(sharedText.replace(/^both have[:\s]*/i, '')) + '</span>';
        } else {
          shared.innerHTML = '<strong>Both have</strong><span>' + esc(sharedText) + '</span>';
        }
        card.appendChild(shared);
      }
      box.appendChild(card);
      return box;
    },

    renderTable: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'Key Facts')));
      const terms = s.highlightTerms || [];
      (s.paragraphs || []).forEach(function (txt, idx) {
        box.appendChild(p(txt, idx === 0 ? terms : null));
      });
      const table = s.table || {};
      let headers = table.headers || [];
      let rows = table.rows || [];
      // Normalize object-row format {choice, shaping, why} from the design artifact
      if ((!rows.length) && Array.isArray(table.items)) {
        rows = table.items.map(function (it) {
          return [it.choice || it.col1 || '', it.shaping || it.col2 || '', it.why || it.col3 || ''];
        });
      }
      if (!headers.length && rows.length) {
        headers = ['Choice', 'Shaping experience', 'Why it is rational'];
      }
      if (headers.length && rows.length) {
        const wrap = el('div', 'lf-table-wrap');
        // Prefer the clean 3-column grid from the design when we have 3 columns
        if (headers.length === 3) {
          const head = el('div', 'lf-table-head');
          headers.forEach(function (h) {
            head.appendChild(el('span', null, esc(h)));
          });
          wrap.appendChild(head);
          rows.forEach(function (row) {
            const cells = Array.isArray(row) ? row : [row.choice || row.col1, row.shaping || row.col2, row.why || row.col3];
            const rowEl = el('div', 'lf-table-row');
            for (let i = 0; i < 3; i++) {
              rowEl.appendChild(el('span', null, esc(cells[i] != null ? cells[i] : '')));
            }
            wrap.appendChild(rowEl);
          });
        } else {
          let html = '<table class="lf-table"><thead><tr>';
          headers.forEach(function (h) { html += '<th>' + esc(h) + '</th>'; });
          html += '</tr></thead><tbody>';
          rows.forEach(function (row) {
            html += '<tr>';
            (Array.isArray(row) ? row : [row]).forEach(function (cell) {
              html += '<td>' + esc(cell) + '</td>';
            });
            html += '</tr>';
          });
          html += '</tbody></table>';
          wrap.innerHTML = html;
        }
        box.appendChild(wrap);
      }
      if (s.callout) {
        const c = el('div', 'lf-callout');
        c.innerHTML = '<h3>' + esc(s.callout.title) + '</h3><p>' + esc(s.callout.body) + '</p>';
        box.appendChild(c);
      }
      return box;
    },

    renderReflection: function (s) {
      const self = this;
      const box = el('div');
      box.appendChild(el('h1', 'lf-title center', esc(s.title || 'Review your notes, magic insights and knowledge cards')));

      box.appendChild(el('div', 'lf-section-label', 'My Notes'));
      box.appendChild(el('div', 'lf-dashed-box', 'No notes yet — highlight text to add one'));

      box.appendChild(el('div', 'lf-section-label', 'Magic Insights ✨'));
      box.appendChild(el('div', 'lf-dashed-box', 'Insights will appear as you learn'));

      box.appendChild(el('div', 'lf-section-label', 'Knowledge Cards'));
      const kcards = el('div', 'lf-kcards');
      (s.knowledgeCards || []).forEach(function (card, idx) {
        const item = el('div', 'lf-kcard' + (self.expandedCards.has(idx) ? ' open' : ''));
        const btn = el('button', 'lf-kcard-btn');
        btn.innerHTML = '<span>' + esc(card.title) + '</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
        btn.addEventListener('click', function () {
          if (self.expandedCards.has(idx)) self.expandedCards.delete(idx);
          else self.expandedCards.add(idx);
          self.renderStep();
        });
        item.appendChild(btn);
        item.appendChild(el('div', 'lf-kcard-body', esc(card.body)));
        kcards.appendChild(item);
      });
      box.appendChild(kcards);

      const fb = el('div', 'lf-feedback');
      fb.appendChild(el('div', 'lf-feedback-label', 'How was this lesson?'));
      const btns = el('div', 'lf-feedback-btns');
      ['👍', '👎'].forEach(function (emoji, idx) {
        const b = el('button');
        b.textContent = emoji;
        if ((idx === 0 && self.feedback === 'up') || (idx === 1 && self.feedback === 'down')) b.classList.add('active');
        b.addEventListener('click', function () {
          self.feedback = idx === 0 ? 'up' : 'down';
          self.renderStep();
        });
        btns.appendChild(b);
      });
      fb.appendChild(btns);
      box.appendChild(fb);
      return box;
    },

    renderGate: function (s) {
      const self = this;
      const box = el('div', 'lf-gate');
      box.innerHTML = '<div class="lf-gate-icon" aria-hidden="true"><div style="font-size:64px;line-height:1">📝</div></div>' +
        '<h1>' + esc(s.title || 'Want to finish a quick practice?') + '</h1>' +
        '<p>' + esc(s.body || 'A short practice can help make what you learned stick.') + '</p>';

      const toggleRow = el('div', 'lf-toggle-row');
      toggleRow.innerHTML = '<span>Apply to all future lessons in this course</span>';
      const toggle = el('button', 'lf-toggle' + (this.autoPractice ? ' on' : ''));
      toggle.type = 'button';
      toggle.innerHTML = '<span class="lf-toggle-knob"></span>';
      toggle.addEventListener('click', function () {
        self.autoPractice = !self.autoPractice;
        try { localStorage.setItem(PRACTICE_KEY, self.autoPractice ? '1' : '0'); } catch (e) {}
        self.renderStep();
      });
      toggleRow.appendChild(toggle);
      box.appendChild(toggleRow);

      const actions = el('div', 'lf-gate-actions');
      const notNow = el('button', 'lf-btn lf-btn-back');
      notNow.style.flex = '1';
      notNow.textContent = 'Not Now';
      notNow.addEventListener('click', function () { self.finish(false); });

      const start = el('button', 'lf-btn lf-btn-next');
      start.textContent = 'Start Practice';
      start.addEventListener('click', function () { self.finish(true); });

      actions.appendChild(notNow);
      actions.appendChild(start);
      box.appendChild(actions);
      return box;
    },

    prefetchImages: function () {
      const steps = (this.data && this.data.flow && this.data.flow.steps) || [];
      steps.forEach(function (s) {
        if (!s || (s.kind !== 'baseline' && s.kind !== 'content')) return;
        const q = s.imageQuery || s.title || '';
        const caption = s.imageCaption || s.imageAlt || s.title || '';
        resolveTopicImage(q, function (src) {
          if (!src) return;
          s.imageUrl = src;
          prefetchImage(src);
        }, { title: s.title || q, caption: caption });
      });
    },

    open: function (data, opts) {
      opts = opts || {};
      this.data = data;
      this.callbacks = {
        onClose: opts.onClose,
        onComplete: opts.onComplete,
        onPractice: opts.onPractice,
        onStep: opts.onStep
      };
      this.topicEmoji = opts.emoji || '📖';
      this.step = (typeof opts.startStep === 'number' && opts.startStep >= 0) ? opts.startStep : 0;
      this.visited = new Set();
      for (let i = 0; i <= this.step; i++) this.visited.add(i);
      this.expandedCards = new Set();
      this.feedback = null;
      try { this.autoPractice = localStorage.getItem(PRACTICE_KEY) === '1'; } catch (e) { this.autoPractice = false; }

      // Warm every diagram while the intro page is open so later pages appear ready
      this.prefetchImages();

      const player = this.root.parentElement;
      player.classList.add('open');
      player.setAttribute('data-theme', 'dark');
      document.body.classList.add('lf-active');
      this.renderChrome();
      if (this.main) this.main.scrollTop = 0;
    },

    close: function () {
      const player = this.root.parentElement;
      player.classList.remove('open');
      document.body.classList.remove('lf-active');
      if (this.callbacks.onClose) this.callbacks.onClose();
    },

    finish: function (startPractice) {
      document.body.classList.remove('lf-active');
      this.root.parentElement.classList.remove('open');
      if (this.callbacks.onComplete) this.callbacks.onComplete({ feedback: this.feedback, startPractice: startPractice, autoPractice: this.autoPractice });
      if (startPractice && this.callbacks.onPractice) this.callbacks.onPractice();
    }
  };

  global.LessonFlow = LessonFlow;
})(window);
