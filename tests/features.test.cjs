const assert = require('node:assert/strict');
const {test} = require('node:test');
const TF = require('../core.js');
const {browser, START} = require('./browser.cjs');

async function newTab(b,url,options={}) { const tab=await b.chrome.tabs.create({url,active:false,...options}); await b.drain(); return b.tabs.get(tab.id); }
function sample(overrides={}) { return {version:2,id:'sample',timestamp:START,name:'Research',windows:[{focused:true,groups:[{key:'g',title:'Work',color:'blue',collapsed:false}],tabs:[{url:'https://example.com/',title:'Example',groupKey:'g',pinned:false,active:true}]}],...overrides}; }

test('unrelated platform domains with the same label stay in different automatic groups', async()=>{
  const b=browser(); await b.drain();
  const a=await newTab(b,'https://docs.google.com/a'), c=await newTab(b,'https://docs.github.com/b');
  assert.notEqual(a.groupId,c.groupId); assert.equal(b.groups.get(a.groupId).title,'docs'); assert.equal(b.groups.get(c.groupId).title,'docs');
  const d=await newTab(b,'https://docs.google.com/c'); assert.equal(a.groupId,d.groupId);
});
test('unknown groups are protected on upgrade and navigation',async()=>{
  const b=browser(); await b.drain();
  await b.chrome.tabs.update(1,{url:'https://newsite.com/'}); await b.drain();
  assert.equal(b.tabs.get(1).groupId,10); assert.equal(b.groups.get(10).title,'one');
});
test('new and initially blank tabs reuse an existing protected YouTube group',async()=>{
  const b=browser();await b.drain();
  await b.chrome.tabs.update(1,{url:'https://www.youtube.com/'});await b.drain();
  await b.request('renameGroup',{groupId:10,title:'youtube'});
  await b.request('groupPolicy',{groupId:10,patch:{keepExpanded:true}});
  const before=b.groups.size;
  const blank=await newTab(b,'chrome://newtab/');
  await b.chrome.tabs.update(blank.id,{url:'https://youtube.com/watch?v=first'});await b.drain();
  const opened=await newTab(b,'https://www.youtube.com/watch?v=second');
  assert.equal(b.tabs.get(blank.id).groupId,10);assert.equal(opened.groupId,10);assert.equal(b.groups.size,before);
  assert.equal(b.tabs.get(1).groupId,10);assert.equal(b.groups.get(10).title,'youtube');assert.equal(b.groups.get(10).color,'blue');
  assert.equal(b.session.automationState.groups[10].mode,'manual');assert.equal(b.session.automationState.groups[10].keepExpanded,true);
  await b.chrome.tabs.update(opened.id,{url:'https://unrelated.com/'});await b.drain();
  assert.equal(b.tabs.get(opened.id).groupId,10);assert.deepEqual(b.errors,[]);
});
test('merged groups accept new copies of member URLs after worker and browser restarts',async()=>{
  const b=browser({autoGroup:false});await b.drain();
  await b.chrome.tabs.update(1,{url:'https://youtube.com/'});await b.chrome.tabs.update(2,{url:'https://youtube.com/watch?v=saved'});await b.drain();
  for(const groupId of [10,20])await b.request('renameGroup',{groupId,title:'youtube'});
  await b.request('mergeSameNameGroups',{windowId:1});
  b.settings.autoGroup=true;
  for(const restart of ['restartWorker','restartBrowser']) {
    await b[restart]();const tab=await newTab(b,'https://youtube.com/');
    assert.equal(tab.groupId,10);assert.equal([...b.groups.values()].filter(g=>g.title==='youtube').length,1);
  }
  assert.equal(b.session.automationState.groups[10].mode,'manual');assert.deepEqual(b.errors,[]);
});
test('unknown site groups reuse live domains without requiring automatic ownership',async()=>{
  const b=browser();b.groups.get(10).title=' YouTube ';b.tabs.get(1).url='https://www.youtube.com/watch?v=saved';await b.drain();
  assert.equal(b.session.automationState.groups[10].routeKey,null);
  const tab=await newTab(b,'https://youtube.com/watch?v=new');
  assert.equal(tab.groupId,10);assert.equal(b.groups.size,2);assert.equal(b.groups.get(10).title,' YouTube ');assert.deepEqual(b.errors,[]);
});
test('matching manual-group labels cannot mix unrelated product domains',async()=>{
  const b=browser();await b.drain();
  await b.chrome.tabs.update(1,{url:'https://docs.google.com/saved'});await b.drain();
  await b.request('renameGroup',{groupId:10,title:'docs'});
  const github=await newTab(b,'https://docs.github.com/new');assert.notEqual(github.groupId,10);
  const google=await newTab(b,'https://docs.google.com/new');assert.equal(google.groupId,10);
  assert.notEqual(google.groupId,github.groupId);assert.deepEqual(b.errors,[]);
});
test('explicitly merged product groups accept new tabs for either member site',async()=>{
  const b=browser({autoGroup:false});await b.drain();
  await b.chrome.tabs.update(1,{url:'https://docs.google.com/saved'});await b.chrome.tabs.update(2,{url:'https://docs.github.com/saved'});await b.drain();
  for(const groupId of [10,20])await b.request('renameGroup',{groupId,title:'docs'});
  await b.request('mergeSameNameGroups',{windowId:1});b.settings.autoGroup=true;
  for(const url of ['https://docs.google.com/new','https://docs.github.com/new'])assert.equal((await newTab(b,url)).groupId,10);
  assert.equal(b.groups.size,1);assert.equal(b.session.automationState.groups[10].mode,'manual');assert.deepEqual(b.errors,[]);
});
test('renamed automatic site groups retain their route for incoming tabs',async()=>{
  const b=browser();await b.drain();const original=await newTab(b,'https://youtube.com/saved');const id=original.groupId;
  await b.request('renameGroup',{groupId:id,title:'Videos'});
  assert.equal((await newTab(b,'https://youtube.com/new')).groupId,id);
  assert.equal(b.groups.get(id).title,'Videos');assert.equal(b.session.automationState.groups[id].mode,'manual');assert.deepEqual(b.errors,[]);
});
test('protected groups in other windows are never used as automatic destinations',async()=>{
  const b=browser({autoGroup:false});await b.drain();
  await b.chrome.tabs.update(1,{url:'https://youtube.com/saved'});await b.drain();
  await b.request('renameGroup',{groupId:10,title:'youtube'});b.settings.autoGroup=true;
  const win=await b.chrome.windows.create({url:'https://youtube.com/new',focused:false});await b.drain();
  const tab=b.tabs.get(win.tabs[0].id);assert.notEqual(tab.groupId,10);assert.equal(tab.windowId,win.id);
  assert.equal(b.groups.get(10).windowId,1);assert.equal(b.groups.get(tab.groupId).windowId,win.id);assert.deepEqual(b.errors,[]);
});
test('concurrent incoming tabs all reuse the existing manual site group',async()=>{
  const b=browser();await b.drain();await b.chrome.tabs.update(1,{url:'https://youtube.com/saved'});await b.drain();
  await b.request('renameGroup',{groupId:10,title:'youtube'});
  const created=await Promise.all(Array.from({length:20},(_,i)=>b.chrome.tabs.create({url:`https://youtube.com/watch?v=${i}`,active:false})));await b.drain();
  for(const tab of created)assert.equal(b.tabs.get(tab.id).groupId,10);
  assert.equal([...b.groups.values()].filter(g=>g.title==='youtube').length,1);assert.deepEqual(b.errors,[]);
});
test('a familiar group name alone cannot route unrelated pages into it',async()=>{
  const b=browser();await b.drain();await b.request('renameGroup',{groupId:10,title:'youtube'});
  const tab=await newTab(b,'https://youtube.com/new');
  assert.notEqual(tab.groupId,10);assert.equal(b.tabs.get(1).groupId,10);assert.equal(b.groups.get(10).title,'youtube');assert.deepEqual(b.errors,[]);
});
test('explicit ungrouped overrides remain protected even when a site group exists',async()=>{
  const b=browser({autoGroup:false});await b.drain();
  await b.chrome.tabs.update(1,{url:'https://youtube.com/saved'});await b.drain();await b.request('renameGroup',{groupId:10,title:'youtube'});
  const manual=await newTab(b,'https://youtube.com/watch?v=manual');await b.request('moveTab',{tabId:manual.id,groupId:-1});
  assert.deepEqual(b.local.manualTabUrls,[manual.url]);
  await b.restartBrowser();b.settings.autoGroup=true;
  const copy=await newTab(b,manual.url);assert.equal(copy.groupId,-1);assert.equal(b.tabs.get(manual.id).groupId,-1);
  assert.equal((await newTab(b,'https://youtube.com/new')).groupId,10);assert.deepEqual(b.errors,[]);
});
test('native manual ungrouping survives navigation and worker restart',async()=>{
  const b=browser(); await b.drain(); const tab=await newTab(b,'https://example.com/a');
  await b.chrome.tabs.ungroup(tab.id); await b.drain(); await b.restartWorker();
  await b.chrome.tabs.update(tab.id,{url:'https://example.com/b'}); await b.drain();
  assert.equal(b.tabs.get(tab.id).groupId,-1);
  await b.request('manageTab',{tabId:tab.id}); assert.ok(b.tabs.get(tab.id).groupId>=0);
});
test('native manual group rename protects its name and membership',async()=>{
  const b=browser(); await b.drain(); const tab=await newTab(b,'https://example.com/a'); const id=tab.groupId;
  await b.chrome.tabGroups.update(id,{title:'My project'}); await b.drain();
  await b.chrome.tabs.update(tab.id,{url:'https://other.com/'}); await b.drain();
  assert.equal(b.tabs.get(tab.id).groupId,id); assert.equal(b.groups.get(id).title,'My project');
});
test('Keep expanded persists through a worker and browser restart',async()=>{
  const b=browser(); await b.drain(); await b.request('groupPolicy',{groupId:20,patch:{keepExpanded:true}});
  await b.restartWorker(); b.at(50); await b.scan(); assert.equal(b.isCollapsed(20),false);
  await b.restartBrowser(); b.at(100); await b.scan(); assert.equal(b.isCollapsed(20),false);
});
test('timed pause suppresses grouping and collapse and expires',async()=>{
  const b=browser(); await b.drain(); await b.scan(); await b.request('pause',{minutes:15});
  const tab=await newTab(b,'https://example.com'); assert.equal(tab.groupId,-1);
  b.at(14); await b.scan(); assert.equal(b.isCollapsed(20),false);
  b.at(16); await b.scan(); assert.equal(b.isCollapsed(20),true);
  await b.group(tab.id); assert.ok(b.tabs.get(tab.id).groupId>=0);
});
test('Undo restores original membership and protects the resulting arrangement',async()=>{
  const b=browser(); await b.drain(); const tab=await newTab(b,'https://example.com');
  assert.ok(b.session.automationState.undo);
  await b.request('undo'); assert.equal(b.tabs.get(tab.id).groupId,-1);
  await b.chrome.tabs.update(tab.id,{url:'https://other.com'}); await b.drain(); assert.equal(b.tabs.get(tab.id).groupId,-1);
});
test('Undo refuses to overwrite a subsequently changed workspace',async()=>{
  const b=browser(); await b.drain(); const tab=await newTab(b,'https://example.com');
  b.tabs.get(tab.id).index=0;
  await assert.rejects(b.request('undo'),/changed/);
  assert.equal(b.tabs.get(tab.id).index,0);
});
test('native group ordering disables later automatic sorting in that window',async()=>{
  const b=browser(); await b.drain(); b.chrome.tabGroups.onMoved.emit(b.groups.get(10)); await b.drain();
  assert.equal(b.session.automationState.manualOrder[1],true);
});
test('duplicate matching preserves query parameters, their order, routes and protocols',()=>{
  for(const [a,b] of [
    ['https://x.com/?s=a','https://x.com/?s=b'],['https://x.com/#/inbox','https://x.com/#/settings'],
    ['http://x.com/','https://x.com/'],['https://x.com/?a=1&b=2','https://x.com/?b=2&a=1'],
    ['https://x.com/?utm_source=a','https://x.com/?utm_source=b']]) assert.notEqual(TF.duplicateKey(a),TF.duplicateKey(b));
  assert.equal(TF.duplicateKey('HTTPS://EXAMPLE.COM:443/'),TF.duplicateKey('https://example.com/'));
});
test('duplicate close requires a retained copy and protects active tabs',async()=>{
  const b=browser({autoGroup:false}); await b.drain(); const a=await newTab(b,'https://same.com/'), c=await newTab(b,'https://same.com/');
  await assert.rejects(b.request('closeDuplicates',{selection:[{id:a.id,url:a.url},{id:c.id,url:c.url}]}),/Keep at least/);
  await b.activate(a.id); await assert.rejects(b.request('closeDuplicates',{selection:[{id:a.id,url:a.url}]}),/protected/);
  const result=await b.request('closeDuplicates',{selection:[{id:c.id,url:c.url}]}); assert.equal(result.closed,1); assert.ok(b.tabs.has(a.id)); assert.ok(!b.tabs.has(c.id));
});
test('duplicate close revalidates a selected URL after navigation',async()=>{
  const b=browser({autoGroup:false}); await b.drain(); const a=await newTab(b,'https://same.com/'); await newTab(b,'https://same.com/');
  b.tabs.get(a.id).url='https://different.com/';
  await assert.rejects(b.request('closeDuplicates',{selection:[{id:a.id,url:'https://same.com/'}]}),/changed/); assert.ok(b.tabs.has(a.id));
});
test('manual snapshots work with automatic capture off and include ungrouped and pinned tabs',async()=>{
  const b=browser({snapshotsEnabled:false}); await b.drain(); await newTab(b,'https://pinned.com/',{pinned:true});
  await b.request('captureNow'); const saved=b.local.snapshots[0]; assert.equal(saved.windows[0].tabs.length,4);
  assert.ok(saved.windows[0].tabs.some(t=>t.pinned)); assert.ok(saved.windows[0].tabs.some(t=>t.groupKey===null));
  await b.worker.exclusive(()=>b.worker.captureSnapshot({automatic:true})); assert.equal(b.local.snapshots.length,1);
});
test('capture/restore preserves multi-window groups, order, pins and active tabs',async()=>{
  const b=browser({autoGroup:false}); await b.drain();
  await b.chrome.tabs.update(3,{url:'https://ungrouped.com/'}); await newTab(b,'https://pinned.com/',{pinned:true});
  const win=await b.chrome.windows.create({url:'https://windowtwo.com/',focused:false}); await b.drain();
  await b.request('captureNow'); const snapshot=b.local.snapshots[0];
  b.settings.autoGroup=true;
  const restored=await b.request('restoreSnapshot',{snapshotId:snapshot.id}); assert.equal(restored.partial,false); assert.equal(restored.windowIds.length,2);
  for(const [i,id] of restored.windowIds.entries()) {
    const live=[...b.tabs.values()].filter(t=>t.windowId===id).sort((a,c)=>a.index-c.index);
    const saved=snapshot.windows[i];
    assert.deepEqual(live.map(t=>t.url),saved.tabs.map(t=>t.url)); assert.deepEqual(live.map(t=>t.pinned),saved.tabs.map(t=>t.pinned));
    assert.deepEqual(live.map(t=>t.active),saved.tabs.map(t=>t.active));
    assert.deepEqual(live.map(t=>t.groupId<0?null:b.groups.get(t.groupId).title),saved.tabs.map(t=>saved.groups.find(g=>g.key===t.groupKey)?.title??null));
    for(const tab of live) { await b.chrome.tabs.update(tab.id,{url:tab.url+'?next=1'}); } await b.drain();
    assert.deepEqual(live.map(t=>t.groupId<0?null:b.groups.get(t.groupId).title),saved.tabs.map(t=>saved.groups.find(g=>g.key===t.groupKey)?.title??null));
  }
  assert.ok(b.windows.has(win.id)); assert.ok(b.windows.has(1));
});
test('restoring a selected group opens only its members',async()=>{
  const b=browser(); await b.drain(); b.local.snapshots=[sample()];
  const result=await b.request('restoreSnapshot',{snapshotId:'sample',selection:{windowIndex:0,groupKey:'g'}});
  assert.equal(result.restored,1); assert.equal(result.windowIds.length,1);
});
test('unsupported URLs and individual restore failures are reported as partial',async()=>{
  const b=browser(); await b.drain(); const saved=sample();
  saved.windows[0].tabs.push({url:'chrome://settings/',groupKey:null},{url:'https://fail.test/',groupKey:null}); b.local.snapshots=[saved];
  const result=await b.request('restoreSnapshot',{snapshotId:'sample'});
  assert.equal(result.restored,1); assert.equal(result.skipped,1); assert.equal(result.failures.length,1); assert.equal(result.partial,true);
  assert.equal(b.session.restoreInProgress,false);
});
test('legacy snapshots migrate without merging their windows',()=>{
  const legacy={id:123,timestamp:START,name:'Old snapshot',groups:[{windowId:1,title:'One',color:'blue',tabs:[{url:'https://one.com'}]},{windowId:2,title:'Two',color:'red',tabs:[{url:'https://two.com'}]}]};
  const converted=TF.normalizeSnapshot(legacy); assert.equal(converted.version,2); assert.equal(converted.id,'123'); assert.equal(converted.windows.length,2);
  assert.equal(converted.windows[1].tabs[0].groupKey,converted.windows[1].groups[0].key);
});
test('invalid import changes nothing, and import never evicts existing snapshots',async()=>{
  const b=browser({snapshotMax:1}); await b.drain(); b.local.snapshots=[sample()];
  const invalid=sample({id:'invalid'}); invalid.windows[0].tabs[0].groupKey='missing';
  await assert.rejects(b.request('importSnapshots',{data:{snapshots:[invalid]}}),/missing group/); assert.equal(b.local.snapshots[0].id,'sample');
  await assert.rejects(b.request('importSnapshots',{data:{snapshots:[sample({id:'another'})]}}),/snapshot limit/); assert.equal(b.local.snapshots.length,1);
});
test('export format round trips and hostile names stay as plain data',()=>{
  const saved=sample({name:'<img src=x onerror=alert(1)>'});
  assert.deepEqual(TF.parseImport({format:'tabfolio',version:2,snapshots:[saved]}),[TF.normalizeSnapshot(saved)]);
  assert.throws(()=>TF.parseImport({format:'tabfolio',version:99,snapshots:[saved]}),/Unsupported/);
  assert.throws(()=>TF.normalizeSnapshot(sample({version:99})),/Unsupported/);
});
test('concurrent capture and deletion retain the newly captured snapshot',async()=>{
  const b=browser(); await b.drain(); b.local.snapshots=[sample()];
  await Promise.all([b.request('captureNow'),b.request('deleteSnapshot',{snapshotId:'sample'})]);
  assert.equal(b.local.snapshots.length,1); assert.notEqual(b.local.snapshots[0].id,'sample');
});
test('storage quota failure preserves the existing snapshots',async()=>{
  const b=browser(); await b.drain(); b.local.snapshots=[sample()];
  b.chrome.storage.local.getBytesInUse=async key=>key===null?10*1024*1024:100;
  await assert.rejects(b.request('captureNow'),/Not enough/); assert.equal(b.local.snapshots.length,1); assert.equal(b.local.snapshots[0].id,'sample');
});
test('normal operations do not log background errors',async()=>{
  const b=browser(); await b.drain(); await newTab(b,'https://example.com'); await b.request('captureNow'); await b.scan(); await b.drain(); assert.deepEqual(b.errors,[]);
});

