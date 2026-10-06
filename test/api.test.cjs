const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { createPetalServer } = require('../api/server.cjs');
const { Catalog } = require('../src/catalog.cjs');
const { Store } = require('../src/store.cjs');
const { installMods, download } = require('../src/mods.cjs');
const { petalOrigin } = require('../src/petal-url.cjs');
const { MinecraftMetadata } = require('../src/minecraft-metadata.cjs');
const {setup,jar,admin}=require('./helpers/api.cjs');
test('hosted Quilt snapshots use official compatibility and unknown Minecraft IDs are rejected',async t=>{
  const s=await setup(t), token=await s.author('quilt_author'), p=await s.project(token);
  const catalog=await s.request('/v1/game/versions');
  assert.equal(catalog.status,200);assert.equal(catalog.data.versions.some(v=>v.id==='24w14a'&&v.type==='snapshot'),true);
  const version=await s.version(token,p,{gameVersions:['24w14a'],loaders:['quilt']});
  assert.equal(typeof version.id,'string');
  assert.equal((await s.request(`/v1/versions/${version.id}/file`,{method:'PUT',token,binary:true,body:jar('quilt.mod.json')})).status,200);
  assert.equal((await s.request(`/v1/projects/${p.id}/versions`,{method:'POST',token,body:{name:'Bad',filename:'bad.jar',gameVersions:['99.99.99'],loaders:['fabric'],rightsConfirmed:true}})).status,400);
});

test('author accounts enforce authentication, ownership, and logout without leaking password data', async t => {
  const s = await setup(t);
  const alice = await s.author('alice'), bob = await s.author('bob');
  const p = await s.project(alice);
  assert.equal((await s.request('/v1/me/projects')).status, 401);
  assert.equal((await s.request('/v1/admin/reviews', { token: alice })).status, 403);
  assert.equal((await s.request(`/v1/projects/${p.id}/versions`, { method: 'POST', token: bob, body: {} })).status, 403);
  assert.equal((await s.request(`/v1/projects/${p.id}`)).status, 404);
  const mine = await s.request('/v1/me/projects', { token: alice });
  assert.equal(mine.data.projects[0].author, 'alice'); assert.equal(JSON.stringify(mine.data).includes('password'), false);
  assert.equal((await s.request('/v1/auth/login', { method: 'POST', body: { username: 'alice', password: 'incorrect-password-123' } })).status, 401);
  const login = await s.request('/v1/auth/login', { method: 'POST', body: { username: 'alice', password: 'test-only-password-1234' } }); assert.equal(login.status, 200);
  assert.equal((await s.request('/v1/auth/logout', { method: 'POST', token: alice })).status, 200);
  assert.equal((await s.request('/v1/me/projects', { token: alice })).status, 401);
});

test('a submitted mod stays private until approved, then installs through the real launcher catalog and can be unpublished', async t => {
  const s = await setup(t), token = await s.author('author');
  const p = await s.project(token), v = await s.version(token, p), file = jar();
  const upload = await s.request(`/v1/versions/${v.id}/file`, { method: 'PUT', token, body: file, binary: true });
  assert.equal(upload.status, 200); assert.equal(upload.data.status, 'pending');
  assert.equal((await s.request('/v1/search')).data.total, 0);
  assert.equal((await s.request(`/v1/versions/${v.id}/download`)).status, 401);
  assert.equal((await s.request(`/v1/versions/${v.id}/file`, { method: 'PUT', token, body: file, binary: true })).status, 409);
  const reviews = await s.request('/v1/admin/reviews', { token: admin }); assert.equal(reviews.data.versions.length, 1);
  assert.equal(reviews.data.versions[0].rightsConfirmed, true);
  assert.equal((await s.request(`/v1/admin/versions/${v.id}/review`, { method: 'POST', token: admin, body: { action: 'approve' } })).status, 200);
  const search = await s.request('/v1/search?q=my-mod&version=1.21.1&loader=fabric'); assert.equal(search.data.total, 1);
  assert.equal((await s.request('/v1/search?version=1.20.1')).data.total, 0);
  assert.equal((await s.request('/v1/search?loader=forge')).data.total, 0);
  const catalog = new Catalog(() => '', fetch, () => s.publicUrl);
  const result = await catalog.search({ source: 'petal', version: '1.21.1', loader: 'fabric' }); assert.equal(result.mods[0].source, 'petal');
  const store = new Store(path.join(s.root, 'launcher'));
  const profile = await store.create({ name: 'Petal API instance', version: '1.21.1', loader: 'fabric' });
  assert.equal((await installMods(store, catalog, profile.id, 'petal', p.id)).count, 1);
  assert.deepEqual(await fs.readFile(path.join(store.directory(profile.id), 'mods/my-mod.jar')), file);
  assert.equal(profile.mods[0].file.hash, createHash('sha512').update(file).digest('hex'));
  assert.equal((await s.request(`/projects/${p.id}`)).status, 200);
  assert.equal((await s.request(`/v1/admin/versions/${v.id}/review`, { method: 'POST', token: admin, body: { action: 'reject', note: 'Distribution permission withdrawn.' } })).status, 200);
  assert.equal((await s.request('/v1/search')).data.total, 0);
  assert.equal((await s.request(`/v1/versions/${v.id}/download`)).status, 401);
  const authorVersions = await s.request(`/v1/projects/${p.id}/versions`, { token }); assert.equal(authorVersions.data.versions[0].reviewNote, 'Distribution permission withdrawn.');
});

