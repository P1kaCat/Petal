const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {setup,jar,admin}=require('./helpers/api.cjs');
test('durable reservations enforce author/global quota and four-upload concurrency atomically',async t=>{
  const {createStorage}=require('../api/storage.cjs');const s=await setup(t);const token=await s.author('quota');const p=await s.project(token);const v=await s.version(token,p);const me=(await s.request('/v1/me',{token})).data.user;
  const storage=createStorage({db:s.db,root:s.root,maxUpload:64*1048576,maxStorage:2048*1048576,maxAuthor:256*1048576});
  const reserved=storage.reserveUpload({userId:me.id,versionId:v.id,size:64*1048576});
  assert.throws(()=>storage.reserveUpload({userId:me.id,versionId:v.id,size:1}),e=>e.status===409);
  assert.throws(()=>storage.reserveUpload({userId:me.id,size:64*1048576+1}),e=>e.status===413);
  for(let i=0;i<3;i++)storage.reserveUpload({userId:me.id,size:64*1048576});
  assert.throws(()=>storage.reserveUpload({userId:me.id,size:1}),e=>e.status===413);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM upload_reservations').get().n,4);
  const wider=createStorage({db:s.db,root:s.root,maxAuthor:512*1048576});assert.throws(()=>wider.reserveUpload({userId:me.id,size:1}),e=>e.status===409);
  storage.cancelUpload(reserved);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM upload_reservations').get().n,3);
  const global=createStorage({db:s.db,root:s.root,maxUpload:64*1048576,maxStorage:192*1048576,maxAuthor:512*1048576});
  assert.throws(()=>global.reserveUpload({userId:me.id,size:1}),e=>e.status===413);
});
test('author HTTP quota is enforced and unsafe archive entries never reach pending storage',async t=>{
  const s=await setup(t,{maxAuthorBytes:jar().length});const token=await s.author('authorquota'),p=await s.project(token),v=await s.version(token,p);
  assert.equal((await s.request('/v1/versions/'+v.id+'/file',{method:'PUT',token,body:jar(),binary:true})).status,200);
  const next=await s.version(token,p,{name:'2.0.0'});
  assert.equal((await s.request('/v1/versions/'+next.id+'/file',{method:'PUT',token,body:jar(),binary:true})).status,413);
  const other=await setup(t),o=await other.author('unsafe'),project=await other.project(o),version=await other.version(o,project);
  assert.equal((await other.request('/v1/versions/'+version.id+'/file',{method:'PUT',token:o,body:jar('../fabric.mod.json'),binary:true})).status,400);
  assert.equal(other.db.prepare('SELECT COUNT(*) AS n FROM upload_reservations').get().n,0);
  assert.equal((await fs.readdir(path.join(other.root,'quarantine'))).length,0);
});
test('ClamAV adapter streams bounded protocol chunks and distinguishes detections',async t=>{
  const net=require('node:net'),{once}=require('node:events'),{createScanner}=require('../api/scanner.cjs');
  const s=await setup(t);const file=path.join(s.root,'sample.jar');await fs.writeFile(file,jar());let detected=false;
  const server=net.createServer(socket=>{let bytes=Buffer.alloc(0);socket.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);if(bytes.length<10)return;if(bytes.subarray(0,10).toString()!=='zINSTREAM\0'){socket.destroy();return;}let offset=10;while(offset+4<=bytes.length){const size=bytes.readUInt32BE(offset);offset+=4;if(size===0){socket.end(detected?'stream: Synthetic FOUND\0':'stream: OK\0');return;}if(offset+size>bytes.length)return;offset+=size;}});});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const scanner=createScanner({host:'127.0.0.1',port:server.address().port});assert.equal((await scanner.scan(file)).status,'clean');detected=true;assert.equal((await scanner.scan(file)).status,'infected');
});
test('reservation reconciliation removes crash orphans but keeps referenced files and retained withdrawals',async t=>{
  const {createStorage}=require('../api/storage.cjs');let now=Date.now();const s=await setup(t);const token=await s.author('cleanup');const p=await s.project(token);const v=await s.version(token,p);const me=(await s.request('/v1/me',{token})).data.user;
  const storage=createStorage({db:s.db,root:s.root,now:()=>now});
  const reservation=storage.reserveUpload({userId:me.id,versionId:v.id,size:100});await fs.writeFile(path.join(s.root,'incoming',reservation.id),'partial');
  await fs.writeFile(path.join(s.root,'files','00000000-0000-4000-8000-000000000000.jar'),'orphan');
  await storage.collectAbandoned({before:now,restart:true});
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM upload_reservations').get().n,0);
  assert.equal((await fs.readdir(path.join(s.root,'incoming'))).length,0);assert.equal((await fs.readdir(path.join(s.root,'files'))).length,0);
  await s.request(`/v1/versions/${v.id}/file`,{method:'PUT',token,body:jar(),binary:true});
  const hash=s.db.prepare('SELECT sha512 FROM versions WHERE id=?').get(v.id).sha512;
  now+=2*86400000;await storage.collectAbandoned({before:now-86400000});assert.equal(s.db.prepare('SELECT sha512 FROM versions WHERE id=?').get(v.id).sha512,hash);
  await s.request(`/v1/versions/${v.id}/withdraw`,{method:'POST',token});
  await storage.collectAbandoned({before:now-86400000});assert.equal((await fs.readdir(path.join(s.root,'quarantine'))).length,1);
});
test('public scanner failure leaves a private pending release that cannot be approved',async t=>{
  let scanFails=true;
  const s=await setup(t,{publicUrl:'https://petal.example.test',reviewPolicy:'scanner',scanner:{scan:async()=>{if(scanFails)throw new Error('scanner unavailable');return {status:'clean'};}},mail:{available:true,send:async()=>{}}});
  const a=await s.request('/v1/auth/register',{method:'POST',body:{username:'scanner',email:'scanner@example.test',password:'scanner-test-password-1234'}});s.db.prepare('UPDATE users SET emailVerified=1 WHERE id=?').run(a.data.user.id);
  const p=await s.project(a.data.token),v=await s.version(a.data.token,p);
  const upload=await s.request(`/v1/versions/${v.id}/file`,{method:'PUT',token:a.data.token,body:jar(),binary:true});assert.equal(upload.status,200);
  assert.equal(s.db.prepare('SELECT scanStatus FROM versions WHERE id=?').get(v.id).scanStatus,'failed');
  // Use a database-backed moderator session fixture; the public master token remains disabled.
  s.db.prepare("UPDATE users SET roles='[\"moderator\"]',mfaSecret='synthetic-enrolled-secret' WHERE id=?").run(a.data.user.id);s.db.prepare('UPDATE sessions SET mfa=1 WHERE userId=?').run(a.data.user.id);
  const review=await s.request(`/v1/admin/versions/${v.id}/review`,{method:'POST',token:a.data.token,body:{action:'approve'}});assert.equal(review.status,503);
  assert.equal((await s.request('/v1/versions/'+v.id+'/download')).status,401);
  assert.equal(s.db.prepare('SELECT status FROM versions WHERE id=?').get(v.id).status,'pending');
  scanFails=false;assert.equal((await s.request(`/v1/admin/versions/${v.id}/scan`,{method:'POST',token:a.data.token})).status,200);
  assert.equal((await s.request(`/v1/admin/versions/${v.id}/review`,{method:'POST',token:a.data.token,body:{action:'approve'}})).status,200);
});
test('disk failure releases durable quota without a pending file',async t=>{
  const s=await setup(t,{writeUpload:async()=>{throw Object.assign(new Error('synthetic disk full'),{code:'ENOSPC'});}});const token=await s.author('disk');const p=await s.project(token);const v=await s.version(token,p);
  assert.equal((await s.request('/v1/versions/'+v.id+'/file',{method:'PUT',token,body:jar(),binary:true})).status,507);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM upload_reservations').get().n,0);assert.equal(s.db.prepare('SELECT status FROM versions WHERE id=?').get(v.id).status,'draft');
});
test('seven-day withdrawal cleanup preserves pinned published references and removes expired drafts',async t=>{
  const {createStorage}=require('../api/storage.cjs');const s=await setup(t);const token=await s.author('retention'),p=await s.project(token,'retained-library'),v=await s.version(token,p);
  await s.request('/v1/versions/'+v.id+'/file',{method:'PUT',token,body:jar(),binary:true});await s.request('/v1/admin/versions/'+v.id+'/review',{method:'POST',token:admin,body:{action:'approve'}});
  const parent=await s.project(token,'retaining-parent'),pv=await s.version(token,parent,{dependencies:[{id:p.id,versionId:v.id}]});
  await s.request('/v1/versions/'+pv.id+'/file',{method:'PUT',token,body:jar(),binary:true});await s.request('/v1/admin/versions/'+pv.id+'/review',{method:'POST',token:admin,body:{action:'approve'}});
  await s.request('/v1/versions/'+v.id+'/withdraw',{method:'POST',token});s.db.prepare('UPDATE versions SET reviewedAt=? WHERE id=?').run(new Date(Date.now()-8*86400000).toISOString(),v.id);
  const storage=createStorage({db:s.db,root:s.root});await storage.collectAbandoned();assert.ok(s.db.prepare('SELECT sha512 FROM versions WHERE id=?').get(v.id).sha512);
  await s.request('/v1/versions/'+pv.id+'/withdraw',{method:'POST',token});await storage.collectAbandoned();assert.equal(s.db.prepare('SELECT sha512 FROM versions WHERE id=?').get(v.id).sha512,null);
  const draft=await s.version(token,p,{name:'abandoned'});s.db.prepare('UPDATE versions SET createdAt=? WHERE id=?').run(new Date(Date.now()-25*3600000).toISOString(),draft.id);await storage.collectAbandoned();assert.equal(s.db.prepare('SELECT id FROM versions WHERE id=?').get(draft.id),undefined);
});
