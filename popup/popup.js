const providerSelect = document.getElementById("provider-select");
const presetSelect = document.getElementById("preset-select");
const installLatestButton = document.getElementById("install-latest");

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

installLatestButton.addEventListener("click", async () => {
  // Fetch the .xpi via the downloads API. Navigating a tab to it does NOT
  // work: GitHub serves .xpi as inline application/x-xpinstall, which Firefox
  // treats as a website install attempt and silently blocks for
  // extension-opened tabs (blank page, no download, no prompt).
  installLatestButton.disabled = true;
  installLatestButton.textContent = "Downloading…";
  try {
    await browser.downloads.download({
      url: LATEST_XPI_URL,
      filename: "ai-summarizer.xpi"
    });
    installLatestButton.textContent = "Downloaded — open it from the Downloads panel to install";
  } catch (_) {
    // Download refused (e.g. user cancelled the save dialog) — fall back to
    // the release page, where a real click can fetch the asset.
    browser.tabs.create({ url: RELEASES_PAGE_URL });
    window.close();
  }
});

// --- Update Check ---

/**
 * Check the newest GitHub release on every popup open (via the shared
 * lib/update-check.js, 15-min cache) and reflect it in the install button:
 * enabled when the latest version differs from the installed one, disabled
 * when they match (or the check fails — offline, rate-limited).
 */
async function checkLatestRelease() {
  const currentVersion = browser.runtime.getManifest().version;

  let latestVersion = null;
  try {
    latestVersion = await getLatestVersion();
  } catch (_) {
    installLatestButton.disabled = true;
    installLatestButton.textContent = "Install latest release";
    installLatestButton.title = "Could not check the latest release. Try again later.";
    return;
  }

  // Keep the toolbar badge consistent with what the button shows — the
  // storage.onChanged signal alone can't do this when the check was served
  // from a fresh cache (no write happens, so the background never hears it).
  syncUpdateBadge(latestVersion);

  if (latestVersion === currentVersion) {
    installLatestButton.disabled = true;
    installLatestButton.textContent = `Up to date (v${currentVersion})`;
    installLatestButton.title = "You already have the latest release installed.";
  } else {
    installLatestButton.disabled = false;
    installLatestButton.textContent = `Install latest release (v${latestVersion})`;
    installLatestButton.title = `Installed: v${currentVersion} — downloads the newest .xpi from GitHub.`;
  }
}

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
checkLatestRelease();
