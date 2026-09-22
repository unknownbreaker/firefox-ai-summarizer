/**
 * Nav-hider content script.
 *
 * The LLM providers ship a conversation rail down the left of their web UI.
 * That rail is fine in a full browser tab but eats a large share of the narrow
 * Firefox sidebar, so hide it *in the sidebar only* and give the width back to
 * the conversation.
 *
 * Runs at document_start (injector.js runs at document_idle): CSS applied after
 * first paint would show the rail and then yank it away, a visible flash on
 * every summarize.
 *
 * Inert in regular browsing tabs. The content_scripts matches cover whole LLM
 * domains, so this also loads when you browse claude.ai normally — it must not
 * restyle those pages. The `_t` sidebar marker is the gate, same as injector.js
 * (Critical Invariant 7 in CLAUDE.md).
 *
 * NOTE: every top-level name here is `navHider`-prefixed on purpose. Firefox
 * runs all of an extension's content scripts for a document in ONE shared
 * sandbox global, so a bare `isSidebarPanel` here would collide with the const
 * of that name in injector.js and throw a redeclaration SyntaxError — breaking
 * prompt injection, not just this file.
 */

const NAV_HIDER_STYLE_ID = "ai-summarizer-nav-hider";

// ChatGPT serves the same UI from two hostnames.
const NAV_HIDER_CHATGPT_CSS = `
  /* ChatGPT: conversation rail. Verified against the live DOM 2026-09-19 —
     it is an <aside aria-label="Sidebar"> wrapping a <nav> with the same
     label. The id and "Chat history" label below matched nothing in that
     check; they are kept as inert fallbacks in case the signed-in UI or a
     future build uses them. */
  aside[aria-label="Sidebar" i],
  nav[aria-label="Sidebar" i],
  #stage-slideover-sidebar,
  nav[aria-label="Chat history" i] { display: none !important; }
`;

/**
 * Per-host CSS. Keyed by hostname rather than by the active provider id: this
 * script needs its answer synchronously at document_start, before any async
 * storage read could tell it which provider is configured, and the host of the
 * page it is running in is the ground truth anyway.
 *
 * Selectors lean on element names, ids, roles and ARIA labels rather than
 * hashed utility classes, which churn on every provider reskin. Listing several
 * candidates per host costs nothing — a selector that matches nothing is inert.
 */
const NAV_HIDER_RULES = {
  "claude.ai": `
    /* Claude: conversation rail and its pin/collapse affordance.
       CONFIRMED in the live sidebar 2026-09-22 — the rail is a single
       <aside aria-label="Sidebar">, mirroring ChatGPT's shape exactly. The
       other three below matched ZERO elements there and are kept only as
       inert fallbacks for other builds; the two data-testids in particular
       were blind guesses that have never matched anything. */
    aside[aria-label="Sidebar" i],
    nav[aria-label="Sidebar" i],
    [data-testid="menu-sidebar"],
    [data-testid="pin-sidebar-button"] { display: none !important; }
  `,
  "chatgpt.com": NAV_HIDER_CHATGPT_CSS,
  "chat.openai.com": NAV_HIDER_CHATGPT_CSS,
  "gemini.google.com": `
    /* Gemini: the Angular sidenav. Verified against the live DOM 2026-09-19 —
       <bard-sidenav role="navigation" aria-label="Side Navigation">, 288px at
       the left edge. The [role="navigation"] fallback was checked for
       over-reach: all four of its matches sit INSIDE bard-sidenav, so it
       cannot hide anything outside the rail.

       Hidden, NOT removed — the injector clicks the "New chat" control that
       lives inside it (see startNewChat in injector.js). display:none keeps
       the node in the DOM and .click() still fires on it; removing it would
       silently break fresh-conversation forcing. Covered by
       test/nav-hider.test.html. */
    bard-sidenav,
    bard-sidenav-container [role="navigation"] { display: none !important; }
  `
};

/**
 * Resolve the rule set for a hostname, or null if the host isn't one we style.
 * Matches subdomains too, so a provider moving to app.<host> keeps working.
 */
function navHiderCssForHost(hostname) {
  if (typeof hostname !== "string") return null;

  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (NAV_HIDER_RULES[host]) return NAV_HIDER_RULES[host];

  for (const knownHost of Object.keys(NAV_HIDER_RULES)) {
    if (host.endsWith("." + knownHost)) return NAV_HIDER_RULES[knownHost];
  }
  return null;
}

