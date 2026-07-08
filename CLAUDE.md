# AI Summarizer

Firefox WebExtension (Manifest V2) that summarizes web content using LLM web UIs (ChatGPT, Claude, custom) in the sidebar. No API keys — uses the user's existing LLM sessions.

## Architecture

**Flow:** popup/context-menu → background.js (extracts article + builds prompt) → stores in memory + storage.local → sidebar loads LLM URL via setPanel() → content/injector.js uploads file + fills input + submits

```
User action (popup button / context menu / keyboard shortcut)
        │
        ▼
  background.js ─── extracts article (lib/readability.js + content/article-extractor.js)
        │            builds prompt (lib/prompt-builder.js)
        │            gets provider config (providers/providers.js)
        │
        ├─ [if extraction succeeded]
        │   builds article file + short prompt + fallback prompts
        │
        ├─ [if extraction failed]
        │   builds URL-only prompt (original behavior)
        │
        ├─ holds { prompt, provider, articleFile, urlFallback, textFallback }
        │   in memory (pendingPromptData) for the injector-ready handshake
        │
        ├─ [if newChat]  sidebarAction.setPanel(providerUrl + cacheBust)
        │                (memory-only delivery — NO storage write, see Invariant 3)
        ├─ [else]        storage.local.set(pendingPrompt)  → storage.onChanged
        │
        ▼
  content/injector.js (runs on LLM domain in sidebar)
        │
        ├─ Path 1: page load → "injector-ready" → gets prompt data from background
        ├─ Path 2: storage.onChanged → reads prompt data from storage.local
        │
        ├─ [if articleFile present] tries file upload via DataTransfer API
        │   └─ fallback: URL-only prompt → paste text → clipboard
        │
        ▼
  Finds input element → sets value → clicks submit
```

The sidebar loads the LLM URL directly via `sidebarAction.setPanel()` — NOT in an iframe. This is critical: sidebar iframes are not browser tabs and can't be targeted by `tabs.executeScript()` or content script matching.

## Critical Invariants

