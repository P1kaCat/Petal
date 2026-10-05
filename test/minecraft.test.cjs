const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { MinecraftMetadata } = require('../src/minecraft-metadata.cjs');
const { Store } = require('../src/store.cjs');
const entry = (id, type) => ({ id, type, releaseTime: '2024-01-01T00:00:00Z', url: `https://piston-meta.mojang.com/v1/packages/abc/${encodeURIComponent(id)}.json` });
const versions = [entry('1.21.1', 'release'), entry('24w14a', 'snapshot'), entry('1.21-pre1', 'snapshot'), entry('b1.7.3', 'old_beta'), entry('a1.2.6', 'old_alpha'), entry('3D Shareware v1.34', 'snapshot')];
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'petal-metadata-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
test('official metadata preserves all categories and opaque historical identifiers', async () => {
  const meta = new MinecraftMetadata({ fetcher: async () => Response.json({ versions }) });
  const result = await meta.versions();
  assert.deepEqual(result.versions.map(v => v.id), ['1.21.1','24w14a','1.21-pre1','b1.7.3','a1.2.6','3D Shareware v1.34']);
  assert.deepEqual([...new Set(result.versions.map(v => v.type))], ['release','snapshot','old_beta','old_alpha']);
  assert.equal(result.stale, false);
});
test('untrusted paths, duplicate IDs and foreign metadata origins invalidate the manifest', async () => {
  for (const bad of [[entry('../outside','release')], [versions[0],versions[0]], [{...versions[0],url:'https://attacker.example/version.json'}], [{...versions[0],type:'made_up'}]]) {
    const meta = new MinecraftMetadata({ fetcher: async () => Response.json({ versions: bad }) });
    await assert.rejects(meta.versions(), /manifest|metadata|version/i);
  }
});
test('cache expires after one hour and only a valid earlier catalog can provide stale fallback', async t => {
  const root = await fixture(t); let now = 10_000, requests = 0, offline = false;
  const options = { cacheFile: path.join(root,'versions.json'), now: () => now, fetcher: async () => { requests++; if(offline) throw new Error('offline'); return Response.json({ versions }); } };
  const meta = new MinecraftMetadata(options);
  await meta.versions(); await meta.versions(); assert.equal(requests,1);
  now += 3_600_001; offline = true;
  assert.equal((await meta.versions()).stale,true);
  const reloaded = new MinecraftMetadata(options); assert.equal((await reloaded.versions()).stale,true);
  offline = false; assert.equal((await reloaded.versions({refresh:true})).stale,false);
});
test('a corrupt cache cannot authorize a version while offline', async t => {
  const root = await fixture(t), cacheFile = path.join(root,'versions.json');
  await fs.writeFile(cacheFile, JSON.stringify({ savedAt: 1, versions: [entry('../outside','release')] }));
  const meta = new MinecraftMetadata({ cacheFile, fetcher: async () => { throw new Error('offline'); } });
  await assert.rejects(meta.versions(), /offline|metadata/i);
});
test('profile selection rejects unknown versions and loaders', async () => {
  const meta = new MinecraftMetadata({ fetcher: async () => Response.json({ versions }) });
  await assert.rejects(meta.assertSelection({version:'fake',loader:'vanilla'}), /official|version/i);
  await assert.rejects(meta.assertSelection({version:'1.21.1',loader:'malicious'}), /loader/i);
  await meta.assertSelection({version:'24w14a',loader:'vanilla'});
});
test('historical profiles stay inside UUID directories and invalid paths never persist', async t => {
  const root = await fixture(t), store = new Store(root);
  for(const version of ['24w14a','b1.7.3','a1.2.6','3D Shareware v1.34']) {
    const p = await store.create({name:'Historical',version,loader:'vanilla'});
    assert.equal(path.dirname(store.directory(p.id)),path.join(root,'instances'));
  }
  await assert.rejects(store.create({name:'Invalid',version:'../outside',loader:'vanilla'}));
  assert.equal(store.data.profiles.length,4);
});
