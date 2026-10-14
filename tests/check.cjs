const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.join(__dirname,'..');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.ok(Number(manifest.minimum_chrome_version)>=116);
assert.ok(!manifest.permissions.includes('scripting'));
assert.ok(!manifest.host_permissions && !manifest.content_scripts);
for (const file of [manifest.background.service_worker,manifest.side_panel.default_path,manifest.options_ui.page]) assert.ok(fs.existsSync(path.join(root,file)),`${file} exists`);
for (const file of fs.readdirSync(root).filter(f=>f.endsWith('.js'))) {
  const result = spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  assert.equal(result.status,0,`${file}: ${result.stderr}`);
}
for (const file of ['panel.html','settings.html','snapshots.html']) {
  const html=fs.readFileSync(path.join(root,file),'utf8');
  assert.match(html,/<html lang="en">/);
  assert.ok(!/\son\w+=|<script(?![^>]*\bsrc=)[^>]*>[^<]+/.test(html),'no inline event handlers or scripts');
  for(const [,src] of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
    assert.ok(!/^https?:/.test(src),'extension assets are local'); assert.ok(fs.existsSync(path.join(root,src)),`${file} references ${src}`);
  }
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]); assert.equal(ids.length,new Set(ids).size,`${file}: duplicate IDs`);
  for(const [,id] of html.matchAll(/\bfor="([^"]+)"/g)) assert.ok(ids.includes(id),`${file}: label ${id}`);
}
console.log('Syntax, manifest, local assets, CSP and static form-label checks passed.');
