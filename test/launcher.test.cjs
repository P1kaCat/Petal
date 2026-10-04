const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Store, safeFilename } = require('../src/store.cjs');
const { Catalog } = require('../src/catalog.cjs');
const { planInstall, installMods, assertNotRequired, download } = require('../src/mods.cjs');
const { selectNeoForge } = require('../src/game.cjs');
const { retryDownload } = require('../src/retry.cjs');
const profile = () => ({ version: '1.21.1', loader: 'fabric', mods: [] });
const mod = (id, dependencies = [], versionId = 'v1') => ({ source: 'modrinth', id, title: id, versionId, versionName: versionId, dependencies, incompatible: [], file: { name: `${id}.jar`, url: `https://cdn.modrinth.com/${id}`, hash: createHash('sha512').update(id).digest('hex'), algorithm: 'sha512' } });
const fetchFile = async url => new Response(String(url).split('/').pop());
test('paths and Windows special names cannot escape the mods directory', () => {
  for (const name of ['../a.jar', 'C:\\a.jar', 'a.jar:evil', 'nul.jar', '.hidden.jar', 'x.zip', 'a/b.jar']) assert.throws(() => safeFilename(name));
  assert.equal(safeFilename('fabric-api-0.1.jar'), 'fabric-api-0.1.jar');
});
test('profiles persist across restart with separate directories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'petal-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const s = new Store(root); await s.load();
  const a = await s.create({ name: 'A', version: '1.21.1', loader: 'fabric' });
  const b = await s.create({ name: 'B', version: '1.20.1', loader: 'forge' });
  assert.notEqual(s.directory(a.id), s.directory(b.id));
  const reloaded = new Store(root); await reloaded.load(); assert.equal(reloaded.data.profiles.length, 2);
  await assert.rejects(s.create({ name: 'C', version: '../', loader: 'fabric' }));
});
test('a failed CurseForge request preserves Modrinth results and compatibility filters', async () => {
  const calls = [];
  const c = new Catalog(() => 'test-key', async (url, options) => {
    calls.push({ url: String(url), options });
    return String(url).includes('curseforge') ? new Response('', { status: 403 }) : Response.json({ total_hits: 1, hits: [{ project_id: 'sodium', title: 'Sodium', author: 'test', downloads: 10, slug: 'sodium' }] });
  });
  const r = await c.search({ query: 'sodium', version: '1.21.1', loader: 'fabric' });
  assert.equal(r.mods[0].id, 'sodium'); assert.equal(r.warnings.length, 1);
  assert.deepEqual(JSON.parse(new URL(calls[0].url).searchParams.get('facets')), [['project_type:mod'], ['versions:1.21.1'], ['categories:fabric']]);
  assert.equal(new URL(calls[1].url).searchParams.get('modLoaderType'), '4');
  assert.equal(calls[1].options.headers['x-api-key'], 'test-key');
});
test('CurseForge and Modrinth keep distinct IDs, rankings, and pagination', async () => {
  const c = new Catalog(() => 'key', async url => String(url).includes('curseforge') ? Response.json({ pagination: { totalCount: 45 }, data: [{ id: 1, name: 'Same name', summary: 'cf', authors: [], links: { websiteUrl: 'https://curseforge.com' }, downloadCount: 100 }] }) : Response.json({ total_hits: 30, hits: [{ project_id: '1', title: 'Same name', slug: 'same', downloads: 200 }] }));
  const r = await c.search({ offset: 20 });
  assert.equal(r.mods.length, 2); assert.notEqual(r.mods[0].source, r.mods[1].source); assert.equal(r.hasMore, true);
});
test('required dependencies resolve recursively and cycles terminate', async () => {
  const a = mod('a', [{ source: 'modrinth', id: 'b' }]), b = mod('b', [{ source: 'modrinth', id: 'a' }]);
  const plan = await planInstall({ resolve: async (_, id) => ({ a, b }[id]) }, profile(), 'modrinth', 'a');
  assert.equal(plan.length, 2);
});
test('conflicting pinned dependencies fail before files are written', async () => {
  const a = mod('a', [{ source: 'modrinth', id: 'b', versionId: 'v1' }, { source: 'modrinth', id: 'b', versionId: 'v2' }]);
  await assert.rejects(planInstall({ resolve: async (_, id, p, v) => id === 'a' ? a : mod('b', [], v) }, profile(), 'modrinth', 'a'), /Deux versions/);
});
test('updates cannot break installed mods with pinned dependencies', async () => {
  const p = profile(); p.mods = [mod('parent', [{ source: 'modrinth', id: 'b', versionId: 'v1' }]), mod('b')];
  await assert.rejects(planInstall({ resolve: async () => mod('b', [], 'v2') }, p, 'modrinth', 'b'), /version requise/);
});
test('incompatible projects and file collisions are rejected', async () => {
  const p = profile(); p.mods = [mod('b')]; const a = mod('a'); a.incompatible = [{ source: 'modrinth', id: 'b' }];
  await assert.rejects(planInstall({ resolve: async () => a }, p, 'modrinth', 'a'), /Conflit/);
  a.incompatible = []; a.file.name = 'b.jar'; await assert.rejects(planInstall({ resolve: async () => a }, p, 'modrinth', 'a'), /même fichier/);
});
test('checksum mismatches and unexpected hosts never install files', async () => {
  await assert.rejects(download(mod('a').file, async () => new Response('corrupted')), /Empreinte incorrecte/);
  await assert.rejects(download({ ...mod('a').file, url: 'https://evil.example/a.jar' }, fetchFile), /non autorisée/);
});
test('dependency download failure leaves the complete prior installation intact', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'petal-rollback-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const s = new Store(root), p = await s.create({ name: 'Test', version: '1.21.1', loader: 'fabric' });
  const old = mod('a'); p.mods.push(old); await fs.writeFile(path.join(s.directory(p.id), 'mods/a.jar'), 'old'); await s.save();
  const c = { resolve: async (_, id) => id === 'a' ? mod('a', [{ source: 'modrinth', id: 'b' }], 'v2') : mod('b') };
  await assert.rejects(installMods(s, c, p.id, 'modrinth', 'a', () => {}, async url => String(url).endsWith('/b') ? new Response('corrupted') : fetchFile(url)));
  assert.equal(await fs.readFile(path.join(s.directory(p.id), 'mods/a.jar'), 'utf8'), 'old');
  assert.equal(p.mods[0].versionId, 'v1'); assert.equal(p.mods.length, 1);
  assert.deepEqual(await fs.readdir(s.directory(p.id)), ['mods']);
});
test('install writes verified mods and persists the manifest', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'petal-install-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const s = new Store(root), p = await s.create({ name: 'Test', version: '1.21.1', loader: 'fabric' });
  const c = { resolve: async (_, id) => id === 'a' ? mod('a', [{ source: 'modrinth', id: 'b' }]) : mod('b') };
  assert.equal((await installMods(s, c, p.id, 'modrinth', 'a', () => {}, fetchFile)).count, 2);
  assert.equal(await fs.readFile(path.join(s.directory(p.id), 'mods/b.jar'), 'utf8'), 'b');
  const reloaded = new Store(root); await reloaded.load(); assert.equal(reloaded.profile(p.id).mods.length, 2);
  assert.throws(() => assertNotRequired(p, p.mods.find(m => m.id === 'b')), /requis par/);
});
test('NeoForge version selection compares numbers and matches the Minecraft patch', () => {
  assert.equal(selectNeoForge(['21.1.9', '21.1.100', '21.0.200', '21.1.200-beta'], '1.21.1'), '21.1.100');
  assert.equal(selectNeoForge(['21.1.100'], '1.20.4'), undefined);
});
test('interrupted downloads resume with a bounded retry count', async () => {
  let attempts = 0;
  assert.equal(await retryDownload(async () => { if (++attempts < 3) throw new AggregateError([], 'network'); return 'ready'; }, () => {}, async () => {}), 'ready');
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retryDownload(async () => { attempts++; throw new AggregateError([], 'network'); }, () => {}, async () => {}));
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retryDownload(async () => { attempts++; throw new Error('invalid version'); }, () => {}, async () => {}));
  assert.equal(attempts, 1);
});
