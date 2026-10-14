# Changelog

## [Unreleased]

## [3.0.0] - 2026-10-13

Changes since version `2.0` at
[`3cb90dc`](https://github.com/osamaao/TabFolio/commit/3cb90dc487c56a05619bd5a3c4982bbdb87e1989)
in the previous `main` implementation.

### Added — Tab control panel

- Persistent Chrome side panel, opened from the toolbar, the page context menu,
  or the new **Alt+Shift+F** shortcut.
- Live tab search by page title, URL, or group name, scoped to **Current window**
  or **All windows**.
- Keyboard navigation: **/** focuses search, **Up/Down** browses results,
  **Enter** activates the focused result, and **Escape** clears focused search.
- Tab switching that expands the destination group, selects the tab, and brings
  its window forward.
- Tab movement into existing groups across windows or into an ungrouped state;
  ungrouped tabs can explicitly return to automatic management.
- Group controls for renaming, expanding/collapsing, choosing management policy,
  and keeping groups expanded.
- Visible tab counts, group colors, window identifiers, and active, pinned, and
  audible tab indicators, plus live action feedback and empty states.

### Added — Manual organization controls

- Per-group **Keep my arrangement** and **Manage automatically** policies.
  Unknown groups default to protected ownership during upgrades.
- Protection for native Chrome regrouping, ungrouping, renaming, recoloring,
  and group ordering. Manual group movement stops automatic sorting in that window.
- Per-group **Keep expanded**, respected by automatic collapse and bulk collapse.
- Automation pause for **15, 30, or 60 minutes**, with remaining time displayed,
  automatic expiry, and an explicit resume action.
- **Undo organization** for the most recent automatic grouping/sorting operation.
  Undo restores membership, ordering, and group state, protects the restored
  arrangement, and refuses to overwrite a subsequently changed layout.
- Persistent management preferences and ungrouped overrides across worker
  suspension. Browser restarts recover group preferences using names, colors,
  and member URLs, and ungrouped overrides using URLs; ambiguous group matches
  remain protected.

### Added — Explicit merge and sort actions

- **Merge same-name groups** in the panel and **TabFolio → Merge identical
  groups** in the page context menu.
- Exact, case-sensitive merging of non-empty group names within each selected
  window. The leftmost group keeps its name and color; other members append in
  group/tab order. Tabs stay open in their existing windows, active tabs remain
  visible, and Keep expanded is retained if any participating group has it.
- Protection for merged arrangements against subsequent automatic regrouping
  and sorting, including after preference recovery on browser restart.
- **Sort Groups** for manual A–Z sorting, including protected groups, while
  automation is paused or running. Names use case-insensitive natural number
  order, equivalent names retain their order, and unnamed groups come last.
- Current-window/all-windows scope for both panel actions, independent of search.
  Reordered windows place sorted groups after pinned and ungrouped tabs while
  retaining group membership, member order, colors, collapsed states, and selection.
- Saved protection for explicit sorting, invalidation of prior automatic Undo,
  rechecks for concurrent native edits, and partial-completion feedback for
  interrupted merge/sort operations so remaining work can be reviewed and retried.

### Changed — Automatic grouping and idle collapse

- Automatic group routing uses domain identity separately from the visible name,
  preventing unrelated sites with matching labels from merging automatically.
- New eligible tabs can join an existing protected site group in the same window
  when its saved identity or normalized name and live member domains match.
  This supports ordinary sites, product subdomains, custom platform domains,
  renamed groups with saved identities, and matching sites in explicitly merged groups.
- Protected destination names, colors, existing members, and management choices
  are retained when new tabs join. Exclusions, pause, pinned/private tabs, and
  explicit ungrouped overrides remain respected.
- Automatic alphabetical sorting runs only where all groups are managed
  automatically and the window has no protected manual ordering.
- Default idle delay increased from **5 to 10 minutes**, preserving saved custom
  values. Idle time starts when leaving a group or expanding it, giving a full
  delay after long reading sessions, brief visits, and incoming tabs.
- Activity updates are serialized, stale collapse decisions are cancelled after
  new activity, and browser startup resets timers for reused group IDs.
- **Alt+Shift+C** now preserves active groups and Keep expanded groups. The panel
  adds the same action as **Collapse idle**, and the context-menu action uses
  the clicked window.
- Pinned and private tabs are excluded from automatic grouping; IPv6 addresses
  retain their complete identity and label.

### Changed and added — Snapshots and recovery

- Versioned full-window snapshots now include ungrouped and pinned tabs, tab
  order, the selected tab in each window, focused-window information, group
  membership, names, colors, collapsed states, and Keep expanded preferences.
- Manual capture works with automatic snapshots disabled and with no tab groups.
- Searchable snapshot history by date, site/URL, page title, or group name, with
  window/group/tab counts and previews built on demand. Previews identify pinned,
  active, and unsupported tabs.
- Full-layout restoration preserves separate saved windows; individual groups
  can also be restored. A confirmation shows how many tabs can reopen and how
  many unsupported URLs will be skipped.
- Restored arrangements are protected from automatic organization. Only HTTP
  and HTTPS pages reopen; results report restored/skipped counts, individual
  failures, and necessary group-state adjustments while retaining successful tabs.
- Interrupted-restore detection on worker restart protects tabs already opened
  and displays a recovery notice.
- JSON export for all snapshots or one snapshot, plus import with whole-file
  schema/layout/URL validation, an **8 MiB** limit, duplicate-ID detection, and
  skipping IDs already stored. Invalid or over-limit imports leave storage intact;
  imports do not evict existing snapshots or open tabs.
- Legacy group-only snapshots remain readable and exportable in the new format,
  recovering original window boundaries from saved window IDs.
- Serialized capture/delete/import writes prevent lost updates. Capture applies
  both count retention and a **6 MiB** snapshot budget, reserving storage for
  other extension data and reporting evictions or storage failures.
- Snapshot manager displays actual stored bytes and requires confirmation for
  individual deletion as well as deleting the entire collection.

### Added and changed — Settings, interface, and privacy

- Dedicated Settings page, available from the panel and Chrome extension options,
  replaces the toolbar settings popup while retaining existing preferences.
- Batch editing of excluded and custom platform domains, with validation,
  normalization, deduplication, and a built-in platform-domain reference.
- Live shortcut bindings and a button opening Chrome's shortcut configuration.
- Shared responsive light/dark styling, accessible labels and status regions,
  keyboard focus states, focus preservation during panel refresh, and native
  confirmation/edit dialogs. Stored and user-entered text is rendered as text.
- Toolbar badge showing the number of extra duplicate copies across windows.
- Duplicate review replaces injected warning symbols in page titles. Matching
  uses exact parsed HTTP/HTTPS URLs, preserving query parameters and their order,
  fragments, protocols, and paths.
- Explicit duplicate selection and confirmation before closing. Active, pinned,
  audible, and private tabs are protected; live URLs are rechecked, at least one
  copy is retained, and the actual closed count is reported.
- Removed page-title observers, page script injection, the `scripting` permission,
  and broad HTTP/HTTPS host permissions; added the `sidePanel` permission.
- Private windows and URLs are excluded from snapshot capture, the panel model,
  duplicate review, and durable group/manual-tab preferences.

### Fixed and added — Reliability and development

- Shared operation queue for automatic organization, explicit tab/group actions,
  restoration, and snapshot mutations, with checks for intervening manual edits.
- Alarm reconciliation on worker startup and browser startup, and ordered
  callback-based context-menu setup compatible with Chrome 116.
- Background failures surface in the panel; interrupted operations and partial
  results provide actionable feedback.
- Shared modules for settings/routing/schema helpers, automation, idle activity,
  recovery, and UI, with no runtime dependencies or extension build step.
- Node.js 18+ development setup with `npm test`, `npm run check`, a Chrome API
  harness, DOM interaction coverage, and regression coverage for restarts,
  ownership, Undo, duplicates, merge/sort, recovery, imports, quota failures,
  concurrency, private tabs, and 100-tab grouping.
- Updated installation, migration, permissions, privacy, recovery, implementation,
  and validation documentation.

### Compatibility and verification

- Extension version is now **3.0.0**; minimum Chrome version increases from
  **90 to 116**. Snapshot/export schema version is **2**.
- Release checks: **108 automated tests passed**;
  `npm run check` passed syntax, manifest, asset, CSP, and form-label checks.
- Live Chrome interaction and visual validation remain pending, as recorded in
  [VALIDATION.md](VALIDATION.md).
- Recovery saves URLs and layout, not page contents, form edits, login state,
  navigation history, or window geometry. Legacy snapshots cannot recover data
  they never captured. Old warning symbols in page titles may remain until reload.

[Unreleased]: https://github.com/osamaao/TabFolio/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/osamaao/TabFolio/releases/tag/v3.0.0
