# TabFolio

A Chrome side panel for finding and organizing tabs, protecting your own groups,
reviewing duplicates, and restoring saved window layouts.

## What's new in 3.0.0

Version 3.0.0 adds these features and improvements over version 2:

- **Searchable side panel:** find tabs by title, URL or group name in the current
  window or across all windows. Open it from the toolbar, page context menu or
  **Alt+Shift+F**; use `/`, arrow keys, Enter and Escape to search and navigate.
- **Tab and group controls:** focus a tab and its window, move tabs into groups
  across windows, keep tabs ungrouped, and rename, expand or collapse groups.
- **Protected manual arrangements:** choose **Keep my arrangement** or **Manage
  automatically** per group. Native Chrome edits are respected, and preferences
  can be recovered across browser restarts. Unknown groups are protected on upgrade.
- **Keep expanded and timed pause:** exempt individual groups from collapse or
  pause automatic organization for 15, 30 or 60 minutes, with automatic expiry.
- **Undo organization:** restore the last automatic grouping/sorting operation
  while its resulting layout is unchanged, then protect the restored arrangement.
- **Merge same-name groups:** combine groups with identical, non-empty names
  within each selected window, preserving the leftmost group's color and ordered
  members. Also available as **Merge identical groups** in the page context menu.
- **Sort Groups:** explicitly sort protected or automatic groups A–Z using
  case-insensitive natural number order, stable ties and unnamed groups last.
  Merge and sort use the selected window scope independently of search.
- **Safer site routing:** distinguish domain identity from group names and reuse
  matching protected site groups, including renamed groups with saved identities
  and matching sites in explicitly merged groups.
- **More reliable idle collapse:** default to a full 10 minutes after leaving or
  expanding a group, preserve custom delays, and keep active and Keep expanded
  groups open during automatic or bulk collapse.
- **Duplicate review and cleanup:** show a toolbar duplicate count, review exact
  URL matches across windows, and close explicitly selected copies after
  confirmation. Active, pinned and audible tabs are protected, and at least one
  copy remains.
- **Full-window recovery:** snapshots now include pinned and ungrouped tabs,
  tab order, selected tabs, window focus and group preferences. Restore a complete
  layout into separate new windows or restore just one group.
- **Searchable snapshot history and backups:** preview saved layouts, search by
  date, site, title or group, export all snapshots or one snapshot, and import
  validated JSON backups. Legacy snapshots remain readable.
- **Dependable snapshot storage:** capture manually with scheduling disabled,
  see actual storage use, and retain snapshots within count and byte limits.
  Serialized writes prevent lost updates; restore results report skipped URLs,
  partial failures and interrupted restores while protecting opened tabs.
- **Dedicated settings and refreshed interface:** edit domain lists in batches,
  configure shortcuts, and use responsive light/dark pages with accessible
  labels, keyboard focus and live action feedback.
- **Reduced permissions:** duplicate review replaces page-title warning injection.
  TabFolio no longer requests scripting or broad host permissions, and excludes
  private browsing data from snapshots, duplicate review and durable preferences.

Version 3 requires **Chrome 116 or newer**. See [CHANGELOG.md](CHANGELOG.md) for
the complete release log, and [VALIDATION.md](VALIDATION.md)
for automated coverage and pending live Chrome checks.

## Install or update

Requires **Chrome 116 or newer**. No build step is needed to run the extension.

