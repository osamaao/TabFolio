const assert = require('node:assert/strict');
const {test} = require('node:test');
const {browser} = require('./browser.cjs');

async function workspace(layouts) {
  const b = browser({autoGroup:false}); await b.drain();
  b.tabs.clear(); b.groups.clear(); b.windows.clear();
  let nextId = 100;
  for (const [windowIndex, entries] of layouts.entries()) {
    const windowId = windowIndex + 1;
    b.windows.set(windowId, {id:windowId, focused:windowId === 1, incognito:false, type:'normal'});
    let index = 0;
    for (const entry of entries) {
      if (entry.id >= 0) b.groups.set(entry.id, {id:entry.id, windowId, title:entry.title, color:entry.color || 'blue', collapsed:!!entry.collapsed});
      for (const raw of entry.tabs || [{}]) {
        const tab = typeof raw === 'string' ? {url:raw} : raw;
        const id = nextId++;
        b.tabs.set(id, {id, windowId, groupId:entry.id, index:index++, url:`https://site${id}.com/`, title:`Tab ${id}`, active:false, pinned:false, incognito:false, ...tab});
      }
    }
  }
  await b.request('getModel');
  return b;
}
const ordered = (b, windowId=1) => [...b.tabs.values()].filter(t => t.windowId === windowId).sort((a,b) => a.index - b.index);

test('merge keeps the leftmost group and appends ordered members without closing tabs', async()=>{
  const b = await workspace([[
    {id:-1, tabs:[{pinned:true}]},
    {id:90, title:'Work', color:'green', tabs:['https://first.com/', 'https://second.com/']},
    {id:-1, tabs:['https://ungrouped.com/']},
    {id:80, title:'Other', color:'red'},
    {id:20, title:'Work', color:'blue', tabs:[{url:'https://third.com/', active:true, audible:true}, 'https://fourth.com/']},
    {id:10, title:'Work', color:'yellow', tabs:['https://fifth.com/']}
  ]]);
  const before = [...b.tabs.values()].map(t => [t.id,t.url,t.active,t.audible,t.pinned]);
  const result = await b.request('mergeSameNameGroups', {windowId:1});
  assert.equal(result.mergedGroups,2); assert.equal(result.mergedSets,1); assert.equal(result.movedTabs,3); assert.equal(result.partial,false);
  assert.deepEqual([...b.tabs.values()].map(t => [t.id,t.url,t.active,t.audible,t.pinned]), before);
  assert.deepEqual(ordered(b).filter(t => t.groupId === 90).map(t => t.url), ['https://first.com/','https://second.com/','https://third.com/','https://fourth.com/','https://fifth.com/']);
  const members = ordered(b).filter(t => t.groupId === 90);
  assert.deepEqual(members.map(t => t.index), [1,2,3,4,5]);
  assert.equal(b.groups.get(90).title,'Work'); assert.equal(b.groups.get(90).color,'green');
  assert.equal(b.groups.get(80).title,'Other'); assert.equal(b.groups.has(20),false); assert.equal(b.groups.has(10),false);
  assert.equal(ordered(b)[0].pinned,true); assert.equal(b.tabs.get(103).groupId,-1); assert.deepEqual(b.errors,[]);
});

test('merge matches exact non-empty titles and treats hostile names as data', async()=>{
  const titles = ['Work','Work','work','Work ','','', ' ',' ', '__proto__','__proto__','<img src=x onerror=alert(1)>','<img src=x onerror=alert(1)>'];
  const b = await workspace([titles.map((title,i) => ({id:1000+i,title}))]);
  const result = await b.request('mergeSameNameGroups', {windowId:1});
  assert.equal(result.mergedGroups,3); assert.equal(result.mergedSets,3);
  for (const id of [1002,1003,1004,1005,1006,1007]) assert.ok(b.groups.has(id));
  assert.equal(b.groups.get(1008).title,'__proto__'); assert.equal(b.groups.has(1009),false);
  assert.equal(b.groups.get(1010).title,titles[10]); assert.equal(b.groups.has(1011),false); assert.deepEqual(b.errors,[]);
});

