/**
 * Albert — Elements View
 * Displays all generated elements, lets users toggle or delete them.
 * Clicking an element shows its code details (JS, CSS).
 */

const ElementsView = (() => {
  let listContainer;
  let filterContainer;
  let currentFilter = 'this-page'; // 'this-page' or 'all'
  let currentTabUrl = null;

  // Detail-view chat state
  let detailElementId = null;
  let detailActiveTab = 'js'; // 'js' or 'css'
  let detailChatInput = null;
  let detailChatSendBtn = null;
  let detailChatMessages = null;
  let detailChatProcessing = false;

  function init() {
    listContainer = document.getElementById('elements-list');
    filterContainer = document.getElementById('elements-filter');
    // Always fetch the active tab URL then render
    getCurrentTabUrl().then(url => {
      currentTabUrl = url;
      renderFilter();
      render();
    });
  }

  async function getCurrentTabUrl() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.url || null;
    } catch {
      return null;
    }
  }

  function renderFilter() {
    if (!filterContainer) return;
    filterContainer.innerHTML = `
      <button class="elements-filter-btn ${currentFilter === 'this-page' ? 'active' : ''}" data-filter="this-page">This page</button>
      <button class="elements-filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">All sites</button>
    `;
    filterContainer.querySelectorAll('.elements-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        renderFilter();
        render();
      });
    });
  }

  async function render() {
    const allElements = await AlbertStorage.getElements();

    // Filter based on current filter mode
    let elements = allElements;
    if (currentFilter === 'this-page' && currentTabUrl) {
      const normalizedTabUrl = AlbertStorage.normalizeUrl(currentTabUrl);
      elements = allElements.filter(el => AlbertStorage.normalizeUrl(el.url) === normalizedTabUrl);
    }

    if (elements.length === 0) {
      const isFiltered = currentFilter === 'this-page' && allElements.length > 0;
      listContainer.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <p>${isFiltered
            ? 'No elements on this page.<br>Switch to "All sites" to see others.'
            : 'No elements yet.<br>Use the chat to create your first one!'
          }</p>
        </div>
      `;
      return;
    }

    // Sort: newest first
    const sorted = [...elements].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    listContainer.innerHTML = sorted.map(el => createCardHTML(el)).join('');

    // Bind events
    listContainer.querySelectorAll('.toggle input').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        e.stopPropagation();
        handleToggle(e.target.dataset.id, e.target.checked);
      });
    });

    listContainer.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        handleDelete(id);
      });
    });

    // Card click → show detail
    listContainer.querySelectorAll('.element-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't trigger if they clicked toggle or delete
        if (e.target.closest('.toggle') || e.target.closest('.delete-btn')) return;
        const id = card.dataset.id;
        showDetail(id);
      });
    });
  }

  function createCardHTML(el) {
    const date = new Date(el.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    let hostname = '';
    try {
      hostname = new URL(el.url).hostname;
    } catch {
      hostname = el.url;
    }

    return `
      <div class="element-card" data-id="${el.id}">
        <div class="element-card-header">
          <div class="element-card-info">
            <div class="element-card-name" title="${escapeHtml(el.name)}">${escapeHtml(el.name)}</div>
            <div class="element-card-url" title="${escapeHtml(el.url)}">${escapeHtml(hostname)}</div>
          </div>
          <div class="element-card-actions">
            <label class="toggle" title="${el.enabled ? 'Disable' : 'Enable'}">
              <input type="checkbox" data-id="${el.id}" ${el.enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <button class="delete-btn" data-id="${el.id}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="element-card-date">${date}</div>
      </div>
    `;
  }

  // ── Detail View ──────────────────────────────────────

  async function showDetail(elementId) {
    const elements = await AlbertStorage.getElements();
    const el = elements.find(e => e.id === elementId);
    if (!el) return;

    // Track current element for chat
    detailElementId = elementId;

    // Populate detail header
    document.getElementById('detail-title').textContent = el.name;

    // Description
    const descEl = document.getElementById('detail-description');
    descEl.textContent = el.description || '';

    // URL
    let hostname = '';
    try { hostname = new URL(el.url).hostname; } catch { hostname = el.url; }
    document.getElementById('detail-url').textContent = hostname;

    // Date
    const date = new Date(el.createdAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    document.getElementById('detail-date').textContent = date;

    // Code panels
    populateCodePanel('detail-code-js', 'detail-code-js-content', el.code?.js, 'No JavaScript code', 'js');
    populateCodePanel('detail-code-css', 'detail-code-css-content', el.code?.css, 'No CSS code', 'css');

    // Reset to JS tab
    setActiveTab('js');

    // Bind tab clicks
    document.querySelectorAll('#view-element-detail .detail-tab').forEach(tab => {
      tab.onclick = () => setActiveTab(tab.dataset.tab);
    });

    // Initialize detail chat
    initDetailChat();

    // Navigate to detail view
    App.navigateTo('elementDetail');
  }

  function populateCodePanel(panelId, codeId, code, emptyMessage, lang) {
    const panel = document.getElementById(panelId);
    const codeEl = document.getElementById(codeId);

    if (code && code.trim()) {
      // Apply syntax highlighting
      const highlighted = lang === 'js'
        ? SyntaxHighlight.highlightJS(code)
        : SyntaxHighlight.highlightCSS(code);
      codeEl.innerHTML = highlighted;
      // Show the pre/code, remove any empty placeholder
      const existing = panel.querySelector('.detail-code-empty');
      if (existing) existing.remove();
      panel.querySelector('.detail-code').style.display = '';
    } else {
      codeEl.innerHTML = '';
      panel.querySelector('.detail-code').style.display = 'none';
      // Add empty message if not already there
      if (!panel.querySelector('.detail-code-empty')) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'detail-code-empty';
        emptyDiv.textContent = emptyMessage;
        panel.appendChild(emptyDiv);
      }
    }
  }

  function setActiveTab(tabName) {
    detailActiveTab = tabName;
    document.querySelectorAll('#view-element-detail .detail-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('#view-element-detail .detail-code-panel').forEach(p => {
      p.classList.toggle('active', p.id === `detail-code-${tabName}`);
    });
    // Update chat placeholder to reflect active tab
    if (detailChatInput) {
      const lang = tabName === 'js' ? 'JavaScript' : 'CSS';
      detailChatInput.placeholder = `Ask about or modify the ${lang}...`;
    }
  }

  // ── Detail Chat ─────────────────────────────────────

  function initDetailChat() {
    detailChatMessages = document.getElementById('detail-chat-messages');
    detailChatInput = document.getElementById('detail-chat-input');
    detailChatSendBtn = document.getElementById('detail-chat-send');

    // Clear previous chat messages
    detailChatMessages.innerHTML = '';
    detailChatProcessing = false;

    // Update placeholder for active tab
    const lang = detailActiveTab === 'js' ? 'JavaScript' : 'CSS';
    detailChatInput.placeholder = `Ask about or modify the ${lang}...`;

    // Remove old listeners by replacing elements
    const newInput = detailChatInput.cloneNode(true);
    detailChatInput.parentNode.replaceChild(newInput, detailChatInput);
    detailChatInput = newInput;

    const newBtn = detailChatSendBtn.cloneNode(true);
    detailChatSendBtn.parentNode.replaceChild(newBtn, detailChatSendBtn);
    detailChatSendBtn = newBtn;

    // Auto-resize textarea
    detailChatInput.addEventListener('input', () => {
      detailChatInput.style.height = 'auto';
      detailChatInput.style.height = Math.min(detailChatInput.scrollHeight, 80) + 'px';
      detailChatSendBtn.disabled = !detailChatInput.value.trim() || detailChatProcessing;
    });

    // Send on Enter (Shift+Enter for newline)
    detailChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (detailChatInput.value.trim() && !detailChatProcessing) {
          handleDetailChatSend();
        }
      }
    });

    detailChatSendBtn.addEventListener('click', handleDetailChatSend);
  }

  async function handleDetailChatSend() {
    const prompt = detailChatInput.value.trim();
    if (!prompt || detailChatProcessing || !detailElementId) return;

    // Add user message to chat
    addDetailChatMessage(prompt, 'user');

    // Clear input
    detailChatInput.value = '';
    detailChatInput.style.height = 'auto';
    detailChatSendBtn.disabled = true;
    detailChatProcessing = true;

    // Show loading
    const loadingEl = addDetailChatLoading();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error('No active tab found.');
      }

      // Send scoped chat message to service worker
      const response = await chrome.runtime.sendMessage({
        type: 'ELEMENT_CODE_CHAT',
        elementId: detailElementId,
        codeType: detailActiveTab, // 'js' or 'css'
        prompt,
        tabId: tab.id,
        tabUrl: tab.url,
      });

      loadingEl.remove();

      if (response.error) {
        addDetailChatMessage(response.error, 'error');
      } else {
        addDetailChatMessage(response.message, 'assistant', response.codeUpdated);

        // If code was updated, refresh the code panel and page
        if (response.codeUpdated) {
          await refreshDetailView();
        }
      }
    } catch (err) {
      loadingEl.remove();
      addDetailChatMessage('Something went wrong: ' + err.message, 'error');
    } finally {
      detailChatProcessing = false;
      detailChatSendBtn.disabled = !detailChatInput.value.trim();
    }
  }

  function addDetailChatMessage(text, type, codeUpdated = false) {
    const div = document.createElement('div');
    div.className = `msg ${type}`;

    if (type === 'assistant' && codeUpdated) {
      const badge = document.createElement('span');
      badge.className = 'msg-code-badge';
      badge.textContent = `${detailActiveTab.toUpperCase()} updated`;
      div.appendChild(badge);
    }

    const content = document.createElement('span');
    content.textContent = text;
    div.appendChild(content);

    detailChatMessages.appendChild(div);
    detailChatMessages.scrollTop = detailChatMessages.scrollHeight;
    return div;
  }

  function addDetailChatLoading() {
    const div = document.createElement('div');
    div.className = 'msg-loading';
    div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    detailChatMessages.appendChild(div);
    detailChatMessages.scrollTop = detailChatMessages.scrollHeight;
    return div;
  }

  /**
   * Refresh the detail view after a code update.
   * Re-reads the element from storage and re-populates the code panels.
   */
  async function refreshDetailView() {
    if (!detailElementId) return;
    const elements = await AlbertStorage.getElements();
    const el = elements.find(e => e.id === detailElementId);
    if (!el) return;

    populateCodePanel('detail-code-js', 'detail-code-js-content', el.code?.js, 'No JavaScript code', 'js');
    populateCodePanel('detail-code-css', 'detail-code-css-content', el.code?.css, 'No CSS code', 'css');
  }

  // ── Handlers ─────────────────────────────────────────

  async function handleToggle(id, enabled) {
    await AlbertStorage.toggleElement(id, enabled);
    // Reload the tab so the page reflects the toggled state.
    // autoLoadElements() in the content script will only inject enabled elements.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.reload(tab.id);
      }
    } catch {
      // Tab may not be accessible
    }
  }

  async function handleDelete(id) {
    await AlbertStorage.removeElement(id);
    // Notify content script to remove
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'REMOVE_ELEMENT',
          elementId: id,
        });
      }
    } catch {
      // Tab may not be accessible
    }
    // Re-render
    render();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Called when the active tab changes.
   * Updates the cached URL so the "This page" filter is accurate.
   */
  function onTabChanged(tab) {
    if (!tab || !tab.url) return;
    if (tab.url === currentTabUrl) return;

    currentTabUrl = tab.url;

    // If the elements view is currently visible, re-render immediately
    if (document.getElementById('view-elements').classList.contains('active')) {
      render();
    }
  }

  return { init, render, onTabChanged };
})();
