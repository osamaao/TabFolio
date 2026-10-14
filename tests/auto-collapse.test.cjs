const assert = require("node:assert/strict");
const { test } = require("node:test");
const { browser, START } = require("./browser.cjs");
const MINUTE = 60_000;

test("the default gives an idle group a full ten minutes", async () => {
  const b = browser();
  await b.scan();
  b.at(5);
  await b.scan();
  assert.equal(b.isCollapsed(20), false);
  b.at(10 - 1 / MINUTE);
  await b.scan();
  assert.equal(b.isCollapsed(20), false);
  b.at(10);
  await b.scan();
  assert.equal(b.isCollapsed(20), true);
});

for (const destination of [2, 3]) {
  test(`idle time starts on departure to ${destination === 2 ? "another group" : "an ungrouped tab"}`, async () => {
    const b = browser({ autoCollapseDelay: 10 });
    await b.activate(1);
    b.at(20);
    await b.scan();
    assert.equal(b.isCollapsed(10), false);
    b.at(20.5);
    await b.activate(destination);
    b.at(30.5 - 1 / MINUTE);
    await b.scan();
    assert.equal(b.isCollapsed(10), false, "time spent using the group must not count as idle");
    b.at(30.5);
    await b.scan();
    assert.equal(b.isCollapsed(10), true);
  });
}

test("departure tracking survives a service-worker restart", async () => {
  const b = browser({ autoCollapseDelay: 10 });
  await b.activate(1);
  b.at(25);
  await b.restartWorker();
  await b.activate(2);
  b.at(34.99);
  await b.scan();
  assert.equal(b.isCollapsed(10), false);
  await b.restartWorker();
  b.at(35);
  await b.scan();
  assert.equal(b.isCollapsed(10), true);
});

test("simultaneous activity updates retain both groups' timestamps", async () => {
  const b = browser({ autoCollapseDelay: 10 });
  b.storage.groupActivity = { 10: START, 20: START };
  b.at(9);
  await Promise.all([b.touch(10), b.touch(20)]);
  assert.equal(b.storage.groupActivity[10], START + 9 * MINUTE);
  assert.equal(b.storage.groupActivity[20], START + 9 * MINUTE);
});

test("an expansion queued alongside a scan cancels its stale collapse decision", async () => {
  const b = browser({ autoCollapseDelay: 10 });
  await b.scan();
  b.at(20);
  await Promise.all([b.scan(), b.expand(20)]);
  assert.equal(b.isCollapsed(20), false);
  b.at(29.99);
  await b.scan();
  assert.equal(b.isCollapsed(20), false);
  b.at(30);
  await b.scan();
  assert.equal(b.isCollapsed(20), true);
});

test("rapid tab switches still count a brief visit to a group", async () => {
  const b = browser({ autoCollapseDelay: 10 });
  await b.scan();
  b.at(20);
  await Promise.all([b.activate(2), b.activate(3)]);
  b.at(29.99);
  await b.scan();
  assert.equal(b.isCollapsed(20), false);
  b.at(30);
  await b.scan();
  assert.equal(b.isCollapsed(20), true);
});

test("moving the active tab to another group starts the old group's timer", async () => {
  const b = browser({ autoCollapseDelay: 10 });
  await b.activate(1);
  b.at(20);
  b.tabs.get(1).groupId = 20;
  b.chrome.tabs.onUpdated.emit(1, { groupId: 20 }, structuredClone(b.tabs.get(1)));
  await b.drain();
  b.at(29.99);
  await b.scan();
  assert.equal(b.isCollapsed(10), false);
  b.at(30);
  await b.scan();
  assert.equal(b.isCollapsed(10), true);
});

test("a newly grouped background tab stays expanded for the idle delay", async () => {
  const b = browser();
  b.tabs.get(3).url = "https://example.com";
  await b.group(3);
  const id = b.tabs.get(3).groupId;
  assert.equal(b.isCollapsed(id), false);
  await b.scan();
  b.at(9.99);
  await b.scan();
  assert.equal(b.isCollapsed(id), false);
  b.at(10);
  await b.scan();
  assert.equal(b.isCollapsed(id), true);
});

test("manual expansion resets the full idle delay", async () => {
  const b = browser({ autoCollapseDelay: 10 });
  await b.scan();
  b.at(10);
  await b.scan();
  assert.equal(b.isCollapsed(20), true);
  b.at(12);
  await b.expand(20);
  b.at(21.99);
  await b.scan();
  assert.equal(b.isCollapsed(20), false);
  b.at(22);
  await b.scan();
  assert.equal(b.isCollapsed(20), true);
});

test("adding a tab to an existing group expands it and resets the delay", async () => {
  const b = browser();
  b.groups.get(20).title = "example";
  await b.drain();
  await b.request("groupPolicy", { groupId: 20, patch: { mode: "auto" } });
  b.session.automationState.groups[20].routeKey = "example.com";
  b.groups.get(20).collapsed = true;
  b.storage.groupActivity = { 20: START };
  b.tabs.get(3).url = "https://example.com";
  b.at(20);
  await b.group(3);
  assert.equal(b.tabs.get(3).groupId, 20);
  assert.equal(b.isCollapsed(20), false);
  b.at(29.99);
  await b.scan();
  assert.equal(b.isCollapsed(20), false);
  b.at(30);
  await b.scan();
  assert.equal(b.isCollapsed(20), true);
});

test("active groups in every window remain expanded", async () => {
  const b = browser();
  b.tabs.get(2).windowId = 2;
  b.tabs.get(2).active = true;
  b.groups.get(20).windowId = 2;
  b.storage.groupActivity = { 10: START, 20: START };
  b.at(60);
  await b.scan();
  assert.equal(b.isCollapsed(10), false);
  assert.equal(b.isCollapsed(20), false);
});

test("custom delays and disabling auto-collapse are respected", async () => {
  const b = browser({ autoCollapseDelay: 15 });
  await b.scan();
  b.at(14.99);
  await b.scan();
  assert.equal(b.isCollapsed(20), false);
  b.settings.autoCollapse = false;
  b.at(20);
  await b.scan();
  assert.equal(b.isCollapsed(20), false);
  b.settings.autoCollapse = true;
  await b.scan();
  assert.equal(b.isCollapsed(20), true);
});
