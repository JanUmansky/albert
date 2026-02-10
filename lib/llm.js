/**
 * Albert — LLM Middleware
 * Provider-agnostic abstraction for calling LLM APIs.
 *
 * To add a new provider:
 *   1. Add an entry to PROVIDERS below
 *   2. If the provider uses the OpenAI-compatible chat completions format,
 *      you're done — it will work automatically.
 *   3. If the provider has a custom API format, add a handler function
 *      and reference it in the provider's `handler` field.
 */

const AlbertLLM = (() => {

  // ── Provider Registry ──────────────────────────────────

  const PROVIDERS = {
    grok: {
      id: 'grok',
      name: 'Grok (xAI)',
      baseUrl: 'https://api.x.ai/v1',
      apiKeyPlaceholder: 'xai-...',
      apiKeyUrl: 'https://console.x.ai',
      apiKeyLabel: 'console.x.ai',
      models: [
        { id: 'grok-3', name: 'Grok 3' },
        { id: 'grok-3-mini', name: 'Grok 3 Mini' },
      ],
      defaultModel: 'grok-3',
      // handler: null → uses the default OpenAI-compatible handler
    },

    // ── Add new providers here ────────────────────────────
    // Example:
    // openai: {
    //   id: 'openai',
    //   name: 'OpenAI',
    //   baseUrl: 'https://api.openai.com/v1',
    //   apiKeyPlaceholder: 'sk-...',
    //   apiKeyUrl: 'https://platform.openai.com/api-keys',
    //   apiKeyLabel: 'platform.openai.com',
    //   models: [
    //     { id: 'gpt-4o', name: 'GPT-4o' },
    //     { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    //   ],
    //   defaultModel: 'gpt-4o',
    // },
  };

  // ── Unified LLM Call ──────────────────────────────────

  /**
   * Call the configured LLM provider.
   * @param {object} settings - User settings (provider, apiKey, model, baseUrl)
   * @param {Array} messages  - Chat messages in OpenAI format [{role, content}]
   * @returns {Promise<string>} The LLM's response text
   */
  async function callLLM(settings, messages) {
    const providerId = settings.provider || 'grok';
    const provider = PROVIDERS[providerId];

    if (!provider) {
      throw new Error(`Unknown LLM provider: "${providerId}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
    }

    // Use provider-specific handler if defined, otherwise default OpenAI-compatible
    const handler = provider.handler || callOpenAICompatible;
    return handler(settings, messages, provider);
  }

  // ── OpenAI-Compatible Handler ─────────────────────────
  //    Works for: Grok, OpenAI, Mistral, Together, Groq,
  //    OpenRouter, DeepSeek, and many other providers.

  async function callOpenAICompatible(settings, messages, provider) {
    const baseUrl = (settings.baseUrl || provider.baseUrl).replace(/\/+$/, '');
    const url = baseUrl + '/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model || provider.defaultModel,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMsg = `API returned status ${response.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from API');
    }

    return content;
  }

  // ── Provider Info Helpers ─────────────────────────────

  /**
   * Get a single provider's config by ID.
   * @param {string} id
   * @returns {object|null}
   */
  function getProvider(id) {
    return PROVIDERS[id] || null;
  }

  /**
   * Get all registered providers as an array.
   * @returns {object[]}
   */
  function getProviders() {
    return Object.values(PROVIDERS);
  }

  /**
   * Get the default provider config.
   * @returns {object}
   */
  function getDefaultProvider() {
    return PROVIDERS.grok;
  }

  // ── Public API ────────────────────────────────────────

  return {
    PROVIDERS,
    callLLM,
    getProvider,
    getProviders,
    getDefaultProvider,
  };
})();

// Make available in both content script and service worker contexts
if (typeof globalThis !== 'undefined') {
  globalThis.AlbertLLM = AlbertLLM;
}
