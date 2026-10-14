const assert = require('node:assert/strict');
const {test} = require('node:test');
const {browser} = require('./browser.cjs');

// Expected names and URLs are explicit so these integration checks do not use
// the routing implementation to calculate their own expected destinations.
const sites = [
  {name:'ordinary domain across subdomains',title:'example',saved:'https://app.example.com/saved',opened:'https://blog.example.com/new'},
  {name:'arbitrary site outside the built-in platforms',title:'mystartup',saved:'https://mystartup.dev/saved',opened:'https://www.mystartup.dev/new'},
  {name:'country-code domain',title:'example',saved:'https://portal.example.co.uk/saved',opened:'https://www.example.co.uk/new'},
  {name:'GitHub',title:'github',saved:'https://github.com/saved',opened:'https://www.github.com/new'},
  {name:'Amazon',title:'amazon',saved:'https://www.amazon.com/saved',opened:'https://amazon.com/new'},
  {name:'Notion',title:'notion',saved:'https://notion.so/saved',opened:'https://www.notion.so/new'},
  {name:'Google product subdomain',title:'docs',saved:'https://docs.google.com/saved',opened:'https://docs.google.com/new'},
  {name:'Office product subdomain',title:'outlook',saved:'https://outlook.office.com/saved',opened:'https://outlook.office.com/new'},
  {name:'custom platform subdomain',title:'boards',saved:'https://boards.acme.test/saved',opened:'https://boards.acme.test/new',platformDomains:['acme.test']},
  {name:'localhost across ports',title:'localhost',saved:'http://localhost:3000/saved',opened:'http://localhost:8080/new'},
  {name:'IPv4 address',title:'127.0.0.1',saved:'http://127.0.0.1:3000/saved',opened:'http://127.0.0.1:8080/new'},
  {name:'IPv6 address',title:'[::1]',saved:'http://[::1]:3000/saved',opened:'http://[::1]:8080/new'}
];

for (const site of sites) test(`protected site-group reuse is generic: ${site.name}`,async()=>{
  const b=browser({autoGroup:false,platformDomains:site.platformDomains || []});await b.drain();
  await b.chrome.tabs.update(1,{url:site.saved});await b.drain();
  await b.request('renameGroup',{groupId:10,title:site.title});
  await b.request('groupPolicy',{groupId:10,patch:{keepExpanded:true}});
  const originalGroups=b.groups.size;
  const blank=await b.chrome.tabs.create({url:'chrome://newtab/',active:false});await b.drain();
  b.settings.autoGroup=true;
  await b.chrome.tabs.update(blank.id,{url:site.opened});await b.drain();
  const direct=await b.chrome.tabs.create({url:site.opened,active:false});await b.drain();
  assert.equal(b.tabs.get(blank.id).groupId,10);assert.equal(b.tabs.get(direct.id).groupId,10);
  await b.restartBrowser();
  const copy=await b.chrome.tabs.create({url:site.saved,active:false});await b.drain();
  assert.equal(b.tabs.get(copy.id).groupId,10);assert.equal(b.groups.size,originalGroups);
  assert.equal(b.tabs.get(1).groupId,10);assert.equal(b.groups.get(10).title,site.title);assert.equal(b.groups.get(10).color,'blue');
  assert.equal(b.session.automationState.groups[10].mode,'manual');assert.equal(b.session.automationState.groups[10].keepExpanded,true);
  assert.deepEqual(b.errors,[]);
});

test('generic reuse retains renamed group identities for ordinary and custom platform domains',async()=>{
  for (const site of [sites[1],sites[6],sites[8]]) {
    const b=browser({platformDomains:site.platformDomains || []});await b.drain();
    const first=await b.chrome.tabs.create({url:site.saved,active:false});await b.drain();const groupId=b.tabs.get(first.id).groupId;
    await b.request('renameGroup',{groupId,title:'My project'});await b.restartBrowser();
    const incoming=await b.chrome.tabs.create({url:site.opened,active:false});await b.drain();
    assert.equal(b.tabs.get(incoming.id).groupId,groupId);assert.equal(b.groups.get(groupId).title,'My project');assert.deepEqual(b.errors,[]);
  }
});

test('generic site-group reuse respects exclusions, pause, disabled grouping and tab protection',async()=>{
  for (const mode of ['excluded','paused','disabled','pinned','private']) {
    const b=browser({autoGroup:false});await b.drain();
    await b.chrome.tabs.update(1,{url:'https://github.com/saved'});await b.drain();await b.request('renameGroup',{groupId:10,title:'github'});
    b.settings.autoGroup=mode !== 'disabled';
    if (mode === 'excluded') b.settings.excludedDomains=['github.com'];
    if (mode === 'paused') await b.request('pause',{minutes:15});
    const incoming=await b.chrome.tabs.create({url:'https://github.com/new',active:false,pinned:mode === 'pinned'});
    if (mode === 'private') b.tabs.get(incoming.id).incognito=true;
    await b.drain();
    assert.equal(b.tabs.get(incoming.id).groupId,-1);assert.equal(b.groups.size,2);assert.deepEqual(b.errors,[]);
  }
});
