/**
 * Albert — Settings View
 * Manages provider selection, API key, model selection, base URL,
 * and element LLM access configuration.
 */

const SettingsView = (() => {
  let providerSelect;
  let apiKeyInput;
  let apiKeyHint;
  let modelSelect;
  let baseUrlInput;
  let saveBtn;
  let statusEl;
  let toggleKeyBtn;
  let elementLLMToggle;

  function init() {
    providerSelect = document.getElementById('setting-provider');
    apiKeyInput = document.getElementById('setting-api-key');
    apiKeyHint = document.getElementById('api-key-hint');
    modelSelect = document.getElementById('setting-model');
    baseUrlInput = document.getElementById('setting-base-url');
    saveBtn = document.getElementById('btn-save-settings');
    statusEl = document.getElementById('settings-status');
    toggleKeyBtn = document.getElementById('toggle-api-key');
    elementLLMToggle = document.getElementById('setting-element-llm');

    // Populate provider dropdown from the LLM middleware registry
    populateProviders();

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

    // When provider changes, update models, hint, and base URL
    const newProviderSelect = providerSelect.cloneNode(true);
    providerSelect.parentNode.replaceChild(newProviderSelect, providerSelect);
    providerSelect = newProviderSelect;
    providerSelect.addEventListener('change', onProviderChange);
  }

  /**
   * Populate the provider <select> with all registered providers.
   */
  function populateProviders() {
    providerSelect.innerHTML = '';
    const providers = AlbertLLM.getProviders();
    for (const p of providers) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      providerSelect.appendChild(option);
    }
  }

  /**
   * Populate the model <select> for a given provider.
   */
  function populateModels(providerId) {
    const provider = AlbertLLM.getProvider(providerId);
    if (!provider) return;

    modelSelect.innerHTML = '';
    for (const m of provider.models) {
      const option = document.createElement('option');
      option.value = m.id;
      option.textContent = m.name;
      modelSelect.appendChild(option);
    }
    modelSelect.value = provider.defaultModel;
  }

  /**
   * Update the API key hint and base URL placeholder for a provider.
   */
  function updateProviderHints(providerId) {
    const provider = AlbertLLM.getProvider(providerId);
    if (!provider) return;

    // API key placeholder & hint
    apiKeyInput.placeholder = provider.apiKeyPlaceholder || '';
    apiKeyHint.innerHTML = `Get your key at <a href="${provider.apiKeyUrl}" target="_blank">${provider.apiKeyLabel}</a>`;

    // Base URL placeholder
    baseUrlInput.placeholder = provider.baseUrl || '';
  }

  /**
   * Called when the user changes the provider dropdown.
   * Resets model, hint, and base URL to the new provider's defaults.
   */
  function onProviderChange() {
    const providerId = providerSelect.value;
    const provider = AlbertLLM.getProvider(providerId);
    if (!provider) return;

    populateModels(providerId);
    updateProviderHints(providerId);

    // Reset base URL to the new provider's default
    baseUrlInput.value = provider.baseUrl;
  }

  async function loadSettings() {
    const settings = await AlbertStorage.getSettings();

    // Provider
    const providerId = settings.provider || 'grok';
    providerSelect.value = providerId;

    // Populate models for the current provider
    populateModels(providerId);
    updateProviderHints(providerId);

    // Restore saved values
    apiKeyInput.value = settings.apiKey || '';
    modelSelect.value = settings.model || AlbertLLM.getProvider(providerId)?.defaultModel || '';
    baseUrlInput.value = settings.baseUrl || AlbertLLM.getProvider(providerId)?.baseUrl || '';
    elementLLMToggle.checked = settings.allowElementLLMAccess !== false; // default true

    // Reset visibility
    apiKeyInput.type = 'password';
  }

  async function saveSettings() {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const providerInfo = AlbertLLM.getProvider(provider);
    const baseUrl = baseUrlInput.value.trim() || providerInfo?.baseUrl || '';
    const allowElementLLMAccess = elementLLMToggle.checked;

    try {
      await AlbertStorage.saveSettings({ provider, apiKey, model, baseUrl, allowElementLLMAccess });
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
