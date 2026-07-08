/**
 * Article extractor content script.
 * Injected into the user's active page (after lib/readability.js) to extract
 * article content using Mozilla's Readability.js.
 *
 * This is a one-shot script: it runs, returns a result via the executeScript
 * return value, and doesn't register any listeners.
 *
 * Return value (consumed by background.js):
 *   Success: { title, byline, url, textContent }
 *   Failure: { extractionFailed: true, reason: "not-readable" | "insufficient-content" | "error", url }
 */
(function () {
  var url = window.location.href;

  if (typeof isProbablyReaderable !== "function" || typeof Readability !== "function") {
    return { extractionFailed: true, reason: "error", url: url };
  }

  if (!isProbablyReaderable(document)) {
    return { extractionFailed: true, reason: "not-readable", url: url };
  }

  try {
    var clone = document.cloneNode(true);
    var article = new Readability(clone).parse();

    if (!article || !article.textContent || article.textContent.trim().length < 100) {
      return { extractionFailed: true, reason: "insufficient-content", url: url };
    }

    return {
      title: article.title || null,
      byline: article.byline || null,
      textContent: article.textContent.trim(),
      url: url
    };
  } catch (e) {
    return { extractionFailed: true, reason: "error", url: url };
  }
})();
