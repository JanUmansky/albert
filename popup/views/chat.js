/**
 * Albert — Chat View
 * Full conversational interface with persistent history.
 * Users can ask questions about the page AND request element creation.
 */

const ChatView = (() => {
  let messagesContainer;
  let inputEl;
  let sendBtn;
  let newChatBtn;
  let headerUrlEl;
  let isProcessing = false;
  let currentTabUrl = null;

  function init() {
    messagesContainer = document.getElementById('chat-messages');
    inputEl = document.getElementById('chat-input');
    sendBtn = document.getElementById('btn-send');
    newChatBtn = document.getElementById('btn-new-chat');
    headerUrlEl = document.getElementById('header-tab-url');

    // Auto-resize textarea
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
      sendBtn.disabled = !inputEl.value.trim() || isProcessing;
    });

    // Send on Enter (Shift+Enter for newline)
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (inputEl.value.trim() && !isProcessing) {
          handleSend();
        }
      }
    });

    sendBtn.addEventListener('click', handleSend);

    if (newChatBtn) {
      newChatBtn.addEventListener('click', handleNewChat);
    }

    // Listen for progress updates from the service worker during tool-call loops
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'CHAT_PROGRESS') {
        const loadingEl = document.getElementById('chat-loading');
        if (loadingEl) {
          const statusEl = loadingEl.querySelector('.loading-status');
          if (statusEl) {
            statusEl.textContent = message.status || '';
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        }
      }
    });

    // Load existing conversation for this tab
    loadConversation();
  }

  /**
   * Called when the active tab changes (tab switch or URL navigation).
   * Reloads the conversation for the new tab.
   */
  async function onTabChanged(tab) {
    if (!tab || !tab.url) return;

    // Skip if we're already showing this URL's conversation
    if (tab.url === currentTabUrl) return;

    // Don't interrupt an in-progress request
    if (isProcessing) return;

    currentTabUrl = tab.url;
    updateHeaderUrl(tab.url);

    // Reset chat UI and reload conversation for the new tab
    messagesContainer.innerHTML = '';
    showWelcome();

    try {
      const history = await AlbertStorage.getConversation(tab.url);
      if (history.length > 0) {
        const welcome = messagesContainer.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        for (const msg of history) {
          if (msg.role === 'user') {
            addMessage(msg.content, 'user');
          } else if (msg.role === 'assistant') {
            addMessage(msg.content, 'assistant', msg.hasElement, msg.isElementUpdate);
          }
        }
      }
    } catch {
      // Silently fail — keep welcome message
    }
  }

  function updateHeaderUrl(url) {
    if (!headerUrlEl) return;
    try {
      const parsed = new URL(url);
      // Show hostname + truncated path for a clean display
      let display = parsed.hostname;
      if (parsed.pathname && parsed.pathname !== '/') {
        display += parsed.pathname;
      }
      headerUrlEl.textContent = display;
      headerUrlEl.title = url;
    } catch {
      headerUrlEl.textContent = url;
      headerUrlEl.title = url;
    }
  }

  async function loadConversation() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      currentTabUrl = tab.url;
      updateHeaderUrl(tab.url);
      const history = await AlbertStorage.getConversation(tab.url);

      if (history.length > 0) {
        // Remove welcome message
        const welcome = messagesContainer.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        // Render conversation history
        for (const msg of history) {
          if (msg.role === 'user') {
            addMessage(msg.content, 'user');
          } else if (msg.role === 'assistant') {
            addMessage(msg.content, 'assistant', msg.hasElement, msg.isElementUpdate);
          }
        }
      }
    } catch (err) {
      // Silently fail — show welcome message
    }
  }

  async function handleNewChat() {
    if (isProcessing) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        await chrome.runtime.sendMessage({
          type: 'CLEAR_CONVERSATION',
          tabUrl: tab.url,
        });
      }
    } catch {
      // Best effort
    }

    // Clear the UI
    messagesContainer.innerHTML = '';
    showWelcome();
  }

  async function handleSend() {
    const prompt = inputEl.value.trim();
    if (!prompt || isProcessing) return;

    // Clear welcome message on first send
    const welcome = messagesContainer.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    // Add user message
    addMessage(prompt, 'user');

    // Clear input
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    isProcessing = true;

    // Show loading indicator
    const loadingEl = addLoading();

    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        throw new Error('No active tab found. Please navigate to a webpage first.');
      }

      currentTabUrl = tab.url;

      // Send to service worker
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT_MESSAGE',
        prompt,
        tabId: tab.id,
        tabUrl: tab.url,
      });

      // Remove loading
      loadingEl.remove();

      if (response.error) {
        addMessage(response.error, 'error');
      } else {
        addMessage(response.message, 'assistant', response.hasElement, response.isElementUpdate);
      }
    } catch (err) {
      loadingEl.remove();
      addMessage('Something went wrong: ' + err.message, 'error');
    } finally {
      isProcessing = false;
      sendBtn.disabled = !inputEl.value.trim();
    }
  }

  function addMessage(text, type, hasElement = false, isElementUpdate = false) {
    const div = document.createElement('div');
    div.className = `msg ${type}`;

    if (type === 'assistant' && hasElement) {
      const badge = document.createElement('span');
      badge.className = 'msg-element-badge';
      badge.textContent = isElementUpdate ? 'Element updated' : 'Element added';
      div.appendChild(badge);
    }

    const content = document.createElement('div');
    content.className = 'msg-content';

    if (type === 'assistant') {
      // Render markdown for assistant messages
      content.innerHTML = renderMarkdown(text);
    } else {
      content.textContent = text;
    }

    div.appendChild(content);
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return div;
  }

  /**
   * Lightweight markdown → HTML renderer.
   * Handles: bold, italic, inline code, code blocks, headings, lists, line breaks.
   * Escapes all HTML first to prevent injection.
   */
  function renderMarkdown(text) {
    // Escape HTML entities
    let s = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Protect fenced code blocks from inline processing
    const codeBlocks = [];
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      codeBlocks.push(`<pre><code>${code.trimEnd()}</code></pre>`);
      return `\x00CB${codeBlocks.length - 1}\x00`;
    });

    // Protect inline code spans
    const inlineCodes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, code) => {
      inlineCodes.push(`<code>${code}</code>`);
      return `\x00IC${inlineCodes.length - 1}\x00`;
    });

    // Bold: **text**
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text*
    s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

    // Headings: ## through #### → bold line
    s = s.replace(/^#{1,4}\s+(.+)$/gm, '<strong class="md-heading">$1</strong>');

    // Unordered lists: group consecutive "- item" or "* item" lines
    s = s.replace(/(?:^[*-]\s+.+(?:\n|$))+/gm, match => {
      const items = match.trim().split('\n')
        .map(line => `<li>${line.replace(/^[*-]\s+/, '')}</li>`)
        .join('');
      return `<ul>${items}</ul>\n`;
    });

    // Ordered lists: group consecutive "1. item" lines
    s = s.replace(/(?:^\d+\.\s+.+(?:\n|$))+/gm, match => {
      const items = match.trim().split('\n')
        .map(line => `<li>${line.replace(/^\d+\.\s+/, '')}</li>`)
        .join('');
      return `<ol>${items}</ol>\n`;
    });

    // Double newlines → paragraph break
    s = s.replace(/\n{2,}/g, '<br><br>');
    // Single newlines → line break (but not right before/after block elements)
    s = s.replace(/\n/g, '<br>');

    // Clean up stray <br> around block elements
    s = s.replace(/<br>(<\/?(?:ul|ol|pre|li))/g, '$1');
    s = s.replace(/(<\/?(?:ul|ol|pre)>)<br>/g, '$1');

    // Restore protected code blocks and inline codes
    s = s.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[i]);
    s = s.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[i]);

    return s;
  }

  function addLoading() {
    const div = document.createElement('div');
    div.className = 'msg-loading';
    div.id = 'chat-loading';
    div.innerHTML = `
      <div class="loading-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
      <div class="loading-status"></div>
    `;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return div;
  }

  function showWelcome() {
    const html = `
      <div class="welcome-message">
        <div class="welcome-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <h2>Welcome to Albert</h2>
        <p>Ask me anything about this page, or tell me to build something on it.</p>
      </div>`;
    messagesContainer.innerHTML = html;
  }

  return { init, onTabChanged };
})();
