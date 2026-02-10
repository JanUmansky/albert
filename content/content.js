/**
 * Albert — Content Script
 * Runs on every webpage. Handles:
 * - Reading page DOM context for the LLM
 * - Injecting generated elements (JS + CSS)
 * - Auto-loading persisted elements on page load
 * - Removing/toggling elements on demand
 */

(() => {
  // Prevent double-initialization
  if (window.__albertContentInitialized) return;
  window.__albertContentInitialized = true;

  // ── Message Handler ─────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'GET_PAGE_CONTEXT':
        sendResponse(getPageContext());
        break;

      case 'INJECT_ELEMENT':
        injectElement(message.element, message.cssOnly);
        sendResponse({ success: true });
        break;

      case 'REMOVE_ELEMENT':
        removeElement(message.elementId);
        sendResponse({ success: true });
        break;

      case 'TOGGLE_ELEMENT':
        if (message.enabled) {
          // Re-inject: fetch from storage and inject
          reloadElement(message.elementId);
        } else {
          removeElement(message.elementId);
        }
        sendResponse({ success: true });
        break;

      case 'GET_DOM_FRAGMENT':
        sendResponse(getDomFragment(message.selector, message.maxLength));
        break;
    }
    return false;
  });

  // ── Page Context Reader ─────────────────────────────

  function getPageContext() {
    // Build a simplified representation of the page
    const html = getSimplifiedHTML();
    const landmarks = getPageLandmarks();
    const outline = getDomOutline();
    return {
      url: window.location.href,
      title: document.title,
      html,
      landmarks,
      outline,
    };
  }

  /**
   * Strip noise from a cloned DOM node: remove scripts, styles, SVGs,
   * hidden elements, Albert-injected elements, and unnecessary attributes.
   * Modifies the node in place.
   */
  function simplifyNode(clone) {
    const removeTags = ['script', 'style', 'svg', 'noscript', 'iframe'];
    removeTags.forEach(tag => {
      clone.querySelectorAll(tag).forEach(el => el.remove());
    });

    clone.querySelectorAll('[data-albert-id]').forEach(el => el.remove());
    clone.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(el => el.remove());

    const keepAttrs = ['id', 'class', 'name', 'type', 'value', 'placeholder',
      'href', 'src', 'action', 'method', 'role', 'aria-label',
      'data-testid', 'for', 'title', 'alt'];

    clone.querySelectorAll('*').forEach(el => {
      const attrs = [...el.attributes];
      attrs.forEach(attr => {
        if (!keepAttrs.includes(attr.name) && !attr.name.startsWith('data-')) {
          el.removeAttribute(attr.name);
        }
      });
      el.removeAttribute('style');
    });
  }

  function getSimplifiedHTML() {
    const clone = document.body.cloneNode(true);
    simplifyNode(clone);
    let html = clone.innerHTML;
    html = html.replace(/\s{2,}/g, ' ').trim();
    return html;
  }

  /**
   * Retrieve the simplified HTML of a specific element on the page.
   * Used by the LLM's get_dom_fragment tool to inspect specific sections.
   */
  function getDomFragment(selector, maxLength = 8000) {
    try {
      const el = document.querySelector(selector);
      if (!el) {
        return { error: `No element found matching "${selector}"` };
      }

      const clone = el.cloneNode(true);
      simplifyNode(clone);

      let html = clone.outerHTML;
      html = html.replace(/\s{2,}/g, ' ').trim();
      const totalLength = html.length;
      const truncated = totalLength > maxLength;

      if (truncated) {
        html = html.substring(0, maxLength) + '\n<!-- ... truncated ... -->';
      }

      return {
        html,
        selector,
        tag: el.tagName.toLowerCase(),
        childCount: el.children.length,
        totalLength,
        truncated,
      };
    } catch (err) {
      return { error: `Error querying "${selector}": ${err.message}` };
    }
  }

  /**
   * Build a compact DOM outline showing the page structure.
   * Helps the LLM identify which selectors to use when requesting
   * specific DOM fragments via the get_dom_fragment tool.
   */
  function getDomOutline(maxDepth = 4) {
    const lines = [];

    function walk(el, depth) {
      if (depth > maxDepth) return;
      if (el.nodeType !== Node.ELEMENT_NODE) return;

      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'svg', 'noscript', 'link', 'meta'].includes(tag)) return;
      if (el.hasAttribute('data-albert-id') || el.hasAttribute('data-albert-element')) return;
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') return;

      let desc = tag;
      if (el.id && /^[a-zA-Z][\w-]{0,40}$/.test(el.id)) desc += `#${el.id}`;

      const stableClasses = Array.from(el.classList)
        .filter(c => /^[a-zA-Z][\w-]{2,30}$/.test(c) && !/[0-9]{3,}/.test(c))
        .slice(0, 2);
      if (stableClasses.length > 0) desc += `.${stableClasses.join('.')}`;

      const role = el.getAttribute('role');
      if (role) desc += `[role="${role}"]`;

      const childEls = Array.from(el.children).filter(c =>
        c.nodeType === Node.ELEMENT_NODE &&
        !['script', 'style', 'svg', 'noscript', 'link', 'meta'].includes(c.tagName.toLowerCase()) &&
        !c.hasAttribute('data-albert-id')
      );

      const indent = '  '.repeat(depth);
      const childInfo = childEls.length > 0 ? ` (${childEls.length} children)` : '';

      // Add text preview for leaf elements
      let textPreview = '';
      if (childEls.length === 0) {
        const text = el.textContent?.trim();
        if (text && text.length > 0) {
          textPreview = ` "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`;
        }
      }

      lines.push(`${indent}${desc}${childInfo}${textPreview}`);

      const maxChildren = depth < 2 ? 20 : 10;
      const visibleChildren = childEls.slice(0, maxChildren);
      visibleChildren.forEach(child => walk(child, depth + 1));

      if (childEls.length > maxChildren) {
        lines.push(`${'  '.repeat(depth + 1)}... and ${childEls.length - maxChildren} more children`);
      }
    }

    if (document.body) {
      walk(document.body, 0);
    }

    return lines.join('\n');
  }

  /**
   * Identify key structural landmarks on the page and provide multiple
   * reliable selectors for each. This gives the LLM concrete, tested
   * selectors to use in generated code.
   */
  function getPageLandmarks() {
    const landmarks = [];

    // Semantic tags + ARIA roles we care about
    const queries = [
      { label: 'main content',     selectors: ['main', '[role="main"]'] },
      { label: 'navigation',       selectors: ['nav', '[role="navigation"]'] },
      { label: 'header / banner',  selectors: ['header', '[role="banner"]'] },
      { label: 'footer',           selectors: ['footer', '[role="contentinfo"]'] },
      { label: 'sidebar / aside',  selectors: ['aside', '[role="complementary"]'] },
      { label: 'article',          selectors: ['article', '[role="article"]'] },
      { label: 'search',           selectors: ['[role="search"]', 'form[action*="search"]'] },
    ];

    for (const q of queries) {
      for (const sel of q.selectors) {
        const el = document.querySelector(sel);
        if (el && !el.closest('[data-albert-id]')) {
          const working = buildWorkingSelectors(el);
          if (working.length > 0) {
            landmarks.push({ label: q.label, selectors: working });
          }
          break; // found one for this landmark type
        }
      }
    }

    // Also find the most likely "wrapper" / app root (first large direct child of body)
    const bodyChildren = Array.from(document.body.children).filter(
      el => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' &&
            el.tagName !== 'LINK' && !el.hasAttribute('data-albert-id') &&
            el.offsetHeight > 100
    );
    if (bodyChildren.length > 0 && bodyChildren.length <= 5) {
      for (let i = 0; i < Math.min(bodyChildren.length, 3); i++) {
        const el = bodyChildren[i];
        const working = buildWorkingSelectors(el);
        if (working.length > 0) {
          landmarks.push({ label: `body child #${i + 1}`, selectors: working });
        }
      }
    }

    return landmarks;
  }

  /**
   * Build an array of working CSS selectors for a given element,
   * ordered by reliability. Each selector is verified to actually
   * match the element before being included.
   */
  function buildWorkingSelectors(el) {
    const selectors = [];
    const tag = el.tagName.toLowerCase();

    // 1. Semantic tag
    if (['main', 'nav', 'header', 'footer', 'aside', 'article', 'section'].includes(tag)) {
      if (document.querySelectorAll(tag).length === 1) {
        selectors.push(tag);
      }
    }

    // 2. ARIA role
    const role = el.getAttribute('role');
    if (role) {
      const sel = `[role="${role}"]`;
      if (verify(sel, el)) selectors.push(sel);
    }

    // 3. ID (only if it looks stable — no hashes, no long random strings)
    if (el.id && /^[a-zA-Z][\w-]{0,40}$/.test(el.id) && !/[0-9]{4,}/.test(el.id)) {
      selectors.push(`#${el.id}`);
    }

    // 4. data-testid
    const testid = el.getAttribute('data-testid');
    if (testid) {
      selectors.push(`[data-testid="${testid}"]`);
    }

    // 5. Tag + stable class (skip hashed/random-looking classes)
    const stableClasses = Array.from(el.classList).filter(c =>
      /^[a-zA-Z][\w-]{2,30}$/.test(c) && !/[0-9]{3,}/.test(c) && !/^[a-z]{1,3}-[a-zA-Z0-9]{4,}$/.test(c)
    );
    if (stableClasses.length > 0) {
      const sel = `${tag}.${stableClasses[0]}`;
      if (verify(sel, el)) selectors.push(sel);
    }

    // 6. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.length < 60) {
      const sel = `${tag}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
      if (verify(sel, el)) selectors.push(sel);
    }

    // 7. Structural path from body (nth-child based)
    const path = buildStructuralPath(el);
    if (path && verify(path, el)) selectors.push(path);

    return selectors;
  }

  /**
   * Build a structural CSS selector path from body to the element
   * using tag names and :nth-of-type.
   */
  function buildStructuralPath(target) {
    const parts = [];
    let el = target;
    let depth = 0;
    while (el && el !== document.body && depth < 4) {
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length === 1) {
        parts.unshift(tag);
      } else {
        const idx = siblings.indexOf(el) + 1;
        parts.unshift(`${tag}:nth-of-type(${idx})`);
      }
      el = parent;
      depth++;
    }
    if (parts.length === 0) return null;
    return 'body > ' + parts.join(' > ');
  }

  /** Verify that a selector matches exactly the intended element */
  function verify(selector, expected) {
    try {
      return document.querySelector(selector) === expected;
    } catch {
      return false;
    }
  }

  // ── Element Injection ───────────────────────────────

  function injectElement(element, cssOnly = false) {
    if (!element || !element.id) return;

    // Remove existing instance first (idempotent)
    removeElement(element.id);

    // Inject CSS (style tags are not blocked by script-src CSP)
    if (element.code.css) {
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-albert-id', element.id);
      styleEl.setAttribute('data-albert-type', 'css');
      styleEl.textContent = element.code.css;
      document.head.appendChild(styleEl);
    }

    // Delegate JS execution to the service worker, which uses
    // chrome.scripting.executeScript() to bypass the page's CSP.
    // Skip if cssOnly flag is set (caller already handles JS separately).
    if (element.code.js && !cssOnly) {
      chrome.runtime.sendMessage({
        type: 'EXECUTE_ELEMENT_JS',
        code: element.code.js,
        elementId: element.id,
      });
    }
  }

  function removeElement(elementId) {
    // Remove all injected style and script tags
    document.querySelectorAll(`[data-albert-id="${elementId}"]`).forEach(el => {
      el.remove();
    });

    // Also remove any DOM elements created by the script that used albert- prefix
    // (best-effort: the generated code should handle cleanup, but we clean up known patterns)
    document.querySelectorAll(`[data-albert-element="${elementId}"]`).forEach(el => {
      el.remove();
    });
  }

  async function reloadElement(elementId) {
    try {
      const elements = await AlbertStorage.getElementsForUrl(window.location.href);
      const el = elements.find(e => e.id === elementId);
      if (el) {
        injectElement(el);
      }
    } catch {
      // Storage access might fail in some contexts
    }
  }

  // ── Auto-Load on Page Ready ─────────────────────────

  async function autoLoadElements() {
    try {
      const currentUrl = window.location.href;
      const result = await chrome.storage.local.get('albert_elements');
      const elements = result.albert_elements || [];

      const normalizedCurrent = normalizeUrl(currentUrl);
      const matching = elements.filter(
        el => normalizeUrl(el.url) === normalizedCurrent && el.enabled
      );

      matching.forEach(el => injectElement(el));
    } catch (err) {
      // Silently fail — don't disrupt the host page
      console.debug('[Albert] Auto-load error:', err.message);
    }
  }

  /**
   * Wait for the page to be fully loaded before auto-loading elements.
   * This handles SPAs and JS-heavy pages that render content after DOMContentLoaded.
   */
  function waitForPageReady() {
    return new Promise(resolve => {
      if (document.readyState === 'complete') {
        // Page is already fully loaded — add a small delay for JS frameworks to finish rendering
        setTimeout(resolve, 300);
        return;
      }
      // Wait for the 'load' event (all resources loaded)
      window.addEventListener('load', () => {
        // Small additional delay for JS frameworks (React, Vue, etc.) to mount
        setTimeout(resolve, 300);
      }, { once: true });
    });
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname + u.search;
    } catch {
      return url;
    }
  }

  // ── LLM Bridge (MAIN world ↔ Extension) ────────────

  /**
   * Relay LLM requests from injected element code (MAIN world)
   * to the service worker and send the response back.
   * MAIN world code calls window.__albertLLM(prompt) which posts a
   * message here; we forward it via chrome.runtime and post back.
   */
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'ALBERT_LLM_REQUEST') return;

    const { requestId, prompt, options } = event.data;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ELEMENT_LLM_CALL',
        prompt,
        options,
      });

      window.postMessage({
        type: 'ALBERT_LLM_RESPONSE',
        requestId,
        result: response.result || null,
        error: response.error || null,
      }, '*');
    } catch (err) {
      window.postMessage({
        type: 'ALBERT_LLM_RESPONSE',
        requestId,
        error: err.message || 'Failed to reach Albert extension',
      }, '*');
    }
  });

  // ── SPA / In-Page Navigation Detection ──────────────
  //
  // Many websites use the History API (pushState / replaceState) to
  // navigate without a full page reload.  The content script only runs
  // once per real page load, so we need to detect URL changes ourselves
  // and re-run autoLoadElements() for the new URL.
  //
  // After detecting a URL change we use a retry mechanism with
  // exponential backoff + MutationObserver (similar to executeElementJS
  // in the service worker) so we don't rely on a fixed delay.

  let _lastKnownUrl = window.location.href;
  let _navRetry = null; // handle to cancel an in-flight retry cycle

  function handleUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl === _lastKnownUrl) return;
    _lastKnownUrl = currentUrl;

    // Cancel any retry cycle from a previous navigation
    if (_navRetry) {
      _navRetry.cancel();
      _navRetry = null;
    }

    // Remove all Albert-injected elements from the previous page
    document.querySelectorAll('[data-albert-id]').forEach(el => el.remove());
    document.querySelectorAll('[data-albert-element]').forEach(el => el.remove());

    // Start retrying autoLoadElements with backoff + DOM observation
    _navRetry = retryAutoLoadOnNavigation();
  }

  /**
   * Retry autoLoadElements() with exponential backoff and a
   * MutationObserver that triggers an early attempt whenever the
   * DOM changes (i.e. the SPA is rendering new content).
   * Gives up after MAX_RETRIES (~10 s total).
   */
  function retryAutoLoadOnNavigation() {
    const MAX_RETRIES = 8;
    const BASE_DELAY = 200;   // ms
    const MAX_DELAY  = 3000;  // ms
    let attempt   = 0;
    let observer  = null;
    let timeoutId = null;
    let done      = false;

    function tryLoad() {
      if (done) return;
      attempt++;
      autoLoadElements();

      if (attempt >= MAX_RETRIES) {
        cleanup();
        return;
      }
      scheduleNext();
    }

    function scheduleNext() {
      if (done) return;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt - 1), MAX_DELAY);
      timeoutId = setTimeout(tryLoad, delay);
    }

    function cleanup() {
      done = true;
      if (observer)  { observer.disconnect(); observer = null; }
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    }

    // Watch for DOM mutations — the SPA is probably rendering new
    // content, so each burst of changes triggers an early retry.
    try {
      let debounce = null;
      observer = new MutationObserver(() => {
        if (done) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (done) return;
          // Cancel the pending backoff timer and try now
          if (timeoutId) clearTimeout(timeoutId);
          tryLoad();
        }, 200);
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {
      // MutationObserver unavailable — timer retries still work
    }

    // First attempt after a short initial delay
    timeoutId = setTimeout(tryLoad, BASE_DELAY);

    return { cancel: cleanup };
  }

  // Browser back / forward buttons
  window.addEventListener('popstate', () => handleUrlChange());

  // Hash-only changes (e.g. #section links)
  window.addEventListener('hashchange', () => handleUrlChange());

  // pushState / replaceState don't fire any event that content scripts
  // can listen to, so we poll for URL changes at a reasonable interval.
  setInterval(handleUrlChange, 500);

  // ── Boot ────────────────────────────────────────────

  waitForPageReady().then(() => autoLoadElements());
})();