Download and extract `tabfolio-v3.0.0.zip` from the
[v3.0.0 release](https://github.com/osamaao/TabFolio/releases/tag/v3.0.0), or clone
this repository.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose the extracted release folder or this
   repository. For an existing install, click **Reload** on TabFolio's card.
3. Pin TabFolio in Chrome's toolbar and click it to open the side panel.

Version 3 replaces the settings popup with a side panel. Settings are available
from the panel or Chrome's extension options. Your existing settings and legacy
snapshots are retained. Existing groups default to **Keep my arrangement** if
TabFolio cannot identify their ownership, so an update won't rearrange them.
Choose **Manage automatically** in a group's options to opt it in.

The old version's warning symbols in already-open page titles may remain until
those pages reload. Version 3 does not inject or run page-title observers.

## Find and manage tabs

Search by title, URL, or group name. Select **Current window** or **All windows**.
Click a result to focus its tab and window. Use **Move** to place a tab in a group
in any window or keep it ungrouped. Pinned tabs must be unpinned in Chrome first.
For an ungrouped tab, the Move menu also offers automatic management again.

- **Alt+Shift+F** opens TabFolio. `/` focuses search within the panel.
- **Up/Down** navigates search results; **Enter** focuses the selected tab.
- **Alt+Shift+C** or **Collapse idle** folds groups in the current window, keeping
  the active group and groups marked Keep expanded open.
- Customize shortcuts at `chrome://extensions/shortcuts` or from Settings.

Use **Merge same-name groups** below the window selector to combine groups with
identical, non-empty names. Matching is exact and case-sensitive: “Work”, “work”
and “Work ” are different names. **Current window** merges only that window;
**All windows** merges matches independently within each window. Search does not
limit the merge, and tabs stay in their existing windows.

You can also right-click a page and choose **TabFolio → Merge identical groups**.
This uses the same exact-name matching and merges groups only in the window
where you right-clicked.

The leftmost matching group keeps its name and color. Other groups' tabs are
appended in group and tab order, without closing or reloading pages. **Keep expanded**
is retained if any matching group has it, and a group containing the active tab
stays expanded. Merged arrangements use **Keep my arrangement** so automatic
domain grouping cannot split them again. This manual action clears any previous
automatic-organization Undo. If Chrome refuses an edit or a group changes during
merging, the panel reports completed work and remaining failures; review and retry.

Click **Sort Groups** beside the merge button to sort group names A–Z, including
protected groups. Sorting ignores case, uses natural number order (Group 2 before
Group 10), keeps equal names in their existing order, and puts unnamed groups last.
It uses the selected window scope regardless of search. Windows that need
reordering place their sorted groups after pinned and ungrouped tabs, retaining
tab order within groups, group colors, collapsed state and the selected tab.
Group membership and management preferences stay the same. This explicit action
works while automation is paused, protects the window's new ordering from
automatic sorting, and clears the previous automatic-organization Undo.

Duplicate review uses exact parsed HTTP/HTTPS URLs. Queries, parameter order,
fragments, protocols, and paths remain significant; similar pages are not treated
as interchangeable. Review shows all copies of a matching URL across windows.
Choose the copies to close, then confirm. Active, pinned, audible and private tabs
are protected; TabFolio rechecks URLs and retains at least one copy. Unsaved page
content in explicitly closed tabs cannot be recovered by TabFolio.

## Automation that respects your choices

New eligible tabs are grouped by domain. Known platforms such as Google and
GitHub split by product subdomain: `docs.google.com` and `maps.google.com` get
separate groups. Routing uses a domain identity independent of the visible name,
so unrelated groups both named “docs” never merge automatically simply because
of that name. The explicit **Merge same-name groups** button lets you combine them.

New tabs also reuse existing protected site groups in the same window. This works
for all eligible sites, product subdomains and custom platform domains. For
example, opening `github.com` joins an existing **github** group, and
`docs.google.com` joins **docs**, including groups protected after merging.
A protected destination must have the site's name
(ignoring case and surrounding spaces) or its saved site identity, and contain
a tab from that same domain. Explicitly merged groups can receive new tabs for
each site already represented in them. Existing members, names, colors and
management preferences are preserved; the destination expands when a tab joins.
Paused automation, excluded sites, pinned/private tabs and explicit ungrouped
overrides continue to be respected.

Group options include:

- **Keep my arrangement:** protect existing members and naming from automatic
  changes; matching new site tabs can still join.
- **Manage automatically:** allow domain-based management on subsequent navigation.
- **Keep expanded:** exempt this group from automatic and bulk idle collapse.
- **Rename:** set a name and protect the group from automatic regrouping.

Native Chrome regrouping, ungrouping, renaming and recoloring are respected.
Moving a group manually stops automatic sorting for that window. A–Z sorting
runs only in windows where all groups are managed automatically. Excluded domains
and custom platform domains can be set in Settings, one domain per line.

**Idle collapse defaults to 10 minutes**, measured from leaving a group or
expanding it. Active groups in every window stay open. Checks run once a minute
and may be delayed by sleep; no group should collapse before its full idle delay.
A saved custom delay is preserved. Pause automation for 15, 30 or 60 minutes from
the panel; the pause expires automatically. Groups already idle beyond the delay
can collapse once automation resumes.

**Undo organization** restores the last automatic grouping/sorting operation
in its window. It is available only while that window still has the resulting
layout. Later manual changes invalidate Undo so it cannot overwrite them. Undo
protects the restored arrangement from immediately being applied again. It does
not reopen closed tabs or undo page navigation.

Preferences and manual overrides survive worker suspension. On a browser restart,
group preferences are matched by name, color and member URLs. Ambiguous matches
are protected as manual groups. Ungrouped manual overrides are matched by URL;
identical copies may therefore also be protected. Exact timer history and Undo
are not intended to survive uninstalling the extension.

## Saved snapshots

Automatic capture defaults to every **60 minutes**, retaining up to **50 snapshots**.
Manual capture works even when automatic capture is disabled. A snapshot records
normal, non-private windows, group names/colors/collapsed state, tab order, pinned
and selected tabs, and ungrouped tabs. It records URLs and layout, not page contents,
login state, navigation history, form edits, or window geometry.

Open **Saved snapshots** to:

- Search by date, site, page title or group name and preview a saved layout.
- Restore the complete layout into separate new windows, or restore one group.
- Export all snapshots or one snapshot to a JSON backup and import it later.
- Delete individual snapshots or clear the collection after confirmation.

Only HTTP and HTTPS pages are reopened. Internal Chrome pages, local files,
JavaScript URLs and extension pages are listed as skipped. An active tab's group
must remain expanded. The result reports skipped URLs, state adjustments and
individual failures; successfully opened tabs are retained on partial failure.
Restored groups and ungrouped tabs are protected from automatic reorganization.
If restoration is interrupted by worker termination, the next start reports it
and protects the opened restore windows; inspect those windows before retrying.

Legacy group-only snapshots remain readable and can be exported in the new
versioned format. Their saved window IDs recover window boundaries; information
that the old format never captured (such as pinned or ungrouped tabs) cannot be
recreated.

All snapshot mutations share a queue. Capture evicts the oldest entries to honor
both the count limit and a **6 MB snapshot budget**, with room reserved for other
extension data. Import validates the entire file, rejects malformed layouts and
oversized files (8 MB maximum), skips snapshot IDs already present, and fails
without changing storage if it would exceed retention limits. Import never evicts
existing snapshots. The manager displays actual stored bytes.

Snapshots are device-local and are **removed when the extension is uninstalled**.
Export a backup before uninstalling or moving machines. Neither snapshots nor tab
URLs are uploaded to a TabFolio server.

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` | Read titles and URLs; focus, move and explicitly close selected tabs |
| `tabGroups` | Read and manage groups |
| `sidePanel` | Persistent tab control panel |
| `contextMenus` | Open the panel, exclude a site, keep a tab ungrouped, collapse idle groups, merge identical group names |
| `storage` | Synced preferences, local snapshots and session state |
| `alarms` | Idle checks and automatic snapshots |

No host permissions, content scripts or `scripting` permission are requested.

## Development and verification

Node.js 18+ is used for development checks. Install test dependencies with `npm ci`.

```sh
npm test
npm run check
```

The automated suite uses a Chrome API harness and a DOM implementation. It covers
idle boundaries, worker and browser restarts, ownership, undo, duplicate review,
layout restoration, interruptions, import validation, quota failures, races and
100-tab grouping. DOM tests check UI behavior; they do not verify Chrome rendering.
See [VALIDATION.md](VALIDATION.md) for the live Chrome acceptance checklist and
current verification status, and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
for the implementation scope.

```text
background.js       Chrome events, commands, messages and lifecycle
core.js             Shared settings, routing, exact URL matching and schema validation
automation.js       Ownership, grouping/sorting queue, undo and explicit tab actions
activity.js         Persistent idle timestamps and collapse checks
recovery.js         Snapshot capture, retention, import and restoration
panel.html/js       Searchable tab side panel and duplicate review
settings.html/js    Dedicated settings page
snapshots.html/js   Snapshot search, preview, restore and backup
ui.js / styles.css  Shared interface helpers and responsive light/dark styles
tests/              Chrome API harness, regression suite and static checks
```

MIT license. Issues and pull requests are welcome.
