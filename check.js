function looksEnglishText(text) {
  if (!text) return false;
  const cleaned = String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[_\-]/g, ' ')
    .trim();
  if (!cleaned) return false;
  if (/[\u0600-\u06FF\u0750-\u077F\u0900-\u0DFF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(cleaned)) return false;
  return /[A-Za-z]/.test(cleaned);
}

function getWikiLabel(page) {
  const rawTitle = page.title.replace('File:', '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  return looksEnglishText(rawTitle) ? rawTitle : null;
}

  const input = document.getElementById('prompt');
  const waveform = document.getElementById('waveform');

  // Sidebar interactions
  document.querySelectorAll('.nav-item').forEach(i=>{
    i.addEventListener('click',()=> {
      document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
      i.classList.add('active');
    })
  });

  const sidebar = document.querySelector('.sidebar');
  const collapseBtn = document.getElementById('collapseBtn');
  const logoArea = document.getElementById('logoArea');
  const newChatNav = document.getElementById('newChatNav');

  collapseBtn?.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
  });

  logoArea?.addEventListener('click', () => {
    if (sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
    }
  });

  newChatNav?.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    newChatNav.classList.add('active');
  });

  // Send on Enter — triggers chat transition
  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    launchChat(text);
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  waveform?.addEventListener('click', sendMessage);

  // ===== CHAT INTERFACE =====
  const chatApp = document.getElementById('chatApp');
  const chatSidebar = document.getElementById('chatSidebar');
  const messagesArea = document.getElementById('messagesArea');
  const messagesCol = document.getElementById('messagesCol');
  const chatTitleText = document.getElementById('chatTitleText');
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');

  // Clone sidebar into chat view
  const origSidebar = document.querySelector('.app > .sidebar');

  function launchChat(firstMessage) {
    // Determine chat title/label
    const titleWords = firstMessage.split(' ').slice(0, 5).join(' ');
    const chatLabel = titleWords + (firstMessage.split(' ').length > 5 ? '…' : '');
    chatTitleText.textContent = chatLabel;

    // Add this chat to the history in the ORIGINAL sidebar FIRST
    const origHistory = origSidebar.querySelector('.history');
    if (origHistory) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.textContent = chatLabel;
      const header = origHistory.querySelector('.section-header');
      if (header && header.nextSibling) {
        origHistory.insertBefore(item, header.nextSibling);
      } else {
        origHistory.appendChild(item);
      }
    }

    // Clone sidebar content NOW that history is updated
    chatSidebar.innerHTML = origSidebar.innerHTML;
    // Preserve collapsed state
    if (origSidebar.classList.contains('collapsed')) {
      chatSidebar.classList.add('collapsed');
    } else {
      chatSidebar.classList.remove('collapsed');
    }

    // Re-wire sidebar collapse button in chat sidebar
    const chatCollapseBtn = chatSidebar.querySelector('#collapseBtn');
    const chatLogoArea = chatSidebar.querySelector('#logoArea');
    chatCollapseBtn?.addEventListener('click', () => {
      chatSidebar.classList.add('collapsed');
    });
    chatLogoArea?.addEventListener('click', () => {
      if (chatSidebar.classList.contains('collapsed')) {
        chatSidebar.classList.remove('collapsed');
      }
    });
    // Wire nav items in chat sidebar
    chatSidebar.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        chatSidebar.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
      });
    });

    // Show chat app
    chatApp.style.display = 'flex';
    messagesCol.innerHTML = '';

    // Append user message
    appendUserMsg(firstMessage);

    // Call Gemini API
    fetchAIResponse(firstMessage);
  }

  function appendUserMsg(text) {
    const div = document.createElement('div');
    div.className = 'msg-user';
    div.innerHTML = `<div class="msg-user-bubble">${escapeHtml(text)}</div>`;
    messagesCol.appendChild(div);
    scrollToBottom();
  }

  function appendThinking() {
    const div = document.createElement('div');
    div.className = 'msg-ai msg-thinking';
    div.id = 'thinkingMsg';
    div.innerHTML = `
      <div class="msg-ai-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a10 10 0 0 1 10 10c0 4-2.5 7.5-6 9"/>
          <path d="M12 22a10 10 0 0 1-10-10"/>
        </svg>
      </div>
      <div class="msg-ai-body" style="flex:1;min-width:0;">
        <div class="loading-dot"></div>
        
        <div class="thinking-container" style="display:none;">
          <div class="thinking-header">
            <div class="thinking-icon">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9"/>
                <path d="M12 7v5l3 2"/>
              </svg>
            </div>
            <span class="thinking-label">Thinking</span>
            <svg class="chevron" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="thinking-content"></div>
        </div>
        
        <div class="answer-container">
          <div class="answer-content msg-ai-text"></div>
        </div>
      </div>`;
    messagesCol.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendAIMsg(text) {
    const thinking = document.getElementById('thinkingMsg');
    if (thinking) thinking.remove();

    const div = document.createElement('div');
    div.className = 'msg-ai';
    div.innerHTML = `
      <div class="msg-ai-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a10 10 0 0 1 10 10c0 4-2.5 7.5-6 9"/>
          <path d="M12 22a10 10 0 0 1-10-10"/>
        </svg>
      </div>
      <div class="msg-ai-body">
        <div class="msg-ai-text">${text}</div>
        <div class="msg-ai-actions">
          <button title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/></svg></button>
          <button title="Regenerate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.74"/><path d="M21 3v6h-6"/></svg></button>
          <button title="Like"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9a2 2 0 0 0 2 2h2.5l4-6V8h-4l-1.5-4a2 2 0 0 0-3.8 1l1.8 6H7z"/><path d="M4 11v9"/></svg></button>
          <button title="Dislike"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13V4a2 2 0 0 1 2-2h2.5l4 6v8h-4l-1.5 4a2 2 0 0 1-3.8-1L8 13H7z"/><path d="M4 13V4"/></svg></button>
        </div>
      </div>`;
    messagesCol.appendChild(div);
    scrollToBottom();
    
    // Auto-render KaTeX math formulas in the newly appended div
    if (window.renderMathInElement) {
      renderMathInElement(div, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$', right: '$', display: false},
          {left: '\\(', right: '\\)', display: false},
          {left: '\\[', right: '\\]', display: true}
        ],
        throwOnError: false
      });
    }
    return div;
  }

  // Stable typing with RAF + batching
  function typeText(element, fullText, intervalMs, chunkSize, onComplete) {
    const totalLength = fullText.length;
    let index = 0;
    element.textContent = '';
    
    function tick() {
      if (index >= totalLength) {
        if (onComplete) onComplete();
        return;
      }
      
      const nextIndex = Math.min(index + chunkSize, totalLength);
      const visibleText = fullText.slice(0, nextIndex);
      
      requestAnimationFrame(() => {
        element.textContent = visibleText;
      });
      
      index = nextIndex;
      setTimeout(tick, intervalMs);
    }
    
    tick();
  }

  // Handle clicking thinking headers to expand/collapse
  document.addEventListener('click', (e) => {
    const header = e.target.closest('.thinking-header.clickable');
    if (header) {
      const container = header.closest('.thinking-container');
      const collapsed = container.classList.toggle('collapsed');
      header.classList.toggle('expanded', !collapsed);
    }
  });

  let chatContext = [];

  async function fetchAIResponse(userText) {
    appendThinking();

    // Add user msg to context in OpenAI format
    chatContext.push({ role: 'user', content: userText });

    let apiKey = '';
    try {
      const envRes = await fetch('.env.local', { cache: 'no-store' });
      if (envRes.ok) {
        const envText = await envRes.text();
        const match = envText.match(/OPENROUTER_API_KEY\s*=\s*['"]?(.*?)['"]?\s*(?:\n|$)/);
        if (match) apiKey = match[1].trim();
      }
    } catch (e) {
      console.warn('Could not fetch .env.local', e);
    }

    if (!apiKey || apiKey.includes('YOUR_OPENROUTER')) {
      appendAIMsg('Please add your OpenRouter API key to the <code>.env.local</code> file as <code>OPENROUTER_API_KEY=sk-or-...</code>');
      return;
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.href,
          'X-Title': 'Axoura AI'
        },
        body: JSON.stringify({
          model: 'cohere/north-mini-code:free',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...chatContext
          ]
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenRouter Error ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      const aiText = data.choices?.[0]?.message?.content || 'No response received.';

      // Add AI response to context
      chatContext.push({ role: 'assistant', content: aiText });
      
      // Parse out <think> block (handles <think>, <theink>, etc.)
      let thoughtText = '';
      let finalText = aiText;
      const thinkMatch = aiText.match(/<think[^>]*>([\s\S]*?)<\/think>/i);
      if (thinkMatch) {
        thoughtText = thinkMatch[1].trim();
        finalText = aiText.replace(/<think[^>]*>[\s\S]*?<\/think>/i, '').trim();
      } else {
        // Also try stripping if model forgot closing tag
        const thinkStart = aiText.indexOf('<think>');
        const thinkEnd = aiText.indexOf('</think>');
        if (thinkStart !== -1 && thinkEnd !== -1 && thinkEnd > thinkStart) {
          thoughtText = aiText.slice(thinkStart + 7, thinkEnd).trim();
          finalText = (aiText.slice(0, thinkStart) + aiText.slice(thinkEnd + 8)).trim();
        }
      }

      // Get the existing active message container
      const aiMsgDiv = document.getElementById('thinkingMsg');
      if (!aiMsgDiv) return;
      aiMsgDiv.removeAttribute('id');

      const loadingDot = aiMsgDiv.querySelector('.loading-dot');
      const thinkingContainer = aiMsgDiv.querySelector('.thinking-container');
      const thinkingContent = aiMsgDiv.querySelector('.thinking-content');
      const thinkingHeader = aiMsgDiv.querySelector('.thinking-header');
      const thinkingLabel = aiMsgDiv.querySelector('.thinking-label');
      const answerContent = aiMsgDiv.querySelector('.answer-content');

      // Build the final formatted HTML (always pre-render, never type raw markdown)
      function buildFormattedHTML(text) {
        let toolJson = null;
        const jsonRaw = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        try {
          const parsed = JSON.parse(jsonRaw);
          if (parsed && parsed.tool && parsed.explanation) toolJson = parsed;
        } catch(e) {}
        if (toolJson) return { type: 'tool', json: toolJson };

        // Markdown path
        const mathStore = [];
        let safeText = text
          .replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => { mathStore.push({ latex, display: true }); return `MATHPLACEHOLDER_${mathStore.length - 1}_END`; })
          .replace(/\$([^\n$]+?)\$/g, (_, latex) => { mathStore.push({ latex, display: false }); return `MATHPLACEHOLDER_${mathStore.length - 1}_END`; });

        let html = marked.parse(safeText);
        html = html.replace(/MATHPLACEHOLDER_(\d+)_END/g, (_, idx) => {
          const { latex, display } = mathStore[parseInt(idx)];
          try { return katex.renderToString(latex, { displayMode: display, throwOnError: false }); }
          catch (e) { return `<code>${latex}</code>`; }
        });
        html = html.replace(/<table>([\s\S]*?)<\/table>/g, `<div class="table-container"><div class="table-header"><span>Table</span><div class="table-header-actions"><button title="Copy" aria-label="Copy table data"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><button title="Download" aria-label="Download table data"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button></div></div><div style="overflow-x: auto;"><table>$1</table></div></div>`);
        return { type: 'markdown', html, rawText: text };
      }

      function renderFinalAnswer() {
        const result = buildFormattedHTML(finalText);
        if (result.type === 'tool') {
          answerContent.innerHTML = '';
          renderToolCardInline(result.json, answerContent);
        } else {
          // Render formatted HTML immediately — no raw-text typing for markdown
          answerContent.innerHTML = result.html;
          if (window.renderMathInElement) {
            renderMathInElement(answerContent, {
              delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
              ],
              throwOnError: false
            });
          }
          scrollToBottom();

          // Wikipedia image gallery
          const topicMatch = result.rawText.match(/## Problem \/ Topic\n(.*?)\n/);
          if (topicMatch && topicMatch[1].trim()) {
            fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(topicMatch[1].trim())}&gsrlimit=4&prop=pageimages&piprop=thumbnail&pithumbsize=400&format=json&origin=*`)
              .then(r => r.json())
              .then(imgData => {
                if (!imgData?.query?.pages) return;
                const imagesHTML = Object.values(imgData.query.pages).filter(p => p.thumbnail && getWikiLabel(p))
                  .map(p => `<div class="image-card"><img src="${p.thumbnail.source}" alt="${p.title}"><div class="source">Wikipedia</div></div>`).join('');
                if (imagesHTML) {
                  const visualH2 = Array.from(answerContent.querySelectorAll('h2')).find(el => el.textContent.includes('Visual Representation'));
                  if (visualH2) {
                    const galleryDiv = document.createElement('div');
                    galleryDiv.innerHTML = `<div class="gallery-title">Searched images</div><div class="image-gallery">${imagesHTML}</div>`;
                    visualH2.parentNode.insertBefore(galleryDiv, visualH2.nextSibling);
                  }
                }
              }).catch(() => {});
          }
        }
      }

      // --- UI Sequence ---
      // 1. Fade out loading dot
      if (loadingDot) {
        loadingDot.classList.add('fade-out');
        setTimeout(() => { loadingDot.style.display = 'none'; }, 200);
      }

      if (thoughtText) {
        // 2. Show thinking header with animation
        setTimeout(() => {
          thinkingContainer.style.display = 'block';
          requestAnimationFrame(() => thinkingHeader.classList.add('show'));
        }, 100);

        // 3. Type the thought text (plain text only, no HTML)
        setTimeout(() => {
          typeText(thinkingContent, thoughtText, 18, 3, () => {
            // 4. Mark as done, make clickable, collapse
            thinkingLabel.textContent = 'Thought for a moment';
            thinkingHeader.classList.add('clickable', 'expanded');
            setTimeout(() => {
              thinkingContainer.classList.add('collapsed');
              thinkingHeader.classList.remove('expanded');
              // 5. Render the final answer after collapse
              setTimeout(renderFinalAnswer, 350);
            }, 400);
          });
        }, 400);
      } else {
        // No think block — render answer immediately
        renderFinalAnswer();
      }
    } catch (err) {
      appendAIMsg('⚠️ Error communicating with OpenRouter API: ' + err.message);
    }
  }

  function scrollToBottom() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Chat input auto-resize
  chatInput?.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
    chatSendBtn.disabled = !chatInput.value.trim();
  });

  // Chat send
  function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    chatSendBtn.disabled = true;
    appendUserMsg(text);
    fetchAIResponse(text);
  }

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  chatSendBtn?.addEventListener('click', sendChatMessage);

  // Settings Menu Logic
  const userProfile = document.getElementById('userProfile');
  const settingsMenu = document.getElementById('settingsMenu');

  userProfile?.addEventListener('click', (e) => {
    if (!settingsMenu.contains(e.target)) {
      settingsMenu.classList.toggle('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (userProfile && !userProfile.contains(e.target)) {
      settingsMenu.classList.remove('open');
    }
  });

  // Settings Menu - Appearance
  const appearanceMenu = document.getElementById('appearance-menu');
  const appearanceValue = document.getElementById('appearance-value');
  appearanceMenu?.querySelectorAll('.sub-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      appearanceMenu.querySelectorAll('.sub-item').forEach(i => {
        i.classList.remove('active');
        const c = i.querySelector('.check'); if(c) c.remove();
      });
      item.classList.add('active');
      item.insertAdjacentHTML('beforeend', '<svg class="check" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>');
      
      const val = item.dataset.value;
      const currentLang = languageValue.dataset.currentLang || "English (United States)";
      const isChinese = currentLang === "简体中文 (中国大陆)";
      if (val === "Light") appearanceValue.textContent = isChinese ? "浅色" : "Light";
      else if (val === "Dark") appearanceValue.textContent = isChinese ? "深色" : "Dark";
      else appearanceValue.textContent = isChinese ? "跟随系统" : "System";
      
      if (val === "Light") {
        document.body.classList.add('light-mode');
      } else {
        document.body.classList.remove('light-mode');
      }
    });
  });

  // I18N Dictionary
  const translations = {
    "English (United States)": {
      search: "Search", new_chat: "New Chat", projects: "Projects", skills: "Skills and Connectors",
      projects: "Projects", new_project: "New Project", history: "History", settings: "Settings",
      upgrade_plan: "Upgrade plan", appearance: "Appearance", dark: "Dark", light: "Light", system: "System",
      language: "Language", help: "Help", sign_out: "Sign out", title: "What are we learning today?",
      placeholder: "What should we work on next?"
    },
    "简体中文 (中国大陆)": {
      search: "搜索", new_chat: "新对话", projects: "项目", skills: "技能与连接器",
      projects: "项目", new_project: "新项目", history: "历史记录", settings: "设置",
      upgrade_plan: "升级计划", appearance: "外观", dark: "深色", light: "浅色", system: "跟随系统",
      language: "语言", help: "帮助", sign_out: "退出登录", title: "我们今天学点什么？",
      placeholder: "接下来我们做什么？"
    }
  };

  function updateLanguage(lang) {
    const dict = translations[lang];
    if (!dict) return;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });
    const placeholderEl = document.querySelector('[data-i18n-placeholder]');
    if (placeholderEl && dict[placeholderEl.getAttribute('data-i18n-placeholder')]) {
      placeholderEl.placeholder = dict[placeholderEl.getAttribute('data-i18n-placeholder')];
    }
    
    const activeAppearance = appearanceMenu.querySelector('.active');
    if (activeAppearance) {
      const val = activeAppearance.dataset.value;
      const isChinese = lang === "简体中文 (中国大陆)";
      if (val === "Light") appearanceValue.textContent = isChinese ? "浅色" : "Light";
      else if (val === "Dark") appearanceValue.textContent = isChinese ? "深色" : "Dark";
      else appearanceValue.textContent = isChinese ? "跟随系统" : "System";
    }
  }

  // Settings Menu - Language
  const languageMenu = document.getElementById('language-menu');
  const languageValue = document.getElementById('language-value');
  languageMenu?.querySelectorAll('.sub-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      languageMenu.querySelectorAll('.sub-item').forEach(i => {
        i.classList.remove('active');
        const c = i.querySelector('.check'); if(c) c.remove();
      });
      item.classList.add('active');
      item.insertAdjacentHTML('beforeend', '<svg class="check" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>');
      
      const lang = item.dataset.lang;
      languageValue.textContent = lang;
      languageValue.dataset.currentLang = lang;
      
      updateLanguage(lang);
    });
  });

  settingsMenu?.querySelectorAll('.has-submenu').forEach(w => {
    w.querySelector('.row').addEventListener('click', (e) => {
      e.stopPropagation();
      settingsMenu.querySelectorAll('.has-submenu').forEach(o => { if(o!==w) o.classList.remove('active') });
      w.classList.toggle('active');
    });
  });

  // ============================================================
  //  INTERACTIVE TOOL RENDERERS
  // ============================================================

  const TOOL_LABELS = {
    triangle_visual:    'Geometry Visual',
    graph_plot:         'Function Graph',
    cell_process_visual:'Biology Process',
    physics_sim:        'Physics Simulation'
  };

  function renderToolCardInline(json, container) {
    const toolCard = document.createElement('div');
    toolCard.className = 'tool-card';

    // Header
    toolCard.innerHTML = `
      <div class="tool-card-header">
        <span class="tool-card-badge">${TOOL_LABELS[json.tool] || json.tool}</span>
        <span class="tool-card-title">${json.explanation.split('.')[0]}</span>
      </div>
      <div class="tool-card-body">${json.explanation}</div>
      ${json.steps ? `<div class="tool-steps"><ol>${json.steps.map(s => `<li>${s}</li>`).join('')}</ol></div>` : ''}
      <div class="tool-card-visual"></div>
      ${json.keyPoints ? `<div class="tool-keypoints">${json.keyPoints.map(k => `<span class="tool-keypoint-tag">${k}</span>`).join('')}</div>` : ''}
    `;

    const visualSlot = toolCard.querySelector('.tool-card-visual');
    container.appendChild(toolCard);
    scrollToBottom();

    // Dispatch to specific renderer
    requestAnimationFrame(() => {
      switch (json.tool) {
        case 'triangle_visual':    renderTriangle(visualSlot, json.data); break;
        case 'graph_plot':         renderGraph(visualSlot, json.data); break;
        case 'cell_process_visual':renderCellProcess(visualSlot, json.data); break;
        case 'physics_sim':        renderPhysicsSim(visualSlot, json.data); break;
        default: visualSlot.innerHTML = `<p style="color:#666;padding:16px;font-size:13px;">Unknown tool: ${json.tool}</p>`;
      }
    });
  }

  // ─── 1. TRIANGLE VISUAL ──────────────────────────────────────
  function renderTriangle(slot, data) {
    const a = parseFloat(data.a) || 3;
    const b = parseFloat(data.b) || 4;
    const c = Math.sqrt(a * a + b * b);

    const wrap = document.createElement('div');
    wrap.className = 'tool-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 300;
    canvas.style.cssText = 'width:100%;height:auto;';
    wrap.appendChild(canvas);
    slot.appendChild(wrap);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 480, 300);

    const scale = Math.min(160 / a, 160 / b);
    const px = 80, py = 230;
    const bx = px + b * scale, by = py;
    const cx2 = px, cy2 = py - a * scale;

    // Fill
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.lineTo(cx2, cy2); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();

    // Sides
    const drawLine = (x1, y1, x2, y2, color) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    };
    drawLine(px, py, bx, by, '#4ade80');    // base = b
    drawLine(px, py, cx2, cy2, '#60a5fa');  // height = a
    drawLine(bx, by, cx2, cy2, '#e879f9'); // hypotenuse = c

    // Right angle marker
    const s = 14;
    ctx.beginPath(); ctx.moveTo(px + s, py); ctx.lineTo(px + s, py - s); ctx.lineTo(px, py - s);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();

    // Labels
    ctx.font = 'bold 15px Inter, sans-serif';
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`b = ${b}`, (px + bx) / 2 - 20, py + 26);
    ctx.fillStyle = '#60a5fa';
    ctx.fillText(`a = ${a}`, px - 52, (py + cy2) / 2 + 5);
    ctx.fillStyle = '#e879f9';
    const mx = (bx + cx2) / 2, my = (by + cy2) / 2;
    ctx.fillText(`c = ${c.toFixed(2)}`, mx + 10, my - 8);

    // Formula
    ctx.font = '13px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(`a² + b² = c²   →   ${a}² + ${b}² = ${(a*a + b*b)}   →   c = ${c.toFixed(3)}`, px, 278);
  }

  // ─── 2. GRAPH PLOT ───────────────────────────────────────────
  function renderGraph(slot, data) {
    const eq = (data.equation || 'x^2').replace(/\^/g, '**');

    const wrap = document.createElement('div');
    wrap.className = 'tool-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 300;
    canvas.style.cssText = 'width:100%;height:auto;';
    wrap.appendChild(canvas);
    slot.appendChild(wrap);

    const ctx = canvas.getContext('2d');
    const W = 480, H = 300;
    ctx.clearRect(0, 0, W, H);

    const xRange = 10, yRange = 10;
    const ox = W / 2, oy = H / 2;
    const sx = W / (xRange * 2), sy = H / (yRange * 2);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let x = -xRange; x <= xRange; x++) {
      ctx.beginPath(); ctx.moveTo(ox + x * sx, 0); ctx.lineTo(ox + x * sx, H); ctx.stroke();
    }
    for (let y = -yRange; y <= yRange; y++) {
      ctx.beginPath(); ctx.moveTo(0, oy + y * sy); ctx.lineTo(W, oy + y * sy); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px Inter, sans-serif';
    for (let x = -xRange; x <= xRange; x += 2) {
      if (x !== 0) ctx.fillText(x, ox + x * sx - 5, oy + 16);
    }
    for (let y = -yRange; y <= yRange; y += 2) {
      if (y !== 0) ctx.fillText(-y, ox + 4, oy + y * sy + 4);
    }

    // Plot
    ctx.beginPath(); ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 2.5;
    let first = true;
    const safeEval = (x) => {
      try { return Function('x', `"use strict"; return (${eq})`)(x); }
      catch(e) { return NaN; }
    };
    for (let px = 0; px <= W; px++) {
      const x = (px - ox) / sx;
      const y = safeEval(x);
      if (!isFinite(y)) { first = true; continue; }
      const py = oy - y * sy;
      if (first) { ctx.moveTo(px, py); first = false; } else { ctx.lineTo(px, py); }
    }
    ctx.stroke();

    // Label
    ctx.fillStyle = '#818cf8'; ctx.font = 'bold 13px Inter, sans-serif';
    ctx.fillText(`y = ${data.equation}`, 10, 20);
  }

  // ─── 3. CELL PROCESS VISUAL ─────────────────────────────────
  function renderCellProcess(slot, data) {
    const process = (data.process || '').toLowerCase();

    const PROCESSES = {
      protein_synthesis: {
        title: 'Protein Synthesis',
        steps: [
          { icon: '🧬', title: 'DNA (Nucleus)', desc: 'Gene is read from double helix' },
          { icon: '📋', title: 'Transcription', desc: 'DNA → mRNA strand is created' },
          { icon: '🚪', title: 'Nuclear Export', desc: 'mRNA exits nucleus to cytoplasm' },
          { icon: '⚙️', title: 'Translation (Ribosome)', desc: 'mRNA decoded into amino acid chain' },
          { icon: '🔗', title: 'Polypeptide', desc: 'Chain folds into functional protein' },
        ]
      },
      photosynthesis: {
        title: 'Photosynthesis',
        steps: [
          { icon: '☀️', title: 'Light Capture', desc: 'Chlorophyll absorbs photons' },
          { icon: '💧', title: 'Water Splitting', desc: 'H₂O split → O₂ released' },
          { icon: '⚡', title: 'Light Reactions', desc: 'ATP + NADPH produced (thylakoid)' },
          { icon: '🔄', title: 'Calvin Cycle', desc: 'CO₂ fixed using ATP + NADPH (stroma)' },
          { icon: '🍬', title: 'Glucose Output', desc: 'C₆H₁₂O₆ produced and stored' },
        ]
      },
      dna_replication: {
        title: 'DNA Replication',
        steps: [
          { icon: '🔓', title: 'Helicase Unwinds', desc: 'Double helix is unwound at origin' },
          { icon: '📌', title: 'Primase Adds Primer', desc: 'RNA primer marks start point' },
          { icon: '🔗', title: 'DNA Polymerase', desc: 'New complementary strands synthesized' },
          { icon: '✂️', title: 'Okazaki Fragments Joined', desc: 'Lagging strand fragments ligated' },
          { icon: '✅', title: 'Two Identical Copies', desc: 'Each daughter cell gets one copy' },
        ]
      },
      cellular_respiration: {
        title: 'Cellular Respiration',
        steps: [
          { icon: '🍬', title: 'Glycolysis (Cytoplasm)', desc: 'Glucose → 2 pyruvate + 2 ATP' },
          { icon: '🔄', title: 'Pyruvate Oxidation', desc: 'Pyruvate → Acetyl-CoA + CO₂' },
          { icon: '⭕', title: 'Krebs Cycle (Matrix)', desc: '2 ATP + CO₂ + NADH per turn' },
          { icon: '⚡', title: 'Electron Transport Chain', desc: 'NADH → 34 ATP via proton gradient' },
          { icon: '💨', title: 'Final Products', desc: 'CO₂ + H₂O + ~36 ATP total' },
        ]
      },
      mitosis: {
        title: 'Mitosis',
        steps: [
          { icon: '🔵', title: 'Interphase', desc: 'DNA replication occurs' },
          { icon: '🌀', title: 'Prophase', desc: 'Chromosomes condense, spindle forms' },
          { icon: '📏', title: 'Metaphase', desc: 'Chromosomes align at cell plate' },
          { icon: '↔️', title: 'Anaphase', desc: 'Sister chromatids pulled apart' },
          { icon: '✂️', title: 'Telophase + Cytokinesis', desc: 'Two identical daughter cells form' },
        ]
      }
    };

    const def = PROCESSES[process] || {
      title: process.replace(/_/g,' '),
      steps: [{ icon: '🔬', title: 'Process', desc: 'See step-by-step explanation above' }]
    };

    const div = document.createElement('div');
    div.innerHTML = `
      <div style="padding:4px 0 12px;font-size:12px;font-weight:600;color:#A1A1AA;text-transform:uppercase;letter-spacing:0.06em;">${def.title}</div>
      <div class="cell-flow">
        ${def.steps.map((s, i) => `
          <div class="cell-step" style="animation-delay:${i * 0.08}s">
            <div class="cell-step-icon">${s.icon}</div>
            <div class="cell-step-info">
              <div class="cell-step-title">${i + 1}. ${s.title}</div>
              <div class="cell-step-desc">${s.desc}</div>
            </div>
          </div>
          ${i < def.steps.length - 1 ? '<div class="cell-arrow">↓</div>' : ''}
        `).join('')}
      </div>`;
    slot.appendChild(div);
  }

  // ─── 4. PHYSICS SIM ──────────────────────────────────────────
  function renderPhysicsSim(slot, data) {
    const type = (data.type || 'projectile').toLowerCase();
    const value = parseFloat(data.value) || 45;

    const wrap = document.createElement('div');
    wrap.className = 'tool-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 260;
    canvas.style.cssText = 'width:100%;height:auto;';
    wrap.appendChild(canvas);
    slot.appendChild(wrap);

    const ctx = canvas.getContext('2d');
    const W = 480, H = 260;
    let animId;

    if (type === 'projectile') {
      const angle = (value * Math.PI) / 180;
      const v0 = 60, g = 9.8;
      const T = (2 * v0 * Math.sin(angle)) / g;
      const R = v0 * Math.cos(angle) * T;
      const Hmax = (v0 * Math.sin(angle)) ** 2 / (2 * g);
      const scale = Math.min((W - 60) / R, (H - 60) / Hmax);
      let t = 0;

      const draw = () => {
        ctx.clearRect(0, 0, W, H);
        // Ground
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(30, H - 30); ctx.lineTo(W - 20, H - 30); ctx.stroke();
        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '12px Inter, sans-serif';
        ctx.fillText(`θ = ${value}°  |  v₀ = ${v0} m/s  |  g = ${g} m/s²`, 30, 20);
        ctx.fillText(`Range = ${R.toFixed(1)} m  |  Max Height = ${Hmax.toFixed(1)} m`, 30, 38);

        // Trajectory path
        ctx.beginPath(); ctx.strokeStyle = 'rgba(129,140,248,0.3)'; ctx.lineWidth = 1.5;
        for (let ti = 0; ti <= T; ti += 0.02) {
          const px = 30 + v0 * Math.cos(angle) * ti * scale;
          const py = H - 30 - v0 * Math.sin(angle) * ti * scale + 0.5 * g * ti * ti * scale;
          ti === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Ball
        const bx = 30 + v0 * Math.cos(angle) * t * scale;
        const by = H - 30 - v0 * Math.sin(angle) * t * scale + 0.5 * g * t * t * scale;
        ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#818cf8'; ctx.fill();
        ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 2; ctx.stroke();

        t += 0.04;
        if (t > T + 0.5) t = 0;
        animId = requestAnimationFrame(draw);
      };
      draw();
    } else if (type === 'gravity') {
      let y = 40, vy = 0, g = value || 9.8;
      const draw = () => {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '12px Inter, sans-serif';
        ctx.fillText(`Free Fall  |  g = ${g} m/s²`, 20, 20);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(W/2, 30); ctx.lineTo(W/2, H - 30); ctx.stroke();
        // Ball
        ctx.beginPath(); ctx.arc(W/2, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#34d399'; ctx.fill();
        // Ground
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(W/2 - 50, H - 32, 100, 6);
        vy += g * 0.04;
        y += vy * 0.8;
        if (y > H - 46) { y = H - 46; vy = -vy * 0.65; }
        animId = requestAnimationFrame(draw);
      };
      draw();
    } else {
      // Pendulum
      let theta = (value * Math.PI) / 180;
      let omega = 0;
      const L = 120, g = 9.8, dt = 0.05;
      const px = W / 2, py = 50;
      const draw = () => {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '12px Inter, sans-serif';
        ctx.fillText(`Pendulum  |  L = ${L} px  |  θ₀ = ${value}°`, 20, 20);
        const bx = px + L * Math.sin(theta);
        const by = py + L * Math.cos(theta);
        // Rod
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.stroke();
        // Bob
        ctx.beginPath(); ctx.arc(bx, by, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#f472b6'; ctx.fill();
        // Pivot
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fill();
        omega += -(g / L) * Math.sin(theta) * dt;
        theta += omega * dt;
        animId = requestAnimationFrame(draw);
      };
      draw();
    }

    // Cleanup when card scrolls out
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) { cancelAnimationFrame(animId); obs.disconnect(); }
    });
    obs.observe(canvas);
  }
