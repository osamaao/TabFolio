# TabFolio 3 validation

Last checked: October 13, 2026.

## Automated checks

- `npm test`: 108 passing tests, zero failures.
- `npm run check`: JavaScript syntax, manifest, local assets, inline-script
  restrictions, duplicate HTML IDs and static form-label references.
- `git diff --check`: no whitespace errors.

The regression suite loads the production worker into a Node VM with a simulated
Chrome API. It covers the 10-minute idle boundary, departure and expansion timing,
brief visits, concurrent updates, worker restarts, browser startup, manual group
ownership, late session restoration, pause, Undo, exact duplicate matching,
explicit close protection, full-window snapshot restoration, partial failures,
legacy migration, import validation, quota errors, concurrent snapshot writes,
private-window exclusion, callback-based menus and 100-tab grouping.

Incoming-tab routing checks cover opening a URL directly and navigating an
initially blank tab into an existing protected YouTube group, unknown site groups,
renamed automatic groups, explicitly merged product sites, identical member URLs
after worker/browser restarts, concurrent creation, window isolation, domain
verification for matching labels and retained explicit ungrouped overrides.
Grouped tabs are protected by their group policy; only ungrouped manual tabs
contribute to newly saved URL-based overrides.

Generic routing regressions cover ordinary and arbitrary domains, country-code
domains, GitHub, Amazon, Notion, Google and Office product subdomains, custom
platform domains, localhost, IPv4 and IPv6. Each case verifies direct URL opening,
navigation from a blank tab, and duplicate member URLs after a browser restart.
Additional cases verify renamed site identities and retained exclusions, pause,
disabled grouping, pinned tabs and private-tab protection.

Group-merge regression checks cover exact titles, blank and hostile names,
leftmost-group color and tab order, window boundaries, private/pinned exclusion,
active tabs and idle timing, durable manual protection, native edits during
merging, partial failures, actual completion counts, retries and queued requests.
Context-menu checks verify the TabFolio parent and all existing actions, the
**Merge identical groups** label, callback ordering on Chrome 116, merging only
the clicked window, missing-tab and repeated-click handling, and partial-failure
reporting with a successful retry.

Explicit group-sorting checks cover protected groups, natural case-insensitive
order, stable ties and unnamed groups, window scope, private-group exclusion,
tab membership/order and native group state, ordering protection across restarts,
pause, no-op and invalid scopes, native name changes, API failures, retries and
queued requests. The panel tests verify adjacent buttons, scope, search-independent
sorting, status feedback and recovery from inert failure text.

DOM tests load the actual HTML and scripts with LinkeDOM and route messages to
the production worker through the simulated API. They exercise search, keyboard
navigation, focus preservation, group controls, pause, duplicate confirmation,
rename, settings, snapshot preview and restore, and cancellation of deletion.
They also exercise the merge button with window scope, an active search,
no matches and inert failure text.
These tests do not render pages or reproduce every native Chrome event sequence.

## Live Chrome status

**Not verified in a live browser.** The available browser runtime returned
`No browser is available`; its browser connection list was empty on October 6.
The extension
could not be reloaded or visually inspected through that connection. Automated
checks establish regression coverage, not confirmation of Chrome rendering or
native integration. Chrome 116+ is the declared minimum; it has not been tested
on an actual Chrome 116 installation in this environment.

## Live acceptance checklist

Use a disposable Chrome profile with test tabs for destructive-action checks.

- [ ] Reload TabFolio from `chrome://extensions`. Confirm there are no manifest
  or worker errors and the toolbar action opens the native side panel. Check
  shortcuts and context menus, including after a browser restart.
- [ ] Right-click a page and verify **TabFolio → Merge identical groups** appears
  alongside the existing panel, exclusion, ungroup and collapse actions. Run it
  with same-name groups in two windows and confirm only the clicked window is
  merged, all tabs stay open, and the result matches the panel's merge action.
- [ ] Inspect the panel at narrow and wide widths, and Settings and Snapshots at
  desktop and narrow widths in light and dark mode. Check text wrapping, contrast,
  keyboard focus, dialog focus containment, Escape, and focus after live refresh.
- [ ] Search titles, URLs and group names across two windows. Focus results and
  move tabs into groups in either window. Verify the selected window and tab.
- [ ] With a protected **youtube** group containing a YouTube page, create a
  blank tab and navigate to youtube.com, then open another YouTube URL directly.
  Verify both join that group without creating another one or changing its name,
  color, Keep expanded setting or previous members. Repeat after merging groups,
  reloading the worker and restarting Chrome, including the same saved page URL.
  Check concurrent new tabs, different windows, excluded sites, paused automation
  and explicitly ungrouped tabs. Verify unrelated product domains named **docs**
  stay separate unless explicitly merged.
- [ ] Create several groups with exactly the same name and different colors,
  interspersed with unrelated groups and ungrouped/pinned tabs. Click **Merge
  same-name groups** below the window selector. Confirm the leftmost group keeps
  its color, members append in order, the active tab remains selected and no tabs
  close or reload. Repeat with Current window and All windows, a search filter,
  collapsed groups and a source set to Keep expanded. Verify window boundaries,
  exact case/spacing, blank-name exclusion, feedback when no matches remain and
  protection through navigation and a browser restart.
- [ ] Click **Sort Groups** beside the merge button in an unsorted window with
  protected groups, duplicate names, unnamed groups and Group 2 / Group 10.
  Confirm A–Z order, stable ties, unnamed groups last and preserved group members,
  member order, colors, collapse states and active tab. Check Current window and
  All windows, search filtering, paused automation, no-op feedback and a retry
  after Chrome temporarily refuses a move. Confirm pinned tabs stay first and
  ungrouped tabs retain their relative order ahead of reordered groups.
- [ ] Rename, recolor, move, regroup and ungroup tabs using native Chrome controls.
  Navigate them and restart Chrome. Verify those manual choices remain protected;
  opt a group or ungrouped tab back into automatic management explicitly.
- [ ] Leave a group after reading for longer than ten minutes. Verify it stays
  expanded for ten more minutes. Repeat with brief visits, manual expansion and
  worker termination. The one-minute alarm may delay collapse beyond the deadline.
- [ ] Verify Keep expanded and timed pause, including pause expiry. Undo automatic
  organization, then verify Undo refuses to overwrite a later changed layout.
- [ ] Capture two windows containing pinned, ungrouped, active and grouped tabs.
  Restore into new windows and compare order, selection, names, colors and
  collapsed states. Restore a single group and inspect any skipped-URL notices.
- [ ] Disable automatic snapshots and capture manually. Export a JSON file,
  import it, and verify duplicate IDs are skipped. Confirm a malformed or
  over-limit import leaves existing snapshots intact.
- [ ] Review duplicates with distinct query strings and fragments. Verify nothing
  is preselected, active/pinned/audible tabs are protected, cancellation closes
  nothing, and a confirmed selection retains at least one copy.
- [ ] Test an upgrade containing old settings and legacy snapshots. Confirm the
  custom idle delay survives, legacy snapshots remain readable, and unknown
  groups default to Keep my arrangement.

Snapshots preserve URLs and layout only. They do not preserve unsaved forms,
page state, cookies, navigation history or window geometry. Browser-restart
preference matching uses group names/colors/member URLs and manual tab URLs;
ambiguous group matches stay manual, and identical manual-tab URLs may protect
multiple copies. These boundaries are also described in README.md.
