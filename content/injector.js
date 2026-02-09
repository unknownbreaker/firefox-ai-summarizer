/**
 * Injector content script.
 * Runs inside the LLM web UI (ChatGPT, Claude, or custom) loaded as the sidebar panel.
 * Checks for a pending prompt in storage on load, and also listens for "do-inject" messages.
 */

// Guard against concurrent injection from multiple triggers
let injecting = false;

// Prevent the dying injector from consuming a prompt during page unload
// (e.g., when the provider changes and setPanel triggers a reload).
let unloading = false;
window.addEventListener("beforeunload", () => { unloading = true; });

/**
 * Consume and inject a pending prompt from storage.
 * Uses a flag to prevent double-injection when both checkPendingPrompt
 * (on page load) and storage.onChanged fire for the same prompt.
 */
async function consumePendingPrompt() {
  if (injecting || unloading) return;
  injecting = true;

  try {
    const stored = await browser.storage.local.get(["pendingPrompt"]);
    if (!stored.pendingPrompt) return;

    const { prompt, provider } = stored.pendingPrompt;

    // Clear it immediately so it doesn't re-trigger
    await browser.storage.local.remove("pendingPrompt");

    await doInject(prompt, provider);
  } finally {
    injecting = false;
  }
}

// Ask the background for a pending prompt on page load.
// Uses a direct message handshake instead of reading storage, which avoids
// timing races when the sidebar is opening and the prompt was stored before
// or after the content script loaded.
async function checkPendingPrompt() {
  if (injecting || unloading) return;
  injecting = true;

  try {
    try {
      const data = await browser.runtime.sendMessage({ type: "injector-ready" });
      if (data && data.prompt) {
        await doInject(data.prompt, data.provider);
        return;
      }
    } catch (_) {
      // Background might not be ready yet
    }

    // Fallback: check storage directly (prompt may have been stored while
    // the handshake was in flight)
    const stored = await browser.storage.local.get(["pendingPrompt"]);
    if (stored.pendingPrompt) {
      const { prompt, provider } = stored.pendingPrompt;
      await browser.storage.local.remove("pendingPrompt");
      await doInject(prompt, provider);
    }
  } finally {
    injecting = false;
  }
}

// React to new prompts stored while the sidebar is already open
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.pendingPrompt && changes.pendingPrompt.newValue) {
    consumePendingPrompt();
  }
});

// Also listen for direct messages
browser.runtime.onMessage.addListener((message) => {
  if (message.type !== "do-inject") return;
  return doInject(message.prompt, message.provider);
});

async function doInject(prompt, provider) {
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
}

// Check for pending prompt immediately on load.
// No delay needed — waitForElement handles waiting for the DOM.
checkPendingPrompt();

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
    // Use the correct prototype setter for the element type
    const proto = element.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    if (nativeValueSetter) {
      nativeValueSetter.call(element, value);
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
