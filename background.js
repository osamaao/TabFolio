// TabFolio 3 — classic MV3 worker. No content scripts or page injection.
importScripts("core.js", "automation.js", "activity.js", "recovery.js");
const AUTO_COLLAPSE_ALARM = "tabfolio-auto-collapse";
const SNAPSHOT_ALARM = "tabfolio-snapshot";

async function setupAlarms() {
  if (!await chrome.alarms.get(AUTO_COLLAPSE_ALARM)) await chrome.alarms.create(AUTO_COLLAPSE_ALARM, { periodInMinutes: 1 });
  const settings = await getSettings();
  const existing = await chrome.alarms.get(SNAPSHOT_ALARM);
  if (!settings.snapshotsEnabled) await chrome.alarms.clear(SNAPSHOT_ALARM);
  else if (existing?.periodInMinutes !== settings.snapshotInterval) await chrome.alarms.create(SNAPSHOT_ALARM, { periodInMinutes: settings.snapshotInterval });
}
async function refreshBadge() {
  const settings = await getSettings();
  const count = settings.detectDupes ? TF.duplicates(await chrome.tabs.query({})).reduce((n, set) => n + set.tabs.length - 1, 0) : 0;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#36644b" });
}
async function getModel() {
  const [tabs, groups, state, settings, session] = await Promise.all([
    chrome.tabs.query({}), chrome.tabGroups.query({}), loadState(), getSettings(), chrome.storage.session.get(["lastError", "restoreInProgress"])]);
  return { tabs: tabs.filter(t => !t.incognito), groups: groups.filter(g => tabs.some(t => !t.incognito && t.groupId === g.id)), state, settings, lastError: session.lastError,
    duplicates: settings.detectDupes ? TF.duplicates(tabs) : [], restoring: !!session.restoreInProgress };
}
async function collapseAllGroups(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  const active = new Set((await chrome.tabs.query({ active: true, windowId })).map(t => t.groupId));
  const state = await loadState();
  for (const group of groups) {
    if (!active.has(group.id) && !state.groups[group.id]?.keepExpanded) await chrome.tabGroups.update(group.id, { collapsed: true });
  }
  return { message: "Collapsed idle groups. Active and Keep expanded groups remain open." };
}
async function handleMessage(message) {
  switch (message.action) {
    case "getModel": return getModel();
    case "saveSettings": {
      const settings = TF.settings({ ...await getSettings(), ...message.patch });
      await chrome.storage.sync.set(settings);
      await setupAlarms();
      await refreshBadge();
      return { settings, message: "Settings saved." };
    }
    case "pause": {
      if (![0, 15, 30, 60].includes(message.minutes)) throw Error("Choose a valid pause duration.");
      const state = await loadState();
      state.pauseUntil = message.minutes ? Date.now() + message.minutes * 60000 : 0;
      await saveState(state);
      await updateGroupActivity();
      return { message: message.minutes ? `Automation paused for ${message.minutes} minutes.` : "Automation resumed." };
    }
    case "groupPolicy": return setGroupPolicy(message.groupId, message.patch || {});
    case "undo": return undoOrganization();
    case "renameGroup": {
      if (typeof message.title !== "string" || !message.title.trim() || message.title.length > 100) throw Error("Enter a group name of 1–100 characters.");
      const group = await chrome.tabGroups.get(message.groupId);
      const state = await loadState();
      Object.assign(policyFor(state, group), { mode: "manual", matchPending: false, title: message.title.trim() });
      state.undo = null;
      await chrome.tabGroups.update(group.id, { title: message.title.trim() });
      await saveState(state);
      return { message: "Group renamed and protected." };
    }
    case "collapseGroup": {
      const state = await loadState();
      if (message.collapsed && state.groups[message.groupId]?.keepExpanded) throw Error("Turn off Keep expanded first.");
      if (message.collapsed && (await chrome.tabs.query({ groupId: message.groupId })).some(t => t.active)) throw Error("Switch to a different group before collapsing this one.");
      await chrome.tabGroups.update(message.groupId, { collapsed: !!message.collapsed });
      return {};
    }
    case "collapseAll": return collapseAllGroups(message.windowId);
    case "focusTab": {
      const tab = await chrome.tabs.get(message.tabId);
      if (tab.groupId >= 0) await chrome.tabGroups.update(tab.groupId, { collapsed: false });
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await touchGroup(tab.groupId);
      return {};
    }
    case "moveTab": return moveTab(message.tabId, message.groupId, message.windowId);
    case "mergeSameNameGroups": return mergeSameNameGroups(message.windowId);
    case "sortGroups": return sortGroups(message.windowId);
    case "manageTab": {
      const state = await loadState(); state.tabOverrides[message.tabId] = "auto"; await saveState(state);
      await organizeTab(message.tabId); return { message: "Automatic management enabled for this tab." };
    }
    case "closeDuplicates": return closeDuplicates(message.selection);
    case "getSnapshots": return { snapshots: await readSnapshots(), settings: await getSettings(),
      bytes: await chrome.storage.local.getBytesInUse("snapshots"), budget: SNAPSHOT_BUDGET };
    case "captureNow": return captureSnapshot();
    case "restoreSnapshot": return restoreSnapshot(message.snapshotId, message.selection);
    case "deleteSnapshot": return deleteSnapshot(message.snapshotId);
    case "clearSnapshots": await writeSnapshots([]); return { message: "All snapshots deleted." };
    case "importSnapshots": return importSnapshots(message.data);
    case "dismissError": await chrome.storage.session.remove("lastError"); return {};
    default: throw Error("Unknown TabFolio action.");
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Accept only our extension pages, not other extensions or website scripts.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  if (["pause", "groupPolicy", "moveTab", "mergeSameNameGroups", "sortGroups", "renameGroup", "undo", "restoreSnapshot", "focusTab", "collapseGroup"].includes(message.action)) {
    interactionRevision++;
    _groupActivityRevision++;
  }
  exclusive(() => handleMessage(message)).then(result => respond({ success: true, ...result }))
    .catch(err => respond({ success: false, error: err.message }));
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId }) => updateGroupActivity({ activatedTabId: tabId }));
chrome.tabs.onCreated.addListener(tab => {
  if (restoring) return;
  return eventTask(async () => { await organizeTab(tab.id); await refreshBadge(); });
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && change.groupId !== undefined) void updateGroupActivity({ touchedGroupId: tab.groupId });
  const manualMembership = change.groupId !== undefined && !consumeMembership(tabId, change.groupId) && !restoring;
  if (manualMembership) interactionRevision++;
  if (restoring) return;
  return eventTask(async () => {
    if (manualMembership) {
      const state = await loadState();
      state.tabOverrides[tabId] = "manual";
      if (change.groupId >= 0) {
        const group = await chrome.tabGroups.get(change.groupId).catch(() => null);
        if (group) Object.assign(policyFor(state, group), { mode: "manual", matchPending: false });
      }
      state.undo = null;
      await saveState(state);
    }
    if (change.url) { await organizeTab(tabId); await saveState(await loadState()); }
    if (change.url || change.status === "complete") await refreshBadge();
  });
});
chrome.tabs.onRemoved.addListener(tabId => {
  expectedMembership.delete(tabId);
  return eventTask(async () => { await saveState(await loadState()); await refreshBadge(); });
});
chrome.tabGroups.onUpdated.addListener(group => {
  if (!group.collapsed) void touchGroup(group.id);
  if (restoring) return;
  return eventTask(async () => {
    const state = await loadState();
    const policy = policyFor(state, group);
    if (policy.title !== group.title || policy.color !== group.color) {
      Object.assign(policy, { mode: "manual", matchPending: false, title: group.title, color: group.color });
      state.undo = null;
    }
    await saveState(state);
  });
});
chrome.tabGroups.onMoved.addListener(group => {
  const expected = expectedMoves.get(group.id) > Date.now();
  expectedMoves.delete(group.id);
  if (expected || restoring) return;
  interactionRevision++;
  return eventTask(async () => {
    const state = await loadState();
    state.manualOrder[group.windowId] = true;
    state.undo = null;
    await saveState(state);
  });
});
chrome.tabGroups.onRemoved.addListener(group => {
  expectedMoves.delete(group.id);
  return eventTask(async () => saveState(await loadState()));
});
chrome.alarms.onAlarm.addListener(alarm => eventTask(async () => {
  if (alarm.name === AUTO_COLLAPSE_ALARM) { await autoCollapseIdleGroups(); await refreshBadge(); }
  if (alarm.name === SNAPSHOT_ALARM) await captureSnapshot({ automatic: true });
}));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-tabfolio" && tab?.windowId != null) return chrome.sidePanel.open({ windowId: tab.windowId });
  if (command === "collapse-all-groups") return eventTask(async () => collapseAllGroups((await chrome.windows.getLastFocused()).id));
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "atg-panel") return chrome.sidePanel.open({ windowId: tab.windowId });
  if (info.menuItemId === "atg-merge-groups") {
    interactionRevision++;
    _groupActivityRevision++;
  }
  return eventTask(async () => {
    if (info.menuItemId === "atg-merge-groups") {
      const result = await mergeSameNameGroups(tab.windowId);
      await chrome.storage.session.set({ lastError: result.partial ? result.message : null });
      return result;
    }
    if (info.menuItemId === "atg-ungroup") return moveTab(tab.id, -1);
    if (info.menuItemId === "atg-collapse-all") return collapseAllGroups(tab.windowId);
    if (info.menuItemId === "atg-exclude") {
      const host = TF.httpUrl(tab.url)?.hostname;
      if (!host) return;
      const settings = await getSettings();
      await chrome.storage.sync.set({ excludedDomains: [...new Set([...settings.excludedDomains, host])] });
      if (tab.groupId >= 0 && !tab.pinned) await moveTab(tab.id, -1);
    }
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") return eventTask(async () => { await setupAlarms(); await refreshBadge(); });
});
chrome.runtime.onInstalled.addListener(details => eventTask(async () => {
  // These APIs only gained Promise support in Chrome 123. Use callbacks to
  // preserve ordering on our Chrome 116 baseline and avoid duplicate menu IDs.
  const menuCallback = (resolve, reject) => () => {
    const error = chrome.runtime.lastError;
    if (error) reject(Error(error.message)); else resolve();
  };
  await new Promise((resolve, reject) => chrome.contextMenus.removeAll(menuCallback(resolve, reject)));
  await new Promise((resolve, reject) => chrome.contextMenus.create({ id: "atg-root", title: "TabFolio", contexts: ["page"] }, menuCallback(resolve, reject)));
  for (const [id, title] of [["atg-panel", "Open tab panel"], ["atg-exclude", "Exclude this domain"],
    ["atg-ungroup", "Keep this tab ungrouped"], ["atg-collapse-all", "Collapse idle groups"], ["atg-merge-groups", "Merge identical groups"]]) {
    await new Promise((resolve, reject) => chrome.contextMenus.create({ id, title, parentId: "atg-root", contexts: ["page"] }, menuCallback(resolve, reject)));
  }
  await setupAlarms();
  await loadState();
  await updateGroupActivity();
  for (const tab of await chrome.tabs.query({})) await organizeTab(tab.id);
  if (details.reason === "install") await captureSnapshot({ automatic: true });
}));
chrome.runtime.onStartup.addListener(() => eventTask(async () => {
  await setupAlarms();
  await loadState();
  // Group IDs are only meaningful within a browser session. A reused ID must
  // not inherit another group's expired timer from the previous session.
  await chrome.storage.local.set({ groupActivity: {}, groupActiveIds: [] });
  await updateGroupActivity();
}));
// Reconcile persistent alarms on every worker start; Chrome can clear them across
// browser restarts. API calls do not keep an otherwise idle worker alive.
eventTask(async () => {
  const { restoreInProgress, restoreWindowIds = [] } = await chrome.storage.session.get(["restoreInProgress", "restoreWindowIds"]);
  if (restoreInProgress) {
    const state = await loadState();
    for (const tab of await chrome.tabs.query({})) if (restoreWindowIds.includes(tab.windowId)) state.tabOverrides[tab.id] = "manual";
    for (const group of await chrome.tabGroups.query({})) if (restoreWindowIds.includes(group.windowId)) policyFor(state, group).mode = "manual";
    for (const id of restoreWindowIds) state.manualOrder[id] = true;
    await saveState(state);
    await chrome.storage.session.set({ restoreInProgress: false, restoreWindowIds: [], lastError: "The previous restore was interrupted. Opened tabs were kept; inspect the new windows before retrying." });
  }
  await loadState();
  await setupAlarms();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await refreshBadge();
});
