const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseHTML} = require('linkedom');
const {browser} = require('./browser.cjs');

async function page(name, settings={}) {
  const b=browser(settings); await b.drain();
  const html=fs.readFileSync(path.join(__dirname,'..',name+'.html'),'utf8');
  const {document,window}=parseHTML(html);
  // LinkeDOM is a DOM parser, not a rendering engine. Supply the small browser
  // primitives absent from it; production scripts and worker handlers are real.
  let active=document.body;
  Object.defineProperty(document,'activeElement',{get:()=>active});
  window.HTMLElement.prototype.focus=function(){active=this;};
  window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');this._returnFocus=active;};
  window.HTMLElement.prototype.close=function(value=''){this.returnValue=value;this.removeAttribute('open');active=this._returnFocus||document.body;this.dispatchEvent(new window.Event('close'));};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{
    configurable:true,
    get(){return [...this.options].find(o=>o.selected)?.value??this.options[0]?.value??'';},
    set(value){for(const o of this.options)o.removeAttribute('selected');[...this.options].find(o=>o.value===String(value))?.setAttribute('selected','');}
  });
  b.chrome.runtime.sendMessage=async message=>{
    try{return {success:true,...await b.request(message.action,message)};}
    catch(err){return {success:false,error:err.message};}
  };
  b.chrome.runtime.openOptionsPage=async()=>{};
  const context=vm.createContext({document,chrome:b.chrome,URL,TextEncoder,crypto:require('node:crypto').webcrypto,Blob,console,
    Date:class extends Date {static now(){return b.now;}},
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0});
  for(const script of document.querySelectorAll('script[src]')) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',script.getAttribute('src')),'utf8'),context);
  const settle=async()=>{for(let i=0;i<8;i++){await b.drain();await new Promise(r=>setImmediate(r));}};
  await settle();
  return {b,document,context,settle,$:id=>document.getElementById(id),
    async fire(el,type,extra={}){const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,extra);el.dispatchEvent(event);await settle();},
    async render(){await vm.runInContext('refresh()',context);await settle();},
    button(text){return [...document.querySelectorAll('button')].find(el=>el.textContent===text);}
  };
}

