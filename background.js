/**
 * Background script — orchestrates the extension.
 * Registers context menus, handles messages from popup/sidebar/injector,
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

browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case "summarize-page":
      return handleSummarizePage();
    case "summarize-tabs":
      return handleSummarizeTabs();
    case "summarize-selection-from-popup": {
      return getActiveTab().then(tab => handleSummarizeSelection(tab));
    }
    case "injection-error":
      return handleInjectionError(message);
    case "injection-success":
      // No action needed — LLM is generating the summary in the sidebar
      return;
    case "reload-provider":
      return loadSidebarProvider();
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

/**
 * Store the prompt and open the sidebar. The injector content script
 * (running inside the LLM page loaded as the sidebar panel) picks up
 * the pending prompt from storage and injects it.
 */
async function injectPrompt(prompt) {
  const { provider, error } = await getActiveProvider();

  if (error) {
    notify(error);
    return;
  }

  // Ensure sidebar is set to provider URL
  await browser.sidebarAction.setPanel({ panel: provider.url });

  // Store prompt for the injector to pick up
  await browser.storage.local.set({
    pendingPrompt: { prompt, provider }
  });

  // Open the sidebar — the injector content script will read pendingPrompt
  await browser.sidebarAction.open();
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