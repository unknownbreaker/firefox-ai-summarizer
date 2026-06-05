# Add Gemini Provider — Design

## Overview

Add Google Gemini (consumer, `gemini.google.com`) as a selectable summarization
provider alongside ChatGPT, Claude, and Custom. Gemini reuses the entire
existing injection + fallback pipeline; the only Gemini-specific knowledge is
its domain (for the manifest content-script match) and its CSS selectors.

## Scope

- Target surface: `https://gemini.google.com/app` (consumer Gemini, normal Google login)
- Provider ordering/preference: **Gemini, Claude, ChatGPT, Custom**. Gemini is the
  new default `activeProviderId` when nothing is stored.
- Page-summarization delivery: try file upload, **fall back to pasting article text**
  (not URL). Gemini browses URLs unreliably, and its file input is typically behind
  the "+" menu so direct file injection often isn't available — the text fallback
  is the expected path.
- No new storage keys. No new permissions (`<all_urls>` already covers it; the
  content-script match is the only addition).

## Changes

### 1. `providers/providers.js`

Add to `DEFAULT_PROVIDERS`:

```js
gemini: {
  id: "gemini",
  name: "Gemini",
  url: "https://gemini.google.com/app",
  inputSelector: "div.ql-editor[contenteditable='true']",   // Quill editor
  submitSelector: "button[aria-label='Send message']",
  submitFallbacks: [
    "button.send-button",
    "button[aria-label*='Send']",
    "button[mat-icon-button][aria-label*='Send']"
  ],
  fileInputSelector: "input[type='file']",
  fileUploadFallback: "text"   // new field; see injector change
}
```

Selectors are best-guess and require live verification in Firefox.

### 2. `content/injector.js`

Make the file-upload fallback order provider-driven so Gemini prefers text:

```js
if (!uploaded) {
  effectivePrompt = provider.fileUploadFallback === "text"
    ? (textFallback || urlFallback || prompt)
    : (urlFallback || textFallback || prompt);   // unchanged for ChatGPT/Claude
}
```

Gemini's `.ql-editor` is contenteditable, so prompt insertion already flows
through the hardened `setInputValue` contenteditable path (select-and-replace +
synthetic-paste fallback) — no further injection changes needed.

### 3. `manifest.json`

Add a `content_scripts` entry matching `*://gemini.google.com/*` running
`content/injector.js` at `document_idle` (mirrors the Claude block).

### 4. UI (two hardcoded lists)

- `popup/popup.html`: add `<option value="gemini">Gemini</option>`
- `settings/settings.html`: add `<label><input type="radio" name="provider" value="gemini"> Gemini</label>`

The settings override logic is generic (keyed by selected provider), so no
settings.js change is required.

### 5. `CLAUDE.md`

Update the "Provider Selectors" section with Gemini's selectors and document the
`fileUploadFallback` provider field.

## Testing

- `providers.test.html`: add a case asserting `getActiveProvider` returns the
  Gemini config when `activeProviderId === "gemini"`.
- Manual: `web-ext run` → select Gemini → summarize a page → confirm the prompt
  text + article land and submit. Tweak selectors live if needed.

## Not In Scope

- AI Studio (`aistudio.google.com`) — different UI/selectors.
- Per-provider model selection (separate, deferred feature).
