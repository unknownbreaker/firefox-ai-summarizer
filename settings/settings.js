// --- DOM Elements ---
const providerRadios = document.querySelectorAll('input[name="provider"]');
const customFields = document.getElementById("custom-fields");
const customUrl = document.getElementById("custom-url");
const customInputSelector = document.getElementById("custom-input-selector");
const customSubmitSelector = document.getElementById("custom-submit-selector");
const toggleOverrides = document.getElementById("toggle-overrides");
const overrideFields = document.getElementById("override-fields");
const overrideInput = document.getElementById("override-input");
const overrideSubmit = document.getElementById("override-submit");
const customFileInputSelector = document.getElementById("custom-file-input-selector");
const overrideFileInput = document.getElementById("override-file-input");
const presetList = document.getElementById("preset-list");
const newPresetName = document.getElementById("new-preset-name");
const newPresetInstruction = document.getElementById("new-preset-instruction");
const injectionDelay = document.getElementById("injection-delay");
const autoSubmit = document.getElementById("auto-submit");
const charLimit = document.getElementById("char-limit");
const saveStatus = document.getElementById("save-status");

// --- Load Settings ---

async function loadSettings() {
  const stored = await browser.storage.sync.get([
    "activeProviderId",
    "customProvider",
    "providerOverrides",
    "customPresets",
    "defaultPresetId",
    "injectionDelay",
    "autoSubmit",
    "charLimit"
  ]);

  // Provider
  const providerId = stored.activeProviderId || "chatgpt";
  const radio = document.querySelector(`input[name="provider"][value="${providerId}"]`);
  if (radio) radio.checked = true;
  customFields.classList.toggle("hidden", providerId !== "custom");

  if (stored.customProvider) {
    customUrl.value = stored.customProvider.url || "";
    customInputSelector.value = stored.customProvider.inputSelector || "";
    customSubmitSelector.value = stored.customProvider.submitSelector || "";
    customFileInputSelector.value = stored.customProvider.fileInputSelector || "";
  }

  // Overrides
  const overrides = stored.providerOverrides || {};
  const currentOverrides = overrides[providerId] || {};
  overrideInput.value = currentOverrides.inputSelector || "";
  overrideSubmit.value = currentOverrides.submitSelector || "";
  overrideFileInput.value = currentOverrides.fileInputSelector || "";

  // Presets
  renderPresets(stored.customPresets || [], stored.defaultPresetId || "concise");

  // General
  injectionDelay.value = stored.injectionDelay || 500;
  autoSubmit.checked = stored.autoSubmit !== false;
  charLimit.value = stored.charLimit || 10000;
}

function renderPresets(customPresets, defaultPresetId) {
  presetList.innerHTML = "";

  const allPresets = [...DEFAULT_PRESETS, ...customPresets];

  for (const preset of allPresets) {
    const item = document.createElement("div");
    item.className = "preset-item";

    const isDefault = preset.id === defaultPresetId;
    const isBuiltIn = DEFAULT_PRESETS.some(p => p.id === preset.id);

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "default-preset";
    radio.value = preset.id;
    if (isDefault) radio.checked = true;

    const nameSpan = document.createElement("span");
    nameSpan.className = "name";
    nameSpan.textContent = preset.name;

    const instrSpan = document.createElement("span");
    instrSpan.className = "instruction";
    instrSpan.textContent = preset.instruction;

    item.appendChild(radio);
    item.appendChild(nameSpan);
    item.appendChild(instrSpan);

    if (!isBuiltIn) {
      const delBtn = document.createElement("button");
      delBtn.className = "danger delete-preset";
      delBtn.dataset.id = preset.id;
      delBtn.textContent = "Delete";
      item.appendChild(delBtn);
    }

    presetList.appendChild(item);
  }

  // Delete handlers
  presetList.querySelectorAll(".delete-preset").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const stored = await browser.storage.sync.get(["customPresets"]);
      const updated = (stored.customPresets || []).filter(p => p.id !== id);
      await browser.storage.sync.set({ customPresets: updated });
      const defaultStored = await browser.storage.sync.get(["defaultPresetId"]);
      renderPresets(updated, defaultStored.defaultPresetId || "concise");
    });
  });
}

// --- Event Listeners ---

providerRadios.forEach(radio => {
  radio.addEventListener("change", () => {
    customFields.classList.toggle("hidden", radio.value !== "custom");
  });
});

toggleOverrides.addEventListener("click", () => {
  overrideFields.classList.toggle("hidden");
});

document.getElementById("add-preset").addEventListener("click", async () => {
  const name = newPresetName.value.trim();
  const instruction = newPresetInstruction.value.trim();
  if (!name || !instruction) return;

  const id = "custom-" + Date.now();
  const stored = await browser.storage.sync.get(["customPresets", "defaultPresetId"]);
  const presets = stored.customPresets || [];
  presets.push({ id, name, instruction });
  await browser.storage.sync.set({ customPresets: presets });

  newPresetName.value = "";
  newPresetInstruction.value = "";
  renderPresets(presets, stored.defaultPresetId || "concise");
});

document.getElementById("test-custom").addEventListener("click", () => {
  const url = customUrl.value.trim();
  if (url) {
    browser.tabs.create({ url: url });
  }
});

document.getElementById("save-settings").addEventListener("click", async () => {
  const selectedProvider = document.querySelector('input[name="provider"]:checked').value;
  const selectedDefaultPreset = document.querySelector('input[name="default-preset"]:checked')?.value || "concise";

  const settings = {
    activeProviderId: selectedProvider,
    defaultPresetId: selectedDefaultPreset,
    injectionDelay: parseInt(injectionDelay.value, 10) || 500,
    autoSubmit: autoSubmit.checked,
    charLimit: parseInt(charLimit.value, 10) || 10000
  };

  // Custom provider
  if (selectedProvider === "custom") {
    settings.customProvider = {
      id: "custom",
      name: "Custom",
      url: customUrl.value.trim(),
      inputSelector: customInputSelector.value.trim(),
      submitSelector: customSubmitSelector.value.trim(),
      fileInputSelector: customFileInputSelector.value.trim()
    };
  }

  // Selector overrides for built-in providers
  if (selectedProvider !== "custom") {
    const inputOverride = overrideInput.value.trim();
    const submitOverride = overrideSubmit.value.trim();
    const fileInputOverride = overrideFileInput.value.trim();
    if (inputOverride || submitOverride || fileInputOverride) {
      const stored = await browser.storage.sync.get(["providerOverrides"]);
      const overrides = stored.providerOverrides || {};
      overrides[selectedProvider] = {};
      if (inputOverride) overrides[selectedProvider].inputSelector = inputOverride;
      if (submitOverride) overrides[selectedProvider].submitSelector = submitOverride;
      if (fileInputOverride) overrides[selectedProvider].fileInputSelector = fileInputOverride;
      settings.providerOverrides = overrides;
    }
  }

  await browser.storage.sync.set(settings);

  // Notify sidebar to reload provider
  browser.runtime.sendMessage({ type: "reload-provider" });

  saveStatus.classList.remove("hidden");
  setTimeout(() => saveStatus.classList.add("hidden"), 2000);
});

loadSettings();
