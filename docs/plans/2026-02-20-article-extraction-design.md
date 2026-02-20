# Article Extraction + File Upload

## Problem

When the LLM can't access a URL (paywalls, geo-blocks, rate limits, login walls), the current URL-only prompt produces poor or no summaries. The user's browser has the full article content already loaded, but there's no way to deliver it to the LLM without pasting raw text into the prompt.

## Solution

Use Mozilla's Readability.js to extract clean article text from the user's browser tab, then deliver it as a file attachment to the LLM. The prompt stays short ("Summarize the attached article.") while the LLM receives the full content via the file.

## Flow

```
User action (popup / context menu / shortcut)
        |
        v
  background.js
        |
        +-- Inject extractor into active tab(s)
        |     isProbablyReaderable()?
        |       YES -> Readability.parse() -> { title, byline, url, textContent }
        |       NO  -> { url, extractionFailed: true }
        |
        +-- Build structured text file from extracted articles
        |   (headers: Source, Title, Author per article)
        |
        +-- Build short prompt: preset instruction + "Summarize the attached article(s)."
        |
        +-- Store { prompt, provider, fileData } in memory + storage.local
        |
        v
  content/injector.js (on LLM page in sidebar)
        |
        +-- Receive prompt + fileData
        +-- Create File blob from fileData
        +-- Find provider's file input element (fileInputSelector)
        +-- Upload file via DataTransfer API
        +-- Set prompt text in input
        +-- Click submit
```

## Detection

Automatic via Readability.js's `isProbablyReaderable()` function. This is the same check Firefox uses to decide whether to show its Reader View icon. No user configuration needed.

- `isProbablyReaderable()` returns true -> extract article
- Returns false -> skip extraction, use URL-only prompt (current behavior)
- Extraction succeeds but textContent < 100 chars -> skip file upload, use URL-only

## File Format

Single article (article.txt):

```
Source: https://example.com/article
Title: The Article Headline
Author: Jane Doe

[extracted article text]
```

Multi-tab (articles.txt):

```
=== Article 1 of 3 ===
Source: https://nytimes.com/article-one
Title: First Headline
Author: Jane Doe

[text]

=== Article 2 of 3 ===
Source: https://wsj.com/article-two
Title: Second Headline

[text]

=== Article 3 of 3 ===
Source: https://example.com/not-an-article
(Could not extract article content -- URL provided for reference)
```

## Prompt Changes

Current (URL-only):
```
Read the full content at the following URL and summarize it...
https://example.com/article
Provide a brief 2-3 sentence summary.
```

New (with extraction):
```
Summarize the attached article.
Provide a brief 2-3 sentence summary.
```

Fallback (extraction failed): same as current URL-only prompt.

## Fallback Chain

1. File upload (clean prompt + attached article)
2. URL-only prompt (current behavior)
3. Paste article text in prompt (if extraction data is available)
4. Copy to clipboard + notification (existing last resort)

| Scenario | Behavior |
|----------|----------|
| Extraction succeeds + file upload works | File upload + clean prompt |
| Extraction succeeds + file upload fails | URL-only prompt |
| Extraction succeeds + upload fails + URL injection fails | Paste extracted text in prompt |
| Extraction fails (not readable, error, < 100 chars) | URL-only prompt |
| Everything fails | Copy to clipboard + notification |

## Selection Summarization

Unchanged. Selection mode already sends pasted text and does not need file upload.

## Components Changed

| File | Change |
|------|--------|
| content/extractor.js | Add Readability.js extraction alongside existing selection extraction |
| lib/readability.js | New -- bundled copy of Mozilla's Readability.js |
| lib/prompt-builder.js | New buildArticlePrompt() and buildArticleFile() functions |
| background.js | handleSummarizePage/Tabs call extraction, pass file data to injector |
| content/injector.js | doInject gains file upload when fileData is present |
| providers/providers.js | Add fileInputSelector to provider configs |
| manifest.json | Add lib/readability.js to content_scripts or background scripts |
| settings/settings.html/.js | Add fileInputSelector field to provider settings |

## Provider Selectors (new)

| Provider | fileInputSelector |
|----------|------------------|
| ChatGPT | input[type="file"] (behind the paperclip icon) |
| Claude | input[type="file"] (behind the attachment button) |

## Settings

No new user-facing settings. The feature is automatic. The fileInputSelector in provider config is for power users / custom providers (same pattern as inputSelector and submitSelector).
