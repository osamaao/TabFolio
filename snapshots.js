// snapshots.js — TabFolio Snapshot Manager

const DEFAULT_SETTINGS = {
  snapshotsEnabled:  true,
  snapshotInterval:  60,
  snapshotMax:       50,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadSettings() {
  return new Promise((resolve) =>
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve)
  );
}

function loadSnapshots() {
  return new Promise((resolve) =>
    chrome.storage.local.get({ snapshots: [] }, (r) => resolve(r.snapshots))
  );
}

function saveSnapshots(snapshots) {
  return chrome.storage.local.set({ snapshots });
}

// Relative time string: "just now", "3 min ago", "2 h ago", "Apr 21"
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3_600_000);
  const day  = Math.floor(diff / 86_400_000);
  if (diff < 60_000)   return "just now";
  if (min  < 60)       return `${min} min ago`;
  if (hr   < 24)       return `${hr} h ago`;
  if (day  < 7)        return `${day} day${day > 1 ? "s" : ""} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function absoluteTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(text, type = "success") {
  const el       = document.getElementById("toast");
  const textEl   = document.getElementById("toastText");
  textEl.textContent = text;
  el.className   = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 3000);
}

// ── Sidebar stats ─────────────────────────────────────────────────────────────

function updateSidebar(snapshots, settings) {
  const count      = snapshots.length;
  const totalGroups = snapshots.reduce((n, s) => n + s.groups.length, 0);
  const totalTabs   = snapshots.reduce((n, s) =>
    n + s.groups.reduce((m, g) => m + g.tabs.length, 0), 0);

  document.getElementById("statCount").textContent  = count;
  document.getElementById("statGroups").textContent = totalGroups;
  document.getElementById("statTabs").textContent   = totalTabs;
  document.getElementById("statLatest").textContent =
    count > 0 ? relativeTime(snapshots[0].timestamp) : "–";

  const max = settings.snapshotMax ?? 50;
  const pct = count > 0 ? Math.round((count / max) * 100) : 0;
  document.getElementById("bufferFill").style.width = `${Math.min(100, pct)}%`;
  document.getElementById("bufferUsed").textContent = `${count} used`;
  document.getElementById("bufferMax").textContent  = `/ ${max} max`;

  document.getElementById("sEnabled").textContent  =
    settings.snapshotsEnabled ? "on" : "off";
  document.getElementById("sInterval").textContent =
    `${settings.snapshotInterval ?? 60} min`;
  document.getElementById("sMax").textContent      =
    String(settings.snapshotMax ?? 50);
}

// ── Group color CSS class ─────────────────────────────────────────────────────

const COLOR_CLASS = {
  grey: "gc-grey", blue: "gc-blue", red: "gc-red", yellow: "gc-yellow",
  green: "gc-green", pink: "gc-pink", purple: "gc-purple",
  cyan: "gc-cyan", orange: "gc-orange",
};

// ── Card renderer ─────────────────────────────────────────────────────────────

function renderCard(snapshot, index, onDelete, onRestore) {
  const totalTabs = snapshot.groups.reduce((n, g) => n + g.tabs.length, 0);

  const card = document.createElement("div");
  card.className = "snapshot-card";
  card.dataset.id = String(snapshot.id);

  // ── Header ──
  const header = document.createElement("div");
  header.className = "card-header";
  header.innerHTML = `
    <span class="card-index">#${index + 1}</span>
    <div class="card-meta">
      <div class="card-name" title="${snapshot.name}">${snapshot.name}</div>
      <div class="card-time" title="${absoluteTime(snapshot.timestamp)}">${absoluteTime(snapshot.timestamp)}</div>
    </div>
    <div class="card-chips">
      <span class="chip chip-groups">${snapshot.groups.length} group${snapshot.groups.length !== 1 ? "s" : ""}</span>
      <span class="chip chip-tabs">${totalTabs} tab${totalTabs !== 1 ? "s" : ""}</span>
    </div>
    <div class="card-actions">
      <button class="card-btn card-btn-restore" title="Restore into new window">↗ Restore</button>
      <button class="card-btn card-btn-delete" title="Delete snapshot">✕</button>
    </div>
    <span class="card-chevron">▶</span>
  `;

  // Toggle expand
  header.addEventListener("click", (e) => {
    if (e.target.closest(".card-btn")) return;
    card.classList.toggle("open");
  });

  // Restore
  header.querySelector(".card-btn-restore").addEventListener("click", () => onRestore(snapshot, card));

  // Delete
  header.querySelector(".card-btn-delete").addEventListener("click", () => onDelete(snapshot.id));

  // ── Body ──
  const body = document.createElement("div");
  body.className = "card-body";

  const groupList = document.createElement("div");
  groupList.className = "group-list";

  for (const group of snapshot.groups) {
    const row = document.createElement("div");
    row.className = "group-row";

    const dot = document.createElement("div");
    dot.className = `group-color-dot ${COLOR_CLASS[group.color] ?? "gc-grey"}`;

    const info = document.createElement("div");
    info.className = "group-info";

    const titleRow = document.createElement("div");
    titleRow.className = "group-title";
    titleRow.textContent = group.title || "(untitled)";
    if (group.collapsed) {
      const badge = document.createElement("span");
      badge.className = "group-collapsed-badge";
      badge.textContent = "collapsed";
      titleRow.appendChild(badge);
    }

    const tabsEl = document.createElement("div");
    tabsEl.className = "group-tabs";

    for (const tab of group.tabs) {
      const tabRow = document.createElement("div");
      tabRow.className = "group-tab-row";

      if (tab.favIconUrl && tab.favIconUrl.startsWith("http")) {
        const img = document.createElement("img");
        img.className = "tab-favicon";
        img.src = tab.favIconUrl;
        img.onerror = () => { img.replaceWith(makeFaviconPlaceholder()); };
        tabRow.appendChild(img);
      } else {
        tabRow.appendChild(makeFaviconPlaceholder());
      }

      const titleEl = document.createElement("span");
      titleEl.className = "tab-title";
      titleEl.textContent = tab.title || tab.url;
      titleEl.title = tab.title;

      const urlEl = document.createElement("span");
      urlEl.className = "tab-url";
      try {
        urlEl.textContent = new URL(tab.url).hostname;
      } catch {
        urlEl.textContent = tab.url;
      }
      urlEl.title = tab.url;

      tabRow.append(titleEl, urlEl);
      tabsEl.appendChild(tabRow);
    }

    info.append(titleRow, tabsEl);
    row.append(dot, info);
    groupList.appendChild(row);
  }

  body.appendChild(groupList);
  card.append(header, body);
  return card;
}

function makeFaviconPlaceholder() {
  const d = document.createElement("div");
  d.className = "tab-favicon-placeholder";
  return d;
}

// ── Main render ───────────────────────────────────────────────────────────────

let _snapshots = [];
let _settings  = { ...DEFAULT_SETTINGS };

function render() {
  const main = document.getElementById("main");
  main.innerHTML = "";

  updateSidebar(_snapshots, _settings);

  if (_snapshots.length === 0) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◈</div>
        <div class="empty-title">No snapshots yet</div>
        <div class="empty-hint">
          Click <strong>Take snapshot</strong> to capture the current state of all tab groups,
          or wait for the auto-capture alarm to fire (every ${_settings.snapshotInterval ?? 60} min).
        </div>
      </div>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "snapshot-list";

  _snapshots.forEach((snap, i) => {
    const card = renderCard(snap, i, deleteSnapshot, restoreSnapshot);
    list.appendChild(card);
  });

  main.appendChild(list);
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function deleteSnapshot(id) {
  _snapshots = _snapshots.filter((s) => s.id !== id);
  await saveSnapshots(_snapshots);

  // Animate removal
  const card = document.querySelector(`.snapshot-card[data-id="${id}"]`);
  if (card) {
    card.style.transition = "opacity 0.15s, transform 0.15s";
    card.style.opacity    = "0";
    card.style.transform  = "translateX(8px)";
    setTimeout(() => card.remove(), 160);
  }

  updateSidebar(_snapshots, _settings);
  if (_snapshots.length === 0) render();
  showToast("Snapshot deleted.");
}

async function restoreSnapshot(snapshot, card) {
  card.classList.add("restoring");
  const btn = card.querySelector(".card-btn-restore");
  if (btn) { btn.textContent = "Restoring…"; btn.disabled = true; }

  try {
    const result = await chrome.runtime.sendMessage({
      action:   "restoreSnapshot",
      snapshot,
    });

    if (result?.success) {
      card.classList.remove("restoring");
      card.classList.add("restored");
      if (btn) btn.textContent = "↗ Restore";
      showToast(`Restored "${snapshot.name}" in a new window.`, "success");
    } else {
      card.classList.remove("restoring");
      if (btn) { btn.textContent = "↗ Restore"; btn.disabled = false; }
      showToast(`Restore failed: ${result?.error ?? "unknown error"}`, "error");
    }
  } catch (err) {
    card.classList.remove("restoring");
    if (btn) { btn.textContent = "↗ Restore"; btn.disabled = false; }
    showToast("Restore failed — background not reachable.", "error");
  }

  // Remove the "restored" highlight after a moment
  setTimeout(() => card.classList.remove("restored"), 2500);
}

async function captureNow() {
  const btn = document.getElementById("captureNowBtn");
  btn.disabled = true;
  btn.textContent = "Capturing…";

  try {
    await chrome.runtime.sendMessage({ action: "captureNow" });
    // Reload snapshots from storage to reflect the new entry
    _snapshots = await loadSnapshots();
    render();
    showToast("Snapshot captured successfully.", "success");
  } catch (err) {
    showToast("Capture failed — background not reachable.", "error");
  }

  btn.disabled    = false;
  btn.textContent = "◈ Take snapshot";
}

async function clearAll() {
  if (!confirm(`Delete all ${_snapshots.length} snapshots? This cannot be undone.`)) return;
  _snapshots = [];
  await saveSnapshots([]);
  render();
  showToast("All snapshots cleared.");
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // Show shimmer while loading
  const main = document.getElementById("main");
  main.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div class="loading-shimmer"></div>
      <div class="loading-shimmer" style="height:48px;opacity:.6"></div>
      <div class="loading-shimmer" style="height:48px;opacity:.35"></div>
    </div>`;

  [_settings, _snapshots] = await Promise.all([loadSettings(), loadSnapshots()]);

  render();

  document.getElementById("captureNowBtn").addEventListener("click", captureNow);
  document.getElementById("clearAllBtn").addEventListener("click", clearAll);

  // Live-update if another page/popup changes storage
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes.snapshots) {
      _snapshots = changes.snapshots.newValue ?? [];
      render();
    }
    if (area === "sync" && (changes.snapshotsEnabled || changes.snapshotInterval || changes.snapshotMax)) {
      _settings = await loadSettings();
      updateSidebar(_snapshots, _settings);
    }
  });
});