test('current and all window scopes merge independently and never transfer tabs', async()=>{
  const b = await workspace([
    [{id:10,title:'Work'}, {id:20,title:'Work'}],
    [{id:30,title:'Work'}, {id:40,title:'Work'}],
    [{id:50,title:'Work'}]
  ]);
  const windows = [...b.tabs.values()].map(t => [t.id,t.windowId]);
  assert.equal((await b.request('mergeSameNameGroups', {windowId:1})).mergedGroups,1);
  assert.ok(b.groups.has(30)); assert.ok(b.groups.has(40));
  assert.equal((await b.request('mergeSameNameGroups', {windowId:null})).mergedGroups,1);
  assert.ok(b.groups.has(10)); assert.ok(b.groups.has(30)); assert.ok(b.groups.has(50));
  assert.deepEqual([...b.tabs.values()].map(t => [t.id,t.windowId]), windows);
  const again = await b.request('mergeSameNameGroups', {windowId:null});
  assert.equal(again.mergedGroups,0); assert.match(again.message,/No groups/);
});

test('merged automatic groups stay protected through navigation and restarts', async()=>{
  const b = await workspace([[
    {id:10,title:'docs', tabs:['https://docs.google.com/a']},
    {id:20,title:'docs', tabs:['https://docs.github.com/b']}
  ]]);
  b.settings.autoGroup = true;
  for (const groupId of [10,20]) await b.request('groupPolicy', {groupId,patch:{mode:'auto'}});
  await b.request('groupPolicy', {groupId:20,patch:{keepExpanded:true}});
  await b.request('mergeSameNameGroups', {windowId:1});
  const policy = b.session.automationState.groups[10];
  assert.equal(policy.mode,'manual'); assert.equal(policy.routeKey,null); assert.equal(policy.keepExpanded,true); assert.equal(policy.matchPending,false);
  assert.equal(b.session.automationState.manualOrder[1],true); assert.equal(b.session.automationState.undo,null);
  for (const tab of b.tabs.values()) assert.equal(b.session.automationState.tabOverrides[tab.id],'manual');
  await b.restartWorker(); await b.restartBrowser();
  await b.chrome.tabs.update(101,{url:'https://changed.com/'}); await b.drain();
  assert.equal(b.tabs.get(101).groupId,10); assert.equal(b.session.automationState.groups[10].keepExpanded,true);
  b.at(50); await b.scan(); assert.equal(b.groups.get(10).collapsed,false); assert.deepEqual(b.errors,[]);
});

test('merge preserves collapse states and gives expanded results a fresh idle delay', async()=>{
  for (const [targetCollapsed,sourceCollapsed,active,expected] of [[true,true,false,true],[true,false,false,false],[true,false,true,false]]) {
    const b = await workspace([[
      {id:10,title:'Work',collapsed:targetCollapsed},
      {id:20,title:'Work',collapsed:sourceCollapsed,tabs:[{active}]},
      {id:-1,tabs:[{active:!active}]}
    ]]);
    b.storage.groupActivity = {10:b.now-60*60000};
    const group = b.chrome.tabs.group;
    b.chrome.tabs.group = async options => { assert.equal(b.groups.get(10).collapsed,false); return group(options); };
    await b.request('mergeSameNameGroups', {windowId:1});
    assert.equal(b.groups.get(10).collapsed,expected);
    if (!expected && !active) {
      b.at(9.99); await b.scan(); assert.equal(b.groups.get(10).collapsed,false);
      b.at(10); await b.scan(); assert.equal(b.groups.get(10).collapsed,true);
    }
  }
});

