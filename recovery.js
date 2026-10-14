// Snapshot writes run inside exclusive(), including capture, deletion and import.
const SNAPSHOT_BUDGET = 6 * 1024 * 1024;
async function readSnapshots() {
  const { snapshots = [] } = await chrome.storage.local.get("snapshots");
  return snapshots.map(TF.normalizeSnapshot);
}
async function writeSnapshots(snapshots, { allowTrim = true } = {}) {
  const settings = await getSettings();
  let kept = snapshots.slice(0, settings.snapshotMax);
  if (!allowTrim && kept.length < snapshots.length) throw Error("Import exceeds your snapshot limit. Increase it in Settings or import fewer snapshots.");
  // Leave room for preferences and other extension data within Chrome's quota.
  const [total, old] = await Promise.all([chrome.storage.local.getBytesInUse(null), chrome.storage.local.getBytesInUse("snapshots")]);
  const budget = Math.min(SNAPSHOT_BUDGET, 9 * 1024 * 1024 - (total - old));
  while (TF.bytes({ snapshots: kept }) > budget && kept.length > 1 && allowTrim) kept.pop();
  if (kept.length && TF.bytes({ snapshots: kept }) > budget) throw Error("Not enough snapshot storage. Export and delete older snapshots first.");
  await chrome.storage.local.set({ snapshots: kept });
  return { kept, removed: snapshots.length - kept.length };
}
async function captureSnapshot({ automatic = false } = {}) {
  const settings = await getSettings();
  if (automatic && !settings.snapshotsEnabled) return { skipped: true };
  const [windows, groups, state] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }), chrome.tabGroups.query({}), loadState()]);
  const savedWindows = windows.filter(win => !win.incognito && win.tabs?.length).map(win => ({
    focused: win.focused,
    groups: groups.filter(g => g.windowId === win.id).map(g => ({ key: String(g.id), title: g.title, color: g.color,
      collapsed: g.collapsed, keepExpanded: !!state.groups[g.id]?.keepExpanded })),
    tabs: [...win.tabs].sort((a, b) => a.index - b.index).map(t => ({ url: t.pendingUrl || t.url || "chrome://newtab/",
      title: t.title || "", pinned: t.pinned, active: t.active, groupKey: t.groupId >= 0 ? String(t.groupId) : null }))
  }));
  const snapshot = TF.normalizeSnapshot({ version: 2, id: TF.id(), name: "", timestamp: Date.now(), windows: savedWindows });
  const { removed } = await writeSnapshots([snapshot, ...await readSnapshots()]);
  await chrome.storage.session.set({ lastError: null });
  return { snapshotId: snapshot.id, message: `Snapshot saved.${removed ? ` ${removed} older snapshot(s) removed by retention limits.` : ""}` };
}
async function importSnapshots(input) {
  const incoming = TF.parseImport(input); // Validate the entire file before writing anything.
  const existing = await readSnapshots();
  const ids = new Set(existing.map(s => s.id));
  const added = incoming.filter(s => !ids.has(s.id));
  const combined = [...existing, ...added].sort((a, b) => b.timestamp - a.timestamp);
  await writeSnapshots(combined, { allowTrim: false });
  return { message: `Imported ${added.length} snapshot(s). ${incoming.length - added.length} already present.`, imported: added.length };
}
async function deleteSnapshot(snapshotId) {
  const snapshots = await readSnapshots();
  await writeSnapshots(snapshots.filter(s => s.id !== snapshotId));
  return { message: "Snapshot deleted." };
}
async function restoreSnapshot(snapshotId, selection = null) {
  const snapshot = (await readSnapshots()).find(s => s.id === String(snapshotId));
  if (!snapshot) throw Error("Snapshot no longer exists.");
  if (selection && (!Number.isInteger(selection.windowIndex) || !snapshot.windows[selection.windowIndex]?.groups.some(g => g.key === selection.groupKey))) throw Error("That group is not in this snapshot.");
  const source = snapshot.windows.map((win, index) => ({ ...win, tabs: win.tabs.filter(t => !selection || selection.windowIndex === index && t.groupKey === selection.groupKey) })).filter(win => win.tabs.length);
  const total = source.reduce((n, win) => n + win.tabs.length, 0);
  if (!source.some(win => win.tabs.some(t => TF.httpUrl(t.url)))) throw Error("No HTTP or HTTPS tabs can be restored from this selection.");
  const result = { restored: 0, skipped: 0, failures: [], adjustments: [], windowIds: [] };
  const state = await loadState();
  const focusedBefore = await chrome.windows.getLastFocused().catch(() => null);
  let focusTarget;
  restoring = true;
  try {
    await chrome.storage.session.set({ restoreInProgress: true, restoreWindowIds: [] });
    for (const sourceWindow of source) {
      const restorable = sourceWindow.tabs.filter(t => TF.httpUrl(t.url));
      result.skipped += sourceWindow.tabs.length - restorable.length;
      if (!restorable.length) continue;
      let win;
      try { win = await chrome.windows.create({ focused: false, url: "about:blank" }); }
      catch (err) { result.failures.push(`Window: ${err.message}`); continue; }
      result.windowIds.push(win.id);
      await chrome.storage.session.set({ restoreWindowIds: result.windowIds });
      if (sourceWindow.focused || !focusTarget) focusTarget = win.id;
      const placeholder = win.tabs?.[0]?.id;
      const created = [];
      for (const tab of restorable) {
        try {
          // Insert before the placeholder in saved order. Moving individual
          // grouped tabs later could inadvertently split a native Chrome group.
          const live = await chrome.tabs.create({ windowId: win.id, url: tab.url, pinned: tab.pinned, active: false, index: created.length });
          state.tabOverrides[live.id] = "manual";
          created.push({ saved: tab, id: live.id });
          result.restored++;
        } catch (err) { result.failures.push(`${tab.url}: ${err.message}`); }
      }
      const active = created.find(t => t.saved.active) || created[0];
      const groupIds = new Map();
      for (const group of sourceWindow.groups) {
        const ids = created.filter(t => t.saved.groupKey === group.key).map(t => t.id);
        if (!ids.length) continue;
        try {
          const id = await assignGroup(ids);
          await chrome.tabGroups.update(id, { title: group.title, color: group.color, collapsed: false });
          state.groups[id] = { mode: "manual", keepExpanded: group.keepExpanded, routeKey: null, title: group.title, color: group.color };
          groupIds.set(group.key, id);
        } catch (err) { result.failures.push(`Group ${group.title || "Untitled"}: ${err.message}`); }
      }
      if (active) {
        try { await chrome.tabs.update(active.id, { active: true }); }
        catch (err) { result.failures.push(`Active tab: ${err.message}`); }
      }
      for (const group of sourceWindow.groups) {
        if (!groupIds.has(group.key)) continue;
        // Chrome cannot hide the selected tab. Report that necessary adjustment.
        const activeInside = active?.saved.groupKey === group.key;
        const collapsed = group.collapsed && !activeInside && !group.keepExpanded;
        if (group.collapsed && !collapsed) result.adjustments.push(`Kept ${group.title || "Untitled group"} expanded because it contains the selected tab or is set to Keep expanded.`);
        try { await chrome.tabGroups.update(groupIds.get(group.key), { collapsed }); }
        catch (err) { result.failures.push(`Group state: ${err.message}`); }
      }
      if (placeholder != null && created.length) await chrome.tabs.remove(placeholder).catch(err => result.failures.push(`Blank tab: ${err.message}`));
      state.manualOrder[win.id] = true;
      await saveState(state); // Durable checkpoints between windows.
    }
    if (focusTarget) await chrome.windows.update(focusTarget, { focused: true }).catch(err => result.failures.push(`Window focus: ${err.message}`));
    else if (focusedBefore) await chrome.windows.update(focusedBefore.id, { focused: true }).catch(() => {});
    state.undo = null;
    await saveState(state);
  } finally {
    restoring = false;
    await chrome.storage.session.set({ restoreInProgress: false, restoreWindowIds: [] });
  }
  result.partial = result.skipped > 0 || result.failures.length > 0 || result.adjustments.length > 0 || result.restored !== total;
  result.message = `Restored ${result.restored} of ${total} tabs in ${result.windowIds.length} window(s).${result.skipped ? ` ${result.skipped} unsupported URL(s) skipped.` : ""}${result.failures.length ? ` ${result.failures.length} operation(s) failed; see details.` : ""}${result.adjustments.length ? ` ${result.adjustments.length} group state(s) adjusted; see details.` : ""}`;
  return result;
}
