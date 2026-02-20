# Firefox AI Summarizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Firefox WebExtension that summarizes web content by auto-injecting prompts into LLM web UIs (ChatGPT, Claude, custom) displayed in Firefox's sidebar.

**Architecture:** Manifest V2 WebExtension with background script orchestration, two content scripts (extractor for selections, injector for LLM UIs), a sidebar that loads LLM web UIs, a popup for toolbar actions, and a settings page. No build step — plain JavaScript.

**Tech Stack:** Plain JavaScript, Firefox WebExtension API (Manifest V2), browser.storage.sync

**Design doc:** `docs/plans/2026-02-06-firefox-ai-summarizer-design.md`

---

## Task 1: Project Scaffold & Manifest

**Files:**
- Create: `manifest.json`
- Create: `background.js` (empty placeholder)
- Create: `sidebar/sidebar.html` (empty placeholder)
- Create: `sidebar/sidebar.js` (empty placeholder)
- Create: `popup/popup.html` (empty placeholder)
- Create: `popup/popup.js` (empty placeholder)
- Create: `content/extractor.js` (empty placeholder)
- Create: `content/injector.js` (empty placeholder)
- Create: `settings/settings.html` (empty placeholder)
- Create: `settings/settings.js` (empty placeholder)
- Create: `providers/providers.js` (empty placeholder)
- Create: `lib/prompt-builder.js` (empty placeholder)
- Create: `icons/icon-48.png` (placeholder)
- Create: `icons/icon-96.png` (placeholder)

**Step 1: Create manifest.json**

```json
{
  "manifest_version": 2,
  "name": "AI Summarizer",
  "version": "0.1.0",
  "description": "Summarize web content using LLM web UIs in the sidebar.",
  "permissions": [
    "activeTab",
    "tabs",
    "storage",
    "contextMenus",
    "clipboardWrite",
    "notifications",
    "<all_urls>"
  ],
  "background": {
    "scripts": ["providers/providers.js", "lib/prompt-builder.js", "background.js"]
  },
  "browser_action": {
    "default_icon": {
      "48": "icons/icon-48.png",
      "96": "icons/icon-96.png"
    },
    "default_popup": "popup/popup.html",
    "default_title": "AI Summarizer"
  },
  "sidebar_action": {
    "default_title": "AI Summarizer",
    "default_panel": "sidebar/sidebar.html",
    "default_icon": {
      "48": "icons/icon-48.png",
      "96": "icons/icon-96.png"
    }
  },
  "options_ui": {
    "page": "settings/settings.html",
    "open_in_tab": true
  },
  "content_scripts": [],
  "icons": {
    "48": "icons/icon-48.png",
    "96": "icons/icon-96.png"
  }
}
```

**Step 2: Create all placeholder files**

Create every file listed above with minimal content. Each `.js` file gets `// TODO: implement`. Each `.html` file gets a basic HTML5 skeleton. Icons get placeholder PNGs (1x1 pixel).

**Step 3: Verify extension loads in Firefox**

Run: Open Firefox → `about:debugging` → "This Firefox" → "Load Temporary Add-on" → select `manifest.json`
Expected: Extension loads without errors, toolbar icon appears, sidebar entry appears.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: scaffold project structure and manifest"
```

---

## Task 2: Provider Configuration Module

**Files:**
- Create: `providers/providers.js`
- Create: `test/providers.test.html` (manual test page)

**Step 1: Write providers.js with default provider configs**

```javascript
const DEFAULT_PROVIDERS = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chat.openai.com",
    inputSelector: "#prompt-textarea",
    submitSelector: "button[data-testid='send-button']"
  },
  claude: {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/new",
    inputSelector: "div.ProseMirror[contenteditable='true']",
    submitSelector: "button[aria-label='Send Message']"
  }
};

const CUSTOM_PROVIDER_TEMPLATE = {
  id: "custom",
  name: "Custom",
  url: "",
  inputSelector: "",
  submitSelector: ""
};

/**
 * Load the active provider config from storage.
 * Falls back to chatgpt if nothing is stored.
 * Merges any user selector overrides on top of defaults.
 */
async function getActiveProvider() {
  const stored = await browser.storage.sync.get([
    "activeProviderId",
    "providerOverrides",
    "customProvider"
  ]);

  const providerId = stored.activeProviderId || "chatgpt";

  if (providerId === "custom") {
    const custom = stored.customProvider || CUSTOM_PROVIDER_TEMPLATE;
    if (!custom.url) {
      return { provider: null, error: "Custom provider URL is not valid. Check your settings." };
    }
    return { provider: { ...CUSTOM_PROVIDER_TEMPLATE, ...custom }, error: null };
  }

  const base = DEFAULT_PROVIDERS[providerId];
  if (!base) {
    return { provider: null, error: `Unknown provider: ${providerId}` };
  }

  const overrides = (stored.providerOverrides || {})[providerId] || {};
  return {
    provider: { ...base, ...overrides },
    error: null
  };
}

/**
 * Save active provider choice to storage.
 */