test('private and pinned members are excluded and invalid scopes fail without edits', async()=>{
  const b = await workspace([[
    {id:10,title:'Work'}, {id:20,title:'Work',tabs:[{incognito:true}]}, {id:30,title:'Work',tabs:[{pinned:true}]}
  ]]);
  const before = [...b.tabs.values()].map(t => [t.id,t.groupId]);
  for (const windowId of [undefined,-1,'1',NaN]) await assert.rejects(b.request('mergeSameNameGroups', {windowId}), /valid window scope/);
  const result = await b.request('mergeSameNameGroups', {windowId:null}); assert.equal(result.mergedGroups,0);
  assert.deepEqual([...b.tabs.values()].map(t => [t.id,t.groupId]), before);
});

test('a source renamed after discovery is skipped', async()=>{
  const b = await workspace([[{id:10,title:'Work'}, {id:20,title:'Work'}]]);
  const get = b.chrome.tabGroups.get;
  b.chrome.tabGroups.get = async id => { if (id === 20) b.groups.get(id).title = 'Personal'; return get(id); };
  const result = await b.request('mergeSameNameGroups', {windowId:1});
  assert.equal(result.mergedGroups,0); assert.equal(result.skippedGroups,1); assert.equal(result.partial,true);
  assert.equal(b.tabs.get(101).groupId,20); assert.equal(b.groups.get(20).title,'Personal');
});

test('native rename or ungroup during a checkpoint cannot be overwritten by merging', async()=>{
  for (const edit of ['rename','ungroup']) {
    const b = await workspace([[{id:10,title:'Work'}, {id:20,title:'Work'}]]);
    const set = b.chrome.storage.local.set;
    let edited = false;
    b.chrome.storage.local.set = async patch => {
      if (!edited && patch.groupPreferences) {
        edited = true;
        if (edit === 'rename') await b.chrome.tabGroups.update(20,{title:'Personal'});
        else await b.chrome.tabs.ungroup(101);
      }
      return set(patch);
    };
    const result = await b.request('mergeSameNameGroups', {windowId:1});
    assert.equal(result.mergedGroups,0); assert.equal(result.skippedGroups,1); assert.equal(result.partial,true);
    assert.equal(b.tabs.get(101).groupId,edit === 'rename' ? 20 : -1); assert.deepEqual(b.errors,[]);
  }
});

test('failed grouping reports partial completion and preserves all tabs and protections', async()=>{
  const b = await workspace([[{id:10,title:'Work'}, {id:20,title:'Work'}, {id:30,title:'Work'}]]);
  const group = b.chrome.tabs.group; let calls = 0;
  b.chrome.tabs.group = async options => { if (++calls === 2) throw Error('Tabs cannot be edited right now.'); return group(options); };
  const result = await b.request('mergeSameNameGroups', {windowId:1});
  assert.equal(result.mergedGroups,1); assert.equal(result.movedTabs,1); assert.equal(result.partial,true); assert.equal(result.failures.length,1);
  assert.match(result.message,/Tabs cannot be edited/); assert.equal(b.tabs.size,3); assert.ok(b.groups.has(30));
  assert.equal(b.session.automationState.groups[10].mode,'manual'); assert.equal(b.session.automationState.groups[30].mode,'manual');
  await b.restartWorker(); assert.equal(b.session.automationState.groups[10].mode,'manual'); assert.deepEqual(b.errors,[]);
});

test('a partially applied native grouping reports actual moved tabs and permits retry', async()=>{
  const b = await workspace([[{id:10,title:'Work'}, {id:20,title:'Work',tabs:[{},{}]}]]);
  const group = b.chrome.tabs.group;
  b.chrome.tabs.group = async options => { await group({...options,tabIds:options.tabIds[0]}); throw Error('Interrupted grouping'); };
  const result = await b.request('mergeSameNameGroups', {windowId:1});
  assert.equal(result.mergedGroups,0); assert.equal(result.movedTabs,1); assert.equal(result.partial,true); assert.equal(b.tabs.size,3);
  b.chrome.tabs.group = group;
  const retry = await b.request('mergeSameNameGroups', {windowId:1});
  assert.equal(retry.mergedGroups,1); assert.equal(retry.movedTabs,1); assert.equal(b.groups.size,1);
  assert.deepEqual([...b.tabs.values()].map(t => t.groupId), [10,10,10]); assert.deepEqual(b.errors,[]);
});