/**
 * Is this document the extension's sidebar panel?
 *
 * Unlike injector.js, which reads the navigation timing entry because it runs
 * at document_idle (by which point an SPA router may have rewritten the URL via
 * replaceState), this runs at document_start — before any page script has had a
 * chance to route — so window.location is still the URL setPanel() asked for.
 */
function navHiderIsSidebarPanel() {
  try {
    return new URLSearchParams(window.location.search).has("_t");
  } catch (_) {
    return false;
  }
}

function navHiderApply(css) {
  if (document.getElementById(NAV_HIDER_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = NAV_HIDER_STYLE_ID;
  style.textContent = css;
  // <head> does not exist yet at document_start; documentElement always does.
  document.documentElement.appendChild(style);
}

function navHiderRemove() {
  const style = document.getElementById(NAV_HIDER_STYLE_ID);
  if (style) style.remove();
}

/**
 * Log which selectors actually matched, once the provider's UI has rendered.
 *
 * Selector rot is the failure mode for this feature, and it fails *silently* —
 * the rail just stays visible. Firefox hides console.debug behind the Debug
 * level, so this is quiet day to day but available when checking a provider
 * reskin without rebuilding the extension.
 */
function navHiderLogMatches(css) {
  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map(block => block.split("{")[0])
    .join(",")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const matches = selectors.map(selector => {
    try {
      return `${selector} → ${document.querySelectorAll(selector).length}`;
    } catch (_) {
      return `${selector} → invalid`;
    }
  });
  console.debug("[AI Summarizer] nav-hider matches:", matches.join(" | "));
}

/**
 * TEMPORARY DIAGNOSTIC (2026-09-22).
 *
 * Hiding the rail works, but the conversation does not expand into the freed
 * space — something still reserves that column. This dumps the composer's
 * ancestor chain so the offending rule (a grid track, a left margin, a
 * max-width) can be named rather than guessed at. Runs in the real sidebar, so
 * no Browser Toolbox is needed: read it in the Browser Console (Cmd+Shift+J)
 * with "Show Content Messages" on and the Debug level enabled.
 *
 * Remove once the space-reclaiming rules land.
 */
function navHiderLogLayout() {
  const composer = document.querySelector(
    "div.ProseMirror[contenteditable='true'], " +
    "div.ql-editor[contenteditable='true'], " +
    "#prompt-textarea"
  );
  if (!composer) {
    console.debug("[AI Summarizer] nav-hider layout: composer not found");
    return;
  }

  const chain = [{ viewport: window.innerWidth }];
  let node = composer;
  for (let i = 1; node && node !== document.documentElement && i <= 10; i++) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    chain.push({
      i,
      tag: node.tagName.toLowerCase(),
      cls: String(node.className || "").slice(0, 70),
      display: style.display,
      gridCols: style.gridTemplateColumns,
      width: Math.round(rect.width),
      left: Math.round(rect.left),
      marginLeft: style.marginLeft,
      paddingLeft: style.paddingLeft,
      maxWidth: style.maxWidth,
      position: style.position
    });
    node = node.parentElement;
  }
  console.debug("[AI Summarizer] nav-hider layout:", JSON.stringify(chain));
}

if (navHiderIsSidebarPanel()) {
  const navHiderCss = navHiderCssForHost(window.location.hostname);

  if (navHiderCss) {
    // Apply first, ask later. Hiding is the default, so applying synchronously
    // and undoing it for the minority who opted out keeps the common path
    // flash-free — an async storage read before the first paint cannot be.
    navHiderApply(navHiderCss);

    browser.storage.sync.get(["hideProviderNav"]).then(stored => {
      if (stored.hideProviderNav === false) navHiderRemove();
    }).catch(() => {
      // Storage unavailable — keep the default (hidden).
    });

    // Apply the toggle without needing a sidebar reload.
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes.hideProviderNav) return;
      if (changes.hideProviderNav.newValue === false) {
        navHiderRemove();
      } else {
        navHiderApply(navHiderCss);
      }
    });

    window.addEventListener("load", () => {
      setTimeout(() => {
        navHiderLogMatches(navHiderCss);
        navHiderLogLayout();
      }, 1000);
    });
  }
}