async function setActiveProvider(providerId) {
  await browser.storage.sync.set({ activeProviderId: providerId });
}
```

**Step 2: Create a manual test page to verify provider loading**

Create `test/providers.test.html` — a simple HTML page that loads a mock `browser.storage.sync` and `providers.js`, then logs the result of `getActiveProvider()`. This is for manual verification during development.

```html
<!DOCTYPE html>
<html>
<head><title>Provider Test</title></head>
<body>
<pre id="output"></pre>
<script>
// Mock browser.storage.sync for testing outside extension context
const browser = {
  storage: {
    sync: {
      _data: {},
      async get(keys) {
        const result = {};
        for (const k of keys) {
          if (k in this._data) result[k] = this._data[k];
        }
        return result;
      },
      async set(obj) {
        Object.assign(this._data, obj);
      }
    }
  }
};
</script>
<script src="../providers/providers.js"></script>
<script>
async function runTests() {
  const out = document.getElementById("output");
  function log(msg) { out.textContent += msg + "\n"; }

  // Test 1: Default provider is chatgpt
  let result = await getActiveProvider();
  log("Test 1 - Default provider:");
  log(JSON.stringify(result, null, 2));
  log(result.provider.id === "chatgpt" ? "PASS" : "FAIL");

  // Test 2: Switch to claude
  await setActiveProvider("claude");
  result = await getActiveProvider();
  log("\nTest 2 - Claude provider:");
  log(JSON.stringify(result, null, 2));
  log(result.provider.id === "claude" ? "PASS" : "FAIL");

  // Test 3: Custom provider with no URL returns error
  await setActiveProvider("custom");
  result = await getActiveProvider();
  log("\nTest 3 - Custom with no URL:");
  log(JSON.stringify(result, null, 2));
  log(result.error !== null ? "PASS" : "FAIL");

  // Test 4: Custom provider with valid URL
  browser.storage.sync._data.customProvider = {
    url: "http://localhost:8080",
    inputSelector: "textarea",
    submitSelector: "button"
  };
  result = await getActiveProvider();
  log("\nTest 4 - Custom with URL:");
  log(JSON.stringify(result, null, 2));
  log(result.provider.url === "http://localhost:8080" ? "PASS" : "FAIL");

  // Test 5: Provider overrides merge correctly
  await setActiveProvider("chatgpt");
  browser.storage.sync._data.providerOverrides = {
    chatgpt: { inputSelector: "textarea.custom-selector" }
  };
  result = await getActiveProvider();
  log("\nTest 5 - Overrides:");
  log(JSON.stringify(result, null, 2));
  log(result.provider.inputSelector === "textarea.custom-selector" ? "PASS" : "FAIL");
}
runTests();
</script>
</body>
</html>
```

**Step 3: Open test page in browser, verify all 5 tests pass**

Run: Open `test/providers.test.html` in any browser.
Expected: All 5 tests show PASS.

**Step 4: Commit**

```bash
git add providers/providers.js test/providers.test.html
git commit -m "feat: add provider configuration module with defaults and storage"
```

---

## Task 3: Prompt Builder Module

**Files:**
- Create: `lib/prompt-builder.js`
- Create: `test/prompt-builder.test.html`

**Step 1: Write prompt-builder.js**

```javascript
const DEFAULT_PRESETS = [
  { id: "concise", name: "Concise", instruction: "Provide a brief 2-3 sentence summary.", isDefault: true },
  { id: "detailed", name: "Detailed", instruction: "Provide a thorough summary covering all key points.", isDefault: false },
  { id: "bullets", name: "Bullet Points", instruction: "Summarize as a concise bulleted list of key takeaways.", isDefault: false }
];

/**
 * Load all presets (built-in + custom) from storage.
 */
async function getPresets() {
  const stored = await browser.storage.sync.get(["customPresets", "defaultPresetId"]);
  const custom = stored.customPresets || [];
  const defaultId = stored.defaultPresetId || "concise";

  const all = [...DEFAULT_PRESETS, ...custom].map(p => ({
    ...p,
    isDefault: p.id === defaultId
  }));

  return all;
}

/**
 * Get a single preset by ID. Falls back to the first default preset.
 */
async function getPreset(presetId) {
  const presets = await getPresets();
  return presets.find(p => p.id === presetId) || presets.find(p => p.isDefault) || presets[0];
}

/**
 * Build a prompt for page summarization (single URL).
 */
function buildPagePrompt(url, presetInstruction) {
  return `Read the full content at the following URL and summarize it as if I had pasted the complete article text directly into this conversation:

${url}

${presetInstruction}`;
}

/**
 * Build a prompt for multi-tab summarization (list of URLs with titles).
 * tabs: Array of { title, url }
 */
function buildTabsPrompt(tabs, presetInstruction) {
  const tabList = tabs
    .map((tab, i) => `${i + 1}. ${tab.title}\n   ${tab.url}`)
    .join("\n");

  return `Read the full content at each of the following URLs and summarize each one as if I had pasted the complete article text directly into this conversation:

${tabList}

${presetInstruction}`;
}

/**
 * Build a prompt for selection summarization (pasted text).
 * Truncates text to charLimit.
 */
