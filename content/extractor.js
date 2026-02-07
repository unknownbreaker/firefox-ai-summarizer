/**
 * Extractor content script.
 * Injected into the user's active page to extract selected text.
 * Responds to "extract-selection" messages from the background script.
 */

browser.runtime.onMessage.addListener((message) => {
  if (message.type !== "extract-selection") return;

  const selection = window.getSelection().toString().trim();

  if (!selection) {
    return Promise.resolve({ text: null, error: "No text is selected. Highlight some text first, then try again." });
  }

  return Promise.resolve({ text: selection, error: null });
});
