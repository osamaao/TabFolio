const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const START = 1700000000000;
const clone = value => value === undefined ? undefined : structuredClone(value);
function browser(settings = {}) {
  let now = START, nextTab = 10, nextGroup = 30, nextWindow = 3, worker, chrome;
  const local = {}, session = {}, sync = { ...settings }, alarms = new Map(), pending = new Set(), errors = [];
  const windows = new Map([[1, { id: 1, focused: true, incognito: false, type: 'normal' }]]);
  const groups = new Map([[10, { id: 10, windowId: 1, title: 'one', color: 'blue', collapsed: false }], [20, { id: 20, windowId: 1, title: 'two', color: 'green', collapsed: false }]]);
  const tabs = new Map([
    [1, { id: 1, windowId: 1, groupId: 10, active: true, pinned: false, index: 0, url: 'https://one.com/', title: 'One' }],
    [2, { id: 2, windowId: 1, groupId: 20, active: false, pinned: false, index: 1, url: 'https://two.com/', title: 'Two' }],
    [3, { id: 3, windowId: 1, groupId: -1, active: false, pinned: false, index: 2, url: 'chrome://newtab/', title: 'New tab' }]
  ]);
  function event() {
    const listeners = [];
    return { addListener(fn) { listeners.push(fn); }, emit(...args) {
      for (const fn of listeners) {
        try {
          const result = fn(...clone(args));
          if (result?.then) { const promise = result.catch(err => errors.push(err)).finally(() => pending.delete(promise)); pending.add(promise); }
        } catch (err) { errors.push(err); }
      }
    }};
  }
  function normalize(win) { [...tabs.values()].filter(t => t.windowId === win).sort((a,b) => a.index - b.index).forEach((t, i) => t.index = i); }
  function pruneGroups() { for (const [id,g] of groups) if (![...tabs.values()].some(t => t.groupId === id)) { groups.delete(id); chrome.tabGroups.onRemoved.emit(g); } }
  function storageArea(data, area) {
    return {
      async get(keys) {
        if (keys == null) return clone(data);
        if (typeof keys === 'string') keys = [keys];
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter(key => key in data).map(key => [key,clone(data[key])]));
        return clone(Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, key in data ? data[key] : value])));
      },
      async set(patch) {
        const changes = {};
        for (const [key,value] of Object.entries(patch)) {
          if (JSON.stringify(value) !== JSON.stringify(data[key])) changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
          data[key] = clone(value);
        }
        if (Object.keys(changes).length) chrome.storage.onChanged.emit(changes, area);
      },
      async remove(key) { delete data[key]; },
      async getBytesInUse(key) { const value = key == null ? data : { [key]: data[key] }; return Buffer.byteLength(JSON.stringify(value)); }
    };
  }
  function matches(tab, query) { return Object.entries(query).every(([key,value]) => key === 'url' || tab[key] === value); }
  async function setActive(id) {
    const tab = tabs.get(id); if (!tab) throw Error('Tab not found');
    for (const t of tabs.values()) if (t.windowId === tab.windowId) t.active = t.id === id;
    if (tab.groupId >= 0 && groups.get(tab.groupId)?.collapsed) { groups.get(tab.groupId).collapsed = false; chrome.tabGroups.onUpdated.emit(groups.get(tab.groupId)); }
    chrome.tabs.onActivated.emit({ tabId:id, windowId:tab.windowId });
  }
  function start() {
    chrome = {
      storage: { onChanged:event() },
      tabs: {
        onCreated:event(), onUpdated:event(), onActivated:event(), onRemoved:event(), onMoved:event(),
        async query(query) { return clone([...tabs.values()].filter(t => matches(t, query))); },
        async get(id) { if (!tabs.has(id)) throw Error('Tab not found'); return clone(tabs.get(id)); },
        async create(options) {
          if (options.url?.includes('fail.test')) throw Error('Simulated create failure');
          const windowId = options.windowId ?? 1;
          const id = nextTab++;
          const index = options.index ?? (options.pinned ? [...tabs.values()].filter(t => t.windowId === windowId && t.pinned).length : [...tabs.values()].filter(t => t.windowId === windowId).length);
          for (const t of tabs.values()) if (t.windowId === windowId && t.index >= index) t.index++;
          const tab = { id, windowId, groupId:-1, index, pinned:!!options.pinned, active:!!options.active, url:options.url || 'chrome://newtab/', title:options.url || 'New tab' };
          tabs.set(id, tab); chrome.tabs.onCreated.emit(tab); if (tab.active) await setActive(id); return clone(tab);
        },
        async update(id, patch) {
          const tab = tabs.get(id); if (!tab) throw Error('Tab not found');
          Object.assign(tab, patch); if (patch.active) await setActive(id); chrome.tabs.onUpdated.emit(id, patch, tab); return clone(tab);
        },
        async group({tabIds,groupId}) {
          const ids = [].concat(tabIds); const first = tabs.get(ids[0]); if (!first) throw Error('Tab not found');
          if (groupId == null) { groupId = nextGroup++; groups.set(groupId,{id:groupId,windowId:first.windowId,title:'',color:'grey',collapsed:false}); }
          const group = groups.get(groupId); if (!group) throw Error('Group not found');
          for (const id of ids) { const t = tabs.get(id); if (!t || t.pinned || t.windowId !== group.windowId) throw Error('Invalid group tab'); t.groupId = groupId; chrome.tabs.onUpdated.emit(id,{groupId},t); }
          pruneGroups(); return groupId;
        },
        async ungroup(ids) { for (const id of [].concat(ids)) { const t = tabs.get(id); if (!t) throw Error('Tab not found'); t.groupId = -1; chrome.tabs.onUpdated.emit(id,{groupId:-1},t); } pruneGroups(); },
        async move(ids, options) {
          const result = [];
          for (const id of [].concat(ids)) {
            const tab = tabs.get(id); if (!tab) throw Error('Tab not found');
            const oldWindow = tab.windowId; const windowId = options.windowId ?? oldWindow;
            const others = [...tabs.values()].filter(t => t.id !== id && t.windowId === windowId).sort((a,b)=>a.index-b.index);
            if (windowId !== oldWindow && tab.groupId >= 0) { tab.groupId = -1; chrome.tabs.onUpdated.emit(id,{groupId:-1},tab); }
            tab.windowId = windowId;
            const index = options.index < 0 ? others.length : Math.min(options.index, others.length);
            others.splice(index,0,tab); others.forEach((t,i)=>t.index=i); normalize(oldWindow);
            chrome.tabs.onMoved.emit(id,{windowId,fromIndex:tab.index,toIndex:index}); result.push(clone(tab));
          }
          pruneGroups(); return Array.isArray(ids) ? result : result[0];
        },
        async remove(ids) { for (const id of [].concat(ids)) { const t=tabs.get(id); if (!t) throw Error('Tab not found'); tabs.delete(id); normalize(t.windowId); chrome.tabs.onRemoved.emit(id,{windowId:t.windowId,isWindowClosing:false}); } pruneGroups(); }
      },
      tabGroups: {
        onUpdated:event(), onMoved:event(), onRemoved:event(),
        async query(query) { return clone([...groups.values()].filter(g => matches(g,query))); },
        async get(id) { if (!groups.has(id)) throw Error('Group not found'); return clone(groups.get(id)); },
        async update(id, patch) { const group=groups.get(id); if (!group) throw Error('Group not found'); Object.assign(group,patch); chrome.tabGroups.onUpdated.emit(group); return clone(group); },
        async move(id,{index}) { const group=groups.get(id); if (!group) throw Error('Group not found'); const ids=[...tabs.values()].filter(t=>t.groupId===id).sort((a,b)=>a.index-b.index).map(t=>t.id); for (const tabId of ids) await chrome.tabs.move(tabId,{index}); chrome.tabGroups.onMoved.emit(group); return clone(group); }
      },
      windows: {
        onFocusChanged:event(),
        async getAll({populate}={}) { return clone([...windows.values()].map(w=>({...w,...(populate?{tabs:[...tabs.values()].filter(t=>t.windowId===w.id).sort((a,b)=>a.index-b.index)}:{})}))); },
        async getLastFocused() { return clone([...windows.values()].find(w=>w.focused) || [...windows.values()][0]); },
        async getCurrent() { return this.getLastFocused(); },
        async create(options) { const id=nextWindow++; const win={id,focused:!!options.focused,incognito:false,type:'normal'}; windows.set(id,win); const tab=await chrome.tabs.create({windowId:id,url:options.url,active:true}); return {...clone(win),tabs:[tab]}; },
        async update(id,patch) { const w=windows.get(id); if (!w) throw Error('Window not found'); if (patch.focused) for (const win of windows.values()) win.focused=win.id===id; Object.assign(w,patch); return clone(w); }
      },
      alarms: { onAlarm:event(), async get(name){return clone(alarms.get(name));}, async create(name,alarm){alarms.set(name,alarm);}, async clear(name){alarms.delete(name);} },
      action: { async setBadgeText(){}, async setBadgeBackgroundColor(){} },
      sidePanel: { async setPanelBehavior(){}, async open(){} },
      contextMenus: { onClicked:event(), removeAll(callback){callback();}, create(options,callback){callback?.();} },
      commands: { onCommand:event(), async getAll(){return [];} },
      runtime: { id:'test-extension', onInstalled:event(), onStartup:event(), onMessage:event(), getURL:p=>'chrome-extension://test-extension/'+p }
    };
    chrome.storage.local=storageArea(local,'local'); chrome.storage.session=storageArea(session,'session'); chrome.storage.sync=storageArea(sync,'sync');
    worker=vm.createContext({chrome,URL,TextEncoder,structuredClone,crypto:{randomUUID}, console:{log(){},debug(){},warn(...args){errors.push(args);}},
      Date:class extends Date {static now(){return now;}},setTimeout,clearTimeout});
    worker.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),worker,{filename:file});};
    worker.importScripts('background.js');
  }
  start();
  async function drain() {
    // Events may enqueue more work when a preceding API promise resolves.
    for (let i=0;i<20;i++) {
      await vm.runInContext('operationQueue',worker);
      await vm.runInContext('_groupActivityQueue',worker);
      if (pending.size) await Promise.all([...pending]);
      await new Promise(resolve=>setImmediate(resolve));
      if (!pending.size) { await vm.runInContext('operationQueue',worker); if(!pending.size) return; }
    }
    throw Error('Event queue did not settle');
  }
  return {
    tabs,groups,windows,local,session,settings:sync,errors,alarms,
    get chrome(){return chrome;},get worker(){return worker;},get now(){return now;},storage:local,
    at(minutes){now=START+minutes*60000;},drain,
    async restartWorker(){await drain();start();await drain();},
    async restartBrowser(){await drain();for(const key of Object.keys(session))delete session[key];start();await drain();},
    async request(action,args={}){const result=await worker.exclusive(()=>worker.handleMessage({action,...args}));await drain();return clone(result);},
    async activate(id){await setActive(id);await drain();},
    async expand(id){await chrome.tabGroups.update(id,{collapsed:false});await drain();},
    scan:()=>worker.autoCollapseIdleGroups(),touch:id=>worker.touchGroup(id),
    async group(id){await worker.exclusive(()=>worker.organizeTab(id));await drain();},
    isCollapsed:id=>groups.get(id).collapsed
  };
}
module.exports={browser,START};
