# Article Extraction + File Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically extract article content from the user's browser using Readability.js and deliver it to the LLM as a file attachment instead of relying on URL browsing.

**Architecture:** When the user triggers "Summarize This Page" (or multi-tab), the extension injects Readability.js into the active tab(s) to extract clean article text. If extraction succeeds, the article is delivered as a `.txt` file upload to the LLM sidebar with a short prompt. If extraction or upload fails, the extension falls back to URL-only prompts (current behavior), then to pasting extracted text, then to clipboard copy.

**Tech Stack:** Mozilla Readability.js (article extraction), DataTransfer API (programmatic file upload), Firefox WebExtension Manifest V2 APIs

**Design doc:** `docs/plans/2026-02-20-article-extraction-design.md`

---

### Task 1: Bundle Readability.js library

**Files:**
- Create: `lib/readability.js`

**Step 1: Download Readability.js and isProbablyReaderable from Mozilla's GitHub**

The library is maintained at Mozilla's GitHub. We need two components: the `Readability` class and the `isProbablyReaderable` function. Since this is a no-build-step extension, we need a standalone JS file that defines both as globals (content scripts don't support ES modules).

Download from the Mozilla source (exact URL may need verification):
```sh
# Option A: From npm
npm pack @nicknisi/readability
# Extract and find Readability.js + isProbablyReaderable.js

# Option B: From GitHub raw
# Navigate to Mozilla's Readability.js repo and download Readability.js and isProbablyReaderable.js
```

**Step 2: Create the combined library file**

Create `lib/readability.js` that wraps both components for use as content script globals:

```js
/* eslint-disable */
/**
 * Mozilla Readability.js — extracted from Firefox Reader View.
 * Source: https://github.com/nicknisi/readability (verify actual URL)
 * License: Apache-2.0
 *
 * This file combines Readability and isProbablyReaderable into a single
 * file for injection via tabs.executeScript(). Both are exposed as globals.
 */

// --- isProbablyReaderable ---
// [paste isProbablyReaderable.js source here]

// --- Readability ---
// [paste Readability.js source here]
```

The key requirement: after this file is injected via `tabs.executeScript()`, both `Readability` and `isProbablyReaderable` must be available as globals in the content script world.

**Step 3: Verify it loads without errors**

Open the Firefox console and run:
```
typeof Readability === 'function'  // should be true
typeof isProbablyReaderable === 'function'  // should be true
```

**Step 4: Commit**

```sh
git add lib/readability.js
git commit -m "chore: bundle Mozilla Readability.js library for article extraction"
```

---

### Task 2: Add article prompt builder functions + tests

**Files:**
- Modify: `lib/prompt-builder.js:33-71` (add new functions after existing ones)
- Modify: `test/prompt-builder.test.html` (add new tests)

**Step 1: Write failing tests**

Add to `test/prompt-builder.test.html`, inside `runTests()` after the existing tests:

```js
// Test 8: buildArticlePrompt
const articlePrompt = buildArticlePrompt("Provide a brief 2-3 sentence summary.");
log("\nTest 8 - Article prompt (for file upload):");
log(articlePrompt);
log(articlePrompt.includes("Summarize the attached article") ? "PASS" : "FAIL");
log(articlePrompt.includes("Provide a brief 2-3 sentence summary.") ? "PASS" : "FAIL");

// Test 9: buildArticleFileContent - single article
const singleFile = buildArticleFileContent([
  { title: "Test Article", byline: "Jane Doe", url: "https://example.com/article", textContent: "This is the article body." }
]);
log("\nTest 9 - Single article file:");
log(singleFile.substring(0, 200));
log(singleFile.includes("Source: https://example.com/article") ? "PASS" : "FAIL");
log(singleFile.includes("Title: Test Article") ? "PASS" : "FAIL");
log(singleFile.includes("Author: Jane Doe") ? "PASS" : "FAIL");
log(singleFile.includes("This is the article body.") ? "PASS" : "FAIL");
log(!singleFile.includes("=== Article") ? "PASS: no multi-article header" : "FAIL");

// Test 10: buildArticleFileContent - multiple articles
const multiFile = buildArticleFileContent([
  { title: "First", byline: "Author A", url: "https://a.com", textContent: "Body A." },
  { title: "Second", byline: null, url: "https://b.com", textContent: "Body B." },
  { title: null, byline: null, url: "https://c.com", textContent: null, extractionFailed: true }
]);
log("\nTest 10 - Multi-article file:");
log(multiFile.substring(0, 400));
log(multiFile.includes("=== Article 1 of 3 ===") ? "PASS" : "FAIL");
log(multiFile.includes("=== Article 2 of 3 ===") ? "PASS" : "FAIL");
log(multiFile.includes("=== Article 3 of 3 ===") ? "PASS" : "FAIL");
log(multiFile.includes("Body A.") ? "PASS" : "FAIL");
log(multiFile.includes("Body B.") ? "PASS" : "FAIL");
log(multiFile.includes("Could not extract") ? "PASS: failed extraction noted" : "FAIL");
log(!multiFile.includes("Author:") || multiFile.includes("Author: Author A") ? "PASS: byline handled" : "FAIL");

// Test 11: buildArticleFileContent - no byline omits Author line
const noBylFile = buildArticleFileContent([
  { title: "No Author", byline: null, url: "https://x.com", textContent: "Content." }
]);
log("\nTest 11 - No byline:");
log(!noBylFile.includes("Author:") ? "PASS" : "FAIL");
```

