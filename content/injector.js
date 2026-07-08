/**
 * Injector content script.
 * Runs inside the LLM web UI (ChatGPT, Claude, or custom) loaded as the sidebar panel.
 * Checks for a pending prompt in storage on load, and also listens for "do-inject" messages.
 */

// Only the sidebar copy of this script may consume prompts. The background
// marks every sidebarAction.setPanel() URL with a `_t` query param (it doubles
// as the cache-bust), so a copy loaded in a REGULAR browsing tab on an LLM
// domain has no `_t` and stays inert: it must not run the injector-ready
// handshake or watch storage, or it would steal a prompt meant for the
// sidebar and inject the summary into the wrong page.
//
// Checked against the navigation timing entry, not window.location: this
// script runs at document_idle, by which point an SPA router (Gemini) may
// already have rewritten the URL via replaceState. The navigation entry
// preserves the document's original URL.
const isSidebarPanel = (() => {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    const originalUrl = (nav && nav.name) || window.location.href;
    return new URL(originalUrl).searchParams.has("_t");
  } catch (_) {
    return new URLSearchParams(window.location.search).has("_t");
  }
})();

// Guard against concurrent injection from multiple triggers
let injecting = false;

// Prevent the dying injector from consuming a prompt during page unload
// (e.g., when the provider changes and setPanel triggers a reload).
// `pagehide`, not `beforeunload`: a beforeunload listener makes the page
// ineligible for the back/forward cache, which would slow down ordinary
// browsing on every LLM domain this script matches.
let unloading = false;
window.addEventListener("pagehide", () => { unloading = true; });

/**
 * Consume and inject a pending prompt from storage.
 * Uses a flag to prevent double-injection when both checkPendingPrompt
 * (on page load) and storage.onChanged fire for the same prompt.
 */
async function consumePendingPrompt(pending) {
  if (injecting || unloading) return;
  injecting = true;

  try {
    // storage.onChanged already hands us the new value — reuse it instead of
    // re-reading (and re-deserializing) the potentially large article payload
    // from storage. The get() is only a fallback for direct calls.
    if (!pending) {
      const stored = await browser.storage.local.get(["pendingPrompt"]);
      pending = stored.pendingPrompt;
    }
    if (!pending) return;

    const { prompt, provider } = pending;
    const articleFile = pending.articleFile || null;
    const urlFallback = pending.urlFallback || null;
    const textFallback = pending.textFallback || null;

    // Clear it immediately so it doesn't re-trigger
    await browser.storage.local.remove("pendingPrompt");

    await doInject(prompt, provider, articleFile, urlFallback, textFallback);
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
        await doInject(
          data.prompt,
          data.provider,
          data.articleFile || null,
          data.urlFallback || null,
          data.textFallback || null
        );
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
      const articleFile = stored.pendingPrompt.articleFile || null;
      const urlFallback = stored.pendingPrompt.urlFallback || null;
      const textFallback = stored.pendingPrompt.textFallback || null;
      await browser.storage.local.remove("pendingPrompt");
      await doInject(prompt, provider, articleFile, urlFallback, textFallback);
    }
  } finally {
    injecting = false;
  }
}

// Prompt delivery is only wired up in the sidebar panel (see isSidebarPanel).
// Inert copies in regular tabs register no listeners and do no per-load work.
if (isSidebarPanel) {
  // React to new prompts stored while the sidebar is already open
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.pendingPrompt && changes.pendingPrompt.newValue) {
      consumePendingPrompt(changes.pendingPrompt.newValue);
    }
  });

  // Also listen for direct messages
  browser.runtime.onMessage.addListener((message) => {
    if (message.type !== "do-inject") return;
    return doInject(
      message.prompt,
      message.provider,
      message.articleFile || null,
      message.urlFallback || null,
      message.textFallback || null
    );
  });
}

/**
 * Try to find and click the submit button using a fallback chain:
 * 1. Primary submitSelector (2s timeout)
 * 2. Each selector in submitFallbacks (1s each)
 * 3. Enter key on the input element (works for Claude ProseMirror and ChatGPT)
 *
 * Returns true if submit was triggered, false if all attempts failed.
 */
async function trySubmit(input, provider) {
  // Try primary selector
  const primary = await waitForClickableButton(provider.submitSelector, 2000);
  if (primary) {
    primary.click();
    return true;
  }

  // Try each fallback selector
  const fallbacks = provider.submitFallbacks || [];
  for (const selector of fallbacks) {
    const btn = await waitForClickableButton(selector, 1000);
    if (btn) {
      btn.click();
      return true;
    }
  }

  // Last resort: press Enter on the input element
  const enterEvent = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  input.dispatchEvent(enterEvent);

  // Brief pause to check if submission was triggered
  await sleep(300);

  // If the input was cleared or the page started navigating, Enter worked.
  // We can't perfectly detect this, so we optimistically report success.
  return true;
}

