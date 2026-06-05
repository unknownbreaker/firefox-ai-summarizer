// Order reflects display/preference priority: Gemini, Claude, ChatGPT.
const DEFAULT_PROVIDERS = {
  gemini: {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    inputSelector: "div.ql-editor[contenteditable='true']",
    submitSelector: "button[aria-label='Send message']",
    submitFallbacks: [
      "button[aria-label*='Send']",
      "button[mat-icon-button][aria-label*='Send']"
    ],
    fileInputSelector: "input[type='file']",
    // Gemini's /app URL can't force a fresh conversation: the Angular SPA
    // restores the last active conversation on load, ignoring the setPanel
    // cache-bust (unlike Claude's server-side /new route). So the injector
    // clicks this "New chat" button before injecting to start fresh. The `i`
    // flag is a case-insensitive match (the button's label is "New Chat" but
    // the anchors are "New chat"); scoped to <button> to avoid the <a> variant,
    // which can trigger a full navigation and reload the injector. See
    // startNewChat() in injector.js.
    newChatSelector: "button[aria-label='New chat' i]",
    // Gemini's file <input> is gated behind the "Upload & tools" menu and is
    // never present in the DOM, so the standard input-population upload can't
    // work. Instead attach the article by simulating a drag-and-drop onto the
    // composer (fileUploadMethod: "drop"), which Gemini accepts. If the drop
    // is rejected, fall back to pasting the article text rather than a
    // URL-only prompt (Gemini browses URLs unreliably). See injector.js.
    fileUploadMethod: "drop",
    fileUploadFallback: "text"
  },
  claude: {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/new",
    inputSelector: "div.ProseMirror[contenteditable='true']",
    submitSelector: "button[aria-label='Send Message']",
    submitFallbacks: [
      "button[aria-label='Send message']",
      "button[aria-label*='Send']",
      "fieldset button[type='button']:not([disabled])"
    ],
    fileInputSelector: "input[type='file']"
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chat.openai.com",
    inputSelector: "#prompt-textarea",
    submitSelector: "button[data-testid='send-button']",
    submitFallbacks: [
      "button[aria-label='Send prompt']",
      "button[aria-label*='Send']"
    ],
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

/**
 * Load the active provider config from storage.
 * Falls back to gemini if nothing is stored.
 * Merges any user selector overrides on top of defaults.
 */
async function getActiveProvider() {
  const stored = await browser.storage.sync.get([
    "activeProviderId",
    "providerOverrides",
    "customProvider"
  ]);

  const providerId = stored.activeProviderId || "gemini";

  if (providerId === "custom") {
    const custom = stored.customProvider || CUSTOM_PROVIDER_TEMPLATE;
    if (!custom.url || !custom.inputSelector || !custom.submitSelector) {
      return { provider: null, error: "Custom provider is incomplete. Please configure URL, input selector, and submit button selector in settings." };
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
