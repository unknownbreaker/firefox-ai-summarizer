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

async function setActiveProvider(providerId) {
  await browser.storage.sync.set({ activeProviderId: providerId });
}
