/**
 * Background script — orchestrates the extension.
 * Registers context menus, handles messages from popup/sidebar/injector,
 * builds prompts, and triggers sidebar injection.
 */

// --- Context Menu Setup ---

browser.contextMenus.create({
  id: "summarize-page",
  title: "Summarize This Page",
  contexts: ["page"]
});

browser.contextMenus.create({
  id: "summarize-tabs",
  title: "Summarize All Tabs",
  contexts: ["page"]
});

browser.contextMenus.create({
  id: "summarize-selection",
  title: "Summarize Selection",
  contexts: ["selection"]
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  // Open sidebar BEFORE any await — context menu clicks are valid user gestures
  // for sidebarAction.open(), but the first await breaks the gesture context.
  browser.sidebarAction.open();

  if (info.menuItemId === "summarize-page") {
    await handleSummarizePage({ newChat: true });
  } else if (info.menuItemId === "summarize-tabs") {
    await handleSummarizeTabs({ newChat: true });
  } else if (info.menuItemId === "summarize-selection") {
    await handleSummarizeSelection(tab, { newChat: true });
  }
});

// --- Message Handling (from popup, sidebar, injector) ---

browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case "summarize-page":
      return handleSummarizePage({ fromUserGesture: true, newChat: true });
    case "summarize-tabs":
      return handleSummarizeTabs({ fromUserGesture: true, newChat: true });
    case "summarize-selection-from-popup": {
      return getActiveTab().then(tab => handleSummarizeSelection(tab, { newChat: true }));
    }
    case "injection-error":
      // Don't clear pendingPromptData — the error may be from a dying injector
      // during a newChat reload. The new injector still needs the prompt.
      return handleInjectionError(message);
    case "injection-success":
      setPendingPromptData(null);
      return;
    case "injector-ready": {
      // Handshake: injector loaded and is asking for a pending prompt.
      // Return from memory first (most reliable), fall back to storage.
      const data = pendingPromptData;
      if (data) {
        setPendingPromptData(null);
        browser.storage.local.remove("pendingPrompt");
        return Promise.resolve(data);
      }
      return browser.storage.local.get(["pendingPrompt"]).then(stored => {
        if (stored.pendingPrompt) {
          browser.storage.local.remove("pendingPrompt");
          return stored.pendingPrompt;
        }
        return null;
      });
    }
    case "reload-provider":
      return loadSidebarProvider();
  }
});

// --- Feature Handlers ---

async function handleSummarizePage({ fromUserGesture = false, newChat = false } = {}) {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    notify("No active page found.");
    return;
  }

  // Independent reads — run in parallel to save a storage round-trip.
  const [preset, article] = await Promise.all([
    getDefaultPreset(),
    extractArticle(tab.id)
  ]);

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

  // Extract articles in small batches. Each extraction injects Readability
  // and clones the tab's full DOM (article-extractor.js), so extracting every
  // tab at once spikes CPU and memory across all content processes when many
  // tabs are open. The preset read runs alongside the first batch.
  const [preset, articles] = await Promise.all([
    getDefaultPreset(),
    mapWithConcurrency(summarizableTabs, 4, async (t) => {
      const article = await extractArticle(t.id);
      if (article.extractionFailed) {
        return { ...article, url: t.url, title: t.title || t.url };
      }
      return article;
    })
  ]);

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

async function handleSummarizeSelection(tab, { newChat = false } = {}) {
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

    const [settings, preset] = await Promise.all([
      browser.storage.sync.get(["charLimit"]),
      getDefaultPreset()
    ]);
    const charLimit = settings.charLimit || 10000;
    const prompt = buildSelectionPrompt(results.text, preset.instruction, charLimit);
    await injectPrompt(prompt, { newChat });

  } catch (err) {
    notify("Could not read the selected text. Try selecting the text again.");
  }
}

// --- Sidebar Provider Management ---

/**
 * Set the sidebar panel URL to the active provider's URL.
 * The injector content script (registered in manifest.json) will auto-load
 * on matching provider domains.
 */
/**
 * Append the `_t` marker to a provider URL for setPanel().
 * `_t` serves double duty: a cache-bust (setPanel with the same URL is a
 * no-op) AND the sidebar marker the injector keys on — injector copies loaded
 * in regular browsing tabs (no `_t`) stay inert so they can't steal a prompt
 * meant for the sidebar. EVERY setPanel() call with a provider URL must go
 * through this helper.
 */
function withSidebarMarker(url, token) {
  const separator = url.includes("?") ? "&" : "?";
  return url + separator + "_t=" + token;
}

async function loadSidebarProvider() {
  const { provider, error } = await getActiveProvider();

  if (error) {
    // Reset to fallback page
    await browser.sidebarAction.setPanel({ panel: "sidebar/sidebar.html" });
    return;
  }

  // Constant token: this path shouldn't force a reload when nothing changed,
  // but the URL still needs the `_t` sidebar marker for the injector.
  await browser.sidebarAction.setPanel({ panel: withSidebarMarker(provider.url, "0") });
}

// Initialize sidebar panel on startup
loadSidebarProvider();

// --- Injection Pipeline ---

// Hold the pending prompt in memory so the injector can request it directly
// via the "injector-ready" handshake, avoiding storage timing races.
let pendingPromptData = null;
let pendingPromptTimer = null;

// The handshake completes within seconds. If no injector ever picks the
// prompt up (sidebar closed mid-flight, injection failed and was deliberately
// not cleared), don't pin the article payload — potentially megabytes — in
// the persistent background page indefinitely, nor leave it orphaned on disk.
const PENDING_PROMPT_TTL_MS = 60000;