/**
 * Attempt to attach the article as a file to the LLM.
 *
 * Two strategies, chosen per-provider:
 *   - "drop" (provider.fileUploadMethod): simulate a drag-and-drop onto the
 *     composer. Used when the file <input> is menu-gated and never in the DOM
 *     (e.g. Gemini), but the page accepts dropped files.
 *   - default: populate the provider's file <input> via DataTransfer.
 *
 * `dropTarget` is the already-resolved input element, reused as the drop zone.
 * Returns true only if the attachment is verified, so a rejected attempt falls
 * through to the prompt fallback chain in doInject.
 */
async function tryFileUpload(provider, articleFile, dropTarget) {
  if (provider.fileUploadMethod === "drop") {
    return tryFileDrop(articleFile, provider.inputSelector, dropTarget);
  }

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

/**
 * Attach a file by simulating a drag-and-drop onto the composer.
 *
 * Verifies the attachment landed before reporting success: polls for the file
 * name appearing in the DOM. The name isn't present anywhere before the drop,
 * so its appearance signals a real attachment chip — a class-agnostic check
 * that survives provider UI churn. If the drop is silently rejected, this
 * returns false and doInject falls back to pasting the article text, avoiding
 * a "summarize the attached file" prompt with no file attached.
 *
 * Once the chip lands, also waits for the upload to *finish*
 * (`waitForUploadComplete`) before returning — the chip renders while the file
 * is still uploading, and submitting in that window sends the prompt text alone.
 */
async function tryFileDrop(articleFile, dropSelector, fallbackTarget) {
  const landed = () => documentContainsText(articleFile.name);

  // The page-realm File/DataTransfer carry the full article content; build
  // them once and reuse across retries instead of re-cloning the payload into
  // the page realm on every attempt. Built lazily inside the loop because the
  // page realm may not be ready on the first attempts of a fresh load.
  let dropInit = null;

  // Retry, re-querying the live editor each attempt. On a fresh sidebar load
  // (newChat → setPanel) the ql-editor element can exist before Gemini's drop
  // handler is wired, and Angular may replace the node we first captured. A
  // single drop into that not-yet-ready state silently attaches nothing. So we
  // re-resolve the target and re-dispatch until a chip appears or we time out,
  // then doInject falls back to pasting text. (When the sidebar is already
  // open, the very first attempt succeeds.)
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (landed()) {
      await waitForUploadComplete();
      return true;
    }

    const target = (dropSelector && document.querySelector(dropSelector)) || fallbackTarget;
    if (target) {
      try {
        if (!dropInit) {
          dropInit = buildPageRealmDropInit(articleFile);
        }
        dispatchPageRealmDrop(target, dropInit);
      } catch (e) {
        // Page realm not ready yet during a fresh load — let the loop retry.
      }
    }

    if (await waitForCondition(landed, 1000)) {
      await waitForUploadComplete();
      return true;
    }
  }

  return false;
}

/**
 * Block until a just-dropped attachment finishes uploading.
 *
 * The chip renders (filename in the DOM) the instant the drop lands, but the
 * file is still uploading: Gemini shows a spinner on the chip and only binds the
 * attachment to the *next* send once it completes. Submitting during this window
 * flushes the prompt text alone and leaves the half-uploaded chip pending in the
 * composer — the summary goes out without the article, and a later manual click
 * is needed to send the file. So `tryFileDrop` waits here before reporting
 * success, ensuring doInject submits a composer that already holds a ready
 * attachment.
 *
 * Detection uses Gemini's attachment-specific loading markers, confirmed against
 * the live DOM: the chip's content span carries a `loading` class while the file
 * uploads (`.gem-attachment-content.loading`), alongside a mat-spinner labelled
 * "Loading attachment". Both clear once the file is ready. The `loading` class is
 * the primary signal because it's locale-independent; the aria-label is a
 * secondary catch. Crucially, both are attachment-scoped, so they do NOT collide
 * with Gemini's unrelated sidenav spinner ("Loading Gems and Recent
 * conversations", role="progressbar") that shows during a cold page load — a
 * generic `[role="progressbar"]` check would have stalled on it.
 *
 * Bounded by timeouts: the chip can render a beat before its spinner mounts, so
 * we first wait briefly for the indicator to appear; if it never does (instant
 * upload, or a future reskin that renames both markers) we proceed immediately —
 * degrading to the old behavior, never worse.
 */
