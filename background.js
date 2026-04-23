// =============================================================================
// TabFolio — background.js  v2.1
// =============================================================================

const DUPE_ICON  = "⚠️ ";
const COLORS     = ["grey","blue","red","yellow","green","pink","purple","cyan","orange"];
const PAGE_OBSERVER_KEY = "__atg_v1_titleObserver__";

// Tracking / UTM parameters stripped before URL equality comparison
const TRACKING_PARAMS = new Set([
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "fbclid","gclid","msclkid","mc_cid","mc_eid","ref","source","s",
]);

// =============================================================================
// Settings helpers
// =============================================================================
const DEFAULT_SETTINGS = {
  autoGroup:       true,
  detectDupes:     true,
  sortAlpha:       true,
  excludedDomains: [],   // e.g. ["localhost", "internal.corp"]
  platformDomains: [],   // user additions; BUILTIN_PLATFORM_DOMAINS always active
};

async function getSettings() {
  return new Promise((resolve) =>
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve)
  );
}

// =============================================================================
// URL normalisation for duplicate detection
// strip fragment, known tracking params, and trailing path-slash so that
// …/page#section1 and …/page#section2 are treated as the same page, and
// UTM-tagged links match their clean counterparts.
// =============================================================================
function normalizeUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return rawUrl; }

  u.hash     = "";
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname === "/") u.pathname = "";

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort(); // canonical param order
  return u.toString();
}

// =============================================================================
// Platform domains — built-in set
//
// For these domains the *subdomain* is the meaningful product identity, so the
// subdomain label is used as the group name instead of the shared parent domain.
//
//   docs.google.com       → "docs"
//   maps.google.com       → "maps"
//   gemini.google.com     → "gemini"
//   notebooklm.google.com → "notebooklm"
//   studio.youtube.com    → "studio"
//   gist.github.com       → "gist"
//   word.office.com       → "word"
//   jira.atlassian.net    → "jira"
//   www.google.com        → "google"   (bare domain — www-stripped fallback)
//
// Users can extend this list from the popup (chrome.storage.sync platformDomains[]).
// The built-in list is always active and cannot be removed via the popup.
//
// NOTE: Keep this array in sync with BUILTIN_PLATFORM_DOMAINS in popup.js.
// =============================================================================
const BUILTIN_PLATFORM_DOMAINS = new Set([
  // Google — docs/sheets/slides/drive/maps/gemini/notebooklm/etc. each get their own group
  "google.com",
  // Microsoft / Office 365 — word/excel/powerpoint/teams each get their own group
  "microsoft.com", "office.com", "live.com",
  // Atlassian — jira/confluence/etc.
  "atlassian.net", "atlassian.com",
  // Apple
  "apple.com",
  // Adobe — creativecloud/express/etc.
  "adobe.com",
  // YouTube — studio.youtube.com → "studio"
  "youtube.com",
  // GitHub — gist.github.com → "gist", docs.github.com → "docs"
  "github.com",
  // Other common SaaS platforms with a meaningful product-per-subdomain structure
  "notion.so", "figma.com", "shopify.com", "salesforce.com",
]);

// =============================================================================
// eTLD+1 helpers
// =============================================================================
const CC_SECOND_LEVEL = new Set([
  "co","com","net","org","gov","edu","ac","or","ne",
  "ltd","plc","me","in","nhs","sch","mil","int",
]);