**Step 2: Open test file in browser, verify tests FAIL**

Open `test/prompt-builder.test.html` in Firefox. Tests 8-11 should show FAIL (functions don't exist yet).

**Step 3: Implement buildArticlePrompt and buildArticleFileContent**

Add to `lib/prompt-builder.js` after the existing `buildSelectionPrompt` function (after line 71):

```js
/**
 * Build a short prompt for article file upload.
 * Used when article content is delivered as a file attachment.
 */
function buildArticlePrompt(presetInstruction) {
  return `Summarize the attached article.

${presetInstruction}`;
}

/**
 * Build structured text file content from extracted articles.
 * articles: Array of { title, byline, url, textContent, extractionFailed? }
 */
function buildArticleFileContent(articles) {
  if (articles.length === 1) {
    return formatSingleArticle(articles[0]);
  }
  return articles
    .map((a, i) => `=== Article ${i + 1} of ${articles.length} ===\n${formatSingleArticle(a)}`)
    .join("\n\n");
}

function formatSingleArticle(article) {
  if (article.extractionFailed) {
    return `Source: ${article.url}\n(Could not extract article content — URL provided for reference)`;
  }
  const lines = [`Source: ${article.url}`];
  if (article.title) lines.push(`Title: ${article.title}`);
  if (article.byline) lines.push(`Author: ${article.byline}`);
  lines.push("", article.textContent);
  return lines.join("\n");
}
```

**Step 4: Open test file, verify all tests PASS**

Open `test/prompt-builder.test.html` in Firefox. All tests (1-11) should show PASS.

**Step 5: Commit**

```sh
git add lib/prompt-builder.js test/prompt-builder.test.html
git commit -m "feat: add article prompt builder functions for file upload path"
```

---

### Task 3: Add fileInputSelector to provider configs + tests

**Files:**
- Modify: `providers/providers.js:1-24` (add fileInputSelector to configs)
- Modify: `test/providers.test.html` (add tests)

**Step 1: Write failing tests**

Add to `test/providers.test.html`, inside `runTests()` after existing tests:

```js
// Test 6: Default providers include fileInputSelector
await setActiveProvider("chatgpt");
result = await getActiveProvider();
log("\nTest 6 - ChatGPT has fileInputSelector:");
log(result.provider.fileInputSelector ? "PASS" : "FAIL");

await setActiveProvider("claude");
result = await getActiveProvider();
log("\nTest 7 - Claude has fileInputSelector:");
log(result.provider.fileInputSelector ? "PASS" : "FAIL");

// Test 8: Custom provider template includes fileInputSelector field
await setActiveProvider("custom");
browser.storage.sync._data.customProvider = {
  url: "http://localhost:8080",
  inputSelector: "textarea",
  submitSelector: "button",
  fileInputSelector: "input[type=file]"
};
result = await getActiveProvider();
log("\nTest 8 - Custom provider fileInputSelector:");
log(result.provider.fileInputSelector === "input[type=file]" ? "PASS" : "FAIL");
```

**Step 2: Open test file in browser, verify tests FAIL**

Open `test/providers.test.html` in Firefox. Tests 6-8 should show FAIL.

**Step 3: Add fileInputSelector to provider configs**

In `providers/providers.js`, update `DEFAULT_PROVIDERS` (lines 1-16):

```js
const DEFAULT_PROVIDERS = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chat.openai.com",
    inputSelector: "#prompt-textarea",
    submitSelector: "button[data-testid='send-button']",
    fileInputSelector: "input[type='file']"
  },
  claude: {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/new",
    inputSelector: "div.ProseMirror[contenteditable='true']",
    submitSelector: "button[aria-label='Send Message']",
    fileInputSelector: "input[type='file']"
  }
};

const CUSTOM_PROVIDER_TEMPLATE = {
  id: "custom",
  name: "Custom",
  url: "",
  inputSelector: "",
  submitSelector: "",
  fileInputSelector: ""
};
```

**Step 4: Open test file, verify all tests PASS**

Open `test/providers.test.html` in Firefox. All tests (1-8) should show PASS.

**Step 5: Commit**

```sh
git add providers/providers.js test/providers.test.html
git commit -m "feat: add fileInputSelector to provider configs"
```

---

### Task 4: Create article extractor content script

**Files:**
- Create: `content/article-extractor.js`

This script is injected via `tabs.executeScript()` into the active tab after `lib/readability.js` has been injected. It uses the `Readability` and `isProbablyReaderable` globals set up by the library.

**Step 1: Create the extractor script**

```js
/**
 * Article extractor content script.
 * Injected into the user's active page (after lib/readability.js) to extract
 * article content using Mozilla's Readability.js.
 *
 * This is a one-shot script: it runs, returns a result via the executeScript
 * return value, and doesn't register any listeners.
 *
 * Return value (consumed by background.js):
 *   Success: { title, byline, url, textContent }
 *   Failure: { extractionFailed: true, reason: "not-readable" | "insufficient-content" | "error", url }
 */
(function () {
  const url = window.location.href;

  if (typeof isProbablyReaderable !== "function" || typeof Readability !== "function") {
    return { extractionFailed: true, reason: "error", url };
  }

  if (!isProbablyReaderable(document)) {
    return { extractionFailed: true, reason: "not-readable", url };
  }

  try {
    const clone = document.cloneNode(true);
    const article = new Readability(clone).parse();

    if (!article || !article.textContent || article.textContent.trim().length < 100) {
      return { extractionFailed: true, reason: "insufficient-content", url };
    }

    return {
      title: article.title || null,
      byline: article.byline || null,
      textContent: article.textContent.trim(),
      url: url
    };
  } catch (e) {
    return { extractionFailed: true, reason: "error", url };
  }
})();
```

**Important notes for the implementer:**
- This script is NOT a content script registered in manifest.json. It's injected on-demand via `tabs.executeScript()`.
- It relies on `Readability` and `isProbablyReaderable` being injected first via a separate `tabs.executeScript({ file: "lib/readability.js" })` call.
- If the two scripts don't share globals (scope isolation), fall back to inlining Readability.js source directly in this file.
- The IIFE pattern ensures the return value is captured by `executeScript`.

**Step 2: Commit**

```sh
git add content/article-extractor.js
git commit -m "feat: add article extractor content script using Readability.js"
```

---

### Task 5: Update background.js — extraction + prompt data pipeline

**Files:**
- Modify: `background.js:83-141` (handleSummarizePage, handleSummarizeTabs, handleSummarizeSelection)
- Modify: `background.js:165-211` (injectPrompt)

This is the largest change. The handlers now extract article content before building prompts, and `injectPrompt` passes file data to the injector.

**Step 1: Add extractArticle helper function**

Add after the `// --- Helpers ---` section (after line 213):

```js
/**
 * Extract article content from a tab using Readability.js.
 * Returns { title, byline, url, textContent } on success,
 * or { extractionFailed: true, reason, url } on failure.
 */
async function extractArticle(tabId) {
  try {
    await browser.tabs.executeScript(tabId, { file: "lib/readability.js" });
    const results = await browser.tabs.executeScript(tabId, { file: "content/article-extractor.js" });
    return results[0] || { extractionFailed: true, reason: "error", url: "" };
  } catch (e) {
    return { extractionFailed: true, reason: "error", url: "" };
  }
}
```

**Step 2: Update handleSummarizePage**

Replace lines 83-93:

```js
async function handleSummarizePage({ fromUserGesture = false, newChat = false } = {}) {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    notify("No active page found.");
    return;
  }

  const preset = await getDefaultPreset();
  const article = await extractArticle(tab.id);

  if (article.extractionFailed) {
    // Extraction failed — fall back to URL-only prompt (current behavior)
    const prompt = buildPagePrompt(tab.url, preset.instruction);
    await injectPrompt(prompt, { fromUserGesture, newChat });
    return;
  }

  // Extraction succeeded — deliver as file upload
  const fileContent = buildArticleFileContent([article]);
  const prompt = buildArticlePrompt(preset.instruction);
  const urlFallback = buildPagePrompt(tab.url, preset.instruction);
  const textFallback = buildSelectionPrompt(article.textContent, preset.instruction);

  await injectPrompt(prompt, {
    fromUserGesture,
    newChat,
    articleFile: { name: "article.txt", content: fileContent },
    urlFallback,
    textFallback
  });
}
```

**Step 3: Update handleSummarizeTabs**

Replace lines 95-112:

```js
async function handleSummarizeTabs({ fromUserGesture = false, newChat = false } = {}) {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const summarizableTabs = tabs.filter(t =>
    t.url &&
    !t.url.startsWith("about:") &&
    !t.url.startsWith("moz-extension:")
  );

  if (summarizableTabs.length === 0) {
    notify("No summarizable tabs found. Open some pages and try again.");
    return;
  }

  const preset = await getDefaultPreset();

  // Extract articles from all tabs in parallel
  const articles = await Promise.all(
    summarizableTabs.map(async (t) => {
      const article = await extractArticle(t.id);
      if (article.extractionFailed) {
        return { ...article, url: t.url, title: t.title || t.url };
      }
      return article;
    })
  );

  const anyExtracted = articles.some(a => !a.extractionFailed);
  const tabData = summarizableTabs.map(t => ({ title: t.title || t.url, url: t.url }));
  const urlFallback = buildTabsPrompt(tabData, preset.instruction);

  if (!anyExtracted) {
    // No articles extracted — fall back to URL-only for all
    await injectPrompt(urlFallback, { fromUserGesture, newChat });
    return;
  }

  const fileContent = buildArticleFileContent(articles);
  const prompt = buildArticlePrompt(preset.instruction);

  await injectPrompt(prompt, {
    fromUserGesture,
    newChat,
    articleFile: { name: "articles.txt", content: fileContent },
    urlFallback
  });
}
```

**Step 4: Update injectPrompt to accept and pass file data**

Replace lines 183-211:

```js
/**
 * Deliver a prompt to the injector content script.
 *
 * Options:
 *   fromUserGesture — caller already opened the sidebar
 *   newChat — reload sidebar for a fresh conversation
 *   articleFile — { name, content } for file upload (optional)
 *   urlFallback — prompt to use if file upload fails (optional)
 *   textFallback — prompt to use if URL injection also fails (optional)
 */
async function injectPrompt(prompt, { fromUserGesture = false, newChat = false, articleFile = null, urlFallback = null, textFallback = null } = {}) {
  const { provider, error } = await getActiveProvider();

  if (error) {
    notify(error);
    return;
  }

  const data = { prompt, provider, articleFile, urlFallback, textFallback };

  // Hold in memory for the injector-ready handshake (new page loads)
  pendingPromptData = data;

  // Write to storage for the storage.onChanged path (sidebar already open)
  await browser.storage.local.set({ pendingPrompt: data });

  if (newChat) {
    const separator = provider.url.includes("?") ? "&" : "?";
    const freshUrl = provider.url + separator + "_t=" + Date.now();
    await browser.sidebarAction.setPanel({ panel: freshUrl });
  }

  if (!fromUserGesture) {
    notify("Prompt ready — open the sidebar to see the summary.");
  }
}
```

**Step 5: Commit**

```sh
git add background.js
git commit -m "feat: integrate article extraction into summarize handlers"
```

---

### Task 6: Update injector.js — file upload + fallback chain

**Files:**
- Modify: `content/injector.js:84-140` (doInject function)

**Step 1: Add tryFileUpload helper**

Add before the `doInject` function (around line 83):

```js
/**
 * Attempt to upload a file to the LLM via the provider's file input element.
 * Returns true if upload succeeded, false if it failed.
 */
async function tryFileUpload(provider, articleFile) {
  if (!provider.fileInputSelector) return false;

  const fileInput = document.querySelector(provider.fileInputSelector);
  if (!fileInput) return false;

  try {
    const file = new File([articleFile.content], articleFile.name, { type: "text/plain" });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Wait briefly for the UI to process the file
    await sleep(500);
    return true;
  } catch (e) {
    return false;
  }
}
```

**Step 2: Update doInject with fallback chain**

Replace the doInject function (lines 84-140):

```js
async function doInject(prompt, provider, articleFile, urlFallback, textFallback) {
  try {
    const input = await waitForElement(provider.inputSelector, 10000);
    if (!input) {
      throw new Error("input-not-found");
    }

    if (isLoginPage()) {
      browser.runtime.sendMessage({
        type: "injection-error",
        error: "not-logged-in",
        providerName: provider.name
      });
      return;
    }

    // Determine which prompt to use based on file upload success
    let promptToUse = prompt;

    if (articleFile) {
      const uploaded = await tryFileUpload(provider, articleFile);
      if (!uploaded && urlFallback) {
        promptToUse = urlFallback;
      } else if (!uploaded && textFallback) {
        promptToUse = textFallback;
      }
    }

    await setInputValue(input, promptToUse);

    // Wait for the configured injection delay
    const settings = await browser.storage.sync.get(["injectionDelay", "autoSubmit"]);
    const delay = settings.injectionDelay || 500;
    const autoSubmit = settings.autoSubmit !== false;

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
    // Fallback: try textFallback prompt before clipboard
    if (textFallback && err.message === "input-not-found") {
      // Can't inject at all — skip to clipboard
    }

    // Last resort: copy to clipboard
    const clipboardText = textFallback || urlFallback || prompt;
    try {
      await navigator.clipboard.writeText(clipboardText);
    } catch (_) {
      // clipboard may not be available
    }

    browser.runtime.sendMessage({
      type: "injection-error",
      error: err.message || "unknown",
      providerName: provider.name
    });
  }
}
```

**Step 3: Update all callers of doInject to pass new parameters**

The function signature changed from `doInject(prompt, provider)` to `doInject(prompt, provider, articleFile, urlFallback, textFallback)`. Update all call sites:

In `consumePendingPrompt` (around line 30):
```js
// Old:
await doInject(prompt, provider);
// New:
const { prompt, provider, articleFile, urlFallback, textFallback } = stored.pendingPrompt;
await doInject(prompt, provider, articleFile || null, urlFallback || null, textFallback || null);
```

In `checkPendingPrompt` (around line 50-65):
```js
// Where data comes from injector-ready handshake:
if (data && data.prompt) {
  await doInject(data.prompt, data.provider, data.articleFile || null, data.urlFallback || null, data.textFallback || null);
  return;
}
// Where data comes from storage fallback:
if (stored.pendingPrompt) {
  const { prompt, provider, articleFile, urlFallback, textFallback } = stored.pendingPrompt;
  await browser.storage.local.remove("pendingPrompt");
  await doInject(prompt, provider, articleFile || null, urlFallback || null, textFallback || null);
}
```

In the `do-inject` message listener (around line 80):
```js
browser.runtime.onMessage.addListener((message) => {
  if (message.type !== "do-inject") return;
  return doInject(message.prompt, message.provider, message.articleFile || null, message.urlFallback || null, message.textFallback || null);
});
```

**Step 4: Commit**

```sh
git add content/injector.js
git commit -m "feat: add file upload + fallback chain to injector"
```

---

### Task 7: Update settings UI for fileInputSelector

**Files:**
- Modify: `settings/settings.html:75-83` (custom provider fields)
- Modify: `settings/settings.html:86-91` (override fields)
- Modify: `settings/settings.js:1-17` (DOM elements)
- Modify: `settings/settings.js:39-43` (loadSettings custom provider)
- Modify: `settings/settings.js:46-49` (loadSettings overrides)
- Modify: `settings/settings.js:149-193` (save handler)

**Step 1: Add fileInputSelector fields to settings HTML**

In `settings/settings.html`, after the custom submit selector field (after line 81), add:

```html
    <label for="custom-file-input-selector">File Input CSS Selector (optional)</label>
    <input type="text" id="custom-file-input-selector" placeholder="input[type=file]">
```

In the override fields section (after line 90), add:

```html
    <label for="override-file-input">File Input Selector Override</label>
    <input type="text" id="override-file-input" placeholder="Leave blank to use default">
```

**Step 2: Add DOM element references in settings.js**

Add to the DOM elements section (after line 10):

```js
const customFileInputSelector = document.getElementById("custom-file-input-selector");
const overrideFileInput = document.getElementById("override-file-input");
```

**Step 3: Update loadSettings to populate file input selector fields**

In loadSettings, after `customSubmitSelector.value` (around line 42), add:

```js
customFileInputSelector.value = stored.customProvider.fileInputSelector || "";
```

In loadSettings, after `overrideSubmit.value` (around line 49), add:

```js
overrideFileInput.value = currentOverrides.fileInputSelector || "";
```

**Step 4: Update save handler to include fileInputSelector**

In the save handler, inside the custom provider block (around line 168), add `fileInputSelector`:

```js
settings.customProvider = {
  id: "custom",
  name: "Custom",
  url: customUrl.value.trim(),
  inputSelector: customInputSelector.value.trim(),
  submitSelector: customSubmitSelector.value.trim(),
  fileInputSelector: customFileInputSelector.value.trim()
};
```

In the override block (around line 176-183), add file input override:

```js
const fileInputOverride = overrideFileInput.value.trim();
if (inputOverride || submitOverride || fileInputOverride) {
  // ... existing override code ...
  if (fileInputOverride) overrides[selectedProvider].fileInputSelector = fileInputOverride;
```

**Step 5: Commit**

```sh
git add settings/settings.html settings/settings.js
git commit -m "feat: add fileInputSelector to settings UI"
```

---

### Task 8: Manual integration testing

**No files changed in this task — this is manual testing.**

**Test matrix:**

| Test | Steps | Expected |
|------|-------|----------|
| Single article page | Open a news article in a tab. Click "Summarize This Page" in popup. | Sidebar opens, article.txt appears as attachment, short prompt is injected, LLM summarizes. |
| Non-article page | Open a web app (Gmail, GitHub dashboard). Click "Summarize This Page." | Readability detection fails → falls back to URL-only prompt (current behavior). |
| Multi-tab | Open 3+ tabs (mix of articles and non-articles). Click "Summarize All Tabs." | articles.txt file with extracted content for article tabs and "(Could not extract)" for non-article tabs. |
| File upload fallback | Temporarily break the fileInputSelector (set it to "div.nonexistent"). Summarize an article. | File upload fails → falls back to URL-only prompt. |
| Selection unchanged | Select text on a page. Right-click → "Summarize Selection." | Same as before — pasted text, no file upload. No regression. |
| Custom provider | Set up a custom provider with a fileInputSelector. Summarize a page. | File upload attempted using the custom selector. |
| Settings roundtrip | Open settings. Set fileInputSelector override. Save. Reload settings page. | Override value persists. |

**Debugging tips:**
- Check the background script console (`about:debugging` → this extension → Inspect) for extraction results
- Check the sidebar console for file upload errors
- If `executeScript` for Readability.js fails, the `extractArticle` function catches the error and returns `extractionFailed: true`
- If globals from `lib/readability.js` aren't visible in `content/article-extractor.js`, inline the library source into article-extractor.js

---

### Task 9: Update CLAUDE.md with new architecture details

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the architecture flow diagram**

Add the extraction path to the flow diagram in CLAUDE.md. Update the file map to include new files. Add new storage keys if any. Update the "Quick Reference" table.

**Step 2: Commit**

```sh
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with article extraction architecture"
```
