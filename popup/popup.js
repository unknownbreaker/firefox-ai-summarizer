const providerSelect = document.getElementById("provider-select");
const presetSelect = document.getElementById("preset-select");

// Last values known to be persisted, so saveSelections() can skip no-op
// writes — storage.sync writes are rate-limited by quota, and the summarize
// buttons would otherwise burn two writes per click even when nothing changed.
let savedProviderId = null;
let savedPresetId = null;

// --- Initialize ---

async function init() {
  // Load active provider
  const stored = await browser.storage.sync.get(["activeProviderId"]);
  savedProviderId = stored.activeProviderId || "gemini";
  providerSelect.value = savedProviderId;

  // Load presets
  const presets = await getPresets();
  presetSelect.innerHTML = "";
  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    if (preset.isDefault) {
      option.selected = true;
      savedPresetId = preset.id;
    }
    presetSelect.appendChild(option);
  }
}

// --- Event Listeners ---

document.getElementById("summarize-page").addEventListener("click", () => {
  // All calls are synchronous (fire-and-forget) because opening the sidebar
  // may dismiss the popup, killing any pending await chains.
  browser.sidebarAction.open();
  saveSelections();
  browser.runtime.sendMessage({ type: "summarize-page" });
});

document.getElementById("summarize-tabs").addEventListener("click", () => {
  browser.sidebarAction.open();
  saveSelections();
  browser.runtime.sendMessage({ type: "summarize-tabs" });
});

providerSelect.addEventListener("change", async () => {
  savedProviderId = providerSelect.value;
  await setActiveProvider(providerSelect.value);
  browser.runtime.sendMessage({ type: "reload-provider" });
});

presetSelect.addEventListener("change", async () => {
  savedPresetId = presetSelect.value;
  await browser.storage.sync.set({ defaultPresetId: presetSelect.value });
});

document.getElementById("open-settings").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

async function saveSelections() {
  // The change handlers normally persist these already — only write what
  // actually differs (covers a click racing an in-flight change handler).
  const writes = [];
  if (providerSelect.value !== savedProviderId) {
    savedProviderId = providerSelect.value;
    writes.push(setActiveProvider(providerSelect.value));
  }
  if (presetSelect.value !== savedPresetId) {
    savedPresetId = presetSelect.value;
    writes.push(browser.storage.sync.set({ defaultPresetId: presetSelect.value }));
  }
  await Promise.all(writes);
}

init();