function buildSelectionPrompt(selectedText, presetInstruction, charLimit = 10000) {
  const truncated = selectedText.length > charLimit
    ? selectedText.slice(0, charLimit) + "\n\n[Text truncated at " + charLimit + " characters]"
    : selectedText;

  return `${presetInstruction}

---
${truncated}`;
}
```

**Step 2: Write test page**

```html
<!DOCTYPE html>
<html>
<head><title>Prompt Builder Test</title></head>
<body>
<pre id="output"></pre>
<script>
const browser = {
  storage: {
    sync: {
      _data: {},
      async get(keys) {
        const result = {};
        for (const k of keys) {
          if (k in this._data) result[k] = this._data[k];
        }
        return result;
      },
      async set(obj) { Object.assign(this._data, obj); }
    }
  }
};
</script>
<script src="../lib/prompt-builder.js"></script>
<script>
async function runTests() {
  const out = document.getElementById("output");
  function log(msg) { out.textContent += msg + "\n"; }

  // Test 1: buildPagePrompt
  const pagePrompt = buildPagePrompt("https://example.com/article", "Provide a brief summary.");
  log("Test 1 - Page prompt:");
  log(pagePrompt);
  log(pagePrompt.includes("https://example.com/article") ? "PASS" : "FAIL");
  log(pagePrompt.includes("as if I had pasted") ? "PASS" : "FAIL");

  // Test 2: buildTabsPrompt
  const tabsPrompt = buildTabsPrompt([
    { title: "Article One", url: "https://example.com/one" },
    { title: "Article Two", url: "https://example.com/two" }
  ], "Summarize in bullets.");
  log("\nTest 2 - Tabs prompt:");
  log(tabsPrompt);
  log(tabsPrompt.includes("1. Article One") ? "PASS" : "FAIL");
  log(tabsPrompt.includes("2. Article Two") ? "PASS" : "FAIL");

  // Test 3: buildSelectionPrompt
  const selPrompt = buildSelectionPrompt("Hello world", "Be concise.");
  log("\nTest 3 - Selection prompt:");
  log(selPrompt);
  log(selPrompt.includes("Hello world") ? "PASS" : "FAIL");
  log(selPrompt.startsWith("Be concise.") ? "PASS" : "FAIL");

  // Test 4: Selection truncation
  const longText = "a".repeat(15000);
  const truncPrompt = buildSelectionPrompt(longText, "Summarize.", 10000);
  log("\nTest 4 - Truncation:");
  log(truncPrompt.includes("[Text truncated at 10000 characters]") ? "PASS" : "FAIL");

  // Test 5: getPresets returns defaults
  const presets = await getPresets();
  log("\nTest 5 - Default presets:");
  log(presets.length === 3 ? "PASS" : "FAIL");
  log(presets[0].id === "concise" ? "PASS" : "FAIL");

  // Test 6: getPreset by ID
  const detailed = await getPreset("detailed");
  log("\nTest 6 - getPreset:");
  log(detailed.id === "detailed" ? "PASS" : "FAIL");

  // Test 7: getPreset fallback
  const fallback = await getPreset("nonexistent");
  log("\nTest 7 - Fallback preset:");
  log(fallback.id === "concise" ? "PASS" : "FAIL");
}
runTests();
</script>
</body>
</html>
```

**Step 3: Open test page, verify all tests pass**

Run: Open `test/prompt-builder.test.html` in any browser.
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add lib/prompt-builder.js test/prompt-builder.test.html
git commit -m "feat: add prompt builder with page, tabs, and selection prompt construction"
```

---

## Task 4: Sidebar (LLM Web UI Loader)

**Files:**
- Create: `sidebar/sidebar.html`
- Create: `sidebar/sidebar.js`

**Step 1: Write sidebar.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    #llm-frame {
      width: 100%;
      height: 100%;
      border: none;
    }
    #status {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: system-ui, sans-serif;
      color: #666;
      text-align: center;
    }
    #status.hidden { display: none; }
  </style>
</head>
<body>
  <div id="status">Loading LLM provider...</div>
  <iframe id="llm-frame" class="hidden"></iframe>
  <script src="sidebar.js"></script>
</body>
</html>
```

**Step 2: Write sidebar.js**

```javascript
const frame = document.getElementById("llm-frame");
const status = document.getElementById("status");

/**
 * Load the active provider's URL into the sidebar iframe.
 */
async function loadProvider() {
  const { provider, error } = await getActiveProvider();

  if (error) {
    status.textContent = error;
    status.classList.remove("hidden");
    frame.classList.add("hidden");
    return;
  }

  status.textContent = "Loading " + provider.name + "...";
  status.classList.remove("hidden");

  frame.src = provider.url;
  frame.classList.remove("hidden");

  frame.addEventListener("load", () => {
    status.classList.add("hidden");
  }, { once: true });
}

/**
 * Listen for messages from the background script to inject prompts.
 */
browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === "inject-prompt") {
    // Forward to injector content script running inside the iframe
    try {
      await browser.tabs.sendMessage(message.tabId, {
        type: "do-inject",
        prompt: message.prompt,
        provider: message.provider
      });
    } catch (err) {
      // Fallback: copy to clipboard and notify
      await navigator.clipboard.writeText(message.prompt);
      browser.notifications.create({
        type: "basic",
        title: "AI Summarizer",
        message: "Auto-inject failed. The prompt has been copied to your clipboard — paste it manually."
      });
    }
  }

  if (message.type === "reload-provider") {
    loadProvider();
  }
});

