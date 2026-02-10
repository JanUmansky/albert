/**
 * Albert — Background Service Worker
 * Orchestrates LLM API calls, page context retrieval,
 * conversation management, and element injection.
 */

importScripts('/lib/storage.js');

// ── Side Panel Setup ────────────────────────────────────

// Open the side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── Message Handler ─────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'CHAT_MESSAGE':
      handleChat(message).then(sendResponse).catch(err => {
        sendResponse({ error: err.message || 'Unknown error' });
      });
      return true; // keep channel open for async response

    case 'CLEAR_CONVERSATION':
      AlbertStorage.clearConversation(message.tabUrl)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'EXECUTE_ELEMENT_JS':
      // Content script requests JS execution — use scripting API to bypass page CSP
      if (sender.tab && sender.tab.id) {
        executeElementJS(sender.tab.id, message.code, message.elementId)
          .then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ error: err.message }));
      } else {
        sendResponse({ error: 'No tab context available' });
      }
      return true;

    case 'ELEMENT_CODE_CHAT':
      handleElementCodeChat(message)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message || 'Unknown error' }));
      return true;

    case 'ELEMENT_LLM_CALL':
      handleElementLLMCall(message)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true;

    // Legacy support
    case 'GENERATE_ELEMENT':
      handleChat({ ...message, type: 'CHAT_MESSAGE' })
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message || 'Unknown error' }));
      return true;
  }
});

// ── Chat Flow ───────────────────────────────────────────

async function handleChat({ prompt, tabId, tabUrl }) {
  // 1. Validate settings
  const settings = await AlbertStorage.getSettings();
  if (!settings.apiKey) {
    return { error: 'No API key configured. Please go to Settings and add your xAI API key.' };
  }

  // 2. Get page context from content script
  let pageContext;
  try {
    pageContext = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' });
  } catch (err) {
    // Content script not present — try programmatic injection (handles pre-existing tabs)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['lib/storage.js', 'content/content.js'],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content/content.css'],
      });
      // Retry after injection
      pageContext = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' });
    } catch (retryErr) {
      return { error: 'Cannot access this page. Make sure you are on a regular webpage (not a Chrome internal page).' };
    }
  }

  if (!pageContext || !pageContext.html) {
    return { error: 'Could not read the page content. Try refreshing the page.' };
  }

  // 3. Get conversation history
  const conversationHistory = await AlbertStorage.getConversation(tabUrl);

  // 4. Save user message to history
  await AlbertStorage.addToConversation(tabUrl, {
    role: 'user',
    content: prompt,
    timestamp: new Date().toISOString(),
  });

  // 5. Get existing elements for this URL (so the LLM can reference them for modifications)
  const existingElements = await AlbertStorage.getElementsForUrl(tabUrl);

  // 6. Build LLM messages
  const systemPrompt = buildSystemPrompt();
  const messages = buildMessages(systemPrompt, conversationHistory, prompt, pageContext, existingElements);

  // 7. Call xAI Grok API
  let llmResponse;
  try {
    llmResponse = await callGrokAPI(settings, messages);
  } catch (err) {
    return { error: 'LLM API error: ' + err.message };
  }

  // 8. Parse the response
  let parsed;
  try {
    parsed = parseLLMResponse(llmResponse);
  } catch (err) {
    // If parsing fails, treat the raw response as a plain text answer
    parsed = { message: llmResponse };
  }

  // 9. If the LLM returned an element, save and inject it
  let isUpdate = false;
  if (parsed.element) {
    let element;

    // Check if this is a modification of an existing element
    const existingId = parsed.element.elementId;
    const existingElement = existingId
      ? existingElements.find(el => el.id === existingId)
      : null;

    if (existingElement) {
      // ── Update existing element ──
      isUpdate = true;

      // First remove the old element from the page
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'REMOVE_ELEMENT',
          elementId: existingElement.id,
        });
      } catch {
        // Content script may not be reachable
      }

      // Update in storage — fall back to existing code if the LLM omitted a part
      // (e.g. the user only asked to change CSS, so the LLM may not return JS)
      const updates = {
        name: parsed.element.name || existingElement.name,
        description: parsed.element.description || existingElement.description,
        code: {
          js: parsed.element.js || existingElement.code?.js || '',
          css: parsed.element.css || existingElement.code?.css || '',
        },
      };
      element = await AlbertStorage.updateElement(existingElement.id, updates);
    } else {
      // ── Create new element ──
      element = {
        id: AlbertStorage.generateId(),
        url: AlbertStorage.normalizeUrl(tabUrl),
        hostname: extractHostname(tabUrl),
        name: parsed.element.name || 'Custom Element',
        description: parsed.element.description || prompt,
        code: {
          js: parsed.element.js || '',
          css: parsed.element.css || '',
        },
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      await AlbertStorage.addElement(element);
    }

    // Reload the tab so the page picks up the new/updated element cleanly.
    // The content script's autoLoadElements() will inject all enabled
    // elements (including this one) from storage on the fresh page load.
    try {
      await chrome.tabs.reload(tabId);
    } catch {
      // If reload fails, fall back to in-place injection
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'INJECT_ELEMENT',
          element,
          cssOnly: true,
        });
        if (element.code.js) {
          await executeElementJS(tabId, element.code.js, element.id);
        }
      } catch {
        // Element is saved but injection failed — will load on next page visit
      }
    }
  }

  // 10. Save assistant response to conversation history
  const assistantMessage = parsed.message || 'Done!';
  await AlbertStorage.addToConversation(tabUrl, {
    role: 'assistant',
    content: assistantMessage,
    timestamp: new Date().toISOString(),
    hasElement: !!parsed.element,
    isElementUpdate: isUpdate,
  });

  // 11. Return
  return {
    message: assistantMessage,
    hasElement: !!parsed.element,
    isElementUpdate: isUpdate,
  };
}

