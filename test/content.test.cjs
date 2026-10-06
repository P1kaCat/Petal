const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {setup,jar,admin}=require('./helpers/api.cjs');
const {validateArchive}=require('../api/archives.cjs');
const {installContent,validatePack}=require('../src/content.cjs');
test('ZIP content validates metadata, shader structure and rejects unsafe entries',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'petal-content-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'pack.zip');
  for(const [type,name,payload] of [['resourcepack','pack.mcmeta','{"pack":{"pack_format":34,"description":"Test"}}'],['datapack','pack.mcmeta','{"pack":{"pack_format":48,"description":"Test"}}'],['shader','shaders/world0/terrain.vsh','void main(){}']]){await fs.writeFile(file,jar(name,payload));assert.equal((await validateArchive(file,type)).type,type);}
  await fs.writeFile(file,jar('pack.mcmeta','{}'));await assert.rejects(()=>validateArchive(file,'resourcepack'));
  await fs.writeFile(file,jar('../pack.mcmeta'));await assert.rejects(()=>validateArchive(file,'datapack'));
  const bomb=jar('pack.mcmeta');const central=bomb.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bomb.writeUInt32LE(0x50000000,central+24);await fs.writeFile(file,bomb);await assert.rejects(()=>validateArchive(file,'resourcepack'));
});
test('hosting pack types preserves pending privacy and exposes type filters after approval',async t=>{
  const s=await setup(t),token=await s.author('packauthor');
  const p=(await s.request('/v1/projects',{method:'POST',token,body:{slug:'texture-pack',title:'Textures',description:'A permissioned texture pack',license:'MIT',type:'resourcepack'}})).data;
  assert.equal(p.type,'resourcepack');
  const v=await s.version(token,p,{filename:'textures.zip',loaders:['vanilla']});assert.ok(v.id);
  assert.equal((await s.request('/v1/versions/'+v.id+'/file',{method:'PUT',token,body:jar('pack.mcmeta','{"pack":{"pack_format":34,"description":"Test"}}'),binary:true})).status,200);
  assert.equal((await s.request('/v1/versions/'+v.id+'/download')).status,401);
  assert.equal((await s.request('/v1/admin/versions/'+v.id+'/review',{method:'POST',token:admin,body:{action:'approve'}})).status,200);
  assert.equal((await s.request('/v1/search?type=resourcepack')).data.total,1);assert.equal((await s.request('/v1/search?type=mod')).data.total,0);
});
test('content installs use selected world and stage all files before committing with rollback',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'petal-install-content-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'saves','My world'),{recursive:true});await fs.mkdir(path.join(root,'mods'));const profile={version:'1.21.1',loader:'fabric',mods:[],content:[]};
  const store={profile:()=>profile,directory:()=>root,save:async()=>{}},buffer=jar('pack.mcmeta','{"pack":{"pack_format":34,"description":"Test"}}'),hash=createHash('sha512').update(buffer).digest('hex');
  const catalog={petalUrl:'http://127.0.0.1:4318',resolveContent:async(source,id,p,versionId,type)=>({source,id,versionId,type,file:{name:'pack.zip',url:'http://127.0.0.1:4318/v1/versions/11111111-1111-4111-8111-111111111111/download',hash,algorithm:'sha512'},dependencies:[],incompatible:[]})};
  await assert.rejects(()=>installContent(store,catalog,'profile','petal','id','datapack',{},()=>{},async()=>new Response(buffer)),/world/i);
  await installContent(store,catalog,'profile','petal','id','datapack',{world:'My world'},()=>{},async()=>new Response(buffer));
  assert.deepEqual(await fs.readFile(path.join(root,'saves','My world','datapacks','pack.zip')),buffer);
  await assert.rejects(()=>installContent(store,catalog,'profile','petal','id','datapack',{world:'../escape'}),/world/i);
  profile.content=[];store.save=async()=>{throw Error('disk full');};
  await assert.rejects(()=>installContent(store,catalog,'profile','petal','id','resourcepack',{},()=>{},async()=>new Response(buffer)),/disk full/);
  await assert.rejects(()=>fs.access(path.join(root,'resourcepacks','pack.zip')));assert.equal(profile.content.length,0);
});
test('versioned modpack manifest pins provider files and disallows arbitrary URLs and targets',()=>{
  const pack={formatVersion:1,name:'Test pack',gameVersion:'1.21.1',loader:'fabric',files:[{source:'curseforge',projectId:'1',versionId:'2',type:'mod',target:'mods/test.jar',hash:'a'.repeat(40),algorithm:'sha1',optional:false}]};
  assert.equal(validatePack(pack).files.length,1);
  for(const change of [{target:'../escape.jar'},{url:'https://elsewhere.test/file.jar'},{source:'mirror'},{versionId:''}])assert.throws(()=>validatePack({...pack,files:[{...pack.files[0],...change}]}));
});
test('permission-blocked required pack files preserve existing installs while optional files are skipped',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'petal-pack-permissions-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'resourcepacks'));await fs.writeFile(path.join(root,'resourcepacks','prior.zip'),'prior');
  const profile={version:'1.21.1',loader:'fabric',mods:[],content:[]},store={profile:()=>profile,directory:()=>root,save:async()=>{}};
  let optional=false,calls=0;
  const manifest=()=>({formatVersion:1,name:'Test',gameVersion:'1.21.1',loader:'fabric',files:[{source:'curseforge',projectId:'1',versionId:'2',type:'resourcepack',target:'resourcepacks/new.zip',hash:'a'.repeat(40),algorithm:'sha1',optional}]});
  const catalog={petalUrl:'http://127.0.0.1:4318',resolveContent:async(source)=>{if(source!=='petal'){calls++;throw Error('Author API download permission denied');}const bytes=jar('petal.index.json',JSON.stringify(manifest()));return {source,id:'pack',versionId:'version',file:{name:'pack.zip',url:'http://127.0.0.1:4318/v1/versions/11111111-1111-4111-8111-111111111111/download',hash:createHash('sha512').update(bytes).digest('hex'),algorithm:'sha512'}};}};
  const fetcher=async()=>new Response(jar('petal.index.json',JSON.stringify(manifest())));
  await assert.rejects(()=>installContent(store,catalog,'profile','petal','pack','modpack',{},()=>{},fetcher),/permission/);
  assert.equal(await fs.readFile(path.join(root,'resourcepacks','prior.zip'),'utf8'),'prior');assert.equal(profile.content.length,0);
  optional=true;calls=0;assert.equal((await installContent(store,catalog,'profile','petal','pack','modpack',{},()=>{},fetcher)).count,0);assert.equal(calls,0);
});
test('a pack update cannot overwrite an unrelated manual JAR through its target name',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'petal-manual-collision-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'mods'));
  await fs.writeFile(path.join(root,'mods','a-old.jar'),'old');await fs.writeFile(path.join(root,'mods','manual.jar'),'manual');
  const bytes=jar(),hash=createHash('sha512').update(bytes).digest('hex'),mod={source:'petal',id:'mod-a',versionId:'old',file:{name:'a-old.jar'},dependencies:[]},profile={version:'1.21.1',loader:'fabric',mods:[mod],content:[]};
  const manifest={formatVersion:1,name:'Test',gameVersion:'1.21.1',loader:'fabric',files:[{source:'petal',projectId:'mod-a',versionId:'new',type:'mod',target:'mods/manual.jar',hash,algorithm:'sha512',optional:false}]};const pack=jar('petal.index.json',JSON.stringify(manifest));
  const catalog={petalUrl:'http://127.0.0.1:4318',resolveContent:async(s,id)=>({source:s,id,versionId:'new',title:id,file:{name:id==='pack'?'pack.zip':'a-new.jar',url:'http://127.0.0.1:4318/v1/versions/'+(id==='pack'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222')+'/download',hash:createHash('sha512').update(id==='pack'?pack:bytes).digest('hex'),algorithm:'sha512'},dependencies:[],incompatible:[]})};
  const store={profile:()=>profile,directory:()=>root,save:async()=>{}};
  await assert.rejects(()=>installContent(store,catalog,'p','petal','pack','modpack',{},()=>{},async url=>new Response(String(url).includes('11111111')?pack:bytes)),/belongs|exists|collision/);
  assert.equal(await fs.readFile(path.join(root,'mods','manual.jar'),'utf8'),'manual');assert.equal(await fs.readFile(path.join(root,'mods','a-old.jar'),'utf8'),'old');
});
