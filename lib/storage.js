/**
 * Albert - Shared Storage Helpers
 * Provides read/write access to chrome.storage.local for elements and settings.
 */

const AlbertStorage = (() => {
  const KEYS = {
    SETTINGS: 'albert_settings',
    ELEMENTS: 'albert_elements',
    CONVERSATIONS: 'albert_conversations',
  };

  const DEFAULT_SETTINGS = {
    provider: 'grok',
    apiKey: '',
    model: 'grok-3',
    baseUrl: 'https://api.x.ai/v1',
    allowElementLLMAccess: true,
  };

  // ── Settings ──────────────────────────────────────────

  async function getSettings() {
    const result = await chrome.storage.local.get(KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(result[KEYS.SETTINGS] || {}) };
  }

  async function saveSettings(settings) {
    const current = await getSettings();
    const merged = { ...current, ...settings };
    await chrome.storage.local.set({ [KEYS.SETTINGS]: merged });
    return merged;
  }

  // ── Elements ──────────────────────────────────────────

  async function getElements() {
    const result = await chrome.storage.local.get(KEYS.ELEMENTS);
    return result[KEYS.ELEMENTS] || [];
  }

  async function getElementsForUrl(url) {
    const elements = await getElements();
    const normalized = normalizeUrl(url);
    return elements.filter(el => normalizeUrl(el.url) === normalized && el.enabled);
  }

  async function addElement(element) {
    const elements = await getElements();
    elements.push(element);
    await chrome.storage.local.set({ [KEYS.ELEMENTS]: elements });
    return element;
  }

  async function removeElement(id) {
    let elements = await getElements();
    elements = elements.filter(el => el.id !== id);
    await chrome.storage.local.set({ [KEYS.ELEMENTS]: elements });
    return elements;
  }

  async function updateElement(id, updates) {
    const elements = await getElements();
    const index = elements.findIndex(el => el.id === id);
    if (index === -1) return null;
    elements[index] = { ...elements[index], ...updates, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [KEYS.ELEMENTS]: elements });
    return elements[index];
  }

  async function toggleElement(id, enabled) {
    const elements = await getElements();
    const element = elements.find(el => el.id === id);
    if (element) {
      element.enabled = enabled;
      await chrome.storage.local.set({ [KEYS.ELEMENTS]: elements });
    }
    return elements;
  }

  // ── Conversations ────────────────────────────────────

  /**
   * Get conversation history for a given URL.
   * Each message: { role: 'user'|'assistant', content: string, timestamp: string }
   */
  async function getConversation(url) {
    const result = await chrome.storage.local.get(KEYS.CONVERSATIONS);
    const conversations = result[KEYS.CONVERSATIONS] || {};
    const key = normalizeUrl(url);
    return conversations[key] || [];
  }

  /**
   * Append a message to the conversation for a URL.
   * Keeps the last 50 messages to avoid storage bloat.
   */
  async function addToConversation(url, message) {
    const result = await chrome.storage.local.get(KEYS.CONVERSATIONS);
    const conversations = result[KEYS.CONVERSATIONS] || {};
    const key = normalizeUrl(url);
    const history = conversations[key] || [];
    history.push(message);
    // Keep last 50 messages
    if (history.length > 50) {
      conversations[key] = history.slice(-50);
    } else {
      conversations[key] = history;
    }
    await chrome.storage.local.set({ [KEYS.CONVERSATIONS]: conversations });
  }

  /**
   * Clear conversation history for a URL.
   */
  async function clearConversation(url) {
    const result = await chrome.storage.local.get(KEYS.CONVERSATIONS);
    const conversations = result[KEYS.CONVERSATIONS] || {};
    const key = normalizeUrl(url);
    delete conversations[key];
    await chrome.storage.local.set({ [KEYS.CONVERSATIONS]: conversations });
  }

  // ── Helpers ───────────────────────────────────────────

  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      // Strip hash, keep everything else
      return u.origin + u.pathname + u.search;
    } catch {
      return url;
    }
  }

  function generateId() {
    return 'albert-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  return {
    KEYS,
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    getElements,
    getElementsForUrl,
    addElement,
    updateElement,
    removeElement,
    toggleElement,
    getConversation,
    addToConversation,
    clearConversation,
    normalizeUrl,
    generateId,
  };
})();

// Make available in both content script and service worker contexts
if (typeof globalThis !== 'undefined') {
  globalThis.AlbertStorage = AlbertStorage;
}