1. **`sidebarAction.open()` before any `await`** — Firefox user gesture context is consumed by the first `await`. In popup click handlers and context menu handlers, call `sidebarAction.open()` synchronously first.
2. **Non-async `onMessage` handler** — The `browser.runtime.onMessage` listener in background.js must NOT be `async`. An async handler returns a Promise for ALL messages (including unhandled ones), blocking other listeners. Only return a Promise for handled message types.
3. **Prompt delivery is split by path, NOT always dual** — The pending prompt is always held in `pendingPromptData` (in-memory in background.js) for the "injector-ready" handshake. **`newChat` reloads deliver via memory ONLY** — `injectPrompt` does not write `storage.local` on this path. Writing storage there would fire `storage.onChanged` in the *outgoing* injector (when the sidebar was already open), which consumes the prompt and injects it into the page being reloaded away — the prompt vanishes in the navigation and the fresh chat gets nothing (symptom: summarize "does nothing" intermittently when the sidebar is already open; the `unloading` guard can't catch it because `onChanged` fires before `setPanel` triggers `beforeunload`). Only the **no-reload path (`newChat=false`)** writes `storage.local`, so `storage.onChanged` reaches the already-open injector. All current user-facing triggers (popup, context menu, selection) pass `newChat: true`.
4. **`pagehide` guard in injector (NOT `beforeunload`)** — Prevents a dying injector from consuming a prompt during provider-switch reloads. Must stay `pagehide`: a `beforeunload` listener disables Firefox's back/forward cache on every page of the matched LLM domains, slowing ordinary browsing there.
5. **DOM API for user content, never innerHTML** — Extension contexts have elevated privileges; innerHTML with user data = XSS.
6. **Cache-bust for setPanel()** — `setPanel()` with the same URL is a no-op. Append `?_t=Date.now()` to force reload.
7. **`_t` is also the sidebar marker — every setPanel() provider URL must carry it** — The injector matches `*://claude.ai/*` etc., so it also loads in *regular browsing tabs* on LLM domains. Those copies stay inert (no `injector-ready` handshake, no `storage.onChanged` listener) unless the page URL has a `_t` query param, which only the background's `setPanel()` calls add (via `withSidebarMarker()` in background.js — route ALL provider setPanel URLs through it, including non-reload paths like `loadSidebarProvider`, which uses a constant `_t=0`). Without this gate, a loading LLM tab races the sidebar for the pending prompt and can inject the summary into the wrong page. The flag is captured at script load because SPAs rewrite `location` via client-side routing.

## Additional Gotchas

- **`getPanel()` URL comparison is unreliable** — Firefox may normalize URLs. Track provider state in memory instead.
- **`sendResponse` is deprecated** — Use `return Promise.resolve(value)` from listeners.
- **`storage.onChanged` fires in ALL extension contexts** — background, content scripts, popups, sidebar. Useful as a cross-context event bus.
- **`HTMLTextAreaElement.prototype.value` setter exists on INPUT elements too** — Check `element.tagName` and use the correct prototype.
- **Never clear Claude's ProseMirror editor with `innerHTML = ""`** — ProseMirror keeps its own document model plus a DOM selection. Wiping innerHTML out-of-band destroys the selection, so `execCommand("insertText")` has no caret to insert at and intermittently returns `false`, leaving the editor empty — the prompt silently vanishes (especially after a file attach, when ProseMirror's focus/selection is already churning, which is why text-only Claude worked but page-upload didn't). In `setInputValue` (injector.js), select existing content so `insertText` *replaces* it, with a synthetic `paste` event (via `clipboardData`) as a verified fallback. ChatGPT uses the native textarea value setter so it's unaffected.
- **Article extraction fallback chain** — File upload → URL-only prompt → paste text → clipboard. If Readability.js says the page isn't readable (`isProbablyReaderable()` returns false), skip extraction entirely and use URL-only. Extracted text is deliberately NOT length-capped (user decision, 2026-07-08 — a cap was added then removed): the full article always reaches the LLM. Multi-tab extraction runs in batches of 4 (`mapWithConcurrency` in background.js) because each extraction clones the tab's full DOM.
- **Synthetic file drops must be built in the PAGE realm, not the content-script sandbox** — Firefox content scripts run in an isolated sandbox behind Xray wrappers. A `File`/`DataTransfer` constructed in the sandbox is invisible when the page's drop handler reads `event.dataTransfer.files` — the drop fires but attaches *nothing*, with no error. (Symptom: works from the DevTools console, which runs in the page realm, but silently no-ops from the content script.) Asymmetry worth remembering: assigning to a real element's `.files` (as `tryFileUpload` does for ChatGPT/Claude) crosses the boundary fine; it's only *reading* files off a sandbox-built event that fails. Fix in `dispatchPageRealmDrop` (injector.js): build `File`/`DataTransfer`/`DragEvent` via `window.wrappedJSObject` (the page's real constructors) and `cloneInto` plain data into the page realm (`wrapReflectors: true` so the cloned event init can carry the native `DataTransfer`). This is how Gemini's `fileUploadMethod: "drop"` actually attaches.

## Design Decisions

- **Manifest V2** — Firefox's sidebar API and content script injection are more straightforward in V2. Firefox has not deprecated V2. No build step — plain JavaScript.
- **Article extraction with fallbacks** — Page summarization extracts article content via Readability.js and uploads it as a file attachment. Falls back to URL-only prompts when extraction fails (non-readable pages, file upload errors). Selection summarization still sends actual text.
- **Error fallback chain** — Input not found (10s timeout) → copy to clipboard. Login page detected → notify "log in". Submit button not found → notify "submit manually". `sidebarAction.open()` outside gesture → notify "open sidebar".

## Quick Reference

| Task | Where to look |
|------|--------------|
| Add/change a provider | `providers/providers.js`, `manifest.json` (content_scripts) |
| Change prompt behavior | `lib/prompt-builder.js` |
| Fix article extraction | `content/article-extractor.js`, `lib/readability.js` |
| Fix injection failures | `content/injector.js` |
| Fix sidebar open/close | `background.js` (handleSummarizeRequest) |
| Change popup UI | `popup/popup.{html,js}` |
| Change settings UI | `settings/settings.{html,js}` |

