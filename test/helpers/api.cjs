const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {once}=require('node:events');
const {createPetalServer}=require('../../api/server.cjs');
const {MinecraftMetadata}=require('../../src/minecraft-metadata.cjs');
const fixtureMetadata = () => new MinecraftMetadata({fetcher:async url=>{
  if(url.includes('piston-meta.mojang.com'))return Response.json({versions:['1.21.1','1.20.1','24w14a'].map(id=>({id,type:id==='24w14a'?'snapshot':'release',releaseTime:'2024-01-01T00:00:00Z',url:`https://piston-meta.mojang.com/${id}.json`}))});
  if(url.includes('fabricmc.net')||url.includes('quiltmc.org'))return Response.json([{loader:{version:'0.16.9',stable:true}}]);
  return new Response('',{status:404});
}});
const admin = 'petal-test-admin-token-not-for-production-123456';
function jar(name = 'fabric.mod.json',payload='{"schemaVersion":1,"id":"petal_test","version":"1.0.0","name":"Petal Test"}') {
  const filename = Buffer.from(name), content = Buffer.from(payload);
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
    const response = await fetch(`http://127.0.0.1:${service.server.address().port}` + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': binary ? 'application/java-archive' : 'application/json' } : {}), ...headers }, body: body ? (binary ? body : JSON.stringify(body)) : undefined });
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.arrayBuffer(), headers: response.headers };
  };
  const author = async username => (await request('/v1/auth/register', { method: 'POST', body: { username, password: 'test-only-password-1234' } })).data.token;
  const project = async (token, slug = 'my-mod') => (await request('/v1/projects', { method: 'POST', token, body: { slug, title: slug, description: 'A test mod for the Petal workflow.', license: 'MIT' } })).data;
  const version = async (token, p, fields = {}) => (await request(`/v1/projects/${p.id}/versions`, { method: 'POST', token, body: { name: '1.0.0', filename: 'my-mod.jar', gameVersions: ['1.21.1'], loaders: ['fabric'], rightsConfirmed: true, ...fields } })).data;
  return { ...service, request, author, project, version, root };
}

module.exports={setup,jar,admin};
