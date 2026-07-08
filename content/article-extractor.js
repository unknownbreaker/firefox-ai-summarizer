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

  // Cap the extracted text per article. The payload travels far — across the
  // executeScript boundary, into the background page's memory, into
  // storage.local, and cloned into the LLM page's realm as a File — so an
  // unbounded extraction (or many tabs of them) can pin tens of MB. 80k chars
  // (~20k tokens) is more than any summary needs.
  var MAX_ARTICLE_CHARS = 80000;

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

    var text = article.textContent.trim();
    if (text.length > MAX_ARTICLE_CHARS) {
      text = text.slice(0, MAX_ARTICLE_CHARS) +
        "\n\n[Article truncated at " + MAX_ARTICLE_CHARS + " characters]";
    }

    return {
      title: article.title || null,
      byline: article.byline || null,
      textContent: text,
      url: url
    };
  } catch (e) {
    return { extractionFailed: true, reason: "error", url: url };
  }
})();