// Load on sidebar open
loadProvider();
```

**Note:** The sidebar uses an iframe to load the LLM web UI. The `content/injector.js` will be injected into pages matching the provider URLs (configured via `manifest.json` or programmatic injection). This separation keeps the sidebar thin — it just loads the URL and relays messages.

**Step 3: Verify sidebar loads in Firefox**

Run: Load extension in `about:debugging` → Open sidebar via View → Sidebar → AI Summarizer.
Expected: Sidebar opens, shows "Loading ChatGPT..." status, then loads the ChatGPT page (or login screen if not logged in).

**Step 4: Commit**

```bash
git add sidebar/sidebar.html sidebar/sidebar.js
git commit -m "feat: add sidebar that loads LLM provider web UI"
```

---

## Task 5: Injector Content Script

**Files:**
- Create: `content/injector.js`

This is the most critical and fragile component — it interacts with third-party LLM web UIs.

**Step 1: Write injector.js**

```javascript
/**
 * Injector content script.
 * Runs inside the LLM web UI (ChatGPT, Claude, or custom).
 * Listens for "do-inject" messages, finds the chat input, pastes the prompt, and submits.
 */

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type !== "do-inject") return;

  const { prompt, provider } = message;

  try {
    const input = await waitForElement(provider.inputSelector, 10000);
    if (!input) {
      throw new Error("input-not-found");
    }

    // Detect if we're on a login page instead of the chat UI
    if (isLoginPage()) {
      browser.runtime.sendMessage({
        type: "injection-error",
        error: "not-logged-in",
        providerName: provider.name
      });
      return;
    }

    await setInputValue(input, prompt);

    // Wait for the configured injection delay
    const settings = await browser.storage.sync.get(["injectionDelay", "autoSubmit"]);
    const delay = settings.injectionDelay || 500;
    const autoSubmit = settings.autoSubmit !== false; // default true

    if (autoSubmit) {
      await sleep(delay);

      const submitBtn = document.querySelector(provider.submitSelector);
      if (!submitBtn) {
        browser.runtime.sendMessage({
          type: "injection-error",
          error: "submit-not-found",
          providerName: provider.name
        });
        return;
      }

      submitBtn.click();
    }

    browser.runtime.sendMessage({ type: "injection-success" });

  } catch (err) {
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(prompt);
    } catch (_) {
      // clipboard may not be available
    }

    browser.runtime.sendMessage({
      type: "injection-error",
      error: err.message || "unknown",
      providerName: provider.name
    });
  }
});

/**
 * Wait for an element matching the selector to appear in the DOM.
 * Uses MutationObserver with a timeout.
 */
function waitForElement(selector, timeoutMs) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * Set the value of a chat input element, handling different input types.
 * Dispatches events to trigger framework reactivity (React, Vue, etc).
 */
function setInputValue(element, value) {
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    // Standard input/textarea
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }
  } else if (element.getAttribute("contenteditable")) {
    // ContentEditable div (e.g., Claude's ProseMirror editor)
    element.focus();
    element.innerHTML = "";

    // Use document.execCommand for contenteditable to trigger proper events
    document.execCommand("insertText", false, value);
  }

  // Dispatch events for framework reactivity
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Basic heuristic to detect if the current page is a login/auth page.
 */
