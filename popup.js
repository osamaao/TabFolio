// popup.js  v2.1

// Must stay in sync with BUILTIN_PLATFORM_DOMAINS in background.js.
// These are the domains where the *subdomain* is used as the group name:
//   docs.google.com  → "docs",  maps.google.com → "maps",  gemini.google.com → "gemini"
//   studio.youtube.com → "studio",  gist.github.com → "gist"
//   word.office.com  → "word",  jira.atlassian.net → "jira"
const BUILTIN_PLATFORM_DOMAINS = [
  // Google — every product subdomain becomes its own group
  "google.com",
  // Microsoft / Office 365
  "microsoft.com", "office.com", "live.com",
  // Atlassian
  "atlassian.net", "atlassian.com",
  // Apple
  "apple.com",
  // Adobe
  "adobe.com",
  // YouTube
  "youtube.com",
  // GitHub
  "github.com",
  // Other SaaS
  "notion.so", "figma.com", "shopify.com", "salesforce.com",
];

const DEFAULT_SETTINGS = {
  autoGroup:       true,
  detectDupes:     true,
  sortAlpha:       true,
  excludedDomains: [],
  platformDomains: [],
};

// ── Storage helpers ──────────────────────────────────────────────────────────

function loadSettings() {
  return new Promise((resolve) =>
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve)
  );
}

function savePatch(patch) {
  chrome.storage.sync.set(patch);
}

// ── Built-in platform domain chips ───────────────────────────────────────────

function renderBuiltinChips() {
  const row = document.getElementById("builtinChips");
  row.innerHTML = "";
  for (const domain of BUILTIN_PLATFORM_DOMAINS) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = domain;
    row.appendChild(chip);
  }
}

// ── Custom platform domain list ───────────────────────────────────────────────

function renderPlatformDomains(domains) {
  const list = document.getElementById("platformList");
  list.innerHTML = "";

  if (domains.length === 0) {
    list.innerHTML = '<span class="empty-hint">No custom platform domains</span>';
    return;
  }

  for (const domain of domains) {
    const item = document.createElement("div");
    item.className = "domain-item";

    const name = document.createElement("span");
    name.className = "domain-name";
    name.textContent = domain;

    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.title = `Remove ${domain}`;
    btn.textContent = "✕";
    btn.addEventListener("click", async () => {
      const s       = await loadSettings();
      const updated = s.platformDomains.filter((d) => d !== domain);
      savePatch({ platformDomains: updated });
      renderPlatformDomains(updated);
    });

    item.append(name, btn);
    list.appendChild(item);
  }
}

async function addPlatformDomain() {
  const input  = document.getElementById("platformInput");
  const domain = parseDomainInput(input.value);

  if (!domain || domain.includes(" ") || !domain.includes(".")) {
    input.style.borderColor = "var(--danger)";
    setTimeout(() => (input.style.borderColor = ""), 800);
    return;
  }

  // Disallow adding a domain that's already in the built-in list
  if (BUILTIN_PLATFORM_DOMAINS.includes(domain)) {
    input.style.borderColor = "var(--accent)";
    setTimeout(() => (input.style.borderColor = ""), 800);
    input.value = "";
    return;
  }

  const s       = await loadSettings();
  const updated = [...new Set([...s.platformDomains, domain])];
  savePatch({ platformDomains: updated });
  renderPlatformDomains(updated);
  input.value = "";
  input.focus();
}

// ── Domain list rendering ────────────────────────────────────────────────────

function renderDomains(domains) {
  const list = document.getElementById("domainList");
  list.innerHTML = "";

  if (domains.length === 0) {
    list.innerHTML = '<span class="empty-hint">No excluded domains</span>';
    return;
  }

  for (const domain of domains) {
    const item = document.createElement("div");
    item.className = "domain-item";

    const name = document.createElement("span");
    name.className = "domain-name";
    name.textContent = domain;

    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.title = `Remove ${domain}`;
    btn.textContent = "✕";
    btn.addEventListener("click", async () => {
      const s = await loadSettings();
      const updated = s.excludedDomains.filter((d) => d !== domain);
      savePatch({ excludedDomains: updated });
      renderDomains(updated);
    });

    item.append(name, btn);
    list.appendChild(item);
  }
}

// ── Domain input ─────────────────────────────────────────────────────────────

function parseDomainInput(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")  // strip scheme
    .replace(/\/.*$/, "")         // strip path
    .replace(/:\d+$/, "");        // strip port
}

async function addDomain() {
  const input  = document.getElementById("domainInput");
  const domain = parseDomainInput(input.value);

  if (!domain || domain.includes(" ") || !domain.includes(".")) {
    input.style.borderColor = "var(--danger)";
    setTimeout(() => (input.style.borderColor = ""), 800);
    return;
  }

  const s       = await loadSettings();
  const updated = [...new Set([...s.excludedDomains, domain])];
  savePatch({ excludedDomains: updated });
  renderDomains(updated);
  input.value = "";
  input.focus();
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await loadSettings();

  // Restore toggles
  const TOGGLES = ["autoGroup", "detectDupes", "sortAlpha"];
  for (const key of TOGGLES) {
    const el = document.getElementById(key);
    el.checked = settings[key];
    el.addEventListener("change", (e) => savePatch({ [key]: e.target.checked }));
  }

  // ── Keyboard shortcut display ─────────────────────────────────────────────
  // Read the live binding so the displayed keys stay correct after the user
  // remaps the shortcut via chrome://extensions/shortcuts.
  try {
    const cmds = await chrome.commands.getAll();
    const cmd  = cmds.find((c) => c.name === "collapse-all-groups");
    if (cmd?.shortcut) {
      const display = document.getElementById("shortcutDisplay");
      // Render each token (e.g. "Alt", "Shift", "C") as its own <kbd>
      const parts = cmd.shortcut.split("+");
      display.innerHTML = parts
        .map((p, i) =>
          i < parts.length - 1
            ? `<kbd>${p}</kbd><span class="kbd-sep">+</span>`
            : `<kbd>${p}</kbd>`
        )
        .join("");
    }
  } catch { /* commands API not available — default HTML stays */ }

  // chrome://extensions/shortcuts can't be opened via window.open, but
  // clicking the link copies it for the user (best we can do in a popup).
  document.getElementById("shortcutLink").addEventListener("click", (e) => {
    e.preventDefault();
    navigator.clipboard?.writeText("chrome://extensions/shortcuts").catch(() => {});
  });

  // Render platform domains
  renderBuiltinChips();
  renderPlatformDomains(settings.platformDomains);
  document.getElementById("addPlatformBtn").addEventListener("click", addPlatformDomain);
  document.getElementById("platformInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPlatformDomain();
  });

  // Render exclusion list
  renderDomains(settings.excludedDomains);

  // Add-domain button and Enter key
  document.getElementById("addBtn").addEventListener("click", addDomain);
  document.getElementById("domainInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addDomain();
  });
});
