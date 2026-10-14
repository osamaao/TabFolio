const assert = require('node:assert/strict');
const {test} = require('node:test');
const {browser} = require('./browser.cjs');

async function workspace(layouts) {
  const b = browser({autoGroup:false,sortAlpha:false}); await b.drain();
  b.groups.clear(); b.tabs.clear(); b.windows.clear();
  let nextTab = 100;
  for (const [windowIndex, entries] of layouts.entries()) {
    const windowId = windowIndex + 1;
    b.windows.set(windowId,{id:windowId,focused:windowId === 1,incognito:false,type:'normal'});
    let index = 0;
    for (const entry of entries) {
      if (entry.id >= 0) b.groups.set(entry.id,{id:entry.id,windowId,title:entry.title,color:entry.color || 'blue',collapsed:!!entry.collapsed});
      for (const tab of entry.tabs || [{}]) {
        const id = nextTab++;
        b.tabs.set(id,{id,index:index++,windowId,groupId:entry.id,url:`https://site${id}.com/`,active:false,pinned:false,incognito:false,...tab});
      }
    }
  }
  await b.request('getModel');
  return b;
}
const tabOrder = (b, windowId=1) => [...b.tabs.values()].filter(t => t.windowId === windowId).sort((a,b) => a.index - b.index);
const groupOrder = (b, windowId=1) => [...new Set(tabOrder(b,windowId).filter(t => t.groupId >= 0).map(t => t.groupId))];

test('explicit sorting orders protected groups while retaining tabs, membership and group state',async()=>{
  const b = await workspace([[
    {id:-1,tabs:[{pinned:true}]},
    {id:10,title:'Zebra',color:'green',tabs:[{active:true},{audible:true}]},
    {id:-1},
    {id:20,title:'apple',color:'red',collapsed:true,tabs:[{},{}]},
    {id:30,title:'Banana',color:'yellow',tabs:[{},{}]},
    {id:-1}
  ]]);
  await b.request('groupPolicy',{groupId:10,patch:{keepExpanded:true}});
  await b.request('pause',{minutes:30});
  const beforeTabs = [...b.tabs.values()].map(({index,...tab}) => tab);
  const beforeGroups = [...b.groups.values()];
  const beforePolicies = structuredClone(b.session.automationState.groups);
  const beforeMembers = Object.fromEntries([...b.groups.keys()].map(id => [id,tabOrder(b).filter(t => t.groupId === id).map(t => t.id)]));
  const beforeUngrouped = tabOrder(b).filter(t => t.groupId < 0).map(t => t.id);
  const result = await b.request('sortGroups',{windowId:1});
  assert.equal(result.sortedWindows,1);assert.equal(result.partial,false);assert.deepEqual(groupOrder(b),[20,30,10]);
  assert.deepEqual([...b.tabs.values()].map(({index,...tab}) => tab),beforeTabs);
  assert.deepEqual([...b.groups.values()],beforeGroups);assert.deepEqual(b.session.automationState.groups,beforePolicies);
  for (const id of b.groups.keys()) assert.deepEqual(tabOrder(b).filter(t => t.groupId === id).map(t => t.id),beforeMembers[id]);
  assert.deepEqual(tabOrder(b).filter(t => t.groupId < 0).map(t => t.id),beforeUngrouped);
  assert.equal(tabOrder(b)[0].pinned,true);assert.equal(b.session.automationState.manualOrder[1],true);
  await b.restartWorker();await b.restartBrowser();assert.equal(b.session.automationState.manualOrder[1],true);assert.deepEqual(b.errors,[]);
});

test('sort uses natural case-insensitive names, stable ties and unnamed groups last',async()=>{
  const titles = ['','Zoo','group 10','ALPHA','alpha','group 2','  ','beta'];
  const b = await workspace([titles.map((title,i) => ({id:1000+i,title}))]);
  await b.request('sortGroups',{windowId:1});
  assert.deepEqual(groupOrder(b),[1003,1004,1007,1005,1002,1001,1000,1006]);
  assert.equal(b.groups.size,titles.length);
  const before = tabOrder(b).map(t => t.id);
  const again = await b.request('sortGroups',{windowId:1});
  assert.equal(again.sortedWindows,0);assert.equal(again.movedGroups,0);assert.match(again.message,/already in alphabetical order/);
  assert.deepEqual(tabOrder(b).map(t => t.id),before);
});

