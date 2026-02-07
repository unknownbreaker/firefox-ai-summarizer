# AI Summarizer — Firefox Extension

A Firefox extension that summarizes web content using LLM web UIs (ChatGPT, Claude, or any custom provider) in the browser sidebar. No API keys required — it works by injecting prompts directly into the LLM chat interface you're already logged into.

## Features

- **Page summarization** — Summarize the current page by its URL. The prompt instructs the LLM to read the URL content as if the full article text was pasted.
- **Text selection summarization** — Highlight text on any page, right-click, and summarize just the selection.
- **Multi-tab summarization** — Summarize all open tabs at once by sending their URLs to the LLM in a single prompt.

## Supported Providers

| Provider | URL |
|----------|-----|
| ChatGPT  | `https://chat.openai.com` |
| Claude   | `https://claude.ai` |
| Custom   | Any LLM web UI (configure URL and CSS selectors in settings) |

## Installation

1. Open Firefox and navigate to `about:debugging`
2. Click **"This Firefox"** in the left sidebar
3. Click **"Load Temporary Add-on..."**
4. Select the `manifest.json` file from this project directory

The extension icon will appear in your toolbar.

## Usage

### Summarize the current page

1. Click the **AI Summarizer** toolbar icon
2. Select a provider and summary style
3. Click **"Summarize This Page"**
4. The sidebar opens with the LLM web UI and the prompt is auto-injected

### Summarize selected text

**Option A — Right-click context menu:**
1. Highlight text on any page
2. Right-click and select **"Summarize Selection"**

**Option B — Toolbar popup:**
1. Highlight text on any page
2. Click the toolbar icon
3. Click **"Summarize Selection"** (if available)

### Summarize all open tabs

1. Click the **AI Summarizer** toolbar icon
2. Click **"Summarize All Tabs"**
3. All non-internal tabs are sent to the LLM as a numbered URL list

## Settings

Open settings via the **"Settings"** link in the toolbar popup, or through Firefox's extension preferences.

### Provider

Choose between ChatGPT, Claude, or a custom provider. Custom providers require:
- **URL** — The LLM web UI address
- **Chat input CSS selector** — Selector for the text input element
- **Submit button CSS selector** — Selector for the send button

For built-in providers, you can override the default CSS selectors under **"Advanced: Override built-in selectors"** if the sites update their DOM.

### Prompt Presets

Three built-in presets:
- **Concise** — Brief 2-3 sentence summary (default)
- **Detailed** — Thorough summary covering all key points
- **Bullet Points** — Concise bulleted list of key takeaways

You can also add custom presets with your own instructions.

### General

- **Injection delay** — Milliseconds to wait before clicking submit after pasting the prompt (default: 500ms)
- **Auto-submit** — Automatically click the send button after injecting the prompt (default: on)
- **Character limit** — Maximum characters for selected text before truncation (default: 10,000)

## How It Works

The extension opens the LLM provider's web UI in a Firefox sidebar panel. When you trigger a summarization:

1. The **background script** builds a prompt (using the page URL, selected text, or list of tab URLs) and opens the sidebar
2. The **sidebar** loads the LLM web UI (e.g., `chat.openai.com`) in an iframe
3. A **content script (injector)** is injected into the LLM page, finds the chat input via CSS selector, pastes the prompt, and clicks submit
4. The LLM generates the summary directly in its own UI

If auto-injection fails, the prompt is copied to your clipboard so you can paste it manually.

## Known Limitations

- **CSS selectors may break.** ChatGPT and Claude can update their DOM structure at any time. If injection stops working, update the selectors in settings.
- **Page/tab summarization requires web browsing.** The LLM must have web browsing capability enabled to read URLs. Without it, the model cannot access the page content.
- **You must be logged in.** The extension loads the LLM web UI directly — you need an active session in that provider for it to work.