## File Map

| File | Lines | Role |
|------|-------|------|
| `manifest.json` | 72 | Manifest V2. Declares background scripts, content scripts for LLM domains, sidebar, popup, options page |
| `background.js` | 392 | Central orchestrator. Context menus, message handling, prompt delivery, provider switching |
| `content/injector.js` | 654 | Runs on LLM pages in sidebar (inert in regular tabs — no `_t` marker). Receives prompts, attaches article (file input or page-realm drag-drop), fills input, clicks submit |
| `content/extractor.js` | 17 | Injected into active tab to get selected text via `window.getSelection()` |
| `content/article-extractor.js` | 41 | One-shot script injected into active tab to extract article via Readability (no length cap) |
| `lib/readability.js` | 2944 | Bundled Mozilla Readability.js v0.6.0 for article extraction |
| `lib/prompt-builder.js` | 72 | Prompt templates for page/tabs/selection. Preset management (concise/detailed/bullets + custom) |
| `providers/providers.js` | 98 | Provider config (Gemini/Claude/ChatGPT/custom). Load/save from `storage.sync`, merge overrides |
| `popup/popup.{html,js}` | 257 | Toolbar popup. Summarize buttons, provider/preset dropdowns, settings link, "install latest release" button (checks GitHub latest release on every popup open, 15-min cache in `updateCheck`; disabled when installed version matches) |
| `settings/settings.{html,js}` | 320 | Full options page. Provider config, preset editor, injection delay, auto-submit, char limit |
| `sidebar/sidebar.{html,js}` | 40 | Fallback page shown when no provider configured. Normally overridden by `setPanel()` |
| `release.sh` | 238 | Automated release: semver bump from conventional commits, changelog, build, GitHub release. Attaches the .xpi twice — versioned (`ai-summarizer-X.Y.Z.xpi`, archival) and stable-named (`ai-summarizer.xpi`, keeps the `/releases/latest/download/` permalink valid) |

## Storage Keys

| Key | Area | Purpose |
|-----|------|---------|
| `activeProviderId` | sync | `"gemini"` (default) / `"claude"` / `"chatgpt"` / `"custom"` |
| `providerOverrides` | sync | `{ [id]: { inputSelector?, submitSelector?, fileInputSelector? } }` |
| `customProvider` | sync | `{ id, name, url, inputSelector, submitSelector, fileInputSelector }` |
| `customPresets` | sync | `[{ id, name, instruction }]` |
| `defaultPresetId` | sync | Active preset ID (default: `"concise"`) |
| `injectionDelay` | sync | ms before clicking submit (default: 500) |
| `autoSubmit` | sync | boolean (default: true) |
| `charLimit` | sync | Max chars for selection (default: 10000) |
| `pendingPrompt` | local | `{ prompt, provider, articleFile?, urlFallback?, textFallback? }` — consumed by injector. Purged at background startup; both it and the in-memory `pendingPromptData` auto-expire 60s after being set if never consumed (`setPendingPromptData`), so a failed delivery doesn't pin a large article payload |
| `updateCheck` | local | `{ latestVersion, checkedAt }` — 15-min cache of the GitHub latest-release check driving the popup's install button |

## Development

```sh
web-ext run                    # Launch Firefox with extension loaded
web-ext build                  # Build .xpi in web-ext-artifacts/
./release.sh --dry-run         # Preview what a release would do
```

Tests are manual HTML files opened in a browser (no CLI runner):
- `test/prompt-builder.test.html`
- `test/providers.test.html`

## Provider Selectors (current as of v0.3.2)

Each provider has a primary `submitSelector` plus a `submitFallbacks` array. The injector tries them in order (primary → fallbacks → Enter key) so that UI changes on LLM sites don't silently break submission.

- **ChatGPT**: input=`#prompt-textarea`, submit=`button[data-testid='send-button']`, fallbacks=[`button[aria-label='Send prompt']`, `button[aria-label*='Send']`], file=`input[type='file']`
- **Claude**: input=`div.ProseMirror[contenteditable='true']`, submit=`button[aria-label='Send Message']`, fallbacks=[`button[aria-label='Send message']`, `button[aria-label*='Send']`, `fieldset button[type='button']:not([disabled])`], file=`input[type='file']`
- **Gemini**: input=`div.ql-editor[contenteditable='true']` (Quill editor), submit=`button[aria-label='Send message']`, fallbacks=[`button[aria-label*='Send']`, `button[mat-icon-button][aria-label*='Send']`], file=`input[type='file']`, newChat=`button[aria-label='New chat' i]`

