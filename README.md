# TabFolio

> Your browser tabs, bound and organised. TabFolio automatically groups Chrome tabs by domain into clean, named collections — with subdomain-aware routing, duplicate detection, alphabetical sorting, auto-collapse, session snapshots, and a one-shortcut collapse.

---

## Features


| Feature                     | Details                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-grouping**           | Tabs are grouped by domain the moment they open or navigate                                                                                 |
| **Subdomain routing**       | Platform domains (Google, GitHub, Office 365, …) split into per-product groups — `docs.google.com` → **docs**, `maps.google.com` → **maps** |
| **Duplicate detection**     | Duplicate tabs across any window are flagged with ⚠️ in their title                                                                         |
| **Alphabetical sorting**    | Groups are kept in A–Z order within each window                                                                                             |
| **Collapse shortcut**       | `Alt+Shift+C` collapses every group in the current window instantly                                                                         |
| **Auto-collapse idle groups** | Groups not visited for a configurable number of minutes (default: 5) are automatically collapsed; the active tab's group is never collapsed |
| **Snapshots**               | Periodically saves the full state of all tab groups; a dedicated manager page lets you browse and restore any snapshot into a new window     |
| **Excluded domains**        | Any domain can be excluded from grouping via the popup                                                                                      |
| **Custom platform domains** | Add your own company domains so subdomains get their own group                                                                              |


---

## Installation

> The extension is not yet on the Chrome Web Store. Install it manually in Developer Mode.

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository folder.

---

## How grouping works

For most sites, the registrable domain (eTLD+1) is used as the group name:

```
github.com        → github
stackoverflow.com → stackoverflow
notion.so         → notion
```

For **platform domains**, the leading subdomain is used instead, so each product gets its own group:

```
docs.google.com       → docs
maps.google.com       → maps
gemini.google.com     → gemini
studio.youtube.com    → studio
gist.github.com       → gist
word.office.com       → word
jira.atlassian.net    → jira
```

Built-in platform domains: `google.com`, `microsoft.com`, `office.com`, `live.com`, `atlassian.net`, `atlassian.com`, `apple.com`, `adobe.com`, `youtube.com`, `github.com`, `notion.so`, `figma.com`, `shopify.com`, `salesforce.com`.

Custom platform domains can be added from the popup.

---

## Keyboard shortcut


| Shortcut      | Action                                    |
| ------------- | ----------------------------------------- |
| `Alt+Shift+C` | Collapse all groups in the current window |


To remap, visit `chrome://extensions/shortcuts`.

---

## Permissions


| Permission     | Why                                            |
| -------------- | ---------------------------------------------- |
| `tabs`         | Read tab URLs to determine grouping            |
| `tabGroups`    | Create, update, and move tab groups            |
| `scripting`    | Inject the duplicate-title observer into pages |
| `contextMenus` | Right-click menu for quick exclude / ungroup   |
| `alarms`       | Fire the periodic idle-collapse check and snapshot alarm (both survive service-worker suspension) |
| `storage`      | Persist settings across sessions               |


---

## Project structure

```
tabfolio/
├── manifest.json    # MV3 manifest
├── background.js    # Service worker — grouping, sorting, duplicate detection, auto-collapse, snapshots
├── popup.html       # Settings popup UI
├── popup.js         # Popup logic — settings persistence and domain management
├── snapshots.html   # Snapshot manager page
└── snapshots.js     # Snapshot manager logic — browse, restore, delete
```

---

## Snapshots

TabFolio can automatically save the full state of all tab groups at a regular interval, giving you a rolling history you can restore at any time.

### How it works

A `chrome.alarms` recurring alarm fires at the configured interval (default: every 60 minutes). When it fires, `captureSnapshot()` queries every tab group across all open windows and records each group's title, color, collapsed state, and the URL, title, and favicon of every tab inside it. The result is stored as a single snapshot object in `chrome.storage.local` under the key `snapshots`.

Snapshots are kept in a rolling buffer (default: 50). Once the buffer is full, the oldest snapshot is dropped to make room for the newest (FIFO). Both the interval and the buffer size are adjustable from the popup.

### Naming convention

Each snapshot is named:

```
tabfolio-snapshot-YYYY-MM-DD-<unix-timestamp-ms>
```

For example: `tabfolio-snapshot-2026-04-23-1745447432910`

### Snapshot manager

Open the manager from the popup ("Open Snapshot Manager") or by navigating directly to the extension page. It shows:

- A live overview of snapshot count, total groups, total tabs, and time since the last capture
- A buffer-usage bar showing how full the rolling window is
- A card for each snapshot, expandable to show every group and its tabs (with favicons, titles, and hostnames)
- Per-snapshot **Restore** and **Delete** actions
- A **Take Snapshot** button for an immediate on-demand capture

### Restoring a snapshot

Clicking **Restore** opens the snapshot in a **new window** — your current session is never disturbed. TabFolio recreates each group with its original title, color, and collapsed state, then opens all HTTP/HTTPS tabs into their respective groups.

### Storage and persistence

Snapshots are stored in `chrome.storage.local` (device-local, not synced). This storage is **cleared when the extension is uninstalled**. If you reinstall or move to a new machine, previously captured snapshots will be lost. To guard against this, export your snapshots as a JSON file before uninstalling and re-import them afterwards — see the manager page for export/import controls.

---

## Changelog

### [#3](https://github.com/osamaao/TabFolio/pull/3) — feat: tab auto-snapshots

Adds a full snapshot system. Key details: `captureSnapshot()` runs on a configurable `chrome.alarms` alarm (default 60 min) and persists all tab-group state to `chrome.storage.local`; a FIFO rolling buffer caps storage at a user-defined maximum (default 50); `restoreSnapshot()` recreates groups in a new window without touching the current session; a new `snapshots.html` manager page provides a full history UI with per-snapshot restore, delete, and on-demand capture. Popup gains an "Auto-snapshots" toggle, interval and max-buffer inputs, and a link to the manager. The existing `alarms` permission covers the new alarm.

### [#2](https://github.com/osamaao/TabFolio/pull/2) — feat: auto-collapse idle tab groups

Groups that haven't been visited for a configurable number of minutes are automatically collapsed. The group containing the currently active tab is never collapsed. The idle threshold (1–60 min, default 5) is adjustable from the popup, and the feature can be disabled entirely with its toggle. Uses a 1-minute `chrome.alarms` recurring alarm so the check survives service-worker suspension.

### [#1](https://github.com/osamaao/TabFolio/pull/1) — fix: always expand groups when a tab is added

Groups were silently staying collapsed when a tab was opened in the background (e.g. right-click → "Open Link in New Tab"). New groups are now created with `collapsed: false`, and existing groups are explicitly expanded whenever a tab is added to them.

---

## Contributing

1. Fork the repo and create a feature branch.
2. Load the unpacked extension to test locally.
3. Open a pull request with a clear description of the change.

Bug reports and feature requests are welcome via [Issues](../../issues).

---

## License

MIT