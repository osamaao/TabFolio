let model, currentWindowId, view = "tabs", refreshTimer;
let refreshGeneration = 0;
let groupToolBusy = false;
const selected = new Map();
const $ = id => document.getElementById(id);

async function refresh() {
  const generation = ++refreshGeneration;
  try {
    const next = await UI.send("getModel");
    if (generation !== refreshGeneration) return;
    model = next;
    if (model.lastError) UI.status(model.lastError, true);
    render();
  } catch (err) { UI.status(err.message, true); }
}
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); }
function matches(tab) {
  const group = model.groups.find(g => g.id === tab.groupId);
  const term = $("search").value.trim().toLowerCase();
  return (!term || [tab.title, tab.url, group?.title].some(text => text?.toLowerCase().includes(term))) &&
    ($("scope").value === "all" || tab.windowId === currentWindowId);
}
async function action(name, args) { const result = await UI.act(name, args); await refresh(); return result; }
function tabRow(tab, duplicate = false) {
  const row = UI.el("div", "tab-row" + (tab.active ? " active" : ""));
  if (duplicate) {
    const check = UI.el("input"); check.type = "checkbox";
    check.setAttribute("aria-label", `Select ${tab.title || tab.url} in window ${tab.windowId} to close`);
    check.disabled = !!(tab.active || tab.pinned || tab.audible);
    check.checked = selected.has(tab.id);
    check.dataset.focusKey = `select-${tab.id}`;
    check.addEventListener("change", () => { if (check.checked) selected.set(tab.id, { id: tab.id, url: tab.pendingUrl || tab.url }); else selected.delete(tab.id); updateSelection(); });
    row.append(check);
  }
  const focus = UI.button("", () => action("focusTab", { tabId: tab.id }), "tab-focus");
  focus.dataset.focusKey = `tab-${tab.id}`;
  focus.title = tab.url || "New tab";
  focus.setAttribute("aria-label", `Switch to ${tab.title || tab.url || "New tab"}`);
  focus.append(UI.el("span", "tab-initial", UI.hostname(tab.url).replace(/^www\./, "").slice(0, 1).toUpperCase()));
  const copy = UI.el("span", "tab-copy");
  copy.append(UI.el("span", "tab-name", tab.title || tab.url || "New tab"));
  const states = [UI.hostname(tab.url), tab.pinned && "Pinned", tab.audible && "Audio", tab.active && "Active", ($("scope").value === "all" || duplicate) && `Window ${tab.windowId}`].filter(Boolean);
  copy.append(UI.el("span", "tab-url", states.join(" · ")));
  focus.append(copy); row.append(focus);
  if (!duplicate) {
    const move = UI.button("Move", () => showMove(tab), "quiet small");
    move.dataset.focusKey = `move-${tab.id}`;
    move.setAttribute("aria-label", `Move ${tab.title || "tab"}`);
    move.disabled = !!tab.pinned;
    row.append(move);
  }
  return row;
}
function groupOptions(group) {
  const options = UI.el("details", "group-options"); options.dataset.groupId = String(group.id);
  const summary = UI.el("summary", "", "Group options"); summary.dataset.focusKey = `options-${group.id}`;
  options.append(summary);
  const policy = model.state.groups[group.id] || { mode: "manual" };
  const mode = UI.el("select"); mode.setAttribute("aria-label", `Management for ${group.title}`);
  mode.dataset.focusKey = `mode-${group.id}`;
  for (const [value, label] of [["manual", "Keep my arrangement"], ["auto", "Manage automatically"]]) {
    const option = UI.el("option", "", label); option.value = value; mode.append(option);
  }
  mode.value = policy.mode;
  mode.addEventListener("change", async () => { try { await action("groupPolicy", { groupId: group.id, patch: { mode: mode.value } }); } catch (err) { UI.status(err.message, true); } });
  const label = UI.el("label"), keep = UI.el("input"); keep.type = "checkbox"; keep.checked = !!policy.keepExpanded;
  keep.dataset.focusKey = `keep-${group.id}`;
  keep.addEventListener("change", async () => { try { await action("groupPolicy", { groupId: group.id, patch: { keepExpanded: keep.checked } }); } catch (err) { UI.status(err.message, true); } });
  label.append(keep, document.createTextNode("Keep expanded"));
  const buttons = UI.el("div", "row");
  buttons.append(UI.button("Rename", () => showRename(group), "small"), UI.button(group.collapsed ? "Expand in Chrome" : "Collapse in Chrome", () => action("collapseGroup", { groupId: group.id, collapsed: !group.collapsed }), "small"));
  [...buttons.children].forEach((button, index) => { button.dataset.focusKey = `group-action-${group.id}-${index}`; });
  options.append(mode, label, buttons);
  return options;
}
function render() {
  if (!model) return;
  const open = new Set([...document.querySelectorAll("details[open]")].map(el => el.dataset.groupId));
  const focusKey = document.activeElement?.dataset.focusKey;
  const results = $("results"); results.replaceChildren();
  const paused = model.state.pauseUntil > Date.now();
  $("automationStatus").textContent = paused ? `Paused · ${Math.ceil((model.state.pauseUntil - Date.now()) / 60000)} min left` : "Automation active";
  $("pause").value = "";
  $("pause").options[1].textContent = paused ? "Resume automation" : "Keep automation running";
  $("undo").disabled = !model.state.undo;
  $("mergeGroups").disabled = $("sortGroups").disabled = groupToolBusy || model.restoring;
  $("mergeGroups").title = `Merge exact, non-empty group names ${$("scope").value === "all" ? "within each window" : "in this window"}, regardless of search. Keeps the first group's color and protects the merged arrangement.`;
  $("sortGroups").title = `Sort groups A–Z ${$("scope").value === "all" ? "within each window" : "in this window"}, regardless of search. Unnamed groups come last.`;
  $("tabsView").setAttribute("aria-pressed", String(view === "tabs"));
  $("duplicatesView").setAttribute("aria-pressed", String(view === "duplicates"));
  const scopedDupes = model.duplicates.filter(set => set.tabs.some(matches));
  $("dupeCount").textContent = scopedDupes.length ? `(${scopedDupes.length})` : "";
  $("reviewActions").hidden = view !== "duplicates";
  const matching = model.tabs.filter(matches).sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  if (view === "duplicates") {
    const visible = new Set(scopedDupes.flatMap(set => set.tabs.map(t => t.id)));
    for (const [id, item] of selected) {
      const tab = model.tabs.find(t => t.id === id);
      if (!visible.has(id) || !tab || tab.active || tab.pinned || tab.audible || TF.duplicateKey(tab.pendingUrl || tab.url) !== TF.duplicateKey(item.url)) selected.delete(id);
    }
    $("resultCount").textContent = `${scopedDupes.length} duplicate set(s) · copies shown across windows`;
    for (const set of scopedDupes) {
      const card = UI.el("section", "group");
      const header = UI.el("div", "group-header"); header.append(UI.el("h2", "group-title", `${set.tabs.length} copies`));
      card.append(header, UI.el("p", "duplicate-url", set.url));
      for (const tab of set.tabs) card.append(tabRow(tab, true));
      results.append(card);
    }
    if (!scopedDupes.length) empty(model.settings.detectDupes ? "No duplicates to review" : "Duplicate review is off", model.settings.detectDupes ? "Matching tabs will appear here. Nothing is closed automatically." : "Enable duplicate detection in Settings.");
    updateSelection();
  } else {
    $("resultCount").textContent = `${matching.length} tab(s)${$("search").value ? " matching your search" : " in this view"}`;
    const buckets = new Map();
    for (const tab of matching) {
      const key = `${tab.windowId}:${tab.groupId}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(tab);
    }
    for (const tabs of buckets.values()) {
      const group = model.groups.find(g => g.id === tabs[0].groupId);
      const card = UI.el("section", "group");
      const header = UI.el("div", "group-header");
      const dot = UI.el("span", `color-dot color-${TF.colors.includes(group?.color) ? group.color : "grey"}`); dot.setAttribute("aria-hidden", "true");
      header.append(dot, UI.el("h2", "group-title", group?.title || (group ? "Untitled group" : "Ungrouped")), UI.el("span", "badge", String(tabs.length)));
      card.append(header);
      if ($("scope").value === "all") card.append(UI.el("p", "duplicate-url", `Window ${tabs[0].windowId}`));
      for (const tab of tabs) card.append(tabRow(tab));
      if (group) { const options = groupOptions(group); options.open = open.has(String(group.id)); card.append(options); }
      results.append(card);
    }
    if (!matching.length) empty("A clear workspace", $("search").value ? "No tabs match. Try a title, site, or group name." : "Your open tabs will appear here.");
  }
  if (focusKey) [...document.querySelectorAll("[data-focus-key]")].find(el => el.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
}
function empty(title, description) { const el = UI.el("div", "empty"); el.append(UI.el("strong", "", title), UI.el("p", "", description)); $("results").append(el); }
function updateSelection() { $("closeSelected").disabled = !selected.size; $("closeSelected").textContent = `Close selected duplicates${selected.size ? ` (${selected.size})` : ""}`; }
function formDialog(title, label, input, submitLabel, submit) {
  const dialog = UI.el("dialog"), form = UI.el("form");
  const heading = UI.el("h2", "", title); heading.id = "edit-title"; dialog.setAttribute("aria-labelledby", heading.id);
  const field = UI.el("label", "field", label); field.append(input);
  const actions = UI.el("div", "actions"), save = UI.el("button", "primary", submitLabel); save.type = "submit";
  actions.append(UI.button("Cancel", () => dialog.close()), save); form.append(heading, field, actions); dialog.append(form); document.body.append(dialog);
  form.addEventListener("submit", async e => { e.preventDefault(); save.disabled = true; try { await submit(input.value); dialog.close(); } catch (err) { UI.status(err.message, true); dialog.close(); } });
  dialog.addEventListener("close", () => dialog.remove()); dialog.showModal(); input.focus();
}
function showRename(group) { const input = UI.el("input"); input.value = group.title; input.required = true; input.maxLength = 100; formDialog("Name this group", "Group name", input, "Save name", title => action("renameGroup", { groupId: group.id, title })); }
function showMove(tab) {
  const select = UI.el("select");
  if (tab.groupId < 0) { const option = UI.el("option", "", "Let TabFolio organize this tab"); option.value = "auto"; select.append(option); }
  for (const [value, title] of [["-1", "Ungrouped · current window"], ...model.groups.map(g => [String(g.id), `${g.title || "Untitled"} · Window ${g.windowId}`])]) {
    const option = UI.el("option", "", title); option.value = value; select.append(option);
  }
  select.value = String(tab.groupId);
  formDialog("Move this tab", "Destination", select, "Move tab", groupId => groupId === "auto" ? action("manageTab", { tabId: tab.id }) : action("moveTab", { tabId: tab.id, groupId: Number(groupId) }));
}
$("search").addEventListener("input", render);
$("scope").addEventListener("change", () => { selected.clear(); render(); });
$("tabsView").addEventListener("click", () => { view = "tabs"; selected.clear(); render(); });
$("duplicatesView").addEventListener("click", () => { view = "duplicates"; render(); });
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("snapshots").addEventListener("click", e => { e.preventDefault(); UI.openPage("snapshots.html"); });
$("pause").addEventListener("change", async () => { try { await action("pause", { minutes: Number($("pause").value) }); } catch (err) { UI.status(err.message, true); } });
$("undo").addEventListener("click", async () => { try { await action("undo"); } catch (err) { UI.status(err.message, true); await refresh(); } });
$("collapse").addEventListener("click", async () => { try { await action("collapseAll", { windowId: currentWindowId }); } catch (err) { UI.status(err.message, true); } });
async function runGroupTool(name) {
  if (groupToolBusy || !model || model.restoring) return;
  groupToolBusy = true; $("mergeGroups").disabled = $("sortGroups").disabled = true;
  try {
    const result = await UI.send(name, { windowId: $("scope").value === "all" ? null : currentWindowId });
    UI.status(result.message, result.partial);
  } catch (err) { UI.status(err.message, true); }
  finally { groupToolBusy = false; $("mergeGroups").disabled = $("sortGroups").disabled = !!model?.restoring; await refresh(); }
}
$("mergeGroups").addEventListener("click", () => runGroupTool("mergeSameNameGroups"));
$("sortGroups").addEventListener("click", () => runGroupTool("sortGroups"));
$("closeSelected").addEventListener("click", async () => {
  if (!await UI.confirm("Close selected duplicates?", `Close ${selected.size} selected tab(s)? Any unsaved content in those tabs may be lost. At least one copy of each URL will remain.`, "Close tabs", true)) return;
  try { await action("closeDuplicates", { selection: [...selected.values()] }); selected.clear(); render(); } catch (err) { UI.status(err.message, true); await refresh(); }
});
document.addEventListener("keydown", e => {
  if (document.querySelector("dialog[open]")) return;
  if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { e.preventDefault(); $("search").focus(); }
  if (e.key === "Escape" && document.activeElement === $("search")) { $("search").value = ""; render(); }
  if (["ArrowDown", "ArrowUp"].includes(e.key) && (document.activeElement === $("search") || document.activeElement.classList.contains("tab-focus"))) {
    const buttons = [...document.querySelectorAll(".tab-focus")]; if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement); e.preventDefault(); buttons[(index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
  }
});
for (const event of [chrome.tabs.onCreated, chrome.tabs.onUpdated, chrome.tabs.onRemoved, chrome.tabs.onActivated, chrome.tabs.onMoved, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.storage.onChanged]) event.addListener(scheduleRefresh);
chrome.windows.getCurrent().then(win => { currentWindowId = win.id; return refresh(); }).catch(err => UI.status(err.message, true));
setInterval(() => { if (model) render(); }, 60000);
