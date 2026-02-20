# AI Summarizer

Firefox WebExtension (Manifest V2) that summarizes web content using LLM web UIs (ChatGPT, Claude, custom) in the sidebar. No API keys — uses the user's existing LLM sessions.

## Architecture

**Flow:** popup/context-menu → background.js (builds prompt) → stores in memory + storage.local → sidebar loads LLM URL via setPanel() → content/injector.js fills input + submits

```
User action (popup button / context menu / keyboard shortcut)
        │
        ▼
  background.js ─── builds prompt (lib/prompt-builder.js)
        │            gets provider config (providers/providers.js)
        │
        ├─ stores prompt in memory (pendingPromptData) + storage.local
        │
        ├─ [if newChat] sidebarAction.setPanel(providerUrl + cacheBust)
        │                  → forces sidebar reload → new injector loads
        │
        ▼
  content/injector.js (runs on LLM domain in sidebar)
        │
        ├─ Path 1: page load → sends "injector-ready" → gets prompt from background memory
        ├─ Path 2: storage.onChanged → reads prompt from storage.local
        │
        ▼
  Finds input element → sets value → clicks submit
```

The sidebar loads the LLM URL directly via `sidebarAction.setPanel()` — NOT in an iframe. This is critical: sidebar iframes are not browser tabs and can't be targeted by `tabs.executeScript()` or content script matching.

## Critical Invariants

1. **`sidebarAction.open()` before any `await`** — Firefox user gesture context is consumed by the first `await`. In popup click handlers and context menu handlers, call `sidebarAction.open()` synchronously first.
2. **Non-async `onMessage` handler** — The `browser.runtime.onMessage` listener in background.js must NOT be `async`. An async handler returns a Promise for ALL messages (including unhandled ones), blocking other listeners. Only return a Promise for handled message types.
3. **Dual prompt storage** — Prompts are stored in both `pendingPromptData` (in-memory variable in background.js) AND `storage.local`. The in-memory path handles the "injector-ready" handshake (avoids timing races). The storage path handles "sidebar already open" via `storage.onChanged`.
4. **`beforeunload` guard in injector** — Prevents a dying injector from consuming a prompt during provider-switch reloads.
5. **DOM API for user content, never innerHTML** — Extension contexts have elevated privileges; innerHTML with user data = XSS.
6. **Cache-bust for setPanel()** — `setPanel()` with the same URL is a no-op. Append `?_t=Date.now()` to force reload.

## Additional Gotchas

- **`getPanel()` URL comparison is unreliable** — Firefox may normalize URLs. Track provider state in memory instead.
- **`sendResponse` is deprecated** — Use `return Promise.resolve(value)` from listeners.
- **`storage.onChanged` fires in ALL extension contexts** — background, content scripts, popups, sidebar. Useful as a cross-context event bus.
- **`HTMLTextAreaElement.prototype.value` setter exists on INPUT elements too** — Check `element.tagName` and use the correct prototype.

## Design Decisions

- **Manifest V2** — Firefox's sidebar API and content script injection are more straightforward in V2. Firefox has not deprecated V2. No build step — plain JavaScript.
- **URLs, not extracted text** — Page/tab summarization sends only URLs. Avoids text extraction complexity; works because ChatGPT and Claude can browse URLs natively. Selection summarization is the exception (sends actual text).
- **Error fallback chain** — Input not found (10s timeout) → copy to clipboard. Login page detected → notify "log in". Submit button not found → notify "submit manually". `sidebarAction.open()` outside gesture → notify "open sidebar".

## Quick Reference

| Task | Where to look |
|------|--------------|
| Add/change a provider | `providers/providers.js`, `manifest.json` (content_scripts) |
| Change prompt behavior | `lib/prompt-builder.js` |
| Fix injection failures | `content/injector.js` |
| Fix sidebar open/close | `background.js` (handleSummarizeRequest) |
| Change popup UI | `popup/popup.{html,js}` |
| Change settings UI | `settings/settings.{html,js}` |

## File Map

| File | Lines | Role |
|------|-------|------|
| `manifest.json` | 72 | Manifest V2. Declares background scripts, content scripts for LLM domains, sidebar, popup, options page |
| `background.js` | 244 | Central orchestrator. Context menus, message handling, prompt delivery, provider switching |
| `content/injector.js` | 222 | Runs on LLM pages in sidebar. Receives prompts, fills input, clicks submit |
| `content/extractor.js` | 17 | Injected into active tab to get selected text via `window.getSelection()` |
| `lib/prompt-builder.js` | 72 | Prompt templates for page/tabs/selection. Preset management (concise/detailed/bullets + custom) |
| `providers/providers.js` | 66 | Provider config (ChatGPT/Claude/custom). Load/save from `storage.sync`, merge overrides |
| `popup/popup.{html,js}` | 145 | Toolbar popup. Summarize buttons, provider/preset dropdowns, settings link |
| `settings/settings.{html,js}` | 320 | Full options page. Provider config, preset editor, injection delay, auto-submit, char limit |
| `sidebar/sidebar.{html,js}` | 40 | Fallback page shown when no provider configured. Normally overridden by `setPanel()` |
| `release.sh` | 214 | Automated release: semver bump from conventional commits, changelog, build, GitHub release |

## Storage Keys

| Key | Area | Purpose |
|-----|------|---------|
| `activeProviderId` | sync | `"chatgpt"` / `"claude"` / `"custom"` |
| `providerOverrides` | sync | `{ [id]: { inputSelector?, submitSelector? } }` |
| `customProvider` | sync | `{ id, name, url, inputSelector, submitSelector }` |
| `customPresets` | sync | `[{ id, name, instruction }]` |
| `defaultPresetId` | sync | Active preset ID (default: `"concise"`) |
| `injectionDelay` | sync | ms before clicking submit (default: 500) |
| `autoSubmit` | sync | boolean (default: true) |
| `charLimit` | sync | Max chars for selection (default: 10000) |
| `pendingPrompt` | local | `{ prompt, provider }` — consumed by injector |

## Development

```sh
web-ext run                    # Launch Firefox with extension loaded
web-ext build                  # Build .xpi in web-ext-artifacts/
./release.sh --dry-run         # Preview what a release would do
```

Tests are manual HTML files opened in a browser (no CLI runner):
- `test/prompt-builder.test.html`
- `test/providers.test.html`

## Provider Selectors (current as of v0.2.0)

- **ChatGPT**: input=`#prompt-textarea`, submit=`button[data-testid='send-button']`
- **Claude**: input=`div.ProseMirror[contenteditable='true']`, submit=`button[aria-label='Send Message']`