async function waitForUploadComplete(timeoutMs = 10000) {
  const uploading = () =>
    document.querySelector(
      '.gem-attachment-content.loading, [aria-label="Loading attachment" i]'
    ) !== null;

  const appeared = await waitForCondition(uploading, 2000);
  if (!appeared) return;

  await waitForCondition(() => !uploading(), timeoutMs);
}

/**
 * Dispatch a synthetic file drop that the PAGE can actually read.
 *
 * Firefox runs content scripts in an isolated sandbox, separated from the page
 * by Xray wrappers. A File/DataTransfer built in the sandbox is invisible to
 * the page when its drop handler reads `event.dataTransfer.files` — which is
 * why the same drop attaches a file from the DevTools console (page realm) but
 * silently nothing from a content script. (Note the asymmetry: assigning to a
 * real element's `.files`, as tryFileUpload does, crosses the boundary fine;
 * reading files off a sandbox-built event does not.)
 *
 * The fix: build the File, DataTransfer, and DragEvent with the PAGE's own
 * constructors via `window.wrappedJSObject`, copying our plain data into the
 * page realm with `cloneInto`. `wrapReflectors: true` lets the cloned event
 * init carry the (native) DataTransfer reference. The page then sees a
 * same-realm File and accepts the drop. No <script> injection, so the page's
 * CSP doesn't apply. Firefox-only — which is fine, this is a Firefox extension.
 */
function buildPageRealmDropInit(articleFile) {
  const pageWindow = window.wrappedJSObject;

  const file = new pageWindow.File(
    cloneInto([articleFile.content], window),
    articleFile.name,
    cloneInto({ type: "text/plain" }, window)
  );

  const dataTransfer = new pageWindow.DataTransfer();
  dataTransfer.items.add(file);

  return cloneInto(
    { bubbles: true, cancelable: true, composed: true, dataTransfer },
    window,
    { wrapReflectors: true }
  );
}

function dispatchPageRealmDrop(target, init) {
  const pageWindow = window.wrappedJSObject;
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new pageWindow.DragEvent(type, init));
  }
}

/**
 * Start a fresh conversation before injecting, for providers whose URL can't
 * force a new chat.
 *
 * Gemini's /app is an Angular SPA that restores the last active conversation on
 * load, ignoring the setPanel cache-bust — so a "new chat" reload still lands
 * in the previous conversation and the summary appends to it. Clicking the
 * provider's "New chat" control resets to an empty composer regardless of what
 * was restored. The click is client-side routing (no full reload), so this
 * injector stays alive and the downstream file-drop/fill flow runs against the
 * fresh composer.
 *
 * No-op for providers without `newChatSelector` (e.g. Claude, whose /new URL
 * already yields a fresh chat). Safe to call even when already on a new chat —
 * the button is either absent/disabled (skipped) or clicking it is idempotent.
 */
async function startNewChat(provider) {
  if (!provider.newChatSelector) return;

  const button = await waitForClickableButton(provider.newChatSelector, 5000);
  if (!button) return; // already fresh, or button not present — proceed anyway

  button.click();

  // Let the SPA tear down the restored conversation and present an empty
  // composer before we attach the file / fill the input. The downstream
  // waitForElement + tryFileDrop retry loop tolerate in-flight DOM, but this
  // brief settle avoids racing the outgoing conversation's composer.
  await sleep(500);
}