function isLoginPage() {
  const url = window.location.href.toLowerCase();
  const loginKeywords = ["/login", "/signin", "/sign-in", "/auth", "/sso"];
  if (loginKeywords.some(kw => url.includes(kw))) return true;

  const passwordFields = document.querySelectorAll('input[type="password"]');
  if (passwordFields.length > 0) return true;

  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Step 2: Test manually in Firefox**

Run: Load extension → open sidebar → check browser console for errors.
Expected: No errors on load. The injector script is passive until it receives a `do-inject` message.

**Step 3: Commit**

```bash
git add content/injector.js
git commit -m "feat: add injector content script for LLM web UI prompt injection"
```

---

## Task 6: Extractor Content Script

**Files:**
- Create: `content/extractor.js`

**Step 1: Write extractor.js**

```javascript
/**
 * Extractor content script.
 * Injected into the user's active page to extract selected text.
 * Responds to "extract-selection" messages from the background script.
 */

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "extract-selection") return;

  const selection = window.getSelection().toString().trim();

  if (!selection) {
    sendResponse({ text: null, error: "No text is selected. Highlight some text first, then try again." });
    return;
  }

  sendResponse({ text: selection, error: null });
});
```

**Step 2: Verify script loads without errors**

Run: Load extension, open any webpage, check console.
Expected: No errors. Script is passive.

**Step 3: Commit**

```bash
git add content/extractor.js
git commit -m "feat: add extractor content script for text selection"
```

---

## Task 7: Background Script (Orchestration)

**Files:**
- Create: `background.js`

This is the central hub. It registers the context menu, handles toolbar popup messages, coordinates content extraction, builds prompts, and triggers the sidebar injection.

**Step 1: Write background.js**

```javascript
/**
 * Background script — orchestrates the extension.
 * Registers context menus, handles messages from popup and content scripts,
 * builds prompts, and triggers sidebar injection.
 */

// --- Context Menu Setup ---

browser.contextMenus.create({
  id: "summarize-selection",
  title: "Summarize Selection",
  contexts: ["selection"]
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "summarize-selection") {
    await handleSummarizeSelection(tab);
  }
});

// --- Message Handling (from popup, sidebar, injector) ---

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message.type === "summarize-page") {
    await handleSummarizePage();
  }

  if (message.type === "summarize-tabs") {
    await handleSummarizeTabs();
  }

  if (message.type === "summarize-selection-from-popup") {
    const tab = await getActiveTab();
    await handleSummarizeSelection(tab);
  }

  if (message.type === "injection-error") {
    await handleInjectionError(message);
  }

  if (message.type === "injection-success") {
    // No action needed — LLM is generating the summary in the sidebar
  }
});

// --- Feature Handlers ---

async function handleSummarizePage() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    notify("No active page found.");
    return;
  }

  const preset = await getDefaultPreset();
  const prompt = buildPagePrompt(tab.url, preset.instruction);
  await injectPrompt(prompt);
}

async function handleSummarizeTabs() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const summarizableTabs = tabs.filter(t => t.url && !t.url.startsWith("about:") && !t.url.startsWith("moz-extension:"));

  if (summarizableTabs.length === 0) {
    notify("No summarizable tabs found. Open some pages and try again.");
    return;
  }

  const tabData = summarizableTabs.map(t => ({ title: t.title || t.url, url: t.url }));
  const preset = await getDefaultPreset();
  const prompt = buildTabsPrompt(tabData, preset.instruction);
  await injectPrompt(prompt);
}

async function handleSummarizeSelection(tab) {
  if (!tab) {
    notify("No active tab found.");
    return;
  }

  try {
    // Inject extractor and get selection
    await browser.tabs.executeScript(tab.id, { file: "content/extractor.js" });
    const results = await browser.tabs.sendMessage(tab.id, { type: "extract-selection" });

    if (results.error) {
      notify(results.error);
      return;
    }

    const settings = await browser.storage.sync.get(["charLimit"]);
    const charLimit = settings.charLimit || 10000;

    const preset = await getDefaultPreset();
    const prompt = buildSelectionPrompt(results.text, preset.instruction, charLimit);
    await injectPrompt(prompt);

  } catch (err) {
    notify("Could not read the selected text. Try selecting the text again.");
  }
}

// --- Injection Pipeline ---

async function injectPrompt(prompt) {
  const { provider, error } = await getActiveProvider();

  if (error) {
    notify(error);
    return;
  }

  // Open the sidebar
  await browser.sidebarAction.open();

  // Give the sidebar a moment to load, then tell it to inject
  // The sidebar will relay to the injector content script
  setTimeout(() => {
    browser.runtime.sendMessage({
      type: "inject-prompt",
      prompt: prompt,
      provider: provider
    });
  }, 2000);
}

// --- Helpers ---

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getDefaultPreset() {
  const presets = await getPresets();
  return presets.find(p => p.isDefault) || presets[0];
}

function notify(message) {
  browser.notifications.create({
    type: "basic",
    title: "AI Summarizer",
    message: message
  });
}

async function handleInjectionError(message) {
  const providerName = message.providerName || "the LLM";

  const errorMessages = {
    "input-not-found": `Could not find the chat input on ${providerName}. The site may have updated — check your selector settings.`,
    "submit-not-found": `Could not find the send button on ${providerName}. Prompt was pasted — submit it manually.`,
    "not-logged-in": `You may need to log in to ${providerName}. Open the sidebar and sign in, then try again.`,
    "unknown": `Auto-inject failed. The prompt has been copied to your clipboard — paste it manually.`
  };

  const msg = errorMessages[message.error] || errorMessages["unknown"];
  notify(msg);
}
```

**Step 2: Test context menu registration**

Run: Load extension in Firefox. Right-click on selected text on any page.
Expected: "Summarize Selection" appears in the context menu.

**Step 3: Commit**

```bash
git add background.js
git commit -m "feat: add background script with orchestration, context menu, and injection pipeline"
```

---

## Task 8: Popup UI (Toolbar Button)

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.js`

**Step 1: Write popup.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 280px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: #1a1a1a;
      padding: 12px;
    }
    h1 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    button.action {
      display: block;
      width: 100%;
      padding: 8px 12px;
      margin-bottom: 6px;
      background: #0060df;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      text-align: left;
    }
    button.action:hover { background: #003eaa; }
    .divider {
      border-top: 1px solid #e0e0e0;
      margin: 10px 0;
    }
    label {
      display: block;
      font-size: 11px;
      color: #666;
      margin-bottom: 4px;
    }
    select {
      width: 100%;
      padding: 6px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .settings-link {
      display: block;
      text-align: center;
      color: #0060df;
      text-decoration: none;
      font-size: 11px;
      margin-top: 8px;
    }
    .settings-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>AI Summarizer</h1>

  <button class="action" id="summarize-page">Summarize This Page</button>
  <button class="action" id="summarize-tabs">Summarize All Tabs</button>

  <div class="divider"></div>

  <label for="provider-select">Provider</label>
  <select id="provider-select">
    <option value="chatgpt">ChatGPT</option>
    <option value="claude">Claude</option>
    <option value="custom">Custom</option>
  </select>

  <label for="preset-select">Summary Style</label>
  <select id="preset-select"></select>

  <a href="#" class="settings-link" id="open-settings">Settings</a>

  <script src="../providers/providers.js"></script>
  <script src="../lib/prompt-builder.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

**Step 2: Write popup.js**

```javascript
const providerSelect = document.getElementById("provider-select");
const presetSelect = document.getElementById("preset-select");

// --- Initialize ---

async function init() {
  // Load active provider
  const stored = await browser.storage.sync.get(["activeProviderId"]);
  providerSelect.value = stored.activeProviderId || "chatgpt";

  // Load presets
  const presets = await getPresets();
  presetSelect.innerHTML = "";
  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    if (preset.isDefault) option.selected = true;
    presetSelect.appendChild(option);
  }
}