// ── Element Code Chat ───────────────────────────────────

/**
 * Handle a chat message scoped to a specific element's JS or CSS code.
 * The LLM can answer questions about the code or modify it.
 * Only the targeted code type (JS or CSS) is sent and may be changed.
 */
async function handleElementCodeChat({ elementId, codeType, prompt, tabId, tabUrl }) {
  // 1. Validate settings
  const settings = await AlbertStorage.getSettings();
  if (!settings.apiKey) {
    return { error: 'No API key configured. Please go to Settings and add your xAI API key.' };
  }

  // 2. Get the element from storage
  const allElements = await AlbertStorage.getElements();
  const element = allElements.find(el => el.id === elementId);
  if (!element) {
    return { error: 'Element not found. It may have been deleted.' };
  }

  const code = codeType === 'css' ? (element.code?.css || '') : (element.code?.js || '');
  const langLabel = codeType === 'css' ? 'CSS' : 'JavaScript';

  // 3. Build the system prompt scoped to this element's code
  const systemPrompt = buildElementCodeSystemPrompt(element, codeType, langLabel, code);

  // 4. Build messages
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  // 5. Call LLM
  let llmResponse;
  try {
    llmResponse = await callGrokAPI(settings, messages);
  } catch (err) {
    return { error: 'LLM API error: ' + err.message };
  }

  // 6. Parse response
  let parsed;
  try {
    let jsonStr = llmResponse.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    jsonStr = jsonStr.trim();
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }
    parsed = JSON.parse(jsonStr);
  } catch {
    // If parsing fails, treat the raw response as a plain text answer
    parsed = { message: llmResponse };
  }

  const responseMessage = String(parsed.message || 'Done!');
  const updatedCode = parsed.code != null ? String(parsed.code) : null;

  // 7. If code was updated, save to storage and refresh the page
  if (updatedCode !== null) {
    const codeUpdate = {
      code: {
        js: codeType === 'js' ? updatedCode : (element.code?.js || ''),
        css: codeType === 'css' ? updatedCode : (element.code?.css || ''),
      },
    };
    await AlbertStorage.updateElement(elementId, codeUpdate);

    // Refresh the page so the updated element takes effect
    try {
      await chrome.tabs.reload(tabId);
    } catch {
      // Page reload failed — the element is saved and will load on next visit
    }

    return {
      message: responseMessage,
      codeUpdated: true,
    };
  }

  return {
    message: responseMessage,
    codeUpdated: false,
  };
}

