/**
 * Sidebar fallback page.
 * This page is shown only when no provider is configured.
 * Normally, the background script sets the sidebar panel URL directly
 * to the LLM provider's URL via browser.sidebarAction.setPanel().
 */

document.getElementById("open-settings").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});
