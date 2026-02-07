/**
 * Injector content script.
 * Runs inside the LLM web UI (ChatGPT, Claude, or custom) loaded as the sidebar panel.
 * Checks for a pending prompt in storage on load, and also listens for "do-inject" messages.
 */

// Check for a pending prompt on page load
async function checkPendingPrompt() {
  const stored = await browser.storage.local.get(["pendingPrompt"]);
  if (!stored.pendingPrompt) return;

  const { prompt, provider } = stored.pendingPrompt;

  // Clear it immediately so it doesn't re-trigger
  await browser.storage.local.remove("pendingPrompt");

  await doInject(prompt, provider);
}

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

// Check for pending prompt after a short delay to let the page initialize
setTimeout(checkPendingPrompt, 2000);

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
