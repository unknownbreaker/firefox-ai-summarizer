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

// Stable-named asset attached to every release (see release.sh) so this
// permalink always points at the newest .xpi. Must be fetched via the
// downloads API — GitHub serves .xpi as inline application/x-xpinstall, which
// Firefox treats as a website install attempt and silently blocks in
// extension-opened tabs (blank page, no download).
const LATEST_XPI_URL =
  "https://github.com/unknownbreaker/firefox-ai-summarizer/releases/latest/download/ai-summarizer.xpi";

// Human-readable release page — fallback destination when the download fails.
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