`newChatSelector` (provider field, default none): the injector clicks this **before** injecting to force a fresh conversation. Gemini needs it because `gemini.google.com/app` is an Angular SPA that **restores the last active conversation on load**, ignoring the `setPanel` cache-bust (unlike Claude's server-side `/new` route) — so without it the summary appends to whatever conversation Gemini restored. `startNewChat` (injector.js) waits for the button (`waitForClickableButton`, 5s), clicks it, and settles 500ms before the file-drop/fill flow runs against the fresh composer. The selector is scoped to `<button>` (not the `<a>` variants, which can trigger a full navigation and reload the injector) and uses the case-insensitive `i` flag (the button's label is "New Chat", the anchors' is "New chat"). No-op for providers without the field, and idempotent if already on a fresh chat. Could be surfaced as a `providerOverrides` key later (settings UI doesn't expose it yet).

`fileUploadMethod` (provider field, default input-population): set to `"drop"` to attach the article by simulating a drag-and-drop onto the composer instead of populating a file `<input>`. Gemini uses `"drop"` because its file `<input>` is gated behind the "Upload & tools" menu and is **never** in the DOM (so `querySelector` finds nothing — confirmed: 0 file inputs at rest *and* with the menu open). The drop path (`tryFileDrop` → `dispatchPageRealmDrop` in injector.js) dispatches `dragenter`/`dragover`/`drop` with a **page-realm** `DataTransfer` (see the Xray gotcha above — a sandbox-built one attaches nothing), then **verifies** the attachment by polling for the file name in the DOM — a class-agnostic check. If verification fails, it returns false and `doInject` falls through to the prompt fallback chain (avoids a "summarize the attached file" prompt with no file).

**Cold-start race:** on a fresh sidebar load (`newChat` → `setPanel`), the `ql-editor` element can exist before Gemini's drop handler is wired, and Angular may replace the node first captured — so a single drop silently attaches nothing (symptom: file attaches when the sidebar is already open, but a closed→reopen run only pastes text). `tryFileDrop` therefore **retries** (re-querying the live editor each attempt) until a chip appears or it times out, then falls back to text.

**Upload-completion race:** the attachment chip renders (filename in the DOM) the instant the drop lands, but the file is still *uploading* — Gemini shows a spinner on the chip and only binds the attachment to the **next** send once it finishes. The original code treated chip-rendered as file-ready and submitted after a fixed 500ms, so submit fired mid-upload: Gemini flushed the **prompt text alone** (button → stop-square, generated a reply) and left the now-finished chip pending in the composer — the summary went out without the article, and a manual click was needed to send the file. Fix: after the chip lands, `tryFileDrop` calls `waitForUploadComplete` (injector.js), which waits for the chip's loading marker to **appear and then disappear** before reporting success. The selector — `.gem-attachment-content.loading, [aria-label="Loading attachment" i]` — was confirmed against the live Gemini DOM: the chip's content span carries a `loading` class while uploading (locale-independent primary signal), alongside a mat-spinner labelled "Loading attachment" (secondary). **Both are attachment-scoped on purpose:** a generic `[role="progressbar"]` check would also match Gemini's sidenav spinner ("Loading Gems and Recent conversations") that shows on a cold page load and could stall the flow. Bounded by timeouts: the chip can render a beat before its spinner mounts, so it first waits briefly for the marker to appear; if it never does (instant upload, or a future reskin renaming both markers), it proceeds immediately — degrading to the old behavior, never worse.

`fileUploadFallback` (provider field, default URL-first): set to `"text"` to make `doInject` prefer pasting article text over a URL-only prompt when file upload fails. Gemini uses `"text"` because it browses URLs unreliably, so a rejected drop should fall back to pasted text rather than a bare URL.