// Returns the registrable domain (eTLD+1) for a www-stripped, lowercased host.
//   "docs.google.com"    → "google.com"
//   "jira.atlassian.net" → "atlassian.net"
//   "news.bbc.co.uk"     → "bbc.co.uk"
//   "google.com"         → "google.com"
function getETLD1(hostname) {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;

  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];

  // ccSLD pattern: eTLD is "co.uk", so eTLD+1 spans the last 3 segments
  if (tld.length === 2 && CC_SECOND_LEVEL.has(sld)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

// Returns the tab group display title for a hostname.
//
// platformDomains — combined Set of built-in + user-added platform domains.
//
// Resolution order:
//   1. Platform domain → use the subdomain label ("docs", "gemini", "maps", …)
//      If no subdomain (bare eTLD+1), fall back to domain name ("google").
//   2. ccSLD (e.g. bbc.co.uk) → use the 3rd-from-end segment ("bbc")
//   3. Standard               → use the segment just before the TLD
//
// Examples:
//   www.google.com        → "google"      (platform, bare — www stripped, then fallback)
//   docs.google.com       → "docs"        (platform subdomain)
//   maps.google.com       → "maps"
//   gemini.google.com     → "gemini"
//   studio.youtube.com    → "studio"
//   gist.github.com       → "gist"
//   word.office.com       → "word"
//   mail.yahoo.com        → "yahoo"       (not a platform domain → standard rule)
//   bbc.co.uk             → "bbc"
//   192.168.1.1           → "192.168.1.1" (IP, verbatim)
function getGroupTitle(hostname, platformDomains = BUILTIN_PLATFORM_DOMAINS) {
  if (!hostname) return "";
  hostname = hostname.replace(/^www\./, "").toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname; // IP verbatim

  const parts = hostname.split(".");
  if (parts.length <= 1) return parts[0] || "";

  // Bare eTLD+1 after www-strip (e.g. "google.com" or "github.com")
  if (parts.length === 2) {
    return parts[0]; // "google", "github", "notion", etc.
  }

  const etld1 = getETLD1(hostname);

  // ── Platform domain: subdomain is the product identity ───────────────────
  if (platformDomains.has(etld1)) {
    // Strip ".{etld1}" from the right to get the leading subdomain(s).
    // e.g. "docs.google.com" → sub = "docs"
    //      "sub.docs.google.com" → sub = "sub.docs"  (deep nesting, kept as-is)
    const sub = hostname.slice(0, -(etld1.length + 1));
    // No subdomain (shouldn't happen at this point, but guard anyway):
    // fall back to the domain label ("google", "github", …)
    return sub || etld1.split(".")[0];
  }

  // ── ccSLD (e.g. bbc.co.uk) ───────────────────────────────────────────────
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (tld.length === 2 && CC_SECOND_LEVEL.has(sld) && parts.length >= 3) {
    return parts[parts.length - 3];
  }

  // ── Standard: segment just before the TLD ────────────────────────────────
  return sld;
}

// =============================================================================
// Debounce
// NOTE: _debounceTimers is module-level state. In MV3 the service worker may be
// suspended between events; if that happens a pending timer is lost and the next
// event fires immediately instead — at most one extra scan, never a missed one.
// Using chrome.alarms is not viable here (minimum 1-minute delay).
// =============================================================================
const _debounceTimers = new Map();

function debounce(key, fn, delayMs) {
  if (_debounceTimers.has(key)) clearTimeout(_debounceTimers.get(key));
  _debounceTimers.set(key, setTimeout(() => {
    _debounceTimers.delete(key);
    fn();
  }, delayMs));
}

// =============================================================================
// Per-window serialization queue for groupTab calls
//
// ROOT-CAUSE FIX for "many groups for the same domain after Chrome restart":
//
// When Chrome restores a session it fires onCreated for every tab in rapid
// succession.  Each handler calls groupTab(), which is async.  Because they
// all run concurrently they all reach the chrome.tabGroups.query() call
// before any of them has finished creating a group, so every one of them
// sees an empty result and creates its own brand-new group — yielding N
// separate "youtube" groups instead of one.
//
// The fix: for each window we maintain a promise chain.  Every queueGroupTab()
// call appends itself to the tail of that chain, so calls for the same window
// are executed strictly one-at-a-time.  Calls for different windows still run
// in parallel (they have independent queues).
// =============================================================================
const _windowGroupQueues = new Map(); // windowId → Promise<boolean>

function queueGroupTab(tab) {
  const key  = tab.windowId;
  const prev = _windowGroupQueues.get(key) ?? Promise.resolve(false);
  const next = prev.then(() => groupTab(tab)).catch(() => false);
  _windowGroupQueues.set(key, next);
  // Prune the entry once this item is the tail of the chain, so the map
  // doesn't grow unboundedly during a long browsing session.
  next.finally(() => {
    if (_windowGroupQueues.get(key) === next) _windowGroupQueues.delete(key);
  });
  return next;
}

// =============================================================================
// monitorTitle — injected into page context (must be self-contained)
// =============================================================================
function monitorTitle(icon, shouldHave, observerKey) {
  if (window[observerKey]) {
    window[observerKey].disconnect();
    window[observerKey] = null;
  }

  const update = () => {
    const hasIcon = document.title.startsWith(icon);
    if (shouldHave && !hasIcon) {
      document.title = icon + document.title;
    } else if (!shouldHave && hasIcon) {
      document.title = document.title.slice(icon.length);
    }
  };

  update();

  if (shouldHave) {
    const titleElem = document.querySelector("title");
    if (titleElem) {
      const observer = new MutationObserver(update);
      observer.observe(titleElem, { childList: true, subtree: true, characterData: true });
      window[observerKey] = observer;
    }
  }
}

// =============================================================================
// detectDuplicates — delta-aware
// Maintains a per-tab cache (_dupeCache) and only re-injects into tabs whose
// duplicate state actually changed, avoiding O(n) scripting on every event.
// Uses normalizeUrl() so fragments and tracking params are ignored.
// =============================================================================
const _dupeCache = new Map(); // tabId → boolean

async function detectDuplicates() {
  const settings = await getSettings();
  if (!settings.detectDupes) return;

  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  } catch (err) {
    console.warn("[TabFolio] detectDuplicates – tabs.query failed:", err);
    return;
  }

  // Lowest tab ID = oldest = original; later tabs with same URL are dupes.
  tabs.sort((a, b) => a.id - b.id);

  // Compute fresh state
  const seen     = new Set();
  const newState = new Map(); // tabId → isDuplicate
  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    newState.set(tab.id, seen.has(key));
    seen.add(key);
  }

  // Inject only into tabs whose state has changed
  const injections = [];
  for (const tab of tabs) {
    const isDupe = newState.get(tab.id) ?? false;
    if (_dupeCache.get(tab.id) === isDupe) continue;
    _dupeCache.set(tab.id, isDupe);
    if (tab.status !== "complete") continue;

    injections.push(
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func:   monitorTitle,
          args:   [DUPE_ICON, isDupe, PAGE_OBSERVER_KEY],
        })
        .catch((err) =>
          console.debug("[TabFolio] detectDuplicates – skipped tab", tab.id, err.message)
        )
    );
  }

  // Prune stale cache entries for closed tabs
  for (const id of _dupeCache.keys()) {
    if (!newState.has(id)) _dupeCache.delete(id);
  }

  await Promise.allSettled(injections);
}

