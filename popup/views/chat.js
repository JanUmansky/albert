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
      // Add a small indicator that an element was created or updated
      const badge = document.createElement('span');
      badge.className = 'msg-element-badge';
      badge.textContent = isElementUpdate ? 'Element updated' : 'Element added';
      div.appendChild(badge);
    }

    const content = document.createElement('span');
    content.textContent = text;
    div.appendChild(content);

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return div;
  }

  function addLoading() {
    const div = document.createElement('div');
    div.className = 'msg-loading';
    div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
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
