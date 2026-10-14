const booleanKeys = ["autoGroup", "sortAlpha", "autoCollapse", "detectDupes", "snapshotsEnabled"];
const numberKeys = ["autoCollapseDelay", "snapshotInterval", "snapshotMax"];
const domainKeys = ["excludedDomains", "platformDomains"];
const $ = id => document.getElementById(id);
async function init() {
  const { settings } = await UI.send("getModel");
  for (const key of booleanKeys) $(key).checked = settings[key];
  for (const key of numberKeys) $(key).value = settings[key];
  for (const key of domainKeys) $(key).value = settings[key].join("\n");
  $("platformList").textContent = TF.platforms.join(", ");
  const commands = await chrome.commands.getAll();
  $("shortcuts").replaceChildren();
  for (const command of commands) if (command.description) $("shortcuts").append(UI.el("p", "", `${command.shortcut || "Not assigned"} · ${command.description}`));
}
$("settingsForm").addEventListener("submit", async event => {
  event.preventDefault(); $("save").disabled = true;
  try {
    const patch = {};
    for (const key of booleanKeys) patch[key] = $(key).checked;
    for (const key of numberKeys) patch[key] = Number($(key).value);
    for (const key of domainKeys) {
      const lines = $(key).value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      if (lines.length > 100 || lines.some(s => !TF.parseDomain(s))) throw Error("Enter up to 100 valid domains per list, one per line.");
      patch[key] = lines.map(TF.parseDomain);
    }
    await UI.act("saveSettings", { patch });
  } catch (err) { UI.status(err.message, true); }
  finally { $("save").disabled = false; }
});
$("configureShortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
init().catch(err => UI.status(err.message, true));