function buildElementCodeSystemPrompt(element, codeType, langLabel, code) {
  return `You are Albert, an AI assistant embedded in a Chrome extension.

You are in **element code chat mode**. The user is viewing the ${langLabel} code of an element called "${element.name}".

## Context

Element name: ${element.name}
Element description: ${element.description || '(none)'}
Code type: ${langLabel}

Current ${langLabel} code:
\`\`\`
${code || '(empty)'}
\`\`\`

## Your capabilities

1. **Answer questions** about this specific ${langLabel} code — explain what it does, how it works, identify issues, etc.
2. **Modify the code** when the user asks to change, fix, add, or remove something.

## IMPORTANT constraints

- You MUST only operate within the scope of this element's ${langLabel} code. Do not generate code for the other language (${codeType === 'js' ? 'CSS' : 'JavaScript'}).
- When modifying code, provide the COMPLETE updated code — not a diff or partial snippet.
- Keep the element self-contained and idempotent.
- Preserve the "albert-" prefix convention for CSS classes and IDs.
- Preserve data-albert-element attributes.

## Response format

Always respond with a valid JSON object. No markdown fences, no extra text outside the JSON.

### For questions / explanations (no code changes):
{
  "message": "Your explanation here."
}

### When modifying the code:
{
  "message": "Brief explanation of what you changed.",
  "code": "The FULL updated ${langLabel} code as a string."
}

Only include the "code" field when you are actually changing the code. If the user is just asking a question, omit "code" entirely.

Return ONLY the JSON object, nothing else.`;
}

// ── Element LLM Access ──────────────────────────────────

/**
 * Handle LLM calls from injected elements.
 * Elements can call the LLM via __albertLLM() which relays through
 * the content script to this handler.
 */
async function handleElementLLMCall({ prompt, options }) {
  const settings = await AlbertStorage.getSettings();

  if (!settings.allowElementLLMAccess) {
    return { error: 'LLM access for elements is disabled. Enable it in Albert Settings.' };
  }

  if (!settings.apiKey) {
    return { error: 'No API key configured. Please add your API key in Albert Settings.' };
  }

  const opts = options || {};
  const messages = [
    {
      role: 'system',
      content: opts.systemPrompt || 'You are a helpful assistant. Respond concisely and directly. Return only the requested output, no extra explanation unless asked.',
    },
    { role: 'user', content: prompt },
  ];

  try {
    const result = await callGrokAPI(settings, messages);
    return { result };
  } catch (err) {
    return { error: 'LLM API error: ' + err.message };
  }
}

// ── LLM Prompt Construction ─────────────────────────────

