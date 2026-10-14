// Serialize read/modify/write operations: a scan or another touch must not
// overwrite a newer timestamp with an older copy of the activity map.
let _groupActivityQueue = Promise.resolve();
let _groupActivityRevision = 0;

function touchGroup(groupId) {
  if (groupId == null || groupId === -1) return Promise.resolve();
  return updateGroupActivity({ touchedGroupId: groupId });
}

// Called once per alarm tick.  Collapses every expanded group whose idle time
// exceeds the configured threshold, except the group containing the active tab
// in each window.
function autoCollapseIdleGroups() {
  return updateGroupActivity({ collapseIdle: true });
}

function updateGroupActivity({ touchedGroupId, activatedTabId, collapseIdle = false } = {}) {
  // An activity event arriving during a scan invalidates its collapse decisions.
  // Its queued write will be applied before the next scan.
  if (!collapseIdle) _groupActivityRevision++;
  const revision = _groupActivityRevision;
  // Capture even brief visits before later activation events change the query
  // results. If the tab has already closed, still record the previous departure.
  const activatedTab = activatedTabId == null
    ? null
    : chrome.tabs.get(activatedTabId).catch(() => null);

  _groupActivityQueue = _groupActivityQueue.then(async () => {
    const settings = collapseIdle ? await getSettings() : null;
    const state = collapseIdle ? await loadState() : null;
    const groups = settings?.autoCollapse ? await chrome.tabGroups.query({}) : [];
    const store = await chrome.storage.local.get({ groupActivity: {}, groupActiveIds: [] });
    const activeTabs = await chrome.tabs.query({ active: true });
    const activeGroupIds = new Set(activeTabs.map((tab) => tab.groupId).filter((id) => id >= 0));
    const visitedTab = await activatedTab;
    const activity = store.groupActivity;
    const now = Date.now();

    // Current groups are still in use; previously active groups have only just
    // become idle. Refresh both so time spent reading a tab never counts as idle.
    for (const id of new Set([...store.groupActiveIds, ...activeGroupIds])) {
      activity[String(id)] = now;
    }
    if (touchedGroupId >= 0) activity[String(touchedGroupId)] = now;
    if (visitedTab?.groupId >= 0) activity[String(visitedTab.groupId)] = now;

    const toCollapse = [];
    if (settings?.autoCollapse) {
      const delayMs = Math.max(1, settings.autoCollapseDelay || TF.defaults.autoCollapseDelay) * 60 * 1000;
      for (const group of groups) {
        if (group.collapsed || activeGroupIds.has(group.id) || state.groups[group.id]?.keepExpanded || isPaused(state) || restoring) continue;
        const key = String(group.id);
        if (activity[key] === undefined) {
          activity[key] = now; // First encounter gets a full grace period.
        } else if (now - activity[key] >= delayMs) {
          toCollapse.push(group.id);
        }
      }

      const liveIds = new Set(groups.map((group) => String(group.id)));
      for (const id of Object.keys(activity)) {
        if (!liveIds.has(id)) delete activity[id];
      }
    }

    await chrome.storage.local.set({ groupActivity: activity, groupActiveIds: [...activeGroupIds] });

    for (const id of toCollapse) {
      if (revision !== _groupActivityRevision) break;
      try {
        await chrome.tabGroups.update(id, { collapsed: true });
      } catch (err) {
        // A group may have closed since the query.
        console.debug("[TabFolio] autoCollapse – skipped group", id, err.message);
      }
    }
  }).catch((err) => {
    console.warn("[TabFolio] group activity update failed:", err);
  });
  return _groupActivityQueue;
}
