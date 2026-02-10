/**
 * Albert — Side Panel SPA Router
 * Manages view transitions between Chat, Settings, and Elements.
 * Monitors active tab changes to keep the chat in sync with the current page.
 */

const App = (() => {
  const views = {
    chat: document.getElementById('view-chat'),
    settings: document.getElementById('view-settings'),
    elements: document.getElementById('view-elements'),
    elementDetail: document.getElementById('view-element-detail'),
  };

  let currentView = 'chat';

  function navigateTo(viewName) {
    if (!views[viewName]) return;
    views[currentView].classList.remove('active');
    views[viewName].classList.add('active');
    currentView = viewName;

    // Trigger view-specific init
    if (viewName === 'settings') SettingsView.init();
    if (viewName === 'elements') ElementsView.init();
  }

  function init() {
    // Navigation buttons
    document.getElementById('btn-settings').addEventListener('click', () => navigateTo('settings'));
    document.getElementById('btn-elements').addEventListener('click', () => navigateTo('elements'));
    document.getElementById('btn-back-settings').addEventListener('click', () => navigateTo('chat'));
    document.getElementById('btn-back-elements').addEventListener('click', () => navigateTo('chat'));
    document.getElementById('btn-back-detail').addEventListener('click', () => navigateTo('elements'));

    // Initialize the chat view
    ChatView.init();

    // ── Active Tab Monitoring ──────────────────────────
    // When the user switches to a different tab, reload the chat
    // for the new tab's URL so the conversation stays in sync.
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
          ChatView.onTabChanged(tab);
          ElementsView.onTabChanged(tab);
        }
      } catch {
        // Tab may not be accessible (e.g. chrome:// pages)
      }
    });

    // When the current tab navigates to a new URL, reload the chat and elements
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // Only react to URL changes on completed loads in the active tab
      if (changeInfo.status === 'complete' && tab.active) {
        ChatView.onTabChanged(tab);
        ElementsView.onTabChanged(tab);
      }
    });
  }

  return { init, navigateTo };
})();

// Boot
document.addEventListener('DOMContentLoaded', App.init);
