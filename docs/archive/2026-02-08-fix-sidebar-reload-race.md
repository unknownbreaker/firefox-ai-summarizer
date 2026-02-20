# Fix Sidebar Reload Race Condition

**Date:** 2026-02-08
**Status:** Approved

## Problem

When the sidebar is already open showing a previous summary and the user clicks "Summarize This Page" on a different tab, the sidebar reloads the LLM UI but doesn't inject the prompt. A second click works.

## Root Cause

`injectPrompt()` called `sidebarAction.setPanel(provider.url)` on every summarization. Even with the same provider, Firefox treats this as a navigation and reloads the sidebar page. The dying old injector hears `storage.onChanged`, consumes and clears the `pendingPrompt` from storage, then unloads. The new injector finds nothing.

A `getPanel()` URL comparison was attempted but is unreliable — Firefox normalizes URLs differently than the stored provider URL (e.g., trailing slashes, URL resolution).

## Fix

### 1. Remove `setPanel()` from `injectPrompt()` (`background.js`)

The sidebar panel URL is already managed by:
- `loadSidebarProvider()` on extension startup
- `reload-provider` message handler when the user changes providers in the popup

`injectPrompt()` only needs to store the prompt in storage. The running injector picks it up via `storage.onChanged`. No reload, no race.

### 2. Keep `beforeunload` guard (`content/injector.js`)

Defense-in-depth for the provider-switch case where `loadSidebarProvider()` triggers a reload:
- Track `unloading` flag via `beforeunload` event listener
- `consumePendingPrompt()` bails out if the page is unloading

## Files Changed

| File | Change |
|------|--------|
| `background.js` | Remove `setPanel()` from `injectPrompt()` — only store prompt in storage |
| `content/injector.js` | Add `beforeunload` guard to `consumePendingPrompt()` |
