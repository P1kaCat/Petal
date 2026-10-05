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
const fixtureMetadata = () => new MinecraftMetadata({fetcher:async url=>{
  if(url.includes('piston-meta.mojang.com'))return Response.json({versions:['1.21.1','1.20.1','24w14a'].map(id=>({id,type:id==='24w14a'?'snapshot':'release',releaseTime:'2024-01-01T00:00:00Z',url:`https://piston-meta.mojang.com/${id}.json`}))});
  if(url.includes('fabricmc.net')||url.includes('quiltmc.org'))return Response.json([{loader:{version:'0.16.9',stable:true}}]);
  return new Response('',{status:404});
}});
const admin = 'petal-test-admin-token-not-for-production-123456';
function jar(name = 'fabric.mod.json') {
  const filename = Buffer.from(name), content = Buffer.from('{"schemaVersion":1,"id":"petal_test","version":"1.0.0","name":"Petal Test"}');
  let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + content.length, 16);
  return Buffer.concat([local, filename, content, central, filename, end]);
}
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'petal-api-test-'));
  const service = await createPetalServer({ dataDir: root, adminToken: admin, metadata:fixtureMetadata(), ...options });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  t.after(async () => { service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const request = async (route, { method = 'GET', token, body, binary = false, headers = {} } = {}) => {
    const response = await fetch(service.publicUrl + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': binary ? 'application/java-archive' : 'application/json' } : {}), ...headers }, body: body ? (binary ? body : JSON.stringify(body)) : undefined });
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.arrayBuffer(), headers: response.headers };
  };
  const author = async username => (await request('/v1/auth/register', { method: 'POST', body: { username, password: 'test-only-password-1234' } })).data.token;
  const project = async (token, slug = 'my-mod') => (await request('/v1/projects', { method: 'POST', token, body: { slug, title: slug, description: 'A test mod for the Petal workflow.', license: 'MIT' } })).data;
  const version = async (token, p, fields = {}) => (await request(`/v1/projects/${p.id}/versions`, { method: 'POST', token, body: { name: '1.0.0', filename: 'my-mod.jar', gameVersions: ['1.21.1'], loaders: ['fabric'], rightsConfirmed: true, ...fields } })).data;
  return { ...service, request, author, project, version, root };
}

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