async function doInject(prompt, provider, articleFile = null, urlFallback = null, textFallback = null) {
  // Determine the best prompt to use for clipboard fallback
  const clipboardPrompt = textFallback || urlFallback || prompt;

  try {
    // Force a fresh conversation first (Gemini restores the last one on load).
    await startNewChat(provider);

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

    // Determine which prompt to inject via the fallback chain:
    // 1. If articleFile present → try file upload + use primary prompt
    // 2. If file upload fails → use urlFallback (URL-only prompt)
    // 3. If no urlFallback → use textFallback (paste text)
    // 4. Otherwise → use the primary prompt as-is
    let effectivePrompt = prompt;

    if (articleFile) {
      const uploaded = await tryFileUpload(provider, articleFile, input);
      if (!uploaded) {
        // File upload failed — fall through to the next-best prompt. Most
        // providers prefer a URL-only prompt, but some (e.g. Gemini, which
        // browses URLs unreliably) prefer pasting the article text.
        effectivePrompt = provider.fileUploadFallback === "text"
          ? (textFallback || urlFallback || prompt)
          : (urlFallback || textFallback || prompt);
      }
    }

    await setInputValue(input, effectivePrompt);

    // Wait for the configured injection delay
    const settings = await browser.storage.sync.get(["injectionDelay", "autoSubmit"]);
    const delay = settings.injectionDelay || 500;
    const autoSubmit = settings.autoSubmit !== false; // default true

    if (autoSubmit) {
      await sleep(delay);

      const submitted = await trySubmit(input, provider);
      if (!submitted) {
        browser.runtime.sendMessage({
          type: "injection-error",
          error: "submit-not-found",
          providerName: provider.name
        });
        return;
      }
    }

    browser.runtime.sendMessage({ type: "injection-success" });

  } catch (err) {
    // Fallback: copy best available prompt to clipboard
    try {
      await navigator.clipboard.writeText(clipboardPrompt);
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

// Check for pending prompt immediately on load (sidebar panel only).
// No delay needed — waitForElement handles waiting for the DOM.
if (isSidebarPanel) {
  checkPendingPrompt();
}

/**
 * Wait for an element matching the selector to appear in the DOM.
 * Polls at a fixed interval instead of using a MutationObserver: SPA boots
 * (Gemini, ChatGPT) fire mutation bursts many times a second, and running a
 * full-document querySelector per batch was the injector's hottest code path.
 * A 100ms poll bounds the work at 10 checks/sec, and the added latency
 * (≤100ms) is dwarfed by the downstream injection delay.
 */
function waitForElement(selector, timeoutMs) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearInterval(timer);
        clearTimeout(deadline);
        resolve(el);
      }
    }, 100);

    const deadline = setTimeout(() => {
      clearInterval(timer);
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * Wait for a button matching the selector to be present and enabled.
 * Polls because attribute changes (disabled → enabled) don't trigger
 * MutationObserver on childList alone.
 */
function waitForClickableButton(selector, timeoutMs) {
  return new Promise((resolve) => {
    const isClickable = (el) => el && !el.disabled && el.getAttribute("aria-disabled") !== "true";

    const existing = document.querySelector(selector);
    if (isClickable(existing)) {
      resolve(existing);
      return;
    }

    const pollInterval = 200;
    const timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (isClickable(el)) {
        clearInterval(timer);
        clearTimeout(deadline);
        resolve(el);
      }
    }, pollInterval);

    const deadline = setTimeout(() => {
      clearInterval(timer);
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
    // ContentEditable div (e.g., Claude's ProseMirror editor).
    //
    // Do NOT clear with `innerHTML = ""`. ProseMirror maintains its own
    // document model plus a DOM selection; wiping innerHTML out-of-band
    // destroys the selection, so the following execCommand("insertText")
    // has no caret to insert at and intermittently returns false — leaving
    // the editor empty (observed after a file attach, where ProseMirror's
    // focus/selection state is already churning).
    //
    // Instead, select any existing content so insertText *replaces* it
    // (keeping a valid selection), then fall back to a synthetic paste —
    // which ProseMirror also honors via clipboardData — if the insert
    // didn't land.
    element.focus();

    const selectContents = () => {
      const selection = window.getSelection();
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.addRange(range);
    };

    selectContents();
    const inserted = document.execCommand("insertText", false, value);

    if (!inserted || element.textContent.trim() === "") {
      selectContents();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", value);
      element.dispatchEvent(new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      }));
    }
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

/**
 * Resolve true as soon as `predicate()` returns truthy, or false on timeout.
 * Polls because the change we're waiting for (e.g. an attachment chip) is
 * driven by the provider's framework, not by a single observable DOM event.
 */
function waitForCondition(predicate, timeoutMs) {
  return new Promise((resolve) => {
    if (predicate()) {
      resolve(true);
      return;
    }

    const pollInterval = 100;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        clearTimeout(deadline);
        resolve(true);
      }
    }, pollInterval);

    const deadline = setTimeout(() => {
      clearInterval(timer);
      resolve(false);
    }, timeoutMs);
  });
}

/**
 * Check whether `needle` appears anywhere in the document's text WITHOUT
 * serializing the whole page: `document.body.textContent` allocates the
 * entire page text on every call, and this runs inside a 10Hz poll on
 * Gemini's large Angular DOM. A TreeWalker visits text nodes one at a time —
 * the needle (a file name) always sits inside a single text node — so no
 * giant string is ever built. Still class-agnostic, so it survives provider
 * UI churn.
 */
function documentContainsText(needle) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.data.includes(needle)) return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
