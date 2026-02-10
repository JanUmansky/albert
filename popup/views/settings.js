/**
 * Albert — Settings View
 * Manages API key, model selection, and base URL configuration.
 */

const SettingsView = (() => {
  let apiKeyInput;
  let modelSelect;
  let baseUrlInput;
  let saveBtn;
  let statusEl;
  let toggleKeyBtn;
  let elementLLMToggle;

  function init() {
    apiKeyInput = document.getElementById('setting-api-key');
    modelSelect = document.getElementById('setting-model');
    baseUrlInput = document.getElementById('setting-base-url');
    saveBtn = document.getElementById('btn-save-settings');
    statusEl = document.getElementById('settings-status');
    toggleKeyBtn = document.getElementById('toggle-api-key');
    elementLLMToggle = document.getElementById('setting-element-llm');

    // Load current settings
    loadSettings();

    // Bind events (remove previous listeners by cloning)
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    saveBtn = newSaveBtn;
    saveBtn.addEventListener('click', saveSettings);

    const newToggleBtn = toggleKeyBtn.cloneNode(true);
    toggleKeyBtn.parentNode.replaceChild(newToggleBtn, toggleKeyBtn);
    toggleKeyBtn = newToggleBtn;
    toggleKeyBtn.addEventListener('click', toggleApiKeyVisibility);
  }

  async function loadSettings() {
    const settings = await AlbertStorage.getSettings();
    apiKeyInput.value = settings.apiKey || '';
    modelSelect.value = settings.model || 'grok-3';
    baseUrlInput.value = settings.baseUrl || 'https://api.x.ai/v1';
    elementLLMToggle.checked = settings.allowElementLLMAccess !== false; // default true
    // Reset visibility
    apiKeyInput.type = 'password';
  }

  async function saveSettings() {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const baseUrl = baseUrlInput.value.trim() || 'https://api.x.ai/v1';
    const allowElementLLMAccess = elementLLMToggle.checked;

    try {
      await AlbertStorage.saveSettings({ apiKey, model, baseUrl, allowElementLLMAccess });
      showStatus('Settings saved successfully!', 'success');
    } catch (err) {
      showStatus('Failed to save: ' + err.message, 'error');
    }
  }

  function toggleApiKeyVisibility() {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
  }

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status-message ' + type;
    setTimeout(() => {
      statusEl.className = 'status-message';
      statusEl.textContent = '';
    }, 2500);
  }

  return { init };
})();
