# TabFolio 3 implementation plan

The three approved improvements are implemented together, preserving the existing
10-minute idle fix and user settings. Chrome 116+ is the supported baseline for
the native side panel. No build step or runtime dependencies are required.

## 1. Respect manual organization

- [x] Shared settings and routing helpers; group identity independent of its title.
- [x] Persist ownership and manual overrides across worker restarts. Unknown groups
      are protected on upgrade. Explicitly opt groups back into automatic management.
- [x] Preserve manual regrouping, ungrouping, naming, and ordering.
- [x] Per-group Keep expanded, timed automation pause, and Undo automatic rearrangement.
- [x] Serialize grouping, sorting, and restore operations; retain exact idle timing.

Acceptance: unrelated domains with matching labels never merge; user choices survive
navigation and worker restarts; undo does not move tabs back after later manual edits;
pause and Keep expanded prevent automatic collapse.

## 2. Dependable recovery

- [x] Versioned snapshots capture windows, groups, ordered tabs, pinned and active tabs.
- [x] Read legacy snapshots without losing them. Manual capture works with scheduling off.
- [x] Restore all or a selected group into new windows, isolated from automation.
- [x] Preview what will restore, report skipped URLs and individual failures accurately.
- [x] Export/import JSON with schema, URL, and size validation; serialize all writes.
- [x] Enforce retention and a byte budget; show actual storage use and visible errors.

Acceptance: a multi-window capture/restore preserves restorable layout; concurrent
capture/delete/import cannot overwrite one another; invalid imports change nothing;
unsupported URLs are reported; automatic grouping cannot rearrange restored tabs.

## 3. Searchable control panel

- [x] Native side panel with Current window / All windows and keyboard search.
- [x] Focus/move tabs; rename/manage/collapse groups; expose pause, undo, and recovery.
- [x] Conservative duplicate matching and explicit selection before closing duplicates.
- [x] Separate settings page; accessible labels, focus states, live feedback, empty states.
- [x] Remove title observers, scripting permission, and broad host permissions.

Acceptance: search includes title, URL and group name; focus brings the correct window
forward; semantic query parameters and hash routes remain distinct; duplicate actions
revalidate live tabs and keep at least one copy; no automatic duplicate deletion.

## 4. Verification and documentation

- [x] Node regression suite covering idle timing, ownership, races, undo, recovery,
      import validation, quotas, and duplicate decisions.
- [x] Syntax/manifest checks and DOM UI interaction checks.
- [ ] Live Chrome interaction and visual review: blocked by an unavailable browser
      connection; follow-up checks are listed in [VALIDATION.md](VALIDATION.md).
- [x] Update installation, permissions, migration and usage documentation.
- [x] Document any live-Chrome validation that this environment cannot perform.