// --- Event Listeners ---

document.getElementById("summarize-page").addEventListener("click", async () => {
  await saveSelections();
  await browser.runtime.sendMessage({ type: "summarize-page" });
  window.close();
});

document.getElementById("summarize-tabs").addEventListener("click", async () => {
  await saveSelections();
  await browser.runtime.sendMessage({ type: "summarize-tabs" });
  window.close();
});

providerSelect.addEventListener("change", async () => {
  await setActiveProvider(providerSelect.value);
  browser.runtime.sendMessage({ type: "reload-provider" });
});

presetSelect.addEventListener("change", async () => {
  await browser.storage.sync.set({ defaultPresetId: presetSelect.value });
});

document.getElementById("open-settings").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

async function saveSelections() {
  await setActiveProvider(providerSelect.value);
  await browser.storage.sync.set({ defaultPresetId: presetSelect.value });
}

init();
```

**Step 3: Verify popup works in Firefox**

Run: Load extension → click toolbar icon.
Expected: Popup appears with two action buttons, provider dropdown, preset dropdown, and settings link.

**Step 4: Commit**

```bash
git add popup/popup.html popup/popup.js
git commit -m "feat: add toolbar popup UI with provider and preset selection"
```

---

## Task 9: Settings Page

**Files:**
- Create: `settings/settings.html`
- Create: `settings/settings.js`

**Step 1: Write settings.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>AI Summarizer Settings</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 640px;
      margin: 0 auto;
      padding: 24px;
      color: #1a1a1a;
    }
    h1 { font-size: 20px; margin-bottom: 24px; }
    h2 { font-size: 16px; margin: 24px 0 12px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
    label { display: block; font-size: 13px; margin-bottom: 4px; font-weight: 500; }
    input[type="text"], input[type="number"], textarea {
      width: 100%;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
      margin-bottom: 12px;
      font-family: monospace;
    }
    textarea { height: 60px; resize: vertical; }
    .radio-group { margin-bottom: 12px; }
    .radio-group label { display: inline; font-weight: normal; margin-right: 16px; }
    .custom-fields { margin-left: 20px; margin-bottom: 12px; }
    .custom-fields.hidden { display: none; }
    button {
      padding: 8px 16px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 13px;
      margin-right: 8px;
    }
    button.primary { background: #0060df; color: white; border-color: #0060df; }
    button.primary:hover { background: #003eaa; }
    button.danger { color: #d70022; border-color: #d70022; }
    .preset-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      margin-bottom: 6px;
    }
    .preset-item .name { flex: 1; font-weight: 500; }
    .preset-item .instruction { flex: 2; color: #666; font-size: 12px; }
    .status { color: #058b00; font-size: 12px; margin-top: 8px; }
    .status.hidden { display: none; }
    .override-fields { margin-top: 8px; }
    .override-fields.hidden { display: none; }
    .toggle-overrides { font-size: 11px; color: #0060df; cursor: pointer; margin-bottom: 8px; display: inline-block; }
    .checkbox-row { margin-bottom: 12px; }
    .checkbox-row label { display: inline; font-weight: normal; }
  </style>
</head>
<body>
  <h1>AI Summarizer Settings</h1>

  <!-- Provider Settings -->
  <h2>Provider</h2>
  <div class="radio-group" id="provider-radios">
    <label><input type="radio" name="provider" value="chatgpt"> ChatGPT</label>
    <label><input type="radio" name="provider" value="claude"> Claude</label>
    <label><input type="radio" name="provider" value="custom"> Custom</label>
  </div>

  <div class="custom-fields hidden" id="custom-fields">
    <label for="custom-url">URL</label>
    <input type="text" id="custom-url" placeholder="https://your-llm.example.com">
    <label for="custom-input-selector">Chat Input CSS Selector</label>
    <input type="text" id="custom-input-selector" placeholder="textarea">
    <label for="custom-submit-selector">Submit Button CSS Selector</label>
    <input type="text" id="custom-submit-selector" placeholder="button[type=submit]">
    <button id="test-custom">Test Selectors</button>
  </div>

  <span class="toggle-overrides" id="toggle-overrides">Advanced: Override built-in selectors</span>
  <div class="override-fields hidden" id="override-fields">
    <label for="override-input">Input Selector Override</label>
    <input type="text" id="override-input" placeholder="Leave blank to use default">
    <label for="override-submit">Submit Selector Override</label>
    <input type="text" id="override-submit" placeholder="Leave blank to use default">
  </div>

  <!-- Prompt Presets -->
  <h2>Prompt Presets</h2>
  <div id="preset-list"></div>
  <h3 style="font-size:14px; margin: 16px 0 8px;">Add Custom Preset</h3>
  <label for="new-preset-name">Name</label>
  <input type="text" id="new-preset-name" placeholder="My Custom Style">
  <label for="new-preset-instruction">Instruction</label>
  <textarea id="new-preset-instruction" placeholder="Summarize in plain language for a 5th grader."></textarea>
  <button class="primary" id="add-preset">Add Preset</button>

  <!-- General Settings -->
  <h2>General</h2>
  <label for="injection-delay">Injection Delay (ms)</label>
  <input type="number" id="injection-delay" value="500" min="0" max="5000" step="100">

  <div class="checkbox-row">
    <input type="checkbox" id="auto-submit" checked>
    <label for="auto-submit">Auto-submit prompt after injection</label>
  </div>

  <label for="char-limit">Selection Character Limit</label>
  <input type="number" id="char-limit" value="10000" min="1000" max="100000" step="1000">

  <br><br>
  <button class="primary" id="save-settings">Save Settings</button>
  <span class="status hidden" id="save-status">Settings saved.</span>

  <script src="../providers/providers.js"></script>
  <script src="../lib/prompt-builder.js"></script>
  <script src="settings.js"></script>
</body>
</html>
```