// =============================================================================
// groupTab
//
// Platform-domain subdomain routing (v2.1):
//   docs.google.com   → group "docs"    (not "google")
//   maps.google.com   → group "maps"
//   gemini.google.com → group "gemini"
//   www.google.com    → group "google"  (bare domain)
//   studio.youtube.com→ group "studio"
//
// Uses getGroupTitle() (eTLD+1 + platform-domain awareness) instead of
// the naive hostname.split(".")[0] approach.
// Respects excludedDomains — both exact and subdomain matches.
// Not called for non-HTTP tabs (guard kept as safety net only).
//
// FIX (v2.2): groups are always created/updated with collapsed: false.
//   v2.1 used collapsed: !tab.active, which still hid background-opened tabs
//   (right-click "Open Link in New Tab", Ctrl+click, middle-click) inside a
//   collapsed group. The fix is unconditional expansion for both new groups
//   and existing groups that receive a new tab.
// =============================================================================
// Returns true if the tab's group assignment was changed (new group created or
// tab moved into a different group), false if the tab was already in the correct
// group or was skipped entirely.  Callers use this to avoid triggering sortGroups
// when nothing about the tab's group membership actually changed — e.g. when a
// URL change is purely within the same site (facebook.com/reel/123 → /reel/124).
async function groupTab(tab) {
  if (tab.pinned || !tab.url || !tab.url.startsWith("http")) return false;

  const settings = await getSettings();
  if (!settings.autoGroup) return false;

  let hostname;
  try { hostname = new URL(tab.url).hostname; } catch { return false; }

  // Respect exclusion list (exact or subdomain match)
  if (settings.excludedDomains.some(
    (d) => hostname === d || hostname.endsWith("." + d)
  )) return false;

  const allPlatformDomains = new Set([...BUILTIN_PLATFORM_DOMAINS, ...settings.platformDomains]);
  const title = getGroupTitle(hostname, allPlatformDomains);
  if (!title) return false;

  let existing;
  try {
    existing = await chrome.tabGroups.query({ title, windowId: tab.windowId });
  } catch (err) {
    console.warn("[TabFolio] groupTab – tabGroups.query failed:", err);
    return false;
  }

  try {
    if (existing.length > 0) {
      // Join an existing group with this title (may be a different domain's group
      // for a title collision like "docs" from google vs microsoft — acceptable).
      if (tab.groupId !== existing[0].id) {
        await chrome.tabs.group({ groupId: existing[0].id, tabIds: tab.id });
        // Always expand the group so the newly-added tab is visible — the group
        // may have been collapsed before this tab arrived (e.g. the user had
        // folded it, or the group was created for a background tab).
        await chrome.tabGroups.update(existing[0].id, { collapsed: false });
        return true;  // tab moved into a different group
      }
      return false;  // tab is already in the correct group — nothing changed
    } else {
      // Create a new group for this title.
      const groupId = await chrome.tabs.group({ tabIds: tab.id });
      // Color is keyed on the eTLD+1 (parent domain), NOT the group title.
      // This ensures every subgroup under the same parent domain always gets
      // the same color — e.g. "docs", "maps", and "gemini" are all google.com
      // tabs and therefore share one deterministic color across sessions.
      const cleanHost  = hostname.replace(/^www\./, "").toLowerCase();
      const colorKey   = getETLD1(cleanHost);           // e.g. "google.com"
      const hash       = [...colorKey].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      await chrome.tabGroups.update(groupId, {
        title,
        color:     COLORS[hash % COLORS.length],
        // Always create groups in the expanded state so the triggering tab is
        // immediately visible, regardless of how it was opened (foreground click,
        // right-click "Open in New Tab", Ctrl+click, session restore, etc.).
        // The previous `collapsed: !tab.active` heuristic hid background-opened
        // tabs inside a collapsed group — the reported bug for context-menu tabs.
        collapsed: false,
      });
      return true;  // new group created
    }
  } catch (err) {
    console.warn("[TabFolio] groupTab – failed for tab", tab.id, err);
    return false;
  }
}

