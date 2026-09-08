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

  // Real SVG text labels — never AI image gibberish
  function buildLabeledDiagramSvg(title, labels) {
    const w = 960;
    const h = 720;
    const labs = (labels && labels.length ? labels : ['Key part']).slice(0, 6);
    const left = labs.filter(function (_, i) { return i % 2 === 0; });
    const right = labs.filter(function (_, i) { return i % 2 === 1; });
    const cx = 480;
    const cy = 360;
    const colors = ['#A78BFA', '#7FC8FF', '#34D399', '#F5A623', '#E88A7A', '#C4B5FD'];

    function escXml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    let svg = '';
    svg += '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
    svg += '<rect width="100%" height="100%" fill="#FAFAFA"/>';
    svg += '<text x="' + cx + '" y="56" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="28" font-weight="700" fill="#18181B">' + escXml(String(title || 'Diagram').slice(0, 48)) + '</text>';

    // Central organelle-style blob (readable schematic, not a photo)
    svg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="168" ry="210" fill="#EDE9FE" stroke="#7C3AED" stroke-width="8"/>';
    svg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="118" ry="155" fill="#DDD6FE" stroke="#8B5CF6" stroke-width="5"/>';
    svg += '<path d="M400 280 C430 320, 430 400, 400 440 C460 400, 460 320, 400 280" fill="none" stroke="#6D28D9" stroke-width="6" stroke-linecap="round"/>';
    svg += '<path d="M520 270 C490 315, 490 405, 520 450 C560 405, 560 315, 520 270" fill="none" stroke="#6D28D9" stroke-width="6" stroke-linecap="round"/>';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="36" fill="#C4B5FD" stroke="#5B21B6" stroke-width="4"/>';

    function drawSide(items, isLeft) {
      const n = Math.max(items.length, 1);
      items.forEach(function (lab, i) {
        const y = 170 + i * Math.min(120, 420 / n);
        const color = colors[i % colors.length];
        const tx = isLeft ? 72 : 888;
        const anchor = isLeft ? 'start' : 'end';
        const lineX2 = isLeft ? cx - 170 : cx + 170;
        svg += '<line x1="' + (isLeft ? 200 : 760) + '" y1="' + y + '" x2="' + lineX2 + '" y2="' + (cy - 40 + i * 28) + '" stroke="' + color + '" stroke-width="3"/>';
        svg += '<circle cx="' + (isLeft ? 200 : 760) + '" cy="' + y + '" r="8" fill="' + color + '"/>';
        svg += '<rect x="' + (isLeft ? 40 : 700) + '" y="' + (y - 28) + '" width="200" height="56" rx="14" fill="#FFFFFF" stroke="' + color + '" stroke-width="3"/>';
        svg += '<text x="' + tx + '" y="' + (y + 6) + '" text-anchor="' + anchor + '" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="20" font-weight="700" fill="#18181B">' + escXml(lab) + '</text>';
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
