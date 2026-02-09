# Fix Context Menu and Sidebar Open Issues

**Date:** 2026-02-08
**Status:** Draft

## Problems

### 1. No "Summarize Page" in context menu
Only "Summarize Selection" is registered (with `contexts: ["selection"]`). No way to trigger page summarization from right-click.

### 2. Sidebar doesn't open when clicking "Summarize This Page" in popup
`browser.sidebarAction.open()` throws: "sidebarAction.open may only be called from a user input handler". The call happens in `background.js` after an async message chain from the popup, losing the user gesture context.

## Root Causes

1. Missing context menu registration — only `summarize-selection` exists.
2. Firefox requires `sidebarAction.open()` to be called directly from a user input handler (click, keypress). The current flow sends a message to the background script, which calls `sidebarAction.open()` — but the background isn't in a user gesture context.

## Design

### Fix 1: Add context menu items (`background.js`)

Add two new items:
- `"summarize-page"` with `contexts: ["page"]`
- `"summarize-tabs"` with `contexts: ["page"]`

Since context menu handlers run in the background (no user gesture for `sidebarAction.open()`), store the prompt and show a notification. If the sidebar is already open, `storage.onChanged` triggers injection automatically.

### Fix 2: Move `sidebarAction.open()` to popup (`popup/popup.js`)

Current flow (broken):
```
popup click → sendMessage → background → sidebarAction.open() ← FAILS
```

New flow:
```
popup click → sidebarAction.open() + sendMessage → background stores pendingPrompt
                                                 → injector picks up prompt
```

The popup click handler is a valid user gesture context.

Changes to `background.js`:
- Remove `sidebarAction.open()` from `injectPrompt()`
- `injectPrompt()` only stores `pendingPrompt` and sets sidebar panel URL

### Fix 3: Add `storage.onChanged` listener to injector (`content/injector.js`)

Handle the case where the sidebar is already open (injector already loaded):
- Add `browser.storage.onChanged` listener watching for `pendingPrompt`
- Extract shared `consumePendingPrompt()` with an `injecting` flag to prevent double injection
- Both `checkPendingPrompt` (on page load) and `onChanged` call the same guarded function

## Files Changed

| File | Change |
|------|--------|
| `background.js` | Add page/tabs context menu items, remove `sidebarAction.open()` from `injectPrompt()`, add notification for context menu flow |
| `popup/popup.js` | Add `sidebarAction.open()` in click handlers before `sendMessage()` |
| `content/injector.js` | Add `consumePendingPrompt()` with dedup guard, add `storage.onChanged` listener |

## Files Unchanged

- `manifest.json` — permissions already include `contextMenus`
- `providers/providers.js` — no changes
- `lib/prompt-builder.js` — no changes
- `popup/popup.html` — no changes