test('manual ungrouping and manual order survive browser restart',async()=>{
  const b=browser(); await b.drain(); const tab=await newTab(b,'https://example.com/a');
  await b.chrome.tabs.ungroup(tab.id); b.chrome.tabGroups.onMoved.emit(b.groups.get(10)); await b.drain(); await b.restartBrowser();
  await b.chrome.tabs.update(tab.id,{url:'https://example.com/b'}); await b.drain();
  assert.equal(b.tabs.get(tab.id).groupId,-1); assert.equal(b.session.automationState.manualOrder[1],true);
});
test('native manual regrouping is not mistaken for an internal operation',async()=>{
  const b=browser(); await b.drain(); const tab=await newTab(b,'https://example.com/a');
  await b.chrome.tabs.group({tabIds:tab.id,groupId:20}); await b.drain(); await b.chrome.tabs.update(tab.id,{url:'https://changed.com'}); await b.drain();
  assert.equal(b.tabs.get(tab.id).groupId,20); assert.equal(b.session.automationState.groups[20].mode,'manual');
});
test('snapshot grouping failures keep tabs and report incomplete layout',async()=>{
  const b=browser(); await b.drain(); b.local.snapshots=[sample()];
  b.chrome.tabs.group=async()=>{throw Error('Grouping is temporarily unavailable');};
  const result=await b.request('restoreSnapshot',{snapshotId:'sample'});
  assert.equal(result.restored,1); assert.equal(result.partial,true); assert.match(result.failures[0],/Grouping/);
  const restored=[...b.tabs.values()].find(t=>t.windowId===result.windowIds[0]); assert.equal(restored.groupId,-1); assert.equal(b.session.automationState.tabOverrides[restored.id],'manual');
});
test('interrupted restore protects opened tabs when the worker recovers',async()=>{
  const b=browser({autoGroup:false}); await b.drain();
  const win=await b.chrome.windows.create({url:'https://restored.com',focused:false}); await b.drain();
  b.session.restoreInProgress=true; b.session.restoreWindowIds=[win.id]; b.settings.autoGroup=true;
  await b.restartWorker(); await b.chrome.tabs.update(win.tabs[0].id,{url:'https://restored.com/next'}); await b.drain();
  assert.equal(b.tabs.get(win.tabs[0].id).groupId,-1); assert.match(b.session.lastError,/interrupted/);
});
test('collapsed groups and inactive window selections survive restore',async()=>{
  const b=browser(); await b.drain(); const saved=sample();
  saved.windows[0].groups[0].collapsed=true; saved.windows[0].tabs[0].active=false;
  saved.windows[0].tabs.push({url:'https://active.com',groupKey:null,active:true}); b.local.snapshots=[saved];
  const result=await b.request('restoreSnapshot',{snapshotId:'sample'});
  const group=[...b.groups.values()].find(g=>g.windowId===result.windowIds[0]); assert.equal(group.collapsed,true); assert.equal(result.partial,false);
});
test('non-restorable imports cannot execute javascript or extension URLs',async()=>{
  const b=browser(); await b.drain(); const saved=sample();
  saved.windows[0].tabs[0].url='javascript:alert(1)';
  await b.request('importSnapshots',{data:{snapshots:[saved]}});
  await assert.rejects(b.request('restoreSnapshot',{snapshotId:'sample'}),/No HTTP/); assert.equal(b.windows.size,1);
});
test('private windows and their URLs are excluded from snapshots and durable preferences',async()=>{
  const b=browser({autoGroup:false}); await b.drain(); b.tabs.get(2).incognito=true;
  b.windows.set(2,{id:2,incognito:true,focused:false,type:'normal'}); b.tabs.get(2).windowId=2; b.groups.get(20).windowId=2;
  await b.request('groupPolicy',{groupId:20,patch:{keepExpanded:true}}); await b.request('captureNow');
  assert.equal(b.local.snapshots[0].windows.length,1); assert.ok(!JSON.stringify(b.local.groupPreferences).includes('two.com'));
});
test('retention trims oldest snapshots without dropping the newest',async()=>{
  const b=browser({snapshotMax:2}); await b.drain(); b.local.snapshots=[sample({id:'first'}),sample({id:'oldest'})];
  const result=await b.request('captureNow'); assert.equal(b.local.snapshots.length,2); assert.equal(b.local.snapshots[0].id,result.snapshotId); assert.equal(b.local.snapshots[1].id,'first');
});
test('100 tabs can be indexed and grouped with no duplicate groups for a domain',async()=>{
  const b=browser(); await b.drain();
  await Promise.all(Array.from({length:100},(_,i)=>b.chrome.tabs.create({url:`https://site${i%10}.com/page${i}`,active:false}))); await b.drain();
  const model=await b.request('getModel'); assert.equal(model.tabs.length,103);
  const policies=Object.values(model.state.groups).filter(p=>p.mode==='auto'); assert.equal(policies.length,10); assert.equal(new Set(policies.map(p=>p.routeKey)).size,10); assert.deepEqual(b.errors,[]);
});