test('sort respects current/all window scope and excludes private groups',async()=>{
  const b = await workspace([
    [{id:10,title:'Zebra'},{id:20,title:'Apple'}],
    [{id:30,title:'Zoo'},{id:40,title:'Alpha'}],
    [{id:50,title:'Zebra',tabs:[{incognito:true}]},{id:60,title:'Apple',tabs:[{incognito:true}]}]
  ]);
  const windows = [...b.tabs.values()].map(t => [t.id,t.windowId]);
  assert.equal((await b.request('sortGroups',{windowId:1})).sortedWindows,1);
  assert.deepEqual(groupOrder(b),[20,10]);assert.deepEqual(groupOrder(b,2),[30,40]);
  assert.equal((await b.request('sortGroups',{windowId:null})).sortedWindows,1);
  assert.deepEqual(groupOrder(b,2),[40,30]);assert.deepEqual(groupOrder(b,3),[50,60]);
  assert.deepEqual([...b.tabs.values()].map(t => [t.id,t.windowId]),windows);assert.deepEqual(b.errors,[]);
});

test('invalid sort scope and already sorted windows make no native edits',async()=>{
  const b = await workspace([[{id:10,title:'Apple'},{id:20,title:'Zebra'}]]);
  b.chrome.tabGroups.move = async()=>{throw Error('Unexpected move');};
  b.session.automationState.undo = {label:'Previous operation'};
  for (const windowId of [undefined,-1,'1',NaN]) await assert.rejects(b.request('sortGroups',{windowId}),/valid window scope/);
  const result = await b.request('sortGroups',{windowId:1});
  assert.equal(result.movedGroups,0);assert.equal(result.partial,false);assert.equal(b.session.automationState.undo.label,'Previous operation');
  assert.equal(b.session.automationState.manualOrder[1],undefined);assert.deepEqual(b.errors,[]);
});

test('sort catches native name changes before moving groups',async()=>{
  const b = await workspace([[{id:10,title:'Zebra'},{id:20,title:'Apple'}]]);
  const set = b.chrome.storage.local.set;let edited = false;
  b.chrome.storage.local.set = async patch => {
    if (!edited && patch.groupPreferences) {edited = true;await b.chrome.tabGroups.update(20,{title:'Personal'});}
    return set(patch);
  };
  const result = await b.request('sortGroups',{windowId:1});
  assert.equal(result.sortedWindows,0);assert.equal(result.skippedWindows,1);assert.equal(result.partial,true);
  assert.deepEqual(groupOrder(b),[10,20]);assert.equal(b.groups.get(20).title,'Personal');assert.deepEqual(b.errors,[]);
});

test('sort reports partial API failure, preserves every tab and can be retried',async()=>{
  const b = await workspace([[{id:10,title:'Zoo'},{id:20,title:'Banana'},{id:30,title:'Apple'}]]);
  const beforeTabs = [...b.tabs.values()].map(({index,...tab}) => tab);
  const move = b.chrome.tabGroups.move;let calls = 0;
  b.chrome.tabGroups.move = async (...args) => {if (++calls === 2) throw Error('Tabs cannot be edited right now.');return move(...args);};
  const failed = await b.request('sortGroups',{windowId:1});
  assert.equal(failed.sortedWindows,0);assert.equal(failed.partial,true);assert.equal(failed.movedGroups,1);assert.match(failed.message,/Tabs cannot be edited/);
  assert.deepEqual([...b.tabs.values()].map(({index,...tab}) => tab),beforeTabs);
  assert.equal(b.session.automationState.manualOrder[1],true);assert.equal(b.session.automationState.undo,null);
  b.chrome.tabGroups.move = move;
  const retry = await b.request('sortGroups',{windowId:1});assert.equal(retry.partial,false);assert.deepEqual(groupOrder(b),[30,20,10]);assert.deepEqual(b.errors,[]);
});

test('concurrent sort requests share the organization queue',async()=>{
  const b = await workspace([[{id:10,title:'Zebra'},{id:20,title:'Apple'}]]);
  const results = await Promise.all([b.request('sortGroups',{windowId:1}),b.request('sortGroups',{windowId:1})]);
  assert.equal(results[0].sortedWindows,1);assert.equal(results[1].sortedWindows,0);assert.deepEqual(groupOrder(b),[20,10]);assert.deepEqual(b.errors,[]);
});