function buildSystemPrompt() {
  return `You are Albert, a smart and friendly AI assistant embedded in a Chrome extension. You can see the content of the webpage the user is currently on.

You have TWO capabilities:
1. **Answer questions** about the page — its content, structure, who built it, what technologies it uses, what elements are on it, etc. You can also have general conversation.
2. **Create and inject custom UI elements** — when the user asks you to build, add, create, or modify something on the page, you generate the code for it.

You may also be given a list of **existing Albert elements** that have previously been created on this page. When the user asks to modify, update, change, tweak, fix, or adjust something that matches an existing element, you MUST update that element instead of creating a new one.

## Response Format

You MUST always respond with a valid JSON object. No markdown fences, no extra text outside the JSON.

### For questions / conversation (no code needed):
{
  "message": "Your conversational response here. Be helpful, concise, and friendly."
}

### When creating a NEW element:
{
  "message": "A brief, friendly explanation of what you created and how it works.",
  "element": {
    "name": "Short Name (max 50 chars)",
    "description": "One-sentence description",
    "js": "JavaScript code as a string",
    "css": "CSS code as a string"
  }
}

### When MODIFYING an existing element:
{
  "message": "A brief, friendly explanation of what you changed.",
  "element": {
    "elementId": "the-existing-element-id",
    "name": "Updated Name (max 50 chars)",
    "description": "Updated description",
    "js": "The FULL JavaScript code (updated or unchanged)",
    "css": "The FULL CSS code (updated or unchanged)"
  }
}

IMPORTANT rules for modifying existing elements:
- You MUST include the "elementId" field with the exact ID from the existing elements list.
- **Only change what the user is asking for.** If the user asks to change styling/appearance (colors, sizes, fonts, layout, etc.), modify ONLY the CSS and return the existing JS code UNCHANGED (copy it verbatim). If the user asks to change behavior/functionality (event handlers, logic, data processing, etc.), modify ONLY the JS and return the existing CSS code UNCHANGED (copy it verbatim).
- You are given the full current JS and CSS code for each existing element. Use it as-is for the part that should NOT change.
- Always provide the COMPLETE js and css in your response — not just the diff. The old code will be fully replaced.
- If the user's request genuinely requires changes to both JS and CSS, then update both — but ONLY touch what is necessary. Do not rewrite or reformat code that doesn't need changing.

## Available helper functions (pre-injected, always available in your JS code):

- \`__albertFind(selectors)\` — Takes a CSS selector string OR an **array** of selectors. Tries each in order and returns the **first** element that matches any of them. Returns null if none match. **Always prefer this over raw querySelector.**
- \`__albertFindAll(selectors)\` — Like __albertFind but returns an array of all elements matching the first successful selector.
- \`__albertFindByText(text, tag?)\` — Finds an element by its visible text content (partial match). Optionally narrow by tag name. Good for buttons, links, headings, etc.
- \`__albertClosest(element, selectors)\` — Like Element.closest() but tries multiple selectors in order.
- \`__albertLLM(prompt, options?)\` — **Call the connected LLM from element code.** Returns a Promise that resolves with the LLM's response text. Use this when the element's functionality requires AI processing (e.g. summarizing, rewriting, translating, enhancing, analyzing text). Optional \`options.systemPrompt\` to set a custom system instruction for the LLM call.

### Example: calling the LLM from element code
\`\`\`
// Button click handler that enhances text using the LLM
btn.addEventListener('click', async () => {
  const input = document.querySelector('textarea');
  btn.disabled = true;
  btn.textContent = 'Enhancing...';
  try {
    const result = await __albertLLM('Improve and enhance this text:\\n' + input.value, {
      systemPrompt: 'You are a professional editor. Return only the improved text, nothing else.'
    });
    input.value = result;
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enhance';
  }
});
\`\`\`

### Example: finding a container with multiple fallback selectors
\`\`\`
const container = __albertFind([
  'main',                            // semantic HTML tag
  '[role="main"]',                   // ARIA role
  '#content',                        // stable ID
  '.main-content',                   // common class name
  'body > div > div:nth-child(2)',   // structural position
]);
if (!container) throw new Error('Main container not found');
\`\`\`

## Rules for generated code (element.js / element.css):

1. JavaScript MUST be self-contained and immediately executable (IIFE or top-level)
2. Use the prefix "albert-" for any CSS classes or IDs you create
3. Be idempotent — safe to run multiple times (check if element exists before creating)
4. **Use __albertFind() / __albertFindAll() to locate target elements. ALWAYS provide an ARRAY of multiple fallback selectors**, ordered by reliability:
   a. Semantic HTML tags: \`main\`, \`nav\`, \`header\`, \`footer\`, \`article\`, \`section\`, \`aside\`
   b. ARIA roles: \`[role="main"]\`, \`[role="navigation"]\`, \`[role="banner"]\`, \`[role="contentinfo"]\`
   c. Stable data attributes: \`[data-testid="..."]\`, \`[data-id="..."]\`
   d. Stable IDs (NOT auto-generated ones like \`#__next-123\` or \`#root-abc\`)
   e. Tag + attribute combos: \`nav[aria-label="..."]\`, \`section[id="..."]\`
   f. Structural/positional selectors: \`body > div > main\`, \`header + div\`, \`body > div:first-child\`
   g. Broad tag selectors as last resort: \`div.container\`, \`div.wrapper\`
5. **NEVER rely on a single CSS selector** — real-world pages use dynamic class names (e.g. \`css-1a2b3c\`, \`sc-bdfBwQ\`, \`_next-data\`, hashed Tailwind classes) that change on every build/deploy. Always provide at least 3–5 fallback selectors.
6. Use \`__albertFindByText()\` when the best anchor is visible text (e.g. finding a specific button or heading by its label).
7. If no target element is found after trying all selectors, throw an Error (e.g. \`if (!container) throw new Error('Container not found');\`). Do NOT just log and return — throwing allows the extension to retry automatically when the page finishes loading.
8. Do NOT use eval(), document.write(), or other unsafe patterns
9. Mark all created DOM elements with the attribute data-albert-element="<unique-name>"
10. CSS should use "albert-" prefixed class names and reasonable z-index values
11. **Use \`__albertLLM()\` when the user's request implies AI-powered functionality** — e.g. enhancing, summarizing, rewriting, translating, analyzing, or generating text. The function is async (returns a Promise). Always show a loading state while waiting and handle errors gracefully. Provide a clear \`systemPrompt\` in options to get the best results.
12. **When positioning elements on the page, ensure the parent/container has the correct CSS context.** For example, if you use \`position: absolute\` on the injected element, the target container must have \`position: relative\` (or \`absolute\`/\`fixed\`/\`sticky\`) — otherwise the element will be positioned relative to the viewport or a distant ancestor instead of the intended container. Apply the necessary positioning CSS to the container via JS (e.g. \`container.style.position = 'relative'\`) or via a CSS rule targeting the container. Always check whether the container already has a non-static position before overriding it.

## General guidelines:
- Keep answers concise but informative
- When analyzing the page, reference specific elements you can see in the HTML
- If the user's request is ambiguous, ask a clarifying question
- You have full conversation history, so you can reference previous messages
- Return ONLY the JSON object, nothing else`;
}

