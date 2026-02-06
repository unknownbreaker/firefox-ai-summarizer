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

  if (message.type === "do-inject-via-background") {
    // Relayed from sidebar — inject the content script into the sidebar's LLM page
    await doInjectViaBackground(message.prompt, message.provider);
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

// --- Injection Pipeline ---

async function injectPrompt(prompt) {
  const { provider, error } = await getActiveProvider();

  if (error) {
    notify(error);
    return;
  }

  // Store the pending prompt so the sidebar can pick it up after loading
  await browser.storage.local.set({
    pendingPrompt: { prompt, provider }
  });

  // Open the sidebar
  await browser.sidebarAction.open();
}

/**
 * Called when the sidebar relays a do-inject-via-background message.
 * Finds the sidebar's internal tab/frame and injects the content script.
 */
async function doInjectViaBackground(prompt, provider) {
  // Find the tab/frame that's hosting the LLM URL
  const allTabs = await browser.tabs.query({});
  const llmTab = allTabs.find(t => t.url && t.url.startsWith(provider.url));

  if (llmTab) {
    try {
      await browser.tabs.executeScript(llmTab.id, { file: "content/injector.js" });
      await browser.tabs.sendMessage(llmTab.id, {
        type: "do-inject",
        prompt: prompt,
        provider: provider
      });
      return;
    } catch (err) {
      // Fall through to clipboard fallback
    }
  }

  // Fallback: copy to clipboard
  await copyToClipboard(prompt);
  notify("Auto-inject failed. The prompt has been copied to your clipboard — paste it manually.");
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

async function copyToClipboard(text) {
  // Background scripts can't use navigator.clipboard directly.
  // Use a temporary offscreen approach or the clipboardWrite permission.
  // In Manifest V2, we can use document.execCommand in a background page.
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
