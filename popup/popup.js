const providerSelect = document.getElementById("provider-select");
const presetSelect = document.getElementById("preset-select");
const installLatestButton = document.getElementById("install-latest");

const RELEASES_API_URL =
  "https://api.github.com/repos/unknownbreaker/firefox-ai-summarizer/releases/latest";
// Stable-named asset attached to every release (see release.sh) so this
// permalink always points at the newest .xpi. Opening it in a tab triggers
// Firefox's install prompt.
const LATEST_XPI_URL =
  "https://github.com/unknownbreaker/firefox-ai-summarizer/releases/latest/download/ai-summarizer.xpi";

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

installLatestButton.addEventListener("click", () => {
  // Opening the .xpi URL in a tab triggers Firefox's install prompt.
  browser.tabs.create({ url: LATEST_XPI_URL });
  window.close();
});

// --- Update Check ---

/**
 * Check the newest GitHub release on every popup open and reflect it in the
 * install button: enabled when the latest version differs from the installed
 * one, disabled when they match (or the check fails — offline, rate-limited).
 *
 * The result is cached in storage.local for 15 minutes so rapid re-opens
 * don't re-hit the API (unauthenticated GitHub API allows 60 requests/hour
 * per IP) and the button state renders instantly.
 */
const UPDATE_CHECK_CACHE_MS = 15 * 60 * 1000;

async function checkLatestRelease() {
  const currentVersion = browser.runtime.getManifest().version;

  let latestVersion = null;
  try {
    const cached = await browser.storage.local.get(["updateCheck"]);
    if (cached.updateCheck && Date.now() - cached.updateCheck.checkedAt < UPDATE_CHECK_CACHE_MS) {
      latestVersion = cached.updateCheck.latestVersion;
    } else {
      const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: "application/vnd.github+json" }
      });
      if (!response.ok) throw new Error("release check failed: " + response.status);
      const release = await response.json();
      latestVersion = (release.tag_name || "").replace(/^v/, "");
      if (!latestVersion) throw new Error("no tag_name in latest release");
      await browser.storage.local.set({
        updateCheck: { latestVersion, checkedAt: Date.now() }
      });
    }
  } catch (_) {
    installLatestButton.disabled = true;
    installLatestButton.textContent = "Install latest release";
    installLatestButton.title = "Could not check the latest release. Try again later.";
    return;
  }

  if (latestVersion === currentVersion) {
    installLatestButton.disabled = true;
    installLatestButton.textContent = `Up to date (v${currentVersion})`;
    installLatestButton.title = "You already have the latest release installed.";
  } else {
    installLatestButton.disabled = false;
    installLatestButton.textContent = `Install latest release (v${latestVersion})`;
    installLatestButton.title = `Installed: v${currentVersion} — opens the newest .xpi from GitHub.`;
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