function buildMessages(systemPrompt, conversationHistory, currentPrompt, pageContext, existingElements) {
  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // Add page context as the first user-like context message
  const pageContextMsg = buildPageContextMessage(pageContext);
  messages.push({ role: 'system', content: pageContextMsg });

  // Add existing Albert elements context so the LLM can reference them for modifications
  if (existingElements && existingElements.length > 0) {
    const elementsCtx = buildExistingElementsContext(existingElements);
    messages.push({ role: 'system', content: elementsCtx });
  }

  // Add conversation history (limit to last 20 messages to stay within token limits)
  const recentHistory = conversationHistory.slice(-20);
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Add current user message
  messages.push({ role: 'user', content: currentPrompt });

  return messages;
}

function buildPageContextMessage(pageContext) {
  // Truncate HTML to avoid exceeding token limits
  const maxHtmlLength = 12000;
  let html = pageContext.html || '';
  if (html.length > maxHtmlLength) {
    html = html.substring(0, maxHtmlLength) + '\n<!-- ... truncated ... -->';
  }

  let ctx = `[Page Context — this is the webpage the user is currently viewing]
URL: ${pageContext.url}
Title: ${pageContext.title}

Simplified HTML:
${html}`;

  // Add verified structural landmarks — these selectors have been tested
  // on the live page and are known to work right now.
  if (pageContext.landmarks && pageContext.landmarks.length > 0) {
    ctx += '\n\n[Verified Page Landmarks — these selectors were tested on the live page and matched]';
    for (const lm of pageContext.landmarks) {
      ctx += `\n• ${lm.label}: ${JSON.stringify(lm.selectors)}`;
    }
    ctx += '\n\nUse these verified selectors (in order) when targeting these areas of the page. Pass them as the array argument to __albertFind().';
  }

  return ctx;
}

function buildExistingElementsContext(elements) {
  const summaries = elements.map(el => {
    let entry = `- ID: "${el.id}" | Name: "${el.name}" | Description: "${el.description || '(none)'}"`;

    // Include actual code so the LLM can preserve unchanged parts during modifications
    if (el.code) {
      if (el.code.js) {
        entry += `\n  Current JS:\n\`\`\`\n${el.code.js}\n\`\`\``;
      }
      if (el.code.css) {
        entry += `\n  Current CSS:\n\`\`\`\n${el.code.css}\n\`\`\``;
      }
    }

    return entry;
  });

  return `[Existing Albert Elements on this page — reference these by ID when the user asks to modify one]
${summaries.join('\n\n')}

If the user asks to change, update, modify, tweak, fix, or adjust any of the above elements, use the "elementId" field in your response to update it instead of creating a new one.
CRITICAL: When modifying an element, only change the part (JS or CSS) that the user is asking about. Copy the other part verbatim from the current code shown above.`;
}

// ── xAI Grok API ────────────────────────────────────────

