// All operations that rearrange tabs or write automation state share one queue.
let operationQueue = Promise.resolve();
let interactionRevision = 0;
let restoring = false;
const expectedMembership = new Map();
const expectedMoves = new Map();

function exclusive(fn) {
  const next = operationQueue.then(fn);
  operationQueue = next.catch(() => {});
  return next;
}
function eventTask(fn) {
  return exclusive(fn).catch(async err => {
    console.warn("[TabFolio]", err);
    await chrome.storage.session.set({ lastError: err.message }).catch(() => {});
  });
}
async function getSettings() { return TF.settings(await chrome.storage.sync.get(TF.defaults)); }
function groupSignature(group, tabs) {
  return JSON.stringify([group.title, group.color, tabs.filter(t => t.groupId === group.id).map(t => t.url || t.pendingUrl || "").sort()]);
}
async function loadState() {
  const { automationState } = await chrome.storage.session.get("automationState");
  if (automationState) {
    const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
    const pending = groups.filter(g => !automationState.groups[g.id] || automationState.groups[g.id].matchPending);
    const changed = bindPreferences(automationState, pending, tabs);
    const tabsChanged = bindManualTabs(automationState, tabs);
    // Reading the panel model must not trigger another storage refresh unless
    // Chrome actually restored a previously unseen preference.
    if (changed || tabsChanged) await chrome.storage.session.set({ automationState });
    return automationState;
  }
  const [{ groupPreferences = [], manualTabUrls = [], pauseUntil = 0 }, groups, tabs] = await Promise.all([
    chrome.storage.local.get(["groupPreferences", "manualTabUrls", "pauseUntil"]), chrome.tabGroups.query({}), chrome.tabs.query({})]);
  const state = { groups: {}, tabOverrides: {}, manualOrder: {}, pauseUntil, undo: null,
    startupPreferences: groupPreferences, startupManualTabUrls: manualTabUrls };
  bindPreferences(state, groups, tabs);
  bindManualTabs(state, tabs);
  await chrome.storage.session.set({ automationState: state });
  return state;
}
function bindPreferences(state, groups, tabs) {
  let changed = false;
  for (const group of groups) {
    const signature = groupSignature(group, tabs);
    const matches = (state.startupPreferences || []).filter(p => p.signature === signature);
    // Ambiguous or previously unknown groups are always treated as user-owned.
    const preference = matches.length === 1 ? matches[0] : {};
    const policy = { mode: preference.mode || "manual", routeKey: preference.routeKey || null,
      keepExpanded: !!preference.keepExpanded, title: group.title, color: group.color, matchPending: matches.length === 0 };
    if (JSON.stringify(state.groups[group.id]) !== JSON.stringify(policy)) {
      state.groups[group.id] = policy;
      changed = true;
    }
    if (preference.orderLocked && !state.manualOrder[group.windowId]) { state.manualOrder[group.windowId] = true; changed = true; }
  }
  return changed;
}
function bindManualTabs(state, tabs) {
  const saved = new Set(state.startupManualTabUrls || []);
  let changed = false;
  for (const tab of tabs) if (!tab.incognito && tab.groupId < 0 && state.tabOverrides[tab.id] == null && saved.has(tab.pendingUrl || tab.url)) {
    state.tabOverrides[tab.id] = "manual";
    changed = true;
  }
  return changed;
}
async function saveState(state) {
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
  const liveGroups = new Set(groups.map(g => String(g.id)));
  const liveTabs = new Set(tabs.map(t => String(t.id)));
  for (const key of Object.keys(state.groups)) if (!liveGroups.has(key)) delete state.groups[key];
  for (const key of Object.keys(state.tabOverrides)) if (!liveTabs.has(key)) delete state.tabOverrides[key];
  await chrome.storage.session.set({ automationState: state });
  await chrome.storage.local.set({ pauseUntil: state.pauseUntil,
    // Group policies already protect grouped tabs. Persist URL-based overrides
    // only for ungrouped tabs, otherwise a new copy of a merged member's URL
    // inherits a manual override on restart and cannot join its site group.
    manualTabUrls: [...new Set(tabs.filter(t => !t.incognito && t.groupId < 0 && state.tabOverrides[t.id] === "manual").map(t => t.pendingUrl || t.url).filter(Boolean))],
    groupPreferences: groups.filter(group => tabs.some(t => !t.incognito && t.groupId === group.id))
      .map(group => ({ ...state.groups[group.id], orderLocked: !!state.manualOrder[group.windowId], signature: groupSignature(group, tabs) })) });
}
const policyFor = (state, group) => state.groups[group.id] ||= { mode: "manual", keepExpanded: false, routeKey: null, title: group.title, color: group.color };
const isPaused = state => state.pauseUntil > Date.now();

