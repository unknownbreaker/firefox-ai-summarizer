/**
 * Shared GitHub release check, used by both the background script (toolbar
 * badge) and the popup (install button).
 *
 * Results are cached in storage.local for 15 minutes so the two callers and
 * rapid popup re-opens share one fetch (unauthenticated GitHub API allows 60
 * requests/hour per IP). The cache write fires storage.onChanged, which the
 * background uses to refresh the badge whenever the popup fetches.
 */

const RELEASES_API_URL =
  "https://api.github.com/repos/unknownbreaker/firefox-ai-summarizer/releases/latest";

// Human-readable release page. The install button opens THIS, not the .xpi
// asset directly: a user-gesture click on the page is the only install path
// Firefox fully supports for self-hosted extensions (doorhanger → install
// prompt). See the install-button comment in popup.js for the dead ends.
const RELEASES_PAGE_URL =
  "https://github.com/unknownbreaker/firefox-ai-summarizer/releases/latest";

const UPDATE_CHECK_CACHE_MS = 15 * 60 * 1000;

/**
 * Resolve the newest released version ("0.5.0"-style, no leading v),
 * from cache when fresh, otherwise from the GitHub API.
 * Throws on network failure or an unparseable release.
 */
async function getLatestVersion() {
  const cached = await browser.storage.local.get(["updateCheck"]);
  if (cached.updateCheck && Date.now() - cached.updateCheck.checkedAt < UPDATE_CHECK_CACHE_MS) {
    return cached.updateCheck.latestVersion;
  }

  const response = await fetch(RELEASES_API_URL, {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error("release check failed: " + response.status);

  const release = await response.json();
  const latestVersion = (release.tag_name || "").replace(/^v/, "");
  if (!latestVersion) throw new Error("no tag_name in latest release");

  await browser.storage.local.set({
    updateCheck: { latestVersion, checkedAt: Date.now() }
  });
  return latestVersion;
}

/**
 * Set the toolbar badge from a known latest version: "NEW" when it differs
 * from the installed version, cleared when they match.
 *
 * Callable from BOTH the background and the popup (extension pages share the
 * browserAction API). The popup must call this after every check so the badge
 * can never disagree with the button it just rendered — the storage.onChanged
 * signal alone isn't enough, because a popup check served from a fresh cache
 * writes nothing and would leave a stale badge uncorrected.
 */
function syncUpdateBadge(latestVersion) {
  const updateAvailable = latestVersion !== browser.runtime.getManifest().version;
  browser.browserAction.setBadgeText({ text: updateAvailable ? "NEW" : "" });
  if (updateAvailable) {
    browser.browserAction.setBadgeBackgroundColor({ color: "#0060df" });
  }
}
