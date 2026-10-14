let data, loading = false;
const $ = id => document.getElementById(id);
const date = snapshot => new Date(snapshot.timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const counts = snapshot => ({ windows: snapshot.windows.length, groups: snapshot.windows.reduce((n, w) => n + w.groups.length, 0), tabs: snapshot.windows.reduce((n, w) => n + w.tabs.length, 0) });
async function refresh() {
  if (loading) return;
  loading = true;
  try { data = await UI.send("getSnapshots"); render(); } catch (err) { UI.status(err.message, true); }
  finally { loading = false; }
}
function render() {
  if (!data) return;
  const open = new Set([...document.querySelectorAll(".snapshot[open]")].map(el => el.dataset.id));
  $("snapshotCount").textContent = `${data.snapshots.length} saved moment${data.snapshots.length === 1 ? "" : "s"}`;
  $("schedule").textContent = data.settings.snapshotsEnabled ? `Auto-save every ${data.settings.snapshotInterval} min · keeps up to ${data.settings.snapshotMax}` : "Auto-save is off · manual snapshots are available";
  $("storageLabel").textContent = `${(data.bytes / 1024 / 1024).toFixed(2)} / ${(data.budget / 1024 / 1024).toFixed(0)} MB`;
  $("storageMeter").value = data.bytes; $("storageMeter").max = data.budget;
  $("export").disabled = !data.snapshots.length; $("clear").disabled = !data.snapshots.length;
  const term = $("snapshotSearch").value.trim().toLowerCase();
  const snapshots = data.snapshots.filter(s => [s.name, date(s), ...s.windows.flatMap(w => [...w.groups.map(g => g.title), ...w.tabs.flatMap(t => [t.title, t.url])])].some(text => text.toLowerCase().includes(term)));
  $("snapshots").replaceChildren();
  if (!snapshots.length) {
    const empty = UI.el("div", "empty"); empty.append(UI.el("strong", "", term ? "No matching snapshots" : "A place to return to"), UI.el("p", "", term ? "Try a different site, group, or date." : "Take your first snapshot to save your current workspace.")); $("snapshots").append(empty);
  }
  for (const snapshot of snapshots) {
    const card = UI.el("details", "card snapshot"); card.dataset.id = snapshot.id; card.open = open.has(snapshot.id);
    const summary = UI.el("summary"); const info = UI.el("span", "snapshot-info");
    info.append(UI.el("span", "snapshot-name", date(snapshot)));
    const count = counts(snapshot); info.append(UI.el("small", "", `${count.windows} window(s) · ${count.groups} group(s) · ${count.tabs} tab(s)`));
    summary.append(info, UI.el("span", "badge", "Preview")); card.append(summary);
    // Build previews on demand so hundreds of saved layouts remain responsive.
    const build = () => { if (!card.querySelector(".snapshot-body")) card.append(preview(snapshot)); };
    if (card.open) build(); card.addEventListener("toggle", () => { if (card.open) build(); });
    $("snapshots").append(card);
  }
}
function preview(snapshot) {
  const body = UI.el("div", "snapshot-body");
  for (const [windowIndex, win] of snapshot.windows.entries()) {
    const section = UI.el("section", "window-preview"); section.append(UI.el("h3", "", `Window ${windowIndex + 1}${win.focused ? " · focused" : ""}`));
    const buckets = new Map();
    for (const tab of win.tabs) { if (!buckets.has(tab.groupKey)) buckets.set(tab.groupKey, []); buckets.get(tab.groupKey).push(tab); }
    for (const [key, tabs] of buckets) {
      const group = win.groups.find(g => g.key === key);
      const box = UI.el("div", "preview-group"); const header = UI.el("div", "row between");
      header.append(UI.el("strong", "", group?.title || (group ? "Untitled group" : "Ungrouped tabs")));
      if (group) header.append(UI.button("Restore group", () => restore(snapshot, { windowIndex, groupKey: group.key }), "small"));
      box.append(header);
      for (const tab of tabs) {
        const row = UI.el("div", "preview-tab"); const text = UI.el("span", "", tab.title || tab.url); text.title = tab.url;
        row.append(text); const flags = [tab.pinned && "Pinned", tab.active && "Active", !TF.httpUrl(tab.url) && "Will skip"].filter(Boolean);
        if (flags.length) row.append(UI.el("small", "", flags.join(" · "))); box.append(row);
      }
      section.append(box);
    }
    body.append(section);
  }
  const actions = UI.el("div", "snapshot-actions");
  actions.append(UI.button("Restore full layout", () => restore(snapshot), "primary"), UI.button("Export this snapshot", () => download([snapshot])),
    UI.button("Delete snapshot", async () => { if (await UI.confirm("Delete this snapshot?", "Export it first if you need a backup. This removes the saved snapshot, not your open tabs.", "Delete snapshot", true)) { await UI.act("deleteSnapshot", { snapshotId: snapshot.id }); await refresh(); } }, "danger"));
  body.append(actions); return body;
}
async function restore(snapshot, selection = null) {
  const tabs = snapshot.windows.flatMap((w, i) => w.tabs.filter(t => !selection || i === selection.windowIndex && t.groupKey === selection.groupKey));
  const restorable = tabs.filter(t => TF.httpUrl(t.url)).length;
  if (!restorable) { UI.status("This selection has no HTTP or HTTPS tabs to restore.", true); return; }
  if (!await UI.confirm("Restore this workspace?", `Open ${restorable} tab(s) in new window(s)? ${tabs.length - restorable} unsupported URL(s) will be skipped. Existing windows stay open.`, "Restore")) return;
  $("failures").hidden = true;
  UI.status("Restoring your workspace…");
  const result = await UI.act("restoreSnapshot", { snapshotId: snapshot.id, selection });
  UI.status(result.message, result.partial);
  const details = [...(result.failures || []), ...(result.adjustments || [])];
  if (details.length) { $("failures").replaceChildren(...details.map(message => UI.el("p", "", message))); $("failures").hidden = false; }
}
function download(snapshots) {
  const blob = new Blob([JSON.stringify({ format: "tabfolio", version: 2, exportedAt: new Date().toISOString(), snapshots }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = UI.el("a"); a.href = url; a.download = `tabfolio-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("capture").addEventListener("click", async () => { $("capture").disabled = true; try { await UI.act("captureNow"); await refresh(); } catch (err) { UI.status(err.message, true); } finally { $("capture").disabled = false; } });
$("export").addEventListener("click", () => download(data.snapshots));
$("import").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async () => {
  try {
    const file = $("importFile").files[0]; if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw Error("Choose a JSON backup smaller than 8 MB.");
    const content = JSON.parse(await file.text()); const snapshots = TF.parseImport(content);
    if (!await UI.confirm("Import snapshots?", `Add ${snapshots.length} saved snapshot(s) from this file? Tabs will not be opened. Existing snapshots are kept.`, "Import")) return;
    await UI.act("importSnapshots", { data: content }); await refresh();
  } catch (err) { UI.status(err instanceof SyntaxError ? "This file is not valid JSON." : err.message, true); }
  finally { $("importFile").value = ""; }
});
$("clear").addEventListener("click", async () => { if (await UI.confirm("Delete all snapshots?", "This cannot be undone. Export a backup first if you want to keep these saved layouts.", "Delete all", true)) { try { await UI.act("clearSnapshots"); await refresh(); } catch (err) { UI.status(err.message, true); } } });
$("snapshotSearch").addEventListener("input", render);
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.snapshots || area === "sync") void refresh(); });
refresh();
