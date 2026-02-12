# Albert — AI-Powered Custom UI Elements for Any Webpage

Albert is a Chrome extension that lets you add custom UI/UX elements to any webpage using natural language. Describe what you want in a chat interface, and Albert will analyze the page, generate self-contained JavaScript and CSS, and inject it into the DOM. Your customizations persist across page refreshes and are stored entirely in your browser.

## Motivation

Every web application ships with a fixed interface — the one its designers chose for the average user. But no two people use the web the same way:

**The problem:**
- There is no unified UI that works for everyone. A data analyst needs quick-export buttons on dashboards, a recruiter wants candidate-comparison panels on job boards, and a writer needs distraction-free overlays on research sites.
- Browser extensions from the store solve narrow, pre-defined use cases. If your need is even slightly different, you're out of luck.
- Userscripts (Tampermonkey, etc.) require you to write and maintain JavaScript yourself, and break whenever the site updates its DOM structure.
- Teams and individuals end up building one-off bookmarklets, scripts, or internal tools just to patch the gaps in third-party UIs they use daily.

**The solution:**
Albert puts an AI assistant in your sidebar that can *see* the page you're on and *build* on top of it. Instead of writing code, you describe what you need in plain English. Albert reads the live DOM, generates robust, self-contained code (with multi-selector fallbacks so it survives site updates), and injects it — all within seconds. Every element is saved locally and re-applied automatically, so your custom UI is there every time you visit.

## Use Cases

- **Data & productivity workflows** — Add export-to-CSV buttons, summary panels, or keyboard shortcuts to internal tools and SaaS apps that lack them.
- **Content & research** — Inject word counters, reading-time estimates, table-of-contents sidebars, or text highlighters on articles and documentation sites.
- **Accessibility & comfort** — Add dark mode toggles, font-size controls, or high-contrast overlays to sites that don't offer them.
- **Form & input enhancement** — Add clipboard-copy buttons, character counters, or auto-fill helpers next to forms you use frequently.
- **Visual & layout tweaks** — Hide distracting elements, reposition widgets, or add floating toolbars for quick access to features buried in menus.
- **AI-powered features** — Because elements can call the LLM at runtime (via `__albertLLM()`), you can add smart summarizers, translators, tone-rewriters, or text enhancers directly onto any page.
- **Prototyping & design** — Quickly test UI ideas on a live site without touching its source code.

## Practical Example

Say you use a project management tool daily and wish the task cards showed a character count on every text field and a one-click "copy all" button. Here's how that looks with Albert:

1. Navigate to the project management app.
2. Open Albert from the sidebar (click the extension icon).
3. Type:

   > *"Add a floating button in the bottom-right that copies all visible task titles to my clipboard as a bullet list."*

4. Albert reads the page structure, finds the task containers, and generates the code. The page reloads with your new button already in place.
5. Next day you realize you also want a character count on the description field. Open Albert again:

   > *"Add a live character counter below the task description textarea."*

6. Both elements now load automatically every time you visit that page.

Want to tweak the button's color? Just say:

> *"Change the copy button background to blue."*

Albert recognizes the existing element and updates only its CSS — no duplicates, no manual code editing.

## Features