**Step 2: Write settings.js**

```javascript
// --- DOM Elements ---
const providerRadios = document.querySelectorAll('input[name="provider"]');
const customFields = document.getElementById("custom-fields");
const customUrl = document.getElementById("custom-url");
const customInputSelector = document.getElementById("custom-input-selector");
const customSubmitSelector = document.getElementById("custom-submit-selector");
const toggleOverrides = document.getElementById("toggle-overrides");
const overrideFields = document.getElementById("override-fields");
const overrideInput = document.getElementById("override-input");
const overrideSubmit = document.getElementById("override-submit");
const presetList = document.getElementById("preset-list");
const newPresetName = document.getElementById("new-preset-name");
const newPresetInstruction = document.getElementById("new-preset-instruction");
const injectionDelay = document.getElementById("injection-delay");
const autoSubmit = document.getElementById("auto-submit");
const charLimit = document.getElementById("char-limit");
const saveStatus = document.getElementById("save-status");

// --- Load Settings ---

async function loadSettings() {
  const stored = await browser.storage.sync.get([
    "activeProviderId",
    "customProvider",
    "providerOverrides",
    "customPresets",
    "defaultPresetId",
    "injectionDelay",
    "autoSubmit",
    "charLimit"
  ]);

  // Provider
  const providerId = stored.activeProviderId || "chatgpt";
  const radio = document.querySelector(`input[name="provider"][value="${providerId}"]`);
  if (radio) radio.checked = true;
  customFields.classList.toggle("hidden", providerId !== "custom");

  if (stored.customProvider) {
    customUrl.value = stored.customProvider.url || "";
    customInputSelector.value = stored.customProvider.inputSelector || "";
    customSubmitSelector.value = stored.customProvider.submitSelector || "";
  }

  // Overrides
  const overrides = stored.providerOverrides || {};
  const currentOverrides = overrides[providerId] || {};
  overrideInput.value = currentOverrides.inputSelector || "";
  overrideSubmit.value = currentOverrides.submitSelector || "";

  // Presets
  renderPresets(stored.customPresets || [], stored.defaultPresetId || "concise");

  // General
  injectionDelay.value = stored.injectionDelay || 500;
  autoSubmit.checked = stored.autoSubmit !== false;
  charLimit.value = stored.charLimit || 10000;
}

function renderPresets(customPresets, defaultPresetId) {
  presetList.innerHTML = "";

  const allPresets = [...DEFAULT_PRESETS, ...customPresets];

  for (const preset of allPresets) {
    const item = document.createElement("div");
    item.className = "preset-item";

    const isDefault = preset.id === defaultPresetId;
    const isBuiltIn = DEFAULT_PRESETS.some(p => p.id === preset.id);

    item.innerHTML = `
      <input type="radio" name="default-preset" value="${preset.id}" ${isDefault ? "checked" : ""}>
      <span class="name">${preset.name}</span>
      <span class="instruction">${preset.instruction}</span>
      ${isBuiltIn ? "" : `<button class="danger delete-preset" data-id="${preset.id}">Delete</button>`}
    `;
    presetList.appendChild(item);
  }

  // Delete handlers
  presetList.querySelectorAll(".delete-preset").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const stored = await browser.storage.sync.get(["customPresets"]);
      const updated = (stored.customPresets || []).filter(p => p.id !== id);
      await browser.storage.sync.set({ customPresets: updated });
      const defaultStored = await browser.storage.sync.get(["defaultPresetId"]);
      renderPresets(updated, defaultStored.defaultPresetId || "concise");
    });
  });
}

// --- Event Listeners ---

providerRadios.forEach(radio => {
  radio.addEventListener("change", () => {
    customFields.classList.toggle("hidden", radio.value !== "custom");
  });
});

toggleOverrides.addEventListener("click", () => {
  overrideFields.classList.toggle("hidden");
});

document.getElementById("add-preset").addEventListener("click", async () => {
  const name = newPresetName.value.trim();
  const instruction = newPresetInstruction.value.trim();
  if (!name || !instruction) return;

  const id = "custom-" + Date.now();
  const stored = await browser.storage.sync.get(["customPresets", "defaultPresetId"]);
  const presets = stored.customPresets || [];
  presets.push({ id, name, instruction });
  await browser.storage.sync.set({ customPresets: presets });

  newPresetName.value = "";
  newPresetInstruction.value = "";
  renderPresets(presets, stored.defaultPresetId || "concise");
});

document.getElementById("test-custom").addEventListener("click", () => {
  const url = customUrl.value.trim();
  if (url) {
    browser.tabs.create({ url: url });
  }
});

document.getElementById("save-settings").addEventListener("click", async () => {
  const selectedProvider = document.querySelector('input[name="provider"]:checked').value;
  const selectedDefaultPreset = document.querySelector('input[name="default-preset"]:checked')?.value || "concise";

  const settings = {
    activeProviderId: selectedProvider,
    defaultPresetId: selectedDefaultPreset,
    injectionDelay: parseInt(injectionDelay.value, 10) || 500,
    autoSubmit: autoSubmit.checked,
    charLimit: parseInt(charLimit.value, 10) || 10000
  };

  // Custom provider
  if (selectedProvider === "custom") {
    settings.customProvider = {
      id: "custom",
      name: "Custom",
      url: customUrl.value.trim(),
      inputSelector: customInputSelector.value.trim(),
      submitSelector: customSubmitSelector.value.trim()
    };
  }

  // Selector overrides for built-in providers
  if (selectedProvider !== "custom") {
    const inputOverride = overrideInput.value.trim();
    const submitOverride = overrideSubmit.value.trim();
    if (inputOverride || submitOverride) {
      const stored = await browser.storage.sync.get(["providerOverrides"]);
      const overrides = stored.providerOverrides || {};
      overrides[selectedProvider] = {};
      if (inputOverride) overrides[selectedProvider].inputSelector = inputOverride;
      if (submitOverride) overrides[selectedProvider].submitSelector = submitOverride;
      settings.providerOverrides = overrides;
    }
  }

  await browser.storage.sync.set(settings);

  // Notify sidebar to reload provider
  browser.runtime.sendMessage({ type: "reload-provider" });

  saveStatus.classList.remove("hidden");
  setTimeout(() => saveStatus.classList.add("hidden"), 2000);
});

loadSettings();
```

