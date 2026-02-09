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
      return handleSummarizePage({ fromUserGesture: true });
    case "summarize-tabs":
      return handleSummarizeTabs({ fromUserGesture: true });
    case "summarize-selection-from-popup": {
      return getActiveTab().then(tab => handleSummarizeSelection(tab));
    }
    case "injection-error":
      // Don't clear pendingPromptData — the error may be from a dying injector
      // during a newChat reload. The new injector still needs the prompt.
      return handleInjectionError(message);
    case "injection-success":
      pendingPromptData = null;
      return;
    case "injector-ready": {
      // Handshake: injector loaded and is asking for a pending prompt.
      // Return from memory first (most reliable), fall back to storage.
      const data = pendingPromptData;
      if (data) {
        pendingPromptData = null;
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

  const preset = await getDefaultPreset();
  const prompt = buildPagePrompt(tab.url, preset.instruction);
  await injectPrompt(prompt, { fromUserGesture, newChat });
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

  const tabData = summarizableTabs.map(t => ({ title: t.title || t.url, url: t.url }));
  const preset = await getDefaultPreset();
  const prompt = buildTabsPrompt(tabData, preset.instruction);
  await injectPrompt(prompt, { fromUserGesture, newChat });
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

    const settings = await browser.storage.sync.get(["charLimit"]);
    const charLimit = settings.charLimit || 10000;

    const preset = await getDefaultPreset();
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
async function loadSidebarProvider() {
  const { provider, error } = await getActiveProvider();

  if (error) {
    // Reset to fallback page
    await browser.sidebarAction.setPanel({ panel: "sidebar/sidebar.html" });
    return;
  }

  await browser.sidebarAction.setPanel({ panel: provider.url });
}

// Initialize sidebar panel on startup
loadSidebarProvider();

// --- Injection Pipeline ---

// Hold the pending prompt in memory so the injector can request it directly
// via the "injector-ready" handshake, avoiding storage timing races.
let pendingPromptData = null;

/**
 * Deliver a prompt to the injector content script.
 *
 * Prompt is always stored in both memory and storage. Delivery paths:
 *   1. newChat — also calls setPanel() to reload the sidebar for a fresh
 *      conversation. The new injector picks up the prompt via "injector-ready"
 *      handshake (memory). If setPanel() doesn't reload, the running injector
 *      picks it up via storage.onChanged.
 *   2. Sidebar opening (first open) — injector sends "injector-ready", gets
 *      the prompt from memory (or storage fallback).
 *   3. Sidebar already open — storage.onChanged fires in the running injector.
 */
async function injectPrompt(prompt, { fromUserGesture = false, newChat = false } = {}) {
  const { provider, error } = await getActiveProvider();

  if (error) {
    notify(error);
    return;
  }

  // Hold in memory for the injector-ready handshake (new page loads)
  pendingPromptData = { prompt, provider };

  // Write to storage for the storage.onChanged path (sidebar already open)
  await browser.storage.local.set({
    pendingPrompt: { prompt, provider }
  });

  if (newChat) {
    // Force a fresh chat by reloading the sidebar panel. Append a cache-bust
    // parameter so Firefox treats it as a new URL even if the provider URL
    // was already set — setPanel() with the same URL doesn't trigger a reload.
    const separator = provider.url.includes("?") ? "&" : "?";
    const freshUrl = provider.url + separator + "_t=" + Date.now();
    await browser.sidebarAction.setPanel({ panel: freshUrl });
  }

  if (!fromUserGesture) {
    notify("Prompt ready — open the sidebar to see the summary.");
  }
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