test('installation waits for callback-based menu removal on Chrome 116',async()=>{
  const b=browser(); await b.drain(); let removed=false; const created=[];
  b.chrome.contextMenus.removeAll=callback=>{setImmediate(()=>{removed=true;callback();});};
  b.chrome.contextMenus.create=(properties,callback)=>{
    assert.equal(removed,true);
    if(properties.parentId)assert.ok(created.some(item=>item.id===properties.parentId),'parent is created before its children');
    created.push(properties);setImmediate(callback);
  };
  b.chrome.runtime.onInstalled.emit({reason:'update'});await b.drain();
  assert.equal(created.length,6);assert.equal(new Set(created.map(item=>item.id)).size,6);
  assert.equal(created[0].title,'TabFolio');assert.equal(created[0].parentId,undefined);
  for(const child of created.slice(1))assert.equal(child.parentId,created[0].id);
  assert.equal(created.find(item=>item.id==='atg-merge-groups').title,'Merge identical groups');
  assert.deepEqual(created.slice(1).map(item=>item.title),['Open tab panel','Exclude this domain','Keep this tab ungrouped','Collapse idle groups','Merge identical groups']);
  assert.deepEqual(b.errors,[]);assert.ok(!b.local.snapshots);
});

test('Undo preserves Keep expanded preferences on unaffected groups',async()=>{
  const b=browser();await b.drain();await b.request('groupPolicy',{groupId:20,patch:{keepExpanded:true}});
  await newTab(b,'https://example.com');await b.request('undo');
  assert.equal(b.session.automationState.groups[20].keepExpanded,true);
});
test('groups restored after worker startup can still recover their preferences',async()=>{
  const b=browser();await b.drain();await b.request('groupPolicy',{groupId:20,patch:{keepExpanded:true}});
  const group=structuredClone(b.groups.get(20)),tab=structuredClone(b.tabs.get(2));
  b.groups.delete(20);b.tabs.delete(2);await b.restartBrowser();
  b.groups.set(20,group);b.tabs.set(2,tab);
  await b.request('getModel');assert.equal(b.session.automationState.groups[20].keepExpanded,true);
});
test('browser startup gives reused group IDs a fresh idle grace period',async()=>{
  const b=browser();await b.drain();b.storage.groupActivity={20:START};b.at(30);
  b.chrome.runtime.onStartup.emit();await b.drain();await b.scan();assert.equal(b.isCollapsed(20),false);
  b.at(39.99);await b.scan();assert.equal(b.isCollapsed(20),false);
  b.at(40);await b.scan();assert.equal(b.isCollapsed(20),true);
});
test('refreshing the panel with unmatched groups does not write state again',async()=>{
  const b=browser();await b.drain();let writes=0;
  const set=b.chrome.storage.session.set;
  b.chrome.storage.session.set=async patch=>{writes++;return set(patch);};
  await b.request('getModel');await b.request('getModel');
  assert.equal(writes,0);
});
test('late restored ungrouped tabs recover protection and can explicitly opt back in',async()=>{
  const b=browser();await b.drain();const tab=await newTab(b,'https://example.com/manual');
  await b.chrome.tabs.ungroup(tab.id);await b.drain();
  b.tabs.delete(tab.id);await b.restartBrowser();
  const restored=await newTab(b,tab.url);assert.equal(restored.groupId,-1);
  await b.request('manageTab',{tabId:restored.id});assert.ok(b.tabs.get(restored.id).groupId>=0);
  await b.request('getModel');assert.equal(b.session.automationState.tabOverrides[restored.id],'auto');
});
