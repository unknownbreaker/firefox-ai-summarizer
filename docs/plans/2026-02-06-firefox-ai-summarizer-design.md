# Firefox AI Summarizer — Design Document

**Date:** 2026-02-06

## Overview

Firefox AI Summarizer is a Firefox WebExtension that summarizes web content using LLM web UIs (ChatGPT, Claude, or a custom provider). It opens the LLM's web interface in Firefox's sidebar and auto-injects a summarization prompt — no API keys required, leveraging the user's existing LLM subscriptions.

### Core Features

1. **Page summarization** — Summarize the current page by URL
2. **Selection summarization** — Summarize highlighted text
3. **Multi-tab summarization** — Summarize all open tabs by URL

## Architecture

### Components

- **Background script** — Orchestrates everything. Listens for toolbar button clicks, context menu selections, and manages sidebar state. Queries tab URLs and constructs the final prompt from the user's chosen preset.
- **Content scripts (2 types):**
  - **Extractor script** — Injected into the user's active page to extract selected text (only used for selection summarization).
  - **Injector script** — Injected into the sidebar's LLM web UI to find the chat input, paste the prompt, and auto-submit.
- **Sidebar** — Loads the user's chosen LLM web UI. The injector content script runs inside it.
- **Settings page** — Extension options page for provider config, prompt presets, and general settings.

### Data Flow

1. User triggers action (toolbar button or context menu)
2. Background script gathers input (URL(s) from `tabs.query()`, or selected text via extractor script)
3. Background script constructs prompt using selected preset
4. Sidebar opens with LLM web UI
5. Injector script waits for chat input, pastes prompt, auto-submits
6. LLM generates summary in the sidebar

## LLM Provider Integration

### Provider Configuration

Each provider is defined as:

```json
{
  "id": "chatgpt",
  "name": "ChatGPT",
  "url": "https://chat.openai.com",
  "inputSelector": "textarea[data-id], #prompt-textarea",
  "submitSelector": "button[data-testid='send-button']",
  "readyCheck": "inputSelector exists and is enabled"
}
```

Each provider needs:
- **URL** to load in the sidebar
- **Input selector** — CSS selector for the chat input element
- **Submit selector** — CSS selector for the send button

### Built-in Providers

- **ChatGPT** (chat.openai.com)
- **Claude** (claude.ai)

Selectors are stored in `browser.storage.sync` (not hardcoded) so they can be updated by the user when LLM sites change their DOM.

### Custom Provider

The user supplies a URL and two CSS selectors. A "test selectors" button in settings opens the URL and highlights matched elements for verification.

### Injection Strategy

1. Injector content script waits for the chat input via `MutationObserver`
2. Sets the input value and dispatches `input`/`change` events for framework reactivity (React, etc.)
3. After a configurable delay, clicks the submit button

### Fallback

If auto-injection fails (selector not found after timeout), the extension copies the prompt to the clipboard and notifies the user: "Auto-inject failed. Prompt copied to clipboard — paste it manually."

## Features & Trigger UX

### Toolbar Button (Browser Action)

Clicking the extension icon shows a popup with:
- **Summarize This Page** — Sends the current page URL
- **Summarize All Tabs** — Sends all tab URLs in the current window
- **Provider selector** — Quick toggle between ChatGPT / Claude / Custom
- **Prompt style** — Dropdown to pick a preset

### Context Menu

Right-clicking selected text shows "Summarize Selection", using the currently active provider and prompt style.

### Content Handling

- **Page** — Only the URL is sent. No text extraction needed.
- **Selection** — `window.getSelection().toString()` via extractor content script. Truncated to a configurable character limit (default 10,000).
- **All tabs** — URLs collected from `browser.tabs.query()`. Each tab listed by title and URL.

### Prompt Construction

**Page summarization:**
```
Read the full content at the following URL and summarize it as if I had pasted the complete article text directly into this conversation:

https://example.com/article

<preset instruction>
```

**Multi-tab summarization:**
```
Read the full content at each of the following URLs and summarize each one as if I had pasted the complete article text directly into this conversation:

1. https://example.com/article-one
2. https://example.com/article-two

<preset instruction>
```

**Selection summarization:**
```
<preset instruction>

---
<selected text>
```

## Settings

### Provider Settings

- Radio buttons: ChatGPT, Claude, Custom
- Custom provider fields: URL, input CSS selector, submit CSS selector
- "Test selectors" button for custom provider verification
- Override fields for built-in provider selectors

### Prompt Presets

Built-in presets:
- **Concise** — "Provide a brief 2-3 sentence summary."
- **Detailed** — "Provide a thorough summary covering all key points."
- **Bullet points** — "Summarize as a concise bulleted list of key takeaways."

Users can add/edit/delete custom presets (name + instruction text). One preset is marked as the default.

### General Settings

- **Injection delay** (ms) — Time to wait before auto-submitting. Default: 500ms
- **Auto-submit toggle** — If disabled, injects prompt but doesn't click send
- **Character limit** — Max characters for selection text. Default: 10,000

### Storage

All settings use `browser.storage.sync` for cross-device sync.

## Error Handling & User Feedback

The extension uses `browser.notifications` for toast-style error messages. Each step in the injection pipeline has a timeout — if any step fails, the chain stops and the user is notified.

| Scenario | Message |
|---|---|
| LLM site not loaded | "Could not load [Provider]. Check your internet connection or try again." |
| Chat input not found | "Could not find the chat input on [Provider]. The site may have updated — check your selector settings." |
| Submit button not found | "Could not find the send button on [Provider]. Prompt was pasted — submit it manually." |
| User not logged in | "You may need to log in to [Provider]. Open the sidebar and sign in, then try again." |
| Selection extraction failed | "Could not read the selected text. Try selecting the text again." |
| No text selected | "No text is selected. Highlight some text first, then try again." |
| No tabs open | "No summarizable tabs found. Open some pages and try again." |
| Custom URL invalid | "Custom provider URL is not valid. Check your settings." |
| Clipboard fallback | "Auto-inject failed. The prompt has been copied to your clipboard — paste it manually." |

**Login detection:** If the injector script finds a login form or auth redirect instead of a chat input, it triggers the "not logged in" message.

## File Structure & Tech Stack

**Tech stack:** Plain JavaScript, no framework, no build step. Manifest V2.

**Manifest V2** — Firefox's sidebar API (`sidebarAction`) and content script injection are more straightforward in V2. Firefox has not deprecated V2.

```
firefox-ai-summarizer/
├── manifest.json
├── background.js
├── sidebar/
│   ├── sidebar.html
│   └── sidebar.js
├── popup/
│   ├── popup.html
│   └── popup.js
├── content/
│   ├── extractor.js
│   └── injector.js
├── settings/
│   ├── settings.html
│   └── settings.js
├── providers/
│   └── providers.js
├── lib/
│   └── prompt-builder.js
├── icons/
│   ├── icon-48.png
│   └── icon-96.png
└── README.md
```