function expectMembership(ids, target) {
  for (const id of [].concat(ids)) {
    const pending = expectedMembership.get(id) || [];
    pending.push({ target, until: Date.now() + 10000 });
    expectedMembership.set(id, pending);
  }
}
function consumeMembership(tabId, groupId) {
  const pending = (expectedMembership.get(tabId) || []).filter(p => p.until > Date.now());
  const index = pending.findIndex(p => p.target === groupId || p.target === "new" && groupId >= 0);
  if (index >= 0) pending.splice(index, 1);
  if (pending.length) expectedMembership.set(tabId, pending); else expectedMembership.delete(tabId);
  return index >= 0;
}
async function assignGroup(tabIds, groupId) {
  expectMembership(tabIds, groupId ?? "new");
  try { return await chrome.tabs.group(groupId == null ? { tabIds } : { tabIds, groupId }); }
  catch (err) { for (const id of [].concat(tabIds)) expectedMembership.delete(id); throw err; }
}
async function ungroupTabs(tabIds) {
  expectMembership(tabIds, -1);
  try { await chrome.tabs.ungroup(tabIds); }
  catch (err) { for (const id of [].concat(tabIds)) expectedMembership.delete(id); throw err; }
}
async function layout(windowId) {
  const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const groups = await chrome.tabGroups.query({ windowId });
  return { windowId, tabs: tabs.map(t => ({ id: t.id, groupId: t.groupId, pinned: t.pinned, index: t.index })),
    groups: groups.map(g => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed })).sort((a, b) => a.id - b.id) };
}
function sameLayout(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function existingRouteGroup(groups, target, settings, state, incomingTabId) {
  const automatic = groups.find(g => state.groups[g.id]?.mode === "auto" && state.groups[g.id]?.routeKey === target.key);
  if (automatic) return automatic;
  const candidates = groups.filter(group => {
    const policy = policyFor(state, group);
    return policy.mode === "manual" && (policy.routeKey === target.key || (group.title || "").trim().toLowerCase() === target.title);
  });
  if (!candidates.length) return;
  const tabs = await chrome.tabs.query({ windowId: candidates[0].windowId });
  // A matching name identifies a possible site group; live member URLs confirm
  // its domain. This also recognizes every site in an explicitly merged group
  // without confusing unrelated product domains that share a label such as docs.
  const members = group => tabs.filter(t => t.groupId === group.id && t.id !== incomingTabId);
  return candidates.filter(group => {
    const entries = members(group);
    return entries.length && entries.every(t => !t.incognito && !t.pinned) &&
      entries.some(t => TF.route(t.pendingUrl || t.url, settings)?.key === target.key);
  }).sort((a, b) => Math.min(...members(a).map(t => t.index)) - Math.min(...members(b).map(t => t.index)))[0];
}

async function groupTabInternal(tab, settings, state) {
  if (!settings.autoGroup || isPaused(state) || tab.pinned || tab.incognito || state.tabOverrides[tab.id] === "manual") return false;
  const target = TF.route(tab.pendingUrl || tab.url, settings);
  if (!target) return false;
  const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
  const current = groups.find(g => g.id === tab.groupId);
  if (current) {
    const policy = policyFor(state, current);
    if (policy.mode !== "auto") return false;
    if (policy.routeKey === target.key) return false;
  }
  const existing = await existingRouteGroup(groups, target, settings, state, tab.id);
  const id = await assignGroup(tab.id, existing?.id);
  if (existing) {
    policyFor(state, existing).matchPending = false;
    await chrome.tabGroups.update(id, { collapsed: false });
  } else {
    await chrome.tabGroups.update(id, { title: target.title, color: target.color, collapsed: false });
    state.groups[id] = { mode: "auto", routeKey: target.key, keepExpanded: false, title: target.title, color: target.color };
  }
  await touchGroup(id);
  return true;
}
async function sortGroupsInternal(windowId, settings, state) {
  if (!settings.sortAlpha || state.manualOrder[windowId] || isPaused(state)) return;
  const groups = await chrome.tabGroups.query({ windowId });
  // Preserve user-owned groups and their positions. Sorting is opt-in by enabling
  // management on all groups in a window, and stops after a manual group move.
  if (groups.some(g => policyFor(state, g).mode !== "auto")) return;
  const tabs = await chrome.tabs.query({ windowId });
  const start = g => Math.min(...tabs.filter(t => t.groupId === g.id).map(t => t.index));
  const current = [...groups].sort((a, b) => start(a) - start(b));
  const sorted = [...groups].sort((a, b) => a.title.localeCompare(b.title));
  if (current.every((g, i) => g.id === sorted[i].id)) return;
  for (const group of sorted) {
    const liveTabs = await chrome.tabs.query({ windowId });
    if (Math.max(...liveTabs.filter(t => t.groupId === group.id).map(t => t.index)) === liveTabs.length - 1) continue;
    expectedMoves.set(group.id, Date.now() + 5000);
    try { await chrome.tabGroups.move(group.id, { index: -1 }); }
    catch (err) { expectedMoves.delete(group.id); throw err; }
  }
}
async function organizeTab(tabId) {
  if (restoring) return;
  const state = await loadState();
  const settings = await getSettings();
  if (isPaused(state) || !settings.autoGroup) return;
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const revision = interactionRevision;
  const before = await layout(tab.windowId);
  const policies = structuredClone(state.groups);
  if (revision !== interactionRevision) return;
  const changed = await groupTabInternal(tab, settings, state);
  if (changed) {
    if (revision === interactionRevision) await sortGroupsInternal(tab.windowId, settings, state);
    const after = await layout(tab.windowId);
    state.undo = { label: "Undo last organization", before, after, policies };
  }
  await saveState(state);
}
async function sortGroups(windowId) {
  if (windowId !== null && (!Number.isInteger(windowId) || windowId < 0)) throw Error("Choose a valid window scope.");
  const revision = interactionRevision;
  const query = windowId === null ? {} : { windowId };
  const [groups, tabs, state] = await Promise.all([chrome.tabGroups.query(query), chrome.tabs.query(query), loadState()]);
  const windows = new Map();
  for (const group of groups) {
    const members = tabs.filter(t => t.groupId === group.id);
    if (!members.length || members.some(t => t.incognito || t.pinned || t.windowId !== group.windowId)) continue;
    if (!windows.has(group.windowId)) windows.set(group.windowId, []);
    windows.get(group.windowId).push(group);
  }
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const compare = (a, b) => {
    const first = (a.title || "").trim(), second = (b.title || "").trim();
    return Number(!first) - Number(!second) || collator.compare(first, second);
  };
  // Ignore positions that our own moves change, but detect native edits to
  // names, membership or window contents before issuing each group move.
  const signature = (entries, members) => JSON.stringify([
    [...entries].sort((a, b) => a.id - b.id).map(g => [g.id, g.title || ""]),
    [...members].sort((a, b) => a.id - b.id).map(t => [t.id, t.groupId, !!t.pinned, !!t.incognito])]);
  const result = { sortedWindows: 0, movedGroups: 0, skippedWindows: 0, failures: [] };
  for (const [id, entries] of windows) {
    const windowTabs = tabs.filter(t => t.windowId === id);
    const start = group => Math.min(...windowTabs.filter(t => t.groupId === group.id).map(t => t.index));
    const current = [...entries].sort((a, b) => start(a) - start(b));
    // Stable sorting retains the existing order of duplicate/equivalent names.
    const sorted = [...current].sort(compare);
    if (current.every((g, i) => g.id === sorted[i].id)) continue;
    const expected = signature(groups.filter(g => g.windowId === id), windowTabs);
    state.manualOrder[id] = true;
    state.undo = null;
    await saveState(state);
    let completed = true;
    for (const group of sorted) {
      const [liveGroups, liveTabs] = await Promise.all([chrome.tabGroups.query({ windowId: id }), chrome.tabs.query({ windowId: id })]);
      if (revision !== interactionRevision || signature(liveGroups, liveTabs) !== expected) {
        result.skippedWindows++; completed = false; break;
      }
      const members = liveTabs.filter(t => t.groupId === group.id);
      if (Math.max(...members.map(t => t.index)) === liveTabs.length - 1) continue;
      // Use native group moves so member order, active tabs and collapse state
      // are retained. No tab is regrouped or transferred to another window.
      expectedMoves.set(group.id, Date.now() + 5000);
      try { await chrome.tabGroups.move(group.id, { index: -1 }); result.movedGroups++; }
      catch (err) {
        expectedMoves.delete(group.id); result.failures.push(err.message); completed = false; break;
      }
    }
    if (completed) result.sortedWindows++;
  }
  result.partial = result.skippedWindows > 0 || result.failures.length > 0;
  result.message = (result.sortedWindows ? `Sorted groups A–Z in ${result.sortedWindows} window(s).`
    : result.partial ? "Group sorting was interrupted." : "Groups are already in alphabetical order in the selected window scope.") +
    (result.skippedWindows ? ` ${result.skippedWindows} changed window(s) skipped; review and try again.` : "") +
    (result.failures.length ? ` ${result.failures.length} operation(s) failed.\n${result.failures.join("\n")}` : "");
  return result;
}
async function undoOrganization() {
  const state = await loadState();
  const undo = state.undo;
  if (!undo) throw Error("There is no automatic organization to undo.");
  if (!sameLayout(await layout(undo.after.windowId), undo.after)) {
    state.undo = null; await saveState(state);
    throw Error("This window changed after organization. Undo is no longer available.");
  }
  const groupMap = new Map();
  for (const group of undo.before.groups) {
    const ids = undo.before.tabs.filter(t => t.groupId === group.id).map(t => t.id);
    if (!ids.length) continue;
    const exists = await chrome.tabGroups.get(group.id).catch(() => null);
    const newId = await assignGroup(ids, exists?.id);
    groupMap.set(group.id, newId);
    await chrome.tabGroups.update(newId, { title: group.title, color: group.color, collapsed: false });
    state.groups[newId] = { mode: "manual", routeKey: null, keepExpanded: !!undo.policies?.[group.id]?.keepExpanded, title: group.title, color: group.color };
  }
  for (const tab of undo.before.tabs) if (tab.groupId < 0 && !tab.pinned) { await ungroupTabs(tab.id); state.tabOverrides[tab.id] = "manual"; }
  const movedGroups = new Set();
  for (const tab of undo.before.tabs) {
    if (tab.groupId < 0) await chrome.tabs.move(tab.id, { index: tab.index });
    else if (!movedGroups.has(tab.groupId)) {
      movedGroups.add(tab.groupId);
      const groupId = groupMap.get(tab.groupId);
      expectedMoves.set(groupId, Date.now() + 5000);
      await chrome.tabGroups.move(groupId, { index: tab.index });
    }
  }
  // Once groups occupy their original slots, restore order only within them.
  for (const tab of undo.before.tabs) if (tab.groupId >= 0) await chrome.tabs.move(tab.id, { index: tab.index });
  for (const group of undo.before.groups) if (groupMap.has(group.id)) await chrome.tabGroups.update(groupMap.get(group.id), { collapsed: group.collapsed });
  state.manualOrder[undo.before.windowId] = true;
  state.undo = null;
  await saveState(state);
  return { message: "Organization undone. Your arrangement is protected." };
}
async function setGroupPolicy(groupId, patch) {
  const group = await chrome.tabGroups.get(groupId);
  const state = await loadState();
  const policy = policyFor(state, group);
  policy.matchPending = false;
  if (typeof patch.keepExpanded === "boolean") {
    policy.keepExpanded = patch.keepExpanded;
    if (patch.keepExpanded) await chrome.tabGroups.update(groupId, { collapsed: false });
    await touchGroup(groupId);
  }
  if (["auto", "manual"].includes(patch.mode)) {
    policy.mode = patch.mode;
    if (patch.mode === "auto") {
      const settings = await getSettings();
      const tabs = await chrome.tabs.query({ groupId });
      const keys = new Set(tabs.map(t => TF.route(t.url, settings)?.key).filter(Boolean));
      policy.routeKey = keys.size === 1 ? [...keys][0] : null;
      for (const tab of tabs) state.tabOverrides[tab.id] = "auto";
    }
  }
  await saveState(state);
  return { message: patch.mode ? policy.mode === "auto" ? "Automatic management enabled." : "Your group arrangement is protected."
    : policy.keepExpanded ? "This group will stay expanded." : "This group can collapse after the idle delay." };
}
async function moveTab(tabId, targetGroupId, windowId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.pinned) throw Error("Unpin this tab in Chrome before moving it to a group.");
  const state = await loadState();
  if (targetGroupId >= 0) {
    const target = await chrome.tabGroups.get(targetGroupId);
    if (tab.windowId !== target.windowId) await chrome.tabs.move(tabId, { windowId: target.windowId, index: -1 });
    await assignGroup(tabId, target.id);
    Object.assign(policyFor(state, target), { mode: "manual", matchPending: false });
    await chrome.tabGroups.update(target.id, { collapsed: false });
  } else {
    await ungroupTabs(tabId);
    if (Number.isInteger(windowId) && windowId !== tab.windowId) await chrome.tabs.move(tabId, { windowId, index: -1 });
  }
  state.tabOverrides[tabId] = "manual";
  state.undo = null;
  await saveState(state);
  return { message: "Tab moved. Your choice is protected." };
}
async function mergeSameNameGroups(windowId) {
  // null explicitly selects all windows. Never interpret a missing/invalid ID
  // as permission to rearrange every window.
  if (windowId !== null && (!Number.isInteger(windowId) || windowId < 0)) throw Error("Choose a valid window scope.");
  const query = windowId === null ? {} : { windowId };
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query(query), chrome.tabs.query(query)]);
  const buckets = new Map();
  const tabGroups = new Map();
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    if (!tabGroups.has(tab.groupId)) tabGroups.set(tab.groupId, []);
    tabGroups.get(tab.groupId).push(tab);
  }
  const members = group => tabGroups.get(group.id) || [];
  for (const group of groups.sort((a, b) => (members(a)[0]?.index ?? Infinity) - (members(b)[0]?.index ?? Infinity))) {
    const entries = members(group);
    if (!group.title?.trim() || !entries.length || entries.some(t => t.incognito || t.pinned || t.windowId !== group.windowId)) continue;
    // A Map and tuple key keep arbitrary group titles inert and windows separate.
    const key = JSON.stringify([group.windowId, group.title]);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(group);
  }
  const sets = [...buckets.values()].filter(entries => entries.length > 1);
  const result = { mergedGroups: 0, mergedSets: 0, movedTabs: 0, skippedGroups: 0, failures: [] };
  if (!sets.length) return { ...result, partial: false, message: "No groups with identical non-empty names in the selected window scope." };
  const state = await loadState();
  const revision = interactionRevision;
  for (const [originalTarget, ...sources] of sets) {
    let mergedSet = false;
    for (const source of sources) {
      const [target, liveSource, targetTabs, sourceTabs] = await Promise.all([
        chrome.tabGroups.get(originalTarget.id).catch(() => null), chrome.tabGroups.get(source.id).catch(() => null),
        chrome.tabs.query({ groupId: originalTarget.id }), chrome.tabs.query({ groupId: source.id })]);
      // Native Chrome edits can occur outside our queue. Recheck before each
      // source group so a renamed, moved, closed or private group is never swept in.
      if (revision !== interactionRevision || !target || !liveSource || target.title !== originalTarget.title || liveSource.title !== originalTarget.title ||
        target.windowId !== originalTarget.windowId || liveSource.windowId !== target.windowId || !targetTabs.length || !sourceTabs.length ||
        [...targetTabs, ...sourceTabs].some(t => t.incognito || t.pinned || t.windowId !== target.windowId)) {
        result.skippedGroups++; continue;
      }
      targetTabs.sort((a, b) => a.index - b.index); sourceTabs.sort((a, b) => a.index - b.index);
      const keepExpanded = !!(policyFor(state, target).keepExpanded || policyFor(state, liveSource).keepExpanded);
      const collapsed = target.collapsed && liveSource.collapsed && !keepExpanded && ![...targetTabs, ...sourceTabs].some(t => t.active);
      for (const group of [target, liveSource]) Object.assign(policyFor(state, group), { mode: "manual", routeKey: null,
        matchPending: false, title: group.title, color: group.color });
      state.groups[target.id].keepExpanded = keepExpanded;
      for (const tab of [...targetTabs, ...sourceTabs]) state.tabOverrides[tab.id] = "manual";
      state.manualOrder[target.windowId] = true;
      state.undo = null;
      // Protect the participating tabs before native mutations, including if
      // the worker stops or Chrome refuses an edit while a tab is being dragged.
      await saveState(state);
      try {
        // Expand before grouping so an active source tab is never put in a
        // hidden group. Revalidate after this asynchronous native edit too.
        await chrome.tabGroups.update(target.id, { collapsed: false });
        const [checkedTarget, checkedSource, checkedTabs] = await Promise.all([
          chrome.tabGroups.get(target.id).catch(() => null), chrome.tabGroups.get(source.id).catch(() => null),
          chrome.tabs.query({ windowId: target.windowId })]);
        if (revision !== interactionRevision || checkedTarget?.title !== target.title || checkedSource?.title !== target.title ||
          checkedTarget?.windowId !== target.windowId || checkedSource?.windowId !== target.windowId ||
          [...targetTabs, ...sourceTabs].some(tab => !checkedTabs.some(live => live.id === tab.id && live.groupId === tab.groupId &&
            live.index === tab.index && !live.pinned && !live.incognito)) ||
          checkedTabs.filter(t => t.groupId === target.id || t.groupId === source.id).length !== targetTabs.length + sourceTabs.length) {
          result.skippedGroups++; continue;
        }
        await assignGroup(sourceTabs.map(t => t.id), target.id);
        const ordered = [...targetTabs, ...sourceTabs];
        const start = Math.min(...(await chrome.tabs.query({ groupId: target.id })).map(t => t.index));
        for (const [offset, tab] of ordered.entries()) {
          const live = await chrome.tabs.get(tab.id);
          if (revision !== interactionRevision || live.groupId !== target.id || live.windowId !== target.windowId || live.pinned || live.incognito)
            throw Error("The workspace changed during merging. Review the remaining groups and try again.");
          if (live.index !== start + offset) await chrome.tabs.move(live.id, { index: start + offset });
        }
        const active = (await chrome.tabs.query({ groupId: target.id })).some(t => t.active);
        await chrome.tabGroups.update(target.id, { collapsed: collapsed && !active });
        await touchGroup(target.id);
      } catch (err) { result.failures.push(err.message); }
      // Report actual membership even if a later ordering/state update failed.
      const liveTabs = await chrome.tabs.query({ windowId: target.windowId });
      const moved = sourceTabs.filter(t => liveTabs.some(live => live.id === t.id && live.groupId === target.id));
      result.movedTabs += moved.length;
      if (moved.length === sourceTabs.length && !liveTabs.some(t => t.groupId === source.id)) { result.mergedGroups++; mergedSet = true; }
      await saveState(state);
    }
    if (mergedSet) result.mergedSets++;
  }
  result.partial = result.skippedGroups > 0 || result.failures.length > 0;
  result.message = `Merged ${result.mergedGroups} extra group(s) into ${result.mergedSets} group(s), moving ${result.movedTabs} tab(s).` +
    (result.mergedGroups ? " Merged arrangements are protected." : "") +
    (result.skippedGroups ? ` ${result.skippedGroups} changed group(s) skipped; review and try again.` : "") +
    (result.failures.length ? ` ${result.failures.length} operation(s) failed.\n${result.failures.join("\n")}` : "");
  return result;
}
async function closeDuplicates(selection) {
  if (!Array.isArray(selection) || !selection.length) throw Error("Choose duplicate tabs to close first.");
  const all = await chrome.tabs.query({});
  const selected = new Set(selection.map(item => item.id));
  if (selected.size !== selection.length) throw Error("Invalid duplicate selection.");
  for (const item of selection) {
    const tab = all.find(t => t.id === item.id);
    if (!tab || !TF.duplicateKey(item.url) || TF.duplicateKey(tab.pendingUrl || tab.url) !== TF.duplicateKey(item.url)) throw Error("A selected tab changed. Review the duplicates again.");
    if (tab.pinned || tab.active || tab.audible || tab.incognito) throw Error("Active, pinned, audible and private tabs are protected.");
    if (!all.some(t => !selected.has(t.id) && !t.incognito && TF.duplicateKey(t.pendingUrl || t.url) === TF.duplicateKey(item.url))) throw Error("Keep at least one copy of every URL.");
  }
  // Recheck each URL immediately before closing; tab navigation may occur while
  // a review screen is open. No tab is selected for deletion automatically.
  let closed = 0;
  for (const item of selection) {
    const live = await chrome.tabs.get(item.id).catch(() => null);
    const copies = await chrome.tabs.query({});
    if (!live || live.active || live.pinned || live.audible || TF.duplicateKey(live.pendingUrl || live.url) !== TF.duplicateKey(item.url) ||
      !copies.some(t => !selected.has(t.id) && !t.incognito && TF.duplicateKey(t.pendingUrl || t.url) === TF.duplicateKey(item.url))) continue;
    try { await chrome.tabs.remove(item.id); closed++; } catch { /* report actual count */ }
  }
  return { message: `Closed ${closed} of ${selection.length} selected tabs.`, closed };
}
