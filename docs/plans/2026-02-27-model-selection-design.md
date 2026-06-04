# Model Selection Feature Design

## Overview

Add a "Model" dropdown to the popup that lets users choose which LLM model to use (e.g., GPT-4o, Sonnet 4.6). The injector content script selects the model via DOM manipulation on the LLM page before injecting the prompt.

## Scope

- ChatGPT and Claude only (not custom providers)
- Hardcoded model list per provider, updated with extension releases
- "Auto" default that skips model picking entirely

## Data Model

### Provider Config Changes (`providers/providers.js`)

Each built-in provider gains three new fields:

```js
chatgpt: {
  // ...existing fields...
  models: [
    { id: "auto", name: "Auto (default)", slug: null },
    { id: "gpt-4o", name: "GPT-4o", slug: "GPT-4o" },
    { id: "o3", name: "o3", slug: "o3" },
    { id: "o4-mini", name: "o4-mini", slug: "o4-mini" },
  ],
  modelPickerTrigger: "<CSS selector to open model dropdown>",
  modelOptionPattern: "<CSS selector pattern to find model option by slug>"
},
claude: {
  // ...existing fields...
  models: [
    { id: "auto", name: "Auto (default)", slug: null },
    { id: "sonnet", name: "Sonnet 4.6", slug: "Sonnet" },
    { id: "opus", name: "Opus 4.6", slug: "Opus" },
    { id: "haiku", name: "Haiku 4.5", slug: "Haiku" },
  ],
  modelPickerTrigger: "<CSS selector>",
  modelOptionPattern: "<CSS selector pattern>"
}
```

Exact CSS selectors to be determined by inspecting the live LLM UIs during implementation.

### New Storage Key

| Key | Area | Purpose |
|-----|------|---------|
| `selectedModel` | sync | `{ [providerId]: modelId }` — per-provider model preference |

## Data Flow

```
User clicks "Summarize" in popup
  ↓
popup.js saves selectedModel to storage.sync
  ↓
background.js reads selectedModel for the active provider
  ↓
background.js includes { modelId, modelSlug, modelPickerTrigger, modelOptionPattern }
  in pendingPrompt data
  ↓
injector.js receives prompt data with model info
  ↓
injector.js calls trySelectModel() BEFORE setInputValue()
  ↓
trySelectModel():
  1. If modelId is "auto" or null → skip, return true
  2. Click modelPickerTrigger element
  3. Wait for dropdown to appear (MutationObserver + timeout)
  4. Find option matching modelSlug
  5. Click it
  6. Wait for dropdown to close
  7. Return true/false
  ↓
Proceed with normal prompt injection
```

## UI Changes

### Popup (`popup/popup.html`, `popup/popup.js`)

Add a "Model" `<select>` between the Provider dropdown and Summary Style dropdown:

```html
<label for="model-select">Model</label>
<select id="model-select"></select>
```

Behavior:
- Populates dynamically based on selected provider's `models` array
- When provider changes, model list re-populates (default to "Auto" or last-used for that provider)
- Stores selection to `storage.sync` as `{ [providerId]: modelId }`
- Custom provider shows no model dropdown (hidden)

### Injector (`content/injector.js`)

New function:

```js
async function trySelectModel(provider, modelSlug) {
  // Skip if no model selection needed
  if (!modelSlug || !provider.modelPickerTrigger) return true;

  // 1. Click the model picker trigger
  // 2. Wait for dropdown
  // 3. Find and click matching option
  // 4. Wait for UI to settle
  // Returns true on success, false on failure
}
```

Integration point in `doInject()`: call `trySelectModel()` before `setInputValue()`.

### Background (`background.js`)

In `injectPrompt()`, read `selectedModel` from storage and include model info in the prompt data:

```js
const modelPrefs = await browser.storage.sync.get(["selectedModel"]);
const modelId = (modelPrefs.selectedModel || {})[provider.id] || "auto";
const model = (provider.models || []).find(m => m.id === modelId);
// Include model.slug, provider.modelPickerTrigger, provider.modelOptionPattern in data
```

## Fallback Behavior

If model selection fails at any step:
1. Log the failure
2. Send notification: "Could not select [model name]. Using the page default."
3. Proceed with prompt injection using whatever model the page currently has selected
4. Do NOT block prompt injection — model selection is best-effort

## Not In Scope

- Custom provider model selection
- User-editable model lists
- Dynamic model discovery from the LLM page
- Model selection via URL parameters (researched and rejected — unreliable)
