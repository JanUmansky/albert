# Albert — AI-Powered Custom UI Elements for Any Webpage

Albert is a Chrome extension that lets you add custom UI/UX elements to any webpage using natural language. Describe what you want, and Albert will generate and inject the code automatically. Your customizations persist across page refreshes.

## Features

- **Chat Interface** — Describe the UI element you want in plain English
- **AI-Powered Generation** — Uses xAI's Grok API to analyze the page and generate code
- **Persistent Elements** — All customizations are saved locally and re-applied on page load
- **Element Management** — View, toggle, or delete your elements from the Elements panel
- **Privacy-First** — All data is stored locally in your browser. Your API key never leaves your machine (except to call the xAI API directly)

## Getting Started

### 1. Install the Extension

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `albert` folder
5. The Albert icon will appear in your Chrome toolbar

### 2. Configure Your API Key

1. Click the Albert icon in the toolbar
2. Click the gear icon (Settings)
3. Enter your xAI API key (get one at [console.x.ai](https://console.x.ai))
4. Select your preferred model (Grok 3 or Grok 3 Mini)
5. Click **Save Settings**

### 3. Add Elements to a Page

1. Navigate to any webpage
2. Click the Albert icon to open the chat
3. Describe what you want, for example:
   - *"Add a dark mode toggle button in the top-right corner"*
   - *"Add a button next to the submit form that copies all field values to clipboard"*
   - *"Add a floating word count indicator for the text area"*
4. Albert will analyze the page, generate the code, and inject it

### 4. Manage Your Elements

1. Click the grid icon in the header to open the Elements view
2. Toggle elements on/off with the switch
3. Delete elements you no longer need

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
│   └── storage.js             # Shared storage helpers
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## How It Works

1. **You describe** what UI element you want in the chat
2. **Albert reads** the page's DOM structure (simplified, no sensitive data)
3. **Grok generates** self-contained JavaScript and CSS code
4. **The code is injected** into the page and saved to local storage
5. **On every page load**, Albert checks for saved elements matching the current URL and re-injects them

## Requirements

- Google Chrome (or any Chromium-based browser)
- An xAI API key ([console.x.ai](https://console.x.ai))

## Privacy

- Your API key is stored locally in Chrome's extension storage
- Page content is sent to the xAI API only when you make a request
- No data is collected, tracked, or sent to any third party besides xAI
- All generated elements and settings are stored locally on your device