- **Chat Interface** — Describe the UI element you want in plain English
- **AI-Powered Generation** — Uses your chosen LLM provider to analyze the page and generate code (supports Grok by xAI and ChatGPT by OpenAI)
- **Persistent Elements** — All customizations are saved locally and re-applied on page load
- **Element Management** — View, toggle, or delete your elements from the Elements panel
- **Element Code Chat** — Open any element's detail view to ask questions about its code or modify it directly
- **DOM Inspection Loop** — On large pages, Albert can request deeper views of specific DOM sections before generating code
- **Runtime LLM Access** — Generated elements can call the AI model for smart features like text enhancement, summarization, and translation
- **Privacy-First** — All data is stored locally in your browser. Your API key never leaves your machine (except to call the selected LLM provider's API directly)

## Installation

Albert is not on the Chrome Web Store — you install it manually as an unpacked extension. This takes about two minutes.

### Prerequisites

- **Google Chrome** (or any Chromium-based browser: Edge, Brave, Arc, etc.)
- **An API key for your chosen LLM provider** — currently supported:
  - **Grok (xAI)** — sign up and generate a key at [console.x.ai](https://console.x.ai)
  - **ChatGPT (OpenAI)** — sign up and generate a key at [platform.openai.com](https://platform.openai.com/api-keys)
- **Git** (optional — you can also download a ZIP)

### Step 1: Get the Code

**Option A — Clone with Git:**

```bash
git clone https://github.com/JanUmansky/albert.git
```

**Option B — Download ZIP:**

1. Go to the repository page on GitHub
2. Click the green **Code** button, then **Download ZIP**
3. Extract the ZIP to a folder on your machine (e.g. `~/Dev/albert`)

> **Note:** Remember where you put the folder — Chrome needs to point at it, and you should not move or delete it after loading the extension.

### Step 2: Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** — flip the toggle in the top-right corner of the page
3. Click **Load unpacked** (a button that appears once Developer mode is on)
4. In the file picker, select the `albert` folder (the one containing `manifest.json`)
5. Albert should now appear in your extensions list with its icon

> **Tip:** If you don't see the icon in the toolbar, click the puzzle-piece icon (Extensions menu) in Chrome's toolbar and pin Albert.

### Step 3: Configure Your LLM Provider

1. Click the Albert icon in the toolbar to open the side panel
2. Click the **gear icon** (Settings) in the top-right of the panel
3. Select your **LLM Provider** from the dropdown (Grok by xAI or ChatGPT by OpenAI)
4. Paste your API key into the **API Key** field — the placeholder and help link update automatically based on the selected provider
5. Select your preferred model (the model list updates based on the selected provider):
   - **Grok 3** / **Grok 3 Mini** (xAI)
   - **GPT-4o** / **GPT-4o Mini** / **o3-mini** (OpenAI)
6. Optionally adjust the **API Base URL** if you're using a proxy or custom endpoint
7. Click **Save Settings**

You're ready to go. The API key is stored locally in Chrome's extension storage and never leaves your machine except in direct HTTPS calls to the selected provider's API.

### Step 4: Verify It Works

1. Navigate to any webpage (e.g. `https://news.ycombinator.com`)
2. Click the Albert icon to open the side panel
3. Type something like: *"Add a dark mode toggle in the top-right corner"*
4. Albert should read the page, generate the code, and reload the page with your new element injected

If you see an error, check the [Gotchas & Pitfalls](#gotchas--pitfalls) section below.

### Updating

Since Albert is loaded as an unpacked extension, updating is manual:

1. Pull the latest code (`git pull`) or download and extract a fresh ZIP
2. Go to `chrome://extensions/`
3. Click the **reload icon** (circular arrow) on the Albert card

Your saved elements and settings are stored in Chrome's local storage — they survive extension reloads.

## Usage

### Add Elements to a Page

1. Navigate to any webpage
2. Click the Albert icon to open the chat
3. Describe what you want, for example:
   - *"Add a dark mode toggle button in the top-right corner"*
   - *"Add a button next to the submit form that copies all field values to clipboard"*
   - *"Add a floating word count indicator for the text area"*
4. Albert will analyze the page, generate the code, and inject it

### Manage Your Elements

1. Click the grid icon in the header to open the Elements view
2. Toggle elements on/off with the switch
3. Click any element to view its code, or chat with it to make targeted changes
4. Delete elements you no longer need

## Gotchas & Pitfalls

Before diving in, keep these in mind:

- **Chrome-internal pages are off-limits.** Albert cannot access `chrome://`, `chrome-extension://`, or `edge://` pages. The content script won't load there, and you'll see a "Cannot access this page" error. Stick to regular `http://` and `https://` sites.

- **Heavy SPAs may need a moment.** Single-page apps (React, Next.js, Angular, etc.) often render content asynchronously. Albert's injector retries with exponential backoff and a MutationObserver, but if the target element takes more than ~10 seconds to appear, the injection will silently give up. A page refresh usually fixes it.

- **Dynamic class names break selectors.** Sites using CSS-in-JS (styled-components, Emotion, Tailwind JIT) generate class names like `css-1a2b3c` that change on every build. Albert mitigates this by generating multi-selector fallbacks (semantic tags, ARIA roles, data attributes), but occasionally the AI may latch onto a brittle selector. If an element stops working after a site update, open its code chat and ask Albert to fix the selectors.

- **CSP restrictions on some sites.** Albert uses `chrome.scripting.executeScript` in the MAIN world to bypass Content Security Policy, but a small number of sites with especially strict CSP configurations may still block execution. If your element's JS silently fails, this is likely the cause.

- **One conversation per URL.** Albert maintains a separate chat history for each page URL. If a site changes its URL structure (e.g., adds query parameters), Albert treats it as a new page. Elements are matched by normalized URL (protocol + host + path, ignoring query strings and fragments).

- **Token limits on large pages.** The page HTML sent to the LLM is truncated to ~12,000 characters. On very large pages, the AI might not see the section you're referring to in the first pass. Albert handles this with an inspect loop (the AI can request specific DOM sections by selector), but you may need to be specific about *where* on the page you want the element.

- **Elements run on every matching page load.** Once created, an element's JS and CSS are re-injected every time you visit that URL. If the element has side effects (e.g., makes network requests, modifies form data), be aware it will run every time. Use the toggle in the Elements panel to disable it when not needed.

- **API key and costs.** Albert calls the selected LLM provider's API on every chat message. Each message includes the page context (~12K chars) plus conversation history, which can consume a meaningful number of tokens. Smaller models (e.g. Grok 3 Mini) are cheaper if you want to experiment freely. Your API key is stored in Chrome's local extension storage — it never leaves your machine except in direct HTTPS calls to the provider's API.

- **No undo for element code.** When Albert updates an element's code, the previous version is overwritten. There's no version history or undo. If you're about to make a big change, consider copying the current code from the detail view first.

## Project Structure

```
albert/
├── manifest.json              # Chrome extension manifest (MV3)
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.css              # Styles
│   ├── popup.js               # SPA router
│   └── views/
│       ├── chat.js            # Chat view logic
│       ├── settings.js        # Settings view logic
│       └── elements.js        # Elements management view
├── background/
│   └── service-worker.js      # LLM orchestration & storage
├── content/
│   ├── content.js             # DOM reader & element injector
│   └── content.css            # Base styles for injected elements
├── lib/
│   ├── storage.js             # Shared storage helpers
│   ├── llm.js                 # LLM middleware — provider registry & unified API
│   └── syntax-highlight.js    # Code highlighting for detail view
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## How It Works

1. **You describe** what UI element you want in the chat
2. **Albert reads** the page's DOM structure (simplified, no sensitive data)
3. **The LLM generates** self-contained JavaScript and CSS code with multi-selector fallbacks for resilience
4. **The code is injected** into the page and saved to local storage
5. **On every page load**, Albert checks for saved elements matching the current URL and re-injects them
6. **To modify**, just tell Albert what to change — it recognizes existing elements and updates them in place

## Requirements

- Google Chrome (or any Chromium-based browser)
- An API key for a supported LLM provider:
  - **Grok (xAI)** — [console.x.ai](https://console.x.ai)
  - **ChatGPT (OpenAI)** — [platform.openai.com](https://platform.openai.com/api-keys)

## API Key & Privacy

> **Albert does not ship with an API key.** You must bring your own key from a supported LLM provider. The key is stored locally in Chrome's extension storage and is **never** included in the source code or transmitted anywhere except in direct HTTPS calls to the provider's API.

- Page content is sent to the selected LLM provider's API only when you make a request
- No data is collected, tracked, or sent to any third party besides the LLM provider you configure
- All generated elements and settings are stored locally on your device