// =============================================================================
// sortGroups
// Per-window lock (_sortLocks) prevents a concurrent sort from racing against
// an in-flight groupTab call on the same window.
// =============================================================================
const _sortLocks = new Set();

async function sortGroups(windowId) {
  const settings = await getSettings();
  if (!settings.sortAlpha) return;

  if (_sortLocks.has(windowId)) return;
  _sortLocks.add(windowId);

  try {
    let groups;
    try {
      groups = await chrome.tabGroups.query({ windowId });
    } catch (err) {
      console.warn("[TabFolio] sortGroups – query failed:", err);
      return;
    }

    groups.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    for (const group of groups) {
      try {
        await chrome.tabGroups.move(group.id, { index: -1 });
      } catch (err) {
        console.debug("[TabFolio] sortGroups – skipped group", group.id, err.message);
      }
    }
  } finally {
    _sortLocks.delete(windowId);
  }
}

// =============================================================================
// collapseAllGroups
// Collapses every tab group in the given window (or all windows when windowId
// is omitted).  Called both from the keyboard-shortcut command handler and,
// in the future, from the popup "Collapse all" button if one is added.
// =============================================================================
async function collapseAllGroups(windowId) {
  let groups;
  try {
    const query = windowId != null ? { windowId } : {};
    groups = await chrome.tabGroups.query(query);
  } catch (err) {
    console.warn("[TabFolio] collapseAllGroups – query failed:", err);
    return;
  }

  await Promise.allSettled(
    groups.map((g) =>
      chrome.tabGroups
        .update(g.id, { collapsed: true })
        .catch((err) =>
          console.debug("[TabFolio] collapseAllGroups – skipped group", g.id, err.message)
        )
    )
  );
}

// =============================================================================
// Keyboard shortcuts (chrome.commands)
// =============================================================================
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "collapse-all-groups") return;

  // Collapse groups only in the currently focused window so the shortcut
  // feels local — the user sees the window they are working in tidy up.
  let win;
  try {
    win = await chrome.windows.getLastFocused({ populate: false });
  } catch (err) {
    console.warn("[TabFolio] commands – getLastFocused failed:", err);
    return;
  }
  await collapseAllGroups(win.id);
});

// =============================================================================
// Context menus
// =============================================================================
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       "atg-exclude",
      title:    "TabFolio: Exclude this domain",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id:       "atg-ungroup",
      title:    "TabFolio: Remove tab from group",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id:       "atg-collapse-all",
      title:    "TabFolio: Collapse all groups",
      contexts: ["page"],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.url) return;
  let hostname;
  try { hostname = new URL(tab.url).hostname; } catch { return; }

  if (info.menuItemId === "atg-exclude") {
    const settings = await getSettings();
    const domains  = [...new Set([...settings.excludedDomains, hostname])];
    await chrome.storage.sync.set({ excludedDomains: domains });
    // Ungroup this tab immediately
    if (tab.groupId && tab.groupId !== -1) {
      try { await chrome.tabs.ungroup(tab.id); } catch { /* restricted page */ }
    }

  } else if (info.menuItemId === "atg-ungroup") {
    if (tab.groupId && tab.groupId !== -1) {
      try { await chrome.tabs.ungroup(tab.id); } catch { /* restricted page */ }
    }

  } else if (info.menuItemId === "atg-collapse-all") {
    const win = await chrome.windows.get(tab.windowId, { populate: false });
    await collapseAllGroups(win.id);
  }
});