test('a failure after grouping reports the actual removed group without losing tabs', async()=>{
  const b = await workspace([[{id:10,title:'Work'}, {id:-1}, {id:20,title:'Work'}]]);
  b.chrome.tabs.move = async()=>{ throw Error('Ordering failed'); };
  const result = await b.request('mergeSameNameGroups', {windowId:1});
  assert.equal(result.mergedGroups,1); assert.equal(result.movedTabs,1); assert.equal(result.partial,true); assert.match(result.message,/Ordering failed/);
  assert.equal(b.tabs.size,3); assert.equal(b.session.automationState.groups[10].mode,'manual'); assert.deepEqual(b.errors,[]);
});

test('concurrent merge clicks share the organization queue', async()=>{
  const b = await workspace([[{id:10,title:'Work'}, {id:20,title:'Work'}]]);
  const results = await Promise.all([b.request('mergeSameNameGroups',{windowId:1}),b.request('mergeSameNameGroups',{windowId:1})]);
  assert.equal(results[0].mergedGroups,1); assert.equal(results[1].mergedGroups,0); assert.equal(b.tabs.size,2); assert.deepEqual(b.errors,[]);
});

test('context-menu merge uses the clicked window instead of the focused window',async()=>{
  const b=await workspace([
    [{id:10,title:'Work'},{id:20,title:'Work'}],
    [{id:30,title:'Work',color:'green'},{id:40,title:'Work',color:'red'}]
  ]);
  const before=[...b.tabs.values()].map(t=>[t.id,t.url,t.windowId]);
  assert.equal((await b.chrome.windows.getLastFocused()).id,1);
  b.chrome.contextMenus.onClicked.emit({menuItemId:'atg-merge-groups'},b.tabs.get(102));await b.drain();
  assert.ok(b.groups.has(10));assert.ok(b.groups.has(20));assert.ok(b.groups.has(30));assert.equal(b.groups.has(40),false);
  assert.equal(b.tabs.get(103).groupId,30);assert.equal(b.groups.get(30).color,'green');
  assert.deepEqual([...b.tabs.values()].map(t=>[t.id,t.url,t.windowId]),before);
  assert.equal(b.session.automationState.groups[30].mode,'manual');assert.equal(b.session.lastError,null);assert.deepEqual(b.errors,[]);
});

test('context-menu merge reports partial failures and clears its error after a successful retry',async()=>{
  const b=await workspace([[{id:10,title:'Work'},{id:20,title:'Work'}]]);
  const group=b.chrome.tabs.group;b.chrome.tabs.group=async()=>{throw Error('Tabs cannot be edited right now.');};
  b.chrome.contextMenus.onClicked.emit({menuItemId:'atg-merge-groups'},b.tabs.get(100));await b.drain();
  assert.match(b.session.lastError,/Tabs cannot be edited/);assert.equal(b.tabs.size,2);assert.equal(b.groups.size,2);
  b.chrome.tabs.group=group;
  b.chrome.contextMenus.onClicked.emit({menuItemId:'atg-merge-groups'},b.tabs.get(100));await b.drain();
  assert.equal(b.groups.size,1);assert.equal(b.tabs.get(101).groupId,10);assert.equal(b.session.lastError,null);assert.deepEqual(b.errors,[]);
});

test('context-menu merge ignores clicks without a tab and serializes repeated clicks',async()=>{
  const b=await workspace([[{id:10,title:'Work'},{id:20,title:'Work'}]]);
  b.chrome.contextMenus.onClicked.emit({menuItemId:'atg-merge-groups'});await b.drain();assert.equal(b.groups.size,2);
  for(let i=0;i<2;i++)b.chrome.contextMenus.onClicked.emit({menuItemId:'atg-merge-groups'},b.tabs.get(100));
  await b.drain();assert.equal(b.groups.size,1);assert.equal(b.tabs.size,2);assert.deepEqual(b.errors,[]);
});
