# Architecture & Design Rationale

This document captures the **why** behind key decisions. For the current architecture overview, file map, and storage keys, see the project root `CLAUDE.md`.

## Why Manifest V2

Firefox's sidebar API (`sidebarAction`) and content script injection are more straightforward in V2. Firefox has not deprecated V2. The extension has no build step — plain JavaScript.

## Why `sidebarAction.setPanel()` Instead of Iframes

The original design used an iframe inside `sidebar.html` to load the LLM web UI. This failed because:
- Sidebar iframes are **not browser tabs** — `tabs.query()` can't find them, `tabs.executeScript()` can't target them
- Content scripts registered in `manifest.json` for LLM domains don't run in sidebar iframes

The solution: load the LLM URL directly as the sidebar panel via `sidebarAction.setPanel(url)`. This makes the sidebar a real navigation context where declarative content scripts run naturally.

## Why Dual Prompt Storage (Memory + `storage.local`)

Prompt delivery has three timing scenarios:

1. **Sidebar opens fresh** — new injector loads, sends `injector-ready` handshake, background returns prompt from `pendingPromptData` (in-memory). Fast and race-free.
2. **Sidebar already open** — `storage.onChanged` fires in the running injector, which reads the prompt from `storage.local`. No handshake needed.
3. **`newChat` reload** — `setPanel()` with cache-bust forces a new page load. The old injector dies (guarded by `beforeunload`), the new one uses path #1.

The in-memory variable (`pendingPromptData`) avoids timing races between `storage.local.set()` in the background and `storage.local.get()` in a freshly-loaded content script. The storage path covers the "already open" case where no new page load occurs.

## Why Non-Async `onMessage` Handler

Firefox's `runtime.onMessage` system treats any Promise return as "this listener is handling the message." An `async` handler implicitly returns a Promise for **every** message — including ones it doesn't handle — which blocks other listeners from responding.

The background script uses a synchronous `switch` statement and only returns `Promise.resolve(...)` for message types it explicitly handles. Unhandled types fall through with no return value.

## Why `sidebarAction.open()` Must Be Called Before `await`

Firefox gates `sidebarAction.open()` behind user gesture verification. In an `async` function, the first `await` yields the microtask queue, and Firefox considers the gesture consumed. The pattern:

```js
// popup click handler
browser.sidebarAction.open();  // MUST be first — synchronous
await saveSelections();         // now safe to await
await browser.runtime.sendMessage(...);
```

Context menu `onClicked` handlers also count as user gestures.

## Why Prompts Use URLs, Not Extracted Text

For page and multi-tab summarization, the prompt includes only URLs — not extracted page text. This:
- Avoids the complexity and fragility of text extraction (readability algorithms, handling SPAs, etc.)
- Keeps prompts small (a URL vs. thousands of characters)
- Works because ChatGPT and Claude can browse URLs natively

Selection summarization is the exception — it sends the actual selected text since the user explicitly chose a fragment.

## Error Handling Strategy

All errors surface as Firefox notifications (`browser.notifications`). The injector has a fallback chain:

| Failure | Action |
|---------|--------|
| Input element not found (10s timeout) | Copy prompt to clipboard, notify user |
| Login page detected (password field heuristic) | Notify "log in to [provider]" |
| Submit button not found | Prompt was pasted; notify "submit manually" |
| `sidebarAction.open()` outside gesture context | Notify "open the sidebar" |

## Release Process

`release.sh` automates the full release: reads conventional commits since last tag, auto-detects semver bump (major/minor/patch), generates grouped changelog, bumps `manifest.json`, builds `.xpi` via `web-ext`, pushes, and creates a GitHub Release with the `.xpi` attached. Supports `--dry-run`.
