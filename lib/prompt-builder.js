const DEFAULT_PRESETS = [
  { id: "concise", name: "Concise", instruction: "Provide a brief 2-3 sentence summary.", isDefault: true },
  { id: "detailed", name: "Detailed", instruction: "Provide a thorough summary covering all key points.", isDefault: false },
  { id: "bullets", name: "Bullet Points", instruction: "Summarize as a concise bulleted list of key takeaways.", isDefault: false }
];

/**
 * Load all presets (built-in + custom) from storage.
 */
async function getPresets() {
  const stored = await browser.storage.sync.get(["customPresets", "defaultPresetId"]);
  const custom = stored.customPresets || [];
  const defaultId = stored.defaultPresetId || "concise";

  const all = [...DEFAULT_PRESETS, ...custom].map(p => ({
    ...p,
    isDefault: p.id === defaultId
  }));

  return all;
}

/**
 * Get a single preset by ID. Falls back to the first default preset.
 */
async function getPreset(presetId) {
  const presets = await getPresets();
  return presets.find(p => p.id === presetId) || presets.find(p => p.isDefault) || presets[0];
}

/**
 * Build a prompt for page summarization (single URL).
 */
function buildPagePrompt(url, presetInstruction) {
  return `Read the full content at the following URL and summarize it as if I had pasted the complete article text directly into this conversation:

${url}

${presetInstruction}`;
}

/**
 * Build a prompt for multi-tab summarization (list of URLs with titles).
 * tabs: Array of { title, url }
 */
function buildTabsPrompt(tabs, presetInstruction) {
  const tabList = tabs
    .map((tab, i) => `${i + 1}. ${tab.title}\n   ${tab.url}`)
    .join("\n");

  return `Read the full content at each of the following URLs and summarize each one as if I had pasted the complete article text directly into this conversation:

${tabList}

${presetInstruction}`;
}

/**
 * Build a prompt for selection summarization (pasted text).
 * Truncates text to charLimit.
 */
function buildSelectionPrompt(selectedText, presetInstruction, charLimit = 10000) {
  const truncated = selectedText.length > charLimit
    ? selectedText.slice(0, charLimit) + "\n\n[Text truncated at " + charLimit + " characters]"
    : selectedText;

  return `${presetInstruction}

---
${truncated}`;
}
