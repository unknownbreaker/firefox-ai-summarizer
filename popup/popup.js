const providerSelect = document.getElementById("provider-select");
const presetSelect = document.getElementById("preset-select");

// --- Initialize ---

async function init() {
  // Load active provider
  const stored = await browser.storage.sync.get(["activeProviderId"]);
  providerSelect.value = stored.activeProviderId || "chatgpt";

  // Load presets
  const presets = await getPresets();
  presetSelect.innerHTML = "";
  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    if (preset.isDefault) option.selected = true;
    presetSelect.appendChild(option);
  }
}

// --- Event Listeners ---

document.getElementById("summarize-page").addEventListener("click", async () => {
  await saveSelections();
  await browser.runtime.sendMessage({ type: "summarize-page" });
  window.close();
});

document.getElementById("summarize-tabs").addEventListener("click", async () => {
  await saveSelections();
  await browser.runtime.sendMessage({ type: "summarize-tabs" });
  window.close();
});

providerSelect.addEventListener("change", async () => {
  await setActiveProvider(providerSelect.value);
  browser.runtime.sendMessage({ type: "reload-provider" });
});

presetSelect.addEventListener("change", async () => {
  await browser.storage.sync.set({ defaultPresetId: presetSelect.value });
});

document.getElementById("open-settings").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

async function saveSelections() {
  await setActiveProvider(providerSelect.value);
  await browser.storage.sync.set({ defaultPresetId: presetSelect.value });
}

init();
