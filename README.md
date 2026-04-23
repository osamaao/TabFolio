# TabFolio

> Your browser tabs, bound and organised. TabFolio automatically groups Chrome tabs by domain into clean, named collections — with subdomain-aware routing, duplicate detection, alphabetical sorting, auto-collapse, and a one-shortcut collapse.

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
| `alarms`       | Fire the periodic idle-collapse check (survives service-worker suspension) |
| `storage`      | Persist settings across sessions               |


---

## Project structure

```
tabfolio/
├── manifest.json   # MV3 manifest
├── background.js   # Service worker — grouping, sorting, duplicate detection, auto-collapse
├── popup.html      # Settings popup UI
└── popup.js        # Popup logic — settings persistence and domain management
```

---

## Changelog

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