async function callGrokAPI(settings, messages) {
  const url = (settings.baseUrl || 'https://api.x.ai/v1').replace(/\/+$/, '') + '/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'grok-3',
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

// ── Response Parsing ────────────────────────────────────

function parseLLMResponse(responseText) {
  let jsonStr = responseText.trim();

  // Remove markdown code fences if present
  jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  jsonStr = jsonStr.trim();

  // Try to find JSON object boundaries
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(jsonStr);

  const result = {
    message: String(parsed.message || ''),
  };

  // Check if an element was included
  if (parsed.element && (parsed.element.js || parsed.element.css)) {
    result.element = {
      name: String(parsed.element.name || 'Custom Element').substring(0, 50),
      description: String(parsed.element.description || ''),
      js: String(parsed.element.js || ''),
      css: String(parsed.element.css || ''),
    };
    // If the LLM referenced an existing element for modification, include its ID
    if (parsed.element.elementId) {
      result.element.elementId = String(parsed.element.elementId);
    }
  }

  return result;
}

// ── DOM Helper Injection ────────────────────────────────

/**
 * Inject Albert DOM helper functions into the page's MAIN world.
 * These provide robust, multi-strategy element finding that the
 * LLM-generated code can use instead of brittle single selectors.
 * Idempotent — safe to call multiple times.
 */
async function injectAlbertHelpers(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      if (window.__albertHelpers) return; // already injected
      window.__albertHelpers = true;

      /**
       * Find a single element using an ordered list of CSS selectors.
       * Tries each selector in order and returns the first match.
       * @param {string|string[]} selectors
       * @returns {Element|null}
       */
      window.__albertFind = function (selectors) {
        if (typeof selectors === 'string') selectors = [selectors];
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (el) return el;
          } catch (e) { /* invalid selector — skip */ }
        }
        return null;
      };

      /**
       * Find all elements matching the first successful selector.
       * @param {string|string[]} selectors
       * @returns {Element[]}
       */
      window.__albertFindAll = function (selectors) {
        if (typeof selectors === 'string') selectors = [selectors];
        for (const sel of selectors) {
          try {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) return Array.from(els);
          } catch (e) { /* invalid selector — skip */ }
        }
        return [];
      };

      /**
       * Find an element by its visible text content (partial match).
       * @param {string} text - Text to search for
       * @param {string} [tag='*'] - Optional tag name to narrow the search
       * @returns {Element|null}
       */
      window.__albertFindByText = function (text, tag) {
        tag = tag || '*';
        const candidates = document.querySelectorAll(tag);
        // Prefer elements whose *direct* text matches (leaf-level accuracy)
        for (const el of candidates) {
          const direct = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ');
          if (direct && direct.includes(text)) return el;
        }
        // Fallback: full textContent match on leaf elements
        for (const el of candidates) {
          if (el.children.length === 0 && el.textContent.includes(text)) return el;
        }
        return null;
      };

      /**
       * Like Element.closest() but tries multiple selectors in order.
       * @param {Element} el
       * @param {string|string[]} selectors
       * @returns {Element|null}
       */
      window.__albertClosest = function (el, selectors) {
        if (!el) return null;
        if (typeof selectors === 'string') selectors = [selectors];
        for (const sel of selectors) {
          try {
            const ancestor = el.closest(sel);
            if (ancestor) return ancestor;
          } catch (e) { /* invalid selector — skip */ }
        }
        return null;
      };

      /**
       * Build a resilient selector for an element based on its structural
       * position and semantic attributes. Useful for debugging.
       * @param {Element} el
       * @returns {string}
       */
      window.__albertDescribe = function (el) {
        if (!el) return '(null)';
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const role = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : '';
        const testid = el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : '';
        return `${tag}${id}${role}${testid}`;
      };

      /**
       * Call the connected LLM from element code.
       * Communicates via window.postMessage → content script → service worker.
       * @param {string} prompt - The prompt to send to the LLM
       * @param {object} [options] - Optional settings
       * @param {string} [options.systemPrompt] - Custom system prompt for the LLM
       * @returns {Promise<string>} The LLM's response text
       */
      window.__albertLLM = function (prompt, options) {
        return new Promise(function (resolve, reject) {
          var requestId = 'albert-llm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
          var timeoutMs = (options && options.timeout) || 60000;

          function handler(event) {
            if (event.data && event.data.type === 'ALBERT_LLM_RESPONSE' && event.data.requestId === requestId) {
              window.removeEventListener('message', handler);
              clearTimeout(timer);
              if (event.data.error) {
                reject(new Error(event.data.error));
              } else {
                resolve(event.data.result);
              }
            }
          }

          window.addEventListener('message', handler);

          var timer = setTimeout(function () {
            window.removeEventListener('message', handler);
            reject(new Error('Albert LLM request timed out after ' + (timeoutMs / 1000) + 's'));
          }, timeoutMs);

          window.postMessage({
            type: 'ALBERT_LLM_REQUEST',
            requestId: requestId,
            prompt: prompt,
            options: options || {},
          }, '*');
        });
      };
    },
  });
}

