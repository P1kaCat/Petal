const test = require('node:test');
const assert = require('node:assert/strict');
const { getLoader } = require('../src/loaders/index.cjs');
const xml = values => `<metadata><versioning><versions>${values.map(v=>`<version>${v}</version>`).join('')}</versions></versioning></metadata>`;
test('NeoForge maps a Minecraft minor release without a patch to zero',async()=>{
  const adapter=getLoader('neoforge',{fetcher:async url=>new Response(url.endsWith('.xml')?xml(['21.0.167','21.1.10']):'<project><dependencies><dependency><artifactId>neoform</artifactId><version>1.21-20240613.152323</version></dependency></dependencies></project>')});
  assert.deepEqual((await adapter.list('1.21')).map(v=>v.version),['21.0.167']);
});
const fetcher = async url => {
  if (url.includes('fabricmc.net')) return Response.json(url.endsWith('/1.21.1') ? [{loader:{version:'0.16.9',stable:true}},{loader:{version:'0.17.0-beta.1',stable:false}}] : []);
  if (url.includes('quiltmc.org')) return Response.json(url.endsWith('/1.21.1') ? [{loader:{version:'0.29.0'}},{loader:{version:'0.30.0-beta.1'}}] : []);
  if (url.includes('minecraftforge.net')) return new Response(xml(['1.21.1-52.0.9','1.21.1-52.0.10','1.20.1-47.1.0']));
  if (url.includes('/forge/maven-metadata')) return new Response(xml(['1.20.1-47.1.106']));
  if (url.endsWith('maven-metadata.xml')) return new Response(xml(['20.2.1','21.1.9','21.1.10','21.1.11-beta']));
  if (url.endsWith('.pom')) return new Response(`<project><dependencies><dependency><artifactId>neoform</artifactId><version>${url.includes('/20.2.')?'1.20.2':'1.21.1'}-20240808.144430</version></dependency></dependencies></project>`);
  throw new Error('Unexpected fixture URL: '+url);
};
test('Vanilla is a runtime and unimplemented loader IDs are rejected', async () => {
  assert.deepEqual(await getLoader('vanilla').list('b1.7.3'),[{id:'vanilla',version:'b1.7.3',stable:true,gameVersion:'b1.7.3'}]);
  assert.throws(()=>getLoader('rift'),/loader/i);
});
test('Fabric and Quilt exclude prereleases unless explicitly requested and reject unsupported games',async()=>{
  for(const id of ['fabric','quilt']) {
    const adapter = getLoader(id,{fetcher});
    assert.equal((await adapter.list('1.21.1')).length,1);
    assert.equal((await adapter.list('1.21.1',{includePrerelease:true})).length,2);
    assert.deepEqual(await adapter.list('b1.7.3'),[]);
  }
});
test('Forge compatibility matches the complete Minecraft identifier and sorts numerically',async()=>{
  const adapter=getLoader('forge',{fetcher});
  assert.deepEqual((await adapter.list('1.21.1')).map(v=>v.version),['52.0.10','52.0.9']);
  assert.deepEqual(await adapter.list('1.21'),[]);
});
test('NeoForge validates published Minecraft dependencies and handles the legacy forge artifact',async()=>{
  const adapter=getLoader('neoforge',{fetcher});
  assert.deepEqual((await adapter.list('1.21.1')).map(v=>v.version),['21.1.10','21.1.9']);
  assert.deepEqual((await adapter.list('1.20.2')).map(v=>v.version),['20.2.1']);
  assert.deepEqual((await adapter.list('1.20.1')).map(v=>v.version),['47.1.106']);
  assert.deepEqual(await adapter.list('24w14a'),[]);
});
test('NeoForge never accepts a numeric prefix when the published Minecraft dependency disagrees',async()=>{
  const wrong = async url => url.endsWith('.pom') ? new Response('<dependency><artifactId>neoform</artifactId><version>1.21-20240101.000000</version></dependency>') : fetcher(url);
  assert.deepEqual(await getLoader('neoforge',{fetcher:wrong}).list('1.21.1'),[]);
});
test('requested loader versions cannot silently install a newer or incompatible version',async()=>{
  const adapter=getLoader('fabric',{fetcher});
  await assert.rejects(adapter.install({profile:{version:'1.21.1',loaderVersion:'0.0.0'},resources:'unused'}),/compatible|version/i);
  const runtime=await getLoader('vanilla').install({profile:{version:'24w14a'}});
  assert.equal(runtime.runtimeVersion,'24w14a');
});
test('the chosen loader version persists in a profile instead of silently reverting to latest',async t=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const {Store}=require('../src/store.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'petal-pin-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new Store(root);
  const p=await store.create({name:'Pinned',version:'1.21.1',loader:'fabric',loaderVersion:'0.16.9'});
  const reloaded=new Store(root);await reloaded.load();
  assert.equal(reloaded.profile(p.id).loaderVersion,'0.16.9');
});