function setPendingPromptData(data) {
  pendingPromptData = data;
  clearTimeout(pendingPromptTimer);
  pendingPromptTimer = null;
  if (data) {
    pendingPromptTimer = setTimeout(() => {
      pendingPromptData = null;
      browser.storage.local.remove("pendingPrompt");
    }, PENDING_PROMPT_TTL_MS);
  }
}

// Any pendingPrompt left in storage from a previous browser session is stale.
browser.storage.local.remove("pendingPrompt");

/**
 * Deliver a prompt to the injector content script.
 *
 * The prompt is always held in memory (pendingPromptData) for the
 * "injector-ready" handshake. Delivery paths:
 *   1. newChat — calls setPanel() with a cache-bust to reload the sidebar for a
 *      fresh conversation. The freshly-loaded injector picks up the prompt from
 *      memory via the "injector-ready" handshake. Storage is intentionally NOT
 *      written here: a storage write fires storage.onChanged in the OUTGOING
 *      injector (when the sidebar was already open), which would consume the
 *      prompt and inject it into the page being reloaded away — losing it. The
 *      cache-bust guarantees the reload, so the memory handshake is reliable.
 *   2. Sidebar already open, no reload (newChat=false) — the prompt is written
 *      to storage.local so storage.onChanged delivers it to the running
 *      injector (also covers a first open: the injector's "injector-ready"
 *      handshake reads memory, with a storage fallback).
 */
async function injectPrompt(prompt, { fromUserGesture = false, newChat = false, articleFile = null, urlFallback = null, textFallback = null } = {}) {
  const { provider, error } = await getActiveProvider();

  if (error) {
    notify(error);
    return;
  }

  const data = { prompt, provider, articleFile, urlFallback, textFallback };

  // Hold in memory for the injector-ready handshake (new page loads).
  // Auto-expires after PENDING_PROMPT_TTL_MS if never consumed.
  setPendingPromptData(data);

  if (newChat) {
    // Force a fresh chat by reloading the sidebar panel. Append a cache-bust
    // parameter so Firefox treats it as a new URL even if the provider URL
    // was already set — setPanel() with the same URL doesn't trigger a reload.
    // The freshly-loaded injector picks up the prompt from memory via the
    // "injector-ready" handshake.
    //
    // Deliberately do NOT write storage.local here. A storage write fires
    // storage.onChanged in the OUTGOING injector (when the sidebar was already
    // open), which would consume the prompt and inject it into the page we're
    // about to reload away — so the prompt vanishes in the navigation and the
    // fresh chat gets nothing.
    const freshUrl = withSidebarMarker(provider.url, Date.now());
    await browser.sidebarAction.setPanel({ panel: freshUrl });
  } else {
    // Sidebar already open with no reload — deliver to the running injector
    // via storage.onChanged.
    await browser.storage.local.set({ pendingPrompt: data });
  }

  if (!fromUserGesture) {
    notify("Prompt ready — open the sidebar to see the summary.");
  }
}

// --- Article Extraction ---

/**
 * Extract article content from a tab using Readability.js.
 * Returns { title, byline, url, textContent } on success,
 * or { extractionFailed: true, reason, url } on failure.
 */
async function extractArticle(tabId) {
  try {
    // Readability is ~85KB and executeScript re-parses and re-evaluates it on
    // every call. Probe for its sentinel globals first and only inject the
    // library when the tab doesn't already have it (repeat summarizes).
    const [hasLib] = await browser.tabs.executeScript(tabId, {
      code: "typeof Readability === 'function' && typeof isProbablyReaderable === 'function'"
    });
    if (!hasLib) {
      await browser.tabs.executeScript(tabId, { file: "lib/readability.js" });
    }
    const results = await browser.tabs.executeScript(tabId, { file: "content/article-extractor.js" });
    return results[0] || { extractionFailed: true, reason: "error", url: "" };
  } catch (e) {
    return { extractionFailed: true, reason: "error", url: "" };
  }
}

// --- Helpers ---

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

/**
 * Map `fn` over `items` with at most `limit` calls in flight at once.
 * Preserves order; a rejected fn rejects the whole map (callers wrap fn
 * bodies that must not throw, e.g. extractArticle already catches).
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
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

// --- Update Badge ---

// Show a badge on the toolbar icon when a newer release is available, so the
// user learns about updates without opening the popup. The check reuses the
// shared 15-min cache (lib/update-check.js), so background polls and popup
// opens share one API request. MV2 background pages are persistent in
// Firefox, so a plain setInterval is reliable here.
const UPDATE_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

function setUpdateBadge(updateAvailable) {
  browser.browserAction.setBadgeText({ text: updateAvailable ? "NEW" : "" });
  if (updateAvailable) {
    browser.browserAction.setBadgeBackgroundColor({ color: "#0060df" });
  }
}

async function refreshUpdateBadge() {
  try {
    const latestVersion = await getLatestVersion();
    setUpdateBadge(latestVersion !== browser.runtime.getManifest().version);
  } catch (_) {
    // Offline or rate-limited — keep the current badge state rather than
    // flickering it off; the next poll or popup open will correct it.
  }
}

refreshUpdateBadge();
setInterval(refreshUpdateBadge, UPDATE_POLL_INTERVAL_MS);

// The popup's own check writes the shared cache; react to that write so the
// badge updates the moment the popup learns of a new release (and clears
// right after an update installs and versions match again).
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.updateCheck && changes.updateCheck.newValue) {
    setUpdateBadge(
      changes.updateCheck.newValue.latestVersion !== browser.runtime.getManifest().version
    );
  }
});

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