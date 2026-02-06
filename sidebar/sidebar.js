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
 * Listen for messages from the background script.
 */
browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === "inject-prompt") {
    // The sidebar receives the inject-prompt message from background.
    // It needs to forward to the injector content script running inside the LLM page.
    // Since the iframe loads an external site, we can't directly access its content.
    // Instead, we use browser.tabs API from background to inject into the sidebar's frame.
    // For now, relay back to background to handle the actual injection.
    browser.runtime.sendMessage({
      type: "do-inject-via-background",
      prompt: message.prompt,
      provider: message.provider
    });
  }

  if (message.type === "reload-provider") {
    loadProvider();
  }
});

// Load on sidebar open
loadProvider();