// ── JS Execution (CSP Bypass) ───────────────────────────

/**
 * Execute element JS in the page's main world using chrome.scripting API.
 * This bypasses the page's Content Security Policy, which blocks inline scripts.
 *
 * First injects the Albert DOM helpers (idempotent), then wraps the generated
 * code in a retry mechanism: if execution fails (e.g. a target element hasn't
 * been rendered yet), it retries with exponential backoff and a MutationObserver
 * that triggers a retry whenever the DOM changes. Gives up after ~10 seconds.
 */
async function executeElementJS(tabId, jsCode, elementId) {
  // Ensure helper functions are available before running element code
  await injectAlbertHelpers(tabId);

  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (code, id) => {
      const MAX_RETRIES = 10;
      const BASE_DELAY = 300;   // ms
      const MAX_DELAY = 3000;   // ms
      let attempt = 0;
      let observer = null;
      let timeoutId = null;
      let settled = false;

      // Try to determine the expected data-albert-element value from the code.
      // This lets us verify that the element was actually created in the DOM,
      // catching "graceful" failures where the code logs a warning and returns
      // early without throwing.
      const albertAttrMatch = code.match(
        /data-albert-element["']\s*,\s*["']([^"']+)["']|data-albert-element\s*=\s*["']([^"']+)["']/
      );
      const expectedAlbertSelector = albertAttrMatch
        ? `[data-albert-element="${albertAttrMatch[1] || albertAttrMatch[2]}"]`
        : null;

      function wasElementCreated() {
        if (!expectedAlbertSelector) return true; // can't verify — assume success
        return !!document.querySelector(expectedAlbertSelector);
      }

      function execute() {
        try {
          const fn = new Function(code);
          fn();

          // The code ran without throwing — but did it actually succeed?
          // Check if the expected DOM element was created.
          if (wasElementCreated()) {
            cleanup();
            return true;
          }
          // Code didn't throw but the element wasn't created
          // (e.g. old code that logs "not found" and returns early)
          return false;
        } catch (e) {
          return false;
        }
      }

      function cleanup() {
        settled = true;
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }

      function scheduleRetry() {
        if (settled) return;
        attempt++;
        if (attempt > MAX_RETRIES) {
          console.warn(
            `[Albert] Element "${id}" — could not inject after ${MAX_RETRIES} retries. ` +
            `The page may not contain the expected target elements.`
          );
          cleanup();
          return;
        }
        const delay = Math.min(BASE_DELAY * Math.pow(2, attempt - 1), MAX_DELAY);
        timeoutId = setTimeout(() => {
          if (settled) return;
          if (execute()) return;
          scheduleRetry();
        }, delay);
      }

      // First attempt — immediate
      if (execute()) return;

      // Set up MutationObserver to retry when DOM changes
      try {
        let mutationDebounce = null;
        observer = new MutationObserver(() => {
          if (settled) return;
          // Debounce rapid mutations (SPA rendering can trigger many in a burst)
          clearTimeout(mutationDebounce);
          mutationDebounce = setTimeout(() => {
            if (settled) return;
            // Cancel pending timer retry and try now
            if (timeoutId) clearTimeout(timeoutId);
            if (execute()) return;
            scheduleRetry();
          }, 100);
        });
        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
        });
      } catch {
        // MutationObserver might fail in rare contexts — fall back to timer only
      }

      // Also schedule a timer-based retry as a backstop
      scheduleRetry();
    },
    args: [jsCode, elementId],
  });
}

// ── Helpers ─────────────────────────────────────────────

function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