test('unsafe filenames, invalid archives, missing rights, cross-origin writes, and upload limits are rejected', async t => {
  const s = await setup(t, { maxUploadBytes: 400 }), token = await s.author('author');
  const p = await s.project(token);
  assert.equal((await s.request(`/v1/projects/${p.id}/versions`, { method: 'POST', token, body: { name: '1', filename: '../bad.jar', gameVersions: ['1.21.1'], loaders: ['fabric'], rightsConfirmed: true } })).status, 400);
  assert.equal((await s.version(token, p, { rightsConfirmed: false })).error.includes('permission'), true);
  assert.equal((await s.request('/v1/projects', { method: 'POST', token, body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
  const v = await s.version(token, p);
  assert.equal((await s.request(`/v1/versions/${v.id}/file`, { method: 'PUT', token, body: Buffer.from('not a jar'), binary: true })).status, 400);
  assert.equal((await s.request(`/v1/versions/${v.id}/file`, { method: 'PUT', token, body: jar('readme.txt'), binary: true })).status, 400);
  assert.equal((await s.request(`/v1/versions/${v.id}/file`, { method: 'PUT', token, body: Buffer.alloc(401), binary: true })).status, 413);
  assert.deepEqual(await fs.readdir(path.join(s.root, 'incoming')), []);
  assert.deepEqual(await fs.readdir(path.join(s.root, 'files')), []);
  assert.equal((await s.request('/v1/search?offset=1.2')).status, 400);
  assert.throws(() => petalOrigin('http://example.com'), /HTTPS/);
  assert.throws(() => petalOrigin('https://user:password@example.com'), /HTTPS/);
  await assert.rejects(download({ url: s.publicUrl + '/private/secret', name: 'a.jar', hash: 'a', algorithm: 'sha512' }, fetch, s.publicUrl), /not allowed/);
});

test('Petal dependency versions resolve recursively and only the configured download origin is trusted', async t => {
  const s = await setup(t), token = await s.author('author');
  const dependency = await s.project(token, 'library'), parent = await s.project(token, 'main-mod');
  for (const [project, fields] of [[dependency, { filename: 'library.jar' }], [parent, { filename: 'main.jar', dependencies: [{ id: dependency.id }] }]]) {
    const version = await s.version(token, project, fields);
    await s.request(`/v1/versions/${version.id}/file`, { method: 'PUT', token, body: jar(), binary: true });
    await s.request(`/v1/admin/versions/${version.id}/review`, { method: 'POST', token: admin, body: { action: 'approve' } });
  }
  const catalog = new Catalog(() => '', fetch, () => s.publicUrl);
  const store = new Store(path.join(s.root, 'launcher')), profile = await store.create({ name: 'Dependencies', version: '1.21.1', loader: 'fabric' });
  assert.equal((await installMods(store, catalog, profile.id, 'petal', parent.id)).count, 2);
  assert.equal(profile.mods.length, 2);
  const mod = await catalog.resolve('petal', parent.id, profile);
  await assert.rejects(download(mod.file, fetch, 'https://other.example'), /not allowed/);
  assert.equal((await s.request('/v1/search?q=%')).data.total, 0);
});