test('panel renders live tabs, searches group/title/URL, and focuses the result',async()=>{
  const p=await page('panel');
  assert.match(p.$('resultCount').textContent,/3 tab/); assert.equal(p.document.querySelectorAll('.tab-focus').length,3);
  p.$('search').value='two.com'; await p.fire(p.$('search'),'input'); assert.equal(p.document.querySelectorAll('.tab-focus').length,1);
  await p.fire(p.document.querySelector('.tab-focus'),'click'); assert.equal(p.b.tabs.get(2).active,true);
  p.$('search').value='does-not-exist'; await p.fire(p.$('search'),'input'); assert.match(p.$('results').textContent,/No tabs match/);
});
test('keyboard search and result navigation select usable controls',async()=>{
  const p=await page('panel'); await p.fire(p.document,'keydown',{key:'/'}); assert.equal(p.document.activeElement,p.$('search'));
  await p.fire(p.document,'keydown',{key:'ArrowDown'}); assert.ok(p.document.activeElement.classList.contains('tab-focus'));
});
test('panel group controls persist Keep expanded and a timed pause',async()=>{
  const p=await page('panel');
  p.document.querySelector('.group-options').setAttribute('open','');
  const keep=p.document.querySelector('.group-options input[type=checkbox]'); keep.focus();keep.checked=true; await p.fire(keep,'change');
  assert.equal(p.b.session.automationState.groups[10].keepExpanded,true);
  assert.equal(p.document.activeElement,p.document.querySelector('.group-options input[type=checkbox]'));
  p.$('pause').value='30'; await p.fire(p.$('pause'),'change'); assert.match(p.$('automationStatus').textContent,/Paused/);
});
test('duplicate review starts unselected and protects active copies',async()=>{
  const p=await page('panel',{autoGroup:false});
  await p.b.chrome.tabs.create({url:'https://one.com/',active:false});await p.settle();await p.render();
  await p.fire(p.$('duplicatesView'),'click');
  const checks=[...p.document.querySelectorAll('.tab-row input[type=checkbox]')]; assert.equal(checks.length,2); assert.ok(checks.some(c=>c.disabled));assert.ok(checks.every(c=>!c.checked));
  const candidate=checks.find(c=>!c.disabled);candidate.checked=true;await p.fire(candidate,'change');assert.equal(p.$('closeSelected').disabled,false);
  await p.fire(p.$('closeSelected'),'click');assert.ok(p.document.querySelector('dialog[open]'));assert.equal(p.b.tabs.size,4);
  await p.fire(p.button('Close tabs'),'click');assert.equal(p.b.tabs.size,3);assert.match(p.$('status').textContent,/Closed 1/);
});
test('group rename uses a labeled dialog and keeps user text inert',async()=>{
  const p=await page('panel');await p.fire(p.button('Rename'),'click');
  const input=p.document.querySelector('dialog input');input.value='<img src=x onerror=alert(1)>';
  await p.fire(p.document.querySelector('dialog form'),'submit');assert.equal(p.b.groups.get(10).title,input.value);
  assert.equal(p.document.querySelectorAll('.group-title img').length,0);assert.ok(!p.document.querySelector('dialog'));
});
test('settings save updates real worker settings and persists the custom delay',async()=>{
  const p=await page('settings');assert.equal(Number(p.$('autoCollapseDelay').value),10);
  p.$('autoCollapseDelay').value='17';p.$('excludedDomains').value='https://example.com/path\nlocalhost';
  await p.fire(p.$('settingsForm'),'submit');assert.equal(p.b.settings.autoCollapseDelay,17);assert.deepEqual(p.b.settings.excludedDomains,['example.com','localhost']);assert.match(p.$('status').textContent,/saved/);
});
test('panel merge button uses window scope even when search hides matching groups',async()=>{
  const p=await page('panel',{autoGroup:false});
  await p.b.chrome.tabGroups.update(20,{title:'one'});await p.settle();await p.render();
  p.$('search').value='not-visible';await p.fire(p.$('search'),'input');
  assert.equal(p.$('mergeGroups').disabled,false);
  await p.fire(p.$('mergeGroups'),'click');
  assert.equal(p.b.groups.has(20),false);assert.equal(p.b.tabs.get(2).groupId,10);assert.equal(p.b.tabs.size,3);
  assert.match(p.$('status').textContent,/Merged 1 extra group/);assert.equal(p.$('mergeGroups').disabled,false);
  await p.fire(p.$('mergeGroups'),'click');assert.match(p.$('status').textContent,/No groups/);
});
test('panel merge supports all windows and renders failures as inert text',async()=>{
  const p=await page('panel',{autoGroup:false});
  p.b.windows.set(2,{id:2,focused:false,incognito:false,type:'normal'});
  p.b.tabs.get(1).windowId=2;p.b.tabs.get(2).windowId=2;
  p.b.groups.get(10).windowId=2;p.b.groups.get(20).windowId=2;p.b.groups.get(20).title='one';
  await p.render();await p.fire(p.$('mergeGroups'),'click');assert.ok(p.b.groups.has(20));
  p.$('scope').value='all';await p.fire(p.$('scope'),'change');
  assert.match(p.$('mergeGroups').title,/within each window/);
  p.b.chrome.tabs.group=async()=>{throw Error('<img src=x onerror=alert(1)>');};
  await p.fire(p.$('mergeGroups'),'click');assert.ok(p.$('status').classList.contains('error'));
  assert.match(p.$('status').textContent,/<img src=x/);assert.equal(p.$('status').querySelector('img'),null);
  assert.equal(p.$('mergeGroups').disabled,false);assert.equal(p.b.tabs.size,3);
});
test('Sort Groups is beside Merge and sorts the selected scope regardless of search',async()=>{
  const p=await page('panel',{autoGroup:false,sortAlpha:false});
  assert.equal(p.$('mergeGroups').nextElementSibling,p.$('sortGroups'));assert.equal(p.$('sortGroups').textContent,'Sort Groups');
  assert.equal(p.$('sortGroups').disabled,false);
  p.b.groups.get(10).title='Zebra';p.b.groups.get(20).title='Apple';
  p.$('search').value='not-visible';await p.fire(p.$('search'),'input');
  await p.fire(p.$('sortGroups'),'click');
  assert.ok(p.b.tabs.get(2).index<p.b.tabs.get(1).index);assert.match(p.$('status').textContent,/Sorted groups A–Z/);
  assert.equal(p.$('sortGroups').disabled,false);assert.equal(p.$('mergeGroups').disabled,false);
  await p.fire(p.$('sortGroups'),'click');assert.match(p.$('status').textContent,/already in alphabetical order/);
});
test('panel sort honors All windows and recovers from inert API failure text',async()=>{
  const p=await page('panel',{autoGroup:false});
  p.b.windows.set(2,{id:2,focused:false,incognito:false,type:'normal'});
  p.b.tabs.get(1).windowId=2;p.b.tabs.get(2).windowId=2;
  p.b.groups.get(10).windowId=2;p.b.groups.get(20).windowId=2;p.b.groups.get(10).title='Zebra';p.b.groups.get(20).title='Apple';
  await p.render();await p.fire(p.$('sortGroups'),'click');assert.equal(p.b.tabs.get(1).index,0);
  p.$('scope').value='all';await p.fire(p.$('scope'),'change');assert.match(p.$('sortGroups').title,/within each window/);
  const move=p.b.chrome.tabGroups.move;p.b.chrome.tabGroups.move=async()=>{throw Error('<img src=x onerror=alert(1)>');};
  await p.fire(p.$('sortGroups'),'click');assert.ok(p.$('status').classList.contains('error'));assert.equal(p.$('status').querySelector('img'),null);
  assert.equal(p.$('sortGroups').disabled,false);assert.equal(p.$('mergeGroups').disabled,false);
  p.b.chrome.tabGroups.move=move;await p.fire(p.$('sortGroups'),'click');assert.ok(p.b.tabs.get(2).index<p.b.tabs.get(1).index);assert.equal(p.b.tabs.size,3);
});
test('snapshot manager can capture with scheduling off and preview/restore a group',async()=>{
  const p=await page('snapshots',{snapshotsEnabled:false});assert.match(p.$('snapshots').textContent,/first snapshot/);
  await p.fire(p.$('capture'),'click');assert.equal(p.b.local.snapshots.length,1);assert.match(p.$('snapshotCount').textContent,/1 saved/);
  const card=p.document.querySelector('.snapshot');card.open=true;await p.fire(card,'toggle');
  assert.ok(p.button('Restore group'));await p.fire(p.button('Restore group'),'click');assert.ok(p.document.querySelector('dialog[open]'));
  await p.fire(p.button('Restore'),'click');assert.equal(p.b.windows.size,2);assert.match(p.$('status').textContent,/Restored 1 of 1/);
});
test('snapshot deletion requires confirmation and cancel preserves the backup',async()=>{
  const p=await page('snapshots');await p.fire(p.$('capture'),'click');const card=p.document.querySelector('.snapshot');card.open=true;await p.fire(card,'toggle');
  await p.fire(p.button('Delete snapshot'),'click');await p.fire(p.button('Cancel'),'click');assert.equal(p.b.local.snapshots.length,1);
});
