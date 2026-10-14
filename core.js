/* Shared, dependency-free helpers for the worker and extension pages. */
var TF = (() => {
  const defaults = Object.freeze({ autoGroup: true, detectDupes: true, sortAlpha: true,
    excludedDomains: [], platformDomains: [], autoCollapse: true, autoCollapseDelay: 10,
    snapshotsEnabled: true, snapshotInterval: 60, snapshotMax: 50 });
  const colors = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
  const platforms = ["google.com", "microsoft.com", "office.com", "live.com", "atlassian.net",
    "atlassian.com", "apple.com", "adobe.com", "youtube.com", "github.com", "notion.so",
    "figma.com", "shopify.com", "salesforce.com"];
  const cc = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "ltd", "plc", "me", "in", "nhs", "sch", "mil", "int"]);
  const httpUrl = (raw) => { try { const u = new URL(raw); return ["http:", "https:"].includes(u.protocol) ? u : null; } catch { return null; } };
  function domain(host) {
    const parts = host.split(".");
    if (host.includes(":") || /^\d+(\.\d+){3}$/.test(host) || parts.length < 3) return host;
    return parts.slice(parts.at(-1).length === 2 && cc.has(parts.at(-2)) ? -3 : -2).join(".");
  }
  function route(raw, settings = defaults) {
    const u = httpUrl(raw);
    if (!u) return null;
    const host = u.hostname.replace(/^www\./, "");
    if (settings.excludedDomains.some(d => host === d || host.endsWith("." + d))) return null;
    const base = domain(host);
    const platform = [...platforms, ...settings.platformDomains].includes(base);
    const key = platform ? host : base;
    const title = platform && host !== base ? host.slice(0, -(base.length + 1))
      : base.includes(":") || /^\d+(\.\d+){3}$/.test(base) ? base : base.split(".")[0];
    return { key, title, color: colors[[...base].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % colors.length] };
  }
  // Exact parsed URLs only. Queries, their order, fragments, protocols and paths
  // may all change application state; don't discard any for destructive actions.
  function duplicateKey(raw) { return httpUrl(raw)?.href ?? null; }
  function duplicates(tabs) {
    const buckets = new Map();
    for (const tab of tabs) {
      const key = duplicateKey(tab.pendingUrl || tab.url);
      if (!key || tab.incognito) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(tab);
    }
    return [...buckets].filter(([, entries]) => entries.length > 1).map(([url, entries]) => ({ url, tabs: entries }));
  }
  function settings(input = {}) {
    const result = { ...defaults };
    for (const key of ["autoGroup", "detectDupes", "sortAlpha", "autoCollapse", "snapshotsEnabled"]) {
      if (typeof input[key] === "boolean") result[key] = input[key];
    }
    for (const [key, max] of [["autoCollapseDelay", 60], ["snapshotInterval", 1440], ["snapshotMax", 200]]) {
      const n = Number(input[key]);
      if (Number.isFinite(n) && n >= 1) result[key] = Math.min(max, Math.floor(n));
    }
    for (const key of ["excludedDomains", "platformDomains"]) {
      if (Array.isArray(input[key])) result[key] = [...new Set(input[key].map(parseDomain).filter(Boolean))].slice(0, 100);
    }
    return result;
  }
  function parseDomain(raw) {
    if (typeof raw !== "string" || /\s/.test(raw.trim()) || !raw.trim()) return null;
    const u = httpUrl(raw.includes("://") ? raw.trim() : "https://" + raw.trim());
    return u && !u.username && !u.password ? u.hostname.replace(/^www\./, "") : null;
  }
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  const id = () => crypto.randomUUID();
  function normalizeSnapshot(raw) {
    if (!raw || typeof raw !== "object") throw Error("Invalid snapshot.");
    if (raw.version != null && raw.version !== 2) throw Error("Unsupported snapshot version.");
    let windows = raw.windows;
    // Legacy snapshots contain groups only. Recover their original window boundaries.
    if (!windows && Array.isArray(raw.groups) && raw.version == null) {
      const map = new Map();
      for (const [i, group] of raw.groups.entries()) {
        if (!group || !Array.isArray(group.tabs)) throw Error("Invalid legacy group.");
        const key = String(group.windowId ?? 0);
        if (!map.has(key)) map.set(key, { groups: [], tabs: [] });
        const win = map.get(key);
        const groupKey = "legacy-" + i;
        win.groups.push({ ...group, key: groupKey });
        win.tabs.push(...group.tabs.map(tab => ({ ...tab, groupKey, pinned: false, active: false })));
      }
      windows = [...map.values()];
    }
    if (!Array.isArray(windows) || !windows.length || windows.length > 100) throw Error("Snapshot must contain 1–100 windows.");
    let tabCount = 0;
    const clean = windows.map(win => {
      if (!win || !Array.isArray(win.groups) || !Array.isArray(win.tabs)) throw Error("Invalid window layout.");
      const keys = new Set();
      const groups = win.groups.map(g => {
        if (!g || typeof g.key !== "string" || !g.key || g.key.length > 100 || keys.has(g.key)) throw Error("Invalid or duplicate group key.");
        keys.add(g.key);
        return { key: g.key, title: String(g.title ?? "").slice(0, 200), color: colors.includes(g.color) ? g.color : "grey", collapsed: !!g.collapsed, keepExpanded: !!g.keepExpanded };
      });
      const tabs = win.tabs.map(t => {
        if (!t || typeof t.url !== "string" || t.url.length > 32768) throw Error("Invalid tab URL.");
        try { new URL(t.url); } catch { throw Error("Invalid tab URL."); }
        const groupKey = t.groupKey == null ? null : t.groupKey;
        if (groupKey !== null && !keys.has(groupKey)) throw Error("A tab references a missing group.");
        if (t.pinned && groupKey !== null) throw Error("Pinned tabs cannot belong to groups.");
        if (++tabCount > 5000) throw Error("A snapshot can contain at most 5,000 tabs.");
        return { url: t.url, title: String(t.title ?? "").slice(0, 1000), pinned: !!t.pinned, active: !!t.active, groupKey };
      });
      // Chrome requires pinned tabs first and group members to be contiguous.
      let unpinned = false;
      const finished = new Set(); let previous = null;
      for (const tab of tabs) {
        if (tab.pinned && unpinned) throw Error("Pinned tabs must come first.");
        unpinned ||= !tab.pinned;
        if (tab.groupKey !== previous) {
          if (previous !== null) finished.add(previous);
          if (tab.groupKey !== null && finished.has(tab.groupKey)) throw Error("Group tabs must be consecutive.");
          previous = tab.groupKey;
        }
      }
      if (tabs.filter(t => t.active).length > 1) throw Error("Only one tab per window can be active.");
      return { groups, tabs, focused: !!win.focused };
    });
    if (!tabCount) throw Error("Snapshot contains no tabs.");
    return { version: 2, id: String(raw.id ?? id()).slice(0, 100), name: String(raw.name ?? "Imported snapshot").slice(0, 200),
      timestamp: Number.isFinite(raw.timestamp) && raw.timestamp >= 0 ? raw.timestamp : Date.now(), windows: clean };
  }
  function parseImport(input) {
    if (bytes(input) > 8 * 1024 * 1024) throw Error("Import exceeds the 8 MB limit.");
    if (input?.format && (input.format !== "tabfolio" || input.version !== 2)) throw Error("Unsupported export format.");
    const list = Array.isArray(input) ? input : input?.snapshots;
    if (!Array.isArray(list) || !list.length || list.length > 200) throw Error("Choose a file containing 1–200 snapshots.");
    const snapshots = list.map(normalizeSnapshot);
    if (new Set(snapshots.map(s => s.id)).size !== snapshots.length) throw Error("Duplicate snapshot IDs in import.");
    return snapshots;
  }
  return { defaults, colors, platforms, route, duplicateKey, duplicates, settings, parseDomain, bytes, id, normalizeSnapshot, parseImport, httpUrl };
})();
if (typeof module !== "undefined") module.exports = TF;