// =============================================================================
// EVENT LISTENERS
// =============================================================================

// --- 1. New tab created ---
// Call queueGroupTab for tabs whose URL is already set at creation time
// (Ctrl+D duplicates, middle-clicked links, and session-restore tabs).
// Using the per-window queue (not bare groupTab) is critical here: Chrome
// fires onCreated for all session-restored tabs in rapid succession, so
// without serialization every tab sees an empty tabGroups.query() result
// and creates its own duplicate group.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.url?.startsWith("http")) {
    const grouped = await queueGroupTab(tab);
    if (grouped) {
      debounce(`sortGroups:${tab.windowId}`, () => sortGroups(tab.windowId), 200);
    }
  }
  debounce("detectDuplicates", detectDuplicates, 200);
});

// --- 2. Tab URL changed or load completed ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // Re-group on every navigation: a tab moving from google.com → docs.google.com
    // is correctly re-homed into the "docs" group (or out of the "google" group).
    //
    // groupTab() returns true only when the tab's group assignment actually changed
    // (tab moved to a different group, or a new group was created).  It returns
    // false when the tab is already in the correct group — e.g. a same-site URL
    // change like facebook.com/reel/123 → facebook.com/reel/124 keeps the tab in
    // the same "facebook" group and produces no change.  Gating sortGroups on this
    // return value prevents spurious group reordering for intra-site navigations.
    const grouped = await queueGroupTab(tab);
    // Only re-sort when the new URL is HTTP/S and the group membership changed.
    // Non-HTTP navigations (chrome://newtab/) don't affect group membership, and
    // triggering sortGroups for them displaces ungrouped tabs to before all groups.
    if (grouped && changeInfo.url.startsWith("http")) {
      debounce(`sortGroups:${tab.windowId}`, () => sortGroups(tab.windowId), 200);
    }
  }
  if (changeInfo.status === "complete" || changeInfo.url) {
    debounce("detectDuplicates", detectDuplicates, 200);
  }
});

// --- 3. Tab closed ---
chrome.tabs.onRemoved.addListener(() => {
  debounce("detectDuplicates", detectDuplicates, 200);
});

// --- 4. Startup tidy on install / update ---
chrome.runtime.onInstalled.addListener(async () => {
  setupContextMenus();

  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch (err) {
    console.warn("[TabFolio] onInstalled – tabs.query failed:", err);
    return;
  }

  // Filter to HTTP/HTTPS only before grouping.
  const httpTabs = tabs.filter((t) => t.url?.startsWith("http"));

  // Process tabs sequentially per window via the queue.
  // Promise.allSettled + bare groupTab() would have the same concurrent-query
  // race that causes duplicate groups during session restore — using
  // queueGroupTab serialises calls within each window while still letting
  // different windows run in parallel.
  await Promise.allSettled(httpTabs.map((t) => queueGroupTab(t)));

  const windowIds = [...new Set(tabs.map((t) => t.windowId))];
  await Promise.allSettled(windowIds.map((id) => sortGroups(id)));

  await detectDuplicates();
});

// =============================================================================
// onStartup — re-group all tabs after Chrome restarts
//
// Previously this only called setupContextMenus(), leaving all grouping to
// the onCreated burst.  The per-window queue (queueGroupTab) now prevents
// duplicate groups during that burst, but a full scan here acts as a safety
// net for any tabs whose URL wasn't set yet when onCreated fired.
//
// Timing: onStartup fires before session restore completes, so we wait a
// short grace period before scanning.  The onCreated queue handles the tabs
// that appear while we are waiting; the scan below merges any stragglers.
// =============================================================================
chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();

  // Give Chrome ~2 s to finish restoring the session, then do a full pass.
  setTimeout(async () => {
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch (err) {
      console.warn("[TabFolio] onStartup scan – tabs.query failed:", err);
      return;
    }

    const httpTabs = tabs.filter((t) => t.url?.startsWith("http"));
    // Use the same per-window queue so this scan serialises with any
    // onCreated calls that are still in-flight.
    await Promise.allSettled(httpTabs.map((t) => queueGroupTab(t)));

    const windowIds = [...new Set(tabs.map((t) => t.windowId))];
    await Promise.allSettled(windowIds.map((id) => sortGroups(id)));

    await detectDuplicates();
  }, 2000);
});