**Step 3: Verify settings page loads**

Run: Load extension → right-click toolbar icon → "Manage Extension" → Preferences (or click Settings link in popup).
Expected: Settings page opens with all sections rendered, dropdowns populated.

**Step 4: Commit**

```bash
git add settings/settings.html settings/settings.js
git commit -m "feat: add settings page with provider config, presets, and general settings"
```

---

## Task 10: Icons & Polish

**Files:**
- Create: `icons/icon-48.png`
- Create: `icons/icon-96.png`

**Step 1: Generate placeholder icons**

Create simple SVG-based icons — a document with a sparkle/star symbol suggesting AI summarization. Convert to 48x48 and 96x96 PNGs.

For now, generate solid-color placeholder PNGs so the extension has visible icons.

**Step 2: Verify icons appear**

Run: Load extension → check toolbar and sidebar.
Expected: Icon appears in toolbar and sidebar panel list.

**Step 3: Commit**

```bash
git add icons/
git commit -m "feat: add extension icons"
```

---

## Task 11: End-to-End Integration Test

**Files:** No new files.

This task verifies the full pipeline works together.

**Step 1: Test page summarization**

1. Load extension in Firefox via `about:debugging`
2. Navigate to any article (e.g., a Wikipedia page)
3. Click toolbar icon → "Summarize This Page"
4. Expected: Sidebar opens with ChatGPT (or configured provider), prompt is auto-injected with the page URL, LLM generates summary

**Step 2: Test selection summarization**

1. Select text on any webpage
2. Right-click → "Summarize Selection"
3. Expected: Sidebar opens, selected text is injected as prompt, LLM summarizes

**Step 3: Test multi-tab summarization**

1. Open 3+ tabs with article pages
2. Click toolbar icon → "Summarize All Tabs"
3. Expected: Sidebar opens, prompt contains all tab URLs, LLM summarizes each

**Step 4: Test error scenarios**

1. Set provider to Custom with no URL → expected: error notification
2. Log out of ChatGPT → expected: "not logged in" notification
3. Try "Summarize Selection" with no text selected → expected: error notification

**Step 5: Test settings persistence**

1. Change provider to Claude in settings, save
2. Close and reopen Firefox
3. Click toolbar icon → provider should still be Claude

**Step 6: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

## Task 12: Final Cleanup & README

**Files:**
- Create: `README.md`

**Step 1: Write README.md**

Include: project description, features, installation instructions (load via `about:debugging`), usage guide for each feature, settings reference, known limitations (selector fragility, LLM browsing required for URL summarization).

**Step 2: Review all files for console.log cleanup, dead code, etc.**

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with installation and usage guide"
```
